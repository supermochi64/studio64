// Studio 64 motion: blocks and objects that move along paths, rotate, swing,
// fall or crumble when Mario stands on them, blink, tilt like a seesaw, carry
// Mario like a conveyor or bounce him like a trampoline. Also the paths of the
// game's own path objects (Koopa the Quick, the racing penguin, platforms on tracks).
//
// The page sets a motion per object slot (studio_motion_set) right after it spawns
// a record. Moving objects report their per-frame movement in oVel and oAngleVel,
// which is what the game's platform displacement uses to carry Mario.

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
#include "audio_defines.h"
#include "object_constants.h"
#include "audio/external.h"
#include "engine/behavior_script.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "game/game_init.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/behavior_actions.h"
#include "game/spawn_sound.h"
#include "studio.h"
#include "objects.h"

#define o gCurrentObject

#define MOTION_PATH      (1 << 0)
#define MOTION_ROTATE    (1 << 1)
#define MOTION_SWING     (1 << 2)
#define MOTION_FALL      (1 << 3)
#define MOTION_BLINK     (1 << 4)
#define MOTION_CRUMBLE   (1 << 5)
#define MOTION_TILT      (1 << 6)
#define MOTION_CONVEYOR  (1 << 7)
#define MOTION_BOUNCE    (1 << 8)
#define MOTION_FACE_PATH (1 << 9)
#define MOTION_EXTERNAL  (1 << 10) // the path is walked by the object itself (custom enemies)
#define MOTION_SINK      (1 << 11) // sinks while Mario stands on it, rises back after

enum PathMode { PATH_LOOP, PATH_PINGPONG, PATH_ONCE };
enum Trigger { TRIGGER_ALWAYS, TRIGGER_STAND, TRIGGER_WHILE_STANDING, TRIGGER_NEAR, TRIGGER_EVENT };

// Layout of the float array the page passes (keep in sync with web/js/motion.js).
enum {
    CFG_FLAGS, CFG_NPTS, CFG_SPEED, CFG_MODE, CFG_WAIT, CFG_SMOOTH, CFG_TRIGGER, CFG_TRIGGER_R, CFG_PHASE,
    CFG_ROT_PITCH, CFG_ROT_YAW, CFG_ROT_ROLL,
    CFG_SWING_AXIS, CFG_SWING_AMP, CFG_SWING_PERIOD, CFG_SWING_PIVOT, CFG_SWING_PHASE,
    CFG_FALL_DELAY, CFG_FALL_RESPAWN,
    CFG_BLINK_ON, CFG_BLINK_OFF, CFG_BLINK_PHASE,
    CFG_CRUMBLE_DELAY, CFG_CRUMBLE_RESPAWN,
    CFG_TILT_MAX, CFG_TILT_SPEED, CFG_HALF_X, CFG_HALF_Z,
    CFG_CONV_SPEED, CFG_CONV_YAW,
    CFG_BOUNCE, CFG_SINK,
    CFG_POINTS = 32
};

#define MAX_POINTS 64
#define PATH_SUB 12
#define MAX_SAMPLES (MAX_POINTS * PATH_SUB + 4)

enum Phase { PH_NORMAL, PH_SHAKE, PH_FALLING, PH_GONE, PH_RETURN };

struct StudioMotion {
    struct Object *obj;
    u32 uid;
    s32 flags;
    f32 base[3];
    s16 baseAngle[3];

    // path
    s32 nPts;
    f32 pts[MAX_POINTS][3];
    s32 nSamples;
    f32 (*samples)[3];
    f32 *cum;
    f32 nodeDist[MAX_POINTS + 1];
    s32 nNodes;
    f32 total;
    f32 speed;
    s32 mode, wait, smooth, trigger, closed;
    f32 triggerR, phase0;
    f32 dist;
    s32 dir, waitT, started, triggered;

    // rotation, swing
    s16 rotVel[3];
    s32 rotAcc[3];
    s32 swingAxis;
    f32 swingAmp, swingPeriod, swingPivot, swingPhase;

    // fall / crumble / blink
    s32 fallDelay, fallRespawn, crumbleDelay, crumbleRespawn;
    s32 blinkOn, blinkOff, blinkPhase;
    s32 state, stateT;
    f32 fallVel, fallY;

    // seesaw, conveyor, trampoline, sinking
    f32 tiltMax, tiltSpeed, halfX, halfZ, tiltP, tiltR;
    f32 convSpeed;
    s16 convYaw;
    f32 bounce, sink, sinkY;

    s32 timer, hidden, lastFrame;
    f32 homeSnap[3]; // the object's home when the motion was set: the editor moves it there
};

static struct StudioMotion *sMotion[OBJECT_POOL_CAPACITY];

static struct StudioMotion *motion_of(struct Object *obj) {
    s32 slot = obj - gObjectPool;
    struct StudioMotion *m;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return NULL;
    }
    m = sMotion[slot];
    if (m == NULL || m->obj != obj || m->uid == 0 || obj->unused2 != m->uid
        || !(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) {
        return NULL;
    }
    return m;
}

// SM64's object rotation (mtxf_rotate_zxy): world = x*r0 + y*r1 + z*r2.
static void rot_apply(s16 pitch, s16 yaw, s16 roll, const f32 *l, f32 *out) {
    f32 sx = sins(pitch), cx = coss(pitch), sy = sins(yaw), cy = coss(yaw), sz = sins(roll), cz = coss(roll);
    f32 r0[3] = { cy * cz + sx * sy * sz, cx * sz, -sy * cz + sx * cy * sz };
    f32 r1[3] = { -cy * sz + sx * sy * cz, cx * cz, sy * sz + sx * cy * cz };
    f32 r2[3] = { cx * sy, -sx, cx * cy };
    s32 i;
    for (i = 0; i < 3; i++) {
        out[i] = l[0] * r0[i] + l[1] * r1[i] + l[2] * r2[i];
    }
}

