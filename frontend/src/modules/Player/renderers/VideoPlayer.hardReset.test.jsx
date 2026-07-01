import { describe, it, expect } from 'vitest';
import { appendRefreshParam, withOffsetParam } from './VideoPlayer.jsx';

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

  it('preserves URL fragment without existing query', () => {
    expect(appendRefreshParam('https://h.test/s#section', 99))
      .toBe('https://h.test/s?_refresh=99#section');
  });

  it('preserves URL fragment with existing query', () => {
    expect(appendRefreshParam('https://h.test/s?foo=bar#section', 99))
      .toBe('https://h.test/s?foo=bar&_refresh=99#section');
  });

  it('preserves URL fragment while replacing middle _refresh', () => {
    expect(appendRefreshParam('https://h.test/s?_refresh=111&foo=bar#section', 222))
      .toBe('https://h.test/s?foo=bar&_refresh=222#section');
  });

  it('preserves URL fragment while replacing last _refresh', () => {
    expect(appendRefreshParam('https://h.test/s?foo=bar&_refresh=111#section', 222))
      .toBe('https://h.test/s?foo=bar&_refresh=222#section');
  });
});

describe('withOffsetParam', () => {
  it('rewrites an existing offset= to the seek target (the whole point)', () => {
    expect(withOffsetParam('/api/v1/proxy/plex/stream/662170?offset=5294', 5465.9))
      .toBe('/api/v1/proxy/plex/stream/662170?offset=5465');
  });

  it('floors fractional seconds', () => {
    expect(withOffsetParam('/s?offset=10', 42.99)).toBe('/s?offset=42');
  });

  it('adds offset= when absent', () => {
    expect(withOffsetParam('/s?foo=bar', 300)).toBe('/s?foo=bar&offset=300');
    expect(withOffsetParam('/s', 300)).toBe('/s?offset=300');
  });

  it('leaves other params (and their order) intact when rewriting', () => {
    expect(withOffsetParam('/s?a=1&offset=100&b=2', 250)).toBe('/s?a=1&offset=250&b=2');
  });

  it('preserves a fragment', () => {
    expect(withOffsetParam('/s?offset=100#x', 250)).toBe('/s?offset=250#x');
  });

  it('is a no-op for a non-positive / non-finite offset', () => {
    expect(withOffsetParam('/s?offset=100', 0)).toBe('/s?offset=100');
    expect(withOffsetParam('/s?offset=100', -5)).toBe('/s?offset=100');
    expect(withOffsetParam('/s?offset=100', NaN)).toBe('/s?offset=100');
    expect(withOffsetParam('', 5)).toBe('');
  });
});
