// ROM export: dumps what the engine built for the current area (terrain, blocks, models, roads, plants)
// as triangles with their textures and materials, plus the collision, so server/romexport can turn
// the area into decomp level data. Only static geometry: moving objects are exported as objects.
//
// Layout of the buffer (little endian):
//   "S64D" u32 version
//   u32 ntex   { u16 w, h, tileW, tileH; u8 rgba[w*h*4] }   (texture coordinates refer to tileW x tileH)
//   u32 nmat   { s32 tex; u32 combine[2]; u32 geomode; u32 othermode[2]; u8 layer, lit, cms, cmt;
//                u8 prim[4]; u8 env[4]; u16 texScaleS, texScaleT }
//   u32 ntri   { u16 mat; u16 pad; 3 x { f32 x, y, z; f32 s, t; u8 c[4] } }
//   u32 ncol   { s16 v[9]; s16 type; s16 force; u32 uid }
//   u32 nwater { s16 id, x1, z1, x2, z2, y }
//   u32 sculpt bytes, then the sculpted original level (world.c, studio_sculpt_write)
#include <ultra64.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

#include "sm64.h"
#include "types.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/object_list_processor.h"
#include "behavior_data.h"
#include "surface_terrains.h"

s32 studio_surface_has_force(s16 type);

#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

extern struct Surface *sSurfacePool;
s32 studio_texture_override(const u8 *addr, const u8 **rgba, u32 *w, u32 *h);
void studio_sculpt_write(void (*put)(const void *, u32));

// ---- output buffer ----

static u8 *sBuf;
static u32 sLen, sCap;

static void put(const void *p, u32 n) {
    if (sLen + n > sCap) {
        while (sLen + n > sCap) sCap = sCap ? sCap * 2 : (1 << 20);
        sBuf = realloc(sBuf, sCap);
    }
    memcpy(sBuf + sLen, p, n);
    sLen += n;
}
static void put32(u32 v) { put(&v, 4); }
static void put16(u16 v) { put(&v, 2); }
static void put8(u8 v) { put(&v, 1); }

// ---- textures ----

#define MAX_TEX 512
struct DumpTex {
    const u8 *addr, *tlut;
    u8 fmt, siz;
    u16 w, h;           // the texture as loaded by the display list
    u16 iw, ih;         // the image dumped (an override can be any size)
    u8 *rgba;
};
static struct DumpTex sTex[MAX_TEX];
static s32 sNumTex;

static u8 c5(u32 v) { return (u8) ((v << 3) | (v >> 2)); }

static void rgba16(const u8 *p, u8 *o) {
    u16 c = (p[0] << 8) | p[1];
    o[0] = c5((c >> 11) & 31); o[1] = c5((c >> 6) & 31); o[2] = c5((c >> 1) & 31); o[3] = (c & 1) ? 255 : 0;
}

