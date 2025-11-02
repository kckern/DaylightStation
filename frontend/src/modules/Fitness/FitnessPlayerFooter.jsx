import React, { forwardRef, useCallback, useState, useRef } from 'react';
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
 *  - playerRef (ref to <Player /> imperative API)
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
  playerRef,
    TimeDisplay,
    renderCount
  } = props;

  if (hidden) return null;

  const baseDuration = (duration && !isNaN(duration) ? duration : (currentItem?.duration || 600));

  // Zoom wiring (thumbnails expose onZoomChange + reset ref)
  const [isZoomed, setIsZoomed] = useState(false);
  const zoomResetRef = useRef(null);
  const handleBack = useCallback(() => {
    if (zoomResetRef.current) {
      zoomResetRef.current();
      setIsZoomed(false);
    }
  }, []);

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
  playerRef={playerRef}
        onPrev={onPrev}
        onNext={onNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onClose={onClose}
      />

      <FitnessPlayerFooterSeekThumbnails
        duration={baseDuration}
        currentTime={currentTime}
        currentItem={currentItem}
        generateThumbnailUrl={props.generateThumbnailUrl || undefined}
        onSeek={onSeek}
        seekButtons={seekButtons}
        playerRef={playerRef}
        onZoomChange={setIsZoomed}
        onZoomReset={zoomResetRef}
        commitRef={props.thumbnailsCommitRef}
        getTimeRef={props.thumbnailsGetTimeRef}
      />

      <FitnessPlayerFooterControls
        section="right"
        isPaused={isPaused}
        playerRef={playerRef}
        onPrev={onPrev}
        onNext={onNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onClose={isZoomed ? handleBack : onClose}
        isZoomed={isZoomed}
        onBack={handleBack}
      />
    </div>
  );
});

export default FitnessPlayerFooter;
