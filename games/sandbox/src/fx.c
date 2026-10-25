#include "fx.h"
#include "game.h"
#include "render.h"
#include "world.h"

#define MAX_PARTS 160
#define MAX_TRACERS 24

typedef struct { V3 pos, vel; float life, max, size, grow; uint8_t type; color_t c; } Part;
typedef struct { V3 a, b; float life; color_t c; } Tracer;
static Part s_parts[MAX_PARTS];
static Tracer s_tr[MAX_TRACERS];
static int s_np, s_nt;

void fx_init(void) { s_np = 0; s_nt = 0; }

static Part *add(void) {
  if (s_np < MAX_PARTS) return &s_parts[s_np++];
  return &s_parts[rnd_int(MAX_PARTS)]; // full: replace one
}

void fx_burst(V3 at, int type, int count) {
  for (int i = 0; i < count; i++) {
    Part *p = add();
    p->pos = at; p->type = type; p->grow = 0;
    V3 v = {rnd_range(-1, 1), rnd_range(0, 1), rnd_range(-1, 1)};
    switch (type) {
      case FX_DUST: p->vel = v3_scale(v, 1.5f); p->life = p->max = rnd_range(0.4f, 0.7f); p->size = 0.25f; p->grow = 0.8f; p->c = RGBA32(190, 180, 160, 255); break;
      case FX_SPARK: p->vel = v3_scale(v, 5); p->life = p->max = rnd_range(0.15f, 0.3f); p->size = 0.06f; p->c = RGBA32(255, 220, 120, 255); break;
      case FX_BLOOD: p->vel = v3_scale(v, 2.5f); p->life = p->max = rnd_range(0.3f, 0.6f); p->size = 0.09f; p->c = RGBA32(150, 20, 20, 255); break;
      case FX_SMOKE: p->vel = (V3){rnd_range(-0.4f, 0.4f), rnd_range(1, 2), rnd_range(-0.4f, 0.4f)}; p->life = p->max = rnd_range(1.0f, 1.8f); p->size = 0.4f; p->grow = 1.0f; { uint8_t g = (uint8_t)rnd_range(60, 120); p->c = RGBA32(g, g, g, 255); } break;
      case FX_FIRE: p->vel = (V3){rnd_range(-0.5f, 0.5f), rnd_range(1.5f, 3), rnd_range(-0.5f, 0.5f)}; p->life = p->max = rnd_range(0.3f, 0.6f); p->size = 0.5f; p->grow = -0.5f; p->c = rnd() < 0.5f ? RGBA32(255, 160, 40, 255) : RGBA32(255, 220, 80, 255); break;
      case FX_SPLASH: p->vel = (V3){v.x * 2, rnd_range(3, 6), v.z * 2}; p->life = p->max = rnd_range(0.5f, 0.8f); p->size = 0.15f; p->c = RGBA32(220, 235, 250, 255); break;
      case FX_DEBRIS: p->vel = (V3){v.x * 8, rnd_range(4, 10), v.z * 8}; p->life = p->max = rnd_range(1.0f, 1.8f); p->size = 0.25f; p->c = RGBA32(60, 60, 60, 255); break;
      case FX_CASH: p->vel = (V3){v.x, rnd_range(2, 3), v.z}; p->life = p->max = 0.6f; p->size = 0.12f; p->c = RGBA32(80, 200, 80, 255); break;
    }
  }
}

void fx_tracer(V3 from, V3 to, color_t c) {
  Tracer *t = &s_tr[s_nt % MAX_TRACERS];
  s_nt++;
  t->a = from; t->b = to; t->life = 0.06f; t->c = c;
}

void fx_explosion(V3 at, float size) {
  for (int i = 0; i < 14; i++) { fx_burst(v3_add(at, (V3){rnd_range(-1, 1) * size, rnd_range(0, 1) * size, rnd_range(-1, 1) * size}), FX_FIRE, 1); s_parts[s_np - 1].size = 1.2f * size; s_parts[s_np - 1].grow = 2.0f; s_parts[s_np - 1].life = s_parts[s_np - 1].max = 0.6f; }
  fx_burst(at, FX_SMOKE, 10);
  fx_burst(at, FX_DEBRIS, 8);
  g_view.shake = maxf(g_view.shake, clampf(1.6f - v3_dist(at, g_view.eye) / 40.0f, 0, 1.6f));
}

void fx_step(void) {
  for (int i = 0; i < s_np; i++) {
    Part *p = &s_parts[i];
    p->life -= DT;
    if (p->life <= 0) { s_parts[i--] = s_parts[--s_np]; continue; }
    bool falls = p->type == FX_SPARK || p->type == FX_BLOOD || p->type == FX_SPLASH || p->type == FX_DEBRIS || p->type == FX_CASH;
    if (falls) p->vel.y -= 18 * DT;
    if (p->type == FX_SMOKE) { p->vel.x *= 0.98f; p->vel.z *= 0.98f; }
    p->pos = v3_mad(p->pos, p->vel, DT);
    if (falls) {
      float gy = world_terrain(p->pos.x, p->pos.z);
      // the sea swallows what falls in it; the ground stops it
      if (gy < WATER_Y) { if (p->pos.y < WATER_Y) { s_parts[i--] = s_parts[--s_np]; continue; } }
      else if (p->pos.y < gy + 0.05f) { p->pos.y = maxf(p->pos.y, gy + 0.05f); p->vel = (V3){p->vel.x * 0.3f, -p->vel.y * 0.2f, p->vel.z * 0.3f}; }
    }
    p->size = maxf(0.02f, p->size + p->grow * DT);
  }
  for (int i = 0; i < MAX_TRACERS; i++) if (s_tr[i].life > 0) s_tr[i].life -= DT;
}

void fx_draw(void) {
  render_light_baked();
  for (int i = 0; i < s_np; i++) {
    Part *p = &s_parts[i];
    if (v3_dist2_xz(p->pos, g_view.eye) > 80 * 80) continue;
    T3DMat4 m;
    float s = p->size * (p->type == FX_FIRE || p->type == FX_SMOKE ? 1 : minf(1, p->life / p->max * 2));
    mat_place(&m, p->pos, p->life * 3, p->life * 2, 0, 0, s * MODEL_SCALE);
    color_t c = p->c;
    if (p->type == FX_SMOKE) { float k = p->life / p->max; c.r = (uint8_t)(c.r * (0.5f + k * 0.5f)); c.g = c.r; c.b = c.r; }
    render_colored(g_models.fxCube, &m, c);
  }
  for (int i = 0; i < MAX_TRACERS; i++) {
    Tracer *t = &s_tr[i];
    if (t->life <= 0) continue;
    V3 d = v3_sub(t->b, t->a);
    float len = v3_len(d);
    if (len < 0.1f) continue;
    T3DMat4 m;
    mat_place(&m, t->a, dir_yaw(d.x, d.z), -atan2f(d.y, v3_len_xz(d)), 0, 0, MODEL_SCALE);
    for (int k = 0; k < 3; k++) m.m[2][k] *= len; // stretch along the shot
    render_colored(g_models.fxTracer, &m, t->c);
  }
}
