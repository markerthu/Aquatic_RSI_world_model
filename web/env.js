// env.js: the lagoon as numbers. No DOM and no THREE, so Node can import it.
// World units (u) are about a metre; x to the right, y up, origin at the bottom-left of the view.
import { features, policy } from './gym.js';

export const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
export const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(6.283185307179586 * r());
export const sstep = (a, b, x) => { x = (x - a) / (b - a); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const TAU = 6.283185307179586;
const hyp = (a, b) => Math.sqrt(a * a + b * b);

function hash2(ix, iy, s) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1274126177) | 0;
  h = Math.imul(h ^ h >>> 13, 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x, y, s = 1) {
  let v = 0, a = .5, f = 1;
  for (let i = 0; i < 4; i++) { v += a * vnoise(x * f, y * f, s + i * 17); f *= 2.03; a *= .5; }
  return v / .9375;
}
const hfrac = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

// Species constants. V max speed (u/s), W max turn (rad/s), d reach (u), k graze rate.
export const SPECIES = {
  manta: { kind: 'ray', V: .55, W: .6, d: .9, k: 1.0, minD: 1.4, maxD: 1e9, zr: [.5, 1.2], span: 1.5, chord: .8, flapT: 3.4, amp: .5, glide: [3, 6], tail: [.35, 5, .02, .006] },
  eagle: { kind: 'ray', V: .6, W: .9, d: .7, k: .8, minD: .9, maxD: 1e9, zr: [.8, 1.8], span: 1.1, chord: .62, flapT: 2.2, amp: .62, glide: [2, 4], tail: [1.7, 14, .016, .0025] },
  sting: { kind: 'ray', V: .4, W: 1.4, d: .5, k: 1.2, minD: .35, maxD: 2.4, bed: .08, span: .5, chord: .6, tail: [.55, 8, .03, .006] },
  moon: { kind: 'jelly', R: .27, minD: .6, zr: [.25, .9], period: [1.8, 2.2] },
  nettle: { kind: 'jelly', R: .24, minD: .9, zr: [.3, 1.0], period: [2.6, 3.0] },
};
export const RAYS = ['manta', 'eagle', 'sting'], JELLIES = ['moon', 'nettle'], ALL = RAYS.concat(JELLIES);

// ---------- layout: sand fitted to the title, then depth ----------
function sdEllipse(px, py, rx, ry) {
  const k0 = hyp(px / rx, py / ry), k1 = hyp(px / (rx * rx), py / (ry * ry));
  return k0 < 1e-6 ? -Math.min(rx, ry) : k0 * (k0 - 1) / k1;
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; }
function sdBox(px, py, R) {
  const dx = Math.abs(px - (R.l + R.r) / 2) - (R.r - R.l) / 2, dy = Math.abs(py - (R.t + R.b) / 2) - (R.t - R.b) / 2;
  return hyp(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
// Signed distance to the waterline in u (s < 0 on sand).
export function shoreS(E, x, y) {
  const W = E.W, H = E.H, R = E.title, warp = .30 * (fbm(x * .45 + 3.1, y * .45 + 7.7, 11) - .5);
  let s;
  if (!E.portrait) {
    const rx = 1.15 * (R.r + 1.1), ry = 1.25 * (H - R.b + 1.1);
    const s1 = sdEllipse(x + .6, y - H - .6, rx, ry);
    const a = -8 * Math.PI / 180, dx = x - .42 * W, dy = y - H - .25;
    const qx = dx * Math.cos(a) + dy * Math.sin(a), qy = -dx * Math.sin(a) + dy * Math.cos(a);
    s = smin(s1, sdEllipse(qx, qy, .2 * W, 1.0), .8) + warp;
  } else {
    const bandH = (H - R.b) + 1.25 + .6 * sstep(.55 * W, .95 * W, x);
    s = (H - y) - bandH + warp;
  }
  return smin(s, sdBox(x, y, R) - 1.3, .6);
}
function depthFrom(E, s, x, y) {
  if (s <= 0) return -.25 * sstep(0, 1.6, -s);
  const cg = Math.max(0, x - .45 * E.W) + Math.max(0, (E.H - y) - .45 * E.H);
  return 1.1 * sstep(0, 1.2, s) + 1.5 * sstep(.8, 4, s) + 3.2 * sstep(3, 11, s + .35 * cg)
    + .25 * (fbm(x * .3, y * .3, 5) - .5) * sstep(1, 3, s)
    + .9 * sstep(.62, 1, x / E.W) * sstep(.55, 1, 1 - y / E.H);
}

// Bilinear sample of a cell-centred grid; gx, gy are in cell coordinates.
function bil(a, nx, ny, gx, gy) {
  gx = gx < 0 ? 0 : gx > nx - 1.0001 ? nx - 1.0001 : gx;
  gy = gy < 0 ? 0 : gy > ny - 1.0001 ? ny - 1.0001 : gy;
  const ix = gx | 0, iy = gy | 0, tx = gx - ix, ty = gy - iy, i = iy * nx + ix;
  const a0 = a[i] + (a[i + 1] - a[i]) * tx, a1 = a[i + nx] + (a[i + nx + 1] - a[i + nx]) * tx;
  return a0 + (a1 - a0) * ty;
}
export const depthAt = (E, x, y) => bil(E.D, E.bnx, E.bny, x * E.bix - .5, y * E.biy - .5);
export const sAt = (E, g, x, y) => bil(g, E.bnx, E.bny, x * E.bix - .5, y * E.biy - .5);
export const foodAt = (E, x, y) => bil(E.food, E.fnx, E.fny, x * E.fix - .5, y * E.fiy - .5);
export const scentAt = (E, x, y) => bil(E.scent, E.fnx, E.fny, x * E.fix - .5, y * E.fiy - .5);

function chamfer(inside, nx, ny, cs, border) {
  const d = new Float32Array(nx * ny), a = cs, b = cs * Math.SQRT2;
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++)
    d[k] = inside[k] ? (border ? Math.min(i + .5, nx - i - .5, j + .5, ny - j - .5) * cs : 1e9) : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = d[k]; if (!v) continue;
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) { v = Math.min(v, d[k - nx] + a); if (i > 0) v = Math.min(v, d[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b); }
    d[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = d[k]; if (!v) continue;
    if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
    if (j < ny - 1) { v = Math.min(v, d[k + nx] + a); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b); if (i > 0) v = Math.min(v, d[k + nx - 1] + b); }
    d[k] = v;
  }
  return d;
}

