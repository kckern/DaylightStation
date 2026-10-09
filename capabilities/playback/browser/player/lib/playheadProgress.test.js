import { describe, it, expect } from 'vitest';
import { evaluatePlayheadProgress, PROGRESS_EPSILON } from './playheadProgress.js';

// Regression guard for the stall-recovery false-resolve loop.
// The old markProgress() treated EVERY timeupdate as progress, so the recovery
// system's own nudge-seek (currentTime -= 0.001) and DASH fragment appends were
// misread as "recovered" — clearing the stall and resetting the escalation
// counter before `reload` could ever run. evaluatePlayheadProgress() is the pure
// decision that distinguishes genuine forward playback from those pokes.
describe('evaluatePlayheadProgress', () => {
  it('counts the first tick as progress and sets the baseline', () => {
    const r = evaluatePlayheadProgress(324.0, null);
    expect(r.advanced).toBe(true);
    expect(r.nextPos).toBe(324.0);
  });

  it('counts normal forward playback as progress', () => {
    const r = evaluatePlayheadProgress(324.25, 324.0);
    expect(r.advanced).toBe(true);
    expect(r.nextPos).toBe(324.25);
  });

  it('does NOT count the recovery nudge (tiny backward seek) as progress', () => {
    // nudge does currentTime = t - 0.001
    const r = evaluatePlayheadProgress(323.999, 324.0);
    expect(r.advanced).toBe(false);
    // rebaseline to the new (lower) position so a real forward tick is measured
    expect(r.nextPos).toBe(323.999);
  });

  it('does NOT count a frozen playhead as progress', () => {
    const r = evaluatePlayheadProgress(324.0, 324.0);
    expect(r.advanced).toBe(false);
    expect(r.nextPos).toBe(324.0);
  });

  it('does NOT count sub-epsilon jitter as progress', () => {
    const r = evaluatePlayheadProgress(324.0 + PROGRESS_EPSILON / 2, 324.0);
    expect(r.advanced).toBe(false);
  });

  it('resolves after a reload seekback once playback genuinely advances', () => {
    // reload seeks back ~2s (324 -> 322): backward, not progress, rebaseline
    const back = evaluatePlayheadProgress(322.0, 324.0);
    expect(back.advanced).toBe(false);
    expect(back.nextPos).toBe(322.0);
    // playback resumes and advances past the new baseline -> genuine progress
    const fwd = evaluatePlayheadProgress(322.3, back.nextPos);
    expect(fwd.advanced).toBe(true);
  });

  it('treats null / NaN position as no progress without losing the baseline', () => {
    expect(evaluatePlayheadProgress(null, 324.0)).toEqual({ advanced: false, nextPos: 324.0 });
    expect(evaluatePlayheadProgress(NaN, 324.0)).toEqual({ advanced: false, nextPos: 324.0 });
  });
});
