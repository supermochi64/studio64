// People's bodies: movement (a 3D platformer's move set, our own implementation), collision,
// damage, the poses, drawing.
#include "actor.h"
#include "world.h"
#include "weapon.h"
#include "vehicle.h"
#include "fx.h"
#include "sound.h"

// ---- tuning (meters, seconds) ----
#define GRAVITY 36.0f
#define TERMINAL -24.0f
#define RUN_SPEED 9.0f
#define WALK_SPEED 2.3f
#define JUMP1_VY 12.6f
#define JUMP2_VY 15.2f
#define JUMP3_VY 20.0f
#define LONGJUMP_VY 9.0f
#define LONGJUMP_MAX 14.5f
#define FLIP_VY 18.6f
#define WALLKICK_VY 15.6f
#define WALLKICK_SPEED 7.2f
#define GP_VY -24.0f
#define CHAIN_WINDOW 0.17f
#define STEP_UP 0.45f
#define RADIUS 0.33f
#define HEIGHT 1.8f

void (*g_on_actor_damaged)(Actor *a, Actor *by, float dmg, bool died);

static V3 s_rest[11];
static bool s_restKnown;

int actor_index(const Actor *a) { return a ? (int)(a - g.actors) : -1; }

// ---- looks ----
static const color_t SKINS[] = {{0xf1, 0xc2, 0x9a, 255}, {0xd8, 0xa0, 0x70, 255}, {0xa8, 0x70, 0x48, 255}, {0x7a, 0x4e, 0x32, 255}, {0x5a, 0x38, 0x24, 255}, {0xe8, 0xb8, 0x8e, 255}};
static const color_t HAIRS[] = {{30, 24, 20, 255}, {60, 40, 24, 255}, {120, 80, 40, 255}, {200, 170, 100, 255}, {20, 20, 20, 255}, {140, 140, 140, 255}};
static const color_t CIV_SHIRTS[] = {{200, 60, 50, 255}, {60, 100, 180, 255}, {230, 230, 230, 255}, {240, 200, 60, 255}, {90, 160, 160, 255}, {180, 120, 200, 255}, {240, 140, 60, 255}, {120, 120, 120, 255}, {250, 250, 250, 255}, {40, 40, 50, 255}};
static const color_t CIV_PANTS[] = {{50, 60, 100, 255}, {40, 40, 44, 255}, {150, 130, 100, 255}, {90, 70, 50, 255}, {200, 200, 190, 255}, {70, 90, 60, 255}};
static const color_t GANG_COL[GANG_COUNT] = {{0, 0, 0, 255}, {46, 150, 60, 255}, {130, 60, 160, 255}, {220, 180, 40, 255}, {40, 60, 120, 255}};
#define N(a) (int)(sizeof(a) / sizeof(a[0]))

Look look_for(int kind, int gang) {
  Look l;
  l.skin = SKINS[rnd_int(N(SKINS))];
  l.hair = HAIRS[rnd_int(N(HAIRS))];
  l.shoes = rnd() < 0.5f ? RGBA32(240, 240, 240, 255) : RGBA32(30, 30, 30, 255);
  l.height = rnd_range(0.94f, 1.06f);
  l.hasHat = false;
  if (kind == AK_PLAYER) {
    l.skin = SKINS[3]; l.hair = HAIRS[4];
    l.shirt = RGBA32(240, 240, 236, 255); l.pants = RGBA32(46, 110, 60, 255); l.shoes = RGBA32(240, 240, 240, 255);
    l.hat = RGBA32(40, 130, 56, 255); l.hasHat = true; l.height = 1.0f;
  } else if (kind == AK_COP) {
    l.shirt = RGBA32(40, 60, 120, 255); l.pants = RGBA32(30, 36, 60, 255); l.shoes = RGBA32(20, 20, 20, 255);
    l.hat = RGBA32(30, 40, 80, 255); l.hasHat = true;
  } else if (kind == AK_GANG) {
    color_t c = GANG_COL[gang];
    float f = rnd_range(0.75f, 1.1f);
    l.shirt = rnd() < 0.7f ? RGBA32((uint8_t)minf(255, c.r * f), (uint8_t)minf(255, c.g * f), (uint8_t)minf(255, c.b * f), 255) : RGBA32(230, 230, 230, 255);
    l.pants = rnd() < 0.5f ? RGBA32(40, 40, 48, 255) : RGBA32(60, 80, 120, 255);
    l.hat = c; l.hasHat = rnd() < 0.65f;
    if (l.shirt.r == 230) l.hasHat = true; // a white shirt: the colours on the cap
  } else {
    l.shirt = CIV_SHIRTS[rnd_int(N(CIV_SHIRTS))];
    l.pants = CIV_PANTS[rnd_int(N(CIV_PANTS))];
    l.hat = CIV_SHIRTS[rnd_int(N(CIV_SHIRTS))]; l.hasHat = rnd() < 0.2f;
  }
  return l;
}

Actor *actor_spawn(int kind, int gang, V3 pos, float yaw) {
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (a->used) continue;
    T3DSkeleton skel = a->skel; // keep the skeleton (allocated once per slot)
    bool hadSkel = skel.bones != NULL;
    memset(a, 0, sizeof(*a));
    a->skel = skel;
    if (!hadSkel) a->skel = t3d_skeleton_create_buffered(g_models.human, FB_COUNT);
    if (!s_restKnown) { for (int b = 0; b < 11; b++) s_rest[b] = (V3){a->skel.bones[b].position.v[0], a->skel.bones[b].position.v[1], a->skel.bones[b].position.v[2]}; s_restKnown = true; }
    a->used = true; a->kind = kind; a->gang = gang; a->id = i;
    a->look = look_for(kind, gang);
    a->pos = pos; a->yaw = yaw;
    a->health = kind == AK_PLAYER ? 100 : kind == AK_COP ? 90 : kind == AK_GANG ? 70 : 45;
    a->state = ST_IDLE; a->onGround = true;
    a->weapon = W_FIST; a->weapons = 1 << W_FIST;
    a->target = -1; a->foe = -1; a->node = -1; a->prevNode = -1; a->followSlot = -1;
    a->peakY = pos.y;
    return a;
  }
  return NULL;
}

