// Swoopin' Stu (Super Mario Sunshine): a translucent blob of goop with a ball of goop inside.
// It crawls around, turns to chase Mario when he comes close, flashes white with a cry and
// lunges at him, bursting into goop when it hits. A stomp or a punch pops it.
//
// bparams: byte 3 = colour (0: picked from the position, 1 red, 2 orange, 3 yellow, 4 green,
// 5 light blue, 6 blue, 7 pink), byte 4 = 0 crawls around, 1 sits still until Mario comes.
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

enum { GOO_CRAWL, GOO_WAIT, GOO_CHASE, GOO_FLASH, GOO_LUNGE, GOO_LAND, GOO_BURST };

static const u32 sGooColours[] = { 0xF04848, 0xF89838, 0xF8E048, 0x68D850, 0x70D0F8, 0x4878F0, 0xF070C0 };

static struct ObjectHitbox sGooHitbox = {
    /* interactType: */ INTERACT_BOUNCE_TOP,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 1,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 62,
    /* height: */ 120,
    /* hurtboxRadius: */ 55,
    /* hurtboxHeight: */ 110,
};

void bhv_sms_swoopin_stu_init(void) {
    s32 colour = (o->oBehParams >> 8) & 0xFF;
    u32 h = (u32) (s32) o->oPosX * 73856093u ^ (u32) (s32) o->oPosZ * 19349663u;
    sms_set_body(SMS_BODY_NAMEKURI);
    o->oSmsVariant = colour >= 1 && colour <= 7 ? colour - 1 : (s32) ((h ^ (h >> 11)) % 7);
    o->oSmsTint = (s32) sGooColours[o->oSmsVariant];
    o->oGravity = -3.0f;
    o->oFriction = 0.92f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = 50.0f;
    o->oSmsTargetYaw = o->oMoveAngleYaw;
    sms_set_action((o->oBehParams & 0xFF) == 1 ? GOO_WAIT : GOO_CRAWL);
    sms_set_anim(SMS_NAMEKURI_ANIM_WAIT);
}

static void act_crawl(void) {
    sms_set_anim(SMS_NAMEKURI_ANIM_WALK);
    sms_wander(2.5f, 500.0f, 0x180);
    sms_stay_on_ground();
    if (o->oDistanceToMario < 800.0f) {
        sms_set_action(GOO_CHASE);
    }
}

static void act_wait(void) {
    sms_set_anim(SMS_NAMEKURI_ANIM_WAIT);
    o->oForwardVel = 0;
    if (o->oDistanceToMario < 700.0f) {
        sms_set_action(GOO_CHASE);
    }
}

static void act_chase(void) {
    sms_set_anim(SMS_NAMEKURI_ANIM_WALK);
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x280);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    o->oForwardVel = 6.0f;
    if (o->oDistanceToMario < 380.0f && o->oTimer > 10) {
        sms_set_action(GOO_FLASH);
    } else if (o->oDistanceToMario > 1300.0f) {
        sms_set_action(GOO_CRAWL);
    }
}

// Flashes white and cries before the lunge.
static void act_flash(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_NAMEKURI_ANIM_JUMP_START);
        cur_obj_play_sound_2(SOUND_OBJ_SWOOP_DEATH);
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x600);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    o->oSmsTint = (o->oTimer / 2) % 2 ? 0xFFFFFF : (s32) sGooColours[o->oSmsVariant];
    if (o->oTimer >= 16) {
        o->oSmsTint = (s32) sGooColours[o->oSmsVariant];
        sms_set_action(GOO_LUNGE);
    }
}

static void act_lunge(void) {
    if (o->oTimer == 0) {
        f32 d = o->oDistanceToMario;
        o->oForwardVel = d < 120.0f ? 14.0f : d / 16.0f;
        if (o->oForwardVel > 30.0f) o->oForwardVel = 30.0f;
        o->oVelY = 32.0f;
        sms_restart_anim(SMS_NAMEKURI_ANIM_JUMP_END);
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
    }
    if (o->oTimer > 4 && (o->oMoveFlags & OBJ_MOVE_LANDED)) {
        sms_set_action(GOO_LAND);
    }
}

static void act_land(void) {
    if (o->oTimer == 0) {
        o->oForwardVel = 0;
        sms_restart_anim(SMS_NAMEKURI_ANIM_LAND);
        cur_obj_play_sound_2(SOUND_GENERAL_SPLATTERING);
    }
    if (o->oTimer > 30) {
        sms_set_action(GOO_CHASE);
    }
}

// Pops into goop.
static void act_burst(void) {
    if (o->oTimer == 0) {
        cur_obj_become_intangible();
        o->oForwardVel = 0;
        sms_restart_anim(SMS_NAMEKURI_ANIM_DOWN);
        cur_obj_play_sound_2(SOUND_GENERAL_SPLATTERING);
    }
    if (sms_squash(1.0f) || o->oTimer > 20) {
        sms_die(o->oSubAction, SOUND_OBJ_SNUFIT_SKEETER_DEATH);
    }
}

void bhv_sms_swoopin_stu_loop(void) {
    s32 hit;
    cur_obj_update_floor_and_walls();
    if (o->oAction != GOO_BURST) {
        hit = sms_check_hit(&sGooHitbox);
        if (hit == SMS_HIT_MARIO) {
            sms_set_action(GOO_BURST);  // splat on Mario: no coin
        } else if (hit != SMS_HIT_NONE) {
            sms_set_action(GOO_BURST);
            o->oSubAction = 1;  // popped by Mario: a coin
        }
    }
    switch (o->oAction) {
        case GOO_CRAWL: act_crawl(); break;
        case GOO_WAIT: act_wait(); break;
        case GOO_CHASE: act_chase(); break;
        case GOO_FLASH: act_flash(); break;
        case GOO_LUNGE: act_lunge(); break;
        case GOO_LAND: act_land(); break;
        case GOO_BURST: act_burst(); break;
    }
    if (o->oAction != GOO_FLASH && o->oAction != GOO_LUNGE) {
        o->oFaceAngleYaw = o->oMoveAngleYaw;
    }
    cur_obj_move_standard(-78);
}
