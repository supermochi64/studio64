// The city's collision and maps, from rom:/world.bin (made by tools/build_assets.mjs, tools/city.mjs).
#pragma once
#include "common.h"

#define WATER_Y (-0.5f)

enum { BOX_RAMP = 1, BOX_THIN = 2, BOX_NOCAM = 4, BOX_LOW = 8, BOX_WATER = 16 };
enum { GROUND_ROAD, GROUND_CONCRETE, GROUND_GRASS, GROUND_SAND, GROUND_WATER, GROUND_DIRT };
enum { SPOT_PARK = 1, SPOT_HANGOUT, SPOT_PICKUP, SPOT_HOME, SPOT_SHOP, SPOT_HOSPITAL, SPOT_POLICE, SPOT_PED, SPOT_RAMP, SPOT_BENCH };

typedef struct {
  float cx, cz, hx, hz;   // centre and half extents (local x/z)
  float y0, y1;           // bottom, top (a ramp: the top is r0..r1 along local z)
  float r0, r1;
  float c, s;             // cos/sin of the yaw
  uint8_t flags, kind;
  uint16_t stamp;         // (queries: visited)
} Box;

typedef struct { float x, z; uint8_t deg; } StreetNode;
typedef struct { uint16_t a, b; uint8_t lanes, kind; float half; } StreetEdge;
typedef struct { float x, z; } WalkNode;
typedef struct { uint16_t a, b; } WalkEdge;
typedef struct { uint8_t type, param, district; float x, z, yaw; } Spot;

typedef struct {
  float min; int size, chunk, chunks, hcell, hn;
  int16_t *heights;    // cm
  uint8_t *ground;
  uint8_t *chunkFlags; // bit 0: detail model, bit 1: far model
  Box *boxes; int nbox;
  int gsize, gn; uint32_t *gstart; uint16_t *gidx;
  StreetNode *snodes; int nsnode; StreetEdge *sedges; int nsedge;
  uint16_t *snodeEdges; uint8_t *snodeEdgeCount; // up to 4 edges per node
  WalkNode *wnodes; int nwnode; WalkEdge *wedges; int nwedge;
  uint16_t *wnodeEdges; uint8_t *wnodeEdgeCount; // up to 6 per node
  Spot *spots; int nspot;
  int16_t lines[10];
  char dmap[81];
  uint8_t owner[81];   // the gang holding each block (changes in gang wars, saved)
} World;
extern World g_world;

void world_load(void);
float world_terrain(float x, float z);
int world_ground_kind(float x, float z);
// the highest floor under (x, z) no higher than yTop (terrain or a box top); *box: the box stood on
float world_floor(float x, float z, float yTop, const Box **box);
// the lowest ceiling above y (a box's bottom), or 1e9
float world_ceiling(float x, float z, float y);
// push a vertical cylinder out of walls (boxes whose span overlaps y0..y1); returns a wall normal or {0}
V3 world_push(float *x, float *z, float r, float y0, float y1);
// a rotated rectangle (vehicles) against walls: pushes, returns the normal of the deepest wall (or {0})
V3 world_push_rect(float *x, float *z, float yaw, float hx, float hz, float y0, float y1, float *depth);
// first hit of the segment from -> to (walls, floors, the terrain); t in 0..1
bool world_raycast(V3 from, V3 to, float *t, V3 *normal);
static inline bool world_los(V3 a, V3 b) { float t; return !world_raycast(a, b, &t, NULL); }
// the block (0..80) containing a point, or -1
int world_block(float x, float z);
const char *world_district_name(float x, float z);
int world_find_spot(int type, V3 near, float minDist, float maxDist, int skip);
int world_nearest_walk(float x, float z);
int world_nearest_street(float x, float z);
// a pole (lamp post, palm, tree trunk: boxes of kind 3) within r of (x, z) that reaches height y
bool world_find_pole(float x, float z, float y, float r, float *cx, float *cz, float *bottom, float *top);
