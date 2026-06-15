/**
 * YamlSessionDatastore — session list index (findInRange read cache)
 *
 * The index caches each day's computed summaries in a per-month JSON shard under
 * history/fitness/_index/ so a date-range query reads ~one shard per month instead
 * of re-reading+parsing every session YAML in the window. These tests pin the two
 * properties that matter: (1) the cached result is byte-for-byte the same as the
 * uncached scan, and (2) the cache stays correct as sessions are added, mutated,
 * and removed — both through the datastore's own writes and via external file ops.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { saveYaml } from '#system/utils/FileIO.mjs';

describe('YamlSessionDatastore — findInRange index', () => {
  let store;
  let tmpDir;
  let fitnessRoot;

  const seedSession = (date, id, overrides = {}) => {
    const sessionsDir = path.join(fitnessRoot, date);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, id), {
      sessionId: id,
      startTime: overrides.startTime ?? Date.parse(`${date}T12:00:00Z`),
      endTime: overrides.endTime ?? Date.parse(`${date}T13:00:00Z`),
      durationMs: 3600000,
      timezone: 'UTC',
      participants: {},
      summary: { coins: { total: overrides.coins ?? 0 } },
      timeline: { series: {}, events: [] },
      ...overrides.data,
    });
  };

  const shardPath = (yyyymm) => path.join(fitnessRoot, '_index', `${yyyymm}.json`);
  const readShard = (yyyymm) => JSON.parse(fs.readFileSync(shardPath(yyyymm), 'utf8'));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-index-test-'));
    const configService = { getHouseholdPath: (subPath) => path.join(tmpDir, subPath) };
    store = new YamlSessionDatastore({ configService });
    fitnessRoot = path.join(tmpDir, 'history/fitness');

    seedSession('2026-06-01', '20260601120000', { coins: 5 });
    seedSession('2026-06-02', '20260602120000', { coins: 7 });
    seedSession('2026-06-10', '20260610120000', { coins: 9 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the same sessions on the cold scan and the warm (indexed) read', async () => {
    const cold = await store.findInRange('2026-06-01', '2026-06-30', undefined);
    const warm = await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(warm).toEqual(cold);
    expect(cold.map(s => s.sessionId)).toEqual([
      '20260610120000', '20260602120000', '20260601120000', // startTime desc
    ]);
  });

  it('writes a per-month shard covering the queried days', async () => {
    expect(fs.existsSync(shardPath('2026-06'))).toBe(false);
    await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(fs.existsSync(shardPath('2026-06'))).toBe(true);
    const shard = readShard('2026-06');
    expect(Object.keys(shard.days).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-10']);
    expect(shard.days['2026-06-01'].sessions[0].totalCoins).toBe(5);
  });

  it('does not re-scan a day whose shard entry is fresh (cache hit)', async () => {
    await store.findInRange('2026-06-01', '2026-06-30', undefined); // builds shard
    // Sabotage findByDate so a cache MISS would be observable.
    let scanned = 0;
    const realFindByDate = store.findByDate.bind(store);
    store.findByDate = async (...args) => { scanned++; return realFindByDate(...args); };
    await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(scanned).toBe(0); // every day served from the index
  });

  it('reflects a new session saved through the datastore (write-through invalidation)', async () => {
    await store.findInRange('2026-06-01', '2026-06-30', undefined); // warm
    await store.save({
      sessionId: '20260615120000',
      startTime: Date.parse('2026-06-15T12:00:00Z'),
      endTime: Date.parse('2026-06-15T13:00:00Z'),
      durationMs: 3600000,
      timezone: 'UTC',
      participants: {},
      summary: { coins: { total: 11 } },
      timeline: { series: {}, events: [] },
    }, undefined);

    const after = await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(after.map(s => s.sessionId)).toContain('20260615120000');
  });

  it('reflects a session deleted through the datastore', async () => {
    await store.findInRange('2026-06-01', '2026-06-30', undefined); // warm
    await store.delete('20260602120000', undefined);
    const after = await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(after.map(s => s.sessionId)).not.toContain('20260602120000');
  });

  it('reflects an externally-added session via day-folder mtime change', async () => {
    await store.findInRange('2026-06-01', '2026-06-30', undefined); // warm
    // Simulate an out-of-band write (e.g. Dropbox sync) — bypasses the datastore.
    seedSession('2026-06-02', '20260602180000', { coins: 3 });
    const after = await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(after.map(s => s.sessionId)).toContain('20260602180000');
  });

  it('rebuilds gracefully when a shard is corrupt', async () => {
    await store.findInRange('2026-06-01', '2026-06-30', undefined); // builds shard
    fs.writeFileSync(shardPath('2026-06'), '{ this is not json');
    const after = await store.findInRange('2026-06-01', '2026-06-30', undefined);
    expect(after).toHaveLength(3); // recovered by rescanning
  });

  it('ignores the _index dir when listing session dates', async () => {
    await store.findInRange('2026-06-01', '2026-06-30', undefined); // creates _index/
    const dates = await store.listDates(undefined);
    expect(dates).not.toContain('_index');
  });
});
