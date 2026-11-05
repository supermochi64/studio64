// Studio 64 editor support: building blocks, mouse picking, the free editor
// camera and the build-mode pause.

#include <ultra64.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "sm64.h"
#include "types.h"
#include "behavior_data.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/area.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "surface_terrains.h"
#include "studio.h"
#include "studio_assets.h"

#define o gCurrentObject
#define CLAMP_SIZE(v) ((v) < 10.0f ? 10.0f : ((v) > 16000.0f ? 16000.0f : (v)))

// ---------------------------------------------------------------------------
// Materials: level textures that tile well on blocks (all 32x32 RGBA16).

extern const u8 generic_09005800[], grass_09005000[], generic_0900A000[], generic_09003000[],
    grass_09008000[], generic_09003800[], grass_09000800[], grass_09008800[], grass_09009000[],
    mountain_09007000[], grass_09007000[], sky_09001000[], mountain_09000000[], grass_09006800[],
    snow_09008000[], sky_09008000[], fire_09004000[], fire_09001800[], generic_09008000[],
    sky_09007000[], snow_09002000[], fire_09009000[], grass_09004000[],
    spooky_0900A000[], machine_09005000[], sky_09005800[], generic_09002000[], generic_09007800[],
    outside_09003800[], water_09000000[];

struct StudioMaterial {
    const char *name;
    const u8 *top;
    const u8 *side;
};

static const struct StudioMaterial sMaterials[] = {
    { "grass", generic_09005800, grass_09005000 },
    { "dirt", generic_0900A000, generic_0900A000 },
    { "cobblestone", generic_09003000, generic_09003000 },
    { "stone path", grass_09008000, grass_09008000 },
    { "blue stone", generic_09003800, generic_09003800 },
    { "dark brick", grass_09000800, grass_09000800 },
    { "grey brick", grass_09008800, grass_09008800 },
    { "red brick", grass_09009000, grass_09009000 },
    { "orange brick", mountain_09007000, mountain_09007000 },
    { "castle stone", grass_09007000, grass_09007000 },
    { "stone block", sky_09001000, sky_09001000 },
    { "mossy block", mountain_09000000, mountain_09000000 },
    { "wood planks", grass_09006800, grass_09006800 },
    { "wood floor", snow_09008000, snow_09008000 },
    { "checker", sky_09008000, sky_09008000 },
    { "tiles", fire_09004000, fire_09004000 },
    { "marble", fire_09001800, fire_09001800 },
    { "sand", generic_09008000, generic_09008000 },
    { "snow", sky_09007000, sky_09007000 },
    { "ice", snow_09002000, snow_09002000 },
    { "lava", fire_09009000, fire_09009000 },
    { "metal", grass_09004000, grass_09004000 },
    { "metal plate", spooky_0900A000, spooky_0900A000 },
    { "yellow block", machine_09005000, machine_09005000 },
    { "rainbow", sky_09005800, sky_09005800 },
    { "rock", generic_09002000, generic_09002000 },
    { "roof", generic_09007800, generic_09007800 },
    { "dark grass", outside_09003800, outside_09003800 },
    { "water", water_09000000, water_09000000 },
};
#define MATERIAL_COUNT ((s32) (sizeof(sMaterials) / sizeof(sMaterials[0])))

EMSCRIPTEN_KEEPALIVE s32 studio_material_count(void) {
    return MATERIAL_COUNT;
}
EMSCRIPTEN_KEEPALIVE const char *studio_material_name(s32 i) {
    return (i >= 0 && i < MATERIAL_COUNT) ? sMaterials[i].name : "";
}
// Pointer to the 32x32 RGBA16 (big endian 5551) texels, for palette swatches.
EMSCRIPTEN_KEEPALIVE const u8 *studio_material_texels(s32 i, s32 side) {
    if (i < 0 || i >= MATERIAL_COUNT) {
        return studio_custom_material_texels(i); // the project's own materials (assets.c), or NULL
    }
    return side ? sMaterials[i].side : sMaterials[i].top;
}
static s32 material_ok(s32 i) {
    return studio_material_texels(i, 0) != NULL;
}

// ---------------------------------------------------------------------------
// Mesh building. Shapes are built in local space: x in [-sx/2, sx/2],
// y in [0, sy] (origin on the ground), z in [-sz/2, sz/2].

enum { SHAPE_BOX, SHAPE_RAMP, SHAPE_STAIRS, SHAPE_CYLINDER, SHAPE_RAMP_INNER, SHAPE_RAMP_OUTER,
       SHAPE_STAIRS_INNER, SHAPE_STAIRS_OUTER, SHAPE_SPHERE, SHAPE_TERRAIN, SHAPE_COUNT };
#define IS_STAIRS(s) ((s) == SHAPE_STAIRS || (s) == SHAPE_STAIRS_INNER || (s) == SHAPE_STAIRS_OUTER)

#define MAX_POLY_VERTS 8
#define MAX_POLYS 2400
#define PATCH_MAX 32     // terrain patch: at most 32 x 32 cells (2048 triangles on top)
#define PATCH_DEFAULT 16

struct Poly {
    s32 n;
    f32 v[MAX_POLY_VERTS][3];
    f32 uv[MAX_POLY_VERTS][2]; // texture coordinates in world units (hasUV); else planar per polygon
    f32 vn[MAX_POLY_VERTS][3]; // vertex normals (smooth: curved shapes shade without facets)
    f32 hint[3];               // the outward direction (hasHint); else away from sHull
    s8 hasUV, smooth, hasHint;
    s16 mat;                   // a painted material (terrain patch); -1: the block's top / side
    s16 surf;                  // collision: its own surface type; -1: the block's
};

struct MeshKey {
    s32 shape, steps, top, side, surface, color;
    s32 sx, sy, sz;
    s32 translucent;
    u32 data; // terrain patch: hash of its heights and paint
};

struct StudioMesh {
    struct MeshKey key;
    s32 nv;   // vertices in vtx (polygon after polygon; v.flag = polygon size)
    Vtx *vtx;
    s8 (*vn)[4]; // per vertex: normal (x127) and 1 when smooth-shaded (for relighting)
    Gfx *dl;
    s16 *col;
    struct GraphNode *node;
};

static struct Poly sGfxPolys[MAX_POLYS];
static s32 sGfxPolyCount;
static struct Poly sColPolys[MAX_POLYS];
static s32 sColPolyCount;
static f32 sHull[3];

// The terrain patch the next studio_spawn_block builds (studio_block_patch).
static s16 sPatchH[(PATCH_MAX + 1) * (PATCH_MAX + 1)];
static u8 sPatchM[PATCH_MAX * PATCH_MAX];
static s32 sPatchN;

static struct Poly *poly_init(struct Poly *p, s32 n) {
    p->n = n;
    p->hasUV = p->smooth = p->hasHint = 0;
    p->mat = -1;
    p->surf = -1;
    return p;
}
static struct Poly *gfx_poly(s32 n) {
    return poly_init(&sGfxPolys[sGfxPolyCount < MAX_POLYS - 1 ? sGfxPolyCount++ : sGfxPolyCount], n);
}
static struct Poly *col_poly(s32 n) {
    return poly_init(&sColPolys[sColPolyCount < MAX_POLYS - 1 ? sColPolyCount++ : sColPolyCount], n);
}
static void setv(f32 *v, f32 x, f32 y, f32 z) {
    v[0] = x;
    v[1] = y;
    v[2] = z;
}
static void quad(struct Poly *p, f32 ax, f32 ay, f32 az, f32 bx, f32 by, f32 bz, f32 cx, f32 cy, f32 cz,
                 f32 dx, f32 dy, f32 dz) {
    setv(p->v[0], ax, ay, az);
    setv(p->v[1], bx, by, bz);
    setv(p->v[2], cx, cy, cz);
    setv(p->v[3], dx, dy, dz);
}

static const f32 UP[3] = { 0, 1, 0 }, DOWN[3] = { 0, -1, 0 }, PX[3] = { 1, 0, 0 }, NX[3] = { -1, 0, 0 },
                 PZ[3] = { 0, 0, 1 }, NZ[3] = { 0, 0, -1 };

