// What the engine's Studio 64 modules expect from the web build's editor and page, in the ROM:
// there is no build mode, nothing relights blocks (the export baked their light), and imported
// models are part of the level.
#include <ultra64.h>

#include "sm64.h"
#include "game/ingame_menu.h"
#include "audio/external.h"
#include "studio/studio_assets.h"

s32 gStudioPaused = FALSE;
s32 gStudioHideHud = FALSE;
s32 gStudioAreaMusic = 0;
s32 gStudioForceReload = FALSE; // (the editor's level reloads)
s32 gStudioIntroMode = 0;

void studio_blocks_relight(void) {
}

void studio_models_relight(void) {
}

struct GraphNode *studio_asset_model_node(s32 id) {
    (void) id;
    return NULL;
}

s16 *studio_asset_model_collision(s32 id) {
    (void) id;
    return NULL;
}

void s64_glue_frame(void) {
}

// the story's cutscene camera (camera.c, rendering_graph_node.c)
s32 gStudioCamEnabled = FALSE;
f32 gStudioCamPos[3], gStudioCamFocus[3], gStudioCamFov;

f32 s64_fov(f32 fov) {
    return gStudioCamEnabled && gStudioCamFov > 0.0f ? gStudioCamFov : fov;
}

// Mario carries the shotgun or the katana: their modules set these, the game's drawing reads them
s32 gStudioShotgunDraw;
s32 gStudioKatanaDraw;

// What Tokyo's city object adds to the collision in the web build (world.c): in the ROM the city is
// part of the level (the export bakes it), so the object is never placed and these are never needed.
s32 studio_surface_has_force(s16 type) {
    (void) type;
    return FALSE;
}

void studio_add_static_tri(s16 *a, s16 *b, s16 *c, s16 type) {
    (void) a;
    (void) b;
    (void) c;
    (void) type;
}

void studio_rebuild_collision(void) {
}
