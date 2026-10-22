// Studio 64: live object editing API for the web build.
//
// The browser drives everything through the exported studio_* functions (ccall),
// always between frames. The persistent "patch" (objects added, objects removed,
// pipe warps) lives on the JS side: whenever an area loads, the engine calls
// Module.studioAreaLoad(level, area) and JS re-applies the patch for that area.

#include <ultra64.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdarg.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#endif

#include "sm64.h"
#include "types.h"
#include "model_ids.h"
#include "behavior_data.h"
#include "engine/geo_layout.h"
#include "engine/graph_node.h"
#include "engine/surface_collision.h"
#include "engine/math_util.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/spawn_object.h"
#include "game/save_file.h"
#include "studio.h"
#include "objects.h"

void load_obj_warp_nodes(void);

#include "gen/catalog.inc.c"

#define STUDIO_POOL_SIZE (48 * 1024 * 1024)
#define MAX_CACHED_MODELS 1024
#define MAX_REMOVALS 512
#define MAX_SPAWN_INFOS 1024
// object slots the studio never fills: the game spawns coins, stars, particles and projectiles there
#define STUDIO_POOL_RESERVE 32
#define JSON_SIZE (512 * 1024)

// ---------------------------------------------------------------------------
// Model graph nodes. Every geo layout we use is processed once into a private,
// never-freed pool, so any model works in any level.

static struct AllocOnlyPool sModelPool;
static const void *sCachedGfx[MAX_CACHED_MODELS];
static struct GraphNode *sCachedNode[MAX_CACHED_MODELS];
static s32 sCachedCount;

// What the current level's script put in each gLoadedGraphNodes slot.
static u8 sSlotOwner[256];          // 0 = free, 1 = boot script, 2 = level script, 3 = studio
static const void *sSlotGfx[256];
static u8 sBootDone;

static struct GraphNode *studio_model_node(const struct StudioModelRef *ref) {
    s32 i;
    struct GraphNode *node = NULL;

    if (ref->gfx == NULL || ref->kind == 0) {
        return NULL;
    }
    for (i = 0; i < sCachedCount; i++) {
        if (sCachedGfx[i] == ref->gfx) {
            return sCachedNode[i];
        }
    }
    if (sModelPool.startPtr == NULL) {
        sModelPool.startPtr = sModelPool.freePtr = malloc(STUDIO_POOL_SIZE);
        sModelPool.totalSpace = STUDIO_POOL_SIZE;
        sModelPool.usedSpace = 0;
    }
    if (ref->kind == 1) {
        node = process_geo_layout(&sModelPool, (void *) ref->gfx);
    } else {
        node = (struct GraphNode *) init_graph_node_display_list(&sModelPool, NULL, ref->layer,
                                                                 (void *) ref->gfx);
    }
    if (sCachedCount < MAX_CACHED_MODELS) {
        sCachedGfx[sCachedCount] = ref->gfx;
        sCachedNode[sCachedCount++] = node;
    }
    return node;
}

void studio_on_level_init(void) {
    s32 i;
    sBootDone = TRUE;
    for (i = 0; i < 256; i++) {
        if (sSlotOwner[i] != 1) {
            sSlotOwner[i] = 0;
            sSlotGfx[i] = NULL;
        }
    }
}

void studio_note_model(s32 model, s32 kind, const void *gfx) {
    if (model >= 0 && model < 256) {
        sSlotOwner[model] = sBootDone ? 2 : 1;
        sSlotGfx[model] = gfx;
    }
}

// A graph node for any geo layout (models that aren't in a level script, like the
// characters ported from Super Mario Sunshine).
struct GraphNode *studio_geo_node(const GeoLayout *geo) {
    struct StudioModelRef ref = { 0, 1, LAYER_OPAQUE, geo };
    return studio_model_node(&ref);
}

// The graph node to draw for ref. Also registers it under its model ID when that slot
// is unused by the current level, so behaviors that look models up by ID find it.
static struct GraphNode *studio_resolve_model(const struct StudioModelRef *ref) {
    s32 id = ref->model;

