/**
 * The katana fighters, the katana duel and the Legendary Blade, ported from Shoggoth World
 * (src/game/shoggoth/overlay/maidcafe.c: Tokyo's maid cafe and its bonus star, "Showdown at the Maid
 * Cafe"; docs/katana.md here):
 *
 *   bhvKtFighter   a cosplayer fighter (a dressed Toad: Mario, Luigi, Wario, Waluigi, Peach or Yoshi, bparams
 *                  byte 2 = the look). Placed alone, he parties until Mario comes near, then draws his replica
 *                  katana and fights: circles, telegraphs (a glint), cuts, parries, dodges, ripostes; the Mario
 *                  cosplayer also leaps in and slams, and rages at half health. A duel's fighters fight in waves.
 *   bhvKtDuel      the katana duel: the cafe's whole fight as one object -- six fighters round it, the Mario
 *                  cosplayer's challenge (his speech), the Legendary Blade in the floor (if Mario has no katana),
 *                  the battle theme, three waves (Luigi, Yoshi, Peach; Wario and Waluigi; the Mario cosplayer),
 *                  the slow-motion finale, Mario's flourish, the last words and a star (the inspector's reward).
 *                  Losing (Mario's health runs out) ends it without his death: they go back to their places and
 *                  the Mario cosplayer offers a rematch.
 *   bhvKtBlade     the Legendary Blade in the floor: B at it -- the pull (studio/katana.c), and Mario has the katana
 *   bhvKtSlashHit  a fighter's cut: an invisible damage box for the frames the blade sweeps (Mario's own
 *                  interaction code takes it from there: knockback, invincibility, health)
 *
 * Differences to the cafe: no maids, no party in a room -- a duel happens where its object stands (the
 * fighters' places are round it, the fight keeps within 1100 of it); the short lines are drawn by the page
 * (studio_katana_state_json's bubbles, js/katana.js); the speeches are project dialogs the page fills
 * (KT_DIALOG_*); the battle theme is installed by the page and started here; individually placed fighters
 * fight whenever Mario comes near, and every fighter also takes punches, kicks, stomps and shotgun blasts.
 */
#include <ultra64.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#endif

#include "sm64.h"
#include "types.h"
#include "geo_commands.h"
#include "object_constants.h"
#include "object_fields.h"
#include "audio_defines.h"
#include "seq_ids.h"
#include "audio/external.h"
#include "engine/behavior_script.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/game_init.h"
#include "game/ingame_menu.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/memory.h"
#include "game/obj_behaviors.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/rendering_graph_node.h"
#include "game/spawn_object.h"
#include "game/spawn_sound.h"
#include "behavior_data.h"
#include "model_ids.h"
#include "katana.h"
#include "katana_bhv.h"
#include "shotgun.h"

// the models (the cosplayers, the blade, the effect textures): tools/katana_extract.py from the hack, with
// the vanilla Toad's triangles and his recoloured caps made from your ROM at build time (studio/romgen/)
#include "actors/group15.h"     // (the vanilla Toad's display lists the cosplayers' heads call)
Gfx *geo_kt_katana_switch(s32 callContext, struct GraphNode *node, void *context);
Gfx *geo_kt_fade(s32 callContext, struct GraphNode *node, void *context);
#include "katana/models.inc.c"

#define o gCurrentObject
#define MARIO_DIALOG_LOOK_FRONT 1        // (the decomp's name for cur_obj_update_dialog_with_cutscene's 1)
extern s32 gStudioPaused;                // (build mode: everything holds still)
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))

struct GraphNode *studio_geo_node(const GeoLayout *geo);   // (studio.c)
void spawn_no_exit_star(f32 homeX, f32 homeY, f32 homeZ); // (behaviors/spawn_star.inc.c)

enum McLook { LOOK_MARIO, LOOK_LUIGI, LOOK_WARIO, LOOK_WALUIGI, LOOK_PEACH, LOOK_YOSHI, LOOK_COUNT };
#define MC_WHO_MAID LOOK_COUNT
// the dressed Toads' animations (mc/anims.py NAMES)
enum McAnim {
    MA_IDLE, MA_CHEER, MA_DANCE, MA_GUARD, MA_RUN, MA_WINDUP, MA_SLASH, MA_HURT, MA_DEATH, MA_TAUNT, MA_BOW,
    MA_TALK, MA_POSE, MA_COWER, MA_DRAW
};
static const GeoLayout *const sLookGeo[LOOK_COUNT] = {
    kt_cos_mario_geo, kt_cos_luigi_geo, kt_cos_wario_geo, kt_cos_waluigi_geo, kt_cos_peach_geo, kt_cos_yoshi_geo,
};

// ------------------------------------------------------------------------------------------ the duel
enum KtDuelPhase {
    KD_PARTY, KD_LANDED, KD_CHALLENGE, KD_BLADE, KD_FIGHT_START, KD_FIGHT, KD_FINALE, KD_WON, KD_LOST
};
static const char *const sPhaseNames[] = { "party", "shocked", "challenge", "blade", "fight_start", "fight", "finale", "won", "lost" };

struct KtDuel {
    struct Object *obj;          // the running duel (one at a time), or NULL
    struct Object *cos[LOOK_COUNT];
    struct Object *blade;
    s16 phase, timer, wave;
    s16 alive, down;
    s16 attackers;               // fighters winding up or cutting right now (the duel's)
    u32 lastAttack;
    u8 rage, flash, challenged, star, starDone, starGiven, music;
    f32 cx, cy, cz;              // where it stands (the fighters' places are round it)
    s16 yaw;
};
static struct KtDuel sDuel;
static s16 sSoloAttackers = 0;   // placed fighters (not in a duel) winding up or cutting
static s32 sPeaceful = FALSE;    // (tests: the fighters never attack)
static s32 sNoDefence = FALSE;   // (tests: no parries or dodges)
static u32 sSoloLastAttack = 0;
static u32 sSoloFrame = 0;
static s32 sDuelsWon = 0, sDuelsLost = 0;   // (tests)

s32 kt_duel_running(void) {
    return sDuel.obj != NULL && sDuel.obj->activeFlags != ACTIVE_FLAG_DEACTIVATED;
}

static s32 kd_fighting(void) {
    return kt_duel_running() && (sDuel.phase == KD_FIGHT_START || sDuel.phase == KD_FIGHT);
}

static void kd_set_phase(s16 phase) {
    sDuel.phase = phase;
    sDuel.timer = 0;
    kt_event("phase", sDuel.obj != NULL ? sDuel.obj->unused2 : 0, phase);
}

// ------------------------------------------------------------------------------------------ the lines
// (short lines in bubbles at the bottom of the screen: the page draws them from data/katana.json)
#define MC_BUBBLES 3
struct McBubble {
    const char *line;
    s16 who;
    s16 timer;
};
static struct McBubble sBubbles[MC_BUBBLES];
static s32 sBubbleCount = 0;     // lines said since the level started (tests)
static s16 sBubbleGap = 0;

static const char *const sTaunts[LOOK_COUNT][3] = {
    { "T_MARIO_1", "T_MARIO_2", "T_MARIO_3" }, { "T_LUIGI_1", "T_LUIGI_2", "T_LUIGI_3" },
    { "T_WARIO_1", "T_WARIO_2", "T_WARIO_3" }, { "T_WALUIGI_1", "T_WALUIGI_2", "T_WALUIGI_3" },
    { "T_PEACH_1", "T_PEACH_2", "T_PEACH_3" }, { "T_YOSHI_1", "T_YOSHI_2", "T_YOSHI_3" },
};
static const char *const sTauntsAny[4] = { "T_ANY_1", "T_ANY_2", "T_ANY_3", "T_ANY_4" };
static const char *const sHits[4] = { "HIT_1", "HIT_2", "HIT_3", "HIT_4" };
static const char *const sDowns[4] = { "DOWN_1", "DOWN_2", "DOWN_3", "DOWN_4" };

/**
 * Somebody says a line (who: enum McLook or MC_WHO_MAID). force: even over the others.
 */
static void mc_say(s32 who, const char *line, s32 force) {
    s32 i, slot = -1;

    if (!force && sBubbleGap > 0) {
        return;
    }
    for (i = 0; i < MC_BUBBLES; i++) {
        if (sBubbles[i].timer <= 0) {
            slot = i;
            break;
        }
    }
    if (slot < 0) {
        if (!force) {
            return;
        }
        slot = 0;
        for (i = 1; i < MC_BUBBLES; i++) {
            if (sBubbles[i].timer < sBubbles[slot].timer) {
                slot = i;
            }
        }
    }
    sBubbles[slot].line = line;
    sBubbles[slot].who = who;
    sBubbles[slot].timer = 75;
    sBubbleCount++;
    sBubbleGap = 28;
    play_sound(SOUND_MENU_MESSAGE_APPEAR, gDefaultSoundArgs);
}

