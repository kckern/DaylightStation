import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlexClient } from '#adapters/content/media/plex/PlexClient.mjs';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Plex startup phase telemetry', () => {
  it('distinguishes a pending decision from completed metadata and records elapsed time without credentials', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finish;
    const log = logger();
    const http = { get: vi.fn((url) => url.includes('/decision?')
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ status:200, data:{ MediaContainer:{} } })) };
    const client = new PlexClient({ host:'http://plex.test', token:'private-token' }, { httpClient:http, logger:log });
    await client.getMetadata('697368');
    const request = client.request('/video/:/transcode/universal/decision?path=%2Flibrary%2Fmetadata%2F697368&X-Plex-Session-Identifier=probe-1&X-Plex-Token=private-query');
    await vi.advanceTimersByTimeAsync(29800);
    const starts = log.info.mock.calls.filter(([event]) => event === 'plex.request.phase-started');
    const ends = () => log.info.mock.calls.filter(([event]) => event === 'plex.request.phase-completed');
    expect(starts.map(([, fields]) => fields.phase)).toEqual(['metadata', 'decision']);
    expect(ends()).toHaveLength(1);
    finish({ status:200, data:{ MediaContainer:{ generalDecisionCode:'1001' } } });
    await expect(request).resolves.toMatchObject({ MediaContainer:{ generalDecisionCode:'1001' } });
    expect(ends()[1][1]).toMatchObject({ phase:'decision', ratingKey:'697368', elapsedMs:29800, status:200, sessionIdentifier:'probe-1' });
    expect(ends()[1][1].requestId).toBe(starts[1][1].requestId);
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/private-token|private-query|plex\.test|X-Plex-Token/);
  });

  it('reports failed phase duration and code without leaking authenticated path or error URL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const log = logger();
    const http = { get: () => new Promise((resolve, reject) => setTimeout(() => reject(Object.assign(
      new Error('failed http://plex.test?X-Plex-Token=private-token'), { code:'TIMEOUT' }
    )), 30000)) };
    const client = new PlexClient({ host:'http://plex.test', token:'private-token' }, { httpClient:http, logger:log });
    const request = client.request('/video/:/transcode/universal/decision?path=%2Flibrary%2Fmetadata%2F697368&X-Plex-Token=private-token');
    const rejected = expect(request).rejects.toMatchObject({ code:'TIMEOUT', message:'Media API request failed' });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(log.error).toHaveBeenCalledWith('plex.request.phase-failed', expect.objectContaining({ phase:'decision', elapsedMs:30000, code:'TIMEOUT' }));
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/private-token|plex\.test|X-Plex-Token/);
  });

  it('uses the injected adapter logger for its real metadata and decision requests', async () => {
    const log = logger();
    const http = { get: async (url) => ({ status:200, data:url.includes('/decision?')
      ? { MediaContainer:{ generalDecisionCode:'1001' } }
      : { MediaContainer:{ Metadata:[{ ratingKey:'697368', type:'movie', title:'Disclosure Day', duration:8833056,
        Media:[{ videoCodec:'h264', audioCodec:'aac', container:'mkv', Part:[{ key:'/parts/movie.mkv' }] }] }] } } }) };
    const adapter = new PlexAdapter({ host:'http://plex.test', token:'private-token' }, { httpClient:http, logger:log });
    const result = await adapter.getMediaUrl('697368', { session:'probe-session', startOffset:370 });
    expect(result.url).toContain('start.mpd');
    expect(log.info.mock.calls.filter(([event]) => event === 'plex.request.phase-completed').map(([, fields]) => fields.phase)).toEqual(['metadata', 'decision']);
  });
});
