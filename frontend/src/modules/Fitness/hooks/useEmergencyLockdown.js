import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { wsService } from '@/services/WebSocketService.js';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'emergency' }));

const EMERGENCY_PATH = 'api/v1/fitness/emergency';
const CEREMONY_TOPIC = 'fitness.emergency.ceremony';
const TOPICS = [
  'fitness.emergency.locked',
  'fitness.emergency.released',
  CEREMONY_TOPIC
];

// Phases of the three-stage lockdown state machine.
export const PHASE_NORMAL = 'normal';
export const PHASE_TRIGGERING = 'triggering';
export const PHASE_LOCKED = 'locked';

/**
 * Read the dev/test seam from the URL: ?emergency=triggering|locked forces the
 * initial phase so the DEFCON overlay can be exercised visually / in e2e tests
 * without a real admin fingerprint. Only the INITIAL phase is forced; live
 * websocket/HTTP transitions proceed normally afterward.
 */
function readUrlSeam() {
  try {
    const param = new URLSearchParams(window.location.search).get('emergency');
    if (param === PHASE_TRIGGERING || param === PHASE_LOCKED) return param;
  } catch { /* SSR / no window */ }
  return null;
}

/**
 * Drives the emergency-lockdown state machine for the Fitness app.
 *
 * Phases:
 *  - normal:     nothing shown.
 *  - triggering: full-screen DEFCON ceremony; powerdown audio + cancel window.
 *  - locked:     lockdown screen until lockedUntil passes or an admin releases.
 *
 * @param {{ audioPath?: string }} [opts]
 * @returns {{
 *   phase: 'normal'|'triggering'|'locked',
 *   lockedUntil: number|null,
 *   lockedBy: string|null,
 *   commit: () => Promise<{locked:boolean}>,
 *   abort: () => Promise<{confirmed:boolean}>,
 *   release: () => Promise<{released:boolean}>,
 *   triggerCeremony: () => void
 * }}
 */
