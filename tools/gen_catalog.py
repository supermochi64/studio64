#!/usr/bin/env python3
"""Build the Studio 64 object catalog from the decomp sources.

Every object vanilla SM64 places anywhere (level scripts, macro objects,
special objects) becomes a catalog entry: behavior + model + the model's
geo/display list, plus the extra models its behavior spawns. Every other
loaded model becomes a static "prop". Writes the C table the engine links
and the JSON the server searches.
"""
import json, os, re, sys
from collections import defaultdict, OrderedDict

ENG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'engine')
OUT_C = os.path.join(ENG, 'src/studio/gen/catalog.inc.c')
OUT_JSON = os.path.join(os.path.dirname(__file__), '..', 'server/data/catalog.json')

def read(p):
    with open(os.path.join(ENG, p), errors='replace') as f:
        return f.read()

def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    return re.sub(r'//[^\n]*', '', s)

LEVEL_NAMES = {
    'bbh': "Big Boo's Haunt", 'bitdw': 'Bowser in the Dark World', 'bitfs': 'Bowser in the Fire Sea',
    'bits': 'Bowser in the Sky', 'bob': 'Bob-omb Battlefield', 'bowser_1': 'Bowser 1 arena',
    'bowser_2': 'Bowser 2 arena', 'bowser_3': 'Bowser 3 arena', 'castle_courtyard': 'Castle courtyard',
    'castle_grounds': 'Castle grounds', 'castle_inside': 'Castle inside', 'ccm': 'Cool, Cool Mountain',
    'cotmc': 'Cavern of the Metal Cap', 'ddd': 'Dire, Dire Docks', 'hmc': 'Hazy Maze Cave',
    'jrb': 'Jolly Roger Bay', 'lll': 'Lethal Lava Land', 'pss': "Princess's Secret Slide",
    'rr': 'Rainbow Ride', 'sa': 'Secret Aquarium', 'sl': "Snowman's Land", 'ssl': 'Shifting Sand Land',
    'thi': 'Tiny-Huge Island', 'totwc': 'Tower of the Wing Cap', 'ttc': 'Tick Tock Clock',
    'ttm': 'Tall, Tall Mountain', 'vcutm': 'Vanish Cap under the Moat', 'wdw': 'Wet-Dry World',
    'wf': "Whomp's Fortress", 'wmotr': 'Wing Mario over the Rainbow',
}
LEVELS = [l for l in LEVEL_NAMES if os.path.isdir(os.path.join(ENG, 'levels', l))]

LOAD_GEO = re.compile(r'LOAD_MODEL_FROM_GEO\(\s*(\w+)\s*,\s*(\w+)\s*\)')
LOAD_DL = re.compile(r'LOAD_MODEL_FROM_DL\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)')

def model_loads(text):
    out = OrderedDict()
    for m in LOAD_GEO.finditer(text):
        out[m.group(1)] = ('geo', m.group(2), 'LAYER_OPAQUE')
    for m in LOAD_DL.finditer(text):
        out[m.group(1)] = ('dl', m.group(2), m.group(3))
    return out

# --- global group scripts and boot-time models -----------------------------
scripts = strip_comments(read('levels/scripts.c'))
group_models = {}
for m in re.finditer(r'const LevelScript (script_func_global_\d+)\[\]\s*=\s*\{(.*?)\};', scripts, re.S):
    group_models[m.group(1)] = model_loads(m.group(2))
main = re.search(r'const LevelScript level_main_scripts_entry\[\]\s*=\s*\{(.*?)\};', scripts, re.S)
boot_models = model_loads(main.group(1))

# --- per-level contexts ----------------------------------------------------
contexts = {}      # level -> {MODEL: (kind, sym, layer)}
placements = []    # (level, area, bhv, MODEL, bparam, x, y, z, yaw)
OBJ = re.compile(r'OBJECT(?:_WITH_ACTS)?\(\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,'
                 r'\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*([^,]+?)\s*,\s*(\w+)\s*[,)]')
