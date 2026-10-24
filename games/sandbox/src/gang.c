#include "gang.h"
#include "actor.h"
#include "world.h"
#include "weapon.h"
#include "sound.h"
#include "population.h"
#include "save.h"
#include "vehicle.h"

const GangDef g_gangs[GANG_COUNT] = {
  [GANG_NONE] = {"", {200, 200, 200, 255}, 0, {W_FIST, W_FIST, W_FIST}},
  [GANG_PALM] = {"Palm Court Crew", {46, 160, 60, 255}, (1 << GANG_VIOLET) | (1 << GANG_GOLD), {W_PISTOL, W_SMG, W_BAT}},
  [GANG_VIOLET] = {"Violet Kings", {150, 70, 180, 255}, (1 << GANG_PALM) | (1 << GANG_GOLD), {W_PISTOL, W_SMG, W_PISTOL}},
  [GANG_GOLD] = {"Gold Coast", {230, 190, 40, 255}, (1 << GANG_PALM) | (1 << GANG_VIOLET), {W_PISTOL, W_SHOTGUN, W_BAT}},
  [GANG_COPS] = {"Police", {60, 90, 200, 255}, 0, {W_PISTOL, W_PISTOL, W_SHOTGUN}},
};

static const float WANTED_AT[6] = {0, 2.5f, 10, 22, 38, 60}; // points for 1..5 stars
static float s_rivalKills; static float s_killWindow; static int s_killBlock = -1;

void gang_init(void) {
  g.respect = 30;
  for (int i = 0; i < MAX_RECRUITS; i++) g.recruits[i] = -1;
}

bool gang_hostile(const Actor *a, const Actor *b) {
  if (!a || !b || a == b) return false;
  // the player: rivals in their own blocks, anyone who was attacked by them, the police when wanted
  if (b->kind == AK_PLAYER || a->kind == AK_PLAYER) {
    const Actor *o = a->kind == AK_PLAYER ? b : a;
    if (o->recruited) return false;
    if (o->hostile) return true;
    if (o->kind == AK_COP) return g.wanted > 0;
    if (o->kind == AK_GANG && (g_gangs[o->gang].hostileTo & (1 << GANG_PALM))) return true;
    return false;
  }
  if (a->recruited && (b->hostile || (b->kind == AK_GANG && (g_gangs[GANG_PALM].hostileTo & (1 << b->gang))) || (b->kind == AK_COP && g.wanted > 1))) return true;
  if (b->recruited && (a->hostile || (a->kind == AK_GANG && (g_gangs[a->gang].hostileTo & (1 << GANG_PALM))) || (a->kind == AK_COP && g.wanted > 1))) return true;
  if (a->kind == AK_GANG && b->kind == AK_GANG) return (g_gangs[a->gang].hostileTo & (1 << b->gang)) != 0;
  return false;
}

int gang_recruit_count(void) { int n = 0; for (int i = 0; i < MAX_RECRUITS; i++) if (g.recruits[i] >= 0) n++; return n; }
int gang_max_recruits(void) { return mini(MAX_RECRUITS, 1 + g.respect / 25); }

void gang_recruit(Actor *a) {
  if (a->recruited) return;
  if (gang_recruit_count() >= gang_max_recruits()) { game_message("Not enough respect for more (%d max)", gang_max_recruits()); return; }
  for (int i = 0; i < MAX_RECRUITS; i++) if (g.recruits[i] < 0) {
    g.recruits[i] = actor_index(a);
    a->recruited = true; a->followSlot = i; a->hostile = false; a->foe = -1;
    a->despawnTimer = 0;
    if (!weapon_is_gun(a->weapon)) weapon_give(a, W_PISTOL, 60);
    game_message("%s joins you", g_gangs[a->gang].name);
    sound_play_ui(SND_PICKUP);
    return;
  }
}
void gang_dismiss_all(void) {
  int n = 0;
  for (int i = 0; i < MAX_RECRUITS; i++) if (g.recruits[i] >= 0) {
    Actor *a = &g.actors[g.recruits[i]];
    a->recruited = false; a->followSlot = -1;
    if (a->vehicle && a->seat > 0) vehicle_exit(a);
    g.recruits[i] = -1; n++;
  }
  if (n) game_message("Your crew goes home");
}

void gang_on_jacked(Actor *driver, Actor *by, Vehicle *v) {
  (void)v;
  if (driver->kind == AK_GANG || driver->kind == AK_COP) { driver->hostile = true; driver->foe = actor_index(by); }
  if (by->kind == AK_PLAYER) gang_crime(driver->kind == AK_COP ? 8 : 1.5f);
}

int gang_block_owner(int block) { return block >= 0 && block < 81 ? g_world.owner[block] : 0; }
int gang_territories(int gang) { int n = 0; for (int i = 0; i < 81; i++) if (g_world.owner[i] == gang) n++; return n; }

void gang_crime(float pts) {
  g.wantedPoints = minf(WANTED_AT[5] + 10, g.wantedPoints + pts);
  g.wantedCool = 0;
}

