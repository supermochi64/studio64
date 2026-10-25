// People's bodies: movement (a 3D platformer's whole move set, our own implementation), collision,
// damage, voices, the animation (poses blended per bone, squash and stretch) and drawing.
#include "actor.h"
#include "world.h"
#include "weapon.h"
#include "vehicle.h"
#include "fx.h"
#include "sound.h"

// ---- tuning (meters, seconds) ----
#define RUN_SPEED 9.6f      // (the platformer's 32 units a frame)
#define WALK_SPEED 2.3f
#define CHAIN_WINDOW 0.3f    // the landing plus a few frames: when a jump chains into the next
#define STEP_UP 0.45f
#define RADIUS 0.33f
#define HEIGHT 1.75f
#define HANG_Y 1.68f       // how far below a ledge the feet hang

void (*g_on_actor_damaged)(Actor *a, Actor *by, float dmg, bool died);

static V3 s_rest[NBONES];
static bool s_restKnown;

int actor_index(const Actor *a) { return a ? (int)(a - g.actors) : -1; }

// ---- voices ----
static void say(Actor *a, int vo) {
  if (a->kind != AK_PLAYER && a->sayTimer > 0) return;
  a->sayTimer = a->kind == AK_PLAYER ? 0 : 2.5f;
  sound_voice(vo, actor_head(a), a->look.voice);
}

// ---- looks and the palette ----
static const color_t SKINS[] = {{0xf1, 0xc8, 0xa0, 255}, {0xe0, 0xac, 0x7c, 255}, {0xc0, 0x86, 0x58, 255}, {0x96, 0x60, 0x3c, 255}, {0x70, 0x46, 0x2a, 255}, {0x52, 0x34, 0x22, 255}, {0xf4, 0xd4, 0xb4, 255}};
static const color_t HAIRS[] = {{24, 18, 14, 255}, {54, 36, 22, 255}, {110, 72, 36, 255}, {196, 160, 90, 255}, {14, 14, 16, 255}, {150, 150, 150, 255}, {150, 60, 30, 255}};
static const color_t CIV_SHIRTS[] = {{214, 60, 52, 255}, {60, 104, 190, 255}, {236, 236, 236, 255}, {246, 204, 60, 255}, {90, 170, 170, 255}, {190, 120, 210, 255}, {244, 140, 60, 255}, {120, 120, 124, 255}, {255, 160, 180, 255}, {40, 40, 50, 255}, {120, 200, 90, 255}, {250, 230, 200, 255}};
static const color_t CIV_PANTS[] = {{50, 64, 110, 255}, {40, 40, 44, 255}, {160, 136, 100, 255}, {96, 72, 50, 255}, {210, 206, 196, 255}, {72, 96, 64, 255}, {120, 40, 50, 255}};
static const color_t SHOES[] = {{245, 245, 245, 255}, {30, 30, 30, 255}, {150, 40, 40, 255}, {60, 90, 160, 255}, {120, 80, 50, 255}};
static const color_t GANG_COL[GANG_COUNT] = {{0, 0, 0, 255}, {46, 160, 64, 255}, {136, 62, 170, 255}, {232, 188, 40, 255}, {40, 62, 130, 255}};
#define N(a) (int)(sizeof(a) / sizeof(a[0]))

Look look_for(int kind, int gang) {
  Look l = {0};
  l.skin = SKINS[rnd_int(N(SKINS))];
  l.hair = HAIRS[rnd_int(N(HAIRS))];
  l.shoes = SHOES[rnd_int(N(SHOES))];
  l.height = rnd_range(0.93f, 1.07f);
  l.width = rnd_range(0.92f, 1.12f);
  l.hairStyle = rnd_int(4);
  l.beard = rnd() < 0.25f;
  l.glasses = rnd() < 0.12f;
  l.voice = rnd_range(0.85f, 1.25f);
  l.shirt2 = RGBA32(250, 250, 250, 255);
  if (kind == AK_PLAYER) {
    // the hero: the crew's green cap with its palm, a white tank top with a green number, jeans
    l.skin = SKINS[4]; l.hair = HAIRS[4];
    l.shirt = RGBA32(246, 246, 240, 255); l.shirt2 = RGBA32(46, 160, 64, 255);
    l.pants = RGBA32(58, 90, 150, 255); l.shoes = RGBA32(250, 250, 250, 255);
    l.hat = RGBA32(46, 160, 64, 255); l.hasHat = true; l.beard = true; l.glasses = false; l.hairStyle = 0;
    l.height = 1.0f; l.width = 1.0f; l.voice = 1.0f;
  } else if (kind == AK_COP) {
    l.shirt = RGBA32(44, 66, 130, 255); l.pants = RGBA32(30, 36, 64, 255); l.shoes = RGBA32(20, 20, 20, 255);
    l.hat = RGBA32(30, 40, 84, 255); l.hasHat = true; l.shirt2 = RGBA32(230, 200, 60, 255); l.glasses = rnd() < 0.4f;
  } else if (kind == AK_GANG) {
    color_t c = GANG_COL[gang];
    float f = rnd_range(0.8f, 1.1f);
    color_t tone = RGBA32((uint8_t)minf(255, c.r * f), (uint8_t)minf(255, c.g * f), (uint8_t)minf(255, c.b * f), 255);
    bool white = rnd() < 0.35f;
    l.shirt = white ? RGBA32(236, 236, 236, 255) : tone;
    l.shirt2 = white ? tone : RGBA32(250, 250, 250, 255);
    l.pants = rnd() < 0.5f ? RGBA32(40, 40, 48, 255) : RGBA32(64, 86, 130, 255);
    l.hat = c; l.hasHat = white || rnd() < 0.55f;
    l.width = rnd_range(1.0f, 1.18f);
  } else {
    l.shirt = CIV_SHIRTS[rnd_int(N(CIV_SHIRTS))];
    l.shirt2 = CIV_SHIRTS[rnd_int(N(CIV_SHIRTS))];
    l.pants = CIV_PANTS[rnd_int(N(CIV_PANTS))];
    l.hat = CIV_SHIRTS[rnd_int(N(CIV_SHIRTS))]; l.hasHat = rnd() < 0.18f;
  }
  return l;
}

enum { P_SKIN, P_SKIN2, P_SHIRT, P_SHIRT2, P_PANTS, P_SHOES, P_SOLE, P_HAIR, P_HAT, P_BRIM, P_EYE, P_PUPIL, P_MOUTH, P_BAND, P_BELT, P_BEARD, P_AFRO, P_LONG, P_GLASSES };
static inline uint16_t pk(color_t c) { return color_to_packed16(c); }
static color_t shade(color_t c, float f) { return RGBA32((uint8_t)minf(255, c.r * f), (uint8_t)minf(255, c.g * f), (uint8_t)minf(255, c.b * f), c.a); }
static void fill_palette(Actor *a) {
  if (!a->palette.buffer) a->palette = surface_alloc(FMT_RGBA16, 8, 4);
  uint16_t *px = a->palette.buffer;
  const Look *l = &a->look;
  const color_t clear = RGBA32(0, 0, 0, 0);
  for (int i = 0; i < 32; i++) px[i] = pk(clear);
  px[P_SKIN] = pk(l->skin); px[P_SKIN2] = pk(shade(l->skin, 0.9f));
  px[P_SHIRT] = pk(l->shirt); px[P_SHIRT2] = pk(l->shirt2);
  px[P_PANTS] = pk(l->pants); px[P_SHOES] = pk(l->shoes); px[P_SOLE] = pk(shade(l->shoes, 0.75f));
  int style = l->hairStyle;
  if (l->hasHat && style == 1) style = 0;
  px[P_HAIR] = style == 3 && !l->hasHat ? pk(clear) : pk(l->hair);
  if (l->hasHat) { px[P_HAT] = pk(l->hat); px[P_BRIM] = pk(shade(l->hat, 0.8f)); }
  px[P_EYE] = pk(RGBA32(250, 250, 250, 255)); px[P_PUPIL] = pk(RGBA32(34, 24, 20, 255));
  px[P_MOUTH] = pk(RGBA32(110, 40, 36, 255)); px[P_BAND] = pk(l->shirt2.r == 250 ? l->hat : l->shirt2);
  px[P_BELT] = pk(RGBA32(36, 30, 28, 255));
  if (l->beard) px[P_BEARD] = pk(l->hair);
  if (style == 1) px[P_AFRO] = pk(l->hair);
  if (style == 2) px[P_LONG] = pk(l->hair);
  if (l->glasses) px[P_GLASSES] = pk(RGBA32(30, 30, 34, 255));
  data_cache_hit_writeback_invalidate(px, 64);
}

Actor *actor_spawn(int kind, int gang, V3 pos, float yaw) {
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (a->used) continue;
    T3DSkeleton skel = a->skel; surface_t pal = a->palette;
    bool hadSkel = skel.bones != NULL;
    memset(a, 0, sizeof(*a));
    a->skel = skel; a->palette = pal;
    if (!hadSkel) a->skel = t3d_skeleton_create_buffered(g_models.person, FB_COUNT);
    if (!s_restKnown) { for (int b = 0; b < NBONES; b++) s_rest[b] = (V3){a->skel.bones[b].position.v[0], a->skel.bones[b].position.v[1], a->skel.bones[b].position.v[2]}; s_restKnown = true; }
    a->used = true; a->kind = kind; a->gang = gang; a->id = i;
    a->look = look_for(kind, gang);
    a->hero = kind == AK_PLAYER;
    fill_palette(a);
    a->pos = pos; a->yaw = yaw;
    a->health = kind == AK_PLAYER ? 100 : kind == AK_COP ? 90 : kind == AK_GANG ? 70 : 45;
    a->state = ST_IDLE; a->onGround = true; a->squash = 1;
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
  // nobody keeps fighting or aiming at the slot (it is given to someone new)
  int idx = (int)(a - g.actors);
  for (int i = 0; i < MAX_ACTORS; i++) { Actor *o = &g.actors[i]; if (o->foe == idx) o->foe = -1; if (o->target == idx) o->target = -1; }
  for (int i = 0; i < MAX_RECRUITS; i++) if (g.recruits[i] == idx) g.recruits[i] = -1;
  a->recruited = false; a->warrior = false;
}

void actor_set_state(Actor *a, int st) {
  if (a->state == st) return;
  a->state = st;
  a->stateTime = 0;
}

bool actor_can_act(const Actor *a) {
  switch (a->state) {
    case ST_IDLE: case ST_RUN: case ST_SKID: case ST_LAND: case ST_CROUCH: case ST_CRAWL: return true;
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
    a->vel.y = force > 4 ? 4 : 1.5f;
    a->onGround = false; a->flip = 0;
    a->despawnTimer = 25;
    sound_play(SND_HIT, a->pos);
    say(a, a->kind == AK_PLAYER ? VO_WHOA : VO_OW);
  } else if (force > 6 && !a->vehicle) {
    actor_set_state(a, ST_KNOCKED);
    a->vel = v3_scale(dir, force);
    a->vel.y = 6 + force * 0.25f;
    a->speed = 0; a->onGround = false;
    sound_play(SND_HIT, a->pos);
    say(a, VO_WHOA);
  } else {
    sound_play(SND_PUNCH, a->pos);
    if (!a->vehicle && a->onGround && (a->state <= ST_LAND || a->state == ST_CRAWL)) { actor_set_state(a, ST_HURT); a->vel = v3_scale(dir, 2.5f); }
    say(a, rnd() < 0.5f ? VO_OOF : VO_OW);
  }
  if (g_on_actor_damaged) g_on_actor_damaged(a, by, dmg, died);
}

