// Studio 64 rules: new moves from later Mario games and from SM64 mods and romhacks, each one
// switched on per game or per level (gStudioRules.newMoves, STUDIO_NEW_* in objects.h; off by
// default, so the classic game stays the classic game). Written for Studio 64 from the moves'
// descriptions (docs/moveset-research.md), with the game's own animations and sounds.
//
// studio_moves_step runs in Mario's action loop (mario.c) before each action: it starts a new
// move when its buttons are pressed, runs Studio 64's own actions (ACT_SM_*) and tweaks the game's
// actions (the instant ground pound). studio_moves_filter is called from set_mario_action (via
// studio_rules_filter_action) for moves that replace one of the game's actions.

#include <ultra64.h>
#include <string.h>
#include <math.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#endif

#include "sm64.h"
#include "types.h"
#include "audio_defines.h"
#include "audio/external.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "game/camera.h"
#include "game/game_init.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/mario_step.h"
#include "mario_animation_ids.h"
#include "objects.h"

void update_lava_boost_or_twirling(struct MarioState *m); // mario_actions_airborne.c

#define ON(bit) (gStudioRules.newMoves & (bit))
#define OFF(bit) (gStudioRules.disabled & (bit))

// tuning (units per frame, 30 frames a second)
#define WALL_SLIDE_MAX     20.0f  // fastest slide down a wall
#define WALL_SLIDE_ACCEL   2.0f
#define SPIN_JUMP_VEL      64.0f  // a little higher than a side flip
#define SPIN_AIR_VEL       36.0f  // a spin started in the air lifts him a bit
#define SPIN_FALL_ACCEL    2.0f   // falling while spinning: slower than normal (4)
#define SPIN_FALL_MAX      36.0f
#define POUND_JUMP_VEL     66.0f  // between a side flip (62) and a triple jump (69)
#define POUND_DIVE_FWD     30.0f
#define POUND_DIVE_VEL     30.0f
#define WATER_POUND_VEL    42.0f
#define WATER_JUMP_VEL     44.0f
#define DIVE_HOP_VEL       21.0f
#define VAULT_MIN_SPEED    20.0f  // the ledge vault needs a run-up
#define VAULT_VEL          26.0f

// the spin input: the stick turned more than about 200 degrees within SPIN_WINDOW frames
#define SPIN_WINDOW 12
#define SPIN_NEEDED 0x9000
#define SPIN_BUFFER 5             // a spin counts for this many frames

static u32 sFrame = 0xFFFFFFFF;
static s16 sSpinDelta[SPIN_WINDOW];
static s32 sSpinIdx, sSpinHave, sSpinBuffer;
static s16 sSpinLastYaw;
static f32 sSpinVel;              // the take-off speed of the next spin jump (0: in the air)
static f32 sAirSpeed;             // forward speed while airborne (the ledge vault keeps it)
static s32 sBAge = 99;            // frames since B was pressed
static s32 sWaterSink;            // the water pound starts sinking at once (a ground pound into water)
static u32 sFrameAction;          // Mario's action when the frame began

static void spin_input_update(struct MarioState *m) {
    s32 i, sum = 0;
    if (sSpinBuffer > 0) {
        sSpinBuffer--;
    }
    if ((m->input & INPUT_NONZERO_ANALOG) && m->intendedMag > 16.0f) {
        s16 d = 0;
        if (sSpinHave) {
            d = (s16) (m->intendedYaw - sSpinLastYaw);
            if (d > 0x4000 || d < -0x4000) {
                d = 0; // a jump across the stick is no turn
            }
        }
        sSpinHave = TRUE;
        sSpinLastYaw = m->intendedYaw;
        sSpinDelta[sSpinIdx] = d;
        sSpinIdx = (sSpinIdx + 1) % SPIN_WINDOW;
        for (i = 0; i < SPIN_WINDOW; i++) {
            sum += sSpinDelta[i];
        }
        if (sum >= SPIN_NEEDED || sum <= -SPIN_NEEDED) {
            sSpinBuffer = SPIN_BUFFER;
            memset(sSpinDelta, 0, sizeof(sSpinDelta));
        }
    } else {
        sSpinHave = FALSE;
        memset(sSpinDelta, 0, sizeof(sSpinDelta));
    }
}