static void mc_update_bubbles(void) {
    s32 i;

    if (sSoloFrame == gGlobalTimer) {
        return;              // (once a frame, whoever runs first)
    }
    sSoloFrame = gGlobalTimer;
    for (i = 0; i < MC_BUBBLES; i++) {
        if (sBubbles[i].timer > 0) {
            sBubbles[i].timer--;
        }
    }
    if (sBubbleGap > 0) {
        sBubbleGap--;
    }
}

// slow motion / hit-stop: fighters skip their update on these frames
static s32 mc_frozen(void) {
    return gKtHitstop > 0 || (gKtSlowmo > 0 && (gGlobalTimer & 1));
}

// ------------------------------------------------------------------------------------------ the fighters
enum McCosAction {
    CS_PARTY, CS_SHOCKED, CS_GATHER, CS_WAIT, CS_SPEECH_WALK, CS_SPEECH, CS_POINT, CS_DRAW, CS_APPROACH, CS_CIRCLE,
    CS_WINDUP, CS_SLASH, CS_RECOVER, CS_HIT, CS_PARRY, CS_DYING, CS_POOF, CS_LAST_WORDS, CS_GONE, CS_CUT_PENDING,
    CS_DODGE, CS_LEAP, CS_HOME,
};

#define oMcLook      OBJECT_FIELD_S32(0x1B)
#define oMcCooldown  OBJECT_FIELD_S32(0x1C)
#define oMcLastHit   OBJECT_FIELD_S32(0x1D)
#define oMcStrafe    OBJECT_FIELD_S32(0x1E)
#define oMcTauntT    OBJECT_FIELD_S32(0x1F)
#define oMcCombo     OBJECT_FIELD_S32(0x20)
#define oMcFlash     OBJECT_FIELD_S32(0x21)
#define oMcSpinVel   OBJECT_FIELD_S32(0x22)
#define oMcSeenSwing OBJECT_FIELD_S32(0x48)   // the last of Mario's cuts this fighter reacted to
#define oMcPending   OBJECT_FIELD_S32(0x49)
#define oMcFast      OBJECT_FIELD_S32(0x4A)   // (a riposte: the next windup is short)
#define oMcDrawn     OBJECT_FIELD_S32(0x47)   // the katana in the fist (the model's switch: geo_kt_katana_switch)
#define oMcDuel      OBJECT_FIELD_S32(0x46)   // 1: a duel's fighter (the duel object is its parent)
#define oMcRage      OBJECT_FIELD_S32(0x45)   // (a placed Mario cosplayer's rage)

// health (cuts) per cosplay, the boss first
static const s8 sCosHealth[LOOK_COUNT] = { 20, 5, 6, 5, 4, 5 };
// where they stand watching while it isn't their wave (x, z: the cafe's floor, round the duel object)
static const s16 sSideline[LOOK_COUNT][2] = {
    { 0, -560 }, { -700, -480 }, { -760, 560 }, { 760, 560 }, { 700, -480 }, { -200, -600 },
};
// where they party before Mario comes (the cafe's script)
static const s16 sPartySpot[LOOK_COUNT][3] = {
    { 0, -840, 0 }, { 760, -300, 270 }, { -760, 120, 90 }, { 420, -800, 340 }, { -420, -800, 20 }, { 760, 60, 270 },
};
// how fast they get to swing again after a cut (frames), how often they parry (of 16)
static const s16 sCosCooldown[LOOK_COUNT] = { 22, 44, 40, 38, 54, 48 };
static const s8 sCosParry[LOOK_COUNT] = { 7, 4, 3, 4, 3, 4 };
// how often they step back out of a cut they see coming (of 16)
static const s8 sCosDodge[LOOK_COUNT] = { 5, 3, 2, 4, 3, 4 };

static s32 mc_is_boss(void) {
    return o->oMcLook == LOOK_MARIO;
}

static s32 mc_in_duel(void) {
    return o->oMcDuel && kt_duel_running() && o->parentObj == sDuel.obj;
}

static s32 mc_wave_of(s32 look) {
    // mc/layout.py WAVES: (luigi, yoshi, peach), (wario, waluigi), (mario)
    switch (look) {
        case LOOK_LUIGI:
        case LOOK_YOSHI:
        case LOOK_PEACH:
            return 0;
        case LOOK_WARIO:
        case LOOK_WALUIGI:
            return 1;
    }
    return 2;
}

// in the fight now: a duel's fighter whose wave it is, or a placed one that has drawn on Mario
static s32 mc_my_wave(void) {
    if (o->oMcDuel) {
        return kd_fighting() && mc_in_duel() && mc_wave_of(o->oMcLook) == sDuel.wave;
    }
    return o->oMcDrawn && gMarioObject != NULL && o->oDistanceToMario < 2600.0f;
}

static s16 *mc_attackers(void) {
    return o->oMcDuel ? &sDuel.attackers : &sSoloAttackers;
}

static u32 *mc_last_attack(void) {
    return o->oMcDuel ? &sDuel.lastAttack : &sSoloLastAttack;
}

static s32 mc_raging(void) {
    return o->oMcDuel ? sDuel.rage : o->oMcRage;
}

static void mc_hold_anim(void) {
    struct GraphNodeObject_sub *a = &o->header.gfx.unk38;

    if (a->animAccel == 0) {
        a->animFrame--;
    } else {
        a->animFrameAccelAssist -= a->animAccel;
        a->animFrame = (s16) (a->animFrameAccelAssist >> 16);
    }
}

static void mc_anim(s32 anim, f32 accel) {
    cur_obj_init_animation_with_accel_and_sound(anim, accel);
}

static void mc_face_mario(s16 speed) {
    cur_obj_rotate_yaw_toward(o->oAngleToMario, speed);
    o->oFaceAngleYaw = o->oMoveAngleYaw;
}

static void mc_face_yaw(s16 yaw, s16 speed) {
    o->oMoveAngleYaw = approach_s16_symmetric(o->oMoveAngleYaw, yaw, speed);
    o->oFaceAngleYaw = o->oMoveAngleYaw;
}

static void mc_physics(void) {
    f32 hx, hz, dx, dz, d, r;

    cur_obj_update_floor_and_walls();
    cur_obj_move_standard(-78);
    // (keep to the arena: the duel's floor, or near home for a placed fighter)
    if (mc_in_duel()) {
        hx = sDuel.cx, hz = sDuel.cz, r = 1150.0f;
    } else {
        hx = o->oHomeX, hz = o->oHomeZ, r = 2200.0f;
    }
    dx = o->oPosX - hx, dz = o->oPosZ - hz;
    d = sqrtf(dx * dx + dz * dz);
    if (d > r) {
        o->oPosX = hx + dx * r / d;
        o->oPosZ = hz + dz * r / d;
    }
    if (o->oPosY < o->oHomeY - 2000.0f) {
        // (fell off the level: back home)
        o->oPosX = o->oHomeX, o->oPosY = o->oHomeY, o->oPosZ = o->oHomeZ;
        o->oVelY = 0.0f;
    }
}

static s32 mc_on_ground(void) {
    return (o->oMoveFlags & OBJ_MOVE_MASK_ON_GROUND) != 0;
}

/**
 * The fighters' katana: on the back (case 0) or in the fist (1) -- GEO_SWITCH_CASE in their models.
 * (oAnimState can't do it: toad_geo's transparency node overwrites it.)
 */
Gfx *geo_kt_katana_switch(s32 callContext, struct GraphNode *node, UNUSED void *context) {
    struct GraphNodeSwitchCase *sw = (struct GraphNodeSwitchCase *) node;
    struct Object *obj = (struct Object *) gCurGraphNodeObject;

    if (callContext == GEO_CONTEXT_RENDER && obj != NULL) {
        sw->selectedCase = obj->rawData.asS32[0x47] ? 1 : 0;
    }
    return NULL;
}

/**
 * Their fade (oOpacity): the whole skeleton moves to the transparent layer while it's below full (the
 * dressed Toad's parts are opaque-layer nodes; toad_geo's own transparency node only sets the alpha).
 */
static void mc_set_layers(struct GraphNode *first, s32 layer) {
    struct GraphNode *n = first;

    if (n == NULL) {
        return;
    }
    do {
        if (n->type == GRAPH_NODE_TYPE_ANIMATED_PART || n->type == GRAPH_NODE_TYPE_DISPLAY_LIST) {
            n->flags = (n->flags & 0xFF) | (layer << 8);
        }
        mc_set_layers(n->children, layer);
        n = n->next;
    } while (n != first);
}

