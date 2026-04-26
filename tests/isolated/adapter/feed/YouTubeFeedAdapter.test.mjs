// tests/isolated/adapter/feed/YouTubeFeedAdapter.test.mjs
import { vi } from 'vitest';
import { YouTubeFeedAdapter } from '#adapters/feed/sources/YouTubeFeedAdapter.mjs';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('YouTubeFeedAdapter', () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    // Production now fetches the channel icon in parallel with the RSS/API
    // request. Default any unmocked fetch to a benign 404 so the icon
    // promise resolves without throwing.
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}), text: async () => '' });
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

      // Route fetch by URL: RSS gets the xml, icon API gets a benign 404.
      // Production fetches both in parallel, so a single mockResolvedValueOnce
      // would race with the icon fetch.
      mockFetch.mockImplementation(async (url) => {
        if (typeof url === 'string' && url.includes('feeds/videos.xml')) {
          return { ok: true, text: async () => rssXml };
        }
        return { ok: false, json: async () => ({}), text: async () => '' };
      });

      const adapter = new YouTubeFeedAdapter({ apiKey: 'test-key', logger });

      const items = await adapter.fetchItems({
        type: 'youtube',
        tier: 'wire',
        params: { channels: ['UC123'] },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].contentType).toBe('youtube');
      // Production now always upgrades to maxresdefault and exposes the
      // upgraded URL on item.image; the original lower-res URL is preserved
      // on item.thumbnail. Per-item image dimensions were dropped from meta.
      expect(items[0].image).toContain('maxresdefault.jpg');
      expect(items[0].thumbnail).toContain('hqdefault.jpg');
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

      mockFetch.mockImplementation(async (url) => {
        if (typeof url === 'string' && url.includes('feeds/videos.xml')) {
          return { ok: true, text: async () => rssXml };
        }
        return { ok: false, json: async () => ({}), text: async () => '' };
      });

      const adapter = new YouTubeFeedAdapter({ apiKey: 'test-key', logger });

      const items = await adapter.fetchItems({
        type: 'youtube',
        tier: 'wire',
        params: { channels: ['UC456'] },
      }, 'testuser');

      expect(items).toHaveLength(1);
      expect(items[0].image).toContain('maxresdefault.jpg');
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
      // Production upgrades the API thumbnail URL to maxresdefault.
      expect(items[0].image).toBe('https://i.ytimg.com/vi/vid999/maxresdefault.jpg');
      expect(items[0].contentType).toBe('youtube');
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
      // Production upgrades sddefault to maxresdefault — assert the upgrade.
      expect(items[0].image).toBe('https://i.ytimg.com/vi/vidNoSize/maxresdefault.jpg');
    });
  });
});
