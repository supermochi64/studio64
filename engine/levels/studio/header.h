#ifndef STUDIO_HEADER_H
#define STUDIO_HEADER_H

#include "types.h"

// Studio 64: an empty level whose contents (terrain, blocks, objects, sky,
// music, water, spawn) come from the project at runtime.

// geo
extern const GeoLayout studio_geo_area1[];

// leveldata
extern const Collision studio_area1_collision[];

// script
extern const LevelScript level_studio_entry[];

#endif
