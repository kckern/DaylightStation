// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { startEconomyPayouts, startWeekClose } from "./earnings.mjs";

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

// The study day the preview calls "today" (PayoutService.currentStudyDay):
// Wednesday is inside the Monday–Wednesday grace window, Friday is not.
const WEDNESDAY = '2026-09-30';
const FRIDAY = '2026-10-02';

function setup({ mode = 'live', settle = async () => ({}), settleAll = async () => ({}), now = WEDNESDAY, enabled = true } = {}) {
  const state = { mode };
  const clock = fakeTimers();
  const bus = fakeBus();
  const tasks = new Map();
  const scheduler = { registerTask: vi.fn((key, cron, fn) => tasks.set(key, { cron, fn })) };
  const payoutService = { settle: vi.fn(settle), settleAll: vi.fn(settleAll), currentStudyDay: vi.fn(() => now) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const wiring = startEconomyPayouts({
    payoutService, config: { catalog: () => ({ mode: state.mode }) }, eventBus: bus, scheduler, logger, enabled,
    debounceMs: 30_000, timers: clock.timers,
  });
  return { state, clock, bus, tasks, scheduler, payoutService, logger, wiring };
}

describe('startEconomyPayouts', () => {
  it('subscribes to school outcomes, day completion, piano lessons and story reads, and registers the hourly reconcile', () => {
    const { bus, scheduler } = setup();
    expect(bus.topics()).toEqual([
      'school.session.outcome-recorded', 'school.completion.state-observed', 'piano.lesson.completed', 'school',
    ]);
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

  it('a failing current-week reconcile still settles last week', async () => {
    let calls = 0;
    const { tasks, payoutService, logger } = setup({ settleAll: async () => { calls += 1; if (calls === 1) throw new Error('roster down'); return {}; } });
    await tasks.get('economy:payout-reconcile').fn();
    expect(payoutService.settleAll.mock.calls.map(([a]) => a)).toEqual([{ week: null }, { week: '2026-09-21' }]);
    expect(logger.warn).toHaveBeenCalledWith('economy.payout.failed', expect.objectContaining({ error: 'roster down' }));
  });

  it('"today" is the preview\'s own study day, so the grace window and week: null cannot drift', async () => {
    const { tasks, payoutService } = setup({ now: '2026-09-28' }); // a Monday by the preview's boundary
    await tasks.get('economy:payout-reconcile').fn();
    expect(payoutService.currentStudyDay).toHaveBeenCalled();
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

  it('a day turning green settles that learner, without waiting for the hourly reconcile', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school.completion.state-observed', {
      learnerId: 'learner-a', studyDate: WEDNESDAY, state: 'complete', previousState: 'incomplete',
    });
    await clock.advance(30_000);
    expect(payoutService.settle.mock.calls.map(([a]) => a)).toEqual([{ learnerId: 'learner-a', week: null }]);
  });

  it('a completion fact naming last week (studyDate) settles last week', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school.completion.state-observed', { learnerId: 'learner-a', studyDate: '2026-09-25', state: 'complete' });
    await clock.advance(30_000);
    expect(payoutService.settle).toHaveBeenCalledWith({ learnerId: 'learner-a', week: '2026-09-21' });
  });

  it('a story read or a day bypass on the school broadcast settles; other school events do not', async () => {
    const { bus, clock, payoutService } = setup();
    bus.emit('school', { event: 'story-read', learnerId: 'learner-a' });
    bus.emit('school', { event: 'session-issued', learnerId: 'learner-b' });
    await clock.advance(30_000);
    bus.emit('school', { event: 'program-day-bypass-changed', learnerId: 'learner-c' });
    await clock.advance(30_000);
    expect(payoutService.settle.mock.calls.map(([a]) => a.learnerId)).toEqual(['learner-a', 'learner-c']);
  });

  it('settles two seconds after the last fact by default', async () => {
    const clock = fakeTimers();
    const bus = fakeBus();
    const payoutService = { settle: vi.fn(async () => ({})), settleAll: vi.fn(), currentStudyDay: () => WEDNESDAY };
    startEconomyPayouts({ payoutService, config: { catalog: () => ({ mode: 'live' }) }, eventBus: bus,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, timers: clock.timers });
    bus.emit('school.session.outcome-recorded', { learnerId: 'learner-a' });
    await clock.advance(1_999);
    expect(payoutService.settle).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(payoutService.settle).toHaveBeenCalledTimes(1);
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
      ['economy.payout.failed', null, 'ledger unreadable'], // this week
      ['economy.payout.failed', null, 'ledger unreadable'], // last week (Wednesday: grace window)
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

describe('startWeekClose', () => {
  function setupClose({ mode = 'live', cron = '30 23 * * 0', close = async () => ({}), enabled = true, catalog = null } = {}) {
    const state = { mode, cron };
    const tasks = new Map();
    const scheduler = { registerTask: vi.fn((key, c, fn) => tasks.set(key, { cron: c, fn })) };
    const weekCloseService = { close: vi.fn(close) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const config = { catalog: catalog ?? (() => ({ mode: state.mode, week_close: { cron: state.cron, convert: [] } })) };
    const wiring = startWeekClose({ weekCloseService, config, scheduler, logger, enabled });
    return { state, tasks, scheduler, weekCloseService, logger, wiring };
  }

  it('registers economy:week-close on the catalog cron; the task closes the week the service resolves', async () => {
    const { scheduler, tasks, weekCloseService } = setupClose();
    expect(scheduler.registerTask).toHaveBeenCalledWith('economy:week-close', '30 23 * * 0', expect.any(Function));
    await tasks.get('economy:week-close').fn();
    expect(weekCloseService.close).toHaveBeenCalledWith({});
  });

  it.each([['null', null], ['empty', ''], ['blank', '  ']])('a %s cron registers nothing and says so once', (_label, cron) => {
    const { scheduler, logger } = setupClose({ cron });
    expect(scheduler.registerTask).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('economy.week-close.no-cron', expect.any(Object));
  });

  it('disabled (no cron on this backend): registers nothing, one info line', () => {
    const { scheduler, logger } = setupClose({ enabled: false });
    expect(scheduler.registerTask).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('economy.week-close.disabled', expect.any(Object));
  });

  it('a catalog that cannot be read at boot registers nothing and warns', () => {
    const { scheduler, logger } = setupClose({ catalog: () => { throw new Error('bad yaml'); } });
    expect(scheduler.registerTask).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('economy.week-close.failed', expect.objectContaining({ error: 'bad yaml' }));
  });

  it('registers even while off, so a reload to live needs no restart; the close itself reads the mode', async () => {
    const { tasks, scheduler, weekCloseService } = setupClose({ mode: 'off' });
    expect(scheduler.registerTask).toHaveBeenCalledWith('economy:week-close', '30 23 * * 0', expect.any(Function));
    await tasks.get('economy:week-close').fn();
    expect(weekCloseService.close).toHaveBeenCalledWith({});
  });

  it('a failing close is logged, never thrown into the scheduler; a corrupt ledger is error', async () => {
    const corrupt = Object.assign(new Error('shard is not a list'), { code: 'CORRUPT_LEDGER' });
    let err = new Error('roster down');
    const { tasks, logger } = setupClose({ close: async () => { throw err; } });
    await expect(tasks.get('economy:week-close').fn()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('economy.week-close.failed', expect.objectContaining({ error: 'roster down' }));
    err = corrupt;
    await tasks.get('economy:week-close').fn();
    expect(logger.error).toHaveBeenCalledWith('economy.week-close.failed', expect.objectContaining({ code: 'CORRUPT_LEDGER' }));
  });

  it('stop() idles the task', async () => {
    const { tasks, wiring, weekCloseService } = setupClose();
    wiring.stop();
    await tasks.get('economy:week-close').fn();
    expect(weekCloseService.close).not.toHaveBeenCalled();
  });
});