// Once a frame, before the first action runs.
static void moves_frame(struct MarioState *m) {
    sFrameAction = m->action;
    spin_input_update(m);
    sBAge = (m->input & INPUT_B_PRESSED) ? 0 : (sBAge < 99 ? sBAge + 1 : 99);
    if (m->action & ACT_FLAG_AIR) {
        sAirSpeed = m->forwardVel;
    } else if (m->action != ACT_LEDGE_GRAB) {
        sAirSpeed = 0.0f;
    }
    // walking switched off: a tilted stick always runs
    if (OFF(STUDIO_MOVE_WALK) && (m->input & INPUT_NONZERO_ANALOG) && m->intendedMag > 0.0f
        && !(m->action & ACT_FLAG_SWIMMING)) {
        m->intendedMag = 32.0f;
    }
}

// ---- the spin jump ------------------------------------------------------------------

static s32 spin_wanted(struct MarioState *m) {
    return sSpinBuffer > 0 || (m->controller != NULL && (m->controller->buttonDown & L_TRIG));
}

static s32 start_spin_jump(struct MarioState *m, f32 vel) {
    sSpinVel = vel;
    sSpinBuffer = 0;
    m->input &= ~INPUT_A_PRESSED;
    return set_mario_action(m, ACT_SM_SPIN_JUMP, 0);
}

static s32 act_spin_jump(struct MarioState *m) {
    s16 startYaw = m->twirlYaw;
    f32 vBefore;
    if (m->actionState == 0) {
        m->actionState = 1;
        if (sSpinVel > 0.0f) {
            m->vel[1] = sSpinVel;
            if (m->input & INPUT_NONZERO_ANALOG) {
                m->faceAngle[1] = m->intendedYaw; // he spins off the way the stick points
            }
            play_sound(SOUND_ACTION_TERRAIN_JUMP + m->terrainSoundAddend, m->marioObj->header.gfx.cameraToObject);
        } else if (m->vel[1] < SPIN_AIR_VEL) {
            m->vel[1] = SPIN_AIR_VEL;
        }
        sSpinVel = 0.0f;
        m->angleVel[1] = 0x1800;
        m->twirlYaw = 0;
        m->peakHeight = m->pos[1];
        play_sound(SOUND_MARIO_YAHOO, m->marioObj->header.gfx.cameraToObject);
    }
    if (m->input & INPUT_Z_PRESSED) { // the spin pound: straight down at once
        m->input &= ~INPUT_Z_PRESSED;
        if (set_mario_action(m, ACT_GROUND_POUND, 0) && m->action == ACT_GROUND_POUND) {
            m->actionState = 1;
            m->vel[1] = -50.0f;
            mario_set_forward_vel(m, 0.0f);
            play_sound(SOUND_MARIO_GROUND_POUND_WAH, m->marioObj->header.gfx.cameraToObject);
        }
        return TRUE;
    }
    if (m->input & INPUT_B_PRESSED) {
        m->input &= ~INPUT_B_PRESSED;
        return set_mario_action(m, ACT_DIVE, 0);
    }

    m->angleVel[1] = approach_s32(m->angleVel[1], (m->input & INPUT_A_DOWN) ? 0x2000 : 0x1800, 0x200, 0x200);
    m->twirlYaw += m->angleVel[1];
    if (startYaw > m->twirlYaw) {
        play_sound(SOUND_ACTION_TWIRL, m->marioObj->header.gfx.cameraToObject);
    }
    set_mario_animation(m, m->actionState == 1 ? MARIO_ANIM_START_TWIRL : MARIO_ANIM_TWIRL);
    if (m->actionState == 1 && is_anim_past_end(m)) {
        m->actionState = 2;
    }
    update_lava_boost_or_twirling(m);

    vBefore = m->vel[1];
    switch (perform_air_step(m, 0)) {
        case AIR_STEP_LANDED:
            set_mario_action(m, ACT_TWIRL_LAND, 0);
            break;
        case AIR_STEP_HIT_WALL:
        case AIR_STEP_HIT_LAVA_WALL:
            mario_bonk_reflection(m, FALSE);
            break;
    }
    // falling while spinning is slower
    if (m->action == ACT_SM_SPIN_JUMP && vBefore <= 0.0f) {
        f32 v = vBefore - SPIN_FALL_ACCEL * gStudioRules.gravity;
        m->vel[1] = v < -SPIN_FALL_MAX ? -SPIN_FALL_MAX : v;
    }
    m->marioObj->header.gfx.angle[1] += m->twirlYaw;
    return FALSE;
}

