import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import TouchChrome from './TouchChrome.jsx';
import { useHasMenuNavigationContext, useMenuNavigationContext } from '../../context/MenuNavigationContext.jsx';
import './ScreenOverlayProvider.css';

const ScreenOverlayContext = createContext(null);

let toastIdCounter = 0;

// Content types on the MenuNavigation stack that are "just browsing" and must
// never light up the media transport: media:playback {command:'toggle'} is
// translated into a synthetic Enter keydown by ScreenActionHandler, and on a
// menu Enter activates the highlighted item. Showing play/pause while
// browsing would let a mis-tap launch whatever happens to be selected.
const BROWSE_TYPES = new Set(['menu', 'plex-menu', 'show-view', 'season-view']);

function isNavStackContent(currentContent) {
  return !!currentContent && !BROWSE_TYPES.has(currentContent.type);
}

// Reads currentContent from the nav stack and renders the chrome lane with
// the derived mode. Only ever mounted when useHasMenuNavigationContext() is
// true (see TouchChromeLane below), so calling the throwing accessor here is
// safe -- and it is called unconditionally within this component, satisfying
// the rules of hooks.
function NavAwareTouchChrome({ overlayChrome }) {
  const { currentContent } = useMenuNavigationContext();
  const mode = (overlayChrome === 'media' || isNavStackContent(currentContent)) ? 'media' : 'back';
  return <TouchChrome mode={mode} />;
}

// Screen-level touch control lane. Chrome mode considers BOTH content paths:
// a showOverlay() fullscreen record (its `chrome` option) and MenuStack's
// nav-stack push (MenuStack.jsx:126 pushes the Player directly, with no
// fullscreen record at all -- the case this component exists to cover).
// useHasMenuNavigationContext() is always called (never throws), and only
// gates which child renders -- it does not gate a hook call itself.
function TouchChromeLane({ overlayChrome }) {
  const hasNavContext = useHasMenuNavigationContext();
  if (hasNavContext) {
    return <NavAwareTouchChrome overlayChrome={overlayChrome} />;
  }
  return <TouchChrome mode={overlayChrome === 'media' ? 'media' : 'back'} />;
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
        // Touch screens get a reserved control lane wrapping EVERYTHING, not just
        // a fullscreen overlay: MenuStack pushes the Player straight onto the nav
        // stack (no showOverlay call at all), so the lane has to sit above the
        // whole screen to guarantee a touch user always has a way back.
        <div className="screen-overlay--touch-shell">
          <div className="screen-overlay--touch-content">
            {content}
          </div>
          <TouchChromeLane overlayChrome={fullscreen?.chrome} />
        </div>
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
