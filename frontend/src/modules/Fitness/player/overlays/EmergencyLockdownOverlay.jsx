import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './EmergencyLockdownOverlay.scss';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { getCueAudioElement, primeCueAudio } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';
import { useIdentity } from '@/modules/Fitness/identity/IdentityProvider';
import UnlockPrompt from '@/modules/Fitness/player/overlays/UnlockPrompt.jsx';

// Inline the power glyph so `currentColor` + CSS glow apply (a plain <img> can't
// inherit color or take a drop-shadow on the glyph itself). Path copied from
// player/overlays/assets/power-off.svg (viewBox 0 0 512 512, fill currentColor).
const POWER_PATH =
  'M400 54.1c63 45 104 118.6 104 201.9 0 136.8-110.8 247.7-247.5 248C120 504.3 8.2 393 8 256.4 7.9 173.1 48.9 99.3 111.8 54.2c11.7-8.3 28-4.8 35 7.7L162.6 90c5.9 10.5 3.1 23.8-6.6 31-41.5 30.8-68 79.6-68 134.9-.1 92.3 74.5 168.1 168 168.1 91.6 0 168.6-74.2 168-169.1-.3-51.8-24.7-101.8-68.1-134-9.7-7.2-12.4-20.5-6.5-30.9l15.8-28.1c7-12.4 23.2-16.1 34.8-7.8zM296 264V24c0-13.3-10.7-24-24-24h-32c-13.3 0-24 10.7-24 24v240c0 13.3 10.7 24 24 24h32c13.3 0 24-10.7 24-24z';

function PowerGlyph({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={POWER_PATH} />
    </svg>
  );
}

const HOLD_MS = 3000;

// The ceremony stays on screen for at least this long even when the powerdown
// audio is shorter (or blocked) — a deliberate window to read "LOCKDOWN
// INITIATED" and abort. Drives commit timing instead of the audio 'ended' event.
const MIN_CEREMONY_MS = 10000;
// Assumed powerdown length when the cue element's duration isn't known yet.
const AUDIO_FALLBACK_MS = 8000;
// Lock id presented to the unlock modal to abort an in-progress shutdown. Matches
// the backend EMERGENCY_LOCK group, so an emergency-authorized finger grants it.
const ABORT_LOCK = 'emergency';

/**
 * Full-screen DEFCON emergency-lockdown overlay for the Fitness kiosk.
 *
 * Renders nothing in the 'normal' phase. In 'triggering' it runs a powerdown
 * ceremony (audio + a minimum-duration abort window) and commits to a lock when
 * that window elapses — unless aborted via a fresh fingerprint in the unlock
 * modal. In 'locked' it shows an inert lockdown screen that releases via a 3s
 * press-and-hold (server admin scan).
 *
 * @param {{ audioPath?: string }} props
 */
export default function EmergencyLockdownOverlay({ audioPath = 'apps/fitness/ux/powerdown.mp3' }) {
  const logger = useMemo(() => getLogger().child({ component: 'emergency' }), []);
  const {
    phase, lockedUntil, commit, abort, release,
    registerUnlock, clearUnlock, unlockState, unlockedUser,
  } = useIdentity();

  if (phase === 'normal') return null;
  if (phase === 'triggering') {
    return (
      <TriggeringScreen
        audioPath={audioPath}
        commit={commit}
        abort={abort}
        registerUnlock={registerUnlock}
        clearUnlock={clearUnlock}
        unlockState={unlockState}
        unlockedUser={unlockedUser}
        logger={logger}
      />
    );
  }
  return <LockedScreen lockedUntil={lockedUntil} release={release} logger={logger} />;
}

