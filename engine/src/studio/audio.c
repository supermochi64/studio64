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

// The project's songs in place of the game's own (a sound studio song for "Slider" everywhere,
// a jingle for the star fanfare): the song takes the game song's sequence slot, so everything
// that plays it plays the song. len 0 puts the game's own back.
#define SEQ_SLOTS 0x23
static u8 *sReplaced[SEQ_SLOTS];
static struct { u8 *offset; u32 len; u8 count, bank; } sOriginal[SEQ_SLOTS];

static void replace_slot(s32 seqId, const u8 *data, s32 len, s32 bank);

// (a player that was playing the song goes on with the new one)
EMSCRIPTEN_KEEPALIVE
s32 studio_song_replace(s32 seqId, const u8 *data, s32 len, s32 bank) {
    s32 i, playing[SEQUENCE_PLAYERS];
    if (gSeqFileHeader == NULL || gAlBankSets == NULL || seqId <= 0 || seqId >= SEQ_SLOTS
        || seqId == SLOT_LEVEL || seqId == SLOT_PREVIEW || len < 0 || len > 0x3000 || (len > 0 && data == NULL)) {
        return -1;
    }
    for (i = 0; i < SEQUENCE_PLAYERS; i++) {
        playing[i] = gSequencePlayers[i].enabled && gSequencePlayers[i].seqId == seqId;
    }
    replace_slot(seqId, data, len, bank);
    for (i = 0; i < SEQUENCE_PLAYERS; i++) {
        if (playing[i]) {
            play_sequence(i, seqId, 0);
        }
    }
    return seqId;
}

static void replace_slot(s32 seqId, const u8 *data, s32 len, s32 bank) {
    u16 off;
    off = ((u16 *) gAlBankSets)[seqId];
    if (sReplaced[seqId] == NULL && len == 0) {
        return;
    }
    stop_players_using(seqId);
    forget_cached_seq(seqId);
    if (sReplaced[seqId] == NULL) {
        sOriginal[seqId].offset = gSeqFileHeader->seqArray[seqId].offset;
        sOriginal[seqId].len = gSeqFileHeader->seqArray[seqId].len;
        sOriginal[seqId].count = gAlBankSets[off];
        sOriginal[seqId].bank = gAlBankSets[off + 1];
    }
    free(sReplaced[seqId]);
    sReplaced[seqId] = NULL;
    if (len == 0) {
        gSeqFileHeader->seqArray[seqId].offset = sOriginal[seqId].offset;
        gSeqFileHeader->seqArray[seqId].len = sOriginal[seqId].len;
        gAlBankSets[off] = sOriginal[seqId].count;
        gAlBankSets[off + 1] = sOriginal[seqId].bank;
        return;
    }
    sReplaced[seqId] = calloc(1, len + 32);
    memcpy(sReplaced[seqId], data, len);
    gSeqFileHeader->seqArray[seqId].offset = sReplaced[seqId];
    gSeqFileHeader->seqArray[seqId].len = len;
    gAlBankSets[off] = 1;
    gAlBankSets[off + 1] = (u8) bank;
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
static s32 sSfxCanon; // the keys are canonical (studio_sfx_canon) once the sound player runs

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
        sSfxCanon = FALSE;
    }
}

// A sound's key (bank | id) as one sound: the first id of its bank that plays the same sound script.
// The game asks for some sounds under several ids (Mario's jump voice is one of three random ids, his
// triple jump "Yahoo!" three of five, the long jump's "Yahoo!" is the same clip), so replacing one
// replaces it wherever it plays. (Each bank is a channel of the sound player, its sounds a table.)
u32 studio_sfx_canon(u32 bits) {
    u32 bank = (bits & SOUNDARGS_MASK_BANK) >> SOUNDARGS_SHIFT_BANK;
    u32 id = (bits & SOUNDARGS_MASK_SOUNDID) >> SOUNDARGS_SHIFT_SOUNDID, j;
    struct SequencePlayer *p = &gSequencePlayers[SEQ_PLAYER_SFX];
    struct SequenceChannel *c = bank < CHANNELS_MAX ? p->channels[bank] : NULL;
    if (p->enabled && p->seqData != NULL && c != NULL && IS_SEQUENCE_CHANNEL_VALID(c) && c->dynTable != NULL) {
        u8 (*t)[2] = *c->dynTable;
        for (j = 0; j < id; j++) {
            if (t[j][0] == t[id][0] && t[j][1] == t[id][1]) {
                id = j;
                break;
            }
        }
    }
    return (bank << SOUNDARGS_SHIFT_BANK) | (id << SOUNDARGS_SHIFT_SOUNDID);
}