static u8 *decode_texture(const u8 *a, const u8 *tlut, s32 fmt, s32 siz, s32 w, s32 h) {
    u8 *out = malloc(w * h * 4);
    s32 i;
    for (i = 0; i < w * h; i++) {
        u8 *o = out + i * 4;
        if (fmt == G_IM_FMT_RGBA && siz == G_IM_SIZ_16b) {
            rgba16(a + i * 2, o);
        } else if (fmt == G_IM_FMT_RGBA && siz == G_IM_SIZ_32b) {
            memcpy(o, a + i * 4, 4);
        } else if (fmt == G_IM_FMT_IA && siz == G_IM_SIZ_16b) {
            o[0] = o[1] = o[2] = a[i * 2]; o[3] = a[i * 2 + 1];
        } else if (fmt == G_IM_FMT_IA && siz == G_IM_SIZ_8b) {
            u8 b = a[i]; o[0] = o[1] = o[2] = (u8) ((b >> 4) * 17); o[3] = (u8) ((b & 15) * 17);
        } else if (fmt == G_IM_FMT_IA && siz == G_IM_SIZ_4b) {
            u8 b = (a[i / 2] >> ((i & 1) ? 0 : 4)) & 15;
            o[0] = o[1] = o[2] = (u8) ((b >> 1) * 36); o[3] = (b & 1) ? 255 : 0;
        } else if (fmt == G_IM_FMT_I && siz == G_IM_SIZ_8b) {
            o[0] = o[1] = o[2] = o[3] = a[i];
        } else if (fmt == G_IM_FMT_I && siz == G_IM_SIZ_4b) {
            u8 b = (a[i / 2] >> ((i & 1) ? 0 : 4)) & 15;
            o[0] = o[1] = o[2] = o[3] = (u8) (b * 17);
        } else if (fmt == G_IM_FMT_CI && siz == G_IM_SIZ_8b && tlut != NULL) {
            rgba16(tlut + a[i] * 2, o);
        } else if (fmt == G_IM_FMT_CI && siz == G_IM_SIZ_4b && tlut != NULL) {
            u8 b = (a[i / 2] >> ((i & 1) ? 0 : 4)) & 15;
            rgba16(tlut + b * 2, o);
        } else {
            o[0] = o[1] = o[2] = 255; o[3] = 255;
        }
    }
    return out;
}

static s32 texture_index(const u8 *addr, const u8 *tlut, s32 fmt, s32 siz, s32 w, s32 h) {
    s32 i;
    if (addr == NULL || w <= 0 || h <= 0 || w > 1024 || h > 1024) return -1;
    for (i = 0; i < sNumTex; i++) {
        struct DumpTex *t = &sTex[i];
        if (t->addr == addr && t->tlut == tlut && t->fmt == fmt && t->siz == siz && t->w == w && t->h == h) return i;
    }
    if (sNumTex >= MAX_TEX) return -1;
    sTex[sNumTex].addr = addr;
    sTex[sNumTex].tlut = tlut;
    sTex[sNumTex].fmt = fmt;
    sTex[sNumTex].siz = siz;
    sTex[sNumTex].w = w;
    sTex[sNumTex].h = h;
    {
        // the studio's own models and replaced game textures draw an override image instead
        const u8 *img;
        u32 ow, oh;
        if (studio_texture_override(addr, &img, &ow, &oh) && img != NULL && ow > 0 && oh > 0 && ow <= 2048 && oh <= 2048) {
            sTex[sNumTex].rgba = malloc(ow * oh * 4);
            memcpy(sTex[sNumTex].rgba, img, ow * oh * 4);
            sTex[sNumTex].iw = ow;
            sTex[sNumTex].ih = oh;
        } else {
            sTex[sNumTex].rgba = decode_texture(addr, tlut, fmt, siz, w, h);
            sTex[sNumTex].iw = w;
            sTex[sNumTex].ih = h;
        }
    }
    return sNumTex++;
}

// ---- materials ----

struct DumpMat {
    s32 tex;
    u32 combine[2], geomode, othermode[2];
    u8 layer, lit, cms, cmt;
    u8 prim[4], env[4];
    u16 scaleS, scaleT;
};
#define MAX_MAT 1024
static struct DumpMat sMat[MAX_MAT];
static s32 sNumMat;

static s32 material_index(const struct DumpMat *m) {
    s32 i;
    for (i = 0; i < sNumMat; i++) {
        if (memcmp(&sMat[i], m, sizeof(*m)) == 0) return i;
    }
    if (sNumMat >= MAX_MAT) return 0;
    sMat[sNumMat] = *m;
    return sNumMat++;
}

// ---- triangles ----

struct DumpVert {
    f32 x, y, z, s, t;
    u8 c[4];
};
struct DumpTri {
    u16 mat;
    struct DumpVert v[3];
};
static struct DumpTri *sTris;
static s32 sNumTris, sCapTris;

// RSP state while walking a display list
struct Rsp {
    Mat4 m;
    Vtx vbuf[64];
    const u8 *timg, *tlut;
    s32 timgFmt, timgSiz;
    s32 tileFmt, tileSiz, cms, cmt;
    s32 tileW, tileH;
    u32 texScale;
    s32 texOn;
    struct DumpMat mat;
    s32 curMat;    // -1: state changed since the last triangle
};

