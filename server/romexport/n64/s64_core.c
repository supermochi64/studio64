// Studio 64's engine in the ROM: what the page does in the web build, done from the level's own
// data. When an area loads, its objects get their studio uids (the setup and the story name them
// by uid) and the setup the export recorded is played (motion paths, custom objects, rules,
// environment, zones: s64_calls.inc). Every frame, the engine's frame work runs.
#include <ultra64.h>

#include "sm64.h"
#include "game/area.h"
#include "game/level_update.h"
#include "game/memory.h"
#include "game/object_list_processor.h"
#include "game/object_helpers.h"
#include "s64_hack.h"
#include "studio/studio.h"

struct GraphNode *studio_geo_node(const void *geo);

// the level's data (segment 0x0E, gS64Info.levelData): per area, the objects' uids and the setup
struct S64Tag {
    u32 uid;
    const void *behavior;
    s16 pos[3];
    s16 pad;
    const void *geo; // a moving block's or model's own model (segmented), or NULL
    const void *col; // and its collision
    f32 scale;
};

struct S64AreaData {
    u32 tags;   // u16 count, u16 pad, then S64Tag entries
    u32 calls;  // u16 count, u16 pad, then per call: u16 id, u16 argc, u32 args[argc]
    u32 song;   // its own song (s64_songs.c): index + 1, or 0
    u32 spawns; // Studio 64's module objects: u16 count, u16 pad, then S64Spawn entries
};

struct S64Spawn {
    u32 index; // in the catalog
    f32 pos[3];
    s16 angle[3];
    s16 pad;
    u32 bparams;
    u32 uid;
    f32 scale;
};

struct S64LevelData {
    u32 magic;  // "S64L"
    u32 areas[8];
};

f32 s64_f32(u32 w) {
    union { u32 u; f32 f; } c;
    c.u = w;
    return c.f;
}

void *s64_seg_ptr(u32 addr) {
    return addr ? segmented_to_virtual((void *) addr) : NULL;
}

s32 s64_slot_of_uid(u32 uid) {
    s32 i;
    if (uid == 0) {
        return -1;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        if (gObjectPool[i].activeFlags != ACTIVE_FLAG_DEACTIVATED && gObjectPool[i].unused2 == uid) {
            return i;
        }
    }
    return -1;
}

#include "s64_calls.inc"

static struct S64AreaData *area_data(void) {
    struct S64LevelData *level;
    u32 at;
    if (!s64_info_valid() || gCurrentArea == NULL || gCurrLevelNum <= 0 || gCurrLevelNum >= 40) {
        return NULL;
    }
    at = gS64Info.levelData[gCurrLevelNum];
    if (at == 0) {
        return NULL;
    }
    level = segmented_to_virtual((void *) (0x0E000000 + at));
    if (level->magic != 0x5336344C || gCurrAreaIndex < 0 || gCurrAreaIndex >= 8 || level->areas[gCurrAreaIndex] == 0) {
        return NULL;
    }
    return segmented_to_virtual((void *) level->areas[gCurrAreaIndex]);
}

// the level script's objects of this area are spawned: name them, play the setup
static void tag_objects(const u8 *list) {
    s32 n = *(const u16 *) list, i, k;
    const struct S64Tag *tags = (const struct S64Tag *) (list + 4);
    for (i = 0; i < n; i++) {
        const void *bhv = segmented_to_virtual(tags[i].behavior);
        for (k = 0; k < OBJECT_POOL_CAPACITY; k++) {
            struct Object *obj = &gObjectPool[k];
            if (obj->activeFlags == ACTIVE_FLAG_DEACTIVATED || obj->unused2 != 0 || obj->behavior != bhv) {
                continue;
            }
            if ((s16) obj->oPosX == tags[i].pos[0] && (s16) obj->oPosY == tags[i].pos[1] && (s16) obj->oPosZ == tags[i].pos[2]) {
                obj->unused2 = tags[i].uid;
                if (tags[i].geo != NULL) {
                    obj->header.gfx.sharedChild = studio_geo_node(tags[i].geo);
                }
                if (tags[i].col != NULL) {
                    obj->collisionData = segmented_to_virtual(tags[i].col);
                }
                if (tags[i].scale != 1.0f) {
                    obj_scale(obj, tags[i].scale);
                }
                break;
            }
        }
    }
}

static void play_calls(const u8 *stream) {
    s32 n = *(const u16 *) stream, i;
    const u8 *p = stream + 4;
    for (i = 0; i < n; i++) {
        u16 id = ((const u16 *) p)[0], argc = ((const u16 *) p)[1];
        const u32 *args = (const u32 *) (p + 4);
        if (id < sizeof(sCalls) / sizeof(sCalls[0])) {
            sCalls[id](args);
        }
        p += 4 + argc * 4;
    }
}

