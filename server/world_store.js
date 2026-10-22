// The hack's structure on the server: sub-areas of custom levels (inside a
// building, a cave) and the world flow (start, hub, goal, pictures for paintings).
// index.js hands the websocket messages it doesn't know to handleWorldMessage.
import * as projects from './projects.js';

export const MAX_AREAS = 7; // the studio level slot has areas 1..7

export function areaKey(levelId, index) {
  return index > 1 ? `c:${levelId}:${index}` : `c:${levelId}`;
}

export function levelAreas(level) {
  return [{ index: 1, name: 'Main area' }, ...(level.areas || [])].sort((a, b) => a.index - b.index);
}

// A new sub-area: the next free index, its contents from the page (template).
export function createArea(p, levelId, { name, area, index } = {}) {
  const l = p.levels.find((x) => x.id === levelId);
  if (!l) throw new Error(`no custom level ${levelId}`);
  l.areas ||= [];
  const used = new Set([1, ...l.areas.map((a) => a.index)]);
  let i = index && !used.has(index) ? index : 2;
  while (used.has(i)) i++;
  if (i > MAX_AREAS) throw new Error(`a level has at most ${MAX_AREAS} areas`);
  const entry = { index: i, name: String(name || `Area ${i}`).slice(0, 60) };
  const before = projects.snapLevel(p, levelId); // undoable like level operations
  l.areas.push(entry);
  l.areas.sort((a, b) => a.index - b.index);
  p.areas[areaKey(levelId, i)] = { objects: [], removals: [], warps: [], ...(area || {}) };
  projects.recordLevelEdit(p, levelId, `Made area “${entry.name}” in “${l.name}”`, before);
  return entry;
}

export function renameArea(p, levelId, index, name) {
  const l = p.levels.find((x) => x.id === levelId);
  if (!l) return null;
  const before = projects.snapLevel(p, levelId);
  const nm = String(name).slice(0, 60);
  if (index === 1) {
    if (l.mainAreaName !== nm) { l.mainAreaName = nm; projects.recordLevelEdit(p, levelId, `Renamed an area to “${nm}”`, before); }
    return { index: 1, name: l.mainAreaName };
  }
  const a = (l.areas || []).find((x) => x.index === index);
  if (a && a.name !== nm) { a.name = nm; projects.recordLevelEdit(p, levelId, `Renamed an area to “${nm}”`, before); }
  return a;
}

export function deleteArea(p, levelId, index) {
  const l = p.levels.find((x) => x.id === levelId);
  if (!l || index === 1) return false;
  const before = projects.snapLevel(p, levelId);
  const gone = (l.areas || []).find((x) => x.index === index);
  l.areas = (l.areas || []).filter((x) => x.index !== index);
  const key = areaKey(levelId, index);
  delete p.areas[key];
  delete p.thumbs?.[key];
  // undo brings the area back with its edits
  const removed = p.changes.filter((c) => c.key === key);
  p.changes = p.changes.filter((c) => c.key !== key);
  projects.recordLevelEdit(p, levelId, `Deleted area “${gone?.name || `Area ${index}`}” of “${l.name}”`, before, removed);
  return true;
}

// The world flow: { start, hub, goal, pictures, ... } (validated loosely: it is ours).
export function setWorld(p, world, { by = null, record = true } = {}) {
  const w = world && typeof world === 'object' ? world : {};
  const size = JSON.stringify(w).length;
  if (size > 3e6) throw new Error('world settings too large');
  if (record && JSON.stringify(p.world || {}) !== JSON.stringify(w)) projects.recordProjectChange(p, ['world'], p.world || {}, worldSummary(p.world || {}, w), { by });
  p.world = w;
  // the start is also the project's boot level (the player and the project home use it)
  if (w.start?.custom && p.levels.some((l) => l.id === w.start.custom)) p.boot = { level: p.boot?.level || 16, act: 1, custom: w.start.custom };
  else if (w.start?.level) p.boot = { level: Number(w.start.level) || 16, act: 1 };
  projects.save(p);
  return p.world;
}

function worldSummary(a, b) {
  const ch = (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]);
  if (ch('start')) return 'Changed where the hack starts';
  if (ch('hub')) return 'Changed the hub';
  if (ch('goal')) return 'Changed the star goal';
  if (ch('pictures')) return 'Changed painting pictures';
  return 'Changed the world flow';
}

// Websocket messages: area_create / area_rename / area_delete / world_set.
export function handleWorldMessage(msg, { project, hub, client }) {
  const broadcastLevels = () => hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs });
  const broadcastPatch = () => hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
  switch (msg.type) {
    case 'area_create': {
      const a = createArea(project, msg.level, { name: msg.name, area: msg.area, index: Number(msg.index) || undefined });
      broadcastLevels();
      broadcastPatch();
      hub.send(client, { type: 'area_created', level: msg.level, index: a.index, name: a.name, req: msg.req });
      return true;
    }
    case 'area_rename':
      renameArea(project, msg.level, Number(msg.index), msg.name);
      broadcastLevels();
      hub.broadcast(project.id, { type: 'changes', changes: projects.changeList(project) });
      return true;
    case 'area_delete':
      deleteArea(project, msg.level, Number(msg.index));
      broadcastLevels();
      broadcastPatch();
      return true;
    case 'world_set':
      setWorld(project, msg.world, { by: client?.id || null });
      hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) }, client);
      hub.broadcast(project.id, { type: 'changes', changes: projects.changeList(project) });
      return true;
    default:
      return false;
  }
}