// ---- melee ----
static bool melee(Actor *a, float reach, float radius, float dmg, float force, float height) {
  bool hit = false;
  V3 f = yaw_dir(a->yaw);
  V3 c = v3_add(a->pos, (V3){f.x * reach, height, f.z * reach});
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *o = &g.actors[i];
    if (o == a || !actor_alive(o) || o->vehicle) continue;
    V3 oc = v3_add(o->pos, (V3){0, height, 0});
    if (v3_dist_xz(oc, c) < radius + RADIUS && fabsf(o->pos.y - a->pos.y) < 1.2f) {
      V3 d = v3_norm((V3){oc.x - a->pos.x, 0, oc.z - a->pos.z});
      actor_damage(o, dmg, d, force, a);
      fx_burst(v3_lerp(c, actor_chest(o), 0.5f), FX_SPARK, 4);
      hit = true;
    }
  }
  vehicle_melee(c, radius, dmg * 3, f, a);
  return hit;
}

// ---- footsteps: soft, and they sound like what is under the feet ----
static void sound_step(Actor *a, bool landing) {
  if (a->kind != AK_PLAYER && v3_dist2_xz(a->pos, g_view.eye) > 18 * 18) return;
  const Box *box = NULL;
  world_floor(a->pos.x, a->pos.z, a->pos.y + 0.3f, &box);
  int id;
  float wet = WATER_Y - a->pos.y;
  if (wet > 0.05f) id = SFX_STEP_WATER + rnd_int(2);
  else if (box && box->kind == 4) id = SFX_STEP_WOOD + rnd_int(2);
  else if (box) id = SFX_STEP_HARD + rnd_int(3);
  else switch (world_ground_kind(a->pos.x, a->pos.z)) {
    case GROUND_GRASS: case GROUND_DIRT: id = SFX_STEP_GRASS + rnd_int(3); break;
    case GROUND_SAND: id = SFX_STEP_SAND + rnd_int(2); break;
    default: id = SFX_STEP_HARD + rnd_int(3); break;
  }
  float vol = (a->kind == AK_PLAYER ? 0.42f : 0.28f) * (landing ? 1.4f : 0.8f + 0.25f * minf(1, v3_len_xz(a->vel) / RUN_SPEED));
  sound_sfx(id, a->pos, vol, rnd_range(0.9f, 1.1f));
  if (landing && a->kind == AK_PLAYER) sound_sfx(SFX_LAND, a->pos, 0.45f, rnd_range(0.95f, 1.05f));
}

// ---- movement ----
// The numbers are the classic 3D platformer's own, in its units per frame at 30 frames a second
// (100 units a meter): U() turns them into meters per second. One actor_step is one frame.
#define U(v) ((v) * 0.3f)
#define TURN_STEP 0.19635f      // the facing turns at most 11.25 degrees a frame on the ground
#define HELD_BACK 1.745f        // the stick more than 100 degrees from the facing: "held back"

static float stick_mag(const Controls *c) { return minf(1.0f, v3_len_xz(c->move)); }
static float stick_yaw(const Controls *c, float fallback) { return stick_mag(c) > 0.05f ? dir_yaw(c->move.x, c->move.z) : fallback; }

// walking and running: the speed builds up slowly toward what the stick asks, the facing turns at a
// fixed rate (so a run curves round), and above the asked speed it slows a little each frame
static void walk_update(Actor *a, Controls *c, float maxSpeed) {
  float mag = stick_mag(c);
  float target = mag * maxSpeed;
  if (a->speed <= 0) a->speed += U(1.1f);
  else if (a->speed <= target) a->speed += U(1.1f) - a->speed / 43.0f;
  else a->speed = maxf(target, a->speed - U(1.0f));
  if (a->speed > U(48)) a->speed = U(48);
  if (mag > 0.05f) a->yaw = approach_angle(a->yaw, dir_yaw(c->move.x, c->move.z), a->kind == AK_PLAYER ? TURN_STEP : TURN_STEP * 1.5f);
  a->sideVel = 0;
}

static void begin_jump(Actor *a, int type, float vy, float speed) {
  a->vel.y = vy; a->speed = speed; a->onGround = false; a->sideVel = 0;
  a->peakY = a->pos.y; a->shortHop = false; a->firedInAir = false;
  a->flip = 0; a->roll = 0;
  a->squash = 1.18f; // stretched into the jump
  if (type) a->jumpType = type;
}

// a jump from the ground: the jump chain, a long jump, a backflip, a side flip
static bool try_jump(Actor *a, Controls *c) {
  if (!c->jump) return false;
  if (a->state == ST_SKID && a->skidTurn) {
    // jumping out of a turnaround: the side flip, toward where the stick points
    a->yaw = stick_yaw(c, wrap_angle(a->yaw + PI));
    begin_jump(a, 1, U(62), U(8)); actor_set_state(a, ST_SIDEFLIP); say(a, VO_WAHA); return true;
  }
  if (a->state == ST_CROUCHSLIDE && a->stateTime < 1.0f && a->speed > U(10)) {
    begin_jump(a, 1, U(30), minf(a->speed * 1.5f, U(48))); actor_set_state(a, ST_LONGJUMP); say(a, VO_YAH); return true;
  }
  if (a->state == ST_CROUCH || a->state == ST_CRAWL) {
    begin_jump(a, 1, U(62), -U(16)); actor_set_state(a, ST_BACKFLIP); say(a, VO_WAHA); return true;
  }
  int t = 1;
  if (a->landTime < CHAIN_WINDOW) {
    if (a->chain == 1) t = 2;
    else if (a->chain == 2 && a->speed > U(20)) t = 3;
  }
  float vy = t == 1 ? U(42) + a->speed * 0.25f : t == 2 ? U(52) + a->speed * 0.25f : U(69);
  begin_jump(a, t, vy, a->speed * 0.8f);
  a->chain = 0;
  actor_set_state(a, ST_JUMP);
  say(a, t == 1 ? VO_HUP : t == 2 ? VO_HOO : VO_YAHOO);
  return true;
}

static void land(Actor *a, float impact) {
  float fall = a->peakY - a->pos.y;
  int prev = a->state;
  a->onGround = true; a->vel.y = 0; a->sideVel = 0;
  a->landTime = 0; a->flip = 0; a->roll = 0;
  a->squash = 0.82f;
  a->chain = prev == ST_JUMP && a->jumpType < 3 ? a->jumpType : 0; // a single allows a double, a double a triple
  if (prev == ST_DANCE) return;
  if (prev == ST_GPFALL) {
    actor_set_state(a, ST_GPLAND);
    a->speed = 0; a->squash = 0.62f;
    if (a->kind == AK_PLAYER) g_view.shake = 1.0f;
    for (int i = 0; i < MAX_ACTORS; i++) {
      Actor *o = &g.actors[i];
      if (o == a || !actor_alive(o) || o->vehicle) continue;
      if (v3_dist(o->pos, a->pos) < 2.8f) actor_damage(o, 35, v3_norm(v3_sub(o->pos, a->pos)), 9, a);
    }
    fx_burst(a->pos, FX_DUST, 10);
    sound_play(SND_THUD, a->pos);
    return;
  }
  if (prev == ST_SLIDEKICK) return; // (on the ground: the slide on the back)
  if (prev == ST_DIVE) { actor_set_state(a, ST_BELLYSLIDE); sound_play(SND_THUD, a->pos); return; }
  if (prev == ST_KNOCKED) { actor_set_state(a, ST_DOWN); a->speed = 0; sound_play(SND_THUD, a->pos); return; }
  if (prev == ST_DEAD) { a->speed = 0; return; }
  // a long fall hurts (higher than 11.5 m, landing fast)
  if (fall > 11.5f && impact < -U(55) && a->kind == AK_PLAYER) {
    actor_damage(a, 20 + (fall - 11.5f) * 5.0f, (V3){0, 0, 0}, 0, NULL);
    if (!actor_alive(a)) return;
    actor_set_state(a, ST_DOWN); a->speed = 0; say(a, VO_UGH); return;
  }
  if (prev == ST_BACKFLIP) a->speed = 0;
  actor_set_state(a, ST_LAND);
  if (fall > 1.5f) fx_burst(a->pos, FX_DUST, 2);
  sound_step(a, true);
}

// steering in the air: the facing does not turn; the stick pushes the speed along it a little and
// drifts sideways, and the air slows everything gently
static void air_steer(Actor *a, Controls *c, bool longJump) {
  float mag = stick_mag(c);
  a->speed = approach(a->speed, 0, U(0.35f));
  a->sideVel = 0;
  if (mag > 0.05f) {
    float d = angle_diff(dir_yaw(c->move.x, c->move.z), a->yaw);
    a->speed += mag * cosf(d) * U(1.5f);
    a->sideVel = mag * sinf(d) * U(10);
  }
  float limit = longJump ? U(48) : U(32);
  if (a->speed > limit) a->speed -= U(1);
  if (a->speed < -U(16)) a->speed += U(2);
}

// a ledge in front, within reach of the hands: grab it
static bool try_ledge(Actor *a) {
  if (a->kind != AK_PLAYER || a->vel.y > 3 || a->grabCool > 0) return false;
  V3 f = yaw_dir(a->yaw);
  float px = a->pos.x + f.x * (RADIUS + 0.3f), pz = a->pos.z + f.z * (RADIUS + 0.3f);
  float top = world_floor(px, pz, a->pos.y + 2.25f, NULL);
  if (top < a->pos.y + 1.25f || top > a->pos.y + 2.2f) return false;
  if (world_floor(a->pos.x, a->pos.z, a->pos.y + 0.4f, NULL) > top - 1.0f) return false; // (no wall: it's a step)
  if (world_ceiling(px, pz, top + 0.05f) < top + 1.6f) return false;                    // no room on top
  a->ledgeY = top;
  a->pos.y = top - HANG_Y; a->vel = (V3){0, 0, 0}; a->speed = 0; a->sideVel = 0; a->onGround = false;
  // hands on the edge: in against the wall (the grab can come a little before it)
  for (int k = 0; k < 8; k++) {
    float x = a->pos.x + f.x * 0.08f, z = a->pos.z + f.z * 0.08f;
    V3 w = world_push(&x, &z, RADIUS, a->pos.y + 0.2f, a->pos.y + 1.4f);
    a->pos.x = x; a->pos.z = z;
    if (w.x != 0 || w.z != 0) break;
  }
  a->ledgeAt = (V3){a->pos.x + f.x * (RADIUS + 0.45f), top, a->pos.z + f.z * (RADIUS + 0.45f)};
  actor_set_state(a, ST_LEDGE);
  return true;
}

