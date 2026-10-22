// Piantas (and Nokis) from Super Mario Sunshine: islanders who stroll around their spot,
// turn to Mario when he comes close, chat when he presses B (and cheer afterwards), get mad
// when he hits them, and dance if asked to.
//
// bparams: byte 2 = body (0 man, 1 man in a vest, 2 woman, 3 Noki man, 4 Noki woman),
// byte 3 = look (skin and shirt, or the Noki's shell colours; 0 = picked from the position,
// so a crowd is colourful by itself), byte 4 = behavior (0 stroll, 1 stand, 2 dance).
#include <ultra64.h>
#include <string.h>

#include "sm64.h"
#include "macros.h"
#include "object_fields.h"
#include "behavior_data.h"
#include "audio_defines.h"
#include "dialog_ids.h"
#include "game/object_helpers.h"
#include "game/obj_behaviors.h"
#include "game/interaction.h"
#include "game/level_update.h"
#include "game/camera.h"
#include "game/ingame_menu.h"
#include "game/segment2.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "sms.h"
#include "game/object_list_processor.h"
#include "game/spawn_sound.h"
#include "engine/behavior_script.h"

#define o gCurrentObject

// the men and the women share one numbering of their moves
#define SMS_ANIM_WAIT SMS_MOMA_ANIM_WAIT
#define SMS_ANIM_WAIT_A SMS_MOMA_ANIM_WAIT_A
#define SMS_ANIM_WAIT_B SMS_MOMA_ANIM_WAIT_B
#define SMS_ANIM_WALK SMS_MOMA_ANIM_WALK
#define SMS_ANIM_TALK SMS_MOMA_ANIM_TALK
#define SMS_ANIM_HAPPY SMS_MOMA_ANIM_HAPPY
#define SMS_ANIM_MAD SMS_MOMA_ANIM_MAD
#define SMS_ANIM_MADLOOP SMS_MOMA_ANIM_MADLOOP
#define SMS_ANIM_RECOVER SMS_MOMA_ANIM_RECOVER
#define SMS_ANIM_DANCE SMS_MOMA_ANIM_DANCE

// Pianta skin colours: blue, orange, pink, yellow, green, purple, red, teal.
static const u32 sSkins[] = { 0x528EF2, 0xF4983C, 0xF286B4, 0xF2CE42, 0x6CC858, 0xA478E2, 0xE25648, 0x3EC0BE };

#define oSmsMode OBJECT_FIELD_S32(0x1F)
#define oSmsBlink OBJECT_FIELD_S32(0x20)
#define oSmsTargetYaw OBJECT_FIELD_S32(0x21)
#define oSmsLine OBJECT_FIELD_S32(0x22)

enum { PIANTA_IDLE, PIANTA_STROLL, PIANTA_GREET, PIANTA_TALK, PIANTA_HAPPY, PIANTA_MAD, PIANTA_RECOVER, PIANTA_DANCE };
enum { MODE_STROLL, MODE_STAND, MODE_DANCE };
enum { EYE_OPEN = 0, EYE_HALF = 1, EYE_SHUT = 2, EYE_HAPPY = 4, EYE_MAD = 5 };

static struct ObjectHitbox sPiantaHitbox = {
    /* interactType: */ INTERACT_TEXT,
    /* downOffset: */ 0,
    /* damageOrCoinValue: */ 0,
    /* health: */ 0,
    /* numLootCoins: */ 0,
    /* radius: */ 110,
    /* height: */ 290,
    /* hurtboxRadius: */ 0,
    /* hurtboxHeight: */ 0,
};

// ---- what Piantas say ------------------------------------------------------------------

static const char *const sLines[] = {
    "Welcome, welcome!\nThe sun is warm, the sea\nis blue, and my leaves\nhave never looked better.",
    "Have you seen any goop\naround here? It makes my\nleaves droop. Ugh!",
    "I could stand here all day.\nActually, I do!\nIt's my favourite hobby.",
    "Those Bob-ombs have no\nsense of rhythm. None!\nNow, a Pianta... we can\nreally dance.",
    "They say there's a Star\nup on the highest spot\naround here. Or was it\na coin? Same thing!",
    "Ooh, a visitor! Do you\nlike fruit? Everybody\nlikes fruit.",
    "Nothing beats a nap\nunder a palm tree.\nExcept two naps.",
};
#define LINE_COUNT ((s32) (sizeof(sLines) / sizeof(sLines[0])))

