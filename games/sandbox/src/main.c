// Sandbox: an open city on the Nintendo 64. The main loop: the title, the game, the pause screen.
#include "game.h"
#include "world.h"
#include "stream.h"
#include "render.h"
#include "camera.h"
#include "input.h"
#include "actor.h"
#include "player.h"
#include "vehicle.h"
#include "weapon.h"
#include "ai.h"
#include "population.h"
#include "pickup.h"
#include "gang.h"
#include "fx.h"
#include "sound.h"
#include "hud.h"
#include "save.h"
#include "testplay.h"
#include "mission.h"
#include "shop.h"
#include <stdarg.h>

Game g;
float g_perf[3];
float g_perfDraw[5];
V3 g_titleHome;
bool g_profile;     // (tests) wait for the RSP/RDP after each part, so the times are the GPU's // the city, vehicles, people, pickups+fx, the HUD // smoothed microseconds: the game step, building the frame, waiting for a free frame buffer
Models g_models;
uint32_t g_rng = 0x2545F491;

void game_message(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt); vsnprintf(g.message, sizeof(g.message), fmt, ap); va_end(ap);
  g.messageTime = 3.5f;
}
void game_big(const char *text) { strncpy(g.bigMessage, text, sizeof(g.bigMessage) - 1); g.bigTime = 3.0f; }

static T3DModel *load(const char *name) { char p[48]; sprintf(p, "rom:/%s.t3dm", name); return t3d_model_load(p); }

static V3 spot_pos(int type, V3 fallback, float *yaw) {
  for (int i = 0; i < g_world.nspot; i++) if (g_world.spots[i].type == type) {
    Spot *s = &g_world.spots[i];
    if (yaw) *yaw = s->yaw;
    return (V3){s->x, world_floor(s->x, s->z, 50, NULL), s->z};
  }
  return fallback;
}
static V3 nearest_spot(int type, V3 near) {
  float bd = 1e18f; V3 best = near;
  for (int i = 0; i < g_world.nspot; i++) {
    Spot *s = &g_world.spots[i];
    if (s->type != type) continue;
    float d = sqrf(s->x - near.x) + sqrf(s->z - near.z);
    if (d < bd) { bd = d; best = (V3){s->x, world_floor(s->x, s->z, 50, NULL), s->z}; }
  }
  return best;
}

static void new_game(bool fromSave) {
  population_clear();
  for (int i = 0; i < MAX_ACTORS; i++) g.actors[i].used = false;
  for (int i = 0; i < MAX_VEHICLES; i++) g.vehicles[i].used = false;
  g.player = NULL;
  g.money = 0; g.wanted = 0; g.wantedPoints = 0; g.war = 0; g.deadTimer = 0;
  gang_init();
  // home: the cul-de-sac in Palm Court
  float yaw = 0;
  V3 home = spot_pos(SPOT_HOME, (V3){-320, 0.15f, 30}, &yaw);
  player_spawn(v3_add(home, (V3){0, 0, 4}), PI);
  if (fromSave) save_read();
  // a lowrider and a BMX in front of the house
  Vehicle *v = vehicle_spawn(VD_LOWRIDER, v3_add(home, (V3){-6, 0, 8}), 0);
  if (v) { v->paint = RGBA32(40, 130, 60, 255); v->parked = true; }
  Vehicle *b = vehicle_spawn(VD_BMX, v3_add(home, (V3){5, 0, 6}), PI / 2);
  if (b) b->parked = true;
  camera_init(g.player->pos, PI);
  g_hour = fromSave ? g_hour : 16.0f;
  game_message("Welcome home. The block's yours: go get the rest");
}

static void respawn(void) {
  Actor *p = g.player;
  V3 at = nearest_spot(g.deadKind == 2 ? SPOT_POLICE : SPOT_HOSPITAL, p->pos);
  if (p->vehicle) vehicle_leave(p->vehicle, p, false);
  population_clear();
  p->pos = v3_add(at, (V3){0, 0, 3});
  p->state = ST_IDLE; p->health = 100; p->armor = 0; p->onGround = true; p->vel = (V3){0, 0, 0}; p->speed = 0;
  if (g.deadKind == 2) {
    // arrested: the guns are taken
    p->weapons = 1 << W_FIST; p->weapon = W_FIST;
    for (int w = 0; w < W_COUNT; w++) { p->ammo[w] = 0; p->clip[w] = 0; }
    g.money = maxi(0, g.money - 100);
  } else g.money = maxi(0, g.money - 100);
  g.wanted = 0; g.wantedPoints = 0; g.war = 0; g.deadTimer = 0;
  camera_init(p->pos, 0);
}

