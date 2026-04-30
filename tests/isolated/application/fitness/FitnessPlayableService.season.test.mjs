import { describe, test, expect, vi } from 'vitest';
import { FitnessPlayableService } from '#backend/src/3_applications/fitness/FitnessPlayableService.mjs';

/**
 * Tests for season-as-show label inheritance.
 * When the playable target is a Plex season (info.type='season'),
 * the service must fetch the parent show's metadata and copy its labels
 * onto the season's info so governance/resumable/sequential flags
 * propagate to the FitnessShow UI.
 */
describe('FitnessPlayableService - season label inheritance', () => {
  function buildDeps(overrides = {}) {
    return {
      fitnessConfigService: {
        loadRawConfig: vi.fn().mockReturnValue({ progressClassification: {} })
      },
      contentAdapter: {
        resolvePlayables: vi.fn().mockResolvedValue([]),
        getContainerInfo: vi.fn(),
        getItem: vi.fn().mockResolvedValue(null)
      },
      contentQueryService: null,
      createProgressClassifier: () => ({ classify: () => 'unknown' }),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
      ...overrides
    };
  }

  test('copies parent show labels onto season info', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          type: 'season',
          labels: [],                          // season has no labels of its own
          parentRatingKey: '603855',
          parentTitle: 'Super Blocks'
        };
      }
      if (id === 'plex:603855') {
        return {
          key: '603855',
          title: 'Super Blocks',
          type: 'show',
          labels: ['Strength', 'Sequential']   // labels live on the show
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.type).toBe('season');
    expect(result.info.labels).toEqual(['Strength', 'Sequential']);
    // Parent fetch should have happened
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledWith('plex:603855');
  });

  test('preserves the season own title and image (does not overwrite with show)', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          image: '/season-thumb',
          summary: 'Curated lift season',
          type: 'season',
          labels: [],
          parentRatingKey: '603855'
        };
      }
      if (id === 'plex:603855') {
        return {
          key: '603855',
          title: 'Super Blocks',
          image: '/show-thumb',
          summary: 'Whole show summary',
          type: 'show',
          labels: ['Strength']
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.title).toBe('LIIFT MORE Super Block');   // season title wins
    expect(result.info.image).toBe('/season-thumb');             // season image wins
    expect(result.info.summary).toBe('Curated lift season');     // season summary wins
    expect(result.info.labels).toEqual(['Strength']);            // labels inherited
  });

  test('falls back to empty labels when parent show fetch fails', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          type: 'season',
          labels: [],
          parentRatingKey: '603855'
        };
      }
      if (id === 'plex:603855') {
        throw new Error('Plex 503');
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.type).toBe('season');
    expect(result.info.labels).toEqual([]); // degraded — no labels, no exception
  });

  test('does not run inheritance for non-season info (existing show flow unchanged)', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603855') {
        return {
          key: '603855',
          title: 'Super Blocks',
          type: 'show',
          labels: ['Strength']
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    await svc.getPlayableEpisodes('603855');

    // Only one call — no parent lookup for shows
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledTimes(1);
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledWith('plex:603855');
  });

  test('skips inheritance when season has its own labels (do not double up)', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          type: 'season',
          labels: ['Lift'],                  // explicit labels on the season
          parentRatingKey: '603855'
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.labels).toEqual(['Lift']);
    // Parent fetch should NOT have happened
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledTimes(1);
  });
});
