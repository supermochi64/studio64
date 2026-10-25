// The camera: follows behind like a 3D platformer's (C-left/C-right turn it, C-down zooms out),
// a chase camera in vehicles, over the shoulder while aiming.
#pragma once
#include "common.h"

enum { CAM_FOOT, CAM_VEHICLE, CAM_AIM };
typedef struct {
  float yaw, pitch, dist, wantYaw;
  int zoom;              // 0 near, 1 far
  int mode;
  V3 focus, eye;
  float lookTimer;       // C-buttons used recently: no automatic turning for a moment
  float groundY;         // the height it frames: the ground under the player (not each jump)
} Camera;
// on foot: tell the camera whether the player stands (on the ground, a pole, a ledge, in water)
extern bool g_camGrounded, g_camSwimming;
extern Camera g_cam;

void camera_init(V3 at, float yaw);
// target: what to follow; heading: where it faces; speed: how fast it goes (the camera swings behind)
void camera_update(V3 target, float heading, float speed, int mode, V3 aimAt, const Pad *pad);
// the direction the stick means on the ground (relative to the camera)
V3 camera_stick_dir(float sx, float sy);
