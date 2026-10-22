// Studio 64 vehicles: races (see vehicle.h).
//
// A port of the Shoggoth World hack's Shuto race (sm64-master, branch shoggoth:
// src/game/shoggoth/overlay/highway.c, Mario against the Drift King). There the circuit comes from
// the level's data; here it is the path drawn on the race object in the studio (motion.js path
// tool, saved as the record's motion.path and read back with studio_motion_path): a loop is a
// circuit of N laps, an open path a sprint to its last point.
//
// The race object (bhvStudioRace) is the rival's car, parked on the start line. Mario challenges
// him: B by his door on foot, or a honk (C-up) next to him in a car. Then:
//   GRID       a fade; both cars on the grid, Mario at the wheel (his own car, or one the race
//              gives him), the traffic on the course
//   INTRO      the camera sweeps round the grid from the rival's grille to Mario's bumper
//   COUNTDOWN  3, 2, 1, GO. The cars are held; A revs. Floor it just before GO: a rocket start;
//              too soon: the engine bogs down
//   RACE       ordered checkpoints (the progress is followed segment by segment along the course,
//              so there is no cutting across), laps and lap times, 1ST / 2ND, WRONG WAY, a fade back
//              onto the course off it or stuck; the drift boost, the slipstream (tuck in behind
//              him), the traffic to weave through (a bump costs speed), the jostling with the rival
//              (both cars shove)
//   FINISH     over the line (whoever's first): both cars brake to a stop
//   RESULT     the banner; a win gives the race's star (it flies out of the rival's car to Mario);
//              a loss: B for a rematch
// The rival is on rails: a distance along the course, an offset across it, a speed -- a speed
// profile from the course's bends and his car's grip, a rubber band on the gap to Mario (he eases
// off ahead, pushes when behind: close all the way, but a clean run wins), swerves round the
// traffic and round Mario, and a slide angle in the bends (smoke, squeal, a flame out of each
// drift).
#include <ultra64.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#endif

#include "sm64.h"
#include "types.h"
#include "model_ids.h"
#include "behavior_data.h"
#include "object_constants.h"
#include "audio/external.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "engine/behavior_script.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/game_init.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/spawn_object.h"
#include "objects.h"
#include "vehicle.h"

#define o gCurrentObject
#ifndef CLAMP
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))
#endif

extern struct CameraFOVStatus sFOVState;
extern s32 gStudioPaused;
struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams);
struct GraphNode *studio_geo_node(const GeoLayout *geo);

/* ------------------------------------------------------------------------------------ tuning (highway.c) */
#define MAX_PTS           512
#define MAX_CP            32
#define SAMPLE_STEP       160.0f

#define INTRO_FRAMES      120       // the camera's sweep round the grid (a rematch: shorter)
#define COUNT_FRAMES      30        // each of 3, 2, 1
#define ROCKET_WINDOW     14        // A down this late before GO: a rocket start
#define STALL_EARLY       40        // A down this early: the engine bogs down
#define STALL_FRAMES      18
#define ROCKET_FRAMES     40
// the slipstream: close behind the rival
#define SLIP_BEHIND_MIN   180.0f
#define SLIP_BEHIND_MAX   1500.0f
#define SLIP_SIDE         230.0f
#define SLIP_BUILD        24
#define SLIP_TOP          12.0f
// the rival
#define RIVAL_ACCEL       1.45f
#define RIVAL_DECEL       3.2f
#define RIVAL_SLOW_MAX    0.04f     // ahead: eases off up to this share (the gap below) ...
#define RIVAL_SLOW_GAP    6000.0f   // ... not at all on the final lap
#define RIVAL_PUSH_MAX    0.12f     // behind: pushes up to this share
#define RIVAL_PUSH_GAP    4000.0f
#define RIVAL_BOOST       1.12f     // his own boost out of a drift
#define RIVAL_BOOST_FRAMES 40
#define RIVAL_BLOCK_BEHIND 1100.0f  // Mario tucked in this close behind: he moves over to block
#define RIVAL_BLOCK_SHARE 0.6f
#define RIVAL_LAT_RATE    11.0f
#define RIVAL_DRIFT_K     1150.0f   // slide angle per unit of sideways acceleration
#define RIVAL_DRIFT_MAX   0x1C00
#define RIVAL_REACTION    5         // frames after GO
#define TRAFFIC_SPEED     44.0f
#define MAX_TRAFFIC       10
#define RESPAWN_STUCK     75        // frames nearly stopped with the throttle down
#define TAUNT_FRAMES      96
#define TAUNT_GAP         210
#define CAR_CIRCLE_R      112.0f    // the cars' shoves: three circles each along the body
#define CAR_CIRCLE_OFF    150.0f
#define RESULT_FRAMES     150

enum RaceStates { RS_NONE, RS_GRID, RS_INTRO, RS_COUNTDOWN, RS_RACE, RS_FINISH, RS_RESULT };
enum RaceResult { RESULT_NONE, RESULT_WIN, RESULT_LOSE };
enum Taunts { TAUNT_START, TAUNT_AHEAD, TAUNT_PASSED, TAUNT_FINAL, TAUNT_CRASH, TAUNT_BACK, TAUNT_CLOSE, TAUNT_WIN, TAUNT_LOSE };

// a race's settings (the page: studio_race_config)
struct RaceCfg {
    u32 uid;
    s32 laps;
    f32 pace;        // the rival's pace (x his profile)
    f32 halfW;       // the course's half width (off it: back on)
    s32 playerLook;  // the car the race gives Mario on foot
    u32 playerPaint;
    f32 playerTop;
    s32 traffic;     // cars on the course
    s32 star;        // a win gives the race's star
    s32 starDone;    // (already collected: no star)
    s32 smooth;      // the course is a smooth curve through the points
    s32 rubber;      // the rival keeps it close
};
static struct RaceCfg sCfg[OBJECT_POOL_CAPACITY];

struct Racer {
    f32 s, progress;
    s32 lap, nextCp, lapStart, lastLap, bestLap, finish, seg;
    f32 lateral;
};

static struct {
    struct Object *obj;      // the race (the rival's car)
    u32 uid;
    struct RaceCfg cfg;
    s32 state, timer, raceTime, count, position, result, rocket, restarts, laps;
    s32 wrongWay, slipstream, lapFlash, lapShow, taunt, tauntTimer, tauntCooldown, respawnTimer, respawns;
    s32 bumps, trafficHits, starGiven, lastPos, prevCrashes, stall, aHeldSince, stuck, hitCooldown, rivalHitCooldown;
    struct Racer mario, rival;
    s32 marioSeg;
    f32 marioS;
    struct Object *playerCar;  // the car the race gave Mario (kept for a rematch)
    struct Object *driver;
    struct Object *traffic[MAX_TRAFFIC];
    s32 numTraffic;
    f32 homeX, homeY, homeZ;
    s16 homeYaw;
} R;

// the rival on his rails
static struct {
    f32 s, lat, latVel, v;
    s32 seg, boost, smoke, wasDrifting;
    s16 yaw, slide, spin, steer, motionYaw;
    f32 top;
} V;

/* ------------------------------------------------------------------------------------ the course */
static s32 sN, sClosed;
static f32 sPx[MAX_PTS], sPy[MAX_PTS], sPz[MAX_PTS];
static f32 sLen[MAX_PTS], sCum[MAX_PTS], sSegDx[MAX_PTS], sSegDz[MAX_PTS], sNx[MAX_PTS], sNz[MAX_PTS];
static f32 sSpeed[MAX_PTS], sCurv[MAX_PTS];
static f32 sCp[MAX_CP];
static s32 sNumCp;
static f32 sLapLen;

static s32 nseg(void) {
    return sClosed ? sN : sN - 1;
}

static f32 wrap_s(f32 s) {
    if (!sClosed) {
        return CLAMP(s, 0.0f, sLapLen - 0.01f);
    }
    while (s < 0.0f) s += sLapLen;
    while (s >= sLapLen) s -= sLapLen;
    return s;
}

static f32 wrap_ds(f32 d) {
    if (!sClosed) {
        return d;
    }
    while (d > sLapLen * 0.5f) d -= sLapLen;
    while (d < -sLapLen * 0.5f) d += sLapLen;
    return d;
}

/* The course from the race object's path: a Catmull-Rom curve (or straight segments) through the
   points, sampled every SAMPLE_STEP; the rival's speed profile from its bends. */
