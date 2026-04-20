import { describe, it, expect } from 'vitest';
import { appendRefreshParam } from './VideoPlayer.jsx';

describe('appendRefreshParam', () => {
  it('appends _refresh=<nonce> to a URL without query string', () => {
    expect(appendRefreshParam('https://host.test/api/v1/play/plex/1', 123456))
      .toBe('https://host.test/api/v1/play/plex/1?_refresh=123456');
  });

  it('appends &_refresh=<nonce> to a URL with existing query string', () => {
    expect(appendRefreshParam('https://host.test/stream?foo=bar', 789))
      .toBe('https://host.test/stream?foo=bar&_refresh=789');
  });

  it('replaces an existing _refresh param instead of duplicating', () => {
    expect(appendRefreshParam('https://host.test/s?_refresh=111&foo=bar', 222))
      .toBe('https://host.test/s?foo=bar&_refresh=222');
  });

  it('replaces _refresh when it is the last param', () => {
    expect(appendRefreshParam('https://host.test/s?foo=bar&_refresh=111', 333))
      .toBe('https://host.test/s?foo=bar&_refresh=333');
  });

  it('replaces _refresh when it is the only param', () => {
    expect(appendRefreshParam('https://host.test/s?_refresh=111', 444))
      .toBe('https://host.test/s?_refresh=444');
  });

  it('handles relative URLs', () => {
    expect(appendRefreshParam('/api/v1/play/plex/1', 55))
      .toBe('/api/v1/play/plex/1?_refresh=55');
  });

  it('handles relative URLs with query', () => {
    expect(appendRefreshParam('/api/v1/play/plex/1?autoplay=1', 66))
      .toBe('/api/v1/play/plex/1?autoplay=1&_refresh=66');
  });

  it('returns falsy input unchanged', () => {
    expect(appendRefreshParam('', 1)).toBe('');
    expect(appendRefreshParam(null, 1)).toBe(null);
    expect(appendRefreshParam(undefined, 1)).toBe(undefined);
  });
});
