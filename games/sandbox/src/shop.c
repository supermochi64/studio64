// The Arms Depot (in Commerce Row): stand in its marker, D-left/right picks a gun, C-up buys it.
#include "shop.h"
#include "actor.h"
#include "weapon.h"
#include "world.h"
#include "hud.h"
#include "sound.h"

static V3 s_at;
static bool s_has, s_inside;
static int s_pick = W_PISTOL;

void shop_init(void) {
  s_has = false;
  for (int i = 0; i < g_world.nspot; i++) {
    Spot *s = &g_world.spots[i];
    if (s->type == SPOT_SHOP && s->param == 14) { s_at = (V3){s->x, world_floor(s->x, s->z, 30, NULL), s->z}; s_has = true; break; }
  }
}

bool shop_step(const Pad *pad) {
  Actor *p = g.player;
  s_inside = s_has && actor_alive(p) && !p->vehicle && v3_dist_xz(p->pos, s_at) < 1.6f;
  if (!s_inside) return false;
  if (pad->pdl) { do s_pick = s_pick <= W_BAT ? W_LAUNCHER : s_pick - 1; while (!g_weapons[s_pick].price); sound_play_ui(SND_BLIP); }
  if (pad->pdr) { do s_pick = s_pick >= W_LAUNCHER ? W_BAT : s_pick + 1; while (!g_weapons[s_pick].price); sound_play_ui(SND_BLIP); }
  if (pad->pcu) {
    int price = g_weapons[s_pick].price;
    if (g.money < price) { game_message("Not enough money"); sound_play_ui(SND_EMPTY); }
    else { g.money -= price; weapon_give(p, s_pick, g_weapons[s_pick].startAmmo); game_message("Bought: %s", g_weapons[s_pick].name); sound_play_ui(SND_CASH); }
  }
  return true; // the shop has the D-pad and C-up while you stand in it
}

void shop_draw(void) {
  if (!s_has || v3_dist2_xz(s_at, g_view.eye) > 80 * 80) return;
  T3DMat4 mt;
  mat_place(&mt, s_at, g.time, 0, 0, 0, MODEL_SCALE);
  render_colored(g_models.marker, &mt, RGBA32(255, 90, 60, 160));
}

void shop_hud(void) {
  if (!s_inside) return;
  hud_text(100, 60, RGBA32(255, 120, 80, 255), 1, "ARMS DEPOT");
  hud_text(100, 72, RGBA32(255, 255, 255, 255), 1, "< %s  $%d >", g_weapons[s_pick].name, g_weapons[s_pick].price);
  hud_text(100, 84, RGBA32(200, 200, 200, 255), 1, "C-UP: BUY  (YOU HAVE $%d)", g.money);
}
