// Claude's tools for versions and play-testing: save/list versions, check the level for
// problems, play from a spot, the debug view and the save file (see docs/testing-tools.md).
import * as versions from '../versions.js';

export default function projectTools({ tool, z, card, rpc, text, opts, project: p, agent }) {
  return [
    tool('save_version', 'Save a named version (snapshot) of the whole hack the user can go back to in the version history. Do it before big or risky changes ("before rebuilding the castle").', {
      label: z.string().describe('a short name, like "Before the lava rework"'),
    }, card('save_version', (a) => `Saving version “${a.label}”`, async (a) => {
      const v = versions.snapshot(p, { label: a.label });
      agent.hub.broadcast(p.id, { type: 'versions_changed' });
      return { summary: `Saved version “${v.label}”`, result: text({ ok: true, version: v.id, label: v.label }) };
    }), opts),

    tool('list_versions', 'The saved versions of the hack (newest first): automatic and named snapshots.', {},
      card('list_versions', () => 'Reading the version history', async () => ({
        result: text(versions.list(p.id).slice().reverse().slice(0, 30).map((v) => ({ id: v.id, label: v.label, when: new Date(v.ts).toISOString(), auto: v.auto, edits: v.stats?.edits, levels: v.stats?.levels }))),
      })), opts),

    tool('version_changes', 'What changed between a saved version and now (or another version), level by level.', {
      version: z.string().describe('version id from list_versions'),
      against: z.string().optional().describe('another version id; default: the hack as it is now'),
    }, card('version_changes', () => 'Comparing versions', async (a) => {
      const older = versions.load(p.id, a.version);
      const newer = a.against ? versions.load(p.id, a.against) : versions.current(p);
      return { result: text(versions.diff(older, newer)) };
    }), opts),

    tool('validate_level', 'Check the level the player is in (and the saved data of every level) for problems: stars under the ground or out of reach, red coins missing, objects stuck in walls, pipes that lead nowhere, warps to deleted levels, a start point over the void, object and collision pools nearly full. Run it after building something, and fix what it finds.', {},
      card('validate_level', () => 'Checking the level for problems', async () => {
        const r = await rpc('validate', {});
        const n = r.counts.error + r.counts.warn;
        return { summary: n ? `Found ${r.counts.error} problem${r.counts.error === 1 ? '' : 's'}, ${r.counts.warn} warning${r.counts.warn === 1 ? '' : 's'}` : 'No problems found', result: text(r) };
      }), opts),

    tool('play_from_here', 'Let the player try something right away: leaves build mode and puts Mario at a spot (on the ground there). Without x/z: where the editor camera looks.', {
      x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
    }, card('play_from_here', () => 'Putting Mario there', async (a) => {
      const r = await rpc('play_from_here', a);
      return { summary: 'Mario is ready to play there', result: text(r) };
    }), opts),

    tool('debug_view', 'Show or hide the play-testing overlays for the user: collision (triangles colored by surface type), hitboxes (with object names), info (Mario\'s action, position, speed, floor), fps, timer (speedrun timer).', {
      collision: z.boolean().optional(), hitboxes: z.boolean().optional(), info: z.boolean().optional(), fps: z.boolean().optional(), timer: z.boolean().optional(),
    }, card('debug_view', () => 'Changing the debug view', async (a) => {
      const r = await rpc('debug_view', a);
      const on = Object.entries(r).filter(([, v]) => v).map(([k]) => k);
      return { summary: on.length ? `Debug view: ${on.join(', ')}` : 'Debug view off', result: text(r) };
    }), opts),

    tool('set_save_file', 'Change the game\'s save file for testing: give a number of stars (fills courses in order; for star doors), reset it, or set/clear flags (HAVE_KEY_1, HAVE_KEY_2, UNLOCKED_BASEMENT_DOOR, UNLOCKED_UPSTAIRS_DOOR, HAVE_WING_CAP, HAVE_METAL_CAP, HAVE_VANISH_CAP, UNLOCKED_50_STAR_DOOR, MOAT_DRAINED, ...). Returns the save file.', {
      stars: z.number().optional().describe('total stars, 0-120'),
      reset: z.boolean().optional(),
      set_flags: z.array(z.string()).optional(),
      clear_flags: z.array(z.string()).optional(),
    }, card('set_save_file', () => 'Changing the save file', async (a) => {
      const r = await rpc('save_file', a);
      return { summary: `Save file: ${r.total_stars} stars`, result: text(r) };
    }), opts),
  ];
}
