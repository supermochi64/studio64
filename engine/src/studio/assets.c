// Studio 64 assets: imported 3D models (display lists and collision built at
// runtime from what the page uploads), texture replacement for any game texture
// (through the PC renderer's texture import), custom block materials, custom
// skyboxes and Mario's colours.

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

struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams);
void gfx_texture_cache_flush(void);

// ---------------------------------------------------------------------------
// Texture overrides: texture address -> RGBA32 image of any size. The renderer
// asks on every texture it imports (studio_texture_override in gfx_pc.c), so a
// replacement shows wherever the game uses that texture.

#define TEX_SLOTS 8192
struct TexOverride {
    const u8 *addr;
    u8 *rgba;
    u16 w, h;
};
static struct TexOverride sTex[TEX_SLOTS];

static u32 tex_hash(const void *p) {
    u32 v = (u32) (uintptr_t) p;
    v ^= v >> 15;
    v *= 0x2C1B3C6Du;
    v ^= v >> 12;
    return v & (TEX_SLOTS - 1);
}

static struct TexOverride *tex_find(const u8 *addr, s32 create) {
    u32 i = tex_hash(addr), n;
    for (n = 0; n < TEX_SLOTS; n++, i = (i + 1) & (TEX_SLOTS - 1)) {
        if (sTex[i].addr == addr) {
            return &sTex[i];
        }
        if (sTex[i].addr == NULL) {
            if (!create) {
                return NULL;
            }
            sTex[i].addr = addr;
            return &sTex[i];
        }
    }
    return NULL;
}

s32 studio_texture_override(const u8 *addr, const u8 **rgba, u32 *w, u32 *h) {
    struct TexOverride *t = tex_find(addr, FALSE);
    if (t == NULL || t->rgba == NULL) {
        return 0;
    }
    *rgba = t->rgba;
    *w = t->w;
    *h = t->h;
    return 1;
}

// Textures the renderer imported since the last reset (what is on screen in this level).
#define SEEN_MAX 4096
static const u8 *sSeen[SEEN_MAX];
static u32 sSeenInfo[SEEN_MAX];
static s32 sSeenCount;
static const u8 *sSeenSet[SEEN_MAX * 2];

void studio_texture_seen(const u8 *addr, u32 fmt, u32 siz) {
    u32 i = tex_hash(addr) & (SEEN_MAX * 2 - 1), n;
    for (n = 0; n < SEEN_MAX * 2; n++, i = (i + 1) & (SEEN_MAX * 2 - 1)) {
        if (sSeenSet[i] == addr) {
            return;
        }
        if (sSeenSet[i] == NULL) {
            if (sSeenCount >= SEEN_MAX) {
                return;
            }
            sSeenSet[i] = addr;
            sSeen[sSeenCount] = addr;
            sSeenInfo[sSeenCount] = (fmt << 8) | siz;
            sSeenCount++;
            return;
        }
    }
}

EMSCRIPTEN_KEEPALIVE s32 studio_tex_seen_count(void) {
    return sSeenCount;
}
EMSCRIPTEN_KEEPALIVE const u8 **studio_tex_seen_list(void) {
    return sSeen;
}
EMSCRIPTEN_KEEPALIVE void studio_tex_seen_reset(void) {
    sSeenCount = 0;
    memset(sSeenSet, 0, sizeof(sSeenSet));
}

// Where the static data ends: the game's textures live below.
extern unsigned char __heap_base;
EMSCRIPTEN_KEEPALIVE const u8 *studio_static_end(void) {
    return &__heap_base;
}

EMSCRIPTEN_KEEPALIVE void studio_tex_flush(void) {
    gfx_texture_cache_flush();
}