static struct Poly *hinted(struct Poly *p, const f32 *h) {
    memcpy(p->hint, h, sizeof(p->hint));
    p->hasHint = TRUE;
    return p;
}
// Axis-aligned faces with a known outside: at y over [x0,x1]x[z0,z1], at x over [z0,z1]x[y0,y1],
// at z over [x0,x1]x[y0,y1].
static struct Poly *yface(struct Poly *(*add)(s32), const f32 *h, f32 y, f32 x0, f32 x1, f32 z0, f32 z1) {
    struct Poly *p = add(4);
    quad(p, x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    return hinted(p, h);
}
static struct Poly *xface(struct Poly *(*add)(s32), const f32 *h, f32 x, f32 z0, f32 z1, f32 y0, f32 y1) {
    struct Poly *p = add(4);
    quad(p, x, y0, z0, x, y0, z1, x, y1, z1, x, y1, z0);
    return hinted(p, h);
}
static struct Poly *zface(struct Poly *(*add)(s32), const f32 *h, f32 z, f32 x0, f32 x1, f32 y0, f32 y1) {
    struct Poly *p = add(4);
    quad(p, x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    return hinted(p, h);
}
static struct Poly *tri(struct Poly *(*add)(s32), const f32 *h, const f32 *a, const f32 *b, const f32 *c) {
    struct Poly *p = add(3);
    memcpy(p->v[0], a, sizeof(p->v[0]));
    memcpy(p->v[1], b, sizeof(p->v[0]));
    memcpy(p->v[2], c, sizeof(p->v[0]));
    return h != NULL ? hinted(p, h) : p;
}
static struct Poly *poly_of(struct Poly *(*add)(s32), const f32 *h, s32 n, f32 (*pts)[3]) {
    struct Poly *p = add(n);
    memcpy(p->v, pts, sizeof(f32) * 3 * n);
    return hinted(p, h);
}
// Texture coordinates from two axes, relative to a common origin (so neighbours line up).
static void planar_uv(struct Poly *p, s32 ua, s32 va, f32 ou, f32 ov, s32 flipV) {
    s32 j;
    for (j = 0; j < p->n; j++) {
        p->uv[j][0] = p->v[j][ua] - ou;
        p->uv[j][1] = flipV ? ov - p->v[j][va] : p->v[j][va] - ov;
    }
    p->hasUV = TRUE;
}

// Faces of an axis-aligned box from (x0,y0,z0) to (x1,y1,z1).
static void box_polys(struct Poly *(*add)(s32), f32 x0, f32 y0, f32 z0, f32 x1, f32 y1, f32 z1, s32 skipBottom) {
    quad(add(4), x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1); // top
    if (!skipBottom) {
        quad(add(4), x0, y0, z0, x0, y0, z1, x1, y0, z1, x1, y0, z0); // bottom
    }
    quad(add(4), x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1); // +z
    quad(add(4), x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0); // -z
    quad(add(4), x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0); // +x
    quad(add(4), x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1); // -x
}

static void prism_polys(struct Poly *(*add)(s32), f32 hx, f32 *pz, f32 *py, s32 n) {
    s32 i;
    struct Poly *a = add(n), *b = add(n);
    for (i = 0; i < n; i++) {
        setv(a->v[i], hx, py[i], pz[i]);
        setv(b->v[i], -hx, py[i], pz[i]);
    }
    for (i = 0; i < n; i++) {
        s32 j = (i + 1) % n;
        quad(add(4), hx, py[i], pz[i], hx, py[j], pz[j], -hx, py[j], pz[j], -hx, py[i], pz[i]);
    }
}

// Texture coordinates of a top face that continues a ramp or stairs turned toward +x (a quarter
// turn: u runs along -z, v along x from vx0), or one rising toward +z (u along x, v along z from vz0).
static void uv_turned(struct Poly *p, f32 hz, f32 vx0) {
    s32 j;
    for (j = 0; j < p->n; j++) {
        p->uv[j][0] = hz - p->v[j][2];
        p->uv[j][1] = p->v[j][0] - vx0;
    }
    p->hasUV = TRUE;
}
static void uv_straight(struct Poly *p, f32 hx, f32 vz0) {
    s32 j;
    for (j = 0; j < p->n; j++) {
        p->uv[j][0] = p->v[j][0] + hx;
        p->uv[j][1] = p->v[j][2] - vz0;
    }
    p->hasUV = TRUE;
}
// Outer stairs corner, tread at height y: the L from (x0,z0) to the far corner (hx,hz) minus the
// square beyond (x1,z1), cut along the diagonal (x0,z0)-(x1,z1).
static void tread_miter(f32 y, f32 x0, f32 z0, f32 x1, f32 z1, f32 hz, f32 hx, s32 last) {
    f32 a[3] = { x0, y, z0 }, b[3] = { x1, y, z1 };
    if (last) {
        f32 c[3] = { x0, y, hz }, d[3] = { hx, y, z0 };
        uv_turned(tri(gfx_poly, UP, a, b, c), hz, x0);
        uv_straight(tri(gfx_poly, UP, a, d, b), hx, z0);
    } else {
        f32 alongZ[4][3] = { { x0, y, z0 }, { x1, y, z1 }, { x1, y, hz }, { x0, y, hz } };
        f32 alongX[4][3] = { { x0, y, z0 }, { hx, y, z0 }, { hx, y, z1 }, { x1, y, z1 } };
        uv_turned(poly_of(gfx_poly, UP, 4, alongZ), hz, x0);
        uv_straight(poly_of(gfx_poly, UP, 4, alongX), hx, z0);
    }
}
// Inner stairs corner, tread at height y: the L from the near corner (lx,lz) to (x1,z1) minus the
// square up to (x0,z0), cut along the diagonal (x0,z0)-(x1,z1).
static void tread_miter_inner(f32 y, f32 lx, f32 lz, f32 x0, f32 z0, f32 x1, f32 z1, s32 first) {
    f32 hz = -lz, hx = -lx;
    if (first) {
        f32 a[3] = { lx, y, lz }, b[3] = { x1, y, z1 }, c[3] = { x1, y, lz }, d[3] = { lx, y, z1 };
        uv_turned(tri(gfx_poly, UP, a, c, b), hz, lx);
        uv_straight(tri(gfx_poly, UP, a, b, d), hx, lz);
    } else {
        f32 alongZ[4][3] = { { x0, y, lz }, { x1, y, lz }, { x1, y, z1 }, { x0, y, z0 } };
        f32 alongX[4][3] = { { lx, y, z0 }, { x0, y, z0 }, { x1, y, z1 }, { lx, y, z1 } };
        uv_turned(poly_of(gfx_poly, UP, 4, alongZ), hz, x0);
        uv_straight(poly_of(gfx_poly, UP, 4, alongX), hx, z0);
    }
}

// ---- corner pieces ----
// A ramp rises toward +z (height sy * w, w = 0..1 over z). Its corners take the lower (outer,
// convex: min) or the higher (inner, concave: max) of a ramp rising toward +z and one rising
// toward +x, so they continue a ramp on either side: the outer corner a ramp at its +x side (same
// yaw) and one at its +z side turned 90 degrees, the inner corner ramps at its -x and -z sides.

static void ramp_corner(struct Poly *(*add)(s32), f32 hx, f32 sy, f32 hz, s32 inner) {
    f32 b00[3] = { -hx, 0, -hz }, b10[3] = { hx, 0, -hz }, b11[3] = { hx, 0, hz }, b01[3] = { -hx, 0, hz };
    yface(add, DOWN, 0, -hx, hx, -hz, hz);
    if (!inner) {
        f32 a[3] = { hx, sy, hz };
        uv_turned(tri(add, UP, b00, b01, a), hz, -hx);  // rises toward +x (textured like a turned ramp)
        uv_straight(tri(add, UP, b00, b10, a), hx, -hz); // rises toward +z
        tri(add, PX, b10, b11, a);
        tri(add, PZ, b01, b11, a);
    } else {
        f32 t10[3] = { hx, sy, -hz }, t11[3] = { hx, sy, hz }, t01[3] = { -hx, sy, hz };
        uv_turned(tri(add, UP, b00, t10, t11), hz, -hx);  // rises toward +x
        uv_straight(tri(add, UP, b00, t11, t01), hx, -hz); // rises toward +z
        tri(add, NX, b00, b01, t01);
        tri(add, NZ, b00, b10, t10);
        xface(add, PX, hx, -hz, hz, 0, sy);
        zface(add, PZ, hz, -hx, hx, 0, sy);
    }
}

// Stairs corners: the steps of stairs rising toward +z and of stairs rising toward +x, the lower
// (outer) or the higher (inner) of the two at every point. Drawn as treads, risers and side walls;
// the collision is the stairs' ramp (through the middle of every tread) cornered the same way.
static void stairs_corner(f32 hx, f32 sy, f32 hz, s32 steps, s32 inner) {
    f32 sx = hx * 2, sz = hz * 2, dx = sx / steps, dz = sz / steps, h = sy / steps;
    f32 a = 1.0f - 0.5f / steps, xa = -hx + a * sx, za = -hz + a * sz, hm = h / 2;
    s32 k;
#define XK(k) (-hx + (k) * dx)
#define ZK(k) (-hz + (k) * dz)
    yface(gfx_poly, DOWN, 0, -hx, hx, -hz, hz);
    for (k = 0; k < steps; k++) {
        f32 top = (k + 1) * h, bot = k * h;
        if (!inner) {
            // step k: the box from (XK(k), ZK(k)) to the far corner (hx, hz)
            // the tread is an L, mitred on the diagonal: the half along z continues the stairs
            // turned toward +x, the half along x the stairs rising toward +z
            tread_miter(top, XK(k), ZK(k), XK(k + 1), ZK(k + 1), hz, hx, k == steps - 1);
            xface(gfx_poly, NX, XK(k), ZK(k), hz, bot, top); // risers
            zface(gfx_poly, NZ, ZK(k), XK(k), hx, bot, top);
            xface(gfx_poly, PX, hx, ZK(k), ZK(k + 1), 0, top); // side walls, a staircase profile
            zface(gfx_poly, PZ, hz, XK(k), XK(k + 1), 0, top);
        } else {
            // step k: everything but the square from (-hx, -hz) to (XK(k), ZK(k))
            tread_miter_inner(top, -hx, -hz, XK(k), ZK(k), XK(k + 1), ZK(k + 1), k == 0);
            if (k > 0) {
                xface(gfx_poly, NX, XK(k), -hz, ZK(k), bot, top); // risers
                zface(gfx_poly, NZ, ZK(k), -hx, XK(k), bot, top);
            }
            xface(gfx_poly, NX, -hx, ZK(k), ZK(k + 1), 0, top); // side walls
            zface(gfx_poly, NZ, -hz, XK(k), XK(k + 1), 0, top);
        }
    }
    if (inner) {
        xface(gfx_poly, PX, hx, -hz, hz, 0, sy); // the back walls
        zface(gfx_poly, PZ, hz, -hx, hx, 0, sy);
    }
#undef XK
#undef ZK

    // collision: P(t) = hm at the front, rising to sy at t = a, flat after
    yface(col_poly, DOWN, 0, -hx, hx, -hz, hz);
    if (!inner) {
        f32 q1[4][3] = { { -hx, hm, -hz }, { xa, sy, za }, { xa, sy, hz }, { -hx, hm, hz } };
        f32 q2[4][3] = { { -hx, hm, -hz }, { hx, hm, -hz }, { hx, sy, za }, { xa, sy, za } };
        f32 sideX[5][3] = { { hx, 0, -hz }, { hx, hm, -hz }, { hx, sy, za }, { hx, sy, hz }, { hx, 0, hz } };
        f32 sideZ[5][3] = { { -hx, 0, hz }, { -hx, hm, hz }, { xa, sy, hz }, { hx, sy, hz }, { hx, 0, hz } };
        poly_of(col_poly, UP, 4, q1);
        poly_of(col_poly, UP, 4, q2);
        yface(col_poly, UP, sy, xa, hx, za, hz);
        xface(col_poly, NX, -hx, -hz, hz, 0, hm);
        zface(col_poly, NZ, -hz, -hx, hx, 0, hm);
        poly_of(col_poly, PX, 5, sideX);
        poly_of(col_poly, PZ, 5, sideZ);
    } else {
        f32 p0[3] = { -hx, hm, -hz }, pa0[3] = { xa, sy, -hz }, paa[3] = { xa, sy, za }, p0a[3] = { -hx, sy, za };
        f32 sideX[5][3] = { { -hx, 0, -hz }, { -hx, hm, -hz }, { -hx, sy, za }, { -hx, sy, hz }, { -hx, 0, hz } };
        f32 sideZ[5][3] = { { -hx, 0, -hz }, { -hx, hm, -hz }, { xa, sy, -hz }, { hx, sy, -hz }, { hx, 0, -hz } };
        tri(col_poly, UP, p0, pa0, paa);
        tri(col_poly, UP, p0, paa, p0a);
        yface(col_poly, UP, sy, xa, hx, -hz, hz);
        yface(col_poly, UP, sy, -hx, xa, za, hz);
        poly_of(col_poly, NX, 5, sideX);
        poly_of(col_poly, NZ, 5, sideZ);
        xface(col_poly, PX, hx, -hz, hz, 0, sy);
        zface(col_poly, PZ, hz, -hx, hx, 0, sy);
    }
}

// Texture repeats every 256 units; a closed loop gets a whole number of repeats (no seam).
static f32 whole_repeats(f32 len) {
    f32 r = roundf(len / 256.0f);
    return (r < 1 ? 1 : r) * 256.0f;
}

static void normalize3(f32 *n) {
    f32 len = sqrtf(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 0.0001f) {
        n[0] /= len;
        n[1] /= len;
        n[2] /= len;
    }
}

// Pillar: 24 sides with round shading; the texture wraps around it at its own scale (a whole
// number of repeats, so no seam), stands upright on the sides and lies flat on the caps.
#define PILLAR_SIDES 24
static void pillar_shape(f32 hx, f32 sy, f32 hz) {
    f32 len[PILLAR_SIDES + 1], px[PILLAR_SIDES + 1], pz[PILLAR_SIDES + 1], k;
    f32 c0[3] = { 0, sy, 0 }, c1[3] = { 0, 0, 0 };
    s32 i, j;
    len[0] = 0;
    for (i = 0; i <= PILLAR_SIDES; i++) {
        f32 a = i * 2 * M_PI / PILLAR_SIDES;
        px[i] = sinf(a) * hx;
        pz[i] = cosf(a) * hz;
        if (i > 0) {
            len[i] = len[i - 1] + sqrtf((px[i] - px[i - 1]) * (px[i] - px[i - 1]) + (pz[i] - pz[i - 1]) * (pz[i] - pz[i - 1]));
        }
    }
    k = whole_repeats(len[PILLAR_SIDES]) / len[PILLAR_SIDES];
    for (i = 0; i < PILLAR_SIDES; i++) {
        f32 a0[3] = { px[i], sy, pz[i] }, a1[3] = { px[i + 1], sy, pz[i + 1] };
        f32 b0[3] = { px[i], 0, pz[i] }, b1[3] = { px[i + 1], 0, pz[i + 1] };
        f32 out[3] = { (px[i] + px[i + 1]) / 2, 0, (pz[i] + pz[i + 1]) / 2 };
        struct Poly *p = gfx_poly(4), *t;
        quad(p, b0[0], 0, b0[2], b1[0], 0, b1[2], a1[0], sy, a1[2], a0[0], sy, a0[2]);
        hinted(p, out);
        p->hasUV = p->smooth = TRUE;
        for (j = 0; j < 4; j++) {
            s32 e = (j == 1 || j == 2) ? i + 1 : i;
            f32 a = e * 2 * M_PI / PILLAR_SIDES;
            p->uv[j][0] = len[e] * k;
            p->uv[j][1] = sy - p->v[j][1];
            setv(p->vn[j], sinf(a) / (hx > 1 ? hx : 1), 0, cosf(a) / (hz > 1 ? hz : 1));
            normalize3(p->vn[j]);
        }
        t = tri(gfx_poly, UP, c0, a0, a1);
        planar_uv(t, 0, 2, -hx, -hz, FALSE);
        t = tri(gfx_poly, DOWN, c1, b0, b1);
        planar_uv(t, 0, 2, -hx, -hz, FALSE);
        quad(hinted(col_poly(4), out), b0[0], 0, b0[2], b1[0], 0, b1[2], a1[0], sy, a1[2], a0[0], sy, a0[2]);
        tri(col_poly, UP, c0, a0, a1);
        tri(col_poly, DOWN, c1, b0, b1);
    }
}

// Sphere (an ellipsoid filling the block): 24 x 12, latitude/longitude texture coordinates with a
// whole number of repeats around, round shading; the collision is the same mesh.
#define SPHERE_LON 24
#define SPHERE_LAT 12
static void sphere_point(f32 hx, f32 ry, f32 hz, s32 lat, s32 lon, f32 *v, f32 *n) {
    f32 th = lat * M_PI / SPHERE_LAT, ph = lon * 2 * M_PI / SPHERE_LON;
    f32 s = sinf(th), c = cosf(th);
    if (lat == 0 || lat == SPHERE_LAT) s = 0;
    setv(v, s * sinf(ph) * hx, ry + c * ry, s * cosf(ph) * hz);
    setv(n, s * sinf(ph) / hx, c / ry, s * cosf(ph) / hz);
    normalize3(n);
}
static void sphere_shape(f32 hx, f32 sy, f32 hz, s32 twoMaterials) {
    f32 ry = sy / 2, a = (hx + hz) / 2;
    // around: the equator's length; down: half a meridian (Ramanujan's ellipse perimeter)
    f32 around = whole_repeats(M_PI * (3 * (hx + hz) - sqrtf((3 * hx + hz) * (hx + 3 * hz))));
    f32 down = M_PI * (3 * (a + ry) - sqrtf((3 * a + ry) * (a + 3 * ry))) / 2;
    f32 vTop = 0, vScale = 1;
    s32 i, j, pass, cap[SPHERE_LAT];
    // with a top material of its own (grass on dirt), the caps (rings facing mostly up or down)
    // take it flat like a box's top (no pinched pole) and the band between wraps around, its
    // texture starting where the top ends; one material wraps the whole sphere without a seam
    for (j = 0; j < SPHERE_LAT; j++) {
        f32 p0[3], p1[3], p2[3], n0[3], fy;
        sphere_point(hx, ry, hz, j, 0, p0, n0);
        sphere_point(hx, ry, hz, j + 1, 0, p1, n0);
        sphere_point(hx, ry, hz, j == 0 ? j + 1 : j, 1, p2, n0);
        {
            f32 ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            f32 bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            f32 n[3] = { ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx };
            normalize3(n);
            fy = fabsf(n[1]);
        }
        cap[j] = twoMaterials && fy > 0.5f;
        if (cap[j] && j < SPHERE_LAT / 2) {
            vTop = (j + 1) * down / SPHERE_LAT;
        }
    }
    // the band holds whole repeats (no sliver of the texture's top edge where the bottom begins)
    {
        s32 b0 = SPHERE_LAT, b1 = 0;
        for (j = 0; j < SPHERE_LAT; j++) {
            if (!cap[j]) {
                if (j < b0) b0 = j;
                if (j + 1 > b1) b1 = j + 1;
            }
        }
        if (b1 > b0) {
            f32 len = (b1 - b0) * down / SPHERE_LAT;
            vScale = whole_repeats(len) / len;
        }
    }
    for (pass = 0; pass < 2; pass++) {
        struct Poly *(*add)(s32) = pass == 0 ? gfx_poly : col_poly;
        for (j = 0; j < SPHERE_LAT; j++) {
            for (i = 0; i < SPHERE_LON; i++) {
                // corners (lat, lon); the poles take the middle of their triangle's longitudes
                s32 cl[4][2] = { { j, i }, { j, i + 1 }, { j + 1, i + 1 }, { j + 1, i } }, n = 4, k;
                struct Poly *p;
                f32 out[3] = { 0, 0, 0 };
                if (j == 0) {
                    cl[0][0] = 0; cl[1][0] = j + 1; cl[1][1] = i + 1; cl[2][0] = j + 1; cl[2][1] = i;
                    n = 3;
                } else if (j == SPHERE_LAT - 1) {
                    n = 3;
                    cl[2][0] = SPHERE_LAT; cl[2][1] = i;
                }
                p = add(n);
                for (k = 0; k < n; k++) {
                    sphere_point(hx, ry, hz, cl[k][0], cl[k][1], p->v[k], p->vn[k]);
                    if (cap[j]) {
                        p->uv[k][0] = p->v[k][0] + hx;
                        p->uv[k][1] = p->v[k][2] + hz;
                    } else {
                        p->uv[k][0] = (cl[k][0] == 0 || cl[k][0] == SPHERE_LAT ? i + 0.5f : cl[k][1]) * around / SPHERE_LON;
                        p->uv[k][1] = (cl[k][0] * down / SPHERE_LAT - vTop) * vScale;
                    }
                    out[0] += p->vn[k][0]; out[1] += p->vn[k][1]; out[2] += p->vn[k][2];
                }
                hinted(p, out);
                if (pass == 0) {
                    p->hasUV = p->smooth = TRUE;
                }
            }
        }
    }
}

// Terrain patch: an n x n heightmap on top of a slab (sculpted like the ground), skirted down to
// its bottom. Heights are offsets above the block's height sy; cells can be painted.
static s16 material_surface_of(s32 m) {
    switch (m) {
        case 20: return SURFACE_BURNING;
        case 19: return SURFACE_VERY_SLIPPERY;
        case 18: return SURFACE_NOISE_DEFAULT;
        default: return -1;
    }
}
static void terrain_shape(f32 hx, f32 sy, f32 hz, s32 n, s32 surface, s32 top) {
    f32 cx = hx * 2 / n, cz = hz * 2 / n;
    s32 i, j, k;
#define PH(i, j) (sPatchH[(j) * (n + 1) + (i)])
#define PTOP(i, j) (sy + PH(i, j) < 4.0f ? 4.0f : (sy + PH(i, j) > 30000.0f ? 30000.0f : sy + PH(i, j)))
#define PX_(i) (-hx + (i) * cx)
#define PZ_(j) (-hz + (j) * cz)
    for (j = 0; j < n; j++) {
        for (i = 0; i < n; i++) {
            s32 corner[4][2] = { { i, j }, { i + 1, j }, { i + 1, j + 1 }, { i, j + 1 } };
            s32 order[2][3], t;
            f32 pts[4][3], nrm[4][3];
            s32 mat = sPatchM[j * n + i] ? sPatchM[j * n + i] - 1 : -1;
            s16 surf = (mat >= 0 && surface == SURFACE_DEFAULT) ? material_surface_of(mat) : -1;
            for (k = 0; k < 4; k++) {
                s32 ci = corner[k][0], cj = corner[k][1];
                s32 i0 = ci > 0 ? ci - 1 : ci, i1 = ci < n ? ci + 1 : ci, j0 = cj > 0 ? cj - 1 : cj, j1 = cj < n ? cj + 1 : cj;
                setv(pts[k], PX_(ci), PTOP(ci, cj), PZ_(cj));
                setv(nrm[k], (PTOP(i0, cj) - PTOP(i1, cj)) / (cx * (i1 - i0)), 1.0f,
                     (PTOP(ci, j0) - PTOP(ci, j1)) / (cz * (j1 - j0)));
                normalize3(nrm[k]);
            }
            // steep cells take the texture standing on the slope (as the level terrain does: cliffs
            // show the material, not one texel stretched down them), the same for the whole cell
            f32 slopeX = ((pts[1][1] + pts[2][1]) - (pts[0][1] + pts[3][1])) * 0.5f / cx;
            f32 slopeZ = ((pts[2][1] + pts[3][1]) - (pts[0][1] + pts[1][1])) * 0.5f / cz;
            s32 wall = fabsf(slopeX) > 0.9f || fabsf(slopeZ) > 0.9f, wallAlongZ = fabsf(slopeX) >= fabsf(slopeZ);
            // split along the flatter diagonal (as the level terrain does)
            if (fabsf(pts[0][1] - pts[2][1]) <= fabsf(pts[1][1] - pts[3][1])) {
                order[0][0] = 0; order[0][1] = 3; order[0][2] = 2;
                order[1][0] = 0; order[1][1] = 2; order[1][2] = 1;
            } else {
                order[0][0] = 0; order[0][1] = 3; order[0][2] = 1;
                order[1][0] = 1; order[1][1] = 3; order[1][2] = 2;
            }
            for (t = 0; t < 2; t++) {
                struct Poly *p = tri(gfx_poly, UP, pts[order[t][0]], pts[order[t][1]], pts[order[t][2]]);
                struct Poly *c = tri(col_poly, UP, pts[order[t][0]], pts[order[t][1]], pts[order[t][2]]);
                s32 q;
                c->surf = surf;
                // the ground's material all over (steep cells too, like the level terrain); painted cells theirs
                p->mat = mat >= 0 ? mat : top;
                p->smooth = p->hasUV = TRUE;
                for (q = 0; q < 3; q++) {
                    memcpy(p->vn[q], nrm[order[t][q]], sizeof(p->vn[q]));
                    if (wall) {
                        p->uv[q][0] = wallAlongZ ? p->v[q][2] + hz : p->v[q][0] + hx;
                        p->uv[q][1] = -p->v[q][1];
                    } else {
                        p->uv[q][0] = p->v[q][0] + hx;
                        p->uv[q][1] = p->v[q][2] + hz;
                    }
                }
            }
        }
    }
    // the skirt: the side texture hangs from the top edge, as on a box
    for (k = 0; k < n; k++) {
        struct Poly *p;
        s32 e;
        f32 t0, t1;
        for (e = 0; e < 4; e++) {
            if (e == 0) { // -z
                t0 = PTOP(k, 0); t1 = PTOP(k + 1, 0);
                p = gfx_poly(4);
                quad(p, PX_(k), 0, -hz, PX_(k + 1), 0, -hz, PX_(k + 1), t1, -hz, PX_(k), t0, -hz);
                hinted(p, NZ);
                quad(hinted(col_poly(4), NZ), PX_(k), 0, -hz, PX_(k + 1), 0, -hz, PX_(k + 1), t1, -hz, PX_(k), t0, -hz);
            } else if (e == 1) { // +z
                t0 = PTOP(k, n); t1 = PTOP(k + 1, n);
                p = gfx_poly(4);
                quad(p, PX_(k), 0, hz, PX_(k + 1), 0, hz, PX_(k + 1), t1, hz, PX_(k), t0, hz);
                hinted(p, PZ);
                quad(hinted(col_poly(4), PZ), PX_(k), 0, hz, PX_(k + 1), 0, hz, PX_(k + 1), t1, hz, PX_(k), t0, hz);
            } else if (e == 2) { // -x
                t0 = PTOP(0, k); t1 = PTOP(0, k + 1);
                p = gfx_poly(4);
                quad(p, -hx, 0, PZ_(k), -hx, 0, PZ_(k + 1), -hx, t1, PZ_(k + 1), -hx, t0, PZ_(k));
                hinted(p, NX);
                quad(hinted(col_poly(4), NX), -hx, 0, PZ_(k), -hx, 0, PZ_(k + 1), -hx, t1, PZ_(k + 1), -hx, t0, PZ_(k));
            } else { // +x
                t0 = PTOP(n, k); t1 = PTOP(n, k + 1);
                p = gfx_poly(4);
                quad(p, hx, 0, PZ_(k), hx, 0, PZ_(k + 1), hx, t1, PZ_(k + 1), hx, t0, PZ_(k));
                hinted(p, PX);
                quad(hinted(col_poly(4), PX), hx, 0, PZ_(k), hx, 0, PZ_(k + 1), hx, t1, PZ_(k + 1), hx, t0, PZ_(k));
            }
            p->hasUV = TRUE;
            {
                s32 along = (e < 2) ? 0 : 2;
                f32 off = (e < 2) ? hx : hz;
                p->uv[0][0] = p->v[0][along] + off; p->uv[0][1] = t0;
                p->uv[1][0] = p->v[1][along] + off; p->uv[1][1] = t1;
                p->uv[2][0] = p->v[2][along] + off; p->uv[2][1] = 0;
                p->uv[3][0] = p->v[3][along] + off; p->uv[3][1] = 0;
            }
        }
    }
    yface(gfx_poly, DOWN, 0, -hx, hx, -hz, hz);
    yface(col_poly, DOWN, 0, -hx, hx, -hz, hz);
#undef PH
#undef PTOP
#undef PX_
#undef PZ_
}

static void build_shape(struct MeshKey *key) {
    f32 sx = key->sx, sy = key->sy, sz = key->sz;
    s32 steps = key->steps;
    f32 hx = sx / 2, hz = sz / 2;
    s32 i;

    sGfxPolyCount = 0;
    sColPolyCount = 0;
    setv(sHull, 0, sy / 2, 0);
    if (key->shape == SHAPE_BOX) {
        box_polys(gfx_poly, -hx, 0, -hz, hx, sy, hz, FALSE);
        box_polys(col_poly, -hx, 0, -hz, hx, sy, hz, FALSE);
    } else if (key->shape == SHAPE_RAMP) {
        // rises toward +z
        f32 pz[3] = { -hz, hz, hz }, py[3] = { 0, sy, 0 };
        prism_polys(gfx_poly, hx, pz, py, 3);
        prism_polys(col_poly, hx, pz, py, 3);
        setv(sHull, 0, sy / 3, hz / 3);
    } else if (key->shape == SHAPE_RAMP_INNER || key->shape == SHAPE_RAMP_OUTER) {
        ramp_corner(gfx_poly, hx, sy, hz, key->shape == SHAPE_RAMP_INNER);
        ramp_corner(col_poly, hx, sy, hz, key->shape == SHAPE_RAMP_INNER);
    } else if (key->shape == SHAPE_STAIRS_INNER || key->shape == SHAPE_STAIRS_OUTER) {
        stairs_corner(hx, sy, hz, steps < 1 ? 1 : (steps > 24 ? 24 : steps), key->shape == SHAPE_STAIRS_INNER);
    } else if (key->shape == SHAPE_STAIRS) {
        f32 d, h;
        if (steps < 1) steps = 1;
        if (steps > 24) steps = 24;
        d = sz / steps;
        h = sy / steps;
        for (i = 0; i < steps; i++) {
            f32 z0 = -hz + i * d, z1 = z0 + d, top = (i + 1) * h;
            yface(gfx_poly, UP, top, -hx, hx, z0, z1);        // tread
            zface(gfx_poly, NZ, z0, -hx, hx, i * h, top);     // riser
            xface(gfx_poly, PX, hx, z0, z1, 0, top);          // right
            xface(gfx_poly, NX, -hx, z0, z1, 0, top);         // left
        }
        zface(gfx_poly, PZ, hz, -hx, hx, 0, sy); // back
        // Collision: a ramp through the middle of every tread, so Mario walks up
        // steps of up to ~45 units; taller steps need a jump.
        {
            f32 pz[5] = { -hz, -hz, hz - d / 2, hz, hz };
            f32 py[5] = { 0, h / 2, sy, sy, 0 };
            prism_polys(col_poly, hx, pz, py, 5);
            setv(sHull, 0, sy / 3, hz / 4);
        }
    } else if (key->shape == SHAPE_SPHERE) {
        sphere_shape(hx, sy, hz, studio_material_texels(key->top, 0) != studio_material_texels(key->side, 1));
    } else if (key->shape == SHAPE_TERRAIN) {
        terrain_shape(hx, sy, hz, steps, key->surface, key->top);
    } else {
        pillar_shape(hx, sy, hz);
    }
}

static void poly_normal(struct Poly *p, f32 *n) {
    f32 ax = p->v[1][0] - p->v[0][0], ay = p->v[1][1] - p->v[0][1], az = p->v[1][2] - p->v[0][2];
    f32 bx = p->v[2][0] - p->v[1][0], by = p->v[2][1] - p->v[1][1], bz = p->v[2][2] - p->v[1][2];
    n[0] = ay * bz - az * by;
    n[1] = az * bx - ax * bz;
    n[2] = ax * by - ay * bx;
    normalize3(n);
}

// Make the polygon face its outside: its hint, or away from the shape's inside point.
static void orient_outward(struct Poly *p) {
    f32 n[3], c[3] = { 0, 0, 0 }, d;
    s32 i;
    poly_normal(p, n);
    if (p->hasHint) {
        d = n[0] * p->hint[0] + n[1] * p->hint[1] + n[2] * p->hint[2];
    } else {
        for (i = 0; i < p->n; i++) {
            c[0] += p->v[i][0] / p->n;
            c[1] += p->v[i][1] / p->n;
            c[2] += p->v[i][2] / p->n;
        }
        d = (c[0] - sHull[0]) * n[0] + (c[1] - sHull[1]) * n[1] + (c[2] - sHull[2]) * n[2];
    }
    if (d < 0) {
        for (i = 0; i < p->n / 2; i++) {
            s32 o = p->n - 1 - i;
            f32 t[3], u[2];
            memcpy(t, p->v[i], sizeof(t)); memcpy(p->v[i], p->v[o], sizeof(t)); memcpy(p->v[o], t, sizeof(t));
            memcpy(t, p->vn[i], sizeof(t)); memcpy(p->vn[i], p->vn[o], sizeof(t)); memcpy(p->vn[o], t, sizeof(t));
            memcpy(u, p->uv[i], sizeof(u)); memcpy(p->uv[i], p->uv[o], sizeof(u)); memcpy(p->uv[o], u, sizeof(u));
        }
    }
}

static s16 clamp_tc(f32 v) {
    if (v > 32000.0f) return 32000;
    if (v < -32000.0f) return -32000;
    return (s16) v;
}

// 32px texture over 256 world units: 8 units per texel, tc is s10.5 fixed point.
#define TC_PER_UNIT 4.0f

static u8 sAlpha = 255;

// A block face's colour: the material's fixed shading by facing (top bright, bottom dark),
// times how the area's sun (settings.env.light) lights it compared with the default sun.
void studio_light_ratio(f32 nx, f32 ny, f32 nz, f32 out[3]);
static void shade_color(const f32 *n, f32 shade, u8 r, u8 gr, u8 b, u8 *out) {
    f32 k[3], c;
    s32 i;
    studio_light_ratio(n[0], n[1], n[2], k);
    for (i = 0; i < 3; i++) {
        c = (i == 0 ? r : i == 1 ? gr : b) * shade * k[i];
        out[i] = c > 255.0f ? 255 : c < 0.0f ? 0 : (u8) c;
    }
}
static void block_shade(const f32 *n, u8 r, u8 gr, u8 b, u8 *out) {
    f32 shade;
    if (n[1] > 0.7f) shade = 1.0f;
    else if (n[1] < -0.7f) shade = 0.45f;
    else if (n[1] > 0.2f) shade = 0.9f;
    else shade = fabsf(n[0]) > fabsf(n[2]) ? 0.78f : 0.64f;
    shade_color(n, shade, r, gr, b, out);
}
// The same shading, continuous over the normal (curved shapes: no bands between facets).
static void block_shade_smooth(const f32 *n, u8 r, u8 gr, u8 b, u8 *out) {
    f32 h = n[0] * n[0] + n[2] * n[2];
    f32 side = h > 1e-6f ? 0.64f + 0.14f * n[0] * n[0] / h : 0.71f;
    f32 shade = n[1] >= 0 ? side + (1.0f - side) * n[1] : side + (0.45f - side) * -n[1];
    shade_color(n, shade, r, gr, b, out);
}

// The polygon's material group: 0 = the block's top (faces up), 1 = its sides, 2 + m = painted m.
static s32 poly_group(struct Poly *p) {
    f32 n[3];
    if (p->mat >= 0) {
        return 2 + p->mat;
    }
    poly_normal(p, n);
    return n[1] > 0.5f ? 0 : 1;
}

static Gfx *emit_group(Gfx *g, struct StudioMesh *m, s32 *vi, s32 group, const u8 *tex, u8 r, u8 gr, u8 b) {
    s32 i, j, chunkStart = 0, chunkVerts = 0;
    static s32 picked[MAX_POLYS];
    s32 count = 0;
    Vtx *vtx = m->vtx;

    for (i = 0; i < sGfxPolyCount; i++) {
        if (poly_group(&sGfxPolys[i]) == group) {
            picked[count++] = i;
        }
    }
    if (count == 0 || tex == NULL) {
        return g;
    }
    gDPLoadTextureBlock(g++, tex, G_IM_FMT_RGBA, G_IM_SIZ_16b, 32, 32, 0, G_TX_WRAP | G_TX_NOMIRROR,
                        G_TX_WRAP | G_TX_NOMIRROR, 5, 5, G_TX_NOLOD, G_TX_NOLOD);
    for (i = 0; i <= count; i++) {
        struct Poly *p = i < count ? &sGfxPolys[picked[i]] : NULL;
        // flush the chunk when the next polygon would not fit in 16 vertices
        if (chunkVerts > 0 && (p == NULL || chunkVerts + p->n > 16)) {
            s32 k, base = 0;
            gSPVertex(g++, &vtx[chunkStart], chunkVerts, 0);
            for (k = chunkStart; k < chunkStart + chunkVerts;) {
                s32 pn = vtx[k].v.flag;
                for (j = 1; j + 1 < pn; j++) {
                    gSP1Triangle(g++, base, base + j, base + j + 1, 0);
                }
                base += pn;
                k += pn;
            }
            chunkVerts = 0;
        }
        if (p == NULL) {
            break;
        }
        if (chunkVerts == 0) {
            chunkStart = *vi;
        }
        {
            f32 n[3], minU = 1e9f, minV = 1e9f, maxV = -1e9f, shiftU = 0, shiftV = 0;
            s32 ua, va, flipV;
            u8 col[3];
            poly_normal(p, n);
            // planar mapping on the dominant axis; side faces keep "up" up
            if (fabsf(n[1]) >= fabsf(n[0]) && fabsf(n[1]) >= fabsf(n[2])) {
                ua = 0; va = 2; flipV = FALSE;
            } else if (fabsf(n[0]) > fabsf(n[2])) {
                ua = 2; va = 1; flipV = TRUE;
            } else {
                ua = 0; va = 1; flipV = TRUE;
            }
            if (p->hasUV) {
                // given coordinates: shifted by whole repeats only, so neighbours stay in phase
                for (j = 0; j < p->n; j++) {
                    if (p->uv[j][0] < minU) minU = p->uv[j][0];
                    if (p->uv[j][1] < minV) minV = p->uv[j][1];
                }
                shiftU = floorf(minU / 256.0f) * 256.0f;
                shiftV = floorf(minV / 256.0f) * 256.0f;
            } else {
                for (j = 0; j < p->n; j++) {
                    if (p->v[j][ua] < minU) minU = p->v[j][ua];
                    if (p->v[j][va] < minV) minV = p->v[j][va];
                    if (p->v[j][va] > maxV) maxV = p->v[j][va];
                }
            }
            block_shade(n, r, gr, b, col);
            for (j = 0; j < p->n; j++) {
                Vtx *v = &vtx[*vi + j];
                s8 *vn = m->vn[*vi + j];
                v->v.ob[0] = (s16) p->v[j][0];
                v->v.ob[1] = (s16) p->v[j][1];
                v->v.ob[2] = (s16) p->v[j][2];
                v->v.flag = p->n; // polygon size, read back when the chunk is flushed
                if (p->hasUV) {
                    v->v.tc[0] = clamp_tc((p->uv[j][0] - shiftU) * TC_PER_UNIT);
                    v->v.tc[1] = clamp_tc((p->uv[j][1] - shiftV) * TC_PER_UNIT);
                } else {
                    f32 vv = flipV ? (maxV - p->v[j][va]) : (p->v[j][va] - minV);
                    v->v.tc[0] = clamp_tc((p->v[j][ua] - minU) * TC_PER_UNIT);
                    v->v.tc[1] = clamp_tc(vv * TC_PER_UNIT);
                }
                if (p->smooth) {
                    block_shade_smooth(p->vn[j], r, gr, b, col);
                }
                v->v.cn[0] = col[0];
                v->v.cn[1] = col[1];
                v->v.cn[2] = col[2];
                v->v.cn[3] = sAlpha;
                {
                    const f32 *src = p->smooth ? p->vn[j] : n;
                    vn[0] = (s8) (src[0] * 127);
                    vn[1] = (s8) (src[1] * 127);
                    vn[2] = (s8) (src[2] * 127);
                    vn[3] = p->smooth;
                }
            }
            *vi += p->n;
            chunkVerts += p->n;
        }
    }
    return g;
}

static struct StudioMesh *sMeshes[1024];
static s32 sMeshCount;

// Collision surface type of a collision polygon.
static s16 col_type(struct MeshKey *key, struct Poly *p) {
    if (p->surf >= 0) {
        return p->surf;
    }
    // plain stairs never slide: their collision is a ramp, and on the default surface
    // the game slides Mario down anything steeper than 38 degrees
    return IS_STAIRS(key->shape) && key->surface == SURFACE_DEFAULT ? SURFACE_NOT_SLIPPERY : key->surface;
}

#define MAX_COL_VERTS 4096
static s16 sColVerts[MAX_COL_VERTS][3];
static s32 sColVertCount;
static s16 sColHash[8192]; // index + 1 into sColVerts
static s16 sColIdx[MAX_POLYS][MAX_POLY_VERTS];

static s16 col_vertex(const f32 *v) {
    s16 x = (s16) v[0], y = (s16) v[1], z = (s16) v[2];
    u32 h = ((u32) (u16) x * 73856093u) ^ ((u32) (u16) y * 19349663u) ^ ((u32) (u16) z * 83492791u);
    s32 k, slot;
    for (k = 0; k < 8192; k++) {
        slot = (h + k) & 8191;
        if (sColHash[slot] == 0) {
            break;
        }
        {
            s16 *w = sColVerts[sColHash[slot] - 1];
            if (w[0] == x && w[1] == y && w[2] == z) {
                return sColHash[slot] - 1;
            }
        }
    }
    if (k == 8192 || sColVertCount >= MAX_COL_VERTS) {
        return 0; // (cannot happen within the shapes' sizes)
    }
    sColVerts[sColVertCount][0] = x;
    sColVerts[sColVertCount][1] = y;
    sColVerts[sColVertCount][2] = z;
    sColHash[slot] = (s16) (++sColVertCount);
    return sColVertCount - 1;
}

static struct StudioMesh *make_mesh(struct MeshKey *key) {
    s32 i, j, nv = 0, colTris = 0, vi = 0, groups = 0;
    struct StudioMesh *m;
    Gfx *g;
    s16 *c;
    u8 r = (key->color >> 16) & 0xFF, gr = (key->color >> 8) & 0xFF, b = key->color & 0xFF;
    u8 painted[64];

