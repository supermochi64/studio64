// Tokyo from the Shoggoth World hack (tools/import_shoggoth_tokyo.mjs) as Studio 64
// content: the city as one placeable object (tokyo:city: its display lists, collision, water and
// scrolling textures) and its scenery, traffic, people and yokai as library objects ("tokyo:*").
// Without the import (no Shoggoth World checkout), nothing here is in the catalog.
#ifndef STUDIO_TOKYO_H
#define STUDIO_TOKYO_H

#include "types.h"

extern const BehaviorScript bhvTkCity[];
extern const BehaviorScript bhvTkProp[];
extern const BehaviorScript bhvTkCar[];
extern const BehaviorScript bhvTkTrain[];
extern const BehaviorScript bhvTkBoat[];
extern const BehaviorScript bhvTkLift[];
extern const BehaviorScript bhvTkCraneJib[];
extern const BehaviorScript bhvTkPetalEmitter[];
extern const BehaviorScript bhvTkPetal[];
extern const BehaviorScript bhvTkFirefly[];
extern const BehaviorScript bhvTkPedestrian[];
extern const BehaviorScript bhvTkChochin[];
extern const BehaviorScript bhvTkKappa[];
extern const BehaviorScript bhvTkTanuki[];

// Shoggoth World's per-level effect tables (its include/types.h), used by the generated data:
// texture scrolls (a SetTileSize inside a display list, rewritten every frame) and the night light
// that tints Mario (coloured point lights: neon, lanterns, screens).
struct ShScroll {
    Gfx *dl;
    s16 width, height;
    s16 speedS, speedT;
};
struct ShPointLight {
    s16 pos[3];
    s16 radius;
    u8 color[3];
    u8 intensity; // 64 = 1.0
};
struct ShLightEnv {
    u8 ambient[3]; // 128 = 1.0
    u8 moon[3];    // 128 = 1.0
    s16 count;
    struct ShPointLight *lights;
};


// once per frame before the game's (studio.c): scrolling textures, collision after the city moved
void studio_tokyo_frame(void);
// the static collision rebuild (world.c): the city's triangles; its water after the level's
void studio_tokyo_add_surfaces(void);
void studio_tokyo_apply_water(void);

#endif
