// Studio 64's modules (server/romexport/overlays.js): a level's script asks for the ones its objects
// need (s64_level_modules). They come from the ROM into the level's memory, move to where they
// landed (their relocations, also into each other), the game's hooks (s64_ovl_hooks.c) find them and
// the game's data that points at them (the catalog) is filled in. When the next level starts, its
// memory is new: nothing is loaded until it asks (s64_ovl_reset).
#include <ultra64.h>

#include "sm64.h"
#include "game/memory.h"
#include "s64_hack.h"

#define DIR_MAGIC 0x53363456
#define MAX_OVERLAYS 16
#define R_MIPS_32 2
#define R_MIPS_26 4
#define R_MIPS_HI16 5

extern void dma_read(u8 *dest, u8 *srcStart, u8 *srcEnd);
extern u32 gS64OvlSlots[];
extern const s32 gS64OvlHookCount;
void *malloc(u32 size);
void free(void *p);

struct OvlDir {
    u32 magic, count, fixupCount, fixupsAt;
};
struct OvlEntry {
    u32 imageAt, imageSize, bssSize, relocCount, relocsAt, hookCount, hooksAt, linkBase;
};
struct OvlFixup {
    u32 addr, overlay, offset;
};

// (what a DMA reads into is 16-byte aligned: the cartridge interface writes RAM in 8-byte steps)
static struct OvlDir sDir __attribute__((aligned(16)));
static struct OvlEntry sEntries[MAX_OVERLAYS] __attribute__((aligned(16)));
static struct OvlFixup *sFixups;
static u32 *sFixupWas; // what the game had there (the module's offset alone: weak symbols are 0)
u8 *gS64OvlBase[MAX_OVERLAYS]; // where each module is now (NULL: not in this level)

static void read_rom(void *dest, u32 rom, u32 size) {
    if (size > 0) {
        dma_read(dest, (u8 *) rom, (u8 *) rom + ((size + 1) & ~1));
    }
}

// boot: the directory and the fixups
void s64_ovl_init(void) {
    u32 i;
    if (!s64_info_valid() || gS64Info.ovlDir == 0) {
        return;
    }
    read_rom(&sDir, gS64Info.ovlDir, sizeof(sDir));
    if (sDir.magic != DIR_MAGIC || sDir.count > MAX_OVERLAYS) {
        sDir.magic = 0;
        return;
    }
    read_rom(sEntries, gS64Info.ovlDir + sizeof(sDir), sDir.count * sizeof(struct OvlEntry));
    sFixups = malloc(sDir.fixupCount * sizeof(struct OvlFixup) + 16);
    sFixupWas = malloc(sDir.fixupCount * 4 + 16);
    if (sFixups == NULL || sFixupWas == NULL) {
        sDir.magic = 0;
        return;
    }
    read_rom(sFixups, gS64Info.ovlDir + sDir.fixupsAt, sDir.fixupCount * sizeof(struct OvlFixup));
    for (i = 0; i < sDir.fixupCount; i++) {
        sFixupWas[i] = *(u32 *) sFixups[i].addr;
    }
}

// What a module allocates (its code's malloc): the level's memory, gone with the level and the module.
void *s64_level_malloc(u32 size) {
    return main_pool_alloc((size + 15) & ~15, MEMORY_POOL_LEFT);
}

// level_script.c, INIT_LEVEL: the last level's memory is gone, and its modules with it
void s64_ovl_reset(void) {
    u32 i;
    if (sDir.magic != DIR_MAGIC) {
        return;
    }
    for (i = 0; i < MAX_OVERLAYS; i++) {
        gS64OvlBase[i] = NULL;
    }
    for (i = 0; i < (u32) gS64OvlHookCount; i++) {
        gS64OvlSlots[i] = 0;
    }
    for (i = 0; i < sDir.fixupCount; i++) {
        *(u32 *) sFixups[i].addr = sFixupWas[i];
    }
}

