// Studio 64: story support. The page's story system (web/js/story/) drives this:
//   - texts: every dialog of the game, course and act names, Peach's ending lines and the
//     credits can be replaced per project, and projects add their own dialogs (ids 256+);
//   - talking: any object the page tagged (uid) can say a project dialog chosen by the page
//     when Mario talks to it (Toads, Bob-omb Buddies, signs, Piantas, bhvStudioNpc with any
//     model), and the page hears when the talk ends (with the Yes/No answer);
//   - events: dialogs on demand, Mario frozen for cutscenes (Start skips), rewards, the HUD
//     timer, screen shakes, leaving the level, the credits, watched objects (defeated/pressed).
// Everything is set from JS between frames; nothing here survives a page reload by itself.

#include <ultra64.h>
#include <stdlib.h>
#include <string.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#define EM_ASM_INT(...) (-1)
#endif

#include "sm64.h"
#include "types.h"
#include "behavior_data.h"
#include "dialog_ids.h"
#include "seq_ids.h"
#include "audio/external.h"
#include "engine/behavior_script.h"
#include "engine/graph_node.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/game_init.h"
#include "game/ingame_menu.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/mario_actions_cutscene.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/segment2.h"
#include "game/sound_init.h"
#include "macros.h"
#include "object_fields.h"
#include "game/interaction.h"
#include "game/obj_behaviors.h"
#include "model_ids.h"
#include "game/spawn_object.h"
#include "game/save_file.h"
#include "level_table.h"
#include "studio.h"

#define o gCurrentObject
extern s16 gDialogID;
extern s8 gLastDialogResponse;

#define STORY_DIALOG_BASE 256   // project dialogs: 256, 257, ...
#define STORY_DIALOG_MAX 2048
#define STORY_DIALOG_DEFAULT 255 // what an unconfigured bhvStudioNpc says
#define STORY_MAX_WATCH 64
#define COURSE_NAMES 26
#define ACT_NAMES 97
#define ENDING_LINES 9
#define CREDITS_MAX 32
#define PLAY_MODE_NORMAL 0
#define oStudioNpcYaw OBJECT_FIELD_S32(0x1B)

// An entry the page wrote: the game's struct plus our extras.
struct StoryDialog {
    struct DialogEntry entry;
    s32 voice;     // 0 = the game's choice (originals) / silent (project dialogs), else sound index + 1
    s32 question;  // shows the Yes/No choice
    u8 *text;
};

extern s32 sDialogSpeakerVoice[];
extern struct CreditsEntry sCreditsSequence[];
extern u8 *gEndCutsceneStringsEn[];
extern s32 gStudioHideHud;

static struct StoryDialog *sOverride[DIALOG_COUNT];         // the game's dialogs, replaced
static struct StoryDialog **sCustom;                         // project dialogs
static s32 sCustomCap;
static const u8 sDefaultText[] = { 0x3F, 0x3F, 0x3F, 0xFF }; // "..."
static struct DialogEntry sDefaultEntry = { 1, 4, 95, 200, sDefaultText };

static u8 *sCourseText[COURSE_NAMES];
static const u8 *sCourseOrig[COURSE_NAMES];
static u8 *sActText[ACT_NAMES];
static const u8 *sActOrig[ACT_NAMES];
static u8 *sEndingText[ENDING_LINES];
static u8 *sEndingOrig[ENDING_LINES];
static s32 sEndingSaved;
static const char **sCreditsOrig[CREDITS_MAX];
static char *sCreditsText[CREDITS_MAX];
static const char *sCreditsLines[CREDITS_MAX][8];
static s32 sCreditsSaved;

// ---------------------------------------------------------------------------
// Texts

static u8 *copy_text(const u8 *bytes, s32 len) {
    u8 *t = malloc(len + 1);
    memcpy(t, bytes, len);
    t[len] = 0xFF;
    if (len > 0 && bytes[len - 1] == 0xFF) {
        t[len - 1] = 0xFF;
    }
    return t;
}

static void free_dialog(struct StoryDialog *d) {
    if (d != NULL) {
        free(d->text);
        free(d);
    }
}

