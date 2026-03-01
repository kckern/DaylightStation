import React, { createContext, useContext, useState, useCallback } from 'react';
import './ScreenOverlayProvider.css';

const ScreenOverlayContext = createContext(null);

export function ScreenOverlayProvider({ children }) {
  const [overlay, setOverlay] = useState(null);

  const showOverlay = useCallback((Component, props = {}) => {
    setOverlay({ Component, props });
  }, []);

  const dismissOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  const hasOverlay = overlay !== null;

  return (
    <ScreenOverlayContext.Provider value={{ showOverlay, dismissOverlay, hasOverlay }}>
      {children}
      {overlay && (
        <div className="screen-overlay-layer">
          <overlay.Component {...overlay.props} dismiss={dismissOverlay} />
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