static void catmull(const f32 *p0, const f32 *p1, const f32 *p2, const f32 *p3, f32 t, f32 *out) {
    f32 t2 = t * t, t3 = t2 * t;
    s32 i;
    for (i = 0; i < 3; i++) {
        out[i] = 0.5f * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
                         + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
    }
}

// Sample the path (straight or smoothed) and measure it.
static void build_path(struct StudioMotion *m) {
    s32 n = m->nPts, segs, s, k, idx = 0;
    if (n < 2) {
        m->nSamples = 0;
        m->total = 0;
        return;
    }
    if (m->samples == NULL) {
        m->samples = malloc(sizeof(f32) * 3 * MAX_SAMPLES);
        m->cum = malloc(sizeof(f32) * MAX_SAMPLES);
    }
    m->closed = m->mode == PATH_LOOP;
    segs = m->closed ? n : n - 1;
    m->nNodes = 0;
    for (s = 0; s < segs; s++) {
        const f32 *p1 = m->pts[s], *p2 = m->pts[(s + 1) % n];
        const f32 *p0 = s > 0 ? m->pts[s - 1] : (m->closed ? m->pts[n - 1] : p1);
        const f32 *p3 = (s + 2 < n) ? m->pts[s + 2] : (m->closed ? m->pts[(s + 2) % n] : p2);
        s32 sub = m->smooth ? PATH_SUB : 1;
        m->nodeDist[m->nNodes++] = idx; // sample index for now, distance below
        for (k = 0; k < sub && idx < MAX_SAMPLES - 1; k++) {
            f32 t = (f32) k / sub;
            if (m->smooth) {
                catmull(p0, p1, p2, p3, t, m->samples[idx]);
            } else {
                vec3f_copy(m->samples[idx], (f32 *) p1);
            }
            idx++;
        }
    }
    // the last point (or the first again, closing the loop)
    vec3f_copy(m->samples[idx], m->pts[m->closed ? 0 : n - 1]);
    m->nodeDist[m->nNodes++] = idx;
    idx++;
    m->nSamples = idx;
    m->cum[0] = 0;
    for (k = 1; k < idx; k++) {
        f32 dx = m->samples[k][0] - m->samples[k - 1][0];
        f32 dy = m->samples[k][1] - m->samples[k - 1][1];
        f32 dz = m->samples[k][2] - m->samples[k - 1][2];
        m->cum[k] = m->cum[k - 1] + sqrtf(dx * dx + dy * dy + dz * dz);
    }
    for (k = 0; k < m->nNodes; k++) {
        m->nodeDist[k] = m->cum[(s32) m->nodeDist[k]];
    }
    m->total = m->cum[idx - 1];
}

static void path_eval(struct StudioMotion *m, f32 d, f32 *out, f32 *tangentYaw) {
    s32 lo = 0, hi = m->nSamples - 1, mid;
    f32 t, seg;
    if (d <= 0) {
        lo = 0;
        hi = 1;
    } else if (d >= m->total) {
        lo = m->nSamples - 2;
        hi = m->nSamples - 1;
    } else {
        while (hi - lo > 1) {
            mid = (lo + hi) / 2;
            if (m->cum[mid] <= d) lo = mid; else hi = mid;
        }
    }
    seg = m->cum[hi] - m->cum[lo];
    t = seg > 0.001f ? (d - m->cum[lo]) / seg : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    out[0] = m->samples[lo][0] + (m->samples[hi][0] - m->samples[lo][0]) * t;
    out[1] = m->samples[lo][1] + (m->samples[hi][1] - m->samples[lo][1]) * t;
    out[2] = m->samples[lo][2] + (m->samples[hi][2] - m->samples[lo][2]) * t;
    if (tangentYaw != NULL && seg > 0.001f) {
        f32 dx = m->samples[hi][0] - m->samples[lo][0], dz = m->samples[hi][2] - m->samples[lo][2];
        if (dx * dx + dz * dz > 0.01f) {
            *tangentYaw = atan2s(dz, dx);
        }
    }
}

static s32 mario_on(struct Object *obj) {
    return gMarioObject != NULL && gMarioObject->platform == obj;
}

static f32 mario_dist(struct Object *obj) {
    f32 dx, dy, dz;
    if (gMarioObject == NULL) {
        return 1e9f;
    }
    dx = gMarioObject->oPosX - obj->oPosX;
    dy = gMarioObject->oPosY - obj->oPosY;
    dz = gMarioObject->oPosZ - obj->oPosZ;
    return sqrtf(dx * dx + dy * dy + dz * dz);
}

static void path_advance(struct StudioMotion *m, s32 onMe) {
    s32 moving = TRUE, k;
    f32 next;

    switch (m->trigger) {
        case TRIGGER_STAND:
            if (!m->started) {
                if (onMe) m->started = TRUE; else moving = FALSE;
            }
            break;
        case TRIGGER_WHILE_STANDING:
            m->dir = onMe ? 1 : -1;
            break;
        case TRIGGER_NEAR:
            if (!m->started) {
                if (mario_dist(m->obj) < m->triggerR) m->started = TRUE; else moving = FALSE;
            }
            break;
        case TRIGGER_EVENT:
            if (!m->triggered) moving = FALSE;
            break;
    }
    if (m->waitT > 0) {
        m->waitT--;
        moving = FALSE;
    }
    if (!moving || m->speed <= 0 || m->total <= 0) {
        return;
    }
    next = m->dist + m->dir * m->speed;
    // stop at the points on the way when waiting there
    if (m->wait > 0 && m->trigger != TRIGGER_WHILE_STANDING) {
        for (k = 0; k < m->nNodes; k++) {
            f32 nd = m->nodeDist[k];
            if (m->dir > 0 ? (nd > m->dist + 0.01f && nd <= next) : (nd < m->dist - 0.01f && nd >= next)) {
                next = nd;
                m->waitT = m->wait;
                break;
            }
        }
    }
    if (next >= m->total) {
        if (m->trigger == TRIGGER_WHILE_STANDING) {
            next = m->total;
        } else if (m->mode == PATH_LOOP) {
            next -= m->total;
            if (next < 0.01f && m->wait > 0) next = 0;
        } else if (m->mode == PATH_PINGPONG) {
            next = m->total - (next - m->total);
            if (m->waitT > 0) next = m->total;
            m->dir = -1;
        } else {
            next = m->total;
            m->speed = 0; // once: stays at the end
        }
    } else if (next <= 0) {
        if (m->trigger == TRIGGER_WHILE_STANDING) {
            next = 0;
        } else if (m->mode == PATH_PINGPONG) {
            next = -next;
            if (m->waitT > 0) next = 0;
            m->dir = 1;
        } else if (m->mode == PATH_LOOP) {
            next += m->total;
        }
    }
    m->dist = next;
}

