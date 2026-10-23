// The cars' HUD in the ROM (the web build's page draws it: web/js/vehicles.js): the speed, the
// prompt at a car, and a race's countdown, lap, place, flashes and result, in the game's HUD font;
// the race clock is the game's own timer. From the cars' module (studio_vehicle_hud: NULL when the
// level does not have it).
#include <ultra64.h>

#include "sm64.h"
#include "game/level_update.h"
#include "game/print.h"

#define KMH 1.08f // units per frame -> km/h (as the page's dial)

f32 *studio_vehicle_hud(void);
int snprintf(char *buf, unsigned int size, const char *fmt, ...);

static s32 sTimerOurs;

void s64_vehicle_hud(void) {
    f32 *h = studio_vehicle_hud();
    char buf[32];
    s32 st;
    if (h == NULL) {
        return;
    }
    st = (s32) h[18];
    if (h[0] >= 1.0f && !(st >= 1 && st < 2)) {
        snprintf(buf, sizeof(buf), "%d KMH", (s32) ((h[1] < 0.0f ? -h[1] : h[1]) * KMH + 0.5f));
        print_text(22, 20, buf);
    }
    if (h[5] == 1.0f) {
        print_text_centered(160, 60, "B GET IN");
    } else if (h[5] == 2.0f) {
        print_text_centered(160, 60, "B RACE");
    }
    // the race clock: the game's timer
    if (st >= 3 && st <= 5) {
        gHudDisplay.timer = (u16) h[23];
        gHudDisplay.flags |= HUD_DISPLAY_FLAG_TIMER;
        sTimerOurs = TRUE;
    } else if (sTimerOurs) {
        gHudDisplay.flags &= ~HUD_DISPLAY_FLAG_TIMER;
        sTimerOurs = FALSE;
    }
    if (st == 1) {
        print_text_centered(160, 140, (s32) h[46] ? "RACE" : "SPRINT");
    }
    if (st >= 2 && st <= 5) {
        s32 pos = (s32) h[22];
        if ((s32) h[46]) {
            snprintf(buf, sizeof(buf), "LAP %d OF %d", (s32) h[20] ? (s32) h[20] : 1, (s32) h[21]);
            print_text(22, 185, buf);
        }
        if (st >= 3) {
            print_text(22, 165, pos == 1 ? "1ST" : "2ND");
        }
    }
    if (st == 2 && (s32) h[19] >= 1) {
        snprintf(buf, sizeof(buf), "%d", (s32) h[19]);
        print_text_centered(160, 120, buf);
    } else if (st == 3 && h[23] < 36.0f) {
        print_text_centered(160, 120, "GO");
    }
    if (st == 3) {
        if (h[26] > 30.0f && ((s32) h[26] & 8)) {
            print_text_centered(160, 140, "WRONG WAY");
        } else if (h[32] > 0.0f && h[20] == h[21] && h[21] > 1.0f) {
            print_text_centered(160, 140, "FINAL LAP");
        } else if (h[32] > 0.0f) {
            snprintf(buf, sizeof(buf), "LAP %d", (s32) h[20]);
            print_text_centered(160, 140, buf);
        } else if (h[28] == 1.0f && h[23] < 60.0f) {
            print_text_centered(160, 140, "ROCKET START");
        } else if (h[28] == -1.0f && h[23] < 40.0f) {
            print_text_centered(160, 140, "STALLED");
        } else if (h[27] > 0.0f) {
            print_text_centered(160, 140, "SLIPSTREAM");
        }
    }
    if (st == 4 || st == 5) {
        print_text_centered(160, 130, h[29] == 1.0f ? "YOU WIN" : "YOU LOSE");
        if (st == 5 && h[29] != 1.0f) {
            print_text_centered(160, 105, "B AGAIN");
        }
    }
}
