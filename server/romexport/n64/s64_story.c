// The project's story in the ROM: the page's story runtime (web/js/story/runtime.js) in C, on the
// block server/romexport/story.js writes (dialogs, variables, events, cutscenes, characters' lines,
// zones, hidden objects). The engine's story.c does the game-side work (dialog boxes, freezing
// Mario, rewards, watched objects), as in the web build.
#include <ultra64.h>
#include <string.h>

#include "sm64.h"
#include "seq_ids.h"
#include "audio/external.h"
#include "engine/math_util.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/interaction.h"
#include "engine/behavior_script.h"
#include "game/game_init.h"
#include "game/ingame_menu.h"
#include "game/level_update.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/print.h"
#include "game/save_file.h"
#include "game/segment2.h"
#include "game/sound_init.h"
#include "studio/studio.h"
#include "level_table.h"
#include "s64_hack.h"

#define FPS 30
#define ACTION_WORDS 8
#define STEP_WORDS 12
#define MAX_QUEUE 16
#define MAX_DEPTH 8
#define MAX_MOVES 8

// what story.c offers (the page's API in the web build)
void studio_story_dialog(s32 id);
s32 studio_story_dialog_busy(void);
s32 studio_story_response(void);
void studio_story_lock(s32 on, s32 hud);
s32 studio_story_locked(void);
s32 studio_story_skip(void);
void studio_story_give(s32 kind, s32 amount);
s32 studio_story_caps(void);
s32 studio_story_red_coins(void);
s32 studio_story_timer(s32 op);
void studio_story_shake(s32 strength);
void studio_story_exit(s32 kind);
void studio_story_puff(f32 x, f32 y, f32 z);
void studio_story_close_dialog(void);
void studio_story_watch(s32 uid, s32 kind);
void studio_story_watch_clear(void);
s32 studio_text_dialog(s32 id, const u8 *bytes, s32 len, s32 lines, s32 left, s32 width, s32 voice, s32 question);
s32 studio_motion_trigger(s32 uid);
void studio_lock_set(u32 uid, s32 stars, s32 key, s32 locked);
s32 studio_teleport(f32 x, f32 y, f32 z, s32 yaw);
s32 s64_slot_of_uid(u32 uid);
s32 s64_spawn_catalog(s32 index, f32 x, f32 y, f32 z, s32 yaw);
void s64_warp_to(s16 level, s16 area, s16 node);
void s64_save_dirty(void);
void s64_story_reset(void);
s32 s64_song_install(s32 index);
// Studio 64's modules (s64_ovl.c: trampolines, 0 when the level does not have them)
void studio_shotgun_give(s32 on);
s32 studio_shotgun_has(void);
void studio_katana_give(s32 on);
s32 studio_katana_has(void);
s32 studio_race_start(u32 uid);
f32 *studio_vehicle_hud(void);
void studio_set_keys(u32 mask);
u32 studio_get_keys(void);
f32 s64_f32(u32 w);
s16 get_string_width(u8 *str);

extern s32 gStudioCamEnabled;
extern f32 gStudioCamPos[3], gStudioCamFocus[3], gStudioCamFov;

// ---- the block ----------------------------------------------------------------------------------
static u8 *sStory;
#define W(off) (*(const u32 *) (sStory + (off)))
#define S(off) ((s32) W(off))
#define F(off) s64_f32(W(off))

enum { SEC_DIALOGS, SEC_VARS, SEC_EVENTS, SEC_CUTS, SEC_NPCS, SEC_HIDDEN, SEC_ZONES, SEC_START, SEC_OBJS };
static s32 count_of(s32 sec) { return S(8 + sec * 8); }
static u32 sec_of(s32 sec) { return W(12 + sec * 8); }

// ---- progress -----------------------------------------------------------------------------------
// (s64_save.c keeps it with the save file: s64_story_pack, s64_story_unpack)
struct S64StoryProgress {
    s32 *vars;
    u8 *done;      // per event: happened ("once")
    u8 *off;       // per event: switched off by an event
    s8 *objects;   // per object: 0 as placed, 1 shown, 2 hidden
    s8 *locks;     // per object: 0 as placed, 1 open, 2 locked
    u8 *duelWon;   // per object: a katana duel won
    s32 anyDuelWon;
    s32 started;
};
struct S64StoryProgress gS64Progress;

static s32 sVisit, sLevelFrames;
static s32 *sFiredVisit;   // per event: the visit it last fired in
static u8 sInZone[256];
static s16 sQueue[MAX_QUEUE];
static s32 sQueueLen;

enum { WAIT_NONE, WAIT_FRAMES, WAIT_DIALOG, WAIT_CUTSCENE, WAIT_STAR, WAIT_ARRIVAL };

struct Frame {
    u32 list;   // offset of an action list
    s32 i;
};
static struct {
    s32 active, ev, depth, answer;
    struct Frame stack[MAX_DEPTH];
    s32 wait, waitFrames, waitVisit, waitDialogVar;
    u32 arrivalPos;  // teleport after a warp's arrival (offset of a position)
} sRun;

static struct {
    s32 active, index, step, stepFrame, skip, ownCam, waitMove;
    u32 base;    // the cutscene
    f32 from[7], to[7], cam[7]; // pos, focus, fov
} sCut;

static struct {
    s32 active, slot, frames, frame, ease;
    f32 from[3], to[3];
    s16 yaw;
    s32 setYaw;
} sMoves[MAX_MOVES];

static const u8 *sCaption;
static s32 sCaptionFrames;
static f32 sFade, sFadeTo, sFadeStep;
static u32 sFadeColor;

// ---- helpers ------------------------------------------------------------------------------------
// a level that is played (not the title screen, the file select or the ending)
static s32 played_level(void) {
    return gCurrLevelNum >= LEVEL_BBH && gCurrLevelNum != LEVEL_ENDING && gCurrLevelNum != LEVEL_UNKNOWN_32
           && gCurrLevelNum != LEVEL_UNKNOWN_35 && gCurrLevelNum < LEVEL_UNKNOWN_37;
}