// Replace the texture at addr with a w*h RGBA32 image (copied). Returns 1 on success.
EMSCRIPTEN_KEEPALIVE s32 studio_tex_set(const u8 *addr, const u8 *rgba, s32 w, s32 h, s32 flush) {
    struct TexOverride *t;
    if (addr == NULL || rgba == NULL || w < 1 || h < 1 || w > 1024 || h > 1024) {
        return 0;
    }
    t = tex_find(addr, TRUE);
    if (t == NULL) {
        return 0;
    }
    if (t->rgba == NULL || t->w != w || t->h != h) {
        free(t->rgba);
        t->rgba = malloc(w * h * 4);
    }
    memcpy(t->rgba, rgba, w * h * 4);
    t->w = w;
    t->h = h;
    if (flush) {
        gfx_texture_cache_flush();
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE void studio_tex_unset(const u8 *addr, s32 flush) {
    struct TexOverride *t = tex_find(addr, FALSE);
    if (t != NULL && t->rgba != NULL) {
        free(t->rgba);
        t->rgba = NULL; // the slot keeps its address so probing goes on past it
        if (flush) {
            gfx_texture_cache_flush();
        }
    }
}

// Drop every override except the ones on studio-owned buffers (models, materials, sky).
static s32 owned_texture(const u8 *addr);
EMSCRIPTEN_KEEPALIVE void studio_tex_unset_game(void) {
    s32 i;
    for (i = 0; i < TEX_SLOTS; i++) {
        if (sTex[i].rgba != NULL && !owned_texture(sTex[i].addr)) {
            free(sTex[i].rgba);
            sTex[i].rgba = NULL;
        }
    }
    gfx_texture_cache_flush();
}

// ---------------------------------------------------------------------------
// Imported models. The page uploads materials (RGBA32 textures), triangles per
// material (positions, uvs, colours) and collision triangles; the engine builds
// display lists in three layers (opaque, cut-out, translucent), a culling node
// and, for moving props, a small object collision mesh (max 200 vertices).

#define MAX_MODELS 256
#define MAX_MATS 64
#define VERT_FLOATS 9

enum { MAT_OPAQUE = 0, MAT_CUTOUT = 1, MAT_BLEND = 2 };

struct AssetMat {
    u8 *tex;     // RGBA32 image, also registered as a texture override
    s32 flags;   // ASSET_MAT_*
    f32 *verts;  // triangles: 3 * VERT_FLOATS per triangle
    s32 ntri, cap;
    s32 v0;      // its first vertex in the model's vtx (3 per triangle)
};

struct AssetModel {
    s32 used;
    struct AssetMat mats[MAX_MATS];
    s32 nmats;
    s16 *col;      // static collision: 10 s16 per triangle (a, b, c, type)
    s32 ncol, colCap;
    s16 *dyn;      // object collision data for moving props
    struct GraphNode *node;
    f32 radius;
    s32 tris;
    Vtx *vtx;                       // the display lists' vertices
    u8 *base;                       // their colours as baked for the default sun (relighting)
    s32 nverts;
    Gfx *dls[3];                    // one display list per layer
    struct GraphNode *dlNodes[3];   // their graph nodes (children of node)
    s32 bytes;                      // memory this model holds (studio_assets_mem)
};
static struct AssetModel sModels[MAX_MODELS];

// Every studio-owned texture buffer (so clearing game replacements keeps them).
#define OWNED_MAX 4096
static const u8 *sOwned[OWNED_MAX];
static s32 sOwnedCount;
static void own_texture(const u8 *p) {
    if (sOwnedCount < OWNED_MAX) {
        sOwned[sOwnedCount++] = p;
    }
}
static s32 owned_texture(const u8 *addr) {
    s32 i;
    for (i = 0; i < sOwnedCount; i++) {
        if (sOwned[i] == addr) {
            return TRUE;
        }
    }
    return FALSE;
}

static struct AssetModel *model_by_id(s32 id) {
    return (id >= 0 && id < MAX_MODELS && sModels[id].used) ? &sModels[id] : NULL;
}

// Rebuilt or deleted models: their old buffers wait here until no object uses them any
// more (placed copies are respawned with the new model; custom objects may keep the old
// one until they go), then they are freed (studio_assets_gc).
#define RETIRED_MAX 64
static struct AssetModel sRetired[RETIRED_MAX];
static s32 sRetiredCount;
static s32 sAssetBytes;

static void model_free_buffers(struct AssetModel *m) {
    s32 i, k;
    for (i = 0; i < m->nmats; i++) {
        struct AssetMat *mat = &m->mats[i];
        free(mat->verts);
        if (mat->tex != NULL) {
            studio_tex_unset(mat->tex, FALSE);
            for (k = 0; k < sOwnedCount; k++) {
                if (sOwned[k] == mat->tex) {
                    sOwned[k] = sOwned[--sOwnedCount];
                    break;
                }
            }
            free(mat->tex);
        }
    }
    free(m->col);
    free(m->dyn);
    free(m->vtx);
    free(m->base);
    for (i = 0; i < 3; i++) {
        free(m->dls[i]);
        free(m->dlNodes[i]);
    }
    free(m->node);
    sAssetBytes -= m->bytes;
}

static s32 model_in_use(const struct AssetModel *m) {
    s32 i;
    if (m->node == NULL && m->dyn == NULL) {
        return FALSE;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) continue;
        if ((m->node != NULL && obj->header.gfx.sharedChild == m->node)
            || (m->dyn != NULL && obj->collisionData == m->dyn)) {
            return TRUE;
        }
    }
    return FALSE;
}

// Free the retired models nothing draws any more. Returns how many still wait.
// (called between frames: the last frame's display lists are done)
EMSCRIPTEN_KEEPALIVE s32 studio_assets_gc(void) {
    s32 i, freed = 0;
    for (i = 0; i < sRetiredCount;) {
        if (!model_in_use(&sRetired[i])) {
            model_free_buffers(&sRetired[i]);
            sRetired[i] = sRetired[--sRetiredCount];
            freed++;
        } else {
            i++;
        }
    }
    if (freed) {
        gfx_texture_cache_flush(); // freed texture addresses may be reused by new ones
    }
    return sRetiredCount;
}

static void model_retire(struct AssetModel *m) {
    if (!m->used) {
        return;
    }
    if (sRetiredCount >= RETIRED_MAX) {
        studio_assets_gc();
    }
    if (sRetiredCount < RETIRED_MAX) {
        sRetired[sRetiredCount++] = *m;
    } // else: 64 rebuilt models all still on screen: keep them (a leak, never a dangling pointer)
    memset(m, 0, sizeof(*m));
}

// Bytes held by imported models (live and retired), and how many retired ones wait.
EMSCRIPTEN_KEEPALIVE s32 studio_assets_mem(void) {
    return sAssetBytes;
}
EMSCRIPTEN_KEEPALIVE s32 studio_assets_retired(void) {
    return sRetiredCount;
}

// Start (or restart) model `id`. The old buffers are retired: objects may still draw them.
EMSCRIPTEN_KEEPALIVE s32 studio_model_begin(s32 id) {
    struct AssetModel *m;
    if (id < 0 || id >= MAX_MODELS) {
        return 0;
    }
    m = &sModels[id];
    model_retire(m);
    m->used = TRUE;
    return 1;
}

// A model deleted from the project: its slot is free again.
EMSCRIPTEN_KEEPALIVE void studio_model_free(s32 id) {
    if (id < 0 || id >= MAX_MODELS) {
        return;
    }
    model_retire(&sModels[id]);
    studio_assets_gc();
}

// A material: rgba (w*h RGBA32, may be NULL for colour only) and ASSET_MAT_* flags.
EMSCRIPTEN_KEEPALIVE s32 studio_model_material(s32 id, const u8 *rgba, s32 w, s32 h, s32 flags) {
    struct AssetModel *m = model_by_id(id);
    struct AssetMat *mat;
    if (m == NULL || m->nmats >= MAX_MATS) {
        return -1;
    }
    mat = &m->mats[m->nmats];
    memset(mat, 0, sizeof(*mat));
    mat->flags = flags;
    if (rgba != NULL && w > 0 && h > 0 && w <= 1024 && h <= 1024) {
        // the display list loads a 32x32 RGBA16 tile from this address; the override holds the image
        mat->tex = calloc(1, 2048);
        own_texture(mat->tex);
        studio_tex_set(mat->tex, rgba, w, h, FALSE);
        m->bytes += 2048 + w * h * 4;
        sAssetBytes += 2048 + w * h * 4;
    }
    return m->nmats++;
}

// Triangles of material `mat`: 3 vertices of x y z u v r g b a (uv 0..1 per repeat, colours 0..255).
EMSCRIPTEN_KEEPALIVE s32 studio_model_tris(s32 id, s32 matIndex, const f32 *v, s32 ntri) {
    struct AssetModel *m = model_by_id(id);
    struct AssetMat *mat;
    if (m == NULL || matIndex < 0 || matIndex >= m->nmats || ntri <= 0) {
        return 0;
    }
    mat = &m->mats[matIndex];
    if (mat->ntri + ntri > mat->cap) {
        mat->cap = (mat->ntri + ntri) * 2;
        mat->verts = realloc(mat->verts, mat->cap * 3 * VERT_FLOATS * sizeof(f32));
    }
    memcpy(mat->verts + mat->ntri * 3 * VERT_FLOATS, v, ntri * 3 * VERT_FLOATS * sizeof(f32));
    mat->ntri += ntri;
    return mat->ntri;
}

// Collision triangles in model space: 9 s16 per triangle plus one surface type each.
EMSCRIPTEN_KEEPALIVE s32 studio_model_collision(s32 id, const s16 *tris, const s16 *types, s32 ntri) {
    struct AssetModel *m = model_by_id(id);
    s32 i;
    if (m == NULL || ntri <= 0) {
        return 0;
    }
    if (m->ncol + ntri > m->colCap) {
        m->colCap = (m->ncol + ntri) * 2;
        m->col = realloc(m->col, m->colCap * 10 * sizeof(s16));
    }
    for (i = 0; i < ntri; i++) {
        memcpy(&m->col[(m->ncol + i) * 10], &tris[i * 9], 9 * sizeof(s16));
        m->col[(m->ncol + i) * 10 + 9] = types[i];
    }
    m->ncol += ntri;
    return m->ncol;
}

static s16 clamp16(f32 v) {
    if (v > 32767.0f) return 32767;
    if (v < -32768.0f) return -32768;
    return (s16) lroundf(v);
}

// The renderer treats every model texture as a 32x32 tile (the override supplies the
// real image), so 1.0 in uv is 32 texels: tc = uv * 32 * 32 in 10.5 fixed point.
#define UV_SCALE 1024.0f

static Gfx *emit_material(Gfx *g, Vtx *vtx, s32 *vi, struct AssetMat *mat) {
    s32 t, k;
    s32 cms = (mat->flags >> 3) & 3, cmt = (mat->flags >> 5) & 3;
    u32 cmsMode = cms == 1 ? (G_TX_WRAP | G_TX_MIRROR) : cms == 2 ? G_TX_CLAMP : (G_TX_WRAP | G_TX_NOMIRROR);
    u32 cmtMode = cmt == 1 ? (G_TX_WRAP | G_TX_MIRROR) : cmt == 2 ? G_TX_CLAMP : (G_TX_WRAP | G_TX_NOMIRROR);
    s32 layer = mat->flags & 3;

    mat->v0 = *vi;
    gDPPipeSync(g++);
    if (mat->tex != NULL) {
        if (layer == MAT_OPAQUE) {
            gDPSetCombineMode(g++, G_CC_MODULATERGB, G_CC_MODULATERGB);
        } else {
            gDPSetCombineMode(g++, G_CC_MODULATERGBA, G_CC_MODULATERGBA);
        }
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
        gDPLoadTextureBlock(g++, mat->tex, G_IM_FMT_RGBA, G_IM_SIZ_16b, 32, 32, 0, cmsMode, cmtMode, 5, 5,
                            G_TX_NOLOD, G_TX_NOLOD);
    } else {
        gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    }
    if (mat->flags & ASSET_MAT_DOUBLE) {
        gSPClearGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    } else {
        gSPClearGeometryMode(g++, G_LIGHTING);
        gSPSetGeometryMode(g++, G_CULL_BACK);
    }
    // batches of 10 triangles (30 vertices), each triangle with its own vertices so its
    // uvs can be shifted by whole repeats into the fixed-point range
    for (t = 0; t < mat->ntri; t += 10) {
        s32 n = mat->ntri - t < 10 ? mat->ntri - t : 10;
        Vtx *base = &vtx[*vi];
        for (k = 0; k < n; k++) {
            const f32 *v = mat->verts + (t + k) * 3 * VERT_FLOATS;
            f32 su = floorf(fminf(fminf(v[3], v[3 + VERT_FLOATS]), v[3 + 2 * VERT_FLOATS]));
            f32 sv = floorf(fminf(fminf(v[4], v[4 + VERT_FLOATS]), v[4 + 2 * VERT_FLOATS]));
            s32 j;
            if (cms == 2) su = 0; // clamped textures keep their real uvs
            if (cmt == 2) sv = 0;
            if (cms == 1) su = floorf(su / 2) * 2; // mirrored ones shift by pairs
            if (cmt == 1) sv = floorf(sv / 2) * 2;
            for (j = 0; j < 3; j++) {
                const f32 *p = v + j * VERT_FLOATS;
                Vtx *out = &vtx[*vi + k * 3 + j];
                out->v.ob[0] = clamp16(p[0]);
                out->v.ob[1] = clamp16(p[1]);
                out->v.ob[2] = clamp16(p[2]);
                out->v.flag = 0;
                out->v.tc[0] = clamp16((p[3] - su) * UV_SCALE);
                out->v.tc[1] = clamp16((p[4] - sv) * UV_SCALE);
                out->v.cn[0] = (u8) p[5];
                out->v.cn[1] = (u8) p[6];
                out->v.cn[2] = (u8) p[7];
                out->v.cn[3] = (u8) p[8];
            }
        }
        gSPVertex(g++, base, n * 3, 0);
        for (k = 0; k + 1 < n; k += 2) {
            gSP2Triangles(g++, k * 3, k * 3 + 1, k * 3 + 2, 0, k * 3 + 3, k * 3 + 4, k * 3 + 5, 0);
        }
        if (k < n) {
            gSP1Triangle(g++, k * 3, k * 3 + 1, k * 3 + 2, 0);
        }
        *vi += n * 3;
    }
    return g;
}

// Object collision for moving props: the mesh itself when it has at most 200 distinct
// vertices, otherwise its bounding box.
static s16 *build_dynamic_collision(struct AssetModel *m, f32 *bmin, f32 *bmax, s32 *bytes) {
    s16 *verts = malloc(200 * 3 * sizeof(s16));
    s16 *idx = malloc((m->ncol > 0 ? m->ncol : 1) * 3 * sizeof(s16));
    s32 nv = 0, i, j, k, ok = m->ncol > 0 && m->ncol <= 600;
    s16 *out, *c;
    for (i = 0; i < m->ncol && ok; i++) {
        for (j = 0; j < 3 && ok; j++) {
            s16 *p = &m->col[i * 10 + j * 3];
            for (k = 0; k < nv; k++) {
                if (verts[k * 3] == p[0] && verts[k * 3 + 1] == p[1] && verts[k * 3 + 2] == p[2]) break;
            }
            if (k == nv) {
                if (nv >= 200) { ok = FALSE; break; }
                memcpy(&verts[nv * 3], p, 3 * sizeof(s16));
                nv++;
            }
            idx[i * 3 + j] = k;
        }
    }
    if (!ok) {
        // bounding box: 8 corners, 12 triangles, outward winding
        static const s8 corner[8][3] = { { 0, 0, 0 }, { 1, 0, 0 }, { 1, 0, 1 }, { 0, 0, 1 },
                                         { 0, 1, 0 }, { 1, 1, 0 }, { 1, 1, 1 }, { 0, 1, 1 } };
        static const s8 tri[12][3] = { { 4, 7, 6 }, { 4, 6, 5 }, { 0, 1, 2 }, { 0, 2, 3 }, { 3, 2, 6 }, { 3, 6, 7 },
                                       { 1, 0, 4 }, { 1, 4, 5 }, { 2, 1, 5 }, { 2, 5, 6 }, { 0, 3, 7 }, { 0, 7, 4 } };
        *bytes = (2 + 24 + 2 + 36 + 4) * sizeof(s16);
        out = c = malloc(*bytes);
        *c++ = TERRAIN_LOAD_VERTICES;
        *c++ = 8;
        for (i = 0; i < 8; i++) {
            for (j = 0; j < 3; j++) *c++ = clamp16(corner[i][j] ? bmax[j] : bmin[j]);
        }
        *c++ = SURFACE_DEFAULT;
        *c++ = 12;
        for (i = 0; i < 12; i++) {
            for (j = 0; j < 3; j++) *c++ = tri[i][j];
        }
        *c++ = TERRAIN_LOAD_CONTINUE;
        *c++ = TERRAIN_LOAD_END;
        free(verts);
        free(idx);
        return out;
    }
    *bytes = (2 + nv * 3 + m->ncol * 5 + 8) * sizeof(s16);
    out = c = malloc(*bytes);
    *c++ = TERRAIN_LOAD_VERTICES;
    *c++ = nv;
    memcpy(c, verts, nv * 3 * sizeof(s16));
    c += nv * 3;
    // one group per run of the same surface type
    for (i = 0; i < m->ncol;) {
        s16 type = m->col[i * 10 + 9];
        s32 n = 0;
        while (i + n < m->ncol && m->col[(i + n) * 10 + 9] == type) n++;
        *c++ = type;
        *c++ = n;
        for (k = 0; k < n; k++) {
            s16 *t = &idx[(i + k) * 3];
            // floors list their highest vertex first (SM64 sorts by it)
            s32 hi = 0, r;
            for (r = 1; r < 3; r++) {
                if (verts[t[r] * 3 + 1] > verts[t[hi] * 3 + 1]) hi = r;
            }
            *c++ = t[hi];
            *c++ = t[(hi + 1) % 3];
            *c++ = t[(hi + 2) % 3];
        }
        i += n;
    }
    *c++ = TERRAIN_LOAD_CONTINUE;
    *c++ = TERRAIN_LOAD_END;
    free(verts);
    free(idx);
    return out;
}

// Shade a model's baked vertex colours for the area's sun (flow.c studio_env_light):
// per triangle, its colours as baked for the default sun times the light ratio.
void studio_light_ratio(f32 nx, f32 ny, f32 nz, f32 out[3]);
static void model_relight(struct AssetModel *m) {
    s32 i, t, j, c;
    if (m->vtx == NULL || m->base == NULL) {
        return;
    }
    for (i = 0; i < m->nmats; i++) {
        struct AssetMat *mat = &m->mats[i];
        s32 unlit = (mat->flags & ASSET_MAT_UNLIT) != 0;
        for (t = 0; t < mat->ntri; t++) {
            Vtx *v = &m->vtx[mat->v0 + t * 3];
            const u8 *b = &m->base[(mat->v0 + t * 3) * 4];
            f32 k[3] = { 1.0f, 1.0f, 1.0f };
            if (mat->v0 + t * 3 + 3 > m->nverts) break;
            if (!unlit) {
                f32 ax = v[1].v.ob[0] - v[0].v.ob[0], ay = v[1].v.ob[1] - v[0].v.ob[1], az = v[1].v.ob[2] - v[0].v.ob[2];
                f32 bx = v[2].v.ob[0] - v[0].v.ob[0], by = v[2].v.ob[1] - v[0].v.ob[1], bz = v[2].v.ob[2] - v[0].v.ob[2];
                studio_light_ratio(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx, k);
            }
            for (j = 0; j < 3; j++) {
                for (c = 0; c < 3; c++) {
                    f32 x = b[j * 4 + c] * k[c];
                    v[j].v.cn[c] = x > 255.0f ? 255 : (u8) x;
                }
            }
        }
    }
}

void studio_models_relight(void) {
    s32 i;
    for (i = 0; i < MAX_MODELS; i++) {
        if (sModels[i].used) {
            model_relight(&sModels[i]);
        }
    }
}

// Build the display lists and the graph node. Returns the number of triangles drawn.
EMSCRIPTEN_KEEPALIVE s32 studio_model_end(s32 id) {
    struct AssetModel *m = model_by_id(id);
    s32 i, layer, total = 0, vi = 0, cmds = 16;
    f32 bmin[3] = { 1e9f, 1e9f, 1e9f }, bmax[3] = { -1e9f, -1e9f, -1e9f }, r2 = 0;
    Vtx *vtx;
    struct GraphNodeCullingRadius *cr;
    static const s32 layers[3] = { LAYER_OPAQUE, LAYER_ALPHA, LAYER_TRANSPARENT };

    s32 bytes0;
    if (m == NULL) {
        return 0;
    }
    bytes0 = m->bytes;
    for (i = 0; i < m->nmats; i++) {
        struct AssetMat *mat = &m->mats[i];
        s32 k;
        total += mat->ntri;
        cmds += 24 + (mat->ntri / 10 + 1) * 7;
        for (k = 0; k < mat->ntri * 3; k++) {
            const f32 *p = mat->verts + k * VERT_FLOATS;
            s32 a;
            for (a = 0; a < 3; a++) {
                if (p[a] < bmin[a]) bmin[a] = p[a];
                if (p[a] > bmax[a]) bmax[a] = p[a];
            }
            if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > r2) r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
        }
    }
    for (i = 0; i < m->ncol; i++) {
        s32 j;
        for (j = 0; j < 9; j++) {
            f32 v = m->col[i * 10 + j];
            if (v < bmin[j % 3]) bmin[j % 3] = v;
            if (v > bmax[j % 3]) bmax[j % 3] = v;
        }
    }
    if (bmin[0] > bmax[0]) {
        for (i = 0; i < 3; i++) { bmin[i] = -50; bmax[i] = 50; }
    }
    m->tris = total;
    m->radius = sqrtf(r2) + 50.0f;
    vtx = calloc(total * 3 + 3, sizeof(Vtx));
    m->vtx = vtx;
    m->bytes += (total * 3 + 3) * sizeof(Vtx) + sizeof(struct GraphNodeCullingRadius) + m->colCap * 10 * sizeof(s16);
    cr = init_graph_node_culling_radius(NULL, malloc(sizeof(struct GraphNodeCullingRadius)),
                                        m->radius > 30000 ? 30000 : (s16) m->radius);
    for (layer = 0; layer < 3; layer++) {
        Gfx *dl = NULL, *g;
        s32 any = FALSE;
        for (i = 0; i < m->nmats; i++) {
            if ((m->mats[i].flags & 3) == layer && m->mats[i].ntri > 0) any = TRUE;
        }
        if (!any) continue;
        dl = g = calloc(cmds, sizeof(Gfx));
        for (i = 0; i < m->nmats; i++) {
            if ((m->mats[i].flags & 3) == layer && m->mats[i].ntri > 0) {
                g = emit_material(g, vtx, &vi, &m->mats[i]);
            }
        }
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
        gDPPipeSync(g++);
        gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
        gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
        gSPEndDisplayList(g++);
        m->dls[layer] = dl;
        m->dlNodes[layer] = &init_graph_node_display_list(NULL, malloc(sizeof(struct GraphNodeDisplayList)),
                                                          layers[layer], dl)->node;
        m->bytes += cmds * sizeof(Gfx) + sizeof(struct GraphNodeDisplayList);
        geo_add_child(&cr->node, m->dlNodes[layer]);
    }
    m->node = &cr->node;
    {
        s32 dynBytes = 0;
        m->dyn = build_dynamic_collision(m, bmin, bmax, &dynBytes);
        m->bytes += dynBytes;
    }
    m->nverts = vi;
    m->base = malloc(vi * 4 + 4);
    for (i = 0; i < vi; i++) {
        memcpy(&m->base[i * 4], vtx[i].v.cn, 4);
    }
    m->bytes += vi * 4 + 4;
    sAssetBytes += m->bytes - bytes0;
    model_relight(m);
    // the source triangles are no longer needed
    for (i = 0; i < m->nmats; i++) {
        free(m->mats[i].verts);
        m->mats[i].verts = NULL;
        m->mats[i].cap = 0;
    }
    return total;
}

