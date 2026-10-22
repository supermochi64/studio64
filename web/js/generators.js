// Block shapes, materials and the generators that build structures out of blocks.
// Shared by the editor UI and Claude's build tool, so both make the same things.

export const SHAPES = { box: 0, ramp: 1, stairs: 2, pillar: 3 };
export const SHAPE_NAMES = ['Box', 'Ramp', 'Stairs', 'Pillar'];

export const SURFACES = {
  normal: 0x0000, slippery: 0x0014, ice: 0x0013, not_slippery: 0x0015, lava: 0x0001,
  hangable: 0x0005, death: 0x000A, vanish_wall: 0x007B, hard: 0x0030,
};
export const SURFACE_LABELS = {
  normal: 'Normal', not_slippery: 'Grippy (climbable slopes)', slippery: 'Slippery', ice: 'Ice (very slippery)',
  lava: 'Lava (burns)', hangable: 'Hangable ceiling', hard: 'Hard (fall damage)', death: 'Death floor', vanish_wall: 'Vanish-cap wall',
};

// The order of the materials table in src/studio/editor.c.
export const MATERIALS = ['grass', 'dirt', 'cobblestone', 'stone path', 'blue stone', 'dark brick', 'grey brick',
  'red brick', 'orange brick', 'castle stone', 'stone block', 'mossy block', 'wood planks', 'wood floor', 'checker',
  'tiles', 'marble', 'sand', 'snow', 'ice', 'lava', 'metal', 'metal plate', 'yellow block', 'rainbow', 'rock', 'roof',
  'dark grass', 'water'];
export const material = (m) => {
  if (typeof m === 'number') return Math.max(0, Math.min(MATERIALS.length - 1, m | 0));
  const i = MATERIALS.indexOf(String(m || '').toLowerCase().replace(/_/g, ' '));
  return i < 0 ? 0 : i;
};

export const PRESETS = [
  { id: 'box', label: 'Box', block: { shape: 0, sx: 300, sy: 300, sz: 300 } },
  { id: 'platform', label: 'Platform', block: { shape: 0, sx: 400, sy: 60, sz: 400 } },
  { id: 'ledge', label: 'Ledge', block: { shape: 0, sx: 260, sy: 50, sz: 160 }, wall: true },
  { id: 'wall', label: 'Wall', block: { shape: 0, sx: 600, sy: 500, sz: 60 } },
  { id: 'floor', label: 'Big floor', block: { shape: 0, sx: 1200, sy: 40, sz: 1200 } },
  { id: 'ramp', label: 'Ramp', block: { shape: 1, sx: 400, sy: 300, sz: 700 } },
  { id: 'stairs', label: 'Stairs', block: { shape: 2, sx: 400, sy: 320, sz: 640, steps: 8 } },
  { id: 'pillar', label: 'Pillar', block: { shape: 3, sx: 260, sy: 600, sz: 260 } },
];

const DEG = Math.PI / 180;
export const yawToRad = (yaw) => (yaw / 32768) * Math.PI;
export const radToYaw = (r) => Math.round((r / Math.PI) * 32768) & 0xffff;
export const degToYaw = (d) => Math.round((d / 360) * 65536) & 0xffff;
export const yawToDeg = (y) => Math.round((((y & 0xffff) / 65536) * 360) * 10) / 10;

// Default block record fields.
export function blockDefaults(b = {}) {
  const top = material(b.top ?? b.material ?? 'grass');
  return {
    shape: typeof b.shape === 'string' ? (SHAPES[b.shape] ?? 0) : (b.shape ?? 0),
    sx: Math.round(b.sx ?? 300), sy: Math.round(b.sy ?? 300), sz: Math.round(b.sz ?? 300),
    steps: b.steps ?? 8,
    top,
    side: material(b.side ?? b.material ?? (top === 0 ? 'grass' : b.top ?? top)),
    surface: typeof b.surface === 'string' ? (SURFACES[b.surface] ?? 0) : (b.surface ?? 0),
    flags: (b.invisible ? 1 : 0) | (b.no_collision ? 2 : 0) | (b.flags ?? 0),
    color: typeof b.color === 'string' ? parseInt(b.color.replace('#', ''), 16) : (b.color ?? 0xffffff),
  };
}