function TriggeringScreen({ audioPath, commit, abort, registerUnlock, clearUnlock, unlockState, unlockedUser, logger }) {
  const [progress, setProgress] = useState(0); // 0..1
  const [cancelling, setCancelling] = useState(false); // unlock modal open to abort

  const cancelledRef = useRef(false);   // confirmed abort — suppress commit
  const completedRef = useRef(false);   // ceremony already resolved (commit/abort)
  const audioRef = useRef(null);

  // Time-based ceremony clock (so the window holds even if audio is short/blocked).
  const startRef = useRef(0);           // performance.now() at ceremony start
  const pauseAccumRef = useRef(0);      // total paused ms (while the abort modal is open)
  const pauseStartRef = useRef(null);   // performance.now() when the current pause began

  const pauseCeremony = useCallback(() => {
    if (pauseStartRef.current == null) {
      pauseStartRef.current = performance.now();
      try { audioRef.current?.pause(); } catch { /* noop */ }
    }
  }, []);

  const resumeCeremony = useCallback(() => {
    if (pauseStartRef.current != null) {
      pauseAccumRef.current += performance.now() - pauseStartRef.current;
      pauseStartRef.current = null;
      // Resume only the visual countdown — NOT the powerdown SFX. Once the operator
      // has opened the abort modal and dismissed it (a canceled abort), re-blaring the
      // powerdown audio is jarring and misleading. The audio stays silenced for the
      // remainder of the ceremony; the cleanup still pauses it on unmount.
    }
  }, []);

  // Drive the powerdown ceremony: play audio, advance a time-based progress bar,
  // and commit once the (pause-adjusted) window elapses — unless aborted. The
  // window is max(audio duration, MIN_CEREMONY_MS), so a short powerdown clip
  // still leaves a deliberate ~10s window to read the screen and abort.
  useEffect(() => {
    let raf = null;
    const audio = getCueAudioElement();
    audioRef.current = audio;
    startRef.current = performance.now();
    pauseAccumRef.current = 0;
    pauseStartRef.current = null;

    const finish = (reason) => {
      if (completedRef.current) return;
      completedRef.current = true;
      if (raf) cancelAnimationFrame(raf);
      logger.info('emergency.ceremony_end', { reason, cancelled: cancelledRef.current });
      if (!cancelledRef.current) {
        commit().catch(() => {});
      }
    };

    const windowMs = () => {
      const durMs = (audio && isFinite(audio.duration) && audio.duration > 0)
        ? audio.duration * 1000
        : AUDIO_FALLBACK_MS;
      return Math.max(durMs, MIN_CEREMONY_MS);
    };

    const tick = () => {
      // Frozen while the abort modal is open — the countdown can't auto-commit
      // out from under an in-progress cancel.
      if (pauseStartRef.current == null) {
        const elapsed = performance.now() - startRef.current - pauseAccumRef.current;
        const w = windowMs();
        setProgress(Math.min(1, elapsed / w));
        if (elapsed >= w) { finish('window-elapsed'); return; }
      }
      raf = requestAnimationFrame(tick);
    };

    logger.info('emergency.triggering', { audioPath, minMs: MIN_CEREMONY_MS });

    if (audio) {
      try {
        primeCueAudio('emergency-triggering');
        audio.src = DaylightMediaPath('/media/' + audioPath);
        audio.currentTime = 0;
        audio.muted = false;
        audio.volume = 1;
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => logger.info('emergency.audio_playing', { audioPath }))
            .catch((err) => {
              // Autoplay gated on a gesture-less kiosk — the time-based window
              // still drives the ceremony to commit.
              logger.warn('emergency.audio_blocked', { name: err?.name ?? null });
            });
        }
      } catch (err) {
        logger.warn('emergency.audio_threw', { message: err?.message ?? null });
      }
    }

    raf = requestAnimationFrame(tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (audio) {
        try { audio.pause(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPath]);

  // Cancel → require a FRESH fingerprint via the unlock modal. The original
  // trigger scan's pending detection is NOT reused: abort() only fires after a
  // new authorized scan grants the modal. The ceremony is paused while the modal
  // is open so it can't commit mid-abort; a dismissed/denied modal resumes it.
  const handleCancel = useCallback(async () => {
    if (cancelling || completedRef.current || cancelledRef.current) return;
    setCancelling(true);
    pauseCeremony();
    logger.info('emergency.cancel_scan_open', {});
    const verdict = await registerUnlock(ABORT_LOCK);
    if (verdict?.matched) {
      cancelledRef.current = true;
      logger.info('emergency.cancel_confirmed', { userId: verdict.userId ?? null });
      try { await abort(); } finally { clearUnlock(); }
      // abort() → enterNormal() inside the hook unmounts this screen on success.
    } else {
      logger.info('emergency.cancel_dismissed', { reason: verdict?.reason ?? null });
      setCancelling(false);
      resumeCeremony();
    }
  }, [cancelling, registerUnlock, abort, clearUnlock, pauseCeremony, resumeCeremony, logger]);

  // Modal Cancel/Close/Escape/timeout — resolves registerUnlock with a dismissal,
  // which routes back through handleCancel's else-branch to resume the ceremony.
  const dismissCancel = useCallback(() => { clearUnlock(); }, [clearUnlock]);

  return (
    <div className="emergency-overlay emergency-overlay--triggering" role="alertdialog" aria-label="System lockdown initiated">
      <div className="emergency-vignette" />
      <div className="emergency-stack">
        <PowerGlyph className="emergency-glyph emergency-glyph--pulse" />
        <div className="emergency-headline">SYSTEM LOCKDOWN INITIATED</div>
        <div className="emergency-progress">
          <div className="emergency-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
      {!cancelling && (
        <div className="emergency-cancel-zone">
          <button
            type="button"
            className="emergency-cancel"
            onPointerDown={handleCancel}
          >
            Cancel
          </button>
        </div>
      )}
      <UnlockPrompt
        open={cancelling}
        state={unlockState}
        lockLabel="Abort shutdown"
        onCancel={dismissCancel}
        unlockedUser={unlockedUser}
      />
    </div>
  );
}

function LockedScreen({ lockedUntil, release, logger }) {
  const [scanning, setScanning] = useState(false);
  const holdTimerRef = useRef(null);

  const backAt = useMemo(() => {
    if (!lockedUntil) return null;
    try {
      return new Date(lockedUntil * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return null;
    }
  }, [lockedUntil]);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      logger.debug('emergency.hold_cancel', {}); // released before the 3s fired
    }
  }, [logger]);

  const startHold = useCallback(() => {
    if (scanning || holdTimerRef.current) return;
    logger.debug('emergency.hold_start', { holdMs: HOLD_MS });
    holdTimerRef.current = setTimeout(async () => {
      holdTimerRef.current = null;
      setScanning(true);
      logger.info('emergency.release_hold', {});
      const { released } = await release();
      if (!released) {
        logger.info('emergency.release_denied', {});
        setScanning(false);
      }
      // On released, the hook flips to 'normal' and unmounts this screen.
    }, HOLD_MS);
  }, [scanning, release, logger]);

  useEffect(() => () => clearHold(), [clearHold]);

  // Swallow normal taps/keys so the lockdown screen is inert.
  const swallow = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      className="emergency-overlay emergency-overlay--locked"
      role="alertdialog"
      aria-label="Locked"
      onPointerDown={startHold}
      onPointerUp={clearHold}
      onPointerLeave={clearHold}
      onPointerCancel={clearHold}
      onClick={swallow}
      onKeyDown={swallow}
      tabIndex={-1}
    >
      <div className="emergency-vignette" />
      <div className="emergency-stack">
        <PowerGlyph className="emergency-glyph emergency-glyph--dim" />
        <div className="emergency-headline emergency-headline--locked">LOCKED</div>
        {backAt && <div className="emergency-subline">Back at {backAt}</div>}
        {scanning && <div className="emergency-scanning">Scanning…</div>}
      </div>
    </div>
  );
}
