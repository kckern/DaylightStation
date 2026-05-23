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
  fixed = false,
}) {
  // Fixed mode (e.g. living-room TV where hardware controls volume):
  // master is locked at defaultMaster, localStorage is bypassed, and
  // setMaster / step / toggleMute are no-ops. The HUD toast never fires
  // because master never changes after init.
  const [master, setMasterState] = useState(() =>
    fixed ? clamp(defaultMaster) : readInitial(storageKey, defaultMaster)
  );
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

  // Persist on every change (skipped in fixed mode — the master is config-driven,
  // not user-driven, so there's nothing to remember across sessions).
  useEffect(() => {
    if (fixed) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ master, muted }));
    } catch (e) {
      logger().warn('persist-failed', { error: e.message, storageKey });
    }
  }, [fixed, storageKey, master, muted]);

  const setMaster = useCallback((next) => {
    if (fixed) return;
    setMasterState(clamp(next));
  }, [fixed]);

  // Vol-up / vol-down. While muted, applies delta on top of preMute (so the
  // first press unmutes AND moves the level — keys always do what they say).
  const step = useCallback((delta) => {
    if (fixed) return;
    setMasterState((prev) => {
      if (prev === 0) return clamp(preMuteRef.current + delta);
      return clamp(prev + delta);
    });
  }, [fixed]);

  const toggleMute = useCallback(() => {
    if (fixed) return;
    setMasterState((prev) => (prev === 0 ? preMuteRef.current : 0));
  }, [fixed]);

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
