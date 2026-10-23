// Studio 64 world editing: level settings (sky, music, water, spawn), sculptable
// heightmap terrain, sculpting the original levels' own geometry, and custom stars.

#include <ultra64.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#endif

#include "sm64.h"
#include "types.h"
#include "level_table.h"
#include "behavior_data.h"
#include "surface_terrains.h"
#include "engine/graph_node.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/area.h"
#include "game/level_update.h"
#include "game/object_list_processor.h"
#include "game/object_helpers.h"
#include "game/sound_init.h"
#include "game/macro_special_objects.h"
#include "game/save_file.h"
#include "studio.h"
#include "studio_assets.h"
#include "shoggoth/tokyo.h"

struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams);
const u8 *studio_material_texels(s32 i, s32 side);
s32 studio_material_count(void);

// ---------------------------------------------------------------------------
// Graph helpers

static void walk_graph(struct GraphNode *first, void (*fn)(struct GraphNode *, void *), void *arg) {
    struct GraphNode *n = first;
    if (n == NULL) {
        return;
    }
    do {
        fn(n, arg);
        // never descend into the object list: those are shared object models
        if (n->children != NULL && n->type != GRAPH_NODE_TYPE_OBJECT_PARENT) {
            walk_graph(n->children, fn, arg);
        }
        n = n->next;
    } while (n != first && n != NULL);
}

// ---------------------------------------------------------------------------
// Level settings

