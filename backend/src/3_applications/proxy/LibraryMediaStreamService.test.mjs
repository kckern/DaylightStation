import { describe, expect, it, vi } from 'vitest';
import { LibbyStreamLeaseService } from '#adapters/content/media/libby/LibbyStreamLeaseService.mjs';
import { LibbyStreamGateway } from '#adapters/content/media/libby/LibbyStreamGateway.mjs';
import { LibraryMediaStreamService } from './LibraryMediaStreamService.mjs';

const loan = { cardId: '123456789', titleId: '9999999', expiresAt: 2_000_000, parts: [] };
const part = { key: 'part-a', upstreamUrl: 'https://a.listen.libbyapp.com/a.mp3', headers: { Cookie: 'session=secret' } };
const runtimeTimers = {
  setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
  setInterval: (...args) => setInterval(...args), clearInterval: (...args) => clearInterval(...args),
};
const gateway = (fetch, allowedHosts = ['.listen.libbyapp.com', 'audioclips.cdn.overdrive.com']) => new LibbyStreamGateway({ fetch, allowedHosts });

function fixture({ now = () => 1_000_000, fetch, client, scheduler = runtimeTimers } = {}) {
  let byte = 1;
  const leases = new LibbyStreamLeaseService({ now, randomBytes: () => Buffer.alloc(32, byte++) });
  const { handle } = leases.issue({ loan, part });
  const service = new LibraryMediaStreamService({
    leases, streamGateway: gateway(fetch), scheduler,
    client: client || { openLoan: vi.fn(async () => ({ ...loan, parts: [part] })) },
    now,
  });
  return { service, leases, handle };
}

