// The save (EEPROM 16 kbit): money, respect, weapons, the blocks your crew holds.
#pragma once
#include "game.h"

void save_init(void);
bool save_exists(void);
void save_write(void);
bool save_read(void);
