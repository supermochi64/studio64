// Studio 64: Mario's look — the colours of his parts and how his model is lit (how dark the
// shadow side of each part gets, how strong the lit side is, where the light comes from).
//
// Mario's model sets a light group (Lights1: ambient + one directional light) per material. The
// groups are found through his display lists; the cap and the gloves get groups of their own (in
// the game the cap shares the shirt's red, the gloves the white of the wings and metal Mario).
//
// The same code runs in the web build and in the exported ROM (server/romexport: this file is one
// of base.js ENGINE_MODULES; s64_mario.c applies the hack's info block with it). On the N64 the
// display lists hold segmented addresses: they are read through segmented_to_virtual and what is
// written back into them stays segmented (or is a RAM address, segment 0), so the model keeps
// working wherever its segments are loaded.
#include <ultra64.h>
#include <string.h>
#include <emscripten.h>

#include "sm64.h"
#include "types.h"
#include "game/memory.h"
#include "studio_assets.h"

extern const Gfx mario_butt[], mario_left_arm[], mario_left_foot[], mario_face_cap_on_dl[],
    mario_cap_on_eyes_front[], mario_low_poly_face_cap_on_dl[], mario_cap_unused_dl[], mario_right_hand_cap[],
    mario_left_hand_closed[], mario_right_hand_closed[], mario_medium_poly_left_hand_closed[],
    mario_medium_poly_right_hand_closed[], mario_low_poly_left_hand_closed[], mario_low_poly_right_hand_closed[],
    mario_left_hand_open[], mario_right_hand_open[], mario_right_hand_cap_dl[], mario_right_hand_peace[],
    mario_cap_seg3_dl_03022F48[];
extern const Gfx mario_cap_on_eyes_half_closed[], mario_cap_on_eyes_closed[], mario_cap_on_eyes_right[],
    mario_cap_on_eyes_left[], mario_cap_on_eyes_up[], mario_cap_on_eyes_down[], mario_cap_on_eyes_dead[],
    mario_low_poly_cap_on_eyes_front[], mario_low_poly_cap_on_eyes_half_closed[], mario_low_poly_cap_on_eyes_closed[],
    mario_low_poly_cap_on_eyes_right[], mario_low_poly_cap_on_eyes_left[], mario_low_poly_cap_on_eyes_up[],
    mario_low_poly_cap_on_eyes_down[], mario_low_poly_cap_on_eyes_dead[], mario_m_logo_dl[],
    mario_low_poly_mario_m_logo_dl[], mario_right_hand_cap_m_logo_dl[], mario_cap_unused_m_logo_dl[];

// A light group as the display lists name it (raw: segmented on the N64) and where it is in RAM.
struct MarioLights {
    uintptr_t raw;
    u8 *ram;
};

static u8 sGloveLights[24] __attribute__((aligned(16)));
static struct MarioLights sMarioLights[ASSET_MARIO_PARTS];
static u8 sMarioOrig[ASSET_MARIO_PARTS][24]; // the game's own bytes of each group
static u8 sMarioColor[ASSET_MARIO_PARTS][3];
static s16 sMarioAmb[ASSET_MARIO_PARTS];      // shadow side: ambient = colour * amb / 256 (game: 128)
static s16 sMarioDif[ASSET_MARIO_PARTS];      // lit side: diffuse = colour * dif / 256 (game: 256)
static s8 sMarioDir[3] = { 0x28, 0x28, 0x28 }; // where the light comes from (the camera's view: x right, y up, z out)
static s32 sMarioReady;

#define GFX_OP(c) ((u32) ((c)->words.w0 >> 24) & 0xFF)
#define RAM(raw) ((u8 *) segmented_to_virtual((void *) (raw)))

static const Gfx *dl_ram(const Gfx *dl) {
    return (const Gfx *) segmented_to_virtual(dl);
}

