#include "hud.h"
#include "actor.h"
#include "weapon.h"
#include "vehicle.h"
#include "world.h"
#include "gang.h"
#include "camera.h"
#include "player.h"
#include "mission.h"
#include "shop.h"
#include <stdarg.h>

static sprite_t *s_map;
static rdpq_font_t *s_fonts[4];
static sprite_t *s_logo;
static char s_district[24]; static float s_districtTime;

void hud_init(void) {
  s_map = sprite_load("rom:/map.sprite");
  s_logo = sprite_load("rom:/logo.sprite");
  for (int k = 1; k <= 3; k++) {
    char p[32]; sprintf(p, "rom:/font%d.font64", k);
    s_fonts[k] = rdpq_font_load(p);
    rdpq_text_register_font(k, s_fonts[k]);
  }
}

// ---- text: our own pixel font (tools/fonts.mjs) at 1x, 2x, 3x, through rdpq_text ----
int hud_text_width(const char *str, int scale) { return (int)strlen(str) * 6 * (scale < 1 ? 1 : scale > 3 ? 3 : scale); }
static void text_raw(int x, int y, color_t c, int scale, const char *str) {
  scale = scale < 1 ? 1 : scale > 3 ? 3 : scale;
  rdpq_font_style(s_fonts[scale], 0, &(rdpq_fontstyle_t){.color = c});
  // rdpq_text reads $xx and ^xx as font and style changes: double them to print them
  char buf[128]; int n = 0;
  for (const char *p = str; *p && n < (int)sizeof(buf) - 2; p++) { if (*p == '$' || *p == '^') buf[n++] = *p; buf[n++] = *p; }
  buf[n] = 0;
  rdpq_text_print(&(rdpq_textparms_t){.style_id = 0}, scale, x, y + 8 * scale, buf);
}
void hud_text(int x, int y, color_t c, int scale, const char *fmt, ...) {
  char buf[96];
  va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
  text_raw(x, y, c, scale, buf);
}
static void text_center(int y, color_t c, int scale, const char *s) { text_raw(160 - hud_text_width(s, scale) / 2, y, c, scale, s); }

static void rect(int x, int y, int w, int h, color_t c) {
  rdpq_set_mode_standard();
  rdpq_mode_combiner(RDPQ_COMBINER_FLAT);
  if (c.a < 255) rdpq_mode_blender(RDPQ_BLENDER_MULTIPLY);
  rdpq_set_prim_color(c);
  rdpq_fill_rectangle(x, y, x + w, y + h);
}