describe('LibraryMediaStreamService', () => {
  it('uses injected scheduling to expire active streams and cancels scheduled work on cleanup', async () => {
    const deadlines = new Set();
    const intervals = new Set();
    const scheduler = {
      setTimeout(task, delay) { const token = { task, delay }; deadlines.add(token); return token; },
      clearTimeout(token) { deadlines.delete(token); },
      setInterval(task, delay) { const token = { task, delay }; intervals.add(token); return token; },
      clearInterval(token) { intervals.delete(token); },
    };
    let signal;
    const { service, handle, leases } = fixture({ scheduler, fetch: async (_url, options) => {
      signal = options.signal;
      return new Response('audio');
    } });
    const opened = await service.open({ handle });
    expect(deadlines.size).toBe(1);
    expect(intervals.size).toBe(1);
    [...deadlines][0].task();
    expect(signal.aborted).toBe(true);
    expect(leases.resolve(handle).kind).toBe('gone');
    opened.cleanup();
    expect(deadlines.size).toBe(0);
    expect(intervals.size).toBe(0);
  });

  it('relays one byte range and preserves the upstream range contract', async () => {
    const fetch = vi.fn(async (_url, options) => {
      expect(options.headers.Range).toBe('bytes=0-0');
      expect(options.headers.Cookie).toBe('session=secret');
      return new Response(new Uint8Array([7]), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-length': '1', 'content-range': 'bytes 0-0/1234', 'accept-ranges': 'bytes' } });
    });
    const { service, handle } = fixture({ fetch });
    const result = await service.open({ handle, method: 'GET', range: 'bytes=0-0' });
    expect(result).toMatchObject({ kind: 'opened', status: 206, contentType: 'audio/mpeg', contentLength: '1', contentRange: 'bytes 0-0/1234', acceptRanges: 'bytes' });
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(new Uint8Array([7]));
  });

  it('relays a signed CDN capability with Range and no browser credentials', async () => {
    const signedPart = { ...part, upstreamUrl: 'https://audioclips.cdn.overdrive.com/signed/part', headers: {} };
    const fetch = vi.fn(async (_url, options) => {
      expect(options.headers).toEqual({ Range: 'bytes=0-0' });
      return new Response(new Uint8Array([7]), { status: 206, headers: {
        'content-type': 'audio/mpeg', 'content-length': '1', 'content-range': 'bytes 0-0/1234',
      } });
    });
    let byte = 90;
    const leases = new LibbyStreamLeaseService({ now: () => 1_000_000, randomBytes: () => Buffer.alloc(32, byte++) });
    const { handle } = leases.issue({ loan, part: signedPart });
    const service = new LibraryMediaStreamService({ leases, streamGateway: gateway(fetch, ['audioclips.cdn.overdrive.com']), scheduler: runtimeTimers, now: () => 1_000_000,
      client: { openLoan: vi.fn(async () => ({ ...loan, parts: [signedPart] })) }, allowedHosts: ['audioclips.cdn.overdrive.com'] });
    const result = await service.open({ handle, range: 'bytes=0-0' });
    expect(result).toMatchObject({ kind: 'opened', status: 206, contentRange: 'bytes 0-0/1234' });
    result.cleanup();
    leases.dispose();
  });

  it('rejects malformed and multipart ranges before contacting upstream', async () => {
    const fetch = vi.fn();
    const { service, handle } = fixture({ fetch });
    await expect(service.open({ handle, range: 'bytes=0-1,5-6' })).resolves.toEqual({ kind: 'invalid_range' });
    await expect(service.open({ handle, range: 'items=0-1' })).resolves.toEqual({ kind: 'invalid_range' });
    await expect(service.open({ handle, range: 'bytes=9-1' })).resolves.toEqual({ kind: 'invalid_range' });
    await expect(service.open({ handle, range: 'bytes=-0' })).resolves.toEqual({ kind: 'invalid_range' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects expired leases without contacting upstream', async () => {
    let time = 1_000;
    const fetch = vi.fn();
    const { service, handle } = fixture({ now: () => time, fetch });
    time = 4_000_000;
    await expect(service.open({ handle })).resolves.toEqual({ kind: 'gone', reason: 'expired' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects redirects outside the closed host policy', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/audio.mp3' } }));
    const { service, handle } = fixture({ fetch });
    await expect(service.open({ handle })).resolves.toMatchObject({ kind: 'upstream_error', reason: 'forbidden_origin' });
  });

  it('strips provider credentials on an allowed cross-origin redirect', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://audioclips.cdn.overdrive.com/audio.mp3' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const { service, handle } = fixture({ fetch });

    expect((await service.open({ handle })).kind).toBe('opened');
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe('session=secret');
    expect(fetch.mock.calls[1][1].headers.Cookie).toBeUndefined();
  });

  it('refreshes entitlement and fulfillment once after a pre-body 403', async () => {
    const refreshed = { ...part, upstreamUrl: 'https://a.listen.libbyapp.com/refreshed.mp3' };
    const client = { openLoan: vi.fn(async () => ({ ...loan, parts: [refreshed] })) };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-0/1' } }));
    const { service, handle } = fixture({ fetch, client });
    const result = await service.open({ handle, range: 'bytes=0-0' });
    expect(result.kind).toBe('opened');
    expect(client.openLoan).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[1][0]).toBe(refreshed.upstreamUrl);
  });

  it('does not refresh twice when a staggered 403 belongs to an older fulfillment generation', async () => {
    let releaseSecond;
    const secondResponse = new Promise((resolve) => { releaseSecond = resolve; });
    let releaseRefresh;
    const refreshPending = new Promise((resolve) => { releaseRefresh = resolve; });
    const refreshed = { ...part, upstreamUrl: 'https://a.listen.libbyapp.com/refreshed.mp3' };
    const client = { openLoan: vi.fn(async () => { await refreshPending; return { ...loan, parts: [refreshed] }; }) };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockImplementationOnce(() => secondResponse)
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const { service, handle } = fixture({ fetch, client });
    const first = service.open({ handle });
    await vi.waitFor(() => expect(client.openLoan).toHaveBeenCalledTimes(1));
    const second = service.open({ handle });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    releaseRefresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    releaseSecond(new Response(null, { status: 403 }));
    const results = await Promise.all([first, second]);
    results.forEach((result) => result.cleanup?.());
    expect(client.openLoan).toHaveBeenCalledTimes(1);
  });

  it('single-flights parallel entitlement refreshes for the same loan', async () => {
    let time = 1_000_000;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const client = { openLoan: vi.fn(async () => { await pending; return { ...loan, parts: [part] }; }) };
    const fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const { service, handle } = fixture({ now: () => time, fetch, client });
    time += 61_000;
    const first = service.open({ handle });
    const second = service.open({ handle });
    await vi.waitFor(() => expect(client.openLoan).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(client.openLoan).toHaveBeenCalledTimes(1);
  });

  it('single-flights a loan refresh while preserving each handle part', async () => {
    let time = 1_000_000;
    let byte = 20;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const partB = { ...part, key: 'part-b', upstreamUrl: 'https://b.listen.libbyapp.com/b.mp3' };
    const leases = new LibbyStreamLeaseService({ now: () => time, randomBytes: () => Buffer.alloc(32, byte++) });
    const handleA = leases.issue({ loan, part }).handle;
    const handleB = leases.issue({ loan, part: partB }).handle;
    const client = { openLoan: vi.fn(async () => { await pending; return { ...loan, parts: [part, partB] }; }) };
    const fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const service = new LibraryMediaStreamService({ leases, client, streamGateway: gateway(fetch, ['.listen.libbyapp.com']), scheduler: runtimeTimers, now: () => time });
    time += 61_000;
    const a = service.open({ handle: handleA });
    const b = service.open({ handle: handleB });
    await vi.waitFor(() => expect(client.openLoan).toHaveBeenCalledTimes(1));
    release();
    const results = await Promise.all([a, b]);
    results.forEach((result) => result.cleanup?.());
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([part.upstreamUrl, partB.upstreamUrl].sort());
  });

  it('does not start upstream work for an already-aborted request', async () => {
    const fetch = vi.fn();
    const { service, handle } = fixture({ fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(service.open({ handle, signal: controller.signal })).resolves.toMatchObject({ kind: 'upstream_error', reason: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revokes the lease when the active loan disappears during entitlement refresh', async () => {
    let time = 1_000_000;
    const missing = new Error('loan absent');
    missing.code = 'LIBRARY_MEDIA_LOAN_NOT_FOUND';
    const client = { openLoan: vi.fn(async () => { throw missing; }) };
    const fetch = vi.fn();
    const { service, leases, handle } = fixture({ now: () => time, fetch, client });
    time += 61_000;

    await expect(service.open({ handle })).resolves.toMatchObject({ kind: 'gone' });
    expect(leases.resolve(handle).kind).toBe('gone');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('expires an older active handle without revoking a newer sibling', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      let byte = 40;
      const now = () => Date.now();
      const liveLoan = { ...loan, expiresAt: 11_000 };
      const leases = new LibbyStreamLeaseService({ now, absoluteMs: 40, randomBytes: () => Buffer.alloc(32, byte++) });
      const first = leases.issue({ loan: liveLoan, part }).handle;
      vi.advanceTimersByTime(20);
      const second = leases.issue({ loan: liveLoan, part: { ...part, key: 'part-b' } }).handle;
      const service = new LibraryMediaStreamService({
        leases, client: { openLoan: vi.fn() }, scheduler: runtimeTimers, now, entitlementTtlMs: 1_000,
        streamGateway: gateway(vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'audio/mpeg' } })), ['.listen.libbyapp.com']),
      });
      const opened = await service.open({ handle: first });
      vi.advanceTimersByTime(21);
      expect(leases.resolve(first).kind).toBe('gone');
      expect(leases.resolve(second).kind).toBe('found');
      opened.cleanup();
      leases.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
