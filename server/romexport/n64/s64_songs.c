// The project's songs in the ROM (the sound studio's, imported sequences: the table at
// gS64Info.songsRom). An area's song and the story's play from the credits' sequence slot, as in
// the web build (the engine's audio.c), their data read from the ROM like the game's own.
#include <ultra64.h>

#include "sm64.h"
#include "audio/external.h"
#include "audio/heap.h"
#include "audio/internal.h"
#include "audio/load.h"
#include "audio/seqplayer.h"
#include "s64_hack.h"

#define SLOT_LEVEL 0x1A

extern ALSeqFile *gSeqFileHeader;
extern u8 *gAlBankSets;
extern void dma_read(u8 *dest, u8 *srcStart, u8 *srcEnd);
void studio_reset_current_music(void);
void *malloc(u32 size);

struct S64Song {
    u32 rom;
    u32 len;
    u32 bank;
    u32 pad;
};
static struct S64Song *sSongs;
static s32 sInstalled = -1;

void s64_songs_init(void) {
    u32 size;
    if (!s64_info_valid() || gS64Info.songsRom == 0 || gS64Info.songCount == 0) {
        return;
    }
    size = gS64Info.songCount * sizeof(struct S64Song);
    sSongs = malloc((size + 15) & ~15);
    if (sSongs != NULL) {
        dma_read((u8 *) sSongs, (u8 *) gS64Info.songsRom, (u8 *) gS64Info.songsRom + size);
    }
}

// A sequence from the ROM in a slot of the game's sequences, with the one bank it plays (what played
// the slot stops; the next music starts it even when the slot was playing before). -> the slot, or -1
s32 s64_seq_install(s32 slot, u32 rom, u32 len, s32 bank) {
    struct SoundMultiPool *pool = &gSeqLoadedPool;
    u32 i;
    u16 off;
    if (gSeqFileHeader == NULL || gAlBankSets == NULL) {
        return -1;
    }
    for (i = 0; i < SEQUENCE_PLAYERS; i++) {
        if (gSequencePlayers[i].enabled && gSequencePlayers[i].seqId == slot) {
            sequence_player_disable(&gSequencePlayers[i]);
        }
    }
    // the sequence pool keeps loaded sequences by id: forget the slot's old one
    for (i = 0; i < pool->persistent.numEntries; i++) {
        if (pool->persistent.entries[i].id == slot) {
            pool->persistent.entries[i].id = -1;
        }
    }
    for (i = 0; i < 2; i++) {
        if (pool->temporary.entries[i].id == slot) {
            pool->temporary.entries[i].id = -1;
        }
    }
    gSeqLoadStatus[slot] = SOUND_LOAD_STATUS_NOT_LOADED;
    gSeqFileHeader->seqArray[slot].offset = (u8 *) rom;
    gSeqFileHeader->seqArray[slot].len = len;
    // the slot lists exactly one bank: make it this one
    off = ((u16 *) gAlBankSets)[slot];
    gAlBankSets[off] = 1;
    gAlBankSets[off + 1] = (u8) bank;
    return slot;
}

// The song becomes the level slot's sequence. -> the sequence to play, or -1
s32 s64_song_install(s32 index) {
    struct S64Song *sg;
    if (sSongs == NULL || index < 0 || index >= (s32) gS64Info.songCount) {
        return -1;
    }
    if (sInstalled == index) {
        return SLOT_LEVEL;
    }
    sg = &sSongs[index];
    if (s64_seq_install(SLOT_LEVEL, sg->rom, sg->len, sg->bank) < 0) {
        return -1;
    }
    sInstalled = index;
    studio_reset_current_music();
    return SLOT_LEVEL;
}
