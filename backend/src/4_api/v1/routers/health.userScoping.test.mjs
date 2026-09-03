import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHealthRouter } from './health.mjs';

const DEFAULT_USER = 'kckern';

function handler(router, routePath) {
  return router.stack.find((layer) => layer.route?.path === routePath).route.stack[0].handle;
}

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; return this; },
  };
}

function routerWith(dependencies) {
  return createHealthRouter({
    healthOperations: {
      defaultUsername: () => DEFAULT_USER,
      nutritionItemsAvailable: false,
      nutritionInputAvailable: false,
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    ...dependencies,
  });
}

/**
 * Mirrors the real DataService path-building: `path.join(dataDir, 'users', user, ...)`.
 * path.join throws a TypeError when a segment isn't a string, which is exactly
 * how an array-shaped `?userId=a&userId=b` used to surface as a 500 on the
 * sibling photo route this fix mirrors.
 */
function recordingService(methodName, recorder) {
  return {
    [methodName]: async (username) => {
      recorder.username = username;
      path.join('/data', 'users', username, 'file.yml');
      return { username };
    },
  };
}

describe('health router — user scoping (GET /longitudinal, GET /dashboard)', () => {
  it('longitudinal: ignores a client-supplied userId and reads the default user', async () => {
    const recorder = {};
    const router = routerWith({ longitudinalService: recordingService('aggregate', recorder) });
    const res = response();
    let nextCalled = false;
    await handler(router, '/longitudinal')(
      { query: { userId: 'someoneelse' } }, res, (err) => { nextCalled = true; throw err; }
    );
    expect(recorder.username).toBe(DEFAULT_USER);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
  });

  it('dashboard: ignores a client-supplied userId and reads the default user', async () => {
    const recorder = {};
    const router = routerWith({ dashboardService: recordingService('execute', recorder) });
    const res = response();
    let nextCalled = false;
    await handler(router, '/dashboard')(
      { query: { userId: 'someoneelse' } }, res, (err) => { nextCalled = true; throw err; }
    );
    expect(recorder.username).toBe(DEFAULT_USER);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
  });

  it('longitudinal: a traversal payload in userId is wholly inert', async () => {
    const recorder = {};
    const router = routerWith({ longitudinalService: recordingService('aggregate', recorder) });
    const res = response();
    await handler(router, '/longitudinal')(
      { query: { userId: '../../outside' } }, res, (err) => { throw err; }
    );
    expect(recorder.username).toBe(DEFAULT_USER);
  });

  it('dashboard: a traversal payload in userId is wholly inert', async () => {
    const recorder = {};
    const router = routerWith({ dashboardService: recordingService('execute', recorder) });
    const res = response();
    await handler(router, '/dashboard')(
      { query: { userId: '../../outside' } }, res, (err) => { throw err; }
    );
    expect(recorder.username).toBe(DEFAULT_USER);
  });

  it('longitudinal: a duplicated-param (array) userId does not crash the request', async () => {
    const recorder = {};
    const router = routerWith({ longitudinalService: recordingService('aggregate', recorder) });
    const res = response();
    let caughtError = null;
    await handler(router, '/longitudinal')(
      { query: { userId: ['a', 'b'] } }, res, (err) => { caughtError = err; }
    );
    expect(caughtError).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(recorder.username).toBe(DEFAULT_USER);
  });

  it('dashboard: a duplicated-param (array) userId does not crash the request', async () => {
    const recorder = {};
    const router = routerWith({ dashboardService: recordingService('execute', recorder) });
    const res = response();
    let caughtError = null;
    await handler(router, '/dashboard')(
      { query: { userId: ['a', 'b'] } }, res, (err) => { caughtError = err; }
    );
    expect(caughtError).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(recorder.username).toBe(DEFAULT_USER);
  });
});