static s32 obj_index(u32 uid) {
    s32 i, n = count_of(SEC_OBJS);
    for (i = 0; i < n; i++) {
        if (W(sec_of(SEC_OBJS) + i * 28) == uid) {
            return i;
        }
    }
    return -1;
}

static s32 here_matches(s32 level, s32 area) {
    if (level == 0) {
        return TRUE;
    }
    if (level != gCurrLevelNum) {
        return FALSE;
    }
    return area == 0 || gCurrentArea == NULL || area == gCurrentArea->index;
}

static s32 get_var(s32 i) {
    return (i >= 0 && i < count_of(SEC_VARS)) ? gS64Progress.vars[i] : 0;
}

static void fire(s32 type, s32 a, s32 b, s32 c);

static void set_var(s32 i, s32 v) {
    if (i < 0 || i >= count_of(SEC_VARS)) {
        return;
    }
    if (S(sec_of(SEC_VARS) + i * 8) == 0) {
        v = v != 0;
    }
    if (gS64Progress.vars[i] != v) {
        gS64Progress.vars[i] = v;
        s64_save_dirty();
        fire(12, i, 0, 0);
    }
}

static s32 cmp(s32 a, s32 op, s32 b) {
    switch (op) {
        case 0: return a == b;
        case 1: return a != b;
        case 2: return a < b;
        case 3: return a <= b;
        case 4: return a > b;
        default: return a >= b;
    }
}

static s32 star_collected(u32 uid) {
    s32 k = obj_index(uid);
    u32 o;
    s32 level, course;
    if (k < 0) {
        return FALSE;
    }
    o = sec_of(SEC_OBJS) + k * 28;
    level = S(o + 4);
    if (level <= 0 || level > LEVEL_COUNT) {
        return FALSE;
    }
    course = gLevelToCourseNumTable[level - 1];
    return (save_file_get_star_flags(gCurrSaveFileNum - 1, COURSE_NUM_TO_INDEX(course)) >> (S(o + 24) & 7)) & 1;
}

// conditions: a list (count, then type, op, a, b)
static s32 check(u32 list) {
    s32 n = S(list), i;
    struct MarioState *m = gMarioState;
    for (i = 0; i < n; i++) {
        u32 c = list + 4 + i * 16;
        s32 type = S(c), op = S(c + 4), a = S(c + 8), b = S(c + 12), ok = TRUE;
        switch (type) {
            case 1: ok = (get_var(a) != 0) == (b != 0); break;
            case 2: ok = cmp(get_var(a), op, b); break;
            case 3: ok = cmp(m->numStars, op, a); break;
            case 4: ok = cmp(m->numCoins, op, a); break;
            case 5: ok = cmp(m->numLives, op, a); break;
            case 6: ok = cmp(m->health >> 8, op, a); break;
            case 7: ok = ((studio_story_caps() & a) != 0) == (b != 0); break;
            case 8: ok = cmp(gCurrActNum, op, a); break;
            case 9: ok = here_matches(a, b); break;
            case 10: ok = (a >= 0 && a < count_of(SEC_EVENTS) && gS64Progress.done[a]) == (b != 0); break;
            case 11: ok = star_collected(a) == (b != 0); break;
            case 12: ok = (random_u16() % 100) < a; break;
            case 13: ok = (studio_shotgun_has() != 0) == (b != 0); break;
            case 14: { f32 *hud = studio_vehicle_hud(); ok = (hud != NULL && hud[0] >= 0.5f) == (b != 0); break; }
            case 15: ok = (studio_katana_has() != 0) == (b != 0); break;
            case 16: {
                s32 k = a ? obj_index((u32) a) : -1;
                ok = (a ? (k >= 0 && gS64Progress.duelWon[k]) : gS64Progress.anyDuelWon) == (b != 0);
                break;
            }
            default: break;
        }
        if (!ok) {
            return FALSE;
        }
    }
    return TRUE;
}

// ---- events -------------------------------------------------------------------------------------
static u32 event_at(s32 i) {
    return W(sec_of(SEC_EVENTS) + i * 4);
}

static s32 matches(u32 ev, s32 type, s32 a, s32 b, s32 c) {
    s32 i;
    if (S(ev) != type) {
        return FALSE;
    }
    if (type != 13 && !here_matches(S(ev + 8), S(ev + 12))) {
        return FALSE;
    }
    switch (type) {
        case 1: case 2: return W(ev + 20) == (u32) a;
        case 3:
            return (W(ev + 20) == 0 || W(ev + 20) == (u32) a) && (S(ev + 24) == 0 || S(ev + 24) == b)
                   && (S(ev + 28) < 0 || S(ev + 28) == c);
        case 4: return W(ev + 20) == 0 || W(ev + 20) == (u32) a;
        case 5: case 6: return W(ev + 20) == (u32) a;
        case 7: return (W(ev + 20) == 0 || W(ev + 20) == (u32) a) && S(ev + 24) == b;
        case 8: case 9: case 10: return a == (s32) ev;
        case 11: return here_matches(S(ev + 20), S(ev + 24));
        case 12:
            i = S(ev + 20);
            return i == a && cmp(get_var(i), S(ev + 24), S(ev + 28));
        case 13: return TRUE;
        case 14: case 15: case 16: return (W(ev + 20) == 0 || W(ev + 20) == (u32) a) && S(ev + 24) == b;
        default: return FALSE;
    }
}

