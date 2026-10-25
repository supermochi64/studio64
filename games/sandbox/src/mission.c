#include "mission.h"
#include "actor.h"
#include "vehicle.h"
#include "weapon.h"
#include "world.h"
#include "gang.h"
#include "population.h"
#include "hud.h"
#include "sound.h"
#include "save.h"
#include "pickup.h"
#include "ai.h"

// ---- the steps a mission is made of ----
enum {
  OBJ_GOTO,          // be at (x, z) within radius (on foot or in a vehicle)
  OBJ_RECRUIT,       // have param members in the crew
  OBJ_ENTER,         // be in a vehicle of kind param (or any: -1); spawns one at (x, z) when x != 0
  OBJ_DRIVE_TO,      // bring the vehicle you're in to (x, z)
  OBJ_KILL_GANG,     // take down param members of gang `gang` (counts from the step's start)
  OBJ_WAVES,         // survive param waves of `gang` attacking round (x, z)
  OBJ_KILL_BOSS,     // a boss of `gang` with guards at (x, z): take him down
  OBJ_COLLECT,       // pick up the package at (x, z)
  OBJ_LOSE_WANTED,   // no stars
};
typedef struct { uint8_t kind, gang; int16_t param; float x, z, radius; const char *text; } Step;
typedef struct {
  const char *title, *intro, *passed;
  float x, z;                 // where the marker that starts it stands
  int reward, respect;
  int requires;               // a mission that must be done first (-1: none)
  const Step *steps; int nsteps;
} Mission;

// the home (the cul-de-sac), the court, the docks: tools/city.mjs puts them there
#define HOME_X -384
#define HOME_Z -10
#define COURT_X -384
#define COURT_Z 128

static const Step M0[] = {
  {OBJ_GOTO, 0, 0, COURT_X, COURT_Z + 20, 6, "Go to the court"},
  {OBJ_RECRUIT, 0, 2, 0, 0, 0, "Recruit two of the crew (aim with R, D-UP)"},
  {OBJ_GOTO, 0, 0, HOME_X, HOME_Z, 5, "Back to the house"},
};
static const Step M1[] = {
  {OBJ_ENTER, 0, VD_LOWRIDER, 330, 12, 0, "Take the Violet Kings' lowrider"},
  {OBJ_DRIVE_TO, 0, 0, HOME_X - 6, HOME_Z + 10, 6, "Bring it home"},
};
static const Step M2[] = {
  {OBJ_GOTO, 0, 0, 320, 0, 25, "Go to Violet Heights"},
  {OBJ_KILL_GANG, GANG_VIOLET, 6, 0, 0, 0, "Take down 6 Violet Kings"},
};
static const Step M3[] = {
  {OBJ_WAVES, GANG_VIOLET, 3, COURT_X, COURT_Z, 0, "They're coming for the court: hold it"},
  {OBJ_GOTO, 0, 0, HOME_X, HOME_Z, 5, "Back to the house"},
};
static const Step M4[] = {
  {OBJ_GOTO, 0, 0, 560, 260, 20, "Go to the docks at Port Ardent"},
  {OBJ_KILL_BOSS, GANG_GOLD, 0, 575, 300, 0, "Take down the Gold Coast boss"},
  {OBJ_COLLECT, 0, 0, 575, 302, 1.5f, "Grab the package"},
  {OBJ_LOSE_WANTED, 0, 0, 0, 0, 0, "Lose the police"},
  {OBJ_GOTO, 0, 0, HOME_X, HOME_Z, 5, "Back to the house"},
};
#define N(a) (int)(sizeof(a) / sizeof(a[0]))
static const Mission MISSIONS[] = {
  {"OLD STREETS", "The block's gone quiet. Get the crew back together.", "The crew's back", HOME_X + 3, HOME_Z - 5, 200, 5, -1, M0, N(M0)},
  {"WHEELS", "The Violet Kings took our lowrider. Take it back.", "Our ride's home", COURT_X, COURT_Z + 22, 500, 5, 0, M1, N(M1)},
  {"PAYBACK", "Time to answer them. Take the crew to Violet Heights.", "They'll think twice", HOME_X + 3, HOME_Z - 5, 800, 10, 1, M2, N(M2)},
  {"HOLD THE LINE", "Word is the Kings are coming for the court.", "The court is ours", COURT_X, COURT_Z + 22, 1200, 15, 2, M3, N(M3)},
  {"DOCKSIDE", "The Gold Coast boss is moving a package at the docks.", "Costa Verde knows our name", HOME_X + 3, HOME_Z - 5, 2500, 25, 3, M4, N(M4)},
};
#define NMISSIONS N(MISSIONS)

