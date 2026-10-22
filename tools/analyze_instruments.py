#!/usr/bin/env python3
"""Describe the game's instrument banks for the sound composer: web/data/instruments.json.

Each music bank becomes a "sound set" named after the songs that use it, with its programs
(instrument_list slots) and drum kit. The samples have no names, so every instrument gets a
label from analysing its sample: register, whether it sustains or decays, how noisy it is.
"""
import glob, json, os, struct, sys
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SOUND = os.path.join(ROOT, 'engine', 'sound')

SONG_NAMES = {
    '01_cutscene_collect_star': 'Star collect', '02_menu_title_screen': 'Title screen', '03_level_grass': 'Bob-omb Battlefield',
    '04_level_inside_castle': 'Inside the castle', '05_level_water': 'Dire, Dire Docks', '06_level_hot': 'Lethal Lava Land',
    '07_level_boss_koopa': 'Bowser battle', '08_level_snow': 'Cool, Cool Mountain', '09_level_slide': 'Slider',
    '0A_level_spooky': "Big Boo's Haunt", '0B_event_piranha_plant': 'Piranha lullaby', '0C_level_underground': 'Hazy Maze Cave',
    '0D_menu_star_select': 'Star select', '0E_event_powerup': 'Wing cap', '0F_event_metal_cap': 'Metal cap',
    '10_event_koopa_message': 'Bowser message', '11_level_koopa_road': 'Bowser road', '12_event_high_score': 'High score',
    '13_event_merry_go_round': 'Merry-go-round', '14_event_race': 'Race fanfare', '15_cutscene_star_spawn': 'Star appears',
    '16_event_boss': 'Boss', '17_cutscene_collect_key': 'Key collect', '18_event_endless_stairs': 'Endless stairs',
    '19_level_boss_koopa_final': 'Final Bowser', '1A_cutscene_credits': 'Credits', '1B_event_solve_puzzle': 'Puzzle solved',
    '1C_event_toad_message': 'Toad message', '1D_event_peach_message': 'Peach message', '1E_cutscene_intro': 'Intro',
    '1F_cutscene_victory': 'Victory', '20_cutscene_ending': 'Ending', '21_menu_file_select': 'File select', '22_cutscene_lakitu': 'Lakitu',
}


def read_aiff(path):
    d = open(path, 'rb').read()
    i, info = 12, {'loop': None}
    marks = {}
    while i < len(d) - 8:
        cid = d[i:i + 4]
        size = struct.unpack('>I', d[i + 4:i + 8])[0]
        body = d[i + 8:i + 8 + size]
        if cid == b'COMM':
            info['frames'] = struct.unpack('>I', body[2:6])[0]
            exp = struct.unpack('>H', body[8:10])[0]
            mant = struct.unpack('>Q', body[10:18])[0]
            info['rate'] = mant * 2.0 ** (exp - 16383 - 63)
        elif cid == b'SSND':
            off = struct.unpack('>I', body[:4])[0]
            info['pcm'] = np.frombuffer(body[8 + off:], dtype='>i2').astype(np.float32) / 32768
        elif cid == b'MARK':
            n = struct.unpack('>H', body[:2])[0]
            p = 2
            for _ in range(n):
                mid, pos = struct.unpack('>HI', body[p:p + 6])
                ln = body[p + 6]
                marks[mid] = pos
                p += 6 + 1 + ln + ((1 + ln) % 2 == 1)
        elif cid == b'INST':
            mode, begin, end = struct.unpack('>hhh', body[8:14])
            if mode != 0:
                info['loop'] = (begin, end)
        i += 8 + size + (size & 1)
    if info['loop'] and marks:
        b, e = info['loop']
        info['loop'] = (marks.get(b, 0), marks.get(e, 0)) if e in marks else None
    return info


