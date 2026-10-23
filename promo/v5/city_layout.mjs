// Where things go in the revived town (Wet-Dry World area 2; streets at y -2560).
export const MARIO_RIM = [-700, -1500, -3300, 0];      // on the north rim walkway, looking south over the town
export const CAMS = {
  rim: [[-700, -1240, -3760], [-700, -2050, -400]],
  plaza: [[-2350, -1750, -450], [-700, -2450, 900]],
  street: [[700, -2390, 2300], [-650, -2250, 600]],
  tower: [[-700, -1450, 3550], [-700, -2350, 300]],
  east: [[2100, -1250, -1300], [-300, -2400, 900]],
};
const ring = (cx, cz, r, n, kinds, off = 0) => Array.from({ length: n }, (_, i) => { const a = off + (i / n) * Math.PI * 2; return [kinds[i % kinds.length], cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
export const PLANTS = [
  ['oak', -740, 800, 30, 150],
  ...ring(-740, 800, 300, 14, ['tulip_red', 'tulip_yellow', 'rose_pink', 'daisy', 'tulip_pink', 'rose_red', 'bluebell']),
  ...ring(-740, 800, 420, 18, ['rose_red', 'tulip_yellow', 'daisy_yellow', 'tulip_purple', 'poppy', 'rose_white'], 0.15),
  ...ring(-740, 800, 760, 12, ['bush', 'hedgeball'], 0.3),
  ['oak', -3300, -100], ['oak', -3300, 1500, 90, 120], ['oak', -3250, 2700, 40, 115], ['oak', 650, -450, 200], ['oak', -2600, -450, 10, 105],
  ['oak', 600, 2300, 60, 110], ['oak', 1500, 2700, 70, 120], ['bush', -2100, -450], ['hedgeball', -150, -450], ['bush', 900, 1000], ['hedgeball', 900, 1700],
  ['sunflower', -3450, 600], ['sunflower', -3400, 760], ['tulip_red', -3350, 900], ['tulip_yellow', -3450, 1050],
];
export const LAMPS = [[[-3000, -745], [2100, -745]], [[-3550, -900], [-3550, 2900]], [[380, 150], [380, 2500]]];
export const TOADS = [
  [-1250, 620, 215, 6], [-1090, 700, 235, 4], [-1180, 860, 225, 7],
  [-150, 700, 300, 5], [-300, 600, 150, 6],
  [-2200, -480, 20, 7], [-2050, -430, 200, 6],
  [550, 1200, 270, 4], [700, 1250, 90, 6],
  [-3200, 700, 100, 5],
];
export const BUTTERFLIES = [[-740, 520, 110], [-500, 900, 140], [-1000, 1050, 100], [-3400, 800, 120], [-900, 650, 170], [-600, 1150, 90]];
export const BUNTING = [
  [[-740, -560, 1330], [-1700, -1900, -120]], [[-740, -560, 1330], [200, -1900, -120]],
  [[-740, -560, 1330], [-1720, -1900, 1720]], [[-740, -560, 1330], [240, -1900, 1720]],
  [[-2900, -1830, -820], [-2900, -1500, -3050]],
];
