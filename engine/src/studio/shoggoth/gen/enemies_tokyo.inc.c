// Copied from ../sm64-master/src/game/shoggoth/enemies_tokyo.c by tools/import_shoggoth_tokyo.mjs - do not edit.
/**
 * Tokyo's enemies (Shoggoth World). The Oni are the vanilla bhvGoomba wearing MODEL_TK_ONI /
 * MODEL_TK_AO_ONI (tools/shoggoth/courses/tk2/enemy_models.py). Here:
 *   Chochin-obake (bhvTkChochin) a paper lantern asleep among the shrine lane's and the yokocho's
 *       lanterns. Come close and its eye snaps open; it swells up and spits blue ghost fire, then
 *       drifts after Mario at head height. Jump on it or punch it: it pops into three coins.
 *   Kappa (bhvTkKappa) lurks in the canal with only the dish on its head showing, pops its head up,
 *       leaps onto the riverwalk in front of Mario, waddles after him and dives back in.
 *   Tanuki (bhvTkTanuki) sits disguised as a traffic cone, a post box or its own statue (the tail and
 *       the leaf give it away), poofs and runs when Mario comes close. Catch it: a blue coin.
 *
 * This is its own file (linked into the engine segment like all of src/game/shoggoth) rather than
 * part of obj_behaviors_2.c: the main segment has to stay under the 1 MB that IPL3 copies.
 */
#include <PR/ultratypes.h>

#include "sm64.h"
#include "audio/external.h"
#include "behavior_data.h"
#include "engine/behavior_script.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "game/behavior_actions.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/obj_behaviors_2.h"
#include "game/spawn_sound.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "model_ids.h"
#include "object_constants.h"
#include "object_fields.h"

#define o gCurrentObject

#define oTkYaw       OBJECT_FIELD_S32(0x1B)     // steering target
#define oTkScale     OBJECT_FIELD_F32(0x1C)     // puff / squash
#define oTkCooldown  OBJECT_FIELD_S32(0x1D)
#define oTkFromX     OBJECT_FIELD_F32(0x1E)     // leap start
#define oTkFromY     OBJECT_FIELD_F32(0x1F)
#define oTkFromZ     OBJECT_FIELD_F32(0x20)
#define oTkToX       OBJECT_FIELD_F32(0x21)     // leap end (its y in oTkToY)
#define oTkToZ       OBJECT_FIELD_F32(0x22)
#define oTkToY       oTkScale

#define TK_ACT_DYING 90                        // shared by the kappa and the tanuki