// Swimmable signed distance per species: depth band, screen edge (rays), tray + 0.3 u while the UI shows.
export function buildSwim(E) {
  const nx = E.bnx, ny = E.bny, cs = E.W / nx, T = !E.uiHidden && E.tray;
  E.SG = {};
  for (const sp of ALL) {
    const P = SPECIES[sp], ins = new Uint8Array(nx * ny); let any = 0;
    for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
      const x = (i + .5) / E.bix, y = (j + .5) / E.biy, D = E.D[k];
      let ok = D >= P.minD && D <= (P.maxD || 1e9);
      if (ok && T && x > T.l - .3 && x < T.r + .3 && y > T.b - .3 && y < T.t + .3) ok = false;
      ins[k] = ok ? 1 : 0; any |= ins[k];
    }
    if (!any) for (let k = 0; k < nx * ny; k++) ins[k] = E.D[k] > .3 ? 1 : 0;
    const border = P.kind === 'ray', din = chamfer(ins, nx, ny, cs, border), dout = chamfer(ins.map(v => 1 - v), nx, ny, cs, false);
    const g = new Float32Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) g[k] = ins[k] ? din[k] : -dout[k];
    E.SG[sp] = g;
  }
}

export function createEnv(cfg) {
  const W = cfg.W, H = cfg.H;
  const E = {
    W, H, portrait: !!cfg.portrait, mobile: !!cfg.mobile, seed: cfg.seed >>> 0, title: cfg.title, tray: cfg.tray || null,
    uiHidden: false, rng: mulberry32((cfg.seed >>> 0) ^ 0x2545F491), t: 0, live: true, sea: 'calm', rain: false,
    curS: 0, curAng: E0ang(cfg), jets: [], whirl: { x: .62 * W, y: .42 * H, s: 0, on: false },
    rays: [], jellies: [], nettles: [], events: [], puffs: [], nextId: 1, nextBloom: 8, foodAcc: 0, scentAcc: 0,
    rainAcc: 0, liveWin: {}, lastUserBlooms: [], userBlooms: [],
  };
  for (const sp of RAYS) E.liveWin[sp] = { food: new Float64Array(60), rs: new Float64Array(60), sec: 0 };
  // bathymetry: 8 cells per u, one grid read by the shaders, the steering and the gym
  const bnx = E.bnx = Math.max(8, Math.ceil(W * 8)), bny = E.bny = Math.max(8, Math.ceil(H * 8));
  E.bix = bnx / W; E.biy = bny / H;
  E.D = new Float32Array(bnx * bny); E.Sd = new Float32Array(bnx * bny);
  for (let j = 0, k = 0; j < bny; j++) for (let i = 0; i < bnx; i++, k++) {
    const x = (i + .5) / E.bix, y = (j + .5) / E.biy, s = shoreS(E, x, y);
    E.Sd[k] = s; E.D[k] = depthFrom(E, s, x, y);
  }
  E.gDx = new Float32Array(bnx * bny); E.gDy = new Float32Array(bnx * bny);
  for (let j = 0; j < bny; j++) for (let i = 0; i < bnx; i++) {
    const k = j * bnx + i, a = E.D[j * bnx + Math.max(i - 1, 0)], b = E.D[j * bnx + Math.min(i + 1, bnx - 1)];
    const c = E.D[Math.max(j - 1, 0) * bnx + i], d = E.D[Math.min(j + 1, bny - 1) * bnx + i];
    const gx = b - a, gy = d - c, l = hyp(gx, gy) || 1;
    E.gDx[k] = gx / l; E.gDy[k] = gy / l;
  }
  buildSwim(E);
  // food and scent: cells of about 0.165 u
  const fnx = E.fnx = Math.max(8, Math.round(W / .165)), fny = E.fny = Math.max(8, Math.round(H / .165));
  E.fix = fnx / W; E.fiy = fny / H;
  const n = fnx * fny;
  E.food = new Float32Array(n); E.food2 = new Float32Array(n); E.scent = new Float32Array(n); E.blurTmp = new Float32Array(n);
  E.fmask = new Uint8Array(n);
  for (let j = 0, k = 0; j < fny; j++) for (let i = 0; i < fnx; i++, k++) E.fmask[k] = depthAt(E, (i + .5) / E.fix, (j + .5) / E.fiy) >= .3 ? 1 : 0;
  // ripples: cells of 0.085 u (x 1/0.6 on the medium tier)
  const rc = cfg.rippleCell || .085;
  E.rnx = Math.max(8, Math.round(W / rc)); E.rny = Math.max(8, Math.round(H / rc));
  E.rh = new Float32Array(E.rnx * E.rny); E.rhp = new Float32Array(E.rnx * E.rny); E.rpack = new Uint8Array(E.rnx * E.rny * 4);
  E.rdamp = .986;
  return E;
}
function E0ang(cfg) { return cfg.portrait ? -1.85 : -.4; }

// ---------- flow ----------
export function flowAt(E, x, y, t, out) {
  const a = .37 * x + .11 * t, b = .31 * y - .07 * t, c = .23 * x - .41 * y + .05 * t;
  let u = .05 * (-.31 * Math.sin(a) * Math.sin(b) - .246 * Math.cos(c));
  let v = -.05 * (.37 * Math.cos(a) * Math.cos(b) + .138 * Math.cos(c));
  if (E.curS > 0) {
    const ang = E.curAng + .7 * Math.sin(TAU * t / 90);
    let cu = Math.cos(ang) * .4 * E.curS, cv = Math.sin(ang) * .4 * E.curS;
    const D = depthAt(E, x, y);
    if (D < 1) {
      const gx = sAt(E, E.gDx, x, y), gy = sAt(E, E.gDy, x, y), al = cu * gx + cv * gy, k = D <= 0 ? 1 : 1 - D;
      cu -= al * gx * k; cv -= al * gy * k;
      if (D < .05) { const f = clamp(D / .05, 0, 1); cu *= f; cv *= f; }
    }
    u += cu; v += cv;
  }
  const J = E.jets;
  for (let i = 0; i < J.length; i++) {
    const j = J[i], dx = x - j.x, dy = y - j.y, d2 = dx * dx + dy * dy;
    if (d2 < 5) { const w = Math.exp(-d2 / 1.28 - (t - j.t0) / 4); u += j.vx * w; v += j.vy * w; }
  }
  const P = E.whirl;
  if (P.s > 0) {
    const dx = x - P.x, dy = y - P.y, r = Math.sqrt(dx * dx + dy * dy) + 1e-6, q = r / 2.2;
    const tg = .55 * Math.exp(-q * q) * P.s, iw = .06 * Math.exp(-(r / 3.5) * (r / 3.5)) * P.s;
    u += (-dy * tg - dx * iw) / r; v += (dx * tg - dy * iw) / r;
  }
  out[0] = u; out[1] = v;
}
export function addJet(E, x, y, vx, vy) {
  const sp = hyp(vx, vy), k = sp > 1.2 ? 1.2 / sp : 1;
  if (E.jets.length >= 8) E.jets.shift();
  E.jets.push({ x, y, vx: vx * k * .5, vy: vy * k * .5, t0: E.t });
}

