/**
 * Shotgun Mario, ported from Shoggoth World (src/game/shoggoth/overlay/shotgun.c, which
 * reimplements the mechanics of Dorrieal's "Shotgun Mario 64"; docs/shoggoth/SHOTGUN.md there,
 * docs/shotgun.md here). The numbers are that hack's; the gun model and the effect textures come from
 * Shoggoth World's course generator (courses/hd/shotgun_model.py, extracted by tools/shotgun_extract.py
 * into studio/shotgun/models.inc.c). studio/shotgun.h is the interface.
 *
 * Differences to the N64 original: resident code instead of an overlay (it sleeps until Mario has the
 * gun); hooks are direct calls from mario.c / camera.c / hud.c / rendering_graph_node.c instead of
 * gShHooks; the gun is drawn from the torso's animated part (no GEO_ASM nodes in Mario's model, so every
 * Mario model works); shots hit every SM64 enemy, the Sunshine characters, custom objects and boxes
 * (sg_react below); the game rule / story actions / pickup decide when he has it.
 *
 * A blast is five pellets (hitscan rays, 5461 units): one down the middle and four in a fixed
 * pattern whose angles shrink with the distance of what the middle one hit, so the pattern keeps
 * about the same size on the target (a choke). Objects in the path of the blast -- up to 8 of them
 * -- are hit: the blast is a ray with a ~111-unit tolerance round each object's hitbox, walls in the
 * way block it. Walls take bullet holes, smoke, sparks and chips.
 */
#include <ultra64.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#endif

#include "sm64.h"
#include "types.h"
#include "behavior_data.h"
#include "object_constants.h"
#include "object_fields.h"
#include "audio_defines.h"
#include "audio/external.h"
#include "engine/behavior_script.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/game_init.h"
#include "game/hud.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/rendering_graph_node.h"
#include "game/spawn_sound.h"
#include "game/behavior_actions.h"
#include "studio/sms/sms.h"
#include "shotgun.h"
#include "katana.h"

#ifndef NUM_CELLS // (engine/surface_collision.h: 32 since the level bounds are +-16384)
#define NUM_CELLS 16
#endif

void obj_spawn_yellow_coins(struct Object *obj, s8 nCoins);   // (obj_behaviors.c)

// the gun and the effect textures (studio/shotgun_objects.c includes the data)
#include "studio/shotgun_models.h" // (the generated models, or stand-ins)
extern const BehaviorScript bhvStudioGangster[];
extern const BehaviorScript bhvStudioGangsterBullet[];
extern const BehaviorScript bhvStudioActor[];
extern const BehaviorScript bhvSmsPianta[];

// ---------------------------------------------------------------------------------------- tuning
// (Shotgun Mario 64 v1.0.5's values; see docs/shotgun.md)
#define SG_COOLDOWN        26          // frames from one blast to the next
#define SG_PUMP_START      15          // the pump racks while the cooldown runs 15 -> 5
#define SG_PUMP_FRAMES     10
#define SG_RANGE           5461.0f
#define SG_CHOKE           0.00375f    // pattern angle divisor = max(distance * SG_CHOKE, 3)
#define SG_TOLERANCE       111.0f      // how far beside a hitbox the blast still hits it
#define SG_MAX_OBJS        8           // objects one blast can hit
#define SG_SHOT_HEIGHT     100.0f      // blasts start this high above Mario's feet
#define SG_AIR_BOOST       54.0f       // the shotgun jump: up speed at least this ...
#define SG_AIR_BOOST_SLOW  36.0f       //   (... this out of a long jump or a slide kick)
#define SG_AIR_BOOST_ADD   10.0f       //   or this much more if he is already rising faster
#define SG_AIM_TURN_MAX    1100        // aim mode: C-button turn speed (per frame) ...
#define SG_AIM_TURN_ACCEL  183         //   ... reached this fast
#define SG_AIM_PITCH_MIN   (-9102)     // (camera below Mario, looking up)
#define SG_AIM_PITCH_MAX   10922
#define SG_AIM_SIDE        75.0f       // the aim camera looks past his right shoulder
#define SG_AIM_DIST        620.0f      // aim camera distance: this + SG_AIM_DIST_PITCH * sin(pitch)
#define SG_AIM_DIST_PITCH  800.0f

#define SG_FIRE_BUTTONS    (B_BUTTON | L_TRIG)
#define SG_MUZZLE_X        78.0f       // the muzzle in gun space (courses/hd/shotgun_model.py)
#define SG_MUZZLE_Y        8.8f
#define SG_PUMP_TRAVEL     12.0f       // how far the fore-end racks back
#define SG_CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))

extern u16 *gCurrAnimAttribute;    // (rendering_graph_node.c: where the skeleton is being drawn)

// the four outer pellets: (pitch, yaw) offsets before the choke divides them
static const s16 sSgPattern[4][2] = { { 4915, 2730 }, { 4915, -2730 }, { -1274, 5461 }, { -1274, -5461 } };

// ---------------------------------------------------------------------------------------- state
struct ShotgunHit gShotgunHit;
struct ShotgunHit gShotgunHits[SHOTGUN_MAX_HITS];
s32 gShotgunHitCount;
s32 gStudioShotgunDraw;
static s32 sSgShots;             // blasts fired since the level started
static s32 sSgObjHits;           // objects hit, all blasts together
static u8 sSgEnabled;
static u8 sSgByRule;             // he has it because of the game rule (not a pickup or the story)
static u8 sSgRule;               // the game rule "Mario starts with the shotgun" here
static u8 sSgAim;                // aim mode on
static u8 sSgAirShotUsed;        // the shotgun jump is spent until he lands
static s8 sSgTimer;              // cooldown after a blast (SG_COOLDOWN .. 0)
static s8 sSgAirShot;            // frames left of the "gun pointed down" pose after a shotgun jump
static s8 sSgFlash;              // muzzle flash frames left
static s16 sSgNoFire;            // frames of no shooting (studio_shotgun_suppress)
static s16 sSgAimYaw, sSgAimPitch; // aim mode: where the camera wants to be (yaw of the camera from Mario)
static s16 sSgCamYaw, sSgCamPitch; //   and where it is
static s16 sSgTurnSpeed;
static f32 sSgCamY;
static Vec3f sSgMuzzle;          // the muzzle, world space (from the last frame's drawing)
static Vec3f sSgLastFrom, sSgLastDir;
static f32 sSgLastDist;          // what the middle pellet of the last blast hit, and how far
static f32 sSgAirBoostVel;       // his up speed right after the last shotgun jump
static s16 sSgDecalCount, sSgPartCount;
static f32 sSgArmWeight, sSgAimWeight;
static Mat4 sSgGunNow;           // this frame's gun placement: gun space -> torso model space
static Mat4 sSgTorsoView, sSgView;      // his torso and the camera as last drawn
static Vec3f sSgDrawnAt;                // where he was then
static u8 sSgDrawn;
static f32 sSgWAim, sSgWDown, sSgKick, sSgPump, sSgTwist;
static s32 sSgDrawFrame = -1;           // the frame the world effects were last queued in

// bosses and tough objects add up blasts before they react (cleared when the level starts)
#define SG_TOUGH 8
static struct { struct Object *obj; s16 blasts; } sSgTough[SG_TOUGH];

// ---------------------------------------------------------------------------------------- poses
// Joint rotations (anim units) for Mario's torso and arms (his animated parts 2..11: torso, head,
// left shoulder, arm, forearm, hand, right shoulder, arm, forearm, hand), blended over his animation.
#define SG_J0      2
#define SG_JOINTS 10
#define DEG(x)    ((s16) ((x) * 65536.0f / 360.0f))
enum { SG_POSE_HOLD, SG_POSE_AIM, SG_POSE_DOWN, SG_POSE_PUMP, SG_POSE_KICK, SG_POSES };
enum { SG_GUN_HOLD, SG_GUN_AIM, SG_GUN_DOWN, SG_GUN_KICK, SG_GUN_SLUNG, SG_GUN_PLACES };
// a joint the pose leaves to the animation
#define SG_KEEP   0x7FFF
#define SG_AIM_TWIST DEG(-28)     // (Shoggoth World tools/shoggoth/sg_poses.py TWIST)
// Solved by Shoggoth World's tools/shoggoth/sg_poses.py (inverse kinematics on his skeleton): the
// fists on the grip and under the pump; the gun's place in torso space per pose.
static const s16 sSgPoses[SG_POSES][SG_JOINTS][3] = {
    { // HOLD
        { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP },
        { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP },
        { DEG(180), DEG(180), DEG(92) }, { DEG(34), DEG(-15), DEG(-78) }, { 0, 0, DEG(-61) }, { DEG(2), DEG(31), DEG(-75) },
    },
    { // AIM
        { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP },
        { DEG(180), DEG(180), DEG(92) }, { DEG(39), DEG(18), DEG(-162) }, { 0, 0, DEG(-10) }, { DEG(-42), DEG(20), DEG(-40) },
        { DEG(180), DEG(180), DEG(92) }, { DEG(-50), DEG(40), DEG(-136) }, { 0, 0, DEG(-107) }, { DEG(16), DEG(-18), DEG(-89) },
    },
    { // DOWN
        { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP },
        { DEG(180), DEG(180), DEG(92) }, { DEG(33), DEG(36), DEG(-117) }, { 0, 0, DEG(0) }, { DEG(-33), DEG(5), DEG(-17) },
        { DEG(180), DEG(180), DEG(92) }, { DEG(-62), DEG(27), DEG(-125) }, { 0, 0, DEG(-97) }, { DEG(33), DEG(-7), DEG(-77) },
    },
    { // PUMP
        { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP },
        { DEG(180), DEG(180), DEG(92) }, { DEG(62), DEG(16), DEG(-149) }, { 0, 0, DEG(-31) }, { DEG(-50), DEG(26), DEG(-59) },
        { DEG(180), DEG(180), DEG(92) }, { DEG(-50), DEG(40), DEG(-136) }, { 0, 0, DEG(-107) }, { DEG(16), DEG(-18), DEG(-89) },
    },
    { // KICK
        { SG_KEEP, SG_KEEP, SG_KEEP }, { SG_KEEP, SG_KEEP, SG_KEEP },
        { DEG(180), DEG(180), DEG(92) }, { DEG(25), DEG(27), DEG(-163) }, { 0, 0, DEG(-27) }, { DEG(-75), DEG(-3), DEG(-56) },
        { DEG(180), DEG(180), DEG(92) }, { DEG(-41), DEG(42), DEG(-144) }, { 0, 0, DEG(-123) }, { DEG(20), DEG(-15), DEG(-99) },
    },
};
static const f32 sSgGunPlace[SG_GUN_PLACES][4][3] = {
    { // HOLD
        { 3.9995f, -0.0619f, 0.0001f },
        { -0.0619f, -3.9995f, -0.0004f },
        { 0.0001f, 0.0004f, -4.0000f },
        { -29.8112f, 28.7953f, -114.9985f },
    },
    { // AIM
        { 1.0277f, 3.4131f, 1.8152f },
        { 3.8657f, -0.9074f, -0.4825f },
        { 0.0001f, 1.8782f, -3.5316f },
        { 47.5112f, 33.8569f, -46.6151f },
    },
    { // DOWN
        { -3.3619f, 2.1589f, 0.1905f },
        { 2.1638f, 3.3233f, 0.5235f },
        { 0.1242f, 0.5430f, -3.9610f },
        { 36.1434f, 30.1106f, -30.9969f },
    },
    { // KICK
        { 2.4010f, 2.8246f, 1.5023f },
        { 3.1993f, -2.1198f, -1.1273f },
        { 0.0001f, 1.8782f, -3.5316f },
        { 59.5397f, 16.9355f, -55.6141f },
    },
    { // SLUNG
        { 3.0493f, -2.5079f, 0.6421f },
        { 0.3050f, 1.3333f, 3.7589f },
        { -2.5708f, -2.8165f, 1.2076f },
        { -4.6187f, -60.5795f, 15.9943f },
    },
};

