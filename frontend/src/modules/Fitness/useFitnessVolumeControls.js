import { useMemo } from 'react';
import { usePersistentVolume } from './usePersistentVolume.js';

const DEFAULT_VIDEO_IDS = {
  showId: 'fitness',
  seasonId: 'global',
  trackId: 'video'
};

/**
 * Shared hook that owns the video volume state and wires it to the player ref.
 * Volume application is delegated to useVolumeSync in the consuming component.
 */
export function useFitnessVolumeControls({
  videoPlayerRef,
  videoShowId,
  videoSeasonId,
  videoTrackId
} = {}) {
  const videoVolume = usePersistentVolume({
    showId: videoShowId || DEFAULT_VIDEO_IDS.showId,
    seasonId: videoSeasonId || DEFAULT_VIDEO_IDS.seasonId,
    trackId: videoTrackId || DEFAULT_VIDEO_IDS.trackId,
    playerRef: videoPlayerRef
  });

  return useMemo(() => ({
    videoVolume
  }), [videoVolume]);
}
