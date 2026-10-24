// The city's collision and maps (rom:/world.bin, big-endian; written by tools/build_assets.mjs).
#include "world.h"

World g_world;
static uint16_t s_stamp;

static const uint8_t *s_p;
static int rd8(void) { return *s_p++; }
static int rd16s(void) { int v = (int16_t)((s_p[0] << 8) | s_p[1]); s_p += 2; return v; }
static int rd16(void) { int v = (s_p[0] << 8) | s_p[1]; s_p += 2; return v; }
static uint32_t rd32(void) { uint32_t v = ((uint32_t)s_p[0] << 24) | (s_p[1] << 16) | (s_p[2] << 8) | s_p[3]; s_p += 4; return v; }
static void align4(const uint8_t *base) { while ((s_p - base) & 3) s_p++; }

void world_load(void) {
  int size = 0;
  const uint8_t *data = asset_load("rom:/world.bin", &size);
  World *w = &g_world;
  s_p = data;
  assertf(data[0] == 'S' && data[1] == 'B' && data[2] == 'W' && data[3] == '1', "world.bin: bad magic");
  s_p += 4;
  w->min = rd16s(); w->size = rd16(); w->chunk = rd16(); w->chunks = rd16(); w->hcell = rd16(); w->hn = rd16();
  int nh = w->hn * w->hn;
  w->heights = malloc(nh * 2);
  for (int i = 0; i < nh; i++) w->heights[i] = rd16s();
  int ng = (w->hn - 1) * (w->hn - 1);
  w->ground = malloc(ng);
  for (int i = 0; i < ng; i++) w->ground[i] = rd8();
  align4(data);
  w->chunkFlags = malloc(w->chunks * w->chunks);
  for (int i = 0; i < w->chunks * w->chunks; i++) w->chunkFlags[i] = rd8();
  align4(data);
  w->nbox = rd32();
  w->boxes = malloc(sizeof(Box) * w->nbox);
  for (int i = 0; i < w->nbox; i++) {
    Box *b = &w->boxes[i];
    b->cx = rd16s() * 0.1f; b->cz = rd16s() * 0.1f; b->hx = rd16() * 0.01f; b->hz = rd16() * 0.01f;
    b->y0 = rd16s() * 0.01f; b->y1 = rd16s() * 0.01f; b->r0 = rd16s() * 0.01f; b->r1 = rd16s() * 0.01f;
    float yaw = rd8() * (TAU / 256.0f);
    b->flags = rd8(); b->kind = rd8(); rd8();
    b->c = cosf(yaw); b->s = sinf(yaw); b->stamp = 0;
    if (!(b->flags & BOX_RAMP)) { b->r0 = b->r1 = b->y1; }
  }
  w->gsize = rd16(); w->gn = rd16();
  w->gstart = malloc(4 * (w->gn * w->gn + 1));
  for (int i = 0; i <= w->gn * w->gn; i++) w->gstart[i] = rd32();
  int nidx = w->gstart[w->gn * w->gn];
  w->gidx = malloc(2 * nidx);
  for (int i = 0; i < nidx; i++) w->gidx[i] = rd16();
  align4(data);
  // streets
  w->nsnode = rd16(); w->nsedge = rd16();
  w->snodes = malloc(sizeof(StreetNode) * w->nsnode);
  for (int i = 0; i < w->nsnode; i++) { w->snodes[i].x = rd16s() * 0.1f; w->snodes[i].z = rd16s() * 0.1f; w->snodes[i].deg = rd8(); rd8(); }
  w->sedges = malloc(sizeof(StreetEdge) * w->nsedge);
  for (int i = 0; i < w->nsedge; i++) { StreetEdge *e = &w->sedges[i]; e->a = rd16(); e->b = rd16(); e->lanes = rd8(); e->half = rd8() * 0.1f; e->kind = rd8(); rd8(); }
  w->snodeEdges = calloc(w->nsnode * 4, 2); w->snodeEdgeCount = calloc(w->nsnode, 1);
  for (int i = 0; i < w->nsedge; i++) {
    for (int k = 0; k < 2; k++) { int n = k ? w->sedges[i].b : w->sedges[i].a; if (w->snodeEdgeCount[n] < 4) w->snodeEdges[n * 4 + w->snodeEdgeCount[n]++] = i; }
  }
  // sidewalks
  w->nwnode = rd16(); w->nwedge = rd16();
  w->wnodes = malloc(sizeof(WalkNode) * w->nwnode);
  for (int i = 0; i < w->nwnode; i++) { w->wnodes[i].x = rd16s() * 0.1f; w->wnodes[i].z = rd16s() * 0.1f; }
  w->wedges = malloc(sizeof(WalkEdge) * w->nwedge);
  for (int i = 0; i < w->nwedge; i++) { w->wedges[i].a = rd16(); w->wedges[i].b = rd16(); }
  w->wnodeEdges = calloc(w->nwnode * 6, 2); w->wnodeEdgeCount = calloc(w->nwnode, 1);
  for (int i = 0; i < w->nwedge; i++) {
    for (int k = 0; k < 2; k++) { int n = k ? w->wedges[i].b : w->wedges[i].a; if (w->wnodeEdgeCount[n] < 6) w->wnodeEdges[n * 6 + w->wnodeEdgeCount[n]++] = i; }
  }
  // spots
  w->nspot = rd16();
  w->spots = malloc(sizeof(Spot) * w->nspot);
  for (int i = 0; i < w->nspot; i++) {
    Spot *s = &w->spots[i];
    s->type = rd8(); s->param = rd8(); s->x = rd16s() * 0.1f; s->z = rd16s() * 0.1f; s->yaw = rd8() * (TAU / 256.0f); s->district = rd8();
  }
  for (int i = 0; i < 10; i++) w->lines[i] = rd16s();
  for (int i = 0; i < 81; i++) w->dmap[i] = rd8();
  for (int i = 0; i < 81; i++) w->owner[i] = rd8();
  free((void *)data);
}

