// The standalone player: plays a hack without the editor or the chat.
//
// Served two ways:
//  - inside Studio 64 at /play.html?p=<project id> (the hack comes from the server), and
//  - from a standalone export (any static host): data/hack.json + data/catalog.json.
// The game itself is the same engine; World applies terrain, sculpting, level settings,
// songs and studio stars exactly like the studio does.
import { Engine } from './engine.js';
import { Studio } from './studio.js';
import { World } from './world.js';
import { SfxPlayer } from './sfx.js';
import { installObjectsEngine } from './objects/index.js';
import { Assets } from './assets.js';
import { WorldFlow } from './worldflow.js';
import { attachStoryRuntime } from './story/index.js';
import { PathsRuntime } from './paths/runtime.js';
import { HackSave } from './savegame.js';
import { playerLaunch } from './title/player.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URL(location.href).searchParams;
const LIVE = params.get('p'); // a project on the studio server
const NOTE = 'This game is built from a Super Mario 64 ROM and contains Nintendo\'s copyrighted code, graphics and sounds. Share it privately; do not upload it publicly or sell it.';

const state = { hack: null, catalog: null, engine: null, world: null, playing: false, menu: false };
window.studioPlayer = state; // for other features (and the tests)

function toast(text) {
  const box = $('#toasts');
  const t = el('div', 'pl-toast', esc(text));
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
}

async function load() {
  const key = (() => { try { return localStorage.getItem('studio64.password') || ''; } catch { return ''; } })();
  const get = (url) => fetch(url, { headers: { 'x-studio-key': key } }).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
  const [hack, catalog] = LIVE
    ? await Promise.all([get(`/api/projects/${encodeURIComponent(LIVE)}/play.json`), get('/api/catalog')])
    : await Promise.all([get('data/hack.json'), get('data/catalog.json')]);
  state.hack = hack;
  state.catalog = catalog;
  window.studioAssetBase = LIVE ? `/api/projects/${encodeURIComponent(LIVE)}/assets/` : 'assets/project/';
  showTitle();
  boot();
  // the hack's own launch screen (splash screens, title, file select) instead of the card
  playerLaunch(state, {
    stage: $('#stage'), legal: NOTE,
    onPlay: (how) => {
      if (how === 'new') state.save.reset({ world: state.world, story: state.storyRuntime, flow: state.worldFlow });
      start();
    },
  });
}

// ---- the title card -------------------------------------------------------------------

function levelCount() { return (state.hack.levels || []).length; }

function starCount() {
  let n = 0;
  for (const a of Object.values(state.hack.patch?.areas || {})) n += (a.objects || []).filter((r) => r.star || r.entry === 'star' || r.entry === 'hidden_red_coin_star').length;
  return n;
}

function showTitle() {
  const h = state.hack;
  const meta = h.meta || {};
  document.title = h.name || 'Super Mario 64 hack';
  $('#hack-name').textContent = h.name || 'Untitled hack';
  $('#hack-author').textContent = meta.author ? `by ${meta.author}` : '';
  $('#hack-desc').textContent = meta.description || '';
  const facts = [];
  if (levelCount()) facts.push(`${levelCount()} new level${levelCount() > 1 ? 's' : ''}`);
  if (starCount()) facts.push(`${starCount()} new star${starCount() > 1 ? 's' : ''}`);
  if (h.audio?.songs?.length) facts.push(`${h.audio.songs.length} song${h.audio.songs.length > 1 ? 's' : ''}`);
  $('#hack-facts').innerHTML = facts.map((f) => `<span>${esc(f)}</span>`).join('');
  $('#legal').textContent = NOTE;
  const pic = meta.cover || Object.values(h.thumbs || {})[0];
  if (pic) {
    const bd = $('#backdrop');
    bd.style.backgroundImage = `url("${pic}")`;
    bd.classList.add('img');
    if (meta.cover) {
      const img = el('img', 'pl-cover');
      img.src = meta.cover;
      img.alt = '';
      $('.pl-card').prepend(img);
      $('.pl-card').classList.add('has-cover');
    }
  }
  $('#play-btn').onclick = start;
}

