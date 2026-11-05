// Rotations of placed things. A record's pitch, yaw and roll are the game's angles (65536 a turn),
// applied like the game draws and collides objects (mtxf_rotate_zxy_and_translate): roll around Z,
// then pitch around X, then yaw around Y. The rotate handles turn things around the world's X, Y
// and Z axes (or the view's): the turned rows go back to pitch/yaw/roll.

const TURN = 65536;
const toRad = (v) => (v / 32768) * Math.PI;
const toAngle = (r) => Math.round((r / Math.PI) * 32768) & 0xffff;

// Rows of the rotation: world = x*r0 + y*r1 + z*r2 (r0, r1, r2: where the local axes point).
export function rotRows(pitch, yaw, roll) {
  const sx = Math.sin(toRad(pitch)), cx = Math.cos(toRad(pitch));
  const sy = Math.sin(toRad(yaw)), cy = Math.cos(toRad(yaw));
  const sz = Math.sin(toRad(roll)), cz = Math.cos(toRad(roll));
  return [
    [cy * cz + sx * sy * sz, cx * sz, -sy * cz + sx * cy * sz],
    [-cy * sz + sx * sy * cz, cx * cz, sy * sz + sx * cy * cz],
    [cx * sy, -sx, cx * cy],
  ];
}

// Rows back to { pitch, yaw, roll } (each 0..65535). Straight up or down (pitch ±90°) yaw and
// roll turn the same way: roll is 0 then.
export function rowsToAngles(R) {
  const sx = Math.max(-1, Math.min(1, -R[2][1]));
  const pitch = Math.asin(sx);
  if (Math.abs(sx) > 0.99999) {
    // r0 = [cos(yaw - s*roll)...]: with roll 0, r0 = [cy, 0, -sy]
    return { pitch: toAngle(pitch), yaw: toAngle(Math.atan2(-R[0][2], R[0][0])), roll: 0 };
  }
  return { pitch: toAngle(pitch), yaw: toAngle(Math.atan2(R[2][0], R[2][2])), roll: toAngle(Math.atan2(R[0][1], R[1][1])) };
}

// Rodrigues rotation of v around the unit axis k by t radians (right-handed).
export function turnVec(v, k, t) {
  const c = Math.cos(t), s = Math.sin(t), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d,
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d,
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d,
  ];
}

// A pose's angles turned by t radians around the world axis k. Around Y alone that is the yaw
// (exactly, so turning upright things keeps them upright).
export function turnAngles({ pitch = 0, yaw = 0, roll = 0 }, k, t) {
  if (Math.abs(k[0]) < 1e-9 && Math.abs(k[2]) < 1e-9) return { pitch: pitch & 0xffff, yaw: (yaw + Math.sign(k[1]) * Math.round((t / (2 * Math.PI)) * TURN)) & 0xffff, roll: roll & 0xffff };
  return rowsToAngles(rotRows(pitch, yaw, roll).map((r) => turnVec(r, k, t)));
}

// The turn that takes the angles `a` to the angles `b`, applied to `c` (a group follows its
// selected one): c' = (Rb * Ra^-1) * Rc, and where it moves an offset from the group's center.
export function relativeTurn(a, b) {
  const Ra = rotRows(a.pitch | 0, a.yaw | 0, a.roll | 0), Rb = rotRows(b.pitch | 0, b.yaw | 0, b.roll | 0);
  // world vector v: v = sum_i l_i Ra_i with l_i = dot(v, Ra_i) (rows are orthonormal) -> sum_i l_i Rb_i
  const vec = (v) => {
    const l = Ra.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    return [0, 1, 2].map((j) => l[0] * Rb[0][j] + l[1] * Rb[1][j] + l[2] * Rb[2][j]);
  };
  // (pitch and roll the same: a turn around Y, which is the yaw alone)
  const yawOnly = ((a.pitch - b.pitch) & 0xffff) === 0 && ((a.roll - b.roll) & 0xffff) === 0;
  return {
    vec,
    angles: (c) => {
      if (yawOnly) return { pitch: c.pitch & 0xffff, yaw: (c.yaw + b.yaw - a.yaw) & 0xffff, roll: c.roll & 0xffff };
      return rowsToAngles(rotRows(c.pitch | 0, c.yaw | 0, c.roll | 0).map(vec));
    },
  };
}
