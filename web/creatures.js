// creatures.js: rays and jellies drawn from env.js state. Each creature has a visible mesh and a
// shadow twin that renders into a low-resolution buffer the water pass darkens the sand with.
import * as THREE from 'three';
import { GLSL_COMMON } from './water.js';

const TAU = Math.PI * 2;
const KIND = { manta: 0, eagle: 1, sting: 2 };
// Half-width of the body (fraction of span) along the body axis x in [-0.5, 0.62] (fraction of chord).
const HW = {
  manta(x) {
    if (x > .5) return .1;
    if (x > -.1) { const t = (x + .1) / .6; return .095 + (.5 - .095) * Math.pow(1 - t, 1.12); }
    const u = (-.1 - x) / .4; return .055 + .445 * Math.pow(1 - u, 3.0);
  },
  eagle(x) {
    if (x > .5) return .05 * Math.sqrt(Math.max(0, 1 - ((x - .5) / .12) ** 2)) + .02;
    if (x > -.16) { const t = (x + .16) / .66; return .07 + (.5 - .07) * Math.pow(1 - t, 1.05); }
    const u = (-.16 - x) / .34; return .045 + .455 * Math.pow(1 - u, 3.6);
  },
  sting(x) {
    if (x > .5) return 0;
    const q = (x - .02) / .52; return .5 * Math.sqrt(Math.max(0, 1 - q * q)) * (1 - .08 * x);
  },
};

function rayGeometry(sp) {
  const NX = 34, NY = 14, x0 = -.5, x1 = sp === 'sting' ? .5 : .62, hw = HW[sp];
  const pos = [], an = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const x = x0 + (x1 - x0) * i / NX, w = Math.max(hw(x), .004);
    for (let j = 0; j <= NY; j++) {
      const yn = -1 + 2 * j / NY;
      pos.push(x, yn * w, 0); an.push(x, yn, w);
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const a = i * (NY + 1) + j, b = a + NY + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aN', new THREE.Float32BufferAttribute(an, 3));
  g.setIndex(idx);
  return g;
}

const RAY_VERT = /* glsl */`
  attribute vec3 aN;          // x along body (fraction of chord), y across (-1..1 of local half-width), w half-width
  uniform float uChord, uSpan, uPhase, uAmp, uBank, uPitch;
  varying vec3 vN; varying float vShade; varying vec2 vWorld; varying float vBelly;
  void main(){
    float y = aN.y * aN.z;                       // fraction of span (-0.5..0.5)
    float s = clamp(abs(y) / .5, 0.0, 1.0);
    float th = uAmp * sin(uPhase - 1.3 * s) * pow(s, 1.35) + uBank * sign(y) * s;
    float proj = cos(th * .85);
    float cp = cos(uPitch);
    vec2 local = vec2(aN.x * uChord * cp, y * uSpan * proj);
    vShade = sin(th) * sign(y);
    vBelly = cp < 0.0 ? 1.0 : 0.0;
    vN = aN;
    vec4 wp = modelMatrix * vec4(local, 0.0, 1.0);
    vWorld = wp.xy;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const RAY_FRAG = /* glsl */`
  precision highp float;
  uniform int uKind; uniform float uFade, uZ, uTime, uRest, uSpanU;
  varying vec3 vN; varying float vShade; varying vec2 vWorld; varying float vBelly;
  ${GLSL_COMMON}
  float dots(vec2 q, float r, float dens){
    vec2 id = floor(q), f = fract(q); float best = 9.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j)), o = h22(id + g);
      if (h12(id + g + 3.1) > dens) continue;
      best = min(best, length(g + o - f));
    }
    return smoothstep(r, r * .55, best);
  }
  void main(){
    float x = vN.x, yn = vN.y, y = yn * vN.z;
    float edge = smoothstep(1.0, .86, abs(yn));
    float a = edge * smoothstep(-.5, -.46, x);
    vec3 col;
    vec2 q = vec2(x, y) * vec2(1.0, 1.0);
    if (uKind == 0) {          // manta: charcoal back, white shoulder chevrons, cephalic lobes in front
      if (x > .5) { a *= step(.32, abs(yn)) * smoothstep(.62, .56, x); }
      col = vec3(.10, .115, .13) + .05 * fbm2(q * 16.0);
      col += vec3(.05) * smoothstep(.12, 0.0, abs(y)) * smoothstep(.45, .1, x);           // ridge
      vec2 a0 = vec2(.30, .09), a1 = vec2(.15, .21);                                        // shoulder patch segment
      vec2 pa = vec2(x, abs(y)) - a0, ba = a1 - a0; float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float dpatch = length(pa - ba * hh) - (.05 - .022 * hh);
      float chev = smoothstep(.012, -.012, dpatch) * step(x, .45);
      col = mix(col, vec3(.88, .90, .89), chev * .95);
      col = mix(col, vec3(.04, .045, .05), smoothstep(.78, 1.0, abs(yn)) * .6);
      if (vBelly > .5) col = mix(vec3(.93, .94, .93), vec3(.18, .2, .22), smoothstep(.7, 1.0, abs(yn)));
    } else if (uKind == 1) {   // spotted eagle ray: ink-navy back with white spots, pale duck-bill snout
      col = vec3(.11, .14, .2) + .04 * fbm2(q * 14.0);
      float sp = dots(vec2(x * 1.6, y) * 26.0, .26, .55);
      col = mix(col, vec3(.92, .94, .96), sp * smoothstep(.95, .7, abs(yn)) * step(x, .5));
      if (x > .5) col = mix(col, vec3(.26, .29, .34), .55);
      if (vBelly > .5) col = vec3(.92, .93, .94);
    } else {                   // blue-spotted stingray: tan-olive disc with electric blue spots
      col = mix(vec3(.66, .54, .28), vec3(.80, .68, .40), smoothstep(1.0, .15, length(vec2(x * 1.9, yn))));
      col *= .93 + .1 * fbm2(q * 20.0);
      float sp = dots(vec2(x, y) * 22.0, .30, .7);
      col = mix(col, vec3(.10, .52, .98), sp * smoothstep(.97, .75, abs(yn)));
      col = mix(col, vec3(.30, .24, .13), smoothstep(.82, .98, abs(yn)) * .7);
      vec2 eye = vec2(x - .26, abs(y) - .08); col = mix(col, vec3(.2, .16, .08), smoothstep(.03, .018, length(eye)));
      col = mix(col, vec3(.36, .33, .24), uRest * .35);  // settled in sand: dusted over
    }
    float shade = .88 + .26 * vShade;
    col *= shade;
    // sunlight focused by the surface plays across the back
    col += vec3(1.0, .97, .88) * caustic(vWorld, uTime, .6) * .13 * exp(-uZ * .5);
    // seen through the water: cooler and softer with depth
    col = mix(col, vec3(.10, .55, .62), clamp(uZ * .16, 0.0, .55));
    gl_FragColor = vec4(col, a * uFade);
  }