// ---------- food and scent ----------
export function addFood(E, x, y, r, amp) {
  const fnx = E.fnx, fny = E.fny, cx = x * E.fix - .5, cy = y * E.fiy - .5, rr = 2.3 * r * E.fix;
  for (let j = Math.max(0, Math.floor(cy - rr)); j <= Math.min(fny - 1, Math.ceil(cy + rr)); j++)
    for (let i = Math.max(0, Math.floor(cx - rr)); i <= Math.min(fnx - 1, Math.ceil(cx + rr)); i++) {
      const k = j * fnx + i; if (!E.fmask[k]) continue;
      const dx = (i - cx) / E.fix, dy = (j - cy) / E.fiy, w = amp * Math.exp(-(dx * dx + dy * dy) / (r * r));
      E.food[k] = Math.min(1, E.food[k] + w);
    }
}
export function stepFood(E, dt) {
  const nx = E.fnx, ny = E.fny, f = E.food, g = E.food2, m = E.fmask, F = FV2;
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    if (!m[k]) { g[k] = 0; continue; }
    const x = (i + .5) / E.fix, y = (j + .5) / E.fiy;
    flowAt(E, x, y, E.t, F);
    g[k] = bil(f, nx, ny, i - F[0] * dt * E.fix, j - F[1] * dt * E.fiy);
  }
  const kd = .02 * dt * E.fix * E.fix, dec = Math.exp(-Math.LN2 / 60 * dt);
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    if (!m[k]) { f[k] = 0; continue; }
    const c = g[k], l = g[i > 0 ? k - 1 : k] + g[i < nx - 1 ? k + 1 : k] + g[j > 0 ? k - nx : k] + g[j < ny - 1 ? k + nx : k] - 4 * c;
    f[k] = Math.max(0, (c + kd * l) * dec);
  }
}
function boxPass(src, dst, nx, ny, r, horiz) {
  const n1 = horiz ? nx : ny, n2 = horiz ? ny : nx, s1 = horiz ? 1 : nx, s2 = horiz ? nx : 1, inv = 1 / (2 * r + 1);
  for (let b = 0; b < n2; b++) {
    const o = b * s2; let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[o + clamp(i, 0, n1 - 1) * s1];
    for (let i = 0; i < n1; i++) {
      dst[o + i * s1] = acc * inv;
      acc += src[o + Math.min(i + r + 1, n1 - 1) * s1] - src[o + Math.max(i - r, 0) * s1];
    }
  }
}
// Scent: the food field blurred with sigma about 0.8 u (two box passes each way).
export function blurScent(E) {
  const nx = E.fnx, ny = E.fny, rr = Math.max(2, Math.round(.9 * E.fix));
  boxPass(E.food, E.blurTmp, nx, ny, rr, true); boxPass(E.blurTmp, E.scent, nx, ny, rr, false);
  boxPass(E.scent, E.blurTmp, nx, ny, rr, true); boxPass(E.blurTmp, E.scent, nx, ny, rr, false);
}
function eatAt(E, x, y, f) {
  const i0 = Math.round(x * E.fix - .5), j0 = Math.round(y * E.fiy - .5), nx = E.fnx, ny = E.fny;
  for (let j = j0 - 1; j <= j0 + 1; j++) if (j >= 0 && j < ny) for (let i = i0 - 1; i <= i0 + 1; i++) if (i >= 0 && i < nx) E.food[j * nx + i] *= f;
}
export function randomWater(E, sp, rng, minS = .6, pred) {
  const g = E.SG[sp];
  for (let k = 0; k < 400; k++) {
    const x = rng() * E.W, y = rng() * E.H;
    if (sAt(E, g, x, y) > minS && (!pred || pred(x, y))) return [x, y];
  }
  for (let k = 0; k < 400; k++) { const x = rng() * E.W, y = rng() * E.H; if (sAt(E, g, x, y) > 0) return [x, y]; }
  return [E.W * .7, E.H * .4];
}
export function naturalBloom(E, rng, small) {
  const band = rng() < .4;
  const pt = randomWater(E, 'moon', rng, .8, (x, y) => {
    for (const r of E.rays) if (r.sp === 'manta' && (r.x - x) * (r.x - x) + (r.y - y) * (r.y - y) < 9) return false;
    if (band) { const D = depthAt(E, x, y); return D >= .5 && D <= 2.2; }
    return true;
  });
  let [x, y] = pt;
  if (E.curS > .5) { // upstream bias
    const a = E.curAng + .7 * Math.sin(TAU * E.t / 90), nx = x - Math.cos(a) * 2.5, ny = y - Math.sin(a) * 2.5;
    if (sAt(E, E.SG.moon, nx, ny) > .4) { x = nx; y = ny; }
  }
  addFood(E, x, y, small ? .7 : 1.0, small ? .45 : .7);
  return [x, y];
}

// ---------- ripples (CPU, uploaded as RGBA8) ----------
export function addDrop(E, x, y, rc, amp) {
  const nx = E.rnx, ny = E.rny, cx = x / E.W * nx - .5, cy = y / E.H * ny - .5, R = Math.ceil(rc * 2.5);
  for (let j = Math.max(1, Math.floor(cy) - R); j <= Math.min(ny - 2, Math.floor(cy) + R); j++)
    for (let i = Math.max(1, Math.floor(cx) - R); i <= Math.min(nx - 2, Math.floor(cx) + R); i++) {
      const d2 = (i - cx) * (i - cx) + (j - cy) * (j - cy); E.rh[j * nx + i] += amp * Math.exp(-d2 / (rc * rc));
    }
}
export function stepRipples(E) {
  const nx = E.rnx, ny = E.rny, h = E.rh, p = E.rhp, damp = E.rdamp;
  for (let j = 1; j < ny - 1; j++) {
    let k = j * nx + 1;
    for (let i = 1; i < nx - 1; i++, k++) p[k] = (2 * h[k] - p[k] + .25 * (h[k - 1] + h[k + 1] + h[k - nx] + h[k + nx] - 4 * h[k])) * damp;
  }
  E.rh = p; E.rhp = h;
}
export function packRipples(E) {
  const nx = E.rnx, ny = E.rny, h = E.rh, o = E.rpack;
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    const a = h[i > 0 ? k - 1 : k] - h[i < nx - 1 ? k + 1 : k], b = h[j > 0 ? k - nx : k] - h[j < ny - 1 ? k + nx : k];
    const q = k * 4;
    o[q] = clamp((.5 + a * 4) * 255, 0, 255); o[q + 1] = clamp((.5 + b * 4) * 255, 0, 255);
    o[q + 2] = clamp((.5 + h[k] * 6) * 255, 0, 255); o[q + 3] = 255;
  }
}

