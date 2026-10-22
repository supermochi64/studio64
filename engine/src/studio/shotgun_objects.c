/**
 * The placeable objects of Shotgun Mario (studio/shotgun.c), ported from Shoggoth World's hood
 * (src/game/shoggoth/overlay/hood.c):
 *   bhvStudioShotgun         the shotgun lying in the level: it floats and turns, walking into it arms Mario
 *   bhvStudioGangster        a gangsta Goomba (3 looks): hangs out, notices Mario, strafes and fires bursts
 *                            at him (a few gangsters at a time, only with a clear line of sight); one blast,
 *                            stomp or punch puts him down (blown back along the shot, or squashed)
 *   bhvStudioGangsterBullet  their tracer rounds (1 damage)
 * The hood's manager (the shout, the star when the block is clear) is left to the studio's story
 * events: "An object is defeated" on the gangsters, "Give a star".
 * Models: studio/shotgun/models.inc.c (tools/shotgun_extract.py from the hood's generated data).
 */
#include <ultra64.h>
#include <math.h>

#include "sm64.h"
#include "types.h"
#include "geo_commands.h"
#include "object_constants.h"
#include "object_fields.h"
#include "audio_defines.h"
#include "engine/behavior_script.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "game/object_list_processor.h"
#include "game/interaction.h"
#include "game/behavior_actions.h"
#include "game/object_helpers.h"
#include "game/obj_behaviors.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/spawn_sound.h"
#include "game/game_init.h"
#include "audio/external.h"
#include "behavior_data.h"
#include "actors/common0.h"
#include "studio.h"
#include "shotgun.h"
#include "shotgun_models.h"
#ifndef SG_STUB
#include "shotgun/models.inc.c"
#else
// no Shoggoth World models (shotgun_models.h): empty stand-ins, blank 32x32 effect textures
const Gfx sg_sg_body_dl_opaque[] = { gsSPEndDisplayList() };
const Gfx sg_sg_pump_dl_opaque[] = { gsSPEndDisplayList() };
const Gfx sg_shotgun_dl_opaque[] = { gsSPEndDisplayList() };
ALIGNED8 const u8 sg_tex_sg_hole[32 * 32 * 2] = { 0 };
ALIGNED8 const u8 sg_tex_sg_smoke[32 * 32 * 2] = { 0 };
ALIGNED8 const u8 sg_tex_sg_star[32 * 32 * 2] = { 0 };
const GeoLayout sg_shotgun_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sg_gangster0_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sg_gangster1_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sg_gangster2_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sg_hood_bullet_geo[] = { GEO_NODE_START(), GEO_END() };
#endif

#define o gCurrentObject

struct GraphNode *studio_geo_node(const GeoLayout *geo);   // (studio.c)
#include "shotgun_bhv.h"

// ------------------------------------------------------------------------------------ the pickup
/**
 * The shotgun in the level: it floats and turns until Mario walks into it, and then he is Shotgun
 * Mario until he leaves the level. (Already armed, he walks past it.)
 */
void bhv_studio_shotgun_loop(void) {
    o->oFaceAngleYaw += 0x280;
    o->oGraphYOffset = 24.0f + sins(o->oTimer * 0x600) * 8.0f;
    if (studio_shotgun_has()) {
        return;
    }
    if (o->oDistanceToMario < 150.0f && gMarioState->pos[1] < o->oPosY + 160.0f
        && gMarioState->pos[1] > o->oPosY - 100.0f) {
        studio_shotgun_picked_up();
        play_sound(SOUND_GENERAL_COLLECT_1UP, gDefaultSoundArgs);
        obj_mark_for_deletion(o);
    }
}

// --------------------------------------------------------------------------------- the gangsters
enum { HD_G_IDLE, HD_G_ALERT, HD_G_COMBAT, HD_G_AIM, HD_G_DOWN };

