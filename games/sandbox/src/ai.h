// People's brains: walking the sidewalks, hanging out, fleeing, fighting, following you (your crew),
// driving in traffic, the police.
#pragma once
#include "game.h"

enum { BR_PLAYER, BR_WALK, BR_HANG, BR_DRIVE, BR_COP, BR_WAR };
void ai_think(Actor *a);
void ai_init(void);
