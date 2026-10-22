// Tokyo from the Shoggoth World hack in Studio 64 (see tokyo.h).
//
// The city (tokyo:city) is one object that draws Shoggoth's geometry (tokyo_city_geo: the level's
// chunks with their culling radii and detail ranges) and adds the level's collision (surface types
// and all) and its canal's water box to the static collision, offset by where the object stands.
// Moving or deleting it rebuilds the collision on the next frame.
//
// The city life is Shoggoth World's (src/game/behaviors/shoggoth_objects.inc.c of the hack), ported:
// one traffic cycle for every signal, the scramble crossing, cars that queue at the lights and stop
// short of Mario, the commuter train, lifts, canal boats, the construction crane, petals, fireflies.
#include <ultra64.h>
#include <string.h>
#include <math.h>

#include "sm64.h"
#include "macros.h"
#include "object_constants.h"
#include "object_fields.h"
#include "audio_defines.h"
#include "surface_terrains.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "engine/graph_node.h"
#include "engine/behavior_script.h"
#include "game/area.h"
#include "game/level_update.h"
#include "game/object_list_processor.h"
#include "game/object_helpers.h"
#include "game/interaction.h"
#include "game/behavior_actions.h"
#include "game/spawn_sound.h"
#include "make_const_nonconst.h"
#include "behavior_data.h"
#include "model_ids.h"
#include "tokyo_data.h"

#define oBhvParams oBehParams // (the decomp's newer name, as in the hack's code)

#define o gCurrentObject

extern s16 *gEnvironmentRegions;
extern u32 gGlobalTimer;
f32 random_float(void);
extern s32 gStudioPaused;
void studio_rebuild_collision(void);
void studio_add_static_tri(s16 *a, s16 *b, s16 *c, s16 type);
s32 studio_surface_has_force(s16 type);
struct GraphNode *studio_geo_node(const GeoLayout *geo);
extern const struct Animation *const toad_seg6_anims_0600FB58[];

#if __has_include("gen/tokyo_data.inc.c")
#define TK_DATA 1
#endif

// ---------------------------------------------------------------------------------------------
// The city object

static const Collision sTkNoCollision[] = { TERRAIN_LOAD_VERTICES, 0, TERRAIN_LOAD_CONTINUE, TERRAIN_LOAD_END };

void bhv_tk_city_init(void) {
    // a collision of its own (empty) keeps the editor's click on the ground: the city is level
    // geometry, picked from the object list, not by clicking anywhere in it
    o->collisionData = (void *) sTkNoCollision;
    o->oDrawingDistance = 32000.0f;
}

void bhv_tk_city_loop(void) {
    // its collision is not rotated or scaled: neither is its picture
    o->oFaceAnglePitch = o->oFaceAngleYaw = o->oFaceAngleRoll = 0;
    o->oMoveAnglePitch = o->oMoveAngleYaw = o->oMoveAngleRoll = 0;
    obj_scale(o, 1.0f);
    o->oDrawingDistance = 32000.0f;
}

#define MAX_CITIES 4
static struct Object *sCities[MAX_CITIES];
static s16 sCityPos[MAX_CITIES][3];
static s32 sCityCount;
static u32 sCitySig;
static s32 sCitySigValid;

static s32 find_cities(void) {
    s32 i, n = 0;
    for (i = 0; i < OBJECT_POOL_CAPACITY && n < MAX_CITIES; i++) {
        struct Object *obj = &gObjectPool[i];
        if ((obj->activeFlags & ACTIVE_FLAG_ACTIVE) && obj->behavior == bhvTkCity) {
            sCities[n] = obj;
            sCityPos[n][0] = (s16) obj->oPosX;
            sCityPos[n][1] = (s16) obj->oPosY;
            sCityPos[n][2] = (s16) obj->oPosZ;
            n++;
        }
    }
    sCityCount = n;
    return n;
}

static u32 city_sig(void) {
    u32 h = 2166136261u;
    s32 i, k;
    for (i = 0; i < sCityCount; i++) {
        for (k = 0; k < 3; k++) {
            h = (h ^ (u16) sCityPos[i][k]) * 16777619u;
        }
        h = (h ^ (u32) (sCities[i] - gObjectPool)) * 16777619u;
    }
    return h ^ (u32) sCityCount;
}

