// Mario's lighting: how harsh the shading of his parts is and where the light comes from.
// Shared by the page (assets.js applies it to the engine), the ROM export (server/romexport/rom.js
// writes the same numbers into the info block) and Claude's tool (server/tools/assets.js).
//
// The engine lights each part of Mario with one light group (engine/src/studio/mario_look.c): the
// shadow side is the colour times amb/256 (the game: 128, half the colour), the lit side adds the
// colour times dif/256 (the game: 256). A part's "harshness" (0-100, the game 50) sets both: up
// from 50 the shadow side gets darker (to black at 100) and the lit side a little brighter; down
// from 50 the shading flattens (at 0 the shadow side is the full colour).

// Mario's parts, in the engine's order (ASSET_MARIO_* in studio_assets.h).
export const MARIO_PARTS = [
  ['overalls', 'Overalls'], ['shirt', 'Shirt & arms'], ['gloves', 'Gloves'], ['shoes', 'Shoes'], ['skin', 'Skin'], ['hair', 'Hair'], ['cap', 'Cap'],
];

// The three sliders: which parts each one shades.
export const LIGHT_GROUPS = [
  ['skin', 'Face & hair', ['skin', 'hair']],
  ['clothes', 'Clothes', ['cap', 'shirt', 'overalls']],
  ['hands', 'Hands & feet', ['gloves', 'shoes']],
];

export const GAME_LIGHT = { skin: 50, clothes: 50, hands: 50, dir: 0 };

// Beta lighting: the harsh shading of Mario in the game's 1995-96 pre-release footage (dark shadow
// sides, a strong light from one side). The finished game still holds two of its light groups,
// unused (actors/mario: the skin and the hair with a quarter of the colour as ambient instead of
// half, harshness 75); the preset goes a little further, as the footage looks.
export const MARIO_LIGHT_PRESETS = {
  game: { name: 'Game', light: { ...GAME_LIGHT } },
  beta: { name: 'Beta', light: { skin: 80, clothes: 85, hands: 82, dir: -25 } },
  soft: { name: 'Soft', light: { skin: 25, clothes: 25, hands: 25, dir: 0 } },
};

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);

// A light setting with every value in range (missing ones: the game's).
export function cleanLight(light) {
  const l = light && typeof light === 'object' ? light : {};
  const out = {};
  for (const [k] of LIGHT_GROUPS) out[k] = Math.round(clamp(l[k], 0, 100, 50));
  out.dir = Math.round(clamp(l.dir, -180, 180, 0));
  return out;
}

export const isGameLight = (light) => { const l = cleanLight(light); return LIGHT_GROUPS.every(([k]) => l[k] === 50) && l.dir === 0; };

// harshness 0-100 -> the engine's amb, dif (1/256 of the colour)
export function harshness(h) {
  h = clamp(h, 0, 100, 50);
  if (h >= 50) return { amb: Math.round(128 * (100 - h) / 50), dif: Math.round(256 + (h - 50) * 1.28) };
  return { amb: Math.round(128 + (50 - h) * 2.56), dif: Math.round(256 - (50 - h) * 3.84) };
}

// The light's direction for a turn of `deg` degrees around Mario (0: the game's, from the upper right
// front of the camera; positive turns it to his side, 90 from the right, -90 from the left of the
// screen, 180 from behind him) -> signed bytes [x, y, z] in the camera's view, or null for the game's.
export function lightDir(deg) {
  deg = clamp(deg, -180, 180, 0);
  if (Math.round(deg) === 0) return null;
  const el = Math.asin(1 / Math.sqrt(3)), yaw = (45 + deg) * Math.PI / 180, r = 40 * Math.sqrt(3);
  return [Math.round(r * Math.cos(el) * Math.sin(yaw)), Math.round(r * Math.sin(el)), Math.round(r * Math.cos(el) * Math.cos(yaw))];
}

// Everything the engine (or the ROM) needs: per part (MARIO_PARTS order) { amb, dif }, and the direction.
export function lightTable(light) {
  const l = cleanLight(light);
  const parts = MARIO_PARTS.map(([k]) => harshness(l[LIGHT_GROUPS.find(([, , ps]) => ps.includes(k))[0]]));
  return { parts, dir: lightDir(l.dir), game: isGameLight(l) };
}