static int s_active = -1, s_step, s_count0, s_waves;
static float s_stepTime, s_introTime, s_failTime;
static uint32_t s_done;
static int s_kills[GANG_COUNT];   // the player's crew's kills per gang (counted by on_death)
static Vehicle *s_car;
static Actor *s_boss;
static bool s_carPending;
static bool s_collected;
static char s_banner[48]; static float s_bannerTime;

uint32_t mission_done_mask(void) { return s_done; }
void mission_set_done_mask(uint32_t m) { s_done = m; }
int mission_active(void) { return s_active; }

static void (*s_prevDamaged)(Actor *a, Actor *by, float dmg, bool died);
static void on_damaged(Actor *a, Actor *by, float dmg, bool died) {
  if (s_prevDamaged) s_prevDamaged(a, by, dmg, died);
  if (died && by && (by->kind == AK_PLAYER || by->recruited) && a->kind == AK_GANG) s_kills[a->gang]++;
}

void mission_init(void) { s_active = -1; }

static void banner(const char *t) { strncpy(s_banner, t, sizeof(s_banner) - 1); s_bannerTime = 3.5f; }

// what the mission made is ordinary again (it can go when far away)
static void release(void) {
  if (s_car && s_car->used) s_car->keep = false;
  if (s_boss && s_boss->used) s_boss->keep = false;
  for (int i = 0; i < MAX_ACTORS; i++) { Actor *a = &g.actors[i]; if (a->used && a->keep) a->keep = false; if (a->used && a->warrior && !g.war) { a->warrior = false; a->brain = BR_WALK; } }
  s_car = NULL; s_boss = NULL; s_carPending = false;
}

// the car to take, with two guards: made when the player comes near (far away nothing stays)
static void spawn_car(const Step *st) {
  V3 p = {st->x, 0, st->z}; p.y = world_floor(p.x, p.z, 5, NULL);
  s_car = vehicle_spawn(st->param, p, 0);
  if (!s_car) return;
  s_car->parked = true; s_car->keep = true; s_car->paint = RGBA32(130, 50, 160, 255);
  s_carPending = false;
  for (int k = 0; k < 2; k++) {
    Actor *a = population_spawn_person((V3){p.x + 3 - k * 6, p.y, p.z + 3}, 0, AK_GANG, GANG_VIOLET);
    if (a) { a->brain = 2; a->home = a->pos; a->warrior = false; }
  }
}

static void fail(const char *why) {
  game_big("MISSION FAILED");
  game_message("%s", why);
  s_active = -1; s_failTime = 4;
  release();
  sound_play_ui(SND_WASTED);
}

static void begin_step(void) {
  const Mission *m = &MISSIONS[s_active];
  const Step *st = &m->steps[s_step];
  s_stepTime = 0;
  s_count0 = s_kills[st->gang];
  game_message("%s", st->text);
  if (st->kind == OBJ_ENTER && st->x != 0) { s_car = NULL; s_carPending = true; }
  if (st->kind == OBJ_WAVES) { s_waves = 0; }
  if (st->kind == OBJ_KILL_BOSS) {
    V3 p = {st->x, 0, st->z}; p.y = world_floor(p.x, p.z, 5, NULL);
    // room for him: the farthest passer-by goes if everyone is taken
    s_boss = population_spawn_person(p, PI, AK_GANG, st->gang);
    if (!s_boss) {
      Actor *far = NULL; float fd = 0;
      for (int i = 0; i < MAX_ACTORS; i++) { Actor *o = &g.actors[i]; if (o->used && o != g.player && !o->keep && !o->vehicle && !o->recruited && v3_dist(o->pos, p) > fd) { fd = v3_dist(o->pos, p); far = o; } }
      if (far) { actor_free(far); s_boss = population_spawn_person(p, PI, AK_GANG, st->gang); }
    }
    if (s_boss) { s_boss->keep = true; s_boss->health = 260; weapon_give(s_boss, W_SMG, 300); s_boss->brain = 2; s_boss->home = p; s_boss->look.height = 1.12f; s_boss->look.hasHat = true; s_boss->look.hat = RGBA32(255, 215, 40, 255); }
    for (int k = 0; k < 3; k++) {
      Actor *a = population_spawn_person((V3){p.x + rnd_range(-5, 5), p.y, p.z + rnd_range(-5, 5)}, 0, AK_GANG, st->gang);
      if (a) { a->brain = 2; a->home = a->pos; weapon_give(a, W_PISTOL, 60); }
    }
    s_collected = false;
  }
}

static void pass(void) {
  const Mission *m = &MISSIONS[s_active];
  s_done |= 1u << s_active;
  g.money += m->reward; g.respect += m->respect;
  game_big("MISSION PASSED");
  actor_dance(g.player);
  sound_music(MUS_PASSED);
  game_message("%s  +$%d", m->passed, m->reward);
  sound_play_ui(SND_CASH);
  s_active = -1;
  release();
  save_write();
}

