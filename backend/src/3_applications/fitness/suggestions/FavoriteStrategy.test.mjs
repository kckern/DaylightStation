import { describe, expect, it } from 'vitest';
import { FavoriteStrategy } from './FavoriteStrategy.mjs';
import { presentPublicResources } from '#api/v1/presenters/publicResourceRefs.mjs';

const canonicalize = (id) => {
  const localId = String(id).replace(/^(?:plex:)+/, '');
  return { contentId: `plex:${localId}`, localId, source: 'plex' };
};

describe('FavoriteStrategy resource boundary', () => {
  it('keeps next-unwatched selection and projects the exact legacy URLs only at presentation', async () => {
    const strategy = new FavoriteStrategy();
    const cards = await strategy.suggest({
      suggestionPolicy: { favorites: ['9'] },
      contentCatalog: { canonicalize, describeItem: async () => ({ title: 'Show Nine' }) },
      fitnessPlayableService: { getPlayableEpisodes: async () => ({
        info: { labels: ['Favorite'] },
        items: [
          { id: 'plex:10', localId: '10', title: 'Done', isWatched: true, duration: 600, metadata: {} },
          { id: 'plex:11', localId: '11', title: 'Next', isWatched: false, duration: 900, metadata: {} },
        ],
      }) },
    }, 1);

    expect(cards[0]).toMatchObject({ contentId: 'plex:11', title: 'Next', showId: 'plex:9' });
    expect(cards[0].thumbnail).toEqual({ kind: 'display-image', source: 'plex', id: '11' });
    expect(presentPublicResources(cards)[0]).toMatchObject({
      thumbnail: '/api/v1/display/plex/11',
      poster: '/api/v1/content/plex/image/9',
    });
  });
});
