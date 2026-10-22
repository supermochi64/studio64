// The Story panel (top bar "Story", key Y): dialogs, characters, logic (When -> If -> Then events and
// variables), cutscenes, the game's own texts, and how the hack starts and ends.
import { icon } from '../icons.js';
import { askConfirm, askText, askChoice } from '../dialogs.js';
import { applyStoryOp, ensureStory, newStoryId, storyRefs } from './ops.js';
import { TRIGGERS, CONDITIONS, ACTIONS, STEPS, OPS, EASES, CAPS, MUSIC, CHARACTERS, describe } from './schema.js';
import { loadTexts, loadFont, texts, drawDialog, check, pages, dialogText, SPECIALS, VOICES, BOX_SPOTS, courseName } from './text.js';
import { objectPicture } from '../pictures.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const clone = (x) => JSON.parse(JSON.stringify(x));

export const SICONS = {
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
  talk: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  zone: '<path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  film: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cam: '<path d="M23 7l-7 5 7 5zM1 5h15v14H1z"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  dup: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};
export const sicon = (n, cls = 'sm') => `<svg class="i ${cls}" viewBox="0 0 24 24">${SICONS[n] || ''}</svg>`;

const TABS = [['dialogs', 'Dialogs', 'talk'], ['characters', 'Characters', 'person'], ['logic', 'Logic', 'bolt'], ['cutscenes', 'Cutscenes', 'film'], ['texts', 'Game texts', 'text'], ['start', 'Start & end', 'flag']];

export class StoryUI {
  constructor({ engine, studio, editor, world, runtime, send, toast, getStory, setStory, getLevels, getAudio, catalog, logic }) {
    Object.assign(this, { engine, studio, editor, world, runtime, send, toast, getStory, setStory, getLevels, getAudio, catalog, logic });
    window.addEventListener('pagehide', () => this.flush()); // text typed just before a reload is kept
    this.tab = 'dialogs';
    this.sel = {};             // selected item per tab
    this.textTab = 'dialogs';
    this.search = '';
    this.page = 0;
    this.sendTimers = new Map();
    this.sounds = [];
    fetch('data/sounds.json').then((r) => r.json()).then((s) => { this.sounds = s; }).catch(() => {});
    loadTexts().then(() => { if (this.isOpen()) this.render(); });
    loadFont().then(() => { if (this.isOpen()) this.render(); });
    this.build();
    runtime.on((what) => { if (this.isOpen() && (what === 'progress' || what === 'log') && this.tab === 'logic') this.renderDebug(); });
  }

  get story() { return ensureStory(this.getStory()); }
  isOpen() { return !$('#story-studio').hidden; }

  // ---- edits ------------------------------------------------------------------------------

  // Apply locally, tell the server (it saves and tells everyone else).
  op(op, { render = true, delay = 0 } = {}) {
    let summary = null;
    try { summary = applyStoryOp(this.story, op); } catch (err) { this.toast(err.message, 'x'); return null; }
    const key = delay ? `${op.op}|${op.coll || op.kind || ''}|${op.item?.id || op.key || op.uid || ''}` : null;
    if (key) {
      clearTimeout(this.sendTimers.get(key)?.t);
      this.sendTimers.set(key, { op, t: setTimeout(() => { this.sendTimers.delete(key); this.send({ type: 'story_op', ops: [op] }); }, delay) });
    } else {
      this.flush();
      this.send({ type: 'story_op', ops: [op] });
    }
    this.runtime.applyTexts();
    if (render) this.render();
    this.logic?.refresh();
    return summary;
  }
  // Send typed edits that are still waiting.
  flush() {
    const ops = [];
    for (const [, p] of this.sendTimers) { clearTimeout(p.t); ops.push(p.op); }
    this.sendTimers.clear();
    if (ops.length) this.send({ type: 'story_op', ops });
  }
  upsert(coll, item, opts) { return this.op({ op: 'upsert', coll, item }, opts); }

