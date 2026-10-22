// gym.js: how the rays learn. Evolution strategies on one shared 12-number habit per ray species.
// No DOM and no THREE; Node imports it for the acceptance test.
import { SPECIES, RAYS, FLOW, flowAt, sAt, scentAt, foodAt, stepRay, mulberry32, gauss, clamp, forkEnv, createEnv, addFood, blurScent, makeRay, randomWater } from './env.js';

const TAU = 6.283185307179586;

// Observation phi (6 numbers, egocentric; counter-clockwise is positive).
export function features(r, E, phi, rng) {
  const P = r.P, d = P.d, h = r.h, ch = Math.cos(h), sh = Math.sin(h);
  const cl = Math.cos(h + .6), sl = Math.sin(h + .6), cr = Math.cos(h - .6), sr = Math.sin(h - .6);
  const xl = r.x + d * cl, yl = r.y + d * sl, xr = r.x + d * cr, yr = r.y + d * sr;
  const a = scentAt(E, xl, yl), b = scentAt(E, xr, yr);
  let f1 = (a - b) / (a + b + .05);
  if (E.rain) f1 += .25 * gauss(rng);
  phi[0] = f1;
  phi[1] = Math.tanh(3 * foodAt(E, r.x + .3 * d * ch, r.y + .3 * d * sh));
  let f3 = 0;
  const N = E.nettles;
  for (let i = 0; i < N.length; i++) {
    const dx = N[i].x - r.x, dy = N[i].y - r.y, d2 = dx * dx + dy * dy;
    if (d2 < 16 && d2 > 1e-9) f3 += Math.exp(-d2 / 1.62) * (dy * ch - dx * sh) / Math.sqrt(d2);
  }
  phi[2] = clamp(f3, -1, 1);
  flowAt(E, r.x, r.y, E.t, FLOW);
  phi[3] = clamp((-FLOW[0] * sh + FLOW[1] * ch) / .4, -1, 1);
  phi[4] = clamp((sAt(E, r.sg, xl, yl) - sAt(E, r.sg, xr, yr)) / d, -1, 1);
  phi[5] = 1;
}

// theta = (w in R^6, b in R^6): turn = W tanh(w.phi), speed = V (0.3 + 0.7 sigmoid(b.phi)).
export function policy(th, phi, P, out) {
  let a = 0, b = 0;
  for (let k = 0; k < 6; k++) { a += th[k] * phi[k]; b += th[6 + k] * phi[k]; }
  out[0] = P.W * Math.tanh(a);
  out[1] = P.V * (.3 + .7 / (1 + Math.exp(-b)));
}

function resetTry(r, x, y, h) {
  r.x = x; r.y = y; r.h = h; r.v = .65 * r.P.V; r.turn = 0; r.xi = 0; r.flinch = 0; r.rest = 0; r.somer = -1;
  r.lead = null; r.entering = false; r.leaving = false; r.c = 0; r.eat = 0;
}
const NV = new Float64Array(2);
// One try: one ray alone in a copy of the lagoon. Yields every 40 steps so it can be time-sliced.
export function* rollout(F, r, th, seed, steps, dt, rec, out) {
  const rng = mulberry32(seed), t0 = F.t;
  let ret = 0, intake = 0;
  for (let k = 0; k < steps; k++) {
    F.t = t0 + k * dt;
    const N = F.nettles;
    for (let i = 0; i < N.length; i++) { flowAt(F, N[i].x, N[i].y, F.t, NV); N[i].x += (N[i].vx + NV[0]) * dt; N[i].y += (N[i].vy + NV[1]) * dt; }
    ret += stepRay(r, th, F, dt, rng);
    intake += r.eat;
    if (rec && (k & 3) === 0) { rec[(k >> 2) * 2] = r.x; rec[(k >> 2) * 2 + 1] = r.y; }
    if (k % 40 === 39) yield;
  }
  out[0] = ret; out[1] = intake;
}
function resetNettles(F) { for (let i = 0; i < F.nettles.length; i++) Object.assign(F.nettles[i], F.nettles0[i]); }

