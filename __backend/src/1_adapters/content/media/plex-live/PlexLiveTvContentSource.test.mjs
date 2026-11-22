import { describe, expect, it } from 'vitest';
import { PlexLiveTvLineup, toChannel } from './PlexLiveTvLineup.mjs';
import { PlexLiveTvContentSource } from './PlexLiveTvContentSource.mjs';

/** NFL Channel as the provider lineup listed it on 2026-11-21. */
const NFL = {
  slug: 'nfl-channel',
  title: 'NFL Channel',
  callSign: 'NFLDC1',
  summary: 'NFL Channel for all your football highlights.',
  thumb: 'https://provider-static.plex.tv/epg/cms/production/x/NFL_WHITE.png',
  art: 'https://provider-static.plex.tv/epg/cms/production/y/NFL_BG.jpg',
  coverPoster: 'https://provider-static.plex.tv/epg/cms/production/z/NFL_VERT.jpg',
  gridKey: '61e805952502a7a6fa84d70f',
  hidden: false,
  Media: [{ drm: false, protocol: 'hls', Part: [{ key: '/library/parts/6a16-61e8.m3u8' }] }],
};
const DRM = { ...NFL, slug: 'locked', Media: [{ drm: true, protocol: 'hls', Part: [{ key: '/library/parts/a-b.m3u8' }] }] };
const HIDDEN = { ...NFL, slug: 'gone', hidden: true };

const quiet = { info() {}, warn() {}, debug() {} };

function fakeHttp(responses) {
  const calls = [];
  return {
    calls,
    async get(url, options) {
      calls.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const ok = (channels) => ({ ok: true, status: 200, data: { MediaContainer: { Channel: channels } } });

describe('PlexLiveTvLineup', () => {
  it('keeps playable channels only, keyed by slug', () => {
    expect(toChannel(NFL)).toMatchObject({ slug: 'nfl-channel', partKey: '/library/parts/6a16-61e8.m3u8', poster: NFL.coverPoster });
    expect(toChannel(DRM)).toBeNull();
    expect(toChannel(HIDDEN)).toBeNull();
    expect(toChannel({ ...NFL, slug: '../x' })).toBeNull();
  });

  it('sends the token as a header, not in the url, and caches the lineup', async () => {
    const http = fakeHttp([ok([NFL, DRM])]);
    const lineup = new PlexLiveTvLineup({ token: 'SECRET', httpClient: http, logger: quiet });
    expect((await lineup.get('nfl-channel')).title).toBe('NFL Channel');
    expect(await lineup.get('locked')).toBeNull();
    expect(await lineup.list()).toHaveLength(1);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe('https://epg.provider.plex.tv/lineups/plex/channels');
    expect(http.calls[0].url).not.toContain('SECRET');
    expect(http.calls[0].options.headers['X-Plex-Token']).toBe('SECRET');
  });

  it('serves the stale lineup through a failed refresh and backs off', async () => {
    let t = 0;
    const http = fakeHttp([ok([NFL]), new Error('ECONNRESET')]);
    const lineup = new PlexLiveTvLineup({ token: 't', httpClient: http, logger: quiet, now: () => t });
    await lineup.list();
    t = 7 * 60 * 60 * 1000; // past the cache
    expect(await lineup.get('nfl-channel')).not.toBeNull();
    t += 1000; // inside the backoff: no new request
    expect(await lineup.get('nfl-channel')).not.toBeNull();
    expect(http.calls).toHaveLength(2);
  });

  it('answers nothing (not a throw) when the first load fails', async () => {
    const http = fakeHttp([{ ok: false, status: 401, data: null }]);
    const lineup = new PlexLiveTvLineup({ token: 't', httpClient: http, logger: quiet });
    expect(await lineup.get('nfl-channel')).toBeNull();
    expect(await lineup.list()).toEqual([]);
  });
});

describe('PlexLiveTvContentSource', () => {
  function source() {
    const lineup = new PlexLiveTvLineup({ token: 't', httpClient: fakeHttp([ok([NFL])]), logger: quiet });
    return new PlexLiveTvContentSource({ lineup, logger: quiet });
  }

  it('turns plex-live:<slug> into a live hls_video item through the proxy', async () => {
    const item = await source().getItem('plex-live:nfl-channel');
    expect(item.id).toBe('plex-live:nfl-channel');
    expect(item.title).toBe('NFL Channel');
    expect(item.mediaType).toBe('hls_video');
    expect(item.mediaUrl).toBe('/api/v1/proxy/plex-live/library/parts/6a16-61e8.m3u8');
    expect(item.duration).toBeNull();
    expect(item.resumable).toBe(false);
    expect(item.metadata).toMatchObject({ contentFormat: 'hls_video', live: true, callSign: 'NFLDC1' });
  });

  it('accepts a bare slug and rejects unknown or malformed ones', async () => {
    const s = source();
    expect((await s.getItem('nfl-channel'))?.id).toBe('plex-live:nfl-channel');
    expect(await s.getItem('plex-live:no-such-channel')).toBeNull();
    expect(await s.getItem('plex-live:../etc')).toBeNull();
    expect(await s.resolvePlayables('plex-live:nfl-channel')).toHaveLength(1);
  });

  it('lists every channel for the bare prefix', async () => {
    const list = await source().getList('plex-live:');
    expect(list.map((i) => i.id)).toEqual(['plex-live:nfl-channel']);
    expect(await source().getList('plex-live:nfl-channel')).toEqual([]);
  });
});