// Replace dialog `id` (the game's 0-169, or a project dialog 256+). len < 0 removes the replacement.
EMSCRIPTEN_KEEPALIVE
s32 studio_text_dialog(s32 id, const u8 *bytes, s32 len, s32 lines, s32 left, s32 width, s32 voice, s32 question) {
    struct StoryDialog **slot = NULL;
    struct StoryDialog *d = NULL;
    if (id >= 0 && id < DIALOG_COUNT) {
        slot = &sOverride[id];
    } else if (id >= STORY_DIALOG_BASE && id < STORY_DIALOG_BASE + STORY_DIALOG_MAX) {
        s32 i = id - STORY_DIALOG_BASE;
        if (i >= sCustomCap) {
            s32 cap = sCustomCap ? sCustomCap : 64;
            while (cap <= i) {
                cap *= 2;
            }
            sCustom = realloc(sCustom, cap * sizeof(*sCustom));
            memset(sCustom + sCustomCap, 0, (cap - sCustomCap) * sizeof(*sCustom));
            sCustomCap = cap;
        }
        slot = &sCustom[i];
    } else {
        return FALSE;
    }
    // the dialog on screen keeps its text until it closes
    if (gDialogID == id && *slot != NULL) {
        return FALSE;
    }
    free_dialog(*slot);
    *slot = NULL;
    if (len < 0 || bytes == NULL) {
        return TRUE;
    }
    d = calloc(1, sizeof(*d));
    d->text = copy_text(bytes, len);
    d->entry.unused = 1;
    d->entry.linesPerBox = lines < 1 ? 1 : lines > 8 ? 8 : lines;
    d->entry.leftOffset = left;
    d->entry.width = width;
    d->entry.str = d->text;
    d->voice = voice;
    d->question = question;
    *slot = d;
    return TRUE;
}

static struct StoryDialog *story_dialog(s32 id) {
    if (id >= 0 && id < DIALOG_COUNT) {
        return sOverride[id];
    }
    if (id >= STORY_DIALOG_BASE && id - STORY_DIALOG_BASE < sCustomCap) {
        return sCustom[id - STORY_DIALOG_BASE];
    }
    return NULL;
}

// ingame_menu.c: the entry to show for gDialogID (NULL: none).
struct DialogEntry *studio_dialog_entry(s16 id) {
    struct StoryDialog *d = story_dialog(id);
    if (d != NULL) {
        return &d->entry;
    }
    if (id >= 0 && id < DIALOG_COUNT) {
        void **table = segmented_to_virtual(seg2_dialog_table);
        return segmented_to_virtual(table[id]);
    }
    if (id == STORY_DIALOG_DEFAULT) {
        return &sDefaultEntry;
    }
    return NULL;
}

// ingame_menu.c: the dialog box opens. TRUE when the voice was handled here.
s32 studio_dialog_sound(s16 id) {
    struct StoryDialog *d = story_dialog(id);
    if (d != NULL && d->voice > 0) {
        play_sound(sDialogSpeakerVoice[(d->voice - 1) % 11], gDefaultSoundArgs);
        return TRUE;
    }
    return id >= DIALOG_COUNT;
}

static void set_table_text(void **table, s32 i, u8 **mine, const u8 **orig, const u8 *bytes, s32 len) {
    if (orig[i] == NULL) {
        orig[i] = table[i];
    }
    free(mine[i]);
    mine[i] = NULL;
    if (len < 0 || bytes == NULL) {
        table[i] = (void *) orig[i];
        return;
    }
    mine[i] = copy_text(bytes, len);
    table[i] = mine[i];
}

