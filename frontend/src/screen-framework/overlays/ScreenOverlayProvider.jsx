import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import TouchChrome from './TouchChrome.jsx';
import { useHasMenuNavigationContext, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import { BROWSE_NAV_TYPES } from '../screenActivity.js';
import getLogger from '../../lib/logging/Logger.js';
import './ScreenOverlayProvider.css';

const ScreenOverlayContext = createContext(null);

// Lazy module-level logger: getLogger() must not run at import time.
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'screen-overlay' });
  return _logger;
}

let toastIdCounter = 0;

// Content types on the MenuNavigation stack that are "just browsing" and must
// never light up the media transport: media:playback {command:'toggle'} is
// translated into a synthetic Enter keydown by ScreenActionHandler, and on a
// menu Enter activates the highlighted item. Showing play/pause while
// browsing would let a mis-tap launch whatever happens to be selected.
// BROWSE_NAV_TYPES (screenActivity.js) is the single source of truth for
// this distinction -- do not redeclare it here.
function isNavStackContent(currentContent) {
  return !!currentContent && !BROWSE_NAV_TYPES.has(currentContent.type);
}

// Elements whose own tap must not ALSO be read as a play/pause gesture on the
// surrounding surface. Covers generic controls, the Player's seek affordances
// (ProgressBar renders `.progress-bar`; ContentScroller renders `.seek-bar`
// inside `.controls`), and its click-to-resume overlay (`.loading-overlay`).
// `data-no-fullscreen` is this codebase's existing opt-out marker for surface
// tap gestures (see the Fitness player) -- honour it here too so a single
// annotation works for both. `data-no-tap-toggle` is the explicit opt-out.
const TAP_EXEMPT_SELECTOR = [
  'button', 'a', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="slider"]',
  '.progress-bar', '.seek-bar', '.controls', '.loading-overlay',
  '[data-no-fullscreen]', '[data-no-tap-toggle]',
].join(',');

// Shell layout for touch screens: a content box that doubles as a play/pause
// tap target, above the control lane.
//
// The lane is CONTENT-ONLY (`showChrome`): it appears once something sits over
// the screen's own layout -- a fullscreen overlay (a cast) or anything on the
// nav stack (menu, player) -- and is absent while the screen shows nothing but
// its bare layout. There is no "back" to offer there, and the Portal's layout
// is the School app, which carries its own header, back-navigation and
// transport; a second bar under it stole 80px of an 800px panel and
// letterboxed 16:9 video for navigation the app already offered. A screen
// whose layout has no way back of its own must not rely on this lane.
//
// The surface gesture is armed ONLY in 'media' mode. In 'back' mode the user is
// browsing, and media:playback {command:'toggle'} is translated by
// ScreenActionHandler into a synthetic Enter keydown -- which on a menu
// activates the highlighted item. An always-armed surface would turn any stray
// tap on menu whitespace into "launch whatever is selected".
function TouchShellLayout({ mode, showChrome, children }) {
  const isMedia = mode === 'media';

  const handleSurfaceTap = useCallback((event) => {
    // Let real controls own their own taps -- otherwise seeking would also
    // toggle playback, and the chrome's own buttons would fire twice.
    if (event.target?.closest?.(TAP_EXEMPT_SELECTOR)) return;
    logger().debug('touch-surface.toggle', {});
    getActionBus().emit('media:playback', { command: 'toggle' });
  }, []);

  return (
    <div className="screen-overlay--touch-shell">
      <div
        className={`screen-overlay--touch-content${isMedia ? ' screen-overlay--touch-content-tappable' : ''}`}
        onClick={isMedia ? handleSurfaceTap : undefined}
      >
        {children}
      </div>
      {showChrome && <TouchChrome mode={mode} />}
    </div>
  );
}

// Reads currentContent from the nav stack and renders the shell with the
// derived mode. Only ever mounted when useHasMenuNavigationContext() is
// true (see TouchShell below), so calling the throwing accessor here is
// safe -- and it is called unconditionally within this component, satisfying
// the rules of hooks.
function NavAwareTouchShell({ overlayChrome, hasOverlay, children }) {
  const { currentContent } = useMenuNavigationContext();
  const mode = (overlayChrome === 'media' || isNavStackContent(currentContent)) ? 'media' : 'back';
  return (
    <TouchShellLayout mode={mode} showChrome={hasOverlay || !!currentContent}>
      {children}
    </TouchShellLayout>
  );
}

