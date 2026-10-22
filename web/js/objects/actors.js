// Custom objects and enemies without code: a model plus behavior building blocks,
// saved as definitions in the project ("My objects"). Instances are records with
// bhv 'bhvStudioActor', the model and `def` (the definition's id); the engine side
// is src/studio/actor.c.

import { el, esc, svg, clamp, round, deepCopy, newId, withFloats } from './common.js';
import { isTyping } from '../typing.js';

export const ACTOR_DEFAULTS = {
  name: 'Custom enemy', model: 'goomba', scale: 1,
  move: 'wander', speed: 6, chaseSpeed: 14, sight: 1200, leash: 1500, turn: 8, fly: false, hover: 60, faceMario: true,
  jump: 'none', jumpHeight: 40, jumpEvery: 2,
  health: 1, damage: 1, stomp: true, punch: true, invincible: false, knockback: true, harmless: false,
  defeat: 'squish', coins: 1, coinKind: 'yellow', respawn: 0,
  shoot: false, projectile: 'flame:red_flame', fireEvery: 2, projSpeed: 30, projDamage: 1, projArc: 0, projScale: 1, burns: true,
  sounds: { alert: 'SOUND_OBJ_GOOMBA_ALERT', hit: 'SOUND_OBJ_KOOPA_DAMAGE', defeat: 'SOUND_OBJ_ENEMY_DEFEAT_SHRINK', attack: '' },
  hitR: 0, hitH: 0, anim: 0,
};

export const MOVES = [['stand', 'Stands'], ['wander', 'Wanders'], ['patrol', 'Patrols a path'], ['chase', 'Chases Mario'], ['turret', 'Turret']];
export const JUMPS = [['none', 'Never'], ['hop', 'Hops'], ['at_mario', 'At Mario'], ['walls', 'Over walls']];
export const DEFEATS = [['poof', 'Poof'], ['squish', 'Squish'], ['explode', 'Explode'], ['launch', 'Flies off'], ['shrink', 'Shrinks']];
export const PROJECTILES = [
  ['flame:red_flame', 'Fireball'], ['flame:blue_flame', 'Blue flame'], ['prop:metallic_ball', 'Iron ball'], ['prop:spiny_ball', 'Spiny egg'],
  ['prop:water_bomb', 'Water bomb'], ['prop:bubble', 'Bubble'], ['prop:yoshi_egg', 'Egg'], ['prop:yellow_coin_no_shadow', 'Coin'],
];

// Starting points for the builder.
export const ACTOR_TEMPLATES = [
  { id: 'walker', label: 'Walker', hint: 'Wanders, one stomp', def: { model: 'goomba', move: 'wander', speed: 5, health: 1, damage: 1, defeat: 'squish', coins: 1 } },
  { id: 'chaser', label: 'Chaser', hint: 'Runs at Mario', def: { model: 'goomba', move: 'chase', speed: 5, chaseSpeed: 16, sight: 1400, jump: 'at_mario', health: 1, damage: 1, defeat: 'squish', coins: 1 } },
  { id: 'guard', label: 'Guard', hint: 'Patrols, 2 hits', def: { model: 'koopa', move: 'patrol', speed: 7, health: 2, damage: 2, defeat: 'launch', coins: 2 } },
  { id: 'turret', label: 'Turret', hint: 'Shoots fireballs', def: { model: 'bobomb', move: 'turret', shoot: true, fireEvery: 1.5, projectile: 'flame:red_flame', burns: true, health: 1, stomp: true, punch: true, damage: 1, defeat: 'explode', coins: 2 } },
  { id: 'ghost', label: 'Ghost', hint: 'Flies after Mario', def: { model: 'boo', move: 'chase', fly: true, hover: 80, chaseSpeed: 9, sight: 1600, stomp: false, punch: true, health: 1, damage: 2, defeat: 'poof', coins: 3 } },
  { id: 'spiky', label: 'Spiky', hint: 'Only punches work', def: { model: 'spiny', move: 'wander', speed: 6, stomp: false, punch: true, damage: 2, defeat: 'poof', coins: 1 } },
  { id: 'boss', label: 'Boss', hint: '5 hits, big', def: { model: 'koopa', scale: 2.5, move: 'chase', chaseSpeed: 12, sight: 2400, leash: 3000, jump: 'hop', jumpEvery: 3, jumpHeight: 55, health: 5, damage: 3, defeat: 'explode', coins: 10, coinKind: 'blue' } },
  { id: 'blob', label: 'Hopper', hint: 'Hops around', def: { model: 'goomba', move: 'wander', jump: 'hop', jumpEvery: 1.2, jumpHeight: 45, speed: 4, health: 1, damage: 1, defeat: 'squish', coins: 1 } },
];