Gfx *geo_kt_fade(s32 callContext, struct GraphNode *node, UNUSED void *context) {
    struct Object *obj = (struct Object *) gCurGraphNodeObject;

    if (callContext == GEO_CONTEXT_RENDER && obj != NULL && node->next != node) {
        mc_set_layers(node->next, obj->oOpacity < 250 ? LAYER_TRANSPARENT : LAYER_OPAQUE);
    }
    return NULL;
}

/**
 * People between the camera and Mario fade to see-through (their caps are big).
 */
static void mc_fade_near_camera(void) {
    struct MarioState *m = gMarioState;
    f32 cx = gLakituState.pos[0], cz = gLakituState.pos[2];
    f32 ax = m->pos[0] - cx, az = m->pos[2] - cz;
    f32 bx = o->oPosX - cx, bz = o->oPosZ - cz;
    f32 len2 = ax * ax + az * az;
    f32 t = len2 > 1.0f ? (bx * ax + bz * az) / len2 : 0.0f;
    f32 side, d;
    s32 want = 255;

    if (gStudioPaused || gMarioObject == NULL) {
        o->oOpacity = 255;
        return;
    }
    d = sqrtf(bx * bx + bz * bz);
    side = sqrtf(MAX(0.0f, bx * bx + bz * bz - t * t * len2));
    // in the way (between the camera and Mario, near the line) or just very close to the lens
    if ((t > -0.1f && t < 0.9f && side < 170.0f) || d < 300.0f) {
        want = 80;
    }
    o->oOpacity = approach_s16_symmetric(o->oOpacity, want, 30);
}

static void mc_set_look(s32 look) {
    o->header.gfx.scale[0] = kt_looks[look][0];
    o->header.gfx.scale[1] = kt_looks[look][1];
    o->header.gfx.scale[2] = kt_looks[look][2];
}

static void mc_solid(f32 radius, f32 height) {
    o->oInteractType = INTERACT_TEXT;       // (no subtype: just solid, like an NPC Mario can't talk to)
    o->oDamageOrCoinValue = 0;
    o->hitboxRadius = radius;
    o->hitboxHeight = height;
    o->hurtboxRadius = radius;
    o->hurtboxHeight = height;
    o->hitboxDownOffset = 0.0f;
    o->oFlags |= OBJ_FLAG_30;
}

static void mc_taunt_maybe(s32 chance) {
    if (o->oMcTauntT > 0) {
        o->oMcTauntT--;
        return;
    }
    if ((random_u16() & 0xFF) < chance) {
        if (random_u16() & 3) {
            mc_say(o->oMcLook, sTaunts[o->oMcLook][random_u16() % 3], FALSE);
        } else {
            mc_say(o->oMcLook, sTauntsAny[random_u16() % 4], FALSE);
        }
        o->oMcTauntT = 150 + (random_u16() % 120);
    }
}

s32 kt_fighter_is(struct Object *obj) {
    return obj->behavior == segmented_to_virtual(bhvKtFighter);
}

void bhv_kt_fighter_init(void) {
    s32 look = (o->oBehParams >> 16) & 0xFF;

    if (look >= LOOK_COUNT) {
        look = 0;
    }
    o->oMcLook = look;
    o->header.gfx.sharedChild = studio_geo_node(sLookGeo[look]);
    o->oAnimations = (struct Animation **) kt_toad_anims;
    mc_set_look(look);
    mc_solid(60.0f, 150.0f);
    o->oHealth = sCosHealth[look];
    o->oMcLastHit = -1;
    o->oMcSeenSwing = -1;
    o->oMcStrafe = (look & 1) ? 1 : -1;
    o->oMcTauntT = 60 + look * 40;
    o->oMcDrawn = 0;
    o->oMcRage = FALSE;
    o->oOpacity = 255;
    o->oMcDuel = (o->oBehParams & 0xFF) == 1 && o->parentObj != NULL && o->parentObj != o;
    if (o->oMcDuel) {
        sDuel.cos[look] = o;
    }
    o->oAction = CS_PARTY;
    mc_anim(MA_IDLE, 1.0f);
}

static void cs_party(void) {
    static const u8 sPartyAnim[LOOK_COUNT] = { MA_POSE, MA_TALK, MA_IDLE, MA_DANCE, MA_POSE, MA_TALK };
    s32 look = o->oMcLook;

    mc_anim(sPartyAnim[look], 1.0f);
    o->oForwardVel = 0.0f;
    mc_physics();
    if (o->oMcDuel) {
        if (mc_in_duel() && sDuel.phase != KD_PARTY) {
            o->oAction = CS_SHOCKED;
        }
        return;
    }
    // a placed fighter: Mario comes near -- the jump, the shout, then the katana
    if (gMarioObject != NULL && o->oDistanceToMario < 1100.0f && !gStudioPaused) {
        o->oAction = CS_SHOCKED;
    }
}

static void cs_shocked(void) {
    if (o->oTimer == 0) {
        o->oVelY = 22.0f;
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
        kt_fx_word(o->oPosX, o->oPosY + 230.0f, o->oPosZ, KT_WORD_DON, 30);
        if (!o->oMcDuel) {
            kt_event("spotted", o->unused2, o->oMcLook);
        }
    }
    mc_anim(MA_IDLE, 1.0f);
    mc_face_mario(0x900);
    mc_physics();
    if (o->oTimer > 30 && mc_on_ground()) {
        if (!o->oMcDuel) {
            o->oAction = CS_DRAW;
        } else {
            o->oAction = mc_is_boss() ? CS_SPEECH_WALK : CS_GATHER;
        }
    }
}

// (obj_behaviors_2.c has this one as a static: the footsteps at two frames of the walk)
static void kt_walk_sound(s8 a, s8 b, u32 sound) {
    s32 n = o->header.gfx.unk38.animAccel / 0x10000;

    if (n <= 0) {
        n = 1;
    }
    if (cur_obj_check_anim_frame_in_range(a, n) || cur_obj_check_anim_frame_in_range(b, n)) {
        cur_obj_play_sound_2(sound);
    }
}

static void cs_walk_to(f32 x, f32 z, f32 speed) {
    s16 yaw = atan2s(z - o->oPosZ, x - o->oPosX);

    mc_face_yaw(yaw, 0x800);
    o->oForwardVel = speed;
    mc_anim(MA_RUN, speed / 14.0f);
    kt_walk_sound(2, 12, SOUND_OBJ_GOOMBA_WALK);
    mc_physics();
    if ((o->oMoveFlags & OBJ_MOVE_HIT_WALL) && mc_on_ground()) {
        o->oVelY = 40.0f;        // (a table in the way: over it)
    }
}

static s32 cs_dist_to(f32 x, f32 z) {
    return (s32) sqrtf((x - o->oPosX) * (x - o->oPosX) + (z - o->oPosZ) * (z - o->oPosZ));
}

// a spot on the duel's floor (the cafe's coordinates turned with the duel object)
static void kd_spot(f32 lx, f32 lz, f32 *x, f32 *z) {
    f32 s = sins(sDuel.yaw), c = coss(sDuel.yaw);

    *x = sDuel.cx + lx * c + lz * s;
    *z = sDuel.cz - lx * s + lz * c;
}

static void cs_gather(void) {
    // off to the side of the floor, where they can watch
    f32 x, z;

    kd_spot(sSideline[o->oMcLook][0], sSideline[o->oMcLook][1], &x, &z);
    if (cs_dist_to(x, z) > 60) {
        cs_walk_to(x, z, 16.0f);
    } else {
        o->oForwardVel = 0.0f;
        o->oAction = CS_WAIT;
    }
    if (mc_my_wave()) {
        o->oAction = o->oMcDrawn ? CS_APPROACH : CS_DRAW;
    }
}

static void cs_wait(void) {
    o->oForwardVel = 0.0f;
    mc_face_mario(0x400);
    mc_physics();
    if (o->oMcDrawn) {
        mc_anim(MA_TAUNT, 1.0f);
        mc_taunt_maybe(3);
    } else {
        mc_anim(sDuel.phase == KD_BLADE ? MA_POSE : MA_IDLE, 1.0f);
    }
    if (!mc_in_duel()) {
        return;
    }
    if (sDuel.phase == KD_FIGHT_START && !o->oMcDrawn && o->oTimer > 8 + o->oMcLook * 6) {
        o->oAction = CS_DRAW;
    }
    if (mc_my_wave() && sDuel.phase == KD_FIGHT) {
        o->oAction = o->oMcDrawn ? CS_APPROACH : CS_DRAW;
    }
}

