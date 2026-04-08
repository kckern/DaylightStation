// tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs
import { ResumeStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs';

function makeSession(showId, showTitle, contentId, episodeTitle, date) {
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
  };
}

function makeEpisode(id, index, { isWatched = false, percent = 0, playhead = 0, duration = 3600, labels = [] } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration,
    isWatched,
    watchProgress: percent,
    watchSeconds: playhead,
    resumable: labels.includes('Resumable'),
    metadata: {
      type: 'episode',
      grandparentId: 'plex:100',
      grandparentTitle: 'Test Show',
      itemIndex: index,
      labels,
    },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeContext(sessions, playablesByShow = {}, config = {}) {
  return {
    recentSessions: sessions,
    fitnessConfig: {
      suggestions: config,
      plex: { resumable_labels: ['Resumable'] },
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (showId) => ({
        items: playablesByShow[showId] || [],
        parents: null,
        info: null,
      }),
    },
  };
}

describe('ResumeStrategy', () => {
  const strategy = new ResumeStrategy();

  test('returns empty when no sessions', async () => {
    const result = await strategy.suggest(makeContext([]), 4);
    expect(result).toEqual([]);
  });

  test('finds in-progress episode on resumable show', async () => {
    const sessions = [makeSession('100', 'VG Cycling', '1001', 'Ep 14', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 14, { percent: 55, playhead: 1980, duration: 3600, labels: ['Resumable'] }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('resume');
    expect(result[0].action).toBe('play');
    expect(result[0].progress.percent).toBe(55);
  });

  test('skips non-resumable shows', async () => {
    const sessions = [makeSession('100', 'Regular Show', '1001', 'Ep 5', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 5, { percent: 40, playhead: 720, duration: 1800, labels: [] }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('skips fully watched episodes', async () => {
    const sessions = [makeSession('100', 'VG Cycling', '1001', 'Ep 14', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 14, { isWatched: true, percent: 100, playhead: 3600, duration: 3600, labels: ['Resumable'] }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });
});
