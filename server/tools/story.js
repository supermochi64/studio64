// Claude's story tools: dialogs, the game's own texts, talking characters, trigger zones,
// variables, events (When -> If -> Then), cutscenes, the start and the ending.
// The story lives in project.story (server/story.js); objects (characters, zones) are ordinary
// patch records placed through the browser (web/js/story/rpc.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyOf, storyEdit } from '../story.js';
import { newStoryId } from '../../web/js/story/ops.js';
import { TRIGGERS, CONDITIONS, ACTIONS, STEPS, CHARACTERS, describe } from '../../web/js/story/schema.js';
import { useTexts, wrap, check, dialogText, textWidth, LINE_MAX } from '../../web/js/story/text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let gameTexts = null;
function texts() {
  if (!gameTexts) {
    gameTexts = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'web', 'data', 'story_texts.json'), 'utf8'));
    useTexts(gameTexts);
  }
  return gameTexts;
}

const BOXES = { top_left: [30, 200], top: [95, 200], top_right: [150, 200], middle: [95, 150] };
const VOICES = ['none', 'ukiki', 'big_penguin', 'bowser_intro', 'koopa', 'king_bobomb', 'boo', 'bobomb_buddy', 'bowser_laugh', 'boss_grunt', 'wiggler', 'yoshi'];

