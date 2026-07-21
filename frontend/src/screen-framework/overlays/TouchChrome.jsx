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
//
// Layout: three zones (leave | transport | adjust). The transport is symmetric —
// two controls either side of play/pause — so play/pause lands on the exact centre
// of the panel. Only play/pause is chromed; every other control is a bare icon, so
// the one filled disc reads as "the button" from across the room.
//
// Icons are inline SVG rather than unicode: glyphs like ⏯ and ↺ depend on the
// device font stack and render as boxes or mismatched emoji on the Android 9
// WebView this runs on.
import React, { useMemo, useCallback } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import getLogger from '../../lib/logging/Logger.js';
import './TouchChrome.css';

/** 24x24 icon frame. Transport marks are filled — they hold up better at arm's
 *  length than hairline strokes. Back and volume are stroked. */
function Icon({ children, size = 26 }) {
  return (
    <svg
      className="touch-chrome__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const IconBack = (
  <Icon>
    <path
      d="M20 12H5M11 6l-6 6 6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Icon>
);

const IconPrev = (
  <Icon>
    <path d="M6 5h2.4v14H6z" fill="currentColor" />
    <path d="M20 5v14l-9.6-7z" fill="currentColor" />
  </Icon>
);

const IconRew = (
  <Icon>
    <path d="M11.5 5v14L3 12z" fill="currentColor" />
    <path d="M21 5v14l-8.5-7z" fill="currentColor" />
  </Icon>
);

const IconFwd = (
  <Icon>
    <path d="M12.5 5v14L21 12z" fill="currentColor" />
    <path d="M3 5v14l8.5-7z" fill="currentColor" />
  </Icon>
);

const IconNext = (
  <Icon>
    <path d="M15.6 5H18v14h-2.4z" fill="currentColor" />
    <path d="M4 5v14l9.6-7z" fill="currentColor" />
  </Icon>
);

// Play + pause together: the control is a toggle and the chrome holds no media
// state, so showing only one of the two would be wrong half the time.
const IconPlayPause = (
  <Icon size={24}>
    <path d="M3 5v14l10-7z" fill="currentColor" />
    <path d="M15.5 5H18v14h-2.5zM20 5h2.5v14H20z" fill="currentColor" />
  </Icon>
);

const IconVolDown = (
  <Icon size={24}>
    <path d="M3 9.5h3.2L10 6v12L6.2 14.5H3z" fill="currentColor" />
    <path d="M14 12h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Icon>
);

const IconVolUp = (
  <Icon size={24}>
    <path d="M3 9.5h3.2L10 6v12L6.2 14.5H3z" fill="currentColor" />
    <path d="M14 12h6M17 9v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Icon>
);

export function TouchChrome({ mode = 'back' }) {
  const logger = useMemo(() => getLogger().child({ component: 'touch-chrome' }), []);

  const emit = useCallback((action, payload) => {
    logger.debug('touch-chrome.press', { action, ...payload });
    getActionBus().emit(action, payload);
  }, [logger]);

  const showMedia = mode === 'media';

  return (
    <div className="touch-chrome" role="toolbar" aria-label="Screen controls">
      <div className="touch-chrome__zone touch-chrome__zone--leave">
        <button
          type="button"
          className="touch-chrome__btn"
          data-testid="touch-chrome-back"
          aria-label="Back"
          onClick={() => emit('escape', {})}
        >
          {IconBack}
        </button>
      </div>

      <div className="touch-chrome__zone touch-chrome__zone--transport">
        {showMedia && (
          <>
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-prev"
              aria-label="Previous" onClick={() => emit('media:playback', { command: 'prev' })}>
              {IconPrev}
            </button>

            {/* Seek carries no duration: rew/fwd become ArrowLeft/ArrowRight and the
                Player owns the step size, so the icon must not promise an interval. */}
            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-rew"
              aria-label="Seek backward" onClick={() => emit('media:playback', { command: 'rew' })}>
              {IconRew}
            </button>

            <button type="button" className="touch-chrome__btn touch-chrome__btn--primary"
              data-testid="touch-chrome-playpause"
              aria-label="Play or pause" onClick={() => emit('media:playback', { command: 'toggle' })}>
              {IconPlayPause}
            </button>

            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-fwd"
              aria-label="Seek forward" onClick={() => emit('media:playback', { command: 'fwd' })}>
              {IconFwd}
            </button>

            <button type="button" className="touch-chrome__btn" data-testid="touch-chrome-next"
              aria-label="Next" onClick={() => emit('media:playback', { command: 'next' })}>
              {IconNext}
            </button>
          </>
        )}
      </div>

      <div className="touch-chrome__zone touch-chrome__zone--adjust">
        {showMedia && (
          <>
            {/* handleVolume (ScreenActionHandler) only accepts '+1' / '-1' / 'mute_toggle' —
                anything else (e.g. 'up'/'down') falls through to volume.unknown-command and
                is silently ignored. Do not "modernise" these back to up/down. */}
            <button type="button" className="touch-chrome__btn touch-chrome__btn--quiet"
              data-testid="touch-chrome-vol-down"
              aria-label="Volume down" onClick={() => emit('display:volume', { command: '-1' })}>
              {IconVolDown}
            </button>
            <button type="button" className="touch-chrome__btn touch-chrome__btn--quiet"
              data-testid="touch-chrome-vol-up"
              aria-label="Volume up" onClick={() => emit('display:volume', { command: '+1' })}>
              {IconVolUp}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default TouchChrome;
