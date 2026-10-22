// Engine bridge: loads the SM64 WebAssembly build and wraps its studio_* API.
//
// The patch (what the chat added or removed) is kept here as well as on the
// server, because the engine asks for it synchronously while an area loads.

const SHOT_MAX_W = 960;

// The game's fonts only know plain letters.
const _plain = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ').slice(0, 60);

export class Engine {
  constructor(canvas, catalog) {
    this.canvas = canvas;
    this.catalog = catalog;
    this.bhvIndex = new Map(catalog.behaviors.map((b, i) => [b, i]));
    this.entryIndex = new Map(catalog.entries.map((e) => [e.id, e.index]));
    this.patch = { areas: {} };
    this.level = 0;
    this.area = 0;
    this.ready = false;
    this.crashed = false;
    this.listeners = { area: [], crash: [], ready: [], frame: [], star: [], intro: [] };
    this.studioLevel = catalog.studioLevel || 37;
    this.customLevel = null; // id of the custom level shown in the studio level slot
    this.inIntro = false;    // the star select screen is up
    this.introInfo = null;   // level => { title, stars: [{ name, done }], score } for that screen
    this.pauseLevels = null; // () => [{ name, stars: "1010", coins, coinStar }] for the castle pause menu
    this.starInfo = null;    // (uid, index) => { title, name } of a star just collected
    this.onGameSound = null; // (id, distance): the game played a sound the project replaced
    this.levelHooks = [];    // (level, area, key) => void, run while an area loads
    this.spawnFilters = [];  // (record) => slot | undefined: a module spawns special records itself (worldflow.js)
    this.afterAreaHooks = []; // (level, area, key) => void, run while an area loads, after its records spawned (assets.js)
    this.shotWaiters = [];
    this.lastFrame = 0;
    this.saveKey = null;       // localStorage key of the game's save (set before boot, savegame.js)
    this.onSaveWritten = null; // the game wrote its save
  }