static void set_background_fn(struct GraphNode *n, void *arg) {
    if (n->type == GRAPH_NODE_TYPE_BACKGROUND) {
        struct GraphNodeBackground *bg = (struct GraphNodeBackground *) n;
        if (bg->fnNode.func != NULL) {
            bg->background = *(s32 *) arg;
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_set_sky(s32 background) {
    if (gCurrentArea != NULL && gCurrentArea->unk04 != NULL) {
        walk_graph(&gCurrentArea->unk04->node, set_background_fn, &background);
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_set_music(s32 seq) {
    if (seq >= 0) {
        // also the area's own music, which the level (re)starts after loading
        if (gCurrentArea != NULL) {
            gCurrentArea->musicParam2 = seq;
        }
        set_background_music(0, seq, 0);
    }
}

static s16 sWater[] = { 1, 0, -16000, -16000, 16000, 16000, 0 };
static s32 sWaterOn;

static void apply_water(void) {
    if (sWaterOn) {
        gEnvironmentRegions = sWater;
        gEnvironmentLevels[0] = sWater[6];
    }
}

// One big water box for the studio level (swimming works below `height`).
EMSCRIPTEN_KEEPALIVE
void studio_set_water(s32 enabled, s32 height) {
    sWaterOn = enabled;
    sWater[6] = height;
    if (enabled) {
        apply_water();
    } else if (gEnvironmentRegions == sWater) {
        gEnvironmentRegions = NULL;
    }
}

// Move the level entry point (warp node 0x0A) so Mario starts there.
EMSCRIPTEN_KEEPALIVE
s32 studio_set_spawn(f32 x, f32 y, f32 z, s32 yaw) {
    s32 i, n = 0;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *o = &gObjectPool[i];
        if ((o->activeFlags & ACTIVE_FLAG_ACTIVE) && o->oBehParams2ndByte == 0x0A
            && (o->behavior == bhvSpinAirborneWarp || o->behavior == bhvInstantActiveWarp
                || o->behavior == bhvAirborneWarp || o->behavior == bhvWarp)) {
            o->oPosX = x;
            o->oPosY = y;
            o->oPosZ = z;
            o->oMoveAngleYaw = o->oFaceAngleYaw = yaw;
            n++;
        }
    }
    return n;
}

s32 gStudioForceReload;

// How the next level entry shows its star select screen (STUDIO_INTRO_*).
s32 gStudioIntroMode = STUDIO_INTRO_GAME;
s32 gStudioInIntro;

// Fast level change; `force` reloads even the level we are in (custom levels share one slot).
// intro: STUDIO_INTRO_JUMP shows the level's stars and goes on by itself,
// STUDIO_INTRO_NONE goes straight in (act picks the act of a course).
EMSCRIPTEN_KEEPALIVE
void studio_warp_fast(s32 level, s32 area, s32 node, s32 act, s32 force, s32 intro) {
    extern s32 gStudioAutoAct;
    gStudioAutoAct = act;
    gStudioForceReload = force;
    gStudioIntroMode = intro;
    studio_warp_to(level, area, node);
}

// ---------------------------------------------------------------------------
// Heightmap terrain. Heights are world Y per grid point; materials per cell.
// Drawn as chunk objects, collision is part of the static level collision.

#define MAX_TERRAINS 4
#define TCH 16

struct StudioTerrain {
    s32 used, id, nx, nz;
    f32 cell, x0, z0;
    s16 *h;
    u8 *m;
    s32 chunksX, chunksZ;
    struct Object **objs;
    struct GraphNode **nodes;
    Gfx **dl;
    Vtx **vtx;
};
static struct StudioTerrain sTerrains[MAX_TERRAINS];

static struct StudioTerrain *terrain_by_id(s32 id) {
    s32 i;
    for (i = 0; i < MAX_TERRAINS; i++) {
        if (sTerrains[i].used && sTerrains[i].id == id) {
            return &sTerrains[i];
        }
    }
    return NULL;
}

static void terrain_free(struct StudioTerrain *t) {
    s32 i;
    for (i = 0; i < t->chunksX * t->chunksZ; i++) {
        if (t->objs[i] != NULL && (t->objs[i]->activeFlags & ACTIVE_FLAG_ACTIVE)
            && t->objs[i]->behavior == bhvStudioTerrain) {
            obj_mark_for_deletion(t->objs[i]);
        }
        free(t->dl[i]);
        free(t->vtx[i]);
        // graph nodes are leaked on purpose: a deleted object may still point at them this frame
    }
    free(t->h);
    free(t->m);
    free(t->objs);
    free(t->nodes);
    free(t->dl);
    free(t->vtx);
    memset(t, 0, sizeof(*t));
}

EMSCRIPTEN_KEEPALIVE
void studio_terrain_destroy(s32 id) {
    struct StudioTerrain *t = terrain_by_id(id);
    if (t != NULL) {
        terrain_free(t);
    }
}

// Forget all terrains (their chunk objects die with the area).
void studio_terrain_reset(void) {
    s32 i;
    for (i = 0; i < MAX_TERRAINS; i++) {
        if (sTerrains[i].used) {
            memset(sTerrains[i].objs, 0, sizeof(struct Object *) * sTerrains[i].chunksX * sTerrains[i].chunksZ);
            terrain_free(&sTerrains[i]);
        }
    }
}

// Returns a pointer to the (nx+1)*(nz+1) heights; materials follow via studio_terrain_mats.
EMSCRIPTEN_KEEPALIVE
s16 *studio_terrain_create(s32 id, s32 nx, s32 nz, f32 cell, f32 x0, f32 z0) {
    struct StudioTerrain *t = terrain_by_id(id);
    s32 i;
    if (t != NULL) {
        terrain_free(t);
    }
    for (i = 0; i < MAX_TERRAINS && t == NULL; i++) {
        if (!sTerrains[i].used) {
            t = &sTerrains[i];
        }
    }
    if (t == NULL || nx < 1 || nz < 1 || nx > 256 || nz > 256) {
        return NULL;
    }
    t->used = TRUE;
    t->id = id;
    t->nx = nx;
    t->nz = nz;
    t->cell = cell;
    t->x0 = x0;
    t->z0 = z0;
    t->h = calloc((nx + 1) * (nz + 1), sizeof(s16));
    t->m = calloc(nx * nz, 1);
    t->chunksX = (nx + TCH - 1) / TCH;
    t->chunksZ = (nz + TCH - 1) / TCH;
    t->objs = calloc(t->chunksX * t->chunksZ, sizeof(struct Object *));
    t->nodes = calloc(t->chunksX * t->chunksZ, sizeof(struct GraphNode *));
    t->dl = calloc(t->chunksX * t->chunksZ, sizeof(Gfx *));
    t->vtx = calloc(t->chunksX * t->chunksZ, sizeof(Vtx *));
    return t->h;
}

EMSCRIPTEN_KEEPALIVE
u8 *studio_terrain_mats(s32 id) {
    struct StudioTerrain *t = terrain_by_id(id);
    return t != NULL ? t->m : NULL;
}

#define TH(t, i, j) ((t)->h[(j) * ((t)->nx + 1) + (i)])

// Diagonal choice shared by drawing and collision: split along the flatter diagonal.
static s32 cell_diag_ac(struct StudioTerrain *t, s32 i, s32 j) {
    s32 a = TH(t, i, j), b = TH(t, i + 1, j), c = TH(t, i + 1, j + 1), d = TH(t, i, j + 1);
    return abs(a - c) <= abs(b - d);
}

// Smooth value noise in [-1, 1] over the grid (for color variation).
static f32 grid_hash(s32 x, s32 y, s32 seed) {
    u32 h = (u32) x * 374761393u + (u32) y * 668265263u + (u32) seed * 2246822519u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return ((h ^ (h >> 16)) & 0xFFFF) / 32767.5f - 1.0f;
}

static f32 grid_noise(f32 x, f32 y, s32 seed) {
    s32 xi = (s32) floorf(x), yi = (s32) floorf(y);
    f32 u = x - xi, v = y - yi;
    f32 a = grid_hash(xi, yi, seed), b = grid_hash(xi + 1, yi, seed);
    f32 c = grid_hash(xi, yi + 1, seed), d = grid_hash(xi + 1, yi + 1, seed);
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Vertex color of a grid point: the sun on its slope, darker in hollows and
// lighter on ridges, and a gentle, large-scale brightness and warmth variation
// so wide areas of one material don't look like flat tiles.
static void terrain_color(struct StudioTerrain *t, s32 i, s32 j, u8 *rgb) {
    s32 i0 = i > 0 ? i - 1 : i, i1 = i < t->nx ? i + 1 : i;
    s32 j0 = j > 0 ? j - 1 : j, j1 = j < t->nz ? j + 1 : j;
    f32 h = TH(t, i, j);
    f32 nx = (TH(t, i0, j) - TH(t, i1, j)) / (t->cell * (i1 - i0));
    f32 nz = (TH(t, i, j0) - TH(t, i, j1)) / (t->cell * (j1 - j0));
    f32 len = sqrtf(nx * nx + 1.0f + nz * nz);
    // the area's sun (flow.c; default from up and slightly south-east)
    f32 l = (nx * gStudioSunDir[0] + gStudioSunDir[1] + nz * gStudioSunDir[2]) / len;
    // curvature, scaled so the same landform darkens alike at any cell size
    f32 lap = ((TH(t, i0, j) + TH(t, i1, j) + TH(t, i, j0) + TH(t, i, j1)) * 0.25f - h) * (16384.0f / (t->cell * t->cell));
    f32 wx = t->x0 + i * t->cell, wz = t->z0 + j * t->cell;
    f32 ao = 1.0f - lap / 520.0f;
    f32 shade, bright, warm, c[3];
    s32 k;
    if (l < 0) l = 0;
    if (ao < 0.68f) ao = 0.68f;
    if (ao > 1.1f) ao = 1.1f;
    bright = grid_noise(wx / 640.0f, wz / 640.0f, 11) * 0.6f + grid_noise(wx / 220.0f, wz / 220.0f, 12) * 0.4f;
    warm = grid_noise(wx / 900.0f, wz / 900.0f, 13);
    shade = ao * (1.0f + bright * 0.09f);
    c[0] = shade * (gStudioAmbient + (1.0f - gStudioAmbient) * l * gStudioSunColor[0]) * (1.0f + warm * 0.07f);
    c[1] = shade * (gStudioAmbient + (1.0f - gStudioAmbient) * l * gStudioSunColor[1]) * (1.0f + warm * 0.02f);
    c[2] = shade * (gStudioAmbient + (1.0f - gStudioAmbient) * l * gStudioSunColor[2]) * (1.0f - warm * 0.08f);
    for (k = 0; k < 3; k++) {
        f32 v = c[k] * 255.0f;
        rgb[k] = (u8) (v > 255.0f ? 255.0f : (v < 0 ? 0 : v));
    }
}

static void terrain_build_chunk(struct StudioTerrain *t, s32 cx, s32 cz) {
    s32 idx = cz * t->chunksX + cx;
    s32 i0 = cx * TCH, j0 = cz * TCH;
    s32 i1 = i0 + TCH < t->nx ? i0 + TCH : t->nx;
    s32 j1 = j0 + TCH < t->nz ? j0 + TCH : t->nz;
    f32 ox = t->x0 + (i0 + i1) * 0.5f * t->cell, oz = t->z0 + (j0 + j1) * 0.5f * t->cell;
    s32 cells = (i1 - i0) * (j1 - j0);
    s32 mat, i, j, vi = 0, ymin = 32767, ymax = -32768;
    Gfx *g;
    Vtx *v;
    u8 present[64];

    free(t->dl[idx]);
    free(t->vtx[idx]);
    t->vtx[idx] = v = calloc(cells * 4, sizeof(Vtx));
    t->dl[idx] = g = calloc(16 + cells * 4 + 64 * 12, sizeof(Gfx));
    memset(present, 0, sizeof(present));
    for (j = j0; j < j1; j++) {
        for (i = i0; i < i1; i++) {
            present[t->m[j * t->nx + i] & 63] = 1;
        }
    }

    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_MODULATERGB, G_CC_MODULATERGB);
    gSPClearGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
    for (mat = 0; mat < 64; mat++) {
        s32 batch = 0, batchStart = vi;
        if (!present[mat] || studio_material_texels(mat, 0) == NULL) { // custom materials: 48..63
            continue;
        }
        gDPLoadTextureBlock(g++, studio_material_texels(mat, 0), G_IM_FMT_RGBA, G_IM_SIZ_16b, 32, 32, 0,
                            G_TX_WRAP | G_TX_NOMIRROR, G_TX_WRAP | G_TX_NOMIRROR, 5, 5, G_TX_NOLOD, G_TX_NOLOD);
        for (j = j0; j < j1; j++) {
            for (i = i0; i < i1; i++) {
                s32 k, corner[4][2] = { { i, j }, { i + 1, j }, { i + 1, j + 1 }, { i, j + 1 } };
                s32 ha = TH(t, i, j), hb = TH(t, i + 1, j), hc = TH(t, i + 1, j + 1), hd = TH(t, i, j + 1);
                f32 slopeX = ((hb + hc) - (ha + hd)) * 0.5f / t->cell;
                f32 slopeZ = ((hc + hd) - (ha + hb)) * 0.5f / t->cell;
                // steep cells take the texture from the side (u along the wall, v down it),
                // so cliffs show rock instead of one texel stretched over the whole drop
                s32 wall = fabsf(slopeX) > 0.9f || fabsf(slopeZ) > 0.9f;
                s32 wallAlongZ = fabsf(slopeX) >= fabsf(slopeZ);
                s32 ylo = ha < hb ? ha : hb;
                if (hc < ylo) ylo = hc;
                if (hd < ylo) ylo = hd;
                ylo = (s32) floorf(ylo / 256.0f) * 256; // a multiple of the repeat keeps neighbors in phase
                if ((t->m[j * t->nx + i] & 63) != mat) {
                    continue;
                }
                for (k = 0; k < 4; k++) {
                    s32 ci = corner[k][0], cj = corner[k][1];
                    s32 y = TH(t, ci, cj);
                    f32 tv;
                    Vtx *p = &v[vi + k];
                    p->v.ob[0] = (s16) (t->x0 + ci * t->cell - ox);
                    p->v.ob[1] = (s16) y;
                    p->v.ob[2] = (s16) (t->z0 + cj * t->cell - oz);
                    // 256 world units per texture repeat, chunk-local so it never overflows
                    if (wall) {
                        p->v.tc[0] = (s16) ((wallAlongZ ? cj - j0 : ci - i0) * t->cell * 4.0f);
                        tv = (ylo - y) * 4.0f;
                        p->v.tc[1] = (s16) (tv < -32000.0f ? -32000.0f : tv);
                    } else {
                        p->v.tc[0] = (s16) ((ci - i0) * t->cell * 4.0f);
                        p->v.tc[1] = (s16) ((cj - j0) * t->cell * 4.0f);
                    }
                    terrain_color(t, ci, cj, p->v.cn);
                    p->v.cn[3] = 255;
                    if (y < ymin) ymin = y;
                    if (y > ymax) ymax = y;
                }
                vi += 4;
                batch++;
                if (batch == 16) {
                    s32 q;
                    gSPVertex(g++, &v[batchStart], 64, 0);
                    for (q = 0; q < 16; q++) {
                        s32 b = q * 4;
                        // matches the collision split (cell_diag_ac is re-derived from the corner heights)
                        Vtx *c4 = &v[batchStart + b];
                        if (abs(c4[0].v.ob[1] - c4[2].v.ob[1]) <= abs(c4[1].v.ob[1] - c4[3].v.ob[1])) {
                            gSP2Triangles(g++, b, b + 3, b + 2, 0, b, b + 2, b + 1, 0);
                        } else {
                            gSP2Triangles(g++, b, b + 3, b + 1, 0, b + 1, b + 3, b + 2, 0);
                        }
                    }
                    batch = 0;
                    batchStart = vi;
                }
            }
        }
        if (batch > 0) {
            s32 q;
            gSPVertex(g++, &v[batchStart], batch * 4, 0);
            for (q = 0; q < batch; q++) {
                s32 b = q * 4;
                Vtx *c4 = &v[batchStart + b];
                if (abs(c4[0].v.ob[1] - c4[2].v.ob[1]) <= abs(c4[1].v.ob[1] - c4[3].v.ob[1])) {
                    gSP2Triangles(g++, b, b + 3, b + 2, 0, b, b + 2, b + 1, 0);
                } else {
                    gSP2Triangles(g++, b, b + 3, b + 1, 0, b + 1, b + 3, b + 2, 0);
                }
            }
        }
    }
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPEndDisplayList(g++);

    // culling radius around the chunk center, so big chunks don't pop out of view
    if (t->nodes[idx] == NULL) {
        struct GraphNodeCullingRadius *cr = init_graph_node_culling_radius(NULL, malloc(sizeof(struct GraphNodeCullingRadius)), 1000);
        struct GraphNodeDisplayList *dn = init_graph_node_display_list(NULL, malloc(sizeof(struct GraphNodeDisplayList)), LAYER_OPAQUE, t->dl[idx]);
        geo_add_child(&cr->node, &dn->node);
        t->nodes[idx] = &cr->node;
    }
    {
        struct GraphNodeCullingRadius *cr = (struct GraphNodeCullingRadius *) t->nodes[idx];
        struct GraphNodeDisplayList *dn = (struct GraphNodeDisplayList *) cr->node.children;
        f32 half = TCH * t->cell * 0.75f;
        f32 span = (abs(ymin) > abs(ymax) ? abs(ymin) : abs(ymax)) + half;
        dn->displayList = t->dl[idx];
        cr->cullingRadius = (s16) (span > 30000 ? 30000 : span);
    }
    if (t->objs[idx] == NULL || !(t->objs[idx]->activeFlags & ACTIVE_FLAG_ACTIVE)
        || t->objs[idx]->behavior != bhvStudioTerrain) {
        t->objs[idx] = studio_spawn_raw(bhvStudioTerrain, t->nodes[idx], ox, 0, oz, 0, 0, 0, 0);
        if (t->objs[idx] != NULL) {
            t->objs[idx]->oDrawingDistance = 30000.0f;
        }
    }
}

// Surface type of a terrain material (lava burns, ice slides).
static s16 material_surface(u8 m) {
    switch (m) {
        case 20: return SURFACE_BURNING;
        case 19: return SURFACE_VERY_SLIPPERY;
        case 18: return SURFACE_NOISE_DEFAULT;
        default: return SURFACE_DEFAULT;
    }
}

static void add_terrain_surfaces(void) {
    s32 k, i, j;
    for (k = 0; k < MAX_TERRAINS; k++) {
        struct StudioTerrain *t = &sTerrains[k];
        if (!t->used) {
            continue;
        }
        for (j = 0; j < t->nz; j++) {
            for (i = 0; i < t->nx; i++) {
                s16 ax = t->x0 + i * t->cell, bx = t->x0 + (i + 1) * t->cell;
                s16 az = t->z0 + j * t->cell, dz = t->z0 + (j + 1) * t->cell;
                s16 a[3] = { ax, TH(t, i, j), az }, b[3] = { bx, TH(t, i + 1, j), az };
                s16 c[3] = { bx, TH(t, i + 1, j + 1), dz }, d[3] = { ax, TH(t, i, j + 1), dz };
                s16 type = material_surface(t->m[j * t->nx + i] & 63);
                if (cell_diag_ac(t, i, j)) {
                    studio_add_static_tri(a, d, c, type);
                    studio_add_static_tri(a, c, b, type);
                } else {
                    studio_add_static_tri(a, d, b, type);
                    studio_add_static_tri(b, d, c, type);
                }
            }
        }
    }
}

// terrain plus imported models (src/studio/assets.c)
static void add_static_extras(void) {
    add_terrain_surfaces();
    studio_assets_add_surfaces();
    studio_tokyo_add_surfaces(); // Shoggoth World's Tokyo (shoggoth/tokyo.c)
}

EMSCRIPTEN_KEEPALIVE
void studio_rebuild_collision(void) {
    if (gCurrentArea != NULL) {
        studio_rebuild_static_surfaces(add_static_extras);
        apply_water();
        studio_tokyo_apply_water();
        studio_assets_apply_water();
        studio_env_boxes_apply(); // water and gas boxes (flow.c)
    }
}

// Rebuild the drawn chunks touching cells [i0,i1]x[j0,j1] (all with i1 < 0), then collision.
EMSCRIPTEN_KEEPALIVE
void studio_terrain_build(s32 id, s32 i0, s32 j0, s32 i1, s32 j1, s32 collision) {
    struct StudioTerrain *t = terrain_by_id(id);
    s32 cx, cz;
    if (t == NULL) {
        return;
    }
    if (i1 < 0) {
        i0 = j0 = 0;
        i1 = t->nx;
        j1 = t->nz;
    }
    for (cz = j0 / TCH; cz <= j1 / TCH && cz < t->chunksZ; cz++) {
        for (cx = i0 / TCH; cx <= i1 / TCH && cx < t->chunksX; cx++) {
            if (cx >= 0 && cz >= 0) {
                terrain_build_chunk(t, cx, cz);
            }
        }
    }
    if (collision) {
        studio_rebuild_collision();
    }
}

// ---------------------------------------------------------------------------
// Sculpting the original level geometry. The first sculpt in an area copies its
// level display lists and its collision into editable triangle lists; brushes
// then subdivide the triangles they touch (per edge, so the mesh stays watertight)
// and move vertices. The originals are never touched: restoring means dropping
// the copies, and the page replays the saved strokes after every load.

#define TESS_MAX_TRIS 400000

struct TessRun {           // consecutive triangles between state changes
    Vtx *tri;              // 3 per triangle
    s32 count, cap;
    s32 lit;               // cn holds normals (lighting on), else colors
};

struct TessCmd {
    s32 run;               // -1: raw command, else index of a run
    Gfx g;
};

struct TessDL {
    const Gfx *orig;
    Gfx *prevOut;          // the copy the graph pointed at before the last regeneration
    Vtx *prevOutV;
    struct TessCmd *cmds;
    s32 ncmds, capCmds;
    struct TessRun *runs;
    s32 nruns, capRuns;
    Gfx *out;
    Vtx *outV;
    s32 dirty;
};

struct CTri {
    s16 v[3][3];
    s16 type, force;
    s8 room;
};

struct TessArea {
    void *key;             // the area's original collision data (stable across reloads)
    s8 *keyRooms;          // and its original surface rooms (put back by studio_sculpt_restore)
    struct TessDL *dls;
    s32 ndls, capDls;
    struct CTri *ct;
    s32 nct, capCt;
    s16 *env;              // copy of the environment (water) block, or NULL
    s32 envLen;
    s16 *colOut;           // generated collision data
    s8 *roomsOut;
    s32 hasRooms;
    s32 colDirty;
    s32 totalTris;
};

#define MAX_TESS_AREAS 6
static struct TessArea sTess[MAX_TESS_AREAS];
static struct TessArea *sTessCur;

// ---- parsing display lists ----

struct ParseState {
    struct TessDL *d;
    Vtx buf[64];
    s32 lit;
    s32 curRun;
};

static void tdl_raw(struct TessDL *d, const Gfx *g) {
    if (d->ncmds == d->capCmds) {
        d->capCmds = d->capCmds ? d->capCmds * 2 : 64;
        d->cmds = realloc(d->cmds, d->capCmds * sizeof(struct TessCmd));
    }
    d->cmds[d->ncmds].run = -1;
    d->cmds[d->ncmds].g = *g;
    d->ncmds++;
}

static void run_push(struct TessRun *r, Vtx *a, Vtx *b, Vtx *c) {
    if (r->count == r->cap) {
        r->cap = r->cap ? r->cap * 2 : 32;
        r->tri = realloc(r->tri, r->cap * 3 * sizeof(Vtx));
    }
    r->tri[r->count * 3] = *a;
    r->tri[r->count * 3 + 1] = *b;
    r->tri[r->count * 3 + 2] = *c;
    r->count++;
}

static void tdl_tri(struct ParseState *ps, s32 a, s32 b, s32 c) {
    struct TessDL *d = ps->d;
    if (a > 63 || b > 63 || c > 63) {
        return;
    }
    if (ps->curRun < 0) {
        if (d->nruns == d->capRuns) {
            d->capRuns = d->capRuns ? d->capRuns * 2 : 16;
            d->runs = realloc(d->runs, d->capRuns * sizeof(struct TessRun));
        }
        memset(&d->runs[d->nruns], 0, sizeof(struct TessRun));
        d->runs[d->nruns].lit = ps->lit;
        if (d->ncmds == d->capCmds) {
            d->capCmds = d->capCmds ? d->capCmds * 2 : 64;
            d->cmds = realloc(d->cmds, d->capCmds * sizeof(struct TessCmd));
        }
        d->cmds[d->ncmds].run = d->nruns;
        d->ncmds++;
        ps->curRun = d->nruns++;
    }
    run_push(&d->runs[ps->curRun], &ps->buf[a], &ps->buf[b], &ps->buf[c]);
}

static s32 parse_dl(struct ParseState *ps, const Gfx *dl, s32 depth) {
    s32 guard;
    if (dl == NULL || depth > 10) {
        return FALSE;
    }
    for (guard = 0; guard < 200000; guard++, dl++) {
        u8 op = (u8) ((dl->words.w0 >> 24) & 0xFF);
        if (op == (u8) G_VTX) {
            s32 n = (dl->words.w0 >> 12) & 0xFF;
            s32 v0 = ((dl->words.w0 >> 1) & 0x7F) - n, k;
            Vtx *v = (Vtx *) dl->words.w1;
            for (k = 0; k < n && v0 + k < 64 && v0 + k >= 0; k++) {
                ps->buf[v0 + k] = v[k];
            }
        } else if (op == (u8) G_TRI1) {
            tdl_tri(ps, ((dl->words.w0 >> 16) & 0xFF) / 2, ((dl->words.w0 >> 8) & 0xFF) / 2, (dl->words.w0 & 0xFF) / 2);
        } else if (op == (u8) G_TRI2) {
            tdl_tri(ps, ((dl->words.w0 >> 16) & 0xFF) / 2, ((dl->words.w0 >> 8) & 0xFF) / 2, (dl->words.w0 & 0xFF) / 2);
            tdl_tri(ps, ((dl->words.w1 >> 16) & 0xFF) / 2, ((dl->words.w1 >> 8) & 0xFF) / 2, (dl->words.w1 & 0xFF) / 2);
        } else if (op == (u8) G_DL) {
            s32 branch = ((dl->words.w0 >> 16) & 0xFF) == G_DL_NOPUSH;
            parse_dl(ps, (const Gfx *) dl->words.w1, depth + 1);
            if (branch) {
                return TRUE;
            }
        } else if (op == (u8) G_ENDDL) {
            return TRUE;
        } else if (op == (u8) G_CULLDL) {
            // refers to loaded vertex indices, which the rebuilt list renumbers
        } else {
            if (op == (u8) G_GEOMETRYMODE) {
                u32 clear = ~(u32) (dl->words.w0 & 0xFFFFFF), set = (u32) dl->words.w1;
                if (clear & G_LIGHTING) ps->lit = FALSE;
                if (set & G_LIGHTING) ps->lit = TRUE;
            }
            ps->curRun = -1; // state changed: following triangles start a new run
            tdl_raw(ps->d, dl);
        }
    }
    return TRUE;
}

// ---- collision copy ----

static void ct_push(struct TessArea *t, struct CTri *c) {
    if (t->nct == t->capCt) {
        t->capCt = t->capCt ? t->capCt * 2 : 1024;
        t->ct = realloc(t->ct, t->capCt * sizeof(struct CTri));
    }
    t->ct[t->nct++] = *c;
}

static void parse_collision(struct TessArea *t, s16 *data, s8 *rooms) {
    s16 *verts = NULL;
    t->hasRooms = rooms != NULL;
    while (data != NULL) {
        s16 type = *data++;
        if (type == TERRAIN_LOAD_VERTICES) {
            s32 n = *data++;
            verts = data;
            data += n * 3;
        } else if (type == TERRAIN_LOAD_OBJECTS) {
            data += get_special_objects_size(data);
        } else if (type == TERRAIN_LOAD_ENVIRONMENT) {
            s32 n = *data;
            t->envLen = 1 + n * 6;
            t->env = malloc(t->envLen * sizeof(s16));
            memcpy(t->env, data, t->envLen * sizeof(s16));
            data += t->envLen;
        } else if (type == TERRAIN_LOAD_CONTINUE) {
            continue;
        } else if (type == TERRAIN_LOAD_END) {
            break;
        } else {
            s32 n = *data++, k, hasForce = studio_surface_has_force(type);
            for (k = 0; k < n; k++) {
                struct CTri c;
                s32 j;
                for (j = 0; j < 3; j++) {
                    s16 *v = &verts[data[j] * 3];
                    c.v[j][0] = v[0];
                    c.v[j][1] = v[1];
                    c.v[j][2] = v[2];
                }
                c.type = type;
                c.force = hasForce ? data[3] : 0;
                c.room = rooms ? *rooms++ : 0;
                ct_push(t, &c);
                data += hasForce ? 4 : 3;
            }
        }
    }
}

// Collision data in the game's format from the triangle copies.
static void build_collision(struct TessArea *t) {
    s32 i, size, pos = 0, start = 0, ri = 0;
    s16 *o;
    free(t->colOut);
    free(t->roomsOut);
    // read_surface_data keeps 3 * index in an s16: vertex blocks must stay under 10923
    // vertices, so 3600 triangles per block. Worst case per triangle: 9 vertex values,
    // 4 index values and a 2-value surface header.
    size = t->nct * 18 + (t->nct / 3600 + 2) * 8 + t->envLen + 16;
    t->colOut = o = malloc(size * sizeof(s16));
    t->roomsOut = t->hasRooms ? malloc(t->nct + 1) : NULL;
    while (start < t->nct) {
        s32 end = start + 3600 < t->nct ? start + 3600 : t->nct;
        o[pos++] = TERRAIN_LOAD_VERTICES;
        o[pos++] = (end - start) * 3;
        for (i = start; i < end; i++) {
            s32 j;
            for (j = 0; j < 3; j++) {
                o[pos++] = t->ct[i].v[j][0];
                o[pos++] = t->ct[i].v[j][1];
                o[pos++] = t->ct[i].v[j][2];
            }
        }
        // one surface block per run of equal (type, force-ness)
        i = start;
        while (i < end) {
            s32 k = i, hasForce = studio_surface_has_force(t->ct[i].type), countPos;
            o[pos++] = t->ct[i].type;
            countPos = pos++;
            while (k < end && t->ct[k].type == t->ct[i].type) {
                s32 base = (k - start) * 3;
                o[pos++] = base;
                o[pos++] = base + 1;
                o[pos++] = base + 2;
                if (hasForce) {
                    o[pos++] = t->ct[k].force;
                }
                if (t->roomsOut) {
                    t->roomsOut[ri++] = t->ct[k].room;
                }
                k++;
            }
            o[countPos] = k - i;
            i = k;
        }
        start = end;
    }
    if (t->env) {
        o[pos++] = TERRAIN_LOAD_ENVIRONMENT;
        memcpy(&o[pos], t->env, t->envLen * sizeof(s16));
        pos += t->envLen;
    }
    o[pos++] = TERRAIN_LOAD_END;
    t->colDirty = FALSE;
}

// ---- area setup ----

static void collect_tess_fn(struct GraphNode *n, void *arg) {
    struct TessArea *t = arg;
    if (n->type == GRAPH_NODE_TYPE_DISPLAY_LIST) {
        struct GraphNodeDisplayList *dn = (struct GraphNodeDisplayList *) n;
        s32 i;
        const Gfx *dl = dn->displayList;
        for (i = 0; i < t->ndls; i++) {
            if (t->dls[i].orig == dl || t->dls[i].out == dl) {
                return;
            }
        }
        if (dl == NULL) {
            return;
        }
        if (t->ndls == t->capDls) {
            t->capDls = t->capDls ? t->capDls * 2 : 32;
            t->dls = realloc(t->dls, t->capDls * sizeof(struct TessDL));
        }
        {
            struct TessDL *d = &t->dls[t->ndls++];
            struct ParseState ps;
            memset(d, 0, sizeof(*d));
            d->orig = dl;
            memset(&ps, 0, sizeof(ps));
            ps.d = d;
            ps.lit = TRUE;
            ps.curRun = -1;
            parse_dl(&ps, dl, 0);
            d->dirty = TRUE;
        }
    }
}

// Triangles the brush touched (v.flag) get their shading from their new slope:
// lit runs a face normal, unlit runs their colors darkened like the heightmap sun.
static void shade_sculpted(Vtx *v, s32 n, s32 lit) {
    s32 i, k;
    for (i = 0; i < n; i++, v += 3) {
        f32 e1[3], e2[3], nr[3], len;
        if (!(v[0].v.flag | v[1].v.flag | v[2].v.flag)) {
            continue;
        }
        for (k = 0; k < 3; k++) {
            e1[k] = v[1].v.ob[k] - v[0].v.ob[k];
            e2[k] = v[2].v.ob[k] - v[1].v.ob[k];
        }
        nr[0] = e1[1] * e2[2] - e1[2] * e2[1];
        nr[1] = e1[2] * e2[0] - e1[0] * e2[2];
        nr[2] = e1[0] * e2[1] - e1[1] * e2[0];
        len = sqrtf(nr[0] * nr[0] + nr[1] * nr[1] + nr[2] * nr[2]);
        if (len < 1e-3f) {
            continue;
        }
        if (lit) {
            for (k = 0; k < 3; k++) {
                v[k].n.n[0] = (s8) (nr[0] * 127.0f / len);
                v[k].n.n[1] = (s8) (nr[1] * 127.0f / len);
                v[k].n.n[2] = (s8) (nr[2] * 127.0f / len);
            }
        } else {
            // flat ground keeps its colors; slopes facing away from the sun darken
            f32 l = (nr[0] * 0.38f + nr[1] * 0.84f + nr[2] * 0.38f) / len, f;
            if (l < 0) l = 0;
            f = (0.42f + 0.58f * l) / 0.907f;
            if (f > 1.08f) f = 1.08f;
            for (k = 0; k < 3; k++) {
                s32 c;
                for (c = 0; c < 3; c++) {
                    s32 x = (s32) (v[k].v.cn[c] * f);
                    v[k].v.cn[c] = (u8) (x > 255 ? 255 : x);
                }
            }
        }
    }
}

static void regen_dl(struct TessDL *d) {
    s32 i, total = 0, g = 0, vi = 0;
    for (i = 0; i < d->nruns; i++) {
        total += d->runs[i].count;
    }
    // the old copy is freed once the graph points at the new one (tess_apply)
    free(d->prevOut);
    free(d->prevOutV);
    d->prevOut = d->out;
    d->prevOutV = d->outV;
    d->outV = malloc((total * 3 + 3) * sizeof(Vtx));
    d->out = malloc((d->ncmds + total + total / 21 * 2 + d->nruns * 2 + 4) * sizeof(Gfx));
    for (i = 0; i < d->ncmds; i++) {
        struct TessCmd *c = &d->cmds[i];
        if (c->run < 0) {
            d->out[g++] = c->g;
        } else {
            struct TessRun *r = &d->runs[c->run];
            s32 k = 0;
            while (k < r->count) {
                s32 n = r->count - k > 21 ? 21 : r->count - k, q;
                memcpy(&d->outV[vi], &r->tri[k * 3], n * 3 * sizeof(Vtx));
                shade_sculpted(&d->outV[vi], n, r->lit);
                gSPVertex(&d->out[g++], &d->outV[vi], n * 3, 0);
                for (q = 0; q + 1 < n; q += 2) {
                    gSP2Triangles(&d->out[g++], q * 3, q * 3 + 1, q * 3 + 2, 0, q * 3 + 3, q * 3 + 4, q * 3 + 5, 0);
                }
                if (q < n) {
                    gSP1Triangle(&d->out[g++], q * 3, q * 3 + 1, q * 3 + 2, 0);
                }
                vi += n * 3;
                k += n;
            }
        }
    }
    gSPEndDisplayList(&d->out[g++]);
    d->dirty = FALSE;
}

static void point_nodes_fn(struct GraphNode *n, void *arg) {
    struct TessArea *t = arg;
    if (n->type == GRAPH_NODE_TYPE_DISPLAY_LIST) {
        struct GraphNodeDisplayList *dn = (struct GraphNodeDisplayList *) n;
        s32 i;
        for (i = 0; i < t->ndls; i++) {
            struct TessDL *d = &t->dls[i];
            if (d->out != NULL && (dn->displayList == d->orig || (d->prevOut != NULL && dn->displayList == d->prevOut))) {
                dn->displayList = d->out;
            }
        }
    }
}

static void unpoint_nodes_fn(struct GraphNode *n, void *arg) {
    struct TessArea *t = arg;
    if (n->type == GRAPH_NODE_TYPE_DISPLAY_LIST) {
        struct GraphNodeDisplayList *dn = (struct GraphNodeDisplayList *) n;
        s32 i;
        for (i = 0; i < t->ndls; i++) {
            if (dn->displayList == t->dls[i].out) {
                dn->displayList = (Gfx *) t->dls[i].orig;
            }
        }
    }
}

static void tess_free(struct TessArea *t) {
    s32 i, j;
    for (i = 0; i < t->ndls; i++) {
        for (j = 0; j < t->dls[i].nruns; j++) {
            free(t->dls[i].runs[j].tri);
        }
        free(t->dls[i].runs);
        free(t->dls[i].cmds);
        // out/outV may still be referenced by this frame's display list: keep them (small leak)
    }
    free(t->dls);
    free(t->ct);
    free(t->env);
    memset(t, 0, sizeof(*t));
}

static struct TessArea *tess_area(s32 create) {
    s32 i;
    struct TessArea *t = NULL;
    if (gCurrentArea == NULL || gCurrentArea->unk04 == NULL) {
        return NULL;
    }
    for (i = 0; i < MAX_TESS_AREAS; i++) {
        if (sTess[i].key != NULL && (sTess[i].key == gCurrentArea->terrainData || (void *) sTess[i].colOut == gCurrentArea->terrainData)) {
            return &sTess[i];
        }
    }
    if (!create) {
        return NULL;
    }
    for (i = 0; i < MAX_TESS_AREAS && t == NULL; i++) {
        if (sTess[i].key == NULL) {
            t = &sTess[i];
        }
    }
    if (t == NULL) {
        t = &sTess[0];
        tess_free(t);
    }
    t->key = gCurrentArea->terrainData;
    t->keyRooms = gCurrentArea->surfaceRooms;
    walk_graph(&gCurrentArea->unk04->node, collect_tess_fn, t);
    parse_collision(t, gCurrentArea->terrainData, gCurrentArea->surfaceRooms);
    t->colDirty = TRUE;
    return t;
}

// Point the current area at the edited copies (graph nodes and collision).
static void tess_apply(struct TessArea *t) {
    s32 i;
    for (i = 0; i < t->ndls; i++) {
        if (t->dls[i].dirty || t->dls[i].out == NULL) {
            regen_dl(&t->dls[i]);
        }
    }
    walk_graph(&gCurrentArea->unk04->node, point_nodes_fn, t);
    for (i = 0; i < t->ndls; i++) {
        free(t->dls[i].prevOut);
        free(t->dls[i].prevOutV);
        t->dls[i].prevOut = NULL;
        t->dls[i].prevOutV = NULL;
    }
    if (t->colDirty || t->colOut == NULL) {
        build_collision(t);
    }
    gCurrentArea->terrainData = t->colOut;
    gCurrentArea->surfaceRooms = t->roomsOut;
}

// ---- subdivision ----

static f32 edge_len(const s16 *a, const s16 *b) {
    f32 dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return sqrtf(dx * dx + dy * dy + dz * dz);
}

// The split decision depends only on the edge, so both triangles sharing it agree.
static s32 edge_splits(const s16 *a, const s16 *b, f32 x, f32 z, f32 r, f32 maxEdge) {
    f32 ax = a[0], az = a[2], bx = b[0], bz = b[2];
    f32 dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t, px, pz;
    if (edge_len(a, b) <= maxEdge) {
        return FALSE;
    }
    t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    px = ax + t * dx - x;
    pz = az + t * dz - z;
    return px * px + pz * pz < (r + maxEdge) * (r + maxEdge);
}

static void mid_vtx(Vtx *o, const Vtx *a, const Vtx *b, s32 lit) {
    s32 k;
    for (k = 0; k < 3; k++) {
        o->v.ob[k] = (s16) (((s32) a->v.ob[k] + (s32) b->v.ob[k]) / 2);
    }
    o->v.flag = a->v.flag | b->v.flag;
    o->v.tc[0] = (s16) (((s32) a->v.tc[0] + b->v.tc[0]) / 2);
    o->v.tc[1] = (s16) (((s32) a->v.tc[1] + b->v.tc[1]) / 2);
    if (lit) {
        f32 n[3], l;
        for (k = 0; k < 3; k++) {
            n[k] = (s8) a->n.n[k] + (s8) b->n.n[k];
        }
        l = sqrtf(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
        for (k = 0; k < 3; k++) {
            o->n.n[k] = (s8) (l > 0 ? n[k] * 127.0f / l : 0);
        }
        o->n.a = (u8) (((s32) a->n.a + b->n.a) / 2);
    } else {
        for (k = 0; k < 4; k++) {
            o->v.cn[k] = (u8) (((s32) a->v.cn[k] + b->v.cn[k]) / 2);
        }
    }
}

// Split triangle (a,b,c) by its marked edges into 2-4 triangles (winding kept).
#define EMIT(p, q, s) \
    { out[n * 3] = *(p); out[n * 3 + 1] = *(q); out[n * 3 + 2] = *(s); n++; }

static s32 split_vtx_tri(Vtx *t, s32 lit, f32 x, f32 z, f32 r, f32 maxEdge, Vtx *out) {
    Vtx *a = &t[0], *b = &t[1], *c = &t[2], mab, mbc, mca;
    s16 pa[3] = { a->v.ob[0], a->v.ob[1], a->v.ob[2] }, pb[3] = { b->v.ob[0], b->v.ob[1], b->v.ob[2] };
    s16 pc[3] = { c->v.ob[0], c->v.ob[1], c->v.ob[2] };
    s32 sab = edge_splits(pa, pb, x, z, r, maxEdge);
    s32 sbc = edge_splits(pb, pc, x, z, r, maxEdge);
    s32 sca = edge_splits(pc, pa, x, z, r, maxEdge);
    s32 n = 0;
    if (!sab && !sbc && !sca) {
        return 0;
    }
    if (sab) mid_vtx(&mab, a, b, lit);
    if (sbc) mid_vtx(&mbc, b, c, lit);
    if (sca) mid_vtx(&mca, c, a, lit);
    if (sab && sbc && sca) {
        EMIT(a, &mab, &mca); EMIT(&mab, b, &mbc); EMIT(&mca, &mbc, c); EMIT(&mab, &mbc, &mca);
    } else if (sab && sbc) {
        EMIT(a, &mab, c); EMIT(&mab, b, &mbc); EMIT(&mab, &mbc, c);
    } else if (sbc && sca) {
        EMIT(a, b, &mbc); EMIT(&mbc, c, &mca); EMIT(a, &mbc, &mca);
    } else if (sca && sab) {
        EMIT(a, &mab, &mca); EMIT(&mab, b, c); EMIT(&mca, &mab, c);
    } else if (sab) {
        EMIT(a, &mab, c); EMIT(&mab, b, c);
    } else if (sbc) {
        EMIT(a, b, &mbc); EMIT(a, &mbc, c);
    } else {
        EMIT(a, b, &mca); EMIT(&mca, b, c);
    }
    return n;
}

static void mid_s16(s16 *o, const s16 *a, const s16 *b) {
    o[0] = (s16) (((s32) a[0] + b[0]) / 2);
    o[1] = (s16) (((s32) a[1] + b[1]) / 2);
    o[2] = (s16) (((s32) a[2] + b[2]) / 2);
}

static s32 split_ctri(struct CTri *t, f32 x, f32 z, f32 r, f32 maxEdge, struct CTri *out) {
    s16 *a = t->v[0], *b = t->v[1], *c = t->v[2], mab[3], mbc[3], mca[3];
    s32 sab = edge_splits(a, b, x, z, r, maxEdge), sbc = edge_splits(b, c, x, z, r, maxEdge), sca = edge_splits(c, a, x, z, r, maxEdge);
    s32 n = 0;
#define CEMIT(p, q, s) { out[n] = *t; memcpy(out[n].v[0], p, 6); memcpy(out[n].v[1], q, 6); memcpy(out[n].v[2], s, 6); n++; }
    if (!sab && !sbc && !sca) {
        return 0;
    }
    if (sab) mid_s16(mab, a, b);
    if (sbc) mid_s16(mbc, b, c);
    if (sca) mid_s16(mca, c, a);
    if (sab && sbc && sca) {
        CEMIT(a, mab, mca); CEMIT(mab, b, mbc); CEMIT(mca, mbc, c); CEMIT(mab, mbc, mca);
    } else if (sab && sbc) {
        CEMIT(a, mab, c); CEMIT(mab, b, mbc); CEMIT(mab, mbc, c);
    } else if (sbc && sca) {
        CEMIT(a, b, mbc); CEMIT(mbc, c, mca); CEMIT(a, mbc, mca);
    } else if (sca && sab) {
        CEMIT(a, mab, mca); CEMIT(mab, b, c); CEMIT(mca, mab, c);
    } else if (sab) {
        CEMIT(a, mab, c); CEMIT(mab, b, c);
    } else if (sbc) {
        CEMIT(a, b, mbc); CEMIT(a, mbc, c);
    } else {
        CEMIT(a, b, mca); CEMIT(mca, b, c);
    }
#undef CEMIT
    return n;
}

static void tessellate(struct TessArea *t, f32 x, f32 z, f32 r, f32 maxEdge) {
    s32 pass, i, j, changed;
    for (pass = 0; pass < 8; pass++) {
        changed = FALSE;
        for (i = 0; i < t->ndls; i++) {
            struct TessDL *d = &t->dls[i];
            for (j = 0; j < d->nruns; j++) {
                struct TessRun *run = &d->runs[j];
                s32 k, n0 = run->count;
                for (k = 0; k < n0; k++) {
                    Vtx out[12], tri[3];
                    s32 n;
                    if (t->totalTris > TESS_MAX_TRIS) {
                        return;
                    }
                    memcpy(tri, &run->tri[k * 3], sizeof(tri));
                    n = split_vtx_tri(tri, run->lit, x, z, r, maxEdge, out);
                    if (n > 0) {
                        s32 q;
                        memcpy(&run->tri[k * 3], &out[0], 3 * sizeof(Vtx));
                        for (q = 1; q < n; q++) {
                            run_push(run, &out[q * 3], &out[q * 3 + 1], &out[q * 3 + 2]);
                        }
                        t->totalTris += n - 1;
                        d->dirty = TRUE;
                        changed = TRUE;
                    }
                }
            }
        }
        if (t->nct < 50000) {
            // collision is split half as finely as the visuals: plenty for walking on
            s32 n0 = t->nct;
            for (i = 0; i < n0 && t->nct < 50000; i++) {
                struct CTri out[4];
                s32 n = split_ctri(&t->ct[i], x, z, r, maxEdge * 2.0f, out), q;
                if (n > 0) {
                    t->ct[i] = out[0];
                    for (q = 1; q < n; q++) {
                        ct_push(t, &out[q]);
                    }
                    t->colDirty = TRUE;
                    changed = TRUE;
                }
            }
        }
        if (!changed) {
            break;
        }
    }
}

// ---- API ----

EMSCRIPTEN_KEEPALIVE
s32 studio_sculpt_prepare(void) {
    sTessCur = tess_area(TRUE);
    if (sTessCur == NULL) {
        return 0;
    }
    tess_apply(sTessCur);
    return sTessCur->nct;
}

// Back to the original level shape (before replaying saved strokes).
EMSCRIPTEN_KEEPALIVE
void studio_sculpt_restore(void) {
    struct TessArea *t = tess_area(FALSE);
    if (t != NULL) {
        walk_graph(&gCurrentArea->unk04->node, unpoint_nodes_fn, t);
        gCurrentArea->terrainData = t->key;
        // the original rooms too: the copy's room list (in the tessellated order) would give the
        // level's surfaces the wrong rooms (objects in BBH or the castle vanish)
        gCurrentArea->surfaceRooms = t->keyRooms;
        tess_free(t);
    }
    sTessCur = NULL;
}

// The current area's sculpted shape for the ROM export (romdump.c), little endian:
//   u32 sculpted (0: nothing follows)
//   u32 ndl { u32 nraw; u32 changed; if changed: u32 ncmds; s32 cmd[ncmds] (-1: the next raw command,
//             else a run); u32 nruns; { u32 count; u32 lit; tri[count * 3] (as drawn, the N64's Vtx) } }
//   u32 nct { s16 v[9]; s16 type, force, room }; u32 hasRooms
// The display lists come in the order the area's graph has them; raw commands are the original
// list's own (G_DL followed, vertices and triangles left out), so the ROM copies its own.
void studio_sculpt_write(void (*put)(const void *, u32)) {
    struct TessArea *t = tess_area(FALSE);
    s32 i, j, k, one = 1, zero = 0;
    if (t == NULL || t->nct == 0) {
        put(&zero, 4);
        return;
    }
    put(&one, 4);
    put(&t->ndls, 4);
    for (i = 0; i < t->ndls; i++) {
        struct TessDL *d = &t->dls[i];
        s32 nraw = 0, changed = 0, vi = 0;
        for (j = 0; j < d->ncmds; j++) nraw += d->cmds[j].run < 0;
        for (j = 0; j < d->nruns && !changed && d->outV != NULL; j++) {
            for (k = 0; k < d->runs[j].count * 3; k++) changed |= d->runs[j].tri[k].v.flag != 0;
        }
        put(&nraw, 4);
        put(&changed, 4);
        if (!changed) continue;
        put(&d->ncmds, 4);
        for (j = 0; j < d->ncmds; j++) put(&d->cmds[j].run, 4);
        put(&d->nruns, 4);
        // the drawn copy has the runs in command order, shaded
        for (j = 0; j < d->ncmds; j++) {
            struct TessRun *r;
            if (d->cmds[j].run < 0) continue;
            r = &d->runs[d->cmds[j].run];
            put(&r->count, 4);
            put(&r->lit, 4);
            for (k = 0; k < r->count * 3; k++, vi++) {
                // as the N64 has it (this build's Vtx has float positions): s16 ob[3], u16 flag, s16 tc[2], u8 cn[4]
                const Vtx_t *v = &d->outV[vi].v;
                s16 n64[8] = { (s16) floorf(v->ob[0] + 0.5f), (s16) floorf(v->ob[1] + 0.5f), (s16) floorf(v->ob[2] + 0.5f), 0, v->tc[0], v->tc[1] };
                memcpy(&n64[6], v->cn, 4);
                put(n64, 16);
            }
        }
    }
    put(&t->nct, 4);
    for (i = 0; i < t->nct; i++) {
        s16 room = t->ct[i].room;
        put(t->ct[i].v, 18);
        put(&t->ct[i].type, 2);
        put(&t->ct[i].force, 2);
        put(&room, 2);
    }
    put(&t->hasRooms, 4);
}

// What the sculpt copies are (tests): the area's collision pointer and each copy's.
EMSCRIPTEN_KEEPALIVE
const char *studio_sculpt_debug(void) {
    static char buf[1024];
    s32 i, n = 0;
    n += snprintf(buf + n, sizeof(buf) - n, "{\"terrain\":%u,\"rooms\":%u,\"tess\":[",
                  gCurrentArea ? (u32) (uintptr_t) gCurrentArea->terrainData : 0, gCurrentArea ? (u32) (uintptr_t) gCurrentArea->surfaceRooms : 0);
    for (i = 0; i < MAX_TESS_AREAS; i++) {
        if (sTess[i].key != NULL) {
            n += snprintf(buf + n, sizeof(buf) - n, "%s{\"slot\":%d,\"key\":%u,\"col\":%u,\"nct\":%d}", n > 0 && buf[n - 1] == '}' ? "," : "", i,
                          (u32) (uintptr_t) sTess[i].key, (u32) (uintptr_t) sTess[i].colOut, sTess[i].nct);
        }
    }
    snprintf(buf + n, sizeof(buf) - n, "]}");
    return buf;
}

static f32 falloff(f32 d, f32 r) {
    f32 t = d / r;
    if (t >= 1.0f) return 0.0f;
    t = 1.0f - t * t;
    return t * t;
}

// mode: 0 raise, 1 lower, 2 smooth, 3 flatten to `target`. Strength in units (raise/lower) or 0..100.
EMSCRIPTEN_KEEPALIVE
s32 studio_sculpt_dab(s32 mode, f32 x, f32 z, f32 r, f32 strength, f32 target) {
    struct TessArea *t = tess_area(TRUE);
    s32 i, j, k, moved = 0;
    f32 avg = target, sum = 0, wsum = 0, kk = strength / 100.0f, maxEdge;
    if (t == NULL || r < 1.0f) {
        return 0;
    }
    if (kk > 1.0f) kk = 1.0f;
    maxEdge = r / 3.0f;
    if (maxEdge < 50.0f) maxEdge = 50.0f;
    if (maxEdge > 400.0f) maxEdge = 400.0f;
    tessellate(t, x, z, r, maxEdge);

    if (mode == 2) {
        for (i = 0; i < t->nct; i++) {
            for (k = 0; k < 3; k++) {
                f32 dx = t->ct[i].v[k][0] - x, dz = t->ct[i].v[k][2] - z;
                f32 w = falloff(sqrtf(dx * dx + dz * dz), r);
                sum += t->ct[i].v[k][1] * w;
                wsum += w;
            }
        }
        if (wsum <= 0) {
            return 0;
        }
        avg = sum / wsum;
    }
#define SCULPT_Y(yref, vx, vz, onmove)                                               \
    {                                                                                \
        f32 dx = (vx) - x, dz = (vz) - z;                                            \
        if (dx > -r && dx < r && dz > -r && dz < r) {                                \
            f32 w = falloff(sqrtf(dx * dx + dz * dz), r);                            \
            if (w > 0) {                                                             \
                f32 y = (yref);                                                      \
                if (mode == 0) y += strength * w;                                    \
                else if (mode == 1) y -= strength * w;                               \
                else y += (avg - y) * kk * w;                                        \
                if (y > 32000) y = 32000;                                            \
                if (y < -32000) y = -32000;                                          \
                (yref) = (s16) y;                                                    \
                moved++;                                                             \
                onmove;                                                              \
            }                                                                        \
        }                                                                            \
    }
    for (i = 0; i < t->ndls; i++) {
        struct TessDL *d = &t->dls[i];
        for (j = 0; j < d->nruns; j++) {
            struct TessRun *run = &d->runs[j];
            for (k = 0; k < run->count * 3; k++) {
                SCULPT_Y(run->tri[k].v.ob[1], run->tri[k].v.ob[0], run->tri[k].v.ob[2], (d->dirty = TRUE, run->tri[k].v.flag = 1));
            }
        }
    }
    for (i = 0; i < t->nct; i++) {
        for (k = 0; k < 3; k++) {
            SCULPT_Y(t->ct[i].v[k][1], t->ct[i].v[k][0], t->ct[i].v[k][2], t->colDirty = TRUE);
        }
    }
#undef SCULPT_Y
    tess_apply(t);
    sTessCur = t;
    return moved;
}

// ---------------------------------------------------------------------------
// Stars: studio stars (placed by the editor, or any star in a custom level)
// are tracked by the page instead of the save file, and never end the level.

s32 studio_is_studio_star(struct Object *o) {
    return gCurrLevelNum == LEVEL_STUDIO || o->unused2 != 0;
}

void studio_star_collected(struct Object *o, s32 starIndex) {
    // the course complete screen names the level and the star (studio_complete_info)
    studio_complete_reset(gCurrLevelNum == LEVEL_STUDIO);
    EM_ASM({
        if (Module.studioStarInfo) Module.studioStarInfo($0 >>> 0, $1, $2);
        if (Module.studioStarCollected) Module.studioStarCollected($0 >>> 0, $1, $2);
    }, o->unused2, starIndex, gCurrLevelNum);
}

s32 gStudioStarDance;

// Studio stars the player collected (the page keeps track of them).
static s32 sBonusStars;

EMSCRIPTEN_KEEPALIVE
void studio_set_bonus_stars(s32 n) {
    sBonusStars = n;
}

// Editing should never end in a game over, and the star counter includes the
// studio stars. Milestone dialogs (castle doors) don't fire for them.
void studio_world_frame(void) {
    if (gMarioState != NULL) {
        s32 total = save_file_get_total_star_count(gCurrSaveFileNum - 1, COURSE_MIN - 1, COURSE_MAX - 1) + sBonusStars;
        if (gMarioState->numLives < 2) {
            gMarioState->numLives = 2;
        }
        if (gMarioState->numStars != total) {
            gMarioState->numStars = total;
            gMarioState->prevNumStarsForDialog = total;
        }
    }
}

extern s32 gSurfacesAllocated, gSurfaceNodesAllocated;
static char sDebugJson[256];

EMSCRIPTEN_KEEPALIVE
const char *studio_debug_counts(void) {
    struct TessArea *t = tess_area(FALSE);
    snprintf(sDebugJson, sizeof(sDebugJson), "{\"surfaces\":%d,\"nodes\":%d,\"ctris\":%d,\"vtris\":%d}",
             gSurfacesAllocated, gSurfaceNodesAllocated, t ? t->nct : -1, t ? t->totalTris : -1);
    return sDebugJson;
}

// Debug: walk the generated collision like the loader does; returns the first problem.
EMSCRIPTEN_KEEPALIVE
const char *studio_debug_validate(void) {
    struct TessArea *t = tess_area(FALSE);
    s16 *data;
    s32 nverts = -1, blocks = 0, tris = 0;
    if (t == NULL || t->colOut == NULL) {
        return "{\"error\":\"no tess\"}";
    }
    data = t->colOut;
    while (TRUE) {
        s16 type = *data++;
        if (type == TERRAIN_LOAD_VERTICES) {
            nverts = (u16) *data++;
            data += nverts * 3;
        } else if (type == TERRAIN_LOAD_ENVIRONMENT) {
            s32 n = *data++;
            data += n * 6;
        } else if (type == TERRAIN_LOAD_END) {
            break;
        } else if (type == TERRAIN_LOAD_CONTINUE || type == TERRAIN_LOAD_OBJECTS) {
            snprintf(sDebugJson, sizeof(sDebugJson), "{\"error\":\"unexpected %d\"}", type);
            return sDebugJson;
        } else {
            s32 n = *data++, k, hf = studio_surface_has_force(type);
            blocks++;
            for (k = 0; k < n; k++) {
                if (data[0] < 0 || data[0] >= nverts || data[1] < 0 || data[1] >= nverts || data[2] < 0 || data[2] >= nverts) {
                    snprintf(sDebugJson, sizeof(sDebugJson), "{\"error\":\"bad index\",\"block\":%d,\"tri\":%d,\"i\":[%d,%d,%d],\"nverts\":%d,\"type\":%d,\"count\":%d}",
                             blocks, k, data[0], data[1], data[2], nverts, type, n);
                    return sDebugJson;
                }
                data += hf ? 4 : 3;
                tris++;
            }
        }
    }
    snprintf(sDebugJson, sizeof(sDebugJson), "{\"ok\":true,\"tris\":%d,\"blocks\":%d,\"nct\":%d}", tris, blocks, t->nct);
    return sDebugJson;
}