void actor_free(Actor *a) {
  if (!a) return;
  if (a->vehicle) vehicle_leave(a->vehicle, a, false);
  a->used = false;
}

void actor_set_state(Actor *a, int st) {
  if (a->state == st) return;
  a->state = st;
  a->stateTime = 0;
}

bool actor_can_act(const Actor *a) {
  switch (a->state) {
    case ST_IDLE: case ST_RUN: case ST_SKID: case ST_LAND: case ST_CROUCH: return true;
  }
  return false;
}

void actor_damage(Actor *a, float dmg, V3 dir, float force, Actor *by) {
  if (!actor_alive(a)) return;
  if (a->kind == AK_PLAYER && a->armor > 0) { float ab = minf(a->armor, dmg * 0.7f); a->armor -= ab; dmg -= ab; }
  a->health -= dmg;
  a->hurt = 0.35f;
  bool died = a->health <= 0;
  if (died) {
    a->health = 0;
    if (a->vehicle) vehicle_leave(a->vehicle, a, true);
    actor_set_state(a, ST_DEAD);
    a->vel = v3_scale(dir, minf(force, 8) * 0.6f);
    a->vel.y = force > 4 ? 4 : 1;
    a->onGround = false;
    a->flip = 0;
    a->despawnTimer = 25;
    sound_play(SND_HIT, a->pos);
  } else if (force > 6 && !a->vehicle) {
    actor_set_state(a, ST_KNOCKED);
    a->vel = v3_scale(dir, force);
    a->vel.y = 6 + force * 0.25f;
    a->speed = 0; a->onGround = false;
    sound_play(SND_HIT, a->pos);
  } else {
    sound_play(SND_PUNCH, a->pos);
  }
  if (g_on_actor_damaged) g_on_actor_damaged(a, by, dmg, died);
}

// ---- melee ----
static void melee(Actor *a, float reach, float radius, float dmg, float force) {
  V3 f = yaw_dir(a->yaw);
  V3 c = v3_add(a->pos, (V3){f.x * reach, 1.0f, f.z * reach});
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *o = &g.actors[i];
    if (o == a || !actor_alive(o) || o->vehicle) continue;
    V3 oc = actor_chest(o);
    if (v3_dist_xz(oc, c) < radius + RADIUS && fabsf(oc.y - 0.25f - c.y) < 1.2f) {
      V3 d = v3_norm((V3){oc.x - a->pos.x, 0, oc.z - a->pos.z});
      actor_damage(o, dmg, d, force, a);
      fx_burst(v3_lerp(c, oc, 0.5f), FX_DUST, 3);
    }
  }
  vehicle_melee(c, radius, dmg * 3, f, a);
}

// ---- movement ----
static void ground_move(Actor *a, Controls *c, float maxSpeed, float accel) {
  float mag = minf(1.0f, v3_len_xz(c->move));
  float target = mag * maxSpeed;
  if (mag > 0.05f) {
    float want = dir_yaw(c->move.x, c->move.z);
    float d = angle_diff(want, a->yaw);
    // a hard turn at speed: skid (a jump in a skid is a side flip)
    if (fabsf(d) > 2.5f && a->speed > 5.5f && a->state == ST_RUN) { actor_set_state(a, ST_SKID); return; }
    float rate = a->speed < 3 ? 14.0f : maxf(4.5f, 14.0f - a->speed * 1.05f);
    a->yaw = approach_angle(a->yaw, want, rate * DT);
    target *= maxf(0, cosf(d)) * 0.5f + 0.5f;
  }
  if (a->speed < target) a->speed = approach(a->speed, target, accel * DT);
  else a->speed = approach(a->speed, target, 26.0f * DT);
}

static void begin_jump(Actor *a, int type, float vy, float speed) {
  a->vel.y = vy; a->speed = speed; a->onGround = false;
  a->peakY = a->pos.y; a->shortHop = false; a->firedInAir = false;
  a->flip = 0; a->roll = 0;
  sound_play(SND_JUMP, a->pos);
  if (type) a->jumpType = type;
}

// a jump from the ground: the chain, a long jump, a backflip, a side flip
static void try_jump(Actor *a, Controls *c) {
  if (!c->jump) return;
  if (a->state == ST_SKID) { a->yaw = wrap_angle(a->yaw + PI); begin_jump(a, 1, FLIP_VY, 3.0f); actor_set_state(a, ST_SIDEFLIP); return; }
  if (a->state == ST_CROUCHSLIDE && a->speed > 3) { begin_jump(a, 1, LONGJUMP_VY, minf(LONGJUMP_MAX, a->speed * 1.5f + 2.0f)); actor_set_state(a, ST_LONGJUMP); return; }
  if (a->state == ST_CROUCH) { begin_jump(a, 1, FLIP_VY, -4.0f); actor_set_state(a, ST_BACKFLIP); return; }
  int t = 1;
  if (a->landTime < CHAIN_WINDOW) {
    if (a->jumpType == 1) t = 2;
    else if (a->jumpType == 2 && a->speed > 6.0f) t = 3;
  }
  begin_jump(a, t, t == 1 ? JUMP1_VY : t == 2 ? JUMP2_VY : JUMP3_VY, a->speed + (t == 3 ? 0.5f : 0));
  actor_set_state(a, ST_JUMP);
}