static void set_hidden(struct Object *obj, struct StudioMotion *m, s32 hidden) {
    m->hidden = hidden;
    if (hidden) {
        obj->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
    } else {
        obj->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    }
}

static void spawn_break_effect(struct Object *obj) {
    struct Object *saved = gCurrentObject;
    gCurrentObject = obj;
    spawn_mist_particles_variable(0, 0, 46.0f);
    spawn_triangle_break_particles(12, 138, 2.0f, 4);
    cur_obj_play_sound_2(SOUND_GENERAL_BREAK_BOX);
    gCurrentObject = saved;
}

// The editor (or Claude) moved the object: its path goes along.
static void motion_follow_home(struct StudioMotion *m) {
    struct Object *obj = m->obj;
    f32 d[3];
    s32 i;
    if (fabsf(obj->oHomeX - m->homeSnap[0]) < 0.5f && fabsf(obj->oHomeY - m->homeSnap[1]) < 0.5f
        && fabsf(obj->oHomeZ - m->homeSnap[2]) < 0.5f) {
        return;
    }
    d[0] = obj->oHomeX - m->base[0];
    d[1] = obj->oHomeY - m->base[1];
    d[2] = obj->oHomeZ - m->base[2];
    m->homeSnap[0] = obj->oHomeX;
    m->homeSnap[1] = obj->oHomeY;
    m->homeSnap[2] = obj->oHomeZ;
    for (i = 0; i < 3; i++) m->base[i] += d[i];
    for (i = 0; i < m->nPts; i++) {
        m->pts[i][0] += d[0];
        m->pts[i][1] += d[1];
        m->pts[i][2] += d[2];
    }
    build_path(m);
}

static void motion_reset_runtime(struct StudioMotion *m) {
    m->dist = m->total * m->phase0;
    m->dir = 1;
    m->waitT = 0;
    m->started = FALSE;
    m->triggered = FALSE;
    m->rotAcc[0] = m->rotAcc[1] = m->rotAcc[2] = 0;
    m->state = PH_NORMAL;
    m->stateT = 0;
    m->fallVel = m->fallY = 0;
    m->tiltP = m->tiltR = 0;
    m->sinkY = 0;
    m->timer = 0;
    m->lastFrame = -1;
}

