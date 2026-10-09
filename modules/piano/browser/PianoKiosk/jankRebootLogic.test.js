import { describe, it, expect } from 'vitest';
import { isSnoozed, shouldPrompt } from './jankRebootLogic.js';

describe('isSnoozed', () => {
  it('is true only while the snooze is in the future', () => {
    expect(isSnoozed(2000, 1000)).toBe(true);
    expect(isSnoozed(1000, 1000)).toBe(false);
    expect(isSnoozed(500, 1000)).toBe(false);
  });
  it('treats missing/invalid snooze as not snoozed', () => {
    expect(isSnoozed(null, 1000)).toBe(false);
    expect(isSnoozed(undefined, 1000)).toBe(false);
    expect(isSnoozed(NaN, 1000)).toBe(false);
  });
});

describe('shouldPrompt', () => {
  const base = { sustainSec: 60, snoozeUntilMs: null, nowMs: 10_000, alreadyOpen: false };

  it('opens once jank is sustained past the threshold', () => {
    expect(shouldPrompt({ ...base, sustainedLowSec: 59 })).toBe(false);
    expect(shouldPrompt({ ...base, sustainedLowSec: 60 })).toBe(true);
  });

  it('never opens while snoozed, even past the threshold', () => {
    expect(shouldPrompt({ ...base, sustainedLowSec: 120, snoozeUntilMs: 20_000 })).toBe(false);
  });

  it('re-arms once the snooze has elapsed', () => {
    expect(shouldPrompt({ ...base, sustainedLowSec: 120, snoozeUntilMs: 9_000 })).toBe(true);
  });

  it('stays open once open regardless of snooze/threshold', () => {
    expect(shouldPrompt({ ...base, sustainedLowSec: 0, alreadyOpen: true })).toBe(true);
  });
});
