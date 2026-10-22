// Gameplay rules per project, with per-level overrides: Mario's physics, moves,
// health and lives, coins, caps, HUD and a level timer. Stored in the project as
// "@game".rules = { base: {...}, levels: { "<level>": {...} } }; the engine side
// is src/studio/rules.c (gStudioRules).

import { el, esc, svg, clamp, round, deepCopy, withFloats, levelKeyOf } from './common.js';
import { isTyping } from '../typing.js';

export const RULE_DEFAULTS = {
  runSpeed: 1, jump: 1, doubleJump: 1, tripleJump: 1, backflip: 1, sideFlip: 1, longJump: 1, wallKick: 1, longJumpSpeed: 1,
  gravity: 1, airControl: 1, swimSpeed: 1, fallDamage: 1150,
  damage: 1, oneHit: false, infiniteLives: false, startLives: 4,
  coinLife: 0, coinHeal: true, coinStar: true,
  wingTime: 60, metalTime: 20, vanishTime: 20,
  moves: { longJump: true, backflip: true, sideFlip: true, tripleJump: true, doubleJump: true, wallKick: true, groundPound: true, dive: true, slideKick: true, punch: true, ledgeGrab: true, crouch: true },
  noBlj: false,
  hud: { lives: true, coins: true, stars: true, power: true, keys: true },
  timer: false, timeLimit: 0,
  shotgun: false,
  katana: false,
};

const MOVE_BITS = { longJump: 1, backflip: 2, sideFlip: 4, tripleJump: 8, doubleJump: 16, wallKick: 32, groundPound: 64, dive: 128, slideKick: 256, punch: 512, ledgeGrab: 1024, crouch: 2048 };
const MOVE_LABELS = { longJump: 'Long jump', backflip: 'Backflip', sideFlip: 'Side flip', tripleJump: 'Triple jump', doubleJump: 'Double jump', wallKick: 'Wall kick', groundPound: 'Ground pound', dive: 'Dive', slideKick: 'Slide kick', punch: 'Punch & kick', ledgeGrab: 'Ledge grab', crouch: 'Crouch' };
const HUD_BITS = { lives: 0x1, coins: 0x2, stars: 0x4, power: 0x8, keys: 0x10 };
const HUD_LABELS = { lives: 'Lives', coins: 'Coins', stars: 'Stars', power: 'Power meter & camera', keys: 'Keys' };

// The panel's sections and fields: [key, label, min, max, step, unit, hint].
const SECTIONS = [
  { id: 'physics', label: 'Mario', fields: [
    ['runSpeed', 'Run speed', 0.3, 3, 0.05, '×'], ['gravity', 'Gravity', 0.2, 3, 0.05, '×'], ['airControl', 'Air control', 0, 3, 0.05, '×'],
    ['swimSpeed', 'Swim speed', 0.3, 3, 0.05, '×'], ['fallDamage', 'Fall damage from', 0, 5000, 50, ' units', 'height of a fall that hurts; 0 = never'],
  ] },
  { id: 'jumps', label: 'Jumps', fields: [
    ['jump', 'Jump', 0.3, 4, 0.05, '× height'], ['doubleJump', 'Double jump', 0.3, 4, 0.05, '× height'], ['tripleJump', 'Triple jump', 0.3, 4, 0.05, '× height'],
    ['backflip', 'Backflip', 0.3, 4, 0.05, '× height'], ['sideFlip', 'Side flip', 0.3, 4, 0.05, '× height'], ['longJump', 'Long jump', 0.3, 4, 0.05, '× height'],
    ['longJumpSpeed', 'Long jump distance', 0.3, 3, 0.05, '×'], ['wallKick', 'Wall kick', 0.3, 4, 0.05, '× height'],
  ] },
  { id: 'moves', label: 'Moves' },
  { id: 'health', label: 'Health & lives', fields: [
    ['damage', 'Damage taken', 0, 4, 0.25, '×', '0 = Mario can\'t get hurt'], ['startLives', 'Starting lives', 1, 99, 1, ''],
  ] },
  { id: 'coins', label: 'Coins & caps', fields: [
    ['coinLife', '1-up every', 0, 200, 5, ' coins', '0 = off'], ['wingTime', 'Wing cap', 5, 180, 5, ' s'], ['metalTime', 'Metal cap', 5, 180, 5, ' s'], ['vanishTime', 'Vanish cap', 5, 180, 5, ' s'],
  ] },
  { id: 'hud', label: 'HUD & timer', fields: [['timeLimit', 'Time limit', 0, 900, 5, ' s', '0 = none; Mario loses a life when it runs out']] },
  { id: 'items', label: 'Items' },
];
const CHECKS = {
  health: [['oneHit', 'One hit kills'], ['infiniteLives', 'Infinite lives']],
  coins: [['coinHeal', 'Coins refill health'], ['coinStar', '100 coins give a star']],
  hud: [['timer', 'Show a level timer']],
  moves: [['noBlj', 'No backwards long jump speed (BLJ)']],
  items: [['shotgun', 'Mario starts with the shotgun'], ['katana', 'Mario starts with the katana']],
};

