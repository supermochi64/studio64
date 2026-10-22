// Studio 64 vehicles: the cars' looks (see vehicle.h). The models are the Shoggoth World hack's
// own (tools/vehicles/extract_cars.py copies them into vehicles/cars.inc.c); here: their sizes,
// the paint recolouring and the wheel callback.
#include <ultra64.h>
#include <stdlib.h>
#include <string.h>

#include "sm64.h"
#include "macros.h"
#include "types.h"
#include "geo_commands.h"
#include "surface_terrains.h"
#include "make_const_nonconst.h"
#include "engine/graph_node.h"
#include "engine/geo_layout.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "actors/group15.h"
#include "game/rendering_graph_node.h"
#include "vehicle.h"

Gfx *geo_studio_car_wheel(s32 callContext, struct GraphNode *node, UNUSED Mat4 *mtx);

#if __has_include("vehicles/cars.inc.c")
#include "vehicles/cars.inc.c"
#else
// No Shoggoth World checkout (tools/vehicles/extract_cars.py makes vehicles/cars.inc.c from it; the
// models are derived from the hack's levels, so they are not in the repository): one empty look keeps
// the tables' shape, and gen_catalog.py leaves the vehicles out of the catalog.
#define STV_STUB 1
static const Gfx *const stv_paint_none[] = { NULL };
static const Gfx *const stv_beams_none[] = { NULL };
static const GeoLayout stv_none_geo[] = { GEO_NODE_START(), GEO_END() };
#define STV_CAR_TABLE { "none", stv_none_geo, NULL, stv_paint_none, stv_beams_none, { -100, 100, 0, 100, -100, 100 } },
#endif

struct StvSource {
    const char *id;
    const GeoLayout *geo;
    const Collision *collision;
    const Gfx *const *paint;
    const Gfx *const *beams;
    s16 box[6];
};
static const struct StvSource sSources[] = { STV_CAR_TABLE };

// The three sports cars share one shape (car_core.inc.c's CAR_* defaults); the other looks are
// measured from their collision boxes. Paint: the hue of the body's lacquer (0 red, 1/2 yellow), -1
// for looks that keep their colours.
struct StvExtra {
    s8 open, wheels, lights, paintHue;
    f32 top;
};
static const struct StvExtra sExtra[] = {
    { 1, 1, 1, 0, 95.0f },   // sportscar: New York's red convertible
    { 1, 1, 1, 0, 120.0f },  // racer: Mario's Shuto racer
    { 1, 1, 1, -1, 120.0f }, // drift_king: the Drift King's car
    { 0, 0, 0, 2, 80.0f },   // taxi
    { 0, 0, 0, -1, 80.0f },  // sedan
    { 0, 0, 0, -1, 58.0f },  // bus
    { 0, 0, 0, -1, 80.0f },  // shuto_van (the Shuto's white van)
    { 0, 0, 0, -1, 85.0f },  // shuto_cab (the Shuto's black cab)
    { 0, 0, 0, -1, 70.0f },  // kei
    { 0, 0, 0, -1, 65.0f },  // kei_truck
    { 0, 0, 0, -1, 0.0f },   // drift_king_driver (not a car)
};

#define LOOK_COUNT ((s32) ARRAY_COUNT(sSources))
struct StudioCarLook gStudioCarLooks[ARRAY_COUNT(sSources)];
s32 gStudioCarLookCount;

static struct AllocOnlyPool sPool;
static struct GraphNode *sNodes[ARRAY_COUNT(sSources)];

static void *pool_alloc_init(void) {
    if (sPool.startPtr == NULL) {
        sPool.totalSpace = 4 * 1024 * 1024;
        sPool.startPtr = sPool.freePtr = malloc(sPool.totalSpace);
        sPool.usedSpace = 0;
    }
    return &sPool;
}