static s32 track_build(struct Object *race) {
    const f32 (*pts)[3];
    s32 mode, wait, n, i, j, k, segs;
    f32 raw[64][3];
    f32 rate, top = V.top;

    n = studio_motion_path(race, &pts, &mode, &wait);
    if (n < 2) {
        sN = 0;
        return FALSE;
    }
    n = MIN(n, 64);
    for (i = 0; i < n; i++) {
        raw[i][0] = pts[i][0];
        raw[i][1] = pts[i][1];
        raw[i][2] = pts[i][2];
    }
    sClosed = mode == 0 && n >= 3; // loop
    sN = 0;
    segs = sClosed ? n : n - 1;
    for (i = 0; i < segs && sN < MAX_PTS - 1; i++) {
        f32 *p1 = raw[i], *p2 = raw[(i + 1) % n];
        f32 *p0 = i > 0 ? raw[i - 1] : (sClosed ? raw[n - 1] : p1);
        f32 *p3 = (i + 2 < n) ? raw[i + 2] : (sClosed ? raw[(i + 2) % n] : p2);
        f32 dx = p2[0] - p1[0], dz = p2[2] - p1[2];
        s32 sub = (s32) (sqrtf(dx * dx + dz * dz) / SAMPLE_STEP) + 1;
        for (k = 0; k < sub && sN < MAX_PTS - 1; k++) {
            f32 t = (f32) k / sub, t2 = t * t, t3 = t2 * t;
            for (j = 0; j < 3; j++) {
                f32 v = R.cfg.smooth
                            ? 0.5f * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                      + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
                            : p1[j] + (p2[j] - p1[j]) * t;
                if (j == 0) sPx[sN] = v;
                else if (j == 1) sPy[sN] = v;
                else sPz[sN] = v;
            }
            sN++;
        }
    }
    if (!sClosed) {
        sPx[sN] = raw[n - 1][0];
        sPy[sN] = raw[n - 1][1];
        sPz[sN] = raw[n - 1][2];
        sN++;
    }
    // segments, the lap length, normals
    sLapLen = 0.0f;
    for (i = 0; i < sN; i++) {
        f32 dx, dz, d;
        j = (i + 1) % sN;
        if (!sClosed && i == sN - 1) {
            j = i;
            dx = sSegDx[i - 1];
            dz = sSegDz[i - 1];
            sLen[i] = 1.0f;
            sSegDx[i] = dx;
            sSegDz[i] = dz;
            sCum[i] = sLapLen;
            break;
        }
        dx = sPx[j] - sPx[i];
        dz = sPz[j] - sPz[i];
        d = sqrtf(dx * dx + dz * dz);
        if (d < 1.0f) d = 1.0f;
        sLen[i] = d;
        sSegDx[i] = dx / d;
        sSegDz[i] = dz / d;
        sCum[i] = sLapLen;
        sLapLen += d;
    }
    for (i = 0; i < sN; i++) {
        f32 dx, dz, d;
        j = (i + sN - 1) % sN;
        if (!sClosed && i == 0) j = 0;
        dx = sSegDx[i] + sSegDx[j];
        dz = sSegDz[i] + sSegDz[j];
        d = sqrtf(dx * dx + dz * dz);
        if (d < 0.001f) {
            dx = sSegDx[i];
            dz = sSegDz[i];
            d = 1.0f;
        }
        sNx[i] = -dz / d;
        sNz[i] = dx / d;
    }
    // the bends: curvature (radians per unit) -> the fastest speed his car turns at there
    // (yaw per frame at speed v: CAR_STEER_RATE * (1 - 0.42 v / top), in s16 units)
    rate = 0x3A0 * (2.0f * 3.14159f / 65536.0f) * 1.05f;
    for (i = 0; i < sN; i++) {
        s32 a = (i + sN - 1) % sN, b = (i + 1) % sN;
        f32 ang, dl, v, best = 30.0f;
        if (!sClosed && (i == 0 || i == sN - 1)) {
            sCurv[i] = 0.0f;
            sSpeed[i] = top;
            continue;
        }
        ang = atan2f(sSegDx[a] * sSegDz[i] - sSegDz[a] * sSegDx[i], sSegDx[a] * sSegDx[i] + sSegDz[a] * sSegDz[i]);
        dl = 0.5f * (sLen[a] + sLen[i]);
        sCurv[i] = ang / MAX(dl, 1.0f);
        for (v = 30.0f; v <= top; v += 4.0f) {
            f32 turn = rate * (1.0f - 0.42f * v / top) * 1.55f; // (he drifts through: the drift's steering)
            if (turn / v >= ABS(sCurv[i])) {
                best = v;
            }
        }
        sSpeed[i] = best;
    }
    // braking ahead of the bends (a pass backwards, twice round a loop)
    for (k = 0; k < 2; k++) {
        for (i = sN - 2; i >= 0; i--) {
            j = (i + 1) % sN;
            sSpeed[i] = MIN(sSpeed[i], sSpeed[j] + RIVAL_DECEL * 0.5f * sLen[i] / MAX(sSpeed[j], 20.0f));
        }
        if (sClosed) {
            sSpeed[sN - 1] = MIN(sSpeed[sN - 1], sSpeed[0] + RIVAL_DECEL * 0.5f * sLen[sN - 1] / MAX(sSpeed[0], 20.0f));
        }
    }
    // checkpoints: every eighth of the course
    sNumCp = 0;
    for (i = 1; i < 8; i++) {
        sCp[sNumCp++] = sLapLen * i / 8.0f;
    }
    return TRUE;
}

static s32 seg_at(f32 s, s32 hint) {
    s32 i = hint, k;
    s = wrap_s(s);
    if (i < 0 || i >= sN) i = 0;
    for (k = 0; k < sN; k++) {
        if (s < sCum[i] && (sClosed || i > 0)) {
            i = (i + sN - 1) % sN;
        } else if (s >= sCum[i] + sLen[i] && (sClosed || i < sN - 2)) {
            i = (i + 1) % sN;
        } else {
            break;
        }
    }
    return i;
}

struct TrackPos {
    f32 x, y, z, tx, tz, nx, nz, speed, curv;
    s32 seg;
};

static void track_at(f32 s, f32 lat, s32 hint, struct TrackPos *p) {
    s32 i, j;
    f32 t, nx, nz, d;
    s = wrap_s(s);
    i = seg_at(s, hint);
    j = (i + 1) % sN;
    t = CLAMP((s - sCum[i]) / sLen[i], 0.0f, 1.0f);
    nx = sNx[i] + (sNx[j] - sNx[i]) * t;
    nz = sNz[i] + (sNz[j] - sNz[i]) * t;
    d = sqrtf(nx * nx + nz * nz);
    if (d < 0.001f) d = 1.0f;
    nx /= d;
    nz /= d;
    p->nx = nx;
    p->nz = nz;
    p->tx = nz;             // (right-hand normal (-dz, dx) -> heading (dx, dz))
    p->tz = -nx;
    p->x = sPx[i] + (sPx[j] - sPx[i]) * t + nx * lat;
    p->y = sPy[i] + (sPy[j] - sPy[i]) * t;
    p->z = sPz[i] + (sPz[j] - sPz[i]) * t + nz * lat;
    p->speed = sSpeed[i] + (sSpeed[j] - sSpeed[i]) * t;
    p->curv = sCurv[i] + (sCurv[j] - sCurv[i]) * t;
    p->seg = i;
}

/* where a point is on the course: the nearest of the segments round the hint (the course may cross
   over itself: only nearby segments count, and height too) */
static f32 track_project(f32 x, f32 y, f32 z, s32 *seg, f32 *s, f32 *lat) {
    s32 k, i, best = *seg;
    f32 bestD = 1e12f, bestT = 0.0f, bestLat = 0.0f;
    for (k = -3; k <= 4; k++) {
        f32 ax, az, t, fx, fz, d, dy, l;
        i = *seg + k;
        if (sClosed) i = (i + sN) % sN;
        else if (i < 0 || i >= sN - 1) continue;
        ax = x - sPx[i];
        az = z - sPz[i];
        t = (ax * sSegDx[i] + az * sSegDz[i]) / sLen[i];
        t = CLAMP(t, 0.0f, 1.0f);
        fx = sPx[i] + sSegDx[i] * sLen[i] * t;
        fz = sPz[i] + sSegDz[i] * sLen[i] * t;
        dy = y - (sPy[i] + (sPy[(i + 1) % sN] - sPy[i]) * t);
        d = (x - fx) * (x - fx) + (z - fz) * (z - fz) + dy * dy * 4.0f;
        l = ax * -sSegDz[i] + az * sSegDx[i];
        if (d < bestD) {
            bestD = d;
            best = i;
            bestT = t;
            bestLat = l;
        }
    }
    *seg = best;
    *s = sCum[best] + bestT * sLen[best];
    *lat = bestLat;
    return sqrtf(bestD);
}

static s32 nearest_seg(f32 x, f32 z) {
    s32 i, best = 0;
    f32 bd = 1e12f;
    for (i = 0; i < nseg(); i++) {
        f32 d = sqr(sPx[i] - x) + sqr(sPz[i] - z);
        if (d < bd) {
            bd = d;
            best = i;
        }
    }
    return best;
}

/* ------------------------------------------------------------------------------------ helpers */

static void event(const char *name, s32 value) {
    EM_ASM({ if (Module.studioVehicleEvent) Module.studioVehicleEvent(UTF8ToString($0), $1 >>> 0, $2); }, name, R.uid, value);
}

static void taunt(s32 which, s32 force) {
    if (!force && (R.tauntCooldown > 0 || R.tauntTimer > 0)) {
        return;
    }
    R.taunt = which;
    R.tauntTimer = TAUNT_FRAMES;
    R.tauntCooldown = TAUNT_GAP;
    play_sound(SOUND_MENU_MESSAGE_APPEAR, gDefaultSoundArgs);
}

static void set_state(s32 s) {
    R.state = s;
    R.timer = 0;
}

static s32 race_alive(void) {
    return R.obj != NULL && (R.obj->activeFlags & ACTIVE_FLAG_ACTIVE) && R.obj->unused2 == R.uid;
}