// One frame of motion: computes the pose and writes it, with the movement in oVel/oAngleVel.
static void motion_step(struct StudioMotion *m) {
    struct Object *obj = m->obj;
    f32 pos[3], prev[3];
    s16 ang[3], prevAng[3];
    s32 onMe = mario_on(obj), i, solid = TRUE;
    f32 yawTangent;

    if (m->lastFrame == (s32) gGlobalTimer) {
        return;
    }
    m->lastFrame = gGlobalTimer;
    motion_follow_home(m);
    m->timer++;
    vec3f_copy(pos, m->base);
    ang[0] = m->baseAngle[0];
    ang[1] = m->baseAngle[1];
    ang[2] = m->baseAngle[2];

    if ((m->flags & MOTION_PATH) && !(m->flags & MOTION_EXTERNAL) && m->nSamples > 1) {
        if (m->state == PH_NORMAL || m->state == PH_SHAKE) {
            path_advance(m, onMe);
        }
        yawTangent = ang[1];
        path_eval(m, m->dist, pos, &yawTangent);
        if (m->flags & MOTION_FACE_PATH) {
            ang[1] = m->dir < 0 ? yawTangent + 0x8000 : yawTangent;
        }
    }
    if (m->flags & MOTION_ROTATE) {
        for (i = 0; i < 3; i++) {
            m->rotAcc[i] = (m->rotAcc[i] + m->rotVel[i]) & 0xFFFF;
            ang[i] += (s16) m->rotAcc[i];
        }
    }
    if ((m->flags & MOTION_SWING) && m->swingPeriod > 1) {
        f32 a = m->swingAmp * sinf(2 * M_PI * (m->timer / m->swingPeriod + m->swingPhase));
        s16 da = (s16) a;
        if (m->swingAxis == 0) ang[0] += da;
        else if (m->swingAxis == 1) ang[2] += da;
        else ang[1] += da;
        if (m->swingPivot > 1 && m->swingAxis != 2) {
            // a pendulum hanging from a point above: the platform moves on the arc
            f32 hang[3] = { 0, -m->swingPivot, 0 }, off[3];
            s16 p = m->swingAxis == 0 ? da : 0, r = m->swingAxis == 1 ? da : 0;
            rot_apply(p, m->baseAngle[1], r, hang, off);
            pos[0] += off[0];
            pos[1] += m->swingPivot + off[1];
            pos[2] += off[2];
        }
    }
    if (m->flags & MOTION_TILT) {
        f32 tp = 0, tr = 0;
        if (onMe && gMarioObject != NULL) {
            f32 dx = gMarioObject->oPosX - obj->oPosX, dz = gMarioObject->oPosZ - obj->oPosZ;
            s16 yaw = obj->oFaceAngleYaw;
            f32 lx = dx * coss(yaw) - dz * sins(yaw);
            f32 lz = dx * sins(yaw) + dz * coss(yaw);
            f32 fx = m->halfX > 1 ? lx / m->halfX : 0, fz = m->halfZ > 1 ? lz / m->halfZ : 0;
            if (fx > 1) fx = 1; if (fx < -1) fx = -1;
            if (fz > 1) fz = 1; if (fz < -1) fz = -1;
            // the side Mario stands on goes down
            tp = fz * m->tiltMax;
            tr = -fx * m->tiltMax;
        }
        m->tiltP = approach_f32(m->tiltP, tp, m->tiltSpeed, m->tiltSpeed);
        m->tiltR = approach_f32(m->tiltR, tr, m->tiltSpeed, m->tiltSpeed);
        ang[0] += (s16) m->tiltP;
        ang[2] += (s16) m->tiltR;
    }
    if (m->flags & MOTION_SINK) {
        m->sinkY = approach_f32(m->sinkY, onMe ? -m->sink : 0, onMe ? 2.0f : 4.0f, onMe ? 2.0f : 4.0f);
        pos[1] += m->sinkY;
    }

    // falling and crumbling platforms
    if (m->flags & (MOTION_FALL | MOTION_CRUMBLE)) {
        switch (m->state) {
            case PH_NORMAL:
                if (onMe) {
                    m->state = PH_SHAKE;
                    m->stateT = (m->flags & MOTION_CRUMBLE) ? m->crumbleDelay : m->fallDelay;
                }
                break;
            case PH_SHAKE:
                if (m->stateT-- <= 0) {
                    if (m->flags & MOTION_CRUMBLE) {
                        spawn_break_effect(obj);
                        m->state = PH_GONE;
                        m->stateT = m->crumbleRespawn;
                    } else {
                        m->state = PH_FALLING;
                        m->stateT = 0;
                        m->fallVel = 0;
                    }
                } else {
                    pos[0] += (random_float() - 0.5f) * 6;
                    pos[2] += (random_float() - 0.5f) * 6;
                }
                break;
            case PH_FALLING:
                m->fallVel -= 2.0f;
                if (m->fallVel < -50) m->fallVel = -50;
                m->fallY += m->fallVel;
                if (++m->stateT > 150) {
                    m->state = PH_GONE;
                    m->stateT = m->fallRespawn;
                }
                break;
            case PH_GONE: {
                s32 respawn = (m->flags & MOTION_CRUMBLE) ? m->crumbleRespawn : m->fallRespawn;
                if (respawn > 0 && m->stateT-- <= 0) {
                    m->state = PH_RETURN;
                    m->stateT = 40;
                    m->fallY = 0;
                    m->fallVel = 0;
                }
                break;
            }
            case PH_RETURN:
                if (m->stateT-- <= 0) {
                    m->state = PH_NORMAL;
                }
                break;
        }
        pos[1] += m->fallY;
    }

    // visibility: gone, coming back (flickering), blinking
    if (m->state == PH_GONE) {
        solid = FALSE;
        set_hidden(obj, m, TRUE);
    } else if (m->state == PH_RETURN) {
        set_hidden(obj, m, (m->stateT & 2) != 0);
        solid = m->stateT < 10;
    } else if ((m->flags & MOTION_BLINK) && m->blinkOn + m->blinkOff > 0) {
        s32 cycle = m->blinkOn + m->blinkOff;
        s32 t = (m->timer + m->blinkPhase) % cycle;
        if (t < m->blinkOn) {
            // flickers before it goes
            set_hidden(obj, m, t > m->blinkOn - 24 && (t & 2));
        } else {
            set_hidden(obj, m, TRUE);
            solid = FALSE;
        }
    } else if (m->hidden) {
        set_hidden(obj, m, FALSE);
    }
    if (!solid) {
        m->hidden = TRUE;
    }

    // write the pose and the movement this frame
    prev[0] = obj->oPosX;
    prev[1] = obj->oPosY;
    prev[2] = obj->oPosZ;
    prevAng[0] = obj->oFaceAnglePitch;
    prevAng[1] = obj->oFaceAngleYaw;
    prevAng[2] = obj->oFaceAngleRoll;
    if (m->timer <= 1) {
        // the first frame must not fling Mario from where the object was spawned
        vec3f_copy(prev, pos);
        prevAng[0] = ang[0];
        prevAng[1] = ang[1];
        prevAng[2] = ang[2];
    }
    obj->oPosX = pos[0];
    obj->oPosY = pos[1];
    obj->oPosZ = pos[2];
    obj->oVelX = pos[0] - prev[0];
    obj->oVelY = pos[1] - prev[1];
    obj->oVelZ = pos[2] - prev[2];
    obj->oFaceAnglePitch = obj->oMoveAnglePitch = ang[0];
    obj->oFaceAngleYaw = obj->oMoveAngleYaw = ang[1];
    obj->oFaceAngleRoll = obj->oMoveAngleRoll = ang[2];
    obj->oAngleVelPitch = (s16) (ang[0] - prevAng[0]);
    obj->oAngleVelYaw = (s16) (ang[1] - prevAng[1]);
    obj->oAngleVelRoll = (s16) (ang[2] - prevAng[2]);
    if (m->flags & MOTION_CONVEYOR) {
        // a conveyor doesn't move: it reports movement, so Mario gets carried
        s16 yaw = m->baseAngle[1] + m->convYaw;
        obj->oVelX += m->convSpeed * sins(yaw);
        obj->oVelZ += m->convSpeed * coss(yaw);
    }
    vec3f_set(obj->header.gfx.pos, pos[0], pos[1], pos[2]);
    vec3s_set(obj->header.gfx.angle, ang[0], ang[1], ang[2]);

    // trampoline: Mario standing on it is thrown up
    if ((m->flags & MOTION_BOUNCE) && onMe && solid && gMarioState != NULL
        && !(gMarioState->action & ACT_FLAG_AIR) && gMarioState->action != ACT_GROUND_POUND_LAND) {
        struct MarioState *ms = gMarioState;
        set_mario_action(ms, ACT_DOUBLE_JUMP, 0);
        ms->vel[1] = m->bounce;
        ms->flags &= ~MARIO_UNKNOWN_08; // the full bounce, whether A is held or not
        ms->peakHeight = ms->pos[1];
        play_sound(SOUND_GENERAL_BOING1, obj->header.gfx.cameraToObject);
    } else if ((m->flags & MOTION_BOUNCE) && onMe && solid && gMarioState != NULL
               && gMarioState->action == ACT_GROUND_POUND_LAND) {
        // a ground pound bounces higher
        struct MarioState *ms = gMarioState;
        set_mario_action(ms, ACT_TRIPLE_JUMP, 0);
        ms->vel[1] = m->bounce * 1.4f;
        ms->flags &= ~MARIO_UNKNOWN_08;
        ms->peakHeight = ms->pos[1];
        play_sound(SOUND_GENERAL_BOING2, obj->header.gfx.cameraToObject);
    }
}