def features(path, tuning=None):
    a = read_aiff(path)
    pcm = a['pcm']
    rate = a['rate'] if tuning is None else 32000 * tuning
    n = len(pcm)
    looped = a['loop'] is not None and a['loop'][1] - a['loop'][0] > 32
    win = max(64, n // 40)
    env = np.array([np.sqrt(np.mean(pcm[k:k + win] ** 2) + 1e-12) for k in range(0, n - win + 1, win)]) if n > win else np.array([1.0])
    peak = env.max()
    attack = int(np.argmax(env)) / max(1, len(env))
    tail = env[int(len(env) * 0.7):].mean() / peak if len(env) > 3 else 1
    seg = pcm[: min(n, 8192)]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) + 1e-9
    freqs = np.fft.rfftfreq(len(seg), 1 / rate)
    centroid = float((spec * freqs).sum() / spec.sum())
    flat = float(np.exp(np.mean(np.log(spec))) / np.mean(spec))
    # fundamental: autocorrelation over a steady part
    mid = pcm[n // 8: n // 8 + 4096] if n > 5000 else pcm
    f0 = 0
    if len(mid) > 256:
        ac = np.correlate(mid, mid, 'full')[len(mid) - 1:]
        lo, hi = int(rate / 2000), int(rate / 30)
        if hi < len(ac) and hi > lo:
            k = lo + int(np.argmax(ac[lo:hi]))
            if ac[k] > 0.3 * ac[0]:
                f0 = rate / k
    return {'seconds': round(n / rate, 2), 'looped': looped, 'attack': round(attack, 2), 'tail': round(float(tail), 3),
            'centroid': round(centroid), 'noise': round(flat, 3), 'f0': round(f0, 1)}


def sample_path(bank_json, name):
    return os.path.join(SOUND, 'samples', bank_json['sample_bank'], f'{name}.aiff')


def sound_of(s):
    return (s, None) if isinstance(s, str) else (s['sample'], s.get('tuning'))


def role_label(f, use):
    """From how the game's own songs play it, plus how the sample sounds."""
    sustained = f['looped'] or f['tail'] > 0.35
    feel = 'sustained' if sustained else ('swell' if f['attack'] > 0.3 else 'plucked')
    if use and use['notes'] >= 8:
        if use['high'] - use['low'] <= 2 and use['dur'] <= 30:
            return 'Percussive hit'
        med = use['median']
        if med < 25:
            role = 'Bass'
        elif med >= 42:
            role = 'Melody'
        else:
            role = 'Chords'
        return f'{role} ({feel})'
    return instrument_label(f)


def instrument_label(f, lo=None, hi=None):
    sustained = f['looped'] or f['tail'] > 0.35
    if f['noise'] > 0.25:
        return 'Noise / effect'
    if f['f0'] and f['f0'] < 140:
        reg = 'Bass'
    elif f['centroid'] > 2600:
        reg = 'Bright lead'
    elif f['centroid'] < 900:
        reg = 'Soft'
    else:
        reg = 'Lead'
    if reg == 'Bass':
        return 'Bass (sustained)' if sustained else 'Bass (plucked)'
    if reg == 'Soft':
        return 'Soft pad' if sustained else 'Soft pluck'
    if sustained:
        return f'{reg} (sustained)' if f['attack'] < 0.15 else f'{reg} (swell)'
    return 'Bell / mallet' if f['tail'] < 0.08 and f['centroid'] > 1500 else f'{reg} (plucked)'


def drum_label(f, used):
    if f['noise'] > 0.3:
        name = 'Cymbal' if f['seconds'] > 0.6 else ('Hi-hat' if f['centroid'] > 4000 else 'Snare')
    elif f['centroid'] < 700 and (f['f0'] == 0 or f['f0'] < 120):
        name = 'Kick'
    elif f['f0'] and f['f0'] < 400:
        name = 'Tom'
    elif f['centroid'] > 3500:
        name = 'Click'
    else:
        name = 'Percussion'
    used[name] = used.get(name, 0) + 1
    return name if used[name] == 1 else f'{name} {used[name]}'


def main():
    usage_path = os.path.join(ROOT, 'tools', 'seq_usage.json')
    usage = json.load(open(usage_path)) if os.path.exists(usage_path) else {}
    seqs = json.load(open(os.path.join(SOUND, 'sequences.json')))
    users = {}
    for seq, banks in seqs.items():
        if seq == 'comment':
            continue
        banks = banks['banks'] if isinstance(banks, dict) else banks
        for b in banks:
            users.setdefault(b, []).append(seq)
    out = []
    for path in sorted(glob.glob(os.path.join(SOUND, 'sound_banks', '*.json'))):
        key = os.path.basename(path)[:-5]
        bank_id = int(key[:2], 16)
        bj = json.load(open(path))
        if bj['sample_bank'].startswith('sfx') or key not in users:
            continue
        songs = [SONG_NAMES.get(s, s) for s in users[key]]
        programs = []
        for prog, name in enumerate(bj.get('instrument_list', [])):
            if not name:
                continue
            inst = bj['instruments'][name]
            sample, tuning = sound_of(inst['sound'])
            f = features(sample_path(bj, sample), tuning)
            use = usage.get(f'{bank_id}:{prog}')
            used_in = [SONG_NAMES.get(x, x) for x in (use or {}).get('songs', [])]
            programs.append({'program': prog, 'sample': sample, 'label': role_label(f, use), 'features': f,
                             'usedIn': used_in[:2], 'notes': [use['low'], use['high']] if use else None,
                             'range': [inst.get('normal_range_lo', 0), inst.get('normal_range_hi', 127)]})
        drums, used = [], {}
        for idx, d in enumerate(bj['instruments'].get('percussion', [])):
            if d is None:
                drums.append(None)
                continue
            sample, tuning = sound_of(d['sound'])
            f = features(sample_path(bj, sample), tuning)
            drums.append({'note': idx, 'sample': sample, 'label': drum_label(f, used), 'features': f})
        out.append({'bank': bank_id, 'key': key, 'name': ' / '.join(songs[:2]), 'songs': songs, 'programs': programs,
                    'drums': drums})
    # the page only needs names and how a sound behaves
    for b in out:
        for p in b['programs']:
            f = p.pop('features')
            p['sustained'] = f['looped'] or f['tail'] > 0.35
        b['drums'] = [{'note': d['note'], 'label': d['label']} for d in b['drums'] if d]
    dest = os.path.join(ROOT, 'web', 'data', 'instruments.json')
    json.dump({'banks': out}, open(dest, 'w'), separators=(',', ':'))
    print(f'{len(out)} sound sets -> {dest}')


if __name__ == '__main__':
    main()