s32 studio_race_active(void) {
    return R.state != RS_NONE && race_alive();
}

static void racer_start(struct Racer *r, f32 s) {
    memset(r, 0, sizeof(*r));
    r->s = wrap_s(s);
    r->progress = sClosed ? wrap_ds(r->s) : r->s;     // (the grid is behind the line: negative)
}

/* a racer moved on to s: the distance run, checkpoints, laps. Returns TRUE on a lap. */
static s32 racer_advance(struct Racer *r, f32 s) {
    s32 lapDone = FALSE;
    if (sClosed) {
        r->progress += wrap_ds(s - r->s);
    } else {
        r->progress = s;
    }
    r->s = s;
    if (r->finish != 0) {
        return FALSE;
    }
    if (r->nextCp < sNumCp && r->progress - r->lap * sLapLen >= sCp[r->nextCp]) {
        r->nextCp++;
    }
    if (r->progress >= (r->lap + 1) * sLapLen - (sClosed ? 0.0f : 30.0f) && r->nextCp >= sNumCp) {
        r->lastLap = R.raceTime - r->lapStart;
        if (r->bestLap == 0 || r->lastLap < r->bestLap) {
            r->bestLap = r->lastLap;
        }
        r->lap++;
        r->nextCp = 0;
        r->lapStart = R.raceTime;
        lapDone = TRUE;
        if (r->lap >= R.laps) {
            r->finish = R.raceTime;
        }
    }
    return lapDone;
}

static void flame_at(struct Object *parent, s32 model, f32 x, f32 y, f32 z, f32 scale) {
    struct Object *f = spawn_object(parent, model, bhvStudioCarFlame);
    if (f != NULL) {
        f->oPosX = x;
        f->oPosY = y;
        f->oPosZ = z;
        f->oForwardVel = scale;
        f->oVelY = 1.5f;
        obj_scale(f, scale);
    }
}

static struct StudioCarLook *rival_look(void) {
    struct StudioCarCfg *c = studio_car_cfg(R.obj);
    s32 look = c != NULL && c->look >= 0 ? c->look : 2;
    return &gStudioCarLooks[look];
}

/* ------------------------------------------------------------------------------------ car shoves */

static s32 cars_touch(f32 ax, f32 az, s16 ayaw, f32 bx, f32 bz, s16 byaw, f32 *nx, f32 *nz, f32 *depth) {
    s32 i, j, hit = FALSE;
    f32 best = 0.0f;
    if ((ax - bx) * (ax - bx) + (az - bz) * (az - bz) > 700.0f * 700.0f) {
        return FALSE;
    }
    for (i = -1; i <= 1; i++) {
        f32 cax = ax + sins(ayaw) * CAR_CIRCLE_OFF * i;
        f32 caz = az + coss(ayaw) * CAR_CIRCLE_OFF * i;
        for (j = -1; j <= 1; j++) {
            f32 cbx = bx + sins(byaw) * CAR_CIRCLE_OFF * j;
            f32 cbz = bz + coss(byaw) * CAR_CIRCLE_OFF * j;
            f32 dx = cax - cbx, dz = caz - cbz;
            f32 d = sqrtf(dx * dx + dz * dz);
            f32 pen = 2.0f * CAR_CIRCLE_R - d;
            if (pen > best && d > 0.01f) {
                best = pen;
                *nx = dx / d;
                *nz = dz / d;
                hit = TRUE;
            }
        }
    }
    *depth = best;
    return hit;
}

static void bump_fx(f32 x, f32 y, f32 z, f32 strength) {
    struct Object *p;
    play_sound(strength > 20.0f ? SOUND_OBJ_BULLY_METAL : SOUND_ACTION_METAL_BONK, gStudioCar.obj->header.gfx.cameraToObject);
    set_camera_shake_from_hit(strength > 30.0f ? SHAKE_LARGE_DAMAGE : SHAKE_SMALL_DAMAGE);
    p = spawn_object(gStudioCar.obj, MODEL_NONE, bhvHorStarParticleSpawner);
    if (p != NULL) {
        p->oPosX = x;
        p->oPosY = y + 60.0f;
        p->oPosZ = z;
    }
}

static void car_shoves(void) {
    struct StudioCar *c = &gStudioCar;
    f32 nx, nz, depth, closing, fx, fz;
    s32 i;

    if (R.hitCooldown > 0) R.hitCooldown--;
    if (R.rivalHitCooldown > 0) R.rivalHitCooldown--;
    // the rival: both cars give (he's a little heavier: he's done this before)
    if (cars_touch(c->pos[0], c->pos[2], c->yaw, R.obj->oPosX, R.obj->oPosZ, V.yaw, &nx, &nz, &depth)) {
        struct TrackPos tp;
        f32 rvx, rvz, along, across;
        track_at(V.s, V.lat, V.seg, &tp);
        rvx = tp.tx * V.v + tp.nx * V.latVel;
        rvz = tp.tz * V.v + tp.nz * V.latVel;
        closing = -((c->vel[0] - rvx) * nx + (c->vel[2] - rvz) * nz);
        c->pos[0] += nx * depth * 0.55f;
        c->pos[2] += nz * depth * 0.55f;
        along = -(nx * tp.tx + nz * tp.tz) * depth * 0.45f;
        across = -(nx * tp.nx + nz * tp.nz) * depth * 0.45f;
        V.s = wrap_s(V.s + along);
        V.lat += across;
        if (closing > 0.0f) {
            c->vel[0] += nx * closing * 0.55f;
            c->vel[2] += nz * closing * 0.55f;
            V.v -= (nx * tp.tx + nz * tp.tz) * closing * 0.45f;
            V.latVel -= (nx * tp.nx + nz * tp.nz) * closing * 0.45f;
            V.v = MAX(V.v, 0.0f);
            if (R.rivalHitCooldown == 0 && closing > 6.0f) {
                R.rivalHitCooldown = 10;
                R.bumps++;
                bump_fx((c->pos[0] + R.obj->oPosX) * 0.5f, c->pos[1], (c->pos[2] + R.obj->oPosZ) * 0.5f, closing);
                c->yawVel += (nx * coss(c->yaw) - nz * sins(c->yaw)) * closing * 18.0f;
            }
        }
    }
    // the traffic: heavy, and in the way
    for (i = 0; i < R.numTraffic; i++) {
        struct Object *t = R.traffic[i];
        if (t == NULL || !(t->activeFlags & ACTIVE_FLAG_ACTIVE) || ABS(t->oPosY - c->pos[1]) > 300.0f) {
            continue;
        }
        if (!cars_touch(c->pos[0], c->pos[2], c->yaw, t->oPosX, t->oPosZ, t->oFaceAngleYaw, &nx, &nz, &depth)) {
            continue;
        }
        fx = sins(t->oFaceAngleYaw) * t->oForwardVel;
        fz = coss(t->oFaceAngleYaw) * t->oForwardVel;
        closing = -((c->vel[0] - fx) * nx + (c->vel[2] - fz) * nz);
        c->pos[0] += nx * depth;
        c->pos[2] += nz * depth;
        t->oAngleVelYaw = (random_u16() & 1) ? 0x280 : -0x280;
        if (closing > 0.0f) {
            c->vel[0] += nx * closing * 1.1f;
            c->vel[2] += nz * closing * 1.1f;
            if (R.hitCooldown == 0 && closing > 8.0f) {
                R.hitCooldown = 14;
                R.bumps++;
                R.trafficHits++;
                c->vel[0] *= 0.72f;
                c->vel[2] *= 0.72f;
                bump_fx((c->pos[0] + t->oPosX) * 0.5f, c->pos[1], (c->pos[2] + t->oPosZ) * 0.5f, closing + 12.0f);
                play_sound(SOUND_MENU_CAMERA_BUZZ, t->header.gfx.cameraToObject);     // the honk
                c->yawVel += (nx * coss(c->yaw) - nz * sins(c->yaw)) * closing * 22.0f;
            }
        }
    }
}

/* ------------------------------------------------------------------------------------ Mario in the race */

/* the drift boost is the core's (vehicle.c); the slipstream and the rocket start are the race's */
void studio_race_autopilot_input(struct Controller *ctl);

void studio_race_drive(struct MarioState *m) {
    struct StudioCar *c = &gStudioCar;
    studio_race_autopilot_input(m->controller);
    if (!studio_race_active() || !c->race) {
        return;
    }
    c->held = (R.state < RS_RACE || R.stall > 0 || R.respawnTimer > 0);
    c->autoBrake = FALSE;
    if (R.state >= RS_FINISH) {
        // the finish: hands off, the car draws up
        m->controller->buttonDown = 0;
        m->controller->buttonPressed = 0;
        m->controller->stickX = 0;
        m->controller->stickY = 0;
        c->held = FALSE;
        c->autoBrake = TRUE;
        c->autoSteer = 0.0f;
        c->boostTimer = 0;
        return;
    }
    if (R.state == RS_RACE && R.respawnTimer == 0) {
        f32 dx = c->pos[0] - R.obj->oPosX, dz = c->pos[2] - R.obj->oPosZ;
        f32 behind = -(dx * sins(V.yaw) + dz * coss(V.yaw));
        f32 side = dx * coss(V.yaw) - dz * sins(V.yaw);
        if (behind > SLIP_BEHIND_MIN && behind < SLIP_BEHIND_MAX && ABS(side) < SLIP_SIDE && c->fwdSpeed > 60.0f) {
            R.slipstream++;
            if (R.slipstream == SLIP_BUILD) {
                play_sound(SOUND_ENV_WIND2, c->obj->header.gfx.cameraToObject);
            }
            if (R.slipstream >= SLIP_BUILD) {
                c->topBonus += SLIP_TOP;
                c->boostAccel += 0.25f;
            }
        } else {
            R.slipstream = 0;
        }
    } else {
        c->driftCharge = 0.0f;
    }
}