static void rsp_tri(struct Rsp *r, s32 a, s32 b, s32 c) {
    s32 idx[3] = { a, b, c }, k;
    struct DumpTri *t;
    if (a > 63 || b > 63 || c > 63) return;
    if (r->curMat < 0) {
        struct DumpMat m = r->mat;
        m.tex = (r->texOn && r->timg != NULL)
                    ? texture_index(r->timg, r->tlut, r->tileFmt, r->tileSiz, r->tileW, r->tileH) : -1;
        m.cms = (u8) r->cms;
        m.cmt = (u8) r->cmt;
        m.scaleS = (u16) (r->texScale >> 16);
        m.scaleT = (u16) (r->texScale & 0xFFFF);
        r->curMat = material_index(&m);
    }
    if (sNumTris == sCapTris) {
        sCapTris = sCapTris ? sCapTris * 2 : 4096;
        sTris = realloc(sTris, sCapTris * sizeof(struct DumpTri));
    }
    t = &sTris[sNumTris++];
    t->mat = (u16) r->curMat;
    for (k = 0; k < 3; k++) {
        Vtx *v = &r->vbuf[idx[k]];
        f32 x = v->v.ob[0], y = v->v.ob[1], z = v->v.ob[2];
        struct DumpVert *o = &t->v[k];
        o->x = x * r->m[0][0] + y * r->m[1][0] + z * r->m[2][0] + r->m[3][0];
        o->y = x * r->m[0][1] + y * r->m[1][1] + z * r->m[2][1] + r->m[3][1];
        o->z = x * r->m[0][2] + y * r->m[1][2] + z * r->m[2][2] + r->m[3][2];
        o->s = v->v.tc[0] / 32.0f;
        o->t = v->v.tc[1] / 32.0f;
        memcpy(o->c, v->v.cn, 4);
        if (r->mat.lit) {
            // normals: rotate them with the model matrix (no translation)
            f32 nx = v->n.n[0], ny = v->n.n[1], nz = v->n.n[2];
            f32 tx = nx * r->m[0][0] + ny * r->m[1][0] + nz * r->m[2][0];
            f32 ty = nx * r->m[0][1] + ny * r->m[1][1] + nz * r->m[2][1];
            f32 tz = nx * r->m[0][2] + ny * r->m[1][2] + nz * r->m[2][2];
            f32 len = sqrtf(tx * tx + ty * ty + tz * tz);
            if (len > 0.0001f) { tx /= len; ty /= len; tz /= len; }
            o->c[0] = (u8) (s8) (tx * 127.0f);
            o->c[1] = (u8) (s8) (ty * 127.0f);
            o->c[2] = (u8) (s8) (tz * 127.0f);
        }
    }
}

