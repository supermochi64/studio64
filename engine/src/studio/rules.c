// Studio 64 gameplay rules: Mario's physics, health and lives, coins, caps,
// which moves work, HUD and a level timer. The page sets them per level
// (project rules with the level's overrides) with studio_rules_set; the game's
// code reads gStudioRules where those things happen.

#include <ultra64.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "sm64.h"
#include "types.h"
#include "audio_defines.h"
#include "audio/external.h"
#include "game/area.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/hud.h"
#include "game/object_list_processor.h"
#include "studio.h"
#include "objects.h"

struct StudioRules gStudioRules = {
    1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
    1150.0f, 1.0f, 0, 0, 0, 1, 1800, 600, 600, 0, 0, 0, 0, 0, 1,
};

// Layout of the float array the page passes (keep in sync with web/js/game_rules.js).
enum {
    R_RUN, R_JUMP, R_DOUBLE, R_TRIPLE, R_BACKFLIP, R_SIDEFLIP, R_LONG, R_WALLKICK, R_LONG_SPEED,
    R_GRAVITY, R_AIR, R_SWIM, R_FALL, R_DAMAGE, R_ONE_HIT, R_INF_LIVES, R_COIN_LIFE, R_COIN_HEAL,
    R_WING, R_METAL, R_VANISH, R_DISABLED, R_NO_BLJ, R_HUD_HIDE, R_TIMER, R_TIME_LIMIT, R_COIN_STAR,
    R_COUNT
};

static s32 sLastCoins = -1, sLastHurt, sLevelFrames, sLastLevel = -1, sTimerShown;

EMSCRIPTEN_KEEPALIVE
void studio_rules_set(const f32 *v, s32 count) {
    struct StudioRules *r = &gStudioRules;
    f32 c[R_COUNT];
    s32 i;
    static const f32 def[R_COUNT] = { 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1150, 1, 0, 0, 0, 1, 1800, 600, 600, 0, 0, 0, 0, 0, 1 };
    for (i = 0; i < R_COUNT; i++) c[i] = (v != NULL && i < count) ? v[i] : def[i];
#define POS(x, d) ((x) > 0 ? (x) : (d))
    r->runSpeed = POS(c[R_RUN], 1);
    r->jump = POS(c[R_JUMP], 1);
    r->doubleJump = POS(c[R_DOUBLE], 1);
    r->tripleJump = POS(c[R_TRIPLE], 1);
    r->backflip = POS(c[R_BACKFLIP], 1);
    r->sideFlip = POS(c[R_SIDEFLIP], 1);
    r->longJump = POS(c[R_LONG], 1);
    r->wallKick = POS(c[R_WALLKICK], 1);
    r->longJumpSpeed = POS(c[R_LONG_SPEED], 1);
    r->gravity = POS(c[R_GRAVITY], 1);
    r->airControl = c[R_AIR] >= 0 ? c[R_AIR] : 1;
    r->swimSpeed = POS(c[R_SWIM], 1);
    r->fallDamage = c[R_FALL] >= 0 ? c[R_FALL] : 1150;
    r->damage = c[R_DAMAGE] >= 0 ? c[R_DAMAGE] : 1;
    r->oneHit = c[R_ONE_HIT] != 0;
    r->infiniteLives = c[R_INF_LIVES] != 0;
    r->coinLife = (s32) c[R_COIN_LIFE];
    r->coinHeal = c[R_COIN_HEAL] != 0;
    r->wingTime = (s32) POS(c[R_WING], 1800);
    r->metalTime = (s32) POS(c[R_METAL], 600);
    r->vanishTime = (s32) POS(c[R_VANISH], 600);
    r->disabled = (s32) c[R_DISABLED];
    r->noBlj = c[R_NO_BLJ] != 0;
    r->hudHide = (s32) c[R_HUD_HIDE];
    r->showTimer = c[R_TIMER] != 0;
    r->timeLimit = (s32) c[R_TIME_LIMIT];
    r->coinStar = c[R_COIN_STAR] != 0;
#undef POS
}

EMSCRIPTEN_KEEPALIVE
void studio_set_lives(s32 n) {
    if (gMarioState != NULL) {
        gMarioState->numLives = n;
    }
}

