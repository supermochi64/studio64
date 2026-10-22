// The generated Tokyo data's declarations (gen/tokyo/header.h, when tools/import_shoggoth_tokyo.mjs
// made it), for the files that point at its models: the catalog (src/studio/gen/catalog.inc.c) and
// the behaviors in this folder.
#ifndef STUDIO_TOKYO_DATA_H
#define STUDIO_TOKYO_DATA_H

#include "tokyo.h"

#if __has_include("gen/tokyo/header.h")
// (the decomp's newer type name the generated data uses)
typedef u8 Texture;
// Shoggoth World draws its additive light in the transparent layer
#ifndef LAYER_ADD
#define LAYER_ADD LAYER_TRANSPARENT
#endif
#include "gen/tokyo/header.h"
extern const GeoLayout tokyo_city_geo[];
#define STUDIO_TOKYO_HAS_DATA 1
#endif

#endif
