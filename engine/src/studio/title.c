// Studio 64: the hack's launch screen (web/js/title/). The page draws the logo, "Press Start",
// the splash screens and the file select over the game; the engine gives it a background:
//
//  - the game's own title screen: Mario's face (Goddard) over the title backdrop, optionally
//    after the game's 3D logo, and optionally without the face (studio_title_enter), and
//  - a live level behind the logo: Mario hidden and still, the HUD off (studio_title_scene),
//    while the page flies the camera (studio_set_camera).
//
// The title screen is the game's normal path back to the title (fade_into_special_warp(-2), as
// after a game over). The page decides when it ends: studio_title_leave() boots a level again
// through the same level select path Studio 64 boots with (gStudioBootLevel).
#include <ultra64.h>
#include "sm64.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/area.h"
#include "game/object_list_processor.h"
#include "engine/graph_node.h"
#include "object_fields.h"
#include "level_table.h"

#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

extern s32 gStudioBootLevel;
extern s32 gStudioBootAct;
extern s32 gStudioHideHud;
void fade_into_special_warp(u32 arg, u32 color);

// 0 none, 1 on the way to the title, 2 the title screen is up, 3 leaving it
s32 gStudioTitle = 0;
s32 gStudioTitleNoHead = 0;
static s32 sScene = 0;

// Called by the game's own code (level_select_menu.c, mario_misc.c, studio.c).
s32 studio_title_active(void) {
    return gStudioTitle == 1 || gStudioTitle == 2;
}
s32 studio_title_hide_head(void) {
    return studio_title_active() && gStudioTitleNoHead;
}
// The title screen's loop runs (lvl_intro_update): the page's launch screen is up.
void studio_title_tick(void) {
    if (gStudioTitle == 1) {
        gStudioTitle = 2;
    }
}

// Go to the game's title screen. logo: the game's 3D logo first; head: Mario's face on it.
EMSCRIPTEN_KEEPALIVE
s32 studio_title_enter(s32 logo, s32 head) {
    if (gStudioTitle != 0) {
        gStudioTitleNoHead = !head;
        return 0;
    }
    gStudioTitleNoHead = !head;
    gStudioTitle = 1;
    sScene = 0;
    gStudioHideHud = FALSE;
    fade_into_special_warp(logo ? (u32) -8 : (u32) -2, 0);
    return 1;
}

// Mario's face on or off while the title is up.
EMSCRIPTEN_KEEPALIVE
void studio_title_head(s32 head) {
    gStudioTitleNoHead = !head;
}

// Leave the title screen for a level (the page warps on to the hack's start from there).
EMSCRIPTEN_KEEPALIVE
s32 studio_title_leave(s32 level) {
    if (!studio_title_active()) {
        return 0;
    }
    gStudioBootLevel = level > 0 ? level : LEVEL_CASTLE_GROUNDS;
    gStudioBootAct = 1;
    gStudioTitle = 3;
    return 1;
}

// 0 none, 1 going there, 2 up, 3 leaving (back to 0 when a level loads again).
EMSCRIPTEN_KEEPALIVE
s32 studio_title_state(void) {
    return gStudioTitle;
}

// An area loaded (studio.c): TRUE while it is the title screen or the way out of it (the
// level select step still has the boot level to go to), which the page must not patch.
s32 studio_title_area_load(void) {
    if (gStudioTitle == 1 || gStudioTitle == 2) {
        return TRUE;
    }
    if (gStudioTitle == 3) {
        if (gStudioBootLevel != 0) {
            return TRUE;
        }
        gStudioTitle = 0;
    }
    return FALSE;
}

// A level behind the launch screen: Mario hidden and still (ACT_DISAPPEARED does nothing
// without an argument), no HUD. Off: he stands again (the page warps on to the start anyway).
EMSCRIPTEN_KEEPALIVE
void studio_title_scene(s32 on) {
    struct MarioState *m = gMarioState;
    sScene = on;
    gStudioHideHud = on ? TRUE : FALSE;
    if (gMarioObject == NULL || m == NULL || m->marioObj == NULL) {
        return;
    }
    if (on) {
        set_mario_action(m, ACT_DISAPPEARED, 0);
        m->marioObj->oIntangibleTimer = -1;
    } else {
        m->marioObj->header.gfx.node.flags |= GRAPH_RENDER_ACTIVE;
        m->marioObj->oIntangibleTimer = 0;
        if (m->action == ACT_DISAPPEARED) {
            set_mario_action(m, ACT_IDLE, 0);
        }
    }
}

EMSCRIPTEN_KEEPALIVE
s32 studio_title_scene_on(void) {
    return sScene;
}

// The title backdrop's tile (4 strips of 80x20): the page can replace them with its own
// picture through the texture overrides (assets.c studio_tex_set).
extern const u8 *const mario_title_texture_table[];
EMSCRIPTEN_KEEPALIVE
const u8 *studio_title_tile(s32 i) {
    return (i >= 0 && i < 4) ? mario_title_texture_table[i] : NULL;
}
