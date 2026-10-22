// Blooper (Super Mario Sunshine's land Blooper from Ricco Harbor): a big white squid that
// walks on its tentacles, searches around, runs at Mario and punches him, or spits goop at
// him from a distance. Stomp it and it goes numb; stomp or punch it again while it is
// numb and it is done for.
//
// bparams: byte 4 = 0 patrols, 1 stands guard.
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
#include "game/object_list_processor.h"
#include "game/spawn_sound.h"
#include "sms.h"

#define o gCurrentObject

enum { GESO_PATROL, GESO_GUARD, GESO_SEARCH, GESO_RUN, GESO_PUNCH, GESO_SPIT, GESO_HIT, GESO_NUMB, GESO_DOWN };

static struct ObjectHitbox sGesoHitbox = {
    /* interactType: */ INTERACT_BOUNCE_TOP,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 2,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 110,
    /* height: */ 170,
    /* hurtboxRadius: */ 100,
    /* hurtboxHeight: */ 160,
};

void bhv_sms_blooper_init(void) {
    sms_set_body(SMS_BODY_GESO);
    o->oGravity = -4.0f;
    o->oFriction = 0.9f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = 80.0f;
    o->oSmsTargetYaw = o->oMoveAngleYaw;
    o->oSmsVariant = o->oBehParams & 0xFF;
    sms_set_action(o->oSmsVariant == 1 ? GESO_GUARD : GESO_PATROL);
    sms_set_anim(SMS_GESO_ANIM_WAIT1);
}

static void spot_mario(void) {
    if (sms_sees_mario(1200.0f, 0x3000) || o->oDistanceToMario < 500.0f) {
        sms_set_action(GESO_RUN);
        cur_obj_play_sound_2(SOUND_OBJ_MR_BLIZZARD_ALERT);
    }
}

static void act_patrol(void) {
    sms_set_anim(SMS_GESO_ANIM_RUN1);
    sms_wander(5.0f, 800.0f, 0x180);
    sms_stay_on_ground();
    if (o->oTimer > 150) {
        sms_set_action(GESO_SEARCH);
    }
    spot_mario();
}

static void act_guard(void) {
    o->oForwardVel = 0;
    sms_set_anim(SMS_GESO_ANIM_WAIT1);
    if (o->oTimer > 120) {
        sms_set_action(GESO_SEARCH);
    }
    spot_mario();
}

// Stops and looks around for a while.
static void act_search(void) {
    o->oForwardVel = 0;
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_GESO_ANIM_SEARCH1);
    }
    if (o->oTimer > 70) {
        sms_set_action(o->oSmsVariant == 1 ? GESO_GUARD : GESO_PATROL);
    }
    spot_mario();
}

static void act_run(void) {
    sms_set_anim(SMS_GESO_ANIM_RUN1);
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x300);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    o->oForwardVel = 12.0f;
    if (o->oTimer % 10 == 0) {
        cur_obj_play_sound_2(SOUND_OBJ_JUMP_WALK_WATER);
    }
    if (o->oDistanceToMario < 260.0f) {
        sms_set_action(GESO_PUNCH);
    } else if (o->oTimer > 40 && o->oDistanceToMario > 500.0f && o->oDistanceToMario < 900.0f && (random_u16() % 50) == 0) {
        sms_set_action(GESO_SPIT);
    } else if (o->oDistanceToMario > 1800.0f || o->oTimer > 300) {
        sms_set_action(GESO_SEARCH);
    }
}

// Winds up and swings a tentacle.
static void act_punch(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_GESO_ANIM_PUNCH1);
    }
    if (o->oTimer < 10) {
        cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x600);
        o->oMoveAngleYaw = o->oFaceAngleYaw;
    }
    if (o->oTimer == 14) {
        struct Object *fist = spawn_object(o, MODEL_NONE, bhvSmsHurtbox);
        if (fist != NULL) {
            fist->oBehParams2ndByte = 2;
            fist->oSmsTimer2 = 12;
            fist->oSmsBaseScale = 170.0f;
            fist->hitboxRadius = 110.0f;
            fist->hitboxHeight = 170.0f;
        }
        o->oForwardVel = 14.0f;
        cur_obj_play_sound_2(SOUND_GENERAL_SWISH_AIR);
    }
    if (o->oTimer > 20) {
        o->oForwardVel *= 0.8f;
    }
    if (o->oTimer > 14 && sms_anim_done()) {
        sms_set_action(GESO_RUN);
    }
}