static void land(Actor *a) {
  float fall = a->peakY - a->pos.y;
  int prev = a->state;
  a->onGround = true; a->vel.y = 0;
  a->landTime = 0; a->flip = 0; a->roll = 0;
  if (prev == ST_GPFALL) {
    actor_set_state(a, ST_GPLAND);
    a->speed = 0;
    g_view.shake = a->kind == AK_PLAYER ? 1.0f : g_view.shake;
    // the shock knocks people down round the landing
    for (int i = 0; i < MAX_ACTORS; i++) {
      Actor *o = &g.actors[i];
      if (o == a || !actor_alive(o) || o->vehicle) continue;
      float d = v3_dist(o->pos, a->pos);
      if (d < 2.6f) actor_damage(o, 35, v3_norm(v3_sub(o->pos, a->pos)), 9, a);
    }
    fx_burst(a->pos, FX_DUST, 8);
    sound_play(SND_THUD, a->pos);
    return;
  }
  if (prev == ST_DIVE) { actor_set_state(a, ST_BELLYSLIDE); return; }
  if (prev == ST_KNOCKED) { actor_set_state(a, ST_DOWN); a->speed = 0; return; }
  if (prev == ST_DEAD) { a->speed = 0; return; }
  if (fall > 12.0f && a->kind == AK_PLAYER) {
    actor_damage(a, (fall - 10.0f) * 6.0f, (V3){0, 0, 0}, 0, NULL);
    if (!actor_alive(a)) return;
    actor_set_state(a, ST_DOWN); a->speed = 0; return;
  }
  if (prev == ST_LONGJUMP) a->speed *= 0.5f;
  if (prev == ST_BACKFLIP || prev == ST_SIDEFLIP) a->speed = 0;
  actor_set_state(a, a->speed > 0.5f ? ST_RUN : ST_LAND);
  if (fall > 1.5f) fx_burst(a->pos, FX_DUST, 2);
}

static void air_control(Actor *a, Controls *c, float turn, float accel, float maxSpeed) {
  float mag = minf(1.0f, v3_len_xz(c->move));
  if (mag > 0.05f) {
    float want = dir_yaw(c->move.x, c->move.z);
    float d = angle_diff(want, a->yaw);
    a->yaw = approach_angle(a->yaw, want, turn * DT);
    a->speed += cosf(d) * mag * accel * DT;
  } else a->speed = approach(a->speed, 0, 1.5f * DT);
  a->speed = clampf(a->speed, -6, maxSpeed);
}

static void physics(Actor *a) {
  V3 old = a->pos;
  // horizontal: along the facing (or strafing while aiming, set by the caller in vel)
  bool strafe = a->ctl.aim && a->onGround && a->state <= ST_LAND;
  if (!strafe && a->state != ST_DEAD && a->state != ST_KNOCKED) { V3 f = yaw_dir(a->yaw); a->vel.x = f.x * a->speed; a->vel.z = f.z * a->speed; }
  a->pos.x += a->vel.x * DT; a->pos.z += a->vel.z * DT;
  // walls (people and the dead: only what is higher than a step)
  float feet = a->pos.y;
  V3 n = world_push(&a->pos.x, &a->pos.z, RADIUS, feet + STEP_UP, feet + HEIGHT * a->look.height);
  a->wallNormal = n;
  if (n.x != 0 || n.z != 0) {
    float into = -(a->vel.x * n.x + a->vel.z * n.z);
    if (into > 0) {
      if (!a->onGround && into > 3.5f && (a->state == ST_JUMP || a->state == ST_FALL || a->state == ST_WALLKICK || a->state == ST_LONGJUMP || a->state == ST_SIDEFLIP || a->state == ST_BACKFLIP)) {
        actor_set_state(a, ST_WALLHIT);
        a->speed = 0;
      } else if (a->onGround) a->speed *= maxf(0.25f, 1.0f - into / maxf(0.1f, fabsf(a->speed)) * 0.6f);
      else a->speed *= 0.5f;
    }
  }
  // vertical
  if (a->onGround) {
    float fl = world_floor(a->pos.x, a->pos.z, a->pos.y + STEP_UP, NULL);
    if (fl < a->pos.y - 0.6f) {
      // walked off a ledge
      a->onGround = false; a->vel.y = 0; a->peakY = a->pos.y;
      if (a->state != ST_DEAD && a->state != ST_BELLYSLIDE) actor_set_state(a, ST_FALL);
    } else a->pos.y = fl;
  } else {
    a->vel.y = maxf(TERMINAL * (a->state == ST_GPFALL ? 1.2f : 1.0f), a->vel.y - GRAVITY * DT);
    float y0 = a->pos.y;
    a->pos.y += a->vel.y * DT;
    if (a->pos.y > a->peakY) a->peakY = a->pos.y;
    if (a->vel.y > 0) {
      float ceil = world_ceiling(a->pos.x, a->pos.z, y0 + HEIGHT * 0.9f);
      if (a->pos.y + HEIGHT > ceil) { a->pos.y = ceil - HEIGHT; a->vel.y = 0; }
    }
    float fl = world_floor(a->pos.x, a->pos.z, maxf(y0, a->pos.y) + 0.05f, NULL);
    if (a->pos.y <= fl && a->vel.y <= 0) { a->pos.y = fl; land(a); }
  }
  // water: swim at the surface
  if (a->pos.y < WATER_Y - 1.1f && a->state != ST_VEHICLE) {
    float fl = world_floor(a->pos.x, a->pos.z, a->pos.y + STEP_UP, NULL);
    if (fl < WATER_Y - 1.0f) {
      if (a->state != ST_SWIM && a->state != ST_DEAD) { fx_burst((V3){a->pos.x, WATER_Y, a->pos.z}, FX_SPLASH, 6); sound_play(SND_SPLASH, a->pos); }
      if (a->state != ST_DEAD) actor_set_state(a, ST_SWIM);
      a->pos.y = WATER_Y - 1.25f; a->vel.y = 0; a->onGround = true;
    }
  }
  // the world's edge
  a->pos.x = clampf(a->pos.x, -700, 700); a->pos.z = clampf(a->pos.z, -700, 760);
  (void)old;
}

