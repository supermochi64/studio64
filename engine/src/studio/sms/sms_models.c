// Models ported from Super Mario Sunshine, drawn with smooth skinning.
//
// A body's geo layout is just a shadow, a scale and one GEO_ASM(geo_sms_skin) per draw
// layer. The node poses the skeleton from the object's current animation (J3D channels:
// scale, X-Y-Z rotation and translation per joint, segment scale compensation), skins
// every vertex of the layer from its joint weights into a fresh Vtx buffer, lights it
// with the material's colour ramp (baked from the game's TEV programs by the converter)
// and emits the batches: texture setup, gSPVertex and the static triangle lists.
#include <ultra64.h>
#include <math.h>

#include "sm64.h"
#include "macros.h"
#include "geo_commands.h"
#include "object_fields.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "game/memory.h"
#include "game/object_list_processor.h"
#include "game/rendering_graph_node.h"
#include "sms.h"

#include "gen/sms_data.inc.c"

#define MAX_JOINTS 64

typedef f32 SmsMtx[3][4];

static SmsMtx sWorld[MAX_JOINTS];
static f32 sScale[MAX_JOINTS][3];

// A channel's two stored samples around a frame: animated channels keep every other frame
// (and the last), the odd frames are halfway between their neighbours.
static void samples(const struct Animation *a, s32 frame, s32 c, s16 *v0, s16 *v1, f32 *t) {
    const u16 *idx = a->index + c * 2;
    s32 count = idx[0], i = frame >> 1;
    const s16 *v = a->values + idx[1];
    if (count == 1 || i >= count - 1) {
        *v0 = *v1 = v[count == 1 ? 0 : count - 1];
        *t = 0;
        return;
    }
    *v0 = v[i];
    *v1 = v[i + 1];
    *t = (frame & 1) ? 0.5f : 0.0f;
}

static f32 half(s16 h);

static f32 channel_t(const struct Animation *a, s32 frame, s32 c) {
    s16 v0, v1;
    f32 t;
    samples(a, frame, c, &v0, &v1, &t);
    return v0 + (v1 - v0) * t;
}

static s16 channel_r(const struct Animation *a, s32 frame, s32 c) {
    s16 v0, v1;
    f32 t;
    samples(a, frame, c, &v0, &v1, &t);
    return (s16) (v0 + (s16) (v1 - v0) * t);  // the short way round
}

static f32 channel_s(const struct Animation *a, s32 frame, s32 c) {
    s16 v0, v1;
    f32 t, f0;
    samples(a, frame, c, &v0, &v1, &t);
    f0 = half(v0);
    return f0 + (half(v1) - f0) * t;
}

// Scale channels are half floats (IEEE 754 binary16).
static f32 half(s16 h) {
    u32 sgn = ((u16) h >> 15) & 1, e = ((u16) h >> 10) & 0x1F, m = (u16) h & 0x3FF;
    f32 v;
    if (e == 0) {
        v = m / 16777216.0f;  // subnormal: m * 2^-24
    } else {
        v = (1.0f + m / 1024.0f) * (f32) (1 << e) / 32768.0f;  // 2^(e-15)
    }
    return sgn ? -v : v;
}

// The joints' model-space matrices at a frame of an animation.
static void pose(const struct SmsBody *b, const struct Animation *a, s32 frame) {
    s32 j, r, c;
    for (j = 0; j < b->jointCount && j < MAX_JOINTS; j++) {
        s32 base = j * 9;
        f32 sx = channel_s(a, frame, base + 0), sy = channel_s(a, frame, base + 1), sz = channel_s(a, frame, base + 2);
        s16 rx = channel_r(a, frame, base + 3), ry = channel_r(a, frame, base + 4), rz = channel_r(a, frame, base + 5);
        f32 cx = coss(rx), snx = sins(rx), cy = coss(ry), sny = sins(ry), cz = coss(rz), snz = sins(rz);
        SmsMtx l;
        s32 p = b->parents[j];
        // J3D: T * Rz * Ry * Rx * S
        l[0][0] = cy * cz * sx; l[0][1] = (cz * sny * snx - snz * cx) * sy; l[0][2] = (cz * sny * cx + snz * snx) * sz;
        l[1][0] = cy * snz * sx; l[1][1] = (snz * sny * snx + cz * cx) * sy; l[1][2] = (snz * sny * cx - cz * snx) * sz;
        l[2][0] = -sny * sx; l[2][1] = cy * snx * sy; l[2][2] = cy * cx * sz;
        l[0][3] = channel_t(a, frame, base + 6);
        l[1][3] = channel_t(a, frame, base + 7);
        l[2][3] = channel_t(a, frame, base + 8);
        sScale[j][0] = sx; sScale[j][1] = sy; sScale[j][2] = sz;
        if (p < 0 || p >= j) {
            for (r = 0; r < 3; r++) for (c = 0; c < 4; c++) sWorld[j][r][c] = l[r][c];
            continue;
        }
        {
            SmsMtx pm;
            for (r = 0; r < 3; r++) for (c = 0; c < 4; c++) pm[r][c] = sWorld[p][r][c];
            if (b->ssc[j]) {  // the child ignores its parent's scale
                for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) pm[r][c] /= (sScale[p][c] != 0.0f ? sScale[p][c] : 1.0f);
            }
            for (r = 0; r < 3; r++) {
                for (c = 0; c < 4; c++) {
                    sWorld[j][r][c] = pm[r][0] * l[0][c] + pm[r][1] * l[1][c] + pm[r][2] * l[2][c] + (c == 3 ? pm[r][3] : 0.0f);
                }
            }
        }
    }
}

