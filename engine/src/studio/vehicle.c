// Studio 64 vehicles: the driving core and the car objects (see vehicle.h).
//
// A port of the Shoggoth World hack's car (sm64-master, branch shoggoth:
// src/game/shoggoth/overlay/car_core.inc.c, the driving shared by New York's sportscar and the
// Shuto race, and newyork_car.c, getting in and out). There it is overlay code with compile-time
// tuning per level; here it is resident, with the tuning per car (the studio's inspector).
//
// The controls (ACT_STUDIO_DRIVE):
//   A / stick up    throttle          B / stick down   brake, then reverse     stick   steer
//   R               handbrake: a drift with tyre smoke (and, with the drift boost, a charge)
//   Z               get out (brakes to a stop first)           C-up horn, C-down look back,
//   C-left/right    swing the camera round
//
// The handling is arcade: momentum with a throttle that tapers towards the top speed, strong grip
// that lets go under the handbrake, steering whose rate peaks at mid speed and softens at the top,
// bumps and airtime off ramps, stairs and kerbs (the body sits on the floor under its four
// wheels, pitching and rolling with it), gravity, solid walls (the car slides along them; hard
// hits cost speed, throw sparks and shake the camera), enemies run over (Mario's hitbox grows
// round the car: riding-shell rules make any touch an attack), Bob-ombs set off. Engine sound
// pitched by the revs (the moving bank), tyre squeal and smoke, a chase camera; the speedometer
// is drawn by the page (studio_vehicle_hud).
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
#include "game/mario_step.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/spawn_object.h"
#include "studio.h"
#include "vehicle.h"

#define o gCurrentObject

#ifndef CLAMP
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))
#endif

extern struct CameraFOVStatus sFOVState;
extern s32 gStudioPaused;
struct Object *studio_spawn_raw(const BehaviorScript *bhv, struct GraphNode *model, f32 x, f32 y, f32 z,
                                s16 pitch, s16 yaw, s16 roll, u32 bparams);

/* ------------------------------------------------------------------------------------ tuning */
// New York's defaults (car_core.inc.c); per car: top speed, acceleration, handling
#define CAR_ACCEL         3.3f      // throttle at a standstill (tapers off towards the top speed)
#define CAR_BRAKE         4.2f
#define CAR_REVERSE_TOP   34.0f
#define CAR_REVERSE_ACCEL 1.5f
#define CAR_ROLL_DRAG     0.35f     // coasting
#define CAR_GRIP          0.20f     // share of the sideways slip kept each frame (lower: grippier)
#define CAR_DRIFT_GRIP    0.92f     // under the handbrake
#define CAR_STEER_RATE    0x3A0     // yaw per frame at full lock, mid speed
#define CAR_STEER_TOP_LOSS 0.42f    // ... less this share at the top speed
#define CAR_DRIFT_STEER   1.55f     // ... times this while drifting
#define CAR_DRIFT_TOP     0.9f      // the top speed's share in a drift
#define CAR_DRIFT_DRAG    0.988f    // speed kept each frame of a drift
#define CAR_GRAVITY       4.4f
#define CAR_MAX_FALL      -90.0f
#define CAR_LAUNCH_TOL    9.0f      // how far the road may fall away below the car's arc before it flies
#define CAR_STEP_UP       56.0f     // highest ledge the wheels climb (walls start above it)
#define CAR_WALL_R        100.0f
#define CAR_EXIT_SPEED    10.0f

// the chase camera (New York's)
#define CAR_CAM_DIST      640.0f
#define CAR_CAM_DIST_K    3.2f
#define CAR_CAM_H         250.0f
#define CAR_CAM_H_K       1.0f
#define CAR_CAM_FOV       52.0f
#define CAR_CAM_FOV_K     0.11f
#define CAR_CAM_FOCUS_H   150.0f

// the drift boost (highway.c): hold a drift (R) at speed through a bend, let go
#define DRIFT_MIN_SPEED   48.0f
#define DRIFT_TIER1       26        // frames: blue sparks
#define DRIFT_TIER2       62        // orange sparks
#define BOOST1_FRAMES     26
#define BOOST2_FRAMES     48
#define BOOST_ACCEL       1.6f
#define BOOST_TOP         34.0f

enum CarStates { CAR_EMPTY, CAR_DRIVEN };
enum DriveStates { DRIVE_ENTER, DRIVE_ON };

struct StudioCar gStudioCar;
#define C gStudioCar
#define L (gStudioCarLooks[C.look])

static struct StudioCarCfg sCfg[OBJECT_POOL_CAPACITY];
static s32 sPromptShown;
static u16 sRadioPrev;
static s32 sRadioOn;
static f32 sHud[STV_HUD_FLOATS];
static f32 sFovBonus;

struct StudioCarCfg *studio_car_cfg(struct Object *obj) {
    s32 slot = obj - gObjectPool;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return NULL;
    }
    if (sCfg[slot].uid != obj->unused2 || sCfg[slot].look < 0) {
        memset(&sCfg[slot], 0, sizeof(sCfg[slot]));
        sCfg[slot].uid = obj->unused2;
        sCfg[slot].look = studio_car_look_of(obj);
        sCfg[slot].handling = 1.0f;
        sCfg[slot].accel = 1.0f;
    }
    return &sCfg[slot];
}

static s32 car_alive(struct Object *car, u32 uid) {
    return car != NULL && (car->activeFlags & ACTIVE_FLAG_ACTIVE) && car->unused2 == uid;
}

s32 studio_vehicle_driving(void) {
    return gMarioState != NULL && gMarioState->action == ACT_STUDIO_DRIVE && car_alive(C.obj, C.uid);
}

/* ------------------------------------------------------------------------------------ helpers */

/* car-local (x left, y up, z nose) -> world, with the car's yaw, pitch and roll (as the renderer does,
   mtxf_rotate_zxy_and_translate) */
void studio_car_to_world(f32 lx, f32 ly, f32 lz, f32 *out) {
    f32 sx = sins(C.pitch), cx = coss(C.pitch);
    f32 sy = sins(C.yaw), cy = coss(C.yaw);
    f32 sz = sins(C.roll), cz = coss(C.roll);

    out[0] = C.pos[0] + lx * (cy * cz + sx * sy * sz) + ly * (-cy * sz + sx * sy * cz) + lz * (cx * sy);
    out[1] = C.pos[1] + lx * (cx * sz) + ly * (cx * cz) + lz * (-sx);
    out[2] = C.pos[2] + lx * (-sy * cz + sx * cy * sz) + ly * (sy * sz + sx * cy * cz) + lz * (cx * cy);
}
#define car_to_world studio_car_to_world

/* flat (yaw only) local offsets */
static void car_flat(f32 lx, f32 lz, f32 *x, f32 *z) {
    *x = C.pos[0] + lx * coss(C.yaw) + lz * sins(C.yaw);
    *z = C.pos[2] - lx * sins(C.yaw) + lz * coss(C.yaw);
}

/* a world point in a car's flat frame: along (+ nose) and side (+ left) */
static void obj_local(struct Object *car, f32 x, f32 z, f32 *along, f32 *side) {
    f32 dx = x - car->oPosX, dz = z - car->oPosZ;
    s16 yaw = car->oFaceAngleYaw;
    *along = dx * sins(yaw) + dz * coss(yaw);
    *side = dx * coss(yaw) - dz * sins(yaw);
}

static f32 floor_at(f32 x, f32 y, f32 z, struct Surface **surf) {
    f32 h = find_floor(x, y + CAR_STEP_UP, z, surf);
    if (*surf == NULL) {
        return -20000.0f;
    }
    return h;
}