void actor_step(Actor *a) {
  Controls *c = &a->ctl;
  a->stateTime += DT;
  a->landTime += DT;
  if (a->hurt > 0) a->hurt -= DT;
  if (a->state == ST_VEHICLE) { a->onGround = true; return; } // the vehicle moves us
  if (a->state == ST_ENTER || a->state == ST_EXIT) { vehicle_board_step(a); return; }

  bool hasGun = weapon_is_gun(a->weapon);
  switch (a->state) {
    case ST_IDLE: case ST_RUN: case ST_LAND: {
      if (a->state == ST_LAND && a->stateTime > 0.1f) actor_set_state(a, ST_IDLE);
      float maxS = c->walk ? WALK_SPEED : RUN_SPEED * (c->sprint ? 1.0f : 1.0f);
      if (c->aim && hasGun) {
        // strafing: face what is aimed at, move where the stick says, slowly
        V3 to = v3_sub(c->aimAt, a->pos);
        a->yaw = approach_angle(a->yaw, dir_yaw(to.x, to.z), 12 * DT);
        V3 mv = v3_scale(c->move, 3.2f);
        a->vel.x = lerpf(a->vel.x, mv.x, 0.4f); a->vel.z = lerpf(a->vel.z, mv.z, 0.4f);
        a->speed = 0;
        if (c->jump) { begin_jump(a, 1, JUMP1_VY, 0); actor_set_state(a, ST_JUMP); }
        break;
      }
      if (c->face && v3_len_xz(c->move) < 0.05f) a->yaw = approach_angle(a->yaw, c->faceYaw, 8 * DT);
      ground_move(a, c, maxS, 16.0f + (a->speed < 4 ? 14.0f : 0));
      if (a->state == ST_SKID) break;
      if (a->state != ST_LAND) actor_set_state(a, a->speed > 0.3f || v3_len_xz(c->move) > 0.05f ? ST_RUN : ST_IDLE);
      if (c->crouchPressed || (c->crouch && a->speed < 1)) { actor_set_state(a, a->speed > 3 ? ST_CROUCHSLIDE : ST_CROUCH); break; }
      if (c->attack && !hasGun) {
        if (a->speed > 6.5f) { begin_jump(a, 0, 4.0f, minf(a->speed + 4.5f, 14.4f)); actor_set_state(a, ST_DIVE); }
        else { actor_set_state(a, ST_PUNCH); a->combo = 0; a->hitTimer = 0.12f; sound_play(SND_SWING, a->pos); }
        break;
      }
      try_jump(a, c);
      break;
    }
    case ST_SKID:
      a->speed = approach(a->speed, 0, 34.0f * DT);
      if (c->jump) { try_jump(a, c); break; }
      if (a->speed < 0.5f) { a->yaw = wrap_angle(a->yaw + PI); actor_set_state(a, ST_RUN); }
      break;
    case ST_CROUCH:
      a->speed = approach(a->speed, 0, 30.0f * DT);
      if (c->jump) { try_jump(a, c); break; }
      if (!c->crouch) actor_set_state(a, ST_IDLE);
      break;
    case ST_CROUCHSLIDE:
      a->speed = approach(a->speed, 0, 10.0f * DT);
      if (c->jump) { try_jump(a, c); break; }
      if (!c->crouch || a->speed < 1.0f) actor_set_state(a, c->crouch ? ST_CROUCH : ST_RUN);
      break;
    case ST_PUNCH: {
      a->speed = approach(a->speed, 0, 30.0f * DT);
      float len = a->combo == 2 ? 0.38f : 0.24f;
      if (a->hitTimer > 0) {
        a->hitTimer -= DT;
        if (a->hitTimer <= 0) melee(a, 0.75f, 0.65f, a->combo == 2 ? 22 : 11, a->combo == 2 ? 8 : 3);
      }
      if (c->attack && a->stateTime > 0.08f && a->combo < 2) { a->combo++; a->stateTime = 0; a->hitTimer = 0.1f; sound_play(SND_SWING, a->pos); }
      else if (a->stateTime > len) actor_set_state(a, ST_IDLE);
      break;
    }
    case ST_GPLAND:
      if (a->stateTime > 0.3f) actor_set_state(a, ST_IDLE);
      if (c->jump && a->stateTime > 0.1f) { begin_jump(a, 1, JUMP2_VY, 0); actor_set_state(a, ST_JUMP); } // a jump out of the pound
      break;
    case ST_BELLYSLIDE:
      a->speed = approach(a->speed, 0, 12.0f * DT);
      if ((c->jump || c->attack) && a->stateTime > 0.1f) { begin_jump(a, 1, 10.0f, a->speed * 0.6f + 2); actor_set_state(a, ST_JUMP); break; } // the roll-out
      if (a->speed < 0.3f && a->stateTime > 0.5f) actor_set_state(a, ST_IDLE);
      break;
    case ST_JUMP: case ST_LONGJUMP: case ST_BACKFLIP: case ST_SIDEFLIP: case ST_FALL: case ST_WALLKICK: case ST_AIRKICK: {
      // variable height: letting go of jump early cuts the rise
      if ((a->state == ST_JUMP && a->jumpType < 3) && !c->jumpHeld && !a->shortHop && a->vel.y > 6) { a->vel.y *= 0.4f; a->shortHop = true; }
      if (a->state == ST_LONGJUMP) air_control(a, c, 1.2f, 3.0f, LONGJUMP_MAX);
      else air_control(a, c, a->state == ST_BACKFLIP ? 0.6f : 2.6f, 7.0f, 11.0f);
      if (c->crouchPressed && a->state != ST_LONGJUMP) { actor_set_state(a, ST_GPSPIN); a->vel.y = 0; a->speed = 0; break; }
      if (c->attack && !hasGun && a->state != ST_AIRKICK) {
        if (a->speed > 4) { a->vel.y = 4; a->speed = minf(a->speed + 4.5f, 14.4f); actor_set_state(a, ST_DIVE); }
        else { actor_set_state(a, ST_AIRKICK); a->hitTimer = 0.08f; sound_play(SND_SWING, a->pos); }
      }
      if (a->state == ST_AIRKICK && a->hitTimer > 0) { a->hitTimer -= DT; if (a->hitTimer <= 0) melee(a, 0.6f, 0.7f, 18, 7); }
      // flips: the body turns through a full circle
      if (a->state == ST_JUMP && a->jumpType == 3) a->flip = minf(TAU, a->stateTime * 9.5f);
      if (a->state == ST_BACKFLIP) a->flip = -minf(TAU, a->stateTime * 8.5f);
      if (a->state == ST_SIDEFLIP) a->roll = minf(TAU, a->stateTime * 8.5f);
      break;
    }
    case ST_WALLHIT:
      // a moment against the wall: jump now for a wall kick, else slide off it
      a->vel.y = maxf(a->vel.y, -4.0f);
      if (c->jump && a->stateTime < 0.22f) {
        V3 n = a->wallNormal;
        if (n.x == 0 && n.z == 0) n = v3_scale(yaw_dir(a->yaw), -1);
        a->yaw = dir_yaw(n.x, n.z);
        begin_jump(a, 1, WALLKICK_VY, WALLKICK_SPEED);
        actor_set_state(a, ST_WALLKICK);
      } else if (a->stateTime > 0.22f) { a->yaw = wrap_angle(a->yaw + PI); a->speed = 1.5f; actor_set_state(a, ST_FALL); }
      break;
    case ST_GPSPIN:
      a->vel.y = 0; a->speed = 0;
      a->flip = a->stateTime * (TAU / 0.25f);
      if (a->stateTime > 0.25f) { a->flip = 0; actor_set_state(a, ST_GPFALL); a->vel.y = GP_VY; }
      break;
    case ST_GPFALL:
      a->speed = 0; a->vel.y = minf(a->vel.y, GP_VY);
      break;
    case ST_DIVE:
      a->flip = minf(1.45f, a->stateTime * 6);
      air_control(a, c, 1.0f, 1.0f, 14.4f);
      break;
    case ST_KNOCKED:
      a->flip -= 8 * DT;
      break;
    case ST_DOWN:
      a->vel.x *= 0.8f; a->vel.z *= 0.8f;
      if (a->stateTime > 1.3f) actor_set_state(a, ST_GETUP);
      break;
    case ST_GETUP:
      if (a->stateTime > 0.45f) actor_set_state(a, ST_IDLE);
      break;
    case ST_DEAD:
      a->vel.x *= 0.9f; a->vel.z *= 0.9f;
      if (a->onGround) { a->vel.x = a->vel.z = 0; }
      a->despawnTimer -= DT;
      break;
    case ST_SWIM: {
      float want = 3.0f * minf(1, v3_len_xz(c->move));
      if (v3_len_xz(c->move) > 0.05f) a->yaw = approach_angle(a->yaw, dir_yaw(c->move.x, c->move.z), 3 * DT);
      a->speed = approach(a->speed, want * (c->jumpHeld ? 1.6f : 1.0f), 6 * DT);
      // climb out where the ground comes up
      float fl = world_floor(a->pos.x + yaw_dir(a->yaw).x * 0.8f, a->pos.z + yaw_dir(a->yaw).z * 0.8f, WATER_Y + 1.2f, NULL);
      if (fl > WATER_Y - 1.05f) { a->pos.y = maxf(a->pos.y, fl); a->onGround = true; actor_set_state(a, ST_RUN); break; }
      a->peakY = a->pos.y;
      break;
    }
  }
  if (ST_IS_AIR(a->state) && a->onGround && a->state != ST_KNOCKED) a->onGround = false;
  // in states that do not move horizontally on their own, let physics run anyway (falls, slides)
  if (a->state == ST_DEAD || a->state == ST_KNOCKED) {
    a->pos.x += 0; // (vel set by damage)
  }
  if (a->state != ST_DEAD && a->state != ST_KNOCKED) physics(a);
  else {
    // ragdoll-ish: just fall with the velocity we were given
    a->pos.x += a->vel.x * DT; a->pos.z += a->vel.z * DT;
    world_push(&a->pos.x, &a->pos.z, RADIUS, a->pos.y + STEP_UP, a->pos.y + 1.0f);
    float fl = world_floor(a->pos.x, a->pos.z, a->pos.y + STEP_UP, NULL);
    if (!a->onGround) {
      a->vel.y -= GRAVITY * DT; a->pos.y += a->vel.y * DT;
      if (a->pos.y <= fl) { a->pos.y = fl; if (a->state == ST_KNOCKED) land(a); else { a->onGround = true; a->vel.x = a->vel.z = 0; } }
    } else if (fl < a->pos.y - 0.6f) a->onGround = false; else a->pos.y = fl;
    if (a->pos.y < WATER_Y - 1.5f) a->pos.y = WATER_Y - 1.5f;
  }
  weapon_step(a);
}

