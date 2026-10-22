#define OBJECT_FIELDS_INDEX_DIRECTLY
// Behavior scripts of the characters ported from Super Mario Sunshine (the Piantas' one is in
// data/behavior_data.c). The code is in the other files of this folder.
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
#include "sms.h"
#include "bhv_macros.h"

#define SMS_ENEMY(list, init, loop) \
    BEGIN(list), \
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE | OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO)), \
    DROP_TO_FLOOR(), \
    ANIMATE(0), \
    SET_HOME(), \
    CALL_NATIVE(init), \
    BEGIN_LOOP(), \
        CALL_NATIVE(loop), \
    END_LOOP()

const BehaviorScript bhvSmsStrollinStu[] = {
    SMS_ENEMY(OBJ_LIST_PUSHABLE, bhv_sms_strollin_stu_init, bhv_sms_strollin_stu_loop),
};

const BehaviorScript bhvSmsSwoopinStu[] = {
    SMS_ENEMY(OBJ_LIST_PUSHABLE, bhv_sms_swoopin_stu_init, bhv_sms_swoopin_stu_loop),
};

const BehaviorScript bhvSmsElectrokoopa[] = {
    SMS_ENEMY(OBJ_LIST_PUSHABLE, bhv_sms_electrokoopa_init, bhv_sms_electrokoopa_loop),
};

const BehaviorScript bhvSmsPokey[] = {
    SMS_ENEMY(OBJ_LIST_GENACTOR, bhv_sms_pokey_init, bhv_sms_pokey_loop),
};

const BehaviorScript bhvSmsCataquack[] = {
    SMS_ENEMY(OBJ_LIST_PUSHABLE, bhv_sms_cataquack_init, bhv_sms_cataquack_loop),
};

const BehaviorScript bhvSmsBlooper[] = {
    SMS_ENEMY(OBJ_LIST_PUSHABLE, bhv_sms_blooper_init, bhv_sms_blooper_loop),
};

// the shell an Electrokoopa throws
const BehaviorScript bhvSmsElectroShell[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    ANIMATE(0),
    CALL_NATIVE(bhv_sms_electro_shell_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_sms_electro_shell_loop),
    END_LOOP(),
};

// an invisible damaging box in front of its parent for a few frames (a lunge, a punch, goop)
const BehaviorScript bhvSmsHurtbox[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_sms_hurtbox_loop),
    END_LOOP(),
};

// a Shine Sprite: a star with another look (shine.c)
const BehaviorScript bhvSmsShine[] = {
    BEGIN(OBJ_LIST_LEVEL),
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    ANIMATE(0),
    CALL_NATIVE(bhv_sms_shine_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_sms_shine_loop),
    END_LOOP(),
};
