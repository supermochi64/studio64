// Tokyo from the Shoggoth World hack as a level template: the city itself (one
// tokyo:city object with all of its geometry, textures, night lighting and collision), its scenery,
// traffic, people and yokai as ordinary records, its coins and red coins, the crane star and the
// red coin star, the Toads' and the sign's texts as story dialogs, its night sky and its music.
//
// The data comes from tools/import_shoggoth_tokyo.mjs (web/data/shoggoth/tokyo.json and the
// engine's tokyo:* catalog entries); without it the template is not offered.
// The builder (makeTokyoLevel) is plain JS so tools/make_tokyo_sample.mjs uses it too.

export const TOKYO = { id: 'tokyo', label: 'Tokyo', sub: 'Shoggoth World, by night' };
export const TOKYO_DATA = 'data/shoggoth/tokyo.json';
export const TOKYO_SKY = 'data/shoggoth/tokyo_sky.png';
export const TOKYO_CARD = 'data/shoggoth/tokyo_card.png'; // the night sky and Tokyo's city title card

// Shoggoth's models -> the catalog entries the import made (tokyo:<id>)
const MODEL_ENTRY = {
  MODEL_TK_TRAFFIC_LIGHT: 'traffic_light', MODEL_TK_PED_SIGNAL: 'ped_signal', MODEL_TK_SCREEN_BIG: 'screen_big',
  MODEL_TK_SCREEN_2: 'screen_2', MODEL_TK_SCREEN_TALL: 'screen_tall', MODEL_TK_NEON_FLICKER: 'neon_hotel', MODEL_TK_WATERFALL: 'waterfall',
  MODEL_TK_TAXI: 'taxi', MODEL_TK_KEI: 'kei', MODEL_TK_BUS: 'bus', MODEL_TK_KEI_TRUCK: 'kei_truck', MODEL_TK_TRAIN: 'train',
  MODEL_TK_BOAT: 'boat', MODEL_TK_CRANE_JIB: 'crane_jib', MODEL_TK_LIFT: 'lift', MODEL_SH_FIREFLY: 'firefly',
  MODEL_TK_PEDESTRIAN: 'salaryman', MODEL_TK_PEOPLE_1: 'office_lady', MODEL_TK_PEOPLE_2: 'schoolkid', MODEL_TK_PEOPLE_3: 'sailor',
  MODEL_TK_PEOPLE_4: 'harajuku', MODEL_TK_PEOPLE_5: 'station_staff', MODEL_TK_PEOPLE_6: 'takoyaki', MODEL_TK_PEOPLE_7: 'miko',
  MODEL_TK_PEOPLE_8: 'builder', MODEL_TK_PEOPLE_9: 'boatman', MODEL_TK_YAKUZA: 'yakuza', MODEL_TK_YAKUZA_BOSS: 'drift_king',
  MODEL_TK_STATIONMASTER: 'stationmaster', MODEL_TK_TUNER: 'tuner', MODEL_TK_ONI: 'oni_red', MODEL_TK_AO_ONI: 'oni_blue',
  MODEL_TK_CHOCHIN: 'chochin', MODEL_TK_KAPPA: 'kappa', MODEL_TK_TANUKI: 'tanuki',
};
const NAMES = {
  traffic_light: 'Traffic light', ped_signal: 'Pedestrian signal', screen_big: 'Giant screen', screen_2: 'Screen', screen_tall: 'Tall screen',
  neon_hotel: 'Flickering neon', taxi: 'Taxi', kei: 'Kei car', bus: 'City bus', kei_truck: 'Kei truck', train: 'Commuter train',
  boat: 'Canal boat', crane_jib: 'Crane jib', lift: 'Glass lift', firefly: 'Firefly', oni_red: 'Oni', oni_blue: 'Ao-oni',
  chochin: 'Chochin-obake', kappa: 'Kappa', tanuki: 'Tanuki', tuner: 'Tuner car', drift_king: 'The Drift King', stationmaster: 'Stationmaster',
};
// whose words the Toads and the sign say (the story's character names)
const SPEAKERS = {
  SH_TK_PLAZA: 'Harajuku Toad', SH_TK_STATION: 'Station Toad', SH_TK_ROOFS: 'Sailor Toad', SH_TK_MARKET: 'Takoyaki Toad',
  SH_TK_SHRINE: 'Shrine Toad', SH_TK_SITE: 'Builder Toad', SH_TK_CANAL: 'Boatman Toad', SH_TK_LOT: 'Salaryman Toad',
  SH_TK_YAKUZA: 'Yakuza Toad', SH_TOKYO_WELCOME: 'Arrival sign',
};
// Shoggoth's own stars that work as studio stars here (the others are in its sub-areas: the
// konbini, the maid cafe, the Hoshigaoka Line, the Shuto race)
const CRANE_STAR = { name: 'Construction Crane Climb', index: 4 };
const RED_STAR = { name: 'Red Coins All Over Tokyo', index: 2 };
// the hook of the crane's jib (Shoggoth's JIB_HOOK_REACH / JIB_HOOK_DROP): its star hangs there
const JIB_REACH = 2650, JIB_DROP = 260;