// ---------------------------------------------------------------------------------------- effects
enum { SG_FX_SMOKE, SG_FX_SPARK, SG_FX_PIECE, SG_FX_FLASH, SG_FX_KINDS };
struct SgPart {
    Vec3f pos, vel;
    f32 size, floorY;
    s16 life, maxLife;
    s16 rx, ry;
    u8 kind, shade;
};
#define SG_MAX_PARTS  72
#define SG_MAX_SMOKE  24
#define SG_MAX_SPARKS 28
#define SG_MAX_PIECES 24
#define SG_MAX_DECALS 32
static struct SgPart sSgParts[SG_MAX_PARTS];
static s16 sSgKindCount[SG_FX_KINDS];
struct SgDecal {
    Mtx mtx;
    s16 age;
    u8 alive;
    struct Object *obj;     // the hole is in this object's collision (a block): gone when it moves
    Vec3f objPos;
};
static struct SgDecal sSgDecals[SG_MAX_DECALS];
static s16 sSgDecalNext;

// ======================================================================================== helpers
static f32 sg_absf(f32 x) {
    return x < 0.0f ? -x : x;
}

static f32 sg_randf(void) {
    return random_float();
}

static f32 sg_rand_signed(void) {
    return random_float() * 2.0f - 1.0f;
}

static void sg_dir(Vec3f dir, s16 pitch, s16 yaw) {
    dir[0] = sins(yaw) * coss(pitch);
    dir[1] = sins(pitch);
    dir[2] = coss(yaw) * coss(pitch);
}

/**
 * A point on a surface's triangle? (p on its plane)
 */
static s32 sg_in_triangle(struct Surface *s, Vec3f p) {
    f32 n0 = s->normal.x, n1 = s->normal.y, n2 = s->normal.z;
    f32 ax = s->vertex1[0], ay = s->vertex1[1], az = s->vertex1[2];
    f32 bx = s->vertex2[0], by = s->vertex2[1], bz = s->vertex2[2];
    f32 cx = s->vertex3[0], cy = s->vertex3[1], cz = s->vertex3[2];
    f32 ex, ey, ez, px, py, pz;

    ex = bx - ax; ey = by - ay; ez = bz - az; px = p[0] - ax; py = p[1] - ay; pz = p[2] - az;
    if ((ey * pz - ez * py) * n0 + (ez * px - ex * pz) * n1 + (ex * py - ey * px) * n2 < -1.0f) {
        return FALSE;
    }
    ex = cx - bx; ey = cy - by; ez = cz - bz; px = p[0] - bx; py = p[1] - by; pz = p[2] - bz;
    if ((ey * pz - ez * py) * n0 + (ez * px - ex * pz) * n1 + (ex * py - ey * px) * n2 < -1.0f) {
        return FALSE;
    }
    ex = ax - cx; ey = ay - cy; ez = az - cz; px = p[0] - cx; py = p[1] - cy; pz = p[2] - cz;
    if ((ey * pz - ez * py) * n0 + (ez * px - ex * pz) * n1 + (ex * py - ey * px) * n2 < -1.0f) {
        return FALSE;
    }
    return TRUE;
}

static struct Surface *sRayHit;
static struct Object *sRayIgnore;
static f32 sRayBest;

static void sg_ray_list(struct SurfaceNode *node, Vec3f o, Vec3f d, f32 yLo, f32 yHi) {
    struct Surface *s;
    f32 denom, t;
    Vec3f p;

    for (; node != NULL; node = node->next) {
        s = node->surface;
        if (s->upperY < yLo || s->lowerY > yHi) {
            continue;
        }
        denom = s->normal.x * d[0] + s->normal.y * d[1] + s->normal.z * d[2];
        if (denom > -0.0001f) {             // back faces (and edge-on) don't stop shots
            continue;
        }
        t = -(s->normal.x * o[0] + s->normal.y * o[1] + s->normal.z * o[2] + s->originOffset) / denom;
        if (t < 0.0f || t >= sRayBest) {
            continue;
        }
        if (s->object != NULL && s->object == sRayIgnore) {
            continue;
        }
        p[0] = o[0] + d[0] * t;
        p[1] = o[1] + d[1] * t;
        p[2] = o[2] + d[2] * t;
        if (sg_in_triangle(s, p)) {
            sRayBest = t;
            sRayHit = s;
        }
    }
}

/**
 * Casts a ray (d a unit vector) through the collision cells it crosses: returns the distance to the
 * first surface it hits front-on (maxDist if none) and that surface in *hitSurf.
 */
static f32 sg_raycast(Vec3f o, Vec3f d, f32 maxDist, struct Surface **hitSurf, struct Object *ignore) {
    f32 fx = o[0] + LEVEL_BOUNDARY_MAX, fz = o[2] + LEVEL_BOUNDARY_MAX;
    s32 cx, cz, stepX, stepZ, i;
    f32 tMaxX, tMaxZ, tDeltaX, tDeltaZ, t0, t1, y0, y1;

    sRayHit = NULL;
    sRayBest = maxDist;
    sRayIgnore = ignore;
    cx = (s32) floorf(fx / CELL_SIZE);
    cz = (s32) floorf(fz / CELL_SIZE);
    stepX = d[0] >= 0.0f ? 1 : -1;
    stepZ = d[2] >= 0.0f ? 1 : -1;
    if (sg_absf(d[0]) < 0.0001f) {
        tMaxX = tDeltaX = 1.0e9f;
    } else {
        tDeltaX = CELL_SIZE / sg_absf(d[0]);
        tMaxX = ((stepX > 0 ? (cx + 1) * CELL_SIZE : cx * CELL_SIZE) - fx) / d[0];
    }
    if (sg_absf(d[2]) < 0.0001f) {
        tMaxZ = tDeltaZ = 1.0e9f;
    } else {
        tDeltaZ = CELL_SIZE / sg_absf(d[2]);
        tMaxZ = ((stepZ > 0 ? (cz + 1) * CELL_SIZE : cz * CELL_SIZE) - fz) / d[2];
    }
    t0 = 0.0f;
    for (i = 0; i < 64; i++) {
        t1 = MIN(MIN(tMaxX, tMaxZ), sRayBest);
        if (cx >= 0 && cx < NUM_CELLS && cz >= 0 && cz < NUM_CELLS) {
            y0 = o[1] + d[1] * t0;
            y1 = o[1] + d[1] * t1;
            if (y0 > y1) {
                f32 tmp = y0;
                y0 = y1;
                y1 = tmp;
            }
            sg_ray_list(gStaticSurfacePartition[cz][cx][SPATIAL_PARTITION_WALLS].next, o, d, y0, y1);
            sg_ray_list(gStaticSurfacePartition[cz][cx][SPATIAL_PARTITION_FLOORS].next, o, d, y0, y1);
            sg_ray_list(gStaticSurfacePartition[cz][cx][SPATIAL_PARTITION_CEILS].next, o, d, y0, y1);
            sg_ray_list(gDynamicSurfacePartition[cz][cx][SPATIAL_PARTITION_WALLS].next, o, d, y0, y1);
            sg_ray_list(gDynamicSurfacePartition[cz][cx][SPATIAL_PARTITION_FLOORS].next, o, d, y0, y1);
            sg_ray_list(gDynamicSurfacePartition[cz][cx][SPATIAL_PARTITION_CEILS].next, o, d, y0, y1);
        }
        if (t1 >= sRayBest) {
            break;
        }
        t0 = t1;
        if (tMaxX < tMaxZ) {
            cx += stepX;
            tMaxX += tDeltaX;
        } else {
            cz += stepZ;
            tMaxZ += tDeltaZ;
        }
    }
    *hitSurf = sRayHit;
    return sRayBest;
}