struct GraphNode *studio_asset_model_node(s32 id) {
    struct AssetModel *m = model_by_id(id);
    return m != NULL ? m->node : NULL;
}

s16 *studio_asset_model_collision(s32 id) {
    struct AssetModel *m = model_by_id(id);
    return m != NULL ? m->dyn : NULL;
}

// ---------------------------------------------------------------------------
// Placed models: bhvStudioModel objects. Level geometry and still props add their
// collision to the static level collision (any size); moving props carry the small
// object collision mesh.

struct PropInfo {
    s32 model, flags, anim;
    f32 speed, amp, baseY, phase;
    u32 stamp;
};
static struct PropInfo sProps[OBJECT_POOL_CAPACITY];
static u32 sPropStamp;

static struct PropInfo *prop_of(struct Object *obj) {
    s32 slot = obj - gObjectPool;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || obj->behavior != bhvStudioModel) {
        return NULL;
    }
    return sProps[slot].stamp == (u32) obj->oBehParams ? &sProps[slot] : NULL;
}

void bhv_studio_model_loop(void) {
    struct PropInfo *p = prop_of(o);
    f32 t;
    if (p == NULL) {
        return;
    }
    p->phase += 1.0f;
    t = p->phase * p->speed;
    p->baseY = o->oHomeY; // the editor moves the home too
    o->oAngleVelYaw = 0;
    o->oVelY = 0;
    switch (p->anim) {
        case ASSET_ANIM_SPIN:
            o->oAngleVelYaw = (s16) (p->speed * 256.0f);
            o->oFaceAngleYaw += o->oAngleVelYaw;
            break;
        case ASSET_ANIM_BOB: {
            f32 y = p->baseY + sinf(t * 0.05f) * p->amp;
            o->oVelY = y - o->oPosY;
            o->oPosY = y;
            break;
        }
        case ASSET_ANIM_SPIN_BOB: {
            f32 y = p->baseY + sinf(t * 0.05f) * p->amp;
            o->oAngleVelYaw = (s16) (p->speed * 256.0f);
            o->oFaceAngleYaw += o->oAngleVelYaw;
            o->oVelY = y - o->oPosY;
            o->oPosY = y;
            break;
        }
        case ASSET_ANIM_SWAY:
            o->oFaceAngleRoll = (s16) (sinf(t * 0.04f) * 2400.0f);
            break;
        case ASSET_ANIM_PULSE: {
            f32 s = 1.0f + sinf(t * 0.06f) * 0.08f;
            o->header.gfx.scale[0] = o->header.gfx.scale[2] = p->amp * s;
            o->header.gfx.scale[1] = p->amp / s;
            break;
        }
        default:
            break;
    }
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->collisionData != NULL) {
        load_object_collision_model();
    }
}