let SOUNDS = null;
export async function loadSounds() {
  if (!SOUNDS) SOUNDS = fetch('data/sounds.json').then((r) => r.json()).catch(() => []);
  return SOUNDS;
}
let SOUND_BITS = new Map();
loadSounds().then((list) => { SOUND_BITS = new Map(list.map((s) => [s.id, s.bits >>> 0])); });
const soundBits = (v) => (typeof v === 'number' ? v >>> 0 : SOUND_BITS.get(v) || 0);

export function normalizeDef(d) {
  const out = { ...deepCopy(ACTOR_DEFAULTS), ...deepCopy(d || {}) };
  out.sounds = { ...ACTOR_DEFAULTS.sounds, ...(d?.sounds || {}) };
  out.health = clamp(Math.round(out.health) || 1, 1, 99);
  out.damage = clamp(Math.round(out.damage) || 0, 0, 8);
  out.coins = clamp(Math.round(out.coins) || 0, 0, 30);
  out.scale = clamp(Number(out.scale) || 1, 0.1, 10);
  if (!MOVES.some(([k]) => k === out.move)) out.move = 'wander';
  if (!JUMPS.some(([k]) => k === out.jump)) out.jump = 'none';
  if (!DEFEATS.some(([k]) => k === out.defeat)) out.defeat = 'poof';
  return out;
}

// The float array of src/studio/actor.c (A_* layout).
export function encodeActor(def, engine) {
  const d = normalizeDef(def);
  const idx = (id) => engine.entryIndex.get(id) ?? -1;
  const flags = (d.stomp ? 1 : 0) | (d.punch ? 2 : 0) | (d.invincible ? 4 : 0) | (d.fly ? 8 : 0) | (d.faceMario ? 16 : 0)
    | (d.shoot ? 32 : 0) | (d.respawn > 0 ? 64 : 0) | (!d.knockback ? 128 : 0) | (d.harmless || d.damage === 0 ? 256 : 0) | (d.burns ? 512 : 0);
  const snd = (name) => { const b = soundBits(d.sounds[name]); return [(b >>> 16) & 0xffff, b & 0xffff]; };
  return [
    MOVES.findIndex(([k]) => k === d.move), d.speed, d.chaseSpeed, d.sight, d.leash,
    JUMPS.findIndex(([k]) => k === d.jump), d.jumpHeight, Math.max(1, Math.round(d.jumpEvery * 30)),
    d.health, d.damage, flags, DEFEATS.findIndex(([k]) => k === d.defeat), d.coins, d.coinKind === 'blue' ? 1 : 0,
    ...snd('alert'), ...snd('hit'), ...snd('defeat'), ...snd('attack'),
    d.hitR || 70, d.hitH || 90,
    Math.max(5, Math.round(d.fireEvery * 30)), idx(d.projectile), d.projSpeed, d.projDamage, d.projArc, idx(d.model), d.anim | 0,
    Math.round(d.respawn * 30), 2.5, d.turn, d.hover, d.projScale,
  ];
}

