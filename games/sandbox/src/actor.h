// People: the player and everyone in the street share one body, one physics and one move set (a 3D
// platformer's: running, the jump chain, long jump, backflip, side flip, wall kick, ground pound,
// dive, punches). Brains (player.c, ai.c) fill Actor.ctl; actor_step does the rest.
#pragma once
#include "game.h"

Actor *actor_spawn(int kind, int gang, V3 pos, float yaw);
void actor_free(Actor *a);
void actor_step(Actor *a);
void actor_draw(Actor *a);
void actor_set_state(Actor *a, int st);
// damage from a direction; force > 0 throws the person (knocked down when big enough)
void actor_damage(Actor *a, float dmg, V3 dir, float force, Actor *by);
static inline bool actor_alive(const Actor *a) { return a && a->used && a->state != ST_DEAD; }
static inline V3 actor_chest(const Actor *a) { return v3_add(a->pos, (V3){0, 1.25f * a->look.height, 0}); }
static inline V3 actor_head(const Actor *a) { return v3_add(a->pos, (V3){0, 1.68f * a->look.height, 0}); }
bool actor_can_act(const Actor *a);  // standing or running (can shoot, enter a car, talk)
Look look_for(int kind, int gang);
void actor_dance(Actor *a);   // the victory dance (a mission passed)
int actor_index(const Actor *a);
// called when someone dies or is hit (ai.c, game logic)
extern void (*g_on_actor_damaged)(Actor *a, Actor *by, float dmg, bool died);
