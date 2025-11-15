import { useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

/*
 * FitnessPlayerFooterControls
 * Reusable control clusters (left/right) so future footer variants can opt in/out.
 * Props:
 *  - section: 'left' | 'right'
 *  - isPaused, playerRef (imperative Player ref), onPrev, onNext, hasPrev, hasNext, onClose
 *  - isStalled (bool) when playback stall detected (treats as paused for UI)
 *  - currentTime, duration, TimeDisplay, renderCount (only used on left)
 *  - zoomNavState: helpers for navigating zoomed thumbnails (left section only)
 */
export default function FitnessPlayerFooterControls({
  section,
  isPaused,
  playerRef,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
  isStalled = false,
  isZoomed = false,
  onBack,
  playIsGoverned = false,
  zoomNavState = null
}) {
  const isLeft = section === 'left';
  
  /*
   * Toggle playback using the Player imperative interface when available.
   * Falls back to legacy direct media element access only if playerRef not provided.
   */
  const playPause = () => {
    if (playIsGoverned) return;
    const api = playerRef?.current; if (!api) return;
    if (typeof api.toggle === 'function') { api.toggle(); return; }
    const media = api.getMediaElement?.(); if (media) { media.paused ? api.play?.() : api.pause?.(); }
  };
  // Determine if navigation controls should be shown (only when queue has >1 items)
  const showNav = (hasPrev || hasNext);

  const Icon = {
    Back: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    ),
    Play: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    ),
    Pause: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
      </svg>
    ),
    Lock: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a5 5 0 0 0-5 5v3H5v14h14V10h-2V7a5 5 0 0 0-5-5zm-3 5a3 3 0 0 1 6 0v3H9V7zm3 6a2 2 0 1 1-0.001 3.999A2 2 0 0 1 12 13z" />
      </svg>
    ),
    Prev: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 5h2v14H6zM20 12L8 5v14l12-7z" />
      </svg>
    ),
    Next: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16 5h2v14h-2zM4 12l12 7V5L4 12z" />
      </svg>
    ),
    Close: () => (
      <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden="true">
        <line x1="5" y1="5" x2="19" y2="19" />
        <line x1="19" y1="5" x2="5" y2="19" />
      </svg>
    )
  };

  const closeInvokedRef = useRef(false);
  const handleClosePointerDown = useCallback((e) => {
    if (closeInvokedRef.current) return;
    closeInvokedRef.current = true;
    onClose?.(e);
  }, [onClose]);

  if (isLeft) {
    const zoomPrevDisabled = !(zoomNavState?.canStepBackward);
    const zoomNextDisabled = !(zoomNavState?.canStepForward);

    return (
  <div className="footer-controls-left" data-stalled={isStalled ? '1' : '0'}>
        <div className="control-buttons-container">
          {isZoomed ? (
            <>
              <div
                role="button"
                tabIndex={zoomPrevDisabled ? -1 : 0}
                aria-disabled={zoomPrevDisabled ? 'true' : undefined}
                onPointerDown={() => {
                  if (zoomPrevDisabled) return;
                  zoomNavState?.stepBackward?.();
                }}
                onKeyDown={(e) => {
                  if (!zoomPrevDisabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    zoomNavState?.stepBackward?.();
                  }
                }}
                className={`control-button zoom-prev-button${zoomPrevDisabled ? ' disabled' : ''}`}
                aria-label="Zoom to previous segment"
              >
                <span className="icon" aria-hidden="true">⏪</span>
              </div>
              <div
                role="button"
                tabIndex={zoomNextDisabled ? -1 : 0}
                aria-disabled={zoomNextDisabled ? 'true' : undefined}
                onPointerDown={() => {
                  if (zoomNextDisabled) return;
                  zoomNavState?.stepForward?.();
                }}
                onKeyDown={(e) => {
                  if (!zoomNextDisabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    zoomNavState?.stepForward?.();
                  }
                }}
                className={`control-button zoom-next-button${zoomNextDisabled ? ' disabled' : ''}`}
                aria-label="Zoom to next segment"
              >
                <span className="icon" aria-hidden="true">⏩</span>
              </div>
            </>
          ) : (
            <div
              role="button"
              tabIndex={0}
              // Use pointerDown for faster activation on large touch display
              onPointerDown={() => {
                if (playIsGoverned) {
                  return;
                }
                playPause();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!playIsGoverned) playPause();
                }
              }}
              className={`control-button play-pause-button${playIsGoverned ? ' governed' : ''}`}
              aria-label={playIsGoverned ? 'Playback locked' : (isPaused ? 'Play' : 'Pause')}
              aria-disabled={playIsGoverned ? 'true' : undefined}
            >
              <span className="icon">{playIsGoverned ? <Icon.Lock /> : (isPaused ? <Icon.Play /> : <Icon.Pause />)}</span>
            </div>
          )}
          {showNav && (
            <div
              role="button"
              tabIndex={hasPrev ? 0 : -1}
              aria-disabled={!hasPrev}
              onPointerDown={() => { if (hasPrev) onPrev(); }}
              onKeyDown={(e) => { if (hasPrev && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPrev(); } }}
              className="control-button prev-button"
              aria-label="Previous"
            >
              <span className="icon"><Icon.Prev /></span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
  <div className="footer-controls-right" data-stalled={isStalled ? '1' : '0'}>
      {showNav && (
        <div
          role="button"
          tabIndex={hasNext ? 0 : -1}
          aria-disabled={!hasNext}
          onPointerDown={() => { if (hasNext) onNext(); }}
          onKeyDown={(e) => { if (hasNext && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNext(); } }}
          className="control-button next-button"
          aria-label="Next"
        >
          <span className="icon"><Icon.Next /></span>
        </div>
      )}
      {isZoomed ? (
        <button
          type="button"
          onPointerDown={onBack}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBack?.(e); } }}
          className="control-button back-button"
          aria-label="Back"
        >
          <span className="icon" aria-hidden="true"><Icon.Back /></span>
        </button>
      ) : (
        <button
          type="button"
          onPointerDown={handleClosePointerDown}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClosePointerDown(e); } }}
          className="control-button close-button"
          aria-label="Close"
        >
          <span className="icon" aria-hidden="true"><Icon.Close /></span>
        </button>
      )}
    </div>
  );
}

FitnessPlayerFooterControls.propTypes = {
  section: PropTypes.oneOf(['left', 'right']).isRequired,
  isPaused: PropTypes.bool,
  playerRef: PropTypes.shape({ current: PropTypes.object }),
  onPrev: PropTypes.func,
  onNext: PropTypes.func,
  hasPrev: PropTypes.bool,
  hasNext: PropTypes.bool,
  onClose: PropTypes.func,
  isStalled: PropTypes.bool,
  isZoomed: PropTypes.bool,
  onBack: PropTypes.func,
  playIsGoverned: PropTypes.bool,
  zoomNavState: PropTypes.shape({
    canStepBackward: PropTypes.bool,
    canStepForward: PropTypes.bool,
    stepBackward: PropTypes.func,
    stepForward: PropTypes.func
  })
};