static Gfx *material(Gfx *g, const struct SmsMaterial *m, struct Object *o) {
    gDPPipeSync(g++);
    gSPClearGeometryMode(g++, G_LIGHTING | G_CULL_BOTH);
    gSPSetGeometryMode(g++, G_SHADE | G_SHADING_SMOOTH
                                | ((m->flags & SMS_MF_NOCULL) ? 0 : (m->flags & SMS_MF_CULLFRONT) ? G_CULL_FRONT : G_CULL_BACK));
    if (m->w == 0 || m->tex == NULL) {
        gSPTexture(g++, 0, 0, 0, G_TX_RENDERTILE, G_OFF);
        gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
        return g;
    }
    {
        s32 frame = m->slot == 1 ? o->oSmsEye : m->slot == 2 ? o->oSmsShirt : 0;
        const u8 *tex = m->tex[(u32) frame % (u32) m->texCount];
        s32 ms = 0, mt = 0;
        u32 cms = ((m->flags & SMS_MF_CLAMP_S) ? G_TX_CLAMP : G_TX_WRAP) | ((m->flags & SMS_MF_MIRROR_S) ? G_TX_MIRROR : G_TX_NOMIRROR);
        u32 cmt = ((m->flags & SMS_MF_CLAMP_T) ? G_TX_CLAMP : G_TX_WRAP) | ((m->flags & SMS_MF_MIRROR_T) ? G_TX_MIRROR : G_TX_NOMIRROR);
        while ((1 << ms) < m->w) ms++;
        while ((1 << mt) < m->h) mt++;
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
        gDPSetCombineMode(g++, G_CC_MODULATERGBA, G_CC_MODULATERGBA);
        // gDPLoadTextureBlock caps a load at 2048 texels (the N64's 4 KB of texture memory); the
        // renderer takes up to 4096, so a 64x64 texture is loaded whole with our own LoadBlock
        gDPSetTextureImage(g++, m->fmt, m->siz, 1, tex);
        gDPSetTile(g++, m->fmt, m->siz, 0, 0, G_TX_LOADTILE, 0, cmt, mt, G_TX_NOLOD, cms, ms, G_TX_NOLOD);
        gDPLoadSync(g++);
        g->words.w0 = _SHIFTL(G_LOADBLOCK, 24, 8);
        g->words.w1 = _SHIFTL(G_TX_LOADTILE, 24, 3) | _SHIFTL(MIN(m->w * m->h, 4096) - 1, 12, 12);
        g++;
        gDPPipeSync(g++);
        gDPSetTile(g++, m->fmt, m->siz, (m->w * 2 + 7) >> 3, 0, G_TX_RENDERTILE, 0, cmt, mt, G_TX_NOLOD, cms, ms, G_TX_NOLOD);
        gDPSetTileSize(g++, G_TX_RENDERTILE, 0, 0, (m->w - 1) << G_TEXTURE_IMAGE_FRAC, (m->h - 1) << G_TEXTURE_IMAGE_FRAC);
    }
    return g;
}

