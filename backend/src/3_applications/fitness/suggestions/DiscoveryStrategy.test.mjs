import { describe, it, expect } from 'vitest';
import { DiscoveryStrategy, seededRandom } from './DiscoveryStrategy.mjs';

// Discovery used Math.random per request. The home screen asks every 5 minutes,
// so its cards reshuffled under the user and each request pulled fresh,
// never-cached shows from a ~280-show library. Picks are now stable per day.
const shows = Array.from({ length: 40 }, (_, i) => ({ id: String(1000 + i), title: `Show ${i}` }));

function context(overrides = {}) {
  return {
    suggestionPolicy: {
      discoveryLapsedDays: 30, discoveryLapsedWeight: 0.7, minimumDurationSeconds: 0,
      warmupTitlePatterns: [], warmupDescriptionTags: [],
    },
    householdId: 'h',
    excludedShowIds: new Set(),
    contentCatalog: { canonicalize: (id) => ({ contentId: `plex:${String(id).replace(/^plex:/, '')}`, localId: String(id).replace(/^plex:/, ''), source: 'plex' }) },
    sessionDatastore: { findInRange: async () => [] },
    fitnessPlayableService: {
      listFitnessShows: async () => ({ shows }),
      getPlayableEpisodes: async (showId) => ({
        items: [1, 2, 3].map((n) => ({ id: `plex:${showId}${n}`, title: `Ep ${n}`, duration: 1800, metadata: { itemIndex: n, parentIndex: 1, labels: [] } })),
        info: { labels: [] },
      }),
    },
    ...overrides,
  };
}

const showIds = (cards) => cards.map((c) => c.showId);

describe('DiscoveryStrategy picks', () => {
  it('are the same across requests on the same day', async () => {
    const strategy = new DiscoveryStrategy();
    const first = await strategy.suggest(context(), 6);
    const second = await strategy.suggest(context(), 6);
    expect(first.length).toBeGreaterThan(0);
    expect(showIds(second)).toEqual(showIds(first));
    expect(second.map((c) => c.contentId)).toEqual(first.map((c) => c.contentId));
  });

  it('change with the seed (another day or household)', async () => {
    const strategy = new DiscoveryStrategy();
    const a = await strategy.suggest(context({ random: seededRandom('2026-10-01:h') }), 6);
    const b = await strategy.suggest(context({ random: seededRandom('2026-10-02:h') }), 6);
    expect(showIds(a)).not.toEqual(showIds(b));
  });
});
