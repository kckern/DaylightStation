import { describe, it, expect, vi } from 'vitest';
import { YtDlpFetchServiceAdapter, failureReason } from './YtDlpFetchServiceAdapter.mjs';

const json = (status, body) => ({ status, ok: status < 400, json: async () => body });

function service(answers) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, adapter: new YtDlpFetchServiceAdapter({ baseUrl: 'http://svc:8790/', fetchImpl, logger: { warn() {} }, wait: async () => {} }) };
}

describe('YtDlpFetchServiceAdapter', () => {
  it('starts the fetch, reports progress, and answers a media resource that streams from the service', async () => {
    const { adapter, calls } = service([
      json(202, { name: 's000000000001', state: 'queued', progress: 0 }),
      json(200, { state: 'downloading', progress: 0.4 }),
      json(200, { state: 'ready', progress: 1, title: 'T', duration: 12, size: 1234 }),
    ]);
    const ticks = [];
    const out = await adapter.fetch('https://www.youtube.com/watch?v=x', { name: 's000000000001', maxHeight: 720, onProgress: (f) => ticks.push(f) });
    expect(calls[0]).toMatchObject({ url: 'http://svc:8790/fetch', method: 'POST' });
    expect(JSON.parse(calls[0].body)).toEqual({ name: 's000000000001', url: 'https://www.youtube.com/watch?v=x', maxHeight: 720 });
    expect(ticks).toEqual([0.4]);
    expect(out).toMatchObject({ kind: 'downloaded', title: 'T', duration: 12 });
    expect(out.media).toMatchObject({ size: 1234, mimeType: 'video/mp4' });
  });

  it('passes the service\'s failure on with a reason', async () => {
    const { adapter } = service([json(202, {}), json(200, { state: 'failed', error: 'ERROR: [youtube] x: Video unavailable' })]);
    expect(await adapter.fetch('u', { name: 's000000000001' })).toEqual({ kind: 'failed', error: 'ERROR: [youtube] x: Video unavailable', reason: 'unavailable' });
  });

  it('throws when the service cannot be reached, so the failover moves on', async () => {
    const { adapter } = service([new Error('ECONNREFUSED')]);
    await expect(adapter.fetch('u', { name: 's000000000001' })).rejects.toThrow(/unreachable/);
  });

  it('waits out a short blip while polling', async () => {
    const { adapter } = service([json(202, {}), new Error('reset'), json(200, { state: 'ready', size: 1 })]);
    expect((await adapter.fetch('u', { name: 's000000000001' })).kind).toBe('downloaded');
  });

  it('stops and deletes the job when cancelled', async () => {
    const ctrl = new AbortController();
    const { adapter, calls } = service([json(202, {}), json(200, { ok: true })]);
    ctrl.abort();
    expect(await adapter.fetch('u', { name: 's000000000001', signal: ctrl.signal })).toMatchObject({ reason: 'cancelled' });
    expect(calls[1]).toMatchObject({ url: 'http://svc:8790/fetch/s000000000001', method: 'DELETE' });
  });

  it('finds a video it still holds after an app restart', async () => {
    const { adapter } = service([json(200, { state: 'ready', title: 'K', duration: 3, size: 9 }), json(404, { error: 'unknown' })]);
    expect(await adapter.stored('s000000000001')).toMatchObject({ title: 'K', media: { size: 9 } });
    expect(await adapter.stored('s000000000002')).toBeNull();
  });

  it('classifies failures', () => {
    expect(failureReason('no progress for 90s')).toBe('stalled');
    expect(failureReason('too large or too long to fetch')).toBe('too_large');
    expect(failureReason('ERROR: Private video')).toBe('unavailable');
    expect(failureReason('ERROR: HTTP 403')).toBe('error');
  });
});
