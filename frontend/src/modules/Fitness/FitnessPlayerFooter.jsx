import React, { forwardRef, useCallback } from 'react';
import FitnessPlayerFooterControls from './FitnessPlayerFooterControls.jsx';

/*
 * FitnessPlayerFooter
 * Props:
 *  - hidden (bool): hide entirely
 *  - height (number): allocated footer height (px)
 *  - stackMode (bool)
 *  - currentTime, duration, currentItem
 *  - seekButtons (React nodes)
 *  - onSeek(percentSeconds), onPrev, onNext, onClose
 *  - hasPrev, hasNext, isPaused
 *  - mediaElRef (ref to underlying video element)
 *  - TimeDisplay (memoized component)
 *  - renderCount (number) render counter
 */
const FitnessPlayerFooter = forwardRef(function FitnessPlayerFooter(props, ref) {
  const {
    hidden,
    height,
    stackMode,
    currentTime,
    duration,
    currentItem,
    seekButtons,
    onSeek,
    onPrev,
    onNext,
    onClose,
    hasPrev,
    hasNext,
    isPaused,
    mediaElRef,
    TimeDisplay,
    renderCount
  } = props;

  if (hidden) return null;

  const handleProgressBarClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.min(1, Math.max(0, clickX / rect.width));
    const baseDuration = (duration && !isNaN(duration) ? duration : (currentItem?.duration || 600));
    onSeek(percent * baseDuration);
  }, [duration, currentItem, onSeek]);

  const baseDuration = (duration && !isNaN(duration) ? duration : (currentItem?.duration || 600));
  const pct = baseDuration > 0 ? (currentTime / baseDuration) * 100 : 0;

  return (
    <div
      ref={ref}
      className={`fitness-player-footer${stackMode ? ' stack-mode' : ''}`}
      style={{ height: height + 'px', flex: `0 0 ${height}px`, transition: 'height .25s ease' }}
    >
      <FitnessPlayerFooterControls
        section="left"
        currentTime={currentTime}
        duration={baseDuration}
        TimeDisplay={TimeDisplay}
        renderCount={renderCount}
        isPaused={isPaused}
        mediaElRef={mediaElRef}
        onPrev={onPrev}
        onNext={onNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onClose={onClose}
      />

      <div className="footer-seek-thumbnails">
        <div className="progress-bar" onClick={handleProgressBarClick}>
          <div className="progress" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <div className="seek-thumbnails">
          {seekButtons}
        </div>
      </div>

      <FitnessPlayerFooterControls
        section="right"
        isPaused={isPaused}
        mediaElRef={mediaElRef}
        onPrev={onPrev}
        onNext={onNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onClose={onClose}
      />
    </div>
  );
});

export default FitnessPlayerFooter;
