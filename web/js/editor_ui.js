// Library (blocks, objects, structures) and inspector panels for build mode.
import { SHAPE_NAMES, MATERIALS, PRESETS, GENERATORS, SURFACES, SURFACE_LABELS, blockDefaults, yawToDeg, degToYaw } from './generators.js';
import { SKIES, Terrain, terrainFromImage } from './terrain.js';
import { GAME_SONGS } from './music.js';
import { loadPictures, objectPicture, objectPictureIds } from './pictures.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHAPE_ICONS = {
  box: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  platform: '<path d="M2 10l10-4 10 4-10 4z"/><path d="M2 10v3l10 4 10-4v-3"/>',
  ledge: '<path d="M4 3v18"/><path d="M4 10h12l3 2H4"/>',
  wall: '<path d="M3 5h18v14H3z"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>',
  floor: '<path d="M2 14l10-5 10 5-10 5z"/>',
  ramp: '<path d="M3 19h18V7z"/>',
  stairs: '<path d="M3 21h6v-5h5v-5h5V6h3"/><path d="M3 21h18V6"/>',
  pillar: '<ellipse cx="12" cy="5" rx="6" ry="2.5"/><path d="M6 5v14c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5"/>',
};
const GEN_ICONS = {
  stairs: SHAPE_ICONS.stairs,
  spiral: '<path d="M12 21V3"/><path d="M12 6c4 0 6 1 6 2s-2 2-6 2-6 1-6 2 2 2 6 2 6 1 6 2-2 2-6 2"/>',
  wall_climb: '<path d="M4 3v18"/><path d="M4 18h6M4 13h9M4 8h6"/>',
  bridge: '<path d="M2 12h20M5 12v5M19 12v5M2 9c5 3 15 3 20 0"/>',
  path: '<path d="M3 18h4M10 13h4M17 8h4"/>',
  tower: '<path d="M6 21V7l2-2h8l2 2v14M6 11h12M10 21v-4h4v4M9 5V3M15 5V3"/>',
};
const GEN_HELP = {
  stairs: 'Click the ground where the stairs start. R turns them.',
  spiral: 'Click where the center of the spiral goes.',
  wall_climb: 'Click a wall: ledges go up it in a zig-zag.',
  bridge: 'Click where the bridge starts, then where it ends.',
  path: 'Click where the path starts. It goes away from the camera; R turns it.',
  tower: 'Click where the tower stands. R turns the door.',
};

// Sane ranges for the structure parameters (min, max).
const GEN_LIMITS = {
  count: [1, 40], floors: [1, 12], steps: [1, 64], ledges: [1, 30], planks: [0, 60], radius: [100, 4000],
  rise: [-600, 600], gap: [100, 2000], size: [100, 4000], width: [60, 3000], height: [50, 6000], depth: [50, 6000],
  thickness: [10, 400], wiggle: [0, 2000], turn: [-90, 90], floorHeight: [200, 1200], spread: [0, 2000],
};

// Which library category an object belongs to.
function categoryOf(e) {
  const id = e.id;
  if (id.startsWith('sms:')) return 'sunshine';
  if (id.startsWith('vehicle:')) return 'vehicles'; // cars and races (vehicles.js)
  if (id.startsWith('sg:') || id.startsWith('kt:') || id.startsWith('tokyo:')) return 'shoggoth'; // Shotgun Mario, Katana Mario, Tokyo (tokyo_template.js)
  if (e.prop || /^static_object|^prop:/.test(id)) return 'decor';
  if (/king_bobomb|whomp_king|big_bully|big_chill|eyerok|wiggler|bowser\b|ghost_hunt_big|balcony_big_boo|chain_chomp/.test(id)) return 'bosses';
  if (/coin|1_?up|star|heart|cap\b|_cap|exclamation_box|breakable_box|shell|hidden1up|jumping_box|metal_box/.test(id)) return 'items';
  if (/buddy|toad|yoshi|hoot|ukiki|tuxie|penguin|mips|dorrie|manta|bird|butterfly|fish|signpost|message_panel|sign_on_wall|wooden_post|lakitu_cam|camera_lakitu/.test(id)) return 'friends';
  if (/goomba|bobomb|koopa\b|boo\b|boo_|bully|whomp|thwomp|piranha|spiny|fly_guy|snufit|scuttlebug|amp|chuckya|heave_ho|skeeter|monty|klepto|pokey|blizzard|mr_i|swoop|bullet_bill|enemy_lakitu|moneybag|spindrift|fire_spitter|flamethrower|fireball|grindel|spindel|tox_box|tweester|unagi|shark|bub\b|chirp|bomp|mad_piano|haunted|bookend|water_bomb|bowling_ball|boulder|rolling_log/.test(id)) return 'enemies';
  if (/warp|pipe|door|cannon|switch|elevator|platform|seesaw|rotating|sliding|tumbling|bridge|pole|merry|lift|swing|trap|grill|cage|arrow|pillar|block|box|bar|cog|treadmill|pendulum|spinner|hand|track|flag|bouncing/.test(id)) return 'mechanics';
  if (/tree|flame|flower|bush|seaweed|cloud/.test(id)) return 'decor';
  return 'other';
}
const CATS = [
  ['popular', 'Popular'], ['sunshine', 'Sunshine'], ['vehicles', 'Vehicles'], ['shoggoth', 'Shoggoth'], ['enemies', 'Enemies'], ['items', 'Items'], ['bosses', 'Bosses'], ['friends', 'Friends'],
  ['mechanics', 'Mechanics'], ['decor', 'Decoration'], ['other', 'Other'], ['all', 'All'],
];
const POPULAR = ['bobomb', 'goomba', 'koopa', 'boo', 'chain_chomp', 'small_whomp', 'thwomp', 'small_bully', 'piranha_plant',
  'spiny', 'fly_guy', 'yellow_coin', 'red_coin', 'star', '1_up', 'exclamation_box', 'breakable_box', 'recovery_heart',
  'warp_pipe', 'cannon_closed', 'tree:bubbly_tree', 'tree:palm_tree', 'wooden_post', 'bobomb_buddy', 'king_bobomb',
  'whomp_king_boss', 'koopa_shell', 'wing_cap', 'checkerboard_elevator_group:checkerboard_platform', 'yoshi'];

