// Katana Mario and the katana fighters (ported from the Shoggoth World hack, its maid cafe):
// the browser side.
//
//   - a level starts: the blade starts over (studio_katana_level_start), held when the game rule "Mario
//     starts with the katana" is on for this level (game_rules.js passes live rule changes)
//   - the duel's speeches go to the engine as dialogs, its battle theme into the preview song slot
//     (data/katana.json, made by tools/katana_extract.py from the hack)
//   - over the game: the fighters' lines in bubbles, "B  Pull the legendary blade", the cosplayers left,
//     the white flash of the finale; a how-to card the first time Mario pulls the blade
//   - duels get their settings (the star) when they spawn; their events go to the story
//     ("studio:katana": { kind: 'katana_duel', uid, result: start | won | lost })
//   - build mode: the fighter's look, the duel's reward star; RPCs for the AI tools (server/tools/katana.js)
//
// Engine side: engine/src/studio/katana.c, katana_fighters.c (docs/katana.md).

import { levelKeyOf, el, esc, svg } from './objects/common.js';
import { registerRpc } from './studio.js';
import { encodeBytes, loadTexts } from './story/text.js';

export const BLADE_ENTRY = 'kt:blade';
export const FIGHTER_ENTRY = 'kt:fighter';
export const DUEL_ENTRY = 'kt:duel';
export const isKatana = (rec) => String(rec?.entry || '').startsWith('kt:');
export const FIGHTER_LOOKS = [[0, 'Mario (the boss)'], [1, 'Luigi'], [2, 'Wario'], [3, 'Waluigi'], [4, 'Peach'], [5, 'Yoshi']];
const WHO = ['WHO_MARIO', 'WHO_LUIGI', 'WHO_WARIO', 'WHO_WALUIGI', 'WHO_PEACH', 'WHO_YOSHI', 'WHO_MAID'];
const WHO_COLOR = ['#aa3c35', '#3c8a3c', '#9a8410', '#7a50aa', '#aa5a8a', '#3c8a30', '#aa5a8a'];
// the duel's speeches: project dialog ids the engine opens (katana.h KT_DIALOG_*)
const DIALOGS = { challenge: 256 + 2040, katana: 256 + 2041, rematch: 256 + 2042, defeat: 256 + 2043 };

