// Shotgun Mario's models (the gun, its effect textures, the hood gangsters and their bullets).
// They ship in studio/shotgun/ (tools/shotgun_extract.py made them from Shoggoth World; the gangsters'
// vanilla Goomba feet and faces come from your ROM at build time: studio/romgen/shotgun/). A tree without
// them still builds: SG_STUB, empty stand-ins (shotgun_objects.c), no shotgun objects, the gun stays off.
#ifndef STUDIO_SHOTGUN_MODELS_SWITCH_H
#define STUDIO_SHOTGUN_MODELS_SWITCH_H
#if __has_include("shotgun/models.h") && __has_include("shotgun/models.inc.c")
#include "shotgun/models.h"
#else
#define SG_STUB 1
extern const Gfx sg_sg_body_dl_opaque[];
extern const Gfx sg_sg_pump_dl_opaque[];
extern const Gfx sg_shotgun_dl_opaque[];
extern const u8 sg_tex_sg_hole[];
extern const u8 sg_tex_sg_smoke[];
extern const u8 sg_tex_sg_star[];
extern const GeoLayout sg_shotgun_geo[];
extern const GeoLayout sg_gangster0_geo[];
extern const GeoLayout sg_gangster1_geo[];
extern const GeoLayout sg_gangster2_geo[];
extern const GeoLayout sg_hood_bullet_geo[];
#endif
#endif
