#ifndef STUDIO_KATANA_H
#define STUDIO_KATANA_H

/**
 * Katana Mario (studio/katana.c) and the katana fighters (studio/katana_fighters.c), ported from
 * Shoggoth World (its maid cafe: src/game/shoggoth/overlay/katana.c + maidcafe.c). Plain resident
 * code here: it does nothing until Mario holds the blade or a fighter is placed. docs/katana.md.
 *
 *   B              the combo: three cuts (right to left, a rising cut, an overhead cleave with a lunge)
 *   B in the air   the aerial spin slash (a whirlwind, once per jump; it hangs him in the air a moment)
 *   Z + B          the dash slash: he's through them before they see it -- the cuts land a beat later
 *   (running + B)  a lunging cut
 *
 * Every cut is an attack (struct KtAttack): the fighters test themselves against it (kt_attack_hits), and
 * every other object in its arc is hit like a shotgun blast hits it (studio_weapon_react, shotgun.c).
 */
#include <PR/ultratypes.h>

#include "types.h"

struct Camera;

// Mario's katana actions (0x178-0x17E but 0x17A, ACT_STUDIO_DRIVE: mario.c hands them to studio_katana_action)
#define ACT_KT_PULL      (0x178 | ACT_FLAG_STATIONARY | ACT_FLAG_INVULNERABLE | ACT_FLAG_INTANGIBLE)
#define ACT_KT_SLASH     (0x179 | ACT_FLAG_STATIONARY | ACT_FLAG_ATTACKING)
#define ACT_KT_AIR_SPIN  (0x17B | ACT_FLAG_AIR | ACT_FLAG_ATTACKING | ACT_FLAG_ALLOW_VERTICAL_WIND_ACTION)
#define ACT_KT_DASH      (0x17C | ACT_FLAG_MOVING | ACT_FLAG_ATTACKING | ACT_FLAG_INVULNERABLE)
#define ACT_KT_FLOURISH  (0x17D | ACT_FLAG_STATIONARY | ACT_FLAG_INVULNERABLE | ACT_FLAG_INTANGIBLE)
#define ACT_KT_PARRIED   (0x17E | ACT_FLAG_STATIONARY)
#define ACT_KT_IS(a)     ((((a) & 0x1FF) >= 0x178 && ((a) & 0x1FF) <= 0x17E) && ((a) & 0x1FF) != 0x17A)

enum KtCut { KT_CUT_NONE, KT_CUT_1, KT_CUT_2, KT_CUT_3, KT_CUT_SPIN, KT_CUT_DASH, KT_CUT_LUNGE };

struct KtAttack {
    u8 active;          // a cut is live this frame
    u8 kind;            // enum KtCut
    u16 id;             // new for every cut (a target is hit once per cut)
    f32 x, y, z;        // where the arc is centred (his chest)
    f32 reach;          // the blade's reach from there
    s16 yaw;            // the arc's middle
    s16 halfArc;        // how wide it sweeps either side (0x8000: all round)
    s16 damage;
};

extern struct KtAttack gKtAttack;
extern s16 gKtHitstop;          // frames everybody in the fight stays frozen (the cut's impact)
extern s16 gKtSlowmo;           // frames of the finale's slow motion (fighters update every other frame)
extern u8 gKtHeld;              // Mario holds the katana
extern u8 gKtSheathed;          // (after the finale's flourish: the blade put away)
extern u8 gKtDashClick;         // the dash's "click": the frame its cuts land
extern s32 gKtHits;             // cuts that landed (tests)
extern s32 gKtSwings;           // cuts made (tests)
extern s32 gStudioKatanaDraw;   // anything of the katana to draw (rendering_graph_node.c checks this first)

// hooks the game calls (mario.c, camera.c, rendering_graph_node.c)
void studio_katana_before_step(struct MarioState *m);
s32 studio_katana_action(struct MarioState *m);         // ACT_KT_*
void studio_katana_after_step(struct MarioState *m);
s32 studio_katana_camera(struct Camera *c);
void studio_katana_anim_part(s16 *rotation);
void studio_katana_part_drawn(Mat4 *mtx);

// for the fighters (katana_fighters.c)
void kt_start_pull(struct Object *blade);          // the pull out of the floor (the blade object hides when he has it)
s32 kt_pull_done(void);
void kt_start_flourish(struct Object *foe);        // the finale: the victory flourish, the blade sheathed
s32 kt_attack_hits(struct Object *obj, f32 radius, f32 height);   // the live cut reaches obj?
void kt_on_hit(struct Object *obj, s32 finisher);  // a cut landed on obj: impact effects
void kt_on_parry(struct Object *obj);              // a fighter parried: sparks, Mario staggers back
void kt_fx_sparks(f32 x, f32 y, f32 z, s32 count);
void kt_fx_confetti(f32 x, f32 y, f32 z, s32 count);
void kt_fx_hearts(f32 x, f32 y, f32 z, s32 count);
void kt_fx_word(f32 x, f32 y, f32 z, s32 word, s32 frames);   // a comic-book word over a spot (enum KtWord)
void kt_fx_glint(f32 x, f32 y, f32 z);                        // a blade's glint (the fighters' telegraph)
void kt_fx_update(void);
void kt_event(const char *kind, u32 uid, s32 value);          // to the page (Module.studioKatanaEvent)
s32 kt_fighter_is(struct Object *obj);                        // a katana fighter (they take cuts themselves)
s32 kt_duel_camera(struct Camera *c);                         // the duel's camera moments (katana_fighters.c)
void kt_duel_level_start(void);
s32 kt_duel_running(void);                                    // a duel is on (it runs the hit-stop and slow motion)

// for the page and other studio code
void studio_katana_give(s32 on);
s32 studio_katana_has(void);
void studio_katana_drop(void);                     // (the shotgun was given: the blade goes)

enum KtWord { KT_WORD_NANI, KT_WORD_ZUBA, KT_WORD_DON, KT_WORD_KIN, KT_WORD_COUNT };

// the long speeches of the duel: project dialog ids the page fills (katana.js, from data/katana.json)
#define KT_DIALOG_CHALLENGE (256 + 2040)
#define KT_DIALOG_KATANA    (256 + 2041)
#define KT_DIALOG_REMATCH   (256 + 2042)
#define KT_DIALOG_DEFEAT    (256 + 2043)

#endif