static void fire(s32 type, s32 a, s32 b, s32 c) {
    s32 i, k, n;
    if (sStory == NULL) {
        return;
    }
    n = count_of(SEC_EVENTS);
    for (i = 0; i < n; i++) {
        u32 ev = event_at(i);
        s32 repeat = S(ev + 4), queued = FALSE;
        if (!S(ev + 16) || gS64Progress.off[i] || !matches(ev, type, a, b, c)) {
            continue;
        }
        if (repeat == 0 && gS64Progress.done[i]) continue;
        if (repeat == 1 && sFiredVisit[i] == sVisit) continue;
        // (level-bound triggers that are true every frame: once per visit)
        if ((type == 8 || type == 9 || type == 10 || type == 12) && sFiredVisit[i] == sVisit) continue;
        for (k = 0; k < sQueueLen; k++) {
            if (sQueue[k] == i) queued = TRUE;
        }
        if (queued || (sRun.active && sRun.ev == i)) continue;
        if (!check(W(ev + 44))) continue;
        sFiredVisit[i] = sVisit;
        if (repeat == 0) {
            gS64Progress.done[i] = TRUE;
            s64_save_dirty();
        }
        if (sQueueLen < MAX_QUEUE) {
            sQueue[sQueueLen++] = i;
        }
    }
}

// ---- objects shown and hidden for good ----------------------------------------------------------
s32 s64_story_hidden(u32 uid) {
    s32 k, i, n;
    if (sStory == NULL) {
        return FALSE;
    }
    k = obj_index(uid);
    if (k >= 0 && gS64Progress.objects[k]) {
        return gS64Progress.objects[k] == 2;
    }
    n = count_of(SEC_HIDDEN);
    for (i = 0; i < n; i++) {
        if (W(sec_of(SEC_HIDDEN) + i * 4) == uid) return TRUE;
    }
    return FALSE;
}

static void set_object(u32 uid, s32 show, s32 effect) {
    s32 k = obj_index(uid), slot = s64_slot_of_uid(uid);
    if (k >= 0) {
        gS64Progress.objects[k] = show ? 1 : 2;
        s64_save_dirty();
    }
    if (slot >= 0) {
        struct Object *obj = &gObjectPool[slot];
        if (show) {
            obj->header.gfx.node.flags |= GRAPH_RENDER_ACTIVE;
            obj->oIntangibleTimer = 0;
        } else {
            obj->header.gfx.node.flags &= ~GRAPH_RENDER_ACTIVE;
            obj->oIntangibleTimer = -1;
        }
        if (effect == 1) {
            studio_story_puff(obj->oPosX, obj->oPosY + 60.0f, obj->oPosZ);
            play_sound(show ? SOUND_MENU_COLLECT_SECRET : SOUND_GENERAL_DOOR_TURN_KEY, gGlobalSoundSource);
        } else if (effect == 2) {
            play_sound(SOUND_GENERAL_DOOR_TURN_KEY, gGlobalSoundSource);
        }
    }
}

static void set_lock(u32 uid, s32 locked) {
    s32 k = obj_index(uid);
    if (k >= 0) {
        gS64Progress.locks[k] = locked ? 2 : 1;
        s64_save_dirty();
    }
    studio_lock_set(uid, 0, -1, locked);
    play_sound(locked ? SOUND_GENERAL_DOOR_TURN_KEY : SOUND_MENU_COLLECT_SECRET, gGlobalSoundSource);
}

// ---- actions ------------------------------------------------------------------------------------
static void story_cutscene_start(s32 index);

static void wait_frames(s32 n) {
    sRun.wait = WAIT_FRAMES;
    sRun.waitFrames = n;
}

static void push(u32 list) {
    if (sRun.depth < MAX_DEPTH) {
        sRun.stack[sRun.depth].list = list;
        sRun.stack[sRun.depth].i = 0;
        sRun.depth++;
    }
}

static void where(s32 kind, u32 uid, u32 pos, f32 *out) {
    struct MarioState *m = gMarioState;
    if (kind == 1) {
        s32 k = obj_index(uid);
        if (k >= 0) {
            u32 o = sec_of(SEC_OBJS) + k * 28;
            out[0] = F(o + 12); out[1] = F(o + 16); out[2] = F(o + 20);
            return;
        }
    } else if (kind == 2 && pos) {
        out[0] = F(pos); out[1] = F(pos + 4); out[2] = F(pos + 8);
        return;
    }
    out[0] = m->pos[0] + sins(m->faceAngle[1]) * 250.0f;
    out[1] = m->pos[1] + 20.0f;
    out[2] = m->pos[2] + coss(m->faceAngle[1]) * 250.0f;
}

static void uid_list_each(u32 list, s32 op, s32 arg) {
    s32 n = S(list), i;
    for (i = 0; i < n; i++) {
        u32 uid = W(list + 4 + i * 4);
        switch (op) {
            case 4: case 5: {
                // doors, pipes, paintings and warp zones open and lock; any other object (a gate, a
                // wall) goes for good (or comes back)
                s32 slot = s64_slot_of_uid(uid);
                struct Object *obj = slot >= 0 ? &gObjectPool[slot] : NULL;
                s32 isWarp = obj != NULL && (obj->oInteractType & (INTERACT_WARP | INTERACT_WARP_DOOR | INTERACT_DOOR));
                if (isWarp || obj == NULL) set_lock(uid, op == 5);
                if (!isWarp && obj != NULL) set_object(uid, op == 5, op == 4 ? 2 : 0);
                break;
            }
            case 6: case 7: set_object(uid, op == 6, arg); break;
            case 10: studio_motion_trigger(uid); break;
        }
    }
}