static void cs_draw(void) {
    mc_anim(MA_DRAW, 1.0f);
    mc_face_mario(0x600);
    o->oForwardVel = 0.0f;
    mc_physics();
    if (o->oTimer == 7) {
        o->oMcDrawn = 1;              // the katana: from the back to the fist
        cur_obj_play_sound_2(SOUND_ACTION_SPIN);
        kt_fx_glint(o->oPosX, o->oPosY + 150.0f, o->oPosZ);
    }
    if (o->oTimer > 16) {
        if (o->oMcDuel) {
            o->oAction = mc_my_wave() && sDuel.phase == KD_FIGHT ? CS_APPROACH : CS_WAIT;
        } else {
            o->oAction = CS_APPROACH;
        }
    }
}

// ---- the Mario cosplayer's speech (a duel's)

static void cs_speech_walk(void) {
    struct MarioState *m = gMarioState;
    f32 d = o->oDistanceToMario;

    // up to Mario, stopping a little way off him on his own side (8 s at most)
    if (d > 300.0f && sDuel.timer < 240) {
        s16 back = atan2s(o->oPosZ - m->pos[2], o->oPosX - m->pos[0]);
        cs_walk_to(m->pos[0] + sins(back) * 220.0f, m->pos[2] + coss(back) * 220.0f, 14.0f);
        return;
    }
    o->oForwardVel = 0.0f;
    mc_physics();
    mc_face_mario(0x800);
    mc_anim(MA_TALK, 1.0f);
    if (sDuel.phase == KD_CHALLENGE && mc_on_ground()) {
        o->oAction = CS_SPEECH;
    }
}

static void cs_speech(void) {
    s32 again = sDuel.challenged;

    mc_anim(MA_TALK, 1.0f);
    o->oForwardVel = 0.0f;
    mc_physics();
    if (cur_obj_update_dialog_with_cutscene(MARIO_DIALOG_LOOK_FRONT, DIALOG_UNK2_FLAG_0, CUTSCENE_DIALOG,
                                            again ? KT_DIALOG_REMATCH : KT_DIALOG_CHALLENGE)) {
        // (the first time, the blade's speech follows -- unless Mario has a katana already)
        o->oMcCombo = (again || gKtHeld) ? 2 : 1;
        sDuel.challenged = TRUE;
        o->oAction = CS_POINT;
    }
}

static void cs_point(void) {
    f32 kx, kz;

    mc_anim(MA_TAUNT, 1.0f);
    kd_spot(0.0f, 40.0f, &kx, &kz);
    if (!gKtHeld) {
        mc_face_yaw(atan2s(kz - o->oPosZ, kx - o->oPosX), 0x800);
    }
    mc_physics();
    if (o->oMcCombo == 1) {
        if (cur_obj_update_dialog_with_cutscene(MARIO_DIALOG_LOOK_FRONT, 0, CUTSCENE_DIALOG, KT_DIALOG_KATANA)) {
            o->oMcCombo = 2;
        }
        return;
    }
    if (gKtHeld) {
        // (he has a blade already: straight to the fight)
        kd_set_phase(KD_FIGHT_START);
    } else {
        kt_fx_glint(kx, sDuel.cy + 150.0f, kz);
        kd_set_phase(KD_BLADE);
    }
    o->oAction = CS_GATHER;
}

// ---- the fight

static void cs_approach(void) {
    struct MarioState *m = gMarioState;

    if (!mc_my_wave()) {
        o->oAction = o->oMcDuel ? CS_WAIT : CS_HOME;
        return;
    }
    if (o->oDistanceToMario < 360.0f) {
        o->oAction = CS_CIRCLE;
        o->oMcCooldown = 20 + (random_u16() % 30);
        return;
    }
    cs_walk_to(m->pos[0], m->pos[2], mc_is_boss() ? 22.0f : 18.0f);
    mc_taunt_maybe(2);
}

static s32 cs_try_attack(void) {
    s16 *attackers = mc_attackers();
    u32 *last = mc_last_attack();
    s32 maxAttackers = o->oMcDuel ? (sDuel.wave == 1 ? 2 : 1) : 2;   // (the warm-up wave one at a time; the duo together)

    if (sPeaceful || o->oMcCooldown > 0 || *attackers >= maxAttackers) {
        return FALSE;
    }
    // (two at once, but never both on the same beat: the second one follows the first)
    if (*attackers > 0 && gGlobalTimer - *last < 16 && !o->oMcFast) {
        return FALSE;
    }
    *last = gGlobalTimer;
    if (gMarioState->action & (ACT_FLAG_INTANGIBLE)) {
        return FALSE;
    }
    (*attackers)++;
    o->oAction = CS_WINDUP;
    return TRUE;
}

static void cs_circle(void) {
    f32 want = mc_is_boss() ? 260.0f : 300.0f;
    f32 d = o->oDistanceToMario;
    s16 side;

    if (!mc_my_wave()) {
        o->oAction = o->oMcDuel ? CS_WAIT : CS_HOME;
        return;
    }
    mc_anim(MA_GUARD, 1.0f);
    mc_face_mario(0x700);
    // keep the distance, strafe round him
    side = o->oAngleToMario + 0x4000 * o->oMcStrafe;
    o->oVelX = sins(side) * 6.0f;
    o->oVelZ = coss(side) * 6.0f;
    if (d > want + 60.0f) {
        o->oVelX += sins(o->oAngleToMario) * 12.0f;
        o->oVelZ += coss(o->oAngleToMario) * 12.0f;
    } else if (d < want - 80.0f) {
        o->oVelX -= sins(o->oAngleToMario) * 10.0f;
        o->oVelZ -= coss(o->oAngleToMario) * 10.0f;
    }
    o->oForwardVel = sqrtf(o->oVelX * o->oVelX + o->oVelZ * o->oVelZ);
    o->oMoveAngleYaw = atan2s(o->oVelZ, o->oVelX);
    mc_physics();
    o->oFaceAngleYaw = o->oAngleToMario;
    o->oMoveAngleYaw = o->oAngleToMario;
    if (o->oMoveFlags & OBJ_MOVE_HIT_WALL || (o->oTimer % 70) == 69) {
        o->oMcStrafe = -o->oMcStrafe;
    }
    if (o->oMcCooldown > 0) {
        o->oMcCooldown--;
    }
    mc_taunt_maybe(2);
    // a cut coming: sometimes they step back out of it
    if (gKtAttack.id != (u16) o->oMcSeenSwing && gMarioState->action == ACT_KT_SLASH && d < 340.0f) {
        o->oMcSeenSwing = gKtAttack.id;
        if (!sNoDefence && (random_u16() & 15) < sCosDodge[o->oMcLook]) {
            o->oAction = CS_DODGE;
            return;
        }
    }
    // the Mario cosplayer's jumping cleave from a distance
    if (mc_is_boss() && o->oMcCooldown == 0 && d > 330.0f && d < 900.0f && (random_u16() % 3) == 0
        && *mc_attackers() == 0 && !sPeaceful) {
        (*mc_attackers())++;
        o->oAction = CS_LEAP;
        return;
    }
    if (d < want + 120.0f) {
        cs_try_attack();
    }
    if (d > 700.0f) {
        o->oAction = CS_APPROACH;
    }
}

static void cs_dodge(void) {
    if (o->oTimer == 0) {
        mc_anim(MA_GUARD, 1.0f);
        o->oMoveAngleYaw = o->oAngleToMario + 0x8000 + (s16) ((random_u16() & 0x1FFF) - 0x1000);
        o->oForwardVel = 30.0f;
        o->oVelY = 24.0f;
        cur_obj_play_sound_2(SOUND_ACTION_SIDE_FLIP_UNK);
    }
    o->oForwardVel = approach_f32_symmetric(o->oForwardVel, 0.0f, 2.0f);
    mc_physics();
    o->oFaceAngleYaw = o->oAngleToMario;
    if (o->oTimer > 10 && mc_on_ground()) {
        o->oMoveAngleYaw = o->oAngleToMario;
        o->oAction = CS_CIRCLE;
        // (and straight back in with a quick cut, now and then)
        if (random_u16() & 1) {
            o->oMcCooldown = 0;
            o->oMcFast = TRUE;
            if (!cs_try_attack()) {
                o->oMcFast = FALSE;
            }
        }
    }
}

extern const BehaviorScript bhvKtSlashHit[];