// ---- terrain ----
float world_terrain(float x, float z) {
  World *w = &g_world;
  float fi = (x - w->min) / w->hcell, fj = (z - w->min) / w->hcell;
  int i = (int)floorf(fi), j = (int)floorf(fj);
  i = maxi(0, mini(w->hn - 2, i)); j = maxi(0, mini(w->hn - 2, j));
  float u = clampf(fi - i, 0, 1), v = clampf(fj - j, 0, 1);
  const int16_t *h = w->heights;
  int n = w->hn;
  float h00 = h[j * n + i], h10 = h[j * n + i + 1], h01 = h[(j + 1) * n + i], h11 = h[(j + 1) * n + i + 1];
  return (h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v) * 0.01f;
}
int world_ground_kind(float x, float z) {
  World *w = &g_world;
  int i = (int)((x - w->min) / w->hcell), j = (int)((z - w->min) / w->hcell);
  if (i < 0 || j < 0 || i >= w->hn - 1 || j >= w->hn - 1) return GROUND_WATER;
  return w->ground[j * (w->hn - 1) + i];
}

// ---- boxes ----
static inline void to_local(const Box *b, float x, float z, float *lx, float *lz) {
  float dx = x - b->cx, dz = z - b->cz;
  *lx = dx * b->c - dz * b->s;
  *lz = dx * b->s + dz * b->c;
}
static inline float box_top_at(const Box *b, float lz) {
  if (!(b->flags & BOX_RAMP)) return b->y1;
  float t = clampf((lz + b->hz) / (2 * b->hz), 0, 1);
  return b->r0 + (b->r1 - b->r0) * t;
}
// the boxes in the cells a circle touches, each once
#define MAXQ 160
static const Box *s_q[MAXQ];
static int gather(float x, float z, float r) {
  World *w = &g_world;
  int n = 0;
  if (++s_stamp == 0) { for (int i = 0; i < w->nbox; i++) w->boxes[i].stamp = 0; s_stamp = 1; }
  int i0 = (int)((x - r - w->min) / w->gsize), i1 = (int)((x + r - w->min) / w->gsize);
  int j0 = (int)((z - r - w->min) / w->gsize), j1 = (int)((z + r - w->min) / w->gsize);
  i0 = maxi(0, i0); j0 = maxi(0, j0); i1 = mini(w->gn - 1, i1); j1 = mini(w->gn - 1, j1);
  for (int j = j0; j <= j1; j++) for (int i = i0; i <= i1; i++) {
    int c = j * w->gn + i;
    for (uint32_t k = w->gstart[c]; k < w->gstart[c + 1]; k++) {
      Box *b = &w->boxes[w->gidx[k]];
      if (b->stamp == s_stamp) continue;
      b->stamp = s_stamp;
      if (n < MAXQ) s_q[n++] = b;
    }
  }
  return n;
}

