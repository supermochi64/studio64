#include "vehicle.h"
#include "actor.h"
#include "world.h"
#include "weapon.h"
#include "fx.h"
#include "sound.h"

Actor *g_chase_target;

const VehicleDef g_vdefs[VD_COUNT] = {
  //             name         model           kind     len  wid  h     max  accel brake steer grip mass seats health paint                 police motor
  [VD_SEDAN] =    {"Sedan",    "car_sedan",    VK_CAR,  4.5f, 1.9f, 1.45f, 34, 9.0f, 18, 0.62f, 7.0f, 1.0f, 4, 900, {0, 0, 0, 0}, false, true},
  [VD_LOWRIDER] = {"Lowrider", "car_lowrider", VK_CAR,  5.2f, 2.0f, 1.3f,  31, 8.0f, 16, 0.55f, 6.5f, 1.2f, 4, 1000, {0, 0, 0, 0}, false, true},
  [VD_PICKUP] =   {"Pickup",   "car_pickup",   VK_CAR,  5.0f, 2.0f, 1.8f,  31, 8.5f, 16, 0.55f, 6.0f, 1.4f, 2, 1200, {0, 0, 0, 0}, false, true},
  [VD_VAN] =      {"Van",      "car_van",      VK_CAR,  4.8f, 2.0f, 2.1f,  27, 7.0f, 15, 0.52f, 5.5f, 1.6f, 4, 1300, {0, 0, 0, 0}, false, true},
  [VD_SPORTS] =   {"Sports",   "car_sports",   VK_CAR,  4.3f, 1.95f, 1.2f, 46, 13.0f, 22, 0.6f, 8.5f, 0.9f, 2, 800, {0, 0, 0, 0}, false, true},
  [VD_POLICE] =   {"Police",   "car_police",   VK_CAR,  4.6f, 1.9f, 1.5f,  40, 11.0f, 20, 0.62f, 7.5f, 1.1f, 4, 1100, {30, 30, 34, 255}, true, true},
  [VD_TAXI] =     {"Taxi",     "car_taxi",     VK_CAR,  4.5f, 1.9f, 1.45f, 34, 9.0f, 18, 0.62f, 7.0f, 1.0f, 4, 900, {240, 196, 40, 255}, false, true},
  [VD_BMX] =      {"BMX",      "bike_bmx",     VK_BIKE, 1.6f, 0.6f, 1.1f,  13, 5.5f, 14, 0.9f, 9.0f, 0.2f, 1, 250, {0, 0, 0, 0}, false, false},
  [VD_MOTOR] =    {"Motorbike","bike_motor",   VK_BIKE, 2.0f, 0.7f, 1.2f,  44, 14.0f, 20, 0.75f, 8.0f, 0.4f, 2, 500, {0, 0, 0, 0}, false, true},
};

static const color_t PAINTS[] = {{170, 30, 30, 255}, {30, 70, 160, 255}, {230, 230, 230, 255}, {30, 30, 34, 255}, {120, 120, 126, 255}, {40, 120, 60, 255}, {200, 140, 40, 255}, {110, 40, 120, 255}, {80, 160, 190, 255}, {150, 110, 70, 255}};

void vehicle_init(void) {
  for (int d = 0; d < VD_COUNT; d++) {
    char path[40];
    sprintf(path, "rom:/%s.t3dm", g_vdefs[d].model);
    g_models.vehicle[d] = t3d_model_load(path);
    render_tag_tints(g_models.vehicle[d]);
  }
}

Vehicle *vehicle_spawn(int def, V3 pos, float yaw) {
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (v->used) continue;
    T3DSkeleton skel = v->skel; int oldDef = v->def; bool had = skel.bones != NULL;
    memset(v, 0, sizeof(*v));
    if (had && oldDef == def) v->skel = skel;
    else { if (had) t3d_skeleton_destroy(&skel); v->skel = t3d_skeleton_create_buffered(g_models.vehicle[def], FB_COUNT); }
    v->used = true; v->def = def; v->id = i;
    v->pos = pos; v->yaw = yaw;
    v->health = g_vdefs[def].health;
    color_t p = g_vdefs[def].paint;
    v->paint = p.a ? p : PAINTS[rnd_int(sizeof(PAINTS) / sizeof(PAINTS[0]))];
    v->paint2 = RGBA32(235, 235, 235, 255);
    v->onGround = true;
    v->edge = -1;
    return v;
  }
  return NULL;
}

void vehicle_free(Vehicle *v) {
  for (int s = 0; s < 4; s++) if (v->seat[s]) { Actor *a = v->seat[s]; vehicle_leave(v, a, false); }
  v->used = false;
}

