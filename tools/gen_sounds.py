#!/usr/bin/env python3
"""The game's sound effects for the sound library: web/data/sounds.json (name, group, bits)."""
import json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GROUPS = {'MARIO': 'Mario', 'PEACH': 'Peach', 'GENERAL': 'General', 'GENERAL2': 'General', 'ACTION': 'Mario moves',
          'MOVING': 'Mario moves', 'ENV': 'Environment', 'OBJ': 'Objects', 'OBJ2': 'Objects', 'AIR': 'Air', 'MENU': 'Menu'}
SKIP = ('SOUND_ARG', 'SOUND_STATUS', 'SOUND_BANK', 'SOUND_TERRAIN', 'SOUND_NO_', 'SOUND_LOWER', 'SOUND_DISCRETE', 'SOUND_CONSTANT',
        'SOUND_VIBRATO', 'SOUND_NO_VOLUME', 'SOUND_PL', 'SOUND_SPEED')


# Every sound of Mario, grouped (the sound studio lists them under "Mario"). A clip the game plays
# under several ids (the jump voice is one of three random ids, "Yahoo!" five, a footstep one per
# kind of ground) is listed once per clip: replacing it replaces every id that plays it (the engine
# finds the ids that play the same sound script: audio.c studio_sfx_canon). Entries: (sub-group,
# name, define, id offset, note).
TERRAINS = ['Default', 'Grass', 'Shallow water', 'Stone', 'Wooden floor', 'Snow', 'Ice', 'Sand']
MARIO_MENU = ('SOUND_MENU_COIN_ITS_A_ME_MARIO', 'SOUND_MENU_STAR_SOUND_OKEY_DOKEY', 'SOUND_MENU_STAR_SOUND_LETS_A_GO',
              'SOUND_MENU_THANK_YOU_PLAYING_MY_GAME')