// ---- engine hooks ---------------------------------------------------------------

s32 studio_motion_is_trampoline(struct Object *obj) {
    struct StudioMotion *m = obj != NULL ? motion_of(obj) : NULL;
    return m != NULL && (m->flags & MOTION_BOUNCE) && !m->hidden;
}

s32 studio_motion_update(struct Object *obj) {
    struct StudioMotion *m = motion_of(obj);
    if (m == NULL) {
        return TRUE;
    }
    motion_step(m);
    return !m->hidden;
}

void studio_motion_after_behavior(struct Object *obj) {
    struct StudioMotion *m;
    if (obj->behavior == bhvStudioBlock || obj->behavior == bhvStudioMover || obj->behavior == bhvStudioActor) {
        return;
    }
    m = motion_of(obj);
    if (m == NULL) {
        return;
    }
    motion_step(m);
    if (m->hidden) {
        obj->oIntangibleTimer = -1;
    } else if (obj->oIntangibleTimer == -1) {
        obj->oIntangibleTimer = 0;
    }
}

// Build mode: every moving thing sits at its home pose, its motion starts over.
void studio_motion_paused(void) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct StudioMotion *m = sMotion[i];
        struct Object *obj = &gObjectPool[i];
        if (m == NULL || motion_of(obj) != m) {
            continue;
        }
        if (m->timer == 0) {
            // moved or turned in the editor: the motion starts from there
            motion_follow_home(m);
            m->baseAngle[0] = obj->oFaceAnglePitch;
            m->baseAngle[1] = obj->oFaceAngleYaw;
            m->baseAngle[2] = obj->oFaceAngleRoll;
            continue;
        }
        motion_reset_runtime(m);
        obj->oPosX = m->base[0];
        obj->oPosY = m->base[1];
        obj->oPosZ = m->base[2];
        obj->oFaceAnglePitch = m->baseAngle[0];
        obj->oFaceAngleYaw = m->baseAngle[1];
        obj->oFaceAngleRoll = m->baseAngle[2];
        obj->oVelX = obj->oVelY = obj->oVelZ = 0;
        obj->oAngleVelPitch = obj->oAngleVelYaw = obj->oAngleVelRoll = 0;
        vec3f_set(obj->header.gfx.pos, m->base[0], m->base[1], m->base[2]);
        vec3s_set(obj->header.gfx.angle, m->baseAngle[0], m->baseAngle[1], m->baseAngle[2]);
        set_hidden(obj, m, FALSE);
    }
}

s32 studio_motion_path(struct Object *obj, const f32 (**pts)[3], s32 *mode, s32 *wait) {
    struct StudioMotion *m = motion_of(obj);
    if (m == NULL || !(m->flags & MOTION_PATH) || m->nPts < 2) {
        return 0;
    }
    *pts = (const f32 (*)[3]) m->pts;
    *mode = m->mode;
    *wait = m->wait;
    return m->nPts;
}

// ---- the page's API -------------------------------------------------------------

