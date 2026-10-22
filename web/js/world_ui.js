// The World tab of build mode and everything around it: areas of a custom level,
// placing doors / pipes / paintings / warp zones / water boxes, linking a warp by
// clicking its destination in the target area, the area's environment (fog, light,
// weather, camera, sound, death height) and the hack's flow (start, hub, star goal).
// The world map (world_map.js) shows how it all connects.
import { icon } from './icons.js';
import { TEMPLATES } from './templates.js';
import { World } from './world.js';
import { WorldMap } from './world_map.js';
import { levelPicture, templatePicture } from './pictures.js';
import {
  STUDIO_LEVEL, MAX_AREAS, CAMERA_MODES, CAMERA_LABELS, WEATHER, WEATHER_LABELS, AMBIENT, PICTURES, DOOR_STYLES, ZONES,
  areaKeyOf, parseKey, imageToRgba16, makeAreaTemplate,
} from './worldflow.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toHex = (c, d = '#ffffff') => (typeof c === 'string' ? c : c == null ? d : `#${(c >>> 0).toString(16).padStart(6, '0')}`);
const yawDeg = (y) => Math.round((((y | 0) & 0xffff) / 65536) * 360);

// The warp palette: what you can place, and how it sits where you click.
const PLACE = [
  { kind: 'door', label: 'Door', ic: 'door', help: 'A door. Link it to another door to walk between areas or levels.' },
  { kind: 'door', label: 'Star door', ic: 'star', opts: { style: 'star', stars: 1 }, help: 'Opens only with enough stars (you set how many).' },
  { kind: 'door', label: 'Key door', ic: 'door', opts: { style: 'key', key: 0 }, help: 'Needs a key (place one with Key).' },
  { kind: 'key', label: 'Key', ic: 'sparkles', help: 'A key Mario collects. Key doors with its number open with it.' },
  { kind: 'pipe', label: 'Warp pipe', ic: 'pipe', help: 'Mario jumps in and comes out at the destination.' },
  { kind: 'painting', label: 'Painting', ic: 'image', help: 'Jump into it, like the castle\'s paintings.' },
  { kind: 'zone', label: 'Warp zone', ic: 'zap', help: 'An invisible box: walking in warps Mario away.' },
  { kind: 'arrival', label: 'Arrival point', ic: 'crosshair', help: 'Where Mario comes out. Warps can lead here.' },
  { kind: 'exit', label: 'Level exit', ic: 'route', help: 'Leaves the level (back to the hub).' },
  { kind: 'cannon', label: 'Cannon', ic: 'rocket', help: 'Mario climbs in, aims and is shot out.' },
];
const ZONE_PLACE = [
  { kind: 'death', label: 'Death zone', ic: 'alert' },
  { kind: 'camera', label: 'Camera zone', ic: 'eye' },
  { kind: 'water', label: 'Water box', ic: 'wave' },
  { kind: 'gas', label: 'Toxic gas', ic: 'globe' },
  { kind: 'lava', label: 'Lava pool', ic: 'zap' },
  { kind: 'quicksand', label: 'Quicksand', ic: 'layers' },
];
const AREA_TEMPLATES = [
  { id: 'room', label: 'Room', sub: 'Walls, floor and ceiling' },
  { id: 'castle_room', label: 'Castle hall', sub: 'Checkered floor, stone walls' },
  { id: 'house', label: 'Small house', sub: 'Wooden cabin inside' },
  { id: 'cave', label: 'Cave', sub: 'Dark rock, fog and a drone' },
  { id: 'void', label: 'Empty', sub: 'One platform in the sky' },
  ...Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, sub: 'Outdoor level', level: true })),
];

