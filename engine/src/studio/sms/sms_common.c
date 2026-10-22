// Shared helpers of the behaviors ported from Super Mario Sunshine: bodies and animations,
// SM64-style attack handling, deaths with a puff and coins, squashing.
#include <ultra64.h>

#include "sm64.h"
#include "macros.h"
#include "object_fields.h"
#include "behavior_data.h"
#include "audio_defines.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/behavior_script.h"
#include "game/object_helpers.h"
#include "game/obj_behaviors.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/object_list_processor.h"
#include "game/spawn_sound.h"
#include "sms.h"

#define o gCurrentObject

void sms_set_body(s32 body) {
    if (body < 0 || body >= gSmsBodyCount) {
        body = 0;
    }
    o->oSmsBody = body;
    o->header.gfx.sharedChild = studio_geo_node(gSmsBodies[body].geo);
    o->oAnimations = (struct Animation **) gSmsBodies[body].anims;
}

void sms_set_anim(s32 anim) {
    const struct SmsBody *b = &gSmsBodies[o->oSmsBody];
    if (anim < 0 || anim >= b->animCount || b->anims[anim] == NULL) {
        anim = 0;
    }
    cur_obj_init_animation_with_accel_and_sound(anim, 1.0f);
}

// Starts an animation from its first frame even when it is already playing.
void sms_restart_anim(s32 anim) {
    sms_set_anim(anim);
    o->header.gfx.unk38.animFrame = 0;
}

s32 sms_anim_done(void) {
    struct Animation *a = o->header.gfx.unk38.curAnim;
    return a == NULL || o->header.gfx.unk38.animFrame >= a->unk08 - 2;
}

void sms_set_action(s32 action) {
    o->oAction = action;
    o->oSubAction = 0;
    o->oTimer = 0;
}

// What happened to us this frame: SMS_HIT_NONE, SMS_HIT_MARIO (we hurt him), or an
// SM64 attack type (ATTACK_FROM_ABOVE is a stomp, ATTACK_PUNCH, ATTACK_KICK_OR_TRIP, ...).
s32 sms_check_hit(struct ObjectHitbox *hitbox) {
    s32 status = o->oInteractStatus, hit = SMS_HIT_NONE;
    obj_set_hitbox(o, hitbox);
    if (status & INT_STATUS_INTERACTED) {
        if (status & INT_STATUS_ATTACKED_MARIO) {
            hit = SMS_HIT_MARIO;
        } else if (status & INT_STATUS_ATTACK_MASK) {
            hit = status & INT_STATUS_ATTACK_MASK;
        }
    }
    o->oInteractStatus = 0;
    return hit;
}

// A puff of smoke, the death sound, coins, and gone.
void sms_die(s32 coins, s32 sound) {
    spawn_mist_particles_with_sound(sound != 0 ? (u32) sound : SOUND_OBJ_DEFAULT_DEATH);
    if (coins > 0) {
        obj_spawn_loot_yellow_coins(o, coins, 20.0f);
    }
    obj_mark_for_deletion(o);
}

// Squash flat (a stomp): returns TRUE once flat for a moment.
s32 sms_squash(f32 base) {
    f32 y = approach_f32_symmetric(o->header.gfx.scale[1], base * 0.3f, base * 0.14f);
    if (y == base * 0.3f) {
        o->header.gfx.scale[1] = y;
        o->header.gfx.scale[0] = o->header.gfx.scale[2] = base * 2.0f - y;
        return o->oTimer >= 14;
    }
    o->header.gfx.scale[1] = y;
    o->header.gfx.scale[0] = o->header.gfx.scale[2] = base * 2.0f - y;
    return FALSE;
}

// Knocked away from Mario by a punch or kick.
void sms_knockback(f32 speed, f32 up) {
    o->oMoveAngleYaw = obj_angle_to_object(gMarioObject, o);
    o->oForwardVel = speed;
    o->oVelY = up;
}

// Mario is in front of us (within the half-angle) and closer than dist.
s32 sms_sees_mario(f32 dist, s16 halfAngle) {
    s16 d = (s16) (o->oAngleToMario - o->oFaceAngleYaw);
    return o->oDistanceToMario < dist && (d < 0 ? -d : d) < halfAngle && gMarioState->action != ACT_DISAPPEARED;
}

// Walks around home: picks a new direction every so often, turns back when too far.
void sms_wander(f32 speed, f32 radius, s16 turn) {
    if (o->oTimer % 60 == 0 || (o->oMoveFlags & OBJ_MOVE_HIT_WALL)) {
        if (cur_obj_lateral_dist_to_home() > radius) {
            o->oSmsTargetYaw = cur_obj_angle_to_home();
        } else if (o->oMoveFlags & OBJ_MOVE_HIT_WALL) {
            o->oSmsTargetYaw = o->oMoveAngleYaw + 0x8000;
        } else {
            o->oSmsTargetYaw = o->oMoveAngleYaw + (s16) (random_u16() % 0x6000) - 0x3000;
        }
    }
    o->oMoveAngleYaw = approach_s16_symmetric(o->oMoveAngleYaw, o->oSmsTargetYaw, turn);
    o->oForwardVel = speed;
}

// Stops at ledges like SM64 enemies do: no walking off a cliff while patrolling.
void sms_stay_on_ground(void) {
    f32 x = o->oPosX + sins(o->oMoveAngleYaw) * 80.0f, z = o->oPosZ + coss(o->oMoveAngleYaw) * 80.0f;
    struct Surface *floor;
    f32 y = find_floor(x, o->oPosY + 100.0f, z, &floor);
    if (floor == NULL || y < o->oPosY - 160.0f) {
        o->oForwardVel = 0;
        o->oSmsTargetYaw = o->oMoveAngleYaw + 0x8000;
        o->oMoveAngleYaw += 0x800;
    }
}
