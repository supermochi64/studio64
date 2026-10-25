#include "population.h"
#include "actor.h"
#include "vehicle.h"
#include "weapon.h"
#include "world.h"
#include "gang.h"
#include "ai.h"
#include "pickup.h"

#define PEOPLE_TARGET 16
#define TRAFFIC_TARGET 7
#define PARKED_TARGET 5

static float s_timer, s_vtimer;

void population_init(void) { s_timer = 0; s_vtimer = 0; }

static bool in_view(V3 p, float margin) {
  T3DVec3 c = {{p.x, p.y + 1, p.z}};
  return t3d_frustum_vs_sphere(&g_view.frustum, &c, margin);
}

static void arm(Actor *a) {
  if (a->kind == AK_GANG) {
    int w = g_gangs[a->gang].weapons[rnd_int(3)];
    if (rnd() < 0.75f) weapon_give(a, w, 90);
  } else if (a->kind == AK_COP) weapon_give(a, rnd() < 0.8f ? W_PISTOL : W_SHOTGUN, 60);
  else if (rnd() < 0.05f) weapon_give(a, W_PISTOL, 20);
}

Actor *population_spawn_person(V3 at, float yaw, int kind, int gang) {
  Actor *a = actor_spawn(kind, gang, at, yaw);
  if (!a) return NULL;
  a->brain = kind == AK_COP ? BR_COP : BR_WALK;
  a->home = at;
  arm(a);
  return a;
}

int population_spawn_attackers(int gang, V3 near, int count) {
  int n = 0;
  for (int k = 0; k < count; k++) {
    // round the player, 35-55 m away, on a sidewalk
    int node = -1;
    for (int tries = 0; tries < 20 && node < 0; tries++) {
      int i = rnd_int(g_world.nwnode);
      float d = sqrtf(sqrf(g_world.wnodes[i].x - near.x) + sqrf(g_world.wnodes[i].z - near.z));
      if (d > 30 && d < 60) node = i;
    }
    if (node < 0) continue;
    V3 p = {g_world.wnodes[node].x, 0, g_world.wnodes[node].z};
    p.y = world_floor(p.x, p.z, world_terrain(p.x, p.z) + 2.5f, NULL); // the street (not a roof above it)
    // make room: the farthest ordinary person out of sight goes
    Actor *a = population_spawn_person(p, 0, AK_GANG, gang);
    if (!a) {
      Actor *far = NULL; float fd = 25;
      for (int i = 0; i < MAX_ACTORS; i++) {
        Actor *o = &g.actors[i];
        if (!o->used || o->kind != AK_CIVILIAN || o->vehicle || o->recruited) continue;
        float d = v3_dist_xz(o->pos, near);
        if (d > fd && !in_view(o->pos, 2)) { fd = d; far = o; }
      }
      if (far) { actor_free(far); a = population_spawn_person(p, 0, AK_GANG, gang); }
    }
    if (!a) continue;
    a->warrior = true; a->brain = BR_WAR;
    weapon_give(a, rnd() < 0.5f ? W_SMG : W_PISTOL, 120);
    a->foe = actor_index(g.player);
    n++;
  }
  return n;
}

void population_on_death(Actor *a, Actor *by) {
  (void)by;
  // what they carried: cash, and their gun
  int cash = a->kind == AK_CIVILIAN ? 5 + rnd_int(40) : a->kind == AK_GANG ? 20 + rnd_int(80) : 30 + rnd_int(50);
  pickup_drop(PK_CASH, a->pos, cash);
  if (weapon_is_gun(a->weapon)) pickup_drop(PK_WEAPON0 + a->weapon, v3_add(a->pos, (V3){0.6f, 0, 0}), mini(a->ammo[a->weapon] + a->clip[a->weapon], g_weapons[a->weapon].startAmmo));
}

void population_clear(void) {
  for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].used && &g.actors[i] != g.player && !g.actors[i].recruited) actor_free(&g.actors[i]);
  for (int i = 0; i < MAX_VEHICLES; i++) if (g.vehicles[i].used) {
    Vehicle *v = &g.vehicles[i];
    bool keep = false;
    for (int s = 0; s < 4; s++) if (v->seat[s] && (v->seat[s] == g.player || v->seat[s]->recruited)) keep = true;
    if (!keep) vehicle_free(v);
  }
}

static int count_people(int kind) { int n = 0; for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].used && g.actors[i].kind == kind && actor_alive(&g.actors[i])) n++; return n; }

