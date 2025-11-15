import { forwardRef, useCallback, useState, useRef } from 'react';
import PropTypes from 'prop-types';
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
    onSeek,
    onPrev,
    onNext,
    onClose,
    hasPrev,
    hasNext,
    isPaused,
    stallInfo,
    playerRef,
    TimeDisplay,
    renderCount,
    playIsGoverned,
    mediaElementKey,
    generateThumbnailUrl,
    thumbnailsCommitRef,
    thumbnailsGetTimeRef
  } = props;

  const baseDuration = (duration && !Number.isNaN(duration) ? duration : (currentItem?.duration || 600));
  const isStalled = !!(stallInfo?.isStalled);

  // Zoom wiring (thumbnails expose onZoomChange + reset ref)
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomNavState, setZoomNavState] = useState(null);
  const zoomResetRef = useRef(null);
  const handleZoomNavStateChange = useCallback((nextState) => {
    setZoomNavState(nextState);
  }, []);
  const handleBack = useCallback(() => {
    if (zoomResetRef.current) {
      zoomResetRef.current();
      setIsZoomed(false);
    }
  }, []);

  if (hidden) return null;

  return (
    <div
      ref={ref}
      className={`fitness-player-footer${stackMode ? ' stack-mode' : ''}`}
      style={{ height: height + 'px', flex: `0 0 ${height}px`, transition: 'height .25s ease' }}
      data-stalled={isStalled ? '1' : '0'}
    >
      <FitnessPlayerFooterControls
        section="left"
        currentTime={currentTime}
        duration={baseDuration}
        TimeDisplay={TimeDisplay}
        renderCount={renderCount}
        isPaused={isPaused || isStalled}
        isStalled={isStalled}
        playerRef={playerRef}
        onPrev={onPrev}
        onNext={onNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onClose={onClose}
        playIsGoverned={playIsGoverned}
        isZoomed={isZoomed}
        zoomNavState={zoomNavState}
      />

      <FitnessPlayerFooterSeekThumbnails
        duration={baseDuration}
        currentTime={currentTime}
        currentItem={currentItem}
        generateThumbnailUrl={generateThumbnailUrl}
        onSeek={onSeek}
        playerRef={playerRef}
        onZoomChange={setIsZoomed}
        onZoomReset={zoomResetRef}
        onZoomNavStateChange={handleZoomNavStateChange}
        commitRef={thumbnailsCommitRef}
        getTimeRef={thumbnailsGetTimeRef}
        mediaElementKey={mediaElementKey}
      />

      <FitnessPlayerFooterControls
        section="right"
        isPaused={isPaused || isStalled}
        isStalled={isStalled}
        playerRef={playerRef}
        onPrev={onPrev}
        onNext={onNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onClose={onClose}
        isZoomed={isZoomed}
        onBack={handleBack}
        playIsGoverned={playIsGoverned}
      />
    </div>
  );
});

export default FitnessPlayerFooter;

FitnessPlayerFooter.propTypes = {
  hidden: PropTypes.bool,
  height: PropTypes.number,
  stackMode: PropTypes.bool,
  currentTime: PropTypes.number,
  duration: PropTypes.number,
  currentItem: PropTypes.object,
  onSeek: PropTypes.func,
  onPrev: PropTypes.func,
  onNext: PropTypes.func,
  onClose: PropTypes.func,
  hasPrev: PropTypes.bool,
  hasNext: PropTypes.bool,
  isPaused: PropTypes.bool,
  stallInfo: PropTypes.shape({ isStalled: PropTypes.bool }),
  playerRef: PropTypes.shape({ current: PropTypes.object }),
  TimeDisplay: PropTypes.elementType,
  renderCount: PropTypes.number,
  playIsGoverned: PropTypes.bool,
  mediaElementKey: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  generateThumbnailUrl: PropTypes.func,
  thumbnailsCommitRef: PropTypes.shape({ current: PropTypes.func }),
  thumbnailsGetTimeRef: PropTypes.shape({ current: PropTypes.func })
};
