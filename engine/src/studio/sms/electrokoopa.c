// Electrokoopa (Super Mario Sunshine): a four-legged Koopa with an electrified shell. It roams,
// and when it sees Mario it throws its crackling shell at him. Its shell shocks Mario, so it
// can't be stomped while it wears one; without the shell it is defenceless until it grows a
// new one: stomp or punch it then.
//
// bparams: byte 4 = 0 roams, 1 stands guard.
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
#include "game/game_init.h"
#include "sms.h"

#define o gCurrentObject

enum { EK_ROAM, EK_GUARD, EK_TURN, EK_THROW, EK_BARE, EK_REGROW, EK_SHOCKED_MARIO, EK_STOMPED, EK_KNOCKED };
#define MAT_SHELL 1  // dennoko materials: 0 body, 1 shell

static struct ObjectHitbox sShelledHitbox = {
    /* interactType: */ INTERACT_SHOCK,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 1,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 80,
    /* height: */ 120,
    /* hurtboxRadius: */ 70,
    /* hurtboxHeight: */ 110,
};

static struct ObjectHitbox sBareHitbox = {
    /* interactType: */ INTERACT_BOUNCE_TOP,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 1,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 75,
    /* height: */ 90,
    /* hurtboxRadius: */ 70,
    /* hurtboxHeight: */ 80,
};

static struct ObjectHitbox sShellHitbox = {
    /* interactType: */ INTERACT_SHOCK,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 1,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 60,
    /* height: */ 60,
    /* hurtboxRadius: */ 0,
    /* hurtboxHeight: */ 0,
};

// the crackle of electricity: the shell flickers between its colours and a hot white-blue
static s32 crackle(void) {
    s32 t = gGlobalTimer;
    return (t % 7 == 0 || t % 11 == 0) ? 0xC8F0FF : (t % 5 == 0 ? 0xFFF8A0 : 0);
}

void bhv_sms_electrokoopa_init(void) {
    sms_set_body(SMS_BODY_DENNOKO);
    o->oGravity = -4.0f;
    o->oFriction = 0.9f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = 60.0f;
    o->oSmsTargetYaw = o->oMoveAngleYaw;
    o->oSmsVariant = o->oBehParams & 0xFF;
    sms_set_action(o->oSmsVariant == 1 ? EK_GUARD : EK_ROAM);
    sms_set_anim(SMS_DENNOKO_ANIM_WAIT);
}

static void act_roam(void) {
    sms_set_anim(SMS_DENNOKO_ANIM_RUN_LOOP);
    sms_wander(4.0f, 700.0f, 0x200);
    sms_stay_on_ground();
    if (o->oTimer % 24 == 0) {
        cur_obj_play_sound_2(SOUND_OBJ_KOOPA_WALK);
    }
    if (sms_sees_mario(1100.0f, 0x3800) || o->oDistanceToMario < 450.0f) {
        sms_set_action(EK_TURN);
    }
}

static void act_guard(void) {
    o->oForwardVel = 0;
    sms_set_anim(SMS_DENNOKO_ANIM_WAIT);
    if (o->oDistanceToMario < 1100.0f) {
        sms_set_action(EK_TURN);
    }
}

static void act_turn(void) {
    o->oForwardVel = 0;
    sms_set_anim(SMS_DENNOKO_ANIM_TURN_LOOP);
    if (cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x500) || o->oTimer > 30) {
        o->oMoveAngleYaw = o->oFaceAngleYaw;
        sms_set_action(o->oDistanceToMario < 1400.0f ? EK_THROW : (o->oSmsVariant == 1 ? EK_GUARD : EK_ROAM));
    }
    o->oMoveAngleYaw = o->oFaceAngleYaw;
}

// Rears up and hurls the shell at Mario.
static void act_throw(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_DENNOKO_ANIM_SHOOT);
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x300);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oTimer == 26) {
        struct Object *shell = spawn_object(o, MODEL_NONE, bhvSmsElectroShell);
        if (shell != NULL) {
            f32 d = o->oDistanceToMario;
            shell->oPosY += 90.0f;
            shell->oMoveAngleYaw = o->oAngleToMario;
            shell->oForwardVel = d < 300.0f ? 18.0f : d / 22.0f;
            if (shell->oForwardVel > 42.0f) shell->oForwardVel = 42.0f;
            shell->oVelY = 30.0f;
        }
        o->oSmsHide |= 1 << MAT_SHELL;
        cur_obj_play_sound_2(SOUND_OBJ_EVIL_LAKITU_THROW);
    }
    if (o->oTimer > 26 && sms_anim_done()) {
        sms_set_action(EK_BARE);
    }
}

