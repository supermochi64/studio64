// Cataquack (Super Mario Sunshine): a round duck-like creature on two little legs. It waddles
// around (or naps); when it spots Mario it dashes at him. A blue one scoops him up and tosses
// him high into the air (no damage: use it to reach high places!), a red one rams him. Stomp
// it to knock it out; a punch flips it over and a stomp then finishes it.
//
// bparams: byte 3 = 0 blue (tosses), 1 red (rams), byte 4 = 0 waddles around, 1 sleeps.
#include <ultra64.h>

#include "sm64.h"
#include "macros.h"
#include "object_fields.h"
#include "behavior_data.h"
#include "audio_defines.h"
#include "engine/math_util.h"
#include "engine/behavior_script.h"
#include "game/object_helpers.h"
#include "game/obj_behaviors.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/object_list_processor.h"
#include "game/spawn_sound.h"
#include "sms.h"

#define o gCurrentObject

enum { QUACK_WADDLE, QUACK_SLEEP, QUACK_WAKE, QUACK_SPOT, QUACK_DASH, QUACK_TOSS, QUACK_FLIPPED, QUACK_STOMPED };
#define RED (o->oSmsVariant == 1)

static struct ObjectHitbox sQuackHitbox = {
    /* interactType: */ INTERACT_BOUNCE_TOP,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 0,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 90,
    /* height: */ 160,
    /* hurtboxRadius: */ 80,
    /* hurtboxHeight: */ 150,
};

void bhv_sms_cataquack_init(void) {
    sms_set_body(SMS_BODY_POIHANA);
    o->oSmsVariant = (o->oBehParams >> 8) & 0xFF;
    o->oSmsTint = RED ? 0xF04030 : 0x3070F8;
    o->oGravity = -4.0f;
    o->oFriction = 0.9f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = 70.0f;
    o->oSmsTargetYaw = o->oMoveAngleYaw;
    sms_set_action((o->oBehParams & 0xFF) == 1 ? QUACK_SLEEP : QUACK_WADDLE);
    sms_set_anim((o->oBehParams & 0xFF) == 1 ? SMS_POIHANA_ANIM_SLEEP : SMS_POIHANA_ANIM_WAIT);
}

static void act_waddle(void) {
    if ((o->oTimer / 120) % 3 == 2) {
        sms_set_anim(SMS_POIHANA_ANIM_WAIT);
        o->oForwardVel = 0;
    } else {
        sms_set_anim(SMS_POIHANA_ANIM_WALK);
        sms_wander(3.0f, 700.0f, 0x200);
        sms_stay_on_ground();
    }
    if (sms_sees_mario(1000.0f, 0x3000) || o->oDistanceToMario < 400.0f) {
        sms_set_action(QUACK_SPOT);
    }
}

static void act_sleep(void) {
    sms_set_anim(SMS_POIHANA_ANIM_SLEEP);
    o->oForwardVel = 0;
    if (o->oDistanceToMario < 350.0f) {
        sms_set_action(QUACK_WAKE);
    }
}

static void act_wake(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_POIHANA_ANIM_WAKEN);
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
    }
    if (sms_anim_done() || o->oTimer > 60) {
        sms_set_action(QUACK_SPOT);
    }
}

static void act_spot(void) {
    o->oForwardVel = 0;
    sms_set_anim(SMS_POIHANA_ANIM_WAIT);
    if (o->oTimer == 0) {
        cur_obj_play_sound_2(SOUND_GENERAL_ENEMY_ALERT1);
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x800);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oTimer > 12) {
        sms_set_action(QUACK_DASH);
    }
}

static void act_dash(void) {
    sms_set_anim(SMS_POIHANA_ANIM_DASH);
    cur_obj_rotate_yaw_toward(o->oAngleToMario, RED ? 0x280 : 0x200);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    o->oForwardVel = RED ? 20.0f : 15.0f;
    if (o->oTimer % 8 == 0) {
        cur_obj_play_sound_2(SOUND_OBJ_KOOPA_THE_QUICK_WALK);
    }
    if (o->oTimer > 100 || o->oDistanceToMario > 1600.0f) {
        sms_set_action(QUACK_WADDLE);
    }
}