#ifdef TK_DATA
// Shoggoth's level collision: vertices, triangle groups per surface type (with a force word for
// the types that have one), special objects (none in Tokyo), water boxes.
static void city_collision(s16 dx, s16 dy, s16 dz, s32 water, s16 *regions, s32 *count, s32 max) {
    const s16 *p = (const s16 *) tokyo_area_collision;
    const s16 *verts = NULL;
    s32 i;
    while (TRUE) {
        s16 cmd = *p++;
        if (cmd == TERRAIN_LOAD_VERTICES) {
            s32 n = *p++;
            verts = p;
            p += n * 3;
        } else if (cmd == TERRAIN_LOAD_CONTINUE) {
            continue;
        } else if (cmd == TERRAIN_LOAD_END) {
            break;
        } else if (cmd == TERRAIN_LOAD_OBJECTS) {
            break; // (Tokyo has none; their size depends on each preset)
        } else if (cmd == TERRAIN_LOAD_ENVIRONMENT) {
            s32 n = *p++;
            for (i = 0; i < n; i++, p += 6) {
                if (water && *count < max) {
                    s16 *r = &regions[1 + *count * 6];
                    r[0] = 50; // a water id no level's moving water texture uses
                    r[1] = p[1] + dx;
                    r[2] = p[2] + dz;
                    r[3] = p[3] + dx;
                    r[4] = p[4] + dz;
                    r[5] = p[5] + dy;
                    (*count)++;
                }
            }
        } else {
            // a group of triangles of surface type cmd
            s32 n = *p++, force = studio_surface_has_force(cmd);
            for (i = 0; i < n; i++, p += force ? 4 : 3) {
                const s16 *a = &verts[p[0] * 3], *b = &verts[p[1] * 3], *c = &verts[p[2] * 3];
                s16 va[3] = { a[0] + dx, a[1] + dy, a[2] + dz };
                s16 vb[3] = { b[0] + dx, b[1] + dy, b[2] + dz };
                s16 vc[3] = { c[0] + dx, c[1] + dy, c[2] + dz };
                if (!water && verts != NULL) {
                    studio_add_static_tri(va, vb, vc, cmd);
                }
            }
        }
    }
}
#endif

void studio_tokyo_add_surfaces(void) {
#ifdef TK_DATA
    s32 i;
    find_cities();
    for (i = 0; i < sCityCount; i++) {
        city_collision(sCityPos[i][0], sCityPos[i][1], sCityPos[i][2], FALSE, NULL, NULL, 0);
    }
    sCitySig = city_sig();
    sCitySigValid = TRUE;
#endif
}

#define MAX_TK_REGIONS 48
static s16 sTkRegions[1 + MAX_TK_REGIONS * 6];

// After the level's own regions (the studio sea, imported models' water, water boxes): the canal.
void studio_tokyo_apply_water(void) {
#ifdef TK_DATA
    s32 i, n = 0;
    s16 *base = gEnvironmentRegions;
    if (sCityCount == 0) {
        if (gEnvironmentRegions == sTkRegions) gEnvironmentRegions = NULL;
        return;
    }
    if (base != NULL) {
        // the regions there before (the studio sea, boxes, other water), without our own old copies
        s32 count = base[0], k;
        static s16 sCopy[1 + MAX_TK_REGIONS * 6];
        if (count > MAX_TK_REGIONS - 4) count = MAX_TK_REGIONS - 4;
        memcpy(sCopy, base, (1 + count * 6) * sizeof(s16));
        for (k = 0; k < count; k++) {
            if (sCopy[1 + k * 6] != 50) {
                memcpy(&sTkRegions[1 + n * 6], &sCopy[1 + k * 6], 6 * sizeof(s16));
                n++;
            }
        }
    }
    for (i = 0; i < sCityCount; i++) {
        city_collision(sCityPos[i][0], sCityPos[i][1], sCityPos[i][2], TRUE, sTkRegions, &n, MAX_TK_REGIONS);
    }
    sTkRegions[0] = n;
    gEnvironmentRegions = sTkRegions;
#endif
}

#ifdef TK_DATA
// texture scrolling (canal water, cloud sea, LED tickers): Shoggoth's fx.c sh_update_scrolls
static void update_scrolls(void) {
    struct ShScroll *s;
    for (s = tokyo_scrolls; s->dl != NULL; s++) {
        s32 periodS = s->width << 2, periodT = s->height << 2;
        s32 uls = (s32) ((gGlobalTimer * s->speedS) >> 4) % periodS;
        s32 ult = (s32) ((gGlobalTimer * s->speedT) >> 4) % periodT;
        if (uls < 0) uls += periodS;
        if (ult < 0) ult += periodT;
        gDPSetTileSize(s->dl, G_TX_RENDERTILE, uls, ult, uls + periodS - 4, ult + periodT - 4);
    }
}
#endif

static struct Area *sLastArea;

