#include "pickup.h"
#include "actor.h"
#include "weapon.h"
#include "world.h"
#include "sound.h"
#include "fx.h"
#include "save.h"

#define MAX_PICKUPS 64
typedef struct { bool used, fixed; uint8_t type; int amount; V3 pos; float respawn, life; } Pickup;
static Pickup s_p[MAX_PICKUPS];
static V3 s_home;

// what the map's pickup spots hold (tools/city.mjs: SPOT.PICKUP param)
static int spot_type(int param) {
  switch (param) {
    case 1: return PK_HEALTH; case 2: return PK_WEAPON0 + W_PISTOL; case 3: return PK_WEAPON0 + W_SMG;
    case 4: return PK_WEAPON0 + W_SHOTGUN; case 5: return PK_WEAPON0 + W_RIFLE; case 6: return PK_WEAPON0 + W_LAUNCHER;
    case 7: return PK_ARMOR; case 8: return PK_WEAPON0 + W_BAT;
  }
  return PK_HEALTH;
}

static Pickup *add(void) { for (int i = 0; i < MAX_PICKUPS; i++) if (!s_p[i].used) return &s_p[i]; return NULL; }

void pickup_init(void) {
  memset(s_p, 0, sizeof(s_p));
  int extra = 0;
  for (int i = 0; i < g_world.nspot; i++) {
    Spot *s = &g_world.spots[i];
    if (s->type == SPOT_HOME) s_home = (V3){s->x, 0.15f, s->z};
    if (s->type != SPOT_PICKUP) continue;
    Pickup *p = add(); if (!p) break;
    p->used = p->fixed = true; p->type = spot_type(s->param);
    p->pos = (V3){s->x, world_floor(s->x, s->z, 60, NULL), s->z};
  }
  // more round the city: health at the clinic, armour at the police station, guns in alleys
  for (int i = 0; i < g_world.nspot && extra < 14; i++) {
    Spot *s = &g_world.spots[i];
    int t = -1;
    if (s->type == SPOT_HOSPITAL) t = PK_HEALTH;
    else if (s->type == SPOT_POLICE) t = PK_ARMOR;
    else if (s->type == SPOT_SHOP && (i % 23) == 0) t = PK_WEAPON0 + ((i / 23) % 2 ? W_SMG : W_BAT);
    else if (s->type == SPOT_BENCH && (i % 9) == 0) t = PK_HEALTH;
    if (t < 0) continue;
    Pickup *p = add(); if (!p) break;
    p->used = p->fixed = true; p->type = t;
    p->pos = (V3){s->x, world_floor(s->x, s->z, 60, NULL), s->z};
    extra++;
  }
}

void pickup_drop(int type, V3 at, int amount) {
  Pickup *p = add();
  if (!p) return;
  p->used = true; p->fixed = false; p->type = type; p->amount = amount; p->pos = at; p->life = 30;
}

static void take(Pickup *p, Actor *a) {
  int t = p->type;
  if (t == PK_CASH) { g.money += p->amount; sound_play_ui(SND_CASH); fx_burst(p->pos, FX_CASH, 3); }
  else if (t == PK_HEALTH) { if (a->health >= 100) return; a->health = 100; game_message("Health"); sound_play_ui(SND_PICKUP); }
  else if (t == PK_ARMOR) { if (a->armor >= 100) return; a->armor = 100; game_message("Body armour"); sound_play_ui(SND_PICKUP); }
  else {
    int w = t - PK_WEAPON0;
    // a gun dropped by someone holds what they had left (a little at least); a placed one a full load
    weapon_give(a, w, p->fixed ? g_weapons[w].startAmmo : maxi(p->amount, g_weapons[w].startAmmo / 4));
    game_message("%s", g_weapons[w].name);
    sound_play_ui(SND_PICKUP);
  }
  if (p->fixed) p->respawn = 60; else p->used = false;
}

void pickup_step(void) {
  Actor *pl = g.player;
  for (int i = 0; i < MAX_PICKUPS; i++) {
    Pickup *p = &s_p[i];
    if (!p->used) continue;
    if (p->respawn > 0) { p->respawn -= DT; continue; }
    if (!p->fixed && (p->life -= DT) <= 0) { p->used = false; continue; }
    if (actor_alive(pl) && !pl->vehicle && v3_dist(pl->pos, p->pos) < 1.2f) take(p, pl);
    // the crew takes guns too
  }
  // the save house: stand in the marker
  static float inside;
  if (actor_alive(pl) && !pl->vehicle && v3_dist_xz(pl->pos, s_home) < 1.6f) {
    inside += DT;
    if (inside > 0.6f && inside < 0.6f + DT * 1.5f) { save_write(); pl->health = 100; game_message("Saved. Health restored"); sound_play_ui(SND_PICKUP); }
  } else inside = 0;
}

void pickup_draw(void) {
  render_light_lit();
  float spin = g.time * 2.0f, bob = sinf(g.time * 3) * 0.12f;
  for (int i = 0; i < MAX_PICKUPS; i++) {
    Pickup *p = &s_p[i];
    if (!p->used || p->respawn > 0) continue;
    if (v3_dist2_xz(p->pos, g_view.eye) > 70 * 70) continue;
    T3DModel *m = NULL; float sc = 1;
    if (p->type == PK_CASH) m = g_models.pickCash;
    else if (p->type == PK_HEALTH) m = g_models.pickHealth;
    else if (p->type == PK_ARMOR) m = g_models.pickArmor;
    else { m = g_models.weapon[p->type - PK_WEAPON0]; sc = 2.2f; }
    if (!m) continue;
    T3DMat4 mt;
    mat_place(&mt, v3_add(p->pos, (V3){0, 0.5f + bob, 0}), spin, 0, 0, 0, MODEL_SCALE * sc);
    render_model(m, &mt);
  }
  // the save house marker: a slowly turning ring
  if (v3_dist2_xz(s_home, g_view.eye) < 80 * 80) {
    T3DMat4 mt;
    mat_place(&mt, s_home, spin * 0.5f, 0, 0, 0, MODEL_SCALE);
    render_colored(g_models.marker, &mt, RGBA32(80, 220, 120, 160));
  }
}