export function applyActor(engine, rec, slot, defs) {
  const M = engine.M;
  if (!M?._studio_actor_set || slot < 0) return false;
  // the definition by id; when it is gone (undone, a project without it), the copy keeps the
  // behaviour it was placed with (rec.actor, a snapshot)
  const def = (rec.def && defs.find((x) => x.id === rec.def)) || rec.actor || null;
  if (!def) return false;
  const cfg = encodeActor({ ...def, ...(rec.overrides || {}) }, engine);
  return withFloats(engine, cfg, (p, n) => M._studio_actor_set(slot, p, n)) === 1;
}

// A record for an instance of definition `def` at p.
export function actorRecord(def, p, yaw = 0, uid = 0) {
  const { deleted, thumb, ...actor } = def; // eslint-disable-line no-unused-vars
  return { uid, bhv: 'bhvStudioActor', model: def.model, def: def.id, actor: JSON.parse(JSON.stringify(actor)), x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]), yaw: yaw & 0xffff, pitch: 0, roll: 0, bparams: 0, scale: def.scale || 1, name: def.name };
}

// ---------------------------------------------------------------------------
// The builder dialog.

export class ActorBuilder {
  constructor({ engine, catalog, store, toast, thumbs, onSaved }) {
    this.engine = engine;
    this.catalog = catalog;
    this.store = store;
    this.toast = toast;
    this.thumbs = thumbs; // () => Set of ids with a picture
    this.onSaved = onSaved;
    this.modal = null;
  }

  defs() { return this.store.game('objdefs', []); }

