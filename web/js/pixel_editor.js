// A small pixel editor for textures: pencil, eraser, fill, line, picker, mirror
// drawing, an N64-style palette, recent colours, undo/redo, zoom and the N64
// texture sizes. openPixelEditor(...) resolves with { rgba, w, h } or null.

import { isTyping } from './editor.js';
import { TEX_FORMATS, quantize, parseColor, hex, rasterize, toCanvas } from './texcodec.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PALETTE = [
  '#000000', '#3c3c3c', '#7b7b7b', '#b5b5b5', '#ffffff', '#5a2e12', '#8b5a2b', '#c8955c', '#f2d3a0',
  '#7a0d0d', '#d01818', '#ff5a3c', '#ff9e7a', '#a34800', '#ff8a00', '#ffc83d', '#fff27a',
  '#1e4d0f', '#2f8f1f', '#5ccf3a', '#b6f07a', '#0d3d4d', '#13808c', '#2ed0c8', '#a0fff0',
  '#0e1f6b', '#1f4fd6', '#4aa0ff', '#a8d8ff', '#3c136b', '#7d2fd6', '#c27aff', '#ff7ad2',
];

const SIZES = [8, 16, 32, 64, 128];
const TOOLS = [
  ['pencil', 'Pencil (B)', '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>'],
  ['eraser', 'Eraser: transparent (E)', '<path d="M7 21h10M5 15l8-8 6 6-6 6H9z"/>'],
  ['fill', 'Fill (G)', '<path d="M5 12l7-7 7 7-7 7z"/><path d="M19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z"/>'],
  ['line', 'Line (L)', '<path d="M5 19 19 5"/>'],
  ['picker', 'Pick a colour (I)', '<path d="M20 4l-4 0-9 9 4 4 9-9zM4 20l3-3"/>'],
];