// The sound player has all its banks' tables (it runs from the game's start on).
static s32 sfx_tables_ready(void) {
    struct SequencePlayer *p = &gSequencePlayers[SEQ_PLAYER_SFX];
    s32 i;
    if (!p->enabled || p->seqData == NULL) return FALSE;
    for (i = 0; i < 10; i++) {
        if (!IS_SEQUENCE_CHANNEL_VALID(p->channels[i]) || p->channels[i]->dynTable == NULL) return FALSE;
    }
    return TRUE;
}

// For tests and the page: the canonical key of a sound (0 before the sound player runs).
EMSCRIPTEN_KEEPALIVE
u32 studio_sfx_key(u32 bits) {
    return sfx_tables_ready() ? studio_sfx_canon(bits) : 0;
}

// ---------------------------------------------------------------------------
// Beta sounds: Mario's voice with the clips of the game that it never plays (the same code runs
// in the exported ROM: s64_sfx.c). The voice bank (sfx_mario) holds three jump voices side by
// side, "hoo" (0), "wah" (1) and a "yah" (2) that no sound of the game uses: the game's own "yah"
// borrows the punch's from the other voice bank. With beta sounds on, the jump "yah" plays the
// unused one (its sound script in the sound player's sequence gets that bank and instrument),
// and the triple jump says yah/wah/hoo as in the 1996 Japanese original ("Waha!" and "Yippee!"
// came with the US release).

#define VOICE_BANK 2 // SOUND_BANK_VOICE: the sound player's channel 2

static s32 sVoiceBeta;
static u8 *sVoicePatched; // the jump "yah" script we patched (the sequence can be loaded again: then it is the game's)

// The sound player's script of voice sound `id` (its dynamic table, as the channel has it), or NULL.
static u8 *voice_script(s32 id) {
    struct SequencePlayer *p = &gSequencePlayers[SEQ_PLAYER_SFX];
    struct SequenceChannel *c = p->channels[VOICE_BANK];
    u32 off;
    if (!p->enabled || p->seqData == NULL || !IS_SEQUENCE_CHANNEL_VALID(c) || c->dynTable == NULL) return NULL;
    off = ((*c->dynTable)[id][0] << 8) | (*c->dynTable)[id][1];
    return p->seqData + off;
}

