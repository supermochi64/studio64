// Sound: every effect is synthesised at start-up (no sound files), played on the mixer with distance
// and side from the camera. The car radio plays a beat made the same way.
#pragma once
#include "common.h"

enum {
  SND_JUMP, SND_PUNCH, SND_SWING, SND_HIT, SND_THUD, SND_SPLASH, SND_STEP,
  SND_PISTOL, SND_SMG, SND_SHOTGUN, SND_RIFLE, SND_EMPTY, SND_RELOAD, SND_ROCKET, SND_EXPLOSION,
  SND_CRASH, SND_HORN, SND_PICKUP, SND_DOOR, SND_SKID, SND_CASH, SND_WASTED, SND_BLIP, SND_WAR,
  SND_COUNT
};

void sound_init(void);
void sound_update(void);                 // once a frame (fills the audio buffers)
void sound_play(int id, V3 at);
void sound_play_ui(int id);
void sound_engine(bool on, float rpm, V3 at);   // the player's vehicle engine (rpm 0..1)
void sound_siren(bool on, V3 at);
void sound_radio(bool on);