// ---- the wall slide -----------------------------------------------------------------

static s32 act_wall_slide(struct MarioState *m) {
    f32 v;
    if ((m->input & INPUT_A_PRESSED) && !OFF(STUDIO_MOVE_WALL_KICK)) {
        m->input &= ~INPUT_A_PRESSED;
        m->faceAngle[1] += 0x8000;
        m->vel[1] = 52.0f;
        return set_mario_action(m, ACT_WALL_KICK_AIR, 0);
    }
    if (m->input & INPUT_Z_PRESSED) { // let go
        m->input &= ~INPUT_Z_PRESSED;
        mario_set_forward_vel(m, -8.0f);
        return set_mario_action(m, ACT_FREEFALL, 0);
    }
    v = m->vel[1] > 0.0f ? 0.0f : m->vel[1];
    v -= WALL_SLIDE_ACCEL * gStudioRules.gravity;
    if (v < -WALL_SLIDE_MAX) {
        v = -WALL_SLIDE_MAX;
    }
    m->vel[1] = v;
    mario_set_forward_vel(m, 2.0f); // into the wall, so he keeps touching it
    m->peakHeight = m->pos[1];      // a slide down a wall breaks the fall

    set_mario_animation(m, MARIO_ANIM_START_WALLKICK);
    play_sound(SOUND_MOVING_TERRAIN_SLIDE + m->terrainSoundAddend, m->marioObj->header.gfx.cameraToObject);
    m->particleFlags |= PARTICLE_DUST;

    switch (perform_air_step(m, 0)) {
        case AIR_STEP_LANDED:
            mario_set_forward_vel(m, 0.0f);
            return set_mario_action(m, ACT_FREEFALL_LAND, 0);
        case AIR_STEP_HIT_WALL:
            m->actionTimer = 0;
            if (m->wall != NULL) {
                m->faceAngle[1] = atan2s(m->wall->normal.z, m->wall->normal.x) + 0x8000;
            }
            break;
        case AIR_STEP_HIT_LAVA_WALL:
            mario_set_forward_vel(m, -8.0f);
            return set_mario_action(m, ACT_FREEFALL, 0);
        default:
            if (++m->actionTimer > 2) { // the wall ended
                mario_set_forward_vel(m, 0.0f);
                return set_mario_action(m, ACT_FREEFALL, 0);
            }
            break;
    }
    m->vel[1] = v; // (the air step added the normal gravity)
    return FALSE;
}

// ---- the ground pound under water -------------------------------------------------

// moves him by his velocity through the water; TRUE when he reaches the floor
static s32 water_step(struct MarioState *m) {
    struct Surface *floor, *ceil;
    f32 floorY, ceilY;
    Vec3f next;
    next[0] = m->pos[0] + m->vel[0];
    next[1] = m->pos[1] + m->vel[1];
    next[2] = m->pos[2] + m->vel[2];
    if (next[1] > m->waterLevel - 80) {
        next[1] = m->waterLevel - 80;
    }
    f32_find_wall_collision(&next[0], &next[1], &next[2], 10.0f, 110.0f);
    floorY = find_floor(next[0], next[1], next[2], &floor);
    if (floor == NULL) {
        return FALSE; // out of bounds: he stays
    }
    ceilY = find_ceil(next[0], floorY + 80.0f, next[2], &ceil);
    if (next[1] + 160.0f > ceilY && ceilY - floorY > 160.0f) {
        next[1] = ceilY - 160.0f;
        if (m->vel[1] > 0.0f) {
            m->vel[1] = 0.0f;
        }
    }
    vec3f_copy(m->pos, next);
    m->floor = floor;
    m->floorHeight = floorY;
    if (m->pos[1] <= floorY) {
        m->pos[1] = floorY;
        return TRUE;
    }
    return FALSE;
}