// Shotgun Mario and Katana Mario ship with Studio 64 (the Shoggoth content); an engine built without
// them (no sg:shotgun / kt:blade in the catalog, app.js) leaves their rules and presets out
export function dropShotgunRules(ids = ['shotgun']) {
  CHECKS.items = CHECKS.items.filter(([k]) => !ids.includes(k));
  for (const id of ids) {
    const i = RULE_PRESETS.findIndex((p) => p.id === id);
    if (i >= 0) RULE_PRESETS.splice(i, 1);
  }
  const j = SECTIONS.findIndex((x) => x.id === 'items');
  if (j >= 0 && !CHECKS.items.length) SECTIONS.splice(j, 1);
}

export const RULE_PRESETS = [
  { id: 'classic', label: 'Classic', hint: 'The original game', rules: {} },
  { id: 'moon', label: 'Moon', hint: 'Low gravity, floaty jumps', rules: { gravity: 0.45, airControl: 1.5, fallDamage: 0 } },
  { id: 'speedy', label: 'Speedy', hint: 'Fast and snappy', rules: { runSpeed: 1.6, gravity: 1.3, jump: 1.3, airControl: 1.4 } },
  { id: 'hardcore', label: 'Hardcore', hint: 'One hit, 1 life, no BLJ', rules: { oneHit: true, startLives: 1, coinHeal: false, noBlj: true } },
  { id: 'kids', label: 'Kids', hint: 'No damage, infinite lives', rules: { damage: 0, infiniteLives: true, fallDamage: 0 } },
  { id: 'shotgun', label: 'Shotgun Mario', hint: 'Starts with the shotgun', rules: { shotgun: true } },
  { id: 'katana', label: 'Katana Mario', hint: 'Starts with the katana', rules: { katana: true } },
  { id: 'platformer', label: 'Pure platformer', hint: 'Only jumps, no tricks', rules: { moves: { longJump: false, backflip: false, sideFlip: false, wallKick: true, groundPound: false, dive: false, slideKick: false, punch: false } } },
];

const merge = (a, b) => {
  const out = deepCopy(a);
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = { ...out[k], ...v };
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
};

export function effectiveRules(rules, levelKey) {
  return merge(merge(RULE_DEFAULTS, rules?.base), levelKey ? rules?.levels?.[levelKey] : null);
}

export function encodeRules(r) {
  let disabled = 0;
  for (const [k, bit] of Object.entries(MOVE_BITS)) if (r.moves?.[k] === false) disabled |= bit;
  let hudHide = 0;
  for (const [k, bit] of Object.entries(HUD_BITS)) if (r.hud?.[k] === false) hudHide |= bit;
  return [
    r.runSpeed, r.jump, r.doubleJump, r.tripleJump, r.backflip, r.sideFlip, r.longJump, r.wallKick, r.longJumpSpeed,
    r.gravity, r.airControl, r.swimSpeed, r.fallDamage, r.damage, r.oneHit ? 1 : 0, r.infiniteLives ? 1 : 0, r.coinLife | 0, r.coinHeal ? 1 : 0,
    Math.round(r.wingTime * 30), Math.round(r.metalTime * 30), Math.round(r.vanishTime * 30), disabled, r.noBlj ? 1 : 0, hudHide, r.timer ? 1 : 0,
    Math.round((r.timeLimit || 0) * 30), r.coinStar ? 1 : 0,
  ];
}

