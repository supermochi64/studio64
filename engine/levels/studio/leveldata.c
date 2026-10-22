#include <ultra64.h>
#include "sm64.h"
#include "surface_terrains.h"
#include "macro_preset_names.h"
#include "special_preset_names.h"

#include "make_const_nonconst.h"

// Only a death plane far below; terrain and blocks are added at runtime.
const Collision studio_area1_collision[] = {
    COL_INIT(),
    COL_VERTEX_INIT(4),
    COL_VERTEX(-16000, -6000, -16000),
    COL_VERTEX( 16000, -6000, -16000),
    COL_VERTEX( 16000, -6000,  16000),
    COL_VERTEX(-16000, -6000,  16000),
    COL_TRI_INIT(SURFACE_DEATH_PLANE, 2),
    COL_TRI(0, 3, 2),
    COL_TRI(0, 2, 1),
    COL_TRI_STOP(),
    COL_END(),
};
