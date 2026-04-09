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
      loadRawConfig: () => ({
        suggestions: { lookback_days: 10, grid_size: 8 },
      }),
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
});