static void walk_dl(struct Rsp *r, const Gfx *dl, s32 depth) {
    s32 guard;
    if (dl == NULL || depth > 12) return;
    for (guard = 0; guard < 400000; guard++, dl++) {
        u32 w0 = (u32) dl->words.w0;
        uintptr_t w1 = dl->words.w1;
        u8 op = (u8) (w0 >> 24);
        switch (op) {
            case G_VTX: {
                s32 n = (w0 >> 12) & 0xFF, v0 = ((w0 >> 1) & 0x7F) - n, k;
                Vtx *v = (Vtx *) w1;
                for (k = 0; k < n && v0 + k < 64 && v0 + k >= 0; k++) r->vbuf[v0 + k] = v[k];
                break;
            }
            case G_TRI1:
                rsp_tri(r, ((w0 >> 16) & 0xFF) / 2, ((w0 >> 8) & 0xFF) / 2, (w0 & 0xFF) / 2);
                break;
            case G_TRI2:
                rsp_tri(r, ((w0 >> 16) & 0xFF) / 2, ((w0 >> 8) & 0xFF) / 2, (w0 & 0xFF) / 2);
                rsp_tri(r, ((w1 >> 16) & 0xFF) / 2, ((w1 >> 8) & 0xFF) / 2, (w1 & 0xFF) / 2);
                break;
            case G_DL:
                walk_dl(r, (const Gfx *) w1, depth + 1);
                if (((w0 >> 16) & 0xFF) == G_DL_NOPUSH) return;
                break;
            case G_ENDDL:
                return;
            case G_SETTIMG:
                r->timg = (const u8 *) w1;
                r->timgFmt = (w0 >> 21) & 7;
                r->timgSiz = (w0 >> 19) & 3;
                break;
            case G_LOADTLUT:
                r->tlut = r->timg;
                break;
            case G_SETTILE:
                if (((w1 >> 24) & 7) == G_TX_RENDERTILE) {
                    r->tileFmt = (w0 >> 21) & 7;
                    r->tileSiz = (w0 >> 19) & 3;
                    r->cmt = (w1 >> 18) & 3;
                    r->cms = (w1 >> 8) & 3;
                    r->curMat = -1;
                }
                break;
            case G_SETTILESIZE:
                if (((w1 >> 24) & 7) == G_TX_RENDERTILE) {
                    s32 uls = (w0 >> 12) & 0xFFF, ult = w0 & 0xFFF;
                    s32 lrs = (w1 >> 12) & 0xFFF, lrt = w1 & 0xFFF;
                    r->tileW = ((lrs - uls) >> 2) + 1;
                    r->tileH = ((lrt - ult) >> 2) + 1;
                    r->curMat = -1;
                }
                break;
            case G_TEXTURE:
                r->texOn = (w0 >> 1) & 0x7F;
                r->texScale = (u32) w1;
                r->curMat = -1;
                break;
            case G_SETCOMBINE:
                r->mat.combine[0] = w0;
                r->mat.combine[1] = (u32) w1;
                r->curMat = -1;
                break;
            case G_SETPRIMCOLOR:
                r->mat.prim[0] = (w1 >> 24) & 0xFF; r->mat.prim[1] = (w1 >> 16) & 0xFF;
                r->mat.prim[2] = (w1 >> 8) & 0xFF; r->mat.prim[3] = w1 & 0xFF;
                r->curMat = -1;
                break;
            case G_SETENVCOLOR:
                r->mat.env[0] = (w1 >> 24) & 0xFF; r->mat.env[1] = (w1 >> 16) & 0xFF;
                r->mat.env[2] = (w1 >> 8) & 0xFF; r->mat.env[3] = w1 & 0xFF;
                r->curMat = -1;
                break;
            case G_GEOMETRYMODE: {
                u32 clear = ~(w0 & 0xFFFFFF), set = (u32) w1;
                r->mat.geomode = (r->mat.geomode & ~clear) | set;
                r->mat.lit = (r->mat.geomode & G_LIGHTING) != 0;
                r->curMat = -1;
                break;
            }
            case G_SETOTHERMODE_H:
                r->mat.othermode[0] = (u32) w1;
                r->curMat = -1;
                break;
            case G_SETOTHERMODE_L:
                r->mat.othermode[1] = (u32) w1;
                r->curMat = -1;
                break;
            default:
                break;
        }
    }
}

// ---- graph walk ----

static void walk_graph(struct GraphNode *first, Mat4 parent, s32 layer);

static void draw_dl(const Gfx *dl, Mat4 m, struct GraphNode *n) {
    struct Rsp *r;
    if (dl == NULL) return;
    r = calloc(1, sizeof(struct Rsp));
    mtxf_copy(r->m, m);
    r->curMat = -1;
    r->texScale = 0xFFFFFFFF;
    r->mat.layer = (u8) ((n->flags >> 8) & 0xFF);
    walk_dl(r, dl, 0);
    free(r);
}

