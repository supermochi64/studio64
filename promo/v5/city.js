// The sunken city brought back to life (Wet-Dry World's town, area 2): page-side scene script for the
// promo captures. Loaded with page.addScriptTag after lib.mjs's helpers; window.CITY.
(() => {
  const S = window.studio64, e = S.engine, M = e.M;
  const ground = (x, z) => e.floor(x, -300, z);
  const mod = {};
  const imp = async (p) => (mod[p] ||= await import(p));

  // the town's clutter: boxes, coins, enemies, the water switches
  const CLUTTER = /Coin|Box|Skeeter|FireSpitter|Hidden|ExclamationMark|WaterLevel|ChangingWater|RedCoinStar|StarMarker|bhvStar$|PoleGrabbing|FloorSwitch|1up/;

  const CITY = {
    clear() {
      let n = 0;
      for (const o of P.objects()) if (CLUTTER.test(o.bhv)) { M._studio_delete_slot(o.slot); n++; }
      return n;
    },

    // ---- before: the flood, an overcast sky -------------------------------------------------
    async flood(h = -1950, color = 0x5d8582) {
      e.setWater(true, h);
      // murky water planes (the studio's own, darker)
      const mat = (await imp('/js/generators.js')).material;
      for (let i = 0; i < 4; i++) e.deleteUid(0x7e100000 + i);
      let i = 0;
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
        e.spawn({ uid: 0x7e100000 + i++, block: { shape: 0, sx: 12000, sy: 4, sz: 12000, top: mat('water'), side: mat('water'), surface: 0, flags: 2 | 4, color, steps: 0 },
          x: dx * 6000, y: h - 4, z: dz * 6000, yaw: 0, pitch: 0, roll: 0 });
      }
      await S.studio.handle('sky_generate', { top: '#42505e', horizon: '#8a96a2', bottom: '#56616c', clouds: 0.95, cloud_color: '#a7b0b9', sun: false, seed: 4, hd: true });
    },

    // ---- after ----------------------------------------------------------------------------------
    async drain() {
      for (let i = 0; i < 4; i++) e.deleteUid(0x7e100000 + i);
      e.setWater(true, -6000);
      await S.studio.handle('sky_generate', { top: '#1f6fe0', horizon: '#c4e8ff', bottom: '#9cc8e8', clouds: 0.55, cloud_color: '#ffffff', sun: true, sun_color: '#fff4c2', seed: 7, hd: true });
    },

    // textures: { path: dataURL } (Codex's sheet, cut by art/make_city_tex.py)
    async textures(files) {
      const A = S.assets;
      const list = await A.catalog();
      await A.locate();
      const batch = [];
      for (const [path, url] of Object.entries(files)) {
        const t = list.find((x) => x.path === path);
        if (!t) { console.warn('city: no texture', path); continue; }
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        batch.push({ t, rgba: new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer), w: c.width, h: c.height, note: 'promo: the city reborn' });
      }
      await A.replaceTextures(batch);
      return batch.length;
    },
    async resetTextures(paths) {
      const A = S.assets, list = await A.catalog();
      for (const p of paths) { const t = list.find((x) => x.path === p); if (t) await A.resetTexture(t); }
    },

    // plants at exact spots: [kind, x, z, yawDeg?, scale%?]
    plant(items) {
      const ops = S.paths.ui.ops;
      const its = items.map(([k, x, z, yaw = (x * 7 + z * 3) % 360, sc = 100]) => [k, Math.round(x), Math.round(ground(x, z)), Math.round(z), Math.round(yaw), sc, 0, 0]);
      return ops.addPlants(its);
    },
    lamps(pts) {
      return S.studio.handle('paths_add_line', { style: 'lamps', points: pts.map(([x, z]) => ({ x, z })) });
    },

    // strings of little flags between two points (x, y, z), sagging
    async bunting(id, a, b, { sag = 140, n = 18, colors = [[230, 60, 60], [250, 200, 40], [60, 150, 230], [80, 190, 90], [245, 245, 245], [240, 120, 180]] } = {}) {
      const { Mesh, V, MAT } = await imp('/js/paths/mesh.js');
      const mesh = new Mesh();
      mesh.mat('flag', null, MAT.DOUBLE);
      const P3 = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.12) / n, t1 = (i + 0.88) / n;
        const p0 = P3(t0), p1 = P3(t1), m = P3((t0 + t1) / 2);
        const tip = [m[0], m[1] - 62, m[2]];
        const c = colors[i % colors.length];
        mesh.tri('flag', V(p0, [0, 0], c), V(p1, [1, 0], c), V(tip, [0.5, 1], c.map((v) => v * 0.88)), null, false);
      }
      // the string
      mesh.mat('rope', null, 0);
      for (let i = 0; i < 24; i++) {
        const p0 = P3(i / 24), p1 = P3((i + 1) / 24);
        mesh.quad('rope', V(p0, [0, 0], [235, 235, 230]), V(p1, [1, 0], [235, 235, 230]), V([p1[0], p1[1] - 3, p1[2]], [1, 1], [200, 200, 195]), V([p0[0], p0[1] - 3, p0[2]], [0, 1], [200, 200, 195]), null, false);
      }
      return S.paths.place(`promo:${id}`, mesh, { kind: 'line' });
    },

    // Toads standing about (the actor behaviour, idle animations); [x, z, yawDeg, anim]
    toads(list) {
      const slots = [];
      for (const [x, z, yaw, anim = 6] of list) {
        const def = { name: 'Toad', model: 'toad_message', move: 'stand', faceMario: false, harmless: true, damage: 0, stomp: false, punch: false, invincible: true,
          knockback: false, coins: 0, anim, defeat: 'poof', sounds: { alert: '', hit: '', defeat: '', attack: '' }, scale: 1 };
        const rec = { uid: 0x7d000000 + slots.length, bhv: 'bhvStudioActor', model: def.model, actor: def, x, y: ground(x, z), z, yaw: Math.round((yaw / 360) * 65536) & 0xffff, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Toad' };
        slots.push(e.spawn(rec));
      }
      return slots;
    },
    // butterflies (the game's own) [x, z, height above ground]
    butterflies(list) {
      return list.map(([x, z, h = 120], i) => P.spawn({ uid: 0x7d100000 + i, entry: 'butterfly', x, y: ground(x, z) + h, z, yaw: (i * 9000) & 0xffff }));
    },
  };
  window.CITY = CITY;
})();