static f32 tk_clampf(f32 v, f32 lo, f32 hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

static void tk_approach(f32 *v, f32 target, f32 step) {
    *v = approach_f32_symmetric(*v, target, step);
}

/**
 * Reads (and clears) what Mario did to us this frame: 0 nothing, -1 we hurt him, else the attack.
 */
static s32 tk_check_hit(struct ObjectHitbox *hitbox) {
    s32 status = o->oInteractStatus;

    o->oInteractStatus = 0;
    obj_set_hitbox(o, hitbox);
    if (!(status & INT_STATUS_INTERACTED)) {
        return 0;
    }
    if (status & INT_STATUS_ATTACKED_MARIO) {
        return -1;
    }
    return status & INT_STATUS_ATTACK_MASK;
}

// the end: a puff, the loot (a blue coin when oNumLootCoins < 0), gone
static void tk_die(void) {
    spawn_mist_particles_with_sound(o->oDeathSound);
    if (o->oNumLootCoins < 0) {
        spawn_object(o, MODEL_BLUE_COIN, bhvSpawnedBlueCoin);
    } else {
        obj_spawn_loot_yellow_coins(o, o->oNumLootCoins, 20.0f);
    }
    obj_mark_for_deletion(o);
}

// stomped or ground-pounded: squashed flat; punched or kicked: sent tumbling
static void tk_begin_dying(s32 attack) {
    o->oAction = TK_ACT_DYING;
    o->oTkCooldown = attack == ATTACK_FROM_ABOVE || attack == ATTACK_GROUND_POUND_OR_TWIRL;
    o->oFaceAngleRoll = 0;
    o->oFaceAnglePitch = 0;
    cur_obj_become_intangible();
    if (o->oTkCooldown) {
        cur_obj_play_sound_2(SOUND_OBJ_STOMPED);
        o->oForwardVel = 0.0f;
    } else {
        o->oMoveAngleYaw = obj_angle_to_object(gMarioObject, o);
        o->oFaceAngleYaw = o->oMoveAngleYaw + 0x8000;
        o->oForwardVel = 32.0f;
        o->oVelY = 34.0f;
    }
}

static void tk_act_dying(void) {
    f32 sy;

    cur_obj_update_floor_and_walls();
    if (o->oTkCooldown) {
        sy = MAX(0.3f, 1.0f - o->oTimer * 0.14f);
        obj_scale_xyz(o, 2.0f - sy, sy, 2.0f - sy);
        if (o->oTimer > 15) {
            tk_die();
        }
    } else {
        o->oFaceAnglePitch += 0x1400;
        if (o->oTimer > 16 || (o->oTimer > 3 && (o->oMoveFlags & OBJ_MOVE_MASK_ON_GROUND))) {
            tk_die();
        }
    }
    cur_obj_move_standard(-78);
}

/* chochin-obake ------------------------------------------------------------------------------ */

static struct ObjectHitbox sTkChochinHitbox = {
    /* interactType:      */ INTERACT_BOUNCE_TOP,
    /* downOffset:        */ 62,
    /* damageOrCoinValue: */ 1,
    /* health:            */ 0,
    /* numLootCoins:      */ 3,
    /* radius:            */ 66,
    /* height:            */ 124,
    /* hurtboxRadius:     */ 54,
    /* hurtboxHeight:     */ 112,
};

enum TkChochinActions { TK_CHO_SLEEP, TK_CHO_WAKE, TK_CHO_HOVER, TK_CHO_SPIT, TK_CHO_RETURN };

#define TK_CHO_LEASH 1300.0f

// bparam1: the lantern (0 the white shrine-lane paper, 1 the red festival one). Home: where it floats.
void bhv_tk_chochin_init(void) {
    o->oTkScale = 1.0f;
    o->oDeathSound = SOUND_OBJ_ENEMY_DEATH_HIGH;
    obj_set_hitbox(o, &sTkChochinHitbox);
}

static void tk_chochin_drift_to(f32 tx, f32 ty, f32 tz, f32 speed, f32 yspeed) {
    f32 dx = tx - o->oPosX;
    f32 dz = tz - o->oPosZ;
    f32 d = sqrtf(dx * dx + dz * dz);

    if (d > speed) {
        o->oPosX += dx / d * speed;
        o->oPosZ += dz / d * speed;
    } else {
        o->oPosX = tx;
        o->oPosZ = tz;
    }
    tk_approach(&o->oPosY, ty, yspeed);
}

static void tk_chochin_pop(void) {
    struct Object *spark;
    s32 i;

    for (i = 0; i < 8; i++) {                      // blue ghost-fire sparks fly out
        spark = spawn_object(o, MODEL_BLUE_FLAME, bhvFlyguyFlame);
        spark->oMoveAngleYaw = i * 0x2000;
        spark->oForwardVel = 12.0f;
        spark->oVelY = 8.0f + (i & 3) * 4.0f;
        obj_scale(spark, 3.0f);
    }
    cur_obj_play_sound_2(SOUND_GENERAL_FLAME_OUT);
    tk_die();
}

void bhv_tk_chochin_loop(void) {
    s32 awake = TRUE;
    s32 hit;
    f32 marioY = gMarioObject->oPosY;
    f32 dx = o->oPosX - o->oHomeX;
    f32 dz = o->oPosZ - o->oHomeZ;
    f32 homeDist = sqrtf(dx * dx + dz * dz);
    f32 hoverY, mx, mz, k;

    switch (o->oAction) {
        case TK_CHO_SLEEP:             // bobbing and turning slowly, its eye shut
            awake = FALSE;
            tk_approach(&o->oTkScale, 1.0f, 0.02f);
            o->oPosY = o->oHomeY + sins(o->oTimer * 0x2C0) * 16.0f;
            o->oFaceAngleRoll = sins(o->oTimer * 0x1C0) * 0x480;
            o->oFaceAngleYaw += 0x60;
            if (o->oTkCooldown > 0) {
                o->oTkCooldown--;
            } else if (o->oDistanceToMario < 1100.0f && absf(marioY - o->oHomeY) < 700.0f) {
                o->oAction = TK_CHO_WAKE;
                cur_obj_play_sound_2(SOUND_OBJ_BOO_LAUGH_SHORT);
            }
            break;

        case TK_CHO_WAKE:              // the eye snaps open, it swells, turns to face Mario
            o->oFaceAngleYaw = approach_s16_symmetric(o->oFaceAngleYaw, o->oAngleToMario, 0xA00);
            o->oFaceAngleRoll = approach_s16_symmetric(o->oFaceAngleRoll, 0, 0x100);
            o->oTkScale = 1.0f + 0.28f * sins(o->oTimer * 0x600);
            if (o->oTimer >= 32) {
                o->oTkScale = 1.0f;
                o->oAction = TK_CHO_HOVER;
            }
            break;

        case TK_CHO_HOVER:             // drift after Mario at head height, bobbing and swaying
            hoverY = MAX(marioY + 120.0f, o->oHomeY - 120.0f) + sins(o->oTimer * 0x500) * 18.0f;
            hoverY = MIN(hoverY, o->oHomeY + 500.0f);
            mx = gMarioObject->oPosX - o->oHomeX;
            mz = gMarioObject->oPosZ - o->oHomeZ;
            k = sqrtf(mx * mx + mz * mz);
            k = k > TK_CHO_LEASH ? TK_CHO_LEASH / k : 1.0f;     // it keeps to its own street
            if (o->oDistanceToMario > 170.0f) {
                tk_chochin_drift_to(o->oHomeX + mx * k, hoverY, o->oHomeZ + mz * k, 5.0f, 4.0f);
            } else {
                tk_approach(&o->oPosY, hoverY, 4.0f);
            }
            o->oFaceAngleYaw = approach_s16_symmetric(o->oFaceAngleYaw, o->oAngleToMario, 0x400);
            o->oFaceAngleRoll = sins(o->oTimer * 0x380) * 0x700;
            tk_approach(&o->oTkScale, 1.0f, 0.03f);
            if (o->oTimer > 75 && o->oDistanceToMario < 1300.0f && o->oDistanceToMario > 260.0f) {
                o->oAction = TK_CHO_SPIT;
            } else if (o->oDistanceToMario > 2200.0f || homeDist > TK_CHO_LEASH + 400.0f) {
                o->oAction = TK_CHO_RETURN;
            }
            break;

        case TK_CHO_SPIT:              // the telegraph: a deep breath (swelling), then blue fire
            o->oFaceAngleYaw = approach_s16_symmetric(o->oFaceAngleYaw, o->oAngleToMario, 0x600);
            o->oFaceAngleRoll = approach_s16_symmetric(o->oFaceAngleRoll, 0, 0x200);
            if (o->oTimer < 24) {
                o->oTkScale = 1.0f + 0.32f * o->oTimer / 24.0f;
                o->oFaceAnglePitch = -0x40 * o->oTimer;
            } else if (o->oTimer == 24) {
                dx = gMarioObject->oPosX - o->oPosX;
                dz = gMarioObject->oPosZ - o->oPosZ;
                o->oMoveAngleYaw = o->oFaceAngleYaw;
                obj_spit_fire(0, -20, 60, 3.0f, MODEL_BLUE_FLAME, 26.0f, 14.0f,
                              atan2s(sqrtf(dx * dx + dz * dz), o->oPosY - (marioY + 50.0f)));
                cur_obj_play_sound_2(SOUND_OBJ_FLAME_BLOWN);
                o->oTkScale = 0.8f;
                o->oFaceAnglePitch = 0x800;
            } else {
                tk_approach(&o->oTkScale, 1.0f, 0.02f);
                o->oFaceAnglePitch = approach_s16_symmetric(o->oFaceAnglePitch, 0, 0x100);
                if (o->oTimer > 50) {
                    o->oAction = TK_CHO_HOVER;
                }
            }
            break;

        case TK_CHO_RETURN:            // float home and nod off again
            awake = o->oTimer < 40;
            o->oFaceAnglePitch = approach_s16_symmetric(o->oFaceAnglePitch, 0, 0x100);
            tk_approach(&o->oTkScale, 1.0f, 0.03f);
            tk_chochin_drift_to(o->oHomeX, o->oHomeY, o->oHomeZ, 9.0f, 6.0f);
            if (homeDist < 12.0f && absf(o->oPosY - o->oHomeY) < 10.0f) {
                o->oAction = TK_CHO_SLEEP;
                o->oTkCooldown = 70;
            }
            break;
    }

    o->oAnimState = ((o->oBhvParams >> 24) & 1) * 2 + awake;
    obj_scale_xyz(o, o->oTkScale, 1.0f + (o->oTkScale - 1.0f) * 0.6f, o->oTkScale);
    hit = tk_check_hit(&sTkChochinHitbox);
    if (hit > 0) {
        tk_chochin_pop();                         // popped: blue sparks, a puff, three coins
    } else if (hit < 0) {
        o->oAction = TK_CHO_RETURN;               // it got Mario: back off for a while
    }
}

/* kappa --------------------------------------------------------------------------------------- */

static struct ObjectHitbox sTkKappaHitbox = {
    /* interactType:      */ INTERACT_BOUNCE_TOP,
    /* downOffset:        */ 0,
    /* damageOrCoinValue: */ 1,
    /* health:            */ 0,
    /* numLootCoins:      */ 3,
    /* radius:            */ 62,
    /* height:            */ 130,
    /* hurtboxRadius:     */ 50,
    /* hurtboxHeight:     */ 120,
};

enum TkKappaActions { TK_KAPPA_LURK, TK_KAPPA_RISE, TK_KAPPA_LEAP, TK_KAPPA_WALK, TK_KAPPA_DIVE };

#define TK_KAPPA_DEPTH 124.0f     // lurking: only the dish (its top 131.5 above the feet) shows

// Home: a point on the canal's water surface. bparam1..4: z of the north quay wall, the north water
// edge, the south water edge and the south quay wall, / 100 (the riverwalks lie between them).
void bhv_tk_kappa_init(void) {
    obj_set_hitbox(o, &sTkKappaHitbox);
    o->oDeathSound = SOUND_OBJ_DYING_ENEMY1;
    o->oPosY = o->oHomeY - TK_KAPPA_DEPTH;
    cur_obj_become_intangible();
}

static void tk_kappa_splash(void) {
    struct Object *splash = spawn_object(o, MODEL_WATER_SPLASH, bhvWaterSplash);

    splash->oPosY = o->oHomeY;
    cur_obj_play_sound_2(SOUND_OBJ_DIVING_INTO_WATER);
}

static void tk_kappa_leap_to(f32 x, f32 y, f32 z, s32 action) {
    o->oTkFromX = o->oPosX;
    o->oTkFromY = o->oPosY;
    o->oTkFromZ = o->oPosZ;
    o->oTkToX = x;
    o->oTkToY = y;
    o->oTkToZ = z;
    o->oAction = action;
    o->oMoveAngleYaw = atan2s(z - o->oPosZ, x - o->oPosX);
}

// follows the arc; TRUE on arrival
static s32 tk_kappa_arc(s32 frames, f32 height) {
    f32 t = MIN(1.0f, (o->oTimer + 1) / (f32) frames);

    o->oPosX = o->oTkFromX + (o->oTkToX - o->oTkFromX) * t;
    o->oPosZ = o->oTkFromZ + (o->oTkToZ - o->oTkFromZ) * t;
    o->oPosY = o->oTkFromY + (o->oTkToY - o->oTkFromY) * t + 4.0f * height * t * (1.0f - t);
    o->oFaceAnglePitch = (s16) (0x1800 * (0.5f - t));
    o->oVelY = o->oForwardVel = 0.0f;
    return t >= 1.0f;
}

static s32 tk_mario_on_riverwalk(void) {
    f32 y = gMarioObject->oPosY;

    // on the walk or jumping above it (the street is 720 up: climbing the stairs is leaving)
    return y > o->oHomeY + 40.0f && y < o->oHomeY + 600.0f && !(gMarioStates[0].action & ACT_FLAG_SWIMMING);
}

void bhv_tk_kappa_loop(void) {
    f32 zmid = (((o->oBhvParams >> 16) & 0xFF) + ((o->oBhvParams >> 8) & 0xFF)) * 50.0f;
    f32 tx, tz, dx, dz, d, floorY;
    struct Surface *floor;
    s32 hit;

    if (o->oAction == TK_ACT_DYING) {
        tk_act_dying();
        return;
    }
    switch (o->oAction) {
        case TK_KAPPA_LURK:            // only the dish shows, bobbing, drifting along the canal
            cur_obj_become_intangible();
            o->oFaceAnglePitch = 0;
            o->oFaceAngleRoll = sins(o->oTimer * 0x300) * 0x300;
            tk_approach(&o->oPosX, o->oHomeX + sins(o->oTimer * 0x50) * 260.0f, 3.0f);
            tk_approach(&o->oPosZ, o->oHomeZ, 3.0f);
            o->oPosY = o->oHomeY - TK_KAPPA_DEPTH + sins(o->oTimer * 0x400) * 3.0f;
            o->oMoveAngleYaw = approach_s16_symmetric(o->oMoveAngleYaw, coss(o->oTimer * 0x50) > 0 ? 0x4000 : -0x4000,
                                                      0x200);
            if (o->oTkCooldown > 0) {
                o->oTkCooldown--;
            } else if (o->oDistanceToMario < 1000.0f && tk_mario_on_riverwalk()) {
                o->oAction = TK_KAPPA_RISE;
                tk_kappa_splash();
            }
            break;

        case TK_KAPPA_RISE:            // the head pops out and stares at Mario (the telegraph)
            tk_approach(&o->oPosY, o->oHomeY - 55.0f, 6.0f);
            cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x800);
            o->oFaceAngleRoll = sins(o->oTimer * 0x1000) * 0x600;
            if (o->oTimer == 12) {
                cur_obj_play_sound_2(SOUND_OBJ_UKIKI_CHATTER_SHORT);
            }
            if (o->oTimer >= 26) {
                // land in front of Mario on his riverwalk, never on top of him
                dx = gMarioObject->oPosX - o->oPosX;
                dz = gMarioObject->oPosZ - o->oPosZ;
                d = MAX(1.0f, sqrtf(dx * dx + dz * dz));
                if (d > 920.0f) {
                    tx = o->oPosX + dx / d * 750.0f;
                    tz = o->oPosZ + dz / d * 750.0f;
                } else {
                    tx = gMarioObject->oPosX - dx / d * 170.0f;
                    tz = gMarioObject->oPosZ - dz / d * 170.0f;
                }
                if (gMarioObject->oPosZ < zmid) {
                    tz = tk_clampf(tz, ((o->oBhvParams >> 24) & 0xFF) * 100.0f + 90.0f,
                                   ((o->oBhvParams >> 16) & 0xFF) * 100.0f - 90.0f);
                } else {
                    tz = tk_clampf(tz, ((o->oBhvParams >> 8) & 0xFF) * 100.0f + 90.0f,
                                   (o->oBhvParams & 0xFF) * 100.0f - 90.0f);
                }
                floorY = find_floor(tx, gMarioObject->oPosY + 150.0f, tz, &floor);
                if (floor != NULL && floorY > o->oHomeY + 20.0f && floorY < o->oHomeY + 320.0f) {
                    tk_kappa_leap_to(tx, floorY, tz, TK_KAPPA_LEAP);
                    tk_kappa_splash();
                    cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
                } else {
                    o->oAction = TK_KAPPA_LURK;
                    o->oTkCooldown = 60;
                }
            }
            break;

        case TK_KAPPA_LEAP:            // out of the water in a high arc
            cur_obj_become_tangible();
            o->oFaceAngleRoll = 0;
            if (tk_kappa_arc(26, 260.0f)) {
                o->oFaceAnglePitch = 0;
                o->oAction = TK_KAPPA_WALK;
                o->oMoveAngleYaw = o->oAngleToMario;
                cur_obj_play_sound_2(SOUND_OBJ_UKIKI_STEP_DEFAULT);
            }
            break;

        case TK_KAPPA_WALK:            // waddle after Mario, then back to the water
            cur_obj_update_floor_and_walls();
            cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x300);
            o->oForwardVel = o->oDistanceToMario > 120.0f ? 9.0f : 3.0f;
            o->oFaceAngleRoll = sins(o->oTimer * 0x1400) * 0xA00;
            if ((o->oTimer % 11) == 0) {
                cur_obj_play_sound_2(SOUND_OBJ_UKIKI_STEP_DEFAULT);
            }
            cur_obj_move_standard(-78);
            if (o->oTimer > 170 || o->oDistanceToMario > 1500.0f || o->oPosY > o->oHomeY + 330.0f
                || !tk_mario_on_riverwalk()) {
                tz = zmid + (o->oPosZ < zmid ? -250.0f : 250.0f);
                tk_kappa_leap_to(o->oPosX, o->oHomeY - TK_KAPPA_DEPTH, tz, TK_KAPPA_DIVE);
                cur_obj_become_intangible();
            }
            break;

        case TK_KAPPA_DIVE:            // a hop back into the canal
            if (tk_kappa_arc(24, 160.0f)) {
                o->oAction = TK_KAPPA_LURK;
                o->oTkCooldown = 90;
                tk_kappa_splash();
            }
            break;
    }

    hit = tk_check_hit(&sTkKappaHitbox);
    if (hit > 0 && (o->oAction == TK_KAPPA_LEAP || o->oAction == TK_KAPPA_WALK)) {
        tk_begin_dying(hit);                      // the water in its dish spills: a kappa's undoing
        spawn_object_relative(0, 0, 130, 0, o, MODEL_WATER_SPLASH, bhvWaterSplash);
        cur_obj_play_sound_2(SOUND_OBJ_DIVING_INTO_WATER);
    }
}

