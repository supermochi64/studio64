#include "ai.h"
#include "actor.h"
#include "vehicle.h"
#include "weapon.h"
#include "world.h"
#include "gang.h"
#include "sound.h"

// ---- hearing shots ----
static void on_gunshot(V3 at, Actor *shooter) {
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!actor_alive(a) || a == shooter || a->kind == AK_PLAYER) continue;
    float d = v3_dist(a->pos, at);
    if (d > 38) continue;
    if (a->kind == AK_CIVILIAN) { a->scared = true; a->alert = 9; a->goal = at; continue; }
    if (a->kind == AK_COP && shooter && shooter->kind == AK_PLAYER) { a->foe = actor_index(shooter); gang_crime(d < 25 ? 0.25f : 0.1f); continue; }
    if (a->recruited) continue;
    if (a->kind == AK_GANG && shooter && a->foe < 0 && gang_hostile(a, shooter)) a->foe = actor_index(shooter);
  }
  // drivers near shots speed off
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (v->used && v->aiDriven && v3_dist(v->pos, at) < 30 && !g_vdefs[v->def].police) v->panic = true;
  }
}
void ai_init(void) { g_on_gunshot = on_gunshot; }

// ---- moving ----
static void move_to(Actor *a, V3 to, bool run) {
  V3 d = v3_sub(to, a->pos); d.y = 0;
  float l = v3_len(d);
  if (l < 0.05f) return;
  V3 dir = v3_scale(d, 1 / l);
  // a wall in the way: go round it (to the side the wall's normal points)
  if (a->wallNormal.x != 0 || a->wallNormal.z != 0) {
    V3 n = a->wallNormal, side = {-n.z, 0, n.x};
    if (v3_dot(side, dir) < 0) side = v3_scale(side, -1);
    dir = v3_norm(v3_add(v3_scale(dir, 0.3f), side));
    // a low wall or a fence: jump it
    if (a->onGround && (a->state == ST_RUN || a->state == ST_IDLE) && rnd() < 0.08f) a->ctl.jump = a->ctl.jumpHeld = true;
  }
  a->ctl.move = dir;
  a->ctl.walk = !run;
}

static Actor *foe_of(Actor *a) {
  if (a->foe < 0) return NULL;
  Actor *f = &g.actors[a->foe];
  if (!actor_alive(f) || v3_dist(f->pos, a->pos) > 70) { a->foe = -1; return NULL; }
  return f;
}

static int scan_hostile(Actor *a, float range) {
  int best = -1; float bd = range;
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *o = &g.actors[i];
    if (o == a || !actor_alive(o) || !gang_hostile(a, o)) continue;
    float d = v3_dist(o->pos, a->pos);
    if (d < bd && world_los(actor_head(a), actor_chest(o))) { bd = d; best = i; }
  }
  return best;
}

static void fight(Actor *a, Actor *f) {
  Controls *c = &a->ctl;
  float d = v3_dist(a->pos, f->pos);
  bool gun = weapon_is_gun(a->weapon) && (a->clip[a->weapon] + a->ammo[a->weapon]) > 0;
  if (!gun && weapon_is_gun(a->weapon)) weapon_select(a, 1);
  V3 fc = actor_chest(f);
  if (gun) {
    bool see = world_los(actor_chest(a), fc);
    if (d > 15 || !see) move_to(a, f->pos, true);
    else if (d < 4.5f) move_to(a, v3_sub(a->pos, v3_sub(f->pos, a->pos)), true);
    else if (fmodf(a->think, 3.0f) < 1.0f) {
      // strafe a little round the target
      V3 to = v3_norm(v3_sub(f->pos, a->pos));
      c->move = v3_scale((V3){-to.z, 0, to.x}, (a->id & 1) ? 0.7f : -0.7f);
    }
    // aim with an error that shrinks while it keeps aiming (and grows with the distance)
    if (a->timer2 <= 0) { a->timer2 = 0.45f; float e = 0.25f + d * 0.035f; a->goal = (V3){rnd_range(-e, e), rnd_range(-e, e) * 0.6f, rnd_range(-e, e)}; }
    a->timer2 -= DT;
    c->aim = true;
    c->aimAt = v3_add(fc, a->goal);
    if (see && d < g_weapons[a->weapon].range && a->alert > 0.6f) {
      bool burst = fmodf(a->think + a->id * 0.37f, 2.2f) < (a->kind == AK_COP ? 1.0f : 1.3f);
      c->attackHeld = burst;
      c->attack = burst && (a->fireTimer <= 0) && rnd() < 0.6f;
    }
  } else {
    if (d > 1.1f) move_to(a, f->pos, true);
    else { c->face = true; V3 to = v3_sub(f->pos, a->pos); c->faceYaw = dir_yaw(to.x, to.z); if (fmodf(a->think, 0.8f) < DT * 1.5f) c->attack = true; }
  }
  a->alert += DT;
}