export class GameRules {
  constructor({ engine, store, toast, levelName }) {
    this.engine = engine;
    this.store = store;
    this.toast = toast;
    this.levelName = levelName;
    this.livesSet = false;
    this.scope = 'game';
    this.section = 'physics';
    this.modal = null;
  }

  rules() { return this.store.game('rules', { base: {}, levels: {} }); }

  // Pushes the rules of the current level to the engine.
  apply() {
    const M = this.engine.M;
    if (!M?._studio_rules_set) return;
    const r = effectiveRules(this.rules(), levelKeyOf(this.engine));
    withFloats(this.engine, encodeRules(r), (p, n) => M._studio_rules_set(p, n));
    this.current = r;
    try { M._studio_shotgun_rule?.(r.shotgun && !r.katana ? 1 : 0); } catch { /* old engine */ } // (../shotgun.js)
    try { M._studio_katana_rule?.(r.katana ? 1 : 0); } catch { /* old engine */ } // (../katana.js; one weapon at a time: the katana wins)
    return r;
  }

  // A level loaded: its rules, its timer; the first time, the starting lives.
  onArea() {
    const r = this.apply();
    try { this.engine.M._studio_rules_level_start?.(); } catch { /* old engine */ }
    // starting lives: only when the project sets them (the game itself starts with 4)
    const wantLives = this.rules().base?.startLives !== undefined || Object.values(this.rules().levels || {}).some((l) => l.startLives !== undefined);
    if (r && wantLives && !this.livesSet && this.engine.ready !== false) {
      setTimeout(() => {
        try { if (this.engine.state().mario) { this.engine.M._studio_set_lives(clamp(r.startLives | 0, 1, 99)); this.livesSet = true; } } catch { /* not in a level */ }
      }, 300);
    }
  }

  // ---- saving -------------------------------------------------------------

  set(changes, summary, scope = this.scope, levelKey = levelKeyOf(this.engine)) {
    const all = deepCopy(this.rules());
    all.base ||= {};
    all.levels ||= {};
    const target = scope === 'level' ? (all.levels[levelKey] ||= {}) : all.base;
    for (const [k, v] of Object.entries(changes)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = { ...(target[k] || {}), ...v };
      else if (v === undefined) delete target[k];
      else target[k] = v;
    }
    if (scope === 'level' && !Object.keys(target).length) delete all.levels[levelKey];
    this.store.setGame('rules', all, summary || 'Changed the game rules');
    this.apply();
    if (changes.startLives !== undefined) { try { this.engine.M._studio_set_lives(clamp(changes.startLives | 0, 1, 99)); } catch { /* not in a level */ } }
  }

  resetLevel(levelKey = levelKeyOf(this.engine)) {
    const all = deepCopy(this.rules());
    if (all.levels?.[levelKey]) delete all.levels[levelKey];
    this.store.setGame('rules', all, 'This level uses the game rules again');
    this.apply();
  }

  // ---- the Game panel -------------------------------------------------------

