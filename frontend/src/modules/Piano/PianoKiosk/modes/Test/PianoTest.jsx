import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { SideScrollerGame } from '../../../SideScrollerGame/SideScrollerGame.jsx';
import { isWhiteKey } from '../../../noteUtils.js';
import { handleNoteOn, trimHistory } from '../../../noteHistory.js';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';
import { createSimState, stepSim, TEST_DEFAULTS } from './pianoTestStream.js';

/**
 * Piano performance test harness — self-driving, no human at the keyboard.
 * Routes: /piano/test/<scene>/<a>/<b>
 *
 *   latency/<bgNps>/<bgPoly>   (default) — inject a probe note on a cadence and
 *       measure inject→painted-active latency for the keyboard, optionally under
 *       a synthesized background note-stream load. Logs `piano.test.latency`.
 *   keyboard/<nps>/<poly>      — render the keyboard from the bg stream only (paint stress).
 *   scroller                   — run the real SideScrollerGame, drive a white-key
 *       scale sweep (triggers jumps/ducks as it passes the target pitches), and
 *       count FPS via gfxinfo. Logs `piano.test.scroller`.
 *   waterfall/<sweepMs>        — render the real NoteWaterfall under a dense
 *       self-driven note stream and count main-thread FPS with an rAF counter
 *       (gfxinfo can't see the WebView under graphicsAccelerationMode=0). Logs
 *       `piano.test.waterfall` with the live fps every 2s.
 */
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// Beefy single-level config so the game survives the measurement window.
const SCROLLER_CFG = {
  health: 200, damage_per_hit: 1, heal_per_dodge: 2, invincibility_ms: 1200, jump_duration_ms: 900,
  levels: [{ name: 'Bench', note_range: [48, 72], complexity: 'single', scroll_speed: 3, obstacle_interval_ms: 3500, white_keys_only: true }],
};
const SWEEP_NOTES = (() => { const a = []; for (let n = 48; n <= 72; n++) if (isWhiteKey(n)) a.push(n); return a; })();
const NOOP = () => {};

/**
 * Keep-alive: tiny visible muted looping video. autoplay attr alone is unreliable
 * in WebView, so call play() explicitly and log the real state so we can tell
 * whether it actually drives the compositor. Logs `piano.test.keepalive`.
 */
function KeepAlive() {
  const ref = useRef(null);
  const logger = useMemo(() => getLogger().child({ component: 'piano-test' }), []);
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    v.muted = true;
    v.play().then(() => logger.info('piano.test.keepalive', { state: 'play-ok' }))
      .catch((e) => logger.warn('piano.test.keepalive', { state: 'play-rejected', err: e?.name }));
    const onPlaying = () => logger.info('piano.test.keepalive', { state: 'playing', t: Math.round(v.currentTime * 100) / 100 });
    const onError = () => logger.warn('piano.test.keepalive', { state: 'error', code: v.error?.code });
    const tick = setInterval(() => logger.info('piano.test.keepalive', { state: 'tick', t: Math.round(v.currentTime * 100) / 100, paused: v.paused }), 3000);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);
    return () => { clearInterval(tick); v.removeEventListener('playing', onPlaying); v.removeEventListener('error', onError); };
  }, [logger]);
  return (
    <video
      ref={ref}
      src="/keepalive.mp4"
      autoPlay loop muted playsInline
      style={{ position: 'fixed', bottom: 0, right: 0, width: 6, height: 6, opacity: 0.02, pointerEvents: 'none', zIndex: 1 }}
    />
  );
}

/**
 * Waterfall stress scene — mounts the real NoteWaterfall (which runs its own
 * per-frame rAF re-render) and floods it with a dense, self-driving note stream
 * so the screen stays full of falling notes. A second rAF counts presented frames
 * and logs the effective FPS every 2s as `piano.test.waterfall` — the direct
 * answer to "is the waterfall janky", independent of gfxinfo.
 */
