import React, { createContext, useContext } from 'react';

/**
 * ScreenAmbientContext — carries the current screen's ambient config
 * ({ topic, curve, defaultLux } | null) so widgets like ArtMode dim from the
 * sensor of the room they run in, regardless of how they were mounted
 * (screensaver, triggered scene, or menu).
 */
const ScreenAmbientContext = createContext(null);

export function ScreenAmbientProvider({ value, children }) {
  return (
    <ScreenAmbientContext.Provider value={value ?? null}>
      {children}
    </ScreenAmbientContext.Provider>
  );
}

export function useScreenAmbient() {
  return useContext(ScreenAmbientContext);
}

export default ScreenAmbientContext;
