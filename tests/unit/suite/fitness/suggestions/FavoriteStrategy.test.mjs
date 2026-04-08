// tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs
import { FavoriteStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs';

function makeEpisode(id, index, { isWatched = false, summary = null } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration: 1800,
    isWatched,
    metadata: { type: 'episode', grandparentTitle: 'Test Show', itemIndex: index, summary },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeContext(favorites = [], contentItems = {}, playablesByShow = {}) {
  return {
    fitnessConfig: {
      suggestions: { favorites },
    },
    contentAdapter: {
      getItem: async (compoundId) => contentItems[compoundId] || null,
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (showId) => ({
        items: playablesByShow[showId] || [],
      }),
    },
  };
}

describe('FavoriteStrategy', () => {
  const strategy = new FavoriteStrategy();

  test('returns empty when no favorites configured', async () => {
    const result = await strategy.suggest(makeContext([]), 4);
    expect(result).toEqual([]);
  });

  test('resolves next unwatched episode from favorite show', async () => {
    const ctx = makeContext(
      [12345],
      { 'plex:12345': { title: 'Game Cycling', metadata: { type: 'show' } } },
      { '12345': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: false }),
        makeEpisode(1003, 3, { isWatched: false }),
      ]}
    );
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('favorite');
    expect(result[0].action).toBe('play');
    expect(result[0].contentId).toBe('plex:1002');
    expect(result[0].showTitle).toBe('Game Cycling');
    expect(result[0].orientation).toBe('landscape');
  });

  test('picks random episode when all are watched', async () => {
    const ctx = makeContext(
      [12345],
      { 'plex:12345': { title: 'Done Show', metadata: { type: 'show' } } },
      { '12345': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: true }),
      ]}
    );
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('play');
    expect(['plex:1001', 'plex:1002']).toContain(result[0].contentId);
  });

  test('skips favorites with no episodes', async () => {
    const ctx = makeContext(
      [99999],
      { 'plex:99999': { title: 'Empty Show', metadata: { type: 'show' } } },
      { '99999': [] }
    );
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('respects remainingSlots', async () => {
    const ctx = makeContext(
      [100, 200, 300],
      {
        'plex:100': { title: 'A', metadata: { type: 'show' } },
        'plex:200': { title: 'B', metadata: { type: 'show' } },
        'plex:300': { title: 'C', metadata: { type: 'show' } },
      },
      {
        '100': [makeEpisode(1001, 1)],
        '200': [makeEpisode(2001, 1)],
        '300': [makeEpisode(3001, 1)],
      }
    );
    const result = await strategy.suggest(ctx, 2);
    expect(result).toHaveLength(2);
  });
});