function WaterfallScene({ sweepMs, holdMs, lo, hi }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-test' }), []);
  const startNote = 21;
  const endNote = 108;
  const [history, setHistory] = useState([]);
  const histRef = useRef([]);

  // Dense stream: add a note every sweepMs, spread across the range, auto-closing
  // notes once they exceed holdMs so the on-screen population stays high but bounded.
  useEffect(() => {
    let i = 0;
    const span = Math.max(1, hi - lo);
    const id = setInterval(() => {
      const now = Date.now();
      const note = lo + ((i * 7) % (span + 1));
      i += 1;
      let h = handleNoteOn(histRef.current, note, 70 + (i % 50), now);
      h = h.map((n) => (!n.endTime && now - n.startTime > holdMs ? { ...n, endTime: n.startTime + holdMs } : n));
      h = trimHistory(h, now);
      histRef.current = h;
      setHistory(h);
    }, sweepMs);
    return () => clearInterval(id);
  }, [sweepMs, holdMs, lo, hi]);

  const activeNotes = useMemo(() => {
    const m = new Map();
    for (const n of history) if (!n.endTime) m.set(n.note, { velocity: n.velocity, timestamp: n.startTime });
    return m;
  }, [history]);

  // rAF FPS counter — frames presented per 2s window → effective FPS.
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    let mounted = true;
    const tick = () => {
      frames += 1;
      const t = performance.now();
      if (t - last >= 2000) {
        const v = Math.round((frames / (t - last)) * 1000 * 10) / 10;
        setFps(v);
        logger.info('piano.test.waterfall', { fps: v, notes: histRef.current.length, active: activeNotes.size, sweepMs });
        frames = 0;
        last = t;
      }
      if (mounted) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { mounted = false; cancelAnimationFrame(raf); };
  }, [logger, activeNotes.size, sweepMs]);

  return (
    <div className="piano-test piano-test--waterfall" data-testid="piano-test">
      <div className="piano-test-hud" data-testid="piano-test-hud">
        <div><b>NOTE-WATERFALL FPS TEST</b></div>
        <div>stream every {sweepMs}ms · notes={history.length} · active={activeNotes.size}</div>
        <div>FPS (rAF, last 2s): <b>{fps}</b></div>
      </div>
      <div className="piano-test__waterfall-stage" style={{ position: 'fixed', inset: 0, background: 'var(--piano-viz-bg, #07080f)' }}>
        <NoteWaterfall noteHistory={history} activeNotes={activeNotes} startNote={startNote} endNote={endNote} />
      </div>
    </div>
  );
}