MARIO = [
    ('Voice: jumps', 'Jump "Yah!"', 'SOUND_MARIO_YAH_WAH_HOO', 0, 'one of three jump voices, picked at random'),
    ('Voice: jumps', 'Jump "Wah!"', 'SOUND_MARIO_YAH_WAH_HOO', 1, 'one of three jump voices, picked at random'),
    ('Voice: jumps', 'Jump "Hoo!"', 'SOUND_MARIO_YAH_WAH_HOO', 2, 'one of three jump voices, picked at random'),
    ('Voice: jumps', 'Double jump "Hoohoo!"', 'SOUND_MARIO_HOOHOO', 0, ''),
    ('Voice: jumps', '"Yahoo!"', 'SOUND_MARIO_YAHOO', 0, 'the big jumps, and three of the triple jump\'s five'),
    ('Voice: jumps', 'Triple jump "Waha!"', 'SOUND_MARIO_YAHOO_WAHA_YIPPEE', 3, 'one of the triple jump voices'),
    ('Voice: jumps', 'Triple jump "Yippee!"', 'SOUND_MARIO_YAHOO_WAHA_YIPPEE', 4, 'one of the triple jump voices'),
    ('Voice: jumps', 'Twirl bounce', 'SOUND_MARIO_TWIRL_BOUNCE', 0, 'bounced into a twirl'),
    ('Voice: jumps', '"Waaaooow!"', 'SOUND_MARIO_WAAAOOOW', 0, 'falling far, thrown, blown away'),
    ('Voice: punches & lifts', 'Punch "Yah!"', 'SOUND_MARIO_PUNCH_YAH', 0, 'first punch'),
    ('Voice: punches & lifts', 'Punch "Wah!"', 'SOUND_MARIO_PUNCH_WAH', 0, 'second punch'),
    ('Voice: punches & lifts', 'Kick "Hoo!"', 'SOUND_MARIO_PUNCH_HOO', 0, 'the kick, the dive'),
    ('Voice: punches & lifts', 'Ground pound "Wah!"', 'SOUND_MARIO_GROUND_POUND_WAH', 0, ''),
    ('Voice: punches & lifts', '"Wah!" (grab, throw)', 'SOUND_MARIO_WAH2', 0, ''),
    ('Voice: punches & lifts', '"Hrmm" (lifting)', 'SOUND_MARIO_HRMM', 0, ''),
    ('Voice: punches & lifts', '"Uh"', 'SOUND_MARIO_UH', 0, ''),
    ('Voice: punches & lifts', '"Whoa!"', 'SOUND_MARIO_WHOA', 0, ''),
    ('Voice: hurt', 'Attacked', 'SOUND_MARIO_ATTACKED', 0, 'hurt by an enemy'),
    ('Voice: hurt', '"Ooof!"', 'SOUND_MARIO_OOOF', 0, ''),
    ('Voice: hurt', '"Eeuh"', 'SOUND_MARIO_EEUH', 0, ''),
    ('Voice: hurt', '"Uh" 2', 'SOUND_MARIO_UH2', 0, ''),
    ('Voice: hurt', 'On fire', 'SOUND_MARIO_ON_FIRE', 0, 'burnt by lava or fire'),
    ('Voice: hurt', 'Dying', 'SOUND_MARIO_DYING', 0, ''),
    ('Voice: hurt', 'Drowning', 'SOUND_MARIO_DROWNING', 0, ''),
    ('Voice: hurt', '"Mamma mia!"', 'SOUND_MARIO_MAMA_MIA', 0, ''),
    ('Voice: hurt', '"Doh!"', 'SOUND_MARIO_DOH', 0, ''),
    ('Voice: tired & sleepy', 'Yawning', 'SOUND_MARIO_YAWNING', 0, ''),
    ('Voice: tired & sleepy', 'Snoring (in)', 'SOUND_MARIO_SNORING1', 0, ''),
    ('Voice: tired & sleepy', 'Snoring (out)', 'SOUND_MARIO_SNORING2', 0, ''),
    ('Voice: tired & sleepy', 'Dreaming', 'SOUND_MARIO_SNORING3', 0, 'asleep for a while'),
    ('Voice: tired & sleepy', 'Panting 1', 'SOUND_MARIO_PANTING', 0, 'low health, one of three'),
    ('Voice: tired & sleepy', 'Panting 2', 'SOUND_MARIO_PANTING', 1, 'low health, one of three'),
    ('Voice: tired & sleepy', 'Panting 3', 'SOUND_MARIO_PANTING', 2, 'low health, one of three'),
    ('Voice: tired & sleepy', 'Panting in the cold', 'SOUND_MARIO_PANTING_COLD', 0, ''),
    ('Voice: tired & sleepy', 'Coughing 1', 'SOUND_MARIO_COUGHING1', 0, 'after a burn'),
    ('Voice: tired & sleepy', 'Coughing 2', 'SOUND_MARIO_COUGHING2', 0, 'after a burn'),
    ('Voice: tired & sleepy', 'Coughing 3', 'SOUND_MARIO_COUGHING3', 0, 'after a burn'),
    ('Voice: tired & sleepy', '"I\'m-a tired"', 'SOUND_MARIO_IMA_TIRED', 0, ''),
    ('Voice: lines', '"Here we go!"', 'SOUND_MARIO_HERE_WE_GO', 0, ''),
    ('Voice: lines', '"Haha!"', 'SOUND_MARIO_HAHA', 0, ''),
    ('Voice: lines', '"So long-a Bowser!"', 'SOUND_MARIO_SO_LONGA_BOWSER', 0, 'throwing Bowser'),
    ('Voice: lines', '"Hello!"', 'SOUND_MARIO_HELLO', 0, 'the title screen'),
    ('Voice: lines', '"Game over"', 'SOUND_MARIO_GAME_OVER', 0, ''),
    ('Voice: lines', '"It\'s-a me, Mario!"', 'SOUND_MENU_COIN_ITS_A_ME_MARIO', 0, 'the title screen'),
    ('Voice: lines', '"Okey-dokey!"', 'SOUND_MENU_STAR_SOUND_OKEY_DOKEY', 0, 'a save file picked'),
    ('Voice: lines', '"Let\'s-a go!"', 'SOUND_MENU_STAR_SOUND_LETS_A_GO', 0, 'a star picked'),
    ('Voice: lines', '"Thank you so much..."', 'SOUND_MENU_THANK_YOU_PLAYING_MY_GAME', 0, 'the ending'),
    ('Voice: never played', '"Okey-dokey!" (Mario\'s own)', 'SOUND_MARIO_YAH_WAH_HOO', 0x21, 'in Mario\'s voice list, unused by the game'),
    ('Voice: never played', '"Press start to play!"', 'SOUND_MARIO_PRESS_START_TO_PLAY', 0, 'unused by the game'),
]
for i, t in enumerate(TERRAINS):
    MARIO += [
        ('Footsteps', f'Step: {t}', 'SOUND_ACTION_TERRAIN_STEP', i, ''),
        ('Footsteps', f'Tiptoe step: {t}', 'SOUND_ACTION_TERRAIN_STEP_TIPTOE', i, ''),
        ('Jumps & landings', f'Jump: {t}', 'SOUND_ACTION_TERRAIN_JUMP', i, ''),
        ('Jumps & landings', f'Landing: {t}', 'SOUND_ACTION_TERRAIN_LANDING', i, ''),
        ('Jumps & landings', f'Heavy landing: {t}', 'SOUND_ACTION_TERRAIN_HEAVY_LANDING', i, ''),
        ('Jumps & landings', f'Body hits the ground: {t}', 'SOUND_ACTION_TERRAIN_BODY_HIT_GROUND', i, 'dive, knocked down'),
        ('Slides', f'Sliding: {t}', 'SOUND_MOVING_TERRAIN_SLIDE', i, ''),
        ('Slides', f'Riding a shell: {t}', 'SOUND_MOVING_TERRAIN_RIDING_SHELL', i, ''),
    ]