// flags: ASSET_PLACE_*; anim: ASSET_ANIM_*; speed: animation speed (1 = default).
EMSCRIPTEN_KEEPALIVE
s32 studio_model_spawn(s32 id, f32 x, f32 y, f32 z, s32 pitch, s32 yaw, s32 roll, f32 scale, s32 flags, s32 anim,
                       f32 speed, s32 uid) {
    struct AssetModel *m = model_by_id(id);
    struct Object *obj;
    struct PropInfo *p;
    s32 slot;
    f32 reach;
    if (m == NULL || m->node == NULL) {
        return -1;
    }
    if (scale <= 0.0f) scale = 1.0f;
    // one culling radius for every placement: grow it for big ones
    reach = m->radius * scale * 1.2f;
    if (reach > ((struct GraphNodeCullingRadius *) m->node)->cullingRadius) {
        ((struct GraphNodeCullingRadius *) m->node)->cullingRadius = reach > 30000 ? 30000 : (s16) reach;
    }
    sPropStamp = (sPropStamp + 1) & 0x7FFFFFFF;
    obj = studio_spawn_raw(bhvStudioModel, (flags & ASSET_PLACE_INVISIBLE) ? NULL : m->node, x, y, z, pitch, yaw, roll,
                           sPropStamp);
    if (obj == NULL) {
        return -1;
    }
    slot = obj - gObjectPool;
    p = &sProps[slot];
    memset(p, 0, sizeof(*p));
    p->model = id;
    p->flags = flags;
    p->anim = anim;
    p->speed = speed > 0 ? speed : 1.0f;
    p->amp = anim == ASSET_ANIM_PULSE ? scale : 60.0f * scale;
    p->baseY = y;
    p->stamp = sPropStamp;
    obj->oBehParams = sPropStamp;
    obj->oHomeX = x;
    obj->oHomeY = y;
    obj->oHomeZ = z;
    obj->unused2 = (u32) uid;
    obj_scale(obj, scale);
    obj->oDrawingDistance = 30000.0f;
    // moving props collide as objects; everything else is in the static collision
    obj->collisionData = ((flags & ASSET_PLACE_COLLISION) && anim != ASSET_ANIM_NONE && !(flags & ASSET_PLACE_LEVEL))
                             ? m->dyn : NULL;
    obj->oCollisionDistance = m->radius * scale + 1500.0f;
    return slot;
}

