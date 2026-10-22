// Claude's tools for roads, walks, fences and plants (docs/roads-and-nature.md). The browser does
// the work (web/js/paths/rpc.js) with the same code as build mode's Roads and Nature tabs, and
// saves each call as one ordinary edit, so undo works.

const ROADS = ['asphalt', 'street', 'sidewalk', 'dirt', 'cobble', 'gravel', 'boardwalk', 'stone', 'custom'];
const LINES = ['picket', 'rustic', 'iron', 'chain', 'bamboo', 'railing', 'guardrail', 'wall', 'hedge', 'kerb', 'bollards', 'lamps', 'posts'];
const PRESETS = ['meadow', 'forest', 'flowerbed', 'jungle', 'autumn', 'pond'];
const KINDS = 'oak, pine, palm, cherry, autumn, dead (new trees); sm64_bubbly, sm64_pine, sm64_snow, sm64_palm (the game\'s own trees, Mario can climb them); bush, bush_berry, bush_flower, hedgeball; tulip_red, tulip_yellow, tulip_pink, tulip_purple, daisy, daisy_yellow, sunflower, rose_red, rose_white, rose_pink, bluebell, poppy; grass, tallgrass, fern, reeds; rock_small, rock_big, mushroom_red, mushroom_brown, mushroom_big; lilypad (on water)';

export default function pathsTools({ tool, z, card, rpc, text, opts }) {
  const pt = z.object({ x: z.number(), z: z.number(), y: z.number().optional().describe('default: the ground there'), width: z.number().optional().describe('road width at this point') });
  return [
    tool('list_paths', 'The roads, walks, fences/walls/lamp lines and plants of the current area: uids, styles, points, lengths, junctions, how many plants of which kinds. Also lists every style, plant kind and preset.', {},
      card('list_paths', () => 'Looking at the roads and plants', async () => ({ result: text(await rpc('paths_list', {})) })), { ...opts, annotations: { readOnlyHint: true } }),

    tool('draw_road', `Draw a road or walk through points on the ground (a smooth curve; it follows the ground, gets steps on steep parts of walks, cuts and fills the terrain of custom levels, has real collision). Styles: asphalt (lane markings), street (asphalt with raised sidewalks and curbs), sidewalk, dirt, cobble, gravel, boardwalk (wooden, on posts), stone, custom (with material: a custom material slot 0-15 from Assets › Materials). A road that starts or ends on another road joins it (a junction: the other road opens there). Without points: a straight road from in front of Mario. left/right put a line style along that side (${LINES.join(', ')}).`, {
      style: z.enum(ROADS).optional(),
      points: z.array(pt).optional().describe('2 or more points in order; world x/z'),
      length: z.number().optional().describe('without points: how long (default 2000)'),
      width: z.number().optional().describe('default per style: asphalt 440, street 680, paths ~230'),
      closed: z.boolean().optional().describe('a loop back to the first point'),
      smooth: z.boolean().optional().describe('false: straight between the points'),
      lanes: z.number().optional().describe('asphalt/street: 1, 2 (default) or 4'),
      marking: z.enum(['white', 'yellow']).optional(),
      left: z.enum(LINES).optional(), right: z.enum(LINES).optional(),
      stairs: z.boolean().optional().describe('steps on steep parts (default on for walks, off for roads)'),
      follow_ground: z.boolean().optional().describe('false: straight from point to point like a bridge'),
      caps: z.enum(['round', 'square']).optional(),
      material: z.number().optional().describe('style custom: material slot 0-15'),
      name: z.string().optional(),
    }, card('draw_road', (a) => `Drawing ${a.style || 'a'} road`, async (a) => {
      const r = await rpc('paths_draw_road', a);
      return { summary: `Drew ${r.style.toLowerCase()} (${r.length} long${r.steps ? `, ${r.steps} flight${r.steps > 1 ? 's' : ''} of steps` : ''}${r.joins.length ? ', joins another road' : ''})`, result: text(r) };
    }), opts),

    tool('edit_road', 'Change a road: its points, width, style, loop, smoothness, lanes, markings, sides, steps, following the ground. Use list_paths for uids. Pass left/right "none" to clear a side.', {
      uid: z.number(),
      points: z.array(pt).optional(), style: z.enum(ROADS).optional(), width: z.number().optional(), closed: z.boolean().optional(), smooth: z.boolean().optional(),
      lanes: z.number().optional(), marking: z.enum(['white', 'yellow']).optional(),
      left: z.enum([...LINES, 'none']).optional(), right: z.enum([...LINES, 'none']).optional(),
      stairs: z.boolean().optional(), follow_ground: z.boolean().optional(), caps: z.enum(['round', 'square']).optional(),
    }, card('edit_road', () => 'Changing the road', async (a) => {
      const r = await rpc('paths_edit_road', a);
      return { summary: `Changed the road (${r.length} long)`, result: text(r) };
    }), opts),

    tool('add_fence', `Build a fence, railing, wall, hedge, kerb, bollards, street lamps or posts: freestanding through points (each point a corner; gaps/gates are section numbers from 0 = between point 0 and 1), or along a road (along_road = its uid, side left/right/both: it follows the road and opens at its junctions). Styles: ${LINES.join(', ')}. Fences and walls block Mario; low walls and kerbs can be stood on.`, {
      style: z.enum(LINES),
      points: z.array(pt).optional(),
      along_road: z.number().optional().describe('a road uid: put it along that road instead'),
      side: z.enum(['left', 'right', 'both']).optional(),
      closed: z.boolean().optional(), smooth: z.boolean().optional(),
      gaps: z.array(z.number()).optional().describe('open sections'), gates: z.array(z.number()).optional().describe('sections with a gate'),
      height_percent: z.number().optional().describe('50-250, default 100'),
      name: z.string().optional(),
    }, card('add_fence', (a) => `Building ${a.style}`, async (a) => {
      const r = await rpc('paths_add_line', a);
      return { summary: r.road ? `${r.style} along the road (${r.side})` : `Built ${r.name.toLowerCase()} (${r.length} long)`, result: text(r) };
    }), opts),

    tool('paint_nature', `Plant trees, bushes, flowers, grass, rocks and mushrooms like the Nature brush: in a circle (center + radius; default around Mario) or along both sides of a road (along_road). Use a preset (${PRESETS.join(', ')}) and/or kinds (a list; repeat a kind to make it more common): ${KINDS}. density 1-100. They keep off roads and water unless told otherwise. erase: true removes plants there instead (only the given kinds, if any).`, {
      preset: z.enum(PRESETS).optional(),
      kinds: z.array(z.string()).optional(),
      center: z.object({ x: z.number(), z: z.number() }).optional(),
      radius: z.number().optional().describe('default 800 (along a road: the band width, default 300)'),
      along_road: z.number().optional(),
      density: z.number().optional(),
      avoid_paths: z.boolean().optional(), avoid_water: z.boolean().optional(),
      erase: z.boolean().optional(),
    }, card('paint_nature', (a) => (a.erase ? 'Removing plants' : `Planting ${a.preset || 'plants'}`), async (a) => {
      const r = await rpc('paths_paint_nature', a);
      return { summary: a.erase ? `Removed ${r.removed} plants` : r.planted ? `Planted ${r.what}` : 'Nothing fit there', result: text(r) };
    }), opts),

    tool('remove_path', 'Remove a road, fence line or a painted group of plants by uid (list_paths).', { uid: z.number() },
      card('remove_path', () => 'Removing it', async (a) => {
        const r = await rpc('paths_remove', a);
        return { summary: `Removed ${r.name}`, result: text(r) };
      }), opts),
  ];
}