static void car_sync_object(void) {
    struct Object *car = C.obj;
    car->oPosX = C.pos[0];
    car->oPosY = C.pos[1];
    car->oPosZ = C.pos[2];
    car->oFaceAngleYaw = car->oMoveAngleYaw = C.yaw;
    car->oFaceAnglePitch = C.pitch;
    car->oFaceAngleRoll = C.roll;
    vec3f_copy(car->header.gfx.pos, C.pos);
    vec3s_set(car->header.gfx.angle, C.pitch, C.yaw, C.roll);
}

static void car_from_object(struct Object *car) {
    C.pos[0] = car->oPosX;
    C.pos[1] = car->oPosY;
    C.pos[2] = car->oPosZ;
    C.yaw = car->oFaceAngleYaw;
    C.pitch = car->oFaceAnglePitch;
    C.roll = car->oFaceAngleRoll;
}

static struct Object *spawn_at(s32 model, const BehaviorScript *bhv, f32 x, f32 y, f32 z) {
    struct Object *p = spawn_object(C.obj, model, bhv);
    if (p != NULL) {
        p->oPosX = x;
        p->oPosY = y;
        p->oPosZ = z;
    }
    return p;
}

/* Mario in the driver's seat */
static void mario_seat(struct MarioState *m) {
    Vec3f p;
    car_to_world(L.seat[0], L.seat[1], L.seat[2], p);
    vec3f_copy(m->pos, p);
    vec3f_copy(m->marioObj->header.gfx.pos, p);
    vec3s_set(m->marioObj->header.gfx.angle, C.pitch, C.yaw, C.roll);
    m->faceAngle[0] = 0;
    m->faceAngle[1] = C.yaw;
    m->faceAngle[2] = 0;
}

static void radio(s32 on) {
    if (on && !sRadioOn && C.radio > 0) {
        sRadioPrev = get_current_background_music();
        play_music(SEQ_PLAYER_LEVEL, SEQUENCE_ARGS(4, C.radio), 0);
        sRadioOn = TRUE;
    } else if (!on && sRadioOn) {
        sRadioOn = FALSE;
        if (sRadioPrev != 0) {
            play_music(SEQ_PLAYER_LEVEL, sRadioPrev, 0);
        } else {
            stop_background_music(C.radio);
        }
    }
}

/* ------------------------------------------------------------------------------------ physics */

/* walls at three points along the car, two heights; returns the strongest push's wall normal */
static s32 car_walls(f32 *nx, f32 *nz) {
    struct WallCollisionData wc;
    f32 pts[3];
    s32 i, h, hit = FALSE;
    f32 best = 0.0f;

    pts[0] = L.halfLen - CAR_WALL_R + 8.0f;
    pts[1] = 0.0f;
    pts[2] = -(L.halfLen - CAR_WALL_R + 8.0f);
    for (i = 0; i < 3; i++) {
        for (h = 0; h < 2; h++) {
            f32 x, z, dx, dz, d;
            car_flat(0.0f, pts[i], &x, &z);
            wc.x = x;
            wc.y = C.pos[1];
            wc.z = z;
            wc.offsetY = h ? 110.0f : CAR_STEP_UP - 6.0f;
            wc.radius = MAX(CAR_WALL_R, L.halfW - 4.0f);
            if (find_wall_collisions(&wc) == 0) {
                continue;
            }
            dx = wc.x - x;
            dz = wc.z - z;
            d = dx * dx + dz * dz;
            if (d < 0.01f) {
                continue;
            }
            C.pos[0] += dx;
            C.pos[2] += dz;
            hit = TRUE;
            if (d > best) {
                best = d;
                d = sqrtf(d);
                *nx = dx / d;
                *nz = dz / d;
            }
        }
    }
    return hit;
}

static void car_crash(f32 strength, f32 nx, f32 nz) {
    struct MarioState *m = gMarioState;
    f32 x = C.pos[0] - nx * 110.0f;
    f32 z = C.pos[2] - nz * 110.0f;

    C.crashes++;
    C.crashTimer = 12;
    play_sound(SOUND_ACTION_BONK, m->marioObj->header.gfx.cameraToObject);
    play_sound(strength > 45.0f ? SOUND_GENERAL_BIG_POUND : SOUND_OBJ_BULLY_METAL, C.obj->header.gfx.cameraToObject);
    set_camera_shake_from_hit(strength > 45.0f ? SHAKE_LARGE_DAMAGE : SHAKE_SMALL_DAMAGE);
    spawn_at(MODEL_NONE, bhvTriangleParticleSpawner, x, C.pos[1] + 70.0f, z);
    if (strength > 45.0f) {
        spawn_at(MODEL_NONE, bhvHorStarParticleSpawner, x, C.pos[1] + 70.0f, z);
    }
    EM_ASM({ if (Module.studioVehicleEvent) Module.studioVehicleEvent('crash', $0 >>> 0, $1); }, C.uid, (s32) strength);
}

