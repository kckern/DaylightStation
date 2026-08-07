import { describe, it, expect } from 'vitest';
import { errorHandlerMiddleware } from '#system/http/middleware/errorHandler.mjs';

/** Minimal Express res mock capturing status + json body. */
function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function run(err, { isWebhook = false } = {}) {
  const mw = errorHandlerMiddleware({ shape: 'string', isWebhook });
  const req = { traceId: 't1' };
  const res = mockRes();
  mw(err, req, res, () => {});
  return res;
}

describe('errorHandlerMiddleware shape:string', () => {
  it('maps a name-based ValidationError to 400 with message + code (backward-compatible string)', () => {
    const res = run({ name: 'ValidationError', message: 'bad', code: 'X' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'bad', code: 'X' });
    expect(typeof res.body.error).toBe('string');
  });

  it('hides internals for an unexpected generic Error (500 → INTERNAL, message NOT leaked)', () => {
    const res = run(new Error('secret internals'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', code: 'INTERNAL' });
    expect(res.body.error).not.toContain('secret');
  });

  it('honors an explicit err.status (404) over name', () => {
    const res = run({ status: 404, message: 'nope' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'nope', code: undefined });
  });

  it('maps EntityNotFoundError name to 404', () => {
    const res = run({ name: 'EntityNotFoundError', message: 'User not found: 5' });
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('User not found: 5');
  });

  it('maps DomainInvariantError name to 422', () => {
    const res = run({ name: 'DomainInvariantError', message: 'rule broken', code: 'RULE' });
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ error: 'rule broken', code: 'RULE' });
  });

  it('maps InfrastructureError name to 503 and hides the message', () => {
    const res = run({ name: 'InfrastructureError', message: 'db down at host x' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Internal server error', code: 'INTERNAL' });
  });

  it('keeps webhook 200-behavior while using the string body', () => {
    const res = run({ name: 'ValidationError', message: 'bad', code: 'X' }, { isWebhook: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ error: 'bad', code: 'X' });
  });
});

describe('errorHandlerMiddleware shape:object (default) — envelope traceId', () => {
  it('carries the real req.traceId in the envelope, not a literal "unknown"', () => {
    const mw = errorHandlerMiddleware();
    const req = { traceId: 'real-trace-id' };
    const res = mockRes();
    mw(new Error('boom'), req, res, () => {});
    expect(res.body.traceId).toBe('real-trace-id');
  });

  it('a request with no traceId (tracing middleware absent/short-circuited) still gets a real, non-"unknown" id', () => {
    const mw = errorHandlerMiddleware();
    const req = {}; // no .traceId, no .id
    const res = mockRes();
    mw(new Error('boom'), req, res, () => {});
    expect(typeof res.body.traceId).toBe('string');
    expect(res.body.traceId.length).toBeGreaterThan(0);
    expect(res.body.traceId).not.toBe('unknown');
  });

  it('falls back to req.id when req.traceId is absent', () => {
    const mw = errorHandlerMiddleware();
    const req = { id: 'from-req-id' };
    const res = mockRes();
    mw(new Error('boom'), req, res, () => {});
    expect(res.body.traceId).toBe('from-req-id');
  });
});