#define HD_G_SCALE 1.8f
#define HD_G_RANGE 3000.0f              // they open fire inside this distance
#define HD_G_NOTICE 1800.0f             // ... and notice Mario inside this one (or when one of them does)
#define HD_G_LEASH 700.0f               // ground gangsters stay this close to their spot
#define HD_MAX_SHOOTERS 3               // gangsters aiming at once
#define HD_GRACE 45                     // frames after noticing him before the first shot

#define oHdShootTimer OBJECT_FIELD_S32(0x1B)
#define oHdStrafe     OBJECT_FIELD_S32(0x1C)
#define oHdShots      OBJECT_FIELD_S32(0x1D)
#define oHdBlink      OBJECT_FIELD_S32(0x1F)
#define oHdAiming     OBJECT_FIELD_S32(0x20)
#define oHdSquished   OBJECT_FIELD_S32(0x21)
#define oHdSafeX      OBJECT_FIELD_F32(0x1E)   // the last spot he stood on (hd_stay_on_ground)
#define oHdSafeZ      OBJECT_FIELD_F32(0x22)

static s16 sHdShooters;                 // gangsters aiming or firing right now
static u32 sHdShooterFrame;             // (recounted when a level's gangsters start over)
static u32 sHdAlertFrame;               // the last frame a gangster raised the alarm
static f32 sHdAlertPos[3];

static struct ObjectHitbox sHdGangsterHitbox = {
    /* interactType:      */ INTERACT_BOUNCE_TOP,
    /* downOffset:        */ 0,
    /* damageOrCoinValue: */ 1,
    /* health:            */ 1,
    /* numLootCoins:      */ 2,
    /* radius:            */ 72,
    /* height:            */ 50,
    /* hurtboxRadius:     */ 42,
    /* hurtboxHeight:     */ 40,
};

static f32 hd_sqr(f32 x) {
    return x * x;
}

static s32 hd_on_ground(void) {
    return (o->oMoveFlags & OBJ_MOVE_MASK_ON_GROUND) != 0;
}

static s32 hd_elevated(void) {
    // on a roof, a ledge or a fire escape (a drop beside him): they hold their spot and shoot from there
    struct Surface *floor;
    s32 i;

    for (i = 0; i < 8; i++) {
        f32 x = o->oHomeX + sins(i * 0x2000) * 260.0f, z = o->oHomeZ + coss(i * 0x2000) * 260.0f;
        f32 y = find_floor(x, o->oHomeY + 100.0f, z, &floor);
        if (floor == NULL || y < o->oHomeY - 300.0f) {
            return TRUE;
        }
    }
    return FALSE;
}

// Is there ground at (x, z) no more than `drop` below his feet?
static s32 hd_ground_at(f32 x, f32 z, f32 drop) {
    struct Surface *floor;
    f32 y = find_floor(x, o->oPosY + 100.0f, z, &floor);
    return floor != NULL && y > o->oPosY - drop;
}

/**
 * Gangsters never leave their ground (like the Sunshine Piantas, sms_stay_on_ground): no walking,
 * strafing or backing off a ledge, checked a step ahead; and whatever else moved him over the edge
 * (a wall pushing him out at the rim of a level, the alarm jump, another object), a gangster who
 * lost the ground under his feet is put back on the last spot he stood on.
 */
static void hd_stay_on_ground(void) {
    if (o->oForwardVel > 0.0f
        && !hd_ground_at(o->oPosX + sins(o->oMoveAngleYaw) * 80.0f, o->oPosZ + coss(o->oMoveAngleYaw) * 80.0f, 150.0f)) {
        o->oForwardVel = 0.0f;
        o->oVelX = o->oVelZ = 0.0f;
        o->oHdStrafe ^= 1;
    }
}