float world_floor(float x, float z, float yTop, const Box **onBox) {
  float best = world_terrain(x, z);
  const Box *bb = NULL;
  int n = gather(x, z, 0.1f);
  for (int i = 0; i < n; i++) {
    const Box *b = s_q[i];
    float lx, lz; to_local(b, x, z, &lx, &lz);
    if (fabsf(lx) > b->hx || fabsf(lz) > b->hz) continue;
    float top = box_top_at(b, lz);
    if (top <= yTop + 0.001f && top > best) { best = top; bb = b; }
  }
  if (onBox) *onBox = bb;
  return best;
}

float world_ceiling(float x, float z, float y) {
  float best = 1e9f;
  int n = gather(x, z, 0.1f);
  for (int i = 0; i < n; i++) {
    const Box *b = s_q[i];
    float lx, lz; to_local(b, x, z, &lx, &lz);
    if (fabsf(lx) > b->hx || fabsf(lz) > b->hz) continue;
    if (b->y0 >= y && b->y0 < best) best = b->y0;
  }
  return best;
}

V3 world_push(float *x, float *z, float r, float y0, float y1) {
  V3 normal = {0, 0, 0};
  for (int pass = 0; pass < 2; pass++) {
    int n = gather(*x, *z, r + 0.5f);
    for (int i = 0; i < n; i++) {
      const Box *b = s_q[i];
      if (b->y0 >= y1) continue;
      float lx, lz; to_local(b, *x, *z, &lx, &lz);
      float qx = clampf(lx, -b->hx, b->hx), qz = clampf(lz, -b->hz, b->hz);
      float top = box_top_at(b, qz);
      if (top <= y0) continue; // low enough to step onto: a floor, not a wall
      float dx = lx - qx, dz = lz - qz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      float px, pz;
      if (d2 > 1e-8f) {
        float d = sqrtf(d2), k = (r - d) / d;
        px = dx * k; pz = dz * k;
      } else {
        // the centre is inside: out along the shallowest side
        float ex = b->hx - fabsf(lx), ez = b->hz - fabsf(lz);
        if (ex < ez) { px = (ex + r) * signf(lx); pz = 0; } else { px = 0; pz = (ez + r) * signf(lz); }
      }
      float wx = px * b->c + pz * b->s, wz = -px * b->s + pz * b->c;
      *x += wx; *z += wz;
      float l = sqrtf(wx * wx + wz * wz);
      if (l > 1e-5f) normal = (V3){wx / l, 0, wz / l};
    }
  }
  return normal;
}

// separating axes between two rectangles in the xz plane
V3 world_push_rect(float *x, float *z, float yaw, float hx, float hz, float y0, float y1, float *depthOut) {
  V3 normal = {0, 0, 0};
  float deepest = 0;
  float c = cosf(yaw), s = sinf(yaw);
  for (int pass = 0; pass < 2; pass++) {
    int n = gather(*x, *z, sqrtf(hx * hx + hz * hz) + 0.5f);
    for (int i = 0; i < n; i++) {
      const Box *b = s_q[i];
      if (b->y0 >= y1) continue;
      if (b->y1 <= y0 && !(b->flags & BOX_RAMP)) continue;
      if ((b->flags & BOX_RAMP)) continue; // ramps are driven up, never walls
      // axes: the car's local x/z, the box's local x/z (world directions)
      float ax[4][2] = {{c, -s}, {s, c}, {b->c, -b->s}, {b->s, b->c}};
      float dx = b->cx - *x, dz = b->cz - *z;
      float best = 1e9f, bnx = 0, bnz = 0;
      bool sep = false;
      for (int k = 0; k < 4; k++) {
        float axx = ax[k][0], axz = ax[k][1];
        float ra = hx * fabsf(c * axx - s * axz) + hz * fabsf(s * axx + c * axz);
        float rb = b->hx * fabsf(b->c * axx - b->s * axz) + b->hz * fabsf(b->s * axx + b->c * axz);
        float d = dx * axx + dz * axz;
        float o = ra + rb - fabsf(d);
        if (o <= 0) { sep = true; break; }
        if (o < best) { best = o; bnx = -axx * signf(d); bnz = -axz * signf(d); }
      }
      if (sep) continue;
      *x += bnx * best; *z += bnz * best;
      if (best > deepest) { deepest = best; normal = (V3){bnx, 0, bnz}; }
    }
  }
  if (depthOut) *depthOut = deepest;
  return normal;
}