/* off the course, fallen or stuck: a fade, and back on the centre line where he was */
static void mario_respawn_check(struct MarioState *m) {
    struct StudioCar *c = &gStudioCar;
    struct TrackPos tp;

    if (R.respawnTimer > 0) {
        R.respawnTimer++;
        if (R.respawnTimer == 12) {
            struct Surface *floor;
            f32 y;
            track_at(R.marioS, 0.0f, R.marioSeg, &tp);
            y = find_floor(tp.x, tp.y + 400.0f, tp.z, &floor);
            studio_car_place(tp.x, floor != NULL ? y : tp.y, tp.z, atan2s(tp.tz, tp.tx));
            c->camInit = FALSE;
            play_transition(WARP_TRANSITION_FADE_FROM_COLOR, 10, 0, 0, 0);
        }
        if (R.respawnTimer >= 20) {
            R.respawnTimer = 0;
            R.stuck = 0;
        }
        return;
    }
    track_at(R.marioS, 0.0f, R.marioSeg, &tp);
    if ((m->controller->buttonDown & A_BUTTON) && ABS(c->fwdSpeed) < 5.0f) {
        R.stuck++;
    } else {
        R.stuck = 0;
    }
    if (c->pos[1] < tp.y - 700.0f || ABS(R.mario.lateral) > R.cfg.halfW + 600.0f || R.stuck > RESPAWN_STUCK) {
        R.respawnTimer = 1;
        R.respawns++;
        play_transition(WARP_TRANSITION_FADE_INTO_COLOR, 10, 0, 0, 0);
        play_sound(SOUND_MARIO_MAMA_MIA, m->marioObj->header.gfx.cameraToObject);
    }
}

void studio_race_after_drive(struct MarioState *m) {
    struct StudioCar *c = &gStudioCar;
    f32 s, lat, fwd;
    if (!studio_race_active() || !c->race || sN < 2) {
        return;
    }
    if (R.state >= RS_RACE && R.state != RS_GRID) {
        car_shoves();
    }
    track_project(c->pos[0], c->pos[1], c->pos[2], &R.marioSeg, &s, &lat);
    R.marioS = s;
    R.mario.lateral = lat;
    R.mario.seg = R.marioSeg;
    if (R.state == RS_RACE && R.mario.finish == 0) {
        if (racer_advance(&R.mario, s)) {
            R.lapShow = 100;
            if (R.mario.lap < R.laps) {
                R.lapFlash = R.mario.lap == R.laps - 1 ? 90 : 60;
                play_sound(R.mario.lap == R.laps - 1 ? SOUND_MENU_STAR_SOUND : SOUND_GENERAL2_RIGHT_ANSWER, gDefaultSoundArgs);
                event("lap", R.mario.lap);
            }
        }
        // the wrong way: moving against the course, or facing back along it and moving
        fwd = c->vel[0] * sSegDx[R.marioSeg] + c->vel[2] * sSegDz[R.marioSeg];
        if (fwd < -12.0f || (sins(c->yaw) * sSegDx[R.marioSeg] + coss(c->yaw) * sSegDz[R.marioSeg] < -0.5f && ABS(c->fwdSpeed) > 12.0f)) {
            R.wrongWay++;
        } else {
            R.wrongWay = 0;
        }
        mario_respawn_check(m);
    }
}

/* ------------------------------------------------------------------------------------ the camera */

s32 studio_race_camera(f32 *pos, f32 *focus) {
    struct StudioCar *c = &gStudioCar;
    f32 t, ang, r, h, fx, fz, rx, rz, gx, gz;
    s32 len = R.restarts > 0 ? 60 : INTRO_FRAMES;

    if (!studio_race_active() || R.state != RS_INTRO || !c->race) {
        return FALSE;
    }
    // round the grid: from ahead of the rival's grille, low, to behind Mario's car
    t = (f32) R.timer / len;
    t = CLAMP(t, 0.0f, 1.0f);
    t = t * t * (3.0f - 2.0f * t);
    fx = sins(c->yaw);
    fz = coss(c->yaw);
    rx = -fz;
    rz = fx;
    gx = (c->pos[0] + R.obj->oPosX) * 0.5f;
    gz = (c->pos[2] + R.obj->oPosZ) * 0.5f;
    ang = (0.12f + t * 0.88f) * 3.14159f;            // 0: ahead, pi: behind (round his side)
    r = 950.0f - t * 250.0f;
    h = 70.0f + t * 200.0f;
    pos[0] = gx + (fx * cosf(ang) + rx * sinf(ang)) * r - rx * t * 120.0f;
    pos[1] = c->pos[1] + h;
    pos[2] = gz + (fz * cosf(ang) + rz * sinf(ang)) * r - rz * t * 120.0f;
    focus[0] = gx + fx * t * 500.0f - rx * t * 150.0f;
    focus[1] = c->pos[1] + 90.0f + t * 40.0f;
    focus[2] = gz + fz * t * 500.0f - rz * t * 150.0f;
    sFOVState.fov = 45.0f + t * 5.0f;
    vec3f_copy(gLakituState.curPos, pos);
    vec3f_copy(gLakituState.curFocus, focus);
    return TRUE;
}

/* ------------------------------------------------------------------------------------ the rival */

static void rival_pose(void) {
    struct TrackPos tp;
    struct Surface *floor;
    struct StudioCarLook *l = rival_look();
    f32 y, yf, yr, fx, fz;
    s16 motion, want;
    struct Object *obj = R.obj;

    track_at(V.s, V.lat, V.seg, &tp);
    V.seg = tp.seg;
    y = find_floor(tp.x, tp.y + 300.0f, tp.z, &floor);
    if (floor == NULL) y = find_floor(tp.x, tp.y + 3000.0f, tp.z, &floor);
    obj->oPosX = tp.x;
    obj->oPosY = floor != NULL ? y : tp.y;
    obj->oPosZ = tp.z;
    motion = atan2s(tp.tz, tp.tx);
    if (V.v > 5.0f) {
        motion -= atan2s(V.v, V.latVel);
    }
    V.motionYaw = motion;
    // a slide into the bends: the nose inside the corner, by the sideways pull
    want = (s16) CLAMP(tp.curv * V.v * V.v * RIVAL_DRIFT_K, -RIVAL_DRIFT_MAX, RIVAL_DRIFT_MAX);
    if (V.v < 50.0f) {
        want = 0;
    }
    V.slide = approach_s16_symmetric(V.slide, want, 0x180);
    V.yaw = motion - V.slide;
    fx = sins(V.yaw);
    fz = coss(V.yaw);
    yf = find_floor(obj->oPosX + fx * l->axleF, obj->oPosY + 200.0f, obj->oPosZ + fz * l->axleF, &floor);
    if (floor == NULL) yf = obj->oPosY;
    yr = find_floor(obj->oPosX + fx * l->axleR, obj->oPosY + 200.0f, obj->oPosZ + fz * l->axleR, &floor);
    if (floor == NULL) yr = obj->oPosY;
    obj->oFaceAnglePitch = -atan2s(l->axleF - l->axleR, yf - yr);
    obj->oFaceAngleYaw = obj->oMoveAngleYaw = V.yaw;
    obj->oFaceAngleRoll = (s16) (V.slide * -0.15f);
    obj->oForwardVel = V.v;
    V.spin += (s16) (V.v * 290.0f);
    V.steer = (s16) CLAMP(V.slide * 0.9f - tp.curv * 8000000.0f, -0x1600, 0x1600);   // (a drift: countersteer)
}

