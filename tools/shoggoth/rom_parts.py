#!/usr/bin/env python3
"""Make the Shoggoth pieces that are built on the game's own data (run by tools/build_engine.sh).

    python3 tools/shoggoth/rom_parts.py [--force]

Reads every engine/src/studio/**/rom_recipes.json (written by tools/shoggoth/split_vanilla.py when the
Shoggoth content was refreshed from the checkout) and writes engine/src/studio/romgen/<package>/<name>.inc.c:
the display lists that draw the vanilla Toad's and Goomba's triangles (re-lit, with the hack's gear) and
the textures recoloured from the vanilla ones -- from engine/actors/ (the decomp's model files and the
textures extract_assets.py takes from your ROM). The output is gitignored; the shipped C includes it.
Standard library only.
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vanilla as V  # noqa: E402

OUT = os.path.join(V.ENGINE, 'src', 'studio', 'romgen')


def ensure_assets(recipes):
    need = sorted({r['base'] for rec in recipes for r in rec['textures'].values()})
    missing = [p for p in need if not os.path.exists(os.path.join(V.ENGINE, p))]
    if missing:
        # the game's textures come from the ROM: sm64ex's extractor (the Makefile runs it too)
        print('[rom_parts] extracting the game\'s assets from engine/baserom.us.z64 first')
        subprocess.run([sys.executable, 'extract_assets.py', 'us'], cwd=V.ENGINE, check=True)
    missing = [p for p in need if not os.path.exists(os.path.join(V.ENGINE, p))]
    if missing:
        raise SystemExit('rom_parts: the game textures %s are missing (is engine/baserom.us.z64 your US ROM?)' % missing)


def main():
    files = sorted(glob.glob(os.path.join(V.ENGINE, 'src', 'studio', '**', 'rom_recipes.json'), recursive=True))
    files = [f for f in files if '/romgen/' not in f]
    recipes = [V.load_recipes(f) for f in files]
    sig = hashlib.sha1()
    for f in files + [os.path.abspath(V.__file__), os.path.abspath(__file__)]:
        sig.update(open(f, 'rb').read())
    sig = sig.hexdigest()
    stamp = os.path.join(OUT, 'stamp.txt')
    if '--force' not in sys.argv and os.path.exists(stamp) and open(stamp).read().strip() == sig:
        print('[rom_parts] up to date')
        return
    ensure_assets(recipes)
    van = V.Vanilla()
    n = 0
    for rec in recipes:
        d = os.path.join(OUT, rec['package'])
        os.makedirs(d, exist_ok=True)
        for name, r in rec['dls'].items():
            src = '// Made by tools/shoggoth/rom_parts.py from the game\'s data - do not edit.\n' + V.build_dl(r, van)
            p = os.path.join(d, name + '.inc.c')
            if not os.path.exists(p) or open(p).read() != src:
                open(p, 'w').write(src)
            n += 1
        for name, r in rec['textures'].items():
            src = V.c_bytes(V.build_texture(r, van))
            p = os.path.join(d, name + '.inc.c')
            if not os.path.exists(p) or open(p).read() != src:
                open(p, 'w').write(src)
            n += 1
    os.makedirs(OUT, exist_ok=True)
    open(stamp, 'w').write(sig + '\n')
    print('[rom_parts] %d pieces made from the game\'s data (%s)' % (n, os.path.relpath(OUT, V.ROOT)))


if __name__ == '__main__':
    main()
