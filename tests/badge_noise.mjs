// How steady is the page's live check? Replays the page (world at 60 Hz, fish, a generation every 1.5 s, a check every
// 20 s from generation 15) and reports the mean check-to-check change of the pooled learned/untrained ratio for:
// the latest check vs the last three checks pooled (what the page shows), and 12 vs 36 paired swims per check.
// usage: node --import ./tests/no_three.mjs tests/badge_noise.mjs [LAGOONS=24] [SECONDS=240]
const R = new URL('../web/', import.meta.url).href;
const env = await import(R + 'env.js'), gym = await import(R + 'gym.js'), fishm = await import(R + 'fish.js');
const NL = +process.argv[2] || 24, TEND = +process.argv[3] || 240, TAU = Math.PI * 2;
const CFG = { W: 16, H: 10, title: { l: .178, r: 3.569, t: 9.844, b: 9.211 }, tray: { l: 7.733, r: 8.267, t: .467, b: .178 } };
const START = { manta: 2, eagle: 3, sting: 2, moon: 3, nettle: 2 };
function check(E, tr, N) { // the page's abRun (web/main.js), run to completion
  const F = env.forkEnv(E), food0 = Float32Array.from(F.food), t0 = F.t, th0 = new Float64Array(12), out = [0, 0];
  let A = 0, B = 0;
  for (const sp of env.RAYS) {
    const mem = E.rays.filter(r => r.sp === sp && !r.leaving && !r.entering); if (!mem.length) continue;
    const th = Float64Array.from(tr.S[sp].th), ray = env.makeRay(F, sp, 0, 0, 0); let a = 0, b = 0;
    for (let i = 0; i < N; i++) {
      const m = mem[i % mem.length], hh = m.h + (i * 1.7) % TAU, seed = 7001 + i * 31;
      for (const which of [0, 1]) {
        F.food.set(food0); F.t = t0; for (let q = 0; q < F.nettles.length; q++) Object.assign(F.nettles[q], F.nettles0[q]);
        Object.assign(ray, { x: m.x, y: m.y, h: hh, v: .65 * ray.P.V, turn: 0, xi: 0, flinch: 0, rest: 0, somer: -1, lead: null, entering: false, leaving: false });
        const it = gym.rollout(F, ray, which ? th : th0, seed, 360, 1 / 20, null, out); while (!it.next().done);
        if (which) b += out[1]; else a += out[1];
      }
    }
    if (a > .05) { A += a; B += b; }
  }
  return [A, B];
}
const jit = { last1_N12: [], last3_N12: [], last1_N36: [] }, mean = { last1_N12: [], last3_N12: [], last1_N36: [] };
for (let s = 1; s <= NL; s++) {
  const seed = (s * 2654435761) >>> 0 & 0x7fffffff, E = env.createEnv({ ...CFG, seed }); E.nextBloom = E.t + 3;
  for (const sp in START) for (let i = 0; i < START[sp]; i++) env.addCreature(E, sp, null, null, { free: true, instant: true });
  const fish = fishm.createFish(E, { schools: 3, per: 26 }), tr = gym.createTrainer(E, { seed: seed ^ 0x9e37 });
  let lastGen = -1e9, last = -1e9; const h12 = [], h36 = [], prev = {};
  while (E.t < TEND) {
    env.stepWorld(E, tr.thetas(), 1 / 60); fishm.stepFish(fish, E, 1 / 60);
    if (E.t - lastGen >= 1.5) { tr.runGeneration(); lastGen = E.t; }
    if (tr.gen >= 15 && E.t - last >= 20) {
      last = E.t; h12.push(check(E, tr, 12)); h36.push(check(E, tr, 36));
      const pool = (h, k) => { const w = h.slice(-k), a = w.reduce((x, p) => x + p[0], 0); return a > 0 ? w.reduce((x, p) => x + p[1], 0) / a : null; };
      const now = { last1_N12: pool(h12, 1), last3_N12: pool(h12, 3), last1_N36: pool(h36, 1) };
      for (const k in now) if (now[k] != null) { mean[k].push(now[k]); if (prev[k] != null) jit[k].push(Math.abs(now[k] - prev[k])); prev[k] = now[k]; }
    }
  }
}
const avg = v => v.reduce((a, b) => a + b, 0) / v.length;
for (const k in jit) console.log(`${k.padEnd(10)} mean ratio ${avg(mean[k]).toFixed(3)}  mean check-to-check change ${avg(jit[k]).toFixed(3)}  (${jit[k].length} pairs)`);