static void spawn_people(V3 c) {
  int alive = 0;
  for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].used && g.actors[i].kind != AK_PLAYER && !g.actors[i].vehicle) alive++;
  if (alive >= PEOPLE_TARGET) return;
  // a hangout of a gang, or a person walking the sidewalk
  bool hang = rnd() < 0.35f;
  if (hang) {
    int s = world_find_spot(SPOT_HANGOUT, c, 28, 65, 0);
    if (s >= 0) {
      Spot *sp = &g_world.spots[s];
      V3 p = {sp->x, 0, sp->z};
      if (in_view(p, 2) && v3_dist_xz(p, c) < 35 && g.time > 2) return;
      int owner = gang_block_owner(sp->district);
      if (!owner) return;
      int group = 2 + rnd_int(2);
      for (int k = 0; k < group; k++) {
        V3 q = {p.x + rnd_range(-2, 2), 0, p.z + rnd_range(-2, 2)};
        q.y = world_floor(q.x, q.z, 3, NULL);
        Actor *a = population_spawn_person(q, rnd_range(-PI, PI), AK_GANG, owner);
        if (a) { a->brain = BR_HANG; a->home = q; }
      }
      return;
    }
  }
  int node = -1;
  for (int tries = 0; tries < 12 && node < 0; tries++) {
    int i = rnd_int(g_world.nwnode);
    V3 p = {g_world.wnodes[i].x, 0.2f, g_world.wnodes[i].z};
    float d = v3_dist_xz(p, c);
    if (d < 22 || d > 70) continue;
    if (in_view(p, 1.5f) && d < 38 && g.time > 2) continue; // (the first moments: fill the streets round the start)
    node = i;
  }
  if (node < 0) return;
  V3 p = {g_world.wnodes[node].x, 0, g_world.wnodes[node].z};
  p.y = world_floor(p.x, p.z, 5, NULL);
  int b = world_block(p.x, p.z);
  int owner = gang_block_owner(b);
  char d = b >= 0 ? g_world.dmap[b] : 'B';
  int kind = AK_CIVILIAN, gang = GANG_NONE;
  if (owner && rnd() < 0.45f) { kind = AK_GANG; gang = owner; }
  else if ((d == 'D' || d == 'C') && rnd() < 0.08f && count_people(AK_COP) < 2) kind = AK_COP;
  Actor *a = population_spawn_person(p, 0, kind, kind == AK_COP ? GANG_COPS : gang);
  if (a) { a->node = node; a->prevNode = -1; }
}

static int random_vehicle_for(int block, bool parked) {
  int owner = gang_block_owner(block);
  char d = block >= 0 && block < 81 ? g_world.dmap[block] : 'B';
  float r = rnd();
  if (owner && r < 0.35f) return VD_LOWRIDER;
  if (d == 'I' && r < 0.5f) return rnd() < 0.5f ? VD_PICKUP : VD_VAN;
  if (d == 'D' && r < 0.25f) return VD_TAXI;
  if (parked && r < 0.12f) return rnd() < 0.5f ? VD_BMX : VD_MOTOR;
  if (r < 0.1f) return VD_SPORTS;
  if (r < 0.2f) return VD_PICKUP;
  if (r < 0.27f) return VD_VAN;
  if (r < 0.32f) return VD_MOTOR;
  return VD_SEDAN;
}

