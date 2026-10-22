import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import { Engine } from './engine.js';
import { Studio } from './studio.js';
import { icon } from './icons.js';
import { Editor, isTyping } from './editor.js';
import { EditorUI } from './editor_ui.js';
import { World } from './world.js';
import { LevelsUI } from './levels_ui.js';
import { WorldFlow } from './worldflow.js';
import { HackSave } from './savegame.js';
import { WorldUI } from './world_ui.js';
import { SoundUI } from './sound_ui.js';
import { attachStoryRuntime, attachStoryUI, storyMessage } from './story/index.js';
import { openAiSettings, fetchMenu } from './ai_settings.js';
import { applyAiMode, aiOn } from './ai_mode.js';
import { Assets } from './assets.js';
import { AssetsUI } from './assets_ui.js';
import { Hub } from './hub.js';
import { TestTools } from './testing.js';
import { installObjectsEngine, installObjectsEditor } from './objects/index.js';
import { Shell } from './shell.js';
import { installPathsRuntime, installPathsEditor } from './paths/index.js';
import { CHARACTERS } from './story/schema.js';
import { dropShotgunRules } from './objects/game_rules.js';
import './title/index.js'; // the launch screen: title screen editor, played before Play from start

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
marked.setOptions({ breaks: true, gfm: true });
const md = (text) => DOMPurify.sanitize(marked.parse(text || ''));

const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
const TOOL_ICONS = {
  spawn: 'plus', remove: 'trash', move: 'move', create_pipe: 'pipe', get_terrain: 'mountain', probe_floor: 'crosshair',
  look: 'eye', search_catalog: 'search', list_objects: 'list', get_state: 'gamepad', teleport_mario: 'sparkles',
  warp_to_level: 'door', heal_mario: 'heart', list_changes: 'clock', undo: 'undo',
  // every other tool gets a fitting icon too (icons.js)
  add_star: 'star', list_stars: 'star', build: 'blocks', modify: 'settings', create_level: 'globe', level_settings: 'settings',
  terrain: 'terrain', compose_song: 'music', music_library: 'music', sound_effect: 'wave',
  clear_skybox: 'image', set_skybox: 'image', edit_textures: 'image', search_textures: 'search', list_assets: 'cube', place_model: 'cube', set_mario_colors: 'sparkles',
  arrange_objects: 'layers', attach_motion: 'route', trigger_motion: 'route', set_object_path: 'route', get_object_path: 'route',
  create_custom_object: 'objects', edit_custom_object: 'objects', list_custom_objects: 'objects', place_custom_object: 'objects', make_prefab: 'layers', list_scene: 'layers',
  get_game_rules: 'gamepad', set_game_rules: 'gamepad', debug_view: 'bug', play_from_here: 'play', validate_level: 'check',
  list_versions: 'clock', save_version: 'download', version_changes: 'clock', set_save_file: 'download',
  add_event: 'zap', add_npc: 'user', add_variable: 'zap', add_zone: 'crosshair', cutscene: 'film', delete_story_item: 'trash', find_game_text: 'book', make_talk: 'message',
};
const WRITE_TOOLS = new Set(['spawn', 'remove', 'move', 'create_pipe', 'undo', 'teleport_mario', 'warp_to_level', 'heal_mario']);
// one idea for each part of the studio: objects, building, story, sound, rules, warps
const SUGGESTIONS = [
  { icon: 'plus', text: 'Add 2 Bob-ombs in front of me' },
  { icon: 'tower', text: 'Build a tower with a star on top' },
  { icon: 'user', text: 'Put a Toad here who says where the red coins are' },
  { icon: 'music', text: 'Compose a spooky song for this level' },
  { icon: 'gamepad', text: 'Let Mario jump twice as high' },
  { icon: 'pipe', text: 'Add a pipe that leads to the top of the mountain' },
];

const state = {
  config: null, catalog: null, engine: null, studio: null, ws: null, projectId: null, clientId: null,
  project: null, busy: false, turn: null, model: null, changes: [], connected: false, booted: false,
  password: store.get('studio64.password') || '', reconnectDelay: 500, chatCount: 0,
  levels: [], thumbs: {}, attachments: [],
};

// ---------------------------------------------------------------------------
// boot

async function main() {
  const [config, catalog] = await Promise.all([
    fetch('/api/config', { headers: { 'x-studio-key': state.password } }).then((r) => r.json()), // a right key also sets the password cookie (pictures, downloads)
    fetch('/api/catalog').then((r) => r.json()),
  ]);
  state.config = config;
  state.catalog = catalog;
  // the Super Mario Sunshine characters exist only when they were converted from a disc (first-run setup)
  const sunshine = catalog.entries.some((e) => e.id.startsWith('sms:'));
  document.body.classList.toggle('no-sunshine', !sunshine);
  if (!sunshine) for (let i = CHARACTERS.length - 1; i >= 0; i--) if (CHARACTERS[i].entry?.startsWith('sms:')) CHARACTERS.splice(i, 1);
  // Shotgun Mario and Katana Mario: only in an engine built with them (the Shoggoth content ships with Studio 64)
  const noWeapon = [['sg:shotgun', 'shotgun'], ['kt:blade', 'katana']].filter(([id]) => !catalog.entries.some((e) => e.id === id)).map(([, k]) => k);
  if (noWeapon.length) dropShotgunRules(noWeapon);
  state.model = store.get('studio64.model') || config.defaultModel;
  state.projectId = new URL(location.href).searchParams.get('p') || store.get('studio64.lastProject');
  applyAiMode(config.ai); // no AI connected or turned off: body.no-ai hides every [data-ai] element
  setupUi();
  // the project home screen (hub.js): shown instead of a project when there is none to open
  state.hub = new Hub({ state, send, toast, modal, closeModal });
  if (state.hub.startHome()) { $('#loading').hidden = true; return; }
  connect();
}

