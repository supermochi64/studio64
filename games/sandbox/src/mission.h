// Missions: a story told in steps (go there, take that car, deal with them, ...). Each mission is a
// row of data in mission.c; a yellow marker starts it. The Arms Depot sells guns; big jumps pay a
// stunt bonus.
#pragma once
#include "game.h"

void mission_init(void);
void mission_step(void);
void mission_draw(void);      // markers in the world
void mission_hud(void);       // the current objective
int mission_active(void);     // -1 none
uint32_t mission_done_mask(void);
void mission_set_done_mask(uint32_t m);
bool mission_target(V3 *at); // where the radar points