static void car_physics(struct MarioState *m) {
    struct Controller *ctl = m->controller;
    u16 down = ctl->buttonDown;
    u16 pressed = ctl->buttonPressed;
    f32 fx, fz, rx, rz, vf, vr, top, steerIn, rate, speed, target;
    f32 hFL, hFR, hRL, hRR, hF, hR, ground, predicted;
    struct Surface *sFL, *sFR, *sRL, *sRR, *sC;
    f32 nx = 0.0f, nz = 0.0f, x, z, vn;
    s32 n, i, driving = !C.exitRequest && !C.autoBrake;
    s32 gas = (down & A_BUTTON) || ctl->stickY > 40;
    s32 brake = (down & B_BUTTON) || ctl->stickY < -40;

    // inputs (the camera shouldn't see R or the C buttons: they're ours now)
    steerIn = driving ? ctl->stickX / 64.0f : 0.0f;
    if (C.autoBrake) {
        steerIn = C.autoSteer;
    }
    steerIn = CLAMP(steerIn, -1.0f, 1.0f);
    C.drifting = driving && (down & R_TRIG) && C.grounded;
    if (driving && (pressed & U_CBUTTONS)) {
        C.hornTimer = 12;
    }
    C.lookBack = (down & D_CBUTTONS) != 0;
    if (down & L_CBUTTONS) {
        C.camSwing = approach_s16_symmetric(C.camSwing, 0x3000, 0x300);
    } else if (down & R_CBUTTONS) {
        C.camSwing = approach_s16_symmetric(C.camSwing, -0x3000, 0x300);
    } else {
        C.camSwing = approach_s16_symmetric(C.camSwing, 0, 0x200);
    }
    ctl->buttonPressed &= ~(R_TRIG | U_CBUTTONS | D_CBUTTONS | L_CBUTTONS | R_CBUTTONS);
    ctl->buttonDown &= ~(R_TRIG | U_CBUTTONS | D_CBUTTONS | L_CBUTTONS | R_CBUTTONS);
    if (driving && !C.race && (pressed & Z_TRIG)) {
        C.exitRequest = TRUE;
    }

    // steering: the wheels turn quickly to the stick; the car yaws by speed
    C.steer += (steerIn - C.steer) * 0.4f;
    speed = sqrtf(C.vel[0] * C.vel[0] + C.vel[2] * C.vel[2]);
    fx = sins(C.yaw);
    fz = coss(C.yaw);
    vf = C.vel[0] * fx + C.vel[2] * fz;
    if (C.grounded) {
        rate = C.steerRate * MIN(1.0f, ABS(vf) / 22.0f) * (1.0f - CAR_STEER_TOP_LOSS * MIN(1.0f, ABS(vf) / C.top));
        if (C.drifting) {
            rate *= CAR_DRIFT_STEER;
        }
        target = -C.steer * rate * (vf < 0.0f ? -1.0f : 1.0f);
        C.yawVel += (target - C.yawVel) * 0.45f;
    } else {
        C.yawVel *= 0.9f;
    }
    C.yaw += (s16) C.yawVel;

    // in the new heading: throttle, brakes, grip
    fx = sins(C.yaw);
    fz = coss(C.yaw);
    rx = -fz;
    rz = fx;
    vf = C.vel[0] * fx + C.vel[2] * fz;
    vr = C.vel[0] * rx + C.vel[2] * rz;
    C.braking = FALSE;
    if (C.grounded) {
        if (C.exitRequest || C.autoBrake) {
            vf *= 0.86f;
            C.braking = TRUE;
        } else if (gas && !brake) {
            if (vf < -2.0f) {
                vf = MIN(0.0f, vf + C.brake);
                C.braking = TRUE;
            } else if (C.race) {
                // settles at the top speed (a boost's extra fades off again)
                top = C.top * (C.drifting ? 0.97f : 1.0f) + C.topBonus;
                vf += C.accel * MAX(-0.4f, 1.0f - vf / top);
            } else {
                top = C.top * (C.drifting ? CAR_DRIFT_TOP : 1.0f) + C.topBonus;
                vf += C.accel * MAX(C.topBonus > 0.0f ? -0.4f : 0.08f, 1.0f - vf / top);
            }
        } else if (brake) {
            if (vf > 2.0f) {
                vf = MAX(0.0f, vf - C.brake);
                C.braking = TRUE;
            } else {
                vf = MAX(-CAR_REVERSE_TOP, vf - CAR_REVERSE_ACCEL);
            }
        } else {
            vf *= 0.992f;
            vf = vf > 0.0f ? MAX(0.0f, vf - CAR_ROLL_DRAG) : MIN(0.0f, vf + CAR_ROLL_DRAG);
        }
        if (C.drifting) {
            vf *= C.race ? 0.996f : CAR_DRIFT_DRAG;
        }
        if (C.boostAccel > 0.0f && !C.autoBrake) {
            vf += C.boostAccel;
        }
        if (C.held) {
            vf = 0.0f;
            vr = 0.0f;
            C.yawVel = 0.0f;
        }
        C.grip = approach_f32(C.grip, C.drifting ? C.driftGrip : C.gripK, 0.25f, 0.05f);
        vr *= C.grip;
        C.vel[0] = fx * vf + rx * vr;
        C.vel[2] = fz * vf + rz * vr;
    }
    C.fwdSpeed = vf;
    C.slip = vr;

    // move, in steps no longer than the wall radius allows, sliding along what's in the way
    n = (s32) (speed / 36.0f) + 1;
    for (i = 0; i < n; i++) {
        C.pos[0] += C.vel[0] / n;
        C.pos[2] += C.vel[2] / n;
        if (car_walls(&nx, &nz)) {
            vn = C.vel[0] * nx + C.vel[2] * nz;
            if (vn < 0.0f) {
                C.vel[0] -= nx * vn * 1.15f;
                C.vel[2] -= nz * vn * 1.15f;
                if (-vn > 22.0f && C.crashTimer == 0) {
                    C.vel[0] *= 0.6f;
                    C.vel[2] *= 0.6f;
                    car_crash(-vn, nx, nz);
                } else if (-vn > 6.0f) {
                    C.vel[0] *= 0.96f;
                    C.vel[2] *= 0.96f;
                }
                // the nose follows the wall a little
                C.yawVel += (fx * nz - fz * nx) * MIN(-vn, 40.0f) * 12.0f;
            }
        }
    }
    if (C.crashTimer > 0) {
        C.crashTimer--;
    }

    // the floor under the four wheels
    car_flat(L.track, L.axleF, &x, &z);
    hFL = floor_at(x, C.pos[1], z, &sFL);
    car_flat(-L.track, L.axleF, &x, &z);
    hFR = floor_at(x, C.pos[1], z, &sFR);
    car_flat(L.track, L.axleR, &x, &z);
    hRL = floor_at(x, C.pos[1], z, &sRL);
    car_flat(-L.track, L.axleR, &x, &z);
    hRR = floor_at(x, C.pos[1], z, &sRR);
    ground = find_floor(C.pos[0], C.pos[1] + CAR_STEP_UP, C.pos[2], &sC);
    if (sC == NULL) {
        // off the map: back to the last place it stood, stopped
        vec3f_copy(C.pos, C.safePos);
        C.vel[0] = C.vel[2] = 0.0f;
        ground = find_floor(C.pos[0], C.pos[1] + CAR_STEP_UP, C.pos[2], &sC);
        if (sC == NULL) {
            return;
        }
        hFL = hFR = hRL = hRR = ground;
    }
    if (C.grounded) {
        C.safePos[0] = C.pos[0];
        C.safePos[1] = MAX(C.pos[1], ground);
        C.safePos[2] = C.pos[2];
    }
    // a wheel over a drop hangs no lower than the car's belly
    hFL = MAX(hFL, C.pos[1] - 80.0f);
    hFR = MAX(hFR, C.pos[1] - 80.0f);
    hRL = MAX(hRL, C.pos[1] - 80.0f);
    hRR = MAX(hRR, C.pos[1] - 80.0f);
    hF = (hFL + hFR) * 0.5f;
    hR = (hRL + hRR) * 0.5f;
    ground = MAX(ground, (hF + hR) * 0.5f);
    m->floor = sC;
    m->floorHeight = ground;

    // up and down: follow the road, fly off crests and ramps, land with a bump
    if (C.grounded) {
        predicted = C.pos[1] + C.vel[1] - CAR_GRAVITY;
        if (ground < predicted - CAR_LAUNCH_TOL && C.vel[1] > -2.0f) {
            C.grounded = FALSE;
            C.airTimer = 0;
        } else if (ground < C.pos[1] - 60.0f) {
            C.grounded = FALSE;               // off a ledge
            C.airTimer = 0;
            C.vel[1] = 0.0f;
        } else {
            // a slope carries its climb into the next frame (off the top of a ramp: a hop); a kerb or a
            // step is only a bump
            f32 dy = ground - C.pos[1];
            C.vel[1] = dy > 24.0f ? MAX(C.vel[1], 0.0f) : MAX(dy, -40.0f);
            C.pos[1] = ground;
        }
    }
    if (!C.grounded) {
        C.airTimer++;
        C.vel[1] = MAX(CAR_MAX_FALL, C.vel[1] - CAR_GRAVITY);
        C.pos[1] += C.vel[1];
        if (C.pos[1] <= ground) {
            if (C.vel[1] < -22.0f) {
                C.squash = 10;
                play_sound(SOUND_GENERAL_BIG_POUND, C.obj->header.gfx.cameraToObject);
                set_camera_shake_from_hit(C.vel[1] < -50.0f ? SHAKE_SMALL_DAMAGE : SHAKE_ATTACK);
                spawn_at(MODEL_NONE, bhvHorStarParticleSpawner, C.pos[0], ground, C.pos[2]);
            } else if (C.airTimer > 2) {
                play_sound(SOUND_ACTION_TERRAIN_LANDING + m->terrainSoundAddend, m->marioObj->header.gfx.cameraToObject);
            }
            if (C.airTimer > 12) {
                EM_ASM({ if (Module.studioVehicleEvent) Module.studioVehicleEvent('jump', $0 >>> 0, $1); }, C.uid, C.airTimer);
            }
            C.pos[1] = ground;
            C.vel[1] = 0.0f;
            C.grounded = TRUE;
        }
    }

    // pitch and roll: from the wheels on the ground, nose-down in a long fall
    if (C.grounded) {
        target = -atan2s(L.axleF - L.axleR, hF - hR);
        C.pitch += (s16) ((s16) (target - C.pitch) * 0.45f);
        target = atan2s(2.0f * L.track, (hFL + hRL) * 0.5f - (hFR + hRR) * 0.5f);
        C.roll += (s16) ((s16) (target - C.roll) * 0.45f);
    } else {
        target = -atan2s(MAX(speed, 20.0f), C.vel[1]) / 2;
        C.pitch += (s16) ((s16) (target - C.pitch) * 0.08f);
        C.roll = (s16) (C.roll * 0.9f);
    }
    // body roll in the turns, a squat under braking (visual only)
    C.bodyRoll = (s16) (C.yawVel * speed * 0.012f);
    C.pitch = CLAMP(C.pitch, -0x1800, 0x1800);
    C.roll = CLAMP(C.roll, -0x1400, 0x1400);

    // the wheels
    C.wheelSpin += (s16) (vf * 290.0f);
    C.steerAngle = (s16) (-C.steer * 0x1600);

    // water or a bottomless fall: the car is lost (it comes back at its parking spot)
    if (C.pos[1] < find_water_level(C.pos[0], C.pos[2]) - 60.0f || C.pos[1] < -9000.0f) {
        C.sunk = TRUE;
    }
}