static void spawn_traffic(V3 c) {
  int moving = 0, parked = 0, police = 0;
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (!v->used) continue;
    if (v->aiDriven && v->seat[0]) moving++; else if (!v->seat[0]) parked++;
    if (g_vdefs[v->def].police && v->seat[0] && v->seat[0]->kind == AK_COP) police++;
  }
  int wantPolice = g.wanted >= 2 ? g.wanted - 1 : 0;
  bool spawnPolice = police < wantPolice;
  if (moving < TRAFFIC_TARGET || spawnPolice) {
    World *w = &g_world;
    for (int tries = 0; tries < 10; tries++) {
      int ei = rnd_int(w->nsedge);
      const StreetEdge *e = &w->sedges[ei];
      StreetNode *A = &w->snodes[e->a], *B = &w->snodes[e->b];
      float t = rnd_range(0.3f, 0.7f);
      bool fwd = rnd() < 0.5f;
      StreetNode *F = fwd ? A : B, *T = fwd ? B : A;
      float ux = T->x - F->x, uz = T->z - F->z, l = sqrtf(ux * ux + uz * uz); ux /= l; uz /= l;
      float off = e->lanes == 2 ? e->half * 0.62f : e->half * 0.48f;
      V3 p = {F->x + (T->x - F->x) * t - uz * off, 0, F->z + (T->z - F->z) * t + ux * off};
      p.y = world_floor(p.x, p.z, 8, NULL);
      float d = v3_dist_xz(p, c);
      if (d < (spawnPolice ? 60 : 45) || d > 115) continue;
      if (in_view(p, 3) && d < 90) continue;
      // not on top of another car
      bool clear = true;
      for (int i = 0; i < MAX_VEHICLES; i++) if (g.vehicles[i].used && v3_dist2_xz(g.vehicles[i].pos, p) < 100) clear = false;
      if (!clear) continue;
      int def = spawnPolice ? VD_POLICE : random_vehicle_for(world_block(p.x, p.z), false);
      Vehicle *v = vehicle_spawn(def, p, dir_yaw(ux, uz));
      if (!v) return;
      v->edge = ei; v->fromNode = fwd ? e->a : e->b; v->toNode = fwd ? e->b : e->a; v->aiDriven = true;
      v->vel = v3_scale((V3){ux, 0, uz}, 8);
      int owner = gang_block_owner(world_block(p.x, p.z));
      int kind = spawnPolice ? AK_COP : (def == VD_LOWRIDER && owner ? AK_GANG : AK_CIVILIAN);
      Actor *drv = actor_spawn(kind, kind == AK_COP ? GANG_COPS : kind == AK_GANG ? owner : GANG_NONE, p, v->yaw);
      if (!drv) { vehicle_free(v); return; }
      arm(drv);
      drv->brain = BR_DRIVE; drv->vehicle = v; drv->seat = 0; drv->state = ST_VEHICLE; v->seat[0] = drv;
      if (spawnPolice) {
        v->siren = true;
        Actor *b = actor_spawn(AK_COP, GANG_COPS, p, v->yaw);
        if (b) { arm(b); b->brain = BR_COP; b->vehicle = v; b->seat = 1; b->state = ST_VEHICLE; v->seat[1] = b; }
      }
      return;
    }
  }
  if (parked < PARKED_TARGET) {
    int s = world_find_spot(SPOT_PARK, c, 25, 70, 0);
    if (s < 0) return;
    Spot *sp = &g_world.spots[s];
    V3 p = {sp->x, 0, sp->z};
    if (in_view(p, 3) && v3_dist_xz(p, c) < 50) return;
    for (int i = 0; i < MAX_VEHICLES; i++) if (g.vehicles[i].used && v3_dist2_xz(g.vehicles[i].pos, p) < 25) return;
    p.y = world_floor(p.x, p.z, 3, NULL);
    Vehicle *v = vehicle_spawn(random_vehicle_for(sp->district, true), p, sp->yaw);
    if (v) v->parked = true;
  }
}

void population_step(void) {
  if (!g.player) return;
  V3 c = g.player->pos;
  if (g.player->vehicle) c = v3_add(c, v3_scale(g.player->vehicle->vel, 1.5f)); // look ahead when driving
  // go: far people and vehicles, old bodies
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!a->used || a == g.player || a->recruited || a->keep) continue;
    float d = v3_dist_xz(a->pos, c);
    if (a->vehicle) continue; // goes with its vehicle
    if ((a->state == ST_DEAD && (a->despawnTimer <= 0 || d > 60)) || (d > 95 && !a->warrior) || d > 160) actor_free(a);
  }
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (!v->used) continue;
    bool ours = false;
    for (int s = 0; s < 4; s++) if (v->seat[s] && (v->seat[s] == g.player || v->seat[s]->recruited)) ours = true;
    float d = v3_dist_xz(v->pos, c);
    if (!ours && !v->keep && (d > 140 || (d > 80 && !in_view(v->pos, 4))) && v != g.player->vehicle) {
      // its people go with it
      for (int s = 0; s < 4; s++) if (v->seat[s]) { Actor *a = v->seat[s]; v->seat[s] = NULL; a->vehicle = NULL; actor_free(a); }
      vehicle_free(v);
    }
  }
  s_timer -= DT; s_vtimer -= DT;
  if (s_timer <= 0) { s_timer = g.time < 3 ? 0.05f : 0.35f; spawn_people(c); }
  if (s_vtimer <= 0) { s_vtimer = 0.5f; spawn_traffic(c); }
  // the police on foot, by the wanted level
  if (g.wanted > 0 && (g.frame % 45) == 0 && count_people(AK_COP) < g.wanted * 2 + 1) {
    int node = -1;
    for (int t = 0; t < 10 && node < 0; t++) { int i = rnd_int(g_world.nwnode); float d = sqrtf(sqrf(g_world.wnodes[i].x - c.x) + sqrf(g_world.wnodes[i].z - c.z)); if (d > 35 && d < 60) node = i; }
    if (node >= 0) {
      V3 p = {g_world.wnodes[node].x, 0, g_world.wnodes[node].z};
      p.y = world_floor(p.x, p.z, 5, NULL);
      population_spawn_person(p, 0, AK_COP, GANG_COPS);
    }
  }
  g_chase_target = g.wanted >= 2 ? g.player : NULL;
}
