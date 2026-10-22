// Claude's story tools (server/tools/story.js) without Claude or a browser: a fake tool context
// records what the tools save, place and send. Run: node tests/scripts/story_tools.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.STUDIO_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'story-tools-'));
const { z } = await import('zod');
const storyTools = (await import('../../server/tools/story.js')).default;

const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
const project = { id: 'storytest', name: 'Story test', areas: {}, levels: [{ id: 'lvl1', name: 'Mushroom Meadow' }], changes: [] };
const sent = [];
const commits = [];
let uid = 1000;
const rpc = async (method, params) => {
  if (method === 'story_place_character') return { key: 'c:lvl1', level: 37, area: 1, character: params.character, label: 'Toad', records: [{ uid: ++uid, bhv: 'bhvStudioNpc', model: 'toad_message', x: 0, y: 0, z: 300, yaw: 0 }] };
  if (method === 'story_add_zone') return { key: 'c:lvl1', level: 37, area: 1, records: [{ uid: ++uid, x: 0, y: 0, z: 900, block: { sx: 600, sy: 400, sz: 600 }, zone: { name: params.name } }] };
  if (method === 'story_shots') return { shots: params.shots.map(() => ({ pos: [1, 2, 3], focus: [4, 5, 6] })) };
  if (method === 'state') return { mario: { x: 10, y: 20, z: 30, facing_deg: 90 } };
  if (method === 'story_play') return { ok: true };
  throw new Error(`unexpected rpc ${method}`);
};
const ctx = {
  tool: (name, desc, schema, handler) => ({ name, desc, schema, handler }),
  z,
  card: (name, label, fn) => async (a) => { try { return (await fn(a)).result; } catch (err) { return { error: err.message }; } },
  rpc,
  commit: (kind, r, summary, extra) => { commits.push({ kind, summary, objects: extra.objects }); for (const o of extra.objects || []) ((project.areas[r.key] ||= { objects: [] }).objects).push(o); return { id: 'c' + commits.length }; },
  text: (obj) => obj,
  fail: (m) => ({ error: m }),
  where: z.any(),
  opts: {},
  project,
  agent: { hub: { broadcast: (id, msg) => sent.push(msg) } },
  findCustom: (q) => project.levels.find((l) => l.id === q || l.name.toLowerCase() === String(q).toLowerCase()),
  levelByKey: (k) => (/battlefield|^9$/i.test(String(k)) ? { slug: 'bob', num: 9, name: 'Bob-omb Battlefield' } : null),
};
const tools = Object.fromEntries(storyTools(ctx).map((t) => [t.name, t]));
const call = (n, a) => tools[n].handler(a);
ok(Object.keys(tools).length >= 14, `${Object.keys(tools).length} story tools`);
for (const t of Object.values(tools)) ok(z.object(t.schema).safeParse({}).success || Object.keys(t.schema).length > 0, `${t.name} has a schema`);

// a dialog, with wrapping and the question line
const d = await call('write_dialog', { name: 'Toad: hello', text: 'Hello Mario! Welcome to the brand new mushroom meadow, where the grass is always greener.', question: { first: 'Thanks', second: 'Bye' } });
ok(d.dialog_id && d.boxes >= 1 && /\/\/Thanks/.test(d.as_shown), `write_dialog wraps and adds the answers (${d.boxes} boxes)`);
ok(project.story.dialogs[0].num === 256, 'the first project dialog is engine dialog 256');
ok(sent.at(-1)?.type === 'story', 'the story is sent to the browsers');

// an NPC with conditional lines and an after-talk reward
const npc = await call('add_npc', { character: 'toad', name: 'Mayor', says: [{ text: 'You found the key!', if: [{ type: 'flag', var: 'has key', value: true }] }, { text: 'I lost my key...' }], after_talk: [{ type: 'coins', amount: 5 }] });
ok(npc.uid && npc.event_id, 'add_npc places the character and its after-talk event');
ok(project.story.npcs[npc.uid].lines.length === 2 && project.story.vars.some((v) => v.name === 'has key' && v.kind === 'flag'), 'conditional lines made the "has key" flag');
ok(commits.some((c) => /Placed Mayor/.test(c.summary)), 'the character is a saved object');

// a zone + event: dialog inline, flag, open a door, warp to a level by name
const zone = await call('add_zone', { name: 'Key room' });
ok(zone.zone_uid, 'add_zone');
const ev = await call('add_event', {
  name: 'Find the key', trigger: { type: 'enter_zone', zone: zone.zone_uid },
  actions: [{ type: 'dialog', text: 'A golden key glitters on the floor!' }, { type: 'set_flag', var: 'has key', value: true }, { type: 'open_door', uid: 4242 }, { type: 'warp', level: 'Bob-omb Battlefield' }],
  hidden: [4242],
});
ok(ev.event_id && /Mario enters/.test(ev.reads), `add_event reads: ${ev.reads}`);
const saved = project.story.events.find((e) => e.id === ev.event_id);
ok(saved.actions[0].dialog && saved.actions[1].var === project.story.vars.find((v) => v.name === 'has key').id && saved.actions[3].level === '9', 'references resolved (dialog, flag, level)');
ok(project.story.hidden.includes(4242), 'hidden until shown');
const bad = await call('add_event', { name: 'Broken', trigger: { type: 'nope' }, actions: [] });
ok(bad.error && /unknown trigger/.test(bad.error), 'bad triggers are refused');

// a cutscene with a target shot and a dialog line
const cs = await call('cutscene', { name: 'Key cam', steps: [{ type: 'shot', target: 'mario', distance: 600, seconds: 2 }, { type: 'dialog', text: 'Look at that!' }, { type: 'wait', seconds: 1 }] });
const csSaved = project.story.cutscenes.find((c) => c.id === cs.cutscene_id);
ok(csSaved.steps[0].pos?.length === 3 && csSaved.steps[1].dialog, 'cutscene resolves shots and dialogs');

// game texts and the start
const gt = await call('set_game_text', { kind: 'dialog', number: 20, text: 'Dear Mario: please come to the meadow. Something strange is going on in the kingdom!' });
ok(gt.ok && project.story.texts.dialogs[20].text.includes('\n'), 'Peach\'s letter is wrapped into lines');
await call('set_game_text', { kind: 'course', number: 1, text: 'Boom Valley' });
await call('set_game_text', { kind: 'credits', number: 1, title: ['Story'], names: ['You'] });
ok(project.story.texts.courses[0] === 'BOOM VALLEY' && project.story.texts.credits[1].names[0] === 'YOU', 'course name and credits');
const found = await call('find_game_text', { query: 'princess toadstool' });
ok(found.some((x) => x.kind === 'dialog'), 'find_game_text finds the game\'s dialogs');
const st = await call('set_start', { level: 'Mushroom Meadow', position: 'mario', dialog_text: 'Welcome to the meadow!', cutscene: 'Key cam' });
ok(st.custom === 'lvl1' && st.pos.x === 10 && st.dialog && st.cutscene === cs.cutscene_id, 'set_start');
const ov = await call('story_overview', {});
ok(ov.events.length === 2 && ov.characters.length === 1 && ov.vocabulary.actions.includes('give_star'), 'story_overview');
const del = await call('delete_story_item', { kind: 'event', id: 'Find the key' });
ok(del.ok && project.story.events.length === 1, 'delete by name');
console.log('done');
setTimeout(() => process.exit(), 500);
