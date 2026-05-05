import React, { useState, useEffect, useRef } from 'react';
import { useScreenVolume } from '../../lib/volume/ScreenVolumeContext.js';
import './MasterVolumeToast.css';

const HIDE_AFTER_MS = 1200;
const BAR_LENGTH = 10;

/**
 * Renderless component that shows a transient HUD toast on master volume
 * change. Mount once inside ScreenVolumeProvider; the toast auto-hides after
 * HIDE_AFTER_MS. Rapid changes reset the timer.
 */
export function MasterVolumeToast() {
  const { master, muted } = useScreenVolume();
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    // Skip the initial mount so the toast doesn't flash on every page load.
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, [master, muted]);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  if (!visible) return null;

  const percent = Math.round(master * 100);
  const filled = Math.max(0, Math.min(BAR_LENGTH, Math.round(master * BAR_LENGTH)));
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);

  return (
    <div
      className="master-volume-toast"
      role="status"
      aria-live="polite"
      data-testid="master-volume-toast"
    >
      {muted ? (
        <div className="master-volume-toast__content master-volume-toast__content--muted">
          <span className="master-volume-toast__icon">🔇</span>
          <span className="master-volume-toast__label">Muted</span>
        </div>
      ) : (
        <div className="master-volume-toast__content">
          <span className="master-volume-toast__icon">🔊</span>
          <span className="master-volume-toast__bar">{bar}</span>
          <span className="master-volume-toast__percent">{percent}</span>
        </div>
      )}
    </div>
  );
}

export default MasterVolumeToast;