// Friendly controls for the behavior params that matter most.
const PARAM_UI = {
  star: { label: 'Star number', byte: 0, options: [0, 1, 2, 3, 4, 5].map((i) => [i, `Star ${i + 1}`]) },
  exclamation_box: { label: 'Contents', byte: 1, options: [[0, 'Wing cap'], [1, 'Metal cap'], [2, 'Vanish cap'], [3, 'Koopa shell'], [4, 'Coin'], [5, '3 coins'], [6, '10 coins'], [7, '1-Up'], [8, 'Star'], [9, 'Running 1-Up']] },
  goomba: { label: 'Size', byte: 1, options: [[0, 'Normal'], [1, 'Huge'], [2, 'Tiny']] },
  coin_formation: { label: 'Shape', byte: 1, options: [[0, 'Line'], [2, 'Ring'], [4, 'Arrow'], [1, 'Vertical line'], [18, 'Flying ring'], [3, 'Vertical ring']] },
  koopa: { label: 'Type', byte: 1, options: [[1, 'With shell'], [0, 'No shell']] },
  'sms:pianta': { label: 'Does', byte: 3, options: [[0, 'Strolls around'], [1, 'Stands'], [2, 'Dances']] },
  'sms:pianta_woman': { label: 'Does', byte: 3, options: [[0, 'Strolls around'], [1, 'Stands'], [2, 'Dances']] },
  'sms:noki': { label: 'Does', byte: 3, options: [[0, 'Strolls around'], [1, 'Stands'], [2, 'Dances']] },
  'sms:noki_woman': { label: 'Does', byte: 3, options: [[0, 'Strolls around'], [1, 'Stands'], [2, 'Dances']] },
  'sms:strollin_stu': [{ label: 'Does', byte: 3, options: [[0, 'Wanders around'], [1, 'Guards its spot']] },
    { label: 'Size', byte: 1, options: [[0, 'Normal'], [1, 'Big'], [2, 'Small']] }],
  'sms:swoopin_stu': [{ label: 'Does', byte: 3, options: [[0, 'Crawls around'], [1, 'Waits for Mario']] },
    { label: 'Colour', byte: 2, options: [[0, 'Mixed'], [1, 'Red'], [2, 'Orange'], [3, 'Yellow'], [4, 'Green'], [5, 'Light blue'], [6, 'Blue'], [7, 'Pink']] }],
  'sms:electrokoopa': { label: 'Does', byte: 3, options: [[0, 'Roams'], [1, 'Stands guard']] },
  'sms:pokey': { label: 'Segments', byte: 3, options: [[0, '3 (full)'], [2, '2'], [1, '1']] },
  'sms:cataquack': [{ label: 'Kind', byte: 2, options: [[0, 'Blue: tosses Mario up'], [1, 'Red: rams Mario']] },
    { label: 'Does', byte: 3, options: [[0, 'Waddles around'], [1, 'Sleeps']] }],
  'sg:gangster': { label: 'Look', byte: 1, options: [[0, 'Red bandana'], [1, 'Blue bandana'], [2, 'Black bandana']] },
  'kt:fighter': { label: 'Look', byte: 1, options: [[0, 'Mario (the boss)'], [1, 'Luigi'], [2, 'Wario'], [3, 'Waluigi'], [4, 'Peach'], [5, 'Yoshi']] },
  'sms:blooper': { label: 'Does', byte: 3, options: [[0, 'Patrols'], [1, 'Stands guard']] },
};

export class EditorUI {
  constructor({ editor, engine, world, catalog, send, chat }) {
    this.editor = editor;
    this.world = world;
    this.engine = engine;
    this.catalog = catalog;
    this.send = send;
    this.chat = chat;
    this.blockMat = { top: 0, side: 0 };
    this.blockSurface = 'normal';
    this.blockColor = '#ffffff';
    this.objCat = 'popular';
    this.swatches = [];
    this.buildBlocks();
    this.buildObjects();
    this.buildStructures();
    this.buildTerrain();
    world.on(() => this.renderLevelSettings());
    this.wire();
  }

  swatch(i, side = false) {
    const key = `${i}:${side ? 1 : 0}`;
    if (!this.swatches[key]) this.swatches[key] = this.engine.materialSwatch(i, side);
    return this.swatches[key];
  }

  // ---- library: blocks ------------------------------------------------------

