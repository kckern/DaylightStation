import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useAdvanceController - Controls visual advancement in composed presentations
 *
 * Manages the index of the currently displayed visual item and provides
 * methods for advancing through items based on different modes.
 *
 * @param {Object} visual - Visual track configuration
 * @param {Array} visual.items - Array of visual items to cycle through
 * @param {Object} visual.advance - Advance configuration
 * @param {string} visual.advance.mode - Advance mode (see modes below)
 * @param {number} [visual.advance.interval] - Interval in ms for 'timed' mode
 * @param {Array} [visual.advance.markers] - Array of { time: number } for 'synced' mode
 * @param {boolean} [visual.loop=false] - Whether to loop back to start
 *
 * @param {Object} audioState - Current audio playback state
 * @param {number} audioState.currentTime - Current playback time in seconds
 * @param {boolean} audioState.trackEnded - True when current audio track has ended
 * @param {boolean} audioState.isPlaying - True when audio is currently playing
 *
 * @returns {Object} Controller interface
 * @returns {number} returns.currentIndex - Current visual item index
 * @returns {Function} returns.advance - Advance to next item: () => void
 * @returns {Function} returns.goTo - Go to specific index: (index) => void
 * @returns {boolean} returns.canAdvance - True if advancing is possible
 * @returns {boolean} returns.canReverse - True if reversing is possible
 *
 * ADVANCE MODES:
 * - 'none': No automatic advance (static image, looping video)
 * - 'timed': Automatic advance using setInterval with visual.advance.interval
 * - 'onTrackEnd': Advance when audioState.trackEnded becomes true
 * - 'manual': No automatic advance, only via advance() call
 * - 'synced': Find matching marker where marker.time <= audioState.currentTime
 */
export function useAdvanceController(visual, audioState) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const trackEndedRef = useRef(false);
  const intervalRef = useRef(null);

  // Extract configuration with defaults
  const items = visual?.items || [];
  const itemCount = items.length;
  const advanceConfig = visual?.advance || {};
  const mode = advanceConfig.mode || 'none';
  const interval = advanceConfig.interval || 5000;
  const markers = advanceConfig.markers || [];
  const loop = visual?.loop ?? false;

  // Audio state with defaults
  const currentTime = audioState?.currentTime ?? 0;
  const trackEnded = audioState?.trackEnded ?? false;
  const isPlaying = audioState?.isPlaying ?? false;

  /**
   * Calculate the next index based on looping behavior
   */
  const getNextIndex = useCallback((fromIndex, delta = 1) => {
    if (itemCount === 0) return 0;

    const nextIndex = fromIndex + delta;

    if (loop) {
      // Wrap around in both directions
      return ((nextIndex % itemCount) + itemCount) % itemCount;
    } else {
      // Clamp to valid range
      return Math.max(0, Math.min(nextIndex, itemCount - 1));
    }
  }, [itemCount, loop]);

  /**
   * Advance to the next visual item
   */
  const advance = useCallback(() => {
    if (itemCount === 0) return;

    setCurrentIndex((prevIndex) => getNextIndex(prevIndex, 1));
  }, [getNextIndex, itemCount]);

  /**
   * Go to a specific index (bounds-checked)
   */
  const goTo = useCallback((index) => {
    if (itemCount === 0) return;

    // Clamp index to valid range
    const clampedIndex = Math.max(0, Math.min(index, itemCount - 1));
    setCurrentIndex(clampedIndex);
  }, [itemCount]);

  /**
   * Whether we can advance (not at end, or looping)
   */
  const canAdvance = itemCount > 0 && (loop || currentIndex < itemCount - 1);

  /**
   * Whether we can reverse (not at start, or looping)
   */
  const canReverse = itemCount > 0 && (loop || currentIndex > 0);

  /**
   * Handle 'timed' mode - setInterval-based advancement
   */
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (mode !== 'timed' || itemCount <= 1) {
      return;
    }

    // Timed mode runs independently - no audio sync required
    // (Use 'synced' mode if you need audio-driven advancement)
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prevIndex) => getNextIndex(prevIndex, 1));
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [mode, interval, itemCount, getNextIndex]);

  /**
   * Handle 'onTrackEnd' mode - advance when audio track ends
   */
  useEffect(() => {
    if (mode !== 'onTrackEnd') {
      return;
    }

    // Detect rising edge of trackEnded (false -> true)
    if (trackEnded && !trackEndedRef.current) {
      advance();
    }

    // Update ref to track previous state
    trackEndedRef.current = trackEnded;
  }, [mode, trackEnded, advance]);

  /**
   * Handle 'synced' mode - find marker matching current time
   * Markers should be sorted by time ascending
   */
  useEffect(() => {
    if (mode !== 'synced' || markers.length === 0) {
      return;
    }

    // Find the highest marker index where marker.time <= currentTime
    let matchedIndex = 0;
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].time <= currentTime) {
        matchedIndex = i;
      } else {
        break; // Markers are sorted, so we can stop early
      }
    }

    // Only update if the matched index is different
    setCurrentIndex((prevIndex) => {
      if (matchedIndex !== prevIndex) {
        return matchedIndex;
      }
      return prevIndex;
    });
  }, [mode, markers, currentTime]);

  /**
   * Reset index when items change
   */
  useEffect(() => {
    setCurrentIndex(0);
    trackEndedRef.current = false;
  }, [items.length]);

  return {
    currentIndex,
    advance,
    goTo,
    canAdvance,
    canReverse
  };
}

export default useAdvanceController;
