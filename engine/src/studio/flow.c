// Studio 64 world flow and environment: where warps lead (the page decides for
// custom levels, which share one level slot), door locks (stars, keys, events) and
// their messages, trigger zones (warp, death, camera), paintings you jump into,
// keys, and the environment of an area (fog, tint, weather, water/gas boxes,
// death height, camera mode, ambient sound).

#include <ultra64.h>
#include <stdio.h>
#include <stdlib.h>
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
#include "macros.h"
#include "object_fields.h"
#include "behavior_data.h"
#include "audio_defines.h"
#include "dialog_ids.h"
#include "level_table.h"
#include "engine/graph_node.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "game/area.h"
#include "game/camera.h"
#include "game/level_update.h"
#include "game/level_geo.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/ingame_menu.h"
#include "game/segment2.h"
#include "game/game_init.h"
#include "game/rendering_graph_node.h"
#include "game/paintings.h"
#include "game/mario.h"
#include "game/envfx_snow.h"
#include "game/memory.h"
#include "engine/behavior_script.h"
#include "model_ids.h"
#include "audio/external.h"
#include "studio.h"

extern s32 gStudioForceReload;
extern s32 gStudioPaused;
s32 set_camera_mode_fixed(struct Camera *c, s16 x, s16 y, s16 z);

// ---------------------------------------------------------------------------
// Where a warp leads. Every warp asks the page first (Module.studioWarp): custom
// levels all live in LEVEL_STUDIO, so only the page knows which one a door opens
// into, and a hack without the castle sends deaths and exits to its own hub.

s32 gStudioExitCourse;   // set right before "Exit course" starts its warp
s32 gStudioIsHub;        // the current level is the hack's hub: it pauses like the castle
static s32 sRedirect, sRedirLevel, sRedirArea, sRedirNode, sRedirForce, sRedirIntro;

EMSCRIPTEN_KEEPALIVE
void studio_warp_redirect(s32 level, s32 area, s32 node, s32 force, s32 intro) {
    sRedirect = TRUE;
    sRedirLevel = level;
    sRedirArea = area;
    sRedirNode = node;
    sRedirForce = force;
    sRedirIntro = intro;
}

EMSCRIPTEN_KEEPALIVE
void studio_set_hub(s32 on) {
    gStudioIsHub = on;
}

void studio_warp_hook(s16 *level, s16 *area, s16 *node, s32 src) {
    s32 exitCourse = gStudioExitCourse;
    gStudioExitCourse = FALSE;
    sRedirect = FALSE;
    EM_ASM({
        if (Module.studioWarp) Module.studioWarp($0, $1, $2, $3, $4);
    }, src, *level, *area, *node, exitCourse);
    if (sRedirect) {
        sRedirect = FALSE;
        *level = (s16) sRedirLevel;
        *area = (s16) sRedirArea;
        *node = (s16) sRedirNode;
        if (sRedirForce) {
            gStudioForceReload = TRUE;
        }
        if (sRedirIntro >= 0) {
            gStudioIntroMode = sRedirIntro;
        }
    }
}

// ---------------------------------------------------------------------------
// Messages in the game's dialog box, through a borrowed dialog slot (the door one).

#define MSG_SLOT DIALOG_022
static u8 sMsgText[512];
static struct DialogEntry sMsgDialog = { 1, 4, 95, 200, sMsgText };
static void *sMsgBackup;
static s32 sMsgFrames;

static void msg_encode(const char *s) {
    s32 n = 0, lines = 1;
    for (; *s != '\0' && n < (s32) sizeof(sMsgText) - 2; s++) {
        u8 c = (u8) *s, out = 0x9E;
        if (c >= '0' && c <= '9') out = c - '0';
        else if (c >= 'A' && c <= 'Z') out = c - 'A' + 0x0A;
        else if (c >= 'a' && c <= 'z') out = c - 'a' + 0x24;
        else if (c == '\n') { out = 0xFE; lines++; }
        else if (c == '\'') out = 0x3E;
        else if (c == '.') out = 0x3F;
        else if (c == ',') out = 0x6F;
        else if (c == '-') out = 0x9F;
        else if (c == '!') out = 0xF2;
        else if (c == '?') out = 0xF4;
        else if (c == ':') out = 0xE6;
        else if (c == '(') out = 0xE1;
        else if (c == ')') out = 0xE3;
        else if (c == '&') out = 0xE5;
        else if (c == '*') out = 0xFA; // the star symbol
        sMsgText[n++] = out;
    }
    sMsgText[n] = 0xFF;
    sMsgDialog.linesPerBox = lines < 4 ? (lines < 2 ? 2 : lines) : 4;
}

static void msg_borrow(const char *text) {
    msg_encode(text);
    if (sMsgBackup == NULL) {
        sMsgBackup = seg2_dialog_table[MSG_SLOT];
    }
    seg2_dialog_table[MSG_SLOT] = &sMsgDialog;
    sMsgFrames = 0;
}

static void msg_tick(void) {
    if (sMsgBackup != NULL && ++sMsgFrames > 4 && get_dialog_id() != MSG_SLOT
        && (gMarioState == NULL || gMarioState->action != ACT_READING_AUTOMATIC_DIALOG)) {
        seg2_dialog_table[MSG_SLOT] = sMsgBackup;
        sMsgBackup = NULL;
    }
}

// A message box for Mario to read (the page: goals reached, signs, locked things).
// It waits until Mario stands still somewhere (not mid-jump, not in a cutscene).
static char sPendingMsg[400];
static s32 sPendingWait;

EMSCRIPTEN_KEEPALIVE
void studio_show_message(const char *text) {
    snprintf(sPendingMsg, sizeof(sPendingMsg), "%s", text);
    sPendingWait = 0;
}

static void pending_msg_tick(struct MarioState *m) {
    if (sPendingMsg[0] == '\0' || get_dialog_id() >= 0) {
        return;
    }
    if (!(m->action & (ACT_FLAG_AIR | ACT_FLAG_INTANGIBLE)) || ++sPendingWait > 300) {
        msg_borrow(sPendingMsg);
        sPendingMsg[0] = '\0';
        if (!(m->action & (ACT_FLAG_AIR | ACT_FLAG_INTANGIBLE | ACT_FLAG_SWIMMING))) {
            set_mario_action(m, ACT_READING_AUTOMATIC_DIALOG, MSG_SLOT);
        } else {
            create_dialog_box(MSG_SLOT);
        }
    }
}

// ---------------------------------------------------------------------------
// Locks on doors, pipes, paintings and warp zones (by studio uid): a number of
// stars, a key, or locked until an event opens it.

#define MAX_LOCKS 192
struct StudioLock {
    u32 uid;
    s16 stars;
    s16 key;   // -1: none
    s32 locked;
};
static struct StudioLock sLocks[MAX_LOCKS];
static s32 sLockCount;
static u32 sKeys;          // keys the player holds (bit per key)
static u32 sMsgUid;
static u32 sMsgFrame;

EMSCRIPTEN_KEEPALIVE
void studio_locks_reset(void) {
    sLockCount = 0;
}

static struct StudioLock *lock_of(u32 uid) {
    s32 i;
    if (uid == 0) {
        return NULL;
    }
    for (i = 0; i < sLockCount; i++) {
        if (sLocks[i].uid == uid) {
            return &sLocks[i];
        }
    }
    return NULL;
}

