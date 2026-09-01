import { describe, expect, it } from 'vitest';
import { PlexProxyAdapter } from './PlexProxyAdapter.mjs';

/**
 * Playlist art fallback.
 *
 * Once the content adapter prefers a playlist's custom `thumb` over its auto
 * `composite`, the handful of playlists whose thumb field is set but whose image
 * file is missing upstream (321212, 347692, 672290 on this server) would render
 * a broken <img>. Plex stamps both fields with the same key, so the composite is
 * derivable from the thumb path — recover it on the 404 rather than guessing at
 * request time which playlists have real art.
 */

function adapter() {
  return new PlexProxyAdapter({ host: 'http://plex.test:32400', token: 'tok' });
}

describe('PlexProxyAdapter playlist art fallback', () => {
  it('falls back from a missing playlist thumb to the auto composite', () => {
    expect(adapter().getFallbackPath('/library/metadata/321212/thumb/1788294115', 404))
      .toBe('/playlists/321212/composite/1788294115');
  });

  it('keeps the fallback for a thumb reached through the proxy prefix', () => {
    expect(adapter().getFallbackPath('/api/v1/proxy/plex/library/metadata/321212/thumb/9', 404))
      .toBe('/playlists/321212/composite/9');
  });

  it('offers no fallback when the thumb resolves', () => {
    expect(adapter().getFallbackPath('/library/metadata/672606/thumb/1788293999', 200))
      .toBeNull();
  });

  it('offers no fallback for a composite that is itself missing', () => {
    expect(adapter().getFallbackPath('/playlists/321212/composite/1788294115', 404))
      .toBeNull();
  });

  it('offers no fallback for non-thumb paths', () => {
    expect(adapter().getFallbackPath('/library/metadata/321212', 404)).toBeNull();
    expect(adapter().getFallbackPath('/photo/:/transcode?url=x', 404)).toBeNull();
  });

  it('offers no fallback for a non-numeric rating key', () => {
    expect(adapter().getFallbackPath('/library/metadata/..%2Fetc/thumb/9', 404)).toBeNull();
  });
});
