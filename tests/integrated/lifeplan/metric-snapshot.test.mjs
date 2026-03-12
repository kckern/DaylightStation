/**
 * Integration test: DriftService computes + persists + reads back snapshot.
 *
 * Uses real YamlLifeplanMetricsStore with tmp directory.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DriftService } from '#apps/lifeplan/services/DriftService.mjs';
import { YamlLifeplanMetricsStore } from '#adapters/persistence/yaml/YamlLifeplanMetricsStore.mjs';

describe('DriftService — metric snapshot persistence (integrated)', () => {
  let tmpDir;
  let metricsStore;
  let service;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeplan-metrics-'));
    fs.mkdirSync(path.join(tmpDir, 'testuser'), { recursive: true });

    metricsStore = new YamlLifeplanMetricsStore({ basePath: tmpDir });

    const mockPlanStore = {
      load: () => ({
        values: [
          { id: 'v1', name: 'Health', rank: 1 },
          { id: 'v2', name: 'Career', rank: 2 },
        ],
        cadence: { unit: 'day', cycle: 'week', phase: 'month' },
        value_mapping: {},
      }),
    };

    const mockAggregator = {
      aggregateRange: async () => ({
        days: {
          '2025-06-01': { sources: {}, categories: {} },
          '2025-06-02': { sources: {}, categories: {} },
        },
      }),
    };

    const mockCadenceService = {
      resolve: () => ({
        unit: { periodId: '2025-06-07', startDate: new Date('2025-06-07') },
        cycle: { periodId: '2025-W23', startDate: new Date('2025-06-02') },
        phase: { periodId: '2025-06', startDate: new Date('2025-06-01') },
      }),
    };

    const clock = {
      now: () => new Date('2025-06-07T12:00:00Z'),
      today: () => '2025-06-07',
    };

    service = new DriftService({
      lifePlanStore: mockPlanStore,
      metricsStore,
      aggregator: mockAggregator,
      cadenceService: mockCadenceService,
      clock,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computes and saves a drift snapshot', async () => {
    const snapshot = await service.computeAndSave('testuser');

    expect(snapshot).toBeDefined();
    expect(snapshot.date).toBe('2025-06-07');
    expect(snapshot.period_id).toBe('2025-W23');
    expect(snapshot.timestamp).toContain('2025-06-07');
  });

  it('persists snapshot to YAML and reads it back', async () => {
    await service.computeAndSave('testuser');

    const latest = service.getLatestSnapshot('testuser');
    expect(latest).toBeDefined();
    expect(latest.date).toBe('2025-06-07');
  });

  it('accumulates history across multiple saves', async () => {
    await service.computeAndSave('testuser');
    await service.computeAndSave('testuser');

    const history = service.getHistory('testuser');
    expect(history).toHaveLength(2);
  });

  it('reads persisted data from disk after recreating store', async () => {
    await service.computeAndSave('testuser');

    // Create a fresh store pointing to same directory
    const freshStore = new YamlLifeplanMetricsStore({ basePath: tmpDir });
    const history = freshStore.getHistory('testuser');
    expect(history).toHaveLength(1);
    expect(history[0].date).toBe('2025-06-07');
  });
});