  buildBlocks() {
    const pane = $('#lib-blocks');
    pane.innerHTML = '';
    pane.appendChild(el('div', 'lib-label', 'Shapes'));
    const grid = el('div', 'preset-grid');
    for (const p of PRESETS) {
      const b = el('button', 'preset', `<svg viewBox="0 0 24 24">${SHAPE_ICONS[p.id]}</svg><span>${esc(p.label)}</span>`);
      b.title = `${p.label}: ${p.block.sx}×${p.block.sy}×${p.block.sz}`;
      b.onclick = () => {
        const block = { ...p.block, top: this.blockMat.top, side: this.blockMat.side, surface: this.blockSurface, color: this.blockColor };
        this.editor.startPlacing({ block, wall: p.wall });
        grid.querySelectorAll('.preset').forEach((x) => x.classList.toggle('active', x === b));
      };
      grid.appendChild(b);
    }
    pane.appendChild(grid);

    pane.appendChild(el('div', 'lib-label', 'Material <span class="lib-sub">for new blocks</span>'));
    const mats = el('div', 'mat-grid');
    MATERIALS.forEach((name, i) => {
      const m = el('button', 'mat');
      m.title = name;
      m.dataset.i = i;
      m.innerHTML = `<img alt="" src="${this.swatch(i)}">`;
      m.onclick = () => {
        this.blockMat = { top: i, side: i };
        mats.querySelectorAll('.mat').forEach((x) => x.classList.toggle('active', x === m));
        $('#mat-name').textContent = name;
        this.refreshPlacingBlock();
      };
      if (i === 0) m.classList.add('active');
      mats.appendChild(m);
    });
    pane.appendChild(mats);
    pane.appendChild(el('div', 'mat-name', '<span id="mat-name">grass</span>'));

    const row = el('div', 'lib-row');
    row.innerHTML = `<label>Surface<select id="lib-surface">${Object.entries(SURFACE_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="color-pick">Tint<input type="color" id="lib-color" value="#ffffff"></label>`;
    pane.appendChild(row);
    row.querySelector('#lib-surface').onchange = (e) => { this.blockSurface = e.target.value; this.refreshPlacingBlock(); };
    row.querySelector('#lib-color').oninput = (e) => { this.blockColor = e.target.value; this.refreshPlacingBlock(); };

    pane.appendChild(el('div', 'lib-tip', 'Pick a shape, then click in the level. Clicking a wall attaches the block to it. <kbd>R</kbd> or Shift+wheel turns it, right-click stops placing.'));
  }

  refreshPlacingBlock() {
    const pl = this.editor.placing;
    if (pl?.block) {
      const item = { ...pl, block: { ...pl.block, top: this.blockMat.top, side: this.blockMat.side, surface: this.blockSurface, color: this.blockColor } };
      this.editor.startPlacing({ block: item.block, wall: pl.wall });
    }
  }

  // ---- library: objects -----------------------------------------------------

