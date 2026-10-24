#include "stream.h"
#include <string.h>
#include "world.h"
#include "render.h"

#define DETAIL_R 1      // chunks round the focus with their detailed model (3x3)
#define FAR_R 3         // and with the far model (7x7)
#define MAX_SLOTS 112
#define NEAR_M 60.0f     // detail within this distance of the eye
#define FINE_M 40.0f     // small things (the f* groups) within this distance
#define FAR_CULL 212.0f  // far models beyond this are lost in the fog anyway
#define NGROUPS 8        // a detailed chunk: four quadrants (q0..q3) and their small things (f0..f3)

typedef struct {
  int idx;              // chunk index (cz * chunks + cx), -1 free
  bool detail;
  T3DModel *model;
  rspq_block_t *block;            // the far model (or nothing)
  rspq_block_t *group[NGROUPS];   // the detailed model, by quadrant
  T3DVec3 gmin[NGROUPS], gmax[NGROUPS]; // their bounds in the world
  int gtris[NGROUPS], tris, gobjs[NGROUPS], objs;
  T3DMat4FP *mat;
  float cx, cz;
  int freeIn;           // frames left before the memory is released (the RSP may still read it)
} Slot;

static Slot s_slots[MAX_SLOTS];
static int s_tris, s_blocks, s_objs;

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
  s->block = NULL;
  for (int g = 0; g < NGROUPS; g++) s->group[g] = NULL;
  if (!detail) {
    rspq_block_begin();
    t3d_matrix_push(s->mat);
    t3d_model_draw(s->model);
    t3d_matrix_pop(1);
    s->block = rspq_block_end();
    s->tris = 0; s->objs = 0;
    float mn[3] = {1e9f, 1e9f, 1e9f}, mx[3] = {-1e9f, -1e9f, -1e9f};
    T3DModelIter it = t3d_model_iter_create(s->model, T3D_CHUNK_TYPE_OBJECT);
    while (t3d_model_iter_next(&it)) {
      s->tris += it.object->triCount; s->objs++;
      for (int k = 0; k < 3; k++) { mn[k] = fminf(mn[k], it.object->aabbMin[k]); mx[k] = fmaxf(mx[k], it.object->aabbMax[k]); }
    }
    s->gmin[0] = (T3DVec3){{s->cx + mn[0] * MODEL_SCALE, mn[1] * MODEL_SCALE, s->cz + mn[2] * MODEL_SCALE}};
    s->gmax[0] = (T3DVec3){{s->cx + mx[0] * MODEL_SCALE, mx[1] * MODEL_SCALE, s->cz + mx[2] * MODEL_SCALE}};
    return;
  }
  // one block per group: every object of that name, with its material
  for (int g = 0; g < NGROUPS; g++) {
    char name[4] = {g < 4 ? 'q' : 'f', (char)('0' + (g & 3)), 0};
    bool any = false; int tris = 0, objs = 0;
    float mn[3] = {1e9f, 1e9f, 1e9f}, mx[3] = {-1e9f, -1e9f, -1e9f};
    T3DModelIter it = t3d_model_iter_create(s->model, T3D_CHUNK_TYPE_OBJECT);
    while (t3d_model_iter_next(&it)) {
      if (!it.object->name || strcmp(it.object->name, name) != 0) continue;
      for (int k = 0; k < 3; k++) { mn[k] = fminf(mn[k], it.object->aabbMin[k]); mx[k] = fmaxf(mx[k], it.object->aabbMax[k]); }
      any = true; tris += it.object->triCount; objs++;
    }
    if (!any) continue;
    T3DModelState st = t3d_model_state_create();
    rspq_block_begin();
    t3d_matrix_push(s->mat);
    it = t3d_model_iter_create(s->model, T3D_CHUNK_TYPE_OBJECT);
    while (t3d_model_iter_next(&it)) {
      if (!it.object->name || strcmp(it.object->name, name) != 0) continue;
      t3d_model_draw_material(it.object->material, &st);
      t3d_model_draw_object(it.object, NULL);
    }
    t3d_matrix_pop(1);
    s->group[g] = rspq_block_end();
    s->gtris[g] = tris; s->gobjs[g] = objs;
    // model units to the world (MODEL_SCALE), round the chunk's centre
    s->gmin[g] = (T3DVec3){{s->cx + mn[0] * MODEL_SCALE, mn[1] * MODEL_SCALE, s->cz + mn[2] * MODEL_SCALE}};
    s->gmax[g] = (T3DVec3){{s->cx + mx[0] * MODEL_SCALE, mx[1] * MODEL_SCALE, s->cz + mx[2] * MODEL_SCALE}};
  }
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
      if (s->block) rspq_block_free(s->block);
      s->block = NULL;
      for (int g = 0; g < NGROUPS; g++) if (s->group[g]) { rspq_block_free(s->group[g]); s->group[g] = NULL; }
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

