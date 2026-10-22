// Studio 64 audio: songs from the sound composer played by the game's own sequence
// player (so they use the game's instruments), the game's sound effects on demand
// for the sound library, and game sound effects the page replaces with its own.
#include <ultra64.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <emscripten.h>

#include "sm64.h"
#include "audio_defines.h"
#include "audio/external.h"
#include "audio/heap.h"
#include "audio/internal.h"
#include "audio/load.h"
#include "audio/seqplayer.h"
#include "game/area.h"
#include "game/sound_init.h"
#include "studio.h"

void play_sequence(u8 player, u8 seqId, u16 fadeTimer);
extern ALSeqFile *gSeqFileHeader;
extern u8 *gAlBankSets;

// Two sequence slots the studio never otherwise plays carry the composed songs.
#define SLOT_LEVEL 0x1A   // the credits: the level's own song
#define SLOT_PREVIEW 0x20 // the ending: songs and instruments heard in the composer

static u8 *sSongData[2];

// Build mode is silent; the sound studio keeps the sound on while it is open.
s32 gStudioAudioHold;

EMSCRIPTEN_KEEPALIVE
void studio_audio_hold(s32 on) {
    gStudioAudioHold = on;
}

static void stop_players_using(s32 seqId) {
    s32 i;
    for (i = 0; i < SEQUENCE_PLAYERS; i++) {
        if (gSequencePlayers[i].enabled && gSequencePlayers[i].seqId == seqId) {
            sequence_player_disable(&gSequencePlayers[i]);
        }
    }
}

// The sequence pool keeps loaded songs by id: forget the slot's old song.
static void forget_cached_seq(s32 seqId) {
    struct SoundMultiPool *pool = &gSeqLoadedPool;
    u32 i;
    for (i = 0; i < pool->persistent.numEntries; i++) {
        if (pool->persistent.entries[i].id == seqId) {
            pool->persistent.entries[i].id = -1;
        }
    }
    for (i = 0; i < 2; i++) {
        if (pool->temporary.entries[i].id == seqId) {
            pool->temporary.entries[i].id = -1;
        }
    }
    gSeqLoadStatus[seqId] = SOUND_LOAD_STATUS_NOT_LOADED;
}

// Puts a song (.m64 bytes, instruments from `bank`) in the level slot or the preview
// slot; returns its sequence id.
EMSCRIPTEN_KEEPALIVE
s32 studio_song_install(s32 preview, const u8 *data, s32 len, s32 bank) {
    s32 seqId = preview ? SLOT_PREVIEW : SLOT_LEVEL;
    s32 k = preview ? 1 : 0;
    u16 off;
    if (gSeqFileHeader == NULL || gAlBankSets == NULL || len <= 0 || len > 0x3000) {
        return -1;
    }
    stop_players_using(seqId);
    forget_cached_seq(seqId);
    free(sSongData[k]);
    // the loader copies len + 15 bytes rounded up to 16
    sSongData[k] = calloc(1, len + 32);
    memcpy(sSongData[k], data, len);
    gSeqFileHeader->seqArray[seqId].offset = sSongData[k];
    gSeqFileHeader->seqArray[seqId].len = len;
    // both slots list exactly one bank: make it the song's
    off = ((u16 *) gAlBankSets)[seqId];
    gAlBankSets[off] = 1;
    gAlBankSets[off + 1] = (u8) bank;
    return seqId;
}

// Plays any sequence on the music player right away (the library and the composer).
EMSCRIPTEN_KEEPALIVE
void studio_music_preview(s32 seqId) {
    if (seqId < 0) {
        sequence_player_fade_out(SEQ_PLAYER_LEVEL, 1);
        return;
    }
    stop_players_using(seqId);
    play_sequence(SEQ_PLAYER_LEVEL, seqId, 0);
}

// Back to the area's own music (after previews, or a newly installed level song).
EMSCRIPTEN_KEEPALIVE
void studio_music_restore(void) {
    studio_reset_current_music();
    if (gCurrentArea != NULL) {
        set_background_music(gCurrentArea->musicParam, gCurrentArea->musicParam2, 0);
    }
}

// The area's own music again (after a song or other game music was picked for it).
EMSCRIPTEN_KEEPALIVE
void studio_music_original(void) {
    extern s16 gStudioAreaMusic;
    if (gCurrentArea != NULL) {
        gCurrentArea->musicParam2 = gStudioAreaMusic;
    }
    studio_music_restore();
}

// The level slot as the area's music, started now.
EMSCRIPTEN_KEEPALIVE
s32 studio_song_slot(void) {
    return SLOT_LEVEL;
}

// ---------------------------------------------------------------------------
// Sound effects

EMSCRIPTEN_KEEPALIVE
void studio_sfx_play(u32 bits) {
    play_sound(bits, gDefaultSoundArgs);
}

#define MAX_SFX_OVERRIDES 96
#define SFX_KEY(bits) ((bits) & (SOUNDARGS_MASK_BANK | SOUNDARGS_MASK_SOUNDID))

static u32 sSfxKey[MAX_SFX_OVERRIDES];
static s32 sSfxId[MAX_SFX_OVERRIDES];
static s32 sSfxCount;

EMSCRIPTEN_KEEPALIVE
void studio_sfx_override_clear(void) {
    sSfxCount = 0;
}

EMSCRIPTEN_KEEPALIVE
void studio_sfx_override(u32 bits, s32 id) {
    if (sSfxCount < MAX_SFX_OVERRIDES) {
        sSfxKey[sSfxCount] = SFX_KEY(bits);
        sSfxId[sSfxCount] = id;
        sSfxCount++;
    }
}

// Called for every sound the game plays: a replaced one goes to the page instead,
// with how far away it is (pos is relative to the camera).
s32 studio_sfx_hook(s32 bits, f32 *pos) {
    s32 i;
    u32 key;
    if (sSfxCount == 0) {
        return FALSE;
    }
    key = SFX_KEY((u32) bits);
    for (i = 0; i < sSfxCount; i++) {
        if (sSfxKey[i] == key) {
            f32 dist = 0;
            if (pos != NULL && pos != gDefaultSoundArgs) {
                dist = sqrtf(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
            }
            EM_ASM({
                if (Module.studioSfx) Module.studioSfx($0, $1);
            }, sSfxId[i], dist);
            return TRUE;
        }
    }
    return FALSE;
}

// Debugging aid: what the music player is doing and how loud the last audio was.
static f32 sAudioPeak;

void studio_audio_level(const s16 *samples, s32 count) {
    s32 i;
    for (i = 0; i < count; i++) {
        f32 v = samples[i] < 0 ? -samples[i] : samples[i];
        if (v > sAudioPeak) sAudioPeak = v;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_music_debug(void) {
    struct SequencePlayer *p = &gSequencePlayers[SEQ_PLAYER_LEVEL];
    s32 i, channels = 0;
    for (i = 0; i < CHANNELS_MAX; i++) {
        if (IS_SEQUENCE_CHANNEL_VALID(p->channels[i]) && p->channels[i]->enabled) channels++;
    }
    EM_ASM({ console.warn('music: enabled ' + $0 + ' seq ' + $1 + ' tempo ' + $2 + ' channels ' + $3 + ' peak ' + $4); },
           p->enabled, p->seqId, p->tempo / TATUMS_PER_BEAT, channels, (s32) sAudioPeak);
    sAudioPeak = 0;
}
