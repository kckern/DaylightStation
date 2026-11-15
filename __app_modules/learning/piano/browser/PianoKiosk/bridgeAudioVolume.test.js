import { describe, it, expect, vi } from 'vitest';
import { checkBridgeMediaVolume } from './bridgeAudioVolume.js';

const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe('checkBridgeMediaVolume', () => {
  it('POSTs to the bridge volume-check', async () => {
    const fetchImpl = reply(200, { ok: true, guard: { routeOk: true, musicIndex: 15, musicMax: 15 } });
    await checkBridgeMediaVolume({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8770/audio-guard/volume-check',
      expect.objectContaining({ method: 'POST' }));
  });

  it('reports a raise the bridge made', async () => {
    const r = await checkBridgeMediaVolume({ fetchImpl: reply(200, { ok: true, guard: { routeOk: true, musicIndex: 15, musicMax: 15, raised: true } }) });
    expect(r).toMatchObject({ available: true, raised: true, silent: false });
  });

  it('flags silent when A2DP is the route and the OS index is still below max', async () => {
    const r = await checkBridgeMediaVolume({ fetchImpl: reply(200, { ok: true, guard: { routeOk: true, musicIndex: 0, musicMax: 15 } }) });
    expect(r.silent).toBe(true);
  });

  it('is not silent while gated (the speaker index is meant to be 0)', async () => {
    const r = await checkBridgeMediaVolume({ fetchImpl: reply(200, { ok: true, guard: { routeOk: false, musicIndex: 0, musicMax: 15 } }) });
    expect(r.silent).toBe(false);
  });

  it('is unavailable off the tablet', async () => {
    const r = await checkBridgeMediaVolume({ fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    expect(r).toEqual({ available: false, error: 'unreachable' });
  });

  it('is unavailable on an older payload without the endpoint', async () => {
    const r = await checkBridgeMediaVolume({ fetchImpl: reply(404, { ok: false, error: 'not_found' }) });
    expect(r.available).toBe(false);
  });
});