function start() {
  if (!state.engine?.ready) return;
  $('#title').hidden = true;
  $('#hud').hidden = false;
  state.playing = true;
  $('#canvas').focus();
  try { state.storyRuntime?.begin(); } catch (err) { console.warn('story start', err); } // a new save: the hack's start and opening
}

// ---- the game ---------------------------------------------------------------------------

const progressKey = () => `studio64.play.${state.hack.id || 'hack'}`;

function boot() {
  const h = state.hack;
  const engine = new Engine($('#canvas'), state.catalog);
  state.engine = engine;
  const world = new World({ engine, patch: () => engine.patch, commit: () => {}, projectId: () => `play-${h.id || 'hack'}`, toast });
  state.world = world;
  world.getSongs = () => h.audio?.songs || [];
  engine.setPatch(h.patch || { areas: h.areas || {} });
  // the same runtime as the studio (without the editor): custom objects and game rules,
  // imported models and textures, warps between levels, story events; each one optional
  const send = () => {}; // nothing is saved: the player only plays
  state.studio = new Studio(engine, state.catalog);
  state.studio.world = world;
  state.studio.customLevels = () => h.levels || [];
  state.projectId = `play-${h.id || 'hack'}`;
  state.levels = h.levels || [];
  state.story = h.story;
  const optional = (name, fn) => { try { return fn(); } catch (err) { console.warn(`player: ${name} unavailable`, err); return null; } };
  state.objects = optional('objects', () => installObjectsEngine({ engine, studio: state.studio, send, toast, flash: () => {} }));
  state.assets = optional('assets', () => {
    const a = new Assets({ engine, getProjectId: () => LIVE || 'project', getPassword: () => '', getClientId: () => 'player', toast, commit: () => {}, getPatch: () => engine.patch });
    // a standalone export keeps the project's files in assets/project/
    if (!LIVE) a.base = () => 'assets/project';
    a.setMeta(h.assets || {}, true);
    a.loaded = true;
    return a;
  });
  state.worldFlow = optional('worldflow', () => {
    const wf = new WorldFlow({ engine, world, send, toast, getLevels: () => h.levels || [], catalog: state.catalog });
    state.studio.worldFlow = wf;
    wf.onPatch?.();
    return wf;
  });
  optional('paths', () => new PathsRuntime({ engine, world, assets: state.assets, toast })); // roads, fences, plants
  optional('story', () => attachStoryRuntime(state, { frame: $('#stage'), toast, autoStart: false })); // the story begins with Play

  // the star select screen, the castle's pause pages and the course complete screen
  engine.introInfo = (level) => {
    if (level === engine.studioLevel) {
      const key = `c:${engine.customLevel || 'default'}`;
      // every area of the level (sub-areas are c:<id>:<n>)
      return { title: levelName(key), stars: world.levelStars(key), score: world.coinScore(key) };
    }
    const info = Object.values(state.catalog.levels).find((l) => l.num === level);
    const keys = Object.keys(engine.patch.areas || {}).filter((k) => k.startsWith(`${level}:`)).sort();
    return { title: info?.name, stars: keys.flatMap((k) => world.stars(k)) };
  };
  engine.pauseLevels = () => (h.levels || []).map((l) => {
    const key = `c:${l.id}`;
    const stars = world.levelStars(key);
    return { name: l.name, stars: stars.filter((s) => s.kind !== 'coins100').map((s) => (s.done ? '1' : '0')).join(''), coins: world.coinScore(key), coinStar: stars.some((s) => s.kind === 'coins100' && s.done) };
  });
  engine.starInfo = (uid, index) => ({ title: levelName(engine.areaKey()), name: world.findStar(engine.areaKey(), uid, index)?.name || 'Star' });
  const syncStars = () => engine.setBonusStars(world.collectedTotal());
  engine.on('star', (ev) => { world.onStarCollected(ev); syncStars(); });

  // sounds the hack replaced
  const sfx = new SfxPlayer();
  engine.onGameSound = (id, dist) => {
    const o = h.audio?.overrides?.[id];
    const s = o && h.audio.sounds.find((x) => x.id === o.sound);
    if (s) sfx.play(s, dist);
  };
  engine.on('ready', () => {
    syncStars();
    engine.setSoundOverrides((h.audio?.overrides || []).map((o, i) => ({ bits: o.bits, id: i })));
  });
  engine.on('crash', () => { $('#crash').hidden = false; });

  const keysBlocked = () => !state.playing || state.menu;
  // this hack's own save (the game's save, stars, story) in this browser (savegame.js)
  state.save = new HackSave({ pid: state.projectId });
  state.save.attach(engine);
  engine.boot({ level: h.boot?.level || 16, act: 1, base: 'engine/', keysBlocked }).then(() => {
    fit();
    $('#progress').classList.add('done');
    $('#play-btn').disabled = false;
    $('#play-label').textContent = 'Play';
    // a hack that starts in one of its own levels
    // (the game refuses a jump while the boot level's entry transition still runs: try again
    // until it went, else the hack would start in the castle grounds)
    if (h.boot?.custom && (h.levels || []).some((l) => l.id === h.boot.custom)) {
      const go = (n) => {
        // (a launch screen or the story's own start take over the start)
        if (engine.level === engine.studioLevel || (n > 0 && (state.launch || (state.playing && (h.story?.start?.custom || h.story?.start?.level))))) return;
        if (n === 0 || !(engine.M._studio_story_debug?.() & 2)) engine.warpFast(engine.studioLevel, 0, h.boot.custom, false);
        if (n < 40) setTimeout(() => go(n + 1), 500);
      };
      go(0);
    }
    document.dispatchEvent(new CustomEvent('studio-player-ready', { detail: state }));
  }).catch((err) => { $('#play-label').textContent = `Could not load the game: ${err.message}`; });
  new ResizeObserver(fit).observe($('#stage'));
}

