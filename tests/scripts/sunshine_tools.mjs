// Claude's Sunshine tools (server/tools/sunshine.js) against a stub context: the cast lists every
// ported character with its notes, and sunshine_group places the right ids and params.
import { z } from 'zod';
import plugin from '../../server/tools/sunshine.js';
import { friendlyName } from '../../server/catalog.js';

const calls = [];
const tools = {};
const ctx = {
  z, where: z.object({ mode: z.string().optional() }), opts: {}, friendlyName,
  text: (o) => JSON.stringify(o),
  card: (name, label, fn) => fn,
  tool: (name, desc, schema, fn) => (tools[name] = { desc, schema: z.object(schema), fn }),
  rpc: async (name, params) => {
    calls.push([name, params]);
    return { placed: params.items.flatMap((it) => Array.from({ length: it.count }, (_, i) => ({ record: { uid: calls.length * 100 + i, name: friendlyName(it.id), x: 0, z: 0, entry: it.id, bparams: Number(it.bparams) } }))), errors: [] };
  },
  commit: () => ({ id: 'c1' }),
};
plugin(ctx);
let ok = true;
const check = (name, cond, info = '') => { ok &&= !!cond; console.log(cond ? 'PASS' : 'FAIL', name, info); };

check('both tools registered', tools.sunshine_characters && tools.sunshine_group);
const cast = JSON.parse((await tools.sunshine_characters.fn({})).result);
check('cast lists 11 characters with notes', cast.characters.length === 11 && cast.characters.every((c) => c.notes && c.name), cast.characters.map((c) => c.name).join(', '));
const group = tools.sunshine_group.schema.parse({ group: 'launcher' });
const r = await tools.sunshine_group.fn(group);
check('launcher = one blue Cataquack', calls[0][1].items.length === 1 && calls[0][1].items[0].id === 'sms:cataquack' && calls[0][1].items[0].bparams === '0x00000000', r.summary);
await tools.sunshine_group.fn({ group: 'goop_patrol', size: 2 });
const items = calls[1][1].items;
check('goop patrol doubled', items.find((i) => i.id === 'sms:strollin_stu').count === 6 && items.find((i) => i.id === 'sms:swoopin_stu').count === 4);
await tools.sunshine_group.fn({ group: 'red_quacks' });
check('red Cataquacks have kind 1', calls[2][1].items[0].bparams === '0x00000100');
let threw = false;
try { tools.sunshine_group.schema.parse({ group: 'nope' }); } catch { threw = true; }
check('unknown groups are rejected', threw);
console.log(ok ? 'all passed' : 'FAILED');
process.exit(ok ? 0 : 1);
