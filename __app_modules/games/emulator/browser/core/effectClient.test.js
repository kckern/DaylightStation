import { describe, it, expect, vi } from 'vitest';
import { createEffectClient } from './effectClient.js';

const ok = (json) => ({ ok: true, status: 200, json: async () => json });

describe('createEffectClient', () => {
  it('posts the effect id and phase with keepalive', async () => {
    const fetchImpl = vi.fn(async () => ok({ status: 'applied' }));
    const run = createEffectClient({ fetchImpl });
    await run('underground_lights', 'enter', { game: 'super-mario-land', reason: 'state' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/v1/emulator/effects/underground_lights');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ phase: 'enter', game: 'super-mario-land', reason: 'state' });
  });

  it('refuses malformed ids and phases without a request', async () => {
    const fetchImpl = vi.fn();
    const logger = { warn: vi.fn() };
    const run = createEffectClient({ fetchImpl, logger });
    expect(await run('../x', 'enter')).toBeNull();
    expect(await run('ok', 'toggle')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('never throws on a network or HTTP failure', async () => {
    const logger = { warn: vi.fn() };
    const down = createEffectClient({ fetchImpl: vi.fn(async () => { throw new Error('offline'); }), logger });
    expect(await down('x', 'exit')).toBeNull();
    const notFound = createEffectClient({ fetchImpl: vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'unknown effect' }) })), logger });
    expect(await notFound('x', 'exit')).toBeNull();
    expect(logger.warn.mock.calls.map(([e]) => e)).toEqual(['emulator.effect.request-error', 'emulator.effect.request-failed']);
  });
});
