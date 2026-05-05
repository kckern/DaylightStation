import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ScreenVolumeContext,
  _publishMasterState,
} from '../../lib/volume/ScreenVolumeContext.js';
import getLogger from '../../lib/logging/Logger.js';

const clamp = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenVolumeProvider' });
  return _logger;
}

function readInitial(storageKey, defaultMaster) {
  const fallback = clamp(defaultMaster);
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const m = Number(parsed?.master);
    return Number.isFinite(m) ? clamp(m) : fallback;
  } catch {
    return fallback;
  }
}

export function ScreenVolumeProvider({
  children,
  storageKey = 'screen-volume',
  defaultMaster = 0.5,
  stepSize = 0.1,
}) {
  const [master, setMasterState] = useState(() => readInitial(storageKey, defaultMaster));
  // preMute = the most recent non-zero master. Used to restore on unmute.
  const preMuteRef = useRef(master > 0 ? master : clamp(defaultMaster));
  const muted = master === 0;

  // Track latest non-zero master as the unmute target.
  useEffect(() => {
    if (master > 0) preMuteRef.current = master;
  }, [master]);

  // Mirror state into module scope for non-React consumers (sound effects, etc).
  useEffect(() => {
    _publishMasterState(master, muted);
  }, [master, muted]);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ master, muted }));
    } catch (e) {
      logger().warn('persist-failed', { error: e.message, storageKey });
    }
  }, [storageKey, master, muted]);

  const setMaster = useCallback((next) => {
    setMasterState(clamp(next));
  }, []);

  // Vol-up / vol-down. While muted, applies delta on top of preMute (so the
  // first press unmutes AND moves the level — keys always do what they say).
  const step = useCallback((delta) => {
    setMasterState((prev) => {
      if (prev === 0) return clamp(preMuteRef.current + delta);
      return clamp(prev + delta);
    });
  }, []);

  const toggleMute = useCallback(() => {
    setMasterState((prev) => (prev === 0 ? preMuteRef.current : 0));
  }, []);

  const value = useMemo(
    () => ({ master, muted, setMaster, step, toggleMute, stepSize }),
    [master, muted, setMaster, step, toggleMute, stepSize],
  );

  return (
    <ScreenVolumeContext.Provider value={value}>
      {children}
    </ScreenVolumeContext.Provider>
  );
}

export default ScreenVolumeProvider;