// cfg: see the CFG_* layout. Path points are offsets from the object's position.
EMSCRIPTEN_KEEPALIVE
s32 studio_motion_set(s32 slot, const f32 *cfg, s32 count) {
    struct Object *obj;
    struct StudioMotion *m;
    s32 i, n;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || cfg == NULL || count < CFG_POINTS) {
        return 0;
    }
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE) || obj->unused2 == 0) {
        return 0;
    }
    m = sMotion[slot];
    if (m == NULL) {
        m = sMotion[slot] = calloc(1, sizeof(struct StudioMotion));
    }
    m->obj = obj;
    m->uid = obj->unused2;
    m->flags = (s32) cfg[CFG_FLAGS];
    m->base[0] = obj->oPosX;
    m->base[1] = obj->oPosY;
    m->base[2] = obj->oPosZ;
    m->baseAngle[0] = obj->oFaceAnglePitch;
    m->baseAngle[1] = obj->oFaceAngleYaw;
    m->baseAngle[2] = obj->oFaceAngleRoll;
    m->homeSnap[0] = obj->oHomeX;
    m->homeSnap[1] = obj->oHomeY;
    m->homeSnap[2] = obj->oHomeZ;

    n = (s32) cfg[CFG_NPTS];
    if (n > MAX_POINTS) n = MAX_POINTS;
    if (n > (count - CFG_POINTS) / 3) n = (count - CFG_POINTS) / 3;
    if (n < 0) n = 0;
    m->nPts = n;
    for (i = 0; i < n; i++) {
        m->pts[i][0] = m->base[0] + cfg[CFG_POINTS + i * 3];
        m->pts[i][1] = m->base[1] + cfg[CFG_POINTS + i * 3 + 1];
        m->pts[i][2] = m->base[2] + cfg[CFG_POINTS + i * 3 + 2];
    }
    m->speed = cfg[CFG_SPEED];
    m->mode = (s32) cfg[CFG_MODE];
    m->wait = (s32) cfg[CFG_WAIT];
    m->smooth = cfg[CFG_SMOOTH] != 0;
    m->trigger = (s32) cfg[CFG_TRIGGER];
    m->triggerR = cfg[CFG_TRIGGER_R] > 0 ? cfg[CFG_TRIGGER_R] : 800;
    m->phase0 = cfg[CFG_PHASE];
    if (m->phase0 < 0 || m->phase0 >= 1) m->phase0 = 0;
    // angular speeds come in degrees per second (30 frames)
    m->rotVel[0] = (s16) (cfg[CFG_ROT_PITCH] * 65536.0f / 360.0f / 30.0f);
    m->rotVel[1] = (s16) (cfg[CFG_ROT_YAW] * 65536.0f / 360.0f / 30.0f);
    m->rotVel[2] = (s16) (cfg[CFG_ROT_ROLL] * 65536.0f / 360.0f / 30.0f);
    m->swingAxis = (s32) cfg[CFG_SWING_AXIS];
    m->swingAmp = cfg[CFG_SWING_AMP] * 65536.0f / 360.0f;
    m->swingPeriod = cfg[CFG_SWING_PERIOD] * 30.0f;
    m->swingPivot = cfg[CFG_SWING_PIVOT];
    m->swingPhase = cfg[CFG_SWING_PHASE];
    m->fallDelay = (s32) cfg[CFG_FALL_DELAY];
    m->fallRespawn = (s32) cfg[CFG_FALL_RESPAWN];
    m->blinkOn = (s32) cfg[CFG_BLINK_ON];
    m->blinkOff = (s32) cfg[CFG_BLINK_OFF];
    m->blinkPhase = (s32) cfg[CFG_BLINK_PHASE];
    m->crumbleDelay = (s32) cfg[CFG_CRUMBLE_DELAY];
    m->crumbleRespawn = (s32) cfg[CFG_CRUMBLE_RESPAWN];
    m->tiltMax = cfg[CFG_TILT_MAX] * 65536.0f / 360.0f;
    m->tiltSpeed = cfg[CFG_TILT_SPEED] * 65536.0f / 360.0f;
    if (m->tiltSpeed <= 0) m->tiltSpeed = 100;
    m->halfX = cfg[CFG_HALF_X];
    m->halfZ = cfg[CFG_HALF_Z];
    m->convSpeed = cfg[CFG_CONV_SPEED];
    m->convYaw = (s16) (cfg[CFG_CONV_YAW] * 65536.0f / 360.0f);
    m->bounce = cfg[CFG_BOUNCE];
    m->sink = cfg[CFG_SINK];
    build_path(m);
    motion_reset_runtime(m);
    m->hidden = FALSE;
    obj->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void studio_motion_clear(s32 slot) {
    if (slot >= 0 && slot < OBJECT_POOL_CAPACITY && sMotion[slot] != NULL) {
        sMotion[slot]->uid = 0;
        sMotion[slot]->obj = NULL;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_motion_reset_all(void) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        if (sMotion[i] != NULL) {
            sMotion[i]->uid = 0;
            sMotion[i]->obj = NULL;
        }
    }
}

// Events start motions that wait for them ("event" trigger). Returns how many started.
EMSCRIPTEN_KEEPALIVE
s32 studio_motion_trigger(s32 uid) {
    s32 i, n = 0;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct StudioMotion *m = sMotion[i];
        if (m != NULL && m->uid == (u32) uid && motion_of(&gObjectPool[i]) == m) {
            m->triggered = TRUE;
            m->started = TRUE;
            n++;
        }
    }
    return n;
}

// For tests and the page: where a motion is (distance along the path, state).
static char sMotionJson[256];
EMSCRIPTEN_KEEPALIVE
const char *studio_motion_state_json(s32 slot) {
    struct StudioMotion *m;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || (m = motion_of(&gObjectPool[slot])) == NULL) {
        return "null";
    }
    snprintf(sMotionJson, sizeof(sMotionJson),
             "{\"dist\":%.1f,\"total\":%.1f,\"dir\":%d,\"state\":%d,\"hidden\":%d,\"timer\":%d,\"flags\":%d,\"onMe\":%d,\"y\":%.1f}",
             m->dist, m->total, m->dir, m->state, m->hidden, m->timer, m->flags, mario_on(m->obj), m->obj->oPosY);
    return sMotionJson;
}

// ---- paths of the game's own path objects -----------------------------------------

#define MAX_OVERRIDES 32

struct PathOverride {
    const BehaviorScript *bhv;
    f32 x, y, z, r;
    u32 uid;
    struct Waypoint *wp;
    s32 n;
};
static struct PathOverride sOverrides[MAX_OVERRIDES];
static s32 sOverrideCount;
// The last set of overrides, kept while the page sends the new set: an identical path keeps
// its waypoints (objects on it go on undisturbed); the rest are freed in _done.
static struct PathOverride sStale[MAX_OVERRIDES];
static s32 sStaleCount;
// per object slot: the path it had before an override (to go back), and for track
// platforms where their original track starts (what an override is matched by: the
// platform moves its home to the start of whatever track it rides)
static const struct Waypoint *sPathOrig[OBJECT_POOL_CAPACITY];
static const struct Waypoint *sTrackOrig[OBJECT_POOL_CAPACITY];

static s32 in_list(const struct PathOverride *list, s32 n, const void *p) {
    s32 i;
    for (i = 0; i < n; i++) {
        if (list[i].wp != NULL && (const struct Waypoint *) p >= list[i].wp && (const struct Waypoint *) p <= list[i].wp + list[i].n) {
            return TRUE;
        }
    }
    return FALSE;
}

// The track platform starts over on its track (the game's own reset, at once).
static void track_restart(struct Object *obj) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *b = &gObjectPool[i];
        if ((b->activeFlags & ACTIVE_FLAG_ACTIVE) && b->behavior == bhvTrackBall && b->parentObj == obj) {
            obj_mark_for_deletion(b);
        }
    }
    obj->oAction = PLATFORM_ON_TRACK_ACT_INIT;
    obj->oTimer = 0;
    obj->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
}