// Course names keep the game's 3-character number prefix (" 1 ", "   ").
EMSCRIPTEN_KEEPALIVE
void studio_text_course(s32 index, const u8 *bytes, s32 len) {
    if (index >= 0 && index < COURSE_NAMES) {
        set_table_text(segmented_to_virtual(seg2_course_name_table), index, sCourseText, sCourseOrig, bytes, len);
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_text_act(s32 index, const u8 *bytes, s32 len) {
    if (index >= 0 && index < ACT_NAMES) {
        set_table_text(segmented_to_virtual(seg2_act_name_table), index, sActText, sActOrig, bytes, len);
    }
}

// Peach's lines in the ending.
EMSCRIPTEN_KEEPALIVE
void studio_text_ending(s32 index, const u8 *bytes, s32 len) {
    if (index < 0 || index >= ENDING_LINES) {
        return;
    }
    if (!sEndingSaved) {
        memcpy(sEndingOrig, gEndCutsceneStringsEn, sizeof(sEndingOrig));
        sEndingSaved = TRUE;
    }
    free(sEndingText[index]);
    sEndingText[index] = NULL;
    if (len < 0 || bytes == NULL) {
        gEndCutsceneStringsEn[index] = sEndingOrig[index];
        return;
    }
    sEndingText[index] = copy_text(bytes, len);
    gEndCutsceneStringsEn[index] = sEndingText[index];
}

// One credits page: "<layout digit><title>\n<line>\n<line>..." in plain ASCII (the credits font
// knows A-Z, '.', 3, 4, 6), "" for a page without text, NULL for the game's own page.
EMSCRIPTEN_KEEPALIVE
void studio_text_credits(s32 index, const char *text) {
    s32 n = 0;
    char *p;
    if (index < 0 || index >= CREDITS_MAX || sCreditsSequence[index].levelNum == LEVEL_NONE) {
        return;
    }
    if (!sCreditsSaved) {
        s32 i;
        for (i = 0; i < CREDITS_MAX && sCreditsSequence[i].levelNum != LEVEL_NONE; i++) {
            sCreditsOrig[i] = sCreditsSequence[i].unk0C;
        }
        sCreditsSaved = TRUE;
    }
    free(sCreditsText[index]);
    sCreditsText[index] = NULL;
    if (text == NULL) {
        sCreditsSequence[index].unk0C = sCreditsOrig[index];
        return;
    }
    if (text[0] == '\0') {
        sCreditsSequence[index].unk0C = NULL;
        return;
    }
    sCreditsText[index] = strdup(text);
    for (p = sCreditsText[index]; p != NULL && n < 7;) {
        char *nl = strchr(p, '\n');
        sCreditsLines[index][n++] = p;
        if (nl != NULL) {
            *nl = '\0';
            p = nl + 1;
        } else {
            p = NULL;
        }
    }
    while (n < 8) {
        sCreditsLines[index][n++] = "";
    }
    sCreditsSequence[index].unk0C = sCreditsLines[index];
}

// Everything back to the game's own texts (another project was opened).
EMSCRIPTEN_KEEPALIVE
void studio_text_reset(void) {
    s32 i;
    for (i = 0; i < DIALOG_COUNT; i++) {
        if (gDialogID != i) {
            free_dialog(sOverride[i]);
            sOverride[i] = NULL;
        }
    }
    for (i = 0; i < sCustomCap; i++) {
        if (gDialogID != STORY_DIALOG_BASE + i) {
            free_dialog(sCustom[i]);
            sCustom[i] = NULL;
        }
    }
    for (i = 0; i < COURSE_NAMES; i++) {
        if (sCourseOrig[i] != NULL) {
            studio_text_course(i, NULL, -1);
        }
    }
    for (i = 0; i < ACT_NAMES; i++) {
        if (sActOrig[i] != NULL) {
            studio_text_act(i, NULL, -1);
        }
    }
    for (i = 0; i < ENDING_LINES; i++) {
        studio_text_ending(i, NULL, -1);
    }
    for (i = 0; i < CREDITS_MAX && sCreditsSaved && sCreditsSequence[i].levelNum != LEVEL_NONE; i++) {
        studio_text_credits(i, NULL);
    }
}

// ---------------------------------------------------------------------------
// Talking: who Mario talks to, which dialog the page wants them to say

static s32 sForcedDialog = -1;  // a dialog the page opened itself: never redirected
static s32 sTalkUid;            // the tagged object Mario is talking to
static s32 sTalkDialog;
static s32 sTalkResponse;

// Who is talking: the focus of the talk cutscene (NPCs), the sign Mario reads, or the object whose
// behavior opens the box right now.
static struct Object *story_talker(void) {
    struct MarioState *m = gMarioState;
    if (gMarioObject == NULL) {
        return NULL;
    }
    if (gCamera != NULL && gCamera->cutscene != 0 && gCutsceneFocus != NULL && gCutsceneFocus != gMarioObject
        && (m->action == ACT_READING_NPC_DIALOG || m->action == ACT_WAITING_FOR_DIALOG)) {
        return gCutsceneFocus;
    }
    if (m->action == ACT_READING_NPC_DIALOG || m->action == ACT_READING_SIGN
        || m->action == ACT_WAITING_FOR_DIALOG) {
        return m->usedObj;
    }
    if (gCurrentObject != NULL && gCurrentObject != gMarioObject && gCurrentObject->unused2 != 0
        && gCurrentObject->activeFlags != ACTIVE_FLAG_DEACTIVATED && gCurrentObject->oDistanceToMario < 1500.0f) {
        return gCurrentObject;
    }
    return NULL;
}

// ingame_menu.c: a dialog box is about to open with `dialog`. Returns the dialog to show.
s16 studio_dialog_redirect(s16 dialog) {
    struct Object *o;
    s32 uid, want = -1;
    struct StoryDialog *d;
    if (sForcedDialog == dialog) {
        sForcedDialog = -1;
    } else if ((o = story_talker()) != NULL && o->unused2 != 0 && o->activeFlags != ACTIVE_FLAG_DEACTIVATED) {
        uid = (s32) o->unused2;
#ifdef TARGET_WEB
        want = EM_ASM_INT({
            return Module.studioNpcDialog ? (Module.studioNpcDialog($0, $1) | 0) : -1;
        }, uid, dialog);
#endif
        if (want >= 0) {
            dialog = want;
        } else if (o->behavior == segmented_to_virtual(bhvStudioNpc)) {
            dialog = STORY_DIALOG_DEFAULT;
        }
        sTalkUid = uid;
        sTalkDialog = dialog;
        sTalkResponse = 0;
    }
    d = story_dialog(dialog);
    if (d != NULL && d->question) {
        gLastDialogResponse = 1;
    }
    return dialog;
}

// ---------------------------------------------------------------------------
// Events from the page: dialogs, cutscene lock, rewards

static s32 sQueuedDialog = -1;
static s32 sQueueWait;
static s32 sLockWanted, sLocked, sLockWait, sLockHud;
static s32 sLastResponse;
s32 gStudioStoryLock;   // level_update.c: Start skips instead of pausing
s32 gStudioStoryGrace;  // level_update.c: frames after a cutscene in which Start does not pause
s32 gStudioStorySkip;

// Opens dialog `id` as soon as Mario can listen (it waits while he is in the air or busy).
EMSCRIPTEN_KEEPALIVE
void studio_story_dialog(s32 id) {
    sQueuedDialog = id;
    sQueueWait = 0;
    sLastResponse = 0;
}

// 1 while a dialog the page asked for is waiting or any dialog is open.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_dialog_busy(void) {
    if (sQueuedDialog >= 0 || gDialogID >= 0) {
        return 1;
    }
    return gMarioObject != NULL && gMarioState->action == ACT_READING_AUTOMATIC_DIALOG;
}

// The Yes/No answer of the last dialog that closed (1 = first choice, 2 = second, 0 = none).
EMSCRIPTEN_KEEPALIVE
s32 studio_story_response(void) {
    return sLastResponse;
}

// Freeze Mario for a cutscene (on = 1), hiding the HUD if hud = 0. Start then skips.
EMSCRIPTEN_KEEPALIVE
void studio_story_lock(s32 on, s32 hud) {
    struct MarioState *m = gMarioState;
    if (on) {
        sLockWanted = TRUE;
        sLockWait = 0;
        sLockHud = !hud;
        gStudioStoryLock = TRUE;
        gStudioStorySkip = FALSE;
        return;
    }
    if (sLocked && gMarioObject != NULL && m->action == ACT_WAITING_FOR_DIALOG && gDialogID < 0) {
        set_mario_action(m, (m->pos[1] > m->floorHeight + 4.0f) ? ACT_FREEFALL : ACT_IDLE, 0);
    }
    if (sLockHud) {
        gStudioHideHud = FALSE;
    }
    if (gStudioStoryLock) {
        gStudioStoryGrace = 20;
    }
    sLockWanted = sLocked = sLockHud = FALSE;
    gStudioStoryLock = FALSE;
    gStudioStorySkip = FALSE;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_story_locked(void) {
    return sLocked;
}

// Start was pressed during the cutscene (read once).
EMSCRIPTEN_KEEPALIVE
s32 studio_story_skip(void) {
    s32 s = gStudioStorySkip;
    gStudioStorySkip = FALSE;
    return s;
}

// kind: 0 coins, 1 lives, 2 health (wedges, 8 = full), 3 wing cap, 4 metal cap, 5 vanish cap, 6 red coins
EMSCRIPTEN_KEEPALIVE
void studio_story_give(s32 kind, s32 amount) {
    struct MarioState *m = gMarioState;
    u32 cap = 0;
    u16 time = 0, music = 0;
    if (gMarioObject == NULL) {
        return;
    }
    switch (kind) {
        case 0:
            m->numCoins = MAX(0, MIN(999, m->numCoins + amount));
            gHudDisplay.coins = m->numCoins;
            play_sound(amount >= 0 ? SOUND_GENERAL_COIN : SOUND_MENU_CAMERA_BUZZ, gDefaultSoundArgs);
            break;
        case 1:
            m->numLives = MAX(0, MIN(99, m->numLives + amount));
            play_sound(amount >= 0 ? SOUND_GENERAL_COLLECT_1UP : SOUND_MENU_CAMERA_BUZZ, gDefaultSoundArgs);
            break;
        case 2:
            m->health = MAX(0x100, MIN(0x880, m->health + amount * 0x100));
            if (amount > 0) {
                m->healCounter = 0;
                play_sound(SOUND_MENU_POWER_METER, gDefaultSoundArgs);
            }
            break;
        case 3: cap = MARIO_WING_CAP; time = 1800; music = SEQUENCE_ARGS(4, SEQ_EVENT_POWERUP); break;
        case 4: cap = MARIO_METAL_CAP; time = 600; music = SEQUENCE_ARGS(4, SEQ_EVENT_METAL_CAP); break;
        case 5: cap = MARIO_VANISH_CAP; time = 600; music = SEQUENCE_ARGS(4, SEQ_EVENT_POWERUP); break;
        case 6:
            gRedCoinsCollected = MAX(0, MIN(8, gRedCoinsCollected + amount));
            break;
    }
    if (cap != 0) {
        if (amount > 0) {
            time = amount * 30;
        }
        m->flags &= ~(MARIO_CAP_IN_HAND | MARIO_WING_CAP | MARIO_METAL_CAP | MARIO_VANISH_CAP);
        m->flags |= cap | MARIO_CAP_ON_HEAD;
        if (time > m->capTimer) {
            m->capTimer = time;
        }
        play_sound(SOUND_MENU_STAR_SOUND, gDefaultSoundArgs);
        play_sound(SOUND_MARIO_HERE_WE_GO, m->marioObj->header.gfx.cameraToObject);
        play_cap_music(music);
    }
}

// What Mario wears: 1 wing, 2 metal, 4 vanish.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_caps(void) {
    u32 f = gMarioObject != NULL ? gMarioState->flags : 0;
    return ((f & MARIO_WING_CAP) ? 1 : 0) | ((f & MARIO_METAL_CAP) ? 2 : 0) | ((f & MARIO_VANISH_CAP) ? 4 : 0);
}

EMSCRIPTEN_KEEPALIVE
s32 studio_story_red_coins(void) {
    return gRedCoinsCollected;
}

// op: 0 hide, 1 show from zero and run, 2 stop, 3 run again. Returns the time in frames.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_timer(s32 op) {
    switch (op) {
        case 0: level_control_timer(TIMER_CONTROL_HIDE); break;
        case 1: level_control_timer(TIMER_CONTROL_SHOW); level_control_timer(TIMER_CONTROL_START); break;
        case 2: level_control_timer(TIMER_CONTROL_STOP); break;
        case 3: level_control_timer(TIMER_CONTROL_START); break;
    }
    return gHudDisplay.timer;
}

