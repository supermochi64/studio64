// Strollin' Stu (Super Mario Sunshine): a pudgy goop creature that strolls around its spot,
// spots Mario, and charges at him to bump him. Stomp it flat or punch it away; it pops
// into a puff and leaves a coin.
//
// bparams: byte 2 = size (0 normal, 1 big, 2 small), byte 4 = 0 wanders, 1 guards its spot
// (stands and looks around until Mario comes close).
#include <ultra64.h>

#include "sm64.h"
#include "macros.h"
#include "object_fields.h"
#include "behavior_data.h"
#include "audio_defines.h"
#include "engine/math_util.h"
#include "game/object_helpers.h"
#include "game/obj_behaviors.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/object_list_processor.h"
#include "game/spawn_sound.h"
#include "sms.h"

#define o gCurrentObject

enum { STU_WALK, STU_GUARD, STU_SPOT, STU_CHASE, STU_BUMPED, STU_STOMPED, STU_KNOCKED };

static struct ObjectHitbox sStuHitbox = {
    /* interactType: */ INTERACT_BOUNCE_TOP,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 1,
    /* health: */ 0,
    /* numLootCoins: */ 1,
    /* radius: */ 72,
    /* height: */ 110,
    /* hurtboxRadius: */ 62,
    /* hurtboxHeight: */ 95,
};

void bhv_sms_strollin_stu_init(void) {
    s32 size = (o->oBehParams >> 16) & 0xFF;
    sms_set_body(SMS_BODY_HAMUKURI);
    o->oSmsBaseScale = size == 1 ? 2.0f : size == 2 ? 0.6f : 1.0f;
    cur_obj_scale(o->oSmsBaseScale);
    o->oSmsVariant = o->oBehParams & 0xFF;
    o->oGravity = -4.0f;
    o->oFriction = 0.9f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = 50.0f * o->oSmsBaseScale;
    o->oSmsTargetYaw = o->oMoveAngleYaw;
    sms_set_action(o->oSmsVariant == 1 ? STU_GUARD : STU_WALK);
    sms_set_anim(o->oSmsVariant == 1 ? SMS_HAMUKURI_ANIM_WAIT : SMS_HAMUKURI_ANIM_WALK);
}

static void footsteps(void) {
    struct Animation *a = o->header.gfx.unk38.curAnim;
    if (a != NULL && (o->header.gfx.unk38.animFrame == 1 || o->header.gfx.unk38.animFrame == a->unk08 / 2)) {
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_WALK);
    }
}

static void act_walk(void) {
    sms_set_anim(SMS_HAMUKURI_ANIM_WALK);
    sms_wander(3.5f * o->oSmsBaseScale, 600.0f, 0x200);
    sms_stay_on_ground();
    footsteps();
    if (sms_sees_mario(900.0f, 0x3000) || o->oDistanceToMario < 350.0f) {
        sms_set_action(STU_SPOT);
    }
}

static void act_guard(void) {
    o->oForwardVel = 0;
    // stands, now and then looking around
    sms_set_anim((o->oTimer / 90) % 2 ? SMS_HAMUKURI_ANIM_KYORO : SMS_HAMUKURI_ANIM_WAIT);
    if (o->oDistanceToMario < 700.0f) {
        sms_set_action(STU_SPOT);
    }
}

// Saw Mario: a little hop of surprise, then the charge.
static void act_spot(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        o->oVelY = 18.0f;
        sms_restart_anim(SMS_HAMUKURI_ANIM_TURN_START);
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x900);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oTimer > 14 && (o->oMoveFlags & OBJ_MOVE_ON_GROUND)) {
        sms_set_action(STU_CHASE);
    }
}

static void act_chase(void) {
    sms_set_anim(SMS_HAMUKURI_ANIM_RUN);
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x300);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    o->oForwardVel = 11.0f * (o->oSmsBaseScale > 1.0f ? 1.2f : 1.0f);
    footsteps();
    if (o->oDistanceToMario > 1500.0f || o->oTimer > 200 || cur_obj_lateral_dist_to_home() > 2000.0f) {
        sms_set_action(o->oSmsVariant == 1 ? STU_GUARD : STU_WALK);
        o->oSmsTargetYaw = cur_obj_angle_to_home();
    }
}

// Bumped into Mario: stops and looks around, pleased with itself.
static void act_bumped(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_HAMUKURI_ANIM_KYORO);
    }
    if (o->oTimer > 50) {
        sms_set_action(o->oDistanceToMario < 900.0f ? STU_CHASE : STU_WALK);
    }
}

static void act_stomped(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_HAMUKURI_ANIM_CRASH);
        cur_obj_play_sound_2(SOUND_OBJ_STOMPED);
        cur_obj_become_intangible();
    }
    o->oForwardVel = 0;
    if (sms_squash(o->oSmsBaseScale)) {
        sms_die(o->oSmsBaseScale > 1.5f ? 3 : 1, 0);
    }
}

static void act_knocked(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_HAMUKURI_ANIM_DOWN);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_DYING_ENEMY1);
    }
    if (o->oTimer > 8 && (o->oMoveFlags & (OBJ_MOVE_LANDED | OBJ_MOVE_ON_GROUND | OBJ_MOVE_HIT_WALL))) {
        sms_die(o->oSmsBaseScale > 1.5f ? 3 : 1, 0);
    } else if (o->oTimer > 45) {
        sms_die(o->oSmsBaseScale > 1.5f ? 3 : 1, 0);
    }
}

void bhv_sms_strollin_stu_loop(void) {
    s32 hit;
    cur_obj_update_floor_and_walls();
    if (o->oAction < STU_STOMPED) {
        hit = sms_check_hit(&sStuHitbox);
        o->hitboxRadius *= o->oSmsBaseScale;
        o->hitboxHeight *= o->oSmsBaseScale;
        o->hurtboxRadius *= o->oSmsBaseScale;
        o->hurtboxHeight *= o->oSmsBaseScale;
        if (hit == SMS_HIT_MARIO) {
            sms_set_action(STU_BUMPED);
        } else if (hit == ATTACK_FROM_ABOVE || hit == ATTACK_GROUND_POUND_OR_TWIRL) {
            sms_set_action(STU_STOMPED);
        } else if (hit != SMS_HIT_NONE) {
            sms_knockback(36.0f, 34.0f);
            sms_set_action(STU_KNOCKED);
        }
    }
    switch (o->oAction) {
        case STU_WALK: act_walk(); break;
        case STU_GUARD: act_guard(); break;
        case STU_SPOT: act_spot(); break;
        case STU_CHASE: act_chase(); break;
        case STU_BUMPED: act_bumped(); break;
        case STU_STOMPED: act_stomped(); break;
        case STU_KNOCKED: act_knocked(); break;
    }
    o->oFaceAngleYaw = o->oMoveAngleYaw;
    cur_obj_move_standard(-78);
}
