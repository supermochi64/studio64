// Pickups: weapons, health, armour and cash, lying in the city (they come back after a while) or
// dropped by people; the save house's marker.
#pragma once
#include "game.h"

enum { PK_CASH, PK_HEALTH, PK_ARMOR, PK_WEAPON0 }; // PK_WEAPON0 + W_* for a weapon
void pickup_init(void);
void pickup_drop(int type, V3 at, int amount);
void pickup_step(void);
void pickup_draw(void);
