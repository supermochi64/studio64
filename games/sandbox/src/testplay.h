// A ROM built with TEST=<name> plays itself: the script presses the buttons, checks what happened and
// prints TEST / PASS / FAIL lines (and SHOT lines, where tools/emu.mjs takes a screenshot).
#pragma once
#include "common.h"

void testplay_input(Pad *p);
void testplay_step(void);