static void rival_effects(s32 braking) {
    struct Object *obj = R.obj;
    struct StudioCarLook *l = rival_look();
    f32 fx = sins(V.yaw), fz = coss(V.yaw), rx = -fz, rz = fx;
    f32 x, z;

    if (l->lights) obj->oAnimState = braking ? 2 : 1;
    if (ABS(V.slide) > 0x900) {
        V.wasDrifting = TRUE;
        if (++V.smoke >= 3) {
            struct Object *p;
            V.smoke = 0;
            x = obj->oPosX + fx * l->axleR;
            z = obj->oPosZ + fz * l->axleR;
            p = spawn_object(obj, MODEL_SMOKE, bhvWhitePuffSmoke);
            if (p) { p->oPosX = x + rx * l->track; p->oPosY = obj->oPosY + 8.0f; p->oPosZ = z + rz * l->track; }
            p = spawn_object(obj, MODEL_SMOKE, bhvWhitePuffSmoke);
            if (p) { p->oPosX = x - rx * l->track; p->oPosY = obj->oPosY + 8.0f; p->oPosZ = z - rz * l->track; }
        }
        if (obj->oDistanceToMario < 5000.0f) {
            play_sound(SOUND_AIR_ROUGH_SLIDE, obj->header.gfx.cameraToObject);
        }
    } else if (V.wasDrifting) {
        V.wasDrifting = FALSE;
        V.boost = RIVAL_BOOST_FRAMES;
        if (obj->oDistanceToMario < 4000.0f) {
            play_sound(SOUND_OBJ_FLAME_BLOWN, obj->header.gfx.cameraToObject);
        }
    }
    if (V.boost > 0) {
        V.boost--;
        x = obj->oPosX - fx * (l->halfLen + 10.0f);
        z = obj->oPosZ - fz * (l->halfLen + 10.0f);
        flame_at(obj, MODEL_RED_FLAME, x + rx * 34.0f, obj->oPosY + 30.0f, z + rz * 34.0f, 2.8f);
        flame_at(obj, MODEL_RED_FLAME, x - rx * 34.0f, obj->oPosY + 30.0f, z - rz * 34.0f, 2.8f);
    }
}

static f32 rival_target_lat(void) {
    f32 want = 0.0f, lim = MAX(0.0f, R.cfg.halfW - 190.0f);
    s32 i;
    for (i = 0; i < R.numTraffic; i++) {
        struct Object *t = R.traffic[i];
        f32 ahead, tl;
        if (t == NULL) continue;
        ahead = wrap_ds(t->oHomeX - V.s);  // (the traffic's s in oHomeX, its lane in oHomeZ)
        tl = t->oHomeZ;
        if (ahead > -250.0f && ahead < 900.0f + V.v * 14.0f && ABS(tl - want) < 330.0f) {
            f32 left = tl - 420.0f, right = tl + 420.0f;
            if (right > lim) want = left;
            else if (left < -lim) want = right;
            else want = ABS(left - V.lat) < ABS(right - V.lat) ? left : right;
        }
    }
    if (R.state == RS_RACE) {
        f32 ahead = wrap_ds(R.marioS - V.s);
        f32 ml = R.mario.lateral;
        if (ahead > 0.0f && ahead < 800.0f && ABS(ml - want) < 300.0f) {
            f32 left = ml - 400.0f, right = ml + 400.0f;
            want = (right > lim) ? left : (left < -lim) ? right : (ABS(left - V.lat) < ABS(right - V.lat) ? left : right);
        } else if (ahead < -120.0f && ahead > -RIVAL_BLOCK_BEHIND) {
            want += (ml - want) * RIVAL_BLOCK_SHARE;
        }
    }
    return CLAMP(want, -lim, lim);
}

static void rival_update(void) {
    struct TrackPos tp;
    f32 target, gap, slow, rubber, pace;
    s32 braking = FALSE;

    track_at(V.s, V.lat, V.seg, &tp);
    if (R.state == RS_RACE || R.state == RS_FINISH) {
        if (R.state == RS_RACE && R.raceTime < RIVAL_REACTION) {
            target = 0.0f;
        } else if (R.state == RS_FINISH || R.rival.finish != 0) {
            target = MAX(0.0f, V.v - 2.0f);           // over the line: easing off
        } else {
            gap = R.rival.progress - R.mario.progress;
            pace = R.cfg.pace > 0 ? R.cfg.pace : 0.95f;
            rubber = 1.0f;
            if (R.cfg.rubber) {
                if (gap > 0.0f) {
                    slow = R.rival.lap >= R.laps - 1 ? 0.0f : RIVAL_SLOW_MAX;
                    rubber = 1.0f - slow * MIN(1.0f, gap / RIVAL_SLOW_GAP);
                } else {
                    rubber = 1.0f + RIVAL_PUSH_MAX * MIN(1.0f, -gap / RIVAL_PUSH_GAP);
                }
            }
            target = tp.speed * pace * rubber;
            if (V.boost > 0) target *= RIVAL_BOOST;
            target = MIN(target, V.top * 1.17f);
        }
        if (V.v < target) {
            V.v = MIN(target, V.v + RIVAL_ACCEL * MAX(0.25f, 1.0f - V.v / 140.0f));
        } else {
            braking = V.v - target > 1.0f;
            V.v = MAX(target, V.v - RIVAL_DECEL);
        }
        {
            f32 want = (R.state == RS_RACE && R.rival.finish == 0) ? rival_target_lat() : V.lat;
            f32 lim = MAX(0.0f, R.cfg.halfW - 130.0f);
            V.latVel = approach_f32(V.latVel, CLAMP((want - V.lat) * 0.06f, -RIVAL_LAT_RATE, RIVAL_LAT_RATE), 1.2f, 1.2f);
            V.lat += V.latVel;
            V.lat = CLAMP(V.lat, -lim, lim);
        }
        V.s = wrap_s(V.s + V.v);
        if (R.state == RS_RACE && racer_advance(&R.rival, V.s)) {
            if (R.rival.lap == R.laps - 1 && R.rival.progress > R.mario.progress - 3000.0f) {
                taunt(TAUNT_FINAL, FALSE);
            }
        }
        R.rival.seg = V.seg;
        R.rival.lateral = V.lat;
    } else {
        V.v = 0.0f;
    }
    rival_pose();
    if (R.state >= RS_COUNTDOWN && R.state <= RS_FINISH) {
        rival_effects(braking);
    }
}

/* ------------------------------------------------------------------------------------ the traffic */

static void traffic_pose(struct Object *t) {
    struct TrackPos tp;
    struct Surface *floor;
    f32 y;
    track_at(t->oHomeX, t->oHomeZ, (s32) t->oHomeY, &tp);
    t->oHomeY = tp.seg;
    y = find_floor(tp.x, tp.y + 300.0f, tp.z, &floor);
    t->oPosX = tp.x;
    t->oPosY = floor != NULL ? y : tp.y;
    t->oPosZ = tp.z;
    t->oFaceAngleYaw = t->oMoveAngleYaw = atan2s(tp.tz, tp.tx) + (s16) t->oAngleVelYaw;
}

void bhv_studio_traffic_car_loop(void) {
    if (!studio_race_active() || sN < 2) {
        obj_mark_for_deletion(o);
        return;
    }
    if (R.state == RS_RACE || (R.state == RS_FINISH && R.timer < 60)) {
        o->oHomeX = wrap_s(o->oHomeX + o->oForwardVel);
        if (!sClosed && o->oHomeX >= sLapLen - 1.0f) {
            o->oHomeX = 0.0f;     // (a sprint: back to the start)
        }
    }
    o->oAngleVelYaw = (s16) (o->oAngleVelYaw * 0.85f);
    traffic_pose(o);
    load_object_collision_model();
}

static void traffic_spawn(void) {
    static const s32 looks[] = { 6, 7, 3, 4, 8, 9 };
    s32 i, n = CLAMP(R.cfg.traffic, 0, MAX_TRAFFIC);
    R.numTraffic = 0;
    for (i = 0; i < n; i++) {
        s32 look = looks[i % 6];
        struct Object *t = studio_spawn_raw(bhvStudioTrafficCar, studio_car_look_node(look, 0, NULL), 0, 0, 0, 0, 0, 0, 0);
        f32 s;
        if (t == NULL) break;
        t->collisionData = (void *) gStudioCarLooks[look].collision;
        // spread round the course, not on the grid or just ahead of it
        s = sLapLen * (0.18f + 0.78f * (f32) i / MAX(1, n));
        t->oHomeX = wrap_s(s);
        t->oHomeZ = ((i & 1) ? 1.0f : -1.0f) * MIN(260.0f, R.cfg.halfW * 0.45f);
        t->oHomeY = seg_at(t->oHomeX, 0);
        t->oForwardVel = TRAFFIC_SPEED + (f32) (i % 5) * 3.0f;
        traffic_pose(t);
        R.traffic[R.numTraffic++] = t;
    }
}

static void traffic_clear(void) {
    s32 i;
    for (i = 0; i < R.numTraffic; i++) {
        if (R.traffic[i] != NULL && (R.traffic[i]->activeFlags & ACTIVE_FLAG_ACTIVE)) {
            obj_mark_for_deletion(R.traffic[i]);
        }
        R.traffic[i] = NULL;
    }
    R.numTraffic = 0;
}

/* ------------------------------------------------------------------------------------ the driver */

void bhv_studio_race_driver_loop(void) {
    struct Object *car = o->parentObj;
    struct StudioCarLook *l;
    s32 look;
    f32 fx, fz, rx, rz;
    if (car == NULL || !(car->activeFlags & ACTIVE_FLAG_ACTIVE) || car->behavior != segmented_to_virtual(bhvStudioRace)) {
        obj_mark_for_deletion(o);
        return;
    }
    look = studio_car_look_of(car);
    l = &gStudioCarLooks[look >= 0 ? look : 2];
    fx = sins(car->oFaceAngleYaw);
    fz = coss(car->oFaceAngleYaw);
    rx = -fz;
    rz = fx;
    // at the wheel (the driver's side: the car's left), hidden in closed cars
    o->oPosX = car->oPosX + fx * (l->seat[2] - 10.0f) - rx * l->seat[0];
    o->oPosY = car->oPosY + l->seat[1] - 12.0f;
    o->oPosZ = car->oPosZ + fz * (l->seat[2] - 10.0f) - rz * l->seat[0];
    obj_scale(o, 0.8f);
    o->oFaceAngleYaw = o->oMoveAngleYaw = car->oFaceAngleYaw + (s16) ((R.obj == car ? V.slide : 0) * 0.5f);
    o->oFaceAnglePitch = car->oFaceAnglePitch;
    o->oFaceAngleRoll = car->oFaceAngleRoll;
    o->header.gfx.unk38.animAccel = 0x4000;
    o->oOpacity = 255;
    if (l->open) {
        o->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    } else {
        o->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
    }
}

