// Sandbox: shared types and small math. Meters, seconds, radians. +x east, +z south, y up.
// A yaw of 0 faces +z; forward is (sin yaw, 0, cos yaw).
#pragma once
#include <libdragon.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include <string.h>
#include <t3d/t3d.h>
#include <t3d/t3dmath.h>
#include <t3d/t3dmodel.h>
#include <t3d/t3dskeleton.h>

#define DT (1.0f / 30.0f)       // one game step (the game runs at 30 steps a second)
#define PI 3.14159265f
#define TAU 6.28318531f
#define MODEL_SCALE (1.0f / 64.0f) // models are stored at 64 units per meter

typedef struct { float x, y, z; } V3;

static inline V3 v3(float x, float y, float z) { return (V3){x, y, z}; }
static inline V3 v3_add(V3 a, V3 b) { return (V3){a.x + b.x, a.y + b.y, a.z + b.z}; }
static inline V3 v3_sub(V3 a, V3 b) { return (V3){a.x - b.x, a.y - b.y, a.z - b.z}; }
static inline V3 v3_scale(V3 a, float s) { return (V3){a.x * s, a.y * s, a.z * s}; }
static inline V3 v3_mad(V3 a, V3 b, float s) { return (V3){a.x + b.x * s, a.y + b.y * s, a.z + b.z * s}; }
static inline float v3_dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline V3 v3_cross(V3 a, V3 b) { return (V3){a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
static inline float v3_len(V3 a) { return sqrtf(v3_dot(a, a)); }
static inline float v3_len_xz(V3 a) { return sqrtf(a.x * a.x + a.z * a.z); }
static inline float v3_dist(V3 a, V3 b) { return v3_len(v3_sub(a, b)); }
static inline float v3_dist_xz(V3 a, V3 b) { float dx = a.x - b.x, dz = a.z - b.z; return sqrtf(dx * dx + dz * dz); }
static inline float v3_dist2_xz(V3 a, V3 b) { float dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
static inline V3 v3_norm(V3 a) { float l = v3_len(a); return l > 1e-6f ? v3_scale(a, 1.0f / l) : (V3){0, 0, 0}; }
static inline V3 v3_lerp(V3 a, V3 b, float t) { return (V3){a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t}; }
static inline T3DVec3 t3v(V3 a) { return (T3DVec3){{a.x, a.y, a.z}}; }

static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
static inline float signf(float v) { return v < 0 ? -1.0f : 1.0f; }
static inline float minf(float a, float b) { return a < b ? a : b; }
static inline float maxf(float a, float b) { return a > b ? a : b; }
static inline float sqrf(float a) { return a * a; }
static inline int mini(int a, int b) { return a < b ? a : b; }
static inline int maxi(int a, int b) { return a > b ? a : b; }
// approach v to target by at most step
static inline float approach(float v, float target, float step) { return v < target ? minf(v + step, target) : maxf(v - step, target); }
static inline float wrap_angle(float a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
static inline float angle_diff(float to, float from) { return wrap_angle(to - from); }
static inline float approach_angle(float a, float target, float step) { float d = angle_diff(target, a); return wrap_angle(a + clampf(d, -step, step)); }
static inline V3 yaw_dir(float yaw) { return (V3){sinf(yaw), 0, cosf(yaw)}; }
static inline float dir_yaw(float x, float z) { return atan2f(x, z); }

// deterministic random numbers (the game's own, so test runs repeat)
extern uint32_t g_rng;
static inline uint32_t rnd_u32(void) { g_rng ^= g_rng << 13; g_rng ^= g_rng >> 17; g_rng ^= g_rng << 5; return g_rng; }
static inline float rnd(void) { return (rnd_u32() >> 8) * (1.0f / 16777216.0f); }
static inline float rnd_range(float a, float b) { return a + (b - a) * rnd(); }
static inline int rnd_int(int n) { return n > 0 ? (int)(rnd_u32() % (uint32_t)n) : 0; }

// quaternions (x, y, z, w), for the bones
typedef struct { float x, y, z, w; } Quat;
static inline Quat quat_axis(float ax, float ay, float az, float a) { float s = sinf(a * 0.5f); return (Quat){ax * s, ay * s, az * s, cosf(a * 0.5f)}; }
static inline Quat quat_mul(Quat a, Quat b) {
  return (Quat){a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
                a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z};
}
// rotation by x (pitch), then y (yaw), then z (roll), in the bone's frame
static inline Quat quat_euler(float x, float y, float z) {
  Quat q = quat_axis(1, 0, 0, x);
  if (y != 0) q = quat_mul(quat_axis(0, 1, 0, y), q);
  if (z != 0) q = quat_mul(quat_axis(0, 0, 1, z), q);
  return q;
}

// a model matrix: position, a yaw, then pitch and roll around a pivot height, a scale
void mat_place(T3DMat4 *m, V3 pos, float yaw, float pitch, float roll, float pivot, float scale);
void mat_mul(T3DMat4 *out, const T3DMat4 *a, const T3DMat4 *b);
V3 mat_apply(const T3DMat4 *m, V3 p);

// what a button press did this step
typedef struct {
  float sx, sy;          // the stick, -1..1 (sy up = forward)
  bool a, b, z, r, l, start, cu, cd, cl, cr, du, dd, dl, dr;          // held
  bool pa, pb, pz, pr, pl, pstart, pcu, pcd, pcl, pcr, pdu, pdd, pdl, pdr; // pressed this step
} Pad;
