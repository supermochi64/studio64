#include "testplay.h"
#ifdef TESTPLAY
#include "game.h"
#include "actor.h"
#include "vehicle.h"
#include "weapon.h"
#include "world.h"
#include "gang.h"
#include "stream.h"
#include "camera.h"
#include "population.h"
#include "render.h"
extern float g_hour;
extern float g_perf[3], g_perfDraw[5];
extern bool g_profile;
static void perf_parts(void) {
  int np = 0, nv = 0;
  for (int i = 0; i < MAX_ACTORS; i++) np += g.actors[i].used;
  for (int i = 0; i < MAX_VEHICLES; i++) nv += g.vehicles[i].used;
  debugf("PERF parts (GPU): city %.1f, vehicles %.1f, people %.1f, fx %.1f, hud %.1f ms; %d people, %d vehicles\n", g_perfDraw[0] / 1000, g_perfDraw[1] / 1000, g_perfDraw[2] / 1000, g_perfDraw[3] / 1000, g_perfDraw[4] / 1000, np, nv);
}

// one test after the other; each runs its frames with `t` (frames since its start) and returns true
// when done
static int s_test, s_t, s_fails, s_passes;
static Pad s_pad;
static float s_peak, s_val;
static V3 s_start;
static Actor *s_other;
static Vehicle *s_car;
static uint32_t s_ticks0; static int s_frames0;

static void check(const char *name, bool ok, const char *fmt, float v) {
  char buf[64]; snprintf(buf, sizeof(buf), fmt, v);
  debugf("%s %s (%s)\n", ok ? "PASS" : "FAIL", name, buf);
  if (ok) s_passes++; else s_fails++;
}
static void shot(const char *name) { debugf("SHOT %s\n", name); }

static Actor *P(void) { return g.player; }
static void place_player(float x, float z, float yaw) {
  Actor *p = P();
  if (p->vehicle) vehicle_leave(p->vehicle, p, false);
  p->pos = (V3){x, world_floor(x, z, 80, NULL), z}; p->yaw = yaw; p->vel = (V3){0, 0, 0}; p->speed = 0;
  p->state = ST_IDLE; p->onGround = true; p->health = 100;
  camera_init(p->pos, yaw);
}
static V3 ahead(float d) { V3 f = yaw_dir(P()->yaw); return v3_add(P()->pos, v3_scale(f, d)); }

// the jump chain: press A again the moment we land
static bool triple(int t) {
  Actor *p = P();
  if (t == 0) place_player(-64, -170, 0); // down an open street
  s_pad.sy = 1;
  if (t == 0) { s_peak = 0; s_val = 0; }
  if (t > 25) {
    if (p->onGround && (t % 2 == 0)) s_pad.a = true;
    if (p->state == ST_JUMP && p->jumpType == 3) { s_peak = maxf(s_peak, p->pos.y - s_start.y); s_val = 1; }
  } else s_start = p->pos;
  if (t == 25) s_start = p->pos;
  if (s_val && p->onGround && p->state != ST_JUMP) { check("triple jump", s_peak > 4.5f, "peak %.2f m", s_peak); return true; }
  if (t > 160) { check("triple jump", false, "peak %.2f m (no triple)", s_peak); return true; }
  return false;
}

