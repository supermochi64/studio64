// Claude's tools for the characters ported from Super Mario Sunshine (engine/src/studio/sms,
// docs/sunshine.md): the cast with what each does, and ready-made groups ("a Pianta plaza",
// "a goop patrol", "a Cataquack launcher") placed through the same browser rpc as spawn.

import { NOTES } from '../catalog.js';

const CAST = ['sms:pianta', 'sms:pianta_woman', 'sms:noki', 'sms:noki_woman', 'sms:shine_sprite', 'sms:strollin_stu', 'sms:swoopin_stu', 'sms:electrokoopa', 'sms:pokey', 'sms:cataquack', 'sms:blooper'];

// [id, bparams, count] per group; a count scales with the "size" argument
const GROUPS = {
  plaza: { about: 'Isle Delfino plaza: strolling Piantas of every colour, a woman or two, one dancing', items: [['sms:pianta', 0x00000000, 3], ['sms:pianta', 0x00010000, 1], ['sms:pianta_woman', 0x00020000, 2], ['sms:pianta', 0x00000002, 1]] },
  noki_village: { about: 'Nokis of Noki Bay with shells of every colour, strolling and dancing', items: [['sms:noki', 0x00030000, 2], ['sms:noki_woman', 0x00040000, 2], ['sms:noki', 0x00030002, 1]] },
  dance_party: { about: 'a ring of dancing Piantas', items: [['sms:pianta', 0x00000002, 4], ['sms:pianta_woman', 0x00020002, 2]] },
  goop_patrol: { about: "Strollin' Stus wandering with a few Swoopin' Stus", items: [['sms:strollin_stu', 0, 3], ['sms:swoopin_stu', 0, 2]] },
  goop_ambush: { about: "Swoopin' Stus of mixed colours waiting in a goop puddle", items: [['sms:swoopin_stu', 1, 5]] },
  electro_squad: { about: 'Electrokoopas that throw their shells', items: [['sms:electrokoopa', 0, 2]] },
  pokey_garden: { about: 'Pokeys swaying in a row', items: [['sms:pokey', 0, 3]] },
  launcher: { about: 'one blue Cataquack that tosses Mario high into the air (reach a ledge)', items: [['sms:cataquack', 0, 1]] },
  red_quacks: { about: 'red Cataquacks that charge and ram', items: [['sms:cataquack', 0x00000100, 2]] },
  harbor: { about: 'land Bloopers patrolling', items: [['sms:blooper', 0, 2]] },
  boss_rush: { about: 'one of each Sunshine enemy', items: [['sms:strollin_stu', 0x00010000, 1], ['sms:swoopin_stu', 0, 1], ['sms:electrokoopa', 0, 1], ['sms:pokey', 0, 1], ['sms:cataquack', 0x00000100, 1], ['sms:blooper', 0, 1]] },
};

export default ({ tool, z, card, rpc, commit, text, where, opts, friendlyName }) => [
  tool('sunshine_characters', 'The characters ported from Super Mario Sunshine (Piantas and enemies with their own models, animations and behaviour): catalog ids for spawn, what they do, their bparams, and the ready-made groups of sunshine_group.', {},
    card('sunshine_characters', () => 'Looking at the Sunshine characters', async () => ({
      result: text({
        characters: CAST.map((id) => ({ id, name: friendlyName(id), notes: NOTES[id] })),
        groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.about])),
      }),
    })), opts),

  tool('sunshine_group', 'Place a ready-made group of Super Mario Sunshine characters, spread around a spot (live and saved): ' +
    Object.entries(GROUPS).map(([k, g]) => `${k} (${g.about})`).join(', ') + '. For single characters use spawn with the ids from sunshine_characters.', {
    group: z.enum(Object.keys(GROUPS)),
    where: where.optional(),
    size: z.number().optional().describe('multiplies the head count (default 1, max 3)'),
  }, card('sunshine_group', (a) => `Adding a Sunshine ${String(a.group).replace(/_/g, ' ')}`, async (a) => {
    const g = GROUPS[a.group];
    const k = Math.max(0.5, Math.min(3, a.size || 1));
    const items = g.items.map(([id, bp, n]) => ({
      id, count: Math.max(1, Math.round(n * k)), bparams: '0x' + (bp >>> 0).toString(16).padStart(8, '0'), where: a.where, face: 'mario',
    }));
    const r = await rpc('place', { items });
    const records = r.placed.map((x) => x.record);
    if (!records.length) throw new Error(r.errors.join('; ') || 'nothing placed');
    const summary = `Added a Sunshine ${a.group.replace(/_/g, ' ')} (${records.length})`;
    const change = commit('spawn', r, summary, { objects: records, remote: { spawn: records } });
    return { summary, result: text({ placed: records.map((x) => ({ uid: x.uid, name: x.name, x: x.x, z: x.z })), errors: r.errors, change_id: change.id }) };
  }), opts),
];