// called on every hit: crimes, revenge, gang wars
static void on_damaged(Actor *a, Actor *by, float dmg, bool died) {
  (void)dmg;
  if (by && by->kind == AK_PLAYER && a != by) {
    if (a->kind == AK_CIVILIAN) gang_crime(died ? 3 : 1);
    else if (a->kind == AK_COP) gang_crime(died ? 12 : 4);
    else if (a->kind == AK_GANG && a->gang == GANG_PALM && !a->recruited) { gang_crime(died ? 2 : 0.5f); a->hostile = true; }
    else if (a->kind == AK_GANG && died) {
      gang_crime(0.6f);
      g.respect += 1;
      // three rivals down in one of their blocks starts a war over it
      int b = world_block(a->pos.x, a->pos.z);
      int owner = gang_block_owner(b);
      if (b >= 0 && owner == a->gang && !g.war) {
        if (b != s_killBlock) { s_killBlock = b; s_rivalKills = 0; }
        s_rivalKills += 1; s_killWindow = 60;
        if (s_rivalKills >= 3) {
          g.war = b + 1; g.warWave = 0; g.warLeft = 0; g.warTimer = 4;
          game_big("GANG WAR");
          sound_play_ui(SND_WAR);
        }
      }
    }
    if (!died && a->recruited) { /* friendly fire: no grudge from your own crew */ }
    else if (!died) { a->hostile = a->kind != AK_CIVILIAN || rnd() < 0.15f; a->foe = actor_index(by); a->scared = a->kind == AK_CIVILIAN && !a->hostile; }
  } else if (by && a != by && !died) {
    // people fight back against whoever hurt them
    if (a->kind != AK_CIVILIAN) a->foe = actor_index(by);
    else a->scared = true;
  }
  if (died) {
    if (a->kind != AK_PLAYER) population_on_death(a, by);
    if (a->recruited) {
      for (int i = 0; i < MAX_RECRUITS; i++) if (g.recruits[i] == actor_index(a)) g.recruits[i] = -1;
      a->recruited = false;
      game_message("You lost one of your crew");
    }
  }
}

static void war_step(void) {
  if (!g.war) { if (s_killWindow > 0 && (s_killWindow -= DT) <= 0) s_rivalKills = 0; return; }
  int b = g.war - 1;
  float cx = (g_world.lines[b % 9] + g_world.lines[b % 9 + 1]) * 0.5f, cz = (g_world.lines[b / 9] + g_world.lines[b / 9 + 1]) * 0.5f;
  Actor *p = g.player;
  if (!actor_alive(p) || v3_dist_xz(p->pos, (V3){cx, 0, cz}) > 160) {
    g.war = 0; game_big("WAR LOST"); g.respect = maxi(0, g.respect - 5); return;
  }
  if (g.warTimer > 0) { g.warTimer -= DT; return; }
  int left = 0;
  for (int i = 0; i < MAX_ACTORS; i++) if (g.actors[i].warrior && actor_alive(&g.actors[i])) left++;
  g.warLeft = left;
  if (g.warLeft <= 0) {
    if (g.warWave >= 3) {
      // the block is ours now
      g_world.owner[b] = GANG_PALM;
      g.war = 0; g.respect += 12; g.money += 500;
      game_big("TERRITORY TAKEN");
      game_message("%s now belongs to the Palm Court Crew  +$500", world_district_name(cx, cz));
      sound_play_ui(SND_CASH);
      save_write();
      return;
    }
    // the next wave comes in from the edges of the block
    g.warWave++;
    int n = 3 + g.warWave;
    int gang = 0;
    for (int i = 0; i < 81 && !gang; i++) if (i == b) gang = g_world.dmap[i] == 'V' ? GANG_VIOLET : g_world.dmap[i] == 'Y' ? GANG_GOLD : GANG_VIOLET;
    g.warLeft = population_spawn_attackers(gang, p->pos, n);
    game_message("Wave %d of 3: %d %s", g.warWave, g.warLeft, g_gangs[gang].name);
    g.warTimer = 3;
  }
}

static void wanted_step(void) {
  // the stars follow the points; the points fade while no cop sees you
  int stars = 0;
  for (int s = 5; s >= 1; s--) if (g.wantedPoints >= WANTED_AT[s]) { stars = s; break; }
  if (stars != g.wanted) { if (stars > g.wanted) sound_play_ui(SND_BLIP); g.wanted = stars; }
  bool seen = false;
  for (int i = 0; i < MAX_ACTORS && !seen; i++) {
    Actor *c = &g.actors[i];
    if (c->kind == AK_COP && actor_alive(c) && v3_dist(c->pos, g.player->pos) < 45 && world_los(actor_head(c), actor_chest(g.player))) seen = true;
  }
  g.wantedCool += DT;
  if (!seen && g.wantedCool > 8 && g.wantedPoints > 0) g.wantedPoints = maxf(0, g.wantedPoints - DT * (g.wanted >= 3 ? 0.6f : 0.9f));
}

void gang_step(void) {
  static bool hooked;
  if (!hooked) { g_on_actor_damaged = on_damaged; hooked = true; }
  if (!g.player) return;
  wanted_step();
  war_step();
  g.respect = mini(g.respect, 200);
}