    build_shape(key);
    memset(painted, 0, sizeof(painted));
    for (i = 0; i < sColPolyCount; i++) {
        orient_outward(&sColPolys[i]);
        colTris += sColPolys[i].n - 2;
    }
    for (i = 0; i < sGfxPolyCount; i++) {
        orient_outward(&sGfxPolys[i]);
        nv += sGfxPolys[i].n;
        if (sGfxPolys[i].mat >= 0 && sGfxPolys[i].mat < 64 && !painted[sGfxPolys[i].mat]) {
            painted[sGfxPolys[i].mat] = 1;
            groups++;
        }
    }

    m = calloc(1, sizeof(*m));
    m->key = *key;
    m->nv = nv;
    m->vtx = calloc(nv + 16, sizeof(Vtx));
    m->vn = calloc(nv + 16, sizeof(*m->vn));
    m->dl = calloc(nv * 2 + sGfxPolyCount + (groups + 2) * 12 + 64, sizeof(Gfx));

    g = m->dl;
    sAlpha = key->translucent ? 150 : 255;
    gDPPipeSync(g++);
    if (key->translucent) {
        gDPSetCombineMode(g++, G_CC_MODULATERGBA, G_CC_MODULATERGBA);
    } else {
        gDPSetCombineMode(g++, G_CC_MODULATERGB, G_CC_MODULATERGB);
    }
    gSPClearGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
    g = emit_group(g, m, &vi, 0, studio_material_texels(key->top, 0), r, gr, b);
    g = emit_group(g, m, &vi, 1, studio_material_texels(key->side, 1), r, gr, b);
    for (i = 0; i < 64; i++) {
        if (painted[i]) {
            const u8 *tex = studio_material_texels(i, 0);
            g = emit_group(g, m, &vi, 2 + i, tex != NULL ? tex : studio_material_texels(key->top, 0), r, gr, b);
        }
    }
    m->nv = vi;
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPEndDisplayList(g++);

