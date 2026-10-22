#!/usr/bin/env python3
"""Record the Ocean Shallows promo frame by frame from the real simulation.

The page is opened with ?capture, which turns off its real-time loop; this script advances the lagoon by exact
1/fps steps over the Chrome DevTools protocol and screenshots each frame, so the video is smooth on any machine.
Nothing is staged: the rays learn live during the warm-up and the recording, exactly as on the page.

usage:  cd web && python3 -m http.server 8000          (in another terminal)
        python3 tools/record_video.py out/ [--seed 11] [--w 1920 --h 1080] [--fps 30] [--warm 60]
needs:  Google Chrome, ffmpeg, and `pip install websocket-client`
"""
import argparse, base64, json, os, shutil, socket, subprocess, tempfile, time, urllib.request
import websocket

CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=60, suppress_origin=True); self.i = 0

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


# Title card, captions and end card: plain DOM on top of the page; the controls are hidden for the film.
OVERLAY = r"""
(()=>{const st=document.createElement('style');st.textContent=`
.bar,.hint,.show,.toast,.ra-btn,.tag{display:none!important}
#vcap{position:fixed;left:32px;bottom:36px;z-index:20;max-width:900px;padding:28px 48px 28px 24px;background:radial-gradient(farthest-side at 45% 50%,rgba(6,26,40,.52),rgba(6,26,40,0));font:500 34px/1.3 Inter,system-ui,sans-serif;color:#fff;
  text-shadow:0 2px 18px rgba(0,20,40,.55);opacity:0;transition:opacity .5s}
#vcap b{font-weight:700}
#vcard{position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:radial-gradient(ellipse at center,rgba(8,30,44,.55),rgba(8,30,44,.82));color:#fff;opacity:0;transition:opacity .6s;text-align:center}
#vcard h1{font:500 96px/1 Newsreader,Georgia,serif;margin:0;letter-spacing:-.01em}
#vcard h1 i{font-style:italic}
#vcard p{font:500 30px/1.35 Inter,system-ui,sans-serif;margin:0;color:#dce8f3}
#vcard small{font:500 25px Inter,system-ui,sans-serif;color:#BFD8EC;letter-spacing:.02em}
.evo{transform:scale(1.35);transform-origin:left top;transition:transform .7s ease,box-shadow .6s}
.evo.hl{transform:scale(2.3);box-shadow:0 0 0 4px rgba(191,216,236,.6)}
`;document.head.appendChild(st);
for(const id of ['vcap','vcard']){const d=document.createElement('div');d.id=id;document.body.appendChild(d)}return 1})()
"""
TITLE = "<h1>Ocean <i>Shallows</i></h1><p>Agents that teach themselves</p><small>Multi-agent self-improvement with a world model</small>"
END = "<h1>Ocean <i>Shallows</i></h1><p>jiajunfan.com/lab/shallows</p><small>Jiajun Fan · UIUC</small>"
# (seconds into the film, action); blooms are at fractions of the lagoon's width and height
SCRIPT = [
    (0.0, ('card', TITLE)), (3.6, ('card', None)),
    (4.6, ('cap', "<b>Many agents</b> share one lagoon: rays, jellies and schools of fish.")), (10.4, ('cap', None)),
    (11.0, ('cap', "Plankton blooms where you tap. <b>Rays and fish race</b> for the same food.")),
    (11.4, ('bloom', .58, .52)), (14.2, ('bloom', .36, .40)), (17.0, ('bloom', .72, .34)), (19.4, ('cap', None)),
    (20.2, ('cap', "Every 1.5 s each ray species copies the lagoon, <b>a world model</b>, and imagines 16 practice swims.")),
    (29.4, ('cap', None)), (30.4, ('hl', True)),
    (30.6, ('cap', "It keeps what worked and <b>learns how boldly to practise</b>. Nothing is pre-trained.")),
    (37.6, ('cap', None)), (37.8, ('hl', False)),
    (38.4, ('card', END)),
]
DUR = 42.0
IMAGINE = (20.0, 30.2)   # the imagined practice swims fade in and out over this span, drawn a little stronger for video
# CSS fades run on the wall clock, but a recorded frame takes far longer than 1/30 s, so every running animation
# is paused and moved on by exactly one frame before each screenshot.
STEP_ANIMS = "(()=>{for(const a of document.getAnimations()){a.pause();a.__f=(a.__f||0)+1;a.currentTime=(a.__f-1)*%f}return 1})()"


