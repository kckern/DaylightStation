import { describe, it, expect } from 'vitest';
import { isSnoozed, shouldPrompt, recoveryVerified } from './jankRebootLogic.js';

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


describe('recovery evidence', () => {
  const request = { deviceId: 'test-device', bootCount: 9, bootIdentitySource: 'settings.global.boot_count', requestedAtMs: 1000 };
  const fresh = { deviceId: 'test-device', payload: 'candidate', bootCount: 10, bootIdentitySource: 'settings.global.boot_count', lastBeatAgoMs: 100, beatCount: 1, lastVisibility: 'visible', liveness: 'alive', responsiveness: 'healthy', nativeRecoveryAllowed: true };
  it('requires current same-device boot and healthy beat evidence', () => {
    expect(recoveryVerified(request, fresh, 2000)).toBe(true);
    for (const patch of [
      { deviceId: 'other-device' }, { bootCount: 9 }, { bootCount: null }, { bootCount: 8 },
      { bootIdentitySource: 'process-id' }, { payload: '' }, { lastBeatAgoMs: 5001 },
      { lastBeatAgoMs: null }, { lastBeatAgoMs: -1 }, { beatCount: 0 },
      { lastVisibility: 'hidden' }, { liveness: 'dead' }, { responsiveness: 'degraded' },
      { nativeRecoveryAllowed: false }, { beatCount: '1' },
    ]) expect(recoveryVerified(request, { ...fresh, ...patch }, 2000), JSON.stringify(patch)).toBe(false);
    expect(recoveryVerified(request, fresh, 700000)).toBe(false);
    expect(recoveryVerified(request, fresh, 999)).toBe(false);
    expect(recoveryVerified(null, fresh, 2000)).toBe(false);
    expect(recoveryVerified({ ...request, requestedAtMs: null }, fresh, 2000)).toBe(false);
    expect(recoveryVerified({ ...request, requestedAtMs: '1000' }, fresh, 2000)).toBe(false);
  });
});
