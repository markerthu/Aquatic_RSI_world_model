// water.js: the lagoon floor, the water column and the surface, drawn in one full-screen pass.
// Inputs come from env.js grids: depth + shore distance (one texture), CPU ripples, plankton, and a
// low-resolution shadow buffer that the creatures render into.
import * as THREE from 'three';

// Shared GLSL: hashing, value noise, and a caustic web made from animated Voronoi edges.
export const GLSL_COMMON = /* glsl */`
  vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float h12(vec2 p){ return fract(sin(dot(p, vec2(41.37, 289.21))) * 47453.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = h12(i), b = h12(i + vec2(1, 0)), c = h12(i + vec2(0, 1)), d = h12(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
  float fbm2(vec2 p){ return .55 * vnoise(p) + .3 * vnoise(p * 2.03 + 7.1) + .15 * vnoise(p * 4.11 + 3.3); }
  // distance between the two nearest moving Voronoi sites: small on cell edges
  float voroEdge(vec2 x, float t){
    vec2 n = floor(x), f = fract(x); float f1 = 8.0, f2 = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j)), o = h22(n + g);
      o = .5 + .42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f; float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return sqrt(f2) - sqrt(f1);
  }
  // two layers of light lines focused by the moving surface; sharp = thinner lines in shallow water
  float caustic(vec2 p, float t, float sharp){
    vec2 w1 = vec2(fbm2(p * .42 + t * .06), fbm2(p * .42 - t * .05 + 9.0)) - .5;
    vec2 w2 = vec2(fbm2(p * .61 - t * .04 + 3.0), fbm2(p * .61 + t * .05 + 17.0)) - .5;
    float a = voroEdge((p + w1 * 1.5) * 1.05, t * .5), b = voroEdge((p + w2 * 1.3) * 1.75 + 7.3, -t * .42);
    float k = 10.0 + 12.0 * sharp;
    float l1 = exp(-a * k), l2 = exp(-b * (k + 4.0));
    return l1 * .75 + l2 * .45 + l1 * l2 * 1.6;
  }
`;