// Objects still on waypoints of `list` go back to their own paths.
static void release_paths(const struct PathOverride *list, s32 n) {
    s32 i;
    if (n == 0) {
        return;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) continue;
        if (obj->behavior == bhvPlatformOnTrack) {
            if (in_list(list, n, obj->oPlatformOnTrackStartWaypoint) || in_list(list, n, obj->oPlatformOnTrackPrevWaypoint)) {
                obj->oPlatformOnTrackStartWaypoint = (struct Waypoint *) sTrackOrig[i];
                obj->oPlatformOnTrackPrevWaypoint = obj->oPlatformOnTrackStartWaypoint;
                track_restart(obj);
            }
        } else if (in_list(list, n, obj->oPathedStartWaypoint) || in_list(list, n, obj->oPathedPrevWaypoint)) {
            obj->oPathedStartWaypoint = (struct Waypoint *) sPathOrig[i];
            obj->oPathedPrevWaypoint = obj->oPathedStartWaypoint;
            obj->oPathedPrevWaypointFlags = WAYPOINT_FLAGS_INITIALIZED;
        }
    }
}

static void free_stale(void) {
    s32 i;
    release_paths(sStale, sStaleCount);
    for (i = 0; i < sStaleCount; i++) {
        free(sStale[i].wp);
    }
    sStaleCount = 0;
}

// The page sends the area's overrides: clear, add each, done.
EMSCRIPTEN_KEEPALIVE
void studio_path_override_clear(void) {
    free_stale();
    memcpy(sStale, sOverrides, sizeof(sOverrides[0]) * sOverrideCount);
    sStaleCount = sOverrideCount;
    sOverrideCount = 0;
}

EMSCRIPTEN_KEEPALIVE
void studio_path_override_done(void) {
    free_stale();
}

static struct PathOverride *override_of(struct Object *obj);

// pts: n absolute points. The object is found by uid, or by behavior near its home.
EMSCRIPTEN_KEEPALIVE
s32 studio_path_override_add(s32 bhvIndex, f32 x, f32 y, f32 z, f32 r, s32 uid, const f32 *pts, s32 n) {
    struct PathOverride *ov;
    s32 i;
    if (sOverrideCount >= MAX_OVERRIDES || n < 2 || pts == NULL || bhvIndex < 0 || bhvIndex >= gStudioBehaviorCount) {
        return 0;
    }
    ov = &sOverrides[sOverrideCount++];
    ov->bhv = gStudioBehaviors[bhvIndex].script;
    ov->x = x;
    ov->y = y;
    ov->z = z;
    ov->r = r > 0 ? r : 200;
    ov->uid = (u32) uid;
    ov->n = n;
    ov->wp = calloc(n + 1, sizeof(struct Waypoint));
    for (i = 0; i < n; i++) {
        ov->wp[i].flags = i;
        ov->wp[i].pos[0] = (s16) pts[i * 3];
        ov->wp[i].pos[1] = (s16) pts[i * 3 + 1];
        ov->wp[i].pos[2] = (s16) pts[i * 3 + 2];
    }
    ov->wp[n].flags = WAYPOINT_FLAGS_END;
    // the same path as before: keep its waypoints, so what follows it is not disturbed
    for (i = 0; i < sStaleCount; i++) {
        struct PathOverride *st = &sStale[i];
        if (st->wp != NULL && st->bhv == ov->bhv && st->uid == ov->uid && st->n == n && st->x == x && st->y == y && st->z == z
            && memcmp(st->wp, ov->wp, (n + 1) * sizeof(struct Waypoint)) == 0) {
            free(ov->wp);
            ov->wp = st->wp;
            sStale[i] = sStale[--sStaleCount];
            break;
        }
    }
    // track platforms already riding switch to the new track at once
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if ((obj->activeFlags & ACTIVE_FLAG_ACTIVE) && obj->behavior == bhvPlatformOnTrack
            && sTrackOrig[i] != NULL && obj->oPlatformOnTrackStartWaypoint != ov->wp && override_of(obj) == ov) {
            obj->oPlatformOnTrackStartWaypoint = ov->wp;
            obj->oPlatformOnTrackPrevWaypoint = ov->wp;
            track_restart(obj);
        }
    }
    return 1;
}

// Where an object is matched from: its home, for track platforms where their own track starts.
void studio_path_home(struct Object *obj, f32 *h) {
    s32 slot = obj - gObjectPool;
    h[0] = obj->oHomeX;
    h[1] = obj->oHomeY;
    h[2] = obj->oHomeZ;
    if (slot >= 0 && slot < OBJECT_POOL_CAPACITY && obj->behavior == bhvPlatformOnTrack && sTrackOrig[slot] != NULL) {
        h[0] = sTrackOrig[slot]->pos[0];
        h[1] = sTrackOrig[slot]->pos[1];
        h[2] = sTrackOrig[slot]->pos[2];
    }
}

static struct PathOverride *override_of(struct Object *obj) {
    s32 i;
    f32 h[3];
    studio_path_home(obj, h);
    for (i = 0; i < sOverrideCount; i++) {
        struct PathOverride *ov = &sOverrides[i];
        if (ov->uid != 0) {
            if (obj->unused2 == ov->uid) return ov;
            continue;
        }
        if (obj->behavior == ov->bhv) {
            f32 dx = h[0] - ov->x, dy = h[1] - ov->y, dz = h[2] - ov->z;
            if (dx * dx + dy * dy + dz * dz < ov->r * ov->r) return ov;
        }
    }
    return NULL;
}