static void cs_leap(void) {
    struct Object *hit;
    s32 i;

    if (o->oTimer == 0) {
        mc_anim(MA_WINDUP, 1.0f);
        o->oMoveAngleYaw = o->oFaceAngleYaw = o->oAngleToMario;
        o->oVelY = 56.0f;
        o->oForwardVel = MIN(o->oDistanceToMario, 800.0f) / 26.0f;
        cur_obj_play_sound_2(SOUND_OBJ_KING_BOBOMB_JUMP);
        mc_say(LOOK_MARIO, "T_MARIO_1", FALSE);
    }
    if (o->oTimer == 12) {
        mc_anim(MA_SLASH, 1.0f);
        kt_fx_glint(o->oPosX, o->oPosY + 200.0f, o->oPosZ);
    }
    mc_physics();
    if (o->oTimer > 4 && mc_on_ground()) {
        // the slam: a shockwave round him
        hit = spawn_object(o, MODEL_NONE, bhvKtSlashHit);
        if (hit != NULL) {
            hit->hitboxRadius = 230.0f;
            hit->hurtboxRadius = 230.0f;
            hit->oDamageOrCoinValue = 3;
        }
        cur_obj_play_sound_2(SOUND_OBJ_POUNDING1_HIGHPRIO);
        cur_obj_shake_screen(SHAKE_POS_MEDIUM);
        for (i = 0; i < 8; i++) {
            kt_fx_sparks(o->oPosX + sins(i * 0x2000) * 160.0f, o->oPosY + 10.0f, o->oPosZ + coss(i * 0x2000) * 160.0f, 2);
        }
        kt_fx_word(o->oPosX, o->oPosY + 150.0f, o->oPosZ, KT_WORD_DON, 20);
        o->oForwardVel = 0.0f;
        *mc_attackers() = MAX(0, *mc_attackers() - 1);
        o->oMcCooldown = 70;
        o->oAction = CS_RECOVER;
        o->oMcCombo = 20;       // (a long recovery after the slam: the moment to punish him)
    }
}

static void cs_windup(void) {
    s32 len = o->oMcFast ? 7 : mc_is_boss() ? (mc_raging() ? 7 : 9) : 11;

    mc_anim(MA_WINDUP, 1.0f);
    o->oForwardVel = 0.0f;
    mc_face_mario(0x900);
    mc_physics();
    if (o->oTimer == 0) {
        cur_obj_play_sound_2(SOUND_OBJ_GOOMBA_ALERT);
    }
    if (o->oTimer == len - 6) {
        // the telegraph: a glint on the raised blade
        kt_fx_glint(o->oPosX + sins(o->oFaceAngleYaw - 0x3000) * 60.0f, o->oPosY + 220.0f,
                    o->oPosZ + coss(o->oFaceAngleYaw - 0x3000) * 60.0f);
        cur_obj_play_sound_2(SOUND_GENERAL_SWISH_WATER);
    }
    if (o->oTimer >= len) {
        o->oAction = CS_SLASH;
        o->oMcFast = FALSE;
        o->oMcCombo = mc_is_boss() ? (mc_raging() ? 2 : 1) : 0;
    }
}

static void cs_slash(void) {
    struct Object *hit;

    if (o->oTimer == 0) {
        mc_anim(MA_SLASH, 1.0f);
        cur_obj_play_sound_2(SOUND_ACTION_SIDE_FLIP_UNK);
        o->oForwardVel = mc_is_boss() ? 40.0f : (o->oMcDuel && sDuel.wave == 0) ? 28.0f : 34.0f;
    }
    o->oForwardVel = approach_f32_symmetric(o->oForwardVel, 0.0f, 4.0f);
    mc_physics();
    // the blade's sweep: a damage hitbox in front of him for three frames
    if (o->oTimer >= 2 && o->oTimer <= 4) {
        hit = spawn_object(o, MODEL_NONE, bhvKtSlashHit);
        if (hit != NULL) {
            hit->oPosX = o->oPosX + sins(o->oFaceAngleYaw) * 120.0f;
            hit->oPosZ = o->oPosZ + coss(o->oFaceAngleYaw) * 120.0f;
            hit->oPosY = o->oPosY;
            hit->oDamageOrCoinValue = mc_is_boss() ? 3 : 2;
        }
    }
    if (o->oTimer >= 18) {
        if (o->oMcCombo > 0) {
            o->oMcCombo--;
            o->oTimer = -1;
            mc_face_mario(0x2000);
            return;
        }
        *mc_attackers() = MAX(0, *mc_attackers() - 1);
        o->oMcCooldown = sCosCooldown[o->oMcLook] + (random_u16() % 30);
        o->oAction = CS_RECOVER;
    }
}

static void cs_recover(void) {
    mc_anim(MA_GUARD, 0.6f);
    o->oForwardVel = 0.0f;
    mc_face_mario(0x200);
    mc_physics();
    if (o->oTimer > (mc_is_boss() ? 14 : 22) + (o->oMcCombo > 1 ? o->oMcCombo : 0)) {
        o->oMcCombo = 0;
        o->oAction = CS_CIRCLE;
    }
}

static void cs_release_token(void) {
    if (o->oAction == CS_WINDUP || o->oAction == CS_SLASH || o->oAction == CS_LEAP) {
        *mc_attackers() = MAX(0, *mc_attackers() - 1);
    }
}

static void cs_parry(void) {
    if (o->oTimer == 0) {
        mc_anim(MA_GUARD, 1.0f);
        kt_on_parry(o);
        kt_fx_word(o->oPosX, o->oPosY + 200.0f, o->oPosZ, KT_WORD_KIN, 24);
    }
    mc_face_mario(0x800);
    o->oForwardVel = approach_f32_symmetric(o->oForwardVel, 0.0f, 2.0f);
    mc_physics();
    if (o->oTimer > 6) {
        // a riposte, quick
        o->oMcCooldown = 0;
        o->oMcFast = TRUE;
        if (!cs_try_attack()) {
            o->oMcFast = FALSE;
            o->oAction = CS_CIRCLE;
        }
    }
}

static void cs_hit(void) {
    if (o->oTimer == 0) {
        mc_anim(MA_HURT, 1.0f);
    }
    o->oForwardVel = approach_f32_symmetric(o->oForwardVel, 0.0f, 2.5f);
    mc_physics();
    if (o->oTimer > 16 && mc_on_ground()) {
        o->oAction = o->oMcDrawn ? CS_CIRCLE : CS_DRAW;
        o->oMcCooldown = MAX(o->oMcCooldown, 10);
    }
}

// a placed fighter that lost sight of Mario: back to his spot, the katana away
static void cs_home(void) {
    if (cs_dist_to(o->oHomeX, o->oHomeZ) > 80) {
        cs_walk_to(o->oHomeX, o->oHomeZ, 14.0f);
    } else {
        o->oForwardVel = 0.0f;
        mc_physics();
        o->oMcDrawn = 0;
        o->oAction = CS_PARTY;
    }
    if (gMarioObject != NULL && o->oDistanceToMario < 1100.0f) {
        o->oAction = o->oMcDrawn ? CS_APPROACH : CS_DRAW;
    }
}

static void mc_take_damage(s32 damage, s16 awayYaw, s32 dashed) {
    s32 finisher;

    o->oHealth -= damage;
    finisher = o->oHealth <= 0;
    kt_on_hit(o, finisher);
    o->oMcFlash = 8;
    o->oMoveAngleYaw = awayYaw;
    o->oForwardVel = finisher ? (dashed ? 26.0f : 30.0f) : (dashed ? 14.0f : 18.0f);
    o->oVelY = finisher ? 34.0f : (dashed ? 16.0f : 14.0f);
    kt_event("fighter_hit", o->unused2, o->oHealth);
    if (finisher) {
        o->oAction = CS_DYING;
        if (mc_is_boss() && mc_in_duel()) {
            gKtSlowmo = 90;
            sDuel.flash = 12;
        }
    } else {
        o->oAction = CS_HIT;
        if (mc_is_boss() && !mc_raging() && o->oHealth <= sCosHealth[LOOK_MARIO] / 2) {
            if (o->oMcDuel) {
                sDuel.rage = TRUE;
            } else {
                o->oMcRage = TRUE;
            }
            mc_say(LOOK_MARIO, "BOSS_RAGE", TRUE);
            kt_fx_word(o->oPosX, o->oPosY + 190.0f, o->oPosZ, KT_WORD_DON, 30);
            cur_obj_play_sound_2(SOUND_OBJ2_BOSS_DIALOG_GRUNT);
        } else if ((random_u16() & 3) == 0) {
            mc_say(o->oMcLook, sHits[random_u16() % 4], FALSE);
        }
    }
}