// ---- poses ----
enum { B_HIPS, B_TORSO, B_HEAD, B_ARM_L, B_FORE_L, B_ARM_R, B_FORE_R, B_LEG_L, B_SHIN_L, B_LEG_R, B_SHIN_R };
typedef struct { float x[11], y[11], z[11]; float hipY; } Pose;

static void pose_run(Pose *p, Actor *a) {
  float amp = clampf(a->speed / RUN_SPEED, 0.15f, 1.0f) * 0.85f;
  if (a->speed < 0.2f) amp = 0;
  float ph = a->animPhase;
  float s = sinf(ph), co = cosf(ph);
  p->x[B_LEG_L] = -s * amp; p->x[B_LEG_R] = s * amp;
  p->x[B_SHIN_L] = maxf(0, co) * amp * 1.3f + 0.05f; p->x[B_SHIN_R] = maxf(0, -co) * amp * 1.3f + 0.05f;
  p->x[B_ARM_L] = s * amp * 0.9f; p->x[B_ARM_R] = -s * amp * 0.9f;
  p->x[B_FORE_L] = -0.3f - amp * 0.7f; p->x[B_FORE_R] = -0.3f - amp * 0.7f;
  p->z[B_ARM_L] = 0.08f; p->z[B_ARM_R] = -0.08f;
  p->x[B_TORSO] = 0.05f + amp * 0.22f; p->x[B_HEAD] = -amp * 0.15f;
  p->hipY = -fabsf(s) * 0.05f * amp;
}

