// The logo maker: text in a display font, made to look like a game logo (colourful letters or a
// gradient, a thick outline, a 3D extrude, a shine, a soft shadow, an arc like the Super Mario 64
// logo) with an optional emblem. Renders to a canvas trimmed to the logo; the studio saves it as
// a PNG (so the player needs no fonts) and keeps these settings to edit it again.
import { normalizeMaker } from './schema.js';

const BASE = 260; // font size of the main line at full resolution

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// ---- emblems (unit paths, about -1..1) -----------------------------------------------------

const EMBLEM = {
  star(g) { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.46 : 1, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.05); } g.closePath(); },
  coin(g) { g.beginPath(); g.ellipse(0, 0, 0.82, 1, 0, 0, Math.PI * 2); },
  heart(g) { g.beginPath(); g.moveTo(0, 0.95); g.bezierCurveTo(-1.25, 0.1, -0.95, -1.05, 0, -0.42); g.bezierCurveTo(0.95, -1.05, 1.25, 0.1, 0, 0.95); g.closePath(); },
  crown(g) { g.beginPath(); g.moveTo(-1, 0.75); g.lineTo(-1, -0.45); g.lineTo(-0.5, 0.05); g.lineTo(0, -0.85); g.lineTo(0.5, 0.05); g.lineTo(1, -0.45); g.lineTo(1, 0.75); g.closePath(); },
  mushroom(g) { g.beginPath(); g.moveTo(-1, 0.1); g.bezierCurveTo(-1, -1.15, 1, -1.15, 1, 0.1); g.lineTo(0.42, 0.1); g.lineTo(0.48, 0.95); g.lineTo(-0.48, 0.95); g.lineTo(-0.42, 0.1); g.closePath(); },
  shell(g) { g.beginPath(); g.moveTo(-1, 0.45); g.bezierCurveTo(-1, -1.05, 1, -1.05, 1, 0.45); g.quadraticCurveTo(0, 0.85, -1, 0.45); g.closePath(); },
};

