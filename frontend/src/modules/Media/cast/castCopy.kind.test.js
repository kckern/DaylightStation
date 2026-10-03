// RELY.2a/AC3 — progress wording fits the kind of screen.
import { describe, it, expect } from 'vitest';
import { friendlyStepLabel, deviceKind } from './castCopy.js';

describe('step wording by screen kind', () => {
  it('derives a kind from configured type or icon', () => {
    expect(deviceKind({ type: 'shield-tv' })).toBe('tv');
    expect(deviceKind({ icon: 'tv' })).toBe('tv');
    expect(deviceKind({ type: 'speaker' })).toBe('speaker');
    expect(deviceKind({ type: 'speaker-lane' })).toBe('speaker');
    expect(deviceKind({ type: 'android-tablet' })).toBe('screen');
    expect(deviceKind(null)).toBe('screen');
  });

  it('never says TV for a speaker or a generic screen', () => {
    expect(friendlyStepLabel('power', 'tv')).toBe('Turning on TV…');
    for (const kind of ['speaker', 'screen']) {
      for (const step of ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load', 'playback']) {
        expect(friendlyStepLabel(step, kind)).not.toMatch(/\bTV\b/);
      }
    }
    expect(friendlyStepLabel('power', 'speaker')).toBe('Waking the speaker…');
  });
});