// a pole (a lamp post, a palm, a tree trunk) next to us: hold on to it
static bool try_pole(Actor *a) {
  if (a->kind != AK_PLAYER || a->grabCool > 0) return false;
  float cx, cz, top, bottom;
  if (!world_find_pole(a->pos.x, a->pos.z, a->pos.y + 1.0f, 0.75f, &cx, &cz, &bottom, &top)) return false;
  if (top - a->pos.y < 1.6f) return false;
  a->polePos = (V3){cx, bottom, cz}; a->poleTop = top;
  a->poleAngle = atan2f(a->pos.x - cx, a->pos.z - cz);
  a->vel = (V3){0, 0, 0}; a->speed = 0; a->sideVel = 0; a->onGround = false;
  actor_set_state(a, ST_POLE);
  sound_sfx(SFX_GRAB, a->pos, 0.8f, 1.0f);
  return true;
}

static bool in_jump_state(int st) { return st == ST_JUMP || st == ST_FALL || st == ST_WALLKICK || st == ST_LONGJUMP || st == ST_SIDEFLIP || st == ST_BACKFLIP || st == ST_AIRKICK; }

// how deep the water is here (0: no water to swim in)
static float water_depth(float x, float z, float y) {
  float fl = world_floor(x, z, y + STEP_UP, NULL);
  return WATER_Y - fl;
}

static void enter_water(Actor *a) {
  if (a->state != ST_DEAD) {
    fx_burst((V3){a->pos.x, WATER_Y, a->pos.z}, FX_SPLASH, 10);
    sound_sfx(SFX_SPLASH, a->pos, 0.9f, rnd_range(0.92f, 1.08f));
    if (a->kind == AK_PLAYER && a->vel.y < -8) say(a, VO_WHOA);
    actor_set_state(a, ST_SWIM);
  }
  // a dive in carries the body under a little; then it floats up to the surface
  a->pitch = a->vel.y < -6 ? -0.6f : 0;
  a->speed = clampf(v3_len_xz(a->vel) * 0.4f, 0, 3.0f);
  a->vel = (V3){0, 0, 0}; a->sideVel = 0; a->onGround = false; a->dryTime = 0;
  a->pos.y = maxf(a->pos.y, WATER_Y - 3.0f);
}

// moving and colliding (one frame): walls, floors and ceilings, then gravity (after the move, as the
// platformer does it: the apex is where the velocity says)
static void physics(Actor *a) {
  bool strafe = a->ctl.aim && a->onGround && (a->state == ST_IDLE || a->state == ST_RUN || a->state == ST_LAND);
  if (!strafe && a->state != ST_DEAD && a->state != ST_KNOCKED && a->state != ST_HURT) {
    V3 f = yaw_dir(a->yaw);
    V3 r = yaw_dir(a->yaw + PI / 2);
    a->vel.x = f.x * a->speed + r.x * a->sideVel; a->vel.z = f.z * a->speed + r.z * a->sideVel;
  }
  // fast moves in small steps, so nothing passes through a thin wall
  float step = v3_len_xz(a->vel) * DT;
  int n = clampf(ceilf(step / (RADIUS * 0.6f)), 1, 4);
  V3 wall = {0, 0, 0};
  for (int k = 0; k < n; k++) {
    a->pos.x += a->vel.x * DT / n; a->pos.z += a->vel.z * DT / n;
    V3 w = world_push(&a->pos.x, &a->pos.z, RADIUS * a->look.width, a->pos.y + STEP_UP, a->pos.y + HEIGHT * a->look.height);
    if (w.x != 0 || w.z != 0) wall = w;
  }
  a->wallNormal = wall;
  if (wall.x != 0 || wall.z != 0) {
    float into = -(a->vel.x * wall.x + a->vel.z * wall.z);
    if (into > 0) {
      bool air = !a->onGround && in_jump_state(a->state);
      if (air && (try_ledge(a) || try_pole(a))) return;
      if (air && a->speed > U(16) && into > a->speed * 0.5f) {
        // hit a wall in the air: a moment to wall kick off it
        a->kickNormal = wall;
        actor_set_state(a, ST_WALLHIT); a->speed = 0; a->sideVel = 0; a->vel.y = minf(a->vel.y, 0);
        sound_play(SND_THUD, a->pos);
      } else {
        // slide along it: only the part of the motion into the wall goes
        V3 v = {a->vel.x + wall.x * into, 0, a->vel.z + wall.z * into};
        if (!strafe && a->state != ST_DEAD && a->state != ST_KNOCKED && a->state != ST_HURT) {
          V3 f = yaw_dir(a->yaw), r = yaw_dir(a->yaw + PI / 2);
          a->speed = v.x * f.x + v.z * f.z; a->sideVel = v.x * r.x + v.z * r.z;
          if (a->onGround) a->sideVel = 0;
        }
        a->vel.x = v.x; a->vel.z = v.z;
        if (a->onGround && into > 1.5f && a->state == ST_RUN) a->pushTime = 0.25f;
      }
    }
  }
  if (a->onGround) {
    float fl = world_floor(a->pos.x, a->pos.z, a->pos.y + STEP_UP, NULL);
    if (fl < a->pos.y - 0.6f) {
      a->onGround = false; a->vel.y = 0; a->peakY = a->pos.y;
      if (a->state != ST_DEAD) actor_set_state(a, ST_FALL);
    } else a->pos.y = fl;
  } else {
    float y0 = a->pos.y;
    a->pos.y += a->vel.y * DT;
    if (a->pos.y > a->peakY) a->peakY = a->pos.y;
    if (a->vel.y > 0) {
      float ceil = world_ceiling(a->pos.x, a->pos.z, y0 + HEIGHT * 0.9f);
      if (a->pos.y + HEIGHT > ceil) { a->pos.y = ceil - HEIGHT; a->vel.y = 0; }
    }
    // the floor: falling, anything up to a step above the feet catches them (a ledge's top too)
    float fl = world_floor(a->pos.x, a->pos.z, maxf(y0, a->pos.y) + (a->vel.y <= 0 ? STEP_UP : 0.05f), NULL);
    if (a->pos.y <= fl && a->vel.y <= 0 && fl < WATER_Y - 1.3f && a->state != ST_VEHICLE) { a->pos.y = fl; enter_water(a); } // into deep water: no landing (no fall damage)
    else if (a->pos.y <= fl && a->vel.y <= 0) { float impact = a->vel.y; a->pos.y = fl; land(a, impact); }
    else {
      float g = (a->state == ST_LONGJUMP || a->state == ST_SLIDEKICK) ? U(2) : U(4);
      a->vel.y = maxf(U(-75), a->vel.y - g);
      if (a->vel.y < -2 && (a->state == ST_JUMP || a->state == ST_FALL) && try_ledge(a)) {}
      if (a->peakY - a->pos.y > 9 && a->state == ST_FALL && a->stateTime > 0.6f && a->stateTime < 0.6f + DT * 1.5f) say(a, VO_WHOA);
    }
  }
  // deep water: swim
  if (a->state != ST_VEHICLE && a->state != ST_SWIM && a->pos.y < WATER_Y - 1.1f && water_depth(a->pos.x, a->pos.z, a->pos.y) > 1.3f) enter_water(a);
  a->pos.x = clampf(a->pos.x, -700, 700); a->pos.z = clampf(a->pos.z, -700, 760);
}

// ---- swimming (the platformer's: stick across turns, stick up dives, A strokes, A held kicks) ----
#define SWIM_TOP (WATER_Y - 1.25f)   // the feet when floating with the head out
static void swim(Actor *a, Controls *c) {
  bool me = a->kind == AK_PLAYER;
  float sx = me ? c->rawX : 0, sy = me ? c->rawY : 0;
  bool atTop = a->pos.y >= SWIM_TOP - 0.05f;
  if (me) {
    // (like the platformer: the stick sets the pitch to swim at; let go and the body levels out)
    a->yaw = wrap_angle(a->yaw - sx * 1.9f * DT);
    a->pitch = approach(a->pitch, clampf(-sy * 1.3f, -1.35f, 1.2f), 1.8f * DT);
  } else {
    if (stick_mag(c) > 0.05f) a->yaw = approach_angle(a->yaw, stick_yaw(c, a->yaw), 2.5f * DT);
    a->pitch = approach(a->pitch, 0.25f, 1.2f * DT); // others make for the surface
  }
  if (atTop && a->pitch > 0) a->pitch = approach(a->pitch, 0, 2.5f * DT); // at the surface: level out
  // the water jump: at the surface, A with the stick pulled back
  if (me && atTop && c->jump && sy < -0.6f) {
    begin_jump(a, 1, 14.0f, 3.5f); actor_set_state(a, ST_JUMP); a->pitch = 0; a->shortHop = true; // (always the full leap)
    fx_burst((V3){a->pos.x, WATER_Y, a->pos.z}, FX_SPLASH, 10); sound_sfx(SFX_SPLASH, a->pos, 0.9f, rnd_range(0.92f, 1.08f)); say(a, VO_HOO);
    return;
  }
  // a breaststroke on A, a flutter kick while it is held, drifting to a stop without
  if (c->jump || (!me && stick_mag(c) > 0.1f && a->stroke <= 0)) {
    a->stroke = 0.6f; a->speed = minf(a->speed + 2.4f, 5.4f);
    sound_sfx(SFX_SWIM + (rnd() < 0.5f), a->pos, 0.75f, rnd_range(0.92f, 1.08f));
    if (atTop) fx_burst((V3){a->pos.x, WATER_Y, a->pos.z}, FX_SPLASH, 3);
  }
  if (a->stroke > 0) { a->stroke -= DT; a->speed = approach(a->speed, 1.6f, 4.0f * DT); }
  else if (c->jumpHeld) a->speed = approach(a->speed, 3.0f, 3.0f * DT);
  else a->speed = approach(a->speed, 0, 2.2f * DT);
  // move along the facing and the pitch
  V3 f = yaw_dir(a->yaw);
  float cp = cosf(a->pitch), sp = sinf(a->pitch);
  a->vel = (V3){f.x * cp * a->speed, sp * a->speed, f.z * cp * a->speed};
  if (!atTop && a->speed < 0.6f && fabsf(sy) < 0.1f) a->vel.y += 0.35f;   // still: the body floats up
  a->pos.x += a->vel.x * DT; a->pos.z += a->vel.z * DT; a->pos.y += a->vel.y * DT;
  a->wallNormal = world_push(&a->pos.x, &a->pos.z, RADIUS, a->pos.y - 0.2f, a->pos.y + 1.4f);
  float bed = world_floor(a->pos.x, a->pos.z, a->pos.y + 1.0f, NULL);
  if (a->pos.y < bed + 0.25f) { a->pos.y = bed + 0.25f; if (a->pitch < 0) a->pitch = approach(a->pitch, 0, 3 * DT); }
  if (a->pos.y > SWIM_TOP) a->pos.y = SWIM_TOP;
  atTop = a->pos.y >= SWIM_TOP - 0.05f;
  // out onto a shore or a quay that is in reach of the arms
  if (atTop && a->speed > 0.5f) {
    float ax = a->pos.x + f.x * 0.75f, az = a->pos.z + f.z * 0.75f;
    float top = world_floor(ax, az, WATER_Y + 1.4f, NULL);
    if (top > WATER_Y - 1.0f && top < WATER_Y + 1.35f) {
      if (top <= a->pos.y + STEP_UP + 0.9f) {
        // wading out / up the shore
        a->pos.y = maxf(a->pos.y, top - 0.4f);
        if (water_depth(a->pos.x, a->pos.z, a->pos.y + 0.5f) < 1.25f) { a->pos.y = world_floor(a->pos.x, a->pos.z, a->pos.y + 1.0f, NULL); a->onGround = true; actor_set_state(a, ST_RUN); a->pitch = 0; return; }
      } else if (me) {
        // a quay: climb up it (the ledge grab)
        a->ledgeY = top; a->ledgeAt = (V3){ax, top, az}; a->pos.y = top - HANG_Y; a->vel = (V3){0, 0, 0}; a->speed = 0; a->pitch = 0;
        actor_set_state(a, ST_LEDGE); return;
      } else {
        // the others: straight up onto it
        a->pos = (V3){ax, top, az}; a->vel = (V3){0, 0, 0}; a->speed = 0; a->pitch = 0; a->onGround = true;
        actor_set_state(a, ST_IDLE); return;
      }
    }
  }
  // breath: under water it runs out (health), at the surface it comes back
  if (me) {
    // (only what the breath took comes back at the surface: the sea is no clinic)
    if (a->pos.y < SWIM_TOP - 0.5f) { a->dryTime += DT; if (a->dryTime > 2.0f) { a->health -= 1.6f * DT; a->breathLost += 1.6f * DT; if (a->health <= 0) { a->health = 1; a->breathLost = 0; actor_damage(a, 10, (V3){0, 0, 0}, 0, NULL); } } }
    else { a->dryTime = 0; float back = minf(a->breathLost, 8 * DT); a->health = minf(100, a->health + back); a->breathLost -= back; }
  }
  a->peakY = a->pos.y; a->onGround = false;
  // shallow enough to stand
  if (water_depth(a->pos.x, a->pos.z, a->pos.y) < 1.25f) { a->pos.y = world_floor(a->pos.x, a->pos.z, a->pos.y + 1.0f, NULL); a->onGround = true; a->pitch = 0; actor_set_state(a, ST_IDLE); }
}