// runs one action; returns FALSE when the run waits
static s32 run_action(u32 a) {
    struct MarioState *m = gMarioState;
    s32 type = S(a);
    s32 a1 = S(a + 4), a2 = S(a + 8), a3 = S(a + 12), a4 = S(a + 16), a5 = S(a + 20), a6 = S(a + 24);
    f32 p[3];
    s32 i;
    switch (type) {
        case 1: // dialog
            if (a1 < 0) return TRUE;
            studio_story_dialog(a1);
            sRun.wait = WAIT_DIALOG;
            sRun.waitFrames = 2;
            sRun.waitDialogVar = a2;
            return FALSE;
        case 2: set_var(a1, a2 == 2 ? !get_var(a1) : a2); return TRUE;
        case 3: set_var(a1, a2 == 1 ? get_var(a1) + a3 : a2 == 2 ? get_var(a1) - a3 : a3); return TRUE;
        case 4: case 5: uid_list_each(W(a + 4), type, 0); return TRUE;
        case 6: case 7: uid_list_each(W(a + 4), type, a2); return TRUE;
        case 8: // spawn
            where(a3, W(a + 16), W(a + 20), p);
            for (i = 0; i < a2; i++) {
                f32 ang = a2 > 1 ? (i * 65536 / a2) : 0, r = a2 > 1 ? 160.0f : 0.0f;
                s64_spawn_catalog(a1, p[0] + sins(ang) * r, p[1] + a6, p[2] + coss(ang) * r, 0);
            }
            play_sound(SOUND_GENERAL_COIN_SPURT, gGlobalSoundSource);
            return TRUE;
        case 9: { // give a star: it appears (in front of Mario)
            s32 slot;
            set_object(W(a + 4), TRUE, 0);
            slot = s64_slot_of_uid(W(a + 4));
            if (a2 && slot >= 0) {
                struct Object *obj = &gObjectPool[slot];
                obj->oPosX = m->pos[0] + sins(m->faceAngle[1]) * 220.0f;
                obj->oPosY = m->pos[1] + 160.0f;
                obj->oPosZ = m->pos[2] + coss(m->faceAngle[1]) * 220.0f;
                obj->oHomeX = obj->oPosX; obj->oHomeY = obj->oPosY; obj->oHomeZ = obj->oPosZ;
            }
            play_sound(SOUND_GENERAL2_STAR_APPEARS, gGlobalSoundSource);
            return TRUE;
        }
        case 10: uid_list_each(W(a + 4), 10, 0); return TRUE;
        case 11: studio_story_give(0, a1); return TRUE;
        case 12: studio_story_give(1, a1); return TRUE;
        case 13: studio_story_give(2, a1); return TRUE;
        case 14: studio_story_give(a1, a2); return TRUE;
        case 15: studio_story_give(6, a1); return TRUE;
        case 16: // music: the game's, or one of the project's songs (-2 - its index)
            if (a1 <= -2) a1 = s64_song_install(-2 - a1);
            if (a1 >= 0) play_music(SEQ_PLAYER_LEVEL, SEQUENCE_ARGS(4, a1), 0);
            return TRUE;
        case 17: if (a1) play_sound((u32) a1, gGlobalSoundSource); return TRUE;
        case 18: // warp
            if (a1 <= 0) return TRUE;
            s64_warp_to(a1, a2, a3 ? a3 : 0x0A);
            if (a4) {
                sRun.wait = WAIT_ARRIVAL;
                sRun.waitVisit = sVisit;
                sRun.arrivalPos = W(a + 20);
                return FALSE;
            }
            return TRUE;
        case 22: // teleport
            if (a1) studio_teleport(F(a1), F(a1 + 4), F(a1 + 8), S(a1 + 12));
            return TRUE;
        case 23: // cutscene
            if (a1 < 0 || a1 >= count_of(SEC_CUTS)) return TRUE;
            story_cutscene_start(a1);
            sRun.wait = WAIT_CUTSCENE;
            return FALSE;
        case 24: studio_story_timer(a1); return TRUE;
        case 25: studio_story_shake(a1); return TRUE;
        case 26: wait_frames(a1); return FALSE;
        case 27: // caption
            sCaption = sStory + a1;
            sCaptionFrames = a2;
            wait_frames(a2);
            return FALSE;
        case 28: studio_story_exit(0); return TRUE;
        case 29: studio_story_exit(1); return TRUE;
        case 30: { // if
            s32 ok = (a1 == 0 || a1 == sRun.answer) && check(W(a + 8));
            push(ok ? W(a + 12) : W(a + 16));
            return TRUE;
        }
        case 31: // switch an event on or off
            if (a1 >= 0 && a1 < count_of(SEC_EVENTS)) {
                if (a3) gS64Progress.done[a1] = FALSE;
                gS64Progress.off[a1] = a2 == 0;
                s64_save_dirty();
            }
            return TRUE;
        case 19: studio_shotgun_give(a1); return TRUE;
        case 20: studio_katana_give(a1); return TRUE;
        case 21: studio_race_start((u32) a1); return TRUE;
        default:
            (void) a5;
            return TRUE;
    }
}

// ---- cutscenes ----------------------------------------------------------------------------------
static f32 ease(s32 kind, f32 t) {
    switch (kind) {
        case 0: return t;
        case 2: return t * t * t;
        case 3: return 1.0f - (1.0f - t) * (1.0f - t) * (1.0f - t);
        case 4: return 1.0f;
        default: return t * t * (3.0f - 2.0f * t);
    }
}

static void story_cutscene_start(s32 index) {
    u32 cs = W(sec_of(SEC_CUTS) + index * 4);
    sCut.active = TRUE;
    sCut.index = index;
    sCut.base = cs;
    sCut.step = 0;
    sCut.stepFrame = -1;
    sCut.skip = FALSE;
    sCut.ownCam = FALSE;
    studio_story_lock(1, S(cs + 4));
    vec3f_copy(sCut.cam, gLakituState.pos);
    vec3f_copy(&sCut.cam[3], gLakituState.focus);
    sCut.cam[6] = 45.0f;
}

static void end_cutscene(void) {
    sCut.active = FALSE;
    gStudioCamEnabled = FALSE;
    studio_story_lock(0, 1);
    sCaption = NULL;
    sFadeTo = 0.0f;
    sFadeStep = 0.1f;
}

static void move_object(u32 st) {
    s32 slot = s64_slot_of_uid(W(st + 4)), k, flags = S(st + 20);
    struct Object *obj;
    if (slot < 0) {
        return;
    }
    obj = &gObjectPool[slot];
    for (k = 0; k < MAX_MOVES && sMoves[k].active; k++) {
    }
    if (k == MAX_MOVES) {
        return;
    }
    sMoves[k].active = TRUE;
    sMoves[k].slot = slot;
    sMoves[k].frames = S(st + 8);
    sMoves[k].frame = 0;
    sMoves[k].ease = S(st + 12);
    sMoves[k].from[0] = obj->oPosX; sMoves[k].from[1] = obj->oPosY; sMoves[k].from[2] = obj->oPosZ;
    sMoves[k].to[0] = (flags & 1) ? F(st + 24) : obj->oPosX;
    sMoves[k].to[1] = (flags & 2) ? F(st + 28) : obj->oPosY;
    sMoves[k].to[2] = (flags & 4) ? F(st + 32) : obj->oPosZ;
    sMoves[k].setYaw = flags & 8;
    sMoves[k].yaw = (s16) S(st + 36);
}

