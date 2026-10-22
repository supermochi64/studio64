#define OBJECT_FIELDS_INDEX_DIRECTLY
// Behavior scripts of the vehicles (vehicle.c, vehicle_race.c).
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
#include "actors/group15.h"
#include "sms/bhv_macros.h"
#include "vehicle.h"

void bhv_studio_car_init(void);
void bhv_studio_car_loop(void);
void bhv_studio_car_flame_loop(void);
void bhv_studio_race_init(void);
void bhv_studio_race_loop(void);
void bhv_studio_traffic_car_loop(void);
void bhv_studio_race_driver_loop(void);

// a car Mario can drive: solid while it is parked
const BehaviorScript bhvStudioCar[] = {
    BEGIN(OBJ_LIST_SURFACE),
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE | OBJ_FLAG_COMPUTE_DIST_TO_MARIO)),
    SET_FLOAT(oDrawingDistance, 20000),
    SET_FLOAT(oCollisionDistance, 1200),
    SET_HOME(),
    CALL_NATIVE(bhv_studio_car_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_car_loop),
    END_LOOP(),
};

// the drift boost's sparks and the exhaust flames
const BehaviorScript bhvStudioCarFlame[] = {
    BEGIN(OBJ_LIST_UNIMPORTANT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BILLBOARD(),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_car_flame_loop),
    END_LOOP(),
};

// a race: the rival's car on the start line, the course its path (vehicle_race.c)
const BehaviorScript bhvStudioRace[] = {
    BEGIN(OBJ_LIST_SURFACE),
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE | OBJ_FLAG_COMPUTE_DIST_TO_MARIO)),
    SET_FLOAT(oDrawingDistance, 30000),
    SET_FLOAT(oCollisionDistance, 1200),
    SET_HOME(),
    CALL_NATIVE(bhv_studio_race_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_race_loop),
    END_LOOP(),
};

// the race's traffic, steady in its lane
const BehaviorScript bhvStudioTrafficCar[] = {
    BEGIN(OBJ_LIST_SURFACE),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    SET_FLOAT(oDrawingDistance, 20000),
    SET_FLOAT(oCollisionDistance, 1000),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_traffic_car_loop),
    END_LOOP(),
};

// the rival at the wheel (the Drift King: a Toad in his costume)
const BehaviorScript bhvStudioRaceDriver[] = {
    BEGIN(OBJ_LIST_DEFAULT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    LOAD_ANIMATIONS(oAnimations, toad_seg6_anims_0600FB58),
    ANIMATE(6),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_race_driver_loop),
    END_LOOP(),
};
