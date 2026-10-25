#!/usr/bin/env python3
"""Record "Aquatic RSI World Model: multi-agent, world model, self-improvement", a 60 s film in three chapters.

Every frame comes from the real simulation, stepped by exact 1/30 s steps in the page's ?capture mode. The overlays
(labels, the replayed imagined swims, the learning panel) are drawn from the simulation's own state, frame by frame:
  1  Multi-agent       labels follow real creatures; plankton blooms where the film taps, rays and fish race for it
  2  World model       the lagoon is held still while one generation's 16 imagined swims per species are redrawn from
                       the trainer's record (brighter = scored better), then the best ones are kept
  3  Self-improvement  the habits are reset to zero and the lagoon runs at 6x: the learned weights, the self-tuned
                       exploration size and the live learned-vs-untrained check all come from the page's state

usage:  cd web && python3 -m http.server 8000          (in another terminal)
        python3 tools/record_film_rsi.py out/ [--seed 11] [--warm 60] [--url http://localhost:8000/]
needs:  Google Chrome, ffmpeg, and `pip install websocket-client`
"""
import argparse, base64, json, os, shutil, socket, subprocess, tempfile, time, urllib.request
import websocket

CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
FPS, DUR = 30, 60.0


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=120, suppress_origin=True); self.i = 0

    def call(self, method, **params):
        self.i += 1; mid = self.i
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})

    def eval(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        if r.get('exceptionDetails'): raise RuntimeError(str(r['exceptionDetails'].get('exception', {}).get('description', r['exceptionDetails'])))
        return r.get('result', {}).get('value')


# The film controller runs inside the page. window.__film.frame(t) advances the lagoon for film time t, then redraws
# every overlay for that instant; all fades are computed from t, so the film is frame-exact.
FILM_JS = r"""
(()=>{
const S = __aquatic, $ = id => document.getElementById(id);
const NAVY = '#2F4B8F', MISTY = '#BFD8EC', PEACH = '#E39A7A', TC = { manta: '#2F4B8F', eagle: '#6F94C6', sting: '#E39A7A' };
const st = document.createElement('style');
st.textContent = `
.bar,.hint,.show,.toast,.ra-btn,.tag,.head,.evo,#intro{display:none!important}
#fx-ov{position:fixed;inset:0;width:100%;height:100%;z-index:6;pointer-events:none}
#fx-copy{position:fixed;inset:18px;z-index:7;border:2px solid rgba(191,216,236,.85);border-radius:14px;pointer-events:none;opacity:0}
#fx-copy span{position:absolute;top:-15px;left:50%;transform:translateX(-50%);background:#0f2f45;color:#dce8f3;font:600 17px Inter,system-ui,sans-serif;
  padding:5px 14px;border-radius:999px;letter-spacing:.01em;white-space:nowrap}
#fx-chap{position:fixed;left:56px;top:48px;z-index:9;color:#fff;opacity:0;text-shadow:0 2px 16px rgba(0,20,40,.45)}
#fx-chap small{display:block;font:600 18px Inter,system-ui,sans-serif;color:#BFD8EC;margin-bottom:4px}
#fx-chap b{font:500 54px/1 Newsreader,Georgia,serif}
#fx-cap{position:fixed;left:32px;bottom:36px;z-index:9;max-width:960px;padding:26px 48px 26px 24px;opacity:0;
  background:radial-gradient(farthest-side at 45% 50%,rgba(6,26,40,.55),rgba(6,26,40,0));
  font:500 34px/1.3 Inter,system-ui,sans-serif;color:#fff;text-shadow:0 2px 18px rgba(0,20,40,.55)}
#fx-cap b{font-weight:700}
#fx-card{position:fixed;inset:0;z-index:12;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;opacity:0;
  background:radial-gradient(ellipse at center,rgba(8,30,44,.66),rgba(8,30,44,.86));-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);color:#fff;text-align:center}
#fx-card h1{font:500 104px/1 Newsreader,Georgia,serif;margin:0;letter-spacing:-.01em}
#fx-card h1 i{font-style:italic}
#fx-card p{font:500 32px/1.35 Inter,system-ui,sans-serif;margin:0;color:#dce8f3}
#fx-card small{font:500 22px/1.5 Inter,system-ui,sans-serif;color:#BFD8EC}
.fx-lbl{position:fixed;z-index:8;transform:translate(-50%,-100%);font:600 19px Inter,system-ui,sans-serif;color:#0f2433;
  background:rgba(251,250,247,.95);border-radius:999px;padding:6px 14px;white-space:nowrap;box-shadow:0 6px 18px rgba(6,26,40,.25);opacity:0}
.fx-lbl:after{content:'';position:absolute;left:50%;bottom:calc(-1 * var(--stem,16px));width:2px;height:var(--stem,16px);background:rgba(251,250,247,.95);transform:translateX(-50%)}
#fx-hud{position:fixed;right:48px;top:44px;z-index:9;width:470px;transform:scale(1.25);transform-origin:top right;padding:22px 24px 20px;border-radius:18px;opacity:0;
  background:rgba(251,250,247,.95);color:#1d2433;font:500 17px Inter,system-ui,sans-serif;box-shadow:0 18px 50px rgba(6,26,40,.3)}
#fx-hud .top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
#fx-hud .gen{font:500 40px/1 Newsreader,Georgia,serif;color:#2F4B8F}
#fx-hud .gen small{font:600 15px Inter,system-ui,sans-serif;color:#4C5468;margin-left:8px}
#fx-hud .spd{font:700 15px Inter,system-ui,sans-serif;color:#2F4B8F;background:rgba(191,216,236,.6);border-radius:999px;padding:4px 10px}
#fx-hud .hdr,#fx-hud .row{display:grid;grid-template-columns:118px 1fr 1fr;gap:12px;align-items:center}
#fx-hud .hdr{font:600 13px Inter,system-ui,sans-serif;color:#4C5468;margin:6px 0 6px}
#fx-hud .row{padding:7px 0;border-top:1px solid #e6e2d8}
#fx-hud .who b{display:block;font:600 17px Inter,system-ui,sans-serif}
#fx-hud .who span{font:500 13px Inter,system-ui,sans-serif;color:#4C5468;font-variant-numeric:tabular-nums}
#fx-hud .m{position:relative;height:9px;background:#e9e6de;border-radius:999px}
#fx-hud .m:before{content:'';position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:#b8b3a6}
#fx-hud .m i{position:absolute;top:0;bottom:0;border-radius:999px;background:#2F4B8F}
#fx-hud .ratio{display:flex;align-items:baseline;justify-content:space-between;margin-top:12px;border-top:1px solid #e6e2d8;padding-top:10px}
#fx-hud .ratio b{font:500 34px/1 Newsreader,Georgia,serif;color:#2F4B8F}
#fx-hud .ratio span{font:500 13px Inter,system-ui,sans-serif;color:#4C5468;max-width:250px}
#fx-hud svg{display:block;width:100%;height:84px;margin-top:6px}
`;
document.head.appendChild(st);
const mk = (tag, id, html) => { const e = document.createElement(tag); if (id) e.id = id; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
const ov = mk('canvas', 'fx-ov'); ov.width = innerWidth; ov.height = innerHeight; const g = ov.getContext('2d');
const copy = mk('div', 'fx-copy', '<span>the copy: a world model of the lagoon</span>');
const chap = mk('div', 'fx-chap'), cap = mk('div', 'fx-cap'), card = mk('div', 'fx-card');
const hud = mk('div', 'fx-hud', `<div class="top"><div class="gen">0<small>generations</small></div><div class="spd">6x speed</div></div>
  <div class="hdr"><span>Ray species</span><span>Follow the scent</span><span>Steer clear of nettles</span></div>
  ${['manta', 'eagle', 'sting'].map(k => `<div class="row" data-k="${k}" style="box-shadow:inset 3px 0 0 ${TC[k]};padding-left:10px">
     <div class="who"><b>${{ manta: 'Manta', eagle: 'Eagle ray', sting: 'Stingray' }[k]}</b><span>explores ±0.30</span></div>
     <div class="m"><i></i></div><div class="m"><i></i></div></div>`).join('')}
  <div class="ratio"><b>—</b><span>plankton, learned ÷ untrained, same water and starts (last three checks)</span></div><svg viewBox="0 0 422 84"></svg>`);
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const win = (t, a, b, f = .5) => Math.min(smooth(a, a + f, t), 1 - smooth(b - f, b, t)); // fade in at a, out at b
const unit = () => $('lagoon').clientWidth / S.E.W, scr = (x, y) => [x * unit(), (S.E.H - y) * unit()];

const TITLE = `<h1>Aquatic RSI <i>World Model</i></h1><p>Many agents that teach themselves, in a copy of their world</p><small>a live simulation, recorded frame by frame</small>`;
const END = `<h1>Aquatic RSI <i>World Model</i></h1><p>Multi-agent · World model · Self-improvement</p>
  <small>Play it: jiajunfan.com/lab/aquatic-rsi-world-model<br>Code (MIT): github.com/markerthu/Aquatic_RSI_world_model<br>Jiajun Fan · UIUC</small>`;
const CHAPS = [[4, 17, '1', 'Many agents'], [17, 34, '2', 'A world model'], [34, 54, '3', 'Self-improvement']];
const CAPS = [
  [5.6, 11.0, '<b>Many agents</b> share one lagoon: 7 rays, 5 jellies and 78 fish.'],
  [11.2, 16.6, 'Rays and fish <b>compete for the same plankton</b>. Tap the water and they race for it.'],
  [18.0, 23.6, 'Every 1.5 s each ray species copies the lagoon, <b>a world model</b>, and imagines 16 practice swims in it.'],
  [23.8, 28.9, 'It keeps what worked: the swims that <b>ate more and got stung less</b>.'],
  [29.4, 33.6, 'Then it acts in the real lagoon, and does it again.'],
  [34.3, 35.9, 'Start over: every habit back to zero.'],
  [36.0, 41.4, 'From zero, each species <b>improves its own habit</b>: follow the scent, steer clear of nettles.'],
  [41.6, 46.8, 'It also <b>learns how to learn</b>: how boldly it practises adapts with every lesson.'],
  [47.0, 53.5, '<b>Checked live</b> against an untrained ray, in the same water and from the same starts.'],
];
const LBL = [[6.4, 'manta', 'Manta ray'], [7.2, 'eagle', 'Eagle ray'], [8.0, 'sting', 'Stingray'], [8.8, 'moon', 'Moon jelly'], [9.6, 'nettle', 'Sea nettle'], [10.4, 'fish', 'A school of fish']];
const lblEl = {}, lblWho = {}, lblOff = {};
for (const [, k, txt] of LBL) lblEl[k] = mk('div', null, txt), lblEl[k].className = 'fx-lbl';
const done = new Set(); const once = (key, fn) => { if (!done.has(key)) { done.add(key); fn(); } };
let snap = null;

function pick(k) { // the creature of species k nearest the middle of the screen, kept for the rest of the chapter
  if (k === 'fish') { const F = S.F; let bi = 0, bn = -1; for (let i = 0; i < F.n; i++) { if (F.school[i] !== 0) continue; let n = 0;
    for (let j = 0; j < F.n; j++) if (F.school[j] === 0 && Math.hypot(F.x[j] - F.x[i], F.y[j] - F.y[i]) < .5) n++;
    const [x, y] = scr(F.x[i], F.y[i]); if (x > 120 && x < innerWidth - 120 && y > 140 && y < innerHeight - 200 && n > bn) { bn = n; bi = i; } } return { fish: bi }; }
  const list = (k === 'manta' || k === 'eagle' || k === 'sting') ? S.E.rays : S.E.jellies;
  let best = null, bd = 1e9;
  for (const c of list) { if (c.sp !== k || c.leaving || c.gone) continue; const [x, y] = scr(c.x, c.y), d = Math.hypot(x - innerWidth * .5, y - innerHeight * .45);
    if (x > 120 && x < innerWidth - 120 && y > 140 && y < innerHeight - 200 && d < bd) { bd = d; best = c; } }
  return best || list.find(c => c.sp === k);
}
function where(w) {
  if (w && w.fish !== undefined) { const F = S.F, a = w.fish; let x = 0, y = 0, n = 0; // the clump around the anchor fish
    for (let i = 0; i < F.n; i++) if (F.school[i] === F.school[a] && Math.hypot(F.x[i] - F.x[a], F.y[i] - F.y[a]) < .5) { x += F.x[i]; y += F.y[i]; n++; } return scr(x / n, y / n); }
  return w ? scr(w.x, w.y) : [-999, -999];
}

function drawTrails(t) {
  g.clearRect(0, 0, ov.width, ov.height);
  if (!snap) return;
  const rv = smooth(18.0, 21.0, t), hl = smooth(23.8, 24.6, t), out = 1 - smooth(29.0, 29.5, t), u = unit();
  if (out <= 0) return;
  for (const sp in snap) {
    const { tries, rank } = snap[sp], n = rank.length, pts = tries.length / (2 * n), m = Math.max(2, Math.ceil(pts * rv));
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => rank[a] - rank[b]), top = new Set(order.slice(-3));
    for (const k of order) {
      const q = rank[k] + .5, o = k * pts * 2, best = top.has(k);
      g.beginPath();
      for (let i = 0; i < m; i++) { const x = tries[o + 2 * i] * u, y = (S.E.H - tries[o + 2 * i + 1]) * u; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      let a = q > .5 ? .3 + .6 * (q - .5) * 2 : .3; a *= best ? 1 : 1 - .82 * hl;
      g.strokeStyle = q > .5 ? `rgba(255,255,255,${a * out})` : `rgba(245,200,181,${a * out})`;
      g.lineWidth = (best ? 2.4 + 1.6 * hl : 1.6); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    }
  }
}

function hudUpdate(t) {
  const s = S.state();
  hud.querySelector('.gen').firstChild.nodeValue = String(s.gen);
  for (const k of ['manta', 'eagle', 'sting']) {
    const row = hud.querySelector(`[data-k="${k}"]`), th = s.thetas[k], bars = row.querySelectorAll('.m i');
    [th[0], -th[2]].forEach((v, j) => { const f = Math.max(-1, Math.min(1, v / 4)); bars[j].style.left = (f >= 0 ? 50 : 50 + f * 50) + '%'; bars[j].style.width = Math.abs(f) * 50 + '%'; });
    row.querySelector('.who span').textContent = `explores ±${(s.sig[k] || 0).toFixed(2)}`;
  }
  // learned ÷ untrained: pooled over the last three checks of every ray species, as the page's badge does
  const gens = [...new Set(Object.values(s.abh).flat().map(p => p[0]))].sort((a, b) => a - b), pts = [];
  gens.forEach((gn, i) => { let A = 0, B = 0; for (const k in s.abh) for (const p of s.abh[k]) if (p[0] <= gn && gens.indexOf(p[0]) > i - 3) { A += p[2]; B += p[3]; } if (A > 0) pts.push([gn, B / A]); });
  hud.querySelector('.ratio b').textContent = pts.length ? `×${pts[pts.length - 1][1].toFixed(2)}` : 'first check after 15 generations';
  hud.querySelector('.ratio b').style.fontSize = pts.length ? '' : '18px';
  const svg = hud.querySelector('svg'), W = 422, H = 84, g1 = Math.max(80, s.gen), lo = .5, hi = Math.max(2, ...pts.map(p => p[1]));
  const px = gn => 8 + (W - 16) * gn / g1, py = r => H - 8 - (H - 16) * (r - lo) / (hi - lo);
  let h = `<line x1="8" x2="${W - 8}" y1="${py(1)}" y2="${py(1)}" stroke="#8F97A8" stroke-dasharray="4 4"/><text x="${W - 10}" y="${py(1) + 15}" text-anchor="end" font-size="12" fill="#8F97A8" font-family="Inter">×1 = no better</text>`;
  if (pts.length) h += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${NAVY}" stroke-width="2.5" stroke-linejoin="round"/>`
    + pts.map(p => `<circle cx="${px(p[0]).toFixed(1)}" cy="${py(p[1]).toFixed(1)}" r="3.6" fill="${NAVY}"/>`).join('');
  svg.innerHTML = h;
}

window.__film = { frame(t) {
  // 1. events and the lagoon clock
  if (t >= 11.6) once('b1', () => S.bloomAt(S.E.W * .55, S.E.H * .5));
  if (t >= 13.6) once('b2', () => S.bloomAt(S.E.W * .36, S.E.H * .42));
  if (t >= 17.5) once('freeze', () => { snap = {}; for (const sp of ['manta', 'eagle', 'sting']) { const q = S.tr.S[sp]; if (q.tries && q.rank) snap[sp] = { tries: Float32Array.from(q.tries), rank: Float64Array.from(q.rank) }; } });
  if (t >= 34.6) once('reset', () => S.api.startOver());
  const frozen = t >= 17.5 && t < 29.2, steps = frozen ? 0 : (t >= 35.2 && t < 52.4 ? 6 : 1);
  window.__showImagined = (t >= 29.2 && t < 34.4) || (t >= 35.2 && t < 53.5);
  window.__imagBoost = t < 34.4 ? 1.6 : 1.0;
  for (let i = 0; i < steps; i++) S.capStep(1 / 30);
  // 2. overlays
  const cardOn = Math.max(win(t, -1, 3.6, .6), win(t, 54.2, 61, .7));
  card.style.opacity = cardOn; card.innerHTML = t < 30 ? TITLE : END;
  let ch = 0; for (const [a, b, n, title] of CHAPS) { const o = win(t, a, b, .6); if (o > ch) { ch = o; chap.innerHTML = `<small>${n} / 3</small><b>${title}</b>`; } } chap.style.opacity = ch;
  let co = 0; for (const [a, b, html] of CAPS) { const o = win(t, a, b, .45); if (o > co) { co = o; if (cap.dataset.h !== html) { cap.innerHTML = html; cap.dataset.h = html; } } } cap.style.opacity = co;
  const placed = []; // labels that would overlap an earlier one ease upward, and their stem grows to keep pointing at the animal
  for (const [t0, k] of LBL) {
    const o = win(t, t0, 16.4, .4), el = lblEl[k]; el.style.opacity = o;
    if (o <= 0) { lblOff[k] = 0; continue; }
    if (!lblWho[k]) lblWho[k] = pick(k);
    const [x, y0] = where(lblWho[k]), y = y0 - 28, w = el.offsetWidth, h = el.offsetHeight;
    let want = 0;
    for (let it = 0; it < 6; it++) {
      const hit = placed.find(p => x - w / 2 < p.r + 8 && x + w / 2 > p.l - 8 && y + want - h < p.b + 6 && y + want > p.t - 6);
      if (!hit) break; want = hit.t - 6 - y;
    }
    lblOff[k] = (lblOff[k] || 0) + (want - (lblOff[k] || 0)) * .35;
    el.style.left = x + 'px'; el.style.top = (y + lblOff[k]) + 'px'; el.style.setProperty('--stem', (16 - lblOff[k]) + 'px');
    placed.push({ l: x - w / 2, r: x + w / 2, t: y + lblOff[k] - h, b: y + lblOff[k] });
  }
  const cp = win(t, 17.5, 29.3, .6);
  copy.style.opacity = cp; $('lagoon').style.filter = cp > 0 ? `saturate(${1 - .5 * cp}) brightness(${1 - .12 * cp})` : '';
  drawTrails(t);
  const ho = win(t, 35.0, 53.6, .6); hud.style.opacity = ho; if (ho > 0) hudUpdate(t);
  return S.state().gen;
} };
document.getElementById('imag').checked = false;
return 1;
})()
"""


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--seed', default='11')
    ap.add_argument('--warm', type=float, default=60, help='seconds of learning before the film starts')
    ap.add_argument('--url', default='http://localhost:8000/'); ap.add_argument('--until', type=float, default=DUR)
    a = ap.parse_args()
    frames = os.path.join(a.out, 'frames'); shutil.rmtree(frames, ignore_errors=True); os.makedirs(frames)
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    prof = tempfile.mkdtemp(prefix='aquatic_film_')
    proc = subprocess.Popen([CHROME, '--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars',
                             '--no-first-run', f'--remote-debugging-port={port}', f'--user-data-dir={prof}', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try: tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1)); break
            except Exception: time.sleep(.1)
        c = CDP(next(t for t in tabs if t.get('type') == 'page')['webSocketDebuggerUrl'])
        c.call('Page.enable'); c.call('Runtime.enable')
        c.call('Emulation.setDeviceMetricsOverride', width=1920, height=1080, deviceScaleFactor=1, mobile=False)
        c.call('Page.navigate', url=f'{a.url}?seed={a.seed}&nointro&capture')
        for _ in range(300):
            if c.eval('window.__capReady === true'): break   # the page rebuilds once its fonts are in
            time.sleep(.1)
        c.eval('document.fonts.ready.then(()=>1)')
        c.eval(FILM_JS)
        for _ in range(int(a.warm * FPS)): c.eval(f'__aquatic.capStep({1 / FPS})')
        n = int(min(a.until, DUR) * FPS)
        for f in range(n):
            gen = c.eval(f'__film.frame({f / FPS})')
            img = c.call('Page.captureScreenshot', format='jpeg', quality=92)
            open(os.path.join(frames, f'{f:05d}.jpg'), 'wb').write(base64.b64decode(img['data']))
            if f % 300 == 0: print('frame', f, '/', n, 'generation', gen, flush=True)
    finally:
        proc.kill(); shutil.rmtree(prof, ignore_errors=True)
    out = os.path.join(a.out, 'aquatic_rsi_film.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(frames, '%05d.jpg'),
                    '-vf', 'colorspace=ispace=bt470bg:iprimaries=bt709:itrc=bt709:irange=pc:space=bt709:primaries=bt709:trc=bt709:range=tv:format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
                    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], check=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