// Spits a blob of goop that hurts in front of it.
static void act_spit(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_GESO_ANIM_GERO1);
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x200);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oTimer == 30) {
        struct Object *goo = spawn_object(o, MODEL_NONE, bhvSmsHurtbox);
        cur_obj_play_sound_2(SOUND_OBJ_SNUFIT_SHOOT);
        if (goo != NULL) {
            goo->oBehParams2ndByte = 1;
            goo->oSmsTimer2 = 16;
            goo->oSmsBaseScale = 420.0f;
            goo->hitboxRadius = 160.0f;
            goo->hitboxHeight = 140.0f;
        }
        {
            // the goop splashes in front: a small burst of mist along the way
            struct Object *puff = spawn_object(o, MODEL_MIST, bhvWhitePuffExplosion);
            if (puff != NULL) {
                puff->oPosX += sins(o->oFaceAngleYaw) * 380.0f;
                puff->oPosZ += coss(o->oFaceAngleYaw) * 380.0f;
                puff->oPosY += 40.0f;
            }
        }
    }
    if (o->oTimer > 30 && sms_anim_done()) {
        sms_set_action(GESO_RUN);
    }
}

// Punched: reels back, angry.
static void act_hit(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_GESO_ANIM_HIT1);
        cur_obj_play_sound_2(SOUND_OBJ_KOOPA_DAMAGE);
    }
    o->oForwardVel *= 0.9f;
    if (o->oTimer > 30) {
        sms_set_action(GESO_RUN);
    }
}

// Stomped: numb for a while (a second stomp or a punch finishes it).
static void act_numb(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_GESO_ANIM_MAHI_START1);
        cur_obj_play_sound_2(SOUND_OBJ_STOMPED);
    }
    if (o->oTimer == 20) {
        sms_restart_anim(SMS_GESO_ANIM_MAHI_LOOP1);
    }
    if (o->oTimer == 130) {
        sms_restart_anim(SMS_GESO_ANIM_MAHI_END1);
    }
    if (o->oTimer > 130 && (sms_anim_done() || o->oTimer > 180)) {
        sms_set_action(GESO_RUN);
    }
}

static void act_down(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_GESO_ANIM_DOWN1);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_ENEMY_DEATH_LOW);
    }
    if (o->oTimer > 45) {
        sms_die(3, SOUND_OBJ_DEFAULT_DEATH);
    }
}

void bhv_sms_blooper_loop(void) {
    s32 hit;
    cur_obj_update_floor_and_walls();
    if (o->oAction != GESO_DOWN) {
        hit = sms_check_hit(&sGesoHitbox);
        if (hit == SMS_HIT_MARIO) {
            // bumped Mario: no change
        } else if (hit != SMS_HIT_NONE) {
            if (o->oAction == GESO_NUMB) {
                // the stomp that made it numb can still register on the next frames while Mario
                // bounces off: only a later stomp or punch finishes it
                if (o->oTimer > 10) {
                    sms_set_action(GESO_DOWN);
                }
            } else if (hit == ATTACK_FROM_ABOVE || hit == ATTACK_GROUND_POUND_OR_TWIRL) {
                sms_set_action(GESO_NUMB);
            } else {
                sms_knockback(20.0f, 16.0f);
                sms_set_action(GESO_HIT);
            }
        }
    }
    // numb: harmless to touch
    if (o->oAction == GESO_NUMB) {
        o->oDamageOrCoinValue = 0;
    }
    switch (o->oAction) {
        case GESO_PATROL: act_patrol(); break;
        case GESO_GUARD: act_guard(); break;
        case GESO_SEARCH: act_search(); break;
        case GESO_RUN: act_run(); break;
        case GESO_PUNCH: act_punch(); break;
        case GESO_SPIT: act_spit(); break;
        case GESO_HIT: act_hit(); break;
        case GESO_NUMB: act_numb(); break;
        case GESO_DOWN: act_down(); break;
    }
    if (o->oAction != GESO_HIT) {
        o->oFaceAngleYaw = o->oMoveAngleYaw;
    }
    cur_obj_move_standard(-78);
}