// how steep the ground is here (the terrain: hills), and which way is down
static float slope_at(V3 p, V3 *down) {
  float h0 = world_terrain(p.x, p.z), hx = world_terrain(p.x + 1, p.z), hz = world_terrain(p.x, p.z + 1);
  if (fabsf(h0 - p.y) > 0.3f) { *down = (V3){0, 0, 0}; return 0; } // standing on something else
  *down = (V3){h0 - hx, 0, h0 - hz};
  return sqrtf(sqrf(hx - h0) + sqrf(hz - h0));
}

void actor_step(Actor *a) {
  Controls *c = &a->ctl;
  a->stateTime += DT;
  a->landTime += DT;
  if (a->hurt > 0) a->hurt -= DT;
  if (a->sayTimer > 0) a->sayTimer -= DT;
  if (a->pushTime > 0) a->pushTime -= DT;
  if (a->grabCool > 0) a->grabCool -= DT;
  a->squash = lerpf(a->squash, 1.0f, 0.25f);
  if (a->state == ST_VEHICLE) { a->onGround = true; weapon_step(a); return; }
  if (a->state == ST_ENTER || a->state == ST_EXIT) { vehicle_board_step(a); return; }

  bool hasGun = weapon_is_gun(a->weapon);
  float mag = stick_mag(c);
  if (a->state == ST_IDLE && mag < 0.05f && !c->aim) a->idleTime += DT; else a->idleTime = 0;
  if (a->kind == AK_PLAYER && a->idleTime > 16 && ((int)(a->idleTime * 30) % 120) == 0) say(a, VO_SNORE);
  switch (a->state) {
    case ST_IDLE: case ST_RUN: case ST_LAND: {
      // (townspeople run like people, not like the hero; the crew nearly keeps up with him)
      float maxS = c->walk ? WALK_SPEED : a->kind == AK_PLAYER ? RUN_SPEED : a->recruited ? RUN_SPEED * 0.94f : RUN_SPEED * 0.7f;
      if (c->aim && hasGun) {
        V3 to = v3_sub(c->aimAt, a->pos);
        a->yaw = approach_angle(a->yaw, dir_yaw(to.x, to.z), 12 * DT);
        V3 mv = v3_scale(c->move, 3.2f);
        a->vel.x = lerpf(a->vel.x, mv.x, 0.4f); a->vel.z = lerpf(a->vel.z, mv.z, 0.4f);
        a->speed = 0; a->sideVel = 0;
        if (c->jump) { begin_jump(a, 1, U(42), 0); actor_set_state(a, ST_JUMP); say(a, VO_HUP); }
        break;
      }
      if (c->face && mag < 0.05f) a->yaw = approach_angle(a->yaw, c->faceYaw, 8 * DT);
      bool player = a->kind == AK_PLAYER;
      if (mag < 0.05f) {
        // no stick: a fast run brakes into a skid, a slow one winds down
        if (a->state == ST_RUN && player && a->speed >= U(16)) { a->skidTurn = false; actor_set_state(a, ST_SKID); sound_play(SND_SKID, a->pos); break; }
        a->speed = approach(a->speed, 0, a->state == ST_LAND ? U(2) : U(1)); a->sideVel = 0;
        if (a->state == ST_RUN && a->speed <= 0.05f) actor_set_state(a, ST_IDLE);
        if (a->state == ST_LAND && a->stateTime > 0.13f) actor_set_state(a, a->speed > 0.3f ? ST_RUN : ST_IDLE);
      } else {
        float d = angle_diff(dir_yaw(c->move.x, c->move.z), a->yaw);
        // the stick pulled back at speed: the turnaround skid
        if (player && a->state != ST_IDLE && fabsf(d) > HELD_BACK && a->speed >= U(16)) { a->skidTurn = true; actor_set_state(a, ST_SKID); sound_play(SND_SKID, a->pos); say(a, VO_HMM); break; }
        walk_update(a, c, maxS);
        actor_set_state(a, ST_RUN);
      }
      // a steep hillside: you slide down it
      V3 down; float sl = slope_at(a->pos, &down);
      if (sl > 0.75f) { a->yaw = dir_yaw(down.x, down.z); actor_set_state(a, ST_BUTTSLIDE); break; }
      if (c->crouchPressed || (c->crouch && a->speed < 1)) { actor_set_state(a, a->speed > 1.0f ? ST_CROUCHSLIDE : ST_CROUCH); break; }
      if (c->attack && !hasGun) {
        if (a->speed >= U(29) && mag > 0.75f) { begin_jump(a, 0, U(20), minf(a->speed + U(15), U(48))); actor_set_state(a, ST_DIVE); say(a, VO_HOO); }
        else { actor_set_state(a, ST_PUNCH); a->combo = 0; a->hitTimer = 0.12f; sound_play(SND_SWING, a->pos); say(a, VO_HA); }
        break;
      }
      // a jump next to a pole: hold on to it
      if (c->jump && try_pole(a)) break;
      try_jump(a, c);
      // footsteps on each foot fall
      if (a->state == ST_RUN) {
        float ph = fmodf(a->animPhase, PI), prev = fmodf(a->animPhase - v3_len_xz(a->vel) * DT * (v3_len_xz(a->vel) > 5 ? 1.05f : 1.6f), PI);
        if (ph < prev && (player || v3_dist2_xz(a->pos, g_view.eye) < 18 * 18)) sound_step(a, false);
      }
      break;
    }
    case ST_SKID: {
      // braking (no stick) or turning round (the stick held back): slides to a stop
      a->speed = approach(a->speed, 0, U(2)); a->sideVel = 0;
      if ((g.frame & 1) == 0) fx_burst(a->pos, FX_DUST, 1);
      if (try_jump(a, c)) break;
      float d = mag > 0.05f ? angle_diff(dir_yaw(c->move.x, c->move.z), a->yaw) : 0;
      if (a->skidTurn) {
        if (mag < 0.05f) a->skidTurn = false;                                  // let go: just braking now
        else if (fabsf(d) < HELD_BACK) { actor_set_state(a, ST_RUN); break; }  // not held back any more: run on
        if (a->speed <= 0.05f && a->skidTurn) { a->yaw = stick_yaw(c, wrap_angle(a->yaw + PI)); a->speed = U(8); actor_set_state(a, ST_RUN); }
      } else {
        if (mag > 0.05f && fabsf(d) < HELD_BACK) { actor_set_state(a, ST_RUN); break; }
        if (mag > 0.05f) a->skidTurn = true;
        if (a->speed <= 0.05f) actor_set_state(a, ST_IDLE);
      }
      break;
    }
    case ST_CROUCH:
      a->speed = approach(a->speed, 0, U(3)); a->sideVel = 0;
      if (try_jump(a, c)) break;
      if (c->attack && !hasGun) { actor_set_state(a, ST_SWEEP); a->hitTimer = 0.15f; sound_play(SND_SWING, a->pos); say(a, VO_HYA); break; }
      if (!c->crouch) actor_set_state(a, ST_IDLE);
      else if (mag > 0.2f) actor_set_state(a, ST_CRAWL);
      break;
    case ST_CRAWL:
      walk_update(a, c, 1.5f);
      if (try_jump(a, c)) break;
      if (!c->crouch) actor_set_state(a, ST_IDLE);
      else if (mag < 0.1f) actor_set_state(a, ST_CROUCH);
      break;
    case ST_CROUCHSLIDE:
      a->speed = approach(a->speed, 0, U(1.0f)); a->sideVel = 0;
      if (mag > 0.05f) a->yaw = approach_angle(a->yaw, dir_yaw(c->move.x, c->move.z), 0.04f);
      if ((g.frame & 3) == 0) fx_burst(a->pos, FX_DUST, 1);
      if (try_jump(a, c)) break;
      if (c->attack && !hasGun) { actor_set_state(a, ST_SLIDEKICK); begin_jump(a, 0, U(12), maxf(a->speed, U(32))); a->onGround = false; say(a, VO_HYA); sound_play(SND_SWING, a->pos); break; }
      if (!c->crouch || a->speed < 1.0f) actor_set_state(a, c->crouch ? ST_CROUCH : ST_RUN);
      break;
    case ST_SLIDEKICK:
      // the slide kick: a low hop along the ground, feet first, then a slide on the back
      if (a->onGround) a->speed = approach(a->speed, 0, U(2));
      if ((g.frame & 1) == 0 && a->onGround) fx_burst(a->pos, FX_DUST, 1);
      if (a->stateTime < 0.45f && fmodf(a->stateTime, 0.15f) < DT && !a->firedInAir) { if (melee(a, 0.8f, 0.6f, 18, 7, 0.4f)) a->firedInAir = true; } // (one hit a kick)
      if (a->onGround && c->jump && a->stateTime > 0.15f) { begin_jump(a, 1, U(30), a->speed * 0.6f + 2); actor_set_state(a, ST_JUMP); a->shortHop = true; say(a, VO_HUP); break; }
      if (a->onGround && a->speed < 1) actor_set_state(a, ST_CROUCH);
      break;
    case ST_SWEEP:
      a->speed = 0; a->sideVel = 0;
      if (a->hitTimer > 0 && (a->hitTimer -= DT) <= 0) melee(a, 0, 1.2f, 16, 6, 0.3f);
      if (a->stateTime > 0.45f) actor_set_state(a, ST_CROUCH);
      break;
    case ST_BUTTSLIDE: {
      if (!a->onGround) { actor_set_state(a, ST_FALL); break; }
      V3 down; float sl = slope_at(a->pos, &down);
      if (sl > 0.2f) { float want = dir_yaw(down.x, down.z); a->yaw = approach_angle(a->yaw, want, 3 * DT); a->speed = minf(16, a->speed + sl * 22 * DT); }
      else a->speed = approach(a->speed, 0, 10 * DT);
      if (mag > 0.1f) a->yaw = approach_angle(a->yaw, dir_yaw(c->move.x, c->move.z), 1.2f * DT);
      if ((g.frame & 1) == 0) fx_burst(a->pos, FX_DUST, 1);
      if (c->jump) { begin_jump(a, 1, U(42), a->speed * 0.8f); actor_set_state(a, ST_JUMP); say(a, VO_HUP); break; }
      if (sl < 0.3f && a->speed < 2) actor_set_state(a, ST_IDLE);
      break;
    }
    case ST_PUNCH: {
      a->speed = approach(a->speed, 0, U(3)); a->sideVel = 0;
      float len = a->combo == 2 ? 0.38f : 0.24f;
      if (a->hitTimer > 0) {
        a->hitTimer -= DT;
        if (a->hitTimer <= 0) melee(a, 0.75f, 0.65f, a->combo == 2 ? 22 : 11, a->combo == 2 ? 8 : 3, 1.0f);
      }
      if (c->attack && a->stateTime > 0.08f && a->combo < 2) { a->combo++; a->stateTime = 0; a->hitTimer = 0.1f; sound_play(SND_SWING, a->pos); say(a, a->combo == 2 ? VO_HYA : VO_HA); }
      else if (a->stateTime > len) actor_set_state(a, ST_IDLE);
      break;
    }
    case ST_GPLAND:
      a->speed = 0; a->sideVel = 0;
      if (a->stateTime > 0.36f) actor_set_state(a, ST_IDLE);
      break;
    case ST_HARDLAND:
      a->speed = approach(a->speed, 0, 20 * DT);
      if (a->stateTime > 0.28f) actor_set_state(a, ST_IDLE);
      break;
    case ST_HURT:
      a->speed = 0; a->sideVel = 0;
      a->vel.x *= 0.85f; a->vel.z *= 0.85f;
      if (a->stateTime > 0.35f) actor_set_state(a, ST_IDLE);
      break;
    case ST_DANCE:
      a->speed = 0; a->sideVel = 0;
      if (a->stateTime > 0.35f && a->stateTime < 0.35f + DT * 1.5f && a->onGround) { a->vel.y = 9; a->onGround = false; }
      if (a->stateTime > 2.6f) actor_set_state(a, ST_IDLE);
      break;
    case ST_BELLYSLIDE:
      if (!a->onGround) { actor_set_state(a, ST_FALL); break; }
      a->speed = approach(a->speed, 0, U(1.5f)); a->sideVel = 0;
      if ((g.frame & 1) == 0) fx_burst(a->pos, FX_DUST, 1);
      if ((c->jump || c->attack) && a->stateTime > 0.1f) { begin_jump(a, 1, U(30), a->speed); actor_set_state(a, ST_JUMP); a->shortHop = true; say(a, VO_HUP); break; } // the roll-out
      if (a->speed < 0.3f && a->stateTime > 0.5f) actor_set_state(a, ST_IDLE);
      break;
    case ST_JUMP: case ST_LONGJUMP: case ST_BACKFLIP: case ST_SIDEFLIP: case ST_FALL: case ST_WALLKICK: case ST_AIRKICK: {
      // let go of A early in a jump and it stays low
      // (the others' jumps: about a metre, enough for a fence)
      if (a->state == ST_JUMP && a->kind != AK_PLAYER && !a->shortHop) { a->vel.y = minf(a->vel.y, 8.5f); a->shortHop = true; }
      if (a->state == ST_JUMP && a->kind == AK_PLAYER && a->jumpType < 3 && !a->shortHop && !c->jumpHeld && a->vel.y > U(20)) { a->vel.y /= 4; a->shortHop = true; }
      air_steer(a, c, a->state == ST_LONGJUMP);
      if (c->crouchPressed && a->state != ST_LONGJUMP) { actor_set_state(a, ST_GPSPIN); a->vel.y = 0; a->speed = 0; a->sideVel = 0; say(a, VO_HOO); break; }
      if (c->attack && !hasGun && a->state != ST_AIRKICK) {
        if (a->speed > U(28)) { a->speed = minf(a->speed + U(15), U(48)); actor_set_state(a, ST_DIVE); say(a, VO_HOO); }
        else { actor_set_state(a, ST_AIRKICK); a->vel.y = U(20); a->hitTimer = 0.08f; sound_play(SND_SWING, a->pos); say(a, VO_HYA); }
      }
      if (a->state == ST_AIRKICK && a->hitTimer > 0) { a->hitTimer -= DT; if (a->hitTimer <= 0) melee(a, 0.6f, 0.7f, 18, 7, 0.9f); }
      if (a->state == ST_JUMP && a->jumpType == 3) a->flip = minf(TAU, a->stateTime * 9.5f);
      if (a->state == ST_BACKFLIP) a->flip = -minf(TAU, a->stateTime * 8.5f);
      if (a->state == ST_SIDEFLIP) a->roll = minf(TAU, a->stateTime * 8.5f);
      // jumping into a pole grabs it
      if (a->stateTime > 0.15f && try_pole(a)) break;
      break;
    }
    case ST_WALLHIT:
      a->vel.y = maxf(a->vel.y, -4.0f);
      if (c->jump && a->stateTime < 0.24f) {
        // the wall kick: off the wall, the way the run came in mirrored
        V3 n = a->kickNormal;
        if (n.x == 0 && n.z == 0) n = v3_scale(yaw_dir(a->yaw), -1);
        V3 d = yaw_dir(a->yaw);
        float dn = d.x * n.x + d.z * n.z;
        V3 r = {d.x - 2 * dn * n.x, 0, d.z - 2 * dn * n.z};
        a->yaw = dir_yaw(r.x, r.z);
        begin_jump(a, 1, U(62), U(24));
        actor_set_state(a, ST_WALLKICK);
        say(a, VO_YAH);
        fx_burst(v3_add(a->pos, (V3){-n.x * 0.4f, 1.2f, -n.z * 0.4f}), FX_DUST, 3);
      } else if (a->stateTime > 0.24f) { a->speed = -U(8); actor_set_state(a, ST_FALL); }
      break;
    case ST_GPSPIN: {
      // the ground pound: a spin that rises a little, then straight down
      a->speed = 0; a->sideVel = 0; a->vel.y = 0;
      int fr = (int)(a->stateTime * 30 + 0.5f);
      if (fr <= 10) { float up = (20 - 2 * fr) / 100.0f; if (world_ceiling(a->pos.x, a->pos.z, a->pos.y + HEIGHT) > a->pos.y + HEIGHT + up) a->pos.y += up; }
      a->flip = a->stateTime * (TAU / 0.33f);
      if (a->stateTime > 0.33f) { a->flip = 0; actor_set_state(a, ST_GPFALL); a->vel.y = U(-50); }
      a->peakY = maxf(a->peakY, a->pos.y);
      return; // (held in the air)
    }
    case ST_GPFALL:
      a->speed = 0; a->sideVel = 0;
      break;
    case ST_DIVE:
      a->flip = minf(1.45f, a->stateTime * 6);
      air_steer(a, c, true);
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
    case ST_SWIM:
      swim(a, c);
      weapon_step(a);
      return;
    case ST_LEDGE: {
      // hanging: toward the wall or A climbs up, back or Z lets go
      a->vel = (V3){0, 0, 0}; a->speed = 0; a->sideVel = 0;
      V3 f = yaw_dir(a->yaw);
      float fwd = c->move.x * f.x + c->move.z * f.z;
      if (a->stateTime > 0.2f && (fwd > 0.5f || c->jump)) { actor_set_state(a, ST_LEDGECLIMB); say(a, VO_HUP); a->goal = a->pos; }
      else if (a->stateTime > 0.2f && (fwd < -0.5f || c->crouchPressed)) { a->onGround = false; a->peakY = a->pos.y; a->grabCool = 0.45f; actor_set_state(a, ST_FALL); a->speed = -1; }
      return; // no physics while hanging
    }
    case ST_LEDGECLIMB: {
      // up and over: up first, then onto the top (a->goal holds where the climb began)
      float k = clampf(a->stateTime / 0.45f, 0, 1);
      float up = minf(1, k * 1.5f), over = clampf((k - 0.5f) * 2, 0, 1);
      V3 from = a->goal; a->vel = (V3){0, 0, 0};
      a->pos.y = from.y + (a->ledgeY - from.y) * up;
      a->pos.x = from.x + (a->ledgeAt.x - from.x) * over; a->pos.z = from.z + (a->ledgeAt.z - from.z) * over;
      if (k >= 1) {
        a->pos = (V3){a->ledgeAt.x, a->ledgeY, a->ledgeAt.z};
        world_push(&a->pos.x, &a->pos.z, RADIUS, a->pos.y + STEP_UP, a->pos.y + HEIGHT);
        a->vel = (V3){0, 0, 0};
        a->onGround = true; actor_set_state(a, ST_IDLE);
      }
      return;
    }
    case ST_POLE: {
      // up and down the pole, round it with the stick's sides; A jumps off backwards
      float up = c->move.x * sinf(a->poleAngle + PI) + c->move.z * cosf(a->poleAngle + PI); // the stick toward the pole: up
      float side = c->move.x * cosf(a->poleAngle) - c->move.z * sinf(a->poleAngle);
      float climb = up > 0.3f ? 2.4f : up < -0.3f ? -4.0f : 0;
      a->pos.y = clampf(a->pos.y + climb * DT, a->polePos.y, a->poleTop - 1.6f);
      a->poleAngle = wrap_angle(a->poleAngle + side * 2.2f * DT);
      a->pos.x = a->polePos.x + sinf(a->poleAngle) * 0.36f; a->pos.z = a->polePos.z + cosf(a->poleAngle) * 0.36f;
      a->yaw = wrap_angle(a->poleAngle + PI);
      a->animPhase += fabsf(climb) * DT * 3;
      a->peakY = a->pos.y;
      if (c->jump) { a->yaw = a->poleAngle; a->grabCool = 0.4f; begin_jump(a, 1, U(62), U(24)); actor_set_state(a, ST_WALLKICK); say(a, VO_YAH); return; }
      if (c->crouchPressed || (climb < 0 && a->pos.y <= a->polePos.y + 0.05f)) { a->onGround = false; a->grabCool = 0.45f; actor_set_state(a, ST_FALL); a->speed = -1.5f; return; }
      return;
    }
  }
  if (ST_IS_AIR(a->state) && a->onGround && a->state != ST_KNOCKED) a->onGround = false;
  if (a->state != ST_DEAD && a->state != ST_KNOCKED) physics(a);
  else {
    // thrown or dead: a body flying (in small steps), landing, or sinking into deep water
    float step = v3_len_xz(a->vel) * DT;
    int n = clampf(ceilf(step / (RADIUS * 0.6f)), 1, 4);
    for (int k = 0; k < n; k++) { a->pos.x += a->vel.x * DT / n; a->pos.z += a->vel.z * DT / n; world_push(&a->pos.x, &a->pos.z, RADIUS, a->pos.y + STEP_UP, a->pos.y + 1.0f); }
    float fl = world_floor(a->pos.x, a->pos.z, a->pos.y + STEP_UP, NULL);
    if (a->state == ST_DEAD && fl < WATER_Y - 1.3f && a->pos.y <= WATER_Y - 0.4f + 0.01f && a->pos.y > WATER_Y - 2.0f) {
      a->pos.y = WATER_Y - 0.4f; a->vel = (V3){0, 0, 0}; a->onGround = true; // floating
    } else if (!a->onGround) {
      a->vel.y = maxf(U(-75), a->vel.y - U(4)); a->pos.y += a->vel.y * DT;
      if (a->pos.y <= fl) { float impact = a->vel.y; a->pos.y = fl; if (a->state == ST_KNOCKED) land(a, impact); else { a->onGround = true; a->vel.x = a->vel.z = 0; } }
    } else if (fl < a->pos.y - 0.6f) a->onGround = false; else a->pos.y = fl;
    if (a->pos.y < WATER_Y - 1.1f && water_depth(a->pos.x, a->pos.z, a->pos.y) > 1.3f) {
      if (a->state == ST_KNOCKED) enter_water(a);
      else { a->pos.y = WATER_Y - 0.4f; a->vel = (V3){0, 0, 0}; a->onGround = true; } // the dead float
    }
  }
  weapon_step(a);
}

