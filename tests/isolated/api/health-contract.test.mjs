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
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return { app, healthData, nutritionItems, personalContext, setDailyCoaching, nutritionInput };
}

describe('health HTTP contract through application operations', () => {
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
        unit: 'g', amount: 0, grams: 0, color: 'yellow', noom_color: 'yellow',
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
    expect(nutritionItems.update).toHaveBeenCalledWith('alex', 'n1', { calories: 90 });
  });

  it('retains nutrition-input validation ahead of the capability call', async () => {
    const { app, nutritionInput } = buildApp();
    const response = await request(app).post('/health/nutrition/input').send({ content: 'banana' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'type is required (text, voice, image, barcode)' });
    expect(nutritionInput.process).not.toHaveBeenCalled();
  });
});
