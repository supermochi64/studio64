// Blocks and imported models that are objects in the ROM (the still ones are part of the level):
// they follow their motion (motion.c) and keep their collision while they are there.
#include <ultra64.h>

#include "sm64.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "engine/surface_load.h"

#define o gCurrentObject

s32 studio_motion_update(struct Object *obj);

void bhv_studio_block_loop(void) {
    // moving blocks have no collision while they are gone
    if (studio_motion_update(o) && o->collisionData != NULL) {
        load_object_collision_model();
    }
}

void bhv_studio_model_loop(void) {
    bhv_studio_block_loop();
}
