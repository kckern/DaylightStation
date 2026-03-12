import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { YamlLifePlanStore } from '#adapters/persistence/yaml/YamlLifePlanStore.mjs';
import { YamlLifeplanMetricsStore } from '#adapters/persistence/yaml/YamlLifeplanMetricsStore.mjs';
import { YamlCeremonyRecordStore } from '#adapters/persistence/yaml/YamlCeremonyRecordStore.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpBase = path.join(os.tmpdir(), `lifeplan-test-${Date.now()}`);

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('YamlLifePlanStore', () => {
  const store = new YamlLifePlanStore({ basePath: tmpBase });
  const username = 'testuser';

  it('returns null when file does not exist', () => {
    expect(store.load(username)).toBeNull();
  });

  it('saves and loads a LifePlan', () => {
    const plan = new LifePlan({
      purpose: { statement: 'Maximize joy' },
      goals: [{ id: 'g1', name: 'Run marathon', state: 'committed' }],
      beliefs: [{ id: 'b1', if: 'X', then: 'Y', state: 'testing' }],
      values: [{ id: 'v1', name: 'Family', rank: 1 }],
    });

    store.save(username, plan);
    const loaded = store.load(username);

    expect(loaded).toBeInstanceOf(LifePlan);
    expect(loaded.purpose.statement).toBe('Maximize joy');
    expect(loaded.goals).toHaveLength(1);
    expect(loaded.goals[0].state).toBe('committed');
    expect(loaded.beliefs).toHaveLength(1);
    expect(loaded.values).toHaveLength(1);
  });

  it('overwrites on re-save', () => {
    const plan = new LifePlan({
      goals: [
        { id: 'g1', name: 'Goal 1', state: 'dream' },
        { id: 'g2', name: 'Goal 2', state: 'dream' },
      ],
    });
    store.save(username, plan);
    const loaded = store.load(username);
    expect(loaded.goals).toHaveLength(2);
  });
});

describe('YamlLifeplanMetricsStore', () => {
  const metricsBase = path.join(tmpBase, 'metrics');
  const store = new YamlLifeplanMetricsStore({ basePath: metricsBase });
  const username = 'testuser';

  it('returns null when no snapshots', () => {
    expect(store.getLatest(username)).toBeNull();
  });

  it('saves and retrieves snapshots', () => {
    store.saveSnapshot(username, { alignment_score: 0.85, goals_active: 3 });
    store.saveSnapshot(username, { alignment_score: 0.78, goals_active: 4 });

    const latest = store.getLatest(username);
    expect(latest.alignment_score).toBe(0.78);
    expect(latest.goals_active).toBe(4);
    expect(latest.timestamp).toBeTruthy();
  });

  it('returns full history', () => {
    const history = store.getHistory(username);
    expect(history).toHaveLength(2);
  });
});

describe('YamlCeremonyRecordStore', () => {
  const ceremonyBase = path.join(tmpBase, 'ceremonies');
  const store = new YamlCeremonyRecordStore({ basePath: ceremonyBase });
  const username = 'testuser';

  it('hasRecord returns false when none exist', () => {
    expect(store.hasRecord(username, 'cycle_retro', '2025-C10')).toBe(false);
  });

  it('saves and finds a record', () => {
    store.saveRecord(username, {
      type: 'cycle_retro',
      period_id: '2025-C10',
      date: '2025-03-01',
      responses: { priority: 'Ship feature' },
    });

    expect(store.hasRecord(username, 'cycle_retro', '2025-C10')).toBe(true);
    expect(store.hasRecord(username, 'cycle_retro', '2025-C11')).toBe(false);
  });

  it('getRecords filters by type', () => {
    store.saveRecord(username, {
      type: 'unit_start',
      period_id: '2025-U100',
      date: '2025-03-02',
    });

    const retros = store.getRecords(username, 'cycle_retro');
    expect(retros).toHaveLength(1);

    const all = store.getRecords(username);
    expect(all).toHaveLength(2);
  });

  it('getLatestRecord returns most recent', () => {
    const latest = store.getLatestRecord(username, 'cycle_retro');
    expect(latest.period_id).toBe('2025-C10');
  });
});