void actor_dance(Actor *a) { if (actor_alive(a) && !a->vehicle) { actor_set_state(a, ST_DANCE); say(a, VO_WOOHOO); } }

// ---- animation ----
enum { B_HIPS, B_TORSO, B_HEAD, B_ARM_L, B_FORE_L, B_HAND_L, B_ARM_R, B_FORE_R, B_HAND_R, B_LEG_L, B_SHIN_L, B_FOOT_L, B_LEG_R, B_SHIN_R, B_FOOT_R };
#define LIMBS(p, al, fl, ar, fr) do { (p)->x[B_ARM_L] = al; (p)->x[B_FORE_L] = fl; (p)->x[B_ARM_R] = ar; (p)->x[B_FORE_R] = fr; } while (0)
#define LEGS(p, ll, sl, lr, sr) do { (p)->x[B_LEG_L] = ll; (p)->x[B_SHIN_L] = sl; (p)->x[B_LEG_R] = lr; (p)->x[B_SHIN_R] = sr; } while (0)
static inline float ease(float t) { t = clampf(t, 0, 1); return t * t * (3 - 2 * t); }

// walking, jogging, running: one cycle whose stride, lean and arm pump grow with the speed
static void pose_locomotion(Pose *p, Actor *a, float speed) {
  float k = clampf(speed / RUN_SPEED, 0, 1);
  float run = clampf((speed - 2.5f) / 4.0f, 0, 1);  // 0 a walk (or tiptoe), 1 a full run
  float ph = a->animPhase, s = sinf(ph), co = cosf(ph);
  float stride = 0.25f + k * 0.75f;
  p->x[B_LEG_L] = -s * stride; p->x[B_LEG_R] = s * stride;
  p->x[B_SHIN_L] = (maxf(0, co) * (0.5f + run * 1.1f) + 0.1f) * stride + 0.05f;
  p->x[B_SHIN_R] = (maxf(0, -co) * (0.5f + run * 1.1f) + 0.1f) * stride + 0.05f;
  p->x[B_FOOT_L] = -p->x[B_LEG_L] * 0.3f - 0.1f * run; p->x[B_FOOT_R] = -p->x[B_LEG_R] * 0.3f - 0.1f * run;
  // the arms: swinging loose when walking, pumping with bent elbows when running
  float arm = 0.35f + run * 0.75f;
  p->x[B_ARM_L] = s * arm; p->x[B_ARM_R] = -s * arm;
  p->x[B_FORE_L] = -0.25f - run * 1.15f + s * 0.2f * run; p->x[B_FORE_R] = -0.25f - run * 1.15f - s * 0.2f * run;
  p->z[B_ARM_L] = 0.12f + run * 0.12f; p->z[B_ARM_R] = -0.12f - run * 0.12f;
  // the body: leans into the run, the hips turn with the stride, the shoulders against them
  p->x[B_TORSO] = 0.05f + run * 0.28f;
  p->y[B_HIPS] = -s * 0.12f * stride; p->y[B_TORSO] = s * 0.18f * stride;
  p->x[B_HEAD] = -run * 0.2f;
  p->hipY = -fabsf(co) * 0.05f * stride + (run > 0.5f ? 0.03f : 0);
  if (speed < 0.15f) { LEGS(p, 0, 0.05f, 0, 0.05f); LIMBS(p, 0, -0.2f, 0, -0.2f); p->hipY = 0; p->y[B_HIPS] = p->y[B_TORSO] = 0; }
}

