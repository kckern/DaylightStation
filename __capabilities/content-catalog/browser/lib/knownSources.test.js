import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isKnownSource, loadKnownSources, resetKnownSources } from './knownSources.js';

const SOURCES = '/api/v1/content/sources';
const ALIASES = '/api/v1/content/aliases';

describe('catalog source validation', () => {
  let requests;

  beforeEach(() => {
    resetKnownSources();
    requests = vi.fn();
    vi.stubGlobal('fetch', (url) => requests(new URL(url, 'http://localhost').pathname));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('retries an unavailable alias catalog without caching a partial set', async () => {
    let aliasResponse = Response.json({ error: 'Service unavailable' }, { status: 503 });
    requests.mockImplementation(async path => path === ALIASES
      ? aliasResponse
      : Response.json({ sources: ['plex'], categories: ['media'], providers: ['local'] }));

    const first = loadKnownSources();
    expect(loadKnownSources()).toBe(first);
    await expect(first).resolves.toBeNull();
    expect(isKnownSource('family-alias')).toBeNull();
    expect(requests.mock.calls).toEqual([[SOURCES], [ALIASES]]);

    aliasResponse = Response.json({ builtIn: ['hymn'], userDefined: ['family-alias'] });
    await expect(loadKnownSources()).resolves.toEqual(
      new Set(['plex', 'media', 'local', 'hymn', 'family-alias', 'app', 'menu'])
    );
    expect(isKnownSource('FAMILY-ALIAS')).toBe(true);
    expect(isKnownSource('invented')).toBe(false);
    await loadKnownSources();
    expect(requests.mock.calls).toEqual([[SOURCES], [ALIASES], [SOURCES], [ALIASES]]);
  });

  it('accepts the explicit response for an unwired alias resolver', async () => {
    requests.mockImplementation(async path => path === ALIASES
      ? Response.json({ code: 'ALIAS_RESOLVER_NOT_CONFIGURED' }, { status: 501 })
      : Response.json({ sources: ['plex'] }));

    await expect(loadKnownSources()).resolves.toEqual(new Set(['plex', 'app', 'menu']));
    expect(isKnownSource('plex')).toBe(true);
    expect(isKnownSource('invented')).toBe(false);
    await loadKnownSources();
    expect(requests).toHaveBeenCalledTimes(2);
  });

  it('keeps validation unknown for a 501 without the resolver error code', async () => {
    requests.mockImplementation(async path => path === ALIASES
      ? Response.json({ error: 'Proxy cannot fulfill the request' }, { status: 501 })
      : Response.json({ sources: ['plex'] }));

    await expect(loadKnownSources()).resolves.toBeNull();
    expect(isKnownSource('family-alias')).toBeNull();
  });
});