  // Someone else (or Claude) changed the story.
  remoteChanged() {
    if (!this.isOpen()) return;
    const a = document.activeElement;
    if (a && this.root.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { this.pendingRender = true; return; }
    this.render();
  }

  // ---- the window ---------------------------------------------------------------------------

  build() {
    const root = h('div', 'story-studio');
    root.id = 'story-studio';
    root.hidden = true;
    root.innerHTML = `<div class="st-window">
      <div class="st-head">
        <div class="st-title">${sicon('book', '')}Story</div>
        <div class="st-tabs">${TABS.map(([id, label, ic]) => `<button class="st-tab" data-tab="${id}">${sicon(ic)}<span>${label}</span></button>`).join('')}</div>
        <div class="st-spacer"></div>
        <button class="btn sm" data-act="play-start" title="Start the hack from the beginning with a fresh save">${icon('play', 'sm')}Play from start</button>
        <button class="btn icon ghost" data-act="close" title="Close (Esc)">${icon('x')}</button>
      </div>
      <div class="st-body"><aside class="st-side"></aside><section class="st-main"></section></div>
    </div>`;
    document.body.appendChild(root);
    this.root = root;
    root.querySelectorAll('.st-tab').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.search = ''; this.render(); }; });
    root.querySelector('[data-act=close]').onclick = () => this.close();
    root.querySelector('[data-act=play-start]').onclick = () => { this.close(); this.runtime.playFromStart(); this.toast('Playing from the start with a fresh save', 'play'); };
    root.addEventListener('mousedown', (e) => { if (e.target === root) this.close(); });
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && !/TEXTAREA/.test(document.activeElement?.tagName || '')) this.close();
      // Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) undo and redo story edits like any edit (outside text fields)
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && window.studio64Undo) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) window.studio64Undo.redoEdit(); else window.studio64Undo.undoHere();
      }
    });
    root.addEventListener('focusout', () => setTimeout(() => {
      if (this.pendingRender && !(document.activeElement && root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) {
        this.pendingRender = false;
        this.render();
      }
    }, 0));
  }

  open(tab = this.tab, id = null) {
    this.tab = tab;
    if (id) this.sel[tab] = id;
    const r = this.root;
    if (r.hidden) {
      r.hidden = false;
      this.wasBuilding = this.editor?.active;
      if (this.editor && !this.editor.active) this.editor.enter();
      this.engine.releaseKeys?.();
    }
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.flush();
    if (!this.wasBuilding && this.editor?.active) this.editor.exit();
  }

  render() {
    if (!this.root || this.root.hidden) return;
    this.root.querySelectorAll('.st-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    const side = $('.st-side', this.root), main = $('.st-main', this.root);
    const scroll = [side.scrollTop, main.scrollTop];
    side.innerHTML = '';
    main.innerHTML = '';
    side.hidden = false;
    ({ dialogs: () => this.renderDialogs(side, main), characters: () => this.renderCharacters(side, main), logic: () => this.renderLogic(side, main),
      cutscenes: () => this.renderCutscenes(side, main), texts: () => this.renderTexts(side, main), start: () => this.renderStart(side, main) })[this.tab]();
    side.scrollTop = scroll[0];
    main.scrollTop = scroll[1];
  }

  // ---- names of things (for lists and pickers) -----------------------------------------------

  levelName(key) {
    if (!key || key === 'any') return 'any level';
    if (String(key).startsWith('c:')) {
      // c:<id> (the level), c:<id>:<n> (one of its areas; 1 = the main area)
      const [id, n] = String(key).slice(2).split(':');
      const l = this.getLevels().find((x) => x.id === id);
      if (!l) return 'a custom level';
      if (!n) return l.name;
      const a = Number(n) === 1 ? { name: l.mainAreaName || 'Main area' } : (l.areas || []).find((x) => x.index === Number(n));
      return `${l.name} · ${a?.name || `area ${n}`}`;
    }
    const num = Number(String(key).split(':')[0]);
    for (const info of Object.values(this.catalog.levels || {})) if (info.num === num) return info.name;
    return `level ${num}`;
  }

  allRecords() {
    const out = [];
    for (const [key, a] of Object.entries(this.engine.patch.areas || {})) for (const r of a.objects || []) out.push({ key, r });
    return out;
  }
  recordOf(uid) { return this.allRecords().find((x) => x.r.uid === Number(uid)) || null; }
  recName(r) {
    if (!r) return 'a missing object';
    if (r.zone) return `zone “${r.zone.name || 'Zone'}”`;
    if (this.story.npcs?.[r.uid]?.name) return this.story.npcs[r.uid].name;
    if (r.star) return `star “${r.star.name}”`;
    if (r.block) return `${r.name || 'block'} #${String(r.uid).slice(-4)}`;
    return r.name || r.entry || 'object';
  }
  names() {
    const s = this.story;
    const obj = (uid) => { const x = this.recordOf(uid); return x ? this.recName(x.r) : uid ? 'a missing object' : '?'; };
    return {
      zone: obj, npc: obj, star: obj, object: obj,
      level: (k) => this.levelName(k),
      var: (id) => s.vars.find((v) => v.id === id)?.name || id || '?',
      dialog: (id) => { const d = s.dialogs.find((x) => x.id === id); if (d) return `“${d.name || 'dialog'}”`; if (/^game:\d+$/.test(id || '')) return `game dialog ${id.slice(5)}`; return '?'; },
      event: (id) => s.events.find((v) => v.id === id)?.name || '?',
      cutscene: (id) => s.cutscenes.find((v) => v.id === id)?.name || '?',
      entry: (id) => this.catalog.entries.find((e) => e.id === id)?.name || id || '?',
      music: (v) => { if (String(v).startsWith('song:')) return this.getAudio?.()?.songs?.find((x) => x.id === String(v).slice(5))?.name || 'a song'; return MUSIC.find((m) => m[0] === Number(v))?.[1] || `music ${v}`; },
      sound: (b) => this.sounds.find((x) => x.bits === Number(b))?.name || 'a sound',
    };
  }

  // ---- generic list ------------------------------------------------------------------------

  sideList(side, { title, items, selected, onPick, onNew, newLabel, render, empty }) {
    const head = h('div', 'st-side-head');
    head.innerHTML = `<div class="st-sec">${esc(title)}</div>`;
    if (onNew) {
      const b = h('button', 'btn sm st-new', `${icon('plus', 'sm')}${esc(newLabel || 'New')}`);
      b.onclick = onNew;
      head.appendChild(b);
    }
    side.appendChild(head);
    if (items.length > 8) {
      const s = h('div', 'lib-search st-search', `${icon('search', 'sm')}<input placeholder="Search…" spellcheck="false" value="${esc(this.search)}">`);
      const inp = s.querySelector('input');
      inp.oninput = () => { this.search = inp.value; this.filterList(list, inp.value); };
      side.appendChild(s);
    }
    const list = h('div', 'st-list');
    if (!items.length && empty) list.appendChild(h('div', 'st-empty-side', empty));
    for (const it of items) {
      const row = h('button', `st-row${it.id === selected ? ' active' : ''}`);
      row.dataset.search = (it.search || '').toLowerCase();
      row.innerHTML = render(it);
      row.onclick = () => onPick(it);
      list.appendChild(row);
    }
    side.appendChild(list);
    this.filterList(list, this.search);
    return list;
  }

  filterList(list, q) {
    const t = q.toLowerCase().trim();
    for (const r of list.children) if (r.dataset) r.hidden = !!t && !(r.dataset.search || '').includes(t);
  }

  emptyMain(main, title, sub, buttons = []) {
    const box = h('div', 'st-empty');
    box.innerHTML = `<div class="st-empty-title">${esc(title)}</div><div class="st-empty-sub">${sub}</div>`;
    const row = h('div', 'st-btns');
    for (const [label, fn, primary] of buttons) { const b = h('button', `btn${primary ? ' primary' : ''}`, label); b.onclick = fn; row.appendChild(b); }
    box.appendChild(row);
    main.appendChild(box);
  }

  // ======================================================================================
  // Dialogs

  newDialog(fields = {}) {
    const d = { id: newStoryId('dlg'), name: fields.name || `Dialog ${this.story.dialogs.length + 1}`, text: fields.text ?? 'Hello, Mario!', lines: 4, box: BOX_SPOTS.top_left, voice: 0, ...fields };
    this.upsert('dialogs', d, { render: false });
    return this.story.dialogs.find((x) => x.id === d.id);
  }

  renderDialogs(side, main) {
    const s = this.story;
    const refs = this.dialogUses();
    this.sideList(side, {
      title: 'Dialogs', newLabel: 'New dialog', selected: this.sel.dialogs,
      items: s.dialogs.map((d) => ({ ...d, search: `${d.name} ${d.text}` })),
      empty: 'Dialogs are what characters, signs and events say.',
      render: (d) => `<span class="st-ico">${sicon('talk')}</span><span class="st-text"><b>${esc(d.name)}</b><span>${esc((d.text || '').split('\n')[0])}</span></span>${refs.get(d.id)?.length ? `<span class="st-count" title="Used ${refs.get(d.id).length}×">${refs.get(d.id).length}</span>` : ''}`,
      onPick: (d) => { this.sel.dialogs = d.id; this.page = 0; this.render(); },
      onNew: () => { const d = this.newDialog(); this.sel.dialogs = d.id; this.page = 0; this.render(); setTimeout(() => $('.st-dlg-text', this.root)?.select(), 0); },
    });
    const d = s.dialogs.find((x) => x.id === this.sel.dialogs);
    if (!d) {
      this.emptyMain(main, 'Dialogs', 'Write what characters say, what signs read and what pops up during events. The preview shows it in the game\'s own font, box and page breaks; the text wraps by itself.', [
        ['New dialog', () => { const n = this.newDialog(); this.sel.dialogs = n.id; this.render(); }, true]]);
      return;
    }
    this.dialogEditor(main, d, {
      save: (patch, opts) => this.upsert('dialogs', { ...d, ...patch }, opts),
      uses: refs.get(d.id) || [],
      extra: [
        ['Duplicate', () => { const n = this.newDialog({ ...clone(d), id: undefined, num: undefined, name: `${d.name} copy` }); this.sel.dialogs = n.id; this.render(); }],
        ['Delete', async () => {
          if ((refs.get(d.id) || []).length && !(await askConfirm({ title: `Delete “${d.name}”?`, text: `It is used ${refs.get(d.id).length}× in your story.`, ok: 'Delete anyway', danger: true }))) return;
          this.op({ op: 'delete', coll: 'dialogs', id: d.id }); this.sel.dialogs = null; this.render();
        }, 'danger'],
      ],
    });
  }

  // Where each dialog is used (characters, events, cutscenes, start).
  dialogUses() {
    const s = this.story, m = new Map();
    const add = (id, what) => { if (!id) return; if (!m.has(id)) m.set(id, []); m.get(id).push(what); };
    for (const [uid, npc] of Object.entries(s.npcs || {})) for (const l of npc.lines || []) add(l.dialog, { kind: 'character', uid: Number(uid), label: npc.name || 'a character' });
    const walk = (list, ev) => { for (const a of list || []) { if (a.type === 'dialog') add(a.dialog, { kind: 'event', id: ev.id, label: ev.name }); walk(a.then, ev); walk(a.else, ev); } };
    for (const ev of s.events) walk(ev.actions, ev);
    for (const cs of s.cutscenes) for (const st of cs.steps || []) if (st.type === 'dialog') add(st.dialog, { kind: 'cutscene', id: cs.id, label: cs.name });
    if (s.start?.dialog) add(s.start.dialog, { kind: 'start', label: 'The opening' });
    return m;
  }

  // The dialog editor (project dialogs and the game's own).
  dialogEditor(main, d, { save, uses = [], extra = [], game = null }) {
    const wrapOn = d.wrap !== false && !game;
    const box = h('div', 'st-dialog');
    const spot = Object.entries(BOX_SPOTS).find(([, v]) => d.box && v[0] === d.box[0] && v[1] === d.box[1])?.[0] || (game ? 'custom' : 'top_left');
    box.innerHTML = `
      <div class="st-row2">
        ${game ? `<div class="st-gname"><b>${esc(game.title)}</b><span>${esc(game.sub || '')}</span></div>` : `<label class="st-field grow"><span>Name</span><input class="st-dlg-name" value="${esc(d.name)}" spellcheck="false"></label>`}
      </div>
      <div class="st-dlg-grid">
        <div class="st-dlg-edit">
          <div class="st-palette">${SPECIALS.map(([t, label]) => `<button class="st-glyph" data-ins="${esc(t)}" title="${esc(label)}">${esc(t)}</button>`).join('')}</div>
          <textarea class="st-dlg-text" spellcheck="true" rows="9" placeholder="What does it say?">${esc(d.text ?? '')}</textarea>
          <div class="st-issues"></div>
          <div class="st-opts">
            <label class="st-field"><span>Lines per box</span><select data-o="lines">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === (d.lines || 4) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            ${game ? '' : `<label class="st-field"><span>Box</span><select data-o="box">${[['top_left', 'Top left'], ['top', 'Top'], ['top_right', 'Top right'], ['middle', 'Middle']].map(([k, l]) => `<option value="${k}" ${k === spot ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
            <label class="st-field"><span>Voice</span><select data-o="voice">${VOICES.map((v, i) => `<option value="${i}" ${i === (d.voice | 0) ? 'selected' : ''}>${game && i === 0 ? 'The game\'s' : v}</option>`).join('')}</select></label>
            ${game ? '' : `<label class="st-check"><input type="checkbox" data-o="wrap" ${wrapOn ? 'checked' : ''}><span>Wrap lines by itself</span></label>`}
          </div>
          ${game ? '' : `<div class="st-opts">
            <label class="st-check"><input type="checkbox" data-o="question" ${d.question ? 'checked' : ''}><span>Ask a question (two answers)</span></label>
            <label class="st-field small" ${d.question ? '' : 'hidden'}><span>First answer</span><input data-o="yes" value="${esc(d.yes || 'Yes')}" maxlength="12"></label>
            <label class="st-field small" ${d.question ? '' : 'hidden'}><span>Second answer</span><input data-o="no" value="${esc(d.no || 'No')}" maxlength="12"></label>
          </div>`}
        </div>
        <div class="st-dlg-prev">
          <canvas class="st-prev-canvas"></canvas>
          <div class="st-pager"><button class="btn icon sm ghost" data-pg="-1">${sicon('up')}</button><span class="st-pg"></span><button class="btn icon sm ghost" data-pg="1">${sicon('down')}</button></div>
          <div class="st-prev-note">Exactly as the game draws it. ${pages(dialogText(d), d.lines || 4).length > 1 ? 'Players press A to see the next box.' : ''}</div>
        </div>
      </div>
      <div class="st-uses">${uses.length ? `<span>Used by</span>${uses.map((u) => `<button class="st-chip" data-use='${esc(JSON.stringify(u))}'>${esc(u.label)}</button>`).join('')}` : '<span class="st-faint">Not used yet: give it to a character or show it from an event.</span>'}</div>
      <div class="st-btns">
        <button class="btn sm primary" data-act="test">${icon('play', 'sm')}Show in game</button>
        ${extra.map(([label, , cls], i) => `<button class="btn sm ${cls || ''}" data-extra="${i}">${esc(label)}</button>`).join('')}
      </div>`;
    main.appendChild(box);
    const ta = $('.st-dlg-text', box);
    const canvas = $('.st-prev-canvas', box);
    let cur = clone(d);
    const draw = () => {
      if (!texts()) return;
      const show = game ? { ...cur, wrap: false, left: cur.left, top: cur.width } : { ...cur, left: (cur.box || BOX_SPOTS.top_left)[0], top: (cur.box || BOX_SPOTS.top_left)[1] };
      const n = pages(dialogText(show), cur.lines || 4).length;
      this.page = Math.max(0, Math.min(this.page, n - 1));
      drawDialog(canvas, show, this.page, { scale: 2, background: this.previewBg, kind: game?.kind });
      $('.st-pg', box).textContent = `Box ${this.page + 1} of ${n}`;
      const issues = check(game ? cur.text : dialogText(show), { lines: cur.lines || 4 });
      $('.st-issues', box).innerHTML = issues.map((i) => `<div class="st-issue ${i.level}">${esc(i.text)}</div>`).join('');
    };
    draw();
    const commit = (patch, delay = 400) => { Object.assign(cur, patch); draw(); save(patch, { render: false, delay }); };
    ta.oninput = () => commit({ text: ta.value });
    const nameInp = $('.st-dlg-name', box);
    if (nameInp) nameInp.oninput = () => commit({ name: nameInp.value });
    box.querySelectorAll('[data-o]').forEach((inp) => {
      inp.onchange = inp.oninput = () => {
        const k = inp.dataset.o;
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (k === 'lines' || k === 'voice') v = Number(v);
        if (k === 'box') v = BOX_SPOTS[v];
        if (k === 'question') box.querySelectorAll('.st-field.small').forEach((f) => { f.hidden = !v; });
        commit({ [k]: v });
      };
    });
    box.querySelectorAll('[data-ins]').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.ins;
        const a = ta.selectionStart, z = ta.selectionEnd;
        ta.value = ta.value.slice(0, a) + t + ta.value.slice(z);
        ta.selectionStart = ta.selectionEnd = a + t.length;
        ta.focus();
        commit({ text: ta.value });
      };
    });
    box.querySelectorAll('[data-pg]').forEach((b) => { b.onclick = () => { this.page += Number(b.dataset.pg); draw(); }; });
    $('[data-act=test]', box).onclick = () => this.testDialog(game ? game.num : d);
    box.querySelectorAll('[data-extra]').forEach((b) => { b.onclick = () => extra[Number(b.dataset.extra)][1](); });
    box.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => this.goUse(JSON.parse(b.dataset.use)); });
    // the preview's background: the game as it is right now
    if (!this.previewBg) {
      this.engine.captureFrame?.().then((c) => { this.previewBg = c; if (this.isOpen()) draw(); }).catch(() => {});
    }
  }

  goUse(u) {
    if (u.kind === 'character') { this.tab = 'characters'; this.sel.characters = u.uid; }
    else if (u.kind === 'event') { this.tab = 'logic'; this.sel.logic = u.id; }
    else if (u.kind === 'cutscene') { this.tab = 'cutscenes'; this.sel.cutscenes = u.id; }
    else if (u.kind === 'start') this.tab = 'start';
    this.render();
  }

  // Close the panel and show a dialog in the game.
  async testDialog(d) {
    const num = typeof d === 'number' ? d : this.story.dialogs.find((x) => x.id === d.id)?.num;
    if (num == null) return;
    this.flush();
    this.runtime.applyTexts(true);
    this.close();
    if (this.editor?.active) this.editor.exit();
    await new Promise((r) => setTimeout(r, 150));
    this.engine.M._studio_story_dialog(num);
    document.querySelector('#canvas')?.focus();
  }

  // ======================================================================================
  // Characters

  characters() {
    const out = [];
    for (const [uid, npc] of Object.entries(this.story.npcs || {})) {
      const x = this.recordOf(uid);
      out.push({ id: Number(uid), uid: Number(uid), npc, rec: x?.r, key: x?.key });
    }
    return out;
  }

  renderCharacters(side, main) {
    const list = this.characters();
    this.sideList(side, {
      title: 'Characters', newLabel: 'Add character', selected: this.sel.characters,
      items: list.map((c) => ({ ...c, search: `${c.npc.name} ${this.levelName(c.key)}` })),
      empty: 'Anyone Mario can talk to: Toads, Bob-omb Buddies, signs, Piantas or any model.',
      render: (c) => `<span class="st-ico">${sicon('person')}</span><span class="st-text"><b>${esc(c.npc.name || 'Character')}</b><span>${c.rec ? esc(this.levelName(c.key)) : '<em>object missing</em>'} · ${(c.npc.lines || []).length} line${(c.npc.lines || []).length === 1 ? '' : 's'}</span></span>`,
      onPick: (c) => { this.sel.characters = c.uid; this.render(); },
      onNew: (e) => this.characterMenu(e?.currentTarget || side),
    });
    const c = list.find((x) => x.uid === this.sel.characters);
    if (!c) {
      const box = h('div', 'st-empty');
      box.innerHTML = `<div class="st-empty-title">Characters</div><div class="st-empty-sub">Place someone for Mario to talk to. They turn to Mario, he presses B, and they say a dialog. Give them several lines that depend on what happened (flags, stars), and start events after the talk: give a star, open a gate, start a race.</div>`;
      const grid = h('div', 'st-char-grid');
      for (const ch of CHARACTERS) {
        const b = h('button', 'st-char', `<span class="st-char-name">${esc(ch.label)}</span>`);
        const thumb = this.thumbFor(ch);
        if (thumb) b.style.backgroundImage = `url("${thumb}")`;
        b.onclick = () => this.placeCharacter(ch);
        grid.appendChild(b);
      }
      box.appendChild(grid);
      box.appendChild(h('div', 'st-empty-sub', 'They appear in front of Mario in the level you are in. In build mode, the Logic tab places them where you point and you can make any object talk from its inspector.'));
      main.appendChild(box);
      return;
    }
    this.characterEditor(main, c);
  }

  thumbFor(ch) {
    const id = ch.entry || ch.model;
    return objectPicture(id); // (null until the setup has made it: the card shows its name only)
  }

  characterMenu(anchor) {
    const m = h('div', 'menu floating st-menu');
    for (const ch of CHARACTERS) {
      const b = h('button', 'menu-item', esc(ch.label));
      b.onclick = () => { m.remove(); this.placeCharacter(ch); };
      m.appendChild(b);
    }
    this.popMenu(m, anchor);
  }

  popMenu(m, anchor) {
    document.querySelectorAll('.st-menu').forEach((x) => x.remove());
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = `${Math.min(r.left, innerWidth - 240)}px`;
    m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }

  // A new character in front of Mario (or at the build-mode view center), saved and talking.
  placeCharacter(ch, where = null) {
    const rec = this.logic?.characterRecord(ch, where);
    if (!rec) { this.toast('Go into a level first', 'x'); return null; }
    const d = this.newDialog({ name: `${ch.label}: hello`, text: ch.sign ? 'Welcome! This sign was written in the Story panel.' : `Hi, Mario! I'm a ${ch.label}. Isn't it a lovely day?` });
    this.op({ op: 'npc', uid: rec.uid, value: { name: ch.label, kind: ch.id, lines: [{ dialog: d.id, if: [] }] } }, { render: false });
    this.sel.characters = rec.uid;
    this.tab = 'characters';
    this.render();
    this.toast(`${ch.label} placed. Write what they say.`, 'check');
    return rec;
  }

  characterEditor(main, c) {
    const npc = clone(c.npc);
    const save = (opts) => this.op({ op: 'npc', uid: c.uid, value: npc }, opts);
    const box = h('div', 'st-card-list');
    box.innerHTML = `<div class="st-row2"><label class="st-field grow"><span>Name</span><input class="st-npc-name" value="${esc(npc.name || '')}"></label>
      <div class="st-btns tight"><button class="btn sm" data-act="go">${sicon('target')}Show in level</button><button class="btn sm danger" data-act="del">Stop talking</button></div></div>
      ${c.rec ? `<div class="st-note">${esc(this.recName(c.rec))} in ${esc(this.levelName(c.key))}.</div>` : '<div class="st-issue error">Its object was deleted. Place it again or remove this character.</div>'}
      <div class="st-h">What they say <span class="st-faint">· the first line whose conditions are true</span></div>`;
    main.appendChild(box);
    $('.st-npc-name', box).oninput = (e) => { npc.name = e.target.value; save({ render: false, delay: 400 }); };
    $('[data-act=go]', box).onclick = () => this.goToObject(c.uid);
    $('[data-act=del]', box).onclick = async () => { if (await askConfirm({ title: 'Remove what this character says?', text: 'The object stays in the level.', ok: 'Remove', danger: true })) { this.op({ op: 'npc', uid: c.uid, value: null }); this.sel.characters = null; this.render(); } };
    (npc.lines ||= []).forEach((line, i) => {
      const card = h('div', 'st-card');
      const head = h('div', 'st-card-head');
      head.innerHTML = `<span class="st-badge">${i + 1}</span><span class="st-card-title">${line.if?.length ? 'If …' : i === npc.lines.length - 1 && i > 0 ? 'Otherwise' : 'Always'}</span>`;
      const tools = this.rowTools(npc.lines, i, () => save());
      head.appendChild(tools);
      card.appendChild(head);
      card.appendChild(this.dialogPicker(line.dialog, (v) => { line.dialog = v; save(); }, `${npc.name || 'Character'}: line ${i + 1}`));
      card.appendChild(this.condList(line.if ||= [], () => save(), 'Only if'));
      box.appendChild(card);
    });
    const add = h('button', 'btn sm st-add', `${icon('plus', 'sm')}Add a line`);
    add.onclick = () => {
      const d = this.newDialog({ name: `${npc.name || 'Character'}: line ${npc.lines.length + 1}`, text: 'Thanks for your help, Mario!' });
      npc.lines.unshift({ dialog: d.id, if: [{ type: 'flag', var: this.story.vars.find((v) => v.kind === 'flag')?.id || '', value: true }] });
      save();
    };
    box.appendChild(add);
    // events after the talk
    const evs = this.story.events.filter((ev) => ev.trigger?.type === 'talk' && Number(ev.trigger.uid) === c.uid);
    const sec = h('div', 'st-h', `After talking <span class="st-faint">· events that start when the talk ends</span>`);
    box.appendChild(sec);
    for (const ev of evs) {
      const b = h('button', 'st-evlink', `${sicon('bolt')}<b>${esc(ev.name)}</b><span>${esc((ev.actions || []).map((a) => describe('action', a, this.names())).join(', ') || 'nothing yet')}</span>`);
      b.onclick = () => { this.tab = 'logic'; this.sel.logic = ev.id; this.render(); };
      box.appendChild(b);
    }
    const row = h('div', 'st-btns');
    for (const [label, actions] of [['Give a star', [{ type: 'give_star', uid: null, at: 'mario' }]], ['Give coins', [{ type: 'coins', amount: 10 }]], ['Give a cap', [{ type: 'cap', cap: 'wing' }]], ['Open something', [{ type: 'open_door', uid: null }]], ['Other…', []]]) {
      const b = h('button', 'btn sm', `${icon('plus', 'sm')}${label}`);
      b.onclick = () => {
        const ev = { id: newStoryId('ev'), name: `After talking to ${npc.name || 'the character'}`, repeat: 'once', trigger: { type: 'talk', uid: c.uid }, conditions: [], actions };
        this.upsert('events', ev, { render: false });
        this.tab = 'logic';
        this.sel.logic = ev.id;
        this.render();
      };
      row.appendChild(b);
    }
    box.appendChild(row);
  }

  // Go to the level of an object, build mode, camera on it.
  async goToObject(uid) {
    const x = this.recordOf(uid);
    if (!x) return;
    this.close();
    await this.logic?.focusRecord(x.key, x.r);
  }

  // ======================================================================================
  // Logic: events + variables

  renderLogic(side, main) {
    const s = this.story;
    const names = this.names();
    const list = this.sideList(side, {
      title: 'Events', newLabel: 'New event', selected: this.sel.logic,
      items: s.events.map((ev) => ({ ...ev, search: `${ev.name} ${describe('trigger', ev.trigger, names)}` })),
      empty: 'Events make things happen: When something happens → If conditions hold → Then do actions.',
      render: (ev) => `<span class="st-ico ${ev.enabled === false ? 'off' : ''}">${sicon('bolt')}</span><span class="st-text"><b>${esc(ev.name)}</b><span>${esc(describe('trigger', ev.trigger, names))}</span></span>${this.runtime.progress.done[ev.id] ? '<span class="st-done" title="Happened in this save">✓</span>' : ''}`,
      onPick: (ev) => { this.sel.logic = ev.id; this.render(); },
      onNew: () => { const ev = this.newEvent(); this.sel.logic = ev.id; this.render(); },
    });
    list.classList.add('events');
    // variables
    const vh = h('div', 'st-side-head');
    vh.innerHTML = '<div class="st-sec">Variables</div>';
    const addFlag = h('button', 'btn sm st-new', `${icon('plus', 'sm')}Flag`);
    addFlag.title = 'A yes/no variable (met Toad, gate open, …)';
    addFlag.onclick = () => { this.newVar('flag'); this.render(); };
    const addCtr = h('button', 'btn sm st-new', `${icon('plus', 'sm')}Counter`);
    addCtr.title = 'A number (keys found, quests done, …)';
    addCtr.onclick = () => { this.newVar('counter'); this.render(); };
    vh.append(addFlag, addCtr);
    side.appendChild(vh);
    const vl = h('div', 'st-vars');
    if (!s.vars.length) vl.appendChild(h('div', 'st-empty-side', 'Flags and counters remember progress in the save file.'));
    for (const v of s.vars) {
      const row = h('div', 'st-var');
      row.innerHTML = `<span class="st-vk ${esc(v.kind)}">${v.kind === 'flag' ? 'flag' : '123'}</span><input value="${esc(v.name)}" spellcheck="false"><span class="st-vv" title="Value in this save"></span><button class="st-x" title="Delete">${icon('x', 'sm')}</button>`;
      const inp = row.querySelector('input');
      inp.onchange = () => { this.upsert('vars', { ...v, name: inp.value.trim() || v.name }, { render: false }); };
      row.querySelector('.st-x').onclick = async () => { if (await askConfirm({ title: `Delete ${v.name}?`, ok: 'Delete', danger: true })) { this.op({ op: 'delete', coll: 'vars', id: v.id }); } };
      row.querySelector('.st-vv').onclick = () => {
        const cur = this.runtime.getVar(v.id);
        if (v.kind === 'flag') this.runtime.setVar(v.id, !cur);
        else { askText({ title: `Set ${v.name}`, value: String(cur), type: 'number', ok: 'Set' }).then((n) => { if (n !== null) this.runtime.setVar(v.id, Number(n) || 0); }); }
        this.renderDebug();
      };
      vl.appendChild(row);
    }
    side.appendChild(vl);
    const dbg = h('div', 'st-debug');
    side.appendChild(dbg);
    this.renderDebug();
    const ev = s.events.find((x) => x.id === this.sel.logic);
    if (!ev) {
      this.emptyMain(main, 'Logic', 'Events are the heart of a story. Each one is <b>When</b> something happens (Mario enters a zone, talks to someone, collects a star, defeats an enemy, presses a switch, time passes…) → <b>If</b> some conditions hold (a flag is set, enough stars…) → <b>Then</b> actions run one after another (dialogs, set flags, open a gate, give a star, play a cutscene, warp…). Progress is saved per save file.', [
        ['New event', () => { const e = this.newEvent(); this.sel.logic = e.id; this.render(); }, true],
        ['Zone that shows a dialog', () => this.logic?.quickZoneEvent()],
      ]);
      return;
    }
    this.eventEditor(main, ev);
  }

  renderDebug() {
    const dbg = $('.st-debug', this.root);
    if (!dbg) return;
    const s = this.story;
    this.root.querySelectorAll('.st-var').forEach((row, i) => {
      const v = s.vars[i];
      if (!v) return;
      const val = this.runtime.getVar(v.id);
      const span = row.querySelector('.st-vv');
      span.textContent = typeof val === 'boolean' ? (val ? 'on' : 'off') : String(val);
      span.classList.toggle('on', !!val);
    });
    const log = this.runtime.log.slice(-6).reverse();
    dbg.innerHTML = `<div class="st-sec">This save <button class="btn sm ghost st-reset" title="Forget all story progress (flags, counters, finished events, shown/removed objects)">${sicon('restart')}Reset</button></div>
      <div class="st-log">${log.map((l) => `<div>${esc(l.text)}</div>`).join('') || '<div class="st-faint">Nothing happened yet. Play to see events here.</div>'}</div>`;
    dbg.querySelector('.st-reset').onclick = async () => { if (await askConfirm({ title: 'Reset the story progress?', text: 'Flags, counters and seen events of this save start over.', ok: 'Reset', danger: true })) { this.runtime.resetProgress(); this.render(); } };
  }

  newVar(kind, name) {
    const n = this.story.vars.filter((v) => v.kind === kind).length + 1;
    const v = { id: newStoryId('var'), name: name || (kind === 'flag' ? `flag ${n}` : `counter ${n}`), kind, initial: kind === 'flag' ? false : 0 };
    this.upsert('vars', v, { render: false });
    return v;
  }

  newEvent(fields = {}) {
    const ev = { id: newStoryId('ev'), name: fields.name || `Event ${this.story.events.length + 1}`, enabled: true, repeat: 'once', trigger: { type: 'enter_zone' }, conditions: [], actions: [], ...fields };
    this.upsert('events', ev, { render: false });
    return this.story.events.find((x) => x.id === ev.id);
  }

  eventEditor(main, ev0) {
    const ev = clone(ev0);
    const save = (render = true) => this.upsert('events', ev, { render, delay: render ? 0 : 400 });
    const top = h('div', 'st-row2');
    top.innerHTML = `<label class="st-field grow"><span>Name</span><input class="st-ev-name" value="${esc(ev.name)}"></label>
      <label class="st-field"><span>Happens</span><select data-k="repeat">
        <option value="once" ${ev.repeat === 'once' ? 'selected' : ''}>Once per save</option>
        <option value="visit" ${ev.repeat === 'visit' ? 'selected' : ''}>Once per level visit</option>
        <option value="always" ${ev.repeat === 'always' ? 'selected' : ''}>Every time</option></select></label>
      <label class="st-field"><span>Only in</span>${this.levelSelectHtml(ev.level || '', true)}</label>
      <label class="st-check"><input type="checkbox" data-k="enabled" ${ev.enabled !== false ? 'checked' : ''}><span>On</span></label>`;
    main.appendChild(top);
    $('.st-ev-name', top).oninput = (e) => { ev.name = e.target.value; save(false); };
    top.querySelector('[data-k=repeat]').onchange = (e) => { ev.repeat = e.target.value; save(); };
    top.querySelector('[data-k=enabled]').onchange = (e) => { ev.enabled = e.target.checked; save(); };
    top.querySelector('select.st-level').onchange = (e) => { ev.level = e.target.value || undefined; save(); };
    // WHEN
    const when = h('div', 'st-block when');
    when.innerHTML = `<div class="st-block-head"><span class="st-kw">When</span></div>`;
    const tsel = h('select', 'st-type');
    tsel.innerHTML = Object.entries(TRIGGERS).map(([k, v]) => `<option value="${k}" ${k === ev.trigger?.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    tsel.onchange = () => { ev.trigger = { type: tsel.value }; save(); };
    when.querySelector('.st-block-head').appendChild(tsel);
    when.appendChild(this.fieldsFor(TRIGGERS[ev.trigger?.type]?.fields || [], ev.trigger, () => save()));
    main.appendChild(when);
    // IF
    const iff = h('div', 'st-block if');
    iff.innerHTML = `<div class="st-block-head"><span class="st-kw">If</span><span class="st-faint">${ev.conditions?.length ? 'all of these are true' : 'no conditions: always'}</span></div>`;
    iff.appendChild(this.condList(ev.conditions ||= [], () => save(), null));
    main.appendChild(iff);
    // THEN
    const then = h('div', 'st-block then');
    then.innerHTML = `<div class="st-block-head"><span class="st-kw">Then</span><span class="st-faint">one after another</span></div>`;
    then.appendChild(this.actionList(ev.actions ||= [], () => save()));
    main.appendChild(then);
    const btns = h('div', 'st-btns');
    btns.innerHTML = `<button class="btn sm primary" data-a="test">${icon('play', 'sm')}Test now</button>
      <button class="btn sm" data-a="dup">${sicon('dup')}Duplicate</button>
      <button class="btn sm" data-a="again" ${this.runtime.progress.done[ev.id] ? '' : 'hidden'}>${sicon('restart')}Let it happen again</button>
      <button class="btn sm danger" data-a="del">Delete</button>`;
    main.appendChild(btns);
    btns.querySelector('[data-a=test]').onclick = () => { this.close(); if (this.editor?.active) this.editor.exit(); setTimeout(() => this.runtime.test(ev), 120); };
    btns.querySelector('[data-a=dup]').onclick = () => { const n = this.newEvent({ ...clone(ev), id: newStoryId('ev'), name: `${ev.name} copy` }); this.sel.logic = n.id; this.render(); };
    btns.querySelector('[data-a=again]').onclick = () => { delete this.runtime.progress.done[ev.id]; this.runtime.save(); this.render(); };
    btns.querySelector('[data-a=del]').onclick = async () => { if (await askConfirm({ title: `Delete “${ev.name}”?`, ok: 'Delete', danger: true })) { this.op({ op: 'delete', coll: 'events', id: ev.id }); this.sel.logic = null; this.render(); } };
  }

  rowTools(list, i, save) {
    const t = h('span', 'st-tools');
    t.innerHTML = `<button title="Move up" ${i === 0 ? 'disabled' : ''}>${sicon('up')}</button><button title="Move down" ${i === list.length - 1 ? 'disabled' : ''}>${sicon('down')}</button><button title="Remove">${icon('x', 'sm')}</button>`;
    const [up, down, del] = t.querySelectorAll('button');
    up.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); };
    down.onclick = () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; save(); };
    del.onclick = () => { list.splice(i, 1); save(); };
    return t;
  }

  condList(conds, save, label) {
    const box = h('div', 'st-conds');
    if (label && conds.length) box.appendChild(h('div', 'st-faint st-small', label));
    conds.forEach((c, i) => {
      const row = h('div', 'st-line');
      const sel = h('select', 'st-type');
      sel.innerHTML = Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}" ${k === c.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
      sel.onchange = () => { conds[i] = { type: sel.value }; save(); };
      row.appendChild(sel);
      row.appendChild(this.fieldsFor(CONDITIONS[c.type]?.fields || [], c, save));
      row.appendChild(this.rowTools(conds, i, save));
      box.appendChild(row);
    });
    const add = h('button', 'btn sm ghost st-add', `${icon('plus', 'sm')}${label ? 'Add a condition' : 'Add a condition'}`);
    add.onclick = () => { conds.push({ type: this.story.vars.some((v) => v.kind === 'flag') ? 'flag' : 'stars', op: '>=', value: this.story.vars.some((v) => v.kind === 'flag') ? true : 1, var: this.story.vars.find((v) => v.kind === 'flag')?.id }); save(); };
    box.appendChild(add);
    return box;
  }

  actionList(actions, save, depth = 0) {
    const box = h('div', 'st-actions');
    const names = this.names();
    actions.forEach((a, i) => {
      const card = h('div', `st-action ${a.type === 'if' ? 'is-if' : ''}`);
      const head = h('div', 'st-action-head');
      head.innerHTML = `<span class="st-num">${i + 1}</span>`;
      const sel = h('select', 'st-type');
      sel.innerHTML = this.actionOptions(a.type);
      sel.onchange = () => { actions[i] = this.defaultAction(sel.value); save(); };
      head.appendChild(sel);
      head.appendChild(this.rowTools(actions, i, save));
      card.appendChild(head);
      if (a.type === 'if') {
        const ans = h('label', 'st-field small');
        ans.innerHTML = `<span>Answer of the last question</span><select><option value="">any</option><option value="yes" ${a.answer === 'yes' ? 'selected' : ''}>first choice</option><option value="no" ${a.answer === 'no' ? 'selected' : ''}>second choice</option></select>`;
        ans.querySelector('select').onchange = (e) => { a.answer = e.target.value || undefined; save(); };
        card.appendChild(ans);
        card.appendChild(this.condList(a.conditions ||= [], save, 'If'));
        const t = h('div', 'st-branch', '<div class="st-kw small">Then</div>');
        t.appendChild(this.actionList(a.then ||= [], save, depth + 1));
        const e = h('div', 'st-branch', '<div class="st-kw small">Else</div>');
        e.appendChild(this.actionList(a.else ||= [], save, depth + 1));
        card.append(t, e);
      } else {
        card.appendChild(this.fieldsFor(ACTIONS[a.type]?.fields || [], a, save, { action: true }));
      }
      card.title = describe('action', a, names);
      box.appendChild(card);
    });
    const add = h('div', 'st-add-row');
    const sel = h('select', 'st-type st-add-sel');
    sel.innerHTML = `<option value="">＋ Add an action…</option>${this.actionOptions('')}`;
    sel.onchange = () => { if (sel.value) { actions.push(this.defaultAction(sel.value)); save(); } };
    add.appendChild(sel);
    box.appendChild(add);
    return box;
  }

  actionOptions(cur) {
    const groups = {};
    for (const [k, v] of Object.entries(ACTIONS)) (groups[v.group] ||= []).push([k, v]);
    return Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</optgroup>`).join('');
  }

  defaultAction(type) {
    const s = this.story;
    switch (type) {
      case 'dialog': return { type, dialog: s.dialogs[s.dialogs.length - 1]?.id || '' };
      case 'set_flag': return { type, var: s.vars.find((v) => v.kind === 'flag')?.id || '', value: 'true' };
      case 'set_var': return { type, var: s.vars.find((v) => v.kind === 'counter')?.id || '', op: 'add', value: 1 };
      case 'coins': return { type, amount: 10 };
      case 'lives': return { type, amount: 1 };
      case 'health': return { type, amount: 8 };
      case 'cap': return { type, cap: 'wing', seconds: 0 };
      case 'wait': return { type, seconds: 1 };
      case 'caption': return { type, text: 'A new path has opened!', seconds: 3 };
      case 'spawn': return { type, entry: 'yellow_coin', count: 5, at: 'mario' };
      case 'give_star': return { type, at: 'mario' };
      case 'timer': return { type, op: 'start' };
      case 'shake': return { type, strength: 'small' };
      case 'if': return { type, conditions: [], then: [], else: [] };
      case 'cutscene': return { type, cutscene: s.cutscenes[0]?.id || '' };
      default: return { type };
    }
  }

  // ---- fields --------------------------------------------------------------------------------

  fieldsFor(fields, obj, save, { action = false } = {}) {
    const box = h('div', 'st-fields');
    for (const [key, kind, label] of fields) {
      const f = h('label', `st-field ${kind === 'text' ? 'grow' : ''}`);
      if (label) f.appendChild(h('span', '', esc(label)));
      f.appendChild(this.input(kind, key, obj, save));
      box.appendChild(f);
    }
    return box;
  }

  input(kind, key, obj, save) {
    const s = this.story;
    const set = (v, re = true) => { if (v === '' || v == null) delete obj[key]; else obj[key] = v; save(re); };
    const select = (opts, cur, extra = '') => {
      const el = h('select');
      el.innerHTML = extra + opts.map(([v, l, g]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
      return el;
    };
    const objectOpts = (filter) => {
      const groups = new Map();
      for (const { key: k, r } of this.allRecords()) {
        if (!filter(r)) continue;
        const g = this.levelName(k);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push([r.uid, this.recName(r)]);
      }
      return groups;
    };
    const groupedSelect = (groups, cur, none, pickKind) => {
      const wrap = h('span', 'st-pickwrap');
      const el = h('select');
      let html = `<option value="">${esc(none)}</option>`;
      let found = false;
      for (const [g, list] of groups) {
        html += `<optgroup label="${esc(g)}">${list.map(([v, l]) => { if (Number(v) === Number(cur)) found = true; return `<option value="${v}" ${Number(v) === Number(cur) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</optgroup>`;
      }
      if (cur && !found) html += `<option value="${cur}" selected>missing object</option>`;
      el.innerHTML = html;
      el.onchange = () => set(el.value ? Number(el.value) : '');
      wrap.appendChild(el);
      if (this.logic && pickKind) {
        const pick = h('button', 'btn icon sm ghost st-pick', sicon('target'));
        pick.title = 'Pick it in the level (build mode)';
        pick.onclick = (e) => {
          e.preventDefault();
          this.pickInWorld(pickKind, (uid) => { obj[key] = uid; save(); });
        };
        wrap.appendChild(pick);
      }
      return wrap;
    };
    let el;
    switch (kind) {
      case 'zone': return groupedSelect(objectOpts((r) => r.zone), obj[key], 'Pick a zone…', 'zone');
      case 'npc': return groupedSelect(objectOpts((r) => s.npcs?.[r.uid]), obj[key], 'Any character', 'object');
      case 'star': return groupedSelect(objectOpts((r) => r.star || r.entry === 'star' || r.entry === 'hidden_red_coin_star'), obj[key], kind === 'star' && key === 'uid' && obj.type === 'star' ? 'Any star' : 'Pick a star…', 'object');
      case 'object': return groupedSelect(objectOpts((r) => !r.zone || r.warp), obj[key], 'Pick an object…', 'object');
      case 'warpobj': return groupedSelect(objectOpts((r) => r.warp && r.warp.kind !== 'arrival'), obj[key], 'Pick a door or warp…', 'object');
      case 'arrival': {
        // a door, pipe or arrival point in the chosen area (Mario comes out of it); else its start
        const lv = obj.custom ? `c:${obj.custom}${obj.area > 1 ? `:${obj.area}` : ''}` : String(obj.level ?? '');
        const want = /^c:[^:]+:1$/.test(lv) ? lv.slice(0, -2) : /^\d+$/.test(lv) ? `${lv}:1` : lv;
        const list = this.allRecords().filter(({ key: k, r }) => k === want && r.warp && ['door', 'pipe', 'arrival'].includes(r.warp.kind))
          .map(({ r }) => [r.uid, `${r.warp.kind === 'arrival' ? 'Arrival point' : r.warp.kind === 'pipe' ? 'Pipe' : 'Door'}: ${this.recName(r)}`]);
        el = select(list, obj[key], `<option value="">${lv ? 'The area\'s start' : 'Pick the level first'}</option>`);
        el.onchange = () => set(el.value ? Number(el.value) : '');
        return el;
      }
      case 'number': case 'seconds': {
        el = h('input');
        el.type = 'number';
        el.step = kind === 'seconds' ? '0.5' : '1';
        el.value = obj[key] ?? '';
        el.oninput = () => set(el.value === '' ? '' : Number(el.value), false);
        el.onchange = () => set(el.value === '' ? '' : Number(el.value));
        return el;
      }
      case 'text': case 'color': {
        el = h('input');
        if (kind === 'color') el.type = 'color';
        el.value = obj[key] ?? (kind === 'color' ? '#000000' : '');
        el.oninput = () => set(el.value, false);
        return el;
      }
      case 'bool': {
        el = select([['true', 'yes'], ['false', 'no']], obj[key] === false ? 'false' : 'true');
        el.onchange = () => set(el.value === 'true');
        return el;
      }
      case 'answer': el = select([['', 'any answer'], ['yes', 'first choice'], ['no', 'second choice']], obj[key]); break;
      case 'op': el = select(OPS.map((o) => [o, { '>=': 'at least', '>': 'more than', '==': 'exactly', '!=': 'not', '<': 'less than', '<=': 'at most' }[o]]), obj[key] || '>='); break;
      case 'ease': el = select(EASES.map((e) => [e, e]), obj[key] || 'smooth'); break;
      case 'cap': el = select(CAPS.map((c) => [c, `${c} cap`]), obj[key] || 'wing'); break;
      case 'value': {
        el = h('input');
        el.value = obj[key] ?? '';
        el.placeholder = 'true / 3';
        el.onchange = () => {
          const v = el.value.trim();
          // "abc" would be saved as NaN (null): a value is a number, true or false
          if (v !== 'true' && v !== 'false' && (v === '' || !Number.isFinite(Number(v)))) { el.value = obj[key] ?? ''; this.toast('A value is a number, true or false', 'x'); return; }
          set(v === 'true' ? true : v === 'false' ? false : Number(v));
        };
        return el;
      }
      case 'level': {
        el = h('span');
        el.innerHTML = this.levelSelectHtml(obj.custom ? `c:${obj.custom}${obj.area > 1 ? `:${obj.area}` : ''}` : obj[key] ?? '', true);
        const sel2 = el.querySelector('select');
        sel2.onchange = () => { delete obj.custom; delete obj.area; if (obj.type === 'warp') delete obj.uid; set(sel2.value); };
        return el;
      }
      case 'var': case 'flagvar': {
        const opts = s.vars.filter((v) => kind !== 'flagvar' || v.kind === 'flag').map((v) => [v.id, `${v.name}${v.kind === 'flag' ? '' : ' (counter)'}`]);
        el = select(opts, obj[key], `<option value="">${kind === 'flagvar' && key === 'answer_var' ? '—' : 'Pick…'}</option>`);
        el.innerHTML += `<option value="__new">＋ New ${kind === 'flagvar' ? 'flag' : 'variable'}…</option>`;
        el.onchange = async () => {
          if (el.value === '__new') {
            const name = await askText({ title: kind === 'flagvar' ? 'New flag' : 'New variable', placeholder: kind === 'flagvar' ? 'e.g. met the Toad' : 'e.g. coins given', ok: 'Create' });
            if (!name) { save(); return; }
            const vk = kind === 'flagvar' ? 'flag' : await askChoice({ title: `What is “${name}”?`, choices: [{ id: 'flag', label: 'A yes/no flag', sub: 'On or off, like “met the Toad”' }, { id: 'counter', label: 'A counter', sub: 'A number, like coins given' }] });
            if (!vk) { save(); return; }
            const v = this.newVar(vk, name);
            set(v.id);
          } else set(el.value);
        };
        return el;
      }
      case 'dialog': return this.dialogPicker(obj[key], (v) => set(v), obj.type === 'dialog' ? 'Event dialog' : 'Dialog');
      case 'cutscene': {
        el = select(s.cutscenes.map((c) => [c.id, c.name]), obj[key], '<option value="">Pick…</option>');
        el.innerHTML += '<option value="__new">＋ New cutscene…</option>';
        el.onchange = () => {
          if (el.value === '__new') { const c = this.newCutscene(); set(c.id); } else set(el.value);
        };
        return el;
      }
      case 'event': el = select(s.events.map((e) => [e.id, e.name]), obj[key], '<option value="">Pick…</option>'); break;
      case 'entry': {
        el = h('input');
        el.setAttribute('list', 'st-entries');
        el.value = this.catalog.entries.find((e) => e.id === obj[key])?.name || obj[key] || '';
        el.placeholder = 'Search objects…';
        this.ensureEntryList();
        el.onchange = () => {
          const e = this.catalog.entries.find((x) => x.name === el.value || x.id === el.value);
          if (e) set(e.id);
        };
        return el;
      }
      case 'music': {
        const songs = (this.getAudio?.()?.songs || []).map((x) => [`song:${x.id}`, `♪ ${x.name}`]);
        el = select([...songs, ...MUSIC.map(([n, l]) => [n, l])], obj.song ? `song:${obj.song}` : obj[key], '<option value="">Pick…</option>');
        el.onchange = () => { delete obj.song; set(el.value === '' ? '' : el.value.startsWith('song:') ? el.value : Number(el.value)); };
        return el;
      }
      case 'sound': {
        el = select(this.sounds.map((x) => [x.bits, `${x.group}: ${x.name}`]), obj[key], '<option value="">Pick…</option>');
        el.onchange = () => { set(el.value === '' ? '' : Number(el.value)); if (el.value) this.engine.playGameSound(Number(el.value)); };
        return el;
      }
      case 'where': {
        el = h('span', 'st-where');
        const cur = obj[key] ?? 'mario';
        const sel2 = select([['mario', 'In front of Mario'], ...[...objectOpts((r) => r.zone)].flatMap(([g, l]) => l.map(([v, n]) => [String(v), `${n} (${g})`])), ['pos', 'At a position…']],
          typeof cur === 'object' ? 'pos' : String(cur));
        sel2.onchange = () => {
          if (sel2.value === 'pos') { obj[key] = this.marioPos() || { x: 0, y: 0, z: 0 }; save(); } else set(sel2.value === 'mario' ? 'mario' : Number(sel2.value));
        };
        el.appendChild(sel2);
        if (typeof cur === 'object') el.appendChild(this.posInput(cur, (p) => { obj[key] = p; save(); }));
        return el;
      }
      case 'pos': return this.posInput(obj[key], (p) => set(p));
      default:
        if (kind.startsWith('choice:')) { el = select(kind.slice(7).split('|').map((x) => [x, x]), String(obj[key] ?? kind.slice(7).split('|')[0])); break; }
        el = h('input');
        el.value = obj[key] ?? '';
        el.onchange = () => set(el.value);
        return el;
    }
    el.onchange = () => set(el.value);
    return el;
  }

  ensureEntryList() {
    if ($('#st-entries')) return;
    const dl = h('datalist');
    dl.id = 'st-entries';
    dl.innerHTML = this.catalog.entries.map((e) => `<option value="${esc(e.name)}"></option>`).join('');
    document.body.appendChild(dl);
  }

  levelSelectHtml(cur, anyOption) {
    const opts = [];
    if (anyOption) opts.push(['', 'Any level']);
    for (const l of this.getLevels()) {
      const areas = (l.areas || []).slice().sort((a, b) => a.index - b.index);
      opts.push([`c:${l.id}`, `★ ${l.name}${areas.length ? (anyOption ? ' (any area)' : '') : ''}`]);
      // sub-areas (inside a building, a cave): c:<id>:<n>; c:<id>:1 = only the main area
      if (areas.length) {
        if (anyOption) opts.push([`c:${l.id}:1`, `      ${l.name} · ${l.mainAreaName || 'Main area'}`]);
        for (const a of areas) opts.push([`c:${l.id}:${a.index}`, `      ${l.name} · ${a.name || `Area ${a.index}`}`]);
      }
    }
    for (const info of Object.values(this.catalog.levels || {}).sort((a, b) => a.num - b.num)) if (info.num) opts.push([String(info.num), info.name]);
    return `<select class="st-level">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }

  marioPos() {
    try {
      const m = this.engine.state().mario;
      return m ? { x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z), yaw: Math.round(((m.yaw & 0xffff) / 65536) * 360) } : null;
    } catch { return null; }
  }

  posInput(p, onChange) {
    const box = h('span', 'st-pos');
    const cur = p || {};
    box.innerHTML = `${['x', 'y', 'z'].map((k) => `<input type="number" data-k="${k}" value="${cur[k] ?? ''}" placeholder="${k}">`).join('')}<button class="btn sm ghost" title="Use Mario's position">${sicon('person')}Mario</button>`;
    box.querySelectorAll('input').forEach((inp) => {
      inp.onchange = () => {
        if (inp.value.trim() === '' || !Number.isFinite(Number(inp.value))) { inp.value = cur[inp.dataset.k] ?? ''; return; } // empty is not 0
        const q = { ...cur }; q[inp.dataset.k] = Number(inp.value); onChange(q);
      };
    });
    box.querySelector('button').onclick = (e) => { e.preventDefault(); const m = this.marioPos(); if (m) onChange(m); else this.toast('Mario is not in a level', 'x'); };
    return box;
  }

  dialogPicker(cur, onChange, newName = 'Dialog') {
    const s = this.story;
    const wrap = h('span', 'st-dpick');
    const sel = h('select');
    sel.innerHTML = `<option value="">Pick a dialog…</option>${s.dialogs.map((d) => `<option value="${esc(d.id)}" ${d.id === cur ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      ${/^game:\d+$/.test(cur || '') ? `<option value="${cur}" selected>Game dialog ${cur.slice(5)}</option>` : ''}<option value="__new">＋ Write a new dialog…</option>`;
    const d = s.dialogs.find((x) => x.id === cur);
    const peek = h('div', 'st-peek', d ? esc((d.text || '').slice(0, 140)) : '');
    sel.onchange = () => {
      if (sel.value === '__new') {
        const n = this.newDialog({ name: newName, text: '' });
        onChange(n.id);
        this.sel.dialogs = n.id;
        this.tab = 'dialogs';
        this.render();
        setTimeout(() => $('.st-dlg-text', this.root)?.focus(), 0);
        return;
      }
      onChange(sel.value);
    };
    const edit = h('button', 'btn sm ghost', 'Edit');
    edit.onclick = (e) => { e.preventDefault(); if (d) { this.sel.dialogs = d.id; this.tab = 'dialogs'; this.render(); } };
    edit.hidden = !d;
    wrap.append(sel, edit, peek);
    return wrap;
  }

  // Pick an object in build mode; the panel comes back with it.
  pickInWorld(kind, done) {
    if (!this.logic) return;
    const tab = this.tab;
    this.root.hidden = true;
    this.logic.pick(kind, (uid) => {
      this.open(tab);
      if (uid) done(uid);
    });
  }

  // ======================================================================================
  // Cutscenes

  newCutscene(fields = {}) {
    const cam = this.engine.camOut?.();
    const cs = { id: newStoryId('cs'), name: fields.name || `Cutscene ${this.story.cutscenes.length + 1}`, skippable: true, hud: false,
      steps: cam ? [{ type: 'shot', pos: cam.pos.map(Math.round), focus: cam.focus.map(Math.round), seconds: 0, ease: 'cut' }, { type: 'wait', seconds: 1 }] : [], ...fields };
    this.upsert('cutscenes', cs, { render: false });
    return this.story.cutscenes.find((x) => x.id === cs.id);
  }

  renderCutscenes(side, main) {
    const s = this.story;
    this.sideList(side, {
      title: 'Cutscenes', newLabel: 'New cutscene', selected: this.sel.cutscenes,
      items: s.cutscenes.map((c) => ({ ...c, search: c.name })),
      empty: 'Camera moves, dialog lines and fades, played by events or at the start.',
      render: (c) => `<span class="st-ico">${sicon('film')}</span><span class="st-text"><b>${esc(c.name)}</b><span>${(c.steps || []).length} steps · ${this.duration(c).toFixed(1)} s</span></span>`,
      onPick: (c) => { this.sel.cutscenes = c.id; this.render(); },
      onNew: () => { const c = this.newCutscene(); this.sel.cutscenes = c.id; this.render(); },
    });
    const cs = s.cutscenes.find((x) => x.id === this.sel.cutscenes);
    if (!cs) {
      this.emptyMain(main, 'Cutscenes', 'A cutscene is a little film: camera shots that glide from one view to the next, dialog lines, waits, objects that move, fades and captions. Mario stands still while it plays, and players can skip it with Start. Fly the build-mode camera to a view and press “Add shot from this view”.', [
        ['New cutscene', () => { const c = this.newCutscene(); this.sel.cutscenes = c.id; this.render(); }, true]]);
      return;
    }
    this.cutsceneEditor(main, cs);
  }

  duration(cs) {
    return (cs.steps || []).reduce((t, st) => t + (['shot', 'wait', 'caption', 'fade', 'move'].includes(st.type) && st.wait !== false ? Number(st.seconds) || 0 : st.type === 'dialog' ? 3 : 0), 0);
  }

  cutsceneEditor(main, cs0) {
    const cs = clone(cs0);
    const save = (render = true) => this.upsert('cutscenes', cs, { render, delay: render ? 0 : 400 });
    const top = h('div', 'st-row2');
    top.innerHTML = `<label class="st-field grow"><span>Name</span><input class="st-cs-name" value="${esc(cs.name)}"></label>
      <label class="st-check"><input type="checkbox" data-k="skippable" ${cs.skippable !== false ? 'checked' : ''}><span>Start skips it</span></label>
      <label class="st-check"><input type="checkbox" data-k="hud" ${cs.hud ? 'checked' : ''}><span>Show the HUD</span></label>`;
    main.appendChild(top);
    $('.st-cs-name', top).oninput = (e) => { cs.name = e.target.value; save(false); };
    top.querySelectorAll('[data-k]').forEach((cb) => { cb.onchange = () => { cs[cb.dataset.k] = cb.checked; save(); }; });
    // the timeline strip
    const total = Math.max(0.1, this.duration(cs));
    const strip = h('div', 'st-strip');
    let t = 0;
    for (const st of cs.steps || []) {
      const d = ['shot', 'wait', 'caption', 'fade', 'move'].includes(st.type) && st.wait !== false ? Number(st.seconds) || 0 : st.type === 'dialog' ? 3 : 0;
      const seg = h('div', `st-seg ${st.type}`, `<span>${esc(STEPS[st.type]?.label || st.type)}</span>`);
      seg.style.left = `${(t / total) * 100}%`;
      seg.style.width = `${Math.max(1.5, (d / total) * 100)}%`;
      strip.appendChild(seg);
      t += d;
    }
    main.appendChild(h('div', 'st-h', `Timeline <span class="st-faint">· ${total.toFixed(1)} s (dialogs wait for the player)</span>`));
    main.appendChild(strip);
    const list = h('div', 'st-steps');
    (cs.steps ||= []).forEach((st, i) => {
      const card = h('div', `st-step ${st.type}`);
      const head = h('div', 'st-action-head');
      head.innerHTML = `<span class="st-num">${i + 1}</span>`;
      const sel = h('select', 'st-type');
      sel.innerHTML = Object.entries(STEPS).map(([k, v]) => `<option value="${k}" ${k === st.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
      sel.onchange = () => { cs.steps[i] = this.defaultStep(sel.value); save(); };
      head.appendChild(sel);
      head.appendChild(this.rowTools(cs.steps, i, () => save()));
      card.appendChild(head);
      card.appendChild(this.fieldsFor(STEPS[st.type]?.fields || [], st, (re) => save(re !== false)));
      if (st.type === 'shot') {
        const row = h('div', 'st-shot');
        row.innerHTML = `<span class="st-faint">Camera ${st.pos ? `at ${st.pos.map((v) => Math.round(v)).join(', ')}` : 'not set'} looking at ${st.focus ? st.focus.map((v) => Math.round(v)).join(', ') : '—'}</span>
          <button class="btn sm" data-a="set">${sicon('cam')}Set from current view</button><button class="btn sm ghost" data-a="look">View</button>`;
        row.querySelector('[data-a=set]').onclick = () => { const c = this.engine.camOut(); st.pos = c.pos.map(Math.round); st.focus = c.focus.map(Math.round); save(); this.toast('Shot set from the camera', 'check'); };
        row.querySelector('[data-a=look]').onclick = () => { if (st.pos && st.focus) this.logic?.viewShot(st.pos, st.focus); };
        card.appendChild(row);
      }
      if (st.type === 'action') {
        st.action ||= { type: 'set_flag' };
        const sub = h('div', 'st-sub');
        const asel = h('select', 'st-type');
        asel.innerHTML = this.actionOptions(st.action.type);
        asel.onchange = () => { st.action = this.defaultAction(asel.value); save(); };
        sub.appendChild(asel);
        sub.appendChild(this.fieldsFor(ACTIONS[st.action.type]?.fields || [], st.action, () => save()));
        card.appendChild(sub);
      }
      list.appendChild(card);
    });
    main.appendChild(list);
    const btns = h('div', 'st-btns');
    btns.innerHTML = `<button class="btn sm" data-a="shot">${sicon('cam')}Add shot from this view</button>
      <select class="st-type st-add-sel"><option value="">＋ Add a step…</option>${Object.entries(STEPS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <span class="st-spacer"></span>
      <button class="btn sm primary" data-a="play">${icon('play', 'sm')}Preview</button>
      <button class="btn sm danger" data-a="del">Delete</button>`;
    main.appendChild(btns);
    main.appendChild(h('div', 'st-note', 'Tip: close this panel, fly the build-mode camera to the view you want (right-drag, WASD with the right mouse button), open Story again and press “Add shot from this view”. Each shot glides from the previous view.'));
    btns.querySelector('[data-a=shot]').onclick = () => { const c = this.engine.camOut(); cs.steps.push({ type: 'shot', pos: c.pos.map(Math.round), focus: c.focus.map(Math.round), seconds: 2, ease: 'smooth' }); save(); };
    btns.querySelector('select').onchange = (e) => { if (e.target.value) { cs.steps.push(this.defaultStep(e.target.value)); save(); } };
    btns.querySelector('[data-a=play]').onclick = () => this.previewCutscene(cs);
    btns.querySelector('[data-a=del]').onclick = async () => { if (await askConfirm({ title: `Delete “${cs.name}”?`, ok: 'Delete', danger: true })) { this.op({ op: 'delete', coll: 'cutscenes', id: cs.id }); this.sel.cutscenes = null; this.render(); } };
  }

  defaultStep(type) {
    const c = this.engine.camOut?.();
    switch (type) {
      case 'shot': return { type, pos: c?.pos.map(Math.round), focus: c?.focus.map(Math.round), seconds: 2, ease: 'smooth' };
      case 'dialog': return { type, dialog: this.story.dialogs[this.story.dialogs.length - 1]?.id || '' };
      case 'wait': return { type, seconds: 1 };
      case 'caption': return { type, text: 'Meanwhile…', seconds: 3 };
      case 'fade': return { type, to: 'out', seconds: 0.6, color: '#000000' };
      case 'move': return { type, seconds: 2, wait: true };
      case 'action': return { type, action: { type: 'set_flag', value: 'true' } };
      default: return { type };
    }
  }

  async previewCutscene(cs) {
    this.flush();
    this.runtime.applyTexts(true);
    this.close();
    if (this.editor?.active) this.editor.exit();
    await new Promise((r) => setTimeout(r, 150));
    document.querySelector('#canvas')?.focus();
    this.runtime.playCutscene(this.story.cutscenes.find((x) => x.id === cs.id) || cs, { preview: true });
  }

  // ======================================================================================
  // The game's own texts

  renderTexts(side, main) {
    const T = texts();
    if (!T) { main.textContent = 'Loading…'; return; }
    const sub = [['dialogs', 'Game dialogs'], ['courses', 'Course names'], ['acts', 'Star names'], ['ending', 'Ending & credits']];
    const head = h('div', 'st-side-head');
    head.innerHTML = '<div class="st-sec">The game\'s texts</div>';
    side.appendChild(head);
    const nav = h('div', 'st-subnav');
    for (const [id, label] of sub) {
      const b = h('button', `st-row ${this.textTab === id ? 'active' : ''}`, `<span class="st-text"><b>${label}</b><span>${this.changedCount(id)} changed</span></span>`);
      b.onclick = () => { this.textTab = id; this.render(); };
      nav.appendChild(b);
    }
    side.appendChild(nav);
    if (this.textTab === 'dialogs') this.renderGameDialogs(side, main);
    else if (this.textTab === 'courses') this.renderCourseNames(main);
    else if (this.textTab === 'acts') this.renderActNames(main);
    else this.renderEnding(main);
  }

  changedCount(kind) {
    const t = this.story.texts[kind === 'ending' ? 'ending' : kind] || {};
    return Object.values(t).filter((v) => v != null).length + (kind === 'ending' ? Object.keys(this.story.texts.credits || {}).length : 0);
  }

  renderGameDialogs(side, main) {
    const T = texts();
    const over = this.story.texts.dialogs;
    const LABELS = { 20: "Peach's letter", 21: 'Bowser (first meeting)', 0: 'Bob-omb Battlefield intro', 1: 'Bob-omb Buddy' };
    this.sideList(side, {
      title: 'All 170 dialogs', selected: this.sel.gameDialog,
      items: T.dialogs.map((d) => ({ ...d, id: d.id, search: `${d.id} ${LABELS[d.id] || ''} ${(over[d.id]?.text ?? d.text)}` })),
      render: (d) => `<span class="st-num">${d.id}</span><span class="st-text"><b>${esc(LABELS[d.id] || (over[d.id]?.text ?? d.text).split('\n')[0])}</b><span>${over[d.id] ? '<em>changed</em> · ' : ''}${esc((over[d.id]?.text ?? d.text).split('\n').slice(LABELS[d.id] ? 0 : 1, 2).join(' '))}</span></span>`,
      onPick: (d) => { this.sel.gameDialog = d.id; this.page = 0; this.render(); },
    });
    const id = this.sel.gameDialog;
    const orig = T.dialogs[id];
    if (orig == null) {
      this.emptyMain(main, 'The game\'s own dialogs', 'Change anything the game says: signs, Toads, Bob-omb Buddies, Bowser, Peach\'s letter at the start (dialog 20) and every tutorial. Line breaks stay where you put them, like in the game. Your version is used in every level; “Restore” brings the original back.', [
        ["Edit Peach's letter", () => { this.sel.gameDialog = 20; this.render(); }, true]]);
      return;
    }
    const d = { ...orig, ...(over[id] || {}) };
    const dd = { text: d.text, lines: d.lines, left: d.left, width: d.width, voice: d.voice | 0 };
    this.dialogEditor(main, dd, {
      game: { title: `Dialog ${id}${LABELS[id] ? ` · ${LABELS[id]}` : ''}`, sub: over[id] ? 'Changed in this project' : 'The game\'s text', num: id },
      save: (patch, opts) => {
        const cur = { ...(this.story.texts.dialogs[id] || {}), ...patch };
        for (const k of ['lines', 'voice']) if (cur[k] === orig[k] || (k === 'voice' && !cur[k])) delete cur[k];
        if (cur.text === orig.text) delete cur.text;
        this.op({ op: 'text', kind: 'dialogs', key: id, value: Object.keys(cur).length ? cur : null }, opts);
      },
      extra: [['Restore original', () => { this.op({ op: 'text', kind: 'dialogs', key: id, value: null }); }]],
    });
  }

  renderCourseNames(main) {
    const T = texts();
    const box = h('div', 'st-table');
    box.innerHTML = '<div class="st-h">Course names <span class="st-faint">· the star select screen, pause menu, file select and course complete screen</span></div>';
    for (const c of T.courses) {
      if (!c.text.trim()) continue;
      const row = h('label', 'st-trow');
      const cur = this.story.texts.courses[c.index];
      row.innerHTML = `<span class="st-num">${esc(c.text.slice(0, 3).trim() || '★')}</span><input value="${esc(cur ?? '')}" placeholder="${esc(courseName(c.index))}" maxlength="30">${cur != null ? `<button class="btn sm ghost" title="Restore">${sicon('restart')}</button>` : ''}`;
      const inp = row.querySelector('input');
      inp.oninput = () => this.op({ op: 'text', kind: 'courses', key: c.index, value: inp.value ? inp.value.toUpperCase() : null }, { render: false, delay: 400 });
      row.querySelector('button')?.addEventListener('click', (e) => { e.preventDefault(); this.op({ op: 'text', kind: 'courses', key: c.index, value: null }); });
      box.appendChild(row);
    }
    main.appendChild(box);
  }

  renderActNames(main) {
    const T = texts();
    const box = h('div', 'st-table');
    box.innerHTML = '<div class="st-h">Star names <span class="st-faint">· the six stars of each course (your own levels name their stars in the Stars tab)</span></div>';
    for (let c = 0; c < 15; c++) {
      box.appendChild(h('div', 'st-group', esc(courseName(c))));
      for (let a = 0; a < 6; a++) {
        const act = T.acts[c * 6 + a];
        if (!act) continue;
        const cur = this.story.texts.acts[act.index];
        const row = h('label', 'st-trow');
        row.innerHTML = `<span class="st-num">★${a + 1}</span><input value="${esc(cur ?? '')}" placeholder="${esc(act.text)}" maxlength="34">`;
        const inp = row.querySelector('input');
        inp.oninput = () => this.op({ op: 'text', kind: 'acts', key: act.index, value: inp.value ? inp.value.toUpperCase() : null }, { render: false, delay: 400 });
        box.appendChild(row);
      }
    }
    main.appendChild(box);
  }

  renderEnding(main) {
    const T = texts();
    const box = h('div', 'st-table');
    box.innerHTML = '<div class="st-h">Peach\'s lines in the ending</div>';
    for (const line of T.ending) {
      if (line.index === 8) continue;
      const cur = this.story.texts.ending[line.index];
      const row = h('label', 'st-trow');
      row.innerHTML = `<span class="st-num">${line.index + 1}</span><input value="${esc(cur ?? '')}" placeholder="${esc(line.text)}" maxlength="60">`;
      const inp = row.querySelector('input');
      inp.oninput = () => this.op({ op: 'text', kind: 'ending', key: line.index, value: inp.value || null }, { render: false, delay: 400 });
      box.appendChild(row);
    }
    box.appendChild(h('div', 'st-h', 'Credits <span class="st-faint">· one page per level the camera flies over; the credits font has capital letters, dots and the digits 3, 4 and 6</span>'));
    for (const page of T.credits) {
      if (!page.title.length) continue;
      const cur = this.story.texts.credits[page.index];
      const v = cur || { title: page.title, names: page.names };
      const row = h('div', `st-credit ${cur ? 'changed' : ''}`);
      row.innerHTML = `<span class="st-num">${page.index}</span>
        <div class="st-credit-fields">
          <input data-t="0" value="${esc(v.title[0] || '')}" placeholder="TITLE">
          <input data-t="1" value="${esc(v.title[1] || '')}" placeholder="(second title line)">
          ${[0, 1, 2].map((i) => `<input data-n="${i}" value="${esc(v.names[i] || '')}" placeholder="name ${i + 1}">`).join('')}
        </div>${cur ? `<button class="btn sm ghost" title="Restore">${sicon('restart')}</button>` : ''}`;
      row.querySelectorAll('input').forEach((inp) => {
        inp.oninput = () => {
          inp.value = inp.value.toUpperCase().replace(/[^A-Z .346]/g, '');
          const val = { title: [...row.querySelectorAll('[data-t]')].map((x) => x.value.trim()).filter(Boolean), names: [...row.querySelectorAll('[data-n]')].map((x) => x.value.trim()).filter(Boolean) };
          this.op({ op: 'text', kind: 'credits', key: page.index, value: val }, { render: false, delay: 500 });
        };
      });
      row.querySelector('button')?.addEventListener('click', () => this.op({ op: 'text', kind: 'credits', key: page.index, value: null }));
      box.appendChild(row);
    }
    main.appendChild(box);
  }

  // ======================================================================================
  // Start & end

  renderStart(side, main) {
    side.hidden = true;
    const s = this.story;
    const st = clone(s.start || {});
    const save = (render = true) => this.op({ op: 'start', value: st }, { render, delay: render ? 0 : 400 });
    const box = h('div', 'st-start');
    box.innerHTML = `
      <div class="st-h">How the hack starts</div>
      <div class="st-note">“Play from start” (top right) and the published game begin here with a fresh save: the level, Mario's spot, then the opening dialog and cutscene. Events with “A new game starts” run then too.</div>
      <div class="st-fields">
        <label class="st-field"><span>Start level</span>${this.levelSelectHtml(st.custom ? `c:${st.custom}${st.area > 1 ? `:${st.area}` : ''}` : st.level ? String(st.level) : '16', false)}</label>
        <label class="st-check"><input type="checkbox" data-k="starSelect" ${st.starSelect ? 'checked' : ''}><span>Show its star select screen</span></label>
      </div>
      <div class="st-fields"><label class="st-check"><input type="checkbox" data-k="intro" ${st.intro ? 'checked' : ''}><span>Play the game's own opening: Peach's letter, Lakitu and the warp pipe (when the hack starts in the castle grounds)</span></label></div>
      <div class="st-fields"><label class="st-field"><span>Mario starts at</span></label></div>
      <div class="st-fields st-startpos"></div>
      <div class="st-fields"><label class="st-field grow"><span>Opening dialog</span></label></div>
      <div class="st-fields st-opening"></div>
      <div class="st-fields"><label class="st-field"><span>Opening cutscene</span></label></div>
      <div class="st-fields st-opencs"></div>
      <div class="st-btns"><button class="btn sm" data-a="letter">Edit Peach's letter (the game's opening)</button></div>
      <div class="st-h">How it ends</div>
      <div class="st-note">Add the action “Play the ending & credits” to an event (for example when Mario collects the last star or enters the throne room). Peach's lines and the credits pages are in Game texts → Ending & credits. “Finish the level” sends Mario back like a collected star does.</div>
      <div class="st-btns"><button class="btn sm" data-a="credits">Edit the ending & credits</button><button class="btn sm" data-a="endev">New event that plays the ending</button></div>`;
    main.appendChild(box);
    try { window.studio64Title?.startCard?.(box); } catch (err) { console.warn('title card', err); } // the launch screen (title/index.js)
    box.querySelector('select.st-level').onchange = (e) => {
      const v = e.target.value;
      delete st.custom; delete st.level; delete st.area;
      if (v.startsWith('c:')) { const [id, n] = v.slice(2).split(':'); st.custom = id; if (Number(n) > 1) st.area = Number(n); } else st.level = Number(v);
      save();
    };
    box.querySelector('[data-k=starSelect]').onchange = (e) => { st.starSelect = e.target.checked; save(); };
    box.querySelector('[data-k=intro]').onchange = (e) => { st.intro = e.target.checked; save(); };
    const posBox = box.querySelector('.st-startpos');
    posBox.appendChild(st.pos ? this.posInput(st.pos, (p) => { st.pos = p; save(); }) : h('span', 'st-faint', 'the level\'s own start'));
    const pb = h('button', 'btn sm', st.pos ? 'Use the level\'s start' : 'Use Mario\'s position');
    pb.onclick = () => { if (st.pos) delete st.pos; else st.pos = this.marioPos(); save(); };
    posBox.appendChild(pb);
    box.querySelector('.st-opening').appendChild(this.dialogPicker(st.dialog, (v) => { st.dialog = v || undefined; save(); }, 'Opening'));
    const csSel = h('select');
    csSel.innerHTML = `<option value="">None</option>${s.cutscenes.map((c) => `<option value="${esc(c.id)}" ${c.id === st.cutscene ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
    csSel.onchange = () => { st.cutscene = csSel.value || undefined; save(); };
    box.querySelector('.st-opencs').appendChild(csSel);
    box.querySelector('[data-a=letter]').onclick = () => { this.tab = 'texts'; this.textTab = 'dialogs'; this.sel.gameDialog = 20; this.render(); };
    box.querySelector('[data-a=credits]').onclick = () => { this.tab = 'texts'; this.textTab = 'ending'; this.render(); };
    box.querySelector('[data-a=endev]').onclick = () => {
      const ev = this.newEvent({ name: 'The end', trigger: { type: 'star' }, actions: [{ type: 'wait', seconds: 1 }, { type: 'ending' }] });
      this.tab = 'logic'; this.sel.logic = ev.id; this.render();
    };
  }
}

export { storyRefs };
