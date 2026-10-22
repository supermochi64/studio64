// Studio 64 play-testing and debug tools: collision view data, Mario's full state,
// frame advance / slow motion, the save file (stars, flags), validator queries and
// what save states need (heap end, graphics cache reset).
//
// Everything here is called from the browser between frames (ccall), except
// studio_debug_gate, which the web main loop asks before each game frame.

#include <ultra64.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <unistd.h>
#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "sm64.h"
#include "types.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/area.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/object_list_processor.h"
#include "game/save_file.h"
#include "studio.h"

extern s32 gSurfacesAllocated, gNumStaticSurfaces;
extern struct SaveBuffer gSaveBuffer;
extern s8 gSaveFileModified;
extern u32 gGlobalTimer;

// ---------------------------------------------------------------------------
// Collision view: the triangles near a point, with their surface type.
// Buffer layout: [count, then per triangle 12 floats: 3 vertices (x,y,z), type,
// kind (0 floor, 1 wall, 2 ceiling), dynamic (1 = belongs to an object), normal y].

#define DBG_TRI_FLOATS 13
#define DBG_MAX_TRIS 24000
static f32 sTriBuf[1 + DBG_MAX_TRIS * DBG_TRI_FLOATS];

EMSCRIPTEN_KEEPALIVE
f32 *studio_debug_surfaces(f32 cx, f32 cy, f32 cz, f32 radius, s32 max) {
    s32 i, n = 0;
    f32 r2;
    if (max <= 0 || max > DBG_MAX_TRIS) {
        max = DBG_MAX_TRIS;
    }
    r2 = radius * radius;
    for (i = 0; i < gSurfacesAllocated && n < max; i++) {
        struct Surface *s = &sSurfacePool[i];
        f32 mx = (s->vertex1[0] + s->vertex2[0] + s->vertex3[0]) / 3.0f;
        f32 my = (s->vertex1[1] + s->vertex2[1] + s->vertex3[1]) / 3.0f;
        f32 mz = (s->vertex1[2] + s->vertex2[2] + s->vertex3[2]) / 3.0f;
        f32 dx = mx - cx, dy = my - cy, dz = mz - cz;
        // big triangles count when any corner is near too
        if (dx * dx + dy * dy + dz * dz > r2) {
            s32 k, near = 0;
            const s16 *v[3] = { s->vertex1, s->vertex2, s->vertex3 };
            for (k = 0; k < 3 && !near; k++) {
                f32 ex = v[k][0] - cx, ey = v[k][1] - cy, ez = v[k][2] - cz;
                near = ex * ex + ey * ey + ez * ez <= r2;
            }
            if (!near) {
                f32 ax = s->vertex1[0] - mx, az = s->vertex1[2] - mz;
                f32 size2 = ax * ax + az * az;
                if (size2 < r2 || dx * dx + dz * dz > size2 + r2 * 2.0f) {
                    continue;
                }
            }
        }
        {
            f32 *o = &sTriBuf[1 + n * DBG_TRI_FLOATS];
            o[0] = s->vertex1[0]; o[1] = s->vertex1[1]; o[2] = s->vertex1[2];
            o[3] = s->vertex2[0]; o[4] = s->vertex2[1]; o[5] = s->vertex2[2];
            o[6] = s->vertex3[0]; o[7] = s->vertex3[1]; o[8] = s->vertex3[2];
            o[9] = s->type;
            o[10] = s->normal.y > 0.01f ? 0.0f : s->normal.y < -0.01f ? 2.0f : 1.0f;
            o[11] = (i >= gNumStaticSurfaces || s->object != NULL) ? 1.0f : 0.0f;
            o[12] = s->normal.y;
            n++;
        }
    }
    sTriBuf[0] = (f32) n;
    return sTriBuf;
}

// How many surfaces are loaded (static and from objects), and the pool size.
static char sDbgJson[4096];

