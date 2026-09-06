import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '#api/v1/routers/health.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';

function buildApp(overrides = {}) {
  const items = overrides.items || [];
  const nutritionItems = {
    findByDate: vi.fn(async (userId, date) => items.filter(item => item.userId === userId && item.date === date)),
    findByUuid: vi.fn(async (userId, id) => items.find(item => item.userId === userId && item.uuid === id) || null),
    saveMany: vi.fn(async records => { items.push(...records); }),
    update: vi.fn(async (userId, id, changes) => ({ ...items.find(item => item.uuid === id), ...changes })),
    deleteById: vi.fn(async () => true),
  };
  const healthData = {
    loadWeightData: vi.fn(async () => ({ '2026-08-28': { weight: 170 } })),
    loadActivityData: vi.fn(async () => ({ '2026-08-28': [{ title: 'Walk' }] })),
    loadFitnessData: vi.fn(async () => ({ source: 'fitness' })),
    loadNutritionData: vi.fn(async () => ({ calories: 1200 })),
    loadCoachingData: vi.fn(async () => ({ message: 'Steady' })),
  };
  const personalContext = overrides.personalContext || {
    loadPlaybook: vi.fn(async () => ({ coaching_dimensions: [{ id: 'sleep' }] })),
  };
  const setDailyCoaching = overrides.setDailyCoaching || { execute: vi.fn(async () => undefined) };
  const nutritionInput = overrides.nutritionInput || {
    process: vi.fn(async input => ({ accepted: true, input })),
    processCallback: vi.fn(async input => ({ handled: true, input })),
  };
  const healthOperations = new HealthOperations({
    healthData,
    nutritionItems,
    personalContext,
    setDailyCoaching,
    nutritionInput,
    resolveDefaultUsername: () => 'alex',
    resolveCoachingUsername: () => 'alex',
    today: () => '2026-08-28',
    newId: () => 'fixed-id',
  });
  const app = express();
  app.use('/health', createHealthRouter({
    healthOperations,
    healthService: {},
    cleanupProvider: () => overrides.cleanup,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return { app, healthData, nutritionItems, personalContext, setDailyCoaching, nutritionInput };
}

describe('health HTTP contract through application operations', () => {
  it('keeps selective recovery owner-bound and preserves preview/version controls', async () => {
    const recover = vi.fn(async () => ({ dryRun: true, receipt: { after: [] } }));
    const { app } = buildApp({ cleanup: { recovery: { recover } } });
    const body = { userId: 'someone-else', logUuid: 'capture', expectedVersion: 'v1', operationId: 'repair', observationIds: ['weight', 'density'], dryRun: true };
    expect((await request(app).post('/health/nutrition/capture-recovery').send(body)).status).toBe(200);
    expect(recover).toHaveBeenCalledWith({ ...body, userId: 'alex' });
    recover.mockRejectedValue(Object.assign(new Error('Capture changed'), { status: 409 }));
    expect((await request(app).post('/health/nutrition/capture-recovery').send(body)).status).toBe(409);
  });
  it('exposes cleanup controls with server-owned identity and rejects unavailable service', async () => {
    const cleanup = { status: vi.fn(() => ({ questions: [], runs: [] })), history: vi.fn(async () => ({ records: [], total: 0 })),
      request: vi.fn(async () => ({ runId: 'one' })), settings: vi.fn(async () => ({})),
      interactions: { answer: vi.fn(async () => ({ status: 'resolved' })) }, repairs: { undo: vi.fn(async () => ({})) } };
    const { app } = buildApp({ cleanup });
    expect((await request(app).get('/health/nutrition/cleanup?userId=bob')).status).toBe(200);
    expect(cleanup.status).toHaveBeenCalledWith('alex');
    expect((await request(app).get('/health/nutrition/cleanup/history?offset=-1')).status).toBe(400);
    expect((await request(app).post('/health/nutrition/cleanup/run')).status).toBe(202);
    expect(cleanup.request).toHaveBeenCalledWith('alex', { manual: true });
    await request(app).post('/health/nutrition/cleanup/questions/q1/answer').send({ userId: 'bob', expectedVersion: 1, operationId: 'one', text: 'Cod' });
    expect(cleanup.interactions.answer).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alex', id: 'q1', text: 'Cod' }));
    expect((await request(buildApp().app).get('/health/nutrition/cleanup')).status).toBe(503);
  });
  it('projects pending versions and routes review commands with server-owned user identity', async () => {
    const nutritionInput = {
      process: vi.fn(), processCallback: vi.fn(),
      listPendingByDate: vi.fn(async () => [{ id: 'capture', items: [], status: 'pending',
        meal: { date: '2026-08-28', time: 'afternoon' }, conversationId: 'device:alex' }]),
      reviewPending: vi.fn(async () => ({ success: true })),
    };
    const { app } = buildApp({ nutritionInput });
    const response = await request(app).get('/health/nutrition/pending?date=2026-08-28');
    const pending = response.body.pending[0];
    expect(pending).toMatchObject({ id: 'capture', source: 'scanner', date: '2026-08-28' });
    expect(pending.version).toMatch(/^[a-f0-9]{64}$/);
    expect((await request(app).post('/health/nutrition/pending/capture/review').send({ action: 'confirm' })).status).toBe(400);
    const body = { expectedVersion: pending.version, operationId: 'one', action: 'confirm', userId: 'someone-else' };
    expect((await request(app).post('/health/nutrition/pending/capture/review').send(body)).status).toBe(200);
    expect(nutritionInput.reviewPending).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alex', logUuid: 'capture', operationId: 'one' }));
    nutritionInput.reviewPending.mockRejectedValue(Object.assign(new Error('Reload review'), { status: 409 }));
    expect((await request(app).post('/health/nutrition/pending/capture/review').send(body)).status).toBe(409);
  });
  it('keeps legacy raw weight and wrapped workout shapes distinct', async () => {
    const { app } = buildApp();
    const weight = await request(app).get('/health/weight');
    const workouts = await request(app).get('/health/workouts');
    expect(weight.status).toBe(200);
    expect(weight.body).toEqual({ '2026-08-28': { weight: 170 } });
    expect(workouts.body).toEqual({
      message: 'Workout data retrieved successfully',
      data: { '2026-08-28': [{ title: 'Walk' }] },
    });
  });

  it('keeps coaching schema and save envelopes unchanged', async () => {
    const { app, setDailyCoaching } = buildApp();
    const schema = await request(app).get('/health/coaching/schema');
    const saved = await request(app).post('/health/coaching/2026-08-28').send({ sleep: true });
    expect(schema.body).toEqual({ coaching_dimensions: [{ id: 'sleep' }] });
    expect(saved.body).toEqual({ message: 'coaching saved', date: '2026-08-28' });
    expect(setDailyCoaching.execute).toHaveBeenCalledWith({
      userId: 'alex', date: '2026-08-28', coaching: { sleep: true },
    });
  });

  it('preserves coaching validation precedence before the command', async () => {
    const { app, setDailyCoaching } = buildApp();
    const response = await request(app).post('/health/coaching/not-a-date').send({ sleep: true });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid date: not-a-date' });
    expect(setDailyCoaching.execute).not.toHaveBeenCalled();
  });

  it('creates a nutrilist item with the exact legacy defaults and envelope', async () => {
    const { app, nutritionItems } = buildApp();
    const response = await request(app).post('/health/nutrilist').send({ name: 'Banana' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      message: 'Nutrilist item created successfully',
      data: {
        uuid: 'fixed-id', userId: 'alex', item: 'Banana', name: 'Banana',
        unit: 'g', amount: 0, grams: null, color: 'yellow', noom_color: 'yellow',
        date: '2026-08-28', log_uuid: 'MANUAL',
      },
    });
    expect(nutritionItems.saveMany).toHaveBeenCalledTimes(1);
  });

  it('filters nutrilist update fields and preserves the response envelope', async () => {
    const items = [{ uuid: 'n1', userId: 'alex', date: '2026-08-28', item: 'Apple' }];
    const { app, nutritionItems } = buildApp({ items });
    const response = await request(app).put('/health/nutrilist/n1').send({ calories: 90, forbidden: true });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Nutrilist item updated successfully');
    // An ordinary edit no longer SETTLES the row (f81b295ae): settling is a
    // server-owned lifecycle step that only an explicit `{ settled: true }`
    // command performs, because stamping every edit certified figures nobody
    // had looked at. What an edit does instead is PROTECT the field it
    // touched — `manualFields` names it, so later polling/review may keep
    // enriching the untouched fields without overwriting a human correction.
    expect(nutritionItems.update).toHaveBeenCalledWith('alex', 'n1', expect.objectContaining({
      calories: 90,
      manualFields: ['calories'],
    }));
    // ...and it must NOT settle: the stamp is the one-tap confirm's to write.
    const [, , sent] = nutritionItems.update.mock.calls[0];
    expect(sent).not.toHaveProperty('settled');
    expect(sent).not.toHaveProperty('settledBy');
    // The field whitelist must still reject unknown fields — `forbidden` was
    // never sent to the store, protected field or no.
    const [, , updateArgs] = nutritionItems.update.mock.calls[0];
    expect(updateArgs).not.toHaveProperty('forbidden');
  });

  it('retains nutrition-input validation ahead of the capability call', async () => {
    const { app, nutritionInput } = buildApp();
    const response = await request(app).post('/health/nutrition/input').send({ content: 'banana' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'type is required (text, voice, image, barcode)' });
    expect(nutritionInput.process).not.toHaveBeenCalled();
  });
});
