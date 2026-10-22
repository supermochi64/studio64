// Studio 64 custom objects: enemies and characters made in the studio without code.
//
// bhvStudioActor takes any catalog model and gets its behavior from building
// blocks the page sets per object (studio_actor_set): how it moves (stands, wanders,
// patrols a path, chases Mario, shoots), jumping, health, contact damage, what
// defeats it (stomps, punches, nothing), how it goes, coins, sounds.
// bhvStudioProjectile is what shooters fire; bhvStudioMover is a catalog model with
// the collision of its original object, moved by a motion (see motion.c).

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
#include "behavior_data.h"
#include "audio_defines.h"
#include "object_constants.h"
#include "audio/external.h"
#include "engine/behavior_script.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"
#include "game/interaction.h"
#include "game/game_init.h"
#include "game/level_update.h"
#include "game/mario.h"
#include "game/memory.h"
#include "game/object_helpers.h"
#include "game/object_list_processor.h"
#include "game/behavior_actions.h"
#include "game/spawn_sound.h"
#include "studio.h"
#include "objects.h"

#define o gCurrentObject

s32 studio_spawn_custom(s32 bhvIndex, s32 modelIndex, f32 x, f32 y, f32 z, s32 yaw, s32 bparams, s32 uid, f32 scale);

// Layout of the float array the page passes (keep in sync with web/js/actors.js).
enum {
    A_MOVE, A_SPEED, A_CHASE_SPEED, A_SIGHT, A_LEASH,
    A_JUMP, A_JUMP_VEL, A_JUMP_EVERY,
    A_HEALTH, A_DAMAGE, A_FLAGS, A_DEFEAT, A_COINS, A_COIN_KIND,
    A_SND_ALERT_HI, A_SND_ALERT_LO, A_SND_HIT_HI, A_SND_HIT_LO, A_SND_DEFEAT_HI, A_SND_DEFEAT_LO,
    A_SND_ATTACK_HI, A_SND_ATTACK_LO,
    A_HIT_R, A_HIT_H,
    A_FIRE_EVERY, A_PROJ_MODEL, A_PROJ_SPEED, A_PROJ_DAMAGE, A_PROJ_GRAVITY,
    A_ANIM_FROM, A_ANIM, A_RESPAWN, A_GRAVITY, A_TURN, A_HOVER, A_PROJ_SCALE,
    A_COUNT
};

enum { MOVE_STAND, MOVE_WANDER, MOVE_PATROL, MOVE_CHASE, MOVE_TURRET };
enum { JUMP_NONE, JUMP_HOP, JUMP_AT_MARIO, JUMP_WALLS };
enum { DEFEAT_POOF, DEFEAT_SQUISH, DEFEAT_EXPLODE, DEFEAT_LAUNCH, DEFEAT_SHRINK };

#define AF_STOMP        (1 << 0)
#define AF_PUNCH        (1 << 1)
#define AF_INVINCIBLE   (1 << 2)
#define AF_FLY          (1 << 3)
#define AF_FACE_MARIO   (1 << 4)
#define AF_SHOOT        (1 << 5)
#define AF_RESPAWN      (1 << 6)
#define AF_NO_KNOCKBACK (1 << 7)
#define AF_HARMLESS     (1 << 8)
#define AF_FLAME        (1 << 9)

enum { ST_ALIVE, ST_DYING, ST_GONE };

// events for the page (Module.studioObjectEvent(uid, event))
#define EV_DEFEATED 1
#define EV_HURT_MARIO 2
#define EV_SPOTTED 3
#define EV_HIT 4

struct ActorState {
    struct Object *obj;
    u32 uid;
    f32 cfg[A_COUNT];
    s32 inited, state, stateT, health, invuln, chasing, idleT, shotT, wp, wpDir, waitT, respawnT;
    f32 tx, tz, baseScale[3];
};

static struct ActorState *sActors[OBJECT_POOL_CAPACITY];
static s32 sProjectileBhv = -1;

