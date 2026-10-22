// fish.js: schools of small silversides, the lagoon's third kind of agent. Each fish follows three local rules
// with its school (keep apart, match heading, stay together), follows the plankton scent, flees rays, nettles and
// your finger, and eats plankton, so the fish and the rays compete for the same food. Drawn as one instanced mesh.
import * as THREE from 'three';
import { depthAt, scentAt, foodAt, eatAt, flowAt } from './env.js';

const TAU = Math.PI * 2, FV = [0, 0];

export function createFish(E, opt = {}) {
  const schools = opt.schools ?? 3, per = opt.per ?? 26, n = schools * per, rng = E.rng;
  const F = {
    n, x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n),
    school: new Uint8Array(n), phase: new Float32Array(n), panic: new Float32Array(n), threats: [], eaten: 0,
  };
  for (let s = 0; s < schools; s++) {
    let cx = 0, cy = 0;
    for (let k = 0; k < 300; k++) { cx = E.W * (.15 + .7 * rng()); cy = E.H * (.12 + .7 * rng()); if (depthAt(E, cx, cy) > 1.2) break; }
    const a = rng() * TAU;
    for (let k = 0; k < per; k++) {
      const i = s * per + k, r = .35 * Math.sqrt(rng()), b = rng() * TAU;
      F.x[i] = cx + Math.cos(b) * r; F.y[i] = cy + Math.sin(b) * r;
      F.vx[i] = Math.cos(a) * .6; F.vy[i] = Math.sin(a) * .6; F.school[i] = s; F.phase[i] = rng() * TAU;
    }
  }
  return F;
}

// A tap or a fast stir: every fish within reach darts away from it.
export function scareFish(F, x, y, strength = 1) { F.threats.push({ x, y, s: strength, life: .6 }); }

export function stepFish(F, E, dt) {
  const n = F.n, X = F.x, Y = F.y, VX = F.vx, VY = F.vy, S = F.school;
  for (let q = F.threats.length - 1; q >= 0; q--) { F.threats[q].life -= dt; if (F.threats[q].life <= 0) F.threats.splice(q, 1); }
  const rays = E.rays, nets = E.nettles, e = .12;
  for (let i = 0; i < n; i++) {
    const x = X[i], y = Y[i];
    let ax = 0, ay = 0, cx = 0, cy = 0, ux = 0, uy = 0, m = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = X[j] - x, dy = Y[j] - y, d2 = dx * dx + dy * dy;
      if (d2 < .0324 && d2 > 1e-8) { const d = Math.sqrt(d2); ax -= dx / d * (.18 - d) * 16; ay -= dy / d * (.18 - d) * 16; } // keep apart
      if (S[j] === S[i] && d2 < .36) { cx += X[j]; cy += Y[j]; ux += VX[j]; uy += VY[j]; m++; }
    }
    if (m) {
      ax += (cx / m - x) * 1.1; ay += (cy / m - y) * 1.1;                       // stay together
      ax += (ux / m - VX[i]) * 1.6; ay += (uy / m - VY[i]) * 1.6;               // match heading
    }
    const gx = scentAt(E, x + e, y) - scentAt(E, x - e, y), gy = scentAt(E, x, y + e) - scentAt(E, x, y - e);
    const gl = Math.hypot(gx, gy); if (gl > 1e-4) { ax += gx / gl * .9; ay += gy / gl * .9; } // follow the scent
    let fear = 0;
    for (const r of rays) {                                                     // rays are big: give them room
      const dx = x - r.x, dy = y - r.y, d = Math.hypot(dx, dy), R = .65 + r.P.span * .5;
      if (d < R && d > 1e-4) { const w = (R - d) / R; ax += dx / d * w * 6; ay += dy / d * w * 6; fear = Math.max(fear, w); }
    }
    for (const t of nets) {
      const dx = x - t.x, dy = y - t.y, d = Math.hypot(dx, dy);
      if (d < .8 && d > 1e-4) { const w = (.8 - d) / .8; ax += dx / d * w * 7; ay += dy / d * w * 7; fear = Math.max(fear, w); }
    }
    for (const t of F.threats) {
      const dx = x - t.x, dy = y - t.y, d = Math.hypot(dx, dy), R = 1.1 * t.s;
      if (d < R && d > 1e-4) { const w = (R - d) / R; ax += dx / d * w * 14; ay += dy / d * w * 14; fear = Math.max(fear, w); }
    }
    if (fear > .4) F.panic[i] = Math.max(F.panic[i], .9);
    const D = depthAt(E, x, y);                                                 // stay in water deep enough to swim
    if (D < .9) {
      const hx = depthAt(E, x + e, y) - depthAt(E, x - e, y), hy = depthAt(E, x, y + e) - depthAt(E, x, y - e), hl = Math.hypot(hx, hy) || 1;
      ax += hx / hl * (.9 - D) * 8; ay += hy / hl * (.9 - D) * 8;
    }
    const mg = .5;                                                              // soft walls at the screen edge
    if (x < mg) ax += (mg - x) * 8; if (x > E.W - mg) ax -= (x - E.W + mg) * 8;
    if (y < mg) ay += (mg - y) * 8; if (y > E.H - mg) ay -= (y - E.H + mg) * 8;
    let vx = VX[i] + ax * dt, vy = VY[i] + ay * dt;
    F.panic[i] = Math.max(0, F.panic[i] - dt);
    const sp = Math.hypot(vx, vy) || 1, hi = F.panic[i] > 0 ? 2.1 : 1.15, lo = .35;
    if (sp > hi) { vx *= hi / sp; vy *= hi / sp; } else if (sp < lo) { vx *= lo / sp; vy *= lo / sp; }
    VX[i] = vx; VY[i] = vy;
    flowAt(E, x, y, E.t, FV);
    X[i] = x + (vx + .5 * FV[0]) * dt; Y[i] = y + (vy + .5 * FV[1]) * dt;
    F.phase[i] += dt * (7 + 5 * Math.hypot(vx, vy));
    const c = foodAt(E, X[i], Y[i]);                                            // grazing takes plankton from the rays
    if (c > .04) { eatAt(E, X[i], Y[i], 1 - .35 * dt); F.eaten += c * dt; }
  }
}

