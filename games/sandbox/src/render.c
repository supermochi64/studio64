#include "render.h"
#include "world.h"

RenderView g_view;
float g_hour = 16.5f;

static T3DModel *s_sky, *s_water;
static int s_frame;
#define MATS_PER_FRAME 640
static T3DMat4FP *s_mats;
static int s_matUsed;

int render_frame_index(void) { return s_frame; }

void render_init(void) {
  display_init(RESOLUTION_320x240, DEPTH_16_BPP, FB_COUNT, GAMMA_NONE, FILTERS_RESAMPLE_ANTIALIAS_DEDITHER);
  rdpq_init();
  t3d_init((T3DInitParams){});
  g_view.vp = t3d_viewport_create_buffered(FB_COUNT);
  g_view.fov = 62.0f;
  s_mats = malloc_uncached(sizeof(T3DMat4FP) * MATS_PER_FRAME * FB_COUNT);
  s_sky = t3d_model_load("rom:/sky.t3dm");
  s_water = t3d_model_load("rom:/water.t3dm");
}

T3DMat4FP *render_mat(const T3DMat4 *m) {
  if (s_matUsed >= MATS_PER_FRAME) s_matUsed = MATS_PER_FRAME - 1; // (never in practice: reuse the last)
  T3DMat4FP *out = &s_mats[s_frame * MATS_PER_FRAME + s_matUsed++];
  t3d_mat4_to_fixed(out, m);
  return out;
}

void mat_place(T3DMat4 *m, V3 pos, float yaw, float pitch, float roll, float pivot, float scale) {
  // R = Ry(yaw) * T(0,pivot,0) * Rx(pitch) * Rz(roll) * T(0,-pivot,0), then scale
  float cy = cosf(yaw), sy = sinf(yaw), cp = cosf(pitch), sp = sinf(pitch), cr = cosf(roll), sr = sinf(roll);
  // Rx * Rz
  float a[3][3] = {
    {cr, -sr, 0},
    {cp * sr, cp * cr, -sp},
    {sp * sr, sp * cr, cp},
  };
  // Ry * a (columns of the final 3x3 in row-major r[row][col])
  float r[3][3];
  for (int c = 0; c < 3; c++) {
    r[0][c] = cy * a[0][c] + sy * a[2][c];
    r[1][c] = a[1][c];
    r[2][c] = -sy * a[0][c] + cy * a[2][c];
  }
  // the pivot: p' = R (p - P) + P  ->  translation += P - R P  with P = (0, pivot, 0)
  float tx = pos.x - r[0][1] * pivot, ty = pos.y + pivot - r[1][1] * pivot, tz = pos.z - r[2][1] * pivot;
  for (int c = 0; c < 3; c++) for (int k = 0; k < 3; k++) m->m[c][k] = r[k][c] * scale;
  m->m[0][3] = m->m[1][3] = m->m[2][3] = 0;
  m->m[3][0] = tx; m->m[3][1] = ty; m->m[3][2] = tz; m->m[3][3] = 1;
}
void mat_mul(T3DMat4 *out, const T3DMat4 *a, const T3DMat4 *b) {
  T3DMat4 r;
  for (int c = 0; c < 4; c++) for (int k = 0; k < 4; k++) {
    float s = 0;
    for (int i = 0; i < 4; i++) s += a->m[i][k] * b->m[c][i];
    r.m[c][k] = s;
  }
  *out = r;
}
V3 mat_apply(const T3DMat4 *m, V3 p) {
  return (V3){m->m[0][0] * p.x + m->m[1][0] * p.y + m->m[2][0] * p.z + m->m[3][0],
              m->m[0][1] * p.x + m->m[1][1] * p.y + m->m[2][1] * p.z + m->m[3][1],
              m->m[0][2] * p.x + m->m[1][2] * p.y + m->m[2][2] * p.z + m->m[3][2]};
}