static struct ActorState *actor_of(struct Object *obj) {
    s32 slot = obj - gObjectPool;
    struct ActorState *a;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) return NULL;
    a = sActors[slot];
    if (a == NULL || a->obj != obj || a->uid == 0 || obj->unused2 != a->uid) return NULL;
    return a;
}

static void actor_event(struct Object *obj, s32 ev) {
    EM_ASM({
        if (Module.studioObjectEvent) setTimeout(() => Module.studioObjectEvent($0 >>> 0, $1), 0);
    }, obj->unused2, ev);
}

static void play_cfg_sound(struct ActorState *a, s32 hi) {
    u32 bits = ((u32) a->cfg[hi] << 16) | ((u32) a->cfg[hi + 1] & 0xFFFF);
    if (bits != 0) {
        cur_obj_play_sound_2(bits);
    }
}

// The first LOAD_ANIMATIONS / LOAD_COLLISION_DATA of a behavior's setup (before its loop).
static const void *script_find(const BehaviorScript *bhv, u32 cmd, s32 field) {
    s32 i;
    if (bhv == NULL) return NULL;
    for (i = 0; i < 48; i++) {
        uintptr_t w = bhv[i];
        u32 c = (w >> 24) & 0xFF;
        if (c == 0x08 || c == 0x09 || c == 0x0A) break; // BEGIN_LOOP, END_LOOP, BREAK
        if (c == cmd && (field < 0 ? (w & 0x00FFFFFF) == 0 : ((w >> 16) & 0xFF) == (u32) field)) {
            uintptr_t p = bhv[i + 1];
            if (p > 0x1000) return (const void *) p;
        }
    }
    return NULL;
}

static const void *catalog_anims(s32 index) {
    if (index < 0 || index >= gStudioCatalogCount) return NULL;
    return script_find(gStudioCatalog[index].behavior, 0x27, 0x26);
}

static const void *catalog_collision(s32 index) {
    if (index < 0 || index >= gStudioCatalogCount) return NULL;
    return script_find(gStudioCatalog[index].behavior, 0x2A, -1);
}

static s32 bhv_index(const BehaviorScript *bhv) {
    s32 i;
    for (i = 0; i < gStudioBehaviorCount; i++) {
        if (gStudioBehaviors[i].script == bhv) return i;
    }
    return -1;
}

// ---- custom objects ---------------------------------------------------------------

static void actor_hitbox(struct ActorState *a) {
    s32 flags = (s32) a->cfg[A_FLAGS];
    struct ObjectHitbox hb;
    memset(&hb, 0, sizeof(hb));
    if (flags & AF_INVINCIBLE) hb.interactType = INTERACT_DAMAGE;
    else if (flags & AF_STOMP) hb.interactType = INTERACT_BOUNCE_TOP;
    else if (flags & AF_PUNCH) hb.interactType = INTERACT_UNKNOWN_08;
    else hb.interactType = INTERACT_DAMAGE;
    if ((flags & AF_HARMLESS) && hb.interactType == INTERACT_DAMAGE) hb.interactType = INTERACT_BOUNCE_TOP;
    hb.downOffset = 0;
    hb.damageOrCoinValue = (flags & AF_HARMLESS) ? 0 : (s32) a->cfg[A_DAMAGE];
    hb.health = 0;
    hb.numLootCoins = 0;
    hb.radius = a->cfg[A_HIT_R] > 0 ? a->cfg[A_HIT_R] : 70;
    hb.height = a->cfg[A_HIT_H] > 0 ? a->cfg[A_HIT_H] : 80;
    hb.hurtboxRadius = hb.radius * 0.8f;
    hb.hurtboxHeight = hb.height * 0.8f;
    o->oInteractType = hb.interactType;
    o->oDamageOrCoinValue = hb.damageOrCoinValue;
    obj_set_hitbox(o, &hb);
    o->oInteractType = hb.interactType;
    o->oDamageOrCoinValue = hb.damageOrCoinValue;
}