let data = null;
let dataLoad = null;
export function katanaData() {
  dataLoad ||= fetch(new URL('../data/katana.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((d) => { data = d; return d; }).catch(() => null);
  return dataLoad;
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../css/katana.css', import.meta.url).href;
  document.head.appendChild(l);
}

const host = () => document.querySelector('#game-frame') || document.querySelector('#stage') || document.body;

// The how-to card: B is J, Z is Shift.
function showHowTo() {
  loadCss();
  host().querySelector?.('.kt-howto')?.remove();
  const card = document.createElement('div');
  card.className = 'kt-howto';
  card.setAttribute('role', 'status');
  card.innerHTML = `<b>The Legendary Blade!</b>
    <div class="kt-keys">
      <span><kbd>J</kbd> cut &middot; press again for the three-cut combo</span>
      <span><kbd>J</kbd> in the air: <em>spin slash</em> &middot; running <kbd>J</kbd>: <em>lunge</em></span>
      <span><kbd>Shift</kbd> + <kbd>J</kbd>: <em>dash slash</em> (the cuts land a beat later)</span>
    </div>`;
  host().appendChild(card);
  setTimeout(() => card.classList.add('out'), 6500);
  setTimeout(() => card.remove(), 7200);
}

export function katanaState(engine) {
  try { return engine.json('studio_katana_state_json'); } catch { return null; }
}

// The overlay: bubbles, the pull prompt, the cosplayers left, the finale's flash.
class KatanaHud {
  constructor() {
    loadCss();
    this.root = el('div', 'kt-hud');
    this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = '<div class="kt-flash"></div><div class="kt-bubbles"></div><div class="kt-prompt" hidden><kbd>B</kbd> Pull the legendary blade</div><div class="kt-count" hidden><span class="kt-heart">♥</span><span>COSPLAYERS</span><b></b></div>';
    this.last = '';
  }

  attach() {
    const h = host();
    if (this.root.parentNode !== h) h.appendChild(this.root);
  }

  update(s) {
    if (!s) return;
    this.attach();
    const d = s.duel || {};
    const bubbles = d.bubbles || [];
    const key = JSON.stringify([bubbles.map((b) => [b.who, b.line]), s.prompt, d.running && (d.phase === 'fight' || d.phase === 'fight_start') ? d.alive : -1]);
    if (key !== this.last) {
      this.last = key;
      const lines = data?.lines || {};
      this.root.querySelector('.kt-bubbles').innerHTML = bubbles.map((b) => `<div class="kt-bubble"><b style="color:${WHO_COLOR[b.who] || '#a35'}">${esc(lines[WHO[b.who]] || '')}</b> ${esc(lines[b.line] || b.line)}<span class="kt-bheart">♥</span></div>`).join('');
      this.root.querySelector('.kt-prompt').hidden = !s.prompt;
      const counting = d.running && (d.phase === 'fight' || d.phase === 'fight_start') && d.alive > 0;
      this.root.querySelector('.kt-count').hidden = !counting;
      if (counting) this.root.querySelector('.kt-count b').textContent = String(d.alive);
    }
    // (fading out: the last frames of a line)
    this.root.querySelectorAll('.kt-bubble').forEach((n, i) => { n.style.opacity = bubbles[i] && bubbles[i].timer < 10 ? String(bubbles[i].timer / 10) : '1'; });
    const f = this.root.querySelector('.kt-flash');
    f.style.opacity = d.flash > 0 ? String(Math.min(1, d.flash * 20 / 255)) : '0';
  }

  clear() {
    this.last = '';
    this.root.querySelector('.kt-bubbles').innerHTML = '';
    this.root.querySelector('.kt-prompt').hidden = true;
    this.root.querySelector('.kt-count').hidden = true;
  }
}

// Installed by installObjectsEngine (studio and standalone player).
export function installKatana({ engine, rules, store, studio, toast }) {
  let lastLevel = null;
  let howToShown = false;
  let hud = null;
  let songSeq = -1;
  const won = new Set();
  const world = () => studio?.world;
  const ruleOn = () => { try { return !!rules?.current?.katana; } catch { return false; } };
  const starDone = (rec, key = engine.areaKey()) => !!(rec.star && world()?.progress?.()[`${key}|${rec.uid}`]);
  const slotOf = (uid) => { try { return engine.objects().find((o) => o.uid === uid)?.slot ?? -1; } catch { return -1; } };
  const configDuel = (rec, slot) => {
    if (slot < 0 || !engine.M?._studio_katana_duel_config) return;
    engine.M._studio_katana_duel_config(slot, rec.star ? 1 : 0, starDone(rec) ? 1 : 0);
  };

  // the speeches as dialogs (the story's text tables must be there to encode them)
  let dialogsSet = null;
  const setDialogs = async () => {
    const M = engine.M;
    if (!M?._studio_text_dialog) return;
    const d = await katanaData();
    if (!d?.dialogs) return;
    try { await loadTexts(); } catch { return; }
    for (const [k, id] of Object.entries(DIALOGS)) {
      const text = d.dialogs[k];
      if (!text) continue;
      const bytes = encodeBytes(text);
      const p = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, p);
      M._studio_text_dialog(id, p, bytes.length, 3, 30, 200, 0, 0);
      M._free(p);
    }
    dialogsSet = M;
  };

  const playSong = async (on) => {
    const M = engine.M;
    if (!M) return;
    if (!on) { if (songSeq >= 0) { try { M._studio_music_restore?.(); } catch { /* old engine */ } } songSeq = -1; return; }
    const d = await katanaData();
    const song = d?.song;
    if (!song?.m64 || !engine.hasSoundBank?.(song.bank)) return;
    const bytes = Uint8Array.from(atob(song.m64), (c) => c.charCodeAt(0));
    const p = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, p);
    songSeq = M._studio_song_install(1, p, bytes.length, song.bank);
    M._free(p);
    if (songSeq >= 0) M._studio_music_preview(songSeq);
  };

  const onEvent = (kind, uid, value) => {
    const rec = store?.recordOf?.(uid) || null;
    if (kind === 'pulled' && !howToShown) { howToShown = true; showHowTo(); }
    if (kind === 'music') playSong(value === 1);
    if (kind === 'won') won.add(uid);
    const result = { start: 'start', won: 'won', lost: 'lost' }[kind];
    const detail = { engine, name: kind, uid, value, record: rec, kind: result ? 'katana_duel' : 'katana', result, event: kind };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('studio:katana', { detail }));
      if (kind === 'won' && rec && !rec.star) toast?.('You won the katana duel!', 'sparkles');
    }, 0);
  };

  // (after the objects' level hook: the rules of the new level are applied by then)
  engine.levelHooks.push(() => {
    const M = engine.M;
    if (!M?._studio_katana_level_start) return;
    const key = levelKeyOf(engine);
    if (key !== lastLevel) {
      lastLevel = key;
      M._studio_katana_level_start(ruleOn() ? 1 : 0);
      if (songSeq >= 0) songSeq = -1;
      hud?.clear();
    }
    M.studioKatanaEvent = onEvent;
    if (dialogsSet !== M) setDialogs();
  });

  // every duel gets its settings when it spawns
  const spawn = engine._spawnRecord.bind(engine);
  engine._spawnRecord = (rec) => {
    const slot = spawn(rec);
    if (slot >= 0 && rec?.entry === DUEL_ENTRY) { try { configDuel(rec, slot); } catch (err) { console.error('katana: spawn', err); } }
    return slot;
  };
  const setPatch = engine.setPatch.bind(engine);
  engine.setPatch = (patch) => {
    setPatch(patch);
    if (!engine.ready || !engine.M?._studio_katana_duel_config || !store?.records) return;
    try { for (const rec of store.records().filter((r) => r.entry === DUEL_ENTRY)) configDuel(rec, slotOf(rec.uid)); } catch (err) { console.error('katana: patch', err); }
  };

  // the overlay, every frame while there is something katana about
  let quiet = 0;
  engine.on?.('frame', () => {
    const M = engine.M;
    if (!M?._studio_katana_state_json) return;
    if (quiet > 0) { quiet--; return; }
    const s = katanaState(engine);
    if (!s) return;
    const busy = s.has || s.prompt || s.duel?.running || s.duel?.bubbles?.length || s.duel?.fighters?.length;
    if (!busy) { if (hud) hud.clear(); quiet = 10; return; }
    hud ||= new KatanaHud();
    hud.update(s);
  });

  const api = {
    state: () => katanaState(engine),
    has: () => engine.M?._studio_katana_has?.() === 1,
    give: (on = true) => { engine.M?._studio_katana_give?.(on ? 1 : 0); return katanaState(engine); },
    won: (uid) => (uid ? won.has(Number(uid)) : won.size > 0),
    pose: (n) => engine.M?._studio_katana_debug_pose?.(n | 0),
    showHowTo,
    data: katanaData,
  };
  window.studio64Katana = api;
  return api;
}