// ---- the radar: the map turned with the camera, the player in the middle ----
#define RAD_X 14
#define RAD_Y 156
#define RAD_S 70
static void map_to_radar(V3 p, V3 c, float yaw, float scale, int *sx, int *sy) {
  float dx = p.x - c.x, dz = p.z - c.z;
  // the camera's forward is up on the radar
  float f = cosf(yaw), s = sinf(yaw);
  float rx = -(dx * f - dz * s), ry = -(dx * s + dz * f);
  *sx = RAD_X + RAD_S / 2 + (int)(rx * scale);
  *sy = RAD_Y + RAD_S / 2 + (int)(ry * scale);
}
static void blip(V3 p, V3 c, float yaw, float scale, color_t col, int size) {
  int x, y; map_to_radar(p, c, yaw, scale, &x, &y);
  x = maxi(RAD_X + 1, mini(RAD_X + RAD_S - size - 1, x - size / 2));
  y = maxi(RAD_Y + 1, mini(RAD_Y + RAD_S - size - 1, y - size / 2));
  rect(x - 1, y - 1, size + 2, size + 2, RGBA32(0, 0, 0, 255));
  rect(x, y, size, size, col);
}
static void radar(void) {
  Actor *p = g.player;
  if (!p) return;
  V3 c = p->pos;
  float yaw = g_cam.yaw;
  float range = p->vehicle ? 150 : 100;           // meters across the radar
  float mpp = (float)g_world.size / 256.0f;        // meters per map pixel
  float scale = RAD_S / range;                     // radar pixels per meter
  rect(RAD_X - 2, RAD_Y - 2, RAD_S + 4, RAD_S + 4, RGBA32(0, 0, 0, 255));
  rect(RAD_X, RAD_Y, RAD_S, RAD_S, RGBA32(42, 88, 128, 255)); // the sea, past the map's edge
  rdpq_set_scissor(RAD_X, RAD_Y, RAD_X + RAD_S, RAD_Y + RAD_S);
  rdpq_set_mode_standard();
  rdpq_mode_filter(FILTER_BILINEAR);
  float mx = (c.x - g_world.min) / mpp, my = (c.z - g_world.min) / mpp;
  // only the piece of the map round the player (the whole map would be 32 times the work)
  int half = (int)(range * 0.75f / mpp) + 2;
  int s0 = maxi(0, mini(256 - 2 * half, (int)mx - half)), t0 = maxi(0, mini(256 - 2 * half, (int)my - half));
  rdpq_sprite_blit(s_map, RAD_X + RAD_S / 2, RAD_Y + RAD_S / 2, &(rdpq_blitparms_t){
    .s0 = s0, .t0 = t0, .width = 2 * half, .height = 2 * half,
    .cx = (int)mx - s0, .cy = (int)my - t0, .scale_x = mpp * scale, .scale_y = mpp * scale, .theta = -yaw + PI,
  });
  // blips: the crew, rivals and the police near, cars that can be taken are not shown (too many)
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (!actor_alive(a) || a == p) continue;
    if (v3_dist_xz(a->pos, c) > range * 0.7f) continue;
    if (a->recruited) blip(a->pos, c, yaw, scale, RGBA32(80, 230, 90, 255), 3);
    else if (a->kind == AK_COP && g.wanted) blip(a->pos, c, yaw, scale, RGBA32(80, 120, 255, 255), 3);
    else if (a->hostile || a->warrior || (a->kind == AK_GANG && gang_hostile(a, p))) blip(a->pos, c, yaw, scale, RGBA32(240, 60, 60, 255), 2);
  }
  // the mission: where to go (yellow)
  { V3 t; if (mission_target(&t)) blip(t, c, yaw, scale, RGBA32(255, 220, 40, 255), 4); }
  // home
  for (int i = 0; i < g_world.nspot; i++) if (g_world.spots[i].type == SPOT_HOME) blip((V3){g_world.spots[i].x, 0, g_world.spots[i].z}, c, yaw, scale, RGBA32(255, 255, 255, 255), 4);
  rdpq_set_scissor(0, 0, 320, 240);
  // the player: an arrow (a small triangle-ish stack of rects)
  float rel = angle_diff(p->vehicle ? p->vehicle->yaw : p->yaw, yaw);
  int cx = RAD_X + RAD_S / 2, cy = RAD_Y + RAD_S / 2;
  for (int k = 0; k < 4; k++) {
    int ox = (int)(-sinf(rel) * (3 - k) * 1.4f), oy = (int)(-cosf(rel) * (3 - k) * 1.4f);
    rect(cx + ox - 1, cy + oy - 1, 3, 3, k == 0 ? RGBA32(255, 255, 255, 255) : RGBA32(255, 230, 60, 255));
  }
  // north
  int nx, ny; map_to_radar(v3_add(c, (V3){0, 0, -range * 0.42f}), c, yaw, scale, &nx, &ny);
  nx = maxi(RAD_X, mini(RAD_X + RAD_S - 6, nx - 3)); ny = maxi(RAD_Y, mini(RAD_Y + RAD_S - 8, ny - 4));
  hud_text(nx, ny, RGBA32(255, 255, 255, 255), 1, "N");
}

static void bar(int x, int y, int w, float v, color_t c) {
  rect(x - 1, y - 1, w + 2, 6, RGBA32(0, 0, 0, 255));
  rect(x, y, w, 4, RGBA32(c.r / 3, c.g / 3, c.b / 3, 255));
  rect(x, y, (int)(w * clampf(v, 0, 1)), 4, c);
}

