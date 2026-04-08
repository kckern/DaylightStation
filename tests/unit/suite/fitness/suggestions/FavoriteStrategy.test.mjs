// tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs
import { FavoriteStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs';

function makeContext(favorites = [], contentItems = {}) {
  return {
    fitnessConfig: {
      suggestions: { favorites },
    },
    contentAdapter: {
      getItem: async (compoundId) => contentItems[compoundId] || null,
    },
  };
}

describe('FavoriteStrategy', () => {
  const strategy = new FavoriteStrategy();

  test('returns empty when no favorites configured', async () => {
    const result = await strategy.suggest(makeContext([]), 4);
    expect(result).toEqual([]);
  });

  test('returns show-level favorite with browse action', async () => {
    const ctx = makeContext([12345], {
      'plex:12345': {
        id: 'plex:12345',
        localId: '12345',
        title: 'Video Game Cycling',
        metadata: { type: 'show' },
        thumbnail: '/api/v1/content/plex/image/12345',
      }
    });
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('favorite');
    expect(result[0].action).toBe('browse');
    expect(result[0].orientation).toBe('portrait');
    expect(result[0].showTitle).toBe('Video Game Cycling');
  });

  test('returns episode-level favorite with play action', async () => {
    const ctx = makeContext([67890], {
      'plex:67890': {
        id: 'plex:67890',
        localId: '67890',
        title: 'Ep 5: Best Ride',
        duration: 2400,
        metadata: {
          type: 'episode',
          grandparentId: 'plex:12345',
          grandparentTitle: 'VG Cycling',
        },
        thumbnail: '/api/v1/display/plex/67890',
      }
    });
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('play');
    expect(result[0].orientation).toBe('landscape');
  });

  test('skips favorites that fail to resolve', async () => {
    const ctx = makeContext([99999], {});
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('respects remainingSlots', async () => {
    const ctx = makeContext([100, 200, 300], {
      'plex:100': { id: 'plex:100', localId: '100', title: 'A', metadata: { type: 'show' } },
      'plex:200': { id: 'plex:200', localId: '200', title: 'B', metadata: { type: 'show' } },
      'plex:300': { id: 'plex:300', localId: '300', title: 'C', metadata: { type: 'show' } },
    });
    const result = await strategy.suggest(ctx, 2);
    expect(result).toHaveLength(2);
  });
});