export function blockName(block) {
  const shape = SHAPE_NAMES[block.shape] || 'Block';
  const mat = MATERIALS[block.top] || '';
  return `${mat.replace(/\b\w/g, (c) => c.toUpperCase())} ${shape.toLowerCase()}`.trim();
}

function rec(block, x, y, z, yaw = 0) {
  return { block: blockDefaults(block), x: Math.round(x), y: Math.round(y), z: Math.round(z), yaw: yaw & 0xffff, pitch: 0, roll: 0 };
}

// Generators return block records (without uid). `origin` is where it starts,
// `yaw` the direction it goes (SM64 yaw units; 0 = +Z).
export const GENERATORS = {
  stairs: {
    label: 'Staircase',
    params: { width: 400, height: 600, steps: 12, depth: 900, material: 'stone block' },
    build({ x, y, z, yaw = 0, width = 400, height = 600, steps = 12, depth, material: mat = 'stone block' }) {
      depth = depth ?? height * 1.5;
      const a = yawToRad(yaw);
      return [rec({ shape: 2, sx: width, sy: height, sz: depth, steps, top: mat, side: mat },
        x + Math.sin(a) * depth / 2, y, z + Math.cos(a) * depth / 2, yaw)];
    },
  },
  spiral: {
    label: 'Spiral staircase',
    params: { radius: 400, steps: 16, rise: 60, turn: 22.5, width: 300, material: 'castle stone', pillar: true },
    build({ x, y, z, yaw = 0, radius = 400, steps = 16, rise = 60, turn = 22.5, width = 300, material: mat = 'castle stone', pillar = true }) {
      const out = [];
      const start = yawToRad(yaw);
      // each step is a short two-step stair piece facing along the spiral, so Mario walks
      // up it (a plain slab per step would be a ledge too tall to step onto)
      for (let i = 0; i < steps; i++) {
        const a = start + (i + 0.5) * turn * DEG;
        const cx = x + Math.sin(a) * radius, cz = z + Math.cos(a) * radius;
        const len = Math.max(140, 2 * radius * Math.sin((turn * DEG) / 2) + 30);
        out.push(rec({ shape: 2, sx: width, sy: rise, sz: len, steps: 2, top: mat, side: mat }, cx, y + i * rise, cz, radToYaw(a + Math.PI / 2)));
      }
      if (pillar) out.push(rec({ shape: 3, sx: Math.max(120, radius - width / 2 - 40) * 2, sy: (steps + 1) * rise, sz: Math.max(120, radius - width / 2 - 40) * 2, top: mat, side: mat }, x, y, z, 0));
      return out;
    },
  },
  wall_climb: {
    label: 'Wall climb',
    params: { ledges: 8, rise: 200, spread: 260, width: 240, depth: 160, material: 'wood planks' },
    // origin is a point on the wall; yaw faces away from the wall
    build({ x, y, z, yaw = 0, ledges = 8, rise = 200, spread = 260, width = 240, depth = 160, material: mat = 'wood planks' }) {
      const a = yawToRad(yaw);
      const out = [];
      const ox = Math.sin(a) * depth / 2, oz = Math.cos(a) * depth / 2;   // out from the wall
      const rx = -Math.cos(a), rz = Math.sin(a);                          // along the wall
      for (let i = 0; i < ledges; i++) {
        const side = (i % 2 === 0 ? -1 : 1) * spread / 2;
        out.push(rec({ shape: 0, sx: width, sy: 50, sz: depth, top: mat, side: mat }, x + ox + rx * side, y + (i + 1) * rise - 50, z + oz + rz * side, yaw));
      }
      return out;
    },
  },
  bridge: {
    label: 'Bridge',
    params: { width: 260, thickness: 40, planks: 0, material: 'wood planks' },
    // from (x,y,z) to (x2,y2,z2)
    build({ x, y, z, x2, y2, z2, width = 260, thickness = 40, planks = 0, material: mat = 'wood planks' }) {
      if (x2 === undefined) return [];
      const dx = x2 - x, dz = z2 - z, dy = (y2 ?? y) - y;
      const len = Math.hypot(dx, dz);
      const yaw = radToYaw(Math.atan2(dx, dz));
      if (!planks || planks < 2) {
        // one solid deck; a sloped bridge becomes a ramp-like series of slabs
        const n = Math.abs(dy) > 40 ? Math.max(2, Math.ceil(len / 200)) : 1;
        return Array.from({ length: n }, (_, i) => {
          const t = (i + 0.5) / n;
          return rec({ shape: 0, sx: width, sy: thickness, sz: len / n + 4, top: mat, side: mat }, x + dx * t, y + dy * t - thickness, z + dz * t, yaw);
        });
      }
      return Array.from({ length: planks }, (_, i) => {
        const t = (i + 0.5) / planks;
        return rec({ shape: 0, sx: width, sy: thickness, sz: len / planks * 0.7, top: mat, side: mat }, x + dx * t, y + dy * t - thickness, z + dz * t, yaw);
      });
    },
  },
  path: {
    label: 'Floating platforms',
    params: { count: 6, gap: 380, rise: 120, size: 260, wiggle: 160, material: 'checker' },
    build({ x, y, z, yaw = 0, count = 6, gap = 380, rise = 120, size = 260, wiggle = 160, material: mat = 'checker' }) {
      const a = yawToRad(yaw);
      const fx = Math.sin(a), fz = Math.cos(a), rx = -Math.cos(a), rz = Math.sin(a);
      return Array.from({ length: count }, (_, i) => {
        const side = Math.sin(i * 1.9) * wiggle;
        return rec({ shape: 0, sx: size, sy: 60, sz: size, top: mat, side: mat }, x + fx * gap * (i + 1) + rx * side, y + rise * (i + 1), z + fz * gap * (i + 1) + rz * side, yaw);
      });
    },
  },
  tower: {
    label: 'Tower',
    params: { floors: 4, size: 700, floorHeight: 400, material: 'castle stone' },
    // hollow tower: walls on four sides with a door gap, floors with a hole, stairs inside
    build({ x, y, z, yaw = 0, floors = 4, size = 700, floorHeight = 400, material: mat = 'castle stone' }) {
      const out = [];
      const a = yawToRad(yaw);
      const t = 60;
      const at = (f, r, h) => [x + Math.sin(a) * f - Math.cos(a) * r, y + h, z + Math.cos(a) * f + Math.sin(a) * r];
      const H = floors * floorHeight;
      // back and side walls, front wall with a doorway on the ground floor
      out.push(rec({ shape: 0, sx: size, sy: H, sz: t, top: mat, side: mat }, ...at(size / 2 - t / 2, 0, 0), yaw));
      out.push(rec({ shape: 0, sx: t, sy: H, sz: size, top: mat, side: mat }, ...at(0, size / 2 - t / 2, 0), yaw));
      out.push(rec({ shape: 0, sx: t, sy: H, sz: size, top: mat, side: mat }, ...at(0, -size / 2 + t / 2, 0), yaw));
      const door = 220;
      out.push(rec({ shape: 0, sx: (size - door) / 2, sy: H, sz: t, top: mat, side: mat }, ...at(-size / 2 + t / 2, size / 4 + door / 4, 0), yaw));
      out.push(rec({ shape: 0, sx: (size - door) / 2, sy: H, sz: t, top: mat, side: mat }, ...at(-size / 2 + t / 2, -size / 4 - door / 4, 0), yaw));
      out.push(rec({ shape: 0, sx: door, sy: H - 300, sz: t, top: mat, side: mat }, ...at(-size / 2 + t / 2, 0, 300), yaw));
      for (let f = 1; f <= floors; f++) {
        // floor slab with a stair hole on alternating sides
        const hole = f % 2 ? 1 : -1;
        out.push(rec({ shape: 0, sx: size / 2, sy: 40, sz: size, top: mat, side: mat }, ...at(0, -hole * size / 4, f * floorHeight - 40), yaw));
        out.push(rec({ shape: 0, sx: size / 2, sy: 40, sz: size / 2, top: mat, side: mat }, ...at(size / 4, hole * size / 4, f * floorHeight - 40), yaw));
        // stairs up through the hole
        out.push(rec({ shape: 2, sx: size / 2 - t, sy: floorHeight, sz: size / 2, steps: 8, top: mat, side: mat }, ...at(-size / 4 + 10, hole * (size / 4 - t / 2), (f - 1) * floorHeight), yaw));
      }
      return out;
    },
  },
};
