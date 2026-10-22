// The launch screen's data (project.title): what players see when the hack starts, before the
// first level. Shared by the studio (title_ui.js), the runtime (title_screen.js), the player and
// the server (routes/title.js validates with normalizeTitle).
//
// {
//   on,                                   the launch screen is used (Play from start, the player)
//   splashes: [{ id, kind: studio|text|image, text, sub, file, bg, color, seconds }],
//   logo: { kind: maker|image|game|none, file, w, h, maker: {...}, anim, x, y, scale },
//   bg: { kind: game|color|gradient|image|level, head, tiles: auto|game|logo|plain (the game's backdrop), color, color2, angle, file, dim, level, orbit },
//   press: { text, color, outline, blink, y, size, font },
//   music: { kind: game|song|none, seq, song },
//   files: { on, heading, sub, color, bg, bg2, card, showName },
//   cover,                                a still of the title (home card when there is no cover)
// }

export const LOGO_ANIMS = [
  ['wobble', 'Wobble', 'Bounces in, then sways like the game\'s logo'],
  ['zoom', 'Zoom in', 'Grows from the middle with a bounce'],
  ['wave', 'Wave', 'Waves like a flag'],
  ['float', 'Float', 'Fades in and floats up and down'],
  ['drop', 'Drop', 'Falls in from the top and bounces'],
  ['fade', 'Fade', 'Fades in'],
  ['none', 'Still', 'No animation'],
];

export const BG_KINDS = [
  ['game', 'The game\'s title', 'Mario\'s face (Goddard) over the title backdrop, live in the game'],
  ['level', 'A level', 'A camera flies around one of your levels'],
  ['gradient', 'Gradient', 'Two colours'],
  ['color', 'Colour', 'One colour'],
  ['image', 'Picture', 'An image you upload'],
];

export const SPLASH_KINDS = [['studio', 'Made with Studio 64'], ['text', 'Text'], ['image', 'Picture']];

// Display fonts for the logo maker (Google Fonts in the studio; the logo is saved as a picture,
// so the player needs none of them). The last ones are on every computer.
export const FONTS = [
  ['Lilita One', 'Lilita One'], ['Luckiest Guy', 'Luckiest Guy'], ['Titan One', 'Titan One'], ['Bungee', 'Bungee'],
  ['Fredoka', 'Fredoka'], ['Baloo 2', 'Baloo 2'], ['Chewy', 'Chewy'], ['Bangers', 'Bangers'],
  ['Russo One', 'Russo One'], ['Righteous', 'Righteous'], ['Black Ops One', 'Black Ops One'], ['Creepster', 'Creepster'],
  ['Press Start 2P', 'Press Start 2P'], ['Permanent Marker', 'Permanent Marker'], ['Rubik Mono One', 'Rubik Mono One'],
  ['Arial Black', 'Arial Black (system)'], ['Impact', 'Impact (system)'], ['Georgia', 'Georgia (system)'],
];
export const WEB_FONTS = FONTS.map(([f]) => f).filter((f) => !['Arial Black', 'Impact', 'Georgia'].includes(f));

export const EMBLEMS = [['none', 'None'], ['star', 'Star'], ['mushroom', 'Mushroom'], ['coin', 'Coin'], ['heart', 'Heart'], ['crown', 'Crown'], ['shell', 'Shell']];
export const FILLS = [['letters', 'Colourful letters'], ['gradient', 'Gradient'], ['solid', 'One colour']];

// The logo maker's look; presets set many of these at once.
export const MAKER_DEFAULT = {
  text: 'SUPER MARIO', sub: '64', font: 'Lilita One', weight: 400,
  fill: 'letters', colors: ['#e52521', '#1a5fd8', '#f8c800', '#20a33a'], c1: '#ffe14d', c2: '#ff8a00',
  outline: '#1b1b3a', outlineW: 10, extrude: 14, extrudeColor: '#0b0b24', angle: 120,
  shine: true, shadow: 0.5, arc: 18, sub2: { color: '#ffd23f', c2: '#ff7a00', scale: 1.15 },
  emblem: 'none', emblemColor: '#f8c800', emblemPos: 'left', tilt: 0, spacing: 0,
};

