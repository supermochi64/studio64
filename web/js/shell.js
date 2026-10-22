// Studio 64 shell: the frame that makes every panel one product (docs/ui.md).
//
// - Workspace rail on the left: Play, Build, Story, Assets, Sound, Game (+ Test, Help at the bottom).
//   Other modules keep creating their own top-bar buttons (#story-btn, #assets-btn, ...); the
//   shell adopts every button that lands in the top bar and files it into the rail, so their click
//   handlers keep working untouched. Story and Sound dock into the stage instead of floating.
// - Command palette (Ctrl+P): every workspace, build tool, level, project action and command
//   that modules register with window.studioShell.register({ id, label, run, group, keys }).
// - Keyboard shortcut sheet (?), tooltips that show the shortcut, the first-run tour,
//   the chat panel toggle (Ctrl+J), library tab icons.
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const typingIn = (t = document.activeElement) => !!t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable);
// "(Ctrl+Shift+Z)", "(F3)", "(1)", "(Esc)", "([ or ])" are shortcuts; "(3 placements)" is not
const KEYS_RE = /^(?:(?:Ctrl|Shift|Alt|⌘|Cmd|F\d{1,2}|Tab|Esc|Del|Home|End|Enter|Space|Num ?\d|[A-Z0-9?/[\]]|←|→|↑|↓)(?:\s*[+/·]\s*|\s+or\s+|$))+$/;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = isMac ? '⌘' : 'Ctrl';

// The workspaces, in rail order. `sel` is the button another module (or index.html) creates.
const WORKSPACES = [
  { id: 'play', sel: '#mode-play', label: 'Play', icon: 'play', keys: 'Tab', about: 'Play your level' },
  { id: 'build', sel: '#mode-build', label: 'Build', icon: 'build', keys: 'Tab', about: 'Edit the level with the mouse: blocks, objects, terrain' },
  { id: 'story', sel: '#story-btn', label: 'Story', icon: 'book', keys: 'Y', about: 'Dialogs, characters, events and cutscenes', open: (s) => s.storyUI?.open(), close: (s) => s.storyUI?.close(), isOpen: () => !!$('#story-studio:not([hidden])') },
  { id: 'world', sel: '#world-btn', label: 'World', icon: 'globe', about: 'Areas, warps and doors' },
  { id: 'assets', sel: '#assets-btn', label: 'Assets', icon: 'cube', about: '3D models, textures, materials, sky, Mario', open: (s) => s.assetsUI?.open(), close: (s) => s.assetsUI?.close(), isOpen: () => !!$('#as-drawer:not([hidden])') },
  { id: 'sound', sel: '#sound-btn', label: 'Sound', icon: 'music', keys: 'M', about: 'Music and sound effects', open: (s) => s.soundUI?.open(), close: (s) => s.soundUI?.close(), isOpen: () => !!$('#sound-studio:not([hidden])') },
  { id: 'game', sel: '#game-btn', label: 'Game', icon: 'gamepad', keys: 'P', about: 'Game rules: physics, moves, lives, HUD', isOpen: () => !!$('.om-modal .gr'), close: () => $('.om-modal .gr [data-a=close]')?.click() },
];
const BOTTOM = [
  { id: 'test', sel: '#test-btn', label: 'Test', icon: 'bug', keys: 'F3', about: 'Play-testing tools: debug view, save states, timer', isOpen: () => !!$('#test-panel:not([hidden])') },
];
// what stays in the top bar
const TOPBAR_KEEP = new Set(['level-chip', 'share-btn', 'menu-btn', 'cmdk-btn', 'chat-toggle', 'help-top']);

// Library tab icons, by data-lib (or by the tab's text).
const LIB_ICONS = {
  blocks: 'blocks', objects: 'objects', terrain: 'terrain', structures: 'tower', builds: 'tower', models: 'cube', logic: 'zap',
  world: 'globe', areas: 'globe', paths: 'route', path: 'route', motion: 'route', stars: 'star', scene: 'layers', mine: 'user', textures: 'image', roads: 'road', nature: 'tree',
};

// Keys: "+" joins a combination, a space separates keys pressed one after the other.
const SHORTCUTS = [
  ['Everywhere', [
    [`${MOD}+P`, 'Command palette: every action, tool and level'],
    [`${MOD}+K`, 'Jump to a level (L too, when not playing)'],
    ['Tab', 'Switch between Play and Build'],
    ['/', 'Write to Claude', 'ai'],
    [`${MOD}+J`, 'Show or hide the chat', 'ai'],
    [`${MOD}+J`, 'Show or hide the edit history and stars', 'noai'],
    ['?', 'This list'],
    ['Esc', 'Close a panel · back to the game'],
  ]],
  ['Workspaces', [
    ['Y', 'Story'], ['M', 'Sound studio'], ['P', 'Game rules (in build mode: play from here)'], ['F3', 'Play-test tools'], ['F2', 'Debug view'],
  ]],
  ['Playing', [
    ['W A S D', 'Run'], ['Space', 'Jump (K too)'], ['J', 'Punch (B button)'], ['Shift', 'Crouch (L too)'],
    ['← →', 'Camera'], ['Enter', 'Pause'], ['F6 F7', 'Save state · load state'],
  ]],
  ['Build camera', [
    ['Right-drag', 'Orbit around what is under the mouse'], ['Shift+drag', 'Pan'], ['Wheel', 'Zoom toward the mouse'],
    ['F', 'Frame the selection'], ['Home', 'Frame Mario'], ['Shift+Home', 'Whole level from above'],
    ['Num1 Num3 Num7', 'Front · right · top view'], ['Right-drag+WASD', 'Fly (Q E: down, up)'],
  ]],
  ['Build editing', [
    ['Click', 'Select · drag over the ground'], ['1 2 3', 'Move · rotate · resize handles'], ['R', 'Rotate 45°'],
    ['G', 'Drop to the ground'], [`${MOD}+D`, 'Duplicate'], ['Del', 'Delete'], [`${MOD}+Z`, 'Undo'], [`${MOD}+Shift+Z`, 'Redo'],
    [`${MOD}+C ${MOD}+V`, 'Copy · paste (also between levels)'], ['O', 'Scene: everything in this level'], ['P', 'Play from the spot under the mouse'],
    ['Alt', 'Ignore the grid while dragging'], ['[ ]', 'Brush size (terrain)'],
  ]],
  ['Roads and nature', [
    ['Click', 'Add a road or fence point'], ['Enter', 'Finish it (or double-click)'], ['Backspace', 'Take the last point back'],
    ['Del', 'Remove the selected point'], ['Shift+drag', 'Erase plants (Nature tab)'], ['[ ]', 'Brush size (Nature tab)'],
  ]],
];