// ---- seats and doors ----
static V3 seat_local(const Vehicle *v, int seat) {
  const VehicleDef *d = &g_vdefs[v->def];
  if (d->kind == VK_BIKE) return seat == 0 ? (V3){0, d->motor ? 0.35f : 0.2f, -0.2f} : (V3){0, 0.42f, -0.75f};
  float x = (seat % 2 == 0 ? 0.42f : -0.42f), z = seat < 2 ? 0.0f : -1.0f;
  if (v->def == VD_LOWRIDER) z -= 0.3f;
  return (V3){x, -0.12f + (v->def == VD_PICKUP || v->def == VD_VAN ? 0.15f : 0), z};
}
static V3 to_world(const Vehicle *v, V3 l) {
  V3 f = yaw_dir(v->yaw), r = {f.z, 0, -f.x}; // local +x (the left side) in the world
  return (V3){v->pos.x + r.x * l.x + f.x * l.z, v->pos.y + l.y, v->pos.z + r.z * l.x + f.z * l.z};
}
V3 vehicle_door(const Vehicle *v, int seat) {
  const VehicleDef *d = &g_vdefs[v->def];
  float side = (seat % 2 == 0) ? 1 : -1;
  if (d->kind == VK_BIKE) side = 1;
  V3 l = {side * (d->wid / 2 + 0.55f), 0, seat < 2 ? 0.2f : -0.9f};
  V3 w = to_world(v, l);
  w.y = world_floor(w.x, w.z, v->pos.y + 1.0f, NULL);
  return w;
}
bool vehicle_shows_rider(const Vehicle *v) { (void)v; return true; }

static void body_matrix(const Vehicle *v, T3DMat4 *m, float scale) {
  mat_place(m, v->pos, v->yaw, v->pitch, v->roll + v->lean, 0.45f, scale);
}
void vehicle_rider_matrix(Vehicle *v, Actor *a, T3DMat4 *out) {
  T3DMat4 body, seat;
  body_matrix(v, &body, 1.0f);
  V3 l = seat_local(v, a->seat);
  // the rider's hips at the seat: the model's hips are 0.95 m up
  mat_place(&seat, (V3){l.x, l.y + 0.5f - 0.78f * a->look.height, l.z}, 0, 0, 0, 0, MODEL_SCALE * a->look.height);
  mat_mul(out, &body, &seat);
}

int vehicle_free_seat(const Vehicle *v, bool passenger) {
  int n = g_vdefs[v->def].seats;
  for (int s = passenger ? 1 : 0; s < n; s++) if (!v->seat[s]) return s;
  return -1;
}

Vehicle *vehicle_nearest(V3 pos, float maxDist, int *seatOut, bool driverSeat) {
  Vehicle *best = NULL; float bd = maxDist; int bs = -1;
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (!v->used || v->wrecked || v->burning) continue;
    int n = g_vdefs[v->def].seats;
    for (int s = 0; s < n; s++) {
      if (driverSeat && s != 0) continue;
      if (!driverSeat && v->seat[s]) continue;
      float d = v3_dist_xz(vehicle_door(v, s), pos);
      float dc = v3_dist_xz(v->pos, pos) - g_vdefs[v->def].len * 0.5f;
      d = minf(d, maxf(dc, 0) + 0.8f);
      if (d < bd) { bd = d; best = v; bs = s; }
    }
  }
  if (seatOut) *seatOut = bs;
  return best;
}

void vehicle_leave(Vehicle *v, Actor *a, bool thrown) {
  if (!v || !a) return;
  for (int s = 0; s < 4; s++) if (v->seat[s] == a) v->seat[s] = NULL;
  int seat = a->seat;
  a->vehicle = NULL;
  V3 door = vehicle_door(v, seat);
  if (thrown) {
    a->pos = v3_add(to_world(v, seat_local(v, seat)), (V3){0, 0.6f, 0});
    V3 f = yaw_dir(v->yaw);
    a->state = ST_IDLE;
    actor_set_state(a, ST_KNOCKED);
    a->vel = v3_add(v3_scale(f, v->speed * 0.8f), (V3){0, 0, 0});
    a->vel.y = 5 + fabsf(v->speed) * 0.2f;
    a->onGround = false;
  } else {
    // out at the door, unless a wall is there: then on the other side or the roof
    V3 p = door;
    float t; V3 n;
    if (world_raycast(v3_add(v->pos, (V3){0, 0.8f, 0}), v3_add(p, (V3){0, 0.8f, 0}), &t, &n)) p = vehicle_door(v, seat ^ 1);
    a->pos = p;
    a->state = ST_IDLE; a->stateTime = 0;
    a->yaw = v->yaw;
    a->onGround = true; a->vel = (V3){0, 0, 0}; a->speed = 0;
  }
  // never inside a wall: pushed out, and up onto what is under the feet
  for (int k = 0; k < 3; k++) world_push(&a->pos.x, &a->pos.z, 0.35f, a->pos.y + 0.3f, a->pos.y + 1.7f);
  float fl = world_floor(a->pos.x, a->pos.z, a->pos.y + 1.0f, NULL);
  if (!thrown || a->pos.y < fl) a->pos.y = fl;
}