// Imported triangles left without collision because the surface pool was full.
static s32 sDropped;
EMSCRIPTEN_KEEPALIVE s32 studio_assets_dropped(void) {
    return sDropped;
}
extern s32 gSurfacesAllocated, sSurfacePoolSize;
extern struct Surface *sSurfacePool;
// what is kept free for the moving objects' collision, which shares the pool
#define DYNAMIC_RESERVE 7000

// The static collision of all placed models (called while the level collision is rebuilt).
void studio_assets_add_surfaces(void) {
    s32 i, k;
    sDropped = 0;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        struct PropInfo *p;
        struct AssetModel *m;
        Mat4 mtx;
        Vec3f pos;
        Vec3s ang;
        f32 sx, sy, sz;
        if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE) || (p = prop_of(obj)) == NULL) continue;
        if (!(p->flags & (ASSET_PLACE_COLLISION | ASSET_PLACE_LEVEL))) continue;
        if (obj->collisionData != NULL) continue; // moving: object collision
        m = model_by_id(p->model);
        if (m == NULL) continue;
        pos[0] = obj->oPosX; pos[1] = obj->oPosY; pos[2] = obj->oPosZ;
        ang[0] = obj->oFaceAnglePitch; ang[1] = obj->oFaceAngleYaw; ang[2] = obj->oFaceAngleRoll;
        sx = obj->header.gfx.scale[0]; sy = obj->header.gfx.scale[1]; sz = obj->header.gfx.scale[2];
        mtxf_rotate_zxy_and_translate(mtx, pos, ang);
        for (k = 0; k < m->ncol; k++) {
            s16 *t = &m->col[k * 10];
            s16 w[3][3];
            s32 j, out = 0;
            for (j = 0; j < 3; j++) {
                f32 lx = t[j * 3] * sx, ly = t[j * 3 + 1] * sy, lz = t[j * 3 + 2] * sz;
                f32 wx = lx * mtx[0][0] + ly * mtx[1][0] + lz * mtx[2][0] + mtx[3][0];
                f32 wy = lx * mtx[0][1] + ly * mtx[1][1] + lz * mtx[2][1] + mtx[3][1];
                f32 wz = lx * mtx[0][2] + ly * mtx[1][2] + lz * mtx[2][2] + mtx[3][2];
                if (fabsf(wx) > 8190.0f || fabsf(wz) > 8190.0f || fabsf(wy) > 32000.0f) out++;
                w[j][0] = clamp16(wx);
                w[j][1] = clamp16(wy);
                w[j][2] = clamp16(wz);
            }
            if (out == 3) continue; // outside the collision grid
            if (gSurfacesAllocated >= sSurfacePoolSize - DYNAMIC_RESERVE) {
                sDropped++;
                continue;
            }
            {
                s32 before = gSurfacesAllocated;
                studio_add_static_tri(w[0], w[1], w[2], t[9]);
                // props: their surfaces name the object, so a click in the editor selects it
                // (still velocity: standing on it moves nothing); level geometry stays unclickable
                if (gSurfacesAllocated > before && !(p->flags & ASSET_PLACE_LEVEL)) {
                    sSurfacePool[gSurfacesAllocated - 1].object = obj;
                }
            }
        }
    }
}