static void moves_frame(void) {
    s32 k, i;
    for (k = 0; k < MAX_MOVES; k++) {
        struct Object *obj;
        f32 t;
        if (!sMoves[k].active) continue;
        obj = &gObjectPool[sMoves[k].slot];
        sMoves[k].frame++;
        if (sCut.skip) sMoves[k].frame = sMoves[k].frames;
        t = ease(sMoves[k].ease, (f32) sMoves[k].frame / sMoves[k].frames);
        for (i = 0; i < 3; i++) {
            (&obj->oPosX)[i] = sMoves[k].from[i] + (sMoves[k].to[i] - sMoves[k].from[i]) * t;
        }
        if (sMoves[k].setYaw) obj->oFaceAngleYaw = obj->oMoveAngleYaw = sMoves[k].yaw;
        if (sMoves[k].frame >= sMoves[k].frames) sMoves[k].active = FALSE;
    }
}

static s32 moves_busy(void) {
    s32 k;
    for (k = 0; k < MAX_MOVES; k++) {
        if (sMoves[k].active) return TRUE;
    }
    return FALSE;
}

// one frame of the cutscene's current step; returns TRUE when the step is done
static s32 cut_step(u32 st) {
    s32 type = S(st), i;
    if (sCut.stepFrame < 0) {
        // the step begins
        sCut.stepFrame = 0;
        switch (type) {
            case 1: { // shot
                s32 flags = S(st + 12);
                for (i = 0; i < 7; i++) sCut.from[i] = sCut.cam[i];
                for (i = 0; i < 3; i++) {
                    sCut.to[i] = (flags & 1) ? F(st + 20 + i * 4) : sCut.cam[i];
                    sCut.to[3 + i] = (flags & 2) ? F(st + 32 + i * 4) : sCut.cam[3 + i];
                }
                sCut.to[6] = (flags & 4) ? F(st + 16) : sCut.cam[6];
                sCut.ownCam = TRUE;
                break;
            }
            case 2: sCut.ownCam = FALSE; gStudioCamEnabled = FALSE; return TRUE;
            case 3: if (S(st + 4) < 0) return TRUE; studio_story_dialog(S(st + 4)); break;
            case 5: sCaption = sStory + W(st + 4); sCaptionFrames = S(st + 8); break;
            case 6:
                sFadeColor = W(st + 12);
                sFadeTo = S(st + 4) ? 1.0f : 0.0f;
                sFadeStep = S(st + 8) > 0 ? 1.0f / S(st + 8) : 1.0f;
                break;
            case 7: move_object(st); if (!S(st + 16)) return TRUE; break;
            case 8: studio_teleport(F(st + 4), F(st + 8), F(st + 12), S(st + 16)); return TRUE;
            case 9: run_action(W(st + 4)); return TRUE;
            default: break;
        }
    }
    sCut.stepFrame++;
    switch (type) {
        case 1: {
            s32 n = S(st + 4);
            f32 t = n > 0 ? ease(S(st + 8), (f32) sCut.stepFrame / n) : 1.0f;
            for (i = 0; i < 7; i++) sCut.cam[i] = sCut.from[i] + (sCut.to[i] - sCut.from[i]) * t;
            return sCut.stepFrame >= n || sCut.skip;
        }
        case 3: return sCut.stepFrame > 2 && (!studio_story_dialog_busy() || sCut.skip);
        case 4: return sCut.stepFrame >= S(st + 4) || sCut.skip;
        case 5:
            if (sCut.stepFrame >= S(st + 8) || sCut.skip) { sCaption = NULL; return TRUE; }
            return FALSE;
        case 6: return sCut.stepFrame >= S(st + 8) || sCut.skip;
        case 7: return !moves_busy();
        default: return TRUE;
    }
}

static void cut_frame(void) {
    u32 cs = sCut.base;
    if (S(cs) && studio_story_skip()) {
        sCut.skip = TRUE;
        studio_story_close_dialog();
    }
    while (sCut.active) {
        if (sCut.step >= S(cs + 8) || (sCut.skip && sCut.stepFrame < 0)) {
            end_cutscene();
            return;
        }
        if (!cut_step(cs + 12 + sCut.step * STEP_WORDS * 4)) {
            break;
        }
        sCut.step++;
        sCut.stepFrame = -1;
    }
    if (sCut.ownCam) {
        gStudioCamEnabled = TRUE;
        vec3f_copy(gStudioCamPos, sCut.cam);
        vec3f_copy(gStudioCamFocus, &sCut.cam[3]);
        gStudioCamFov = sCut.cam[6];
    }
}