bool vehicle_enter(Actor *a, Vehicle *v, int seat) {
  if (!v || seat < 0 || a->vehicle) return false;
  Actor *occ = v->seat[seat];
  if (occ && occ == a) return false;
  if (occ) {
    // pull them out
    vehicle_leave(v, occ, false);
    occ->scared = true; occ->alert = 5;
    actor_damage(occ, 5, v3_norm(v3_sub(occ->pos, v->pos)), 0, a);
    sound_play(SND_DOOR, v->pos);
  }
  v->seat[seat] = a;
  a->vehicle = v; a->seat = seat;
  a->enterTimer = 0;
  actor_set_state(a, ST_ENTER);
  a->goal = a->pos; // where the walk to the door starts
  return true;
}
void vehicle_exit(Actor *a) {
  if (!a->vehicle || a->state == ST_EXIT || a->state == ST_ENTER) return;
  // not at speed (bikes: you jump off; a burning car: you bail out)
  if (fabsf(a->vehicle->speed) > 8 && !vehicle_is_bike(a->vehicle) && !a->vehicle->burning) return;
  actor_set_state(a, ST_EXIT);
  a->enterTimer = 0;
}
void vehicle_board_step(Actor *a) {
  Vehicle *v = a->vehicle;
  a->enterTimer += DT;
  if (!v) { actor_set_state(a, ST_IDLE); return; }
  if (a->state == ST_ENTER) {
    V3 door = vehicle_door(v, a->seat);
    float k = minf(1, a->enterTimer / 0.35f);
    a->pos = v3_lerp(a->goal, door, k);
    a->yaw = approach_angle(a->yaw, v->yaw, 10 * DT);
    a->vel = (V3){0, 0, 0}; a->speed = 2;
    if (a->enterTimer > 0.45f) { actor_set_state(a, ST_VEHICLE); sound_play(SND_DOOR, v->pos); a->speed = 0; }
  } else {
    if (a->enterTimer > 0.25f) {
      bool fast = (vehicle_is_bike(v) || v->burning) && fabsf(v->speed) > 6;
      vehicle_leave(v, a, fast);
      sound_play(SND_DOOR, a->pos);
    }
  }
}

// ---- physics ----
#define VGRAV 26.0f

static float wheel_ground(const Vehicle *v, float lx, float lz) {
  V3 w = to_world(v, (V3){lx, 0, lz});
  return world_floor(w.x, w.z, v->pos.y + 0.7f, NULL);
}

static void crash(Vehicle *v, float impact, V3 at) {
  if (impact < 4) return;
  sound_play(SND_CRASH, at);
  fx_burst(at, FX_SPARK, (int)minf(8, impact));
  vehicle_damage(v, (impact - 4) * 14 * (v->def == VD_POLICE ? 0.6f : 1.0f), at, NULL);
  if (v3_dist(at, g_view.eye) < 15) g_view.shake = maxf(g_view.shake, impact * 0.05f);
  // a bike throws its rider off in a hard crash
  if (vehicle_is_bike(v) && impact > 7.5f) for (int s = 0; s < 2; s++) if (v->seat[s]) { Actor *a = v->seat[s]; vehicle_leave(v, a, true); actor_damage(a, impact * 1.5f, yaw_dir(v->yaw), 0, NULL); }
}

