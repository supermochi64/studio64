// Drawing: the frame, the camera, the sky and sea, models with per-part colours.
#pragma once
#include "common.h"

#define FB_COUNT 3

typedef struct {
  V3 eye, target;
  float fov;
  T3DViewport vp;
  T3DFrustum frustum;
  float shake;           // camera shake, decays
} RenderView;
extern RenderView g_view;

// the time of day: 0..24 hours (lights, sky, fog follow it)
extern float g_hour;

void render_init(void);
void render_begin(void);                 // starts the 3D frame (sky, fog, lights for the city)
void render_end(void);                   // the 2D overlay comes between this and render_present
void render_present(void);
int render_frame_index(void);

// a matrix for this frame (the RSP reads it while the next frame is prepared, so they rotate)
T3DMat4FP *render_mat(const T3DMat4 *m);
// a model at a place, untinted (props, pickups, weapons)
void render_model(T3DModel *model, const T3DMat4 *m);
// lighting modes: the city has its light baked in; people and cars are lit by the sun
void render_light_baked(void);
void render_light_lit(void);

// per-part colours: a model's materials named like these get a prim colour from the table
enum { TINT_NONE = 0, TINT_SKIN, TINT_SHIRT, TINT_PANTS, TINT_SHOES, TINT_HAIR, TINT_HAT, TINT_PAINT, TINT_PAINT2, TINT_COUNT };
typedef struct { color_t c[TINT_COUNT]; uint16_t hide; } Tints; // hide: bit per tint slot not to draw
void render_tag_tints(T3DModel *model);  // once per loaded model
void render_skinned(T3DModel *model, T3DSkeleton *skel, const T3DMat4 *m, const Tints *t);
void render_tinted(T3DModel *model, const T3DMat4 *m, const Tints *t);

// effects drawn with a colour (fx_cube, fx_tracer, shadow...)
void render_colored(T3DModel *model, const T3DMat4 *m, color_t c);

// the world to the screen (for the HUD): false when behind the camera
bool render_project(V3 p, float *sx, float *sy);