// ---- the run of an event ------------------------------------------------------------------------
static void run_frame(void) {
    s32 act = gMarioState->action;
    if (!sRun.active) {
        if (sQueueLen == 0) return;
        sRun.active = TRUE;
        sRun.ev = sQueue[0];
        sQueueLen--;
        memmove(sQueue, sQueue + 1, sQueueLen * sizeof(sQueue[0]));
        sRun.depth = 0;
        sRun.answer = 0;
        push(W(event_at(sRun.ev) + 48));
        // a star's dance and the level exit after it come first
        sRun.wait = WAIT_STAR;
        sRun.waitFrames = FPS * 40;
        sRun.waitVisit = sVisit;
    }
    switch (sRun.wait) {
        case WAIT_FRAMES:
            if (--sRun.waitFrames > 0) return;
            sCaption = NULL;
            break;
        case WAIT_DIALOG:
            if (sRun.waitFrames > 0) { sRun.waitFrames--; return; }
            if (studio_story_dialog_busy()) return;
            {
                s32 r = studio_story_response();
                sRun.answer = r;
                if (sRun.waitDialogVar >= 0) set_var(sRun.waitDialogVar, r == 1);
            }
            break;
        case WAIT_CUTSCENE:
            if (sCut.active) return;
            break;
        case WAIT_STAR:
            if ((act == ACT_STAR_DANCE_EXIT || act == ACT_STAR_DANCE_WATER || act == ACT_FALL_AFTER_STAR_GRAB
                 || act == ACT_STAR_DANCE_NO_EXIT || gWarpTransition.isActive) && --sRun.waitFrames > 0) {
                return;
            }
            break;
        case WAIT_ARRIVAL:
            if (sVisit == sRun.waitVisit || gMarioObject == NULL || sCurrPlayMode != 0) return;
            if (sRun.arrivalPos) {
                u32 p = sRun.arrivalPos;
                studio_teleport(F(p), F(p + 4), F(p + 8), S(p + 12));
            }
            break;
        default:
            break;
    }
    sRun.wait = WAIT_NONE;
    while (sRun.depth > 0) {
        struct Frame *f = &sRun.stack[sRun.depth - 1];
        if (f->i >= S(f->list)) {
            sRun.depth--;
            continue;
        }
        if (!run_action(f->list + 4 + (f->i++) * ACTION_WORDS * 4)) {
            return;
        }
    }
    sRun.active = FALSE;
}

// ---- every frame ----------------------------------------------------------------------------------
static s32 inside_zone(u32 z, struct MarioState *m) {
    f32 a = -(S(z + 24) / 65536.0f) * 6.2831853f;
    f32 dx = m->pos[0] - F(z + 12), dz = m->pos[2] - F(z + 20);
    f32 lx = dx * cosf(a) + dz * sinf(a), lz = -dx * sinf(a) + dz * cosf(a);
    f32 y = F(z + 16);
    return lx <= F(z + 28) / 2 && lx >= -F(z + 28) / 2 && lz <= F(z + 36) / 2 && lz >= -F(z + 36) / 2
           && m->pos[1] >= y - 40.0f && m->pos[1] <= y + F(z + 32);
}

static void zones_frame(void) {
    s32 n = count_of(SEC_ZONES), i;
    for (i = 0; i < n && i < 256; i++) {
        u32 z = sec_of(SEC_ZONES) + i * 40;
        s32 in;
        if (!here_matches(S(z + 4), S(z + 8))) continue;
        in = inside_zone(z, gMarioState);
        if (in && !sInZone[i]) { sInZone[i] = TRUE; fire(1, W(z), 0, 0); }
        else if (!in && sInZone[i]) { sInZone[i] = FALSE; fire(2, W(z), 0, 0); }
    }
}

static void counters_frame(void) {
    s32 n = count_of(SEC_EVENTS), i;
    for (i = 0; i < n; i++) {
        u32 ev = event_at(i);
        s32 type = S(ev);
        if (type == 8 && gMarioState->numCoins >= S(ev + 20)) fire(8, (s32) ev, 0, 0);
        else if (type == 9 && studio_story_red_coins() >= S(ev + 20)) fire(9, (s32) ev, 0, 0);
        else if (type == 10 && sLevelFrames >= S(ev + 20)) fire(10, (s32) ev, 0, 0);
        else if (type == 12) fire(12, S(ev + 20), 0, 0);
    }
}

void s64_story_frame(void) {
    if (sStory == NULL || gCurrentArea == NULL || gMarioObject == NULL || sCurrPlayMode != 0 || !played_level()) {
        return;
    }
    sLevelFrames++;
    moves_frame();
    if (sCut.active) cut_frame();
    if (sCaptionFrames > 0 && !sCut.active && !sRun.active) sCaptionFrames--;
    if (sFade != sFadeTo) {
        sFade += sFade < sFadeTo ? sFadeStep : -sFadeStep;
        if ((sFadeStep > 0 && ((sFade > sFadeTo && sFadeTo == 1.0f) || (sFade < sFadeTo && sFadeTo == 0.0f)))) sFade = sFadeTo;
        if (sFade < 0) sFade = 0;
        if (sFade > 1) sFade = 1;
    }
    zones_frame();
    if (sLevelFrames % 5 == 0) counters_frame();
    run_frame();
}

// ---- the areas --------------------------------------------------------------------------------------
void s64_story_area_loaded(void) {
    s32 i, n;
    if (sStory == NULL || !played_level()) {
        return;
    }
    sVisit++;
    sLevelFrames = 0;
    bzero(sInZone, sizeof(sInZone));
    if (sCut.active) end_cutscene();
    bzero(sMoves, sizeof(sMoves));
    // doors that events opened or locked in this game
    n = count_of(SEC_OBJS);
    for (i = 0; i < n; i++) {
        if (gS64Progress.locks[i]) {
            studio_lock_set(W(sec_of(SEC_OBJS) + i * 28), 0, -1, gS64Progress.locks[i] == 2);
        }
    }
    // defeated objects and pressed switches the triggers watch
    studio_story_watch_clear();
    n = count_of(SEC_EVENTS);
    for (i = 0; i < n; i++) {
        u32 ev = event_at(i);
        if ((S(ev) == 5 || S(ev) == 6) && W(ev + 20)) studio_story_watch(W(ev + 20), S(ev) == 6 ? 1 : 0);
    }
    if (!gS64Progress.started) {
        u32 st = sec_of(SEC_START);
        gS64Progress.started = TRUE;
        s64_save_dirty();
        fire(13, 0, 0, 0);
        if (S(st + 8)) studio_teleport(F(st + 12), F(st + 16), F(st + 20), S(st + 24));
        // (the opening dialog and cutscene: events of their own)
        if (S(st) >= 0) studio_story_dialog(S(st));
        if (S(st + 4) >= 0 && S(st + 4) < count_of(SEC_CUTS)) story_cutscene_start(S(st + 4));
    }
    fire(11, 0, 0, 0);
}