export const PRESETS = [
  { id: 'super64', name: 'Super 64', maker: {} },
  { id: 'gold', name: 'Gold', maker: { fill: 'gradient', c1: '#fff3a0', c2: '#d08a00', outline: '#4a2600', extrudeColor: '#2a1400', emblem: 'star', emblemColor: '#ffd23f', sub2: { color: '#ffffff', c2: '#ffd23f', scale: 1.1 } } },
  { id: 'spooky', name: 'Spooky', maker: { font: 'Creepster', fill: 'gradient', c1: '#c9ff6b', c2: '#3c8c1e', outline: '#160b24', extrudeColor: '#2b0f3d', arc: 6, sub2: { color: '#b38cff', c2: '#5a2d9e', scale: 1.1 } } },
  { id: 'ice', name: 'Ice', maker: { font: 'Titan One', fill: 'gradient', c1: '#ffffff', c2: '#59c3ff', outline: '#0b3a66', extrudeColor: '#06223f', emblem: 'star', emblemColor: '#bde8ff', sub2: { color: '#bde8ff', c2: '#3b8fe0', scale: 1.1 } } },
  { id: 'lava', name: 'Lava', maker: { font: 'Luckiest Guy', fill: 'gradient', c1: '#ffe14d', c2: '#e2280b', outline: '#2a0700', extrudeColor: '#1a0400', arc: 10, sub2: { color: '#ff9a1f', c2: '#b31200', scale: 1.15 } } },
  { id: 'retro', name: 'Retro', maker: { font: 'Press Start 2P', fill: 'solid', c1: '#ffffff', outline: '#000000', outlineW: 6, extrude: 8, extrudeColor: '#e52521', arc: 0, shine: false, sub2: { color: '#f8c800', c2: '#f8c800', scale: 1 } } },
  { id: 'neon', name: 'Neon', maker: { font: 'Righteous', fill: 'gradient', c1: '#ff4fd8', c2: '#4fd8ff', outline: '#ffffff', outlineW: 5, extrude: 0, shadow: 1, arc: 0, shine: false, sub2: { color: '#fff36b', c2: '#ff9a1f', scale: 1.1 } } },
  { id: 'forest', name: 'Forest', maker: { font: 'Chewy', fill: 'letters', colors: ['#5fbf3a', '#f3c623', '#9c5a2c', '#2f8f4e'], outline: '#1b2b10', extrudeColor: '#0e1a08', emblem: 'mushroom', emblemColor: '#e52521' } },
];

export const DEFAULT_TITLE = {
  on: false,
  splashes: [],
  logo: { kind: 'maker', file: null, made: null, w: 0, h: 0, maker: MAKER_DEFAULT, anim: 'wobble', x: 0.5, y: 0.34, scale: 0.62 },
  bg: { kind: 'gradient', head: true, tiles: 'auto', color: '#1d3fbb', color2: '#05061a', angle: 180, file: null, dim: 0, level: '16:1', orbit: { speed: 1, radius: 3200, height: 1400, center: null } },
  press: { text: 'PRESS START', color: '#ffffff', outline: '#000000', blink: true, y: 0.84, size: 1, font: 'game' },
  music: { kind: 'game', seq: 0x02, song: null },
  files: { on: true, heading: 'SELECT FILE', sub: '', color: '#ffd23f', bg: '#2a5bd7', bg2: '#0c1a5c', card: '#f8c800', showName: true },
  cover: null,
};

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const str = (v, n, d = '') => (typeof v === 'string' ? v.slice(0, n) : d);
const pick = (v, list, d) => (list.some((x) => (Array.isArray(x) ? x[0] : x) === v) ? v : d);
const fileName = (v) => (typeof v === 'string' && /^[\w-]{4,80}\.(png|jpg|jpeg|webp)$/.test(v) ? v : null);
export const clone = (o) => JSON.parse(JSON.stringify(o));

export function normalizeMaker(m = {}) {
  const d = MAKER_DEFAULT;
  m = m && typeof m === 'object' ? m : {};
  const colors = Array.isArray(m.colors) ? m.colors.map((c, i) => color(c, d.colors[i % 4])).slice(0, 8) : d.colors.slice();
  const s2 = m.sub2 && typeof m.sub2 === 'object' ? m.sub2 : {};
  return {
    text: str(m.text, 40, d.text), sub: str(m.sub, 24, d.sub), font: pick(m.font, FONTS, d.font), weight: clamp(m.weight, 100, 900, d.weight),
    fill: pick(m.fill, FILLS, d.fill), colors: colors.length ? colors : d.colors.slice(), c1: color(m.c1, d.c1), c2: color(m.c2, d.c2),
    outline: color(m.outline, d.outline), outlineW: clamp(m.outlineW, 0, 30, d.outlineW), extrude: clamp(m.extrude, 0, 40, d.extrude),
    extrudeColor: color(m.extrudeColor, d.extrudeColor), angle: clamp(m.angle, 0, 360, d.angle), shine: m.shine !== undefined ? !!m.shine : d.shine,
    shadow: clamp(m.shadow, 0, 1, d.shadow), arc: clamp(m.arc, -40, 40, d.arc),
    sub2: { color: color(s2.color, d.sub2.color), c2: color(s2.c2, d.sub2.c2), scale: clamp(s2.scale, 0.4, 2, d.sub2.scale) },
    emblem: pick(m.emblem, EMBLEMS, d.emblem), emblemColor: color(m.emblemColor, d.emblemColor), emblemPos: pick(m.emblemPos, ['left', 'top', 'right', 'behind'], d.emblemPos),
    tilt: clamp(m.tilt, -20, 20, d.tilt), spacing: clamp(m.spacing, -10, 30, d.spacing),
  };
}

