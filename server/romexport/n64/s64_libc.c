// The C library parts Studio 64's engine code uses that the game does not have: a heap (a block
// of the main pool taken at boot), snprintf on libultra's printf, and a few maths functions.
#include <ultra64.h>
#include <stdarg.h>
#include <string.h>

#include "sm64.h"
#include "game/memory.h"
#include "engine/math_util.h"

#define HEAP_SIZE (384 * 1024)

// ---- the heap: first fit over a list of blocks, neighbours merged when freed ----------------
struct Block {
    u32 size;      // bytes after the header
    u32 used;
    struct Block *next;
    u32 pad;
};

static struct Block *sHeap;

void s64_heap_init(void) {
    sHeap = main_pool_alloc(HEAP_SIZE, MEMORY_POOL_LEFT);
    if (sHeap != NULL) {
        sHeap->size = HEAP_SIZE - sizeof(struct Block);
        sHeap->used = FALSE;
        sHeap->next = NULL;
    }
}

void *malloc(size_t size) {
    struct Block *b;
    size = (size + 15) & ~15;
    for (b = sHeap; b != NULL; b = b->next) {
        if (b->used || b->size < size) {
            continue;
        }
        if (b->size >= size + sizeof(struct Block) + 16) {
            struct Block *rest = (struct Block *) ((u8 *) (b + 1) + size);
            rest->size = b->size - size - sizeof(struct Block);
            rest->used = FALSE;
            rest->next = b->next;
            b->next = rest;
            b->size = size;
        }
        b->used = TRUE;
        return b + 1;
    }
    return NULL;
}

void free(void *p) {
    struct Block *b;
    if (p == NULL) {
        return;
    }
    ((struct Block *) p - 1)->used = FALSE;
    for (b = sHeap; b != NULL; b = b->next) {
        while (!b->used && b->next != NULL && !b->next->used) {
            b->size += sizeof(struct Block) + b->next->size;
            b->next = b->next->next;
        }
    }
}

void *calloc(size_t n, size_t size) {
    void *p = malloc(n * size);
    if (p != NULL) {
        bzero(p, n * size);
    }
    return p;
}

void *realloc(void *p, size_t size) {
    void *q;
    size_t old;
    if (p == NULL) {
        return malloc(size);
    }
    old = ((struct Block *) p - 1)->size;
    if (old >= size) {
        return p;
    }
    q = malloc(size);
    if (q != NULL) {
        memcpy(q, p, old);
        free(p);
    }
    return q;
}

// ---- memory and strings ---------------------------------------------------------------------
void *memset(void *p, int c, size_t n) {
    u8 *d = p;
    while (n--) {
        *d++ = c;
    }
    return p;
}

void *memmove(void *dst, const void *src, size_t n) {
    u8 *d = dst;
    const u8 *s = src;
    if (d < s) {
        while (n--) *d++ = *s++;
    } else {
        d += n;
        s += n;
        while (n--) *--d = *--s;
    }
    return dst;
}

int memcmp(const void *a, const void *b, size_t n) {
    const u8 *x = a, *y = b;
    for (; n; n--, x++, y++) {
        if (*x != *y) {
            return *x - *y;
        }
    }
    return 0;
}

int strcmp(const char *a, const char *b) {
    while (*a && *a == *b) {
        a++;
        b++;
    }
    return (u8) *a - (u8) *b;
}

char *strdup(const char *s) {
    size_t n = strlen(s) + 1;
    char *d = malloc(n);
    if (d != NULL) {
        memcpy(d, s, n);
    }
    return d;
}

// ---- snprintf ---------------------------------------------------------------------------------
struct Out {
    char *p;
    size_t left;
};

int _Printf(char *(*prout)(char *, const char *, size_t), char *dst, const char *fmt, va_list args);

static char *out_bounded(char *arg, const char *src, size_t count) {
    struct Out *o = (struct Out *) arg;
    while (count-- && o->left > 1) {
        *o->p++ = *src++;
        o->left--;
    }
    return arg;
}

int vsnprintf(char *dst, size_t size, const char *fmt, va_list args) {
    struct Out o;
    s32 n;
    o.p = dst;
    o.left = size;
    n = _Printf(out_bounded, (char *) &o, fmt, args);
    if (size > 0) {
        *o.p = '\0';
    }
    return n;
}

int snprintf(char *dst, size_t size, const char *fmt, ...) {
    va_list args;
    s32 n;
    va_start(args, fmt);
    n = vsnprintf(dst, size, fmt, args);
    va_end(args);
    return n;
}

// ---- maths ----------------------------------------------------------------------------------
float fabsf(float x) { return x < 0 ? -x : x; }
int abs(int x) { return x < 0 ? -x : x; }
float fminf(float a, float b) { return a < b ? a : b; }
float fmaxf(float a, float b) { return a > b ? a : b; }

float floorf(float x) {
    float t = (float) (s32) x;
    return t > x ? t - 1.0f : t;
}

float ceilf(float x) {
    float t = (float) (s32) x;
    return t < x ? t + 1.0f : t;
}

float fmodf(float a, float b) {
    s32 q = (s32) (a / b);
    return a - (float) q * b;
}

float powf(float a, float b) {
    // whole powers only (all Studio 64 uses)
    float r = 1.0f;
    s32 n = (s32) b, neg = n < 0;
    if (neg) n = -n;
    while (n--) r *= a;
    return neg ? 1.0f / r : r;
}