for i, t in [(0, 'Default'), (5, 'Snow'), (6, 'Sand')]:
    MARIO.append(('Jumps & landings', f'Stuck in the ground: {t}', 'SOUND_ACTION_TERRAIN_STUCK_IN_GROUND', i, 'a ground pound or a fall into soft ground'))
MARIO += [
    ('Moves', 'Spin / twirl', 'SOUND_ACTION_SPIN', 0, ''),
    ('Moves', 'Side flip whoosh', 'SOUND_ACTION_SIDE_FLIP_UNK', 0, ''),
    ('Moves', 'Throw', 'SOUND_ACTION_THROW', 0, ''),
    ('Moves', 'Bonk', 'SOUND_ACTION_BONK', 0, 'running into a wall'),
    ('Moves', 'Hit', 'SOUND_ACTION_HIT', 0, ''),
    ('Moves', 'Bounce off an enemy', 'SOUND_ACTION_BOUNCE_OFF_OBJECT', 0, ''),
    ('Moves', 'Unstuck from the ground', 'SOUND_ACTION_UNSTUCK_FROM_GROUND', 0, ''),
    ('Moves', 'Hanging step', 'SOUND_ACTION_HANGING_STEP', 0, 'hanging from a ceiling'),
    ('Moves', 'Quicksand step', 'SOUND_ACTION_QUICKSAND_STEP', 0, ''),
    ('Moves', 'Climb up a tree', 'SOUND_ACTION_CLIMB_UP_TREE', 0, ''),
    ('Moves', 'Climb up a pole', 'SOUND_ACTION_CLIMB_UP_POLE', 0, ''),
    ('Moves', 'Slide down a pole', 'SOUND_MOVING_SLIDE_DOWN_POLE', 0, ''),
    ('Moves', 'Slide down a tree', 'SOUND_MOVING_SLIDE_DOWN_TREE', 0, ''),
    ('Moves', 'Flying', 'SOUND_MOVING_FLYING', 0, 'wing cap, cannon flight'),
    ('Moves', 'Flying fast', 'SOUND_ACTION_FLYING_FAST', 0, ''),
    ('Moves', 'Aim the cannon', 'SOUND_MOVING_AIM_CANNON', 0, ''),
    ('Moves', 'Read a sign', 'SOUND_ACTION_READ_SIGN', 0, ''),
    ('Moves', 'Teleport', 'SOUND_ACTION_TELEPORT', 0, ''),
    ('Moves', 'Burnt by lava', 'SOUND_MOVING_LAVA_BURN', 0, ''),
    ('Moves', 'Riding a shell on lava', 'SOUND_MOVING_RIDING_SHELL_LAVA', 0, ''),
    ('Moves', 'Shocked', 'SOUND_MOVING_SHOCKED', 0, ''),
    ('Moves', 'Sinking in quicksand', 'SOUND_MOVING_QUICKSAND_DEATH', 0, ''),
    ('Moves', 'Clap hands in the cold', 'SOUND_ACTION_CLAP_HANDS_COLD', 0, ''),
    ('Moves', 'Brush hair', 'SOUND_ACTION_BRUSH_HAIR', 0, ''),
    ('Moves', 'Pat on the back', 'SOUND_ACTION_PAT_BACK', 0, ''),
    ('Moves', 'Take the cap off', 'SOUND_ACTION_UNKNOWN43D', 0, ''),
    ('Moves', 'Put the cap on', 'SOUND_ACTION_UNKNOWN43E', 0, ''),
    ('Moves', 'Key swish', 'SOUND_ACTION_KEY_SWISH', 0, 'Bowser\'s key dance'),
    ('Moves', 'Key dance end', 'SOUND_ACTION_UNKNOWN45C', 0, 'Bowser\'s key dance'),
    ('Moves', 'Shrink into a picture', 'SOUND_ACTION_SHRINK_INTO_BBH', 0, ''),
    ('Moves', 'Intro sound 1', 'SOUND_ACTION_INTRO_UNK45E', 0, ''),
    ('Moves', 'Intro sound 2', 'SOUND_ACTION_INTRO_UNK45F', 0, ''),
    ('Water', 'Swim', 'SOUND_ACTION_SWIM', 0, ''),
    ('Water', 'Swim fast', 'SOUND_ACTION_SWIM_FAST', 0, ''),
    ('Water', 'Paddle at the surface', 'SOUND_ACTION_UNKNOWN434', 0, ''),
    ('Water', 'Splash into water', 'SOUND_ACTION_UNKNOWN430', 0, 'a fall into deep water'),
    ('Water', 'Reach the surface', 'SOUND_ACTION_UNKNOWN431', 0, ''),
    ('Water', 'Jump out of the water', 'SOUND_ACTION_UNKNOWN432', 0, ''),
    ('Water', 'Almost drowning', 'SOUND_MOVING_ALMOST_DROWNING', 0, ''),
    ('Metal Mario', 'Metal step', 'SOUND_ACTION_METAL_STEP', 0, ''),
    ('Metal Mario', 'Metal tiptoe step', 'SOUND_ACTION_METAL_STEP_TIPTOE', 0, ''),
    ('Metal Mario', 'Metal jump', 'SOUND_ACTION_METAL_JUMP', 0, ''),
    ('Metal Mario', 'Metal landing', 'SOUND_ACTION_METAL_LANDING', 0, ''),
    ('Metal Mario', 'Metal heavy landing', 'SOUND_ACTION_METAL_HEAVY_LANDING', 0, ''),
    ('Metal Mario', 'Metal bonk', 'SOUND_ACTION_METAL_BONK', 0, ''),
    ('Metal Mario', 'Metal step in water', 'SOUND_ACTION_METAL_STEP_WATER', 0, ''),
    ('Metal Mario', 'Metal jump in water', 'SOUND_ACTION_METAL_JUMP_WATER', 0, ''),
    ('Metal Mario', 'Metal landing in water', 'SOUND_ACTION_METAL_LAND_WATER', 0, ''),
    ('Metal Mario', 'Bullet off metal Mario', 'SOUND_ACTION_UNKNOWN458', 0, 'a Snufit\'s shot'),
]


