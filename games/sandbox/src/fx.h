// Effects: particles (dust, sparks, blood, smoke, fire, splashes, debris), tracers, explosions.
#pragma once
#include "common.h"

enum { FX_DUST, FX_SPARK, FX_BLOOD, FX_SMOKE, FX_FIRE, FX_SPLASH, FX_DEBRIS, FX_CASH };
void fx_init(void);
void fx_burst(V3 at, int type, int count);
void fx_tracer(V3 from, V3 to, color_t c);
void fx_explosion(V3 at, float size);
void fx_step(void);
void fx_draw(void);