// Screen-level touch shell. Mode considers BOTH content paths: a showOverlay()
// fullscreen record (its `chrome` option) and MenuStack's nav-stack push
// (MenuStack.jsx:126 pushes the Player directly, with no fullscreen record at
// all -- the case this component exists to cover). Mode is derived ONCE here
// and drives both the chrome lane and whether the surface gesture is armed, so
// the two can never disagree.
// useHasMenuNavigationContext() is always called (never throws), and only
// gates which child renders -- it does not gate a hook call itself.
function TouchShell({ overlayChrome, hasOverlay, children }) {
  const hasNavContext = useHasMenuNavigationContext();
  if (hasNavContext) {
    return (
      <NavAwareTouchShell overlayChrome={overlayChrome} hasOverlay={hasOverlay}>
        {children}
      </NavAwareTouchShell>
    );
  }
  return (
    <TouchShellLayout mode={overlayChrome === 'media' ? 'media' : 'back'} showChrome={hasOverlay}>
      {children}
    </TouchShellLayout>
  );
}

function ToastWrapper({ Component, props, timeout, onDismiss }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (timeout > 0) {
      timerRef.current = setTimeout(() => {
        onDismiss();
      }, timeout);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [timeout, onDismiss]);

  return (
    <div className="screen-overlay--toast">
      <Component {...props} dismiss={onDismiss} />
    </div>
  );
}

export function ScreenOverlayProvider({ children, inputType = null }) {
  const [fullscreen, setFullscreen] = useState(null);
  const [pip, setPip] = useState(null);
  const [toasts, setToasts] = useState([]);
  const escapeInterceptorRef = useRef(null);

  const registerEscapeInterceptor = useCallback((fn) => {
    escapeInterceptorRef.current = fn;
  }, []);

  const unregisterEscapeInterceptor = useCallback(() => {
    escapeInterceptorRef.current = null;
  }, []);

  const showOverlay = useCallback((Component, props = {}, options = {}) => {
    const { mode = 'fullscreen', position = 'top-right', priority, timeout = 3000, chrome = 'back' } = options;

    if (mode === 'fullscreen') {
      setFullscreen((current) => {
        if (current && priority !== 'high') {
          return current;
        }
        return { Component, props, priority, chrome };
      });
    } else if (mode === 'pip') {
      setPip({ Component, props, position });
    } else if (mode === 'toast') {
      const id = ++toastIdCounter;
      setToasts((prev) => [...prev, { id, Component, props, timeout }]);
    }
  }, []);

  const dismissOverlay = useCallback((mode = 'fullscreen') => {
    if (mode === 'fullscreen') {
      setFullscreen(null);
    } else if (mode === 'pip') {
      setPip(null);
    } else if (mode === 'toast') {
      setToasts([]);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // hasOverlay intentionally reflects ONLY fullscreen state — pip is non-blocking
  // and must not release the menu-suppression gate or report as a blocking overlay.
  const hasOverlay = fullscreen !== null;

  // Emit on the ActionBus when a fullscreen overlay first mounts.
  // Used by useInitialActionGate to release the menu-flash suppression
  // gate as soon as the player (or any other overlay) takes over the screen.
  useEffect(() => {
    if (!fullscreen) return;
    getActionBus().emit('screen:overlay-mounted', { mode: 'fullscreen' });
  }, [fullscreen]);

  const content = (
    <>
      {children}
      {fullscreen && (
        <div className="screen-overlay--fullscreen">
          <fullscreen.Component {...fullscreen.props} dismiss={() => dismissOverlay('fullscreen')} />
        </div>
      )}
      {pip && (
        <div
          className={`screen-overlay--pip screen-overlay--pip-${pip.position || 'top-right'}`}
        >
          <pip.Component {...pip.props} dismiss={() => dismissOverlay('pip')} />
        </div>
      )}
    </>
  );

  return (
    <ScreenOverlayContext.Provider value={{ showOverlay, dismissOverlay, hasOverlay, registerEscapeInterceptor, unregisterEscapeInterceptor, escapeInterceptorRef }}>
      {inputType === 'touch' ? (
        // Touch screens get the shell wrapping EVERYTHING, not just a fullscreen
        // overlay: MenuStack pushes the Player straight onto the nav stack (no
        // showOverlay call at all), so the lane has to sit above the whole screen
        // to guarantee a touch user always has a way back OUT OF CONTENT. It is
        // not drawn while the screen shows its own layout — see TouchShellLayout.
        <TouchShell overlayChrome={fullscreen?.chrome} hasOverlay={hasOverlay}>
          {content}
        </TouchShell>
      ) : (
        content
      )}
      {toasts.length > 0 && (
        <div className="screen-overlay--toast-stack">
          {toasts.map((toast) => (
            <ToastWrapper
              key={toast.id}
              Component={toast.Component}
              props={toast.props}
              timeout={toast.timeout}
              onDismiss={() => dismissToast(toast.id)}
            />
          ))}
        </div>
      )}
    </ScreenOverlayContext.Provider>
  );
}

export function useScreenOverlay() {
  const ctx = useContext(ScreenOverlayContext);
  if (!ctx) {
    return { showOverlay: () => {}, dismissOverlay: () => {}, hasOverlay: false };
  }
  return ctx;
}
