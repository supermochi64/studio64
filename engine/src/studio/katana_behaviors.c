#define OBJECT_FIELDS_INDEX_DIRECTLY
// Behavior scripts of Katana Mario's objects (code: katana_fighters.c, studio/katana.c), from Shoggoth
// World's data/sh_maidcafe_bhv.inc.c.
#include <ultra64.h>

#include "sm64.h"
#include "object_constants.h"
#include "object_fields.h"
#include "game/object_list_processor.h"
#include "game/interaction.h"
#include "game/behavior_actions.h"
#include "game/object_helpers.h"
#include "make_const_nonconst.h"
#include "behavior_data.h"
#include "studio/sms/bhv_macros.h"
#include "katana_bhv.h"

// a cosplayer fighter (the real Toad, dressed; katana_fighters.c sets his animation table and model)
const BehaviorScript bhvKtFighter[] = {
    BEGIN(OBJ_LIST_PUSHABLE),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    DROP_TO_FLOOR(),
    SET_HOME(),
    SET_OBJ_PHYSICS(/*Wall hitbox radius*/ 50, /*Gravity*/ -400, /*Bounciness*/ -50, /*Drag strength*/ 0, /*Friction*/ 1000, /*Buoyancy*/ 0, /*Unused*/ 0, 0),
    SET_FLOAT(oDrawingDistance, 9000),
    SET_INT(oOpacity, 255),
    CALL_NATIVE(bhv_kt_fighter_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_kt_fighter_loop),
    END_LOOP(),
};

// the katana duel: the six fighters, the blade, the waves (no model of its own: a marker in build mode)
const BehaviorScript bhvKtDuel[] = {
    BEGIN(OBJ_LIST_SPAWNER),
    OR_INT(oFlags, OBJ_FLAG_COMPUTE_DIST_TO_MARIO),
    SET_HOME(),
    CALL_NATIVE(bhv_kt_duel_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_kt_duel_loop),
    END_LOOP(),
};

// the Legendary Blade in the floor: B at it pulls it out (studio/katana.c)
const BehaviorScript bhvKtBlade[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    SET_FLOAT(oDrawingDistance, 9000),
    CALL_NATIVE(bhv_kt_blade_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_kt_blade_loop),
    END_LOOP(),
};

// a fighter's cut: an invisible damage hitbox for the frames the blade sweeps
const BehaviorScript bhvKtSlashHit[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    SET_INT(oInteractType, INTERACT_DAMAGE),
    SET_INT(oDamageOrCoinValue, 2),
    SET_HITBOX(/*Radius*/ 120, /*Height*/ 170),
    SET_INT(oIntangibleTimer, 0),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_kt_slash_hit_loop),
    END_LOOP(),
};
