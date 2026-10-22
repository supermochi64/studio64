#!/usr/bin/env python3
"""List every texture of the game for the texture browser (web/data/textures.json).

Reads the raw N64 texture files the engine build converts from the PNGs
(engine/build/us_web/**/*.rgba16 etc.) and records, per texture, its format, size
and a fingerprint (a probe window and a hash of all bytes). The page finds each
texture in the running game's memory by that fingerprint, so it can show and
replace any of them without the engine having to export symbol addresses.

Run after building the engine:  python3 tools/gen_textures.py
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, 'engine')
BUILD = os.path.join(ENGINE, 'build', 'us_web')
OUT = os.path.join(ROOT, 'web', 'data', 'textures.json')

FORMATS = {'rgba16': ('rgba', 16), 'rgba32': ('rgba', 32), 'ia1': ('ia', 1), 'ia4': ('ia', 4), 'ia8': ('ia', 8),
           'ia16': ('ia', 16), 'i4': ('i', 4), 'i8': ('i', 8), 'ci4': ('ci', 4), 'ci8': ('ci', 8)}

LEVEL_NAMES = {
    'bob': "Bob-omb Battlefield", 'wf': "Whomp's Fortress", 'jrb': 'Jolly Roger Bay', 'ccm': 'Cool, Cool Mountain',
    'bbh': "Big Boo's Haunt", 'hmc': 'Hazy Maze Cave', 'lll': 'Lethal Lava Land', 'ssl': 'Shifting Sand Land',
    'ddd': 'Dire, Dire Docks', 'sl': "Snowman's Land", 'wdw': 'Wet-Dry World', 'ttm': 'Tall, Tall Mountain',
    'thi': 'Tiny-Huge Island', 'ttc': 'Tick Tock Clock', 'rr': 'Rainbow Ride', 'castle_grounds': 'Castle grounds',
    'castle_inside': 'Castle inside', 'castle_courtyard': 'Castle courtyard', 'bitdw': 'Bowser in the Dark World',
    'bitfs': 'Bowser in the Fire Sea', 'bits': 'Bowser in the Sky', 'bowser_1': 'Bowser 1', 'bowser_2': 'Bowser 2',
    'bowser_3': 'Bowser 3', 'pss': "Peach's Secret Slide", 'cotmc': 'Cavern of the Metal Cap', 'totwc': 'Tower of the Wing Cap',
    'vcutm': 'Vanish Cap under the Moat', 'wmotr': 'Wing Mario over the Rainbow', 'sa': 'Secret Aquarium', 'menu': 'Menus',
    'intro': 'Intro', 'ending': 'Ending',
}


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def fnv(data):
    h = 0x811C9DC5
    for b in data:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def probe(data):
    # the first 8-byte window that is not a single repeated byte (textures are 8-byte aligned)
    for off in range(0, len(data) - 7, 8):
        w = data[off:off + 8]
        if len(set(w)) > 2:
            return off, struct.unpack('<II', w)
    return 0, struct.unpack('<II', (data + b'\0' * 8)[:8])


def group_of(rel):
    parts = rel.split('/')
    if parts[0] == 'actors':
        return 'Mario' if parts[1] in ('mario', 'mario_cap') else 'Objects'
    if parts[0] == 'levels':
        return LEVEL_NAMES.get(parts[1], parts[1].replace('_', ' ').title())
    if parts[0] == 'textures':
        sub = parts[1]
        if sub in ('segment2',):
            return 'HUD and text'
        if sub in ('effect',):
            return 'Effects'
        if sub in ('title_screen_bg', 'intro_raw'):
            return 'Title and intro'
        return 'Level textures: ' + sub.replace('_', ' ')
    return parts[0]


def main():
    if not os.path.isdir(BUILD):
        sys.exit('engine/build/us_web is missing: build the engine first')
    entries = []
    for dirpath, _, files in os.walk(BUILD):
        for f in files:
            ext = f.rsplit('.', 1)[-1]
            if ext not in FORMATS:
                continue
            raw = os.path.join(dirpath, f)
            rel = os.path.relpath(raw, BUILD)
            if rel.startswith('textures/skyboxes') or rel.startswith('bin/'):
                continue
            png = os.path.join(ENGINE, rel + '.png')
            size = png_size(png) if os.path.exists(png) else None
            if not size:
                continue
            with open(raw, 'rb') as fh:
                data = fh.read()
            if len(data) < 16:
                continue
            fmt, bits = FORMATS[ext]
            w, h = size
            off, (a, b) = probe(data)
            # a second window in the middle: cheap to check before hashing every byte
            mid = (len(data) // 2) & ~7
            c, d = struct.unpack('<II', (data[mid:mid + 8] + b'\0' * 8)[:8])
            entries.append([rel, group_of(rel), fmt, bits, w, h, len(data), off, a, b, fnv(data), mid, c, d])
    entries.sort(key=lambda e: (e[1], e[0]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        json.dump({'fields': ['path', 'group', 'fmt', 'bits', 'w', 'h', 'len', 'probe', 'a', 'b', 'hash', 'mid', 'c', 'd'], 'textures': entries}, fh, separators=(',', ':'))
    print(f'{len(entries)} textures -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
