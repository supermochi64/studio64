#ifndef S64_HACK_H
#define S64_HACK_H

#include <PR/ultratypes.h>
#include "types.h"

// Studio 64: what an exported hack says about itself (server/romexport/rom.js writes it at
// S64_INFO_ROM, after the base ROM; a ROM without it plays like the original game)
#define S64_INFO_ROM 0x1000000
#define S64_INFO_MAGIC 0x53363448 // "S64H"
#define S64_INFO_NO_INTRO (1 << 0)

struct S64Info {
    /*0x000*/ u32 magic;
    /*0x004*/ u16 version;
    /*0x006*/ s16 startLevel;    // the level a save file starts in (0: the castle grounds)
    /*0x008*/ u16 namedCourses;  // bit i: course i + 1 has its own name and act names
    /*0x00A*/ u16 flags;
    /*0x00C*/ u32 customLevels[2]; // bit n: level n is the hack's own (no vanilla camera triggers or music zones)
    /*0x014*/ s16 exitLevel;     // where "Exit course" leads (0: the castle)
    /*0x016*/ u8 exitArea;
    /*0x017*/ u8 exitNode;
    /*0x018*/ u32 ovlDir;        // Studio 64's modules in the ROM (s64_ovl.c), and which ones the hack uses
    /*0x01C*/ u32 modules;
    /*0x020*/ u8 courseNames[15][32];
    /*0x200*/ u8 actNames[15][6][32];
    /*0xD40*/ u32 levelData[40]; // per level: where its Studio 64 data is in its block (segment 0x0E), or 0
    /*0xDE0*/ u32 storyRom;      // the story (s64_story.c) in the ROM, and its size
    /*0xDE4*/ u32 storySize;
    /*0xDE8*/ u32 songsRom;      // the project's songs (s64_songs.c): per song rom, length, bank, 0
    /*0xDEC*/ u32 songCount;
    /*0xDF0*/ u32 sfxRom;        // the project's sound effects (s64_sfx.c), and how many
    /*0xDF4*/ u32 sfxCount;
    /*0xDF8*/ u32 reserved3[2];
}; // 0xE00

extern struct S64Info gS64Info;

void s64_load_info(void);
s32 s64_info_valid(void);
s32 s64_is_custom_level(s32 level);
s32 s64_skip_intro(void);
s32 s64_start_level(s16 defaultLevel, s32 reg);

// the engine's Studio 64 code in the ROM (s64_core.c)
void s64_area_loaded(void);
void s64_frame(void);
s32 s64_story_hidden(u32 uid);
void s64_story_star(struct Object *o);
void s64_story_render(void);
void s64_warp_to(s16 level, s16 area, s16 node);
void s64_ovl_reset(void);
s32 s64_level_modules(s16 mask, s32 reg);

#endif