/* the drift boost (highway.c's mario_boosts): a drift at speed, turning, charges it; letting go fires it */
static void flame_at(s32 model, f32 x, f32 y, f32 z, f32 scale) {
    struct Object *f = spawn_at(model, bhvStudioCarFlame, x, y, z);
    if (f != NULL) {
        f->oForwardVel = scale;
        f->oVelY = 1.5f;
        obj_scale(f, scale);
        f->oAnimState = random_u16() & 1;
    }
}

void bhv_studio_car_flame_loop(void) {
    o->oPosY += o->oVelY;
    o->oForwardVel *= 0.8f;
    obj_scale(o, o->oForwardVel);
    if (o->oTimer >= 5) {
        obj_mark_for_deletion(o);
    }
}

static void car_boosts(struct MarioState *m) {
    f32 speed = C.fwdSpeed;
    Vec3f p;
    s32 tier;
    static s32 sSparkTimer;

    if (!C.boost || C.held) {
        C.driftCharge = 0.0f;
        return;
    }
    if (C.drifting && speed > DRIFT_MIN_SPEED && (ABS(C.steer) > 0.25f || ABS(C.slip) > 8.0f)) {
        C.driftCharge += 1.0f;
    } else if (!C.drifting) {
        tier = C.driftCharge >= DRIFT_TIER2 ? 2 : C.driftCharge >= DRIFT_TIER1 ? 1 : 0;
        if (tier > 0 && speed > 20.0f) {
            C.boostTimer = tier == 2 ? BOOST2_FRAMES : BOOST1_FRAMES;
            C.boostFire = tier == 2;
            C.boosts++;
            play_sound(SOUND_OBJ_FLAME_BLOWN, C.obj->header.gfx.cameraToObject);
            play_sound(tier == 2 ? SOUND_MARIO_YAHOO : SOUND_ACTION_SPIN, m->marioObj->header.gfx.cameraToObject);
        }
        C.driftCharge = 0.0f;
    }
    // the sparks off the rear wheels while charging: blue, then orange
    tier = C.driftCharge >= DRIFT_TIER2 ? 2 : C.driftCharge >= DRIFT_TIER1 ? 1 : 0;
    if (tier > 0 && ++sSparkTimer >= 2) {
        sSparkTimer = 0;
        car_to_world(L.track + 14.0f, 14.0f, L.axleR - 30.0f, p);
        flame_at(tier == 2 ? MODEL_RED_FLAME : MODEL_BLUE_FLAME, p[0], p[1], p[2], 1.6f);
        car_to_world(-L.track - 14.0f, 14.0f, L.axleR - 30.0f, p);
        flame_at(tier == 2 ? MODEL_RED_FLAME : MODEL_BLUE_FLAME, p[0], p[1], p[2], 1.6f);
        if (tier == 2 && (gGlobalTimer & 7) == 0) {
            play_sound(SOUND_GENERAL_FLAME_OUT, C.obj->header.gfx.cameraToObject);
        }
    }
    // the boost: a push, a higher top speed, flames out of the exhausts
    if (C.boostTimer > 0) {
        C.boostTimer--;
        C.boostAccel += BOOST_ACCEL;
        C.topBonus += BOOST_TOP;
        car_to_world(34.0f, 30.0f, -L.halfLen - 10.0f, p);
        flame_at(MODEL_RED_FLAME, p[0], p[1], p[2], 3.2f);
        car_to_world(-34.0f, 30.0f, -L.halfLen - 10.0f, p);
        flame_at(MODEL_RED_FLAME, p[0], p[1], p[2], 3.2f);
    }
}

static void car_effects(struct MarioState *m) {
    f32 speed;
    f32 rev;
    f32 slip = ABS(C.slip);
    Vec3f p;

    // engine: the riding-shell rumble, pitched by the revs; three gears: the revs climb through
    // each and drop at the shift
    speed = ABS(C.fwdSpeed) * 95.0f / MAX(60.0f, C.top);
    if (speed < 32.0f) {
        rev = 34.0f + speed / 32.0f * 150.0f;
    } else if (speed < 62.0f) {
        rev = 90.0f + (speed - 32.0f) / 30.0f * 120.0f;
    } else {
        rev = 130.0f + (speed - 62.0f) / 38.0f * 110.0f;
    }
    if (C.drifting || (C.grounded && ABS(C.slip) > 14.0f)) {
        rev += 30.0f;                         // wheelspin
    }
    if (C.held && (m->controller->buttonDown & A_BUTTON)) {
        rev = 190.0f + (f32) (gGlobalTimer % 5) * 6.0f;     // revving on the grid
    }
    C.rpm += (rev - C.rpm) * 0.35f;
    func_80320A4C(1 /* SOUND_BANK_MOVING */, (u8) MIN(255.0f, C.rpm));
    play_sound(SOUND_MOVING_TERRAIN_RIDING_SHELL + m->terrainSoundAddend, C.obj->header.gfx.cameraToObject);
    // tyres: squeal and smoke in drifts and hard slides, wheelspin off the line
    speed = sqrtf(C.vel[0] * C.vel[0] + C.vel[2] * C.vel[2]);
    if (C.grounded && (slip > 9.0f || (C.drifting && speed > 20.0f)
                       || ((m->controller->buttonDown & A_BUTTON) && C.fwdSpeed > 0.0f && C.fwdSpeed < 18.0f))) {
        play_sound(SOUND_AIR_ROUGH_SLIDE, C.obj->header.gfx.cameraToObject);
        if (++C.smokeTimer >= 2) {
            C.smokeTimer = 0;
            car_to_world(L.track, 8.0f, L.axleR, p);
            spawn_at(MODEL_SMOKE, bhvWhitePuffSmoke, p[0], p[1], p[2]);
            car_to_world(-L.track, 8.0f, L.axleR, p);
            spawn_at(MODEL_SMOKE, bhvWhitePuffSmoke, p[0], p[1], p[2]);
        }
    }
    // horn: two honks
    if (C.hornTimer > 0) {
        if (C.hornTimer == 12 || C.hornTimer == 5) {
            play_sound(SOUND_MENU_CAMERA_BUZZ, C.obj->header.gfx.cameraToObject);
        }
        C.hornTimer--;
    }
    // lights: brake lights when slowing (or the Z stop), else on
    if (L.lights) {
        C.obj->oAnimState = C.braking ? 2 : 1;
    }
    // the landing squash
    if (C.squash > 0) {
        f32 s = sins(C.squash * 0x1400) * C.squash * 0.012f;
        C.obj->header.gfx.scale[1] = 1.0f - s;
        C.obj->header.gfx.scale[0] = C.obj->header.gfx.scale[2] = 1.0f + s * 0.5f;
        C.squash--;
    } else {
        vec3f_set(C.obj->header.gfx.scale, 1.0f, 1.0f, 1.0f);
    }
}

