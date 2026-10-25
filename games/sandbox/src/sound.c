#include "sound.h"
#include "render.h"

#define RATE 22050
#define CH_MUSIC 0      // two stereo slots (0-1, 2-3) that crossfade
#define CH_ENGINE 4
#define CH_SIREN 5
#define CH_FIRST_VOICE 6
#define CH_FIRST_SFX 10
#define CH_COUNT 24

typedef struct { int16_t *data; int len; bool loop; waveform_t wave; } Sample;
static Sample s_snd[SND_COUNT], s_engine, s_siren, s_voice[VO_COUNT], s_sfx[SFX_COUNT];
static int s_next = CH_FIRST_SFX, s_nextVoice = CH_FIRST_VOICE;
static bool s_ok;

static void wv_read(void *ctx, samplebuffer_t *sbuf, int wpos, int wlen, bool seeking) {
  Sample *s = ctx;
  int16_t *dst = samplebuffer_append(sbuf, wlen);
  for (int i = 0; i < wlen; i++) { int p = wpos + i; dst[i] = s->loop ? s->data[p % s->len] : (p < s->len ? s->data[p] : 0); }
}

// ---- music: the wanted track fades in on one slot while the last one fades out on the other ----
static wav64_t s_mus[MUS_COUNT];
static int s_slot[2] = {MUS_NONE, MUS_NONE};
static float s_slotVol[2];
static int s_cur;
static int s_base = MUS_NONE;
static bool s_radioOn;
static float s_passedTime;
float g_musicVolume = 0.5f;

static uint32_t s_seed = 1234567;
static float noise(void) { s_seed = s_seed * 1103515245u + 12345u; return ((int)(s_seed >> 9) & 0xffff) / 32768.0f - 1.0f; }

static Sample *alloc(Sample *s, float seconds, bool loop) {
  s->len = (int)(seconds * RATE);
  s->data = malloc(s->len * 2);
  s->loop = loop;
  s->wave = (waveform_t){.name = "sfx", .bits = 16, .channels = 1, .frequency = RATE, .len = s->len, .loop_len = loop ? s->len : 0, .read = wv_read, .ctx = s};
  return s;
}
static inline void put(Sample *s, int i, float v) { v = clampf(v, -1, 1); s->data[i] = (int16_t)(v * 30000); }

// a shot: a noise burst through a falling low-pass, with a thump
static void make_shot(Sample *s, float len, float bright, float thump, float decay) {
  alloc(s, len, false);
  float lp = 0, ph = 0;
  for (int i = 0; i < s->len; i++) {
    float t = (float)i / RATE;
    float env = expf(-t * decay);
    float cut = clampf(bright * expf(-t * 18), 0.02f, 0.95f);
    lp += (noise() - lp) * cut;
    ph += (90 + 200 * expf(-t * 30)) / RATE;
    put(s, i, (lp * 1.6f + sinf(ph * TAU) * thump * expf(-t * 25)) * env);
  }
}
static void make_tone(Sample *s, float len, float f0, float f1, float decay, int shape) {
  alloc(s, len, false);
  float ph = 0;
  for (int i = 0; i < s->len; i++) {
    float t = (float)i / RATE, f = f0 + (f1 - f0) * (t / len);
    ph += f / RATE;
    float w = shape == 0 ? sinf(ph * TAU) : shape == 1 ? (fmodf(ph, 1) < 0.5f ? 0.6f : -0.6f) : (fmodf(ph, 1) * 2 - 1) * 0.6f;
    float a = minf(1, t * 200) * expf(-t * decay);
    put(s, i, w * a);
  }
}
static void make_noise(Sample *s, float len, float cut, float decay, float attack) {
  alloc(s, len, false);
  float lp = 0;
  for (int i = 0; i < s->len; i++) {
    float t = (float)i / RATE;
    lp += (noise() - lp) * cut;
    put(s, i, lp * 2.0f * minf(1, t * attack) * expf(-t * decay));
  }
}

static void load_bank(const char *file, Sample *out, int max) {
  int size = 0;
  uint8_t *bank = asset_load(file, &size);
  int n = (bank[4] << 24) | (bank[5] << 16) | (bank[6] << 8) | bank[7];
  int16_t *pcm = (int16_t *)(bank + 8 + n * 8);
  for (int i = 0; i < n && i < max; i++) {
    uint32_t *e = (uint32_t *)(bank + 8 + i * 8);
    Sample *v = &out[i];
    v->data = pcm + e[0]; v->len = e[1]; v->loop = false;
    v->wave = (waveform_t){.name = "bank", .bits = 16, .channels = 1, .frequency = RATE, .len = v->len, .loop_len = 0, .read = wv_read, .ctx = v};
  }
}

