#ifndef STUDIO_ASSETS_H
#define STUDIO_ASSETS_H

// Imported models, texture replacement, custom materials, skyboxes and Mario's
// colours (src/studio/assets.c). Other studio features can draw imported models:
// studio_asset_model_node(id) is the model's graph node (NULL when not loaded),
// studio_asset_model_collision(id) its object collision (max 200 vertices).

#include <PR/ultratypes.h>
#include "types.h"

// material flags (studio_model_material)
#define ASSET_MAT_OPAQUE 0
#define ASSET_MAT_CUTOUT 1
#define ASSET_MAT_BLEND 2
#define ASSET_MAT_DOUBLE 4 // no back-face culling
#define ASSET_MAT_UNLIT 128 // flat colours: the area's light does not shade it
// bits 3-4: s wrap, bits 5-6: t wrap (0 repeat, 1 mirror, 2 clamp)

// placement flags (studio_model_spawn)
#define ASSET_PLACE_COLLISION 1
#define ASSET_PLACE_LEVEL 2     // level geometry: always static collision
#define ASSET_PLACE_INVISIBLE 4 // collision only

enum { ASSET_ANIM_NONE, ASSET_ANIM_SPIN, ASSET_ANIM_BOB, ASSET_ANIM_SPIN_BOB, ASSET_ANIM_SWAY, ASSET_ANIM_PULSE };

#define ASSET_CUSTOM_MATERIAL_BASE 48
#define ASSET_CUSTOM_MATERIALS 16

enum { ASSET_MARIO_OVERALLS, ASSET_MARIO_SHIRT, ASSET_MARIO_GLOVES, ASSET_MARIO_SHOES, ASSET_MARIO_SKIN,
       ASSET_MARIO_HAIR, ASSET_MARIO_CAP, ASSET_MARIO_PARTS };

struct GraphNode *studio_asset_model_node(s32 id);
s16 *studio_asset_model_collision(s32 id);

// hooks
s32 studio_texture_override(const u8 *addr, const u8 **rgba, u32 *w, u32 *h); // gfx_pc.c
void studio_texture_seen(const u8 *addr, u32 fmt, u32 siz);                   // gfx_pc.c
void studio_assets_add_surfaces(void);                                        // world.c, collision rebuild
void studio_assets_apply_water(void);                                         // world.c, after the level's water
const u8 *studio_custom_material_texels(s32 index);                           // editor.c / world.c
void bhv_studio_model_loop(void);                                             // behavior_data.c

#endif
