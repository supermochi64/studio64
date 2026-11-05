// Mario's look in the ROM: the colours and the lighting of his parts the project set (info block
// marioLook, written by rom.js), applied with the web build's own code (the engine's mario_look.c).
// A hack without them leaves his model untouched.
#include <ultra64.h>

#include "sm64.h"
#include "game/object_list_processor.h"
#include "s64_hack.h"

s32 studio_mario_color(s32 part, s32 rgb, s32 shade);
s32 studio_mario_light(s32 part, s32 amb, s32 dif);
void studio_mario_light_dir(s32 x, s32 y, s32 z);

// After an area is loaded (areaLoaded) and every frame: once Mario is there (his segments are in memory
// in the game's levels only, not on the title screen or in the menus), his look is applied once.
void s64_mario_look(s32 areaLoaded) {
    static s32 sApplied;
    s32 p;
    if (areaLoaded) {
        sApplied = FALSE;
    }
    if (sApplied || !s64_info_valid() || gS64Info.marioLook == 0 || gMarioObject == NULL) {
        return;
    }
    sApplied = TRUE;
    for (p = 0; p < 7; p++) {
        const struct S64MarioPart *m = &gS64Info.mario[p];
        if (!(gS64Info.marioLook & (1 << p))) {
            continue;
        }
        studio_mario_color(p, m->hasColor ? (m->rgb[0] << 16) | (m->rgb[1] << 8) | m->rgb[2] : -1, 0);
        studio_mario_light(p, m->amb, m->dif);
    }
    if (gS64Info.marioLook & S64_MARIO_DIR) {
        studio_mario_light_dir(gS64Info.marioDir[0], gS64Info.marioDir[1], gS64Info.marioDir[2]);
    }
}