void sound_init(void) {
  audio_init(RATE, 4);
  mixer_init(CH_COUNT);
  for (int ch = 0; ch < CH_COUNT; ch++) mixer_ch_set_limits(ch, 16, RATE * 2.8f, 0); // the engine's pitch goes up with the revs
  make_tone(&s_snd[SND_JUMP], 0.18f, 300, 700, 12, 2);
  make_noise(&s_snd[SND_PUNCH], 0.12f, 0.3f, 30, 2000);
  make_noise(&s_snd[SND_SWING], 0.15f, 0.08f, 20, 60);
  make_shot(&s_snd[SND_HIT], 0.2f, 0.2f, 0.8f, 18);
  make_shot(&s_snd[SND_THUD], 0.35f, 0.1f, 1.0f, 10);
  make_noise(&s_snd[SND_SPLASH], 0.5f, 0.25f, 6, 60);
  make_noise(&s_snd[SND_STEP], 0.06f, 0.4f, 60, 3000);
  make_shot(&s_snd[SND_PISTOL], 0.28f, 0.7f, 0.5f, 14);
  make_shot(&s_snd[SND_SMG], 0.14f, 0.8f, 0.3f, 26);
  make_shot(&s_snd[SND_SHOTGUN], 0.5f, 0.5f, 1.0f, 8);
  make_shot(&s_snd[SND_RIFLE], 0.32f, 0.9f, 0.6f, 12);
  make_tone(&s_snd[SND_EMPTY], 0.05f, 1200, 1100, 60, 1);
  make_tone(&s_snd[SND_RELOAD], 0.12f, 500, 380, 30, 1);
  make_noise(&s_snd[SND_ROCKET], 0.6f, 0.15f, 4, 30);
  make_shot(&s_snd[SND_EXPLOSION], 1.3f, 0.35f, 1.0f, 3.2f);
  make_shot(&s_snd[SND_CRASH], 0.5f, 0.6f, 0.7f, 7);
  // horn: two square tones together
  alloc(&s_snd[SND_HORN], 0.45f, false);
  for (int i = 0; i < s_snd[SND_HORN].len; i++) { float t = (float)i / RATE; put(&s_snd[SND_HORN], i, ((fmodf(t * 349, 1) < 0.5f ? 0.3f : -0.3f) + (fmodf(t * 440, 1) < 0.5f ? 0.3f : -0.3f)) * minf(1, (0.45f - t) * 30)); }
  make_tone(&s_snd[SND_PICKUP], 0.25f, 600, 1300, 6, 0);
  make_noise(&s_snd[SND_DOOR], 0.12f, 0.5f, 25, 2000);
  make_noise(&s_snd[SND_SKID], 0.4f, 0.6f, 4, 30);
  make_tone(&s_snd[SND_CASH], 0.3f, 1500, 2100, 8, 0);
  make_tone(&s_snd[SND_WASTED], 1.4f, 220, 60, 1.6f, 2);
  make_tone(&s_snd[SND_BLIP], 0.06f, 900, 900, 30, 1);
  make_tone(&s_snd[SND_WAR], 0.8f, 180, 160, 2, 1);
  // the engine: a looping buzz (its pitch follows the revs)
  alloc(&s_engine, 0.2f, true);
  for (int i = 0; i < s_engine.len; i++) { float t = (float)i / RATE; float ph = fmodf(t * 55, 1); put(&s_engine, i, ((ph < 0.3f ? 0.5f : -0.2f) + noise() * 0.08f) * 0.6f); }
  // the siren: a slow wail
  alloc(&s_siren, 2.0f, true);
  { float ph = 0; for (int i = 0; i < s_siren.len; i++) { float t = (float)i / RATE; float f = 700 + 400 * sinf(t * PI); ph += f / RATE; put(&s_siren, i, (fmodf(ph, 1) < 0.5f ? 0.25f : -0.25f)); } }
  // the voices and the offline effects: banks of 16-bit clips made by tools/audio.mjs, tools/sfx.mjs
  load_bank("rom:/voices.bin", s_voice, VO_COUNT);
  load_bank("rom:/sfx.bin", s_sfx, SFX_COUNT);
  static const char *MUS_FILES[MUS_COUNT] = {"day", "night", "war", "title", "radio", "passed", "beach"};
  for (int i = 0; i < MUS_COUNT; i++) {
    char fn[48]; snprintf(fn, sizeof fn, "rom:/mus_%s.wav64", MUS_FILES[i]);
    wav64_open(&s_mus[i], fn);
  }
  s_ok = true;
}

static int music_wanted(void) {
  if (s_passedTime > 0) return MUS_PASSED;
  if (s_radioOn) return MUS_RADIO;
  return s_base;
}

