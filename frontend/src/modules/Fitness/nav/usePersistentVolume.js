import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVolumeStore } from './VolumeProvider.jsx';

const defaultState = { level: 0.6, muted: false, source: 'global' };

const normalizePart = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return fallback;
  return normalized;
};

export function usePersistentVolume({ grandparentId, parentId, trackId, playerRef } = {}) {
  const { getVolume, setVolume, applyToPlayer, version } = useVolumeStore();
  const ids = useMemo(
    () => ({
      grandparentId: normalizePart(grandparentId, 'fitness'),
      parentId: normalizePart(parentId, 'global'),
      trackId: normalizePart(trackId, null)
    }),
    [grandparentId, parentId, trackId]
  );
  
  // Synchronously initialize volume from storage on first render (3B fix)
  // Note: Compute synchronously without memoization to avoid stale closure issues when ids change
  const [volume, setVolumeState] = useState(() => getVolume(ids).level);
  const [muted, setMutedState] = useState(() => getVolume(ids).muted);
  const [source, setSource] = useState(() => getVolume(ids).source || defaultState.source);
  
  // Use ref to hold current volume synchronously for immediate access
  const volumeRef = useRef(getVolume(ids).level);

  // Use useLayoutEffect for synchronous hydration before browser paint (3B fix)
  useLayoutEffect(() => {
    const resolved = getVolume(ids);
    volumeRef.current = resolved.level;
    setVolumeState(resolved.level);
    setMutedState(resolved.muted);
    setSource(resolved.source || defaultState.source);
    if (playerRef?.current) {
      applyToPlayer(playerRef, resolved);
    }
  }, [ids, playerRef, getVolume, applyToPlayer, version]);

  const persistVolume = useCallback(
    (nextLevel) => {
      const resolved = setVolume(ids, { level: nextLevel });
      volumeRef.current = resolved.level; // Update ref synchronously (3B fix)
      setVolumeState(resolved.level);
      setMutedState(resolved.muted);
      setSource(resolved.source || 'exact');
      if (playerRef?.current) {
        applyToPlayer(playerRef, resolved);
      }
      return resolved;
    },
    [ids, setVolume, applyToPlayer, playerRef]
  );

  const toggleMute = useCallback(
    () => {
      const resolved = setVolume(ids, { muted: !muted });
      setVolumeState(resolved.level);
      setMutedState(resolved.muted);
      setSource(resolved.source || 'exact');
      if (playerRef?.current) {
        applyToPlayer(playerRef, resolved);
      }
      return resolved;
    },
    [ids, muted, setVolume, applyToPlayer, playerRef]
  );

  const apply = useCallback(
    (level = volume, muteState = muted) => {
      const resolved = { level, muted: muteState };
      if (playerRef?.current) {
        applyToPlayer(playerRef, resolved);
      }
      return resolved;
    },
    [applyToPlayer, playerRef, volume, muted]
  );

  return useMemo(() => ({
    volume,
    volumeRef, // Synchronous ref for immediate volume access (3B fix)
    muted,
    source,
    setVolume: persistVolume,
    toggleMute,
    applyToPlayer: apply,
  }), [volume, muted, source, persistVolume, toggleMute, apply]);
}
