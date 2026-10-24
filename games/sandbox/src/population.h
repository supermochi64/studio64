// Who is in the streets: people and traffic appear out of sight round the player and go when far,
// so the city feels full within the N64's budget (about 20 people and 12 vehicles at once).
#pragma once
#include "game.h"

void population_init(void);
void population_step(void);
void population_on_death(Actor *a, Actor *by);
int population_spawn_attackers(int gang, V3 near, int count);
void population_clear(void);
// a person of a kind for a place (gang members by who holds the block)
Actor *population_spawn_person(V3 at, float yaw, int kind, int gang);