static void people_separate(void) {
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!a->used || a->vehicle || a->state == ST_DEAD) continue;
    for (int j = i + 1; j < MAX_ACTORS; j++) {
      Actor *b = &g.actors[j];
      if (!b->used || b->vehicle || b->state == ST_DEAD || fabsf(a->pos.y - b->pos.y) > 1.5f) continue;
      float dx = b->pos.x - a->pos.x, dz = b->pos.z - a->pos.z, d2 = dx * dx + dz * dz;
      if (d2 > 0.36f || d2 < 1e-6f) continue;
      float d = sqrtf(d2), push = (0.6f - d) * 0.5f / d;
      a->pos.x -= dx * push; a->pos.z -= dz * push;
      b->pos.x += dx * push; b->pos.z += dz * push;
    }
  }
}

static void game_step(const Pad *pad) {
  g.time += DT; g.frame++;
  g_hour = fmodf(g_hour + DT * (24.0f / (24 * 60)), 24.0f); // a day lasts 24 minutes
  bool inShop = shop_step(pad);
  Pad pp = *pad;
  if (inShop) { pp.pdl = pp.pdr = pp.pcu = false; }
  player_step(&pp);
  for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].used && &g.actors[i] != g.player) ai_think(&g.actors[i]);
  for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].used) actor_step(&g.actors[i]);
  for (int i = 0; i < MAX_VEHICLES; i++) if (g.vehicles[i].used) vehicle_step(&g.vehicles[i]);
  vehicle_collide_all();
  // riders follow their vehicle
  for (int i = 0; i < MAX_ACTORS; i++) { Actor *a = &g.actors[i]; if (a->used && a->vehicle && a->state == ST_VEHICLE) { a->pos = a->vehicle->pos; a->yaw = a->vehicle->yaw; a->vel = a->vehicle->vel; } }
  people_separate();
  weapon_projectiles_step();
  fx_step();
  pickup_step();
  population_step();
  gang_step();
  mission_step();
  Actor *p = g.player;
  // knocked out or arrested: a moment, then back at the clinic / the police station
  if (p && !actor_alive(p) && g.deadTimer <= 0) { g.deadTimer = 4; g.deadKind = 1; game_big("KNOCKED OUT"); sound_play_ui(SND_WASTED); }
  if (g.deadTimer > 0) { g.deadTimer -= DT; if (g.deadTimer <= 0) respawn(); }
  // the camera
  if (p) {
    int mode = player_camera_mode();
    if (p->vehicle && p->state == ST_VEHICLE) camera_update(p->vehicle->pos, p->vehicle->yaw, fabsf(p->vehicle->speed), mode, player_aim_point(), pad);
    else {
      g_camGrounded = p->onGround || p->state == ST_POLE || p->state == ST_LEDGE || p->state == ST_LEDGECLIMB || p->state == ST_SWIM;
      g_camSwimming = p->state == ST_SWIM && p->pos.y < WATER_Y - 1.6f;
      camera_update(p->pos, p->yaw, v3_len_xz(p->vel), mode, player_aim_point(), pad);
    }
    // the engine and the radio of the player's vehicle
    if (p->vehicle && p->state == ST_VEHICLE && g_vdefs[p->vehicle->def].motor) {
      sound_engine(true, clampf(fabsf(p->vehicle->speed) / g_vdefs[p->vehicle->def].maxSpeed + fabsf(p->vehicle->throttle) * 0.2f, 0, 1.2f), p->vehicle->pos);
      sound_radio(!vehicle_is_bike(p->vehicle));
    } else { sound_engine(false, 0, p->pos); sound_radio(false); }
    bool siren = false; V3 sp = {0};
    for (int i = 0; i < MAX_VEHICLES; i++) { Vehicle *v = &g.vehicles[i]; if (v->used && v->siren && v->seat[0] && v3_dist(v->pos, p->pos) < 80) { siren = true; sp = v->pos; } }
    sound_siren(siren, sp);
    // the music: a war or a big chase, else the beach, else the city by day or by night
    int blk = world_block(p->pos.x, p->pos.z);
    bool beach = blk >= 0 && g_world.dmap[blk] == 'B';
    bool night = g_hour < 6.0f || g_hour >= 20.0f;
    sound_music(g.war || g.wanted >= 3 ? MUS_WAR : beach && !night ? MUS_BEACH : night ? MUS_NIGHT : MUS_DAY);
  }
}

static void draw_world(void) {
  if (g_profile) rspq_wait();
  uint32_t t0 = get_ticks_us();
  stream_draw();
  if (g_profile) rspq_wait();
  uint32_t t1 = get_ticks_us();
  for (int i = 0; i < MAX_VEHICLES; i++) if (g.vehicles[i].used) vehicle_draw(&g.vehicles[i]);
  if (g_profile) rspq_wait();
  uint32_t t2 = get_ticks_us();
  for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].used) actor_draw(&g.actors[i]);
  if (g_profile) rspq_wait();
  uint32_t t3 = get_ticks_us();
  pickup_draw();
  mission_draw();
  shop_draw();
  weapon_projectiles_draw();
  fx_draw();
  if (g_profile) rspq_wait();
  uint32_t t4 = get_ticks_us();
  g_perfDraw[0] = lerpf(g_perfDraw[0], t1 - t0, 0.1f); g_perfDraw[1] = lerpf(g_perfDraw[1], t2 - t1, 0.1f);
  g_perfDraw[2] = lerpf(g_perfDraw[2], t3 - t2, 0.1f); g_perfDraw[3] = lerpf(g_perfDraw[3], t4 - t3, 0.1f);
}

