import { useCallback, useMemo } from 'react';
import { usePersistentVolume } from './usePersistentVolume.js';
import { GAME_DEFAULT_LEVEL, gameVolumeIds, resolveGameVolume, storedVolumeFromLevel } from './gameVolumeModel.js';

/**
 * A fitness game's own volume (see gameVolumeModel.js): button level 0..100 on
 * the house log curve, persisted in the fitness volume store under the game's
 * own track. `output` is the gain every game voice is multiplied by.
 */
export function useGameVolume(gameId, { defaultLevel = GAME_DEFAULT_LEVEL } = {}) {
  const ids = useMemo(() => gameVolumeIds(gameId), [gameId]);
  const store = usePersistentVolume(ids);
  const resolved = resolveGameVolume(store, { defaultLevel });
  const { setVolume: storeSetVolume, toggleMute: storeToggleMute } = store;
  const { level, muted, isDefault } = resolved;

  const setLevel = useCallback((nextLevel) => {
    const clamped = Math.max(0, Math.min(100, Number(nextLevel) || 0));
    storeSetVolume(storedVolumeFromLevel(clamped));
    // Picking a level is a request to hear it: lift a mute (level 0 is silent anyway).
    if (store.muted && clamped > 0) storeToggleMute();
  }, [storeSetVolume, storeToggleMute, store.muted]);

  const toggleMute = useCallback(() => {
    // An unset track resolves to the store's global fallback; pin the default
    // level first so muting never persists that fallback as the game level.
    if (isDefault) storeSetVolume(storedVolumeFromLevel(level));
    if (level <= 0 && muted) { storeSetVolume(storedVolumeFromLevel(defaultLevel)); return; }
    storeToggleMute();
  }, [isDefault, level, muted, defaultLevel, storeSetVolume, storeToggleMute]);

  return useMemo(() => ({ ...resolved, setLevel, toggleMute }), [resolved.level, resolved.output, resolved.muted, resolved.isDefault, setLevel, toggleMute]); // eslint-disable-line react-hooks/exhaustive-deps
}
