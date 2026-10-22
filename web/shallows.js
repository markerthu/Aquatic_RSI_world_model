// shallows.js: the page. Builds the lagoon to fit the screen, runs the world at a fixed step, trains the
// rays in time slices, measures them against an untrained habit, and draws shadows, water and creatures.
import * as THREE from 'three';
import { createEnv, addCreature, removeCreature, count, stepWorld, stepRipples, packRipples, addDrop, addJet, userBloom, poke,
  setSea, buildSwim, forkEnv, makeRay, RAYS, SPECIES, depthAt } from './env.js';
import { createTrainer, rollout } from './gym.js';
import { createWater } from './water.js';
import { createCreatures } from './creatures.js';
import { createUI, SPECIES_ORDER } from './ui.js';

const TAU = Math.PI * 2, STEP = 1 / 60; // one world step per 60 Hz frame; ripples keep their 30 Hz cadence
const canvas = document.getElementById('lagoon');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fallback').style.display = 'flex';
  throw e;
}
renderer.autoClear = false;
renderer.info.autoReset = false;
const mobile = matchMedia('(max-width: 700px)').matches || matchMedia('(pointer: coarse)').matches;
let dpr = 1;

const SEA_LINE = { calm: 'calm water · midday', rain: 'rain · overcast', current: 'current · ebb tide', whirl: 'whirlpool · midday' };
const START = mobile ? { manta: 1, eagle: 2, sting: 1, moon: 2, nettle: 1 } : { manta: 2, eagle: 3, sting: 2, moon: 3, nettle: 2 };

let E, tr, water, creatures, cam, shadowRT, unit = 1;
const AB = {}, ABH = { manta: [], eagle: [], sting: [] }; // latest comparison, and its history
let sound = null, lastTouch = -1e9, touched = false;

