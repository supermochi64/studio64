// Studio 64's engine code on the N64 (the base ROM of a ROM export): what the web build gets from
// Emscripten and the C library (s64_libc.c here), and the names the sm64ex engine has from an
// older decomp mapped to this one's. Included before every file in src/s64.
#ifndef S64_N64COMPAT_H
#define S64_N64COMPAT_H

#include <PR/ultratypes.h>
#include <stdarg.h>

#define TARGET_N64_S64 1
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...)
#define EM_ASM_INT(...) (-1)

// the C library
#ifndef NULL
#define NULL ((void *) 0)
#endif
typedef unsigned int size_t;
void *malloc(size_t size);
void *calloc(size_t n, size_t size);
void *realloc(void *p, size_t size);
void free(void *p);
void *memset(void *p, int c, size_t n);
void *memmove(void *dst, const void *src, size_t n);
int memcmp(const void *a, const void *b, size_t n);
int strcmp(const char *a, const char *b);
int snprintf(char *dst, size_t size, const char *fmt, ...);
int vsnprintf(char *dst, size_t size, const char *fmt, va_list args);
float fabsf(float x);
float floorf(float x);
float ceilf(float x);
float fminf(float a, float b);
float fmaxf(float a, float b);
float fmodf(float a, float b);
float powf(float a, float b);
int abs(int x);

// what the engine tells the page, in the ROM (s64_story.c)
s32 s64_page_studioNpcDialog(s32 uid, s32 dialog);
void s64_page_studioStoryEvent(s32 kind, s32 a, s32 b, s32 c);
void s64_page_studioObjectEvent(u32 uid, s32 ev);
void s64_page_studioWarp(s32 src, s32 level, s32 area, s32 node, s32 exitCourse);
void s64_page_studioUnlocked(u32 uid);
void s64_page_studioKey(s32 key, u32 uid);
void s64_page_studioSfx(s32 id, f32 distance);
void s64_page_studioVehicleEvent(const char *name, u32 uid, s32 value);
void s64_page_studioKatanaEvent(const char *kind, u32 uid, s32 value);
void *s64_level_malloc(u32 size);

// older decomp names
#define gDefaultSoundArgs gGlobalSoundSource
#define oBehParams oBhvParams
#define GraphNodeObject_sub AnimInfo
#define func_80320A4C set_sound_moving_speed
#define func_8031FFB4 seq_player_lower_volume
#define sequence_player_unlower seq_player_unlower_volume
#define oBehParams2ndByte oBhvParams2ndByte
#define DIALOG_UNK1_FLAG_DEFAULT DIALOG_FLAG_TEXT_DEFAULT
#define DIALOG_UNK1_FLAG_RESPONSE DIALOG_FLAG_TEXT_RESPONSE
#define DIALOG_UNK1_FLAG_4 DIALOG_FLAG_TIME_STOP_ENABLED
#define DIALOG_UNK2_FLAG_0 DIALOG_FLAG_TURN_TO_MARIO
#define DIALOG_UNK2_LEAVE_TIME_STOP_ENABLED DIALOG_FLAG_TIME_STOP_ENABLED
#define sequence_player_fade_out seq_player_fade_out
#define play_sequence seq_player_play_sequence
char *strdup(const char *s);

// what the sm64ex engine has that the decomp does not (s64_ray.c)
struct Surface;
void find_surface_on_ray(float *orig, float *dir, struct Surface **hit, float *hitPos);

#endif