EMSCRIPTEN_KEEPALIVE
void studio_story_shake(s32 strength) {
    set_environmental_camera_shake(strength >= 2 ? SHAKE_ENV_BOWSER_JUMP : SHAKE_ENV_EXPLOSION);
}

// 0: leave the level (back where it was entered from, like Exit Course), 1: the ending and credits
EMSCRIPTEN_KEEPALIVE
void studio_story_exit(s32 kind) {
    if (gMarioObject == NULL) {
        return;
    }
    studio_story_lock(0, 1);
    level_trigger_warp(gMarioState, kind == 1 ? WARP_OP_CREDITS_START : WARP_OP_STAR_EXIT);
}

// Show (1) or hide (0) the object tagged `uid`, without changing it.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_set_visible(s32 uid, s32 visible) {
    s32 i, n = 0;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if (obj->activeFlags != ACTIVE_FLAG_DEACTIVATED && obj->unused2 == (u32) uid) {
            if (visible) {
                obj->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
            } else {
                obj->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
            }
            n++;
        }
    }
    return n;
}

// A puff of smoke where something appeared or vanished.
EMSCRIPTEN_KEEPALIVE
void studio_story_puff(f32 x, f32 y, f32 z) {
    struct Object *p;
    if (gMarioObject == NULL) {
        return;
    }
    p = spawn_object_abs_with_rot(gMarioObject, 0, MODEL_NONE, bhvMistCircParticleSpawner, (s16) x, (s16) y, (s16) z, 0, 0, 0);
    if (p != NULL) {
        p->unused2 = 0;
    }
}