function bootEngine(level) {
  if (state.engine) return;
  const canvas = $('#canvas');
  const engine = new Engine(canvas, catalog());
  state.engine = engine;
  state.studio = new Studio(engine, catalog());
  state.hub?.watchEngine(engine); // crash and hang recovery (hub.js)
  // terrain, sculpting and level settings must be in place before the first area loads
  state.world = new World({
    engine, patch: () => engine.patch, toast, projectId: () => state.projectId,
    commit: (op) => { send({ type: 'edit', op }); flashSaved(); },
  });
  state.studio.world = state.world;
  // objects, motion, custom objects and game rules (objects/): hooks before the first area loads
  state.objects = installObjectsEngine({ engine, studio: state.studio, send, toast, flash: flashSaved });
  // imported models, replaced textures, materials, skies, Mario's colours (assets.js)
  state.assets = new Assets({
    engine, getProjectId: () => state.projectId, getPassword: () => state.password, getClientId: () => state.clientId, toast,
    commit: (op) => { send({ type: 'edit', op }); flashSaved(); }, getPatch: () => engine.patch,
  });
  state.assets.load();
  // roads, fences and painted plants (paths/): before the first area loads
  state.paths = installPathsRuntime({ engine, world: state.world, assets: state.assets, toast });
  // areas, warps, hub and environment (worldflow.js); before the first area loads
  state.worldFlow = new WorldFlow({ engine, world: state.world, send, toast, getLevels: () => state.levels, catalog: catalog() });
  state.studio.worldFlow = state.worldFlow;
  state.worldFlow.onPatch();
  state.studio.customLevels = () => state.levels;
  attachStoryRuntime(state, { frame: $('#game-frame'), toast }); // story texts, events and cutscenes: before the first area loads
  // composed songs play as level music; the level panel opens the sound studio
  state.world.getSongs = () => state.audio?.songs || [];
  state.world.openSoundStudio = (tab) => state.soundUI?.open(tab);
  engine.on('crash', (what) => {
    console.error('engine crash', what);
    $('#crash').hidden = false;
    $('#start').hidden = true;
  });
  engine.on('area', (lvl) => {
    updateLevelChip(lvl);
    // a new area invalidates the selection, ghosts and camera of build mode
    // (the level launcher brings build mode back when you switched levels from it)
    if (state.editor?.active) state.editor.exit();
    // reopen this project where you left it (not the boot level: setupEditor reads this after booting)
    if (state.editor) try { store.set(`studio64.last.${state.projectId}`, JSON.stringify(lvl === engine.studioLevel ? { custom: engine.customLevel } : { num: lvl })); } catch { /* ignore */ }
  });
  const info = levelInfo(level);
  // the play-test save of this project (the game's save, stars, story), mirrored to the server
  state.save = new HackSave({ pid: state.projectId, server: `/api/projects/${encodeURIComponent(state.projectId)}`, password: () => state.password });
  state.save.attach(engine);
  state.save.pull().then(() => engine.boot({ level, act: 1, base: new URL(location.href).searchParams.get('engine') ? `engine_${new URL(location.href).searchParams.get('engine')}/` : 'engine/', keysBlocked })).then(() => {
    state.booted = true;
    $('#loading').hidden = true;
    if (!state.playing) $('#start').hidden = false;
    setPlaying(!!state.playing);
    fitCanvas();
    setupEditor();
    state.shell?.maybeTour(); // first visit: the 60-second tour
    if (info?.acts === false) { /* nothing */ }
  }).catch((err) => {
    loadFailed('The game could not be loaded', /engine/.test(err.message) ? 'The game is not built yet, or its files are missing. Start Studio 64 again (its Start file, or npm start): the setup builds it.' : err.message);
  });
  engine.setPatch(state.patch);
  new ResizeObserver(fitCanvas).observe($('#game-frame'));
  setInterval(updateCoords, 250);
}

const catalog = () => state.catalog;
window.studio64 = state; // handy from the devtools console

function levelInfo(num) {
  for (const [slug, info] of Object.entries(state.catalog.levels)) if (info.num === num) return { slug, ...info };
  return null;
}

function fitCanvas() {
  if (!state.engine?.ready) return;
  const f = $('#game-frame');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.engine.resize(Math.round(f.clientWidth * dpr), Math.round(f.clientHeight * dpr));
}

// ---------------------------------------------------------------------------
// websocket

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    state.reconnectDelay = 500;
    send({ type: 'hello', projectId: state.projectId, password: state.password, level: 9 });
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    state.connected = false;
    $('#level-chip').classList.add('offline');
    setTimeout(connect, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 8000);
  };
}

function send(msg) {
  if (state.leaving && LEAVE_TYPES.has(msg.type) && sendOnLeave(msg)) return;
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
  else state.hub?.queue(msg); // offline: project changes wait for the server (hub.js)
}

