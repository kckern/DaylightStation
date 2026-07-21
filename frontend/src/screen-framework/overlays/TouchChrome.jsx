// frontend/src/screen-framework/overlays/TouchChrome.jsx
//
// TouchChrome — on-screen controls for touch-only screens (e.g. the Portal panel).
//
// Touch screens have no remote and no keyboard, and FullyKiosk kioskMode suppresses
// Android's Back button, so without this a user who opens content has no way out.
//
// This component is deliberately presentational: it holds no media state and never
// calls dismissOverlay() directly. Every button emits an existing ActionBus action so
// the established semantics still apply — Back emits `escape`, which runs the whole
// chain (MenuStack's pop-one-level interceptor, then PiP dismiss, then the YAML
// actions.escape fallback). Bypassing that would break menu navigation.
import React, { useMemo, useCallback } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import getLogger from '../../lib/logging/Logger.js';
import './TouchChrome.css';

export function TouchChrome({ mode = 'back' }) {
  const logger = useMemo(() => getLogger().child({ component: 'touch-chrome' }), []);

  const emit = useCallback((action, payload) => {
    logger.debug('touch-chrome.press', { action, ...payload });
    getActionBus().emit(action, payload);
  }, [logger]);

  const showMedia = mode === 'media';

  return (
    <div className="touch-chrome" role="toolbar" aria-label="Screen controls">
      <button
        type="button"
        className="touch-chrome__btn touch-chrome__btn--back"
        data-testid="touch-chrome-back"
        aria-label="Back"
        onClick={() => emit('escape', {})}
      >
        ←
      </button>

      {showMedia && (
        <>
          <div className="touch-chrome__group">
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-prev"
              aria-label="Previous" onClick={() => emit('media:playback', { command: 'prev' })}>⏮</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-playpause"
              aria-label="Play or pause" onClick={() => emit('media:playback', { command: 'toggle' })}>⏯</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-next"
              aria-label="Next" onClick={() => emit('media:playback', { command: 'next' })}>⏭</button>
          </div>

          {/* Direction-only labels: rew/fwd become ArrowLeft/ArrowRight and the Player
              owns the step size, so the control must not promise a duration. */}
          <div className="touch-chrome__group">
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-rew"
              aria-label="Seek backward" onClick={() => emit('media:playback', { command: 'rew' })}>↺</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-fwd"
              aria-label="Seek forward" onClick={() => emit('media:playback', { command: 'fwd' })}>↻</button>
          </div>

          <div className="touch-chrome__group touch-chrome__group--end">
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-vol-down"
              aria-label="Volume down" onClick={() => emit('display:volume', { command: 'down' })}>–</button>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-vol-up"
              aria-label="Volume up" onClick={() => emit('display:volume', { command: 'up' })}>+</button>
          </div>
        </>
      )}
    </div>
  );
}

export default TouchChrome;
