import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVolumeStore } from '../VolumeProvider.jsx';

const amplifiers = new WeakMap();

const cleanupAmplifier = (element) => {
  if (!element) return;
  const amp = amplifiers.get(element);
  if (!amp) return;
  try {
    amp.source?.disconnect?.();
  } catch (e) {
    console.warn('Amplifier source disconnect failed', e);
  }
  try {
    amp.gainNode?.disconnect?.();
  } catch (e) {
    console.warn('Amplifier gainNode disconnect failed', e);
  }
  try {
    amp.context?.close?.();
  } catch (e) {
    console.warn('Amplifier context close failed', e);
  }
  amplifiers.delete(element);
};

const buildAmplifier = (element, boostLevel) => {
  const Context = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!Context) return null;

  const context = new Context();
  let source;
  try {
    source = context.createMediaElementSource(element);
  } catch (e) {
    console.error('Failed to create MediaElementSource', e);
    try {
      context.close();
    } catch (_) {
      /* ignore */
    }
    return null;
  }
  const gainNode = context.createGain();

  source.connect(gainNode);
  gainNode.connect(context.destination);

  const amp = { context, source, gainNode, boost: boostLevel };
  amplifiers.set(element, amp);
  return amp;
};

const normalizePart = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return fallback;
  return normalized;
};

export const useMediaAmplifier = (mediaElement, { showId, seasonId, trackId } = {}) => {
  const { getVolume, setVolume } = useVolumeStore();
  
  const ids = useMemo(
    () => ({
      showId: normalizePart(showId, 'fitness'),
      seasonId: normalizePart(seasonId, 'global'),
      trackId: normalizePart(trackId, null)
    }),
    [showId, seasonId, trackId]
  );

  const [boostLevel, setBoostLevel] = useState(1);
  const amplifierRef = useRef(null);

  useEffect(() => {
    const resolved = getVolume(ids);
    if (resolved && typeof resolved.boost === 'number') {
      setBoostLevel(resolved.boost);
    }
  }, [ids, getVolume]);

  useEffect(() => {
    // Clear stale ref when the element changes
    amplifierRef.current = null;

    if (!mediaElement) {
      return undefined;
    }

    // Recreate or reuse amplifier when the element changes or becomes available
    const ensureAmplifier = () => {
      const existing = amplifiers.get(mediaElement);
      const wiredElement = existing?.source?.mediaElement || null;

      // If the stored amplifier is bound to a different element, rebuild
      if (existing && wiredElement && wiredElement !== mediaElement) {
        cleanupAmplifier(mediaElement);
      }

      if (!amplifiers.has(mediaElement)) {
        const created = buildAmplifier(mediaElement, boostLevel);
        if (!created) return null;
      }

      const amp = amplifiers.get(mediaElement) || null;
      if (amp) {
        amp.boost = boostLevel;
        amplifierRef.current = amp;
      }
      return amp;
    };

    const amp = ensureAmplifier();
    if (!amp) return undefined;

    // Sync gain based on element volume and boost
    const syncGain = () => {
      if (!amplifierRef.current) return;
      const volume = mediaElement.muted ? 0 : mediaElement.volume;
      const totalGain = volume * amplifierRef.current.boost;
      const currentTime = amplifierRef.current.context.currentTime;
      try {
        amplifierRef.current.gainNode.gain.cancelScheduledValues(currentTime);
        amplifierRef.current.gainNode.gain.setTargetAtTime(totalGain, currentTime, 0.1);
      } catch (e) {
        amplifierRef.current.gainNode.gain.value = totalGain;
      }
    };

    // Initial sync
    syncGain();

    // Listen for volume changes on the media element
    mediaElement.addEventListener('volumechange', syncGain);

    // Also listen for play events to resume context if suspended (browser policy)
    const handlePlay = () => {
      if (amplifierRef.current?.context.state === 'suspended') {
        amplifierRef.current.context.resume();
      }
    };
    mediaElement.addEventListener('play', handlePlay);

    return () => {
      mediaElement.removeEventListener('volumechange', syncGain);
      mediaElement.removeEventListener('play', handlePlay);
      cleanupAmplifier(mediaElement);
    };

  }, [mediaElement]); // keep listener setup tied to the current element only

  // Effect to handle boost level changes separately
  useEffect(() => {
    if (amplifierRef.current) {
        amplifierRef.current.boost = boostLevel;
        // Trigger sync
        if (mediaElement) {
            mediaElement.dispatchEvent(new Event('volumechange'));
        }
    }
  }, [boostLevel, mediaElement]);

  const setBoost = useCallback((level) => {
    setBoostLevel(level);
    setVolume(ids, { boost: level });
  }, [ids, setVolume]);

  return {
    boostLevel,
    setBoost
  };
};