void studio_tokyo_frame(void) {
#ifdef TK_DATA
    if (gCurrentArea != sLastArea) {
        sLastArea = gCurrentArea;
        sCitySigValid = FALSE;
        sCityCount = 0;
    }
    if (gCurrentArea == NULL) {
        return;
    }
    find_cities();
    if (sCityCount > 0 || sCitySigValid) {
        if (!sCitySigValid || city_sig() != sCitySig) {
            studio_rebuild_collision(); // calls studio_tokyo_add_surfaces / _apply_water
        }
    }
    if (sCityCount > 0) {
        update_scrolls();
    }
#endif
}

// ---------------------------------------------------------------------------------------------
// City life: one traffic cycle for the whole city (game frames): east-west green, yellow,
// scramble (every car waits, pedestrians cross in all directions), north-south green, yellow,
// scramble.

#define TRAFFIC_CYCLE   1200
#define TRAFFIC_HALF    600
#define TRAFFIC_GREEN   330
#define TRAFFIC_YELLOW  40
#define SCRAMBLE_START  (TRAFFIC_GREEN + TRAFFIC_YELLOW)
#define SCRAMBLE_FRAMES (TRAFFIC_HALF - SCRAMBLE_START)

#define oTkDist   OBJECT_FIELD_F32(0x1B)
#define oTkSpeed  OBJECT_FIELD_F32(0x1C)
#define oTkLane   OBJECT_FIELD_S32(0x1D)
#define oTkHalf   OBJECT_FIELD_F32(0x1E)
#define oTkHold   OBJECT_FIELD_S32(0x1F)
#define oTkStar   OBJECT_FIELD_S32(0x20)

// axis 0: traffic moving along x, 1: along z. Returns 0 green, 1 yellow, 2 red.
static s32 traffic_state(s32 axis) {
    s32 rel = (s32) (gGlobalTimer % TRAFFIC_CYCLE) - (axis == 0 ? 0 : TRAFFIC_HALF);
    if (rel >= 0 && rel < TRAFFIC_GREEN) return 0;
    if (rel >= TRAFFIC_GREEN && rel < SCRAMBLE_START) return 1;
    return 2;
}

// frames since the current scramble began, or -1 outside a scramble
static s32 scramble_elapsed(void) {
    s32 t = (s32) (gGlobalTimer % TRAFFIC_CYCLE) % TRAFFIC_HALF;
    return t >= SCRAMBLE_START ? t - SCRAMBLE_START : -1;
}

static const Collision *vehicle_collision(s32 index) {
#ifdef TK_DATA
    static const Collision *const table[] = {
        tokyo_taxi_collision, tokyo_kei_collision, tokyo_bus_collision, tokyo_train_collision,
        tokyo_boat_collision, tokyo_jib_collision, tokyo_lift_collision, tokyo_kei_truck_collision,
    };
    if (index >= 0 && index < (s32) ARRAY_COUNT(table)) return table[index];
#endif
    return NULL;
}

// half a vehicle's length (its collision's furthest vertex along z): where its bumper is
static f32 vehicle_half_length(const Collision *collision) {
    const s16 *col = (const s16 *) collision;
    f32 m = 0.0f;
    s32 i, n;
    if (col == NULL || col[0] != TERRAIN_LOAD_VERTICES) return 240.0f;
    n = col[1];
    for (i = 0; i < n; i++) {
        f32 z = ABS(col[2 + i * 3 + 2]);
        if (z > m) m = z;
    }
    return m > 0.0f ? m : 240.0f;
}

// a vehicle's collision from its model: the catalog entry decides the look, bparam1 the type
static void vehicle_init_collision(void) {
    o->collisionData = (void *) vehicle_collision((o->oBhvParams >> 24) & 0xFF);
    if (o->collisionData == NULL) o->collisionData = (void *) sTkNoCollision;
}

// ---- signals, screens, neon ---------------------------------------------------------------------
// bparam1: frames, bparam2: period (or speed), bparam3: phase (or axis), bparam4: mode
// (0 cycle, 1 neon flicker, 2 traffic light, 3 pedestrian signal, 4 spin, 5 roll)