// A checksum of where the static-collision models are, so the page knows when to rebuild.
EMSCRIPTEN_KEEPALIVE u32 studio_assets_pose_hash(void) {
    u32 h = 2166136261u;
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        struct PropInfo *p;
        if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE) || (p = prop_of(obj)) == NULL) continue;
        if (!(p->flags & (ASSET_PLACE_COLLISION | ASSET_PLACE_LEVEL)) || obj->collisionData != NULL) continue;
        h = (h ^ (u32) i) * 16777619u;
        h = (h ^ (u32) (s32) obj->oPosX) * 16777619u;
        h = (h ^ (u32) (s32) obj->oPosY) * 16777619u;
        h = (h ^ (u32) (s32) obj->oPosZ) * 16777619u;
        h = (h ^ (u32) (u16) obj->oFaceAngleYaw) * 16777619u;
        h = (h ^ (u32) (u16) obj->oFaceAnglePitch) * 16777619u;
        h = (h ^ (u32) (u16) obj->oFaceAngleRoll) * 16777619u;
        h = (h ^ (u32) (s32) (obj->header.gfx.scale[0] * 1000)) * 16777619u;
        h = (h ^ (u32) (s32) (obj->header.gfx.scale[1] * 1000)) * 16777619u;
    }
    return h;
}