function rectToWorld(el, W, H) {
  const r = el.getBoundingClientRect();
  return { l: r.left / unit, r: r.right / unit, t: H - r.top / unit, b: H - r.bottom / unit };
}
function build(keep) {
  dpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; // the box the canvas really fills
  unit = w >= 900 ? w / 16 : w / 7.4;
  const W = w / unit, H = h / unit;
  const title = rectToWorld(document.querySelector('.head'), W, H), tray = rectToWorld(document.querySelector('.bar'), W, H);
  const seed = keep ? keep.seed : (params.get('seed') ? +params.get('seed') : (Math.random() * 2 ** 31) | 0);
  E = createEnv({ W, H, portrait: h > w * 1.15, mobile, seed, title, tray });
  if (keep) { E.t = keep.t; if (keep.uiHidden) { E.uiHidden = true; buildSwim(E); } } // one timeline across rebuilds
  E.nextBloom = E.t + 3;
  if (keep) setSea(E, keep.sea);
  const counts = keep ? keep.counts : START;
  for (const sp of SPECIES_ORDER) for (let i = 0; i < counts[sp]; i++) addCreature(E, sp, null, null, { free: true, instant: !keep });
  const old = tr;
  tr = createTrainer(E, { seed: seed ^ 0x9e37, fast: params.has('fast'), recSp: 'all' }); // keep each generation's imagined swims
  if (old) { for (const sp of RAYS) Object.assign(tr.S[sp], old.S[sp]); tr.gen = old.gen; } // keep what the rays have learned
  renderer.setSize(w, h, false);
  cam = new THREE.OrthographicCamera(0, W, H, 0, -10, 10);
  if (shadowRT) shadowRT.dispose();
  shadowRT = new THREE.WebGLRenderTarget(Math.ceil(w * dpr / 4), Math.ceil(h * dpr / 4), { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
  if (water) water.dispose();
  water = createWater(E, renderer);
  if (creatures) creatures.dispose();
  creatures = createCreatures(E);
  abIt = null; // a comparison in progress belongs to the old lagoon
  ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); ovOn = true;
}
// The rays' imagined swims: each generation's practice rollouts in the copied lagoon, drawn faintly on the water.
const ov = document.createElement('canvas'); ov.id = 'imagine'; ov.setAttribute('aria-hidden', 'true');
canvas.after(ov); const octx = ov.getContext('2d');
let ovOn = false; const born = {};
let abIt = null, abLast = -1e9;
build(null);

// ---- live comparison: learned habit vs untrained habit, same water, same starts, same noise ----
function* abRun() {
  const F = forkEnv(E), food0 = Float32Array.from(F.food), t0 = F.t, th0 = new Float64Array(12), out = [0, 0];
  for (const sp of RAYS) {
    const mem = E.rays.filter(r => r.sp === sp && !r.leaving && !r.entering);
    if (!mem.length) continue;
    const th = Float64Array.from(tr.S[sp].th), ray = makeRay(F, sp, 0, 0, 0);
    let a = 0, b = 0; const N = 12;
    for (let i = 0; i < N; i++) {
      const m = mem[i % mem.length], hh = m.h + (i * 1.7) % TAU, seed = 7001 + i * 31;
      for (const which of [0, 1]) {
        F.food.set(food0); F.t = t0; for (let q = 0; q < F.nettles.length; q++) Object.assign(F.nettles[q], F.nettles0[q]);
        Object.assign(ray, { x: m.x, y: m.y, h: hh, v: .65 * ray.P.V, turn: 0, xi: 0, flinch: 0, rest: 0, somer: -1, lead: null, entering: false, leaving: false });
        const it = rollout(F, ray, which ? th : th0, seed, 360, 1 / 20, null, out);
        while (!it.next().done) yield;
        if (which) b += out[1]; else a += out[1];
      }
    }
    AB[sp] = { ratio: a > .05 ? b / a : NaN, n: N, t: E.t };
    if (a > .05) { ABH[sp].push([tr.gen, b / a]); if (ABH[sp].length > 40) ABH[sp].shift(); }
    yield;
  }
}
function abTick(budget) {
  if (!abIt) { if (tr.gen < 6 || E.t - abLast < 20) return; abIt = abRun(); abLast = E.t; }
  const t0 = performance.now();
  while (performance.now() - t0 < budget) { if (abIt.next().done) { abIt = null; break; } }
}

// ---- api for the UI and for tests ----
function counts() { const o = {}; for (const sp of SPECIES_ORDER) o[sp] = count(E, sp); return o; }
const LIMIT = { manta: 4, eagle: 6, sting: 4, moon: 7, nettle: 4 };
const api = {
  add(sp) { if (count(E, sp) >= LIMIT[sp]) { ui.toast(`That's plenty of ${ui.NAMES[sp][1]} for one lagoon.`); return; } addCreature(E, sp); settle(); },
  remove(sp) { if (count(E, sp) > 0) { removeCreature(E, sp); ui.toast(`One ${ui.NAMES[sp][0].toLowerCase()} swims away.`); settle(); } },
  setSea(s) { setSea(E, s); if (sound) sound.setRain(s === 'rain'); if (RAYS.some(sp => count(E, sp))) tr.mark(s); settle(); },
  // drag-and-drop from the toolbar: place one exactly where it is dropped, if that water suits the species
  dropCheck(sp, cx, cy) {
    const r = canvas.getBoundingClientRect(), x = (cx - r.left) / unit, y = E.H - (cy - r.top) / unit;
    const el = document.elementFromPoint(cx, cy);
    if (el && el !== canvas && !el.classList.contains('ghost')) return { ok: false, x, y, why: '' };
    const d = depthAt(E, x, y), P = SPECIES[sp];
    if (d < .3) return { ok: false, x, y, why: 'That is dry sand — drop it in the water.' };
    if (P.maxD && d > P.maxD) return { ok: false, x, y, why: `Too deep for a ${ui.NAMES[sp][0].toLowerCase()}: they keep to the sandy shallows.` };
    if (d < P.minD) return { ok: false, x, y, why: `Too shallow for ${sp === 'eagle' ? 'an' : 'a'} ${ui.NAMES[sp][0].toLowerCase()}: drop it in deeper water.` };
    return { ok: true, x, y };
  },
  canDrop(sp, cx, cy) { return api.dropCheck(sp, cx, cy).ok; },
  drop(sp, cx, cy) {
    const c = api.dropCheck(sp, cx, cy);
    if (!c.ok) { if (c.why) ui.toast(c.why); return; }
    if (count(E, sp) >= LIMIT[sp]) { ui.toast(`That's plenty of ${ui.NAMES[sp][1]} for one lagoon.`); return; }
    addCreature(E, sp, c.x, c.y); addDrop(E, c.x, c.y, 1.8, .03); settle();
  },
  startOver() { tr.startOver(); for (const k of Object.keys(AB)) delete AB[k]; for (const k in ABH) ABH[k].length = 0; abIt = null; abLast = E.t; },
  uiHidden(on) { E.uiHidden = on; buildSwim(E); for (const c of [...E.rays, ...E.jellies]) c.sg = E.SG[c.sp]; },
  touched() { if (!touched) { touched = true; ui.hideHint(); } lastTouch = performance.now(); },
  redraw() { dirty = 1; },
  togglePause() { paused = !paused; dirty = 1; ui.toast(paused ? 'Still. Learning waits until the lagoon moves again.' : 'Moving.'); },
  state() { return { t: E.t, gen: tr.gen, counts: counts(), sea: E.sea, seaLine: SEA_LINE[E.sea], thetas: tr.thetas(), ab: AB, abh: ABH, paused }; },
};
const ui = createUI(api);
api.toggleSound = (() => { let pending = null; return () => {
  if (sound) return sound.toggle();
  if (!pending) pending = import('./sound.js').then(m => { sound = m.createSound(); sound.setRain(E.rain); sound.toggle(); });
  return true;
}; })();

// ---- pointer: tap water for plankton, tap a creature to startle it, drag one to lead it, moving stirs the surface ----
let drag = null, dragId = null, dragFrom = null, lastMove = { x: 0, y: 0, t: 0 };
const toWorld = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / unit, E.H - (e.clientY - r.top) / unit]; };
canvas.addEventListener('pointerdown', e => {
  const [x, y] = toWorld(e); api.touched();
  if (drag) return; // one ray at a time
  const r = creatures.pick(x, y);
  if (r) { drag = r; dragId = e.pointerId; dragFrom = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} canvas.classList.add('grabbing'); return; }
  if (depthAt(E, x, y) < .3) { ui.toast('That is dry sand — tap the water.'); return; }
  if (userBloom(E, x, y)) { addDrop(E, x, y, 2.4, .05); dirty = 1; settle(); }
  else ui.toast('The plankton needs a moment to settle.');
});
canvas.addEventListener('pointermove', e => {
  if (drag && e.pointerId !== dragId) return;
  const [x, y] = toWorld(e), now = performance.now();
  if (drag) {
    if (drag.leaving || drag.gone || !(E.rays.includes(drag) || E.jellies.includes(drag))) { endDrag(); return; }
    if (!dragFrom.moved && Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 7) { dragFrom.moved = true; drag.lead = { x, y, speed: 1 }; }
    if (drag.lead) { drag.lead.x = x; drag.lead.y = y; }
    return;
  }
  const dx = x - lastMove.x, dy = y - lastMove.y, dtm = (now - lastMove.t) / 1000;
  if (dtm > .05 && !reduced) {
    const v = Math.hypot(dx, dy) / dtm;
    if (v > 1.2 && v < 40 && depthAt(E, x, y) > .2) { addDrop(E, x, y, 1.2, Math.min(.012, .0015 * v)); if (v > 6) addJet(E, x, y, dx / dtm * .15, dy / dtm * .15); }
    lastMove = { x, y, t: now };
  }
  canvas.classList.toggle('grab', !!creatures.pick(x, y));
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== dragId)) return;
  const r = drag; drag = null; dragId = null; canvas.classList.remove('grabbing');
  if (e && e.type === 'pointerup' && !dragFrom.moved) { // a tap: the creature reacts
    const [x, y] = toWorld(e); poke(E, r, x, y); ui.tag(ui.NAMES[r.sp][0], e.clientX, e.clientY);
  }
  if (paused) settle(); // a still lagoon shows the result at once
  r.lead = null;
}
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('lostpointercapture', endDrag);