// Mario's punches, kicks, dives and stomps (without the katana) count as one cut each; so does a shotgun blast
static s32 mc_hand_attack(void) {
    struct MarioState *m = gMarioState;
    u32 a = m->action;
    f32 dy = m->pos[1] - o->oPosY;

    if (gMarioObject == NULL || o->oDistanceToMario > 170.0f) {
        return FALSE;
    }
    if ((a == ACT_PUNCHING || a == ACT_MOVE_PUNCHING || a == ACT_JUMP_KICK || a == ACT_DIVE || a == ACT_SLIDE_KICK
         || a == ACT_SLIDE_KICK_SLIDE) && dy > -60.0f && dy < 200.0f
        && abs_angle_diff(m->faceAngle[1], (s16) (o->oAngleToMario + 0x8000)) < 0x3000) {
        return TRUE;
    }
    // from above: a stomp or a ground pound
    if ((m->action & ACT_FLAG_AIR) && m->vel[1] < 0.0f && dy > 110.0f && dy < 230.0f && o->oDistanceToMario < 110.0f) {
        m->vel[1] = 30.0f;               // (he bounces off the cap)
        return TRUE;
    }
    return FALSE;
}

static void cs_take_cut(void) {
    s32 engaged = o->oMcDuel ? kd_fighting() : o->oMcDrawn || o->oAction == CS_DRAW;

    if (!engaged || o->oHealth <= 0) {
        return;
    }
    // shotgun blasts, punches, stomps: one each
    if ((o->oInteractStatus & INT_STATUS_WAS_ATTACKED) || (o->oMcLastHit != -2 - (s32) (gGlobalTimer / 12) && mc_hand_attack())) {
        if (o->oMcDuel && !mc_my_wave()) {
            o->oVelY = 30.0f;
            return;
        }
        cs_release_token();
        o->oMcLastHit = -2 - (s32) (gGlobalTimer / 12);       // (a punch hits once)
        mc_take_damage(1, o->oAngleToMario + 0x8000, FALSE);
        return;
    }
    if (!kt_attack_hits(o, 70.0f, 170.0f) || o->oMcLastHit == gKtAttack.id) {
        return;
    }
    o->oMcLastHit = gKtAttack.id;
    // not their wave yet: they hop out of the way
    if (!mc_my_wave()) {
        o->oVelY = 30.0f;
        return;
    }
    // a parry (only facing him, from the guard, never the dash's)
    if (o->oAction == CS_CIRCLE && gKtAttack.kind != KT_CUT_DASH && gKtAttack.kind != KT_CUT_SPIN
        && gKtAttack.kind != KT_CUT_3 && abs_angle_diff(o->oFaceAngleYaw, o->oAngleToMario) < 0x2000
        && !sNoDefence && (random_u16() & 15) < sCosParry[o->oMcLook]) {
        cs_release_token();
        o->oAction = CS_PARRY;
        return;
    }
    cs_release_token();
    if (gKtAttack.kind == KT_CUT_DASH) {
        // ... he's through them before they see it: the cut lands at the dash's click
        o->oMcPending = gKtAttack.damage;
        o->oAction = CS_CUT_PENDING;
        o->oForwardVel = 0.0f;
        return;
    }
    mc_take_damage(gKtAttack.damage, o->oAngleToMario + 0x8000, FALSE);
}

static void cs_land_pending_cut(void) {
    s32 dmg = o->oMcPending;

    o->oMcPending = 0;
    mc_take_damage(dmg, o->oAngleToMario, TRUE);
}

static void cs_dying(void) {
    if (o->oTimer == 0) {
        mc_anim(MA_DEATH, 1.0f);
        cur_obj_become_intangible();
        cur_obj_play_sound_2(SOUND_OBJ_DEFAULT_DEATH);
        kt_fx_word(o->oPosX, o->oPosY + 190.0f, o->oPosZ, KT_WORD_NANI, 50);
        mc_say(o->oMcLook, sDowns[random_u16() % 4], TRUE);
        o->oMcSpinVel = 0x1800;
    }
    // flung back, spinning, in the "NANI?!" pose -- then down
    if (!mc_on_ground() || o->oTimer < 3) {
        o->oFaceAngleYaw += o->oMcSpinVel;
        o->oMcSpinVel = (s32) (o->oMcSpinVel * 0.94f);
    } else {
        o->oForwardVel = approach_f32_symmetric(o->oForwardVel, 0.0f, 3.0f);
        o->oFaceAnglePitch = approach_s16_symmetric(o->oFaceAnglePitch, -0x3800, 0x600);
    }
    mc_physics();
    if (o->oTimer > 34 && mc_on_ground()) {
        if (mc_is_boss() && mc_in_duel()) {
            o->oAction = CS_LAST_WORDS;
            kt_event("music", sDuel.obj->unused2, 0);
            sDuel.music = FALSE;
            kt_start_flourish(o);
        } else {
            o->oAction = CS_POOF;
        }
    }
}

static void cs_poof(void) {
    if (o->oTimer == 0) {
        kt_fx_confetti(o->oPosX, o->oPosY + 80.0f, o->oPosZ, 24);
        spawn_mist_particles_variable(0, 0, 46.0f);
        obj_spawn_loot_yellow_coins(o, 3, 20.0f);
        cur_obj_play_sound_2(SOUND_GENERAL_BREAK_BOX);
        cur_obj_hide();
        if (o->oMcDuel) {
            sDuel.down++;
        } else {
            kt_event("fighter_down", o->unused2, o->oMcLook);
        }
    }
    if (o->oTimer > 10) {
        o->oAction = CS_GONE;
    }
}

static void kd_give_star(void);

static void cs_last_words(void) {
    mc_anim(MA_DEATH, 1.0f);
    o->oForwardVel = 0.0f;
    mc_physics();
    if (o->oTimer < 45) {
        return;
    }
    if (cur_obj_update_dialog_with_cutscene(MARIO_DIALOG_LOOK_FRONT, 0, CUTSCENE_DIALOG, KT_DIALOG_DEFEAT)) {
        // the star (the duel's reward) comes out of him
        kt_fx_confetti(o->oPosX, o->oPosY + 100.0f, o->oPosZ, 40);
        kt_fx_hearts(o->oPosX, o->oPosY + 100.0f, o->oPosZ, 12);
        spawn_mist_particles_variable(0, 0, 60.0f);
        obj_spawn_loot_yellow_coins(o, 5, 20.0f);
        cur_obj_hide();
        sDuel.down++;
        kd_give_star();
        kd_set_phase(KD_WON);
        sDuelsWon++;
        kt_event("won", sDuel.obj->unused2, 0);
        o->oAction = CS_GONE;
    }
}

void bhv_kt_fighter_loop(void) {
    s32 frozen = (o->oMcDuel ? kd_fighting() || (mc_in_duel() && sDuel.phase == KD_FINALE) : o->oMcDrawn) && mc_frozen();

    mc_update_bubbles();
    if (o->oMcDuel && !mc_in_duel()) {
        // (its duel is gone: so is he)
        obj_mark_for_deletion(o);
        return;
    }
    if (o->oAction == CS_GONE) {
        cur_obj_become_intangible();
        o->oHealth = 0;
        if (!o->oMcDuel && o->oTimer > 30) {
            obj_mark_for_deletion(o);
        }
        o->oInteractStatus = 0;
        return;
    }
    if (gStudioPaused) {
        o->oInteractStatus = 0;
        return;
    }
    if (frozen || o->oAction == CS_CUT_PENDING) {
        // (hit-stop, or cut by the dash and not knowing it yet: hold the pose, the animation too)
        mc_hold_anim();
        o->oTimer--;
        if (o->oAction == CS_CUT_PENDING && gKtDashClick) {
            cs_land_pending_cut();
        }
        o->oInteractStatus = 0;
        return;
    }
    if (o->oMcFlash > 0) {
        o->oMcFlash--;
        mc_set_look(o->oMcLook);
        o->header.gfx.scale[1] *= (o->oMcFlash & 2) ? 1.06f : 1.0f;
    } else {
        mc_set_look(o->oMcLook);
    }
    switch (o->oAction) {
        case CS_PARTY:       cs_party();       break;
        case CS_SHOCKED:     cs_shocked();     break;
        case CS_GATHER:      cs_gather();      break;
        case CS_WAIT:        cs_wait();        break;
        case CS_SPEECH_WALK: cs_speech_walk(); break;
        case CS_SPEECH:      cs_speech();      break;
        case CS_POINT:       cs_point();       break;
        case CS_DRAW:        cs_draw();        break;
        case CS_APPROACH:    cs_approach();    break;
        case CS_CIRCLE:      cs_circle();      break;
        case CS_WINDUP:      cs_windup();      break;
        case CS_SLASH:       cs_slash();       break;
        case CS_RECOVER:     cs_recover();     break;
        case CS_HIT:         cs_hit();         break;
        case CS_PARRY:       cs_parry();       break;
        case CS_DYING:       cs_dying();       break;
        case CS_POOF:        cs_poof();        break;
        case CS_LAST_WORDS:  cs_last_words();  break;
        case CS_DODGE:       cs_dodge();       break;
        case CS_LEAP:        cs_leap();        break;
        case CS_HOME:        cs_home();        break;
    }
    // a placed fighter: Mario far away -- back home
    if (!o->oMcDuel && o->oMcDrawn && gMarioObject != NULL && o->oDistanceToMario > 2600.0f
        && o->oAction != CS_DYING && o->oAction != CS_POOF && o->oAction != CS_HOME) {
        cs_release_token();
        o->oAction = CS_HOME;
    }
    if (o->oAction != CS_DYING && o->oAction != CS_POOF && o->oAction != CS_LAST_WORDS) {
        cs_take_cut();
    }
    mc_fade_near_camera();
    o->oInteractStatus = 0;
}

