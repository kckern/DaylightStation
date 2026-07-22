import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schoolApi } from './schoolApi.js';

beforeEach(() => vi.unstubAllGlobals());

describe('schoolApi', () => {
  it('returns ok/status/data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'b' }]), { status: 200 })));
    expect(await schoolApi.banks()).toEqual({ ok: true, status: 200, data: [{ id: 'b' }] });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/banks', expect.any(Object));
  });
  it('passes audience and posts JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.banks('generic');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/banks?audience=generic', expect.any(Object));
    await schoolApi.answer('ses_1', { itemId: 'q1', given: 'x' });
    const [, opts] = fetch.mock.calls.at(-1);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ itemId: 'q1', given: 'x' });
  });
  it('maps HTTP errors to ok:false with status, and network failure to status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'gone' }), { status: 410 })));
    expect(await schoolApi.answer('ses_x', { itemId: 'q', given: 'x' })).toMatchObject({ ok: false, status: 410 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await schoolApi.roster()).toEqual({ ok: false, status: 0, data: null });
  });
  it('never throws: a body that fails JSON.stringify resolves to status 0, not a rejection', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const circular = {};
    circular.self = circular;
    await expect(schoolApi.answer('ses_1', circular)).resolves.toEqual({ ok: false, status: 0, data: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('answer() always POSTs even when body is omitted', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await schoolApi.answer('ses_1');
    const [, opts] = fetchMock.mock.calls.at(-1);
    expect(opts.method).toBe('POST');
  });

  it('materials() GETs the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sections: [], materials: [] }), { status: 200 })));
    expect(await schoolApi.materials()).toEqual({ ok: true, status: 200, data: { sections: [], materials: [] } });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/materials', expect.any(Object));
  });

  it('materialUnits() GETs units, with and without a userId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await schoolApi.materialUnits('plex:1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/materials/plex%3A1/units', expect.any(Object));
    await schoolApi.materialUnits('plex:1', 'kid1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/materials/plex%3A1/units?userId=kid1', expect.any(Object));
  });

  it('unitProgress() PUTs the progress body', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await schoolApi.unitProgress('plex:1', 'plex:2', { userId: 'kid1', percent: 50, playhead: 30, durationMs: 60000 });
    const [url, opts] = fetchMock.mock.calls.at(-1);
    expect(url).toBe('/api/v1/school/materials/plex%3A1/units/plex%3A2/progress');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ userId: 'kid1', percent: 50, playhead: 30, durationMs: 60000 });
  });
});