export default function storyTools(ctx) {
  const { tool, z, card, rpc, commit, text, where, opts, project: p, agent, findCustom, levelByKey } = ctx;
  const hub = agent.hub;
  const story = () => storyOf(p);
  const edit = (ops) => storyEdit(hub, p, ops);

  // ---- references by name or id -----------------------------------------------------------

  const findIn = (coll, ref) => {
    if (ref == null || ref === '') return null;
    const list = story()[coll];
    const s = String(ref).toLowerCase();
    return list.find((x) => x.id === ref) || list.find((x) => (x.name || '').toLowerCase() === s) || null;
  };
  const levelKey = (ref) => {
    if (ref == null || ref === '' || ref === 'any') return undefined;
    const c = findCustom(ref);
    if (c) return `c:${c.id}`;
    if (/^c:/.test(String(ref))) return String(ref);
    // "Level · Area" / "Level/Area": one area of a custom level (c:<id>:<n>)
    const m = /^(.+?)\s*(?:·|\/|>)\s*(.+)$/.exec(String(ref));
    const cl = m && findCustom(m[1]);
    if (cl) {
      const an = m[2].toLowerCase();
      const a = [{ index: 1, name: cl.mainAreaName || 'Main area' }, ...(cl.areas || [])].find((x) => String(x.index) === an || (x.name || '').toLowerCase() === an || (x.name || '').toLowerCase().includes(an));
      if (a) return a.index > 1 ? `c:${cl.id}:${a.index}` : `c:${cl.id}:1`;
    }
    const l = levelByKey(ref);
    if (l) return String(l.num);
    throw new Error(`unknown level "${ref}"`);
  };
  // A variable by name (made when missing).
  const varRef = (ref, kind, ops) => {
    if (ref == null || ref === '') return undefined;
    const v = findIn('vars', ref);
    if (v) return v.id;
    const nv = { id: newStoryId('var'), name: String(ref).slice(0, 60), kind: kind || 'flag', initial: kind === 'counter' ? 0 : false };
    ops.push({ op: 'upsert', coll: 'vars', item: nv });
    story().vars.push(nv); // visible to later lookups in this call (the op replaces it)
    return nv.id;
  };
  // A dialog: an existing one by id/name, or a new one from text.
  const dialogRef = (a, ops, name = 'Dialog') => {
    if (a.text != null && a.text !== '') {
      const d = { id: newStoryId('dlg'), name: (a.dialog_name || name).slice(0, 80), text: String(a.text), lines: a.lines || 4, box: BOXES[a.box] || BOXES.top_left, voice: Math.max(0, VOICES.indexOf(a.voice || 'none')) };
      if (a.question) { d.question = true; d.yes = a.question.first || 'Yes'; d.no = a.question.second || 'No'; }
      ops.push({ op: 'upsert', coll: 'dialogs', item: d });
      story().dialogs.push(d);
      return d.id;
    }
    if (/^game:\d+$/.test(String(a.dialog || ''))) return a.dialog;
    if (typeof a.dialog === 'number') return `game:${a.dialog}`;
    const d = findIn('dialogs', a.dialog);
    if (!d) throw new Error(`no dialog "${a.dialog}" (give text, or a dialog id from story_overview)`);
    return d.id;
  };

  const fixConditions = (conds = [], ops) => (conds || []).map((c0) => {
    const c = { ...c0 };
    if (!CONDITIONS[c.type]) throw new Error(`unknown condition type "${c.type}"`);
    if (c.type === 'flag') c.var = varRef(c.var, 'flag', ops);
    if (c.type === 'var') c.var = varRef(c.var, 'counter', ops);
    if (c.type === 'level') c.key = levelKey(c.level ?? c.key);
    if (c.type === 'event_done') c.event = findIn('events', c.event)?.id || c.event;
    return c;
  });

  const fixActions = (acts = [], ops, evName) => (acts || []).map((a0) => {
    const a = { ...a0 };
    if (!ACTIONS[a.type]) throw new Error(`unknown action type "${a.type}"`);
    switch (a.type) {
      case 'dialog': a.dialog = dialogRef(a, ops, `${evName}: dialog`); delete a.text; if (a.answer_var) a.answer_var = varRef(a.answer_var, 'flag', ops); break;
      case 'set_flag': a.var = varRef(a.var, 'flag', ops); a.value = a.value === 'toggle' ? 'toggle' : String(a.value !== false && a.value !== 'false'); break;
      case 'set_var': a.var = varRef(a.var, 'counter', ops); break;
      case 'warp': if (a.level != null) a.level = levelKey(a.level); if (a.x != null) a.pos = { x: a.x, y: a.y, z: a.z }; break;
      case 'teleport': if (a.x != null) a.pos = { x: a.x, y: a.y, z: a.z }; break;
      case 'cutscene': a.cutscene = findIn('cutscenes', a.cutscene)?.id || a.cutscene; break;
      case 'enable_event': a.event = findIn('events', a.event)?.id || a.event; break;
      case 'music': if (a.song) { a.seq = `song:${a.song}`; delete a.song; } break;
      case 'if': a.conditions = fixConditions(a.conditions, ops); a.then = fixActions(a.then, ops, evName); a.else = fixActions(a.else, ops, evName); break;
      default: break;
    }
    return a;
  });

  const fixTrigger = (t0 = {}, ops) => {
    const t = { ...t0 };
    if (!TRIGGERS[t.type]) throw new Error(`unknown trigger type "${t.type}"`);
    if (t.type === 'level_enter') t.level = levelKey(t.level);
    if (t.type === 'var') t.var = varRef(t.var, 'flag', ops);
    if ((t.type === 'enter_zone' || t.type === 'leave_zone') && t.zone == null && t.uid != null) t.zone = t.uid;
    if (t.type === 'talk' && t.dialog) t.dialog = dialogRef({ dialog: t.dialog }, ops);
    return t;
  };

  const names = () => {
    const s = story();
    const rec = (uid) => {
      for (const a of Object.values(p.areas || {})) {
        const r = (a.objects || []).find((x) => x.uid === Number(uid));
        if (r) return r.zone ? `zone “${r.zone.name}”` : s.npcs?.[r.uid]?.name || r.star?.name || r.name || `object ${uid}`;
      }
      return uid ? `object ${uid}` : '?';
    };
    return {
      zone: rec, npc: rec, star: rec, object: rec, level: (k) => k || 'any level',
      var: (id) => s.vars.find((v) => v.id === id)?.name || id,
      dialog: (id) => s.dialogs.find((d) => d.id === id)?.name || id,
      event: (id) => s.events.find((d) => d.id === id)?.name || id,
      cutscene: (id) => s.cutscenes.find((d) => d.id === id)?.name || id,
    };
  };

  const issuesOf = (d) => check(dialogText(d), { lines: d.lines || 4 }).map((i) => i.text);
  const charIds = CHARACTERS.map((c) => c.id);
  const say = z.array(z.object({
    text: z.string().optional().describe('what they say (wraps by itself; blank line = new box)'),
    dialog: z.string().optional().describe('or an existing dialog id/name'),
    if: z.array(z.record(z.any())).optional().describe('conditions for this line, e.g. [{type:"flag", var:"gave star", value:true}]'),
  })).describe('their lines; the FIRST line whose conditions hold is said, so put conditional lines first and the default last');

  return [
    tool('story_overview', 'The project\'s story: dialogs, characters (talking objects), variables, events, cutscenes, the start, and the vocabulary of triggers/conditions/actions. Read it before changing the story.', {},
      card('story_overview', () => 'Reading the story', async () => {
        texts();
        const s = story();
        const n = names();
        return {
          result: text({
            dialogs: s.dialogs.map((d) => ({ id: d.id, name: d.name, text: d.text.slice(0, 160), question: d.question ? [d.yes, d.no] : undefined })),
            characters: Object.entries(s.npcs).map(([uid, c]) => ({ uid: Number(uid), name: c.name, lines: (c.lines || []).map((l) => ({ dialog: n.dialog(l.dialog), if: (l.if || []).map((x) => describe('condition', x, n)) })) })),
            variables: s.vars.map((v) => ({ id: v.id, name: v.name, kind: v.kind, initial: v.initial })),
            events: s.events.map((e) => ({ id: e.id, name: e.name, repeat: e.repeat, when: describe('trigger', e.trigger, n), if: (e.conditions || []).map((c) => describe('condition', c, n)), then: (e.actions || []).map((a) => describe('action', a, n)) })),
            cutscenes: s.cutscenes.map((c) => ({ id: c.id, name: c.name, steps: (c.steps || []).map((x) => x.type) })),
            hidden_until_shown: s.hidden,
            start: s.start,
            changed_game_texts: Object.fromEntries(Object.entries(s.texts).map(([k, v]) => [k, Object.keys(v)])),
            vocabulary: { triggers: Object.keys(TRIGGERS), conditions: Object.keys(CONDITIONS), actions: Object.keys(ACTIONS), cutscene_steps: Object.keys(STEPS), characters: charIds, voices: VOICES, boxes: Object.keys(BOXES) },
          }),
        };
      }), opts),

    tool('write_dialog', 'Write (or rewrite, with id) a project dialog: what a character, sign or event says. Plain text, wrapped to the game\'s box by itself; a blank line starts a new box. The game\'s font has letters, digits, . , \' " ! ? - ( ) & : % ~ and glyphs [A] [B] [Z] [R] [C] (buttons), ^ | < > (C-buttons), ★ ☆ (stars), $ (coin), × . A question shows two answers the player picks (store the answer with the dialog action\'s answer_var, or branch on talk answer).', {
      id: z.string().optional().describe('an existing dialog to rewrite'),
      name: z.string().describe('short name, e.g. "Toad: lost key"'),
      text: z.string(),
      lines: z.number().optional().describe('lines per box, 1-8 (default 4)'),
      box: z.enum(['top_left', 'top', 'top_right', 'middle']).optional(),
      voice: z.enum(VOICES).optional().describe('sound when the box opens'),
      question: z.object({ first: z.string(), second: z.string() }).optional().describe('two answers, e.g. Yes / No (max ~8 letters each)'),
    }, card('write_dialog', (a) => `Writing “${a.name}”`, async (a) => {
      texts();
      const old = a.id ? findIn('dialogs', a.id) : null;
      const d = { ...(old || {}), id: old?.id || newStoryId('dlg'), name: a.name, text: a.text, lines: a.lines || old?.lines || 4, box: BOXES[a.box] || old?.box || BOXES.top_left, voice: a.voice ? VOICES.indexOf(a.voice) : old?.voice || 0 };
      if (a.question) { d.question = true; d.yes = a.question.first; d.no = a.question.second; } else if (!old) delete d.question;
      edit([{ op: 'upsert', coll: 'dialogs', item: d }]);
      const boxes = Math.ceil(dialogText(d).split('\n').length / d.lines);
      return { summary: `${old ? 'Rewrote' : 'Wrote'} “${a.name}”`, result: text({ dialog_id: d.id, boxes, as_shown: dialogText(d), issues: issuesOf(d) }) };
    }), opts),

    tool('find_game_text', 'Search the game\'s own texts (its 170 dialogs, course names, star names) to change them with set_game_text. Dialog 20 is Peach\'s letter at the start.', {
      query: z.string(),
    }, card('find_game_text', (a) => `Looking for “${a.query}”`, async (a) => {
      const T = texts();
      const s = story();
      const q = a.query.toLowerCase();
      const hits = [];
      for (const d of T.dialogs) {
        const cur = s.texts.dialogs[d.id]?.text ?? d.text;
        if (cur.toLowerCase().replace(/\n/g, ' ').includes(q) || String(d.id) === q) hits.push({ kind: 'dialog', number: d.id, text: cur.slice(0, 200), changed: !!s.texts.dialogs[d.id] });
      }
      for (const c of T.courses) if (c.text.toLowerCase().includes(q)) hits.push({ kind: 'course', number: c.index + 1, text: (s.texts.courses[c.index] ?? c.text.slice(3)) });
      for (const x of T.acts) if (x.text.toLowerCase().includes(q)) hits.push({ kind: 'star', course: x.course, act: x.act, text: s.texts.acts[x.index] ?? x.text });
      return { result: text(hits.slice(0, 25)) };
    }), opts),

    tool('set_game_text', 'Change one of the game\'s own texts for this hack (everywhere it appears), or restore it. kind dialog: number 0-169, text with explicit line breaks (each line fits ~24 characters; use \\n); course: number 1-25 (course names, 16+ are the secret levels); star: course 1-15 + act 1-6; ending: line 1-8 of Peach\'s ending speech; credits: page 1-20 with title (1-2 lines) and up to 3 names (capital letters, dots, digits 3 4 6 only).', {
      kind: z.enum(['dialog', 'course', 'star', 'ending', 'credits']),
      number: z.number().optional(), course: z.number().optional(), act: z.number().optional(),
      text: z.string().optional(),
      title: z.array(z.string()).optional(), names: z.array(z.string()).optional(),
      restore: z.boolean().optional().describe('bring the original back'),
    }, card('set_game_text', (a) => `Changing a game ${a.kind} text`, async (a) => {
      const T = texts();
      let op;
      if (a.kind === 'dialog') {
        const orig = T.dialogs[a.number];
        if (!orig) throw new Error('dialog number 0-169');
        let t = a.text ?? '';
        if (t && t.split('\n').some((l) => textWidth(l) > LINE_MAX)) t = wrap(t);
        op = { op: 'text', kind: 'dialogs', key: a.number, value: a.restore ? null : { text: t } };
      } else if (a.kind === 'course') op = { op: 'text', kind: 'courses', key: (a.number || 1) - 1, value: a.restore ? null : String(a.text || '').toUpperCase() };
      else if (a.kind === 'star') op = { op: 'text', kind: 'acts', key: ((a.course || 1) - 1) * 6 + (a.act || 1) - 1, value: a.restore ? null : String(a.text || '').toUpperCase() };
      else if (a.kind === 'ending') op = { op: 'text', kind: 'ending', key: (a.number || 1) - 1, value: a.restore ? null : a.text };
      else op = { op: 'text', kind: 'credits', key: a.number || 1, value: a.restore ? null : { title: (a.title || []).map((x) => x.toUpperCase()), names: (a.names || []).map((x) => x.toUpperCase()) } };
      edit([op]);
      return { summary: a.restore ? 'Restored a game text' : 'Changed a game text', result: text({ ok: true, issues: a.kind === 'dialog' && op.value ? check(op.value.text).map((i) => i.text) : [] }) };
    }), opts),

    tool('add_npc', `Place a character Mario can talk to (press B) with what they say, in the current level, saved. Characters: ${charIds.join(', ')} (signs are read, the others turn to Mario). Optionally actions after the first talk (give a star, coins, open a gate…; see add_event actions).`, {
      character: z.string().describe(`one of ${charIds.join(', ')}`),
      name: z.string().optional(),
      where: where.optional(),
      says: say,
      after_talk: z.array(z.record(z.any())).optional().describe('actions when the talk ends, e.g. [{type:"give_star", uid: 123, at:"mario"}, {type:"set_flag", var:"helped toad", value:true}]'),
      after_talk_repeat: z.enum(['once', 'always']).optional(),
    }, card('add_npc', (a) => `Placing ${a.name || a.character}`, async (a) => {
      texts();
      const r = await rpc('story_place_character', { character: a.character, where: a.where || {}, name: a.name });
      const rec = r.records[0];
      const label = a.name || r.label;
      commit('spawn', r, `Placed ${label}`, { objects: r.records, remote: { spawn: r.records } });
      const ops = [];
      const lines = (a.says || []).map((l, i) => ({ dialog: dialogRef(l, ops, `${label}: line ${i + 1}`), if: fixConditions(l.if, ops) }));
      ops.push({ op: 'npc', uid: rec.uid, value: { name: label, kind: r.character, lines } });
      let ev = null;
      if (a.after_talk?.length) {
        ev = { id: newStoryId('ev'), name: `After talking to ${label}`, enabled: true, repeat: a.after_talk_repeat || 'once', trigger: { type: 'talk', uid: rec.uid }, conditions: [], actions: fixActions(a.after_talk, ops, label) };
        ops.push({ op: 'upsert', coll: 'events', item: ev });
      }
      edit(ops);
      return { summary: `Placed ${label}`, result: text({ uid: rec.uid, x: rec.x, y: rec.y, z: rec.z, event_id: ev?.id }) };
    }), opts),

    tool('make_talk', 'Give an existing object (uid from list_objects; Toads, Bob-omb Buddies, signs, Piantas or characters placed with add_npc) what it says. Replaces its lines.', {
      uid: z.number(), name: z.string().optional(), says: say,
    }, card('make_talk', () => 'Writing a character\'s lines', async (a) => {
      texts();
      const ops = [];
      const old = story().npcs[a.uid];
      const label = a.name || old?.name || 'Character';
      const lines = (a.says || []).map((l, i) => ({ dialog: dialogRef(l, ops, `${label}: line ${i + 1}`), if: fixConditions(l.if, ops) }));
      ops.push({ op: 'npc', uid: a.uid, value: { ...(old || {}), name: label, lines } });
      edit(ops);
      return { summary: `${label} says something new`, result: text({ ok: true }) };
    }), opts),

    tool('add_zone', 'STORY/EVENT trigger zone: an invisible box (visible in build mode) that starts add_event events when Mario enters or leaves it (not a hazard, water or level area). Default size 600×400×600 (x, height, z), standing on the ground.', {
      name: z.string(), where: where.optional(),
      size: z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).optional(),
    }, card('add_zone', (a) => `Adding zone “${a.name}”`, async (a) => {
      const r = await rpc('story_add_zone', { name: a.name, where: a.where || {}, size: a.size || {} });
      commit('spawn', r, `Added zone “${a.name}”`, { objects: r.records, remote: { spawn: r.records } });
      const z0 = r.records[0];
      return { summary: `Added zone “${a.name}”`, result: text({ zone_uid: z0.uid, x: z0.x, y: z0.y, z: z0.z, size: [z0.block.sx, z0.block.sy, z0.block.sz] }) };
    }), opts),

    tool('add_variable', 'Add a story variable: a flag (yes/no) or a counter (number), saved per save file. Events can also create them by name.', {
      name: z.string(), kind: z.enum(['flag', 'counter']), initial: z.union([z.boolean(), z.number()]).optional(),
    }, card('add_variable', (a) => `Adding ${a.kind} “${a.name}”`, async (a) => {
      const old = findIn('vars', a.name);
      const v = { id: old?.id || newStoryId('var'), name: a.name, kind: a.kind, initial: a.initial ?? (a.kind === 'flag' ? false : 0) };
      edit([{ op: 'upsert', coll: 'vars', item: v }]);
      return { summary: `Added ${a.kind} “${a.name}”`, result: text({ id: v.id }) };
    }), opts),

    tool('add_event', `Add (or replace, with id) a story event: WHEN trigger → IF conditions (all true) → THEN actions run in order (a dialog waits until closed, a cutscene until it ends). Variables are referred to by name and made when missing; dialogs by id/name or written inline with {type:"dialog", text:"…"}; objects/zones/stars by uid. repeat: once (per save, default), visit (once per level visit), always. ${['TRIGGERS', ...Object.entries(TRIGGERS).map(([k, v]) => `${k}{${v.fields.map((f) => f[0]).join(',')}}`)].join(' ')}. ${['CONDITIONS', ...Object.entries(CONDITIONS).map(([k, v]) => `${k}{${v.fields.map((f) => f[0]).join(',')}}`)].join(' ')}. ${['ACTIONS', ...Object.entries(ACTIONS).map(([k, v]) => `${k}{${v.fields.map((f) => f[0]).join(',')}}`)].join(' ')}; dialog{text|dialog, question?{first,second}, answer_var}; if{conditions, answer:"yes"|"no", then:[...], else:[...]}; warp{level (name, custom level, or "Level · Area" / "c:<id>:<area>" for a sub-area), uid? (a door, pipe or arrival point there that Mario comes out of), x?,y?,z?}; lock_door/open_door{uid of a door, pipe, painting or warp zone: locked/opened for this save}; give_star{uid of a star record, at:"mario"|"spot"} (hide the star first with hidden:[uid] so the event "gives" it); show/hide/open_door{uid}; spawn{entry, count, at:"mario"|zone uid|{x,y,z}}; music{seq number or song id}; sound{bits}; set_flag{var, value:true|false|"toggle"}; set_var{var, op:"set"|"add"|"sub", value}.`, {
      id: z.string().optional(),
      name: z.string(),
      trigger: z.record(z.any()).describe('e.g. {type:"enter_zone", zone: 123} or {type:"talk", uid: 456, answer:"yes"} or {type:"star", uid: 789}'),
      conditions: z.array(z.record(z.any())).optional(),
      actions: z.array(z.record(z.any())),
      repeat: z.enum(['once', 'visit', 'always']).optional(),
      level: z.string().optional().describe('only in this level (name or custom level)'),
      hidden: z.array(z.number()).optional().describe('object uids to hide until an action shows them (stars to give, gates that appear)'),
    }, card('add_event', (a) => `Adding event “${a.name}”`, async (a) => {
      texts();
      const ops = [];
      const old = a.id ? findIn('events', a.id) : null;
      const ev = { id: old?.id || newStoryId('ev'), name: a.name, enabled: true, repeat: a.repeat || 'once', level: levelKey(a.level), trigger: fixTrigger(a.trigger, ops), conditions: fixConditions(a.conditions, ops), actions: fixActions(a.actions, ops, a.name) };
      if (ev.level === undefined) delete ev.level;
      ops.push({ op: 'upsert', coll: 'events', item: ev });
      for (const uid of a.hidden || []) ops.push({ op: 'hidden', uid, on: true });
      edit(ops);
      const n = names();
      return { summary: `Added event “${a.name}”`, result: text({ event_id: ev.id, reads: `When ${describe('trigger', ev.trigger, n)}${ev.conditions.length ? `, if ${ev.conditions.map((c) => describe('condition', c, n)).join(' and ')}` : ''}: ${ev.actions.map((x) => describe('action', x, n)).join(', then ')}` }) };
    }), opts),

    tool('cutscene', `Make (or replace, with id) a cutscene: Mario freezes, the camera follows the shots, dialogs and captions show, Start skips. Steps: shot{seconds (glide time; 0 = cut), ease: smooth|linear|in|out|cut, and either pos:[x,y,z]+focus:[x,y,z] or target: uid|"mario"|{x,y,z} with distance, angle_deg (0 = camera south of target looking north… compass yaw), height}; follow_mario{} (back to the game camera); dialog{text|dialog}; caption{text, seconds}; wait{seconds}; fade{to:"out"|"in", seconds, color}; move{uid, x,y,z, seconds, wait}; mario{x,y,z,yaw}; action{action:{…any event action}}. Play it from an event with {type:"cutscene", cutscene:"<id>"} or set_start.`, {
      id: z.string().optional(), name: z.string(), skippable: z.boolean().optional(), hud: z.boolean().optional(),
      steps: z.array(z.record(z.any())),
    }, card('cutscene', (a) => `Making cutscene “${a.name}”`, async (a) => {
      texts();
      const ops = [];
      const need = a.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.type === 'shot' && !(s.pos && s.focus));
      let shots = [];
      if (need.length) shots = (await rpc('story_shots', { shots: need.map(({ s }) => ({ target: s.target, distance: s.distance, angle_deg: s.angle_deg, height: s.height })) })).shots;
      const steps = a.steps.map((s0, i) => {
        const s = { ...s0 };
        if (!STEPS[s.type]) throw new Error(`unknown step "${s.type}"`);
        if (s.type === 'shot') {
          const k = need.findIndex((x) => x.i === i);
          if (k >= 0) { s.pos = shots[k].pos; s.focus = shots[k].focus; }
          delete s.target; delete s.distance; delete s.angle_deg; delete s.height;
          s.seconds ??= 2;
        }
        if (s.type === 'dialog') { s.dialog = dialogRef(s, ops, `${a.name}: line ${i + 1}`); delete s.text; }
        if ((s.type === 'move' || s.type === 'mario') && s.x != null) s.pos = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
        if (s.type === 'action') s.action = fixActions([s.action], ops, a.name)[0];
        return s;
      });
      const old = a.id ? findIn('cutscenes', a.id) : null;
      const cs = { id: old?.id || newStoryId('cs'), name: a.name, skippable: a.skippable !== false, hud: !!a.hud, steps };
      ops.push({ op: 'upsert', coll: 'cutscenes', item: cs });
      edit(ops);
      return { summary: `Made cutscene “${a.name}”`, result: text({ cutscene_id: cs.id, steps: steps.length }) };
    }), opts),

    tool('set_start', 'How the hack starts ("Play from start" and the published game): the start level (original or custom), Mario\'s position there ("mario" = where he stands now), an opening dialog (text or id), an opening cutscene, and whether the star select screen shows.', {
      level: z.string().optional(), position: z.union([z.literal('mario'), z.object({ x: z.number(), y: z.number(), z: z.number(), yaw_deg: z.number().optional() })]).optional(),
      dialog: z.string().optional(), dialog_text: z.string().optional(), cutscene: z.string().optional(), star_select: z.boolean().optional(),
    }, card('set_start', () => 'Setting the start', async (a) => {
      texts();
      const ops = [];
      const st = { ...(story().start || {}) };
      if (a.level) {
        const key = levelKey(a.level);
        delete st.level; delete st.custom; delete st.area;
        // a sub-area: c:<id>:<n>
        if (key.startsWith('c:')) { const [, id, n] = key.split(':'); st.custom = id; if (Number(n) > 1) st.area = Number(n); } else st.level = Number(key);
      }
      if (a.position === 'mario') {
        const s = await rpc('state', {});
        if (s.mario) st.pos = { x: s.mario.x, y: s.mario.y, z: s.mario.z, yaw: s.mario.facing_deg ?? 0 };
      } else if (a.position) st.pos = { x: a.position.x, y: a.position.y, z: a.position.z, yaw: a.position.yaw_deg || 0 };
      if (a.dialog_text || a.dialog) st.dialog = dialogRef({ text: a.dialog_text, dialog: a.dialog }, ops, 'Opening');
      if (a.cutscene) st.cutscene = findIn('cutscenes', a.cutscene)?.id;
      if (a.star_select != null) st.starSelect = a.star_select;
      ops.push({ op: 'start', value: st });
      edit(ops);
      return { summary: 'Set how the hack starts', result: text(st) };
    }), opts),

    tool('delete_story_item', 'Delete a dialog, event, variable, cutscene, or a character\'s lines (the object stays).', {
      kind: z.enum(['dialog', 'event', 'variable', 'cutscene', 'character']), id: z.union([z.string(), z.number()]),
    }, card('delete_story_item', (a) => `Deleting a ${a.kind}`, async (a) => {
      const coll = { dialog: 'dialogs', event: 'events', variable: 'vars', cutscene: 'cutscenes' }[a.kind];
      if (coll) {
        const it = findIn(coll, a.id);
        if (!it) throw new Error(`no ${a.kind} "${a.id}"`);
        edit([{ op: 'delete', coll, id: it.id }]);
      } else edit([{ op: 'npc', uid: Number(a.id), value: null }]);
      return { summary: `Deleted a ${a.kind}`, result: text({ ok: true }) };
    }), opts),

    tool('test_story', 'Run part of the story now in the player\'s game to check it: an event\'s actions, a cutscene, a dialog, or the whole hack from the start (fresh save). Then use look to see it.', {
      kind: z.enum(['event', 'cutscene', 'dialog', 'start']), id: z.string().optional(),
    }, card('test_story', (a) => `Testing the ${a.kind}`, async (a) => {
      const id = a.kind === 'event' ? findIn('events', a.id)?.id : a.kind === 'cutscene' ? findIn('cutscenes', a.id)?.id : a.kind === 'dialog' ? findIn('dialogs', a.id)?.id || a.id : null;
      const r = await rpc('story_play', { kind: a.kind, id });
      return { summary: `Playing the ${a.kind}`, result: text(r) };
    }), opts),

    tool('story_progress', 'The player\'s story progress in this save (flags, counters, events that happened, shown/removed objects, recent log); can set variables or reset everything.', {
      reset: z.boolean().optional(), set: z.record(z.union([z.boolean(), z.number()])).optional().describe('variable name/id -> value'),
    }, card('story_progress', () => 'Checking the story progress', async (a) => {
      const set = a.set ? Object.fromEntries(Object.entries(a.set).map(([k, v]) => [findIn('vars', k)?.id || k, v])) : null;
      return { result: text(await rpc('story_progress', { reset: !!a.reset, set })) };
    }), opts),
  ];
}
