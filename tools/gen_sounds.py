#!/usr/bin/env python3
"""The game's sound effects for the sound library: web/data/sounds.json (name, group, bits)."""
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GROUPS = {'MARIO': 'Mario', 'PEACH': 'Peach', 'GENERAL': 'General', 'GENERAL2': 'General', 'ACTION': 'Mario moves',
          'MOVING': 'Mario moves', 'ENV': 'Environment', 'OBJ': 'Objects', 'OBJ2': 'Objects', 'AIR': 'Air', 'MENU': 'Menu'}
SKIP = ('SOUND_ARG', 'SOUND_STATUS', 'SOUND_BANK', 'SOUND_TERRAIN', 'SOUND_NO_', 'SOUND_LOWER', 'SOUND_DISCRETE', 'SOUND_CONSTANT',
        'SOUND_VIBRATO', 'SOUND_NO_VOLUME', 'SOUND_PL', 'SOUND_SPEED')


def main():
    text = open(os.path.join(ROOT, 'engine', 'include', 'audio_defines.h')).read()
    status = 1
    out = []
    for m in re.finditer(r'#define (SOUND_\w+)\s+SOUND_ARG_LOAD\(([^)]*)\)', text):
        name, args = m.group(1), [a.strip() for a in m.group(2).split(',')]
        if name.startswith(SKIP) or len(args) != 5:
            continue
        try:
            bank, flags, sid, prio, flags2 = (int(a, 0) for a in args)
        except ValueError:
            continue
        bits = (bank << 28) | (flags << 24) | (sid << 16) | (prio << 8) | (flags2 << 4) | status
        key = name[6:].split('_')[0]
        group = GROUPS.get(key, 'Other')
        label = name[6 + len(key) + 1:].replace('_', ' ').lower().strip() or name.lower()
        if 'unknown' in label or 'unk' in label.split():
            continue  # the decomp never named these
        out.append({'id': name, 'group': group, 'name': label[:1].upper() + label[1:], 'bits': bits})
    order = ['General', 'Mario', 'Objects', 'Mario moves', 'Environment', 'Menu', 'Air', 'Peach', 'Other']
    out.sort(key=lambda s: (order.index(s['group']) if s['group'] in order else 99, s['name']))
    dest = os.path.join(ROOT, 'web', 'data', 'sounds.json')
    json.dump(out, open(dest, 'w'), separators=(',', ':'))
    print(len(out), 'sounds ->', dest)


if __name__ == '__main__':
    main()