static void walk_node(struct GraphNode *n, Mat4 parent, s32 layer) {
    Mat4 m;
    const Gfx *own = NULL;
    switch (n->type) {
        case GRAPH_NODE_TYPE_DISPLAY_LIST:
            draw_dl(((struct GraphNodeDisplayList *) n)->displayList, parent, n);
            walk_graph(n->children, parent, layer);
            return;
        case GRAPH_NODE_TYPE_TRANSLATION_ROTATION: {
            struct GraphNodeTranslationRotation *tr = (struct GraphNodeTranslationRotation *) n;
            Vec3f t = { tr->translation[0], tr->translation[1], tr->translation[2] };
            Mat4 local;
            mtxf_rotate_zxy_and_translate(local, t, tr->rotation);
            mtxf_mul(m, local, parent);
            own = tr->displayList;
            break;
        }
        case GRAPH_NODE_TYPE_TRANSLATION: {
            struct GraphNodeTranslation *tn = (struct GraphNodeTranslation *) n;
            Vec3f t = { tn->translation[0], tn->translation[1], tn->translation[2] };
            Vec3s zero = { 0, 0, 0 };
            Mat4 local;
            mtxf_rotate_zxy_and_translate(local, t, zero);
            mtxf_mul(m, local, parent);
            own = tn->displayList;
            break;
        }
        case GRAPH_NODE_TYPE_ROTATION: {
            struct GraphNodeRotation *rn = (struct GraphNodeRotation *) n;
            Vec3f t = { 0, 0, 0 };
            Mat4 local;
            mtxf_rotate_zxy_and_translate(local, t, rn->rotation);
            mtxf_mul(m, local, parent);
            own = rn->displayList;
            break;
        }
        case GRAPH_NODE_TYPE_SCALE: {
            struct GraphNodeScale *sn = (struct GraphNodeScale *) n;
            Vec3f s = { sn->scale, sn->scale, sn->scale };
            mtxf_scale_vec3f(m, parent, s);
            own = sn->displayList;
            break;
        }
        case GRAPH_NODE_TYPE_ANIMATED_PART: {
            struct GraphNodeAnimatedPart *an = (struct GraphNodeAnimatedPart *) n;
            Vec3f t = { an->translation[0], an->translation[1], an->translation[2] };
            Vec3s zero = { 0, 0, 0 };
            Mat4 local;
            mtxf_rotate_zxy_and_translate(local, t, zero);
            mtxf_mul(m, local, parent);
            own = an->displayList;
            break;
        }
        case GRAPH_NODE_TYPE_SWITCH_CASE: {
            // only the selected case is drawn
            struct GraphNodeSwitchCase *sc = (struct GraphNodeSwitchCase *) n;
            struct GraphNode *c = n->children;
            s32 k;
            for (k = 0; c != NULL && k < sc->selectedCase; k++) c = c->next;
            if (c != NULL) walk_node(c, parent, layer);
            return;
        }
        case GRAPH_NODE_TYPE_LEVEL_OF_DETAIL:
            // the detail shown up close (the export draws one level of detail at every distance)
            if (((struct GraphNodeLevelOfDetail *) n)->minDistance > 0) return;
            mtxf_copy(m, parent);
            break;
        default:
            mtxf_copy(m, parent);
            break;
    }
    draw_dl(own, m, n);
    walk_graph(n->children, m, layer);
}

static void walk_graph(struct GraphNode *first, Mat4 parent, s32 layer) {
    struct GraphNode *n = first;
    if (first == NULL) return;
    do {
        walk_node(n, parent, layer);
        n = n->next;
    } while (n != first && n != NULL);
}


static s32 excluded(u32 uid, const s32 *skip, s32 nskip) {
    s32 i;
    for (i = 0; i < nskip; i++) if ((u32) skip[i] == uid) return TRUE;
    return FALSE;
}

static const s32 *sBake;
static s32 sNumBake;

