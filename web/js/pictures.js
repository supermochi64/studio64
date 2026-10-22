// The game's pictures in web/thumbs/ (objects, levels, level templates, home screen cards). On a
// fresh install the setup makes them in the background while the studio already runs, so the app
// only asks for pictures that exist (GET /api/pictures) and shows its placeholders for the rest;
// while the setup is still taking pictures it asks again now and then, and every view that shows
// them re-renders on the 'studio:pictures' event when new ones arrived.
const have = { objects: new Set(), levels: new Set(), templates: new Set(), hub: new Set() };
let loaded = null;
let timer = null;
const key = () => `${have.objects.size}/${have.levels.size}/${have.templates.size}/${have.hub.size}`;

async function fetchList() {
  const r = await fetch('/api/pictures', { headers: { 'x-studio-key': (() => { try { return localStorage.getItem('studio64.password') || ''; } catch { return ''; } })() } });
  if (!r.ok) throw new Error(`pictures: HTTP ${r.status}`);
  return r.json();
}

async function refresh() {
  let d;
  try { d = await fetchList(); } catch { return false; }
  const before = key();
  have.objects = new Set(d.objects || []);
  have.levels = new Set((d.levels || []).map(Number));
  have.templates = new Set(d.templates || []);
  have.hub = new Set(d.hub || []);
  if (key() !== before) window.dispatchEvent(new CustomEvent('studio:pictures'));
  clearTimeout(timer);
  // still being made: look again in a while (and once more right after the step ends)
  if (d.making) timer = setTimeout(refresh, 20000);
  return true;
}

/** Loads the list once (later calls wait for the same answer). */
export function loadPictures() {
  if (!loaded) loaded = refresh();
  return loaded;
}

/** Asks the server again (e.g. after the setup's background step finished). */
export const refreshPictures = () => refresh();

/** The URL of an object's picture, or null when it has none (yet). */
export function objectPicture(id) {
  return id && have.objects.has(id) ? `thumbs/${encodeURIComponent(String(id).replace(/:/g, '__'))}.webp` : null;
}
/** The launcher picture of an original level (by level number), or null. */
export function levelPicture(num) {
  return have.levels.has(Number(num)) ? `thumbs/levels/${Number(num)}.jpg` : null;
}
/** A level template's picture (web/js/templates.js ids), or null. */
export function templatePicture(id) {
  return have.templates.has(id) ? `thumbs/templates/${id}.jpg` : null;
}
/** A home screen card's picture (castle, ...), or null. */
export function hubPicture(name) {
  return have.hub.has(name) ? `thumbs/hub/${name}.jpg` : null;
}
/** The set of catalog ids that have a picture (for code that keeps its own Set). */
export const objectPictureIds = () => have.objects;