static void actor_init(struct ActorState *a) {
    const void *anims = catalog_anims((s32) a->cfg[A_ANIM_FROM]);
    a->inited = TRUE;
    a->state = ST_ALIVE;
    a->health = a->cfg[A_HEALTH] > 0 ? (s32) a->cfg[A_HEALTH] : 1;
    a->wp = 0;
    a->wpDir = 1;
    a->tx = o->oHomeX;
    a->tz = o->oHomeZ;
    a->idleT = (s32) (random_float() * 40);
    a->shotT = (s32) (random_float() * 30);
    vec3f_copy(a->baseScale, o->header.gfx.scale);
    o->oGravity = a->cfg[A_GRAVITY] > 0 ? -a->cfg[A_GRAVITY] : -2.5f;
    o->oFriction = 0.8f;
    o->oBuoyancy = 1.3f;
    o->oWallHitboxRadius = (a->cfg[A_HIT_R] > 0 ? a->cfg[A_HIT_R] : 70) * 0.6f;
    o->oInteractStatus = 0;
    o->oIntangibleTimer = 0;
    if (anims != NULL) {
        o->oAnimations = (struct Animation **) anims;
        cur_obj_init_animation((s32) a->cfg[A_ANIM]);
    }
    actor_hitbox(a);
}

static void shoot(struct ActorState *a) {
    struct Object *p;
    s32 slot;
    f32 speed = a->cfg[A_PROJ_SPEED] > 0 ? a->cfg[A_PROJ_SPEED] : 30, dx, dy, dz, d, scale;
    f32 sx = o->oPosX + sins(o->oMoveAngleYaw) * 60, sz = o->oPosZ + coss(o->oMoveAngleYaw) * 60;
    f32 sy = o->oPosY + (a->cfg[A_HIT_H] > 0 ? a->cfg[A_HIT_H] : 80) * o->header.gfx.scale[1] * 0.6f;
    if (sProjectileBhv < 0) sProjectileBhv = bhv_index(bhvStudioProjectile);
    if (sProjectileBhv < 0 || gMarioObject == NULL) return;
    scale = a->cfg[A_PROJ_SCALE] > 0 ? a->cfg[A_PROJ_SCALE] : 1.0f;
    slot = studio_spawn_custom(sProjectileBhv, (s32) a->cfg[A_PROJ_MODEL], sx, sy, sz, o->oMoveAngleYaw,
                               ((s32) a->cfg[A_FLAGS] & AF_FLAME) ? 1 : 0, 0, scale);
    if (slot < 0) return;
    p = &gObjectPool[slot];
    dx = gMarioObject->oPosX - sx;
    dy = gMarioObject->oPosY + 60 - sy;
    dz = gMarioObject->oPosZ - sz;
    d = sqrtf(dx * dx + dy * dy + dz * dz);
    if (d < 1) d = 1;
    p->oVelX = dx / d * speed;
    p->oVelY = dy / d * speed;
    p->oVelZ = dz / d * speed;
    p->oGravity = a->cfg[A_PROJ_GRAVITY];
    if (p->oGravity > 0) {
        // lob it: aim higher so it arcs onto Mario
        f32 t = d / speed;
        p->oVelY += p->oGravity * t / 2;
    }
    p->oDamageOrCoinValue = a->cfg[A_PROJ_DAMAGE] > 0 ? (s32) a->cfg[A_PROJ_DAMAGE] : 1;
    p->parentObj = o;
    play_cfg_sound(a, A_SND_ATTACK_HI);
}

static void defeat_effect(struct ActorState *a) {
    s32 coins = (s32) a->cfg[A_COINS];
    if (coins > 0) {
        o->oNumLootCoins = coins; // the loot helpers count this down
        if ((s32) a->cfg[A_COIN_KIND] == 1) obj_spawn_loot_blue_coins(o, coins, 20.0f, 150);
        else obj_spawn_loot_yellow_coins(o, coins, 20.0f);
    }
    if ((s32) a->cfg[A_DEFEAT] == DEFEAT_EXPLODE) {
        spawn_mist_particles_variable(0, 0, 100.0f);
        spawn_triangle_break_particles(20, 138, 3.0f, 4);
        cur_obj_play_sound_2(SOUND_GENERAL2_BOBOMB_EXPLOSION);
    } else {
        spawn_mist_particles();
    }
}