// ---- rays ----
static bool ray_box(const Box *b, V3 o, V3 d, float tmax, float *tOut, V3 *nOut) {
  // into the box's frame
  float lx, lz; to_local(b, o.x, o.z, &lx, &lz);
  float dlx = d.x * b->c - d.z * b->s, dlz = d.x * b->s + d.z * b->c;
  float lo[3] = {-b->hx, b->y0, -b->hz}, hi[3] = {b->hx, maxf(b->r0, b->r1), b->hz};
  float org[3] = {lx, o.y, lz}, dir[3] = {dlx, d.y, dlz};
  float t0 = 0, t1 = tmax; int axis = -1; float sgn = 0;
  for (int k = 0; k < 3; k++) {
    if (fabsf(dir[k]) < 1e-7f) { if (org[k] < lo[k] || org[k] > hi[k]) return false; continue; }
    float inv = 1.0f / dir[k];
    float ta = (lo[k] - org[k]) * inv, tb = (hi[k] - org[k]) * inv;
    float s = -1;
    if (ta > tb) { float tmp = ta; ta = tb; tb = tmp; s = 1; }
    if (ta > t0) { t0 = ta; axis = k; sgn = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (axis < 0) { *tOut = 0; if (nOut) *nOut = (V3){0, 1, 0}; return true; } // starts inside
  if (b->flags & BOX_RAMP) {
    // the slope: test the point against the ramp's top there (good enough for shots and the camera)
    float pz = org[2] + dir[2] * t0, py = org[1] + dir[1] * t0;
    if (py > box_top_at(b, pz) + 0.05f) return false;
  }
  *tOut = t0;
  if (nOut) {
    V3 n = {0, 0, 0};
    if (axis == 1) n.y = sgn;
    else {
      float nlx = axis == 0 ? sgn : 0, nlz = axis == 2 ? sgn : 0;
      n.x = nlx * b->c + nlz * b->s; n.z = -nlx * b->s + nlz * b->c;
    }
    *nOut = n;
  }
  return true;
}

bool world_raycast(V3 from, V3 to, float *tOut, V3 *nOut) {
  World *w = &g_world;
  V3 d = v3_sub(to, from);
  float len = v3_len(d);
  if (len < 1e-4f) return false;
  float best = 1.0f; bool hit = false; V3 bn = {0, 1, 0};
  // boxes: walk the grid cells along the segment
  if (++s_stamp == 0) { for (int i = 0; i < w->nbox; i++) w->boxes[i].stamp = 0; s_stamp = 1; }
  float gx = (from.x - w->min) / w->gsize, gz = (from.z - w->min) / w->gsize;
  float ex = (to.x - w->min) / w->gsize, ez = (to.z - w->min) / w->gsize;
  int ci = (int)floorf(gx), cj = (int)floorf(gz), ti = (int)floorf(ex), tj = (int)floorf(ez);
  int stepi = ex > gx ? 1 : -1, stepj = ez > gz ? 1 : -1;
  float ddx = fabsf(ex - gx) > 1e-6f ? 1.0f / fabsf(ex - gx) : 1e9f, ddz = fabsf(ez - gz) > 1e-6f ? 1.0f / fabsf(ez - gz) : 1e9f;
  float tx = (stepi > 0 ? (ci + 1 - gx) : (gx - ci)) * ddx, tz = (stepj > 0 ? (cj + 1 - gz) : (gz - cj)) * ddz;
  for (int guard = 0; guard < 64; guard++) {
    if (ci >= 0 && cj >= 0 && ci < w->gn && cj < w->gn) {
      int c = cj * w->gn + ci;
      for (uint32_t k = w->gstart[c]; k < w->gstart[c + 1]; k++) {
        Box *b = &w->boxes[w->gidx[k]];
        if (b->stamp == s_stamp) continue;
        b->stamp = s_stamp;
        float t; V3 n;
        if (ray_box(b, from, d, best, &t, &n)) { if (t < best) { best = t; bn = n; hit = true; } }
      }
    }
    if (ci == ti && cj == tj) break;
    if (tx < tz) { if (tx > best) break; tx += ddx; ci += stepi; } else { if (tz > best) break; tz += ddz; cj += stepj; }
  }
  // the terrain: march (2 m steps), then refine
  int steps = (int)(len / 2.0f) + 1;
  float prevT = 0, prevD = from.y - world_terrain(from.x, from.z);
  if (prevD > -0.05f) {
    for (int k = 1; k <= steps; k++) {
      float t = (float)k / steps;
      if (t > best) break;
      V3 p = v3_mad(from, d, t);
      float dd = p.y - world_terrain(p.x, p.z);
      if (dd < 0) {
        float a = prevT, bb = t;
        for (int it = 0; it < 6; it++) { float m = (a + bb) * 0.5f; V3 q = v3_mad(from, d, m); if (q.y - world_terrain(q.x, q.z) < 0) bb = m; else a = m; }
        if (bb < best) { best = bb; bn = (V3){0, 1, 0}; hit = true; }
        break;
      }
      prevT = t; prevD = dd;
    }
  }
  if (hit) { *tOut = best; if (nOut) *nOut = bn; }
  return hit;
}

// ---- districts and places ----
int world_block(float x, float z) {
  const int16_t *L = g_world.lines;
  int bx = -1, bz = -1;
  for (int i = 0; i < 9; i++) { if (x >= L[i] && x < L[i + 1]) bx = i; if (z >= L[i] && z < L[i + 1]) bz = i; }
  return (bx < 0 || bz < 0) ? -1 : bz * 9 + bx;
}
const char *world_district_name(float x, float z) {
  int b = world_block(x, z);
  if (b < 0) {
    if (z > 576) return "Sunset Beach";
    if (x > 576) return "Port Ardent";
    if (x < -500 && z < -300) return "Ridge Park";
    return "Costa Verde";
  }
  switch (g_world.dmap[b]) {
    case 'H': return "Ridge Park"; case 'S': return "Oak Hills"; case 'C': return "Commerce Row"; case 'D': return "Downtown";
    case 'I': return "Port Ardent"; case 'R': case 'K': case 'G': return "Palm Court"; case 'V': return "Violet Heights";
    case 'Y': return "Gold Coast"; case 'P': return "Central Park"; case 'B': return "Sunset Beach";
  }
  return "Costa Verde";
}
int world_find_spot(int type, V3 near, float minDist, float maxDist, int skip) {
  int found = -1, seen = 0;
  float min2 = minDist * minDist, max2 = maxDist * maxDist;
  // a random pick among the spots in range (reservoir sampling), skipping `skip` matches
  for (int i = 0; i < g_world.nspot; i++) {
    const Spot *s = &g_world.spots[i];
    if (s->type != type) continue;
    float d2 = sqrf(s->x - near.x) + sqrf(s->z - near.z);
    if (d2 < min2 || d2 > max2) continue;
    seen++;
    if (rnd_int(seen) == 0) found = i;
  }
  (void)skip;
  return found;
}
int world_nearest_walk(float x, float z) {
  int best = -1; float bd = 1e18f;
  for (int i = 0; i < g_world.nwnode; i++) { float d = sqrf(g_world.wnodes[i].x - x) + sqrf(g_world.wnodes[i].z - z); if (d < bd) { bd = d; best = i; } }
  return best;
}
int world_nearest_street(float x, float z) {
  int best = -1; float bd = 1e18f;
  for (int i = 0; i < g_world.nsnode; i++) { float d = sqrf(g_world.snodes[i].x - x) + sqrf(g_world.snodes[i].z - z); if (d < bd) { bd = d; best = i; } }
  return best;
}
