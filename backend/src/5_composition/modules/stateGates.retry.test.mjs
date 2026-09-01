import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStateGatesModule, stateGatesRetryDelay } from './stateGates.mjs';

const start = Date.parse('2026-08-30T12:00:00-07:00');

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function config(directory, policy) {
  return {
    getHouseholdPath: () => path.join(directory, 'state-gates/current'),
    reloadHouseholdAppConfig: () => policy,
    getHouseholdAppConfig: () => policy,
    getHouseholdUsers: () => ['user_4'],
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

function multiHouseholdConfig(directory, policy, householdIds) {
  return {
    getHouseholdPath: (_name, id) => path.join(directory, id, 'state-gates/current'),
    reloadHouseholdAppConfig: () => policy,
    getHouseholdAppConfig: () => policy,
    getHouseholdUsers: () => ['user_4'],
    getHouseholdDevices: () => ({ devices: {} }),
    getHouseholdTimezone: id => id === 'west' ? 'America/Los_Angeles' : 'UTC',
    getAllHouseholdIds: () => householdIds,
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
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000, jitterRatio: 0 },
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
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000, jitterRatio: 0 },
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

  it('uses stable bounded jitter independently per household and retry channel', () => {
    const policy = { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000, jitterRatio: 0.2 };
    const homeDelivery = stateGatesRetryDelay(policy, 'delivery', 'home', 0);
    expect(stateGatesRetryDelay(policy, 'delivery', 'home', 0)).toBe(homeDelivery);
    expect(homeDelivery).toBeGreaterThanOrEqual(800);
    expect(homeDelivery).toBeLessThanOrEqual(1_200);
    expect(new Set([
      homeDelivery,
      stateGatesRetryDelay(policy, 'boundary', 'home', 0),
      stateGatesRetryDelay(policy, 'delivery', 'other-home', 0),
    ]).size).toBeGreaterThan(1);
    expect(stateGatesRetryDelay(policy, 'delivery', 'home', 20)).toBeLessThanOrEqual(60_000);
  });

  it('recovers the persisted outbox before publishing a newly activated policy', async () => {
    vi.useFakeTimers({ now: start });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-startup-order-'));
    const firstBus = { publish: vi.fn(async () => { throw new Error('offline'); }) };
    const initial = await createStateGatesModule({
      householdId: 'home', eventBus: firstBus, configService: config(directory, emptyPolicy()),
      clock: { now: () => Date.now() }, logger: logger(),
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000, jitterRatio: 0 },
    });
    initial.dispose();

    const nextPolicy = { ...emptyPolicy(), policy_revision: 2 };
    const recoveredBus = { publish: vi.fn(async () => {}) };
    const recovered = await createStateGatesModule({
      householdId: 'home', eventBus: recoveredBus, configService: config(directory, nextPolicy),
      clock: { now: () => Date.now() }, logger: logger(),
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000, jitterRatio: 0 },
    });
    try {
      expect(recoveredBus.publish.mock.calls.map(([, envelope]) => envelope.householdRevision)).toEqual([1, 2]);
      expect(recoveredBus.publish.mock.calls.map(([, envelope]) => envelope.kind)).toEqual([
        'PolicyGraphActivated', 'PolicyGraphActivated',
      ]);
      await expect(recovered.container.flushPendingTransitions('home'))
        .resolves.toEqual({ attemptedCount: 0, deliveryPending: false });
    } finally {
      recovered.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('isolates household projections and evaluates schedules with each household timezone', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-08-30T16:30:00Z') });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-household-isolation-'));
    const policy = {
      ...emptyPolicy(),
      gates: {
        'schedule.available': {
          schema_version: 1, subject_kinds: ['learner'], period_kinds: ['local_day'],
          expression: { schedule: { days: ['sun'], start: '09:00', end: '10:00' } },
        },
      },
      entitlements: {
        'schedule.access': { gate: 'schedule.available', failure_posture: 'fail_closed' },
      },
    };
    const module = await createStateGatesModule({
      householdId: 'west', eventBus: { publish: vi.fn() },
      configService: multiHouseholdConfig(directory, policy, ['west', 'utc']),
      clock: { now: () => Date.now() }, logger: logger(),
    });
    try {
      expect((await module.container.getCurrentGates('west')).items[0].evaluation.state).toBe('satisfied');
      expect((await module.container.getCurrentGates('utc')).items[0].evaluation.state).toBe('unsatisfied');
      expect(fs.existsSync(path.join(directory, 'west/state-gates/current.yml'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'utc/state-gates/current.yml'))).toBe(true);
    } finally {
      module.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not fail a durable command when only its boundary refresh fails', async () => {
    vi.useFakeTimers({ now: start });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-refresh-failure-'));
    const log = logger();
    const module = await createStateGatesModule({
      householdId: 'home', eventBus: { publish: vi.fn() }, configService: config(directory, emptyPolicy()),
      clock: { now: () => Date.now() }, logger: log,
      retryPolicy: { initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000, jitterRatio: 0 },
    });
    const repositoryModule = await import('#adapters/state-gates/persistence/YamlStateGatesProjectionRepository.mjs');
    const originalLoad = repositoryModule.YamlStateGatesProjectionRepository.prototype.load;
    let armed = false;
    let loads = 0;
    const loadSpy = vi.spyOn(repositoryModule.YamlStateGatesProjectionRepository.prototype, 'load')
      .mockImplementation(function load(...args) {
        if (armed && ++loads === 2) return Promise.reject(new Error('refresh unavailable'));
        return originalLoad.apply(this, args);
      });
    try {
      armed = true;
      await expect(module.administrationOperations.evaluateGates('home', 'manual_refresh'))
        .resolves.toMatchObject({ result: 'evaluated', currentRevision: 2 });
      expect(log.error).toHaveBeenCalledWith('state-gates.boundary.refresh_failed', expect.objectContaining({
        householdId: 'home', error: 'refresh unavailable', retryInMs: 1_000,
      }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(loads).toBeGreaterThanOrEqual(3);
    } finally {
      loadSpy.mockRestore();
      module.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([-0.1, 1.1, Number.NaN])('rejects invalid retry jitter ratio %s', async jitterRatio => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-invalid-retry-'));
    await expect(createStateGatesModule({
      householdId: 'home', eventBus: { publish: vi.fn() }, configService: config(directory, emptyPolicy()),
      logger: logger(), retryPolicy: { jitterRatio },
    })).rejects.toThrow('State Gates retry policy is invalid');
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
