// The first surface along a ray (sm64ex's find_surface_on_ray, which the decomp does not have):
// cells crossed with a DDA, Möller-Trumbore against the triangles in them. Studio 64's doors and
// the camera use it.
#include <ultra64.h>
#include <math.h>

#include "sm64.h"
#include "engine/surface_collision.h"
#include "surface_terrains.h"
#include "engine/surface_load.h"

void find_surface_on_ray(Vec3f orig, Vec3f dir, struct Surface **hit, Vec3f hitPos);

extern s32 gCheckingSurfaceCollisionsForCamera;

#define DOT(a, b) ((a)[0] * (b)[0] + (a)[1] * (b)[1] + (a)[2] * (b)[2])
#define CROSS(d, a, b) { (d)[0] = (a)[1] * (b)[2] - (a)[2] * (b)[1]; (d)[1] = (a)[2] * (b)[0] - (a)[0] * (b)[2]; (d)[2] = (a)[0] * (b)[1] - (a)[1] * (b)[0]; }
#define SUB(d, a, b) { (d)[0] = (a)[0] - (b)[0]; (d)[1] = (a)[1] - (b)[1]; (d)[2] = (a)[2] - (b)[2]; }

static s32 ray_surface_intersect(Vec3f orig, Vec3f dir, f32 dirLength, struct Surface *surface, Vec3f hitPos, f32 *length) {
    Vec3f v0, v1, v2, e1, e2, h, s, q;
    f32 a, f, u, v;
    v0[0] = surface->vertex1[0]; v0[1] = surface->vertex1[1]; v0[2] = surface->vertex1[2];
    v1[0] = surface->vertex2[0]; v1[1] = surface->vertex2[1]; v1[2] = surface->vertex2[2];
    v2[0] = surface->vertex3[0]; v2[1] = surface->vertex3[1]; v2[2] = surface->vertex3[2];
    SUB(e1, v1, v0);
    SUB(e2, v2, v0);
    CROSS(h, dir, e2);
    a = DOT(e1, h);
    if (a > -0.00001f && a < 0.00001f) {
        return FALSE;
    }
    f = 1.0f / a;
    SUB(s, orig, v0);
    u = f * DOT(s, h);
    if (u < 0.0f || u > 1.0f) {
        return FALSE;
    }
    CROSS(q, s, e1);
    v = f * DOT(dir, q);
    if (v < 0.0f || u + v > 1.0f) {
        return FALSE;
    }
    *length = f * DOT(e2, q);
    if (*length <= 0.00001f || *length > dirLength) {
        return FALSE;
    }
    hitPos[0] = orig[0] + dir[0] * *length;
    hitPos[1] = orig[1] + dir[1] * *length;
    hitPos[2] = orig[2] + dir[2] * *length;
    return TRUE;
}

static void ray_list(struct SurfaceNode *list, Vec3f orig, Vec3f dir, f32 dirLength, struct Surface **hit, Vec3f hitPos, f32 *maxLength) {
    Vec3f at;
    f32 length, top, bottom;
    if (dir[1] >= 0.0f) {
        top = orig[1] + dir[1] * dirLength;
        bottom = orig[1];
    } else {
        top = orig[1];
        bottom = orig[1] + dir[1] * dirLength;
    }
    for (; list != NULL; list = list->next) {
        if (list->surface->lowerY > top || list->surface->upperY < bottom) {
            continue;
        }
        if (gCheckingSurfaceCollisionsForCamera && (list->surface->flags & SURFACE_FLAG_NO_CAM_COLLISION)) {
            continue;
        }
        if (ray_surface_intersect(orig, dir, dirLength, list->surface, at, &length) && length <= *maxLength) {
            *hit = list->surface;
            hitPos[0] = at[0]; hitPos[1] = at[1]; hitPos[2] = at[2];
            *maxLength = length;
        }
    }
}

static void ray_cell(s16 cellX, s16 cellZ, Vec3f orig, Vec3f dir, f32 dirLength, struct Surface **hit, Vec3f hitPos, f32 *maxLength) {
    s32 k;
    if (cellX < 0 || cellX > NUM_CELLS_INDEX || cellZ < 0 || cellZ > NUM_CELLS_INDEX) {
        return;
    }
    for (k = 0; k < 3; k++) {
        if (k == SPATIAL_PARTITION_CEILS && dir[1] <= -0.99f) continue;
        if (k == SPATIAL_PARTITION_FLOORS && dir[1] >= 0.99f) continue;
        ray_list(gStaticSurfacePartition[cellZ][cellX][k].next, orig, dir, dirLength, hit, hitPos, maxLength);
        ray_list(gDynamicSurfacePartition[cellZ][cellX][k].next, orig, dir, dirLength, hit, hitPos, maxLength);
    }
}

void find_surface_on_ray(Vec3f orig, Vec3f dir, struct Surface **hit, Vec3f hitPos) {
    f32 length = sqrtf(DOT(dir, dir)), maxLength = length;
    Vec3f n;
    f32 fx, fz, step, dx, dz, ax, az;
    u32 i;
    *hit = NULL;
    hitPos[0] = orig[0] + dir[0];
    hitPos[1] = orig[1] + dir[1];
    hitPos[2] = orig[2] + dir[2];
    if (length < 0.0001f) {
        return;
    }
    n[0] = dir[0] / length; n[1] = dir[1] / length; n[2] = dir[2] / length;
    fx = (orig[0] + LEVEL_BOUNDARY_MAX) / CELL_SIZE;
    fz = (orig[2] + LEVEL_BOUNDARY_MAX) / CELL_SIZE;
    if (n[1] >= 1.0f || n[1] <= -1.0f) {
        ray_cell((s16) fx, (s16) fz, orig, n, length, hit, hitPos, &maxLength);
        return;
    }
    ax = dir[0] < 0 ? -dir[0] : dir[0];
    az = dir[2] < 0 ? -dir[2] : dir[2];
    step = (gCheckingSurfaceCollisionsForCamera ? 3.0f : 1.0f) * (ax >= az ? ax : az) / CELL_SIZE;
    if (step < 1.0f) {
        step = 1.0f;
    }
    dx = dir[0] / step / CELL_SIZE;
    dz = dir[2] / step / CELL_SIZE;
    for (i = 0; i < step && *hit == NULL; i++) {
        ray_cell((s16) fx, (s16) fz, orig, n, length, hit, hitPos, &maxLength);
        fx += dx;
        fz += dz;
    }
}