// GEO_ASM(body | layer << 8, geo_sms_skin): the body's triangles of one draw layer.
Gfx *geo_sms_skin(s32 callContext, struct GraphNode *node, void *context) {
    struct GraphNodeGenerated *gen = (struct GraphNodeGenerated *) node;
    struct Object *o = (struct Object *) gCurGraphNodeObject;
    s32 bodyIndex = gen->parameter & 0xFF, layer = (gen->parameter >> 8) & 3;
    const struct SmsBody *b;
    const struct Animation *anim;
    f32 (*mtx)[4] = (f32 (*)[4]) context;
    f32 lx, ly, lz, ll, tr = 1.0f, tg = 1.0f, tb = 1.0f;
    s32 nverts = 0, nbatches = 0, i, k, frame, lastMat = -1;
    Vtx *vbuf, *v;
    Gfx *dl, *g;

    if (callContext != GEO_CONTEXT_RENDER || o == NULL || bodyIndex >= gSmsBodyCount) {
        return NULL;
    }
    gen->fnNode.node.flags = (gen->fnNode.node.flags & 0xFF)
                             | ((layer == 3 ? LAYER_TRANSPARENT_DECAL : layer == 2 ? LAYER_TRANSPARENT
                                 : layer == 1 ? LAYER_ALPHA : LAYER_OPAQUE) << 8);
    b = &gSmsBodies[bodyIndex];
    for (i = 0; i < b->batchCount; i++) {
        if (b->mats[b->batches[i].mat].layer == layer && !((o->oSmsHide >> b->batches[i].mat) & 1)) {
            nverts += b->batches[i].count;
            nbatches++;
        }
    }
    if (nverts == 0) {
        return NULL;
    }
    // a placed object whose behavior hasn't run (build mode, thumbnails) stands in its first pose
    if (o->header.gfx.unk38.curAnim == NULL) {
        geo_obj_init_animation(&o->header.gfx, (struct Animation **) &b->anims[0]);
    }
    anim = o->header.gfx.unk38.curAnim;
    if (anim == NULL || anim->unk0A != b->jointCount || anim->index == NULL) {
        anim = b->anims[0];
    }
    frame = o->header.gfx.unk38.animFrame;
    if (frame < 0) frame = 0;
    if (frame >= anim->unk08) frame = anim->unk08 - 1;
    pose(b, anim, frame);
    if (b->yaw != 0) {
        // the model faces another way than SM64's +Z: turn the whole skeleton
        f32 c = coss(b->yaw), sn = sins(b->yaw);
        s32 j, col;
        for (j = 0; j < b->jointCount && j < MAX_JOINTS; j++) {
            for (col = 0; col < 4; col++) {
                f32 x = sWorld[j][0][col], z = sWorld[j][2][col];
                sWorld[j][0][col] = c * x + sn * z;
                sWorld[j][2][col] = -sn * x + c * z;
            }
        }
    }

    // the light comes from the top right, in view space like the game's own lights
    lx = 0.35f; ly = 0.80f; lz = 0.50f;
    if (mtx != NULL) {
        f32 x = mtx[0][0] * lx + mtx[0][1] * ly + mtx[0][2] * lz;
        f32 y = mtx[1][0] * lx + mtx[1][1] * ly + mtx[1][2] * lz;
        f32 z = mtx[2][0] * lx + mtx[2][1] * ly + mtx[2][2] * lz;
        lx = x; ly = y; lz = z;
    }
    ll = sqrtf(lx * lx + ly * ly + lz * lz);
    if (ll > 0.0001f) {
        lx /= ll; ly /= ll; lz /= ll;
    }
    if (o->oSmsTint != 0) {
        tr = ((o->oSmsTint >> 16) & 0xFF) / 255.0f;
        tg = ((o->oSmsTint >> 8) & 0xFF) / 255.0f;
        tb = (o->oSmsTint & 0xFF) / 255.0f;
    }

    vbuf = v = alloc_display_list(nverts * sizeof(Vtx));
    dl = g = alloc_display_list((nbatches * 26 + 8) * sizeof(Gfx));
    if (vbuf == NULL || dl == NULL) {
        return NULL;
    }
    for (i = 0; i < b->batchCount; i++) {
        const struct SmsBatch *bt = &b->batches[i];
        const struct SmsMaterial *m = &b->mats[bt->mat];
        Vtx *first = v;
        if (m->layer != layer || ((o->oSmsHide >> bt->mat) & 1)) {
            continue;
        }
        for (k = 0; k < bt->count; k++, v++) {
            const struct SmsVert *sv = &b->verts[bt->first + k];
            const struct SmsInf *inf = &b->infs[sv->inf];
            f32 px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, wsum = 0, d, nl;
            const u8 *c0, *c1;
            s32 q, ri;
            f32 t;
            for (q = 0; q < sv->infCount; q++, inf++) {
                f32 (*w)[4] = sWorld[inf->joint < MAX_JOINTS ? inf->joint : 0];
                f32 wt = inf->weight, x = inf->pos[0], y = inf->pos[1], z = inf->pos[2];
                f32 ax = inf->nrm[0], ay = inf->nrm[1], az = inf->nrm[2];
                px += wt * (w[0][0] * x + w[0][1] * y + w[0][2] * z + w[0][3]);
                py += wt * (w[1][0] * x + w[1][1] * y + w[1][2] * z + w[1][3]);
                pz += wt * (w[2][0] * x + w[2][1] * y + w[2][2] * z + w[2][3]);
                nx += wt * (w[0][0] * ax + w[0][1] * ay + w[0][2] * az);
                ny += wt * (w[1][0] * ax + w[1][1] * ay + w[1][2] * az);
                nz += wt * (w[2][0] * ax + w[2][1] * ay + w[2][2] * az);
                wsum += wt;
            }
            if (wsum > 0) {
                px /= wsum; py /= wsum; pz /= wsum;
            }
            nl = sqrtf(nx * nx + ny * ny + nz * nz);
            d = nl > 0.0001f ? (nx * lx + ny * ly + nz * lz) / nl : 1.0f;
            if (d < 0 || (m->flags & SMS_MF_UNLIT)) {
                d = (m->flags & SMS_MF_UNLIT) ? 1.0f : 0.0f;
            }
            t = d * (SMS_RAMP - 1);
            ri = (s32) t;
            if (ri >= SMS_RAMP - 1) ri = SMS_RAMP - 2;
            t -= ri;
            c0 = b->ramps[sv->ramp][ri];
            c1 = b->ramps[sv->ramp][ri + 1];
            v->v.ob[0] = (s16) (px < -32768 ? -32768 : px > 32767 ? 32767 : px);
            v->v.ob[1] = (s16) (py < -32768 ? -32768 : py > 32767 ? 32767 : py);
            v->v.ob[2] = (s16) (pz < -32768 ? -32768 : pz > 32767 ? 32767 : pz);
            v->v.flag = 0;
            if ((m->flags & SMS_MF_ENVMAP) && mtx != NULL && nl > 0.0001f) {
                // sphere-mapped like the GameCube's normal texgen: the normal turned into view space
                f32 vx = nx * mtx[0][0] + ny * mtx[1][0] + nz * mtx[2][0];
                f32 vy = nx * mtx[0][1] + ny * mtx[1][1] + nz * mtx[2][1];
                f32 vz = nx * mtx[0][2] + ny * mtx[1][2] + nz * mtx[2][2];
                f32 vl = sqrtf(vx * vx + vy * vy + vz * vz);
                if (vl > 0.0001f) {
                    vx /= vl; vy /= vl;
                }
                v->v.tc[0] = (s16) ((vx * 0.5f + 0.5f) * m->w * 32.0f);
                v->v.tc[1] = (s16) ((0.5f - vy * 0.5f) * m->h * 32.0f);
            } else {
                v->v.tc[0] = sv->uv[0];
                v->v.tc[1] = sv->uv[1];
            }
            {
                f32 r = c0[0] + (c1[0] - c0[0]) * t, gg = c0[1] + (c1[1] - c0[1]) * t, bb = c0[2] + (c1[2] - c0[2]) * t;
                if (m->tint && !(m->layer == 0 && c0[3] == 254)) {  // (254: a part that keeps its colour)
                    r *= tr; gg *= tg; bb *= tb;
                }
                v->v.cn[0] = (u8) r;
                v->v.cn[1] = (u8) gg;
                v->v.cn[2] = (u8) bb;
                v->v.cn[3] = m->layer == 0 ? 255 : c0[3];
            }
        }
        if (bt->mat != lastMat) {
            g = material(g, m, o);
            lastMat = bt->mat;
        }
        gSPVertex(g++, first, bt->count, 0);
        gSPDisplayList(g++, bt->tris);
    }
    gDPPipeSync(g++);
    gSPTexture(g++, 0, 0, 0, G_TX_RENDERTILE, G_OFF);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPEndDisplayList(g++);
    return dl;
}
