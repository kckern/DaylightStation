// frontend/src/screen-framework/providers/ScreenSceneContext.jsx
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// Tracks whether an ArtMode "scene" (the idle screensaver OR an ambient-loaded
// art preset) is currently mounted. The presence publisher reads this to mark
// art as passive (playing:false) even though it occupies a fullscreen overlay.
const ScreenSceneContext = createContext({ artSceneActive: false, setArtSceneActive: () => {} });

export function ScreenSceneProvider({ children }) {
  const [artSceneActive, setActive] = useState(false);
  const setArtSceneActive = useCallback((v) => setActive(!!v), []);
  const value = useMemo(() => ({ artSceneActive, setArtSceneActive }), [artSceneActive, setArtSceneActive]);
  return <ScreenSceneContext.Provider value={value}>{children}</ScreenSceneContext.Provider>;
}

export function useScreenScene() { return useContext(ScreenSceneContext); }

export default ScreenSceneContext;
