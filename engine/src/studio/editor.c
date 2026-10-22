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

enum { SHAPE_BOX, SHAPE_RAMP, SHAPE_STAIRS, SHAPE_CYLINDER, SHAPE_COUNT };

#define MAX_POLY_VERTS 8
#define MAX_POLYS 160
#define MAX_COL_TRIS 64

struct Poly {
    s32 n;
    f32 v[MAX_POLY_VERTS][3];
};

struct MeshKey {
    s32 shape, steps, top, side, surface, color;
    s32 sx, sy, sz;
    s32 translucent;
};

struct StudioMesh {
    struct MeshKey key;
    s32 nv;   // vertices in vtx (polygon after polygon; v.flag = polygon size)
    Vtx *vtx;
    Gfx *dl;
    s16 *col;
    struct GraphNode *node;
};

static struct Poly sGfxPolys[MAX_POLYS];
static s32 sGfxPolyCount;
static struct Poly sColPolys[80];
static s32 sColPolyCount;
static f32 sHull[3];

static struct Poly *gfx_poly(s32 n) {
    struct Poly *p = &sGfxPolys[sGfxPolyCount < MAX_POLYS - 1 ? sGfxPolyCount++ : sGfxPolyCount];
    p->n = n;
    return p;
}
static struct Poly *col_poly(s32 n) {
    struct Poly *p = &sColPolys[sColPolyCount < 79 ? sColPolyCount++ : sColPolyCount];
    p->n = n;
    return p;
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

static void build_shape(s32 shape, f32 sx, f32 sy, f32 sz, s32 steps) {
    f32 hx = sx / 2, hz = sz / 2;
    s32 i;

    sGfxPolyCount = 0;
    sColPolyCount = 0;
    setv(sHull, 0, sy / 2, 0);
    if (shape == SHAPE_BOX) {
        box_polys(gfx_poly, -hx, 0, -hz, hx, sy, hz, FALSE);
        box_polys(col_poly, -hx, 0, -hz, hx, sy, hz, FALSE);
    } else if (shape == SHAPE_RAMP) {
        // rises toward +z
        f32 pz[3] = { -hz, hz, hz }, py[3] = { 0, sy, 0 };
        prism_polys(gfx_poly, hx, pz, py, 3);
        prism_polys(col_poly, hx, pz, py, 3);
        setv(sHull, 0, sy / 3, hz / 3);
    } else if (shape == SHAPE_STAIRS) {
        f32 d, h;
        if (steps < 1) steps = 1;
        if (steps > 24) steps = 24;
        d = sz / steps;
        h = sy / steps;
        for (i = 0; i < steps; i++) {
            f32 z0 = -hz + i * d, z1 = z0 + d, top = (i + 1) * h;
            quad(gfx_poly(4), -hx, top, z0, hx, top, z0, hx, top, z1, -hx, top, z1);       // tread
            quad(gfx_poly(4), -hx, i * h, z0, hx, i * h, z0, hx, top, z0, -hx, top, z0);   // riser
            quad(gfx_poly(4), hx, 0, z0, hx, 0, z1, hx, top, z1, hx, top, z0);             // right
            quad(gfx_poly(4), -hx, 0, z0, -hx, top, z0, -hx, top, z1, -hx, 0, z1);         // left
        }
        quad(gfx_poly(4), -hx, 0, hz, -hx, sy, hz, hx, sy, hz, hx, 0, hz); // back
        // Collision: a ramp through the middle of every tread, so Mario walks up
        // steps of up to ~45 units; taller steps need a jump.
        {
            f32 pz[5] = { -hz, -hz, hz - d / 2, hz, hz };
            f32 py[5] = { 0, h / 2, sy, sy, 0 };
            prism_polys(col_poly, hx, pz, py, 5);
            setv(sHull, 0, sy / 3, hz / 4);
        }
    } else {
        s32 n = 16;
        for (i = 0; i < n; i++) {
            f32 a0 = i * 2 * M_PI / n, a1 = (i + 1) * 2 * M_PI / n;
            f32 x0 = sinf(a0) * hx, z0 = cosf(a0) * hz, x1 = sinf(a1) * hx, z1 = cosf(a1) * hz;
            struct Poly *t;
            quad(gfx_poly(4), x0, 0, z0, x1, 0, z1, x1, sy, z1, x0, sy, z0);
            quad(col_poly(4), x0, 0, z0, x1, 0, z1, x1, sy, z1, x0, sy, z0);
            t = gfx_poly(3); setv(t->v[0], 0, sy, 0); setv(t->v[1], x0, sy, z0); setv(t->v[2], x1, sy, z1);
            t = col_poly(3); setv(t->v[0], 0, sy, 0); setv(t->v[1], x0, sy, z0); setv(t->v[2], x1, sy, z1);
            t = col_poly(3); setv(t->v[0], 0, 0, 0); setv(t->v[1], x0, 0, z0); setv(t->v[2], x1, 0, z1);
        }
    }
}

static void poly_normal(struct Poly *p, f32 *n) {
    f32 ax = p->v[1][0] - p->v[0][0], ay = p->v[1][1] - p->v[0][1], az = p->v[1][2] - p->v[0][2];
    f32 bx = p->v[2][0] - p->v[1][0], by = p->v[2][1] - p->v[1][1], bz = p->v[2][2] - p->v[1][2];
    f32 len;
    n[0] = ay * bz - az * by;
    n[1] = az * bx - ax * bz;
    n[2] = ax * by - ay * bx;
    len = sqrtf(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 0.0001f) {
        n[0] /= len;
        n[1] /= len;
        n[2] /= len;
    }
}

// Make the polygon face away from the shape's inside point.
static void orient_outward(struct Poly *p) {
    f32 n[3], c[3] = { 0, 0, 0 };
    s32 i;
    poly_normal(p, n);
    for (i = 0; i < p->n; i++) {
        c[0] += p->v[i][0] / p->n;
        c[1] += p->v[i][1] / p->n;
        c[2] += p->v[i][2] / p->n;
    }
    if ((c[0] - sHull[0]) * n[0] + (c[1] - sHull[1]) * n[1] + (c[2] - sHull[2]) * n[2] < 0) {
        for (i = 0; i < p->n / 2; i++) {
            f32 t[3];
            memcpy(t, p->v[i], sizeof(t));
            memcpy(p->v[i], p->v[p->n - 1 - i], sizeof(t));
            memcpy(p->v[p->n - 1 - i], t, sizeof(t));
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
static void block_shade(const f32 *n, u8 r, u8 gr, u8 b, u8 *out) {
    f32 shade, k[3], c;
    s32 i;
    if (n[1] > 0.7f) shade = 1.0f;
    else if (n[1] < -0.7f) shade = 0.45f;
    else if (n[1] > 0.2f) shade = 0.9f;
    else shade = fabsf(n[0]) > fabsf(n[2]) ? 0.78f : 0.64f;
    studio_light_ratio(n[0], n[1], n[2], k);
    for (i = 0; i < 3; i++) {
        c = (i == 0 ? r : i == 1 ? gr : b) * shade * k[i];
        out[i] = c > 255.0f ? 255 : c < 0.0f ? 0 : (u8) c;
    }
}

static Gfx *emit_group(Gfx *g, Vtx *vtx, s32 *vi, s32 wantTop, const u8 *tex, u8 r, u8 gr, u8 b) {
    s32 i, j, chunkStart = 0, chunkVerts = 0;
    s32 picked[MAX_POLYS], count = 0;

    for (i = 0; i < sGfxPolyCount; i++) {
        f32 n[3];
        poly_normal(&sGfxPolys[i], n);
        if ((n[1] > 0.5f) == wantTop) {
            picked[count++] = i;
        }
    }
    if (count == 0) {
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
            f32 n[3], minU = 1e9f, minV = 1e9f, maxV = -1e9f;
            s32 ua, va, flipV;
            poly_normal(p, n);
            // planar mapping on the dominant axis; side faces keep "up" up
            if (fabsf(n[1]) >= fabsf(n[0]) && fabsf(n[1]) >= fabsf(n[2])) {
                ua = 0; va = 2; flipV = FALSE;
            } else if (fabsf(n[0]) > fabsf(n[2])) {
                ua = 2; va = 1; flipV = TRUE;
            } else {
                ua = 0; va = 1; flipV = TRUE;
            }
            for (j = 0; j < p->n; j++) {
                if (p->v[j][ua] < minU) minU = p->v[j][ua];
                if (p->v[j][va] < minV) minV = p->v[j][va];
                if (p->v[j][va] > maxV) maxV = p->v[j][va];
            }
            u8 col[3];
            block_shade(n, r, gr, b, col);
            for (j = 0; j < p->n; j++) {
                Vtx *v = &vtx[*vi + j];
                f32 vv = flipV ? (maxV - p->v[j][va]) : (p->v[j][va] - minV);
                v->v.ob[0] = (s16) p->v[j][0];
                v->v.ob[1] = (s16) p->v[j][1];
                v->v.ob[2] = (s16) p->v[j][2];
                v->v.flag = p->n; // polygon size, read back when the chunk is flushed
                v->v.tc[0] = clamp_tc((p->v[j][ua] - minU) * TC_PER_UNIT);
                v->v.tc[1] = clamp_tc(vv * TC_PER_UNIT);
                v->v.cn[0] = col[0];
                v->v.cn[1] = col[1];
                v->v.cn[2] = col[2];
                v->v.cn[3] = sAlpha;
            }
            *vi += p->n;
            chunkVerts += p->n;
        }
    }
    return g;
}

static struct StudioMesh *sMeshes[1024];
static s32 sMeshCount;

static struct StudioMesh *get_mesh(struct MeshKey *key) {
    s32 i, j, nv = 0, colVerts = 0, colTris = 0, vi = 0;
    struct StudioMesh *m;
    Gfx *g;
    s16 *c;
    u8 r = (key->color >> 16) & 0xFF, gr = (key->color >> 8) & 0xFF, b = key->color & 0xFF;

    for (i = 0; i < sMeshCount; i++) {
        if (memcmp(&sMeshes[i]->key, key, sizeof(*key)) == 0) {
            return sMeshes[i];
        }
    }
    build_shape(key->shape, key->sx, key->sy, key->sz, key->steps);
    for (i = 0; i < sColPolyCount; i++) {
        orient_outward(&sColPolys[i]);
        colVerts += sColPolys[i].n;
        colTris += sColPolys[i].n - 2;
    }
    for (i = 0; i < sGfxPolyCount; i++) {
        orient_outward(&sGfxPolys[i]);
        nv += sGfxPolys[i].n;
    }

    m = calloc(1, sizeof(*m));
    m->key = *key;
    m->nv = nv;
    m->vtx = calloc(nv + 16, sizeof(Vtx));
    m->dl = calloc(sGfxPolyCount * 4 + nv + 64, sizeof(Gfx));

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
    g = emit_group(g, m->vtx, &vi, TRUE, studio_material_texels(key->top, 0), r, gr, b);
    g = emit_group(g, m->vtx, &vi, FALSE, studio_material_texels(key->side, 1), r, gr, b);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPEndDisplayList(g++);

    // collision: [COL_INIT, verts, tris, CONTINUE, END]; floors list their highest vertex first
    m->col = calloc(4 + colVerts * 3 + 2 + colTris * 3 + 4, sizeof(s16));
    c = m->col;
    *c++ = TERRAIN_LOAD_VERTICES;
    *c++ = colVerts;
    for (i = 0; i < sColPolyCount; i++) {
        for (j = 0; j < sColPolys[i].n; j++) {
            *c++ = (s16) sColPolys[i].v[j][0];
            *c++ = (s16) sColPolys[i].v[j][1];
            *c++ = (s16) sColPolys[i].v[j][2];
        }
    }
    // plain stairs never slide: their collision is a ramp, and on the default surface
    // the game slides Mario down anything steeper than 38 degrees
    *c++ = key->shape == SHAPE_STAIRS && key->surface == SURFACE_DEFAULT ? SURFACE_NOT_SLIPPERY : key->surface;
    *c++ = colTris;
    nv = 0;
    for (i = 0; i < sColPolyCount; i++) {
        struct Poly *p = &sColPolys[i];
        for (j = 1; j + 1 < p->n; j++) {
            s16 t[3] = { nv, nv + j, nv + j + 1 };
            // rotate (keeping winding) so the highest vertex comes first
            s32 hi = 0, k;
            for (k = 1; k < 3; k++) {
                if (p->v[t[k] - nv][1] > p->v[t[hi] - nv][1]) hi = k;
            }
            *c++ = t[hi];
            *c++ = t[(hi + 1) % 3];
            *c++ = t[(hi + 2) % 3];
        }
        nv += p->n;
    }
    *c++ = TERRAIN_LOAD_CONTINUE;
    *c++ = TERRAIN_LOAD_END;

    // wrapped in a culling radius: big blocks must not vanish when their center leaves the view
    {
        f32 radius = sqrtf((f32) key->sx * key->sx + (f32) key->sy * key->sy * 4 + (f32) key->sz * key->sz) / 2 + 50;
        struct GraphNodeCullingRadius *cr = init_graph_node_culling_radius(NULL, malloc(sizeof(struct GraphNodeCullingRadius)),
                                                                            radius > 30000 ? 30000 : (s16) radius);
        struct GraphNodeDisplayList *dn = init_graph_node_display_list(NULL, malloc(sizeof(struct GraphNodeDisplayList)),
                                                                       key->translucent ? LAYER_TRANSPARENT : LAYER_OPAQUE, m->dl);
        geo_add_child(&cr->node, &dn->node);
        m->node = &cr->node;
    }
    if (sMeshCount < 1024) {
        sMeshes[sMeshCount++] = m;
    }
    return m;
}

// The area's light changed: every block mesh made so far is shaded again.
void studio_blocks_relight(void) {
    s32 i, k;
    for (i = 0; i < sMeshCount; i++) {
        struct StudioMesh *m = sMeshes[i];
        u8 r = (m->key.color >> 16) & 0xFF, gr = (m->key.color >> 8) & 0xFF, b = m->key.color & 0xFF;
        for (k = 0; k < m->nv;) {
            Vtx *v = &m->vtx[k];
            s32 pn = v[0].v.flag, j;
            f32 ax, ay, az, bx, by, bz, n[3], len;
            u8 col[3];
            if (pn < 3 || k + pn > m->nv) break;
            ax = v[1].v.ob[0] - v[0].v.ob[0]; ay = v[1].v.ob[1] - v[0].v.ob[1]; az = v[1].v.ob[2] - v[0].v.ob[2];
            bx = v[2].v.ob[0] - v[1].v.ob[0]; by = v[2].v.ob[1] - v[1].v.ob[1]; bz = v[2].v.ob[2] - v[1].v.ob[2];
            n[0] = ay * bz - az * by;
            n[1] = az * bx - ax * bz;
            n[2] = ax * by - ay * bx;
            len = sqrtf(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
            if (len > 0.0001f) { n[0] /= len; n[1] /= len; n[2] /= len; }
            block_shade(n, r, gr, b, col);
            for (j = 0; j < pn; j++) {
                v[j].v.cn[0] = col[0];
                v[j].v.cn[1] = col[1];
                v[j].v.cn[2] = col[2];
            }
            k += pn;
        }
    }
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
    key.steps = key.shape == SHAPE_STAIRS ? (steps > 0 ? steps : 8) : 0;
    key.top = material_ok(top) ? top : 0;
    key.side = material_ok(side) ? side : key.top;
    key.surface = surface;
    key.color = color & 0xFFFFFF;
    key.translucent = (flags & 4) != 0;
    m = get_mesh(&key);

    obj = studio_spawn_raw(bhvStudioBlock, (flags & 1) ? NULL : m->node, x, y, z, pitch, yaw, roll, 0);
    if (obj == NULL) {
        return -1;
    }
    obj->collisionData = (flags & 2) ? NULL : m->col;
    big = key.sx > key.sy ? key.sx : key.sy;
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
