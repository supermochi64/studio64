#ifndef STUDIO_VEHICLE_H
#define STUDIO_VEHICLE_H

// Studio 64 vehicles: the drivable cars and races ported from the Shoggoth World hack
// (sm64-master, branch shoggoth: src/game/shoggoth/overlay/car_core.inc.c, newyork_car.c, highway.c).
//
//   vehicle_models.c  the cars' looks (tools/vehicles/extract_cars.py -> vehicles/cars.inc.c),
//                     their sizes, the paint recolouring and the wheel callback
//   vehicle.c         the driving core (physics, crashes, engine and tyres, chase camera), Mario's
//                     driving action, getting in and out, the car objects (bhvStudioCar)
//   vehicle_race.c    races along a path drawn in the studio: the rival on rails, checkpoints, laps,
//                     countdown, drift boost, slipstream, traffic, the finish and the star
//                     (bhvStudioRace, bhvStudioRivalCar, bhvStudioTrafficCar)

#include <PR/ultratypes.h>
#include "types.h"

// Mario's driving action (the automatic group, past the game's own ids)
#define ACT_STUDIO_DRIVE (0x17A | ACT_FLAG_RIDING_SHELL | ACT_FLAG_INVULNERABLE | ACT_FLAG_ATTACKING \
                          | ACT_FLAG_PAUSE_EXIT | ACT_FLAG_WATER_OR_TEXT)

// ---- looks (vehicle_models.c) ----
struct StudioCarLook {
    const char *id;
    const void *geo;
    const void *collision;
    f32 halfLen, halfW, height;      // the body, local: +z the nose, +x the driver's (left) side
    f32 axleF, axleR, track, wheelR; // wheel centres
    f32 seat[3];                     // Mario's hips at the wheel
    f32 doorX, doorZ;                // where Mario stands to get in (either side)
    s32 open;                        // Mario shows at the wheel (else he sits hidden inside)
    s32 wheels;                      // the wheels roll and steer (geo_studio_car_wheel)
    s32 lights;                      // head and brake lights follow oAnimState
    f32 top;                         // default top speed (units per frame)
};
extern struct StudioCarLook gStudioCarLooks[];
extern s32 gStudioCarLookCount;
s32 studio_car_look_of(struct Object *o);          // from its model (-1: not a car)
#define STV_BEAMS 0x1000000u // (paint) the headlights shine on the road
struct GraphNode *studio_car_look_node(s32 look, u32 paint, s32 *paintSlot); // a (repainted) model
void studio_car_set_wheels(s16 spin, s16 steer);    // for the car drawn next

// ---- per-object settings (vehicle.c; set by the page) ----
struct StudioCarCfg {
    u32 uid;
    s32 look;
    f32 top;        // top speed, units per frame (0: the look's)
    f32 handling;   // 0.5 .. 1.5: steering and grip
    f32 accel;      // 0.5 .. 1.5
    u32 paint;      // 0xRRGGBB, 0: the look's own
    s32 boost;      // drift boost outside races too
    s32 radio;      // sequence played while driving (0: none)
    s32 lights;     // headlights shining on the road
};
struct StudioCarCfg *studio_car_cfg(struct Object *o);

// ---- the car Mario drives (vehicle.c) ----
struct StudioCar {
    struct Object *obj;
    u32 uid;
    s32 look;
    f32 pos[3], vel[3];
    f32 fwdSpeed, slip;
    s16 yaw, pitch, roll, bodyRoll;
    s16 wheelSpin, steerAngle, camYaw, camSwing;
    f32 yawVel, steer, grip, rpm, camDist;
    f32 camFocus[3], enterFrom[3], safePos[3];
    s32 grounded, airTimer, crashTimer, crashes, kills, squash, hornTimer, smokeTimer;
    s32 camInit, braking, drifting, exitRequest, lookBack, sunk, frames;
    // race extras
    s32 race;       // in a race: no Z exit, a throttle that settles at the top speed
    s32 held;       // on the grid: the throttle only revs
    s32 autoBrake;  // after the finish: brakes on, steered by autoSteer
    f32 autoSteer, topBonus, boostAccel;
    // tuning in use
    f32 top, accel, brake, steerRate, gripK, driftGrip;
    s32 boost;
    f32 driftCharge; s32 boostTimer, boostFire, boosts; // the drift boost
    // free driving: the camera, horn, radio
    s32 radio;
};
extern struct StudioCar gStudioCar;

s32 studio_vehicle_driving(void);
void studio_car_to_world(f32 lx, f32 ly, f32 lz, f32 *out);
void studio_car_place(f32 x, f32 y, f32 z, s16 yaw);
void studio_car_seat_mario(struct MarioState *m, struct Object *car, s32 seated);
void studio_car_release(struct MarioState *m, f32 x, f32 z, s16 yaw); // out, standing at x, z
struct Object *studio_car_spawn_player(s32 look, u32 paint, f32 x, f32 y, f32 z, s16 yaw);
void studio_car_tune(struct StudioCarCfg *cfg, s32 race);

// hooks in the game (mario.c, camera.c)
s32 studio_vehicle_action(struct MarioState *m);       // ACT_STUDIO_DRIVE
void studio_vehicle_before_step(struct MarioState *m); // B at a door
s32 studio_vehicle_camera(f32 *pos, f32 *focus);       // the chase camera (update_graph_node_camera)

// ---- races (vehicle_race.c) ----
s32 studio_race_active(void);              // a race holds Mario's car (no getting out)
void studio_race_drive(struct MarioState *m);  // before the physics: holds, boosts, autopilot
void studio_race_after_drive(struct MarioState *m); // after: shoves, progress, respawn
s32 studio_race_camera(f32 *pos, f32 *focus);  // the grid intro sweep
void studio_race_hud(f32 *h);
s32 studio_race_prompt(struct MarioState *m);  // B by a rival: race (TRUE when it started)
void studio_race_reset_all(void);

// behaviors (vehicle_behaviors.c)
extern const BehaviorScript bhvStudioCar[];
extern const BehaviorScript bhvStudioCarFlame[];
extern const BehaviorScript bhvStudioRace[];
extern const BehaviorScript bhvStudioTrafficCar[];
extern const BehaviorScript bhvStudioRaceDriver[];

// object fields
#define oStudioCarHomeYaw OBJECT_FIELD_S32(0x1B)

// the HUD the page draws (studio_vehicle_hud): see vehicle.c
#define STV_HUD_FLOATS 48

#endif
