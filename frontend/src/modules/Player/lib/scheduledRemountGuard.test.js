import { describe, it, expect } from 'vitest';
import { shouldSkipScheduledRemount, MIN_PROGRESS_SECONDS } from './scheduledRemountGuard.js';

// A remount is armed with a backoff because playback was NOT progressing. If,
// by the time the timer fires, the playhead has moved and nothing is stalled,
// the reason for the remount no longer exists — firing it restarts the media.
describe('shouldSkipScheduledRemount', () => {
  it('skips when the playhead advanced past where it was armed and nothing is stalled', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 1.2, stalled: false }))
      .toEqual({ skip: true, reason: 'playback-resumed', advancedSeconds: 1.2 });
  });
  it('fires when the playhead has not moved', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 0, stalled: false }).skip).toBe(false);
  });
  it('fires when the element reports a stall even if the clock moved', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 3, stalled: true }).skip).toBe(false);
  });
  it('treats sub-100ms movement as noise, not progress', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 10, currentSeconds: 10.05, stalled: false }).skip).toBe(false);
  });
  it('fires on missing numbers', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: null, currentSeconds: 4, stalled: false }).skip).toBe(false);
  });

  // A forward seek past the Plex transcoder's head wedges with el.seeking stuck
  // true (useMediaResilience.js:590-593). Assigning currentTime moves the clock
  // IMMEDIATELY, before any data arrives — so this stall class presents as a
  // large positive advance with stalled === false. Without the isSeeking input
  // the guard would read that as "playback resumed" and skip the one remount
  // that could unwedge it.
  it('fires when a seek is in flight, however far the clock jumped', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 10, currentSeconds: 600, stalled: false, isSeeking: true }).skip)
      .toBe(false);
  });
  it('skips when a seek has completed and the clock is past where it was armed', () => {
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 10, currentSeconds: 600, stalled: false, isSeeking: false }).skip)
      .toBe(true);
  });

  // Boundaries.
  it('skips at exactly the progress threshold, fires just under it', () => {
    // Armed at 0 so the subtraction is exact: `10 + MIN_PROGRESS_SECONDS - 10`
    // is 0.09999999999999964 in IEEE754 and would fire. That rounding is left
    // alone deliberately — at 1e-16 either verdict is defensible, and firing is
    // the pre-guard behaviour.
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: MIN_PROGRESS_SECONDS, stalled: false }).skip)
      .toBe(true);
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 0.099, stalled: false }).skip)
      .toBe(false);
  });
  it('fires when the clock moved BACKWARDS', () => {
    // useCommonMediaController nudges with `currentTime = t - 0.001`, and a
    // recovery seek can land behind the armed position. Backwards is not progress.
    const verdict = shouldSkipScheduledRemount({ armedAtSeconds: 10, currentSeconds: 9.999, stalled: false });
    expect(verdict.skip).toBe(false);
    expect(verdict.advancedSeconds).toBeLessThan(0);
  });
  it('treats absent stalled/isSeeking flags as "not reported", not as "stalled"', () => {
    // Renderers other than SinglePlayer omit these fields entirely (see the
    // module docblock); the guard must still be able to skip on real progress.
    expect(shouldSkipScheduledRemount({ armedAtSeconds: 0, currentSeconds: 1.2, stalled: undefined, isSeeking: undefined }).skip)
      .toBe(true);
  });
});
