#include "save.h"
#include "world.h"
#include "weapon.h"
#include "mission.h"

typedef struct __attribute__((packed)) {
  char magic[4];
  int32_t money;
  int16_t respect;
  uint16_t weapons;
  uint16_t ammo[W_COUNT];
  uint8_t owner[81];
  uint8_t hour;
  uint8_t pad[3];
  uint32_t missions;
} SaveData;

static bool s_present;

void save_init(void) { s_present = eeprom_present() != EEPROM_NONE; }

static void fill(SaveData *s) {
  memset(s, 0, sizeof(*s));
  memcpy(s->magic, "SBX2", 4);
  s->money = g.money; s->respect = g.respect;
  Actor *p = g.player;
  if (p) { s->weapons = p->weapons; for (int w = 0; w < W_COUNT; w++) s->ammo[w] = (uint16_t)mini(65535, p->ammo[w] + p->clip[w]); }
  memcpy(s->owner, g_world.owner, 81);
  s->hour = (uint8_t)g_hour;
  s->missions = mission_done_mask();
}

void save_write(void) {
  if (!s_present) return;
  SaveData s; fill(&s);
  eeprom_write_bytes((const uint8_t *)&s, 0, sizeof(s));
}

bool save_exists(void) {
  if (!s_present) return false;
  SaveData s;
  eeprom_read_bytes((uint8_t *)&s, 0, sizeof(s));
  return memcmp(s.magic, "SBX2", 4) == 0;
}

bool save_read(void) {
  if (!s_present) return false;
  SaveData s;
  eeprom_read_bytes((uint8_t *)&s, 0, sizeof(s));
  if (memcmp(s.magic, "SBX2", 4) != 0) return false;
  g.money = s.money; g.respect = s.respect;
  memcpy(g_world.owner, s.owner, 81);
  g_hour = s.hour;
  mission_set_done_mask(s.missions);
  Actor *p = g.player;
  if (p) {
    for (int w = 1; w < W_COUNT; w++) if (s.weapons & (1 << w)) { p->ammo[w] = 0; p->clip[w] = 0; weapon_give(p, w, s.ammo[w]); }
  }
  return true;
}