// For tests: the current rules and Mario's motion.
static char sRulesJson[512];
EMSCRIPTEN_KEEPALIVE
const char *studio_rules_json(void) {
    struct MarioState *m = gMarioState;
    snprintf(sRulesJson, sizeof(sRulesJson),
             "{\"run\":%.2f,\"jump\":%.2f,\"gravity\":%.2f,\"fall\":%.0f,\"disabled\":%d,\"timer\":%d,"
             "\"velY\":%.2f,\"peak\":%.1f,\"y\":%.1f,\"action\":%u,\"lives\":%d,\"health\":%d,\"frames\":%d}",
             gStudioRules.runSpeed, gStudioRules.jump, gStudioRules.gravity, gStudioRules.fallDamage,
             gStudioRules.disabled, gStudioRules.showTimer, m ? m->vel[1] : 0, m ? m->peakHeight : 0,
             m ? m->pos[1] : 0, m ? m->action : 0, m ? m->numLives : 0, m ? m->health : 0, sLevelFrames);
    return sRulesJson;
}

// ---- hooks the game calls ----------------------------------------------------------

u32 studio_rules_filter_action(struct MarioState *m, u32 action) {
    s32 d = gStudioRules.disabled;
    if (d == 0) {
        return action;
    }
    switch (action) {
        case ACT_LONG_JUMP:
            if (d & STUDIO_MOVE_LONG_JUMP) return ACT_JUMP;
            break;
        case ACT_BACKFLIP:
            if (d & STUDIO_MOVE_BACKFLIP) return ACT_JUMP;
            break;
        case ACT_SIDE_FLIP:
            if (d & STUDIO_MOVE_SIDE_FLIP) return ACT_JUMP;
            break;
        case ACT_TRIPLE_JUMP:
            if (d & STUDIO_MOVE_TRIPLE_JUMP) return (d & STUDIO_MOVE_DOUBLE_JUMP) ? ACT_JUMP : ACT_DOUBLE_JUMP;
            break;
        case ACT_DOUBLE_JUMP:
            if (d & STUDIO_MOVE_DOUBLE_JUMP) return ACT_JUMP;
            break;
        case ACT_WALL_KICK_AIR:
            if (d & STUDIO_MOVE_WALL_KICK) { m->input &= ~INPUT_A_PRESSED; m->wallKickTimer = 0; return 0; }
            break;
        case ACT_GROUND_POUND:
            if (d & STUDIO_MOVE_GROUND_POUND) { m->input &= ~INPUT_Z_PRESSED; return 0; }
            break;
        case ACT_DIVE:
            if (d & STUDIO_MOVE_DIVE) { m->input &= ~INPUT_B_PRESSED; return 0; }
            break;
        case ACT_SLIDE_KICK:
            if (d & STUDIO_MOVE_SLIDE_KICK) { m->input &= ~INPUT_B_PRESSED; return 0; }
            break;
        case ACT_PUNCHING:
        case ACT_MOVE_PUNCHING:
        case ACT_JUMP_KICK:
            if (d & STUDIO_MOVE_PUNCH) { m->input &= ~INPUT_B_PRESSED; return 0; }
            break;
        case ACT_LEDGE_GRAB:
            if (d & STUDIO_MOVE_LEDGE_GRAB) return ACT_SOFT_BONK;
            break;
        case ACT_START_CROUCHING:
        case ACT_CROUCHING:
        case ACT_CROUCH_SLIDE:
            if (d & STUDIO_MOVE_CROUCH) { m->input &= ~(INPUT_Z_DOWN | INPUT_Z_PRESSED); return 0; }
            break;
    }
    return action;
}

void studio_rules_airborne(struct MarioState *m, u32 action) {
    struct StudioRules *r = &gStudioRules;
    f32 h = 1.0f;
    switch (action) {
        case ACT_JUMP:
        case ACT_HOLD_JUMP:
        case ACT_STEEP_JUMP:
            h = r->jump;
            break;
        case ACT_DOUBLE_JUMP:
            h = r->doubleJump;
            break;
        case ACT_TRIPLE_JUMP:
        case ACT_FLYING_TRIPLE_JUMP:
            h = r->tripleJump;
            break;
        case ACT_BACKFLIP:
            h = r->backflip;
            break;
        case ACT_SIDE_FLIP:
            h = r->sideFlip;
            break;
        case ACT_WALL_KICK_AIR:
            h = r->wallKick;
            break;
        case ACT_LONG_JUMP:
            h = r->longJump;
            if (r->noBlj && m->forwardVel < -16.0f) {
                m->forwardVel = -16.0f;
            }
            m->forwardVel *= r->longJumpSpeed;
            break;
    }
    // height grows with the square of the take-off speed
    if (h != 1.0f && m->vel[1] > 0) {
        m->vel[1] *= sqrtf(h);
    }
}

