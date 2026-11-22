import { describe, expect, it } from 'vitest';
import { PlexLiveTvProxyAdapter, rewritePlaylist } from './PlexLiveTvProxyAdapter.mjs';

/**
 * Plex's live TV master playlist names its variant with the account token in
 * the query (`x-plex-token=...`, lower case). The shape below is the one
 * epg.provider.plex.tv served for NFL Channel on 2026-11-21, token replaced.
 */
const PART = '6a1610bebdf296985fd95603-61e805952502a7a6fa84d70f';
const MASTER = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",LANGUAGE="en",NAME="English",AUTOSELECT=YES,INSTREAM-ID="CC1"',
  '#EXT-X-STREAM-INF:BANDWIDTH=5625000,AVERAGE-BANDWIDTH=4500000,CODECS="avc1.64001f, mp4a.40.2",RESOLUTION=1920x1080,CLOSED-CAPTIONS="cc"',
  `https://epg.provider.plex.tv/library/parts/${PART}/variant.m3u8?x-plex-token=SECRET&x-plex-client-identifier=abc&x-plex-playback-id=p_1`,
  '',
].join('\n');

const VARIANT = [
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:10',
  '#EXT-X-KEY:METHOD=AES-128,URI="https://epg.provider.plex.tv/keys/1?X-Plex-Token=SECRET"',
  '#EXTINF:6.000,',
  'https://o300801.mp.lura.live/live/ephemeral/x/segment_1.ts?Expires=1&Signature=sig',
  '#EXTINF:6.000,',
  'segment_2.ts?x-plex-token=SECRET',
].join('\n');

function adapter() {
  return new PlexLiveTvProxyAdapter({ token: 'SECRET' });
}

describe('PlexLiveTvProxyAdapter', () => {
  it('is the plex-live service on the provider host, authed by query token', () => {
    const a = adapter();
    expect(a.getServiceName()).toBe('plex-live');
    expect(a.getBaseUrl()).toBe('https://epg.provider.plex.tv');
    expect(a.getAuthParams()).toEqual({ 'X-Plex-Token': 'SECRET' });
    expect(a.isConfigured()).toBe(true);
    expect(new PlexLiveTvProxyAdapter({}).isConfigured()).toBe(false);
  });

  it('exposes channel media and nothing else of the account API', () => {
    const a = adapter();
    expect(a.allowsPath(`/library/parts/${PART}.m3u8`)).toBe(true);
    expect(a.allowsPath(`/library/parts/${PART}/variant.m3u8?x-plex-client-identifier=abc`)).toBe(true);
    expect(a.allowsPath(`/library/parts/${PART}/segment_2.ts`)).toBe(true);
    expect(a.allowsPath('/lineups/plex/channels')).toBe(false);
    expect(a.allowsPath('/grid?type=EPG')).toBe(false);
    expect(a.allowsPath(`/library/parts/${PART}/../../users.m3u8`)).toBe(false);
  });

  it('removes the token from the master playlist and routes the variant back through the proxy', () => {
    const out = adapter().getBodyRewriter(`/library/parts/${PART}.m3u8`)(MASTER);
    expect(out).not.toMatch(/SECRET/);
    expect(out).toContain(
      `/api/v1/proxy/plex-live/library/parts/${PART}/variant.m3u8?x-plex-client-identifier=abc&x-plex-playback-id=p_1`,
    );
    // tags without a URI are untouched
    expect(out).toContain('CLOSED-CAPTIONS="cc"');
  });

  it('leaves CDN segments absolute and strips tokens from relative and URI= urls', () => {
    const out = adapter().getBodyRewriter(`/library/parts/${PART}/variant.m3u8`)(VARIANT);
    expect(out).not.toMatch(/SECRET/i);
    expect(out).toContain('https://o300801.mp.lura.live/live/ephemeral/x/segment_1.ts?Expires=1&Signature=sig');
    expect(out).toContain('URI="/api/v1/proxy/plex-live/keys/1"');
    // a relative segment resolves against the playlist's own upstream folder
    expect(out).toContain(`/api/v1/proxy/plex-live/library/parts/${PART}/segment_2.ts`);
  });

  it('marks playlists no-store and rewrites nothing else', () => {
    const a = adapter();
    expect(a.getResponseHeaders(`/library/parts/${PART}.m3u8`, 200)).toEqual({ 'cache-control': 'no-store' });
    expect(a.getBodyRewriter('/something/else.ts')).toBeNull();
  });

  it('honours a custom mount point', () => {
    const out = rewritePlaylist(MASTER, {
      base: new URL(`/library/parts/${PART}.m3u8`, 'https://epg.provider.plex.tv'),
      host: 'https://epg.provider.plex.tv',
      publicPrefix: '/x',
    });
    expect(out).toContain(`/x/library/parts/${PART}/variant.m3u8?`);
  });
});