void studio_flow_area_load(void);
void studio_story_area(void);
void studio_flow_frame(void);
void studio_story_frame(void);
void studio_objects_frame(void);
void s64_glue_frame(void);
void s64_story_area_loaded(void);
void s64_story_frame(void);
void s64_save_area_loaded(void);
void s64_save_frame(void);
s32 s64_song_install(s32 index);
s32 studio_spawn_custom(s32 bhvIndex, s32 modelIndex, f32 x, f32 y, f32 z, s32 yaw, s32 bparams, s32 uid, f32 scale);
s32 s64_spawn_catalog_object(s32 index, f32 x, f32 y, f32 z, s16 pitch, s16 yaw, s16 roll, u32 bparams, u32 uid, f32 scale);

// The catalog names behaviors by their segment 0x13 address; the engine's code reads the scripts
// and compares them with objects' (RAM addresses). The behaviors' segment is not always in the same
// place (the menus load it too): at every area load, RAM addresses from the original ones.
static const void **sCatalogBhv, **sBehaviorScript;

static void catalog_to_ram(void) {
    s32 i;
    if (sCatalogBhv == NULL) {
        sCatalogBhv = malloc(gStudioCatalogCount * sizeof(void *) + 16);
        sBehaviorScript = malloc(gStudioBehaviorCount * sizeof(void *) + 16);
        if (sCatalogBhv == NULL || sBehaviorScript == NULL) {
            return;
        }
        for (i = 0; i < gStudioCatalogCount; i++) {
            const void *b = gStudioCatalog[i].behavior;
            sCatalogBhv[i] = (b != NULL && ((uintptr_t) b >> 24) == 0x13) ? b : NULL;
        }
        for (i = 0; i < gStudioBehaviorCount; i++) {
            const void *b = gStudioBehaviors[i].script;
            sBehaviorScript[i] = (b != NULL && ((uintptr_t) b >> 24) == 0x13) ? b : NULL;
        }
    }
    for (i = 0; i < gStudioCatalogCount; i++) {
        if (sCatalogBhv[i] != NULL) {
            ((struct StudioCatalogEntry *) &gStudioCatalog[i])->behavior = segmented_to_virtual(sCatalogBhv[i]);
        }
    }
    for (i = 0; i < gStudioBehaviorCount; i++) {
        if (sBehaviorScript[i] != NULL) {
            ((struct StudioBehavior *) &gStudioBehaviors[i])->script = segmented_to_virtual(sBehaviorScript[i]);
        }
    }
}

// area.c, load_area: the area's objects exist. They get their uids and the recorded set-up, then
// the story sees the arrival (its locks, the opening, "Mario enters a level" events).
void s64_area_loaded(void) {
    struct S64AreaData *a = area_data();
    catalog_to_ram();
    s64_save_area_loaded();
    studio_flow_area_load();
    studio_story_area();
    if (a != NULL && a->tags) {
        tag_objects(segmented_to_virtual((void *) a->tags));
    }
    if (a != NULL && a->spawns) {
        const u8 *list = segmented_to_virtual((void *) a->spawns);
        const struct S64Spawn *sp = (const struct S64Spawn *) (list + 4);
        s32 i, n = *(const u16 *) list;
        for (i = 0; i < n; i++) {
            if (sp[i].index & 0x80000000) { // a behavior with a catalog model as its look
                s32 model = sp[i].index & 0xFFFF;
                studio_spawn_custom((sp[i].index >> 16) & 0x7FFF, model == 0xFFFF ? -1 : model, sp[i].pos[0], sp[i].pos[1],
                                    sp[i].pos[2], sp[i].angle[1], sp[i].bparams, sp[i].uid, sp[i].scale);
            } else {
                s64_spawn_catalog_object(sp[i].index, sp[i].pos[0], sp[i].pos[1], sp[i].pos[2], sp[i].angle[0], sp[i].angle[1],
                                         sp[i].angle[2], sp[i].bparams, sp[i].uid, sp[i].scale);
            }
        }
    }
    if (a != NULL && a->calls) {
        play_calls(segmented_to_virtual((void *) a->calls));
    }
    if (a != NULL && a->song) {
        s64_song_install(a->song - 1); // (the level script plays its slot)
    }
    s64_story_area_loaded();
}

// game_init.c: every frame, before the level script
void s64_frame(void) {
    if (gCurrentArea == NULL || gMarioState == NULL || gMarioObject == NULL) {
        return;
    }
    s64_glue_frame();
    studio_flow_frame();
    studio_story_frame();
    studio_objects_frame();
    s64_story_frame();
    s64_save_frame();
}