// Close the dialog on screen (a skipped cutscene).
EMSCRIPTEN_KEEPALIVE
void studio_story_close_dialog(void) {
    sQueuedDialog = -1;
    if (gDialogID >= 0) {
        reset_dialog_render_state();
    }
}

// The save file being played (1-4): story progress is kept per file.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_file(void) {
    return gCurrSaveFileNum > 0 ? gCurrSaveFileNum : 1;
}

// ---------------------------------------------------------------------------
// Watched objects: the page hears when one is gone (defeated, collected) or changes its action
// (a switch pressed, a box opened).

struct StoryWatch {
    s32 uid;
    s32 kind; // 0 gone, 1 action changed
    s32 seen;
    s32 action;
    s32 fired;
};
static struct StoryWatch sWatch[STORY_MAX_WATCH];
static s32 sWatchCount;

EMSCRIPTEN_KEEPALIVE
void studio_story_watch(s32 uid, s32 kind) {
    if (sWatchCount < STORY_MAX_WATCH && uid != 0) {
        struct StoryWatch *w = &sWatch[sWatchCount++];
        memset(w, 0, sizeof(*w));
        w->uid = uid;
        w->kind = kind;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_story_watch_clear(void) {
    sWatchCount = 0;
}

static struct Object *find_uid(s32 uid) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if (obj->activeFlags != ACTIVE_FLAG_DEACTIVATED && obj->unused2 == (u32) uid) {
            return obj;
        }
    }
    return NULL;
}

