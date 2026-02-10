/**
 * Unit tests for sticky intent position logic
 *
 * Tests the pure logic that preserves seek intent display values
 * after targetTimeSeconds is consumed (nulled), so the overlay
 * shows the correct seek target rather than the current position.
 *
 * @see frontend/src/modules/Player/hooks/useMediaResilience.js
 */

/**
 * Extracted logic under test:
 * Given (targetTimeSeconds, isSeeking, stickyRef), compute the
 * intentPositionDisplay and intentPositionUpdatedAt to pass to the overlay.
 */
function computeStickyIntent({ targetTimeSeconds, isSeeking, stickyDisplay, stickyUpdatedAt, formatTime }) {
  const liveDisplay = Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null;
  const liveUpdatedAt = Number.isFinite(targetTimeSeconds) ? Date.now() : null;

  return {
    intentPositionDisplay: liveDisplay || (isSeeking ? stickyDisplay : null),
    intentPositionUpdatedAt: liveUpdatedAt || (isSeeking ? stickyUpdatedAt : null),
  };
}

const formatTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

describe('Sticky Intent Position Logic', () => {
  test('returns live intent when targetTimeSeconds is finite', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: 120,
      isSeeking: false,
      stickyDisplay: null,
      stickyUpdatedAt: null,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBe('2:00');
    expect(result.intentPositionUpdatedAt).not.toBeNull();
  });

  test('returns null when target consumed and NOT seeking', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: null,
      isSeeking: false,
      stickyDisplay: '2:00',
      stickyUpdatedAt: 1000,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBeNull();
    expect(result.intentPositionUpdatedAt).toBeNull();
  });

  test('returns sticky value when target consumed but IS seeking', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: null,
      isSeeking: true,
      stickyDisplay: '2:00',
      stickyUpdatedAt: 1000,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBe('2:00');
    expect(result.intentPositionUpdatedAt).toBe(1000);
  });

  test('returns null when target consumed, seeking, but no sticky value', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: null,
      isSeeking: true,
      stickyDisplay: null,
      stickyUpdatedAt: null,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBeNull();
    expect(result.intentPositionUpdatedAt).toBeNull();
  });

  test('live intent takes priority over sticky when both exist', () => {
    const result = computeStickyIntent({
      targetTimeSeconds: 180,
      isSeeking: true,
      stickyDisplay: '2:00',
      stickyUpdatedAt: 1000,
      formatTime,
    });
    expect(result.intentPositionDisplay).toBe('3:00');
  });
});