export function createTrainer(E, o = {}) {
  const NP = 8, T = 12, dt = 1 / 20, steps = 240;
  const rng = mulberry32(((o.seed ?? 1) ^ 0x51ED27) >>> 0);
  const S = {};
  const blank = () => ({ th: new Float64Array(12), m: new Float64Array(12), v: new Float64Array(12), at: 0, raw: [], ema: [], gens: [], tries: null, rank: null, paused: false });
  for (const sp of RAYS) S[sp] = blank();
  const now = () => (globalThis.performance ? performance.now() : Date.now());
  const tr = {
    gen: 0, S, ticks: [], paused: false, fast: !!o.fast, cadence: o.cadence ?? 1.5, budget: o.budget ?? 1.5,
    sigma: o.sigma ?? .3, alpha: o.alpha ?? .1, it: null, last: -1e9, recSp: o.recSp || null, lastGenMs: 0, busyMs: 0,
    // learn two habits: follow the scent (w0), steer clear of nettles (w2); measured to beat the untrained habit
    mask: o.mask === undefined ? [0, 2] : o.mask, np: o.np || NP,
  };
  const maskOf = sp => (tr.mask && !Array.isArray(tr.mask) ? tr.mask[sp] : tr.mask);
  function* generation() {
    const F = forkEnv(E), food0 = Float32Array.from(F.food), t0 = F.t, sig = tr.sigma;
    for (const sp of RAYS) {
      const st = S[sp], mem = E.rays.filter(r => r.sp === sp && !r.leaving && !r.entering);
      if (!mem.length) { st.paused = true; continue; }
      st.paused = false;
      const NPk = tr.np, mk = maskOf(sp), ray = makeRay(F, sp, 0, 0, 0), eps = [], R = new Float64Array(2 * NPk), I = new Float64Array(2 * NPk);
      const rec = (tr.recSp === sp || tr.recSp === 'all') ? new Float32Array(2 * NPk * 120) : null, thp = new Float64Array(12), out = [0, 0];
      for (let i = 0; i < NPk; i++) {
        const e = new Float64Array(12);
        for (let k = 0; k < 12; k++) e[k] = mk && !mk.includes(k) ? 0 : gauss(rng);
        eps.push(e);
        let sx, sy, sh;
        if (F.nettles0.length && rng() < .25) { // a quarter of tries start within 1.5 u of a nettle
          const n = F.nettles0[(rng() * F.nettles0.length) | 0], a = rng() * TAU, d = .4 + rng() * 1.1;
          sx = n.x + Math.cos(a) * d; sy = n.y + Math.sin(a) * d; sh = rng() * TAU;
        } else {
          const m = mem[(rng() * mem.length) | 0];
          sx = m.x + .3 * gauss(rng); sy = m.y + .3 * gauss(rng); sh = m.h + .4 * gauss(rng);
        }
        if (sAt(F, F.SG[sp], sx, sy) < .1) { const m = mem[(rng() * mem.length) | 0]; sx = m.x; sy = m.y; }
        const seed = (rng() * 4294967296) >>> 0;
        for (let s = 0; s < 2; s++) { // mirrored pair: same start, same noise seed
          for (let k = 0; k < 12; k++) thp[k] = st.th[k] + (s ? -sig : sig) * e[k];
          F.food.set(food0); resetNettles(F); F.t = t0; resetTry(ray, sx, sy, sh);
          yield* rollout(F, ray, thp, seed, steps, dt, rec && rec.subarray((2 * i + s) * 120, (2 * i + s + 1) * 120), out);
          R[2 * i + s] = out[0]; I[2 * i + s] = out[1];
        }
      }
      // centred ranks in [-0.5, 0.5]
      const idx = Array.from({ length: 2 * NPk }, (_, k) => k).sort((a, b) => R[a] - R[b]), u = new Float64Array(2 * NPk);
      idx.forEach((k, n) => { u[k] = n / (2 * NPk - 1) - .5; });
      const g = new Float64Array(12);
      for (let i = 0; i < NPk; i++) for (let k = 0; k < 12; k++) g[k] += (u[2 * i] - u[2 * i + 1]) * eps[i][k];
      st.at++;
      const b1 = .9, b2 = .999, c1 = 1 - Math.pow(b1, st.at), c2 = 1 - Math.pow(b2, st.at);
      for (let k = 0; k < 12; k++) {
        if (mk && !mk.includes(k)) continue;
        const gk = g[k] / (2 * NPk * sig);
        st.m[k] = b1 * st.m[k] + (1 - b1) * gk; st.v[k] = b2 * st.v[k] + (1 - b2) * gk * gk;
        st.th[k] += tr.alpha * (st.m[k] / c1) / (Math.sqrt(st.v[k] / c2) + 1e-8);
        st.th[k] = clamp(st.th[k] - .003 * st.th[k], -4, 4);
      }
      let mi = 0;
      for (let i = 0; i < 2 * NPk; i++) mi += I[i];
      const val = mi / (2 * NPk) / T * 60;
      st.raw.push(val); st.gens.push(tr.gen);
      st.ema.push(st.ema.length ? st.ema[st.ema.length - 1] + .25 * (val - st.ema[st.ema.length - 1]) : val);
      if (rec) { st.tries = rec; st.rank = u; st.recGen = tr.gen; } // the imagined swims of this generation, for drawing
      yield;
    }
    tr.gen++;
  }
  // Run the generator inside a millisecond budget. Returns true when a generation finished.
  tr.tick = (tsec, budget = tr.budget) => {
    if (tr.paused) return false;
    const t0 = now(); let done = false;
    while (true) {
      if (!tr.it) {
        if (done && !tr.fast) break;
        if (!tr.fast && tsec - tr.last < tr.cadence) break;
        tr.it = generation(); tr.last = tsec; tr.genStart = t0;
      }
      if (tr.it.next().done) { tr.it = null; done = true; tr.lastGenMs = now() - tr.genStart; if (!tr.fast) break; }
      if (now() - t0 >= budget) break;
    }
    tr.busyMs = now() - t0;
    return done;
  };
  tr.runGeneration = () => { const it = generation(); while (!it.next().done); };
  tr.thetas = () => { const o = {}; for (const sp of RAYS) o[sp] = S[sp].th; return o; };
  tr.habits = sp => { const t = S[sp].th; return [t[0], -t[7], -t[2], t[3], t[4]]; };
  tr.mark = kind => tr.ticks.push({ gen: tr.gen, kind });
  tr.pause = b => { tr.paused = !!b; };
  tr.startOver = () => { for (const sp of RAYS) S[sp] = blank(); tr.S = S; tr.gen = 0; tr.it = null; tr.ticks = [{ gen: 0, kind: 'over' }]; };
  tr.ratio = sp => {
    const a = S[sp].raw; if (a.length < 6) return 0;
    const m = (i, j) => { let s = 0; for (let k = i; k < j; k++) s += a[k]; return s / (j - i); };
    const base = m(0, 5), late = a.length >= 41 ? m(36, 41) : m(a.length - 5, a.length);
    return base > 1e-9 ? late / base : (late > 0 ? 99 : 0);
  };
  tr.report = () => {
    const ratio = {}, w1 = {}, n = {};
    for (const sp of RAYS) { ratio[sp] = +tr.ratio(sp).toFixed(3); w1[sp] = +S[sp].th[0].toFixed(3); n[sp] = S[sp].raw.length; }
    return { gen: tr.gen, ratio, w1, n };
  };
  return tr;
}

