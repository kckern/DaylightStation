import { describe, it, expect } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { crossSiteGuard, crossSiteRefusal, corsOptionsFor, originAllowList, normalizeOrigin } from './crossSiteGuard.mjs';

function build({ allowedOrigins = [], trustProxy = null, logger = null } = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  const allowed = originAllowList(allowedOrigins);
  app.use(crossSiteGuard({ allowedOrigins: allowed, logger }));
  app.use(cors(corsOptionsFor(allowed)));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.all('/api/v1/admin/thing', (req, res) => res.json({ ok: true }));
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

  it('leaves GET and HEAD alone, even cross-site', async () => {
    const get = await request(build()).get('/api/v1/admin/thing')
      .set('Host', HOST).set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'cross-site');
    expect(get.status).toBe(200);
    const head = await request(build()).head('/api/v1/admin/thing').set('Sec-Fetch-Site', 'cross-site');
    expect(head.status).toBe(200);
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
      data: { method: 'DELETE', path: '/api/v1/admin/thing', origin: 'https://evil.example', secFetchSite: 'cross-site', reason: 'sec-fetch-site' },
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