export function useEmergencyLockdown() {
  // Lazily seed from the URL seam so the overlay renders immediately for tests.
  const [phase, setPhase] = useState(() => readUrlSeam() || PHASE_NORMAL);
  const [lockedUntil, setLockedUntil] = useState(() =>
    readUrlSeam() === PHASE_LOCKED ? Math.floor(Date.now() / 1000) + 1800 : null
  );
  const [lockedBy, setLockedBy] = useState(null);

  // Mirror phase into a ref so async callbacks read the latest value without
  // being re-created on every transition.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const enterLocked = useCallback((until, by) => {
    setPhase(PHASE_LOCKED);
    if (until != null) setLockedUntil(until);
    if (by != null) setLockedBy(by);
    logger().info('emergency.locked', { lockedUntil: until, lockedBy: by });
  }, []);

  const enterNormal = useCallback((reason = 'unspecified') => {
    setPhase(PHASE_NORMAL);
    setLockedUntil(null);
    setLockedBy(null);
    logger().info('emergency.normal', { reason });
  }, []);

  // Imperative entry point for the ceremony. The IdentityProvider calls this in
  // response to an enriched identity event; begin only from a clean state so
  // repeated calls are idempotent (functional setState avoids stale `phase`).
  const triggerCeremony = useCallback(() => {
    setPhase((prev) => {
      if (prev === PHASE_NORMAL) {
        logger().info('emergency.triggering', { source: 'triggerCeremony' });
        return PHASE_TRIGGERING;
      }
      return prev;
    });
  }, []);

  // --- Mount: hydrate current lock state from the server ---------------------
  useEffect(() => {
    // If the URL seam forced a phase, don't let the GET stomp it (tests).
    const seam = readUrlSeam();
    if (seam) {
      logger().info('emergency.seam_forced', { phase: seam });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await DaylightAPI(EMERGENCY_PATH);
        if (cancelled) return;
        if (res && res.locked) {
          setPhase(PHASE_LOCKED);
          setLockedUntil(res.lockedUntil ?? null);
          setLockedBy(res.lockedBy ?? null);
          logger().info('emergency.locked', { lockedUntil: res.lockedUntil, lockedBy: res.lockedBy, source: 'mount' });
        } else {
          logger().debug('emergency.status_clear', { source: 'mount' });
        }
      } catch (err) {
        // Stay normal on error — better to under-lock than to brick the app.
        logger().warn('emergency.status_failed', { message: err?.message ?? null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Websocket: live broadcasts ------------------------------------------
  useEffect(() => {
    const unsub = wsService.subscribe(TOPICS, (msg) => {
      if (!msg || !msg.topic) return;
      switch (msg.topic) {
        case 'fitness.emergency.locked':
          enterLocked(msg.lockedUntil ?? null, msg.lockedBy ?? null);
          break;
        case 'fitness.emergency.released':
          logger().info('emergency.released', { by: msg.by ?? null, at: msg.at ?? null });
          enterNormal('ws-released');
          break;
        case CEREMONY_TOPIC:
          logger().info('emergency.ceremony_broadcast', { reason: msg.reason ?? null, count: msg.count ?? null });
          triggerCeremony();
          break;
        default:
          break;
      }
    });
    return () => { try { unsub(); } catch { /* noop */ } };
  }, [enterLocked, enterNormal, triggerCeremony]);

  // --- Locked expiry timer --------------------------------------------------
  useEffect(() => {
    if (phase !== PHASE_LOCKED || lockedUntil == null) return;
    // setTimeout uses a 32-bit signed delay; anything past ~24.8 days overflows
    // and fires immediately. Clamp to the max so a far-future window doesn't
    // mis-fire the expiry re-check.
    const MAX_DELAY = 2147483647;
    const ms = Math.min(MAX_DELAY, Math.max(0, lockedUntil * 1000 - Date.now()));
    const t = setTimeout(async () => {
      try {
        const res = await DaylightAPI(EMERGENCY_PATH);
        if (!res || !res.locked) {
          logger().info('emergency.expired', { lockedUntil });
          enterNormal('expiry');
        } else {
          // Server still locked (clock skew / extended) — adopt its window.
          logger().info('emergency.lock_extended', { lockedUntil: res.lockedUntil ?? null });
          setLockedUntil(res.lockedUntil ?? null);
          setLockedBy(res.lockedBy ?? null);
        }
      } catch (err) {
        // On error, optimistically release so the kiosk isn't stuck forever.
        logger().warn('emergency.expiry_check_failed', { message: err?.message ?? null });
        enterNormal('expiry-check-failed');
      }
    }, ms);
    return () => clearTimeout(t);
  }, [phase, lockedUntil, enterNormal]);

  // --- Actions --------------------------------------------------------------
  const commit = useCallback(async () => {
    try {
      const res = await DaylightAPI(`${EMERGENCY_PATH}/commit`, {}, 'POST');
      if (res && res.locked) {
        enterLocked(res.lockedUntil ?? null, res.lockedBy ?? null);
        logger().info('emergency.committed', { lockedUntil: res.lockedUntil, lockedBy: res.lockedBy });
        return { locked: true };
      }
      logger().warn('emergency.commit_no_lock', { res });
      return { locked: false };
    } catch (err) {
      // 409 no-pending-detection (or any failure) → fall back to normal.
      logger().warn('emergency.commit_failed', { message: err?.message ?? null });
      enterNormal('commit-failed');
      return { locked: false };
    }
  }, [enterLocked, enterNormal]);

  const abort = useCallback(async () => {
    try {
      const res = await DaylightAPI(`${EMERGENCY_PATH}/abort`, {}, 'POST');
      const confirmed = !!(res && res.confirmed);
      if (confirmed) {
        logger().info('emergency.cancelled', {});
        enterNormal('cancel-confirmed');
      } else {
        logger().info('emergency.cancel_denied', {});
      }
      return { confirmed };
    } catch (err) {
      logger().warn('emergency.abort_failed', { message: err?.message ?? null });
      return { confirmed: false };
    }
  }, [enterNormal]);

  const release = useCallback(async () => {
    logger().info('emergency.release_requested', {});
    try {
      const res = await DaylightAPI(`${EMERGENCY_PATH}/release`, {}, 'POST');
      const released = !!(res && res.released);
      if (released) {
        logger().info('emergency.released', { by: 'local-scan' });
        enterNormal('release-confirmed');
      } else {
        logger().info('emergency.release_denied', {});
      }
      return { released };
    } catch (err) {
      logger().warn('emergency.release_failed', { message: err?.message ?? null });
      return { released: false };
    }
  }, [enterNormal]);

  return { phase, lockedUntil, lockedBy, commit, abort, release, triggerCeremony };
}

export default useEmergencyLockdown;
