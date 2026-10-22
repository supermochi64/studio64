#!/usr/bin/env python3
"""Studio 64: the game's own texts and dialog font for the Story panel.

Reads the decomp sources in engine/ (US version) and writes
  web/data/story_texts.json   every dialog (with its box settings), course names, act names,
                              the credits, Peach's ending lines, the charmap and glyph widths
  web/data/story_font.png     the dialog font as a 16x16 grid of 8x16 glyphs (white + alpha)

Run with python3 tools/gen_story_data.py (the standard library only: tools/pngio.py reads and
writes the PNGs).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pngio import read_la, write_rgba  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENG = os.path.join(ROOT, 'engine')
OUT = os.path.join(ROOT, 'web', 'data')


def read(p):
    with open(os.path.join(ENG, p), encoding='utf-8') as f:
        return f.read()


def _cond(kind, cond):
    """Whether a preprocessor condition holds for the US build (only VERSION_* tests matter)."""
    cond = cond.split('//')[0].strip()
    if kind in ('ifdef', 'ifndef'):
        v = cond == 'VERSION_US' or not cond.startswith('VERSION_')
        if cond.startswith('VERSION_'):
            v = cond == 'VERSION_US'
        else:
            v = False  # other feature macros: assume not defined
        return v if kind == 'ifdef' else not v
    e = re.sub(r'defined\s*\(\s*(\w+)\s*\)', lambda m: '1' if m.group(1) == 'VERSION_US' else '0', cond)
    e = re.sub(r'\bVERSION_US\b', '1', e)
    e = re.sub(r'\b[A-Z_][A-Z0-9_]*\b', '0', e)
    e = e.replace('&&', ' and ').replace('||', ' or ').replace('!', ' not ')
    try:
        return bool(eval(e, {}, {}))
    except Exception:
        return True


def us_only(src):
    """Keep only the US branches of #if blocks."""
    out, stack = [], []  # [active, taken]
    for line in src.split('\n'):
        s = line.strip()
        m = re.match(r'#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)', s)
        if m:
            kind, cond = m.group(1), m.group(2)
            if kind in ('ifdef', 'ifndef', 'if'):
                v = _cond(kind, cond)
                stack.append([v, v])
            elif kind == 'elif':
                top = stack[-1]
                top[0] = (not top[1]) and _cond('if', cond)
                top[1] = top[1] or top[0]
            elif kind == 'else':
                top = stack[-1]
                top[0] = not top[1]
                top[1] = True
            elif kind == 'endif':
                stack.pop()
            continue
        if all(k for k, _ in stack):
            out.append(line)
    return '\n'.join(out)


def c_strings(expr, macros):
    """Concatenate the C string literals (and string macros) of an expression."""
    expr = expr.replace('\\\n', '')
    parts = []
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|([A-Z_][A-Z0-9_]+)', expr, re.S):
        if m.group(1) is not None:
            parts.append(bytes(m.group(1), 'utf-8').decode('unicode_escape').encode('latin-1').decode('utf-8'))
        elif m.group(2) in macros:
            parts.append(macros[m.group(2)])
    return ''.join(parts)


def string_macros(src):
    macros = {}
    for m in re.finditer(r'#define\s+([A-Z_][A-Z0-9_]+)\s+((?:"(?:[^"\\]|\\.)*"\s*(?:\\\n\s*)?)+)', src):
        macros[m.group(1)] = c_strings(m.group(2), {})
    return macros


def split_args(s):
    """Top-level comma split of a macro argument list."""
    args, depth, cur, q = [], 0, '', False
    i = 0
    while i < len(s):
        c = s[i]
        if q:
            cur += c
            if c == '\\':
                cur += s[i + 1]
                i += 1
            elif c == '"':
                q = False
        elif c == '"':
            q = True
            cur += c
        elif c == '(':
            depth += 1
            cur += c
        elif c == ')':
            depth -= 1
            cur += c
        elif c == ',' and depth == 0:
            args.append(cur)
            cur = ''
        else:
            cur += c
        i += 1
    args.append(cur)
    return [a.strip() for a in args]


def macro_calls(src, name):
    """Yield the argument lists of every NAME(...) call (balanced parentheses, strings aware)."""
    for m in re.finditer(r'\b' + name + r'\(', src):
        i, depth, q = m.end(), 1, False
        while i < len(src) and depth:
            c = src[i]
            if q:
                if c == '\\':
                    i += 1
                elif c == '"':
                    q = False
            elif c == '"':
                q = True
            elif c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            i += 1
        yield split_args(src[m.end():i - 1])