static s32 act_water_pound(struct MarioState *m) {
    s32 floorHit;
    m->faceAngle[0] = 0;
    m->faceAngle[2] = 0;
    m->angleVel[0] = m->angleVel[1] = 0;
    m->actionTimer++;
    if (m->actionState == 0) { // the flip before he drops (skipped by the instant pound)
        if (m->actionTimer == 1) {
            play_sound(SOUND_ACTION_SPIN, m->marioObj->header.gfx.cameraToObject);
        }
        m->vel[1] = 0.0f;
        m->forwardVel = 0.0f;
        set_mario_animation(m, MARIO_ANIM_START_GROUND_POUND);
        if (sWaterSink || ON(STUDIO_NEW_INSTANT_POUND) || m->actionTimer >= 8) {
            sWaterSink = FALSE;
            m->actionState = 1;
            m->actionTimer = 0;
            play_sound(SOUND_ACTION_SWIM_FAST, m->marioObj->header.gfx.cameraToObject);
        }
    } else if (m->actionState == 1) { // sinking fast
        m->vel[1] = -WATER_POUND_VEL;
        m->forwardVel = approach_f32(m->forwardVel, 0.0f, 2.0f, 2.0f);
        set_mario_animation(m, MARIO_ANIM_GROUND_POUND);
        m->particleFlags |= PARTICLE_PLUNGE_BUBBLE;
    } else if (m->actionState == 2) { // landed: A jumps up
        m->vel[1] = 0.0f;
        m->forwardVel = 0.0f;
        set_mario_animation(m, MARIO_ANIM_GROUND_POUND_LANDING);
        if (m->input & INPUT_A_PRESSED) {
            m->input &= ~INPUT_A_PRESSED;
            m->actionState = 3;
            m->actionTimer = 0;
            m->vel[1] = WATER_JUMP_VEL;
            if (m->input & INPUT_NONZERO_ANALOG) {
                m->faceAngle[1] = m->intendedYaw;
            }
            play_sound(SOUND_ACTION_SWIM_FAST, m->marioObj->header.gfx.cameraToObject);
        } else if (m->actionTimer > 15) {
            return set_mario_action(m, ACT_WATER_ACTION_END, 0);
        }
    } else { // the jump up through the water
        m->vel[1] -= 1.2f;
        m->forwardVel = approach_f32(m->forwardVel, (m->input & INPUT_NONZERO_ANALOG) ? 8.0f : 0.0f, 1.0f, 1.0f);
        set_mario_animation(m, MARIO_ANIM_SINGLE_JUMP);
        m->particleFlags |= PARTICLE_BUBBLE;
        if (m->pos[1] >= m->waterLevel - 90 && m->vel[1] > 10.0f) { // out of the water
            m->vel[1] = 52.0f;
            return set_mario_action(m, ACT_WATER_JUMP, 1); // (1: keeps this speed)
        }
        if (m->vel[1] <= 4.0f || m->actionTimer > 30) {
            return set_mario_action(m, ACT_WATER_ACTION_END, 0);
        }
    }
    m->vel[0] = m->forwardVel * sins(m->faceAngle[1]);
    m->vel[2] = m->forwardVel * coss(m->faceAngle[1]);

    floorHit = water_step(m);
    if (m->actionState == 1 && floorHit) {
        m->actionState = 2;
        m->actionTimer = 0;
        play_mario_heavy_landing_sound(m, SOUND_ACTION_TERRAIN_HEAVY_LANDING);
        m->particleFlags |= PARTICLE_MIST_CIRCLE;
        set_camera_shake_from_hit(SHAKE_GROUND_POUND);
    } else if (m->actionState == 1 && m->actionTimer > 45) {
        return set_mario_action(m, ACT_WATER_ACTION_END, 0);
    }
    vec3f_copy(m->marioObj->header.gfx.pos, m->pos);
    vec3s_set(m->marioObj->header.gfx.angle, 0, m->faceAngle[1], 0);
    return FALSE;
}

// ---- the hook --------------------------------------------------------------------------

static s32 is_ground_action(u32 a) {
    u32 g = a & ACT_GROUP_MASK;
    return (g == ACT_GROUP_STATIONARY || g == ACT_GROUP_MOVING)
           && !(a & (ACT_FLAG_SWIMMING | ACT_FLAG_RIDING_SHELL | ACT_FLAG_INTANGIBLE | ACT_FLAG_HANGING
                     | ACT_FLAG_ON_POLE | ACT_FLAG_BUTT_OR_STOMACH_SLIDE | ACT_FLAG_INVULNERABLE | ACT_FLAG_AIR))
           && a != ACT_START_CROUCHING && a != ACT_CROUCHING && a != ACT_CROUCH_SLIDE && a != ACT_STOP_CROUCHING;
}

