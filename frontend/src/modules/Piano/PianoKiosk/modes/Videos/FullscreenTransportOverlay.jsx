import Icon from '../../icons/Icon.jsx';

/**
 * Tap-summoned transport for fullscreen playback. The chrome strip is offscreen
 * while the video surface is browser-fullscreen, so a tap raises this overlay
 * instead: −30/−15 · play/pause · +15/+30, plus the way back out of fullscreen.
 * Tapping the backdrop dismisses it without changing the play state.
 */
export default function FullscreenTransportOverlay({
  isPlaying, onSkip, onToggle, onExitFullscreen, onDismiss, forwardDisabled = false,
}) {
  const act = (fn, ...args) => (e) => { e.stopPropagation(); fn(...args); };
  return (
    <div className="piano-fs-overlay" onClick={act(onDismiss)}>
      <div className="piano-fs-overlay__cluster" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="piano-fs-overlay__btn" onClick={act(onSkip, -30)} aria-label="Back 30 seconds"><Icon name="skip-back-30" /></button>
        <button type="button" className="piano-fs-overlay__btn" onClick={act(onSkip, -15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-fs-overlay__btn piano-fs-overlay__btn--play" onClick={act(onToggle)} aria-label={isPlaying ? 'Pause' : 'Play'}><Icon name={isPlaying ? 'pause' : 'play'} /></button>
        <button type="button" className="piano-fs-overlay__btn" onClick={act(onSkip, 15)} disabled={forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <button type="button" className="piano-fs-overlay__btn" onClick={act(onSkip, 30)} disabled={forwardDisabled} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /></button>
      </div>
      <button type="button" className="piano-fs-overlay__exit" onClick={act(onExitFullscreen)} aria-label="Exit fullscreen">
        <Icon name="fullscreen-exit" /> Exit fullscreen
      </button>
    </div>
  );
}
