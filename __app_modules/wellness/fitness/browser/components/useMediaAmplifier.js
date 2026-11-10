import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { useVolumeStore } from "../nav/useVolumeStore.js";

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'media-amplifier' });
  return _logger;
}

const amplifiers = new WeakMap();

const cleanupAmplifier = (element) => {
  if (!element) return;
  const amp = amplifiers.get(element);
  if (!amp) return;
  try {
    amp.source?.disconnect?.();
  } catch (e) {
    logger().warn('media_amplifier.disconnect_source_failed', { error: e.message });
  }
  try {
    amp.gainNode?.disconnect?.();
  } catch (e) {
    logger().warn('media_amplifier.disconnect_gain_failed', { error: e.message });
  }
  try {
    amp.context?.close?.();
  } catch (e) {
    logger().warn('media_amplifier.close_context_failed', { error: e.message });
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
    logger().error('media_amplifier.create_source_failed', { error: e.message });
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

// `level` is the viewer's UN-DUCKED video level (usePersistentVolume's
// `volume`). The gain carries it so normal playback keeps its historical
// loudness (level^2 x boost: element.volume carries the level once, the gain
// once more), while a duck, which lowers only element.volume, scales the
// output by exactly duck_to. Without `level` the gain falls back to
// element.volume (the pre-2026-10-23 behaviour, which squares a duck).
export const useMediaAmplifier = (mediaElement, { grandparentId, parentId, trackId, level } = {}) => {
  const { getVolume, setVolume } = useVolumeStore();

  const ids = useMemo(
    () => ({
      grandparentId: normalizePart(grandparentId, 'fitness'),
      parentId: normalizePart(parentId, 'global'),
      trackId: normalizePart(trackId, null)
    }),
    [grandparentId, parentId, trackId]
  );

  const [boostLevel, setBoostLevel] = useState(1);
  const amplifierRef = useRef(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  const syncGainRef = useRef(null);

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

    // A MediaElementAudioSourceNode's output already carries element.volume
    // (and muted). The gain used to be element.volume x boost, so the duck
    // (which lowers element.volume) was applied twice: duck_to 0.15 became
    // ~2%. The gain now uses the un-ducked level, so normal loudness is
    // unchanged and the duck is linear. See
    // ops:docs/_wip/bugs/2026-10-23-fitness-audio-ducking-goes-to-zero.md.
    // Mute is already silent upstream; zeroing the gain too is harmless.
    let lastGain = null;
    const syncGain = () => {
      if (!amplifierRef.current) return;
      const { boost } = amplifierRef.current;
      const unducked = Number.isFinite(levelRef.current)
        ? Math.min(1, Math.max(0, levelRef.current))
        : mediaElement.volume;
      const totalGain = mediaElement.muted ? 0 : unducked * boost;
      if (totalGain !== lastGain) {
        logger().debug('media_amplifier.gain', {
          gain: totalGain,
          boost,
          level: unducked,
          levelSource: Number.isFinite(levelRef.current) ? 'volume-store' : 'element',
          elementVolume: mediaElement.volume,
          muted: Boolean(mediaElement.muted),
        });
        lastGain = totalGain;
      }
      const currentTime = amplifierRef.current.context.currentTime;
      try {
        amplifierRef.current.gainNode.gain.cancelScheduledValues(currentTime);
        amplifierRef.current.gainNode.gain.setTargetAtTime(totalGain, currentTime, 0.1);
      } catch (e) {
        amplifierRef.current.gainNode.gain.value = totalGain;
      }
    };

    syncGainRef.current = syncGain;
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
      if (syncGainRef.current === syncGain) syncGainRef.current = null;
      cleanupAmplifier(mediaElement);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaElement]); // keep listener setup tied to the current element only

  // Effect to handle boost and un-ducked level changes separately
  // (re-sync directly; no synthetic volumechange reaches other listeners).
  useEffect(() => {
    if (amplifierRef.current) {
      amplifierRef.current.boost = boostLevel;
      syncGainRef.current?.();
    }
  }, [boostLevel, level, mediaElement]);

  const setBoost = useCallback((level) => {
    setBoostLevel(level);
    setVolume(ids, { boost: level });
  }, [ids, setVolume]);

  return {
    boostLevel,
    setBoost
  };
};
