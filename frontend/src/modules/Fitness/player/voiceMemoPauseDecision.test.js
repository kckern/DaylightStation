import { describe, it, expect } from 'vitest';
import { decideVoiceMemoPause } from './voiceMemoPauseDecision.js';

const base = {
  prevRequested: false,
  requested: false,
  hasElement: true,
  elementPaused: false,
  wePausedIt: false,
  governanceLocked: false,
};

describe('decideVoiceMemoPause', () => {
  it('(a) pauses a playing element when the request goes false -> true', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: false, requested: true }))
      .toEqual({ action: 'pause', wePausedIt: true, nextPrev: true });
  });

  it('(b) does nothing when the request stays true and a new, playing element arrives', () => {
    // 2026-09-22 window: after a manual pause the flag stays true until the next
    // tick; a resilience remount must not turn that stale flag into a pause.
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: true, elementPaused: false }))
      .toEqual({ action: 'none', wePausedIt: false, nextPrev: true });
  });

  it('(c) resumes on true -> false when we paused it and governance is clear', () => {
    expect(decideVoiceMemoPause({
      ...base, prevRequested: true, requested: false, elementPaused: true, wePausedIt: true,
    })).toEqual({ action: 'resume', wePausedIt: false, nextPrev: false });
  });

  it('(d) leaves resume to governance when the request clears while locked', () => {
    expect(decideVoiceMemoPause({
      ...base, prevRequested: true, requested: false, elementPaused: true, wePausedIt: true, governanceLocked: true,
    })).toEqual({ action: 'none', wePausedIt: false, nextPrev: false });
  });

  it('does not pause an element that is already paused (manual pause mirrored by a tick)', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: false, requested: true, elementPaused: true }))
      .toEqual({ action: 'none', wePausedIt: false, nextPrev: true });
  });

  it('does not pause when there is no element', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: false, requested: true, hasElement: false }))
      .toEqual({ action: 'none', wePausedIt: false, nextPrev: false });
  });

  it('never resumes a pause it did not make', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: false, elementPaused: true, wePausedIt: false }))
      .toEqual({ action: 'none', wePausedIt: false, nextPrev: false });
  });

  it('does not resume an element that is already playing, but forgets its pause', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: false, elementPaused: false, wePausedIt: true }))
      .toEqual({ action: 'none', wePausedIt: false, nextPrev: false });
  });

  it('honours a pause request that predates the media element', () => {
    // Emergency already active when FitnessPlayer mounts: no element yet.
    const first = decideVoiceMemoPause({ ...base, prevRequested: false, requested: true, hasElement: false });
    expect(first).toEqual({ action: 'none', wePausedIt: false, nextPrev: false });
    // The element arrives and autoplays while the request is still true.
    const second = decideVoiceMemoPause({
      ...base, prevRequested: first.nextPrev, requested: true, hasElement: true, elementPaused: false,
    });
    expect(second).toEqual({ action: 'pause', wePausedIt: true, nextPrev: true });
  });

  it('a cleared request always resets prev, even with no element', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: false, hasElement: false }))
      .toEqual({ action: 'none', wePausedIt: false, nextPrev: false });
  });
});