static bool at(float x, float z, float r) {
  Actor *p = g.player;
  V3 pos = p->vehicle ? p->vehicle->pos : p->pos;
  return sqrf(pos.x - x) + sqrf(pos.z - z) < r * r;
}

void mission_step(void) {
  static bool hooked;
  if (!hooked) { s_prevDamaged = g_on_actor_damaged; g_on_actor_damaged = on_damaged; hooked = true; }
  Actor *p = g.player;
  if (!p) return;
  if (s_bannerTime > 0) s_bannerTime -= DT;
  if (s_failTime > 0) s_failTime -= DT;
  // stunt jumps: long air time in a vehicle pays
  static float air; static bool wasAir;
  if (p->vehicle && p->state == ST_VEHICLE && p->seat == 0) {
    Vehicle *v = p->vehicle;
    if (!v->onGround) { air += DT; wasAir = true; }
    else if (wasAir) {
      if (air > 1.3f && !v->wrecked) { int bonus = (int)(air * air * 60); g.money += bonus; game_message("STUNT BONUS  %.1f s  +$%d", air, bonus); sound_play_ui(SND_CASH); }
      air = 0; wasAir = false;
    }
  } else { air = 0; wasAir = false; }

  if (s_active < 0) {
    // a marker starts the next mission
    if (!actor_alive(p) || g.deadTimer > 0 || s_failTime > 0) return;
    for (int i = 0; i < NMISSIONS; i++) {
      const Mission *m = &MISSIONS[i];
      if (s_done & (1u << i)) continue;
      if (m->requires >= 0 && !(s_done & (1u << m->requires))) continue;
      if (!p->vehicle && at(m->x, m->z, 1.6f)) {
        s_active = i; s_step = 0;
        banner(m->title);
        game_big(m->title);
        game_message("%s", m->intro);
        s_introTime = 3.0f;
        sound_play_ui(SND_PICKUP);
        break;
      }
    }
    return;
  }
  const Mission *m = &MISSIONS[s_active];
  if (!actor_alive(p)) { fail("You were knocked out"); return; }
  if (g.deadTimer > 0) { fail(g.deadKind == 2 ? "You were arrested" : "You were knocked out"); return; }
  if (s_introTime > 0) { s_introTime -= DT; if (s_introTime <= 0) begin_step(); return; }
  const Step *st = &m->steps[s_step];
  s_stepTime += DT;
  bool done = false;
  switch (st->kind) {
    case OBJ_GOTO: done = at(st->x, st->z, st->radius); break;
    case OBJ_RECRUIT: done = gang_recruit_count() >= st->param; break;
    case OBJ_ENTER:
      if (s_carPending && at(st->x, st->z, 110)) spawn_car(st);
      if (s_car && (!s_car->used || s_car->wrecked)) { fail("The car was wrecked"); return; }
      if (s_carPending) break;
      done = p->vehicle && p->state == ST_VEHICLE && (st->param < 0 || p->vehicle->def == st->param) && (!(st->x != 0) || p->vehicle == s_car);
      break;
    case OBJ_DRIVE_TO:
      if (s_car && (!s_car->used || s_car->wrecked)) { fail("The car was wrecked"); return; }
      done = p->vehicle && (!s_car || p->vehicle == s_car) && at(st->x, st->z, st->radius) && fabsf(p->vehicle->speed) < 3;
      break;
    case OBJ_KILL_GANG: {
      done = s_kills[st->gang] - s_count0 >= st->param;
      // (their blocks may all be ours by now: then they come looking for us)
      int near = 0;
      for (int i = 0; i < MAX_ACTORS; i++) { Actor *a = &g.actors[i]; if (actor_alive(a) && a->kind == AK_GANG && a->gang == st->gang && v3_dist(a->pos, p->pos) < 70) near++; }
      if (!done && near < 2 && fmodf(s_stepTime, 6.0f) < DT && s_stepTime > 5) population_spawn_attackers(st->gang, p->pos, 3);
      break;
    }
    case OBJ_WAVES: {
      // it is held where it is: away from it, the waves wait; far away, it is lost
      if (!at(st->x, st->z, 150)) { fail("You left the court to them"); return; }
      int alive = 0;
      for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].warrior && actor_alive(&g.actors[i])) alive++;
      if (alive == 0 && s_stepTime > 2 && at(st->x, st->z, 60)) {
        if (s_waves >= st->param) { done = true; break; }
        s_waves++;
        population_spawn_attackers(st->gang, (V3){st->x, 0, st->z}, 3 + s_waves);
        game_message("Wave %d of %d", s_waves, st->param);
        s_stepTime = 0;
      }
      break;
    }
    case OBJ_KILL_BOSS:
      if (!s_boss || !s_boss->used) { fail("The boss got away"); return; }
      done = s_boss->state == ST_DEAD || s_boss->health <= 0;
      break;
    case OBJ_COLLECT: done = at(st->x, st->z, 1.6f) && !p->vehicle; if (done) gang_crime(14); break; // the police were waiting
    case OBJ_LOSE_WANTED: done = g.wanted == 0 && s_stepTime > 1; break;
  }
  if (done) {
    s_step++;
    sound_play_ui(SND_BLIP);
    if (s_step >= m->nsteps) pass(); else begin_step();
  }
}