static void pose_target(Actor *a, Pose *p) {
  memset(p, 0, sizeof(*p));
  float t = a->stateTime, gt = g.time + a->id * 0.7f;
  // the default stance: arms a little out (a cartoon body's arms hang away from the belly)
  p->z[B_ARM_L] = 0.16f; p->z[B_ARM_R] = -0.16f; p->x[B_FORE_L] = p->x[B_FORE_R] = -0.2f;
  switch (a->state) {
    case ST_IDLE: case ST_GETUP: default: {
      p->x[B_TORSO] = 0.025f * sinf(gt * 2.2f); p->hipY = -0.008f * (1 + sinf(gt * 2.2f));
      p->z[B_ARM_L] = 0.18f + 0.03f * sinf(gt * 2.2f); p->z[B_ARM_R] = -p->z[B_ARM_L];
      // looking round after a while, then a nap sitting on the ground
      if (a->idleTime > 4 && a->idleTime < 16) { p->y[B_HEAD] = sinf(a->idleTime * 0.9f) * 0.7f; p->x[B_HEAD] = -0.1f; }
      if (a->idleTime >= 16) {
        p->hipY = -0.58f; LEGS(p, -1.45f, 1.35f, -1.45f, 1.35f); p->z[B_LEG_L] = 0.35f; p->z[B_LEG_R] = -0.35f;
        p->x[B_TORSO] = 0.35f; p->x[B_HEAD] = 0.55f + 0.12f * sinf(gt * 1.2f);
        LIMBS(p, -0.9f, -0.5f, -0.9f, -0.5f);
      }
      if (a->kind != AK_PLAYER && a->brain == 2) { p->y[B_HEAD] = sinf(gt * 0.5f) * 0.4f; p->x[B_ARM_R] = -0.4f + 0.3f * sinf(gt * 1.3f); p->x[B_FORE_R] = -1.0f; }
      break;
    }
    case ST_LAND: pose_locomotion(p, a, 0); p->hipY = -0.12f; LEGS(p, -0.45f, 0.9f, -0.45f, 0.9f); p->x[B_TORSO] = 0.25f; break;
    case ST_RUN: case ST_ENTER: case ST_EXIT:
      pose_locomotion(p, a, v3_len_xz(a->vel));
      if (a->pushTime > 0) { LIMBS(p, -1.5f, -0.3f, -1.5f, -0.3f); p->x[B_TORSO] = 0.45f; p->x[B_HEAD] = -0.3f; }
      break;
    case ST_SKID:
      p->x[B_TORSO] = -0.4f; LEGS(p, -0.85f, 0.1f, 0.3f, 0.7f); p->x[B_FOOT_L] = -0.5f;
      LIMBS(p, -1.3f, -0.3f, -1.1f, -0.3f); p->z[B_ARM_L] = 0.8f; p->z[B_ARM_R] = -0.8f; p->hipY = -0.18f; p->x[B_HEAD] = 0.2f;
      break;
    case ST_CROUCH: case ST_CROUCHSLIDE:
      p->hipY = -0.36f; LEGS(p, -1.3f, 2.0f, -1.3f, 2.0f); p->x[B_FOOT_L] = p->x[B_FOOT_R] = -0.6f;
      p->x[B_TORSO] = 0.55f; p->x[B_HEAD] = -0.45f; LIMBS(p, -0.7f, -0.7f, -0.7f, -0.7f);
      break;
    case ST_CRAWL: {
      float s = sinf(a->animPhase * 1.6f);
      p->hipY = -0.42f; LEGS(p, -1.4f + s * 0.3f, 2.0f, -1.4f - s * 0.3f, 2.0f);
      p->x[B_TORSO] = 0.9f; p->x[B_HEAD] = -0.8f; LIMBS(p, -1.3f - s * 0.4f, 0.2f, -1.3f + s * 0.4f, 0.2f);
      break;
    }
    case ST_PUNCH: {
      float e = ease(t / 0.09f);
      if (a->combo == 2) { // the kick: a leg high up, the body leaning back
        LEGS(p, -1.7f * e, 0.15f, 0.25f, 0.4f); p->x[B_TORSO] = -0.3f * e; p->x[B_FOOT_L] = 0.4f;
        LIMBS(p, -0.5f, -1.0f, 0.5f, -1.0f); p->z[B_ARM_L] = 0.7f; p->z[B_ARM_R] = -0.7f;
      } else {
        bool right = a->combo == 0;
        int ua = right ? B_ARM_R : B_ARM_L, fa = right ? B_FORE_R : B_FORE_L, ob = right ? B_ARM_L : B_ARM_R, of = right ? B_FORE_L : B_FORE_R;
        p->x[ua] = -1.6f * e; p->x[fa] = -0.15f * e; p->z[ua] = (right ? 0.15f : -0.15f) * e;
        p->x[ob] = -0.9f; p->x[of] = -1.6f;
        p->y[B_TORSO] = (right ? 0.45f : -0.45f) * e; p->y[B_HIPS] = (right ? 0.2f : -0.2f) * e;
        LEGS(p, -0.35f, 0.3f, 0.25f, 0.2f);
      }
      break;
    }
    case ST_SWEEP: // a breakdance sweep: low, one leg out round the floor (the body spins, below)
      p->hipY = -0.5f; LEGS(p, -1.4f, 1.9f, -0.2f, 0.1f); p->z[B_LEG_R] = -1.3f;
      p->x[B_TORSO] = 0.6f; LIMBS(p, -1.0f, -0.2f, -0.4f, -0.4f); p->z[B_ARM_L] = 0.6f;
      break;
    case ST_SLIDEKICK: // sliding on the back, a foot forward
      LEGS(p, -1.4f, 0.1f, -0.8f, 1.2f); p->x[B_TORSO] = -0.5f; LIMBS(p, 0.6f, -0.4f, 0.6f, -0.4f); p->z[B_ARM_L] = 0.8f; p->z[B_ARM_R] = -0.8f; p->x[B_HEAD] = 0.4f;
      break;
    case ST_JUMP: case ST_WALLKICK:
      if (a->jumpType == 3 && a->state == ST_JUMP && a->flip < TAU - 0.4f) {
        // the triple jump's somersault: a tight tuck
        LEGS(p, -1.5f, 2.1f, -1.5f, 2.1f); LIMBS(p, -1.7f, -1.3f, -1.7f, -1.3f); p->x[B_TORSO] = 0.6f; p->x[B_HEAD] = 0.4f;
      } else if (a->jumpType == 3 && a->state == ST_JUMP) {
        // out of it: spread out, arms wide
        LEGS(p, -0.3f, 0.4f, 0.2f, 0.3f); LIMBS(p, -1.2f, -0.2f, -1.2f, -0.2f); p->z[B_ARM_L] = 1.2f; p->z[B_ARM_R] = -1.2f;
      } else if (a->jumpType == 2) {
        // the second jump: both fists up
        LEGS(p, -1.0f, 1.5f, 0.35f, 0.7f); LIMBS(p, -2.9f, -0.3f, -2.9f, -0.3f); p->z[B_ARM_L] = 0.25f; p->z[B_ARM_R] = -0.25f; p->x[B_HEAD] = -0.25f;
      } else {
        // the first: one fist up
        LEGS(p, -0.8f, 1.2f, 0.25f, 0.45f); LIMBS(p, 0.45f, -0.4f, -2.75f, -0.1f); p->z[B_ARM_L] = 0.45f; p->x[B_HEAD] = -0.15f;
      }
      if (a->vel.y < -3 && !(a->jumpType == 3 && a->state == ST_JUMP)) { p->z[B_ARM_L] += 0.5f; p->z[B_ARM_R] -= 0.5f; p->x[B_LEG_L] *= 0.6f; }
      if (a->state == ST_WALLKICK) { LEGS(p, -0.3f, 0.6f, -1.2f, 1.6f); LIMBS(p, -2.6f, -0.2f, 0.4f, -0.4f); }
      break;
    case ST_LONGJUMP: {
      float e = ease(t / 0.2f);
      LIMBS(p, -3.0f * e, 0, -3.0f * e, 0); LEGS(p, 0.35f, 0.4f, 0.2f, 0.7f); p->x[B_TORSO] = 0.35f; p->x[B_HEAD] = -0.9f * e;
      p->x[B_FOOT_L] = p->x[B_FOOT_R] = 0.6f;
      break;
    }
    case ST_BACKFLIP: case ST_GPSPIN: case ST_GPFALL: case ST_GPLAND:
      LEGS(p, -1.55f, 2.15f, -1.55f, 2.15f); LIMBS(p, -0.9f, -1.4f, -0.9f, -1.4f); p->x[B_TORSO] = 0.5f;
      if (a->state == ST_GPFALL) { LIMBS(p, -1.6f, -1.8f, -1.6f, -1.8f); p->z[B_ARM_L] = -0.3f; p->z[B_ARM_R] = 0.3f; } // arms crossed, a cannonball
      if (a->state == ST_GPLAND) { p->hipY = -0.55f * (1 - ease(t / 0.32f)); LEGS(p, -1.4f, 1.2f, -1.4f, 1.2f); p->z[B_LEG_L] = 0.5f; p->z[B_LEG_R] = -0.5f; LIMBS(p, -0.3f, -0.4f, -0.3f, -0.4f); p->z[B_ARM_L] = 1.3f; p->z[B_ARM_R] = -1.3f; }
      if (a->state == ST_BACKFLIP && a->flip < -TAU + 0.5f) { LEGS(p, -0.4f, 0.6f, -0.2f, 0.4f); LIMBS(p, -2.6f, -0.2f, -2.6f, -0.2f); }
      break;
    case ST_SIDEFLIP:
      LEGS(p, -0.25f, 0.4f, -0.1f, 0.3f); LIMBS(p, -1.6f, -0.2f, -1.6f, -0.2f); p->z[B_ARM_L] = 1.4f; p->z[B_ARM_R] = -1.4f;
      if (a->roll > TAU - 0.5f) { LIMBS(p, -2.8f, -0.2f, 0.4f, -0.4f); }
      break;
    case ST_FALL: case ST_WALLHIT:
      LIMBS(p, -2.3f + sinf(gt * 15) * 0.45f, -0.4f, -2.3f - sinf(gt * 15) * 0.45f, -0.4f);
      p->z[B_ARM_L] = 0.75f; p->z[B_ARM_R] = -0.75f; LEGS(p, -0.6f + sinf(gt * 11) * 0.3f, 0.9f, 0.1f - sinf(gt * 11) * 0.3f, 0.5f);
      if (a->state == ST_WALLHIT) { p->x[B_TORSO] = -0.35f; LIMBS(p, -1.6f, 0, -1.6f, 0); p->z[B_ARM_L] = 1.45f; p->z[B_ARM_R] = -1.45f; LEGS(p, 0.1f, 0.2f, 0.1f, 0.2f); }
      break;
    case ST_AIRKICK:
      LEGS(p, -1.65f, 0.1f, 0.55f, 1.4f); LIMBS(p, -0.4f, -0.6f, 0.6f, -0.6f); p->z[B_ARM_L] = 0.9f; p->z[B_ARM_R] = -0.9f; p->x[B_TORSO] = -0.25f;
      break;
    case ST_DIVE: case ST_BELLYSLIDE:
      LIMBS(p, -3.05f, 0, -3.05f, 0); LEGS(p, 0.15f, 0.2f, 0.1f, 0.4f); p->x[B_HEAD] = -1.1f; p->x[B_FOOT_L] = p->x[B_FOOT_R] = 0.7f;
      if (a->state == ST_BELLYSLIDE) { p->x[B_SHIN_L] = p->x[B_SHIN_R] = 0.9f; }
      break;
    case ST_BUTTSLIDE:
      p->hipY = -0.62f; LEGS(p, -1.5f, 0.2f, -1.5f, 0.2f); p->x[B_TORSO] = -0.25f; LIMBS(p, 0.3f, -0.3f, 0.3f, -0.3f); p->z[B_ARM_L] = 0.9f; p->z[B_ARM_R] = -0.9f;
      break;
    case ST_HARDLAND:
      p->hipY = -0.3f * (1 - ease(t / 0.28f)); LEGS(p, -0.8f, 1.6f, -0.8f, 1.6f); p->x[B_TORSO] = 0.6f; LIMBS(p, -0.5f, -0.4f, -0.5f, -0.4f);
      break;
    case ST_HURT:
      p->x[B_TORSO] = -0.4f; p->x[B_HEAD] = 0.3f; LIMBS(p, -0.5f, -1.2f, -0.5f, -1.2f); p->z[B_ARM_L] = 0.7f; p->z[B_ARM_R] = -0.7f; LEGS(p, 0.2f, 0.3f, -0.3f, 0.4f);
      break;
    case ST_DANCE: {
      // the victory dance: a hop and a spin, then a fist pumped high
      if (t < 1.4f) { LEGS(p, -0.6f, 1.0f, 0.2f, 0.4f); LIMBS(p, -2.9f, -0.2f, -2.9f, -0.2f); p->z[B_ARM_L] = 0.35f; p->z[B_ARM_R] = -0.35f; }
      else { LIMBS(p, 0.2f, -0.4f, -2.9f + 0.25f * sinf(t * 18), -0.3f); p->z[B_ARM_L] = 0.4f; p->x[B_HEAD] = -0.3f; LEGS(p, -0.15f, 0.2f, 0.15f, 0.2f); p->y[B_TORSO] = 0.3f; }
      break;
    }
    case ST_KNOCKED: case ST_DOWN: case ST_DEAD:
      LIMBS(p, -1.2f, -0.3f, -1.0f, -0.2f); p->z[B_ARM_L] = 1.3f; p->z[B_ARM_R] = -1.2f;
      LEGS(p, -0.35f, 0.4f, 0.15f, 0.1f); p->z[B_LEG_L] = 0.2f; p->z[B_LEG_R] = -0.2f;
      if (a->state == ST_KNOCKED) { p->x[B_LEG_L] += sinf(gt * 14) * 0.4f; p->x[B_ARM_R] += sinf(gt * 12) * 0.5f; }
      break;
    case ST_SWIM: {
      if (a->stroke > 0) {
        // the breaststroke: hands together forward, a wide sweep back, tucked, then a frog kick
        float k = 1 - a->stroke / 0.6f;
        float sweep = ease(k / 0.45f), tuck = ease((k - 0.45f) / 0.25f), reach = ease((k - 0.7f) / 0.3f);
        float arm = -3.0f + 1.6f * sweep - 0.2f * tuck - 1.4f * reach;
        LIMBS(p, arm, -0.2f - 1.3f * tuck * (1 - reach), arm, -0.2f - 1.3f * tuck * (1 - reach));
        p->z[B_ARM_L] = 0.2f + 1.3f * sweep * (1 - tuck); p->z[B_ARM_R] = -p->z[B_ARM_L];
        float kick = ease((k - 0.35f) / 0.3f) * (1 - ease((k - 0.75f) / 0.25f));
        LEGS(p, -0.9f * kick, 1.9f * kick, -0.9f * kick, 1.9f * kick); p->z[B_LEG_L] = 0.5f * kick; p->z[B_LEG_R] = -0.5f * kick;
        p->x[B_HEAD] = -0.9f;
      } else if (a->speed > 0.8f) {
        // the flutter kick: arms out in front, the legs beating
        float s = sinf(gt * 16);
        LIMBS(p, -3.05f, 0, -3.05f, 0); p->z[B_ARM_L] = 0.15f; p->z[B_ARM_R] = -0.15f;
        LEGS(p, 0.35f * s, 0.25f + 0.2f * maxf(0, s), -0.35f * s, 0.25f + 0.2f * maxf(0, -s));
        p->x[B_HEAD] = -0.9f;
      } else {
        // treading water: arms paddling round, the legs pedalling
        float s = sinf(gt * 4.0f), c2 = cosf(gt * 4.0f);
        LIMBS(p, -1.2f + s * 0.25f, -0.9f, -1.2f - s * 0.25f, -0.9f); p->z[B_ARM_L] = 0.9f + c2 * 0.35f; p->z[B_ARM_R] = -0.9f + c2 * 0.35f;
        LEGS(p, -0.5f + s * 0.4f, 0.8f + c2 * 0.4f, -0.5f - s * 0.4f, 0.8f - c2 * 0.4f);
        p->x[B_HEAD] = -0.3f;
      }
      break;
    }
    case ST_LEDGE: case ST_LEDGECLIMB: {
      float sw = sinf(gt * 2.0f) * 0.12f;
      LIMBS(p, -3.0f, 0.05f, -3.0f, 0.05f); p->z[B_ARM_L] = -0.15f; p->z[B_ARM_R] = 0.15f;
      LEGS(p, 0.1f + sw, 0.25f, 0.05f - sw, 0.35f); p->x[B_HEAD] = -0.2f;
      if (a->state == ST_LEDGECLIMB) { float k = ease(t / 0.45f); LIMBS(p, -3.0f + 2.2f * k, -1.4f * k, -3.0f + 2.2f * k, -1.4f * k); LEGS(p, -1.6f * k, 1.8f * k, -0.6f * k, 0.8f * k); p->x[B_TORSO] = 0.7f * k; }
      break;
    }
    case ST_POLE: {
      float s = sinf(a->animPhase);
      LIMBS(p, -2.7f + s * 0.3f, -0.6f, -2.7f - s * 0.3f, -0.6f); p->z[B_ARM_L] = -0.45f; p->z[B_ARM_R] = 0.45f;
      LEGS(p, -1.0f - s * 0.3f, 1.4f, -1.0f + s * 0.3f, 1.4f); p->z[B_LEG_L] = -0.3f; p->z[B_LEG_R] = 0.3f;
      p->x[B_TORSO] = 0.15f;
      break;
    }
    case ST_VEHICLE: {
      bool bike = a->vehicle && vehicle_is_bike(a->vehicle);
      float pedal = a->vehicle ? a->vehicle->wheelSpin : 0;
      LEGS(p, bike ? -1.2f + sinf(pedal) * 0.35f : -1.5f, bike ? 1.1f + cosf(pedal) * 0.4f : 1.45f, bike ? -1.2f - sinf(pedal) * 0.35f : -1.5f, bike ? 1.1f - cosf(pedal) * 0.4f : 1.45f);
      if (a->vehicle && g_vdefs[a->vehicle->def].motor) { LEGS(p, -1.1f, 1.2f, -1.1f, 1.2f); }
      p->z[B_LEG_L] = bike ? 0.18f : 0.05f; p->z[B_LEG_R] = -p->z[B_LEG_L];
      LIMBS(p, -1.15f, -0.3f, -1.15f, -0.3f); p->x[B_TORSO] = bike ? 0.45f : 0.02f;
      float st = a->vehicle ? a->vehicle->steer : 0;
      p->y[B_TORSO] = st * 0.2f; p->y[B_HEAD] = st * 0.3f;
      if (a->seat > 0 && !(a->ctl.aim)) { LIMBS(p, -0.4f, -1.0f, -0.4f, -1.0f); p->y[B_HEAD] = sinf(gt * 0.7f) * 0.5f; }
      break;
    }
  }
  // holding a gun: the arms point it at what is aimed at (or hold it low)
  bool busy = a->state == ST_DEAD || a->state == ST_KNOCKED || a->state == ST_DOWN || a->state == ST_SWIM || (a->state >= ST_DIVE && a->state <= ST_BELLYSLIDE) || a->state == ST_PUNCH || a->state >= ST_LEDGE;
  if (weapon_is_gun(a->weapon) && !busy) {
    bool aiming = a->ctl.aim || a->fireTimer > 0 || a->muzzle > 0;
    if (a->state == ST_VEHICLE && !aiming) return;
    float up = 0, turn = 0;
    if (aiming) {
      V3 to = v3_sub(a->ctl.aimAt, actor_chest(a)); up = atan2f(to.y, maxf(0.5f, v3_len_xz(to)));
      if (a->state == ST_VEHICLE) turn = angle_diff(dir_yaw(to.x, to.z), a->yaw); // out of the window
    }
    bool two = weapon_two_handed(a->weapon);
    if (aiming) {
      p->x[B_ARM_R] = -PI / 2 - up; p->x[B_FORE_R] = 0; p->z[B_ARM_R] = 0.05f; p->y[B_ARM_R] = 0;
      if (two) { p->x[B_ARM_L] = -PI / 2 - up * 0.9f + 0.15f; p->x[B_FORE_L] = -0.4f; p->z[B_ARM_L] = -0.6f; }
      if (a->muzzle > 0) { p->x[B_ARM_R] += 0.22f; if (two) p->x[B_ARM_L] += 0.18f; }
      p->y[B_TORSO] += clampf(turn, -1.4f, 1.4f) * 0.8f; p->y[B_HEAD] += clampf(turn, -1.4f, 1.4f) * 0.3f;
    } else if (!ST_IS_AIR(a->state)) {
      p->x[B_ARM_R] = -0.35f; p->x[B_FORE_R] = -0.9f;
      if (two) { p->x[B_ARM_L] = -0.6f; p->x[B_FORE_L] = -1.1f; p->z[B_ARM_L] = -0.4f; }
    }
  }
}