// ---------------------------------------------------------------------------
// Water from imported models: boxes merged into the area's environment regions.

#define MAX_WATER 32
static s16 sWaterBoxes[MAX_WATER][5];
static s32 sWaterCount;
static s16 sRegions[1 + (MAX_WATER + 40) * 6];
static s16 *sBaseRegions;

// boxes: x0 z0 x1 z1 height per box (world space).
EMSCRIPTEN_KEEPALIVE void studio_assets_water(const s16 *boxes, s32 n) {
    sWaterCount = n < 0 ? 0 : (n > MAX_WATER ? MAX_WATER : n);
    if (sWaterCount > 0) {
        memcpy(sWaterBoxes, boxes, sWaterCount * 5 * sizeof(s16));
    }
    studio_assets_apply_water();
}

void studio_assets_apply_water(void) {
    s16 *base;
    s32 n = 0, i;
    if (gEnvironmentRegions != sRegions) {
        sBaseRegions = gEnvironmentRegions;
    }
    base = sBaseRegions;
    if (sWaterCount == 0) {
        if (gEnvironmentRegions == sRegions) gEnvironmentRegions = sBaseRegions;
        return;
    }
    if (base != NULL) {
        s32 count = base[0] < 40 ? base[0] : 40;
        memcpy(&sRegions[1], &base[1], count * 6 * sizeof(s16));
        n = count;
    }
    for (i = 0; i < sWaterCount; i++, n++) {
        s16 *r = &sRegions[1 + n * 6];
        r[0] = 49; // a water id no level's moving water texture uses
        r[1] = sWaterBoxes[i][0];
        r[2] = sWaterBoxes[i][1];
        r[3] = sWaterBoxes[i][2];
        r[4] = sWaterBoxes[i][3];
        r[5] = sWaterBoxes[i][4];
    }
    sRegions[0] = n;
    gEnvironmentRegions = sRegions;
}

// A new area: its regions are its own again.
EMSCRIPTEN_KEEPALIVE void studio_assets_area_reset(void) {
    sWaterCount = 0;
    if (gEnvironmentRegions == sRegions) {
        gEnvironmentRegions = sBaseRegions;
    }
    sBaseRegions = NULL;
    studio_tex_seen_reset();
}

// ---------------------------------------------------------------------------
// Custom block and terrain materials: material indices 48..63, 32x32 RGBA16
// (the renderer format); a sharper image can be laid over with studio_tex_set.

static u8 *sCustomMat[ASSET_CUSTOM_MATERIALS];

EMSCRIPTEN_KEEPALIVE u8 *studio_material_custom(s32 i, const u8 *rgba16) {
    if (i < 0 || i >= ASSET_CUSTOM_MATERIALS) {
        return NULL;
    }
    if (rgba16 == NULL) {
        if (sCustomMat[i] != NULL) {
            studio_tex_unset(sCustomMat[i], FALSE);
            // kept allocated: blocks may still point at it; shows as plain until set again
            memset(sCustomMat[i], 0xFF, 2048);
        }
        gfx_texture_cache_flush();
        return sCustomMat[i];
    }
    if (sCustomMat[i] == NULL) {
        sCustomMat[i] = malloc(2048);
        own_texture(sCustomMat[i]);
    }
    memcpy(sCustomMat[i], rgba16, 2048);
    gfx_texture_cache_flush();
    return sCustomMat[i];
}

const u8 *studio_custom_material_texels(s32 index) {
    s32 i = index - ASSET_CUSTOM_MATERIAL_BASE;
    return (i >= 0 && i < ASSET_CUSTOM_MATERIALS) ? sCustomMat[i] : NULL;
}

// ---------------------------------------------------------------------------
// Custom skybox: 8x8 tiles of 32x32 RGBA16 (the game's layout, 31 texels per tile
// plus one of overlap) shown instead of whatever background the area uses.

extern const u8 *const (*sSkyboxTextures[10])[80];
static const u8 *sCustomSkyList[80];
static u8 *sCustomSkyTiles;
static const u8 *const (*sSkySaved[10])[80];
static s32 sSkyActive;

EMSCRIPTEN_KEEPALIVE u8 *studio_sky_buffer(void) {
    s32 i;
    if (sCustomSkyTiles == NULL) {
        sCustomSkyTiles = calloc(64, 2048);
        for (i = 0; i < 64; i++) {
            own_texture(sCustomSkyTiles + i * 2048);
        }
    }
    return sCustomSkyTiles;
}

EMSCRIPTEN_KEEPALIVE void studio_sky_apply(s32 on) {
    s32 i;
    if (on) {
        u8 *tiles = studio_sky_buffer();
        for (i = 0; i < 80; i++) {
            s32 row = i / 10, col = (i % 10) % 8;
            sCustomSkyList[i] = tiles + (row * 8 + col) * 2048;
        }
        if (!sSkyActive) {
            memcpy(sSkySaved, sSkyboxTextures, sizeof(sSkySaved));
        }
        for (i = 0; i < 10; i++) {
            sSkyboxTextures[i] = (const u8 *const (*)[80]) sCustomSkyList;
        }
        sSkyActive = TRUE;
    } else if (sSkyActive) {
        memcpy(sSkyboxTextures, sSkySaved, sizeof(sSkySaved));
        sSkyActive = FALSE;
    }
    gfx_texture_cache_flush();
}

EMSCRIPTEN_KEEPALIVE s32 studio_sky_active(void) {
    return sSkyActive;
}

// ---------------------------------------------------------------------------
// Mario's colours: the light groups of his model (found through his display lists),
// with the cap and the gloves split off into lights of their own.

extern const Gfx mario_butt[], mario_left_arm[], mario_left_foot[], mario_face_cap_on_dl[],
    mario_cap_on_eyes_front[], mario_low_poly_face_cap_on_dl[], mario_cap_unused_dl[], mario_right_hand_cap[],
    mario_left_hand_closed[], mario_right_hand_closed[], mario_medium_poly_left_hand_closed[],
    mario_medium_poly_right_hand_closed[], mario_low_poly_left_hand_closed[], mario_low_poly_right_hand_closed[],
    mario_left_hand_open[], mario_right_hand_open[], mario_right_hand_cap_dl[], mario_right_hand_peace[],
    mario_cap_seg3_dl_03022F48[];