static bool run_test(int n, int t) {
  Actor *p = P();
  memset(&s_pad, 0, sizeof(s_pad));
  switch (n) {
    case 0: // boot: the city streams in round the player
      if (t == 0) { s_ticks0 = get_ticks_ms(); }
      if (t < 90) return false;
      check("boot: chunks loaded", stream_loaded_count() > 20, "%.0f chunks", stream_loaded_count());
      check("boot: player on the ground", p->onGround && fabsf(p->pos.y - world_floor(p->pos.x, p->pos.z, p->pos.y + 1, NULL)) < 0.05f, "y %.2f", p->pos.y);
      shot("boot");
      return true;
    case 1: // running
      if (t == 0) s_start = p->pos;
      s_pad.sy = 1;
      if (t < 45) return false;
      check("run: 1.5 s covers ground", v3_dist_xz(p->pos, s_start) > 8, "%.1f m", v3_dist_xz(p->pos, s_start));
      return true;
    case 2: // a single jump
      if (t == 0) { s_start = p->pos; s_peak = 0; }
      if (t == 2) s_pad.a = true;
      if (t > 2 && t < 20) s_pad.a = true; // held: full height
      s_peak = maxf(s_peak, p->pos.y - s_start.y);
      if (t < 50) return false;
      check("jump: height", s_peak > 1.7f && s_peak < 2.8f, "%.2f m", s_peak);
      check("jump: landed", p->onGround, "state %.0f", p->state);
      return true;
    case 3: return triple(t);
    case 4: // long jump: run, Z, A
      if (t == 0) { place_player(-64, -170, 0); s_val = 0; }
      s_pad.sy = 1;
      if (t > 30 && t < 36) s_pad.z = true;
      if (t == 34) { s_pad.a = true; s_start = p->pos; }
      if (p->state == ST_LONGJUMP) s_val = 1;
      if (t < 80) return false;
      check("long jump", s_val > 0 && v3_dist_xz(p->pos, s_start) > 9, "%.1f m", v3_dist_xz(p->pos, s_start));
      return true;
    case 5: // backflip: stand still, Z, A
      if (t == 0) { s_peak = 0; s_val = 0; }
      if (t > 20 && t < 30) s_pad.z = true;
      if (t == 26) { s_pad.a = true; s_start = p->pos; }
      if (t > 26) s_peak = maxf(s_peak, p->pos.y - s_start.y);
      if (p->state == ST_BACKFLIP) s_val = 1;
      if (t == 34) shot("backflip");
      if (t < 75) return false;
      check("backflip", s_val > 0 && s_peak > 3.6f, "%.2f m", s_peak);
      return true;
    case 6: // ground pound
      if (t == 0) s_val = 0;
      if (t == 2) s_pad.a = true;
      if (t > 2 && t < 14) s_pad.a = true;
      if (t == 14) s_pad.z = true;
      if (p->state == ST_GPLAND) s_val = 1;
      if (t < 60) return false;
      check("ground pound", s_val > 0, "%.0f", s_val);
      return true;
    case 7: // a car next to us: C-up gets in, A drives
      if (t == 0) { place_player(-64 + 2.5f, -100, PI); V3 a = ahead(0); s_car = vehicle_spawn(VD_SEDAN, (V3){a.x - 3, 0, a.z}, PI); s_car->pos.y = world_floor(s_car->pos.x, s_car->pos.z, 3, NULL); }
      if (t == 10) s_pad.cu = true;
      if (t > 40 && t < 160) s_pad.a = true;
      if (t == 30) check("car: in the driver's seat", p->vehicle == s_car && p->state == ST_VEHICLE, "state %.0f", p->state);
      if (t == 120) shot("driving");
      if (t == 159) { s_val = fabsf(s_car->speed); check("car: drives", s_val > 14, "%.1f m/s", s_val); }
      if (t > 160 && t < 200) s_pad.b = true;
      if (t == 205) s_pad.cu = true;
      if (t < 230) return false;
      check("car: got out", !p->vehicle && actor_alive(p), "state %.0f", p->state);
      return true;
    case 8: // shooting: a pistol, someone in front, R + B
      if (t == 0) {
        place_player(-200, 300, 0);
        weapon_give(p, W_PISTOL, 60);
        V3 a = ahead(9); a.y = world_floor(a.x, a.z, 3, NULL);
        s_other = actor_spawn(AK_CIVILIAN, GANG_NONE, a, PI);
        g.wantedPoints = 0;
      }
      if (t > 5) s_pad.r = true;
      if (t > 12 && (t % 10) == 0) s_pad.b = true;
      if (t == 30) shot("aiming");
      if (t < 120) return false;
      check("shoot: the target is down", s_other && !actor_alive(s_other), "health %.0f", s_other ? s_other->health : -1);
      check("shoot: the police noticed", g.wantedPoints > 0, "%.1f points", g.wantedPoints);
      g.wantedPoints = 0; g.wanted = 0;
      return true;
    case 9: // recruiting: one of the crew in front, D-up
      if (t == 0) {
        place_player(-380, 60, 0);
        V3 a = ahead(2); a.y = world_floor(a.x, a.z, 3, NULL);
        s_other = actor_spawn(AK_GANG, GANG_PALM, a, PI);
        s_other->brain = 2;
      }
      if (t == 5) s_pad.du = true;
      if (t == 10) check("recruit: joins", s_other->recruited && gang_recruit_count() == 1, "%.0f in the crew", gang_recruit_count());
      if (t > 15 && t < 75) s_pad.sy = 1;
      if (t == 70) shot("crew");
      if (t < 110) return false;
      check("recruit: follows", v3_dist(s_other->pos, p->pos) < 7, "%.1f m behind", v3_dist(s_other->pos, p->pos));
      return true;
    case 10: // a rival shows up: the crew fights
      if (t == 0) {
        V3 a = ahead(16); a.y = world_floor(a.x, a.z, 3, NULL);
        s_other = actor_spawn(AK_GANG, GANG_VIOLET, a, PI);
        weapon_give(s_other, W_PISTOL, 60);
        s_other->foe = actor_index(p);
        weapon_give(p, W_SMG, 120);
      }
      if (t > 5) s_pad.r = true;
      if (t > 10) s_pad.b = true;
      if (t == 40) shot("shootout");
      if (t < 150) return false;
      check("shootout: the rival is down", !actor_alive(s_other), "health %.0f", s_other->health);
      gang_dismiss_all();
      return true;
    case 11: // a BMX
      if (t == 0) { place_player(0, 600, PI / 2); V3 a = ahead(0); s_car = vehicle_spawn(VD_BMX, (V3){a.x, 0, a.z - 2}, PI / 2); s_car->pos.y = world_floor(s_car->pos.x, s_car->pos.z, 3, NULL); }
      if (t == 10) s_pad.cu = true;
      if (t > 35 && t < 110) s_pad.a = true;
      if (t == 90) shot("bike");
      if (t == 109) { s_val = fabsf(s_car->speed); check("bike: rides", p->vehicle == s_car && s_val > 7, "%.1f m/s", s_val); }
      if (t == 115) s_pad.cu = true;
      if (t < 150) return false;
      return true;
    case 12: // frame time downtown and in the hood (the N64 must keep up)
      if (t == 0) { place_player(0, -130, 0); s_ticks0 = get_ticks_ms(); s_frames0 = 0; }
      if (t == 100) g_profile = true;
      s_frames0++;
      if (t == 60) shot("downtown");
      if (t < 150) return false;
      perf_parts();
      debugf("PERF downtown %.1f ms a frame (game %.1f, draw %.1f, wait %.1f ms)\n", (get_ticks_ms() - s_ticks0) / (float)s_frames0, g_perf[0] / 1000.0f, g_perf[1] / 1000.0f, g_perf[2] / 1000.0f);
      return true;
    case 13:
      if (t == 0) { place_player(-330, 160, PI * 0.75f); s_ticks0 = get_ticks_ms(); s_frames0 = 0; g_profile = false; }
      if (t == 100) g_profile = true;
      s_frames0++;
      if (t == 60) shot("hood");
      if (t < 150) return false;
      perf_parts();
      debugf("PERF hood %.1f ms a frame (game %.1f, draw %.1f, wait %.1f ms)\n", (get_ticks_ms() - s_ticks0) / (float)s_frames0, g_perf[0] / 1000.0f, g_perf[1] / 1000.0f, g_perf[2] / 1000.0f);
      return true;
  }
  debugf("TEST done: %d passed, %d failed\n", s_passes, s_fails);
  s_test = 999;
  return false;
}

