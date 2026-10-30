// The sound studio: compose songs that the game plays with its own instruments, pick
// music for levels from the game's songs and your own, make sound effects and use
// them in place of the game's sounds.
import { icon } from './icons.js';
import {
  GAME_SONGS, SIZE_LIMIT, MAX_TRACKS, STARTERS, loadInstruments, bankOf, newTrack, encodeSong, auditionSong,
  starterSong, songSteps, noteName, songChannels, MAX_CHANNELS, gameSong, applyReplacements,
} from './music.js';
import { parseMidi, importPlan, midiToSong, GM_NAMES } from './midi.js';
import { PRESETS, PRESET_NAMES, WAVES, SfxPlayer, randomSynth, mutateSynth } from './sfx.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const COLORS = ['#ffb627', '#4fc3f7', '#ff6b6b', '#7ed957', '#c084fc', '#f97316', '#2dd4bf', '#f472b6', '#a3e635', '#60a5fa', '#facc15', '#fb7185'];
// note lengths in beats (the steps they take depend on the song's grid)
const LENGTHS = [[1 / 12, '1/48'], [1 / 8, '1/32'], [1 / 6, '1/16 triplet'], [1 / 4, '1/16'], [1 / 3, '1/8 triplet'], [1 / 2, '1/8'], [1, '1/4'], [2, '1/2'], [4, '1 bar']];
const lengthsFor = (spb) => LENGTHS.filter(([b]) => Number.isInteger(Math.round(b * spb * 1000) / 1000) && b * spb >= 1);
const PITCH_TOP = 96, PITCH_BOTTOM = 36;   // C7 .. C2
const ROW_H = 14, KEYS_W = 64;
// a game sound is its bank and id (what the engine matches; play flags vary)
const sameSound = (a, b) => ((a ^ b) & 0xf0ff0000) === 0;
// The most notes sounding at once ({ t, d } on the grid, or a MIDI file's { tick, dur }).
function peakNotes(notes) {
  const ev = [];
  for (const n of notes) { const t = n.t ?? n.tick, d = n.d ?? n.dur; ev.push([t, 1], [t + Math.max(1, d), -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, m = 0;
  for (const [, k] of ev) { c += k; m = Math.max(m, c); }
  return m;
}

export class SoundUI {
  constructor({ engine, world, editor, send, toast, getAudio }) {
    this.engine = engine;
    this.world = world;
    this.editor = editor;
    this.send = send;
    this.toast = toast;
    this.getAudio = getAudio;
    this.sfx = new SfxPlayer();
    this.tab = 'music';
    this.songId = null;
    this.soundId = null;
    this.trackId = null;
    this.snapBeats = 0.5;    // the note length new notes get, in beats
    this.cellW = 18;
    this.playing = null;     // { t0, song } while a song preview runs
    this.saveTimers = new Map(); // id -> { t, go }: saves waiting for typing/dragging to pause
    window.addEventListener('pagehide', () => this.flushSaves()); // a reload must not lose the last edit
    this.banks = [];
    this.gameSounds = [];
    loadInstruments().then((b) => { this.banks = b; if (this.isOpen()) this.render(); });
    fetch('data/sounds.json').then((r) => r.json()).then((s) => { this.gameSounds = s; });
    engine.onGameSound = (id, dist) => this.onGameSound(id, dist);
    this.replaced = new Map(); // game song slots the engine has a song of the project in
    engine.on('ready', () => { this.replaced = new Map(); this.syncOverrides(); });
    engine.on('area', () => this.syncReplacements());
    this.wire();
    this.syncOverrides(); // (the engine and the project can both be there already)
  }

  get audio() { return this.getAudio(); }
  // the note length new notes get, in steps of the song's grid
  get snap() { return Math.max(1, Math.round(this.snapBeats * (this.roll?.song.stepsPerBeat ?? 4))); }
  song() { return this.audio.songs.find((s) => s.id === this.songId) || null; }
  sound() { return this.audio.sounds.find((s) => s.id === this.soundId) || null; }
  bank(song = this.song()) { return bankOf(this.banks, song?.bank ?? 0x22) || { bank: 0x22, programs: [], drums: [] }; }
  isOpen() { return !$('#sound-studio').hidden; }

  // ---- opening and closing ----------------------------------------------------------

  open(tab = this.tab, id) {
    const s = $('#sound-studio');
    if (!s.hidden) { this.tab = tab; this.render(); return; }
    s.hidden = false;
    this.tab = tab;
    if (tab === 'music' && id) this.songId = id;
    if (tab === 'sounds' && id) this.soundId = id;
    // the level waits (build mode) while the studio plays its sounds
    this.wasBuilding = this.editor.active;
    if (!this.editor.active) this.editor.enter();
    this.engine.audioHold(true);
    this.engine.releaseKeys();
    this.render();
  }

  close() {
    $('#sound-studio').hidden = true;
    this.stop();
    this.engine.audioHold(false);
    this.engine.restoreMusic();
    if (!this.wasBuilding && this.editor.active) this.editor.exit();
  }

  wire() {
    $('#ss-close').onclick = () => this.close();
    $('#sound-studio').addEventListener('mousedown', (e) => { if (e.target.id === 'sound-studio') this.close(); });
    for (const b of document.querySelectorAll('.ss-tab')) b.onclick = () => { this.stop(); this.tab = b.dataset.tab; this.render(); };
    // a MIDI file dropped on the studio: the import
    const isMidi = (f) => /\.(midi?|rmi|kar)$/i.test(f.name) || /midi/.test(f.type);
    const studio = $('#sound-studio');
    studio.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); studio.classList.add('dropping'); } });
    studio.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !studio.contains(e.relatedTarget)) studio.classList.remove('dropping'); });
    studio.addEventListener('drop', (e) => {
      studio.classList.remove('dropping');
      const f = [...(e.dataTransfer?.files || [])].find(isMidi);
      e.preventDefault();
      if (f) this.importMidiFile(f);
      else if (e.dataTransfer?.files?.length) this.toast('Drop a MIDI file (.mid) here to import it', 'music');
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.code === 'Space' && !typing && this.tab === 'music' && this.midiImport) { e.preventDefault(); document.querySelector('.mi-listen')?.click(); }
      else if (e.code === 'Space' && !typing && this.tab === 'music' && this.song()) { e.preventDefault(); this.togglePlay(); }
      // undo / redo song and sound edits like any edit (the project's change history)
      else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY') && !typing && window.studio64Undo) {
        e.preventDefault();
        if (e.code === 'KeyY' || e.shiftKey) window.studio64Undo.redoEdit(); else window.studio64Undo.undoHere();
      }
      e.stopPropagation();
    }, true);
  }

  render() {
    for (const b of document.querySelectorAll('.ss-tab')) b.classList.toggle('active', b.dataset.tab === this.tab);
    $('#ss-now').innerHTML = `This level plays <b>${esc(this.levelMusicName())}</b>`;
    if (this.tab === 'music') { this.renderMusicSide(); this.renderComposer(); } else { this.renderSoundSide(); this.renderSoundMain(); }
  }

  levelMusicName() {
    const s = this.world.settings?.() || {};
    if (s.song) return this.audio.songs.find((x) => x.id === s.song)?.name || 'a deleted song';
    if (s.music != null && (this.world.isCustom() || s.musicOverride)) return this.gameSongName(s.music);
    if (this.world.isCustom()) return this.gameSongName(0x03);
    // an original level's own music: the song that replaces it, when one does
    const now = this.engine.musicNow?.();
    return now?.on && this.replacedBy(now.seq) ? this.gameSongName(now.seq) : 'its original music';
  }

  // ---- the game's songs replaced everywhere ------------------------------------------------

  // the project's song that plays instead of a game song, or null
  replacedBy(seq) {
    const r = (this.audio.replace || []).find((x) => x.seq === seq);
    return (r && this.audio.songs.find((x) => x.id === r.song)) || null;
  }
  gameSongName(seq) {
    const name = gameSong(seq)?.name || 'game music', by = this.replacedBy(seq);
    return by ? `${by.name} (instead of ${name})` : name;
  }
  // the game songs a song replaces
  replacing(song) { return (this.audio.replace || []).filter((r) => r.song === song.id).map((r) => gameSong(r.seq)).filter(Boolean); }

  // seq -> song id (null: the game's own again)
  setReplacement(seq, songId) {
    const list = (this.audio.replace || []).filter((r) => r.seq !== seq);
    if (songId) list.push({ seq, song: songId });
    this.audio.replace = list;
    this.send({ type: 'replace_save', replace: list });
    this.syncReplacements();
    const g = gameSong(seq), song = songId && this.audio.songs.find((x) => x.id === songId);
    this.toast(song ? `${song.name} now plays everywhere the game plays ${g.name}` : `${g.name} is the game's own again`, 'music');
    this.render();
  }

  syncReplacements() {
    if (!this.engine.ready) return;
    this.replaced = applyReplacements(this.engine, this.audio, this.replaced);
  }

  // A menu of the songs that can play instead of a game song.
  replaceMenu(seq, anchor) {
    const menu = $('#ss-menu');
    menu.innerHTML = '';
    const g = gameSong(seq), current = this.replacedBy(seq);
    menu.appendChild(el('div', 'ss-menu-head', `Instead of ${esc(g.name)}, everywhere:`));
    const item = (label, fn, active, sub = '') => {
      const b = el('button', `menu-item${active ? ' active' : ''}`, `<span>${esc(label)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`);
      b.onclick = () => { menu.hidden = true; fn(); };
      menu.appendChild(b);
    };
    item(`The game's ${g.name}`, () => this.setReplacement(seq, null), !current);
    for (const song of this.audio.songs) {
      const big = encodeSong(song, { once: !!g.once }).length > SIZE_LIMIT;
      item(song.name, () => (big ? this.toast(`${song.name} is too long for the game: make it shorter first`, 'x') : this.setReplacement(seq, song.id)), current?.id === song.id, big ? 'too long' : g.once ? 'plays once' : '');
    }
    if (!this.audio.songs.length) menu.appendChild(el('div', 'ss-menu-note', 'Make or import a song first (Your songs, above).'));
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { left: `${Math.max(8, r.right - 240)}px`, top: `${Math.min(r.bottom + 4, innerHeight - 320)}px` });
    menu.hidden = false;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.hidden = true; document.removeEventListener('mousedown', off); } }), 0);
  }

  // ---- saving ------------------------------------------------------------------------

  saveSong(song, now = false) {
    this.dropSave(song.id);
    const go = () => {
      this.saveTimers.delete(song.id);
      this.send({ type: 'song_save', song });
      // the level's own song follows edits (when no preview is playing)
      if (!this.playing && this.world.settings?.().song === song.id) this.world.applyLevelSong?.();
      if ((this.audio.replace || []).some((r) => r.song === song.id)) this.syncReplacements();
    };
    if (now) go(); else this.saveTimers.set(song.id, { t: setTimeout(go, 500), go });
    if (this.playing) this.restartPreview();
  }

  saveSound(sound) {
    this.dropSave(sound.id);
    const go = () => { this.saveTimers.delete(sound.id); this.send({ type: 'sound_save', sound }); };
    this.saveTimers.set(sound.id, { t: setTimeout(go, 500), go });
  }

  // A save still waiting: dropped (the song or sound was deleted: it must not come back) or
  // sent now (the page is being closed or reloaded).
  dropSave(id) { clearTimeout(this.saveTimers.get(id)?.t); this.saveTimers.delete(id); }
  flushSaves() { for (const { t, go } of [...this.saveTimers.values()]) { clearTimeout(t); go(); } }

  // ---- music: the side list -------------------------------------------------------------

  renderMusicSide() {
    const side = $('#ss-side');
    side.innerHTML = '';
    const levelSong = this.world.settings?.().song;
    side.appendChild(el('div', 'ss-section', 'Your songs'));
    const mine = el('div', 'ss-list');
    for (const s of this.audio.songs) {
      const row = el('div', `ss-row${s.id === this.songId ? ' active' : ''}`);
      row.innerHTML = `<span class="ss-ico">${icon('music', 'sm')}</span><div class="ss-text"><b>${esc(s.name)}</b><span>${s.bars} bars · ${s.tempo} bpm${s.id === levelSong ? ' · <em>this level</em>' : ''}${this.replacing(s).length ? ` · <em>for ${esc(this.replacing(s).map((g) => g.name).join(', '))}</em>` : ''}</span></div>`;
      const play = el('button', 'btn icon ghost sm', icon('play', 'sm'));
      play.title = 'Play';
      play.onclick = (e) => { e.stopPropagation(); this.songId = s.id; this.midiImport = null; this.render(); this.play(); };
      row.appendChild(play);
      row.onclick = () => { this.stop(); this.songId = s.id; this.trackId = null; this.midiImport = null; this.render(); };
      mine.appendChild(row);
    }
    const add = el('button', 'ss-row ss-new', `<span class="ss-ico">${icon('plus', 'sm')}</span><div class="ss-text"><b>New song</b><span>From a starter or empty</span></div>`);
    add.onclick = () => { this.stop(); this.songId = null; this.midiImport = null; this.render(); };
    mine.appendChild(add);
    const imp = el('button', `ss-row ss-new${this.midiImport ? ' active' : ''}`, `<span class="ss-ico">${icon('upload', 'sm')}</span><div class="ss-text"><b>Import MIDI</b><span>A .mid file from any music editor</span></div>`);
    imp.onclick = () => this.pickMidi();
    mine.appendChild(imp);
    side.appendChild(mine);

    side.appendChild(el('div', 'ss-section', 'Game music'));
    let group = '';
    for (const g of GAME_SONGS) {
      if (g.group !== group) { group = g.group; side.appendChild(el('div', 'ss-group', esc(group))); }
      const row = el('div', 'ss-row game');
      const isLevel = !levelSong && this.world.settings?.().music === g.seq && (this.world.isCustom() || this.world.settings().musicOverride);
      const by = this.replacedBy(g.seq);
      const notes = [by ? `→ ${esc(by.name)}` : '', isLevel ? '<em>this level</em>' : ''].filter(Boolean).join(' · ');
      row.classList.toggle('replaced', !!by);
      row.innerHTML = `<div class="ss-text"><b>${esc(g.name)}</b>${notes ? `<span>${notes}</span>` : ''}</div>`;
      const play = el('button', 'btn icon ghost sm', icon(this.gamePreview === g.seq ? 'stop' : 'play', 'sm'));
      play.title = by ? `Listen (plays ${by.name} now)` : 'Listen';
      play.onclick = (e) => {
        e.stopPropagation();
        if (this.gamePreview === g.seq) { this.stop(); } else { this.stop(); this.gamePreview = g.seq; this.engine.previewMusic(g.seq); }
        this.renderMusicSide();
      };
      const use = el('button', 'btn sm ghost ss-use', 'Use');
      use.title = 'Play this in the level';
      use.onclick = (e) => { e.stopPropagation(); this.useGameMusic(g); };
      const swap = el('button', `btn sm ghost ss-replace${by ? ' on' : ''}`, by ? 'Replaced' : 'Replace');
      swap.title = by ? `${by.name} plays everywhere instead: change it or bring the game's back` : 'Play one of your songs everywhere the game plays this';
      swap.onclick = (e) => { e.stopPropagation(); this.replaceMenu(g.seq, e.currentTarget); };
      const acts = el('div', 'ss-acts');
      acts.append(use, swap, play);
      row.append(acts);
      side.appendChild(row);
    }
  }

  useGameMusic(g) {
    this.stop();
    this.world.setSettings({ music: g.seq, musicOverride: true, song: null }, `Music: ${g.name}`);
    this.toast(`This level plays ${this.gameSongName(g.seq)}`, 'music');
    this.render();
  }

  useSong(song) {
    this.stop();
    this.dropSave(song.id);
    this.send({ type: 'song_save', song });
    this.world.setSettings({ song: song.id, musicOverride: true }, `Music: ${song.name}`);
    this.toast(`This level plays ${song.name}`, 'music');
    this.render();
  }

  // ---- music: the composer ------------------------------------------------------------------

  renderComposer() {
    const main = $('#ss-main');
    main.innerHTML = '';
    if (this.midiImport) return this.renderMidiImport(main);
    const song = this.song();
    if (!song) return this.renderStarters(main);
    const bank = this.bank(song);
    if (!song.tracks.find((t) => t.id === this.trackId)) this.trackId = song.tracks[0]?.id || null;

    // toolbar
    const bar = el('div', 'cmp-bar');
    const name = el('input', 'cmp-name');
    name.value = song.name;
    name.maxLength = 60;
    name.oninput = () => { song.name = name.value; this.saveSong(song); };
    name.onchange = () => this.renderMusicSide();
    const play = el('button', `btn primary cmp-play`, this.playing ? `${icon('stop', 'sm')}Stop` : `${icon('play', 'sm')}Play`);
    play.onclick = () => this.togglePlay();
    const field = (label, input) => { const f = el('label', 'cmp-field'); f.append(el('span', '', label), input); return f; };
    const tempo = el('input');
    Object.assign(tempo, { type: 'number', min: 40, max: 240, value: song.tempo });
    tempo.onchange = () => {
      if (tempo.value.trim() === '' || !Number.isFinite(Number(tempo.value))) { tempo.value = song.tempo; return; } // empty: keep the tempo (not 120)
      song.tempo = Math.round(Math.max(40, Math.min(240, Number(tempo.value)))); tempo.value = song.tempo; this.saveSong(song);
    };
    const bars = el('select');
    bars.innerHTML = [...new Set([1, 2, 4, 8, 12, 16, 24, 32, 48, 64, song.bars])].sort((a, b) => a - b).map((n) => `<option ${n === song.bars ? 'selected' : ''}>${n}</option>`).join('');
    bars.onchange = () => { song.bars = Number(bars.value); this.saveSong(song); this.renderComposer(); };
    const set = el('select', 'cmp-set');
    set.innerHTML = this.banks.map((b) => `<option value="${b.bank}" ${b.bank === song.bank ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    set.title = 'The instruments the song uses: each set is the band of one of the game\'s songs';
    set.onchange = () => this.changeBank(song, Number(set.value));
    const size = encodeSong(song).length;
    const meter = el('span', `cmp-size${size > SIZE_LIMIT ? ' over' : ''}`, `${(size / 1024).toFixed(1)} of ${SIZE_LIMIT / 1024} KB`);
    meter.title = size > SIZE_LIMIT ? 'Too long for the game: make it shorter or use fewer notes' : 'How much of the game\'s song memory it uses';
    const isLevel = this.world.settings?.().song === song.id;
    const use = el('button', `btn ${isLevel ? '' : 'primary'}`, isLevel ? `${icon('check', 'sm')}Plays in this level` : 'Use in this level');
    use.disabled = isLevel || size > SIZE_LIMIT;
    use.onclick = () => this.useSong(song);
    const more = el('button', 'btn icon ghost', icon('list', 'sm'));
    more.title = 'Duplicate, play instead of a game song, delete';
    more.onclick = (e) => { e.stopPropagation(); this.songMenu(song, e.currentTarget); }; // the document click closes .menu
    bar.append(name, play, field('Tempo', tempo), field('Bars', bars), field('Sound set', set), el('div', 'spacer'), meter, use, more);
    main.appendChild(bar);
    const reps = this.replacing(song);
    if (reps.length) {
      const line = el('div', 'cmp-replaces', `${icon('music', 'sm')}<span>Plays everywhere instead of</span>`);
      for (const g of reps) {
        const chip = el('span', 'cmp-chip', `${esc(g.name)}${g.once ? ' <small>once</small>' : ''}`);
        const x = el('button', 'cmp-chip-x', icon('x', 'sm'));
        x.title = `Bring the game's ${g.name} back`;
        x.onclick = () => this.setReplacement(g.seq, null);
        chip.appendChild(x);
        line.appendChild(chip);
      }
      main.appendChild(line);
    }

    // tracks and the piano roll
    const body = el('div', 'cmp-body');
    const tracks = el('div', 'cmp-tracks');
    song.tracks.forEach((t, i) => tracks.appendChild(this.trackRow(song, t, i, bank)));
    if (song.tracks.length < MAX_TRACKS) {
      const add = el('div', 'cmp-add');
      const inst = el('button', 'btn sm', `${icon('plus', 'sm')}Instrument`);
      inst.onclick = () => this.addTrack(song, 'inst');
      add.appendChild(inst);
      if (bank.drums.length) {
        const drums = el('button', 'btn sm', `${icon('plus', 'sm')}Drums`);
        drums.onclick = () => this.addTrack(song, 'drums');
        add.appendChild(drums);
      }
      tracks.appendChild(add);
    }
    body.appendChild(tracks);
    const rollBox = el('div', 'cmp-roll');
    body.appendChild(rollBox);
    main.appendChild(body);
    this.renderRoll(rollBox, song);
  }

  renderStarters(main) {
    main.appendChild(el('div', 'ss-empty-title', 'Make a song'));
    main.appendChild(el('div', 'ss-empty-sub', 'Songs play in the game with its own instruments. Start from one of these and change anything<span data-ai>, or ask Claude in the chat to compose one</span>.'));
    const grid = el('div', 'starter-grid');
    for (const st of STARTERS) {
      const c = el('button', 'starter', `<span class="starter-ico">${icon(st.id === 'empty' ? 'plus' : 'music')}</span><b>${esc(st.name)}</b><span>${esc(st.note)}</span><small>${esc(bankOf(this.banks, st.bank)?.name || '')} · ${st.tempo} bpm</small>`);
      c.onclick = () => {
        if (!this.banks.length) return;
        const song = starterSong(st, this.banks);
        this.audio.songs.push(song);
        this.songId = song.id;
        this.trackId = song.tracks[0]?.id || null;
        this.saveSong(song, true);
        this.render();
      };
      grid.appendChild(c);
    }
    const imp = el('button', 'starter', `<span class="starter-ico">${icon('upload')}</span><b>Import MIDI</b><span>Bring a song from any music editor and give each part one of the game's instruments</span><small>.mid · or drop the file here</small>`);
    imp.onclick = () => this.pickMidi();
    grid.appendChild(imp);
    main.appendChild(grid);
  }

  // ---- music: importing MIDI files -----------------------------------------------------------

  pickMidi() {
    const input = el('input');
    Object.assign(input, { type: 'file', accept: '.mid,.midi,.rmi,.kar,audio/midi,audio/x-midi' });
    input.onchange = () => { const f = input.files?.[0]; if (f) this.importMidiFile(f); };
    input.click();
  }

  async importMidiFile(file) {
    if (!this.banks.length) return;
    let midi;
    try { midi = parseMidi(await file.arrayBuffer()); } catch (e) { this.toast(`Could not read ${file.name}: ${e.message}`, 'x'); return; }
    if (!midi.parts.length) { this.toast(`${file.name} has no notes`, 'x'); return; }
    this.stop();
    const plan = importPlan(midi, this.banks);
    // (the game plays 12 tracks: the parts with the most notes)
    const keep = new Set([...plan.parts].map((pp) => [pp, midi.parts.find((x) => x.key === pp.key).notes.length]).sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKS).map(([pp]) => pp));
    for (const pp of plan.parts) pp.on = keep.has(pp);
    this.midiImport = { midi, plan, name: file.name.replace(/\.(midi?|rmi|kar)$/i, '').slice(0, 60) || 'Imported song' };
    this.songId = null;
    this.tab = 'music';
    this.render();
  }

  // The song the import makes with its settings now.
  midiSong() {
    const m = this.midiImport;
    return midiToSong(m.midi, m.plan, this.banks, m.name);
  }

  renderMidiImport(main) {
    const { midi, plan } = this.midiImport;
    const bank = bankOf(this.banks, plan.bank);
    const redraw = () => this.renderComposer();
    main.appendChild(el('div', 'ss-empty-title', 'Import a MIDI file'));
    const tempoNote = (midi.tempoChanges ? ' It changes tempo along the way: the song keeps the first one.' : '')
      + (plan.beatScale > 1 ? ` The game plays at most 240 bpm: it counts in half time (${Math.round(plan.tempo)} bpm), and sounds the same.` : plan.beatScale < 1 ? ` The game plays at least 40 bpm: it counts in double time (${Math.round(plan.tempo)} bpm), and sounds the same.` : '');
    main.appendChild(el('div', 'ss-empty-sub', `${midi.parts.length} part${midi.parts.length === 1 ? '' : 's'}, ${Math.round(midi.tempo)} bpm. Give each part one of the game's instruments (the sound set is the band: every part plays one of its instruments, drums its kit). You can change all of it in the composer afterwards.${tempoNote}`));

    // settings
    const bar = el('div', 'cmp-bar mi-bar');
    const field = (label, input) => { const f = el('label', 'cmp-field'); f.append(el('span', '', label), input); return f; };
    const name = el('input', 'cmp-name');
    name.value = this.midiImport.name;
    name.maxLength = 60;
    name.oninput = () => { this.midiImport.name = name.value; };
    const set = el('select', 'cmp-set');
    set.innerHTML = this.banks.map((b) => `<option value="${b.bank}" ${b.bank === plan.bank ? 'selected' : ''}>${esc(b.name)}${b.drums.length ? ' · drums' : ''}</option>`).join('');
    set.title = 'The instruments the song uses: each set is the band of one of the game\'s songs';
    set.onchange = () => {
      // new instruments for the new set; the parts stay on or off
      const on = new Map(plan.parts.map((pp) => [pp.key, pp.on]));
      this.midiImport.plan = { ...importPlan(midi, this.banks, Number(set.value)), stepsPerBeat: plan.stepsPerBeat, from: plan.from, bars: plan.bars, tempo: plan.tempo };
      for (const pp of this.midiImport.plan.parts) pp.on = on.get(pp.key);
      this.stopMidiPreview(); redraw();
    };
    const timing = el('select');
    timing.innerHTML = [[4, '1/16 notes'], [8, '1/32 notes'], [12, '1/16 + triplets']].map(([v, l]) => `<option value="${v}" ${v === plan.stepsPerBeat ? 'selected' : ''}>${l}</option>`).join('');
    timing.title = 'The finest note the grid keeps: notes snap to it';
    timing.onchange = () => { plan.stepsPerBeat = Number(timing.value); this.stopMidiPreview(); redraw(); };
    const total = Math.max(1, Math.ceil(midi.length / (midi.division * (plan.beatScale || 1) * plan.beatsPerBar)));
    const num = (value, min, max, set) => {
      const i = el('input');
      Object.assign(i, { type: 'number', min, max, value });
      i.onchange = () => { const v = Math.round(Number(i.value)); if (!Number.isFinite(v) || i.value.trim() === '') { i.value = value; return; } set(Math.max(min, Math.min(max, v))); this.stopMidiPreview(); redraw(); };
      return i;
    };
    const from = num(plan.from + 1, 1, total, (v) => { plan.from = v - 1; plan.bars = Math.min(plan.bars, Math.max(1, total - plan.from)); });
    from.title = 'The bar the song starts at';
    const bars = num(plan.bars, 1, 170, (v) => { plan.bars = v; });
    bars.title = 'How many bars the song plays before it loops';
    const tempo = num(plan.tempo, 40, 240, (v) => { plan.tempo = v; });
    bar.append(field('Name', name), field('Sound set', set), field('Timing', timing), field('From bar', from), field('Bars', bars), field('Tempo', tempo));
    main.appendChild(bar);

    // the parts
    const list = el('div', 'mi-parts');
    plan.parts.forEach((pp, i) => {
      const part = midi.parts.find((x) => x.key === pp.key);
      const row = el('div', `mi-part${pp.on ? '' : ' off'}`);
      row.style.setProperty('--tc', COLORS[i % COLORS.length]);
      const on = el('input');
      Object.assign(on, { type: 'checkbox', checked: pp.on, title: 'Import this part' });
      on.onchange = () => {
        if (on.checked && plan.parts.filter((x) => x.on).length >= MAX_TRACKS) { on.checked = false; this.toast(`A song has ${MAX_TRACKS} tracks at most: turn another part off first`, 'x'); return; }
        pp.on = on.checked; this.stopMidiPreview(); redraw();
      };
      const peak = peakNotes(part.notes);
      const from = part.drums ? 'Drums (channel 10)' : `${GM_NAMES[part.program ?? 0]}${part.program === null ? ' (no instrument set)' : ''}`;
      const info = el('div', 'mi-info', `<b>${esc(part.name)}</b><span>${esc(from)} · ${part.notes.length} notes${peak > 1 ? ` · ${peak} at once` : ''}</span>`);
      const sel = el('select', 'mi-inst');
      const drumOpt = bank.drums.length ? `<option value="drums" ${pp.kind === 'drums' ? 'selected' : ''}>Drum kit</option>` : '';
      sel.innerHTML = drumOpt + bank.programs.map((p) => `<option value="${p.program}" ${pp.kind !== 'drums' && p.program === pp.program ? 'selected' : ''}>${p.program} · ${esc(p.label)}</option>`).join('');
      sel.title = 'The game instrument that plays this part';
      sel.onchange = () => {
        if (sel.value === 'drums') pp.kind = 'drums'; else { pp.kind = 'inst'; pp.program = Number(sel.value); }
        this.stopMidiPreview();
        this.auditionPart(pp);
      };
      const hear = el('button', 'btn icon ghost sm', icon('play', 'sm'));
      hear.title = 'Hear the instrument';
      hear.onclick = () => this.auditionPart(pp);
      row.append(on, el('span', 'cmp-dot'), info, sel, hear);
      list.appendChild(row);
    });
    main.appendChild(list);

    // what it makes: its size, the notes the game cannot play at once
    const song = this.midiSong();
    const size = encodeSong(song).length;
    const { channels, dropped } = songChannels(song);
    const most = peakNotes(song.tracks.flatMap((t) => t.notes));
    const notes = [];
    if (size > SIZE_LIMIT) notes.push(`It is long for the game (${(size / 1024).toFixed(1)} KB of ${SIZE_LIMIT / 1024}): fewer bars or parts make it fit.`);
    if (dropped) notes.push(`${dropped} notes do not fit: the game plays ${MAX_CHANNELS} channels of 4 notes. Turn off a part or thin out big chords.`);
    else if (most > 16) notes.push(`Up to ${most} notes sound at once; the game plays 16 (its sound effects included), so the quietest drop out in the busiest moments.`);
    if (!song.tracks.length) notes.push('Turn on at least one part (or move "From bar" to where its notes are).');
    const foot = el('div', 'mi-foot');
    foot.append(el('div', 'mi-notes', notes.map((n) => `<p>${icon('alert', 'sm')}${esc(n)}</p>`).join('') || `<p class="ok">${icon('check', 'sm')}${song.tracks.length} tracks on ${channels.length} channels, every note fits</p>`));
    const meter = el('span', `cmp-size${size > SIZE_LIMIT ? ' over' : ''}`, `${(size / 1024).toFixed(1)} of ${SIZE_LIMIT / 1024} KB`);
    const listen = el('button', 'btn mi-listen', this.midiPreview ? `${icon('stop', 'sm')}Stop` : `${icon('play', 'sm')}Listen`);
    listen.disabled = !song.tracks.length;
    listen.onclick = () => { if (this.midiPreview) this.stopMidiPreview(); else this.previewMidi(); redraw(); };
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.onclick = () => { this.stopMidiPreview(); this.midiImport = null; this.render(); };
    const go = el('button', 'btn primary mi-import', `${icon('check', 'sm')}Import`);
    go.disabled = !song.tracks.length;
    go.onclick = () => this.finishMidiImport();
    foot.append(meter, listen, cancel, go);
    main.appendChild(foot);
  }

  auditionPart(pp) {
    const plan = this.midiImport?.plan;
    if (!plan) return;
    this.stopMidiPreview();
    const s = { bank: plan.bank };
    this.audition(s, { kind: pp.kind, program: pp.program });
  }

  previewMidi() {
    const song = this.midiSong();
    this.stop();
    const seq = this.engine.installSong(encodeSong(song), song.bank, true);
    if (seq < 0) { this.toast('This song is too long for the game', 'x'); return; }
    this.engine.previewMusic(seq);
    this.midiPreview = true;
  }

  stopMidiPreview() {
    if (!this.midiPreview) return;
    this.midiPreview = false;
    this.engine.stopPreview();
    const b = document.querySelector('.mi-listen');
    if (b) b.innerHTML = `${icon('play', 'sm')}Listen`;
  }

  finishMidiImport() {
    const song = this.midiSong();
    if (!song.tracks.length) return;
    this.stopMidiPreview();
    this.midiImport = null;
    this.audio.songs.push(song);
    this.songId = song.id;
    this.trackId = song.tracks[0].id;
    this.saveSong(song, true);
    this.render();
    this.toast(`Imported ${song.name}: ${song.tracks.length} tracks`, 'music');
  }

  songMenu(song, anchor) {
    const menu = $('#ss-menu');
    menu.innerHTML = '';
    const item = (label, fn, danger) => { const b = el('button', `menu-item${danger ? ' danger' : ''}`, `<span>${esc(label)}</span>`); b.onclick = () => { menu.hidden = true; fn(); }; menu.appendChild(b); };
    item('Duplicate', () => {
      const copy = JSON.parse(JSON.stringify(song));
      copy.id = uid();
      copy.name = `${song.name} copy`;
      this.audio.songs.push(copy);
      this.songId = copy.id;
      this.saveSong(copy, true);
      this.render();
    });
    // (after this click: the document's click closes open menus)
    item('Play instead of a game song…', () => setTimeout(() => this.replacePicker(song, anchor), 0));
    item('Delete', () => {
      this.stop();
      this.audio.songs = this.audio.songs.filter((s) => s.id !== song.id);
      this.audio.replace = (this.audio.replace || []).filter((r) => r.song !== song.id);
      this.syncReplacements();
      this.dropSave(song.id);
      this.send({ type: 'audio_delete', kind: 'song', id: song.id });
      if (this.world.settings?.().song === song.id) this.world.setSettings({ song: null }, 'Removed the level song');
      this.songId = null;
      this.render();
    }, true);
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { left: `${r.right - 160}px`, top: `${r.bottom + 4}px` });
    menu.hidden = false;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.hidden = true; document.removeEventListener('mousedown', off); } }), 0);
  }

  // The game songs this song plays instead of (from the composer's menu).
  replacePicker(song, anchor) {
    const menu = $('#ss-menu');
    menu.innerHTML = '';
    menu.appendChild(el('div', 'ss-menu-head', `Play ${esc(song.name)} everywhere instead of:`));
    const list = el('div', 'ss-menu-list');
    let group = '';
    for (const g of GAME_SONGS) {
      if (g.group !== group) { group = g.group; list.appendChild(el('div', 'ss-menu-group', esc(group))); }
      const other = this.replacedBy(g.seq);
      const on = other?.id === song.id;
      const b = el('button', `menu-item${on ? ' active' : ''}`, `<span>${esc(g.name)}</span>${other && !on ? `<span class="sub">${esc(other.name)}</span>` : g.once ? '<span class="sub">plays once</span>' : ''}`);
      b.onclick = () => {
        menu.hidden = true;
        if (!on && encodeSong(song, { once: !!g.once }).length > SIZE_LIMIT) { this.toast(`${song.name} is too long for the game: make it shorter first`, 'x'); return; }
        this.setReplacement(g.seq, on ? null : song.id);
      };
      list.appendChild(b);
    }
    menu.appendChild(list);
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { left: `${Math.max(8, r.right - 260)}px`, top: `${Math.min(r.bottom + 4, innerHeight - 440)}px` });
    menu.hidden = false;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.hidden = true; document.removeEventListener('mousedown', off); } }), 0);
  }

  changeBank(song, bankId) {
    const old = this.bank(song), next = bankOf(this.banks, bankId);
    song.bank = bankId;
    // keep each track's role: the instrument with the same kind of label in the new set
    for (const t of song.tracks) {
      if (t.kind === 'drums') continue;
      if (next.programs.some((p) => p.program === t.program)) continue;
      const role = (old.programs.find((p) => p.program === t.program)?.label || '').split(' ')[0];
      t.program = (next.programs.find((p) => p.label.startsWith(role)) || next.programs[0])?.program ?? 0;
    }
    if (!next.drums.length) song.tracks = song.tracks.filter((t) => t.kind !== 'drums');
    this.saveSong(song);
    this.renderComposer();
  }

  trackRow(song, t, i, bank) {
    const row = el('div', `cmp-track${t.id === this.trackId ? ' active' : ''}${t.mute ? ' muted' : ''}`);
    row.style.setProperty('--tc', COLORS[i % COLORS.length]);
    const top = el('div', 'cmp-track-top');
    const name = el('input', 'cmp-track-name');
    name.value = t.name;
    name.oninput = () => { t.name = name.value; this.saveSong(song); };
    const mute = el('button', 'btn icon ghost sm', icon(t.mute ? 'x' : 'volume', 'sm'));
    mute.title = t.mute ? 'Unmute' : 'Mute';
    mute.onclick = (e) => { e.stopPropagation(); t.mute = !t.mute; this.saveSong(song); this.renderComposer(); };
    const del = el('button', 'btn icon ghost sm', icon('trash', 'sm'));
    del.title = 'Delete track';
    del.onclick = (e) => { e.stopPropagation(); song.tracks = song.tracks.filter((x) => x !== t); this.saveSong(song); this.renderComposer(); };
    top.append(el('span', 'cmp-dot'), name, mute, del);
    const inst = el('div', 'cmp-track-inst');
    const sel = el('select');
    if (t.kind === 'drums') sel.innerHTML = '<option>Drum kit</option>';
    else sel.innerHTML = bank.programs.map((p) => `<option value="${p.program}" ${p.program === t.program ? 'selected' : ''} title="${esc(p.usedIn?.length ? `Heard in ${p.usedIn.join(', ')}` : '')}">${p.program} · ${esc(p.label)}</option>`).join('');
    sel.disabled = t.kind === 'drums';
    sel.onchange = () => { t.program = Number(sel.value); this.saveSong(song); this.audition(song, t); };
    const hear = el('button', 'btn icon ghost sm', icon('play', 'sm'));
    hear.title = 'Hear this instrument';
    hear.onclick = (e) => { e.stopPropagation(); this.audition(song, t); };
    inst.append(sel, hear);
    const mix = el('div', 'cmp-track-mix');
    const slider = (label, key, max = 127) => {
      const l = el('label', '', `<span>${label}</span>`);
      const r = el('input');
      Object.assign(r, { type: 'range', min: 0, max, value: t[key] });
      r.oninput = () => { t[key] = Number(r.value); };
      r.onchange = () => this.saveSong(song);
      l.appendChild(r);
      return l;
    };
    mix.append(slider('Vol', 'volume'), slider('Pan', 'pan'));
    row.append(top, inst, mix);
    row.onclick = (e) => { if (e.target.closest('input,select,button')) return; this.trackId = t.id; this.renderComposer(); };
    return row;
  }

  addTrack(song, kind) {
    const bank = this.bank(song);
    const used = new Set(song.tracks.map((t) => t.program));
    const prog = (bank.programs.find((p) => !used.has(p.program)) || bank.programs[0])?.program ?? 0;
    const t = newTrack(kind, prog, kind === 'drums' ? 'Drums' : `Track ${song.tracks.length + 1}`);
    song.tracks.push(t);
    this.trackId = t.id;
    this.saveSong(song);
    this.renderComposer();
  }

  // ---- the piano roll ----------------------------------------------------------------------

  rows(song, t) {
    if (t?.kind === 'drums') return this.bank(song).drums.map((d) => ({ p: d.note, label: d.label }));
    const out = [];
    // (C2..C7, wider when the track has notes beyond: imported songs)
    const ps = t?.notes.map((n) => n.p) || [];
    const top = Math.min(108, Math.max(PITCH_TOP, ...ps)), bottom = Math.max(21, Math.min(PITCH_BOTTOM, ...ps));
    for (let p = top; p >= bottom; p--) out.push({ p, label: noteName(p), black: [1, 3, 6, 8, 10].includes(p % 12) });
    return out;
  }

  renderRoll(box, song) {
    const t = song.tracks.find((x) => x.id === this.trackId);
    box.innerHTML = '';
    const tools = el('div', 'roll-tools');
    const len = el('select');
    const lengths = lengthsFor(song.stepsPerBeat);
    if (!lengths.some(([b]) => b === this.snapBeats)) this.snapBeats = lengths.find(([b]) => b >= 0.5)?.[0] ?? lengths[0][0];
    len.innerHTML = lengths.map(([b, l]) => `<option value="${b}" ${b === this.snapBeats ? 'selected' : ''}>${l}</option>`).join('');
    len.onchange = () => { this.snapBeats = Number(len.value); };
    const zoomOut = el('button', 'btn icon ghost sm', '−');
    zoomOut.onclick = () => { this.cellW = Math.max(8, this.cellW - 4); this.renderRoll(box, song); };
    const zoomIn = el('button', 'btn icon ghost sm', '+');
    zoomIn.onclick = () => { this.cellW = Math.min(40, this.cellW + 4); this.renderRoll(box, song); };
    const clear = el('button', 'btn sm ghost', 'Clear track');
    clear.onclick = () => { if (t) { t.notes = []; this.saveSong(song); this.drawRoll(); } };
    tools.append(el('span', 'roll-label', 'Note length'), len, el('span', 'roll-label', 'Zoom'), zoomOut, zoomIn, el('div', 'spacer'),
      el('span', 'roll-hint', t ? 'Click to add a note · drag to move · drag its end to make it longer · click it again or right-click to delete' : 'Add a track to start'), clear);
    box.appendChild(tools);
    if (!t) return;
    const rows = this.rows(song, t);
    const steps = songSteps(song);
    const scroll = el('div', 'roll-scroll');
    const inner = el('div', 'roll-inner');
    const keys = el('canvas', 'roll-keys');
    const grid = el('canvas', 'roll-grid');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // (a step's width: cellW at 1/16 notes, the beat as wide on finer grids; long songs narrower,
    // within what a canvas can be)
    const cw = Math.max(1, Math.min(this.cellW * 4 / song.stepsPerBeat, 32000 / (steps * dpr)));
    const H = rows.length * ROW_H, W = steps * cw;
    keys.width = KEYS_W * dpr; keys.height = H * dpr; keys.style.width = `${KEYS_W}px`; keys.style.height = `${H}px`;
    grid.width = W * dpr; grid.height = H * dpr; grid.style.width = `${W}px`; grid.style.height = `${H}px`;
    inner.append(keys, grid);
    scroll.appendChild(inner);
    box.appendChild(scroll);
    this.roll = { song, t, rows, steps, keys, grid, dpr, scroll, cw };
    this.drawKeys();
    this.drawRoll();
    // start around middle C (or the top of the drum kit)
    if (t.kind !== 'drums') {
      const notes = t.notes.length ? t.notes.reduce((a, n) => a + n.p, 0) / t.notes.length : 64;
      scroll.scrollTop = Math.max(0, (rows[0].p - notes) * ROW_H - 160);
    }
    this.wireRoll();
  }

  drawKeys() {
    const { keys, rows, dpr, t } = this.roll;
    const g = keys.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#16161b';
    g.fillRect(0, 0, KEYS_W, rows.length * ROW_H);
    g.font = '10px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const y = i * ROW_H;
      if (t.kind !== 'drums') {
        g.fillStyle = r.black ? '#24242c' : '#e9e9ef';
        g.fillRect(0, y, KEYS_W - 1, ROW_H - 1);
        // C is labelled, like on a keyboard
        if (r.p % 12 === 0) { g.fillStyle = '#33333b'; g.fillText(r.label, KEYS_W - 26, y + ROW_H / 2); }
      } else {
        g.fillStyle = i % 2 ? '#1c1c22' : '#202027';
        g.fillRect(0, y, KEYS_W - 1, ROW_H - 1);
        g.fillStyle = '#c9c9d2';
        g.fillText(r.label, 6, y + ROW_H / 2);
      }
    });
  }

  drawRoll() {
    if (!this.roll) return;
    const { grid, rows, steps, dpr, song, t } = this.roll;
    const g = grid.getContext('2d');
    const cw = this.roll.cw, W = steps * cw, H = rows.length * ROW_H;
    const spb = song.stepsPerBeat, bar = spb * song.beatsPerBar;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#121216';
    g.fillRect(0, 0, W, H);
    rows.forEach((r, i) => { if (r.black || (t.kind === 'drums' && i % 2)) { g.fillStyle = '#17171c'; g.fillRect(0, i * ROW_H, W, ROW_H); } });
    for (let s = 0; s <= steps; s++) {
      if (cw < 4 && s % spb) continue; // (narrow: the beats only)
      g.fillStyle = s % bar === 0 ? '#3a3a46' : s % spb === 0 ? '#26262f' : '#1b1b21';
      g.fillRect(s * cw, 0, 1, H);
    }
    for (let i = 0; i <= rows.length; i++) {
      const r = rows[i];
      g.fillStyle = r && t.kind !== 'drums' && r.p % 12 === 11 ? '#2c2c36' : '#19191f';
      g.fillRect(0, i * ROW_H, W, 1);
    }
    const rowOf = new Map(rows.map((r, i) => [r.p, i]));
    // the other tracks, faintly
    if (t.kind !== 'drums') {
      song.tracks.forEach((o, k) => {
        if (o === t || o.kind === 'drums') return;
        g.fillStyle = `${COLORS[k % COLORS.length]}33`;
        for (const n of o.notes) { const i = rowOf.get(n.p); if (i !== undefined) g.fillRect(n.t * cw + 1, i * ROW_H + 3, n.d * cw - 2, ROW_H - 6); }
      });
    }
    const color = COLORS[song.tracks.indexOf(t) % COLORS.length];
    for (const n of t.notes) {
      const i = rowOf.get(n.p);
      if (i === undefined) continue;
      const x = n.t * cw + 1, y = i * ROW_H + 1, w = Math.max(3, n.d * cw - 2), h = ROW_H - 2;
      g.fillStyle = color;
      g.globalAlpha = 0.55 + 0.45 * ((n.v ?? 100) / 127);
      g.beginPath();
      g.roundRect ? g.roundRect(x, y, w, h, 3) : g.rect(x, y, w, h);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(x + w - 3, y + 2, 2, h - 4);
    }
    if (this.playing && this.playing.song === song) {
      const pos = this.playPosition();
      g.fillStyle = '#ffd34d';
      g.fillRect(pos * cw, 0, 2, H);
    }
  }

  wireRoll() {
    const { grid } = this.roll;
    let drag = null;
    const at = (e) => {
      const r = grid.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return { x, step: Math.floor(x / this.roll.cw), row: this.roll.rows[Math.floor(y / ROW_H)] };
    };
    const noteAt = (p) => this.roll.t.notes.find((n) => n.p === p.row?.p && p.step >= n.t && p.step < n.t + n.d);
    grid.oncontextmenu = (e) => e.preventDefault();
    grid.onmousedown = (e) => {
      const p = at(e);
      if (!p.row) return;
      const { t, song } = this.roll;
      const hit = noteAt(p);
      if (e.button === 2) {
        if (hit) { t.notes = t.notes.filter((n) => n !== hit); this.saveSong(song); this.drawRoll(); }
        return;
      }
      if (hit) {
        const edge = (hit.t + hit.d) * this.roll.cw - p.x < 7;
        drag = { note: hit, mode: edge ? 'resize' : 'move', from: p, t0: hit.t, p0: hit.p, moved: false };
      } else {
        const start = Math.floor(p.step / this.snap) * this.snap;
        const n = { t: start, d: this.snap, p: p.row.p, v: 100 };
        t.notes.push(n);
        drag = { note: n, mode: 'resize', from: p, t0: n.t, p0: n.p, moved: true, created: true };
        this.auditionNote(song, t, n.p);
      }
      this.drawRoll();
      const move = (ev) => {
        const q = at(ev);
        const dStep = q.step - drag.from.step;
        if (drag.mode === 'move') {
          const rowIdx = this.roll.rows.findIndex((r) => r.p === drag.p0) + Math.floor((ev.clientY - e.clientY) / ROW_H + (ev.clientY > e.clientY ? 0 : 0.999));
          const row = this.roll.rows[Math.max(0, Math.min(this.roll.rows.length - 1, rowIdx))];
          const nt = Math.max(0, Math.min(this.roll.steps - drag.note.d, drag.t0 + Math.round(dStep / this.snap) * this.snap));
          if (nt !== drag.note.t || row.p !== drag.note.p) { drag.moved = true; drag.note.t = nt; if (row.p !== drag.note.p) { drag.note.p = row.p; this.auditionNote(this.roll.song, this.roll.t, row.p); } }
        } else {
          const end = Math.max(drag.note.t + 1, Math.min(this.roll.steps, q.step + 1));
          if (end - drag.note.t !== drag.note.d) { drag.moved = true; drag.note.d = end - drag.note.t; }
        }
        this.drawRoll();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        // a click on a note (no drag) removes it
        if (!drag.moved && !drag.created) this.roll.t.notes = this.roll.t.notes.filter((n) => n !== drag.note);
        drag = null;
        this.saveSong(this.roll.song);
        this.drawRoll();
        this.updateMeter();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
  }

  updateMeter() {
    const song = this.song();
    const m = document.querySelector('.cmp-size');
    if (!song || !m) return;
    const size = encodeSong(song).length;
    m.textContent = `${(size / 1024).toFixed(1)} of ${SIZE_LIMIT / 1024} KB`;
    m.classList.toggle('over', size > SIZE_LIMIT);
  }

  // ---- playback ------------------------------------------------------------------------------

  togglePlay() { if (this.playing) this.stop(); else this.play(); }

  play() {
    const song = this.song();
    if (!song) return;
    this.stop();
    const seq = this.engine.installSong(encodeSong(song), song.bank, true);
    if (seq < 0) { this.toast('This song is too long for the game', 'x'); return; }
    this.engine.previewMusic(seq);
    // the game starts the song a moment later (audio buffered ahead)
    this.playing = { song, t0: performance.now() + 90 };
    const tick = () => {
      if (!this.playing) return;
      this.drawRoll();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
    if (this.tab === 'music') { this.renderMusicSide(); const b = document.querySelector('.cmp-play'); if (b) b.innerHTML = `${icon('stop', 'sm')}Stop`; }
  }

  restartPreview() {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => { if (this.playing) this.play(); }, 350);
  }

  playPosition() {
    const { song, t0 } = this.playing;
    const steps = ((performance.now() - t0) / 1000) * (song.tempo / 60) * song.stepsPerBeat;
    return Math.max(0, steps) % songSteps(song);
  }

  stop() {
    const was = this.playing || this.gamePreview || this.auditioning || this.midiPreview;
    this.playing = null;
    this.midiPreview = false;
    this.gamePreview = null;
    this.auditioning = false;
    clearTimeout(this.auditionTimer);
    cancelAnimationFrame(this.raf);
    if (was) this.engine.stopPreview();
    const b = document.querySelector('.cmp-play');
    if (b) b.innerHTML = `${icon('play', 'sm')}Play`;
    this.drawRoll();
  }

  // An instrument (or the kit) on its own, for a moment.
  audition(song, t) {
    if (this.playing) return;
    const bank = this.bank(song);
    const s = auditionSong(bank, t.program, t.kind === 'drums');
    this.engine.previewMusic(this.engine.installSong(encodeSong(s), song.bank, true));
    this.auditioning = true;
    clearTimeout(this.auditionTimer);
    this.auditionTimer = setTimeout(() => { if (this.auditioning) { this.auditioning = false; this.engine.stopPreview(); } }, 2200);
  }

  auditionNote(song, t, pitch) {
    if (this.playing) return;
    const s = { ...song, tempo: 120, bars: 1, tracks: [{ ...t, mute: false, notes: [{ t: 0, d: 3, p: pitch, v: 105 }] }] };
    this.engine.previewMusic(this.engine.installSong(encodeSong(s), song.bank, true));
    this.auditioning = true;
    clearTimeout(this.auditionTimer);
    this.auditionTimer = setTimeout(() => { if (this.auditioning) { this.auditioning = false; this.engine.stopPreview(); } }, 700);
  }

  // ---- sound effects ---------------------------------------------------------------------------

  renderSoundSide() {
    const side = $('#ss-side');
    side.innerHTML = '';
    side.appendChild(el('div', 'ss-section', 'Your sounds'));
    const list = el('div', 'ss-list');
    for (const s of this.audio.sounds) {
      const row = el('div', `ss-row${s.id === this.soundId ? ' active' : ''}`);
      const uses = this.audio.overrides.filter((o) => o.sound === s.id).length;
      row.innerHTML = `<span class="ss-ico">${icon(s.kind === 'file' ? 'mic' : 'wave', 'sm')}</span><div class="ss-text"><b>${esc(s.name)}</b><span>${s.kind === 'file' ? 'Recording' : 'Synth'}${uses ? ` · replaces ${uses} game sound${uses > 1 ? 's' : ''}` : ''}</span></div>`;
      const play = el('button', 'btn icon ghost sm', icon('play', 'sm'));
      play.onclick = (e) => { e.stopPropagation(); this.sfx.play(s); };
      row.appendChild(play);
      row.onclick = () => { this.soundId = s.id; this.render(); };
      list.appendChild(row);
    }
    const add = el('button', 'ss-row ss-new', `<span class="ss-ico">${icon('plus', 'sm')}</span><div class="ss-text"><b>New sound</b><span>Synth, recording or file</span></div>`);
    add.onclick = () => this.newSound();
    list.appendChild(add);
    const lib = el('button', `ss-row ss-new${this.soundId === null ? ' active' : ''}`, `<span class="ss-ico">${icon('search', 'sm')}</span><div class="ss-text"><b>Game sounds</b><span>Listen to all ${this.gameSounds.length || 400} and replace any</span></div>`);
    lib.onclick = () => { this.soundId = null; this.render(); };
    list.appendChild(lib);
    side.appendChild(list);
    if (this.audio.overrides.length) {
      side.appendChild(el('div', 'ss-section', 'Replaced game sounds'));
      for (const o of this.audio.overrides) {
        const s = this.audio.sounds.find((x) => x.id === o.sound);
        const row = el('div', 'ss-row game');
        row.innerHTML = `<div class="ss-text"><b>${esc(o.name || 'Game sound')}</b><span>→ ${esc(s?.name || '?')}</span></div>`;
        const x = el('button', 'btn icon ghost sm', icon('x', 'sm'));
        x.title = 'Use the game\'s sound again';
        x.onclick = () => this.setOverrides(this.audio.overrides.filter((y) => y !== o));
        row.appendChild(x);
        side.appendChild(row);
      }
    }
  }

  newSound(preset = 'coin') {
    const sound = { id: uid(), name: PRESET_NAMES[preset] || 'Sound', kind: 'synth', synth: { ...PRESETS[preset] }, volume: 1 };
    this.audio.sounds.push(sound);
    this.soundId = sound.id;
    this.send({ type: 'sound_save', sound });
    this.render();
    this.sfx.play(sound);
    return sound;
  }

  renderSoundMain() {
    const main = $('#ss-main');
    main.innerHTML = '';
    const sound = this.sound();
    if (!sound) return this.renderGameSounds(main);
    const bar = el('div', 'cmp-bar');
    const name = el('input', 'cmp-name');
    name.value = sound.name;
    name.oninput = () => { sound.name = name.value; this.saveSound(sound); };
    name.onchange = () => this.renderSoundSide();
    const play = el('button', 'btn primary', `${icon('play', 'sm')}Play`);
    play.onclick = () => this.sfx.play(sound);
    const replace = el('button', 'btn', 'Use instead of a game sound…');
    replace.onclick = () => { this.pickFor = sound.id; this.soundId = null; this.render(); };
    const del = el('button', 'btn icon ghost', icon('trash', 'sm'));
    del.title = 'Delete sound';
    del.onclick = () => {
      this.audio.sounds = this.audio.sounds.filter((s) => s !== sound);
      this.audio.overrides = this.audio.overrides.filter((o) => o.sound !== sound.id);
      this.dropSave(sound.id);
      this.send({ type: 'audio_delete', kind: 'sound', id: sound.id });
      this.syncOverrides();
      this.soundId = null;
      this.render();
    };
    bar.append(name, play, el('div', 'spacer'), replace, del);
    main.appendChild(bar);

    const kinds = el('div', 'seg');
    for (const [k, label] of [['synth', 'Synth'], ['file', 'Recording or file']]) {
      const b = el('button', `seg-btn${sound.kind === k ? ' active' : ''}`, label);
      b.onclick = () => { sound.kind = k; if (k === 'synth' && !sound.synth) sound.synth = { ...PRESETS.coin }; this.saveSound(sound); this.renderSoundMain(); };
      kinds.appendChild(b);
    }
    main.appendChild(kinds);
    const wave = el('canvas', 'sfx-wave');
    main.appendChild(wave);
    const drawWave = async () => {
      try {
        const data = await this.sfx.samples(sound);
        const w = wave.clientWidth || 600, h = 90, dpr = Math.min(2, window.devicePixelRatio || 1);
        wave.width = w * dpr; wave.height = h * dpr;
        const g = wave.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#121216'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffb627';
        const per = Math.max(1, Math.floor(data.length / w));
        for (let x = 0; x < w; x++) {
          let mx = 0;
          for (let k = x * per; k < (x + 1) * per && k < data.length; k++) mx = Math.max(mx, Math.abs(data[k]));
          g.fillRect(x, h / 2 - mx * h * 0.48, 1, Math.max(1, mx * h * 0.96));
        }
      } catch { /* no data yet */ }
    };
    if (sound.kind === 'synth') this.synthControls(main, sound, drawWave);
    else this.fileControls(main, sound, drawWave);
    const uses = this.audio.overrides.filter((o) => o.sound === sound.id);
    if (uses.length) main.appendChild(el('div', 'sfx-uses', `Plays instead of: ${uses.map((o) => `<b>${esc(o.name)}</b>`).join(', ')}`));
    requestAnimationFrame(drawWave);
  }

  synthControls(main, sound, redraw) {
    const p = sound.synth;
    const chips = el('div', 'chip-row');
    for (const k of Object.keys(PRESETS)) {
      const c = el('button', 'chip', esc(PRESET_NAMES[k]));
      c.onclick = () => { sound.synth = { ...PRESETS[k] }; this.saveSound(sound); this.sfx.play(sound); this.renderSoundMain(); };
      chips.appendChild(c);
    }
    const rnd = el('button', 'chip accent', 'Random');
    rnd.onclick = () => { sound.synth = randomSynth(); this.saveSound(sound); this.sfx.play(sound); this.renderSoundMain(); };
    const mut = el('button', 'chip accent', 'Vary it');
    mut.onclick = () => { sound.synth = mutateSynth(sound.synth); this.saveSound(sound); this.sfx.play(sound); this.renderSoundMain(); };
    chips.append(rnd, mut);
    main.appendChild(chips);
    const form = el('div', 'sfx-form');
    const waveSel = el('label', 'sfx-field', '<span>Wave</span>');
    const ws = el('select');
    ws.innerHTML = WAVES.map((w) => `<option ${w === p.wave ? 'selected' : ''}>${w}</option>`).join('');
    ws.onchange = () => { p.wave = ws.value; changed(); };
    waveSel.appendChild(ws);
    form.appendChild(waveSel);
    const changed = () => { this.saveSound(sound); redraw(); clearTimeout(this.sfxTimer); this.sfxTimer = setTimeout(() => this.sfx.play(sound), 120); };
    const slider = (label, key, min, max, step, fmt = (v) => v) => {
      const f = el('label', 'sfx-field', `<span>${label}</span>`);
      const r = el('input');
      Object.assign(r, { type: 'range', min, max, step, value: p[key] });
      const out = el('b', '', fmt(p[key]));
      r.oninput = () => { p[key] = Number(r.value); out.textContent = fmt(p[key]); };
      r.onchange = changed;
      f.append(r, out);
      form.appendChild(f);
    };
    const hz = (v) => `${Math.round(v)} Hz`, sec = (v) => `${Math.round(v * 1000)} ms`;
    slider('Start pitch', 'freq', 40, 3000, 1, hz);
    slider('End pitch', 'freqEnd', 40, 3000, 1, hz);
    slider('Attack', 'attack', 0, 0.5, 0.005, sec);
    slider('Hold', 'sustain', 0, 1, 0.005, sec);
    slider('Fade out', 'decay', 0.01, 1.5, 0.005, sec);
    slider('Jump', 'jump', 0.5, 2.5, 0.005, (v) => `×${v.toFixed(2)}`);
    slider('Jump at', 'jumpAt', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    slider('Vibrato', 'vibrato', 0, 1, 0.01, (v) => v.toFixed(2));
    slider('Vibrato speed', 'vibratoSpeed', 1, 40, 0.5, (v) => `${v} Hz`);
    slider('Brightness', 'filter', 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    if (p.wave === 'square') slider('Pulse width', 'duty', 0.05, 0.5, 0.01, (v) => `${Math.round(v * 100)}%`);
    slider('Volume', 'volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
    main.appendChild(form);
  }

  fileControls(main, sound, redraw) {
    const row = el('div', 'btn-row sfx-file');
    const file = el('input');
    Object.assign(file, { type: 'file', accept: 'audio/*', hidden: true });
    const up = el('button', 'btn', `${icon('upload', 'sm')}Choose a file`);
    up.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 1.5e6) { this.toast('That file is too big (1.5 MB at most)', 'x'); return; }
      sound.data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
      if (/^Sound|^New/.test(sound.name)) sound.name = f.name.replace(/\.\w+$/, '').slice(0, 40);
      this.saveSound(sound);
      this.sfx.play(sound);
      this.renderSoundMain();
    };
    const rec = el('button', 'btn', `${icon('mic', 'sm')}${this.recorder ? 'Stop recording' : 'Record'}`);
    rec.onclick = () => this.toggleRecord(sound, rec);
    row.append(up, file, rec);
    main.appendChild(row);
    main.appendChild(el('div', 'sfx-note', sound.data ? 'Plays as recorded. Record again or choose another file to replace it.' : 'Record up to 5 seconds with your microphone, or choose a sound file (mp3, wav, ogg).'));
    redraw();
  }

  async toggleRecord(sound, btn) {
    if (this.recorder) { this.recorder.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { this.toast('No microphone access', 'x'); return; }
    const chunks = [];
    const rec = new MediaRecorder(stream);
    this.recorder = rec;
    btn.innerHTML = `${icon('stop', 'sm')}Stop recording`;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      this.recorder = null;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      sound.data = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
      this.saveSound(sound);
      this.sfx.play(sound);
      this.renderSoundMain();
    };
    rec.start();
    setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 5000);
  }

  // The game's sounds: listen, and replace any with one of yours.
  renderGameSounds(main) {
    const pick = this.pickFor && this.audio.sounds.find((s) => s.id === this.pickFor);
    main.appendChild(el('div', 'ss-empty-title', pick ? `Which game sound should “${esc(pick.name)}” replace?` : 'Game sounds'));
    main.appendChild(el('div', 'ss-empty-sub', pick ? 'Pick one below. It plays your sound from now on, everywhere in the game.' : 'Listen to the game\'s sound effects. Replace any of them with a sound you make: it then plays everywhere the game uses it.'));
    const bar = el('div', 'gs-bar');
    const q = el('input', 'gs-search');
    q.placeholder = 'Search: coin, jump, door, explosion…';
    q.value = this.soundQuery || '';
    const groups = ['All', ...new Set(this.gameSounds.map((s) => s.group))];
    const gsel = el('select');
    gsel.innerHTML = groups.map((g) => `<option ${g === (this.soundGroup || 'All') ? 'selected' : ''}>${g}</option>`).join('');
    bar.append(q, gsel);
    if (pick) { const cancel = el('button', 'btn sm ghost', 'Cancel'); cancel.onclick = () => { this.pickFor = null; this.soundId = pick.id; this.render(); }; bar.appendChild(cancel); }
    main.appendChild(bar);
    const list = el('div', 'gs-list');
    main.appendChild(list);
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      this.soundQuery = q.value;
      this.soundGroup = gsel.value;
      list.innerHTML = '';
      const hits = this.gameSounds.filter((s) => (gsel.value === 'All' || s.group === gsel.value) && (!term || `${s.name} ${s.group}`.toLowerCase().includes(term))).slice(0, 200);
      for (const s of hits) {
        const row = el('div', 'gs-row');
        const replaced = this.audio.overrides.find((o) => sameSound(o.bits, s.bits));
        row.innerHTML = `<div class="ss-text"><b>${esc(s.name)}</b><span>${esc(s.group)}${replaced ? ` · replaced by ${esc(this.audio.sounds.find((x) => x.id === replaced.sound)?.name || '?')}` : ''}</span></div>`;
        const play = el('button', 'btn icon ghost sm', icon('play', 'sm'));
        play.title = 'Listen (the game\'s sound)';
        play.onclick = () => this.engine.playGameSound(s.bits);
        const use = el('button', `btn sm ${pick ? 'primary' : 'ghost'}`, pick ? 'Replace' : 'Replace…');
        use.onclick = () => {
          const target = pick || this.newSound(/coin/i.test(s.name) ? 'coin' : /jump|hoo|wah/i.test(s.name) ? 'jump' : /explo/i.test(s.name) ? 'explosion' : 'blip');
          const rest = this.audio.overrides.filter((o) => !sameSound(o.bits, s.bits));
          this.setOverrides([...rest, { bits: s.bits, sound: target.id, name: `${s.group}: ${s.name}` }]);
          this.toast(`${s.name} now plays “${target.name}”`, 'volume');
          this.pickFor = null;
          this.soundId = target.id;
          this.render();
        };
        row.append(play, use);
        list.appendChild(row);
      }
      if (!hits.length) list.appendChild(el('div', 'edits-empty', 'No sound matches.'));
    };
    q.oninput = draw;
    gsel.onchange = draw;
    draw();
  }

  // ---- replaced game sounds in the engine --------------------------------------------------

  setOverrides(list) {
    this.audio.overrides = list;
    this.send({ type: 'overrides_save', overrides: list });
    this.syncOverrides();
    if (this.tab === 'sounds') this.renderSoundSide();
  }

  syncOverrides() {
    if (!this.engine.ready) return;
    this.engine.setSoundOverrides(this.audio.overrides.map((o, i) => ({ bits: o.bits, id: i })));
    this.syncReplacements();
  }

  onGameSound(id, dist) {
    const o = this.audio.overrides[id];
    const s = o && this.audio.sounds.find((x) => x.id === o.sound);
    if (s) this.sfx.play(s, dist);
  }
}