static void hd_keep_safe_spot(void) {
    if (hd_ground_at(o->oPosX, o->oPosZ, 150.0f)) {
        if (hd_on_ground()) {
            o->oHdSafeX = o->oPosX;
            o->oHdSafeZ = o->oPosZ;
        }
        return;
    }
    // over the edge: back to where he stood (the drop below is the void or a cliff)
    o->oPosX = o->oHdSafeX;
    o->oPosZ = o->oHdSafeZ;
    o->oForwardVel = 0.0f;
    o->oVelX = o->oVelZ = 0.0f;
    o->oHdStrafe ^= 1;
}

static void hd_face_mario(s16 speed) {
    cur_obj_rotate_yaw_toward(o->oAngleToMario, speed);
    o->oFaceAngleYaw = o->oMoveAngleYaw;
}

// (obj_behaviors_2.c keeps these to itself)
static void hd_update_blinking(s32 *blinkTimer, s16 base, s16 range, s16 length) {
    if (*blinkTimer != 0) {
        *blinkTimer -= 1;
    } else {
        *blinkTimer = base + (s16) (range * random_float());
    }
    o->oAnimState = (*blinkTimer > length) ? 0 : 1;
}

static void hd_sound_at_anim_range(s8 a, s8 b, u32 sound) {
    s32 rate = o->header.gfx.unk38.animAccel / 0x10000;
    if (rate <= 0) {
        rate = 1;
    }
    if (cur_obj_check_anim_frame_in_range(a, rate) || cur_obj_check_anim_frame_in_range(b, rate)) {
        cur_obj_play_sound_2(sound);
    }
}

static s32 hd_attacked(void) {
    u32 st = o->oInteractStatus;
    s32 attack = 0;

    if (st & INT_STATUS_INTERACTED) {
        if (st & INT_STATUS_WAS_ATTACKED) {
            attack = st & INT_STATUS_ATTACK_MASK;
            if (attack == 0) {
                attack = ATTACK_FAST_ATTACK;
            }
        }
    }
    o->oInteractStatus = 0;
    return attack;
}

/**
 * Can this gangster see Mario (nothing static in between, gun height to Mario's chest)?
 */
static s32 hd_sees_mario(void) {
    Vec3f from, to;
    f32 dist;

    from[0] = o->oPosX;
    from[1] = o->oPosY + 60.0f;
    from[2] = o->oPosZ;
    to[0] = gMarioState->pos[0];
    to[1] = gMarioState->pos[1] + 80.0f;
    to[2] = gMarioState->pos[2];
    dist = sqrtf(hd_sqr(to[0] - from[0]) + hd_sqr(to[1] - from[1]) + hd_sqr(to[2] - from[2]));
    return studio_shotgun_ray_clear(from, to) >= dist - 40.0f;
}

static void hd_fire(void) {
    struct Object *bullet;
    f32 dx, dy, dz, len, miss;

    // a little lead and a miss that grows with the distance: they're gangsters, not snipers
    miss = 25.0f + o->oDistanceToMario * 0.04f;
    dx = gMarioState->pos[0] + gMarioState->vel[0] * 8.0f + (random_float() - 0.5f) * 2.0f * miss - o->oPosX;
    dy = gMarioState->pos[1] + 80.0f + (random_float() - 0.5f) * miss - (o->oPosY + 60.0f);
    dz = gMarioState->pos[2] + gMarioState->vel[2] * 8.0f + (random_float() - 0.5f) * 2.0f * miss - o->oPosZ;
    len = sqrtf(dx * dx + dy * dy + dz * dz);
    if (len < 1.0f) {
        return;
    }
    bullet = spawn_object(o, MODEL_NONE, bhvStudioGangsterBullet);
    if (bullet == NULL) {
        return;
    }
    bullet->header.gfx.sharedChild = studio_geo_node(sg_hood_bullet_geo);
    bullet->oPosX += sins(o->oFaceAngleYaw) * 70.0f;
    bullet->oPosY += 60.0f;
    bullet->oPosZ += coss(o->oFaceAngleYaw) * 70.0f;
    bullet->oVelX = dx / len * 60.0f;
    bullet->oVelY = dy / len * 60.0f;
    bullet->oVelZ = dz / len * 60.0f;
    cur_obj_play_sound_2(SOUND_GENERAL_RACE_GUN_SHOT);
}