// a box collision for the looks that came without one (Tokyo's kei cars)
static Collision *box_collision(const s16 *b) {
    static const u8 faces[12][3] = { { 0, 1, 2 }, { 0, 2, 3 }, { 4, 6, 5 }, { 4, 7, 6 }, { 0, 4, 5 }, { 0, 5, 1 },
                                     { 1, 5, 6 }, { 1, 6, 2 }, { 2, 6, 7 }, { 2, 7, 3 }, { 3, 7, 4 }, { 3, 4, 0 } };
    Collision *c = malloc(sizeof(Collision) * (2 + 24 + 3 + 36 + 2));
    s32 i, n = 0, x0 = b[0], x1 = b[1], y0 = 0, y1 = b[3] - 10, z0 = b[4], z1 = b[5];
    s32 v[8][3] = { { x0, y1, z0 }, { x0, y1, z1 }, { x1, y1, z1 }, { x1, y1, z0 },
                    { x0, y0, z0 }, { x0, y0, z1 }, { x1, y0, z1 }, { x1, y0, z0 } };
    c[n++] = TERRAIN_LOAD_VERTICES;
    c[n++] = 8;
    for (i = 0; i < 8; i++) {
        c[n++] = v[i][0];
        c[n++] = v[i][1];
        c[n++] = v[i][2];
    }
    c[n++] = SURFACE_DEFAULT;
    c[n++] = 12;
    for (i = 0; i < 12; i++) {
        c[n++] = faces[i][0];
        c[n++] = faces[i][1];
        c[n++] = faces[i][2];
    }
    c[n++] = TERRAIN_LOAD_CONTINUE;
    c[n++] = TERRAIN_LOAD_END;
    return c;
}

static void looks_init(void) {
    s32 i, k;
    if (gStudioCarLookCount) {
        return;
    }
    for (i = 0; i < LOOK_COUNT; i++) {
        const struct StvSource *s = &sSources[i];
        struct StudioCarLook *l = &gStudioCarLooks[i];
        f32 hl, hw, h;
        l->id = s->id;
        l->geo = s->geo;
        l->collision = s->collision != NULL ? (const void *) s->collision : (const void *) box_collision(s->box);
        l->open = sExtra[i].open;
        l->wheels = sExtra[i].wheels;
        l->lights = sExtra[i].lights;
        l->top = sExtra[i].top;
        // the size: from the collision's vertices
        {
            const Collision *c = l->collision;
            s32 nv = c[1];
            f32 mx = 0, mz = 0, my = 0;
            for (k = 0; k < nv; k++) {
                mx = MAX(mx, ABS(c[2 + k * 3]));
                my = MAX(my, c[3 + k * 3]);
                mz = MAX(mz, ABS(c[4 + k * 3]));
            }
            hw = mx > 0 ? mx : 100.0f;
            hl = mz > 0 ? mz : 230.0f;
            h = my > 0 ? my : 150.0f;
        }
        if (l->wheels) {
            // the sports cars (car_core.inc.c)
            l->halfLen = 232.0f;
            l->halfW = 106.0f;
            l->axleF = 140.0f;
            l->axleR = -150.0f;
            l->track = 88.0f;
            l->wheelR = 36.0f;
            l->seat[0] = 48.0f;
            l->seat[1] = 46.0f;
            l->seat[2] = 4.0f;
            l->doorX = 172.0f;
            l->doorZ = 40.0f;
            l->height = 90.0f;
        } else {
            l->halfLen = hl;
            l->halfW = hw;
            l->height = h;
            l->axleF = hl * 0.62f;
            l->axleR = -hl * 0.62f;
            l->track = hw * 0.8f;
            l->wheelR = 34.0f;
            l->seat[0] = hw * 0.42f;
            l->seat[1] = MIN(60.0f, h * 0.3f);
            l->seat[2] = hl * 0.12f;
            l->doorX = hw + 66.0f;
            l->doorZ = hl * 0.12f;
        }
    }
    gStudioCarLookCount = LOOK_COUNT;
}

s32 studio_car_look_of(struct Object *o) {
    s32 i;
    struct GraphNode *n = (struct GraphNode *) o->header.gfx.sharedChild;
    looks_init();
    if (n == NULL) {
        return -1;
    }
    for (i = 0; i < LOOK_COUNT; i++) {
        if (n == sNodes[i]) {
            return i;
        }
    }
    // a repainted copy, or the studio's own copy of the geo layout
    for (i = 0; i < LOOK_COUNT; i++) {
        extern struct GraphNode *studio_geo_node(const GeoLayout *geo);
        if (n == studio_geo_node(sSources[i].geo)) {
            return i;
        }
    }
    {
        extern s32 studio_car_paint_look(struct GraphNode *n);
        return studio_car_paint_look(n);
    }
}

// ---------------------------------------------------------------------------
// Paint: a copy of the model whose body display lists draw from recoloured vertices.

#define MAX_PAINTS 32
static struct { s32 look; u32 paint; struct GraphNode *node; } sPaints[MAX_PAINTS];
static s32 sPaintCount;

s32 studio_car_paint_look(struct GraphNode *n) {
    s32 i;
    for (i = 0; i < sPaintCount; i++) {
        if (sPaints[i].node == n) {
            return sPaints[i].look;
        }
    }
    return -1;
}

