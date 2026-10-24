// The city's models, streamed in 64 m chunks round the camera: detailed ones near, simple ones far.
#pragma once
#include "common.h"

void stream_init(void);
void stream_update(V3 focus);   // loads/frees (a little per step)
void stream_draw(void);
int stream_loaded_count(void);
int stream_drawn_tris(void);