    // collision: [COL_INIT, verts, (type, tris)..., CONTINUE, END]; floors list their highest vertex
    // first. Vertices are shared between polygons (the game moves every one of them each frame, and
    // holds at most 4096 per object: surface_load.c).
    sColVertCount = 0;
    memset(sColHash, 0, sizeof(sColHash));
    for (i = 0; i < sColPolyCount; i++) {
        for (j = 0; j < sColPolys[i].n; j++) {
            sColIdx[i][j] = col_vertex(sColPolys[i].v[j]);
        }
    }
    m->col = calloc(4 + sColVertCount * 3 + 16 * 2 + colTris * 3 + 4, sizeof(s16));
    c = m->col;
    *c++ = TERRAIN_LOAD_VERTICES;
    *c++ = sColVertCount;
    for (i = 0; i < sColVertCount; i++) {
        *c++ = sColVerts[i][0];
        *c++ = sColVerts[i][1];
        *c++ = sColVerts[i][2];
    }
    // one group of triangles per surface type
    {
        s16 done[16];
        s32 ndone = 0;
        for (;;) {
            s16 type = -1;
            s32 count = 0, k;
            s16 *countAt;
            for (i = 0; i < sColPolyCount && type < 0; i++) {
                s16 t = col_type(key, &sColPolys[i]);
                for (k = 0; k < ndone && done[k] != t; k++) {
                }
                if (k == ndone) {
                    type = t;
                }
            }
            if (type < 0 || ndone >= 16) {
                break;
            }
            done[ndone++] = type;
            *c++ = type;
            countAt = c++;
            for (i = 0; i < sColPolyCount; i++) {
                struct Poly *p = &sColPolys[i];
                if (col_type(key, p) != type) {
                    continue;
                }
                for (j = 1; j + 1 < p->n; j++) {
                    s32 t[3] = { 0, j, j + 1 }, hi = 0;
                    s16 a, b2, d;
                    // rotate (keeping winding) so the highest vertex comes first
                    for (k = 1; k < 3; k++) {
                        if (p->v[t[k]][1] > p->v[t[hi]][1]) hi = k;
                    }
                    a = sColIdx[i][t[hi]];
                    b2 = sColIdx[i][t[(hi + 1) % 3]];
                    d = sColIdx[i][t[(hi + 2) % 3]];
                    if (a == b2 || b2 == d || a == d) {
                        continue; // collapsed to a line by the whole-unit coordinates
                    }
                    *c++ = a;
                    *c++ = b2;
                    *c++ = d;
                    count++;
                }
            }
            *countAt = count;
        }
    }
    *c++ = TERRAIN_LOAD_CONTINUE;
    *c++ = TERRAIN_LOAD_END;