void vehicle_step(Vehicle *v) {
  const VehicleDef *d = &g_vdefs[v->def];
  Actor *drv = v->seat[0];
  bool canDrive = drv && actor_alive(drv) && drv->state == ST_VEHICLE && !v->wrecked && !v->burning && v->pos.y > WATER_Y - 0.6f;
  if (!canDrive) { v->throttle = 0; v->handbrake = !drv; v->steer *= 0.9f; }
  V3 f = yaw_dir(v->yaw), r = {-f.z, 0, f.x};
  float vf = v->vel.x * f.x + v->vel.z * f.z;
  float vl = v->vel.x * r.x + v->vel.z * r.z;
  float axle = d->len * 0.3f, track = d->wid * 0.42f;

  if (v->onGround) {
    float thr = v->throttle;
    if (thr > 0.05f) {
      if (vf < -0.5f) vf = approach(vf, 0, d->brake * thr * DT);
      else vf += d->accel * thr * (1.0f - vf / d->maxSpeed) * DT;
    } else if (thr < -0.05f) {
      if (vf > 0.5f) vf = approach(vf, 0, d->brake * -thr * DT);
      else vf = approach(vf, -d->maxSpeed * 0.3f, d->accel * 0.7f * DT);
    } else vf = approach(vf, 0, 2.2f * DT);
    if (v->handbrake) vf = approach(vf, 0, (vehicle_is_bike(v) ? 9.0f : 5.0f) * DT);
    // grass and sand are slower
    int gk = world_ground_kind(v->pos.x, v->pos.z);
    if ((gk == GROUND_GRASS || gk == GROUND_SAND || gk == GROUND_DIRT) && v->pos.y < 1.0f && fabsf(vf) > 14) vf = approach(vf, 14 * signf(vf), 6 * DT);
    // steering: a bicycle model, less lock at speed
    float lock = d->steer / (1.0f + fabsf(vf) * 0.045f);
    float wantYawVel = vf * tanf(v->steer * lock) / maxf(1.0f, axle * 2);
    if (v->handbrake && fabsf(vf) > 6 && !vehicle_is_bike(v)) wantYawVel *= 1.5f;
    v->yawVel = lerpf(v->yawVel, wantYawVel, clampf(d->grip * DT * 2.0f, 0, 1));
    // tyres: the sideways slide dies out (less with the handbrake: a drift)
    float grip = v->handbrake && !vehicle_is_bike(v) ? d->grip * 0.18f : d->grip;
    float vl0 = vl;
    vl *= expf(-grip * DT);
    if (fabsf(vl0) > 6 && v3_dist(v->pos, g_view.eye) < 40 && (g.frame % 6) == 0) { fx_burst(to_world(v, (V3){0, 0.1f, -axle}), FX_SMOKE, 1); }
    v->vel.x = f.x * vf + r.x * vl;
    v->vel.z = f.z * vf + r.z * vl;
  } else {
    v->yawVel *= 0.995f;
    v->airTime += DT;
  }
  v->speed = vf;
  v->yaw = wrap_angle(v->yaw + v->yawVel * DT);
  // walls (fast: in steps, so a thin wall is never passed through)
  float depth;
  int nsteps = clampf(ceilf(v3_len_xz(v->vel) * DT / 0.45f), 1, 4);
  V3 n = {0, 0, 0};
  for (int k = 0; k < nsteps; k++) {
    v->pos.x += v->vel.x * DT / nsteps;
    v->pos.z += v->vel.z * DT / nsteps;
    V3 nk = world_push_rect(&v->pos.x, &v->pos.z, v->yaw, d->wid * 0.5f, d->len * 0.5f, v->pos.y + 0.6f, v->pos.y + d->height, &depth);
    if (nk.x != 0 || nk.z != 0) n = nk;
  }
  if (n.x != 0 || n.z != 0) {
    float into = -(v->vel.x * n.x + v->vel.z * n.z);
    if (into > 0) {
      v->vel.x += n.x * into * 1.25f; v->vel.z += n.z * into * 1.25f;
      // a glancing hit turns the car along the wall
      float side = n.x * r.x + n.z * r.z;
      v->yawVel += side * into * 0.08f;
      crash(v, into, v3_add(v->pos, v3_scale(n, -d->wid * 0.5f)));
    }
  }

  // the ground under the wheels: height, pitch, roll
  float hfl = wheel_ground(v, track, axle), hfr = wheel_ground(v, -track, axle);
  float hrl = wheel_ground(v, track, -axle), hrr = wheel_ground(v, -track, -axle);
  if (vehicle_is_bike(v)) { hfl = hfr = wheel_ground(v, 0, axle); hrl = hrr = wheel_ground(v, 0, -axle); }
  float gy = (hfl + hfr + hrl + hrr) * 0.25f;
  float wantPitch = atan2f(((hrl + hrr) - (hfl + hfr)) * 0.5f, axle * 2);
  float wantRoll = vehicle_is_bike(v) ? 0 : atan2f(((hfl + hrl) - (hfr + hrr)) * 0.5f, track * 2);
  float predicted = v->pos.y + v->vel.y * DT - VGRAV * DT * DT;
  if (predicted > gy + 0.06f) {
    // in the air: off a ramp, over a kerb at speed, off the pier
    v->onGround = false;
    v->vel.y -= VGRAV * DT;
    v->pos.y += v->vel.y * DT;
    v->pitch = lerpf(v->pitch, wantPitch * 0.3f + clampf(-v->vel.y * 0.02f, -0.3f, 0.3f), 0.05f);
    if (v->pos.y <= gy) {
      float impact = -v->vel.y;
      v->pos.y = gy; v->vel.y = 0; v->onGround = true;
      if (impact > 9) { crash(v, impact * 0.6f, v->pos); }
      if (v->airTime > 0.4f) fx_burst(v->pos, FX_DUST, 4);
      v->airTime = 0;
    }
  } else {
    float vy = (gy - v->pos.y) / DT;
    v->vel.y = clampf(vy, -10, 14);
    v->pos.y = gy;
    v->onGround = true;
    v->airTime = 0;
    v->pitch = lerpf(v->pitch, wantPitch, 0.35f);
    v->roll = lerpf(v->roll, wantRoll, 0.35f);
  }
  // bikes lean into turns, and a BMX hops with the handbrake (Z)
  if (vehicle_is_bike(v)) {
    float want = clampf(-v->steer * minf(1, fabsf(vf) / 8) * 0.55f, -0.6f, 0.6f);
    v->lean = lerpf(v->lean, drv ? want : 0.0f, 0.2f);
    if (!drv && fabsf(vf) < 0.5f) v->lean = lerpf(v->lean, 0.35f, 0.1f); // parked on its stand
  } else v->lean = 0;
  // the sea
  if (v->pos.y < WATER_Y - 0.4f) {
    if (!v->wrecked && v->health > 0) { fx_burst((V3){v->pos.x, WATER_Y, v->pos.z}, FX_SPLASH, 10); sound_play(SND_SPLASH, v->pos); v->health = 0; v->wrecked = true; }
    v->vel.x *= 0.9f; v->vel.z *= 0.9f;
    for (int s = 0; s < 4; s++) if (v->seat[s]) { Actor *a = v->seat[s]; vehicle_leave(v, a, false); a->pos.y = WATER_Y - 1.25f; }
  }
  v->wheelSpin += vf * DT / 0.34f;

  // damage: smoke, then fire, then the bang
  if (!v->wrecked && v->health < g_vdefs[v->def].health * 0.3f && (g.frame % 4) == 0) fx_burst(to_world(v, (V3){0, 0.9f, axle}), FX_SMOKE, 1);
  if (v->burning) {
    v->burnTimer -= DT;
    if ((g.frame % 2) == 0) fx_burst(to_world(v, (V3){rnd_range(-0.5f, 0.5f), 1.0f, axle}), FX_FIRE, 1);
    for (int s = 0; s < 4; s++) if (v->seat[s] && v->seat[s]->kind != AK_PLAYER) vehicle_exit(v->seat[s]);
    if (v->burnTimer <= 0) {
      v->burning = false; v->wrecked = true;
      for (int s = 0; s < 4; s++) if (v->seat[s]) { Actor *a = v->seat[s]; vehicle_leave(v, a, true); }
      weapon_explode(v3_add(v->pos, (V3){0, 0.8f, 0}), 7.0f, 110, NULL);
      vehicle_push(v, (V3){0, 0, 0}, 8);
    }
  }
  if (v->horn && (g.frame % 15) == 0) sound_play(SND_HORN, v->pos);
}

