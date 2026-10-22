#ifndef STUDIO_OBJECTS_H
#define STUDIO_OBJECTS_H

// Studio 64 objects, motion and gameplay rules (motion.c, actor.c, rules.c).

#include <PR/ultratypes.h>
#include "types.h"

// ---- motion.c: paths and platform motions of blocks and objects -------------

// Blocks and movers: advance the motion; FALSE while the object is gone (no collision).
s32 studio_motion_update(struct Object *o);
// Every other object with a uid: after its behavior ran.
void studio_motion_after_behavior(struct Object *o);
// Build mode: everything back at its home pose.
void studio_motion_paused(void);
// The game's own path objects (Koopa the Quick, racing penguin, platforms on tracks).
void studio_path_override_apply(struct Object *o);
void studio_track_override_apply(struct Object *o);
void studio_path_home(struct Object *o, f32 *h); // where a path object is matched from (track platforms: their own track's start)
// A trampoline (bounce motion): landing on it never hurts, it throws Mario up instead.
s32 studio_motion_is_trampoline(struct Object *o);
// Path of an object (absolute points), for custom enemies that patrol it.
s32 studio_motion_path(struct Object *o, const f32 (**pts)[3], s32 *mode, s32 *wait);

// ---- actor.c: custom objects and enemies built in the studio ----------------

void studio_actor_reset_all(void);

// ---- rules.c: per-project gameplay rules ------------------------------------

struct StudioRules {
    f32 runSpeed;       // walking/running speed multiplier
    f32 jump, doubleJump, tripleJump, backflip, sideFlip, longJump, wallKick; // jump height multipliers
    f32 longJumpSpeed;  // long jump distance multiplier
    f32 gravity;        // gravity multiplier
    f32 airControl;     // steering in the air
    f32 swimSpeed;      // swimming speed multiplier
    f32 fallDamage;     // height of a fall that hurts (0: no fall damage)
    f32 damage;         // damage multiplier (0: invincible)
    s32 oneHit;         // any hit kills
    s32 infiniteLives;
    s32 coinLife;       // a 1-up every N coins (0: off)
    s32 coinHeal;       // coins refill health
    s32 wingTime, metalTime, vanishTime; // cap durations in frames
    s32 disabled;       // moves that are switched off (STUDIO_MOVE_*)
    s32 noBlj;          // backwards long jumps can't build up speed
    s32 hudHide;        // HUD parts to hide (HUD_DISPLAY_FLAG_*)
    s32 showTimer;      // level timer on the HUD
    s32 timeLimit;      // frames until Mario loses a life (0: none)
    s32 coinStar;       // 100 coins give a star
};
extern struct StudioRules gStudioRules;

#define STUDIO_MOVE_LONG_JUMP   (1 << 0)
#define STUDIO_MOVE_BACKFLIP    (1 << 1)
#define STUDIO_MOVE_SIDE_FLIP   (1 << 2)
#define STUDIO_MOVE_TRIPLE_JUMP (1 << 3)
#define STUDIO_MOVE_DOUBLE_JUMP (1 << 4)
#define STUDIO_MOVE_WALL_KICK   (1 << 5)
#define STUDIO_MOVE_GROUND_POUND (1 << 6)
#define STUDIO_MOVE_DIVE        (1 << 7)
#define STUDIO_MOVE_SLIDE_KICK  (1 << 8)
#define STUDIO_MOVE_PUNCH       (1 << 9)
#define STUDIO_MOVE_LEDGE_GRAB  (1 << 10)
#define STUDIO_MOVE_CROUCH      (1 << 11)

// 0: the action is refused (Mario keeps what he does), else the action to take instead.
u32 studio_rules_filter_action(struct MarioState *m, u32 action);
void studio_rules_airborne(struct MarioState *m, u32 action);
void studio_rules_gravity(struct MarioState *m, f32 before);
u16 studio_rules_cap_time(u32 capFlag, u16 frames);
void studio_objects_frame(void);

#endif
