/**
 * The viewed day must travel with every capture.
 *
 * The shipped defect: food added while looking at YESTERDAY landed on TODAY,
 * because no capture route accepted a date at all and every service downstream
 * computed one from the server clock. These cover the HTTP-boundary half —
 * the date is accepted, validated as a REAL calendar day (not just a regex
 * shape), and threaded to the service; an absent date still means today.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp() {
  const calls = { quickAdd: [], instantiate: [] };
  const catalogService = {
    search: async () => [], getRecent: async () => [], suggest: async () => [],
    quickAdd: async (catalogEntryId, userId, options) => {
      calls.quickAdd.push({ catalogEntryId, userId, options });
      return { uuid: 'row-1', date: options?.date ?? '2026-09-04' };
    },
  };
  const templateService = {
    instantiate: async (id, userId, options) => {
      calls.instantiate.push({ id, userId, options });
      return { groupUuid: 'g1', items: [] };
    },
    list: async () => [], mergeIntoSuggestions: async (f) => f,
  };
  const healthOperations = {
    defaultUsername: () => 'testuser',
    currentDate: () => '2026-09-04',
    nutritionInputAvailable: true,
    processNutritionInput: vi.fn(async (input) => ({ ok: true, echo: input })),
  };
  const router = createHealthRouter({ healthOperations, catalogService, templateService, logger: silent });
  const app = express();
  app.use('/api/v1/health', router);
  return { app, calls, healthOperations };
}

// The two strings a regex-only check gets wrong. `2026-08-32` is the one that
// used to become a 500 (Invalid Date -> RangeError downstream); `2026-02-31`
// is the one that used to become March 3 without anybody noticing.
const BAD_DATES = ['2026-08-32', '2026-02-31', '2026-13-01', '2026-9-3', 'yesterday', '2026-09-04T00:00:00Z'];

describe('POST /nutrition/catalog/quickadd — the viewed date', () => {
  it('threads the viewed date to the service', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/catalog/quickadd')
      .send({ catalogEntryId: 'e1', mealTime: 'evening', date: '2026-09-03' });
    expect(res.status).toBe(200);
    expect(calls.quickAdd[0].options).toEqual({ mealTime: 'evening', date: '2026-09-03' });
    expect(res.body.item.date).toBe('2026-09-03');
  });

  it('an ABSENT date still means today — the service is left to default', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/catalog/quickadd')
      .send({ catalogEntryId: 'e1' });
    expect(res.status).toBe(200);
    expect(calls.quickAdd[0].options.date).toBeUndefined();
  });

  it.each(BAD_DATES)('400s on %s and never logs the food', async (bad) => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/catalog/quickadd')
      .send({ catalogEntryId: 'e1', date: bad });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DATE_INVALID');
    expect(calls.quickAdd).toHaveLength(0);
  });
});

describe('POST /nutrition/input — the viewed date', () => {
  it('threads the viewed date to processNutritionInput', async () => {
    const { app, healthOperations } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'voice', content: 'data:audio/webm;base64,AA', bucket: 'evening', date: '2026-09-03' });
    expect(res.status).toBe(200);
    const [input] = healthOperations.processNutritionInput.mock.calls[0];
    expect(input.date).toBe('2026-09-03');
    expect(input.bucket).toBe('evening');
  });

  it('an ABSENT date reaches the pipeline as undefined, not null', async () => {
    const { app, healthOperations } = makeApp();
    await request(app).post('/api/v1/health/nutrition/input').send({ type: 'text', content: 'apple' });
    const [input] = healthOperations.processNutritionInput.mock.calls[0];
    expect(input.date).toBeUndefined();
  });

  it.each(BAD_DATES)('400s on %s and never reaches the pipeline', async (bad) => {
    const { app, healthOperations } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'text', content: 'apple', date: bad });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DATE_INVALID');
    expect(healthOperations.processNutritionInput).not.toHaveBeenCalled();
  });
});

describe('POST /nutrition/templates/:id/instantiate — a REAL calendar day', () => {
  it('still accepts a real day', async () => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/templates/t1/instantiate')
      .send({ date: '2026-09-03', mealTime: 'morning', variantNames: [] });
    expect(res.status).toBe(200);
    expect(calls.instantiate[0].options.date).toBe('2026-09-03');
  });

  // This route already took a `date`, but validated it with a bare regex — so
  // an impossible day passed the boundary and became a 500 or a wrong row.
  it.each(['2026-08-32', '2026-02-31'])('now refuses %s at the boundary', async (bad) => {
    const { app, calls } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/templates/t1/instantiate')
      .send({ date: bad, variantNames: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DATE_INVALID');
    expect(calls.instantiate).toHaveLength(0);
  });
});

// ── The retry over a saved recording (defect 2) ────────────────────────────
describe('POST /nutrition/input — retrying a saved voice memo', () => {
  it('threads a well-formed audioRef through to the pipeline', async () => {
    const { app, healthOperations } = makeApp();
    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'voice', audioRef: 'va_abc123', bucket: 'evening' });
    expect(res.status).toBe(200);
    const [input] = healthOperations.processNutritionInput.mock.calls[0];
    expect(input.audioRef).toBe('va_abc123');
  });

  it('an absent audioRef reaches the pipeline as undefined, not null', async () => {
    const { app, healthOperations } = makeApp();
    await request(app).post('/api/v1/health/nutrition/input').send({ type: 'text', content: 'apple' });
    expect(healthOperations.processNutritionInput.mock.calls[0][0].audioRef).toBeUndefined();
  });

  it.each(['../../etc/passwd', 'ph_abc', 'va_../x', 'va_', '', 'VA_abc'])(
    '400s on a malformed audioRef (%s) and never reaches the pipeline', async (bad) => {
      const { app, healthOperations } = makeApp();
      const res = await request(app)
        .post('/api/v1/health/nutrition/input')
        .send({ type: 'voice', audioRef: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUDIO_REF_INVALID');
      expect(healthOperations.processNutritionInput).not.toHaveBeenCalled();
    });

  it('a ref the store cannot find is a 404 with a sentence, NOT a 500 with an error string', async () => {
    const { app, healthOperations } = makeApp();
    healthOperations.processNutritionInput.mockImplementation(async () => {
      throw Object.assign(new Error('That recording is no longer available'), { code: 'AUDIO_NOT_FOUND' });
    });
    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'voice', audioRef: 'va_gone' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AUDIO_NOT_FOUND');
    expect(res.body.error).toMatch(/record it again/i);
  });

  it('an unexpected failure is still a 500 — the 404 must not swallow real errors', async () => {
    const { app, healthOperations } = makeApp();
    healthOperations.processNutritionInput.mockImplementation(async () => { throw new Error('kaboom'); });
    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'voice', audioRef: 'va_abc123' });
    expect(res.status).toBe(500);
  });
});
