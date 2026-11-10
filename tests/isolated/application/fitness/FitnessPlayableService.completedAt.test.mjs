// tests/isolated/application/fitness/FitnessPlayableService.completedAt.test.mjs
import { describe, test, expect, vi } from 'vitest';
import { FitnessPlayableService } from "../../../../__app_modules/wellness/fitness/server/application/FitnessPlayableService.mjs";
import { compileWatchCompletion } from "../../../../shared/contracts/media/watchCompletion.mjs";

function makeService({ items, completionRules } = {}) {
  const fakeAdapter = {
    canonicalize: (id) => ({ contentId: `plex:${String(id).replace(/^(?:plex:)+/, '')}`, localId: String(id).replace(/^(?:plex:)+/, '') }),
    resolvePlayables: vi.fn().mockResolvedValue(items),
    enrichWatchState: vi.fn(async (value) => value),
    getContainerInfo: vi.fn().mockResolvedValue(null),
    getItem: vi.fn().mockResolvedValue(null),
  };
  return new FitnessPlayableService({
    contentCatalog: fakeAdapter,
    completionRules,
    logger: { info: vi.fn(), warn: vi.fn() }
  });
}

// The documented household block, compiled by the real rule compiler.
const { ruleFor } = compileWatchCompletion({
  default: { min_percent: 90 },
  libraries: {
    'plex/14_fitness': {
      min_watch_sec: 30,
      tiers: [{ max_duration_sec: 2700, min_percent: 50 }, { min_percent: 95, max_remaining_sec: 300 }],
    },
  },
});
const FITNESS_RULES = { ruleFor };

describe('FitnessPlayableService treats completedAt as ever-completed', () => {
  test('isWatched = true when completedAt is set, even if percent low', async () => {
    const svc = makeService({
      items: [{
        id: 'plex:674498',
        playhead: 40,
        percent: 6,
        duration: 678,
        watchTime: 705,
        completedAt: '2026-04-20 06:07:44',
        metadata: { viewCount: 0 }
      }],
    });
    const result = await svc.getPlayableEpisodes('674496');
    expect(result.items[0].isWatched).toBe(true);
  });

  test('isWatched = false when completedAt is null and progress is low', async () => {
    const svc = makeService({
      items: [{
        id: 'plex:100',
        playhead: 40,
        percent: 6,
        duration: 678,
        watchTime: 40,
        completedAt: null,
        metadata: { viewCount: 0 }
      }],
    });
    const result = await svc.getPlayableEpisodes('99');
    expect(result.items[0].isWatched).toBe(false);
  });
});

describe('FitnessPlayableService judges watched by the item library rule', () => {
  test('Sonic: 94% of a 4h51m fitness longplay is not watched', async () => {
    const svc = makeService({ completionRules: FITNESS_RULES, items: [{
      id: 'plex:674290', playhead: 16429, percent: 94, duration: 17459, watchTime: 19111,
      completedAt: null, progressNamespace: 'plex/14_fitness', metadata: { viewCount: 0 } }] });
    expect((await svc.getPlayableEpisodes('603407')).items[0].isWatched).toBe(false);
  });

  test('a 30-min fitness workout at 60% is watched (short tier)', async () => {
    const svc = makeService({ completionRules: FITNESS_RULES, items: [{
      id: 'plex:1', playhead: 1080, percent: 60, duration: 1800, watchTime: 1080,
      completedAt: null, progressNamespace: 'plex/14_fitness', metadata: { viewCount: 0 } }] });
    expect((await svc.getPlayableEpisodes('2')).items[0].isWatched).toBe(true);
  });

  test('a lecture at 60% is not watched (default rule for its library)', async () => {
    const svc = makeService({ completionRules: FITNESS_RULES, items: [{
      id: 'plex:3', playhead: 1080, percent: 60, duration: 1800, watchTime: 1080,
      completedAt: null, progressNamespace: 'plex/17_lectures', metadata: { viewCount: 0 } }] });
    expect((await svc.getPlayableEpisodes('4')).items[0].isWatched).toBe(false);
  });

  test('no rules injected: default 90%', async () => {
    const svc = makeService({ items: [{
      id: 'plex:5', playhead: 1700, percent: 94, duration: 1800, watchTime: 1700,
      completedAt: null, metadata: { viewCount: 0 } }] });
    expect((await svc.getPlayableEpisodes('6')).items[0].isWatched).toBe(true);
  });

  test('an unplayed item is never watched, even at a stored percent', async () => {
    const svc = makeService({ completionRules: FITNESS_RULES, items: [{
      id: 'plex:7', playhead: 0, percent: 95, duration: 1800,
      completedAt: null, progressNamespace: 'plex/14_fitness', metadata: { viewCount: 0 } }] });
    expect((await svc.getPlayableEpisodes('8')).items[0].isWatched).toBe(false);
  });
});
