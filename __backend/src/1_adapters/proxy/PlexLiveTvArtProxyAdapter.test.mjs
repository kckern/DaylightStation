import { describe, expect, it } from 'vitest';
import { PlexLiveTvArtProxyAdapter } from './PlexLiveTvArtProxyAdapter.mjs';

describe('PlexLiveTvArtProxyAdapter', () => {
  const a = new PlexLiveTvArtProxyAdapter();

  it('serves provider-static art without credentials, cached hard', () => {
    expect(a.getServiceName()).toBe('plex-live-art');
    expect(a.getBaseUrl()).toBe('https://provider-static.plex.tv');
    expect(a.isConfigured()).toBe(true);
    expect(a.getAuthParams).toBeUndefined();
    expect(a.getResponseHeaders('/epg/cms/production/x/a.png', 200)).toEqual({ 'cache-control': 'public, max-age=31536000, immutable' });
    expect(a.getErrorFallback()).toBe('svg');
  });

  it('reaches channel images only', () => {
    expect(a.allowsPath('/epg/cms/production/a7617b69-6d23/NFL_WHITE.png')).toBe(true);
    expect(a.allowsPath('/epg/cms/production/cc15/NFL_BLK__1_VERT.jpg')).toBe(true);
    expect(a.allowsPath('/epg/cms/production/x/page.html')).toBe(false);
    expect(a.allowsPath('/epg/cms/../../secret.png')).toBe(false);
    expect(a.allowsPath('/anything/else.png')).toBe(false);
  });
});
