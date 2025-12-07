import { useCallback, useEffect, useMemo, useState } from 'react';
import { useVolumeStore } from './VolumeProvider.jsx';

const defaultState = { level: 0.6, muted: false, source: 'global' };

export function usePersistentVolume({ showId, seasonId, trackId, playerRef } = {}) {
  const { getVolume, setVolume, applyToPlayer } = useVolumeStore();
  const ids = useMemo(() => ({ showId, seasonId, trackId }), [showId, seasonId, trackId]);
  const [volume, setVolumeState] = useState(defaultState.level);
  const [muted, setMutedState] = useState(defaultState.muted);
  const [source, setSource] = useState(defaultState.source);

  useEffect(() => {
    const resolved = getVolume(ids);
    setVolumeState(resolved.level);
    setMutedState(resolved.muted);
    setSource(resolved.source || defaultState.source);
    if (playerRef?.current) {
      applyToPlayer(playerRef, resolved);
    }
  }, [ids, playerRef, getVolume, applyToPlayer]);

  const persistVolume = useCallback(
    (nextLevel) => {
      const resolved = setVolume(ids, { level: nextLevel });
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

  return {
    volume,
    muted,
    source,
    setVolume: persistVolume,
    toggleMute,
    applyToPlayer: apply,
  };
}