static void actor_gone(struct ActorState *a) {
    actor_event(o, EV_DEFEATED);
    if (((s32) a->cfg[A_FLAGS] & AF_RESPAWN) && a->cfg[A_RESPAWN] > 0) {
        a->state = ST_GONE;
        a->respawnT = (s32) a->cfg[A_RESPAWN];
        o->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
        cur_obj_become_intangible();
    } else {
        obj_mark_for_deletion(o);
        a->uid = 0;
    }
}

static void actor_hit(struct ActorState *a, s32 stomp) {
    a->health--;
    actor_event(o, EV_HIT);
    if (a->health > 0) {
        play_cfg_sound(a, A_SND_HIT_HI);
        a->invuln = 30;
        if (!((s32) a->cfg[A_FLAGS] & AF_NO_KNOCKBACK)) {
            o->oMoveAngleYaw = o->oAngleToMario;
            o->oForwardVel = -30.0f;
            if (!((s32) a->cfg[A_FLAGS] & AF_FLY)) o->oVelY = 25.0f;
        }
        cur_obj_become_intangible();
        return;
    }
    play_cfg_sound(a, A_SND_DEFEAT_HI);
    a->state = ST_DYING;
    a->stateT = 0;
    cur_obj_become_intangible();
    if (stomp && (s32) a->cfg[A_DEFEAT] == DEFEAT_LAUNCH) {
        o->oVelY = 10;
    }
}

static s32 actor_interact(struct ActorState *a) {
    u32 st = o->oInteractStatus;
    s32 flags = (s32) a->cfg[A_FLAGS];
    if (!(st & INT_STATUS_INTERACTED)) return FALSE;
    o->oInteractStatus = 0;
    if (st & INT_STATUS_WAS_ATTACKED) {
        u32 atk = st & INT_STATUS_ATTACK_MASK;
        s32 stomp = atk == ATTACK_FROM_ABOVE || atk == ATTACK_GROUND_POUND_OR_TWIRL;
        s32 ok = !(flags & AF_INVINCIBLE) && (stomp ? (flags & AF_STOMP) : (flags & AF_PUNCH));
        if (ok) {
            actor_hit(a, stomp);
            return TRUE;
        }
    } else if (st & INT_STATUS_ATTACKED_MARIO) {
        play_cfg_sound(a, A_SND_ATTACK_HI);
        actor_event(o, EV_HURT_MARIO);
    }
    return FALSE;
}

static void actor_dying(struct ActorState *a) {
    s32 kind = (s32) a->cfg[A_DEFEAT];
    a->stateT++;
    o->oForwardVel = 0;
    if (kind == DEFEAT_SQUISH) {
        f32 t = a->stateT < 8 ? a->stateT / 8.0f : 1.0f;
        o->header.gfx.scale[1] = a->baseScale[1] * (1.0f - 0.7f * t);
        o->header.gfx.scale[0] = a->baseScale[0] * (1.0f + 0.3f * t);
        o->header.gfx.scale[2] = a->baseScale[2] * (1.0f + 0.3f * t);
        if (a->stateT > 20) { defeat_effect(a); actor_gone(a); }
    } else if (kind == DEFEAT_SHRINK) {
        f32 t = a->stateT / 16.0f;
        if (t > 1) t = 1;
        o->header.gfx.scale[0] = a->baseScale[0] * (1 - t);
        o->header.gfx.scale[1] = a->baseScale[1] * (1 - t);
        o->header.gfx.scale[2] = a->baseScale[2] * (1 - t);
        if (a->stateT > 16) { defeat_effect(a); actor_gone(a); }
    } else if (kind == DEFEAT_LAUNCH) {
        if (a->stateT == 1) { o->oVelY = 45; o->oForwardVel = 0; }
        o->oPosY += o->oVelY;
        o->oVelY -= 3;
        o->oPosX -= sins(o->oAngleToMario) * 20;
        o->oPosZ -= coss(o->oAngleToMario) * 20;
        o->oFaceAngleYaw += 0x1800;
        o->oMoveAngleYaw = o->oFaceAngleYaw;
        if (a->stateT > 30) { defeat_effect(a); actor_gone(a); }
    } else {
        defeat_effect(a);
        actor_gone(a);
    }
}