// ---------- drawing ----------
const FISH_VERT = /* glsl */`
  attribute float aPhase; attribute float aTint;
  varying vec2 vUv; varying float vTint;
  void main(){
    vUv = uv; vTint = aTint;
    vec3 p = position;
    float back = clamp((-p.x) * 2.0 + .1, 0.0, 1.0);                 // the tail half bends, the head stays still
    p.y += sin(aPhase - p.x * 8.0) * .22 * back;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }
`;
const FISH_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv; varying float vTint;
  void main(){
    vec2 q = vUv * 2.0 - 1.0;                                          // x: tail -1 .. head +1
    float body = 1.0 - smoothstep(.85, 1.0, length(vec2((q.x - .12) / .82, q.y / (.30 * (1.0 - .45 * max(-q.x, 0.0)) + .02))));
    float tail = step(q.x, -.62) * (1.0 - smoothstep(.0, .06, abs(q.y) - (-.62 - q.x) * 1.1)) * step(-.98, q.x);
    float a = max(body, tail);
    if (a < .02) discard;
    vec3 back = vec3(.20, .30, .36), flank = vec3(.80, .86, .88);
    vec3 col = mix(back, flank, smoothstep(-.05, .55, -q.y + .25));
    col += vec3(.25) * smoothstep(.10, 0., abs(q.y + .05)) * smoothstep(-.6, .4, q.x);   // silver stripe catching the sun
    col *= .85 + .25 * vTint;
    gl_FragColor = vec4(col, a * .92);
  }
`;
const FISH_SHADOW = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uStrength;
  void main(){
    vec2 q = vUv * 2.0 - 1.0;
    float a = 1.0 - smoothstep(.6, 1.0, length(vec2(q.x / .9, q.y / .32)));
    gl_FragColor = vec4(a * uStrength, 0., 0., 1.);
  }
`;

export function createFishView(F) {
  const geo = new THREE.PlaneGeometry(1, 1, 8, 1);
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(F.n), 1), tint = new THREE.InstancedBufferAttribute(new Float32Array(F.n), 1);
  for (let i = 0; i < F.n; i++) tint.array[i] = Math.random();
  geo.setAttribute('aPhase', phase); geo.setAttribute('aTint', tint);
  const mat = new THREE.ShaderMaterial({ vertexShader: FISH_VERT, fragmentShader: FISH_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, F.n); mesh.frustumCulled = false; mesh.renderOrder = 2;
  const smat = new THREE.ShaderMaterial({ vertexShader: FISH_VERT, fragmentShader: FISH_SHADOW, uniforms: { uStrength: { value: .55 } }, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true });
  const smesh = new THREE.InstancedMesh(geo, smat, F.n); smesh.frustumCulled = false;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(.25, .1, 1), Z = new THREE.Vector3(0, 0, 1);
  return {
    mesh, smesh,
    update() {
      for (let i = 0; i < F.n; i++) {
        Q.setFromAxisAngle(Z, Math.atan2(F.vy[i], F.vx[i]));
        P.set(F.x[i], F.y[i], 0); M.compose(P, Q, Sc); mesh.setMatrixAt(i, M);
        P.set(F.x[i] + .07, F.y[i] - .055, 0); M.compose(P, Q, Sc); smesh.setMatrixAt(i, M);
        phase.array[i] = F.phase[i];
      }
      mesh.instanceMatrix.needsUpdate = true; smesh.instanceMatrix.needsUpdate = true; phase.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); smat.dispose(); },
  };
}
