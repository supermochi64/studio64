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

void testplay_input(Pad *p) { *p = s_pad; }

void testplay_step(void) {
  if (s_test == 999 || !g.player) return;
  if (s_t == 0) debugf("TEST %d\n", s_test);
  if (run_test(s_test, s_t)) { s_test++; s_t = 0; } else s_t++;
  if (!actor_alive(g.player)) { g.player->health = 100; g.player->state = ST_IDLE; }
}
#else
void testplay_input(Pad *p) { (void)p; }
void testplay_step(void) {}
#endif
