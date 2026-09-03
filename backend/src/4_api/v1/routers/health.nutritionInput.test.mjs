/**
 * POST /api/v1/health/nutrition/input — bucket parameter (Task 4.1).
 *
 * Covers the HTTP-boundary half of the meal-time precedence seam: an
 * optional `bucket` in the request body must be validated against the four
 * known meal-time ids (see NUTRITION_MEAL_BUCKETS in health.mjs, duplicated
 * from MealTimes in 2_domains/nutrition/entities/schemas.mjs — the API layer
 * may not import domains directly). A bad bucket must 400 and never reach
 * healthOperations.processNutritionInput — a phantom meal id silently
 * landing food in the wrong bucket is worse than a 400. A request with NO
 * bucket at all must behave exactly as before (backward compatibility for
 * Telegram, the coach, and the scale path, none of which send one).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

function makeApp({ processNutritionInput } = {}) {
  const healthOperations = {
    defaultUsername: () => 'testuser',
    nutritionInputAvailable: true,
    processNutritionInput: processNutritionInput || vi.fn(async (input) => ({ ok: true, echo: input })),
  };
  const router = createHealthRouter({
    healthOperations,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const app = express();
  app.use('/api/v1/health', router);
  return { app, healthOperations };
}

describe('POST /api/v1/health/nutrition/input — bucket validation', () => {
  it('with no bucket at all: behaves exactly as before (backward compatibility)', async () => {
    const { app, healthOperations } = makeApp();

    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'text', content: 'apple' });

    expect(res.status).toBe(200);
    expect(healthOperations.processNutritionInput).toHaveBeenCalledTimes(1);
    const [input] = healthOperations.processNutritionInput.mock.calls[0];
    expect(input).toEqual({ type: 'text', content: 'apple', userId: 'testuser', bucket: undefined });
  });

  it('with a valid bucket: threads it through to processNutritionInput', async () => {
    const { app, healthOperations } = makeApp();

    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'text', content: 'apple', bucket: 'evening' });

    expect(res.status).toBe(200);
    const [input] = healthOperations.processNutritionInput.mock.calls[0];
    expect(input.bucket).toBe('evening');
  });

  it('with an invalid bucket: 400s and never calls processNutritionInput', async () => {
    const { app, healthOperations } = makeApp();

    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'text', content: 'apple', bucket: 'brunch' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid bucket/i);
    expect(healthOperations.processNutritionInput).not.toHaveBeenCalled();
  });

  it('with an explicit null bucket: treated as not provided, no 400', async () => {
    const { app, healthOperations } = makeApp();

    const res = await request(app)
      .post('/api/v1/health/nutrition/input')
      .send({ type: 'text', content: 'apple', bucket: null });

    expect(res.status).toBe(200);
    expect(healthOperations.processNutritionInput).toHaveBeenCalledTimes(1);
  });
});
