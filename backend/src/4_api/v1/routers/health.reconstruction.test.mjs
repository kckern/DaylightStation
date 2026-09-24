/**
 * Untracked-intake reconstruction through HTTP → HealthOperations → the REAL
 * YAML ledger: rows land with the reconstruction marker, the day summary
 * carries `reconstructed_calories`, a repeat never doubles a day, and DELETE
 * removes the whole backfill.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createHealthRouter } from './health.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { randomUUID } from 'node:crypto';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
let app, store, root;
const nutriday = () => yaml.load(fs.readFileSync(path.join(root, 'lifelog/nutrition/nutriday.yml'), 'utf8'));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-recon-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger });
  // A partially logged day (a real 460-cal lunch) to be topped up.
  await store.saveMany([{ uuid: randomUUID(), userId: 'kc', item: 'Turkey sandwich', calories: 460, protein: 30, date: '2025-09-16', mealTime: 'afternoon', log_uuid: 'L1' }]);
  const operations = new HealthOperations({ nutritionItems: store, resolveDefaultUsername: () => 'kc', today: () => '2026-09-24', newId: randomUUID });
  app = express();
  app.use('/api/v1/health', createHealthRouter({ healthOperations: operations, logger, budgetService: { getBudget: async () => ({}) } }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
});

const plan = [
  { date: '2025-09-16', calories: 1540, evidence: { estimate: 2000, logged: 460, method: 'rmr-dexa' } },
  { date: '2025-11-02', calories: 2310, evidence: { estimate: 2310, logged: 0, method: 'rmr-dexa' } },
];

describe('untracked-intake reconstruction', () => {
  it('dry run writes nothing', async () => {
    const res = await request(app).post('/api/v1/health/nutrition/reconstruction').send({ entries: plan, dryRun: true });
    expect(res.body).toMatchObject({ dryRun: true, written: 0, planned: 2, totalCalories: 3850 });
    expect(nutriday()['2025-11-02']).toBeUndefined();
  });

  it('writes marked rows; the day summary carries reconstructed_calories', async () => {
    const res = await request(app).post('/api/v1/health/nutrition/reconstruction').send({ entries: plan, operationId: 'recon-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ written: 2, skipped: [] });
    expect(nutriday()['2025-09-16']).toMatchObject({ calories: 2000, protein: 30, reconstructed_calories: 1540 });
    expect(nutriday()['2025-11-02']).toMatchObject({ calories: 2310, reconstructed_calories: 2310 });
    const [row] = (await store.findByDate('kc', '2025-11-02'));
    expect(row).toMatchObject({ item: 'Untracked (reconstructed)', logId: 'untracked-reconstruction', protein: 0, settled: true, mealTime: null });
    expect(row.captureEvidence).toMatchObject({ source: 'untracked-reconstruction', method: 'rmr-dexa' });
  });

  it('never doubles a day that is already reconstructed', async () => {
    await request(app).post('/api/v1/health/nutrition/reconstruction').send({ entries: plan });
    const again = await request(app).post('/api/v1/health/nutrition/reconstruction').send({ entries: plan });
    expect(again.body).toMatchObject({ written: 0, skipped: ['2025-09-16', '2025-11-02'] });
    expect(nutriday()['2025-09-16'].calories).toBe(2000);
  });

  it('refuses today/future days, bad calories and repeated dates', async () => {
    for (const entries of [[{ date: '2026-09-24', calories: 100 }], [{ date: '2025-09-01', calories: 0 }],
      [{ date: '2025-09-01', calories: 12.5 }], [{ date: '2025-09-01', calories: 100 }, { date: '2025-09-01', calories: 100 }], []]) {
      const res = await request(app).post('/api/v1/health/nutrition/reconstruction').send({ entries });
      expect(res.status).toBe(400);
    }
  });

  it('DELETE removes the whole backfill and restores the day totals', async () => {
    await request(app).post('/api/v1/health/nutrition/reconstruction').send({ entries: plan });
    const res = await request(app).delete('/api/v1/health/nutrition/reconstruction');
    expect(res.body).toEqual({ removed: 2 });
    expect(nutriday()['2025-09-16']).toMatchObject({ calories: 460, protein: 30 });
    expect(nutriday()['2025-09-16'].reconstructed_calories).toBeUndefined();
  });
});