// ---- the sky follows the hour ----
typedef struct { float h; uint8_t fog[3], amb[3], sun[3]; } SkyKey;
static const SkyKey SKY[] = {
  {0, {18, 22, 44}, {50, 56, 86}, {40, 44, 70}},
  {5, {40, 40, 70}, {70, 66, 96}, {60, 50, 70}},
  {6.5, {220, 160, 120}, {150, 120, 110}, {230, 160, 110}},
  {9, {196, 220, 238}, {150, 154, 160}, {255, 246, 226}},
  {16, {196, 220, 238}, {150, 154, 160}, {255, 246, 226}},
  {18.5, {232, 160, 110}, {150, 112, 100}, {255, 170, 110}},
  {20, {60, 50, 90}, {80, 70, 100}, {90, 70, 110}},
  {24, {18, 22, 44}, {50, 56, 86}, {40, 44, 70}},
};
static void sky_at(float h, uint8_t fog[3], uint8_t amb[3], uint8_t sun[3]) {
  int n = sizeof(SKY) / sizeof(SKY[0]);
  for (int i = 0; i < n - 1; i++) {
    if (h >= SKY[i].h && h <= SKY[i + 1].h) {
      float t = (h - SKY[i].h) / (SKY[i + 1].h - SKY[i].h);
      for (int k = 0; k < 3; k++) {
        fog[k] = (uint8_t)lerpf(SKY[i].fog[k], SKY[i + 1].fog[k], t);
        amb[k] = (uint8_t)lerpf(SKY[i].amb[k], SKY[i + 1].amb[k], t);
        sun[k] = (uint8_t)lerpf(SKY[i].sun[k], SKY[i + 1].sun[k], t);
      }
      return;
    }
  }
}
static uint8_t s_fog[3], s_amb[3], s_sun[3];
static float s_day; // 0 at night .. 1 at noon (the baked city is dimmed at night)

void render_light_baked(void) {
  uint8_t c = (uint8_t)(110 + 145 * s_day);
  uint8_t col[4] = {c, c, (uint8_t)minf(255, c + 20 * (1 - s_day)), 255};
  t3d_light_set_ambient(col);
  t3d_light_set_count(0);
}
void render_light_lit(void) {
  uint8_t amb[4] = {s_amb[0], s_amb[1], s_amb[2], 255};
  uint8_t sun[4] = {s_sun[0], s_sun[1], s_sun[2], 255};
  T3DVec3 dir = {{0.45f, 0.8f, 0.4f}};
  fm_vec3_norm(&dir, &dir);
  t3d_light_set_ambient(amb);
  t3d_light_set_directional(0, sun, &dir);
  t3d_light_set_count(1);
}

void render_begin(void) {
  s_frame = (s_frame + 1) % FB_COUNT;
  s_matUsed = 0;
  sky_at(g_hour, s_fog, s_amb, s_sun);
  s_day = clampf(1.0f - fabsf(g_hour - 13.0f) / 8.5f, 0, 1) * 1.4f;
  s_day = clampf(s_day, 0, 1);

  V3 eye = g_view.eye;
  if (g_view.shake > 0.01f) { eye.x += rnd_range(-1, 1) * g_view.shake * 0.15f; eye.y += rnd_range(-1, 1) * g_view.shake * 0.15f; g_view.shake *= 0.85f; }
  T3DVec3 e = t3v(eye), t = t3v(g_view.target), up = {{0, 1, 0}};
  t3d_viewport_set_projection(&g_view.vp, T3D_DEG_TO_RAD(g_view.fov), 0.4f, 420.0f);
  t3d_viewport_look_at(&g_view.vp, &e, &t, &up);
  g_view.frustum = g_view.vp.viewFrustum;

  rdpq_attach(display_get(), display_get_zbuf());
  t3d_frame_start();
  t3d_viewport_attach(&g_view.vp);
  color_t fogc = RGBA32(s_fog[0], s_fog[1], s_fog[2], 255);
  // (no colour clear: the sky covers the screen)
  rdpq_mode_antialias(AA_REDUCED);
  rdpq_set_prim_color(RGBA32(255, 255, 255, 255));

  // the sky dome round the eye (no fog, behind everything: drawn first, then the depth is cleared)
  t3d_fog_set_enabled(false);
  t3d_light_set_ambient((uint8_t[]){(uint8_t)(90 + 165 * s_day), (uint8_t)(90 + 165 * s_day), (uint8_t)(110 + 145 * s_day), 255});
  t3d_light_set_count(0);
  T3DMat4 m;
  mat_place(&m, (V3){eye.x, eye.y * 0.3f, eye.z}, 0, 0, 0, 0, MODEL_SCALE * 0.85f);
  t3d_matrix_push(render_mat(&m));
  {
    // without the depth test and write: nothing is behind it, and the depth buffer is cleared after
    T3DModelState st = t3d_model_state_create();
    T3DModelIter it = t3d_model_iter_create(s_sky, T3D_CHUNK_TYPE_OBJECT);
    while (t3d_model_iter_next(&it)) {
      t3d_model_draw_material(it.object->material, &st);
      rdpq_mode_zbuf(false, false);
      t3d_state_set_drawflags(T3D_FLAG_SHADED);
      t3d_model_draw_object(it.object, NULL);
    }
    rdpq_mode_zbuf(true, true);
  }
  t3d_matrix_pop(1);
  t3d_screen_clear_depth();

  rdpq_mode_fog(RDPQ_FOG_STANDARD);
  rdpq_set_fog_color(fogc);
  t3d_fog_set_range(95.0f, 205.0f);
  t3d_fog_set_enabled(true);
  render_light_baked();
}