/* ------------------------------------------------------------------------------------ the race */

static struct RaceCfg *race_cfg(struct Object *obj) {
    s32 slot = obj - gObjectPool;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) return NULL;
    if (sCfg[slot].uid != obj->unused2) {
        memset(&sCfg[slot], 0, sizeof(sCfg[slot]));
        sCfg[slot].uid = obj->unused2;
        sCfg[slot].laps = 3;
        sCfg[slot].pace = 0.95f;
        sCfg[slot].halfW = 900.0f;
        sCfg[slot].playerLook = 1;
        sCfg[slot].star = 1;
        sCfg[slot].smooth = 1;
        sCfg[slot].rubber = 1;
    }
    return &sCfg[slot];
}

void studio_car_place(f32 x, f32 y, f32 z, s16 yaw) {
    struct StudioCar *c = &gStudioCar;
    c->pos[0] = x;
    c->pos[1] = y;
    c->pos[2] = z;
    c->yaw = yaw;
    c->pitch = c->roll = 0;
    c->vel[0] = c->vel[1] = c->vel[2] = 0.0f;
    c->fwdSpeed = c->yawVel = c->slip = 0.0f;
    c->grounded = TRUE;
    vec3f_copy(c->safePos, c->pos);
    if (c->obj != NULL) {
        c->obj->oPosX = x;
        c->obj->oPosY = y;
        c->obj->oPosZ = z;
        c->obj->oFaceAngleYaw = c->obj->oMoveAngleYaw = yaw;
        c->obj->oFaceAnglePitch = c->obj->oFaceAngleRoll = 0;
        vec3f_copy(c->obj->header.gfx.pos, c->pos);
        vec3s_set(c->obj->header.gfx.angle, 0, yaw, 0);
    }
}

/* the grid: the rival on the start line, Mario's car beside him (the side with room) */
static void grid_place(struct MarioState *m) {
    struct StudioCar *c = &gStudioCar;
    struct TrackPos tp;
    struct Surface *floor;
    f32 s0, lat0, x, z, y;
    s32 k, side;
    s16 yaw;

    // the rival back home, on the course
    R.obj->oPosX = R.homeX;
    R.obj->oPosY = R.homeY;
    R.obj->oPosZ = R.homeZ;
    V.seg = nearest_seg(R.homeX, R.homeZ);
    track_project(R.homeX, R.homeY, R.homeZ, &V.seg, &s0, &lat0);
    V.s = s0;
    V.lat = 0.0f;
    V.latVel = V.v = 0.0f;
    V.slide = 0;
    V.boost = 0;
    V.wasDrifting = FALSE;
    racer_start(&R.rival, s0);
    rival_pose();
    // Mario beside him: right, left, then behind
    yaw = V.yaw;
    for (k = 0; k < 3; k++) {
        side = k == 0 ? 1 : k == 1 ? -1 : 0;
        track_at(s0 - (side == 0 ? 650.0f : 0.0f), side * 380.0f, V.seg, &tp);
        x = tp.x;
        z = tp.z;
        y = find_floor(x, R.homeY + 400.0f, z, &floor);
        if (floor != NULL && ABS(y - R.homeY) < 300.0f) {
            struct WallCollisionData wc;
            wc.x = x; wc.y = y; wc.z = z; wc.offsetY = 60.0f; wc.radius = 120.0f;
            if (find_wall_collisions(&wc) == 0 || k == 2) {
                break;
            }
        }
    }
    if (floor == NULL) {
        x = R.homeX;
        y = R.homeY + 200.0f;
        z = R.homeZ;
    }
    studio_car_place(x, y, z, yaw);
    R.marioSeg = V.seg;
    track_project(c->pos[0], c->pos[1], c->pos[2], &R.marioSeg, &R.marioS, &R.mario.lateral);
    racer_start(&R.mario, R.marioS);
    if (!sClosed) {
        R.mario.progress = R.marioS;
    }
    c->held = TRUE;
    c->camInit = FALSE;
    c->autoBrake = FALSE;
    c->topBonus = c->boostAccel = 0.0f;
    c->boostTimer = 0;
    c->driftCharge = 0.0f;
    mario_drop_held_object(m);
}

static void race_hud(s32 on);

static void race_begin(struct MarioState *m, struct Object *race) {
    struct RaceCfg *cfg = race_cfg(race);
    struct StudioCarCfg *rc = studio_car_cfg(race);
    s32 rematch = race == R.obj && race_alive();
    struct Object *keepCar = rematch ? R.playerCar : NULL;
    s32 restarts = rematch ? R.restarts + 1 : 0;

    traffic_clear();
    memset(&R, 0, sizeof(R));
    R.obj = race;
    R.uid = race->unused2;
    R.cfg = *cfg;
    R.restarts = restarts;
    R.playerCar = keepCar;
    R.homeX = race->oHomeX;
    R.homeY = race->oHomeY;
    R.homeZ = race->oHomeZ;
    R.homeYaw = (s16) race->oStudioCarHomeYaw;
    R.taunt = -1;
    R.lastPos = 2;
    R.laps = CLAMP(cfg->laps, 1, 9);
    {
        const f32 (*pts)[3];
        s32 mode, wait;
        if (studio_motion_path(race, &pts, &mode, &wait) < 2) {
            R.obj = NULL;
            return;
        }
    }
    // Mario's car: the one he drives, or the race's
    if (!studio_vehicle_driving()) {
        struct Object *car = R.playerCar;
        if (car == NULL || !(car->activeFlags & ACTIVE_FLAG_ACTIVE) || car->behavior != segmented_to_virtual(bhvStudioCar)) {
            car = studio_car_spawn_player(CLAMP(cfg->playerLook, 0, gStudioCarLookCount - 2), cfg->playerPaint,
                                          m->pos[0], m->pos[1], m->pos[2], race->oFaceAngleYaw);
        }
        if (car == NULL) {
            R.obj = NULL;
            return;
        }
        R.playerCar = car;
        if (cfg->playerTop > 0) {
            studio_car_cfg(car)->top = cfg->playerTop;
        }
        gStudioCar.race = TRUE;
        studio_car_seat_mario(m, car, TRUE);
    } else {
        gStudioCar.race = TRUE;
        studio_car_tune(studio_car_cfg(gStudioCar.obj), TRUE);
    }
    // the rival's top speed: his car's, or (unset) Mario's: an even fight
    V.top = rc != NULL && rc->top > 0 ? rc->top : gStudioCar.top;
    track_build(race);
    if (!sClosed) {
        R.laps = 1;
    }
    grid_place(m);
    traffic_spawn();
    set_state(RS_GRID);
    race_hud(TRUE);
    play_transition(WARP_TRANSITION_FADE_FROM_COLOR, 14, 0, 0, 0);
    func_8031FFB4(SEQ_PLAYER_LEVEL, 30, 45);
    event("race_start", R.restarts);
}

static s16 sHudBefore = -1;

/* the game's HUD (lives, coins, stars) steps aside for the race's own (the page draws it) */
static void race_hud(s32 on) {
    if (on && sHudBefore < 0) {
        sHudBefore = gHudDisplay.flags;
        gHudDisplay.flags = HUD_DISPLAY_NONE;
    } else if (!on && sHudBefore >= 0) {
        gHudDisplay.flags = sHudBefore;
        sHudBefore = -1;
    }
}

static void race_end(void) {
    race_hud(FALSE);
    traffic_clear();
    sequence_player_unlower(SEQ_PLAYER_LEVEL, 20);
    if (gStudioCar.race) {
        gStudioCar.race = FALSE;
        gStudioCar.held = gStudioCar.autoBrake = FALSE;
        gStudioCar.topBonus = gStudioCar.boostAccel = 0.0f;
    }
    R.state = RS_NONE;
}

/* B by the rival's door, or a honk beside him: the race */
s32 studio_race_prompt(struct MarioState *m) {
    struct ObjectNode *list = &gObjectLists[OBJ_LIST_SURFACE];
    struct Object *p;
    const BehaviorScript *bhv = segmented_to_virtual(bhvStudioRace);

    if (studio_race_active() && R.state != RS_RESULT) {
        return FALSE;
    }
    for (p = (struct Object *) list->next; p != (struct Object *) list; p = (struct Object *) p->header.next) {
        f32 dx = m->pos[0] - p->oPosX, dz = m->pos[2] - p->oPosZ;
        if (p->behavior != bhv || !(p->activeFlags & ACTIVE_FLAG_ACTIVE) || ABS(m->pos[1] - p->oPosY) > 160.0f) {
            continue;
        }
        if (studio_race_active() && p != R.obj) {
            continue;
        }
        if (dx * dx + dz * dz < 520.0f * 520.0f) {
            const f32 (*pts)[3];
            s32 mode, wait;
            if (studio_motion_path(p, &pts, &mode, &wait) < 2) {
                return FALSE;           // (no course drawn yet)
            }
            if (m->input & INPUT_B_PRESSED) {
                m->input &= ~INPUT_B_PRESSED;
                play_transition(WARP_TRANSITION_FADE_INTO_COLOR, 10, 0, 0, 0);
                race_begin(m, p);
            }
            return TRUE;
        }
    }
    return FALSE;
}

