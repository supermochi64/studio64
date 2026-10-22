// The launch screen at runtime: splash screens, the title (background, logo with its animation,
// "Press Start", music) and the file select, drawn on a canvas over the game. The same code
// draws the editor's live preview and the home card's cover picture.
//
// Backgrounds that need the game (title_stage below):
//  - "The game's title": the engine goes to its own title screen (Mario's face, optionally the
//    game's 3D logo first, optionally without the face: engine/src/studio/title.c),
//  - "A level": the engine loads the level, hides Mario and the HUD, and the page flies the
//    camera around it.
// Everything else (colours, pictures, the logo, the texts) is drawn here, at the screen's own
// resolution, so it stays sharp.
import { normalizeTitle, titleFileUrl, needsEngine, MAKER_DEFAULT } from './schema.js';
import { loadTexts, loadFont, encode, texts } from '../story/text.js';

const FADE = 0.35;
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const easeOutBounce = (x) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const CSS = `
.ttl-screen{position:absolute;inset:0;z-index:200;outline:none;cursor:pointer;background:transparent;user-select:none;-webkit-user-select:none}
.ttl-screen canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ttl-screen .ttl-skip{position:absolute;right:14px;bottom:12px;font:600 12px/1 Inter,system-ui,sans-serif;color:rgba(255,255,255,.72);background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.18);padding:6px 10px;border-radius:999px;pointer-events:none}
.ttl-screen .ttl-legal{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);width:min(92%,760px);text-align:center;font:500 10.5px/1.35 Inter,system-ui,sans-serif;color:rgba(255,255,255,.55);pointer-events:none;text-shadow:0 1px 2px #000}
.ttl-screen.out{transition:opacity .35s ease;opacity:0}
body.ttl-on #focus-hint,body.ttl-on #coords{visibility:hidden}
`;
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('ttl-css')) return;
  const s = document.createElement('style');
  s.id = 'ttl-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---- pictures ---------------------------------------------------------------------------------

const imageCache = new Map();
// A picture by URL (with the studio's password header when there is one).
export function loadImage(url, headers = {}) {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return imageCache.get(url);
  const p = (async () => {
    let src = url;
    if (!/^(data|blob):/.test(url) && Object.keys(headers).length) {
      try { const r = await fetch(url, { headers }); if (r.ok) src = URL.createObjectURL(await r.blob()); } catch { /* the plain URL then */ }
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  })();
  imageCache.set(url, p);
  return p;
}

// ---- text -------------------------------------------------------------------------------------

let gameFont = null;
const fontReady = typeof document !== 'undefined' ? Promise.all([loadTexts(), loadFont()]).then(([, f]) => { gameFont = f; }).catch(() => {}) : Promise.resolve();
const glyphTint = new Map();

// A line in the game's own dialog font as a 1x canvas: tinted, with a 1-pixel outline (and a
// drop shadow) made at the font's own resolution, so it scales up as clean pixels.
function gameLine(text, color, outline) {
  const d = texts();
  if (!gameFont || !d) return null;
  const key = `${text}|${color}|${outline}`;
  if (glyphTint.has(key)) return glyphTint.get(key);
  const codes = encode(text);
  let w = 0;
  for (const c of codes) w += c === 0x9E ? 5 : (d.widths[c] || 0);
  const tint = (col) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = 16;
    const g = c.getContext('2d');
    let x = 0;
    for (const code of codes) {
      if (code !== 0x9E) g.drawImage(gameFont, (code % 16) * 8, Math.floor(code / 16) * 16, 8, 16, x, 0, 8, 16);
      x += code === 0x9E ? 5 : (d.widths[code] || 0);
    }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col;
    g.fillRect(0, 0, c.width, 16);
    return c;
  };
  const fill = tint(color);
  const out = document.createElement('canvas');
  out.width = fill.width + 3; out.height = 19;
  const g = out.getContext('2d');
  if (outline) {
    const o = tint(outline);
    g.drawImage(o, 2, 3); // the shadow
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) g.drawImage(o, dx, dy);
  }
  g.drawImage(fill, 1, 1);
  if (glyphTint.size > 200) glyphTint.clear();
  glyphTint.set(key, out);
  return out;
}