bool mission_target(V3 *out) {
  if (s_active < 0) {
    // the next mission's marker
    float bd = 1e18f; bool any = false;
    for (int i = 0; i < NMISSIONS; i++) {
      const Mission *m = &MISSIONS[i];
      if (s_done & (1u << i)) continue;
      if (m->requires >= 0 && !(s_done & (1u << m->requires))) continue;
      float d = sqrf(m->x - g.player->pos.x) + sqrf(m->z - g.player->pos.z);
      if (d < bd) { bd = d; *out = (V3){m->x, 0, m->z}; any = true; }
    }
    return any;
  }
  if (s_introTime > 0) return false;
  const Step *st = &MISSIONS[s_active].steps[s_step];
  if (st->kind == OBJ_ENTER && s_car && s_car->used) { *out = s_car->pos; return true; }
  if (st->kind == OBJ_ENTER && s_carPending) { *out = (V3){st->x, 0, st->z}; return true; }
  if (st->kind == OBJ_KILL_BOSS && s_boss && actor_alive(s_boss)) { *out = s_boss->pos; return true; }
  if (st->kind == OBJ_GOTO || st->kind == OBJ_DRIVE_TO || st->kind == OBJ_COLLECT) { *out = (V3){st->x, 0, st->z}; return true; }
  if (st->kind == OBJ_WAVES || st->kind == OBJ_KILL_GANG) return false;
  return false;
}

void mission_draw(void) {
  float spin = g.time;
  render_light_lit();
  for (int i = 0; i < NMISSIONS && s_active < 0; i++) {
    const Mission *m = &MISSIONS[i];
    if (s_done & (1u << i)) continue;
    if (m->requires >= 0 && !(s_done & (1u << m->requires))) continue;
    V3 p = {m->x, world_floor(m->x, m->z, 50, NULL), m->z};
    if (v3_dist2_xz(p, g_view.eye) > 90 * 90) continue;
    T3DMat4 mt;
    mat_place(&mt, p, spin, 0, 0, 0, MODEL_SCALE * 1.3f);
    render_colored(g_models.marker, &mt, RGBA32(255, 210, 40, 170));
  }
  V3 t;
  if (s_active >= 0 && mission_target(&t)) {
    const Step *st = &MISSIONS[s_active].steps[s_step];
    if (st->kind == OBJ_GOTO || st->kind == OBJ_DRIVE_TO || st->kind == OBJ_COLLECT) {
      t.y = world_floor(t.x, t.z, 50, NULL);
      T3DMat4 mt;
      float sc = st->kind == OBJ_COLLECT ? 0.8f : st->radius > 8 ? 4.0f : 2.4f;
      mat_place(&mt, t, spin, 0, 0, 0, MODEL_SCALE * sc);
      render_colored(g_models.marker, &mt, st->kind == OBJ_COLLECT ? RGBA32(60, 200, 255, 200) : RGBA32(255, 210, 40, 150));
      if (st->kind == OBJ_COLLECT) { T3DMat4 mc; mat_place(&mc, v3_add(t, (V3){0, 0.5f + sinf(spin * 3) * 0.1f, 0}), spin * 2, 0, 0, 0, MODEL_SCALE * 1.5f); render_model(g_models.pickCash, &mc); }
    }
  }
}

void mission_hud(void) {
  if (s_active < 0 || s_introTime > 0) return;
  const Mission *m = &MISSIONS[s_active];
  const Step *st = &m->steps[s_step];
  char line[64];
  if (st->kind == OBJ_KILL_GANG) snprintf(line, sizeof(line), "%s (%d/%d)", st->text, s_kills[st->gang] - s_count0, st->param);
  else if (st->kind == OBJ_WAVES) snprintf(line, sizeof(line), "%s (WAVE %d/%d)", st->text, s_waves, st->param);
  else if (st->kind == OBJ_RECRUIT) snprintf(line, sizeof(line), "%s (%d/%d)", st->text, gang_recruit_count(), st->param);
  else snprintf(line, sizeof(line), "%s", st->text);
  hud_text(14, 38, RGBA32(255, 210, 40, 255), 1, "%s", m->title);
  hud_text(14, 48, RGBA32(255, 255, 255, 255), 1, "%s", line);
}
