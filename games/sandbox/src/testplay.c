#include <string.h>
#include "testplay.h"
#include "sound.h"
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
extern float g_perfCity[2];
static void perf_parts(void) {
  int np = 0, nv = 0;
  for (int i = 0; i < MAX_ACTORS; i++) np += g.actors[i].used;
  for (int i = 0; i < MAX_VEHICLES; i++) nv += g.vehicles[i].used;
  debugf("PERF parts (GPU): city %.1f, vehicles %.1f, people %.1f, fx %.1f, hud %.1f ms; %d people, %d vehicles; city %d tris, %d objects in %d blocks (solid %.1f, small+night %.1f ms)\n", g_perfDraw[0] / 1000, g_perfDraw[1] / 1000, g_perfDraw[2] / 1000, g_perfDraw[3] / 1000, g_perfDraw[4] / 1000, np, nv, stream_drawn_tris(), stream_drawn_objects(), stream_drawn_blocks(), g_perfCity[0] / 1000, g_perfCity[1] / 1000);
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
      if (t == 0) { place_player(-64, -170, 0); s_start = P()->pos; s_peak = 0; }
      if (t == 2) s_pad.a = true;
      if (t > 2 && t < 20) s_pad.a = true; // held: full height
      s_peak = maxf(s_peak, p->pos.y - s_start.y);
      if (t < 50) return false;
      check("jump: height", s_peak > 1.7f && s_peak < 2.8f, "%.2f m", s_peak);
      check("jump: landed", p->onGround, "state %.0f", p->state);
      check("sound: the music plays", sound_music_now() != MUS_NONE, "track %.0f", sound_music_now());
      check("sound: the hero shouts", g_voicesPlayed > 0, "%.0f lines", g_voicesPlayed);
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
    case 14: // swimming: into the sea, strokes, a dive, floating up, the water jump
      if (t == 0) {
        float z = 600;
        while (z < 755 && WATER_Y - world_floor(-96, z, 5, NULL) < 4.5f) z += 2;
        place_player(-96, z, PI / 2); s_start = p->pos; s_val = 0; s_peak = 0;
      }
      if (t == 20) check("swim: in the water", p->state == ST_SWIM, "state %.0f", p->state);
      if (t >= 20 && t < 50) { s_pad.sy = 1; s_pad.a = (t % 12) < 2; }   // stick up: dive
      if (t == 50) { s_val = p->pos.y; check("swim: dives down", p->pos.y < WATER_Y - 2.2f, "y %.2f", p->pos.y); s_start = p->pos; shot("swim_under"); }
      if (t >= 50 && t < 140) { s_pad.sy = -0.5f; s_pad.a = (t % 18) < 2; }  // stick back: up and on
      if (t == 140) { check("swim: strokes carry", v3_dist_xz(p->pos, s_start) > 4, "%.1f m", v3_dist_xz(p->pos, s_start)); check("swim: back at the surface", p->pos.y > WATER_Y - 1.4f, "y %.2f", p->pos.y); }
      if (t >= 141 && t < 146) { s_pad.sy = -1; s_pad.a = t == 142; }
      if (t > 141 && t < 175) s_peak = maxf(s_peak, p->pos.y);
      if (t == 150) shot("swim_jump");
      if (t == 175) { check("swim: the water jump", s_peak > WATER_Y + 0.3f, "feet %.2f m", s_peak - WATER_Y); check("swim: no damage", p->health > 90, "health %.0f", p->health); }
      return t >= 175;
    case 15: // the wall kick: run at a wall, jump, A as it is hit
      if (t == 0) {
        place_player(-64, -170, 0);
        float best = 99, by = 0;
        for (int k = 0; k < 16; k++) {
          float yaw = k * TAU / 16, ht; V3 nn;
          V3 a = {p->pos.x, p->pos.y + 1.2f, p->pos.z}, b = v3_add(a, v3_scale(yaw_dir(yaw), 30));
          if (!world_raycast(a, b, &ht, &nn) || ht * 30 < 7 || ht * 30 > best || fabsf(nn.y) > 0.2f) continue;
          // a real wall: wide (both sides hit it too) and square on
          V3 side = yaw_dir(yaw + PI / 2); bool wide = true;
          for (int sd = -1; sd <= 1; sd += 2) {
            float h2; V3 n2; V3 a2 = v3_add(a, v3_scale(side, sd * 1.5f));
            if (!world_raycast(a2, v3_add(a2, v3_scale(yaw_dir(yaw), 30)), &h2, &n2) || fabsf(h2 - ht) * 30 > 0.6f) wide = false;
          }
          if (wide) { best = ht * 30; by = yaw; }
        }
        place_player(p->pos.x, p->pos.z, by); s_val = best; s_peak = 0; s_start = p->pos;
      }
      if (t > 0 && t < 120) {
        s_pad.sy = 1;
        if (p->onGround && v3_dist_xz(p->pos, s_start) > s_val - 3.6f && s_peak == 0) s_peak = 1;
        if (s_peak == 1) s_pad.a = true; // (held: the full jump)
        if (p->state == ST_WALLHIT && s_peak == 1) { s_peak = 2; s_pad.a = false; }
        else if (s_peak == 2) { s_pad.a = true; s_peak = 3; }
        if (p->state == ST_WALLKICK) s_peak = 4;
      }
      if (t == 120 || (s_peak == 4 && p->onGround)) { check("wall kick", s_peak == 4, "step %.0f", s_peak); return true; }
      return false;
  }
  debugf("TEST done: %d passed, %d failed\n", s_passes, s_fails);
  s_test = 999;
  return false;
}