// The first light group (diffuse) a display list sets; the group starts 8 bytes before.
static struct MarioLights first_light(const Gfx *dl) {
    struct MarioLights l = { 0, NULL };
    s32 n;
    dl = dl_ram(dl);
    for (n = 0; n < 400; n++, dl++) {
        u32 op = GFX_OP(dl);
        if (op == G_MOVEMEM) {
            uintptr_t a = dl->words.w1, b = dl[1].words.w1;
            l.raw = (GFX_OP(&dl[1]) == G_MOVEMEM && b < a) ? b : a - 8; // .l then .a: .a is the start of the group
            l.ram = RAM(l.raw);
            return l;
        }
        if (op == G_ENDDL) break;
    }
    return l;
}

// Point every use of the lights `from` (group start) in dl, and the lists it calls, at `to`.
static void repoint_lights(const Gfx *dl, uintptr_t from, uintptr_t to, s32 depth) {
    s32 n;
    Gfx *g;
    if (dl == NULL || from == 0 || depth > 6) return;
    g = (Gfx *) dl_ram(dl);
    for (n = 0; n < 2000; n++, g++) {
        u32 op = GFX_OP(g);
        if (op == G_MOVEMEM) {
            if (g->words.w1 == from) g->words.w1 = to;
            else if (g->words.w1 == from + 8) g->words.w1 = to + 8;
        } else if (op == G_DL) {
            repoint_lights((const Gfx *) g->words.w1, from, to, depth + 1);
            if (((g->words.w0 >> 16) & 0xFF) == G_DL_NOPUSH) break;
        } else if (op == G_ENDDL) {
            break;
        }
    }
}

// The M on the cap is drawn before the cap sets its red, so the clear part of its picture took the light of
// whatever came before it (the shirt). Each call of it in `parent` goes through a list that sets the cap's light first.
static Gfx sLogoDLs[4][4] __attribute__((aligned(16)));
static void logo_lights(const Gfx *parent, const Gfx *logo, s32 k, uintptr_t cap) {
    Gfx *g = (Gfx *) dl_ram(parent), *w = sLogoDLs[k];
    s32 n;
    if (w[0].words.w0 == 0) {
        Gfx *p = w;
        gSPLight(p++, (Light *) (cap + 8), 1);
        gSPLight(p++, (Light *) cap, 2);
        gSPDisplayList(p++, logo);
        gSPEndDisplayList(p++);
    }
    for (n = 0; n < 400 && GFX_OP(g) != G_ENDDL; n++, g++) {
        if (GFX_OP(g) == G_DL && g->words.w1 == (uintptr_t) logo) {
            g->words.w1 = (uintptr_t) w;
        }
    }
}