// ---------- creatures ----------
function chain(len, n, w0, w1) {
  return { n, seg: len / (n - 1), x: new Float32Array(n), y: new Float32Array(n), px: new Float32Array(n), py: new Float32Array(n), w0, w1 };
}
function placeChain(c, x, y, dx, dy) {
  for (let i = 0; i < c.n; i++) { c.x[i] = c.px[i] = x + dx * c.seg * i; c.y[i] = c.py[i] = y + dy * c.seg * i; }
}
// Verlet chain, follow-the-leader constraint; nodes relax toward the water's motion and sink along (sx, sy).
export function stepChain(c, ax, ay, fx, fy, sx, sy, drag, dt) {
  c.x[0] = ax; c.y[0] = ay; c.px[0] = ax; c.py[0] = ay;
  const kd = Math.min(1, drag * dt), fdx = fx * dt, fdy = fy * dt, gx = sx * dt * dt, gy = sy * dt * dt;
  for (let i = 1; i < c.n; i++) {
    let vx = c.x[i] - c.px[i], vy = c.y[i] - c.py[i];
    vx += (fdx - vx) * kd; vy += (fdy - vy) * kd;
    c.px[i] = c.x[i]; c.py[i] = c.y[i];
    c.x[i] += vx + gx; c.y[i] += vy + gy;
  }
  for (let i = 1; i < c.n; i++) {
    const dx = c.x[i] - c.x[i - 1], dy = c.y[i] - c.y[i - 1], l = Math.sqrt(dx * dx + dy * dy) || 1e-6, k = c.seg / l;
    c.x[i] = c.x[i - 1] + dx * k; c.y[i] = c.y[i - 1] + dy * k;
  }
}

export function makeRay(E, sp, x, y, h) {
  const P = SPECIES[sp], id = E.nextId++;
  const r = {
    sp, P, id, x, y, h, v: .65 * P.V, turn: 0, xi: 0, sg: E.SG[sp], z: P.bed ? 0 : (P.zr[0] + P.zr[1]) / 2, hb: .5,
    phase: hfrac(id, 1) * TAU, amp: P.amp || 0, mode: 0, phaseEnd: 0, glide: 0, nflap: 0, bank: 0, pitch: 0,
    somer: -1, lastSomer: -40, grazeT: 0, rest: 0, restCool: 4 + 6 * hfrac(id, 2), restTint: 0, flinch: 0, flinchDir: 1,
    c: 0, eat: 0, grazing: false, lead: null, ledPath: 0, fade: 0, entering: false, leaving: false, gone: false,
    speedMul: 1, path: new Float32Array(120), pathN: 0, pathI: 0, pathT: 0, mouthX: x, mouthY: y,
  };
  r.phaseEnd = r.phase + 3 * TAU;
  const T = P.tail; r.tail = chain(T[0], T[1], T[2], T[3]);
  placeChain(r.tail, x - Math.cos(h) * P.chord * .45, y - Math.sin(h) * P.chord * .45, -Math.cos(h), -Math.sin(h));
  return r;
}
export function makeJelly(E, sp, x, y) {
  const P = SPECIES[sp], id = E.nextId++, rn = hfrac(id, 3);
  const j = {
    sp, P, id, x, y, vx: 0, vy: 0, dir: hfrac(id, 4) * TAU, pc: hfrac(id, 5), period: P.period[0] + (P.period[1] - P.period[0]) * rn,
    z: P.zr[0] + (P.zr[1] - P.zr[0]) * hfrac(id, 6), hb: .5, sg: E.SG[sp], R: P.R, pulse: 0, rot: hfrac(id, 7) * TAU,
    variant: hfrac(id, 8) < .6 ? 0 : 1, tx: 0, ty: -1, lead: null, fade: 0, entering: false, leaving: false, gone: false,
    shallowT: 0, driftT: 0, strands: [],
  };
  if (sp === 'moon') for (let k = 0; k < 4; k++) j.strands.push(Object.assign(chain(.32, 6, .03, .012), { kind: 2, k }));
  else {
    for (let k = 0; k < 8; k++) j.strands.push(Object.assign(chain(1.5, 14, .016, .006), { kind: 0, k }));
    for (let k = 0; k < 4; k++) j.strands.push(Object.assign(chain(.9, 14, .05, .01), { kind: 1, k }));
  }
  for (const c of j.strands) placeChain(c, x, y, Math.cos(j.dir + Math.PI), Math.sin(j.dir + Math.PI));
  return j;
}

const FV = new Float64Array(2), FV2 = new Float64Array(2), PHI = new Float64Array(6), POL = new Float64Array(2);
export { PHI, FV as FLOW };

