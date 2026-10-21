// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { startEconomyPayouts } from "./earnings.mjs";

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const due = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; due.set(id, { fn, at: now + ms }); return id; },
      clearTimeout: (id) => { due.delete(id); },
    },
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...due]) if (t.at <= now) { due.delete(id); t.fn(); }
      await new Promise((r) => setImmediate(r));
    },
    pending: () => due.size,
  };
}

function fakeBus() {
  const handlers = new Map();
  return {
    subscribe: vi.fn((topic, fn) => { handlers.set(topic, fn); return () => handlers.delete(topic); }),
    emit: (topic, payload) => handlers.get(topic)?.(payload),
    topics: () => [...handlers.keys()],
  };
}

// Wednesday 2026-09-30, noon Pacific: inside the Monday–Wednesday grace window.
const WEDNESDAY = '2026-09-30T19:00:00.000Z';
const FRIDAY = '2026-10-02T19:00:00.000Z';

function setup({ mode = 'live', settle = async () => ({}), settleAll = async () => ({}), now = WEDNESDAY, enabled = true } = {}) {
  const state = { mode };
  const clock = fakeTimers();
  const bus = fakeBus();
  const tasks = new Map();
  const scheduler = { registerTask: vi.fn((key, cron, fn) => tasks.set(key, { cron, fn })) };
  const payoutService = { settle: vi.fn(settle), settleAll: vi.fn(settleAll) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const wiring = startEconomyPayouts({
    payoutService, config: { catalog: () => ({ mode: state.mode }) }, eventBus: bus, scheduler, logger, enabled,
    clock: () => new Date(now), timezone: 'America/Los_Angeles', debounceMs: 30_000, timers: clock.timers,
  });
  return { state, clock, bus, tasks, scheduler, payoutService, logger, wiring };
}

describe('startEconomyPayouts', () => {
  it('subscribes to school outcomes and piano lessons, and registers the hourly reconcile', () => {
    const { bus, scheduler } = setup();
    expect(bus.topics()).toEqual(['school.session.outcome-recorded', 'piano.lesson.completed']);
    expect(scheduler.registerTask).toHaveBeenCalledWith('economy:payout-reconcile', '0 * * * *', expect.any(Function));
  });

  it('disabled (no cron on this backend): no subscriptions, no task, one info line', () => {
    const { bus, scheduler, logger } = setup({ enabled: false });
    expect(bus.subscribe).not.toHaveBeenCalled();
    expect(scheduler.registerTask).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('economy.payout.disabled', expect.any(Object));
  });

  it('a grade change for last week\'s session settles last week', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a', sessionId: 's1', studyDay: '2026-09-24' });
    await clock.advance(30_000);
    expect(payoutService.settle).toHaveBeenCalledWith({ learnerId: 'learner-a', week: '2026-09-21' });
  });

  it('debounces per learner and week: this week and last week settle separately', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a', studyDay: '2026-09-24' });
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a', studyDay: '2026-09-25' });
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a', studyDay: '2026-09-29' }); // this week
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' });
    await clock.advance(30_000);
    expect(payoutService.settle.mock.calls.map(([a]) => a)).toEqual([
      { learnerId: 'learner-a', week: '2026-09-21' }, { learnerId: 'learner-a', week: null },
    ]);
  });

  it('the reconcile also settles last week Monday to Wednesday', async () => {
    const { tasks, payoutService } = setup({ now: WEDNESDAY });
    await tasks.get('economy:payout-reconcile').fn();
    expect(payoutService.settleAll.mock.calls.map(([a]) => a)).toEqual([{ week: null }, { week: '2026-09-21' }]);
  });

  it('the reconcile settles only the current week from Thursday on', async () => {
    const { tasks, payoutService } = setup({ now: FRIDAY });
    await tasks.get('economy:payout-reconcile').fn();
    expect(payoutService.settleAll.mock.calls.map(([a]) => a)).toEqual([{ week: null }]);
  });

  it('debounces per learner: a burst of outcomes settles once, 30 s after the last', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a', sessionId: 's1' });
    await clock.advance(20_000);
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a', sessionId: 's2' });
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-b', sessionId: 's3' });
    await clock.advance(20_000);
    expect(payoutService.settle).not.toHaveBeenCalled();
    await clock.advance(10_000);
    expect(payoutService.settle.mock.calls.map(([a]) => a)).toEqual([
      { learnerId: 'learner-a', week: null }, { learnerId: 'learner-b', week: null },
    ]);
  });

  it('a piano lesson settles its player (the payload names them userId)', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('piano.lesson.completed', { userId: 'learner-a', plexId: 'plex:1' });
    await clock.advance(30_000);
    expect(payoutService.settle).toHaveBeenCalledWith({ learnerId: 'learner-a', week: null });
  });

  it('ignores a payload with no learner', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school.session.outcome-recorded', { sessionId: 's1' });
    bus.emit('piano.lesson.completed', null);
    await clock.advance(30_000);
    expect(payoutService.settle).not.toHaveBeenCalled();
  });

  it('off: events and the reconcile do nothing; a reload to live takes effect', async () => {
    const { state, bus, clock, tasks, payoutService } = setup({ mode: 'off' });
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' });
    await tasks.get('economy:payout-reconcile').fn();
    expect(clock.pending()).toBe(0);
    expect(payoutService.settleAll).not.toHaveBeenCalled();
    state.mode = 'live';
    await tasks.get('economy:payout-reconcile').fn();
    expect(payoutService.settleAll).toHaveBeenCalledWith({ week: null });
  });

  it('a failing settle is logged, never thrown into the bus or the scheduler', async () => {
    const boom = async () => { throw new Error('ledger unreadable'); };
    const { bus, clock, tasks, logger } = setup({ settle: boom, settleAll: boom });
    expect(() => bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' })).not.toThrow();
    await clock.advance(30_000);
    await expect(tasks.get('economy:payout-reconcile').fn()).resolves.toBeUndefined();
    expect(logger.warn.mock.calls.map(([event, data]) => [event, data.learnerId, data.error])).toEqual([
      ['economy.payout.failed', 'learner-a', 'ledger unreadable'],
      ['economy.payout.failed', null, 'ledger unreadable'],
    ]);
  });

  it('a corrupt ledger on the event path is logged at error', async () => {
    const corrupt = Object.assign(new Error('shard is not a list'), { code: 'CORRUPT_LEDGER' });
    const { bus, clock, logger } = setup({ settle: async () => { throw corrupt; } });
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' });
    await clock.advance(30_000);
    expect(logger.error).toHaveBeenCalledWith('economy.payout.failed', expect.objectContaining({ learnerId: 'learner-a', code: 'CORRUPT_LEDGER' }));
  });

  it('a piano player who is not on the roster is a debug line, not a failure', async () => {
    const { bus, clock, logger } = setup({ settle: async () => { throw new EntityNotFoundError('learner', 'guest'); } });
    bus.emit('piano.lesson.completed', { userId: 'guest' });
    await clock.advance(30_000);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('economy.payout.unknown-learner', expect.objectContaining({ learnerId: 'guest' }));
  });

  it('works without a scheduler or a bus, and stop() unsubscribes, drops pending settles and idles the task', async () => {
    expect(() => startEconomyPayouts({ payoutService: {}, config: { catalog: () => ({ mode: 'live' }) } })).not.toThrow();
    const { bus, clock, wiring, payoutService, tasks } = setup();
    const handler = bus.subscribe.mock.calls[0][1];
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' });
    wiring.stop();
    await clock.advance(30_000);
    expect(bus.topics()).toEqual([]);
    handler({ learnerId: 'learner-a' }); // a bus that still holds the handler
    await clock.advance(30_000);
    await tasks.get('economy:payout-reconcile').fn(); // the scheduler has no unregister
    expect(payoutService.settle).not.toHaveBeenCalled();
    expect(payoutService.settleAll).not.toHaveBeenCalled();
  });
});
