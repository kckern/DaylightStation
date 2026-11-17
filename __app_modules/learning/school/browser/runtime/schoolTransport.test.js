import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSchoolApi } from '../schoolApi.js';
import { createSchoolTransport } from './schoolTransport.js';

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferredFetch = () => {
  const pending = [];
  const fetchImpl = vi.fn(() => new Promise(resolve => pending.push(resolve)));
  return { fetchImpl, answer: (i, data, status) => pending[i](response(data, status)) };
};
afterEach(() => vi.useRealTimers());

describe('school transport causal reads', () => {
  it('does not satisfy the reload after a PUT with a GET issued before it', async () => {
    const { fetchImpl, answer } = deferredFetch();
    const api = createSchoolApi({ deviceId: 'panel', fetchImpl });
    const old = api.teacherDay('2026-11-16');
    const write = api.putEarnRules({ rates: [] });
    answer(1, { saved: true });
    await write;
    const current = api.teacherDay('2026-11-16');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    answer(0, { revision: 1 });
    await old;
    // Settling an old generation must not remove the newer GET's dedupe entry.
    const concurrent = api.teacherDay('2026-11-16');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    answer(2, { revision: 2 });
    expect((await current).data).toEqual({ revision: 2 });
    expect((await concurrent).data).toEqual({ revision: 2 });
  });

  it('fresh never joins an earlier GET and concurrent callers receive separate payloads', async () => {
    const { fetchImpl, answer } = deferredFetch();
    const transport = createSchoolTransport({ fetchImpl });
    const first = transport.request('/roster');
    const shared = transport.request('/roster');
    const fresh = transport.request('/roster', { fresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    answer(0, [{ id: 'first' }]);
    answer(1, [{ id: 'fresh' }]);
    const [a, b, c] = await Promise.all([first, shared, fresh]);
    a.data[0].id = 'edited';
    expect(b.data[0].id).toBe('first');
    expect(c.data[0].id).toBe('fresh');
  });

  it('two device clients keep independent scope, including absolute paths and grant headers', async () => {
    const seen = [];
    const fetchImpl = async (url, options) => { seen.push({ url, options }); return response([]); };
    const a = createSchoolApi({ deviceId: 'screen-a', fetchImpl });
    const b = createSchoolApi({ deviceId: 'screen-b', fetchImpl });
    await a.roster(); await b.roster(); await a.wallet('learner');
    await b.books.shelf('learner', 'secret');
    expect(seen.map(({ options }) => options.headers['X-Daylight-Device'])).toEqual(['screen-a', 'screen-b', 'screen-a', 'screen-b']);
    expect(seen[2].url).toBe('/api/v1/economy/users/learner/wallet');
    expect(seen[3].options.headers['X-School-Book-Grant']).toBe('secret');
  });
});

describe('school transport status and cancellation', () => {
  it('malformed successful JSON is a failed read, while valid null and 204 remain valid', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('learner secret'); } })
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const logger = { warn: vi.fn() };
    const transport = createSchoolTransport({ fetchImpl, logger });
    expect(await transport.request('/bad?grant=secret')).toEqual({ ok: false, status: 200, data: null, error: { kind: 'invalid-json' } });
    expect(await transport.request('/null')).toEqual({ ok: true, status: 200, data: null });
    expect(await transport.request('/empty')).toEqual({ ok: true, status: 204, data: null });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('settles timeouts and caller aborts even when fetch never settles', async () => {
    vi.useFakeTimers();
    const transport = createSchoolTransport({ fetchImpl: () => new Promise(() => {}), logger: { warn() {} } });
    const timed = transport.request('/timeout', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await timed).toMatchObject({ ok: false, status: 0, error: { kind: 'timeout' } });
    const controller = new AbortController();
    const aborted = transport.request('/abort', { signal: controller.signal });
    controller.abort();
    expect(await aborted).toMatchObject({ ok: false, status: 0, error: { kind: 'aborted' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let independently cancellable reads abort each other', async () => {
    const { fetchImpl, answer } = deferredFetch();
    const transport = createSchoolTransport({ fetchImpl });
    const controller = new AbortController();
    const a = transport.request('/roster', { signal: controller.signal });
    const b = transport.request('/roster');
    controller.abort();
    answer(1, ['still here']);
    expect((await a).error.kind).toBe('aborted');
    expect((await b).data).toEqual(['still here']);
  });

  it('preserves blob, raw body, response and non-ok status semantics', async () => {
    const blob = new Blob(['pdf']);
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob })
      .mockResolvedValueOnce(response({ message: 'forbidden' }, 403));
    const transport = createSchoolTransport({ fetchImpl });
    expect((await transport.request('/pdf', { responseType: 'blob' })).data).toBe(blob);
    const body = new FormData();
    expect(await transport.request('/upload', { method: 'POST', body, raw: true })).toEqual({ ok: false, status: 403, data: { message: 'forbidden' } });
    expect(fetchImpl.mock.calls[1][1].body).toBe(body);
    expect(fetchImpl.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
  });
});

it('classifies an abort during JSON parsing as cancellation', async () => {
  const aborted = new DOMException('private message', 'AbortError');
  const transport = createSchoolTransport({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw aborted; } }), logger: { warn() {} } });
  expect((await transport.request('/cancelled-body')).error.kind).toBe('aborted');
});
