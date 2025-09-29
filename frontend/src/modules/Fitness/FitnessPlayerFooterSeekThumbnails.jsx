import React, { useCallback } from 'react';

/**
 * FitnessPlayerFooterSeekThumbnails
 * Props:
 *  - duration (seconds)
 *  - currentTime (seconds)
 *  - fallbackDuration (seconds) optional default if duration invalid
 *  - onSeek(seconds)
 *  - seekButtons (React nodes)
 */
const FitnessPlayerFooterSeekThumbnails = ({ duration, currentTime, fallbackDuration = 600, onSeek, seekButtons }) => {
  const baseDuration = (duration && !isNaN(duration) ? duration : fallbackDuration);
  const pct = baseDuration > 0 ? (currentTime / baseDuration) * 100 : 0;

  const handleClick = useCallback((e) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.min(1, Math.max(0, clickX / rect.width));
    onSeek(percent * baseDuration);
  }, [onSeek, baseDuration]);

  return (
    <div className="footer-seek-thumbnails">
      <div className="progress-bar" onClick={handleClick}>
        <div className="progress" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="seek-thumbnails">
        {seekButtons}
      </div>
    </div>
  );
};

export default FitnessPlayerFooterSeekThumbnails;
