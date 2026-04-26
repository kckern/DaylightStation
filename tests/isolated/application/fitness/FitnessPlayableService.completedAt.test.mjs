// tests/isolated/application/fitness/FitnessPlayableService.completedAt.test.mjs
import { describe, test, expect, vi } from 'vitest';
import { FitnessPlayableService } from '#apps/fitness/FitnessPlayableService.mjs';

function makeService({ items, classifyResult = 'in_progress' } = {}) {
  const fakeAdapter = {
    resolvePlayables: vi.fn().mockResolvedValue(items),
    getContainerInfo: vi.fn().mockResolvedValue(null),
    getItem: vi.fn().mockResolvedValue(null),
  };
  return new FitnessPlayableService({
    fitnessConfigService: { loadRawConfig: () => ({}) },
    contentAdapter: fakeAdapter,
    contentQueryService: null,
    createProgressClassifier: () => ({ classify: () => classifyResult }),
    logger: { info: vi.fn(), warn: vi.fn() }
  });
}

describe('FitnessPlayableService treats completedAt as ever-completed', () => {
  test('isWatched = true when completedAt is set, even if percent low and classifier says in_progress', async () => {
    const svc = makeService({
      items: [{
        id: 'plex:674498',
        playhead: 40,
        percent: 6,
        duration: 678,
        watchTime: 705,
        completedAt: '2026-04-20 06:07:44',
        metadata: { viewCount: 0 }
      }],
      classifyResult: 'in_progress'
    });
    const result = await svc.getPlayableEpisodes('674496');
    expect(result.items[0].isWatched).toBe(true);
  });

  test('isWatched = false when completedAt is null and classifier says in_progress', async () => {
    const svc = makeService({
      items: [{
        id: 'plex:100',
        playhead: 40,
        percent: 6,
        duration: 678,
        watchTime: 40,
        completedAt: null,
        metadata: { viewCount: 0 }
      }],
      classifyResult: 'in_progress'
    });
    const result = await svc.getPlayableEpisodes('99');
    expect(result.items[0].isWatched).toBe(false);
  });
});
