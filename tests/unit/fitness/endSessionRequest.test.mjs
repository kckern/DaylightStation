// tests/unit/fitness/endSessionRequest.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';

let buildEndSessionRequest;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/endSessionRequest.js');
  buildEndSessionRequest = mod.buildEndSessionRequest;
});

describe('buildEndSessionRequest', () => {
  it('builds a POST with the session id in the path and endTime in the body', () => {
    const req = buildEndSessionRequest('abc123', { now: () => 1700000000000 });
    expect(req).toEqual({
      path: 'api/v1/fitness/sessions/abc123/end',
      body: { endTime: 1700000000000 },
      method: 'POST',
    });
  });

  it('coerces numeric session ids to strings', () => {
    const req = buildEndSessionRequest(42, { now: () => 999 });
    expect(req.path).toBe('api/v1/fitness/sessions/42/end');
    expect(req.body.endTime).toBe(999);
    expect(req.method).toBe('POST');
  });

  it('returns null for a null session id', () => {
    expect(buildEndSessionRequest(null)).toBeNull();
  });

  it('returns null for an empty-string session id', () => {
    expect(buildEndSessionRequest('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(buildEndSessionRequest(undefined)).toBeNull();
  });

  it('uses Date.now() when no clock is injected', () => {
    const before = Date.now();
    const req = buildEndSessionRequest('x');
    const after = Date.now();
    expect(req.body.endTime).toBeGreaterThanOrEqual(before);
    expect(req.body.endTime).toBeLessThanOrEqual(after);
  });
});
