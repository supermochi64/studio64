// Shared helpers of the objects features (motion, custom objects, scene panel, game rules).

export const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const newUid = () => 1 + Math.floor(Math.random() * 0x7efffffe);
export const newId = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v, n = 0) => { const k = 10 ** n; return Math.round(v * k) / k; };
export const deepCopy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export const ICONS = {
  path: '<path d="M4 19c4 0 4-6 8-6s4-8 8-8"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  swing: '<path d="M12 3v9"/><path d="M5 9c2 6 12 6 14 0"/><rect x="9" y="12" width="6" height="3" rx="1"/>',
  tilt: '<path d="M3 15 21 9"/><path d="M12 12v8M9 20h6"/>',
  fall: '<rect x="6" y="3" width="12" height="4" rx="1"/><path d="M12 10v8M8 15l4 4 4-4"/>',
  crumble: '<path d="M4 8h7l-1 3 3-1V8h7v4h-5l1 3-4-1v4H4z"/>',
  blink: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="M4 20 20 4"/>',
  conveyor: '<rect x="2" y="9" width="20" height="7" rx="3.5"/><path d="M8 12.5h7M13 10.5l2 2-2 2"/>',
  bounce: '<path d="M4 20h16"/><path d="M7 20c0-4 10-4 10 0"/><path d="M12 13V4M9 7l3-3 3 3"/>',
  sink: '<path d="M4 9h16"/><path d="M12 12v8M9 17l3 3 3-3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  block: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  obj: '<circle cx="12" cy="9" r="5"/><path d="M5 21c1-4 4-6 7-6s6 2 7 6"/>',
  enemy: '<path d="M4 14c0-5 3.6-9 8-9s8 4 8 9v1H4z"/><path d="M8 19l2-4M16 19l-2-4M9 10h.01M15 10h.01"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  prefab: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="8" y="13" width="8" height="8" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  gamepad: '<path d="M6 9h4M8 7v4"/><path d="M15 9h.01M18 11h.01"/><path d="M7 5h10a5 5 0 0 1 5 5v2a4 4 0 0 1-7 2.6L14 13h-4l-1 1.6A4 4 0 0 1 2 12v-2a5 5 0 0 1 5-5z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  alMin: '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
  alMid: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  alMax: '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
  alBottom: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
  alTop: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
  spread: '<path d="M4 4v16M20 4v16"/><rect x="9" y="8" width="6" height="8" rx="1"/>',
  ground: '<path d="M3 20h18"/><path d="M12 4v10M8 10l4 4 4-4"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
};
export const svg = (name, cls = 'i sm') => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;

// Project-wide data ("@game" in the patch): rules, prefabs, custom object definitions.
export const GAME_KEY = '@game';

export class Store {
  constructor({ engine, send, toast, flash }) {
    this.engine = engine;
    this.send = send;
    this.toast = toast;
    this.flash = flash || (() => {});
  }
  game(field, fallback = null) {
    const a = this.engine.patch?.areas?.[GAME_KEY];
    return a && a[field] !== undefined && a[field] !== null ? a[field] : fallback;
  }
  setGame(field, value, summary) {
    const areas = (this.engine.patch.areas ||= {});
    const a = (areas[GAME_KEY] ||= { objects: [], removals: [], warps: [] });
    a[field] = value;
    this.send({ type: 'edit', op: { type: 'area', key: GAME_KEY, field, value, summary } });
    this.flash();
  }
  area(key = this.engine.areaKey()) {
    const areas = (this.engine.patch.areas ||= {});
    return (areas[key] ||= { objects: [], removals: [], warps: [] });
  }
  setArea(field, value, summary, key = this.engine.areaKey()) {
    this.area(key)[field] = value;
    this.send({ type: 'edit', op: { type: 'area', key, field, value, summary } });
    this.flash();
  }
  records(key) { return this.area(key).objects; }
  recordOf(uid) {
    if (!uid) return null;
    for (const a of Object.values(this.engine.patch.areas || {})) {
      const r = (a.objects || []).find((x) => x.uid === uid);
      if (r) return r;
    }
    return null;
  }
  commit(op) {
    this.send({ type: 'edit', op: { key: this.engine.areaKey(), ...op } });
    this.flash();
  }
}

// A float array in the engine's memory for one call.
export function withFloats(engine, values, fn) {
  const M = engine.M;
  const p = M._malloc(values.length * 4 + 4);
  try {
    new Float32Array(M.HEAPU8.buffer, p, values.length).set(values);
    return fn(p, values.length);
  } finally {
    M._free(p);
  }
}

// The level a patch key belongs to, for per-level rules: "c:<id>" or the level number.
export function levelKeyOf(engine) {
  return engine.level === engine.studioLevel ? `c:${engine.customLevel || 'default'}` : String(engine.level);
}
