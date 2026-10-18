import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBluetoothClient } from './bluetoothClient.js';

const state = { ok: true, adapter: { supported: true, enabled: true, discovering: false }, devices: [], pairing: null, capabilities: {} };
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
afterEach(() => vi.useRealTimers());

describe('Bluetooth bridge client', () => {
  it('reads native state without caching and sends role-specific JSON commands', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(state)).mockResolvedValueOnce(response({ ok: true, accepted: true }));
    const client = createBluetoothClient({ fetchImpl });
    expect(await client.state()).toEqual(state);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://localhost:8770/bluetooth', expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(await client.command('connect', { address: 'AA:BB:CC:DD:EE:FF', profile: 'midi' })).toEqual({ ok: true, accepted: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://localhost:8770/bluetooth/connect', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"address":"AA:BB:CC:DD:EE:FF","profile":"midi"}' }));
  });

  it.each([
    [response({ ok: false, code: 'permission_denied', error: 'Bluetooth permission required' }, false, 403), 'Bluetooth permission required'],
    [response({ ok: false, code: 'unsupported', error: 'Audio unavailable' }), 'Audio unavailable'],
    [response({ nonsense: true }), 'Invalid Bluetooth response'],
    [{ ok: true, json: async () => { throw new Error('SyntaxError'); } }, 'Invalid Bluetooth response'],
  ])('surfaces API errors and rejects invalid responses', async (reply, message) => {
    const client = createBluetoothClient({ fetchImpl: async () => reply });
    await expect(client.state()).rejects.toThrow(message);
  });

  it('rejects a command that was not accepted even with HTTP success', async () => {
    const client = createBluetoothClient({ fetchImpl: async () => response({ ok: true, accepted: false }) });
    await expect(client.command('pair', { address: 'AA:BB:CC:DD:EE:FF' })).rejects.toThrow(/not accepted/i);
  });

  it('aborts a stalled request and clears its timer', async () => {
    vi.useFakeTimers();
    const client = createBluetoothClient({ timeoutMs: 100, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }) });
    const pending = expect(client.state()).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates cancellation from panel teardown', async () => {
    const controller = new AbortController();
    let requestSignal;
    const client = createBluetoothClient({ fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      requestSignal = signal;
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }) });
    const pending = expect(client.state({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await pending;
    expect(requestSignal.aborted).toBe(true);
  });
});