// ---- what the engine tells the page (EM_ASM in the web build) -----------------------------------------
s32 s64_page_studioNpcDialog(s32 uid, s32 dialog) {
    s32 n = count_of(SEC_NPCS), i, k;
    (void) dialog;
    if (sStory == NULL) return -1;
    for (i = 0; i < n; i++) {
        u32 npc = sec_of(SEC_NPCS) + i * 8;
        u32 lines;
        if (W(npc) != (u32) uid) continue;
        lines = W(npc + 4);
        for (k = 0; k < S(lines); k++) {
            u32 line = lines + 4 + k * 8;
            if (check(W(line + 4)) && S(line) >= 0) return S(line);
        }
    }
    return -1;
}

void s64_page_studioStoryEvent(s32 kind, s32 a, s32 b, s32 c) {
    if (kind == 1) fire(3, a, b, c);          // a talk ended: uid, answer, dialog
    else if (kind == 2) fire(b == 1 ? 6 : 5, a, 0, 0); // a switch pressed, an object defeated
}

void s64_page_studioObjectEvent(u32 uid, s32 ev) {
    fire(7, (s32) uid, ev, 0);
}

void s64_page_studioUnlocked(u32 uid) {
    s32 k = obj_index(uid);
    if (k >= 0) gS64Progress.locks[k] = 1;
    s64_save_dirty();
}

// cars and races (vehicle.c): Mario gets in, out, crashes; a race starts, is won or lost
void s64_page_studioVehicleEvent(const char *name, u32 uid, s32 value) {
    static const char *const kEvents[] = { "enter", "exit", "crash" };
    static const char *const kRaces[] = { "race_won", "race_lost", "race_start" };
    s32 i;
    (void) value;
    for (i = 0; i < 3; i++) {
        if (strcmp(name, kEvents[i]) == 0) fire(14, (s32) uid, i, 0);
        if (strcmp(name, kRaces[i]) == 0) fire(15, (s32) uid, i, 0);
    }
}

// katana duels (katana.c): one starts, is won (remembered in the save) or lost
void s64_page_studioKatanaEvent(const char *kind, u32 uid, s32 value) {
    (void) value;
    if (strcmp(kind, "won") == 0) {
        s32 k = obj_index(uid);
        if (k >= 0) gS64Progress.duelWon[k] = TRUE;
        gS64Progress.anyDuelWon = TRUE;
        s64_save_dirty();
        fire(16, (s32) uid, 0, 0);
    } else if (strcmp(kind, "lost") == 0) {
        fire(16, (s32) uid, 1, 0);
    } else if (strcmp(kind, "start") == 0) {
        fire(16, (s32) uid, 2, 0);
    }
}

// (flow.c keeps the keys; the save file gets them)
void s64_page_studioKey(s32 key, u32 uid) {
    (void) key;
    (void) uid;
    s64_save_dirty();
}

void s64_page_studioWarp(s32 src, s32 level, s32 area, s32 node, s32 exitCourse) {
    (void) src; (void) level; (void) area; (void) node; (void) exitCourse;
}

// (sound effects the page replaced with its own: none in the ROM yet)
void s64_page_studioSfx(s32 id, f32 distance) {
    (void) id;
    (void) distance;
}

// interaction.c: Mario collects a star
void s64_story_star(struct Object *o) {
    fire(4, (s32) o->unused2, 0, 0);
}

// ---- captions and fades over the game (hud.c) --------------------------------------------------------
void s64_story_render(void) {
    if (sFade > 0.0f) {
        u8 alpha = (u8) (sFade * 255.0f);
        gDPPipeSync(gDisplayListHead++);
        gDPSetCycleType(gDisplayListHead++, G_CYC_1CYCLE);
        gDPSetRenderMode(gDisplayListHead++, G_RM_XLU_SURF, G_RM_XLU_SURF2);
        gDPSetCombineMode(gDisplayListHead++, G_CC_PRIMITIVE, G_CC_PRIMITIVE);
        gDPSetPrimColor(gDisplayListHead++, 0, 0, (sFadeColor >> 16) & 0xFF, (sFadeColor >> 8) & 0xFF, sFadeColor & 0xFF, alpha);
        gDPFillRectangle(gDisplayListHead++, 0, 0, SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1);
        gDPPipeSync(gDisplayListHead++);
        gDPSetRenderMode(gDisplayListHead++, G_RM_OPA_SURF, G_RM_OPA_SURF2);
        gDPSetCombineMode(gDisplayListHead++, G_CC_SHADE, G_CC_SHADE);
    }
    if (sCaption != NULL) {
        s16 w = get_string_width((u8 *) sCaption);
        gSPDisplayList(gDisplayListHead++, dl_ia_text_begin);
        gDPSetEnvColor(gDisplayListHead++, 20, 20, 20, 255);
        print_generic_string((SCREEN_WIDTH - w) / 2 + 1, 27, sCaption);
        gDPSetEnvColor(gDisplayListHead++, 255, 255, 255, 255);
        print_generic_string((SCREEN_WIDTH - w) / 2, 28, sCaption);
        gSPDisplayList(gDisplayListHead++, dl_ia_text_end);
    }
}

// ---- boot: the block from the ROM, the project's dialogs ---------------------------------------------
extern void dma_read(u8 *dest, u8 *srcStart, u8 *srcEnd);

