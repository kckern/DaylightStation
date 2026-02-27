// frontend/src/contexts/MediaAppContext.jsx
import React, { createContext, useContext, useRef } from 'react';
import { useMediaQueue } from '../hooks/media/useMediaQueue.js';

const MediaAppContext = createContext(null);

export function MediaAppProvider({ children }) {
  const queue = useMediaQueue();
  const playerRef = useRef(null);

  return (
    <MediaAppContext.Provider value={{ queue, playerRef }}>
      {children}
    </MediaAppContext.Provider>
  );
}

export function useMediaApp() {
  const ctx = useContext(MediaAppContext);
  if (!ctx) throw new Error('useMediaApp must be used within MediaAppProvider');
  return ctx;
}