static void animate(Actor *a) {
  Pose target; pose_target(a, &target);
  // blend: fast into the action poses, a little softer into runs and idles
  float k = (a->state == ST_RUN || a->state == ST_IDLE) ? 0.3f : 0.45f;
  if (a->stateTime < DT * 1.5f && (a->state == ST_PUNCH || a->state == ST_JUMP)) k = 0.6f;
  Pose *c = &a->pose;
  for (int i = 0; i < NBONES; i++) { c->x[i] = lerpf(c->x[i], target.x[i], k); c->y[i] = lerpf(c->y[i], target.y[i], k); c->z[i] = lerpf(c->z[i], target.z[i], k); }
  c->hipY = lerpf(c->hipY, target.hipY, k);
  T3DSkeleton *s = &a->skel;
  for (int i = 0; i < NBONES; i++) {
    Quat q = quat_euler(c->x[i], c->y[i], c->z[i]);
    s->bones[i].rotation = (T3DQuat){{q.x, q.y, q.z, q.w}};
    s->bones[i].hasChanged = true;
  }
  s->bones[B_HIPS].position.v[1] = s_rest[B_HIPS].y + c->hipY * 64.0f;
  t3d_skeleton_update(s);
}

static void draw_shadow(V3 pos, float size) {
  float fl = world_floor(pos.x, pos.z, pos.y + 0.3f, NULL);
  if (pos.y - fl > 14) return;
  float k = clampf(1 - (pos.y - fl) / 14, 0.3f, 1);
  T3DMat4 m;
  mat_place(&m, (V3){pos.x, fl, pos.z}, 0, 0, 0, 0, size * k * MODEL_SCALE);
  // on the floor's plane with the decal depth test: no flicker (over an edge the part off the floor hides)
  rdpq_mode_zmode(ZMODE_DECAL);
  render_colored(g_models.shadow, &m, RGBA32(0, 0, 0, 255));
  rdpq_mode_zmode(ZMODE_STANDARD);
}