// The page is closing or reloading: the panels flush their waiting edits (story text, songs,
// sounds) on pagehide, but a websocket message sent then may never leave. A keepalive request
// does (POST /api/projects/:id/send, handled like the websocket message on the server).
const LEAVE_TYPES = new Set(['edit', 'level_create', 'level_rename', 'level_delete', 'level_duplicate', 'thumb', 'song_save', 'sound_save', 'audio_delete', 'overrides_save', 'rename', 'boot_level', 'story_op', 'world_set', 'area_create', 'area_rename', 'area_delete']);
function sendOnLeave(msg) {
  if (!state.projectId) return false;
  try {
    const body = JSON.stringify({ client: state.clientId, messages: [msg] });
    if (body.length > 60000) return false; // keepalive requests may carry 64 KB in all
    fetch(`/api/projects/${encodeURIComponent(state.projectId)}/send`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-studio-key': state.password }, body }).catch(() => {});
    return true;
  } catch { return false; }
}
// (capture: runs before the panels' own pagehide listeners, so their flushes take this path)
window.addEventListener('pagehide', () => { state.leaving = true; }, true);
window.addEventListener('pageshow', () => { state.leaving = false; });

async function onMessage(msg) {
  switch (msg.type) {
    case 'auth_required':
      askPassword(msg.wrong);
      break;
    case 'welcome': {
      state.connected = true;
      $('#level-chip').classList.remove('offline');
      state.clientId = msg.clientId;
      state.project = msg.project;
      state.projectId = msg.project.id;
      store.set('studio64.lastProject', state.projectId);
      const url = new URL(location.href);
      if (url.searchParams.get('p') !== state.projectId) { url.searchParams.set('p', state.projectId); history.replaceState(null, '', url); }
      $('#project-name').value = msg.project.name;
      document.title = `${msg.project.name} · Studio 64`;
      state.patch = msg.patch;
      state.levels = msg.levels || [];
      state.thumbs = msg.thumbs || {};
      state.audio = msg.audio || { songs: [], sounds: [], overrides: [] };
      storyMessage(state, msg.story); // dialogs, characters, events, cutscenes (story/)
      state.model = msg.project.model || state.model;
      renderModel();
      fetchMenu().then((menu) => {
        if (menu?.ai) applyAiMode(menu.ai);
        if (menu?.models?.length) { state.config.models = menu.models; renderModel(); }
      });
      setChanges(msg.changes);
      renderHistory(msg.chat);
      setBusy(msg.busy);
      setViewers(msg.viewers);
      if (state.engine) state.engine.setPatch(msg.patch);
      bootEngine(msg.project.boot?.level || 9);
      state.hub?.flush((m) => state.ws.send(JSON.stringify(m))); // changes made while offline
      break;
    }
    case 'rpc': {
      try {
        if (!state.engine?.ready) throw new Error('the game is still loading');
        if (state.engine.crashed) throw new Error('the game crashed; the player has to restart it');
        const result = await state.studio.handle(msg.method, msg.params || {});
        send({ type: 'rpc_result', id: msg.id, ok: true, result });
      } catch (err) {
        send({ type: 'rpc_result', id: msg.id, ok: false, error: err.message });
      }
      break;
    }
    case 'patch':
      state.patch = msg.patch;
      state.engine?.setPatch(msg.patch);
      state.editor?.syncRecords();
      state.levelsUI?.renderStars(); // stars placed, renamed or removed
      state.worldFlow?.onPatch();
      setChanges(msg.changes);
      flashSaved();
      break;
    case 'apply_ops':
      if (state.engine?.ready) state.studio.applyOps(msg.ops);
      state.editor?.refreshSelection();
      break;
    case 'user_message':
      if (msg.from !== state.clientId) addUserMessage(msg.text, msg.images);
      break;
    case 'story': storyMessage(state, msg.story); break;
    case 'changes': setChanges(msg.changes); break; // the edit list after project-wide edits (story, assets, world)
    case 'audio': {
      // someone (or Claude) changed songs or sounds
      const before = JSON.stringify(state.audio?.songs?.find((x) => x.id === state.world?.settings().song) || null);
      state.audio = msg.audio;
      state.soundUI?.syncOverrides();
      if (state.soundUI?.isOpen()) state.soundUI.render();
      if (JSON.stringify(state.audio.songs.find((x) => x.id === state.world?.settings().song) || null) !== before) state.world?.applyLevelSong();
      state.editorUI?.renderLevelSettings?.();
      break;
    }
    case 'levels':
      state.levels = msg.levels || [];
      state.thumbs = msg.thumbs || state.thumbs;
      if (!$('#launcher').hidden && !$('#nl-name')) state.levelsUI?.render();
      updateLevelChip(state.engine?.level);
      break;
    case 'area_created':
      state.worldFlow?.onAreaCreated(msg);
      break;
    case 'level_created':
      state.levelsUI?.go({ custom: msg.id, name: state.levels.find((l) => l.id === msg.id)?.name || 'level' });
      break;
    case 'thumb':
      state.thumbs[msg.key] = msg.data;
      break;
    case 'assistant_start':
      startAssistant(msg.turnId);
      setBusy(true);
      break;
    case 'thinking':
      break;
    case 'text_delta':
      appendText(msg.turnId, msg.text);
      break;
    case 'tool_start':
      addTool(msg.turnId, msg);
      break;
    case 'tool_end':
      endTool(msg);
      break;
    case 'assistant_done':
      finishAssistant(msg);
      break;
    case 'idle':
      setBusy(false);
      break;
    case 'toast':
      toast(msg.message, 'check');
      break;
    case 'error':
      toast(msg.message, 'x');
      if (turns.has('pending')) {
        turns.get('pending').body.closest('.msg').remove();
        turns.delete('pending');
        setBusy(false);
      }
      break;
    case 'viewers':
      setViewers(msg.count);
      break;
    case 'model':
      state.model = msg.model;
      renderModel();
      break;
    case 'renamed':
      $('#project-name').value = msg.name;
      document.title = `${msg.name} · Studio 64`;
      break;
    case 'chat_cleared':
      renderHistory([]);
      break;
    default:
      state.hub?.onMessage(msg); // projects, versions (hub.js)
      // feature modules listen for their own messages (assets.js: 'assets')
      window.dispatchEvent(new CustomEvent('studio-message', { detail: msg }));
      break;
  }
}

// ---------------------------------------------------------------------------
// chat rendering

const turns = new Map();

function scrollDown(force) {
  const m = $('#messages');
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 160;
  if (force || near) m.scrollTop = m.scrollHeight;
}

function showEmpty(show) {
  $('#empty').hidden = !show;
}

function addUserMessage(text, images = []) {
  showEmpty(false);
  const msg = el('div', 'msg user');
  if (images?.length) {
    const row = el('div', 'bubble-images');
    for (const src of images) { const im = el('img'); im.src = src; im.alt = ''; row.appendChild(im); }
    msg.appendChild(row);
  }
  msg.appendChild(el('div', 'bubble', esc(text)));
  $('#messages').appendChild(msg);
  scrollDown(true);
}

function assistantShell() {
  const msg = el('div', 'msg assistant');
  msg.appendChild(el('div', 'avatar', STAR));
  const body = el('div', 'msg-body');
  msg.appendChild(body);
  $('#messages').appendChild(msg);
  return body;
}

function startAssistant(turnId) {
  showEmpty(false);
  // our own message already shows a placeholder: adopt it
  if (turns.has('pending')) {
    turns.set(turnId, turns.get('pending'));
    turns.delete('pending');
    return;
  }
  const body = assistantShell();
  const thinking = el('div', 'thinking', '<span class="shimmer">Thinking…</span>');
  body.appendChild(thinking);
  turns.set(turnId, { body, thinking, text: null, textRaw: '', tools: null, toolEls: new Map() });
  scrollDown(true);
}

function turnOf(turnId) {
  if (!turns.has(turnId)) startAssistant(turnId);
  return turns.get(turnId);
}

function clearThinking(t) {
  if (t.thinking) { t.thinking.remove(); t.thinking = null; }
}

function appendText(turnId, text) {
  const t = turnOf(turnId);
  clearThinking(t);
  if (!t.text) {
    t.text = el('div', 'md caret');
    t.textRaw = '';
    t.body.appendChild(t.text);
    t.tools = null; // later tools start a new group
  }
  t.textRaw += text;
  t.text.innerHTML = md(t.textRaw);
  scrollDown();
}

function toolRow(name, label, stateName, summary) {
  // a finished edit shows its result in place of the "doing it" label
  if (stateName === 'done' && summary) { label = summary; summary = null; }
  const row = el('div', `tool ${stateName}${WRITE_TOOLS.has(name) ? ' write' : ''}`);
  row.innerHTML = `<span class="ticon">${icon(TOOL_ICONS[name] || 'sparkles', 'sm')}</span>
    <span class="tlabel"><span class="tl">${esc(label)}</span>${summary ? `<span class="tsum">${esc(summary)}</span>` : ''}</span>
    <span class="tstate">${stateName === 'running' ? '<span class="mini-spin"></span>' : stateName === 'done' ? icon('check', 'sm') : icon('x', 'sm')}</span>`;
  return row;
}

function addTool(turnId, msg) {
  const t = turnOf(turnId);
  clearThinking(t);
  if (t.text) { t.text.classList.remove('caret'); t.text = null; }
  if (!t.tools) { t.tools = el('div', 'tools'); t.body.appendChild(t.tools); }
  const row = toolRow(msg.name, msg.label, 'running');
  t.tools.appendChild(row);
  t.toolEls.set(msg.toolId, { row, name: msg.name, label: msg.label });
  scrollDown();
}

function endTool(msg) {
  for (const t of turns.values()) {
    const info = t.toolEls.get(msg.toolId);
    if (!info) continue;
    const row = toolRow(info.name, info.label, msg.ok ? 'done' : 'error', msg.summary && msg.summary !== info.label ? msg.summary : null);
    info.row.replaceWith(row);
    info.row = row;
    if (msg.ok && WRITE_TOOLS.has(info.name) && msg.summary) toast(msg.summary, TOOL_ICONS[info.name]);
    collapseTools(t.tools);
  }
}

// Long runs of lookups collapse to keep the chat readable.
function collapseTools(group) {
  if (!group) return;
  const rows = [...group.querySelectorAll('.tool')];
  const reads = rows.filter((r) => !r.classList.contains('write') && !r.querySelector('.mini-spin'));
  let toggle = group.querySelector('.tools-toggle');
  if (reads.length < 4) { if (toggle) toggle.remove(); return; }
  if (!toggle) {
    toggle = el('button', 'tools-toggle');
    toggle.type = 'button';
    toggle.onclick = () => { group.classList.toggle('open'); collapseTools(group); };
    group.appendChild(toggle);
  }
  const open = group.classList.contains('open');
  reads.forEach((r) => { r.hidden = !open; });
  toggle.textContent = open ? 'Hide details' : `${reads.length} lookups hidden · show`;
}

function finishAssistant(msg) {
  state.chatDone = (state.chatDone || 0) + 1;
  const t = turns.get(msg.turnId);
  if (!t) return;
  clearThinking(t);
  if (t.text) t.text.classList.remove('caret');
  if (msg.error) t.body.appendChild(el('div', 'msg-error', esc(msg.error)));
  if (!t.body.children.length) t.body.appendChild(el('div', 'md', '<p><em>Done.</em></p>'));
  turns.delete(msg.turnId);
  scrollDown();
}

function renderHistory(chat) {
  const box = $('#messages');
  box.querySelectorAll('.msg').forEach((m) => m.remove());
  turns.clear();
  showEmpty(!chat.length);
  for (const entry of chat) {
    if (entry.role === 'user') { addUserMessage(entry.text, entry.images); continue; }
    const body = assistantShell();
    let group = null;
    for (const part of entry.parts || []) {
      if (part.type === 'text') {
        body.appendChild(el('div', 'md', md(part.text)));
        group = null;
      } else {
        if (!group) { group = el('div', 'tools'); body.appendChild(group); }
        group.appendChild(toolRow(part.name, part.label, part.state === 'running' ? 'error' : part.state, part.summary && part.summary !== part.label ? part.summary : null));
      }
    }
    body.querySelectorAll('.tools').forEach(collapseTools);
    if (entry.error) body.appendChild(el('div', 'msg-error', esc(entry.error)));
  }
  scrollDown(true);
}

function setBusy(busy) {
  state.busy = busy;
  const sendBtn = $('#send');
  sendBtn.classList.toggle('busy', busy);
  sendBtn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  updateSendEnabled();
}

function updateSendEnabled() {
  $('#send').disabled = !state.busy && !$('#input').value.trim() && !(state.attachments || []).length;
}

// ---- image attachments --------------------------------------------------------

// Scale an image file down for Claude (and a small copy for the chat).
async function readImage(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
  const fit = (max, q) => {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  };
  const full = fit(1568, 0.88);
  const thumb = fit(320, 0.75);
  URL.revokeObjectURL(url);
  return { mime: 'image/jpeg', data: full.split(',')[1], thumb };
}

async function addAttachments(files) {
  state.attachments ||= [];
  for (const f of [...files].filter((x) => x.type.startsWith('image/')).slice(0, 4 - state.attachments.length)) {
    try { state.attachments.push(await readImage(f)); } catch { toast('Could not read that image', 'x'); }
  }
  renderAttachments();
  updateSendEnabled();
}

function renderAttachments() {
  const box = $('#attachments');
  box.innerHTML = '';
  const list = state.attachments || [];
  box.hidden = !list.length;
  list.forEach((a, i) => {
    const d = el('div', 'attachment', `<img src="${a.thumb}" alt="">`);
    const x = el('button', '', '×');
    x.type = 'button';
    x.title = 'Remove';
    x.onclick = () => { state.attachments.splice(i, 1); renderAttachments(); updateSendEnabled(); };
    d.appendChild(x);
    box.appendChild(d);
  });
}

// AI settings, with the AI assistant on/off switch (from the model menu and the ... menu)
function openAi() {
  openAiSettings({
    currentModel: state.model,
    onPick: pickModel,
    onModels: (models) => { state.config.models = models; renderModel(); },
  });
}

function submit(text) {
  if (!aiOn()) return; // no AI: nothing to send to
  text = (text ?? $('#input').value).trim();
  const images = state.attachments || [];
  if (!text && images.length) text = 'Build this level from the picture.';
  if (!text || state.busy) return;
  if (!state.connected) { toast('Not connected to the server yet', 'x'); return; }
  addUserMessage(text, images.map((a) => a.thumb));
  startAssistant('pending');
  setBusy(true);
  send({ type: 'chat', text, model: state.model, context: editorContext(), images });
  state.attachments = [];
  renderAttachments();
  $('#input').value = '';
  autosize();
  updateSendEnabled();
}

// ---------------------------------------------------------------------------
// edits

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function setChanges(changes) {
  state.changes = changes || [];
  $('#edits-count').textContent = state.changes.length;
  renderEdits();
}

function editIcon(summary) {
  if (/^Removed/.test(summary)) return 'trash';
  if (/^Moved/.test(summary)) return 'move';
  if (/pipe/i.test(summary)) return 'pipe';
  return 'plus';
}

function renderEdits() {
  const list = $('#edits-list');
  list.innerHTML = '';
  if (!state.changes.length) {
    list.appendChild(el('div', 'edits-empty', document.body.classList.contains('no-ai')
      ? 'No edits yet.<br>Everything you build shows up here, and each change can be undone.'
      : 'No edits yet.<br>What you build, and what the assistant changes, shows up here.'));
    return;
  }
  for (const c of [...state.changes].reverse()) {
    const where = changeWhere(c.key);
    const row = el('div', 'edit');
    row.innerHTML = `<span class="ticon">${icon(editIcon(c.summary), 'sm')}</span>
      <div class="einfo"><div class="etitle">${esc(c.summary)}</div><div class="emeta">${esc(where)} · ${timeAgo(c.ts)}</div></div>`;
    const undo = el('button', 'btn icon ghost', icon('undo'));
    undo.title = 'Undo this edit';
    undo.onclick = () => send({ type: 'undo', changeId: c.id });
    row.appendChild(undo);
    list.appendChild(row);
  }
}

// Where a change was made: "Level · area" (custom levels: c:<id>, sub-areas c:<id>:<n>), or the whole project.
function changeWhere(key = '') {
  if (key === '@game') return 'Whole game';
  if (key === '@project' || key === '*') return 'Project';
  if (key.startsWith('c:')) {
    const [, id, n] = key.split(':');
    const l = state.levels.find((x) => x.id === id);
    if (!l) return 'Custom level';
    const ai = Number(n) || 1;
    return ai > 1 ? `${l.name} · ${(l.areas || []).find((x) => x.index === ai)?.name || `Area ${ai}`}` : l.name;
  }
  const [lvl, ar] = key.split(':').map(Number);
  return `${levelInfo(lvl)?.name || `Level ${lvl}`}${ar > 1 ? ` · area ${ar}` : ''}`;
}

let saveTimer;
// Undo the last edit of the area you are in or of the whole project (story, assets, world flow,
// sound studio: key '@project'; game rules and custom objects: '@game'); edits of other levels
// stay. Redo the last undo.
function undoHere() {
  state.storyUI?.flush?.(); // story text still being typed goes first, then gets undone with the rest
  const key = state.engine?.areaKey();
  // (creating or deleting levels is undone from the Edits tab, not by Ctrl+Z inside the level)
  const c = [...state.changes].reverse().find((x) => (x.key === key || String(x.key).startsWith('@')) && !x.level);
  if (!c) { toast('Nothing to undo in this level', 'undo'); return; }
  send({ type: 'undo', changeId: c.id });
}
function redoEdit() { send({ type: 'redo' }); }
window.studio64Undo = { undoHere, redoEdit };

function flashSaved() {
  const s = $('#save-state');
  s.textContent = 'Saving…';
  s.classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { s.textContent = 'Saved'; s.classList.remove('saving'); }, 600);
}