// One step for one ray. Shared by the live lagoon and the gym's rollouts. Returns the reward.
export function stepRay(r, th, E, dt, rng, phi = PHI) {
  const P = r.P, live = E.live;
  if (r.rest > 0) { // a stingray settled in the sand
    r.rest -= dt; r.v *= Math.exp(-dt / .3); r.eat = 0; r.c = foodAt(E, r.x, r.y);
    if (r.rest <= 0 || r.lead) { r.rest = 0; r.restCool = 8; liftOff(E, r); }
    return 0;
  }
  features(r, E, phi, rng); // also leaves the flow at (x, y) in FV
  policy(th, phi, P, POL);
  r.xi += -r.xi * dt / 1.2 + .45 * P.W * Math.sqrt(2 * dt / 1.2) * gauss(rng);
  let turn = POL[0] + r.xi, speed = POL[1];
  if (r.lead) {
    const dx = r.lead.x - r.x, dy = r.lead.y - r.y, dist = hyp(dx, dy);
    let da = Math.atan2(dy, dx) - r.h; da -= TAU * Math.round(da / TAU);
    turn = clamp(da * 2.5, -P.W * 1.4, P.W * 1.4); speed = P.V * clamp(dist / 1.2, .3, 1) * (r.lead.speed || 1);
  } else if (r.entering && r.enterX != null) { // swim in from the edge instead of wandering off-screen
    let da = Math.atan2(r.enterY - r.y, r.enterX - r.x) - r.h; da -= TAU * Math.round(da / TAU);
    turn = clamp(da * 2.5, -P.W * 1.4, P.W * 1.4); speed = P.V * .8;
  }
  if (r.somer >= 0) speed = P.V * .3;
  if (r.flinch > 0) { r.flinch -= dt; turn = r.flinchDir * P.W * 1.5; speed = Math.min(P.V * 1.3, POL[1] * 1.3 + .1); }
  const ch = Math.cos(r.h), shh = Math.sin(r.h), s0 = sAt(E, r.sg, r.x, r.y);
  if (!r.entering && !r.leaving) {
    const sa = sAt(E, r.sg, r.x + .6 * ch, r.y + .6 * shh);
    if (sa < .3) {
      const sl = sAt(E, r.sg, r.x + .6 * Math.cos(r.h + .8), r.y + .6 * Math.sin(r.h + .8));
      const sr = sAt(E, r.sg, r.x + .6 * Math.cos(r.h - .8), r.y + .6 * Math.sin(r.h - .8));
      turn += (sl >= sr ? 1 : -1) * P.W;
    }
  }
  turn = clamp(turn, -1.5 * P.W, 1.5 * P.W);
  r.turn += (turn - r.turn) * (1 - Math.exp(-dt / .3));
  r.v += (speed - r.v) * (1 - Math.exp(-dt / .6));
  r.h += r.turn * dt; if (r.h > Math.PI) r.h -= TAU; else if (r.h < -Math.PI) r.h += TAU;
  const fk = P.bed ? .3 : .7;
  r.x += (Math.cos(r.h) * r.v + fk * FV[0]) * dt; r.y += (Math.sin(r.h) * r.v + fk * FV[1]) * dt;
  if (!r.entering && !r.leaving) { // hard clamp to the swimmable region
    const s = sAt(E, r.sg, r.x, r.y);
    if (s < .02) {
      const e = .08, gx = sAt(E, r.sg, r.x + e, r.y) - sAt(E, r.sg, r.x - e, r.y), gy = sAt(E, r.sg, r.x, r.y + e) - sAt(E, r.sg, r.x, r.y - e);
      const l = hyp(gx, gy) || 1; r.x += gx / l * (.02 - s); r.y += gy / l * (.02 - s);
    }
  }
  // eating
  const mx = r.x + .3 * P.d * Math.cos(r.h), my = r.y + .3 * P.d * Math.sin(r.h);
  r.mouthX = mx; r.mouthY = my;
  const c = foodAt(E, mx, my), eat = P.k * c * dt;
  eatAt(E, mx, my, 1 - .6 * P.k * dt);
  r.eat = eat; r.c = c;
  // stings: within 0.55 u of a point 0.25 u behind a nettle's bell
  let stung = 0;
  const N = E.nettles;
  for (let i = 0; i < N.length; i++) {
    const n = N[i], dx = r.x - (n.x + n.tx * .25), dy = r.y - (n.y + n.ty * .25);
    if (dx * dx + dy * dy < .3025) {
      stung = 1;
      if (r.flinch <= 0) { r.flinch = 1; r.flinchDir = (dy * Math.cos(r.h) - dx * Math.sin(r.h)) > 0 ? 1 : -1; if (live) E.events.push({ type: 'sting', r }); }
    }
  }
  const vv = r.v / P.V;
  return eat - 2 * stung * dt - .15 * vv * vv * dt - (s0 < .15 ? dt : 0);
}
// A touch: a ray startles and darts away from the finger (a resting stingray lifts off the sand);
// a jelly contracts at once and jets away. Live lagoon only.
export function poke(E, c, x, y) {
  const away = Math.atan2(c.y - y, c.x - x);
  if (c.P.kind === 'ray') {
    if (c.rest > 0) { c.rest = 0; c.restCool = 8; liftOff(E, c); }
    let da = away - c.h; da -= TAU * Math.round(da / TAU);
    c.flinch = .7; c.flinchDir = da >= 0 ? 1 : -1; c.v = Math.min(c.P.V * 1.6, c.v + .5 * c.P.V);
  } else {
    c.dir = away; c.pc = 0; c.vx += Math.cos(away) * .32; c.vy += Math.sin(away) * .32;
  }
  addDrop(E, x, y, 1.6, .03);
  E.events.push({ type: 'poke', c });
}
function liftOff(E, r) { addPuff(E, r.x, r.y); addDrop(E, r.x, r.y, 1.5, .006); E.events.push({ type: 'lift', r }); }
export function addPuff(E, x, y) { if (E.puffs.length >= 6) E.puffs.shift(); E.puffs.push({ x, y, age: 0 }); }

