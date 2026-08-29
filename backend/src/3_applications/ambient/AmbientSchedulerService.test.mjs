import { describe, expect, it, vi } from 'vitest';
import { AmbientSchedulerService } from './AmbientSchedulerService.mjs';

describe('AmbientSchedulerService runtime scheduling boundary', () => {
  it('uses the injected cadence and cancels it on stop', async () => {
    const cancel = vi.fn();
    const every = vi.fn(() => cancel);
    const stateStore = { load: vi.fn(async () => ({})), save: vi.fn(async () => {}) };
    const service = new AmbientSchedulerService({
      loadSchedule: async () => ({ windows: [], warnings: [] }),
      tracker: { isPlaying: () => false },
      wakeAndLoadService: { execute: vi.fn() },
      deviceService: { get: vi.fn() },
      stateStore,
      scheduler: { every },
      clock: { now: () => Date.parse('2026-08-28T12:00:00.000Z') },
      logger: { info() {}, warn() {}, error() {} },
    });

    service.start(12_345);
    expect(every).toHaveBeenCalledWith(12_345, expect.any(Function));
    await vi.waitFor(() => expect(stateStore.save).toHaveBeenCalledTimes(1));
    service.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