// Is this object part of the level's static geometry? (the studio's terrain, blocks and models,
// and any object the exporter asks to bake in: props whose model only exists in another level)
static s32 is_static_geometry(struct Object *o, const s32 *skip, s32 nskip) {
    if (!(o->activeFlags & ACTIVE_FLAG_ACTIVE) || o->header.gfx.sharedChild == NULL) return FALSE;
    if (o->unused2 != 0 && excluded(o->unused2, sBake, sNumBake)) return TRUE;
    if (o->behavior != segmented_to_virtual(bhvStudioTerrain)
        && o->behavior != segmented_to_virtual(bhvStudioBlock)
        && o->behavior != segmented_to_virtual(bhvStudioModel)) {
        return FALSE;
    }
    return !excluded(o->unused2, skip, nskip);
}

// studio_romdump_object: one object, in its own coordinates (the ROM moves it)
static u32 sOnlyUid;

static void dump_object(struct Object *o) {
    Mat4 m, base;
    Vec3f pos = { o->header.gfx.pos[0], o->header.gfx.pos[1], o->header.gfx.pos[2] };
    if (sOnlyUid) {
        mtxf_identity(m);
    } else {
        mtxf_rotate_zxy_and_translate(base, pos, o->header.gfx.angle);
        mtxf_scale_vec3f(m, base, o->header.gfx.scale);
    }
    walk_graph(o->header.gfx.sharedChild, m, 0);
}

static s32 dumped(struct Object *o, const s32 *skip, s32 nskip) {
    if (sOnlyUid) {
        return (o->activeFlags & ACTIVE_FLAG_ACTIVE) && o->unused2 == sOnlyUid && o->header.gfx.sharedChild != NULL;
    }
    return is_static_geometry(o, skip, nskip);
}

// An object's collision data in world space (as load_object_collision_model would place it).
static s32 dump_object_collision(struct Object *o) {
    s16 *data = segmented_to_virtual(o->collisionData);
    s16 *verts = NULL;
    s32 count = 0, nverts = 0, k;
    Mat4 m, base;
    Vec3f pos = { o->oPosX, o->oPosY, o->oPosZ };
    Vec3s ang = { o->oFaceAnglePitch, o->oFaceAngleYaw, o->oFaceAngleRoll };
    if (sOnlyUid) {
        mtxf_identity(m);
    } else {
        mtxf_rotate_zxy_and_translate(base, pos, ang);
        mtxf_scale_vec3f(m, base, o->header.gfx.scale);
    }
    if (*data++ != TERRAIN_LOAD_VERTICES) return 0;
    nverts = *data++;
    verts = data;
    data += nverts * 3;
    while (TRUE) {
        s16 type = *data++, n, hasForce;
        if (type == TERRAIN_LOAD_CONTINUE) continue;
        if (type == TERRAIN_LOAD_END || type == TERRAIN_LOAD_OBJECTS || type == TERRAIN_LOAD_ENVIRONMENT) break;
        n = *data++;
        hasForce = studio_surface_has_force(type);
        for (k = 0; k < n; k++) {
            s32 j;
            s16 out[9];
            for (j = 0; j < 3; j++) {
                s16 *v = &verts[data[j] * 3];
                f32 x = v[0], y = v[1], z = v[2];
                out[j * 3] = (s16) (x * m[0][0] + y * m[1][0] + z * m[2][0] + m[3][0]);
                out[j * 3 + 1] = (s16) (x * m[0][1] + y * m[1][1] + z * m[2][1] + m[3][1]);
                out[j * 3 + 2] = (s16) (x * m[0][2] + y * m[1][2] + z * m[2][2] + m[3][2]);
            }
            put(out, 18);
            put16((u16) type);
            put16((u16) (hasForce ? data[3] : 0));
            put32(o->unused2);
            count++;
            data += hasForce ? 4 : 3;
        }
    }
    return count;
}