for lvl in LEVELS:
    text = strip_comments(read(f'levels/{lvl}/script.c'))
    ctx = OrderedDict(boot_models)
    for g in re.findall(r'JUMP_LINK\(\s*(script_func_global_\d+)\s*\)', text):
        ctx.update(group_models.get(g, {}))
    ctx.update(model_loads(text))
    contexts[lvl] = ctx
    # objects: area tracking is approximate (local scripts are linked from areas)
    for m in OBJ.finditer(text):
        model, x, y, z, rx, ry, rz, bp, bhv = m.groups()
        placements.append((lvl, bhv, model, bp.strip(), int(x), int(y), int(z), int(ry)))

# --- macro + special presets ------------------------------------------------
names = strip_comments(read('include/macro_preset_names.h'))
macro_names = re.findall(r'\b(macro_\w+)\b', re.search(r'enum MacroPresets\s*\{(.*?)\}', names, re.S).group(1))
mp = strip_comments(read('include/macro_presets.h'))
macro_presets = re.findall(r'\{\s*(\w+)\s*,\s*(\w+)\s*,\s*([^}]*?)\s*\}', mp.split('MacroObjectPresets[]')[1])
macro_map = {macro_names[i]: macro_presets[i] for i in range(min(len(macro_names), len(macro_presets)))}
sp = strip_comments(read('include/special_presets.h'))
special = {}
for m in re.finditer(r'\{\s*(0x[0-9A-Fa-f]+)\s*,\s*(\w+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\}', sp):
    special[int(m.group(1), 16)] = (m.group(5), m.group(4))
spn = strip_comments(read('include/special_preset_names.h'))
special_names = {}
nxt = 0
for m in re.finditer(r'\b(special_\w+)\s*(?:=\s*(0x[0-9A-Fa-f]+|\d+))?\s*,', re.search(r'enum SpecialPresets\s*\{(.*?)\}', spn, re.S).group(1) + ','):
    if m.group(2):
        nxt = int(m.group(2), 0)
    special_names[m.group(1)] = nxt
    nxt += 1

