/**
 * The direct-input routes behind their guard: /upc, /image and the earlier
 * shape of /text. Each real caller's request is reproduced as the
 * caller sends it (see the runbooks named beside each), and each kind of
 * stranger is refused. The use cases behind the routes are fakes; the guard,
 * the handlers, the access rules, the ledger and the router are real.
 *
 * The app under test has no app-wide body parser or CORS handler, as the real
 * app has none on these paths (app.mjs `exceptPaths`).
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createNutribotRouter } from './nutribot.mjs';
import { NutribotDirectInput } from '../../application/services/NutribotDirectInput.mjs';
import { QuickInputLedger } from '../../../../../../__capabilities/quick-input/server/public.mjs';

const nullLogger = { debug() {}, info() {}, warn() {}, error() {} };
const BASE = '/api/v1/nutribot';

function capturingLogger() {
  const events = [];
  const at = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

function build({ unbound = {}, limits, logger = nullLogger, sessionUser = null, withAccess = true,
  devices = { 'kitchen-tablet': { quick_input: { nutribot: ['user_1', 'user_2'] } }, 'hall-tv': { quick_input: { journalist: ['user_1'] } } } } = {}) {
  const calls = { upc: [], image: [], text: [] };
  const files = new Map();
  const ledger = new QuickInputLedger({
    limits,
    store: {
      read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
      write: (username, data) => { files.set(username, structuredClone(data)); return true; },
    },
  });
  const nutribotApi = {
    // The handlers no longer ask this for a default user on these routes.
    userContext: () => { throw new Error('the head-of-household default must not be used'); },
    logUpc: async (command) => { calls.upc.push(command); return { success: true, product: { name: 'Cheerios' } }; },
    logImage: async (command) => { calls.image.push(command); return { success: true, itemCount: 3 }; },
    logText: async (command) => { calls.text.push(command); return { success: true }; },
    report: async () => ({}),
  };
  const directInput = new NutribotDirectInput({
    ledger,
    deviceConfig: (key) => devices[key],
    unboundUsers: (route) => unbound[route],
    resolveIdentity: (username) => {
      if (!['user_1', 'user_2'].includes(username)) throw new Error('no such user');
      return { username, conversationIdString: `telegram:b9_c${username.at(-1)}` };
    },
    operations: { upc: nutribotApi.logUpc, image: nutribotApi.logImage, text: nutribotApi.logText },
    logger,
  });
  const app = express();
  // Stands in for the token resolver: a request with a valid session has req.user.
  app.use((req, res, next) => { if (sessionUser && req.get('Cookie')) req.user = { sub: sessionUser }; next(); });
  app.use(BASE, createNutribotRouter(nutribotApi, { logger, ...(withAccess ? { directInput } : {}) }));
  return { app, calls, ledger };
}

const DEVICE = { 'X-Daylight-Device': 'fleet:kitchen-tablet' };

describe('GET /upc as the barcode app sends it (runbooks/binary-eye-nutribot-upc-scanning.md)', () => {
  // The app appends the scan to the configured URL as a bare query key and sends no header of its own.
  it('logs for the user the open route lists when the URL names none', async () => {
    const { app, calls } = build({ unbound: { upc: ['user_1'] } });
    const res = await request(app).get(`${BASE}/upc?0643843714477`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, result: { success: true, product: { name: 'Cheerios' } } });
    expect(typeof res.body.durationMs).toBe('number');
    expect(calls.upc).toEqual([{ userId: 'user_1', conversationId: 'telegram:b9_c1', upc: '0643843714477', messageId: null }]);
  });

  it('logs for the member the URL names, when the open route lists them', async () => {
    const { app, calls } = build({ unbound: { upc: ['user_1', 'user_2'] } });
    const res = await request(app).get(`${BASE}/upc?member=user_2&0643843714477`);
    expect(res.status).toBe(200);
    expect(calls.upc[0]).toMatchObject({ userId: 'user_2', conversationId: 'telegram:b9_c2', upc: '0643843714477' });
    expect((await request(app).get(`${BASE}/upc?member=user_9&0643843714477`)).status).toBe(403);
  });

  it('still takes the documented test shapes: ?upc= and the leftover %s template', async () => {
    const { app, calls } = build({ unbound: { upc: ['user_1'] } });
    expect((await request(app).get(`${BASE}/upc?upc=016000275287`)).status).toBe(200);
    expect((await request(app).get(`${BASE}/upc?upc=%25s0049000000450`)).status).toBe(200);
    expect(calls.upc.map((c) => c.upc)).toEqual(['016000275287', '0049000000450']);
  });

  it('is refused when the household has not opened the route', async () => {
    const { app, calls } = build();
    const res = await request(app).get(`${BASE}/upc?0643843714477`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ ok: false, error: 'device_not_allowed' });
    expect(calls.upc).toHaveLength(0);
  });
});

describe('the retired IFTTT image route (2026-11-17)', () => {
  it('GET /pinhole is gone: 404 even with the old setting still in place, and nothing is logged', async () => {
    const { app, calls } = build({ unbound: { pinhole: ['user_1'] } });
    const res = await request(app).get(`${BASE}/pinhole?img_url=${encodeURIComponent('https://images.example/a.jpg')}`);
    expect(res.status).toBe(404);
    expect(calls.image).toHaveLength(0);
  });
});

describe('a bound device (integrations/barcode-processing.md: the direct API)', () => {
  it('POST /upc with a JSON body, naming a user it is bound to', async () => {
    const { app, calls } = build();
    const res = await request(app).post(`${BASE}/upc`).set(DEVICE).send({ user: 'user_2', upc: '749826002019' });
    expect(res.status).toBe(200);
    expect(calls.upc[0]).toMatchObject({ userId: 'user_2', upc: '749826002019' });
  });

  it('GET /upc with query parameters', async () => {
    const { app, calls } = build();
    expect((await request(app).get(`${BASE}/upc?user=user_1&upc=749826002019`).set(DEVICE)).status).toBe(200);
    expect(calls.upc[0]).toMatchObject({ userId: 'user_1', upc: '749826002019' });
  });

  it('the earlier /text in each of its shapes: JSON, a form and a query string', async () => {
    const { app, calls } = build();
    expect((await request(app).post(`${BASE}/text`).set(DEVICE).send({ text: 'an apple', user: 'user_1' })).status).toBe(200);
    expect((await request(app).post(`${BASE}/text`).set(DEVICE).type('form').send({ text: 'a pear', user: 'user_1' })).status).toBe(200);
    expect((await request(app).get(`${BASE}/text`).set(DEVICE).query({ text: 'a plum', date: '2026-11-16', user: 'user_2' })).status).toBe(200);
    expect(calls.text.map((c) => [c.userId, c.text, c.date])).toEqual([
      ['user_1', 'an apple', undefined], ['user_1', 'a pear', undefined], ['user_2', 'a plum', '2026-11-16'],
    ]);
  });

  it('/image with an image URL', async () => {
    const { app, calls } = build();
    const res = await request(app).post(`${BASE}/image`).set(DEVICE).send({ img_url: 'https://images.example/a.jpg', user: 'user_1' });
    expect(res.status).toBe(200);
    expect(calls.image[0].imageData).toEqual({ url: 'https://images.example/a.jpg' });
  });

  it('must name the user, and only one it is bound to', async () => {
    const { app, calls } = build();
    const unnamed = await request(app).post(`${BASE}/upc`).set(DEVICE).send({ upc: '749826002019' });
    expect(unnamed.status).toBe(400);
    expect(unnamed.body.error).toBe('user_required');
    const other = await request(app).post(`${BASE}/upc`).set(DEVICE).send({ upc: '749826002019', user: 'user_3' });
    expect(other.status).toBe(403);
    expect(calls.upc).toHaveLength(0);
  });

  it('keeps the handlers\' own refusals', async () => {
    const { app } = build();
    const missing = await request(app).post(`${BASE}/upc`).set(DEVICE).send({ user: 'user_1' });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('Missing required parameter: upc');
    const noText = await request(app).post(`${BASE}/text`).set(DEVICE).send({ user: 'user_1' });
    expect(noText.body.error).toBe('Missing required parameter: text');
  });
});

describe('a signed-in user of the web app', () => {
  it('may use a route for themselves, from the app\'s own origin, with the app\'s header', async () => {
    const { app, calls } = build({ sessionUser: 'user_1' });
    const res = await request(app).post(`${BASE}/text`)
      .set('Host', 'station.example').set('Origin', 'https://station.example')
      .set('Cookie', 'daylight_session=x').set('X-Daylight-Device', 'browser:abc123')
      .send({ text: 'an apple' });
    expect(res.status).toBe(200);
    expect(calls.text[0]).toMatchObject({ userId: 'user_1', text: 'an apple' });
  });

  it('may not act for someone else, or with the cookie alone', async () => {
    const { app, calls } = build({ sessionUser: 'user_1' });
    const forOther = await request(app).post(`${BASE}/text`).set('Cookie', 'daylight_session=x')
      .set('X-Daylight-Device', 'browser:abc123').send({ text: 'an apple', user: 'user_2' });
    expect(forOther.status).toBe(403);
    // A link on another site: the cookie rides along, the header cannot.
    const navigation = await request(app).get(`${BASE}/text?text=an%20apple`).set('Cookie', 'daylight_session=x');
    expect(navigation.status).toBe(403);
    expect(calls.text).toHaveLength(0);
  });
});

describe('every direct-input route refuses a stranger', () => {
  const requests = {
    upc: (app) => request(app).post(`${BASE}/upc`).send({ upc: '749826002019', user: 'user_1' }),
    image: (app) => request(app).post(`${BASE}/image`).send({ img_url: 'https://images.example/a.jpg', user: 'user_1' }),
    text: (app) => request(app).post(`${BASE}/text`).send({ text: 'an apple', user: 'user_1' }),
  };

  for (const [route, send] of Object.entries(requests)) {
    it(`${route}: no device, an unbound device, a device bound for another bot, a browser id`, async () => {
      const { app, calls } = build();
      for (const device of [null, 'fleet:unknown', 'fleet:hall-tv', 'browser:abc123']) {
        const res = await (device ? send(app).set('X-Daylight-Device', device) : send(app));
        expect(res.status, String(device)).toBe(403);
        expect(res.body).toMatchObject({ ok: false, error: 'device_not_allowed' });
      }
      expect(calls.upc.length + calls.image.length + calls.text.length).toBe(0);
    });

    it(`${route}: a request or preflight from another origin, even from a bound device or on an open route`, async () => {
      const { app, calls } = build({ unbound: { upc: ['user_1'], image: ['user_1'], text: ['user_1'] } });
      const crossOrigin = await send(app).set(DEVICE).set('Origin', 'https://elsewhere.example');
      expect(crossOrigin.status).toBe(403);
      expect(crossOrigin.body.error).toBe('cross_origin');
      expect(crossOrigin.headers['access-control-allow-origin']).toBeUndefined();
      // An image tag or a link on another site: no Origin, but the browser says where it came from.
      for (const site of ['cross-site', 'same-site']) {
        expect((await send(app).set('Sec-Fetch-Site', site)).body.error).toBe('cross_origin');
      }
      const preflight = await request(app).options(`${BASE}/${route}`)
        .set('Origin', 'https://elsewhere.example').set('Access-Control-Request-Method', 'POST');
      expect(preflight.status).toBe(403);
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      expect(calls.upc.length + calls.image.length + calls.text.length).toBe(0);
    });

    it(`${route}: a user with no Nutribot conversation`, async () => {
      const { app } = build({ devices: { 'kitchen-tablet': { quick_input: { nutribot: ['user_9'] } } } });
      const res = await request(app).get(`${BASE}/${route}`).set(DEVICE).query({ user: 'user_9', upc: '749826002019', text: 'x', img_url: 'https://images.example/a.jpg' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('unknown_user');
    });
  }

  it('with no access rules wired at all, every route is refused', async () => {
    const { app } = build({ withAccess: false });
    for (const send of Object.values(requests)) {
      expect((await send(app).set(DEVICE)).status).toBe(403);
    }
  });

  it('a body over 64 KB is refused before it is read', async () => {
    const { app } = build();
    const res = await request(app).post(`${BASE}/text`).set(DEVICE).send({ user: 'user_1', text: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ ok: false, error: 'too_large', maxBytes: 65536 });
  });
});

describe('the daily allowance and once-only processing', () => {
  it('these routes spend the same Nutribot day, for a device and on an open route alike', async () => {
    const { app, calls, ledger } = build({ limits: { inputs: 2 }, unbound: { upc: ['user_1'] } });
    expect((await request(app).get(`${BASE}/upc?0643843714477`)).status).toBe(200);
    expect((await request(app).post(`${BASE}/text`).set(DEVICE).send({ text: 'an apple', user: 'user_1' })).status).toBe(200);
    const refused = await request(app).get(`${BASE}/upc?0643843714477`);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ ok: false, error: 'daily_limit', limit: 'inputs' });
    expect(refused.headers['retry-after']).toBe(String(refused.body.retryAfterSeconds));
    expect(calls.upc).toHaveLength(1);
    expect(ledger.usage('user_1')).toMatchObject({ inputs: 2 });
    // Another user's day is their own.
    expect((await request(app).post(`${BASE}/text`).set(DEVICE).send({ text: 'a pear', user: 'user_2' })).status).toBe(200);
  });

  it('a caller that sends an input id is processed once for it; one that sends none is not deduplicated', async () => {
    const { app, calls } = build();
    const scan = () => request(app).post(`${BASE}/upc`).set(DEVICE).set('X-Daylight-Input-Id', 'scan-1').send({ upc: '749826002019', user: 'user_1' });
    expect((await scan()).body).toMatchObject({ ok: true, result: { success: true } });
    expect((await scan()).body).toEqual({ ok: true, duplicate: true });
    expect(calls.upc).toHaveLength(1);
    const plain = () => request(app).post(`${BASE}/upc`).set(DEVICE).send({ upc: '749826002019', user: 'user_1' });
    await plain();
    await plain();
    expect(calls.upc).toHaveLength(3);
    const bad = await request(app).post(`${BASE}/upc`).set(DEVICE).set('X-Daylight-Input-Id', 'bad id').send({ upc: '749826002019', user: 'user_1' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_input_id');
  });
});

describe('what the guard logs', () => {
  it('a refusal by its reason, route and caller, and never the text or the image address', async () => {
    const logger = capturingLogger();
    const { app } = build({ logger });
    await request(app).post(`${BASE}/text`).send({ text: 'two eggs and a slice of sourdough toast', user: 'user_1' });
    await request(app).post(`${BASE}/text`).set(DEVICE).send({ text: 'two eggs and a slice of sourdough toast', user: 'user_1' });
    const refused = logger.events.find((e) => e.event === 'nutribot.direct.rejected');
    expect(refused.data).toMatchObject({ route: 'text', reason: 'device_not_allowed', status: 403 });
    expect(logger.events.some((e) => e.event === 'nutribot.direct.admitted' && e.data.via === 'device')).toBe(true);
    expect(JSON.stringify(logger.events)).not.toContain('sourdough');
  });
});
