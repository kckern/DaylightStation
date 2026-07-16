import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { heal, mergeCell, foldOccupantSeries, resolveSessionPath, isValidDate, isValidSessionId } from './heal-fitness-sessions.cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  __dirname,
  '..',
  'backend/src/2_domains/fitness/services/__fixtures__/session-20260627195941.yml'
);
const DATE = '2026-06-27';
const SESSION_ID = '20260627195941';

let baseDir;
let sessionFile;

async function setUpTempSession() {
  baseDir = await mkdtemp(path.join(tmpdir(), 'heal-fitness-'));
  const dir = path.join(baseDir, 'data', 'household', 'history', 'fitness', DATE);
  await mkdir(dir, { recursive: true });
  sessionFile = path.join(dir, `${SESSION_ID}.yml`);
  await copyFile(FIXTURE, sessionFile);
}

describe('resolveSessionPath / isValidDate / isValidSessionId', () => {
  it('joins baseDir/data/household/history/fitness/<date>/<id>.yml', () => {
    expect(resolveSessionPath(DATE, SESSION_ID, '/tmp/base')).toBe(
      path.join('/tmp/base', 'data', 'household', 'history', 'fitness', DATE, `${SESSION_ID}.yml`)
    );
  });

  it('validates date and session id formats', () => {
    expect(isValidDate('2026-06-27')).toBe(true);
    expect(isValidDate('2026-6-27')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidSessionId('20260627195941')).toBe(true);
    expect(isValidSessionId('123')).toBe(false);
    expect(isValidSessionId('abcdefghijklmn')).toBe(false);
  });
});

describe('mergeCell', () => {
  it('takes whichever side is non-null when the other is null', () => {
    expect(mergeCell('x:hr', 100, null)).toBe(100);
    expect(mergeCell('x:hr', null, 100)).toBe(100);
    expect(mergeCell('x:hr', null, null)).toBe(null);
  });
  it('prefers the max for cumulative keys (:coins / :beats) when both sides are non-null', () => {
    expect(mergeCell('grannie:coins', 5, 900)).toBe(900);
    expect(mergeCell('grannie:coins', 900, 5)).toBe(900);
    expect(mergeCell('grannie:beats', 3, 7)).toBe(7);
  });
  it('prefers the "to" value for non-cumulative keys when both sides are non-null', () => {
    expect(mergeCell('grannie:hr', 70, 120)).toBe(120);
    expect(mergeCell('grannie:zone', 'c', 'a')).toBe('a');
  });
});

describe('foldOccupantSeries', () => {
  it('unions non-null cells and deletes the from-occupant keys', () => {
    const decoded = {
      'soren:hr': [116, 116, null],
      'elizabeth:hr': [null, null, 116]
    };
    foldOccupantSeries(decoded, 'soren', 'elizabeth');
    expect(decoded['elizabeth:hr']).toEqual([116, 116, 116]);
    expect(decoded['soren:hr']).toBeUndefined();
  });

  it('adopts the from-series wholesale when the to-occupant has no such key at all', () => {
    const decoded = { 'soren:coins': [0, 0, 1, 1] };
    foldOccupantSeries(decoded, 'soren', 'elizabeth');
    expect(decoded['elizabeth:coins']).toEqual([0, 0, 1, 1]);
    expect(decoded['soren:coins']).toBeUndefined();
  });
});

describe('heal() — golden fixture 20260627195941', () => {
  beforeEach(setUpTempSession);
  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('dry-run (apply:false) leaves the file byte-identical and reports the plan', async () => {
    const before = await readFile(sessionFile, 'utf8');
    const result = await heal(DATE, SESSION_ID, { apply: false, baseDir });
    const after = await readFile(sessionFile, 'utf8');

    expect(after).toBe(before);
    expect(result.changed).toBe(false);
    expect(result.plan.needsHeal).toBe(true);
    expect([...result.plan.removedOccupants].sort()).toEqual(['elizabeth', 'soren']);
  });

  it('apply:true folds soren/elizabeth into grannie and rewrites the file', async () => {
    const result = await heal(DATE, SESSION_ID, { apply: true, baseDir });
    expect(result.changed).toBe(true);

    const rewritten = yaml.load(await readFile(sessionFile, 'utf8'));

    // Only grannie remains everywhere.
    expect(Object.keys(rewritten.participants).sort()).toEqual(['grannie']);
    expect(Object.keys(rewritten.summary.participants).sort()).toEqual(['grannie']);

    // elizabeth:*/soren:* series keys are gone.
    const seriesKeys = Object.keys(rewritten.timeline.series);
    expect(seriesKeys.some((k) => k.startsWith('elizabeth:'))).toBe(false);
    expect(seriesKeys.some((k) => k.startsWith('soren:'))).toBe(false);
    expect(seriesKeys.some((k) => k.startsWith('grannie:'))).toBe(true);

    // Series values are re-encoded RLE strings, not raw decoded arrays.
    for (const key of seriesKeys) {
      expect(typeof rewritten.timeline.series[key]).toBe('string');
      expect(rewritten.timeline.series[key].startsWith('[')).toBe(true);
    }

    // grannie's coins are preserved (the terminal/cumulative value, 966 —
    // grannie's own trace dominates soren/elizabeth's negligible contributions).
    expect(rewritten.summary.participants.grannie.coins).toBe(966);
  });
});

