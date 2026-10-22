// The behavior scripts of Tokyo's objects (their code: tokyo.c). A file of their own: scripts name
// object fields by index (OBJECT_FIELDS_INDEX_DIRECTLY), the code by name.
#define OBJECT_FIELDS_INDEX_DIRECTLY
#include <ultra64.h>

#include "sm64.h"
#include "object_constants.h"
#include "object_fields.h"
#include "game/object_list_processor.h"
#include "make_const_nonconst.h"
#include "behavior_data.h"
#include "tokyo.h"
#include "../sms/bhv_macros.h"

extern const struct Animation *const toad_seg6_anims_0600FB58[];

void bhv_tk_boat_init(void);
void bhv_tk_boat_loop(void);
void bhv_tk_car_init(void);
void bhv_tk_car_loop(void);
void bhv_tk_city_init(void);
void bhv_tk_city_loop(void);
void bhv_tk_crane_jib_init(void);
void bhv_tk_crane_jib_loop(void);
void bhv_tk_firefly_init(void);
void bhv_tk_firefly_loop(void);
void bhv_tk_lift_init(void);
void bhv_tk_lift_loop(void);
void bhv_tk_pedestrian_loop(void);
void bhv_tk_petal_emitter_loop(void);
void bhv_tk_petal_loop(void);
void bhv_tk_prop_loop(void);
void bhv_tk_train_init(void);
void bhv_tk_train_loop(void);


const BehaviorScript bhvTkCity[] = {
    BEGIN(OBJ_LIST_DEFAULT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    CALL_NATIVE(bhv_tk_city_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_city_loop),
    END_LOOP(),
};

const BehaviorScript bhvTkProp[] = {
    BEGIN(OBJ_LIST_DEFAULT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    SET_FLOAT(oDrawingDistance, 20000),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_prop_loop),
    END_LOOP(),
};

#define TK_VEHICLE(init, loop, coll, draw) \
    BEGIN(OBJ_LIST_SURFACE), \
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)), \
    SET_HOME(), \
    SET_FLOAT(oCollisionDistance, coll), \
    SET_FLOAT(oDrawingDistance, draw), \
    CALL_NATIVE(init), \
    BEGIN_LOOP(), \
        CALL_NATIVE(loop), \
    END_LOOP()

const BehaviorScript bhvTkCar[] = { TK_VEHICLE(bhv_tk_car_init, bhv_tk_car_loop, 2000, 16000) };
const BehaviorScript bhvTkTrain[] = { TK_VEHICLE(bhv_tk_train_init, bhv_tk_train_loop, 3500, 20000) };
const BehaviorScript bhvTkLift[] = { TK_VEHICLE(bhv_tk_lift_init, bhv_tk_lift_loop, 2000, 20000) };
const BehaviorScript bhvTkBoat[] = { TK_VEHICLE(bhv_tk_boat_init, bhv_tk_boat_loop, 2000, 16000) };
const BehaviorScript bhvTkCraneJib[] = { TK_VEHICLE(bhv_tk_crane_jib_init, bhv_tk_crane_jib_loop, 4500, 20000) };

const BehaviorScript bhvTkPetalEmitter[] = {
    BEGIN(OBJ_LIST_DEFAULT),
    OR_INT(oFlags, OBJ_FLAG_COMPUTE_DIST_TO_MARIO),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_petal_emitter_loop),
    END_LOOP(),
};

const BehaviorScript bhvTkPetal[] = {
    BEGIN(OBJ_LIST_UNIMPORTANT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BILLBOARD(),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_petal_loop),
    END_LOOP(),
};

const BehaviorScript bhvTkFirefly[] = {
    BEGIN(OBJ_LIST_UNIMPORTANT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BILLBOARD(),
    SET_HOME(),
    SET_FLOAT(oDrawingDistance, 3500),
    CALL_NATIVE(bhv_tk_firefly_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_firefly_loop),
    END_LOOP(),
};

const BehaviorScript bhvTkPedestrian[] = {
    BEGIN(OBJ_LIST_DEFAULT),
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO)),
    LOAD_ANIMATIONS(oAnimations, toad_seg6_anims_0600FB58),
    ANIMATE(6),
    SET_HOME(),
    SET_FLOAT(oDrawingDistance, 8000),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_pedestrian_loop),
    END_LOOP(),
};
