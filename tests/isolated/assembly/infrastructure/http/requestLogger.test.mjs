import { describe, test, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { requestLoggerMiddleware } from '#backend/src/0_system/http/middleware/requestLogger.mjs';

const APP_MJS = fileURLToPath(new URL('../../../../../backend/src/app.mjs', import.meta.url));

/**
 * The middleware existed, was mounted on exactly one router, and would have
 * missed the 2026-08-16 storm even if it had been mounted globally: it wrapped
 * res.json, while both hot paths end in res.redirect and proxyRes.pipe. A
 * response logger that only sees JSON is not a response logger.
 */
function harness(options = {}) {
  const logger = { sampled: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const app = express();
  app.use(requestLoggerMiddleware({ ...options, logger }));

  app.get('/json', (req, res) => res.json({ ok: true }));
  app.get('/redirect', (req, res) => res.redirect('http://plex.example/x.mpd'));
  app.get('/piped', (req, res) => {
    res.status(200);
    Readable.from(['chunk-a', 'chunk-b']).pipe(res);
  });
  app.get('/boom', (req, res) => res.status(500).json({ error: 'nope' }));
  app.get('/missing', (req, res) => res.status(404).end());

  return { app, logger };
}

/** Every response line, whichever budget it went out on. */
const responses = (logger) => [
  ...logger.sampled.mock.calls.filter(([e]) => e === 'http.response').map(([, data]) => data),
  ...logger.warn.mock.calls.filter(([e]) => e === 'http.response').map(([, data]) => data),
];

describe('requestLoggerMiddleware', () => {
  let h;
  beforeEach(() => { h = harness(); });

  test('logs a response that ends in res.json', async () => {
    await request(h.app).get('/json');
    expect(responses(h.logger)).toHaveLength(1);
  });

  // The path the storm actually took.
  test('logs a response that ends in res.redirect', async () => {
    await request(h.app).get('/redirect');

    const [line] = responses(h.logger);
    expect(line, 'a redirect produced no response line').toBeTruthy();
    expect(line).toMatchObject({ method: 'GET', path: '/redirect', status: 302 });
  });

  // The other one.
  test('logs a response that ends in a pipe', async () => {
    await request(h.app).get('/piped');

    const [line] = responses(h.logger);
    expect(line, 'a piped response produced no response line').toBeTruthy();
    expect(line).toMatchObject({ method: 'GET', path: '/piped', status: 200 });
  });

  test('carries duration and user agent', async () => {
    await request(h.app).get('/json').set('User-Agent', 'DaylightKiosk/1.0');

    const [line] = responses(h.logger);
    expect(typeof line.durationMs).toBe('number');
    expect(line.durationMs).toBeGreaterThanOrEqual(0);
    expect(line.userAgent).toBe('DaylightKiosk/1.0');
  });

  test('says which absence a missing user agent is', async () => {
    await request(h.app).get('/json').unset('User-Agent');
    expect(responses(h.logger)[0]).toHaveProperty('userAgent', null);
  });

  // Every request in the system flows through here.
  test('budgets successful responses rather than logging every one', async () => {
    await request(h.app).get('/json');

    const [, , opts] = h.logger.sampled.mock.calls.find(([e]) => e === 'http.response');
    expect(opts).toMatchObject({ maxPerMinute: expect.any(Number) });
    expect(opts.maxPerMinute).toBeGreaterThan(0);
  });

  // A 500 storm that gets sampled away is the failure this whole tier exists
  // to prevent, so failures leave the budget alone.
  test('logs every failing response unsampled, at warn', async () => {
    for (let i = 0; i < 40; i += 1) await request(h.app).get('/boom');

    const warned = h.logger.warn.mock.calls.filter(([e]) => e === 'http.response');
    expect(warned).toHaveLength(40);
    expect(h.logger.sampled.mock.calls.filter(([e]) => e === 'http.response')).toHaveLength(0);
    expect(warned[0][1]).toMatchObject({ status: 500 });
  });

  test('treats a 404 as a failing response too', async () => {
    await request(h.app).get('/missing');
    expect(h.logger.warn.mock.calls.filter(([e]) => e === 'http.response')).toHaveLength(1);
  });

  test('logs exactly one line per request', async () => {
    // 'close' fires after 'finish' on a normal response, so hooking both
    // without a guard doubles every line in the system.
    await request(h.app).get('/json');
    expect(responses(h.logger)).toHaveLength(1);
  });

  test('marks a completed response as not aborted', async () => {
    await request(h.app).get('/json');
    expect(responses(h.logger)[0]).toHaveProperty('aborted', false);
  });

  // A remount storm aborts in-flight media requests constantly. If those
  // produce no line at all, the log says the storm did not happen.
  test('logs a request the client abandons before it is answered', async () => {
    const logger = { sampled: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const app = express();
    app.use(requestLoggerMiddleware({ logger }));
    app.get('/never', () => { /* deliberately never responds */ });

    const server = app.listen(0);
    const port = server.address().port;
    const { default: http } = await import('http');

    await new Promise((resolve) => {
      const req = http.get({ port, path: '/never' }, () => {});
      req.on('error', () => {});
      setTimeout(() => { req.destroy(); setTimeout(resolve, 60); }, 30);
    });
    await new Promise((resolve) => server.close(resolve));

    const lines = responses(logger);
    expect(lines, 'an abandoned request left no trace').toHaveLength(1);
    expect(lines[0].aborted).toBe(true);
    expect(lines[0].path).toBe('/never');
  });

  test('never records a request body', async () => {
    const logger = { sampled: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use(requestLoggerMiddleware({ logger }));
    app.post('/echo', (req, res) => res.json({ ok: true }));

    await request(app).post('/echo').send({ password: 'hunter2' });

    const serialized = JSON.stringify([
      ...logger.sampled.mock.calls, ...logger.warn.mock.calls,
      ...logger.info.mock.calls, ...logger.debug.mock.calls,
    ]);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('password');
  });
});

/**
 * A source assertion rather than a behavioural one, deliberately: booting
 * app.mjs needs the whole composition root, and the bug being guarded here is
 * not "the middleware misbehaves" but "the middleware is mounted almost
 * nowhere". That is exactly what was true for years — one router — and it is
 * invisible to any test of the middleware itself.
 */
describe('global mount', () => {
  test('app.mjs mounts the request logger across /api/v1', () => {
    const src = fs.readFileSync(APP_MJS, 'utf8');
    expect(src).toMatch(/app\.use\(\s*'\/api\/v1'\s*,\s*requestLoggerMiddleware\(/);
  });

  test('no router mounts a second copy of it', () => {
    // Two mounts means every matching request is logged twice into a
    // size-capped sink.
    const routers = fileURLToPath(new URL('../../../../../backend/src/4_api/v1/routers/', import.meta.url));
    const offenders = fs.readdirSync(routers)
      .filter((f) => f.endsWith('.mjs'))
      .filter((f) => /router\.use\(\s*requestLoggerMiddleware\(/.test(fs.readFileSync(routers + f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
