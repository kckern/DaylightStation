// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import { parseStravaJson, stravaJsonReviver } from './stravaJson.mjs';
import { StravaClientAdapter } from '../StravaClientAdapter.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';
import yaml from 'js-yaml';

// 2^63 - 25: a plausible post-2027 Strava id. As a double it reads ...800.
const BIG = '9223372036854775783';

describe('parseStravaJson', () => {
  it('keeps an id above 2^53 as its exact digits', () => {
    const activity = parseStravaJson(`{"id":${BIG},"name":"Ride","athlete":{"id":${BIG}}}`);
    expect(activity.id).toBe(BIG);
    expect(activity.athlete.id).toBe(BIG);
  });

  it('leaves ids that fit as numbers, so stored ids still compare equal', () => {
    const activity = parseStravaJson('{"id":16843920123,"id_str":"16843920123","distance":1234.5}');
    expect(activity.id).toBe(16843920123);
    expect(activity.distance).toBe(1234.5);
  });

  it('takes the id_str twin when the number disagrees with it (no source text)', () => {
    // Simulate a runtime without reviver source access: no context argument.
    const parsed = JSON.parse(`{"id":${BIG},"id_str":"${BIG}","upload_id":${BIG},"upload_id_str":"${BIG}"}`,
      (key, value) => stravaJsonReviver(key, value, undefined));
    expect(parsed.id).toBe(BIG);
    expect(parsed.upload_id).toBe(BIG);
  });

  it('keeps a webhook object_id exact although it has no _str twin', () => {
    const event = parseStravaJson(`{"object_type":"activity","object_id":${BIG},"owner_id":${BIG},"subscription_id":1}`);
    expect(event.object_id).toBe(BIG);
    expect(event.owner_id).toBe(BIG);
  });

  it('round-trips a big id through YAML as the same string', () => {
    const { id } = parseStravaJson(`{"id":${BIG}}`);
    // saveYaml/loadYaml are js-yaml dump/load with the default schema.
    expect(yaml.load(yaml.dump({ id }, { lineWidth: -1 })).id).toBe(BIG);
  });
});

describe('Strava 64-bit ids end to end', () => {
  let server;
  afterEach(() => server?.close());

  const listen = (app) => new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  it('StravaClientAdapter returns the exact id from a live HTTP body', async () => {
    const base = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(`[{"id":${BIG},"id_str":"${BIG}","name":"Ride"}]`);
    });
    const httpClient = new HttpClient({ logger: { debug() {}, error() {} } });
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) =>
      realFetch(String(url).replace('https://www.strava.com', base), opts));
    try {
      const client = new StravaClientAdapter({ httpClient, configService: {}, logger: {} });
      client.setAccessToken('t');
      const [activity] = await client.getActivities({ before: 2, after: 1, page: 1, perPage: 100 });
      expect(activity.id).toBe(BIG);
    } finally {
      spy.mockRestore();
    }
  });

  it('the webhook route parser keeps object_id exact', async () => {
    const app = express();
    app.use('/hook', express.json({ reviver: stravaJsonReviver }));
    app.use(express.json());
    app.post('/hook', (req, res) => res.json({ id: req.body.object_id, type: typeof req.body.object_id }));
    const base = await listen(app);
    const res = await fetch(`${base}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"object_type":"activity","object_id":${BIG},"aspect_type":"create","subscription_id":1}`,
    });
    expect(await res.json()).toEqual({ id: BIG, type: 'string' });
  });
});