// Caught Mario: the blue one tosses him up high, the red one rams him and gloats.
static void act_toss(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_POIHANA_ANIM_THROW);
        if (!RED) {
            struct MarioState *m = gMarioState;
            set_mario_action(m, ACT_TWIRLING, 0);
            m->vel[1] = 88.0f;
            m->forwardVel = 4.0f;
            m->twirlYaw = 0;
            m->angleVel[1] = 0x2000;
            cur_obj_play_sound_2(SOUND_OBJ_HEAVEHO_TOSSED);
        } else {
            cur_obj_play_sound_2(SOUND_OBJ_BULLY_METAL);
        }
    }
    if (sms_anim_done() || o->oTimer > 50) {
        sms_set_action(QUACK_WADDLE);
    }
}

// Flipped onto its back by a punch: flails, then gets up again.
static void act_flipped(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_POIHANA_ANIM_WATERHIT);
        cur_obj_play_sound_2(SOUND_OBJ_KOOPA_DAMAGE);
    }
    if (o->oTimer == 20) {
        sms_restart_anim(SMS_POIHANA_ANIM_PIKUPIKU);
    }
    if (o->oTimer == 110) {
        sms_restart_anim(SMS_POIHANA_ANIM_GETUP);
    }
    if (o->oTimer > 110 && (sms_anim_done() || o->oTimer > 170)) {
        sms_set_action(QUACK_SPOT);
    }
}

static void act_stomped(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_POIHANA_ANIM_HUMI);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_STOMPED);
        o->oForwardVel = 0;
    }
    if (o->oTimer == 14) {
        sms_restart_anim(SMS_POIHANA_ANIM_DEATH);
    }
    if (o->oTimer > 40) {
        sms_die(RED ? 3 : 2, SOUND_OBJ_ENEMY_DEATH_LOW);
    }
}

void bhv_sms_cataquack_loop(void) {
    s32 hit;
    cur_obj_update_floor_and_walls();
    sQuackHitbox.damageOrCoinValue = RED ? 2 : 0;
    if (o->oAction != QUACK_STOMPED) {
        hit = sms_check_hit(&sQuackHitbox);
        if (hit == SMS_HIT_MARIO) {
            if (o->oAction != QUACK_FLIPPED && o->oAction != QUACK_SLEEP) {
                sms_set_action(QUACK_TOSS);
            }
        } else if (hit == ATTACK_FROM_ABOVE || hit == ATTACK_GROUND_POUND_OR_TWIRL) {
            sms_set_action(QUACK_STOMPED);
        } else if (hit != SMS_HIT_NONE) {
            if (o->oAction == QUACK_FLIPPED) {
                sms_knockback(30.0f, 30.0f);
                sms_set_action(QUACK_STOMPED);
            } else {
                sms_knockback(18.0f, 20.0f);
                sms_set_action(QUACK_FLIPPED);
            }
        }
    }
    switch (o->oAction) {
        case QUACK_WADDLE: act_waddle(); break;
        case QUACK_SLEEP: act_sleep(); break;
        case QUACK_WAKE: act_wake(); break;
        case QUACK_SPOT: act_spot(); break;
        case QUACK_DASH: act_dash(); break;
        case QUACK_TOSS: act_toss(); break;
        case QUACK_FLIPPED: act_flipped(); break;
        case QUACK_STOMPED: act_stomped(); break;
    }
    if (o->oAction == QUACK_FLIPPED || o->oAction == QUACK_STOMPED) {
        o->oForwardVel *= 0.9f;
    } else {
        o->oFaceAngleYaw = o->oMoveAngleYaw;
    }
    cur_obj_move_standard(-78);
}
