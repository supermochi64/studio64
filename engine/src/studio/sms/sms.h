#ifndef STUDIO_SMS_H
#define STUDIO_SMS_H

// Characters ported from Super Mario Sunshine (tools/sms/convert.py writes gen/).
// Every body is smoothly skinned on the CPU each frame (sms_models.c).

#include <ultra64.h>
#include "types.h"
#include "engine/graph_node.h"

// material flags
#define SMS_MF_NOCULL 1
#define SMS_MF_CULLFRONT 2
#define SMS_MF_CLAMP_S 4
#define SMS_MF_CLAMP_T 8
#define SMS_MF_MIRROR_S 16
#define SMS_MF_MIRROR_T 32
#define SMS_MF_UNLIT 64
#define SMS_MF_ENVMAP 128   // texture coordinates from the view-space normal (shiny)

#define SMS_RAMP 5

struct SmsMaterial {
    u8 layer;     // 0 opaque, 1 cut-out (alpha), 2 translucent, 3 translucent decal
    u8 flags;
    u8 slot;      // 0: texture 0; 1: oSmsEye picks the texture; 2: oSmsShirt
    u8 tint;      // multiplied by the object's tint colour (oSmsTint)
    u8 fmt, siz;  // texture format
    u16 w, h;     // 0: no texture
    u8 texCount;
    const u8 *const *tex;
};

// One joint influence of a vertex: position and normal in the joint's bind space.
struct SmsInf {
    s16 pos[3];
    s8 nrm[3];
    u8 joint;
    u8 weight;
};

struct SmsVert {
    s16 uv[2];
    u16 ramp;   // colour ramp: the vertex's colour by light level
    u16 inf;    // first influence
    u8 infCount;
};

// A gSPVertex load: count vertices from first, drawn by tris (triangles only).
struct SmsBatch {
    u16 first;
    u8 count;
    u8 mat;
    const Gfx *tris;
};

struct SmsBody {
    const char *name;
    const GeoLayout *geo;
    u8 jointCount;
    u8 shift;                 // positions and translations are fixed point << shift
    const s8 *parents;
    const u8 *ssc;            // segment scale compensation per joint
    const struct SmsMaterial *mats;
    u8 matCount;
    const struct SmsBatch *batches;
    u16 batchCount;
    const struct SmsVert *verts;
    const struct SmsInf *infs;
    const u8 (*ramps)[SMS_RAMP][4];
    const struct Animation *const *anims;  // channel layout: per joint scale xyz, rotation xyz, translation xyz
    u16 animCount;
    u16 yaw;                  // turns the model to face +Z
};

extern const struct SmsBody gSmsBodies[];
extern const s32 gSmsBodyCount;

#include "gen/sms_bodies.h"

// The look of the object being drawn (set by its behavior).
#define oSmsBody OBJECT_FIELD_S32(0x1B)
#define oSmsTint OBJECT_FIELD_S32(0x1C)   // 0xRRGGBB multiplied into tinted materials (0 = white)
#define oSmsShirt OBJECT_FIELD_S32(0x1D)  // texture of slot-2 materials
#define oSmsEye OBJECT_FIELD_S32(0x1E)    // texture of slot-1 materials (eyes)

Gfx *geo_sms_skin(s32 callContext, struct GraphNode *node, void *context);

// studio.c: a graph node for any geo layout (cached)
struct GraphNode *studio_geo_node(const GeoLayout *geo);

// shared fields of the ported behaviors
#define oSmsTargetYaw OBJECT_FIELD_S32(0x21)
// (the behavior-specific object fields 0x1F-0x22 and 0x49-0x4A; Piantas use 0x1F-0x22 for their own)
#define oSmsTimer2 OBJECT_FIELD_S32(0x1F)
#define oSmsHealth OBJECT_FIELD_S32(0x20)
#define oSmsBaseScale OBJECT_FIELD_F32(0x22)
#define oSmsVariant OBJECT_FIELD_S32(0x49)
#define oSmsObj OBJECT_FIELD_OBJ(0x4A)
#define oSmsHide OBJECT_FIELD_S32(0x47)   // bit n: material n is not drawn (an Electrokoopa without its shell)

// shared helpers for the ported behaviors (sms_common.c)
#define SMS_HIT_NONE 0
#define SMS_HIT_MARIO -1
struct ObjectHitbox;
void sms_set_body(s32 body);
void sms_set_anim(s32 anim);
void sms_restart_anim(s32 anim);
s32 sms_anim_done(void);
void sms_set_action(s32 action);
s32 sms_check_hit(struct ObjectHitbox *hitbox);
void sms_die(s32 coins, s32 sound);
s32 sms_squash(f32 base);
void sms_knockback(f32 speed, f32 up);
s32 sms_sees_mario(f32 dist, s16 halfAngle);
void sms_wander(f32 speed, f32 radius, s16 turn);
void sms_stay_on_ground(void);

// behaviors
void bhv_sms_pianta_init(void);
void bhv_sms_pianta_loop(void);
void bhv_sms_strollin_stu_init(void);
void bhv_sms_strollin_stu_loop(void);

void bhv_sms_swoopin_stu_init(void);
void bhv_sms_swoopin_stu_loop(void);
void bhv_sms_electrokoopa_init(void);
void bhv_sms_electrokoopa_loop(void);
void bhv_sms_electro_shell_init(void);
void bhv_sms_electro_shell_loop(void);
void bhv_sms_pokey_init(void);
void bhv_sms_pokey_loop(void);
void bhv_sms_hurtbox_loop(void);
void bhv_sms_cataquack_init(void);
void bhv_sms_cataquack_loop(void);
void bhv_sms_blooper_init(void);
void bhv_sms_blooper_loop(void);
void bhv_sms_shine_init(void);
void bhv_sms_shine_loop(void);

// behavior scripts (sms_behaviors.c)
extern const BehaviorScript bhvSmsStrollinStu[];
extern const BehaviorScript bhvSmsSwoopinStu[];
extern const BehaviorScript bhvSmsElectrokoopa[];
extern const BehaviorScript bhvSmsElectroShell[];
extern const BehaviorScript bhvSmsPokey[];
extern const BehaviorScript bhvSmsHurtbox[];
extern const BehaviorScript bhvSmsCataquack[];
extern const BehaviorScript bhvSmsBlooper[];
extern const BehaviorScript bhvSmsShine[];

#endif
