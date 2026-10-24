// Gangs, crime and the police: who is hostile to whom, your crew (recruits), the blocks each gang
// holds and the wars over them, the wanted level.
#pragma once
#include "game.h"

typedef struct {
  const char *name;
  color_t color;
  int hostileTo;     // bit per gang
  int weapons[3];    // what its members carry (a random one)
} GangDef;
extern const GangDef g_gangs[GANG_COUNT];

void gang_init(void);
void gang_step(void);                         // wars, the wanted level, respect
bool gang_hostile(const Actor *a, const Actor *b);
void gang_recruit(Actor *a);
void gang_dismiss_all(void);
int gang_recruit_count(void);
int gang_max_recruits(void);
void gang_on_jacked(Actor *driver, Actor *by, Vehicle *v);
int gang_block_owner(int block);
int gang_territories(int gang);
void gang_crime(float points);                // the player did something the police care about