export default function PianoTest() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-test' }), []);
  const { '*': splat = '' } = useParams();
  const [sp] = useSearchParams();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const { setPlaying } = usePianoPlayback();

  const params = useMemo(() => {
    const seg = splat.split('/').filter(Boolean);
    const numAt = (i, key, def) => {
      const raw = (i != null ? seg[i] : undefined) ?? sp.get(key);
      const n = Number(raw);
      return raw != null && raw !== '' && Number.isFinite(n) ? n : def;
    };
    return {
      scene: seg[0] || sp.get('scene') || 'latency',
      bgNps: numAt(1, 'nps', 0),
      bgPoly: numAt(2, 'poly', 8),
      probeMs: numAt(null, 'probeMs', 200),
      probeNote: numAt(null, 'note', 60),
      sweepMs: numAt(null, 'sweepMs', 140),
      keepalive: numAt(null, 'keepalive', 0),
      holdMs: numAt(null, 'hold', TEST_DEFAULTS.holdMs),
      lo: numAt(null, 'lo', TEST_DEFAULTS.lo),
      hi: numAt(null, 'hi', TEST_DEFAULTS.hi),
      seed: numAt(null, 'seed', TEST_DEFAULTS.seed),
    };
  }, [splat, sp]);

  const [active, setActive] = useState(() => new Map());
  const [hud, setHud] = useState({ n: 0, last: 0, avg: 0, p50: 0, p95: 0, max: 0 });
  const bgRef = useRef(null);
  const probeRef = useRef({ t0: 0, awaiting: false });
  const samples = useRef([]);

  useEffect(() => { setPlaying(true); return () => setPlaying(false); }, [setPlaying]);

  // ── scroller scene: white-key scale sweep drives jumps/ducks ──
  useEffect(() => {
    if (params.scene !== 'scroller') return undefined;
    let i = 0;
    const id = setInterval(() => {
      const note = SWEEP_NOTES[i % SWEEP_NOTES.length];
      i += 1;
      setActive(new Map([[note, { velocity: 100, timestamp: Date.now() }]]));
    }, params.sweepMs);
    logger.info('piano.test.scroller', { sweepMs: params.sweepMs, notes: SWEEP_NOTES.length });
    return () => clearInterval(id);
  }, [params, logger]);

  // ── background note stream (keyboard/latency-under-load) ──
  useEffect(() => {
    if (params.scene === 'scroller') return undefined;
    if (!(params.bgNps > 0)) { setActive((prev) => (prev.size ? new Map() : prev)); return undefined; }
    bgRef.current = createSimState(params);
    const id = setInterval(() => {
      const st = stepSim(bgRef.current, Date.now(), { nps: params.bgNps, poly: params.bgPoly, holdMs: params.holdMs, lo: params.lo, hi: params.hi });
      setActive(() => {
        const m = new Map(st.active);
        if (probeRef.current.awaiting) m.set(params.probeNote, { velocity: 110, timestamp: Date.now() });
        return m;
      });
    }, 33);
    return () => clearInterval(id);
  }, [params]);

  // ── latency probe: inject note, measure inject→painted-active ──
  useEffect(() => {
    if (params.scene !== 'latency') return undefined;
    const inject = setInterval(() => {
      probeRef.current.t0 = performance.now();
      probeRef.current.awaiting = true;
      setActive((prev) => { const m = new Map(prev); m.set(params.probeNote, { velocity: 110, timestamp: Date.now() }); return m; });
      requestAnimationFrame(() => {
        const lat = performance.now() - probeRef.current.t0;
        probeRef.current.awaiting = false;
        const s = samples.current;
        s.push(lat);
        if (s.length > 300) s.shift();
        setActive((prev) => { const m = new Map(prev); m.delete(params.probeNote); return m; });
      });
    }, params.probeMs);
    return () => clearInterval(inject);
  }, [params]);

  // ── roll up + log latency stats every 2s ──
  useEffect(() => {
    if (params.scene !== 'latency') return undefined;
    const id = setInterval(() => {
      const s = samples.current;
      if (!s.length) return;
      const avg = Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10;
      const stats = { n: s.length, last: Math.round(s[s.length - 1] * 10) / 10, avg, p50: Math.round(pct(s, 50) * 10) / 10, p95: Math.round(pct(s, 95) * 10) / 10, max: Math.round(Math.max(...s) * 10) / 10 };
      setHud(stats);
      logger.info('piano.test.latency', { bgNps: params.bgNps, bgPoly: params.bgPoly, probeMs: params.probeMs, ...stats });
    }, 2000);
    return () => clearInterval(id);
  }, [params, logger]);

  // Keep-alive: a tiny visible muted looping video. A playing <video> drives the
  // compositor to present a new frame every vsync via the media path, a known
  // workaround for the WebView BeginFrame/rAF stall. Must be technically visible
  // (not display:none / opacity:0) to force compositing.
  const keepEl = params.keepalive ? <KeepAlive /> : null;

  if (params.scene === 'waterfall') {
    return (
      <>
        {keepEl}
        <WaterfallScene sweepMs={params.sweepMs} holdMs={params.holdMs} lo={params.lo} hi={params.hi} />
      </>
    );
  }

  if (params.scene === 'scroller') {
    return (
      <div className="piano-test piano-test--scroller" data-testid="piano-test">
        {keepEl}
        <div className="piano-test-hud" data-testid="piano-test-hud">
          <div><b>SIDE-SCROLLER FPS TEST</b></div>
          <div>white-key sweep every {params.sweepMs}ms · active={active.size}</div>
          <div>FPS measured via gfxinfo (Total frames / window)</div>
        </div>
        <SideScrollerGame activeNotes={active} gameConfig={SCROLLER_CFG} onDeactivate={NOOP} onNoteOn={NOOP} onNoteOff={NOOP} />
      </div>
    );
  }

  return (
    <div className="piano-test" data-testid="piano-test">
      {keepEl}
      <div className="piano-test-hud" data-testid="piano-test-hud">
        <div><b>{params.scene === 'latency' ? 'KEYBOARD LATENCY TEST' : 'KEYBOARD PAINT TEST'}</b> — scene={params.scene}</div>
        <div>bg load={params.bgNps}nps/{params.bgPoly} · {params.scene === 'latency' ? `probe ${params.probeMs}ms · ` : ''}active={active.size}</div>
        {params.scene === 'latency' && (
          <div>n={hud.n} last={hud.last} avg={hud.avg} p50={hud.p50} <b>p95={hud.p95}</b> max={hud.max} ms</div>
        )}
      </div>
      <div className="piano-test__keys piano-test__keys--full">
        <PianoKeyboard activeNotes={active} startNote={kb.startNote} endNote={kb.endNote} />
      </div>
    </div>
  );
}