static void mario_lights_init(void) {
    s32 i;
    struct MarioLights red, white;
    static const Gfx *hands[] = { mario_left_hand_closed, mario_right_hand_closed, mario_medium_poly_left_hand_closed,
                                  mario_medium_poly_right_hand_closed, mario_low_poly_left_hand_closed,
                                  mario_low_poly_right_hand_closed, mario_left_hand_open, mario_right_hand_open,
                                  mario_right_hand_cap_dl, mario_right_hand_peace };
    static const Gfx *eyes[] = { mario_cap_on_eyes_front, mario_cap_on_eyes_half_closed, mario_cap_on_eyes_closed,
                                 mario_cap_on_eyes_right, mario_cap_on_eyes_left, mario_cap_on_eyes_up,
                                 mario_cap_on_eyes_down, mario_cap_on_eyes_dead };
    static const Gfx *low_eyes[] = { mario_low_poly_cap_on_eyes_front, mario_low_poly_cap_on_eyes_half_closed,
                                     mario_low_poly_cap_on_eyes_closed, mario_low_poly_cap_on_eyes_right,
                                     mario_low_poly_cap_on_eyes_left, mario_low_poly_cap_on_eyes_up,
                                     mario_low_poly_cap_on_eyes_down, mario_low_poly_cap_on_eyes_dead };
    static const Gfx *caps[] = { mario_face_cap_on_dl, mario_low_poly_face_cap_on_dl, mario_cap_unused_dl,
                                 mario_right_hand_cap };
    if (sMarioReady) return;
    // (on the N64 only once his segment is loaded: s64_mario_look waits for Mario; nothing found, try again later)
    sMarioLights[ASSET_MARIO_OVERALLS] = first_light(mario_butt);
    if (sMarioLights[ASSET_MARIO_OVERALLS].ram == NULL) return;
    sMarioReady = TRUE;
    sMarioLights[ASSET_MARIO_SHIRT] = red = first_light(mario_left_arm);
    sMarioLights[ASSET_MARIO_SHOES] = first_light(mario_left_foot);
    sMarioLights[ASSET_MARIO_SKIN] = first_light(mario_cap_on_eyes_front);
    white = first_light(mario_left_hand_closed);
    // the hair: the second group of the cap-on face (the first is the cap's red)
    {
        const Gfx *dl = dl_ram(mario_face_cap_on_dl);
        s32 n;
        for (n = 0; n < 400 && GFX_OP(dl) != G_ENDDL; n++, dl++) {
            if (GFX_OP(dl) == G_MOVEMEM) {
                uintptr_t p = dl->words.w1;
                if (p != red.raw && p != red.raw + 8 && sMarioLights[ASSET_MARIO_HAIR].ram == NULL) {
                    sMarioLights[ASSET_MARIO_HAIR].raw = p - 8; // .l comes first in these lists
                    sMarioLights[ASSET_MARIO_HAIR].ram = RAM(p - 8);
                }
            }
        }
    }
    // the cap: Mario's cap object has a red of its own; the cap on his head and in his hand use it too
    sMarioLights[ASSET_MARIO_CAP] = first_light(mario_cap_seg3_dl_03022F48);
    if (sMarioLights[ASSET_MARIO_CAP].ram != NULL && red.ram != NULL) {
        uintptr_t cap = sMarioLights[ASSET_MARIO_CAP].raw;
        for (i = 0; i < (s32) (sizeof(caps) / sizeof(caps[0])); i++) {
            repoint_lights(caps[i], red.raw, cap, 0);
        }
        for (i = 0; i < 8; i++) {                     // (not the metal caps: they have no red)
            logo_lights(eyes[i], mario_m_logo_dl, 0, cap);
            logo_lights(low_eyes[i], mario_low_poly_mario_m_logo_dl, 1, cap);
        }
        logo_lights(mario_right_hand_cap, mario_right_hand_cap_m_logo_dl, 2, cap);
        logo_lights(mario_cap_unused_dl, mario_cap_unused_m_logo_dl, 3, cap);
    }
    // the gloves: white is also the wings and metal Mario, so the hands get their own
    if (white.ram != NULL) {
        memcpy(sGloveLights, white.ram, 24);
        for (i = 0; i < (s32) (sizeof(hands) / sizeof(hands[0])); i++) {
            repoint_lights(hands[i], white.raw, (uintptr_t) sGloveLights, 0);
        }
        sMarioLights[ASSET_MARIO_GLOVES].raw = (uintptr_t) sGloveLights;
        sMarioLights[ASSET_MARIO_GLOVES].ram = sGloveLights;
    }
    for (i = 0; i < ASSET_MARIO_PARTS; i++) {
        sMarioAmb[i] = 128;
        sMarioDif[i] = 256;
        if (sMarioLights[i].ram != NULL) {
            memcpy(sMarioOrig[i], sMarioLights[i].ram, 24);
            memcpy(sMarioColor[i], sMarioLights[i].ram + 8, 3);
        }
    }
}