f32 studio_shotgun_ray_clear(Vec3f from, Vec3f to) {
    Vec3f d;
    struct Surface *s;
    f32 len;

    vec3f_set(d, to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    len = sqrtf(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (len < 1.0f) {
        return len;
    }
    d[0] /= len;
    d[1] /= len;
    d[2] /= len;
    return sg_raycast(from, d, len, &s, NULL);
}

/**
 * Ray (unit d) against an axis-aligned ellipsoid (radii r, h, r): the entry distance, or -1.
 */
static f32 sg_ray_ellipsoid(Vec3f o, Vec3f d, Vec3f c, f32 r, f32 h) {
    f32 ox = (o[0] - c[0]) / r, oy = (o[1] - c[1]) / h, oz = (o[2] - c[2]) / r;
    f32 dx = d[0] / r, dy = d[1] / h, dz = d[2] / r;
    f32 a = dx * dx + dy * dy + dz * dz;
    f32 b = ox * dx + oy * dy + oz * dz;
    f32 cc = ox * ox + oy * oy + oz * oz - 1.0f;
    f32 disc = b * b - a * cc;
    f32 t;

    if (disc < 0.0f) {
        return -1.0f;
    }
    disc = sqrtf(disc);
    t = (-b - disc) / a;
    if (t < 0.0f) {
        t = (-b + disc) / a;    // starting inside it
        if (t < 0.0f) {
            return -1.0f;
        }
        return 0.0f;
    }
    return t;
}

// ======================================================================================== effects
static struct SgPart *sg_part(s32 kind) {
    static const s16 caps[SG_FX_KINDS] = { SG_MAX_SMOKE, SG_MAX_SPARKS, SG_MAX_PIECES, 4 };
    s32 i;

    if (sSgKindCount[kind] >= caps[kind]) {
        return NULL;
    }
    for (i = 0; i < SG_MAX_PARTS; i++) {
        if (sSgParts[i].life <= 0) {
            sSgParts[i].kind = kind;
            sSgParts[i].rx = sSgParts[i].ry = 0;
            sSgParts[i].floorY = -20000.0f;
            sSgKindCount[kind]++;
            return &sSgParts[i];
        }
    }
    return NULL;
}

static void sg_smoke(Vec3f pos, f32 size, s32 life) {
    struct SgPart *p = sg_part(SG_FX_SMOKE);

    if (p != NULL) {
        vec3f_copy(p->pos, pos);
        p->vel[0] = sg_rand_signed() * 0.8f;
        p->vel[1] = 1.2f + sg_randf();
        p->vel[2] = sg_rand_signed() * 0.8f;
        p->size = size;
        p->life = p->maxLife = life;
        p->shade = 150 + (u8) (sg_randf() * 60.0f);
    }
}

static void sg_spark(Vec3f pos, f32 size) {
    struct SgPart *p = sg_part(SG_FX_SPARK);

    if (p != NULL) {
        vec3f_copy(p->pos, pos);
        p->vel[0] = sg_rand_signed() * 9.0f;
        p->vel[1] = sg_randf() * 10.0f;
        p->vel[2] = sg_rand_signed() * 9.0f;
        p->size = size;
        p->life = p->maxLife = 5 + (s16) (sg_randf() * 5.0f);
    }
}

/**
 * The muzzle flash as seen from anywhere: a big hot star for two frames at the muzzle.
 */
static void sg_flash(Vec3f pos) {
    struct SgPart *p = sg_part(SG_FX_FLASH);

    if (p != NULL) {
        vec3f_copy(p->pos, pos);
        vec3f_set(p->vel, 0.0f, 0.0f, 0.0f);
        p->size = 55.0f + sg_randf() * 25.0f;
        p->life = p->maxLife = 2;
    }
}

static void sg_piece(Vec3f pos, Vec3f vel) {
    struct SgPart *p = sg_part(SG_FX_PIECE);
    struct Surface *floor;

    if (p != NULL) {
        vec3f_copy(p->pos, pos);
        // (SGM64: a random kick of +-10, -20..+20, +-10 on top of the push off the wall)
        p->vel[0] = vel[0] + sg_randf() * 20.0f - 10.0f;
        p->vel[1] = vel[1] + sg_randf() * 40.0f - 20.0f;
        p->vel[2] = vel[2] + sg_randf() * 20.0f - 10.0f;
        p->size = 0.45f + sg_randf() * 0.5f;
        p->life = p->maxLife = 30 + (s16) (sg_randf() * 12.0f);
        p->rx = random_u16();
        p->ry = random_u16();
        p->shade = 90 + (u8) (sg_randf() * 70.0f);
        p->floorY = find_floor(pos[0], pos[1] + 50.0f, pos[2], &floor);
    }
}

/**
 * A bullet hole: a quad lying on the surface, lifted off it a hair (decal z mode does the rest).
 */
static void sg_decal(Vec3f pos, struct Surface *s) {
    struct SgDecal *dc = &sSgDecals[sSgDecalNext];

    dc->obj = s->object;
    if (s->object != NULL) {
        vec3f_set(dc->objPos, s->object->oPosX, s->object->oPosY, s->object->oPosZ);
    }
    Mat4 m;
    Vec3f x, y, z;
    f32 size = (9.0f + sg_randf() * 5.0f) / 16.0f;     // (the quad is 32 across)
    s16 roll = random_u16();

    sSgDecalNext = (sSgDecalNext + 1) % SG_MAX_DECALS;
    z[0] = s->normal.x;
    z[1] = s->normal.y;
    z[2] = s->normal.z;
    if (sg_absf(z[1]) > 0.9f) {
        vec3f_set(x, coss(roll), 0.0f, sins(roll));
    } else {
        vec3f_set(x, z[2], 0.0f, -z[0]);    // up x normal: horizontal along the wall
    }
    vec3f_normalize(x);
    vec3f_cross(y, z, x);
    vec3f_normalize(y);
    vec3f_cross(x, y, z);
    m[0][0] = x[0] * size; m[0][1] = x[1] * size; m[0][2] = x[2] * size; m[0][3] = 0.0f;
    m[1][0] = y[0] * size; m[1][1] = y[1] * size; m[1][2] = y[2] * size; m[1][3] = 0.0f;
    m[2][0] = z[0] * size; m[2][1] = z[1] * size; m[2][2] = z[2] * size; m[2][3] = 0.0f;
    m[3][0] = pos[0] + z[0] * 1.5f; m[3][1] = pos[1] + z[1] * 1.5f; m[3][2] = pos[2] + z[2] * 1.5f;
    m[3][3] = 1.0f;
    mtxf_to_mtx(&dc->mtx, m);
    dc->age = 0;
    dc->alive = TRUE;
}

/**
 * What one pellet does to the wall (floor, ceiling) it hits.
 */
static void sg_impact(Vec3f hit, struct Surface *s) {
    Vec3f p, v;
    s32 i;

    // no holes in things that move (a standing block takes them; they go if it moves later)
    if (s->object == NULL || (s->object->oVelX == 0.0f && s->object->oVelY == 0.0f && s->object->oVelZ == 0.0f
                              && s->object->oAngleVelYaw == 0 && s->object->oAngleVelPitch == 0
                              && s->object->oAngleVelRoll == 0 && s->object->oForwardVel == 0.0f)) {
        sg_decal(hit, s);
    }
    vec3f_set(p, hit[0] + s->normal.x * 30.0f, hit[1] + s->normal.y * 30.0f, hit[2] + s->normal.z * 30.0f);
    sg_smoke(p, 22.0f + sg_randf() * 12.0f, 16 + (s32) (sg_randf() * 8.0f));
    // chips thrown off the wall (SGM64: 20 / 35 / 20 along the normal)
    vec3f_set(v, s->normal.x * 20.0f, s->normal.y * 35.0f, s->normal.z * 20.0f);
    for (i = 0; i < 2; i++) {
        vec3f_set(p, hit[0] + s->normal.x * 6.0f, hit[1] + s->normal.y * 6.0f, hit[2] + s->normal.z * 6.0f);
        sg_piece(p, v);
    }
    for (i = 0; i < 2; i++) {
        vec3f_set(p, hit[0] + s->normal.x * 8.0f + sg_rand_signed() * 12.0f, hit[1] + s->normal.y * 8.0f + sg_rand_signed() * 12.0f,
                  hit[2] + s->normal.z * 8.0f + sg_rand_signed() * 12.0f);
        sg_spark(p, 6.0f + sg_randf() * 12.0f);
    }
}

/**
 * Sparks and a puff on an object that took pellets (SGM64: e__sg_obj_shot_sparks).
 */
static void sg_obj_sparks(struct Object *obj, s32 count) {
    f32 r = obj->hitboxRadius, h = obj->hitboxHeight;
    Vec3f p;
    s32 i;

    for (i = 0; i < count; i++) {
        vec3f_set(p, obj->oPosX + sg_rand_signed() * r * 0.6f, obj->oPosY - obj->hitboxDownOffset + sg_randf() * h,
                  obj->oPosZ + sg_rand_signed() * r * 0.6f);
        sg_spark(p, 8.0f + sg_randf() * 10.0f);
    }
    vec3f_set(p, obj->oPosX, obj->oPosY - obj->hitboxDownOffset + h * 0.5f, obj->oPosZ);
    sg_smoke(p, 30.0f, 18);
}

void studio_shotgun_fx_burst(struct Object *obj, s32 pieces) {
    Vec3f p, v;
    f32 r = obj->hitboxRadius, h = obj->hitboxHeight;
    s32 i;

    for (i = 0; i < pieces; i++) {
        vec3f_set(p, obj->oPosX + sg_rand_signed() * r * 0.5f, obj->oPosY - obj->hitboxDownOffset + sg_randf() * h,
                  obj->oPosZ + sg_rand_signed() * r * 0.5f);
        vec3f_set(v, 0.0f, 20.0f, 0.0f);
        sg_piece(p, v);
        sg_spark(p, 10.0f + sg_randf() * 12.0f);
        if (i % 3 == 0) {
            sg_smoke(p, 40.0f, 22);
        }
    }
}

static void sg_update_effects(void) {
    struct SgPart *p;
    s32 i, n = 0;

    for (i = 0; i < SG_MAX_PARTS; i++) {
        p = &sSgParts[i];
        if (p->life <= 0) {
            continue;
        }
        n++;
        p->pos[0] += p->vel[0];
        p->pos[1] += p->vel[1];
        p->pos[2] += p->vel[2];
        switch (p->kind) {
            case SG_FX_SMOKE:
                p->vel[0] *= 0.92f;
                p->vel[2] *= 0.92f;
                p->size *= 1.045f;
                break;
            case SG_FX_SPARK:
                p->vel[1] -= 2.0f;
                break;
            case SG_FX_PIECE:
                p->vel[1] -= 3.0f;
                p->rx += 0x1400;
                p->ry += 0x0D00;
                if (p->pos[1] < p->floorY) {
                    p->pos[1] = p->floorY;
                    p->vel[1] *= -0.35f;
                    p->vel[0] *= 0.5f;
                    p->vel[2] *= 0.5f;
                }
                break;
        }
        if (--p->life <= 0) {
            sSgKindCount[p->kind]--;
        }
    }
    sSgPartCount = n;
    n = 0;
    for (i = 0; i < SG_MAX_DECALS; i++) {
        struct Object *obj = sSgDecals[i].obj;

        if (sSgDecals[i].alive && obj != NULL
            && (obj->activeFlags == ACTIVE_FLAG_DEACTIVATED || obj->oPosX != sSgDecals[i].objPos[0]
                || obj->oPosY != sSgDecals[i].objPos[1] || obj->oPosZ != sSgDecals[i].objPos[2])) {
            sSgDecals[i].alive = FALSE;
        }
        if (sSgDecals[i].alive) {
            n++;
            if (sSgDecals[i].age < 0x7FFF) {
                sSgDecals[i].age++;
            }
        }
    }
    sSgDecalCount = n;
}

static void sg_clear_effects(void) {
    s32 i;

    for (i = 0; i < SG_MAX_PARTS; i++) {
        sSgParts[i].life = 0;
    }
    for (i = 0; i < SG_FX_KINDS; i++) {
        sSgKindCount[i] = 0;
    }
    for (i = 0; i < SG_MAX_DECALS; i++) {
        sSgDecals[i].alive = FALSE;
    }
    for (i = 0; i < SG_TOUGH; i++) {
        sSgTough[i].obj = NULL;
    }
    sSgDecalNext = 0;
    sSgDecalCount = sSgPartCount = 0;
}

// ======================================================================================== what a hit does
// Studio 64's generalisation of Shoggoth World's contract: every SM64 enemy, the Sunshine characters,
// custom objects, gangsters and boxes react to the blast the way their own code expects a hit.
enum {
    SGR_NONE,       // not shootable (Mario, friends, coins, projectiles, the level)
    SGR_ATTACK,     // the slide-kick status: the object's own code reacts (knocked back, defeated, broken)
    SGR_ARMOUR,     // sparks off it, nothing else (Bowser, Thwomps, invincible custom objects, ...)
    SGR_BOBOMB,     // a bob-omb: it goes off
    SGR_CORK_BOX,   // a cork box / jumping box: it breaks (coins)
    SGR_CHUCKYA,    // two blasts and it bursts (coins)
    SGR_KING_BOBOMB,// three blasts are one hit (as if he had been thrown)
    SGR_PIANTA,     // a Pianta / Noki gets mad (they are friends: nothing worse)
};

static s32 sg_is(struct Object *obj, const BehaviorScript *bhv) {
    return obj->behavior == segmented_to_virtual(bhv);
}

static s32 sg_react_kind(struct Object *obj) {
    if (obj == gMarioObject || obj->activeFlags == ACTIVE_FLAG_DEACTIVATED) {
        return SGR_NONE;
    }
    if (obj->hitboxRadius <= 0.0f || obj->hitboxHeight <= 0.0f) {
        return SGR_NONE;
    }
    if (sg_is(obj, bhvStudioGangsterBullet)) {
        return SGR_NONE;
    }
    // (these work while intangible too: Piantas talk through it, King Bob-omb blinks between hits)
    if (sg_is(obj, bhvSmsPianta)) {
        return SGR_PIANTA;
    }
    if (obj->oIntangibleTimer != 0) {
        return SGR_NONE;
    }
    if (sg_is(obj, bhvStudioGangster) || kt_fighter_is(obj)) {
        return SGR_ATTACK;          // (a katana fighter counts a blast as one cut: katana_fighters.c)
    }
    if (sg_is(obj, bhvBobomb)) {
        return obj->oHeldState == HELD_FREE ? SGR_BOBOMB : SGR_NONE;
    }
    if (sg_is(obj, bhvBreakableBoxSmall) || sg_is(obj, bhvJumpingBox)) {
        return obj->oHeldState == HELD_FREE ? SGR_CORK_BOX : SGR_NONE;
    }
    if (sg_is(obj, bhvChuckya)) {
        return obj->oHeldState == HELD_FREE ? SGR_CHUCKYA : SGR_NONE;
    }
    if (sg_is(obj, bhvKingBobomb)) {
        return SGR_KING_BOBOMB;
    }
    if (sg_is(obj, bhvBowser) || sg_is(obj, bhvHeaveHo)) {
        return SGR_ARMOUR;
    }
    switch (obj->oInteractType) {
        case INTERACT_BOUNCE_TOP:
        case INTERACT_BOUNCE_TOP2:
        case INTERACT_HIT_FROM_BELOW:
        case INTERACT_KOOPA:
        case INTERACT_BULLY:
        case INTERACT_BREAKABLE:
        case INTERACT_MR_BLIZZARD:
        case INTERACT_CLAM_OR_BUBBA:
        case INTERACT_UNKNOWN_08:
            return SGR_ATTACK;
        case INTERACT_DAMAGE:
        case INTERACT_SHOCK:
            // a body, not a fireball: the shot glances off
            return (obj->hitboxRadius >= 60.0f && obj->hitboxHeight >= 60.0f) ? SGR_ARMOUR : SGR_NONE;
    }
    return SGR_NONE;
}

// blasts this object took so far (bosses and tough things count up)
static s32 sg_tough_blasts(struct Object *obj) {
    s32 i, free = -1;

    for (i = 0; i < SG_TOUGH; i++) {
        if (sSgTough[i].obj == obj) {
            return ++sSgTough[i].blasts;
        }
        if (sSgTough[i].obj == NULL || sSgTough[i].obj->activeFlags == ACTIVE_FLAG_DEACTIVATED) {
            free = i;
        }
    }
    if (free < 0) {
        free = 0;
    }
    sSgTough[free].obj = obj;
    sSgTough[free].blasts = 1;
    return 1;
}

static void sg_tough_reset(struct Object *obj) {
    s32 i;

    for (i = 0; i < SG_TOUGH; i++) {
        if (sSgTough[i].obj == obj) {
            sSgTough[i].obj = NULL;
        }
    }
}

// Runs obj's helpers (they work on gCurrentObject) from Mario's step.
#define SG_AS(obj, code) do { struct Object *sgSaved_ = gCurrentObject; gCurrentObject = (obj); code; gCurrentObject = sgSaved_; } while (0)

static void sg_react(struct Object *obj, s32 kind, Vec3f dir) {
    switch (kind) {
        case SGR_ATTACK:
            obj->oInteractStatus |= INT_STATUS_INTERACTED | INT_STATUS_WAS_ATTACKED | ATTACK_FAST_ATTACK;
            break;
        case SGR_BOBOMB:
            obj->oAction = BOBOMB_ACT_EXPLODE;
            obj->oTimer = 0;
            break;
        case SGR_CORK_BOX:
            SG_AS(obj, {
                spawn_mist_particles();
                spawn_triangle_break_particles(20, 138, 0.7f, 3);
                obj_spawn_yellow_coins(obj, 3);
                create_sound_spawner(SOUND_GENERAL_BREAK_BOX);
            });
            obj->activeFlags = ACTIVE_FLAG_DEACTIVATED;
            break;
        case SGR_CHUCKYA:
            if (sg_tough_blasts(obj) >= 2) {
                sg_tough_reset(obj);
                SG_AS(obj, {
                    obj_spawn_loot_yellow_coins(obj, 5, 20.0f);
                    spawn_mist_particles_with_sound(SOUND_OBJ_CHUCKYA_DEATH);
                });
                studio_shotgun_fx_burst(obj, 8);
                obj_mark_for_deletion(obj);
            } else {
                obj->oForwardVel = -20.0f;     // staggered back
                obj->oMoveAngleYaw = atan2s(-dir[2], -dir[0]);
            }
            break;
        case SGR_KING_BOBOMB:
            // only while he walks the summit (oAction 2: between the dialog and being thrown)
            if (obj->oAction == 2 && obj->oHeldState == HELD_FREE && sg_tough_blasts(obj) >= 3) {
                sg_tough_reset(obj);
                obj->oHealth--;
                obj->oForwardVel = 0.0f;
                obj->oVelY = 0.0f;
                obj->oAction = obj->oHealth > 0 ? 6 : 7;
                obj->oSubAction = 0;
                obj->oTimer = 0;
                SG_AS(obj, cur_obj_play_sound_2(SOUND_OBJ_KING_BOBOMB));
            }
            break;
        case SGR_PIANTA:
            // PIANTA_MAD (studio/sms/pianta.c); not while he talks
            if (obj->oAction != 3 && obj->oAction != 5) {
                obj->oAction = 5;
                obj->oSubAction = 0;
                obj->oTimer = 0;
                obj->oForwardVel = 0.0f;
            }
            break;
    }
}

// The same reactions for the katana's cuts (studio/katana.c): which, and do it (the story's "is hit" event too).
s32 studio_weapon_react_kind(struct Object *obj) {
    return sg_react_kind(obj);
}

void studio_weapon_react(struct Object *obj, s32 kind, Vec3f dir) {
    sg_react(obj, kind, dir);
    if (obj->unused2 != 0 && !sg_is(obj, bhvStudioActor)) {
        EM_ASM({ if (Module.studioObjectEvent) Module.studioObjectEvent($0 >>> 0, 4); }, obj->unused2);
    }
}

// the last blast's hits, for studio_shotgun_state_json (tests, the AI)
static struct { s16 slot, kind, action, pellets; u32 uid; } sSgLog[SG_MAX_OBJS];
static s32 sSgLogCount;

static void sg_record_hit(struct Object *obj, Vec3f dir, s32 pellets, s32 kind) {
    struct ShotgunHit *h;

    sg_react(obj, kind, dir);
    if (sSgLogCount < SG_MAX_OBJS) {
        sSgLog[sSgLogCount].slot = (s16) (obj - gObjectPool);
        sSgLog[sSgLogCount].kind = kind;
        sSgLog[sSgLogCount].action = (s16) obj->oAction;
        sSgLog[sSgLogCount].pellets = pellets;
        sSgLog[sSgLogCount].uid = obj->unused2;
        sSgLogCount++;
    }
    gShotgunHit.obj = obj;
    vec3f_copy(gShotgunHit.dir, dir);
    gShotgunHit.pellets = pellets;
    if (gShotgunHitCount < SHOTGUN_MAX_HITS) {
        h = &gShotgunHits[gShotgunHitCount++];
        *h = gShotgunHit;
    }
    sSgObjHits++;
    // the studio's events: "a custom object reacts: is hit" works for anything placed and shot
    // (custom objects report their own hits)
    if (obj->unused2 != 0 && !sg_is(obj, bhvStudioActor)) {
        EM_ASM({ if (Module.studioObjectEvent) Module.studioObjectEvent($0 >>> 0, 4); }, obj->unused2);
    }
}

/**
 * The objects in the blast's path: returns how many were hit.
 */
static s32 sg_hit_objects(Vec3f o, Vec3f dir, Vec3f pellets[5], f32 wallDist, s32 *armour) {
    static const u8 lists[] = { OBJ_LIST_PUSHABLE, OBJ_LIST_GENACTOR, OBJ_LIST_DESTRUCTIVE, OBJ_LIST_LEVEL,
                                OBJ_LIST_DEFAULT, OBJ_LIST_SURFACE, OBJ_LIST_POLELIKE };
    struct ObjectNode *head;
    struct Object *obj;
    struct Surface *s;
    Vec3f c, toC;
    f32 r, h, dist, tol, t;
    s32 li, k, n, kind, hits = 0;

    *armour = 0;
    sSgLogCount = 0;
    for (li = 0; li < (s32) sizeof(lists); li++) {
        head = &gObjectLists[lists[li]];
        for (obj = (struct Object *) head->next; obj != (struct Object *) head;
             obj = (struct Object *) obj->header.next) {
            if (hits >= SG_MAX_OBJS) {
                return hits;
            }
            kind = sg_react_kind(obj);
            if (kind == SGR_NONE) {
                continue;
            }
            r = obj->hitboxRadius;
            h = obj->hitboxHeight * 0.5f;
            vec3f_set(c, obj->oPosX, obj->oPosY - obj->hitboxDownOffset + h, obj->oPosZ);
            vec3f_set(toC, c[0] - o[0], c[1] - o[1], c[2] - o[2]);
            dist = sqrtf(toC[0] * toC[0] + toC[1] * toC[1] + toC[2] * toC[2]);
            if (dist > SG_RANGE + r || dist - r > wallDist + 40.0f) {
                continue;
            }
            // behind the muzzle?
            if (toC[0] * dir[0] + toC[1] * dir[1] + toC[2] * dir[2] < -r) {
                continue;
            }
            tol = MIN(dist, SG_TOLERANCE);
            n = 0;
            for (k = 0; k < 5; k++) {
                if (sg_ray_ellipsoid(o, pellets[k], c, r + 12.0f, h + 12.0f) >= 0.0f) {
                    n++;
                }
            }
            if (n == 0) {
                t = sg_ray_ellipsoid(o, dir, c, r + tol, h + tol);
                if (t < 0.0f) {
                    continue;
                }
                n = 1;
            }
            // a wall in between?
            vec3f_normalize(toC);
            sg_raycast(o, toC, MAX(dist - r * 0.7f, 1.0f), &s, obj);
            if (s != NULL) {
                continue;
            }
            sg_record_hit(obj, dir, n, kind);
            sg_obj_sparks(obj, kind == SGR_ARMOUR ? 6 : 3);
            if (kind == SGR_ARMOUR) {
                (*armour)++;
            }
            hits++;
        }
    }
    return hits;
}

/**
 * Where the muzzle is with the gun in pose `place` (from his torso as last drawn, moved along with
 * him since): the flash and the smoke come out there.
 */
static s32 sg_muzzle_for(s32 place, Vec3f out) {
    f32 gx = SG_MUZZLE_X, gy = SG_MUZZLE_Y;
    Vec3f t;
    Mat4 m;
    s32 c;

    if (!sSgDrawn) {
        return FALSE;
    }
    for (c = 0; c < 3; c++) {
        t[c] = gx * sSgGunPlace[place][0][c] + gy * sSgGunPlace[place][1][c] + sSgGunPlace[place][3][c];
    }
    for (c = 0; c < 3; c++) {
        m[3][c] = t[0] * sSgTorsoView[0][c] + t[1] * sSgTorsoView[1][c] + t[2] * sSgTorsoView[2][c] + sSgTorsoView[3][c];
    }
    get_pos_from_transform_mtx(out, m, sSgView);
    for (c = 0; c < 3; c++) {
        out[c] += gMarioState->pos[c] - sSgDrawnAt[c];
    }
    return TRUE;
}

/**
 * One blast from `o` (pitch/yaw): five pellets, the effects where they land, the objects hit.
 */
static void sg_blast(Vec3f o, s16 pitch, s16 yaw, s32 place) {
    Vec3f dir, pellets[5], hit, p;
    struct Surface *s;
    f32 d0, d, div;
    s32 i, hits, armour;

    sSgShots++;
    sSgFlash = 3;
    sg_dir(dir, pitch, yaw);
    vec3f_copy(pellets[0], dir);
    vec3f_copy(sSgLastFrom, o);
    vec3f_copy(sSgLastDir, dir);
    play_sound(SOUND_OBJ_POUNDING_CANNON, gMarioState->marioObj->header.gfx.cameraToObject);
    set_camera_shake_from_hit(SHAKE_ATTACK);
    // flash and smoke out of the muzzle (where it was drawn last frame, if he has been drawn)
    if (sg_muzzle_for(place, p)) {
        vec3f_copy(sSgMuzzle, p);
    } else {
        vec3f_set(p, o[0] + dir[0] * 80.0f, o[1] + dir[1] * 80.0f, o[2] + dir[2] * 80.0f);
    }
    sg_flash(p);
    p[0] += dir[0] * 25.0f;
    p[1] += dir[1] * 25.0f;
    p[2] += dir[2] * 25.0f;
    sg_smoke(p, 30.0f, 14);

    d0 = sg_raycast(o, dir, SG_RANGE, &s, NULL);
    sSgLastDist = d0;
    if (s != NULL) {
        vec3f_set(hit, o[0] + dir[0] * d0, o[1] + dir[1] * d0, o[2] + dir[2] * d0);
        sg_impact(hit, s);
    }
    div = MAX(d0 * SG_CHOKE, 3.0f);
    for (i = 0; i < 4; i++) {
        sg_dir(pellets[i + 1], pitch + (s16) (sSgPattern[i][0] / div), yaw + (s16) (sSgPattern[i][1] / div));
        d = sg_raycast(o, pellets[i + 1], SG_RANGE, &s, NULL);
        if (s != NULL) {
            vec3f_set(hit, o[0] + pellets[i + 1][0] * d, o[1] + pellets[i + 1][1] * d, o[2] + pellets[i + 1][2] * d);
            sg_impact(hit, s);
        }
    }
    hits = sg_hit_objects(o, dir, pellets, d0, &armour);
    if (hits > armour) {
        play_sound(SOUND_ACTION_HIT_2, gShotgunHit.obj->header.gfx.cameraToObject);
    } else if (armour > 0) {
        play_sound(SOUND_ACTION_METAL_BONK, gShotgunHit.obj->header.gfx.cameraToObject);
    }
}

// ======================================================================================== Mario
static s32 sg_can_fire_ground(struct MarioState *m) {
    u32 a = m->action;
    u32 group = a & ACT_GROUP_MASK;

    if (group != ACT_GROUP_STATIONARY && group != ACT_GROUP_MOVING) {
        return FALSE;
    }
    if (a & (ACT_FLAG_INTANGIBLE | ACT_FLAG_INVULNERABLE | ACT_FLAG_SHORT_HITBOX | ACT_FLAG_RIDING_SHELL
             | ACT_FLAG_SWIMMING | ACT_FLAG_HANGING | ACT_FLAG_ON_POLE)) {
        return FALSE;
    }
    if (a == ACT_SLEEPING || a == ACT_START_SLEEPING || a == ACT_WAKING_UP || a == ACT_SHOCKWAVE_BOUNCE
        || a == ACT_BURNING_GROUND || a == ACT_QUICKSAND_JUMP_LAND) {
        return FALSE;
    }
    return m->heldObj == NULL;
}

static s32 sg_can_fire_air(struct MarioState *m) {
    u32 a = m->action;

    if ((a & ACT_GROUP_MASK) != ACT_GROUP_AIRBORNE) {
        return FALSE;
    }
    if (a & (ACT_FLAG_INTANGIBLE | ACT_FLAG_INVULNERABLE | ACT_FLAG_HANGING | ACT_FLAG_ON_POLE | ACT_FLAG_SWIMMING)) {
        return FALSE;
    }
    if (a == ACT_GROUND_POUND || a == ACT_AIR_HIT_WALL || a == ACT_LAVA_BOOST || a == ACT_BURNING_JUMP
        || a == ACT_BURNING_FALL || a == ACT_FLYING || a == ACT_VERTICAL_WIND || a == ACT_GETTING_BLOWN
        || a == ACT_SHOT_FROM_CANNON || a == ACT_THROWN_FORWARD || a == ACT_THROWN_BACKWARD) {
        return FALSE;
    }
    return m->heldObj == NULL;
}

/**
 * Aim mode: where the crosshair points. The shot leaves Mario's chest toward what the camera's
 * centre ray meets (so the crosshair is honest even though the camera is behind and above him).
 */
static void sg_aim_shot(struct MarioState *m, Vec3f from, s16 *pitch, s16 *yaw) {
    struct Surface *s;
    Vec3f camDir, target, focus;
    s16 cp = -sSgCamPitch, cy = sSgCamYaw + 0x8000;
    f32 d;

    vec3f_set(focus, m->pos[0] - coss(sSgCamYaw + 0x8000) * SG_AIM_SIDE, sSgCamY,
              m->pos[2] + sins(sSgCamYaw + 0x8000) * SG_AIM_SIDE);
    sg_dir(camDir, cp, cy);
    d = sg_raycast(focus, camDir, SG_RANGE, &s, NULL);
    vec3f_set(target, focus[0] + camDir[0] * d, focus[1] + camDir[1] * d, focus[2] + camDir[2] * d);
    vec3f_get_dist_and_angle(from, target, &d, pitch, yaw);
}

static void sg_fire_ground(struct MarioState *m) {
    Vec3f o;
    s16 pitch, yaw;

    vec3f_set(o, m->pos[0], m->pos[1] + SG_SHOT_HEIGHT, m->pos[2]);
    if (sSgAim) {
        sg_aim_shot(m, o, &pitch, &yaw);
    } else if (m->action == ACT_FIRST_PERSON) {     // (C-up: where he looks, as in SGM64)
        f32 d;

        vec3f_get_dist_and_angle(gLakituState.pos, gLakituState.focus, &d, &pitch, &yaw);
    } else {
        pitch = m->faceAngle[0];
        yaw = m->faceAngle[1];
    }
    sSgTimer = SG_COOLDOWN;
    sg_blast(o, pitch, yaw, SG_GUN_KICK);
}

/**
 * The shotgun jump: a blast straight down from just ahead of him, and up he goes.
 */
static void sg_fire_air(struct MarioState *m) {
    Vec3f o;
    f32 boost = (m->action == ACT_LONG_JUMP || m->action == ACT_SLIDE_KICK) ? SG_AIR_BOOST_SLOW : SG_AIR_BOOST;

    vec3f_set(o, m->pos[0] + sins(m->faceAngle[1]) * 100.0f, m->pos[1] + SG_SHOT_HEIGHT,
              m->pos[2] + coss(m->faceAngle[1]) * 100.0f);
    if (m->vel[1] < boost) {
        m->vel[1] = boost;
    } else {
        m->vel[1] += SG_AIR_BOOST_ADD;
    }
    m->flags &= ~MARIO_UNKNOWN_08;          // no jump cut: letting go of A doesn't eat the boost
    sSgAirBoostVel = m->vel[1];
    sSgAirShotUsed = TRUE;
    sSgAirShot = 12;
    sSgTimer = SG_COOLDOWN;
    sg_blast(o, -0x4000, m->faceAngle[1], SG_GUN_DOWN);
}

void studio_shotgun_before_step(struct MarioState *m) {
    u16 down, pressed;

    gShotgunHit.obj = NULL;
    gShotgunHitCount = 0;
    if (!sSgEnabled || gPlayer1Controller == NULL) {
        return;
    }
    if (studio_katana_blade_prompt(m)) {
        return;                     // (B at the Legendary Blade pulls it: studio/katana.c)
    }
    down = gPlayer1Controller->buttonDown;
    pressed = gPlayer1Controller->buttonPressed;
    // B is the trigger now: no punches, kicks or dives
    m->input &= ~INPUT_B_PRESSED;

    if (pressed & R_TRIG) {
        sSgAim ^= 1;
        if (sSgAim) {
            sSgAimYaw = sSgCamYaw = m->faceAngle[1] + 0x8000;
            sSgAimPitch = sSgCamPitch = 0x0800;
            sSgCamY = m->pos[1] + 230.0f;
            play_sound(SOUND_MENU_CAMERA_ZOOM_IN, gDefaultSoundArgs);
        } else {
            play_sound(SOUND_MENU_CAMERA_ZOOM_OUT, gDefaultSoundArgs);
        }
    }
    if (!(m->action & ACT_FLAG_AIR)) {
        sSgAirShotUsed = FALSE;
    }
    if (sSgNoFire > 0) {
        sSgNoFire--;
        return;
    }
    if (sg_can_fire_air(m)) {
        if ((pressed & SG_FIRE_BUTTONS) && !sSgAirShotUsed) {
            sg_fire_air(m);
        }
    } else if (sg_can_fire_ground(m)) {
        if ((down & SG_FIRE_BUTTONS) && sSgTimer == 0) {
            sg_fire_ground(m);
        }
    }
}

static void sg_update_pose(struct MarioState *m);

void studio_shotgun_after_step(struct MarioState *m) {
    if (!sSgEnabled) {
        // (the effects of the last blasts still settle after the gun is taken away)
        if (sSgPartCount > 0 || sSgDecalCount > 0) {
            sg_update_effects();
        }
        return;
    }
    // the pump
    if (sSgTimer == SG_PUMP_START) {
        play_sound(SOUND_GENERAL_DOOR_TURN_KEY, m->marioObj->header.gfx.cameraToObject);
    } else if (sSgTimer == SG_PUMP_START - SG_PUMP_FRAMES / 2) {
        play_sound(SOUND_GENERAL_DOOR_INSERT_KEY, m->marioObj->header.gfx.cameraToObject);
    }
    if (sSgTimer > 0) {
        sSgTimer--;
    }
    if (sSgFlash > 0) {
        sSgFlash--;
    }
    if (sSgAirShot > 0) {
        sSgAirShot--;
    }
    // fists: the gun is gripped whatever his hands were doing
    m->marioBodyState->handState = MARIO_HAND_FISTS;
    // aim mode: standing, he turns to where the crosshair is
    if (sSgAim && (m->action & ACT_GROUP_MASK) == ACT_GROUP_STATIONARY
        && !(m->action & (ACT_FLAG_INTANGIBLE | ACT_FLAG_INVULNERABLE))) {
        m->faceAngle[1] = approach_s16_symmetric(m->faceAngle[1], (s16) (sSgCamYaw + 0x8000), 0x1800);
        m->marioObj->header.gfx.angle[1] = m->faceAngle[1];
    }
    sg_update_effects();
    sg_update_pose(m);
}

// ======================================================================================== camera
s32 studio_shotgun_camera(struct Camera *c) {
    struct MarioState *m = gMarioState;
    u16 down;
    struct Surface *s;
    Vec3f focus, back;
    f32 goalY, dist, maxDist;

    if (!sSgAim || !sSgEnabled || m == NULL || m->marioObj == NULL || gPlayer1Controller == NULL) {
        return FALSE;
    }
    down = gPlayer1Controller->buttonDown;
    if (down & (L_CBUTTONS | R_CBUTTONS | U_CBUTTONS | D_CBUTTONS)) {
        sSgTurnSpeed = approach_s16_symmetric(sSgTurnSpeed, SG_AIM_TURN_MAX, SG_AIM_TURN_ACCEL);
    } else {
        sSgTurnSpeed = 0;
    }
    if (down & L_CBUTTONS) {
        sSgAimYaw += sSgTurnSpeed;
    }
    if (down & R_CBUTTONS) {
        sSgAimYaw -= sSgTurnSpeed;
    }
    if (down & U_CBUTTONS) {
        sSgAimPitch -= sSgTurnSpeed / 2;
    }
    if (down & D_CBUTTONS) {
        sSgAimPitch += sSgTurnSpeed / 2;
    }
    sSgAimPitch = SG_CLAMP(sSgAimPitch, SG_AIM_PITCH_MIN, SG_AIM_PITCH_MAX);
    sSgCamYaw += (s16) (sSgAimYaw - sSgCamYaw) / 3;
    sSgCamPitch += (s16) (sSgAimPitch - sSgCamPitch) / 3;

    // the orbit centre: a little above his head, following him down only slowly
    goalY = m->floorHeight + 230.0f;
    if (m->pos[1] + 150.0f > goalY) {
        goalY = m->pos[1] + 150.0f;
    }
    sSgCamY += (goalY - sSgCamY) * 0.35f;
    // over his right shoulder (SGM64 centres him; a little to the side shows the gun)
    vec3f_set(focus, m->pos[0] - coss(sSgCamYaw + 0x8000) * SG_AIM_SIDE, sSgCamY,
              m->pos[2] + sins(sSgCamYaw + 0x8000) * SG_AIM_SIDE);
    // SGM64: 1000 + 1200 sin(pitch) (farther looking down, closer looking up); ours is closer, so the
    // gun reads, and never inside his head
    maxDist = SG_AIM_DIST + SG_AIM_DIST_PITCH * sins(sSgCamPitch);
    if (maxDist < 240.0f) {
        maxDist = 240.0f;
    }
    sg_dir(back, sSgCamPitch, sSgCamYaw);
    dist = sg_raycast(focus, back, maxDist, &s, NULL);
    if (s != NULL) {
        dist = MAX(dist - 40.0f, 60.0f);
    }
    vec3f_copy(c->focus, focus);
    vec3f_set(c->pos, focus[0] + back[0] * dist, focus[1] + back[1] * dist, focus[2] + back[2] * dist);
    c->yaw = sSgCamYaw;
    return TRUE;
}

// ======================================================================================== HUD
static void sg_rect(s32 x0, s32 y0, s32 x1, s32 y1) {
    gDPFillRectangle(gDisplayListHead++, x0, y0, x1, y1);
}

void studio_shotgun_hud(void) {
    s32 cx = SCREEN_WIDTH / 2, cy = SCREEN_HEIGHT / 2;
    // (gfx_pc fills rectangles with the fill colour: 5551, so no soft alpha -- the ticks dim to grey
    // while the pump racks instead of fading)
    u16 dark = GPACK_RGBA5551(0, 0, 0, 1);
    u16 tick = sSgTimer > 0 ? GPACK_RGBA5551(150, 150, 150, 1) : GPACK_RGBA5551(255, 255, 255, 1);

    if (!sSgEnabled || !sSgAim || gHudDisplay.flags == HUD_DISPLAY_NONE) {
        return;
    }
    gDPPipeSync(gDisplayListHead++);
    gDPSetCycleType(gDisplayListHead++, G_CYC_1CYCLE);
    gDPSetRenderMode(gDisplayListHead++, G_RM_OPA_SURF, G_RM_OPA_SURF2);
    // dark outline, then the white ticks (the SGM64 reticle: four ticks and no centre)
    gDPSetFillColor(gDisplayListHead++, (dark << 16) | dark);
    sg_rect(cx - 1, cy - 12, cx + 2, cy - 4);
    sg_rect(cx - 1, cy + 5, cx + 2, cy + 13);
    sg_rect(cx - 12, cy - 1, cx - 4, cy + 2);
    sg_rect(cx + 5, cy - 1, cx + 13, cy + 2);
    gDPPipeSync(gDisplayListHead++);
    gDPSetFillColor(gDisplayListHead++, (tick << 16) | tick);
    sg_rect(cx, cy - 11, cx + 1, cy - 5);
    sg_rect(cx, cy + 6, cx + 1, cy + 12);
    sg_rect(cx - 11, cy, cx - 5, cy + 1);
    sg_rect(cx + 6, cy, cx + 12, cy + 1);
    sg_rect(cx, cy, cx + 1, cy + 1);
    gDPPipeSync(gDisplayListHead++);
    gDPSetRenderMode(gDisplayListHead++, G_RM_AA_ZB_OPA_SURF, G_RM_AA_ZB_OPA_SURF2);
    gDPSetCombineMode(gDisplayListHead++, G_CC_SHADE, G_CC_SHADE);
}

// ======================================================================================== drawing
static const Vtx sSgQuad[] = {
    { { { -16, -16, 0 }, 0, { 0, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 16, -16, 0 }, 0, { 1024, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 16, 16, 0 }, 0, { 1024, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { -16, 16, 0 }, 0, { 0, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
};
// the flash: two crossed quads along the barrel (+x) and one across it
static const Vtx sSgFlashVtx[] = {
    { { { 0, -10, 0 }, 0, { 0, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 40, -10, 0 }, 0, { 1024, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 40, 10, 0 }, 0, { 1024, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 0, 10, 0 }, 0, { 0, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 0, 0, -10 }, 0, { 0, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 40, 0, -10 }, 0, { 1024, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 40, 0, 10 }, 0, { 1024, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 0, 0, 10 }, 0, { 0, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 4, -14, -14 }, 0, { 0, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 4, -14, 14 }, 0, { 1024, 1024 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 4, 14, 14 }, 0, { 1024, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
    { { { 4, 14, -14 }, 0, { 0, 0 }, { 0xff, 0xff, 0xff, 0xff } } },
};
// a chip of wall: a small wedge, grey (the prim colour shades it)
static const Vtx sSgChipVtx[] = {
    { { { -4, -3, -4 }, 0, { 0, 0 }, { 0x9a, 0x96, 0x90, 0xff } } },
    { { { 4, -3, -4 }, 0, { 0, 0 }, { 0x70, 0x6c, 0x68, 0xff } } },
    { { { 0, -3, 5 }, 0, { 0, 0 }, { 0x84, 0x80, 0x7a, 0xff } } },
    { { { 0, 4, 0 }, 0, { 0, 0 }, { 0xd0, 0xcc, 0xc4, 0xff } } },
};

static const Gfx sSgQuadTris[] = {
    gsSPVertex(sSgQuad, 4, 0),
    gsSP2Triangles(0, 1, 2, 0x0, 0, 2, 3, 0x0),
    gsSPEndDisplayList(),
};

static const Gfx sSgChipTris[] = {
    gsSPVertex(sSgChipVtx, 4, 0),
    gsSP2Triangles(0, 2, 1, 0x0, 0, 1, 3, 0x0),
    gsSP2Triangles(1, 2, 3, 0x0, 2, 0, 3, 0x0),
    gsSPEndDisplayList(),
};

static f32 sg_pump_offset(void) {
    s32 f;

    if (sSgTimer > SG_PUMP_START || sSgTimer <= SG_PUMP_START - SG_PUMP_FRAMES) {
        return 0.0f;
    }
    f = SG_PUMP_START - sSgTimer;         // 0 .. 9
    return (f < SG_PUMP_FRAMES / 2 ? f + 1 : SG_PUMP_FRAMES - f) * (SG_PUMP_TRAVEL / (SG_PUMP_FRAMES / 2));
}

static void sg_copy_mat(Mat4 dst, Mat4 src) {
    s32 r, c;

    for (r = 0; r < 4; r++) {
        for (c = 0; c < 4; c++) {
            dst[r][c] = src[r][c];
        }
    }
}

/**
 * The gun (opaque) and its flash (translucent), in torso space: torsoMtx is his torso as drawn.
 */
static void sg_draw_gun(Mat4 *torsoMtx) {
    Gfx *dl, *g;
    Mtx *m;
    Mat4 gun, world, tmp;
    Vec3f muzzle;

    sg_copy_mat(gun, sSgGunNow);
    // the muzzle's world position, for the smoke
    mtxf_mul(tmp, gun, *torsoMtx);
    vec3f_set(muzzle, SG_MUZZLE_X, SG_MUZZLE_Y, 0.0f);
    world[3][0] = muzzle[0] * tmp[0][0] + muzzle[1] * tmp[1][0] + muzzle[2] * tmp[2][0] + tmp[3][0];
    world[3][1] = muzzle[0] * tmp[0][1] + muzzle[1] * tmp[1][1] + muzzle[2] * tmp[2][1] + tmp[3][1];
    world[3][2] = muzzle[0] * tmp[0][2] + muzzle[1] * tmp[1][2] + muzzle[2] * tmp[2][2] + tmp[3][2];
    get_pos_from_transform_mtx(sSgMuzzle, world, *gCurGraphNodeCamera->matrixPtr);
    sg_copy_mat(sSgTorsoView, *torsoMtx);
    sg_copy_mat(sSgView, *gCurGraphNodeCamera->matrixPtr);
    vec3f_copy(sSgDrawnAt, gMarioState->pos);
    sSgDrawn = TRUE;

    g = dl = alloc_display_list(8 * sizeof(Gfx));
    m = alloc_display_list(2 * sizeof(Mtx));
    if (dl == NULL || m == NULL) {
        return;
    }
    mtxf_to_mtx(&m[0], gun);
    gSPMatrix(g++, &m[0], G_MTX_MODELVIEW | G_MTX_MUL | G_MTX_PUSH);
    gSPDisplayList(g++, sg_sg_body_dl_opaque);
    mtxf_identity(tmp);
    tmp[3][0] = -sg_pump_offset();
    mtxf_to_mtx(&m[1], tmp);
    gSPMatrix(g++, &m[1], G_MTX_MODELVIEW | G_MTX_MUL | G_MTX_PUSH);
    gSPDisplayList(g++, sg_sg_pump_dl_opaque);
    gSPPopMatrix(g++, G_MTX_MODELVIEW);
    gSPPopMatrix(g++, G_MTX_MODELVIEW);
    gSPEndDisplayList(g);
    studio_geo_append(dl, LAYER_OPAQUE);

    // the muzzle flash
    if (sSgFlash <= 0) {
        return;
    }
    g = dl = alloc_display_list(32 * sizeof(Gfx));
    m = alloc_display_list(sizeof(Mtx));
    if (dl == NULL || m == NULL) {
        return;
    }
    {
        Vec3f t, sc;
        Vec3s r;
        f32 s = 0.8f + sg_randf() * 0.7f;

        vec3f_set(t, SG_MUZZLE_X, SG_MUZZLE_Y, 0.0f);
        vec3s_set(r, random_u16(), 0, 0);
        mtxf_rotate_zxy_and_translate(tmp, t, r);
        vec3f_set(sc, s * (sSgFlash + 1) * 0.5f, s, s);
        mtxf_scale_vec3f(world, tmp, sc);
        mtxf_mul(tmp, world, gun);
        mtxf_to_mtx(m, tmp);
    }
    gSPMatrix(g++, m, G_MTX_MODELVIEW | G_MTX_MUL | G_MTX_PUSH);
    gDPPipeSync(g++);
    gSPClearGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gDPSetRenderMode(g++, G_RM_ZB_XLU_SURF, G_RM_ZB_XLU_SURF2);
    gDPSetCombineLERP(g++, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0);
    gDPSetPrimColor(g++, 0, 0, 255, 230, 140, 255);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
    gDPLoadTextureBlock(g++, sg_tex_sg_star, G_IM_FMT_IA, G_IM_SIZ_8b, 32, 32, 0, G_TX_CLAMP, G_TX_CLAMP, 5, 5, G_TX_NOLOD, G_TX_NOLOD);
    gSPVertex(g++, sSgFlashVtx, 12, 0);
    gSP2Triangles(g++, 0, 1, 2, 0x0, 0, 2, 3, 0x0);
    gSP2Triangles(g++, 4, 5, 6, 0x0, 4, 6, 7, 0x0);
    gSP2Triangles(g++, 8, 9, 10, 0x0, 8, 10, 11, 0x0);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    gDPPipeSync(g++);
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gDPSetRenderMode(g++, G_RM_AA_ZB_XLU_SURF, G_RM_AA_ZB_XLU_SURF2);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPPopMatrix(g++, G_MTX_MODELVIEW);
    gSPEndDisplayList(g);
    studio_geo_append(dl, LAYER_TRANSPARENT);
}

/**
 * A billboard (or a tumbling chip) at a world position: its modelview matrix, straight into view space.
 */
static Mtx *sg_part_mtx(Mat4 view, struct SgPart *p, f32 scale) {
    Mtx *mtx = alloc_display_list(sizeof(Mtx));
    Mat4 m;
    f32 x = p->pos[0], y = p->pos[1], z = p->pos[2];

    if (mtx == NULL) {
        return NULL;
    }
    if (p->kind == SG_FX_PIECE) {
        Mat4 obj;
        Vec3f t;
        Vec3s r;

        vec3f_set(t, x, y, z);
        vec3s_set(r, p->rx, p->ry, 0);
        mtxf_rotate_zxy_and_translate(obj, t, r);
        obj[0][0] *= scale; obj[0][1] *= scale; obj[0][2] *= scale;
        obj[1][0] *= scale; obj[1][1] *= scale; obj[1][2] *= scale;
        obj[2][0] *= scale; obj[2][1] *= scale; obj[2][2] *= scale;
        mtxf_mul(m, obj, view);
    } else {
        mtxf_identity(m);
        m[0][0] = m[1][1] = m[2][2] = scale;
        m[3][0] = x * view[0][0] + y * view[1][0] + z * view[2][0] + view[3][0];
        m[3][1] = x * view[0][1] + y * view[1][1] + z * view[2][1] + view[3][1];
        m[3][2] = x * view[0][2] + y * view[1][2] + z * view[2][2] + view[3][2];
    }
    mtxf_to_mtx(mtx, m);
    return mtx;
}

enum { SG_WORLD_OPA, SG_WORLD_DECAL, SG_WORLD_XLU };

static void sg_draw_world(s32 which) {
    Mat4 *view = gCurGraphNodeCamera->matrixPtr;
    Gfx *dl, *g;
    Mtx *vm, *pm;
    struct SgPart *p;
    s32 i, n;
    f32 k;

    n = which == SG_WORLD_DECAL ? sSgDecalCount
        : which == SG_WORLD_OPA ? sSgKindCount[SG_FX_PIECE] : sSgKindCount[SG_FX_SMOKE] + sSgKindCount[SG_FX_SPARK] + sSgKindCount[SG_FX_FLASH];
    if (n == 0) {
        return;
    }
    g = dl = alloc_display_list((40 + n * 4) * sizeof(Gfx));
    vm = alloc_display_list(sizeof(Mtx));
    if (dl == NULL || vm == NULL) {
        return;
    }
    mtxf_to_mtx(vm, *view);
    gDPPipeSync(g++);
    gSPClearGeometryMode(g++, G_LIGHTING);
    if (which == SG_WORLD_DECAL) {
        gSPMatrix(g++, vm, G_MTX_MODELVIEW | G_MTX_LOAD | G_MTX_NOPUSH);
        gDPSetRenderMode(g++, G_RM_AA_ZB_XLU_DECAL, G_RM_AA_ZB_XLU_DECAL2);
        gDPSetCombineLERP(g++, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0);
        gDPSetPrimColor(g++, 0, 0, 255, 255, 255, 255);
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
        gDPLoadTextureBlock(g++, sg_tex_sg_hole, G_IM_FMT_IA, G_IM_SIZ_8b, 32, 32, 0, G_TX_CLAMP, G_TX_CLAMP, 5, 5, G_TX_NOLOD, G_TX_NOLOD);
        for (i = 0; i < SG_MAX_DECALS; i++) {
            if (sSgDecals[i].alive) {
                gSPMatrix(g++, &sSgDecals[i].mtx, G_MTX_MODELVIEW | G_MTX_MUL | G_MTX_PUSH);
                gSPDisplayList(g++, sSgQuadTris);
                gSPPopMatrix(g++, G_MTX_MODELVIEW);
            }
        }
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
        gDPPipeSync(g++);
        gDPSetRenderMode(g++, G_RM_AA_ZB_XLU_DECAL, G_RM_AA_ZB_XLU_DECAL2);
    } else if (which == SG_WORLD_OPA) {
        gDPSetCombineLERP(g++, SHADE, 0, PRIMITIVE, 0, 0, 0, 0, SHADE, SHADE, 0, PRIMITIVE, 0, 0, 0, 0, SHADE);
        for (i = 0; i < SG_MAX_PARTS; i++) {
            p = &sSgParts[i];
            if (p->life > 0 && p->kind == SG_FX_PIECE && (pm = sg_part_mtx(*view, p, p->size)) != NULL) {
                gDPSetPrimColor(g++, 0, 0, p->shade, p->shade, p->shade, 255);
                gSPMatrix(g++, pm, G_MTX_MODELVIEW | G_MTX_LOAD | G_MTX_NOPUSH);
                gSPDisplayList(g++, sSgChipTris);
            }
        }
        gDPPipeSync(g++);
    } else {
        // smoke then sparks, both soft sprites
        gDPSetRenderMode(g++, G_RM_ZB_XLU_SURF, G_RM_ZB_XLU_SURF2);
        gDPSetCombineLERP(g++, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0, TEXEL0, 0, PRIMITIVE, 0);
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
        if (sSgKindCount[SG_FX_SMOKE] > 0) {
            gDPLoadTextureBlock(g++, sg_tex_sg_smoke, G_IM_FMT_IA, G_IM_SIZ_16b, 32, 32, 0, G_TX_CLAMP, G_TX_CLAMP, 5, 5, G_TX_NOLOD, G_TX_NOLOD);
            for (i = 0; i < SG_MAX_PARTS; i++) {
                p = &sSgParts[i];
                if (p->life > 0 && p->kind == SG_FX_SMOKE && (pm = sg_part_mtx(*view, p, p->size / 16.0f)) != NULL) {
                    k = (f32) p->life / p->maxLife;
                    gDPSetPrimColor(g++, 0, 0, p->shade, p->shade, p->shade, (u8) (170.0f * k));
                    gSPMatrix(g++, pm, G_MTX_MODELVIEW | G_MTX_LOAD | G_MTX_NOPUSH);
                    gSPDisplayList(g++, sSgQuadTris);
                }
            }
        }
        if (sSgKindCount[SG_FX_SPARK] + sSgKindCount[SG_FX_FLASH] > 0) {
            gDPPipeSync(g++);
            gDPLoadTextureBlock(g++, sg_tex_sg_star, G_IM_FMT_IA, G_IM_SIZ_8b, 32, 32, 0, G_TX_CLAMP, G_TX_CLAMP, 5, 5, G_TX_NOLOD, G_TX_NOLOD);
            for (i = 0; i < SG_MAX_PARTS; i++) {
                p = &sSgParts[i];
                if (p->life > 0 && (p->kind == SG_FX_SPARK || p->kind == SG_FX_FLASH)
                    && (pm = sg_part_mtx(*view, p, p->size / 16.0f)) != NULL) {
                    k = (f32) p->life / p->maxLife;
                    if (p->kind == SG_FX_FLASH) {
                        gDPSetPrimColor(g++, 0, 0, 255, 236, 170, 255);
                    } else {
                        gDPSetPrimColor(g++, 0, 0, 255, 200 + (u8) (55.0f * k), 90 + (u8) (140.0f * k), 255);
                    }
                    gSPMatrix(g++, pm, G_MTX_MODELVIEW | G_MTX_LOAD | G_MTX_NOPUSH);
                    gSPDisplayList(g++, sSgQuadTris);
                }
            }
        }
        gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
        gDPPipeSync(g++);
        gDPSetRenderMode(g++, G_RM_AA_ZB_XLU_SURF, G_RM_AA_ZB_XLU_SURF2);
    }
    gSPSetGeometryMode(g++, G_LIGHTING);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPEndDisplayList(g);
    studio_geo_append(dl, which == SG_WORLD_OPA ? LAYER_OPAQUE : which == SG_WORLD_DECAL ? LAYER_TRANSPARENT_DECAL : LAYER_TRANSPARENT);
}

// ======================================================================================== arms
static s32 sg_arms_free(struct MarioState *m) {
    u32 a = m->action;
    u32 group = a & ACT_GROUP_MASK;

    if (group != ACT_GROUP_STATIONARY && group != ACT_GROUP_MOVING && group != ACT_GROUP_AIRBORNE) {
        return FALSE;
    }
    if (a & (ACT_FLAG_HANGING | ACT_FLAG_ON_POLE | ACT_FLAG_SWIMMING | ACT_FLAG_INTANGIBLE)) {
        return FALSE;
    }
    if (m->heldObj != NULL) {
        return FALSE;
    }
    return a != ACT_SLEEPING && a != ACT_START_SLEEPING && a != ACT_LEDGE_GRAB && a != ACT_LEDGE_CLIMB_SLOW_1
           && a != ACT_LEDGE_CLIMB_SLOW_2 && a != ACT_LEDGE_CLIMB_FAST && a != ACT_LEDGE_CLIMB_DOWN;
}

static s16 sg_lerp_angle(s16 from, s16 to, f32 w) {
    return from + (s16) ((s16) (to - from) * w);
}

static s16 sg_pose_angle(s32 pose, s32 j, s32 k, s16 anim) {
    s16 v = sSgPoses[pose][j][k];

    return v == SG_KEEP ? anim : v;
}

// Which of his animated parts is being drawn (0 = root), or -1 if it isn't Mario.
static s32 sg_mario_joint(void) {
    struct GraphNodeObject *gfx = gCurGraphNodeObject;
    u16 *base;

    if (gMarioObject == NULL || gfx != &gMarioObject->header.gfx || gfx->unk38.curAnim == NULL
        || gCurrAnimAttribute == NULL) {
        return -1;
    }
    base = segmented_to_virtual((void *) gfx->unk38.curAnim->index);
    return (s32) (gCurrAnimAttribute - base) / 6 - 2;
}

/**
 * The animation layer: his arms (and shoulders) take the pose over whatever his animation says.
 */
void studio_shotgun_anim_part(s16 *rot) {
    s32 joint, j, k;
    s16 t;

    if (!sSgEnabled || sSgArmWeight <= 0.0f) {
        return;
    }
    joint = sg_mario_joint();
    j = joint - SG_J0;
    if (joint < 0 || j < 0 || j >= SG_JOINTS) {
        return;
    }
    if (j < 2) {        // aiming, his torso turns (left shoulder forward) and his head turns back
        rot[0] += (s16) ((j == 0 ? SG_AIM_TWIST : -SG_AIM_TWIST) * sSgTwist);
        return;
    }
    for (k = 0; k < 3; k++) {
        t = sg_pose_angle(SG_POSE_HOLD, j, k, rot[k]);
        t = sg_lerp_angle(t, sg_pose_angle(SG_POSE_AIM, j, k, rot[k]), sSgWAim);
        t = sg_lerp_angle(t, sg_pose_angle(SG_POSE_DOWN, j, k, rot[k]), sSgWDown);
        t = sg_lerp_angle(t, sg_pose_angle(SG_POSE_KICK, j, k, rot[k]), sSgKick);
        if (j < 6) {        // the left arm racks the pump
            t = sg_lerp_angle(t, sg_pose_angle(SG_POSE_PUMP, j, k, rot[k]), sSgPump);
        }
        rot[k] = sg_lerp_angle(rot[k], t, sSgArmWeight);
    }
}

/**
 * Called for every animated part once its matrix is known: the gun goes on his torso, the world
 * effects (holes, smoke, sparks, chips) are queued once per frame from his root.
 */
void studio_shotgun_part_drawn(Mat4 *mtx) {
    s32 joint;

    if (!gStudioShotgunDraw || gCurGraphNodeCamera == NULL) {
        return;
    }
    joint = sg_mario_joint();
    if (joint == 0 && sSgDrawFrame != (s32) gGlobalTimer) {
        sSgDrawFrame = (s32) gGlobalTimer;
        sg_draw_world(SG_WORLD_OPA);
        sg_draw_world(SG_WORLD_DECAL);
        sg_draw_world(SG_WORLD_XLU);
    } else if (joint == SG_J0 && sSgEnabled) {
        sg_draw_gun(mtx);
    }
}

static void sg_lerp_place(Mat4 m, s32 place, f32 w) {
    s32 r, c;

    for (r = 0; r < 4; r++) {
        for (c = 0; c < 3; c++) {
            m[r][c] += (sSgGunPlace[place][r][c] - m[r][c]) * w;
        }
    }
}

/**
 * This frame's pose weights and the gun's place (blended, then squared up again).
 */
static void sg_update_pose(struct MarioState *m) {
    f32 armGoal = sg_arms_free(m) ? 1.0f : 0.0f;
    f32 aimGoal = (sSgAim || sSgTimer > 0) ? 1.0f : 0.0f;
    f32 downGoal = sSgAirShot > 0 ? 1.0f : 0.0f;
    f32 scale;
    Vec3f x, y, z;
    s32 r, c;

    sSgArmWeight += (armGoal - sSgArmWeight) * 0.35f;
    if (sSgArmWeight < 0.01f) {
        sSgArmWeight = 0.0f;
    }
    sSgAimWeight += (aimGoal - sSgAimWeight) * (aimGoal > sSgAimWeight ? 0.6f : 0.2f);
    sSgWAim = sSgAimWeight;
    sSgWDown += (downGoal - sSgWDown) * (downGoal > sSgWDown ? 0.7f : 0.25f);
    // the recoil: thrown up at the blast, back down over 6 frames
    sSgKick = sSgTimer > SG_COOLDOWN - 7 ? (sSgTimer - (SG_COOLDOWN - 7)) / 7.0f : 0.0f;
    sSgKick *= 1.0f - sSgWDown;
    sSgPump = sg_pump_offset() / SG_PUMP_TRAVEL * (1.0f - sSgWDown);
    sSgTwist = sSgWAim * (1.0f - sSgWDown) * sSgArmWeight;

    for (r = 0; r < 4; r++) {
        for (c = 0; c < 3; c++) {
            sSgGunNow[r][c] = sSgGunPlace[SG_GUN_HOLD][r][c];
        }
        sSgGunNow[r][3] = r == 3 ? 1.0f : 0.0f;
    }
    sg_lerp_place(sSgGunNow, SG_GUN_AIM, sSgWAim);
    sg_lerp_place(sSgGunNow, SG_GUN_DOWN, sSgWDown);
    sg_lerp_place(sSgGunNow, SG_GUN_KICK, sSgKick);
    // (hands busy: slung across his back)
    for (r = 0; r < 4; r++) {
        for (c = 0; c < 3; c++) {
            sSgGunNow[r][c] = sSgGunPlace[SG_GUN_SLUNG][r][c]
                              + (sSgGunNow[r][c] - sSgGunPlace[SG_GUN_SLUNG][r][c]) * sSgArmWeight;
        }
    }
    // square the rotation up again (blending shrank and skewed it a little)
    scale = sqrtf(sSgGunPlace[SG_GUN_HOLD][0][0] * sSgGunPlace[SG_GUN_HOLD][0][0]
                  + sSgGunPlace[SG_GUN_HOLD][0][1] * sSgGunPlace[SG_GUN_HOLD][0][1]
                  + sSgGunPlace[SG_GUN_HOLD][0][2] * sSgGunPlace[SG_GUN_HOLD][0][2]);
    vec3f_set(x, sSgGunNow[0][0], sSgGunNow[0][1], sSgGunNow[0][2]);
    vec3f_set(y, sSgGunNow[1][0], sSgGunNow[1][1], sSgGunNow[1][2]);
    vec3f_normalize(x);
    vec3f_cross(z, x, y);
    vec3f_normalize(z);
    vec3f_cross(y, z, x);
    for (c = 0; c < 3; c++) {
        sSgGunNow[0][c] = x[c] * scale;
        sSgGunNow[1][c] = y[c] * scale;
        sSgGunNow[2][c] = z[c] * scale;
    }
}

// ======================================================================================== API
static void sg_set_enabled(s32 on) {
#ifdef SG_STUB
    on = FALSE; // no models (shotgun_models.h): no gun
#endif
    if (on && !sSgEnabled) {
        studio_katana_drop();       // (one weapon at a time: the katana goes)
        sSgEnabled = TRUE;
        sSgTimer = 0;
        sSgAim = FALSE;
        sSgAirShotUsed = FALSE;
        sSgArmWeight = sSgAimWeight = 0.0f;
        sSgWDown = 0.0f;
        sSgDrawn = FALSE;
        if (gMarioState != NULL && gMarioState->marioObj != NULL) {
            sg_update_pose(gMarioState);
        }
    } else if (!on && sSgEnabled) {
        sSgEnabled = FALSE;
        sSgAim = FALSE;
        sSgByRule = FALSE;
    }
    gStudioShotgunDraw = TRUE;      // (effects keep settling; the gun itself checks sSgEnabled)
}

// Mario has (1) or loses (0) the shotgun: the story's "give / take the shotgun", Claude's tool.
EMSCRIPTEN_KEEPALIVE
void studio_shotgun_give(s32 on) {
    sg_set_enabled(on != 0);
    sSgByRule = FALSE;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_shotgun_has(void) {
    return sSgEnabled;
}

// The pickup (bhvStudioShotgun) was walked into.
void studio_shotgun_picked_up(void) {
    sg_set_enabled(TRUE);
    sSgByRule = FALSE;
    EM_ASM({ if (Module.studioShotgunEvent) Module.studioShotgunEvent('pickup'); });
}

// The game rule "Mario starts with the shotgun" changed (or the rules were applied again): switching
// it on arms him now, switching it off takes back a gun only the rule gave.
EMSCRIPTEN_KEEPALIVE
void studio_shotgun_rule(s32 on) {
    on = on != 0;
    if (on && !sSgRule && !sSgEnabled) {
        sg_set_enabled(TRUE);
        sSgByRule = TRUE;
    } else if (!on && sSgRule && sSgByRule) {
        sg_set_enabled(FALSE);
    }
    sSgRule = on;
}

// A level starts (not a sub-area of the same level): the gun, its effects and the counts start over;
// with the rule on he starts armed.
EMSCRIPTEN_KEEPALIVE
void studio_shotgun_level_start(s32 rule) {
    sg_set_enabled(FALSE);
    sg_clear_effects();
    sSgShots = sSgObjHits = 0;
    sSgNoFire = 0;
    sSgLogCount = 0;
    sSgRule = rule != 0;
    if (sSgRule) {
        sg_set_enabled(TRUE);
        sSgByRule = TRUE;
    }
}

void studio_shotgun_suppress(s32 frames) {
    if (frames > sSgNoFire) {
        sSgNoFire = frames;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_shotgun_set_aim(s32 on) {
    sSgAim = (on && sSgEnabled) ? TRUE : FALSE;
}

struct ShotgunHit *studio_shotgun_hit_for(struct Object *obj) {
    s32 i;

    for (i = 0; i < gShotgunHitCount; i++) {
        if (gShotgunHits[i].obj == obj) {
            return &gShotgunHits[i];
        }
    }
    return NULL;
}

// For tests and the AI: everything about the gun as JSON.
static char sSgJson[1400];
EMSCRIPTEN_KEEPALIVE
const char *studio_shotgun_state_json(void) {
    snprintf(sSgJson, sizeof(sSgJson),
             "{\"has\":%d,\"rule\":%d,\"byRule\":%d,\"aim\":%d,\"timer\":%d,\"shots\":%d,\"objHits\":%d,"
             "\"decals\":%d,\"parts\":%d,\"lastDir\":[%.3f,%.3f,%.3f],\"lastFrom\":[%.0f,%.0f,%.0f],\"lastDist\":%.0f,"
             "\"armWeight\":%.2f,\"aimWeight\":%.2f,\"camYaw\":%d,\"camPitch\":%d,\"drawn\":%d,\"airUsed\":%d,"
             "\"muzzle\":[%.0f,%.0f,%.0f],\"airBoost\":%.1f}",
             sSgEnabled, sSgRule, sSgByRule, sSgAim, sSgTimer, sSgShots, sSgObjHits, sSgDecalCount, sSgPartCount,
             sSgLastDir[0], sSgLastDir[1], sSgLastDir[2], sSgLastFrom[0], sSgLastFrom[1], sSgLastFrom[2], sSgLastDist,
             sSgArmWeight, sSgAimWeight, (s16) sSgCamYaw, (s16) sSgCamPitch, sSgDrawn, sSgAirShotUsed,
             sSgMuzzle[0], sSgMuzzle[1], sSgMuzzle[2], sSgAirBoostVel);
    {
        // the last blast's hits: kind 1 attacked, 2 armour, 3 bob-omb, 4 cork box, 5 Chuckya, 6 King Bob-omb, 7 Pianta
        static const char *kinds[] = { "none", "attack", "armour", "bobomb", "box", "chuckya", "king_bobomb", "pianta" };
        s32 n = (s32) strlen(sSgJson) - 1, i;

        n += snprintf(sSgJson + n, sizeof(sSgJson) - n, ",\"hits\":[");
        for (i = 0; i < sSgLogCount && n < (s32) sizeof(sSgJson) - 100; i++) {
            n += snprintf(sSgJson + n, sizeof(sSgJson) - n, "%s{\"slot\":%d,\"uid\":%u,\"kind\":\"%s\",\"action\":%d,\"pellets\":%d}",
                          i ? "," : "", sSgLog[i].slot, sSgLog[i].uid, kinds[sSgLog[i].kind], sSgLog[i].action, sSgLog[i].pellets);
        }
        snprintf(sSgJson + n, sizeof(sSgJson) - n, "]}");
    }
    return sSgJson;
}