EMSCRIPTEN_KEEPALIVE
const char *studio_debug_pools_json(void) {
    s32 i, live = 0;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        if (gObjectPool[i].activeFlags & ACTIVE_FLAG_ACTIVE) {
            live++;
        }
    }
    snprintf(sDbgJson, sizeof(sDbgJson),
             "{\"surfaces\":%d,\"static_surfaces\":%d,\"surface_pool\":%d,\"objects\":%d,\"object_pool\":%d}",
             gSurfacesAllocated, gNumStaticSurfaces, sSurfacePoolSize, live, OBJECT_POOL_CAPACITY);
    return sDbgJson;
}

// ---------------------------------------------------------------------------
// Mario: everything a play-tester wants to see.

EMSCRIPTEN_KEEPALIVE
const char *studio_debug_mario_json(void) {
    struct MarioState *m = gMarioState;
    if (m == NULL || gMarioObject == NULL || gCurrentArea == NULL) {
        snprintf(sDbgJson, sizeof(sDbgJson), "{\"timer\":%u}", gGlobalTimer);
        return sDbgJson;
    }
    snprintf(sDbgJson, sizeof(sDbgJson),
             "{\"timer\":%u,\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"vx\":%.2f,\"vy\":%.2f,\"vz\":%.2f,"
             "\"fvel\":%.2f,\"slideX\":%.2f,\"slideZ\":%.2f,\"yaw\":%d,\"pitch\":%d,"
             "\"action\":%u,\"prevAction\":%u,\"actionState\":%d,\"actionTimer\":%d,\"actionArg\":%u,"
             "\"health\":%d,\"hurt\":%d,\"invinc\":%d,\"coins\":%d,\"stars\":%d,\"lives\":%d,"
             "\"floorY\":%.1f,\"floorType\":%d,\"floorNy\":%.3f,\"ceilY\":%.1f,\"waterY\":%d,"
             "\"wall\":%d,\"peakY\":%.1f,\"quicksand\":%.1f,\"flags\":%u,\"input\":%u,"
             "\"stick\":%.2f,\"held\":%d,\"level\":%d,\"area\":%d}",
             gGlobalTimer, m->pos[0], m->pos[1], m->pos[2], m->vel[0], m->vel[1], m->vel[2],
             m->forwardVel, m->slideVelX, m->slideVelZ, (s32) m->faceAngle[1], (s32) m->faceAngle[0],
             m->action, m->prevAction, m->actionState, m->actionTimer, m->actionArg,
             m->health >> 8, m->hurtCounter, m->invincTimer, m->numCoins, m->numStars, m->numLives,
             m->floorHeight, m->floor ? m->floor->type : -1, m->floor ? m->floor->normal.y : 0.0f,
             m->ceilHeight, m->waterLevel, m->wall != NULL, m->peakHeight, m->quicksandDepth,
             m->flags, m->input, m->intendedMag, m->heldObj != NULL, gCurrLevelNum,
             gCurrentArea->index);
    return sDbgJson;
}

// ---------------------------------------------------------------------------
// Frame advance and slow motion. The web main loop asks studio_debug_gate()
// before every game frame: 0 skips it (the picture stays as it was).

static s32 sFrozen;     // frame advance: only stepped frames run
static s32 sStepFrames; // frames still to run while frozen
static s32 sSlowDiv = 1; // slow motion: one game frame every n display frames
static u32 sGateTick;
static u32 sFramesRun;