`;
const SHADOW_FRAG = /* glsl */`
  precision highp float;
  uniform float uStrength;
  varying vec3 vN;
  void main(){
    float a = smoothstep(1.0, .7, abs(vN.y)) * smoothstep(-.5, -.42, vN.x);
    if (vN.x > .5) a *= step(.32, abs(vN.y));
    gl_FragColor = vec4(a * uStrength, 0.0, 0.0, 1.0);
  }
`;

// Ribbons for tails, tentacles and oral arms: one strip per chain, rebuilt every frame.
function makeRibbon(n, mat) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 2 * 3), t = new Float32Array(n * 2), idx = [];
  for (let i = 0; i < n; i++) { t[i * 2] = t[i * 2 + 1] = i / (n - 1); }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false;
  return m;
}
function fillRibbon(m, cx, cy, n, w0, w1, wob, time) {
  const p = m.geometry.attributes.position.array;
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
    let dx = cx[b] - cx[a], dy = cy[b] - cy[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const u = i / (n - 1), w = (w0 + (w1 - w0) * u) * (1 + (wob ? .45 * Math.sin(u * 22 - time * 3 + wob) : 0));
    const nx = -dy * w, ny = dx * w, k = i * 6;
    p[k] = cx[i] + nx; p[k + 1] = cy[i] + ny; p[k + 2] = 0;
    p[k + 3] = cx[i] - nx; p[k + 4] = cy[i] - ny; p[k + 5] = 0;
  }
  m.geometry.attributes.position.needsUpdate = true;
}
const RIB_VERT = /* glsl */`
  attribute float aT; varying float vT;
  void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RIB_FRAG = /* glsl */`
  precision highp float; uniform vec3 uCol; uniform float uAlpha, uBands; varying float vT;
  void main(){
    float a = uAlpha * (1.0 - smoothstep(.55, 1.0, vT));
    vec3 c = uCol;
    if (uBands > 0.0) c = mix(c, vec3(.16, .55, .93), step(.5, fract(vT * uBands)) * step(vT, .7) * .8);
    gl_FragColor = vec4(c, a);
  }
`;

