import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHealthRouter } from './health.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { FoodCatalogService } from '#apps/health/FoodCatalogService.mjs';
import { randomUUID } from 'node:crypto';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
let app, store;
const food = extra => ({ uuid: 'a', userId: 'fixture', name: 'Food', date: '2020-01-01', mealTime: 'morning',
  grams: 100, calories: 200, fiber: 5, sodium: 300, photoRef: 'photo-1', nutrientProvenance: { fiber: { source: 'ai' } }, ...extra });

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-http-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger });
  const catalogStore = new YamlFoodCatalogDatastore({ dataService: { user: { resolvePath: rel => path.join(root, `${rel}.yml`) } }, logger });
  const catalogService = new FoodCatalogService({ catalogStore, nutriListStore: store, logger,
    clock: { now: () => Date.parse('2026-09-04T12:00:00Z') }, createId: randomUUID });
  const operations = new HealthOperations({ nutritionItems: store, resolveDefaultUsername: () => 'fixture', today: () => '2026-09-04' });
  app = express();
  app.use('/api/v1/health', createHealthRouter({ healthOperations: operations, catalogService, logger,
    budgetService: { getBudget: async (user, date, { items }) => ({ food: items.reduce((sum, row) => sum + row.calories, 0) }) },
  }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
});

describe('HTTP → real health ledger contracts', () => {
  it('keeps favorite identity after a rename without rewriting historical snapshots or affecting a reused name', async () => {
    const original = await request(app).post('/api/v1/health/nutrition/catalog').send({ name: 'Oats', grams: 80, calories: 300 });
    expect(original.status).toBe(200);
    const id = original.body.entry.id;
    const logged = await request(app).post('/api/v1/health/nutrition/catalog/quickadd').send({ catalogEntryId: id, date: '2026-09-04', mealTime: 'morning', operationId: 'oats-first' });
    expect(logged.status).toBe(200);
    const renamed = await request(app).put(`/api/v1/health/nutrition/catalog/${id}`).send({ name: 'Rolled oats', grams: 80, nutrients: { calories: 300 } });
    expect(renamed.status).toBe(200);
    const reused = await request(app).post('/api/v1/health/nutrition/catalog').send({ name: 'Oats', grams: 50, calories: 200 });
    expect(reused.status).toBe(200);
    expect(reused.body.entry.id).not.toBe(id);
    const favorite = await request(app).put('/api/v1/health/nutrition/catalog/favorite').send({ id, favorite: true });
    expect(favorite.status).toBe(200);
    const saved = await request(app).get(`/api/v1/health/nutrition/catalog/${id}`);
    expect(saved.status).toBe(200);
    expect(saved.body.entry).toMatchObject({ id, name: 'Rolled oats', favorite: true });
    const other = await request(app).get(`/api/v1/health/nutrition/catalog/${reused.body.entry.id}`);
    expect(other.status).toBe(200);
    expect(other.body.entry.favorite).toBe(false);
    expect(await store.findByDate('fixture', '2026-09-04')).toEqual([expect.objectContaining({ foodId: id, name: 'Oats', grams: 80, calories: 300 })]);
    const removed = await request(app).delete(`/api/v1/health/nutrition/catalog/${id}`);
    expect(removed.status).toBe(200);
    expect((await request(app).get(`/api/v1/health/nutrition/catalog/${id}`)).status).toBe(404);
    expect(await store.findByDate('fixture', '2026-09-04')).toHaveLength(1);
  });

  it('edits archived groups atomically and returns all affected IDs and dates', async () => {
    await store.saveMany([food({ uuid: 'group', kind: 'group', calories: 0 }), food({ parentId: 'group' })]);
    await store.archiveOldItems('fixture');
    const res = await request(app).put('/api/v1/health/nutrilist/group').send({ date: '2026-09-04', mealTime: 'evening', factor: 2, expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.cascadedIds).toEqual(['a']);
    expect(new Set(res.body.affectedDates)).toEqual(new Set(['2020-01-01', '2026-09-04']));
    expect(await store.findByUuid('fixture', 'a')).toMatchObject({ date: '2026-09-04', mealTime: 'evening', calories: 400, fiber: 10, sodium: 600 });
    const snapshot = await request(app).get('/api/v1/health/day?date=2026-09-04');
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.items).toHaveLength(2);
    expect(snapshot.body.budget.food).toBe(400);
    expect(snapshot.body.revision).toBeGreaterThan(0);
  });

  it('returns a conflict without changing an entry if its version is stale', async () => {
    await store.saveMany([food()]);
    const res = await request(app).put('/api/v1/health/nutrilist/a').send({ grams: 200, expectedVersion: 99 });
    expect(res.status).toBe(409);
    expect((await store.findByUuid('fixture', 'a')).grams).toBe(100);
  });

  it('delete → Undo restores the exact snapshot, including micro provenance', async () => {
    await store.saveMany([food()]);
    const res = await request(app).delete('/api/v1/health/nutrilist/a');
    expect(res.status).toBe(200);
    expect(res.body.affectedIds).toEqual(['a']);
    const restored = await request(app).post('/api/v1/health/nutrition/restore').send({ entryIds: res.body.affectedIds });
    expect(restored.status).toBe(200);
    expect(restored.body.items[0]).toMatchObject({ grams: 100, calories: 200, fiber: 5, photoRef: 'photo-1', nutrientProvenance: { fiber: { source: 'ai' } } });
  });

  it('copy is lossless, repeat-safe, and rejects reused IDs with different destinations', async () => {
    await store.saveMany([food()]);
    const body = { entryIds: ['a'], date: '2026-09-04', mealTime: 'morning', operationId: 'copy-a' };
    const first = await request(app).post('/api/v1/health/nutrition/copy').send(body);
    expect(first.status).toBe(200);
    const repeat = await request(app).post('/api/v1/health/nutrition/copy').send(body);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(first.body);
    expect(await store.findByDate('fixture', body.date)).toHaveLength(1);
    expect(first.body.items[0]).toMatchObject({ grams: 100, fiber: 5, sodium: 300, copiedFrom: 'a', photoRef: 'photo-1' });
    const conflict = await request(app).post('/api/v1/health/nutrition/copy').send({ ...body, date: '2026-09-03' });
    expect(conflict.status).toBe(409);
  });
});