// ------------------------------------------------------------------------------------------ the Legendary Blade

void bhv_kt_blade_init(void) {
    o->oAction = 0;
}

void bhv_kt_blade_loop(void) {
    if (o->oAction == 0) {
        cur_obj_unhide();
        // a glint now and then while it waits in the floor
        if ((o->oTimer % 50) == 0 && !gStudioPaused) {
            kt_fx_glint(o->oPosX, o->oPosY + 150.0f + (random_u16() % 40), o->oPosZ);
        }
    } else {
        cur_obj_hide();
        // (Mario lost it -- the story took it, the level started over: it's back in the floor)
        if (!studio_katana_has() && gMarioObject != NULL && gMarioState->action != ACT_KT_PULL) {
            o->oAction = 0;
        }
    }
}

// ------------------------------------------------------------------------------------------ a fighter's cut

void bhv_kt_slash_hit_loop(void) {
    if (o->oTimer > 1 || (o->oInteractStatus & INT_STATUS_INTERACTED)) {
        obj_mark_for_deletion(o);
    }
    o->oInteractStatus = 0;
}

// ------------------------------------------------------------------------------------------ the duel object

#define oKdStar     OBJECT_FIELD_S32(0x1B)   // 1: a star for winning (the page sets it: studio_katana_duel_config)
#define oKdStarDone OBJECT_FIELD_S32(0x1C)   //   (already collected)

static void kd_spawn_cast(void) {
    s32 look;
    f32 x, z;

    for (look = 0; look < LOOK_COUNT; look++) {
        struct Object *c;

        kd_spot(sPartySpot[look][0], sPartySpot[look][1], &x, &z);
        c = spawn_object_abs_with_rot(o, 0, MODEL_NONE, bhvKtFighter, x, o->oPosY, z, 0,
                                      (s16) (sDuel.yaw + DEGREES(sPartySpot[look][2])), 0);
        if (c == NULL) {
            continue;
        }
        c->oBehParams = (look << 16) | 1;
        c->oHomeX = x, c->oHomeY = o->oPosY, c->oHomeZ = z;
        c->parentObj = o;
        sDuel.cos[look] = c;
    }
    if (!gKtHeld) {
        kd_spot(0.0f, 40.0f, &x, &z);
        sDuel.blade = spawn_object_abs_with_rot(o, 0, MODEL_NONE, bhvKtBlade, x, o->oPosY, z, 0, (s16) (sDuel.yaw + 0xE38), 0);
        if (sDuel.blade != NULL) {
            sDuel.blade->header.gfx.sharedChild = studio_geo_node(kt_katana_geo);
            sDuel.blade->parentObj = o;
        }
    }
}

void bhv_kt_duel_init(void) {
    s32 i;

    // (one duel runs at a time: a second one waits until the first is over)
    if (kt_duel_running() && sDuel.obj != o) {
        o->oAction = 1;
        return;
    }
    memset(&sDuel, 0, sizeof(sDuel));
    sDuel.obj = o;
    sDuel.cx = o->oPosX, sDuel.cy = o->oPosY, sDuel.cz = o->oPosZ;
    sDuel.yaw = o->oFaceAngleYaw;
    for (i = 0; i < MC_BUBBLES; i++) {
        sBubbles[i].timer = 0;
    }
    o->oAction = 0;
    cur_obj_hide();          // (its model, the Mario cosplayer, marks the spot in build mode; playing, the cast stands round it)
    kd_spawn_cast();
    kd_set_phase(KD_PARTY);
}

static s32 kd_wave_left(s32 wave) {
    s32 i, n = 0;

    for (i = 0; i < LOOK_COUNT; i++) {
        if (sDuel.cos[i] != NULL && mc_wave_of(i) == wave && sDuel.cos[i]->oHealth > 0
            && sDuel.cos[i]->activeFlags != ACTIVE_FLAG_DEACTIVATED) {
            n++;
        }
    }
    return n;
}

static void kd_count_alive(void) {
    s32 i, n = 0;

    for (i = 0; i < LOOK_COUNT; i++) {
        if (sDuel.cos[i] != NULL && sDuel.cos[i]->oHealth > 0 && sDuel.cos[i]->activeFlags != ACTIVE_FLAG_DEACTIVATED) {
            n++;
        }
    }
    sDuel.alive = n;
}

static void kd_give_star(void) {
    struct Object *star;
    struct MarioState *m = gMarioState;
    struct Object *from = sDuel.cos[LOOK_MARIO] != NULL ? sDuel.cos[LOOK_MARIO] : sDuel.obj;

    if (!sDuel.star || sDuel.starDone || sDuel.starGiven) {
        return;
    }
    // out of the Mario cosplayer, up over the floor (spawn_star.inc.c's spawn_star, like a race's)
    star = spawn_object_abs_with_rot(sDuel.obj, 0, MODEL_STAR, bhvStarSpawnCoordinates, from->oPosX, from->oPosY + 80.0f,
                                     from->oPosZ, 0, 0, 0);
    if (star == NULL) {
        return;
    }
    star->oBehParams = 6 << 24; // (a studio star: the page knows it by the duel's uid)
    star->oHomeX = m->pos[0] + sins(m->faceAngle[1]) * 220.0f;
    star->oHomeY = m->pos[1] + 150.0f;
    star->oHomeZ = m->pos[2] + coss(m->faceAngle[1]) * 220.0f;
    star->oFaceAnglePitch = star->oFaceAngleRoll = 0;
    star->oBehParams2ndByte = 0;
    star->unused2 = sDuel.obj->unused2;
    sDuel.starGiven = TRUE;
}

// Mario's health ran out in the fight: the duel is lost (he doesn't die -- they offer a rematch)
static s32 kd_mario_down(void) {
    struct MarioState *m = gMarioState;

    return gMarioObject != NULL && (m->health - m->hurtCounter * 0x40 <= 0x180 || m->health < 0x100)
           && m->action != ACT_KT_PULL;
}

static void kd_reset_cast(void) {
    s32 i;

    for (i = 0; i < LOOK_COUNT; i++) {
        struct Object *c = sDuel.cos[i];

        if (c == NULL || c->activeFlags == ACTIVE_FLAG_DEACTIVATED) {
            continue;
        }
        c->oHealth = sCosHealth[i];
        c->oAction = CS_GATHER;
        c->oTimer = 0;
        c->oMcDrawn = 0;
        c->oFaceAnglePitch = 0;
        c->oMcCooldown = 30;
        c->oIntangibleTimer = 0;
        c->oInteractType = INTERACT_TEXT;
        c->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    }
    sDuel.attackers = 0;
    sDuel.rage = FALSE;
    sDuel.wave = 0;
}

// Mario's health ran out in the fight (the warm-up included): lost -- they go back to their places, he gets
// up, and coming back to the Mario cosplayer starts a rematch
static s32 kd_check_lost(void) {
    struct MarioState *m = gMarioState;

    if (!kd_mario_down()) {
        return FALSE;
    }
    m->hurtCounter = 0;
    m->health = 0x880;
    m->invincTimer = 60;
    kt_fx_word(m->pos[0], m->pos[1] + 220.0f, m->pos[2], KT_WORD_NANI, 40);
    mc_say(LOOK_MARIO, "T_MARIO_3", TRUE);
    kd_reset_cast();
    kt_event("music", o->unused2, 0);
    sDuel.music = FALSE;
    kd_set_phase(KD_LOST);
    sDuelsLost++;
    kt_event("lost", o->unused2, 0);
    return TRUE;
}