static void actor_respawn(struct ActorState *a) {
    if (--a->respawnT > 0) return;
    o->oPosX = o->oHomeX;
    o->oPosY = o->oHomeY;
    o->oPosZ = o->oHomeZ;
    vec3f_copy(o->header.gfx.scale, a->baseScale);
    o->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    a->state = ST_ALIVE;
    a->health = a->cfg[A_HEALTH] > 0 ? (s32) a->cfg[A_HEALTH] : 1;
    a->invuln = 30;
    spawn_mist_particles();
}

static s32 next_waypoint(struct ActorState *a, s32 n, s32 mode) {
    s32 next = a->wp + a->wpDir;
    if (next >= n) {
        if (mode == 1) { a->wpDir = -1; next = n - 2; } // ping-pong
        else next = 0;
    } else if (next < 0) {
        a->wpDir = 1;
        next = 1;
    }
    if (next < 0) next = 0;
    return next;
}

static void actor_move(struct ActorState *a) {
    s32 move = (s32) a->cfg[A_MOVE], flags = (s32) a->cfg[A_FLAGS];
    f32 speed = a->cfg[A_SPEED] > 0 ? a->cfg[A_SPEED] : 6, chase = a->cfg[A_CHASE_SPEED] > 0 ? a->cfg[A_CHASE_SPEED] : speed * 2;
    f32 sight = a->cfg[A_SIGHT] > 0 ? a->cfg[A_SIGHT] : 1200, leash = a->cfg[A_LEASH] > 0 ? a->cfg[A_LEASH] : 1500;
    f32 targetSpeed = 0, homeDist = cur_obj_lateral_dist_to_home(), targetY = o->oHomeY;
    s16 targetYaw = o->oMoveAngleYaw;
    s32 fly = flags & AF_FLY, onGround = (o->oMoveFlags & OBJ_MOVE_MASK_ON_GROUND) != 0;
    s32 sees = gMarioObject != NULL && o->oDistanceToMario < sight
               && absf(gMarioObject->oPosY - o->oPosY) < (fly ? 1500 : 700);
    s16 turn = (s16) ((a->cfg[A_TURN] > 0 ? a->cfg[A_TURN] : 8) * 65536.0f / 360.0f);
    const f32 (*pts)[3] = NULL;
    s32 nPts = 0, pathMode = 0, pathWait = 0;

    if (move == MOVE_CHASE) {
        if (sees && homeDist < leash) {
            if (!a->chasing) { play_cfg_sound(a, A_SND_ALERT_HI); actor_event(o, EV_SPOTTED); }
            a->chasing = TRUE;
        } else if (!sees || homeDist > leash * 1.3f) {
            a->chasing = FALSE;
        }
    }
    if (a->chasing) {
        targetYaw = o->oAngleToMario;
        targetSpeed = chase;
        if (fly) targetY = gMarioObject->oPosY + 100;
    } else if (move == MOVE_WANDER || move == MOVE_CHASE) {
        f32 dx = a->tx - o->oPosX, dz = a->tz - o->oPosZ;
        if (a->idleT > 0) {
            a->idleT--;
        } else if (dx * dx + dz * dz < 80 * 80 || (o->oMoveFlags & OBJ_MOVE_HIT_WALL)) {
            // pick a new spot to walk to
            f32 r = (move == MOVE_CHASE ? leash * 0.4f : leash) * random_float();
            s16 ang = random_u16();
            a->tx = o->oHomeX + sins(ang) * r;
            a->tz = o->oHomeZ + coss(ang) * r;
            a->idleT = 20 + (s32) (random_float() * 50);
        } else {
            targetYaw = atan2s(dz, dx);
            targetSpeed = speed;
        }
    } else if (move == MOVE_PATROL) {
        nPts = studio_motion_path(o, &pts, &pathMode, &pathWait);
        if (nPts >= 2) {
            f32 dx, dz;
            if (a->wp >= nPts) a->wp = 0;
            dx = pts[a->wp][0] - o->oPosX;
            dz = pts[a->wp][2] - o->oPosZ;
            if (a->waitT > 0) {
                a->waitT--;
            } else if (dx * dx + dz * dz < 60 * 60) {
                a->wp = next_waypoint(a, nPts, pathMode);
                a->waitT = pathWait;
            } else {
                targetYaw = atan2s(dz, dx);
                targetSpeed = speed;
                if (fly) targetY = pts[a->wp][1];
            }
        }
        // a patroller that sees Mario turns to him when it can shoot
        if (sees && (flags & AF_SHOOT)) targetYaw = o->oAngleToMario;
    }
    if ((move == MOVE_STAND || move == MOVE_TURRET) && sees && (flags & AF_FACE_MARIO || move == MOVE_TURRET)) {
        targetYaw = o->oAngleToMario;
    }
    if ((flags & AF_SHOOT || move == MOVE_TURRET) && sees) {
        s32 every = a->cfg[A_FIRE_EVERY] > 0 ? (s32) a->cfg[A_FIRE_EVERY] : 60;
        if (++a->shotT >= every) {
            a->shotT = 0;
            shoot(a);
        }
    }
    if (move == MOVE_STAND || move == MOVE_TURRET) targetSpeed = 0;

    o->oMoveAngleYaw = approach_s16_symmetric(o->oMoveAngleYaw, targetYaw, turn);
    if (a->invuln > 20) {
        // knocked back: no steering for a moment
    } else {
        o->oForwardVel = approach_f32(o->oForwardVel, targetSpeed, 1.5f, 2.5f);
    }

    if (fly) {
        f32 hover = a->cfg[A_HOVER];
        if (!a->chasing) targetY += hover * sins(gGlobalTimer * 0x300);
        o->oVelY = approach_f32(o->oVelY, (targetY - o->oPosY) * 0.1f, 1.0f, 1.0f);
        o->oPosX += sins(o->oMoveAngleYaw) * o->oForwardVel;
        o->oPosZ += coss(o->oMoveAngleYaw) * o->oForwardVel;
        o->oPosY += o->oVelY;
        {
            f32 fl = find_floor_height(o->oPosX, o->oPosY + 100, o->oPosZ);
            if (o->oPosY < fl + 20) o->oPosY = fl + 20;
        }
    } else {
        // jumping
        s32 jump = (s32) a->cfg[A_JUMP];
        f32 jv = a->cfg[A_JUMP_VEL] > 0 ? a->cfg[A_JUMP_VEL] : 40;
        s32 every = a->cfg[A_JUMP_EVERY] > 0 ? (s32) a->cfg[A_JUMP_EVERY] : 60;
        if (onGround && a->state == ST_ALIVE) {
            if ((jump == JUMP_HOP && (o->oTimer % every) == 0)
                || (jump == JUMP_AT_MARIO && a->chasing && ((o->oTimer % every) == 0 || gMarioObject->oPosY > o->oPosY + 150))
                || (jump == JUMP_WALLS && (o->oMoveFlags & OBJ_MOVE_HIT_WALL) && targetSpeed > 0)) {
                o->oVelY = jv;
            }
        }
        cur_obj_move_standard(-78);
    }
}

