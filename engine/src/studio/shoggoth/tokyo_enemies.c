// Tokyo's yokai from the Shoggoth World hack: the Chochin-obake (a paper lantern that
// wakes up, spits ghost fire and drifts after Mario), the Kappa (lurks in the canal, leaps onto the
// riverwalk) and the Tanuki (disguised as a cone, a post box or a statue; poofs and runs). Their code
// and behavior scripts are the hack's own (src/game/shoggoth/enemies_tokyo.c,
// data/sh_enemies_tokyo_bhv.inc.c), copied into gen/ by tools/import_shoggoth_tokyo.mjs.
// (The Oni are the game's Goomba wearing Tokyo's oni models: catalog entries tokyo:oni_*.)
#if __has_include("gen/enemies_tokyo.inc.c")
#include "sm64.h"
#include "object_fields.h"
#include "behavior_data.h"
// the decomp's newer names the hack's code uses
#define oBhvParams oBehParams
#define bhvSpawnedBlueCoin bhvMrIBlueCoin
#include "gen/enemies_tokyo.inc.c"
#endif