// ---- brains ----
static void walk(Actor *a) {
  World *w = &g_world;
  if (a->node < 0) { a->node = world_nearest_walk(a->pos.x, a->pos.z); a->prevNode = -1; }
  if (a->node < 0) return;
  WalkNode *n = &w->wnodes[a->node];
  V3 to = {n->x, a->pos.y, n->z};
  if (v3_dist_xz(to, a->pos) < 1.3f) {
    int cnt = w->wnodeEdgeCount[a->node];
    int pick = -1, tries = 0;
    while (cnt && tries++ < 6) {
      const WalkEdge *e = &w->wedges[w->wnodeEdges[a->node * 6 + rnd_int(cnt)]];
      int other = e->a == a->node ? e->b : e->a;
      if (other != a->prevNode || cnt == 1) { pick = other; break; }
    }
    a->prevNode = a->node;
    if (pick >= 0) a->node = pick;
    return;
  }
  // walk on the side of the sidewalk (people pass each other)
  move_to(a, to, false);
}

static void flee(Actor *a) {
  V3 away = v3_sub(a->pos, a->goal); away.y = 0;
  if (v3_len(away) < 0.1f) away = yaw_dir(a->yaw);
  move_to(a, v3_add(a->pos, v3_scale(v3_norm(away), 10)), true);
  a->alert -= DT;
  if (a->alert <= 0) { a->scared = false; a->node = -1; }
}

static void hang(Actor *a) {
  // stand round the spot, now and then step about, face each other
  float d = v3_dist_xz(a->pos, a->home);
  if (d > 3.5f) move_to(a, a->home, false);
  else if (fmodf(a->think + a->id, 9.0f) < 1.2f) move_to(a, v3_add(a->home, (V3){sinf(a->id * 1.7f) * 2, 0, cosf(a->id * 1.3f) * 2}), false);
  else { a->ctl.face = true; a->ctl.faceYaw = a->yaw + sinf(a->think * 0.3f + a->id) * 0.02f; }
  // a rival crew sees the player on its turf
  Actor *p = g.player;
  if (actor_alive(p) && a->kind == AK_GANG && gang_hostile(a, p) && !p->vehicle) {
    float dp = v3_dist(p->pos, a->pos);
    if (dp < 20 && world_los(actor_head(a), actor_chest(p))) { a->foe = actor_index(p); a->alert = 0; }
  }
}

static void follow(Actor *a) {
  Actor *p = g.player;
  if (!actor_alive(p)) return;
  // with the player in a car: get in too (or keep riding)
  if (p->vehicle && p->state == ST_VEHICLE) {
    if (!a->vehicle) {
      int s = vehicle_free_seat(p->vehicle, true);
      if (s > 0) {
        V3 door = vehicle_door(p->vehicle, s);
        if (v3_dist_xz(door, a->pos) < 1.6f && fabsf(p->vehicle->speed) < 3) vehicle_enter(a, p->vehicle, s);
        else move_to(a, door, true);
      }
    }
    return;
  }
  if (a->vehicle && a->state == ST_VEHICLE) { vehicle_exit(a); return; }
  float d = v3_dist(a->pos, p->pos);
  if (d > 70) {
    // left far behind: catch up out of sight
    V3 back = v3_sub(p->pos, v3_scale(yaw_dir(p->yaw), 6));
    a->pos = (V3){back.x, world_floor(back.x, back.z, p->pos.y + 2, NULL), back.z};
    return;
  }
  // a place behind the player (slot by slot)
  static const float SX[4] = {1.4f, -1.4f, 2.6f, -2.6f}, SZ[4] = {-1.6f, -1.6f, -2.8f, -2.8f};
  int s = maxi(0, a->followSlot);
  V3 f = yaw_dir(p->yaw), r = {f.z, 0, -f.x};
  V3 spot = {p->pos.x + r.x * SX[s] + f.x * SZ[s], p->pos.y, p->pos.z + r.z * SX[s] + f.z * SZ[s]};
  float ds = v3_dist_xz(spot, a->pos);
  if (ds > 1.0f) move_to(a, spot, ds > 3.5f || v3_len_xz(p->vel) > 3);
  else { a->ctl.face = true; a->ctl.faceYaw = p->yaw; }
  // jump when the player jumps, so they keep up on roofs
  if (!p->onGround && p->vel.y > 8 && a->onGround && d < 6) a->ctl.jump = a->ctl.jumpHeld = true;
}