// ---- resize: rebuild the lagoon to the new shape, keeping creatures, sea state, timeline and learning ----
let rz = 0;
const rebuild = () => { endDrag(); const keep = { seed: E.seed, sea: E.sea, counts: counts(), t: E.t, uiHidden: E.uiHidden }; build(keep); settle(); dirty = 1; };
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(rebuild, 300); });
(function watchDpr() { // zoom or a move to another monitor changes devicePixelRatio without a resize on some browsers
  const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  mq.addEventListener('change', () => { clearTimeout(rz); rz = setTimeout(rebuild, 300); watchDpr(); }, { once: true });
})();

function drawImagined() {
  if (!ui.imagining()) { if (ovOn) { octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height); ovOn = false; } return; }
  ovOn = true; octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, ov.width / dpr, ov.height / dpr);
  const now = performance.now();
  for (const sp of RAYS) {
    const st = tr.S[sp]; if (!st.tries || !st.rank || !count(E, sp)) continue;
    if (!born[sp] || born[sp].gen !== st.recGen) born[sp] = { gen: st.recGen, t: now };
    const fade = paused ? 1 : Math.max(0, 1 - (now - born[sp].t) / 3500), n = st.rank.length, pts = st.tries.length / (2 * n);
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => st.rank[a] - st.rank[b]); // best drawn last, on top
    for (const k of order) {
      const q = st.rank[k] + .5, o = k * pts * 2; // q: 0 = worst practice swim, 1 = best
      octx.beginPath();
      for (let i = 0; i < pts; i++) { const x = st.tries[o + 2 * i] * unit, y = (E.H - st.tries[o + 2 * i + 1]) * unit; i ? octx.lineTo(x, y) : octx.moveTo(x, y); }
      octx.strokeStyle = q > .5 ? `rgba(255,255,255,${(.14 + .6 * (q - .5) * 2) * fade})` : `rgba(245,200,181,${.16 * fade})`;
      octx.lineWidth = q > .95 ? 2.2 : 1.1; octx.stroke();
    }
  }
}

