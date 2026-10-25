#include "save.h"
#include "world.h"
#include "weapon.h"
#include "mission.h"
#include <stddef.h>

typedef struct __attribute__((packed)) {
  char magic[4];
  int32_t money;
  int16_t respect;
  uint16_t weapons;
  uint16_t ammo[W_COUNT];
  uint8_t owner[81];
  uint8_t hour;
  uint8_t pad;
  uint16_t sum;          // a checksum of everything else: a half-written or foreign save is ignored
  uint32_t missions;
} SaveData;

static uint16_t checksum(const SaveData *s) {
  const uint8_t *b = (const uint8_t *)s; uint16_t a = 0x5A17;
  for (unsigned i = 0; i < sizeof(*s); i++) if (i != offsetof(SaveData, sum) && i != offsetof(SaveData, sum) + 1) a = (uint16_t)((a << 5 | a >> 11) ^ b[i]);
  return a;
}
static bool valid(const SaveData *s) { return memcmp(s->magic, "SBX3", 4) == 0 && s->sum == checksum(s); }

static bool s_present;

void save_init(void) { s_present = eeprom_present() != EEPROM_NONE; }

static void fill(SaveData *s) {
  memset(s, 0, sizeof(*s));
  memcpy(s->magic, "SBX3", 4);
  s->money = g.money; s->respect = g.respect;
  Actor *p = g.player;
  if (p) { s->weapons = p->weapons; for (int w = 0; w < W_COUNT; w++) s->ammo[w] = (uint16_t)mini(65535, p->ammo[w] + p->clip[w]); }
  memcpy(s->owner, g_world.owner, 81);
  s->hour = (uint8_t)g_hour;
  s->missions = mission_done_mask();
  s->sum = checksum(s);
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
  return valid(&s);
}

bool save_read(void) {
  if (!s_present) return false;
  SaveData s;
  eeprom_read_bytes((uint8_t *)&s, 0, sizeof(s));
  if (!valid(&s)) return false;
  g.money = maxi(0, mini(s.money, 99999999)); g.respect = maxi(0, mini(s.respect, 200));
  for (int i = 0; i < 81; i++) if (s.owner[i] < GANG_COUNT && s.owner[i] != GANG_COPS) g_world.owner[i] = s.owner[i];
  g_hour = s.hour < 24 ? s.hour : 9;
  mission_set_done_mask(s.missions);
  Actor *p = g.player;
  if (p) {
    for (int w = 1; w < W_COUNT; w++) if (s.weapons & (1 << w)) { p->ammo[w] = 0; p->clip[w] = 0; weapon_give(p, w, mini(s.ammo[w], 999)); }
  }
  return true;
}
