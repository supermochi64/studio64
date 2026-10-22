#ifndef STUDIO_SHOTGUN_BHV_H
#define STUDIO_SHOTGUN_BHV_H
// Shotgun Mario's placeable objects (studio/shotgun_objects.c, scripts in shotgun_behaviors.c)
#include "types.h"
extern const BehaviorScript bhvStudioShotgun[];
extern const BehaviorScript bhvStudioGangster[];
extern const BehaviorScript bhvStudioGangsterBullet[];
void bhv_studio_shotgun_loop(void);
void bhv_studio_gangster_init(void);
void bhv_studio_gangster_loop(void);
void bhv_studio_gangster_bullet_init(void);
void bhv_studio_gangster_bullet_loop(void);
#include "studio/shotgun_models.h" // (the generated models, or stand-ins)
#endif
