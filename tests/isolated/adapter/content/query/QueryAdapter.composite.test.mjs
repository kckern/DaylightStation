// tests/isolated/adapter/content/query/QueryAdapter.composite.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { QueryAdapter } from '#adapters/content/query/QueryAdapter.mjs';

describe('QueryAdapter composite queries', () => {
  describe('titlecard entries', () => {
    it('resolves a titlecard entry to a synthetic PlayableItem', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'welcome'
            ? {
                title: 'Welcome',
                items: [{
                  type: 'titlecard',
                  template: 'centered',
                  text: { title: 'Hello World', subtitle: 'Welcome home' },
                  duration: 8,
                }],
              }
            : null,
        },
      });

      const items = await adapter.resolvePlayables('query:welcome');
      expect(items).toHaveLength(1);

      const card = items[0];
      expect(card.id).toBe('titlecard:welcome:0');
      expect(card.source).toBe('titlecard');
      expect(card.mediaType).toBe('image');
      expect(card.duration).toBe(8);
      expect(card.metadata.contentFormat).toBe('titlecard');
      expect(card.titlecard.template).toBe('centered');
      expect(card.titlecard.text).toEqual({ title: 'Hello World', subtitle: 'Welcome home' });
    });

    it('resolves titlecard with slideshow effect config', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'fancy'
            ? {
                title: 'Fancy',
                items: [{
                  type: 'titlecard',
                  text: { title: 'Fancy Card' },
                  duration: 10,
                  effect: 'kenburns',
                  zoom: 1.3,
                  theme: 'dark',
                  css: 'color: red;',
                }],
              }
            : null,
        },
      });

      const items = await adapter.resolvePlayables('query:fancy');
      expect(items).toHaveLength(1);

      const card = items[0];
      expect(card.slideshow.duration).toBe(10);
      expect(card.slideshow.effect).toBe('kenburns');
      expect(card.slideshow.zoom).toBe(1.3);
      expect(card.titlecard.theme).toBe('dark');
      expect(card.titlecard.css).toBe('color: red;');
    });

    it('resolves titlecard image contentId to proxy URL', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'photo'
            ? {
                title: 'Photo Card',
                items: [{
                  type: 'titlecard',
                  text: { title: 'Memory' },
                  image: 'immich:abc-123-def',
                }],
              }
            : null,
        },
      });

      const items = await adapter.resolvePlayables('query:photo');
      expect(items).toHaveLength(1);
      expect(items[0].titlecard.imageUrl).toBe('/api/v1/proxy/immich/assets/abc-123-def/original');
    });

    it('uses defaults for missing titlecard fields', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'minimal'
            ? {
                title: 'Minimal',
                items: [{ type: 'titlecard' }],
              }
            : null,
        },
      });

      const items = await adapter.resolvePlayables('query:minimal');
      expect(items).toHaveLength(1);

      const card = items[0];
      expect(card.title).toBe('Title Card');
      expect(card.duration).toBe(5);
      expect(card.titlecard.template).toBe('centered');
      expect(card.titlecard.text).toEqual({});
      expect(card.titlecard).not.toHaveProperty('imageUrl');
      expect(card.titlecard).not.toHaveProperty('theme');
      expect(card.titlecard).not.toHaveProperty('css');
    });
  });

  describe('mixed items array', () => {
    it('concatenates titlecard and content items in order', async () => {
      // Create a mock immich adapter that returns known items
      const mockImmichAdapter = {
        search: vi.fn(async () => ({
          items: [
            {
              id: 'immich:photo1',
              title: '2020-06-15-photo.jpg',
              mediaType: 'image',
              metadata: { capturedAt: '2020-06-15T12:00:00Z' },
            },
          ],
        })),
      };

      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'memories'
            ? {
                title: 'Memories',
                items: [
                  {
                    type: 'titlecard',
                    text: { title: 'On This Day' },
                    duration: 5,
                  },
                  {
                    source: 'immich',
                    params: { mediaType: 'image', month: 6, day: 15, yearFrom: 2020 },
                  },
                ],
              }
            : null,
        },
        registry: {
          get: (name) => name === 'immich' ? mockImmichAdapter : null,
        },
      });

      const items = await adapter.resolvePlayables('query:memories');

      // First item should be the titlecard
      expect(items[0].id).toBe('titlecard:memories:0');
      expect(items[0].metadata.contentFormat).toBe('titlecard');

      // Remaining items are from immich
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items[1].id).toBe('immich:photo1');
    });

    it('attaches audio config after all items are resolved', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'withmusic'
            ? {
                title: 'With Music',
                audio: { src: '/music/track.mp3', volume: 0.5 },
                items: [
                  { type: 'titlecard', text: { title: 'Music Time' } },
                ],
              }
            : null,
        },
      });

      const items = await adapter.resolvePlayables('query:withmusic');
      expect(items).toHaveLength(1);
      expect(items.audio).toEqual({ src: '/music/track.mp3', volume: 0.5 });
    });
  });

  describe('recursive query references', () => {
    it('resolves named query references recursively', async () => {
      const queries = {
        main: {
          title: 'Main',
          items: [
            { type: 'titlecard', text: { title: 'Main Title' } },
            { query: 'sub' },
          ],
        },
        sub: {
          title: 'Sub',
          items: [
            { type: 'titlecard', text: { title: 'Sub Title' } },
          ],
        },
      };

      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => queries[name] || null,
        },
      });

      const items = await adapter.resolvePlayables('query:main');
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('titlecard:main:0');
      expect(items[0].titlecard.text.title).toBe('Main Title');
      expect(items[1].id).toBe('titlecard:sub:0');
      expect(items[1].titlecard.text.title).toBe('Sub Title');
    });

    it('handles missing sub-query gracefully', async () => {
      const adapter = new QueryAdapter({
        savedQueryService: {
          getQuery: (name) => name === 'parent'
            ? {
                title: 'Parent',
                items: [
                  { type: 'titlecard', text: { title: 'Intro' } },
                  { query: 'nonexistent' },
                ],
              }
            : null,
        },
      });

      const items = await adapter.resolvePlayables('query:parent');
      // Only the titlecard; the missing sub-query contributes nothing
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('titlecard:parent:0');
    });
  });
});