describe('heal() — merges path (known-user device swap) folds coins ADDITIVELY, not Math.max', () => {
  // Regression for: plan.merges reused the ghost-absorption "max" cumulative
  // rule, which is correct for transfers (the "from" occupant is a near-zero
  // ghost) but WRONG for merges (the "from" occupant is a REAL person's other
  // device segment — its coins must be SUMMED into "to", not maxed against
  // it, or everything earned after the device swap is silently dropped).
  const MERGE_DATE = '2026-07-01';
  const MERGE_SESSION_ID = '20260701120000';

  let mergeBaseDir;
  let mergeSessionFile;

  beforeEach(async () => {
    mergeBaseDir = await mkdtemp(path.join(tmpdir(), 'heal-fitness-merge-'));
    const dir = path.join(mergeBaseDir, 'data', 'household', 'history', 'fitness', MERGE_DATE);
    await mkdir(dir, { recursive: true });
    mergeSessionFile = path.join(dir, `${MERGE_SESSION_ID}.yml`);

    // alice_alt (raw/aliased id, device A): earns 0 -> 500, then the strap is
    // swapped away and the series freezes at 500 for the remaining ticks.
    // alice (canonical id, device B): unrecorded (null) until the swap, then
    // continues the SAME person's effort 0 -> 294. True combined total: 794.
    const sessionObj = {
      version: 3,
      sessionId: MERGE_SESSION_ID,
      session: {
        id: MERGE_SESSION_ID,
        date: MERGE_DATE,
        start: '2026-07-01 12:00:00.000',
        end: '2026-07-01 12:00:30.000',
        duration_seconds: 30
      },
      timezone: 'UTC',
      known_user_aliases: { alice_alt: 'alice' },
      participants: {
        alice: { display_name: 'Alice', is_primary: true },
        alice_alt: { display_name: 'Alice', is_primary: true }
      },
      timeline: {
        series: {
          'alice_alt:coins': [0, 100, 300, 500, 500, 500],
          'alice:coins': [null, null, null, 0, 100, 294]
        },
        interval_seconds: 5,
        tick_count: 6,
        encoding: 'rle'
      },
      treasureBox: { totalCoins: 794, buckets: {} },
      entities: [
        { entityId: 'e-alice_alt', profileId: 'alice_alt', deviceId: 'deviceA', startTime: 0, endTime: 15000, status: 'active' },
        { entityId: 'e-alice', profileId: 'alice', deviceId: 'deviceB', startTime: 15000, endTime: 30000, status: 'active' }
      ]
    };

    await writeFile(mergeSessionFile, yaml.dump(sessionObj, { lineWidth: -1, noRefs: true }), 'utf8');
  });

  afterEach(async () => {
    if (mergeBaseDir) await rm(mergeBaseDir, { recursive: true, force: true });
  });

  it('planHeal produces a non-empty merges list (alice_alt -> alice, known-user-device-swap)', async () => {
    const result = await heal(MERGE_DATE, MERGE_SESSION_ID, { apply: false, baseDir: mergeBaseDir });
    expect(result.plan.merges).toEqual([{ from: 'alice_alt', to: 'alice', reason: 'known-user-device-swap' }]);
    expect(result.plan.transfers).toEqual([]);
    expect(result.plan.needsHeal).toBe(true);
  });

  it('apply:true folds alice_alt into alice additively — combined coins is 794, NOT clobbered to 500 by Math.max', async () => {
    const result = await heal(MERGE_DATE, MERGE_SESSION_ID, { apply: true, baseDir: mergeBaseDir });
    expect(result.changed).toBe(true);

    const rewritten = yaml.load(await readFile(mergeSessionFile, 'utf8'));

    expect(Object.keys(rewritten.participants).sort()).toEqual(['alice']);
    expect(Object.keys(rewritten.summary.participants).sort()).toEqual(['alice']);

    // The whole point of this test: 500 (Math.max of 500 and 294) would be
    // WRONG — the real combined total is 500 + 294 = 794.
    expect(rewritten.summary.participants.alice.coins).toBe(794);
  });
});
