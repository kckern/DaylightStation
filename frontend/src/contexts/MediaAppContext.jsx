// frontend/src/contexts/MediaAppContext.jsx
import React, { createContext, useContext } from 'react';
import { useMediaQueue } from '../hooks/media/useMediaQueue.js';

const MediaAppContext = createContext(null);

export function MediaAppProvider({ children }) {
  const queue = useMediaQueue();

  return (
    <MediaAppContext.Provider value={{ queue }}>
      {children}
    </MediaAppContext.Provider>
  );
}

export function useMediaApp() {
  const ctx = useContext(MediaAppContext);
  if (!ctx) throw new Error('useMediaApp must be used within MediaAppProvider');
  return ctx;
}