void bhv_tk_prop_loop(void) {
    s32 frames = (o->oBhvParams >> 24) & 0xFF;
    s32 period = (o->oBhvParams >> 16) & 0xFF;
    s32 phase = (o->oBhvParams >> 8) & 0xFF;
    s32 t;
    switch (o->oBhvParams & 0xFF) {
        case 0:
            if (period == 0) period = 60;
            o->oAnimState = ((gGlobalTimer + phase * 8) / period) % (frames ? frames : 1);
            break;
        case 1:
            if (o->oTimer > 0 && o->oAction > 0) {
                o->oAnimState = (o->oTimer & 2) ? 1 : 0;
                if (o->oTimer >= o->oAction) {
                    o->oAction = 0;
                    o->oTimer = 0;
                }
            } else {
                o->oAnimState = 0;
                if (random_u16() < 90) {
                    o->oAction = 4 + (random_u16() & 7);
                    o->oTimer = 1;
                }
            }
            break;
        case 2:
            o->oAnimState = traffic_state(phase);
            break;
        case 3:
            t = scramble_elapsed();
            o->oAnimState = t >= 0 ? 0 : 1;
            if (t >= SCRAMBLE_FRAMES - 40 && (gGlobalTimer & 4)) o->oAnimState = 1; // blinks before the end
            break;
        case 4:
            o->oFaceAngleYaw += period * 16;
            break;
        case 5:
            o->oFaceAngleRoll += period * 16;
            break;
    }
}

// ---- cars ----------------------------------------------------------------------------------------
// bparam1: vehicle type (collision), bparam2: lane length / 100, bparam3: stop line distance / 100
// (0: no signal), bparam4: bit 0 signal axis (0 along x, 1 along z), bits 1-3 place in the queue
// (cars of one lane share their start), bits 4-7 cruise speed. They drive along their yaw.

void bhv_tk_car_init(void) {
    vehicle_init_collision();
    o->oTkHalf = vehicle_half_length(o->collisionData);
    o->oTkDist = -1900.0f * ((o->oBhvParams >> 1) & 7);
    o->oTkSpeed = 0.0f;
    o->oTkLane = ((s32) o->oHomeX / 50) * 1000 + ((s32) o->oHomeZ / 50) + o->oFaceAngleYaw;
    o->oPosX = o->oHomeX;
    o->oPosZ = o->oHomeZ;
}

static f32 car_gap_ahead(void) {
    f32 best = 100000.0f;
    struct ObjectNode *list = &gObjectLists[OBJ_LIST_SURFACE];
    struct Object *obj = (struct Object *) list->next;
    while (obj != (struct Object *) list) {
        if (obj != o && obj->behavior == o->behavior && obj->oTkLane == o->oTkLane
            && obj->oTkDist > o->oTkDist && obj->oTkDist - o->oTkDist < best) {
            best = obj->oTkDist - o->oTkDist;
        }
        obj = (struct Object *) obj->header.next;
    }
    return best;
}

void bhv_tk_car_loop(void) {
    f32 length = ((o->oBhvParams >> 16) & 0xFF) * 100.0f;
    f32 stop = ((o->oBhvParams >> 8) & 0xFF) * 100.0f;
    s32 axis = o->oBhvParams & 1;
    f32 cruise = (f32) ((o->oBhvParams >> 4) & 0xF) * 4.0f + 8.0f;
    f32 target = cruise, gap = car_gap_ahead();
    f32 dx = gMarioObject->oPosX - o->oPosX, dz = gMarioObject->oPosZ - o->oPosZ;
    f32 ahead = dx * sins(o->oFaceAngleYaw) + dz * coss(o->oFaceAngleYaw);
    f32 side = dx * coss(o->oFaceAngleYaw) - dz * sins(o->oFaceAngleYaw);

    if (length < 100.0f) length = 8000.0f;
    // red light: stop before the line
    if (stop > 0.0f && traffic_state(axis) != 0 && o->oTkDist < stop - 100.0f) {
        f32 left = stop - 150.0f - o->oTkDist;
        target = left < 40.0f ? 0.0f : MIN(cruise, left * 0.08f);
    }
    // keep distance to the car ahead
    if (gap < 1400.0f) target = MIN(target, MAX(0.0f, (gap - 750.0f) * 0.06f));
    // don't run Mario over: brake as he gets near the bumper, stand still just short of him
    if (ahead > 0.0f && ahead < o->oTkHalf + 700.0f && ABS(side) < 330.0f && gMarioObject->oPosY < o->oPosY + 250.0f) {
        target = MIN(target, MAX(0.0f, (ahead - o->oTkHalf - 120.0f) * 0.05f));
    }
    o->oTkSpeed = approach_f32(o->oTkSpeed, target, 0.9f, 1.6f);
    o->oTkDist += o->oTkSpeed;
    if (o->oTkDist > length) {
        o->oTkDist = 0.0f;
        o->oTkSpeed = cruise;
    }
    // riders are carried by oVel (apply_platform_displacement)
    o->oVelX = o->oHomeX + sins(o->oFaceAngleYaw) * o->oTkDist - o->oPosX;
    o->oVelZ = o->oHomeZ + coss(o->oFaceAngleYaw) * o->oTkDist - o->oPosZ;
    if (o->oVelX * o->oVelX + o->oVelZ * o->oVelZ > 400.0f * 400.0f) o->oVelX = o->oVelZ = 0.0f;
    o->oPosX = o->oHomeX + sins(o->oFaceAngleYaw) * o->oTkDist;
    o->oPosZ = o->oHomeZ + coss(o->oFaceAngleYaw) * o->oTkDist;
    load_object_collision_model();
}

