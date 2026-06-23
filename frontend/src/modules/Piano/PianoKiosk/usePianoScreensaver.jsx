import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-screensaver' });
  return _logger;
}

/**
 * Parse "HH:MM" → minutes-since-midnight, or null if malformed.
 */
function parseHHMM(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `now` within the quiet-hours window? Supports overnight ranges where
 * start > end (e.g. 21:30 → 07:00). Returns false when quietHours is unset or
 * malformed (fail-open: no quiet hours rather than always-quiet).
 *
 * @param {Date} now
 * @param {{start?: string, end?: string}|null} quietHours
 * @returns {boolean}
 */
export function isWithinQuietHours(now, quietHours) {
  if (!quietHours) return false;
  const start = parseHHMM(quietHours.start);
  const end = parseHHMM(quietHours.end);
  if (start == null || end == null || start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? cur >= start && cur < end // same-day window
    : cur >= start || cur < end; // overnight window
}

// ── Wake-lock registry ──────────────────────────────────────────────────────
// A ref-counted set of named "keep the screen awake" holds. Modes acquire a
// hold (e.g. Videos while a video plays) so the screensaver won't sleep the
// screen mid-playback. Extensible: any reason string is a guardrail.
const PianoWakeLockContext = createContext(null);

export function PianoWakeLockProvider({ children }) {
  const reasonsRef = useRef(new Set());
  const [held, setHeld] = useState(false);

  const setReason = useCallback((reason, active) => {
    const reasons = reasonsRef.current;
    const had = reasons.has(reason);
    if (active) reasons.add(reason);
    else reasons.delete(reason);
    if (active !== had) {
      setHeld(reasons.size > 0);
      logger().debug('piano.wakelock', { reason, active, held: reasons.size > 0 });
    }
  }, []);

  const value = useMemo(() => ({ held, setReason }), [held, setReason]);
  return <PianoWakeLockContext.Provider value={value}>{children}</PianoWakeLockContext.Provider>;
}

/**
 * Hold the screen awake for as long as `active` is true under `reason`.
 * No-op outside a PianoWakeLockProvider (so modes used in tests don't blow up).
 */
export function useKeepScreenAwake(reason, active) {
  const ctx = useContext(PianoWakeLockContext);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setReason(reason, !!active);
    return () => ctx.setReason(reason, false);
  }, [ctx, reason, active]);
}

/** Current wake-lock state: true when any hold is active. */
export function usePianoWakeLockState() {
  return useContext(PianoWakeLockContext)?.held ?? false;
}

// ── Screensaver controller ───────────────────────────────────────────────────
const POLL_INTERVAL_MS = 15_000;

/**
 * usePianoScreensaver — drives the piano tablet's screen via the backend
 * (`/api/v1/device/:deviceId/screen/{on,off}`):
 *
 *  - A BLE-MIDI note (noteHistory grows) or a touch/keypress wakes the screen.
 *  - After `timeoutMinutes` idle the screen sleeps.
 *
 * Guardrails:
 *  - A held wake lock (e.g. a playing video) keeps the screen awake and resets
 *    the idle timer.
 *  - During quiet hours the screen stays off: notes/touch do NOT wake it, and
 *    an on-screen is slept on the next poll (unless a wake lock is held).
 *
 * Inert (no API calls) when `deviceId` is falsy or `timeoutMinutes` <= 0.
 *
 * @param {Object}   args
 * @param {string}   [args.deviceId]
 * @param {Map}      args.activeNotes      - live notes (any change = activity)
 * @param {Array}    args.noteHistory      - grows on each note-on (= a fresh note)
 * @param {number}   [args.timeoutMinutes]
 * @param {{start?:string,end?:string}|null} [args.quietHours]
 */
export function usePianoScreensaver({ deviceId, activeNotes, noteHistory, timeoutMinutes, quietHours }) {
  const enabled = !!deviceId && timeoutMinutes > 0;
  const held = usePianoWakeLockState();

  const historyLen = noteHistory?.length ?? 0;
  const lastActivityRef = useRef(Date.now());
  const screenOnRef = useRef(true); // kiosk is showing when we mount → screen on
  const inFlightRef = useRef(false);
  const heldRef = useRef(held);
  heldRef.current = held;
  const quietRef = useRef(quietHours);
  quietRef.current = quietHours;

  // Send a screen on/off command, deduped against believed state + in-flight.
  const setScreen = useCallback((on) => {
    if (!deviceId || inFlightRef.current || screenOnRef.current === on) return;
    inFlightRef.current = true;
    const state = on ? 'on' : 'off';
    DaylightAPI(`api/v1/device/${deviceId}/screen/${state}`)
      .then((res) => {
        if (res?.ok === false) {
          logger().warn('piano.screen-rejected', { deviceId, state, error: res.error });
          return;
        }
        screenOnRef.current = on;
        logger().info('piano.screen', { deviceId, state });
      })
      .catch((err) => {
        logger().warn('piano.screen-failed', { deviceId, state, error: err.message });
      })
      .finally(() => { inFlightRef.current = false; });
  }, [deviceId]);

  // Any MIDI activity wakes the screen (unless quiet hours). activeNotes is a
  // fresh Map on every note on/off, and noteHistory grows on play — but it's
  // trimmed on an 8s timer so its length is NOT monotonic, hence we key on the
  // activeNotes identity change too rather than length growth. setScreen dedups
  // against believed state, so repeated notes don't spam the API. Runs once on
  // mount (a no-op wake since the screen is already on).
  useEffect(() => {
    lastActivityRef.current = Date.now();
    if (enabled && !isWithinQuietHours(new Date(), quietRef.current)) setScreen(true);
  }, [activeNotes, historyLen, enabled, setScreen]);

  // Touch/keypress: bump activity and wake (unless quiet hours).
  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => {
      lastActivityRef.current = Date.now();
      if (!isWithinQuietHours(new Date(), quietRef.current)) setScreen(true);
    };
    window.addEventListener('pointerdown', bump, true);
    window.addEventListener('keydown', bump, true);
    return () => {
      window.removeEventListener('pointerdown', bump, true);
      window.removeEventListener('keydown', bump, true);
    };
  }, [enabled, setScreen]);

  // Idle poll → sleep the screen (or keep awake while a wake lock is held).
  useEffect(() => {
    if (!enabled) return undefined;
    const thresholdMs = timeoutMinutes * 60_000;
    const id = setInterval(() => {
      if (heldRef.current) { lastActivityRef.current = Date.now(); return; } // video etc.
      if (isWithinQuietHours(new Date(), quietRef.current)) { setScreen(false); return; }
      if (Date.now() - lastActivityRef.current >= thresholdMs) setScreen(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, timeoutMinutes, setScreen]);
}

export default usePianoScreensaver;
