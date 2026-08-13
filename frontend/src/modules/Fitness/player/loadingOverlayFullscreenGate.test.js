import { describe, it, expect } from 'vitest';
import { computeAllowLoadingOverlayFullscreen } from './loadingOverlayFullscreenGate.js';

// Regression coverage for the third tap-to-fullscreen path found in review:
// FitnessPlayer.jsx's global loading-overlay pointerdown listener. A stalled/
// buffering video is exactly as likely in study mode as in a workout, and a tap on
// the spinner is the natural reaction — so this gate must stay false for study
// content regardless of resilience state, closing the "footer vanishes on tap"
// failure this mode exists to prevent.
describe('computeAllowLoadingOverlayFullscreen', () => {
  it('blocks fullscreen while waiting to play in study mode', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: true, waitingToPlay: true, stalled: false })).toBe(false);
  });

  it('blocks fullscreen while stalled in study mode', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: true, waitingToPlay: false, stalled: true })).toBe(false);
  });

  it('blocks fullscreen in study mode even when both resilience flags are set', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: true, waitingToPlay: true, stalled: true })).toBe(false);
  });

  it('blocks fullscreen in study mode with no resilience state at all', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: true, waitingToPlay: false, stalled: false })).toBe(false);
  });

  it('allows fullscreen while waiting to play outside study mode (existing workout behaviour)', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: false, waitingToPlay: true, stalled: false })).toBe(true);
  });

  it('allows fullscreen while stalled outside study mode (existing workout behaviour)', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: false, waitingToPlay: false, stalled: true })).toBe(true);
  });

  it('stays false outside study mode when nothing is buffering/stalled', () => {
    expect(computeAllowLoadingOverlayFullscreen({ studyUx: false, waitingToPlay: false, stalled: false })).toBe(false);
  });

  it('treats a missing/undefined studyUx as not-study-mode (matches contentMode default)', () => {
    expect(computeAllowLoadingOverlayFullscreen({ waitingToPlay: true, stalled: false })).toBe(true);
  });

  it('handles a completely empty call safely', () => {
    expect(computeAllowLoadingOverlayFullscreen()).toBe(false);
    expect(computeAllowLoadingOverlayFullscreen({})).toBe(false);
  });
});
