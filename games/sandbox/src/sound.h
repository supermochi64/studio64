// Sound: the effects are synthesised at start-up; the music (wav64 streams) and the voices (one bank of
// clips) are synthesised offline by tools/audio.mjs. Everything plays on the mixer with distance and
// side from the camera.
#pragma once
#include "common.h"

enum {
  SND_JUMP, SND_PUNCH, SND_SWING, SND_HIT, SND_THUD, SND_SPLASH, SND_STEP,
  SND_PISTOL, SND_SMG, SND_SHOTGUN, SND_RIFLE, SND_EMPTY, SND_RELOAD, SND_ROCKET, SND_EXPLOSION,
  SND_CRASH, SND_HORN, SND_PICKUP, SND_DOOR, SND_SKID, SND_CASH, SND_WASTED, SND_BLIP, SND_WAR,
  SND_COUNT
};

// voices (tools/audio.mjs makes them): the hero's and everyone else's
enum {
  VO_HUP, VO_HOO, VO_YAHOO, VO_YAH, VO_WAHA, VO_HA, VO_HYA, VO_OOF, VO_OW, VO_WHOA, VO_UGH, VO_YEAH,
  VO_HEREWEGO, VO_LETSGO, VO_SNORE, VO_SCREAM, VO_HEY, VO_YO, VO_FREEZE, VO_COMEON, VO_HMM, VO_WOOHOO,
  VO_COUNT
};
// music (tools/audio.mjs): the city by day and by night, a gang war, the title, the car radio, the
// mission-passed jingle, the beach
enum { MUS_NONE = -1, MUS_DAY, MUS_NIGHT, MUS_WAR, MUS_TITLE, MUS_RADIO, MUS_PASSED, MUS_BEACH, MUS_COUNT };
extern float g_musicVolume;
void sound_voice(int vo, V3 at, float pitch);
void sound_music(int track);
int sound_music_now(void);       // the track playing (MUS_NONE if none)
extern int g_voicesPlayed;     // crossfades; MUS_PASSED plays once, then the previous comes back

// the effects made offline (tools/sfx.mjs; the order of its SFX list)
enum {
  SFX_STEP_HARD, SFX_STEP_GRASS = SFX_STEP_HARD + 3, SFX_STEP_SAND = SFX_STEP_GRASS + 3, SFX_STEP_WOOD = SFX_STEP_SAND + 2,
  SFX_STEP_WATER = SFX_STEP_WOOD + 2, SFX_LAND = SFX_STEP_WATER + 2, SFX_SWIM, SFX_SWIM2, SFX_SPLASH, SFX_GRAB, SFX_COUNT
};
void sound_sfx(int id, V3 at, float vol, float pitch);

void sound_init(void);
void sound_update(void);                 // once a frame (fills the audio buffers)
void sound_play(int id, V3 at);
void sound_play_ui(int id);
void sound_engine(bool on, float rpm, V3 at);   // the player's vehicle engine (rpm 0..1)
void sound_siren(bool on, V3 at);
void sound_radio(bool on);