void bhv_studio_actor_init(void) {
    o->oFlags |= OBJ_FLAG_ACTIVE_FROM_AFAR;
}

void bhv_studio_actor_loop(void) {
    struct ActorState *a = actor_of(o);
    if (a == NULL) {
        // no building blocks yet: stand still and be solid to the touch
        return;
    }
    if (!a->inited) actor_init(a);
    if (a->state == ST_GONE) {
        actor_respawn(a);
        return;
    }
    if (!((s32) a->cfg[A_FLAGS] & AF_FLY)) cur_obj_update_floor_and_walls();
    if (a->state == ST_DYING) {
        actor_dying(a);
        if (!((s32) a->cfg[A_FLAGS] & AF_FLY) && (s32) a->cfg[A_DEFEAT] != DEFEAT_LAUNCH) cur_obj_move_standard(-78);
        return;
    }
    actor_hitbox(a);
    actor_interact(a);
    if (a->state != ST_ALIVE) return;
    if (a->invuln > 0) {
        a->invuln--;
        if (a->invuln == 0) cur_obj_become_tangible();
        // blink while it can't be hit
        if (a->invuln & 2) o->header.gfx.node.flags |= GRAPH_RENDER_INVISIBLE;
        else o->header.gfx.node.flags &= ~GRAPH_RENDER_INVISIBLE;
    }
    actor_move(a);
    // fell out of the level: back home
    if (o->oPosY < -9000) {
        o->oPosX = o->oHomeX;
        o->oPosY = o->oHomeY + 100;
        o->oPosZ = o->oHomeZ;
        o->oVelY = 0;
    }
}