const vert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uDepth;   // r: depth (u), g: shore distance (u), both packed
  uniform sampler2D uRipple;  // rg: height gradient, b: height
  uniform sampler2D uFood;    // r: plankton density 0..1
  uniform sampler2D uShadow;  // r: creature shadow 0..1 (low resolution)
  uniform vec2 uWorld;        // W, H in world units
  uniform vec2 uShadowTexel;
  uniform float uTime, uRain, uCurrent, uWhirl, uOvercast, uPalm, uCT;
  uniform vec2 uCurDir, uWhirlPos, uDrift;
  ${GLSL_COMMON}
  vec2 field(vec2 p){ vec4 t = texture2D(uDepth, p / uWorld); return vec2(t.r * 7.5 - .3, t.g * 18.0 - 6.0); }
  // sand: warm pale grains with wave-ripple marks; wet sand is darker and cooler
  vec3 sandAt(vec2 p, float D){
    float n = fbm2(p * .8);
    float ang = .55 + .4 * (fbm2(p * .12 + 3.0) - .5);
    vec2 dir = vec2(cos(ang), sin(ang));
    float ridges = sin(dot(p, dir) * 13.0 + n * 6.0 + fbm2(p * 1.7) * 3.0);
    ridges = smoothstep(-.2, 1.0, ridges) * smoothstep(-.4, .6, D) ;
    float grain = h12(floor(p * 220.0)) * .06;
    vec3 dry = vec3(.93, .86, .70), wet = vec3(.80, .76, .62);
    vec3 c = mix(dry, wet, smoothstep(-.15, .25, D));
    c *= .93 + .1 * n + grain;
    c *= 1.0 - .07 * ridges;
    // scattered darker patches: seagrass shadows and coral rubble further out
    float patchy = smoothstep(.62, .8, fbm2(p * .45 + 21.0)) * smoothstep(1.2, 3.0, D);
    c = mix(c, vec3(.45, .55, .43), patchy * .45);
    return c;
  }
  // palm fronds off the top-left corner, swaying; returns shade 0..1
  float palm(vec2 p){
    vec2 o = vec2(-.6, uWorld.y + .5);
    vec2 q = p - o; float r = length(q); float a0 = atan(q.y, q.x);
    float shade = 0.0;
    for (int k = 0; k < 9; k++) {
      float fk = float(k);
      float a = -1.55 + fk * .16 + .035 * sin(uTime * .7 + fk * 1.7);
      float L = 3.2 + .9 * fract(sin(fk * 12.7) * 31.1);
      vec2 d = vec2(cos(a), sin(a));
      float along = dot(q, d), across = d.x * q.y - d.y * q.x;
      if (along < .2 || along > L) continue;
      float u = along / L;
      float w = .55 * sin(3.1416 * u) * (1.0 - .35 * u);
      float comb = .55 + .45 * abs(sin(along * 9.0 + fk));
      float leaf = 1.0 - smoothstep(w * comb * .85, w * comb, abs(across - .15 * u * u * sign(fk - 4.0)));
      shade = max(shade, leaf * smoothstep(L, L - .4, along));
    }
    return shade;
  }
  void main(){
    vec2 p = vUv * uWorld;
    vec2 F = field(p); float D = F.x, S = F.y;
    vec4 rp = texture2D(uRipple, vUv);
    vec2 grad = (rp.rg - .5) * 2.0;
    // a slow swell plus wind ripples, stronger in rain
    float t = uTime;
    vec2 swell = vec2(fbm2(p * .6 + vec2(t * .09, -t * .06)), fbm2(p * .6 + vec2(-t * .07, t * .08) + 5.0)) - .5;
    vec2 nrm = grad * 1.4 + swell * (.35 + .5 * uRain);
    float wet = smoothstep(-.02, .08, D);
    // seabed seen through the surface: refraction shifts it by the surface slope times depth
    vec2 pb = p + nrm * .18 * clamp(D, 0.0, 2.5) * wet;
    vec3 bed = sandAt(pb, D);
    // creature shadows (soft: 5 taps on the low-res buffer)
    vec2 su = vUv;
    float sh = texture2D(uShadow, su).r * .4
      + (texture2D(uShadow, su + vec2(uShadowTexel.x, 0.)).r + texture2D(uShadow, su - vec2(uShadowTexel.x, 0.)).r
      +  texture2D(uShadow, su + vec2(0., uShadowTexel.y)).r + texture2D(uShadow, su - vec2(0., uShadowTexel.y)).r) * .15;
    sh = clamp(sh, 0.0, 1.0);
    float palmSh = palm(p) * uPalm;
    // caustics: bright, sharp in the shallows, fading with depth; blocked by shadows; weaker when overcast
    float cAmt = wet * exp(-max(D, 0.0) * .32) * (1.0 - .75 * uOvercast) * (1.0 - .8 * sh) * (1.0 - .7 * palmSh);
    float cs = caustic(pb + uDrift, uCT, smoothstep(2.5, .3, D));
    bed += vec3(1.0, .97, .86) * cs * cAmt * .42;
    bed *= 1.0 - .42 * sh * wet - .30 * palmSh;
    // water column: absorption toward turquoise, then teal-blue, then deep navy
    vec3 c1 = vec3(.56, .89, .84), c2 = vec3(.13, .68, .74), c3 = vec3(.06, .42, .64), c4 = vec3(.03, .20, .40);
    float d = max(D, 0.0);
    vec3 water = mix(c1, c2, smoothstep(.2, 1.4, d));
    water = mix(water, c3, smoothstep(1.2, 3.6, d));
    water = mix(water, c4, smoothstep(3.4, 7.0, d));
    float absorb = 1.0 - exp(-d * .62);
    vec3 col = mix(bed, water, absorb * wet);
    col = mix(col, bed * vec3(.86, .96, .96), (1.0 - absorb) * wet * .35);
    // plankton blooms: fine motes drifting with the water
    float food = texture2D(uFood, vUv).r;
    if (food > .02) {
      vec2 g = (p + vec2(sin(t * .3), cos(t * .27)) * .05) * 9.0;
      vec2 id = floor(g), f = fract(g) - .5;
      float hsh = h12(id);
      float mote = smoothstep(.09, .02, length(f - (h22(id) - .5) * .7)) * step(hsh, food * .9);
      col += vec3(.95, .98, .82) * mote * .55 * wet;
      col = mix(col, col * vec3(.92, 1.03, .92), smoothstep(.05, .6, food) * .35 * wet);
    }
    // surface: sky sheen and sun glints on the slopes; streaks of light in the swell
    float sheen = clamp(dot(nrm, vec2(.55, .65)) * 1.6, -1.0, 1.0);
    col += vec3(.95, .98, 1.0) * max(sheen, 0.0) * .12 * wet * (1.0 - .6 * uOvercast);
    col -= vec3(.03, .02, .0) * max(-sheen, 0.0) * wet;
    float glint = pow(max(0.0, sheen), 6.0) * smoothstep(.4, 2.0, d);
    col += vec3(1.0) * glint * .18 * (1.0 - uOvercast);
    // rain dimples catch the light
    col += vec3(.9, .95, 1.0) * clamp(rp.b - .55, 0.0, 1.0) * 1.6 * uRain * wet;
    // foam lace at the waterline, pulled back and forth by the swell
    float lace = smoothstep(.0, .05, S) * (1.0 - smoothstep(.05, .55, S));
    float surge = sin(S * 9.0 - t * 1.3 + fbm2(p * 1.4) * 4.0);
    float foam = lace * smoothstep(.35, .95, surge * .5 + .5 + (fbm2(p * 3.0 + t * .2) - .5) * .8);
    foam += smoothstep(.06, 0.0, abs(S - .02 - .03 * sin(t * .8 + p.x * .7))) * .7;
    col = mix(col, vec3(.98, .99, .97), clamp(foam, 0.0, 1.0) * .8);
    // overcast and rain: flatter, cooler light
    col = mix(col, col * vec3(.80, .88, .93) + .03, uOvercast * .6);
    // a gentle vignette toward the deep corner
    vec2 vv = vUv - .5; col *= 1.0 - .18 * dot(vv, vv);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createWater(E, renderer) {
  // depth + shore texture (RGBA8), 8 cells per world unit
  const nx = E.bnx, ny = E.bny, dd = new Uint8Array(nx * ny * 4);
  for (let k = 0; k < nx * ny; k++) {
    dd[k * 4] = Math.max(0, Math.min(255, Math.round((E.D[k] + .3) / 7.5 * 255)));
    dd[k * 4 + 1] = Math.max(0, Math.min(255, Math.round((E.Sd[k] + 6) / 18 * 255)));
    dd[k * 4 + 2] = 0; dd[k * 4 + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(dd, nx, ny, THREE.RGBAFormat);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
  const rippleTex = new THREE.DataTexture(E.rpack, E.rnx, E.rny, THREE.RGBAFormat);
  rippleTex.magFilter = rippleTex.minFilter = THREE.LinearFilter; rippleTex.needsUpdate = true;
  const foodBuf = new Uint8Array(E.fnx * E.fny * 4);
  const foodTex = new THREE.DataTexture(foodBuf, E.fnx, E.fny, THREE.RGBAFormat);
  foodTex.magFilter = foodTex.minFilter = THREE.LinearFilter; foodTex.needsUpdate = true;

  const uniforms = {
    uDepth: { value: depthTex }, uRipple: { value: rippleTex }, uFood: { value: foodTex }, uShadow: { value: null },
    uWorld: { value: new THREE.Vector2(E.W, E.H) }, uShadowTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) },
    uTime: { value: 0 }, uRain: { value: 0 }, uCurrent: { value: 0 }, uWhirl: { value: 0 }, uOvercast: { value: 0 }, uPalm: { value: 1 },
    uCurDir: { value: new THREE.Vector2(1, 0) }, uWhirlPos: { value: new THREE.Vector2(0, 0) },
    uCT: { value: 0 }, uDrift: { value: new THREE.Vector2(0, 0) },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false; quad.renderOrder = -10;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();

  // snap: jump eased values to their targets (a still lagoon draws a change at once)
  function update(t, dt, snap) {
    uniforms.uTime.value = t;
    const tgt = (k, v) => { uniforms[k].value += (v - uniforms[k].value) * (snap ? 1 : Math.min(1, dt / 1.5)); };
    tgt('uRain', E.rain ? 1 : 0); tgt('uOvercast', E.rain ? 1 : 0);
    uniforms.uCurrent.value = E.curS; uniforms.uWhirl.value = E.whirl.s;
    const a = E.curAng; uniforms.uCurDir.value.set(Math.cos(a), Math.sin(a));
    // caustic clock and drift are integrated here, so a change of weather changes their speed, not their phase
    uniforms.uCT.value += dt * (1 + .6 * uniforms.uRain.value);
    uniforms.uDrift.value.x += dt * .12 * E.curS * Math.cos(a); uniforms.uDrift.value.y += dt * .12 * E.curS * Math.sin(a);
    uniforms.uWhirlPos.value.set(E.whirl.x, E.whirl.y);
    rippleTex.needsUpdate = true;
    const f = E.food;
    for (let k = 0; k < f.length; k++) foodBuf[k * 4] = f[k] * 255;
    foodTex.needsUpdate = true;
  }
  function render(shadowRT) {
    uniforms.uShadow.value = shadowRT.texture;
    uniforms.uShadowTexel.value.set(1 / shadowRT.width, 1 / shadowRT.height);
    renderer.render(scene, cam);
  }
  function dispose() { depthTex.dispose(); rippleTex.dispose(); foodTex.dispose(); mat.dispose(); quad.geometry.dispose(); }
  return { update, render, uniforms, dispose };
}
