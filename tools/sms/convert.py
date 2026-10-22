#!/usr/bin/env python3
"""Port Super Mario Sunshine characters to the SM64 engine.

Reads the game disc (SMS_ISO, the USA .iso/.nkit.iso) and converts each character listed
in CHARACTERS with the generic pipeline in character.py (smooth skinning, TEV-baked
looks, J3D animations), then writes engine/src/studio/sms/gen/ and the catalog manifest
engine/src/studio/sms/catalog.json (merged into the object library by gen_catalog.py).

    python3 tools/sms/convert.py

Adding a character = adding a spec function below (where its files are on the disc, its
scale, its animation list and any material overrides) and a behavior in engine/src/studio/sms/.
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gcm, nintendo, j3d
from character import Character, Textures

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'engine', 'src', 'studio', 'sms', 'gen')
ISO = os.environ.get('SMS_ISO', os.path.expanduser('~/Documents/m64/sms/iso/Super Mario Sunshine (USA).nkit.iso'))


class Disc:
    def __init__(self, path):
        self.g = gcm.GCM(path)
        self.cache = {}

    def scene(self, name):
        """The files of a scene archive (data/scene/<name>.szs) by path inside it."""
        if name not in self.cache:
            arc = nintendo.rarc(nintendo.yaz0(self.g.read(f'data/scene/{name}.szs')))
            self.cache[name] = {k.split('/', 1)[1]: v for k, v in arc.items()}
        return self.cache[name]


def tint(img, light, dark):
    """An intensity texture as a two-colour pattern (dark where black, light where white)."""
    i = img[..., 0:1].astype(float) / 255
    rgb = np.array(dark, float) * (1 - i) + np.array(light, float) * i
    out = np.concatenate([rgb, np.full(i.shape, 255.0)], axis=2)
    return out.clip(0, 255).astype(np.uint8)


def anims(files, names, pattern):
    """[(name, BCK bytes)] for the names that exist (pattern % name is the path)."""
    out = []
    for n in names:
        p = pattern % n
        if p in files:
            out.append((n, files[p]))
    return out


# ---- the Piantas -----------------------------------------------------------------------------

# Hawaiian shirts: the leaf pattern in two colours
SHIRTS = [((255, 214, 120), (226, 92, 40)), ((238, 246, 255), (52, 104, 214)), ((255, 240, 110), (214, 44, 60)),
          ((210, 255, 200), (40, 150, 90)), ((255, 220, 240), (190, 70, 150))]
PIANTA_ANIMS = ['wait', 'wait_a', 'wait_b', 'walk', 'run', 'talk', 'happy', 'mad', 'madloop', 'recover', 'dance', 'throw', 'sit', 'sittalk']
PIANTA_SCALE = 1.15  # Piantas stand a head taller than Mario


def piantas(disc):
    f = disc.scene('dolpic0')
    male = j3d.Model(f['montema/moma_model.bmd'])
    leaf = next(t['image'] for t in male.textures if t['name'] == 'I_momA_leaf_I4')
    shirts = [tint(leaf, light, dark) for light, dark in SHIRTS]
    mino = {'m': j3d.read_bti(f['montemcommon/i_mom_mino_rgba.bti'])['image'],
            'w': j3d.read_bti(f['montewcommon/i_mow_mino_rgba.bti'])['image']}
    specs = []
    for name, path, who in (('moma', 'montema/moma_model.bmd', 'm'), ('momd', 'montemd/momd_model.bmd', 'm'), ('mow', 'montew/mow_model.bmd', 'w')):
        model = j3d.Model(f[path])
        eyes = sorted({t['name'] for t in model.textures if 'eye0' in t['name']})
        eye_imgs = [next(t['image'] for t in model.textures if t['name'] == e) for e in eyes]
        common = 'montemcommon/mom_%s.bck' if who == 'm' else 'montewcommon/mow_%s.bck'
        mats = {'_hand_mat': {'tint': True},
                '_leafback_mat': {'textures': [mino[who]]},
                '_eye_mat': {'textures': eye_imgs, 'slot': 1, 'max_side': 32, 'layer': 'decal'}}
        if name == 'moma':
            mats['_fuku_mat'] = {'textures': shirts, 'slot': 2}
        if name == 'momd':
            mats['_fuku_mat'] = {'color': (246, 244, 236, 255)}  # a white tank top (the game colours it per Pianta)
        spec = {'name': name, 'model': f[path], 'scale': PIANTA_SCALE, 'materials': mats, 'shadow': 160, 'cull_radius': 500}
        if name == 'momd':
            spec['share_anims'] = 'moma'
        else:
            spec['anims'] = [(n, f.get(common % n) or f[common % 'wait']) for n in PIANTA_ANIMS]
        specs.append(spec)
    return specs


# ---- enemies ---------------------------------------------------------------------------------

def strollin_stu(disc):
    f = disc.scene('bianco0')
    return [{'name': 'hamukuri', 'model': f['hamukuri/default.bmd'], 'scale': 1.0, 'shadow': 90, 'cull_radius': 300,
             'anims': anims(f, ['walk', 'run', 'wait', 'kyoro', 'turn_start', 'turn_end', 'down', 'crash', 'jitabata', 'roll',
                                'return', 'appear', 'land', 'turn_down', 'set'], 'hamukurianm/hamukuri_%s.bck')}]


def swoopin_stu(disc):
    f = disc.scene('bianco0')
    return [{'name': 'namekuri', 'model': f['namekuri2/name.bmd'], 'scale': 0.9, 'shadow': 80, 'cull_radius': 300,
             # a translucent goop body (tinted per object: Swoopin' Stus come in many colours)
             # with the darker ball of goop inside
             'materials': {'_mat_body': {'color': (255, 255, 255, 215), 'tint': True, 'layer': 'xlu'}},
             'attach': [{'model': f['namekuri2/brain.bmd'], 'joint': 'jnt_brain', 'scale': 0.6,
                         'materials': {'_mat_brain': {'color': (105, 105, 105, 255), 'tint': True}}}],
             'anims': anims(f, ['wait', 'walk', 'jump_start', 'jump_end', 'land', 'hit', 'down', 'set'], 'namekuri2/name_%s.bck')}]


def electrokoopa(disc):
    f = disc.scene('pinnaParco0')
    names = ['wait1', 'nwait1', 'run1_loop', 'run1_start', 'run1_end', 'turn1_loop', 'shoot1', 'supply1', 'hit1', 'down1',
             'elec_down1', 'mogaki1_start', 'mogaki1_loop', 'mogaki1_end', 'catch1', 'melt1']
    return [{'name': 'dennoko', 'model': f['dennoko/dennoko_model1.bmd'], 'bmt': f['dennoko/dennoko_model1.bmt'], 'scale': 1.1,
             'shadow': 90, 'cull_radius': 300, 'materials': {'_koura1': {'tint': True}},  # (tinted: the crackle)
             'anims': [(n.replace('1', ''), f[f'dennoko/dennoko_{n}.bck']) for n in names]},
            {'name': 'koura', 'model': f['dennoko/koura_model1.bmd'], 'bmt': f['dennoko/dennoko_model1.bmt'], 'scale': 1.1,
             'shadow': 60, 'cull_radius': 200, 'materials': {'_koura1': {'tint': True}}, 'anims': [('still', None)]}]


def pokey(disc):
    f = disc.scene('bianco1')
    return [{'name': 'sambo', 'model': f['sambo/sambo.bmd'], 'scale': 1.0, 'shadow': 80, 'cull_radius': 500,
             'anims': anims(f, ['fwait', 'fset', 'fhide', 'fattack_start', 'fattack', 'fattack_end', 'fhit_start', 'hit',
                                'ydamage', 'down', 'ydown'], 'sambo/sambo_%s.bck')}]


def cataquack(disc):
    f = disc.scene('mamma0')
    # the body is white and tinted per object: blue Cataquacks toss Mario, red ones charge
    return [{'name': 'poihana', 'model': f['poihana/default.bmd'], 'scale': 1.0, 'shadow': 100, 'cull_radius': 350,
             'materials': {'_body': {'color': (255, 255, 255, 255), 'tint': True}},
             'anims': anims(f, ['wait', 'walk', 'dash', 'throw', 'humi', 'death', 'getup', 'pikupiku', 'sleep_start', 'sleep',
                                'waken', 'spin', 'waterhit', 'waterhit2'], 'poihana/poihana_%s.bck')}]


def blooper(disc):
    f = disc.scene('ricco0')
    return [{'name': 'geso', 'model': f['rikugesso/geso_model1.bmd'], 'scale': 1.0, 'shadow': 110, 'cull_radius': 400,
             'anims': anims(f, ['wait1', 'run1', 'search1', '180turn1', 'punch1', 'gero1', 'hit1', 'down1', 'land1', 'fall1',
                                'mahi_start1', 'mahi_loop1', 'mahi_end1', 'turn_wait1'], 'rikugesso/geso_%s.bck')}]


def shine_sprite(disc):
    f = disc.scene('airport0')
    # the gold: the radial gradient the body reflects, as a gold-to-highlight texture
    shine = j3d.Model(f['mapobj/shine.bmd'])
    grad = next(t['image'] for t in shine.textures if t['name'] == 'P_ms_radgrad_i')
    gold = tint(grad, (255, 250, 205), (236, 150, 22))
    # the golden body is sphere-mapped with a radial gradient; the glow is an additive billboard SM64 can't blend: left out
    return [{'name': 'shine', 'model': f['mapobj/shine.bmd'], 'scale': 0.8, 'shadow': 70, 'cull_radius': 300,
             'materials': {'_starglow1': {'skip': True}, '_mat_shine_eyes': {'layer': 'decal'},
                           '_mat_shine_body': {'color': (255, 255, 255, 255), 'textures': [gold], 'unlit': True}},
             'still_joints': ('shine',),  # its float lifts it 150 units: the behavior bobs it instead
             'anims': [('float', f['mapobj/shine_float.bck'])]}]


# the Piantas' numbering of moves (the same behavior drives both): Noki equivalents
NOKI_ANIMS = [('wait', 'wait'), ('wait_a', 'wait_a'), ('wait_b', 'stand'), ('walk', 'walk'), ('run', 'run'), ('talk', 'talk'),
              ('happy', 'happy'), ('mad', 'fall'), ('madloop', 'wait_fall'), ('recover', 'recover'), ('dance', 'dance'),
              ('throw', 'step'), ('sit', 'sit'), ('sittalk', 'sittalk')]
# shell colours: the shared pattern in two tones, picked per Noki (oSmsShirt)
SHELLS = [((255, 205, 222), (214, 92, 140)), ((205, 236, 255), (66, 128, 206)), ((214, 255, 226), (56, 160, 108)),
          ((255, 246, 190), (206, 150, 46)), ((236, 220, 255), (128, 88, 196))]


def nokis(disc):
    f = disc.scene('delfino1')
    out = []
    for name, who in (('marem', 'm'), ('marew', 'w')):
        model = j3d.Model(f[f'{name}/{name}.bmd'])
        eyes = sorted({t['name'] for t in model.textures if '_eye' in t['name']})
        eye_imgs = [next(t['image'] for t in model.textures if t['name'] == e) for e in eyes]
        # a Noki wears its shell (its body) on the hip and a hat on the head
        shell, hat = (('marem/marembivalve_b.bmd', 'marem/maremhat_a.bmd') if who == 'm' else ('marew/marewkai_a.bmd', 'marew/marewhatw_a.bmd'))
        bmt = f['marecommon/mare.bmt']
        pattern = next(t['image'] for t in j3d.Model(f[shell], bmt).textures if t['name'] == 'J_mare_A')
        shells = {'textures': [tint(pattern, light, dark) for light, dark in SHELLS], 'slot': 2}
        acc = {m: shells for m in ('_mat1', '_mat2', '_mat3')}
        out.append({'name': name, 'model': f[f'{name}/{name}.bmd'], 'scale': 1.1, 'shadow': 80, 'cull_radius': 300,
                    'attach': [{'model': f[shell], 'bmt': bmt, 'joint': 'koshi', 'materials': acc},
                               {'model': f[hat], 'bmt': bmt, 'joint': 'kubi', 'materials': acc}],
                    'materials': {'_eye': {'textures': eye_imgs, 'slot': 1, 'layer': 'decal'}, '_mouth': {'layer': 'decal'}},
                    'anims': [(n, f.get(f'{name}/{name}_{src}.bck') or f.get(f'{name}/{name}_{src}_a.bck') or f[f'{name}/{name}_wait.bck'])
                              for n, src in NOKI_ANIMS]})
    return out


CHARACTERS = [piantas, strollin_stu, swoopin_stu, electrokoopa, pokey, cataquack, blooper, shine_sprite, nokis]


def main():
    os.makedirs(OUT, exist_ok=True)
    disc = Disc(ISO)
    textures = Textures()
    specs = [s for fn in CHARACTERS for s in fn(disc)]
    chars, parts = [], []
    for index, spec in enumerate(specs):
        if 'share_anims' in spec:
            src = next(s for s in specs if s['name'] == spec['share_anims'])
            spec['anims'] = src['anims']
        c = Character(spec, textures)
        shared = next((x for x in chars if x.name == spec.get('share_anims')), None)
        parts.append(c.emit(index, shared))
        chars.append(c)
        print(f'{spec["name"]}: {len(c.m.joints)} joints, {sum(len(b[3]) for b in c.batches)} tris, {len(c.verts)} verts, '
              f'{len(c.mats)} materials, {len(c.ramps)} ramps, {len(spec["anims"])} anims')
    src = ['// Generated by tools/sms/convert.py from Super Mario Sunshine: do not edit.\n'] + textures.out + parts
    src.append('const struct SmsBody gSmsBodies[] = {\n' + '\n'.join(c.body_row for c in chars) + '\n};\n')
    src.append(f'const s32 gSmsBodyCount = {len(chars)};\n')
    with open(os.path.join(OUT, 'sms_data.inc.c'), 'w') as fo:
        fo.write('\n'.join(src))
    with open(os.path.join(OUT, 'sms_bodies.h'), 'w') as fo:
        fo.write('// Generated by tools/sms/convert.py: body numbers, geo layouts and animation numbers.\n')
        for i, c in enumerate(chars):
            n = c.name
            fo.write(f'#define SMS_BODY_{n.upper()} {i}\nextern const GeoLayout sms_{n}_geo[];\n')
            if 'share_anims' not in c.spec:
                fo.write(f'extern const struct Animation *const sms_{n}_anims[];\n')
                for k, an in enumerate(c.anim_names):
                    fo.write(f'#define SMS_{n.upper()}_ANIM_{an.upper()} {k}\n')
    for stale in ('piantas.inc.c', 'pianta_anims.h'):
        if os.path.exists(os.path.join(OUT, stale)):
            os.remove(os.path.join(OUT, stale))
    entries = catalog()
    with open(os.path.join(ROOT, 'engine', 'src', 'studio', 'sms', 'catalog.json'), 'w') as fo:
        json.dump(entries, fo, indent=1)
    size = os.path.getsize(os.path.join(OUT, 'sms_data.inc.c'))
    print(f'{len(chars)} bodies, {len(entries)} objects, sms_data.inc.c {size // 1024} KB')


def catalog():
    """Library entries. bparams are documented with each behavior (and server/catalog.js NOTES)."""
    return [
        {'id': 'sms:pianta', 'bhv': 'bhvSmsPianta', 'gfx': 'sms_moma_geo', 'name': 'Pianta', 'params': ['0x00000000', '0x00010000', '0x00000002']},
        {'id': 'sms:pianta_woman', 'bhv': 'bhvSmsPianta', 'gfx': 'sms_mow_geo', 'name': 'Pianta (woman)', 'params': ['0x00020000', '0x00020002']},
        {'id': 'sms:noki', 'bhv': 'bhvSmsPianta', 'gfx': 'sms_marem_geo', 'name': 'Noki', 'params': ['0x00030000', '0x00030001', '0x00030002']},
        {'id': 'sms:noki_woman', 'bhv': 'bhvSmsPianta', 'gfx': 'sms_marew_geo', 'name': 'Noki (woman)', 'params': ['0x00040000', '0x00040002']},
        {'id': 'sms:strollin_stu', 'bhv': 'bhvSmsStrollinStu', 'gfx': 'sms_hamukuri_geo', 'name': "Strollin' Stu", 'params': ['0x00000000', '0x00000001', '0x00010000']},
        {'id': 'sms:swoopin_stu', 'bhv': 'bhvSmsSwoopinStu', 'gfx': 'sms_namekuri_geo', 'name': "Swoopin' Stu", 'params': ['0x00000000', '0x00000100', '0x00000400']},
        {'id': 'sms:electrokoopa', 'bhv': 'bhvSmsElectrokoopa', 'gfx': 'sms_dennoko_geo', 'name': 'Electrokoopa', 'params': ['0x00000000', '0x00000001'],
         'also': ['bhvSmsElectroShell', 'bhvSmsHurtbox']},
        {'id': 'sms:pokey', 'bhv': 'bhvSmsPokey', 'gfx': 'sms_sambo_geo', 'name': 'Pokey (Sunshine)', 'params': ['0x00000000', '0x00000001']},
        {'id': 'sms:cataquack', 'bhv': 'bhvSmsCataquack', 'gfx': 'sms_poihana_geo', 'name': 'Cataquack', 'params': ['0x00000000', '0x00000100', '0x00000001']},
        {'id': 'sms:shine_sprite', 'bhv': 'bhvSmsShine', 'gfx': 'sms_shine_geo', 'name': 'Shine Sprite', 'params': ['0x00000000', '0x01000000', '0x02000000']},
        {'id': 'sms:blooper', 'bhv': 'bhvSmsBlooper', 'gfx': 'sms_geso_geo', 'name': 'Blooper (Sunshine)', 'params': ['0x00000000', '0x00000001']},
    ]


if __name__ == '__main__':
    main()