static void cop(Actor *a) {
  Actor *p = g.player;
  if (g.wanted > 0 && actor_alive(p)) {
    a->foe = actor_index(p);
    if (g.wanted <= 1) {
      // one star: come and arrest (no shooting)
      if (a->weapon != W_FIST && g.wanted <= 1) a->weapon = W_FIST;
      float d = v3_dist(a->pos, p->pos);
      if (d > 1.2f) move_to(a, p->pos, true);
      if (d < 1.6f && !p->vehicle && v3_len_xz(p->vel) < 2.5f && actor_can_act(p)) {
        a->timer2 += DT;
        if (a->timer2 > 1.4f && g.deadTimer <= 0) { g.deadTimer = 4; g.deadKind = 2; game_big("ARRESTED"); sound_play_ui(SND_WASTED); }
      } else a->timer2 = 0;
      return;
    }
    if (!weapon_is_gun(a->weapon)) weapon_select(a, 1);
    fight(a, p);
    return;
  }
  walk(a);
}

void ai_think(Actor *a) {
  Controls *c = &a->ctl;
  memset(c, 0, sizeof(*c));
  a->think += DT;
  if (!actor_alive(a) || a->brain == 99) return;
  if (a->state == ST_ENTER || a->state == ST_EXIT) return;

  // in a vehicle
  if (a->vehicle && a->state == ST_VEHICLE) {
    Vehicle *v = a->vehicle;
    if (a->seat == 0 && !a->recruited) {
      vehicle_ai_drive(v);
      // a police car next to the wanted player: out and after them
      if (a->kind == AK_COP && g.wanted >= 2 && actor_alive(g.player) && v3_dist(v->pos, g.player->pos) < 14 && fabsf(v->speed) < 4) { vehicle_exit(a); a->brain = BR_COP; }
      if (v->burning || v->wrecked || v->health < 120) vehicle_exit(a);
      return;
    }
    // a passenger: shoots out of the window at whoever fights the crew
    Actor *f = foe_of(a);
    if (!f && fmodf(a->think, 0.6f) < DT) { int i = scan_hostile(a, 30); if (i >= 0) a->foe = i; f = foe_of(a); }
    if (a->recruited && g.player && !g.player->vehicle) { vehicle_exit(a); return; }
    if (f && weapon_is_gun(a->weapon)) {
      c->aim = true; c->aimAt = v3_add(actor_chest(f), (V3){rnd_range(-0.4f, 0.4f), 0, rnd_range(-0.4f, 0.4f)});
      c->attackHeld = fmodf(a->think + a->id, 2.0f) < 1.1f; c->attack = c->attackHeld && rnd() < 0.5f;
    }
    return;
  }

  if (a->recruited) {
    // the crew fights what the player aims at, or whoever attacks
    Actor *p = g.player;
    if (p && p->target >= 0 && gang_hostile(p, &g.actors[p->target]) && v3_dist(g.actors[p->target].pos, a->pos) < 40) a->foe = p->target;
    Actor *f = foe_of(a);
    if (!f && fmodf(a->think + a->id * 0.21f, 0.5f) < DT) { int i = scan_hostile(a, 26); if (i >= 0) a->foe = i; f = foe_of(a); }
    if (f && !(p && p->vehicle) && v3_dist(a->pos, p->pos) < 35) fight(a, f);
    else follow(a);
    return;
  }

  if (a->scared && a->kind == AK_CIVILIAN) { flee(a); return; }
  if (a->kind == AK_COP || a->brain == BR_COP) { cop(a); return; }
  Actor *f = foe_of(a);
  if (!f && a->kind == AK_GANG && fmodf(a->think + a->id * 0.13f, 0.7f) < DT) {
    int i = scan_hostile(a, a->warrior ? 70 : 22);
    if (i >= 0) a->foe = i;
    f = foe_of(a);
  }
  if (f && (a->kind != AK_CIVILIAN || a->hostile)) { fight(a, f); return; }
  if (a->warrior && actor_alive(g.player)) { move_to(a, g.player->pos, true); return; }
  if (a->brain == BR_HANG) hang(a);
  else walk(a);
}
