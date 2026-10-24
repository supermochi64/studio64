// The 2D screens: the HUD (money, health, armour, weapon, wanted stars, the radar, messages), the
// map and the controls on the pause screen, the title.
#pragma once
#include "game.h"

void hud_init(void);
void hud_draw(void);
void hud_draw_pause(int page);
void hud_draw_title(float t, bool hasSave, int choice);
void hud_text(int x, int y, color_t c, int scale, const char *fmt, ...);
int hud_text_width(const char *s, int scale);
