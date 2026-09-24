import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MealCoachingTrigger } from '../../../backend/src/3_applications/coaching/MealCoachingTrigger.mjs';

describe('MealCoachingTrigger', () => {
  let orchestrator;
  const make = (config) => new MealCoachingTrigger({
    getOrchestrator: () => orchestrator, userId: 'kckern', conversationId: 'telegram:b1_c2',
    scheduler: { setTimeout, clearTimeout }, config, logger: {},
  });

  beforeEach(() => {
    vi.useFakeTimers();
    orchestrator = { sendPostReport: vi.fn(async () => {}) };
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
});