// what a call into a module the level does not have reaches
static s32 s64_ovl_absent(void) {
    return 0;
}

// the module's references moved by where it and the others landed (64 KB steps: low halves stay)
static void relocate(const struct OvlEntry *e, u8 *base) {
    u32 *relocs = malloc(e->relocCount * 4 + 16);
    u32 i;
    if (relocs == NULL) {
        return;
    }
    read_rom(relocs, gS64Info.ovlDir + e->relocsAt, e->relocCount * 4);
    for (i = 0; i < e->relocCount; i++) {
        u32 r = relocs[i], target = (r >> 24) & 15, a, delta;
        u32 *p = (u32 *) (base + (r & 0xFFFFFF));
        if (target >= sDir.count || gS64OvlBase[target] == NULL) {
            // a module this level does not have: its functions do nothing (as the game's hooks), its
            // data's address stays one that is nowhere (what is compared with it never matches)
            if ((r >> 28) == R_MIPS_26) {
                *p = (*p & 0xFC000000) | (((u32) s64_ovl_absent >> 2) & 0x3FFFFFF);
            }
            continue;
        }
        delta = (u32) gS64OvlBase[target] - sEntries[target].linkBase;
        switch (r >> 28) {
            case R_MIPS_32:
                *p += delta;
                break;
            case R_MIPS_26:
                a = (((*p & 0x3FFFFFF) << 2) | ((u32) p & 0xF0000000)) + delta;
                *p = (*p & 0xFC000000) | ((a >> 2) & 0x3FFFFFF);
                break;
            case R_MIPS_HI16:
                *p = (*p & 0xFFFF0000) | ((*p + (delta >> 16)) & 0xFFFF);
                break;
        }
    }
    free(relocs);
}

// the level script, after INIT_LEVEL: CALL(mask of modules, s64_level_modules) (the script's
// register stays as it was)
s32 s64_level_modules(s16 mask, s32 reg) {
    u32 i, k;
    if (sDir.magic != DIR_MAGIC || mask == 0) {
        return reg;
    }
    for (i = 0; i < sDir.count; i++) {
        const struct OvlEntry *e = &sEntries[i];
        u8 *base;
        if (!(mask & (1 << i)) || e->imageSize == 0) {
            continue;
        }
        base = main_pool_alloc(e->imageSize + e->bssSize + 0xFFFF, MEMORY_POOL_LEFT);
        if (base == NULL) {
            continue;
        }
        base = (u8 *) (((u32) base + 0xFFFF) & ~0xFFFF); // (as it is linked: 64 KB aligned)
        read_rom(base, gS64Info.ovlDir + e->imageAt, e->imageSize);
        bzero(base + e->imageSize, e->bssSize);
        gS64OvlBase[i] = base;
    }
    for (i = 0; i < sDir.count; i++) {
        const struct OvlEntry *e = &sEntries[i];
        u32 *hooks;
        if (gS64OvlBase[i] == NULL) {
            continue;
        }
        relocate(e, gS64OvlBase[i]);
        hooks = malloc(e->hookCount * 8 + 16);
        if (hooks != NULL) {
            read_rom(hooks, gS64Info.ovlDir + e->hooksAt, e->hookCount * 8);
            for (k = 0; k < e->hookCount; k++) {
                gS64OvlSlots[hooks[k * 2]] = (u32) gS64OvlBase[i] + hooks[k * 2 + 1];
            }
            free(hooks);
        }
    }
    for (i = 0; i < sDir.fixupCount; i++) {
        const struct OvlFixup *f = &sFixups[i];
        if (f->overlay < MAX_OVERLAYS && gS64OvlBase[f->overlay] != NULL) {
            *(u32 *) f->addr = sFixupWas[i] + (u32) gS64OvlBase[f->overlay] + f->offset;
        }
    }
    // the code is new: what the processor caches of it is not
    osWritebackDCacheAll();
    osInvalICache((void *) 0x80000000, 0x4000);
    return reg;
}