static void draw_water(void) {
  // the sea in 64 m tiles round the eye, out to the fog
  float ex = g_view.eye.x, ez = g_view.eye.z;
  int ci = (int)floorf(ex / 64.0f), cj = (int)floorf(ez / 64.0f);
  float scroll = fmodf(get_ticks_ms() * 0.00008f, 1.0f) * 16.0f;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    float x = (ci + i) * 64.0f + 32.0f, z = (cj + j) * 64.0f + 32.0f;
    // skip tiles whose ground is all above the water (inland)
    if (fabsf(x) < 560 && fabsf(z) < 560) continue;
    T3DVec3 c = {{x, WATER_Y, z}};
    if (!t3d_frustum_vs_sphere(&g_view.frustum, &c, 46.0f)) continue;
    T3DMat4 m;
    mat_place(&m, (V3){x, WATER_Y, z + scroll * 0}, 0, 0, 0, 0, MODEL_SCALE);
    t3d_matrix_push(render_mat(&m));
    t3d_model_draw(s_water);
    t3d_matrix_pop(1);
  }
}

void render_end(void) {
  render_light_baked();
  draw_water();
  t3d_fog_set_enabled(false);
  // 2D from here (the HUD): rdpq's standard modes
  rdpq_set_mode_standard();
}

void render_present(void) { rdpq_detach_show(); }

void render_model(T3DModel *model, const T3DMat4 *m) {
  t3d_matrix_push(render_mat(m));
  t3d_model_draw(model);
  t3d_matrix_pop(1);
}

// ---- tinted parts ----
static const char *TINT_NAMES[TINT_COUNT] = {"", "skin", "shirt", "pants", "shoes", "hair", "hat", "paint", "paint2"};
void render_tag_tints(T3DModel *model) {
  T3DModelIter it = t3d_model_iter_create(model, T3D_CHUNK_TYPE_OBJECT);
  while (t3d_model_iter_next(&it)) {
    it.object->userValue0 = 0;
    const char *name = it.object->material ? it.object->material->name : NULL;
    if (!name) continue;
    for (int k = 1; k < TINT_COUNT; k++) if (strcmp(name, TINT_NAMES[k]) == 0) it.object->userValue0 = k;
  }
}
static void draw_parts(T3DModel *model, const T3DMat4FP *bones, const Tints *t) {
  T3DModelState state = t3d_model_state_create();
  T3DModelIter it = t3d_model_iter_create(model, T3D_CHUNK_TYPE_OBJECT);
  while (t3d_model_iter_next(&it)) {
    int k = it.object->userValue0;
    if (t && k && (t->hide & (1 << k))) continue;
    if (it.object->material) t3d_model_draw_material(it.object->material, &state);
    rdpq_set_prim_color(t && k ? t->c[k] : RGBA32(255, 255, 255, 255));
    t3d_model_draw_object(it.object, bones);
  }
}
void render_skinned(T3DModel *model, T3DSkeleton *skel, const T3DMat4 *m, const Tints *t) {
  t3d_matrix_push(render_mat(m));
  t3d_skeleton_use(skel);
  draw_parts(model, (const T3DMat4FP *)t3d_segment_placeholder(T3D_SEGMENT_SKELETON), t);
  t3d_matrix_pop(1);
}
void render_tinted(T3DModel *model, const T3DMat4 *m, const Tints *t) {
  t3d_matrix_push(render_mat(m));
  draw_parts(model, NULL, t);
  t3d_matrix_pop(1);
}
void render_colored(T3DModel *model, const T3DMat4 *m, color_t c) {
  t3d_matrix_push(render_mat(m));
  T3DModelState state = t3d_model_state_create();
  T3DModelIter it = t3d_model_iter_create(model, T3D_CHUNK_TYPE_OBJECT);
  while (t3d_model_iter_next(&it)) {
    if (it.object->material) t3d_model_draw_material(it.object->material, &state);
    rdpq_set_prim_color(c);
    t3d_model_draw_object(it.object, NULL);
  }
  t3d_matrix_pop(1);
}

bool render_project(V3 p, float *sx, float *sy) {
  T3DVec3 in = t3v(p), out;
  t3d_viewport_calc_viewspace_pos(&g_view.vp, &out, &in);
  // calc_viewspace_pos gives screen coordinates in x/y and the depth in z (> 1 behind)
  *sx = out.v[0]; *sy = out.v[1];
  V3 f = v3_norm(v3_sub(g_view.target, g_view.eye));
  return v3_dot(v3_sub(p, g_view.eye), f) > 0.1f;
}