void vehicle_push(Vehicle *v, V3 vel, float up) {
  v->vel = v3_add(v->vel, vel);
  if (up > 0) { v->vel.y += up; v->onGround = false; v->yawVel += rnd_range(-2, 2); }
}

void vehicle_damage(Vehicle *v, float dmg, V3 at, Actor *by) {
  (void)at; (void)by;
  if (v->wrecked) return;
  v->health -= dmg;
  if (v->health <= 0 && !v->burning) { v->burning = true; v->burnTimer = 4.5f; }
  // the driver of a car shot at panics
  if (by && v->aiDriven) { v->panic = true; v->panicTime = 0; }
}

// ---- vehicles against vehicles and people ----
static bool rect_overlap(const Vehicle *a, const Vehicle *b, V3 *n, float *depth) {
  const VehicleDef *da = &g_vdefs[a->def], *db = &g_vdefs[b->def];
  float ca = cosf(a->yaw), sa = sinf(a->yaw), cb = cosf(b->yaw), sb = sinf(b->yaw);
  // local x/z axes in the world: x = (cos, -sin), z = (sin, cos)
  float ax[4][2] = {{ca, -sa}, {sa, ca}, {cb, -sb}, {sb, cb}};
  float dx = b->pos.x - a->pos.x, dz = b->pos.z - a->pos.z;
  float best = 1e9f;
  for (int k = 0; k < 4; k++) {
    float x = ax[k][0], z = ax[k][1];
    float ra = da->wid * 0.5f * fabsf(ca * x - sa * z) + da->len * 0.5f * fabsf(sa * x + ca * z);
    float rb = db->wid * 0.5f * fabsf(cb * x - sb * z) + db->len * 0.5f * fabsf(sb * x + cb * z);
    float d = dx * x + dz * z;
    float o = ra + rb - fabsf(d);
    if (o <= 0) return false;
    if (o < best) { best = o; n->x = x * signf(d); n->z = z * signf(d); n->y = 0; }
  }
  *depth = best;
  return true;
}