// the tour: every district, a screenshot each
typedef struct { const char *name; float x, z, yaw, hour; } Stop;
static const Stop TOUR[] = {
  {"home", -384, 14, PI, 16}, {"court", -384, 150, PI, 16}, {"commerce", -128, 40, PI * 0.8f, 15}, {"downtown", -64, -100, PI * 0.9f, 14},
  {"park", 20, 280, PI, 16}, {"violet", 300, 40, PI * 0.75f, 16}, {"gold", 192, 420, PI, 17}, {"docks", 560, 250, PI / 2, 16},
  {"hills", -420, -420, PI * 1.2f, 15}, {"beach", -12, 590, 0, 17.5f}, {"oak", -512, -230, PI, 16}, {"night", -64, -100, PI * 0.9f, 22.5f},
  {"sunset", -64, 576, PI / 2, 18.6f},
};
static bool tour(int t) {
  int i = t / 90, f = t % 90;
  if (i >= (int)(sizeof(TOUR) / sizeof(TOUR[0]))) { debugf("TEST done: tour\n"); return true; }
  if (f == 0) { place_player(TOUR[i].x, TOUR[i].z, TOUR[i].yaw); extern float g_hour; g_hour = TOUR[i].hour; }
  if (f == 80) shot(TOUR[i].name);
  return false;
}

