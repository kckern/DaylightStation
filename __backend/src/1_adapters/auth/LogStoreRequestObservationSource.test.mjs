import { describe, expect, it, vi } from 'vitest';
import { LogStoreRequestObservationSource } from './LogStoreRequestObservationSource.mjs';
import { main } from '../../../../cli/identity-access.cli.mjs';

const since = '2026-11-26T00:00:00Z';
const until = '2026-11-26T00:01:00Z';
const start = Date.parse(since);
const end = Date.parse(until);
const baseUrl = 'http://logs.example:9428';

describe('access inventory CLI and log source', () => {
  it('decodes VictoriaLogs strings and includes the final window emitted at the endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      _msg: 'access.inventory.window',
      'data.writerId': 'boot', 'data.sequence': '1', 'data.start': String(start),
      'data.end': String(end), 'data.overflow': 'false', 'data.observations': '[]',
    })));
    const source = new LogStoreRequestObservationSource({ baseUrl, fetchImpl });
    expect((await source.read({ since, until })).windows).toEqual([
      { writerId: 'boot', sequence: 1, start, end, overflow: false, observations: [] },
    ]);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url.pathname).toBe('/select/logsql/query');
    expect(options.body.get('query')).toContain('2026-11-26T00:02:00.000Z');
  });

  it('refuses a failed or invalid query and uses the documented CLI exit statuses', async () => {
    const source = new LogStoreRequestObservationSource({
      baseUrl, fetchImpl: async () => new Response('not-json'),
    });
    await expect(source.read({ since, until })).rejects.toMatchObject({ code: 'access_inventory_log_unavailable' });

    const run = report => main(['inventory', '--since', since, '--until', until], {
      env: { DAYLIGHT_LOGSTORE: baseUrl },
      output: { write: vi.fn() }, errors: { write: vi.fn() },
      createInventory: () => ({ report }),
    });
    expect(await run(() => ({ coverage: { complete: true }, unknown: [] }))).toBe(0);
    expect(await run(() => ({ coverage: { complete: false }, unknown: [] }))).toBe(2);
    expect(await run(() => { throw new Error('unavailable'); })).toBe(1);
  });
});
