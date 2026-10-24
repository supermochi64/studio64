// The player's controls.
//
// On foot:  stick move · A jump (again on landing: double, triple) · B punch / shoot · Z crouch
//           (Z+A running: long jump, standing: backflip; Z in the air: ground pound) · R hold: aim at
//           the nearest target (the stick strafes, B fires) · C-up get in / out of a vehicle ·
//           D-left/right weapon · D-up recruit (aim at one of your crew, or stand by them) ·
//           D-down send the crew home · C-left/right/down camera · L camera behind · START map
// Driving:  A gas · B brake/reverse · Z handbrake (bikes: hop) · stick steer · R hold + B shoot out
//           of the window · L horn · C-up get out
#pragma once
#include "game.h"

void player_spawn(V3 at, float yaw);
void player_step(const Pad *p);   // before the actor's step: fills its controls, does its actions
V3 player_aim_point(void);
int player_camera_mode(void);