static void rgb_to_hsv(f32 r, f32 g, f32 b, f32 *h, f32 *s, f32 *v) {
    f32 mx = MAX(r, MAX(g, b)), mn = MIN(r, MIN(g, b)), d = mx - mn;
    *v = mx;
    *s = mx > 0 ? d / mx : 0;
    if (d <= 0) {
        *h = 0;
    } else if (mx == r) {
        *h = (g - b) / d / 6.0f;
    } else if (mx == g) {
        *h = ((b - r) / d + 2) / 6.0f;
    } else {
        *h = ((r - g) / d + 4) / 6.0f;
    }
    if (*h < 0) {
        *h += 1.0f;
    }
}

// one of the look's lacquer colours -> the same light on the new paint
static void repaint(u8 *c, s32 hue, u32 paint) {
    f32 h, s, v, d, base, white;
    f32 r = c[0] / 255.0f, g = c[1] / 255.0f, b = c[2] / 255.0f;
    f32 pr = ((paint >> 16) & 0xFF) / 255.0f, pg = ((paint >> 8) & 0xFF) / 255.0f, pb = (paint & 0xFF) / 255.0f;
    rgb_to_hsv(r, g, b, &h, &s, &v);
    d = ABS(h * 12.0f - hue);
    if (d > 6.0f) {
        d = 12.0f - d;
    }
    if (s < 0.4f || v < 0.12f || d > 1.6f) {
        return;
    }
    // the gloss adds white to every channel; the rest is the paint lit
    white = MIN(r, MIN(g, b));
    base = v - white;
    {
        f32 pm = MAX(pr, MAX(pg, pb));
        f32 k = pm > 0.01f ? base / pm : 0;
        f32 out[3] = { pr * k + white, pg * k + white, pb * k + white };
        s32 i;
        if (pm < 0.01f) { // black: a dark lacquer with the same gloss
            out[0] = out[1] = out[2] = base * 0.18f + white;
        }
        for (i = 0; i < 3; i++) {
            f32 x = out[i] * 255.0f;
            c[i] = (u8) (x < 0 ? 0 : x > 255 ? 255 : x);
        }
    }
}

static Gfx *repaint_dl(const Gfx *src, s32 hue, u32 paint) {
    s32 n = 0, i;
    Gfx *dl;
    while (((src[n].words.w0 >> 24) & 0xFF) != (u8) G_ENDDL && n < 100000) {
        n++;
    }
    dl = malloc(sizeof(Gfx) * (n + 1));
    memcpy(dl, src, sizeof(Gfx) * (n + 1));
    for (i = 0; i < n; i++) {
        if (((dl[i].words.w0 >> 24) & 0xFF) == G_VTX) {
            s32 count = (dl[i].words.w0 >> 12) & 0xFF, k;
            Vtx *v = malloc(sizeof(Vtx) * count);
            memcpy(v, (const void *) dl[i].words.w1, sizeof(Vtx) * count);
            for (k = 0; k < count; k++) {
                repaint(v[k].v.cn, hue, paint);
            }
            dl[i].words.w1 = (uintptr_t) v;
        }
    }
    return dl;
}

// the headlights' see-through layer without the beams on the road (triangles ahead of the bumper)
static Gfx *strip_beams(const Gfx *src) {
    s32 n = 0, i;
    Gfx *dl;
    const Vtx *buf = NULL;
    s32 base = 0;
    while (((src[n].words.w0 >> 24) & 0xFF) != (u8) G_ENDDL && n < 100000) {
        n++;
    }
    dl = malloc(sizeof(Gfx) * (n + 1));
    memcpy(dl, src, sizeof(Gfx) * (n + 1));
    for (i = 0; i < n; i++) {
        u32 op = (dl[i].words.w0 >> 24) & 0xFF;
        if (op == G_VTX) {
            s32 count = (dl[i].words.w0 >> 12) & 0xFF;
            buf = (const Vtx *) dl[i].words.w1;
            base = ((dl[i].words.w0 >> 1) & 0x7F) - count;
        } else if ((op == G_TRI1 || op == G_TRI2) && buf != NULL) {
            s32 k;
            for (k = 0; k < (op == G_TRI2 ? 2 : 1); k++) {
                u32 w = k == 0 ? (u32) dl[i].words.w0 : (u32) dl[i].words.w1;
                s32 a = ((w >> 16) & 0xFF) / 2 - base, b = ((w >> 8) & 0xFF) / 2 - base, c = (w & 0xFF) / 2 - base;
                if (a >= 0 && b >= 0 && c >= 0 && buf[a].v.ob[2] > 240 && buf[b].v.ob[2] > 240 && buf[c].v.ob[2] > 240) {
                    // a degenerate triangle: nothing drawn
                    u32 keep = w & 0xFF000000u, v = (w >> 16) & 0xFF;
                    w = keep | (v << 16) | (v << 8) | v;
                    if (k == 0) dl[i].words.w0 = w; else dl[i].words.w1 = w;
                }
            }
        }
    }
    return dl;
}