const TOUR_STEPS = [
  { title: 'Welcome to Studio 64', text: 'Make your own Super Mario 64, by playing, building and asking. This tour takes a minute.', textNoAi: 'Make your own Super Mario 64: play it, build it, write its story and its music. This tour takes a minute.', cta: 'Show me around' },
  { target: '#game-frame', place: 'right', title: 'Play your level', text: 'Click the game to play: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> runs, <kbd>Space</kbd> jumps, <kbd>Enter</kbd> pauses. Gamepads work too.' },
  { ai: true, target: '#composer', place: 'left', title: 'An assistant, if you want one', text: 'Everything in the studio works by hand. If you like, tell Claude what you want instead: <i>“put 3 Goombas on the bridge”</i>. It happens live, while you play.' },
  { target: '#mode-build', place: 'right', title: 'Build by hand', text: '<kbd>Tab</kbd> switches to Build: blocks, 600 objects, terrain brushes, stairs and bridges. Everything saves by itself, and <kbd>' + MOD + '</kbd><kbd>Z</kbd> undoes.' },
  { target: '.rail-ws', place: 'right', title: 'One workspace for each part', text: '<b>Story</b> for dialogs and cutscenes, <b>Assets</b> for your own models and textures, <b>Sound</b> for music, <b>Game</b> for the rules.' },
  { target: '#level-chip', place: 'bottom', title: 'Every level, one click away', text: 'Jump to any course, or make a new level from a template or a picture. <kbd>' + MOD + '</kbd><kbd>K</kbd>' },
  { noAi: true, target: '#chat-toggle', place: 'bottom', title: 'Your history and stars', text: 'This panel lists every change (each one can be undone) and the stars of the level you are in. <kbd>' + MOD + '</kbd><kbd>J</kbd> shows or hides it.' },
  { target: '#cmdk-btn', place: 'bottom', title: 'Everything is one search away', text: '<kbd>' + MOD + '</kbd><kbd>P</kbd> finds every action, tool and level. <kbd>?</kbd> lists all shortcuts. Have fun!', cta: 'Start making' },
];

export class Shell {
  constructor({ state, toast, send }) {
    this.state = state;
    this.toast = toast;
    this.send = send;
    this.commands = new Map();
    // Key traps: the topmost overlay (palette, dialog, sheet, tour, menu) gets every key first,
    // before the game, the editor and the panels (window.studioKeyTraps, used by dialogs.js too).
    this.traps = [];
    window.studioKeyTraps = this.traps;
    this.app = $('#app');
    this.app.classList.add('shell');
    this.buildTopbar();
    this.buildRail();
    this.watchSide();
    this.watchLibTabs();
    this.tooltips();
    this.keys();
    this.a11y();
    this.loadingTips();
    this.watchAi();
    setInterval(() => this.syncActive(), 250);
    this.syncActive();
    // and right after anything that may open or close a workspace
    const soon = () => { setTimeout(() => this.syncActive(), 0); setTimeout(() => this.syncActive(), 120); };
    document.addEventListener('click', soon);
    window.addEventListener('keyup', soon);
    window.studioShell = this;
    window.dispatchEvent(new CustomEvent('studio-shell-ready', { detail: this }));
  }

  // ---- with or without AI -----------------------------------------------------------------------
  // The AI switch (ai_settings.js) puts `no-ai` on <body>; elements with [data-ai] are then hidden.
  // Without AI the chat column goes away (the edit history and the stars stay, as a panel you
  // open with Ctrl+J), and nothing in the tour, the tips, the palette or the hints mentions AI.

  ai() { return !document.body.classList.contains('no-ai'); }

  watchAi() {
    // the AI parts of the chat column
    for (const sel of ['.tab[data-tab=chat]', '#chat-pane', '#new-chat']) $(sel)?.setAttribute('data-ai', '');
    // "/ chat" in the controls line under the game
    for (const sp of $$('#controls > span')) if (/^\/\s*chat/i.test(sp.textContent.trim())) { sp.setAttribute('data-ai', ''); sp.previousElementSibling?.classList.contains('sep') && sp.previousElementSibling.setAttribute('data-ai', ''); }
    let last = null;
    const apply = () => {
      const on = this.ai();
      if (on === last) return;
      last = on;
      // (after app.js has wired the tabs: the shell starts before them)
      setTimeout(() => {
        if (!this.ai() && $('.tab[data-tab=chat]')?.classList.contains('active')) $('.tab[data-tab=edits]')?.click();
        if (this.ai() && !$('.tab.active')) $('.tab[data-tab=chat]')?.click();
      }, 0);
      // the side column: the chat with AI; without it the history/stars panel, closed unless you opened it
      // (on a phone the panel sits under the game, so it starts open there)
      const hidden = on ? store.get('studio64.chatHidden') === '1' : (store.get('studio64.sideNoAi') ?? (window.innerWidth <= 900 ? '1' : '0')) !== '1';
      this.app.classList.toggle('chat-hidden', hidden);
      $('#chat-toggle')?.classList.toggle('active', on ? hidden : !hidden);
      const t = $('#chat-toggle');
      const play = $('#mode-play');
      if (play) play.title = 'Play: your level, with mouse, keyboard or gamepad (Tab)';
      if (t) { t.title = on ? `Show or hide the chat (${MOD}+J)` : `Edit history and stars (${MOD}+J)`; t.setAttribute('aria-label', on ? 'Show or hide the chat' : 'Edit history and stars'); }
      this.setSideVar?.();
      window.dispatchEvent(new Event('resize'));
    };
    new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.applyAi = apply;
    apply();
  }

  // ---- loading screen: a tip while the game boots ---------------------------------------------

  loadingTips() {
    const card = $('.loading-card');
    if (!card) return;
    const tips = [
      `Press <kbd>${MOD}</kbd><kbd>P</kbd> to find any action, tool or level`,
      { ai: true, html: 'Ask Claude: <i>“add a ring of coins around me”</i>' },
      '<kbd>Tab</kbd> switches between playing and building',
      { ai: true, html: 'Paste a sketch into the chat and Claude builds the level' },
      'New levels start from a template: an island, a desert, a volcano and more',
      'The Story workspace writes dialogs in the game\'s own font',
      '<kbd>?</kbd> shows every keyboard shortcut',
      'Every change saves by itself, and <kbd>' + MOD + '</kbd><kbd>Z</kbd> undoes it',
    ];
    const list = () => tips.filter((x) => typeof x === 'string' || this.ai()).map((x) => (typeof x === 'string' ? x : x.html));
    let i = Math.floor(Math.random() * 100);
    const tip = el('div', 'loading-tip', list()[i % list().length]);
    card.appendChild(tip);
    const t = setInterval(() => {
      if ($('#loading').hidden) { clearInterval(t); return; }
      tip.classList.add('swap');
      setTimeout(() => { const l = list(); tip.innerHTML = l[++i % l.length]; tip.classList.remove('swap'); }, 250);
    }, 4200);
  }