static void story_event(s32 kind, s32 a, s32 b, s32 c) {
    EM_ASM({
        if (Module.studioStoryEvent) Module.studioStoryEvent($0, $1, $2, $3);
    }, kind, a, b, c);
}

static void watch_frame(void) {
    s32 i;
    if (gCurrentArea == NULL || sCurrPlayMode != PLAY_MODE_NORMAL) {
        return;
    }
    for (i = 0; i < sWatchCount; i++) {
        struct StoryWatch *w = &sWatch[i];
        struct Object *obj;
        if (w->fired) {
            continue;
        }
        obj = find_uid(w->uid);
        if (obj != NULL && !w->seen) {
            w->seen = TRUE;
            w->action = obj->oAction;
        }
        if (w->kind == 0 && w->seen && obj == NULL) {
            w->fired = TRUE;
            story_event(2, w->uid, 0, 0);
        } else if (w->kind == 1 && obj != NULL && obj->oAction != w->action) {
            w->fired = TRUE;
            story_event(2, w->uid, 1, obj->oAction);
        }
    }
}

// ---------------------------------------------------------------------------
// Every frame (before the game's own update)

void studio_story_frame(void) {
    struct MarioState *m = gMarioState;
    if (gMarioObject == NULL || gCurrentArea == NULL) {
        return;
    }
    if (gDialogResponse != 0 && gLastDialogResponse) { // only questions have an answer
        sLastResponse = gDialogResponse;
        if (sTalkUid) {
            sTalkResponse = gDialogResponse;
        }
    }
    // the cutscene lock waits until Mario stands somewhere
    if (sLockWanted && !sLocked) {
        if (m->action == ACT_WAITING_FOR_DIALOG || ((m->action & ACT_FLAG_AIR) == 0
                                                    && m->action != ACT_READING_AUTOMATIC_DIALOG
                                                    && m->action != ACT_READING_NPC_DIALOG
                                                    && m->action != ACT_READING_SIGN)
            || ++sLockWait > 120) {
            if (gDialogID < 0 || m->action == ACT_WAITING_FOR_DIALOG) {
                set_mario_action(m, ACT_WAITING_FOR_DIALOG, 0);
                mario_set_forward_vel(m, 0.0f);
                sLocked = TRUE;
            }
        }
    }
    // Start skips (also caught in pressed_pause(), which some states never reach)
    if (gStudioStoryLock && gPlayer1Controller != NULL && (gPlayer1Controller->buttonPressed & START_BUTTON)) {
        gStudioStorySkip = TRUE;
    }
    if (sLocked) {
        if (m->action != ACT_WAITING_FOR_DIALOG && (m->action & ACT_FLAG_INTANGIBLE) == 0) {
            set_mario_action(m, ACT_WAITING_FOR_DIALOG, 0); // something knocked him out of it
        }
        if (sLockHud) {
            gStudioHideHud = TRUE;
        }
    }
    // a dialog the page asked for
    if (sQueuedDialog >= 0 && gDialogID < 0 && sCurrPlayMode == PLAY_MODE_NORMAL) {
        if (sLocked) {
            sForcedDialog = sQueuedDialog;
            create_dialog_box(sQueuedDialog);
            sQueuedDialog = -1;
        } else if (mario_ready_to_speak() && (m->action & ACT_FLAG_AIR) == 0) {
            sForcedDialog = sQueuedDialog;
            set_mario_action(m, ACT_READING_AUTOMATIC_DIALOG, sQueuedDialog);
            sQueuedDialog = -1;
        } else if (++sQueueWait > 600) {
            sQueuedDialog = -1; // he never stood still: give up rather than freeze later
        }
    }
    // a talk ended
    if (sTalkUid && gDialogID < 0 && m->action != ACT_READING_NPC_DIALOG && m->action != ACT_READING_SIGN) {
        s32 uid = sTalkUid;
        sTalkUid = 0;
        story_event(1, uid, sTalkResponse, sTalkDialog);
    }
    watch_frame();
}