// ---------------------------------------------------------------------------
// game chrome

function keysBlocked() {
  const a = document.activeElement;
  if (!$('#modal-back').hidden || state.editor?.active) return true;
  if (document.querySelector('.ai-back')) return true; // the AI settings dialog
  if (document.querySelector('.dlg-back, .cmdk-back, .shell-sheet-back, .tour, .shell-menu')) return true; // shell overlays (shell.js, dialogs.js)
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

function setPlaying(on) {
  state.playing = on;
  $('#game-frame').classList.toggle('playing', on);
  $('#focus-hint').hidden = on || !state.booted || !$('#start').hidden;
}

function updateLevelChip(lvl) {
  if (state.engine && lvl === state.engine.studioLevel) {
    $('#level-name').textContent = state.levels.find((l) => l.id === state.engine.customLevel)?.name || 'Custom level';
    return;
  }
  $('#level-name').textContent = levelInfo(lvl)?.name || (lvl ? `Level ${lvl}` : 'Menu');
}

function updateCoords() {
  const e = state.engine;
  if (!e?.ready || e.crashed) return;
  try {
    const s = e.state();
    $('#coords').textContent = s.mario ? `x ${s.mario.x}  y ${s.mario.y}  z ${s.mario.z}` : '';
  } catch { /* between levels */ }
}

function setViewers(n) {
  const v = $('#viewers');
  v.hidden = !(n > 1);
  v.textContent = `${n} here`;
}

function toast(text, ic = 'sparkles') {
  const box = $('#toasts');
  // errors (x) stay longer and can be closed; successes (check) are green (css/shell.css)
  const kind = ic === 'x' || ic === 'alert' ? 'err' : ic === 'check' ? 'ok' : 'info';
  const t = el('div', `toast ${kind}`, `${icon(kind === 'err' ? 'alert' : ic, 'sm')}<span>${esc(text)}</span>`);
  t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const bye = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  if (kind === 'err') { const x = el('button', 'toast-x', icon('x', 'sm')); x.setAttribute('aria-label', 'Dismiss'); x.onclick = bye; t.appendChild(x); }
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(bye, kind === 'err' ? 6000 : 2600);
}

// ---------------------------------------------------------------------------
// menus & modals

function closeMenus() {
  for (const m of document.querySelectorAll('.menu')) m.hidden = true;
}

function openFloating(menu, anchor, align = 'right') {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = `${r.bottom + 6}px`;
  if (align === 'right') { menu.style.left = ''; menu.style.right = `${window.innerWidth - r.right}px`; } else { menu.style.right = ''; menu.style.left = `${r.left}px`; }
  // a long menu on a short window scrolls instead of running off the screen
  menu.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 14)}px`;
  menu.style.overflowY = 'auto';
  menuKeys(menu, anchor);
}

// Esc closes an open menu (back to its button); arrows walk the items.
function menuKeys(menu, anchor) {
  const items = () => [...menu.querySelectorAll('.menu-item')].filter((b) => b.offsetParent);
  const onKey = (e) => {
    if (menu.hidden) { window.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenus(); anchor.focus?.(); window.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = items(); if (!list.length) return;
      e.preventDefault(); e.stopPropagation();
      const i = list.indexOf(document.activeElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
    }
  };
  window.addEventListener('keydown', onKey, true);
}

function menuItem(label, onClick, { sub, active, danger, ic } = {}) {
  const b = el('button', `menu-item${active ? ' active' : ''}${danger ? ' danger' : ''}`);
  b.innerHTML = `${ic ? icon(ic, 'sm') : ''}<span>${esc(label)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
  b.onclick = (e) => { e.stopPropagation(); closeMenus(); onClick(); };
  return b;
}