function fit() {
  if (!state.engine?.ready) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = $('#stage');
  state.engine.resize(Math.round(s.clientWidth * dpr), Math.round(s.clientHeight * dpr));
}

function levelName(key) {
  if (key.startsWith('c:')) return (state.hack.levels || []).find((l) => l.id === key.slice(2).split(':')[0])?.name || 'Custom level';
  const num = Number(key.split(':')[0]);
  return Object.values(state.catalog.levels).find((l) => l.num === num)?.name || `Level ${num}`;
}

// ---- the level list -----------------------------------------------------------------------

function levelList() {
  const h = state.hack;
  const out = (h.levels || []).map((l) => ({ key: `c:${l.id}`, custom: l.id, name: l.name }));
  const nums = new Set([16]);
  for (const [key, a] of Object.entries(h.patch?.areas || {})) {
    if (key.startsWith('c:')) continue;
    if ((a.objects || []).length || (a.removals || []).length || (a.sculpt || []).length || a.settings) nums.add(Number(key.split(':')[0]));
  }
  for (const n of nums) {
    const info = Object.values(state.catalog.levels).find((l) => l.num === n);
    if (info) out.push({ key: `${n}:1`, num: n, name: info.name });
  }
  return out;
}

function openLevels() {
  const grid = $('#level-grid');
  grid.innerHTML = '';
  const e = state.engine;
  for (const l of levelList()) {
    const stars = state.world.levelStars(l.key).filter((s) => s.kind !== 'coins100' || l.custom);
    const got = stars.filter((s) => s.done).length;
    const b = el('button', `pl-level${e.areaKey().split(':')[0] === l.key.split(':')[0] && (!l.custom || e.customLevel === l.custom) ? ' here' : ''}`);
    const pic = state.hack.thumbs?.[l.key] || (l.num ? `thumbs/levels/${l.num}.jpg` : null);
    b.innerHTML = `<div class="pic"${pic ? ` style="background-image:url('${pic}')"` : ''}>${pic ? '' : '★'}</div>
      <div class="meta"><div class="nm">${esc(l.name)}</div><div class="st">${stars.length ? `★ ${got} / ${stars.length}` : '&nbsp;'}</div></div>`;
    b.onclick = () => {
      closeLevels();
      if (l.custom) e.warpFast(e.studioLevel, 0, l.custom);
      else e.warpFast(l.num, 0);
      toast(`Going to ${l.name}`);
    };
    grid.appendChild(b);
  }
  $('#levels').hidden = false;
  state.menu = true;
  e.releaseKeys();
  grid.querySelector('button')?.focus();
}