void vehicle_collide_all(void) {
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *a = &g.vehicles[i];
    if (!a->used) continue;
    for (int j = i + 1; j < MAX_VEHICLES; j++) {
      Vehicle *b = &g.vehicles[j];
      if (!b->used || fabsf(a->pos.y - b->pos.y) > 1.5f || v3_dist2_xz(a->pos, b->pos) > 36) continue;
      V3 n = {0, 0, 0}; float depth = 0;
      if (!rect_overlap(a, b, &n, &depth)) continue;
      float ma = g_vdefs[a->def].mass, mb = g_vdefs[b->def].mass;
      float ka = mb / (ma + mb), kb = ma / (ma + mb);
      a->pos.x -= n.x * depth * ka; a->pos.z -= n.z * depth * ka;
      b->pos.x += n.x * depth * kb; b->pos.z += n.z * depth * kb;
      float rel = (b->vel.x - a->vel.x) * n.x + (b->vel.z - a->vel.z) * n.z;
      if (rel < 0) {
        float imp = -rel * 1.3f;
        a->vel.x -= n.x * imp * ka; a->vel.z -= n.z * imp * ka;
        b->vel.x += n.x * imp * kb; b->vel.z += n.z * imp * kb;
        V3 at = v3_lerp(a->pos, b->pos, 0.5f);
        crash(a, -rel * ka * 1.4f, at); crash(b, -rel * kb * 1.4f, at);
        if (b->aiDriven && -rel > 3) b->panic = b->panic || rnd() < 0.3f;
        if (a->aiDriven && -rel > 3) a->panic = a->panic || rnd() < 0.3f;
      }
    }
    // people in the way: pushed aside, or run over
    const VehicleDef *d = &g_vdefs[a->def];
    float c = cosf(a->yaw), s = sinf(a->yaw);
    for (int k = 0; k < MAX_ACTORS; k++) {
      Actor *p = &g.actors[k];
      if (!p->used || p->vehicle || fabsf(p->pos.y - a->pos.y) > 1.6f) continue;
      float dx = p->pos.x - a->pos.x, dz = p->pos.z - a->pos.z;
      if (dx * dx + dz * dz > 16) continue;
      float lx = dx * c - dz * s, lz = dx * s + dz * c;
      float hx = d->wid * 0.5f + 0.3f, hz = d->len * 0.5f + 0.3f;
      if (fabsf(lx) > hx || fabsf(lz) > hz) continue;
      float sp = v3_len_xz(a->vel);
      if (sp > 4.5f && actor_alive(p) && p->state != ST_DOWN && p->state != ST_KNOCKED) {
        V3 dir = v3_norm((V3){a->vel.x + dx * 2, 0, a->vel.z + dz * 2});
        Actor *drv = a->seat[0];
        actor_damage(p, sp * 5.5f, dir, sp * 0.9f, drv);
        a->vel.x *= 0.92f; a->vel.z *= 0.92f;
      } else {
        // out along the shallow side
        float ex = hx - fabsf(lx), ez = hz - fabsf(lz);
        float px = 0, pz = 0;
        if (ex < ez) px = ex * signf(lx); else pz = ez * signf(lz);
        p->pos.x += px * c + pz * s; p->pos.z += -px * s + pz * c;
      }
    }
  }
}

void vehicle_melee(V3 c, float r, float dmg, V3 dir, Actor *by) {
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (!v->used) continue;
    if (v3_dist_xz(v->pos, c) < g_vdefs[v->def].len * 0.5f + r && fabsf(c.y - v->pos.y - 0.6f) < 1.2f) {
      vehicle_damage(v, dmg, c, by);
      if (vehicle_is_bike(v) && !v->seat[0]) vehicle_push(v, v3_scale(dir, 2), 0);
    }
  }
}

