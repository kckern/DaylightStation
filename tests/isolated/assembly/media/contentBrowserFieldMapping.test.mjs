import { describe, it, expect } from 'vitest';
import { resolveContentId } from '../../../../frontend/src/modules/Media/ContentBrowser.jsx';

describe('ContentBrowser field mapping', () => {
  function mapSearchResultToQueueItem(item) {
    return {
      contentId: resolveContentId(item),
      title: item.title,
      format: item.format || null,
      thumbnail: item.thumbnail || null,
    };
  }

  it('maps item.id to contentId when contentId is missing', () => {
    const searchResult = { id: 'plex:653701', title: 'Star Wars', format: 'movie', thumbnail: '/thumb.jpg' };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.contentId).toBe('plex:653701');
  });

  it('falls back to item.contentId when item.id is missing', () => {
    const searchResult = { contentId: 'plex:999', title: 'Fallback', format: null };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.contentId).toBe('plex:999');
  });

  it('prefers item.id over item.contentId', () => {
    const searchResult = { id: 'plex:123', contentId: 'plex:456', title: 'Both' };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.contentId).toBe('plex:123');
  });

  it('passes through thumbnail URL', () => {
    const searchResult = { id: 'plex:1', title: 'T', thumbnail: '/api/v1/proxy/immich/assets/abc/thumbnail' };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.thumbnail).toBe('/api/v1/proxy/immich/assets/abc/thumbnail');
  });

  it('returns undefined when both id and contentId are missing', () => {
    const searchResult = { title: 'No ID' };
    expect(resolveContentId(searchResult)).toBeUndefined();
  });
});
