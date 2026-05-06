import { describe, it, expect, vi } from 'vitest';
import { satelliteBearerAuth } from './satelliteBearerAuth.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function fakeRes() {
  let status = 200; let jsonBody = null;
  return {
    status(s) { status = s; return this; },
    json(b) { jsonBody = b; return this; },
    _state: () => ({ status, jsonBody }),
  };
}

describe('satelliteBearerAuth', () => {
  it('returns 401 when Authorization header missing', async () => {
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken: vi.fn() }, logger: silentLogger });
    const req = { headers: {}, ip: '1.2.3.4' };
    const res = fakeRes();
    await mw(req, res, () => { throw new Error('next should not be called'); });
    expect(res._state().status).toBe(401);
    expect(res._state().jsonBody.error.code).toBe('missing_token');
  });

  it('returns 401 when Authorization is not Bearer', async () => {
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken: vi.fn() }, logger: silentLogger });
    const req = { headers: { authorization: 'Basic xyz' }, ip: '1.2.3.4' };
    const res = fakeRes();
    await mw(req, res, () => { throw new Error('next should not be called'); });
    expect(res._state().status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    const findByToken = vi.fn(async () => null);
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken }, logger: silentLogger });
    const req = { headers: { authorization: 'Bearer bad' }, ip: '1.2.3.4' };
    const res = fakeRes();
    await mw(req, res, () => { throw new Error('next should not be called'); });
    expect(res._state().status).toBe(401);
    expect(res._state().jsonBody.error.code).toBe('invalid_token');
    expect(findByToken).toHaveBeenCalledWith('bad');
  });

  it('attaches req.satellite and calls next on valid token', async () => {
    const sat = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
    const findByToken = vi.fn(async (t) => (t === 'good' ? sat : null));
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken }, logger: silentLogger });
    const req = { headers: { authorization: 'Bearer good' }, ip: '1.2.3.4' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.satellite).toBe(sat);
  });
});