  // ---- top bar -------------------------------------------------------------------------------

  buildTopbar() {
    const bar = $('.topbar');
    const chip = $('#level-chip');
    const cmdk = el('button', 'cmdk-btn', `${icon('search', 'sm')}<span class="cmdk-label">Search actions, tools, levels…</span><span class="cmdk-keys"><kbd>${MOD}</kbd><kbd>P</kbd></span>`);
    cmdk.id = 'cmdk-btn';
    cmdk.type = 'button';
    cmdk.setAttribute('aria-label', 'Command palette');
    cmdk.onclick = () => this.openPalette();
    const center = el('div', 'topbar-center');
    center.appendChild(cmdk);
    chip.after(center);
    const chat = el('button', 'btn icon ghost', icon('panel'));
    chat.id = 'chat-toggle';
    chat.type = 'button';
    chat.title = `Show or hide the chat (${MOD}+J)`;
    chat.onclick = () => this.toggleChat();
    $('#share-btn').before(chat);
    // anything another module puts into the top bar goes to the rail
    new MutationObserver(() => this.adoptTopbar()).observe(bar, { childList: true, subtree: true });
  }

  adoptTopbar() {
    const bar = $('.topbar');
    for (const b of $$('button', bar)) {
      if (TOPBAR_KEEP.has(b.id) || b.closest('.project, .brand, .topbar-center') || b.closest('.menu')) continue;
      this.adopt(b);
    }
  }

  // ---- rail ----------------------------------------------------------------------------------