static void hd_raise_alarm(void) {
    sHdAlertFrame = gGlobalTimer;
    sHdAlertPos[0] = o->oPosX;
    sHdAlertPos[1] = o->oPosY;
    sHdAlertPos[2] = o->oPosZ;
}

static void hd_gangster_idle(void) {
    // hanging out: bobbing to the music, keeping an eye on the stranger
    cur_obj_init_animation_with_accel_and_sound(0, 0.6f);
    hd_face_mario(0x100);
    o->oForwardVel = 0.0f;
    cur_obj_update_floor_and_walls();
    cur_obj_move_standard(-78);
    if (gMarioState->action == ACT_DISAPPEARED) {
        return;
    }
    if (o->oDistanceToMario < HD_G_NOTICE && hd_sees_mario()) {
        hd_raise_alarm();
        o->oAction = HD_G_ALERT;
    } else if (gGlobalTimer - sHdAlertFrame < 4 && hd_sqr(o->oPosX - sHdAlertPos[0]) + hd_sqr(o->oPosZ - sHdAlertPos[2]) < hd_sqr(3000.0f)) {
        o->oHdShootTimer = HD_GRACE + (random_u16() % 60);
        o->oAction = HD_G_COMBAT;
    }
}

static void hd_gangster_alert(void) {
    // "Hey! Who let a plumber in here?" -- a jump and a shout, then the block opens fire
    cur_obj_init_animation_with_accel_and_sound(0, 2.0f);
    hd_face_mario(0x800);
    if (o->oTimer == 0) {
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
        o->oVelY = 30.0f;
    }
    cur_obj_update_floor_and_walls();
    cur_obj_move_standard(-78);
    hd_raise_alarm();
    if (o->oTimer > 20) {
        o->oHdShootTimer = HD_GRACE;
        o->oAction = HD_G_COMBAT;
    }
}

static void hd_gangster_combat(void) {
    f32 dist = o->oDistanceToMario;
    f32 fromHome = sqrtf(hd_sqr(o->oPosX - o->oHomeX) + hd_sqr(o->oPosZ - o->oHomeZ));
    s32 elevated = o->oHdStrafe & 2;
    s16 yaw;

    hd_face_mario(0x600);
    if (elevated) {
        o->oForwardVel = 0.0f;
        cur_obj_init_animation_with_accel_and_sound(0, 0.8f);
    } else {
        // keep a shooting distance: close in when far, back off when close, strafe in between
        if (fromHome > HD_G_LEASH) {
            yaw = cur_obj_angle_to_home();
        } else if (dist > 1600.0f) {
            yaw = o->oAngleToMario;
        } else if (dist < 550.0f) {
            yaw = o->oAngleToMario + 0x8000;
        } else {
            yaw = o->oAngleToMario + ((o->oHdStrafe & 1) ? 0x4000 : -0x4000);
        }
        o->oMoveAngleYaw = approach_s16_symmetric(o->oMoveAngleYaw, yaw, 0x800);
        o->oForwardVel = approach_f32_symmetric(o->oForwardVel, 9.0f, 1.0f);
        if ((o->oMoveFlags & OBJ_MOVE_HIT_WALL) || (random_u16() % 70) == 0) {
            o->oHdStrafe ^= 1;
        }
        cur_obj_init_animation_with_accel_and_sound(0, 2.2f);
        hd_sound_at_anim_range(2, 17, SOUND_OBJ_GOOMBA_WALK);
    }
    cur_obj_update_floor_and_walls();
    hd_stay_on_ground();   // (no walking off ledges: they stop at the edge)
    cur_obj_move_standard(-78);
    if (!elevated) {
        o->oFaceAngleYaw = o->oAngleToMario;   // they walk sideways, gun on Mario
    }

    if (o->oHdShootTimer > 0) {
        o->oHdShootTimer--;
    } else if (dist < HD_G_RANGE && sHdShooters < HD_MAX_SHOOTERS && gMarioState->action != ACT_DISAPPEARED
               && hd_sees_mario()) {
        sHdShooters++;
        o->oHdAiming = TRUE;
        o->oHdShots = 2 + (random_u16() % 2);
        o->oAction = HD_G_AIM;
    } else {
        o->oHdShootTimer = 15;           // look again in a moment
    }
}

