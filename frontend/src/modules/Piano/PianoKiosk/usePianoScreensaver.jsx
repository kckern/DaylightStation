import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-screensaver' });
  return _logger;
}

// ── Wake-lock registry ──────────────────────────────────────────────────────
// A ref-counted set of named "keep the screen awake" holds. Modes acquire a
// hold (e.g. Videos while a video plays) so the screensaver won't sleep the
// screen mid-playback. Extensible: any reason string is a guardrail.
export const PianoWakeLockContext = createContext(null);

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

// ── Manual screen-off cooldown ───────────────────────────────────────────────
// Bridges the Who's-Playing "Turn off screen" button (in PianoShell, below the
// connect gate) to the screensaver (in ScreensaverDriver, above it). The button
// bumps `armNonce`; the screensaver reacts by muting MIDI-wake until the player
// has been idle for offCooldownMinutes (a touch clears it sooner). Mounted so it
// wraps BOTH the screensaver and the shell (see PianoApp.jsx ActivePiano).
export const PianoScreenControlContext = createContext(null);

export function PianoScreenControlProvider({ children }) {
  const [armNonce, setArmNonce] = useState(0);
  const beginScreenOffCooldown = useCallback(() => setArmNonce((n) => n + 1), []);
  const value = useMemo(() => ({ armNonce, beginScreenOffCooldown }), [armNonce, beginScreenOffCooldown]);
  return <PianoScreenControlContext.Provider value={value}>{children}</PianoScreenControlContext.Provider>;
}