// what changes the action: return TRUE (and the loop runs again with the new action)
static s32 moves_trigger(struct MarioState *m) {
    u32 a = m->action;
    u32 in = m->input;

    // the ground pound: instant drop, dive, jump on landing
    if (a == ACT_GROUND_POUND) {
        if (ON(STUDIO_NEW_POUND_DIVE) && (in & INPUT_B_PRESSED) && !OFF(STUDIO_MOVE_DIVE)) {
            m->input &= ~INPUT_B_PRESSED;
            if (in & INPUT_NONZERO_ANALOG) {
                m->faceAngle[1] = m->intendedYaw;
            }
            set_mario_action(m, ACT_DIVE, 0);
            if (m->action == ACT_DIVE) {
                mario_set_forward_vel(m, POUND_DIVE_FWD);
                m->vel[1] = POUND_DIVE_VEL;
            }
            return TRUE;
        }
        if (ON(STUDIO_NEW_INSTANT_POUND) && m->actionState == 0) {
            m->actionState = 1;
            m->vel[1] = -50.0f;
            mario_set_forward_vel(m, 0.0f);
            play_sound(SOUND_ACTION_SPIN, m->marioObj->header.gfx.cameraToObject);
            play_sound(SOUND_MARIO_GROUND_POUND_WAH, m->marioObj->header.gfx.cameraToObject);
            return FALSE; // the game's ground pound runs on, already falling
        }
    }
    if (a == ACT_GROUND_POUND_LAND && (in & INPUT_A_PRESSED)) {
        if (ON(STUDIO_NEW_SPIN_JUMP) && spin_wanted(m)) {
            return start_spin_jump(m, SPIN_JUMP_VEL);
        }
        if (ON(STUDIO_NEW_POUND_JUMP)) {
            m->input &= ~INPUT_A_PRESSED;
            if (in & INPUT_NONZERO_ANALOG) {
                m->faceAngle[1] = m->intendedYaw;
            }
            set_mario_action(m, ACT_DOUBLE_JUMP, 1);
            if (m->action & ACT_FLAG_AIR) {
                mario_set_forward_vel(m, 0.0f); // straight up
                m->vel[1] = POUND_JUMP_VEL;
                play_sound(SOUND_ACTION_SPIN, m->marioObj->header.gfx.cameraToObject);
            }
            return TRUE;
        }
    }
    // (not with the Z that started the long jump's crouch slide this very frame)
    if (ON(STUDIO_NEW_POUND_CANCEL) && (in & INPUT_Z_PRESSED) && !OFF(STUDIO_MOVE_GROUND_POUND) && a == sFrameAction
        && (a == ACT_LONG_JUMP || a == ACT_FORWARD_ROLLOUT || a == ACT_BACKWARD_ROLLOUT || a == ACT_JUMP_KICK)) {
        m->input &= ~INPUT_Z_PRESSED;
        return set_mario_action(m, ACT_GROUND_POUND, 0);
    }

    // the spin jump: from the ground, or a jump turned into one
    if (ON(STUDIO_NEW_SPIN_JUMP) && m->heldObj == NULL) {
        if ((in & INPUT_A_PRESSED) && !(in & (INPUT_Z_DOWN | INPUT_ABOVE_SLIDE | INPUT_OFF_FLOOR))
            && is_ground_action(a) && spin_wanted(m)) {
            return start_spin_jump(m, SPIN_JUMP_VEL);
        }
        if (sSpinBuffer > 0 && m->vel[1] > -20.0f
            && (a == ACT_JUMP || a == ACT_DOUBLE_JUMP || a == ACT_SIDE_FLIP || a == ACT_BACKFLIP || a == ACT_WALL_KICK_AIR)) {
            return start_spin_jump(m, 0.0f);
        }
    }

    // under water: Z pounds down to the floor
    if (ON(STUDIO_NEW_WATER_POUND) && (in & INPUT_Z_PRESSED) && m->heldObj == NULL && !(m->flags & MARIO_METAL_CAP)
        && (a == ACT_WATER_IDLE || a == ACT_BREASTSTROKE || a == ACT_SWIMMING_END || a == ACT_FLUTTER_KICK
            || a == ACT_WATER_ACTION_END)) {
        m->input &= ~INPUT_Z_PRESSED;
        sWaterSink = FALSE;
        return set_mario_action(m, ACT_SM_WATER_POUND, 0);
    }

    // the dive hop: B while belly sliding
    if (ON(STUDIO_NEW_DIVE_HOP) && a == ACT_DIVE_SLIDE && (in & INPUT_B_PRESSED) && !(in & INPUT_ABOVE_SLIDE)
        && !OFF(STUDIO_MOVE_DIVE)) {
        f32 fwd = m->forwardVel;
        m->input &= ~INPUT_B_PRESSED;
        set_mario_action(m, ACT_DIVE, 1);
        if (m->action == ACT_DIVE) {
            mario_set_forward_vel(m, fwd); // no extra speed: the hop keeps the slide's
            m->vel[1] = DIVE_HOP_VEL;
        }
        return TRUE;
    }

    // the ledge vault: B right after grabbing a ledge with a run-up
    if (ON(STUDIO_NEW_LEDGE_VAULT) && a == ACT_LEDGE_GRAB && m->actionTimer <= 4 && sBAge <= 3
        && sAirSpeed >= VAULT_MIN_SPEED && m->ceilHeight - m->floorHeight >= 160.0f) {
        f32 fwd = sAirSpeed + 6.0f;
        m->input &= ~INPUT_B_PRESSED;
        sBAge = 99;
        m->pos[0] += 14.0f * sins(m->faceAngle[1]); // onto the ledge
        m->pos[2] += 14.0f * coss(m->faceAngle[1]);
        set_mario_action(m, ACT_FORWARD_ROLLOUT, 0);
        if (m->action == ACT_FORWARD_ROLLOUT) {
            m->actionState = 1; // (the rollout would set its own speed up)
            m->vel[1] = VAULT_VEL;
            mario_set_forward_vel(m, fwd > 48.0f ? 48.0f : fwd);
            play_sound(SOUND_MARIO_HOOHOO, m->marioObj->header.gfx.cameraToObject);
            play_sound(SOUND_ACTION_SIDE_FLIP_UNK, m->marioObj->header.gfx.cameraToObject);
        }
        return TRUE;
    }
    return FALSE;
}