void hud_draw(void) {
  // the timers run on game time (not drawn frames: those come at 15 to 30 a second)
  static float lastT; float hdt = clampf(g.time - lastT, 0, 0.2f); lastT = g.time;
  Actor *p = g.player;
  if (!p) return;

  // top right: money, health and armour, the weapon, the stars
  hud_text(320 - 14 - hud_text_width("$00000000", 1), 14, RGBA32(110, 220, 110, 255), 1, "$%08d", g.money);
  bar(320 - 14 - 64, 26, 64, p->health / 100.0f, RGBA32(220, 50, 50, 255));
  if (p->armor > 0) bar(320 - 14 - 64, 33, 64, p->armor / 100.0f, RGBA32(80, 140, 240, 255));
  const WeaponDef *wd = &g_weapons[p->weapon];
  if (wd->clip) hud_text(320 - 14 - 108, 42, RGBA32(255, 255, 255, 255), 1, "%-8s %2d/%d", wd->name, p->clip[p->weapon], p->ammo[p->weapon]);
  else hud_text(320 - 14 - 108, 42, RGBA32(255, 255, 255, 255), 1, "%-8s", wd->name);
  for (int s = 0; s < 5; s++) {
    bool on = s < g.wanted;
    bool blink = on && g.wantedCool < 8 && ((int)(g.time * 4) & 1);
    hud_text(320 - 14 - 5 * 9 + s * 9, 54, on ? (blink ? RGBA32(255, 255, 255, 255) : RGBA32(255, 210, 60, 255)) : RGBA32(70, 70, 70, 255), 1, "*");
  }
  // the crew
  int nr = gang_recruit_count();
  if (nr) hud_text(14, 14, RGBA32(100, 220, 110, 255), 1, "CREW %d/%d", nr, gang_max_recruits());
  // the vehicle
  if (p->vehicle) {
    Vehicle *v = p->vehicle;
    hud_text(RAD_X + RAD_S + 8, 224, RGBA32(255, 255, 255, 255), 1, "%s  %3d km/h", g_vdefs[v->def].name, (int)(fabsf(v->speed) * 3.6f));
    if (v->health < g_vdefs[v->def].health * 0.35f) hud_text(RAD_X + RAD_S + 8, 214, RGBA32(255, 120, 60, 255), 1, v->burning ? "ON FIRE! GET OUT" : "DAMAGED");
  }
  // the crosshair on the target
  if (p->target >= 0 && (p->ctl.aim || player_camera_mode() == CAM_AIM)) {
    float sx, sy;
    if (render_project(actor_chest(&g.actors[p->target]), &sx, &sy)) {
      color_t c = g.actors[p->target].health > 40 ? RGBA32(90, 255, 90, 255) : g.actors[p->target].health > 15 ? RGBA32(255, 220, 60, 255) : RGBA32(255, 60, 60, 255);
      int x = (int)sx, y = (int)sy;
      rect(x - 6, y - 1, 4, 2, c); rect(x + 3, y - 1, 4, 2, c); rect(x - 1, y - 6, 2, 4, c); rect(x - 1, y + 3, 2, 4, c);
    }
  } else if (player_camera_mode() == CAM_AIM) {
    rect(159, 118, 2, 4, RGBA32(255, 255, 255, 255)); rect(158, 119, 4, 2, RGBA32(255, 255, 255, 255));
  }
  radar();
  // the district's name when it changes
  const char *dn = world_district_name(p->pos.x, p->pos.z);
  if (strncmp(dn, s_district, sizeof(s_district) - 1)) { strncpy(s_district, dn, sizeof(s_district) - 1); s_districtTime = 3.5f; }
  if (s_districtTime > 0) {
    s_districtTime -= hdt;
    int w = hud_text_width(s_district, 2);
    hud_text(320 - 14 - w, 196, RGBA32(240, 230, 200, 255), 2, "%s", s_district);
    int b = world_block(p->pos.x, p->pos.z), o = gang_block_owner(b);
    if (o) hud_text(320 - 14 - hud_text_width(g_gangs[o].name, 1), 214, g_gangs[o].color, 1, "%s", g_gangs[o].name);
  }
  // messages
  if (g.messageTime > 0) {
    g.messageTime -= hdt;
    // above the radar, wrapped at a word into two lines when long
    char l1[48], l2[48]; const char *m = g.message;
    int n = strlen(m), cut = n;
    if (n > 40) { cut = 40; while (cut > 0 && m[cut] != ' ') cut--; if (cut == 0) cut = 40; }
    snprintf(l1, sizeof(l1), "%.*s", cut, m);
    snprintf(l2, sizeof(l2), "%s", cut < n ? m + cut + (m[cut] == ' ') : "");
    int w = maxi(hud_text_width(l1, 1), hud_text_width(l2, 1)), y = l2[0] ? 128 : 138;
    rect(160 - w / 2 - 4, y - 2, w + 8, l2[0] ? 24 : 12, RGBA32(0, 0, 0, 120));
    text_center(y, RGBA32(255, 255, 255, 255), 1, l1);
    if (l2[0]) text_center(y + 12, RGBA32(255, 255, 255, 255), 1, l2);
  }
  if (g.bigTime > 0) {
    g.bigTime -= hdt;
    color_t c = !strcmp(g.bigMessage, "KNOCKED OUT") || !strcmp(g.bigMessage, "ARRESTED") || !strcmp(g.bigMessage, "WAR LOST") ? RGBA32(230, 60, 50, 255) : RGBA32(255, 220, 80, 255);
    text_center(90, c, 3, g.bigMessage);
  }
  mission_hud();
  shop_hud();
  if (g.war) hud_text(14, 26, RGBA32(255, 200, 80, 255), 1, g.warTimer > 0 && g.warWave == 0 ? "GANG WAR: GET READY" : "GANG WAR  WAVE %d/3  %d LEFT", g.warWave, g.warLeft);
}