void s64_story_init(void) {
    s32 i, n, len;
    if (!s64_info_valid() || gS64Info.storyRom == 0 || gS64Info.storySize < 16) {
        return;
    }
    sStory = malloc((gS64Info.storySize + 15) & ~15);
    if (sStory == NULL) {
        return;
    }
    dma_read(sStory, (u8 *) gS64Info.storyRom, (u8 *) gS64Info.storyRom + gS64Info.storySize);
    if (W(0) != 0x53363453) {
        sStory = NULL;
        return;
    }
    gS64Progress.vars = calloc(count_of(SEC_VARS) + 1, sizeof(s32));
    gS64Progress.done = calloc(count_of(SEC_EVENTS) + 1, 1);
    gS64Progress.off = calloc(count_of(SEC_EVENTS) + 1, 1);
    gS64Progress.objects = calloc(count_of(SEC_OBJS) + 1, 1);
    gS64Progress.locks = calloc(count_of(SEC_OBJS) + 1, 1);
    gS64Progress.duelWon = calloc(count_of(SEC_OBJS) + 1, 1);
    sFiredVisit = calloc(count_of(SEC_EVENTS) + 1, sizeof(s32));
    n = count_of(SEC_VARS);
    for (i = 0; i < n; i++) gS64Progress.vars[i] = S(sec_of(SEC_VARS) + i * 8 + 4);
    for (i = 0; i < count_of(SEC_EVENTS); i++) sFiredVisit[i] = -1;
    n = count_of(SEC_DIALOGS);
    for (i = 0; i < n; i++) {
        u32 d = sec_of(SEC_DIALOGS) + i * 28;
        const u8 *t = sStory + W(d + 24);
        for (len = 0; t[len] != 0xFF; len++) {
        }
        studio_text_dialog(S(d), t, len + 1, S(d + 4), S(d + 8), S(d + 12), S(d + 16), S(d + 20));
    }
}

// ---- the progress in the save file: bits, in the order of the block ------------------------------------
// started, the keys (32), any duel won, per event: happened, switched off; per object: shown or
// hidden, open or locked (2 bits each), duel won; per variable: a flag 1 bit, a number 16.
static void put_bits(u8 *out, s32 *at, s32 size, u32 v, s32 n) {
    while (n-- > 0) {
        if (*at < size * 8) {
            if ((v >> n) & 1) out[*at >> 3] |= 0x80 >> (*at & 7);
            else out[*at >> 3] &= ~(0x80 >> (*at & 7));
        }
        (*at)++;
    }
}

static u32 get_bits(const u8 *in, s32 *at, s32 size, s32 n) {
    u32 v = 0;
    while (n-- > 0) {
        v = (v << 1) | (*at < size * 8 ? (in[*at >> 3] >> (7 - (*at & 7))) & 1 : 0);
        (*at)++;
    }
    return v;
}

// -> the bits written (more than size * 8: the rest did not fit)
s32 s64_story_pack(u8 *out, s32 size) {
    s32 at = 0, i;
    put_bits(out, &at, size, sStory != NULL && gS64Progress.started, 1);
    put_bits(out, &at, size, studio_get_keys(), 32);
    if (sStory == NULL) return at;
    put_bits(out, &at, size, gS64Progress.anyDuelWon != 0, 1);
    for (i = 0; i < count_of(SEC_EVENTS); i++) {
        put_bits(out, &at, size, gS64Progress.done[i] != 0, 1);
        put_bits(out, &at, size, gS64Progress.off[i] != 0, 1);
    }
    for (i = 0; i < count_of(SEC_OBJS); i++) {
        put_bits(out, &at, size, gS64Progress.objects[i] & 3, 2);
        put_bits(out, &at, size, gS64Progress.locks[i] & 3, 2);
        put_bits(out, &at, size, gS64Progress.duelWon[i] != 0, 1);
    }
    for (i = 0; i < count_of(SEC_VARS); i++) {
        if (S(sec_of(SEC_VARS) + i * 8) == 0) put_bits(out, &at, size, gS64Progress.vars[i] != 0, 1);
        else put_bits(out, &at, size, (u32) gS64Progress.vars[i] & 0xFFFF, 16);
    }
    return at;
}

// in == NULL: a fresh game
void s64_story_unpack(const u8 *in, s32 size) {
    s32 at = 0, i;
    s64_story_reset();
    studio_set_keys(0);
    if (in == NULL) return;
    if (sStory != NULL) gS64Progress.started = get_bits(in, &at, size, 1);
    else get_bits(in, &at, size, 1);
    studio_set_keys(get_bits(in, &at, size, 32));
    if (sStory == NULL) return;
    gS64Progress.anyDuelWon = get_bits(in, &at, size, 1);
    for (i = 0; i < count_of(SEC_EVENTS); i++) {
        gS64Progress.done[i] = get_bits(in, &at, size, 1);
        gS64Progress.off[i] = get_bits(in, &at, size, 1);
    }
    for (i = 0; i < count_of(SEC_OBJS); i++) {
        gS64Progress.objects[i] = get_bits(in, &at, size, 2);
        gS64Progress.locks[i] = get_bits(in, &at, size, 2);
        gS64Progress.duelWon[i] = get_bits(in, &at, size, 1);
    }
    for (i = 0; i < count_of(SEC_VARS); i++) {
        if (at >= size * 8) break; // (what did not fit starts as set up)
        if (S(sec_of(SEC_VARS) + i * 8) == 0) gS64Progress.vars[i] = get_bits(in, &at, size, 1);
        else gS64Progress.vars[i] = (s16) get_bits(in, &at, size, 16);
    }
}

// the story waits for nothing (a good moment to write the save file)
s32 s64_story_idle(void) {
    return !sRun.active && !sCut.active && sQueueLen == 0;
}

// a new game (a fresh save file): the story's progress starts over
void s64_story_reset(void) {
    s32 i;
    if (sStory == NULL) return;
    for (i = 0; i < count_of(SEC_VARS); i++) gS64Progress.vars[i] = S(sec_of(SEC_VARS) + i * 8 + 4);
    bzero(gS64Progress.done, count_of(SEC_EVENTS));
    bzero(gS64Progress.off, count_of(SEC_EVENTS));
    bzero(gS64Progress.objects, count_of(SEC_OBJS));
    bzero(gS64Progress.locks, count_of(SEC_OBJS));
    bzero(gS64Progress.duelWon, count_of(SEC_OBJS));
    gS64Progress.anyDuelWon = FALSE;
    gS64Progress.started = FALSE;
    sQueueLen = 0;
    sRun.active = FALSE;
}