const NPC_ANIM = (1 << 16) | (6 << 8); // bhvStudioNpc: Toad's animations, standing
const STAND = (3 << 24) >>> 0;         // bhvTkPedestrian with route 3: stands and looks at Mario

let cache;
// The template data, or null when the import has not run (cached).
export function loadTokyo(base = '') {
  if (cache === undefined) cache = fetch(base + TOKYO_DATA).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
}

// Offered when the data is there and the engine has the city compiled in.
export async function tokyoAvailable(engine, base = '') {
  if (!engine?.entryIndex?.has?.('tokyo:city')) return false;
  return !!(await loadTokyo(base));
}

const b64 = (s) => (typeof atob === 'function' ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));
export const songBytes = (m64Song) => b64(m64Song.data);

// The level: { area, dialogs, npcs } for a new custom level `levelId`. uid() makes record uids.
export function makeTokyoLevel(tpl, levelId, uid = () => 1 + Math.floor(Math.random() * 0x7efffffe)) {
  const objects = [];
  const dialogs = [];
  const npcs = {};
  const rec = (o, fields) => ({ uid: uid(), x: o.x, y: o.y, z: o.z, yaw: o.yaw || 0, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: 1, ...fields });
  const entryOf = (model) => (MODEL_ENTRY[model] ? `tokyo:${MODEL_ENTRY[model]}` : null);
  const dialogFor = (key) => {
    let d = dialogs.find((x) => x.key === key);
    if (!d && tpl.texts?.[key]) {
      d = { id: `tokyo_${key.toLowerCase()}`, key, name: `Tokyo: ${SPEAKERS[key] || key}`, text: tpl.texts[key], lines: 3 };
      dialogs.push(d);
    }
    return d;
  };
  const talk = (r, key) => {
    const d = dialogFor(key);
    if (d) npcs[r.uid] = { name: SPEAKERS[key] || r.name, lines: [{ dialog: d.id, if: [] }] };
  };

  // the city: one object, all of Shoggoth's level geometry and collision
  objects.push({ uid: uid(), entry: 'tokyo:city', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Tokyo (city)' });

  const pipes = [];
  let jib = null;
  for (const o of tpl.objects || []) {
    if (o.story) continue; // story-only things (glitches, anomalies) of Shoggoth's plot
    const e = entryOf(o.model);
    switch (o.bhv) {
      case 'bhvShAnimatedProp': case 'bhvShCar': case 'bhvShTrain': case 'bhvShBoat': case 'bhvShLift': case 'bhvShFirefly':
        if (e) objects.push(rec(o, { entry: e, name: NAMES[MODEL_ENTRY[o.model]] || 'Tokyo prop' }));
        break;
      case 'bhvShCraneJib':
        if (e) { jib = rec(o, { entry: e, name: 'Crane jib' }); objects.push(jib); }
        break;
      case 'bhvShPetalEmitter':
        objects.push(rec(o, { entry: 'tokyo:petals', name: (o.bparams >> 8) & 255 ? 'Fireflies' : 'Falling petals' }));
        break;
      case 'bhvShPedestrian':
        if (e) objects.push(rec(o, { bhv: 'bhvTkPedestrian', model: e, name: 'Pedestrian' }));
        break;
      case 'bhvToadMessage': {
        if (!e) break;
        const r = rec(o, { bhv: 'bhvStudioNpc', model: e, bparams: NPC_ANIM, name: SPEAKERS[o.dialog] || 'Toad' });
        objects.push(r);
        if (o.dialog) talk(r, o.dialog);
        break;
      }
      case 'bhvShChallenger':
        // the Drift King and the stationmaster stand where they wait for Mario (their races are
        // Shoggoth's sub-levels)
        if (e) objects.push(rec(o, { bhv: 'bhvTkPedestrian', model: e, bparams: STAND, name: NAMES[MODEL_ENTRY[o.model]] }));
        break;
      case 'bhvMessagePanel': {
        const r = rec(o, { entry: 'message_panel', bparams: 0, name: 'Sign' });
        objects.push(r);
        if (o.dialog) talk(r, o.dialog);
        break;
      }
      case 'bhvGoomba':
        objects.push(e ? rec(o, { bhv: 'bhvGoomba', model: e, name: NAMES[MODEL_ENTRY[o.model]] || 'Oni' }) : rec(o, { entry: 'goomba', name: 'Goomba' }));
        break;
      case 'bhvTkChochin': case 'bhvTkKappa': case 'bhvTkTanuki':
        if (e) objects.push(rec(o, { entry: e, name: NAMES[MODEL_ENTRY[o.model]] }));
        break;
      case 'bhvStaticObject':
        if (e) objects.push(rec(o, { entry: e, name: NAMES[MODEL_ENTRY[o.model]] || 'Prop' }));
        break;
      case 'bhvCoinFormation': objects.push(rec(o, { entry: 'coin_formation', name: 'Coins' })); break;
      case 'bhvRedCoin': objects.push(rec(o, { entry: 'red_coin', bparams: 0, name: 'Red Coin' })); break;
      case 'bhv1Up': objects.push(rec(o, { entry: '1_up', bparams: 0, name: '1-Up' })); break;
      case 'bhvPoleGrabbing': objects.push(rec(o, { entry: 'pole_grabbing', name: 'Pole' })); break;
      case 'bhvHiddenRedCoinStar':
        objects.push(rec(o, { entry: 'hidden_red_coin_star', bparams: (RED_STAR.index << 24) >>> 0, name: RED_STAR.name, star: { name: RED_STAR.name } }));
        break;
      case 'bhvWarpPipe': pipes.push(o); break;
      default: break; // Star Gates, story triggers, warps into Shoggoth's sub-levels
    }
  }
  // the crane star on the jib's hook (the jib carries the star it finds there)
  if (jib) {
    const a = (jib.yaw / 65536) * Math.PI * 2;
    objects.push({ uid: uid(), entry: 'star', x: Math.round(jib.x + Math.sin(a) * JIB_REACH), y: jib.y - JIB_DROP, z: Math.round(jib.z + Math.cos(a) * JIB_REACH),
      yaw: 0, pitch: 0, roll: 0, bparams: (CRANE_STAR.index << 24) >>> 0, scale: 1, name: CRANE_STAR.name, star: { name: CRANE_STAR.name } });
  }
  // the two warp pipes lead to each other
  if (pipes.length === 2) {
    const recs = pipes.map((o, i) => rec(o, { entry: 'warp_pipe', bparams: ((0x80 + i) << 16) >>> 0, name: 'Warp pipe', warp: { kind: 'pipe', node: 0x80 + i, to: null } }));
    recs[0].warp.to = { custom: levelId, area: 1, uid: recs[1].uid };
    recs[1].warp.to = { custom: levelId, area: 1, uid: recs[0].uid };
    objects.push(...recs);
  }

  const settings = {
    sky: 6, water: { on: false, height: 0 },
    spawn: { ...tpl.spawn },
    env: { camera: { mode: 'open' } },
  };
  if (tpl.song) settings.m64Song = { name: 'Neon Crossing (Tokyo)', bank: tpl.song.bank, data: tpl.song.m64 };
  else settings.music = 3;
  return { area: { objects, removals: [], warps: [], settings }, dialogs: dialogs.map(({ key, ...d }) => d), npcs };
}

// In the studio: make the level, then its sky (an asset of the project) and its story texts.
export async function createTokyoLevel(levelsUI, name) {
  const tpl = await loadTokyo();
  if (!tpl) throw new Error('The Tokyo template is not installed');
  const id = Math.random().toString(36).slice(2, 10);
  const L = makeTokyoLevel(tpl, id);
  const S = window.studio64 || {};
  // texts first: the level's characters say them as soon as it loads
  const story = S.storyUI;
  if (story && L.dialogs.length) {
    for (const d of L.dialogs) story.op({ op: 'upsert', coll: 'dialogs', item: d }, { render: false });
    for (const [uid, v] of Object.entries(L.npcs)) story.op({ op: 'npc', uid: Number(uid), value: v }, { render: false });
  }
  levelsUI.createLevel('tokyo', L.area, name, id);
  // the night sky over Tokyo (Shoggoth's own, at its full 496x496)
  try {
    const A = S.assets;
    if (A && tpl.sky) {
      const blob = await (await fetch(TOKYO_SKY)).blob();
      const file = await A.upload(blob, 'png', 'Tokyo night sky');
      await A.save('skies', { ...(A.meta.skies || {}), [`c:${id}`]: { file, quality: 'hd', name: 'Tokyo night sky', at: Date.now() } });
      await A.applySky(A.key?.() || `c:${id}`);
    }
  } catch (err) { console.warn('tokyo sky', err); }
  return id;
}
