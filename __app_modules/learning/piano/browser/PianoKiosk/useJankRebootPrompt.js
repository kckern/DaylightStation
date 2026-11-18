import { reboot as kioskReboot } from '../../../../../frontend/src/lib/fkb.js';
import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { DEFAULT_BEAT_URL } from './useRenderWatchdog.js';
import { SNOOZE_KEY, RECOVERY_KEY, shouldPrompt, recoveryVerified, recoveryRequestValid } from './jankRebootLogic.js';

// Stable dependencies: a normal render must never restart the observation window.
const wallNow = () => Date.now();
const monotonicNow = () => performance.now();
async function readNativeStatus() {
  const response = await fetch(DEFAULT_BEAT_URL.replace(/\/beat$/, ''), {
    method: 'GET', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('Native readback unavailable');
  return response.json();
}
function requestReboot() {
  let failure;
  const accepted = kioskReboot({ onError: error => { failure = error; } });
  if (failure) throw failure;
  if (!accepted) {
    getLogger().child({ component: 'piano-jank-reboot' }).error('piano.jank-reboot.no-fully', {});
    return false;
  }
  return true;
}
function readStored(key) {
  try { return window.localStorage?.getItem(key); } catch { return null; }
}
function readRequest() {
  const stored = readStored(RECOVERY_KEY);
  if (stored == null) return null;
  // Keep invalid-but-present records actionable, including JSON false and zero.
  try {
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/** User-requested recovery only. No reload, navigation, work reset, or automatic reboot.
 * Monotonic elapsed time measures visible degradation; wall time persists the 1h snooze.
 * Readback contains no credential or authority grant. Native unknown/Stop denies action.
 */
export function useJankRebootPrompt({
  minFps = 12, sustainSec = 60, snoozeMs = 60 * 60 * 1000,
  now = wallNow, elapsedNow = monotonicNow, reboot = requestReboot, readStatus = readNativeStatus,
} = {}) {
  const [open, setOpen] = useState(false);
  const [recovery, setRecovery] = useState({ status: 'idle' });
  const openRef = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const request = useRef(readRequest());
  // Convert persisted wall deadlines once per page lifetime; wall adjustments must
  // not shorten a live snooze or change the recovery correlation deadline.
  const clockOrigin = useRef({ wall: now(), elapsed: elapsedNow() });
  const snoozeDeadline = useRef(null);
  if (snoozeDeadline.current === null) {
    const until = Number(readStored(SNOOZE_KEY));
    snoozeDeadline.current = elapsedNow() + Math.max(0, Number.isFinite(until) ? until - now() : 0);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const show = useCallback(state => {
    if (!mounted.current) return;
    openRef.current = true;
    setOpen(true);
    setRecovery(state);
  }, []);

  useEffect(() => {
    if (typeof window.requestAnimationFrame !== 'function') return undefined;
    let frames = 0;
    let windowStart = elapsedNow();
    let lowMs = 0;
    let rafId;
    const reset = () => { frames = 0; lowMs = 0; windowStart = elapsedNow(); };
    const loop = () => {
      frames += 1;
      const t = elapsedNow();
      const duration = t - windowStart;
      if (duration >= 1000) {
        const fps = frames * 1000 / duration;
        frames = 0;
        windowStart = t;
        lowMs = document.visibilityState === 'visible' && fps < minFps ? lowMs + duration : 0;
        if (!openRef.current && shouldPrompt({
          sustainedLowSec: lowMs / 1000, sustainSec,
          snoozeUntilMs: snoozeDeadline.current, nowMs: t, alreadyOpen: false,
        })) {
          show({ status: 'idle' });
          getLogger().child({ component: 'piano-jank-reboot' })
            .warn('piano.jank-reboot.prompt', { fps: Math.round(fps), visibleLowMs: lowMs });
        }
      }
      rafId = window.requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', reset);
    rafId = window.requestAnimationFrame(loop);
    return () => { window.cancelAnimationFrame(rafId); document.removeEventListener('visibilitychange', reset); };
  }, [minFps, sustainSec, elapsedNow, show]);

  const onCheckRecovery = useCallback(async () => {
    if (busy.current || !request.current) return;
    busy.current = true;
    const expireRequest = () => {
      request.current = null;
      try { window.localStorage.removeItem(RECOVERY_KEY); } catch { /* retry remains available */ }
      show({ status: 'expired' });
    };
    const correlatedTime = () => clockOrigin.current.wall + elapsedNow() - clockOrigin.current.elapsed;
    try {
      if (!recoveryRequestValid(request.current, correlatedTime())) { expireRequest(); return; }
      const evidence = await readStatus();
      const correlatedNow = correlatedTime();
      if (!recoveryRequestValid(request.current, correlatedNow)) { expireRequest(); return; }
      const verified = recoveryVerified(request.current, evidence, correlatedNow);
      show({ status: verified ? 'verified' : 'unverified' });
      if (verified) { window.localStorage.removeItem(RECOVERY_KEY); request.current = null; }
    } catch {
      if (!recoveryRequestValid(request.current, correlatedTime())) expireRequest();
      else show({ status: 'unverified' });
    }
    finally { busy.current = false; }
  }, [readStatus, elapsedNow, show]);

  // One read on remount, then explicit user checks. Never retry native commands.
  useEffect(() => { if (request.current) void onCheckRecovery(); }, [onCheckRecovery]);

  const onReboot = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    show({ status: 'checking' });
    try {
      const before = await readStatus();
      if (!mounted.current) return;
      if (before.nativeRecoveryAllowed !== true) throw new Error('Native safety unavailable or Stop active');
      request.current = {
        deviceId: before.deviceId, bootCount: before.bootCount,
        bootIdentitySource: before.bootIdentitySource, requestedAtMs: now(),
      };
      clockOrigin.current = { wall: request.current.requestedAtMs, elapsed: elapsedNow() };
      // Keep correlation across page/process death. Learner artifacts retain their
      // existing owners and persistence; this record never restores child content.
      window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(request.current));
      const accepted = await reboot();
      if (accepted === false) throw new Error('Reboot rejected');
      show({ status: 'requested' });
      getLogger().child({ component: 'piano-jank-reboot' }).warn('piano.jank-reboot.requested', {});
    } catch (error) {
      getLogger().child({ component: 'piano-jank-reboot' }).error('piano.jank-reboot.reboot-failed', { error: error?.message });
      request.current = null;
      try { window.localStorage.removeItem(RECOVERY_KEY); } catch { /* failure stays visible */ }
      show({ status: 'failed' });
    } finally { busy.current = false; }
  }, [readStatus, reboot, now, elapsedNow, show]);

  const onDismiss = useCallback(() => {
    snoozeDeadline.current = elapsedNow() + snoozeMs;
    try { window.localStorage?.setItem(SNOOZE_KEY, String(now() + snoozeMs)); } catch { /* best effort */ }
    openRef.current = false;
    setOpen(false);
  }, [now, elapsedNow, snoozeMs]);

  return { open, onReboot, onDismiss, onCheckRecovery, recovery, recoveryVerified: recovery.status === 'verified' };
}

export default useJankRebootPrompt;
