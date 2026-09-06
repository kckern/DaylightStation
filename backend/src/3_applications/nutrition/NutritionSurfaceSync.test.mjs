import { describe, it, expect, vi } from 'vitest';
import { NutritionSurfaceSync } from './NutritionSurfaceSync.mjs';

describe('NutritionSurfaceSync — publisher trigger, not a second receipt owner', () => {
  it('requests current receipts for each owner without accepting text or rows', async () => {
    const publisher = { publish: vi.fn(async () => {}) };
    const sync = new NutritionSurfaceSync({ users: () => ['alice', 'bob'], publisher, logger: { warn: vi.fn() } });
    await sync.run();
    expect(publisher.publish.mock.calls).toEqual([['alice'], ['bob']]);
  });
  it('coalesces overlapping ticks and recovers after an owner fails', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const publisher = { publish: vi.fn(async owner => { if (owner === 'alice') { await pending; throw new Error('offline'); } }) };
    const logger = { warn: vi.fn() };
    const sync = new NutritionSurfaceSync({ users: () => ['alice', 'bob'], publisher, logger });
    const first = sync.run(); expect(sync.run()).toBe(first);
    release(); await first;
    expect(logger.warn).toHaveBeenCalledWith('nutrition.surface.retry', { userId: 'alice', error: 'offline' });
    expect(publisher.publish).toHaveBeenCalledWith('bob');
    await sync.run(); expect(publisher.publish).toHaveBeenCalledTimes(4);
  });
  it('requires the sole publisher instead of accepting a transport or private renderer', () => {
    expect(() => new NutritionSurfaceSync({ users: () => [], surface: {}, logger: {} })).toThrow('requires publisher');
  });
});
