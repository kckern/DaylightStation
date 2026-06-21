import { describe, it, expect } from '@jest/globals';
import { HttpSourceAdapter } from '#adapters/newsreporter/sources/HttpSourceAdapter.mjs';
import { isSource } from '#apps/newsreporter/ports/ISource.mjs';

/**
 * Fake HttpClient mirroring the project's HttpClient.get() contract:
 *   resolves { status, data, ok } on success, throws on failure.
 */
const fakeClient = (impl) => ({ get: async (url, opts) => impl(url, opts) });
const captureLogger = () => {
  const events = [];
  return { events, info: (e, d) => events.push({ e, d }), debug: () => {}, error: () => {} };
};

describe('HttpSourceAdapter', () => {
  it('is a valid ISource', () => {
    const adapter = new HttpSourceAdapter({ httpClient: fakeClient(() => ({ status: 200, ok: true, data: [] })), logger: captureLogger() });
    expect(isSource(adapter)).toBe(true);
  });

  it('returns items on a 200 array body and logs the fetch', async () => {
    const logger = captureLogger();
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => ({ status: 200, ok: true, data: [{ a: 1 }, { a: 2 }] })),
      logger,
    });
    const result = await adapter.gather({ config: { id: 'scores', url: 'http://x/scores' } });
    expect(result.items).toEqual([{ a: 1 }, { a: 2 }]);
    expect(result.meta).toMatchObject({ sourceId: 'scores', type: 'http' });
    expect(result.meta.fetchedAt).toEqual(expect.any(String));
    const fetchLog = logger.events.find(({ e }) => e === 'newsreporter.source.fetch');
    expect(fetchLog).toBeTruthy();
    expect(fetchLog.d).toMatchObject({ sourceId: 'scores', type: 'http', itemCount: 2 });
  });

  it('wraps a non-array, non-null object body as a single-item array', async () => {
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => ({ status: 200, ok: true, data: { a: 1 } })),
      logger: captureLogger(),
    });
    const result = await adapter.gather({ config: { id: 's', url: 'http://x' } });
    expect(result.items).toEqual([{ a: 1 }]);
  });

  it('returns [] when the payload is null', async () => {
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => ({ status: 200, ok: true, data: null })),
      logger: captureLogger(),
    });
    const result = await adapter.gather({ config: { id: 's', url: 'http://x' } });
    expect(result.items).toEqual([]);
  });

  it('returns [] when the payload is an empty array', async () => {
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => ({ status: 200, ok: true, data: [] })),
      logger: captureLogger(),
    });
    const result = await adapter.gather({ config: { id: 's', url: 'http://x' } });
    expect(result.items).toEqual([]);
  });

  it('plucks a jsonPath dot-path before normalising', async () => {
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => ({ status: 200, ok: true, data: { response: { matches: [{ id: 1 }] } } })),
      logger: captureLogger(),
    });
    const result = await adapter.gather({ config: { id: 's', url: 'http://x', jsonPath: '$.response.matches' } });
    expect(result.items).toEqual([{ id: 1 }]);
  });

  it('throws InfrastructureError when the client throws', async () => {
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => { throw new Error('boom'); }),
      logger: captureLogger(),
    });
    await expect(adapter.gather({ config: { id: 's', url: 'http://x' } }))
      .rejects.toThrow(/http source fetch failed/i);
  });

  it('throws InfrastructureError on a non-2xx status', async () => {
    const adapter = new HttpSourceAdapter({
      httpClient: fakeClient(() => ({ status: 503, ok: false, data: 'down' })),
      logger: captureLogger(),
    });
    await expect(adapter.gather({ config: { id: 's', url: 'http://x' } }))
      .rejects.toThrow(/http source fetch failed/i);
  });
});