export class WorldUI {
  constructor({ flow, engine, world, editor, editorUI, levelsUI, catalog, send, toast, getLevels, getThumbs }) {
    Object.assign(this, { flow, engine, world, editor, editorUI, levelsUI, catalog, send, toast, getLevels, getThumbs });
    this.tool = null;          // { kind, opts } while placing
    this.hover = null;
    this.picking = null;       // { fromKey, uid, to, back } while choosing a warp's destination
    this.map = new WorldMap({ flow, ui: this, getThumbs, toast });
    editorUI.worldInspector = this;
    flow.ui = this;
    (editor.drawHooks ||= []).push((ed, g, recs) => this.draw(ed, g, recs));
    this.buildTab();
    this.bindMouse();
    flow.on(() => this.render());
    engine.on('area', () => setTimeout(() => { this.render(); this.onArrivedForPick(); }, 50));
    this.addLauncherButton();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (this.tool || this.picking)) { e.preventDefault(); e.stopPropagation(); this.cancelTool(); if (this.picking) this.cancelPick(); }
    }, true);
  }

  // ---- the tab ------------------------------------------------------------------------

  buildTab() {
    const tabs = $('#library .lib-tabs');
    if (!tabs || $('#lib-world')) return;
    const t = el('button', 'lib-tab', 'World');
    t.dataset.lib = 'world';
    t.title = 'Areas, doors and warps, environment, hub and the world map';
    tabs.appendChild(t);
    const pane = el('div', 'lib-pane wd-pane');
    pane.id = 'lib-world';
    pane.hidden = true;
    $('#library').appendChild(pane);
    t.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach((x) => x.classList.toggle('active', x === t));
      if (this.editor?.sel) this.editor.select(null);
      document.querySelectorAll('#library > .lib-pane').forEach((p) => { p.hidden = p.id !== 'lib-world'; });
      this.render();
    });
    this.pane = pane;
    this.render();
  }

  open() {
    if (!this.editor.active) this.editor.enter();
    document.querySelector('.lib-tab[data-lib=world]')?.click();
  }

  render() {
    const pane = this.pane;
    if (!pane) return;
    const e = this.engine;
    if (!e.ready) { pane.innerHTML = ''; return; }
    const custom = e.level === STUDIO_LEVEL;
    const here = this.flow.here();
    const env = this.world.settings().env || {};
    const f = this.flow.flow();
    const scroll = pane.scrollTop;
    pane.innerHTML = '';

    // where we are + map
    const head = el('div', 'wd-head');
    head.innerHTML = `<div class="wd-where"><span class="wd-dot"></span><div><div class="wd-where-t">${esc(this.flow.areaName(here))}</div>
      <div class="wd-where-s">${custom ? `Area ${e.area} of ${this.flow.areasOf(e.customLevel).length}` : 'Original level'}${this.isHub(here) ? ' · Hub' : ''}${this.isStart(here) ? ' · Start' : ''}</div></div></div>
      <button class="btn sm" data-a="map">${icon('route', 'sm')}World map</button>`;
    head.querySelector('[data-a=map]').onclick = () => this.map.open();
    pane.appendChild(head);

    // areas
    pane.appendChild(this.section('Areas', custom ? this.areasBox(e.customLevel) : el('div', 'wd-note', 'Original levels keep their own areas. Make a custom level (Ctrl+K → New level) to add rooms, caves and buildings to it.'), 'areas'));

    // place
    const grid = el('div', 'wd-grid');
    for (const p of PLACE) grid.appendChild(this.placeBtn(p, p.kind, p.opts));
    const zgrid = el('div', 'wd-grid');
    for (const z of ZONE_PLACE) zgrid.appendChild(this.placeBtn({ ...z, help: ZONES[z.kind].help }, z.kind));
    const placeBox = el('div');
    placeBox.append(grid, el('div', 'wd-sub', 'Zones'), zgrid,
      el('div', 'lib-tip', 'Click one, then click in the level (on a wall for doors and paintings). Select a warp to choose where it leads: <b>Link…</b> takes you there to click the spot.'));
    pane.appendChild(this.section('Doors, warps & zones', placeBox, 'place'));

    // warps in this area
    pane.appendChild(this.section('Warps here', this.warpList(), 'warps'));

    // environment
    pane.appendChild(this.section('Environment of this area', this.envBox(env, custom), 'env'));

    // flow
    pane.appendChild(this.section('Hack flow', this.flowBox(f), 'flow'));
    pane.scrollTop = scroll;
  }

  section(title, body, id) {
    const closed = this.closed?.has(id);
    const s = el('div', `wd-sec${closed ? ' closed' : ''}`);
    const h = el('button', 'wd-sec-h', `<span>${esc(title)}</span><svg class="i sm" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`);
    h.onclick = () => { (this.closed ||= new Set()); if (this.closed.has(id)) this.closed.delete(id); else this.closed.add(id); s.classList.toggle('closed'); };
    s.append(h, el('div', 'wd-sec-b'));
    s.lastChild.appendChild(body);
    return s;
  }

  placeBtn(p, kind, opts) {
    const b = el('button', 'wd-item', `${icon(p.ic, 'sm')}<span>${esc(p.label)}</span>`);
    b.title = p.help || '';
    b.dataset.kind = kind;
    if (this.tool && this.tool.kind === kind && this.tool.label === p.label) b.classList.add('active');
    b.onclick = () => this.startTool({ kind, opts: opts || {}, label: p.label });
    return b;
  }

  areasBox(levelId) {
    const box = el('div', 'wd-areas');
    const areas = this.flow.areasOf(levelId);
    for (const a of areas) {
      const cur = a.index === this.engine.area;
      const key = areaKeyOf({ custom: levelId, area: a.index });
      const row = el('div', `wd-area${cur ? ' current' : ''}`);
      const thumb = this.getThumbs()[key];
      row.innerHTML = `<div class="wd-area-pic"${thumb ? ` style="background-image:url(${thumb})"` : ''}>${thumb ? '' : a.index}</div>
        <div class="wd-area-t"><b>${esc(a.name)}</b><span>${cur ? 'You are here' : `Area ${a.index}`}</span></div>`;
      const menu = el('button', 'btn icon ghost sm', icon('list', 'sm'));
      menu.title = 'Rename, delete';
      menu.onclick = (ev) => { ev.stopPropagation(); this.areaMenu(levelId, a, menu); };
      row.appendChild(menu);
      row.onclick = () => { if (!cur) this.flow.goArea({ custom: levelId, area: a.index }); };
      box.appendChild(row);
    }
    if (areas.length < MAX_AREAS) {
      const add = el('button', 'wd-area add', `${icon('plus', 'sm')}<span>New area</span>`);
      add.onclick = () => this.newAreaDialog(levelId);
      box.appendChild(add);
    }
    return box;
  }

  areaMenu(levelId, a, anchor) {
    const items = [['Rename', async () => {
      const name = await this.ask('Rename area', a.name);
      if (name) { this.flow.renameArea(levelId, a.index, name); this.toast('Renamed', 'check'); }
    }]];
    if (a.index > 1) items.push(['Delete', async () => {
      if (!await this.confirm(`Delete “${a.name}”?`, 'Everything in this area is removed. Warps that lead here stop working.')) return;
      if (this.engine.area === a.index) this.flow.goArea({ custom: levelId, area: 1 });
      this.flow.deleteArea(levelId, a.index);
    }, true]);
    this.popMenu(anchor, items);
  }

  newAreaDialog(levelId) {
    const back = $('#modal-back');
    const m = $('#modal');
    m.classList.add('wd-modal');
    m.innerHTML = `<h2>New area</h2><p>An area is a separate space of this level: the inside of a building, a cave, a secret room. Doors, pipes and warp zones connect it.</p>
      <div class="field"><input type="text" id="wd-area-name" value="Area ${this.flow.areasOf(levelId).length + 1}" maxlength="60"></div>
      <div class="wd-tpl-grid">${AREA_TEMPLATES.map((t, i) => `<button class="wd-tpl${i === 0 ? ' active' : ''}" data-t="${t.id}">${t.level && templatePicture(t.id) ? `<img alt="" src="${templatePicture(t.id)}">` : `<div class="wd-tpl-ic">${icon(t.id === 'cave' ? 'mountain' : t.id === 'void' ? 'globe' : 'cube')}</div>`}<b>${esc(t.label)}</b><span>${esc(t.sub)}</span></button>`).join('')}</div>
      <label class="wd-check"><input type="checkbox" id="wd-area-door" checked> Add a door here that leads into it</label>
      <div class="actions"><button class="btn" id="wd-area-no">Cancel</button><button class="btn primary" id="wd-area-ok">Create area</button></div>`;
    back.hidden = false;
    let tpl = 'room';
    m.querySelectorAll('.wd-tpl').forEach((b) => { b.onclick = () => { tpl = b.dataset.t; m.querySelectorAll('.wd-tpl').forEach((x) => x.classList.toggle('active', x === b)); }; });
    const close = () => { back.hidden = true; m.classList.remove('wd-modal'); };
    m.querySelector('#wd-area-no').onclick = close;
    const inp = m.querySelector('#wd-area-name');
    inp.onkeydown = (ev) => ev.stopPropagation();
    m.querySelector('#wd-area-ok').onclick = async () => {
      const name = inp.value.trim() || 'New area';
      const withDoor = m.querySelector('#wd-area-door').checked;
      close();
      try { await this.createArea(levelId, name, tpl, withDoor); } catch (err) { this.toast(err.message, 'x'); }
    };
  }

  // A new area (and a pair of doors between here and there when asked).
  async createArea(levelId, name, tpl, withDoor) {
    const f = this.flow;
    let area = makeAreaTemplate(tpl);
    if (!area) area = World.newLevelArea(tpl);
    let doorIn = null, doorOut = null;
    const fromKey = this.engine.areaKey();
    if (withDoor) {
      // the door back out, just inside the new area by its spawn
      const sp = area.settings?.spawn || { x: 0, y: 0, z: 0, yaw: 0 };
      const yaw = sp.yaw || 0;
      const a = (yaw / 32768) * Math.PI;
      const groundY = area.terrain ? 0 : Math.max(0, sp.y - 150);
      doorOut = f.makeWarpRecord('door', { x: sp.x - Math.sin(a) * 350, y: groundY, z: sp.z - Math.cos(a) * 350, yaw, style: 'wood' });
      area.objects.push(doorOut);
    }
    this.toast(`Creating “${name}”…`, 'build');
    const made = await f.createArea(levelId, { name, template: tpl, area });
    const newKey = areaKeyOf({ custom: levelId, area: made.index });
    if (withDoor) {
      // and the door into it, in front of the camera here
      const p = this.editor.active ? this.editor.viewCenter() : null;
      const m = this.engine.state().mario;
      const at = p || [m.x + 300, m.y, m.z];
      const cy = this.engine.floor(at[0], at[1] + 200, at[2]);
      const camYaw = this.editor.active ? Math.round((this.editor.cam.yaw / Math.PI) * 32768 + 32768) & 0xffff : (m.yaw + 0x8000) & 0xffff;
      doorIn = f.makeWarpRecord('door', { x: at[0], y: cy > -30000 ? cy : at[1], z: at[2], yaw: camYaw, style: 'castle', to: { custom: levelId, area: made.index, uid: doorOut.uid } });
      doorIn.bhv = 'bhvDoorWarp';
      f.addRecord(doorIn, `Door into ${name}`);
      // the inside door leads back to this one
      const out = f.patch().areas[newKey]?.objects?.find((r) => r.uid === doorOut.uid);
      if (out) f.updateRecord(newKey, doorOut.uid, { bhv: 'bhvDoorWarp', warp: { ...out.warp, to: { ...parseKey(fromKey), uid: doorIn.uid } } }, `Door back to ${f.areaName(parseKey(fromKey))}`);
    }
    this.toast(`Area “${name}” ready${withDoor ? ': walk through the door' : ''}`, 'check');
    this.render();
    return made;
  }

  warpList() {
    const box = el('div', 'wd-warps');
    const recs = this.flow.records().filter((r) => r.warp || r.zone || r.keyItem);
    if (!recs.length) { box.appendChild(el('div', 'wd-note', 'No doors, warps or zones in this area yet.')); return box; }
    for (const r of recs) {
      const w = r.warp;
      const row = el('div', 'wd-warp');
      const kind = r.zone ? ZONES[r.zone.kind]?.label : w ? { door: 'Door', pipe: 'Pipe', painting: 'Painting' }[w.kind] || 'Warp' : 'Key';
      let dest = '';
      if (w?.to) dest = `→ ${esc(this.destName(w.to))}`;
      else if (w && ['pipe', 'painting', 'zone'].includes(w.kind)) dest = '<span class="wd-warn">not linked</span>';
      else if (w?.kind === 'door') dest = '(an ordinary door)';
      const req = this.reqText(w);
      row.innerHTML = `<div class="wd-warp-t"><b>${esc(r.name || kind)}</b><span>${esc(kind)} ${dest}${req ? ` · ${esc(req)}` : ''}</span></div>`;
      const sel = el('button', 'btn icon ghost sm', icon('crosshair', 'sm'));
      sel.title = 'Select it';
      sel.onclick = () => this.selectUid(r.uid, true);
      row.appendChild(sel);
      if (w && w.kind !== 'arrival' && w.to && !w.to.hub) {
        const go = el('button', 'btn icon ghost sm', icon('door', 'sm'));
        go.title = 'Go to the destination';
        go.onclick = () => this.goTo(w.to);
        row.appendChild(go);
      }
      box.appendChild(row);
    }
    return box;
  }

  reqText(w) {
    if (!w) return '';
    const parts = [];
    if (w.stars) parts.push(`★ ${w.stars}`);
    if (Number.isInteger(w.key) && w.key >= 0) parts.push(`key ${w.key + 1}`);
    if (w.locked) parts.push('locked');
    return parts.join(' · ');
  }

  destName(to) {
    if (!to) return 'nowhere';
    if (to.hub) return 'the hub';
    const t = to.uid ? this.flow.findRecord(to.uid) : null;
    return `${this.flow.areaName(to)}${t ? ` (${t.rec.name})` : ''}`;
  }

  envBox(env, custom) {
    const box = el('div', 'wd-env');
    const fog = env.fog || {};
    const light = env.light || {};
    const cam = env.camera || {};
    box.innerHTML = `
      <div class="wd-row"><label class="wd-check"><input type="checkbox" data-k="fog.on" ${fog.on ? 'checked' : ''}> Fog</label>
        <input type="color" data-k="fog.color" value="${toHex(fog.color, '#b8c8e0')}" title="Fog colour"></div>
      <div class="wd-range"><span>Starts</span><input type="range" min="0" max="12000" step="100" data-k="fog.near" value="${fog.near ?? 1500}"><b>${fog.near ?? 1500}</b></div>
      <div class="wd-range"><span>Thick at</span><input type="range" min="500" max="30000" step="250" data-k="fog.far" value="${fog.far ?? 9000}"><b>${fog.far ?? 9000}</b></div>
      <div class="wd-sub">Light</div>
      <div class="wd-row"><span>Sun colour</span><input type="color" data-k="light.color" value="${toHex(light.color)}"><span>Tint</span><input type="color" data-k="light.tint" value="${toHex(light.tint)}" title="Colours the whole scene (night, dusk, caves)"></div>
      <div class="wd-range"><span>Sun from</span><input type="range" min="0" max="359" step="1" data-k="light.yaw" value="${light.yaw ?? 45}"><b>${light.yaw ?? 45}°</b></div>
      <div class="wd-range"><span>Sun height</span><input type="range" min="5" max="90" step="1" data-k="light.pitch" value="${light.pitch ?? 57}"><b>${light.pitch ?? 57}°</b></div>
      <div class="wd-range"><span>Ambient</span><input type="range" min="0" max="1" step="0.02" data-k="light.ambient" value="${light.ambient ?? 0.42}"><b>${Math.round((light.ambient ?? 0.42) * 100)}%</b></div>
      <div class="wd-sub">Sky, weather & sound</div>
      <label class="wd-field"><span>Weather</span><select data-k="weather">${WEATHER.map((w) => `<option value="${w}" ${(env.weather || 'none') === w ? 'selected' : ''}>${esc(WEATHER_LABELS[w])}</option>`).join('')}</select></label>
      <label class="wd-field"><span>Ambient sound</span><select data-k="ambient"><option value="">None</option>${Object.entries(AMBIENT).filter(([, v]) => v).map(([k, v]) => `<option value="${k}" ${env.ambient === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <div class="wd-sub">Camera</div>
      <label class="wd-field"><span>Mode</span><select data-k="camera.mode">${CAMERA_MODES.map((c) => `<option value="${c}" ${(cam.mode || 'default') === c ? 'selected' : ''}>${esc(CAMERA_LABELS[c])}</option>`).join('')}</select></label>
      ${cam.mode === 'fixed' ? `<div class="btn-row"><button class="btn sm" data-a="camfix">Camera stands where I look from</button></div>` : ''}
      ${cam.mode === 'side' ? `<div class="wd-range"><span>Looks along</span><input type="range" min="0" max="359" step="5" data-k="camera.axis" value="${cam.axis ?? 0}"><b>${cam.axis ?? 0}°</b></div>` : ''}
      ${cam.mode === 'side' || cam.mode === 'top' ? `<div class="wd-range"><span>Distance</span><input type="range" min="400" max="4000" step="50" data-k="camera.dist" value="${cam.dist ?? 1400}"><b>${cam.dist ?? 1400}</b></div>` : ''}
      <div class="wd-sub">Falling</div>
      <div class="wd-row"><label class="wd-check"><input type="checkbox" data-k="death.on" ${Number.isFinite(env.deathY) ? 'checked' : ''}> Falling below</label>
        <input type="number" class="wd-num" data-k="deathY" value="${Number.isFinite(env.deathY) ? env.deathY : -1000}" step="100" ${Number.isFinite(env.deathY) ? '' : 'disabled'}></div>
      <div class="wd-row wd-fall"><span>leads to</span><b>${env.fallTo ? esc(this.destName(env.fallTo)) : 'losing a life'}</b>
        <button class="btn sm" data-a="fallto">${env.fallTo ? 'Change' : 'Another area…'}</button>${env.fallTo ? '<button class="btn icon ghost sm" data-a="fallclear" title="Back to losing a life">' + icon('x', 'sm') + '</button>' : ''}</div>`;
    const set = (k, v, summary) => {
      const [a, b] = k.split('.');
      if (b) this.flow.setEnv({ [a]: { ...(env[a] || {}), [b]: v } }, summary);
      else this.flow.setEnv({ [a]: v }, summary);
    };
    box.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      if (inp.type === 'range') {
        const out = inp.nextElementSibling;
        inp.oninput = () => {
          const v = Number(inp.value);
          if (out) out.textContent = k === 'light.ambient' ? `${Math.round(v * 100)}%` : k.includes('yaw') || k.includes('pitch') || k.includes('axis') ? `${v}°` : v;
          // live preview without saving
          const [a, b] = k.split('.');
          const tmp = { ...env, [a]: { ...(env[a] || {}), [b]: v } };
          this.flow.applyEnv(tmp, custom);
          if (a === 'light' && custom && this.world.terrain) this.engine.terrainBuild(1, 0, 0, -1, -1, false);
        };
        inp.onchange = () => set(k, Number(inp.value), 'Changed the environment');
      } else if (inp.type === 'checkbox') {
        inp.onchange = () => {
          if (k === 'death.on') this.flow.setEnv({ deathY: inp.checked ? Number(box.querySelector('[data-k=deathY]').value) : null }, inp.checked ? 'Set a death height' : 'Removed the death height');
          else set(k, inp.checked, inp.checked ? 'Turned on fog' : 'Turned off fog');
        };
      } else if (inp.type === 'color') {
        inp.oninput = () => { const [a, b] = k.split('.'); this.flow.applyEnv({ ...env, [a]: { ...(env[a] || {}), [b]: inp.value } }, custom); if (a === 'light' && custom && this.world.terrain) this.engine.terrainBuild(1, 0, 0, -1, -1, false); };
        inp.onchange = () => set(k, inp.value, 'Changed a colour');
      } else if (inp.tagName === 'SELECT') {
        inp.onchange = () => {
          if (k === 'camera.mode') {
            const mode = inp.value;
            const c = { ...(env.camera || {}), mode };
            if (mode === 'fixed' && c.x === undefined) { const cp = this.engine.camOut().pos; Object.assign(c, { x: Math.round(cp[0]), y: Math.round(cp[1]), z: Math.round(cp[2]) }); }
            this.flow.setEnv({ camera: mode === 'default' ? null : c }, 'Changed the camera');
          } else set(k, inp.value || null, k === 'weather' ? `Weather: ${WEATHER_LABELS[inp.value]}` : 'Changed the ambient sound');
        };
      } else if (k === 'deathY') {
        inp.onchange = () => {
          // an empty field is not height 0 (that would kill Mario on most grounds)
          if (inp.value.trim() === '' || !Number.isFinite(Number(inp.value))) { inp.value = env.deathY ?? inp.defaultValue; return; }
          this.flow.setEnv({ deathY: Number(inp.value) }, 'Changed the death height');
        };
      }
    });
    box.querySelector('[data-a=camfix]')?.addEventListener('click', () => {
      const cp = this.engine.camOut().pos;
      this.flow.setEnv({ camera: { ...(env.camera || {}), mode: 'fixed', x: Math.round(cp[0]), y: Math.round(cp[1]), z: Math.round(cp[2]) } }, 'Placed the fixed camera');
      this.toast('The camera will watch from here', 'check');
    });
    box.querySelector('[data-a=fallto]').onclick = () => this.chooseDestination({ title: 'Falling off leads to…', onPick: (to) => this.flow.setEnv({ fallTo: to }, `Falling leads to ${this.destName(to)}`), allowHub: true });
    box.querySelector('[data-a=fallclear]')?.addEventListener('click', () => this.flow.setEnv({ fallTo: null }, 'Falling costs a life again'));
    return box;
  }

  flowBox(f) {
    const box = el('div', 'wd-flow');
    const here = this.flow.here();
    const startName = f.start ? this.flow.areaName(f.start) : 'The castle (the game\'s start)';
    const hubName = f.hub ? this.flow.areaName(f.hub) : 'The castle';
    box.innerHTML = `
      <div class="wd-flowrow"><div>${icon('play', 'sm')}<div><span>Start</span><b>${esc(startName)}</b></div></div>
        <button class="btn sm" data-a="start">Start here</button>${f.start ? `<button class="btn icon ghost sm" data-a="start-x" title="Start in the castle again">${icon('x', 'sm')}</button>` : ''}</div>
      <div class="wd-flowrow"><div>${icon('compass', 'sm')}<div><span>Hub</span><b>${esc(hubName)}</b></div></div>
        <button class="btn sm" data-a="hub">Make this the hub</button>${f.hub ? `<button class="btn icon ghost sm" data-a="hub-x" title="Back to the castle as hub">${icon('x', 'sm')}</button>` : ''}</div>
      <div class="wd-note">Stars, deaths and <i>Exit course</i> bring Mario back to the hub, in front of the door or painting he left through. With your own start and hub the hack never visits the castle.</div>
      <div class="wd-row"><span>Star goal</span><input type="number" class="wd-num" data-a="goal" min="0" max="999" value="${f.goal?.stars || ''}" placeholder="none"></div>
      <input type="text" class="wd-text" data-a="goalmsg" maxlength="160" placeholder="Message when it's reached (optional)" value="${esc(f.goal?.message || '')}">
      <div class="btn-row"><button class="btn sm primary" data-a="playstart">${icon('play', 'sm')}Play from the start</button>
        <label class="wd-check"><input type="checkbox" data-a="zones" ${f.hideZones ? '' : 'checked'}> Show zones</label></div>`;
    box.querySelector('[data-a=start]').onclick = () => {
      const at = this.engine.level === STUDIO_LEVEL ? { custom: this.engine.customLevel, area: this.engine.area } : { level: this.engine.level, area: this.engine.area };
      this.flow.setFlow({ start: at });
      this.toast(`The hack starts in ${this.flow.areaName(at)}`, 'check');
    };
    box.querySelector('[data-a=start-x]')?.addEventListener('click', () => this.flow.setFlow({ start: null }));
    box.querySelector('[data-a=hub]').onclick = () => {
      const at = this.engine.level === STUDIO_LEVEL ? { custom: this.engine.customLevel, area: this.engine.area } : { level: this.engine.level, area: this.engine.area };
      this.flow.setFlow({ hub: at });
      this.toast(`${this.flow.areaName(at)} is the hub`, 'check');
    };
    box.querySelector('[data-a=hub-x]')?.addEventListener('click', () => this.flow.setFlow({ hub: null }));
    const goal = box.querySelector('[data-a=goal]');
    const msg = box.querySelector('[data-a=goalmsg]');
    const saveGoal = () => { const n = Number(goal.value) | 0; this.flow.setFlow({ goal: n > 0 ? { stars: n, message: msg.value.trim() || undefined } : null }); };
    goal.onchange = saveGoal;
    msg.onchange = saveGoal;
    [goal, msg].forEach((x) => x.addEventListener('keydown', (e) => e.stopPropagation()));
    box.querySelector('[data-a=playstart]').onclick = () => this.playFromStart();
    box.querySelector('[data-a=zones]').onchange = (e) => { this.flow.setFlow({ hideZones: !e.target.checked }); this.flow.respawnZones(); };
    void here;
    return box;
  }

  isHub(at) { return this.flow.sameLevel(this.flow.flow().hub, at) && (this.flow.flow().hub.area || 1) === (at.area || 1); }
  isStart(at) { return this.flow.sameLevel(this.flow.flow().start, at) && (this.flow.flow().start.area || 1) === (at.area || 1); }

  playFromStart() {
    const s = this.flow.startTarget();
    if (this.editor.active) this.editor.exit();
    // the story runtime starts the hack (fresh save, start, opening dialog and cutscene)
    const rt = this.engine && window.studio64?.storyRuntime;
    if (rt) { rt.playFromStart(); this.toast('Playing from the start (fresh save)', 'play'); return; }
    this.world.resetProgress();
    this.flow.goalShown = false;
    this.flow.returnTo = null;
    this.levelsUI?.syncStarTotal?.();
    this.flow.pushKeys();
    if (s) this.flow.goArea(s, { intro: false });
    else this.engine.warpFast(6, 0, null, false);
    this.toast('Playing from the start (progress reset)', 'play');
  }

  goTo(to) {
    if (to.hub) { const h = this.flow.hubTarget(); if (h) this.flow.goArea(h); return; }
    this.pendingSelect = to.uid || null;
    this.flow.goArea(to);
  }

  selectUid(uid, frame = false) {
    const o = this.engine.objects().find((x) => x.uid === uid);
    if (!o) return false;
    if (!this.editor.active) this.editor.enter();
    this.editor.select(o.slot);
    if (frame) setTimeout(() => this.editor.frameSelection?.(), 30);
    return true;
  }

  // ---- placing ------------------------------------------------------------------------

  startTool(t) {
    if (!this.editor.active) this.editor.enter();
    this.editor.cancelPlacing?.();
    this.editor.cancelGenerator?.();
    this.editor.select(null);
    this.tool = t;
    this.render();
    const hint = $('#tool-hint');
    if (hint) { hint.innerHTML = `Click to place the ${esc(t.label.toLowerCase())} · <kbd>R</kbd> turn · <kbd>Esc</kbd> stop`; hint.hidden = false; }
  }

  cancelTool() {
    if (!this.tool) return;
    this.tool = null;
    this.hover = null;
    this.render();
    this.editorUI.onToolChange?.();
  }

  bindMouse() {
    const ov = $('#overlay');
    const local = (e) => { const r = ov.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    ov.addEventListener('mousemove', (e) => {
      if (!this.tool && !this.picking) return;
      const p = local(e);
      const hit = this.editor.pick(p.x, p.y, { objects: !!this.picking });
      this.hover = hit ? { hit, p } : null;
    });
    ov.addEventListener('mousedown', (e) => {
      if (!this.tool && !this.picking) return;
      if (e.button === 2 && this.tool) { e.preventDefault(); e.stopImmediatePropagation(); this.cancelTool(); return; }
      if (e.button !== 0 || e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const p = local(e);
      if (this.picking) this.pickAt(p);
      else this.placeAt(p);
    }, true);
    window.addEventListener('keydown', (e) => {
      if (!this.tool || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.code === 'KeyR') { e.preventDefault(); e.stopImmediatePropagation(); this.toolYaw = ((this.toolYaw || 0) + 0x2000) & 0xffff; }
    }, true);
  }

  // Where a kind sits for a click: doors and paintings on walls face out of them.
  poseFor(kind, hit) {
    const n = [hit.nx, hit.ny, hit.nz];
    const wall = Math.abs(n[1]) < 0.5;
    const camYaw = Math.round((this.editor.cam.yaw / Math.PI) * 32768) & 0xffff;
    let yaw = (camYaw + 0x8000 + (this.toolYaw || 0)) & 0xffff;
    let { x, y, z } = hit;
    if (wall) {
      yaw = Math.round((Math.atan2(n[0], n[2]) / Math.PI) * 32768) & 0xffff;
      const off = kind === 'painting' ? 8 : kind === 'door' ? 30 : 120;
      x += n[0] * off; z += n[2] * off;
      if (kind === 'painting') y = hit.y - 300;
      else { const fy = this.engine.floor(x, hit.y + 20, z); if (fy > -30000 && hit.y - fy < 800) y = fy; }
    }
    return { x: Math.round(x), y: Math.round(y), z: Math.round(z), yaw };
  }

  placeAt(p) {
    const t = this.tool;
    const hit = this.editor.pick(p.x, p.y, { objects: false });
    if (!hit) return;
    const pose = this.poseFor(t.kind, hit);
    try {
      const opts = { ...t.opts, ...pose };
      if (t.kind === 'death') { opts.y = pose.y - 300; }
      const rec = this.flow.makeWarpRecord(t.kind, opts);
      this.flow.addRecord(rec, `Placed ${rec.name}`);
      this.editor.lastPoint = [pose.x, pose.y, pose.z];
      this.cancelTool();
      setTimeout(() => this.selectUid(rec.uid), 60);
      if (rec.warp && ['door', 'pipe', 'painting', 'zone'].includes(rec.warp.kind) && !rec.warp.to) this.toast('Now choose where it leads: Link… in the panel', 'route');
    } catch (err) { this.toast(err.message, 'x'); }
  }

  // ---- choosing a destination ----------------------------------------------------------

  // The picker: an area, then (for warps) a click on the spot in it.
  chooseDestination({ title = 'Where does it lead?', onPick, allowHub = true, uid = null, fromKey = null }) {
    const back = $('#modal-back');
    const m = $('#modal');
    m.classList.add('wd-modal', 'wide');
    const thumbs = this.getThumbs();
    const levels = this.getLevels();
    const card = (to, name, sub, thumb) => `<button class="wd-dest" data-to='${esc(JSON.stringify(to))}'>
      <div class="wd-dest-pic"${thumb ? ` style="background-image:url(${thumb})"` : ''}></div><b>${esc(name)}</b><span>${esc(sub)}</span></button>`;
    let html = `<h2>${esc(title)}</h2><p>Pick an area. You'll go there to click where Mario comes out (or click a door or pipe there to connect both ways).</p>
      <div class="wd-dest-search"><input type="text" placeholder="Search levels…" id="wd-dest-q"></div><div class="wd-dest-list">`;
    if (allowHub) html += `<div class="wd-dest-sec">Shortcuts</div><div class="wd-dest-grid">${card({ hub: true }, 'The hub', this.flow.flow().hub ? this.flow.areaName(this.flow.flow().hub) : 'the castle')}</div>`;
    html += '<div class="wd-dest-sec">Your levels</div><div class="wd-dest-grid">';
    for (const l of levels) for (const a of this.flow.areasOf(l.id)) {
      const key = areaKeyOf({ custom: l.id, area: a.index });
      html += card({ custom: l.id, area: a.index }, l.name, this.flow.areasOf(l.id).length > 1 ? a.name : 'Custom level', thumbs[key]);
    }
    html += '</div><div class="wd-dest-sec">Original levels</div><div class="wd-dest-grid">';
    for (const l of Object.values(this.catalog.levels).filter((x) => x.num).sort((a, b) => (b.acts - a.acts) || a.name.localeCompare(b.name))) {
      html += card({ level: l.num, area: 1 }, l.name, l.acts ? 'Course' : 'Extra', thumbs[`${l.num}:1`] || levelPicture(l.num));
    }
    html += `</div></div><div class="actions"><button class="btn" id="wd-dest-no">Cancel</button></div>`;
    m.innerHTML = html;
    back.hidden = false;
    const close = () => { back.hidden = true; m.classList.remove('wd-modal', 'wide'); };
    m.querySelector('#wd-dest-no').onclick = close;
    const q = m.querySelector('#wd-dest-q');
    q.onkeydown = (e) => e.stopPropagation();
    q.oninput = () => { const s = q.value.toLowerCase(); m.querySelectorAll('.wd-dest').forEach((b) => { b.hidden = s && !b.textContent.toLowerCase().includes(s); }); };
    setTimeout(() => q.focus(), 30);
    m.querySelectorAll('.wd-dest').forEach((b) => {
      b.onclick = () => {
        const to = JSON.parse(b.dataset.to);
        close();
        if (to.hub || !uid) { onPick(to.hub ? { hub: true } : to); return; }
        this.beginPick({ to, uid, fromKey: fromKey || this.engine.areaKey(), onPick });
      };
    });
  }

  // Go to the target area in build mode and wait for a click there.
  beginPick({ to, uid, fromKey, onPick }) {
    const ed = this.editor;
    this.picking = { to, uid, fromKey, onPick, back: { ...parseKey(fromKey) }, cam: ed.active ? { ...ed.cam } : null, arrived: false };
    const targetKey = areaKeyOf(to);
    if (targetKey === this.engine.areaKey()) { this.picking.arrived = true; this.showPickBanner(); return; }
    this.flow.goArea(to);
  }

  onArrivedForPick() {
    const pk = this.picking;
    if (pk && !pk.arrived && this.engine.areaKey() === areaKeyOf(pk.to)) {
      pk.arrived = true;
      setTimeout(() => {
        if (this.picking !== pk || pk.returning || this.engine.areaKey() !== areaKeyOf(pk.to)) return;
        if (!this.editor.active) this.editor.enter();
        if (!this.levelsUI?.cams?.[this.engine.areaKey()]) this.viewFromSpawn();
        this.showPickBanner();
      }, 450);
    } else if (pk?.returning && this.engine.areaKey() === areaKeyOf(pk.back)) {
      this.picking = null;
      setTimeout(() => {
        if (!this.editor.active) this.editor.enter();
        if (pk.cam) { Object.assign(this.editor.cam, pk.cam); this.editor.pushCamera(); }
        this.selectUid(pk.uid);
      }, 500);
    }
    if (this.pendingSelect && !this.picking) { const u = this.pendingSelect; this.pendingSelect = null; setTimeout(() => { if (!this.editor.active) this.editor.enter(); this.selectUid(u, true); }, 700); }
  }

  // A first look at an area: from just above and behind its start, looking ahead and down.
  viewFromSpawn() {
    const sp = this.world.settings().spawn;
    let m = null;
    try { m = this.engine.state().mario; } catch { /* loading */ }
    const p = sp || (m ? { x: m.x, y: m.y, z: m.z, yaw: m.yaw } : null);
    if (!p) return;
    const a = (((p.yaw || 0) & 0xffff) / 32768) * Math.PI;
    const ed = this.editor;
    Object.assign(ed.cam, { x: p.x - Math.sin(a) * 250, y: p.y + 380, z: p.z - Math.cos(a) * 250, yaw: a, pitch: -0.42 });
    ed.pushCamera();
  }

  // The banner shows exactly while a destination is being clicked in its area.
  syncPickBanner() {
    const pk = this.picking;
    const want = !!(pk && pk.arrived && !pk.returning && this.engine.areaKey() === areaKeyOf(pk.to));
    const has = document.querySelectorAll('.wd-pick');
    if (!want) { has.forEach((x) => x.remove()); if (!pk) { clearInterval(this.pickTimer); this.pickTimer = null; } return; }
    if (!has.length) this.showPickBanner();
  }

  showPickBanner() {
    document.querySelectorAll('.wd-pick').forEach((x) => x.remove());
    if (!this.pickTimer) this.pickTimer = setInterval(() => this.syncPickBanner(), 300);
    const b = el('div', 'wd-pick', `${icon('crosshair', 'sm')}<span>Click where Mario comes out in <b>${esc(this.flow.areaName(this.picking.to))}</b>, or click a door or pipe to connect both ways.</span>
      <button class="btn sm" data-a="spawn">Use the level's start</button><button class="btn sm" data-a="cancel">Cancel</button>`);
    b.querySelector('[data-a=cancel]').onclick = () => this.cancelPick();
    b.querySelector('[data-a=spawn]').onclick = () => this.finishPick({ ...this.picking.to, node: undefined });
    $('#game-frame').appendChild(b);
  }

  pickAt(p) {
    const pk = this.picking;
    if (!pk?.arrived) return;
    const hit = this.editor.pick(p.x, p.y, { objects: true });
    if (!hit) return;
    const key = this.engine.areaKey();
    // a door / pipe / arrival point there
    if (hit.kind === 'object' && hit.slot >= 0) {
      const o = this.engine.objects().find((x) => x.slot === hit.slot);
      const rec = o?.uid ? this.flow.records(key).find((r) => r.uid === o.uid) : null;
      if (rec?.warp && rec.uid !== pk.uid) { this.finishPick({ ...pk.to, uid: rec.uid }); return; }
    }
    // a new arrival point where the click landed, facing the camera
    const pose = this.poseFor('arrival', hit);
    const rec = this.flow.makeWarpRecord('arrival', { ...pose, y: pose.y });
    rec.name = `Arrival from ${this.flow.areaName(pk.back)}`;
    this.flow.addRecord(rec, 'Placed an arrival point');
    this.finishPick({ ...pk.to, uid: rec.uid });
  }

  finishPick(to) {
    const pk = this.picking;
    $('#wd-pick')?.remove();
    try {
      pk.onPick(to);
    } catch (err) { this.toast(err.message, 'x'); }
    this.toast(`Linked to ${this.destName(to)}`, 'check');
    // back to where the warp is
    if (areaKeyOf(pk.back) !== this.engine.areaKey()) {
      pk.returning = true;
      this.flow.goArea(pk.back);
    } else {
      this.picking = null;
      setTimeout(() => this.selectUid(pk.uid), 100);
    }
  }

  cancelPick() {
    const pk = this.picking;
    $('#wd-pick')?.remove();
    if (!pk) return;
    if (pk.arrived && areaKeyOf(pk.back) !== this.engine.areaKey()) { pk.returning = true; this.flow.goArea(pk.back); } else this.picking = null;
  }

  linkSelected(rec) {
    const fromKey = this.engine.areaKey();
    this.chooseDestination({
      title: `Where does “${rec.name}” lead?`, uid: rec.uid, fromKey,
      onPick: (to) => this.flow.link(fromKey, rec.uid, to, { twoWay: true }),
    });
  }

  // ---- inspector ----------------------------------------------------------------------

  wants(rec) { return !!(rec && (rec.warp || rec.zone || rec.painting || rec.keyItem)); }

  html(sel, rec) {
    const w = rec.warp;
    const z = rec.zone;
    let h = '<div class="insp-sec wd-insp">';
    if (w && w.kind !== 'arrival') {
      const dest = w.to ? esc(this.destName(w.to)) : w.kind === 'door' ? 'Nowhere: an ordinary door (link it to warp)' : '<span class="wd-warn">Not linked yet</span>';
      const back = w.to?.uid ? this.flow.findRecord(w.to.uid)?.rec : null;
      const twoWay = back?.warp?.to?.uid === rec.uid;
      h += `<div class="insp-label">Leads to</div><div class="wd-dest-now">${icon('route', 'sm')}<span>${dest}${twoWay ? ' <i>(both ways)</i>' : ''}</span></div>
        <div class="btn-row"><button class="btn sm primary" data-w="link">${w.to ? 'Change…' : 'Link…'}</button>
        ${w.to && !w.to.hub ? `<button class="btn sm" data-w="go">Go there</button>` : ''}
        ${w.to ? `<button class="btn sm" data-w="unlink">Unlink</button>` : ''}
        ${!w.to?.hub ? `<button class="btn sm" data-w="tohub">To the hub</button>` : ''}</div>`;
    }
    if (w?.kind === 'arrival') {
      const from = this.flow.allWarps().filter((x) => x.to?.uid === rec.uid);
      h += `<div class="insp-label">Arrival point</div><div class="wd-note">${from.length ? `Reached from: ${from.map((x) => esc(x.name || x.kind)).join(', ')}` : 'No warp leads here yet.'}</div>
        <label class="wd-field"><span>Mario arrives</span><select data-z="spawn">${[['walk', 'Standing'], ['spin', 'Spinning down'], ['fall', 'Falling in']].map(([v, l]) => `<option value="${v}" ${(z?.spawn || 'walk') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    }
    if (w?.kind === 'door') {
      h += `<label class="wd-field"><span>Door</span><select data-w="style">${DOOR_STYLES.map((d) => `<option value="${d.id}" ${w.style === d.id ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>`;
    }
    if (w && ['door', 'pipe', 'painting', 'zone'].includes(w.kind)) {
      h += `<div class="insp-label">Needs</div><div class="wd-req">
        <label>${icon('star', 'sm')}<input type="number" min="0" max="999" data-w="stars" value="${w.stars || 0}" title="Stars needed"></label>
        <label>${icon('sparkles', 'sm')}<select data-w="key"><option value="-1">No key</option>${Array.from({ length: 8 }, (_, i) => `<option value="${i}" ${w.key === i ? 'selected' : ''}>Key ${i + 1}</option>`).join('')}</select></label>
        <label class="wd-check"><input type="checkbox" data-w="locked" ${w.locked ? 'checked' : ''}> Locked</label></div>
        <div class="wd-note">${w.stars ? `Shows “you need ${w.stars} star${w.stars === 1 ? '' : 's'}” until Mario has them. ` : ''}Locked doors open when an event unlocks them (uid ${rec.uid}).</div>`;
    }
    if (rec.painting) {
      const pics = this.flow.flow().pictures || {};
      h += `<div class="insp-label">Picture</div><div class="wd-pics">${PICTURES.map((p) => `<button class="wd-pic${rec.painting.picture === p.id ? ' active' : ''}" data-pic="${p.id}" title="${esc(p.label)}"><span>${esc(p.id.toUpperCase())}</span></button>`).join('')}
        ${Object.entries(pics).map(([id, p]) => `<button class="wd-pic${rec.painting.picture === id ? ' active' : ''}" data-pic="${esc(id)}" title="${esc(p.name || 'Your picture')}" style="background-image:url(${esc(p.data)})"></button>`).join('')}
        <button class="wd-pic add" data-w="upload" title="Use your own picture">${icon('upload', 'sm')}</button></div>`;
    }
    if (z && z.kind === 'warp') {
      h += `<label class="wd-field"><span>Transition</span><select data-z="transition">${[['fade', 'White fade'], ['star', 'Star wipe'], ['circle', 'Circle (like falling)'], ['instant', 'Instant (same area: keeps running)']].map(([v, l]) => `<option value="${v}" ${(z.transition || 'fade') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    }
    if (z && z.kind === 'camera') {
      h += `<label class="wd-field"><span>Camera inside</span><select data-z="mode">${CAMERA_MODES.filter((c) => c !== 'default').map((c) => `<option value="${c}" ${(z.mode || 'close') === c ? 'selected' : ''}>${esc(CAMERA_LABELS[c])}</option>`).join('')}</select></label>
        ${z.mode === 'side' ? `<label class="wd-field"><span>Looks along (°)</span><input type="number" data-z="axis" value="${z.axis ?? 0}" step="15"></label>` : ''}
        ${z.mode === 'fixed' ? '<div class="btn-row"><button class="btn sm" data-w="camhere">Camera where I look from</button></div>' : ''}`;
    }
    if (z && ['water', 'gas', 'lava', 'quicksand'].includes(z.kind)) {
      h += `<label class="wd-field"><span>Kind</span><select data-z="kind">${['water', 'gas', 'lava', 'quicksand'].map((k) => `<option value="${k}" ${z.kind === k ? 'selected' : ''}>${esc(ZONES[k].label)}</option>`).join('')}</select></label>
        <div class="wd-note">The top of the box is the surface. Resize it with the handles (3).</div>`;
    }
    if (z && z.kind === 'death') h += `<div class="wd-note">${esc(ZONES.death.help)}</div>`;
    if (rec.keyItem) {
      h += `<label class="wd-field"><span>Key number</span><select data-k="index">${Array.from({ length: 8 }, (_, i) => `<option value="${i}" ${rec.keyItem.index === i ? 'selected' : ''}>Key ${i + 1}</option>`).join('')}</select></label>
        <div class="wd-note">Opens the doors that need key ${rec.keyItem.index + 1}.</div>`;
    }
    h += '</div>';
    return h;
  }

  wire(box, sel, rec) {
    const f = this.flow;
    const key = this.engine.areaKey();
    const upd = (fields, summary) => f.updateRecord(key, rec.uid, fields, summary);
    box.querySelectorAll('.wd-insp input, .wd-insp select').forEach((x) => x.addEventListener('keydown', (e) => e.stopPropagation()));
    box.querySelector('[data-w=link]')?.addEventListener('click', () => this.linkSelected(rec));
    box.querySelector('[data-w=go]')?.addEventListener('click', () => this.goTo(rec.warp.to));
    box.querySelector('[data-w=unlink]')?.addEventListener('click', () => upd({ warp: { ...rec.warp, to: null }, ...(rec.warp.kind === 'door' ? { bhv: 'bhvDoor' } : {}) }, 'Unlinked a warp'));
    box.querySelector('[data-w=tohub]')?.addEventListener('click', () => f.link(key, rec.uid, { hub: true }, { twoWay: false }));
    box.querySelector('[data-w=style]')?.addEventListener('change', (e) => {
      const st = DOOR_STYLES.find((d) => d.id === e.target.value);
      upd({ model: st.model, name: rec.name && !DOOR_STYLES.some((d) => d.label === rec.name) ? rec.name : st.label, warp: { ...rec.warp, style: st.id } }, `Door style: ${st.label}`);
    });
    box.querySelector('[data-w=stars]')?.addEventListener('change', (e) => upd({ warp: { ...rec.warp, stars: Math.max(0, Number(e.target.value) | 0) } }, 'Changed the stars needed'));
    box.querySelector('[data-w=key]')?.addEventListener('change', (e) => { const k = Number(e.target.value); const w = { ...rec.warp }; if (k >= 0) w.key = k; else delete w.key; upd({ warp: w }, k >= 0 ? `Needs key ${k + 1}` : 'No key needed'); });
    box.querySelector('[data-w=locked]')?.addEventListener('change', (e) => upd({ warp: { ...rec.warp, locked: e.target.checked } }, e.target.checked ? 'Locked' : 'Unlocked'));
    box.querySelectorAll('[data-pic]').forEach((b) => b.addEventListener('click', () => upd({ painting: { ...rec.painting, picture: b.dataset.pic } }, 'Changed the painting')));
    box.querySelector('[data-w=upload]')?.addEventListener('click', () => this.uploadPicture(rec));
    box.querySelectorAll('[data-z]').forEach((s) => s.addEventListener('change', () => {
      const k = s.dataset.z;
      let v = s.type === 'number' ? Number(s.value) : s.value;
      const zone = { ...rec.zone, [k]: v };
      const fields = { zone };
      if (k === 'kind') { fields.name = ZONES[v].label; fields.block = { ...rec.block, color: ZONES[v].color }; }
      upd(fields, `Changed the ${ZONES[rec.zone.kind]?.label.toLowerCase() || 'zone'}`);
    }));
    box.querySelector('[data-w=camhere]')?.addEventListener('click', () => {
      const cp = this.engine.camOut().pos;
      upd({ zone: { ...rec.zone, x: Math.round(cp[0]), y: Math.round(cp[1]), z: Math.round(cp[2]) } }, 'Placed the zone camera');
    });
    box.querySelector('[data-k=index]')?.addEventListener('change', (e) => {
      const i = Number(e.target.value);
      upd({ keyItem: { ...rec.keyItem, index: i }, bparams: (i << 24) >>> 0, name: `Key ${i + 1}` }, 'Changed the key');
    });
  }

  uploadPicture(rec) {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
      // stored small: 128x128 is what the canvas shows
      const small = await shrink(url, 128);
      const id = `pic_${Math.random().toString(36).slice(2, 8)}`;
      const pictures = { ...(this.flow.flow().pictures || {}), [id]: { name: file.name.replace(/\.\w+$/, '').slice(0, 40), data: small } };
      this.flow.setFlow({ pictures });
      this.flow.pictureCache.set(id, await imageToRgba16(small, 128, 128));
      this.flow.uploadPictures();
      this.flow.updateRecord(this.engine.areaKey(), rec.uid, { painting: { ...rec.painting, picture: id } }, 'Painting with your picture');
    };
    inp.click();
  }

  // ---- overlay: links, labels, the placing cursor ------------------------------------

  draw(ed, g, recs) {
    const showZones = this.flow.flow().hideZones !== true;
    for (const r of recs) {
      if (!r.warp && !r.zone && !r.keyItem) continue;
      const top = r.block ? r.y + r.block.sy : r.y + (r.painting ? 600 * (r.scale || 1) : 220);
      const q = ed.project([r.x, top + 30, r.z]);
      if (!q) continue;
      let text = '';
      if (r.warp?.to) text = `→ ${this.flow.areaName(r.warp.to.hub ? (this.flow.hubTarget() || { level: 6 }) : r.warp.to)}`;
      else if (r.warp && ['pipe', 'painting', 'zone'].includes(r.warp.kind)) text = 'not linked';
      else if (r.warp?.kind === 'door') text = 'Door';
      else if (r.zone) text = ZONES[r.zone.kind]?.label || '';
      else if (r.keyItem) text = `Key ${r.keyItem.index + 1}`;
      const req = this.reqText(r.warp);
      if (req) text += `  ${req}`;
      if (!text || (r.zone && !showZones && !r.warp)) continue;
      g.font = '600 11px Inter, sans-serif';
      const w = g.measureText(text).width + 14;
      g.fillStyle = r.warp && !r.warp.to && !['arrival', 'door'].includes(r.warp.kind) ? 'rgba(120,40,40,0.85)' : 'rgba(12,12,14,0.78)';
      roundRect(g, q.x - w / 2, q.y - 11, w, 20, 10);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, q.x, q.y);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    }
    // links inside this area
    for (const r of recs) {
      if (!r.warp?.to?.uid) continue;
      const t = recs.find((x) => x.uid === r.warp.to.uid);
      if (!t) continue;
      const p0 = [r.x, r.y + 200, r.z], p1 = [t.x, t.y + 200, t.z];
      const d = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      const mid = [(p0[0] + p1[0]) / 2, Math.max(p0[1], p1[1]) + Math.min(2000, d * 0.35), (p0[2] + p1[2]) / 2];
      let prev = null;
      for (let i = 0; i <= 24; i++) {
        const s = i / 24;
        const qq = [0, 1, 2].map((k) => p0[k] * (1 - s) * (1 - s) + mid[k] * 2 * s * (1 - s) + p1[k] * s * s);
        if (prev) ed.line(prev, qq, 'rgba(176,112,255,0.9)', 2.5, [7, 5]);
        prev = qq;
      }
    }
    // the placing cursor
    if ((this.tool || this.picking?.arrived) && this.hover?.hit) {
      const h = this.hover.hit;
      const kind = this.tool?.kind || 'arrival';
      const pose = this.poseFor(kind, h);
      const size = { door: [160, 260, 30], painting: [600, 600, 10], pipe: [200, 250, 200], death: [3000, 300, 3000], camera: [1200, 800, 1200], water: [1200, 400, 1200], gas: [1200, 400, 1200] }[kind] || [300, 300, 300];
      const a = (pose.yaw / 32768) * Math.PI;
      const c = Math.cos(a), s = Math.sin(a);
      const hx = size[0] / 2, hz = size[2] / 2;
      const corner = (x, y, z) => [pose.x + x * c + z * s, pose.y + y, pose.z - x * s + z * c];
      const col = this.picking ? 'rgba(94,224,138,0.95)' : 'rgba(255,200,61,0.95)';
      for (const y of [0, size[1]]) {
        const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]].map(([x, z]) => corner(x, y, z));
        for (let i = 0; i < 4; i++) ed.line(pts[i], pts[i + 1], col, 2);
      }
      for (const [x, z] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) ed.line(corner(x, 0, z), corner(x, size[1], z), col, 1.5);
      // facing arrow
      ed.line(corner(0, 20, 0), corner(0, 20, Math.max(hz, 60) + 120), col, 3);
    }
  }

  // ---- small UI helpers -------------------------------------------------------------

  addLauncherButton() {
    const panel = $('#launcher .launcher-panel');
    if (!panel || $('#wd-launch-map')) return;
    const b = el('button', 'btn sm wd-launch-map', `${icon('route', 'sm')}World map`);
    b.id = 'wd-launch-map';
    b.title = 'How your levels and areas connect';
    b.onclick = () => { $('#launcher').hidden = true; this.map.open(); };
    const head = panel.querySelector('.launcher-top') || panel.firstElementChild;
    const close = head?.querySelector('#launcher-close');
    if (close) head.insertBefore(b, close); else head?.appendChild(b);
  }

  popMenu(anchor, items) {
    $('#wd-menu')?.remove();
    const m = el('div', 'wd-menu');
    m.id = 'wd-menu';
    for (const [label, fn, danger] of items) {
      const b = el('button', `menu-item${danger ? ' danger' : ''}`, `<span>${esc(label)}</span>`);
      b.onclick = (e) => { e.stopPropagation(); m.remove(); fn(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = `${Math.max(8, r.right - 160)}px`;
    m.style.top = `${r.bottom + 4}px`;
    setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
  }

  ask(title, value) {
    return new Promise((resolve) => {
      const back = $('#modal-back');
      const m = $('#modal');
      m.innerHTML = `<h2>${esc(title)}</h2><div class="field"><input type="text" id="wd-ask" value="${esc(value)}" maxlength="60"></div>
        <div class="actions"><button class="btn" id="wd-ask-no">Cancel</button><button class="btn primary" id="wd-ask-ok">OK</button></div>`;
      back.hidden = false;
      const inp = m.querySelector('#wd-ask');
      const done = (v) => { back.hidden = true; resolve(v); };
      m.querySelector('#wd-ask-no').onclick = () => done(null);
      m.querySelector('#wd-ask-ok').onclick = () => done(inp.value.trim() || null);
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
      setTimeout(() => { inp.focus(); inp.select(); }, 20);
    });
  }

  confirm(title, text) {
    return new Promise((resolve) => {
      const back = $('#modal-back');
      const m = $('#modal');
      m.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="btn" id="wd-c-no">Cancel</button><button class="btn danger" id="wd-c-ok">Delete</button></div>`;
      back.hidden = false;
      m.querySelector('#wd-c-no').onclick = () => { back.hidden = true; resolve(false); };
      m.querySelector('#wd-c-ok').onclick = () => { back.hidden = true; resolve(true); };
    });
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function shrink(url, size) {
  const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.max(size / img.width, size / img.height);
  c.getContext('2d').drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
  return c.toDataURL('image/jpeg', 0.86);
}
