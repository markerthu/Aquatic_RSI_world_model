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
    // The touch sound of each species. None of these animals calls, so each plays the water it moves:
    // a wing-beat whoosh (mantas deep and slow, eagle rays quicker), a sand puff with a thump for a stingray
    // lifting off, and a soft bloop for a jelly's pulse.
    creature(sp) {
      if (!on) return; const now = ctx.currentTime;
      const out = ctx.createGain(); out.connect(master);
      if (sp === 'moon' || sp === 'nettle') {
        const o = ctx.createOscillator(), g = ctx.createGain(), f0 = sp === 'moon' ? 620 : 430;
        o.type = 'sine'; o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f0 * .45, now + .22);
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(.18, now + .015); g.gain.exponentialRampToValueAtTime(.0001, now + .35);
        o.connect(g); g.connect(out); o.start(now); o.stop(now + .4);
        return;
      }
      const src = ctx.createBufferSource(); src.buffer = buf; const bp = ctx.createBiquadFilter(), g = ctx.createGain();
      const P = { manta: [380, 140, .75, 1.6], eagle: [760, 300, .45, 2.2], sting: [520, 160, .3, 1.2] }[sp] || [500, 200, .4, 1.5];
      bp.type = 'bandpass'; bp.Q.value = P[3]; bp.frequency.setValueAtTime(P[0], now); bp.frequency.exponentialRampToValueAtTime(P[1], now + P[2]);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(.9, now + P[2] * .25); g.gain.exponentialRampToValueAtTime(.0001, now + P[2]);
      src.playbackRate.value = 1.6; src.connect(bp); bp.connect(g); g.connect(out); src.start(now, Math.random() * 3); src.stop(now + P[2] + .05);
      if (sp === 'sting') { // the thump of lifting off the sand
        const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(45, now + .18);
        og.gain.setValueAtTime(.35, now); og.gain.exponentialRampToValueAtTime(.0001, now + .22); o.connect(og); og.connect(out); o.start(now); o.stop(now + .25);
      }
    },
    note(i) {
      if (!on) return; const now = ctx.currentTime; if (now - lastNote < .35) return; lastNote = now;
      const f = BASE * Math.pow(2, SCALE[i % SCALE.length] / 12) * (i % 2 ? 1 : .5);
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(.07, now + .02); g.gain.exponentialRampToValueAtTime(.0001, now + 1.8);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + 1.9);
    },
  };
}