EMSCRIPTEN_KEEPALIVE
void studio_debug_speed(s32 frozen, s32 slowDiv) {
    sFrozen = frozen != 0;
    sSlowDiv = slowDiv < 1 ? 1 : slowDiv > 30 ? 30 : slowDiv;
    if (!sFrozen) {
        sStepFrames = 0;
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_debug_step(s32 frames) {
    sStepFrames += frames < 1 ? 1 : frames;
}

EMSCRIPTEN_KEEPALIVE
u32 studio_debug_frames(void) {
    return sFramesRun;
}

// Tests: an object's action (and set it, action >= 0: sub-action and timer start over).
EMSCRIPTEN_KEEPALIVE
s32 studio_debug_obj_action(s32 slot, s32 action) {
    struct Object *obj;
    s32 prev;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return -1;
    }
    obj = &gObjectPool[slot];
    prev = obj->oAction;
    if (action >= 0) {
        obj->oAction = action;
        obj->oSubAction = 0;
        obj->oTimer = 0;
    }
    return prev;
}

s32 studio_debug_gate(void) {
    sGateTick++;
    if (sFrozen) {
        if (sStepFrames > 0) {
            sStepFrames--;
            sFramesRun++;
            return 1;
        }
        return 0;
    }
    if (sSlowDiv > 1 && (sGateTick % (u32) sSlowDiv) != 0) {
        return 0;
    }
    sFramesRun++;
    return 1;
}

// ---------------------------------------------------------------------------
// The save file: stars per course, flags (keys, caps, doors), coin scores.

static s32 file_index(void) {
    s32 f = gCurrSaveFileNum - 1;
    return f < 0 || f >= NUM_SAVE_FILES ? 0 : f;
}

EMSCRIPTEN_KEEPALIVE
const char *studio_save_json(void) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    s32 i, len;
    len = snprintf(sDbgJson, sizeof(sDbgJson), "{\"file\":%d,\"flags\":%u,\"total\":%d,\"stars\":[",
                   file_index(), sf->flags,
                   save_file_get_total_star_count(file_index(), COURSE_MIN - 1, COURSE_MAX - 1));
    for (i = 0; i < COURSE_COUNT && len < (s32) sizeof(sDbgJson) - 64; i++) {
        len += snprintf(sDbgJson + len, sizeof(sDbgJson) - len, "%s%u", i ? "," : "",
                        (u32) (sf->courseStars[i] & 0x7f));
    }
    len += snprintf(sDbgJson + len, sizeof(sDbgJson) - len, "],\"cannons\":[");
    for (i = 0; i < COURSE_COUNT && len < (s32) sizeof(sDbgJson) - 64; i++) {
        len += snprintf(sDbgJson + len, sizeof(sDbgJson) - len, "%s%d", i ? "," : "",
                        (sf->courseStars[i] & 0x80) ? 1 : 0);
    }
    len += snprintf(sDbgJson + len, sizeof(sDbgJson) - len, "],\"coins\":[");
    for (i = 0; i < COURSE_STAGES_COUNT && len < (s32) sizeof(sDbgJson) - 32; i++) {
        len += snprintf(sDbgJson + len, sizeof(sDbgJson) - len, "%s%d", i ? "," : "",
                        sf->courseCoinScores[i]);
    }
    snprintf(sDbgJson + len, sizeof(sDbgJson) - len, "]}");
    return sDbgJson;
}

static void save_changed(void) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    sf->flags |= SAVE_FLAG_FILE_EXISTS;
    gSaveFileModified = TRUE;
    save_file_do_save(file_index());
}

// Stars of one course (index 0 = Bob-omb Battlefield ... 24 = castle secret stars), bits 0-6.
EMSCRIPTEN_KEEPALIVE
void studio_save_set_course(s32 course, u32 bits) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    if (course < 0 || course >= COURSE_COUNT) {
        return;
    }
    sf->courseStars[course] = (sf->courseStars[course] & 0x80) | (bits & 0x7f);
    save_changed();
}

EMSCRIPTEN_KEEPALIVE
void studio_save_set_cannon(s32 course, s32 open) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    if (course < 0 || course >= COURSE_COUNT) {
        return;
    }
    sf->courseStars[course] = open ? (sf->courseStars[course] | 0x80) : (sf->courseStars[course] & 0x7f);
    save_changed();
}

EMSCRIPTEN_KEEPALIVE
void studio_save_set_flags(u32 set, u32 clear) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    sf->flags = (sf->flags & ~clear) | set;
    save_changed();
}

EMSCRIPTEN_KEEPALIVE
void studio_save_set_coins(s32 course, s32 coins) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    if (course < 0 || course >= COURSE_STAGES_COUNT) {
        return;
    }
    sf->courseCoinScores[course] = coins < 0 ? 0 : coins > 255 ? 255 : coins;
    save_changed();
}

// A fresh save file: no stars, no keys, closed doors.
EMSCRIPTEN_KEEPALIVE
void studio_save_reset(void) {
    struct SaveFile *sf = &gSaveBuffer.files[file_index()][0];
    memset(sf->courseStars, 0, sizeof(sf->courseStars));
    memset(sf->courseCoinScores, 0, sizeof(sf->courseCoinScores));
    sf->flags = SAVE_FLAG_FILE_EXISTS;
    save_changed();
}