// Why a queued dialog waits (tests): bits 0 dialog open, 1 warp, 2 not playing, 3 Mario ready, 4 in the air, 5 queued.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_debug(void) {
    struct MarioState *m = gMarioState;
    return (gDialogID >= 0) | (gWarpTransition.isActive ? 2 : 0) | (sCurrPlayMode != PLAY_MODE_NORMAL ? 4 : 0)
         | (gMarioObject != NULL && mario_ready_to_speak() ? 8 : 0) | (gMarioObject != NULL && (m->action & ACT_FLAG_AIR) ? 16 : 0)
         | (sQueuedDialog >= 0 ? 32 : 0) | (gStudioStoryLock ? 64 : 0) | (gStudioStorySkip ? 128 : 0) | (gPlayer1Controller != NULL && (gPlayer1Controller->buttonDown & START_BUTTON) ? 0x40000000 : 0) | ((gDialogID + 1) << 8);
}

s32 studio_teleport(f32 x, f32 y, f32 z, s32 yaw);

// The game's own opening in the castle grounds: Peach's letter (dialog 20), Lakitu, the pipe.
EMSCRIPTEN_KEEPALIVE
s32 studio_story_intro(void) {
    if (gMarioObject == NULL || gCurrLevelNum != LEVEL_CASTLE_GROUNDS || gCurrentArea == NULL || gCurrentArea->index != 1) {
        return FALSE;
    }
    // where a new game starts (the castle grounds' MARIO_POS): the pipe comes up here
    studio_teleport(-1328.0f, 260.0f, 4664.0f, 0x8000);
    set_mario_action(gMarioState, ACT_INTRO_CUTSCENE, 0);
    if (gCamera != NULL) {
        start_cutscene(gCamera, CUTSCENE_INTRO_PEACH); // the camera part (the letter, Lakitu)
    }
    sound_banks_disable(2, 0x0330);
    play_transition(WARP_TRANSITION_FADE_FROM_COLOR, 0x5A, 0xFF, 0xFF, 0xFF);
    return TRUE;
}

