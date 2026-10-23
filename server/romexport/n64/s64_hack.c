#include <ultra64.h>

#include "sm64.h"
#include "game/memory.h"
#include "s64_hack.h"

struct S64Info gS64Info __attribute__((aligned(16)));

extern void dma_read(u8 *dest, u8 *srcStart, u8 *srcEnd);
extern const u8 *const seg2_course_name_table[];
extern const u8 *const seg2_act_name_table[];

// After segment 2 is loaded: the hack's info, and its course and act names in the game's tables
// (segment 0 is RAM, so a name's address below 16 MB is a segmented address too).
void s64_heap_init(void);
void s64_story_init(void);
void s64_songs_init(void);
void s64_sfx_init(void);
void s64_ovl_init(void);

void s64_load_info(void) {
    const u8 **courses;
    const u8 **acts;
    s32 i, k;

    s64_heap_init();
    dma_read((u8 *) &gS64Info, (u8 *) S64_INFO_ROM, (u8 *) S64_INFO_ROM + sizeof(gS64Info));
    if (gS64Info.magic != S64_INFO_MAGIC || gS64Info.version != 1) {
        bzero(&gS64Info, sizeof(gS64Info));
        return;
    }
    courses = segmented_to_virtual(seg2_course_name_table);
    acts = segmented_to_virtual(seg2_act_name_table);
    for (i = 0; i < 15; i++) {
        if (!(gS64Info.namedCourses & (1 << i))) {
            continue;
        }
        courses[i] = (const u8 *) ((uintptr_t) gS64Info.courseNames[i] & 0x00FFFFFF);
        for (k = 0; k < 6; k++) {
            acts[i * 6 + k] = (const u8 *) ((uintptr_t) gS64Info.actNames[i][k] & 0x00FFFFFF);
        }
    }
    s64_ovl_init();
    s64_story_init();
    s64_songs_init();
    s64_sfx_init();
}

s32 s64_info_valid(void) {
    return gS64Info.magic == S64_INFO_MAGIC;
}

s32 s64_is_custom_level(s32 level) {
    if (!s64_info_valid() || level < 0 || level >= 64) {
        return FALSE;
    }
    return (gS64Info.customLevels[level >> 5] >> (level & 31)) & 1;
}

s32 s64_skip_intro(void) {
    return s64_info_valid() && (gS64Info.flags & S64_INFO_NO_INTRO);
}

// The menu script's CALL: the level a save file starts in
s32 s64_start_level(s16 defaultLevel, UNUSED s32 reg) {
    return s64_info_valid() && gS64Info.startLevel > 0 ? gS64Info.startLevel : defaultLevel;
}