// A fresh save: the game's save file, the hack's stars, keys and doors, the story; then the start.
function newGame() {
  state.save.reset({ world: state.world, story: state.storyRuntime, flow: state.worldFlow });
  closeLevels();
  if (state.storyRuntime) state.storyRuntime.playFromStart({ reset: false });
  else location.reload();
  toast('New game');
}

function closeLevels() {
  $('#levels').hidden = true;
  state.menu = false;
  $('#canvas').focus();
}

function wire() {
  $('#levels-btn').onclick = () => (state.menu ? closeLevels() : openLevels());
  $('#levels-close').onclick = closeLevels;
  const ng = $('#newgame-btn');
  if (ng) ng.onclick = () => {
    // two clicks: the progress is gone for good
    if (!ng.classList.contains('sure')) { ng.classList.add('sure'); ng.querySelector('span').textContent = 'Erase progress?'; setTimeout(() => { ng.classList.remove('sure'); ng.querySelector('span').textContent = 'New game'; }, 3000); return; }
    newGame();
  };
  $('#levels').addEventListener('mousedown', (e) => { if (e.target.id === 'levels') closeLevels(); });
  $('#full-btn').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else $('#stage').requestFullscreen?.(); $('#canvas').focus(); };
  $('#crash-restart').onclick = () => location.reload();
  // (capture, and the game never sees these keys: L is also a crouch key and Enter is Start,
  // so closing the level list with L would crouch / ground-pound and Enter on the title card
  // would pause the game on its first frame)
  const mine = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  window.addEventListener('keydown', (e) => {
    if (!state.playing) { if (!state.launch && e.key === 'Enter' && !$('#play-btn').disabled) { mine(e); start(); } return; }
    if (e.code === 'KeyL' && !e.ctrlKey) { mine(e); if (state.menu) closeLevels(); else openLevels(); }
    else if (e.key === 'Escape' && state.menu) { mine(e); closeLevels(); }
    else if (e.code === 'KeyF' && !state.menu && !e.ctrlKey) { e.preventDefault(); $('#full-btn').click(); }
  }, true);
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyL' && !e.ctrlKey && state.playing) e.stopImmediatePropagation(); }, true);
  $('#canvas').addEventListener('mousedown', () => { if (state.playing) $('#canvas').focus(); });
  document.addEventListener('fullscreenchange', () => setTimeout(fit, 50));
}

wire();
load().catch((err) => {
  console.error(err);
  $('#hack-name').textContent = 'Could not load this hack';
  // in words a player understands (not "…/play.json: 404")
  const m = String(err.message || '');
  $('#play-label').textContent = /: 404$/.test(m) ? 'This hack is not on this server (any more).'
    : /: 401$/.test(m) ? 'This server is protected: open Studio 64 and enter its password first.'
    : /engine/i.test(m) ? 'The game files are missing. Run the Studio 64 setup (npm start) first.'
    : /fetch|network/i.test(m) ? 'Can\'t reach the server. Is Studio 64 still running?'
    : m;
});