static void pose_of(Actor *a, Pose *p) {
  memset(p, 0, sizeof(*p));
  float t = a->stateTime;
  switch (a->state) {
    case ST_IDLE: case ST_LAND: case ST_GETUP: default:
      p->x[B_TORSO] = 0.02f * sinf(g.time * 2); p->z[B_ARM_L] = 0.1f; p->z[B_ARM_R] = -0.1f;
      p->x[B_FORE_L] = p->x[B_FORE_R] = -0.15f;
      if (a->state == ST_LAND) { p->hipY = -0.12f; p->x[B_LEG_L] = p->x[B_LEG_R] = -0.4f; p->x[B_SHIN_L] = p->x[B_SHIN_R] = 0.8f; p->x[B_TORSO] = 0.25f; }
      break;
    case ST_RUN: case ST_ENTER: case ST_EXIT: pose_run(p, a); break;
    case ST_SKID:
      p->x[B_TORSO] = -0.35f; p->x[B_LEG_L] = -0.7f; p->x[B_SHIN_L] = 0.1f; p->x[B_LEG_R] = 0.2f; p->x[B_SHIN_R] = 0.6f;
      p->x[B_ARM_L] = -1.2f; p->x[B_ARM_R] = -1.0f; p->z[B_ARM_L] = 0.6f; p->z[B_ARM_R] = -0.6f; p->hipY = -0.15f;
      break;
    case ST_CROUCH: case ST_CROUCHSLIDE:
      p->hipY = -0.38f; p->x[B_LEG_L] = p->x[B_LEG_R] = -1.25f; p->x[B_SHIN_L] = p->x[B_SHIN_R] = 1.9f;
      p->x[B_TORSO] = 0.5f; p->x[B_HEAD] = -0.4f; p->x[B_ARM_L] = p->x[B_ARM_R] = -0.6f; p->x[B_FORE_L] = p->x[B_FORE_R] = -0.6f;
      break;
    case ST_PUNCH:
      if (a->combo == 2) { p->x[B_LEG_R] = -1.5f; p->x[B_SHIN_R] = 0.1f; p->x[B_TORSO] = -0.25f; p->x[B_ARM_L] = -0.6f; p->x[B_ARM_R] = 0.4f; p->z[B_ARM_L] = 0.5f; }
      else {
        int r = a->combo == 0;
        float ext = minf(1, t / 0.08f);
        p->x[r ? B_ARM_R : B_ARM_L] = -1.55f * ext; p->x[r ? B_FORE_R : B_FORE_L] = -0.2f * ext;
        p->x[r ? B_ARM_L : B_ARM_R] = -0.9f; p->x[r ? B_FORE_L : B_FORE_R] = -1.5f;
        p->y[B_TORSO] = r ? -0.35f : 0.35f; p->x[B_LEG_L] = -0.3f; p->x[B_LEG_R] = 0.2f;
      }
      break;
    case ST_JUMP: case ST_WALLKICK:
      if (a->jumpType == 3 && a->state == ST_JUMP) {
        p->x[B_LEG_L] = p->x[B_LEG_R] = -1.4f; p->x[B_SHIN_L] = p->x[B_SHIN_R] = 2.0f; p->x[B_ARM_L] = p->x[B_ARM_R] = -1.6f; p->x[B_FORE_L] = p->x[B_FORE_R] = -1.2f; p->x[B_TORSO] = 0.5f;
      } else if (a->jumpType == 2) {
        p->x[B_LEG_L] = -0.9f; p->x[B_SHIN_L] = 1.4f; p->x[B_LEG_R] = 0.3f; p->x[B_SHIN_R] = 0.7f;
        p->x[B_ARM_L] = p->x[B_ARM_R] = -2.9f; p->z[B_ARM_L] = 0.3f; p->z[B_ARM_R] = -0.3f;
      } else {
        p->x[B_LEG_L] = -0.7f; p->x[B_SHIN_L] = 1.1f; p->x[B_LEG_R] = 0.25f; p->x[B_SHIN_R] = 0.5f;
        p->x[B_ARM_L] = 0.4f; p->x[B_ARM_R] = -2.4f; p->z[B_ARM_L] = 0.4f;
      }
      if (a->vel.y < 0 && a->jumpType != 3) { p->z[B_ARM_L] += 0.6f; p->z[B_ARM_R] -= 0.6f; }
      break;
    case ST_LONGJUMP:
      p->x[B_ARM_L] = p->x[B_ARM_R] = -2.8f; p->x[B_LEG_L] = 0.5f; p->x[B_LEG_R] = 0.3f; p->x[B_SHIN_L] = 0.6f; p->x[B_SHIN_R] = 0.9f; p->x[B_TORSO] = 0.6f; p->x[B_HEAD] = -0.6f;
      break;
    case ST_BACKFLIP: case ST_SIDEFLIP: case ST_GPSPIN: case ST_GPFALL: case ST_GPLAND:
      p->x[B_LEG_L] = p->x[B_LEG_R] = -1.5f; p->x[B_SHIN_L] = p->x[B_SHIN_R] = 2.1f;
      p->x[B_ARM_L] = p->x[B_ARM_R] = -0.8f; p->x[B_FORE_L] = p->x[B_FORE_R] = -1.4f; p->x[B_TORSO] = 0.45f;
      if (a->state == ST_GPFALL || a->state == ST_GPLAND) { p->x[B_ARM_L] = p->x[B_ARM_R] = 0.3f; p->z[B_ARM_L] = 0.9f; p->z[B_ARM_R] = -0.9f; }
      if (a->state == ST_GPLAND) p->hipY = -0.45f;
      break;
    case ST_FALL: case ST_WALLHIT:
      p->x[B_ARM_L] = -2.2f + sinf(g.time * 14) * 0.4f; p->x[B_ARM_R] = -2.2f - sinf(g.time * 14) * 0.4f;
      p->z[B_ARM_L] = 0.7f; p->z[B_ARM_R] = -0.7f; p->x[B_LEG_L] = -0.5f; p->x[B_SHIN_L] = 0.9f; p->x[B_LEG_R] = 0.1f; p->x[B_SHIN_R] = 0.4f;
      if (a->state == ST_WALLHIT) { p->x[B_TORSO] = -0.3f; p->x[B_ARM_L] = p->x[B_ARM_R] = -1.6f; p->z[B_ARM_L] = 1.4f; p->z[B_ARM_R] = -1.4f; }
      break;
    case ST_AIRKICK:
      p->x[B_LEG_R] = -1.6f; p->x[B_LEG_L] = 0.5f; p->x[B_SHIN_L] = 1.4f; p->x[B_ARM_L] = -0.4f; p->x[B_ARM_R] = 0.6f; p->z[B_ARM_L] = 0.8f; p->z[B_ARM_R] = -0.8f; p->x[B_TORSO] = -0.2f;
      break;
    case ST_DIVE: case ST_BELLYSLIDE:
      p->x[B_ARM_L] = p->x[B_ARM_R] = -3.0f; p->x[B_LEG_L] = 0.15f; p->x[B_LEG_R] = 0.1f; p->x[B_HEAD] = -1.0f;
      if (a->state == ST_BELLYSLIDE) p->x[B_SHIN_L] = p->x[B_SHIN_R] = 0.7f;
      break;
    case ST_KNOCKED: case ST_DOWN: case ST_DEAD:
      p->x[B_ARM_L] = -1.2f; p->x[B_ARM_R] = -1.0f; p->z[B_ARM_L] = 1.3f; p->z[B_ARM_R] = -1.2f;
      p->x[B_LEG_L] = -0.3f; p->x[B_LEG_R] = 0.1f; p->x[B_SHIN_L] = 0.4f; p->z[B_LEG_L] = 0.15f; p->z[B_LEG_R] = -0.15f;
      break;
    case ST_SWIM: {
      float s = sinf(g.time * 5);
      p->x[B_ARM_L] = p->x[B_ARM_R] = -2.4f + s * 0.4f; p->z[B_ARM_L] = 0.8f + s * 0.6f; p->z[B_ARM_R] = -0.8f - s * 0.6f;
      p->x[B_LEG_L] = s * 0.4f; p->x[B_LEG_R] = -s * 0.4f; p->x[B_HEAD] = -1.0f;
      break;
    }
    case ST_VEHICLE: {
      bool bike = a->vehicle && vehicle_is_bike(a->vehicle);
      p->x[B_LEG_L] = p->x[B_LEG_R] = bike ? -1.2f : -1.5f; p->x[B_SHIN_L] = p->x[B_SHIN_R] = bike ? 1.0f : 1.4f;
      p->z[B_LEG_L] = bike ? 0.15f : 0; p->z[B_LEG_R] = bike ? -0.15f : 0;
      p->x[B_ARM_L] = p->x[B_ARM_R] = -1.15f; p->x[B_FORE_L] = p->x[B_FORE_R] = -0.25f; p->x[B_TORSO] = bike ? 0.45f : 0;
      float st = a->vehicle ? a->vehicle->steer : 0;
      p->y[B_TORSO] = st * 0.15f;
      break;
    }
  }
  // holding a gun: the arms point at what is aimed at (or hold it low)
  if (weapon_is_gun(a->weapon) && a->state != ST_DEAD && a->state != ST_KNOCKED && a->state != ST_DOWN && a->state != ST_SWIM && !(a->state >= ST_DIVE && a->state <= ST_BELLYSLIDE) && a->state != ST_PUNCH) {
    bool aiming = a->ctl.aim || a->fireTimer > 0 || a->muzzle > 0;
    if (a->state == ST_VEHICLE && !aiming) return;
    float up = 0;
    if (aiming) { V3 to = v3_sub(a->ctl.aimAt, actor_chest(a)); up = atan2f(to.y, maxf(0.5f, v3_len_xz(to))); }
    bool two = weapon_two_handed(a->weapon);
    if (aiming) {
      p->x[B_ARM_R] = -PI / 2 - up; p->x[B_FORE_R] = 0; p->z[B_ARM_R] = 0.05f;
      if (two) { p->x[B_ARM_L] = -PI / 2 - up * 0.9f + 0.15f; p->x[B_FORE_L] = -0.35f; p->z[B_ARM_L] = -0.55f; }
      if (a->muzzle > 0) p->x[B_ARM_R] += 0.2f; // the kick
    } else if (!ST_IS_AIR(a->state)) {
      p->x[B_ARM_R] = -0.35f; p->x[B_FORE_R] = -0.9f;
      if (two) { p->x[B_ARM_L] = -0.6f; p->x[B_FORE_L] = -1.1f; p->z[B_ARM_L] = -0.4f; }
    }
  }
}