static void pal_cb(void *user, const T3DMaterial *mat, rdpq_texparms_t *tp, rdpq_tile_t tile) {
  (void)mat;
  Actor *a = user;
  rdpq_tex_upload(tile, &a->palette, tp);
}

void actor_draw(Actor *a) {
  if (!a->used) return;
  float d2 = v3_dist2_xz(a->pos, g_view.eye);
  bool me = a->kind == AK_PLAYER;
  if (!me && d2 > 62.0f * 62.0f) return;
  T3DVec3 c = {{a->pos.x, a->pos.y + 0.9f, a->pos.z}};
  if (!t3d_frustum_vs_sphere(&g_view.frustum, &c, 1.4f)) return;

  float sp = a->state == ST_POLE ? 0 : v3_len_xz(a->vel);
  a->animPhase += sp * DT * (sp > 5 ? 1.05f : 1.6f);
  float lr = a->drawNear ? 18.5f : 17.0f; // (a margin: no blinking between the two models on the line)
  bool near = a->drawNear = me || d2 < lr * lr;
  // far people move less often (the skeleton is the costly part)
  if (near || ((g.frame + a->id) & 1) == 0) animate(a);

  float pivot = 0.82f * a->look.height, flip = a->flip, roll = a->roll, dy = 0, spin = 0;
  if (a->state == ST_DOWN || a->state == ST_DEAD || (a->state == ST_KNOCKED && a->onGround)) { flip = -1.5f; dy = -0.62f; }
  if (a->state == ST_DEAD && !a->onGround) flip = -1.5f * minf(1, a->stateTime * 3);
  if (a->state == ST_GETUP) { flip = -1.5f * (1 - a->stateTime / 0.45f); dy = -0.62f * (1 - a->stateTime / 0.45f); }
  if (a->state == ST_BELLYSLIDE) { flip = 1.45f; dy = -0.62f; }
  if (a->state == ST_SLIDEKICK) { flip = -1.0f; dy = -0.35f; }
  if (a->state == ST_SWIM) {
    // swimming: lying along the stroke (tipped with the dive), upright when treading water
    bool tread = a->stroke <= 0 && a->speed < 0.8f;
    float want = tread ? 0.3f : 1.35f - a->pitch * 0.9f;
    a->animBlend = lerpf(a->animBlend, want, 0.15f);
    flip = a->animBlend; dy = tread ? 0.05f : 0.3f;
  } else a->animBlend = 0;
  if (a->state == ST_SWEEP) spin = a->stateTime * (TAU / 0.45f);
  if (a->state == ST_DANCE && a->stateTime < 1.4f) spin = ease(a->stateTime / 1.1f) * TAU;
  V3 pos = a->pos; pos.y += dy;
  T3DMat4 m;
  float sc = MODEL_SCALE * a->look.height;
  if (a->state == ST_VEHICLE && a->vehicle) vehicle_rider_matrix(a->vehicle, a, &m);
  else {
    mat_place(&m, pos, a->yaw + spin, flip, roll, pivot, sc);
    // a wider body for the stocky; squash and stretch (round the feet)
    for (int k = 0; k < 3; k++) m.m[0][k] *= a->look.width;
    if (flip == 0 && roll == 0) { float sq = a->squash; for (int k = 0; k < 3; k++) { m.m[1][k] *= sq; m.m[0][k] *= 1.0f / sqrtf(sq); m.m[2][k] *= 1.0f / sqrtf(sq); } }
  }
  render_light_lit();
  bool flash = a->hurt > 0 && ((int)(a->hurt * 20) & 1);
  T3DModel *model = me ? g_models.hero : near ? g_models.person : g_models.personFar;
  t3d_matrix_push(render_mat(&m));
  t3d_skeleton_use(&a->skel);
  T3DModelDrawConf conf = {.userData = a, .dynTextureCb = pal_cb, .matrices = (const T3DMat4FP *)t3d_segment_placeholder(T3D_SEGMENT_SKELETON)};
  T3DModelState st = t3d_model_state_create();
  st.drawConf = &conf;
  T3DModelIter it = t3d_model_iter_create(model, T3D_CHUNK_TYPE_OBJECT);
  while (t3d_model_iter_next(&it)) {
    t3d_model_draw_material(it.object->material, &st);
    // the city's textures are palette (CI) textures: the palette mode they leave on must be off here
    rdpq_mode_tlut(TLUT_NONE);
    rdpq_set_prim_color(flash ? RGBA32(255, 110, 110, 255) : RGBA32(255, 255, 255, 255));
    t3d_model_draw_object(it.object, conf.matrices);
  }
  t3d_matrix_pop(1);

  // the weapon in the right hand
  if (a->weapon != W_FIST && g_models.weapon[a->weapon] && a->state != ST_SWIM && a->state < ST_LEDGE && near) {
    T3DMat4x3 *bm = &a->skel.bones[B_HAND_R].matrix;
    T3DMat4 b4;
    for (int col = 0; col < 4; col++) { for (int r = 0; r < 3; r++) b4.m[col][r] = bm->m[col][r]; b4.m[col][3] = col == 3 ? 1 : 0; }
    T3DMat4 hand, w, out;
    // the grip in the fist, the barrel along the forearm
    mat_place(&hand, (V3){0, -0.06f * 64, 0.02f * 64}, 0, PI / 2, 0, 0, 1.0f);
    if (a->weapon == W_LAUNCHER) { T3DMat4 r; mat_place(&r, (V3){0, 0, 0}, 0, PI / 2, 0, 0, 1); mat_mul(&hand, &hand, &r); }
    if (a->weapon == W_BAT) mat_place(&hand, (V3){0, -0.04f * 64, 0.02f * 64}, 0, PI, 0, 0, 1.0f);
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
  if (a->state != ST_VEHICLE && a->state != ST_SWIM && a->state != ST_POLE && a->state != ST_LEDGE && (near || d2 < 30 * 30)) draw_shadow(a->pos, a->state == ST_DEAD || a->state == ST_DOWN ? 0.9f : 0.55f);
}