  on(event, fn) { this.listeners[event].push(fn); }
  off(event, fn) { this.listeners[event] = this.listeners[event].filter((f) => f !== fn); }
  emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }

  boot({ level = 9, act = 1, base = 'engine/', keysBlocked = () => false } = {}) {
    return new Promise((resolve, reject) => {
      const self = this;
      const M = (window.Module = {
        canvas: this.canvas,
        locateFile: (p) => base + p,
        print: (t) => console.log('[sm64]', t),
        printErr: (t) => console.warn('[sm64]', t),
        preRun: [() => {
          // keep SDL from swallowing keys meant for the chat box
          M.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = '#' + self.canvas.id;
          M.ENV.ASAN_OPTIONS = 'halt_on_error=0:detect_leaks=0'; // only read by sanitizer debug builds
        }],
        onRuntimeInitialized() {
          M._studio_set_boot_level(level, act);
        },
        onAbort(what) {
          self.crashed = true;
          self.emit('crash', String(what));
        },
        studioAreaLoad: (lvl, area) => this._areaLoad(lvl, area),
        studioStarCollected: (uid, index, lvl) => setTimeout(() => this.emit('star', { uid, index, level: lvl, key: this.areaKey() }), 0),
        studioAfterFrame: () => this._afterFrame(),
        studioIntro: (on, lvl) => { this.inIntro = !!on; setTimeout(() => this.emit('intro', !!on, lvl), 0); },
        studioIntroStars: (lvl) => this._introStars(lvl),
        studioPauseLevels: () => this._pauseLevels(),
        studioStarInfo: (uid, index) => this._starInfo(uid, index),
        studioSfx: (id, dist) => this.onGameSound?.(id, dist),
        studioKeysBlocked: keysBlocked,
        // the game's save (EEPROM) per project (savegame.js); null: the game's one shared save
        studioSaveKey: this.saveKey || null,
        studioSaveWritten: () => { try { this.onSaveWritten?.(); } catch (err) { console.error('save hook', err); } },
      });
      window.addEventListener('error', (e) => {
        if (!this.crashed && /RuntimeError|unreachable|memory access/i.test(String(e.message))) {
          this.crashed = true;
          this.emit('crash', String(e.message));
        }
      });
      const s = document.createElement('script');
      s.src = base + 'sm64.us.f3dex2e.js';
      s.onerror = () => reject(new Error('could not load the engine'));
      document.body.appendChild(s);
      // ready once the boot level is loaded and Mario is in it
      this.on('area', (lvl) => {
        if (this.ready || lvl !== level || this._waiting) return;
        this._waiting = true;
        const t0 = performance.now();
        const poll = () => {
          let hasMario = false;
          try { hasMario = !!this.state().mario; } catch { /* still loading */ }
          if (hasMario || performance.now() - t0 > 15000) {
            this.ready = true;
            this.emit('ready');
            resolve();
          } else setTimeout(poll, 100);
        };
        poll();
      });
    });
  }

  get M() { return window.Module; }

  json(fn, ...args) {
    const ptr = this.M['_' + fn](...args);
    return JSON.parse(this.M.UTF8ToString(ptr));
  }

  // ---- engine callbacks -------------------------------------------------

  _areaLoad(level, area) {
    this.level = level;
    this.area = area;
    // a warp chose the custom level the slot shows next (worldflow.js); it applies on arrival
    if (this.pendingCustom) {
      if (level === this.studioLevel) this.customLevel = this.pendingCustom;
      this.pendingCustom = null;
    }
    try {
      this._applyArea(level, area);
    } catch (err) {
      console.error('patch apply failed', err);
    }
    for (const fn of this.afterAreaHooks) {
      try { fn(level, area, this.areaKey(level, area)); } catch (err) { console.error('after-area hook', err); }
    }
    // listeners run after the engine finished loading the area
    setTimeout(() => this.emit('area', level, area), 0);
  }

  // The star select screen asks for the level's name and studio stars (called from inside the engine).
  _introStars(level) {
    let info = null;
    try { info = this.introInfo?.(level); } catch (err) { console.error('intro info failed', err); }
    if (!info) return;
    const plain = _plain;
    if (info.title) this.M.ccall('studio_intro_title', null, ['string'], [plain(info.title)]);
    if (info.score) this.M._studio_intro_score(info.score | 0);
    for (const s of info.stars || []) {
      // the 100 coin star stays apart from the level's stars, like in the game
      if (s.kind === 'coins100') this.M._studio_intro_coin_star(s.done ? 1 : 0);
      else this.M.ccall('studio_intro_add', null, ['string', 'number'], [plain(s.name), s.done ? 1 : 0]);
    }
  }

  // The castle's pause menu asks for the custom levels (called from inside the engine).
  _pauseLevels() {
    let list = [];
    try { list = this.pauseLevels?.() || []; } catch (err) { console.error('pause levels failed', err); }
    this.M._studio_pause_levels_reset();
    for (const l of list) this.M.ccall('studio_pause_level', null, ['string', 'string', 'number', 'number'], [_plain(l.name), l.stars, l.coins | 0, l.coinStar ? 1 : 0]);
  }

  // A studio star was collected: its names for the course complete screen (called from inside the engine).
  _starInfo(uid, index) {
    let info = null;
    try { info = this.starInfo?.(uid, index); } catch (err) { console.error('star info failed', err); }
    if (info) this.M.ccall('studio_complete_info', null, ['string', 'string'], [_plain(info.title), _plain(info.name)]);
  }

  // Resolves once `level` (null: any level) is loaded and Mario is in it, after its star select screen.
  waitArrival(level, ms = 30000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let timer = null;
      const done = (ok) => { this.off('area', onArea); clearTimeout(timer); resolve(ok); };
      const poll = () => {
        let m = null;
        try { m = this.state().mario; } catch { /* still loading */ }
        if (m && !this.inIntro) done(true);
        else if (performance.now() - t0 < ms) setTimeout(poll, 100);
      };
      const onArea = (lvl) => { if (level === null || lvl === level) poll(); };
      timer = setTimeout(() => done(false), ms);
      this.on('area', onArea);
    });
  }

  // Patch key of the current area: custom levels share one engine slot.
  // Sub-areas of a custom level (inside a building, a cave) are `c:<id>:<area>`.
  areaKey(level = this.level, area = this.area) {
    return level === this.studioLevel ? `c:${this.customLevel || 'default'}${area > 1 ? `:${area}` : ''}` : `${level}:${area}`;
  }

  _applyArea(level, area) {
    const key = this.areaKey(level, area);
    this._terrains = {}; // the engine dropped its terrains with the old area
    for (const fn of this.levelHooks) {
      try { fn(level, area, key); } catch (err) { console.error('level hook', err); }
    }
    const a = this.patch.areas[key];
    if (!a) return;
    const M = this.M;
    for (const r of a.removals || []) {
      const b = this.bhvIndex.get(r.bhv);
      if (b !== undefined) M._studio_add_removal(b, r.x, r.y, r.z, r.r || 40);
    }
    for (const w of a.warps || []) {
      M._studio_add_warp_node(w.node, w.destLevel, w.destArea, w.destNode);
    }
    for (const o of a.objects || []) this._spawnRecord(o);
  }

  _spawnRecord(o) {
    for (const f of this.spawnFilters) {
      const slot = f(o);
      if (slot !== undefined) return slot;
    }
    return this._spawnBase(o);
  }

  _spawnBase(o) {
    const M = this.M;
    if (o.block) {
      const b = o.block;
      return M._studio_spawn_block(b.shape | 0, b.sx, b.sy, b.sz, b.steps | 0, b.top | 0, b.side ?? b.top ?? 0,
        b.surface | 0, b.flags | 0, b.color ?? 0xffffff, o.x, o.y, o.z, o.yaw | 0, o.pitch | 0, o.roll | 0, o.uid);
    }
    if (o.bhv) {
      const b = this.bhvIndex.get(o.bhv);
      const m = o.model ? this.entryIndex.get(o.model) ?? -1 : -1;
      if (b === undefined) return -1;
      return M._studio_spawn_custom(b, m, o.x, o.y, o.z, o.yaw | 0, o.bparams >>> 0, o.uid, o.scale || 1);
    }
    const idx = this.entryIndex.get(o.entry);
    if (idx === undefined) return -1;
    return M._studio_spawn(idx, o.x, o.y, o.z, o.yaw | 0, o.pitch | 0, o.roll | 0, o.bparams >>> 0, o.uid, o.scale || 1);
  }

  _afterFrame() {
    this.lastFrame = performance.now();
    if (this.ready) for (const fn of this.listeners.frame) fn();
    if (this.frameWaiters?.length) {
      // full-resolution copy of the frame that was just drawn
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      c.getContext('2d').drawImage(this.canvas, 0, 0);
      for (const fn of this.frameWaiters.splice(0)) fn(c);
    }
    if (!this.shotWaiters.length) return;
    const waiters = this.shotWaiters.splice(0);
    let url = null;
    try {
      const src = this.canvas;
      const w = Math.min(SHOT_MAX_W, src.width);
      const h = Math.round((src.height * w) / src.width);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(src, 0, 0, w, h);
      url = c.toDataURL('image/jpeg', 0.82);
    } catch (err) {
      console.error(err);
    }
    for (const fn of waiters) fn(url);
  }

  // ---- queries ------------------------------------------------------------

  state() { return this.json('studio_state_json'); }
  objects() { return this.json('studio_objects_json'); }
  warps() { return this.json('studio_warps_json'); }
  heightmap(x0, z0, x1, z1, nx, nz) { return this.json('studio_heightmap_json', x0, z0, x1, z1, nx, nz); }
  floor(x, y, z) { return this.M._studio_floor(x, y, z); }
  water(x, z) { return this.M._studio_water(x, z); }

  captureFrame(skip = 0) {
    return new Promise((resolve) => {
      const wait = (n) => { (this.frameWaiters ||= []).push(n > 0 ? () => wait(n - 1) : resolve); };
      wait(skip);
    });
  }

  screenshot(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      this.shotWaiters.push((url) => { clearTimeout(t); resolve(url); });
    });
  }

  // ---- edits (live + patch) --------------------------------------------

  setPatch(patch) { this.patch = patch || { areas: {} }; }

  spawn(record) { return this._spawnRecord(record); }
  deleteUid(uid) { return this.M._studio_delete_uid(uid); }
  deleteSlot(slot) { return this.M._studio_delete_slot(slot); }
  moveSlot(slot, x, y, z, yaw) { return this.M._studio_move_slot(slot, x, y, z, yaw | 0); }
  addRemoval(r) {
    const b = this.bhvIndex.get(r.bhv);
    if (b !== undefined) this.M._studio_add_removal(b, r.x, r.y, r.z, r.r || 40);
  }
  clearRemovals() { this.M._studio_clear_removals(); }
  addWarp(w) { this.M._studio_add_warp_node(w.node, w.destLevel, w.destArea, w.destNode); }
  relinkWarps() { this.M._studio_relink_warps(); }
  teleport(x, y, z, yaw = 0) { return this.M._studio_teleport(x, y, z, yaw | 0); }
  warp(level, area = 1, node = 10, act = 1) { this.M._studio_warp(level, area, node, act); }
  // Fast level switch; custom levels go through the studio slot and always reload.
  // intro: show the level's star select screen first (it goes on by itself).
  warpFast(level, act = 0, custom = null, intro = true) {
    if (custom) this.customLevel = custom;
    const force = level === this.level || level === this.studioLevel ? 1 : 0;
    // node 0x0A is each course's entry; the castle has none (the front door instead)
    this.M._studio_warp_fast(level, 1, level === 6 ? 0 : 10, act, force, intro ? 1 : 2);
  }

  // Studio stars collected so far: they count on the game's star counter.
  setBonusStars(n) { if (this.ready) this.M._studio_set_bonus_stars(n | 0); }

  // ---- music and sound effects ---------------------------------------------

  // Puts a composed song (.m64 bytes) in the level slot or the preview slot; returns its sequence id.
  installSong(bytes, bank, preview = false) {
    const M = this.M, p = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, p);
    const id = M._studio_song_install(preview ? 1 : 0, p, bytes.length, bank | 0);
    M._free(p);
    return id;
  }
  // The level's music becomes this song, from the start.
  // A sound bank the engine has (Tokyo's instruments are in the build only after its import).
  hasSoundBank(bank) { return this.M?._studio_sound_bank_count ? bank >= 0 && bank < this.M._studio_sound_bank_count() : false; }
  setLevelSong(bytes, bank) {
    const id = this.installSong(bytes, bank, false);
    if (id >= 0) { this.M._studio_set_music(id); this.M._studio_music_restore(); }
    return id;
  }
  previewMusic(seq) { this.M._studio_music_preview(seq | 0); }
  stopPreview() { this.M._studio_music_preview(-1); }
  restoreMusic() { this.M._studio_music_restore(); }
  originalMusic() { this.M._studio_music_original(); }
  // Build mode is silent; the sound studio keeps the sound on while it is open.
  audioHold(on) { this.M._studio_audio_hold(on ? 1 : 0); }
  playGameSound(bits) { this.M._studio_sfx_play(bits >>> 0); }
  // Game sounds the page plays instead: [{ bits, id }] (the engine calls Module.studioSfx(id, distance)).
  setSoundOverrides(list) {
    this.M._studio_sfx_override_clear();
    for (const o of list) this.M._studio_sfx_override(o.bits >>> 0, o.id | 0);
  }

  // ---- world ----------------------------------------------------------------

  setSky(bg) { this.M._studio_set_sky(bg | 0); }
  setMusic(seq) { this.M._studio_set_music(seq | 0); }
  setWater(on, height) { this.M._studio_set_water(on ? 1 : 0, height | 0); }
  setSpawn(x, y, z, yaw = 0) { return this.M._studio_set_spawn(x, y, z, yaw | 0); }
  rebuildCollision() { this.M._studio_rebuild_collision(); }

  terrainCreate(id, nx, nz, cell, x0, z0) {
    const ptr = this.M._studio_terrain_create(id, nx, nz, cell, x0, z0);
    if (!ptr) throw new Error('could not create terrain');
    (this._terrains ||= {})[id] = { ptr, nx, nz };
    return this.terrainViews(id);
  }
  // Views into the engine's terrain buffers (re-made each time: memory can grow).
  terrainViews(id) {
    const t = this._terrains?.[id];
    const mats = t && this.M._studio_terrain_mats(id);
    if (!mats) return null;
    const buf = this.M.HEAPU8.buffer;
    return { heights: new Int16Array(buf, t.ptr, (t.nx + 1) * (t.nz + 1)), mats: new Uint8Array(buf, mats, t.nx * t.nz) };
  }
  terrainBuild(id, i0 = 0, j0 = 0, i1 = -1, j1 = -1, collision = true) { this.M._studio_terrain_build(id, i0, j0, i1, j1, collision ? 1 : 0); }
  terrainDestroy(id) { this.M._studio_terrain_destroy(id); }

  sculptPrepare() { return this.M._studio_sculpt_prepare(); }
  sculptRestore() { this.M._studio_sculpt_restore(); }
  sculptDab(mode, x, z, r, strength, target = 0) { return this.M._studio_sculpt_dab(mode, x, z, r, strength, target); }
  heal() { this.M._studio_heal(); }

  // ---- editor ---------------------------------------------------------------

  // The camera the engine rendered with: view matrix (row vectors), position, fov.
  camOut() {
    const M = this.M;
    const ptr = M._studio_camera_out();
    const f = new Float32Array(M.HEAPU8.buffer, ptr, 25);
    return { view: Array.from(f.subarray(0, 16)), pos: Array.from(f.subarray(16, 19)), focus: Array.from(f.subarray(19, 22)), fov: f[22] || 45, near: f[23], far: f[24] };
  }
  setCamera(enabled, pos = [0, 0, 0], focus = [0, 0, 1], fov = 50) {
    this.M._studio_set_camera(enabled ? 1 : 0, pos[0], pos[1], pos[2], focus[0], focus[1], focus[2], fov);
  }
  setPaused(paused, hideHud = paused) { this.M._studio_set_paused(paused ? 1 : 0, hideHud ? 1 : 0); }
  raycast(o, d, ignoreSlot = -1, objects = true, maxDist = 60000) {
    return this.json('studio_raycast_json', o[0], o[1], o[2], d[0], d[1], d[2], maxDist, ignoreSlot, objects ? 1 : 0);
  }
  transform(slot, x, y, z, pitch, yaw, roll, scale = 0) {
    return this.M._studio_transform_slot(slot, x, y, z, pitch | 0, yaw | 0, roll | 0, scale);
  }
  // A material's texture as a data URL, for swatches.
  materialSwatch(i, side = false) {
    const M = this.M;
    const ptr = M._studio_material_texels(i, side ? 1 : 0);
    if (!ptr) return null;
    const src = M.HEAPU8.subarray(ptr, ptr + 32 * 32 * 2);
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const img = g.createImageData(32, 32);
    for (let p = 0; p < 1024; p++) {
      const v = (src[p * 2] << 8) | src[p * 2 + 1];
      img.data[p * 4] = ((v >> 11) & 31) * 8.226;
      img.data[p * 4 + 1] = ((v >> 6) & 31) * 8.226;
      img.data[p * 4 + 2] = ((v >> 1) & 31) * 8.226;
      img.data[p * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }
  releaseKeys() { if (this.M && this.M._studio_release_keys) this.M._studio_release_keys(); }
  resize(w, h) { if (this.M && this.M._studio_resize) this.M._studio_resize(w | 0, h | 0); }

  // Re-apply the current area's patch without reloading the level, after an undo.
  reapplyRemovals() {
    this.clearRemovals();
    const a = this.patch.areas[this.areaKey()];
    for (const r of (a && a.removals) || []) this.addRemoval(r);
  }
}
