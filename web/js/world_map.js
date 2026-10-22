// The world map: every level and area of the hack as a card, every door, pipe,
// painting and warp zone as an arrow between them. Laid out in layers from the start
// (or the hub); click a card to go there, drag to pan, wheel to zoom.
import { icon } from './icons.js';
import { parseKey } from './worldflow.js';
import { levelPicture } from './pictures.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_COLOR = { door: '#ffc83d', pipe: '#34d399', painting: '#a78bfa', zone: '#5aa7ff', arrival: '#9aa0a6', exit: '#ff8a3d' };
const W = 176, H = 132, GX = 120, GY = 26, CLUSTER = 22;

export class WorldMap {
  constructor({ flow, ui, getThumbs, toast }) {
    Object.assign(this, { flow, ui, getThumbs, toast });
    this.view = { x: 0, y: 0, s: 1 };
  }

  levelOf(key) {
    const k = parseKey(key);
    return k.custom ? `c:${k.custom}` : `v:${k.level}`;
  }

  layout(g) {
    // levels as clusters, areas inside them
    const clusters = new Map();
    for (const n of g.nodes) {
      const id = this.levelOf(n.key);
      if (!clusters.has(id)) clusters.set(id, { id, nodes: [] });
      clusters.get(id).nodes.push(n);
    }
    for (const c of clusters.values()) c.nodes.sort((a, b) => (a.area || 1) - (b.area || 1));
    // layers: breadth-first over level-to-level edges from the start (else the hub, else the first level)
    const adj = new Map();
    for (const e of g.edges) {
      const a = this.levelOf(e.from), b = this.levelOf(e.to);
      if (a === b) continue;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
    const root = g.start ? this.levelOf(g.start) : g.hub ? this.levelOf(g.hub) : [...clusters.keys()][0];
    const layer = new Map();
    if (root) {
      layer.set(root, 0);
      const q = [root];
      while (q.length) {
        const c = q.shift();
        for (const d of adj.get(c) || []) if (!layer.has(d)) { layer.set(d, layer.get(c) + 1); q.push(d); }
      }
    }
    let maxLayer = Math.max(0, ...layer.values());
    // not connected to anything: a last column
    for (const id of clusters.keys()) if (!layer.has(id)) layer.set(id, maxLayer + 1);
    const cols = new Map();
    for (const [id, l] of layer) { if (!clusters.has(id)) continue; if (!cols.has(l)) cols.set(l, []); cols.get(l).push(clusters.get(id)); }
    const pos = new Map();
    const boxes = [];
    for (const [l, list] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
      let y = 0;
      for (const c of list) {
        const x = l * (W + GX);
        const y0 = y;
        c.nodes.forEach((n, i) => { pos.set(n.key, { x: x + CLUSTER / 2, y: y + CLUSTER + i * (H + GY) }); });
        const h = CLUSTER + c.nodes.length * (H + GY) - GY + CLUSTER / 2;
        boxes.push({ id: c.id, x, y: y0, w: W + CLUSTER, h, name: c.nodes[0].levelName || c.nodes[0].name.split(' · ')[0] });
        y += h + 40;
      }
    }
    return { pos, boxes };
  }

  open() {
    document.getElementById('wd-map')?.remove();
    const g = this.flow.graph();
    const root = document.createElement('div');
    root.id = 'wd-map';
    root.className = 'wd-map';
    root.innerHTML = `<div class="wd-map-bar"><div class="wd-map-title">${icon('route', 'sm')}<b>World map</b><span>${g.nodes.length} areas · ${g.edges.length} warps</span></div>
      <div class="wd-map-legend">${Object.entries({ door: 'Door', pipe: 'Pipe', painting: 'Painting', zone: 'Warp zone', exit: 'Exit' }).map(([k, l]) => `<span><i style="background:${KIND_COLOR[k]}"></i>${l}</span>`).join('')}</div>
      <button class="btn sm" data-a="fit">Fit</button><button class="btn sm" data-a="close">${icon('x', 'sm')}Close</button></div>
      <div class="wd-map-stage"><svg class="wd-map-svg"></svg><div class="wd-map-empty" hidden>Nothing connected yet. Place a door, pipe or painting in the World tab and link it to another level or area.</div></div>`;
    document.body.appendChild(root);
    root.querySelector('[data-a=close]').onclick = () => this.close();
    root.querySelector('[data-a=fit]').onclick = () => { this.fit(); this.apply(); };
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.keyFn = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    window.addEventListener('keydown', this.keyFn, true);
    this.root = root;
    this.render(g);
    this.fit();
    this.apply();
    this.bindPan();
  }

  close() {
    this.root?.remove();
    this.root = null;
    window.removeEventListener('keydown', this.keyFn, true);
  }

  render(g) {
    const svg = this.root.querySelector('.wd-map-svg');
    const { pos, boxes } = this.layout(g);
    this.bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of boxes) {
      this.bounds.x0 = Math.min(this.bounds.x0, b.x); this.bounds.y0 = Math.min(this.bounds.y0, b.y);
      this.bounds.x1 = Math.max(this.bounds.x1, b.x + b.w); this.bounds.y1 = Math.max(this.bounds.y1, b.y + b.h);
    }
    this.root.querySelector('.wd-map-empty').hidden = g.nodes.length > 0;
    const here = this.flow.key();
    const thumbs = this.getThumbs();
    let s = `<defs>${Object.entries(KIND_COLOR).map(([k, c]) => `<marker id="wd-arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')}</defs><g class="wd-map-world">`;
    for (const b of boxes) s += `<g class="wd-cluster"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="16"/><text x="${b.x + 12}" y="${b.y + 15}">${esc(b.name)}</text></g>`;
    // edges: same pair drawn once per direction, bowed so both directions show
    const seen = new Map();
    for (const e of g.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) continue;
      const k = `${e.from}>${e.to}`;
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      const ax = a.x + W / 2, ay = a.y + H / 2, bx = b.x + W / 2, by = b.y + H / 2;
      let d;
      if (e.from === e.to) {
        d = `M${a.x + W} ${a.y + 30} C${a.x + W + 60} ${a.y - 10},${a.x + W + 60} ${a.y + H + 10},${a.x + W} ${a.y + H - 30}`;
      } else {
        // leave and enter on the facing sides
        const sx = bx > ax + 10 ? a.x + W : bx < ax - 10 ? a.x : ax, sy = bx > ax + 10 || bx < ax - 10 ? ay : by > ay ? a.y + H : a.y;
        const tx = bx > ax + 10 ? b.x : bx < ax - 10 ? b.x + W : bx, ty = bx > ax + 10 || bx < ax - 10 ? by : by > ay ? b.y : b.y + H;
        const bow = 24 + n * 14;
        const mx = (sx + tx) / 2, my = (sy + ty) / 2;
        const nx = -(ty - sy), ny = tx - sx, l = Math.hypot(nx, ny) || 1;
        d = `M${sx} ${sy} Q${mx + (nx / l) * bow} ${my + (ny / l) * bow} ${tx} ${ty}`;
      }
      const col = KIND_COLOR[e.kind] || '#ccc';
      const req = [e.stars ? `★${e.stars}` : '', e.key_needed !== null && e.key_needed !== undefined ? `🔑${e.key_needed + 1}` : '', e.locked ? '🔒' : ''].filter(Boolean).join(' ');
      s += `<g class="wd-edge"><path d="${d}" stroke="${col}" marker-end="url(#wd-arr-${e.kind in KIND_COLOR ? e.kind : 'zone'})"><title>${esc(e.name || e.kind)}${req ? ` (${req})` : ''}</title></path>`;
      if (req) {
        const m = d.match(/Q([\d.-]+) ([\d.-]+)/);
        if (m) s += `<text class="wd-edge-req" x="${m[1]}" y="${m[2]}">${esc(req)}</text>`;
      }
      s += '</g>';
    }
    for (const n of g.nodes) {
      const p = pos.get(n.key);
      if (!p) continue;
      const thumb = thumbs[n.key] || (n.level ? levelPicture(n.level) || '' : '');
      const stars = this.flow.world.stars(n.key).filter((x) => x.kind !== 'coins100');
      const badges = [];
      if (g.start === n.key) badges.push('Start');
      if (g.hub === n.key) badges.push('Hub');
      if (n.key === here) badges.push('You are here');
      const title = n.custom ? (n.areaName || `Area ${n.area}`) : n.name;
      s += `<g class="wd-node${n.key === here ? ' here' : ''}" data-key="${esc(n.key)}" transform="translate(${p.x} ${p.y})">
        <rect class="wd-node-bg" width="${W}" height="${H}" rx="12"/>
        <clipPath id="clip-${esc(n.key).replace(/[^\w]/g, '_')}"><rect width="${W}" height="${H - 42}" rx="12"/></clipPath>
        ${thumb ? `<image href="${esc(thumb)}" width="${W}" height="${H - 42}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${esc(n.key).replace(/[^\w]/g, '_')})"/>` : `<rect class="wd-node-nopic" width="${W}" height="${H - 42}" rx="12"/>`}
        ${badges.length ? `<text class="wd-node-badge" x="8" y="18">${esc(badges.join(' · '))}</text>` : ''}
        <text class="wd-node-t" x="10" y="${H - 23}">${esc(title.length > 24 ? title.slice(0, 23) + '…' : title)}</text>
        <text class="wd-node-s" x="10" y="${H - 8}">${stars.length ? `★ ${stars.filter((x) => x.done).length}/${stars.length}` : 'no stars'}</text></g>`;
    }
    s += '</g>';
    svg.innerHTML = s;
    svg.querySelectorAll('.wd-node').forEach((nd) => {
      nd.addEventListener('click', (e) => {
        if (this.dragged) return;
        e.stopPropagation();
        const k = parseKey(nd.dataset.key);
        this.close();
        this.flow.goArea(k);
        this.toast(`Going to ${this.flow.areaName(k)}`, 'door');
      });
    });
  }

  fit() {
    const st = this.root.querySelector('.wd-map-stage').getBoundingClientRect();
    const b = this.bounds;
    if (!Number.isFinite(b.x0)) { this.view = { x: 40, y: 40, s: 1 }; return; }
    const w = b.x1 - b.x0 + 80, h = b.y1 - b.y0 + 80;
    const s = Math.min(1.4, st.width / w, st.height / h);
    this.view = { s, x: (st.width - (b.x1 - b.x0) * s) / 2 - b.x0 * s, y: (st.height - (b.y1 - b.y0) * s) / 2 - b.y0 * s };
  }

  apply() {
    const gw = this.root?.querySelector('.wd-map-world');
    if (gw) gw.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.s})`);
  }

  bindPan() {
    const stage = this.root.querySelector('.wd-map-stage');
    let drag = null;
    stage.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }; this.dragged = false; });
    window.addEventListener('mousemove', this.moveFn = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragged = true;
      this.view.x = drag.vx + dx; this.view.y = drag.vy + dy;
      this.apply();
    });
    window.addEventListener('mouseup', () => { drag = null; setTimeout(() => { this.dragged = false; }, 0); });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * 0.0015);
      const s = Math.max(0.2, Math.min(3, this.view.s * k));
      this.view.x = mx - ((mx - this.view.x) * s) / this.view.s;
      this.view.y = my - ((my - this.view.y) * s) / this.view.s;
      this.view.s = s;
      this.apply();
    }, { passive: false });
  }
}
