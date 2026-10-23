// Studio 64's progress in the save file: the story's (events, variables, doors, objects) and the keys
// take the place of each save file's backup copy (save_file.c, patched by base.js). The game's
// game-over reload, which read that copy, gets the file as last saved from RAM instead. Like the
// web build, the game saves by itself when the progress changes.
#include <ultra64.h>
#include <string.h>

#include "sm64.h"
#include "game/area.h"
#include "game/game_init.h"
#include "game/ingame_menu.h"
#include "game/level_update.h"
#include "game/save_file.h"
#include "level_table.h"

#define MAGIC 0x5336
#define SAVE_GAP 150 // frames at least between two saves

extern struct SaveBuffer gSaveBuffer;
extern s32 gStudioStoryLock;
s32 s64_story_pack(u8 *out, s32 size);
void s64_story_unpack(const u8 *in, s32 size);
s32 s64_story_idle(void);

static struct SaveFile sSaved[NUM_SAVE_FILES]; // as last written
static s32 sLoaded = -1;   // the save file the progress belongs to
static s32 sDirty;
static u32 sLastSave;

static u16 checksum(const u8 *p, s32 n) {
    u16 sum = 0x1F2B;
    s32 i;
    for (i = 0; i < n; i++) {
        sum = (u16) ((sum << 1) | (sum >> 15)) ^ p[i];
    }
    return sum;
}

// the progress into a save file's second slot: magic, checksum, the bits
static void pack(struct SaveFile *slot) {
    u8 *b = (u8 *) slot;
    s32 size = sizeof(struct SaveFile) - 4;
    bzero(b, sizeof(struct SaveFile));
    s64_story_pack(b + 4, size);
    b[0] = MAGIC >> 8;
    b[1] = MAGIC & 0xFF;
    *(u16 *) (b + 2) = checksum(b + 4, size);
}

static void unpack(const struct SaveFile *slot) {
    const u8 *b = (const u8 *) slot;
    s32 size = sizeof(struct SaveFile) - 4;
    if (b[0] == (MAGIC >> 8) && b[1] == (MAGIC & 0xFF) && *(const u16 *) (b + 2) == checksum(b + 4, size)) {
        s64_story_unpack(b + 4, size);
    } else {
        s64_story_unpack(NULL, 0);
    }
}

// save_file.c: a file was read (the boot) or written
void s64_save_file_loaded(s32 file, struct SaveFile *main) {
    bcopy(main, &sSaved[file], sizeof(struct SaveFile));
}

void s64_save_file_saved(s32 file, struct SaveFile *main, struct SaveFile *progress) {
    bcopy(main, &sSaved[file], sizeof(struct SaveFile));
    if (file == sLoaded) {
        pack(progress);
        sDirty = FALSE;
    }
}

void s64_save_file_erased(s32 file, struct SaveFile *progress) {
    bzero(progress, sizeof(struct SaveFile));
    if (file == sLoaded) {
        s64_story_unpack(NULL, 0);
    }
}

// after a game over: the file as last saved, and its progress
void s64_save_file_reload(s32 file, struct SaveFile *main) {
    bcopy(&sSaved[file], main, sizeof(struct SaveFile));
    if (file == sLoaded) {
        unpack(&gSaveBuffer.files[file][1]);
    }
}

void s64_save_dirty(void) {
    sDirty = TRUE;
}

// an area is loaded: in a played level, the progress of the file being played
void s64_save_area_loaded(void) {
    s32 file = gCurrSaveFileNum - 1;
    s32 played = gCurrLevelNum >= LEVEL_BBH && gCurrLevelNum != LEVEL_ENDING && gCurrLevelNum != LEVEL_UNKNOWN_32
                 && gCurrLevelNum != LEVEL_UNKNOWN_35 && gCurrLevelNum < LEVEL_UNKNOWN_37;
    if (!played || file < 0 || file >= NUM_SAVE_FILES) {
        sLoaded = -1; // (back in the menus: the next game reads its file again)
        return;
    }
    if (sLoaded != file) {
        sLoaded = file;
        sDirty = FALSE;
        if (gSaveBuffer.files[file][0].flags & SAVE_FLAG_FILE_EXISTS) {
            unpack(&gSaveBuffer.files[file][1]);
        } else {
            s64_story_unpack(NULL, 0); // a new game
        }
    }
}

// every frame: progress made is saved when nothing is going on
void s64_save_frame(void) {
    if (!sDirty || sLoaded < 0 || gGlobalTimer - sLastSave < SAVE_GAP || gStudioStoryLock || get_dialog_id() >= 0
        || !s64_story_idle() || gMarioState == NULL || (gMarioState->action & ACT_FLAG_INTANGIBLE)) {
        return;
    }
    sLastSave = gGlobalTimer;
    gSaveBuffer.files[sLoaded][0].flags |= SAVE_FLAG_FILE_EXISTS;
    gSaveFileModified = TRUE;
    save_file_do_save(sLoaded);
}
