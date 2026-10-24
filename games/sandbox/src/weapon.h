// Weapons: one table (add a row for a new weapon), hitscan shots, rockets, explosions.
#pragma once
#include "game.h"

typedef struct {
  const char *name, *model;
  uint8_t kind;          // WK_*
  float damage, rate;    // per hit, seconds between shots
  int clip, startAmmo;
  float reload, spread, range, force;
  uint8_t pellets, sound;
  bool automatic, twoHanded;
  float muzzleZ;         // the muzzle along the barrel (meters)
  int price;
} WeaponDef;
enum { WK_MELEE, WK_HITSCAN, WK_ROCKET };
extern const WeaponDef g_weapons[W_COUNT];

void weapon_init(void);
void weapon_step(Actor *a);              // after the body moved: timers, reloading, firing on ctl.attack
void weapon_give(Actor *a, int w, int ammo);
void weapon_select(Actor *a, int dir);   // cycle through what the actor carries
static inline bool weapon_is_gun(int w) { return w >= W_PISTOL; }
static inline bool weapon_two_handed(int w) { return g_weapons[w].twoHanded; }
static inline float weapon_muzzle_z(int w) { return g_weapons[w].muzzleZ; }
void weapon_explode(V3 at, float radius, float damage, Actor *by);
void weapon_fire_rocket(Actor *by, V3 at, V3 dir);
void weapon_projectiles_step(void);
void weapon_projectiles_draw(void);
// the first person or vehicle a shot from `from` along `dir` hits within range
bool weapon_trace(V3 from, V3 dir, float range, Actor *skip, Actor **hitActor, Vehicle **hitVehicle, V3 *hitPos);
// people hear shots: ai.c reacts (fleeing, fighting back, the police)
extern void (*g_on_gunshot)(V3 at, Actor *shooter);
