// One Claude conversation per project. Runs through the Claude Agent SDK, so it
// uses the Claude Code login on this machine (Pro/Max subscription) or
// ANTHROPIC_API_KEY when that is set. Claude gets only the studio tools below:
// no shell, no files, no web.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { SYSTEM_PROMPT } from './prompt.js';
import { search, levelByKey, levelName, getEntry, friendlyName } from './catalog.js';
import * as projects from './projects.js';
import { CLAUDE_MODELS, defaultModel, isKnownModel, isLoopModel, canRun } from './ai/config.js';
import { LoopSession, handoffNote } from './ai/loop.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Tool plug-ins: every server/tools/*.js default-exports (ctx) => [tool(...), ...] (see makeTools).
const PLUGINS = [];
for (const f of fs.readdirSync(path.join(here, 'tools')).filter((x) => x.endsWith('.js')).sort()) {
  PLUGINS.push((await import(`./tools/${f}`)).default);
}
const SANDBOX = path.join(here, 'sandbox');
fs.mkdirSync(SANDBOX, { recursive: true });

// Claude models of the Agent SDK path; other providers (server/ai/) add '@provider/model' ids.
export const MODELS = CLAUDE_MODELS;
export const DEFAULT_MODEL = process.env.STUDIO_MODEL || 'claude-opus-5-5';

const where = z.object({
  mode: z.enum(['in_front', 'line', 'grid', 'around', 'relative', 'at', 'near_object']).optional()
    .describe('default in_front (or at, when x/z are given)'),
  distance: z.number().optional().describe('in_front/line/grid: units ahead of Mario (default 350); near_object: gap from the object'),
  spacing: z.number().optional().describe('gap between multiple objects (default 180)'),
  radius: z.number().optional().describe('around: circle radius (default 400)'),
  forward: z.number().optional(),
  right: z.number().optional().describe('relative: units to Mario\'s right (negative = left)'),
  x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
  slot: z.number().optional(), uid: z.number().optional(),
  y_offset: z.number().optional().describe('raise above the ground, e.g. 300 for floating coins'),
  snap: z.boolean().optional().describe('snap to the ground (default true)'),
}).describe('where to put it');

// The sound studio's data: the instrument sets, the game's sounds, the synth presets.
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
let sSets = null, sGameSounds = null;
function soundSets() {
  if (!sSets) {
    const banks = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'instruments.json'), 'utf8')).banks;
    sSets = banks.map((b) => {
      const drum = (n) => b.drums.find((d) => d.label === n)?.note;
      return { set: b.bank, name: b.name, instruments: b.programs.map((x) => [x.program, x.label]),
        drums: b.drums.length ? { kick: drum('Kick'), snare: drum('Snare'), hihat: drum('Hi-hat'), cymbal: drum('Cymbal'), tom: drum('Tom'), other: b.drums.length } : undefined };
    });
  }
  return sSets;
}
function gameSoundsFind(term) {
  sGameSounds ||= JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'sounds.json'), 'utf8'));
  const t = term.toLowerCase().trim();
  return sGameSounds.find((x) => x.name.toLowerCase() === t) || sGameSounds.find((x) => x.name.toLowerCase().startsWith(t))
    || sGameSounds.find((x) => `${x.group} ${x.name}`.toLowerCase().includes(t));
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function notePitch(v) {
  if (typeof v === 'number') return v;
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(v).trim());
  if (!m) return null;
  return NOTE_NAMES.indexOf(m[1].toUpperCase()) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
const SFX_BASE = { wave: 'square', duty: 0.5, freq: 440, freqEnd: 440, attack: 0, sustain: 0.08, decay: 0.2, vibrato: 0, vibratoSpeed: 8, jump: 1, jumpAt: 0.5, filter: 1, volume: 0.8 };
const SFX_PRESETS = {
  coin: { ...SFX_BASE, freq: 988, freqEnd: 988, sustain: 0.06, decay: 0.32, jump: 1.335, jumpAt: 0.12 },
  jump: { ...SFX_BASE, duty: 0.3, freq: 280, freqEnd: 720, sustain: 0.04, decay: 0.2 },
  powerup: { ...SFX_BASE, freq: 330, freqEnd: 1320, sustain: 0.2, decay: 0.3, vibrato: 0.15, vibratoSpeed: 14 },
  laser: { ...SFX_BASE, wave: 'sawtooth', freq: 1400, freqEnd: 180, sustain: 0.02, decay: 0.22, filter: 0.8 },
  explosion: { ...SFX_BASE, wave: 'noise', freq: 900, freqEnd: 60, sustain: 0.08, decay: 0.7, filter: 0.6 },
  hit: { ...SFX_BASE, wave: 'noise', freq: 1600, freqEnd: 400, sustain: 0.01, decay: 0.14 },
  blip: { ...SFX_BASE, duty: 0.25, freq: 720, freqEnd: 720, sustain: 0.03, decay: 0.06 },
  bounce: { ...SFX_BASE, wave: 'triangle', freq: 180, freqEnd: 620, sustain: 0.05, decay: 0.18 },
  magic: { ...SFX_BASE, wave: 'triangle', freq: 700, freqEnd: 1700, sustain: 0.25, decay: 0.45, vibrato: 0.35, vibratoSpeed: 16 },
  oneup: { ...SFX_BASE, freq: 660, freqEnd: 660, sustain: 0.18, decay: 0.25, jump: 2, jumpAt: 0.35 },
  hurt: { ...SFX_BASE, wave: 'sawtooth', freq: 500, freqEnd: 120, sustain: 0.05, decay: 0.3, vibrato: 0.4, vibratoSpeed: 30 },
  wind: { ...SFX_BASE, wave: 'noise', freq: 300, freqEnd: 500, attack: 0.3, sustain: 0.6, decay: 0.6, filter: 0.25, volume: 0.6 },
};
const MUSIC_IDS = { 'bob-omb battlefield': 3, water: 5, snow: 8, hot: 6, slide: 9, haunted: 10, underground: 12, castle: 4, 'bowser road': 7, 'final bowser': 25, boss: 22, 'merry-go-round': 19, race: 20, 'wing cap': 14, 'metal cap': 15, 'endless stairs': 24, 'title screen': 2, 'file select': 33 };

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });

