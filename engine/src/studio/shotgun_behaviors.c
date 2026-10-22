#define OBJECT_FIELDS_INDEX_DIRECTLY
// Behavior scripts of Shotgun Mario's objects (code: shotgun_objects.c, studio/shotgun.c).
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
#include "actors/common0.h"
#include "studio/sms/bhv_macros.h"
#include "shotgun_bhv.h"

// ------------------------------------------------------------------------------- behavior scripts
const BehaviorScript bhvStudioShotgun[] = {
    BEGIN(OBJ_LIST_LEVEL),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    SET_FLOAT(oDrawingDistance, 8000),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_shotgun_loop),
    END_LOOP(),
};

const BehaviorScript bhvStudioGangster[] = {
    BEGIN(OBJ_LIST_PUSHABLE),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    LOAD_ANIMATIONS(oAnimations, goomba_seg8_anims_0801DA4C),
    ANIMATE(0),
    DROP_TO_FLOOR(),
    SET_HOME(),
    SET_OBJ_PHYSICS(/*Wall hitbox radius*/ 40, /*Gravity*/ -400, /*Bounciness*/ -50, /*Drag strength*/ 0, /*Friction*/ 1000, /*Buoyancy*/ 0, /*Unused*/ 0, 0),
    SET_FLOAT(oDrawingDistance, 12000),
    CALL_NATIVE(bhv_studio_gangster_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_gangster_loop),
    END_LOOP(),
};

const BehaviorScript bhvStudioGangsterBullet[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    SET_FLOAT(oDrawingDistance, 12000),
    CALL_NATIVE(bhv_studio_gangster_bullet_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_gangster_bullet_loop),
    END_LOOP(),
};

