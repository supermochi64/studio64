#include "camera.h"
#include "world.h"
#include "render.h"

Camera g_cam;
bool g_camLock; V3 g_camEye, g_camAt; // (tests) a fixed camera
bool g_camGrounded = true, g_camSwimming;

void camera_init(V3 at, float yaw) {
  g_cam.yaw = g_cam.wantYaw = yaw;
  g_cam.pitch = 0.32f;
  g_cam.dist = 6.5f;
  g_cam.focus = at; g_cam.groundY = at.y;
  g_cam.eye = v3_sub(at, v3_scale(yaw_dir(yaw), 6.5f));
}

V3 camera_stick_dir(float sx, float sy) {
  // forward is where the camera looks (flattened), right is to its right
  V3 f = yaw_dir(g_cam.yaw);
  V3 r = {-f.z, 0, f.x}; // (facing +z, +x is to the left: this points right)
  return (V3){f.x * sy + r.x * sx, 0, f.z * sy + r.z * sx};
}

void camera_update(V3 target, float heading, float speed, int mode, V3 aimAt, const Pad *p) {
  Camera *c = &g_cam;
  c->mode = mode;
  // C-left / C-right: turn by 45 degrees; C-down: near/far
  if (p->pcl) { c->wantYaw = wrap_angle(c->wantYaw + PI / 4); c->lookTimer = 1.2f; }
  if (p->pcr) { c->wantYaw = wrap_angle(c->wantYaw - PI / 4); c->lookTimer = 1.2f; }
  if (p->pcd) c->zoom ^= 1;
  if (p->pl && mode == CAM_FOOT) { c->wantYaw = heading; c->lookTimer = 0.6f; } // L: behind the player
  if (c->lookTimer > 0) c->lookTimer -= DT;

  float wantDist, wantPitch, height;
  if (mode == CAM_VEHICLE) {
    wantDist = c->zoom ? 13.0f : 8.5f; wantPitch = 0.22f; height = 1.4f;
    // the chase camera swings behind the vehicle's heading
    if (c->lookTimer <= 0) c->wantYaw = approach_angle(c->wantYaw, heading, (0.8f + speed * 0.12f) * DT);
  } else if (mode == CAM_AIM) {
    wantDist = 3.2f; wantPitch = 0.12f; height = 1.6f;
    c->wantYaw = heading;
  } else {
    wantDist = c->zoom ? 9.5f : 6.2f; wantPitch = 0.34f; height = 1.25f;
    // like a platformer's camera: drifts behind when the player runs away from it (never round in
    // circles when the run goes across the view)
    float d = angle_diff(heading, c->yaw);
    float behind = maxf(0, cosf(d) - 0.35f) / 0.65f;
    if (c->lookTimer <= 0 && speed > 2.0f) c->wantYaw = approach_angle(c->wantYaw, heading, (0.25f + speed * 0.06f) * behind * DT);
  }
  c->yaw = approach_angle(c->yaw, c->wantYaw, (mode == CAM_AIM ? 9.0f : 4.0f) * DT * (1 + fabsf(angle_diff(c->wantYaw, c->yaw))));
  c->dist = lerpf(c->dist, wantDist, 0.12f);
  c->pitch = lerpf(c->pitch, wantPitch, 0.1f);

  // the height it frames: on foot, the ground the player stands on; a jump only moves it when it
  // goes far above, or falls below
  if (mode != CAM_FOOT || g_camGrounded) c->groundY = lerpf(c->groundY, target.y, mode == CAM_FOOT ? 0.25f : 0.5f);
  else if (target.y < c->groundY) c->groundY = lerpf(c->groundY, target.y, 0.35f);
  else if (target.y > c->groundY + 3.5f) c->groundY = lerpf(c->groundY, target.y - 3.5f, 0.3f);
  V3 focus = {target.x, c->groundY + height, target.z};
  c->focus.x = lerpf(c->focus.x, focus.x, mode == CAM_VEHICLE ? 0.5f : 0.35f);
  c->focus.z = lerpf(c->focus.z, focus.z, mode == CAM_VEHICLE ? 0.5f : 0.35f);
  c->focus.y = focus.y;
  if (v3_dist(c->focus, focus) > 12) { c->focus = focus; c->eye = focus; } // teleports, warps
  V3 back = v3_scale(yaw_dir(c->yaw), -1);
  V3 eye = {c->focus.x + back.x * cosf(c->pitch) * c->dist, c->focus.y + sinf(c->pitch) * c->dist, c->focus.z + back.z * cosf(c->pitch) * c->dist};
  V3 look = c->focus;
  if (mode == CAM_AIM) {
    // over the right shoulder, looking at what is aimed at
    V3 f = yaw_dir(c->yaw), r = {-f.z, 0, f.x};
    eye = v3_add(target, (V3){-f.x * 2.6f + r.x * 0.7f, 1.75f, -f.z * 2.6f + r.z * 0.7f});
    look = aimAt;
  }
  // smooth first, then keep the eye out of walls (pulled in front of what is between it and the focus)
  c->eye = v3_lerp(c->eye, eye, mode == CAM_AIM ? 0.5f : 0.6f);
  V3 from = mode == CAM_AIM ? v3_add(target, (V3){0, 1.6f, 0}) : c->focus;
  V3 out = c->eye;
  float t; V3 n;
  if (world_raycast_cam(from, out, &t, &n)) out = v3_lerp(from, out, maxf(0.05f, t - 0.08f));
  float floor = world_floor(out.x, out.z, out.y + 0.2f, NULL);
  if (out.y < floor + 0.4f) out.y = floor + 0.4f;
  // the sea: the camera stays above it, unless it follows a swimmer down
  if (!(mode == CAM_FOOT && g_camSwimming) && out.y < WATER_Y + 0.3f) out.y = WATER_Y + 0.3f;
  if (mode == CAM_FOOT && g_camSwimming && out.y > WATER_Y - 0.15f && out.y < WATER_Y + 0.3f) out.y = WATER_Y + 0.3f; // (never right in the surface)
  c->eye = out;
  g_view.eye = c->eye;
  g_view.target = look;
  if (g_camLock) { g_view.eye = g_camEye; g_view.target = g_camAt; }
}