// Visual and live-only state for a ray: flaps, glides, depth, rest, somersault, tail.
function animRay(E, r, dt) {
  const P = r.P;
  r.fade = Math.min(1, r.fade + dt / 1.2);
  const D = Math.max(depthAt(E, r.x, r.y), 0);
  if (P.bed) { r.z = Math.max(D - P.bed, 0); r.hb = P.bed; }
  else {
    const zt = P.zr[0] + (P.zr[1] - P.zr[0]) * (.5 + .5 * Math.sin(.07 * E.t + r.id * 1.7));
    r.z += (Math.min(zt, D - .25) - r.z) * Math.min(1, dt * .5); r.hb = Math.max(D - r.z, .15);
  }
  if (P.amp) {
    const vf = .75 + .5 * clamp(r.v / P.V, 0, 1.3);
    if (r.mode === 0) { r.phase += TAU / P.flapT * vf * dt; if (r.phase >= r.phaseEnd) { r.mode = 1; r.nflap++; r.glide = P.glide[0] + (P.glide[1] - P.glide[0]) * hfrac(r.id, r.nflap); } }
    else { r.glide -= dt; if (r.v > P.V * .95 && r.glide > 1) r.glide = 1; if (r.glide <= 0) { r.mode = 0; r.phase = Math.ceil(r.phase / TAU) * TAU; r.phaseEnd = r.phase + 3 * TAU; } }
    const at = r.mode === 0 ? P.amp : 0;
    r.amp += (at - r.amp) * (1 - Math.exp(-dt / .45));
    if (r.mode === 1) r.phase += (Math.round(r.phase / TAU) * TAU + Math.PI * .5 - r.phase) * Math.min(1, dt * .6) * 0;
  } else r.phase += dt * TAU / .9;
  r.bank += (clamp(-r.turn / P.W * .35, -.45, .45) - r.bank) * Math.min(1, dt * 2);
  // manta somersault: after 3 s grazing in a bloom, at most once per 40 s
  if (r.sp === 'manta') {
    if (r.somer >= 0) {
      r.somer += dt / 3.2; r.pitch = TAU * sstep(0, 1, r.somer);
      if (r.somer >= 1) { r.somer = -1; r.pitch = 0; r.lastSomer = E.t; r.grazeT = 0; E.events.push({ type: 'somer', r }); }
    } else {
      r.grazeT = r.c > .2 ? r.grazeT + dt : Math.max(0, r.grazeT - dt * 2);
      if (r.grazeT >= 3 && E.t - r.lastSomer >= 40 && !r.lead && !r.leaving) r.somer = 0;
    }
  }
  // stingray rest: 6–14 s, only outside food
  if (P.bed) {
    r.restCool -= dt;
    if (r.rest > 0) r.restTint = Math.min(1, r.restTint + dt / 1.5);
    else {
      r.restTint = Math.max(0, r.restTint - dt / 1.5);
      if (r.restCool <= 0 && r.c < .05 && !r.lead && !r.entering && !r.leaving && E.rng() < dt / 9) {
        r.rest = 6 + 8 * E.rng(); addPuff(E, r.x, r.y); E.events.push({ type: 'rest', r });
      }
    }
  }
  // graze onset (for sound and notes)
  const g = r.c > .25;
  if (g && !r.grazing) E.events.push({ type: 'graze', r });
  r.grazing = g;
  // tail
  const fl = FV2, back = P.chord * (P.bed ? .42 : .4);
  flowAt(E, r.x, r.y, E.t, fl);
  stepChain(r.tail, r.x - Math.cos(r.h) * back * Math.cos(r.pitch), r.y - Math.sin(r.h) * back * Math.cos(r.pitch), fl[0], fl[1], 0, 0, 1.2, dt);
  { // bending stiffness: a tail trails behind the body instead of coiling (visual only)
    const c = r.tail, k = Math.min(1, dt * 1.1), bx = -Math.cos(r.h), by = -Math.sin(r.h);
    for (let i = 1; i < c.n; i++) {
      const tx = c.x[0] + bx * c.seg * i, ty = c.y[0] + by * c.seg * i, w = k * (.2 + .5 * i / c.n);
      c.x[i] += (tx - c.x[i]) * w; c.y[i] += (ty - c.y[i]) * w;
    }
    for (let i = 1; i < c.n; i++) {
      const dx = c.x[i] - c.x[i - 1], dy = c.y[i] - c.y[i - 1], l = Math.sqrt(dx * dx + dy * dy) || 1e-6, q = c.seg / l;
      c.x[i] = c.x[i - 1] + dx * q; c.y[i] = c.y[i - 1] + dy * q;
    }
  }
  // path for "show paths" (10 s at 6 Hz)
  r.pathT += dt;
  if (r.pathT >= 1 / 6) { r.pathT = 0; r.path[r.pathI * 2] = r.x; r.path[r.pathI * 2 + 1] = r.y; r.pathI = (r.pathI + 1) % 60; r.pathN = Math.min(60, r.pathN + 1); }
}

function stepJelly(E, j, dt) {
  const P = j.P, f = FV2;
  j.fade = Math.min(1, j.fade + dt / 1.2);
  const u0 = j.pc; j.pc += dt / j.period;
  if (j.pc >= 1) { j.pc -= 1; j.vx += Math.cos(j.dir) * .11; j.vy += Math.sin(j.dir) * .11; }
  const u = j.pc; j.pulse = u < .3 ? Math.sin(u / .3 * Math.PI / 2) : Math.exp(-4 * (u - .3));
  j.dir += (hfrac(j.id, Math.floor(E.t * 2)) - .5) * dt * 1.2;
  const dk = Math.exp(-.6 * dt); j.vx *= dk; j.vy *= dk;
  flowAt(E, j.x, j.y, E.t, f);
  if (!j.entering && !j.leaving) {
    const s = sAt(E, j.sg, j.x, j.y);
    if (s < .6) {
      const e = .1, gx = sAt(E, j.sg, j.x + e, j.y) - sAt(E, j.sg, j.x - e, j.y), gy = sAt(E, j.sg, j.x, j.y + e) - sAt(E, j.sg, j.x, j.y - e);
      const l = hyp(gx, gy) || 1, push = (.6 - s) * .5;
      j.vx += gx / l * push * dt; j.vy += gy / l * push * dt;
      let da = Math.atan2(gy, gx) - j.dir; da -= TAU * Math.round(da / TAU); j.dir += da * Math.min(1, dt);
      // the current would push it ashore: cancel the onshore part of the flow
      const on = f[0] * gx / l + f[1] * gy / l; if (on < 0) { const k = clamp((.6 - s) / .6, 0, 1); f[0] -= on * gx / l * k; f[1] -= on * gy / l * k; }
    }
  }
  if (j.lead) {
    const dx = j.lead.x - j.x, dy = j.lead.y - j.y, d = hyp(dx, dy) || 1, sp = Math.min(.3, d * .8);
    j.x += dx / d * sp * dt; j.y += dy / d * sp * dt; j.dir = Math.atan2(dy, dx);
  }
  j.x += (j.vx + f[0]) * dt; j.y += (j.vy + f[1]) * dt;
  if (!j.entering && !j.leaving) {
    const s = sAt(E, j.sg, j.x, j.y);
    if (s < 0) { const e = .1, gx = sAt(E, j.sg, j.x + e, j.y) - sAt(E, j.sg, j.x - e, j.y), gy = sAt(E, j.sg, j.x, j.y + e) - sAt(E, j.sg, j.x, j.y - e), l = hyp(gx, gy) || 1; j.x -= gx / l * s; j.y -= gy / l * s; }
    // drifting off an edge: come back in on the far side
    const m = .9;
    if (j.x < -m || j.x > E.W + m || j.y < -m || j.y > E.H + m) {
      const nx = j.x < -m ? E.W + m * .8 : j.x > E.W + m ? -m * .8 : j.x, ny = j.y < -m ? E.H + m * .8 : j.y > E.H + m ? -m * .8 : j.y;
      const cx = clamp(nx, .5, E.W - .5), cy = clamp(ny, .5, E.H - .5);
      if (sAt(E, j.sg, cx, cy) > .3) { j.x = nx; j.y = ny; for (const c of j.strands) placeChain(c, nx, ny, -Math.cos(j.dir), -Math.sin(j.dir)); }
      else { const p = randomWater(E, j.sp, E.rng, .8); j.x = p[0]; j.y = p[1]; j.fade = 0; for (const c of j.strands) placeChain(c, j.x, j.y, 0, -1); }
    }
  }
  const D = Math.max(depthAt(E, j.x, j.y), 0);
  const zt = P.zr[0] + (P.zr[1] - P.zr[0]) * (.5 + .5 * Math.sin(.05 * E.t + j.id * 2.3));
  j.z += (Math.min(zt, D - .2) - j.z) * Math.min(1, dt * .4); j.z = Math.max(j.z, .1); j.hb = Math.max(D - j.z, .1);
  // strands trail away from the bell's motion through the water
  const rvx = j.vx, rvy = j.vy, rl = hyp(rvx, rvy);
  let tx = rl > .01 ? -rvx / rl : -Math.cos(j.dir), ty = rl > .01 ? -rvy / rl : -Math.sin(j.dir);
  j.tx += (tx - j.tx) * Math.min(1, dt * 1.5); j.ty += (ty - j.ty) * Math.min(1, dt * 1.5);
  const tl = hyp(j.tx, j.ty) || 1; j.tx /= tl; j.ty /= tl;
  const rad = j.R * (1 - .14 * j.pulse), sink = .6;
  for (const c of j.strands) {
    let ax = j.x, ay = j.y;
    if (c.kind === 0) { const a = j.rot + c.k * TAU / 8; ax += Math.cos(a) * rad * .92; ay += Math.sin(a) * rad * .92; }
    else { const a = j.rot + (c.k + .5) * TAU / 4; ax += Math.cos(a) * rad * .12; ay += Math.sin(a) * rad * .12; }
    stepChain(c, ax, ay, f[0] + j.vx * .2, f[1] + j.vy * .2, j.tx * sink * (c.kind === 0 ? 1 : .8), j.ty * sink * (c.kind === 0 ? 1 : .8), 2.2, dt);
  }
  if (j.sp === 'moon') { // note 3: shadow over shallows; note 4: drifting in current or whirlpool
    j.shallowT = D < 1.6 ? j.shallowT + dt : 0;
    const wp = E.whirl.s > .5 && hyp(j.x - E.whirl.x, j.y - E.whirl.y) < 2.4;
    j.driftT = (E.curS > .5 || wp) ? j.driftT + dt : 0;
  } else j.driftT = (E.curS > .5 || (E.whirl.s > .5 && hyp(j.x - E.whirl.x, j.y - E.whirl.y) < 2.4)) ? j.driftT + dt : 0;
}