  open(existing = null, { place = true } = {}) {
    this.close();
    const def = normalizeDef(existing || ACTOR_TEMPLATES[0].def);
    if (!existing) { def.id = newId(); def.name = 'Custom enemy'; }
    this.def = def;
    this.isNew = !existing;
    this.place = place;
    const m = el('div', 'om-modal');
    m.innerHTML = `<div class="om-dialog ab"><div class="om-dialog-head"><div class="om-title">${this.isNew ? 'New custom object' : 'Edit custom object'}</div>
      <div class="spacer"></div><button class="btn icon ghost" data-a="close" title="Close (Esc)">${svg('x')}</button></div><div class="ab-body"></div>
      <div class="om-dialog-foot"><span class="ab-status"></span><div class="spacer"></div><button class="btn" data-a="close">Cancel</button>
      ${this.isNew ? '<button class="btn" data-a="save">Save to My objects</button>' : ''}<button class="btn primary" data-a="${this.isNew ? 'saveplace' : 'save'}">${this.isNew ? 'Save &amp; place' : 'Save changes'}</button></div></div>`;
    document.body.appendChild(m);
    this.modal = m;
    m.addEventListener('pointerdown', (e) => { if (e.target === m) this.close(); });
    m.querySelectorAll('[data-a=close]').forEach((b) => { b.onclick = () => this.close(); });
    m.querySelectorAll('[data-a=save]').forEach((b) => { b.onclick = () => this.save(false); });
    m.querySelectorAll('[data-a=saveplace]').forEach((b) => { b.onclick = () => this.save(true); });
    // the keyboard belongs to the dialog: Delete, R, Tab, Space... must not reach the editor or
    // Mario behind it (text fields in it handle their own keys)
    this.keyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } else if (!isTyping()) e.stopPropagation(); };
    window.addEventListener('keydown', this.keyHandler, true);
    this.render();
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    window.removeEventListener('keydown', this.keyHandler, true);
  }

  save(andPlace) {
    const d = normalizeDef(this.def);
    d.name = String(d.name || 'Custom object').slice(0, 40);
    const list = this.defs().filter((x) => x.id !== d.id);
    list.push(d);
    this.store.setGame('objdefs', list, `${this.isNew ? 'Made' : 'Changed'} the custom object “${d.name}”`);
    this.close();
    this.toast?.(this.isNew ? `“${d.name}” is in My objects` : `Updated “${d.name}”`, 'check');
    this.onSaved?.(d, { place: andPlace, isNew: this.isNew });
  }

  // Imported models (assets): ids "asset:<id>".
  imported() {
    return (window.studio64?.assets?.meta?.models || []).map((m) => ({ id: `asset:${m.id}`, name: m.name, thumb: m.thumb }));
  }

  thumb(id) {
    if (String(id).startsWith('asset:')) {
      const m = this.imported().find((x) => x.id === id);
      return m?.thumb ? `<img alt="" src="${esc(m.thumb)}">` : `<i>${esc((m?.name || '3D').slice(0, 2))}</i>`;
    }
    const e = this.catalog.entries.find((x) => x.id === id);
    const has = this.thumbs?.().has(id);
    return has ? `<img alt="" src="thumbs/${encodeURIComponent(id.replace(/:/g, '__'))}.webp">` : `<i>${esc((e?.name || id).replace(/[^A-Za-z0-9]/g, '').slice(0, 2))}</i>`;
  }

  render() {
    const d = this.def;
    const body = this.modal.querySelector('.ab-body');
    const entry = this.catalog.entries.find((x) => x.id === d.model) || this.imported().find((x) => x.id === d.model);
    const opt = (list, v) => list.map(([k, l]) => `<button class="seg-btn${v === k ? ' active' : ''}" data-v="${k}">${esc(l)}</button>`).join('');
    body.innerHTML = `
      <div class="ab-side">
        <div class="ab-preview">${this.thumb(d.model)}</div>
        <input class="ab-name" value="${esc(d.name)}" maxlength="40" spellcheck="false" aria-label="Name">
        <div class="ab-model-name">${esc(entry?.name || d.model)}</div>
        <button class="btn sm" data-a="model">Change model…</button>
        <div class="lib-label">Start from</div>
        <div class="ab-templates">${ACTOR_TEMPLATES.map((t) => `<button class="ab-tpl" data-tpl="${t.id}" title="${esc(t.hint)}"><b>${esc(t.label)}</b><span>${esc(t.hint)}</span></button>`).join('')}</div>
      </div>
      <div class="ab-main">
        <div class="ab-models" hidden><div class="lib-search">${svg('search')}<input placeholder="Search models…" spellcheck="false"></div><div class="obj-grid ab-model-grid"></div></div>
        <section><h4>Movement</h4>
          <div class="seg wide" data-f="move">${opt(MOVES, d.move)}</div>
          <div class="ab-grid">
            ${this.range('Speed', 'speed', 1, 30, 0.5)}
            ${d.move === 'chase' ? this.range('Chase speed', 'chaseSpeed', 2, 40, 0.5) : ''}
            ${d.move === 'chase' || d.move === 'turret' || d.shoot ? this.range('Sees Mario from', 'sight', 200, 5000, 50) : ''}
            ${d.move === 'wander' || d.move === 'chase' ? this.range('Stays within', 'leash', 200, 6000, 50) : ''}
            ${this.range('Turns', 'turn', 1, 30, 1, '°')}
          </div>
          <div class="checks"><label><input type="checkbox" data-c="fly" ${d.fly ? 'checked' : ''}> Flies</label>
          <label><input type="checkbox" data-c="faceMario" ${d.faceMario ? 'checked' : ''}> Looks at Mario</label></div>
          ${d.fly ? `<div class="ab-grid">${this.range('Bobs', 'hover', 0, 300, 5)}</div>` : ''}
          ${d.move === 'patrol' ? '<div class="om-note">Draw its path after placing it: select it and press <b>Edit path</b> under Patrol path.</div>' : ''}
        </section>
        ${d.fly ? '' : `<section><h4>Jumping</h4><div class="seg wide" data-f="jump">${opt(JUMPS, d.jump)}</div>
          ${d.jump !== 'none' ? `<div class="ab-grid">${this.range('Jump power', 'jumpHeight', 10, 100, 1)}${d.jump !== 'walls' ? this.range('Every', 'jumpEvery', 0.3, 8, 0.1, ' s') : ''}</div>` : ''}</section>`}
        <section><h4>Attack</h4>
          <div class="ab-grid">${this.range('Contact damage', 'damage', 0, 8, 1, '', (v) => (v ? `${v} ♥` : 'harmless'))}</div>
          <div class="checks"><label><input type="checkbox" data-c="shoot" ${d.shoot || d.move === 'turret' ? 'checked' : ''} ${d.move === 'turret' ? 'disabled' : ''}> Shoots at Mario</label></div>
          ${d.shoot || d.move === 'turret' ? `<div class="ab-row"><span>Shoots</span><select data-s="projectile">${PROJECTILES.map(([k, l]) => `<option value="${k}" ${d.projectile === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <label class="check"><input type="checkbox" data-c="burns" ${d.burns ? 'checked' : ''}> Burns</label></div>
            <div class="ab-grid">${this.range('Every', 'fireEvery', 0.2, 8, 0.1, ' s')}${this.range('Speed', 'projSpeed', 5, 80, 1)}${this.range('Damage', 'projDamage', 1, 8, 1, ' ♥')}${this.range('Arc', 'projArc', 0, 4, 0.1)}${this.range('Size', 'projScale', 0.3, 4, 0.1, '×')}</div>` : ''}
        </section>
        <section><h4>Defeat</h4>
          <div class="checks"><label><input type="checkbox" data-c="stomp" ${d.stomp ? 'checked' : ''} ${d.invincible ? 'disabled' : ''}> Stomp</label>
            <label><input type="checkbox" data-c="punch" ${d.punch ? 'checked' : ''} ${d.invincible ? 'disabled' : ''}> Punch &amp; kick</label>
            <label><input type="checkbox" data-c="invincible" ${d.invincible ? 'checked' : ''}> Invincible</label>
            <label><input type="checkbox" data-c="knockback" ${d.knockback ? 'checked' : ''}> Knocked back</label></div>
          ${d.invincible ? '' : `<div class="ab-grid">${this.range('Hits to defeat', 'health', 1, 20, 1)}</div>
          <div class="ab-row"><span>Goes away</span><div class="seg" data-f="defeat">${opt(DEFEATS, d.defeat)}</div></div>
          <div class="ab-grid">${this.range('Coins', 'coins', 0, 20, 1)}${this.range('Comes back after', 'respawn', 0, 60, 1, ' s', (v) => (v ? v : 'never'))}</div>
          <div class="ab-row"><span>Coin kind</span><div class="seg" data-f="coinKind">${opt([['yellow', 'Yellow (1)'], ['blue', 'Blue (5)']], d.coinKind)}</div></div>`}
        </section>
        <section><h4>Sounds</h4><div class="ab-sounds">
          ${['alert', 'hit', 'defeat', 'attack'].map((k) => `<div class="ab-row"><span>${{ alert: 'Sees Mario', hit: 'Gets hit', defeat: 'Defeated', attack: 'Attacks' }[k]}</span>
            <select data-snd="${k}"><option value="">None</option></select><button class="btn icon sm ghost" data-play="${k}" title="Play">${svg('sound')}</button></div>`).join('')}
        </div></section>
        <section><h4>Size</h4><div class="ab-grid">${this.range('Size', 'scale', 0.2, 6, 0.05, '×')}${this.range('Hitbox radius', 'hitR', 0, 400, 5, '', (v) => (v ? v : 'auto'))}${this.range('Hitbox height', 'hitH', 0, 600, 5, '', (v) => (v ? v : 'auto'))}${this.range('Animation', 'anim', 0, 8, 1)}</div></section>
      </div>`;
    this.wire(body);
  }

  range(label, field, min, max, step, unit = '', fmt = (v) => v) {
    const v = this.def[field];
    (this.fmts ||= {})[field] = { unit, fmt };
    return `<label class="ab-range"><span>${esc(label)}</span><input type="range" data-r="${field}" min="${min}" max="${max}" step="${step}" value="${v}"><b>${esc(String(fmt(round(v, 2))))}${typeof fmt(v) === 'number' ? unit : ''}</b></label>`;
  }

  wire(body) {
    const d = this.def;
    body.querySelector('.ab-name').oninput = (e) => { d.name = e.target.value; };
    body.querySelector('.ab-name').addEventListener('keydown', (e) => e.stopPropagation());
    body.querySelectorAll('[data-f]').forEach((seg) => {
      seg.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { d[seg.dataset.f] = b.dataset.v; if (seg.dataset.f === 'move' && b.dataset.v === 'turret') d.shoot = true; this.render(); }; });
    });
    body.querySelectorAll('[data-c]').forEach((cb) => { cb.onchange = () => { d[cb.dataset.c] = cb.checked; this.render(); }; });
    body.querySelectorAll('[data-r]').forEach((r) => {
      r.oninput = () => {
        const v = Number(r.value);
        d[r.dataset.r] = v;
        const { unit = '', fmt = (x) => x } = this.fmts?.[r.dataset.r] || {};
        const shown = fmt(round(v, 2));
        r.nextElementSibling.textContent = `${shown}${typeof shown === 'number' ? unit : ''}`;
      };
    });
    body.querySelectorAll('[data-s]').forEach((s) => { s.onchange = () => { d[s.dataset.s] = s.value; }; });
    body.querySelectorAll('[data-tpl]').forEach((b) => {
      b.onclick = () => {
        const t = ACTOR_TEMPLATES.find((x) => x.id === b.dataset.tpl);
        Object.assign(this.def, normalizeDef({ ...t.def, id: d.id, name: d.name === 'Custom enemy' || ACTOR_TEMPLATES.some((x) => x.label === d.name) ? t.label : d.name }));
        this.render();
      };
    });
    body.querySelector('[data-a=model]').onclick = () => this.showModels(body);
    loadSounds().then((list) => {
      const groups = {};
      for (const s of list) (groups[s.group] ||= []).push(s);
      const html = Object.entries(groups).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
      body.querySelectorAll('[data-snd]').forEach((sel) => {
        sel.insertAdjacentHTML('beforeend', html);
        sel.value = d.sounds[sel.dataset.snd] || '';
        sel.onchange = () => { d.sounds[sel.dataset.snd] = sel.value; this.play(sel.value); };
      });
      body.querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => this.play(d.sounds[b.dataset.play]); });
    });
  }

  play(id) {
    const bits = soundBits(id);
    if (!bits) return;
    try { this.engine.audioHold?.(true); this.engine.playGameSound(bits); setTimeout(() => this.engine.audioHold?.(false), 1500); } catch { /* engine busy */ }
  }

  showModels(body) {
    const box = body.querySelector('.ab-models');
    box.hidden = !box.hidden;
    if (box.hidden) return;
    const input = box.querySelector('input');
    const grid = box.querySelector('.ab-model-grid');
    const has = this.thumbs?.() || new Set();
    const render = () => {
      const q = input.value.trim().toLowerCase();
      let list = this.catalog.entries.filter((e) => !/^bhvStudio/.test(e.behavior || ''));
      if (q) list = list.filter((e) => (e.name + ' ' + e.id).toLowerCase().includes(q));
      else list = list.filter((e) => has.has(e.id));
      grid.innerHTML = '';
      const imported = this.imported().filter((e) => !q || e.name.toLowerCase().includes(q));
      list = [...imported, ...list];
      for (const e of list.slice(0, 160)) {
        const b = el('button', `obj${e.id === this.def.model ? ' active' : ''}`, `<span class="thumb">${this.thumb(e.id)}</span><span class="obj-name">${esc(e.name)}</span>`);
        b.onclick = () => { this.def.model = e.id; this.def.anim = 0; this.render(); };
        grid.appendChild(b);
      }
      if (!list.length) grid.appendChild(el('div', 'lib-tip', 'Nothing found.'));
    };
    input.oninput = render;
    input.addEventListener('keydown', (e) => e.stopPropagation());
    render();
    input.focus();
  }
}