    if (ref->gfx == NULL) {
        return NULL;
    }
    if (id > 0 && id < 256) {
        if (sSlotOwner[id] != 0 && sSlotGfx[id] == ref->gfx) {
            return gLoadedGraphNodes[id];
        }
        if (sSlotOwner[id] == 0) {
            gLoadedGraphNodes[id] = studio_model_node(ref);
            sSlotOwner[id] = 3;
            sSlotGfx[id] = ref->gfx;
            return gLoadedGraphNodes[id];
        }
    }
    return studio_model_node(ref);
}

// ---------------------------------------------------------------------------
// Spawning

static struct SpawnInfo sSpawnInfos[MAX_SPAWN_INFOS];
static s32 sNextSpawnInfo;

static struct Object *studio_spawn_object(const BehaviorScript *bhv, struct GraphNode *model, f32 x,
                                          f32 y, f32 z, s16 pitch, s16 yaw, s16 roll, u32 bparams) {
    struct SpawnInfo *info = &sSpawnInfos[sNextSpawnInfo++ % MAX_SPAWN_INFOS];
    struct Object *obj;

    // a full pool: refuse instead (and leave the game room for its own coins, stars, particles
    // and projectiles: with no free slot it drops them, and a star that never appears is a softlock)
    if (gCurrentArea == NULL || gObjectLists == NULL || gFreeObjectList.next == NULL) {
        return NULL;
    }
    {
        s32 free = 0;
        struct ObjectNode *n;
        for (n = gFreeObjectList.next; n != NULL && free < STUDIO_POOL_RESERVE; n = n->next) {
            free++;
        }
        if (free < STUDIO_POOL_RESERVE) {
            return NULL;
        }
    }
    memset(info, 0, sizeof(*info));
    info->startPos[0] = (s16) x;
    info->startPos[1] = (s16) y;
    info->startPos[2] = (s16) z;
    info->startAngle[0] = pitch;
    info->startAngle[1] = yaw;
    info->startAngle[2] = roll;
    info->areaIndex = gCurrentArea->index;
    info->activeAreaIndex = gCurrentArea->index;
    info->behaviorArg = bparams;
    info->behaviorScript = (BehaviorScript *) bhv;
    info->unk18 = model;

    obj = create_object(bhv);
    obj->oBehParams = bparams;
    obj->oBehParams2ndByte = (bparams >> 16) & 0xFF;
    obj->behavior = bhv;
    obj->unused1 = 0;
    obj->respawnInfoType = RESPAWN_INFO_TYPE_NULL;
    obj->respawnInfo = NULL;
    geo_obj_init_spawninfo(&obj->header.gfx, info);
    obj->oPosX = x;
    obj->oPosY = y;
    obj->oPosZ = z;
    obj->oFaceAnglePitch = obj->oMoveAnglePitch = pitch;
    obj->oFaceAngleYaw = obj->oMoveAngleYaw = yaw;
    obj->oFaceAngleRoll = obj->oMoveAngleRoll = roll;
    return obj;
}

struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams) {
    return studio_spawn_object(bhv, model, x, y, z, pitch, yaw, roll, bparams);
}

// Spawn catalog entry `index`. uid tags the object so JS can find and delete it.
// Returns the object pool slot or -1.
EMSCRIPTEN_KEEPALIVE
s32 studio_spawn(s32 index, f32 x, f32 y, f32 z, s32 yaw, s32 pitch, s32 roll, s32 bparams, s32 uid,
                 f32 scale) {
    const struct StudioCatalogEntry *e;
    struct Object *obj;
    s32 i;

    if (index < 0 || index >= gStudioCatalogCount) {
        return -1;
    }
    e = &gStudioCatalog[index];
    for (i = 0; i < e->depCount; i++) {
        studio_resolve_model(&e->deps[i]);
    }
    if (e->behavior == bhvCannon) {
        // the game's cannons sit in a pit 340 below their spawn point and rise out of it;
        // a placed one stands where it was put (and does not rise: cannon.inc.c)
        y += 340.0f;
    }
    obj = studio_spawn_object(e->behavior, studio_resolve_model(&e->model), x, y, z, pitch, yaw, roll,
                              (u32) bparams);
    if (obj == NULL) {
        return -1;
    }
    obj->unused2 = (u32) uid;
    if (scale > 0.0f && scale != 1.0f) {
        obj_scale(obj, scale);
    }
    return obj - gObjectPool;
}