// what Nokis say (the people of Noki Bay, gentle and a little worried)
static const char *const sNokiLines[] = {
    "Oh my! A visitor!\nWelcome. Mind the tide,\nit comes in quickly here.",
    "The sea has been cloudy\nlately. I do hope it\nclears up soon.",
    "My shell? Thank you!\nI polish it every\nmorning.",
    "Grandfather says the old\nruins hold a treasure.\nGrandfather says a lot.",
    "Have you tried floating\non your back? The water\nholds you, you know.",
};
#define NOKI_LINE_COUNT ((s32) (sizeof(sNokiLines) / sizeof(sNokiLines[0])))
static const s32 sBodies[] = { SMS_BODY_MOMA, SMS_BODY_MOMD, SMS_BODY_MOW, SMS_BODY_MAREM, SMS_BODY_MAREW };
#define IS_NOKI (o->oSmsBody == SMS_BODY_MAREM || o->oSmsBody == SMS_BODY_MAREW)

// A line for the dialog box: the game's own text encoding.
static u8 sText[256];
static struct DialogEntry sDialog = { 1, 4, 95, 200, sText };
static void *sSlotBackup;

static void encode_line(const char *s) {
    s32 n = 0;
    for (; *s != '\0' && n < (s32) sizeof(sText) - 1; s++) {
        u8 c = (u8) *s, o = 0x9E;
        if (c >= '0' && c <= '9') o = c - '0';
        else if (c >= 'A' && c <= 'Z') o = c - 'A' + 0x0A;
        else if (c >= 'a' && c <= 'z') o = c - 'a' + 0x24;
        else if (c == '\n') o = 0xFE;
        else if (c == '\'') o = 0x3E;
        else if (c == '.') o = 0x3F;
        else if (c == ',') o = 0x6F;
        else if (c == '-') o = 0x9F;
        else if (c == '!') o = 0xF2;
        else if (c == '?') o = 0xF4;
        sText[n++] = o;
    }
    sText[n] = 0xFF;
}

// The Pianta speaks through a borrowed dialog slot (a cave sign's), put back afterwards.
static void borrow_dialog(s32 line) {
    encode_line(IS_NOKI ? sNokiLines[(u32) line % NOKI_LINE_COUNT] : sLines[(u32) line % LINE_COUNT]);
    if (sSlotBackup == NULL) {
        sSlotBackup = seg2_dialog_table[DIALOG_169];
    }
    seg2_dialog_table[DIALOG_169] = &sDialog;
}

static void return_dialog(void) {
    if (sSlotBackup != NULL) {
        seg2_dialog_table[DIALOG_169] = sSlotBackup;
        sSlotBackup = NULL;
    }
}

// ---- helpers ------------------------------------------------------------------------------

static void set_anim(s32 anim) {
    if (o->oAnimations == NULL || o->oAnimations[anim] == NULL) {
        anim = SMS_ANIM_WAIT;
    }
    cur_obj_init_animation_with_accel_and_sound(anim, 1.0f);
}

static void set_action(s32 action) {
    o->oAction = action;
    o->oTimer = 0;
}

static u32 hash_position(void) {
    u32 h = (u32) (s32) o->oPosX * 73856093u ^ (u32) (s32) o->oPosZ * 19349663u ^ (u32) (s32) o->oPosY * 83492791u;
    return h ^ (h >> 13);
}

// Mario punching, kicking, diving or pounding right next to us.
static s32 mario_hits_us(void) {
    u32 a = gMarioState->action;
    s32 attacking = a == ACT_PUNCHING || a == ACT_MOVE_PUNCHING || a == ACT_JUMP_KICK || a == ACT_DIVE
                    || a == ACT_GROUND_POUND_LAND || a == ACT_SLIDE_KICK || a == ACT_SLIDE_KICK_SLIDE;
    return attacking && o->oDistanceToMario < 220.0f;
}

