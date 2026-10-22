// Shine Sprite (Super Mario Sunshine): collected exactly like an SM64 star (the same hitbox and
// interaction: the studio counts it, a custom level ends with the course complete screen),
// floating and turning in its own animation.
//
// bparams: byte 1 = star number (like the star), as for SM64's stars.
#include <ultra64.h>

#include "sm64.h"
#include "macros.h"
#include "object_fields.h"
#include "behavior_data.h"
#include "engine/math_util.h"
#include "game/object_helpers.h"
#include "game/interaction.h"
#include "game/object_list_processor.h"
#include "sms.h"

#define o gCurrentObject

static struct ObjectHitbox sShineHitbox = {
    /* interactType: */ INTERACT_STAR_OR_KEY,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 0,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 80,
    /* height: */ 140,
    /* hurtboxRadius: */ 0,
    /* hurtboxHeight: */ 0,
};

void bhv_sms_shine_init(void) {
    sms_set_body(SMS_BODY_SHINE);
    sms_set_anim(0);
    obj_set_hitbox(o, &sShineHitbox);
}

void bhv_sms_shine_loop(void) {
    o->oFaceAngleYaw += 0x600;
    o->oGraphYOffset = sins(o->oTimer * 0x400) * 10.0f;
    if (o->oInteractStatus & INT_STATUS_INTERACTED) {
        obj_mark_for_deletion(o);
        o->oInteractStatus = 0;
    }
}