// ---- the commuter train ------------------------------------------------------------------------
// bparam1: collision index, bparam2: line length / 100 (travels along +x), bparam3: dwell / 10 frames

void bhv_tk_train_init(void) {
    vehicle_init_collision();
    o->oTkDist = 0.0f;
    o->oTkSpeed = 0.0f;
    o->oAction = 0;
}

void bhv_tk_train_loop(void) {
    f32 length = ((o->oBhvParams >> 16) & 0xFF) * 100.0f;
    s32 dwell = ((o->oBhvParams >> 8) & 0xFF) * 10;
    f32 remaining;
    switch (o->oAction) {
        case 0: // waiting at the west station
        case 2: // waiting at the east terminus
            if (o->oTimer > dwell) {
                o->oAction++;
                cur_obj_play_sound_2(SOUND_GENERAL_BIG_CLOCK);
            }
            break;
        case 1:
        case 3:
            remaining = o->oAction == 1 ? length - o->oTkDist : o->oTkDist;
            if (remaining < o->oTkSpeed * o->oTkSpeed / (2.0f * 0.3f) + 10.0f) {
                o->oTkSpeed = MAX(1.5f, o->oTkSpeed - 0.3f);
            } else {
                o->oTkSpeed = MIN(24.0f, o->oTkSpeed + 0.3f);
            }
            o->oTkDist += o->oAction == 1 ? o->oTkSpeed : -o->oTkSpeed;
            cur_obj_play_sound_1(SOUND_ENV_ELEVATOR1);
            if (o->oTkDist >= length || o->oTkDist <= 0.0f) {
                o->oTkDist = o->oAction == 1 ? length : 0.0f;
                o->oTkSpeed = 0.0f;
                o->oAction = (o->oAction + 1) & 3;
            }
            break;
    }
    o->oVelX = o->oHomeX + o->oTkDist - o->oPosX;
    o->oPosX = o->oHomeX + o->oTkDist;
    load_object_collision_model();
}

// ---- glass lifts ----------------------------------------------------------------------------------
// bparam1: collision index, bparam2: rise / 20 (upwards from home), bparam3: run / 40 along its yaw.
// Step on it and it carries you to the other end (not back until you stepped off and on again);
// stand next to the end it isn't at and it comes to you.

#define TK_LIFT_SPEED 16.0f

void bhv_tk_lift_init(void) {
    vehicle_init_collision();
    o->oAction = 0;
    o->oTkDist = 0.0f;
}

static s32 lift_mario_near(f32 x, f32 z) {
    f32 dx = gMarioObject->oPosX - x, dz = gMarioObject->oPosZ - z;
    return dx * dx + dz * dz < 1100.0f * 1100.0f;
}

