#include "weapon.h"
#include "actor.h"
#include "vehicle.h"
#include "world.h"
#include "fx.h"
#include "sound.h"

void (*g_on_gunshot)(V3 at, Actor *shooter);

const WeaponDef g_weapons[W_COUNT] = {
  //            name        model         kind        dmg   rate  clip start reload spread range force pel sound        auto  2h    muzzle price
  [W_FIST] =     {"Fists",    NULL,         WK_MELEE,   10, 0.30f, 0, 0,    0,    0,     1.5f, 3,    1, SND_SWING,   false, false, 0, 0},
  [W_BAT] =      {"Bat",      "w_bat",      WK_MELEE,   28, 0.45f, 0, 0,    0,    0,     1.8f, 9,    1, SND_SWING,   false, false, 0, 60},
  [W_PISTOL] =   {"Pistol",   "w_pistol",   WK_HITSCAN, 24, 0.30f, 12, 60,  1.0f, 0.025f, 55, 4,    1, SND_PISTOL,  false, false, 0.17f, 200},
  [W_SMG] =      {"SMG",      "w_smg",      WK_HITSCAN, 13, 0.09f, 30, 150, 1.4f, 0.05f,  45, 3,    1, SND_SMG,     true,  false, 0.26f, 600},
  [W_SHOTGUN] =  {"Shotgun",  "w_shotgun",  WK_HITSCAN, 14, 0.85f, 8, 40,   2.0f, 0.09f,  25, 7,    6, SND_SHOTGUN, false, true,  0.6f, 800},
  [W_RIFLE] =    {"Rifle",    "w_rifle",    WK_HITSCAN, 30, 0.12f, 30, 120, 1.8f, 0.03f,  80, 5,    1, SND_RIFLE,   true,  true,  0.62f, 1500},
  [W_LAUNCHER] = {"Launcher", "w_launcher", WK_ROCKET,  140, 1.2f, 1, 6,    1.6f, 0,      120, 0,   1, SND_ROCKET,  false, true,  0.7f, 4000},
};

void weapon_init(void) {
  for (int w = 0; w < W_COUNT; w++) {
    if (!g_weapons[w].model) continue;
    char path[40];
    sprintf(path, "rom:/%s.t3dm", g_weapons[w].model);
    g_models.weapon[w] = t3d_model_load(path);
  }
}

void weapon_give(Actor *a, int w, int ammo) {
  bool had = a->weapons & (1 << w);
  a->weapons |= 1 << w;
  if (g_weapons[w].clip) {
    a->ammo[w] += ammo;
    if (!had || a->clip[w] == 0) { int take = mini(g_weapons[w].clip, a->ammo[w]); a->clip[w] += take; a->ammo[w] -= take; }
  }
  if (!had || a->weapon == W_FIST) a->weapon = w;
}

void weapon_select(Actor *a, int dir) {
  for (int k = 1; k <= W_COUNT; k++) {
    int w = ((a->weapon + dir * k) % W_COUNT + W_COUNT) % W_COUNT;
    if (!(a->weapons & (1 << w))) continue;
    if (g_weapons[w].clip && a->clip[w] + a->ammo[w] == 0) continue;
    a->weapon = w; a->fireTimer = 0.2f; a->reloadTimer = 0;
    return;
  }
}

// ---- shots ----
static bool ray_capsule(V3 o, V3 d, float range, const Actor *a, float *tOut) {
  // a vertical capsule: closest approach of the shot to the body's axis (people lying down: lower)
  bool lying = a->state == ST_DEAD || a->state == ST_DOWN || a->state == ST_KNOCKED || a->state == ST_BELLYSLIDE;
  float y0 = a->pos.y + 0.1f, y1 = a->pos.y + (lying ? 0.4f : 1.75f * a->look.height);
  float r = lying ? 0.5f : 0.34f;
  // in the xz plane first
  float px = a->pos.x - o.x, pz = a->pos.z - o.z;
  float dl = d.x * d.x + d.z * d.z;
  float t = dl > 1e-6f ? (px * d.x + pz * d.z) / dl : 0;
  t = clampf(t, 0, range);
  float cx = o.x + d.x * t - a->pos.x, cz = o.z + d.z * t - a->pos.z;
  if (cx * cx + cz * cz > r * r) return false;
  float y = o.y + d.y * t;
  if (y < y0 - r || y > y1 + 0.1f) return false;
  *tOut = t;
  return true;
}

