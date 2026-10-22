const R = new URL('../web/', import.meta.url).href;
const env = await import(R + 'env.js');
let stuck = 0, off = 0, tot = 0, tmax = 0;
for (const [W, H] of [[16, 9], [16, 10], [7.4, 16]]) for (let seed = 1; seed <= 12; seed++) {
  const E = env.createEnv({ W, H, seed, title: { l: .2, r: 4.2, t: H - .15, b: H - 2.9 }, tray: { l: W * .2, r: W * .8, t: 2.05, b: .22 } });
  for (const [sp, n] of [['manta', 2], ['eagle', 3], ['sting', 2], ['moon', 3], ['nettle', 2]]) for (let i = 0; i < n; i++) env.addCreature(E, sp, null, null, { free: true, instant: true });
  const th = { manta: new Float64Array(12), eagle: new Float64Array(12), sting: new Float64Array(12) };
  for (const sp of env.RAYS) {
    const r = env.addCreature(E, sp); tot++;
    let t = 0; for (; t < 60 && r.entering; t += 1 / 60) env.stepWorld(E, th, 1 / 60);
    tmax = Math.max(tmax, t);
    for (let k = 0; k < 600; k++) env.stepWorld(E, th, 1 / 60);
    if (r.entering) stuck++;
    if (r.x < -.5 || r.x > W + .5 || r.y < -.5 || r.y > H + .5) off++;
  }
}
console.log(JSON.stringify({ tot, stuck, offscreenAfter10s: off, slowestEntry_s: +tmax.toFixed(1) }));