bool vehicle_raycast(const Vehicle *v, V3 o, V3 dd, float range, float *tOut) {
  const VehicleDef *d = &g_vdefs[v->def];
  float c = cosf(v->yaw), s = sinf(v->yaw);
  float dx = o.x - v->pos.x, dz = o.z - v->pos.z;
  float org[3] = {dx * c - dz * s, o.y - v->pos.y, dx * s + dz * c};
  float dir[3] = {dd.x * c - dd.z * s, dd.y, dd.x * s + dd.z * c};
  float lo[3] = {-d->wid * 0.5f, 0.2f, -d->len * 0.5f}, hi[3] = {d->wid * 0.5f, d->height, d->len * 0.5f};
  float t0 = 0, t1 = range;
  for (int k = 0; k < 3; k++) {
    if (fabsf(dir[k]) < 1e-7f) { if (org[k] < lo[k] || org[k] > hi[k]) return false; continue; }
    float inv = 1 / dir[k], ta = (lo[k] - org[k]) * inv, tb = (hi[k] - org[k]) * inv;
    if (ta > tb) { float t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  *tOut = t0;
  return true;
}

// ---- the AI's driving ----
static float lane_offset(const StreetEdge *e) { return e->lanes == 2 ? e->half * 0.62f : e->half * 0.48f; }

void vehicle_ai_start(Vehicle *v) {
  // the nearest street edge, driving in the direction the car faces
  World *w = &g_world;
  int best = -1; float bd = 1e9f;
  for (int i = 0; i < w->nsedge; i++) {
    const StreetEdge *e = &w->sedges[i];
    StreetNode *A = &w->snodes[e->a], *B = &w->snodes[e->b];
    float ex = B->x - A->x, ez = B->z - A->z, l2 = ex * ex + ez * ez;
    float t = clampf(((v->pos.x - A->x) * ex + (v->pos.z - A->z) * ez) / l2, 0, 1);
    float d = sqrf(A->x + ex * t - v->pos.x) + sqrf(A->z + ez * t - v->pos.z);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  const StreetEdge *e = &w->sedges[best];
  StreetNode *A = &w->snodes[e->a], *B = &w->snodes[e->b];
  bool forward = (B->x - A->x) * sinf(v->yaw) + (B->z - A->z) * cosf(v->yaw) > 0;
  v->edge = best; v->fromNode = forward ? e->a : e->b; v->toNode = forward ? e->b : e->a;
  v->aiDriven = true;
}

static void next_edge(Vehicle *v) {
  World *w = &g_world;
  int node = v->toNode;
  int n = w->snodeEdgeCount[node];
  int choices[4], nc = 0;
  for (int k = 0; k < n; k++) { int e = w->snodeEdges[node * 4 + k]; if (e != v->edge) choices[nc++] = e; }
  int pick;
  if (nc == 0) pick = v->edge; // a dead end: turn round
  else if (g_chase_target && g_vdefs[v->def].police) {
    // the police: the edge that leads nearest to the target
    float bd = 1e18f; pick = choices[0];
    for (int k = 0; k < nc; k++) {
      const StreetEdge *e = &w->sedges[choices[k]];
      int other = e->a == node ? e->b : e->a;
      float d = sqrf(w->snodes[other].x - g_chase_target->pos.x) + sqrf(w->snodes[other].z - g_chase_target->pos.z);
      if (d < bd) { bd = d; pick = choices[k]; }
    }
  } else pick = choices[rnd_int(nc)];
  const StreetEdge *e = &w->sedges[pick];
  v->fromNode = node; v->toNode = e->a == node ? e->b : e->a; v->edge = pick;
}

void vehicle_ai_drive(Vehicle *v) {
  World *w = &g_world;
  const VehicleDef *d = &g_vdefs[v->def];
  if (v->edge < 0) vehicle_ai_start(v);
  if (v->edge < 0) return;
  if (v->panic && (v->panicTime += DT) > 14) { v->panic = false; v->panicTime = 0; } // calms down
  const StreetEdge *e = &w->sedges[v->edge];
  StreetNode *A = &w->snodes[v->fromNode], *B = &w->snodes[v->toNode];
  float ex = B->x - A->x, ez = B->z - A->z, len = sqrtf(ex * ex + ez * ez);
  float ux = ex / len, uz = ez / len;
  float rx = -uz, rz = ux;                       // the right of the direction of travel
  float off = lane_offset(e);
  if (v->waitTime > 4) off = -off * 0.4f; // going round something: out into the other lane
  float t = (v->pos.x - A->x) * ux + (v->pos.z - A->z) * uz;
  bool chasing = g_chase_target && d->police && actor_alive(g_chase_target);
  float distTarget = chasing ? v3_dist_xz(v->pos, g_chase_target->pos) : 1e9f;
  // near the end of the edge: on to the next one
  float endR = B->deg >= 2 ? 6.0f : 3.0f;
  if (t > len - endR) { next_edge(v); return; }
  float look = clampf(fabsf(v->speed) * 0.6f + 5, 5, 14);
  float tt = minf(t + look, len);
  float tx = A->x + ux * tt + rx * off, tz = A->z + uz * tt + rz * off;
  if (B->deg == 1 && tt > len - 14) { tx = B->x - rx * 6; tz = B->z - rz * 6; } // round the turning circle
  if (chasing && distTarget < 35 && world_los(v3_add(v->pos, (V3){0, 1, 0}), actor_chest(g_chase_target))) { tx = g_chase_target->pos.x; tz = g_chase_target->pos.z; }
  float wantYaw = dir_yaw(tx - v->pos.x, tz - v->pos.z);
  float diff = angle_diff(wantYaw, v->yaw);
  v->steer = clampf(diff * 2.2f, -1, 1);
  // speed: slower in turns, at the end of the street, behind others
  float cruise = e->kind == 1 ? 8.5f : e->lanes == 2 ? 14.0f : 11.0f;
  if (v->panic) cruise = 19;
  if (chasing) cruise = distTarget < 20 ? 12 : 24;
  float want = cruise * (1 - minf(0.6f, fabsf(diff) * 0.8f));
  if (len - t < 18 && B->deg > 2 && !v->panic && !chasing) want = minf(want, 7.5f);
  // what is in front: other cars, people, the player
  V3 f = yaw_dir(v->yaw);
  float block = 1e9f;
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *o = &g.vehicles[i];
    if (!o->used || o == v) continue;
    float dx = o->pos.x - v->pos.x, dz = o->pos.z - v->pos.z;
    float fwd = dx * f.x + dz * f.z, side = fabsf(dx * f.z - dz * f.x);
    if (v->waitTime > 4 && fabsf(o->speed) < 1) continue; // waited long enough: going round it
    if (fwd > 0 && fwd < 16 && side < 2.4f) block = minf(block, fwd - (d->len + g_vdefs[o->def].len) * 0.5f);
  }
  bool person = false;
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!actor_alive(a) || a->vehicle) continue;
    float dx = a->pos.x - v->pos.x, dz = a->pos.z - v->pos.z;
    float fwd = dx * f.x + dz * f.z, side = fabsf(dx * f.z - dz * f.x);
    if (fwd > 0 && fwd < 12 && side < 1.8f) { block = minf(block, fwd - d->len * 0.5f - 0.5f); if (a->kind == AK_PLAYER) person = true; }
  }
  if (!v->panic && !chasing && block < 1e8f) want = minf(want, maxf(0, (block - 1.5f) * 1.2f));
  // stuck behind a car that does not move (parked badly, wrecked, deserted): after a while, round it
  if (want < 1 && fabsf(v->speed) < 0.5f && !person) v->waitTime += DT;
  else if (v->waitTime > 4) { v->waitTime += DT; if (v->waitTime > 9) v->waitTime = 0; }
  else v->waitTime = 0;
  v->horn = person && block < 6 && !chasing;
  // stuck: back up a bit
  if (fabsf(v->speed) < 0.6f && want > 3) v->stuck += DT; else if (v->stuck > 0 && v->stuck < 3) v->stuck = maxf(0, v->stuck - DT);
  if (v->stuck > 3) {
    v->throttle = -0.8f; v->steer = -v->steer;
    if (v->stuck > 4.6f) v->stuck = 0;
    else { v->stuck += DT; return; }
  }
  float err = want - v->speed;
  v->throttle = clampf(err * 0.35f, -1, 1);
  v->handbrake = false;
}