const BELL_VERT = /* glsl */`
  varying vec2 vP; varying vec2 vWorld;
  void main(){ vP = position.xy; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xy; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const BELL_FRAG = /* glsl */`
  precision highp float;
  uniform int uKind; uniform float uFade, uPulse, uRot, uTime, uZ;
  varying vec2 vP; varying vec2 vWorld;
  ${GLSL_COMMON}
  void main(){
    float r = length(vP); if (r > 1.0) discard;
    float ang = atan(vP.y, vP.x) - uRot;
    float rim = smoothstep(.82, .97, r) * (1.0 - smoothstep(.97, 1.0, r));
    float edge = 1.0 - smoothstep(.96, 1.0, r);
    vec3 col; float a;
    if (uKind == 0) {          // moon jelly: clear bell, four violet horseshoes, fine radial canals
      col = vec3(.93, .95, 1.0); a = .30 + .18 * r + .1 * (1.0 - r);
      float g = 0.0;
      for (int k = 0; k < 4; k++) {       // four rings in a clover, each open on its outer side (horseshoes)
        float ak = uRot + 1.5708 * float(k) + .785;
        vec2 dir = vec2(cos(ak), sin(ak)), c = .37 * dir;
        vec2 q = vP - c; float d = abs(length(q) - .15);
        float open = smoothstep(.55, .2, dot(normalize(q + 1e-4), dir));
        g = max(g, smoothstep(.055, .025, d) * open);
      }
      col = mix(col, vec3(.76, .44, .80), g); a = max(a, g * .95);
      float fringe = smoothstep(.9, .99, r) * (.5 + .5 * cos(ang * 64.0));
      a += fringe * .35;
      float canals = smoothstep(.96, 1.0, cos(ang * 16.0)) * smoothstep(.45, .9, r) * .25;
      a += canals + rim * .35;
    } else {                   // sea nettle: amber bell with darker radial stripes and a scalloped rim
      float stripe = smoothstep(.2, .8, cos(ang * 16.0)) * smoothstep(.25, .85, r);
      col = mix(vec3(.96, .66, .34), vec3(.80, .40, .18), stripe * .7);
      col = mix(col, vec3(1.0, .86, .62), smoothstep(.5, 0.0, r) * .5);
      a = .55 + .2 * stripe;
      float scal = .5 + .5 * cos(ang * 32.0);
      a *= 1.0 - smoothstep(.93, 1.0, r - .02 * scal);
      a += rim * .2;
    }
    col *= .92 + .18 * uPulse;
    col += vec3(1.0, .97, .9) * caustic(vWorld, uTime, .6) * .12 * exp(-uZ * .5);
    col = mix(col, vec3(.10, .55, .62), clamp(uZ * .12, 0.0, .4));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * edge * uFade);
  }
`;
const BELL_SHADOW = /* glsl */`
  precision highp float; uniform float uStrength; varying vec2 vP;
  void main(){ float r = length(vP); if (r > 1.0) discard; gl_FragColor = vec4((1.0 - smoothstep(.6, 1.0, r)) * uStrength, 0.0, 0.0, 1.0); }
