#ifndef STUDIO_KATANA_BHV_H
#define STUDIO_KATANA_BHV_H
// Katana Mario's placeable objects (studio/katana_fighters.c, scripts in katana_behaviors.c)
#include "types.h"
extern const BehaviorScript bhvKtFighter[];
extern const BehaviorScript bhvKtDuel[];
extern const BehaviorScript bhvKtBlade[];
extern const BehaviorScript bhvKtSlashHit[];
void bhv_kt_fighter_init(void);
void bhv_kt_fighter_loop(void);
void bhv_kt_duel_init(void);
void bhv_kt_duel_loop(void);
void bhv_kt_blade_init(void);
void bhv_kt_blade_loop(void);
void bhv_kt_slash_hit_loop(void);
#include "studio/katana/models.h" // (the cosplayers, the blade: tools/katana_extract.py)
#endif
