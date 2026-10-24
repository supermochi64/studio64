#include "input.h"
#include "testplay.h"

void input_init(void) { joypad_init(); }

static Pad s_prev;

void input_update(Pad *p) {
  Pad cur = {0};
#ifdef TESTPLAY
  testplay_input(&cur);
#else
  joypad_poll();
  joypad_inputs_t in = joypad_get_inputs(JOYPAD_PORT_1);
  float sx = in.stick_x / 80.0f, sy = in.stick_y / 80.0f;
  // a dead zone, and a round range
  float l = sqrtf(sx * sx + sy * sy);
  if (l < 0.12f) { sx = sy = 0; } else if (l > 1) { sx /= l; sy /= l; }
  cur.sx = sx; cur.sy = sy;
  cur.a = in.btn.a; cur.b = in.btn.b; cur.z = in.btn.z; cur.r = in.btn.r; cur.l = in.btn.l; cur.start = in.btn.start;
  cur.cu = in.btn.c_up; cur.cd = in.btn.c_down; cur.cl = in.btn.c_left; cur.cr = in.btn.c_right;
  cur.du = in.btn.d_up; cur.dd = in.btn.d_down; cur.dl = in.btn.d_left; cur.dr = in.btn.d_right;
#endif
#define PR(f) cur.p##f = cur.f && !s_prev.f
  PR(a); PR(b); PR(z); PR(r); PR(l); PR(start); PR(cu); PR(cd); PR(cl); PR(cr); PR(du); PR(dd); PR(dl); PR(dr);
#undef PR
  s_prev = cur;
  *p = cur;
}
