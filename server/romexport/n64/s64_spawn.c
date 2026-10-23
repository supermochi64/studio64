// Spawning studio objects in the ROM and the graph nodes of catalog models (studio.c of the
// engine, without the editor's patch): custom objects' projectiles, story spawns, Mario teleports.
#include <ultra64.h>
#include <string.h>

#include "sm64.h"
#include "behavior_data.h"
#include "engine/geo_layout.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/spawn_object.h"
#include "studio/studio.h"

#define MODEL_POOL_SIZE (96 * 1024)
#define MAX_CACHED_MODELS 128
#define MAX_SPAWN_INFOS 64
#define POOL_RESERVE 32 // object slots left for the game's coins, stars, particles

static struct AllocOnlyPool sModelPool;
static const void *sCachedGfx[MAX_CACHED_MODELS];
static struct GraphNode *sCachedNode[MAX_CACHED_MODELS];
static s32 sCachedCount;

static struct GraphNode *model_node(const struct StudioModelRef *ref) {
    s32 i;
    struct GraphNode *node;
    if (ref->gfx == NULL || ref->kind == 0) {
        return NULL;
    }
    for (i = 0; i < sCachedCount; i++) {
        if (sCachedGfx[i] == ref->gfx) {
            return sCachedNode[i];
        }
    }
    if (sModelPool.startPtr == NULL) {
        sModelPool.startPtr = sModelPool.freePtr = malloc(MODEL_POOL_SIZE);
        if (sModelPool.startPtr == NULL) {
            return NULL;
        }
        sModelPool.totalSpace = MODEL_POOL_SIZE;
        sModelPool.usedSpace = 0;
    }
    if (ref->kind == 1) {
        node = process_geo_layout(&sModelPool, (void *) ref->gfx);
    } else {
        node = (struct GraphNode *) init_graph_node_display_list(&sModelPool, NULL, ref->layer, (void *) ref->gfx);
    }
    if (sCachedCount < MAX_CACHED_MODELS) {
        sCachedGfx[sCachedCount] = ref->gfx;
        sCachedNode[sCachedCount++] = node;
    }
    return node;
}

// (a model the level loaded is used as it is)
static struct GraphNode *resolve_model(const struct StudioModelRef *ref) {
    if (ref->model > 0 && ref->model < 256 && gLoadedGraphNodes[ref->model] != NULL) {
        return gLoadedGraphNodes[ref->model];
    }
    return model_node(ref);
}

struct GraphNode *studio_geo_node(const GeoLayout *geo) {
    struct StudioModelRef ref = { 0, 1, LAYER_OPAQUE, geo };
    return model_node(&ref);
}

static struct SpawnInfo sSpawnInfos[MAX_SPAWN_INFOS];
static s32 sNextSpawnInfo;

struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams) {
    struct SpawnInfo *info = &sSpawnInfos[sNextSpawnInfo++ % MAX_SPAWN_INFOS];
    struct Object *obj;
    struct ObjectNode *n;
    s32 free = 0;
    if (gCurrentArea == NULL || gObjectLists == NULL || gFreeObjectList.next == NULL) {
        return NULL;
    }
    for (n = gFreeObjectList.next; n != NULL && free < POOL_RESERVE; n = n->next) {
        free++;
    }
    if (free < POOL_RESERVE) {
        return NULL;
    }
    bzero(info, sizeof(*info));
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
    info->model = model;
    obj = create_object(bhv);
    obj->oBhvParams = bparams;
    obj->oBhvParams2ndByte = (bparams >> 16) & 0xFF;
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

// any behavior with any catalog model ("a goomba that looks like a tree")
s32 studio_spawn_custom(s32 bhvIndex, s32 modelIndex, f32 x, f32 y, f32 z, s32 yaw, s32 bparams, s32 uid, f32 scale) {
    struct Object *obj;
    struct GraphNode *node = NULL;
    if (bhvIndex < 0 || bhvIndex >= gStudioBehaviorCount || gStudioBehaviors[bhvIndex].script == NULL) {
        return -1;
    }
    if (modelIndex >= 0 && modelIndex < gStudioCatalogCount) {
        node = resolve_model(&gStudioCatalog[modelIndex].model);
    }
    obj = studio_spawn_raw(gStudioBehaviors[bhvIndex].script, node, x, y, z, 0, yaw, 0, (u32) bparams);
    if (obj == NULL) {
        return -1;
    }
    obj->unused2 = (u32) uid;
    if (scale > 0.0f && scale != 1.0f) {
        obj_scale(obj, scale);
    }
    return obj - gObjectPool;
}

s32 studio_teleport(f32 x, f32 y, f32 z, s32 yaw) {
    extern struct Object *gMarioPlatform;
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
    gMarioPlatform = NULL;
    gMarioObject->platform = NULL;
    vec3f_copy(gMarioObject->header.gfx.pos, m->pos);
    gMarioObject->oPosX = x;
    gMarioObject->oPosY = y;
    gMarioObject->oPosZ = z;
    warp_camera(dx, dy, dz);
    return 1;
}

// A catalog object placed in the area (Studio 64's modules' objects: the level script cannot name
// their behaviors, which are where the module landed)
s32 s64_spawn_catalog_object(s32 index, f32 x, f32 y, f32 z, s16 pitch, s16 yaw, s16 roll, u32 bparams, u32 uid, f32 scale) {
    const struct StudioCatalogEntry *e;
    struct Object *obj;
    s32 i;
    if (index < 0 || index >= gStudioCatalogCount || gStudioCatalog[index].behavior == NULL) {
        return -1;
    }
    e = &gStudioCatalog[index];
    for (i = 0; i < e->depCount; i++) {
        resolve_model(&e->deps[i]);
    }
    obj = studio_spawn_raw(e->behavior, resolve_model(&e->model), x, y, z, pitch, yaw, roll, bparams);
    if (obj == NULL) {
        return -1;
    }
    obj->unused2 = uid;
    if (scale > 0.0f && scale != 1.0f) {
        obj_scale(obj, scale);
    }
    return obj - gObjectPool;
}

// A catalog object (with the models it needs) where the story spawns one.
s32 s64_spawn_catalog(s32 index, f32 x, f32 y, f32 z, s32 yaw) {
    const struct StudioCatalogEntry *e;
    struct Object *obj;
    s32 i;
    if (index < 0 || index >= gStudioCatalogCount || gStudioCatalog[index].behavior == NULL) {
        return -1;
    }
    e = &gStudioCatalog[index];
    for (i = 0; i < e->depCount; i++) {
        resolve_model(&e->deps[i]);
    }
    obj = studio_spawn_raw(e->behavior, resolve_model(&e->model), x, y, z, 0, yaw, 0, 0);
    return obj != NULL ? obj - gObjectPool : -1;
}
