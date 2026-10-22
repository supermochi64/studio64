// Claude's tools for the project's assets: place imported 3D models, recolour or
// re-pattern game textures, make skies, and dress Mario. The browser does the
// work (web/js/assets.js registers the rpc methods); placements are ordinary
// records in the area patch, so undo works for them.

export default ({ tool, z, card, rpc: rpc20, commit, text, where, opts, agent }) => {
  // pictures and models take a moment in the browser: a longer wait than the default 20 s
  const rpc = (method, params) => (agent?.turn?.client ? agent.hub.rpc(agent.turn.client, method, params, 60000) : rpc20(method, params));
  return [
  tool('list_assets', 'The project\'s own assets: imported 3D models (ids for place_model, triangle counts, sizes, how often placed), custom block materials, skies and Mario\'s colours.', {},
    card('list_assets', () => 'Checking the imported assets', async () => ({ result: text(await rpc('asset_list', {})) })), opts),

  tool('place_model', 'Place an imported 3D model (from list_assets) in the level, live and saved. mode "prop" for things placed many times (optionally solid and animated), "level" for level geometry (full mesh collision). Place it on the ground with where (like spawn).', {
    model: z.string().describe('model id or name from list_assets'),
    count: z.number().optional(),
    where: where.optional(),
    face: z.union([z.enum(['mario', 'away', 'same']), z.number()]).optional(),
    yaw_deg: z.number().optional(),
    scale: z.number().optional().describe('1 = the size it was imported at'),
    mode: z.enum(['prop', 'level']).optional(),
    collision: z.boolean().optional().describe('solid (default true)'),
    animation: z.enum(['none', 'spin', 'bob', 'spin_bob', 'sway', 'pulse']).optional(),
    speed: z.number().optional().describe('animation speed, 1 = normal'),
  }, card('place_model', (a) => `Placing ${a.count > 1 ? `${a.count} × ` : ''}${a.model}`, async (a) => {
    const r = await rpc('asset_place', a);
    const name = r.records[0]?.name || a.model;
    const summary = `Placed ${r.records.length > 1 ? `${r.records.length} × ` : ''}${name}`;
    const change = commit('spawn', r, summary, { objects: r.records, remote: { spawn: r.records } });
    return { summary, result: text({ placed: r.records.map((x) => ({ uid: x.uid, x: x.x, y: x.y, z: x.z })), change_id: change.id }) };
  }), opts),

  tool('search_textures', 'Search the game\'s textures (level, object, Mario, HUD) by name or group; here=true lists only textures drawn in the current level (best for "the grass here": names are mostly numbers, so look at the returned numbered picture to find the right one). Returns paths for edit_textures.', {
    query: z.string().optional().describe('e.g. "grass", "mario", "brick", "coin"'),
    group: z.string().optional().describe('e.g. "Mario", "Objects", "Bob-omb Battlefield", "Level textures: grass"'),
    here: z.boolean().optional(),
    limit: z.number().optional(),
  }, card('search_textures', (a) => `Looking for textures${a.query ? ` “${a.query}”` : ''}`, async (a) => {
    // names are mostly numbers: a numbered picture of the matches (the original pixels) shows which is which
    const r = await rpc('texture_search', a);
    const content = [];
    if (r.sheet) content.push({ type: 'image', data: r.sheet.split(',')[1], mimeType: 'image/jpeg' });
    content.push({ type: 'text', text: JSON.stringify({ textures: r.textures, note: r.sheet ? 'The picture shows the original pixels of each texture, numbered like "n".' : undefined }) });
    return { result: { content } };
  }), opts),

  tool('edit_textures', 'Change game textures for this project (they change everywhere the game uses them): recolour (hue shift, saturation, brightness, contrast, tint, colorize = paint everything in one hue keeping the shading, invert) or replace with a generated pattern (solid, noise, checker, stripes, bricks, tiles, gradient, dots, wood, grass, stone in two colours), or reset to the original. Pick textures by paths from search_textures, or by query / here.', {
    paths: z.array(z.string()).optional(),
    query: z.string().optional(),
    here: z.boolean().optional().describe('with query: only textures drawn in this level'),
    recolor: z.object({
      hue: z.number().optional().describe('degrees, -180..180'), saturation: z.number().optional().describe('factor, 1 = same'),
      brightness: z.number().optional(), contrast: z.number().optional(), tint: z.string().optional().describe('#rrggbb'),
      tint_amount: z.number().optional().describe('0..1'), colorize: z.string().optional().describe('#rrggbb'), invert: z.boolean().optional(),
    }).optional(),
    pattern: z.object({
      kind: z.enum(['solid', 'noise', 'checker', 'stripes', 'bricks', 'tiles', 'gradient', 'dots', 'wood', 'grass', 'stone']),
      a: z.string().optional().describe('#rrggbb'), b: z.string().optional(), scale: z.number().optional(), seed: z.number().optional(),
    }).optional(),
    reset: z.boolean().optional(),
    limit: z.number().optional(),
  }, card('edit_textures', (a) => (a.reset ? 'Restoring textures' : a.pattern ? `Painting ${a.pattern.kind} textures` : 'Recolouring textures'), async (a) => {
    const r = await rpc('texture_edit', a);
    return { summary: `${a.reset ? 'Restored' : 'Changed'} ${r.changed.length} texture${r.changed.length === 1 ? '' : 's'}`, result: text(r) };
  }), opts),

  tool('set_skybox', 'Give this level (or every level) a new sky, generated from colours: a vertical gradient (top, horizon, bottom), clouds, sun, stars and a mountain silhouette. Only levels with a skybox show it (outdoor and custom levels).', {
    area: z.enum(['here', 'all']).optional(),
    top: z.string().optional(), horizon: z.string().optional(), bottom: z.string().optional(),
    clouds: z.number().optional().describe('0..1.5'), cloud_color: z.string().optional(),
    sun: z.boolean().optional(), sun_color: z.string().optional(),
    stars: z.number().optional().describe('0..1'), mountains: z.number().optional().describe('0..1.5'), mountain_color: z.string().optional(),
    hd: z.boolean().optional().describe('sharper than N64'), name: z.string().optional(), seed: z.number().optional(),
  }, card('set_skybox', () => 'Painting a new sky', async (a) => ({ summary: 'New sky', result: text(await rpc('sky_generate', a)) })), opts),

  tool('clear_skybox', 'Remove the custom sky of this level (area "here") or the one for all levels ("all").', {
    area: z.enum(['here', 'all']).optional(),
  }, card('clear_skybox', () => 'Restoring the sky', async (a) => ({ summary: 'Sky restored', result: text(await rpc('sky_clear', a)) })), opts),

  tool('set_mario_colors', 'Change Mario\'s colours for this project: a preset (mario, luigi, wario, waluigi, fire, ice, classic, gold, shadow, builder, doctor, pink) and/or single parts as #rrggbb (overalls, shirt, gloves, shoes, skin, hair, cap).', {
    preset: z.string().optional(),
    colors: z.object({
      overalls: z.string().optional(), shirt: z.string().optional(), gloves: z.string().optional(), shoes: z.string().optional(),
      skin: z.string().optional(), hair: z.string().optional(), cap: z.string().optional(),
    }).optional(),
  }, card('set_mario_colors', (a) => (a.preset ? `Dressing Mario as ${a.preset}` : 'Recolouring Mario'), async (a) => ({ summary: 'Mario recoloured', result: text(await rpc('mario_colors', a)) })), opts),
];
};