/* Bob-ombs go off under the car (the rest of the run-over enemies go through Mario's grown hitbox
   and the riding-shell rules) */
static void car_touch_world(void) {
    struct ObjectNode *list = &gObjectLists[OBJ_LIST_DESTRUCTIVE];
    struct Object *p;
    const BehaviorScript *bobomb = segmented_to_virtual(bhvBobomb);
    f32 along, side;

    if (ABS(C.fwdSpeed) < 6.0f) {
        return;
    }
    for (p = (struct Object *) list->next; p != (struct Object *) list; p = (struct Object *) p->header.next) {
        if (p->behavior != bobomb || p->oAction == BOBOMB_ACT_EXPLODE || ABS(p->oPosY - C.pos[1]) > 150.0f) {
            continue;
        }
        obj_local(C.obj, p->oPosX, p->oPosZ, &along, &side);
        if (ABS(along) < L.halfLen + 40.0f && ABS(side) < L.halfW + 40.0f) {
            p->oAction = BOBOMB_ACT_EXPLODE;
            C.vel[1] = MAX(C.vel[1], 34.0f);
            C.grounded = FALSE;
            C.kills++;
            set_camera_shake_from_hit(SHAKE_LARGE_DAMAGE);
        }
    }
}

/* ------------------------------------------------------------------------------------ tuning per car */

void studio_car_tune(struct StudioCarCfg *cfg, s32 race) {
    f32 h = cfg && cfg->handling > 0 ? CLAMP(cfg->handling, 0.4f, 1.8f) : 1.0f;
    f32 a = cfg && cfg->accel > 0 ? CLAMP(cfg->accel, 0.4f, 1.8f) : 1.0f;
    C.top = cfg && cfg->top > 0 ? CLAMP(cfg->top, 20.0f, 260.0f) : (L.top > 0 ? L.top : 95.0f);
    // the Shuto tune (highway.c) for the faster cars: a little less pull, stronger brakes
    C.accel = (C.top >= 110.0f ? 3.0f : CAR_ACCEL) * a;
    C.brake = (C.top >= 110.0f ? 4.6f : CAR_BRAKE) * (0.8f + 0.2f * h);
    C.steerRate = CAR_STEER_RATE * h;
    C.gripK = CLAMP(CAR_GRIP / h, 0.05f, 0.6f);
    C.driftGrip = CAR_DRIFT_GRIP;
    C.boost = race || (cfg && cfg->boost);
    C.race = race;
    C.radio = cfg ? cfg->radio : 0;
}

/* ------------------------------------------------------------------------------------ getting in and out */

static void car_start(struct MarioState *m, struct Object *car, s32 seated) {
    struct StudioCarCfg *cfg = studio_car_cfg(car);
    s32 race = C.race;

    memset(&C, 0, sizeof(C));
    C.obj = car;
    C.uid = car->unused2;
    C.look = cfg && cfg->look >= 0 ? cfg->look : studio_car_look_of(car);
    if (C.look < 0) {
        C.look = 0;
    }
    car_from_object(car);
    studio_car_tune(cfg, race);
    C.grip = C.gripK;
    car->oAction = CAR_DRIVEN;
    vec3f_copy(C.enterFrom, m->pos);
    vec3f_copy(C.safePos, C.pos);
    C.grounded = TRUE;
    mario_drop_held_object(m);
    set_mario_action(m, ACT_STUDIO_DRIVE, 0);
    if (seated) {
        m->actionState = DRIVE_ON;
        if (L.lights) car->oAnimState = 1;
        mario_seat(m);
        radio(TRUE);
    } else {
        play_sound(SOUND_MARIO_HOOHOO, m->marioObj->header.gfx.cameraToObject);
    }
    EM_ASM({ if (Module.studioVehicleEvent) Module.studioVehicleEvent('enter', $0 >>> 0, 0); }, C.uid);
}

void studio_car_seat_mario(struct MarioState *m, struct Object *car, s32 seated) {
    s32 race = C.race;
    C.race = race;
    car_start(m, car, seated);
    m->flags &= ~MARIO_TELEPORTING;
    m->fadeWarpOpacity = 0xFF;
}

static void car_release_obj(struct MarioState *m) {
    radio(FALSE);
    if (car_alive(C.obj, C.uid)) {
        C.obj->oAction = CAR_EMPTY;
        if (L.lights) C.obj->oAnimState = 0;
        vec3f_set(C.obj->header.gfx.scale, 1.0f, 1.0f, 1.0f);
    }
    C.fwdSpeed = 0.0f;
    C.vel[0] = C.vel[2] = 0.0f;
    m->marioObj->hitboxRadius = 37.0f;
    m->marioObj->hitboxDownOffset = 0.0f;
    m->marioObj->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    // the game's camera takes over where the chase camera was
    if (gCamera != NULL) {
        gCamera->yaw = C.camYaw + 0x8000;
    }
    EM_ASM({ if (Module.studioVehicleEvent) Module.studioVehicleEvent('exit', $0 >>> 0, 0); }, C.uid);
    C.obj = NULL;
    C.race = FALSE;
}

/* out, standing at x, z (the race's finish) */
void studio_car_release(struct MarioState *m, f32 x, f32 z, s16 yaw) {
    struct Surface *floor;
    f32 y = find_floor(x, C.pos[1] + 200.0f, z, &floor);
    car_release_obj(m);
    m->pos[0] = x;
    m->pos[1] = floor != NULL ? y : C.pos[1];
    m->pos[2] = z;
    vec3f_set(m->vel, 0.0f, 0.0f, 0.0f);
    m->forwardVel = 0.0f;
    m->faceAngle[0] = m->faceAngle[2] = 0;
    m->faceAngle[1] = yaw;
    m->marioObj->header.gfx.angle[0] = m->marioObj->header.gfx.angle[2] = 0;
    vec3f_copy(m->marioObj->header.gfx.pos, m->pos);
    set_mario_action(m, ACT_IDLE, 0);
}

/* Z: out beside the driver's door (or the other one if that side is blocked) with a little hop;
   where Mario may land, in the car's frame, in order: by either door, a step further out, behind the
   car, in front of it; the roof last */