bool weapon_trace(V3 from, V3 dir, float range, Actor *skip, Actor **hitActor, Vehicle **hitVehicle, V3 *hitPos) {
  float best = range;
  *hitActor = NULL; *hitVehicle = NULL;
  float tw; V3 n;
  if (world_raycast(from, v3_mad(from, dir, range), &tw, &n)) best = tw * range;
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!a->used || a == skip || (a->vehicle && a->state == ST_VEHICLE && !vehicle_shows_rider(a->vehicle))) continue;
    if (a->state == ST_DEAD && a->stateTime > 3) continue;
    float t;
    if (ray_capsule(from, dir, best, a, &t) && t < best) { best = t; *hitActor = a; *hitVehicle = NULL; }
  }
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (!v->used || (skip && skip->vehicle == v)) continue;
    float t;
    if (vehicle_raycast(v, from, dir, best, &t) && t < best) { best = t; *hitVehicle = v; *hitActor = NULL; }
  }
  *hitPos = v3_mad(from, dir, best);
  return best < range;
}

static void shoot(Actor *a, int w) {
  const WeaponDef *d = &g_weapons[w];
  V3 f = yaw_dir(a->yaw);
  V3 chest = actor_chest(a);
  V3 muzzle = v3_add(chest, (V3){f.x * 0.55f - f.z * 0.18f, 0.12f, f.z * 0.55f + f.x * 0.18f});
  V3 aim = a->ctl.aimAt;
  if (!a->ctl.aim && a->kind == AK_PLAYER && a->target < 0) aim = v3_add(chest, v3_scale(f, 30));
  V3 dir = v3_norm(v3_sub(aim, chest));
  if (d->kind == WK_ROCKET) {
    weapon_fire_rocket(a, muzzle, dir);
  } else {
    for (int p = 0; p < d->pellets; p++) {
      float sp = d->spread * (a->kind == AK_PLAYER ? 1.0f : 1.8f) * (a->ctl.aim ? 1.0f : 1.6f);
      V3 dd = v3_norm((V3){dir.x + rnd_range(-sp, sp), dir.y + rnd_range(-sp, sp) * 0.6f, dir.z + rnd_range(-sp, sp)});
      Actor *ha; Vehicle *hv; V3 hp;
      weapon_trace(chest, dd, d->range, a, &ha, &hv, &hp);
      if (ha) {
        bool head = hp.y > ha->pos.y + 1.5f * ha->look.height;
        actor_damage(ha, d->damage * (head ? 2.0f : 1.0f), dd, d->force + (ha->kind == AK_PLAYER ? 0 : 0), a);
        fx_burst(hp, FX_BLOOD, 4);
      } else if (hv) {
        vehicle_damage(hv, d->damage, hp, a);
        fx_burst(hp, FX_SPARK, 3);
      } else if (v3_dist(hp, chest) < d->range - 0.5f) {
        fx_burst(hp, FX_SPARK, 2);
        fx_burst(hp, FX_DUST, 1);
      }
      if (p < 2) fx_tracer(muzzle, hp, RGBA32(255, 230, 140, 255));
    }
  }
  a->muzzle = 0.06f;
  sound_play(d->sound, chest);
  if (g_on_gunshot) g_on_gunshot(chest, a);
}

