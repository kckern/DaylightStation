import { useEffect, useMemo } from 'react';
import { usePersistentVolume } from './usePersistentVolume.js';

const DEFAULT_VIDEO_IDS = {
  showId: 'fitness',
  seasonId: 'global',
  trackId: 'video'
};

// Shared hook that owns the video volume state once and wires it to the player ref.
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

  useEffect(() => {
    // Re-apply whenever identity changes so late-bound media elements pick up the state.
    videoVolume.applyToPlayer();
  }, [videoVolume, videoTrackId]);

  return useMemo(() => ({
    videoVolume
  }), [videoVolume]);
}
