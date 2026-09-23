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
      .toEqual({ action: 'pause', wePausedIt: true });
  });

  it('(b) does nothing when the request stays true and a new, playing element arrives', () => {
    // 2026-09-22 window: after a manual pause the flag stays true until the next
    // tick; a resilience remount must not turn that stale flag into a pause.
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: true, elementPaused: false }))
      .toEqual({ action: 'none', wePausedIt: false });
  });

  it('(c) resumes on true -> false when we paused it and governance is clear', () => {
    expect(decideVoiceMemoPause({
      ...base, prevRequested: true, requested: false, elementPaused: true, wePausedIt: true,
    })).toEqual({ action: 'resume', wePausedIt: false });
  });

  it('(d) leaves resume to governance when the request clears while locked', () => {
    expect(decideVoiceMemoPause({
      ...base, prevRequested: true, requested: false, elementPaused: true, wePausedIt: true, governanceLocked: true,
    })).toEqual({ action: 'none', wePausedIt: false });
  });

  it('does not pause an element that is already paused (manual pause mirrored by a tick)', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: false, requested: true, elementPaused: true }))
      .toEqual({ action: 'none', wePausedIt: false });
  });

  it('does not pause when there is no element', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: false, requested: true, hasElement: false }))
      .toEqual({ action: 'none', wePausedIt: false });
  });

  it('never resumes a pause it did not make', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: false, elementPaused: true, wePausedIt: false }))
      .toEqual({ action: 'none', wePausedIt: false });
  });

  it('does not resume an element that is already playing, but forgets its pause', () => {
    expect(decideVoiceMemoPause({ ...base, prevRequested: true, requested: false, elementPaused: false, wePausedIt: true }))
      .toEqual({ action: 'none', wePausedIt: false });
  });
});
