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
});
