// tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs
import { DiscoveryStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/DiscoveryStrategy.mjs';

function makeShow(id, title) {
  return { id: String(id), title, type: 'show', episodeCount: 10 };
}

function makeEpisode(id, index, { isWatched = false } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration: 1800,
    isWatched,
    watchProgress: isWatched ? 100 : 0,
    metadata: { type: 'episode', itemIndex: index, grandparentTitle: 'Test Show' },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeSession(showId, date) {
  return {
    date,
    media: { primary: { grandparentId: `plex:${showId}` } },
  };
}

function makeContext(allShows, playablesByShow = {}, recentSessions = [], config = {}) {
  return {
    recentSessions,
    fitnessConfig: {
      suggestions: {
        discovery_lapsed_days: 30,
        discovery_lapsed_weight: 0.7,
        ...config,
      },
    },
    fitnessPlayableService: {
      listFitnessShows: async () => ({ shows: allShows }),
      getPlayableEpisodes: async (showId) => ({
        items: playablesByShow[showId] || [makeEpisode(showId * 10, 1)],
      }),
    },
    sessionDatastore: {
      findInRange: async () => recentSessions,
    },
    householdId: 'test',
  };
}

describe('DiscoveryStrategy', () => {
  const strategy = new DiscoveryStrategy();

  test('returns cards to fill remaining slots', async () => {
    const shows = [makeShow(100, 'A'), makeShow(200, 'B'), makeShow(300, 'C')];
    const ctx = makeContext(shows);
    const result = await strategy.suggest(ctx, 3);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === 'discovery')).toBe(true);
  });

  test('returns empty when no remaining slots', async () => {
    const result = await strategy.suggest(makeContext([makeShow(100, 'A')]), 0);
    expect(result).toEqual([]);
  });

  test('sets action to play for episode-level results', async () => {
    const shows = [makeShow(100, 'A')];
    const playables = { '100': [makeEpisode(1001, 1)] };
    const ctx = makeContext(shows, playables);
    const result = await strategy.suggest(ctx, 1);
    expect(result[0].action).toBe('play');
    expect(result[0].orientation).toBe('landscape');
  });

  test('includes reason with days since last done', async () => {
    const shows = [makeShow(100, 'A')];
    const oldSessions = [makeSession('100', '2026-02-01')];
    const ctx = makeContext(shows, {}, oldSessions);
    const result = await strategy.suggest(ctx, 1);
    expect(result[0].reason).toMatch(/Last done \d+ days ago/);
  });
});
