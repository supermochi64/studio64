#!/usr/bin/env python3
"""How the game's own songs use each instrument: a static walk over every vanilla .m64.

Command lengths come from include/seq_macros.inc. For each (bank, program) the walk
collects the notes it plays (pitch range, note lengths, how many songs/channels), which
analyze_instruments.py turns into labels like "Bass line" or "Melody".
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ENGINE = os.path.join(ROOT, 'engine')


def parse_macros():
    """{section: [(base, span, argspec)]}: argspec items are 'b' (byte), 'v' (var), 'w' (2 bytes)."""
    text = open(os.path.join(ENGINE, 'include', 'seq_macros.inc')).read()
    sections, cur = {}, None
    for block in re.split(r'\n(?=# |\.macro )', text):
        if block.startswith('# '):
            cur = block.split()[1]
            continue
        m = re.match(r'\.macro (\S+)(.*?)\n(.*?)\.endm', block, re.S)
        if not m or cur not in ('seq', 'chan', 'layer'):
            continue
        name, body = m.group(1), [l.strip() for l in m.group(3).strip().split('\n')]
        first = body[0]
        fm = re.match(r'\.byte (0x[0-9a-f]+)( \+ \\a)?(.*)$', first)
        if not fm:
            continue
        base, ranged = int(fm.group(1), 16), bool(fm.group(2))
        spec = []
        extra = fm.group(3).strip(', ')
        if extra:
            spec += ['b'] * (extra.count(',') + 1)
        for l in body[1:]:
            if l.startswith('var_long'):
                spec.append('w')
            elif l.startswith('var'):
                spec.append('v')
            elif l.startswith('sound_ref'):
                spec.append('w')
            elif l.startswith('.byte'):
                # "(x) >> 8, (x) & 0xff" is one 16-bit value (an address or a mask)
                if '>> 8' in l and '& 0xff' in l and l.count(',') == 1:
                    spec.append('w')
                else:
                    spec += ['b'] * (l.count(',') + 1)
        sections.setdefault(cur, []).append((base, ranged, spec, name))
    # a ranged command covers opcodes up to the next base
    tables = {}
    for sec, cmds in sections.items():
        table = {}
        bases = sorted({c[0] for c in cmds})
        for base, ranged, spec, name in cmds:
            if '_long' in name:
                continue
            end = base + 1
            if ranged:
                nxt = [b for b in bases if b > base]
                end = nxt[0] if nxt else 0x100
            for op in range(base, end):
                table.setdefault(op, (spec, name, base))
        tables[sec] = table
    return tables


def read_var(d, p):
    b = d[p]
    if b & 0x80:
        return ((b & 0x7f) << 8) | d[p + 1], p + 2
    return b, p + 1


def walk(data, tables, banks, song, usage):
    seen = set()
    todo = [('seq', 0, None)]
    while todo:
        kind, pc, ctx = todo.pop()
        key = (kind, pc, ctx and (ctx['instr'], ctx['bank'], ctx['large']))
        if key in seen or pc >= len(data):
            continue
        seen.add(key)
        ctx = dict(ctx) if ctx else {'instr': 0, 'bank': 0, 'large': False, 'transpose': 0}
        try:
            walk_one(data, tables, banks, song, usage, todo, kind, pc, ctx)
        except IndexError:
            pass  # ran off the data: a table rather than code


def walk_one(data, tables, banks, song, usage, todo, kind, pc, ctx):
    """One script, followed like the player runs it: calls return, jumps continue,
    each address once; branches are explored separately."""
    stack, visited, pending = [], set(), []

    def flush():
        for addr in pending:
            todo.append(('layer', addr, {**ctx, 'transpose': 0}))
        pending.clear()

    while pc < len(data):
        if (pc, len(stack)) in visited:
            return
        visited.add((pc, len(stack)))
        op = data[pc]
        if kind == 'layer' and op < 0xc0:
            pitch = (op & 0x3f) + ctx['transpose']
            p = pc + 1
            t = op & 0xc0
            dur = 0
            if ctx['large']:
                if t == 0x00:
                    dur, p = read_var(data, p); p += 2
                elif t == 0x40:
                    dur, p = read_var(data, p); p += 1
                else:
                    p += 2
            elif t == 0x00:
                dur, p = read_var(data, p)
            bank = banks[min(ctx['bank'], len(banks) - 1)] if banks else None
            u = usage.setdefault(f"{bank}:{ctx['instr']}", {'notes': 0, 'pitches': [], 'songs': set(), 'durs': []})
            u['notes'] += 1
            u['pitches'].append(pitch)
            u['songs'].add(song)
            if dur:
                u['durs'].append(dur)
            pc = p
            continue
        entry = tables[kind].get(op)
        if not entry:
            flush()
            return
        spec, name, base = entry
        p = pc + 1
        args = []
        for s_ in spec:
            if s_ == 'b':
                args.append(data[p]); p += 1
            elif s_ == 'w':
                args.append((data[p] << 8) | data[p + 1]); p += 2
            else:
                v, p = read_var(data, p); args.append(v)
        if name == 'seq_startchannel':
            todo.append(('chan', args[0], None))
        elif name == 'chan_setlayer':
            # the layer plays with the instrument the channel has when it next waits
            pending.append(args[0])
        elif name in ('chan_setinstr', 'layer_setinstr'):
            ctx['instr'] = args[0]
        elif name == 'chan_setbank':
            ctx['bank'] = args[0]
        elif name == 'chan_largenoteson':
            ctx['large'] = True
        elif name == 'chan_largenotesoff':
            ctx['large'] = False
        elif name == 'layer_transpose':
            ctx['transpose'] = args[0] - 256 if args[0] > 127 else args[0]
        if name.endswith(('_delay', '_delay1')) or name.endswith(('_end', '_hang', '_break')) and not stack:
            flush()
        if name.endswith('_call'):
            stack.append(p)
            pc = args[-1]
            continue
        if name.endswith('_jump'):
            pc = args[-1]
            continue
        if name.endswith(('_beqz', '_bltz', '_bgez')):
            todo.append((kind, args[-1], dict(ctx) if kind != 'seq' else None))
        if name.endswith(('_end', '_hang', '_break')):
            if name.endswith('_end') and stack:
                pc = stack.pop()
                continue
            return
        pc = p


def main():
    tables = parse_macros()
    seqs = json.load(open(os.path.join(ENGINE, 'sound', 'sequences.json')))
    usage = {}
    for name, banks in seqs.items():
        if name == 'comment' or name.startswith('00_'):
            continue
        banks = banks['banks'] if isinstance(banks, dict) else banks
        # bank indices in chan_setbank count from the end of the list (the first is the default)
        ids = [int(b[:2], 16) for b in banks]
        path = os.path.join(ENGINE, 'sound', 'sequences', 'us', f'{name}.m64')
        if not os.path.exists(path):
            continue
        walk(open(path, 'rb').read(), tables, ids, name, usage)
    out = {}
    for k, u in usage.items():
        ps = sorted(u['pitches'])
        out[k] = {'notes': u['notes'], 'songs': sorted(u['songs']), 'low': ps[len(ps) // 10], 'high': ps[len(ps) * 9 // 10],
                  'median': ps[len(ps) // 2], 'dur': sorted(u['durs'])[len(u['durs']) // 2] if u['durs'] else 0}
    json.dump(out, open(os.path.join(ROOT, 'tools', 'seq_usage.json'), 'w'), indent=1)
    print(len(out), 'instruments seen')


if __name__ == '__main__':
    main()
