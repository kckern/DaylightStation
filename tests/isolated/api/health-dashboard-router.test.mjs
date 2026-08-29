import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHealthDashboardRouter } from '../../../backend/src/4_api/v1/routers/health-dashboard.mjs';
import { AgentHealthDashboardService } from '#apps/health/AgentHealthDashboardService.mjs';
import { HealthDashboardRepositoryErrorCode } from '#apps/health/ports/IHealthDashboardRepository.mjs';
import { DataServiceHealthDashboardRepository } from '#adapters/persistence/files/DataServiceHealthDashboardRepository.mjs';

const FIXED_NOW = new Date('2026-08-28T23:59:59.000Z');
const clock = { now: () => FIXED_NOW };
const noopLogger = { info: () => {}, error: () => {} };

function mount(repository, logger = noopLogger) {
  const dashboardService = new AgentHealthDashboardService({ repository, clock, logger });
  const app = express();
  app.use('/health-dashboard', createHealthDashboardRouter({ dashboardService }));
  return app;
}

function memoryRepository(entries = {}) {
  const dashboards = new Map(Object.entries(entries));
  return {
    findByUserAndDate(userId, date) {
      return dashboards.get(`${userId}/${date}`) ?? null;
    },
    deleteByUserAndDate(userId, date) {
      return dashboards.delete(`${userId}/${date}`);
    },
  };
}

describe('health dashboard HTTP contract', () => {
  it('returns a dated dashboard with the existing envelope', async () => {
    const dashboard = { score: 87, summary: 'steady' };
    const app = mount(memoryRepository({ 'alice/2026-08-27': dashboard }));

    const response = await request(app).get('/health-dashboard/alice/2026-08-27');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'alice', date: '2026-08-27', dashboard });
  });

  it('preserves dated validation and missing-dashboard errors', async () => {
    const app = mount(memoryRepository());

    const invalid = await request(app).get('/health-dashboard/alice/not-a-date');
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: 'Date must be YYYY-MM-DD format' });

    const missing = await request(app).get('/health-dashboard/alice/2026-08-27');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: 'No dashboard available',
      userId: 'alice',
      date: '2026-08-27',
      hint: 'The agent may not have run yet for this date',
    });
  });

  it("uses the injected UTC clock for today's route without changing its envelope", async () => {
    const dashboard = { readiness: 'green' };
    const app = mount(memoryRepository({ 'alice/2026-08-28': dashboard }));

    const response = await request(app).get('/health-dashboard/alice');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'alice', date: '2026-08-28', dashboard });
  });

  it("preserves today's missing-dashboard error", async () => {
    const app = mount(memoryRepository());

    const response = await request(app).get('/health-dashboard/alice');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'No dashboard available for today',
      userId: 'alice',
      date: '2026-08-28',
    });
  });

  it('preserves successful and missing DELETE responses', async () => {
    const repository = memoryRepository({ 'alice/2026-08-27': { score: 87 } });
    const app = mount(repository);

    const deleted = await request(app).delete('/health-dashboard/alice/2026-08-27');
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ userId: 'alice', date: '2026-08-27', deleted: true });

    const missing = await request(app).delete('/health-dashboard/alice/2026-08-27');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: 'No dashboard file for this date',
      userId: 'alice',
      date: '2026-08-27',
    });
  });

  it('preserves DELETE validation and failure responses', async () => {
    const repository = memoryRepository();
    repository.deleteByUserAndDate = () => {
      const error = new Error('Failed to delete health dashboard', {
        cause: new Error('permission denied'),
      });
      error.code = HealthDashboardRepositoryErrorCode.DELETE_FAILED;
      throw error;
    };
    const app = mount(repository);

    const invalid = await request(app).delete('/health-dashboard/alice/not-a-date');
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: 'Date must be YYYY-MM-DD format' });

    const failed = await request(app).delete('/health-dashboard/alice/2026-08-27');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: 'Failed to delete dashboard file' });
  });
});

describe('DataServiceHealthDashboardRepository', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-dashboard-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps DataService paths inside the adapter and deletes through FileIO', () => {
    const filePath = path.join(tempDir, '2026-08-27.yml');
    fs.writeFileSync(filePath, 'score: 87\n');
    const calls = [];
    const dashboard = { score: 87 };
    const dataService = {
      user: {
        read(key, userId) {
          calls.push(['read', key, userId]);
          return dashboard;
        },
        resolvePath(key, userId) {
          calls.push(['resolvePath', key, userId]);
          return filePath;
        },
      },
    };
    const repository = new DataServiceHealthDashboardRepository({ dataService });

    expect(repository.findByUserAndDate('alice', '2026-08-27')).toBe(dashboard);
    expect(repository.deleteByUserAndDate('alice', '2026-08-27')).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(repository.deleteByUserAndDate('alice', '2026-08-27')).toBe(false);
    expect(calls).toEqual([
      ['read', 'health-dashboard/2026-08-27', 'alice'],
      ['resolvePath', 'health-dashboard/2026-08-27', 'alice'],
      ['resolvePath', 'health-dashboard/2026-08-27', 'alice'],
    ]);
  });
});