function pickModel(id) {
  state.model = id;
  store.set('studio64.model', id);
  send({ type: 'model', model: id });
  renderModel();
}

// The model menu: Claude (subscription) and every model set up in AI settings, by provider.
function renderModel() {
  const other = /^@([\w-]+)\/(.+)$/.exec(state.model || ''); // a model that is not in the menu (yet)
  const m = state.config.models.find((x) => x.id === state.model)
    || (other ? { id: state.model, label: other[2].split('/').pop(), provider: other[1] } : state.config.models[0])
    || { label: 'AI', provider: 'claude' }; // no models (AI off or nothing connected)
  $('#model-name').textContent = m.label;
  $('#model-btn').title = m.group ? `${m.group} · ${m.label}` : m.label;
  $('#input').placeholder = `Ask ${!m.provider || m.provider === 'claude' ? 'Claude' : m.label} to change the level…`; // short: a longer one wrapped and showed half a second line
  const menu = $('#model-menu');
  menu.innerHTML = '';
  let group = null;
  for (const x of state.config.models) {
    if (x.group && x.group !== group) { group = x.group; menu.appendChild(el('div', 'menu-label', esc(group))); }
    menu.appendChild(menuItem(x.label, () => pickModel(x.id), { sub: x.group === 'Claude (subscription)' ? x.hint : (x.tools === false ? 'chat only' : ''), active: x.id === state.model }));
  }
  menu.appendChild(el('div', 'menu-sep'));
  const settings = menuItem('AI settings…', openAi, { sub: 'other models', ic: 'sparkles' });
  settings.classList.add('ai-menu-settings');
  menu.appendChild(settings);
}

