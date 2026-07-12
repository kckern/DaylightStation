import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './EmergencyLockdownOverlay.scss';
import getLogger from '@/lib/logging/Logger.js';
import { useIdentity } from '@/modules/Fitness/identity/IdentityProvider';

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

// Continuous press-and-hold required to confirm a shutdown (and, on the locked
// screen, to release). The same duration keeps the two gestures symmetrical.
const HOLD_MS = 3000;

// Fail-safe idle window: if the operator never deliberately holds to confirm, the
// ceremony returns to normal on its own and NOTHING is committed. An accidental
// trigger (a stray admin scan that opened the ceremony) self-heals by doing
// nothing — the previous behavior auto-committed the lockdown when this elapsed.
const CEREMONY_WINDOW_MS = 10000;

/**
 * Full-screen emergency-lockdown overlay for the Fitness kiosk.
 *
 * Renders nothing in the 'normal' phase. In 'triggering' it shows a fail-safe
 * confirm ceremony: a press-and-hold to shut down. Doing nothing (or releasing
 * early) auto-cancels back to normal — only a deliberate 3s hold commits the
 * lock. In 'locked' it shows an inert lockdown screen that releases
 * via the same 3s press-and-hold (server admin scan).
 */
export default function EmergencyLockdownOverlay() {
  const logger = useMemo(() => getLogger().child({ component: 'emergency' }), []);
  const { phase, lockedUntil, commit, dismissCeremony, release } = useIdentity();

  if (phase === 'normal') return null;
  if (phase === 'triggering') {
    return (
      <TriggeringScreen
        commit={commit}
        dismissCeremony={dismissCeremony}
        logger={logger}
      />
    );
  }
  return <LockedScreen lockedUntil={lockedUntil} release={release} logger={logger} />;
}

function TriggeringScreen({ commit, dismissCeremony, logger }) {
  const [holding, setHolding] = useState(false);

  const doneRef = useRef(false);        // ceremony resolved (committed or dismissed)
  const holdTimerRef = useRef(null);    // press-and-hold → commit timer
  const idleTimerRef = useRef(null);    // idle → auto-cancel timer

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
  }, []);

  // Return to normal without a deliberate confirm. TRIGGERING is local-only
  // frontend state, so nothing is committed and there is no server lock to clear.
  const dismiss = useCallback((reason) => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimers();
    setHolding(false);
    logger.info('emergency.ceremony_dismissed', { reason });
    dismissCeremony();
  }, [clearTimers, dismissCeremony, logger]);

  const armIdleCancel = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => dismiss('window-elapsed'), CEREMONY_WINDOW_MS);
  }, [dismiss]);

  // Start the fail-safe idle window on mount.
  useEffect(() => {
    logger.info('emergency.triggering', { windowMs: CEREMONY_WINDOW_MS, holdMs: HOLD_MS });
    armIdleCancel();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startHold = useCallback(() => {
    if (doneRef.current || holdTimerRef.current) return;
    setHolding(true);
    // Pause the idle auto-cancel while a deliberate hold is in progress.
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    logger.info('emergency.confirm_hold_start', { holdMs: HOLD_MS });
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      logger.info('emergency.confirm_committed', {});
      commit().catch(() => {});
    }, HOLD_MS);
  }, [clearTimers, commit, logger]);

  const cancelHold = useCallback(() => {
    if (doneRef.current || !holdTimerRef.current) return;
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setHolding(false);
    logger.info('emergency.confirm_hold_cancel', {});
    armIdleCancel(); // resume the idle auto-cancel window
  }, [armIdleCancel, logger]);

  return (
    <div className="emergency-overlay emergency-overlay--triggering" role="alertdialog" aria-label="Confirm system shutdown">
      <div className="emergency-vignette" />
      <div className="emergency-stack">
        <PowerGlyph className="emergency-glyph emergency-glyph--pulse" />
        <div className="emergency-headline">HOLD TO SHUT DOWN</div>
        <div className="emergency-subline">Release or wait to cancel</div>
        <button
          type="button"
          className={`emergency-confirm${holding ? ' emergency-confirm--holding' : ''}`}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
        >
          <span className="emergency-confirm__fill" style={{ transitionDuration: `${HOLD_MS}ms` }} />
          <span className="emergency-confirm__label">Hold</span>
        </button>
      </div>
      <div className="emergency-cancel-zone">
        <button type="button" className="emergency-cancel" onPointerDown={() => dismiss('cancel-button')}>
          Cancel
        </button>
      </div>
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
