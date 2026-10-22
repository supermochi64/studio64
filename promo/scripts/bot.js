// In-page fight bot (installed with page.addScriptTag). One tick per game frame: P.botTick() sets
// the controller for the NEXT frame from Mario's and Bowser's state.
(() => {
  const S16 = (a) => ((((a + 32768) % 65536) + 65536) % 65536) - 32768;
  const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;
  const BTN_B = 0x4000;
  P.findTail = (bowser) => {
    const t = P.objects().find((x) => x.bhv === 'bhvBowserTailAnchor' && x.parent === bowser);
    return t ? t.slot : -1;
  };
  P.fightInit = (opts) => {
    P.F = { phase: 'wait', t: 0, phaseT: 0, spin: 0, stickYaw: 0, events: [], opts: {
      bowser: 47, waitAction: 15, waitAfter: 4, maxWait: 200, R: 560, dir: 0, tail: 240,
      spinMin: 45, spinMax: 140, tol: 0x0A00, target: null, spinDir: 1, slowDist: 220, nearMag: 46, behind: 70, grabDist: 125, maxLow: 100, settleMin: 2, ...opts } };
    P.F.tail = P.findTail(P.F.opts.bowser);
  };
  const ev = (name, extra) => { P.F.events.push({ t: P.F.t, name, ...extra }); };
  const go = (ph) => { ev(ph); P.F.phase = ph; P.F.phaseT = 0; };
  P.botTick = () => {
    const F = P.F, o = F.opts;
    const m = P.mario(), b = P.obj(o.bowser);
    const act = m.action >>> 0;
    const by = b.yaw, bfx = Math.sin((by * Math.PI) / 32768), bfz = Math.cos((by * Math.PI) / 32768);
    let buttons = 0, yaw = 0, mag = 0;
    F.t++; F.phaseT++;
    if (F.phase === 'wait') {
      if ((b.action === o.waitAction && b.timer >= o.waitAfter) || F.phaseT > o.maxWait) go('circle');
    }
    if (F.phase === 'circle') {
      const phiM = yawTo(m.x - b.x, m.z - b.z), phiBack = (by + 32768) % 65536;
      const diff = S16(phiBack - phiM);
      if (!F.cdir) F.cdir = o.dir || (diff >= 0 ? 1 : -1);
      const step = Math.min(Math.abs(diff), 0x1C00) * F.cdir;
      const phiW = (phiM + step + 65536) % 65536;
      const wx = b.x + Math.sin((phiW * Math.PI) / 32768) * o.R, wz = b.z + Math.cos((phiW * Math.PI) / 32768) * o.R;
      yaw = yawTo(wx - m.x, wz - m.z); mag = 64;
      if (Math.abs(diff) < 0x1400) go('approach');
    }
    if (F.tail < 0) F.tail = P.findTail(o.bowser);
    const tl = F.tail >= 0 ? P.obj(F.tail) : null;
    if (F.phase === 'approach' || F.phase === 'settle') {
      // stand a little behind the tail tip, wait until the tail swings low enough to touch, punch
      const ax = tl ? tl.x : b.x - bfx * o.tail, az = tl ? tl.z : b.z - bfz * o.tail;
      const tx = ax - bfx * o.behind, tz = az - bfz * o.behind;
      const d = Math.hypot(ax - m.x, az - m.z), dt = Math.hypot(tx - m.x, tz - m.z);
      const low = tl ? tl.y - m.y : 0;
      if (F.phase === 'approach') {
        yaw = yawTo(tx - m.x, tz - m.z); mag = dt > o.slowDist ? 64 : dt > 60 ? o.nearMag : 0;
        if (dt < 45) go('settle');
      } else {
        if (dt > 90) go('approach');
        yaw = yawTo(ax - m.x, az - m.z); mag = 0;
      }
      if ((F.phase === 'settle' && d < o.grabDist && low < o.maxLow && F.phaseT >= o.settleMin) || F.phaseT > 150) {
        buttons = BTN_B; go('grab'); ev('punch', { d: Math.round(d), low: Math.round(low) });
      }
    } else if (F.phase === 'grab') {
      if (act === 0x390 || act === 0x391) go('spin');
      else if (F.phaseT > 20) go('approach');
    }
    if (F.phase === 'spin') {
      if (!o.target && o.pickTarget) {
        // the mine to throw him into: 900-2100 away, the one most in the wanted direction
        const mines = P.objects().filter((x) => x.bhv === 'bhvBowserBomb');
        let best = null, bestS = -1e9;
        for (const x of mines) {
          const dx = x.x - m.x, dz = x.z - m.z, d = Math.hypot(dx, dz);
          if (d < 900 || d > 2100) continue;
          const sc = (dx * o.pickTarget[0] + dz * o.pickTarget[1]) / d;
          if (sc > bestS) { bestS = sc; best = x; }
        }
        if (best) { o.target = [best.x, best.z]; o.targetSlot = best.slot; ev('target', { slot: best.slot, x: best.x | 0, z: best.z | 0 }); }
      }
      if (act === 0x391) {
        F.spin++;
        F.stickYaw = (F.stickYaw + o.spinDir * 0x4000 + 65536) % 65536;
        yaw = F.stickYaw; mag = 64;
        if (o.target && F.spin >= o.spinMin) {
          const want = yawTo(o.target[0] - m.x, o.target[1] - m.z);
          if (Math.abs(S16(want - m.yaw)) < o.tol || F.spin >= o.spinMax) { buttons = BTN_B; go('thrown'); ev('release', { yaw: m.yaw, want }); }
        }
      } else if (act !== 0x390) { if (F.phaseT > 5) go('approach'); }
      else { F.stickYaw = m.yaw; }
    }
    P.bot(1, buttons, yaw, mag);
    return { t: F.t, phase: F.phase, act: act.toString(16), mx: m.x | 0, mz: m.z | 0, myaw: m.yaw, hp: m.health,
      tail: tl ? [tl.x | 0, tl.y | 0, tl.z | 0] : null, my: m.y | 0, by: b.y | 0,
      bact: b.action, bsub: b.sub, bhp: b.health, bheld: b.held, bx: b.x | 0, bz: b.z | 0, byaw: b.yaw, bfvel: b.fvel | 0, bactive: b.active };
  };
})();
