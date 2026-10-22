// A small WebGL viewer for imported models: the import dialog's preview (orbit,
// zoom, a grid and a Mario-sized marker for scale) and the library thumbnails.
// It draws what the game will draw: the converted textures, vertex colours and
// the baked light.

import { shadeOf } from './asset_mesh.js';

const VS = `attribute vec3 p; attribute vec2 t; attribute vec4 c;
uniform mat4 mvp; varying vec2 vt; varying vec4 vc;
void main() { gl_Position = mvp * vec4(p, 1.0); vt = t; vc = c; }`;
const FS = `precision mediump float; varying vec2 vt; varying vec4 vc;
uniform sampler2D tex; uniform float useTex; uniform float cut;
void main() { vec4 s = useTex > 0.5 ? texture2D(tex, vt) : vec4(1.0); vec4 o = s * vc; if (o.a < cut) discard; gl_FragColor = o; }`;

function persp(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(e, c, u = [0, 1, 0]) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

export class ModelPreview {
  constructor(canvas, { interactive = true, background = [0.09, 0.09, 0.11] } = {}) {
    this.canvas = canvas;
    this.bg = background;
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prg = gl.createProgram();
    gl.attachShader(prg, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prg, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prg);
    this.prg = prg;
    this.loc = { p: gl.getAttribLocation(prg, 'p'), t: gl.getAttribLocation(prg, 't'), c: gl.getAttribLocation(prg, 'c'), mvp: gl.getUniformLocation(prg, 'mvp'), useTex: gl.getUniformLocation(prg, 'useTex'), cut: gl.getUniformLocation(prg, 'cut') };
    this.parts = [];
    this.yaw = 0.7;
    this.pitch = 0.42;
    this.zoom = 1;
    this.spin = true;
    this.showMario = true;
    if (interactive) this.bind();
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; this.spin = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw = drag.yaw - (e.clientX - drag.x) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * 0.01));
      this.draw();
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.15, Math.min(6, this.zoom * Math.exp(e.deltaY * 0.0012))); this.draw(); }, { passive: false });
  }

  // pkg from asset_mesh.buildPackage/decodePackage; meta: the material settings (alpha, double, wrap, unlit)
  setPackage(pkg, meta = {}) {
    const gl = this.gl;
    for (const p of this.parts) { gl.deleteBuffer(p.buf); if (p.tex) gl.deleteTexture(p.tex); }
    this.parts = [];
    this.pkg = pkg;
    if (!pkg) { this.draw(); return; }
    const mm = meta.materials || [];
    const byMat = new Map();
    for (let t = 0; t < pkg.tris; t++) {
      const k = pkg.mat[t];
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k).push(t);
    }
    for (const [k, list] of byMat) {
      const m = pkg.materials[k] || {}, s = mm[k] || {};
      const flat = s.unlit || meta.lighting === 'flat';
      const data = new Float32Array(list.length * 3 * 9);
      let o = 0;
      for (const t of list) for (let j = 0; j < 3; j++) {
        const pi = t * 9 + j * 3, ci = t * 12 + j * 4;
        const sh = flat ? 1 : shadeOf(pkg.nrm[pi] / 127, pkg.nrm[pi + 1] / 127, pkg.nrm[pi + 2] / 127);
        data[o++] = pkg.pos[pi]; data[o++] = pkg.pos[pi + 1]; data[o++] = pkg.pos[pi + 2];
        data[o++] = pkg.uv[t * 6 + j * 2]; data[o++] = pkg.uv[t * 6 + j * 2 + 1];
        data[o++] = Math.min(1, (pkg.col[ci] / 255) * sh); data[o++] = Math.min(1, (pkg.col[ci + 1] / 255) * sh); data[o++] = Math.min(1, (pkg.col[ci + 2] / 255) * sh);
        data[o++] = s.alpha === 'blend' ? pkg.col[ci + 3] / 255 : 1;
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      let tex = null;
      if (m.tex) {
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.tex.w, m.tex.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(m.tex.rgba.buffer, m.tex.rgba.byteOffset, m.tex.rgba.byteLength));
        const wrap = (w) => (w === 'clamp' ? gl.CLAMP_TO_EDGE : w === 'mirror' ? gl.MIRRORED_REPEAT : gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(s.wrapS || m.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(s.wrapT || m.wrapT));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      this.parts.push({ buf, tex, count: list.length * 3, alpha: s.alpha || 'opaque', double: !!s.double });
    }
    // the marker and the grid
    const b = pkg.bounds;
    this.size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 200);
    this.center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    this.floorY = b.min[1];
    this.helpers();
    this.draw();
  }

  helpers() {
    const gl = this.gl;
    if (this.helper) gl.deleteBuffer(this.helper.buf);
    const v = [];
    const line = (a, b, c) => { v.push(...a, 0, 0, ...c, ...b, 0, 0, ...c); };
    const step = Math.pow(10, Math.floor(Math.log10(this.size / 2))) || 100;
    const n = Math.ceil(this.size / step / 2) + 1;
    const y = this.floorY;
    for (let i = -n; i <= n; i++) {
      const g = i === 0 ? [0.45, 0.45, 0.5, 1] : [0.22, 0.22, 0.26, 1];
      line([this.center[0] + i * step, y, this.center[2] - n * step], [this.center[0] + i * step, y, this.center[2] + n * step], g);
      line([this.center[0] - n * step, y, this.center[2] + i * step], [this.center[0] + n * step, y, this.center[2] + i * step], g);
    }
    // Mario: 160 tall, 50 wide, standing beside the model
    const mx = this.center[0] + (this.pkg.bounds.max[0] - this.center[0]) + 80, mz = this.center[2];
    const red = [1, 0.3, 0.3, 1];
    const box = [[mx - 25, y, mz - 25], [mx + 25, y, mz - 25], [mx + 25, y, mz + 25], [mx - 25, y, mz + 25]];
    for (let i = 0; i < 4; i++) {
      const a = box[i], b2 = box[(i + 1) % 4];
      line(a, b2, red);
      line([a[0], y + 160, a[2]], [b2[0], y + 160, b2[2]], red);
      line(a, [a[0], y + 160, a[2]], red);
    }
    this.marioLines = 24;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    this.helper = { buf, count: v.length / 9 };
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  draw() {
    const gl = this.gl;
    if (this.canvas.clientWidth) this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.pkg) return;
    gl.useProgram(this.prg);
    gl.enable(gl.DEPTH_TEST);
    const dist = this.size * 1.25 * this.zoom + 80;
    const c = this.center;
    const eye = [c[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * dist, c[1] + Math.sin(this.pitch) * dist, c[2] + Math.cos(this.yaw) * Math.cos(this.pitch) * dist];
    const mvp = mul(persp(0.75, this.canvas.width / this.canvas.height, dist / 200, dist * 6), lookAt(eye, c));
    gl.uniformMatrix4fv(this.loc.mvp, false, new Float32Array(mvp));
    const bindAttrs = (buf) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(this.loc.p); gl.vertexAttribPointer(this.loc.p, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(this.loc.t); gl.vertexAttribPointer(this.loc.t, 2, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(this.loc.c); gl.vertexAttribPointer(this.loc.c, 4, gl.FLOAT, false, 36, 20);
    };
    if (this.helper && this.showHelpers !== false) {
      bindAttrs(this.helper.buf);
      gl.uniform1f(this.loc.useTex, 0);
      gl.uniform1f(this.loc.cut, -1);
      gl.drawArrays(gl.LINES, 0, this.showMario ? this.helper.count : this.helper.count - this.marioLines * 2);
    }
    const order = ['opaque', 'cutout', 'blend'];
    for (const kind of order) {
      for (const p of this.parts.filter((x) => x.alpha === kind)) {
        bindAttrs(p.buf);
        if (p.double) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        if (kind === 'blend') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
        gl.uniform1f(this.loc.cut, kind === 'cutout' ? 0.5 : -1);
        gl.uniform1f(this.loc.useTex, p.tex ? 1 : 0);
        if (p.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.tex); }
        gl.drawArrays(gl.TRIANGLES, 0, p.count);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  start() {
    const tick = () => {
      if (!this.canvas.isConnected) return;
      if (this.spin) { this.yaw += 0.006; this.draw(); }
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }
  stop() { cancelAnimationFrame(this.raf); }

  dispose() {
    this.stop();
    this.setPackage(null);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// A square JPEG picture of a model for the library.
export function thumbnail(pkg, meta, size = 160) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const v = new ModelPreview(c, { interactive: false, background: [0.16, 0.17, 0.2] });
  v.showHelpers = false;
  v.yaw = 0.75;
  v.pitch = 0.38;
  v.zoom = 0.8;
  v.setPackage(pkg, meta);
  const url = c.toDataURL('image/jpeg', 0.85);
  v.dispose();
  return url;
}