    // wrapped in a culling radius: big blocks must not vanish when their center leaves the view
    {
        f32 tall = key->sy;
        f32 radius;
        struct GraphNodeCullingRadius *cr;
        struct GraphNodeDisplayList *dn;
        if (key->shape == SHAPE_TERRAIN) {
            for (i = 0; i < sGfxPolyCount; i++) {
                for (j = 0; j < sGfxPolys[i].n; j++) {
                    if (sGfxPolys[i].v[j][1] > tall) tall = sGfxPolys[i].v[j][1];
                }
            }
        }
        radius = sqrtf((f32) key->sx * key->sx + tall * tall * 4 + (f32) key->sz * key->sz) / 2 + 50;
        cr = init_graph_node_culling_radius(NULL, malloc(sizeof(struct GraphNodeCullingRadius)),
                                            radius > 30000 ? 30000 : (s16) radius);
        dn = init_graph_node_display_list(NULL, malloc(sizeof(struct GraphNodeDisplayList)),
                                          key->translucent ? LAYER_TRANSPARENT : LAYER_OPAQUE, m->dl);
        geo_add_child(&cr->node, &dn->node);
        m->node = &cr->node;
    }
    return m;
}

static struct StudioMesh *get_mesh(struct MeshKey *key) {
    s32 i;
    struct StudioMesh *m;
    for (i = 0; i < sMeshCount; i++) {
        if (memcmp(&sMeshes[i]->key, key, sizeof(*key)) == 0) {
            return sMeshes[i];
        }
    }
    m = make_mesh(key);
    if (sMeshCount < 1024) {
        sMeshes[sMeshCount++] = m;
    }
    return m;
}

// Terrain patches change with every brush dab: each placed patch (by uid) owns its mesh, and the
// one it replaces is freed a few frames later, once nothing draws or collides with it any more.
#define OWNED_MAX 256
#define GRAVE_MAX 512
static struct { s32 uid; struct StudioMesh *m; } sOwned[OWNED_MAX];
static struct { struct StudioMesh *m; s32 frame; } sGrave[GRAVE_MAX];
static s32 sGraveCount;
static s32 studio_frame_count(void);

static s32 mesh_in_use(struct StudioMesh *m) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if ((obj->activeFlags & ACTIVE_FLAG_ACTIVE)
            && (obj->header.gfx.sharedChild == m->node || obj->collisionData == m->col)) {
            return TRUE;
        }
    }
    return FALSE;
}

