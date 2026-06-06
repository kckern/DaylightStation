import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVolumeStore } from './VolumeProvider.jsx';

const defaultState = { level: 0.6, muted: false, source: 'global' };

const clamp01 = (v) => {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};

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

  // Duck multiplier owned by the volume system: every applied level is multiplied
  // by this (≤ 1), so a duck can only lower the video and no other volume event
  // can clobber it. Default 1 = no duck.
  const duckRef = useRef(1);

  const applyDucked = useCallback((resolved) => {
    if (!playerRef?.current) return resolved;
    const level = clamp01((resolved.level ?? 0) * duckRef.current);
    applyToPlayer(playerRef, { ...resolved, level });
    return resolved;
  }, [applyToPlayer, playerRef]);

  // Use useLayoutEffect for synchronous hydration before browser paint (3B fix)
  useLayoutEffect(() => {
    const resolved = getVolume(ids);
    volumeRef.current = resolved.level;
    setVolumeState(resolved.level);
    setMutedState(resolved.muted);
    setSource(resolved.source || defaultState.source);
    if (playerRef?.current) {
      applyDucked(resolved);
    }
  }, [ids, playerRef, getVolume, applyDucked, version]);

  const persistVolume = useCallback(
    (nextLevel) => {
      const resolved = setVolume(ids, { level: nextLevel });
      volumeRef.current = resolved.level; // Update ref synchronously (3B fix)
      setVolumeState(resolved.level);
      setMutedState(resolved.muted);
      setSource(resolved.source || 'exact');
      if (playerRef?.current) {
        applyDucked(resolved);
      }
      return resolved;
    },
    [ids, setVolume, applyDucked, playerRef]
  );

  const toggleMute = useCallback(
    () => {
      const resolved = setVolume(ids, { muted: !muted });
      setVolumeState(resolved.level);
      setMutedState(resolved.muted);
      setSource(resolved.source || 'exact');
      if (playerRef?.current) {
        applyDucked(resolved);
      }
      return resolved;
    },
    [ids, muted, setVolume, applyDucked, playerRef]
  );

  const apply = useCallback(
    (level = volume, muteState = muted) => {
      const resolved = { level, muted: muteState };
      if (playerRef?.current) {
        applyDucked(resolved);
      }
      return resolved;
    },
    [applyDucked, playerRef, volume, muted]
  );

  const setDuck = useCallback((multiplier) => {
    duckRef.current = clamp01(multiplier);
    // Re-apply the current level immediately so the duck takes effect (or lifts)
    // without waiting for the next volume event. A duck only ever touches level —
    // we deliberately omit `muted` so it can't re-assert a stale mute state.
    if (playerRef?.current) {
      applyDucked({ level: volumeRef.current });
    }
  }, [applyDucked, playerRef]);

  return useMemo(() => ({
    volume,
    volumeRef, // Synchronous ref for immediate volume access (3B fix)
    muted,
    source,
    setVolume: persistVolume,
    toggleMute,
    applyToPlayer: apply,
    setDuck,
  }), [volume, muted, source, persistVolume, toggleMute, apply, setDuck]);
}
