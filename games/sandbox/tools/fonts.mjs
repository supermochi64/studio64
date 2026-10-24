// The HUD's fonts: our own 5x7 pixel letters (textures.mjs) with a dark outline, at 1x, 2x and 3x,
// written as BMFont files (a .fnt and its page .png) that libdragon's mkfont turns into .font64.
import fs from 'node:fs';
import { Canvas } from './lib/png.mjs';
import { FONT5x7 } from './textures.mjs';

export function writeFonts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const names = [];
  for (const s of [1, 2, 3]) {
    const cw = 7 * s, ch = 9 * s, cols = 16, rows = 6;
    const W = 1 << Math.ceil(Math.log2(cols * cw)), H = 1 << Math.ceil(Math.log2(rows * ch));
    const cv = new Canvas(W, H, [0, 0, 0, 0]);
    const lines = [];
    let count = 0;
    for (let code = 32; code < 128; code++) {
      const chr = String.fromCharCode(code);
      const g = FONT5x7[chr] || FONT5x7[chr.toUpperCase()];
      if (!g) continue;
      const small = chr !== chr.toUpperCase();
      const k = code - 32, ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
      const on = (i, j) => { if (i < 0 || j < 0 || i >= 5 || j >= 7) return false; const jj = small ? Math.round((j - 2) * 7 / 5) : j; if (small && (j < 2 || jj > 6)) return false; return g[jj][i] === '1'; };
      // the outline (a pixel round every lit one), then the letter
      for (let j = -1; j <= 7; j++) for (let i = -1; i <= 5; i++) {
        let lit = on(i, j), edge = false;
        if (!lit) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (on(i + di, j + dj)) edge = true;
        if (!lit && !edge) continue;
        cv.rect(ox + (i + 1) * s, oy + (j + 1) * s, s, s, lit ? [255, 255, 255, 255] : [16, 16, 16, 255]);
      }
      lines.push(`char id=${code} x=${ox} y=${oy} width=${cw} height=${ch} xoffset=${-s} yoffset=${-s} xadvance=${6 * s} page=0 chnl=15`);
      count++;
    }
    cv.save(`${dir}/font${s}.png`);
    fs.writeFileSync(`${dir}/font${s}.fnt`, [
      `info face="Sandbox" size=${8 * s} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=0,0`,
      `common lineHeight=${10 * s} base=${8 * s} scaleW=${W} scaleH=${H} pages=1 packed=0`,
      `page id=0 file="font${s}.png"`,
      `chars count=${count}`,
      ...lines, '',
    ].join('\n'));
    names.push(`font${s}`);
  }
  return names;
}