// The canonical parity world: the same numbers in Node and in the browser.
export function parityHash(n = 200) {
  const E = createEnv({ W: 16, H: 10, title: { l: .2, r: 4.2, t: 9.85, b: 7.1 }, tray: { l: 3.45, r: 12.55, t: 2.05, b: .22 }, seed: 7 });
  const rng = mulberry32(7);
  E.live = false;
  addFood(E, 9, 5, 1, .7); addFood(E, 12, 3.5, 1, .7); addFood(E, 6.5, 4, 1, .6); blurScent(E);
  const rays = [], th = new Float64Array(12);
  for (let k = 0; k < 12; k++) th[k] = .4 * Math.sin(k + 1);
  for (const sp of RAYS) for (let i = 0; i < 2; i++) { const p = randomWater(E, sp, rng, .6); rays.push(makeRay(E, sp, p[0], p[1], rng() * TAU)); }
  const buf = new Float64Array(1), u32 = new Uint32Array(buf.buffer);
  let h = 0x811c9dc5;
  const mix = v => { buf[0] = v; for (let q = 0; q < 2; q++) { h ^= u32[q]; h = Math.imul(h, 16777619); } };
  for (let s = 0; s < n; s++) {
    E.t = s / 20;
    for (const r of rays) { stepRay(r, th, E, 1 / 20, rng); mix(r.x); mix(r.y); mix(r.h); mix(r.v); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
