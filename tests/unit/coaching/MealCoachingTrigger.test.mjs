import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MealCoachingTrigger } from '../../../backend/src/3_applications/coaching/MealCoachingTrigger.mjs';

describe('MealCoachingTrigger', () => {
  let orchestrator;
  let clock;
  const make = (config) => new MealCoachingTrigger({
    getOrchestrator: () => orchestrator, userId: 'kckern', conversationId: 'telegram:b1_c2',
    scheduler: { setTimeout, clearTimeout }, config, logger: {},
    today: () => clock.date, localTime: () => clock.time,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    orchestrator = { sendPostReport: vi.fn(async () => {}) };
    clock = { date: '2026-09-24', time: '12:30' };
  });
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of captures into one post-meal send after the quiet period', async () => {
    const trigger = make();
    trigger.notify({ userId: 'kckern', source: 'image' });
    await vi.advanceTimersByTimeAsync(30_000);
    trigger.notify({ userId: 'kckern', source: 'voice' });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(orchestrator.sendPostReport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(orchestrator.sendPostReport).toHaveBeenCalledOnce();
    expect(orchestrator.sendPostReport).toHaveBeenCalledWith({ userId: 'kckern', conversationId: 'telegram:b1_c2' });
  });

  it("ignores other household members' captures", async () => {
    const trigger = make();
    expect(trigger.notify({ userId: 'elizabeth' })).toBe(false);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(orchestrator.sendPostReport).not.toHaveBeenCalled();
  });

  it('honours enabled:false and a configured quiet period', async () => {
    expect(make({ enabled: false }).notify({ userId: 'kckern' })).toBe(false);
    make({ quiet_minutes: 2 }).notify({ userId: 'kckern' });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(orchestrator.sendPostReport).toHaveBeenCalledOnce();
  });

  it("ignores a back-dated capture, but arms for today's", async () => {
    const trigger = make();
    expect(trigger.notify({ userId: 'kckern', date: '2026-09-23', source: 'text' })).toBe(false);
    expect(trigger.notify({ userId: 'kckern', date: '2026-09-24', source: 'text' })).toBe(true);
  });

  it('drops a send that would land in overnight quiet hours', async () => {
    const trigger = make();
    trigger.notify({ userId: 'kckern' });
    clock.time = '23:40';
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(orchestrator.sendPostReport).not.toHaveBeenCalled();
  });

  it('quiet_hours:false disables the window', async () => {
    const trigger = make({ quiet_hours: false });
    trigger.notify({ userId: 'kckern' });
    clock.time = '23:40';
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(orchestrator.sendPostReport).toHaveBeenCalledOnce();
  });
});

