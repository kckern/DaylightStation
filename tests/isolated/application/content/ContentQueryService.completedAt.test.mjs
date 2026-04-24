// tests/isolated/application/content/ContentQueryService.completedAt.test.mjs
import { describe, test, expect, jest } from '@jest/globals';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService.enrichWithWatchState propagates completedAt', () => {
  test('enriched item carries completedAt from stored progress', async () => {
    const mockAdapter = {
      source: 'plex',
      getStoragePath: jest.fn().mockResolvedValue('plex/14_fitness'),
    };
    const mockRegistry = {
      get: jest.fn().mockReturnValue(mockAdapter),
      list: jest.fn(() => []),
      resolveSource: jest.fn(() => [])
    };
    const mockMemory = {
      getAll: jest.fn().mockResolvedValue([
        {
          contentId: 'plex:674498',
          playhead: 40,
          duration: 678,
          percent: 6,
          playCount: 2,
          lastPlayed: '2026-04-23 21:06:43',
          watchTime: 705,
          completedAt: '2026-04-20 06:07:44'
        }
      ]),
      getAllFromAllLibraries: jest.fn().mockResolvedValue([])
    };
    const service = new ContentQueryService({
      registry: mockRegistry,
      mediaProgressMemory: mockMemory
    });

    const items = [{ id: 'plex:674498', title: 'Week 1 Day 1 - Upper Body' }];
    const enriched = await service.enrichWithWatchState(items, 'plex', 'plex:674496');

    expect(enriched[0].completedAt).toBe('2026-04-20 06:07:44');
  });

  test('enriched item has completedAt=null when progress has no completedAt', async () => {
    const mockAdapter = {
      source: 'plex',
      getStoragePath: jest.fn().mockResolvedValue('plex/14_fitness'),
    };
    const mockRegistry = {
      get: jest.fn().mockReturnValue(mockAdapter),
      list: jest.fn(() => []),
      resolveSource: jest.fn(() => [])
    };
    const mockMemory = {
      getAll: jest.fn().mockResolvedValue([
        {
          contentId: 'plex:100',
          playhead: 40,
          duration: 678,
          percent: 6,
          playCount: 1,
          lastPlayed: '2026-04-23 21:06:43',
          watchTime: 40,
          completedAt: null
        }
      ]),
      getAllFromAllLibraries: jest.fn().mockResolvedValue([])
    };
    const service = new ContentQueryService({
      registry: mockRegistry,
      mediaProgressMemory: mockMemory
    });

    const items = [{ id: 'plex:100', title: 'Some show' }];
    const enriched = await service.enrichWithWatchState(items, 'plex', 'plex:99');

    expect(enriched[0].completedAt).toBeNull();
  });
});
