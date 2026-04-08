// tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs
import { MemorableStrategy, SufferScoreRanker } from '../../../../../backend/src/3_applications/fitness/suggestions/MemorableStrategy.mjs';

function makeSession(contentId, showId, showTitle, title, date, sufferScore) {
  return {
    sessionId: date.replace(/-/g, '') + '060000',
    date,
    startTime: new Date(date + 'T06:00:00Z').getTime(),
    media: {
      primary: {
        contentId: `plex:${contentId}`,
        grandparentId: `plex:${showId}`,
        showTitle,
        title,
      }
    },
    maxSufferScore: sufferScore,
    durationMs: 1800000,
  };
}

function makeContext(sessions, config = {}) {
  return {
    fitnessConfig: {
      suggestions: {
        memorable_lookback_days: 90,
        memorable_max: 2,
        ...config,
      },
    },
    sessionDatastore: {
      findInRange: async () => sessions,
    },
    householdId: 'test',
  };
}

describe('MemorableStrategy', () => {
  test('returns top sessions by suffer score', async () => {
    const sessions = [
      makeSession('1001', '100', 'Show A', 'Ep 3', '2026-03-12', 180),
      makeSession('2001', '200', 'Show B', 'Ep 7', '2026-03-15', 120),
      makeSession('3001', '300', 'Show C', 'Ep 1', '2026-03-20', 200),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions), 4);

    expect(result).toHaveLength(2);
    expect(result[0].metric.value).toBe(200);
    expect(result[1].metric.value).toBe(180);
    expect(result[0].type).toBe('memorable');
  });

  test('skips sessions without suffer score', async () => {
    const sessions = [
      makeSession('1001', '100', 'Show A', 'Ep 3', '2026-03-12', null),
      makeSession('2001', '200', 'Show B', 'Ep 7', '2026-03-15', 150),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions), 4);

    expect(result).toHaveLength(1);
    expect(result[0].metric.value).toBe(150);
  });

  test('returns empty when no sessions have scores', async () => {
    const sessions = [
      makeSession('1001', '100', 'Show A', 'Ep 3', '2026-03-12', null),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions), 4);
    expect(result).toEqual([]);
  });

  test('respects memorable_max config', async () => {
    const sessions = [
      makeSession('1001', '100', 'A', 'Ep 1', '2026-03-10', 200),
      makeSession('2001', '200', 'B', 'Ep 2', '2026-03-11', 180),
      makeSession('3001', '300', 'C', 'Ep 3', '2026-03-12', 160),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions, { memorable_max: 1 }), 4);
    expect(result).toHaveLength(1);
  });
});