void bhv_tk_lift_loop(void) {
    f32 rise = ((o->oBhvParams >> 16) & 0xFF) * 20.0f;
    f32 run = ((o->oBhvParams >> 8) & 0xFF) * 40.0f;
    f32 len = sqrtf(rise * rise + run * run);
    f32 hx = sins(o->oFaceAngleYaw) * run, hz = coss(o->oFaceAngleYaw) * run;
    f32 topY = o->oHomeY + rise;
    s32 riding = gMarioObject->platform == o;
    s32 nearTop = lift_mario_near(o->oHomeX + hx, o->oHomeZ + hz) && gMarioObject->oPosY > topY - 200.0f;
    s32 nearBottom = lift_mario_near(o->oHomeX, o->oHomeZ) && gMarioObject->oPosY < o->oHomeY + 200.0f;
    f32 t, nx, ny, nz;

    if (len < 1.0f) {
        load_object_collision_model();
        return;
    }
    if (!riding) o->oTkHold = FALSE;
    if (o->oTkHold) o->oTimer = 0;
    switch (o->oAction) {
        case 0: // at the bottom
            if ((riding && o->oTimer > 20) || (!riding && nearTop)) {
                o->oAction = 1;
                cur_obj_play_sound_2(SOUND_GENERAL_ELEVATOR_MOVE_2);
            }
            break;
        case 1: // going up
            o->oTkDist = MIN(len, o->oTkDist + TK_LIFT_SPEED);
            cur_obj_play_sound_1(SOUND_ENV_ELEVATOR1);
            if (o->oTkDist >= len) {
                o->oAction = 2;
                o->oTkHold = riding;
                cur_obj_play_sound_2(SOUND_GENERAL_SOFT_LANDING);
            }
            break;
        case 2: // at the top
            if ((riding && o->oTimer > 20) || (!riding && nearBottom)) {
                o->oAction = 3;
                cur_obj_play_sound_2(SOUND_GENERAL_ELEVATOR_MOVE_2);
            }
            break;
        case 3: // going down
            o->oTkDist = MAX(0.0f, o->oTkDist - TK_LIFT_SPEED);
            cur_obj_play_sound_1(SOUND_ENV_ELEVATOR1);
            if (o->oTkDist <= 0.0f) {
                o->oAction = 0;
                o->oTkHold = riding;
                cur_obj_play_sound_2(SOUND_GENERAL_SOFT_LANDING);
            }
            break;
    }
    t = o->oTkDist / len;
    nx = o->oHomeX + hx * t;
    ny = o->oHomeY + rise * t;
    nz = o->oHomeZ + hz * t;
    o->oVelX = nx - o->oPosX;
    o->oVelY = ny - o->oPosY;
    o->oVelZ = nz - o->oPosZ;
    o->oPosX = nx;
    o->oPosY = ny;
    o->oPosZ = nz;
    load_object_collision_model();
    o->oDrawingDistance = 20000.0f;
}

// ---- canal boats ------------------------------------------------------------------------------------
// bparam1: collision index, bparam2: route length / 100 along the boat's yaw (slow ping-pong)

void bhv_tk_boat_init(void) {
    vehicle_init_collision();
}

void bhv_tk_boat_loop(void) {
    f32 length = ((o->oBhvParams >> 16) & 0xFF) * 100.0f;
    f32 s = (sins(o->oTimer * 40 + (s32) o->oHomeX) + 1.0f) * 0.5f;
    f32 nx, ny, nz;
    o->oTkDist = length * s;
    nx = o->oHomeX + sins(o->oFaceAngleYaw) * o->oTkDist;
    nz = o->oHomeZ + coss(o->oFaceAngleYaw) * o->oTkDist;
    ny = o->oHomeY + sins(o->oTimer * 900) * 8.0f;
    o->oVelX = nx - o->oPosX;
    o->oVelY = ny - o->oPosY;
    o->oVelZ = nz - o->oPosZ;
    o->oPosX = nx;
    o->oPosY = ny;
    o->oPosZ = nz;
    o->oFaceAngleRoll = sins(o->oTimer * 700) * 200.0f;
    load_object_collision_model();
}

// ---- the construction crane's jib ---------------------------------------------------------------
// bparam1: collision index. Turns 90 degrees, rests, turns back. A star hanging at its hook (any
// star placed within 600 units of it when the level starts) rides along.

#define JIB_HOOK_REACH 2650.0f
#define JIB_HOOK_DROP  260.0f

static struct Object *jib_star(void) {
    return o->oTkStar >= 0 && o->oTkStar < OBJECT_POOL_CAPACITY ? &gObjectPool[o->oTkStar] : NULL;
}

void bhv_tk_crane_jib_init(void) {
    vehicle_init_collision();
    o->oTkStar = -1;
    o->oAction = 0;
}