// ---- main loop ----
let last = performance.now(), acc = 0, due = 0, rafCount = 0, paused = reduced, noteI = 0, dirty = 1, stepN = 0;
function step(dt) { stepWorld(E, tr.thetas(), dt); if (dt > STEP * 1.5 || (++stepN & 1)) stepRipples(E); }
// While the lagoon is still, a change is stepped in silently (2.5 s of lagoon time) and drawn once, with no animation.
function settle() { if (!paused) return; for (let i = 0; i < 75; i++) step(1 / 30); E.events.length = 0; dirty = 1; }
if (reduced) { for (let i = 0; i < 120; i++) step(1 / 30); ui.toast('Motion is reduced, so the lagoon is still. Press Play to let it move.'); }
function frame(now) {
  requestAnimationFrame(frame);
  if (now < due - 1) return;                      // pace to about 60 fps on fast screens, full rate on 60-75 Hz
  due = Math.max(due + 1000 / 60, now);
  if (paused && !dirty) { last = now; ui.update(); return; } // a still lagoon is drawn only when something changes
  const snap = paused; dirty = 0;
  let dt = Math.min(.1, (now - last) / 1000); last = now; rafCount++;
  if (!paused) {
    acc += dt; let n = 0;
    while (acc >= STEP && n < 6) { step(STEP); acc -= STEP; n++; }
    if (n === 6) acc = 0;
    tr.tick(E.t, mobile ? 1.0 : 1.6);
    abTick(mobile ? .5 : .9);
  }
  for (const ev of E.events) if (sound) { if (ev.type === 'graze') sound.note(noteI++); else if (ev.type === 'poke') sound.creature(ev.c.sp); }
  E.events.length = 0;
  renderer.info.reset();
  packRipples(E);
  water.update(E.t, paused ? 0 : dt, snap);
  creatures.update(E.t);
  renderer.setRenderTarget(shadowRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(creatures.shadowScene, cam);
  renderer.setRenderTarget(null); renderer.clear(); water.render(shadowRT); renderer.render(creatures.scene, cam);
  drawImagined();
  ui.update();
  if (rafCount === 1) document.getElementById('fallback').style.display = 'none'; window.__shallowsReady = true;
}
requestAnimationFrame(frame);

// ---- hooks for tests and the curious ----
window.__shallows = {
  get E() { return E; }, get tr() { return tr; }, get rafCount() { return rafCount; }, renderer, api, AB,
  state: () => api.state(), report: () => tr.report(), setSea: s => api.setSea(s),
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, ...creatures.info() }),
};
