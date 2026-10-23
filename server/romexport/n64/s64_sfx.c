// The project's sound effects in the ROM (the game sounds it replaced: audio.overrides). The export
// puts each one in the ROM as an N64 sample (VADPCM, vadpcm.js) with a short sequence that plays it
// once; when the game asks for a replaced sound (play_sound), that sequence plays on the jingles'
// player instead, its instrument built here: the sound bank Studio 64 adds to the game (0x27) is
// only a placeholder for these (their sounds become these sounds' samples).
#include <ultra64.h>

#include "sm64.h"
#include "audio/external.h"
#include "audio/internal.h"
#include "audio/load.h"
#include "audio/effects.h"
#include "game/game_init.h"
#include "s64_hack.h"

#define SFX_BANK 0x27
#define SFX_SLOT 0x20  // the ending's music: what plays a sound
#define MAX_SFX 16
#define REPEAT_GAP 4   // frames: a sound the game asks for every frame (footsteps) starts at most this often

extern struct CtlEntry *gCtlEntries;
extern void dma_read(u8 *dest, u8 *srcStart, u8 *srcEnd);
s32 s64_seq_install(s32 slot, u32 rom, u32 len, s32 bank);
void seq_player_play_sequence(u8 player, u8 seqId, u16 arg2);
void *malloc(u32 size);

// in the ROM (gS64Info.sfxRom): per sound
struct S64Sfx {
    u32 key;         // the game sound's bank and id (SOUNDARGS_MASK_BANK | SOUNDARGS_MASK_SOUNDID)
    u32 seqRom, seqLen;
    u32 sampleRom, sampleBytes, samples;
    f32 tuning;
    u32 pad;
    s16 book[32];    // order 2, two predictors
};

struct BuiltSfx {
    struct Instrument inst;
    struct AudioBankSample sample;
    struct AdpcmLoop loop;
    struct {
        s32 order, npredictors;
        s16 book[32];
    } book;
};

static struct S64Sfx *sSfx;
static struct BuiltSfx *sBuilt;
static s32 sCount;
static u32 sLastPlayed[MAX_SFX];
static struct AdsrEnvelope sEnvelope[2] = { { 1, 32700 }, { ADSR_HANG, 0 } };

void s64_sfx_init(void) {
    s32 i;
    u32 size;
    if (!s64_info_valid() || gS64Info.sfxRom == 0 || gS64Info.sfxCount == 0) {
        return;
    }
    sCount = MIN((s32) gS64Info.sfxCount, MAX_SFX);
    size = sCount * sizeof(struct S64Sfx);
    sSfx = malloc((size + 15) & ~15);
    sBuilt = malloc(sCount * sizeof(struct BuiltSfx) + 16);
    if (sSfx == NULL || sBuilt == NULL) {
        sCount = 0;
        return;
    }
    dma_read((u8 *) sSfx, (u8 *) gS64Info.sfxRom, (u8 *) gS64Info.sfxRom + size);
    for (i = 0; i < sCount; i++) {
        struct BuiltSfx *b = &sBuilt[i];
        bzero(b, sizeof(*b));
        b->book.order = 2;
        b->book.npredictors = 2;
        bcopy(sSfx[i].book, b->book.book, sizeof(b->book.book));
        b->loop.start = 0;
        b->loop.end = sSfx[i].samples;
        b->loop.count = 0;
        b->sample.loaded = 1;
        b->sample.sampleAddr = (u8 *) sSfx[i].sampleRom;
        b->sample.loop = &b->loop;
        b->sample.book = (struct AdpcmBook *) &b->book;
        b->sample.sampleSize = sSfx[i].sampleBytes;
        b->inst.loaded = 1;
        b->inst.normalRangeLo = 0;
        b->inst.normalRangeHi = 127;
        b->inst.releaseRate = 208;
        b->inst.envelope = sEnvelope;
        b->inst.lowNotesSound.sample = b->inst.normalNotesSound.sample = b->inst.highNotesSound.sample = &b->sample;
        b->inst.lowNotesSound.tuning = b->inst.normalNotesSound.tuning = b->inst.highNotesSound.tuning = sSfx[i].tuning;
    }
}

// external.c, play_sound: TRUE when the project plays its own sound instead
s32 s64_sfx_hook(s32 soundBits, f32 *pos) {
    u32 key = (u32) soundBits & (SOUNDARGS_MASK_BANK | SOUNDARGS_MASK_SOUNDID);
    s32 i;
    (void) pos;
    for (i = 0; i < sCount; i++) {
        if (sSfx[i].key != key) {
            continue;
        }
        if (gGlobalTimer - sLastPlayed[i] >= REPEAT_GAP) {
            sLastPlayed[i] = gGlobalTimer;
            if (s64_seq_install(SFX_SLOT, sSfx[i].seqRom, sSfx[i].seqLen, SFX_BANK) >= 0) {
                seq_player_play_sequence(SEQ_PLAYER_ENV, SFX_SLOT, 0);
                // the bank is loaded now: its instrument i (a placeholder in the bank's memory, where
                // the game wants instruments to be) plays this sound
                if (gCtlEntries[SFX_BANK].instruments != NULL && i < gCtlEntries[SFX_BANK].numInstruments) {
                    struct Instrument *inst = gCtlEntries[SFX_BANK].instruments[i];
                    if (inst != NULL) {
                        inst->lowNotesSound = inst->normalNotesSound = inst->highNotesSound = sBuilt[i].inst.normalNotesSound;
                    }
                }
            }
        }
        return TRUE;
    }
    return FALSE;
}
