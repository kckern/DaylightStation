import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { SNOOZE_KEY, shouldPrompt } from './jankRebootLogic.js';

/**
 * useJankRebootPrompt — user-controlled recovery for the SM-T590 render latch.
 *
 * Replaces the old silent reload→restart→reboot escalation. It measures frame
 * presentation via requestAnimationFrame (the same signal useRenderWatchdog
 * uses) and, only after rendering has been visibly degraded for a sustained
 * window, opens a modal that lets the user reboot the device or defer. Deferring
 * snoozes the prompt for `snoozeMs` (persisted so a reload can't nag past it),
 * after which it re-arms. The reboot itself goes through Fully's JS interface
 * (`window.fully.reboot`) — a device reboot is the only thing that clears this
 * latch (a page reload and an app restart do not).
 *
 * @param {object} [opts]
 * @param {number} [opts.minFps=12]      below this (while visible) counts as bad
 * @param {number} [opts.sustainSec=60]  seconds of sustained bad render before we ask
 * @param {number} [opts.snoozeMs=3600000] how long "Not now" defers the prompt (1h)
 * @param {() => number} [opts.now]      injectable clock (tests)
 * @param {() => void}  [opts.reboot]    injectable reboot action (tests)
 */
export function useJankRebootPrompt({
  minFps = 12,
  sustainSec = 60,
  snoozeMs = 60 * 60 * 1000,
  now = () => Date.now(),
  reboot,
} = {}) {
  const [open, setOpen] = useState(false);
  // Refs so the rAF loop reads live values without re-subscribing every render.
  const openRef = useRef(false);

  const readSnooze = useCallback(() => {
    try {
      const v = window.localStorage?.getItem(SNOOZE_KEY);
      return v == null ? null : Number(v);
    } catch { return null; }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return undefined;
    const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : now());
    let frames = 0;
    let windowStart = clock();
    let lowSec = 0;
    let rafId;
    const loop = () => {
      frames += 1;
      const t = clock();
      if (t - windowStart >= 1000) {
        const fps = (frames * 1000) / (t - windowStart);
        frames = 0;
        windowStart = t;
        const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
        lowSec = (visible && fps < minFps) ? lowSec + 1 : 0;
        if (!openRef.current && shouldPrompt({
          sustainedLowSec: lowSec, sustainSec, snoozeUntilMs: readSnooze(), nowMs: now(), alreadyOpen: false,
        })) {
          openRef.current = true;
          setOpen(true);
          getLogger().child({ component: 'piano-jank-reboot' })
            .warn('piano.jank-reboot.prompt', { fps: Math.round(fps), sustainSec });
        }
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
  }, [minFps, sustainSec, now, readSnooze]);

  const onReboot = useCallback(() => {
    const log = getLogger().child({ component: 'piano-jank-reboot' });
    log.warn('piano.jank-reboot.reboot', {});
    try {
      if (reboot) { reboot(); return; }
      if (typeof window !== 'undefined' && window.fully && typeof window.fully.reboot === 'function') {
        window.fully.reboot();
      } else {
        log.error('piano.jank-reboot.no-fully', {}); // not in kiosk / no device-admin — can't self-reboot
      }
    } catch (e) {
      log.error('piano.jank-reboot.reboot-failed', { error: e?.message });
    }
  }, [reboot]);

  const onDismiss = useCallback(() => {
    const until = now() + snoozeMs;
    try { window.localStorage?.setItem(SNOOZE_KEY, String(until)); } catch { /* ignore */ }
    getLogger().child({ component: 'piano-jank-reboot' })
      .info('piano.jank-reboot.snooze', { untilMs: until, snoozeMinutes: Math.round(snoozeMs / 60000) });
    openRef.current = false;
    setOpen(false);
  }, [now, snoozeMs]);

  return { open, onReboot, onDismiss };
}

export default useJankRebootPrompt;
