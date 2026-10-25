"""The notes of a Super Mario 64 song (.m64 from the local engine build; nothing of it is kept in the repo):
a timed walk of the sequence player — the sequence starts channels, channels start note layers, each with
its own clock (48 ticks a beat), loops, calls and jumps followed, up to `beats`.
    python seqnotes.py 03_level_grass [beats]   -> prints a channel summary
    notes(name, beats) -> {'tempo': bpm, 'notes': [(beat, channel, midi pitch, beats long, velocity, instrument, layer)]}"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools'))
from seq_usage import parse_macros, read_var, ENGINE

TABLES = parse_macros()
TPB = 48  # ticks a beat


def args_of(data, p, spec):
    out = []
    for s_ in spec:
        if s_ == 'b': out.append(data[p]); p += 1
        elif s_ == 'w': out.append((data[p] << 8) | data[p + 1]); p += 2
        else:
            v, p = read_var(data, p); out.append(v)
    return out, p


def notes(name, beats=96):
    data = open(os.path.join(ENGINE, 'sound', 'sequences', 'us', f'{name}.m64'), 'rb').read()
    limit = beats * TPB
    out, tempo, chstate = [], [120], {}

    def run(kind, pc, t, end, ch=-1, ctx=None):
        """runs one script from tick t until `end`; a script that starts channels or layers returns them as
        [(slot, tick, pc, ctx)]: a new one in the same slot replaces the old (the player frees it)"""
        if kind == 'chan':      # a channel keeps its state (large notes, instrument) when it is started again
            ctx = chstate.setdefault(ch, {'large': False, 'chtr': 0, 'instr': 0})
        else:
            ctx = dict(ctx or {})
        if kind == 'layer':
            ctx = dict(ctx); ctx.update(transpose=0, pp=0, defpp=0, dur=0x80, vel=100)
        started, stack, steps = [], [], 0
        while pc < len(data) and t < end and steps < 200000:
            steps += 1
            op = data[pc]
            if kind == 'layer' and op < 0xc0:
                p, typ = pc + 1, op & 0xc0
                if typ == 0x00:
                    d, p = read_var(data, p); ctx['pp'] = d
                elif typ == 0x40:
                    d = ctx['pp'] if ctx['large'] else ctx['defpp']
                    if ctx['large']:
                        d, p = read_var(data, p); ctx['pp'] = d
                else:
                    d = ctx['pp']
                if ctx['large']:
                    vel = data[p]; p += 1
                    dur = 0 if typ == 0x40 else data[p]
                    if typ != 0x40: p += 1
                else:
                    vel, dur = ctx['vel'], ctx['dur']
                length = d * dur / 256.0 if dur else d * 0.95
                pitch = (op & 0x3f) + ctx['transpose'] + ctx['chtr']
                out.append((t / TPB, ch, pitch + 21, max(length, 1) / TPB, vel, ctx['instr'], ctx.get('slot', 0)))
                t += d
                pc = p
                continue
            if kind == 'layer' and op == 0xc7:      # portamento: mode, note, then a byte or a var
                p = pc + 3
                if data[pc + 1] & 0x80: p += 1
                else: _, p = read_var(data, p)
                pc = p; continue
            if kind == 'layer' and op == 0xcb:      # envelope, release
                pc += 4; continue
            entry = TABLES[kind].get(op)
            if not entry:
                if os.environ.get('SEQDEBUG'): print('unknown', kind, hex(op), 'at', hex(pc), file=sys.stderr)
                break
            spec, nm, base = entry
            a, p = args_of(data, pc + 1, spec)
            sgn = lambda v: v - 256 if v > 127 else v
            if nm == 'seq_settempo': tempo[0] = a[0]
            elif nm == 'seq_startchannel': started.append((op - base, t, a[-1], None))
            elif nm == 'chan_setlayer': started.append((op - base, t, a[-1], dict(ctx)))
            elif nm in ('chan_setinstr', 'layer_setinstr'): ctx['instr'] = a[0]
            elif nm == 'chan_largenoteson': ctx['large'] = True
            elif nm == 'chan_largenotesoff': ctx['large'] = False
            elif nm == 'layer_transpose': ctx['transpose'] = sgn(a[0])
            elif nm == 'chan_transpose': ctx['chtr'] = sgn(a[0])
            elif nm == 'layer_setshortnotedefaultplaypercentage': ctx['defpp'] = a[0]
            elif nm == 'layer_setshortnoteduration': ctx['dur'] = a[0]
            elif nm == 'layer_setshortnotevelocity': ctx['vel'] = a[0]
            if nm.endswith('_delay') or nm.endswith('_delay1'):
                t += a[0] if a else 1
            if nm.endswith('_loop'):
                stack.append(['loop', p, a[0] or 256])
            elif nm.endswith('_loopend'):
                if stack:
                    stack[-1][2] -= 1
                    if stack[-1][2] > 0:
                        pc = stack[-1][1]; continue
                    stack.pop()
            elif nm.endswith('_call'):
                stack.append(['call', p]); pc = a[-1]; continue
            elif nm.endswith('_jump'):
                pc = a[-1]; continue
            elif nm.endswith(('_end', '_hang', '_break')):
                if nm.endswith('_end') and stack:
                    pc = stack.pop()[1]; continue
                break
            pc = p
        stop = min(t if t < end else end, end) if steps else t
        return started, (t if pc >= len(data) or t < end else end)

    def play(kind, starts, end, ch=-1):
        for i, (slot, t0, pc, ctx) in enumerate(starts):
            nxt = [s[1] for s in starts[i + 1:] if s[0] == slot]
            stop = min([end] + nxt)
            if kind == 'chan':
                layers, cend = run('chan', pc, t0, stop, slot, None)
                play('layer', layers, min(stop, cend if cend > t0 else stop), slot)
            else:
                run('layer', pc, t0, stop, ch, dict(ctx, slot=slot))

    chans, _ = run('seq', 0, 0, limit)
    play('chan', chans, limit)
    out.sort()
    return {'tempo': tempo[0], 'notes': out}


if __name__ == '__main__':
    r = notes(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 64)
    print('tempo', r['tempo'], 'notes', len(r['notes']))
    by = {}
    for b, ch, p, l, v, ins, ly in r['notes']:
        by.setdefault(ch, []).append((b, p, l, ins))
    for ch, ns in sorted(by.items()):
        ps = sorted(n[1] for n in ns)
        print(f'ch {ch:2d}: {len(ns):4d} notes, pitch {ps[0]}..{ps[-1]} median {ps[len(ps)//2]}, instr {sorted(set(n[3] for n in ns))}, first {ns[0][0]:.2f}',
              ' '.join(f'{n[1]}@{n[0]:.2f}' for n in ns[:10]))