export function updateNettles(E) {
  let k = 0;
  for (const j of E.jellies) if (j.sp === 'nettle' && !j.gone) {
    const n = E.nettles[k] || (E.nettles[k] = {});
    n.x = j.x; n.y = j.y; n.tx = j.tx; n.ty = j.ty; n.vx = j.vx; n.vy = j.vy; k++;
  }
  E.nettles.length = k;
}

// Entering from or leaving to the nearest off-screen deep-water edge.
export function edgeEntry(E, sp, rng, nearX, nearY) {
  const g = E.SG[sp]; let best = null, bd = 1e9;
  for (let k = 0; k < 48; k++) {
    const side = k % 4, t = (k >> 2) / 12 + rng() * .08;
    const x = side === 0 ? .4 : side === 1 ? E.W - .4 : t * E.W, y = side === 2 ? .4 : side === 3 ? E.H - .4 : t * E.H;
    if (sAt(E, g, clamp(x, .3, E.W - .3), clamp(y, .3, E.H - .3)) < .25) continue;
    const d = nearX == null ? depthAt(E, x, y) * -1 + rng() : hyp(x - nearX, y - nearY);
    if (d < bd) { bd = d; best = [x, y, side]; }
  }
  if (!best) { const p = randomWater(E, sp, rng); return [p[0], p[1], 0, 0, 0]; }
  const [x, y, side] = best, ox = side === 0 ? -1 : side === 1 ? 1 : 0, oy = side === 2 ? -1 : side === 3 ? 1 : 0;
  return [x + ox * 1.2, y + oy * 1.2, -ox, -oy, 1];
}
export function addCreature(E, sp, x, y, opt = {}) {
  const P = SPECIES[sp], rng = E.rng; let h = rng() * TAU, entering = false;
  if (x == null) {
    if (opt.free) { const p = randomWater(E, sp, rng, .9); x = p[0]; y = p[1]; }
    else { var e = edgeEntry(E, sp, rng); x = e[0]; y = e[1]; if (e[4]) { h = Math.atan2(e[3], e[2]); entering = true; } }
  }
  const c = P.kind === 'ray' ? makeRay(E, sp, x, y, h) : makeJelly(E, sp, x, y);
  c.entering = entering; if (opt.instant) c.fade = 1;
  if (entering) { c.enterX = e[0] + e[2] * 2.7; c.enterY = e[1] + e[3] * 2.7; c.enterT = 0; } // aim 1.5 u inside the edge
  if (entering && P.kind === 'jelly') { c.vx = Math.cos(h) * .25; c.vy = Math.sin(h) * .25; c.dir = h; }
  (P.kind === 'ray' ? E.rays : E.jellies).push(c);
  return c;
}
export function removeCreature(E, sp) {
  const list = SPECIES[sp].kind === 'ray' ? E.rays : E.jellies;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].sp === sp && !list[i].leaving) { list[i].leaving = true; list[i].lead = null; return list[i]; }
  return null;
}
export const count = (E, sp) => (SPECIES[sp].kind === 'ray' ? E.rays : E.jellies).reduce((n, c) => n + (c.sp === sp && !c.leaving ? 1 : 0), 0);

function steerOut(E, c, dt, isRay) { // leaving: head for the nearest edge and despawn off-screen
  const dl = c.x, dr = E.W - c.x, db = c.y, dtp = E.H - c.y, m = Math.min(dl, dr, db, dtp);
  const tx = m === dl ? -1 : m === dr ? 1 : 0, ty = m === db ? -1 : m === dtp ? 1 : 0;
  if (isRay) c.lead = { x: c.x + tx * 3, y: c.y + ty * 3, speed: 1 };
  else { c.vx += tx * .3 * dt; c.vy += ty * .3 * dt; }
  if (c.x < -1.6 || c.x > E.W + 1.6 || c.y < -1.6 || c.y > E.H + 1.6) c.gone = true;
}

