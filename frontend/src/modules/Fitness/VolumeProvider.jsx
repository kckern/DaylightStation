import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createVolumeStore } from './volumeStorage.js';

const VolumeContext = createContext(null);

const clamp01 = (value) => {
  if (!Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const applyVolumeToMedia = (media, state) => {
  if (!media || !state) return;
  const level = clamp01(state.level);
  const muted = typeof state.muted === 'boolean' ? state.muted : undefined;

  if (level !== undefined) {
    if (typeof media.setVolume === 'function') {
      media.setVolume(level);
    } else if (typeof media.volume === 'number') {
      media.volume = level;
    }
  }

  if (muted !== undefined) {
    if (typeof media.setMuted === 'function') {
      media.setMuted(muted);
    } else if (typeof media.muted === 'boolean') {
      media.muted = muted;
    }
  }
};

export const VolumeProvider = ({ children, storage, now }) => {
  const storeRef = useRef(null);
  const [, bumpVersion] = useState(0);

  if (!storeRef.current) {
    storeRef.current = createVolumeStore({
      storage,
      now,
      onStorageError: () => bumpVersion((v) => v + 1)
    });
  }

  const getVolume = useCallback((ids) => storeRef.current.getVolume(ids), []);

  const setVolume = useCallback(
    (ids, patch) => {
      const next = storeRef.current.setVolume(ids, patch);
      bumpVersion((v) => v + 1);
      return next;
    },
    []
  );

  const applyToPlayer = useCallback((playerRef, state) => {
    if (!playerRef || !playerRef.current) return;
    const media = playerRef.current.getMediaElement?.() || playerRef.current;
    applyVolumeToMedia(media, state);
  }, []);

  const value = useMemo(
    () => ({
      getVolume,
      setVolume,
      applyToPlayer,
      isStorageHealthy: () => storeRef.current.isStorageHealthy(),
      getSnapshot: storeRef.current.getSnapshot
    }),
    [getVolume, setVolume, applyToPlayer]
  );

  return <VolumeContext.Provider value={value}>{children}</VolumeContext.Provider>;
};

export const useVolumeStore = () => {
  const ctx = useContext(VolumeContext);
  if (!ctx) {
    throw new Error('useVolumeStore must be used within VolumeProvider');
  }
  return ctx;
};
