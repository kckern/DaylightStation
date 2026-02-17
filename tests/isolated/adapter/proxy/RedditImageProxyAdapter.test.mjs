// tests/isolated/adapter/proxy/RedditImageProxyAdapter.test.mjs
import { RedditImageProxyAdapter } from '#adapters/proxy/RedditImageProxyAdapter.mjs';

describe('RedditImageProxyAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new RedditImageProxyAdapter({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
  });

  describe('getServiceName', () => {
    test('returns reddit', () => {
      expect(adapter.getServiceName()).toBe('reddit');
    });
  });

  describe('isConfigured', () => {
    test('always returns true (no config needed)', () => {
      expect(adapter.isConfigured()).toBe(true);
    });
  });

  describe('getAuthHeaders', () => {
    test('returns User-Agent to bypass hotlink blocking', () => {
      const headers = adapter.getAuthHeaders();
      expect(headers['User-Agent']).toBeDefined();
      expect(headers['Accept']).toBe('image/*');
    });
  });

  describe('getAuthParams', () => {
    test('returns null (no query auth needed)', () => {
      expect(adapter.getAuthParams()).toBeNull();
    });
  });

  describe('transformPath', () => {
    test('reconstructs i.redd.it URL', () => {
      expect(adapter.transformPath('/i.redd.it/abc123.jpg'))
        .toBe('https://i.redd.it/abc123.jpg');
    });

    test('reconstructs preview.redd.it URL with query params', () => {
      expect(adapter.transformPath('/preview.redd.it/img.jpg?width=640&crop=smart'))
        .toBe('https://preview.redd.it/img.jpg?width=640&crop=smart');
    });

    test('reconstructs external-preview.redd.it URL', () => {
      expect(adapter.transformPath('/external-preview.redd.it/some-image.png'))
        .toBe('https://external-preview.redd.it/some-image.png');
    });

    test('reconstructs img.youtube.com URL', () => {
      expect(adapter.transformPath('/img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'))
        .toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    });

    test('reconstructs i.ytimg.com URL', () => {
      expect(adapter.transformPath('/i.ytimg.com/vi/abc123/maxresdefault.jpg'))
        .toBe('https://i.ytimg.com/vi/abc123/maxresdefault.jpg');
    });

    test('reconstructs i.imgur.com URL', () => {
      expect(adapter.transformPath('/i.imgur.com/xyz789.gif'))
        .toBe('https://i.imgur.com/xyz789.gif');
    });

    test('rejects disallowed hosts', () => {
      expect(() => adapter.transformPath('/evil.example.com/malware.exe'))
        .toThrow('Domain not allowed: evil.example.com');
    });

    test('rejects non-image reddit domains', () => {
      expect(() => adapter.transformPath('/www.reddit.com/r/pics'))
        .toThrow('Domain not allowed: www.reddit.com');
    });
  });

  describe('getRetryConfig', () => {
    test('returns 1 retry with 300ms delay', () => {
      expect(adapter.getRetryConfig()).toEqual({ maxRetries: 1, delayMs: 300 });
    });
  });

  describe('shouldRetry', () => {
    test('retries on 5xx server errors', () => {
      expect(adapter.shouldRetry(500)).toBe(true);
      expect(adapter.shouldRetry(502)).toBe(true);
      expect(adapter.shouldRetry(503)).toBe(true);
    });

    test('does not retry on 4xx client errors', () => {
      expect(adapter.shouldRetry(400)).toBe(false);
      expect(adapter.shouldRetry(403)).toBe(false);
      expect(adapter.shouldRetry(404)).toBe(false);
      expect(adapter.shouldRetry(429)).toBe(false);
    });

    test('does not retry on success', () => {
      expect(adapter.shouldRetry(200)).toBe(false);
    });
  });

  describe('getTimeout', () => {
    test('returns 15 seconds', () => {
      expect(adapter.getTimeout()).toBe(15000);
    });
  });
});