`;

export function createCreatures(E) {
  const scene = new THREE.Scene(), shadowScene = new THREE.Scene();
  const rayGeo = { manta: rayGeometry('manta'), eagle: rayGeometry('eagle'), sting: rayGeometry('sting') };
  const bellGeo = new THREE.CircleGeometry(1, 56);
  const vis = new Map();
  const SUN = [.34, -.26];
  const VS = 1.3, JS = 1.75; // drawn larger than the physics bodies, as in a field guide         // shadows fall down and to the right
  const shared = { uTime: { value: 0 } };
  const maxBlend = { side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true };
  const ribMat = (col, alpha, bands = 0) => new THREE.ShaderMaterial({ vertexShader: RIB_VERT, fragmentShader: RIB_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(col) }, uAlpha: { value: alpha }, uBands: { value: bands } } });

  function addRay(r) {
    const P = r.P, sp = r.sp;
    const u = { uChord: { value: P.chord }, uSpan: { value: P.span }, uPhase: { value: 0 }, uAmp: { value: 0 }, uBank: { value: 0 }, uPitch: { value: 0 },
      uKind: { value: KIND[sp] }, uFade: { value: 0 }, uZ: { value: 0 }, uTime: shared.uTime, uRest: { value: 0 }, uSpanU: { value: P.span } };
    const mat = new THREE.ShaderMaterial({ vertexShader: RAY_VERT, fragmentShader: RAY_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(rayGeo[sp], mat); mesh.frustumCulled = false;
    const su = { uChord: u.uChord, uSpan: u.uSpan, uPhase: u.uPhase, uAmp: u.uAmp, uBank: u.uBank, uPitch: u.uPitch, uStrength: { value: 0 } };
    const smesh = new THREE.Mesh(rayGeo[sp], new THREE.ShaderMaterial({ vertexShader: RAY_VERT, fragmentShader: SHADOW_FRAG, uniforms: su, ...maxBlend }));
    smesh.frustumCulled = false;
    const tailCol = sp === 'sting' ? 0x9c8552 : sp === 'eagle' ? 0x26303c : 0x1a1e22;
    const tail = makeRibbon(r.tail.n, ribMat(tailCol, sp === 'manta' ? .9 : .95, sp === 'sting' ? 7 : 0));
    const stail = makeRibbon(r.tail.n, new THREE.ShaderMaterial({ vertexShader: RIB_VERT, fragmentShader: 'precision highp float; uniform float uStrength; void main(){ gl_FragColor = vec4(uStrength,0.,0.,1.); }', uniforms: { uStrength: { value: 0 } }, ...maxBlend }));
    scene.add(tail, mesh); shadowScene.add(stail, smesh);
    vis.set(r, { kind: 'ray', mesh, smesh, tail, stail, u, su });
  }
  function addJelly(j) {
    const u = { uKind: { value: j.sp === 'moon' ? 0 : 1 }, uFade: { value: 0 }, uPulse: { value: 0 }, uRot: { value: j.rot }, uTime: shared.uTime, uZ: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: BELL_VERT, fragmentShader: BELL_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(bellGeo, mat); mesh.frustumCulled = false;
    const su = { uStrength: { value: 0 } };
    const smesh = new THREE.Mesh(bellGeo, new THREE.ShaderMaterial({ vertexShader: BELL_VERT, fragmentShader: BELL_SHADOW, uniforms: su, ...maxBlend }));
    smesh.frustumCulled = false;
    const strands = j.strands.map(c => {
      const col = j.sp === 'moon' ? 0xf1eefc : c.kind === 1 ? 0xfbe1bf : 0xf6c690;
      const alpha = j.sp === 'moon' ? .2 : c.kind === 1 ? .55 : .42;
      const m = makeRibbon(c.n, ribMat(col, alpha)); scene.add(m); return m;
    });
    scene.add(mesh); shadowScene.add(smesh);
    vis.set(j, { kind: 'jelly', mesh, smesh, strands, u, su });
  }
  function drop(c) {
    const v = vis.get(c); if (!v) return;
    for (const m of [v.mesh, v.smesh, v.tail, v.stail, ...(v.strands || [])]) { if (!m) continue; m.parent && m.parent.remove(m); m.material.dispose(); if (m.geometry !== rayGeo.manta && m.geometry !== rayGeo.eagle && m.geometry !== rayGeo.sting && m.geometry !== bellGeo) m.geometry.dispose(); }
    vis.delete(c);
  }

  function update(t) {
    shared.uTime.value = t;
    const alive = new Set();
    for (const r of E.rays) { alive.add(r); if (!vis.has(r)) addRay(r); }
    for (const j of E.jellies) { alive.add(j); if (!vis.has(j)) addJelly(j); }
    for (const c of [...vis.keys()]) if (!alive.has(c)) drop(c);
    // draw order: deeper first
    const order = [...E.rays, ...E.jellies].sort((a, b) => b.z - a.z);
    order.forEach((c, i) => { const v = vis.get(c); v.mesh.renderOrder = i * 2 + 1; if (v.tail) v.tail.renderOrder = i * 2; if (v.strands) v.strands.forEach(m => { m.renderOrder = i * 2; }); });
    for (const r of E.rays) {
      const v = vis.get(r), u = v.u, P = r.P;
      const leaveFade = r.leaving ? Math.max(0, 1 - Math.max(0, Math.max(-r.x, r.x - E.W, -r.y, r.y - E.H)) / 1.4) : 1;
      u.uPhase.value = r.phase; u.uAmp.value = r.amp; u.uBank.value = r.bank; u.uPitch.value = r.pitch || 0;
      u.uFade.value = r.fade * leaveFade; u.uZ.value = r.z; u.uRest.value = r.restTint || 0;
      v.mesh.position.set(r.x, r.y, 0); v.mesh.rotation.z = r.h; v.mesh.scale.set(VS, VS, 1);
      const hb = Math.max(r.hb, .02), sx = SUN[0] * hb, sy = SUN[1] * hb;
      v.smesh.position.set(r.x + sx, r.y + sy, 0); v.smesh.rotation.z = r.h;
      const sc = VS * (1 + .06 * hb); v.smesh.scale.set(sc, sc, 1);
      v.su.uStrength.value = .78 * Math.exp(-hb * .33) * r.fade * leaveFade;
      const T = r.tail;
      fillRibbon(v.tail, T.x, T.y, T.n, T.w0 * 1.6, T.w1 * 1.8, 0, t);
      v.tail.material.uniforms.uAlpha.value = (r.sp === 'manta' ? .9 : .95) * r.fade * leaveFade;
      const sxs = v.sxs || (v.sxs = new Float32Array(T.n)), sys = v.sys || (v.sys = new Float32Array(T.n));
      for (let i = 0; i < T.n; i++) { sxs[i] = T.x[i] + sx; sys[i] = T.y[i] + sy; }
      fillRibbon(v.stail, sxs, sys, T.n, T.w0 * 1.4, T.w1 * 1.4, 0, t);
      v.stail.material.uniforms.uStrength.value = v.su.uStrength.value * .8;
    }
    for (const j of E.jellies) {
      const v = vis.get(j), u = v.u;
      const leaveFade = j.leaving ? .6 : 1;
      const R = j.R * JS * (1 - .14 * j.pulse);
      v.mesh.position.set(j.x, j.y, 0); v.mesh.scale.set(R, R * (1 - .05 * j.pulse), 1);
      u.uPulse.value = j.pulse; u.uFade.value = j.fade * leaveFade; u.uZ.value = j.z;
      const hb = Math.max(j.hb, .05);
      v.smesh.position.set(j.x + SUN[0] * hb, j.y + SUN[1] * hb, 0); v.smesh.scale.set(R * (1 + .08 * hb), R * (1 + .08 * hb), 1);
      v.su.uStrength.value = (j.sp === 'moon' ? .22 : .38) * Math.exp(-hb * .3) * j.fade;
      j.strands.forEach((c, i) => {
        const m = v.strands[i];
        fillRibbon(m, c.x, c.y, c.n, c.w0 * (c.kind === 1 ? 1.6 : 2.2), c.w1 * 2.2, c.kind === 1 ? i * 1.7 + 1 : 0, t);
        m.material.uniforms.uAlpha.value = (j.sp === 'moon' ? .22 : c.kind === 1 ? .78 : .7) * j.fade * leaveFade;
      });
    }
  }
  function pick(x, y) { // nearest creature under the pointer, judged by its drawn size
    let best = null, bd = 1e9;
    for (const r of E.rays) { if (r.leaving) continue; const d = Math.hypot(r.x - x, r.y - y), lim = Math.max(r.P.span, r.P.chord) * .55 * VS; if (d < lim && d / lim < bd) { bd = d / lim; best = r; } }
    for (const j of E.jellies) { if (j.leaving) continue; const d = Math.hypot(j.x - x, j.y - y), lim = j.R * JS * 1.1; if (d < lim && d / lim < bd) { bd = d / lim; best = j; } }
    return best;
  }
  function info() { let calls = 0; for (const v of vis.values()) calls += 2 + (v.tail ? 2 : 0) + (v.strands ? v.strands.length : 0); return { creatures: vis.size, approxCalls: calls }; }
  function dispose() { for (const c of [...vis.keys()]) drop(c); for (const g of Object.values(rayGeo)) g.dispose(); bellGeo.dispose(); }
  return { scene, shadowScene, update, pick, info, dispose };
}
