// The game's text: its character set (the decomp's notation, e.g. [A] for the A button, ★, $ for a
// coin), glyph widths, line wrapping, pages, and a canvas preview in the real dialog font.
// Data from tools/gen_story_data.py (web/data/story_texts.json + story_font.png).

export const LINE_MAX = 134;          // widest line that fits the dialog box (the game's own reach 133)
export const DIALOG_BASE = 256;       // engine ids of project dialogs
export const VOICES = ['None', 'Ukiki', 'Big penguin', 'Bowser (intro)', 'Koopa', 'King Bob-omb', 'Boo', 'Bob-omb Buddy', 'Bowser laugh', 'Boss grunt', 'Wiggler', 'Yoshi'];
// The places the game puts its boxes: [x, y] of the box's top left on the 320x240 screen.
export const BOX_SPOTS = { top_left: [30, 200], top: [95, 200], top_right: [150, 200], middle: [95, 150] };
export const CREDIT_CHARS = /[^A-Z .346]/g; // what the credits font can draw

let data = null;
let loading = null;
let tokens = null;   // [text, code] longest first
let font = null;

export function loadTexts(base = '') {
  if (data) return Promise.resolve(data);
  loading ||= fetch(`${base}data/story_texts.json`).then((r) => r.json()).then((d) => {
    data = d;
    tokens = Object.entries(d.charmap).filter(([k]) => k !== 'the' && k !== 'you' && k !== '↔').sort((a, b) => b[0].length - a[0].length);
    return d;
  });
  return loading;
}
export const texts = () => data;
// The server has no fetch of its own files: it hands the data over.
export function useTexts(d) {
  data = d;
  tokens = Object.entries(d.charmap).filter(([k]) => k !== 'the' && k !== 'you' && k !== '↔').sort((a, b) => b[0].length - a[0].length);
}

export function loadFont(base = '') {
  if (font) return Promise.resolve(font);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { font = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = `${base}data/story_font.png`;
  });
}

// Plain text -> the game's codes. Quotes become the game's curly quotes; letters with accents
// lose them; anything else the font can't draw becomes a space (reported in `bad`).
export function encode(text, bad = null) {
  const out = [];
  let quote = false;
  const s = String(text ?? '').replace(/\r/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\t/g, '  ');
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === '"') { out.push(quote ? 0xF6 : 0xF5); quote = !quote; i++; continue; }
    let hit = null;
    for (const [k, v] of tokens) if (s.startsWith(k, i)) { hit = [k, v]; break; }
    if (hit) { out.push(hit[1]); i += hit[0].length; continue; }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const t = tokens.find(([k]) => k === plain);
    if (t) out.push(t[1]);
    else { out.push(0x9E); if (bad && ch.trim()) bad.add(ch); }
    i++;
  }
  return out;
}

export function encodeBytes(text) {
  const codes = encode(text);
  codes.push(0xFF);
  return Uint8Array.from(codes);
}

// Width of one encoded line in screen pixels.
export function codesWidth(codes, starCount = 8) {
  let w = 0;
  for (const c of codes) {
    if (c === 0xD0) w += data.widths[0x9E] * 2;
    else if (c === 0xE0) w += String(starCount).length * 7;
    else if (c !== 0xFE) w += data.widths[c] || 0;
  }
  return w;
}
export const textWidth = (line) => codesWidth(encode(line));

// Wrap paragraphs so no line is wider than the box. Explicit line breaks stay.
export function wrap(text, max = LINE_MAX) {
  const out = [];
  for (const para of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next) <= max || !line) line = next;
      else { out.push(line); line = word; }
      // a single word wider than the box: cut it
      while (textWidth(line) > max && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && textWidth(line.slice(0, k)) > max) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

// Pages as the game shows them: `lines` lines per box.
export function pages(text, lines = 4) {
  const all = String(text ?? '').split('\n');
  const out = [];
  for (let i = 0; i < all.length; i += lines) out.push(all.slice(i, i + lines));
  return out.length ? out : [['']];
}

// Problems worth showing next to the editor.
export function check(text, { lines = 4, question = false } = {}) {
  const issues = [];
  const bad = new Set();
  const rows = String(text ?? '').split('\n');
  rows.forEach((r, i) => {
    const w = codesWidth(encode(r, bad));
    if (w > LINE_MAX) issues.push({ line: i, level: 'error', text: `Line ${i + 1} is too long for the box (${w} of ${LINE_MAX} px)` });
  });
  if (bad.size) issues.push({ level: 'warn', text: `Not in the game's font: ${[...bad].join(' ')} (shown as spaces)` });
  if (encode(text).length > 1500) issues.push({ level: 'warn', text: 'Very long dialog: players skim after a few boxes' });
  if (question && rows.length % lines === 0 && rows.length > 0) { /* the choice line is part of the text */ }
  return issues;
}

// The final text of a dialog record: wrapped text plus the Yes/No line.
export function dialogText(d) {
  let t = d.wrap === false ? String(d.text ?? '') : wrap(d.text ?? '');
  if (d.question) t += `\n${choiceLine(d.yes, d.no)}`;
  return t;
}

// The game's choice line: the cursor sits 9 px and 65 px into the line, so the first answer
// starts 20 px in (two "/" of 10 px) and the second at 76 px.
export function choiceLine(yes = 'Yes', no = 'No') {
  let a = String(yes || 'Yes');
  while (a.length > 1 && textWidth(a) > 50) a = a.slice(0, -1);
  let b = String(no || 'No');
  while (b.length > 1 && textWidth(b) > 56) b = b.slice(0, -1);
  const gap = 76 - 20 - textWidth(a);
  const slashes = Math.floor(gap / 10), spaces = Math.round((gap - slashes * 10) / 5);
  return `//${a}${'/'.repeat(slashes)}${' '.repeat(spaces)}${b}`;
}