  open(section) {
    if (section) this.section = section;
    this.close();
    const m = el('div', 'om-modal');
    m.innerHTML = `<div class="om-dialog gr"><div class="om-dialog-head">${svg('gamepad', 'i')}<div class="om-title">Game rules</div>
      <div class="seg gr-scope"><button class="seg-btn" data-scope="game">Whole game</button><button class="seg-btn" data-scope="level">This level</button></div>
      <div class="spacer"></div><button class="btn icon ghost" data-a="close" title="Close (Esc)">${svg('x')}</button></div>
      <div class="gr-body"><nav class="gr-nav"></nav><div class="gr-main"></div></div>
      <div class="om-dialog-foot"><span class="gr-note"></span><div class="spacer"></div><button class="btn" data-a="close">Close</button><button class="btn primary" data-a="play">${svg('play')}Play to try it</button></div></div>`;
    document.body.appendChild(m);
    this.modal = m;
    m.addEventListener('pointerdown', (e) => { if (e.target === m) this.close(); });
    m.querySelectorAll('[data-a=close]').forEach((b) => { b.onclick = () => this.close(); });
    m.querySelector('[data-a=play]').onclick = () => { this.close(); this.onPlay?.(); };
    m.querySelectorAll('[data-scope]').forEach((b) => { b.onclick = () => { this.scope = b.dataset.scope; this.render(); }; });
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

  isOpen() { return !!this.modal; }

  render() {
    const m = this.modal;
    if (!m) return;
    const lk = levelKeyOf(this.engine);
    const all = this.rules();
    const base = merge(RULE_DEFAULTS, all.base);
    const lvl = all.levels?.[lk] || {};
    const eff = this.scope === 'level' ? merge(base, lvl) : base;
    m.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('active', b.dataset.scope === this.scope));
    const lname = this.levelName?.() || 'this level';
    m.querySelector('.gr-note').innerHTML = this.scope === 'level'
      ? `Changes apply to <b>${esc(lname)}</b> only.${Object.keys(lvl).length ? ' <button class="linkish" data-a="resetlvl">Use the game rules here</button>' : ''}`
      : 'Changes apply to every level (levels can override them).';
    const r = m.querySelector('[data-a=resetlvl]');
    if (r) r.onclick = () => { this.resetLevel(lk); this.render(); };
    const nav = m.querySelector('.gr-nav');
    nav.innerHTML = [{ id: 'presets', label: 'Presets' }, ...SECTIONS].map((s) => `<button class="gr-tab${this.section === s.id ? ' active' : ''}" data-s="${s.id}">${esc(s.label)}</button>`).join('');
    nav.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { this.section = b.dataset.s; this.render(); }; });
    const main = m.querySelector('.gr-main');
    main.innerHTML = '';
    const overridden = (k) => this.scope === 'level' && lvl[k] !== undefined;
    if (this.section === 'presets') {
      const grid = el('div', 'gr-presets');
      for (const p of RULE_PRESETS) {
        const b = el('button', 'gr-preset', `<b>${esc(p.label)}</b><span>${esc(p.hint)}</span>`);
        b.onclick = () => {
          // a preset replaces this scope's rules
          const next = deepCopy(this.rules());
          next.base ||= {}; next.levels ||= {};
          if (this.scope === 'level') { if (Object.keys(p.rules).length) next.levels[lk] = deepCopy(p.rules); else delete next.levels[lk]; } else next.base = deepCopy(p.rules);
          this.store.setGame('rules', next, `Game rules: ${p.label}${this.scope === 'level' ? ` in ${lname}` : ''}`);
          this.apply();
          this.toast?.(`${p.label} rules${this.scope === 'level' ? ` for ${lname}` : ''}`, 'check');
          this.render();
        };
        grid.appendChild(b);
      }
      main.appendChild(grid);
      return;
    }
    const sec = SECTIONS.find((s) => s.id === this.section);
    if (this.section === 'moves') {
      main.appendChild(el('div', 'gr-hint', 'Switched-off moves turn into a normal jump (or nothing).'));
      const grid = el('div', 'gr-toggles');
      for (const [k, label] of Object.entries(MOVE_LABELS)) {
        const on = eff.moves[k] !== false;
        const b = el('button', `gr-toggle${on ? ' on' : ''}${this.scope === 'level' && lvl.moves?.[k] !== undefined ? ' over' : ''}`, `<span class="dot"></span>${esc(label)}`);
        b.onclick = () => { this.set({ moves: { [k]: !on } }, `${on ? 'Switched off' : 'Switched on'} the ${label.toLowerCase()}`); this.render(); };
        grid.appendChild(b);
      }
      main.appendChild(grid);
    }
    if (this.section === 'items') {
      main.appendChild(el('div', 'gr-hint', 'Shotgun Mario (from Shoggoth World): J or Q fires, fire in the air for a shotgun jump, R aims. Without this rule, Mario gets the gun from a <b>Shotgun</b> pickup (Objects → Shoggoth) or a story action.'));
      main.appendChild(el('div', 'gr-hint', 'Katana Mario (from Shoggoth World\'s maid café): J cuts (three in a row), J in the air spins, Shift+J dashes, running J lunges. Without this rule, Mario pulls the <b>Legendary Blade</b> out of the floor (Objects → Shoggoth). He carries one weapon at a time.'));
    }
    if (this.section === 'hud') {
      const grid = el('div', 'gr-toggles');
      for (const [k, label] of Object.entries(HUD_LABELS)) {
        const on = eff.hud[k] !== false;
        const b = el('button', `gr-toggle${on ? ' on' : ''}`, `<span class="dot"></span>${esc(label)}`);
        b.onclick = () => { this.set({ hud: { [k]: !on } }, `${on ? 'Hid' : 'Showed'} the ${label.toLowerCase()}`); this.render(); };
        grid.appendChild(b);
      }
      main.appendChild(grid);
    }
    for (const [k, label, min, max, step, unit, hint] of sec.fields || []) {
      const v = eff[k];
      const row = el('div', `gr-row${overridden(k) ? ' over' : ''}`);
      const dflt = RULE_DEFAULTS[k];
      row.innerHTML = `<label><span>${esc(label)}${hint ? `<i title="${esc(hint)}">?</i>` : ''}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${v}"><input type="number" min="${min}" max="${max}" step="${step}" value="${round(v, 2)}"><b>${esc(unit)}</b>
        <button class="gr-reset" title="Back to ${esc(String(dflt))}" ${v === dflt && !overridden(k) ? 'hidden' : ''}>↺</button></label>`;
      const [range, num] = row.querySelectorAll('input');
      const commit = (val) => { const x = clamp(Number(val), min, max); if (!Number.isFinite(x)) return; this.set({ [k]: x }, `${label}: ${round(x, 2)}${unit}`); this.render(); };
      range.oninput = () => { num.value = range.value; this.preview({ [k]: Number(range.value) }); };
      range.onchange = () => commit(range.value);
      num.onchange = () => { if (num.value.trim() === '') { this.render(); return; } commit(num.value); }; // empty is not 0 (the minimum)
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); e.stopPropagation(); });
      row.querySelector('.gr-reset').onclick = () => { this.set({ [k]: this.scope === 'level' ? undefined : dflt }, `${label}: back to normal`); this.render(); };
      main.appendChild(row);
    }
    for (const [k, label] of CHECKS[this.section] || []) {
      const row = el('label', `gr-check${overridden(k) ? ' over' : ''}`);
      row.innerHTML = `<input type="checkbox" ${eff[k] ? 'checked' : ''}> ${esc(label)}`;
      row.querySelector('input').onchange = (e) => {
        const ch = { [k]: e.target.checked };
        // one weapon at a time: the shotgun and the katana exclude each other
        if (e.target.checked && (k === 'shotgun' || k === 'katana')) ch[k === 'shotgun' ? 'katana' : 'shotgun'] = this.scope === 'level' ? false : undefined;
        this.set(ch, `${label}: ${e.target.checked ? 'on' : 'off'}`);
        this.render();
      };
      main.appendChild(row);
    }
  }

  // Dragging a slider: the engine gets it right away, saving waits for the release.
  preview(changes) {
    const M = this.engine.M;
    if (!M?._studio_rules_set) return;
    const lk = levelKeyOf(this.engine);
    const all = this.rules();
    let r = effectiveRules(all, lk);
    r = merge(r, changes);
    withFloats(this.engine, encodeRules(r), (p, n) => M._studio_rules_set(p, n));
  }
}
