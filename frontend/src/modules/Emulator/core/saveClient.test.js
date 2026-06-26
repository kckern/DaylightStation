import { describe, it, expect, vi } from 'vitest';
import { createSaveClient, DEFAULT_SLOT } from './saveClient.js';

function res({ status = 200, ok = status >= 200 && status < 300, buffer = null } = {}) {
  return { status, ok, arrayBuffer: async () => buffer ?? new ArrayBuffer(0) };
}

function clientWith(fetchImpl) {
  return createSaveClient({ fetchImpl, baseUrl: '/api/v1/emulator' });
}

describe('saveClient URLs', () => {
  it('builds user-keyed save + state URLs (slot defaults to auto)', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 204 }));
    const c = clientWith(fetchImpl);
    await c.getSave('gb', 'pokemon-red', 'soren');
    await c.getState('gb', 'pokemon-red', 'soren');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/emulator/save/gb/pokemon-red?user=soren');
    expect(fetchImpl.mock.calls[1][0]).toBe(`/api/v1/emulator/state/gb/pokemon-red/${DEFAULT_SLOT}?user=soren`);
  });

  it('encodes path + user segments', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 204 }));
    await clientWith(fetchImpl).getSave('gb', 'a b', 'k/c');
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/emulator/save/gb/a%20b?user=k%2Fc');
  });
});

describe('getBlob semantics', () => {
  it('204 → null', async () => {
    const c = clientWith(async () => res({ status: 204 }));
    expect(await c.getSave('gb', 'g', 'u')).toBeNull();
  });
  it('empty 200 → null', async () => {
    const c = clientWith(async () => res({ status: 200, buffer: new ArrayBuffer(0) }));
    expect(await c.getSave('gb', 'g', 'u')).toBeNull();
  });
  it('200 with bytes → ArrayBuffer', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const c = clientWith(async () => res({ status: 200, buffer: buf }));
    const out = await c.getSave('gb', 'g', 'u');
    expect(out.byteLength).toBe(3);
  });
});

describe('put/delete', () => {
  it('PUT sends octet-stream body and reports ok', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    const ok = await clientWith(fetchImpl).putSave('gb', 'g', 'u', new Uint8Array([9]));
    expect(ok).toBe(true);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/octet-stream');
  });
  it('DELETE reports ok', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    expect(await clientWith(fetchImpl).deleteSave('gb', 'g', 'u')).toBe(true);
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('saveMode-aware convenience', () => {
  it('loadResume routes battery→save, state→state, none→null', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 204 }));
    const c = clientWith(fetchImpl);
    await c.loadResume({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'battery' });
    await c.loadResume({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'state' });
    const none = await c.loadResume({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'none' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/save/');
    expect(fetchImpl.mock.calls[1][0]).toContain('/state/');
    expect(none).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // none made no request
  });

  it('persist + clear route by saveMode', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    const c = clientWith(fetchImpl);
    await c.persist({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'state', body: new Uint8Array([1]) });
    await c.clear({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'battery' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/state/');
    expect(fetchImpl.mock.calls[0][1].method).toBe('PUT');
    expect(fetchImpl.mock.calls[1][0]).toContain('/save/');
    expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
  });
});