static void blink(void) {
    if (o->oAction == PIANTA_HAPPY) {
        o->oSmsEye = EYE_HAPPY;
        return;
    }
    if (o->oAction == PIANTA_MAD) {
        o->oSmsEye = EYE_MAD;
        return;
    }
    o->oSmsBlink++;
    if (o->oSmsBlink > 150 + (s32) (hash_position() % 60)) {
        o->oSmsBlink = 0;
    }
    o->oSmsEye = o->oSmsBlink < 2 ? EYE_HALF : o->oSmsBlink < 5 ? EYE_SHUT : o->oSmsBlink < 7 ? EYE_HALF : EYE_OPEN;
}

// ---- the behavior -------------------------------------------------------------------------

void bhv_sms_pianta_init(void) {
    u32 h = hash_position();
    s32 body = (o->oBehParams >> 16) & 0xFF;
    s32 look = (o->oBehParams >> 8) & 0xFF;
    body = sBodies[body < (s32) (sizeof(sBodies) / sizeof(sBodies[0])) ? body : 0];
    o->oSmsBody = body;
    // a look of 0 is picked from the position: every Pianta of a crowd differs
    o->oSmsTint = (s32) sSkins[(look ? (look - 1) : (s32) (h % 8)) % 8];
    o->oSmsShirt = look ? (look - 1) : (s32) ((h >> 8) % 5);
    o->oSmsLine = (s32) ((h >> 4) % LINE_COUNT);
    o->oSmsMode = o->oBehParams & 0xFF;
    o->oSmsBlink = (s32) (h % 120);
    o->header.gfx.sharedChild = studio_geo_node(gSmsBodies[body].geo);
    o->oAnimations = (struct Animation **) gSmsBodies[body].anims;
    obj_set_hitbox(o, &sPiantaHitbox);
    o->oGravity = -4.0f;
    o->oFriction = 0.9f;
    o->oBuoyancy = 1.2f;
    o->oWallHitboxRadius = 80.0f;
    o->oInteractionSubtype = INT_SUBTYPE_NPC;
    set_action(o->oSmsMode == MODE_DANCE ? PIANTA_DANCE : PIANTA_IDLE);
    set_anim(o->oSmsMode == MODE_DANCE ? SMS_ANIM_DANCE : SMS_ANIM_WAIT);
}

static void act_idle(void) {
    if (o->oTimer == 0) {
        static const s32 waits[] = { SMS_ANIM_WAIT, SMS_ANIM_WAIT_A, SMS_ANIM_WAIT_B };
        set_anim(waits[random_u16() % 3]);
        o->oForwardVel = 0;
    }
    if (o->oDistanceToMario < 420.0f) {
        set_action(PIANTA_GREET);
    } else if (o->oSmsMode == MODE_STROLL && o->oTimer > 90 + (s32) (random_u16() % 120)) {
        // somewhere near home, turning back when we wandered too far
        f32 away = cur_obj_lateral_dist_to_home();
        o->oSmsTargetYaw = away > 500.0f ? cur_obj_angle_to_home() : (s32) random_u16();
        set_action(PIANTA_STROLL);
    }
}

static void act_stroll(void) {
    if (o->oTimer == 0) {
        set_anim(SMS_ANIM_WALK);
    }
    o->oMoveAngleYaw = approach_s16_symmetric(o->oMoveAngleYaw, o->oSmsTargetYaw, 0x300);
    o->oFaceAngleYaw = o->oMoveAngleYaw;
    o->oForwardVel = 5.0f;
    // never off a ledge (they used to stroll off cliffs and fall out of the level)
    sms_stay_on_ground();
    if (o->oForwardVel == 0.0f) {
        o->oSmsTargetYaw = cur_obj_angle_to_home();
        set_action(PIANTA_IDLE);
    } else if (o->oDistanceToMario < 420.0f) {
        o->oForwardVel = 0;
        set_action(PIANTA_GREET);
    } else if (o->oTimer > 70 + (s32) (random_u16() % 60) || (o->oMoveFlags & OBJ_MOVE_HIT_WALL)
               || cur_obj_lateral_dist_to_home() > 700.0f) {
        o->oForwardVel = 0;
        set_action(PIANTA_IDLE);
    }
}

