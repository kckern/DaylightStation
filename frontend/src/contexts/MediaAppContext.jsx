// frontend/src/contexts/MediaAppContext.jsx
import React, { createContext, useContext, useEffect, useRef, useMemo } from 'react';
import { useMediaQueue } from '../hooks/media/useMediaQueue.js';
import getLogger from '../lib/logging/Logger.js';

const MediaAppContext = createContext(null);

export function MediaAppProvider({ children }) {
  const logger = useMemo(() => getLogger().child({ component: 'MediaAppContext' }), []);
  const queue = useMediaQueue();
  const playerRef = useRef(null);

  useEffect(() => {
    logger.info('media-context.initialized', { queueLoading: queue.loading });
    return () => logger.info('media-context.unmounted');
  }, [logger]);

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