// Spawn with any behavior and any catalog model ("a goomba that looks like a tree").
EMSCRIPTEN_KEEPALIVE
s32 studio_spawn_custom(s32 bhvIndex, s32 modelIndex, f32 x, f32 y, f32 z, s32 yaw, s32 bparams,
                        s32 uid, f32 scale) {
    struct Object *obj;
    struct GraphNode *node = NULL;

    if (bhvIndex < 0 || bhvIndex >= gStudioBehaviorCount) {
        return -1;
    }
    if (modelIndex >= 0 && modelIndex < gStudioCatalogCount) {
        node = studio_resolve_model(&gStudioCatalog[modelIndex].model);
    }
    obj = studio_spawn_object(gStudioBehaviors[bhvIndex].script, node, x, y, z, 0, yaw, 0,
                              (u32) bparams);
    if (obj == NULL) {
        return -1;
    }
    obj->unused2 = (u32) uid;
    if (scale > 0.0f && scale != 1.0f) {
        obj_scale(obj, scale);
    }
    return obj - gObjectPool;
}

static s32 studio_is_live(struct Object *obj) {
    return (obj->activeFlags & ACTIVE_FLAG_ACTIVE) && obj->behavior != NULL;
}

static void studio_delete_tree(struct Object *obj, s32 depth) {
    s32 i;
    if (obj == gMarioObject || !studio_is_live(obj)) {
        return;
    }
    obj_mark_for_deletion(obj);
    obj->unused2 = 0;
    if (depth < 3) {
        for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
            struct Object *child = &gObjectPool[i];
            if (child != obj && child->parentObj == obj && studio_is_live(child)) {
                studio_delete_tree(child, depth + 1);
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
s32 studio_delete_slot(s32 slot) {
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return 0;
    }
    if (!studio_is_live(&gObjectPool[slot]) || &gObjectPool[slot] == gMarioObject) {
        return 0;
    }
    studio_delete_tree(&gObjectPool[slot], 0);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_delete_uid(s32 uid) {
    s32 i, n = 0;
    if (uid == 0) {
        return 0;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        if (studio_is_live(&gObjectPool[i]) && gObjectPool[i].unused2 == (u32) uid) {
            studio_delete_tree(&gObjectPool[i], 0);
            n++;
        }
    }
    return n;
}

// Move/rotate/scale an object. Also updates what is drawn, because in build mode
// objects don't run and wouldn't copy their position to the graph node.
EMSCRIPTEN_KEEPALIVE
s32 studio_transform_slot(s32 slot, f32 x, f32 y, f32 z, s32 pitch, s32 yaw, s32 roll, f32 scale) {
    struct Object *obj;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || !studio_is_live(&gObjectPool[slot])) {
        return 0;
    }
    obj = &gObjectPool[slot];
    obj->oPosX = obj->oHomeX = x;
    obj->oPosY = obj->oHomeY = y;
    obj->oPosZ = obj->oHomeZ = z;
    obj->oFaceAnglePitch = obj->oMoveAnglePitch = pitch;
    obj->oFaceAngleYaw = obj->oMoveAngleYaw = yaw;
    obj->oFaceAngleRoll = obj->oMoveAngleRoll = roll;
    vec3f_set(obj->header.gfx.pos, x, y, z);
    vec3s_set(obj->header.gfx.angle, pitch, yaw, roll);
    if (scale > 0.0f) {
        obj_scale(obj, scale);
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_move_slot(s32 slot, f32 x, f32 y, f32 z, s32 yaw) {
    struct Object *obj;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || !studio_is_live(&gObjectPool[slot])) {
        return 0;
    }
    obj = &gObjectPool[slot];
    return studio_transform_slot(slot, x, y, z, obj->oFaceAnglePitch, yaw, obj->oFaceAngleRoll, 0.0f);
}

// ---------------------------------------------------------------------------
// Removal rules: vanilla objects the patch deleted. Applied to everything the area
// spawns and, every frame, to freshly spawned objects (coins from formations etc.).

struct StudioRemoval {
    const BehaviorScript *bhv;
    f32 x, y, z, r;
};
static struct StudioRemoval sRemovals[MAX_REMOVALS];
static s32 sRemovalCount;

EMSCRIPTEN_KEEPALIVE
void studio_clear_removals(void) {
    sRemovalCount = 0;
}

EMSCRIPTEN_KEEPALIVE
void studio_add_removal(s32 bhvIndex, f32 x, f32 y, f32 z, f32 r) {
    if (sRemovalCount < MAX_REMOVALS && bhvIndex >= 0 && bhvIndex < gStudioBehaviorCount) {
        struct StudioRemoval *rm = &sRemovals[sRemovalCount++];
        rm->bhv = gStudioBehaviors[bhvIndex].script;
        rm->x = x;
        rm->y = y;
        rm->z = z;
        rm->r = r > 0.0f ? r : 40.0f;
    }
}

static s32 studio_near(f32 ax, f32 ay, f32 az, struct StudioRemoval *rm) {
    f32 dx = ax - rm->x, dy = ay - rm->y, dz = az - rm->z;
    return dx * dx + dy * dy + dz * dz < rm->r * rm->r;
}

static s32 studio_matches_removal(struct Object *obj) {
    s32 i;
    for (i = 0; i < sRemovalCount; i++) {
        struct StudioRemoval *rm = &sRemovals[i];
        if (obj->behavior == rm->bhv && obj->unused2 == 0
            && (studio_near(obj->oPosX, obj->oPosY, obj->oPosZ, rm)
                || studio_near(obj->oHomeX, obj->oHomeY, obj->oHomeZ, rm))) {
            return TRUE;
        }
    }
    return FALSE;
}

static void studio_apply_removals(s32 onlyNew) {
    s32 i;
    if (sRemovalCount == 0) {
        return;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if (studio_is_live(obj) && obj != gMarioObject && (!onlyNew || obj->oTimer < 2)
            && studio_matches_removal(obj)) {
            obj_mark_for_deletion(obj);
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_apply_removals_now(void) {
    studio_apply_removals(FALSE);
}

// ---------------------------------------------------------------------------
// Warp nodes, so studio pipes (vanilla bhvWarpPipe with bparam2 = node id) can lead
// anywhere: another spot in this area or any level.

void studio_set_warp_node(s32 id, s32 destLevel, s32 destArea, s32 destNode) {
    struct ObjectWarpNode *node;
    if (gCurrentArea == NULL) {
        return;
    }
    for (node = gCurrentArea->warpNodes; node != NULL; node = node->next) {
        if (node->node.id == id) {
            break;
        }
    }
    if (node == NULL) {
        node = calloc(1, sizeof(struct ObjectWarpNode));
        node->node.id = id;
        node->next = gCurrentArea->warpNodes;
        gCurrentArea->warpNodes = node;
    }
    node->node.destLevel = destLevel;
    node->node.destArea = destArea;
    node->node.destNode = destNode;
}

EMSCRIPTEN_KEEPALIVE
void studio_add_warp_node(s32 id, s32 destLevel, s32 destArea, s32 destNode) {
    studio_set_warp_node(id, destLevel, destArea, destNode);
}

// Re-link warp nodes to objects after pipes were added mid-level.
EMSCRIPTEN_KEEPALIVE
void studio_relink_warps(void) {
    if (gCurrentArea != NULL) {
        load_obj_warp_nodes();
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_warp(s32 level, s32 area, s32 node, s32 act) {
    gStudioAutoAct = act; // 0 for levels without an act select
    gStudioIntroMode = STUDIO_INTRO_NONE;
    studio_warp_to(level, area, node);
}

// ---------------------------------------------------------------------------
// Mario

EMSCRIPTEN_KEEPALIVE
s32 studio_teleport(f32 x, f32 y, f32 z, s32 yaw) {
    struct MarioState *m = gMarioState;
    f32 dx, dy, dz;
    if (gMarioObject == NULL || gCurrentArea == NULL) {
        return 0;
    }
    dx = x - m->pos[0];
    dy = y - m->pos[1];
    dz = z - m->pos[2];
    vec3f_set(m->pos, x, y, z);
    vec3f_set(m->vel, 0.0f, 0.0f, 0.0f);
    m->forwardVel = 0.0f;
    m->faceAngle[1] = yaw;
    m->peakHeight = y;
    set_mario_action(m, ACT_FREEFALL, 0);
    {
        // off any platform: a spinning one would fling him from his new spot
        extern struct Object *gMarioPlatform;
        gMarioPlatform = NULL;
        gMarioObject->platform = NULL;
    }
    vec3f_copy(gMarioObject->header.gfx.pos, m->pos);
    gMarioObject->oPosX = x;
    gMarioObject->oPosY = y;
    gMarioObject->oPosZ = z;
    warp_camera(dx, dy, dz);
    return 1;
}

void keyboard_on_all_keys_up(void);

// The page calls this when the chat box takes the keyboard, so Mario stops running.
EMSCRIPTEN_KEEPALIVE
void studio_release_keys(void) {
    keyboard_on_all_keys_up();
}

EMSCRIPTEN_KEEPALIVE
void studio_heal(void) {
    if (gMarioState != NULL) {
        gMarioState->health = 0x880;
        gMarioState->healCounter = 0;
        gMarioState->hurtCounter = 0;
    }
}

// ---------------------------------------------------------------------------
// Terrain queries

EMSCRIPTEN_KEEPALIVE
f32 studio_floor(f32 x, f32 y, f32 z) {
    struct Surface *floor;
    f32 h = find_floor(x, y, z, &floor);
    return floor != NULL ? h : -32000.0f;
}

EMSCRIPTEN_KEEPALIVE
f32 studio_water(f32 x, f32 z) {
    return find_water_level(x, z);
}

EMSCRIPTEN_KEEPALIVE
s32 studio_floor_type(f32 x, f32 y, f32 z) {
    struct Surface *floor;
    find_floor(x, y, z, &floor);
    return floor != NULL ? floor->type : -1;
}

// ---------------------------------------------------------------------------
// JSON reports

static char sJson[JSON_SIZE];
static s32 sJsonLen;

static void jprintf(const char *fmt, ...) {
    va_list args;
    if (sJsonLen >= JSON_SIZE - 1) {
        return;
    }
    va_start(args, fmt);
    sJsonLen += vsnprintf(sJson + sJsonLen, JSON_SIZE - sJsonLen, fmt, args);
    va_end(args);
    if (sJsonLen > JSON_SIZE - 1) {
        sJsonLen = JSON_SIZE - 1;
    }
}

// The catalog entry that best describes a live object (same behavior and model), or -1.
static s32 studio_catalog_index_of_obj(struct Object *obj) {
    struct GraphNode *node = obj->header.gfx.sharedChild;
    const void *gfx = NULL;
    s32 i, loose = -1;

    if (node != NULL) {
        for (i = 0; i < 256 && gfx == NULL; i++) {
            if (gLoadedGraphNodes[i] == node && sSlotOwner[i] != 0) {
                gfx = sSlotGfx[i];
            }
        }
        for (i = 0; i < sCachedCount && gfx == NULL; i++) {
            if (sCachedNode[i] == node) {
                gfx = sCachedGfx[i];
            }
        }
    }
    for (i = 0; i < gStudioCatalogCount; i++) {
        if (gStudioCatalog[i].behavior == obj->behavior) {
            if (gStudioCatalog[i].model.gfx == gfx) {
                return i;
            }
            if (loose < 0) {
                loose = i;
            }
        }
    }
    return loose;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_catalog_index_of(s32 slot) {
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || !studio_is_live(&gObjectPool[slot])) {
        return -1;
    }
    return studio_catalog_index_of_obj(&gObjectPool[slot]);
}

static const char *studio_behavior_name(const BehaviorScript *bhv) {
    s32 i;
    for (i = 0; i < gStudioBehaviorCount; i++) {
        if (gStudioBehaviors[i].script == bhv) {
            return gStudioBehaviors[i].name;
        }
    }
    return "?";
}

EMSCRIPTEN_KEEPALIVE
const char *studio_state_json(void) {
    struct MarioState *m = gMarioState;
    sJsonLen = 0;
    jprintf("{\"level\":%d,\"area\":%d,\"course\":%d,\"act\":%d", gCurrLevelNum,
            gCurrentArea ? gCurrentArea->index : -1, gCurrCourseNum, gCurrActNum);
    if (gMarioObject != NULL && gCurrentArea != NULL) {
        jprintf(",\"mario\":{\"x\":%.0f,\"y\":%.0f,\"z\":%.0f,\"yaw\":%d,\"action\":\"0x%08X\","
                "\"health\":%d,\"coins\":%d,\"stars\":%d,\"lives\":%d,\"floorY\":%.0f,\"forwardVel\":%.1f,"
                "\"invinc\":%d,\"touching\":%d}",
                m->pos[0], m->pos[1], m->pos[2], (s32) m->faceAngle[1], m->action, m->health >> 8,
                m->numCoins, m->numStars, m->numLives, m->floorHeight, m->forwardVel,
                (s32) m->invincTimer, gMarioObject->numCollidedObjs);
    }
    if (gCamera != NULL) {
        jprintf(",\"camera\":{\"yaw\":%d,\"x\":%.0f,\"y\":%.0f,\"z\":%.0f}", (s32) gCamera->yaw,
                gCamera->pos[0], gCamera->pos[1], gCamera->pos[2]);
    }
    jprintf(",\"objects\":%d}", gObjectCounter);
    return sJson;
}

EMSCRIPTEN_KEEPALIVE
const char *studio_objects_json(void) {
    s32 i;
    s32 first = TRUE;
    sJsonLen = 0;
    jprintf("[");
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        f32 d = 0.0f, home[3];
        if (!studio_is_live(obj)) {
            continue;
        }
        studio_path_home(obj, home); // track platforms: where their own track starts (motion.c)
        if (gMarioObject != NULL) {
            f32 dx = obj->oPosX - gMarioObject->oPosX, dy = obj->oPosY - gMarioObject->oPosY,
                dz = obj->oPosZ - gMarioObject->oPosZ;
            d = sqrtf(dx * dx + dy * dy + dz * dz);
        }
        jprintf("%s{\"slot\":%d,\"bhv\":\"%s\",\"x\":%.0f,\"y\":%.0f,\"z\":%.0f,\"hx\":%.0f,\"hy\":%.0f,"
                "\"hz\":%.0f,\"yaw\":%d,\"bparams\":%u,\"uid\":%u,\"parent\":%d,\"dist\":%.0f,\"visible\":%d,"
                "\"list\":%d,\"cat\":%d,\"pitch\":%d,\"roll\":%d,\"scale\":%.3f,\"r\":%.0f,\"h\":%.0f,"
                "\"down\":%.0f,\"surface\":%d}",
                first ? "" : ",", i, studio_behavior_name(obj->behavior), obj->oPosX, obj->oPosY,
                obj->oPosZ, home[0], home[1], home[2], (s32) (s16) obj->oFaceAngleYaw,
                (u32) obj->oBehParams, obj->unused2,
                obj->parentObj != NULL && obj->parentObj != obj ? (s32) (obj->parentObj - gObjectPool) : -1,
                d, (obj->header.gfx.node.flags & GRAPH_RENDER_INVISIBLE) ? 0 : 1,
                (s32) ((obj->header.gfx.node.flags & GRAPH_RENDER_ACTIVE) != 0),
                studio_catalog_index_of_obj(obj), (s32) (s16) obj->oFaceAnglePitch,
                (s32) (s16) obj->oFaceAngleRoll, obj->header.gfx.scale[0],
                obj->hitboxRadius > obj->hurtboxRadius ? obj->hitboxRadius : obj->hurtboxRadius,
                obj->hitboxHeight > obj->hurtboxHeight ? obj->hitboxHeight : obj->hurtboxHeight,
                obj->hitboxDownOffset, obj->collisionData != NULL);
        first = FALSE;
    }
    jprintf("]");
    return sJson;
}

// Highest floor and water level on a grid, for "the top of the mountain" questions.
EMSCRIPTEN_KEEPALIVE
const char *studio_heightmap_json(f32 x0, f32 z0, f32 x1, f32 z1, s32 nx, s32 nz) {
    s32 i, j;
    sJsonLen = 0;
    if (nx < 2) nx = 2;
    if (nz < 2) nz = 2;
    if (nx * nz > 10000) nx = nz = 100;
    jprintf("{\"nx\":%d,\"nz\":%d,\"x0\":%.0f,\"z0\":%.0f,\"x1\":%.0f,\"z1\":%.0f,\"h\":[", nx, nz, x0, z0,
            x1, z1);
    for (j = 0; j < nz; j++) {
        for (i = 0; i < nx; i++) {
            f32 x = x0 + (x1 - x0) * i / (nx - 1);
            f32 z = z0 + (z1 - z0) * j / (nz - 1);
            jprintf("%s%d", (i | j) ? "," : "", (s32) studio_floor(x, 20000.0f, z));
        }
    }
    jprintf("],\"w\":[");
    for (j = 0; j < nz; j++) {
        for (i = 0; i < nx; i++) {
            f32 x = x0 + (x1 - x0) * i / (nx - 1);
            f32 z = z0 + (z1 - z0) * j / (nz - 1);
            jprintf("%s%d", (i | j) ? "," : "", (s32) find_water_level(x, z));
        }
    }
    jprintf("]}");
    return sJson;
}

// Warp nodes of the current area (where pipes, doors and paintings lead).
EMSCRIPTEN_KEEPALIVE
const char *studio_warps_json(void) {
    struct ObjectWarpNode *node;
    s32 first = TRUE;
    sJsonLen = 0;
    jprintf("[");
    if (gCurrentArea != NULL) {
        for (node = gCurrentArea->warpNodes; node != NULL; node = node->next) {
            jprintf("%s{\"id\":%d,\"destLevel\":%d,\"destArea\":%d,\"destNode\":%d", first ? "" : ",",
                    node->node.id, node->node.destLevel & 0x7F, node->node.destArea, node->node.destNode);
            if (node->object != NULL) {
                jprintf(",\"bhv\":\"%s\",\"x\":%.0f,\"y\":%.0f,\"z\":%.0f",
                        studio_behavior_name(node->object->behavior), node->object->oPosX,
                        node->object->oPosY, node->object->oPosZ);
            }
            jprintf("}");
            first = FALSE;
        }
    }
    jprintf("]");
    return sJson;
}

s32 gStudioBootLevel = 0;
s32 gStudioBootAct = 1;
s32 gStudioAutoAct = 0; // act a course is entered in (0: the act selector decides)

// Called before main(): skip the title screen and file select.
EMSCRIPTEN_KEEPALIVE
void studio_set_boot_level(s32 level, s32 act) {
    gStudioBootLevel = level;
    gStudioBootAct = act > 0 ? act : 1;
    gStudioAutoAct = act; // 0 for levels without an act select
    gStudioIntroMode = STUDIO_INTRO_NONE; // opening a project resumes, it doesn't enter a level
}

EMSCRIPTEN_KEEPALIVE
s32 studio_catalog_count(void) {
    return gStudioCatalogCount;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_behavior_count(void) {
    return gStudioBehaviorCount;
}

// ---------------------------------------------------------------------------
// Engine hooks

// File select and the act selector load "areas" too; they never get edits.
static s32 studio_is_menu_area(void) {
    struct SpawnInfo *info;
    for (info = gCurrentArea->objectSpawnInfos; info != NULL; info = info->next) {
        const BehaviorScript *bhv = info->behaviorScript;
        if (bhv == bhvActSelector || bhv == bhvMenuButtonManager || bhv == bhvYellowBackgroundInMenu) {
            return TRUE;
        }
    }
    return FALSE;
}

s16 gStudioAreaMusic;

void studio_on_area_load(void) {
    extern s32 studio_title_area_load(void);
    if (gCurrentArea == NULL || studio_is_menu_area() || studio_title_area_load()) {
        return; // (the launch screen's title screen is no level: title.c)
    }
    sRemovalCount = 0;
    studio_flow_area_load();
    gStudioInIntro = FALSE;
    gStudioAreaMusic = gCurrentArea->musicParam2; // before the page picks other music
    studio_terrain_reset();
    studio_story_area();
    {
        extern void studio_close_course_done_screen(void); // game/ingame_menu.c
        studio_close_course_done_screen();
    }
    EM_ASM({
        if (Module.studioAreaLoad) Module.studioAreaLoad($0, $1);
    }, gCurrLevelNum, gCurrentArea->index);
    studio_apply_removals(FALSE);
}

void studio_tokyo_frame(void); // shoggoth/tokyo.c

void studio_frame(void) {
    studio_world_frame();
    studio_flow_frame();
    studio_story_frame();
    studio_objects_frame(); // gameplay rules (rules.c)
    studio_tokyo_frame();   // Shoggoth World's Tokyo: scrolling textures, its collision (shoggoth/tokyo.c)
    if (gCurrentArea != NULL) {
        studio_apply_removals(TRUE);
    }
}

void studio_after_frame(void) {
    EM_ASM({
        if (Module.studioAfterFrame) Module.studioAfterFrame();
    });
}

#if defined(__has_feature)
#if __has_feature(address_sanitizer)
// Debug builds: the original audio code over-reads its bank data on purpose; keep going.
const char *__asan_default_options(void) {
    return "halt_on_error=0";
}
#endif
#endif

// Test autopilot: Mario walks toward `yaw` for `frames` frames (used by the stair tests).
EMSCRIPTEN_KEEPALIVE
void studio_walk(s32 yaw, s32 frames) {
    extern s32 gStudioWalkFrames;
    extern s16 gStudioWalkYaw;
    gStudioWalkYaw = (s16) yaw;
    gStudioWalkFrames = frames;
}

// Audio health: how often the queue for the speakers ran (nearly) dry, the lowest level seen.
static s32 sAudioFrames, sAudioUnderruns, sAudioMin = 1 << 30;

void studio_audio_stats(s32 queued) {
    sAudioFrames++;
    if (queued < 256) {
        sAudioUnderruns++;
        EM_ASM({ if (Module.studioAudioDebug) console.warn('audio: underrun at frame ' + $0 + ' (' + $1 + ' queued) t=' + Math.round(performance.now())); }, sAudioFrames, queued);
    }
    if (queued < sAudioMin) {
        sAudioMin = queued;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_audio_report(void) {
    EM_ASM({ console.warn('audio: frames ' + $0 + ' underruns ' + $1 + ' lowest queue ' + $2); }, sAudioFrames, sAudioUnderruns, sAudioMin);
    sAudioFrames = sAudioUnderruns = 0;
    sAudioMin = 1 << 30;
}