def action(c, act):
    kind = act[0]
    if kind == 'card':
        c.eval(f"(()=>{{const k=document.getElementById('vcard');if({json.dumps(bool(act[1]))})k.innerHTML={json.dumps(act[1] or '')};k.style.opacity={1 if act[1] else 0};return 1}})()")
    elif kind == 'cap':
        c.eval(f"(()=>{{const k=document.getElementById('vcap');if({json.dumps(bool(act[1]))})k.innerHTML={json.dumps(act[1] or '')};k.style.opacity={1 if act[1] else 0};return 1}})()")
    elif kind == 'bloom':
        c.eval(f'__shallows.bloomAt(__shallows.E.W*{act[1]}, __shallows.E.H*{act[2]})')
    elif kind == 'hl':
        c.eval(f"document.getElementById('evo').classList.toggle('hl',{str(act[1]).lower()});1")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--seed', default='11')
    ap.add_argument('--w', type=int, default=1920); ap.add_argument('--h', type=int, default=1080)
    ap.add_argument('--fps', type=int, default=30); ap.add_argument('--warm', type=float, default=60, help='seconds of learning before the film starts')
    ap.add_argument('--url', default='http://localhost:8000/')
    a = ap.parse_args()
    frames = os.path.join(a.out, 'frames'); shutil.rmtree(frames, ignore_errors=True); os.makedirs(frames)
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    prof = tempfile.mkdtemp(prefix='shallows_rec_')
    proc = subprocess.Popen([CHROME, '--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars',
                             '--no-first-run', f'--remote-debugging-port={port}', f'--user-data-dir={prof}', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try: tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1)); break
            except Exception: time.sleep(.1)
        c = CDP(next(t for t in tabs if t.get('type') == 'page')['webSocketDebuggerUrl'])
        c.call('Page.enable'); c.call('Runtime.enable')
        c.call('Emulation.setDeviceMetricsOverride', width=a.w, height=a.h, deviceScaleFactor=1, mobile=False)
        c.call('Page.navigate', url=f'{a.url}?seed={a.seed}&nointro&capture')
        for _ in range(100):
            if c.eval('!!window.__shallows'): break
            time.sleep(.1)
        c.eval(OVERLAY)
        c.eval("document.getElementById('imag').checked=false;1")   # the film shows the imagined swims only in their scene
        dt = 1 / a.fps
        for _ in range(int(a.warm * a.fps)): c.eval(f'__shallows.capStep({dt})')
        print('warmed up:', c.eval("document.getElementById('evotxt').textContent"), flush=True)
        si, n = 0, int(DUR * a.fps)
        for f in range(n):
            t = f * dt
            while si < len(SCRIPT) and SCRIPT[si][0] <= t + 1e-9: action(c, SCRIPT[si][1]); si += 1
            ramp = min(1, (t - IMAGINE[0]) / .6, (IMAGINE[1] - t) / .6)
            c.eval(f'window.__showImagined={str(ramp > 0).lower()};window.__imagBoost={max(.02, 2.2 * ramp):.3f};1')
            c.eval(f'__shallows.capStep({dt})')
            c.eval(STEP_ANIMS % (1000 * dt))
            img = c.call('Page.captureScreenshot', format='jpeg', quality=92)
            open(os.path.join(frames, f'{f:05d}.jpg'), 'wb').write(base64.b64decode(img['data']))
        print('end:', c.eval("document.getElementById('evotxt').textContent"), flush=True)
    finally:
        proc.kill(); shutil.rmtree(prof, ignore_errors=True)
    out = os.path.join(a.out, 'ocean_shallows_promo.mp4')
    # JPEG frames are full-range BT.601; convert to the limited-range BT.709 that players and social sites expect
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(a.fps), '-i', os.path.join(frames, '%05d.jpg'),
                    '-vf', 'colorspace=ispace=bt470bg:iprimaries=bt709:itrc=bt709:irange=pc:space=bt709:primaries=bt709:trc=bt709:range=tv:format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
                    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], check=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