// cfg: see the A_* layout.
EMSCRIPTEN_KEEPALIVE
s32 studio_actor_set(s32 slot, const f32 *cfg, s32 count) {
    struct Object *obj;
    struct ActorState *a;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || cfg == NULL) return 0;
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE) || obj->unused2 == 0 || obj->behavior != bhvStudioActor) return 0;
    a = sActors[slot];
    if (a == NULL) a = sActors[slot] = calloc(1, sizeof(struct ActorState));
    memset(a, 0, sizeof(*a));
    a->obj = obj;
    a->uid = obj->unused2;
    memcpy(a->cfg, cfg, sizeof(f32) * (count < A_COUNT ? count : A_COUNT));
    return 1;
}

void studio_actor_reset_all(void) {
    s32 i;
    for (i = 0; i < OBJECT_POOL_CAPACITY; i++) {
        if (sActors[i] != NULL) {
            sActors[i]->uid = 0;
            sActors[i]->obj = NULL;
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void studio_actors_reset(void) {
    studio_actor_reset_all();
}

static char sActorJson[192];
EMSCRIPTEN_KEEPALIVE
const char *studio_actor_state_json(s32 slot) {
    struct ActorState *a;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY || (a = actor_of(&gObjectPool[slot])) == NULL) return "null";
    snprintf(sActorJson, sizeof(sActorJson), "{\"state\":%d,\"health\":%d,\"chasing\":%d,\"wp\":%d,\"x\":%.0f,\"y\":%.0f,\"z\":%.0f}",
             a->state, a->health, a->chasing, a->wp, a->obj->oPosX, a->obj->oPosY, a->obj->oPosZ);
    return sActorJson;
}

// ---- projectiles --------------------------------------------------------------------

void bhv_studio_projectile_loop(void) {
    struct Surface *floor;
    f32 fl;
    if (o->oTimer == 0) {
        struct ObjectHitbox hb;
        f32 s = o->header.gfx.scale[0];
        memset(&hb, 0, sizeof(hb));
        hb.interactType = (o->oBehParams & 1) ? INTERACT_FLAME : INTERACT_DAMAGE;
        hb.damageOrCoinValue = o->oDamageOrCoinValue > 0 ? o->oDamageOrCoinValue : 1;
        hb.radius = 40;
        hb.height = 50;
        hb.hurtboxRadius = 40;
        hb.hurtboxHeight = 50;
        hb.downOffset = 25;
        (void) s;
        obj_set_hitbox(o, &hb);
        o->oInteractType = hb.interactType;
        o->oDamageOrCoinValue = hb.damageOrCoinValue;
    }
    o->oPosX += o->oVelX;
    o->oPosY += o->oVelY;
    o->oPosZ += o->oVelZ;
    o->oVelY -= o->oGravity;
    o->oFaceAngleYaw += 0x900;
    fl = find_floor(o->oPosX, o->oPosY + 80, o->oPosZ, &floor);
    if ((o->oInteractStatus & INT_STATUS_INTERACTED) || o->oTimer > 150 || (floor != NULL && o->oPosY < fl)
        || (floor == NULL && o->oTimer > 30)) {
        spawn_mist_particles_variable(0, 0, 30.0f);
        obj_mark_for_deletion(o);
        return;
    }
    {
        f32 x = o->oPosX, y = o->oPosY, z = o->oPosZ;
        if (f32_find_wall_collision(&x, &y, &z, 20.0f, 30.0f) > 0) {
            spawn_mist_particles_variable(0, 0, 30.0f);
            obj_mark_for_deletion(o);
        }
    }
}

// ---- movers: catalog models with their own collision, moved by a motion -----------

void bhv_studio_mover_loop(void) {
    if (studio_motion_update(o) && o->collisionData != NULL) {
        load_object_collision_model();
    }
}

// Gives a mover (spawned with studio_spawn_custom) the collision of catalog entry `index`.
EMSCRIPTEN_KEEPALIVE
s32 studio_mover_setup(s32 slot, s32 index, s32 pitch, s32 roll) {
    struct Object *obj;
    const void *col;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) return 0;
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE) || obj->behavior != bhvStudioMover) return 0;
    col = catalog_collision(index);
    obj->collisionData = (void *) col;
    obj->oFaceAnglePitch = obj->oMoveAnglePitch = pitch;
    obj->oFaceAngleRoll = obj->oMoveAngleRoll = roll;
    vec3s_set(obj->header.gfx.angle, pitch, obj->oFaceAngleYaw, roll);
    obj->oCollisionDistance = 4000.0f * (obj->header.gfx.scale[0] > 1 ? obj->header.gfx.scale[0] : 1);
    obj->oDrawingDistance = 20000.0f;
    return col != NULL;
}