def main():
    dsrc = us_only(read('text/us/dialogs.h'))
    macros = string_macros(dsrc)
    enum_src = read('include/dialog_ids.h')
    dialogs = []
    for args in macro_calls(dsrc, 'DEFINE_DIALOG'):
        did, unused, lines, left, width, text = args
        idx = len(dialogs)
        dialogs.append({'id': idx, 'name': did, 'lines': int(lines), 'left': int(left), 'width': int(width),
                        'text': c_strings(text, macros)})
    assert len(dialogs) == 170, len(dialogs)

    csrc = us_only(read('text/us/courses.h'))
    courses, acts = [], []
    for args in macro_calls(csrc, 'COURSE_ACTS'):
        cid, name = args[0], c_strings(args[1], {})
        courses.append({'index': len(courses), 'id': cid, 'text': name})
        for k, a in enumerate(args[2:8]):
            acts.append({'index': len(acts), 'course': len(courses), 'act': k + 1, 'text': c_strings(a, {})})
    for args in macro_calls(csrc, 'SECRET_STAR'):
        courses.append({'index': len(courses), 'id': args[0], 'text': c_strings(args[1], {})})
    for args in macro_calls(csrc, 'CASTLE_SECRET_STARS'):
        courses.append({'index': len(courses), 'id': 'CASTLE_SECRET_STARS', 'text': c_strings(args[0], {})})

    # credits: the US arrays, in the order of sCreditsSequence
    lsrc = us_only(read('src/game/level_update.c'))
    arrays = {m.group(1): [c_strings('"' + s + '"', {}) for s in re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2))]
              for m in re.finditer(r'const char \*(credits\d+)\[\]\s*=\s*\{(.*?)\};', lsrc, re.S)}
    seq = re.search(r'struct CreditsEntry sCreditsSequence\[\]\s*=\s*\{(.*?)\n\};', lsrc, re.S).group(1)
    credits = []
    for m in re.finditer(r'\{\s*(LEVEL_\w+),\s*(\d+),\s*(-?\d+),\s*(-?\d+),\s*\{[^}]*\},\s*(\w+)\s*\}', seq):
        if m.group(1) == 'LEVEL_NONE':
            continue
        arr = arrays.get(m.group(5))
        entry = {'index': len(credits), 'level': m.group(1), 'top': bool(int(m.group(3)) & 0x20)}
        if arr:
            code = int(arr[0][0])
            title = [arr[0][1:]]
            names = arr[1:]
            if code in (4, 5):
                title.append(names.pop(0))
            entry.update(title=title, names=names)
        else:
            entry.update(title=[], names=[])
        credits.append(entry)

    tsrc = us_only(read('include/text_strings.h.in'))
    tmac = {m.group(1): m.group(2) for m in re.finditer(r'#define\s+(TEXT_\w+)\s+_{1,2}\("((?:[^"\\]|\\.)*)"\)', tsrc)}
    msrc = read('src/game/ingame_menu.c')
    ending = []
    for m in re.finditer(r'u8 gEndCutsceneStrEn(\d)\[\]\s*=\s*\{\s*(TEXT_\w+)\s*\}', msrc):
        ending.append({'index': int(m.group(1)), 'text': tmac.get(m.group(2), '')})

    # charmap (US symbols; the "overwritten" ones replace the kana)
    charmap = {}
    for line in read('charmap.txt').split('\n'):
        m = re.match(r"^'((?:\\'|[^'])+)'\s*=\s*0x([0-9A-Fa-f]{2})\s*$", line.strip())
        if m:
            k = m.group(1).replace("\\'", "'").replace('\\n', '\n')
            charmap[k] = int(m.group(2), 16)
    us = {}
    for k, v in charmap.items():
        if k not in ('『', '』') and re.match(r'[\u3040-\u30ff\uff00-\uffef\u3000-\u303f]', k):
            continue  # Japanese / full width
        if 'à' <= k[:1] <= 'ü' or k in ('À', 'Â', 'Ä', 'È', 'Ê', 'Ë', 'É', 'Ù', 'Û', 'Ü', 'Ô', 'Ö', 'ß', 'Ç', 'ç', '„', 'ô', 'ö', 'î', 'ï'):
            continue  # EU only
        us[k] = v

    wsrc = re.sub(r'//[^\n]*', '', us_only(msrc))
    widths = [int(x) for x in re.search(r'u8 gDialogCharWidths\[256\]\s*=\s*\{(.*?)\};', wsrc, re.S).group(1).split(',') if x.strip()]
    assert len(widths) == 256, len(widths)

    # the dialog font
    ssrc = read('bin/segment2.c')
    files = {m.group(1): m.group(2) for m in re.finditer(r'static const u8 (texture_font_char_us_\w+)\[\]\s*=\s*\{\s*#include "([^"]+)\.inc\.c"', ssrc)}
    lut_src = re.search(r'const u8 \*const main_font_lut\[\]\s*=\s*\{.*?#elif defined\(VERSION_US\)(.*?)#(?:else|elif|endif)', ssrc, re.S).group(1)
    lut = re.findall(r'(texture_font_char_us_\w+|0x0)', lut_src)
    atlas = bytearray(16 * 8 * 16 * 16 * 4)  # 128 x 256 RGBA, transparent
    AW = 16 * 8
    glyphs = []
    for code, name in enumerate(lut[:256]):
        if name == '0x0' or name not in files:
            continue
        w, h, px = read_la(os.path.join(ENG, files[name] + '.png'))  # 16 wide, 8 tall: drawn turned
        ox, oy = (code % 16) * 8, (code // 16) * 16
        for sy in range(16):
            for sx in range(8):
                l, a = px[(7 - sx) * w + (15 - sy)]
                k = ((oy + sy) * AW + ox + sx) * 4
                atlas[k:k + 4] = bytes((255, 255, 255, a if l > 40 else 0))
        glyphs.append(code)
    os.makedirs(OUT, exist_ok=True)
    write_rgba(os.path.join(OUT, 'story_font.png'), AW, 16 * 16, bytes(atlas))

    data = {'dialogs': dialogs, 'courses': courses, 'acts': acts, 'credits': credits, 'ending': ending,
            'charmap': us, 'widths': widths, 'glyphs': glyphs}
    with open(os.path.join(OUT, 'story_texts.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(dialogs)} dialogs, {len(courses)} course names, {len(acts)} act names, {len(credits)} credits pages,'
          f' {len(ending)} ending lines, {len(glyphs)} glyphs')


if __name__ == '__main__':
    sys.exit(main())
