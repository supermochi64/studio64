#include "stream.h"
#include "world.h"
#include "render.h"

#define DETAIL_R 1      // chunks round the focus with their detailed model (3x3)
#define FAR_R 3         // and with the far model (7x7)
#define MAX_SLOTS 112
#define NEAR_M 66.0f     // detail within this distance of the eye

typedef struct {
  int idx;              // chunk index (cz * chunks + cx), -1 free
  bool detail;
  T3DModel *model;
  rspq_block_t *block;
  T3DMat4FP *mat;
  float cx, cz;
  int freeIn;           // frames left before the memory is released (the RSP may still read it)
} Slot;

static Slot s_slots[MAX_SLOTS];
static int s_tris;

void stream_init(void) {
  for (int i = 0; i < MAX_SLOTS; i++) { s_slots[i].idx = -1; s_slots[i].freeIn = 0; s_slots[i].mat = malloc_uncached(sizeof(T3DMat4FP)); }
}

static Slot *find(int idx, bool detail) {
  for (int i = 0; i < MAX_SLOTS; i++) if (s_slots[i].idx == idx && s_slots[i].detail == detail && !s_slots[i].freeIn) return &s_slots[i];
  return NULL;
}

static void load(int idx, bool detail) {
  Slot *s = NULL;
  for (int i = 0; i < MAX_SLOTS; i++) if (s_slots[i].idx < 0 && !s_slots[i].freeIn) { s = &s_slots[i]; break; }
  if (!s) return;
  World *w = &g_world;
  int cx = idx % w->chunks, cz = idx / w->chunks;
  char path[48];
  sprintf(path, "rom:/city/%c%d_%d.t3dm", detail ? 'd' : 'l', cx, cz);
  s->model = t3d_model_load(path);
  s->idx = idx; s->detail = detail;
  s->cx = w->min + cx * w->chunk + w->chunk * 0.5f;
  s->cz = w->min + cz * w->chunk + w->chunk * 0.5f;
  T3DMat4 m;
  mat_place(&m, (V3){s->cx, 0, s->cz}, 0, 0, 0, 0, MODEL_SCALE);
  t3d_mat4_to_fixed(s->mat, &m);
  rspq_block_begin();
  t3d_matrix_push(s->mat);
  t3d_model_draw(s->model);
  t3d_matrix_pop(1);
  s->block = rspq_block_end();
}

static void release(Slot *s) {
  s->freeIn = FB_COUNT + 1;
}

void stream_update(V3 f) {
  World *w = &g_world;
  // free the memory of chunks released a few frames ago
  for (int i = 0; i < MAX_SLOTS; i++) {
    Slot *s = &s_slots[i];
    if (s->freeIn && --s->freeIn == 0) {
      rspq_block_free(s->block); s->block = NULL;
      t3d_model_free(s->model); s->model = NULL;
      s->idx = -1;
    }
  }
  int fcx = (int)floorf((f.x - w->min) / w->chunk), fcz = (int)floorf((f.z - w->min) / w->chunk);
  // drop what is out of range
  for (int i = 0; i < MAX_SLOTS; i++) {
    Slot *s = &s_slots[i];
    if (s->idx < 0 || s->freeIn) continue;
    int cx = s->idx % w->chunks, cz = s->idx / w->chunks;
    int r = s->detail ? DETAIL_R + 1 : FAR_R + 1; // a margin, so walking on a border does not reload
    if (abs(cx - fcx) > r || abs(cz - fcz) > r) release(s);
  }
  // load what is missing, nearest first, at most two a step (the cartridge is fast, decompressing is not)
  int loads = 0;
  for (int ring = 0; ring <= FAR_R && loads < 2; ring++) {
    for (int dz = -ring; dz <= ring && loads < 2; dz++) for (int dx = -ring; dx <= ring && loads < 2; dx++) {
      if (abs(dx) != ring && abs(dz) != ring) continue;
      int cx = fcx + dx, cz = fcz + dz;
      if (cx < 0 || cz < 0 || cx >= w->chunks || cz >= w->chunks) continue;
      int idx = cz * w->chunks + cx;
      bool wantDetail = ring <= DETAIL_R;
      int flag = w->chunkFlags[idx];
      if (wantDetail && (flag & 1) && !find(idx, true)) { load(idx, true); loads++; }
      if ((flag & 2) && !find(idx, false)) { load(idx, false); loads++; }
    }
  }
}

void stream_draw(void) {
  World *w = &g_world;
  int fcx = (int)floorf((g_view.eye.x - w->min) / w->chunk), fcz = (int)floorf((g_view.eye.z - w->min) / w->chunk);
  s_tris = 0;
  render_light_baked();
  for (int i = 0; i < MAX_SLOTS; i++) {
    Slot *s = &s_slots[i];
    if (s->idx < 0 || s->freeIn) continue;
    int cx = s->idx % w->chunks, cz = s->idx / w->chunks;
    // the detailed model only where the chunk comes within NEAR_M of the eye (else its far model)
    float nx = clampf(g_view.eye.x, s->cx - 32, s->cx + 32), nz = clampf(g_view.eye.z, s->cz - 32, s->cz + 32);
    bool near = abs(cx - fcx) <= DETAIL_R && abs(cz - fcz) <= DETAIL_R && sqrf(nx - g_view.eye.x) + sqrf(nz - g_view.eye.z) < NEAR_M * NEAR_M;
    if (s->detail ? !near : (near && find(s->idx, true))) continue;
    T3DVec3 c = {{s->cx, 20, s->cz}};
    if (!t3d_frustum_vs_sphere(&g_view.frustum, &c, 62.0f)) continue;
    rspq_block_run(s->block);
  }
}

int stream_loaded_count(void) { int n = 0; for (int i = 0; i < MAX_SLOTS; i++) if (s_slots[i].idx >= 0 && !s_slots[i].freeIn) n++; return n; }
int stream_drawn_tris(void) { return s_tris; }