// What a catalog entry's behavior brings: collision, animations.
static char sInfoJson[96];
EMSCRIPTEN_KEEPALIVE
const char *studio_catalog_info_json(s32 index) {
    snprintf(sInfoJson, sizeof(sInfoJson), "{\"collision\":%d,\"anims\":%d,\"surface\":%d}",
             catalog_collision(index) != NULL, catalog_anims(index) != NULL,
             index >= 0 && index < gStudioCatalogCount && gStudioCatalog[index].behavior != NULL
                 && ((gStudioCatalog[index].behavior[0] >> 16) & 0xFF) == OBJ_LIST_SURFACE);
    return sInfoJson;
}

// ---- imported models (src/studio/assets.c) for custom objects and movers ----------

#include "studio_assets.h"

// Draws a custom object or mover with imported model `assetId`; movers also get its collision.
EMSCRIPTEN_KEEPALIVE
s32 studio_object_asset_model(s32 slot, s32 assetId) {
    struct Object *obj;
    struct GraphNode *node;
    if (slot < 0 || slot >= OBJECT_POOL_CAPACITY) return 0;
    obj = &gObjectPool[slot];
    if (!(obj->activeFlags & ACTIVE_FLAG_ACTIVE)) return 0;
    node = studio_asset_model_node(assetId);
    if (node == NULL) return 0;
    obj->header.gfx.sharedChild = node;
    if (obj->behavior == bhvStudioMover) {
        obj->collisionData = studio_asset_model_collision(assetId);
        obj->oCollisionDistance = 6000.0f;
        obj->oDrawingDistance = 20000.0f;
    }
    return 1;
}
