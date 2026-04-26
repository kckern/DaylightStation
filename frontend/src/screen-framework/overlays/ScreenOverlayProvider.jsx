import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import './ScreenOverlayProvider.css';

const ScreenOverlayContext = createContext(null);

let toastIdCounter = 0;

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

export function ScreenOverlayProvider({ children }) {
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
    const { mode = 'fullscreen', position = 'top-right', priority, timeout = 3000 } = options;

    if (mode === 'fullscreen') {
      setFullscreen((current) => {
        if (current && priority !== 'high') {
          return current;
        }
        return { Component, props, priority };
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

  return (
    <ScreenOverlayContext.Provider value={{ showOverlay, dismissOverlay, hasOverlay, registerEscapeInterceptor, unregisterEscapeInterceptor, escapeInterceptorRef }}>
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