// Dumps the current area. skip: studio uids of objects to leave out (moving blocks and models,
// which are exported as objects); bake: uids of other objects to include as static geometry.
// Returns the buffer; studio_romdump_size() gives its length.
EMSCRIPTEN_KEEPALIVE const u8 *studio_romdump(const s32 *skip, s32 nskip, const s32 *bake, s32 nbake) {
    s32 i, k;
    sBake = bake;
    sNumBake = nbake;
    sLen = 0;
    for (i = 0; i < sNumTex; i++) free(sTex[i].rgba);
    sNumTex = 0;
    sNumMat = 0;
    sNumTris = 0;

    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *o = &gObjectPool[i];
        if (dumped(o, skip, nskip)) dump_object(o);
    }

    put("S64D", 4);
    put32(3);
    put32(sNumTex);
    for (i = 0; i < sNumTex; i++) {
        put16(sTex[i].iw);
        put16(sTex[i].ih);
        put16(sTex[i].w);
        put16(sTex[i].h);
        put(sTex[i].rgba, sTex[i].iw * sTex[i].ih * 4);
    }
    put32(sNumMat);
    for (i = 0; i < sNumMat; i++) {
        struct DumpMat *m = &sMat[i];
        put32((u32) m->tex);
        put32(m->combine[0]); put32(m->combine[1]);
        put32(m->geomode);
        put32(m->othermode[0]); put32(m->othermode[1]);
        put8(m->layer); put8(m->lit); put8(m->cms); put8(m->cmt);
        put(m->prim, 4); put(m->env, 4);
        put16(m->scaleS); put16(m->scaleT);
    }
    put32(sNumTris);
    for (i = 0; i < sNumTris; i++) {
        put16(sTris[i].mat);
        put16(0);
        for (k = 0; k < 3; k++) {
            struct DumpVert *v = &sTris[i].v[k];
            put(&v->x, 4); put(&v->y, 4); put(&v->z, 4);
            put(&v->s, 4); put(&v->t, 4);
            put(v->c, 4);
        }
    }

    // collision: the static surfaces, plus every static geometry object's own collision data (in
    // the game an object's collision only loads while Mario is near it)
    {
        u32 countPos = sLen, n = 0;
        put32(0);
        for (i = 0; i < gSurfacesAllocated && !sOnlyUid; i++) {
            struct Surface *s = &sSurfacePool[i];
            // a standing prop's (roads, plants, models) triangles name it, moving objects' are their own
            if (s->object != NULL && (s->object->collisionData != NULL || !is_static_geometry(s->object, skip, nskip))) continue;
            put(s->vertex1, 6); put(s->vertex2, 6); put(s->vertex3, 6);
            put16((u16) s->type);
            put16((u16) s->force);
            put32(s->object != NULL ? s->object->unused2 : 0);
            n++;
        }
        for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
            struct Object *o = &gObjectPool[i];
            if (dumped(o, skip, nskip) && o->collisionData != NULL) {
                n += dump_object_collision(o);
            }
        }
        memcpy(sBuf + countPos, &n, 4);
    }

    // water boxes and other environment regions
    {
        s32 nw = gEnvironmentRegions != NULL && !sOnlyUid ? gEnvironmentRegions[0] : 0;
        put32(nw);
        for (i = 0; i < nw; i++) put(&gEnvironmentRegions[1 + i * 6], 12);
    }

    // the original level's sculpted shape, if it has one
    if (!sOnlyUid) studio_sculpt_write(put);
    else put32(0);
    return sBuf;
}

EMSCRIPTEN_KEEPALIVE u32 studio_romdump_size(void) {
    return sLen;
}

// One object (a moving block or model, exported as an object of its own) in its own coordinates.
EMSCRIPTEN_KEEPALIVE const u8 *studio_romdump_object(u32 uid) {
    const u8 *buf;
    sOnlyUid = uid;
    buf = studio_romdump(NULL, 0, NULL, 0);
    sOnlyUid = 0;
    return buf;
}

// The studio uid of the object in a slot (ROM export: setup calls name objects by uid).
EMSCRIPTEN_KEEPALIVE
u32 studio_slot_uid(s32 slot) {
    return slot >= 0 && slot < OBJECT_POOL_CAPACITY ? gObjectPool[slot].unused2 : 0;
}
