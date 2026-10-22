// Claude's tools for Shotgun Mario (ported from the Shoggoth World hack; docs/shotgun.md):
// arm or disarm Mario right now, the game rule "Mario starts with the shotgun" (whole game or one
// level), shotgun pickups and gangster crews placed like any catalog object, and the gun's state.
// Every one of these exists in the editor too (Objects → Shoggoth, Game rules → Items, the story's
// "Give or take the shotgun" action).

const GAME = '@game';

export default ({ tool, z, card, rpc, commit, text, where, opts, project: p, projects, agent, findCustom, levelByKey }) => {
  const game = (field, fallback) => p.areas[GAME]?.[field] ?? fallback;
  const resolveLevelKey = async (level) => {
    if (level === undefined || level === null || level === 'here') {
      const s = await rpc('state', {});
      return s.custom ? `c:${s.custom}` : String(s.level_num);
    }
    const c = findCustom(level);
    if (c) return `c:${c.id}`;
    const l = levelByKey(level);
    if (!l?.num) throw new Error(`unknown level ${level}`);
    return String(l.num);
  };

  return [
    tool('shotgun', 'Shotgun Mario (from the Shoggoth World hack): B or L fires five hitscan pellets (hold = a blast every 26 frames, the pump racks between), '
      + 'fire mid-air = shotgun jump (up speed 54, once per jump), R = over-the-shoulder aim mode with a crosshair (C buttons aim). Shots hit every enemy '
      + '(goombas and koopas are knocked out, bob-ombs explode, cork and ! boxes break, King Bob-omb takes a hit per 3 blasts, Sunshine enemies and custom '
      + 'objects take hits, Piantas get mad, Bowser and invincible things only spark). '
      + 'action: give / take = arm or disarm Mario now (not saved: for trying); rule_on / rule_off = the saved game rule "Mario starts with the shotgun" '
      + '(scope game = every level, level = one level; level = name/number/custom id, default here); pickup = place a shotgun pickup (saved; walking '
      + 'into it arms him until he leaves the level); gangsters = place a crew of gangsta Goombas that shoot at Mario (count, default 4). '
      + 'For "give Mario a shotgun" use give (he holds it at once); if no enemies are near him (the <game> block), also spawn 3-4 goombas '
      + '600-1000 units ahead (spawn, mode in_front, spacing 250) so he has something to shoot.', {
      action: z.enum(['give', 'take', 'rule_on', 'rule_off', 'pickup', 'gangsters']),
      scope: z.enum(['game', 'level']).optional(),
      level: z.union([z.string(), z.number()]).optional(),
      where: where.optional(),
      count: z.number().optional().describe('gangsters: how many (1-12, default 4)'),
    }, card('shotgun', (a) => ({ give: 'Giving Mario the shotgun', take: 'Taking the shotgun away', rule_on: 'Mario starts with the shotgun',
      rule_off: 'No shotgun at the start', pickup: 'Placing a shotgun', gangsters: 'Placing gangsters' })[a.action] || 'Shotgun', async (a) => {
      if (a.action === 'give' || a.action === 'take') {
        const s = await rpc('shotgun_give', { on: a.action === 'give' });
        return { summary: a.action === 'give' ? 'Mario has the shotgun (until he leaves the level)' : 'Took the shotgun away', result: text(s) };
      }
      if (a.action === 'rule_on' || a.action === 'rule_off') {
        const on = a.action === 'rule_on';
        const all = JSON.parse(JSON.stringify(game('rules', { base: {}, levels: {} })));
        all.base ||= {};
        all.levels ||= {};
        const key = a.scope === 'level' ? await resolveLevelKey(a.level) : null;
        const target = key ? (all.levels[key] ||= {}) : all.base;
        target.shotgun = on;
        if (!key && !on) delete target.shotgun;
        const summary = `${on ? 'Mario starts with the shotgun' : 'No shotgun at the start'}${key ? ' in one level' : ''}`;
        const change = projects.updateArea(p, GAME, 'rules', all, summary);
        agent.hub.patchChanged(p, agent.turn?.client, { key: GAME, reloadArea: true });
        return { summary, result: text({ scope: key ? `level ${key}` : 'game', shotgun: on, change_id: change.id }) };
      }
      const n = a.action === 'gangsters' ? Math.max(1, Math.min(12, Math.round(a.count || 4))) : 1;
      const items = a.action === 'pickup'
        ? [{ id: 'sg:shotgun', count: 1, where: a.where }]
        : [0, 1, 2].map((look) => ({ id: 'sg:gangster', count: Math.floor(n / 3) + (look < n % 3 ? 1 : 0), bparams: '0x' + (look << 16).toString(16).padStart(8, '0'), where: a.where, face: 'mario' }))
          .filter((x) => x.count > 0);
      const r = await rpc('place', { items });
      const records = r.placed.map((x) => x.record);
      if (!records.length) throw new Error(r.errors.join('; ') || 'nothing placed');
      const summary = a.action === 'pickup' ? 'Placed a shotgun' : `Placed ${records.length} gangster${records.length > 1 ? 's' : ''}`;
      const change = commit('spawn', r, summary, { objects: records, remote: { spawn: records } });
      return { summary, result: text({ placed: records.map((x) => ({ uid: x.uid, name: x.name, x: x.x, z: x.z })), errors: r.errors, change_id: change.id }) };
    }), opts),

    tool('get_shotgun_state', 'Shotgun Mario right now: has (Mario carries it), rule (the game rule here), aim (aim mode), shots and objHits (since the level started), decals/parts (effects), lastDir/lastDist (the last blast).', {},
      card('get_shotgun_state', () => 'Checking the shotgun', async () => ({ result: text(await rpc('shotgun_state', {})) })), opts),
  ];
};
