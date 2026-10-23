// The engine's object catalog (its generated gen/catalog.inc.c), with the same entries in the same
// order as the web build: custom objects and the story name catalog entries by index. Objects of
// modules the ROM does not have resolve to NULL (weak references) and are never spawned.
#include <ultra64.h>

#include "sm64.h"
#include "behavior_data.h"
#include "model_ids.h"
#include "geo_commands.h"
#include "studio/studio.h"

#include "s64_catalog_weak.inc"
#include "studio/gen/catalog.inc.c"
