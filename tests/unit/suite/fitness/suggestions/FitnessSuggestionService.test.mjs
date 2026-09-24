// tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs
import { FitnessSuggestionService } from '../../../../../backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs';

// Stub strategy: returns N cards for given showIds
function stubStrategy(type, showIds) {
  return {
    suggest: async (_ctx, remaining) => {
      return showIds.slice(0, remaining).map(sid => ({
        type,
        action: 'play',
        contentId: `plex:${sid}01`,
        showId: `plex:${sid}`,
        title: `Ep from ${sid}`,
        showTitle: `Show ${sid}`,
      }));
    }
  };
}

function makeService(strategies) {
  return new FitnessSuggestionService({
    strategies,
    sessionService: {
      listSessionsInRange: async () => [],
      resolveHouseholdId: (h) => h || 'default',
    },
    sessionDatastore: { findInRange: async () => [] },
    fitnessConfigService: {
      getSuggestionPolicy: () => ({ lookbackDays: 10, slots: 8, excludedCollectionIds: [] }),
    },
    fitnessPlayableService: { listFitnessShows: async () => ({ shows: [] }) },
    contentAdapter: null,
    contentQueryService: null,
    logger: { warn: () => {}, error: () => {}, debug: () => {} },
  });
}

describe('FitnessSuggestionService', () => {
  test('runs strategies in order and fills grid', async () => {
    const strategies = [
      stubStrategy('next_up', ['100', '200']),
      stubStrategy('resume', ['300']),
      stubStrategy('discovery', ['400', '500', '600', '700', '800']),
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 6 });

    expect(result.suggestions).toHaveLength(6);
    // Top row: next_up left, resume right
    expect(result.suggestions[0].type).toBe('next_up');
    expect(result.suggestions[1].type).toBe('next_up');
    expect(result.suggestions[2].type).toBe('discovery');
    expect(result.suggestions[3].type).toBe('resume');
  });

  test('deduplicates by showId — earlier strategy wins', async () => {
    const strategies = [
      stubStrategy('next_up', ['100']),
      stubStrategy('favorite', ['100', '200']),  // show 100 should be skipped
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });

    const show100Cards = result.suggestions.filter(s => s.showId === 'plex:100');
    expect(show100Cards).toHaveLength(1);
    expect(show100Cards[0].type).toBe('next_up');
  });

  test('handles strategy errors gracefully', async () => {
    const strategies = [
      { suggest: async () => { throw new Error('boom'); } },
      stubStrategy('discovery', ['100', '200']),
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 2 });

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].type).toBe('discovery');
  });

  test('returns empty array when all strategies fail', async () => {
    const strategies = [
      { suggest: async () => { throw new Error('fail'); } },
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });
    expect(result.suggestions).toEqual([]);
  });

  test('returns overflow candidates beyond grid size', async () => {
    const strategies = [
      stubStrategy('next_up', ['100', '200', '300', '400', '500', '600']),
      stubStrategy('discovery', ['700', '800', '900', '1000']),
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });

    expect(result.suggestions).toHaveLength(4);
    expect(result.overflow).toBeDefined();
    expect(result.overflow.length).toBeGreaterThan(0);
    expect(result.overflow.some(c => c.type === 'next_up')).toBe(true);
    const visibleShowIds = new Set(result.suggestions.map(s => s.showId));
    for (const card of result.overflow) {
      expect(visibleShowIds.has(card.showId)).toBe(false);
    }
  });

  test('overflow is capped at 4 cards', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(1000 + i));
    const strategies = [stubStrategy('next_up', ids)];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });

    expect(result.suggestions).toHaveLength(4);
    expect(result.overflow.length).toBeLessThanOrEqual(4);
  });

  test('overflow is empty when no excess candidates', async () => {
    const strategies = [stubStrategy('next_up', ['100', '200'])];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });

    expect(result.suggestions).toHaveLength(2);
    expect(result.overflow).toEqual([]);
  });

  test('memoizes getPlayableEpisodes across strategies (same show fetched once)', async () => {
    let underlyingCalls = 0;
    const callsByStrategy = [];
    // Two strategies both resolve the SAME show via the (memoized) context service.
    const playableStrategy = (label) => ({
      suggest: async (ctx) => {
        await ctx.fitnessPlayableService.getPlayableEpisodes('999');
        callsByStrategy.push(label);
        return [];
      },
    });
    const service = new FitnessSuggestionService({
      strategies: [playableStrategy('a'), playableStrategy('b')],
      sessionService: {
        listSessionsInRange: async () => [],
        resolveHouseholdId: (h) => h || 'default',
      },
      sessionDatastore: { findInRange: async () => [] },
      fitnessConfigService: {
        getSuggestionPolicy: () => ({ lookbackDays: 10, slots: 8, excludedCollectionIds: [] }),
      },
      fitnessPlayableService: {
        getPlayableEpisodes: async () => { underlyingCalls++; return { items: [], info: {} }; },
        listFitnessShows: async () => ({ shows: [] }),
      },
      contentAdapter: null,
      contentQueryService: null,
      logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    });

    await service.getSuggestions({ gridSize: 8 });

    expect(callsByStrategy).toEqual(['a', 'b']); // both strategies ran
    expect(underlyingCalls).toBe(1);             // but the show was fetched once
  });

  test('strategies never see season-0 extras or episodes under the minimum duration', async () => {
    // 2026-09-22: "Cardio Meltdown" (Morning Meltdown 100, Specials) led the
    // grid as Next Up. Season 0 is supplemental, and nothing under ten minutes
    // is a workout worth suggesting.
    let seen = null;
    const service = new FitnessSuggestionService({
      strategies: [{ suggest: async (ctx) => {
        seen = (await ctx.fitnessPlayableService.getPlayableEpisodes('10404')).items.map(ep => ep.id);
        return [];
      } }],
      sessionService: {
        listSessionsInRange: async () => [],
        resolveHouseholdId: (h) => h || 'default',
      },
      sessionDatastore: { findInRange: async () => [] },
      fitnessConfigService: {
        getSuggestionPolicy: () => ({ lookbackDays: 10, slots: 8, excludedCollectionIds: [], minimumDurationSeconds: 600 }),
      },
      fitnessPlayableService: {
        getPlayableEpisodes: async () => ({
          info: {},
          items: [
            { id: 'plex:600430', duration: 1170, metadata: { parentIndex: 0 } },
            { id: 'plex:intro', duration: 240, metadata: { parentIndex: 1 } },
            { id: 'plex:600436', duration: 1500, metadata: { parentIndex: 1 } },
            { id: 'plex:unknown-length', metadata: { parentIndex: 1 } },
          ],
        }),
        listFitnessShows: async () => ({ shows: [] }),
      },
      logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    });

    await service.getSuggestions({ gridSize: 8 });

    expect(seen).toEqual(['plex:600436', 'plex:unknown-length']);
  });

  test('never suggests shows in never_suggest collections, except to resume them', async () => {
    // The Kids menu collection (387010) is its own world: NextUp, Discovery,
    // Favorite and Memorable may not put one of its shows on the grid. Resume
    // may — it is the ride someone is partway through (Game Cycling, 603407),
    // and it belongs in the top-right slot.
    const service = new FitnessSuggestionService({
      strategies: [
        stubStrategy('resume', ['603407']),
        stubStrategy('next_up', ['599927', '600', '700']),
        stubStrategy('favorite', ['500', '603407', '599927']),
      ],
      sessionService: {
        listSessionsInRange: async () => [],
        resolveHouseholdId: (h) => h || 'default',
      },
      sessionDatastore: { findInRange: async () => [] },
      fitnessConfigService: {
        getSuggestionPolicy: () => ({
          lookbackDays: 10, slots: 8, excludedCollectionIds: [], neverSuggestCollectionIds: ['387010'],
        }),
      },
      fitnessPlayableService: { listFitnessShows: async () => ({ shows: [] }) },
      contentCatalog: {
        canonicalize: (value) => {
          const localId = String(value).replace(/^plex:/, '');
          return { source: 'plex', localId, contentId: `plex:${localId}` };
        },
        collectionShowIds: async (cid) => (cid === '387010' ? ['603407', '599927'] : []),
      },
      logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    });

    const { suggestions, overflow } = await service.getSuggestions({ gridSize: 8 });

    const shown = [...suggestions, ...overflow];
    expect(shown.map(c => c.showId).sort()).toEqual(['plex:500', 'plex:600', 'plex:603407', 'plex:700']);
    expect(shown.find(c => c.showId === 'plex:603407').type).toBe('resume');
    expect(suggestions[3]).toMatchObject({ type: 'resume', showId: 'plex:603407' });
  });
});