// Text centred at (x, y): the game's font (crisp pixels, a dark outline) or a heavy sans/serif.
function drawText(g, text, x, y, px, { color = '#fff', outline = '#000', font = 'game', alpha = 1 } = {}) {
  if (!text) return 0;
  g.save();
  g.globalAlpha *= alpha;
  if (font === 'game' && gameFont && texts()) {
    const line = gameLine(text, color, outline);
    const s = Math.max(1, Math.round(px / 12)); // the font's letters are about 12 of its 16 pixels tall; whole pixels stay crisp
    const w = line.width * s, h = line.height * s;
    g.imageSmoothingEnabled = false;
    const x0 = Math.round(x - w / 2), y0 = Math.round(y - h * 0.55);
    g.drawImage(line, x0, y0, w, h);
    g.restore();
    return w;
  }
  g.font = font === 'serif' ? `700 ${px}px Georgia, "Times New Roman", serif` : `900 ${px}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (outline) { g.lineWidth = Math.max(2, px * 0.16); g.strokeStyle = outline; g.strokeText(text, x, y); }
  g.fillStyle = color;
  g.fillText(text, x, y);
  const w = g.measureText(text).width;
  g.restore();
  return w;
}

// ---- drawing ----------------------------------------------------------------------------------

function cover(g, img, W, H) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
function contain(g, img, W, H, f = 0.8) {
  const s = Math.min((W * f) / img.width, (H * f) / img.height);
  const w = img.width * s, h = img.height * s;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
function gradient(g, W, H, c1, c2, angle = 180) {
  const a = ((angle - 90) * Math.PI) / 180;
  const r = Math.abs(W * Math.cos(a)) / 2 + Math.abs(H * Math.sin(a)) / 2;
  const grd = g.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
  grd.addColorStop(0, c1); grd.addColorStop(1, c2);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
}

// The SM64 logo's feel: how the logo moves at time t (seconds since the title appeared).
export function logoMotion(anim, t) {
  const m = { s: 1, sx: 1, sy: 1, rot: 0, dy: 0, alpha: 1, wave: 0 };
  switch (anim) {
    case 'zoom': m.s = t < 1.1 ? Math.max(0.001, easeOutBack(clamp01(t / 1.1))) : 1; break;
    case 'wobble': {
      m.s = t < 0.9 ? Math.max(0.001, easeOutBack(clamp01(t / 0.9))) : 1;
      const k = clamp01((t - 0.6) / 0.8);
      m.rot = Math.sin(t * 1.7) * 0.035 * k;
      m.sx = 1 + 0.03 * Math.sin(t * 2.3) * k;
      m.sy = 1 - 0.03 * Math.sin(t * 2.3) * k;
      break;
    }
    case 'wave': m.alpha = clamp01(t / 0.6); m.wave = 1; break;
    case 'float': m.alpha = clamp01(t / 0.8); m.dy = Math.sin(t * 1.5) * 0.014 - (1 - m.alpha) * 0.03; break;
    case 'drop': m.dy = t < 1 ? -(1 - easeOutBounce(clamp01(t))) * 0.8 : 0; break;
    case 'fade': m.alpha = clamp01(t / 1.2); m.s = 0.96 + 0.04 * m.alpha; break;
    default: break;
  }
  return m;
}

function drawLogo(g, img, title, W, H, t) {
  if (!img) return;
  const L = title.logo;
  let w = L.scale * W;
  let h = (w * img.height) / img.width;
  const maxH = H * 0.62;
  if (h > maxH) { w *= maxH / h; h = maxH; }
  const m = logoMotion(L.anim, t);
  g.save();
  g.globalAlpha *= m.alpha;
  g.translate(L.x * W, (L.y + m.dy) * H);
  g.rotate(m.rot);
  g.scale(m.s * m.sx, m.s * m.sy);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  if (m.wave) {
    const strips = 48, sw = img.width / strips, dw = w / strips;
    for (let i = 0; i < strips; i++) {
      const off = Math.sin(i * 0.32 + t * 3.2) * h * 0.035;
      g.drawImage(img, i * sw, 0, sw + 1, img.height, -w / 2 + i * dw, -h / 2 + off, dw + 0.6, h);
    }
  } else g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
}

// What the game's title backdrop shows: its own tiles, the hack's logo, or plain colours.
export function tileMode(title) {
  return title.bg.tiles === 'auto' ? (title.logo.kind === 'game' || title.logo.kind === 'none' ? 'game' : 'logo') : title.bg.tiles;
}
// One backdrop tile (S x S) in the hack's colours, with its logo when mode is 'logo'.
export function tileCanvas(title, imgs, S = 256) {
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const mode = tileMode(title);
  if (mode === 'game') {
    // (the editor's stand-in for the game's own tiles)
    gradient(g, S, S, '#2b2f8f', '#151651', 180);
    g.globalAlpha = 0.35;
    drawText(g, 'SUPER', S / 2, S * 0.36, S * 0.2, { color: '#7d86e0', outline: null, font: 'sans' });
    drawText(g, 'MARIO', S / 2, S * 0.62, S * 0.22, { color: '#7d86e0', outline: null, font: 'sans' });
    g.globalAlpha = 1;
  } else {
    gradient(g, S, S, title.bg.color, title.bg.color2, title.bg.angle);
    const logo = mode === 'logo' ? (imgs.logo || null) : null;
    if (logo) {
      const k = Math.min((S * 0.86) / logo.width, (S * 0.7) / logo.height);
      g.globalAlpha = 0.55;
      g.drawImage(logo, (S - logo.width * k) / 2, (S - logo.height * k) / 2, logo.width * k, logo.height * k);
      g.globalAlpha = 1;
    }
  }
  // a soft dark edge, like the game's tiles
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v; g.fillRect(0, 0, S, S);
  return c;
}

// The background of the title. live: the game is behind (transparent where the game shows).
function drawBackground(g, title, W, H, imgs, { live = false, t = 0, standIn = true } = {}) {
  const b = title.bg;
  if (b.kind === 'color') { g.fillStyle = b.color; g.fillRect(0, 0, W, H); }
  else if (b.kind === 'gradient') gradient(g, W, H, b.color, b.color2, b.angle);
  else if (b.kind === 'image') {
    g.fillStyle = b.color; g.fillRect(0, 0, W, H);
    if (imgs.bg) cover(g, imgs.bg, W, H);
  } else if (!live && standIn) {
    // the editor's preview: a picture of what the game shows there
    if (b.kind === 'level' && imgs.level) {
      const z = 1.08 + Math.sin(t * 0.15) * 0.04;
      g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2 + Math.sin(t * 0.2) * W * 0.02, -H / 2); cover(g, imgs.level, W, H); g.restore();
    } else if (b.kind === 'game') {
      // the backdrop: 80x80 tiles on a 320x240 screen, three rows
      const key = `${tileMode(title)}|${b.color}|${b.color2}|${b.angle}|${imgs.logo?.width || 0}`;
      if (imgs.__tileKey !== key) { imgs.__tile = tileCanvas(title, imgs, 160); imgs.__tileKey = key; }
      const ts = H / 3;
      for (let y = 0; y < 3; y++) for (let x = 0; x * ts < W; x++) g.drawImage(imgs.__tile, x * ts, y * ts, ts, ts);
      if (b.head) {
        // Mario's face stands in as a soft round shape
        g.save(); g.globalAlpha = 0.85; g.fillStyle = '#f2c49b';
        g.beginPath(); g.ellipse(W / 2, H * 0.6, H * 0.2, H * 0.24, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e52521'; g.beginPath(); g.ellipse(W / 2, H * 0.44, H * 0.23, H * 0.13, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillStyle = '#3a2412'; g.beginPath(); g.ellipse(W / 2, H * 0.68, H * 0.12, H * 0.035, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    } else {
      const grd = g.createRadialGradient(W / 2, H * 0.55, H * 0.05, W / 2, H * 0.55, H * 0.9);
      grd.addColorStop(0, '#3d6fe0'); grd.addColorStop(1, '#0a1a5a');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      if (b.kind === 'game' && b.head) {
        // Mario's face stands in as a soft round shape
        g.save(); g.globalAlpha = 0.28; g.fillStyle = '#ffd7b0';
        g.beginPath(); g.ellipse(W / 2, H * 0.6, H * 0.22, H * 0.25, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e52521'; g.beginPath(); g.ellipse(W / 2, H * 0.42, H * 0.25, H * 0.12, 0, Math.PI, Math.PI * 2); g.fill();
        g.restore();
      }
    }
  }
  if (b.dim > 0 && (b.kind === 'image' || b.kind === 'level' || b.kind === 'game')) { g.fillStyle = `rgba(0,0,0,${b.dim})`; g.fillRect(0, 0, W, H); }
}

// A whole frame of one stage. stage: { kind: 'splash'|'title'|'files'|'black', t, index, sel, ready, canContinue, stars, name }
export function drawStage(g, title, W, H, imgs, st, { live = false } = {}) {
  g.clearRect(0, 0, W, H);
  const u = H / 100; // one hundredth of the height
  if (st.kind === 'black') { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return []; }
  if (st.kind === 'splash') {
    const s = title.splashes[st.index];
    if (!s) return [];
    g.fillStyle = s.bg; g.fillRect(0, 0, W, H);
    const a = Math.min(clamp01(st.t / FADE), clamp01((s.seconds - st.t) / FADE));
    g.save();
    g.globalAlpha = a;
    if (s.kind === 'studio') {
      drawStar(g, W / 2, H * 0.4, u * 11, '#ffc83d');
      drawText(g, 'made with', W / 2, H * 0.6, u * 3.6, { color: s.color, outline: null, font: 'sans' });
      drawText(g, 'Studio 64', W / 2, H * 0.69, u * 8, { color: s.color, outline: null, font: 'sans' });
    } else if (s.kind === 'image') {
      if (imgs.splash?.[s.id]) contain(g, imgs.splash[s.id], W, H, s.text ? 0.62 : 0.8);
      if (s.text) drawText(g, s.text, W / 2, H * 0.9, u * 4.2, { color: s.color, outline: null, font: 'sans' });
    } else {
      drawText(g, s.text || ' ', W / 2, H * (s.sub ? 0.46 : 0.5), u * 8, { color: s.color, outline: null, font: 'sans' });
      if (s.sub) drawText(g, s.sub, W / 2, H * 0.58, u * 3.8, { color: s.color, outline: null, font: 'sans', alpha: 0.8 });
    }
    g.restore();
    return [];
  }
  if (st.kind === 'title') {
    drawBackground(g, title, W, H, imgs, { live, t: st.t });
    if (title.logo.kind === 'maker' || title.logo.kind === 'image') drawLogo(g, imgs.logo, title, W, H, st.t);
    else if (title.logo.kind === 'game' && (!live || title.bg.kind !== 'game')) drawLogo(g, imgs.gameLogo, { ...title, logo: { ...title.logo, anim: 'zoom' } }, W, H, st.t);
    const p = title.press;
    if (st.ready === false) drawText(g, 'LOADING...', W / 2, H * p.y, u * 4.4 * p.size, { color: p.color, outline: p.outline, font: p.font, alpha: 0.7 });
    else if (p.text && st.t > 1.1) {
      const on = !p.blink || (st.t % 1.1) < 0.75;
      if (on) drawText(g, p.text, W / 2, H * p.y, u * 4.4 * p.size, { color: p.color, outline: p.outline, font: p.font, alpha: clamp01((st.t - 1.1) / 0.3) });
    }
    return [];
  }
  if (st.kind === 'files') {
    const f = title.files;
    gradient(g, W, H, f.bg, f.bg2, 180);
    // a soft checker like the game's file select
    g.save(); g.globalAlpha = 0.06; g.fillStyle = '#fff';
    const cs = u * 8;
    for (let y = 0; y < H / cs + 1; y++) for (let x = 0; x < W / cs + 1; x++) if ((x + y) % 2) g.fillRect(x * cs, y * cs, cs, cs);
    g.restore();
    const a = clamp01(st.t / 0.25);
    g.save();
    g.globalAlpha = a;
    drawText(g, f.heading, W / 2, H * 0.15, u * 7.2, { color: f.color, outline: '#000000', font: title.press.font });
    let y = 0.25;
    if (f.showName && st.name) { drawText(g, st.name, W / 2, H * y, u * 3.6, { color: '#ffffff', outline: '#000000', font: title.press.font }); y += 0.05; }
    if (f.sub) drawText(g, f.sub, W / 2, H * y, u * 2.8, { color: '#ffffff', outline: null, font: 'sans', alpha: 0.85 });
    // the file card
    const cw = Math.min(W * 0.5, u * 70), ch = u * 26, cx = W / 2 - cw / 2, cy = H * 0.37;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(g, cx + u * 0.8, cy + u * 1.2, cw, ch, u * 3); g.fill();
    g.fillStyle = f.card;
    roundRect(g, cx, cy, cw, ch, u * 3); g.fill();
    g.lineWidth = u * 0.6; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
    drawText(g, 'MARIO', W / 2, cy + ch * 0.3, u * 5.6, { color: '#ffffff', outline: '#000000', font: title.press.font });
    drawStar(g, W / 2 - u * 7, cy + ch * 0.68, u * 3.6, '#ffd23f');
    drawText(g, `x ${st.stars || 0}`, W / 2 + u * 2.5, cy + ch * 0.68, u * 4.6, { color: '#ffffff', outline: '#000000', font: title.press.font });
    // the choices
    const opts = st.canContinue ? [['continue', 'CONTINUE'], ['new', 'NEW GAME']] : [['new', st.newLabel || 'START']];
    const bw = u * 30, bh = u * 9, gap = u * 4;
    const total = opts.length * bw + (opts.length - 1) * gap;
    const rects = [];
    opts.forEach(([id, label], i) => {
      const bx = W / 2 - total / 2 + i * (bw + gap), by = H * 0.72;
      const sel = (st.sel || 0) === i;
      g.fillStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.18)';
      roundRect(g, bx, by, bw, bh, bh / 2); g.fill();
      g.lineWidth = u * 0.5; g.strokeStyle = sel ? f.color : 'rgba(255,255,255,0.5)'; g.stroke();
      drawText(g, label, bx + bw / 2, by + bh / 2, u * 3.6, { color: sel ? '#1b1b3a' : '#ffffff', outline: sel ? null : '#000000', font: title.press.font });
      rects.push({ id, x: bx, y: by, w: bw, h: bh });
    });
    g.restore();
    return rects;
  }
  return [];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawStar(g, x, y, r, color) {
  g.save();
  g.beginPath();
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.46 : r, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = r * 0.14; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();
  g.fillStyle = color; g.fill();
  g.restore();
}

// ---- the engine side ---------------------------------------------------------------------------

// The game behind the launch screen: its title screen, a level fly-over, or paused under a picture.
export class TitleStage {
  // home: where the game goes after the title ({ level, custom }); none: the castle grounds
  // (the studio warps on to the hack's start by itself)
  constructor({ engine, flow = () => null, songs = () => [], home = null }) {
    Object.assign(this, { engine, flow, songs, home });
    this.mode = null;
    this.visible = false; // the engine's picture is ready to be seen
    this.raf = 0;
  }

  get M() { return this.engine.M; }
  has(fn) { return typeof this.M?.['_' + fn] === 'function'; }

  async start(title, imgs = {}) {
    const e = this.engine;
    this.title = title;
    this.imgs = imgs;
    this.visible = false;
    e.inIntro = true; // the story and other features wait while the launch screen is up
    e.setCamera?.(false);
    const kind = title.bg.kind;
    if (kind === 'game' && this.has('studio_title_enter')) {
      this.mode = 'game';
      this.setTiles(title, imgs);
      this.M._studio_title_enter(title.logo.kind === 'game' ? 1 : 0, title.bg.head ? 1 : 0);
      // the fade into the title screen, then the title loop
      await this.until(() => this.M._studio_title_state() >= 1, 3000);
      await this.wait(title.logo.kind === 'game' ? 700 : 900);
      this.visible = true;
      if (title.logo.kind !== 'game') await this.until(() => this.M._studio_title_state() === 2, 6000);
      this.music(title, title.music.kind === 'game' && title.music.seq === 0x02);
    } else if (kind === 'level') {
      this.mode = 'level';
      const ok = await this.goLevel(title.bg.level);
      if (this.has('studio_title_scene')) this.M._studio_title_scene(1);
      let m = null;
      try { m = e.state().mario; } catch { /* none */ }
      const o = title.bg.orbit;
      this.center = o.center || (m ? [m.x, m.y, m.z] : [0, 0, 0]);
      this.t0 = performance.now();
      this.fly();
      await this.wait(ok ? 250 : 0);
      this.visible = true;
      this.music(title, false);
    } else {
      this.mode = 'still';
      e.setPaused?.(true, true);
      e.audioHold?.(true);
      this.music(title, false);
      this.visible = true;
    }
  }

  // The title backdrop's tile: the game's own ("SUPER MARIO 64"), or the hack's logo on its
  // colours, or just the colours (texture overrides on the tile's four strips).
  setTiles(title, imgs) {
    const M = this.M;
    if (!this.has('studio_title_tile') || !this.has('studio_tex_set')) return;
    const mode = tileMode(title);
    this.tiles = mode !== 'game';
    if (!this.tiles) { this.unsetTiles(); return; }
    const S = 256;
    const g = tileCanvas(title, imgs, S).getContext('2d');
    for (let i = 0; i < 4; i++) {
      const data = g.getImageData(0, (i * S) / 4, S, S / 4).data;
      const p = M._malloc(data.length);
      M.HEAPU8.set(data, p);
      M._studio_tex_set(M._studio_title_tile(i), p, S, S / 4, i === 3 ? 1 : 0);
      M._free(p);
    }
  }
  unsetTiles() {
    if (!this.has('studio_title_tile')) return;
    for (let i = 0; i < 4; i++) this.M._studio_tex_unset(this.M._studio_title_tile(i), i === 3 ? 1 : 0);
  }

  // The title's music: game music, a song from the sound studio, or silence.
  async music(title, already) {
    const e = this.engine, mu = title.music;
    try {
      if (mu.kind === 'none') e.stopPreview();
      else if (mu.kind === 'song') {
        const song = this.songs().find((s) => s.id === mu.song);
        if (song) {
          const { encodeSong } = await import('../music.js');
          e.previewMusic(e.installSong(encodeSong(song), song.bank, true));
        }
      } else if (!already) e.previewMusic(mu.seq);
    } catch (err) { console.warn('title music', err); }
  }

  // Load the level of a fly-over: '<num>:<area>' or 'c:<id>[:<area>]'.
  async goLevel(key) {
    const e = this.engine;
    const before = performance.now();
    if (String(key).startsWith('c:')) {
      const [id, n] = key.slice(2).split(':');
      const wf = this.flow();
      if (Number(n) > 1 && wf?.goArea) wf.goArea({ custom: id, area: Number(n) }, { intro: false });
      else e.warpFast(e.studioLevel, 0, id, false);
    } else {
      const [num] = String(key).split(':').map(Number);
      e.warpFast(num || 16, 1, null, false);
    }
    return this.arrived(before);
  }

  // A level loaded after `since` and Mario is in it.
  arrived(since, ms = 30000) {
    return new Promise((resolve) => {
      const e = this.engine;
      let loaded = false;
      const onArea = () => { loaded = true; };
      e.on('area', onArea);
      const t0 = performance.now();
      const poll = () => {
        let m = null;
        try { m = e.state().mario; } catch { /* loading */ }
        if (loaded && m) { e.off('area', onArea); resolve(true); } else if (performance.now() - t0 > ms) { e.off('area', onArea); resolve(false); } else setTimeout(poll, 100);
      };
      void since;
      poll();
    });
  }

  // The fly-over camera: a slow circle around the level's middle (or the spot that was picked).
  fly() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.mode !== 'level') return;
      const o = this.title.bg.orbit;
      const t = (performance.now() - this.t0) / 1000;
      const a = t * 0.12 * o.speed;
      const c = this.center;
      try { this.engine.setCamera(true, [c[0] + Math.sin(a) * o.radius, c[1] + o.height, c[2] + Math.cos(a) * o.radius], [c[0], c[1] + 150, c[2]], 50); } catch { /* reloading */ }
      this.raf = requestAnimationFrame(step);
    };
    step();
  }

  // Back to a normal game (the caller then warps to the hack's start).
  async stop() {
    const e = this.engine;
    cancelAnimationFrame(this.raf);
    const mode = this.mode;
    this.mode = null;
    try {
      if (mode === 'game') {
        e.stopPreview?.();
        if (this.tiles) { this.unsetTiles(); this.tiles = false; }
        if (this.M._studio_title_state() !== 0) {
          const home = this.home;
          const arrive = this.arrived(0, 20000);
          this.M._studio_title_leave(home && !home.custom ? (Number(home.level) || 16) : 16);
          await this.until(() => this.M._studio_title_state() === 0, 15000);
          e.inIntro = false;
          await arrive;
          if (home?.custom) await this.goLevel(`c:${home.custom}`);
        }
      } else if (mode === 'level') {
        e.setCamera(false);
        if (this.has('studio_title_scene')) this.M._studio_title_scene(0);
        e.restoreMusic?.();
        const home = this.home;
        if (home) { e.inIntro = false; await this.goLevel(home.custom ? `c:${home.custom}` : `${Number(home.level) || 16}:1`); }
      } else if (mode === 'still') {
        e.setPaused?.(false, false);
        e.audioHold?.(false);
        e.restoreMusic?.();
      }
    } catch (err) { console.warn('title stop', err); }
    e.inIntro = false;
  }

  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  until(fn, ms) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const poll = () => { let ok = false; try { ok = fn(); } catch { /* not yet */ } if (ok) resolve(true); else if (performance.now() - t0 > ms) resolve(false); else setTimeout(poll, 60); };
      poll();
    });
  }
}

// ---- the screen ---------------------------------------------------------------------------------

export class TitleScreen {
  // host: the element over the game; headers: for the studio's files (password)
  constructor({ host, headers = () => ({}), base = () => (typeof window !== 'undefined' ? window.studioAssetBase || '' : ''), legal = '' }) {
    injectCss();
    Object.assign(this, { host, headers, base, legal });
    this.imgs = { splash: {} };
    this.title = normalizeTitle(null);
  }

  setTitle(t) { this.title = normalizeTitle(t); }

  // Every picture the title uses.
  async load(title = this.title, { levelPicture = null } = {}) {
    this.loaded = false;
    const h = this.headers();
    const url = (f) => titleFileUrl(f, this.base());
    const [logo, bg, level] = await Promise.all([
      title.logo.kind === 'maker' || title.logo.kind === 'image' ? loadImage(url(title.logo.file), h) : null,
      title.bg.kind === 'image' ? loadImage(url(title.bg.file), h) : null,
      levelPicture ? loadImage(levelPicture(title.bg.level), h) : null,
    ]);
    this.imgs.logo = logo;
    this.imgs.bg = bg;
    this.imgs.level = level;
    for (const s of title.splashes) if (s.kind === 'image' && s.file) this.imgs.splash[s.id] = await loadImage(url(s.file), h);
    if (title.logo.kind === 'game' && !this.imgs.gameLogo) {
      const { renderLogo } = await import('./logo_maker.js');
      this.imgs.gameLogo = renderLogo(MAKER_DEFAULT, { scale: 0.5 });
    }
    await fontReady;
    this.loaded = true;
    return this.imgs;
  }

  // Play the launch screen. Resolves { choice: 'continue' | 'new' } or { cancel: true } (Esc in the studio).
  // stage: a TitleStage (null: no engine background); ready(): the game can start (player loading).
  run({ stage = null, ready = () => true, canContinue = false, stars = 0, name = '', cancelable = false, newLabel = '' } = {}) {
    const title = this.title;
    const el = document.createElement('div');
    el.className = 'ttl-screen';
    el.tabIndex = 0;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Title screen');
    el.innerHTML = `<canvas></canvas>${this.legal ? `<div class="ttl-legal"></div>` : ''}<div class="ttl-skip" hidden></div>`;
    if (this.legal) el.querySelector('.ttl-legal').textContent = this.legal;
    this.host.appendChild(el);
    this.el = el;
    document.body.classList.add('ttl-on');
    const canvas = el.querySelector('canvas');
    const g = canvas.getContext('2d');
    const skip = el.querySelector('.ttl-skip');
    el.focus({ preventScroll: true });

    const seq = [...title.splashes.map((s, i) => ({ kind: 'splash', index: i, seconds: s.seconds })), { kind: 'title' }];
    if (title.files.on) seq.push({ kind: 'files' });
    let at = 0, t0 = performance.now(), sel = 0, rects = [], done = false, stageStarted = false, finishing = false;
    const st = () => seq[at];
    const pads = new Map();
    let resolveRun;
    const result = new Promise((r) => { resolveRun = r; });
    this.state = () => ({ stage: st()?.kind, index: at, sel, splashes: title.splashes.length });

    const next = () => {
      if (finishing) return;
      if (at < seq.length - 1) { at++; t0 = performance.now(); sel = 0; }
    };
    const finish = async (res) => {
      if (finishing) return;
      finishing = true;
      // to black, then the game goes back to normal under it
      const fadeStart = performance.now();
      this.fadeOut = () => clamp01((performance.now() - fadeStart) / 350);
      await new Promise((r) => setTimeout(r, 360));
      if (stage) await stage.stop();
      done = true;
      resolveRun(res);
    };
    const confirm = () => {
      const s = st();
      if (!s || finishing) return;
      if (s.kind === 'splash') return next();
      if (s.kind === 'title') {
        if (!ready() || this.loaded === false || (stage && !stage.visible && needsEngine(title))) return;
        if (seq[at + 1]) { stage?.engine?.playGameSound?.(0x701EFF81 >>> 0); return next(); }
        return finish({ choice: canContinue ? 'continue' : 'new' });
      }
      if (s.kind === 'files') {
        const opts = canContinue ? ['continue', 'new'] : ['new'];
        stage?.engine?.playGameSound?.(0x701EFF81 >>> 0);
        return finish({ choice: opts[sel] || 'new' });
      }
    };
    const back = () => {
      const s = st();
      if (s?.kind === 'files') { at--; t0 = performance.now() - 2000; return; }
      if (cancelable) finish({ cancel: true });
    };
    const move = (d) => {
      if (st()?.kind !== 'files' || !canContinue) return;
      sel = Math.max(0, Math.min(1, sel + d));
    };
    this.press = confirm; // (tests)
    const key = (e) => {
      if (done) return 'pass';
      if (e.type !== 'keydown') return;
      if (['Enter', ' ', 'Spacebar'].includes(e.key) || e.code === 'KeyK' || e.code === 'KeyJ') { e.preventDefault(); confirm(); }
      else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.code === 'KeyA') { e.preventDefault(); move(-1); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.code === 'KeyD') { e.preventDefault(); move(1); }
      else if (e.key === 'Tab') e.preventDefault();
      return true;
    };
    const traps = window.studioKeyTraps;
    if (traps) traps.push(key); else el.addEventListener('keydown', key);
    const toLocal = (ev) => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * (canvas.width / r.width), (ev.clientY - r.top) * (canvas.height / r.height)]; };
    el.addEventListener('mousemove', (ev) => {
      if (st()?.kind !== 'files') return;
      const [x, y] = toLocal(ev);
      const i = rects.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (i >= 0) sel = i;
    });
    el.addEventListener('click', (ev) => {
      el.focus({ preventScroll: true });
      if (st()?.kind === 'files') {
        const [x, y] = toLocal(ev);
        const i = rects.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
        if (i < 0) return;
        sel = i;
      }
      confirm();
    });

    const pad = () => {
      for (const gp of (navigator.getGamepads?.() || [])) {
        if (!gp) continue;
        const was = pads.get(gp.index) || {};
        const now = { a: gp.buttons[0]?.pressed, b: gp.buttons[1]?.pressed, start: gp.buttons[9]?.pressed, l: gp.buttons[14]?.pressed || gp.axes[0] < -0.6, r: gp.buttons[15]?.pressed || gp.axes[0] > 0.6 };
        if ((now.a && !was.a) || (now.start && !was.start)) confirm();
        if (now.b && !was.b) back();
        if (now.l && !was.l) move(-1);
        if (now.r && !was.r) move(1);
        pads.set(gp.index, now);
      }
    };

    const frame = () => {
      if (this.el !== el) return; // closed
      if (done) {
        // black until the caller has the game in its first level (close())
        g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
        requestAnimationFrame(frame);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(2, Math.round(el.clientWidth * dpr)), H = Math.max(2, Math.round(el.clientHeight * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      pad();
      const s = st();
      let t = (performance.now() - t0) / 1000;
      if (s.kind === 'splash' && t >= s.seconds) { next(); t = 0; }
      // the game's background starts with the title (the splashes cover the loading)
      if (stage && seq[at].kind !== 'splash' && !stageStarted && ready()) {
        stageStarted = true;
        stage.start(title, this.imgs).catch((err) => console.warn('title stage', err));
      }
      const cur = seq[at];
      const live = !!stage && needsEngine(title);
      const waiting = cur.kind === 'title' && ((live && !stage.visible) || this.loaded === false);
      const tt = waiting ? 0 : (performance.now() - t0) / 1000;
      if (waiting) t0 = performance.now(); // the logo waits for the game's picture and its own
      rects = drawStage(g, title, W, H, this.imgs, { kind: cur.kind, t: tt, index: cur.index, sel, ready: ready() && (!live || stage.visible), canContinue, stars, name, newLabel }, { live });
      // until the game shows its picture: the title's colours
      if (cur.kind === 'title' && live && !stage.visible) {
        g.save(); g.globalCompositeOperation = 'destination-over'; gradient(g, W, H, '#000000', '#0a1030', 180); g.restore();
      }
      if (cur.kind === 'splash') { skip.hidden = false; skip.textContent = 'Click to skip'; } else skip.hidden = true;
      if (this.fadeOut) { g.fillStyle = `rgba(0,0,0,${this.fadeOut()})`; g.fillRect(0, 0, W, H); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    this.untrap = () => { if (traps) { const i = traps.lastIndexOf(key); if (i >= 0) traps.splice(i, 1); } };
    return result.then((r) => { this.untrap(); return r; });
  }

  // Take the (black) launch screen away once the game is in its first level.
  close() {
    const el = this.el;
    if (!el) return;
    this.el = null;
    this.untrap?.();
    document.body.classList.remove('ttl-on');
    this.fadeOut = null;
    // keep the last (black) frame and fade it out
    el.classList.add('out');
    el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 380);
  }

  get open() { return !!this.el; }
}

// A still picture of the title (the home card's cover when the project has none).
export function titleStill(title, imgs, W = 960, H = 540) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  drawStage(g, normalizeTitle(title), W, H, imgs, { kind: 'title', t: 2, ready: true }, { live: false });
  return c;
}