EMSCRIPTEN_KEEPALIVE
void studio_lock_set(u32 uid, s32 stars, s32 key, s32 locked) {
    struct StudioLock *l = lock_of(uid);
    if (l == NULL) {
        if (sLockCount >= MAX_LOCKS) {
            return;
        }
        l = &sLocks[sLockCount++];
        l->uid = uid;
    }
    l->stars = stars;
    l->key = key;
    l->locked = locked;
}

EMSCRIPTEN_KEEPALIVE
void studio_set_keys(u32 mask) {
    sKeys = mask;
}

EMSCRIPTEN_KEEPALIVE
u32 studio_get_keys(void) {
    return sKeys;
}

// Why `uid` won't open right now (a message), or NULL when it opens.
static const char *lock_reason(u32 uid, char *buf, s32 size) {
    struct StudioLock *l = lock_of(uid);
    s32 have = gMarioState != NULL ? gMarioState->numStars : 0;
    if (l == NULL) {
        return NULL;
    }
    if (l->locked) {
        return "It's locked.\nIt won't budge.";
    }
    if (l->key >= 0 && !(sKeys & (1u << (l->key & 31)))) {
        return sKeys ? "This key doesn't fit!\nYou need another key\nto open this door." : "You need a key to open\nthis door.";
    }
    if (l->stars > 0 && have < l->stars) {
        s32 more = l->stars - have;
        snprintf(buf, size, "It takes the power of\n%d Star%s to open this.\nYou need %d more\nStar%s.", l->stars,
                 l->stars == 1 ? "" : "s", more, more == 1 ? "" : "s");
        return buf;
    }
    return NULL;
}

// Opening needed its key for the first time: the page remembers the door as unlocked.
static void lock_opened(u32 uid) {
    struct StudioLock *l = lock_of(uid);
    if (l != NULL && l->key >= 0) {
        l->key = -1;
        play_sound(SOUND_GENERAL_DOOR_INSERT_KEY, gDefaultSoundArgs);
        EM_ASM({ if (Module.studioUnlocked) Module.studioUnlocked($0 >>> 0); }, uid);
    }
}

// Called by the door and warp interactions: TRUE when the lock holds (Mario reads why).
s32 studio_door_check(struct MarioState *m, struct Object *obj, u32 *ret) {
    char buf[160];
    const char *why;
    u32 uid = obj->unused2;
    if (lock_of(uid) == NULL) {
        return FALSE;
    }
    why = lock_reason(uid, buf, sizeof(buf));
    if (why == NULL) {
        lock_opened(uid);
        return FALSE;
    }
    *ret = FALSE;
    // once per approach: again only after Mario walked away from it
    if (sMsgUid != uid || gGlobalTimer - sMsgFrame > 45) {
        if (m->action == ACT_WALKING || m->action == ACT_DECELERATING || m->action == ACT_IDLE
            || !(m->action & (ACT_FLAG_AIR | ACT_FLAG_INTANGIBLE))) {
            msg_borrow(why);
            set_mario_action(m, ACT_READING_AUTOMATIC_DIALOG, MSG_SLOT);
        } else {
            msg_borrow(why);
            create_dialog_box(MSG_SLOT);
        }
    }
    sMsgUid = uid;
    sMsgFrame = gGlobalTimer;
    return TRUE;
}

// ---------------------------------------------------------------------------
// Trigger zones: boxes (center, half size, yaw) from the page.

#define MAX_ZONES 128
enum { ZONE_WARP = 1, ZONE_DEATH = 2, ZONE_CAMERA = 3 };
struct StudioZone {
    u32 uid;
    s32 kind;
    f32 c[3], h[3];
    s16 yaw;
    s32 a, b;          // warp: node, transition; camera: mode, distance
    f32 p[3];          // warp: instant offset; camera: fixed position / axis
    s32 inside;
};
static struct StudioZone sZones[MAX_ZONES];
static s32 sZoneCount;
static s32 sZoneCam = -1;    // the camera zone Mario is in

static s32 zone_contains(struct StudioZone *z, f32 x, f32 y, f32 z0) {
    f32 dx = x - z->c[0], dy = y - z->c[1], dz = z0 - z->c[2];
    f32 s = sins(-z->yaw), co = coss(-z->yaw);
    f32 lx = dx * co + dz * s, lz = -dx * s + dz * co;
    return fabsf(lx) <= z->h[0] && fabsf(dy) <= z->h[1] && fabsf(lz) <= z->h[2];
}

EMSCRIPTEN_KEEPALIVE
void studio_zones_reset(void) {
    sZoneCount = 0;
    sZoneCam = -1;
}

EMSCRIPTEN_KEEPALIVE
void studio_zone_add(s32 kind, u32 uid, f32 cx, f32 cy, f32 cz, f32 hx, f32 hy, f32 hz, s32 yaw, s32 a, s32 b,
                     f32 px, f32 py, f32 pz) {
    struct StudioZone *z;
    if (sZoneCount >= MAX_ZONES) {
        return;
    }
    z = &sZones[sZoneCount++];
    z->uid = uid;
    z->kind = kind;
    z->c[0] = cx; z->c[1] = cy; z->c[2] = cz;
    z->h[0] = hx; z->h[1] = hy; z->h[2] = hz;
    z->yaw = (s16) yaw;
    z->a = a;
    z->b = b;
    z->p[0] = px; z->p[1] = py; z->p[2] = pz;
    // Mario standing in it when it appears doesn't set it off: only walking in does
    z->inside = gMarioState != NULL && gMarioObject != NULL
                && zone_contains(z, gMarioState->pos[0], gMarioState->pos[1] + 80.0f, gMarioState->pos[2]);
}

// The zones the engine watches, for tests: [[kind, uid, cx, cy, cz, hx, hy, hz, a, b, inside], ...]
static char sZoneJson[4096];
EMSCRIPTEN_KEEPALIVE
const char *studio_zones_json(void) {
    s32 i, len = snprintf(sZoneJson, sizeof(sZoneJson), "[");
    for (i = 0; i < sZoneCount && len < (s32) sizeof(sZoneJson) - 120; i++) {
        struct StudioZone *z = &sZones[i];
        len += snprintf(sZoneJson + len, sizeof(sZoneJson) - len, "%s[%d,%u,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%d,%d,%d]", i ? "," : "",
                        z->kind, z->uid, z->c[0], z->c[1], z->c[2], z->h[0], z->h[1], z->h[2], z->a, z->b, z->inside);
    }
    snprintf(sZoneJson + len, sizeof(sZoneJson) - len, "]");
    return sZoneJson;
}

static struct Object *object_with_uid(u32 uid) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        struct Object *obj = &gObjectPool[i];
        if ((obj->activeFlags & ACTIVE_FLAG_ACTIVE) && obj->unused2 == uid) {
            return obj;
        }
    }
    return NULL;
}

// The warp of a zone or painting: through its warp node, with a transition.
static void trigger_warp(struct MarioState *m, struct Object *obj, s32 node, s32 transition) {
    if (obj == NULL) {
        return;
    }
    obj->oBehParams = (obj->oBehParams & ~0x00FF0000) | ((node & 0xFF) << 16);
    obj->oBehParams2ndByte = node & 0xFF;
    m->usedObj = obj;
    m->interactObj = obj;
    switch (transition) {
        case 1: level_trigger_warp(m, WARP_OP_WARP_OBJECT); break;   // star wipe
        case 2:
            // circle, as if falling: through the zone's own node (WARP_OP_WARP_FLOOR always takes
            // the area's warp-floor node 0xF3, which is the death or "falling leads to")
            if (!gWarpTransition.isActive) { // (a warp on its way already keeps its own)
                level_trigger_warp(m, WARP_OP_TELEPORT);
                play_transition(WARP_TRANSITION_FADE_INTO_CIRCLE, 0x14, 0x00, 0x00, 0x00);
            }
            break;
        default: level_trigger_warp(m, WARP_OP_TELEPORT); break;     // white fade
    }
}