// chan_setbank 10, chan_setinstr 9 (the punch's "yah") <-> chan_setbank 8, chan_setinstr 2 (the unused "yah")
static void voice_patch(s32 on) {
    u8 *s = voice_script(0);
    if (s == NULL) return;
    if (on && s[0] == 0xC6 && s[1] == 10 && s[2] == 0xC1 && s[3] == 9) {
        s[1] = 8;
        s[3] = 2;
        sVoicePatched = s;
    } else if (!on && s == sVoicePatched && s[0] == 0xC6 && s[1] == 8 && s[2] == 0xC1 && s[3] == 2) {
        s[1] = 10;
        s[3] = 9;
        sVoicePatched = NULL;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_voice_beta(s32 on) {
    sVoiceBeta = on;
    voice_patch(on);
}

// play_sound: TRUE when a beta voice played instead of the sound (the sound player's script is
// patched just before its sound starts: the sequence is loaded by then).
s32 studio_voice_hook(s32 bits, f32 *pos) {
    s32 id = ((u32) bits & SOUNDARGS_MASK_SOUNDID) >> SOUNDARGS_SHIFT_SOUNDID;
    if (((u32) bits & SOUNDARGS_MASK_BANK) >> SOUNDARGS_SHIFT_BANK != VOICE_BANK) return FALSE;
    voice_patch(sVoiceBeta);
    if (sVoiceBeta && id >= 0x2B && id <= 0x2F) { // the triple jump's yahoo / waha / yippee
        play_sound((bits & ~SOUNDARGS_MASK_SOUNDID) | (((id - 0x2B) % 3) << SOUNDARGS_SHIFT_SOUNDID), pos);
        return TRUE;
    }
    return FALSE;
}

// For tests: the voice script's first bytes (setbank, bank, setinstr, instrument) of sound `id`, or -1.
EMSCRIPTEN_KEEPALIVE
s32 studio_voice_script(s32 id) {
    u8 *s = id >= 0 && id < 0x40 ? voice_script(id) : NULL;
    return s == NULL ? -1 : (s32) (((u32) s[0] << 24) | (s[1] << 16) | (s[2] << 8) | s[3]);
}

// For tests: the sounds the game asked for and did play (after the page's and the beta's), newest first.
static u32 sSfxRecent[16];
static s32 sSfxRecentAt;

EMSCRIPTEN_KEEPALIVE
u32 studio_sfx_recent(s32 i) {
    return sSfxRecent[(sSfxRecentAt - 1 - i) & 15];
}

// For tests: what the sound player's channel `ch` plays now: bank << 16 | instrument (set_instrument's
// instOrWave) << 8 | 1 while a sound plays on it (its first layer runs), else 0.
EMSCRIPTEN_KEEPALIVE
s32 studio_sfx_channel(s32 ch) {
    struct SequenceChannel *c;
    struct SequenceChannelLayer *l;
    if (ch < 0 || ch >= CHANNELS_MAX) return 0;
    c = gSequencePlayers[SEQ_PLAYER_SFX].channels[ch];
    if (!IS_SEQUENCE_CHANNEL_VALID(c) || !c->enabled) return 0;
    l = c->layers[0];
    if (l == NULL || l == NO_LAYER || !l->enabled) return 0;
    return (c->bankId << 16) | ((c->instOrWave & 0xFF) << 8) | 1;
}

// Called for every sound the game plays: a replaced one goes to the page instead,
// with how far away it is (pos is relative to the camera).
s32 studio_sfx_hook(s32 bits, f32 *pos) {
    s32 i;
    u32 key;
    if (sSfxCount == 0) {
        if (studio_voice_hook(bits, pos)) return TRUE;
        sSfxRecent[sSfxRecentAt++ & 15] = (u32) bits;
        return FALSE;
    }
    if (!sSfxCanon && sfx_tables_ready()) {
        for (i = 0; i < sSfxCount; i++) sSfxKey[i] = studio_sfx_canon(sSfxKey[i]);
        sSfxCanon = TRUE;
    }
    key = sSfxCanon ? studio_sfx_canon((u32) bits) : SFX_KEY((u32) bits);
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
    if (studio_voice_hook(bits, pos)) return TRUE;
    sSfxRecent[sSfxRecentAt++ & 15] = (u32) bits;
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

// For tests: a sequence slot's length, and what the music player plays
// (enabled << 16 | sequence << 8 | channels running).
EMSCRIPTEN_KEEPALIVE
s32 studio_seq_len(s32 seqId) {
    return gSeqFileHeader != NULL && seqId >= 0 && seqId < SEQ_SLOTS ? (s32) gSeqFileHeader->seqArray[seqId].len : -1;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_music_now(s32 player) {
    struct SequencePlayer *p;
    s32 i, channels = 0;
    if (player < 0 || player >= SEQUENCE_PLAYERS) return -1;
    p = &gSequencePlayers[player];
    for (i = 0; i < CHANNELS_MAX; i++) {
        if (IS_SEQUENCE_CHANNEL_VALID(p->channels[i]) && p->channels[i]->enabled) channels++;
    }
    return (p->enabled ? 1 << 16 : 0) | (p->seqId << 8) | channels;
}

// For tests: a layer of the music player's channel. -> -1 when it plays nothing, else the
// current note's length in ticks (bits 0-14), the ticks left of it (bits 15-29) and bit 30
// set while the note still sounds (not released yet).
EMSCRIPTEN_KEEPALIVE
s32 studio_music_layer(s32 channel, s32 layer) {
    struct SequencePlayer *p = &gSequencePlayers[SEQ_PLAYER_LEVEL];
    struct SequenceChannel *c;
    struct SequenceChannelLayer *l;
    if (!p->enabled || channel < 0 || channel >= CHANNELS_MAX || layer < 0 || layer >= LAYERS_MAX) return -1;
    c = p->channels[channel];
    if (!IS_SEQUENCE_CHANNEL_VALID(c) || !c->enabled) return -1;
    l = c->layers[layer];
    if (l == NULL || l == NO_LAYER || !l->enabled) return -1;
    return (l->delayUnused & 0x7fff) | ((l->delay & 0x7fff) << 15) | (l->stopSomething ? 0 : 1 << 30);
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
