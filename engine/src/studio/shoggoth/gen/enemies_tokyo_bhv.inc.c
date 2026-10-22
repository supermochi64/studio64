// Copied from ../sm64-master/data/sh_enemies_tokyo_bhv.inc.c by tools/import_shoggoth_tokyo.mjs - do not edit.
/* Tokyo's enemies: behavior scripts (Shoggoth World) -- included at the end of behavior_data.c */

// data/ is a source directory, so the Makefile also compiles this file on its own: only emit the
// scripts inside behavior_data.c (which defines the BC_* script macros).
#ifdef BC_B

// Chochin-obake: a paper-lantern yokai (bparam1: 0 white shrine lantern, 1 red yokocho lantern)
const BehaviorScript bhvTkChochin[] = {
    BEGIN(OBJ_LIST_GENACTOR),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    SET_HOME(),
    SET_FLOAT(oDrawingDistance, 5000),
    CALL_NATIVE(bhv_tk_chochin_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_chochin_loop),
    END_LOOP(),
};

// the models' own animation loops (levels/tokyo/geo.c, tools/shoggoth/courses/tk2/yokai.py)
extern const struct Animation *const tokyo_tke_kappa_anims[];
extern const struct Animation *const tokyo_tke_tanuki_anims[];

// Kappa: lurks in the canal (home on the water surface), leaps onto the riverwalks
const BehaviorScript bhvTkKappa[] = {
    BEGIN(OBJ_LIST_PUSHABLE),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_SET_FACE_YAW_TO_MOVE_YAW | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    LOAD_ANIMATIONS(oAnimations, tokyo_tke_kappa_anims),
    ANIMATE(0),
    SET_HOME(),
    SET_OBJ_PHYSICS(/*Wall hitbox radius*/ 50, /*Gravity*/ -400, /*Bounciness*/ -50, /*Drag strength*/ 1000, /*Friction*/ 1000, /*Buoyancy*/ 200, /*Unused*/ 0, 0),
    SET_FLOAT(oDrawingDistance, 5000),
    CALL_NATIVE(bhv_tk_kappa_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_kappa_loop),
    END_LOOP(),
};

// Tanuki: disguised (bparam1: 1 traffic cone, 2 post box, 3 its statue) until Mario comes close
const BehaviorScript bhvTkTanuki[] = {
    BEGIN(OBJ_LIST_PUSHABLE),
    OR_INT(oFlags, (OBJ_FLAG_COMPUTE_ANGLE_TO_MARIO | OBJ_FLAG_COMPUTE_DIST_TO_MARIO | OBJ_FLAG_SET_FACE_YAW_TO_MOVE_YAW | OBJ_FLAG_UPDATE_GFX_POS_AND_ANGLE)),
    LOAD_ANIMATIONS(oAnimations, tokyo_tke_tanuki_anims),
    ANIMATE(0),
    DROP_TO_FLOOR(),
    SET_HOME(),
    SET_OBJ_PHYSICS(/*Wall hitbox radius*/ 45, /*Gravity*/ -400, /*Bounciness*/ -50, /*Drag strength*/ 1000, /*Friction*/ 1000, /*Buoyancy*/ 0, /*Unused*/ 0, 0),
    SET_FLOAT(oDrawingDistance, 5000),
    CALL_NATIVE(bhv_tk_tanuki_init),
    BEGIN_LOOP(),
        CALL_NATIVE(bhv_tk_tanuki_loop),
    END_LOOP(),
};

#endif