void sound_update(void) {
  if (!s_ok) return;
  // (real time: called once a drawn frame, 15 to 30 a second)
  static uint32_t last; uint32_t now = get_ticks_ms();
  float dt = last ? clampf((now - last) / 1000.0f, 0, 0.1f) : 1.0f / 30; last = now;
  if (s_passedTime > 0) s_passedTime -= dt;
  int want = music_wanted();
  if (want != s_slot[s_cur]) {
    int other = s_cur ^ 1;
    if (s_slot[other] != want) {
      if (s_slot[other] != MUS_NONE) mixer_ch_stop(CH_MUSIC + other * 2);
      s_slot[other] = want; s_slotVol[other] = 0;
      if (want != MUS_NONE) wav64_play(&s_mus[want], CH_MUSIC + other * 2);
    }
    s_cur = other;
  }
  for (int k = 0; k < 2; k++) {
    if (s_slot[k] == MUS_NONE) continue;
    bool on = k == s_cur;
    // the jingle cuts in quickly; everything else crossfades over about a second
    float rate = (s_slot[s_cur] == MUS_PASSED || s_slot[k] == MUS_PASSED) ? 6.0f : 1.2f;
    s_slotVol[k] = on ? minf(1, s_slotVol[k] + dt * rate) : maxf(0, s_slotVol[k] - dt * rate);
    int ch = CH_MUSIC + k * 2;
    if ((!on && s_slotVol[k] <= 0) || !mixer_ch_playing(ch)) {
      if (mixer_ch_playing(ch)) mixer_ch_stop(ch);
      if (!on) { s_slot[k] = MUS_NONE; continue; }
      if (s_slot[k] == MUS_PASSED) { s_passedTime = 0; continue; }  // the jingle ended
    }
    float v = s_slotVol[k] * g_musicVolume * (s_slot[k] == MUS_PASSED ? 1.4f : 1.0f);
    mixer_ch_set_vol(ch, v, v);
  }
  mixer_try_play();
}

static void place(int ch, V3 at, float vol) {
  V3 d = v3_sub(at, g_view.eye);
  float dist = v3_len(d);
  float v = vol * clampf(1.0f - dist / 90.0f, 0, 1);
  V3 f = v3_norm(v3_sub(g_view.target, g_view.eye));
  V3 r = {-f.z, 0, f.x};
  float pan = dist > 0.1f ? clampf(v3_dot(v3_scale(d, 1 / dist), r), -1, 1) : 0;
  mixer_ch_set_vol_pan(ch, v, 0.5f + pan * 0.4f);
}

void sound_play(int id, V3 at) {
  if (!s_ok || id < 0 || id >= SND_COUNT) return;
  if (v3_dist(at, g_view.eye) > 90) return;
  int ch = s_next;
  s_next = s_next + 1 >= CH_COUNT ? CH_FIRST_SFX : s_next + 1;
  mixer_ch_play(ch, &s_snd[id].wave);
  place(ch, at, id == SND_EXPLOSION ? 1.0f : 0.8f);
  mixer_ch_set_freq(ch, RATE * rnd_range(0.94f, 1.06f));
}
void sound_sfx(int id, V3 at, float vol, float pitch) {
  if (!s_ok || id < 0 || id >= SFX_COUNT || !s_sfx[id].data) return;
  if (v3_dist(at, g_view.eye) > 60) return;
  int ch = s_next;
  s_next = s_next + 1 >= CH_COUNT ? CH_FIRST_SFX : s_next + 1;
  mixer_ch_play(ch, &s_sfx[id].wave);
  place(ch, at, vol);
  mixer_ch_set_freq(ch, RATE * pitch);
}
void sound_play_ui(int id) {
  if (!s_ok || id < 0 || id >= SND_COUNT) return;
  int ch = s_next;
  s_next = s_next + 1 >= CH_COUNT ? CH_FIRST_SFX : s_next + 1;
  mixer_ch_play(ch, &s_snd[id].wave);
  mixer_ch_set_vol(ch, 0.7f, 0.7f);
  mixer_ch_set_freq(ch, RATE);
}
void sound_engine(bool on, float rpm, V3 at) {
  if (!s_ok) return;
  if (!on) { if (mixer_ch_playing(CH_ENGINE)) mixer_ch_stop(CH_ENGINE); return; }
  if (!mixer_ch_playing(CH_ENGINE)) mixer_ch_play(CH_ENGINE, &s_engine.wave);
  mixer_ch_set_freq(CH_ENGINE, RATE * (0.6f + rpm * 1.6f));
  place(CH_ENGINE, at, 0.35f);
}
void sound_siren(bool on, V3 at) {
  if (!s_ok) return;
  if (!on) { if (mixer_ch_playing(CH_SIREN)) mixer_ch_stop(CH_SIREN); return; }
  if (!mixer_ch_playing(CH_SIREN)) mixer_ch_play(CH_SIREN, &s_siren.wave);
  place(CH_SIREN, at, 0.5f);
}
void sound_radio(bool on) { s_radioOn = on; }

void sound_voice(int vo, V3 at, float pitch) {
  if (!s_ok || vo < 0 || vo >= VO_COUNT || !s_voice[vo].data) return;
  if (v3_dist(at, g_view.eye) > 60) return;
  int ch = s_nextVoice;
  s_nextVoice = s_nextVoice + 1 >= CH_FIRST_SFX ? CH_FIRST_VOICE : s_nextVoice + 1;
  mixer_ch_play(ch, &s_voice[vo].wave);
  g_voicesPlayed++;
  place(ch, at, 0.95f);
  mixer_ch_set_freq(ch, RATE * pitch);
}
int sound_music_now(void) { int t = s_slot[s_cur]; return t != MUS_NONE && mixer_ch_playing(CH_MUSIC + s_cur * 2) ? t : MUS_NONE; }
int g_voicesPlayed;
void sound_music(int track) {
  if (track == MUS_PASSED) { s_passedTime = 6.0f; return; }
  s_base = track;
}
