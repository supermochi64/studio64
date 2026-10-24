#include "sound.h"
#include "render.h"

#define RATE 22050
#define CH_RADIO 0
#define CH_ENGINE 1
#define CH_SIREN 2
#define CH_FIRST_SFX 3
#define CH_COUNT 14

typedef struct { int16_t *data; int len; bool loop; waveform_t wave; } Sample;
static Sample s_snd[SND_COUNT], s_engine, s_siren, s_radio;
static int s_next = CH_FIRST_SFX;
static bool s_ok;

static void wv_read(void *ctx, samplebuffer_t *sbuf, int wpos, int wlen, bool seeking) {
  Sample *s = ctx;
  int16_t *dst = samplebuffer_append(sbuf, wlen);
  for (int i = 0; i < wlen; i++) { int p = wpos + i; dst[i] = s->loop ? s->data[p % s->len] : (p < s->len ? s->data[p] : 0); }
}

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

static void make_radio(Sample *s) {
  // two bars at 92 bpm: kick, snare, hats and a bass line (our own little beat)
  float beat = 60.0f / 92.0f, bars = 2;
  alloc(s, beat * 4 * bars, true);
  const float bass[8] = {41.2f, 41.2f, 49.0f, 41.2f, 55.0f, 49.0f, 36.7f, 41.2f};
  float lp = 0;
  for (int i = 0; i < s->len; i++) {
    float t = (float)i / RATE;
    float b = t / beat;                          // beats
    float bt = fmodf(b, 1.0f) * beat;            // time in the beat
    int bi = (int)b;
    float v = 0;
    // kick on 1 and 3 (and the "and" of 3), snare on 2 and 4
    float kt = fmodf(b, 2.0f) * beat;
    if (bi % 2 == 0 || (fmodf(b, 4.0f) > 2.5f && fmodf(b, 4.0f) < 3.0f)) v += sinf(TAU * (50 + 120 * expf(-bt * 30)) * bt) * expf(-bt * 9) * 0.9f;
    (void)kt;
    if (bi % 2 == 1) { lp += (noise() - lp) * 0.5f; v += lp * expf(-bt * 14) * 0.7f; }
    // hats every eighth
    float et = fmodf(b * 2, 1.0f) * beat / 2;
    v += noise() * expf(-et * 60) * 0.18f;
    // bass: an eighth-note line
    int ei = ((int)(b * 2)) % 8;
    float f = bass[ei];
    v += (fmodf(t * f, 1.0f) < 0.5f ? 0.35f : -0.35f) * expf(-et * 3) * 0.6f;
    // a chord stab on the offbeat of 4
    if (fmodf(b, 4.0f) > 3.5f) { float st = (fmodf(b, 4.0f) - 3.5f) * beat; v += (sinf(TAU * 220 * t) + sinf(TAU * 277 * t) + sinf(TAU * 330 * t)) * 0.12f * expf(-st * 6); }
    put(s, i, v * 0.7f);
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
  make_radio(&s_radio);
  s_ok = true;
}

void sound_update(void) { if (s_ok) mixer_try_play(); }

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
void sound_play_ui(int id) {
  if (!s_ok) return;
  int ch = s_next;
  s_next = s_next + 1 >= CH_COUNT ? CH_FIRST_SFX : s_next + 1;
  mixer_ch_play(ch, &s_snd[id].wave);
  mixer_ch_set_vol(ch, 0.7f, 0.7f);
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
void sound_radio(bool on) {
  if (!s_ok) return;
  if (!on) { if (mixer_ch_playing(CH_RADIO)) mixer_ch_stop(CH_RADIO); return; }
  if (!mixer_ch_playing(CH_RADIO)) { mixer_ch_play(CH_RADIO, &s_radio.wave); mixer_ch_set_vol(CH_RADIO, 0.4f, 0.4f); }
}

// (voices and music: tools/audio.mjs makes them; until they are loaded, nothing plays)
void sound_voice(int vo, V3 at, float pitch) { (void)vo; (void)at; (void)pitch; }
void sound_music(int track) { (void)track; }
