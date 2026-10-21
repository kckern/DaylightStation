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

function setup({ mode = 'live', settle = async () => ({}), settleAll = async () => ({}) } = {}) {
  const state = { mode };
  const clock = fakeTimers();
  const bus = fakeBus();
  const tasks = new Map();
  const scheduler = { registerTask: vi.fn((key, cron, fn) => tasks.set(key, { cron, fn })) };
  const payoutService = { settle: vi.fn(settle), settleAll: vi.fn(settleAll) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const wiring = startEconomyPayouts({
    payoutService, config: { catalog: () => ({ mode: state.mode }) }, eventBus: bus, scheduler, logger,
    debounceMs: 30_000, timers: clock.timers,
  });
  return { state, clock, bus, tasks, scheduler, payoutService, logger, wiring };
}

describe('startEconomyPayouts', () => {
  it('subscribes to school outcomes and piano lessons, and registers the 15-minute reconcile', () => {
    const { bus, scheduler } = setup();
    expect(bus.topics()).toEqual(['school.session.outcome-recorded', 'piano.lesson.completed']);
    expect(scheduler.registerTask).toHaveBeenCalledWith('economy:payout-reconcile', '*/15 * * * *', expect.any(Function));
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

  it('a piano player who is not on the roster is a debug line, not a failure', async () => {
    const { bus, clock, logger } = setup({ settle: async () => { throw new EntityNotFoundError('learner', 'guest'); } });
    bus.emit('piano.lesson.completed', { userId: 'guest' });
    await clock.advance(30_000);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('economy.payout.unknown-learner', expect.objectContaining({ learnerId: 'guest' }));
  });

  it('works without a scheduler or a bus, and stop() unsubscribes and drops pending settles', async () => {
    expect(() => startEconomyPayouts({ payoutService: {}, config: { catalog: () => ({ mode: 'live' }) } })).not.toThrow();
    const { bus, clock, wiring, payoutService } = setup();
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' });
    wiring.stop();
    await clock.advance(30_000);
    expect(bus.topics()).toEqual([]);
    expect(payoutService.settle).not.toHaveBeenCalled();
  });
});
