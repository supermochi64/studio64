// The behavior scripts of Tokyo's yokai (the hack's data/sh_enemies_tokyo_bhv.inc.c, copied into gen/
// by tools/import_shoggoth_tokyo.mjs; their code: tokyo_enemies.c).
#if __has_include("gen/enemies_tokyo_bhv.inc.c")
#define OBJECT_FIELDS_INDEX_DIRECTLY
#include <ultra64.h>

#include "sm64.h"
#include "object_constants.h"
#include "object_fields.h"
#include "game/object_list_processor.h"
#include "make_const_nonconst.h"
#include "behavior_data.h"
#include "tokyo.h"
#include "../sms/bhv_macros.h"

void bhv_tk_chochin_init(void);
void bhv_tk_chochin_loop(void);
void bhv_tk_kappa_init(void);
void bhv_tk_kappa_loop(void);
void bhv_tk_tanuki_init(void);
void bhv_tk_tanuki_loop(void);

#include "gen/enemies_tokyo_bhv.inc.c"
#endif