  buildRail() {
    const rail = el('nav', 'rail');
    rail.id = 'rail';
    rail.setAttribute('aria-label', 'Workspaces');
    rail.innerHTML = '<div class="rail-group rail-main"></div><div class="rail-group rail-ws"></div><div class="rail-spacer"></div><div class="rail-group rail-bottom"></div>';
    $('#stage').prepend(rail);
    this.rail = rail;
    // the help button
    const help = el('button', 'rail-btn', `${icon('help')}<span class="rail-label">Help</span>`);
    help.id = 'help-btn';
    help.type = 'button';
    help.title = 'Help: tour, shortcuts, command palette (?)';
    help.setAttribute('aria-label', 'Help');
    help.onclick = (e) => { e.stopPropagation(); this.helpMenu(help); };
    $('.rail-bottom', rail).appendChild(help);
    // Play and Build (index.html) and whatever already sits in the top bar
    this.adopt($('#mode-play'));
    this.adopt($('#mode-build'));
    $('.mode-switch')?.setAttribute('hidden', '');
    this.adoptTopbar();
    new MutationObserver(() => this.adoptRail()).observe(rail, { childList: true, subtree: true });
    // switching workspaces closes the one that is open
    rail.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const ws = this.wsOf(b);
      if (!ws) return;
      // (the Test panel floats over the game, so it closes the docked workspaces too)
      for (const w of WORKSPACES) if (w !== ws && w.isOpen?.()) w.close?.(this.state);
      $('.wd-map [data-a=close]')?.click(); // the world map (world_map.js) docks over the stage too
    }, true);
  }

  // Close Story, Sound, Assets, the world map: before a build tool takes the stage.
  closeWorkspaces() {
    for (const w of WORKSPACES) if (w.isOpen?.()) w.close?.(this.state);
    $('.wd-map [data-a=close]')?.click();
  }

  wsOf(b) { return [...WORKSPACES, ...BOTTOM].find((w) => b.matches(w.sel)); }

  adopt(b) {
    if (!b || b.dataset.railed) return;
    b.dataset.railed = '1';
    const ws = this.wsOf(b);
    b.classList.add('rail-btn');
    b.classList.remove('mode-btn');
    // a label under the icon: their own <span class="hide-sm">, or the text of Play/Build
    let label = $('.hide-sm', b) || [...b.querySelectorAll('span')].find((s) => s.textContent.trim());
    if (!label) {
      const text = [...b.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      label = el('span', '', esc(text.map((n) => n.textContent.trim()).join(' ') || ws?.label || b.title || ''));
      text.forEach((n) => n.remove());
      b.appendChild(label);
    }
    label.classList.add('rail-label');
    if (!$('svg', b)) b.insertAdjacentHTML('afterbegin', icon(ws?.icon || 'sparkles'));
    if (!b.title && ws) b.title = `${ws.label}: ${ws.about}${ws.keys ? ` (${ws.keys})` : ''}`;
    if (b.id === 'mode-play' && !/\(/.test(b.title)) b.title = 'Play: your level, with mouse, keyboard or gamepad (Tab)';
    if (b.id === 'mode-build' && !/:/.test(b.title)) b.title = 'Build: edit the level with the mouse (Tab)';
    b.setAttribute('aria-label', ws?.label || label.textContent.trim());
    const group = ws && BOTTOM.includes(ws) ? '.rail-bottom' : (ws?.id === 'play' || ws?.id === 'build') ? '.rail-main' : '.rail-ws';
    $(group, this.rail).appendChild(b);
    this.sortRail();
  }

  adoptRail() {
    // modules insert next to #sound-btn, which lives in the rail now
    for (const b of $$('button', this.rail)) if (!b.dataset.railed && b.id !== 'help-btn') this.adopt(b);
    this.sortRail();
  }

  sortRail() {
    const order = [...WORKSPACES, ...BOTTOM].map((w) => w.sel);
    for (const g of $$('.rail-group', this.rail)) {
      const kids = [...g.children];
      const rank = (b) => { const i = order.findIndex((s) => b.matches(s)); return b.id === 'help-btn' ? 999 : i < 0 ? 500 : i; };
      const sorted = [...kids].sort((a, b) => rank(a) - rank(b));
      if (sorted.some((b, i) => b !== kids[i])) sorted.forEach((b) => g.appendChild(b));
    }
  }

  // Which workspace is on screen; the rail shows it.
  syncActive() {
    const open = WORKSPACES.find((w) => w.isOpen?.());
    const build = !!this.state.editor?.active;
    const current = open ? open.id : build ? 'build' : 'play';
    if (this.current !== current) {
      const first = this.current === undefined;
      this.current = current;
      document.body.dataset.workspace = current;
      if (!first) this.contextHint(current);
    }
    for (const w of [...WORKSPACES, ...BOTTOM]) {
      const b = $(w.sel);
      if (!b) continue;
      const on = w.id === current || (w.id === 'test' && w.isOpen?.());
      b.classList.toggle('ws-current', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    }
  }

  // ---- contextual hints: once per browser, the first time you reach a place ----------------------

  contextHint(ws) {
    if (ws === 'build') this.hintOnce('build', '#library .lib-tabs', '<b>Your building tools.</b> Pick one, then click in the level. Right-drag orbits the camera, <kbd>?</kbd> lists every shortcut.', 'right');
    else if (ws === 'story' || ws === 'sound') this.hintOnce('docked', '#mode-play', `<b>The game is one click away.</b> <kbd>Esc</kbd> or Play goes back${this.ai() ? '; the chat stays open beside you' : ''}.`, 'right');
  }

  hintOnce(id, sel, html, place = 'below') {
    if (navigator.webdriver || store.get(`studio64.hint.${id}`) || $('.tour')) return;
    setTimeout(() => {
      const t = $(sel);
      const r = t?.getBoundingClientRect();
      if (!r || !r.width) return;
      store.set(`studio64.hint.${id}`, '1');
      $('.coach')?.remove();
      const c = el('div', `coach ${place}`, `<div class="coach-body">${html}</div><button class="coach-ok">Got it</button>`);
      c.setAttribute('role', 'status');
      document.body.appendChild(c);
      const w = c.offsetWidth, h = c.offsetHeight;
      const x = place === 'right' ? r.right + 14 : Math.max(10, Math.min(window.innerWidth - w - 10, r.left + r.width / 2 - w / 2));
      const y = place === 'right' ? Math.max(10, Math.min(window.innerHeight - h - 10, r.top + r.height / 2 - h / 2)) : r.bottom + 12;
      c.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      const bye = () => { c.classList.add('out'); setTimeout(() => c.remove(), 200); document.removeEventListener('pointerdown', away, true); };
      const away = (e) => { if (!c.contains(e.target)) bye(); };
      $('.coach-ok', c).onclick = bye;
      setTimeout(() => document.addEventListener('pointerdown', away, true), 400);
      setTimeout(bye, 12000);
    }, 500);
  }

  helpMenu(anchor) {
    const items = [
      ['Take the tour', 'compass', '', () => this.startTour(true)],
      ['Keyboard shortcuts', 'keyboard', '?', () => this.openShortcuts()],
      ['Command palette', 'command', `${MOD} P`, () => this.openPalette()],
      this.state.editor?.active ? ['Build controls', 'build', '', () => $('#build-help')?.click()] : null,
      [this.ai() ? 'AI assistant (on)' : 'AI assistant (off)', 'sparkles', '', () => this.openAiSettings()],
    ].filter(Boolean);
    this.popMenu(anchor, items, 'right');
    const version = this.state.config?.version;
    if (version) $('#shell-menu')?.appendChild(el('div', 'menu-foot', `Studio 64 ${esc(version)}`));
  }

  popMenu(anchor, items, side = 'below') {
    $('#shell-menu')?.remove();
    const m = el('div', 'menu shell-menu');
    m.id = 'shell-menu';
    for (const [label, ic, keys, run] of items) {
      const b = el('button', 'menu-item', `${icon(ic, 'sm')}<span>${esc(label)}</span>${keys ? `<span class="sub">${keys.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : ''}`);
      b.onclick = (e) => { e.stopPropagation(); m.remove(); run(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    if (side === 'right') { m.style.left = `${r.right + 8}px`; m.style.bottom = `${Math.max(8, window.innerHeight - r.bottom)}px`; } else { m.style.top = `${r.bottom + 6}px`; m.style.left = `${r.left}px`; }
    const close = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
    m.querySelector('button')?.focus();
    const trap = (e) => {
      if (!m.isConnected) { this.untrap(trap); return 'pass'; }
      const list = $$('button', m); const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); m.remove(); this.untrap(trap); anchor.focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement?.click(); this.untrap(trap); }
      else if (e.key === 'Tab') return 'pass';
    };
    this.trap(trap);
    new MutationObserver((_, o) => { if (!m.isConnected) { this.untrap(trap); o.disconnect(); } }).observe(document.body, { childList: true });
  }

  trap(fn) { this.traps.push(fn); }
  untrap(fn) { const i = this.traps.lastIndexOf(fn); if (i >= 0) this.traps.splice(i, 1); }

  // The AI assistant dialog (turn it on or off, pick models): works with AI on and off.
  openAiSettings() {
    if (this.state.openAi) { this.state.openAi(); return; }
    const item = $('#model-menu .ai-menu-settings');
    if (item) item.click(); else $('#menu-btn')?.click();
  }

  // ---- chat column ---------------------------------------------------------------------------

  watchSide() {
    const side = $('#side');
    const set = () => {
      const row = getComputedStyle($('#stage')).flexDirection === 'row';
      const w = row && !this.app.classList.contains('chat-hidden') ? side.getBoundingClientRect().width : 0;
      document.documentElement.style.setProperty('--side-cur-w', `${Math.round(w)}px`);
    };
    new ResizeObserver(set).observe(side);
    window.addEventListener('resize', set);
    this.setSideVar = set;
    set();
  }

  toggleChat(show = this.app.classList.contains('chat-hidden')) {
    this.app.classList.toggle('chat-hidden', !show);
    $('#chat-toggle')?.classList.toggle('active', this.ai() ? !show : show);
    $('#chat-toggle')?.setAttribute('aria-pressed', String(!show));
    if (this.ai()) store.set('studio64.chatHidden', show ? '0' : '1'); else store.set('studio64.sideNoAi', show ? '1' : '0');
    this.setSideVar?.();
    window.dispatchEvent(new Event('resize'));
  }

  // ---- library tabs (build mode) -------------------------------------------------------------

  watchLibTabs() {
    const tabs = $('.lib-tabs');
    if (!tabs) return;
    const deco = () => {
      const list = $$('.lib-tab', tabs);
      for (const t of list) {
        if ($('.lt-ico', t)) continue;
        const key = (t.dataset.lib || t.textContent || '').trim().toLowerCase();
        const name = LIB_ICONS[key] || LIB_ICONS[(t.textContent || '').trim().toLowerCase()] || 'sparkles';
        const label = t.textContent.trim();
        t.innerHTML = `<span class="lt-ico">${icon(name, 'sm')}</span><span class="lt-label">${esc(label)}</span>`;
        if (!t.title) t.title = label;
      }
      // things you place on the first row, the ground and the rules of the level on the second
      const ORDER = ['blocks', 'objects', 'structures', 'models', 'terrain', 'world', 'logic'];
      const rank = (t) => { const i = ORDER.indexOf(t.dataset.lib); return i < 0 ? 50 : i; };
      const sorted = [...list].sort((a, b) => rank(a) - rank(b));
      if (sorted.some((t, i) => t !== list[i])) sorted.forEach((t) => tabs.appendChild(t));
      const cols = list.length <= 4 ? list.length : Math.ceil(list.length / 2);
      if (tabs.style.getPropertyValue('--lib-cols') !== String(cols)) tabs.style.setProperty('--lib-cols', String(cols));
      tabs.classList.toggle('two-rows', list.length > 4);
    };
    new MutationObserver(deco).observe(tabs, { childList: true, subtree: true, characterData: true });
    deco();
  }

  // ---- tooltips with shortcuts ---------------------------------------------------------------

  tooltips() {
    // automated browsers keep the plain title attributes (tests select by them)
    if (navigator.webdriver && !/[?&]tips=1/.test(location.search)) return;
    const tip = el('div', 'tip');
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
    let target = null, timer = 0;
    const hide = () => {
      clearTimeout(timer);
      tip.hidden = true;
      if (target && target.dataset.tip !== undefined && !target.hasAttribute('title')) target.setAttribute('title', target.dataset.tip);
      if (target) delete target.dataset.tip;
      target = null;
    };
    const show = (t) => {
      const text = t.dataset.tip;
      if (!text || !t.isConnected) return;
      // "Undo (Ctrl+Z)" -> Undo + keys
      const m = /^(.*?)\s*\(([^()]{1,24})\)\s*$/.exec(text);
      const keys = m && KEYS_RE.test(m[2]) ? m[2] : null;
      const body = keys ? m[1] : text;
      const [head, ...rest] = body.split(/:\s(.+)/s);
      const more = rest.join('');
      tip.innerHTML = `${rest.length && head.length < 28 ? `<b>${esc(head)}</b><span>${esc(more.charAt(0).toUpperCase() + more.slice(1))}</span>` : `<span class="one">${esc(body)}</span>`}${keys ? `<span class="tip-keys">${keys.split(/\s*([+·/]|\bor\b)\s*/).filter((k) => k && !/^[+·]$/.test(k)).map((k) => (k === '/' || k === 'or' ? `<i>${k}</i>` : `<kbd>${esc(k)}</kbd>`)).join('')}</span>` : ''}`;
      tip.hidden = false;
      const r = t.getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const inRail = !!t.closest('.rail');
      let x = inRail ? r.right + 10 : r.left + r.width / 2 - w / 2;
      let y = inRail ? r.top + r.height / 2 - h / 2 : r.bottom + 8;
      if (!inRail && y + h > window.innerHeight - 6) y = r.top - h - 8;
      x = Math.max(6, Math.min(window.innerWidth - w - 6, x));
      y = Math.max(6, Math.min(window.innerHeight - h - 6, y));
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      tip.dataset.side = inRail ? 'right' : 'below';
    };
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const t = e.target.closest?.('[title]');
      if (!t || t === target) return;
      // only the studio's own chrome: not the game canvas, not options inside selects
      if (t.closest('canvas, option, select, .no-tip') || t.tagName === 'IFRAME') return;
      hide();
      target = t;
      t.dataset.tip = t.getAttribute('title');
      t.removeAttribute('title'); // no native tooltip on top of ours
      timer = setTimeout(() => show(t), t.closest('.rail') ? 250 : 550);
    });
    document.addEventListener('pointerout', (e) => { if (target && (!e.relatedTarget || !target.contains(e.relatedTarget))) hide(); });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', () => { if (!tip.hidden) hide(); }, true);
    window.addEventListener('blur', hide);
  }

  // ---- keys ----------------------------------------------------------------------------------

  keys() {
    // window + capture: before every panel's own key handling
    window.addEventListener('keydown', (e) => {
      const trap = this.traps[this.traps.length - 1];
      if (trap) { if (trap(e) !== 'pass') e.stopImmediatePropagation(); return; }
      // Tab switches Play/Build, except for keyboard users moving through the interface:
      // Shift+Tab walks into the controls, and once there Tab moves on (the mouse resets this)
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !typingIn()) {
        const a = document.activeElement;
        const kbd = document.body.classList.contains('kbd-nav');
        // (the focus wrapped past the last control to the page itself: still walking)
        const inUi = a && a.id !== 'canvas' && a.id !== 'overlay' && (a !== document.body || kbd);
        if (e.shiftKey || (inUi && kbd)) {
          e.stopImmediatePropagation();
          document.body.classList.add('kbd-nav');
          // walking the controls passes over the game (Tab there switches Play/Build, so the chat,
          // edits and stars after it were out of reach); Esc goes back to the game
          if (inUi) {
            const back = e.shiftKey;
            const inGame = (x) => x.id === 'canvas' || x.id === 'overlay';
            const list = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].filter((x) => x.tabIndex >= 0 && !x.disabled && x.offsetParent && !x.closest('[hidden]'));
            const i = list.indexOf(a);
            const step = back ? -1 : 1;
            let j = i < 0 ? (back ? list.length - 1 : 0) : i + step;
            if (list[j] && inGame(list[j])) {
              while (list[j] && inGame(list[j])) j += step;
              const target = list[j] || (back ? list.filter((x) => !inGame(x)).pop() : list.find((x) => !inGame(x)));
              if (target) { e.preventDefault(); target.focus(); }
            }
          }
          return;
        }
      }
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && document.body.classList.contains('kbd-nav') && document.activeElement?.closest?.('.topbar, .rail, .side') && !typingIn()
        && !$('.menu:not([hidden]), .hub-menu, .dlg-back, .cmdk-back:not(.out), .shell-sheet-back:not(.out), .tour:not(.out), .modal-back:not([hidden]), .ai-back') && !WORKSPACES.some((w) => w.isOpen?.())) {
        e.preventDefault();
        $('#canvas')?.focus();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); e.stopPropagation(); this.togglePalette(); return; }
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); e.stopPropagation(); this.toggleChat(); return; }
      // Esc closes the docked Story even when the focus is not inside it (it listens on itself)
      if (e.key === 'Escape' && !typingIn() && $('#story-studio:not([hidden])') && !$('#story-studio').contains(document.activeElement) && !$('.st-modal, .st-menu, .om-modal, .ai-back, .launcher:not([hidden])')) { this.state.storyUI?.close(); return; }
      if (typingIn() || $('.dlg-back:not(.out), .cmdk-back:not(.out), .shell-sheet-back:not(.out), .tour:not(.out)')) return;
      if (e.key === '?' && !mod) { e.preventDefault(); this.openShortcuts(); return; }
      // "/" writes to Claude: bring the chat back first
      if (e.key === '/' && !mod && this.ai() && this.app.classList.contains('chat-hidden')) this.toggleChat(true);
    }, true);
  }

  a11y() {
    // icon-only buttons get a name from their tooltip
    const name = () => {
      for (const b of $$('button:not([aria-label])')) {
        if (b.textContent.trim()) continue;
        const t = b.getAttribute('title') || b.dataset.tip;
        if (t) b.setAttribute('aria-label', t.replace(/\s*\([^)]*\)\s*$/, ''));
      }
    };
    name();
    let pending = false;
    new MutationObserver(() => { if (pending) return; pending = true; setTimeout(() => { pending = false; name(); }, 400); }).observe(document.body, { childList: true, subtree: true });
    // keyboard users get focus rings, mouse users do not
    document.addEventListener('keydown', (e) => {
      const ui = document.activeElement && document.activeElement !== document.body && document.activeElement.id !== 'canvas';
      if ((e.key.startsWith('Arrow') && ui) || (e.key === 'Tab' && typingIn())) document.body.classList.add('kbd-nav'); // Tab itself: keys() decides
    }, true);
    document.addEventListener('pointerdown', () => document.body.classList.remove('kbd-nav'), true);
  }

  // ---- command palette -----------------------------------------------------------------------

  // Other modules: window.studioShell.register({ id, label, group, icon, keys, run, when })
  register(cmd) {
    if (!cmd?.id || typeof cmd.run !== 'function') return;
    this.commands.set(cmd.id, cmd);
  }

  collect() {
    const s = this.state;
    const out = [];
    const add = (c) => { if (!c.when || c.when()) out.push(c); };
    // workspaces
    for (const w of [...WORKSPACES, ...BOTTOM]) {
      const b = $(w.sel);
      if (!b) continue;
      add({ id: `ws:${w.id}`, group: 'Workspaces', icon: w.icon, label: w.id === 'play' ? 'Play' : w.id === 'build' ? 'Build mode' : `Open ${b.getAttribute('aria-label') || w.label}`, hint: w.about, keys: w.keys, run: () => b.click() });
    }
    // build tools
    for (const t of $$('.lib-tab')) {
      const label = t.textContent.trim();
      add({ id: `tool:${t.dataset.lib || label}`, group: 'Build tools', icon: LIB_ICONS[(t.dataset.lib || '').toLowerCase()] || 'build', label: `Build: ${label}`, run: () => { this.closeWorkspaces(); if (!s.editor?.active) $('#mode-build')?.click(); setTimeout(() => t.click(), s.editor?.active ? 0 : 120); } });
    }
    if (s.editor?.active) {
      for (const b of $$('#build-bar button[title], #build-bar [data-gizmo]')) {
        const t = (b.getAttribute('title') || b.dataset.tip || '').trim();
        if (!t) continue;
        const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(t);
        add({ id: `bar:${t}`, group: 'Build', icon: 'build', label: m ? m[1] : t, keys: m ? m[2] : '', run: () => { this.closeWorkspaces(); b.click(); } });
      }
    }
    // straight to a page of a workspace
    const pages = [
      ['story', 'Story', 'book', s.storyUI, [['dialogs', 'Dialogs'], ['characters', 'Characters'], ['logic', 'Logic: events and flags'], ['cutscenes', 'Cutscenes'], ['texts', 'Game texts'], ['start', 'Start & end']]],
      ['assets', 'Assets', 'cube', s.assetsUI, [['models', '3D models'], ['textures', 'Textures'], ['materials', 'Materials'], ['sky', 'Sky'], ['mario', 'Mario\'s colours']]],
      ['sound', 'Sound', 'music', s.soundUI, [['music', 'Music'], ['sounds', 'Sound effects']]],
    ];
    for (const [ws, name, ic, ui, tabs] of pages) {
      if (!ui?.open) continue;
      for (const [tab, label] of tabs) {
        add({ id: `page:${ws}:${tab}`, group: name, icon: ic, label: `${name}: ${label}`, run: () => { for (const w of WORKSPACES) if (w.id !== ws && w.isOpen?.()) w.close?.(s); ui.open(tab); } });
      }
    }
    if (s.objects?.scene?.toggle) add({ id: 'scene', group: 'Build', icon: 'layers', label: 'Scene: everything in this level', keys: 'O', run: () => { this.closeWorkspaces(); if (!s.editor?.active) $('#mode-build')?.click(); setTimeout(() => s.objects.scene.toggle(), s.editor?.active ? 0 : 150); } });
    // project
    add({ id: 'levels', group: 'Levels', icon: 'globe', label: 'Level launcher', hint: 'All levels with pictures', keys: `${MOD}+K`, run: () => $('#level-chip').click() });
    if (s.worldUI?.map) add({ id: 'world-map', group: 'Levels', icon: 'route', label: 'World map', hint: 'How your levels and areas connect', run: () => s.worldUI.map.open() });
    if (s.testing?.runCheck) add({ id: 'check-level', group: 'Levels', icon: 'check', label: 'Check this level', hint: 'Find unreachable stars, missing exits, …', run: () => { $('#test-btn')?.click(); setTimeout(() => $('.tt-tab[data-tab=check]')?.click(), 60); } });
    add({ id: 'new-level', group: 'Levels', icon: 'plus', label: 'New level…', hint: 'From a template or a picture', run: () => { $('#level-chip').click(); setTimeout(() => $('.lvl-card .newpic')?.closest('.lvl-card')?.click(), 120); } });
    for (const it of s.hub?.menuItems?.() || []) {
      if (it === '-') continue;
      add({ id: `hub:${it.label}`, group: 'Project', icon: { home: 'home', gear: 'settings', save: 'download', history: 'clock', link: 'share', file: 'download', gamepad: 'gamepad', upload: 'upload', plus: 'plus' }[it.icon] || 'folder', label: it.label.replace(/…$/, ''), hint: it.sub || '', run: it.run });
    }
    add({ id: 'share', group: 'Project', icon: 'share', label: 'Share', run: () => $('#share-btn').click() });
    add({ id: 'rename', group: 'Project', icon: 'folder', label: 'Rename project', run: () => { const n = $('#project-name'); n.focus(); n.select(); } });
    // chat
    const ai = this.ai();
    if (ai) add({ id: 'chat', group: 'Chat', icon: 'message', label: 'Write to Claude', keys: '/', run: () => { if (this.app.classList.contains('chat-hidden')) this.toggleChat(true); $('.tab[data-tab=chat]')?.click(); $('#input').focus(); } });
    if (ai) add({ id: 'new-chat', group: 'Chat', icon: 'message', label: 'New conversation', run: () => $('#new-chat').click() });
    const side = ai ? 'the chat' : 'the history and stars';
    add({ id: 'toggle-chat', group: ai ? 'Chat' : 'View', icon: 'panel', label: this.app.classList.contains('chat-hidden') ? `Show ${side}` : `Hide ${side}`, keys: `${MOD}+J`, run: () => this.toggleChat() });
    add({ id: 'edits', group: ai ? 'Chat' : 'Project', icon: 'clock', label: 'Edit history', run: () => { if (this.app.classList.contains('chat-hidden')) this.toggleChat(true); $('.tab[data-tab=edits]')?.click(); } });
    add({ id: 'stars', group: ai ? 'Chat' : 'Levels', icon: 'star', label: 'Stars in this level', run: () => { if (this.app.classList.contains('chat-hidden')) this.toggleChat(true); $('.tab[data-tab=stars]')?.click(); } });
    if (ai) add({ id: 'ai', group: 'Chat', icon: 'sparkles', label: 'AI settings', hint: 'Other models and providers', run: () => this.openAiSettings() });
    // view and help
    add({ id: 'fullscreen', group: 'View', icon: 'panel', label: 'Fullscreen game', run: () => $('#fullscreen-btn')?.click() });
    add({ id: 'shortcuts', group: 'Help', icon: 'keyboard', label: 'Keyboard shortcuts', keys: '?', run: () => this.openShortcuts() });
    add({ id: 'tour', group: 'Help', icon: 'compass', label: 'Take the tour', run: () => this.startTour(true) });
    // registered by other modules
    for (const c of this.commands.values()) add({ group: 'Commands', icon: 'sparkles', ...c });
    // levels last: there are many
    const here = s.engine?.level;
    for (const l of s.levels || []) add({ id: `lvl:c:${l.id}`, group: 'Go to level', icon: 'star', label: l.name, hint: 'Your level', run: () => s.levelsUI?.go({ custom: l.id, name: l.name }) });
    for (const [slug, info] of Object.entries(s.catalog?.levels || {})) {
      if (!info.num) continue;
      add({ id: `lvl:${slug}`, group: 'Go to level', icon: 'door', label: info.name, hint: info.num === here ? 'You are here' : (info.acts ? 'Course' : ''), run: () => s.levelsUI?.go({ ...info, slug }) });
    }
    return out;
  }

  togglePalette() { if ($('.cmdk-back:not(.out)')) this.closePalette(); else this.openPalette(); }

  openPalette(query = '') {
    if ($('.cmdk-back:not(.out)')) return;
    $$('.cmdk-back.out').forEach((b) => b.remove()); // one still fading out
    this.paletteReturn = document.activeElement;
    this.state.engine?.releaseKeys?.();
    const all = this.collect();
    const recent = JSON.parse(store.get('studio64.recentCmds') || '[]');
    const back = el('div', 'cmdk-back');
    back.innerHTML = `<div class="cmdk" role="dialog" aria-label="Command palette">
      <div class="cmdk-search">${icon('search')}<input type="text" placeholder="Type a command, a tool or a level…" spellcheck="false" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="cmdk-list"><kbd>Esc</kbd></div>
      <div class="cmdk-list" id="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div></div>`;
    document.body.appendChild(back);
    const input = $('input', back), list = $('.cmdk-list', back);
    let shown = [], idx = 0;
    const score = (c, words) => {
      const hay = `${c.label} ${c.group} ${c.hint || ''}`.toLowerCase();
      let sc = 0;
      for (const w of words) {
        const i = hay.indexOf(w);
        if (i < 0) return -1;
        const li = c.label.toLowerCase().indexOf(w);
        sc += li === 0 ? 30 : li > 0 && /\s/.test(c.label[li - 1]) ? 20 : li >= 0 ? 10 : 2;
      }
      if (c.group === 'Go to level') sc -= 3;
      return sc;
    };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      if (!words.length) {
        const rec = recent.map((id) => all.find((c) => c.id === id)).filter(Boolean).slice(0, 5).map((c) => ({ ...c, group: 'Recent' }));
        shown = [...rec, ...all.filter((c) => c.group !== 'Go to level' || c.hint === 'Your level')];
      } else {
        shown = all.map((c) => [c, score(c, words)]).filter(([, sc]) => sc >= 0).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 60);
      }
      idx = Math.min(idx, Math.max(0, shown.length - 1));
      let html = '', group = null;
      shown.forEach((c, i) => {
        if (!words.length && c.group !== group) { group = c.group; html += `<div class="cmdk-group">${esc(group)}</div>`; }
        html += `<div class="cmdk-item${i === idx ? ' active' : ''}" role="option" data-i="${i}" aria-selected="${i === idx}">
          <span class="cmdk-ico">${icon(c.icon || 'sparkles', 'sm')}</span>
          <span class="cmdk-text"><b>${esc(c.label)}</b>${c.hint ? `<span>${esc(c.hint)}</span>` : ''}</span>
          ${words.length ? `<span class="cmdk-tag">${esc(c.group)}</span>` : ''}
          ${c.keys ? `<span class="cmdk-k">${String(c.keys).split(/\+/).map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : ''}</div>`;
      });
      list.innerHTML = html || `<div class="cmdk-empty">${icon('search')}<b>Nothing found for “${esc(input.value)}”</b>${this.ai() ? '<span>Ask Claude instead: press <kbd>Enter</kbd></span>' : '<span>Try another word: tools, levels and actions are all here</span>'}</div>`;
      list.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
    };
    const run = (c) => {
      this.closePalette();
      if (!c) {
        // nothing matched: hand the words to Claude (when there is one)
        const text = input.value.trim();
        if (!text || !this.ai()) return;
        if (this.app.classList.contains('chat-hidden')) this.toggleChat(true);
        const i = $('#input'); i.value = text; i.dispatchEvent(new Event('input')); i.focus();
        return;
      }
      store.set('studio64.recentCmds', JSON.stringify([c.id, ...recent.filter((x) => x !== c.id)].slice(0, 8)));
      try { c.run(); } catch (err) { console.warn('command failed', c.id, err); this.toast(`Could not run “${c.label}”`, 'x'); }
    };
    input.addEventListener('input', () => { idx = 0; render(); });
    this.paletteTrap = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
      else if (e.key === 'PageDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 8); render(); }
      else if (e.key === 'PageUp') { e.preventDefault(); idx = Math.max(0, idx - 8); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(shown[idx]); }
      else if (e.key === 'Escape' || (mod && (e.key === 'p' || e.key === 'P'))) { e.preventDefault(); this.closePalette(); }
      else if (document.activeElement !== input && e.key.length === 1 && !mod) input.focus(); // typing goes to the search
    };
    this.trap(this.paletteTrap);
    list.addEventListener('mousemove', (e) => { const it = e.target.closest('.cmdk-item'); if (it && +it.dataset.i !== idx) { idx = +it.dataset.i; $$('.cmdk-item', list).forEach((x) => x.classList.toggle('active', +x.dataset.i === idx)); } });
    list.addEventListener('click', (e) => { const it = e.target.closest('.cmdk-item'); if (it) run(shown[+it.dataset.i]); });
    back.addEventListener('mousedown', (e) => { if (e.target === back) this.closePalette(); });
    input.value = query;
    render();
    input.focus();
  }

  closePalette() {
    const b = $('.cmdk-back');
    if (this.paletteTrap) { this.untrap(this.paletteTrap); this.paletteTrap = null; }
    if (!b || b.classList.contains('out')) return;
    // the focus goes back where it was (never stays in the closing search field)
    const back = this.paletteReturn;
    document.activeElement?.blur?.();
    if (back && back !== document.body && back.isConnected && !b.contains(back)) try { back.focus({ preventScroll: true }); } catch { /* */ }
    b.classList.add('out');
    setTimeout(() => b.remove(), 120);
  }

  // ---- shortcut sheet ------------------------------------------------------------------------

  openShortcuts() {
    if ($('.shell-sheet-back:not(.out)')) return;
    $$('.shell-sheet-back.out').forEach((b) => b.remove());
    this.state.engine?.releaseKeys?.();
    const back = el('div', 'shell-sheet-back');
    const keys = (ks) => ks.split(' ').map((combo) => combo.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('<i>+</i>')).join('');
    back.innerHTML = `<div class="shell-sheet" role="dialog" aria-label="Keyboard shortcuts">
      <div class="sheet-head"><div class="sheet-title">${icon('keyboard')}Keyboard shortcuts</div><button class="btn icon ghost" data-a="close" title="Close (Esc)">${icon('x')}</button></div>
      <div class="sheet-grid">${SHORTCUTS.map(([sec, rows]) => `<section><h3>${esc(sec)}</h3>${rows.filter((r) => !r[2] || (r[2] === 'ai') === this.ai()).map(([k, what]) => `<div class="sheet-row"><span class="sheet-k">${keys(k)}</span><span>${esc(what)}</span></div>`).join('')}</section>`).join('')}</div>
      <div class="sheet-foot">Tip: <kbd>${MOD}</kbd><kbd>P</kbd> finds every action by name, and every button shows its shortcut when you point at it.</div></div>`;
    document.body.appendChild(back);
    const close = () => { back.classList.add('out'); setTimeout(() => back.remove(), 120); this.untrap(key); };
    const key = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); close(); } else if (e.key === 'Tab' || e.key === 'Enter') return 'pass'; };
    this.trap(key);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    $('[data-a=close]', back).onclick = close;
    $('[data-a=close]', back).focus();
  }

  // ---- first-run tour ------------------------------------------------------------------------

  // Called when the game is up. Runs once per browser; Help > Take the tour runs it again.
  maybeTour() {
    const force = new URL(location.href).searchParams.get('tour') === '1';
    if (!force && (store.get('studio64.tourDone') || navigator.webdriver)) return;
    const go = () => {
      // not over the project home screen or an open panel
      if ($('.home:not([hidden])') || $('.modal-back:not([hidden]), .dlg-back, .launcher:not([hidden])') || WORKSPACES.some((w) => w.isOpen?.())) { setTimeout(go, 1500); return; }
      this.startTour();
    };
    setTimeout(go, 900);
  }

  startTour(again = false) {
    this.endTour?.();
    if (again && this.state.editor?.active) $('#mode-play')?.click();
    this.state.engine?.releaseKeys?.();
    let step = 0;
    const ai = this.ai();
    const TOUR = TOUR_STEPS.filter((x) => (ai ? !x.noAi : !x.ai)).map((x) => ({ ...x, text: !ai && x.textNoAi ? x.textNoAi : x.text }));
    const root = el('div', 'tour');
    root.innerHTML = '<div class="tour-shade"></div><div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(root);
    const spot = $('.tour-spot', root), card = $('.tour-card', root), shade = $('.tour-shade', root);
    const done = () => {
      store.set('studio64.tourDone', '1');
      window.removeEventListener('resize', place);
      this.untrap(key);
      root.classList.add('out');
      setTimeout(() => root.remove(), 200);
      this.endTour = null;
      $('#canvas')?.focus();
    };
    this.endTour = done;
    const place = () => {
      const s = TOUR[step];
      const t = s.target && $(s.target);
      const r = t && t.getBoundingClientRect();
      const visible = r && r.width > 0 && r.height > 0;
      root.classList.toggle('centered', !visible);
      shade.hidden = !!visible;
      spot.hidden = !visible;
      if (visible) {
        const pad = 6, vw0 = window.innerWidth, vh0 = window.innerHeight;
        const L = Math.max(3, r.left - pad), T = Math.max(3, r.top - pad), R = Math.min(vw0 - 3, r.right + pad), B = Math.min(vh0 - 3, r.bottom + pad);
        Object.assign(spot.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
      }
      const W = card.offsetWidth, H = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      let x = (vw - W) / 2, y = (vh - H) / 2;
      if (visible) {
        const big = r.width > vw * 0.45 && r.height > vh * 0.45; // the game: the card sits inside it
        if (big) { x = r.left + 28; y = r.bottom - H - 28; } else if (s.place === 'right') { x = r.right + 18; y = r.top + r.height / 2 - H / 2; } else if (s.place === 'left') { x = r.left - W - 18; y = r.top + r.height / 2 - H / 2; } else { x = r.left + r.width / 2 - W / 2; y = r.bottom + 16; }
        if (x + W > vw - 12) x = Math.max(12, r.left - W - 18);
        if (x < 12) x = 12;
        if (y + H > vh - 12) y = Math.max(12, r.top - H - 16);
        y = Math.max(12, y);
      }
      card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    const render = () => {
      const s = TOUR[step];
      const last = step === TOUR.length - 1;
      card.innerHTML = `${step === 0 ? `<div class="tour-mark">${icon('star')}</div>` : ''}
        <div class="tour-step">${step === 0 ? '60-second tour' : `${step} of ${TOUR.length - 1}`}</div>
        <h3>${esc(s.title)}</h3><p>${s.text}</p>
        <div class="tour-foot">
          <div class="tour-dots">${TOUR.slice(1).map((_, i) => `<span class="${i + 1 === step ? 'on' : i + 1 < step ? 'past' : ''}"></span>`).join('')}</div>
          ${step === 0 ? '<button class="btn ghost sm" data-a="skip">Skip</button>' : `<button class="btn ghost sm" data-a="back">Back</button>`}
          <button class="btn primary sm" data-a="next">${esc(s.cta || (last ? 'Done' : 'Next'))}${last ? '' : icon('arrowRight', 'sm')}</button>
        </div>
        ${step > 0 && !last ? '<button class="tour-x" data-a="skip" title="End the tour (Esc)">' + icon('x', 'sm') + '</button>' : ''}`;
      $('[data-a=next]', card).onclick = () => { if (last) done(); else { step++; render(); } };
      $('[data-a=back]', card)?.addEventListener('click', () => { step--; render(); });
      $$('[data-a=skip]', card).forEach((b) => { b.onclick = done; });
      card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
      place();
      $('[data-a=next]', card).focus({ preventScroll: true });
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (step < TOUR.length - 1) { step++; render(); } else done(); }
      else if (e.key === 'ArrowLeft' && step > 0) { e.preventDefault(); step--; render(); }
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') return 'pass'; // the focused button
    };
    this.trap(key);
    window.addEventListener('resize', place);
    render();
  }
}
