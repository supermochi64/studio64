// Stand-in for gen/sms_bodies.h when no Super Mario Sunshine disc was converted.
// tools/build_engine.sh copies it to gen/ when gen/ is empty; tools/sms/convert.py replaces it.
// (Only names and numbers: the same as convert.py writes for its CHARACTERS.)
#define SMS_STUB 1
#define SMS_BODY_MOMA 0
extern const GeoLayout sms_moma_geo[];
extern const struct Animation *const sms_moma_anims[];
#define SMS_MOMA_ANIM_WAIT 0
#define SMS_MOMA_ANIM_WAIT_A 1
#define SMS_MOMA_ANIM_WAIT_B 2
#define SMS_MOMA_ANIM_WALK 3
#define SMS_MOMA_ANIM_RUN 4
#define SMS_MOMA_ANIM_TALK 5
#define SMS_MOMA_ANIM_HAPPY 6
#define SMS_MOMA_ANIM_MAD 7
#define SMS_MOMA_ANIM_MADLOOP 8
#define SMS_MOMA_ANIM_RECOVER 9
#define SMS_MOMA_ANIM_DANCE 10
#define SMS_MOMA_ANIM_THROW 11
#define SMS_MOMA_ANIM_SIT 12
#define SMS_MOMA_ANIM_SITTALK 13
#define SMS_BODY_MOMD 1
extern const GeoLayout sms_momd_geo[];
#define SMS_BODY_MOW 2
extern const GeoLayout sms_mow_geo[];
extern const struct Animation *const sms_mow_anims[];
#define SMS_MOW_ANIM_WAIT 0
#define SMS_MOW_ANIM_WAIT_A 1
#define SMS_MOW_ANIM_WAIT_B 2
#define SMS_MOW_ANIM_WALK 3
#define SMS_MOW_ANIM_RUN 4
#define SMS_MOW_ANIM_TALK 5
#define SMS_MOW_ANIM_HAPPY 6
#define SMS_MOW_ANIM_MAD 7
#define SMS_MOW_ANIM_MADLOOP 8
#define SMS_MOW_ANIM_RECOVER 9
#define SMS_MOW_ANIM_DANCE 10
#define SMS_MOW_ANIM_THROW 11
#define SMS_MOW_ANIM_SIT 12
#define SMS_MOW_ANIM_SITTALK 13
#define SMS_BODY_HAMUKURI 3
extern const GeoLayout sms_hamukuri_geo[];
extern const struct Animation *const sms_hamukuri_anims[];
#define SMS_HAMUKURI_ANIM_WALK 0
#define SMS_HAMUKURI_ANIM_RUN 1
#define SMS_HAMUKURI_ANIM_WAIT 2
#define SMS_HAMUKURI_ANIM_KYORO 3
#define SMS_HAMUKURI_ANIM_TURN_START 4
#define SMS_HAMUKURI_ANIM_TURN_END 5
#define SMS_HAMUKURI_ANIM_DOWN 6
#define SMS_HAMUKURI_ANIM_CRASH 7
#define SMS_HAMUKURI_ANIM_JITABATA 8
#define SMS_HAMUKURI_ANIM_ROLL 9
#define SMS_HAMUKURI_ANIM_RETURN 10
#define SMS_HAMUKURI_ANIM_APPEAR 11
#define SMS_HAMUKURI_ANIM_LAND 12
#define SMS_HAMUKURI_ANIM_TURN_DOWN 13
#define SMS_HAMUKURI_ANIM_SET 14
#define SMS_BODY_NAMEKURI 4
extern const GeoLayout sms_namekuri_geo[];
extern const struct Animation *const sms_namekuri_anims[];
#define SMS_NAMEKURI_ANIM_WAIT 0
#define SMS_NAMEKURI_ANIM_WALK 1
#define SMS_NAMEKURI_ANIM_JUMP_START 2
#define SMS_NAMEKURI_ANIM_JUMP_END 3
#define SMS_NAMEKURI_ANIM_LAND 4
#define SMS_NAMEKURI_ANIM_HIT 5
#define SMS_NAMEKURI_ANIM_DOWN 6
#define SMS_NAMEKURI_ANIM_SET 7
#define SMS_BODY_DENNOKO 5
extern const GeoLayout sms_dennoko_geo[];
extern const struct Animation *const sms_dennoko_anims[];
#define SMS_DENNOKO_ANIM_WAIT 0
#define SMS_DENNOKO_ANIM_NWAIT 1
#define SMS_DENNOKO_ANIM_RUN_LOOP 2
#define SMS_DENNOKO_ANIM_RUN_START 3
#define SMS_DENNOKO_ANIM_RUN_END 4
#define SMS_DENNOKO_ANIM_TURN_LOOP 5
#define SMS_DENNOKO_ANIM_SHOOT 6
#define SMS_DENNOKO_ANIM_SUPPLY 7
#define SMS_DENNOKO_ANIM_HIT 8
#define SMS_DENNOKO_ANIM_DOWN 9
#define SMS_DENNOKO_ANIM_ELEC_DOWN 10
#define SMS_DENNOKO_ANIM_MOGAKI_START 11
#define SMS_DENNOKO_ANIM_MOGAKI_LOOP 12
#define SMS_DENNOKO_ANIM_MOGAKI_END 13
#define SMS_DENNOKO_ANIM_CATCH 14
#define SMS_DENNOKO_ANIM_MELT 15
#define SMS_BODY_KOURA 6
extern const GeoLayout sms_koura_geo[];
extern const struct Animation *const sms_koura_anims[];
#define SMS_KOURA_ANIM_STILL 0
#define SMS_BODY_SAMBO 7
extern const GeoLayout sms_sambo_geo[];
extern const struct Animation *const sms_sambo_anims[];
#define SMS_SAMBO_ANIM_FWAIT 0
#define SMS_SAMBO_ANIM_FSET 1
#define SMS_SAMBO_ANIM_FHIDE 2
#define SMS_SAMBO_ANIM_FATTACK_START 3
#define SMS_SAMBO_ANIM_FATTACK 4
#define SMS_SAMBO_ANIM_FATTACK_END 5
#define SMS_SAMBO_ANIM_FHIT_START 6
#define SMS_SAMBO_ANIM_HIT 7
#define SMS_SAMBO_ANIM_YDAMAGE 8
#define SMS_SAMBO_ANIM_DOWN 9
#define SMS_SAMBO_ANIM_YDOWN 10
#define SMS_BODY_POIHANA 8
extern const GeoLayout sms_poihana_geo[];
extern const struct Animation *const sms_poihana_anims[];
#define SMS_POIHANA_ANIM_WAIT 0
#define SMS_POIHANA_ANIM_WALK 1
#define SMS_POIHANA_ANIM_DASH 2
#define SMS_POIHANA_ANIM_THROW 3
#define SMS_POIHANA_ANIM_HUMI 4
#define SMS_POIHANA_ANIM_DEATH 5
#define SMS_POIHANA_ANIM_GETUP 6
#define SMS_POIHANA_ANIM_PIKUPIKU 7
#define SMS_POIHANA_ANIM_SLEEP_START 8
#define SMS_POIHANA_ANIM_SLEEP 9
#define SMS_POIHANA_ANIM_WAKEN 10
#define SMS_POIHANA_ANIM_SPIN 11
#define SMS_POIHANA_ANIM_WATERHIT 12
#define SMS_POIHANA_ANIM_WATERHIT2 13
#define SMS_BODY_GESO 9
extern const GeoLayout sms_geso_geo[];
extern const struct Animation *const sms_geso_anims[];
#define SMS_GESO_ANIM_WAIT1 0
#define SMS_GESO_ANIM_RUN1 1
#define SMS_GESO_ANIM_SEARCH1 2
#define SMS_GESO_ANIM_180TURN1 3
#define SMS_GESO_ANIM_PUNCH1 4
#define SMS_GESO_ANIM_GERO1 5
#define SMS_GESO_ANIM_HIT1 6
#define SMS_GESO_ANIM_DOWN1 7
#define SMS_GESO_ANIM_LAND1 8
#define SMS_GESO_ANIM_FALL1 9
#define SMS_GESO_ANIM_MAHI_START1 10
#define SMS_GESO_ANIM_MAHI_LOOP1 11
#define SMS_GESO_ANIM_MAHI_END1 12
#define SMS_GESO_ANIM_TURN_WAIT1 13
#define SMS_BODY_SHINE 10
extern const GeoLayout sms_shine_geo[];
extern const struct Animation *const sms_shine_anims[];
#define SMS_SHINE_ANIM_FLOAT 0
#define SMS_BODY_MAREM 11
extern const GeoLayout sms_marem_geo[];
extern const struct Animation *const sms_marem_anims[];
#define SMS_MAREM_ANIM_WAIT 0
#define SMS_MAREM_ANIM_WAIT_A 1
#define SMS_MAREM_ANIM_WAIT_B 2
#define SMS_MAREM_ANIM_WALK 3
#define SMS_MAREM_ANIM_RUN 4
#define SMS_MAREM_ANIM_TALK 5
#define SMS_MAREM_ANIM_HAPPY 6
#define SMS_MAREM_ANIM_MAD 7
#define SMS_MAREM_ANIM_MADLOOP 8
#define SMS_MAREM_ANIM_RECOVER 9
#define SMS_MAREM_ANIM_DANCE 10
#define SMS_MAREM_ANIM_THROW 11
#define SMS_MAREM_ANIM_SIT 12
#define SMS_MAREM_ANIM_SITTALK 13
#define SMS_BODY_MAREW 12
extern const GeoLayout sms_marew_geo[];
extern const struct Animation *const sms_marew_anims[];
#define SMS_MAREW_ANIM_WAIT 0
#define SMS_MAREW_ANIM_WAIT_A 1
#define SMS_MAREW_ANIM_WAIT_B 2
#define SMS_MAREW_ANIM_WALK 3
#define SMS_MAREW_ANIM_RUN 4
#define SMS_MAREW_ANIM_TALK 5
#define SMS_MAREW_ANIM_HAPPY 6
#define SMS_MAREW_ANIM_MAD 7
#define SMS_MAREW_ANIM_MADLOOP 8
#define SMS_MAREW_ANIM_RECOVER 9
#define SMS_MAREW_ANIM_DANCE 10
#define SMS_MAREW_ANIM_THROW 11
#define SMS_MAREW_ANIM_SIT 12
#define SMS_MAREW_ANIM_SITTALK 13