// the tour: every district, a screenshot each
typedef struct { const char *name; float x, z, yaw, hour; } Stop;
static const Stop TOUR[] = {
  {"home", -384, 14, PI, 16}, {"court", -384, 150, PI, 16}, {"commerce", -150, 62, PI * 0.6f, 15}, {"downtown", -64, -100, PI * 0.9f, 14},
  {"park", 20, 280, PI, 16}, {"violet", 300, 40, PI * 0.75f, 16}, {"gold", 192, 420, PI, 17}, {"docks", 560, 250, PI / 2, 16},
  {"hills", -420, -420, PI * 1.2f, 15}, {"beach", -96, 598, 0.3f, 15.5f}, {"oak", -512, -230, PI, 16}, {"night", -64, -100, PI * 0.9f, 22.5f},
  {"sunset", -64, 576, PI / 2, 18.6f}, {"night_hood", -384, 14, PI, 21.5f}, {"night_shops", -150, 62, PI * 0.6f, 21.0f}, {"night_lamp", -61, -99, PI, 22.0f}, {"band", -384, -150, PI, 16}, {"title_0", -384, 14, PI, 16}, {"title_1", -384, 14, PI, 16}, {"title_2", -384, 14, PI, 16}, {"title_3", -384, 14, PI, 16}, {"title_4", -384, 14, PI, 16}, {"title_5", -384, 14, PI, 16}, {"title_6", -384, 14, PI, 16}, {"title_7", -384, 14, PI, 16},
  // flicker checks at night: low and grazing views, each shot twice with the eye moved 3 cm
  {"zf_hood", -384, 40, PI, 22}, {"zf_downtown", -64, -60, PI, 22}, {"zf_shops", -150, 100, PI, 22}, {"zf_docks", 540, 250, PI / 2, 22},
  {"zf_beach", -96, 560, 0, 22}, {"zf_violet", 300, 80, PI, 22}, {"zf_gold", 192, 460, PI, 22}, {"zf_hills", -420, -380, PI, 22},
};
static bool tour(int t) {
  int i = t / 90, f = t % 90;
  if (i >= (int)(sizeof(TOUR) / sizeof(TOUR[0]))) { debugf("TEST done: tour\n"); return true; }
  extern bool g_camLock; extern V3 g_camEye, g_camAt;
  if (f == 0) { place_player(TOUR[i].x, TOUR[i].z, TOUR[i].yaw); extern float g_hour; g_hour = TOUR[i].hour; g_camLock = false; }
  // the lamp stop: look down at the lamp and the light under it
  if (strncmp(TOUR[i].name, "title_", 6) == 0 && f > 10) {
    // the title screen's orbit round home (src/main.c)
    extern V3 g_titleHome; float a = (TOUR[i].name[6] - '0') * (PI / 4);
    g_camLock = true; g_camEye = (V3){g_titleHome.x + sinf(a) * 60, 28, g_titleHome.z + cosf(a) * 60}; g_camAt = (V3){g_titleHome.x, 4, g_titleHome.z};
  }
  if (strcmp(TOUR[i].name, "band") == 0 && f > 10) { g_camLock = true; g_camEye = (V3){-384, 30, -150}; g_camAt = (V3){-384, 25, -400}; }
  if (strcmp(TOUR[i].name, "night_lamp") == 0 && f > 10) { g_camLock = true; g_camEye = (V3){-56, 9, -104}; g_camAt = (V3){-59.8f, 0, -109.3f}; }
  if (strncmp(TOUR[i].name, "zf_", 3) == 0 && f > 10) {
    for (int j = 0; j < MAX_ACTORS; j++) if (g.actors[j].used && &g.actors[j] != P()) actor_free(&g.actors[j]);
    for (int j = 0; j < MAX_VEHICLES; j++) if (g.vehicles[j].used) vehicle_free(&g.vehicles[j]);
    V3 b = {TOUR[i].x, world_floor(TOUR[i].x, TOUR[i].z, 60, NULL), TOUR[i].z}, d = yaw_dir(TOUR[i].yaw);
    float o = f >= 72 ? 0.02f : f >= 58 ? 0.01f : 0;
    b.x += d.x * 2.5f; b.z += d.z * 2.5f; // (the hero stands behind the camera)
    g_camLock = true; g_camEye = (V3){b.x + o, b.y + 1.7f, b.z}; g_camAt = (V3){b.x + d.x * 60 + o, b.y + 0.8f, b.z + d.z * 60};
    if (f == 50 || f == 64 || f == 80) { char n[32]; snprintf(n, sizeof(n), "%s_%c", TOUR[i].name, f == 50 ? 'a' : f == 64 ? 'b' : 'c'); shot(n); }
    return false;
  }
  if (f == 80) { extern int g_nightBlocks, g_nightTris; debugf("TOUR %s: %d night blocks, %d tris\n", TOUR[i].name, g_nightBlocks, g_nightTris); shot(TOUR[i].name); }
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