void bhv_tk_crane_jib_loop(void) {
    s32 cycle = o->oTimer % 1040; // swing 220 frames, rest 300, swing back, rest 300
    f32 hx, hz;
    struct Object *star;
    s32 i;

    hx = o->oPosX + sins(o->oFaceAngleYaw) * JIB_HOOK_REACH;
    hz = o->oPosZ + coss(o->oFaceAngleYaw) * JIB_HOOK_REACH;
    if (o->oAction < 3) {
        // the first frames: which star hangs at the hook (stars spawn in any order)
        o->oAction++;
        for (i = 0; i < OBJECT_POOL_CAPACITY && o->oTkStar < 0; i++) {
            struct Object *s = &gObjectPool[i];
            f32 dx = s->oPosX - hx, dz = s->oPosZ - hz, dy = s->oPosY - (o->oPosY - JIB_HOOK_DROP);
            if ((s->activeFlags & ACTIVE_FLAG_ACTIVE) && s->behavior == bhvStar && dx * dx + dz * dz < 600.0f * 600.0f
                && ABS(dy) < 900.0f) {
                o->oTkStar = i;
            }
        }
        o->oTimer = 0;
        return;
    }
    if (cycle < 220) {
        o->oAngleVelYaw = 0x48;
    } else if (cycle >= 520 && cycle < 740) {
        o->oAngleVelYaw = -0x48;
    } else {
        o->oAngleVelYaw = 0;
    }
    o->oFaceAngleYaw += o->oAngleVelYaw;
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    load_object_collision_model();
    o->oDrawingDistance = 20000.0f;
    star = jib_star();
    if (star != NULL) {
        if (!(star->activeFlags & ACTIVE_FLAG_ACTIVE) || star->behavior != bhvStar) {
            o->oTkStar = -1;
        } else {
            star->oPosX = o->oPosX + sins(o->oFaceAngleYaw) * JIB_HOOK_REACH;
            star->oPosZ = o->oPosZ + coss(o->oFaceAngleYaw) * JIB_HOOK_REACH;
            star->oHomeX = star->oPosX;
            star->oHomeZ = star->oPosZ;
        }
    }
}

// ---- petals and fireflies ---------------------------------------------------------------------------
// Emitter bparam1: radius / 20, bparam2: max particles, bparam3: 0 petals (fall), 1 fireflies (wander)

void bhv_tk_petal_emitter_loop(void) {
#ifdef TK_DATA
    struct Object *p;
    f32 radius = ((o->oBhvParams >> 24) & 0xFF) * 20.0f;
    s32 max = (o->oBhvParams >> 16) & 0xFF;
    s32 mode = (o->oBhvParams >> 8) & 0xFF;
    if (radius < 20.0f) radius = 600.0f;
    if (max == 0) max = 10;
    if (o->oDistanceToMario > 5000.0f || o->oAction >= max || (o->oTimer & 7)) return;
    p = spawn_object(o, MODEL_NONE, bhvTkPetal);
    if (p == NULL) return;
    p->header.gfx.sharedChild = studio_geo_node(mode == 0 ? tokyo_petal_geo : tokyo_firefly_geo);
    p->oPosX += (random_float() - 0.5f) * 2.0f * radius;
    p->oPosZ += (random_float() - 0.5f) * 2.0f * radius;
    p->oPosY += random_float() * 300.0f;
    p->oHomeX = p->oPosX;
    p->oHomeY = p->oPosY;
    p->oHomeZ = p->oPosZ;
    p->oBhvParams = o->oBhvParams & 0xFF00;
    p->parentObj = o;
    o->oAction++;
#endif
}

void bhv_tk_petal_loop(void) {
    s32 firefly = (o->oBhvParams >> 8) & 0xFF;
    if (!firefly) {
        o->oPosY -= 3.0f;
        o->oPosX += sins(o->oTimer * 600 + (s32) (o->oHomeZ * 7)) * 2.5f + 1.0f;
        o->oPosZ += coss(o->oTimer * 500 + (s32) (o->oHomeX * 5)) * 2.0f;
        o->oFaceAnglePitch += 0x500;
        o->oFaceAngleRoll += 0x380;
    } else {
        o->oPosY = o->oHomeY + sins(o->oTimer * 300) * 60.0f;
        o->oPosX += sins(o->oTimer * 210 + (s32) o->oHomeZ) * 3.0f;
        o->oPosZ += coss(o->oTimer * 170 + (s32) o->oHomeX) * 3.0f;
        obj_scale(o, 0.6f + 0.4f * sins(o->oTimer * 1500));
    }
    if (o->oTimer > (firefly ? 450 : 300) || o->oPosY < o->oHomeY - 700.0f) {
        if (o->parentObj != NULL && o->parentObj->oAction > 0) o->parentObj->oAction--;
        obj_mark_for_deletion(o);
    }
}

// a firefly: a speck of light drifting round its home, glowing up and fading, now and then out
void bhv_tk_firefly_init(void) {
    o->oTkLane = random_u16();
}

void bhv_tk_firefly_loop(void) {
    s32 s = o->oTkLane;
    s16 a = (s16) (gGlobalTimer * 170 + s);
    s16 b = (s16) (gGlobalTimer * 263 + s * 3);
    s16 p = (s16) (gGlobalTimer * 700 + s * 7);
    f32 k = 0.5f + 0.5f * sins(p);
    o->oPosX = o->oHomeX + sins(a) * 90.0f + sins(b) * 35.0f;
    o->oPosZ = o->oHomeZ + coss(a) * 70.0f + coss((s16) (b * 2)) * 30.0f;
    o->oPosY = o->oHomeY + sins(b) * 45.0f + sins((s16) (a * 3)) * 12.0f;
    if (((gGlobalTimer + (s & 0xFF)) & 0xFF) < 50) k = 0.0f; // out for a moment
    if (k < 0.08f) {
        cur_obj_hide();
    } else {
        cur_obj_unhide();
        cur_obj_scale(0.35f + 0.65f * k);
    }
}

