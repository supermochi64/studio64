// Claude's tools for the hack's structure: areas of custom levels (inside a building,
// a cave), doors / pipes / paintings / warp zones and where they lead, zones (death,
// camera, water, gas, lava, quicksand), the environment of an area (fog, light,
// weather, sound, camera, falling) and the world flow (start, hub, star goal).
// The browser does the work (web/js/worldflow.js registers the rpc methods) and saves
// each change as an ordinary edit, so undo works. See docs/world.md.

export default ({ tool, z, card, rpc, text, where, opts, project, findCustom, levelByKey }) => {
  // A destination from Claude's words -> the page's descriptor.
  const dest = (to) => {
    if (!to) return null;
    if (to.hub) return { hub: true };
    let base;
    if (to.level === undefined || to.level === 'here') base = null;
    else {
      const custom = findCustom(to.level);
      if (custom) base = { custom: custom.id };
      else {
        const l = levelByKey(to.level);
        if (!l?.num) throw new Error(`unknown level ${to.level}`);
        base = { level: l.num };
      }
    }
    let area = base ? 1 : undefined; // the current level: its current area unless named
    if (to.area !== undefined) {
      if (typeof to.area === 'number') area = to.area;
      else if (!base) return { here: true, areaName: String(to.area), uid: to.uid, at: to.position }; // the page knows this level's areas
      else {
        const lvl = base?.custom ? project.levels.find((l) => l.id === base.custom) : null;
        const found = lvl && [{ index: 1, name: lvl.mainAreaName || 'Main area' }, ...(lvl.areas || [])].find((a) => a.name.toLowerCase().includes(String(to.area).toLowerCase()));
        if (!found) throw new Error(`no area "${to.area}" in that level`);
        area = found.index;
      }
    }
    return { ...(base || {}), area, uid: to.uid, at: to.position, here: !base };
  };
  const destSchema = z.object({
    level: z.union([z.string(), z.number()]).optional().describe('custom level name/id or original level name/number; omit for the current level'),
    area: z.union([z.number(), z.string()]).optional().describe('area index (1 = main) or name'),
    uid: z.number().optional().describe('link to this existing door/pipe/arrival point (two-way for doors and pipes)'),
    position: z.object({ x: z.number(), y: z.number().optional(), z: z.number() }).optional().describe('where Mario comes out (an arrival point is made there); default: the area\'s start'),
    hub: z.boolean().optional().describe('to the hack\'s hub'),
  });

  return [
    tool('world_overview', 'The hack\'s structure: custom levels and their areas, where you are, start/hub/star goal, every door/pipe/painting/warp zone with where it leads and what it needs, and the current area\'s environment.', {},
      card('world_overview', () => 'Reading the world map', async () => ({ result: text(await rpc('world_state', {})) })), opts),

    tool('add_area', 'Add an area to a custom level (like SM64\'s sub-areas: the inside of a building, a cave, a secret room) and go there. Templates: room, castle_room, house, cave, void (one platform), or any level template (island, meadow, mountain, desert, snow, lava, canyon, flat, sky). door=true also puts a pair of doors between where Mario is now and the new area.', {
      name: z.string(),
      template: z.string().optional(),
      level: z.string().optional().describe('custom level name/id (default: the current one)'),
      door: z.boolean().optional(),
    }, card('add_area', (a) => `Adding the area “${a.name}”`, async (a) => {
      let level;
      if (a.level) { const l = findCustom(a.level); if (!l) throw new Error(`no custom level ${a.level}`); level = l.id; }
      const r = await rpc('world_area_create', { level, name: a.name, template: a.template || 'room', door: !!a.door, go: true });
      return { summary: `Added the area “${a.name}”`, result: text({ ...r, note: 'Mario is in the new area now. Build in it like any level; use add_warp to connect it.' }) };
    }), opts),

    tool('go_to_area', 'Go to an area of a level (sub-areas of custom levels, or an original level\'s areas).', {
      level: z.union([z.string(), z.number()]).optional(), area: z.union([z.number(), z.string()]).optional(),
    }, card('go_to_area', (a) => `Going to ${a.level ?? 'this level'}${a.area ? `, area ${a.area}` : ''}`, async (a) => {
      const d = dest({ level: a.level, area: a.area });
      if (d.here) { const st = await rpc('world_state', {}); Object.assign(d, st.here.custom ? { custom: st.here.custom } : { level: st.here.level }); }
      const r = await rpc('world_goto_area', { custom: d.custom, level: d.level, area: d.area });
      return { summary: `Went to ${r.key}`, result: text(r) };
    }), opts),

    tool('add_warp', 'Place a door, star door, key door, warp pipe, painting (jump in, like the castle), warp zone (invisible box Mario walks into), arrival point, level exit, cannon or key, and optionally say where it leads. Doors and pipes linked to another door/pipe (to.uid) work both ways. stars/key/locked make it need stars (with the "you need N stars" message), a key (place one with kind "key") or an event to unlock it.', {
      kind: z.enum(['door', 'pipe', 'painting', 'zone', 'arrival', 'exit', 'cannon', 'key']),
      where: where.optional(),
      yaw_deg: z.number().optional().describe('which way it faces (default: toward Mario)'),
      to: destSchema.optional(),
      stars: z.number().optional(), key: z.number().optional().describe('key number 0-7 it needs (doors) or is (kind key)'), locked: z.boolean().optional(),
      style: z.enum(['wood', 'castle', 'star', 'star1', 'star3', 'key', 'metal', 'haunted', 'cabin', 'cave']).optional().describe('door look'),
      picture: z.string().optional().describe('painting picture: bob, ccm, wf, jrb, lll, ssl, wdw, thi, ttm, ttc, sl'),
      size: z.union([z.number(), z.array(z.number())]).optional().describe('painting width, or zone [x, y, z] size'),
      transition: z.enum(['fade', 'star', 'circle', 'instant']).optional().describe('warp zones'),
      name: z.string().optional(),
    }, card('add_warp', (a) => `Placing a ${a.kind}`, async (a) => {
      const to = a.to ? dest(a.to) : null;
      const r = await rpc('world_place', { ...a, to: null, size: a.size, raise: 0 });
      let linked = null;
      if (to) linked = await rpc('world_link_to', { uid: r.uid, to });
      return { summary: `Placed a ${a.kind}${linked ? ' and linked it' : ''}`, result: text({ ...r, linked }) };
    }), opts),

    tool('link_warp', 'Make an existing door / pipe / painting / warp zone (by uid) lead somewhere: another level, an area, a spot (arrival point made there), another door or pipe (two-way), or the hub.', {
      uid: z.number(), to: destSchema, two_way: z.boolean().optional(),
    }, card('link_warp', () => 'Linking a warp', async (a) => {
      const r = await rpc('world_link_to', { uid: a.uid, to: dest(a.to), two_way: a.two_way });
      return { summary: 'Linked a warp', result: text(r) };
    }), opts),

    tool('modify_warp', 'Change a door / pipe / painting / zone by uid: stars needed, key needed, locked, door style, painting picture, zone transition or camera mode, liquid kind.', {
      uid: z.number(),
      stars: z.number().optional(), key: z.number().optional().describe('-1 = none'), locked: z.boolean().optional(),
      style: z.string().optional(), picture: z.string().optional(), transition: z.string().optional(),
      camera_mode: z.string().optional(), liquid: z.enum(['water', 'gas', 'lava', 'quicksand']).optional(),
    }, card('modify_warp', () => 'Changing a warp', async (a) => {
      const warp = {};
      if (a.stars !== undefined) warp.stars = a.stars;
      if (a.key !== undefined) warp.key = a.key >= 0 ? a.key : undefined;
      if (a.locked !== undefined) warp.locked = a.locked;
      if (a.style) warp.style = a.style;
      const zone = {};
      if (a.transition) zone.transition = a.transition;
      if (a.camera_mode) zone.mode = a.camera_mode;
      if (a.liquid) zone.kind = a.liquid;
      const r = await rpc('world_update', { uid: a.uid, warp: Object.keys(warp).length ? warp : undefined, zone: Object.keys(zone).length ? zone : undefined, painting: a.picture ? { picture: a.picture } : undefined, style: a.style });
      return { summary: 'Changed a warp', result: text(r) };
    }), opts),

    tool('add_hazard_zone', 'Place a box zone in the current area: death (falling in costs a life, or goes where "falling leads to"), camera (camera mode inside), water (swimmable up to its top), gas (toxic), lava (burning surface at the top), quicksand (sinking surface at the top). Bottom center at where; size [x, y, z].', {
      kind: z.enum(['death', 'camera', 'water', 'gas', 'lava', 'quicksand']),
      where: where.optional(), size: z.array(z.number()).optional(),
      camera_mode: z.enum(['open', 'radial', 'close', '8dir', 'behind', 'slide', 'boss', 'fixed', 'side', 'top']).optional(),
      name: z.string().optional(),
    }, card('add_hazard_zone', (a) => `Placing a ${a.kind} zone`, async (a) => {
      const r = await rpc('world_place', { kind: a.kind, where: a.where, size: a.size, mode: a.camera_mode, name: a.name, yaw_deg: 0 });
      return { summary: `Placed a ${a.kind} zone`, result: text(r) };
    }), opts),

    tool('set_environment', 'The current area\'s environment: fog (on, color "#rrggbb", near/far distances), light (sun yaw/pitch in degrees, sun color, ambient 0-1, tint color for the whole scene: e.g. dark blue for night), weather (none, snow, blizzard, rain, leaves, petals, lava_bubbles, bubbles), ambient sound (wind, howling, waterfall, water, drone, birds, boos, bubbles, sand), death height (falling below it), where falling leads, and the camera mode (open, radial, close, 8dir, behind, slide, boss, fixed, side, top). Pass null to remove a setting.', {
      fog: z.object({ on: z.boolean(), color: z.string().optional(), near: z.number().optional(), far: z.number().optional() }).nullable().optional(),
      light: z.object({ yaw: z.number().optional(), pitch: z.number().optional(), color: z.string().optional(), ambient: z.number().optional(), tint: z.string().optional() }).nullable().optional(),
      weather: z.enum(['none', 'snow', 'blizzard', 'rain', 'leaves', 'petals', 'lava_bubbles', 'bubbles', 'snow_water']).optional(),
      ambient: z.string().nullable().optional(),
      death_height: z.number().nullable().optional(),
      falling_leads_to: destSchema.nullable().optional(),
      camera: z.object({ mode: z.string(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), axis: z.number().optional(), dist: z.number().optional() }).nullable().optional(),
    }, card('set_environment', () => 'Changing the environment', async (a) => {
      const env = {};
      for (const k of ['fog', 'light', 'weather', 'ambient', 'camera']) if (a[k] !== undefined) env[k] = a[k];
      if (a.death_height !== undefined) env.deathY = a.death_height;
      if (a.falling_leads_to !== undefined) env.fallTo = a.falling_leads_to ? dest(a.falling_leads_to) : null;
      if (env.fallTo?.here) { const st = await rpc('world_state', {}); Object.assign(env.fallTo, st.here.custom ? { custom: st.here.custom } : { level: st.here.level }); }
      if (env.fallTo) { delete env.fallTo.here; delete env.fallTo.at; }
      const r = await rpc('world_env', { env, summary: `Environment: ${Object.keys(env).join(', ')}` });
      return { summary: `Changed ${Object.keys(env).join(', ')}`, result: text(r) };
    }), opts),

    tool('set_hub', 'The hack\'s flow: start (the level/area a new game starts in), hub (stars, deaths and Exit Course return there, in front of the entrance Mario used; it pauses like the castle), star goal (a message when the player has that many stars). Use "here" for the current area; null to go back to the castle.', {
      start: z.union([z.literal('here'), destSchema]).nullable().optional(),
      hub: z.union([z.literal('here'), destSchema]).nullable().optional(),
      star_goal: z.number().nullable().optional(), goal_message: z.string().optional(),
    }, card('set_hub', () => 'Setting up the hack\'s flow', async (a) => {
      const st = await rpc('world_state', {});
      const where = (v) => {
        if (v === null) return null;
        if (v === 'here') return st.here.custom ? { custom: st.here.custom, area: st.here.area } : { level: st.here.level, area: st.here.area };
        const d = dest(v);
        if (d.here) Object.assign(d, st.here.custom ? { custom: st.here.custom } : { level: st.here.level });
        return d.custom ? { custom: d.custom, area: d.area } : { level: d.level, area: d.area };
      };
      const world = {};
      if (a.start !== undefined) world.start = where(a.start);
      if (a.hub !== undefined) world.hub = where(a.hub);
      if (a.star_goal !== undefined) world.goal = a.star_goal ? { stars: a.star_goal, message: a.goal_message } : null;
      const r = await rpc('world_flow', { world });
      return { summary: `Set ${Object.keys(world).join(', ')}`, result: text(r) };
    }), opts),

    tool('lock_door', 'Lock or unlock a door / pipe / painting / warp zone by uid (for events: "the door opens when you talk to the Toad"). persist=true saves it as its starting state.', {
      uid: z.number(), locked: z.boolean(), persist: z.boolean().optional(),
    }, card('lock_door', (a) => (a.locked ? 'Locking a door' : 'Unlocking a door'), async (a) => {
      const r = await rpc('door_lock', a);
      if (!r.ok) throw new Error(`uid ${a.uid} is not a door or warp`);
      return { summary: a.locked ? 'Locked a door' : 'Unlocked a door', result: text(r) };
    }), opts),
  ];
};