// The live lagoon, one step.
export function stepWorld(E, thetas, dt, rng = E.rng) {
  E.t += dt;
  const t = E.t;
  E.curS = clamp(E.curS + (E.sea === 'current' ? dt : -dt) / 3, 0, 1);
  E.whirl.s = clamp(E.whirl.s + (E.sea === 'whirl' ? dt : -dt) / 3, 0, 1);
  while (E.jets.length && t - E.jets[0].t0 > 16) E.jets.shift();
  if (t >= E.nextBloom) { E.lastNatural = naturalBloom(E, rng, E.rain); E.nextBloom = t + (E.rain ? 2 : 8); }
  E.foodAcc += dt;
  for (let n = 0; E.foodAcc >= 1 / 30 && n < 2; n++) { stepFood(E, 1 / 30); E.foodAcc -= 1 / 30; }
  if (E.foodAcc > 1 / 30) E.foodAcc = 0;
  E.scentAcc += dt; if (E.scentAcc >= .25) { blurScent(E); E.scentAcc = 0; }
  updateNettles(E);
  const sec = Math.floor(t);
  for (const sp of RAYS) { const w = E.liveWin[sp]; if (sec !== w.sec) { for (let s = w.sec + 1; s <= sec && s <= w.sec + 60; s++) { w.food[s % 60] = 0; w.rs[s % 60] = 0; } w.sec = sec; } }
  for (const r of E.rays) {
    if (r.leaving) steerOut(E, r, dt, true);
    if (r.entering) {
      r.enterT = (r.enterT || 0) + dt;
      if (sAt(E, r.sg, r.x, r.y) > .25 || (r.enterX != null && hyp(r.x - r.enterX, r.y - r.enterY) < .3)) r.entering = false;
      else if (r.enterT > 8) { // failsafe: reappear in open water
        const p = randomWater(E, r.sp, rng, .9); r.x = p[0]; r.y = p[1]; r.fade = 0; r.entering = false;
        placeChain(r.tail, r.x - Math.cos(r.h) * r.P.chord * .45, r.y - Math.sin(r.h) * r.P.chord * .45, -Math.cos(r.h), -Math.sin(r.h));
      }
    }
    const lx = r.x, ly = r.y;
    stepRay(r, thetas[r.sp], E, dt, rng);
    if (r.lead && !r.leaving) r.ledPath += hyp(r.x - lx, r.y - ly); else if (!r.lead) r.ledPath = 0;
    animRay(E, r, dt);
    if (!r.entering && !r.leaving) { const w = E.liveWin[r.sp]; w.food[sec % 60] += r.eat; w.rs[sec % 60] += dt; }
  }
  // live-only: keep at least 0.8 body length apart
  const R = E.rays;
  for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) {
    const A = R[a], B = R[b], dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy, m = .8 * Math.max(A.P.chord, B.P.chord, A.P.span * .7, B.P.span * .7);
    if (d2 < m * m && d2 > 1e-8 && Math.abs(A.z - B.z) < .6) {
      const d = Math.sqrt(d2), p = (m - d) * .5 * Math.min(1, dt * 3);
      if (!A.lead) { A.x -= dx / d * p; A.y -= dy / d * p; } if (!B.lead) { B.x += dx / d * p; B.y += dy / d * p; }
    }
  }
  for (const j of E.jellies) { if (j.leaving) steerOut(E, j, dt, false); if (j.entering && sAt(E, j.sg, j.x, j.y) > .5) j.entering = false; stepJelly(E, j, dt); }
  for (let i = E.rays.length - 1; i >= 0; i--) if (E.rays[i].gone) E.rays.splice(i, 1);
  for (let i = E.jellies.length - 1; i >= 0; i--) if (E.jellies[i].gone) E.jellies.splice(i, 1);
  for (let i = E.puffs.length - 1; i >= 0; i--) if ((E.puffs[i].age += dt) > 2.5) E.puffs.splice(i, 1);
  if (E.rain) { // rain drops into the ripple field: about 25 drops/s per 100 u²
    E.rainAcc += dt * .25 * E.W * E.H;
    while (E.rainAcc >= 1) { E.rainAcc -= 1; addDrop(E, rng() * E.W, rng() * E.H, 1.5, .008 + .012 * rng()); }
  }
}
// In the water now: plankton per minute per ray over the last 60 s.
export function liveRate(E, sp) {
  const w = E.liveWin[sp]; let f = 0, s = 0;
  for (let i = 0; i < 60; i++) if (i !== w.sec % 60) { f += w.food[i]; s += w.rs[i]; }
  return s > 5 ? f / s * 60 : 0;
}
export function setSea(E, sea) {
  E.sea = sea; E.rain = sea === 'rain';
  E.rdamp = sea === 'calm' ? .986 : sea === 'rain' ? .982 : .984;
  if (sea === 'whirl') E.whirl.on = true;
  if (E.rain) E.nextBloom = Math.min(E.nextBloom, E.t + 2);
}
export function userBloom(E, x, y) { // at most one per 0.6 s and six per 5 s
  const t = E.t, U = E.userBlooms;
  while (U.length && t - U[0] > 5) U.shift();
  if (U.length >= 6 || (U.length && t - U[U.length - 1] < .6)) return false;
  if (depthAt(E, x, y) < .3) return false;
  U.push(t); addFood(E, x, y, .8, .9); E.lastTap = { x, y, t };
  return true;
}

// A compact, serialisable view of the lagoon.
export function snapshot(E) {
  return {
    t: E.t, sea: E.sea, rain: E.rain, curS: E.curS, whirl: { ...E.whirl }, jets: E.jets.map(j => ({ ...j })),
    rays: E.rays.map(r => ({ sp: r.sp, x: r.x, y: r.y, h: r.h, v: r.v, rest: r.rest > 0, c: r.c })),
    jellies: E.jellies.map(j => ({ sp: j.sp, x: j.x, y: j.y })), food: Float32Array.from(E.food),
  };
}
// A rollout copy of the lagoon: static grids shared, dynamic state copied (the gym's "copy of the lagoon as it is now").
export function forkEnv(E) {
  const F = Object.assign({}, E);
  F.live = false; F.events = []; F.puffs = []; F.rays = []; F.jellies = [];
  F.food = Float32Array.from(E.food); F.scent = Float32Array.from(E.scent);
  F.jets = E.jets.map(j => ({ ...j })); F.whirl = { ...E.whirl };
  F.nettles = E.nettles.map(n => ({ ...n })); F.nettles0 = F.nettles.map(n => ({ ...n }));
  return F;
}
