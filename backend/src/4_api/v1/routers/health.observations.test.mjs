import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

// The route's job is: resolve the user itself, validate every id against an allowlist
// BEFORE a store call, and map the service's typed errors onto envelopes. The pairing
// service's own behaviour (recompute, release, cross-file refusal against the real store)
// is covered in ObservationPairingService.test.mjs.

const OBS_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const OBSERVATION = {
  id: OBS_ID,
  kind: 'weight',
  value: 82,
  unit: 'g',
  scaleId: 'kitchen-1',
  at: '2026-09-02 18:04:12',
  date: '2026-09-02',
  status: 'open',
  pairedEntryUuid: null,
};

function typedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeApp(overrides = {}) {
  const calls = { listByDate: [], pair: [], dismiss: [] };
  const observationPairing = {
    listByDate: vi.fn((userId, date) => {
      calls.listByDate.push([userId, date]);
      if (overrides.listThrows) throw overrides.listThrows;
      return overrides.rows ?? [OBSERVATION];
    }),
    pair: vi.fn(async (userId, id, entryUuid) => {
      calls.pair.push([userId, id, entryUuid]);
      if (overrides.pairThrows) throw overrides.pairThrows;
      return {
        observation: { ...OBSERVATION, status: 'consumed', pairedEntryUuid: entryUuid },
        released: overrides.released ?? [],
        recomputed: { grams: 82, amount: 82, unit: 'g' },
      };
    }),
    dismiss: vi.fn((userId, id) => {
      calls.dismiss.push([userId, id]);
      if (overrides.dismissThrows) throw overrides.dismissThrows;
      return { observation: { ...OBSERVATION, status: 'dismissed' } };
    }),
  };
  const router = createHealthRouter({
    healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-02' },
    observationPairing: overrides.observationPairing === null ? null : observationPairing,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const app = express();
  app.use('/api/v1/health', router);
  return { app, observationPairing, calls };
}

describe('GET /api/v1/health/nutrition/observations', () => {
  it('serves the requested day, with the explicit wire shape', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/observations?date=2026-09-02');

    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-09-02');
    expect(res.body.count).toBe(1);
    expect(res.body.observations[0]).toEqual(OBSERVATION);
    expect(calls.listByDate).toEqual([['testuser', '2026-09-02']]);
  });

  it('defaults to today when no date is given', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/observations');
    expect(res.status).toBe(200);
    expect(calls.listByDate).toEqual([['testuser', '2026-09-02']]);
  });

  it('rejects a malformed date with 400 BEFORE any store call', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/observations?date=notadate');
    expect(res.status).toBe(400);
    expect(calls.listByDate).toEqual([]);
  });

  it('is not mounted at all when no pairing service is configured', async () => {
    const { app } = makeApp({ observationPairing: null });
    const res = await request(app).get('/api/v1/health/nutrition/observations?date=2026-09-02');
    expect(res.status).toBe(404);
  });

  // SECURITY: the router recently had a client-supplied userId removed because it let a
  // request read another household member's data. It must never come back in any form.
  it('?userId= is completely inert — the store is always asked for the household default', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).get('/api/v1/health/nutrition/observations?date=2026-09-02&userId=otheruser');
    expect(res.status).toBe(200);
    expect(calls.listByDate).toEqual([['testuser', '2026-09-02']]);
  });

  it('a corrupt ledger is a 500, never an empty day', async () => {
    const { app } = makeApp({ listThrows: typedError('bad yaml', 'CORRUPT_OBSERVATIONS_FILE') });
    const res = await request(app).get('/api/v1/health/nutrition/observations?date=2026-09-02');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/health/nutrition/observations/:id/pair', () => {
  it('re-pairs and reports what was released', async () => {
    const { app, calls } = makeApp({ released: ['some-other-id'] });
    const res = await request(app)
      .post(`/api/v1/health/nutrition/observations/${OBS_ID}/pair`)
      .send({ entryUuid: 'entry-b' });

    expect(res.status).toBe(200);
    expect(res.body.observation.pairedEntryUuid).toBe('entry-b');
    expect(res.body.released).toEqual(['some-other-id']);
    expect(res.body.recomputed).toEqual({ grams: 82, amount: 82, unit: 'g' });
    expect(calls.pair).toEqual([['testuser', OBS_ID, 'entry-b']]);
  });

  it('an unknown observation id 404s', async () => {
    const { app } = makeApp({ pairThrows: typedError('Observation not found', 'NOT_FOUND') });
    const res = await request(app)
      .post(`/api/v1/health/nutrition/observations/${OBS_ID}/pair`)
      .send({ entryUuid: 'entry-b' });
    expect(res.status).toBe(404);
  });

  it('an unknown entry uuid 404s', async () => {
    const { app } = makeApp({ pairThrows: typedError('Food-log entry not found', 'ENTRY_NOT_FOUND') });
    const res = await request(app)
      .post(`/api/v1/health/nutrition/observations/${OBS_ID}/pair`)
      .send({ entryUuid: 'entry-b' });
    expect(res.status).toBe(404);
  });

  it('a cross-file refusal is a 409 that says nothing changed — not a 500, not a silent partial', async () => {
    const { app } = makeApp({ pairThrows: typedError('spans two files', 'CROSS_FILE_BATCH') });
    const res = await request(app)
      .post(`/api/v1/health/nutrition/observations/${OBS_ID}/pair`)
      .send({ entryUuid: 'entry-b' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CROSS_FILE_BATCH');
    expect(res.body.error).toMatch(/nothing was changed/i);
  });

  describe('ids are validated against an allowlist before any store call', () => {
    const badIds = [
      'not-a-uuid',
      '..%2F..%2Fetc%2Fpasswd',
      `${OBS_ID}%00`,
      '%2e%2e%2f%2e%2e%2fsecret',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeeee',
    ];
    for (const bad of badIds) {
      it(`rejects ${bad} with 400/404 and never calls the service`, async () => {
        const { app, calls } = makeApp();
        const res = await request(app)
          .post(`/api/v1/health/nutrition/observations/${bad}/pair`)
          .send({ entryUuid: 'entry-b' });
        expect([400, 404]).toContain(res.status);
        expect(calls.pair).toEqual([]);
      });
    }

    it('rejects a traversal-shaped entryUuid before any store call', async () => {
      const { app, calls } = makeApp();
      const res = await request(app)
        .post(`/api/v1/health/nutrition/observations/${OBS_ID}/pair`)
        .send({ entryUuid: '../../users/otheruser/nutrilist' });
      expect(res.status).toBe(400);
      expect(calls.pair).toEqual([]);
    });

    it('rejects a missing / non-string entryUuid', async () => {
      const { app, calls } = makeApp();
      for (const body of [{}, { entryUuid: 42 }, { entryUuid: '' }, { entryUuid: ['a'] }]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app)
          .post(`/api/v1/health/nutrition/observations/${OBS_ID}/pair`)
          .send(body);
        expect(res.status).toBe(400);
      }
      expect(calls.pair).toEqual([]);
    });
  });
});

describe('POST /api/v1/health/nutrition/observations/:id/dismiss', () => {
  it('dismisses and returns the resolved row', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post(`/api/v1/health/nutrition/observations/${OBS_ID}/dismiss`);

    expect(res.status).toBe(200);
    expect(res.body.observation.status).toBe('dismissed');
    expect(calls.dismiss).toEqual([['testuser', OBS_ID]]);
  });

  it('an unknown id 404s', async () => {
    const { app } = makeApp({ dismissThrows: typedError('Observation not found', 'NOT_FOUND') });
    const res = await request(app).post(`/api/v1/health/nutrition/observations/${OBS_ID}/dismiss`);
    expect(res.status).toBe(404);
  });

  it('a malformed id is rejected before any store call', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post('/api/v1/health/nutrition/observations/not-a-uuid/dismiss');
    expect(res.status).toBe(400);
    expect(calls.dismiss).toEqual([]);
  });

  it('?userId= cannot redirect the dismissal at another household member\'s ledger', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post(`/api/v1/health/nutrition/observations/${OBS_ID}/dismiss?userId=otheruser`);
    expect(res.status).toBe(200);
    expect(calls.dismiss).toEqual([['testuser', OBS_ID]]);
  });
});