// Mario is close: face him and chat when he presses B.
static void act_greet(void) {
    if (o->oTimer == 0) {
        set_anim(SMS_ANIM_TALK);
        o->oForwardVel = 0;
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x500);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oInteractStatus & INT_STATUS_INTERACTED) {
        borrow_dialog(o->oSmsLine);
        set_action(PIANTA_TALK);
    } else if (o->oDistanceToMario > 600.0f) {
        set_action(o->oSmsMode == MODE_DANCE ? PIANTA_DANCE : PIANTA_IDLE);
    }
}

static void act_talk(void) {
    if (cur_obj_update_dialog_with_cutscene(1 /* Mario looks ahead */, DIALOG_UNK2_FLAG_0 /* turn to Mario */, CUTSCENE_DIALOG, DIALOG_169)) {
        return_dialog();
        o->oInteractStatus = 0;
        o->oSmsLine++; // something new next time
        set_action(PIANTA_HAPPY);
    }
}

static void act_happy(void) {
    if (o->oTimer == 0) {
        set_anim(SMS_ANIM_HAPPY);
        cur_obj_play_sound_2(SOUND_GENERAL_COIN_DROP);
    }
    if (cur_obj_check_if_near_animation_end() || o->oTimer > 90) {
        set_action(PIANTA_GREET);
    }
}

static void act_mad(void) {
    if (o->oTimer == 0) {
        set_anim(SMS_ANIM_MAD);
        cur_obj_play_sound_2(SOUND_OBJ_BULLY_METAL);
    } else if (o->oTimer == 25) {
        set_anim(SMS_ANIM_MADLOOP);
    }
    cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x600);
    o->oMoveAngleYaw = o->oFaceAngleYaw;
    if (o->oTimer > 80) {
        set_action(PIANTA_RECOVER);
    }
}

static void act_recover(void) {
    if (o->oTimer == 0) {
        set_anim(SMS_ANIM_RECOVER);
    }
    if (cur_obj_check_if_near_animation_end() || o->oTimer > 60) {
        set_action(o->oSmsMode == MODE_DANCE ? PIANTA_DANCE : PIANTA_IDLE);
    }
}

static void act_dance(void) {
    if (o->oTimer == 0) {
        set_anim(SMS_ANIM_DANCE);
        o->oForwardVel = 0;
    }
    if (o->oInteractStatus & INT_STATUS_INTERACTED) {
        borrow_dialog(o->oSmsLine);
        set_action(PIANTA_TALK);
    }
}

void bhv_sms_pianta_loop(void) {
    cur_obj_update_floor_and_walls();
    if (mario_hits_us() && o->oAction != PIANTA_MAD && o->oAction != PIANTA_TALK) {
        o->oForwardVel = 0;
        set_action(PIANTA_MAD);
    }
    // Mario pressed B (or A) while touching us, whatever we were doing: he waits for a
    // dialog now, so one must start (else he would wait forever)
    if ((o->oInteractStatus & INT_STATUS_INTERACTED) && o->oAction != PIANTA_TALK) {
        o->oForwardVel = 0;
        borrow_dialog(o->oSmsLine);
        set_action(PIANTA_TALK);
    }
    switch (o->oAction) {
        case PIANTA_IDLE: act_idle(); break;
        case PIANTA_STROLL: act_stroll(); break;
        case PIANTA_GREET: act_greet(); break;
        case PIANTA_TALK: act_talk(); break;
        case PIANTA_HAPPY: act_happy(); break;
        case PIANTA_MAD: act_mad(); break;
        case PIANTA_RECOVER: act_recover(); break;
        case PIANTA_DANCE: act_dance(); break;
    }
    blink();
    cur_obj_move_standard(-78);
    // only a chat clears the "talked to" flag; the rest of the time Mario can start one
    if (o->oAction != PIANTA_TALK) {
        o->oInteractStatus = 0;
    }
}
