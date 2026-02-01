import { useMemo } from 'react';
import { usePersistentVolume } from './usePersistentVolume.js';

const DEFAULT_VIDEO_IDS = {
  grandparentId: 'fitness',
  parentId: 'global',
  trackId: 'video'
};

/**
 * Shared hook that owns the video volume state and wires it to the player ref.
 * Volume application is delegated to useVolumeSync in the consuming component.
 */
export function useFitnessVolumeControls({
  videoPlayerRef,
  videoGrandparentId,
  videoParentId,
  videoTrackId
} = {}) {
  const videoVolume = usePersistentVolume({
    grandparentId: videoGrandparentId || DEFAULT_VIDEO_IDS.grandparentId,
    parentId: videoParentId || DEFAULT_VIDEO_IDS.parentId,
    trackId: videoTrackId || DEFAULT_VIDEO_IDS.trackId,
    playerRef: videoPlayerRef
  });

  return useMemo(() => ({
    videoVolume
  }), [videoVolume]);
}