void weapon_step(Actor *a) {
  if (a->fireTimer > 0) a->fireTimer -= DT;
  if (a->muzzle > 0) a->muzzle -= DT;
  int w = a->weapon;
  const WeaponDef *d = &g_weapons[w];
  if (a->reloadTimer > 0) {
    a->reloadTimer -= DT;
    if (a->reloadTimer <= 0) { int take = mini(d->clip - a->clip[w], a->ammo[w]); a->clip[w] += take; a->ammo[w] -= take; }
    return;
  }
  if (d->kind == WK_MELEE) {
    // the bat swings on attack (fists are the punch combo, in actor.c)
    if (w == W_BAT && a->ctl.attack && actor_can_act(a) && a->fireTimer <= 0) {
      a->fireTimer = d->rate;
      actor_set_state(a, ST_PUNCH); a->combo = 2; a->hitTimer = 0.12f;
    }
    return;
  }
  bool canFire = actor_can_act(a) || ST_IS_AIR(a->state) || a->state == ST_VEHICLE;
  if (a->state == ST_VEHICLE && a->vehicle && vehicle_is_bike(a->vehicle) && a->seat == 0 && !a->ctl.aim) canFire = false;
  bool pull = d->automatic ? a->ctl.attackHeld : a->ctl.attack;
  if (!pull || !canFire || a->fireTimer > 0) return;
  if (a->clip[w] <= 0) {
    if (a->ammo[w] > 0) { a->reloadTimer = d->reload; sound_play(SND_RELOAD, a->pos); }
    else { sound_play(SND_EMPTY, a->pos); a->fireTimer = 0.3f; if (a->kind == AK_PLAYER) weapon_select(a, 1); }
    return;
  }
  a->clip[w]--;
  a->fireTimer = d->rate;
  shoot(a, w);
  if (a->clip[w] == 0 && a->ammo[w] > 0) { a->reloadTimer = d->reload; sound_play(SND_RELOAD, a->pos); }
}

// ---- rockets ----
typedef struct { bool used; V3 pos, vel; float life; Actor *by; } Rocket;
static Rocket s_rockets[6];
void weapon_fire_rocket(Actor *by, V3 at, V3 dir) {
  for (int i = 0; i < 6; i++) if (!s_rockets[i].used) { s_rockets[i] = (Rocket){true, at, v3_scale(dir, 45), 3.0f, by}; return; }
}
void weapon_projectiles_step(void) {
  for (int i = 0; i < 6; i++) {
    Rocket *r = &s_rockets[i];
    if (!r->used) continue;
    r->life -= DT;
    V3 next = v3_mad(r->pos, r->vel, DT);
    Actor *ha; Vehicle *hv; V3 hp;
    V3 d = v3_sub(next, r->pos);
    float len = v3_len(d);
    bool hit = weapon_trace(r->pos, v3_scale(d, 1 / maxf(len, 1e-4f)), len, r->by, &ha, &hv, &hp);
    fx_burst(r->pos, FX_SMOKE, 1);
    if (hit || r->life <= 0) { weapon_explode(hit ? hp : next, 6.5f, 150, r->by); r->used = false; continue; }
    r->pos = next;
  }
}
void weapon_projectiles_draw(void) {
  for (int i = 0; i < 6; i++) {
    Rocket *r = &s_rockets[i];
    if (!r->used) continue;
    T3DMat4 m;
    mat_place(&m, r->pos, dir_yaw(r->vel.x, r->vel.z), -atan2f(r->vel.y, v3_len_xz(r->vel)), 0, 0, MODEL_SCALE * 0.3f);
    render_colored(g_models.fxCube, &m, RGBA32(80, 90, 70, 255));
  }
}

void weapon_explode(V3 at, float radius, float damage, Actor *by) {
  fx_explosion(at, radius / 6.0f + 0.5f);
  sound_play(SND_EXPLOSION, at);
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!actor_alive(a)) continue;
    float d = v3_dist(a->pos, at);
    if (d > radius) continue;
    float k = 1 - d / radius;
    V3 dir = v3_norm((V3){a->pos.x - at.x, 0.4f, a->pos.z - at.z});
    if (a->vehicle && a->state == ST_VEHICLE) continue; // the vehicle takes it
    // a wall between shields (most of) the blast
    if (d > 1.0f && !world_los(v3_add(at, (V3){0, 0.4f, 0}), actor_chest(a))) k *= 0.15f;
    actor_damage(a, damage * k, dir, 6 + 12 * k, by);
  }
  for (int i = 0; i < MAX_VEHICLES; i++) {
    Vehicle *v = &g.vehicles[i];
    if (!v->used) continue;
    float d = v3_dist(v->pos, at);
    if (d > radius * 1.2f) continue;
    float k = 1 - d / (radius * 1.2f);
    if (d > 1.5f && !world_los(v3_add(at, (V3){0, 0.4f, 0}), v3_add(v->pos, (V3){0, 0.8f, 0}))) k *= 0.15f;
    vehicle_damage(v, damage * 4 * k, at, by);
    vehicle_push(v, v3_scale(v3_norm(v3_sub(v->pos, at)), 9 * k), 7 * k);
  }
  if (g_on_gunshot) g_on_gunshot(at, by);
}
