// tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { YouTubeFeedAdapter } from '#adapters/feed/sources/YouTubeFeedAdapter.mjs';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('YouTubeFeedAdapter', () => {
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('RSS path thumbnail dimensions', () => {
    test('includes 480x360 dimensions for hqdefault thumbnail', async () => {
      const rssXml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Test Video</title>
    <published>2026-01-01T00:00:00Z</published>
    <name>Test Channel</name>
    <yt:channelId>UC123</yt:channelId>
    <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" />
    <media:description>A test video</media:description>
  </entry>
</feed>`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => rssXml,
      });

      const adapter = new YouTubeFeedAdapter({ apiKey: 'test-key', logger });

      const items = await adapter.fetchItems({
        type: 'youtube',
        tier: 'wire',
        params: { channels: ['UC123'] },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].meta.imageWidth).toBe(480);
      expect(items[0].meta.imageHeight).toBe(360);
    });

    test('includes 1280x720 dimensions for maxresdefault thumbnail', async () => {
      const rssXml = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>HD Video</title>
    <published>2026-01-01T00:00:00Z</published>
    <name>HD Channel</name>
    <yt:channelId>UC456</yt:channelId>
    <media:thumbnail url="https://i.ytimg.com/vi/abc123/maxresdefault.jpg" />
    <media:description>An HD video</media:description>
  </entry>
</feed>`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => rssXml,
      });

      const adapter = new YouTubeFeedAdapter({ apiKey: 'test-key', logger });

      const items = await adapter.fetchItems({
        type: 'youtube',
        tier: 'wire',
        params: { channels: ['UC456'] },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].meta.imageWidth).toBe(1280);
      expect(items[0].meta.imageHeight).toBe(720);
    });
  });

  describe('API path thumbnail dimensions', () => {
    test('includes correct dimensions from snippet.thumbnails', async () => {
      const apiResponse = {
        items: [{
          id: { videoId: 'vid999' },
          snippet: {
            title: 'API Video',
            description: 'An API test video',
            channelTitle: 'API Channel',
            channelId: 'UCapi',
            publishedAt: '2026-01-15T12:00:00Z',
            thumbnails: {
              high: { url: 'https://i.ytimg.com/vi/vid999/hqdefault.jpg', width: 480, height: 360 },
              medium: { url: 'https://i.ytimg.com/vi/vid999/mqdefault.jpg', width: 320, height: 180 },
              default: { url: 'https://i.ytimg.com/vi/vid999/default.jpg', width: 120, height: 90 },
            },
          },
        }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => apiResponse,
      });

      const adapter = new YouTubeFeedAdapter({ apiKey: 'test-key', logger });

      const items = await adapter.fetchItems({
        type: 'youtube',
        tier: 'wire',
        params: { keywords: ['test'] },
      }, 'testuser');

      expect(items).toHaveLength(1);
      // The image should be the high thumbnail URL
      expect(items[0].image).toBe('https://i.ytimg.com/vi/vid999/hqdefault.jpg');
      // Dimensions should come from the API snippet thumbnails (high matches the image)
      expect(items[0].meta.imageWidth).toBe(480);
      expect(items[0].meta.imageHeight).toBe(360);
    });

    test('falls back to URL-based dimensions when API thumbnails lack width/height', async () => {
      const apiResponse = {
        items: [{
          id: { videoId: 'vidNoSize' },
          snippet: {
            title: 'No Size Video',
            description: 'Video without thumbnail dimensions',
            channelTitle: 'Some Channel',
            channelId: 'UCnosize',
            publishedAt: '2026-01-20T08:00:00Z',
            thumbnails: {
              high: { url: 'https://i.ytimg.com/vi/vidNoSize/sddefault.jpg' },
              medium: { url: 'https://i.ytimg.com/vi/vidNoSize/mqdefault.jpg' },
            },
          },
        }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => apiResponse,
      });

      const adapter = new YouTubeFeedAdapter({ apiKey: 'test-key', logger });

      const items = await adapter.fetchItems({
        type: 'youtube',
        tier: 'wire',
        params: { keywords: ['fallback'] },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].image).toBe('https://i.ytimg.com/vi/vidNoSize/sddefault.jpg');
      // Falls back to URL-based dimensions for sddefault
      expect(items[0].meta.imageWidth).toBe(640);
      expect(items[0].meta.imageHeight).toBe(480);
    });
  });
});