static void mesh_free(struct StudioMesh *m) {
    struct GraphNodeCullingRadius *cr = (struct GraphNodeCullingRadius *) m->node;
    free(cr->node.children);
    free(cr);
    free(m->vtx);
    free(m->vn);
    free(m->dl);
    free(m->col);
    free(m);
}

static void grave_sweep(void) {
    s32 i, now = studio_frame_count();
    for (i = 0; i < sGraveCount;) {
        if (now - sGrave[i].frame >= 4 && !mesh_in_use(sGrave[i].m)) {
            mesh_free(sGrave[i].m);
            sGrave[i] = sGrave[--sGraveCount];
        } else {
            i++;
        }
    }
}

static struct StudioMesh *owned_mesh(struct MeshKey *key, s32 uid) {
    s32 i, slot = -1;
    struct StudioMesh *m;
    grave_sweep();
    for (i = 0; i < OWNED_MAX; i++) {
        if (sOwned[i].m != NULL && sOwned[i].uid == uid) {
            if (memcmp(&sOwned[i].m->key, key, sizeof(*key)) == 0 && !mesh_in_use(sOwned[i].m)) {
                return sOwned[i].m; // the same patch again (an area reload)
            }
            if (sGraveCount < GRAVE_MAX) {
                sGrave[sGraveCount].m = sOwned[i].m;
                sGrave[sGraveCount++].frame = studio_frame_count();
            } // (else leaked: better than freeing something in use)
            sOwned[i].m = NULL;
            slot = i;
            break;
        }
    }
    for (i = 0; i < OWNED_MAX && slot < 0; i++) {
        if (sOwned[i].m == NULL) {
            slot = i;
        }
    }
    m = make_mesh(key);
    if (slot < 0) {
        // full: retire the oldest entry's mesh the same way
        slot = 0;
        if (sGraveCount < GRAVE_MAX) {
            sGrave[sGraveCount].m = sOwned[0].m;
            sGrave[sGraveCount++].frame = studio_frame_count();
        }
    }
    sOwned[slot].uid = uid;
    sOwned[slot].m = m;
    return m;
}

