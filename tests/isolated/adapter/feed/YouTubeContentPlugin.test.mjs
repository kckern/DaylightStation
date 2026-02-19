// tests/isolated/adapter/feed/YouTubeContentPlugin.test.mjs
import { YouTubeContentPlugin } from '#adapters/feed/plugins/youtube.mjs';

describe('YouTubeContentPlugin', () => {
  const plugin = new YouTubeContentPlugin();

  test('contentType is youtube', () => {
    expect(plugin.contentType).toBe('youtube');
  });

  describe('detect()', () => {
    test('matches youtube.com/watch?v= links', () => {
      expect(plugin.detect({ link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBe(true);
    });

    test('matches youtu.be short links', () => {
      expect(plugin.detect({ link: 'https://youtu.be/dQw4w9WgXcQ' })).toBe(true);
    });

    test('matches youtube.com/embed/ links', () => {
      expect(plugin.detect({ link: 'https://www.youtube.com/embed/dQw4w9WgXcQ' })).toBe(true);
    });

    test('matches youtube.com/shorts/ links', () => {
      expect(plugin.detect({ link: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' })).toBe(true);
    });

    test('does not match non-youtube links', () => {
      expect(plugin.detect({ link: 'https://example.com/article' })).toBe(false);
    });

    test('does not match null/missing link', () => {
      expect(plugin.detect({ link: null })).toBe(false);
      expect(plugin.detect({})).toBe(false);
    });
  });

  describe('enrich()', () => {
    test('extracts videoId from youtube.com/watch?v=', () => {
      const result = plugin.enrich({ link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', meta: {} });
      expect(result.contentType).toBe('youtube');
      expect(result.meta.videoId).toBe('dQw4w9WgXcQ');
      expect(result.meta.playable).toBe(true);
      expect(result.meta.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1');
    });

    test('extracts videoId from youtu.be/', () => {
      const result = plugin.enrich({ link: 'https://youtu.be/abc123_-xyz', meta: {} });
      expect(result.meta.videoId).toBe('abc123_-xyz');
    });

    test('extracts videoId from /embed/', () => {
      const result = plugin.enrich({ link: 'https://www.youtube.com/embed/abc123_defg', meta: {} });
      expect(result.meta.videoId).toBe('abc123_defg');
    });

    test('extracts videoId from /shorts/', () => {
      const result = plugin.enrich({ link: 'https://www.youtube.com/shorts/abc123_defg', meta: {} });
      expect(result.meta.videoId).toBe('abc123_defg');
    });

    test('sets thumbnail image when item has no image', () => {
      const result = plugin.enrich({ link: 'https://youtube.com/watch?v=abc', image: null, meta: {} });
      expect(result.image).toBe('https://img.youtube.com/vi/abc/hqdefault.jpg');
      expect(result.meta.imageWidth).toBe(480);
      expect(result.meta.imageHeight).toBe(360);
    });

    test('does not overwrite existing image', () => {
      const result = plugin.enrich({ link: 'https://youtube.com/watch?v=abc', image: 'https://existing.jpg', meta: {} });
      expect(result.image).toBeUndefined(); // no image key in enrichment
    });

    test('returns empty enrichment when videoId cannot be extracted', () => {
      const result = plugin.enrich({ link: 'https://youtube.com/channel/UC123', meta: {} });
      expect(result).toEqual({});
    });
  });
});
