// tests/isolated/observability/deviceIdentity.test.mjs
//
// Tier 2, Task 2.2 — per-device identity in backend logs.
//
// All frontend traffic reaches the backend over the docker network, so `req.ip`
// is one address for the whole house (`172.18.0.53` throughout the 2026-08-16
// investigation) and the backend's own log context names the SERVER. Filtering
// by IP conflated the garage fitness kiosk with the piano tablet.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { deviceResolver } from '#api/middleware/deviceResolver.mjs';
import { networkTrustResolver } from '#api/middleware/networkTrustResolver.mjs';
import { requestLoggerMiddleware } from '#backend/src/0_system/http/middleware/requestLogger.mjs';

const SHIELD_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV) AppleWebKit/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0';

function resolverApp() {
  const app = express();
  app.use(deviceResolver());
  app.get('/x', (req, res) => res.json({ deviceId: req.deviceId, deviceIdSource: req.deviceIdSource }));
  return app;
}

/** Logger + resolver in the order app.mjs mounts them (logger first, reading at 'finish'). */
function loggedApp({ withResolver = true } = {}) {
  const logger = { sampled: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const app = express();
  app.use(requestLoggerMiddleware({ logger }));
  if (withResolver) app.use(deviceResolver());
  app.get('/x', (_req, res) => res.json({ ok: true }));
  const line = () => logger.sampled.mock.calls[0]?.[1] ?? logger.warn.mock.calls[0]?.[1];
  return { app, line };
}

describe('deviceResolver', () => {
  it('takes the declared device id when the client sends one', async () => {
    const res = await request(resolverApp()).get('/x').set('X-Daylight-Device', 'fleet:piano-tablet');

    expect(res.body).toEqual({ deviceId: 'fleet:piano-tablet', deviceIdSource: 'header' });
  });

  it('falls back to the User-Agent, and says that is what it did', async () => {
    const res = await request(resolverApp()).get('/x').set('User-Agent', SHIELD_UA);

    expect(res.body).toEqual({ deviceId: SHIELD_UA, deviceIdSource: 'user-agent' });
  });

  it('separates the three kiosks on User-Agent alone', async () => {
    // The zero-frontend-work half of this task: Shield WebView, tablet Chromium
    // and garage Firefox are already distinguishable without any header.
    const app = resolverApp();
    const [shield, firefox] = await Promise.all([
      request(app).get('/x').set('User-Agent', SHIELD_UA),
      request(app).get('/x').set('User-Agent', FIREFOX_UA),
    ]);

    expect(shield.body.deviceId).not.toBe(firefox.body.deviceId);
  });

  it('reports "none" rather than a fabricated id when neither is sent', async () => {
    // supertest always sends a UA unless it is cleared, so clear it.
    const res = await request(resolverApp()).get('/x').set('User-Agent', '');

    expect(res.body).toEqual({ deviceId: null, deviceIdSource: 'none' });
  });

  it('prefers the declared id over the User-Agent', async () => {
    const res = await request(resolverApp())
      .get('/x')
      .set('X-Daylight-Device', 'browser:abc123')
      .set('User-Agent', SHIELD_UA);

    expect(res.body.deviceIdSource).toBe('header');
    expect(res.body.deviceId).toBe('browser:abc123');
  });

  // Driven directly rather than through supertest: Node's http client rejects
  // control characters in a header value, so a hostile header cannot be posted
  // from a well-behaved client — but this value goes into a log, and the thing
  // writing it is not necessarily well-behaved.
  function resolve(headers) {
    const req = { headers };
    deviceResolver()(req, {}, () => {});
    return req;
  }

  it('strips control characters — the header is untrusted input on its way into a log', () => {
    const req = resolve({ 'x-daylight-device': 'piano\n{"forged":"line"}' });

    expect(req.deviceId).toBe('piano{"forged":"line"}');
    expect(req.deviceId).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it('caps length so one header cannot flood a log', () => {
    const req = resolve({ 'x-daylight-device': 'z'.repeat(400) });

    expect(req.deviceId).toHaveLength(128);
  });

  it('treats a whitespace-only header as absent, not as an id', () => {
    const req = resolve({ 'x-daylight-device': '   ', 'user-agent': SHIELD_UA });

    expect(req.deviceIdSource).toBe('user-agent');
  });
});

describe('http.response carries the device', () => {
  it('names the declared device on the log line', async () => {
    const { app, line } = loggedApp();

    await request(app).get('/x').set('X-Daylight-Device', 'fleet:piano-tablet');

    expect(line()).toMatchObject({ deviceId: 'fleet:piano-tablet', deviceIdSource: 'header' });
  });

  it('names the User-Agent when there is no header', async () => {
    const { app, line } = loggedApp();

    await request(app).get('/x').set('User-Agent', FIREFOX_UA);

    expect(line()).toMatchObject({ deviceId: FIREFOX_UA, deviceIdSource: 'user-agent' });
  });

  it('says "unresolved" — not "none" — when the resolver never ran', async () => {
    // A request nobody looked at is a different fact from a request that
    // carried nothing, and the two must not share a value.
    const { app, line } = loggedApp({ withResolver: false });

    await request(app).get('/x').set('X-Daylight-Device', 'fleet:piano-tablet');

    expect(line()).toMatchObject({ deviceId: null, deviceIdSource: 'unresolved' });
  });
});

describe('trust proxy does not move the auth boundary', () => {
  // app.mjs now sets `trust proxy`, which redefines `req.ip` as an
  // X-Forwarded-For–derived address. networkTrustResolver grants `sysadmin` by
  // address, so had it kept reading `req.ip`, a logging change would have
  // silently changed who holds sysadmin. It reads the socket peer instead.
  function trustApp() {
    const app = express();
    app.set('trust proxy', 'loopback, linklocal, uniquelocal');
    app.use(networkTrustResolver({ householdRoles: {} }));
    app.get('/x', (req, res) => res.json({ isLocal: req.isLocal, roles: req.roles, reqIp: req.ip }));
    return app;
  }

  it('a forged X-Forwarded-For cannot make a caller look private', async () => {
    // Supertest connects over loopback, which IS private — so the peer decides
    // this is local either way. What must not happen is the FORGED value
    // becoming the input: assert the header did not become req.ip's basis for
    // the trust call by checking a forged PUBLIC address is equally ignored.
    const res = await request(trustApp()).get('/x').set('X-Forwarded-For', '203.0.113.7');

    // req.ip follows the forwarded chain (that is the point of trust proxy)...
    expect(res.body.reqIp).toBe('203.0.113.7');
    // ...but the trust decision does not.
    expect(res.body.isLocal).toBe(true);
  });

  it('a forged private X-Forwarded-For does not grant trust either', async () => {
    const app = express();
    app.set('trust proxy', 'loopback, linklocal, uniquelocal');
    app.use((req, _res, next) => {
      // Stand in for a genuinely remote peer reaching us directly.
      Object.defineProperty(req, 'socket', { value: { remoteAddress: '203.0.113.7' }, configurable: true });
      next();
    });
    app.use(networkTrustResolver({ householdRoles: {} }));
    app.get('/x', (req, res) => res.json({ isLocal: req.isLocal, roles: req.roles }));

    const res = await request(app).get('/x').set('X-Forwarded-For', '10.0.0.5');

    expect(res.body.isLocal).toBe(false);
    expect(res.body.roles).toEqual([]);
  });
});
