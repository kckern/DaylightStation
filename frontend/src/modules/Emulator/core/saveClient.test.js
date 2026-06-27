import { describe, it, expect, vi } from 'vitest';
import { createSaveClient, DEFAULT_SLOT } from './saveClient.js';

function res({ status = 200, ok = status >= 200 && status < 300, buffer = null } = {}) {
  return { status, ok, arrayBuffer: async () => buffer ?? new ArrayBuffer(0) };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function clientWith(fetchImpl, logger) {
  return createSaveClient({ fetchImpl, baseUrl: '/api/v1/emulator', logger });
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

describe('getBlob semantics (discriminated)', () => {
  it('204 → absent', async () => {
    const c = clientWith(async () => res({ status: 204 }));
    expect(await c.getSave('gb', 'g', 'u')).toEqual({ status: 'absent' });
  });
  it('404 → absent', async () => {
    const c = clientWith(async () => res({ status: 404 }));
    expect(await c.getSave('gb', 'g', 'u')).toEqual({ status: 'absent' });
  });
  it('empty 200 → absent', async () => {
    const c = clientWith(async () => res({ status: 200, buffer: new ArrayBuffer(0) }));
    expect(await c.getSave('gb', 'g', 'u')).toEqual({ status: 'absent' });
  });
  it('200 with bytes → ok + data', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const c = clientWith(async () => res({ status: 200, buffer: buf }));
    const out = await c.getSave('gb', 'g', 'u');
    expect(out.status).toBe('ok');
    expect(out.data.byteLength).toBe(3);
  });
  it('500 → error (NOT absent) + warn logged', async () => {
    const logger = makeLogger();
    const c = clientWith(async () => res({ status: 500 }), logger);
    const out = await c.getSave('gb', 'g', 'u');
    expect(out.status).toBe('error');
    expect(out.httpStatus).toBe(500);
    expect(logger.warn).toHaveBeenCalledWith('save.get-failed', expect.objectContaining({ httpStatus: 500 }));
  });
  it('network throw → error + warn logged', async () => {
    const logger = makeLogger();
    const c = clientWith(async () => { throw new Error('offline'); }, logger);
    const out = await c.getSave('gb', 'g', 'u');
    expect(out.status).toBe('error');
    expect(out.error).toBe('offline');
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('put/delete (discriminated)', () => {
  it('PUT sends octet-stream body and reports ok', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    const out = await clientWith(fetchImpl).putSave('gb', 'g', 'u', new Uint8Array([9]));
    expect(out.status).toBe('ok');
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/octet-stream');
  });
  it('PUT failure → error + warn logged (not a silent false)', async () => {
    const logger = makeLogger();
    const out = await clientWith(async () => res({ status: 503 }), logger).putSave('gb', 'g', 'u', new Uint8Array([9]));
    expect(out.status).toBe('error');
    expect(out.httpStatus).toBe(503);
    expect(logger.warn).toHaveBeenCalledWith('save.put-failed', expect.objectContaining({ httpStatus: 503 }));
  });
  it('DELETE reports ok', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    expect((await clientWith(fetchImpl).deleteSave('gb', 'g', 'u')).status).toBe('ok');
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('saveMode-aware convenience', () => {
  it('loadResume routes battery→snapshot-preferred (state then save), state→state, none→absent', async () => {
    // For battery: tries /state/ first (absent here), then /save/ (also absent)
    const fetchImpl = vi.fn(async () => res({ status: 204 }));
    const c = clientWith(fetchImpl);
    await c.loadResume({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'battery' });
    await c.loadResume({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'state' });
    const none = await c.loadResume({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'none' });
    // battery makes 2 calls: /state/ first, then /save/ fallback (both absent)
    expect(fetchImpl.mock.calls[0][0]).toContain('/state/');
    expect(fetchImpl.mock.calls[1][0]).toContain('/save/');
    // state makes 1 call: /state/
    expect(fetchImpl.mock.calls[2][0]).toContain('/state/');
    expect(none).toEqual({ status: 'absent' });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // none made no request
  });

  it('persist + clear route by saveMode', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    const c = clientWith(fetchImpl);
    const p = await c.persist({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'state', body: new Uint8Array([1]) });
    const cl = await c.clear({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'battery' });
    expect(p.status).toBe('ok');
    expect(cl.status).toBe('ok');
    expect(fetchImpl.mock.calls[0][0]).toContain('/state/');
    expect(fetchImpl.mock.calls[0][1].method).toBe('PUT');
    expect(fetchImpl.mock.calls[1][0]).toContain('/save/');
    expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
  });

  it('persist with unsupported saveMode → error, no request', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 200 }));
    const out = await clientWith(fetchImpl).persist({ system: 'gb', gameId: 'g', user: 'u', saveMode: 'none', body: new Uint8Array([1]) });
    expect(out.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('battery-both resume', () => {
  it('loadResume(battery) prefers the snapshot, falls back to .srm', async () => {
    // snapshot present → kind:state
    let fetchImpl = vi.fn(async (url) =>
      url.includes('/state/') ? res({ status: 200, buffer: new ArrayBuffer(4) }) : res({ status: 404 }));
    let r = await clientWith(fetchImpl).loadResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('ok');
    expect(r.kind).toBe('state');

    // snapshot absent, .srm present → kind:battery
    fetchImpl = vi.fn(async (url) =>
      url.includes('/state/') ? res({ status: 404 }) : res({ status: 200, buffer: new ArrayBuffer(4) }));
    r = await clientWith(fetchImpl).loadResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('ok');
    expect(r.kind).toBe('battery');

    // neither → absent
    fetchImpl = vi.fn(async () => res({ status: 404 }));
    r = await clientWith(fetchImpl).loadResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('absent');
  });

  it('persistResume(battery) writes BOTH state + save', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push([url, init?.method]); return res({ status: 200 }); });
    const r = await clientWith(fetchImpl).persistResume({
      system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery',
      captured: { state: new Uint8Array([1]), battery: new Uint8Array([2]) },
    });
    expect(r.status).toBe('ok');
    expect(calls.some(([u, m]) => u.includes('/state/') && m === 'PUT')).toBe(true);
    expect(calls.some(([u, m]) => u.includes('/save/') && m === 'PUT')).toBe(true);
  });

  it('persistResume(state) writes only the snapshot', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push([url, init?.method]); return res({ status: 200 }); });
    await clientWith(fetchImpl).persistResume({
      system: 'gb', gameId: 'g', user: 'soren', saveMode: 'state', captured: { state: new Uint8Array([1]) },
    });
    expect(calls.every(([u]) => u.includes('/state/'))).toBe(true);
  });

  it('clearResume(battery) deletes BOTH', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push([url, init?.method]); return res({ status: 200 }); });
    const r = await clientWith(fetchImpl).clearResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('ok');
    expect(calls.filter(([, m]) => m === 'DELETE').length).toBe(2);
  });
});
