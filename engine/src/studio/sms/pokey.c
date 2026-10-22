// Pokey (Super Mario Sunshine): a column of spiky orange segments with a flower on its head.
// It sways in place, turns to Mario and, when he comes close, bends and lunges at him with
// its head. Its spikes hurt. Like SM64's Pokeys it loses a segment to every stomp or punch
// (it sinks a step lower each time); hit the head when nothing is left below it and it falls
// apart into coins.
//
// bparams: byte 4 = number of body segments below the head (0 = 3, the most).
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

enum { POKEY_SWAY, POKEY_ATTACK, POKEY_HIT, POKEY_DIE };
#define SEGMENT_HEIGHT 80.0f
// sambo materials 2..4 are the body segments from the top down (0 flower, 1 head)
#define MAT_SEGMENT(k) (4 - (k))

static struct ObjectHitbox sPokeyHitbox = {
    /* interactType: */ INTERACT_BOUNCE_TOP,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 2,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 60,
    /* height: */ 360,
    /* hurtboxRadius: */ 55,
    /* hurtboxHeight: */ 350,
};

static s32 segments_left(void) {
    return o->oSmsHealth;
}

static void set_segments(s32 n) {
    s32 k;
    o->oSmsHealth = n;
    o->oSmsHide = 0;
    for (k = 0; k < 3 - n; k++) {
        o->oSmsHide |= 1 << MAT_SEGMENT(k);
    }
}

void bhv_sms_pokey_init(void) {
    s32 n = o->oBehParams & 0xFF;
    sms_set_body(SMS_BODY_SAMBO);
    o->oGravity = -4.0f;
    o->oFriction = 0.9f;
    o->oBuoyancy = 1.2f;
    o->oWallHitboxRadius = 50.0f;
    set_segments(n >= 1 && n <= 3 ? n : 3);
    o->oGraphYOffset = -SEGMENT_HEIGHT * (3 - o->oSmsHealth);
    sms_set_action(POKEY_SWAY);
    sms_set_anim(SMS_SAMBO_ANIM_FWAIT);
}

static void act_sway(void) {
    sms_set_anim(SMS_SAMBO_ANIM_FWAIT);
    o->oForwardVel = 0;
    if (o->oDistanceToMario < 1200.0f) {
        cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x180);
    }
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oTimer > 30 && sms_sees_mario(380.0f, 0x1800)) {
        sms_set_action(POKEY_ATTACK);
    }
}

// Bends back and lunges: the head swings forward along the ground.
static void act_attack(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_SAMBO_ANIM_FATTACK_START);
    }
    if (o->oTimer == 22) {
        struct Object *bite = spawn_object(o, MODEL_NONE, bhvSmsHurtbox);
        if (bite != NULL) {
            bite->oBehParams2ndByte = 2;   // damage
            bite->oSmsTimer2 = 26;         // frames
            bite->oSmsBaseScale = 260.0f;  // reach in front
            bite->hitboxRadius = 90.0f;
            bite->hitboxHeight = 140.0f;
        }
        cur_obj_play_sound_2(SOUND_OBJ2_PIRANHA_PLANT_BITE);
    }
    if (o->oTimer == 34) {
        sms_restart_anim(SMS_SAMBO_ANIM_FATTACK);
    }
    if (o->oTimer == 50) {
        sms_restart_anim(SMS_SAMBO_ANIM_FATTACK_END);
    }
    if (o->oTimer > 50 && sms_anim_done()) {
        sms_set_action(POKEY_SWAY);
    }
}

// Lost a segment: sinks a step, shakes its head.
static void act_hit(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_SAMBO_ANIM_HIT);
        cur_obj_play_sound_2(SOUND_OBJ_POKEY_DEATH);
        spawn_mist_particles();
        obj_spawn_loot_yellow_coins(o, 1, 20.0f);
        set_segments(segments_left() - 1);
    }
    o->oGraphYOffset = approach_f32_symmetric(o->oGraphYOffset, -SEGMENT_HEIGHT * (3 - o->oSmsHealth), 8.0f);
    if (o->oTimer > 24) {
        sms_set_action(POKEY_SWAY);
    }
}

static void act_die(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_SAMBO_ANIM_DOWN);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_POKEY_DEATH);
    }
    if (o->oTimer > 30) {
        sms_die(3, SOUND_OBJ_ENEMY_DEATH_HIGH);
    }
}

void bhv_sms_pokey_loop(void) {
    s32 hit;
    cur_obj_update_floor_and_walls();
    if (o->oAction != POKEY_DIE && o->oAction != POKEY_HIT) {
        hit = sms_check_hit(&sPokeyHitbox);
        o->hitboxHeight = 360.0f - SEGMENT_HEIGHT * (3 - o->oSmsHealth);
        o->hurtboxHeight = o->hitboxHeight - 10.0f;
        if (hit != SMS_HIT_NONE && hit != SMS_HIT_MARIO) {
            sms_set_action(segments_left() > 0 ? POKEY_HIT : POKEY_DIE);
        }
    }
    switch (o->oAction) {
        case POKEY_SWAY: act_sway(); break;
        case POKEY_ATTACK: act_attack(); break;
        case POKEY_HIT: act_hit(); break;
        case POKEY_DIE: act_die(); break;
    }
    cur_obj_move_standard(-78);
}

// ---- a short-lived damaging hitbox in front of its parent (a lunge, a punch) ------------------
// oBehParams2ndByte = damage, oSmsTimer2 = lifetime, oSmsBaseScale = distance in front.

void bhv_sms_hurtbox_loop(void) {
    struct Object *p = o->parentObj;
    if (p == NULL || p->activeFlags == ACTIVE_FLAG_DEACTIVATED || o->oTimer >= o->oSmsTimer2) {
        obj_mark_for_deletion(o);
        return;
    }
    o->oPosX = p->oPosX + sins(p->oFaceAngleYaw) * o->oSmsBaseScale;
    o->oPosY = p->oPosY;
    o->oPosZ = p->oPosZ + coss(p->oFaceAngleYaw) * o->oSmsBaseScale;
    o->oInteractType = INTERACT_DAMAGE;
    o->oDamageOrCoinValue = o->oBehParams2ndByte;
    o->hurtboxRadius = 0;
    o->hurtboxHeight = 0;
    if (o->oInteractStatus & INT_STATUS_INTERACTED) {
        obj_mark_for_deletion(o);  // one hit per lunge
    }
    o->oInteractStatus = 0;
}