extern bool g_profile;
float g_perfCity[3]; // (tests) far models, near quadrants, small things: microseconds

void stream_draw(void) {
  World *w = &g_world;
  int fcx = (int)floorf((g_view.eye.x - w->min) / w->chunk), fcz = (int)floorf((g_view.eye.z - w->min) / w->chunk);
  s_tris = 0; s_blocks = 0; s_objs = 0;
  render_light_baked();
  // two passes: the solid city first, then the small things (and the see-through shadows on the ground)
  uint32_t tk = get_ticks_us();
  for (int pass = 0; pass < 3; pass++) {
  for (int i = 0; i < MAX_SLOTS; i++) {
    Slot *s = &s_slots[i];
    if (s->idx < 0 || s->freeIn) continue;
    int cx = s->idx % w->chunks, cz = s->idx / w->chunks;
    // the detailed model only where the chunk comes within NEAR_M of the eye (else its far model)
    float nx = clampf(g_view.eye.x, s->cx - 32, s->cx + 32), nz = clampf(g_view.eye.z, s->cz - 32, s->cz + 32);
    bool near = abs(cx - fcx) <= DETAIL_R && abs(cz - fcz) <= DETAIL_R && sqrf(nx - g_view.eye.x) + sqrf(nz - g_view.eye.z) < NEAR_M * NEAR_M;
    if (s->detail ? !near : (near && find(s->idx, true))) continue;
    if (!s->detail) {
      if (pass != 0 || sqrf(nx - g_view.eye.x) + sqrf(nz - g_view.eye.z) > FAR_CULL * FAR_CULL) continue;
      if (t3d_frustum_vs_aabb(&g_view.frustum, &s->gmin[0], &s->gmax[0])) { rspq_block_run(s->block); s_tris += s->tris; s_blocks++; s_objs += s->objs; }
      continue;
    }
    if (pass == 0) continue;
    for (int g = (pass - 1) * 4; g < (pass - 1) * 4 + 4; g++) {
      if (!s->group[g]) continue;
      if (pass == 2) {
        // the small things: only near (the distance to their box)
        float dx = fmaxf(fmaxf(s->gmin[g].v[0] - g_view.eye.x, 0), g_view.eye.x - s->gmax[g].v[0]);
        float dz = fmaxf(fmaxf(s->gmin[g].v[2] - g_view.eye.z, 0), g_view.eye.z - s->gmax[g].v[2]);
        if (dx * dx + dz * dz > FINE_M * FINE_M) continue;
      }
      if (!t3d_frustum_vs_aabb(&g_view.frustum, &s->gmin[g], &s->gmax[g])) continue;
      rspq_block_run(s->group[g]); s_tris += s->gtris[g]; s_blocks++; s_objs += s->gobjs[g];
    }
  }
  if (g_profile) { rspq_wait(); uint32_t t = get_ticks_us(); g_perfCity[pass] = g_perfCity[pass] * 0.9f + (t - tk) * 0.1f; tk = t; }
  }
}

int stream_loaded_count(void) { int n = 0; for (int i = 0; i < MAX_SLOTS; i++) if (s_slots[i].idx >= 0 && !s_slots[i].freeIn) n++; return n; }
int stream_drawn_tris(void) { return s_tris; }
int stream_drawn_blocks(void) { return s_blocks; }
int stream_drawn_objects(void) { return s_objs; }
