#!/usr/bin/env python3
"""Studio 64 vehicles: copy the cars of the Shoggoth World hack (sm64-master, branch shoggoth) into
the engine as plain resident data.

The hack generates its cars with its own model kit (tools/shoggoth/courses/car/models.py: the red
sportscar, hw/models.py: the Shuto racers, tk/cars.py: the lofted cabs, sedans and buses) into each
level's generated C (levels/<level>/model.inc.c, geo.c, texture.inc.c). This script takes the geo
layouts named in CARS below, follows every symbol they use (display lists, vertices, textures,
lights, collision), renames them to stv_<look>_..., makes them static and writes one file:

    engine/src/studio/vehicles/cars.inc.c     (#included by engine/src/studio/vehicle_models.c)

Display lists lose the level's fog (2-cycle fog render modes become plain 1-cycle ones, like the
game's own objects), and the wheel callbacks (geo_sh_car_wheel, geo_hw_car_wheel) become
geo_studio_car_wheel. Textures the hack builds from PNGs are read from its build folder.

    python3 tools/vehicles/extract_cars.py [path/to/sm64-master]

The output ships with Studio 64. Run it through tools/shoggoth/refresh.mjs (npm run shoggoth:refresh),
which then takes the game's own data back out (the Drift King is a dressed vanilla Toad:
tools/shoggoth/split_vanilla.py).
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else (os.environ.get('SHOGGOTH_DIR') or os.path.join(ROOT, '..', 'sm64-master')))
OUT = os.path.join(ROOT, 'engine', 'src', 'studio', 'vehicles', 'cars.inc.c')

# look id: (level folder, geo layout, collision)
CARS = [
    ('sportscar', 'newyork', 'newyork_sportscar_geo', 'newyork_sportscar_collision'),
    ('racer', 'highway', 'highway_hw_player_geo', 'highway_hw_player_collision'),
    ('drift_king', 'highway', 'highway_hw_rival_geo', 'highway_hw_rival_collision'),
    ('taxi', 'newyork', 'newyork_taxi_geo', 'newyork_taxi_collision'),
    ('sedan', 'newyork', 'newyork_sedan_geo', 'newyork_sedan_collision'),
    ('bus', 'newyork', 'newyork_bus_geo', 'newyork_bus_collision'),
    ('shuto_van', 'highway', 'highway_hw_traffic_1_geo', 'highway_hw_traffic_collision'),
    ('shuto_cab', 'highway', 'highway_hw_traffic_2_geo', 'highway_hw_traffic_collision'),
    ('kei', 'tokyo', 'tokyo_kei_geo', None),
    ('kei_truck', 'tokyo', 'tokyo_kei_truck_geo', None),
    ('drift_king_driver', 'highway', 'highway_hw_drift_king_geo', None),
]

DEF_RE = re.compile(r'^(?:static\s+)?(?:const\s+)?(?:ALIGNED8\s+)?(?:const\s+)?(?:struct\s+)?(\w+)\s+(?:const\s+)?\*?\s*(?:const\s+)?(\w+)\s*\[[^\]]*\]\s*=\s*\{', re.M)
IDENT_RE = re.compile(r'\b[A-Za-z_]\w*\b')


def read(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def definitions(text):
    """name -> (type, text) of every top-level array definition (ends at a line that is '};')."""
    out = {}
    for m in DEF_RE.finditer(text):
        start = m.start()
        end = text.find('\n};', m.end())
        if end < 0:
            continue
        body = text[start:end + 3]
        out[m.group(2)] = (m.group(1), body)
    # lights: static const Lights1 name = gdSPDefLights1(...);
    for m in re.finditer(r'^(?:static\s+)?const\s+(Lights\d)\s+(\w+)\s*=\s*gdSPDefLights\d\(', text, re.M):
        end = text.find(');', m.end())
        out[m.group(2)] = (m.group(1), text[m.start():end + 2])
    return out


def level_defs(level):
    d = {}
    for name in ('model.inc.c', 'texture.inc.c', 'geo.c'):
        p = os.path.join(SRC, 'levels', level, name)
        if os.path.exists(p):
            d.update(definitions(read(p)))
    return d


def closure(defs, roots):
    seen, order, todo = set(), [], list(roots)
    while todo:
        n = todo.pop()
        if n in seen or n not in defs:
            continue
        seen.add(n)
        for ident in IDENT_RE.findall(defs[n][1]):
            if ident in defs and ident not in seen:
                todo.append(ident)
        order.append(n)
    # data before what uses it: textures, vertices, lights, then display lists, then geo layouts
    rank = {'Texture': 0, 'u8': 0, 'u16': 0, 'Vtx': 1, 'Lights1': 1, 'Lights2': 1, 'Ambient_t': 1, 'Light_t': 1, 'Gfx': 2, 'Collision': 3, 'GeoLayout': 4}
    # display lists that call each other: callees first (a stable topological order)
    deps = {n: [i for i in IDENT_RE.findall(defs[n][1]) if i in seen and i != n] for n in order}
    placed, out = set(), []

    def visit(n, stack=()):
        if n in placed or n in stack:
            return
        for d in deps[n]:
            visit(d, stack + (n,))
        placed.add(n)
        out.append(n)

    for n in sorted(order, key=lambda n: (rank.get(defs[n][0], 2), n)):
        visit(n)
    return out


def unfog(body):
    body = body.replace('gsDPSetCycleType(G_CYC_2CYCLE)', 'gsDPSetCycleType(G_CYC_1CYCLE)')
    body = re.sub(r'gsDPSetRenderMode\(G_RM_FOG_SHADE_A,\s*(G_RM_\w+?)2\)', r'gsDPSetRenderMode(\1, \g<1>2)', body)
    body = re.sub(r'gsDPSetRenderMode\(G_RM_FOG_PRIM_A,\s*(G_RM_\w+?)2\)', r'gsDPSetRenderMode(\1, \g<1>2)', body)
    body = re.sub(r'^\s*gsDPSetFogColor\([^)]*\),\n', '', body, flags=re.M)
    body = re.sub(r'^\s*gsSPFogPosition\([^)]*\),\n', '', body, flags=re.M)
    body = re.sub(r'^\s*gsSPSetGeometryMode\(G_FOG\),\n', '', body, flags=re.M)
    return body


def texture_include(level, inc):
    """The contents of a texture's #include: the source file, or the hack's build output (PNGs)."""
    for p in (os.path.join(SRC, inc), os.path.join(SRC, 'build', 'us', inc)):
        if os.path.exists(p):
            return read(p).strip()
    raise SystemExit(f'missing texture {inc} (build the hack once, or copy its build/us/levels)')


def main():
    if not all(os.path.exists(os.path.join(SRC, 'levels', lvl, 'geo.c')) for lvl in {c[1] for c in CARS}):
        print(f'No Shoggoth World checkout with its car levels at {SRC}: no vehicles (that is fine)')
        return
    cache = {}
    emitted = {}
    parts = ['// Generated by tools/vehicles/extract_cars.py from the Shoggoth World hack - do not edit.\n'
             '// The cars of its New York, Tokyo and Shuto expressway levels (their own model kit), as resident data.\n']
    table = []
    for look, level, geo, col in CARS:
        defs = cache.setdefault(level, level_defs(level))
        if geo not in defs:
            raise SystemExit(f'{geo} not found in levels/{level}')
        roots = [geo] + ([col] if col else [])
        names = closure(defs, roots)
        ren = {}
        for n in names:
            if n in emitted:
                ren[n] = emitted[n]
                continue
            short = re.sub(r'^(newyork|highway|tokyo)_', '', n)
            ren[n] = f'stv_{short}' if short.startswith(look) else f'stv_{look}_{short}'
        parts.append(f'\n// ---- {look} (levels/{level}: {geo}) ----\n')
        for n in names:
            if n in emitted:
                continue
            kind, body = defs[n]
            body = unfog(body) if kind == 'Gfx' else body
            body = body.replace('geo_sh_car_wheel', 'geo_studio_car_wheel').replace('geo_hw_car_wheel', 'geo_studio_car_wheel')
            body = re.sub(r'#include "(levels/[^"]+)"', lambda m: texture_include(level, m.group(1)), body)
            body = re.sub(r'\bconst Texture\b', 'const u8', body)  # (sm64ex has no Texture type)
            body = IDENT_RE.sub(lambda m: ren.get(m.group(0), m.group(0)), body)
            # the geo layouts are the catalog's (vehicles/cars.h); everything else stays in this file
            body = re.sub(r'^(?:static\s+)?', '' if n == geo else 'static ', body, count=1)
            parts.append(body + '\n')
            emitted[n] = ren[n]
        # the paint: the display lists the geo layout draws directly that hold the body
        gdls = re.findall(r'GEO_DISPLAY_LIST\(\w+,\s*(\w+)\)', defs[geo][1])
        paint = [d for d in gdls if 'body' in d] or [d for d in gdls if 'lights' not in d and 'wheel' not in d and 'steer' not in d]
        parts.append(f'static const Gfx *const stv_paint_{look}[] = {{ ' + ''.join(f'{ren[d]}, ' for d in paint) + 'NULL };\n')
        # the headlight beams on the road (the lights' see-through layers): left out with the lights off
        beams = [d for d in gdls if 'lights' in d and 'transparent' in d]
        parts.append(f'static const Gfx *const stv_beams_{look}[] = {{ ' + ''.join(f'{ren[d]}, ' for d in beams) + 'NULL };\n')
        # its size (every vertex of its display lists, wheels included): x, y, z min and max
        box = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]
        for n in names:
            if defs[n][0] != 'Vtx':
                continue
            for x, y, z in re.findall(r'\{\{\{\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\}', defs[n][1]):
                for i, v in enumerate((int(x), int(y), int(z))):
                    box[i * 2] = min(box[i * 2], v)
                    box[i * 2 + 1] = max(box[i * 2 + 1], v)
        table.append((look, ren[geo], ren[col] if col else 'NULL', box))
    parts.append('\n// look -> geo layout, collision (vehicle_models.c)\n')
    parts.append('#define STV_CAR_TABLE \\\n' + ' \\\n'.join(f'    {{ "{l}", {g}, {c}, stv_paint_{l}, stv_beams_{l}, {{ {", ".join(str(v) for v in b)} }} }},' for l, g, c, b in table) + '\n')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(''.join(parts))
    with open(os.path.join(os.path.dirname(OUT), 'cars.h'), 'w') as f:
        f.write('// Generated by tools/vehicles/extract_cars.py - do not edit.\n#ifndef STUDIO_VEHICLES_CARS_H\n#define STUDIO_VEHICLES_CARS_H\n'
                '#include "types.h"\n#include "studio/vehicle.h" // (the behaviors)\n' + ''.join(f'extern const GeoLayout {g}[];\n' for _, g, _, _ in table) + '#endif\n')
    print(f'{len(emitted)} symbols, {len(table)} looks -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