void studio_rules_gravity(struct MarioState *m, f32 before) {
    f32 g = gStudioRules.gravity;
    if (g != 1.0f && m->vel[1] != before) {
        m->vel[1] = before + (m->vel[1] - before) * g;
        if (m->vel[1] < -75.0f * (g > 1 ? g : 1)) {
            m->vel[1] = -75.0f * (g > 1 ? g : 1);
        }
    }
}

u16 studio_rules_cap_time(u32 capFlag, u16 frames) {
    if (capFlag == MARIO_WING_CAP) return (u16) gStudioRules.wingTime;
    if (capFlag == MARIO_METAL_CAP) return (u16) gStudioRules.metalTime;
    if (capFlag == MARIO_VANISH_CAP) return (u16) gStudioRules.vanishTime;
    return frames;
}

// Every frame, before the game runs: lives, coins, damage, the HUD and the timer.
void studio_objects_frame(void) {
    struct MarioState *m = gMarioState;
    struct StudioRules *r = &gStudioRules;
    extern s32 gStudioPaused;

    if (m == NULL || gMarioObject == NULL || gCurrentArea == NULL || gStudioPaused) {
        return;
    }
    if (gCurrLevelNum != sLastLevel) {
        sLastLevel = gCurrLevelNum;
        sLevelFrames = 0;
        sLastCoins = m->numCoins;
        sTimerShown = FALSE;
    }
    sLevelFrames++;

    // damage: scaled, one hit kills, or none at all
    if (m->hurtCounter > sLastHurt) {
        s32 added = m->hurtCounter - sLastHurt;
        if (r->oneHit) {
            m->health = 0xFF;
            m->hurtCounter = 0;
        } else if (r->damage != 1.0f) {
            s32 scaled = (s32) (added * r->damage + 0.5f);
            s32 h = sLastHurt + scaled;
            m->hurtCounter = h > 255 ? 255 : (h < 0 ? 0 : h);
        }
    }
    sLastHurt = m->hurtCounter;

    if (r->infiniteLives && m->numLives < 4) {
        m->numLives = 4;
    }
    // a 1-up every N coins
    if (sLastCoins < 0 || m->numCoins < sLastCoins) {
        sLastCoins = m->numCoins;
    }
    if (r->coinLife > 0 && m->numCoins / r->coinLife > sLastCoins / r->coinLife) {
        m->numLives++;
        play_sound(SOUND_GENERAL_COLLECT_1UP, gDefaultSoundArgs);
    }
    sLastCoins = m->numCoins;

    // the level timer and its limit
    if (r->showTimer || r->timeLimit > 0) {
        gHudDisplay.flags |= HUD_DISPLAY_FLAG_TIMER;
        gHudDisplay.timer = r->timeLimit > 0 ? (sLevelFrames < r->timeLimit ? r->timeLimit - sLevelFrames : 0) : sLevelFrames;
        sTimerShown = TRUE;
        if (r->timeLimit > 0 && sLevelFrames == r->timeLimit && m->health > 0xFF) {
            m->health = 0xFF; // time's up
            m->hurtCounter = 0;
        }
    } else if (sTimerShown) {
        gHudDisplay.flags &= ~HUD_DISPLAY_FLAG_TIMER;
        sTimerShown = FALSE;
    }
}

// The level timer starts over (the page calls this when a level loads).
EMSCRIPTEN_KEEPALIVE
void studio_rules_level_start(void) {
    sLevelFrames = 0;
    sLastHurt = gMarioState != NULL ? gMarioState->hurtCounter : 0;
    sLastCoins = gMarioState != NULL ? gMarioState->numCoins : -1;
}