static s32 mario_get_out(struct MarioState *m) {
    struct WallCollisionData wc;
    struct Surface *floor;
    f32 x, z, fy;
    s32 k;
    f32 spots[6][3] = {
        { L.doorX, L.doorZ, 0x4000 }, { -L.doorX, L.doorZ, -0x4000 },
        { L.doorX + 90.0f, L.doorZ, 0x4000 }, { -L.doorX - 90.0f, L.doorZ, -0x4000 },
        { 0.0f, -L.halfLen - 110.0f, 0x8000 }, { 0.0f, L.halfLen + 110.0f, 0 },
    };

    // (the Z that got him out is spent: in the air the same frame it made him ground-pound)
    m->input &= ~(INPUT_Z_PRESSED | INPUT_Z_DOWN);
    for (k = 0; k < 6; k++) {
        car_flat(spots[k][0], spots[k][1], &x, &z);
        fy = find_floor(x, C.pos[1] + 150.0f, z, &floor);
        if (floor == NULL || fy < C.pos[1] - 300.0f || fy > C.pos[1] + 100.0f) {
            continue;
        }
        wc.x = x;
        wc.y = fy;
        wc.z = z;
        wc.offsetY = 60.0f;
        wc.radius = 50.0f;
        if (find_wall_collisions(&wc) != 0 && (sqr(wc.x - x) + sqr(wc.z - z)) > sqr(25.0f)) {
            continue;
        }
        {
            s16 yaw = C.yaw + (s16) (s32) spots[k][2];
            car_release_obj(m);
            m->pos[0] = x;
            m->pos[1] = fy + 60.0f;
            m->pos[2] = z;
            m->peakHeight = m->pos[1];
            m->faceAngle[1] = yaw;
        }
        m->vel[1] = 22.0f;
        mario_set_forward_vel(m, 4.0f);
        vec3f_copy(m->marioObj->header.gfx.pos, m->pos);
        play_sound(SOUND_ACTION_TERRAIN_JUMP, m->marioObj->header.gfx.cameraToObject);
        return set_mario_action(m, ACT_FREEFALL, 0);
    }
    // (boxed in all round: out through the roof -- he hops off it himself)
    car_release_obj(m);
    m->pos[0] = C.pos[0];
    m->pos[1] = C.pos[1] + L.height + 130.0f;
    m->pos[2] = C.pos[2];
    m->peakHeight = m->pos[1];
    m->vel[1] = 30.0f;
    mario_set_forward_vel(m, 0.0f);
    vec3f_copy(m->marioObj->header.gfx.pos, m->pos);
    play_sound(SOUND_ACTION_TERRAIN_JUMP, m->marioObj->header.gfx.cameraToObject);
    return set_mario_action(m, ACT_FREEFALL, 0);
}

/* ------------------------------------------------------------------------------------ ACT_STUDIO_DRIVE */

static s32 act_drive(struct MarioState *m) {
    struct Object *car = C.obj;
    Vec3f seat;
    f32 t;

    if (!car_alive(car, C.uid)) {
        // the car is gone (the area reloaded, it was deleted in the studio)
        C.obj = NULL;
        C.race = FALSE;
        radio(FALSE);
        m->marioObj->hitboxRadius = 37.0f;
        m->marioObj->hitboxDownOffset = 0.0f;
        return set_mario_action(m, ACT_FREEFALL, 0);
    }
    m->marioObj->hitboxRadius = MAX(150.0f, L.halfW + 40.0f);
    m->marioObj->hitboxDownOffset = 60.0f;
    m->peakHeight = m->pos[1];
    m->quicksandDepth = 0.0f;
    m->wall = NULL;
    C.frames++;

    if (m->actionState == DRIVE_ENTER) {
        // the hop in: an arc from where he stood to the seat
        t = m->actionTimer / 14.0f;
        car_to_world(L.seat[0], L.seat[1], L.seat[2], seat);
        m->pos[0] = C.enterFrom[0] + (seat[0] - C.enterFrom[0]) * t;
        m->pos[2] = C.enterFrom[2] + (seat[2] - C.enterFrom[2]) * t;
        m->pos[1] = C.enterFrom[1] + (seat[1] - C.enterFrom[1]) * t + sins((s16) (t * 0x8000)) * 130.0f;
        m->faceAngle[1] = approach_s16_symmetric(m->faceAngle[1], C.yaw, 0x1800);
        set_mario_animation(m, t < 0.6f ? MARIO_ANIM_SINGLE_JUMP : MARIO_ANIM_SLIDING_ON_BOTTOM_WITH_LIGHT_OBJ);
        vec3f_copy(m->marioObj->header.gfx.pos, m->pos);
        vec3s_set(m->marioObj->header.gfx.angle, 0, m->faceAngle[1], 0);
        if (++m->actionTimer > 14) {
            m->actionState = DRIVE_ON;
            if (L.lights) car->oAnimState = 1;
            play_sound(SOUND_GENERAL_CANNON_UP, car->header.gfx.cameraToObject);
            radio(TRUE);
        }
        return FALSE;
    }

    C.topBonus = 0.0f;
    C.boostAccel = 0.0f;
    studio_race_drive(m);
    car_boosts(m);
    car_physics(m);
    studio_race_after_drive(m);
    car_touch_world();
    car_sync_object();
    car_effects(m);

    // Mario at the wheel, leaning into the turns, looking where he's going (hidden in closed cars)
    mario_seat(m);
    set_mario_animation(m, MARIO_ANIM_SLIDING_ON_BOTTOM_WITH_LIGHT_OBJ);
    m->marioBodyState->headAngle[1] = approach_s16_symmetric(m->marioBodyState->headAngle[1],
                                                             (s16) (C.yawVel * 6.0f), 0x400);
    m->marioBodyState->headAngle[0] = 0;
    if (!L.open) {
        m->marioObj->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
    }
    m->vel[0] = C.vel[0];
    m->vel[1] = C.vel[1];
    m->vel[2] = C.vel[2];
    m->forwardVel = C.fwdSpeed;
    m->slideVelX = C.vel[0];
    m->slideVelZ = C.vel[2];

    if (C.sunk) {
        // lost (water, the void): back at its parking spot, Mario out
        C.sunk = FALSE;
        car->oPosX = car->oHomeX;
        car->oPosY = car->oHomeY;
        car->oPosZ = car->oHomeZ;
        car->oFaceAngleYaw = car->oMoveAngleYaw = (s16) car->oStudioCarHomeYaw;
        car->oFaceAnglePitch = car->oFaceAngleRoll = 0;
        car_release_obj(m);
        m->vel[1] = 0.0f;
        play_sound(SOUND_MARIO_MAMA_MIA, m->marioObj->header.gfx.cameraToObject);
        return set_mario_action(m, ACT_FREEFALL, 0);
    }
    // out with Z once it has stopped
    if (C.exitRequest && ABS(C.fwdSpeed) < CAR_EXIT_SPEED && C.grounded) {
        C.exitRequest = FALSE;
        return mario_get_out(m);
    }
    return FALSE;
}

s32 studio_vehicle_action(struct MarioState *m) {
    if (m->action == ACT_STUDIO_DRIVE) {
        return act_drive(m);
    }
    return set_mario_action(m, ACT_IDLE, 0);
}