MACRO = re.compile(r'MACRO_OBJECT(?:_WITH_BEH_PARAM)?\(\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*([^)]+))?\)')
SPECIAL = re.compile(r'SPECIAL_OBJECT(?:_WITH_YAW(?:_AND_PARAM)?)?\(\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)')
for lvl in LEVELS:
    for root, _, files in os.walk(os.path.join(ENG, 'levels', lvl)):
        for f in files:
            if f == 'macro.inc.c':
                for m in MACRO.finditer(strip_comments(open(os.path.join(root, f)).read())):
                    pre = macro_map.get(m.group(1))
                    if not pre or pre[0] == 'bhvYellowCoin' and m.group(1).startswith('macro_empty'):
                        continue
                    bhv, model, param = pre
                    bp = m.group(6).strip() if m.group(6) else '0'
                    bparam = f'(({bp}) & 0xFF) << 16' if bp != '0' else (f'(({param}) & 0xFF) << 16' if param.strip() != '0' else '0')
                    placements.append((lvl, bhv, model, bparam, int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(2)) * 360 // 256))
            elif f == 'collision.inc.c':
                for m in SPECIAL.finditer(strip_comments(open(os.path.join(root, f)).read())):
                    sid = special_names.get(m.group(1))
                    if sid is None or sid not in special:
                        continue
                    bhv, model = special[sid]
                    if bhv == 'NULL':
                        continue
                    placements.append((lvl, bhv, model, '0', int(m.group(2)), int(m.group(3)), int(m.group(4)), 0))

# --- behaviors: names, natives, models they reference ------------------------
bd = strip_comments(read('data/behavior_data.c'))
bhv_bodies = {m.group(1): m.group(2) for m in
              re.finditer(r'const BehaviorScript (bhv\w+)\[\]\s*=\s*\{(.*?)\};', bd, re.S)}
bhv_names = [b for b in re.findall(r'extern const BehaviorScript (bhv\w+)\[\];', read('include/behavior_data.h')) if b in bhv_bodies]

func_file = {}
for d in ('src/game/behaviors', 'src/game'):
    for f in sorted(os.listdir(os.path.join(ENG, d))):
        if not f.endswith('.c'):
            continue
        t = read(f'{d}/{f}')
        for m in re.finditer(r'^\w[\w\s\*]*?\b(\w+)\s*\([^;{]*\)\s*\{', t, re.M):
            func_file.setdefault(m.group(1), f'{d}/{f}')
file_models = {}
def models_in_file(p):
    if p not in file_models:
        file_models[p] = set(re.findall(r'\b(MODEL_\w+)\b', strip_comments(read(p))))
    return file_models[p]
# behaviour files that are shared by many behaviours make the dependency list noisy
SHARED = {'src/game/obj_behaviors.c', 'src/game/obj_behaviors_2.c', 'src/game/object_helpers.c',
          'src/game/behavior_actions.c', 'src/game/interaction.c', 'src/game/mario.c'}
def bhv_deps(bhv, seen=None):
    seen = seen or set()
    if bhv in seen or bhv not in bhv_bodies:
        return set()
    seen.add(bhv)
    body = bhv_bodies[bhv]
    deps = set(re.findall(r'\b(MODEL_\w+)\b', body))
    for fn in re.findall(r'CALL_NATIVE\(\s*(\w+)\s*\)', body):
        p = func_file.get(fn)
        if p and p not in SHARED:
            deps |= models_in_file(p)
    for child in re.findall(r'SPAWN_CHILD(?:_WITH_PARAM)?\([^)]*?(bhv\w+)\s*\)', body):
        deps |= bhv_deps(child, seen)
    return deps

# --- build entries -----------------------------------------------------------
def snake(n):
    n = n[3:] if n.startswith('bhv') else n
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', n).lower()

entries = OrderedDict()   # (bhv, gfxsym) -> entry
for lvl, bhv, model, bp, x, y, z, yaw in placements:
    if bhv not in bhv_bodies or bhv == 'bhvMario':
        continue
    ctx = contexts[lvl]
    gfx = ctx.get(model) if model != 'MODEL_NONE' else None
    if model != 'MODEL_NONE' and gfx is None:
        continue
    key = (bhv, gfx[1] if gfx else None)
    e = entries.get(key)
    if e is None:
        deps = []
        for dm in sorted(bhv_deps(bhv)):
            if dm in ('MODEL_NONE', model) or dm not in ctx:
                continue
            deps.append((dm,) + ctx[dm])
        e = entries[key] = dict(bhv=bhv, model=model, gfx=gfx, level=lvl, deps=deps,
                                params=defaultdict(int), seen=defaultdict(int), example=None)
    e['params'][bp] += 1
    e['seen'][lvl] += 1
    if e['example'] is None:
        e['example'] = dict(level=lvl, pos=[x, y, z], yaw=yaw)

# objects vanilla only spawns from code
EXTRAS = [('bhvWingCap', 'MODEL_MARIOS_WING_CAP'), ('bhvMetalCap', 'MODEL_MARIOS_METAL_CAP'),
          ('bhvVanishCap', 'MODEL_MARIOS_CAP'), ('bhvKoopaShell', 'MODEL_KOOPA_SHELL'),
          ('bhvSpiny', 'MODEL_SPINY'), ('bhv1upWalking', 'MODEL_1UP'), ('bhvRecoveryHeart', 'MODEL_HEART'),
          ('bhvBreakableBoxSmall', 'MODEL_BREAKABLE_BOX_SMALL'), ('bhvMetalCap', 'MODEL_MARIOS_METAL_CAP')]
for bhv, model in EXTRAS:
    for lvl in LEVELS:
        gfx = contexts[lvl].get(model)
        if gfx and (bhv, gfx[1]) not in entries and bhv in bhv_bodies:
            deps = [(dm,) + contexts[lvl][dm] for dm in sorted(bhv_deps(bhv))
                    if dm not in ('MODEL_NONE', model) and dm in contexts[lvl]]
            entries[(bhv, gfx[1])] = dict(bhv=bhv, model=model, gfx=gfx, level=lvl, deps=deps,
                                          params=defaultdict(int, {'0': 1}), seen=defaultdict(int, {lvl: 1}),
                                          example=None)
            break

# readable unique ids
by_id = defaultdict(list)
for key, e in entries.items():
    by_id[snake(e['bhv'])].append(e)
for base, es in by_id.items():
    if len(es) == 1:
        es[0]['id'] = base
    else:
        for e in es:
            suffix = (e['gfx'][1] if e['gfx'] else 'none').replace('_geo', '')
            suffix = re.sub(r'_seg\w+', '', suffix)
            e['id'] = f'{base}:{suffix}'
        ids = [e['id'] for e in es]
        for i, e in enumerate(es):
            if ids.count(e['id']) > 1:
                e['id'] = f"{e['id']}:{e['level']}"

covered = {e['gfx'][1] for e in entries.values() if e['gfx']}
props = OrderedDict()
for lvl in LEVELS:
    for model, gfx in contexts[lvl].items():
        if gfx[1] in covered or gfx[1] in props or model == 'MODEL_MARIO':
            continue
        props[gfx[1]] = dict(bhv='bhvStaticObject', model=model, gfx=gfx, level=lvl, deps=[],
                             params={'0': 1}, seen={lvl: 1}, example=None,
                             id='prop:' + re.sub(r'_seg\w+', '', gfx[1]).replace('_geo', ''))
all_entries = list(entries.values()) + list(props.values())

# characters ported from Super Mario Sunshine (tools/sms/convert.py writes the manifest)
# (only when they were converted from a disc: without one, gen/ holds the stand-in from stub/)
SMS_MANIFEST = os.path.join(ENG, 'src/studio/sms/catalog.json')
SMS_BODIES = os.path.join(ENG, 'src/studio/sms/gen/sms_bodies.h')
SMS_REAL = os.path.exists(SMS_BODIES) and 'SMS_STUB' not in open(SMS_BODIES).read()
if os.path.exists(SMS_MANIFEST) and SMS_REAL:
    for m in json.load(open(SMS_MANIFEST)):
        for b in [m['bhv']] + m.get('also', []):  # their scripts live in src/studio/sms/sms_behaviors.c
            if b not in bhv_names:
                bhv_names.append(b)
        all_entries.append(dict(id=m['id'], bhv=m['bhv'], model='MODEL_NONE', gfx=('geo', m['gfx'], 'LAYER_OPAQUE'),
                                level=None, deps=[], params={p: 1 for p in m['params']}, seen={}, example=None, name=m['name']))

# vehicles ported from the Shoggoth World hack (tools/vehicles/extract_cars.py, src/studio/vehicle*.c)
VEHICLE_MANIFEST = os.path.join(ENG, 'src/studio/vehicles/catalog.json')
# (shipped in the repository; vehicle_models.c keeps a stand-in for a tree without them)
VEHICLES_REAL = os.path.exists(os.path.join(ENG, 'src/studio/vehicles/cars.inc.c')) and os.path.exists(os.path.join(ENG, 'src/studio/vehicles/cars.h'))
if os.path.exists(VEHICLE_MANIFEST) and VEHICLES_REAL:
    for m in json.load(open(VEHICLE_MANIFEST)):
        for b in [m['bhv']] + m.get('also', []):  # their scripts live in data/behavior_data.c
            if b not in bhv_names:
                bhv_names.append(b)
        all_entries.append(dict(id=m['id'], bhv=m['bhv'], model='MODEL_NONE', gfx=('geo', m['gfx'], 'LAYER_OPAQUE'),
                                level=None, deps=[], params={p: 1 for p in m['params']}, seen={}, example=None, name=m['name']))

# Shotgun Mario from the Shoggoth World hack: the pickup and the gangsters (src/studio/shotgun*.c,
# models from tools/shotgun_extract.py)
SHOTGUN_MANIFEST = os.path.join(ENG, 'src/studio/shotgun/catalog.json')
# (shipped in the repository; src/studio/shotgun_models.h keeps stand-ins for a tree without them)
if os.path.exists(SHOTGUN_MANIFEST) and os.path.exists(os.path.join(ENG, 'src/studio/shotgun/models.inc.c')):
    for m in json.load(open(SHOTGUN_MANIFEST)):
        for b in [m['bhv']] + m.get('also', []):  # their scripts live in src/studio/shotgun_behaviors.c
            if b not in bhv_names:
                bhv_names.append(b)
        all_entries.append(dict(id=m['id'], bhv=m['bhv'], model='MODEL_NONE', gfx=('geo', m['gfx'], 'LAYER_OPAQUE'),
                                level=None, deps=[], params={p: 1 for p in m['params']}, seen={}, example=None, name=m['name']))

# Katana Mario from the Shoggoth World hack: the Legendary Blade, the katana fighters, the katana duel
# (src/studio/katana*.c, models from tools/katana_extract.py; shipped like the rest of the Shoggoth content)
KATANA_MANIFEST = os.path.join(ENG, 'src/studio/katana/catalog.json')
if os.path.exists(KATANA_MANIFEST) and os.path.exists(os.path.join(ENG, 'src/studio/katana/models.inc.c')):
    for m in json.load(open(KATANA_MANIFEST)):
        for b in [m['bhv']] + m.get('also', []):  # their scripts live in src/studio/katana_behaviors.c
            if b not in bhv_names:
                bhv_names.append(b)
        all_entries.append(dict(id=m['id'], bhv=m['bhv'], model='MODEL_NONE', gfx=('geo', m['gfx'], 'LAYER_OPAQUE'),
                                level=None, deps=[], params={p: 1 for p in m['params']}, seen={}, example=None, name=m['name']))

# Tokyo from the Shoggoth World hack (tools/import_shoggoth_tokyo.mjs writes the manifest
# with the level data; src/studio/shoggoth/tokyo*.c): shipped in the repository
TOKYO_MANIFEST = os.path.join(ENG, 'src/studio/shoggoth/gen/catalog.json')
if os.path.exists(TOKYO_MANIFEST) and os.path.exists(os.path.join(ENG, 'src/studio/shoggoth/gen/tokyo_data.inc.c')):
    for m in json.load(open(TOKYO_MANIFEST)):
        for b in [m['bhv']] + m.get('also', []):
            if b not in bhv_names:
                bhv_names.append(b)
        all_entries.append(dict(id=m['id'], bhv=m['bhv'], model='MODEL_NONE', gfx=('geo', m['gfx'], 'LAYER_OPAQUE') if m.get('gfx') else None,
                                level=None, deps=[], params={p: 1 for p in m['params']}, seen={}, example=None, name=m['name']))

# --- write C -----------------------------------------------------------------
os.makedirs(os.path.dirname(OUT_C), exist_ok=True)
with open(OUT_C, 'w') as f:
    f.write('// Generated by tools/gen_catalog.py - do not edit.\n')
    for g in ['common0', 'common1'] + [f'group{i}' for i in range(18)]:
        f.write(f'#include "actors/{g}.h"\n')
    for lvl in LEVELS + ['menu', 'intro', 'ending']:
        f.write(f'#include "levels/{lvl}/header.h"\n')
    f.write('#include "studio/sms/sms.h"\n')
    f.write('#include "studio/vehicles/cars.h"\n' if VEHICLES_REAL else '#include "studio/vehicle.h"\n')
    f.write('#include "studio/shotgun_bhv.h"\n')
    f.write('#include "studio/katana_bhv.h"\n')
    f.write('#include "studio/shoggoth/tokyo_data.h"\n')
    f.write('\nconst struct StudioBehavior gStudioBehaviors[] = {\n')
    for b in bhv_names:
        f.write(f'    {{ "{b}", {b} }},\n')
    f.write('};\nconst s32 gStudioBehaviorCount = sizeof(gStudioBehaviors) / sizeof(gStudioBehaviors[0]);\n\n')
    f.write('static const struct StudioModelRef sStudioDeps[] = {\n')
    starts = []
    n = 0
    for e in all_entries:
        starts.append(n)
        for dm, kind, sym, layer in e['deps']:
            f.write(f'    {{ {dm}, {1 if kind == "geo" else 2}, {layer}, {sym} }},\n')
            n += 1
    f.write('    { 0, 0, 0, NULL }\n};\n\n')
    f.write('const struct StudioCatalogEntry gStudioCatalog[] = {\n')
    for e, s in zip(all_entries, starts):
        if e['gfx']:
            kind, sym, layer = e['gfx']
            ref = f'{{ {e["model"]}, {1 if kind == "geo" else 2}, {layer}, {sym} }}'
        else:
            ref = '{ MODEL_NONE, 0, 0, NULL }'
        f.write(f'    {{ "{e["id"]}", {e["bhv"]}, {ref}, &sStudioDeps[{s}], {len(e["deps"])} }},\n')
    f.write('};\nconst s32 gStudioCatalogCount = sizeof(gStudioCatalog) / sizeof(gStudioCatalog[0]);\n')

# --- write JSON --------------------------------------------------------------
level_nums = {}
n = 0
for m in re.finditer(r'^(STUB_LEVEL|DEFINE_LEVEL)\(\s*"[^"]*"\s*,\s*(LEVEL_\w+)\s*,\s*\w+\s*,\s*(\w+)?', read('levels/level_defines.h'), re.M):
    n += 1
    if m.group(1) == 'DEFINE_LEVEL':
        level_nums[m.group(3)] = n
dialogs = {}
for i, m in enumerate(re.findall(r'\b(DIALOG_\d+)\b', strip_comments(read('include/dialog_ids.h')))):
    dialogs.setdefault(m, int(m[7:]))
def norm_param(p):
    expr = p
    for k, v in dialogs.items():
        expr = expr.replace(k, str(v))
    try:
        return '0x%08X' % (eval(expr, {'__builtins__': {}}) & 0xFFFFFFFF)
    except Exception:
        return p
out = []
for i, e in enumerate(all_entries):
    params = sorted(e['params'].items(), key=lambda kv: -kv[1])
    out.append(dict(index=i, id=e['id'], behavior=e['bhv'], model=e['model'],
                    gfx=e['gfx'][1] if e['gfx'] else None, prop=e['id'].startswith('prop:'),
                    levels=sorted(e['seen'], key=lambda l: -e['seen'][l]),
                    params=list(OrderedDict.fromkeys(norm_param(p) for p, _ in params))[:6], example=e['example'],
                    **({'name': e['name']} if e.get('name') else {})))
with open(OUT_JSON, 'w') as f:
    MAIN_COURSES = {'bob', 'wf', 'jrb', 'ccm', 'bbh', 'hmc', 'lll', 'ssl', 'ddd', 'sl', 'wdw', 'ttm', 'thi', 'ttc', 'rr'}
    json.dump(dict(studio_level=level_nums.get('studio'), levels={k: dict(name=v, num=level_nums.get(k), acts=k in MAIN_COURSES) for k, v in LEVEL_NAMES.items()}, behaviors=bhv_names, entries=out), f, indent=0)
print(f'{len(entries)} objects + {len(props)} props, {len(bhv_names)} behaviors -> {OUT_C}')
