// The Arms Depot.
#pragma once
#include "game.h"

void shop_init(void);
bool shop_step(const Pad *pad);   // true: the player stands in the shop (it takes the D-pad and C-up)
void shop_draw(void);
void shop_hud(void);