// a honk next to a rival (driving): the race
static void honk_check(struct MarioState *m) {
    struct ObjectNode *list = &gObjectLists[OBJ_LIST_SURFACE];
    struct Object *p;
    const BehaviorScript *bhv = segmented_to_virtual(bhvStudioRace);
    if (!studio_vehicle_driving() || gStudioCar.race || gStudioCar.hornTimer != 12 || ABS(gStudioCar.fwdSpeed) > 20.0f) {
        return;
    }
    for (p = (struct Object *) list->next; p != (struct Object *) list; p = (struct Object *) p->header.next) {
        f32 dx = gStudioCar.pos[0] - p->oPosX, dz = gStudioCar.pos[2] - p->oPosZ;
        if (p->behavior == bhv && (p->activeFlags & ACTIVE_FLAG_ACTIVE) && dx * dx + dz * dz < 1100.0f * 1100.0f
            && ABS(gStudioCar.pos[1] - p->oPosY) < 300.0f) {
            const f32 (*pts)[3];
            s32 mode, wait;
            if (studio_motion_path(p, &pts, &mode, &wait) >= 2) {
                play_transition(WARP_TRANSITION_FADE_INTO_COLOR, 10, 0, 0, 0);
                race_begin(m, p);
            }
            return;
        }
    }
}

static void countdown_throttle(struct MarioState *m) {
    if (!(m->controller->buttonDown & A_BUTTON) && m->controller->stickY <= 40) {
        R.aHeldSince = -1;
    } else if (R.aHeldSince < 0) {
        R.aHeldSince = R.timer;
    }
}

static void countdown_go(struct MarioState *m) {
    s32 go = 3 * COUNT_FRAMES;
    R.rocket = 0;
    if (R.aHeldSince >= 0 && ((m->controller->buttonDown & A_BUTTON) || m->controller->stickY > 40)) {
        if (go - R.aHeldSince <= ROCKET_WINDOW) {
            R.rocket = 1;
            gStudioCar.boostFire = TRUE;
            gStudioCar.boostTimer = ROCKET_FRAMES;
            play_sound(SOUND_OBJ_FLAME_BLOWN, gStudioCar.obj->header.gfx.cameraToObject);
            play_sound(SOUND_MARIO_YAHOO, m->marioObj->header.gfx.cameraToObject);
        } else if (go - R.aHeldSince >= STALL_EARLY) {
            R.rocket = -1;
            R.stall = STALL_FRAMES;
            play_sound(SOUND_GENERAL_FLAME_OUT, gStudioCar.obj->header.gfx.cameraToObject);
        }
    }
}

static void give_star(struct MarioState *m) {
    struct Object *star;
    f32 x = m->pos[0] + sins(m->faceAngle[1]) * 220.0f, y = m->pos[1] + 70.0f, z = m->pos[2] + coss(m->faceAngle[1]) * 220.0f;
    // out of the rival's car, to Mario (spawn_star.inc.c's spawn_star)
    star = spawn_object_abs_with_rot(R.obj, 0, MODEL_STAR, bhvStarSpawnCoordinates, R.obj->oPosX, R.obj->oPosY + 150.0f,
                                     R.obj->oPosZ, 0, 0, 0);
    if (star == NULL) return;
    star->oBehParams = 6 << 24; // (a studio star: the page knows it by the race's uid)
    star->oHomeX = x;
    star->oHomeY = y;
    star->oHomeZ = z;
    star->oFaceAnglePitch = star->oFaceAngleRoll = 0;
    star->oBehParams2ndByte = 0;
    star->unused2 = R.uid;
    R.starGiven = TRUE;
}

/* the finish: both cars stopped, Mario out by his door */
static void park(struct MarioState *m) {
    struct StudioCar *c = &gStudioCar;
    s32 k;
    for (k = 0; k < 2; k++) {
        f32 side = k == 0 ? 1.0f : -1.0f;
        f32 x = c->pos[0] + coss(c->yaw) * side * (gStudioCarLooks[c->look].doorX), z = c->pos[2] - sins(c->yaw) * side * gStudioCarLooks[c->look].doorX;
        struct Surface *floor;
        f32 y = find_floor(x, c->pos[1] + 150.0f, z, &floor);
        if (floor != NULL && ABS(y - c->pos[1]) < 150.0f) {
            studio_car_release(m, x, z, c->yaw + (s16) (side * 0x4000));
            return;
        }
    }
    studio_car_release(m, c->pos[0], c->pos[2] - 300.0f, c->yaw);
}

void studio_race_hud(f32 *h) {
    if (!studio_race_active()) {
        return;
    }
    h[18] = R.state <= RS_GRID ? R.state : R.state - 1; // (the page: 1 intro, 2 countdown, 3 race, 4 finish, 5 result)
    h[19] = R.count;
    h[20] = MIN(R.mario.lap + 1, R.laps);
    h[21] = R.laps;
    h[22] = R.position;
    h[23] = R.raceTime;
    h[24] = R.mario.lastLap;
    h[25] = R.mario.bestLap;
    h[26] = R.wrongWay;
    h[27] = R.slipstream >= SLIP_BUILD ? R.slipstream : 0;
    h[28] = R.rocket;
    h[29] = R.result;
    h[30] = R.taunt;
    h[31] = R.tauntTimer;
    h[32] = R.lapFlash;
    h[33] = (f32) (R.uid & 0xFFFFFF);
    h[34] = R.rival.progress - R.mario.progress;
    h[35] = R.timer;
    h[36] = R.mario.nextCp;
    h[37] = sNumCp;
    h[38] = R.respawns;
    h[39] = R.lapShow;
    h[40] = R.restarts;
    h[41] = V.v;
    h[42] = sLapLen > 0 ? R.mario.progress / (sLapLen * R.laps) : 0;
    h[43] = R.starGiven;
    h[44] = R.obj->oPosX;
    h[45] = R.obj->oPosZ;
    h[46] = sClosed;
    h[47] = sLapLen > 0 ? R.rival.progress / (sLapLen * R.laps) : 0;
}

void studio_race_reset_all(void) {
    sHudBefore = -1;
    R.state = RS_NONE;
    R.obj = NULL;
    R.playerCar = NULL;
    R.driver = NULL;
    R.numTraffic = 0;
    sN = 0;
}

s32 studio_race_wheels_for(struct Object *obj, s16 *spin, s16 *steer) {
    if (studio_race_active() && obj == R.obj) {
        *spin = V.spin;
        *steer = V.steer;
        return TRUE;
    }
    return FALSE;
}

void bhv_studio_race_init(void) {
    struct StudioCarCfg *cfg = studio_car_cfg(o);
    if (cfg != NULL && cfg->look >= 0) {
        s32 painted;
        struct GraphNode *n = studio_car_look_node(cfg->look, cfg->paint | (cfg->lights ? STV_BEAMS : 0), &painted);
        if (n != NULL) o->header.gfx.sharedChild = n;
        o->collisionData = (void *) gStudioCarLooks[cfg->look].collision;
    }
    o->oStudioCarHomeYaw = o->oFaceAngleYaw;
    o->oHomeX = o->oPosX;
    o->oHomeY = o->oPosY;
    o->oHomeZ = o->oPosZ;
    o->oAnimState = 1;
    if (R.obj == o && R.uid != o->unused2) {
        R.obj = NULL;
    }
}