def define_bits(text, name):
    m = re.search(r'#define ' + name + r'\s+SOUND_ARG_LOAD\(([^)]*)\)', text)
    bank, flags, sid, prio, flags2 = (int(a.strip(), 0) for a in m.group(1).split(','))
    return (bank << 28) | (flags << 24) | (sid << 16) | (prio << 8) | (flags2 << 4) | 1


def mario_sounds(defs, text):
    out = []
    for n, (sub, name, define, offset, note) in enumerate(MARIO):
        bits = (defs.get(define) or define_bits(text, define)) + (offset << 16)
        e = {'id': define if offset == 0 else f'{define}+{offset}', 'group': 'Mario', 'sub': sub, 'name': name, 'bits': bits, 'order': n}
        if note:
            e['note'] = note
        out.append(e)
    return out


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
    defs = {o['id']: o['bits'] for o in out}
    mario = mario_sounds(defs, text)
    listed = {m['id'] for m in mario}
    # the game's other names of Mario's sounds stay findable by name (custom objects keep them), unlisted
    old = [dict(o, group='Mario', hidden=True, order=9999) for o in out if o['group'] in ('Mario', 'Mario moves') and o['id'] not in listed]
    out = [o for o in out if o['group'] not in ('Mario', 'Mario moves') and o['id'] not in MARIO_MENU] + mario + old
    order = ['General', 'Mario', 'Objects', 'Environment', 'Menu', 'Air', 'Peach', 'Other']
    out.sort(key=lambda s: (order.index(s['group']) if s['group'] in order else 99, s.get('order', 0), '' if 'order' in s else s['name']))
    dest = os.path.join(ROOT, 'web', 'data', 'sounds.json')
    json.dump(out, open(dest, 'w'), separators=(',', ':'))
    print(len(out), 'sounds ->', dest)


if __name__ == '__main__':
    main()