/* B at a door of an empty car: in (the punch never happens); B by a rival: the race */
void studio_vehicle_before_step(struct MarioState *m) {
    struct ObjectNode *list;
    struct Object *p, *best = NULL;
    f32 along, side, bestD = 1e9f;
    u32 group = m->action & ACT_GROUP_MASK;
    const BehaviorScript *bhv = segmented_to_virtual(bhvStudioCar);

    sPromptShown = 0;
    if (gStudioPaused || m->heldObj != NULL || (group != ACT_GROUP_STATIONARY && group != ACT_GROUP_MOVING)
        || (m->action & ACT_FLAG_AIR) || m->action == ACT_STUDIO_DRIVE) {
        return;
    }
    if (studio_race_prompt(m)) {
        sPromptShown = 2;
        return;
    }
    list = &gObjectLists[OBJ_LIST_SURFACE];
    for (p = (struct Object *) list->next; p != (struct Object *) list; p = (struct Object *) p->header.next) {
        struct StudioCarLook *l;
        s32 look;
        if (p->behavior != bhv || p->oAction != CAR_EMPTY || !(p->activeFlags & ACTIVE_FLAG_ACTIVE)) {
            continue;
        }
        look = studio_car_look_of(p);
        if (look < 0) {
            continue;
        }
        l = &gStudioCarLooks[look];
        obj_local(p, m->pos[0], m->pos[2], &along, &side);
        if (ABS(ABS(side) - l->doorX) < 110.0f && ABS(along - l->doorZ) < MAX(150.0f, l->halfLen * 0.5f)
            && ABS(m->pos[1] - p->oPosY) < 80.0f) {
            f32 d = ABS(ABS(side) - l->doorX) + ABS(along - l->doorZ);
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
    }
    if (best != NULL) {
        sPromptShown = 1;
        if (m->input & INPUT_B_PRESSED) {
            m->input &= ~INPUT_B_PRESSED;
            C.race = FALSE;
            car_start(m, best, FALSE);
        }
    }
}

/* ------------------------------------------------------------------------------------ the camera */

s32 studio_vehicle_camera(f32 *outPos, f32 *outFocus) {
    struct MarioState *m = gMarioState;
    Vec3f focus, pos, eye, dir, hit;
    f32 speed, dist, height, len, ahead;
    struct Surface *surf = NULL;
    s16 want;

    if (gStudioPaused || !studio_vehicle_driving()) {
        return FALSE;
    }
    if (studio_race_camera(outPos, outFocus)) {
        C.camInit = FALSE;
        return TRUE;
    }
    speed = ABS(C.fwdSpeed);
    if (!C.camInit) {
        C.camInit = TRUE;
        C.camYaw = atan2s(gLakituState.curFocus[2] - gLakituState.curPos[2], gLakituState.curFocus[0] - gLakituState.curPos[0]);
        vec3f_copy(C.camFocus, gLakituState.curFocus);
        C.camDist = 600.0f;
    }
    // behind the car's heading (C-down looks back), lagging a little
    want = C.yaw;
    if (C.lookBack) {
        want = C.yaw + 0x8000;
    }
    want += C.camSwing;
    C.camYaw += (s16) ((s16) (want - C.camYaw) * (C.lookBack ? 0.5f : 0.14f));
    // pulls back and up with speed, looks ahead in the direction of travel (bigger cars: further)
    dist = CAR_CAM_DIST * MAX(1.0f, L.halfLen / 232.0f) + speed * (C.race ? 1.0f : CAR_CAM_DIST_K);
    C.camDist += (dist - C.camDist) * 0.08f;
    height = (C.race ? 185.0f : CAR_CAM_H) * MAX(1.0f, L.height / 120.0f) + speed * (C.race ? 0.22f : CAR_CAM_H_K);
    ahead = 60.0f + C.fwdSpeed * 3.0f;
    focus[0] = C.pos[0] + sins(C.yaw) * ahead + C.vel[0] * 1.5f;
    focus[1] = C.pos[1] + (C.race ? 120.0f : CAR_CAM_FOCUS_H);
    focus[2] = C.pos[2] + coss(C.yaw) * ahead + C.vel[2] * 1.5f;
    C.camFocus[0] += (focus[0] - C.camFocus[0]) * 0.5f;
    C.camFocus[1] += (focus[1] - C.camFocus[1]) * 0.3f;
    C.camFocus[2] += (focus[2] - C.camFocus[2]) * 0.5f;
    pos[0] = C.pos[0] - sins(C.camYaw) * C.camDist;
    pos[1] = C.pos[1] + height;
    pos[2] = C.pos[2] - coss(C.camYaw) * C.camDist;
    // never inside a wall: pull in to what's clear between the car and the camera
    eye[0] = C.pos[0];
    eye[1] = C.pos[1] + 140.0f;
    eye[2] = C.pos[2];
    dir[0] = pos[0] - eye[0];
    dir[1] = pos[1] - eye[1];
    dir[2] = pos[2] - eye[2];
    len = sqrtf(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    find_surface_on_ray(eye, dir, &surf, hit);
    if (surf != NULL && len > 1.0f) {
        f32 clear = sqrtf(sqr(hit[0] - eye[0]) + sqr(hit[1] - eye[1]) + sqr(hit[2] - eye[2]));
        if (clear < len) {
            clear = MAX(160.0f, clear - 70.0f);
            pos[0] = eye[0] + dir[0] / len * clear;
            pos[1] = eye[1] + dir[1] / len * clear;
            pos[2] = eye[2] + dir[2] / len * clear;
        }
    }
    vec3f_copy(outPos, pos);
    vec3f_copy(outFocus, C.camFocus);
    // a wider view at speed (and on a boost)
    sFovBonus = approach_f32(sFovBonus, C.boostTimer > 0 ? 9.0f : (C.topBonus > 0.0f ? 4.0f : 0.0f), 1.2f, 0.6f);
    sFOVState.fov = (C.race ? 48.0f : CAR_CAM_FOV) + MIN(speed, C.top) * (C.race ? 0.16f : CAR_CAM_FOV_K) + sFovBonus;
    // the game's camera follows along, so it carries on from here after the drive
    vec3f_copy(gLakituState.pos, pos);
    vec3f_copy(gLakituState.curPos, pos);
    vec3f_copy(gLakituState.goalPos, pos);
    vec3f_copy(gLakituState.focus, C.camFocus);
    vec3f_copy(gLakituState.curFocus, C.camFocus);
    vec3f_copy(gLakituState.goalFocus, C.camFocus);
    if (gCamera != NULL) {
        gCamera->yaw = gCamera->nextYaw = atan2s(pos[2] - C.camFocus[2], pos[0] - C.camFocus[0]);
        vec3f_copy(gCamera->pos, pos);
        vec3f_copy(gCamera->focus, C.camFocus);
    }
    gLakituState.yaw = atan2s(pos[2] - C.camFocus[2], pos[0] - C.camFocus[0]);
    (void) m;
    return TRUE;
}

/* ------------------------------------------------------------------------------------ the car objects */

void studio_car_wheels_for(struct Object *obj, s16 *spin, s16 *steer) {
    extern s32 studio_race_wheels_for(struct Object *obj, s16 *spin, s16 *steer);
    if (obj == C.obj && studio_vehicle_driving()) {
        *spin = C.wheelSpin;
        *steer = C.steerAngle;
    } else if (!studio_race_wheels_for(obj, spin, steer)) {
        *spin = 0;
        *steer = 0;
    }
}

static void car_apply_look(struct Object *car, struct StudioCarCfg *cfg) {
    s32 painted;
    struct GraphNode *n;
    if (cfg->look < 0) {
        return;
    }
    n = studio_car_look_node(cfg->look, cfg->paint | (cfg->lights ? STV_BEAMS : 0), &painted);
    if (n != NULL) {
        car->header.gfx.sharedChild = n;
    }
    car->collisionData = (void *) gStudioCarLooks[cfg->look].collision;
}

void bhv_studio_car_init(void) {
    struct StudioCarCfg *cfg = studio_car_cfg(o);
    if (cfg != NULL) {
        car_apply_look(o, cfg);
    }
    // (a car the race gave Mario is driven before its first frame: it stays his)
    o->oAction = C.obj == o ? CAR_DRIVEN : CAR_EMPTY;
    o->oAnimState = 0;
    o->oStudioCarHomeYaw = o->oFaceAngleYaw;
    o->oHomeX = o->oPosX;
    o->oHomeY = o->oPosY;
    o->oHomeZ = o->oPosZ;
}

void bhv_studio_car_loop(void) {
    struct MarioState *m = gMarioState;

    if (o->oAction == CAR_DRIVEN) {
        // the driver is gone some other way (a warp, a respawn after a fall): the car stays put
        if (!(m->action == ACT_STUDIO_DRIVE && C.obj == o)) {
            o->oAction = CAR_EMPTY;
            if (gStudioCarLooks[MAX(0, studio_car_look_of(o))].lights) o->oAnimState = 0;
            if (C.obj == o) {
                radio(FALSE);
                C.obj = NULL;
            }
        }
        return;
    }
    vec3f_set(o->header.gfx.scale, 1.0f, approach_f32(o->header.gfx.scale[1], 1.0f, 0.02f, 0.02f), 1.0f);
    if (o->collisionData != NULL) {
        load_object_collision_model();
    }
    if (o->oPosY < -9000.0f) {
        // lost off the level: towed back to its spot
        o->oPosX = o->oHomeX;
        o->oPosY = o->oHomeY;
        o->oPosZ = o->oHomeZ;
        o->oFaceAngleYaw = o->oMoveAngleYaw = (s16) o->oStudioCarHomeYaw;
        o->oFaceAnglePitch = o->oFaceAngleRoll = 0;
    }
}

// a car the race puts Mario in (when he walked up to the rival)
struct Object *studio_car_spawn_player(s32 look, u32 paint, f32 x, f32 y, f32 z, s16 yaw) {
    struct Object *car;
    struct GraphNode *n = studio_car_look_node(look, paint, NULL);
    struct StudioCarCfg *cfg;
    if (n == NULL) {
        return NULL;
    }
    car = studio_spawn_raw(bhvStudioCar, n, x, y, z, 0, yaw, 0, 0);
    if (car == NULL) {
        return NULL;
    }
    car->unused2 = 0x7E000000u | (u32) (random_u16() << 4) | (u32) (gGlobalTimer & 0xF);
    cfg = studio_car_cfg(car);
    cfg->look = look;
    cfg->paint = paint;
    car->collisionData = (void *) gStudioCarLooks[look].collision;
    return car;
}

/* ------------------------------------------------------------------------------------ the page's API */

// Settings of a placed car: [look, top speed (units/frame), handling, acceleration, paint 0xRRGGBB,
// drift boost, radio sequence, headlights]. Unset values keep the look's own.
EMSCRIPTEN_KEEPALIVE
s32 studio_vehicle_config(s32 slot, const f32 *v, s32 n) {
    struct Object *obj;
    struct StudioCarCfg *cfg;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || v == NULL) {
        return 0;
    }
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) {
        return 0;
    }
    cfg = studio_car_cfg(obj);
    if (n > 0 && v[0] >= 0 && v[0] < gStudioCarLookCount) cfg->look = (s32) v[0];
    if (n > 1) cfg->top = v[1];
    if (n > 2) cfg->handling = v[2];
    if (n > 3) cfg->accel = v[3];
    if (n > 4) cfg->paint = (u32) v[4];
    if (n > 5) cfg->boost = v[5] != 0;
    if (n > 6) cfg->radio = (s32) v[6];
    if (n > 7) cfg->lights = v[7] != 0;
    if (obj->behavior == segmented_to_virtual(bhvStudioCar)) {
        car_apply_look(obj, cfg);
    }
    // the car Mario drives right now changes at once
    if (obj == C.obj && studio_vehicle_driving()) {
        studio_car_tune(cfg, C.race);
    }
    return 1;
}