static void hd_stop_aiming(void) {
    if (o->oHdAiming) {
        if (sHdShooters > 0) {
            sHdShooters--;
        }
        o->oHdAiming = FALSE;
    }
}

static void hd_gangster_aim(void) {
    // plant the feet, raise the gun, then a short burst
    o->oForwardVel = 0.0f;
    hd_face_mario(0x1000);
    cur_obj_init_animation_with_accel_and_sound(0, 0.3f);
    cur_obj_update_floor_and_walls();
    cur_obj_move_standard(-78);
    if (o->oTimer >= 14 && ((o->oTimer - 14) % 8) == 0 && o->oHdShots > 0) {
        hd_fire();
        o->oHdShots--;
    }
    if (o->oHdShots <= 0 && o->oTimer > 30) {
        hd_stop_aiming();
        o->oHdShootTimer = 50 + (random_u16() % 70);
        o->oAction = HD_G_COMBAT;
    }
}

static void hd_gangster_hit(s32 attackType) {
    struct ShotgunHit *shot = studio_shotgun_hit_for(o);
    f32 kx, kz;

    hd_stop_aiming();
    hd_raise_alarm();
    cur_obj_become_intangible();
    o->oHdSquished = attackType == ATTACK_FROM_ABOVE || attackType == ATTACK_GROUND_POUND_OR_TWIRL;
    if (o->oHdSquished) {
        cur_obj_play_sound_2(SOUND_OBJ_ENEMY_DEFEAT_SHRINK);
        o->oForwardVel = 0.0f;
        // a stomp bounces Mario like any Goomba
    } else {
        // blown back along the shot (or away from Mario's fist)
        if (shot != NULL) {
            kx = shot->dir[0];
            kz = shot->dir[2];
            o->oForwardVel = 30.0f + 4.0f * shot->pellets;
        } else {
            kx = sins(o->oAngleToMario + 0x8000);
            kz = coss(o->oAngleToMario + 0x8000);
            o->oForwardVel = 30.0f;
        }
        o->oMoveAngleYaw = atan2s(kz, kx);
        o->oVelY = 38.0f;
        cur_obj_play_sound_2(SOUND_OBJ_DEFAULT_DEATH);
    }
    o->oAction = HD_G_DOWN;
}

static void hd_gangster_down(void) {
    cur_obj_update_floor_and_walls();
    if (o->oForwardVel > 0.0f
        && !hd_ground_at(o->oPosX + sins(o->oMoveAngleYaw) * 60.0f, o->oPosZ + coss(o->oMoveAngleYaw) * 60.0f, 3000.0f)) {
        o->oForwardVel = 0.0f;   // blown back toward the void: he drops where he is (his coins stay reachable)
        o->oVelX = o->oVelZ = 0.0f;
    }
    cur_obj_move_standard(-78);
    if (o->oHdSquished) {
        o->header.gfx.scale[1] = approach_f32_symmetric(o->header.gfx.scale[1], HD_G_SCALE * 0.3f, 0.3f);
    } else if (!hd_on_ground()) {
        o->oFaceAnglePitch += 0x1800;
    }
    if (o->oTimer > 12 && (hd_on_ground() || o->oTimer > 60)) {
        studio_shotgun_fx_burst(o, 8);
        spawn_mist_particles();
        obj_spawn_loot_yellow_coins(o, o->oNumLootCoins, 20.0f);
        obj_mark_for_deletion(o);
    }
}

