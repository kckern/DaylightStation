import React from 'react';

/*
 * FitnessPlayerFooterControls
 * Reusable control clusters (left/right) so future footer variants can opt in/out.
 * Props:
 *  - section: 'left' | 'right'
 *  - isPaused, mediaElRef, onPrev, onNext, hasPrev, hasNext, onClose
 *  - currentTime, duration, TimeDisplay, renderCount (only used on left)
 */
export default function FitnessPlayerFooterControls({
  section,
  isPaused,
  mediaElRef,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
  currentTime,
  duration,
  TimeDisplay,
  renderCount
}) {
  const isLeft = section === 'left';
  const playPause = () => {
    const el = mediaElRef?.current;
    if (!el) return;
    if (el.paused) el.play(); else el.pause();
  };
  // Determine if navigation controls should be shown (only when queue has >1 items)
  const showNav = (hasPrev || hasNext);

  const Icon = {
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

  if (isLeft) {
    return (
      <div className="footer-controls-left">
        <div className="control-buttons-container">
          <div
            role="button"
            tabIndex={0}
            onClick={playPause}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playPause(); } }}
            className="control-button play-pause-button"
            aria-label={isPaused ? 'Play' : 'Pause'}
          >
            <span className="icon">{isPaused ? <Icon.Play /> : <Icon.Pause />}</span>
          </div>
          {showNav && (
            <div
              role="button"
              tabIndex={hasPrev ? 0 : -1}
              aria-disabled={!hasPrev}
              onClick={() => { if (hasPrev) onPrev(); }}
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
    <div className="footer-controls-right">
      {showNav && (
        <div
          role="button"
          tabIndex={hasNext ? 0 : -1}
          aria-disabled={!hasNext}
          onClick={() => { if (hasNext) onNext(); }}
          onKeyDown={(e) => { if (hasNext && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNext(); } }}
          className="control-button next-button"
          aria-label="Next"
        >
          <span className="icon"><Icon.Next /></span>
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose(); } }}
        className="control-button close-button"
        aria-label="Close"
      >
        <span className="icon" aria-hidden="true"><Icon.Close /></span>
      </div>
    </div>
  );
}
