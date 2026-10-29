// Acceptance: for env seeds, train 60 generations (about 90 s of lagoon time) then compare learned vs untrained
// in the same frozen lagoon from the same starts and noise. Reports plankton ratio and the per-swim penalty (stings, swimming effort, edge).
// usage: node tests/learning.mjs SEED TAP_EVERY_S [fixed]   ('fixed' turns off the self-tuned exploration size)
const R = new URL('../web/', import.meta.url).href;
const env = await import(R + 'env.js'), gym = await import(R + 'gym.js');
const eseed = +process.argv[2], tap = +process.argv[3], adapt = process.argv[4] !== 'fixed';
function evalTheta(E, sp, th, seeds) {
  let eat = 0, cost = 0; const F = env.forkEnv(E), food0 = Float32Array.from(F.food), ray = env.makeRay(F, sp, 0, 0, 0), out = [0, 0];
  const mem = E.rays.filter(r => r.sp === sp);
  for (const sd of seeds) {
    const m = mem[sd % mem.length]; F.food.set(food0); F.t = E.t; for (let q = 0; q < F.nettles.length; q++) Object.assign(F.nettles[q], F.nettles0[q]);
    Object.assign(ray, { x: m.x, y: m.y, h: (sd * 1.7) % 6.28, v: .65 * ray.P.V, turn: 0, xi: 0, flinch: 0, rest: 0, somer: -1, lead: null, entering: false, leaving: false });
    const it = gym.rollout(F, ray, th, 1000 + sd, 480, 1 / 20, null, out); while (!it.next().done);
    eat += out[1]; cost += out[1] - out[0];
  }
  return [eat / seeds.length, cost / seeds.length];
}
const E = env.createEnv({ W: 16, H: 10, title: { l: .2, r: 4.2, t: 9.85, b: 7.1 }, tray: { l: 3.45, r: 12.55, t: 2.05, b: .22 }, seed: eseed });
E.nextBloom = 0;
for (const [sp, n] of [['manta', 2], ['eagle', 3], ['sting', 2], ['moon', 3], ['nettle', 2]]) for (let i = 0; i < n; i++) env.addCreature(E, sp, null, null, { free: true, instant: true });
const tr = gym.createTrainer(E, { seed: eseed ^ 0x9e37, adapt }); let gens = 0, lastTap = 0; const rng = env.mulberry32(eseed + 5);
for (let s = 0; gens < 60; s++) {
  env.stepWorld(E, tr.thetas(), 1 / 30);
  if (tap && E.t - lastTap >= tap) { lastTap = E.t; const p = env.randomWater(E, 'moon', rng, .8); env.userBloom(E, p[0], p[1]); }
  if (s % 45 === 0) { tr.runGeneration(); gens++; }
}
const seeds = Array.from({ length: 60 }, (_, i) => i), res = {};
for (const sp of env.RAYS) {
  const [a, sa] = evalTheta(E, sp, new Float64Array(12), seeds), [b, sb] = evalTheta(E, sp, tr.S[sp].th, seeds);
  res[sp] = { ratio: +(b / Math.max(a, 1e-6)).toFixed(2), untrained: +a.toFixed(3), learned: +b.toFixed(3), costU: +sa.toFixed(3), costL: +sb.toFixed(3), w0: +tr.S[sp].th[0].toFixed(2), w2: +tr.S[sp].th[2].toFixed(2), sigma: +tr.S[sp].sig.toFixed(2) };
}
console.log(JSON.stringify({ eseed, tap, adapt, res }));
