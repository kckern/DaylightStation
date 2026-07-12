import { describe, it, expect, vi } from 'vitest';
import { HttpEndpointGateway } from '#adapters/trigger/HttpEndpointGateway.mjs';

describe('HttpEndpointGateway', () => {
  const endpoints = { bedtime: { method: 'POST', url: 'http://x/api', headers: { 'X-A': '1' } } };
  it('POSTs to the named endpoint with JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const gw = new HttpEndpointGateway({ endpoints, fetchFn });
    await gw.call('bedtime', { a: 1 });
    expect(fetchFn).toHaveBeenCalledWith('http://x/api', expect.objectContaining({ method: 'POST', headers: { 'X-A': '1' }, body: JSON.stringify({ a: 1 }) }));
  });
  it('no-ops (returns null) on an unknown endpoint', async () => {
    const fetchFn = vi.fn();
    const logger = { warn: vi.fn() };
    const gw = new HttpEndpointGateway({ endpoints, fetchFn, logger });
    const r = await gw.call('nope', {});
    expect(r).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('trigger.script.unknown_endpoint', expect.objectContaining({ ref: 'nope' }));
  });
  it('GET sends no body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const gw = new HttpEndpointGateway({ endpoints: { ping: { method: 'GET', url: 'http://x/ping' } }, fetchFn });
    await gw.call('ping', { a: 1 });
    const opts = fetchFn.mock.calls[0][1];
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
  });
});