// The emblem's inside details, drawn over its fill.
function emblemDetail(kind, g, color) {
  g.save();
  if (kind === 'coin') {
    g.fillStyle = shade(color, -0.35);
    g.beginPath(); g.roundRect?.(-0.13, -0.58, 0.26, 1.16, 0.13); if (!g.roundRect) g.rect(-0.13, -0.58, 0.26, 1.16); g.fill();
  } else if (kind === 'mushroom') {
    g.fillStyle = '#fff';
    for (const [x, y, r] of [[0, -0.5, 0.26], [-0.66, -0.12, 0.2], [0.66, -0.12, 0.2]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f3e1b5';
    g.beginPath(); g.moveTo(0.42, 0.1); g.lineTo(0.48, 0.95); g.lineTo(-0.48, 0.95); g.lineTo(-0.42, 0.1); g.closePath(); g.fill();
    g.fillStyle = '#111';
    for (const x of [-0.15, 0.15]) { g.beginPath(); g.ellipse(x, 0.42, 0.06, 0.14, 0, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'shell') {
    g.strokeStyle = shade(color, 0.55); g.lineWidth = 0.09;
    g.beginPath(); g.moveTo(-0.3, -0.62); g.lineTo(-0.3, 0.3); g.moveTo(0.3, -0.62); g.lineTo(0.3, 0.3); g.moveTo(-0.85, -0.15); g.lineTo(0.85, -0.15); g.stroke();
    g.fillStyle = '#fff6dc';
    g.beginPath(); g.moveTo(-1, 0.45); g.quadraticCurveTo(0, 0.85, 1, 0.45); g.quadraticCurveTo(0, 0.62, -1, 0.45); g.fill();
  } else if (kind === 'star') {
    g.fillStyle = '#111';
    for (const x of [-0.17, 0.17]) { g.beginPath(); g.ellipse(x, -0.02, 0.07, 0.17, 0, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'crown') {
    g.fillStyle = '#e52521';
    g.beginPath(); g.arc(0, 0.3, 0.17, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// ---- layout ---------------------------------------------------------------------------------

// The pieces of the logo: letters (with their own transform) and the emblem.
function layout(m, g) {
  const items = [];
  const font = (size) => `${m.weight} ${size}px "${m.font}", "Arial Black", sans-serif`;
  const line = (text, size, cy, arcDeg, colors, grad) => {
    g.font = font(size);
    const chars = [...text];
    const sp = (m.spacing / 100) * size;
    const widths = chars.map((c) => g.measureText(c).width + sp);
    const total = widths.reduce((a, b) => a + b, 0) - sp;
    const arc = (arcDeg * Math.PI) / 180;
    let x = -total / 2;
    let li = 0;
    chars.forEach((c, i) => {
      const w = widths[i] - sp;
      const cx = x + w / 2;
      x += widths[i];
      if (!c.trim()) return;
      let px = cx, py = cy, rot = 0;
      if (Math.abs(arc) > 0.001) {
        const R = total / arc; // the line is bent over a circle: the middle highest
        const a = cx / R;
        px = Math.sin(a) * R;
        py = cy - (Math.cos(a) * R - R);
        rot = a;
      }
      const fill = colors ? colors[li % colors.length] : null;
      li++;
      items.push({ type: 'glyph', c, size, font: font(size), x: px, y: py, rot, fill, grad });
    });
    return { w: total, h: size };
  };
  const main = m.text.trim() ? line(m.text, BASE, 0, m.arc, m.fill === 'letters' ? m.colors : null, m.fill === 'gradient' ? [m.c1, m.c2] : m.fill === 'solid' ? [m.c1, m.c1] : null) : { w: 0, h: 0 };
  if (m.sub.trim()) {
    const size = BASE * m.sub2.scale;
    line(m.sub, size, (main.h ? BASE * 0.5 + size * 0.62 : 0), main.h ? m.arc * 0.3 : m.arc, null, [m.sub2.color, m.sub2.c2]);
  }
  if (m.emblem !== 'none' && EMBLEM[m.emblem]) {
    const r = m.emblemPos === 'behind' ? Math.max(main.w * 0.36, BASE) : BASE * 0.62;
    let x = 0, y = 0;
    if (m.emblemPos === 'left') { x = -main.w / 2 - r * 1.15; y = -BASE * 0.25; }
    else if (m.emblemPos === 'right') { x = main.w / 2 + r * 1.15; y = -BASE * 0.25; }
    else if (m.emblemPos === 'top') { y = -BASE * 0.55 - r * 1.25; }
    else y = BASE * 0.12;
    items.unshift({ type: 'emblem', kind: m.emblem, x, y, r, rot: m.emblemPos === 'left' ? -0.18 : m.emblemPos === 'right' ? 0.18 : 0, fill: m.emblemColor, behind: m.emblemPos === 'behind' });
  }
  return items;
}

// Draw one piece's shape with a fill and/or an outline (the caller set the styles).
function shape(g, it, { fill = true, stroke = 0 } = {}) {
  g.save();
  g.translate(it.x, it.y);
  g.rotate(it.rot || 0);
  if (it.type === 'glyph') {
    g.font = it.font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (stroke) { g.lineWidth = stroke; g.strokeText(it.c, 0, 0); }
    if (fill) g.fillText(it.c, 0, 0);
  } else {
    g.scale(it.r, it.r);
    EMBLEM[it.kind](g);
    if (stroke) { g.lineWidth = stroke / it.r; g.stroke(); }
    if (fill) g.fill();
  }
  g.restore();
}

// The fill of a piece: its letter colour, a vertical gradient, or the emblem colour.
function fillStyle(g, it, m) {
  const h = it.type === 'glyph' ? it.size * 0.5 : it.r;
  const y0 = it.y - h, y1 = it.y + h;
  const grd = g.createLinearGradient(0, y0, 0, y1);
  if (it.type === 'emblem') { grd.addColorStop(0, shade(it.fill, 0.25)); grd.addColorStop(1, shade(it.fill, -0.2)); return grd; }
  if (it.fill) { grd.addColorStop(0, shade(it.fill, 0.18)); grd.addColorStop(1, shade(it.fill, -0.22)); return grd; }
  const [c1, c2] = it.grad || [m.c1, m.c2];
  grd.addColorStop(0, c1); grd.addColorStop(1, c2);
  return grd;
}

// The logo as a canvas, trimmed to what was drawn. scale < 1 renders smaller (previews).
export function renderLogo(spec, { scale = 1 } = {}) {
  const m = normalizeMaker(spec);
  const W = Math.ceil(2800 * scale), H = Math.ceil(1500 * scale);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const items = layout(m, g);
  if (!items.length) { c.width = c.height = 1; return c; }
  const centre = (gg) => { gg.setTransform(scale, 0, 0, scale, W / 2, H / 2); gg.rotate((m.tilt * Math.PI) / 180); };
  const ow = m.outlineW * 2;
  const ang = (m.angle * Math.PI) / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const order = [...items.filter((i) => i.behind), ...items.filter((i) => !i.behind)];

  // the soft shadow under everything
  if (m.shadow > 0) {
    centre(g);
    g.save();
    g.shadowColor = `rgba(0,0,0,${0.55 * m.shadow})`;
    g.shadowBlur = 40 * scale;
    g.shadowOffsetX = (dx * (m.extrude + 10)) * scale;
    g.shadowOffsetY = (dy * (m.extrude + 10) + 8) * scale;
    g.fillStyle = g.strokeStyle = '#000';
    for (const it of order) shape(g, it, { stroke: ow + 2 });
    g.restore();
  }
  // the 3D extrude: the outline shape stepped back along the angle, darker at the back
  for (let d = Math.round(m.extrude); d >= 1; d--) {
    centre(g);
    g.translate(dx * d, dy * d);
    const t = d / Math.max(1, m.extrude);
    g.fillStyle = g.strokeStyle = t > 0.92 ? shade(m.extrudeColor, -0.3) : m.extrudeColor;
    for (const it of order) shape(g, it, { stroke: ow });
  }
  // the outline, then the fills
  centre(g);
  g.strokeStyle = m.outline;
  g.fillStyle = m.outline;
  for (const it of order) if (ow) shape(g, it, { stroke: ow });
  for (const it of order) {
    g.fillStyle = fillStyle(g, it, m);
    shape(g, it);
    if (it.type === 'emblem') {
      g.save(); g.translate(it.x, it.y); g.rotate(it.rot || 0); g.scale(it.r, it.r);
      emblemDetail(it.kind, g, it.fill);
      g.restore();
    }
  }
  // the shine: a light top half on every letter
  if (m.shine) {
    const s = document.createElement('canvas');
    s.width = W; s.height = H;
    const sg = s.getContext('2d');
    centre(sg);
    sg.fillStyle = '#fff';
    for (const it of order) shape(sg, it);
    // the bands (one per piece, over its upper half), kept inside the letters
    const b = document.createElement('canvas');
    b.width = W; b.height = H;
    const bg = b.getContext('2d');
    for (const it of order) {
      const h = (it.type === 'glyph' ? it.size * 0.5 : it.r) * scale;
      const cy = H / 2 + it.y * scale;
      const grd = bg.createLinearGradient(0, cy - h, 0, cy);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.18)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      bg.fillStyle = grd;
      bg.fillRect(0, cy - h, W, h);
    }
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.drawImage(b, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(s, 0, 0);
  }
  return trim(c, Math.round(12 * scale));
}

// The canvas cut to its drawn pixels (plus a margin).
export function trim(c, pad = 8) {
  const g = c.getContext('2d');
  const { width: w, height: h } = c;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) { const e = document.createElement('canvas'); e.width = e.height = 1; return e; }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Wait until the logo's font is ready (the studio loads them from Google Fonts).
export async function fontReady(spec) {
  const m = normalizeMaker(spec);
  try { await document.fonts.load(`${m.weight} 100px "${m.font}"`, m.text + m.sub); } catch { /* the fallback font draws it */ }
}

// Load the maker's fonts once (only the studio: the saved logo is a picture).
let fontsLinked = false;
export function linkFonts(families) {
  if (fontsLinked || typeof document === 'undefined') return;
  fontsLinked = true;
  const q = families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}${f === 'Fredoka' || f === 'Baloo 2' ? ':wght@400;700' : ''}`).join('&');
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?${q}&display=swap`;
  document.head.appendChild(l);
}