static void relight_mesh(struct StudioMesh *m) {
    u8 r = (m->key.color >> 16) & 0xFF, gr = (m->key.color >> 8) & 0xFF, b = m->key.color & 0xFF;
    s32 k;
    for (k = 0; k < m->nv; k++) {
        f32 n[3] = { m->vn[k][0] / 127.0f, m->vn[k][1] / 127.0f, m->vn[k][2] / 127.0f };
        u8 col[3];
        if (m->vn[k][3]) {
            block_shade_smooth(n, r, gr, b, col);
        } else {
            block_shade(n, r, gr, b, col);
        }
        m->vtx[k].v.cn[0] = col[0];
        m->vtx[k].v.cn[1] = col[1];
        m->vtx[k].v.cn[2] = col[2];
    }
}

// The area's light changed: every block mesh made so far is shaded again.
void studio_blocks_relight(void) {
    s32 i;
    for (i = 0; i < sMeshCount; i++) {
        relight_mesh(sMeshes[i]);
    }
    for (i = 0; i < OWNED_MAX; i++) {
        if (sOwned[i].m != NULL) {
            relight_mesh(sOwned[i].m);
        }
    }
}

// The heights (s16 offsets above the block's top, (n+1)^2) and painted materials (material + 1
// per cell, 0 = unpainted; may be NULL) of the terrain patch the next studio_spawn_block makes.
EMSCRIPTEN_KEEPALIVE
void studio_block_patch(const s16 *heights, const u8 *mats, s32 n) {
    if (n < 1 || n > PATCH_MAX) {
        sPatchN = 0;
        return;
    }
    sPatchN = n;
    memcpy(sPatchH, heights, sizeof(s16) * (n + 1) * (n + 1));
    if (mats != NULL) {
        memcpy(sPatchM, mats, n * n);
    } else {
        memset(sPatchM, 0, n * n);
    }
}

static u32 patch_hash(s32 n) {
    u32 h = 2166136261u;
    s32 i;
    const u8 *p = (const u8 *) sPatchH;
    for (i = 0; i < (s32) sizeof(s16) * (n + 1) * (n + 1); i++) h = (h ^ p[i]) * 16777619u;
    for (i = 0; i < n * n; i++) h = (h ^ sPatchM[i]) * 16777619u;
    return h;
}

s32 studio_motion_update(struct Object *obj);
void studio_motion_paused(void);

void bhv_studio_block_loop(void) {
    // moving blocks (motion.c) have no collision while they are gone
    if (studio_motion_update(o) && o->collisionData != NULL) {
        load_object_collision_model();
    }
}

struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams);