// ---- drawing ----
void vehicle_draw(Vehicle *v) {
  if (!v->used) return;
  if (v3_dist2_xz(v->pos, g_view.eye) > 170.0f * 170.0f) return;
  T3DVec3 c = {{v->pos.x, v->pos.y + 0.8f, v->pos.z}};
  if (!t3d_frustum_vs_sphere(&g_view.frustum, &c, 3.2f)) return;
  const VehicleDef *d = &g_vdefs[v->def];
  T3DSkeleton *s = &v->skel;
  float steerAng = v->steer * d->steer * 0.8f;
  if (d->kind == VK_CAR) {
    for (int k = 1; k <= 4; k++) {
      Quat q = quat_euler(v->wheelSpin, k <= 2 ? steerAng : 0, 0);
      s->bones[k].rotation = (T3DQuat){{q.x, q.y, q.z, q.w}}; s->bones[k].hasChanged = true;
    }
  } else {
    Quat qf = quat_euler(0, steerAng, 0); s->bones[1].rotation = (T3DQuat){{qf.x, qf.y, qf.z, qf.w}}; s->bones[1].hasChanged = true;
    Quat qw = quat_euler(v->wheelSpin, 0, 0);
    s->bones[2].rotation = s->bones[3].rotation = (T3DQuat){{qw.x, qw.y, qw.z, qw.w}};
    s->bones[2].hasChanged = s->bones[3].hasChanged = true;
  }
  s->bones[0].hasChanged = true;
  t3d_skeleton_update(s);
  T3DMat4 m;
  body_matrix(v, &m, MODEL_SCALE);
  render_light_lit();
  Tints t = {0};
  color_t p = v->paint, p2 = v->paint2;
  if (v->wrecked || v->burning) { p = RGBA32(36, 32, 30, 255); p2 = RGBA32(46, 42, 40, 255); }
  else if (v->health < d->health * 0.5f) { p.r = p.r * 3 / 4; p.g = p.g * 3 / 4; p.b = p.b * 3 / 4; }
  t.c[TINT_PAINT] = p; t.c[TINT_PAINT2] = p2;
  render_skinned(g_models.vehicle[v->def], s, &m, &t);
  // the round shadow
  float fl = world_floor(v->pos.x, v->pos.z, v->pos.y + 0.5f, NULL);
  T3DMat4 sm;
  mat_place(&sm, (V3){v->pos.x, fl, v->pos.z}, v->yaw, 0, 0, 0, MODEL_SCALE * d->len * 0.55f);
  rdpq_mode_zmode(ZMODE_DECAL);
  render_colored(g_models.shadow, &sm, RGBA32(0, 0, 0, 255));
  rdpq_mode_zmode(ZMODE_STANDARD);
}