void bhv_studio_race_loop(void) {
    struct MarioState *m = gMarioState;
    s32 pos;

    if (R.obj != o || R.state == RS_NONE) {
        // parked on the start line, its driver at the wheel, solid
        if (o->collisionData == NULL) {
            struct StudioCarCfg *cfg = studio_car_cfg(o);
            o->collisionData = (void *) gStudioCarLooks[cfg && cfg->look >= 0 ? cfg->look : 2].collision;
        }
        if (o->oTimer == 1) {
            struct Object *d = spawn_object(o, MODEL_NONE, bhvStudioRaceDriver);
            if (d != NULL) d->header.gfx.sharedChild = studio_car_look_node(gStudioCarLookCount - 1, 0, NULL);
        }
        load_object_collision_model();
        if (R.obj == NULL || !race_alive()) {
            honk_check(m);
        }
        return;
    }
    if (!studio_vehicle_driving() && R.state < RS_RESULT) {
        // Mario left the race some other way (a warp, build mode moved him)
        race_end();
        o->oPosX = R.homeX; o->oPosY = R.homeY; o->oPosZ = R.homeZ;
        o->oFaceAngleYaw = o->oMoveAngleYaw = R.homeYaw;
        o->oFaceAnglePitch = o->oFaceAngleRoll = 0;
        return;
    }
    R.timer++;
    if (R.tauntTimer > 0) R.tauntTimer--;
    if (R.tauntCooldown > 0) R.tauntCooldown--;
    if (R.lapFlash > 0) R.lapFlash--;
    if (R.lapShow > 0) R.lapShow--;
    switch (R.state) {
        case RS_GRID:
            if (R.timer > 2) {
                set_state(RS_INTRO);
            }
            break;
        case RS_INTRO:
            if (R.timer == 20) taunt(TAUNT_START, TRUE);
            if (R.timer >= (R.restarts > 0 ? 60 : INTRO_FRAMES)) {
                set_state(RS_COUNTDOWN);
                R.count = 3;
                R.aHeldSince = -1;
                play_sound(SOUND_MENU_CHANGE_SELECT, gDefaultSoundArgs);
            }
            break;
        case RS_COUNTDOWN:
            countdown_throttle(m);
            if (R.timer % COUNT_FRAMES == 0 && R.timer > 0) {
                R.count--;
                if (R.count > 0) play_sound(SOUND_MENU_CHANGE_SELECT, gDefaultSoundArgs);
            }
            if (R.count <= 0) {
                countdown_go(m);
                play_sound(SOUND_GENERAL_RACE_GUN_SHOT, gDefaultSoundArgs);
                play_sound(SOUND_MARIO_HERE_WE_GO, m->marioObj->header.gfx.cameraToObject);
                sequence_player_unlower(SEQ_PLAYER_LEVEL, 20);
                set_state(RS_RACE);
                R.raceTime = 0;
                R.prevCrashes = gStudioCar.crashes;
            }
            break;
        case RS_RACE:
            R.raceTime++;
            if (R.stall > 0) R.stall--;
            pos = R.mario.progress >= R.rival.progress ? 1 : 2;
            if (pos != R.lastPos && R.raceTime > 60) {
                taunt(pos == 1 ? TAUNT_PASSED : TAUNT_AHEAD, FALSE);
            }
            R.lastPos = pos;
            R.position = pos;
            if (gStudioCar.crashes != R.prevCrashes) {
                R.prevCrashes = gStudioCar.crashes;
                if (pos == 2 || R.rival.progress > R.mario.progress - 2500.0f) taunt(TAUNT_CRASH, FALSE);
            }
            if (pos == 1 && R.raceTime % 300 == 150 && R.mario.progress - R.rival.progress < 900.0f) taunt(TAUNT_CLOSE, FALSE);
            if (pos == 2 && R.raceTime % 300 == 0 && R.rival.progress - R.mario.progress < 500.0f
                && R.rival.progress - R.mario.progress > 0.0f) {
                taunt(TAUNT_BACK, FALSE);
            }
            if (R.mario.finish != 0 || R.rival.finish != 0) {
                R.result = (R.mario.finish != 0 && (R.rival.finish == 0 || R.mario.finish <= R.rival.finish)) ? RESULT_WIN : RESULT_LOSE;
                R.position = R.result == RESULT_WIN ? 1 : 2;
                R.tauntTimer = 0;
                set_state(RS_FINISH);
                if (R.result == RESULT_WIN) {
                    play_sound(SOUND_GENERAL2_RIGHT_ANSWER, gDefaultSoundArgs);
                    play_sound(SOUND_MARIO_YAHOO, m->marioObj->header.gfx.cameraToObject);
                } else {
                    play_sound(SOUND_MENU_CAMERA_BUZZ, gDefaultSoundArgs);
                    play_sound(SOUND_MARIO_MAMA_MIA, m->marioObj->header.gfx.cameraToObject);
                }
                event(R.result == RESULT_WIN ? "race_won" : "race_lost", R.raceTime);
            }
            break;
        case RS_FINISH:
            if (R.timer >= 70 && ABS(gStudioCar.fwdSpeed) < 4.0f) {
                park(m);
                race_end();
                R.state = RS_RESULT;
                R.timer = 0;
                R.taunt = R.result == RESULT_WIN ? TAUNT_LOSE : TAUNT_WIN;  // (his line: he lost / he won)
                R.tauntTimer = TAUNT_FRAMES;
                if (R.result == RESULT_WIN && R.cfg.star && !R.cfg.starDone && !R.starGiven) {
                    give_star(m);
                }
            } else if (R.timer > 240) {
                gStudioCar.fwdSpeed = 0.0f;   // (whatever it is doing: stopped)
            }
            break;
        case RS_RESULT:
            if (R.timer >= RESULT_FRAMES) {
                // the rival back on the start line
                R.state = RS_NONE;
                o->oPosX = R.homeX; o->oPosY = R.homeY; o->oPosZ = R.homeZ;
                o->oFaceAngleYaw = o->oMoveAngleYaw = R.homeYaw;
                o->oFaceAnglePitch = o->oFaceAngleRoll = 0;
                o->oAnimState = 1;
                spawn_mist_particles();
            }
            break;
    }
    if (R.state != RS_RESULT && R.state != RS_NONE) {
        rival_update();
    } else {
        load_object_collision_model();
    }
}

/* ------------------------------------------------------------------------------------ the page's API */

// A race's settings: [laps, pace, half width, player look, player paint, player top speed, traffic,
// star, star already collected, smooth, rubber band]
EMSCRIPTEN_KEEPALIVE
s32 studio_race_config(s32 slot, const f32 *v, s32 n) {
    struct Object *obj;
    struct RaceCfg *c;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || v == NULL) return 0;
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) return 0;
    c = race_cfg(obj);
    if (n > 0 && v[0] > 0) c->laps = (s32) v[0];
    if (n > 1 && v[1] > 0) c->pace = v[1];
    if (n > 2 && v[2] > 0) c->halfW = v[2];
    if (n > 3 && v[3] >= 0) c->playerLook = (s32) v[3];
    if (n > 4) c->playerPaint = (u32) v[4];
    if (n > 5) c->playerTop = v[5];
    if (n > 6) c->traffic = (s32) v[6];
    if (n > 7) c->star = v[7] != 0;
    if (n > 8) c->starDone = v[8] != 0;
    if (n > 9) c->smooth = v[9] != 0;
    if (n > 10) c->rubber = v[10] != 0;
    if (obj == R.obj) {
        R.cfg.starDone = c->starDone;
    }
    return 1;
}

// Tests and the page: start the race with this uid right away (Mario on foot or in a car), or end it.
EMSCRIPTEN_KEEPALIVE
s32 studio_race_start(u32 uid) {
    s32 i;
    if (gMarioState == NULL) return 0;
    if (uid == 0) {
        if (studio_race_active()) {
            race_end();
            return 1;
        }
        return 0;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *p = &gObjectPool[i];
        if ((p->activeFlags & ACTIVE_FLAG_ACTIVE) && p->unused2 == uid && p->behavior == segmented_to_virtual(bhvStudioRace)) {
            race_begin(gMarioState, p);
            return R.obj == p;
        }
    }
    return 0;
}

// The course as the race sees it (sampled), for the page's minimap and tests: {closed, length, pts:[[x,z],...]}
EMSCRIPTEN_KEEPALIVE
const char *studio_race_course_json(void) {
    static char buf[24000];
    s32 i, n = 0, step;
    if (sN < 2) return "{\"pts\":[]}";
    step = sN > 180 ? sN / 180 + 1 : 1;
    n += sprintf(buf + n, "{\"closed\":%d,\"length\":%.0f,\"laps\":%d,\"state\":%d,\"pts\":[", sClosed, sLapLen, R.laps, R.state);
    for (i = 0; i < sN; i += step) {
        n += sprintf(buf + n, "%s[%.0f,%.0f]", i ? "," : "", sPx[i], sPz[i]);
    }
    sprintf(buf + n, "]}");
    return buf;
}

// Test autopilot: steer Mario's car along the course (the racing line ahead), flooring it.
static s32 sAutopilot;
EMSCRIPTEN_KEEPALIVE
void studio_race_autopilot(s32 on) {
    sAutopilot = on;
}

void studio_race_autopilot_input(struct Controller *ctl) {
    struct StudioCar *c = &gStudioCar;
    struct TrackPos tp;
    f32 dx, dz, ang, look;
    if (!sAutopilot || !studio_vehicle_driving() || sN < 2) {
        return;
    }
    look = 420.0f + ABS(c->fwdSpeed) * 6.0f;
    track_at(R.marioS + look, 0.0f, R.marioSeg, &tp);
    dx = tp.x - c->pos[0];
    dz = tp.z - c->pos[2];
    ang = (s16) (atan2s(dz, dx) - c->yaw) / 182.04f;    // degrees, + left
    ctl->stickX = (s8) CLAMP(-ang * 3.0f, -64.0f, 64.0f);
    ctl->stickY = 0;
    ctl->buttonDown |= A_BUTTON;
    if (R.state == RS_COUNTDOWN && !(R.count == 1 && R.timer % COUNT_FRAMES >= 18)) {
        ctl->buttonDown &= ~A_BUTTON;   // (on the throttle just before GO: a rocket start)
    }
    if (R.state == RS_INTRO || R.state == RS_GRID) {
        ctl->buttonDown &= ~A_BUTTON;
    }
    if (ABS(ang) > 45.0f && c->fwdSpeed > 50.0f) {
        ctl->buttonDown &= ~A_BUTTON;
    }
}
