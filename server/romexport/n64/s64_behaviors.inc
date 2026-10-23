// Studio 64's behavior scripts (the engine's own, from engine/data/behavior_data.c), included at
// the end of the game's behavior_data.c. Their code is in src/s64.

// building blocks and imported models (a moving one is its own object: s64_blocks.c)
void bhv_studio_block_loop(void);
const BehaviorScript bhvStudioBlock[] = {
    BEGIN(OBJ_LIST_SURFACE),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_block_loop),
    END_LOOP(),
};

const BehaviorScript bhvStudioTerrain[] = {
    BEGIN(OBJ_LIST_SURFACE),
    BEGIN_LOOP(),
    END_LOOP(),
};

void bhv_studio_model_loop(void);
const BehaviorScript bhvStudioModel[] = {
    BEGIN(OBJ_LIST_SURFACE),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_model_loop),
    END_LOOP(),
};

// story: any model that talks (story.c). bparams: 2nd byte animation set, 3rd animation.
void bhv_studio_npc_init(void);
void bhv_studio_npc_loop(void);
const BehaviorScript bhvStudioNpc[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, (OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE | OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO)),
    SET_INTERACT_TYPE(INTERACT_TEXT),
    SET_HITBOX(/*Radius*/ 80, /*Height*/ 120),
    SET_INT(oIntangibleTimer, 0),
    SET_HOME(),
    CALL_NATIVE(bhv_studio_npc_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_npc_loop),
    END_LOOP(),
};

// custom objects and enemies built from building blocks, their projectiles, and catalog models
// with their collision moved by a motion (actor.c, motion.c)
void bhv_studio_actor_init(void);
void bhv_studio_actor_loop(void);
const BehaviorScript bhvStudioActor[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_SET_FACE_YAW_TO_MOVE_YAW | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    SET_HOME(),
    CALL_NATIVE(bhv_studio_actor_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_actor_loop),
    END_LOOP(),
};

void bhv_studio_projectile_loop(void);
const BehaviorScript bhvStudioProjectile[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_projectile_loop),
    END_LOOP(),
};

void bhv_studio_mover_loop(void);
const BehaviorScript bhvStudioMover[] = {
    BEGIN(OBJ_LIST_SURFACE),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_mover_loop),
    END_LOOP(),
};

// world flow (flow.c): a painting Mario jumps into, a key to collect
void bhv_studio_painting_init(void);
void bhv_studio_painting_loop(void);
const BehaviorScript bhvStudioPainting[] = {
    BEGIN(OBJ_LIST_DEFAULT),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    CALL_NATIVE(bhv_studio_painting_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_painting_loop),
    END_LOOP(),
};

void bhv_studio_key_init(void);
void bhv_studio_key_loop(void);
const BehaviorScript bhvStudioKey[] = {
    BEGIN(OBJ_LIST_LEVEL),
    OR_INT(oFlags, OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE),
    CALL_NATIVE(bhv_studio_key_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_studio_key_loop),
    END_LOOP(),
};
