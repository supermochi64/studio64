#ifndef STUDIO_SHOTGUN_H
#define STUDIO_SHOTGUN_H

/**
 * Shotgun Mario (studio/shotgun.c), ported from Shoggoth World (src/game/shoggoth/overlay/
 * shotgun.c + hood.c, docs/shoggoth/SHOTGUN.md), which follows the mechanics of Dorrieal's
 * "Shotgun Mario 64". Plain resident code here (no overlays): it does nothing until Mario has the gun.
 *
 *   B or L        fire (hold for automatic fire: one blast every 26 frames, the pump racks in between)
 *   B/L mid-air   blast straight down: the shotgun jump (up speed to at least 54, once per jump)
 *   R             aim mode on/off: over-the-shoulder camera, C buttons aim, shots go to the crosshair
 *
 * What a hit does: most enemies get oInteractStatus |= INT_STATUS_INTERACTED | INT_STATUS_WAS_ATTACKED
 * | ATTACK_FAST_ATTACK (they take it like a slide kick), during Mario's step so they see it in the same
 * frame; a few get their own reaction (bob-ombs explode, cork boxes break, King Bob-omb takes a hit
 * every few blasts, Chuckyas burst, Piantas get mad); armoured things only spark. See docs/shotgun.md.
 */

#include <PR/ultratypes.h>
#include "types.h"

struct Camera;

struct ShotgunHit {
    struct Object *obj;     // the object hit, or NULL
    Vec3f dir;              // unit direction the blast travelled (knock it back along this)
    s16 pellets;            // pellets of that blast that hit it (1..5; 1 = the edge of the blast)
};
#define SHOTGUN_MAX_HITS 8
extern struct ShotgunHit gShotgunHit;
extern struct ShotgunHit gShotgunHits[SHOTGUN_MAX_HITS];
extern s32 gShotgunHitCount;        // this frame's hits
extern s32 gStudioShotgunDraw;      // Mario carries it (rendering_graph_node.c checks this first)

// hooks the game calls (mario.c, camera.c, hud.c, rendering_graph_node.c)
void studio_shotgun_before_step(struct MarioState *m);
void studio_shotgun_after_step(struct MarioState *m);
s32 studio_shotgun_camera(struct Camera *c);
void studio_shotgun_hud(void);
void studio_shotgun_anim_part(s16 *rotation);
void studio_shotgun_part_drawn(Mat4 *mtx);
void studio_geo_append(void *displayList, s16 layer);   // (rendering_graph_node.c)

// for other studio code
void studio_shotgun_give(s32 on);
s32 studio_shotgun_has(void);
void studio_shotgun_suppress(s32 frames);
struct ShotgunHit *studio_shotgun_hit_for(struct Object *obj);
void studio_shotgun_fx_burst(struct Object *obj, s32 pieces);
f32 studio_shotgun_ray_clear(Vec3f from, Vec3f to);    // how far from -> to is free of walls
void studio_shotgun_picked_up(void);

// the reactions, for the katana's cuts (studio/katana.c): kinds as the shotgun's own
enum { STUDIO_WEAPON_NONE, STUDIO_WEAPON_ATTACK, STUDIO_WEAPON_ARMOUR, STUDIO_WEAPON_BOBOMB, STUDIO_WEAPON_BOX,
       STUDIO_WEAPON_CHUCKYA, STUDIO_WEAPON_KING_BOBOMB, STUDIO_WEAPON_PIANTA };
s32 studio_weapon_react_kind(struct Object *obj);
void studio_weapon_react(struct Object *obj, s32 kind, Vec3f dir);
s32 studio_katana_blade_prompt(struct MarioState *m);   // (katana.c: B pulls the Legendary Blade here)

#endif