void bhv_kt_duel_loop(void) {
    struct MarioState *m = gMarioState;

    if (o->oAction == 1) {
        // (waiting for the other duel to end)
        if (!kt_duel_running()) {
            bhv_kt_duel_init();
        }
        return;
    }
    sDuel.star = o->oKdStar != 0;
    sDuel.starDone = o->oKdStarDone != 0;
    mc_update_bubbles();
    if (gStudioPaused) {
        return;
    }
    if (sDuel.timer < 0x7000) {
        sDuel.timer++;
    }
    if (gKtHitstop > 0) {
        gKtHitstop--;
    }
    if (gKtSlowmo > 0) {
        gKtSlowmo--;
    }
    kd_count_alive();
    switch (sDuel.phase) {
        case KD_PARTY:
            // the party goes on until Mario comes close
            if (gMarioObject != NULL && dist_between_objects(o, gMarioObject) < 900.0f && !(m->action & ACT_FLAG_AIR)) {
                cur_obj_play_sound_2(SOUND_ACTION_TERRAIN_HEAVY_LANDING);
                kd_set_phase(KD_LANDED);
                kt_event("start", o->unused2, 0);
            }
            break;
        case KD_LANDED:
            if (sDuel.timer == 12) {
                mc_say(LOOK_LUIGI, "GASP_2", TRUE);
            }
            if (sDuel.timer == 40) {
                mc_say(LOOK_YOSHI, "GASP_3", TRUE);
            }
            if (sDuel.timer > 50) {
                kd_set_phase(KD_CHALLENGE);
            }
            break;
        case KD_CHALLENGE:
            // (the Mario cosplayer runs this: his walk and his speech)
            if (sDuel.cos[LOOK_MARIO] == NULL || sDuel.cos[LOOK_MARIO]->activeFlags == ACTIVE_FLAG_DEACTIVATED) {
                kd_set_phase(gKtHeld ? KD_FIGHT_START : KD_BLADE);
            }
            break;
        case KD_BLADE:
            if (gKtHeld && (kt_pull_done() || m->action != ACT_KT_PULL)) {
                kd_set_phase(KD_FIGHT_START);
            }
            break;
        case KD_FIGHT_START:
            if (kd_check_lost()) {
                break;
            }
            if (sDuel.timer == 1) {
                kt_event("music", o->unused2, 1);
                sDuel.music = TRUE;
                mc_say(LOOK_LUIGI, "PULL_1", TRUE);
            }
            if (sDuel.timer == 30) {
                mc_say(LOOK_WARIO, "PULL_2", TRUE);
            }
            if (sDuel.timer == 60) {
                mc_say(LOOK_MARIO, "PULL_3", TRUE);
            }
            if (sDuel.timer > 75) {
                sDuel.wave = 0;
                kd_set_phase(KD_FIGHT);
            }
            break;
        case KD_FIGHT:
            if (kd_check_lost()) {
                break;
            }
            if (kd_wave_left(sDuel.wave) == 0) {
                if (sDuel.wave < 2) {
                    sDuel.wave++;
                    mc_say(sDuel.wave == 1 ? LOOK_WARIO : LOOK_MARIO, sDuel.wave == 1 ? "WAVE_2" : "WAVE_3", TRUE);
                    kt_event("wave", o->unused2, sDuel.wave);
                } else {
                    kd_set_phase(KD_FINALE);
                }
            }
            break;
        case KD_FINALE:
            // (the Mario cosplayer's fall, his last words and the star: fighter code)
            break;
        case KD_WON:
            break;
        case KD_LOST:
            // a while to breathe; then coming back near the Mario cosplayer starts round two
            if (sDuel.timer > 90 && sDuel.cos[LOOK_MARIO] != NULL && gMarioObject != NULL
                && dist_between_objects(sDuel.cos[LOOK_MARIO], gMarioObject) < 500.0f && !(m->action & ACT_FLAG_AIR)) {
                sDuel.cos[LOOK_MARIO]->oAction = CS_SPEECH_WALK;
                kd_set_phase(KD_CHALLENGE);
            }
            break;
    }
}

// The duel's camera moments (studio_katana_camera asks when the blade's own are off): none of its own
// beyond the dialogs' -- kept as the hook the cafe had (mc_camera) for later.
s32 kt_duel_camera(struct Camera *c) {
    (void) c;
    return FALSE;
}

void kt_duel_level_start(void) {
    memset(&sDuel, 0, sizeof(sDuel));
    sSoloAttackers = 0;
    sBubbleCount = 0;
    sDuelsWon = sDuelsLost = 0;
    memset(sBubbles, 0, sizeof(sBubbles));
}

// The page's settings for a duel object (slot = its object pool index): a star for winning, already collected.
EMSCRIPTEN_KEEPALIVE
void studio_katana_duel_config(s32 slot, s32 star, s32 starDone) {
    struct Object *obj;

    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return;
    }
    obj = &gObjectPool[slot];
    obj->oKdStar = star;
    obj->oKdStarDone = starDone;
}

// Tests: 1 = every fighter down to one cut, 2 = Mario nearly out of health, 3 / 4 = the fighters never attack / do again,
// 5 = no parries or dodges (every cut lands), 6 = they come back
EMSCRIPTEN_KEEPALIVE
void studio_katana_debug(s32 op) {
    struct ObjectNode *head = &gObjectLists[OBJ_LIST_PUSHABLE];
    struct Object *obj;

    switch (op) {
        case 1:
            for (obj = (struct Object *) head->next; obj != (struct Object *) head; obj = (struct Object *) obj->header.next) {
                if (kt_fighter_is(obj) && obj->oHealth > 1) {
                    obj->oHealth = 1;
                }
            }
            break;
        case 2:
            if (gMarioObject != NULL) {
                gMarioState->health = 0x200;
                gMarioState->hurtCounter = 0;
            }
            break;
        case 3: sPeaceful = TRUE; break;
        case 4: sPeaceful = FALSE; break;
        case 5: sNoDefence = TRUE; break;
        case 6: sNoDefence = FALSE; break;
    }
}

// The duel right now, for studio_katana_state_json (the page draws the bubbles and the counter from it).
s32 kt_duel_json(char *out, s32 size) {
    s32 n, i, k = 0;

    n = snprintf(out, size, "{\"running\":%d,\"uid\":%u,\"phase\":\"%s\",\"timer\":%d,\"wave\":%d,\"alive\":%d,\"down\":%d,"
                            "\"rage\":%d,\"flash\":%d,\"music\":%d,\"star\":%d,\"starGiven\":%d,\"won\":%d,\"lost\":%d,\"lines\":%d,"
                            "\"attackers\":%d,\"solo\":%d,\"fighters\":[",
                 kt_duel_running(), kt_duel_running() ? sDuel.obj->unused2 : 0, sPhaseNames[sDuel.phase], sDuel.timer,
                 sDuel.wave, sDuel.alive, sDuel.down, sDuel.rage, sDuel.flash, sDuel.music, sDuel.star, sDuel.starGiven,
                 sDuelsWon, sDuelsLost, sBubbleCount, sDuel.attackers, sSoloAttackers);
    if (sDuel.flash > 0) {
        sDuel.flash--;           // (the page draws the white flash of the last cut once per read)
    }
    {
        struct ObjectNode *head = &gObjectLists[OBJ_LIST_PUSHABLE];
        struct Object *obj;

        for (obj = (struct Object *) head->next; obj != (struct Object *) head && n < size - 160;
             obj = (struct Object *) obj->header.next) {
            if (!kt_fighter_is(obj)) {
                continue;
            }
            n += snprintf(out + n, size - n, "%s{\"slot\":%d,\"uid\":%u,\"look\":%d,\"action\":%d,\"health\":%d,\"drawn\":%d,\"duel\":%d,"
                                             "\"x\":%.0f,\"y\":%.0f,\"z\":%.0f}",
                          k++ ? "," : "", (s32) (obj - gObjectPool), obj->unused2, obj->rawData.asS32[0x1B], obj->oAction,
                          obj->oHealth, obj->rawData.asS32[0x47], obj->rawData.asS32[0x46], obj->oPosX, obj->oPosY, obj->oPosZ);
        }
    }
    n += snprintf(out + n, size - n, "],\"bubbles\":[");
    for (i = 0, k = 0; i < MC_BUBBLES && n < size - 60; i++) {
        if (sBubbles[i].timer > 0 && sBubbles[i].line != NULL) {
            n += snprintf(out + n, size - n, "%s{\"who\":%d,\"line\":\"%s\",\"timer\":%d}", k++ ? "," : "", sBubbles[i].who,
                          sBubbles[i].line, sBubbles[i].timer);
        }
    }
    n += snprintf(out + n, size - n, "]}");
    return n;
}