function modal(html, onReady) {
  $('#modal').className = 'modal'; // no size left over from a dialog closed with Esc or a click outside (World's are wider)
  $('#modal').innerHTML = html;
  $('#modal-back').hidden = false;
  state.engine?.releaseKeys();
  onReady?.($('#modal'));
}
function closeModal() { $('#modal-back').hidden = true; }

function shareModal() {
  if (state.hub) { state.hub.share(); return; } // link, project file, playable game (hub.js)
  const url = `${location.origin}/?p=${state.projectId}`;
  modal(`<h2>Share this hack</h2>
    <p>Anyone with the link plays your version of the game <span data-ai> and can chat with Claude</span> in the same project.</p>
    <div class="field"><input type="text" id="share-url" readonly value="${esc(url)}"><button class="btn primary" id="copy-url">Copy</button></div>
    <div class="note">Others need to reach this server. For friends outside your network, start it with HOST=0.0.0.0 and a STUDIO_PASSWORD, or put it behind a tunnel.</div>
    <div class="actions"><button class="btn" id="close-modal">Done</button></div>`, (m) => {
    m.querySelector('#copy-url').onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied', 'check'); } catch { m.querySelector('#share-url').select(); }
    };
    m.querySelector('#close-modal').onclick = closeModal;
  });
}

function askPassword(wrong = false) {
  modal(`<h2>Password</h2><p>${wrong ? 'That password is not right. Try again.' : 'This Studio 64 server is protected.'}</p>
    <form id="pw-form" class="field"><input type="password" id="pw" placeholder="Password" autocomplete="current-password" aria-label="Password" autofocus><button class="btn primary">Enter</button></form>`, (m) => {
    m.querySelector('#pw').focus();
    m.querySelector('#pw-form').onsubmit = (e) => {
      e.preventDefault();
      state.password = m.querySelector('#pw').value;
      store.set('studio64.password', state.password);
      closeModal();
      send({ type: 'hello', projectId: state.projectId, password: state.password });
    };
  });
}

