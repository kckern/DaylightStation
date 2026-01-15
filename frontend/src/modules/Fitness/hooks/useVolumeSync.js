import { useEffect, useRef } from 'react';
import { RESILIENCE_STATUS } from '../../Player/hooks/useResilienceState.js';

/**
 * Synchronizes volume state with media element on:
 * 1. Media ready (canplay event)
 * 2. Resilience recovery completion (recovering -> playing)
 * 3. Component remount
 */
export function useVolumeSync({
  mediaElement,
  resilienceStatus,
  applyVolume
}) {
  const prevStatusRef = useRef(resilienceStatus);
  const hasAppliedOnMountRef = useRef(false);

  // Apply volume when media becomes ready (canplay event)
  useEffect(() => {
    if (!mediaElement || typeof applyVolume !== 'function') return;

    const handleCanPlay = () => {
      applyVolume();
    };

    // Apply immediately if media is already ready
    if (mediaElement.readyState >= 3) {
      applyVolume();
      hasAppliedOnMountRef.current = true;
    }

    mediaElement.addEventListener('canplay', handleCanPlay);
    return () => {
      mediaElement.removeEventListener('canplay', handleCanPlay);
    };
  }, [mediaElement, applyVolume]);

  // Apply volume after resilience recovery completes
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = resilienceStatus;

    // Detect transition from recovering -> playing
    if (
      prevStatus === RESILIENCE_STATUS.recovering &&
      resilienceStatus === RESILIENCE_STATUS.playing
    ) {
      applyVolume?.();
    }
  }, [resilienceStatus, applyVolume]);

  // Apply on mount if media is ready but we haven't applied yet
  useEffect(() => {
    if (
      mediaElement &&
      !hasAppliedOnMountRef.current &&
      mediaElement.readyState >= 3
    ) {
      applyVolume?.();
      hasAppliedOnMountRef.current = true;
    }
  }, [mediaElement, applyVolume]);

  // Reset mount flag when media element changes (remount)
  useEffect(() => {
    hasAppliedOnMountRef.current = false;
  }, [mediaElement]);
}