void bhv_studio_gangster_init(void) {
    static const GeoLayout *looks[3] = { sg_gangster0_geo, sg_gangster1_geo, sg_gangster2_geo };
    s32 look = (o->oBehParams >> 16) & 0xFF;

    // the look: BPARAM2 0..2 (bandana and shirt)
    if (look > 2) {
        look = 0;
    }
    o->header.gfx.sharedChild = studio_geo_node(looks[look]);
    cur_obj_scale(HD_G_SCALE);
    obj_set_hitbox(o, &sHdGangsterHitbox);
    o->oHdStrafe = (random_u16() & 1) | (hd_elevated() ? 2 : 0);
    o->oHdShootTimer = 0;
    o->oHdAiming = FALSE;
    o->oHdSafeX = o->oPosX;
    o->oHdSafeZ = o->oPosZ;
    // a new set of gangsters (a level loaded): nobody aims yet
    if (gGlobalTimer - sHdShooterFrame > 2) {
        sHdShooters = 0;
    }
    sHdShooterFrame = gGlobalTimer;
}

void bhv_studio_gangster_loop(void) {
    s32 attack;

    sHdShooterFrame = gGlobalTimer;
    hd_update_blinking(&o->oHdBlink, 30, 50, 5);
    switch (o->oAction) {
        case HD_G_IDLE:   hd_gangster_idle();   break;
        case HD_G_ALERT:  hd_gangster_alert();  break;
        case HD_G_COMBAT: hd_gangster_combat(); break;
        case HD_G_AIM:    hd_gangster_aim();    break;
        case HD_G_DOWN:   hd_gangster_down();   break;
    }
    if (o->oAction != HD_G_DOWN) {
        hd_keep_safe_spot();
        obj_set_hitbox(o, &sHdGangsterHitbox);
        attack = hd_attacked();
        if (attack != 0) {
            hd_gangster_hit(attack);
        }
    } else {
        o->oInteractStatus = 0;
    }
}

// ------------------------------------------------------------------------------------- the bullets
static struct ObjectHitbox sHdBulletHitbox = {
    /* interactType:      */ INTERACT_DAMAGE,
    /* downOffset:        */ 20,
    /* damageOrCoinValue: */ 1,
    /* health:            */ 0,
    /* numLootCoins:      */ 0,
    /* radius:            */ 45,
    /* height:            */ 50,
    /* hurtboxRadius:     */ 45,
    /* hurtboxHeight:     */ 50,
};

void bhv_studio_gangster_bullet_init(void) {
    obj_set_hitbox(o, &sHdBulletHitbox);
    o->oFaceAngleYaw = atan2s(o->oVelZ, o->oVelX);
    o->oFaceAnglePitch = -atan2s(sqrtf(hd_sqr(o->oVelX) + hd_sqr(o->oVelZ)), o->oVelY);
}

void bhv_studio_gangster_bullet_loop(void) {
    Vec3f from, to;
    f32 step, clear;

    from[0] = o->oPosX;
    from[1] = o->oPosY;
    from[2] = o->oPosZ;
    to[0] = from[0] + o->oVelX;
    to[1] = from[1] + o->oVelY;
    to[2] = from[2] + o->oVelZ;
    step = sqrtf(hd_sqr(o->oVelX) + hd_sqr(o->oVelY) + hd_sqr(o->oVelZ));
    clear = studio_shotgun_ray_clear(from, to);
    if (clear < step || (o->oInteractStatus & INT_STATUS_INTERACTED) || o->oTimer > 75) {
        // into a wall (or Mario, or out of steam): a spark and gone
        if (clear < step) {
            o->oPosX += o->oVelX * clear / step;
            o->oPosY += o->oVelY * clear / step;
            o->oPosZ += o->oVelZ * clear / step;
            spawn_object(o, MODEL_NONE, bhvSparkleSpawn);
        }
        obj_mark_for_deletion(o);
        return;
    }
    o->oPosX = to[0];
    o->oPosY = to[1];
    o->oPosZ = to[2];
}
