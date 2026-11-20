import { describe, it, expect } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { crossSiteGuard, crossSiteRefusal, corsOptionsFor, originAllowList, normalizeOrigin, webSocketOriginRefusal } from './crossSiteGuard.mjs';

function build({ allowedOrigins = [], trustProxy = null, logger = null } = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  const allowed = originAllowList(allowedOrigins);
  app.use(crossSiteGuard({ allowedOrigins: allowed, logger }));
  app.use(cors(corsOptionsFor(allowed)));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.all('/api/v1/admin/thing', (req, res) => res.json({ ok: true }));
  app.all(['/api/v1/proxy/plex/photo', '/admin', '/admin/x', '/administrator', '/apis', '/fitness', '/build.txt'], (req, res) => res.json({ ok: true }));
  return app;
}

const HOST = 'app.example.test';

describe('crossSiteGuard', () => {
  it('lets the app\'s own page write (Sec-Fetch-Site: same-origin)', async () => {
    const res = await request(build()).post('/api/v1/admin/thing')
      .set('Host', HOST).set('Origin', `https://${HOST}`).set('Sec-Fetch-Site', 'same-origin')
      .send({ a: 1 });
    expect(res.status).toBe(200);
  });

  it('refuses a cross-site POST of every simple content type', async () => {
    const bodies = [
      ['text/plain', 'hello'],
      ['application/x-www-form-urlencoded', 'a=1'],
      ['multipart/form-data; boundary=x', '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--x--\r\n'],
      ['application/json', '{"a":1}'],
    ];
    for (const [type, body] of bodies) {
      const res = await request(build()).post('/api/v1/admin/thing')
        .set('Host', HOST).set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'cross-site')
        .set('Content-Type', type).send(body);
      expect(res.status, type).toBe(403);
      expect(res.body, type).toEqual({ error: 'cross-site-refused' });
    }
  });

  it('refuses same-site (a sibling subdomain) and every unsafe method', async () => {
    for (const method of ['post', 'put', 'patch', 'delete']) {
      const res = await request(build())[method]('/api/v1/admin/thing')
        .set('Host', HOST).set('Origin', 'https://other.example.test').set('Sec-Fetch-Site', 'same-site');
      expect(res.status, method).toBe(403);
    }
  });

  it('allows Sec-Fetch-Site: none (a user-initiated navigation)', async () => {
    const res = await request(build()).post('/api/v1/admin/thing').set('Host', HOST).set('Sec-Fetch-Site', 'none');
    expect(res.status).toBe(200);
  });

  it('lets non-browser callers through (no Origin, no Sec-Fetch-Site)', async () => {
    const res = await request(build()).post('/api/v1/admin/thing').set('Host', HOST).send({ a: 1 });
    expect(res.status).toBe(200);
  });

  it('leaves a GET or HEAD outside /api and /admin alone, even cross-site', async () => {
    const get = await request(build()).get('/fitness')
      .set('Host', HOST).set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'no-cors');
    expect(get.status).toBe(200);
    const head = await request(build()).head('/build.txt').set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'no-cors');
    expect(head.status).toBe(200);
  });

  describe('resource isolation: other sites may not load /api or /admin as a subresource', () => {
    const cases = [
      ['img or video', 'no-cors', 'image'],
      ['fetch', 'cors', 'empty'],
      ['script', 'no-cors', 'script'],
    ];

    it('refuses a cross-site or same-site subresource GET of /api and /admin', async () => {
      for (const site of ['cross-site', 'same-site']) {
        for (const [label, mode, dest] of cases) {
          for (const path of ['/api/v1/admin/thing', '/api/v1/proxy/plex/photo', '/admin', '/admin/x']) {
            const res = await request(build()).get(path)
              .set('Host', HOST).set('Sec-Fetch-Site', site).set('Sec-Fetch-Mode', mode).set('Sec-Fetch-Dest', dest);
            expect(res.status, `${site} ${label} ${path}`).toBe(403);
            expect(res.body).toEqual({ error: 'cross-site-refused' });
          }
        }
      }
      const head = await request(build()).head('/api/v1/admin/thing').set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'no-cors');
      expect(head.status).toBe(403);
    });

    it('lets a top-level navigation through: a Telegram button, an OAuth callback, a link', async () => {
      for (const site of ['cross-site', 'same-site']) {
        const res = await request(build()).get('/api/v1/admin/thing')
          .set('Host', HOST).set('Sec-Fetch-Site', site).set('Sec-Fetch-Mode', 'navigate').set('Sec-Fetch-Dest', 'document');
        expect(res.status, site).toBe(200);
      }
    });

    it('refuses a navigation nested in another site\'s frame (an invisible iframe could fire an action GET)', async () => {
      for (const dest of ['iframe', 'frame', 'embed', 'object']) {
        const res = await request(build()).get('/api/v1/admin/thing')
          .set('Host', HOST).set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'navigate').set('Sec-Fetch-Dest', dest);
        expect(res.status, dest).toBe(403);
      }
    });

    it('lets the app\'s own page, a typed URL, and non-browser callers read', async () => {
      for (const site of ['same-origin', 'none']) {
        const res = await request(build()).get('/api/v1/admin/thing').set('Sec-Fetch-Site', site).set('Sec-Fetch-Mode', 'cors');
        expect(res.status, site).toBe(200);
      }
      expect((await request(build()).get('/api/v1/admin/thing')).status).toBe(200);
    });

    it('lets an allow-listed origin read cross-site, preflight included', async () => {
      const app = build({ allowedOrigins: ['https://partner.example'] });
      const get = await request(app).get('/api/v1/admin/thing')
        .set('Origin', 'https://partner.example').set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'cors');
      expect(get.status).toBe(200);
      const preflight = await request(app).options('/api/v1/admin/thing')
        .set('Origin', 'https://partner.example').set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'cors')
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.status).toBe(204);
    });

    it('refuses every spelling Express routes the same way (case, double slash, encoding)', async () => {
      const app = express();
      app.use(crossSiteGuard({}));
      const router = express.Router();
      router.get('/admin/thing', (req, res) => res.json({ ok: true }));
      app.use('/api/v1', router);
      app.get('/admin', (req, res) => res.json({ ok: true }));
      for (const path of ['/API/v1/admin/thing', '/Api/V1/admin/thing', '/api/v1/ADMIN/thing', '/ADMIN', '/api/v1/admin/thing/', '//api/v1/admin/thing', '/%61pi/v1/admin/thing']) {
        const res = await request(app).get(path).set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'no-cors').set('Sec-Fetch-Dest', 'image');
        expect(res.status, path).toBe(403);
      }
    });

    it('does not take /administrator or /apis for /admin or /api', async () => {
      for (const path of ['/administrator', '/apis']) {
        const res = await request(build()).get(path).set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'no-cors');
        expect(res.status, path).toBe(200);
      }
    });

    it('logs a read refusal with its reason', async () => {
      const calls = [];
      const logger = { sampled: (event, data) => calls.push({ event, data }) };
      await request(build({ logger })).get('/api/v1/admin/thing')
        .set('Sec-Fetch-Site', 'cross-site').set('Sec-Fetch-Mode', 'no-cors').set('Sec-Fetch-Dest', 'image');
      expect(calls).toEqual([{ event: 'security.cross-site-refused', data: expect.objectContaining({ method: 'GET', reason: 'cross-site-read', secFetchMode: 'no-cors', secFetchDest: 'image' }) }]);
    });
  });

  describe('without Sec-Fetch-Site (older browsers and WebViews)', () => {
    it('allows an Origin that names the request host', async () => {
      for (const [origin, host] of [
        [`https://${HOST}`, HOST],
        [`https://${HOST}`, `${HOST}:443`],
        ['http://localhost:3111', 'localhost:3111'],
        ['HTTP://LOCALHOST:3111', 'localhost:3111'],
      ]) {
        const res = await request(build()).post('/api/v1/admin/thing').set('Host', host).set('Origin', origin);
        expect(res.status, `${origin} -> ${host}`).toBe(200);
      }
    });

    it('refuses an Origin for another host, or another port', async () => {
      for (const origin of ['https://evil.example', 'http://localhost:3112']) {
        const res = await request(build()).post('/api/v1/admin/thing').set('Host', 'localhost:3111').set('Origin', origin);
        expect(res.status, origin).toBe(403);
      }
    });

    it('refuses the opaque origin "null" (sandboxed frame, file://)', async () => {
      const res = await request(build()).post('/api/v1/admin/thing').set('Host', HOST).set('Origin', 'null');
      expect(res.status).toBe(403);
    });

    it('honours X-Forwarded-Host only when trust proxy trusts the peer', async () => {
      // supertest connects from loopback.
      const trusted = await request(build({ trustProxy: 'loopback' })).post('/api/v1/admin/thing')
        .set('Host', 'daylight-station:3111').set('X-Forwarded-Host', HOST).set('Origin', `https://${HOST}`);
      expect(trusted.status).toBe(200);

      const untrusted = await request(build()).post('/api/v1/admin/thing')
        .set('Host', 'daylight-station:3111').set('X-Forwarded-Host', HOST).set('Origin', `https://${HOST}`);
      expect(untrusted.status).toBe(403);
    });
  });

  describe('allow-list', () => {
    it('lets a listed origin write cross-site and gives it CORS headers', async () => {
      const app = build({ allowedOrigins: ['https://Partner.example/'] });
      const res = await request(app).post('/api/v1/admin/thing')
        .set('Host', HOST).set('Origin', 'https://partner.example').set('Sec-Fetch-Site', 'cross-site').send({ a: 1 });
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://partner.example');
    });

    it('does not extend to other origins', async () => {
      const app = build({ allowedOrigins: ['https://partner.example'] });
      const res = await request(app).post('/api/v1/admin/thing')
        .set('Host', HOST).set('Origin', 'https://partner.example:8443').set('Sec-Fetch-Site', 'cross-site');
      expect(res.status).toBe(403);
    });

    it('skips entries that are not origins', () => {
      expect([...originAllowList(['nope', 'file:///x', 'https://ok.example/path', null])]).toEqual(['https://ok.example']);
    });
  });

  describe('CORS', () => {
    it('sends no Access-Control-Allow-Origin to an unlisted origin, on reads or preflights', async () => {
      const get = await request(build()).get('/api/v1/admin/thing').set('Origin', 'https://evil.example');
      expect(get.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await request(build()).options('/api/v1/admin/thing')
        .set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('logs each refusal, sampled at warn', async () => {
    const calls = [];
    const logger = { sampled: (event, data, opts) => calls.push({ event, data, opts }) };
    await request(build({ logger })).delete('/api/v1/admin/thing?secret=1')
      .set('Host', HOST).set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'cross-site');
    expect(calls).toEqual([{
      event: 'security.cross-site-refused',
      data: { method: 'DELETE', path: '/api/v1/admin/thing', origin: 'https://evil.example', secFetchSite: 'cross-site', secFetchMode: null, secFetchDest: null, reason: 'sec-fetch-site' },
      opts: { maxPerMinute: 20, aggregate: true, level: 'warn' },
    }]);
  });

  it('crossSiteRefusal and normalizeOrigin work on a bare request object', () => {
    const req = (headers, method = 'POST') => ({ method, headers, get: (n) => headers[n.toLowerCase()] });
    expect(crossSiteRefusal(req({ host: HOST, origin: 'https://evil.example' }))).toBe('origin-mismatch');
    expect(crossSiteRefusal(req({ host: HOST, 'sec-fetch-site': 'cross-site' }))).toBe('sec-fetch-site');
    expect(crossSiteRefusal(req({ host: HOST, origin: 'null' }))).toBe('origin-null');
    expect(crossSiteRefusal(req({ host: HOST }))).toBeNull();
    expect(normalizeOrigin('https://A.example:443/x')).toBe('https://a.example');
    expect(normalizeOrigin('null')).toBeNull();
  });
});

describe('webSocketOriginRefusal', () => {
  // A bare IncomingMessage, as `ws` hands it to verifyClient: headers only.
  const upgrade = (headers) => ({ method: 'GET', headers });
  const allowed = originAllowList(['https://partner.example']);

  it('accepts a client that sends no Origin (Node ws, Python websockets, native apps)', () => {
    expect(webSocketOriginRefusal(upgrade({ host: HOST }))).toBeNull();
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: '' }))).toBeNull();
  });

  it('accepts a non-web Origin: arduinoWebSockets firmware sends file://', () => {
    expect(webSocketOriginRefusal(upgrade({ host: '10.0.0.10:3111', origin: 'file://' }))).toBeNull();
  });

  it('refuses the opaque origin "null" (sandboxed frame, data: page)', () => {
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: 'null' }))).toBe('origin-null');
  });

  it('accepts the app\'s own page: Origin host equals Host', () => {
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: `https://${HOST}` }))).toBeNull();
    expect(webSocketOriginRefusal(upgrade({ host: `${HOST}:443`, origin: `https://${HOST}` }))).toBeNull();
    // Vite dev server: the /ws proxy keeps the browser's Host.
    expect(webSocketOriginRefusal(upgrade({ host: 'localhost:3111', origin: 'http://localhost:3111' }))).toBeNull();
  });

  it('honours X-Forwarded-Host only from a loopback or private peer (the reverse proxy), like trust proxy', () => {
    const proxied = (ip) => ({ ...upgrade({ host: 'daylight-station:3111', 'x-forwarded-host': HOST, origin: `https://${HOST}` }), socket: { remoteAddress: ip } });
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.5', '172.18.0.2', '192.168.1.4', 'fd00::1', 'fe80::1']) {
      expect(webSocketOriginRefusal(proxied(ip)), ip).toBeNull();
    }
    for (const ip of ['203.0.113.9', '::ffff:198.51.100.2', '2001:db8::1', undefined]) {
      expect(webSocketOriginRefusal(proxied(ip)), String(ip)).toBe('origin-mismatch');
    }
  });

  it('accepts Sec-Fetch-Site: same-origin; any other value falls through to the host match', () => {
    expect(webSocketOriginRefusal(upgrade({ host: 'daylight-station:3111', origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' }))).toBeNull();
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))).toBe('origin-mismatch');
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: 'https://other.example.test', 'sec-fetch-site': 'same-site' }))).toBe('origin-mismatch');
    // A browser that calls the app's own page same-site (scheme or alias quirks) still connects when the host matches.
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-site' }))).toBeNull();
  });

  it('refuses another site, or another port on the same host', () => {
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: 'https://evil.example' }))).toBe('origin-mismatch');
    expect(webSocketOriginRefusal(upgrade({ host: 'localhost:3111', origin: 'http://localhost:3112' }))).toBe('origin-mismatch');
  });

  it('accepts an origin on http.allowed_origins', () => {
    expect(webSocketOriginRefusal(upgrade({ host: HOST, origin: 'https://partner.example', 'sec-fetch-site': 'cross-site' }), allowed)).toBeNull();
  });
});