// The looks: [{ id, open, halfLen, halfW, top }]
EMSCRIPTEN_KEEPALIVE
const char *studio_vehicle_looks_json(void) {
    static char buf[4096];
    s32 i, n = 0;
    studio_car_look_of(gMarioObject); // (fills the table)
    n += sprintf(buf + n, "[");
    for (i = 0; i < gStudioCarLookCount; i++) {
        struct StudioCarLook *l = &gStudioCarLooks[i];
        n += sprintf(buf + n, "%s{\"id\":\"%s\",\"open\":%d,\"halfLen\":%.0f,\"halfW\":%.0f,\"top\":%.0f}", i ? "," : "",
                     l->id, l->open, l->halfLen, l->halfW, l->top);
    }
    sprintf(buf + n, "]");
    return buf;
}

// Everything the page's HUD and tests read, each frame (a float array; see web/js/vehicles.js HUD):
//  0 driving  1 speed (units/frame, signed)  2 top  3 drift charge  4 boost frames  5 prompt (1 drive,
//  2 race)  6 crashes  7 grounded  8 air frames  9 x 10 y 11 z  12 yaw  13 car uid (low 24 bits)
//  14 look  15 drifting  16 kills  17 boosts  18.. the race's (vehicle_race.c)
EMSCRIPTEN_KEEPALIVE
f32 *studio_vehicle_hud(void) {
    s32 d = studio_vehicle_driving();
    memset(sHud, 0, sizeof(sHud));
    sHud[0] = d ? (gMarioState->actionState == DRIVE_ON ? 1 : 0.5f) : 0;
    if (d) {
        sHud[1] = C.fwdSpeed;
        sHud[2] = C.top;
        sHud[3] = C.boost ? C.driftCharge / (f32) DRIFT_TIER2 : 0;
        sHud[4] = C.boostTimer;
        sHud[6] = C.crashes;
        sHud[7] = C.grounded;
        sHud[8] = C.airTimer;
        sHud[9] = C.pos[0];
        sHud[10] = C.pos[1];
        sHud[11] = C.pos[2];
        sHud[12] = (u16) C.yaw;
        sHud[13] = (f32) (C.uid & 0xFFFFFF);
        sHud[14] = C.look;
        sHud[15] = C.drifting;
        sHud[16] = C.kills;
        sHud[17] = C.boosts;
    }
    sHud[5] = sPromptShown;
    studio_race_hud(sHud);
    return sHud;
}

// The car Mario drives, for the page (uid as an unsigned number) and tests.
EMSCRIPTEN_KEEPALIVE
const char *studio_vehicle_state_json(void) {
    static char buf[512];
    s32 d = studio_vehicle_driving();
    sprintf(buf, "{\"driving\":%d,\"uid\":%u,\"look\":\"%s\",\"speed\":%.2f,\"top\":%.1f,\"x\":%.0f,\"y\":%.0f,\"z\":%.0f,"
                 "\"yaw\":%d,\"crashes\":%d,\"grounded\":%d,\"air\":%d,\"drifting\":%d,\"boosts\":%d,\"race\":%d,\"prompt\":%d}",
            d, d ? C.uid : 0, d ? gStudioCarLooks[C.look].id : "", d ? C.fwdSpeed : 0.0f, d ? C.top : 0.0f,
            d ? C.pos[0] : 0.0f, d ? C.pos[1] : 0.0f, d ? C.pos[2] : 0.0f, d ? (u16) C.yaw : 0, d ? C.crashes : 0,
            d ? C.grounded : 0, d ? C.airTimer : 0, d ? C.drifting : 0, d ? C.boosts : 0, d ? C.race : 0, sPromptShown);
    return buf;
}

// Tests and the page: Mario into the car with this uid (seated right away) or out of his car.
EMSCRIPTEN_KEEPALIVE
s32 studio_vehicle_enter(u32 uid) {
    s32 i;
    struct MarioState *m = gMarioState;
    if (m == NULL || gMarioObject == NULL) {
        return 0;
    }
    if (uid == 0) {
        if (studio_vehicle_driving() && !C.race) {
            C.exitRequest = TRUE;
            return 1;
        }
        return 0;
    }
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *p = &gObjectPool[i];
        if ((p->activeFlags & ACTIVE_FLAG_ACTIVE) && p->unused2 == uid && p->behavior == segmented_to_virtual(bhvStudioCar)) {
            C.race = FALSE;
            car_start(m, p, TRUE);
            return 1;
        }
    }
    return 0;
}

// A new area: nothing of the last one's cars and races is left (the page's level hook).
EMSCRIPTEN_KEEPALIVE
void studio_vehicle_area_reset(void) {
    memset(sCfg, 0, sizeof(sCfg));
    C.obj = NULL;
    C.race = FALSE;
    sRadioOn = FALSE;
    sPromptShown = 0;
    studio_race_reset_all();
}