/* tanuki -------------------------------------------------------------------------------------- */

static struct ObjectHitbox sTkTanukiHitbox = {
    /* interactType:      */ INTERACT_BOUNCE_TOP,
    /* downOffset:        */ 0,
    /* damageOrCoinValue: */ 0,           // bumping into it only pushes Mario back
    /* health:            */ 0,
    /* numLootCoins:      */ 0,
    /* radius:            */ 64,
    /* height:            */ 110,
    /* hurtboxRadius:     */ 50,
    /* hurtboxHeight:     */ 100,
};

enum TkTanukiActions { TK_TAN_HIDE, TK_TAN_REVEAL, TK_TAN_FLEE };

#define TK_TAN_LEASH 1500.0f

// bparam1: the disguise (1 traffic cone, 2 post box, 3 its own statue). Catch it: a blue coin.
void bhv_tk_tanuki_init(void) {
    obj_set_hitbox(o, &sTkTanukiHitbox);
    o->oNumLootCoins = -1;
    o->oDeathSound = SOUND_OBJ_UKIKI_CHATTER_LONG;
    cur_obj_become_intangible();
}

static void tk_tanuki_poof(void) {
    spawn_mist_particles_variable(0, 40, 46.0f);
    cur_obj_play_sound_2(SOUND_OBJ_UKIKI_CHATTER_LONG);
}