void studio_path_override_apply(struct Object *obj) {
    struct PathOverride *ov;
    s32 slot = obj - gObjectPool;
    if (sOverrideCount == 0 || (ov = override_of(obj)) == NULL) {
        return;
    }
    if (obj->oPathedStartWaypoint != ov->wp) {
        if (slot >= 0 && slot < OBJECT_POOL_CAPACITY && !in_list(sOverrides, sOverrideCount, obj->oPathedStartWaypoint)
            && !in_list(sStale, sStaleCount, obj->oPathedStartWaypoint)) {
            sPathOrig[slot] = obj->oPathedStartWaypoint; // its own path, to go back to
        }
        obj->oPathedStartWaypoint = ov->wp;
        obj->oPathedPrevWaypoint = ov->wp;
        obj->oPathedPrevWaypointFlags = WAYPOINT_FLAGS_INITIALIZED;
    }
    if (obj->oPathedPrevWaypoint < ov->wp || obj->oPathedPrevWaypoint >= ov->wp + ov->n) {
        obj->oPathedPrevWaypoint = ov->wp;
    }
}

// bhv_platform_on_track_init: the platform's own track is set; a drawn one replaces it.
// A track platform placed in the studio far from its own track (one from another level) takes its
// track along, moved so it starts where it was placed (it would fly off to the other level's spot).
#define MOVED_TRACKS 8
#define MOVED_TRACK_LEN 64
static struct Waypoint sMovedTrack[MOVED_TRACKS][MOVED_TRACK_LEN];
static s32 sMovedTrackNext;

static s16 track_coord(f32 v) {
    return (s16) (v < -32000.0f ? -32000.0f : v > 32000.0f ? 32000.0f : v);
}

static void move_track_here(struct Object *obj) {
    const struct Waypoint *wp = obj->oPlatformOnTrackStartWaypoint;
    struct Waypoint *out;
    f32 dx, dy, dz;
    s32 n = 0, i;
    if (wp == NULL || obj->unused2 == 0) {
        return;
    }
    dx = obj->oPosX - wp[0].pos[0];
    dy = obj->oPosY - wp[0].pos[1];
    dz = obj->oPosZ - wp[0].pos[2];
    if (dx * dx + dy * dy + dz * dz < 1500.0f * 1500.0f) {
        return; // in its own level: its own track
    }
    while (n < MOVED_TRACK_LEN - 1 && wp[n].flags != WAYPOINT_FLAGS_END) {
        n++;
    }
    out = sMovedTrack[sMovedTrackNext];
    sMovedTrackNext = (sMovedTrackNext + 1) % MOVED_TRACKS;
    for (i = 0; i < n; i++) {
        out[i].flags = wp[i].flags;
        out[i].pos[0] = track_coord(wp[i].pos[0] + dx);
        out[i].pos[1] = track_coord(wp[i].pos[1] + dy);
        out[i].pos[2] = track_coord(wp[i].pos[2] + dz);
    }
    out[n].flags = WAYPOINT_FLAGS_END;
    out[n].pos[0] = out[n].pos[1] = out[n].pos[2] = 0;
    obj->oPlatformOnTrackStartWaypoint = out;
}

void studio_track_override_apply(struct Object *obj) {
    struct PathOverride *ov;
    s32 slot = obj - gObjectPool;
    if (slot >= 0 && slot < OBJECT_POOL_CAPACITY) {
        sTrackOrig[slot] = obj->oPlatformOnTrackStartWaypoint;
    }
    if (sOverrideCount == 0 || (ov = override_of(obj)) == NULL) {
        move_track_here(obj);
        return;
    }
    obj->oPlatformOnTrackStartWaypoint = ov->wp;
}

extern const Trajectory bob_seg7_trajectory_koopa[];
extern const Trajectory thi_seg7_trajectory_koopa[];
extern const Trajectory ccm_seg7_trajectory_penguin_race[];

static char sPathJson[16384];

// The path an original object follows (to edit it): {"kind", "points": [[x,y,z]...]} or null.
EMSCRIPTEN_KEEPALIVE
const char *studio_path_info_json(s32 slot) {
    struct Object *obj;
    const struct Waypoint *wp = NULL;
    const char *kind = "path";
    struct PathOverride *ov;
    s32 len = 0, i;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return "null";
    }
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) {
        return "null";
    }
    ov = override_of(obj);
    if (ov != NULL) {
        wp = ov->wp;
        kind = "custom";
    } else if (obj->behavior == bhvKoopa && obj->oBehParams2ndByte == KOOPA_BP_KOOPA_THE_QUICK_BOB) {
        wp = (const struct Waypoint *) segmented_to_virtual(bob_seg7_trajectory_koopa);
        kind = "race";
    } else if (obj->behavior == bhvKoopa && obj->oBehParams2ndByte == KOOPA_BP_KOOPA_THE_QUICK_THI) {
        wp = (const struct Waypoint *) segmented_to_virtual(thi_seg7_trajectory_koopa);
        kind = "race";
    } else if (obj->behavior == bhvRacingPenguin) {
        wp = (const struct Waypoint *) segmented_to_virtual(ccm_seg7_trajectory_penguin_race);
        kind = "race";
    } else if (obj->behavior == bhvPlatformOnTrack) {
        wp = obj->oPlatformOnTrackStartWaypoint;
        kind = "track";
    } else if (obj->behavior == bhvMantaRay || obj->behavior == bhvSnowmansBottom || obj->behavior == bhvUnagi) {
        wp = obj->oPathedStartWaypoint;
    }
    if (wp == NULL) {
        return "null";
    }
    len = snprintf(sPathJson, sizeof(sPathJson), "{\"kind\":\"%s\",\"points\":[", kind);
    for (i = 0; i < 200 && wp[i].flags != WAYPOINT_FLAGS_END && len < (s32) sizeof(sPathJson) - 64; i++) {
        len += snprintf(sPathJson + len, sizeof(sPathJson) - len, "%s[%d,%d,%d]", i ? "," : "", wp[i].pos[0],
                        wp[i].pos[1], wp[i].pos[2]);
    }
    snprintf(sPathJson + len, sizeof(sPathJson) - len, "]}");
    return sPathJson;
}

// Build mode: things the scene panel hides (or shows again).
EMSCRIPTEN_KEEPALIVE
void studio_set_visible(s32 slot, s32 visible) {
    struct Object *obj;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) return;
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) return;
    if (visible) obj->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    else obj->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
}
