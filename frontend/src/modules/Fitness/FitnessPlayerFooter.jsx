import React, { forwardRef, useCallback } from 'react';
import FitnessPlayerFooterControls from './FitnessPlayerFooterControls.jsx';
import FitnessPlayerFooterSeekThumbnails from './FitnessPlayerFooterSeekThumbnails.jsx';

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

  const baseDuration = (duration && !isNaN(duration) ? duration : (currentItem?.duration || 600));

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

      <FitnessPlayerFooterSeekThumbnails
        duration={baseDuration}
        currentTime={currentTime}
        onSeek={onSeek}
        seekButtons={seekButtons}
      />

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
