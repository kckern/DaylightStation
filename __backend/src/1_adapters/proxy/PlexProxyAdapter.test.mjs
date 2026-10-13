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

// 2026-10-07: HLS refusals are invisible — the manifest answers 200 and the
// refusal surfaces later as a transcode SEGMENT 404, which the proxy passed
// through as a plain 404 (only /library/parts/... was replaced with 503).
describe('PlexProxyAdapter transcode segment refusals', () => {
  const SEGMENTS = [
    '/video/:/transcode/universal/session/abc-123/base/00012.ts',
    '/video/:/transcode/universal/session/abc-123/base/00012.ts?X-Plex-Token=t',
    '/api/v1/proxy/plex/video/:/transcode/universal/session/abc-123/0/12.m4s',
    '/video/:/transcode/universal/session/abc-123/base/header',
  ];

  it('replaces a persistent segment 404 with the same 503 source-unreadable as a part', () => {
    for (const path of SEGMENTS) {
      expect(adapter().getErrorReplacement(path, 404)).toMatchObject({
        status: 503,
        body: { reason: 'source-unreadable' },
      });
    }
  });

  it('retries a segment 404 briefly (3x) before replacing', () => {
    const a = adapter();
    expect(a.shouldRetry(404, 0, SEGMENTS[0])).toBe(true);
    expect(a.shouldRetry(404, 2, SEGMENTS[0])).toBe(true);
    expect(a.shouldRetry(404, 3, SEGMENTS[0])).toBe(false);
  });

  it('leaves other transcode and non-media 404s alone', () => {
    const a = adapter();
    expect(a.getErrorReplacement('/video/:/transcode/universal/start.m3u8?x=1', 404)).toBeNull();
    expect(a.getErrorReplacement('/video/:/transcode/universal/session/abc/base/00012.ts', 500)).toBeNull();
    // playlists are not segment files: their 404 is passed through
    expect(a.getErrorReplacement('/video/:/transcode/universal/session/abc/base/index.m3u8', 404)).toBeNull();
    expect(a.shouldRetry(404, 0, '/video/:/transcode/universal/session/abc/base/index.m3u8')).toBe(false);
    expect(a.getErrorReplacement('/library/metadata/1/thumb/2', 404)).toBeNull();
  });
});
