#ifndef STUDIO_H
#define STUDIO_H

#include <PR/ultratypes.h>
#include "types.h"

// A model as a level script would load it: geo layout (kind 1) or display list (kind 2).
struct StudioModelRef {
    s16 model;
    u8 kind;
    u8 layer;
    const void *gfx;
};

struct StudioCatalogEntry {
    const char *id;
    const BehaviorScript *behavior;
    struct StudioModelRef model;
    const struct StudioModelRef *deps;
    s32 depCount;
};

struct StudioBehavior {
    const char *name;
    const BehaviorScript *script;
};

extern const struct StudioCatalogEntry gStudioCatalog[];
extern const s32 gStudioCatalogCount;
extern const struct StudioBehavior gStudioBehaviors[];
extern const s32 gStudioBehaviorCount;

// Engine hooks
void studio_on_level_init(void);
void studio_note_model(s32 model, s32 kind, const void *gfx);
void studio_on_area_load(void);
void studio_frame(void);
void studio_after_frame(void);
void studio_audio_stats(s32 queued);
void studio_audio_level(const s16 *samples, s32 count);
void studio_set_warp_node(s32 id, s32 destLevel, s32 destArea, s32 destNode);

// level_update.c
void studio_warp_to(s16 level, s16 area, s16 node);

// surface_load.c
void studio_add_static_tri(s16 *a, s16 *b, s16 *c, s16 type);
void studio_rebuild_static_surfaces(void (*addExtra)(void));
s32 studio_surface_has_force(s16 type);

// world.c
#define STUDIO_INTRO_GAME 0 // entered in the game (a painting): the act selector of courses
#define STUDIO_INTRO_JUMP 1 // a studio jump: every level with stars shows them, then goes on by itself
#define STUDIO_INTRO_NONE 2 // no intro (boot, teleports)
extern s32 gStudioIntroMode;
extern s32 gStudioInIntro;
extern s32 gStudioAutoAct;
extern s32 gStudioStarDance; // the star Mario dances for is a studio star
void studio_terrain_reset(void);
void studio_world_frame(void);
s32 studio_is_studio_star(struct Object *o);
void studio_star_collected(struct Object *o, s32 starIndex);

// flow.c: warps, locks, zones, environment
void studio_warp_hook(s16 *level, s16 *area, s16 *node, s32 src);
extern s32 gStudioExitCourse;
extern s32 gStudioIsHub;
s32 studio_door_check(struct MarioState *m, struct Object *obj, u32 *ret);
void studio_door_walk_begin(struct MarioState *m); // doors against a wall (flow.c)
void studio_door_walk(struct MarioState *m);
void studio_door_spawn_side(struct MarioState *m);
void studio_flow_area_load(void);
void studio_flow_frame(void);
s32 studio_play_camera(f32 *pos, f32 *focus);
void studio_env_boxes_apply(void);
extern s32 gStudioFogOn, gStudioTintOn;
extern f32 gStudioFogColor[3], gStudioFogNear, gStudioFogFar, gStudioTint[3];
extern f32 gStudioSunDir[3], gStudioSunColor[3], gStudioAmbient;

// audio.c / sound_init.c
void studio_reset_current_music(void);

// star_select.c
s32 studio_intro_wanted(s32 levelNum, s32 courseNum);
s32 studio_stars_prepare(s32 levelNum, s32 courseNum);
void studio_pause_prepare(void);
void studio_render_pause_level(void);
void studio_render_pause_castle_level(s32 index, s16 x, s16 y);
extern s32 gStudioPauseLevelCount;
void studio_complete_reset(s32 customLevel);
void studio_complete_clear(void);
s32 studio_render_course_complete(void);
extern s32 gStudioCurrentStar;

// story.c
struct DialogEntry;
struct DialogEntry *studio_dialog_entry(s16 id);
s16 studio_dialog_redirect(s16 dialog);
s32 studio_dialog_sound(s16 id);
void studio_story_frame(void);
void studio_story_area(void);
extern s32 gStudioStoryLock, gStudioStorySkip;

#endif
