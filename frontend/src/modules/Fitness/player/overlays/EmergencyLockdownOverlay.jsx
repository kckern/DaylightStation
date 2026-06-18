import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './EmergencyLockdownOverlay.scss';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { getCueAudioElement, primeCueAudio } from '@/modules/Fitness/player/hooks/audioCuePlayer.js';
import { useEmergencyLockdown } from '@/modules/Fitness/hooks/useEmergencyLockdown.js';

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

/**
 * Full-screen DEFCON emergency-lockdown overlay for the Fitness kiosk.
 *
 * Renders nothing in the 'normal' phase. In 'triggering' it runs a powerdown
 * ceremony (audio + cancel window) and commits to a lock when the audio ends
 * (or a fallback timer fires). In 'locked' it shows an inert lockdown screen
 * that releases via a 3s press-and-hold (server admin scan).
 *
 * @param {{ audioPath?: string }} props
 */
export default function EmergencyLockdownOverlay({ audioPath = 'apps/fitness/ux/powerdown.mp3' }) {
  const logger = useMemo(() => getLogger().child({ component: 'emergency' }), []);
  const { phase, lockedUntil, commit, abort, release } = useEmergencyLockdown();

  if (phase === 'normal') return null;
  if (phase === 'triggering') {
    return <TriggeringScreen audioPath={audioPath} commit={commit} abort={abort} logger={logger} />;
  }
  return <LockedScreen lockedUntil={lockedUntil} release={release} logger={logger} />;
}

function TriggeringScreen({ audioPath, commit, abort, logger }) {
  const [progress, setProgress] = useState(0); // 0..1
  const [audioPlaying, setAudioPlaying] = useState(true); // cancel shown while audio plays
  const [cancelArmed, setCancelArmed] = useState(false); // tapped Cancel → "scan to confirm"
  const [scanning, setScanning] = useState(false);

  const cancelledRef = useRef(false);   // user confirmed a cancel — suppress commit
  const completedRef = useRef(false);   // ceremony already resolved (commit/cancel)

  // Drive the powerdown ceremony: play audio, advance the progress bar, and
  // commit when {audio 'ended', fallback timer} fires first — unless cancelled.
  useEffect(() => {
    let raf = null;
    let fallbackTimer = null;
    const audio = getCueAudioElement();

    const finish = (reason) => {
      if (completedRef.current) return;
      completedRef.current = true;
      if (raf) cancelAnimationFrame(raf);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      logger.info('emergency.ceremony_end', { reason, cancelled: cancelledRef.current });
      if (!cancelledRef.current) {
        commit().catch(() => {});
      }
    };

    const onEnded = () => finish('audio-ended');

    const tick = () => {
      if (audio && isFinite(audio.duration) && audio.duration > 0) {
        setProgress(Math.min(1, audio.currentTime / audio.duration));
      }
      raf = requestAnimationFrame(tick);
    };

    logger.info('emergency.triggering', { audioPath });

    if (audio) {
      try {
        primeCueAudio('emergency-triggering');
        audio.src = DaylightMediaPath('/media/' + audioPath);
        audio.currentTime = 0;
        audio.muted = false;
        audio.volume = 1;
        audio.addEventListener('ended', onEnded);
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            // Autoplay gated on a gesture-less kiosk — the fallback timer still
            // drives the ceremony to commit.
            logger.warn('emergency.audio_blocked', { name: err?.name ?? null });
            setAudioPlaying(false);
          });
        }
      } catch (err) {
        logger.warn('emergency.audio_threw', { message: err?.message ?? null });
        setAudioPlaying(false);
      }
    } else {
      setAudioPlaying(false);
    }

    // Fallback: whichever fires first (ended vs. timer) completes the ceremony.
    const durMs = (audio && isFinite(audio.duration) && audio.duration > 0)
      ? audio.duration * 1000
      : 8000;
    fallbackTimer = setTimeout(() => finish('fallback-timer'), durMs + 400);

    raf = requestAnimationFrame(tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (audio) {
        audio.removeEventListener('ended', onEnded);
        try { audio.pause(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPath]);

  const handleCancel = useCallback(async () => {
    if (scanning) return;
    if (!cancelArmed) {
      setCancelArmed(true);
      logger.info('emergency.cancel_armed', {});
      return;
    }
    setScanning(true);
    logger.info('emergency.cancel_scan', {});
    const { confirmed } = await abort();
    if (confirmed) {
      cancelledRef.current = true;
      // enterNormal() inside the hook unmounts this screen; nothing more to do.
    } else {
      // Not confirmed — let the ceremony proceed to commit.
      logger.info('emergency.cancel_denied', {});
      setScanning(false);
      setCancelArmed(false);
    }
  }, [scanning, cancelArmed, abort, logger]);

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
      {audioPlaying && (
        <div className="emergency-cancel-zone">
          <button
            type="button"
            className={`emergency-cancel${cancelArmed ? ' emergency-cancel--armed' : ''}`}
            onPointerDown={handleCancel}
            disabled={scanning}
          >
            {scanning ? 'SCANNING…' : cancelArmed ? 'SCAN TO CONFIRM CANCEL' : 'Cancel'}
          </button>
        </div>
      )}
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
    }
  }, []);

  const startHold = useCallback(() => {
    if (scanning || holdTimerRef.current) return;
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