// the model show: the hero up close in his poses, then the townspeople
extern bool g_camLock; extern V3 g_camEye, g_camAt;
typedef struct { const char *name; int state; int jumpType; float flip, roll, vx, angle; int combo; } Shot;
static const Shot POSES[] = {
  {"m_idle", ST_IDLE, 0, 0, 0, 0, 0.0f, 0}, {"m_idle_side", ST_IDLE, 0, 0, 0, 0, 1.3f, 0}, {"m_idle_back", ST_IDLE, 0, 0, 0, 0, 2.6f, 0},
  {"m_run", ST_RUN, 0, 0, 0, 9, 0.7f, 0}, {"m_walk", ST_RUN, 0, 0, 0, 2, 0.7f, 0}, {"m_jump1", ST_JUMP, 1, 0, 0, 0, 0.5f, 0},
  {"m_jump2", ST_JUMP, 2, 0, 0, 0, 0.5f, 0}, {"m_triple", ST_JUMP, 3, 1.6f, 0, 0, 1.4f, 0}, {"m_long", ST_LONGJUMP, 1, 0.5f, 0, 0, 1.4f, 0},
  {"m_back", ST_BACKFLIP, 1, -2.2f, 0, 0, 1.4f, 0}, {"m_gp", ST_GPFALL, 1, 0, 0, 0, 0.6f, 0}, {"m_dive", ST_DIVE, 1, 1.45f, 0, 0, 1.3f, 0},
  {"m_punch", ST_PUNCH, 0, 0, 0, 0, 0.8f, 0}, {"m_kick", ST_PUNCH, 0, 0, 0, 0, 1.2f, 2}, {"m_crouch", ST_CROUCH, 0, 0, 0, 0, 0.8f, 0},
  {"m_skid", ST_SKID, 0, 0, 0, 0, 1.2f, 0}, {"m_wall", ST_WALLHIT, 0, 0, 0, 0, 0.6f, 0}, {"m_swim", ST_SWIM, 0, 0, 0, 0, 1.0f, 0},
  {"m_dance", ST_DANCE, 0, 0, 0, 0, 0.3f, 0}, {"m_sleep", ST_IDLE, 0, 0, 0, 0, 0.7f, 99},
};
static V3 s_spot;
static bool model_show(int t) {
  Actor *p = P();
  int n = (int)(sizeof(POSES) / sizeof(POSES[0]));
  int i = t / 24, f = t % 24;
  if (t == 0) { place_player(-384, 160, 0); s_spot = p->pos; g_hour = 13; }
  if (i < n) {
    const Shot *s = &POSES[i];
    float ang = s->angle;
    g_camLock = true;
    g_camEye = (V3){s_spot.x + sinf(ang) * 3.4f, s_spot.y + 1.3f, s_spot.z + cosf(ang) * 3.4f};
    g_camAt = (V3){s_spot.x, s_spot.y + 0.9f, s_spot.z};
    p->pos = s_spot; p->yaw = 0; p->vel = (V3){0, 0, s->vx}; p->onGround = true;
    p->state = s->state; p->jumpType = s->jumpType; p->flip = s->flip; p->roll = s->roll; p->combo = s->combo;
    p->stateTime = s->state == ST_PUNCH ? 0.1f : s->state == ST_DANCE ? 1.6f : 0.3f;
    if (s->state == ST_JUMP || s->state == ST_LONGJUMP || s->state == ST_BACKFLIP || s->state == ST_GPFALL || s->state == ST_DIVE || s->state == ST_WALLHIT) p->pos.y += 0.6f;
    p->idleTime = s->combo == 99 ? 20 : 0;
    p->speed = s->vx;
    if (f == 20) shot(s->name);
    return false;
  }
  // the townspeople in a row
  int k = t - n * 24;
  if (k == 0) {
    for (int j = 0; j < 9; j++) {
      int kind = j < 6 ? AK_CIVILIAN : AK_GANG;
      int gang = j < 6 ? GANG_NONE : j == 6 ? GANG_PALM : j == 7 ? GANG_VIOLET : GANG_GOLD;
      Actor *a = actor_spawn(kind, gang, (V3){s_spot.x - 4 + j * 1.0f, s_spot.y, s_spot.z + 3}, PI);
      if (a) a->brain = 99; // (no brain: stands still)
    }
    p->pos = (V3){s_spot.x + 6, s_spot.y, s_spot.z};
  }
  g_camEye = (V3){s_spot.x, s_spot.y + 1.6f, s_spot.z + 8.5f};
  g_camAt = (V3){s_spot.x, s_spot.y + 0.9f, s_spot.z + 3};
  for (int j = 0; j < MAX_ACTORS; j++) { Actor *a = &g.actors[j]; if (a->used && a->brain == 99) { a->ctl = (Controls){0}; a->yaw = PI; a->state = ST_IDLE; } }
  if (k == 30) shot("m_people");
  if (k == 31) { g_camEye = (V3){s_spot.x - 2, s_spot.y + 1.3f, s_spot.z + 5.2f}; }
  if (k == 50) shot("m_people_near");
  if (k == 60) { debugf("TEST done: model\n"); g_camLock = false; return true; }
  return false;
}

void testplay_input(Pad *p) { *p = s_pad; }

void testplay_step(void) {
  if (s_test == 999 || !g.player) return;
  if (!strcmp(TESTPLAY, "model")) { memset(&s_pad, 0, sizeof(s_pad)); if (model_show(s_t++)) s_test = 999; return; }
  if (!strcmp(TESTPLAY, "tour")) { memset(&s_pad, 0, sizeof(s_pad)); if (tour(s_t++)) s_test = 999; return; }
  if (s_t == 0) debugf("TEST %d\n", s_test);
  if (run_test(s_test, s_t)) { s_test++; s_t = 0; } else s_t++;
  if (!actor_alive(g.player)) { g.player->health = 100; g.player->state = ST_IDLE; }
}
#else
void testplay_input(Pad *p) { (void)p; }
void testplay_step(void) {}
#endif
