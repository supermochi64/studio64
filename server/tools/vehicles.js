// Claude's tools for the vehicles (the drivable cars and races ported from Shoggoth World
// hack; engine/src/studio/vehicle*.c, web/js/vehicles.js, docs/vehicles.md): what is placed, a car,
// a race with its course, changing either, and driving / racing to try them.

const LOOKS = ['sportscar', 'racer', 'drift_king', 'taxi', 'sedan', 'bus', 'shuto_van', 'shuto_cab', 'kei', 'kei_truck'];
const DIFFICULTY = ['easy', 'normal', 'hard', 'expert'];

export default ({ tool, z, card, rpc, commit, text, opts, project, projects, agent }) => {
  const point = z.array(z.number()).describe('[x, z] or [x, y, z] in level coordinates (y: the ground when left out)');
  const carFields = {
    color: z.string().optional().describe('paint "#rrggbb" (sportscar, racer, taxi; "" = its own)'),
    top_kmh: z.number().optional().describe('top speed on the dial, 40-260 (Mario runs at 35; the sportscar does 103, the racer 130)'),
    handling: z.number().optional().describe('0.5 loose .. 1 normal .. 1.6 sharp (steering and grip)'),
    accel: z.number().optional().describe('0.5 gentle .. 1 normal .. 1.6 punchy'),
    boost: z.boolean().optional().describe('drift boost outside races: hold R through a bend, let go'),
    radio: z.number().optional().describe('a game music sequence id played while driving (0 = off)'),
    lights: z.boolean().optional().describe('headlight beams on the road (night levels)'),
  };
  const raceFields = {
    laps: z.number().optional().describe('1-9 (a circuit; default 3)'),
    difficulty: z.enum(DIFFICULTY).optional().describe('the rival\'s pace (default normal)'),
    traffic: z.number().optional().describe('traffic cars on the course, 0-10'),
    width: z.number().optional().describe('half width of the course (off it by more than this + 600: back on track), default 900'),
    rival: z.string().optional().describe('the rival\'s name on screen (default "Drift King")'),
    star_name: z.string().nullable().optional().describe('the star a win gives ("" or null: no star)'),
    course: z.array(point).optional().describe('the course points in order, the first at the start line (the rival\'s car); default: a rounded loop ahead'),
    sprint: z.boolean().optional().describe('A to B instead of a circuit'),
    player_look: z.enum(LOOKS).optional().describe('the car the race gives Mario when he walks up (default racer)'),
  };

  const update = (r, summary) => {
    const change = projects.updateObject(project, r.uid, r.fields, summary);
    agent.hub.patchChanged(project, agent.turn?.client, { key: change?.key || r.key, deleteUids: [r.uid], spawn: [r.record] });
    return change;
  };

  return [
    tool('list_vehicles', 'The drivable cars (from Shoggoth World): the looks, the cars and races placed in this area (uids, settings, course size), and whether Mario drives right now. Mario gets in with B at a door, out with Z; a race starts with B by the rival (or a honk, C-up, beside him in a car).', {},
      card('list_vehicles', () => 'Looking at the cars', async () => ({ result: text(await rpc('vehicle_state', {})) })), opts),

    tool('place_car', 'Place a drivable car (live and saved): Mario gets in with B at a door, drives with A/stick (R drifts, C-up horn), gets out with Z. Default: in front of Mario, facing his way. For "give Mario a car" use this: put it beside him (about 250 to his side), facing his way, on open ground.', {
      look: z.enum(LOOKS).optional().describe('default sportscar (open: Mario shows at the wheel; the others are closed)'),
      x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), yaw_deg: z.number().optional(),
      ...carFields,
    }, card('place_car', (a) => `Placing a ${String(a.look || 'sportscar').replace(/_/g, ' ')}`, async (a) => {
      const r = await rpc('vehicle_place', { ...a, race: false });
      const records = r.placed.map((x) => x.record);
      const summary = `Placed a ${records[0].name.toLowerCase()}`;
      const change = commit('spawn', r, summary, { objects: records, remote: { spawn: records } });
      return { summary, result: text({ uid: records[0].uid, x: records[0].x, y: records[0].y, z: records[0].z, change_id: change.id }) };
    }), opts),

    tool('setup_race', 'Place a race (live and saved): the rival\'s car on the start line, the course it drives (a loop of laps or a sprint), checkpoints along it, a countdown, the rival on rails with rubber band, drift boosts and slipstream, optional traffic, and a star for winning. Mario challenges him with B on foot (he gets a race car) or by honking beside him in a car. The user can reshape the course with the path tool (Edit course). Default course: a rounded loop about 5200 x 2600 ahead of the start; give course points to fit the level.', {
      look: z.enum(LOOKS).optional().describe('the rival\'s car (default drift_king)'),
      x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), yaw_deg: z.number().optional(),
      ...carFields,
      ...raceFields,
    }, card('setup_race', (a) => `Setting up a race${a.rival ? ` against ${a.rival}` : ''}`, async (a) => {
      const r = await rpc('vehicle_place', { ...a, look: a.look || 'drift_king', race: true });
      const records = r.placed.map((x) => x.record);
      const rec = records[0];
      const summary = `Set up a race${rec.race?.rival ? ` against ${rec.race.rival}` : ''}`;
      const change = commit('spawn', r, summary, { objects: records, remote: { spawn: records } });
      return { summary, result: text({ uid: rec.uid, start: [rec.x, rec.y, rec.z], course_points: rec.motion?.path?.points?.length, laps: rec.race?.laps, star: rec.star?.name || null, change_id: change.id }) };
    }), opts),

    tool('edit_vehicle', 'Change a placed car or race (uid from list_vehicles): its look, paint, speed, handling; for races laps, difficulty, traffic, rival name, star, course (points in level coordinates, first = start line), sprint or circuit.', {
      uid: z.number(),
      look: z.enum(LOOKS).optional(),
      ...carFields,
      ...raceFields,
      circuit: z.boolean().optional().describe('make a sprint a circuit again'),
      player_color: z.string().optional(),
    }, card('edit_vehicle', () => 'Changing a car', async (a) => {
      const r = await rpc('vehicle_edit', a);
      const summary = `Changed ${r.name || 'a car'}`;
      const change = update(r, summary);
      return { summary, result: text({ uid: r.uid, fields: r.fields, change_id: change?.id }) };
    }), opts),

    tool('drive', 'Play-test a car or race in the user\'s game: get in (uid of a car), get out, start a race (uid of the race) or end it, and switch the test autopilot (steers along the race course flat out).', {
      uid: z.number().optional(), exit: z.boolean().optional(), race: z.boolean().optional().describe('uid is a race: start it'),
      end_race: z.boolean().optional(), autopilot: z.boolean().optional(),
    }, card('drive', (a) => (a.exit ? 'Getting out' : a.race ? 'Starting the race' : 'Getting in'), async (a) => {
      const r = await rpc('vehicle_drive', a);
      return { summary: r.ok ? 'Done' : 'Nothing happened', result: text(r) };
    }), opts),
  ];
};