static void apply_pose(Actor *a, const Pose *p) {
  T3DSkeleton *s = &a->skel;
  for (int i = 0; i < 11; i++) {
    Quat q = quat_euler(p->x[i], p->y[i], p->z[i]);
    s->bones[i].rotation = (T3DQuat){{q.x, q.y, q.z, q.w}};
    s->bones[i].hasChanged = true;
  }
  s->bones[B_HIPS].position.v[1] = s_rest[B_HIPS].y + p->hipY * 64.0f;
  t3d_skeleton_update(s);
}

static void draw_shadow(V3 pos, float size) {
  float fl = world_floor(pos.x, pos.z, pos.y + 0.3f, NULL);
  if (pos.y - fl > 12) return;
  T3DMat4 m;
  mat_place(&m, (V3){pos.x, fl + 0.04f, pos.z}, 0, 0, 0, 0, size * MODEL_SCALE);
  render_colored(g_models.shadow, &m, RGBA32(0, 0, 0, 255));
}

void actor_draw(Actor *a) {
  if (!a->used) return;
  if (a->state == ST_VEHICLE && a->vehicle && !vehicle_shows_rider(a->vehicle)) return;
  // distance and view culling
  float d2 = v3_dist2_xz(a->pos, g_view.eye);
  if (d2 > 120.0f * 120.0f) return;
  T3DVec3 c = {{a->pos.x, a->pos.y + 0.9f, a->pos.z}};
  if (!t3d_frustum_vs_sphere(&g_view.frustum, &c, 1.4f)) return;

  // the walk cycle advances with the distance covered
  float sp = v3_len_xz(a->vel);
  a->animPhase += sp * DT * 1.15f + (a->state == ST_RUN && sp < 0.3f ? 0 : 0);
  Pose p; pose_of(a, &p);
  apply_pose(a, &p);

  // the body: flips and dives turn it round its middle; lying states put it down on the ground
  float pivot = 0.9f * a->look.height, flip = a->flip, roll = a->roll, dy = 0;
  if (a->state == ST_DOWN || a->state == ST_DEAD || (a->state == ST_KNOCKED && a->onGround)) { flip = -1.5f; dy = -0.72f; }
  if (a->state == ST_DEAD && !a->onGround) flip = -1.5f * minf(1, a->stateTime * 3);
  if (a->state == ST_GETUP) { flip = -1.5f * (1 - a->stateTime / 0.45f); dy = -0.72f * (1 - a->stateTime / 0.45f); }
  if (a->state == ST_BELLYSLIDE) { flip = 1.45f; dy = -0.7f; }
  if (a->state == ST_SWIM) { flip = 1.2f; dy = 0.2f; }
  V3 pos = a->pos; pos.y += dy;
  T3DMat4 m;
  if (a->state == ST_VEHICLE && a->vehicle) vehicle_rider_matrix(a->vehicle, a, &m);
  else mat_place(&m, pos, a->yaw, flip, roll, pivot, MODEL_SCALE * a->look.height);

  render_light_lit();
  Tints t = {0};
  bool flash = a->hurt > 0 && ((int)(a->hurt * 20) & 1);
  t.c[TINT_SKIN] = flash ? RGBA32(255, 90, 90, 255) : a->look.skin;
  t.c[TINT_SHIRT] = a->look.shirt; t.c[TINT_PANTS] = a->look.pants; t.c[TINT_SHOES] = a->look.shoes;
  t.c[TINT_HAIR] = a->look.hair; t.c[TINT_HAT] = a->look.hat;
  if (!a->look.hasHat) t.hide |= 1 << TINT_HAT;
  render_skinned(g_models.human, &a->skel, &m, &t);

  // the weapon in the right hand
  if (a->weapon != W_FIST && g_models.weapon[a->weapon] && a->state != ST_SWIM) {
    T3DMat4x3 *bm = &a->skel.bones[B_FORE_R].matrix;
    T3DMat4 b4;
    for (int col = 0; col < 4; col++) { for (int r = 0; r < 3; r++) b4.m[col][r] = bm->m[col][r]; b4.m[col][3] = col == 3 ? 1 : 0; }
    T3DMat4 hand, w, out;
    // the grip in the fist (0.31 m down the forearm), the barrel along it
    mat_place(&hand, (V3){0, -0.31f * 64, 0.02f * 64}, 0, PI / 2, 0, 0, 1.0f);
    if (a->weapon == W_LAUNCHER) { T3DMat4 r; mat_place(&r, (V3){0, 0, 0}, 0, PI / 2, 0, 0, 1); mat_mul(&hand, &hand, &r); }
    if (a->weapon == W_BAT) mat_place(&hand, (V3){0, -0.31f * 64, 0.02f * 64}, 0, PI, 0, 0, 1.0f);
    mat_mul(&w, &b4, &hand);
    mat_mul(&out, &m, &w);
    render_model(g_models.weapon[a->weapon], &out);
    if (a->muzzle > 0) {
      T3DMat4 fl, fo;
      mat_place(&fl, (V3){0, 0.1f * 64, weapon_muzzle_z(a->weapon) * 64}, 0, 0, 0, 0, 0.8f + rnd() * 0.5f);
      mat_mul(&fo, &out, &fl);
      render_colored(g_models.fxFlash, &fo, RGBA32(255, 220, 120, 255));
    }
  }
  if (a->state != ST_VEHICLE && a->state != ST_SWIM) draw_shadow(a->pos, a->state == ST_DEAD || a->state == ST_DOWN ? 0.9f : 0.5f);
}
