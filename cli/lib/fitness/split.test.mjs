import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { encodeStoredSeries } from './seriesWire.mjs';
import { run } from './split.mjs';

const TZ = 'America/Los_Angeles';

async function makeRingsSession({
  hr = [120, 121, 122, 130, 131, 132],
  rings = [0, 1, 2, 3, 4, 5],
  totalRings = 5,
  buckets = { blue: 0, green: 4, yellow: 0, orange: 0, red: 0, '#e0a85b': 1 },
} = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'fitness-split-rings-'));
  const dayDir = path.join(base, 'fitness', 'log', '2026-10-07');
  await mkdir(dayDir, { recursive: true });
  const file = path.join(dayDir, '20261007100000.yml');
  const series = {
    'test-learner:hr': hr,
    'test-learner:zone': ['a', 'a', 'a', 'a', 'a', 'a'],
    'test-learner:rings': rings,
    'global:rings': rings,
  };
  const doc = {
    version: 3,
    sessionId: '20261007100000',
    session: {
      id: '20261007100000', date: '2026-10-07',
      start: '2026-10-07 10:00:00.000', end: '2026-10-07 10:00:30.000', duration_seconds: 30,
    },
    timezone: TZ,
    participants: { 'test-learner': { display_name: 'the learner', hr_device: '90003' } },
    timeline: { series: encodeStoredSeries(series), events: [], tick_count: 6, interval_seconds: 5 },
    treasureBox: {
      ringTimeUnitMs: 5000, totalRings,
      buckets,
    },
    summary: {
      participants: { 'test-learner': { rings: totalRings } }, media: [],
      rings: { total: totalRings, buckets },
    },
    entities: [{ entityId: 'entity-test-learner', profileId: 'test-learner', deviceId: '90003', startTime: moment.tz('2026-10-07 10:00:00.000', 'YYYY-MM-DD HH:mm:ss.SSS', TZ).valueOf(), endTime: null, status: 'active', startTick: 0 }],
  };
  await writeFile(file, yaml.dump(doc), 'utf8');
  return { file, splitTs: moment.tz('2026-10-07 10:00:15.000', 'YYYY-MM-DD HH:mm:ss.SSS', TZ).valueOf() };
}

afterEach(() => vi.restoreAllMocks());

describe('fitness session split — rings schema', () => {
  it('dry-runs a current rings session with custom bonus buckets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { file, splitTs } = await makeRingsSession();

    const result = await run([`--file=${file}`, `--split-ts=${splitTs}`], {});

    expect(result.allOk).toBe(true);
    expect(result.written).toBe(false);
    expect(yaml.load(await readFile(file, 'utf8')).summary.rings.total).toBe(5);
  });

  it('writes both output documents without dropping low-sample telemetry or entities', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const zeroBuckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
    const { file, splitTs } = await makeRingsSession({
      hr: [100, 101, null, 103, 104, 105],
      rings: [0, 0, 0, 0, 0, 0],
      totalRings: 0,
      buckets: zeroBuckets,
    });

    const result = await run([`--file=${file}`, `--split-ts=${splitTs}`, '--write'], {});
    const part1 = yaml.load(await readFile(result.file1, 'utf8'));
    const part2 = yaml.load(await readFile(result.file2, 'utf8'));

    expect(result.allOk).toBe(true);
    expect(part1.participants['test-learner']).toBeTruthy();
    expect(part2.participants['test-learner']).toBeTruthy();
    expect(part1.timeline.series['test-learner:hr']).toBeTruthy();
    expect(part2.timeline.series['test-learner:hr']).toBeTruthy();
    expect(part1.entities.map((entity) => entity.entityId)).toContain('entity-test-learner');
    expect(part2.entities.map((entity) => entity.entityId)).toContain('entity-test-learner');
  });
});