  buildObjects() {
    const cats = $('#obj-cats');
    cats.innerHTML = '';
    // the Shoggoth World extras (vehicles, Shotgun Mario, Tokyo) exist only when the engine build found
    // a Shoggoth World checkout: no entries, no chip (Sunshine keeps its chip: it shows how to add the disc)
    const has = (cat) => this.catalog.entries.some((e) => categoryOf(e) === cat);
    for (const [id, label] of CATS) {
      if ((id === 'vehicles' || id === 'shoggoth') && !has(id)) continue;
      const c = el('button', `chip${id === this.objCat ? ' active' : ''}`, esc(label));
      c.onclick = () => { this.objCat = id; cats.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c)); this.renderObjects(); };
      cats.appendChild(c);
    }
    this.entries = this.catalog.entries.map((e) => ({ ...e, cat: categoryOf(e) }));
    this.thumbs = objectPictureIds();
    $('#obj-search').addEventListener('input', () => this.renderObjects());
    this.renderObjects();
    // only the pictures that exist: on a fresh install the setup is still making them (pictures.js)
    const again = () => { this.thumbs = objectPictureIds(); this.renderObjects(); };
    loadPictures().then(again);
    window.addEventListener('studio:pictures', again);
  }

  renderObjects() {
    const q = $('#obj-search').value.trim().toLowerCase();
    let list = this.entries;
    if (q) {
      const words = q.split(/\s+/);
      list = list.filter((e) => words.every((w) => (e.name + ' ' + e.id + ' ' + e.behavior).toLowerCase().includes(w)));
    } else if (this.objCat === 'popular') {
      list = POPULAR.map((id) => this.entries.find((e) => e.id === id)).filter(Boolean);
    } else if (this.objCat !== 'all') {
      list = list.filter((e) => e.cat === this.objCat);
    }
    const grid = $('#obj-grid');
    grid.innerHTML = '';
    for (const e of list.slice(0, 300)) {
      const b = el('button', 'obj');
      const letter = e.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
      const pic = objectPicture(e.id);
      const img = pic ? `<img alt="" loading="lazy" src="${pic}">` : `<i>${esc(letter)}</i>`;
      b.innerHTML = `<span class="thumb cat-${e.cat}">${img}</span><span class="obj-name">${esc(e.name)}</span>`;
      b.title = `${e.name}\n${e.behavior}`;
      b.onclick = () => {
        this.editor.startPlacing({ entry: e.id });
        grid.querySelectorAll('.obj').forEach((x) => x.classList.toggle('active', x === b));
      };
      grid.appendChild(b);
    }
    if (!list.length && !q && this.objCat === 'sunshine') {
      // no disc converted: the setup adds them (setup.html?add=sunshine)
      grid.appendChild(el('div', 'lib-tip sms-unlock', '<span class="shine-dot"></span><b>Add your Super Mario Sunshine disc to unlock Piantas, Nokis, Strollin\' Stus and more.</b>'
        + ' They are converted from your own GameCube disc image (.iso), once. <a class="btn sm" href="/setup.html?add=sunshine">Add the Sunshine characters</a>'));
      return;
    }
    if (!list.length) grid.appendChild(el('div', 'lib-tip', 'Nothing found.'));
  }

  // ---- library: structures --------------------------------------------------

  buildStructures() {
    const pane = $('#lib-structures');
    pane.innerHTML = '';
    const cards = el('div', 'gen-grid');
    for (const [kind, g] of Object.entries(GENERATORS)) {
      const b = el('button', 'gen', `<svg viewBox="0 0 24 24">${GEN_ICONS[kind]}</svg><span>${esc(g.label)}</span>`);
      b.dataset.kind = kind;
      b.onclick = () => this.editor.startGenerator(kind);
      cards.appendChild(b);
    }
    pane.appendChild(cards);
    pane.appendChild(el('div', 'gen-panel', ''));
    this.renderGenerator();
  }

  renderGenerator() {
    const panel = $('#lib-structures .gen-panel');
    const g = this.editor.gen;
    document.querySelectorAll('.gen').forEach((x) => x.classList.toggle('active', !!g && x.dataset.kind === g.kind));
    if (!g) {
      panel.innerHTML = '<div class="lib-tip">Pick a structure, click in the level to put it there, tune it, then press <b>Build</b>.<span data-ai> Claude can build these too: "build a spiral staircase up to that ledge".</span></div>';
      return;
    }
    const def = GENERATORS[g.kind];
    const help = esc(g.awaiting === 'anchor2' ? 'Now click where it ends.' : GEN_HELP[g.kind]);
    if (panel._gen === g && panel.querySelector('.gen-form')) {
      // same structure: only refresh the hint and the Build button (rebuilding the form would
      // throw away the field the user is typing in)
      panel.querySelector('.gen-help').innerHTML = help;
      const btn = panel.querySelector('.gen-actions .btn.primary');
      btn.textContent = `Build${g.count ? ` · ${g.count} blocks` : ''}`;
      btn.disabled = !g.anchor || (g.kind === 'bridge' && !g.anchor2);
      return;
    }
    panel._gen = g;
    panel.innerHTML = `<div class="gen-title">${esc(def.label)}</div><div class="gen-help">${help}</div>`;
    const form = el('div', 'gen-form');
    for (const [k, v] of Object.entries(g.params)) {
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      const row = el('label', 'gen-row');
      if (k === 'material') {
        row.innerHTML = `<span>${label}</span><select>${MATERIALS.map((m) => `<option ${m === v ? 'selected' : ''}>${m}</option>`).join('')}</select>`;
        row.querySelector('select').onchange = (e) => this.editor.setGenParam(k, e.target.value);
      } else if (typeof v === 'boolean') {
        row.innerHTML = `<span>${label}</span><input type="checkbox" ${v ? 'checked' : ''}>`;
        row.querySelector('input').onchange = (e) => this.editor.setGenParam(k, e.target.checked);
      } else {
        const [lo, hi] = GEN_LIMITS[k] || [-20000, 20000];
        row.innerHTML = `<span>${label}</span><input type="number" value="${v}" min="${lo}" max="${hi}" step="${v < 50 ? 1 : 10}">`;
        // an empty or half-typed field is not a value yet (Number('') is 0); values are kept in a
        // range that still builds something sane (a 120 floor tower fills the object pool)
        const clamp = (n) => Math.max(lo, Math.min(hi, n));
        row.querySelector('input').oninput = (e) => { const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n)) this.editor.setGenParam(k, clamp(n)); };
        row.querySelector('input').onchange = (e) => { const n = Number(e.target.value); e.target.value = String(Number.isFinite(n) && e.target.value.trim() !== '' ? clamp(n) : this.editor.gen?.params[k] ?? v); };
        row.querySelector('input').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.editor.applyGenerator(); } };
      }
      form.appendChild(row);
    }
    panel.appendChild(form);
    const actions = el('div', 'gen-actions');
    const build = el('button', 'btn primary', `Build${g.count ? ` · ${g.count} blocks` : ''}`);
    build.disabled = !g.anchor || (g.kind === 'bridge' && !g.anchor2);
    build.onclick = () => this.editor.applyGenerator();
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => this.editor.cancelGenerator();
    actions.append(cancel, build);
    panel.appendChild(actions);
  }

  // ---- library: terrain -------------------------------------------------------

  buildTerrain() {
    const pane = $('#lib-terrain');
    pane.innerHTML = '';
    const ed = this.editor;
    const icons = {
      raise: '<path d="M12 4 4 14h5v6h6v-6h5z"/>', lower: '<path d="M12 20 4 10h5V4h6v6h5z"/>',
      smooth: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/>', flatten: '<path d="M3 12h18M7 8h10M7 16h10"/>',
      paint: '<path d="M18 3l3 3-9 9-4 1 1-4z"/><path d="M5 19c0-2 1-3 3-3"/>',
    };
    pane.appendChild(el('div', 'lib-label', 'Sculpt &amp; paint'));
    const tools = el('div', 'preset-grid five');
    for (const m of ['raise', 'lower', 'smooth', 'flatten', 'paint']) {
      const b = el('button', 'preset brush-tool', `<svg viewBox="0 0 24 24">${icons[m]}</svg><span>${m[0].toUpperCase() + m.slice(1)}</span>`);
      b.dataset.mode = m;
      b.onclick = () => { ed.startSculpt(m); this.renderBrush(); };
      tools.appendChild(b);
    }
    pane.appendChild(tools);
    const sliders = el('div', 'brush-sliders');
    sliders.innerHTML = `<label><span>Size</span><input type="range" min="60" max="4000" step="10" id="brush-radius"><b id="brush-radius-v"></b></label>
      <label><span>Strength</span><input type="range" min="2" max="100" step="1" id="brush-strength"><b id="brush-strength-v"></b></label>`;
    pane.appendChild(sliders);
    sliders.querySelector('#brush-radius').oninput = (e) => { ed.brush.radius = Number(e.target.value); this.renderBrush(); };
    sliders.querySelector('#brush-strength').oninput = (e) => { ed.brush.strength = Number(e.target.value); this.renderBrush(); };
    const paint = el('div', 'brush-paint');
    paint.innerHTML = '<div class="lib-label">Paint material</div>';
    const mats = el('div', 'mat-grid');
    MATERIALS.forEach((name, i) => {
      const m = el('button', 'mat', `<img alt="" src="${this.swatch(i)}">`);
      m.title = name;
      m.dataset.i = i;
      m.onclick = () => { ed.brush.material = i; ed.brush.materialName = name; ed.startSculpt('paint'); this.renderBrush(); };
      mats.appendChild(m);
    });
    paint.appendChild(mats);
    pane.appendChild(paint);
    pane.appendChild(el('div', 'lib-tip', 'Hold the left mouse button to sculpt. <kbd>Shift</kbd> lowers, <kbd>Ctrl</kbd> smooths, <kbd>[</kbd> <kbd>]</kbd> or <kbd>Alt</kbd>+wheel change the size. In original levels the brush reshapes the level\'s real ground.'));
    pane.appendChild(el('div', 'terrain-actions', ''));
    pane.appendChild(el('div', 'level-settings', ''));
    this.renderBrush();
    this.renderLevelSettings();
  }

  renderBrush() {
    const ed = this.editor;
    $('#brush-radius').value = ed.brush.radius;
    $('#brush-radius-v').textContent = ed.brush.radius;
    $('#brush-strength').value = ed.brush.strength;
    $('#brush-strength-v').textContent = ed.brush.strength;
    document.querySelectorAll('.brush-tool').forEach((b) => b.classList.toggle('active', ed.tool === 'sculpt' && b.dataset.mode === ed.brush.mode));
    document.querySelectorAll('.brush-paint .mat').forEach((m) => m.classList.toggle('active', Number(m.dataset.i) === ed.brush.material));
    $('.brush-paint').hidden = ed.brush.mode !== 'paint';
  }

  renderLevelSettings() {
    const w = this.world;
    const custom = w.isCustom();
    const s = w.settings();
    const acts = $('#lib-terrain .terrain-actions');
    const box = $('#lib-terrain .level-settings');
    if (!acts || !box) return;
    acts.innerHTML = '';
    if (custom) {
      acts.appendChild(el('div', 'lib-label', 'Whole terrain'));
      const row = el('div', 'btn-row');
      const mk = (label, fn, title) => { const b = el('button', 'btn sm', esc(label)); if (title) b.title = title; b.onclick = fn; row.appendChild(b); };
      mk('Auto paint', () => w.runOps([{ op: 'paint_auto', water: s.water?.on ? s.water.height : undefined }], 'Auto-painted the terrain'), 'Grass on flat ground, rock on slopes, sand by the water');
      mk('Smooth all', () => w.runOps([{ op: 'smooth', passes: 2 }], 'Smoothed the terrain'));
      mk('Roughen', () => w.runOps([{ op: 'noise', amount: 140, scale: 900, seed: (Math.random() * 1e5) | 0 }], 'Roughened the terrain'));
      mk('Heightmap image…', () => this.importHeightmap(), 'Bright = high, dark = low');
      acts.appendChild(row);
    }
    box.innerHTML = '<div class="lib-label">Level</div>';
    const form = el('div', 'gen-form');
    const skyRow = el('label', 'gen-row');
    skyRow.innerHTML = `<span>Sky</span><select ${custom ? '' : 'disabled title="Custom levels only"'}>${SKIES.map((k) => `<option value="${k.id}" ${(s.sky ?? 0) === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>`;
    skyRow.querySelector('select').onchange = (e) => w.setSettings({ sky: Number(e.target.value) }, 'Changed the sky');
    const musRow = el('label', 'gen-row');
    // the game's songs, the project's own songs, and the way to the sound studio
    const songs = w.getSongs?.() || [];
    const sel = (v) => (v ? 'selected' : '');
    musRow.innerHTML = `<span>Music</span><select><option value="">${custom ? 'Bob-omb Battlefield' : 'Original'}</option>
      ${s.m64Song ? `<option value="m64" ${sel(!s.song)}>${esc(s.m64Song.name || 'Level song')}</option>` : ''}
      ${songs.length ? `<optgroup label="Your songs">${songs.map((x) => `<option value="song:${x.id}" ${sel(s.song === x.id)}>${esc(x.name)}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="Game music">${GAME_SONGS.map((k) => `<option value="${k.seq}" ${sel(!s.song && !s.m64Song && s.music === k.seq)}>${esc(k.name)}</option>`).join('')}</optgroup>
      <option value="compose">Compose a song…</option></select>`;
    musRow.querySelector('select').onchange = (e) => {
      const v = e.target.value;
      if (v === 'compose') { e.target.value = s.song ? `song:${s.song}` : s.music ?? ''; w.openSoundStudio?.('music'); return; }
      if (v === 'm64') w.setSettings({ song: null }, 'Changed the music');
      else if (v.startsWith('song:')) w.setSettings({ song: v.slice(5), musicOverride: true }, 'Changed the music');
      // (a game sequence the level came with, like Tokyo's, gives way to the choice)
      else w.setSettings(v === '' ? { music: null, musicOverride: false, song: null, m64Song: null } : { music: Number(v), musicOverride: true, song: null, m64Song: null }, 'Changed the music');
    };
    form.append(skyRow, musRow);
    box.appendChild(form);
    if (custom) {
      const water = el('div', 'water-row');
      water.innerHTML = `<label class="check"><input type="checkbox" ${s.water?.on ? 'checked' : ''}> Water</label>
        <input type="range" min="-1500" max="2500" step="25" value="${s.water?.height ?? 0}" ${s.water?.on ? '' : 'disabled'}><b>${s.water?.height ?? 0}</b>`;
      const [cb, range] = water.querySelectorAll('input');
      cb.onchange = () => w.setSettings({ water: { on: cb.checked, height: Number(range.value) } }, cb.checked ? 'Added water' : 'Removed water');
      range.oninput = () => { water.querySelector('b').textContent = range.value; this.engine.setWater(true, Number(range.value)); w.placeWater({ on: true, height: Number(range.value) }); };
      range.onchange = () => w.setSettings({ water: { on: true, height: Number(range.value) } }, 'Changed the water level');
      box.appendChild(water);
    }
    const spawn = el('div', 'btn-row');
    const here = el('button', 'btn sm', 'Start here (view center)');
    here.title = 'Mario starts the level at the point in the middle of the view';
    here.onclick = () => {
      const p = this.editor.active ? this.editor.viewCenter() : null;
      const m = this.engine.state().mario;
      const at = p || [m.x, m.y, m.z];
      w.setSettings({ spawn: { x: Math.round(at[0]), y: Math.round(at[1] + 100), z: Math.round(at[2]), yaw: m ? m.yaw & 0xffff : 0 } }, 'Moved the start');
      this.editor.toast?.('Mario will start here', 'check');
    };
    const atMario = el('button', 'btn sm', 'Start at Mario');
    atMario.onclick = () => {
      const m = this.engine.state().mario;
      if (m) w.setSettings({ spawn: { x: m.x, y: m.y + 100, z: m.z, yaw: m.yaw & 0xffff } }, 'Moved the start');
    };
    spawn.append(here, atMario);
    box.appendChild(spawn);
  }

  importHeightmap() {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const t = await terrainFromImage(f, { min: -300, max: 2600 });
      this.world.terrain = t;
      const v = this.engine.terrainCreate(1, t.nx, t.nz, t.cell, t.x0, t.z0);
      v.heights.set(t.h);
      v.mats.set(t.m);
      this.engine.terrainBuild(1, 0, 0, -1, -1, true);
      this.world.commitArea('terrain', t.encode(), 'Terrain from an image');
      this.editor.toast?.('Terrain made from the image', 'check');
    };
    inp.click();
  }

  // ---- inspector ------------------------------------------------------------

  // The inspector replaces the library while something is selected.
  showLibrary(show) {
    document.querySelectorAll('.lib-tab').forEach((t) => t.classList.toggle('dim', !show));
    const active = document.querySelector('.lib-tab.active')?.dataset.lib || 'blocks';
    document.querySelectorAll('#library > .lib-pane').forEach((p) => { p.hidden = !show || p.id !== `lib-${active}`; }); // any feature's tab
  }

  renderInspector(sel) {
    const box = $('#inspector');
    if (!sel || !this.editor.active) {
      if (!box.hidden) { box.hidden = true; this.showLibrary(true); }
      return;
    }
    box.hidden = false;
    this.showLibrary(false);
    const pose = this.editor.selPose();
    const rec = sel.rec;
    const block = pose.block;
    const badge = { block: 'Block', added: 'Added', original: 'Original' }[sel.kind];
    const num = (v) => Math.round(v);
    let html = `<button class="insp-back" data-act="close" title="Deselect (Esc)"><svg class="i sm" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Library</button>
      <div class="insp-head"><div class="insp-title">${esc(sel.name)}</div><span class="insp-badge ${sel.kind}">${badge}</span></div>`;
    const worldRec = !!this.worldInspector?.wants(rec); // warps, zones, paintings, keys (world_ui.js)
    box.classList.toggle('zone-rec', !!rec?.zone);
    if (worldRec) html += this.worldInspector.html(sel, rec);
    html += `<div class="insp-sec"><div class="insp-label">Position</div><div class="xyz">
      <label><i class="ax x">X</i><input type="number" data-f="x" value="${num(pose.p[0])}" step="10"></label>
      <label><i class="ax y">Y</i><input type="number" data-f="y" value="${num(pose.p[1])}" step="10"></label>
      <label><i class="ax z">Z</i><input type="number" data-f="z" value="${num(pose.p[2])}" step="10"></label></div></div>`;
    html += `<div class="insp-sec"><div class="insp-label">Rotation</div><div class="rot-row">
      <input type="range" min="0" max="359" step="1" data-f="yawr" value="${yawToDeg(pose.yaw)}">
      <input type="number" data-f="yaw" value="${yawToDeg(pose.yaw)}" step="15" class="w64"><span class="unit">°</span></div>
      ${block || rec?.asset ? `<div class="xyz two"><label><i class="ax">Tilt</i><input type="number" data-f="pitch" value="${yawToDeg(pose.pitch)}" step="5"></label>
      <label><i class="ax">Roll</i><input type="number" data-f="roll" value="${yawToDeg(pose.roll)}" step="5"></label></div>` : ''}</div>`;
    if (block) {
      html += `<div class="insp-sec"><div class="insp-label">Shape</div><div class="seg wide">${SHAPE_NAMES.map((n, i) => `<button class="seg-btn${block.shape === i ? ' active' : ''}" data-shape="${i}">${n}</button>`).join('')}</div>
        <div class="xyz"><label><i class="ax">W</i><input type="number" data-b="sx" value="${block.sx}" step="25"></label>
        <label><i class="ax">H</i><input type="number" data-b="sy" value="${block.sy}" step="25"></label>
        <label><i class="ax">D</i><input type="number" data-b="sz" value="${block.sz}" step="25"></label></div>
        ${block.shape === 2 ? `<div class="xyz two"><label><i class="ax">Steps</i><input type="number" data-b="steps" value="${block.steps}" min="1" max="24"></label></div>` : ''}</div>`;
      html += `<div class="insp-sec"><div class="insp-label">Material</div><div class="mat-pair">
        <button class="mat big" data-matpick="top" title="Top"><img alt="" src="${this.swatch(block.top)}"><span>Top</span></button>
        <button class="mat big" data-matpick="side" title="Sides"><img alt="" src="${this.swatch(block.side, true)}"><span>Sides</span></button>
        <label class="color-pick">Tint<input type="color" data-b="color" value="#${(block.color ?? 0xffffff).toString(16).padStart(6, '0')}"></label></div>
        <div class="mat-pop" hidden></div></div>`;
      const surfKey = Object.entries(SURFACES).find(([, v]) => v === block.surface)?.[0] || 'normal';
      html += `<div class="insp-sec"><div class="insp-label">Collision</div>
        <select data-b="surface">${Object.entries(SURFACE_LABELS).map(([k, v]) => `<option value="${k}" ${k === surfKey ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <div class="checks"><label><input type="checkbox" data-flag="1" ${block.flags & 1 ? 'checked' : ''}> Invisible</label>
        <label><input type="checkbox" data-flag="2" ${block.flags & 2 ? 'checked' : ''}> No collision</label></div></div>`;
    } else {
      const ui = PARAM_UI[sel.entry];
      const bp = (rec ? rec.bparams : sel.obj.bparams) >>> 0;
      html += `<div class="insp-sec"><div class="insp-label">Size</div><div class="rot-row">
        <input type="range" min="0.1" max="5" step="0.05" data-f="scaler" value="${pose.scale}">
        <input type="number" data-f="scale" value="${pose.scale}" step="0.1" class="w64"><span class="unit">×</span></div></div>`;
      for (const u of [].concat(ui || [])) {  // one control per entry, or a list of them
        const cur = (bp >>> ((3 - u.byte) * 8)) & 0xff;
        html += `<div class="insp-sec"><div class="insp-label">${esc(u.label)}</div><select data-param="${u.byte}">${u.options.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      }
      if (!rec?.asset) html += `<div class="insp-sec"><div class="insp-label">Behavior params</div><input type="text" class="mono" data-f="bparams" value="0x${bp.toString(16).padStart(8, '0').toUpperCase()}" spellcheck="false"></div>`;
    }
    if (rec?.asset && this.assetInspector) html += this.assetInspector.html(sel, rec); // imported models (assets_ui.js)
    html += `<div class="insp-actions">
      <button class="btn sm" data-act="dup" title="Ctrl+D">Duplicate</button>
      <button class="btn sm" data-act="ground" title="G">Drop</button>
      <button class="btn sm" data-act="mario" title="Put Mario here">Mario here</button>
      <button class="btn sm danger" data-act="del" title="Delete">Delete</button></div>
      <button class="ask-claude" data-act="ask" data-ai>Ask Claude about this…</button>`;
    box.innerHTML = html;
    this.wireInspector(box, sel, pose);
    if (rec?.asset && this.assetInspector) this.assetInspector.wire(box, sel, rec);
    if (worldRec) this.worldInspector.wire(box, sel, rec);
  }

  wireInspector(box, sel, pose) {
    const ed = this.editor;
    const commitPose = (summary) => { ed.applyPose(pose); ed.commitPose(pose, summary); };
    box.querySelectorAll('input[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      let committed = inp.value; // what the project has for this field
      const apply = (final) => {
        const v = Number(inp.value);
        if (f === 'bparams') {
          if (!final) return;
          const n = parseInt(inp.value, inp.value.startsWith('0x') ? 16 : 10);
          if (Number.isFinite(n)) ed.updateSelected({ bparams: n >>> 0 }, `Changed ${sel.name} params`);
          else this.renderInspector(ed.sel); // not a number: show the params it has
          return;
        }
        // an empty or half-typed field is not a value (Number('') is 0: it would teleport the
        // object to 0 or shrink it): wait, and put the current value back when the edit ends
        if (inp.value.trim() === '' || !Number.isFinite(v)) {
          if (final && committed.trim() !== '' && inp.value !== committed) { inp.value = committed; apply(false); } // undo the live preview
          return;
        }
        if (f === 'x' || f === 'y' || f === 'z') pose.p['xyz'.indexOf(f)] = v;
        else if (f === 'yaw' || f === 'yawr') pose.yaw = degToYaw(v);
        else if (f === 'pitch') pose.pitch = degToYaw(v);
        else if (f === 'roll') pose.roll = degToYaw(v);
        else if (f === 'scale' || f === 'scaler') pose.scale = Math.max(0.05, Math.min(20, v));
        if (final) { committed = inp.value; commitPose(f.startsWith('yaw') ? 'Rotated' : f.startsWith('scale') ? 'Scaled' : 'Moved'); }
        else ed.applyPose(pose);
        if (f === 'yawr') box.querySelector('[data-f=yaw]').value = v;
        if (f === 'scaler') box.querySelector('[data-f=scale]').value = v;
      };
      inp.addEventListener('input', () => apply(false));
      inp.addEventListener('change', () => apply(true));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
    });
    box.querySelectorAll('[data-shape]').forEach((b) => {
      b.onclick = () => ed.updateSelected({ block: { shape: Number(b.dataset.shape) } }, `Changed ${sel.name} shape`);
    });
    box.querySelectorAll('[data-b]').forEach((inp) => {
      const k = inp.dataset.b;
      inp.addEventListener('change', () => {
        let v = inp.value;
        if (k === 'color') v = parseInt(v.slice(1), 16);
        else if (k === 'surface') v = SURFACES[v] ?? 0;
        else if (v.trim() === '' || !Number.isFinite(Number(v))) { this.renderInspector(ed.sel); return; } // empty / half-typed: keep the size
        else v = Math.round(Math.max(k === 'steps' ? 1 : 10, Math.min(k === 'steps' ? 24 : 8000, Number(v))));
        ed.updateSelected({ block: { [k]: v } }, `Changed ${sel.name}`);
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
    });
    box.querySelectorAll('[data-flag]').forEach((cb) => {
      cb.onchange = () => {
        const bit = Number(cb.dataset.flag);
        const flags = (pose.block.flags & ~bit) | (cb.checked ? bit : 0);
        ed.updateSelected({ block: { flags } }, `Changed ${sel.name}`);
      };
    });
    box.querySelectorAll('[data-matpick]').forEach((b) => {
      b.onclick = () => {
        const which = b.dataset.matpick;
        const pop = box.querySelector('.mat-pop');
        pop.hidden = !pop.hidden || pop.dataset.which !== which ? false : true;
        pop.dataset.which = which;
        pop.innerHTML = '';
        MATERIALS.forEach((name, i) => {
          const m = el('button', 'mat', `<img alt="" src="${this.swatch(i, which === 'side')}">`);
          m.title = name;
          m.onclick = () => ed.updateSelected({ block: which === 'top' ? { top: i } : { side: i } }, `Changed ${sel.name} material`);
          pop.appendChild(m);
        });
      };
    });
    box.querySelectorAll('[data-param]').forEach((param) => {
      param.onchange = () => {
        const byte = Number(param.dataset.param);
        const shift = (3 - byte) * 8;
        const bp = ((sel.rec ? sel.rec.bparams : sel.obj.bparams) >>> 0);
        const next = ((bp & ~(0xff << shift)) | (Number(param.value) << shift)) >>> 0;
        ed.updateSelected({ bparams: next }, `Changed ${sel.name}`);
      };
    });
    box.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.act;
        if (act === 'close') ed.select(null);
        else if (act === 'dup') ed.duplicateSelected();
        else if (act === 'ground') ed.dropSelectedToGround();
        else if (act === 'del') ed.deleteSelected();
        else if (act === 'mario') {
          const top = pose.block ? pose.p[1] + pose.block.sy : pose.p[1];
          this.engine.teleport(pose.p[0], top + 200, pose.p[2], 0);
        } else if (act === 'ask') this.chat(`The selected ${sel.name}: `);
      };
    });
  }

  // ---- toolbar / hints --------------------------------------------------------

  wire() {
    document.querySelectorAll('.lib-tab').forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll('.lib-tab').forEach((x) => x.classList.toggle('active', x === t));
        if (this.editor.sel) this.editor.select(null); // back from the inspector
        document.querySelectorAll('#library > .lib-pane').forEach((p) => { p.hidden = p.id !== `lib-${t.dataset.lib}`; });
      };
    });
    document.querySelectorAll('[data-gizmo]').forEach((b) => { b.onclick = () => this.editor.setGizmo(b.dataset.gizmo); });
    $('#snap-select').onchange = (e) => { this.editor.snap = Number(e.target.value); e.target.blur(); }; // the keys go back to the editor
    $('#build-undo').onclick = () => (window.studio64Undo ? window.studio64Undo.undoHere() : this.send({ type: 'undo' }));
    $('#build-redo').onclick = () => this.send({ type: 'redo' });
    $('#build-help').onclick = () => { $('#help-card').hidden = !$('#help-card').hidden; };
  }

  onToolChange() {
    const ed = this.editor;
    document.querySelectorAll('[data-gizmo]').forEach((b) => b.classList.toggle('active', b.dataset.gizmo === ed.gizmo));
    if (ed.tool !== 'place') document.querySelectorAll('.preset.active, .obj.active').forEach((x) => x.classList.remove('active'));
    this.renderGenerator();
    const hint = $('#tool-hint');
    let text = '';
    if (ed.tool === 'place' && ed.placing?.redCoinsLeft) text = `Place red coin ${9 - ed.placing.redCoinsLeft} of 8 · right-click or <kbd>Esc</kbd> to stop`;
    else if (ed.tool === 'place' && ed.placing?.star) text = `Click where the star “${esc(ed.placing.star.name)}” goes · <kbd>Esc</kbd> to stop`;
    else if (ed.tool === 'place') text = 'Click to place · <kbd>R</kbd> turn · right-click or <kbd>Esc</kbd> to stop';
    else if (ed.tool === 'sculpt') text = `${ed.brush.mode[0].toUpperCase() + ed.brush.mode.slice(1)} · hold left mouse · <kbd>Shift</kbd> inverts · <kbd>[</kbd><kbd>]</kbd> size ${ed.brush.radius} · <kbd>Esc</kbd> stop`;
    else if (ed.tool === 'generator') text = ed.gen?.anchor ? '<kbd>R</kbd> turn · <kbd>Enter</kbd> build · <kbd>Esc</kbd> cancel' : esc(GEN_HELP[ed.gen?.kind] || '');
    else if (!ed.sel) text = 'Click to select · right-drag orbits · Shift pans · wheel zooms · <kbd>F</kbd> frames';
    hint.innerHTML = text;
    hint.hidden = !ed.active || !text;
    if (this.renderBrush && $('#brush-radius')) this.renderBrush();
    if (ed.tool === 'generator') {
      document.querySelectorAll('.lib-tab').forEach((x) => x.classList.toggle('active', x.dataset.lib === 'structures'));
      document.querySelectorAll('#library > .lib-pane').forEach((p) => { p.hidden = p.id !== 'lib-structures'; });
    }
  }
}
