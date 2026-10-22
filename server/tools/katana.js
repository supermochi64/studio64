// Claude's tools for Katana Mario and the katana fighters (ported from the Shoggoth World hack, its
// maid cafe; docs/katana.md): give or take the katana now, the game rule "Mario starts with the katana"
// (whole game or one level), the Legendary Blade, katana fighters and a katana duel placed like any catalog
// object, and the state. Every one of these exists in the editor too (Objects → Shoggoth, Game rules →
// Items, the story's "Give or take the katana" action).

const GAME = '@game';
const LOOKS = ['mario', 'luigi', 'wario', 'waluigi', 'peach', 'yoshi'];

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
    tool('katana', 'Katana Mario (from the Shoggoth World hack\'s maid cafe): B cuts (three-cut combo), B in the air = spin slash (once per jump), '
      + 'Z+B = dash slash (the cuts land a beat later, at the click), running B = lunge; cuts hit every enemy like shotgun blasts do (goombas fall, '
      + 'bob-ombs go off, boxes break, Bowser and armour only spark). Mario carries one weapon at a time (the katana replaces the shotgun). '
      + 'action: give / take = the katana now (not saved: for trying); rule_on / rule_off = the saved game rule "Mario starts with the katana" '
      + '(scope game = every level, level = one level; level = name/number/custom id, default here); blade = place the Legendary Blade in the floor '
      + '(B at it pulls it out); fighters = place katana fighters (dressed Toad cosplayers who draw replica katanas and fight Mario when he comes near; '
      + 'looks: mario (the boss), luigi, wario, waluigi, peach, yoshi; count, default 3); duel = place a katana duel (six fighters, the Mario '
      + 'cosplayer\'s challenge, the blade if Mario has none, three waves with the battle theme, a star for winning named star_name). '
      + 'For "give Mario a katana / sword" use give (he holds it at once); if no enemies are near him, also spawn 4-5 goombas 500-900 '
      + 'units ahead in a tight group (spawn, mode grid or in_front with spacing 160) so one combo cuts through several.', {
      action: z.enum(['give', 'take', 'rule_on', 'rule_off', 'blade', 'fighters', 'duel']),
      scope: z.enum(['game', 'level']).optional(),
      level: z.union([z.string(), z.number()]).optional(),
      where: where.optional(),
      count: z.number().optional().describe('fighters: how many (1-8, default 3)'),
      looks: z.array(z.enum(LOOKS)).optional().describe('fighters: their looks, in order (default luigi, peach, yoshi, wario, waluigi, mario)'),
      star_name: z.string().optional().describe('duel: the star for winning (empty string: no star)'),
    }, card('katana', (a) => ({ give: 'Giving Mario the katana', take: 'Taking the katana away', rule_on: 'Mario starts with the katana',
      rule_off: 'No katana at the start', blade: 'Placing the Legendary Blade', fighters: 'Placing katana fighters', duel: 'Placing a katana duel' })[a.action] || 'Katana', async (a) => {
      if (a.action === 'give' || a.action === 'take') {
        const s = await rpc('katana_give', { on: a.action === 'give' });
        return { summary: a.action === 'give' ? 'Mario has the katana (until he leaves the level)' : 'Took the katana away', result: text(s) };
      }
      if (a.action === 'rule_on' || a.action === 'rule_off') {
        const on = a.action === 'rule_on';
        const all = JSON.parse(JSON.stringify(game('rules', { base: {}, levels: {} })));
        all.base ||= {};
        all.levels ||= {};
        const key = a.scope === 'level' ? await resolveLevelKey(a.level) : null;
        const target = key ? (all.levels[key] ||= {}) : all.base;
        target.katana = on;
        if (on) { if (key) target.shotgun = false; else delete target.shotgun; } // (one weapon at a time)
        if (!key && !on) delete target.katana;
        const summary = `${on ? 'Mario starts with the katana' : 'No katana at the start'}${key ? ' in one level' : ''}`;
        const change = projects.updateArea(p, GAME, 'rules', all, summary);
        agent.hub.patchChanged(p, agent.turn?.client, { key: GAME, reloadArea: true });
        return { summary, result: text({ scope: key ? `level ${key}` : 'game', katana: on, change_id: change.id }) };
      }
      let items;
      if (a.action === 'duel') {
        // (the page makes the record: its star gets a free star number of the level)
        const at = a.where && typeof a.where === 'object' && Number.isFinite(a.where.x) && Number.isFinite(a.where.z) ? { x: a.where.x, z: a.where.z } : {};
        const r = await rpc('katana_place_duel', { ...at, star_name: a.star_name });
        const rec = r.placed[0].record;
        const summary = 'Placed a katana duel';
        const change = commit('spawn', r, summary, { objects: [rec], remote: { spawn: [rec] } });
        return { summary, result: text({ uid: rec.uid, x: rec.x, z: rec.z, star: rec.star?.name || null, change_id: change.id }) };
      }
      if (a.action === 'blade') items = [{ id: 'kt:blade', count: 1, where: a.where }];
      else {
        const n = Math.max(1, Math.min(8, Math.round(a.count || a.looks?.length || 3)));
        const order = a.looks?.length ? a.looks : ['luigi', 'peach', 'yoshi', 'wario', 'waluigi', 'mario'];
        const counts = new Map();
        for (let i = 0; i < n; i++) { const l = order[i % order.length]; counts.set(l, (counts.get(l) || 0) + 1); }
        items = [...counts].map(([l, c]) => ({ id: 'kt:fighter', count: c, bparams: '0x' + (LOOKS.indexOf(l) << 16).toString(16).padStart(8, '0'), where: a.where, face: 'mario' }));
      }
      const r = await rpc('place', { items });
      const records = r.placed.map((x) => x.record);
      if (!records.length) throw new Error(r.errors.join('; ') || 'nothing placed');
      const summary = a.action === 'blade' ? 'Placed the Legendary Blade'
        : `Placed ${records.length} katana fighter${records.length > 1 ? 's' : ''}`;
      const change = commit('spawn', r, summary, { objects: records, remote: { spawn: records } });
      return { summary, result: text({ placed: records.map((x) => ({ uid: x.uid, name: x.name, x: x.x, z: x.z, star: x.star?.name || undefined })), errors: r.errors, change_id: change.id }) };
    }), opts),

    tool('get_katana_state', 'Katana Mario right now: has (Mario holds it), rule, action (pull, slash, spin, dash, flourish, parried), swings and hits '
      + '(since the level started), objHits (other objects cut), prompt (B would pull a blade), and the duel: running, phase (party, shocked, challenge, '
      + 'blade, fight_start, fight, finale, won, lost), wave, alive, fighters (look, health), bubbles (the lines on screen).', {},
    card('get_katana_state', () => 'Checking the katana', async () => ({ result: text(await rpc('katana_state', {})) })), opts),
  ];
};