static u8 sGloveLights[24] __attribute__((aligned(8)));
static u8 *sMarioLights[ASSET_MARIO_PARTS];
static u8 sMarioDefault[ASSET_MARIO_PARTS][3];
static s32 sMarioReady;

#define GFX_OP(c) ((u32) ((c)->words.w0 >> 24) & 0xFF)

// The first light (diffuse) a display list sets; its group starts 8 bytes before.
static u8 *first_light(const Gfx *dl) {
    s32 n;
    for (n = 0; n < 400; n++, dl++) {
        u32 op = GFX_OP(dl);
        if (op == G_MOVEMEM) {
            uintptr_t a = dl->words.w1, b = dl[1].words.w1;
            if (GFX_OP(&dl[1]) == G_MOVEMEM && b < a) {
                return (u8 *) b; // .l then .a: .a is the start of the group
            }
            return (u8 *) a - 8;
        }
        if (op == G_ENDDL) break;
    }
    return NULL;
}

// Point every use of the lights `from` (group start) in dl, and the lists it calls, at `to`.
static void repoint_lights(const Gfx *dl, u8 *from, u8 *to, s32 depth) {
    s32 n;
    Gfx *g = (Gfx *) dl;
    if (dl == NULL || from == NULL || depth > 6) return;
    for (n = 0; n < 2000; n++, g++) {
        u32 op = GFX_OP(g);
        if (op == G_MOVEMEM) {
            if (g->words.w1 == (uintptr_t) from) g->words.w1 = (uintptr_t) to;
            else if (g->words.w1 == (uintptr_t) (from + 8)) g->words.w1 = (uintptr_t) (to + 8);
        } else if (op == G_DL) {
            repoint_lights((const Gfx *) g->words.w1, from, to, depth + 1);
            if (((g->words.w0 >> 16) & 0xFF) == G_DL_NOPUSH) break;
        } else if (op == G_ENDDL) {
            break;
        }
    }
}

static void mario_lights_init(void) {
    s32 i;
    u8 *red, *white;
    static const Gfx *hands[] = { mario_left_hand_closed, mario_right_hand_closed, mario_medium_poly_left_hand_closed,
                                  mario_medium_poly_right_hand_closed, mario_low_poly_left_hand_closed,
                                  mario_low_poly_right_hand_closed, mario_left_hand_open, mario_right_hand_open,
                                  mario_right_hand_cap_dl, mario_right_hand_peace };
    static const Gfx *caps[] = { mario_face_cap_on_dl, mario_low_poly_face_cap_on_dl, mario_cap_unused_dl,
                                 mario_right_hand_cap };
    if (sMarioReady) return;
    sMarioReady = TRUE;
    sMarioLights[ASSET_MARIO_OVERALLS] = first_light(mario_butt);
    sMarioLights[ASSET_MARIO_SHIRT] = red = first_light(mario_left_arm);
    sMarioLights[ASSET_MARIO_SHOES] = first_light(mario_left_foot);
    sMarioLights[ASSET_MARIO_SKIN] = first_light(mario_cap_on_eyes_front);
    white = first_light(mario_left_hand_closed);
    // the hair: the second group of the cap-on face (the first is the cap's red)
    {
        const Gfx *dl = mario_face_cap_on_dl;
        s32 n;
        for (n = 0; n < 400 && GFX_OP(dl) != G_ENDDL; n++, dl++) {
            if (GFX_OP(dl) == G_MOVEMEM) {
                u8 *p = (u8 *) dl->words.w1;
                if (p != red && p != red + 8 && sMarioLights[ASSET_MARIO_HAIR] == NULL) {
                    sMarioLights[ASSET_MARIO_HAIR] = p - 8; // .l comes first in these lists
                }
            }
        }
    }
    // the cap: Mario's cap object has a red of its own; the cap on his head and in his hand use it too
    sMarioLights[ASSET_MARIO_CAP] = first_light(mario_cap_seg3_dl_03022F48);
    if (sMarioLights[ASSET_MARIO_CAP] != NULL) {
        for (i = 0; i < (s32) (sizeof(caps) / sizeof(caps[0])); i++) {
            repoint_lights(caps[i], red, sMarioLights[ASSET_MARIO_CAP], 0);
        }
    }
    // the gloves: white is also the wings and metal Mario, so the hands get their own
    if (white != NULL) {
        memcpy(sGloveLights, white, 24);
        for (i = 0; i < (s32) (sizeof(hands) / sizeof(hands[0])); i++) {
            repoint_lights(hands[i], white, sGloveLights, 0);
        }
        sMarioLights[ASSET_MARIO_GLOVES] = sGloveLights;
    }
    for (i = 0; i < ASSET_MARIO_PARTS; i++) {
        if (sMarioLights[i] != NULL) {
            memcpy(sMarioDefault[i], sMarioLights[i] + 8, 3);
        }
    }
}

// Set a part's colour (rgb 0xRRGGBB); shade: how dark the shadow side gets (0..255, 128 = game default).
EMSCRIPTEN_KEEPALIVE s32 studio_mario_color(s32 part, s32 rgb, s32 shade) {
    u8 *l;
    u8 c[3];
    s32 k;
    mario_lights_init();
    if (part < 0 || part >= ASSET_MARIO_PARTS || (l = sMarioLights[part]) == NULL) {
        return 0;
    }
    if (rgb < 0) {
        memcpy(c, sMarioDefault[part], 3);
    } else {
        c[0] = (rgb >> 16) & 0xFF;
        c[1] = (rgb >> 8) & 0xFF;
        c[2] = rgb & 0xFF;
    }
    if (shade <= 0) shade = 128;
    for (k = 0; k < 3; k++) {
        u8 amb = (u8) ((c[k] * shade) >> 8);
        l[k] = amb;      // ambient
        l[4 + k] = amb;
        l[8 + k] = c[k]; // diffuse
        l[12 + k] = c[k];
    }
    return 1;
}

// The game's colour of a part (0xRRGGBB), for the editor's reset button.
EMSCRIPTEN_KEEPALIVE s32 studio_mario_default_color(s32 part) {
    mario_lights_init();
    if (part < 0 || part >= ASSET_MARIO_PARTS || sMarioLights[part] == NULL) {
        return -1;
    }
    return (sMarioDefault[part][0] << 16) | (sMarioDefault[part][1] << 8) | sMarioDefault[part][2];
}
