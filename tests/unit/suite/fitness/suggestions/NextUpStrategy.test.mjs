import { NextUpStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs';

// --- Factories ---

function makeSession(showId, showTitle, contentId, episodeTitle, date, overrides = {}) {
  return {
    sessionId: date.replace(/-/g, '') + '060000',
    date,
    startTime: new Date(date + 'T06:00:00Z').getTime(),
    media: {
      primary: {
        grandparentId: `plex:${showId}`,
        contentId: `plex:${contentId}`,
        showTitle,
        title: episodeTitle,
      }
    },
    ...overrides
  };
}

function makeEpisode(id, index, { isWatched = false, percent = 0, playhead = 0, duration = 1800 } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration,
    isWatched,
    watchProgress: percent,
    watchSeconds: playhead,
    metadata: {
      type: 'episode',
      grandparentId: 'plex:100',
      grandparentTitle: 'Test Show',
      itemIndex: index,
    },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeContext(sessions, playablesByShow = {}, config = {}, labelsByShow = {}, excludedShowIds = null) {
  return {
    recentSessions: sessions,
    fitnessConfig: {
      suggestions: { next_up_max: 4, ...config },
      plex: {
        resumable_labels: ['Resumable'],
        deprioritized_labels: ['KidsFun'],
      },
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (showId) => {
        const items = playablesByShow[showId] || [];
        const labels = labelsByShow[showId] || [];
        return { items, parents: null, info: { labels } };
      }
    },
    excludedShowIds: excludedShowIds instanceof Set ? excludedShowIds : new Set(excludedShowIds || []),
  };
}

// --- Tests ---

describe('NextUpStrategy', () => {
  const strategy = new NextUpStrategy();

  test('returns empty when no sessions', async () => {
    const ctx = makeContext([]);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('returns next unwatched episode for a recent show', async () => {
    const sessions = [makeSession('100', 'Dig Deeper', '1001', 'Ep 7', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 7, { isWatched: true }),
        makeEpisode(1002, 8, { isWatched: false }),
        makeEpisode(1003, 9, { isWatched: false }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('next_up');
    expect(result[0].contentId).toBe('plex:1002');
    expect(result[0].showTitle).toBe('Dig Deeper');
    expect(result[0].action).toBe('play');
  });

  test('skips shows where all episodes are watched', async () => {
    const sessions = [makeSession('100', 'Done Show', '1001', 'Ep 1', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: true }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('respects max slots and next_up_max', async () => {
    const sessions = [
      makeSession('100', 'Show A', '1001', 'Ep 1', '2026-04-06'),
      makeSession('200', 'Show B', '2001', 'Ep 1', '2026-04-05'),
      makeSession('300', 'Show C', '3001', 'Ep 1', '2026-04-04'),
      makeSession('400', 'Show D', '4001', 'Ep 1', '2026-04-03'),
      makeSession('500', 'Show E', '5001', 'Ep 1', '2026-04-02'),
    ];
    const playables = {};
    for (const s of sessions) {
      const showId = s.media.primary.grandparentId.replace('plex:', '');
      playables[showId] = [
        makeEpisode(parseInt(showId) * 10 + 1, 1, { isWatched: true }),
        makeEpisode(parseInt(showId) * 10 + 2, 2, { isWatched: false }),
      ];
    }
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(4);
  });

  test('deduplicates by show — only one card per show', async () => {
    const sessions = [
      makeSession('100', 'Same Show', '1001', 'Ep 7', '2026-04-06'),
      makeSession('100', 'Same Show', '1002', 'Ep 8', '2026-04-05'),
    ];
    const playables = {
      '100': [
        makeEpisode(1001, 7, { isWatched: true }),
        makeEpisode(1002, 8, { isWatched: true }),
        makeEpisode(1003, 9, { isWatched: false }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(1);
  });

  test('sorts by most recently done show first', async () => {
    const sessions = [
      makeSession('200', 'Show B', '2001', 'Ep 1', '2026-04-06'),
      makeSession('100', 'Show A', '1001', 'Ep 1', '2026-04-08'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
      '200': [makeEpisode(2001, 1, { isWatched: true }), makeEpisode(2002, 2)],
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result[0].showTitle).toBe('Show A');
    expect(result[1].showTitle).toBe('Show B');
  });

  test('returns all candidates when remainingSlots exceeds next_up_max', async () => {
    const sessions = [
      makeSession('100', 'Show A', '1001', 'Ep 1', '2026-04-06'),
      makeSession('200', 'Show B', '2001', 'Ep 1', '2026-04-05'),
      makeSession('300', 'Show C', '3001', 'Ep 1', '2026-04-04'),
      makeSession('400', 'Show D', '4001', 'Ep 1', '2026-04-03'),
      makeSession('500', 'Show E', '5001', 'Ep 1', '2026-04-02'),
      makeSession('600', 'Show F', '6001', 'Ep 1', '2026-04-01'),
    ];
    const playables = {};
    for (const s of sessions) {
      const showId = s.media.primary.grandparentId.replace('plex:', '');
      playables[showId] = [
        makeEpisode(parseInt(showId) * 10 + 1, 1, { isWatched: true }),
        makeEpisode(parseInt(showId) * 10 + 2, 2, { isWatched: false }),
      ];
    }
    // Create context with default next_up_max of 4
    const ctx = makeContext(sessions, playables);
    // Request 8 remaining slots — should return all 6 shows since strategy no longer caps internally
    const result = await strategy.suggest(ctx, 8);
    expect(result).toHaveLength(6);
    expect(result.map(r => r.showTitle)).toEqual([
      'Show A', 'Show B', 'Show C', 'Show D', 'Show E', 'Show F'
    ]);
  });

  test('filters out shows whose next-up has a deprioritized label', async () => {
    // Would You Rather Workout style — kidsfun only, no resumable progress.
    const sessions = [
      makeSession('100', 'PE Bowman', '1001', 'Ep 1', '2026-04-06'),
    ];
    const playables = {
      '100': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: false }),
      ],
    };
    const labels = { '100': ['kidsfun'] };
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('keeps deprioritized shows that ALSO have a resumable label', async () => {
    // Daytona USA style — kidsfun + resumable; the resumable tag wins.
    const sessions = [
      makeSession('100', 'Game Cycling', '1001', 'Ep 1', '2026-04-06'),
    ];
    const playables = {
      '100': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: false }),
      ],
    };
    const labels = { '100': ['kidsfun', 'resumable', 'sequential'] };
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(1);
    expect(result[0].contentId).toBe('plex:1002');
    expect(result[0].labels).toEqual(['kidsfun', 'resumable', 'sequential']);
  });

  test('regular (non-deprioritized) shows are unaffected by the filter', async () => {
    const sessions = [
      makeSession('100', 'P90X Generation Next', '1001', 'Ep 1', '2026-04-06'),
      makeSession('200', 'Body by Yoga', '2001', 'Ep 1', '2026-04-05'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
      '200': [makeEpisode(2001, 1, { isWatched: true }), makeEpisode(2002, 2)],
    };
    const labels = { '100': [], '200': ['nomusic'] };
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.showTitle)).toEqual(['P90X Generation Next', 'Body by Yoga']);
  });

  test('deprioritized label matching is case-insensitive', async () => {
    // Config: 'KidsFun' (CamelCase). Session/API: 'kidsfun' (lowercase).
    const sessions = [
      makeSession('100', 'PE Bowman', '1001', 'Ep 1', '2026-04-06'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
    };
    const labels = { '100': ['KIDSFUN'] }; // upper-case from a hypothetical source
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('excludedShowIds filters out shows in excluded collections/playlists', async () => {
    // Shows 100 and 200 both have recent sessions, but 100 is in an excluded
    // collection (e.g. the "Stretch" playlist). Only 200 should surface.
    const sessions = [
      makeSession('100', 'LIIFT4 Stretch', '1001', 'Ep 1', '2026-04-06'),
      makeSession('200', 'Shoulders & Arms', '2001', 'Ep 1', '2026-04-05'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
      '200': [makeEpisode(2001, 1, { isWatched: true }), makeEpisode(2002, 2)],
    };
    const excluded = new Set(['100']);
    const ctx = makeContext(sessions, playables, {}, {}, excluded);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(1);
    expect(result[0].showTitle).toBe('Shoulders & Arms');
  });

  test('excludedShowIds matches both bare and plex:-prefixed grandparent ids', async () => {
    // grandparentId in session YAML is `plex:100`; exclude set stores bare ids.
    const sessions = [makeSession('100', 'Stretch Show', '1001', 'Ep 1', '2026-04-06')];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
    };
    const excluded = new Set(['100']);
    const ctx = makeContext(sessions, playables, {}, {}, excluded);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('empty excludedShowIds is a no-op', async () => {
    const sessions = [makeSession('100', 'Shoulders', '1001', 'Ep 1', '2026-04-06')];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
    };
    const ctx = makeContext(sessions, playables, {}, {}, new Set());
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(1);
  });
});
