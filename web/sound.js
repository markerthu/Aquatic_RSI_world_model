// sound.js: optional ambience. Soft surf from filtered noise, rain hiss, and a quiet pentatonic note
// whenever a ray starts grazing, so the lagoon gets more musical as the rays learn. Off until asked for.
export function createSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.2; } // brown noise
  const surf = ctx.createBufferSource(); surf.buffer = buf; surf.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
  const swell = ctx.createGain(); swell.gain.value = .25;
  const lfo = ctx.createOscillator(); lfo.frequency.value = .09; const lfoG = ctx.createGain(); lfoG.gain.value = .16;
  lfo.connect(lfoG); lfoG.connect(swell.gain);
  surf.connect(lp); lp.connect(swell); swell.connect(master);
  const rainSrc = ctx.createBufferSource(); rainSrc.buffer = buf; rainSrc.loop = true; rainSrc.playbackRate.value = 3.1;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
  const rainG = ctx.createGain(); rainG.gain.value = 0;
  rainSrc.connect(hp); hp.connect(rainG); rainG.connect(master);
  surf.start(); rainSrc.start(); lfo.start();
  const SCALE = [0, 2, 4, 7, 9, 12, 14], BASE = 261.63;
  let on = false, lastNote = 0;
  return {
    toggle() { on = !on; ctx.resume(); master.gain.setTargetAtTime(on ? .55 : 0, ctx.currentTime, .4); return on; },
    get on() { return on; },
    setRain(r) { rainG.gain.setTargetAtTime(r ? .09 : 0, ctx.currentTime, 1.2); },
    note(i) {
      if (!on) return; const now = ctx.currentTime; if (now - lastNote < .35) return; lastNote = now;
      const f = BASE * Math.pow(2, SCALE[i % SCALE.length] / 12) * (i % 2 ? 1 : .5);
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(.07, now + .02); g.gain.exponentialRampToValueAtTime(.0001, now + 1.8);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + 1.9);
    },
  };
}
