import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHealthRouter } from './health.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const userId = 'fixture';
const date = '2026-09-05';
let directory, app, store, operations;
const put = body => request(app).put('/api/v1/health/nutrilist/group').send(body);
const adjustment = () => ({ operationId: 'adjust-once', adjustment: { field: 'calories', value: 450 },
  expectedVersion: 1, expectedVersions: { group: 1, a: 1, b: 1 }, expectedDensityRevision: operations.context().densityRevision });
const restore = () => ({ operationId: 'restore-once', restoreAdjustment: [
  { id: 'group', changes: {} }, { id: 'a', changes: { calories: 100 } }, { id: 'b', changes: { calories: 200 } },
], expectedVersion: 1, expectedVersions: { group: 1, a: 2, b: 2 } });

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'health-adjustment-http-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(directory, rel) } }, logger });
  await store.saveMany([{ uuid: 'group', kind: 'group', calories: 0 },
    { uuid: 'a', parentId: 'group', calories: 100 }, { uuid: 'b', parentId: 'group', calories: 200 }]
    .map(row => ({ userId, date, grams: 100, protein: null, settled: false, version: 1, ...row })));
  operations = new HealthOperations({ nutritionItems: store, resolveDefaultUsername: () => userId, today: () => date });
  app = express();
  app.use('/api/v1/health', createHealthRouter({ healthOperations: operations, logger }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('Health PUT adjustment and restore transport', () => {
  it('saves and restores through the existing route, replaying both original responses', async () => {
    const body = adjustment();
    const saved = await put(body);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ data: { uuid: 'group', calories: 0 }, versions: { group: 1, a: 2, b: 2 },
      cascadedIds: ['a', 'b'], affectedIds: ['group', 'a', 'b'], affectedDates: [date] });
    const undoBody = restore();
    const undone = await put(undoBody);
    expect(undone.status).toBe(200);
    expect(undone.body.versions).toEqual({ group: 1, a: 3, b: 3 });
    expect((await put(body)).body).toEqual(saved.body);
    expect((await put(undoBody)).body).toEqual(undone.body);
    expect(await store.findByUuid(userId, 'a')).toMatchObject({ calories: 100, grams: 100, version: 3, settled: false });
  });

  it.each(['adjustment', 'restore'])('recovers %s after a committed response is lost', async type => {
    if (type === 'restore') expect((await put(adjustment())).status).toBe(200);
    const body = type === 'adjustment' ? adjustment() : restore();
    const update = operations.updateNutritionItem.bind(operations);
    let committed;
    vi.spyOn(operations, 'updateNutritionItem').mockImplementationOnce(async (...args) => {
      committed = await update(...args);
      throw new Error('response lost');
    });
    expect((await put(body)).status).toBe(500);
    const recovered = await put(body);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ data: JSON.parse(JSON.stringify(committed.item)), versions: committed.versions,
      cascadedIds: committed.cascadedIds, affectedDates: committed.affectedDates });
    expect(await store.findByUuid(userId, 'a')).toMatchObject({ calories: type === 'adjustment' ? 150 : 100,
      version: type === 'adjustment' ? 2 : 3 });
  });

  it('includes the density revision in the operation fingerprint', async () => {
    const body = adjustment();
    expect((await put(body)).status).toBe(200);
    const conflict = await put({ ...body, expectedDensityRevision: 'different-configuration' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await store.findByUuid(userId, 'a')).calories).toBe(150);
  });

  it('returns explicit density conflicts and rejects mixed confirmation', async () => {
    const body = adjustment();
    const conflict = await put({ ...body, expectedDensityRevision: 'old-configuration' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('DENSITY_CONFIGURATION_CHANGED');
    expect((await put({ ...body, operationId: 'mixed', settled: true })).status).toBe(400);
    expect(await store.findByUuid(userId, 'a')).toMatchObject({ calories: 100, version: 1, settled: false });
  });

  it.each(['null', '[]', '450'])('rejects a non-object update body: %s', async body => {
    const res = await request(app).put('/api/v1/health/nutrilist/group').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(400);
    expect((await store.findByUuid(userId, 'a')).version).toBe(1);
  });
});