// Read the save again from storage (the page put a project's save there after the game started).
EMSCRIPTEN_KEEPALIVE
void studio_save_reload(void) {
    save_file_load_all();
}

// ---------------------------------------------------------------------------
// Validator queries.

// Walls around a point: [count, then per wall: signed distance of the point from the
// wall's plane (negative = behind it, inside the geometry)].
static f32 sWallBuf[1 + 8];

EMSCRIPTEN_KEEPALIVE
f32 *studio_debug_walls(f32 x, f32 y, f32 z, f32 radius, f32 offsetY) {
    struct WallCollisionData col;
    s32 i, n;
    col.x = x;
    col.y = y;
    col.z = z;
    col.radius = radius;
    col.offsetY = offsetY;
    col.numWalls = 0;
    n = find_wall_collisions(&col);
    // find_wall_collisions pushes the point out; measure from where it was
    if (n > 4) {
        n = 4;
    }
    for (i = 0; i < n; i++) {
        struct Surface *w = col.walls[i];
        sWallBuf[1 + i * 2] = w->normal.x * x + w->normal.y * (y + offsetY) + w->normal.z * z + w->originOffset;
        sWallBuf[2 + i * 2] = w->type;
    }
    sWallBuf[0] = (f32) n;
    return sWallBuf;
}

EMSCRIPTEN_KEEPALIVE
f32 studio_debug_ceil(f32 x, f32 y, f32 z) {
    struct Surface *ceil = NULL;
    f32 h = find_ceil(x, y, z, &ceil);
    return ceil != NULL ? h : 32000.0f;
}

// Floor type right below a point (-1: none).
EMSCRIPTEN_KEEPALIVE
s32 studio_debug_floor_type(f32 x, f32 y, f32 z) {
    struct Surface *floor = NULL;
    find_floor(x, y, z, &floor);
    return floor != NULL ? floor->type : -1;
}

// ---------------------------------------------------------------------------
// Save states copy the whole wasm memory up to the heap's end; afterwards the
// renderer's caches must forget what the GPU had bound.

EMSCRIPTEN_KEEPALIVE
u32 studio_heap_end(void) {
    return (u32) (uintptr_t) sbrk(0);
}

void gfx_studio_before_load(void);
void gfx_studio_invalidate(void);

EMSCRIPTEN_KEEPALIVE
void studio_before_state_load(void) {
    gfx_studio_before_load();
}

EMSCRIPTEN_KEEPALIVE
void studio_after_state_load(void) {
    gfx_studio_invalidate();
}

// ---------------------------------------------------------------------------
// Frame-exact recording (bots, trailers, input replays): a scripted controller for player 1
// and a tap on the game's audio. With frame advance (studio_debug_speed(1, 1) +
// studio_debug_step) every frame gets exactly the inputs set before it, and its sound is
// synthesized for exactly that frame, so a take plays back the same every time.

s32 gStudioBotOn;          // 1: player 1's controller and stick come from here
s32 gStudioBotButtons;     // N64 button bits held this frame (A_BUTTON, B_BUTTON, Z_TRIG, ...)
s16 gStudioBotYaw;         // stick direction as a world yaw (camera independent)
f32 gStudioBotMag;         // stick strength 0..64 (64 = full tilt)
s32 gStudioBotRaw;         // 1: the raw stick below goes to the controller too (cars steer with it)
f32 gStudioBotStickX, gStudioBotStickY;

// The raw stick (-64..64) for things that read the controller directly, like a car's steering.
EMSCRIPTEN_KEEPALIVE
void studio_bot_stick(s32 on, f32 x, f32 y) {
    gStudioBotRaw = on != 0;
    gStudioBotStickX = x;
    gStudioBotStickY = y;
}

EMSCRIPTEN_KEEPALIVE
void studio_bot(s32 on, s32 buttons, s32 yaw, f32 mag) {
    gStudioBotOn = on != 0;
    gStudioBotButtons = buttons;
    gStudioBotYaw = (s16) yaw;
    gStudioBotMag = mag < 0.0f ? 0.0f : mag > 64.0f ? 64.0f : mag;
}