// Camera modes for areas and camera zones (the page's names map to these).
enum { CAM_DEFAULT = 0, CAM_OPEN, CAM_RADIAL, CAM_CLOSE, CAM_8DIR, CAM_BEHIND, CAM_SLIDE, CAM_BOSS, CAM_FIXED,
       CAM_SIDE, CAM_TOP };
static s32 sAreaCam, sAreaCamApplied;
static f32 sAreaCamP[3], sAreaCamDist;
static s32 sCustomCam;            // CAM_SIDE / CAM_TOP while active
static f32 sCustomCamP[3], sCustomCamDist;

static void apply_camera(s32 mode, f32 *p, f32 dist) {
    struct Camera *c = gCamera;
    s32 sm = -1;
    sCustomCam = 0;
    if (c == NULL) {
        return;
    }
    switch (mode) {
        case CAM_OPEN: sm = CAMERA_MODE_FREE_ROAM; break;
        case CAM_RADIAL: sm = CAMERA_MODE_RADIAL; break;
        case CAM_CLOSE: sm = CAMERA_MODE_CLOSE; break;
        case CAM_8DIR: sm = CAMERA_MODE_8_DIRECTIONS; break;
        case CAM_BEHIND: sm = CAMERA_MODE_BEHIND_MARIO; break;
        case CAM_SLIDE: sm = CAMERA_MODE_SLIDE_HOOT; break;
        case CAM_BOSS: sm = CAMERA_MODE_BOSS_FIGHT; break;
        case CAM_FIXED:
            set_camera_mode_fixed(c, (s16) p[0], (s16) p[1], (s16) p[2]);
            c->defMode = CAMERA_MODE_FIXED;
            return;
        case CAM_SIDE:
        case CAM_TOP:
            sCustomCam = mode;
            vec3f_copy(sCustomCamP, p);
            sCustomCamDist = dist > 100.0f ? dist : 1400.0f;
            return;
        default: break;
    }
    if (sm >= 0) {
        set_camera_mode(c, sm, 1);
        c->defMode = sm;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_env_camera(s32 mode, f32 px, f32 py, f32 pz, f32 dist) {
    sAreaCam = mode;
    sAreaCamP[0] = px; sAreaCamP[1] = py; sAreaCamP[2] = pz;
    sAreaCamDist = dist;
    sAreaCamApplied = 0;
}

// Side-scrolling and top-down cameras: the view follows Mario from a fixed direction,
// and the stick works relative to it. (camera.c asks before using Lakitu's view.)
s32 studio_play_camera(Vec3f pos, Vec3f focus) {
    struct MarioState *m = gMarioState;
    f32 d = sCustomCamDist;
    if (!sCustomCam || gStudioPaused || m == NULL || gMarioObject == NULL || gCamera == NULL) {
        return FALSE;
    }
    focus[0] = m->pos[0];
    focus[1] = m->pos[1] + 120.0f;
    focus[2] = m->pos[2];
    if (sCustomCam == CAM_SIDE) {
        // p[0] is the yaw the camera looks along (degrees*182)
        s16 yaw = (s16) sCustomCamP[0];
        pos[0] = focus[0] - sins(yaw) * d;
        pos[1] = focus[1] + d * 0.18f;
        pos[2] = focus[2] - coss(yaw) * d;
        gCamera->yaw = yaw + 0x8000;
    } else {
        pos[0] = focus[0];
        pos[1] = focus[1] + d;
        pos[2] = focus[2] + d * 0.35f;
        gCamera->yaw = 0;
    }
    gLakituState.yaw = gCamera->yaw;
    return TRUE;
}

static void zones_frame(struct MarioState *m) {
    s32 i, camZone = -1;
    f32 x = m->pos[0], y = m->pos[1] + 80.0f, z = m->pos[2];
    for (i = 0; i < sZoneCount; i++) {
        struct StudioZone *zn = &sZones[i];
        s32 in = zone_contains(zn, x, y, z);
        s32 entered = in && !zn->inside;
        zn->inside = in;
        if (zn->kind == ZONE_CAMERA && in) {
            camZone = i;
        }
        if (!entered || (m->action & ACT_FLAG_INTANGIBLE)) {
            continue;
        }
        if (zn->kind == ZONE_WARP) {
            char buf[160];
            const char *why = lock_reason(zn->uid, buf, sizeof(buf));
            if (why != NULL) {
                if (sMsgUid != zn->uid || gGlobalTimer - sMsgFrame > 45) {
                    msg_borrow(why);
                    create_dialog_box(MSG_SLOT);
                }
                sMsgUid = zn->uid;
                sMsgFrame = gGlobalTimer;
                continue;
            }
            lock_opened(zn->uid);
            if (zn->b == 3) {
                // instant: same area, Mario keeps going (the camera jumps along)
                vec3f_add(m->pos, zn->p);
                vec3f_copy(gMarioObject->header.gfx.pos, m->pos);
                gMarioObject->oPosX = m->pos[0];
                gMarioObject->oPosY = m->pos[1];
                gMarioObject->oPosZ = m->pos[2];
                warp_camera(zn->p[0], zn->p[1], zn->p[2]);
                // arriving inside another zone (the other end of a two-way portal) must not
                // set that one off: Mario was flung back and forth every frame for good
                {
                    s32 j;
                    for (j = 0; j < sZoneCount; j++) {
                        sZones[j].inside = zone_contains(&sZones[j], m->pos[0], m->pos[1] + 80.0f, m->pos[2]);
                    }
                }
                break;
            } else {
                trigger_warp(m, object_with_uid(zn->uid), zn->a, zn->b);
            }
        } else if (zn->kind == ZONE_DEATH) {
            level_trigger_warp(m, WARP_OP_WARP_FLOOR);
        }
    }
    if (camZone != sZoneCam) {
        sZoneCam = camZone;
        if (camZone >= 0) {
            apply_camera(sZones[camZone].a, sZones[camZone].p, (f32) sZones[camZone].b);
        } else {
            apply_camera(sAreaCam ? sAreaCam : CAM_DEFAULT, sAreaCamP, sAreaCamDist);
            if (!sAreaCam && gCamera != NULL) {
                set_camera_mode(gCamera, gCurrentArea->camera->defMode ? gCurrentArea->camera->defMode : CAMERA_MODE_RADIAL, 1);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Environment of the area.

s32 gStudioFogOn;
f32 gStudioFogColor[3], gStudioFogNear = 2000.0f, gStudioFogFar = 12000.0f;
s32 gStudioTintOn;
f32 gStudioTint[3] = { 1.0f, 1.0f, 1.0f };
f32 gStudioSunDir[3] = { 0.38f, 0.84f, 0.38f };
f32 gStudioSunColor[3] = { 1.0f, 1.0f, 1.0f };
f32 gStudioAmbient = 0.42f;
static f32 sDeathY = -40000.0f;
static u32 sAmbientBits;
static s32 sAmbientInterval;

EMSCRIPTEN_KEEPALIVE
void studio_env_fog(s32 on, s32 rgb, f32 nearZ, f32 farZ) {
    gStudioFogOn = on;
    gStudioFogColor[0] = ((rgb >> 16) & 0xFF) / 255.0f;
    gStudioFogColor[1] = ((rgb >> 8) & 0xFF) / 255.0f;
    gStudioFogColor[2] = (rgb & 0xFF) / 255.0f;
    gStudioFogNear = nearZ;
    gStudioFogFar = farZ > nearZ + 10.0f ? farZ : nearZ + 10.0f;
}

EMSCRIPTEN_KEEPALIVE
void studio_env_tint(s32 on, s32 rgb) {
    gStudioTintOn = on;
    gStudioTint[0] = ((rgb >> 16) & 0xFF) / 255.0f;
    gStudioTint[1] = ((rgb >> 8) & 0xFF) / 255.0f;
    gStudioTint[2] = (rgb & 0xFF) / 255.0f;
}

// How the area's sun lights a face with normal n, per colour channel, relative to the
// default sun (yaw 45, pitch 57, white, ambient 0.42): blocks and imported models are
// shaded for the default sun and scaled by this (1 with the default light).
void studio_light_ratio(f32 nx, f32 ny, f32 nz, f32 out[3]) {
    static f32 s0[3];
    f32 len = sqrtf(nx * nx + ny * ny + nz * nz), d, d0, l0, k;
    s32 c;
    if (s0[1] == 0.0f) {
        f32 yaw = 45.0f * (f32) M_PI / 180.0f, pitch = 57.0f * (f32) M_PI / 180.0f;
        s0[0] = sinf(yaw) * cosf(pitch);
        s0[1] = sinf(pitch);
        s0[2] = cosf(yaw) * cosf(pitch);
    }
    if (len < 1e-6f) {
        out[0] = out[1] = out[2] = 1.0f;
        return;
    }
    nx /= len; ny /= len; nz /= len;
    d = nx * gStudioSunDir[0] + ny * gStudioSunDir[1] + nz * gStudioSunDir[2];
    d0 = nx * s0[0] + ny * s0[1] + nz * s0[2];
    if (d < 0) d = 0;
    if (d0 < 0) d0 = 0;
    l0 = 0.42f + 0.58f * d0;
    for (c = 0; c < 3; c++) {
        k = (gStudioAmbient + (1.0f - gStudioAmbient) * d * gStudioSunColor[c]) / l0;
        out[c] = k < 0.05f ? 0.05f : k > 1.8f ? 1.8f : k;
    }
}

void studio_blocks_relight(void);  // editor.c
void studio_models_relight(void);  // assets.c

// The sun for the terrain's baked shading: direction (yaw, pitch in degrees), color, ambient.
// Blocks and imported models follow it too.
EMSCRIPTEN_KEEPALIVE
void studio_env_light(f32 yawDeg, f32 pitchDeg, s32 rgb, f32 ambient) {
    static f32 sLast[4] = { 45.0f, 57.0f, -1.0f, 0.42f };
    s32 changed = sLast[0] != yawDeg || sLast[1] != pitchDeg || sLast[2] != (f32) rgb || sLast[3] != ambient;
    f32 yaw = yawDeg * (f32) M_PI / 180.0f, pitch = pitchDeg * (f32) M_PI / 180.0f;
    gStudioSunDir[0] = sinf(yaw) * cosf(pitch);
    gStudioSunDir[1] = sinf(pitch);
    gStudioSunDir[2] = cosf(yaw) * cosf(pitch);
    gStudioSunColor[0] = ((rgb >> 16) & 0xFF) / 255.0f;
    gStudioSunColor[1] = ((rgb >> 8) & 0xFF) / 255.0f;
    gStudioSunColor[2] = (rgb & 0xFF) / 255.0f;
    gStudioAmbient = ambient;
    if (changed) {
        sLast[0] = yawDeg; sLast[1] = pitchDeg; sLast[2] = (f32) rgb; sLast[3] = ambient;
        studio_blocks_relight();
        studio_models_relight();
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_env_death(f32 y) {
    sDeathY = y;
}

EMSCRIPTEN_KEEPALIVE
void studio_env_ambient(u32 bits, s32 interval) {
    sAmbientBits = bits;
    sAmbientInterval = interval;
}

// Water, toxic gas: environment boxes from the page, added after the level's own
// regions, the studio sea (world.c) and imported models' water (assets.c). Ours use
// water ids 40..47 and gas id 100, so a re-apply never copies them twice.
#define MAX_REGIONS 48
static s16 sRegions[1 + MAX_REGIONS * 6];
static s16 sBoxes[16 * 6];
static s32 sBoxCount;

static s32 region_is_ours(const s16 *r) {
    return (r[0] >= 40 && r[0] <= 47) || r[0] == 100;
}

EMSCRIPTEN_KEEPALIVE
void studio_env_boxes_apply(void) {
    s16 *base = gEnvironmentRegions;
    s32 n = 0, i, k;
    static s16 sKeep[MAX_REGIONS * 6];
    s32 keep = 0;
    // others' regions (the level's own, the studio sea, imported models' water) without our old boxes
    if (base != NULL) {
        s32 count = base[0];
        for (i = 0; i < count && keep < MAX_REGIONS; i++) {
            const s16 *r = &base[1 + i * 6];
            s32 dup = FALSE;
            if (region_is_ours(r)) continue;
            for (k = 0; k < keep; k++) dup |= memcmp(&sKeep[k * 6], r, 6 * sizeof(s16)) == 0;
            if (!dup) memcpy(&sKeep[6 * keep++], r, 6 * sizeof(s16));
        }
    }
    // ours first: the first region that contains a point decides its water level, so
    // a pool inside a level with a sea keeps its own surface
    for (i = 0; i < sBoxCount && n < MAX_REGIONS; i++, n++) {
        memcpy(&sRegions[1 + n * 6], &sBoxes[i * 6], 6 * sizeof(s16));
    }
    for (i = 0; i < keep && n < MAX_REGIONS; i++, n++) {
        memcpy(&sRegions[1 + n * 6], &sKeep[i * 6], 6 * sizeof(s16));
    }
    sRegions[0] = n;
    if (n > 0) {
        gEnvironmentRegions = sRegions;
    } else if (gEnvironmentRegions == sRegions) {
        gEnvironmentRegions = NULL;
    }
}

// The area's environment regions, for tests and the page: [[id, x0, z0, x1, z1, y], ...]
static char sEnvJson[2048];
EMSCRIPTEN_KEEPALIVE
const char *studio_env_regions_json(void) {
    s32 i, len = 0, count = gEnvironmentRegions ? gEnvironmentRegions[0] : 0;
    len += snprintf(sEnvJson + len, sizeof(sEnvJson) - len, "[");
    for (i = 0; i < count && len < (s32) sizeof(sEnvJson) - 64; i++) {
        const s16 *r = &gEnvironmentRegions[1 + i * 6];
        len += snprintf(sEnvJson + len, sizeof(sEnvJson) - len, "%s[%d,%d,%d,%d,%d,%d]", i ? "," : "", r[0], r[1], r[2], r[3], r[4], r[5]);
    }
    snprintf(sEnvJson + len, sizeof(sEnvJson) - len, "]");
    return sEnvJson;
}

// kind 0 water, 1 toxic gas; x0 z0 x1 z1 and the surface height.
EMSCRIPTEN_KEEPALIVE
void studio_env_boxes_reset(void) {
    sBoxCount = 0;
}

EMSCRIPTEN_KEEPALIVE
void studio_env_box(s32 kind, s32 x0, s32 z0, s32 x1, s32 z1, s32 height) {
    s16 *b;
    if (sBoxCount >= 16) {
        return;
    }
    b = &sBoxes[sBoxCount * 6];
    b[0] = kind == 1 ? 100 : (s16) (40 + (sBoxCount & 7));
    b[1] = (s16) (x0 < x1 ? x0 : x1);
    b[2] = (s16) (z0 < z1 ? z0 : z1);
    b[3] = (s16) (x0 < x1 ? x1 : x0);
    b[4] = (s16) (z0 < z1 ? z1 : z0);
    b[5] = (s16) height;
    sBoxCount++;
}

// ---- weather ----------------------------------------------------------------
// The game's own effects (snow, blizzard, petals, lava bubbles) through the area's
// envfx node, plus rain, leaves and bubbles drawn here.

enum { WX_NONE = 0, WX_SNOW, WX_BLIZZARD, WX_RAIN, WX_LEAVES, WX_PETALS, WX_LAVA, WX_BUBBLES, WX_SNOW_WATER };
static s32 sWeather;
static s32 sWeatherCustom;     // 1 rain, 2 leaves, 3 bubbles
#define MAX_DROPS 240
struct Drop { f32 x, y, z, v, ph; };
static struct Drop sDrops[MAX_DROPS];
static s32 sDropsInit;
static Vtx sDropVtx[MAX_DROPS * 4];
static Gfx sDropGfx[MAX_DROPS / 16 * 18 + 24];
static u32 sDropFrame;

static f32 frand(void) {
    return random_float();
}

static void drops_update(f32 cx, f32 cy, f32 cz) {
    s32 i;
    f32 R = sWeatherCustom == 1 ? 1500.0f : 1100.0f;
    for (i = 0; i < MAX_DROPS; i++) {
        struct Drop *d = &sDrops[i];
        if (!sDropsInit || fabsf(d->x - cx) > R || fabsf(d->z - cz) > R || d->y < cy - 900.0f || d->y > cy + 1600.0f) {
            d->x = cx + (frand() * 2 - 1) * R;
            d->z = cz + (frand() * 2 - 1) * R;
            d->y = sDropsInit ? (sWeatherCustom == 3 ? cy - 800.0f : cy + 1200.0f + frand() * 300.0f) : cy - 800.0f + frand() * 2300.0f;
            d->v = sWeatherCustom == 1 ? 55.0f + frand() * 25.0f : (sWeatherCustom == 2 ? 3.0f + frand() * 3.0f : 4.0f + frand() * 4.0f);
            d->ph = frand() * 6.28f;
        }
        if (sWeatherCustom == 3) {
            d->y += d->v;
            d->x += sinf(d->ph + d->y * 0.01f) * 1.5f;
        } else {
            d->y -= d->v;
            if (sWeatherCustom == 2) {
                d->x += sinf(d->ph + d->y * 0.004f) * 4.0f + 1.5f;
                d->z += cosf(d->ph * 1.3f + d->y * 0.003f) * 2.0f;
            } else {
                d->x += 2.0f;
            }
        }
    }
    sDropsInit = TRUE;
}

static Gfx *drops_gfx(f32 *camPos, f32 *camFocus) {
    s32 i, q, n = 0;
    Gfx *g = sDropGfx;
    f32 fx = camFocus[0] - camPos[0], fz = camFocus[2] - camPos[2];
    f32 l = sqrtf(fx * fx + fz * fz);
    f32 rx = l > 0 ? fz / l : 1.0f, rz = l > 0 ? -fx / l : 0.0f;
    for (i = 0; i < MAX_DROPS; i++) {
        struct Drop *d = &sDrops[i];
        Vtx *v = &sDropVtx[n * 4];
        f32 w, h, ox = 0, oy = 0;
        u8 r, gr, b, a;
        if (sWeatherCustom == 1) { w = 1.6f; h = 70.0f; r = 200; gr = 215; b = 255; a = 110; }
        else if (sWeatherCustom == 2) {
            w = 9.0f; h = 9.0f;
            r = (i % 3 == 0) ? 214 : (i % 3 == 1 ? 120 : 190);
            gr = (i % 3 == 0) ? 120 : (i % 3 == 1 ? 170 : 150);
            b = 40; a = 255;
            ox = sinf(d->ph + d->y * 0.02f) * 7.0f;
            oy = cosf(d->ph + d->y * 0.02f) * 7.0f;
        } else { w = 5.0f; h = 10.0f; r = 220; gr = 240; b = 255; a = 140; }
        {
            f32 p[4][3] = {
                { d->x - rx * w - ox * rx, d->y - oy, d->z - rz * w - ox * rz },
                { d->x + rx * w + ox * rx, d->y + oy, d->z + rz * w + ox * rz },
                { d->x + rx * w - ox * rx, d->y + h - oy, d->z + rz * w - ox * rz },
                { d->x - rx * w + ox * rx, d->y + h + oy, d->z - rz * w + ox * rz },
            };
            for (q = 0; q < 4; q++) {
                v[q].v.ob[0] = (s16) p[q][0];
                v[q].v.ob[1] = (s16) p[q][1];
                v[q].v.ob[2] = (s16) p[q][2];
                v[q].v.flag = 0;
                v[q].v.tc[0] = v[q].v.tc[1] = 0;
                v[q].v.cn[0] = r;
                v[q].v.cn[1] = gr;
                v[q].v.cn[2] = b;
                v[q].v.cn[3] = (q >= 2 && sWeatherCustom == 1) ? a / 3 : a;
            }
        }
        n++;
    }
    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPClearGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    for (i = 0; i < n; i += 16) {
        s32 k = n - i > 16 ? 16 : n - i;
        gSPVertex(g++, &sDropVtx[i * 4], k * 4, 0);
        for (q = 0; q < k; q++) {
            gSP2Triangles(g++, q * 4, q * 4 + 1, q * 4 + 2, 0, q * 4, q * 4 + 2, q * 4 + 3, 0);
        }
    }
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPEndDisplayList(g++);
    return sDropGfx;
}

// Stands in for geo_envfx_main in the area's graph (see studio_env_weather).
Gfx *geo_studio_envfx(s32 callContext, struct GraphNode *node, void *mtxf) {
    struct GraphNodeGenerated *gn = (struct GraphNodeGenerated *) node;
    Gfx *gfx = NULL;
    if (!sWeatherCustom || callContext != GEO_CONTEXT_RENDER || gCurGraphNodeCamera == NULL) {
        return geo_envfx_main(callContext, node, (f32 (*)[4]) mtxf);
    }
    if (sDropFrame != gAreaUpdateCounter) {
        sDropFrame = gAreaUpdateCounter;
        drops_update(gCurGraphNodeCamera->pos[0], gCurGraphNodeCamera->pos[1], gCurGraphNodeCamera->pos[2]);
    }
    {
        Mtx *mtx = alloc_display_list(sizeof(*mtx));
        Gfx *list = drops_gfx(gCurGraphNodeCamera->pos, gCurGraphNodeCamera->focus);
        gfx = alloc_display_list(2 * sizeof(*gfx));
        mtxf_to_mtx(mtx, (f32 (*)[4]) mtxf);
        gSPMatrix(&gfx[0], VIRTUAL_TO_PHYSICAL(mtx), G_MTX_MODELVIEW | G_MTX_LOAD | G_MTX_NOPUSH);
        gSPBranchList(&gfx[1], VIRTUAL_TO_PHYSICAL(list));
        gn->fnNode.node.flags = (gn->fnNode.node.flags & 0xFF) | (LAYER_TRANSPARENT << 8);
    }
    return gfx;
}

struct EnvfxNode {
    struct GraphNodeGenerated *n;
    u32 origParam;
};
#define MAX_ENVFX 16
static struct EnvfxNode sEnvfx[MAX_ENVFX];
static s32 sEnvfxCount;

static void envfx_collect(struct GraphNode *first) {
    struct GraphNode *n = first;
    if (n == NULL) {
        return;
    }
    do {
        if (n->type == GRAPH_NODE_TYPE_GENERATED_LIST) {
            struct GraphNodeGenerated *g = (struct GraphNodeGenerated *) n;
            if ((g->fnNode.func == (GraphNodeFunc) geo_envfx_main || g->fnNode.func == geo_studio_envfx) && sEnvfxCount < MAX_ENVFX) {
                s32 i, seen = FALSE;
                for (i = 0; i < sEnvfxCount; i++) {
                    seen |= sEnvfx[i].n == g;
                }
                if (!seen) {
                    sEnvfx[sEnvfxCount].n = g;
                    sEnvfx[sEnvfxCount].origParam = g->parameter & 0xFFFF;
                    sEnvfxCount++;
                }
            }
        }
        if (n->children != NULL && n->type != GRAPH_NODE_TYPE_OBJECT_PARENT) {
            envfx_collect(n->children);
        }
        n = n->next;
    } while (n != first && n != NULL);
}

// kind: WX_*; -1 = the area's own weather.
EMSCRIPTEN_KEEPALIVE
void studio_env_weather(s32 kind) {
    s32 i, envfx = -1;
    if (gCurrentArea == NULL || gCurrentArea->unk04 == NULL) {
        return;
    }
    envfx_collect(&gCurrentArea->unk04->node);
    sWeather = kind;
    sWeatherCustom = 0;
    switch (kind) {
        case WX_NONE: envfx = 0; break;
        case WX_SNOW: envfx = ENVFX_SNOW_NORMAL; break;
        case WX_BLIZZARD: envfx = ENVFX_SNOW_BLIZZARD; break;
        case WX_SNOW_WATER: envfx = ENVFX_SNOW_WATER; break;
        case WX_PETALS: envfx = ENVFX_FLOWERS; break;
        case WX_LAVA: envfx = ENVFX_LAVA_BUBBLES; break;
        case WX_RAIN: envfx = 0; sWeatherCustom = 1; break;
        case WX_LEAVES: envfx = 0; sWeatherCustom = 2; break;
        case WX_BUBBLES: envfx = 0; sWeatherCustom = 3; break;
        default: break;
    }
    sDropsInit = FALSE;
    for (i = 0; i < sEnvfxCount; i++) {
        struct GraphNodeGenerated *g = sEnvfx[i].n;
        // only nodes of the area on screen
        u32 p = envfx >= 0 ? (u32) envfx : sEnvfx[i].origParam;
        g->parameter = (g->parameter & 0xFFFF0000) | p;
        g->fnNode.func = geo_studio_envfx;
    }
}

// ---- per area -----------------------------------------------------------------

// A new area: nothing of the last one's flow or environment stays (the page re-applies).
void studio_flow_area_load(void) {
    sZoneCount = 0;
    sZoneCam = -1;
    sLockCount = 0;
    gStudioFogOn = FALSE;
    gStudioTintOn = FALSE;
    sDeathY = -40000.0f;
    sAmbientBits = 0;
    sAreaCam = 0;
    sAreaCamApplied = 1;
    sCustomCam = 0;
    sWeatherCustom = 0;
    sEnvfxCount = 0;
    sBoxCount = 0;
    gStudioIsHub = FALSE;
    gStudioSunDir[0] = 0.38f; gStudioSunDir[1] = 0.84f; gStudioSunDir[2] = 0.38f;
    gStudioSunColor[0] = gStudioSunColor[1] = gStudioSunColor[2] = 1.0f;
    gStudioAmbient = 0.42f;
}

void studio_flow_frame(void) {
    struct MarioState *m = gMarioState;
    msg_tick();
    if (m == NULL || gMarioObject == NULL || gCurrentArea == NULL || gStudioPaused) {
        return;
    }
    if (!sAreaCamApplied && gCamera != NULL) {
        sAreaCamApplied = 1;
        if (sZoneCam < 0) {
            apply_camera(sAreaCam, sAreaCamP, sAreaCamDist);
        }
    }
    pending_msg_tick(m);
    zones_frame(m);
    if (m->pos[1] < sDeathY && !(m->action & ACT_FLAG_INTANGIBLE)) {
        level_trigger_warp(m, WARP_OP_WARP_FLOOR);
    }
    if (sAmbientBits != 0 && sAmbientInterval > 0 && (gGlobalTimer % (u32) sAmbientInterval) == 0) {
        play_sound(sAmbientBits, gDefaultSoundArgs);
    }
}

// ---------------------------------------------------------------------------
// Paintings: a canvas Mario jumps into (bparams: byte 1 picture, byte 2 warp node).
// Pictures 0..10 are the castle's; 0x40+ are images from the page (128x128).

extern struct Painting bob_painting, ccm_painting, wf_painting, jrb_painting, lll_painting, ssl_painting,
    wdw_painting, thi_tiny_painting, ttm_painting, ttc_painting, sl_painting;

static struct Painting *const sPictures[] = {
    &bob_painting, &ccm_painting, &wf_painting, &jrb_painting, &lll_painting, &ssl_painting,
    &wdw_painting, &thi_tiny_painting, &ttm_painting, &ttc_painting, &sl_painting,
};
#define PICTURE_COUNT ((s32) (sizeof(sPictures) / sizeof(sPictures[0])))
#define MAX_CUSTOM_PICTURES 24
static u16 *sCustomPictures[MAX_CUSTOM_PICTURES];

// Room for a 128x128 RGBA16 image the page fills (returns the pixel buffer).
EMSCRIPTEN_KEEPALIVE
u16 *studio_painting_image(s32 slot) {
    if (slot < 0 || slot >= MAX_CUSTOM_PICTURES) {
        return NULL;
    }
    if (sCustomPictures[slot] == NULL) {
        sCustomPictures[slot] = calloc(128 * 128, sizeof(u16));
    }
    return sCustomPictures[slot];
}

#define PG 16                 // grid columns
#define PROWS 16              // grid rows
struct PaintingState {
    struct GraphNodeDisplayList *node;
    Vtx *vtx;
    Gfx *gfx;
    f32 mag, decay, rate, disp, timer, rx, ry;
    s32 pic;
};
static struct PaintingState *sPaint[OBJECT_POOL_CAPACITY];

static void painting_build(struct Object *obj, struct PaintingState *ps) {
    s32 strips, stripRows, s, row, col, k = 0;
    s32 custom = ps->pic >= 0x40;
    u16 *img = custom ? sCustomPictures[(ps->pic - 0x40) % MAX_CUSTOM_PICTURES] : NULL;
    struct Painting *pt = !custom ? sPictures[ps->pic % PICTURE_COUNT] : NULL;
    Gfx *g = ps->gfx;
    const f32 W = 600.0f, H = 600.0f;
    if (custom && img == NULL) {
        custom = FALSE;
        pt = sPictures[0];
    }
    strips = custom ? 8 : 2;
    stripRows = PROWS / strips;
    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_MODULATERGB, G_CC_MODULATERGB);
    gSPClearGeometryMode(g++, G_LIGHTING);
    gSPSetGeometryMode(g++, G_CULL_BACK);
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_ON);
    for (s = 0; s < strips; s++) {
        // strip 0 is the top of the picture
        s32 texH = custom ? 16 : 32;
        if (custom) {
            gDPLoadTextureBlock(g++, img + s * 128 * 16, G_IM_FMT_RGBA, G_IM_SIZ_16b, 128, 16, 0,
                                G_TX_CLAMP, G_TX_CLAMP, 7, 4, G_TX_NOLOD, G_TX_NOLOD);
        } else {
            // the castle's paintings keep the bottom half first
            gDPLoadTextureBlock(g++, pt->textureArray[1 - s], G_IM_FMT_RGBA, G_IM_SIZ_16b, 64, 32, 0,
                                G_TX_CLAMP, G_TX_CLAMP, 6, 5, G_TX_NOLOD, G_TX_NOLOD);
        }
        for (row = 0; row < stripRows; row++) {
            s32 gr = s * stripRows + row; // grid row from the top
            Vtx *base = &ps->vtx[k];
            for (col = 0; col <= PG; col++) {
                s32 e;
                for (e = 0; e < 2; e++) {
                    // e = 0 the lower edge of the row, 1 the upper
                    s32 rr = gr + (e ? 0 : 1);
                    f32 lx = (col / (f32) PG - 0.5f) * W;
                    f32 ly = H - rr * (H / PROWS);
                    f32 dx = lx - ps->rx, dy = ly - ps->ry;
                    f32 dist = sqrtf(dx * dx + dy * dy) / ps->disp;
                    f32 z = 0.0f, shade;
                    Vtx *v = &ps->vtx[k + e * (PG + 1) + col];
                    if (ps->mag > 0.5f && ps->timer >= dist) {
                        z = ps->mag * cosf(ps->rate * 6.2832f * (ps->timer - dist));
                    }
                    shade = 1.0f - fabsf(z) / 260.0f;
                    v->v.ob[0] = (s16) lx;
                    v->v.ob[1] = (s16) ly;
                    v->v.ob[2] = (s16) (z + 3.0f);
                    v->v.flag = 0;
                    v->v.tc[0] = (s16) (col * (custom ? 128 : 64) * 32 / PG);
                    v->v.tc[1] = (s16) ((rr - s * stripRows) * texH * 32 / stripRows);
                    v->v.cn[0] = v->v.cn[1] = v->v.cn[2] = (u8) (255 * (shade < 0.6f ? 0.6f : shade));
                    v->v.cn[3] = 255;
                }
            }
            gSPVertex(g++, base, 2 * (PG + 1), 0);
            for (col = 0; col < PG; col++) {
                s32 b0 = col, b1 = col + 1, t0 = PG + 1 + col, t1 = PG + 2 + col;
                gSP2Triangles(g++, b0, b1, t1, 0, b0, t1, t0, 0);
            }
            k += 2 * (PG + 1);
        }
    }
    gSPTexture(g++, 0xFFFF, 0xFFFF, 0, G_TX_RENDERTILE, G_OFF);
    gDPPipeSync(g++);
    gDPSetCombineMode(g++, G_CC_SHADE, G_CC_SHADE);
    gSPSetGeometryMode(g++, G_LIGHTING | G_CULL_BACK);
    gSPEndDisplayList(g++);
    (void) obj;
}

static struct PaintingState *painting_state(struct Object *obj) {
    s32 slot = obj - gObjectPool;
    struct PaintingState *ps;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return NULL;
    }
    ps = sPaint[slot];
    if (ps == NULL) {
        ps = sPaint[slot] = calloc(1, sizeof(struct PaintingState));
        ps->vtx = calloc(PROWS * 2 * (PG + 1), sizeof(Vtx));
        ps->gfx = calloc(16 + 8 * 10 + PROWS * (2 + PG) + 16, sizeof(Gfx)); // header, 8 texture loads, rows
        ps->node = init_graph_node_display_list(NULL, malloc(sizeof(struct GraphNodeDisplayList)), LAYER_OPAQUE, ps->gfx);
    }
    return ps;
}

// Make a spawned painting drawable right away (build mode doesn't run behaviors).
EMSCRIPTEN_KEEPALIVE
s32 studio_painting_setup(s32 slot) {
    struct Object *obj;
    struct PaintingState *ps;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return 0;
    }
    obj = &gObjectPool[slot];
    ps = painting_state(obj);
    if (ps == NULL) {
        return 0;
    }
    ps->pic = (obj->oBehParams >> 24) & 0xFF;
    ps->mag = 0;
    ps->timer = 0;
    ps->disp = 40.0f;
    ps->rate = 0.24f;
    ps->decay = 0.96f;
    painting_build(obj, ps);
    obj->header.gfx.sharedChild = &ps->node->node;
    obj->hitboxRadius = 300.0f;
    obj->hitboxHeight = 600.0f;
    obj->oDrawingDistance = 20000.0f;
    return 1;
}

void bhv_studio_painting_init(void) {
    struct Object *obj = gCurrentObject;
    if (obj->header.gfx.sharedChild == NULL) {
        studio_painting_setup(obj - gObjectPool);
    }
}

static void painting_ripple(struct PaintingState *ps, f32 x, f32 y, s32 entry) {
    ps->rx = x;
    ps->ry = y;
    ps->timer = 0;
    ps->mag = entry ? 80.0f : 20.0f;
    ps->decay = entry ? 0.9524f : 0.9608f;
    ps->rate = entry ? 0.14f : 0.24f;
    ps->disp = entry ? 30.0f : 40.0f;
}

void bhv_studio_painting_loop(void) {
    struct Object *obj = gCurrentObject;
    struct MarioState *m = gMarioState;
    struct PaintingState *ps = painting_state(obj);
    f32 sc = obj->header.gfx.scale[0] > 0.01f ? obj->header.gfx.scale[0] : 1.0f;
    f32 dx, dy, dz, lx, ly, lz, s, c;
    if (ps == NULL || m == NULL || gMarioObject == NULL) {
        return;
    }
    if (obj->header.gfx.sharedChild != &ps->node->node) {
        studio_painting_setup(obj - gObjectPool);
    }
    // Mario in the painting's frame: x along it, y up it, z out of it
    dx = m->pos[0] - obj->oPosX;
    dy = m->pos[1] + 80.0f - obj->oPosY;
    dz = m->pos[2] - obj->oPosZ;
    s = sins(obj->oFaceAngleYaw);
    c = coss(obj->oFaceAngleYaw);
    lx = (dx * c - dz * s) / sc;
    lz = (dx * s + dz * c) / sc;
    ly = dy / sc;
    if (fabsf(lx) < 300.0f && ly > -40.0f && ly < 640.0f) {
        if (lz < 140.0f / sc && lz > -60.0f && ps->mag < 2.0f) {
            painting_ripple(ps, lx, ly, FALSE);
        }
        if (lz < 70.0f / sc + 30.0f && lz > -150.0f && (m->action & (ACT_FLAG_AIR | ACT_FLAG_SWIMMING))
            && !(m->action & ACT_FLAG_INTANGIBLE) && obj->oAction == 0) {
            char buf[160];
            const char *why = lock_reason(obj->unused2, buf, sizeof(buf));
            painting_ripple(ps, lx, ly, TRUE);
            if (why != NULL) {
                if (sMsgUid != obj->unused2 || gGlobalTimer - sMsgFrame > 60) {
                    msg_borrow(why);
                    create_dialog_box(MSG_SLOT);
                }
                sMsgUid = obj->unused2;
                sMsgFrame = gGlobalTimer;
                // bounced off the canvas
                m->vel[0] = m->vel[2] = 0;
                m->forwardVel = -12.0f;
            } else if (((obj->oBehParams >> 16) & 0xFF) != 0) {
                lock_opened(obj->unused2);
                obj->oAction = 1;
                trigger_warp(m, obj, (obj->oBehParams >> 16) & 0xFF, 0);
                set_mario_action(m, ACT_DISAPPEARED, 0);
                gMarioObject->header.gfx.node.flags &= ~GRAPH_RENDER_ACTIVE;
                play_sound(SOUND_MENU_STAR_SOUND, gDefaultSoundArgs);
            }
        }
    }
    if (ps->mag > 0.5f) {
        ps->timer += 1.0f;
        ps->mag *= ps->decay;
        painting_build(obj, ps);
    } else if (ps->mag > 0.0f) {
        ps->mag = 0.0f;
        painting_build(obj, ps);
    }
}

// ---------------------------------------------------------------------------
// Keys (bparams byte 1: key number): spin, and Mario takes them.

void bhv_studio_key_init(void) {
    struct Object *obj = gCurrentObject;
    if (sKeys & (1u << ((obj->oBehParams >> 24) & 31))) {
        obj_mark_for_deletion(obj);
    }
    obj->oHomeY = obj->oPosY;
}

void bhv_studio_key_loop(void) {
    struct Object *obj = gCurrentObject;
    struct MarioState *m = gMarioState;
    s32 key = (obj->oBehParams >> 24) & 31;
    obj->oFaceAngleYaw += 0x500;
    obj->oPosY = obj->oHomeY + sins(obj->oTimer * 0x400) * 18.0f;
    if (m != NULL && gMarioObject != NULL) {
        f32 dx = m->pos[0] - obj->oPosX, dz = m->pos[2] - obj->oPosZ, dy = m->pos[1] - obj->oPosY;
        if (dx * dx + dz * dz < 120.0f * 120.0f && dy > -200.0f && dy < 120.0f) {
            sKeys |= 1u << key;
            play_sound(SOUND_MENU_COLLECT_SECRET, gDefaultSoundArgs);
            spawn_object(obj, MODEL_SPARKLES, bhvGoldenCoinSparkles);
            obj_mark_for_deletion(obj);
            EM_ASM({ if (Module.studioKey) Module.studioKey($0, $1 >>> 0); }, key, obj->unused2);
        }
    }
}

// ---------------------------------------------------------------------------
// Doors placed against a wall (studio doors are often put flat on a wall): Mario
// walking through one stops in the doorway instead of walking into the wall, and
// coming out of one he appears on its open side.

static s32 wall_on_ray(struct Object *door, f32 x, f32 y, f32 z, f32 dx, f32 dz, f32 *dist) {
    Vec3f orig, dir, pos;
    f32 len = sqrtf(dx * dx + dz * dz), done = 0.0f;
    s32 tries;
    if (len < 1.0f) {
        return FALSE;
    }
    orig[0] = x; orig[1] = y; orig[2] = z;
    // the door's own collision is skipped (the ray goes on behind it)
    for (tries = 0; tries < 4 && done < len; tries++) {
        struct Surface *hit = NULL;
        f32 rest = len - done, d;
        dir[0] = dx / len * rest; dir[1] = 0; dir[2] = dz / len * rest;
        find_surface_on_ray(orig, dir, &hit, pos);
        if (hit == NULL) {
            return FALSE;
        }
        d = sqrtf((pos[0] - orig[0]) * (pos[0] - orig[0]) + (pos[2] - orig[2]) * (pos[2] - orig[2]));
        if (hit->object != door && hit->normal.y < 0.5f && hit->normal.y > -0.5f) {
            if (dist != NULL) {
                *dist = done + d;
            }
            return TRUE;
        }
        done += d + 2.0f;
        orig[0] = x + dx / len * done;
        orig[2] = z + dz / len * done;
    }
    return FALSE;
}

static f32 sDoorLimit;
static f32 sDoorDir[2];
static s32 sDoorState; // 1 open behind, 2 wall behind (sDoorLimit)

// act_going_through_door, first frame, before Mario is put at the door: which way he goes
// through it (along the door's facing, away from where he stands) and whether a wall is there.
void studio_door_walk_begin(struct MarioState *m) {
    struct Object *d = m->usedObj;
    f32 fx, fz, side, dist;
    sDoorState = 0;
    if (d == NULL) {
        return;
    }
    fx = sins(d->oMoveAngleYaw);
    fz = coss(d->oMoveAngleYaw);
    side = (m->pos[0] - d->oPosX) * fx + (m->pos[2] - d->oPosZ) * fz;
    sDoorDir[0] = side >= 0 ? -fx : fx;
    sDoorDir[1] = side >= 0 ? -fz : fz;
    sDoorState = 1;
    if (wall_on_ray(d, d->oPosX + sDoorDir[0] * 2.0f, d->oPosY + 80.0f, d->oPosZ + sDoorDir[1] * 2.0f,
                    sDoorDir[0] * 300.0f, sDoorDir[1] * 300.0f, &dist)) {
        sDoorState = 2;
        sDoorLimit = 2.0f + dist - 50.0f; // Mario's body stays out of the wall
        if (sDoorLimit < 0.0f) sDoorLimit = 0.0f;
    }
}

// act_going_through_door, after the animation moved Mario: not into the wall.
void studio_door_walk(struct MarioState *m) {
    struct Object *d = m->usedObj;
    f32 along;
    if (d == NULL || sDoorState != 2) {
        return;
    }
    along = (m->pos[0] - d->oPosX) * sDoorDir[0] + (m->pos[2] - d->oPosZ) * sDoorDir[1];
    if (along > sDoorLimit) {
        m->pos[0] -= sDoorDir[0] * (along - sDoorLimit);
        m->pos[2] -= sDoorDir[1] * (along - sDoorLimit);
    }
}

// act_warp_door_spawn, first frame: Mario was put 300 units out of the door on the side
// he walked in from; if a wall is there, he comes out of the other side.
void studio_door_spawn_side(struct MarioState *m) {
    struct Object *d = m->usedObj;
    f32 dx, dz, len, ux, uz, fy;
    struct Surface *floor = NULL;
    if (d == NULL) {
        return;
    }
    dx = m->pos[0] - d->oPosX;
    dz = m->pos[2] - d->oPosZ;
    len = sqrtf(dx * dx + dz * dz);
    if (len < 60.0f) {
        return;
    }
    ux = dx / len;
    uz = dz / len;
    if (!wall_on_ray(d, d->oPosX + ux * 2.0f, d->oPosY + 80.0f, d->oPosZ + uz * 2.0f, ux * (len + 40.0f), uz * (len + 40.0f), NULL)) {
        return;
    }
    if (wall_on_ray(d, d->oPosX - ux * 2.0f, d->oPosY + 80.0f, d->oPosZ - uz * 2.0f, -ux * (len + 40.0f), -uz * (len + 40.0f), NULL)) {
        return; // walls on both sides: leave it
    }
    fy = find_floor(d->oPosX - dx, d->oPosY + 200.0f, d->oPosZ - dz, &floor);
    if (floor == NULL) {
        return;
    }
    m->pos[0] = d->oPosX - dx;
    m->pos[2] = d->oPosZ - dz;
    m->pos[1] = fy;
    m->floor = floor;
    m->floorHeight = fy;
    m->faceAngle[1] += 0x8000;
    vec3f_copy(m->marioObj->header.gfx.pos, m->pos);
}