// ---- the people of the scramble ---------------------------------------------------------------------
// Waits on its corner, then crosses when every signal shows WALK. bparam1: route (0 across the x axis,
// 1 across z, 2 diagonally; the far corner is the home mirrored through the crossing's centre, the
// level's origin), bparam2: frames after WALK it sets off. Anything else (bparam1 > 2): stands and
// looks at Mario when he comes close.

static void push_mario_out(f32 radius, f32 height) {
    struct MarioState *m = gMarioState;
    f32 dx, dz, d, x, z;
    if (m->pos[1] < o->oPosY - 60.0f || m->pos[1] > o->oPosY + height) return;
    dx = m->pos[0] - o->oPosX;
    dz = m->pos[2] - o->oPosZ;
    d = sqrtf(dx * dx + dz * dz);
    if (d >= radius) return;
    if (d < 1.0f) {
        dx = sins(m->faceAngle[1] + 0x8000);
        dz = coss(m->faceAngle[1] + 0x8000);
        d = 1.0f;
    }
    x = o->oPosX + dx / d * radius;
    z = o->oPosZ + dz / d * radius;
    if (find_floor_height(x, m->pos[1] + 100.0f, z) < -11000.0f + 100.0f) return; // never out over the void
    m->pos[0] = x;
    m->pos[2] = z;
    f32_find_wall_collision(&m->pos[0], &m->pos[1], &m->pos[2], 60.0f, 50.0f);
}

void bhv_tk_pedestrian_loop(void) {
    s32 route = (o->oBhvParams >> 24) & 0xFF;
    s32 delay = (o->oBhvParams >> 16) & 0xFF;
    s32 elapsed = scramble_elapsed();
    f32 tx = o->oHomeX, tz = o->oHomeZ, dx, dz, d;

    o->oOpacity = 255;
    push_mario_out(55.0f, 170.0f);
    if (route > 2) {
        cur_obj_init_animation(6);
        if (o->oDistanceToMario < 700.0f) cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x300);
        return;
    }
    if (o->oAction == 1) { // heading to the far corner
        tx = route != 1 ? -o->oHomeX : o->oHomeX;
        tz = route != 0 ? -o->oHomeZ : o->oHomeZ;
    }
    switch (o->oAction) {
        case 0: // waiting at home
        case 2: // waiting on the far side
            cur_obj_init_animation(6);
            o->oFaceAngleYaw = atan2s(-o->oPosZ, -o->oPosX); // face the crossing
            if (elapsed >= delay && elapsed < delay + 20) {
                o->oAction = o->oAction == 0 ? 1 : 3;
                // pace the walk so everyone is across before the lights change
                dx = (route != 1 ? -o->oHomeX : o->oHomeX) - o->oPosX;
                dz = (route != 0 ? -o->oHomeZ : o->oHomeZ) - o->oPosZ;
                o->oForwardVel = MAX(15.0f, sqrtf(dx * dx + dz * dz) / (f32) (SCRAMBLE_FRAMES - 30 - delay));
            }
            break;
        case 1:
        case 3:
            cur_obj_init_animation(7);
            dx = tx - o->oPosX;
            dz = tz - o->oPosZ;
            d = sqrtf(dx * dx + dz * dz);
            if (d < o->oForwardVel + 1.0f) {
                o->oPosX = tx;
                o->oPosZ = tz;
                o->oAction = o->oAction == 1 ? 2 : 0;
            } else {
                o->oPosX += dx / d * o->oForwardVel;
                o->oPosZ += dz / d * o->oForwardVel;
                o->oFaceAngleYaw = atan2s(dz, dx);
            }
            break;
    }
    o->oPosY = o->oHomeY;
}


// ---------------------------------------------------------------------------------------------
// The page asks before it plays a level song on a sound bank of its own (Tokyo's instruments are
// in the build only after the import): how many sound banks the engine has.

#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include "audio/internal.h"
extern ALSeqFile *gAlCtlHeader;

EMSCRIPTEN_KEEPALIVE
s32 studio_sound_bank_count(void) {
    return gAlCtlHeader != NULL ? gAlCtlHeader->seqCount : 0;
}
