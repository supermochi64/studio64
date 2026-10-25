#include "player.h"
#include "actor.h"
#include "camera.h"
#include "vehicle.h"
#include "weapon.h"
#include "world.h"
#include "gang.h"
#include "sound.h"

static V3 s_aim;
static bool s_aiming;

void player_spawn(V3 at, float yaw) {
  if (g.player) actor_free(g.player);
  g.player = actor_spawn(AK_PLAYER, GANG_PALM, at, yaw);
  g.player->brain = 0;
}

V3 player_aim_point(void) { return s_aim; }
int player_camera_mode(void) {
  Actor *p = g.player;
  if (!p) return CAM_FOOT;
  if (p->vehicle && p->state == ST_VEHICLE) return CAM_VEHICLE;
  if (s_aiming && weapon_is_gun(p->weapon) && !p->vehicle && p->state <= ST_LAND) return CAM_AIM;
  return CAM_FOOT;
}

// the best thing to aim at: in front of the camera (or the side of the car), near, visible
static int pick_target(Actor *p, V3 forward, float maxAngle, float range) {
  int best = -1; float bs = 1e9f;
  V3 eye = actor_chest(p);
  for (int i = 0; i < MAX_ACTORS; i++) {
    Actor *a = &g.actors[i];
    if (a == p || !actor_alive(a) || a->recruited) continue;
    V3 to = v3_sub(actor_chest(a), eye);
    float d = v3_len(to);
    if (d > range || d < 0.5f) continue;
    float ang = acosf(clampf(v3_dot(v3_scale(to, 1 / d), forward), -1, 1));
    if (ang > maxAngle) continue;
    if (!world_los(eye, actor_chest(a))) continue;
    // hostile people first, then the nearest to the middle of the view
    float score = ang * 20 + d * 0.3f - (a->hostile ? 25 : 0) - (a->kind == AK_COP && g.wanted ? 10 : 0);
    if (score < bs) { bs = score; best = i; }
  }
  return best;
}

static void recruit(Actor *p) {
  int idx = -1;
  if (p->target >= 0 && g.actors[p->target].gang == GANG_PALM && g.actors[p->target].kind == AK_GANG) idx = p->target;
  else {
    float bd = 6;
    for (int i = 0; i < MAX_ACTORS; i++) {
      Actor *a = &g.actors[i];
      if (!actor_alive(a) || a->kind != AK_GANG || a->gang != GANG_PALM || a->recruited) continue;
      float d = v3_dist(a->pos, p->pos);
      if (d < bd) { bd = d; idx = i; }
    }
  }
  if (idx < 0) { game_message("No one of your crew near"); return; }
  gang_recruit(&g.actors[idx]);
}

void player_step(const Pad *pad) {
  Actor *p = g.player;
  if (!p || !p->used) return;
  Controls *c = &p->ctl;
  memset(c, 0, sizeof(*c));
  if (!actor_alive(p) || g.deadTimer > 0) return;

  // weapons
  if (pad->pdl) weapon_select(p, -1);
  if (pad->pdr) weapon_select(p, 1);
  if (pad->pdu) recruit(p);
  if (pad->pdd) gang_dismiss_all();

  if (p->vehicle && p->state == ST_VEHICLE) {
    Vehicle *v = p->vehicle;
    if (p->seat == 0) {
      // driving: A gas, B brake/reverse (while not shooting), Z handbrake / hop
      bool shooting = pad->r && weapon_is_gun(p->weapon);
      v->throttle = (pad->a ? 1.0f : 0) - (pad->b && !shooting ? 1.0f : 0);
      v->steer = -pad->sx;
      v->handbrake = pad->z;
      if (vehicle_is_bike(v) && pad->pz && v->onGround && v->def == VD_BMX) { v->vel.y = 5.5f; v->onGround = false; }
      v->horn = pad->l;
      v->siren = g_vdefs[v->def].police && pad->du;
    }
    // shooting out of the window: R picks a target round the car, B fires
    s_aiming = pad->r && weapon_is_gun(p->weapon) && (!vehicle_is_bike(v) || g_weapons[p->weapon].kind == WK_HITSCAN);
    if (s_aiming) {
      V3 cf = v3_norm(v3_sub(g_view.target, g_view.eye)); cf.y = 0; cf = v3_norm(cf);
      int t = pick_target(p, cf, 1.4f, 45);
      p->target = t;
      s_aim = t >= 0 ? actor_chest(&g.actors[t]) : v3_add(actor_chest(p), v3_scale(cf, 30));
      c->aim = true; c->aimAt = s_aim;
      c->attack = pad->pb; c->attackHeld = pad->b;
    } else p->target = -1;
    if (pad->pcu) vehicle_exit(p);
    return;
  }

  // on foot
  V3 move = camera_stick_dir(pad->sx, pad->sy);
  c->move = move;
  c->rawX = pad->sx; c->rawY = pad->sy;
  c->jump = pad->pa; c->jumpHeld = pad->a;
  c->crouch = pad->z; c->crouchPressed = pad->pz;
  c->attack = pad->pb; c->attackHeld = pad->b;
  s_aiming = pad->r;
  if (pad->r) {
    V3 cf = v3_norm(v3_sub(g_view.target, g_view.eye)); cf.y = 0; cf = v3_norm(cf);
    if (!pad->pr && p->target >= 0 && actor_alive(&g.actors[p->target]) && v3_dist(g.actors[p->target].pos, p->pos) < 50) {
      // keep the lock
    } else if (pad->pr || p->target < 0) {
      p->target = pick_target(p, p->target >= 0 ? cf : yaw_dir(p->yaw), 0.9f, 45);
      if (p->target < 0) p->target = pick_target(p, cf, 0.9f, 45);
    }
    if (p->target >= 0 && !actor_alive(&g.actors[p->target])) p->target = pick_target(p, cf, 0.9f, 45);
    if (p->target >= 0) s_aim = actor_chest(&g.actors[p->target]);
    else s_aim = v3_add(actor_chest(p), v3_scale(yaw_dir(p->yaw), 30));
    c->aim = weapon_is_gun(p->weapon);
    c->aimAt = s_aim;
    if (!c->aim && p->target >= 0) { c->face = true; V3 to = v3_sub(s_aim, p->pos); c->faceYaw = dir_yaw(to.x, to.z); }
  } else {
    p->target = -1;
    s_aim = v3_add(actor_chest(p), v3_scale(yaw_dir(p->yaw), 30));
    c->aimAt = s_aim;
  }
  // C-up: into the nearest vehicle (the driver's seat; pulls the driver out)
  if (pad->pcu && actor_can_act(p)) {
    int seat;
    Vehicle *v = vehicle_nearest(p->pos, 3.0f, &seat, true);
    if (v) {
      Actor *drv = v->seat[0];
      vehicle_enter(p, v, 0);
      if (drv && drv != p) gang_on_jacked(drv, p, v);
    }
  }
}
