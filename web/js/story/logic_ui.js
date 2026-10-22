// Build mode's Logic tool: trigger zones and characters placed in the level, the story part of the
// inspector (make anything talk, hide it until an event shows it, events that use it), and picking
// objects in the level for the Story panel.
import { icon } from '../icons.js';
import { blockDefaults, material } from '../generators.js';
import { newStoryId, storyRefs, ensureStory } from './ops.js';
import { CHARACTERS, describe } from './schema.js';
import { ZONE_COLOR } from './runtime.js';
import { sicon } from './story_ui.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const randUid = () => 1 + Math.floor(Math.random() * 0x7efffffe);

export class LogicUI {
  constructor({ engine, studio, editor, editorUI, runtime, send, toast, getStory, catalog }) {
    Object.assign(this, { engine, studio, editor, editorUI, runtime, send, toast, getStory, catalog });
    this.ui = null;          // the Story panel (set after both exist)
    this.picking = null;
    this.mount();
  }

  get story() { return ensureStory(this.getStory()); }

  // ---- the library tab -------------------------------------------------------------------

  mount() {
    const tabs = $('.lib-tabs');
    if (!tabs || $('#lib-logic')) return;
    const tab = h('button', 'lib-tab', 'Logic');
    tab.dataset.lib = 'logic';
    tab.title = 'Zones, characters and events in this level';
    tabs.appendChild(tab);
    const pane = h('div', 'lib-pane logic-pane');
    pane.id = 'lib-logic';
    pane.hidden = true;
    $('#library').appendChild(pane);
    this.pane = pane;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach((x) => x.classList.toggle('active', x === tab));
      if (this.editor.sel) this.editor.select(null);
      document.querySelectorAll('#library .lib-pane').forEach((p) => { p.hidden = p !== pane; });
      this.render();
    });
    // the other tabs only know their own panes
    tabs.querySelectorAll('.lib-tab').forEach((t) => { if (t !== tab) t.addEventListener('click', () => { pane.hidden = true; }); });
    // the inspector: add the story section, and hide/show this pane with the library
    const ui = this.editorUI;
    const orig = ui.renderInspector.bind(ui);
    ui.renderInspector = (sel) => {
      orig(sel);
      try { this.afterInspector(sel); } catch (err) { console.error('story inspector', err); }
    };
    document.addEventListener('keydown', (e) => {
      if (this.picking && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endPick(null); }
    }, true);
  }

  active() { return $('.lib-tab[data-lib=logic]')?.classList.contains('active'); }

  refresh() {
    if (this.pane && !this.pane.hidden) this.render();
    if (this.editor.sel && this.editor.active) this.afterInspector(this.editor.sel);
  }

  render() {
    const p = this.pane;
    if (!p) return;
    const key = this.engine.areaKey();
    const recs = this.engine.patch.areas?.[key]?.objects || [];
    const s = this.story;
    const zones = recs.filter((r) => r.zone);
    const npcs = recs.filter((r) => s.npcs?.[r.uid]);
    const hidden = recs.filter((r) => (s.hidden || []).includes(r.uid));
    const here = new Set(recs.map((r) => r.uid));
    const refs = storyRefs(s);
    const evs = s.events.filter((ev) => (ev.trigger?.zone && here.has(Number(ev.trigger.zone))) || (ev.trigger?.uid && here.has(Number(ev.trigger.uid)))
      || [...refs].some(([uid, names]) => here.has(uid) && names.includes(ev.name)));
    p.innerHTML = `
      <div class="lg-intro">Make things happen here: zones Mario walks into, characters he talks to, objects that appear later.</div>
      <div class="lg-add">
        <button class="lg-big" data-a="zone">${sicon('zone', '')}<b>Zone</b><span>Something happens when Mario walks in</span></button>
        <button class="lg-big" data-a="char">${sicon('person', '')}<b>Character</b><span>Someone to talk to</span></button>
      </div>
      <div class="lg-chars" hidden>${CHARACTERS.map((c) => `<button class="lg-char" data-ch="${c.id}">${esc(c.label)}</button>`).join('')}</div>
      ${this.listHtml('Zones', zones, (r) => `${sicon('zone')}<b>${esc(r.zone.name || 'Zone')}</b><span>${s.events.filter((e) => Number(e.trigger?.zone) === r.uid).length} events</span>`)}
      ${this.listHtml('Characters', npcs, (r) => `${sicon('person')}<b>${esc(s.npcs[r.uid].name || r.name)}</b><span>${(s.npcs[r.uid].lines || []).length} lines</span>`)}
      ${this.listHtml('Hidden until shown', hidden, (r) => `${icon('eye', 'sm')}<b>${esc(r.star?.name || r.name || 'object')}</b><span>appears by an event</span>`)}
      ${evs.length ? `<div class="lg-sec">Events here</div>${evs.map((ev) => `<button class="lg-row" data-ev="${esc(ev.id)}">${sicon('bolt')}<b>${esc(ev.name)}</b><span>${esc(describe('trigger', ev.trigger, this.ui?.names() || {}))}</span></button>`).join('')}` : ''}
      <button class="btn sm lg-open" data-a="story">${sicon('book')}Open the Story panel</button>`;
    p.querySelector('[data-a=zone]').onclick = () => this.addZone();
    p.querySelector('[data-a=char]').onclick = () => { const g = p.querySelector('.lg-chars'); g.hidden = !g.hidden; };
    p.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => { const ch = CHARACTERS.find((c) => c.id === b.dataset.ch); if (this.ui?.placeCharacter(ch)) { this.render(); setTimeout(() => this.selectUid(this.lastPlaced), 50); } }; });
    p.querySelectorAll('[data-uid]').forEach((b) => { b.onclick = () => this.selectUid(Number(b.dataset.uid), true); });
    p.querySelectorAll('[data-ev]').forEach((b) => { b.onclick = () => this.ui?.open('logic', b.dataset.ev); });
    p.querySelector('[data-a=story]').onclick = () => this.ui?.open();
  }

  listHtml(title, recs, row) {
    if (!recs.length) return '';
    return `<div class="lg-sec">${title}</div>${recs.map((r) => `<button class="lg-row" data-uid="${r.uid}">${row(r)}</button>`).join('')}`;
  }

  selectUid(uid, frame = false) {
    if (!uid) return;
    if (!this.editor.active) this.editor.enter();
    const o = this.engine.objects().find((x) => x.uid === uid);
    if (o) {
      this.editor.select(o.slot);
      if (frame) this.editor.frameSelection();
    }
  }

  // ---- placing ------------------------------------------------------------------------------

  // Where new things go: the ground at the middle of the build-mode view, else in front of Mario.
  spot() {
    const ed = this.editor;
    if (ed.active && ed.camData) {
      const f = ed.frame;
      const hit = ed.pick(f.clientWidth / 2, f.clientHeight / 2, { objects: false });
      if (hit) {
        const c = this.engine.camOut();
        return { x: Math.round(hit.x), y: Math.round(hit.y), z: Math.round(hit.z), face: Math.atan2(c.pos[0] - hit.x, c.pos[2] - hit.z) };
      }
    }
    try {
      const m = this.engine.state().mario;
      if (!m) return null;
      const yaw = (m.yaw / 65536) * Math.PI * 2;
      const x = m.x + Math.sin(yaw) * 300, z = m.z + Math.cos(yaw) * 300;
      const fy = this.engine.floor(x, m.y + 200, z);
      return { x: Math.round(x), y: Math.round(fy > -10000 ? fy : m.y), z: Math.round(z), face: yaw + Math.PI };
    } catch { return null; }
  }

  commitRecord(rec, summary) {
    const key = this.engine.areaKey();
    const a = (this.engine.patch.areas[key] ||= { objects: [], removals: [], warps: [] });
    a.objects.push(rec);
    const slot = this.engine.spawn(rec);
    this.send({ type: 'edit', op: { type: 'add', key, summary, records: [rec] } });
    return slot;
  }

  // A talking character record (placed and saved). Returns the record.
  characterRecord(ch, where = null) {
    const at = where || this.spot();
    if (!at) return null;
    const yaw = Math.round(((at.face ?? 0) / (Math.PI * 2)) * 65536) & 0xffff;
    const uid = randUid();
    let rec;
    if (ch.entry) {
      const e = this.catalog.entries.find((x) => x.id === ch.entry);
      rec = { uid, entry: ch.entry, x: at.x, y: at.y, z: at.z, yaw, pitch: 0, roll: 0, bparams: this.studio.parseParams(e?.params?.[0]) || 0, scale: 1, name: ch.label };
    } else {
      const [set, anim] = ch.anim || [0, 0];
      rec = { uid, bhv: 'bhvStudioNpc', model: ch.model, x: at.x, y: at.y, z: at.z, yaw, bparams: ((set << 16) | (anim << 8)) >>> 0, scale: 1, name: ch.label };
    }
    this.commitRecord(rec, `Placed ${ch.label}`);
    this.lastPlaced = uid;
    return rec;
  }

  // A trigger zone: a see-through box, only visible while building.
  addZone(name) {
    const at = this.spot();
    if (!at) { this.toast('Go into a level first', 'x'); return null; }
    const n = name || `Zone ${this.story.events.length + 1}`;
    const rec = { uid: randUid(), block: blockDefaults({ shape: 0, sx: 600, sy: 400, sz: 600, top: material('water'), side: material('water'), flags: 6, color: ZONE_COLOR }),
      x: at.x, y: at.y, z: at.z, yaw: 0, pitch: 0, roll: 0, name: n, zone: { name: n } };
    const slot = this.commitRecord(rec, `Added ${n}`);
    if (!this.editor.active) this.editor.enter();
    setTimeout(() => { this.editor.select(slot); this.editor.setGizmo?.('size'); }, 50);
    this.toast('Zone added: resize it with the handles, then give it an event', 'check');
    this.render();
    return rec;
  }

  // Zone + dialog + event in one click.
  quickZoneEvent() {
    this.ui?.close();
    const z = this.addZone();
    if (!z || !this.ui) return;
    const d = this.ui.newDialog({ name: `${z.zone.name}: message`, text: 'You found a secret spot!' });
    const ev = this.ui.newEvent({ name: `Enter ${z.zone.name}`, trigger: { type: 'enter_zone', zone: z.uid }, actions: [{ type: 'dialog', dialog: d.id }] });
    this.ui.open('logic', ev.id);
  }

  // ---- inspector --------------------------------------------------------------------------

  afterInspector(sel) {
    const box = $('#inspector');
    if (this.pane) {
      if (sel && this.editor.active) this.pane.hidden = true;
      else if (this.active()) { this.pane.hidden = false; document.querySelectorAll('#library .lib-pane').forEach((p) => { if (p !== this.pane) p.hidden = true; }); this.render(); }
    }
    if (!sel || !this.editor.active || !box || box.hidden) return;
    if (this.picking) { this.tryPick(sel); return; }
    box.querySelector('.story-insp')?.remove();
    const s = this.story;
    const rec = sel.rec;
    const sec = h('div', 'insp-sec story-insp');
    if (rec?.zone) {
      const t = box.querySelector('.insp-title');
      if (t) t.textContent = `Zone: ${rec.zone.name || ''}`;
      const evs = s.events.filter((e) => Number(e.trigger?.zone) === rec.uid);
      sec.innerHTML = `<div class="insp-label">Trigger zone</div>
        <label class="lg-field"><span>Name</span><input value="${esc(rec.zone.name || '')}" spellcheck="false"></label>
        ${evs.map((ev) => `<button class="lg-row" data-ev="${esc(ev.id)}">${sicon('bolt')}<b>${esc(ev.name)}</b><span>${esc((ev.actions || []).map((a) => describe('action', a, this.ui?.names() || {})).join(', ') || 'no actions yet')}</span></button>`).join('')}
        <div class="lg-btns"><button class="btn sm" data-a="say">${sicon('talk')}Show a dialog here</button><button class="btn sm" data-a="ev">${sicon('bolt')}New event</button></div>
        <div class="lg-hint">Invisible while playing. Mario entering (or leaving) it starts events.</div>`;
      const inp = sec.querySelector('input');
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.onchange = () => {
        const name = inp.value.trim() || 'Zone';
        this.editor.updateSelected({ zone: { ...rec.zone, name }, name }, `Renamed zone to ${name}`);
      };
      sec.querySelector('[data-a=say]').onclick = () => {
        const d = this.ui.newDialog({ name: `${rec.zone.name}: message`, text: 'Something is going on here…' });
        const ev = this.ui.newEvent({ name: `Enter ${rec.zone.name}`, trigger: { type: 'enter_zone', zone: rec.uid }, actions: [{ type: 'dialog', dialog: d.id }] });
        this.ui.open('dialogs', d.id);
        this.ui.sel.logic = ev.id;
      };
      sec.querySelector('[data-a=ev]').onclick = () => {
        const ev = this.ui.newEvent({ name: `Enter ${rec.zone.name}`, trigger: { type: 'enter_zone', zone: rec.uid } });
        this.ui.open('logic', ev.id);
      };
    } else {
      const uid = sel.uid;
      const npc = uid ? s.npcs?.[uid] : null;
      const hid = uid && (s.hidden || []).includes(uid);
      const used = uid ? s.events.filter((e) => JSON.stringify(e).includes(String(uid))) : [];
      sec.innerHTML = `<div class="insp-label">Story</div>
        ${npc ? `<button class="lg-row" data-a="npc">${sicon('talk')}<b>Talks: ${esc(npc.name || 'character')}</b><span>${(npc.lines || []).length} line${(npc.lines || []).length === 1 ? '' : 's'} · edit what they say</span></button>`
        : `<button class="btn sm lg-wide" data-a="talk">${sicon('talk')}Make it talk</button>`}
        <label class="lg-check"><input type="checkbox" ${hid ? 'checked' : ''}><span>Hidden until an event shows it</span></label>
        ${used.map((ev) => `<button class="lg-row" data-ev="${esc(ev.id)}">${sicon('bolt')}<b>${esc(ev.name)}</b><span>${esc(describe('trigger', ev.trigger, this.ui?.names() || {}))}</span></button>`).join('')}
        <div class="lg-btns"><button class="btn sm" data-a="defeat" title="An event that starts when this object is defeated, collected or gone">When gone…</button><button class="btn sm" data-a="press" title="An event that starts when this switch is pressed (its state changes)">When pressed…</button></div>`;
      const own = () => (this.editor.sel?.uid ? this.editor.sel.uid : (this.editor.updateSelected({}, 'Made it part of the story'), this.editor.sel?.uid));
      sec.querySelector('[data-a=talk]')?.addEventListener('click', () => {
        const u = own();
        if (!u) return;
        const name = this.editor.sel?.name || 'Character';
        const d = this.ui.newDialog({ name: `${name}: hello`, text: `Hello, Mario!` });
        this.ui.op({ op: 'npc', uid: u, value: { name, lines: [{ dialog: d.id, if: [] }] } }, { render: false });
        if (!this.isTalker(this.editor.sel)) this.toast('This object does not listen for B by itself: use a Character (Logic tab) to make any model talk', 'x');
        this.ui.open('dialogs', d.id);
      });
      sec.querySelector('[data-a=npc]')?.addEventListener('click', () => this.ui.open('characters', uid));
      sec.querySelector('input[type=checkbox]').onchange = (e) => {
        const u = own();
        if (u) this.ui.op({ op: 'hidden', uid: u, on: e.target.checked }, { render: false });
        this.render();
      };
      for (const [a, type, label] of [['defeat', 'defeat', 'is gone'], ['press', 'switch', 'is pressed']]) {
        sec.querySelector(`[data-a=${a}]`).onclick = () => {
          const u = own();
          if (!u) return;
          const ev = this.ui.newEvent({ name: `${this.editor.sel?.name || 'Object'} ${label}`, trigger: { type, uid: u } });
          this.runtime.registerWatches();
          this.ui.open('logic', ev.id);
        };
      }
    }
    sec.querySelectorAll('[data-ev]').forEach((b) => { b.onclick = () => this.ui.open('logic', b.dataset.ev); });
    const actions = box.querySelector('.insp-actions');
    if (actions) box.insertBefore(sec, actions); else box.appendChild(sec);
  }

  // Objects that start a talk when Mario presses B near them.
  isTalker(sel) {
    const r = sel?.rec;
    const bhv = r?.bhv || this.catalog.entries.find((e) => e.id === (r?.entry || sel?.entry))?.behavior || sel?.obj?.bhv;
    return /StudioNpc|ToadMessage|BobombBuddy|MessagePanel|SignOnWall|SmsPianta|Tuxie|Yoshi|Hoot|Ukiki/.test(bhv || '');
  }

  // ---- picking objects for the Story panel ------------------------------------------------

  pick(kind, cb) {
    this.picking = { kind, cb };
    if (!this.editor.active) this.editor.enter();
    this.editor.select(null);
    const hint = $('#tool-hint');
    if (hint) { hint.innerHTML = `Click the ${kind === 'zone' ? 'zone' : 'object'} to use · <kbd>Esc</kbd> cancels`; hint.hidden = false; }
    this.toast(`Click the ${kind === 'zone' ? 'zone' : 'object'} in the level`, 'crosshair');
  }

  tryPick(sel) {
    const p = this.picking;
    if (!p) return;
    if (p.kind === 'zone' && !sel.rec?.zone) { this.toast('That is not a zone: pick a zone (see-through box)', 'x'); return; }
    let uid = sel.uid;
    if (!uid) {
      this.picking = null; // adopting re-renders the inspector
      this.editor.updateSelected({}, 'Made it part of the story');
      uid = this.editor.sel?.uid;
    }
    this.endPick(uid || null);
  }

  endPick(uid) {
    const p = this.picking;
    this.picking = null;
    const hint = $('#tool-hint');
    if (hint) hint.hidden = true;
    this.editor.ui?.onToolChange?.();
    p?.cb?.(uid);
  }

  // ---- camera helpers ---------------------------------------------------------------------

  async focusRecord(key, rec) {
    const e = this.engine;
    if (e.areaKey() !== key) {
      // sub-areas (c:<id>:<n>, 9:2) through the world flow, which knows areas
      const wf = this.studio?.worldFlow;
      const m = /^c:([^:]+)(?::(\d+))?$/.exec(key);
      if (wf) wf.goArea(m ? { custom: m[1], area: Number(m[2] || 1) } : { level: Number(key.split(':')[0]), area: Number(key.split(':')[1]) || 1 });
      else if (m) e.warpFast(e.studioLevel, 0, m[1], false);
      else e.warpFast(Number(key.split(':')[0]), 1, null, false);
      await e.waitArrival(null, 30000);
    }
    this.selectUid(rec.uid, true);
  }

  viewShot(pos, focus) {
    const ed = this.editor;
    if (this.ui?.isOpen()) this.ui.close();
    if (!ed.active) ed.enter();
    const d = [focus[0] - pos[0], focus[1] - pos[1], focus[2] - pos[2]];
    ed.animateTo(pos, Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2])), 500);
    this.toast('This is the shot. Open Story to go on editing.', 'eye');
  }
}

export { newStoryId };
