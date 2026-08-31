import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStateGatesModule } from './stateGates.mjs';

const start = Date.parse('2026-08-30T12:00:00-07:00');

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function config(directory, policy) {
  return {
    getHouseholdPath: () => path.join(directory, 'state-gates/current'),
    reloadHouseholdAppConfig: () => policy,
    getHouseholdAppConfig: () => policy,
    getHouseholdUsers: () => ['learner-a'],
    getHouseholdDevices: () => ({ devices: {} }),
    getHouseholdTimezone: () => 'America/Los_Angeles',
    getAllHouseholdIds: () => [],
  };
}

function emptyPolicy() {
  return {
    schema: 'daylight.state-gates-policy/v1', policy_revision: 1,
    publishers: {}, subject_sets: {}, claim_types: {}, gates: {}, entitlements: {},
  };
}

function scheduledPolicy() {
  return {
    ...emptyPolicy(),
    gates: {
      'schedule.available': {
        schema_version: 1,
        subject_kinds: ['learner'],
        period_kinds: ['local_day'],
        expression: { schedule: { days: ['sun'], start: '12:00', end: '12:01' } },
      },
    },
    entitlements: {
      'schedule.access': { gate: 'schedule.available', failure_posture: 'fail_closed' },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('State Gates lifecycle retries', () => {
  it('retries a durable unpublished outbox batch without restarting', async () => {
    vi.useFakeTimers({ now: start });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-delivery-retry-'));
    const eventBus = {
      publish: vi.fn()
        .mockRejectedValueOnce(new Error('transport unavailable'))
        .mockRejectedValueOnce(new Error('transport still unavailable'))
        .mockResolvedValue(undefined),
    };
    const module = await createStateGatesModule({
      householdId: 'home', eventBus, configService: config(directory, emptyPolicy()),
      clock: { now: () => Date.now() }, logger: logger(),
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000 },
    });
    try {
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(eventBus.publish).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(eventBus.publish).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(eventBus.publish).toHaveBeenCalledTimes(3);
      await expect(module.container.flushPendingTransitions('home'))
        .resolves.toEqual({ attemptedCount: 0, deliveryPending: false });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(eventBus.publish).toHaveBeenCalledTimes(3);
    } finally {
      module.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rearms a failed validity-boundary evaluation and resumes normal scheduling', async () => {
    vi.useFakeTimers({ now: start });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-boundary-retry-'));
    const log = logger();
    const module = await createStateGatesModule({
      householdId: 'home', eventBus: { publish: vi.fn() },
      configService: config(directory, scheduledPolicy()),
      clock: { now: () => Date.now() }, logger: log,
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000 },
    });
    try {
      const evaluate = module.container.evaluateGates;
      const evaluation = vi.spyOn(module.container, 'evaluateGates')
        .mockRejectedValueOnce(new Error('projection temporarily unavailable'))
        .mockImplementation((...args) => evaluate(...args));

      await vi.advanceTimersByTimeAsync(60_000);
      expect(evaluation).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith('state-gates.boundary.failed', expect.objectContaining({
        householdId: 'home', retryInMs: 1_000,
      }));

      await vi.advanceTimersByTimeAsync(1_000);
      expect(evaluation).toHaveBeenCalledTimes(2);
      expect(await module.container.getCurrentGates('home')).toMatchObject({
        currentRevision: 2,
        items: [expect.objectContaining({ evaluation: expect.objectContaining({ state: 'unsatisfied' }) })],
      });

      module.dispose();
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
      expect(evaluation).toHaveBeenCalledTimes(2);
    } finally {
      module.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
