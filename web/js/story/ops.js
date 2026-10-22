// Story edits as small operations, applied the same way in the browser (right away) and on the
// server (saved and sent to everyone). Plain ES module: the server imports it too.

export const COLLECTIONS = ['dialogs', 'vars', 'events', 'cutscenes'];
export const TEXT_KINDS = ['dialogs', 'courses', 'acts', 'ending', 'credits'];
export const DIALOG_BASE = 256;
const LIMITS = { dialogs: 2000, vars: 500, events: 1000, cutscenes: 300 };

export function blankStory() {
  return { version: 1, dialogs: [], texts: { dialogs: {}, courses: {}, acts: {}, ending: {}, credits: {} }, npcs: {}, vars: [], events: [], cutscenes: [], hidden: [], start: {} };
}

export function ensureStory(s) {
  const b = blankStory();
  if (!s || typeof s !== 'object') return b;
  for (const k of Object.keys(b)) if (s[k] === undefined || s[k] === null) s[k] = b[k];
  for (const k of TEXT_KINDS) if (!s.texts[k] || typeof s.texts[k] !== 'object') s.texts[k] = {};
  return s;
}

export const newStoryId = (prefix = 'x') => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

// A free engine number for a new dialog.
export function nextDialogNum(story) {
  let n = DIALOG_BASE - 1;
  for (const d of story.dialogs) if (d.num > n) n = d.num;
  return n + 1;
}

const clip = (v, n) => String(v ?? '').slice(0, n);

// Keep records to sane sizes (they come from the network and from Claude).
function clean(coll, item) {
  const it = JSON.parse(JSON.stringify(item));
  if (typeof it.id !== 'string' || !/^[\w-]{1,40}$/.test(it.id)) throw new Error('bad id');
  if ('name' in it) it.name = clip(it.name, 80);
  if (coll === 'dialogs') {
    it.text = clip(it.text, 4000);
    it.lines = Math.max(1, Math.min(8, it.lines | 0 || 4));
    if (it.yes != null) it.yes = clip(it.yes, 16);
    if (it.no != null) it.no = clip(it.no, 16);
  }
  if (JSON.stringify(it).length > 200000) throw new Error('too big');
  return it;
}

// Apply one operation. Returns a short summary, or throws.
export function applyStoryOp(story, op) {
  ensureStory(story);
  switch (op?.op) {
    case 'upsert': {
      if (!COLLECTIONS.includes(op.coll)) throw new Error('bad collection');
      const list = story[op.coll];
      const item = clean(op.coll, op.item || {});
      const i = list.findIndex((x) => x.id === item.id);
      if (op.coll === 'dialogs') {
        const old = i >= 0 ? list[i] : null;
        // engine numbers are given once and never change (events refer to dialogs by id)
        if (old?.num) item.num = old.num;
        else if (!(item.num >= DIALOG_BASE) || list.some((d) => d.num === item.num && d.id !== item.id)) item.num = nextDialogNum(story);
      }
      if (i >= 0) list[i] = item;
      else {
        if (list.length >= LIMITS[op.coll]) throw new Error(`too many ${op.coll}`);
        if (op.index != null && op.index >= 0 && op.index <= list.length) list.splice(op.index, 0, item); else list.push(item);
      }
      return `${i >= 0 ? 'Changed' : 'Added'} ${op.coll.slice(0, -1)} “${item.name || item.id}”`;
    }
    case 'delete': {
      if (!COLLECTIONS.includes(op.coll)) throw new Error('bad collection');
      const before = story[op.coll].length;
      story[op.coll] = story[op.coll].filter((x) => x.id !== op.id);
      return before !== story[op.coll].length ? `Deleted a ${op.coll.slice(0, -1)}` : null;
    }
    case 'move': {
      // reorder: put op.id at op.index
      if (!COLLECTIONS.includes(op.coll)) throw new Error('bad collection');
      const list = story[op.coll];
      const i = list.findIndex((x) => x.id === op.id);
      if (i < 0) return null;
      const [it] = list.splice(i, 1);
      list.splice(Math.max(0, Math.min(list.length, op.index | 0)), 0, it);
      return null;
    }
    case 'npc': {
      const uid = Number(op.uid);
      if (!uid) throw new Error('bad uid');
      if (op.value) {
        const v = JSON.parse(JSON.stringify(op.value));
        v.name = clip(v.name, 80);
        v.lines = Array.isArray(v.lines) ? v.lines.slice(0, 40) : [];
        story.npcs[uid] = v;
      } else delete story.npcs[uid];
      return op.value ? `Changed what ${op.value.name || 'a character'} says` : 'Removed a character\'s lines';
    }
    case 'text': {
      if (!TEXT_KINDS.includes(op.kind)) throw new Error('bad text kind');
      const key = String(op.key);
      if (!/^\d{1,3}$/.test(key)) throw new Error('bad text key');
      if (op.value == null) delete story.texts[op.kind][key];
      else story.texts[op.kind][key] = typeof op.value === 'string' ? clip(op.value, 4000) : JSON.parse(JSON.stringify(op.value));
      return `Changed game text (${op.kind})`;
    }
    case 'hidden': {
      const uid = Number(op.uid);
      story.hidden = (story.hidden || []).filter((x) => x !== uid);
      if (op.on) story.hidden.push(uid);
      return op.on ? 'Hid an object until an event shows it' : 'The object is there from the start';
    }
    case 'start': {
      story.start = JSON.parse(JSON.stringify(op.value || {}));
      return 'Changed how the hack starts';
    }
    case 'replace': {
      const s = ensureStory(JSON.parse(JSON.stringify(op.story || {})));
      for (const k of Object.keys(story)) delete story[k];
      Object.assign(story, s);
      return 'Replaced the story';
    }
    default: throw new Error('unknown story operation');
  }
}

// Every object a story refers to, by uid (for the "used by" lists and clean-ups).
export function storyRefs(story) {
  const refs = new Map();
  const add = (uid, what) => { if (!uid) return; uid = Number(uid); if (!refs.has(uid)) refs.set(uid, []); refs.get(uid).push(what); };
  for (const ev of story.events || []) {
    add(ev.trigger?.zone, ev.name);
    add(ev.trigger?.uid, ev.name);
    const walk = (list) => {
      for (const a of list || []) {
        for (const u of [].concat(a.uid || [])) add(u, ev.name);
        walk(a.then); walk(a.else);
      }
    };
    walk(ev.actions);
  }
  for (const uid of Object.keys(story.npcs || {})) add(uid, 'character');
  return refs;
}