function confirmModal(title, text, okLabel, onOk) {
  modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="btn" id="m-cancel">Cancel</button><button class="btn primary" id="m-ok">${esc(okLabel)}</button></div>`, (m) => {
    m.querySelector('#m-cancel').onclick = closeModal;
    m.querySelector('#m-ok').onclick = () => { closeModal(); onOk(); };
  });
}

async function newProject(level) {
  const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-key': state.password }, body: JSON.stringify({ level: level || 9 }) });
  const { id } = await r.json();
  location.href = `/?p=${id}`;
}

async function projectMenu(anchor) {
  const menu = $('#project-menu');
  menu.innerHTML = '';
  // projects, versions, sharing and export (hub.js)
  for (const it of state.hub.menuItems()) {
    if (it === '-') menu.appendChild(el('div', 'menu-sep'));
    else { const b = menuItem(it.label, it.run, { sub: it.sub }); b.insertAdjacentHTML('afterbegin', state.hub.icon(it.icon)); menu.appendChild(b); }
  }
  menu.appendChild(el('div', 'menu-sep'));
  try {
    const list = await fetch('/api/projects', { headers: { 'x-studio-key': state.password } }).then((r) => r.json());
    const others = list.filter((p) => p.id !== state.projectId && (p.edits > 0 || p.name !== 'Untitled hack')).slice(0, 6);
    if (others.length) {
      menu.appendChild(el('div', 'menu-label', 'Recent'));
      for (const p of others) menu.appendChild(menuItem(p.name, () => { location.href = `/?p=${p.id}`; }, { sub: `${p.edits} edit${p.edits === 1 ? '' : 's'}` }));
      menu.appendChild(el('div', 'menu-sep'));
    }
  } catch { /* offline */ }
  if (aiOn()) menu.appendChild(menuItem('New conversation', () => send({ type: 'new_chat' }), { ic: 'message' }));
  menu.appendChild(menuItem('AI assistant…', openAi, { ic: 'sparkles', sub: aiOn() ? 'on' : 'off' }));
  menu.appendChild(menuItem('Clear all edits', clearEdits, { ic: 'trash', danger: true }));
  openFloating(menu, anchor);
}

function levelMenu(anchor) {
  const menu = $('#level-menu');
  menu.innerHTML = '';
  menu.appendChild(el('div', 'menu-label', 'Go to level'));
  const levels = Object.entries(state.catalog.levels).map(([slug, i]) => ({ slug, ...i })).filter((l) => l.num).sort((a, b) => (b.acts - a.acts) || a.name.localeCompare(b.name));
  for (const l of levels) {
    menu.appendChild(menuItem(l.name, () => {
      if (!state.engine?.ready) return;
      state.studio.warp({ level: l.num, act: 1, acts: l.acts });
      send({ type: 'boot_level', level: l.num });
      toast(`Warping to ${l.name}`, 'door');
      $('#canvas').focus();
    }, { active: l.num === state.engine?.level }));
  }
  openFloating(menu, anchor, 'left');
}

// The project file (.s64hack, like the project menu); old .json exports still import.
function exportProject() {
  if (state.hub) state.hub.download(`/api/projects/${state.projectId}/export.s64hack`);
  else location.href = `/api/projects/${state.projectId}/export.s64hack`;
}

async function importProject(file) {
  if (state.hub) { await state.hub.importFiles([file]); return; }
  try {
    const r = await fetch('/api/hub/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-studio-key': state.password }, body: file });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    location.href = `/?p=${data.id}`;
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'x');
  }
}

function clearEdits() {
  confirmModal('Clear all edits?', 'Everything added, removed or reshaped in the original levels goes back to the game. Your own levels and the chat stay.', 'Clear edits', () => send({ type: 'reset_edits' }));
}

// ---------------------------------------------------------------------------
// ui wiring

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
}

function setupUi() {
  // the workspace rail, command palette, shortcuts, tooltips and tour (shell.js)
  state.openAi = openAi; // the AI assistant dialog (on/off, models), for the shell's Help menu and palette
  state.shell = new Shell({ state, toast, send });
  // suggestions
  const sug = $('#suggestions');
  for (const s of SUGGESTIONS) {
    const b = el('button', 'suggestion', `${icon(s.icon, 'sm')}<span>${esc(s.text)}</span>`);
    b.onclick = () => submit(s.text);
    sug.appendChild(b);
  }

  const input = $('#input');
  input.addEventListener('input', () => { autosize(); updateSendEnabled(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { input.blur(); $('#canvas').focus(); }
  });
  input.addEventListener('focus', () => { state.engine?.releaseKeys(); setPlaying(false); });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy) send({ type: 'stop' }); else submit();
  });

  // keyboard focus between game and chat
  const canvas = $('#canvas');
  const play = () => { $('#start').hidden = true; canvas.focus(); setPlaying(true); };
  $('#start').addEventListener('click', play);
  canvas.addEventListener('mousedown', () => { if (document.activeElement !== canvas) { document.activeElement?.blur?.(); } play(); });
  canvas.addEventListener('focus', () => setPlaying(true));
  canvas.addEventListener('blur', () => setPlaying(false));
  window.addEventListener('keydown', (e) => {
    if (isTyping() || !$('#modal-back').hidden) return;
    // (Tab on a focused checkbox or slider moves the focus as usual; Ctrl+Z still undoes)
    if (e.key === 'Tab' && state.editor && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); toggleBuild(); return; }
    // undo/redo in build mode, and while a panel (story, assets, sound...) has the keyboard instead of the game
    const undoKeys = state.editor?.active || !state.playing;
    if (undoKeys && (e.ctrlKey || e.metaKey) && ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY')) { e.preventDefault(); redoEdit(); return; }
    if (undoKeys && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undoHere(); return; }
    if (keysBlocked() && !state.editor?.active) return;
    if (aiOn() && (e.key === '/' || (e.key === 't' && !state.playing && !state.editor?.active))) { e.preventDefault(); input.focus(); }
  });
  $('#mode-play').onclick = () => { if (state.editor?.active) toggleBuild(); };
  $('#mode-build').onclick = () => { if (state.editor && !state.editor.active) toggleBuild(); else if (!state.editor) toast('The game is still loading', 'x'); };

  // tabs
  for (const tab of document.querySelectorAll('.tab')) {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#chat-pane').hidden = tab.dataset.tab !== 'chat';
      $('#edits-pane').hidden = tab.dataset.tab !== 'edits';
      $('#stars-pane').hidden = tab.dataset.tab !== 'stars';
      if (tab.dataset.tab === 'edits') renderEdits();
      if (tab.dataset.tab === 'stars') state.levelsUI?.renderStars();
    };
  }

  // menus
  $('#model-btn').onclick = (e) => { e.stopPropagation(); const m = $('#model-menu'); const open = m.hidden; closeMenus(); m.hidden = !open; if (open) menuKeys(m, e.currentTarget); };
  $('#menu-btn').onclick = (e) => { e.stopPropagation(); projectMenu(e.currentTarget); };
  $('#level-chip').onclick = (e) => { e.stopPropagation(); if (state.levelsUI) state.levelsUI.open(); else levelMenu(e.currentTarget); };
  // images: paperclip, paste, drag and drop
  $('#attach-btn').onclick = () => $('#attach-file').click();
  $('#attach-file').onchange = (e) => { addAttachments(e.target.files); e.target.value = ''; };
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addAttachments(files); }
  });
  const pane = $('#chat-pane');
  pane.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); $('#composer').classList.add('dragover'); } });
  pane.addEventListener('dragleave', () => $('#composer').classList.remove('dragover'));
  pane.addEventListener('drop', (e) => { e.preventDefault(); $('#composer').classList.remove('dragover'); addAttachments(e.dataTransfer.files); });
  document.addEventListener('click', closeMenus);
  $('#share-btn').onclick = shareModal;
  $('#new-chat').onclick = () => send({ type: 'new_chat' });
  $('#export-btn').onclick = exportProject;
  $('#import-btn').onclick = () => $('#import-file').click();
  $('#import-file').onchange = (e) => { if (e.target.files[0]) importProject(e.target.files[0]); e.target.value = ''; };
  $('#clear-btn').onclick = clearEdits;
  $('#modal-back').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-back' && !$('#pw')) closeModal(); });
  // Esc closes the dialog (rename, settings, versions, share, ...), like a click beside it; not the password one
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !$('#modal-back').hidden && !$('#pw') && !document.querySelector('.dlg-back')) { e.preventDefault(); closeModal(); } });
  $('#fullscreen-btn').onclick = () => { const f = $('#game-frame'); if (document.fullscreenElement) document.exitFullscreen(); else f.requestFullscreen?.(); canvas.focus(); };
  document.addEventListener('fullscreenchange', () => setTimeout(fitCanvas, 50));

  // crash
  $('#crash-restart').onclick = () => location.reload();
  $('#crash-undo').onclick = () => { send({ type: 'undo' }); setTimeout(() => location.reload(), 300); };

  // project name
  const name = $('#project-name');
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') name.blur(); });
  name.addEventListener('change', () => send({ type: 'rename', name: name.value }));

  // splitter
  const split = $('#splitter');
  const saved = Number(store.get('studio64.sideW'));
  if (saved > 300) document.documentElement.style.setProperty('--side-w', `${saved}px`);
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag');
    const move = (ev) => {
      const w = Math.max(340, Math.min(window.innerWidth * 0.7, window.innerWidth - ev.clientX));
      document.documentElement.style.setProperty('--side-w', `${w}px`);
      store.set('studio64.sideW', String(Math.round(w)));
    };
    const up = () => { split.classList.remove('drag'); split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); fitCanvas(); };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
}

// ---------------------------------------------------------------------------
// build mode

function areaRecords() {
  const e = state.engine;
  if (!e) return [];
  const key = e.areaKey();
  e.patch.areas ||= {};
  const a = (e.patch.areas[key] ||= { objects: [], removals: [], warps: [] });
  return a.objects;
}

function setupEditor() {
  if (state.editor) return;
  const editor = new Editor({
    engine: state.engine,
    studio: state.studio,
    world: state.world,
    frame: $('#game-frame'),
    overlay: $('#overlay'),
    records: areaRecords,
    toast,
    commit: (op) => {
      send({ type: 'edit', op: { ...op, key: state.engine.areaKey() } });
      flashSaved();
    },
    ui: {
      onSelect: (sel) => state.editorUI?.renderInspector(sel),
      onModeChange: (active) => {
        if (!active) state.world?.liftMario(); // sculpting may have buried him
        $('#library').hidden = !active;
        $('#build-bar').hidden = !active;
        $('#help-card').hidden = true;
        $('#controls').hidden = active;
        $('#mode-play').classList.toggle('active', !active);
        $('#mode-build').classList.toggle('active', active);
        if (active) { $('#start').hidden = true; setPlaying(false); } else { $('#inspector').hidden = true; $('#canvas').focus(); }
        state.editorUI?.onToolChange();
        setTimeout(fitCanvas, 30);
      },
      onToolChange: () => state.editorUI?.onToolChange(),
    },
  });
  // keep the selection pointing at the server's copy of its record
  editor.syncRecords = () => {
    if (!editor.sel?.uid || editor.drag) return;
    const rec = areaRecords().find((r) => r.uid === editor.sel.uid);
    if (!rec) return;
    const changed = JSON.stringify(rec) !== JSON.stringify(editor.sel.rec);
    editor.sel.rec = rec;
    if (!changed) return;
    // Claude (or someone else, or the echo of an inspector edit) changed it: new slot, name,
    // inspector. The re-rendered inspector keeps the field being typed in (Tab to the next
    // field and type: the echo of the last one must not take the field and the text away).
    const a = document.activeElement, box = $('#inspector');
    const key = a && box.contains(a) && ['data-f', 'data-b', 'data-param'].map((k) => a.getAttribute(k) != null && `[${k}="${a.getAttribute(k)}"]`).find(Boolean);
    const typed = key && a.value !== a.defaultValue ? a.value : null;
    let caret = null;
    try { caret = key ? [a.selectionStart, a.selectionEnd] : null; } catch { /* number inputs have none */ }
    editor.refreshSelection();
    const b = key && box.querySelector(key);
    if (b && b !== a) {
      b.focus({ preventScroll: true });
      if (typed != null) b.value = typed;
      try { if (caret?.[0] != null) b.setSelectionRange(caret[0], caret[1]); } catch { /* ignore */ }
    }
  };
  state.editor = editor;
  state.editorUI = new EditorUI({
    editor, engine: state.engine, world: state.world, catalog: state.catalog, send,
    chat: (text) => { const i = $('#input'); i.value = text; i.focus(); autosize(); updateSendEnabled(); },
  });
  state.levelsUI = new LevelsUI({
    engine: state.engine, world: state.world, editor, catalog: state.catalog, send, toast,
    getLevels: () => state.levels, getThumbs: () => state.thumbs,
    submitChat: (text) => submit(text),
    setAttachments: async (files) => { state.attachments = []; await addAttachments(files); },
  });
  updateLevelChip(state.engine.level);
  state.levelsUI.renderStars();
  state.worldFlow.editor = editor;
  state.worldFlow.levelsUI = state.levelsUI;
  state.worldUI = new WorldUI({ flow: state.worldFlow, engine: state.engine, world: state.world, editor, editorUI: state.editorUI, levelsUI: state.levelsUI, catalog: state.catalog, send, toast, getLevels: () => state.levels, getThumbs: () => state.thumbs });
  state.testing = new TestTools({ state, send, toast, hub: state.hub }); // play-testing and debug tools (testing.js)
  state.soundUI = new SoundUI({ engine: state.engine, world: state.world, editor, send, toast, getAudio: () => state.audio });
  $('#sound-btn').onclick = () => state.soundUI.open();
  state.assetsUI = new AssetsUI({ assets: state.assets, engine: state.engine, editor, editorUI: state.editorUI, levelsUI: state.levelsUI, toast, chat: (text) => submit(text) });
  attachStoryUI(state, { send, toast }); // the Story panel and build mode's Logic tab (story/)
  installObjectsEditor(state.objects, { editor, editorUI: state.editorUI, catalog: state.catalog }); // path tool, scene panel, My objects, Game panel
  installPathsEditor(state.paths, { editor, editorUI: state.editorUI, studio: state.studio, toast }); // build mode's Roads and Nature tabs
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (!typing && e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !state.soundUI.isOpen() && $('#launcher').hidden
      && (editor.active || !document.querySelector('.game-frame.playing'))) { e.preventDefault(); state.soundUI.open(); }
  });
  // back to the level this project was last edited in
  try {
    const last = JSON.parse(store.get(`studio64.last.${state.projectId}`) || 'null');
    if (last?.custom && state.levels.some((l) => l.id === last.custom)) state.levelsUI.go({ custom: last.custom, name: state.levels.find((l) => l.id === last.custom).name });
    else if (last?.num && last.num !== state.engine.level) { const info = levelInfo(last.num); if (info) state.levelsUI.go(info); }
    // a hack that starts in one of its own levels (project settings, "from scratch")
    else if (!last && state.project?.boot?.custom && state.levels.some((l) => l.id === state.project.boot.custom)) state.levelsUI.go({ custom: state.project.boot.custom, name: state.levels.find((l) => l.id === state.project.boot.custom).name });
  } catch { /* ignore */ }
}

function toggleBuild() {
  state.editor.toggle();
}

// What Claude should know about the editor when the user writes.
function editorContext() {
  const ed = state.editor;
  if (!ed) return null;
  const ctx = { building: ed.active };
  if (ed.sel) {
    const p = ed.selPose();
    ctx.selection = { name: ed.sel.name, kind: ed.sel.kind, uid: ed.sel.uid || undefined, slot: ed.sel.slot, x: Math.round(p.p[0]), y: Math.round(p.p[1]), z: Math.round(p.p[2]), yaw_deg: Math.round((p.yaw / 65536) * 360), block: p.block || undefined };
  }
  if (ed.lastPoint) ctx.last_click = { x: ed.lastPoint[0], y: ed.lastPoint[1], z: ed.lastPoint[2] };
  if (ed.active && ed.camData) ctx.camera = { x: Math.round(ed.camData.pos[0]), y: Math.round(ed.camData.pos[1]), z: Math.round(ed.camData.pos[2]) };
  return ctx;
}

// The loading card when something went wrong: what happened in plain words, and a way on.
function loadFailed(title, detail) {
  const card = $('#loading .loading-card');
  if (!card) return;
  $('#loading').hidden = false;
  $('#loading-title').textContent = title;
  card.classList.add('failed');
  card.querySelector('.spinner-star')?.remove();
  card.querySelector('.progress')?.remove();
  card.querySelector('.loading-detail')?.remove();
  card.querySelector('.loading-retry')?.remove();
  const d = el('p', 'loading-detail', esc(detail));
  const b = el('button', 'btn primary loading-retry', 'Try again');
  b.onclick = () => location.reload();
  card.append(d, b);
}

main().catch((err) => {
  console.error(err);
  // the server is not running (or not reachable): fetch fails before anything else
  if (err instanceof TypeError || /fetch|network/i.test(err.message)) loadFailed('Can\'t reach the Studio 64 server', 'Is it still running? Start it again (double-click Start Studio 64, or npm start), then try again.');
  else loadFailed('Studio 64 could not start', err.message);
});