export function openPixelEditor({ title = 'Edit pixels', rgba, w, h, sizes = true, format = 'rgba32', original = null } = {}) {
  return new Promise((resolve) => {
    let W = w, H = h;
    let px = new Uint8ClampedArray(rgba || new Uint8ClampedArray(w * h * 4).fill(255));
    let color = [255, 255, 255, 255];
    let tool = 'pencil';
    let mirror = false;
    let fmt = format;
    let zoom = Math.max(4, Math.floor(Math.min(520 / W, 520 / H)));
    const undo = [], redo = [];
    const recent = [];

    const back = el('div', 'px-back');
    const win = el('div', 'px-window');
    back.appendChild(win);
    win.innerHTML = `
      <div class="px-head"><div class="px-title">${esc(title)}</div><div class="px-size"></div><span class="spacer"></span>
        <button class="btn sm ghost" data-a="cancel">Cancel</button><button class="btn sm primary" data-a="done">Use this</button></div>
      <div class="px-body">
        <div class="px-tools"></div>
        <div class="px-stage"><canvas class="px-canvas"></canvas></div>
        <div class="px-side">
          <div class="px-label">Colour</div>
          <div class="px-current"><input type="color" class="px-color" value="#ffffff"><input type="range" class="px-alpha" min="0" max="255" value="255" title="Opacity"></div>
          <div class="px-pal"></div>
          <div class="px-label">Recent</div><div class="px-recent"></div>
          <div class="px-label">N64 format</div><select class="px-fmt">${Object.entries(TEX_FORMATS).map(([k, v]) => `<option value="${k}" ${k === fmt ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
          ${sizes ? `<div class="px-label">Size</div><div class="px-sizes">${SIZES.map((s) => `<button class="chip" data-size="${s}">${s}×${s}</button>`).join('')}</div>` : ''}
          <div class="px-label">Tools</div>
          <label class="px-check"><input type="checkbox" class="px-mirror"> Mirror drawing (left ↔ right)</label>
          <div class="px-row"><button class="btn sm" data-a="undo" title="Ctrl+Z">Undo</button><button class="btn sm" data-a="redo" title="Ctrl+Y">Redo</button></div>
          <div class="px-row"><button class="btn sm" data-a="fliph">Flip ↔</button><button class="btn sm" data-a="flipv">Flip ↕</button><button class="btn sm" data-a="rot">Turn 90°</button></div>
          <div class="px-row"><button class="btn sm" data-a="clear">Clear</button>${original ? '<button class="btn sm" data-a="orig">Original</button>' : ''}</div>
          <div class="px-preview-label px-label">Tiled</div><canvas class="px-tiled" width="120" height="120"></canvas>
        </div>
      </div>`;
    document.body.appendChild(back);
    const cv = win.querySelector('.px-canvas');
    const g = cv.getContext('2d');
    const tiled = win.querySelector('.px-tiled');

    const toolsBox = win.querySelector('.px-tools');
    for (const [id, label, path] of TOOLS) {
      const b = el('button', `px-tool${id === tool ? ' active' : ''}`, `<svg class="i" viewBox="0 0 24 24">${path}</svg>`);
      b.title = label;
      b.dataset.tool = id;
      b.onclick = () => setTool(id);
      toolsBox.appendChild(b);
    }
    const setTool = (id) => { tool = id; toolsBox.querySelectorAll('.px-tool').forEach((x) => x.classList.toggle('active', x.dataset.tool === id)); };

    const pal = win.querySelector('.px-pal');
    for (const c of PALETTE) {
      const b = el('button', 'px-sw');
      b.style.background = c;
      b.title = c;
      b.onclick = () => setColor([...parseColor(c), 255]);
      pal.appendChild(b);
    }
    const colorIn = win.querySelector('.px-color'), alphaIn = win.querySelector('.px-alpha');
    colorIn.oninput = () => { color = [...parseColor(colorIn.value), Number(alphaIn.value)]; };
    alphaIn.oninput = () => { color[3] = Number(alphaIn.value); };
    const setColor = (c) => {
      color = c;
      colorIn.value = hex(c.slice(0, 3));
      alphaIn.value = c[3];
      if (tool === 'picker' || tool === 'eraser') setTool('pencil');
    };
    const remember = () => {
      const h0 = hex(color.slice(0, 3));
      const i = recent.indexOf(h0);
      if (i >= 0) recent.splice(i, 1);
      recent.unshift(h0);
      recent.length = Math.min(recent.length, 12);
      const box = win.querySelector('.px-recent');
      box.innerHTML = '';
      for (const c of recent) { const b = el('button', 'px-sw'); b.style.background = c; b.onclick = () => setColor([...parseColor(c), 255]); box.appendChild(b); }
    };

    const render = () => {
      cv.width = W * zoom;
      cv.height = H * zoom;
      win.querySelector('.px-size').textContent = `${W} × ${H}`;
      // checkerboard under transparency
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        g.fillStyle = (x + y) % 2 ? '#2a2a30' : '#3a3a42';
        g.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
      const img = toCanvas(px, W, H);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, W * zoom, H * zoom);
      if (zoom >= 6) {
        g.strokeStyle = 'rgba(0,0,0,0.25)';
        g.lineWidth = 1;
        g.beginPath();
        for (let x = 0; x <= W; x++) { g.moveTo(x * zoom + 0.5, 0); g.lineTo(x * zoom + 0.5, H * zoom); }
        for (let y = 0; y <= H; y++) { g.moveTo(0, y * zoom + 0.5); g.lineTo(W * zoom, y * zoom + 0.5); }
        g.stroke();
      }
      const tg = tiled.getContext('2d');
      tg.imageSmoothingEnabled = false;
      tg.clearRect(0, 0, 120, 120);
      const ts = 40;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) tg.drawImage(img, x * ts, y * ts, ts, ts);
    };

    const snapshot = () => { undo.push({ px: new Uint8ClampedArray(px), W, H }); if (undo.length > 80) undo.shift(); redo.length = 0; };
    const restore = (s) => { px = s.px; W = s.W; H = s.H; render(); };
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H)];
    };
    const put = (x, y, c) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
    };
    const plot = (x, y) => {
      const c = tool === 'eraser' ? [0, 0, 0, 0] : color;
      put(x, y, c);
      if (mirror) put(W - 1 - x, y, c);
    };
    const lineTo = (x0, y0, x1, y1) => {
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let n = 0; n < 4096; n++) {
        plot(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    };
    const fill = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i0 = (y * W + x) * 4;
      const target = [px[i0], px[i0 + 1], px[i0 + 2], px[i0 + 3]];
      const c = color;
      if (target.every((v, k) => v === c[k])) return;
      const stack = [[x, y]];
      const same = (i) => px[i] === target[0] && px[i + 1] === target[1] && px[i + 2] === target[2] && px[i + 3] === target[3];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const i = (cy * W + cx) * 4;
        if (!same(i)) continue;
        put(cx, cy, c);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    };

    let down = null;
    cv.addEventListener('pointerdown', (e) => {
      const [x, y] = at(e);
      cv.setPointerCapture(e.pointerId);
      if (tool === 'picker' || e.altKey) {
        const i = (y * W + x) * 4;
        setColor([px[i], px[i + 1], px[i + 2], px[i + 3] || 255]);
        return;
      }
      snapshot();
      if (tool === 'fill') { fill(x, y); if (mirror) fill(W - 1 - x, y); remember(); render(); return; }
      down = { x, y, base: new Uint8ClampedArray(px) };
      if (tool !== 'line') plot(x, y);
      render();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!down) return;
      const [x, y] = at(e);
      if (tool === 'line') { px.set(down.base); lineTo(down.x, down.y, x, y); } else { lineTo(down.x, down.y, x, y); down.x = x; down.y = y; }
      render();
    });
    cv.addEventListener('pointerup', () => { if (down) { down = null; if (tool !== 'eraser') remember(); } });
    win.querySelector('.px-stage').addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom = Math.max(1, Math.min(48, zoom + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(zoom / 6))));
      render();
    }, { passive: false });
    win.querySelector('.px-mirror').onchange = (e) => { mirror = e.target.checked; };
    win.querySelector('.px-fmt').onchange = (e) => { fmt = e.target.value; };

    win.querySelectorAll('[data-size]').forEach((b) => {
      b.onclick = () => {
        const s = Number(b.dataset.size);
        snapshot();
        const src = toCanvas(px, W, H);
        px = new Uint8ClampedArray(rasterize(src, s, s, { smooth: s < W }));
        W = H = s;
        zoom = Math.max(4, Math.floor(Math.min(520 / W, 520 / H)));
        render();
      };
    });
    const act = {
      undo: () => { if (undo.length) { redo.push({ px: new Uint8ClampedArray(px), W, H }); restore(undo.pop()); } },
      redo: () => { if (redo.length) { undo.push({ px: new Uint8ClampedArray(px), W, H }); restore(redo.pop()); } },
      fliph: () => { snapshot(); const o = new Uint8ClampedArray(px); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 4; k++) px[(y * W + x) * 4 + k] = o[(y * W + (W - 1 - x)) * 4 + k]; render(); },
      flipv: () => { snapshot(); const o = new Uint8ClampedArray(px); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 4; k++) px[(y * W + x) * 4 + k] = o[((H - 1 - y) * W + x) * 4 + k]; render(); },
      rot: () => { snapshot(); const o = new Uint8ClampedArray(px), w0 = W, h0 = H; W = h0; H = w0; px = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) for (let k = 0; k < 4; k++) px[(x * W + (h0 - 1 - y)) * 4 + k] = o[(y * w0 + x) * 4 + k]; render(); },
      clear: () => { snapshot(); px.fill(0); render(); },
      orig: () => { snapshot(); px = new Uint8ClampedArray(original.rgba); W = original.w; H = original.h; render(); },
      cancel: () => finish(null),
      done: () => finish({ rgba: quantize(new Uint8ClampedArray(px), fmt), w: W, h: H, format: fmt }),
    };
    win.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => act[b.dataset.a](); });
    const onKey = (e) => {
      // (the colour well and sliders keep the focus after a click: they don't take keys, the editor does)
      if (isTyping() && e.key !== 'Escape') { e.stopPropagation(); return; }
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
      // e.code: with Shift (redo) or Caps Lock e.key is 'Z'
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? act.redo() : act.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); act.redo(); return; }
      const k = { b: 'pencil', e: 'eraser', g: 'fill', l: 'line', i: 'picker' }[e.key.toLowerCase()];
      if (k) setTool(k);
    };
    window.addEventListener('keydown', onKey, true);
    const finish = (result) => {
      window.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(result);
    };
    render();
  });
}