void bhv_tk_tanuki_loop(void) {
    f32 dx = o->oPosX - o->oHomeX;
    f32 dz = o->oPosZ - o->oHomeZ;
    s32 hit;

    if (o->oAction == TK_ACT_DYING) {
        tk_act_dying();
        return;
    }
    cur_obj_update_floor_and_walls();
    switch (o->oAction) {
        case TK_TAN_HIDE:              // stock still -- but every few seconds the tail twitches
            cur_obj_become_intangible();
            o->oAnimState = (o->oBhvParams >> 24) & 3;
            o->oForwardVel = 0.0f;
            o->oFaceAngleRoll = (o->oTimer % 150) < 16 ? sins(o->oTimer * 0x2000) * 0x500 : 0;
            if (o->oTkCooldown > 0) {
                o->oTkCooldown--;
            } else if ((o->oDistanceToMario < 420.0f && absf(gMarioObject->oPosY - o->oPosY) < 260.0f)
                       || (o->oDistanceToMario < 520.0f && (gMarioStates[0].action & ACT_FLAG_ATTACKING))) {
                o->oAction = TK_TAN_REVEAL;
            }
            break;

        case TK_TAN_REVEAL:            // poof! a hop, a cheeky chatter, and off it goes
            if (o->oTimer == 0) {
                tk_tanuki_poof();
                o->oAnimState = 0;
                o->oVelY = 34.0f;
                o->oFaceAngleRoll = 0;
                o->oMoveAngleYaw = o->oAngleToMario + 0x8000;
                cur_obj_become_tangible();
            }
            o->oForwardVel = 4.0f;
            if (o->oTimer > 14 && (o->oMoveFlags & OBJ_MOVE_MASK_ON_GROUND)) {
                o->oAction = TK_TAN_FLEE;
                o->oTkYaw = o->oMoveAngleYaw;
            }
            break;

        case TK_TAN_FLEE:              // run! zig-zagging, hopping, never far from home
            if (o->oMoveFlags & OBJ_MOVE_HIT_WALL) {
                o->oTkYaw = cur_obj_reflect_move_angle_off_wall();
                o->oTkCooldown = 20;
            } else if (o->oMoveFlags & OBJ_MOVE_HIT_EDGE) {
                o->oTkYaw = o->oMoveAngleYaw + 0x8000;
                o->oTkCooldown = 20;
            } else if (o->oTkCooldown > 0) {
                o->oTkCooldown--;               // still turning away from a wall
            } else if (dx * dx + dz * dz > TK_TAN_LEASH * TK_TAN_LEASH) {
                o->oTkYaw = atan2s(-dz, -dx);
            } else {
                o->oTkYaw = o->oAngleToMario + 0x8000 + (s16) (sins(o->oTimer * 0x500) * 0x2000);
            }
            cur_obj_rotate_yaw_toward(o->oTkYaw, 0xC00);
            o->oForwardVel = o->oDistanceToMario < 900.0f ? 21.0f : 12.0f;
            if ((o->oTimer % 40) == 20 && (o->oMoveFlags & OBJ_MOVE_MASK_ON_GROUND)) {
                o->oVelY = 18.0f;
            }
            if ((o->oTimer % 70) == 35) {
                cur_obj_play_sound_2(SOUND_OBJ_UKIKI_CHATTER_SHORT);
            }
            o->oFaceAngleRoll = sins(o->oTimer * 0x1800) * 0x600;
            if ((o->oTimer > 420 && o->oDistanceToMario > 700.0f) || o->oDistanceToMario > 2600.0f
                || o->oTimer > 900) {
                tk_tanuki_poof();           // gone to ground again: a disguise wherever it stands
                o->oAction = TK_TAN_HIDE;
                o->oTkCooldown = 90;
            }
            break;
    }
    cur_obj_move_standard(-78);

    hit = tk_check_hit(&sTkTanukiHitbox);
    if (hit > 0 && o->oAction != TK_TAN_HIDE) {
        tk_begin_dying(hit);                      // caught! a puff and a blue coin
    }
}