// A complete, safe title from anything (old projects, the AI, imports).
export function normalizeTitle(t) {
  const d = DEFAULT_TITLE;
  t = t && typeof t === 'object' ? t : {};
  const logo = t.logo || {}, bg = t.bg || {}, press = t.press || {}, music = t.music || {}, files = t.files || {};
  const orbit = bg.orbit || {};
  const c = (v) => (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : null);
  return {
    on: !!t.on,
    splashes: (Array.isArray(t.splashes) ? t.splashes : []).slice(0, 6).map((s, i) => ({
      id: str(s?.id, 24) || `s${i}${Math.random().toString(36).slice(2, 7)}`,
      kind: pick(s?.kind, SPLASH_KINDS, 'text'), text: str(s?.text, 80), sub: str(s?.sub, 120), file: fileName(s?.file),
      bg: color(s?.bg, '#000000'), color: color(s?.color, '#ffffff'), seconds: clamp(s?.seconds, 0.5, 10, 2.5),
    })),
    logo: {
      kind: pick(logo.kind, ['maker', 'image', 'game', 'none'], d.logo.kind), file: fileName(logo.file), made: str(logo.made, 40) || null,
      w: clamp(logo.w, 0, 8192, 0) | 0, h: clamp(logo.h, 0, 8192, 0) | 0, maker: normalizeMaker(logo.maker),
      anim: pick(logo.anim, LOGO_ANIMS, d.logo.anim), x: clamp(logo.x, 0, 1, d.logo.x), y: clamp(logo.y, 0, 1, d.logo.y), scale: clamp(logo.scale, 0.1, 1.2, d.logo.scale),
    },
    bg: {
      kind: pick(bg.kind, BG_KINDS, d.bg.kind), head: bg.head !== undefined ? !!bg.head : true,
      tiles: pick(bg.tiles, ['auto', 'game', 'logo', 'plain'], 'auto'),
      color: color(bg.color, d.bg.color), color2: color(bg.color2, d.bg.color2), angle: clamp(bg.angle, 0, 360, d.bg.angle),
      file: fileName(bg.file), dim: clamp(bg.dim, 0, 0.9, 0), level: str(bg.level, 60, d.bg.level) || d.bg.level,
      orbit: { speed: clamp(orbit.speed, -4, 4, 1), radius: clamp(orbit.radius, 300, 20000, 3200), height: clamp(orbit.height, -4000, 8000, 1400), center: c(orbit.center) },
    },
    press: {
      text: str(press.text, 40, d.press.text), color: color(press.color, d.press.color), outline: color(press.outline, d.press.outline),
      blink: press.blink !== undefined ? !!press.blink : true, y: clamp(press.y, 0.05, 0.98, d.press.y), size: clamp(press.size, 0.4, 3, 1),
      font: pick(press.font, ['game', 'sans', 'serif'], 'game'),
    },
    music: { kind: pick(music.kind, ['game', 'song', 'none'], 'game'), seq: clamp(music.seq, 0, 0x22, 2) | 0, song: str(music.song, 40) || null },
    files: {
      on: files.on !== undefined ? !!files.on : true, heading: str(files.heading, 40, d.files.heading), sub: str(files.sub, 80),
      color: color(files.color, d.files.color), bg: color(files.bg, d.files.bg), bg2: color(files.bg2, d.files.bg2), card: color(files.card, d.files.card),
      showName: files.showName !== undefined ? !!files.showName : true,
    },
    cover: fileName(t.cover),
  };
}

// Where a title file lives: the studio serves /api/projects/<id>/assets/title/<file>; a standalone
// export has assets/project/title/<file> (window.studioAssetBase is the "assets/" part).
export function titleFileUrl(file, base = (typeof window !== 'undefined' && window.studioAssetBase) || '') {
  return file ? `${base}title/${file}` : null;
}

// What a title needs from the engine (the rest is drawn by the page).
export const needsEngine = (t) => t.bg.kind === 'game' || t.bg.kind === 'level';

// Which logo maker settings a rendered picture shows (logo.made): the studio renders it again when they differ.
export function makerHash(m) {
  const s = JSON.stringify(normalizeMaker(m));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `m${(h >>> 0).toString(36)}`;
}
