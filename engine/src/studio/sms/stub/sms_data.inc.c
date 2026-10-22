// Stand-in for gen/sms_data.inc.c when no Super Mario Sunshine disc was converted:
// no bodies (gSmsBodyCount 0), so no Sunshine object is in the catalog. tools/sms/convert.py
// writes the real file from your own disc.

const GeoLayout sms_moma_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_momd_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_mow_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_hamukuri_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_namekuri_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_dennoko_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_koura_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_sambo_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_poihana_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_geso_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_shine_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_marem_geo[] = { GEO_NODE_START(), GEO_END() };
const GeoLayout sms_marew_geo[] = { GEO_NODE_START(), GEO_END() };
const struct Animation *const sms_moma_anims[] = { NULL };
const struct Animation *const sms_mow_anims[] = { NULL };
const struct Animation *const sms_hamukuri_anims[] = { NULL };
const struct Animation *const sms_namekuri_anims[] = { NULL };
const struct Animation *const sms_dennoko_anims[] = { NULL };
const struct Animation *const sms_koura_anims[] = { NULL };
const struct Animation *const sms_sambo_anims[] = { NULL };
const struct Animation *const sms_poihana_anims[] = { NULL };
const struct Animation *const sms_geso_anims[] = { NULL };
const struct Animation *const sms_shine_anims[] = { NULL };
const struct Animation *const sms_marem_anims[] = { NULL };
const struct Animation *const sms_marew_anims[] = { NULL };

const struct SmsBody gSmsBodies[] = { { "none", sms_moma_geo, 0, 0, NULL, NULL, NULL, 0, NULL, 0, NULL, NULL, NULL, sms_moma_anims, 0, 0 } };
const s32 gSmsBodyCount = 0;
