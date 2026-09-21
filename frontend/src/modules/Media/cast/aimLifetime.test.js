import { describe, expect, it } from 'vitest';
import {
  AIM_IDLE_MS,
  advanceAimLifetime,
  renewAimActivity,
  resolveAimExpiry,
  restoreAimState,
} from './aimLifetime.js';

const START = 1_700_000_000_000;

function stored(overrides = {}) {
  return JSON.stringify({
    mode: 'fork',
    targetIds: ['office'],
    activityAt: START,
    ...overrides,
  });
}

describe('aim lifetime — PLACE.2a/RQ-PLACE-03', () => {
  it('PLACE.2a does not expire an aim while matching sent playback remains active', () => {
    expect(resolveAimExpiry({
      idleMs: AIM_IDLE_MS + 1,
      matchingPlaybackActive: true,
    })).toBe(false);
  });

  it('expires a remote aim at the exact two-hour idle boundary', () => {
    const restored = restoreAimState(stored(), { now: START });

    const result = advanceAimLifetime(restored.state, {
      now: START + AIM_IDLE_MS,
      exemption: false,
    });

    expect(result.expired).toBe(true);
    expect(result.state).toMatchObject({ mode: 'fork', targetIds: [] });
  });

  it('does not expire one millisecond before the idle boundary', () => {
    const restored = restoreAimState(stored(), { now: START });

    const result = advanceAimLifetime(restored.state, {
      now: START + AIM_IDLE_MS - 1,
      exemption: false,
    });

    expect(result.expired).toBe(false);
    expect(result.state.targetIds).toEqual(['office']);
  });

  it('expires a persisted aim on reload when fleet observation is unavailable', () => {
    const restored = restoreAimState(stored(), { now: START + AIM_IDLE_MS + 1 });

    const result = advanceAimLifetime(restored.state, {
      now: START + AIM_IDLE_MS + 1,
      exemption: null,
    });

    expect(result.expired).toBe(true);
    expect(result.state.targetIds).toEqual([]);
  });

  it('does not credit an unobserved persisted exemption interval after reload', () => {
    const restored = restoreAimState(stored({ exemptionStartedAt: START + (60 * 60 * 1000) }), {
      now: START + (24 * 60 * 60 * 1000),
    });

    const result = advanceAimLifetime(restored.state, {
      now: START + (24 * 60 * 60 * 1000),
      exemption: null,
    });

    expect(result.expired).toBe(true);
    expect(result.state.targetIds).toEqual([]);
  });

  it('migrates a legacy timestamp-less record once to a finite conservative lifetime', () => {
    const restored = restoreAimState(stored({ activityAt: undefined }), { now: START });

    expect(restored.migrated).toBe(true);
    expect(restored.state.activityAt).toBe(START);
    expect(advanceAimLifetime(restored.state, {
      now: START + AIM_IDLE_MS,
      exemption: false,
    }).expired).toBe(true);
  });

  it('falls back safely for corrupted persisted data', () => {
    const restored = restoreAimState('{not-json', { now: START });

    expect(restored).toEqual({
      restored: false,
      migrated: false,
      state: { mode: 'transfer', targetIds: [], activityAt: START, exemptionStartedAt: null },
    });
  });

  it('pauses the idle clock while a current exemption remains verified', () => {
    const restored = restoreAimState(stored(), { now: START });
    const paused = advanceAimLifetime(restored.state, {
      now: START + (60 * 60 * 1000),
      exemption: true,
    });
    const resumed = advanceAimLifetime(paused.state, {
      now: START + (3 * 60 * 60 * 1000),
      exemption: false,
    });

    expect(paused.expired).toBe(false);
    expect(resumed.expired).toBe(false);
    expect(resumed.state.targetIds).toEqual(['office']);
    expect(resumed.state.activityAt).toBe(START + AIM_IDLE_MS);
  });

  it('starts a new paused interval when an interaction renews activity during an exemption', () => {
    const started = advanceAimLifetime(restoreAimState(stored(), { now: START }).state, {
      now: START + (60 * 60 * 1000), exemption: true,
    });
    const renewed = renewAimActivity(started.state, { now: START + (5 * 60 * 60 * 1000) });
    const ended = advanceAimLifetime(renewed, {
      now: START + (6 * 60 * 60 * 1000), exemption: false,
    });

    expect(ended.expired).toBe(false);
    expect(ended.state.activityAt).toBe(START + (6 * 60 * 60 * 1000));
    expect(ended.state.targetIds).toEqual(['office']);
  });
});