// ---------------------------------------------------------------------------
// Build mode: the duel's reward star, a new duel's defaults

export function installKatanaEditor(ctx, { editor, editorUI }) {
  const { engine } = ctx;
  const makeRecord = editor.makeRecord.bind(editor);
  editor.makeRecord = (item, pose, uid) => {
    const rec = makeRecord(item, pose, uid);
    if (rec?.entry === DUEL_ENTRY && !rec.star && rec.star !== null) {
      // the reward: a star of this level (its own star number, like the Stars tab gives)
      const used = new Set((ctx.studio?.world?.stars?.() || []).map((s) => s.index));
      let index = 0;
      while (used.has(index) && index < 30) index++;
      rec.bparams = (index << 24) >>> 0;
      rec.star = { name: 'Win the katana duel' };
      rec.name = 'Katana duel';
    }
    return rec;
  };

  const render = editorUI.renderInspector.bind(editorUI);
  editorUI.renderInspector = (sel) => {
    render(sel);
    const box = document.querySelector('#inspector');
    if (!sel || !editor.active || !box || box.hidden || sel.rec?.entry !== DUEL_ENTRY) return;
    try {
      for (const s of box.querySelectorAll('.insp-sec')) {
        const label = s.querySelector('.insp-label')?.textContent || '';
        if (/^(Size|Behavior params)/.test(label) || s.classList.contains('obj-motion')) s.remove();
      }
      box.insertBefore(duelSection(sel), box.querySelector('.insp-actions'));
    } catch (err) { console.error('katana: inspector', err); }
  };

  const save = (fields, summary) => {
    editor.updateSelected(fields, summary);
    const rec = editor.sel?.rec;
    if (rec && engine.M?._studio_katana_duel_config) {
      engine.M._studio_katana_duel_config(editor.sel.slot, rec.star ? 1 : 0, rec.star && ctx.studio?.world?.progress?.()[`${engine.areaKey()}|${rec.uid}`] ? 1 : 0);
    }
  };

  // the AI's katana tool (action duel): a duel in front of Mario (or at x, z) with its star
  registerRpc('katana_place_duel', function ({ x, y, z, star_name } = {}) {
    const m = engine.state().mario;
    const yaw = (m?.yaw ?? 0) & 0xffff;
    const a = (yaw / 65536) * Math.PI * 2;
    let px = x, pz = z;
    if (px === undefined || pz === undefined) { px = Math.round((m?.x || 0) + Math.sin(a) * 1100); pz = Math.round((m?.z || 0) + Math.cos(a) * 1100); }
    let py = y;
    if (py === undefined) { const g = engine.floor(px, (m?.y || 0) + 1500, pz); py = g > -20000 ? Math.round(g) : Math.round(m?.y || 0); }
    const rec = editor.makeRecord({ entry: DUEL_ENTRY }, { p: [px, py, pz], yaw: (yaw + 0x8000) & 0xffff }, 1 + Math.floor(Math.random() * 0x7efffffe));
    if (star_name === '' || star_name === null) rec.star = null;
    else if (star_name) rec.star = { name: star_name };
    const slot = engine.spawn(rec);
    const st = engine.state();
    return { level: st.level, area: st.area, key: engine.areaKey(), placed: [{ record: rec, slot }], errors: [] };
  });

  function duelSection(sel) {
    const rec = sel.rec;
    const sec = el('div', 'insp-sec kt-insp');
    sec.innerHTML = `<div class="om-card-head">${svg('star')}<b>Katana duel</b></div>
      <div class="om-note">Six cosplayer fighters stand round this spot. When Mario comes near, the Mario cosplayer challenges him;
      without a katana, Mario pulls the Legendary Blade out of the floor first. Three waves: Luigi, Yoshi and Peach; Wario and Waluigi;
      the Mario cosplayer. If Mario's health runs out, he loses (and gets a rematch).</div>
      <div class="checks"><label><input type="checkbox" data-c="star" ${rec.star ? 'checked' : ''}> A star for winning</label></div>
      ${rec.star ? `<label class="om-row"><span>Star name</span><input type="text" maxlength="40" value="${esc(rec.star.name || '')}"></label>` : ''}
      <div class="om-note">Story events can react too: <i>A katana duel starts or ends</i>.</div>`;
    sec.querySelector('[data-c=star]').onchange = (e) => {
      if (e.target.checked) {
        const used = new Set((ctx.studio?.world?.stars?.() || []).filter((s) => s.uid !== rec.uid).map((s) => s.index));
        let index = 0;
        while (used.has(index) && index < 30) index++;
        save({ star: { name: 'Win the katana duel' }, bparams: (index << 24) >>> 0 }, 'The katana duel gives a star');
      } else save({ star: null }, 'The katana duel gives no star');
      window.studio64?.levelsUI?.renderStars?.();
      editorUI.renderInspector(editor.sel);
    };
    const sn = sec.querySelector('input[type=text]');
    if (sn) {
      sn.addEventListener('keydown', (e) => e.stopPropagation());
      sn.onchange = () => { save({ star: { name: sn.value.trim() || 'Win the katana duel' } }, 'Renamed the duel star'); window.studio64?.levelsUI?.renderStars?.(); };
    }
    return sec;
  }
}

registerRpc('katana_state', function () {
  const s = katanaState(this.engine);
  if (!s) throw new Error('the game is not running');
  return s;
});

registerRpc('katana_give', function ({ on = true } = {}) {
  const M = this.engine.M;
  if (!M?._studio_katana_give) throw new Error('this engine has no katana (rebuild it)');
  if (!this.engine.state().mario) throw new Error('Mario is not in a level');
  M._studio_katana_give(on ? 1 : 0);
  return katanaState(this.engine);
});
