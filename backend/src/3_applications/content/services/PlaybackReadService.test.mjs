// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PlaybackReadService } from './PlaybackReadService.mjs';
import { ItemSelectionService } from '../../../2_domains/content/services/ItemSelectionService.mjs';

/**
 * PLAYING A CONTAINER NEVER REFUSES IT.
 *
 * 2026-09-14: `GET /api/v1/play/plex:696233` — a Plex season whose three episodes
 * were all finished — answered 404 "No playable items in container". The season
 * and its episodes were fine; the selection strategy drops watched items, and with
 * nothing left the play path had no fallback. The real ItemSelectionService runs
 * here, so the test fails if either the strategy or the fallback stops doing its job.
 */
const episode = (n, percent) => ({
  id: `plex:69623${3 + n}`,
  title: `Episode ${n}`,
  mediaUrl: `/api/v1/proxy/plex/stream/69623${3 + n}`,
  duration: 1800,
  percent,
});

function serviceOver(episodes) {
  const contentQueryService = {
    // Mirrors ContentQueryService.resolve: the real one supplies `random` to
    // every selection, which a random pick requires.
    resolve: async (_source, _localId, context, overrides) => ({
      items: ItemSelectionService.select(
        episodes,
        { ...context, containerType: 'watchlist' },
        { ...overrides, random: Math.random },
      ),
    }),
  };
  const contentCatalog = {
    getItem: async () => ({ id: 'plex:696233', title: 'Études', itemType: 'container' }),
    progressNamespace: async () => 'plex',
    describeItem: () => ({}),
  };
  const playResponseService = {
    getWatchState: async () => null,
    toPlayResponse: (item) => ({ id: item.id }),
  };
  return new PlaybackReadService({
    contentIdResolver: { resolve: () => ({ source: 'plex', localId: '696233' }) },
    contentCatalog,
    contentQueryService,
    playResponseService,
    now: () => new Date('2026-09-14T12:00:00Z'),
  });
}

describe('PlaybackReadService — playing a container', () => {
  it('plays a season whose every episode is finished instead of answering empty', async () => {
    const result = await serviceOver([episode(1, 100), episode(2, 100), episode(3, 100)])
      .resolve({ compoundId: 'plex:696233' });
    expect(result.kind).toBe('found');
    expect(result.body.id).toBe('plex:696234');
  });

  it('still skips finished episodes while an unfinished one remains', async () => {
    const result = await serviceOver([episode(1, 100), episode(2, 40), episode(3, 0)])
      .resolve({ compoundId: 'plex:696233' });
    expect(result.kind).toBe('found');
    expect(result.body.id).toBe('plex:696235');
  });

  it('shuffle over a finished season also plays rather than refusing', async () => {
    const result = await serviceOver([episode(1, 100), episode(2, 100)])
      .resolve({ compoundId: 'plex:696233', shuffle: true });
    expect(result.kind).toBe('found');
  });
});