// Write a part's light group from its colour, lighting and the light's direction. Everything at the
// game's values writes the game's own bytes back.
static void mario_apply(s32 part) {
    u8 *l = sMarioLights[part].ram;
    s32 k;
    if (l == NULL) return;
    if (sMarioAmb[part] == 128 && sMarioDif[part] == 256 && memcmp(sMarioColor[part], sMarioOrig[part] + 8, 3) == 0
        && sMarioDir[0] == 0x28 && sMarioDir[1] == 0x28 && sMarioDir[2] == 0x28) {
        memcpy(l, sMarioOrig[part], 24);
        return;
    }
    for (k = 0; k < 3; k++) {
        s32 c = sMarioColor[part][k];
        s32 amb = (c * sMarioAmb[part]) >> 8, dif = (c * sMarioDif[part]) >> 8;
        if (amb > 255) amb = 255;
        if (dif > 255) dif = 255;
        l[k] = l[4 + k] = (u8) amb;       // ambient
        l[8 + k] = l[12 + k] = (u8) dif;  // diffuse
        l[16 + k] = (u8) sMarioDir[k];    // its direction
    }
}

// Set a part's colour (rgb 0xRRGGBB, -1: the game's); shade > 0 also sets how dark the shadow side gets
// (0..255, 128 = game default; 0 keeps the part's lighting).
EMSCRIPTEN_KEEPALIVE s32 studio_mario_color(s32 part, s32 rgb, s32 shade) {
    mario_lights_init();
    if (part < 0 || part >= ASSET_MARIO_PARTS || sMarioLights[part].ram == NULL) {
        return 0;
    }
    if (rgb < 0) {
        memcpy(sMarioColor[part], sMarioOrig[part] + 8, 3);
    } else {
        sMarioColor[part][0] = (rgb >> 16) & 0xFF;
        sMarioColor[part][1] = (rgb >> 8) & 0xFF;
        sMarioColor[part][2] = rgb & 0xFF;
    }
    if (shade > 0) sMarioAmb[part] = shade;
    mario_apply(part);
    return 1;
}

// How a part is lit: its shadow side is colour * amb / 256 (game: 128), its lit side colour * dif / 256
// more (game: 256), both clamped to the brightest colour.
EMSCRIPTEN_KEEPALIVE s32 studio_mario_light(s32 part, s32 amb, s32 dif) {
    mario_lights_init();
    if (part < 0 || part >= ASSET_MARIO_PARTS || sMarioLights[part].ram == NULL) {
        return 0;
    }
    sMarioAmb[part] = amb < 0 ? 0 : amb > 512 ? 512 : amb;
    sMarioDif[part] = dif < 0 ? 0 : dif > 512 ? 512 : dif;
    mario_apply(part);
    return 1;
}

// Where the light on Mario comes from, in the camera's view (x right, y up, z towards the camera;
// signed bytes, the game's 40, 40, 40: from above, the right and the front).
EMSCRIPTEN_KEEPALIVE void studio_mario_light_dir(s32 x, s32 y, s32 z) {
    s32 i;
    mario_lights_init();
    sMarioDir[0] = (s8) (x < -127 ? -127 : x > 127 ? 127 : x);
    sMarioDir[1] = (s8) (y < -127 ? -127 : y > 127 ? 127 : y);
    sMarioDir[2] = (s8) (z < -127 ? -127 : z > 127 ? 127 : z);
    for (i = 0; i < ASSET_MARIO_PARTS; i++) {
        mario_apply(i);
    }
}

// The game's colour of a part (0xRRGGBB), for the editor's reset button.
EMSCRIPTEN_KEEPALIVE s32 studio_mario_default_color(s32 part) {
    mario_lights_init();
    if (part < 0 || part >= ASSET_MARIO_PARTS || sMarioLights[part].ram == NULL) {
        return -1;
    }
    return (sMarioOrig[part][8] << 16) | (sMarioOrig[part][9] << 8) | sMarioOrig[part][10];
}

// For tests: byte k (0-23) of a part's light group as the model uses it now, or -1;
// k = 24 + k2: byte k2 of the game's own group.
EMSCRIPTEN_KEEPALIVE s32 studio_mario_light_byte(s32 part, s32 k) {
    mario_lights_init();
    if (part < 0 || part >= ASSET_MARIO_PARTS || sMarioLights[part].ram == NULL || k < 0 || k >= 48) {
        return -1;
    }
    return k < 24 ? sMarioLights[part].ram[k] : sMarioOrig[part][k - 24];
}