int main(void) {
  debug_init_isviewer();
  debug_init_usblog();
  asset_init_compression(2);
  dfs_init(DFS_DEFAULT_LOCATION);
  render_init();
  if (!is_memory_expanded()) {
    // the city needs the Expansion Pak's 8 MB (every common emulator has it on)
    for (;;) { surface_t *fb = display_get(); graphics_fill_screen(fb, 0); graphics_draw_text(fb, 40, 110, "This game needs the Expansion Pak."); display_show(fb); }
  }
  input_init();
  sound_init();
  world_load();
  stream_init();
  g_models.hero = load("hero"); g_models.person = load("person"); g_models.personFar = load("person_lod");
  g_models.shadow = load("shadow"); g_models.fxCube = load("fx_cube"); g_models.fxFlash = load("fx_flash");
  g_models.fxTracer = load("fx_tracer"); g_models.marker = load("marker");
  g_models.pickHealth = load("p_health"); g_models.pickArmor = load("p_armor"); g_models.pickCash = load("p_cash");
  weapon_init();
  vehicle_init();
  hud_init();
  save_init();
  fx_init();
  ai_init();
  population_init();
  pickup_init();
  mission_init();
  shop_init();
  debugf("Sandbox: %d boxes, %d street edges, %d sidewalk nodes, %d spots\n", g_world.nbox, g_world.nsedge, g_world.nwnode, g_world.nspot);

  enum { S_TITLE, S_PLAY, S_PAUSE } state = S_TITLE;
  int choice = 0, page = 0;
  bool hasSave = save_exists();
  float titleT = 0;
  Pad pad;
  // the title: the camera drifts over Palm Court
  V3 home = spot_pos(SPOT_HOME, (V3){-320, 0.15f, 30}, NULL);
  g_titleHome = home;
#ifdef TESTPLAY
  new_game(false);
  state = S_PLAY;
#endif
  uint32_t last = get_ticks_ms();
  float acc = 0;
  for (;;) {
    uint32_t now = get_ticks_ms();
    float real = (now - last) / 1000.0f; last = now;
#ifdef TESTPLAY
    real = DT; // one step a frame: tests repeat exactly
#endif
    acc = minf(acc + real, DT * 2);
    if (state == S_TITLE) {
      sound_music(MUS_TITLE);
      input_update(&pad);
      titleT += real;
      float a = titleT * 0.08f;
      g_view.eye = (V3){home.x + sinf(a) * 42, 14, home.z + cosf(a) * 42};
      g_view.target = (V3){home.x, 6, home.z};
      stream_update(home);
      if (hasSave && (pad.pdu || pad.pdd || pad.sy > 0.5f || pad.sy < -0.5f)) choice = pad.sy < -0.5f || pad.pdd ? 1 : 0;
      if (pad.pstart || pad.pa) { new_game(hasSave && choice == 0); state = S_PLAY; sound_play_ui(SND_PICKUP); }
      render_begin(); draw_world(); render_end();
      hud_draw_title(titleT, hasSave, choice);
      render_present();
      sound_update();
      continue;
    }
    if (state == S_PLAY) {
      // fixed 30 steps a second, one or two per drawn frame
      int steps = 0;
      uint32_t t0 = get_ticks_us();
      while (acc >= DT - 0.001f && steps < 2) {
        input_update(&pad);
        if (pad.pstart) { state = S_PAUSE; page = 0; break; }
        game_step(&pad);
        testplay_step();
        acc -= DT; steps++;
      }
      g_perf[0] = lerpf(g_perf[0], get_ticks_us() - t0, 0.1f);
    } else {
      input_update(&pad);
      if (pad.pz || pad.pr) page ^= 1;
      if (pad.pstart) state = S_PLAY;
      acc = 0;
    }
    stream_update(g.player ? g.player->pos : g_view.eye);
    uint32_t t1 = get_ticks_us();
    render_begin();
    uint32_t t2 = get_ticks_us();
    draw_world();
    render_end();
    uint32_t th = get_ticks_us();
    if (state == S_PAUSE) hud_draw_pause(page); else hud_draw();
    if (g_profile) rspq_wait();
    g_perfDraw[4] = lerpf(g_perfDraw[4], get_ticks_us() - th, 0.1f);
    render_present();
    uint32_t t3 = get_ticks_us();
    g_perf[1] = lerpf(g_perf[1], t3 - t2, 0.1f);
    g_perf[2] = lerpf(g_perf[2], t2 - t1, 0.1f); // render_begin waits for a free buffer (the RDP still drawing)
    sound_update();
  }
}
