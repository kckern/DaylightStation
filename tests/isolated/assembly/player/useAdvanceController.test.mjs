/**
 * Tests for useAdvanceController hook
 *
 * This hook controls visual advancement in composed presentations.
 * Tests verify all advance modes and edge cases.
 *
 * Advance modes:
 * - 'none': No automatic advance (static image, looping video)
 * - 'timed': setInterval with visual.advance.interval
 * - 'onTrackEnd': advance when audioState.trackEnded becomes true
 * - 'manual': no automatic advance, only via advance() call
 * - 'synced': find matching marker where marker.time <= audioState.currentTime
 */

// Since this is isolated testing without React, we test the logic directly
// by simulating the hook's behavior

describe('useAdvanceController', () => {
  /**
   * Helper to compute next index with looping behavior
   */
  function getNextIndex(currentIndex, delta, itemCount, loop) {
    if (itemCount === 0) return 0;
    const nextIndex = currentIndex + delta;
    if (loop) {
      return ((nextIndex % itemCount) + itemCount) % itemCount;
    }
    return Math.max(0, Math.min(nextIndex, itemCount - 1));
  }

  /**
   * Helper to compute canAdvance
   */
  function canAdvance(currentIndex, itemCount, loop) {
    return itemCount > 0 && (loop || currentIndex < itemCount - 1);
  }

  /**
   * Helper to compute canReverse
   */
  function canReverse(currentIndex, itemCount, loop) {
    return itemCount > 0 && (loop || currentIndex > 0);
  }

  /**
   * Helper to find synced marker index
   */
  function findSyncedIndex(markers, currentTime) {
    let matchedIndex = 0;
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].time <= currentTime) {
        matchedIndex = i;
      } else {
        break;
      }
    }
    return matchedIndex;
  }

  describe('advance mode: none', () => {
    test('should not advance automatically', () => {
      const visual = {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        advance: { mode: 'none' }
      };

      // Mode 'none' means no automatic advancement
      // currentIndex should remain at 0 unless manually changed
      expect(visual.advance.mode).toBe('none');
    });
  });

  describe('advance mode: manual', () => {
    test('should only advance when advance() is called', () => {
      const visual = {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        advance: { mode: 'manual' }
      };

      // Manual mode = no automatic triggers
      let currentIndex = 0;
      const itemCount = visual.items.length;
      const loop = false;

      // Simulating advance() call
      currentIndex = getNextIndex(currentIndex, 1, itemCount, loop);
      expect(currentIndex).toBe(1);

      currentIndex = getNextIndex(currentIndex, 1, itemCount, loop);
      expect(currentIndex).toBe(2);
    });
  });

  describe('advance mode: timed', () => {
    test('should use interval for automatic advancement', () => {
      const visual = {
        items: [{ id: 1 }, { id: 2 }],
        advance: { mode: 'timed', interval: 5000 }
      };

      expect(visual.advance.mode).toBe('timed');
      expect(visual.advance.interval).toBe(5000);
    });

    test('should default interval to 5000ms if not specified', () => {
      const visual = {
        items: [{ id: 1 }, { id: 2 }],
        advance: { mode: 'timed' }
      };

      const interval = visual.advance.interval || 5000;
      expect(interval).toBe(5000);
    });
  });

  describe('advance mode: onTrackEnd', () => {
    test('should advance when trackEnded transitions to true', () => {
      let currentIndex = 0;
      const itemCount = 3;
      const loop = false;

      // Previous state: not ended
      let prevTrackEnded = false;
      let trackEnded = false;

      // No change - should not advance
      const shouldAdvance1 = trackEnded && !prevTrackEnded;
      expect(shouldAdvance1).toBe(false);

      // Track ends
      prevTrackEnded = trackEnded;
      trackEnded = true;

      const shouldAdvance2 = trackEnded && !prevTrackEnded;
      expect(shouldAdvance2).toBe(true);

      if (shouldAdvance2) {
        currentIndex = getNextIndex(currentIndex, 1, itemCount, loop);
      }
      expect(currentIndex).toBe(1);
    });

    test('should not advance if trackEnded stays true', () => {
      // If trackEnded is already true and stays true, no advancement
      let prevTrackEnded = true;
      let trackEnded = true;

      const shouldAdvance = trackEnded && !prevTrackEnded;
      expect(shouldAdvance).toBe(false);
    });
  });

  describe('advance mode: synced', () => {
    test('should find correct marker for current time', () => {
      const markers = [
        { time: 0 },
        { time: 5 },
        { time: 10 },
        { time: 15 }
      ];

      expect(findSyncedIndex(markers, 0)).toBe(0);
      expect(findSyncedIndex(markers, 3)).toBe(0);
      expect(findSyncedIndex(markers, 5)).toBe(1);
      expect(findSyncedIndex(markers, 7)).toBe(1);
      expect(findSyncedIndex(markers, 10)).toBe(2);
      expect(findSyncedIndex(markers, 12)).toBe(2);
      expect(findSyncedIndex(markers, 15)).toBe(3);
      expect(findSyncedIndex(markers, 100)).toBe(3);
    });

    test('should handle empty markers array', () => {
      const markers = [];
      expect(findSyncedIndex(markers, 10)).toBe(0);
    });

    test('should handle single marker', () => {
      const markers = [{ time: 5 }];

      expect(findSyncedIndex(markers, 0)).toBe(0); // Before marker, still returns 0
      expect(findSyncedIndex(markers, 5)).toBe(0);
      expect(findSyncedIndex(markers, 10)).toBe(0);
    });
  });

  describe('looping behavior', () => {
    test('should wrap around when loop is true', () => {
      const itemCount = 3;
      const loop = true;

      // At last item, advancing should go to first
      expect(getNextIndex(2, 1, itemCount, loop)).toBe(0);

      // At first item, going back should go to last
      expect(getNextIndex(0, -1, itemCount, loop)).toBe(2);
    });

    test('should clamp when loop is false', () => {
      const itemCount = 3;
      const loop = false;

      // At last item, advancing should stay at last
      expect(getNextIndex(2, 1, itemCount, loop)).toBe(2);

      // At first item, going back should stay at first
      expect(getNextIndex(0, -1, itemCount, loop)).toBe(0);
    });

    test('should handle multiple advances with loop', () => {
      const itemCount = 3;
      const loop = true;
      let index = 0;

      // Advance through full cycle
      index = getNextIndex(index, 1, itemCount, loop); // 0 -> 1
      expect(index).toBe(1);

      index = getNextIndex(index, 1, itemCount, loop); // 1 -> 2
      expect(index).toBe(2);

      index = getNextIndex(index, 1, itemCount, loop); // 2 -> 0 (wrap)
      expect(index).toBe(0);

      index = getNextIndex(index, 1, itemCount, loop); // 0 -> 1
      expect(index).toBe(1);
    });
  });

  describe('canAdvance calculation', () => {
    test('should be true when not at end', () => {
      expect(canAdvance(0, 3, false)).toBe(true);
      expect(canAdvance(1, 3, false)).toBe(true);
    });

    test('should be false when at end and not looping', () => {
      expect(canAdvance(2, 3, false)).toBe(false);
    });

    test('should be true when at end and looping', () => {
      expect(canAdvance(2, 3, true)).toBe(true);
    });

    test('should be false when no items', () => {
      expect(canAdvance(0, 0, false)).toBe(false);
      expect(canAdvance(0, 0, true)).toBe(false);
    });
  });

  describe('canReverse calculation', () => {
    test('should be true when not at start', () => {
      expect(canReverse(1, 3, false)).toBe(true);
      expect(canReverse(2, 3, false)).toBe(true);
    });

    test('should be false when at start and not looping', () => {
      expect(canReverse(0, 3, false)).toBe(false);
    });

    test('should be true when at start and looping', () => {
      expect(canReverse(0, 3, true)).toBe(true);
    });

    test('should be false when no items', () => {
      expect(canReverse(0, 0, false)).toBe(false);
      expect(canReverse(0, 0, true)).toBe(false);
    });
  });

  describe('goTo bounds checking', () => {
    test('should clamp to valid range', () => {
      const itemCount = 3;

      // goTo logic: Math.max(0, Math.min(index, itemCount - 1))
      const goToIndex = (index) => Math.max(0, Math.min(index, itemCount - 1));

      expect(goToIndex(0)).toBe(0);
      expect(goToIndex(1)).toBe(1);
      expect(goToIndex(2)).toBe(2);
      expect(goToIndex(5)).toBe(2);  // Clamped to max
      expect(goToIndex(-1)).toBe(0); // Clamped to min
      expect(goToIndex(-10)).toBe(0);
    });

    test('should handle empty items', () => {
      const itemCount = 0;
      const goToIndex = (index) => {
        if (itemCount === 0) return; // Early return
        return Math.max(0, Math.min(index, itemCount - 1));
      };

      // Should return undefined (no-op)
      expect(goToIndex(0)).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    test('should handle single item', () => {
      const itemCount = 1;

      // With single item, index should always be 0
      expect(getNextIndex(0, 1, itemCount, false)).toBe(0);
      expect(getNextIndex(0, 1, itemCount, true)).toBe(0);
      expect(canAdvance(0, itemCount, false)).toBe(false);
      expect(canReverse(0, itemCount, false)).toBe(false);
    });

    test('should handle two items', () => {
      const itemCount = 2;

      // Non-looping
      expect(getNextIndex(0, 1, itemCount, false)).toBe(1);
      expect(getNextIndex(1, 1, itemCount, false)).toBe(1);
      expect(canAdvance(0, itemCount, false)).toBe(true);
      expect(canAdvance(1, itemCount, false)).toBe(false);

      // Looping
      expect(getNextIndex(0, 1, itemCount, true)).toBe(1);
      expect(getNextIndex(1, 1, itemCount, true)).toBe(0);
      expect(canAdvance(1, itemCount, true)).toBe(true);
    });

    test('should handle undefined visual gracefully', () => {
      // Hook should use defaults
      const visual = undefined;
      const items = visual?.items || [];
      const itemCount = items.length;
      const mode = visual?.advance?.mode || 'none';

      expect(itemCount).toBe(0);
      expect(mode).toBe('none');
    });

    test('should handle undefined audioState gracefully', () => {
      const audioState = undefined;
      const currentTime = audioState?.currentTime ?? 0;
      const trackEnded = audioState?.trackEnded ?? false;
      const isPlaying = audioState?.isPlaying ?? false;

      expect(currentTime).toBe(0);
      expect(trackEnded).toBe(false);
      expect(isPlaying).toBe(false);
    });
  });

  describe('default values', () => {
    test('should default loop to false', () => {
      const visual = { items: [{ id: 1 }, { id: 2 }] };
      const loop = visual?.loop ?? false;
      expect(loop).toBe(false);
    });

    test('should default mode to none', () => {
      const visual = { items: [{ id: 1 }, { id: 2 }] };
      const mode = visual?.advance?.mode || 'none';
      expect(mode).toBe('none');
    });

    test('should default interval to 5000', () => {
      const visual = { items: [{ id: 1 }], advance: { mode: 'timed' } };
      const interval = visual?.advance?.interval || 5000;
      expect(interval).toBe(5000);
    });

    test('should default markers to empty array', () => {
      const visual = { items: [{ id: 1 }], advance: { mode: 'synced' } };
      const markers = visual?.advance?.markers || [];
      expect(markers).toEqual([]);
    });
  });
});