// Draw a page of a dialog into a canvas (320x240 game screen units, scaled).
export function drawDialog(canvas, d, page = 0, { scale = 2, background = null, starCount = 8 } = {}) {
  const g = canvas.getContext('2d');
  canvas.width = 320 * scale;
  canvas.height = 240 * scale;
  g.imageSmoothingEnabled = false;
  g.save();
  g.scale(scale, scale);
  if (background) g.drawImage(background, 0, 0, 320, 240);
  else {
    const grd = g.createLinearGradient(0, 0, 0, 240);
    grd.addColorStop(0, '#5aa0e8'); grd.addColorStop(0.62, '#a6d3f5'); grd.addColorStop(0.63, '#4f9a3e'); grd.addColorStop(1, '#2f6e27');
    g.fillStyle = grd;
    g.fillRect(0, 0, 320, 240);
  }
  const lines = d.lines || 4;
  const left = d.left ?? 30, top = d.top ?? 200;
  const sign = d.kind === 'sign';
  // the box: 130x80 at scale (1.1, lines/5 + 0.1), from (left - 7, top + 5) going down (N64 y is up)
  const bw = 130 * 1.1, bh = 80 * (lines / 5 + 0.1);
  const bx = left - 7, by = 240 - (top + 5);
  g.fillStyle = sign ? 'rgba(255,255,255,0.59)' : 'rgba(0,0,0,0.59)';
  g.fillRect(bx, by, bw, bh);
  const all = pages(dialogText(d), lines);
  const pg = all[Math.min(page, all.length - 1)] || [];
  const tint = sign ? [0, 0, 0] : [255, 255, 255];
  pg.forEach((row, i) => {
    let x = left;
    const y = 238 - top + 16 * i; // top of the glyphs (the game's lines are 16 apart)
    for (const c of encode(row)) {
      if (c === 0xD0) { x += data.widths[0x9E] * 2; continue; }
      if (c === 0xE0) {
        for (const ch of String(starCount)) { drawGlyph(g, Number(ch), x, y, tint); x += 7; }
        continue;
      }
      drawGlyph(g, c, x, y, tint);
      x += data.widths[c] || 0;
    }
  });
  // the choice arrow and the "more" triangle
  if (page < all.length - 1) {
    g.fillStyle = sign ? '#000' : '#fff';
    const tx = left + 118, ty = 238 - top + 16 * (lines - 1) + 10;
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 8, ty); g.lineTo(tx + 4, ty + 6); g.fill();
  } else if (d.question) {
    g.fillStyle = sign ? '#000' : '#fff';
    const row = pg.length - 1;
    const ty = 238 - top + 16 * row + 4;
    g.beginPath(); g.moveTo(left + 2, ty); g.lineTo(left + 8, ty + 4); g.lineTo(left + 2, ty + 8); g.fill();
  }
  g.restore();
  return all.length;
}

const glyphCache = new Map();
function drawGlyph(g, code, x, y, tint) {
  if (!font) return;
  const key = `${code}|${tint.join(',')}`;
  let c = glyphCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = 8; c.height = 16;
    const cg = c.getContext('2d');
    cg.drawImage(font, (code % 16) * 8, Math.floor(code / 16) * 16, 8, 16, 0, 0, 8, 16);
    cg.globalCompositeOperation = 'source-in';
    cg.fillStyle = `rgb(${tint.join(',')})`;
    cg.fillRect(0, 0, 8, 16);
    glyphCache.set(key, c);
  }
  g.drawImage(c, x, y);
}

// The palette of special glyphs the editor offers.
export const SPECIALS = [
  ['[A]', 'A button'], ['[B]', 'B button'], ['[Z]', 'Z trigger'], ['[R]', 'R button'], ['[C]', 'C buttons'],
  ['^', 'C up'], ['|', 'C down'], ['<', 'C left'], ['>', 'C right'], ['★', 'Star'], ['☆', 'Empty star'],
  ['$', 'Coin'], ['×', 'Times'], ['[%]', 'Number (stars needed)'], ['+', 'Arrows'], ['~', 'Wave'], ['&', 'And'],
];

// Course names keep the game's number prefix (" 1 "); act names are upper case.
export function courseText(index, name) {
  const orig = data?.courses?.[index]?.text || '   ';
  return orig.slice(0, 3) + String(name ?? '').toUpperCase();
}
export const courseName = (index) => (data?.courses?.[index]?.text || '').slice(3);

// A credits page as the engine wants it: "<layout digit><title>\n<line2>..."
export function creditsText(page) {
  if (!page) return null;
  const clean = (s) => String(s ?? '').toUpperCase().replace(CREDIT_CHARS, ' ').trim().slice(0, 30);
  const title = (page.title || []).map(clean).filter(Boolean).slice(0, 2);
  const names = (page.names || []).map(clean).filter(Boolean).slice(0, 3);
  if (!title.length && !names.length) return '';
  let code;
  if (title.length === 2) { code = names.length >= 3 ? 5 : 4; names.length = Math.min(names.length, code === 5 ? 3 : 2); }
  else code = Math.max(1, names.length);
  return [`${code}${title[0] || ''}`, ...(title.length === 2 ? [title[1]] : []), ...names].join('\n');
}
