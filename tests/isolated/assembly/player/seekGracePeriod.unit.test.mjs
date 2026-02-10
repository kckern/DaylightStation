/**
 * Unit tests for seek grace period logic
 *
 * Tests the pure logic that suppresses the loading overlay during
 * brief seek operations (ffwd/rew bumps) so only stalled seeks
 * show the spinner.
 *
 * @see frontend/src/modules/Player/hooks/useMediaResilience.js
 */

/**
 * Extracted logic under test:
 * Given overlay trigger flags and seek grace state, determine
 * whether the overlay should be shown.
 */
function computeShouldShowOverlay({
  isLoopTransition,
  isStalled,
  isRecovering,
  isStartup,
  hasEverPlayed,
  isBuffering,
  isUserPaused,
  seekGraceActive,
}) {
  return !isLoopTransition && !seekGraceActive && (
    isStalled || isRecovering || (isStartup && !hasEverPlayed) ||
    isBuffering || isUserPaused
  );
}

describe('Seek Grace Period — shouldShowOverlay', () => {
  const base = {
    isLoopTransition: false,
    isStalled: false,
    isRecovering: false,
    isStartup: false,
    hasEverPlayed: true,
    isBuffering: false,
    isUserPaused: false,
    seekGraceActive: false,
  };

  test('shows overlay when buffering and no seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isBuffering: true })).toBe(true);
  });

  test('suppresses overlay when buffering during seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isBuffering: true, seekGraceActive: true })).toBe(false);
  });

  test('suppresses overlay when stalled during seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isStalled: true, seekGraceActive: true })).toBe(false);
  });

  test('shows stall overlay after grace expires (seekGraceActive=false, isStalled=true)', () => {
    expect(computeShouldShowOverlay({ ...base, isStalled: true, seekGraceActive: false })).toBe(true);
  });

  test('isSeeking alone no longer triggers overlay (removed from triggers)', () => {
    // isSeeking is not a parameter at all — it was removed from the trigger list
    expect(computeShouldShowOverlay({ ...base })).toBe(false);
  });

  test('startup overlay is not affected by seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isStartup: true, hasEverPlayed: false })).toBe(true);
  });

  test('user pause overlay is not affected by seek grace', () => {
    expect(computeShouldShowOverlay({ ...base, isUserPaused: true })).toBe(true);
  });

  test('loop transition suppresses even with buffering', () => {
    expect(computeShouldShowOverlay({ ...base, isBuffering: true, isLoopTransition: true })).toBe(false);
  });

  test('nothing triggers → no overlay', () => {
    expect(computeShouldShowOverlay(base)).toBe(false);
  });
});
