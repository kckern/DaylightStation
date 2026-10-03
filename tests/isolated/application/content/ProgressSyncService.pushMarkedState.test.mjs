import { describe, it, expect, vi } from 'vitest';
import { ProgressSyncService } from '#apps/content/services/ProgressSyncService.mjs';
import { ProgressWriteRuntime } from '#adapters/content/ProgressWriteRuntime.mjs';

describe('ProgressSyncService.pushMarkedState (mark watched/unwatched)', () => {
  it('writes the mark to the remote at once and cancels a pending debounced heartbeat', async () => {
    const remote = { getProgress: vi.fn().mockResolvedValue(null), updateProgress: vi.fn().mockResolvedValue() };
    const runtime = new ProgressWriteRuntime();
    const service = new ProgressSyncService({
      remoteProgressProvider: remote,
      mediaProgressMemory: { findProgress: vi.fn().mockResolvedValue(null), saveProgress: vi.fn() },
      progressWriteRuntime: runtime,
      clock: { now: () => new Date(), epoch: () => Date.now() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    // a heartbeat is buffered for 30 s
    service._skepticalMap.set('abs:b1', { lastCommittedPlayhead: 0, watchTimeAccumulated: 0, namespaceId: 'abs' });
    await service.onProgressUpdate('abs:b1', 'b1', { playhead: 30, duration: 3600, percent: 1, watchTime: 30 });
    expect(service._debounceMap.has('abs:b1')).toBe(true);

    await service.pushMarkedState('abs:b1', 'b1', { currentTime: 3600, isFinished: true });

    expect(remote.updateProgress).toHaveBeenCalledWith('b1', { currentTime: 3600, isFinished: true });
    expect(service._debounceMap.has('abs:b1')).toBe(false);
    expect(service._skepticalMap.has('abs:b1')).toBe(false);
    service.dispose();
  });
});
