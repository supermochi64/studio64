// The level data of Shoggoth World's Tokyo, written into gen/ by tools/import_shoggoth_tokyo.mjs from
// a Shoggoth World checkout. Its own file: it is big (about 13 MB of C) and only recompiles when the
// import ran again. Without gen/ this file is empty.
#include <ultra64.h>
#include "sm64.h"
#include "types.h"
#include "geo_commands.h"
#include "surface_terrains.h"
#include "moving_texture_macros.h"
#include "level_misc_macros.h"
#include "textures.h"
#include "game/level_geo.h"
#include "game/geo_misc.h"
#include "game/camera.h"
#include "game/moving_texture.h"
#include "game/screen_transition.h"
#include "game/paintings.h"
#include "make_const_nonconst.h"
#include "actors/common0.h"
#include "actors/common1.h"
#include "actors/group15.h"

#include "tokyo_data.h"

#if __has_include("gen/tokyo_data.inc.c")
#include "gen/tokyo_data.inc.c"
#endif