s32 studio_moves_step(struct MarioState *m, s32 *inLoop) {
    if (gStudioRules.newMoves == 0 && !OFF(STUDIO_MOVE_WALK) && !(m->action == ACT_SM_SPIN_JUMP
        || m->action == ACT_SM_WALL_SLIDE || m->action == ACT_SM_WATER_POUND)) {
        return FALSE;
    }
    if (sFrame != gGlobalTimer) {
        sFrame = gGlobalTimer;
        moves_frame(m);
    }
    switch (m->action) {
        case ACT_SM_SPIN_JUMP:
            *inLoop = act_spin_jump(m);
            return TRUE;
        case ACT_SM_WALL_SLIDE:
            *inLoop = act_wall_slide(m);
            return TRUE;
        case ACT_SM_WATER_POUND:
            *inLoop = act_water_pound(m);
            return TRUE;
    }
    if (gStudioRules.newMoves != 0 && moves_trigger(m)) {
        *inLoop = TRUE;
        return TRUE;
    }
    return FALSE;
}

// set_mario_action (via studio_rules_filter_action): moves that take the place of the game's
u32 studio_moves_filter(struct MarioState *m, u32 action) {
    switch (action) {
        case ACT_SOFT_BONK: // a jump against a wall: he slides down it
            if (ON(STUDIO_NEW_WALL_SLIDE) && m->action == ACT_AIR_HIT_WALL && m->wall != NULL && m->heldObj == NULL) {
                return ACT_SM_WALL_SLIDE;
            }
            break;
        case ACT_TRIPLE_JUMP:
            if (ON(STUDIO_NEW_TRIPLE_SPIN) && !OFF(STUDIO_MOVE_TRIPLE_JUMP)) {
                sSpinVel = 69.0f * sqrtf(gStudioRules.tripleJump);
                return ACT_SM_SPIN_JUMP;
            }
            break;
        case ACT_WATER_PLUNGE: // a ground pound into water goes on under water
            if (ON(STUDIO_NEW_WATER_POUND) && m->action == ACT_GROUND_POUND && m->heldObj == NULL
                && !(m->flags & MARIO_METAL_CAP)) {
                sWaterSink = TRUE;
                return ACT_SM_WATER_POUND;
            }
            break;
    }
    return action;
}