// The controller's buttons held this frame (tests).
EMSCRIPTEN_KEEPALIVE
s32 studio_story_buttons(void) {
    return gPlayer1Controller != NULL ? gPlayer1Controller->buttonDown : -1;
}

// A new area: nothing pending survives it.
void studio_story_area(void) {
    sQueuedDialog = -1;
    sTalkUid = 0;
    sWatchCount = 0;
    if (sLockWanted) {
        studio_story_lock(0, 1);
    }
}

// ---------------------------------------------------------------------------
// bhvStudioNpc: any model that talks. bparams: 2nd byte animation set, 3rd byte animation.

extern const struct Animation *const toad_seg6_anims_0600FB58[];
extern const struct Animation *const bobomb_seg8_anims_0802396C[];
extern const struct Animation *const koopa_seg6_anims_06011364[];
extern const struct Animation *const goomba_seg8_anims_0801DA4C[];
extern const struct Animation *const penguin_seg5_anims_05008B74[];
extern const struct Animation *const ukiki_seg5_anims_05015784[];
extern const struct Animation *const yoshi_seg5_anims_05024100[];
extern const struct Animation *const peach_seg5_anims_0501C41C[];
extern const struct Animation *const chuckya_seg8_anims_0800C070[];

void bhv_studio_npc_init(void) {
    const struct Animation *const *anims[] = {
        NULL, toad_seg6_anims_0600FB58, bobomb_seg8_anims_0802396C, koopa_seg6_anims_06011364,
        goomba_seg8_anims_0801DA4C, penguin_seg5_anims_05008B74, ukiki_seg5_anims_05015784,
        yoshi_seg5_anims_05024100, peach_seg5_anims_0501C41C, chuckya_seg8_anims_0800C070,
    };
    s32 set = (o->oBehParams >> 16) & 0xFF, anim = (o->oBehParams >> 8) & 0xFF;
    if (set > 0 && set < (s32) ARRAY_COUNT(anims)) {
        o->oAnimations = (struct Animation **) anims[set];
        cur_obj_init_animation(anim);
    }
    o->oInteractionSubtype = INT_SUBTYPE_NPC;
    o->oOpacity = 255; // models like Toad's fade with it
    o->oStudioNpcYaw = (s16) o->oMoveAngleYaw; // the facing it was placed with
    o->oAction = 0;
}

void bhv_studio_npc_loop(void) {
    o->oInteractionSubtype = INT_SUBTYPE_NPC;
    switch (o->oAction) {
        case 0:
            if (o->oDistanceToMario < 600.0f) {
                cur_obj_rotate_yaw_toward(o->oAngleToMario, 0x300);
            } else {
                cur_obj_rotate_yaw_toward((s16) o->oStudioNpcYaw, 0x200);
            }
            if (o->oInteractStatus & INT_STATUS_INTERACTED) {
                o->oAction = 1;
            }
            break;
        case 1:
            if (cur_obj_update_dialog_with_cutscene(1, DIALOG_UNK2_FLAG_0, CUTSCENE_DIALOG, DIALOG_000)) {
                o->oInteractStatus = 0;
                o->oAction = 0;
            }
            break;
    }
    o->oFaceAngleYaw = o->oMoveAngleYaw;
}