// game_init.c, after the controllers are read: the bot's buttons replace player 1's.
void studio_bot_controller(struct Controller *c) {
    if (!gStudioBotOn || c == NULL) {
        return;
    }
    c->buttonPressed = gStudioBotButtons & (gStudioBotButtons ^ c->buttonDown);
    c->buttonDown = gStudioBotButtons;
    c->rawStickX = c->rawStickY = 0;
    c->stickX = c->stickY = 0.0f;
    c->stickMag = gStudioBotMag; // the stick itself is read as a world yaw in mario.c
    if (gStudioBotRaw) {
        c->stickX = gStudioBotStickX;
        c->stickY = gStudioBotStickY;
        c->rawStickX = (s16) gStudioBotStickX;
        c->rawStickY = (s16) gStudioBotStickY;
    }
}

// The audio tap: pc_main.c makes exactly two audio chunks per game frame while it is on
// (544 + 528 samples, alternating, like a real-time 30 fps run), appends them here and leaves
// the speakers alone. JS reads studio_audio_tap_ptr/len (stereo s16 at 32 kHz) after a frame
// and empties it with studio_audio_tap_clear.
#define TAP_MAX (32000 * 2 * 8) // 8 s of stereo samples between reads
s32 gStudioAudioTap;
static s16 sTap[TAP_MAX];
static s32 sTapLen;
static u32 sTapSavedMusic = 0xFFFFFFFF;

EMSCRIPTEN_KEEPALIVE
void studio_audio_tap(s32 on, s32 musicVolume) {
    extern unsigned int configMusicVolume;
    gStudioAudioTap = on != 0;
    sTapLen = 0;
    if (on && musicVolume >= 0) {
        if (sTapSavedMusic == 0xFFFFFFFF) {
            sTapSavedMusic = configMusicVolume;
        }
        configMusicVolume = (unsigned int) musicVolume;
    } else if (!on && sTapSavedMusic != 0xFFFFFFFF) {
        configMusicVolume = sTapSavedMusic;
        sTapSavedMusic = 0xFFFFFFFF;
    }
}

void studio_audio_tap_add(const s16 *samples, s32 count) {
    if (sTapLen + count > TAP_MAX) {
        count = TAP_MAX - sTapLen;
    }
    if (count > 0) {
        memcpy(sTap + sTapLen, samples, count * sizeof(s16));
        sTapLen += count;
    }
}

EMSCRIPTEN_KEEPALIVE
s16 *studio_audio_tap_ptr(void) {
    return sTap;
}

EMSCRIPTEN_KEEPALIVE
s32 studio_audio_tap_len(void) {
    return sTapLen;
}

EMSCRIPTEN_KEEPALIVE
void studio_audio_tap_clear(void) {
    sTapLen = 0;
}

// One object's live state (bots and tests): action, health, held state, motion.
EMSCRIPTEN_KEEPALIVE
const char *studio_debug_obj_json(s32 slot) {
    static char buf[512];
    struct Object *obj;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) {
        return "null";
    }
    obj = &gObjectPool[slot];
    snprintf(buf, sizeof(buf),
             "{\"active\":%d,\"action\":%d,\"sub\":%d,\"timer\":%d,\"health\":%d,\"held\":%d,"
             "\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"yaw\":%d,\"faceYaw\":%d,\"angleVelYaw\":%d,"
             "\"fvel\":%.2f,\"vy\":%.2f,\"opacity\":%d,\"anim\":%d,\"animFrame\":%d}",
             obj->activeFlags != 0, obj->oAction, obj->oSubAction, obj->oTimer, obj->oHealth,
             obj->oHeldState, obj->oPosX, obj->oPosY, obj->oPosZ, (s32) (s16) obj->oMoveAngleYaw,
             (s32) (s16) obj->oFaceAngleYaw, obj->oAngleVelYaw, obj->oForwardVel, obj->oVelY,
             obj->oOpacity, obj->oAnimState, obj->header.gfx.unk38.animFrame);
    return buf;
}
