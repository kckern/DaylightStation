import { useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Self-heal watchdog for the Fully Kiosk WebView.
 *
 * On the piano tablet (SM-T590, Android 10, aging Adreno GPU) the renderer's
 * compositor can get stuck after certain navigations — the renderer pegs a CPU
 * core and the page drops to a few fps (JS keeps running, frames stop
 * presenting). A page reload does NOT clear it; only a renderer-process restart
 * does. Fully exposes `window.fully.restartApp()` via its JavaScript Interface,
 * which respawns the WebView cleanly — on-device, no network, survives reboots.
 *
 * This hook watches frame-presentation rate via requestAnimationFrame. When the
 * effective fps stays below `minFps` for `sustainSeconds` consecutive seconds
 * (after a startup grace period), it restarts once and latches — the restart
 * reloads the SPA, remounting this fresh. The decision logic lives in the pure
 * `tickWatchdog` so it is unit-testable without a DOM or real frames.
 */

export const WATCHDOG_DEFAULTS = { minFps: 12, sustainSeconds: 4, graceMs: 8000 };

/**
 * The bridge's heartbeat ingest. localhost is a secure context, so the HTTPS
 * kiosk may POST here despite mixed-content rules (same exemption that lets
 * `ws://localhost:8770` work in usePianoVoiceBridge). The APK's out-of-process
 * KioskWatchdog uses the beat stream as the ONE liveness signal that reflects
 * the WebView's real event-loop health — if the loop starves or the WebView
 * latches, beats slow or stop and the bridge (which survives WebView failure)
 * sees exactly that and self-heals.
 */
export const DEFAULT_BEAT_URL = 'http://localhost:8770/kiosk/beat';

/**
 * Pure builder for a heartbeat payload. Kept separate so it is unit-testable
 * without a DOM. `fps` is frames presented in the last ~1s.
 * @returns {{fps:number, visibility:string, url:string, sinceLoadMs:number, ts:number}}
 */
export function buildBeat(fps, { visibility, url, sinceLoadMs, ts }) {
  return {
    fps: Math.round(fps),
    visibility: visibility || 'unknown',
    url: url || '',
    sinceLoadMs: Math.round(sinceLoadMs) || 0,
    ts: ts || 0,
  };
}

/**
 * Fire-and-forget heartbeat POST. Never throws — a dead/unreachable bridge is
 * itself the signal the bridge infers from beat silence, so failures are mute.
 */
function sendBeat(beatUrl, payload) {
  if (typeof fetch !== 'function') return;
  try {
    fetch(beatUrl, {
      method: 'POST',
      mode: 'no-cors', // opaque response; text/plain body needs no preflight
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      keepalive: true, // survive an unload/navigation so the last beat still lands
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(1500)
        : undefined,
    }).catch(() => { /* bridge down → silence is the DEAD signal */ });
  } catch { /* never let telemetry break the render loop */ }
}

/**
 * Self-heal restart is DISABLED pending root-cause of the SM-T590 frame-clock
 * stall. Field evidence (2026-06): restarting the WebView did NOT recover fps —
 * it stayed ~10fps across restarts, even on a near-empty screen with hardware
 * acceleration on and ~1.5GB RAM free. The restart loop only thrashed the UI
 * (full app remount every ~40s) and polluted telemetry. So the watchdog now
 * runs purely as a passive jank *sensor*: it measures fps and logs episodes
 * (`piano.watchdog.jank-start` / `jank-end`) without touching the WebView.
 * Re-enable — with a restart cap + backoff, and only after a restart is proven
 * to actually recover frame presentation — by flipping this flag.
 */
export const SELF_HEAL_RESTART = false;

/**
 * Pure decision step. Given prior state and the fps observed over the last
 * second, return the next state and whether to fire the self-heal restart.
 * @param {{jankSeconds:number, fired:boolean}} state
 * @param {number} fps - frames presented in the last ~1s
 * @param {{minFps:number, sustainSeconds:number}} opts
 * @returns {{jankSeconds:number, fired:boolean, shouldFire:boolean}}
 */
export function tickWatchdog(state, fps, { minFps, sustainSeconds }) {
  if (state.fired) return { jankSeconds: state.jankSeconds, fired: true, shouldFire: false };
  const jankSeconds = fps < minFps ? state.jankSeconds + 1 : 0;
  const shouldFire = jankSeconds >= sustainSeconds;
  return { jankSeconds, fired: shouldFire, shouldFire };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.minFps=12]
 * @param {number} [opts.sustainSeconds=4]
 * @param {number} [opts.graceMs=8000] - ignore jank during initial load
 * @param {() => void} [opts.onRestart] - override the restart action (tests)
 * @param {string} [opts.beatUrl] - heartbeat ingest URL (default DEFAULT_BEAT_URL)
 * @param {boolean} [opts.heartbeat=true] - post a per-second beat to the bridge
 * @param {(payload:object) => void} [opts.onBeat] - override the beat sender (tests)
 */
export function useRenderWatchdog({
  minFps = WATCHDOG_DEFAULTS.minFps,
  sustainSeconds = WATCHDOG_DEFAULTS.sustainSeconds,
  graceMs = WATCHDOG_DEFAULTS.graceMs,
  onRestart,
  beatUrl = DEFAULT_BEAT_URL,
  heartbeat = true,
  onBeat,
} = {}) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return undefined;
    // The self-heal restart is gated (see SELF_HEAL_RESTART). When enabled it
    // uses Fully's JS Interface or an injected action (tests). When disabled the
    // loop still runs as a passive fps sensor — measuring is cheap and the
    // episode telemetry is how we diagnose the stall.
    const restart = onRestart
      || (SELF_HEAL_RESTART && window.fully && typeof window.fully.restartApp === 'function'
        ? () => { try { window.fully.restartApp(); } catch { /* not fatal */ } }
        : null);

    const logger = getLogger().child({ component: 'piano-watchdog' });
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const startedAt = now();
    let frames = 0;
    let windowStart = startedAt;
    let jankSeconds = 0;
    let inEpisode = false;
    let worstFps = Infinity;
    let rafId;

    const loop = () => {
      frames += 1;
      const t = now();
      if (t - windowStart >= 1000) {
        const fps = (frames * 1000) / (t - windowStart);
        frames = 0;
        windowStart = t;
        // Heartbeat every second, unconditionally (even during the grace window):
        // the bridge needs a continuous liveness stream, and an early beat during
        // load is useful, not noise. Sent BEFORE the jank gate so a starving loop
        // still emits its last few beats.
        if (heartbeat) {
          const payload = buildBeat(fps, {
            visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
            url: typeof location !== 'undefined' ? location.href : '',
            sinceLoadMs: t - startedAt,
            ts: Date.now(),
          });
          if (onBeat) onBeat(payload); else sendBeat(beatUrl, payload);
        }
        if (t - startedAt >= graceMs) {
          if (fps < minFps) {
            jankSeconds += 1;
            worstFps = Math.min(worstFps, fps);
            // Episode begins once jank is sustained — log once, optionally self-heal.
            if (!inEpisode && jankSeconds >= sustainSeconds) {
              inEpisode = true;
              // visibility distinguishes real jank from the ~1fps rAF throttle
              // that applies while the backlight/page is off (screen-off events
              // polluted the 2026-07-01 investigation).
              logger.warn('piano.watchdog.jank-start', {
                fps: Math.round(fps), minFps, sustainSeconds,
                visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
              });
              // Paper trail: one rich snapshot at onset (loopLag vs fps, longTasks,
              // slowEvents, per-component renders, heap, DOM) so we can tell a JS
              // storm from a compositor stall — then densify the perf.diagnostics
              // cadence so the whole episode is captured, not just its start.
              try {
                const root = getLogger();
                logger.warn('piano.jank.snapshot', root.perfSnapshot ? root.perfSnapshot() : {});
                if (root.startDiagnostics) root.startDiagnostics({ intervalMs: 2000 });
              } catch { /* telemetry must never break the render loop */ }
              if (restart) {
                logger.warn('piano.watchdog.restart', { fps: Math.round(fps), minFps, sustainSeconds });
                restart();
              }
            }
          } else {
            if (inEpisode) {
              logger.info('piano.watchdog.jank-end', { fps: Math.round(fps), worstFps: Math.round(worstFps) });
              // Episode over — hand the perf.diagnostics cadence back to the
              // always-on coarse rate (a live side-scroller re-arms its own 5s on
              // the next phase change).
              try {
                const root = getLogger();
                if (root.startDiagnostics) root.startDiagnostics({ intervalMs: 60000 });
              } catch { /* ignore */ }
            }
            jankSeconds = 0;
            inEpisode = false;
            worstFps = Infinity;
          }
        }
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
  }, [minFps, sustainSeconds, graceMs, onRestart, beatUrl, heartbeat, onBeat]);
}

export default useRenderWatchdog;