// flags: 1 = invisible (collision only), 2 = no collision (decoration), 4 = translucent (water, glass)
EMSCRIPTEN_KEEPALIVE
s32 studio_spawn_block(s32 shape, f32 sx, f32 sy, f32 sz, s32 steps, s32 top, s32 side, s32 surface,
                       s32 flags, s32 color, f32 x, f32 y, f32 z, s32 yaw, s32 pitch, s32 roll, s32 uid) {
    struct MeshKey key;
    struct StudioMesh *m;
    struct Object *obj;
    f32 big;

    memset(&key, 0, sizeof(key));
    key.shape = (shape >= 0 && shape < SHAPE_COUNT) ? shape : SHAPE_BOX;
    key.sx = (s32) CLAMP_SIZE(sx);
    key.sy = (s32) CLAMP_SIZE(sy);
    key.sz = (s32) CLAMP_SIZE(sz);
    key.steps = IS_STAIRS(key.shape) ? (steps > 0 ? steps : 8) : 0;
    key.top = material_ok(top) ? top : 0;
    key.side = material_ok(side) ? side : key.top;
    key.surface = surface;
    key.color = color & 0xFFFFFF;
    key.translucent = (flags & 4) != 0;
    if (key.shape == SHAPE_TERRAIN) {
        // the heights studio_block_patch gave (flat without them); steps is the grid size
        s32 i, n = sPatchN > 0 ? sPatchN : (steps >= 2 && steps <= PATCH_MAX ? steps : PATCH_DEFAULT), hi = 0;
        if (sPatchN <= 0) {
            memset(sPatchH, 0, sizeof(sPatchH));
            memset(sPatchM, 0, sizeof(sPatchM));
        }
        for (i = 0; i < (n + 1) * (n + 1); i++) {
            if (sPatchH[i] > hi) hi = sPatchH[i];
        }
        key.steps = n;
        key.data = patch_hash(n);
        m = owned_mesh(&key, uid);
        sPatchN = 0;
        sy = key.sy + hi; // (its collision reaches the top of its hills)
    } else {
        sPatchN = 0;
        m = get_mesh(&key);
        sy = key.sy;
    }

    obj = studio_spawn_raw(bhvStudioBlock, (flags & 1) ? NULL : m->node, x, y, z, pitch, yaw, roll, 0);
    if (obj == NULL) {
        return -1;
    }
    obj->collisionData = (flags & 2) ? NULL : m->col;
    big = key.sx > sy ? key.sx : sy;
    big = big > key.sz ? big : key.sz;
    obj->oCollisionDistance = big + 1500.0f;
    obj->oDrawingDistance = 30000.0f;
    obj->unused2 = (u32) uid;
    return obj - gObjectPool;
}

// ---------------------------------------------------------------------------
// Picking: nearest hit of a ray against level and object collision, and against
// objects without collision (as spheres).

extern struct Surface *sSurfacePool;
extern s32 gSurfacesAllocated;

static char sRayJson[512];

EMSCRIPTEN_KEEPALIVE
const char *studio_raycast_json(f32 ox, f32 oy, f32 oz, f32 dx, f32 dy, f32 dz, f32 maxDist, s32 ignoreSlot,
                                s32 objects) {
    s32 i;
    f32 best = maxDist;
    struct Surface *hitSurf = NULL;
    struct Object *hitObj = NULL;
    struct Object *ignore = (ignoreSlot >= 0 && ignoreSlot < OBJECT_POOL_CAPACITY) ? &gObjectPool[ignoreSlot] : NULL;
    f32 len = sqrtf(dx * dx + dy * dy + dz * dz);

    if (len < 0.0001f) {
        return "null";
    }
    dx /= len;
    dy /= len;
    dz /= len;

    for (i = 0; i < gSurfacesAllocated; i++) {
        struct Surface *s = &sSurfacePool[i];
        f32 e1x, e1y, e1z, e2x, e2y, e2z, px, py, pz, det, inv, tx, ty, tz, u, v, qx, qy, qz, t;
        if (ignore != NULL && s->object == ignore) {
            continue;
        }
        e1x = s->vertex2[0] - s->vertex1[0]; e1y = s->vertex2[1] - s->vertex1[1]; e1z = s->vertex2[2] - s->vertex1[2];
        e2x = s->vertex3[0] - s->vertex1[0]; e2y = s->vertex3[1] - s->vertex1[1]; e2z = s->vertex3[2] - s->vertex1[2];
        px = dy * e2z - dz * e2y; py = dz * e2x - dx * e2z; pz = dx * e2y - dy * e2x;
        det = e1x * px + e1y * py + e1z * pz;
        if (fabsf(det) < 1e-6f) continue;
        inv = 1.0f / det;
        tx = ox - s->vertex1[0]; ty = oy - s->vertex1[1]; tz = oz - s->vertex1[2];
        u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0.0f || u > 1.0f) continue;
        qx = ty * e1z - tz * e1y; qy = tz * e1x - tx * e1z; qz = tx * e1y - ty * e1x;
        v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0.0f || u + v > 1.0f) continue;
        t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1.0f && t < best) {
            best = t;
            hitSurf = s;
        }
    }

    if (objects) {
        for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
            struct Object *obj = &gObjectPool[i];
            f32 r, cy, lx, ly, lz, tc, d2, sc, t;
            if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE) || obj == gMarioObject || obj == ignore
                || obj->collisionData != NULL || obj->behavior == NULL
                || (obj->header.gfx.node.flags & GRAPH_RENDER_INVISIBLE) || obj->header.gfx.sharedChild == NULL) {
                continue;
            }
            sc = obj->header.gfx.scale[0] > obj->header.gfx.scale[1] ? obj->header.gfx.scale[0] : obj->header.gfx.scale[1];
            r = obj->hitboxRadius > obj->hurtboxRadius ? obj->hitboxRadius : obj->hurtboxRadius;
            if (r < 60.0f) r = 60.0f;
            if (r > 500.0f) r = 500.0f;
            r *= sc > 0.2f ? sc : 1.0f;
            cy = obj->oPosY + (obj->hitboxHeight > 0 ? obj->hitboxHeight / 2 - obj->hitboxDownOffset : r * 0.8f);
            lx = obj->oPosX - ox; ly = cy - oy; lz = obj->oPosZ - oz;
            tc = lx * dx + ly * dy + lz * dz;
            if (tc < 0) continue;
            d2 = lx * lx + ly * ly + lz * lz - tc * tc;
            if (d2 > r * r) continue;
            t = tc - sqrtf(r * r - d2);
            if (t < 0) t = tc;
            if (t < best) {
                best = t;
                hitObj = obj;
                hitSurf = NULL;
            }
        }
    }

    if (hitSurf == NULL && hitObj == NULL) {
        return "null";
    }
    if (hitObj != NULL) {
        snprintf(sRayJson, sizeof(sRayJson),
                 "{\"t\":%.1f,\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"nx\":0,\"ny\":1,\"nz\":0,\"slot\":%d,\"kind\":\"object\"}",
                 best, ox + dx * best, oy + dy * best, oz + dz * best, (s32) (hitObj - gObjectPool));
    } else {
        s32 slot = hitSurf->object != NULL ? (s32) (hitSurf->object - gObjectPool) : -1;
        snprintf(sRayJson, sizeof(sRayJson),
                 "{\"t\":%.1f,\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"nx\":%.3f,\"ny\":%.3f,\"nz\":%.3f,\"type\":%d,"
                 "\"slot\":%d,\"kind\":\"%s\"}",
                 best, ox + dx * best, oy + dy * best, oz + dz * best, hitSurf->normal.x, hitSurf->normal.y,
                 hitSurf->normal.z, hitSurf->type, slot, slot >= 0 ? "object" : "level");
    }
    return sRayJson;
}

// ---------------------------------------------------------------------------
// Editor camera and the camera the page needs to draw overlays.

s32 gStudioCamEnabled;
f32 gStudioCamPos[3], gStudioCamFocus[3], gStudioCamFov;
s32 gStudioPaused;
s32 gStudioHideHud;

struct StudioCamOut {
    f32 view[16];
    f32 pos[3];
    f32 focus[3];
    f32 fov, nearZ, farZ;
    s32 frame;
};
static struct StudioCamOut sCamOut;
static s32 studio_frame_count(void) {
    return sCamOut.frame;
}

EMSCRIPTEN_KEEPALIVE
void studio_set_camera(s32 enabled, f32 px, f32 py, f32 pz, f32 fx, f32 fy, f32 fz, f32 fov) {
    gStudioCamEnabled = enabled;
    gStudioCamPos[0] = px; gStudioCamPos[1] = py; gStudioCamPos[2] = pz;
    gStudioCamFocus[0] = fx; gStudioCamFocus[1] = fy; gStudioCamFocus[2] = fz;
    gStudioCamFov = fov;
}

EMSCRIPTEN_KEEPALIVE
void *studio_camera_out(void) {
    return &sCamOut;
}

EMSCRIPTEN_KEEPALIVE
void studio_set_paused(s32 paused, s32 hideHud) {
    gStudioPaused = paused;
    gStudioHideHud = hideHud;
}

void studio_capture_view(Mat4 view, Vec3f pos, Vec3f focus) {
    s32 i, j;
    for (i = 0; i < 4; i++) {
        for (j = 0; j < 4; j++) {
            sCamOut.view[i * 4 + j] = view[i][j];
        }
    }
    memcpy(sCamOut.pos, pos, sizeof(sCamOut.pos));
    memcpy(sCamOut.focus, focus, sizeof(sCamOut.focus));
    sCamOut.frame++;
}

void studio_capture_persp(f32 fov, f32 nearZ, f32 farZ) {
    sCamOut.fov = fov;
    sCamOut.nearZ = nearZ;
    sCamOut.farZ = farZ;
}

// Build mode: objects don't run, but everything with collision keeps it, so
// clicks land on platforms and blocks.
void unload_deactivated_objects(void);

void studio_paused_update_objects(void) {
    s32 i;
    gObjectLists = gObjectListArray;
    // free what the editor deleted, so long edit sessions don't fill the pool
    unload_deactivated_objects();
    studio_motion_paused(); // moving things wait at home while building
    clear_dynamic_surfaces();
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if ((obj->activeFlags & ACTIVE_FLAG_ACTIVE) && obj->collisionData != NULL) {
            studio_load_object_collision(obj);
        }
    }
}