function plural(n, name) {
  if (n === 1) return name;
  return `${n} × ${name}`;
}

function summarizeCounts(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts].map(([n, c]) => plural(c, n)).join(', ');
}

class Queue {
  constructor() { this.items = []; this.waiters = []; }
  push(v) { const w = this.waiters.shift(); if (w) w(v); else this.items.push(v); }
  next() { return this.items.length ? Promise.resolve(this.items.shift()) : new Promise((r) => this.waiters.push(r)); }
}

export class Agent {
  constructor(hub, project) {
    this.hub = hub;
    this.project = project;
    this.q = null;
    this.input = null;
    this.turn = null;
    this.busy = false;
    this.model = project.model || defaultModel();
    this.loop = null; // the studio's own agent loop for non-SDK models (server/ai/loop.js)
    this.mcp = this.makeTools();
  }

  // ---- tools ---------------------------------------------------------------

  makeTools() {
    const self = this;
    const p = this.project;
    const findCustom = (q) => {
      const s = String(q).toLowerCase().trim();
      return p.levels.find((l) => l.id === q || l.name.toLowerCase() === s) || p.levels.find((l) => l.name.toLowerCase().includes(s));
    };
    // where a change was made (custom levels c:<id>, sub-areas c:<id>:<n>, '@game', '@project')
    const changeWhere = (key = '') => {
      if (key === '@game') return 'whole game';
      if (key === '@project') return 'project';
      if (key.startsWith('c:')) {
        const [, id, n] = key.split(':');
        const l = p.levels.find((x) => x.id === id);
        const ai = Number(n) || 1;
        return `${l?.name || 'custom level'}${ai > 1 ? ` · ${(l?.areas || []).find((x) => x.index === ai)?.name || `area ${ai}`}` : ''}`;
      }
      return levelName(Number(key.split(':')[0]));
    };
    const rpc = (method, params) => {
      if (!self.turn?.client) throw new Error('the game is not connected');
      return self.hub.rpc(self.turn.client, method, params);
    };
    const card = (name, label, fn) => async (args) => {
      const id = self.toolStart(name, label(args), args);
      try {
        const out = await fn(args);
        self.toolEnd(id, true, out.summary || null);
        return out.result;
      } catch (err) {
        self.toolEnd(id, false, err.message);
        return fail(err.message);
      }
    };
    const commit = (kind, res, summary, extra = {}) => {
      const change = projects.recordChange(p, { summary, key: res.key, level: res.level, area: res.area, ...extra });
      self.hub.patchChanged(p, self.turn?.client, extra.remote ? { ...extra.remote, key: change.key } : null);
      return change;
    };
    const opts = { alwaysLoad: true };

    const tools = [
      tool('get_state', 'Current level, Mario position/facing and the objects near him.', {},
        card('get_state', () => 'Checking the game', async () => ({ result: text(await rpc('state', {})) })), opts),

      tool('look', 'Screenshot of what the player sees right now, plus the game state.', {},
        card('look', () => 'Looking at the screen', async () => {
          const r = await rpc('look', {});
          const content = [];
          if (r.image) content.push({ type: 'image', data: r.image.split(',')[1], mimeType: 'image/jpeg' });
          content.push({ type: 'text', text: JSON.stringify(r.state) });
          return { result: { content } };
        }), opts),

      tool('list_objects', 'Objects in the current area, nearest first. Filter by name with query, by distance with radius.', {
        query: z.string().optional().describe('name, id or behavior fragment, e.g. "goomba", "tree", "bhvStar"'),
        radius: z.number().optional(),
        limit: z.number().optional(),
      }, card('list_objects', (a) => a.query ? `Looking for ${a.query}` : 'Listing objects', async (a) => ({ result: text(await rpc('objects', a)) })), opts),

      tool('search_catalog', 'Search every object and model of Super Mario 64 that can be spawned. Returns ids for spawn.', {
        query: z.string(), limit: z.number().optional(),
      }, card('search_catalog', (a) => `Searching “${a.query}”`, async (a) => ({ result: text(search(a.query, { limit: a.limit || 10 })) })), opts),

      tool('spawn', 'Add objects to the level, live and saved in the project.', {
        items: z.array(z.object({
          id: z.string().optional().describe('catalog id from search_catalog'),
          behavior: z.string().optional().describe('advanced: any bhv name, combined with a catalog id for the model'),
          model_id: z.string().optional().describe('advanced: catalog id whose model to use with behavior'),
          count: z.number().optional(),
          where: where.optional(),
          face: z.union([z.enum(['mario', 'away', 'same']), z.number()]).optional().describe('facing: toward Mario (default), away, same as Mario, or yaw in degrees'),
          bparams: z.union([z.string(), z.number()]).optional().describe('behavior params, e.g. "0x00010000"'),
          scale: z.number().optional(),
        })),
      }, card('spawn', (a) => `Adding ${summarizeCounts(a.items.flatMap((it) => Array(Math.min(it.count || 1, 40)).fill(friendlyName(it.id || it.behavior))))}`, async (a) => {
        const r = await rpc('place', a);
        const records = r.placed.map((x) => x.record);
        if (!records.length) throw new Error(r.errors.join('; ') || 'nothing placed');
        const summary = `Added ${summarizeCounts(records.map((x) => x.name))}`;
        const change = commit('spawn', r, summary, { objects: records, remote: { spawn: records } });
        return {
          summary,
          result: text({ placed: r.placed.map((x) => ({ uid: x.record.uid, name: x.record.name, x: x.record.x, y: x.record.y, z: x.record.z, slot: x.slot, no_floor_here: x.noFloor, underwater: x.underwater })), errors: r.errors, change_id: change.id }),
        };
      }), opts),

      tool('remove', 'Delete objects: by slots or studio uids from list_objects, or by name query (optionally only within radius / the N nearest). Saved: originals stay gone.', {
        slots: z.array(z.number()).optional(), uids: z.array(z.number()).optional(),
        query: z.string().optional(), radius: z.number().optional(), nearest: z.number().optional(),
        include_spawner: z.boolean().optional(),
      }, card('remove', (a) => a.query ? `Removing ${a.query}` : 'Removing objects', async (a) => {
        const r = await rpc('remove', a);
        if (!r.removed.length) throw new Error('nothing matched');
        const summary = `Removed ${summarizeCounts(r.removed.map((x) => x.name))}`;
        const change = commit('remove', r, summary, { removals: r.rules, dropped: r.studioUids, remote: { deleteUids: r.studioUids, addRules: r.rules } });
        return { summary, result: text({ removed: r.removed, change_id: change.id }) };
      }), opts),

      tool('move', 'Move (and optionally turn) one object.', {
        slot: z.number().optional(), uid: z.number().optional(), where, face: z.union([z.enum(['mario', 'away', 'same']), z.number()]).optional(),
      }, card('move', () => 'Moving an object', async (a) => {
        const r = await rpc('move', a);
        if (r.uid) {
          const change = projects.updateObject(p, r.uid, { x: r.x, y: r.y, z: r.z, yaw: r.yaw }, 'Moved an object');
          self.hub.patchChanged(p, self.turn.client, null);
          return { summary: 'Moved an object', result: text({ ...r, change_id: change?.id }) };
        }
        const summary = `Moved ${r.copied.name}`;
        const change = commit('move', r, summary, { objects: [r.copied], removals: r.rules });
        return { summary, result: text({ moved: r.copied, change_id: change.id }) };
      }), opts),

      tool('create_pipe', 'Create warp pipes. Mario enters `from` and comes out of the pipe at `to` (two-way by default). For another level give to.level (name or number) instead of a position.', {
        from: where.optional().describe('entrance; default 300 units in front of Mario'),
        to: z.object({
          mode: z.enum(['in_front', 'line', 'relative', 'at', 'near_object', 'around']).optional(),
          x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
          distance: z.number().optional(), forward: z.number().optional(), right: z.number().optional(),
          slot: z.number().optional(), uid: z.number().optional(),
          level: z.union([z.string(), z.number()]).optional(), area: z.number().optional(), node: z.number().optional(),
        }),
        two_way: z.boolean().optional(),
      }, card('create_pipe', (a) => a.to?.level !== undefined ? `Building a pipe to ${a.to.level}` : 'Building a warp pipe', async (a) => {
        const params = { ...a, to: { ...a.to } };
        let dest = null;
        if (a.to.level !== undefined) {
          dest = levelByKey(a.to.level);
          if (!dest?.num) throw new Error(`unknown level ${a.to.level}`);
          params.to.level = dest.num;
        }
        const r = await rpc('pipe', params);
        const summary = dest ? `Pipe to ${dest.name}` : (r.warps[1]?.destNode === r.warps[0].node ? 'Two-way warp pipe' : 'One-way warp pipe');
        const change = commit('pipe', r, summary, { objects: r.records, warps: r.warps, remote: { spawn: r.records, warps: r.warps } });
        return { summary, result: text({ pipes: r.records.map((x) => ({ uid: x.uid, x: x.x, y: x.y, z: x.z })), change_id: change.id }) };
      }), opts),

      tool('build', 'Build with blocks that have real collision: a single block (box, ramp, stairs, pillar) or a whole structure. Structures: stairs (straight staircase), spiral (spiral staircase), wall_climb (zig-zag ledges up the nearest wall), bridge (from where to `to`), path (floating platforms going away), tower (hollow tower with floors and stairs). They start at `where` and go away from Mario unless yaw_deg is given.', {
        kind: z.enum(['block', 'stairs', 'spiral', 'wall_climb', 'bridge', 'path', 'tower']),
        where: where.optional().describe('start point / block position (bottom center). Default 400 in front of Mario'),
        yaw_deg: z.number().optional().describe('direction the structure goes / the block faces (0 = +Z, 90 = +X)'),
        face: z.enum(['mario', 'away']).optional(),
        block: z.object({
          shape: z.enum(['box', 'ramp', 'stairs', 'pillar']).optional(),
          sx: z.number().optional().describe('width (x), units'), sy: z.number().optional().describe('height'), sz: z.number().optional().describe('depth (z); ramps and stairs rise toward +z'),
          steps: z.number().optional(), material: z.string().optional().describe('grass, dirt, cobblestone, stone path, blue stone, dark brick, grey brick, red brick, orange brick, castle stone, stone block, mossy block, wood planks, wood floor, checker, tiles, marble, sand, snow, ice, lava, metal, metal plate, yellow block, rainbow, rock, roof, dark grass'),
          top: z.string().optional(), side: z.string().optional(),
          surface: z.enum(['normal', 'not_slippery', 'slippery', 'ice', 'lava', 'hangable', 'hard', 'death', 'vanish_wall']).optional(),
          color: z.string().optional().describe('tint like #ff8080'), invisible: z.boolean().optional(), no_collision: z.boolean().optional(),
          pitch_deg: z.number().optional(), roll_deg: z.number().optional(),
        }).optional().describe('for kind=block'),
        params: z.record(z.string(), z.any()).optional().describe('structure options: stairs {width,height,steps,depth,material}; spiral {radius,steps,rise,turn,width,material,pillar}; wall_climb {ledges,rise,spread,width,depth,material}; bridge {width,thickness,planks,material}; path {count,gap,rise,size,wiggle,material}; tower {floors,size,floorHeight,material}'),
        to: z.object({ x: z.number(), y: z.number().optional(), z: z.number() }).optional().describe('bridge end point'),
      }, card('build', (a) => a.kind === 'block' ? `Building a ${a.block?.shape || 'box'}` : `Building ${a.kind.replace('_', ' ')}`, async (a) => {
        const r = await rpc('build', a);
        const summary = a.kind === 'block' ? `Built ${r.records[0].name}` : `Built ${a.kind.replace('_', ' ')} (${r.records.length} blocks)`;
        const change = commit('build', r, summary, { objects: r.records, remote: { spawn: r.records } });
        const xs = r.records.map((x) => x.x), ys = r.records.map((x) => x.y + x.block.sy), zs = r.records.map((x) => x.z);
        return { summary, result: text({ built: r.records.length, uids: r.records.map((x) => x.uid).slice(0, 40), top: Math.max(...ys), extent: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }, change_id: change.id }) };
      }), opts),

      tool('modify', 'Change an existing object or block: position, rotation, size (scale), behavior params, or a block\'s shape/size/material/surface. Use the uid/slot from list_objects or the editor selection.', {
        uid: z.number().optional(), slot: z.number().optional(),
        set: z.object({
          x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
          yaw_deg: z.number().optional(), pitch_deg: z.number().optional(), roll_deg: z.number().optional(),
          scale: z.number().optional(), bparams: z.union([z.string(), z.number()]).optional(),
          block: z.object({
            shape: z.enum(['box', 'ramp', 'stairs', 'pillar']).optional(), sx: z.number().optional(), sy: z.number().optional(), sz: z.number().optional(),
            steps: z.number().optional(), material: z.string().optional(), top: z.string().optional(), side: z.string().optional(),
            surface: z.enum(['normal', 'not_slippery', 'slippery', 'ice', 'lava', 'hangable', 'hard', 'death', 'vanish_wall']).optional(),
            color: z.string().optional(), invisible: z.boolean().optional(), no_collision: z.boolean().optional(),
          }).optional(),
        }),
      }, card('modify', () => 'Changing an object', async (a) => {
        const r = await rpc('modify', a);
        const name = r.record.name || 'object';
        if (r.adopted) {
          const change = commit('modify', r, `Changed ${name}`, { objects: [r.record], removals: r.adopted.rules, remote: { spawn: [r.record], addRules: r.adopted.rules } });
          return { summary: `Changed ${name}`, result: text({ uid: r.uid, change_id: change.id }) };
        }
        const change = projects.updateObject(p, r.uid, r.fields, `Changed ${name}`);
        self.hub.patchChanged(p, self.turn.client, { key: change?.key, deleteUids: [r.uid], spawn: [r.record] });
        return { summary: `Changed ${name}`, result: text({ uid: r.uid, change_id: change?.id }) };
      }), opts),

      tool('get_terrain', 'Overview of the whole area: highest points (mountain tops), lowest ground, water, landmarks and a relief map.', {
        resolution: z.number().optional(),
      }, card('get_terrain', () => 'Surveying the terrain', async (a) => ({ result: text(await rpc('terrain', a)) })), opts),

      tool('probe_floor', 'Ground and water height at specific x,z spots.', {
        points: z.array(z.object({ x: z.number(), z: z.number(), y: z.number().optional() })),
      }, card('probe_floor', () => 'Measuring the ground', async (a) => ({ result: text(await rpc('probe', a)) })), opts),

      tool('teleport_mario', 'Move Mario to a spot in this area.', { where },
        card('teleport_mario', () => 'Teleporting Mario', async (a) => {
          const r = await rpc('teleport', a);
          return { summary: 'Teleported Mario', result: text(r) };
        }), opts),

      tool('warp_to_level', 'Go to another level: an original SM64 level (name or number) or one of the project\'s custom levels (name or id).', {
        level: z.union([z.string(), z.number()]), act: z.number().optional(),
      }, card('warp_to_level', (a) => `Going to ${a.level}`, async (a) => {
        const custom = findCustom(a.level);
        if (custom) {
          await rpc('goto', { custom: custom.id });
          return { summary: `Went to ${custom.name}`, result: text({ ok: true, level: custom.name, custom: true, note: 'Mario is there now (after the level\'s star screen).' }) };
        }
        const lvl = levelByKey(a.level);
        if (!lvl?.num) throw new Error(`unknown level ${a.level}`);
        await rpc('goto', { level: lvl.num, act: a.act || 1, acts: lvl.acts });
        return { summary: `Went to ${lvl.name}`, result: text({ ok: true, level: lvl.name, note: 'Mario is there now (after the level\'s star screen).' }) };
      }), opts),

      tool('create_level', 'Create a brand-new custom level and go there. Templates are finished-looking bases with paths, a landmark, trees and wildlife: island (beach, pier, peak with a trail), meadow (hill with lookout, pond, stream with bridge), mountain (spiral trail to a snowy summit), desert (pyramid, ruins, oasis), snow (ice slide, frozen lake, cabin), lava (islands, bridges, volcano), canyon (river gorge, two bridges), flat (empty grass), sky (floating islands, no ground). Then reshape with terrain and add to it with build, spawn and add_star; the objects of the template are ordinary edits you can move or remove.', {
        name: z.string(), template: z.enum(['island', 'meadow', 'mountain', 'desert', 'snow', 'lava', 'canyon', 'flat', 'sky']).optional(),
      }, card('create_level', (a) => `Creating “${a.name}”`, async (a) => {
        const area = await rpc('make_level_area', { template: a.template || 'meadow' });
        const id = projects.newId();
        projects.createLevel(p, { id, name: a.name, template: a.template || 'meadow', area });
        self.hub.broadcast(p.id, { type: 'levels', levels: p.levels, thumbs: p.thumbs });
        self.hub.broadcast(p.id, { type: 'patch', patch: projects.patchOf(p), changes: projects.changeList(p) });
        await rpc('goto', { custom: id }); // returns once Mario is there
        return { summary: `Created level “${a.name}”`, result: text({ ok: true, id, name: a.name, note: 'Mario is in the new level. The terrain covers x and z from -4096 to 4096.' }) };
      }), opts),

      tool('terrain', 'Shape the ground of the current level. In custom levels this edits the heightmap terrain (8192 x 8192 units centered on 0,0, heights in units, water usually at 0); in original levels hill/raise/lower/valley/flatten/plateau/smooth reshape the level\'s own geometry. Ops run in order. Use heightmap with a coarse grid (e.g. 12x12 values 0..1, rows from -z to +z, columns from -x to +x) to copy a layout from an image, then refine with the other ops and finish with paint_auto.', {
        ops: z.array(z.object({
          op: z.enum(['hill', 'mountain', 'valley', 'crater', 'plateau', 'flatten', 'raise', 'lower', 'ridge', 'carve_path', 'river', 'noise', 'terraces', 'island', 'fill', 'scale', 'heightmap', 'paint', 'paint_auto', 'smooth']),
          x: z.number().optional(), z: z.number().optional(), radius: z.number().optional(),
          height: z.number().optional().describe('target height (plateau, flatten, fill) or how much higher (hill, mountain, ridge)'),
          depth: z.number().optional(), amount: z.number().optional(), scale: z.number().optional(), factor: z.number().optional(), step: z.number().optional(),
          width: z.number().optional(), points: z.array(z.array(z.number())).optional().describe('[[x,z], ...] for ridge, carve_path, river'),
          grid: z.array(z.array(z.number())).optional(), min: z.number().optional(), max: z.number().optional(),
          material: z.string().optional().describe('paint: grass, dirt, sand, snow, ice, lava (burns), rock, cobblestone, stone path, dark grass, ...'),
          base: z.string().optional(), steep: z.string().optional(), high: z.string().optional(), highLine: z.number().optional(),
          low: z.string().optional(), lowLine: z.number().optional(), water: z.number().optional(), beach: z.string().optional(),
          seed: z.number().optional(),
        })),
      }, card('terrain', (a) => `Shaping the terrain (${a.ops.map((o) => o.op).join(', ')})`, async (a) => {
        const r = await rpc('shape', { ops: a.ops, summary: `Shaped the terrain` });
        return { summary: 'Shaped the terrain', result: text(r) };
      }), opts),

      tool('level_settings', 'Change the current level: sky and water (custom levels), music, the spawn point (where Mario starts), or the custom level\'s name.', {
        sky: z.enum(['blue sky', 'above the clouds', 'below the clouds', 'snowy mountains', 'desert', 'flaming sky', 'purple sky', 'green sky', 'haunted', 'underwater city']).optional(),
        music: z.enum(['bob-omb battlefield', 'water', 'snow', 'hot', 'slide', 'haunted', 'underground', 'castle', 'bowser road', 'final bowser', 'boss', 'merry-go-round', 'race', 'wing cap', 'metal cap', 'endless stairs', 'title screen', 'file select']).optional(),
        water: z.object({ enabled: z.boolean(), height: z.number().optional() }).optional(),
        spawn: where.optional().describe('where Mario starts the level (default: where he stands now)'),
        name: z.string().optional(),
        song: z.string().optional().describe('play a song from the sound studio (its name or id, see music_library) instead of game music'),
      }, card('level_settings', () => 'Changing level settings', async (a) => {
        const SKY = { 'blue sky': 0, 'above the clouds': 8, 'below the clouds': 3, 'snowy mountains': 4, desert: 5, 'flaming sky': 1, 'purple sky': 9, 'green sky': 7, haunted: 6, 'underwater city': 2 };
        const MUS = { 'bob-omb battlefield': 3, water: 5, snow: 8, hot: 6, slide: 9, haunted: 10, underground: 12, castle: 4, 'bowser road': 7, 'final bowser': 25, boss: 22, 'merry-go-round': 19, race: 20, 'wing cap': 14, 'metal cap': 15, 'endless stairs': 24, 'title screen': 2, 'file select': 33 };
        const params = {};
        if (a.sky) params.sky = SKY[a.sky];
        if (a.music) params.music = MUS[a.music];
        if (a.water) params.water = a.water;
        if (a.spawn) params.spawn = a.spawn;
        if (a.song) {
          const song = p.audio.songs.find((x) => x.id === a.song || x.name.toLowerCase() === a.song.toLowerCase());
          if (!song) throw new Error(`no song "${a.song}" (music_library lists them)`);
          params.song = song.id;
        }
        const parts = [];
        if (Object.keys(params).length) { await rpc('level_settings', params); parts.push(...Object.keys(params)); }
        if (a.name) {
          const st = await rpc('state', {});
          if (!st.custom) throw new Error('only custom levels can be renamed');
          projects.renameLevel(p, st.custom, a.name);
          self.hub.broadcast(p.id, { type: 'levels', levels: p.levels, thumbs: p.thumbs });
          parts.push('name');
        }
        return { summary: `Changed ${parts.join(', ')}`, result: text({ ok: true }) };
      }), opts),

      tool('music_library', 'The music and sound you can use: the game\'s songs, the project\'s own songs (from the sound studio), the sound sets (the game\'s instrument bands) with their instruments and drum notes, the project\'s sound effects and which game sounds they replace.', {}, card('music_library', () => 'Looking at the music', async () => {
        return { summary: 'Looked at the music', result: text({
          game_music: Object.keys(MUSIC_IDS),
          songs: p.audio.songs.map((x) => ({ id: x.id, name: x.name, bars: x.bars, tempo: x.tempo, sound_set: x.bank, tracks: x.tracks.map((t) => `${t.name} (${t.kind === 'drums' ? 'drums' : `instrument ${t.program}`}, ${t.notes.length} notes)`) })),
          sound_sets: soundSets(),
          sound_effects: p.audio.sounds.map((x) => ({ id: x.id, name: x.name, replaces: p.audio.overrides.filter((o) => o.sound === x.id).map((o) => o.name) })),
        }) };
      }), opts),

      tool('compose_song', 'Write a song (or rewrite one by id) that the game plays with its own instruments, and optionally make it this level\'s music. Pick a sound set (music_library lists them with instruments: Bass/Melody/Chords labels tell what each is good for) and write tracks of notes. Notes are [beat, length in beats, pitch, velocity?]: beats count from 0 in quarter notes (0.25 steps), pitch is a note name like "C4"/"F#3" or a MIDI number for instruments, and the drum note number (see the set\'s drums) for a drum track. Keep a song to 4-16 bars that loop well: a melody, chords or an arpeggio, a bass line, and drums when the set has them. At most 12 tracks; a track plays up to 4 notes at once.', {
        name: z.string(),
        id: z.string().optional().describe('rewrite this existing song'),
        sound_set: z.number().describe('the set id (bank) from music_library'),
        tempo: z.number().describe('beats per minute, 60-200'),
        bars: z.number().describe('4/4 bars, 1-32'),
        tracks: z.array(z.object({
          name: z.string(),
          instrument: z.union([z.number(), z.literal('drums')]),
          volume: z.number().optional().describe('0-127, default 100'),
          pan: z.number().optional().describe('0 left - 64 center - 127 right'),
          notes: z.array(z.array(z.union([z.number(), z.string()]))),
        })),
        use_in_level: z.boolean().optional(),
      }, card('compose_song', (a) => `Composing “${a.name}”`, async (a) => {
        const set = soundSets().find((b) => b.set === a.sound_set);
        if (!set) throw new Error(`unknown sound set ${a.sound_set}`);
        const old = a.id && p.audio.songs.find((x) => x.id === a.id);
        const bars = Math.max(1, Math.min(32, Math.round(a.bars)));
        const steps = bars * 16;
        const song = { id: old ? old.id : projects.newId(), name: a.name, bank: a.sound_set, tempo: Math.max(40, Math.min(240, Math.round(a.tempo))),
          bars, beatsPerBar: 4, stepsPerBeat: 4, volume: 100, tracks: [] };
        let dropped = 0;
        for (const t of a.tracks.slice(0, 12)) {
          const drums = t.instrument === 'drums';
          const notes = [];
          for (const n of t.notes) {
            const [beat, len, pitch, vel] = n;
            const p0 = drums ? Number(pitch) : notePitch(pitch);
            const st = Math.round(Number(beat) * 4), d = Math.max(1, Math.round(Number(len) * 4));
            if (!Number.isFinite(st) || p0 == null || !Number.isFinite(p0) || st < 0 || st >= steps) { dropped++; continue; }
            notes.push({ t: st, d: Math.min(d, steps - st), p: p0, v: Math.max(1, Math.min(127, Number(vel) || 100)) });
          }
          song.tracks.push({ id: projects.newId(), name: t.name, kind: drums ? 'drums' : 'inst', program: drums ? 0 : Number(t.instrument) || 0,
            volume: t.volume ?? 100, pan: t.pan ?? 64, reverb: 20, mute: false, legato: false, notes });
        }
        projects.saveSong(p, song);
        self.hub.broadcast(p.id, { type: 'audio', audio: p.audio });
        if (a.use_in_level) await rpc('level_settings', { song: song.id });
        const count = song.tracks.reduce((n, t) => n + t.notes.length, 0);
        return { summary: `${old ? 'Rewrote' : 'Composed'} “${song.name}”${a.use_in_level ? ' for this level' : ''}`,
          result: text({ ok: true, id: song.id, notes: count, dropped_notes: dropped || undefined, note: 'The player can open it in the sound studio (Sound button) to listen and edit.' }) };
      }), opts),

      tool('sound_effect', 'Make a sound effect with the synthesizer and optionally use it instead of game sounds (found by name, e.g. "coin", "jump", "door open", "explosion"). Presets: coin, jump, powerup, laser, explosion, hit, blip, bounce, magic, oneup, hurt, wind; tweak with the optional values.', {
        name: z.string(),
        preset: z.enum(['coin', 'jump', 'powerup', 'laser', 'explosion', 'hit', 'blip', 'bounce', 'magic', 'oneup', 'hurt', 'wind']),
        wave: z.enum(['square', 'sawtooth', 'triangle', 'sine', 'noise']).optional(),
        start_pitch: z.number().optional().describe('Hz'),
        end_pitch: z.number().optional().describe('Hz'),
        length: z.number().optional().describe('seconds the sound holds before fading'),
        fade: z.number().optional().describe('seconds of fade out'),
        replace: z.array(z.string()).optional().describe('game sounds this plays instead of, by name'),
      }, card('sound_effect', (a) => `Making the sound “${a.name}”`, async (a) => {
        const synth = { ...SFX_PRESETS[a.preset] };
        if (a.wave) synth.wave = a.wave;
        if (a.start_pitch) synth.freq = a.start_pitch;
        if (a.end_pitch) synth.freqEnd = a.end_pitch;
        if (a.length != null) synth.sustain = Math.max(0, Math.min(2, a.length));
        if (a.fade != null) synth.decay = Math.max(0.01, Math.min(2, a.fade));
        const sound = { id: projects.newId(), name: a.name, kind: 'synth', synth, volume: 1 };
        projects.saveSound(p, sound);
        const replaced = [];
        for (const term of a.replace || []) {
          const g = gameSoundsFind(term);
          if (!g) continue;
          const rest = p.audio.overrides.filter((o) => ((o.bits ^ g.bits) & 0xf0ff0000) !== 0);
          projects.setOverrides(p, [...rest, { bits: g.bits, sound: sound.id, name: `${g.group}: ${g.name}` }]);
          replaced.push(`${g.group}: ${g.name}`);
        }
        self.hub.broadcast(p.id, { type: 'audio', audio: p.audio });
        return { summary: `Made the sound “${a.name}”${replaced.length ? ` for ${replaced.join(', ')}` : ''}`, result: text({ ok: true, id: sound.id, replaces: replaced }) };
      }), opts),

      tool('add_star', 'Define a new star in the current level. kind "star" places a collectable star (put it somewhere that takes skill to reach); kind "red_coins" places a red coin star marker plus 8 red coins (spread around it, or at the given coin positions): collecting all 8 makes the star appear there. Collecting one ends the level like the stars of the game; they are tracked per level.', {
        name: z.string().describe('a fun star name, like the game\'s ("Climb the Ice Tower")'),
        kind: z.enum(['star', 'red_coins']).optional(),
        where: where.optional(),
        coins: z.array(where).optional(),
      }, card('add_star', (a) => `Adding star “${a.name}”`, async (a) => {
        const r = await rpc('add_star', a);
        const summary = `Added star “${a.name}”`;
        const change = commit('add_star', r, summary, { objects: r.records, remote: { spawn: r.records } });
        return { summary, result: text({ star: r.star, red_coins: r.records.length - 1 || undefined, change_id: change.id }) };
      }), opts),

      tool('list_stars', 'The stars defined in the current level, and which the player collected.', {},
        card('list_stars', () => 'Checking the stars', async () => ({ result: text(await rpc('stars', {})) })), opts),

      tool('heal_mario', 'Refill Mario\'s health.', {},
        card('heal_mario', () => 'Healing Mario', async () => { await rpc('heal', {}); return { summary: 'Healed Mario', result: text('ok') }; }), opts),

      tool('list_changes', 'The project\'s saved edits, oldest first.', {},
        card('list_changes', () => 'Reading the edit history', async () => ({ result: text(projects.changeList(p).map((c) => ({ ...c, level: changeWhere(c.key) }))) })), opts),

      tool('undo', 'Undo a saved edit (the latest one, or a change_id).', { change_id: z.string().optional() },
        card('undo', () => 'Undoing', async (a) => {
          const r = self.hub.undo(p, a.change_id, self.turn?.client);
          if (!r) throw new Error('nothing to undo');
          return { summary: `Undid: ${r.change.summary}`, result: text({ undone: r.change.summary }) };
        }), opts),
    ];
    const ctx = { tool, z, card, rpc, commit, text, fail, where, opts, project: p, projects, agent: self, findCustom, levelName, levelByKey, getEntry, friendlyName, search };
    // a broken plug-in or a tool name used twice must not take the whole chat down
    for (const plugin of PLUGINS) {
      try { tools.push(...plugin(ctx)); } catch (err) { console.error('[tools] a plug-in failed:', err.message); }
    }
    const seenTools = new Set();
    for (let i = tools.length - 1; i >= 0; i--) {
      if (!seenTools.has(tools[i].name)) { seenTools.add(tools[i].name); continue; }
      if (!Agent.warnedDup?.has(tools[i].name)) { (Agent.warnedDup ||= new Set()).add(tools[i].name); console.error(`[tools] "${tools[i].name}" is defined twice: the later one is used`); }
      tools.splice(i, 1);
    }
    this.toolDefs = tools; // the same tool objects drive the other providers' loop
    this.toolNames = tools.map((t) => `mcp__studio__${t.name}`);
    return createSdkMcpServer({ name: 'studio', version: '1.0.0', tools });
  }

  // ---- turn events -----------------------------------------------------------

  toolStart(name, label, input) {
    const t = this.turn;
    if (!t) return null;
    const id = `${t.id}-${t.parts.length}`;
    t.parts.push({ type: 'tool', id, name, label, state: 'running' });
    this.hub.broadcast(this.project.id, { type: 'tool_start', turnId: t.id, toolId: id, name, label, input });
    return id;
  }

  toolEnd(id, ok, summary) {
    const t = this.turn;
    if (!t || !id) return;
    const part = t.parts.find((x) => x.id === id);
    if (part) { part.state = ok ? 'done' : 'error'; part.summary = summary; }
    this.hub.broadcast(this.project.id, { type: 'tool_end', turnId: t.id, toolId: id, ok, summary });
  }

  // ---- session ---------------------------------------------------------------

  start() {
    this.input = new Queue();
    const input = this.input;
    async function* stream() {
      while (true) {
        const content = await input.next();
        if (content === null) return;
        yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
      }
    }
    this.q = query({
      prompt: stream(),
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: this.model,
        tools: [],
        mcpServers: { studio: this.mcp },
        allowedTools: this.toolNames,
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit', 'TodoWrite', 'Skill'],
        canUseTool: async (name, input) => (this.toolNames.includes(name)
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Only the studio tools are available.' }),
        settingSources: [],
        cwd: SANDBOX,
        includePartialMessages: true,
        resume: this.project.sessionId || undefined,
        maxTurns: 40,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'studio64/1.0' },
      },
    });
    this.pump(this.q).catch((err) => this.onCrash(err));
  }

  async pump(q) {
    for await (const m of q) {
      if (q !== this.q) return;
      if (m.type === 'system' && m.subtype === 'init') {
        if (m.session_id && m.session_id !== this.project.sessionId) {
          this.project.sessionId = m.session_id;
          projects.save(this.project);
        }
      } else if (m.type === 'stream_event') {
        this.onStream(m.event);
      } else if (m.type === 'result') {
        this.finishTurn(m);
      }
    }
    if (q === this.q) this.onCrash(new Error('Claude session ended'));
  }

  onStream(ev) {
    const t = this.turn;
    if (!t) return;
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      t.textPart = { type: 'text', text: '' };
      t.parts.push(t.textPart);
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      if (!t.textPart) { t.textPart = { type: 'text', text: '' }; t.parts.push(t.textPart); }
      t.textPart.text += ev.delta.text;
      this.hub.broadcast(this.project.id, { type: 'text_delta', turnId: t.id, text: ev.delta.text });
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
      if (!t.thinking) { t.thinking = true; this.hub.broadcast(this.project.id, { type: 'thinking', turnId: t.id }); }
    } else if (ev.type === 'content_block_stop') {
      t.textPart = null;
    }
  }

  finishTurn(m) {
    const t = this.turn;
    if (!t) return;
    this.turn = null;
    this.busy = false;
    let error = m.subtype !== 'success' ? (m.errors?.join?.('; ') || m.subtype) : (m.is_error ? m.result : null);
    // the user pressed Stop: say that (the SDK's result for an interrupted turn is an internal diagnostic)
    if (t.stopped) error = 'Stopped.';
    const parts = t.parts.filter((x) => x.type !== 'text' || x.text.trim());
    this.project.chat.push({ role: 'assistant', ts: Date.now(), parts, error: error || undefined, model: this.model });
    projects.save(this.project);
    this.hub.broadcast(this.project.id, { type: 'assistant_done', turnId: t.id, error, cost: m.total_cost_usd, ms: m.duration_ms });
    this.hub.idle(this.project.id);
  }

  onCrash(err) {
    console.error('[agent]', err?.message || err);
    this.q = null;
    if (this.turn) {
      const msg = /auth|login|credential|401|403/i.test(String(err?.message))
        ? 'Claude is not logged in on the server. Run `claude` once and log in (or set ANTHROPIC_API_KEY), then try again.'
        : `Claude stopped unexpectedly: ${err?.message || err}`;
      this.finishTurn({ subtype: 'error', errors: [msg] });
    }
  }

  async send(content, client, displayText, images = []) {
    if (this.busy) throw new Error('Claude is still working on the last message');
    if (!canRun(this.model)) throw new Error('No AI is available for this project (AI settings).'); // never start a session then
    this.busy = true;
    const turnId = projects.newId();
    this.turn = { id: turnId, client, parts: [], textPart: null };
    this.project.chat.push({ role: 'user', ts: Date.now(), text: displayText, images: images.length ? images : undefined });
    projects.save(this.project);
    this.hub.broadcast(this.project.id, { type: 'user_message', text: displayText, images, turnId, from: client.id });
    this.hub.broadcast(this.project.id, { type: 'assistant_start', turnId });
    // the other side (SDK or loop) learns what was said since it last ran
    const loop = isLoopModel(this.model);
    const note = handoffNote(this.project, loop ? 'loopSync' : 'sdkSync');
    if (note) content = typeof content === 'string' ? note + content : [{ type: 'text', text: note }, ...content];
    if (loop && this.project.sdkSync === undefined) this.project.sdkSync = this.project.chat.length - 1;
    this.project[loop ? 'loopSync' : 'sdkSync'] = this.project.chat.length + 1; // + this turn's answer
    if (loop) {
      this.loop ||= new LoopSession(this);
      this.loop.run(content).catch((err) => {
        console.error('[ai loop]', err);
        if (this.turn) this.finishTurn({ subtype: 'error', errors: [`The AI stopped unexpectedly: ${err?.message || err}`] });
      });
      return turnId;
    }
    if (!this.q) this.start();
    this.input.push(content);
    return turnId;
  }

  async setModel(model) {
    if (!isKnownModel(model)) return;
    this.model = model;
    this.project.model = model;
    projects.save(this.project);
    if (this.q && !isLoopModel(model)) { try { await this.q.setModel(model); } catch { this.close(); } }
  }

  async interrupt() {
    const t = this.turn;
    if (t) t.stopped = true;
    // a session that never answers the stop must not leave the chat busy for good
    if (t) setTimeout(() => { if (this.turn === t) { this.finishTurn({ subtype: 'error', errors: ['Stopped.'] }); this.close(); } }, 10000).unref?.();
    if (this.loop && this.busy) this.loop.abort();
    if (this.q && this.busy) { try { await this.q.interrupt(); } catch { /* ignore */ } }
  }

  // Forget the conversation (keeps the edits).
  resetConversation() {
    this.close();
    this.project.sessionId = null;
    this.project.chat = [];
    this.project.aiHistory = [];
    delete this.project.sdkSync;
    delete this.project.loopSync;
    projects.save(this.project);
  }

  close() {
    this.loop?.abort();
    if (this.input) this.input.push(null);
    try { this.q?.close?.(); } catch { /* ignore */ }
    this.q = null;
    this.busy = false;
    this.turn = null;
  }
}