// No shell: wanders nervously, then grows a new one.
static void act_bare(void) {
    sms_set_anim(SMS_DENNOKO_ANIM_NWAIT);
    o->oForwardVel = 0;
    if (o->oTimer > 150) {
        sms_set_action(EK_REGROW);
    }
}

static void act_regrow(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_DENNOKO_ANIM_SUPPLY);
        cur_obj_play_sound_2(SOUND_AIR_AMP_BUZZ);
    }
    if (o->oTimer == 20) {
        o->oSmsHide &= ~(1 << MAT_SHELL);
    }
    if (o->oTimer > 20 && sms_anim_done()) {
        sms_set_action(o->oSmsVariant == 1 ? EK_GUARD : EK_ROAM);
    }
}

// Shocked Mario: a satisfied crackle, then back to work.
static void act_shocked_mario(void) {
    o->oForwardVel = 0;
    sms_set_anim(SMS_DENNOKO_ANIM_WAIT);
    if (o->oTimer > 40) {
        sms_set_action(EK_TURN);
    }
}

static void act_stomped(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_DENNOKO_ANIM_DOWN);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_STOMPED);
        o->oForwardVel = 0;
    }
    if (sms_squash(1.0f)) {
        sms_die(2, SOUND_OBJ_KOOPA_DAMAGE);
    }
}

static void act_knocked(void) {
    if (o->oTimer == 0) {
        sms_restart_anim(SMS_DENNOKO_ANIM_HIT);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_KOOPA_DAMAGE);
    }
    if ((o->oTimer > 8 && (o->oMoveFlags & (OBJ_MOVE_LANDED | OBJ_MOVE_HIT_WALL))) || o->oTimer > 45) {
        sms_die(2, SOUND_OBJ_KOOPA_FLYGUY_DEATH);
    }
}

void bhv_sms_electrokoopa_loop(void) {
    s32 hit, shelled = !(o->oSmsHide & (1 << MAT_SHELL));
    cur_obj_update_floor_and_walls();
    if (o->oAction < EK_STOMPED) {
        hit = sms_check_hit(shelled ? &sShelledHitbox : &sBareHitbox);
        if (hit == SMS_HIT_MARIO) {
            if (shelled) sms_set_action(EK_SHOCKED_MARIO);
        } else if (!shelled && (hit == ATTACK_FROM_ABOVE || hit == ATTACK_GROUND_POUND_OR_TWIRL)) {
            sms_set_action(EK_STOMPED);
        } else if (!shelled && hit != SMS_HIT_NONE) {
            sms_knockback(34.0f, 30.0f);
            sms_set_action(EK_KNOCKED);
        }
    }
    o->oSmsTint = shelled ? crackle() : 0;
    switch (o->oAction) {
        case EK_ROAM: act_roam(); break;
        case EK_GUARD: act_guard(); break;
        case EK_TURN: act_turn(); break;
        case EK_THROW: act_throw(); break;
        case EK_BARE: act_bare(); break;
        case EK_REGROW: act_regrow(); break;
        case EK_SHOCKED_MARIO: act_shocked_mario(); break;
        case EK_STOMPED: act_stomped(); break;
        case EK_KNOCKED: act_knocked(); break;
    }
    if (o->oAction != EK_TURN && o->oAction != EK_THROW) {
        o->oFaceAngleYaw = o->oMoveAngleYaw;
    }
    cur_obj_move_standard(-78);
}

// ---- the thrown shell ------------------------------------------------------------------------

void bhv_sms_electro_shell_init(void) {
    sms_set_body(SMS_BODY_KOURA);
    o->oGravity = -2.6f;
    o->oFriction = 0.97f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = 50.0f;
    obj_set_hitbox(o, &sShellHitbox);
}

void bhv_sms_electro_shell_loop(void) {
    sms_check_hit(&sShellHitbox);
    cur_obj_update_floor_and_walls();
    o->oSmsTint = crackle();
    o->oFaceAngleYaw += 0x1400;  // spins as it flies and slides
    if (o->oMoveFlags & OBJ_MOVE_LANDED) {
        cur_obj_play_sound_2(SOUND_OBJ_SOMETHING_LANDING);
    }
    if (o->oMoveFlags & OBJ_MOVE_ON_GROUND) {
        o->oForwardVel *= 0.96f;
    }
    if (o->oMoveFlags & OBJ_MOVE_HIT_WALL) {
        o->oMoveAngleYaw += 0x8000;
        o->oForwardVel *= 0.6f;
    }
    if (o->oTimer % 30 == 0) {
        cur_obj_play_sound_2(SOUND_AIR_AMP_BUZZ);
    }
    if (o->oTimer > 150) {
        spawn_mist_particles();
        obj_mark_for_deletion(o);
    }
    cur_obj_move_standard(-78);
}
