#include <ultra64.h>
#include "sm64.h"
#include "behavior_data.h"
#include "model_ids.h"
#include "seq_ids.h"
#include "dialog_ids.h"
#include "segment_symbols.h"
#include "level_commands.h"

#include "game/level_update.h"

#include "levels/scripts.h"

#include "make_const_nonconst.h"
#include "levels/studio/header.h"

#define STUDIO_SUB_AREA(i) \
    AREA(i, studio_geo_area1), \
        OBJECT(MODEL_NONE, 0, 600, 0, 0, 0, 0, 0x000A0000, bhvSpinAirborneWarp), \
        WARP_NODE(0x0A, LEVEL_STUDIO, i, 0x0A, WARP_NO_CHECKPOINT), \
        WARP_NODE(0xF0, LEVEL_CASTLE, 0x01, 0x26, WARP_NO_CHECKPOINT), \
        WARP_NODE(0xF1, LEVEL_CASTLE, 0x01, 0x23, WARP_NO_CHECKPOINT), \
        TERRAIN(studio_area1_collision), \
        SET_BACKGROUND_MUSIC(0x0000, SEQ_LEVEL_GRASS), \
        TERRAIN_TYPE(TERRAIN_GRASS), \
    END_AREA()

const LevelScript level_studio_entry[] = {
    INIT_LEVEL(),
    ALLOC_LEVEL_POOL(),
    MARIO(/*model*/ MODEL_MARIO, /*behParam*/ 0x00000001, /*beh*/ bhvMario),

    AREA(/*index*/ 1, studio_geo_area1),
        // the page moves this to the level's spawn point while the area loads
        OBJECT(/*model*/ MODEL_NONE, /*pos*/ 0, 600, 0, /*angle*/ 0, 0, 0, /*behParam*/ 0x000A0000, /*beh*/ bhvSpinAirborneWarp),
        WARP_NODE(/*id*/ 0x0A, /*destLevel*/ LEVEL_STUDIO, /*destArea*/ 0x01, /*destNode*/ 0x0A, /*flags*/ WARP_NO_CHECKPOINT),
        // leaving and dying go back to the castle, like the secret slide (no painting to fall out of)
        WARP_NODE(/*id*/ 0xF0, /*destLevel*/ LEVEL_CASTLE, /*destArea*/ 0x01, /*destNode*/ 0x26, /*flags*/ WARP_NO_CHECKPOINT),
        WARP_NODE(/*id*/ 0xF1, /*destLevel*/ LEVEL_CASTLE, /*destArea*/ 0x01, /*destNode*/ 0x23, /*flags*/ WARP_NO_CHECKPOINT),
        // no 0xF3 (warp floor) node: falling off, a death height or a death zone is a death (a
        // life less, out through the castle's death warp), like the docs say; the page adds 0xF3
        // only for "falling leads to" (worldflow.js registerWarps). (It led to the castle's
        // airborne warp 0x20, like the secret slide's end: no life lost, full health.)
        TERRAIN(/*terrainData*/ studio_area1_collision),
        SET_BACKGROUND_MUSIC(/*settingsPreset*/ 0x0000, /*seq*/ SEQ_LEVEL_GRASS),
        TERRAIN_TYPE(/*terrainType*/ TERRAIN_GRASS),
    END_AREA(),

    // sub-areas of a custom level (a building's inside, a cave, ...): the page fills them
    STUDIO_SUB_AREA(2),
    STUDIO_SUB_AREA(3),
    STUDIO_SUB_AREA(4),
    STUDIO_SUB_AREA(5),
    STUDIO_SUB_AREA(6),
    STUDIO_SUB_AREA(7),

    FREE_LEVEL_POOL(),
    MARIO_POS(/*area*/ 1, /*yaw*/ 0, /*pos*/ 0, 600, 0),
    CALL(/*arg*/ 0, /*func*/ lvl_init_or_update),
    CALL_LOOP(/*arg*/ 1, /*func*/ lvl_init_or_update),
    CLEAR_LEVEL(),
    SLEEP_BEFORE_EXIT(/*frames*/ 1),
    EXIT(),
};