static void repaint_tree(struct GraphNode *root, struct GraphNode *n, s32 look, u32 paint, s32 depth) {
    s32 beams = (paint & STV_BEAMS) != 0;
    u32 rgb = paint & 0xFFFFFF;
    struct GraphNode *c = n;
    if (n == NULL || depth > 32) {
        return;
    }
    do {
        if (c->type == GRAPH_NODE_TYPE_DISPLAY_LIST) {
            struct GraphNodeDisplayList *d = (struct GraphNodeDisplayList *) c;
            const Gfx *const *p;
            for (p = sSources[look].paint; rgb != 0 && *p != NULL; p++) {
                if (d->displayList == (void *) *p) {
                    d->displayList = repaint_dl(*p, sExtra[look].paintHue, rgb);
                    break;
                }
            }
            for (p = sSources[look].beams; !beams && *p != NULL; p++) {
                if (d->displayList == (void *) *p) {
                    d->displayList = strip_beams(*p);
                    break;
                }
            }
        }
        repaint_tree(root, c->children, look, paint, depth + 1);
        c = c->next;
    } while (c != n);
}

struct GraphNode *studio_car_look_node(s32 look, u32 paint, s32 *painted) {
    s32 i;
    looks_init();
    if (look < 0 || look >= LOOK_COUNT) {
        return NULL;
    }
    if (painted) {
        *painted = FALSE;
    }
    if (sNodes[look] == NULL) {
        extern struct GraphNode *studio_geo_node(const GeoLayout *geo);
        sNodes[look] = studio_geo_node(sSources[look].geo);
    }
    if (sExtra[look].paintHue < 0) {
        paint &= ~0xFFFFFFu;
    }
    if (sSources[look].beams[0] == NULL) {
        paint |= STV_BEAMS;
    }
    if (paint == STV_BEAMS) {
        return sNodes[look];
    }
    for (i = 0; i < sPaintCount; i++) {
        if (sPaints[i].look == look && sPaints[i].paint == paint) {
            if (painted) *painted = TRUE;
            return sPaints[i].node;
        }
    }
    if (sPaintCount >= MAX_PAINTS) {
        return sNodes[look];
    }
    {
        struct GraphNode *n = process_geo_layout(pool_alloc_init(), (void *) sSources[look].geo);
        repaint_tree(n, n, look, paint, 0);
        sPaints[sPaintCount].look = look;
        sPaints[sPaintCount].paint = paint;
        sPaints[sPaintCount].node = n;
        sPaintCount++;
        if (painted) *painted = TRUE;
        return n;
    }
}

// ---------------------------------------------------------------------------
// The wheels roll and steer, the steering wheel turns: a GEO_ASM above each wheel's rotation node
// (courses/car/models.py sportscar wheels_asm), its parameter the part (0-3 wheels, 4 the steering
// wheel). The car being drawn tells its angles first (vehicle.c, vehicle_race.c).

static s16 sSpin, sSteer;

void studio_car_set_wheels(s16 spin, s16 steer) {
    sSpin = spin;
    sSteer = steer;
}

Gfx *geo_studio_car_wheel(s32 callContext, struct GraphNode *node, UNUSED Mat4 *mtx) {
    if (callContext == GEO_CONTEXT_RENDER) {
        struct GraphNodeGenerated *gen = (struct GraphNodeGenerated *) node;
        struct GraphNodeRotation *rot = (struct GraphNodeRotation *) node->next;
        s32 idx = gen->parameter;
        extern void studio_car_wheels_for(struct Object *o, s16 *spin, s16 *steer);
        s16 spin = sSpin, steer = sSteer;
        if (gCurGraphNodeObject != NULL) {
            studio_car_wheels_for((struct Object *) gCurGraphNodeObject, &spin, &steer);
        }
        if (idx < 4) {
            // (the right-hand wheels, 1 and 3, are the left one turned round)
            rot->rotation[0] = (idx & 1) ? -spin : spin;
            rot->rotation[1] = (idx < 2 ? steer : 0) + ((idx & 1) ? 0x8000 : 0);
            rot->rotation[2] = 0;
        } else {
            rot->rotation[0] = 0;
            rot->rotation[1] = 0;
            rot->rotation[2] = steer * 3;
        }
    }
    return NULL;
}