// ---- the pause screen ----
void hud_draw_pause(int page) {
  rect(0, 0, 320, 240, RGBA32(0, 0, 0, 150));
  if (page == 0) {
    // the map with the gangs' blocks and the player
    const float S = 0.82f;
    int ox = 160 - (int)(128 * S), oy = 22;
    rdpq_set_mode_standard();
    rdpq_mode_filter(FILTER_BILINEAR);
    rdpq_sprite_blit(s_map, ox, oy, &(rdpq_blitparms_t){.scale_x = S, .scale_y = S});
    float mpp = (float)g_world.size / 256.0f;
    for (int b = 0; b < 81; b++) {
      int o = g_world.owner[b];
      if (!o) continue;
      float x0 = g_world.lines[b % 9], x1 = g_world.lines[b % 9 + 1], z0 = g_world.lines[b / 9], z1 = g_world.lines[b / 9 + 1];
      int sx = ox + (int)((x0 - g_world.min) / mpp * S), sy = oy + (int)((z0 - g_world.min) / mpp * S);
      int w = (int)((x1 - x0) / mpp * S), h = (int)((z1 - z0) / mpp * S);
      color_t c = g_gangs[o].color; c.a = 70;
      rect(sx + 1, sy + 1, w - 2, h - 2, c);
    }
    if (g.war) {
      int b = g.war - 1;
      float x0 = g_world.lines[b % 9], z0 = g_world.lines[b / 9];
      int sx = ox + (int)((x0 - g_world.min) / mpp * S), sy = oy + (int)((z0 - g_world.min) / mpp * S);
      if ((int)(g.time * 3) & 1) rect(sx, sy, (int)(128 / mpp * S), (int)(128 / mpp * S), RGBA32(255, 60, 40, 110));
    }
    Actor *p = g.player;
    if (p) {
      int px = ox + (int)((p->pos.x - g_world.min) / mpp * S), py = oy + (int)((p->pos.z - g_world.min) / mpp * S);
      rect(px - 3, py - 3, 7, 7, RGBA32(0, 0, 0, 255)); rect(px - 2, py - 2, 5, 5, ((int)(g.time * 4) & 1) ? RGBA32(255, 255, 255, 255) : RGBA32(255, 230, 60, 255));
    }
    hud_text(14, 6, RGBA32(255, 255, 255, 255), 1, "COSTA VERDE");
    hud_text(320 - 14 - hud_text_width("Z: CONTROLS", 1), 6, RGBA32(200, 200, 200, 255), 1, "Z: CONTROLS");
    hud_text(14, 228, RGBA32(46, 180, 60, 255), 1, "PALM COURT CREW %d BLOCKS", gang_territories(GANG_PALM));
    hud_text(190, 228, RGBA32(200, 200, 200, 255), 1, "RESPECT %d", g.respect);
  } else {
    static const char *LINES[] = {
      "ON FOOT", "STICK    MOVE", "A        JUMP  (AGAIN ON LANDING:", "         DOUBLE, TRIPLE JUMP)", "Z+A      RUNNING: LONG JUMP", "         STANDING: BACKFLIP",
      "Z (AIR)  GROUND POUND", "B        PUNCH, KICK / SHOOT", "R (HOLD) AIM AT NEAREST TARGET", "C-UP     GET IN / OUT", "D-PAD </> WEAPON", "D-UP     RECRUIT CREW",
      "D-DOWN   SEND CREW HOME", "", "DRIVING", "A GAS  B BRAKE  Z HANDBRAKE/HOP", "R + B    SHOOT FROM THE CAR", "L        HORN", NULL,
    };
    for (int i = 0; LINES[i]; i++) hud_text(24, 14 + i * 11, i == 0 || i == 14 ? RGBA32(255, 220, 80, 255) : RGBA32(255, 255, 255, 255), 1, "%s", LINES[i]);
  }
  text_center(216 - (page ? 0 : 200), RGBA32(255, 255, 255, 255), 1, page ? "START: BACK TO THE GAME" : "");
}

void hud_draw_title(float t, bool hasSave, int choice) {
  // the title over the city (the 3D scene is drawn behind it)
  rect(0, 0, 320, 240, RGBA32(0, 0, 0, 90));
  float bob = sinf(t * 2) * 2;
  rdpq_set_mode_standard();
  rdpq_mode_alphacompare(1);
  rdpq_sprite_blit(s_logo, 160 - 128, 16 + (int)bob, NULL);
  text_center(92, RGBA32(240, 240, 240, 255), 1, "COSTA VERDE");
  const char *items[2] = {hasSave ? "CONTINUE" : "NEW GAME", hasSave ? "NEW GAME" : NULL};
  for (int i = 0; i < 2; i++) {
    if (!items[i]) continue;
    bool sel = choice == i;
    color_t c = sel ? (((int)(t * 3) & 1) ? RGBA32(255, 255, 255, 255) : RGBA32(255, 220, 80, 255)) : RGBA32(160, 160, 160, 255);
    text_center(140 + i * 16, c, sel ? 2 : 1, items[i]);
  }
  text_center(196, RGBA32(200, 200, 200, 255), 1, "PRESS START");
  text_center(222, RGBA32(140, 140, 140, 255), 1, "AN ORIGINAL GAME. MADE WITH LIBDRAGON + TINY3D");
}
