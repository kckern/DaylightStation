/**
 * Test for parents piano enrichment: verifies that each season's
 * curriculum category block is flowed into the parents map.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetPlayableUnits } from '../../../../backend/src/3_applications/piano/usecases/GetPlayableUnits.mjs';

// Mock the CurriculumIndex module before importing GetPlayableUnits
vi.mock('../../../../backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs', () => {
  return {
    getCurriculumIndex: vi.fn((showId) => {
      // Return a minimal curriculum index for show '676490' with season 10 as 'repertoire'
      if (showId === '676490') {
        return {
          show: 676490,
          seasons: {
            '10': {
              title: 'Song Tutorials',
              lane: 'repertoire',
              facets: ['difficulty', 'instructor', 'style'],
            },
          },
        };
      }
      return null;
    }),
    mergeSeason: vi.fn((index, season) => {
      if (!index || !index.seasons) return null;
      const s = index.seasons[String(season)];
      if (!s) return null;
      return {
        title: s.title ?? undefined,
        piano: {
          lane: s.lane,
          groups: s.groups,
          facets: s.facets,
          sequential: s.sequential,
          pinned: s.pinned,
        },
      };
    }),
    _resetCacheForTests: vi.fn(),
  };
});

const noop = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

const configService = {
  getHouseholdAppConfig: () => ({ videos: {} }),
  getUserProfile: (id) => (id === 'guest' ? null : { name: id }),
};

const makePlayable = () => ({
  compoundId: 'plex:676490',
  info: { labels: [] },
  parents: {
    '677395': { index: 10, title: 'Song Tutorials' },
  },
  items: [],
});

const fitnessPlayableService = {
  async getPlayableEpisodes() {
    return makePlayable();
  },
};

const makeUseCase = () => new GetPlayableUnits({
  fitnessPlayableService,
  userVideoProgressStore: null,
  configService,
  logger: noop,
});

describe('GetPlayableUnits (parents piano enrichment)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enriches parents map with season piano.lane from curriculum index', async () => {
    const { ok, result } = await makeUseCase().execute({ courseId: '676490' });

    expect(ok).toBe(true);
    expect(result.parents['677395']).toBeDefined();
    expect(result.parents['677395'].piano).toBeDefined();
    expect(result.parents['677395'].piano.lane).toBe('repertoire');
  });

  it('preserves other parent fields when enriching with piano', async () => {
    const { ok, result } = await makeUseCase().execute({ courseId: '676490' });

    expect(ok).toBe(true);
    expect(result.parents['677395'].index).toBe(10);
    expect(result.parents['677395'].title).toBe('Song Tutorials');
    expect(result.parents['677395'].piano.lane).toBe('repertoire');
  });

  it('handles missing curriculum index gracefully (no enrichment)', async () => {
    // courseId '999999' has no curriculum index, so parents should remain unchanged
    const { ok, result } = await makeUseCase().execute({ courseId: '999999' });

    expect(ok).toBe(true);
    expect(result.parents['677395']).toBeDefined();
    expect(result.parents['677395'].piano).toBeUndefined();
  });

  it('handles null parents gracefully', async () => {
    const useCase = new GetPlayableUnits({
      fitnessPlayableService: {
        async getPlayableEpisodes() {
          return { compoundId: 'plex:676490', info: {}, parents: null, items: [] };
        },
      },
      userVideoProgressStore: null,
      configService,
      logger: noop,
    });

    const { ok } = await useCase.execute({ courseId: '676490' });
    expect(ok).toBe(true);
  });
});
