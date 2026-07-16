import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
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
      'user_5:hr': [116, 116, null],
      'user_9:hr': [null, null, 116]
    };
    foldOccupantSeries(decoded, 'user_5', 'user_9');
    expect(decoded['user_9:hr']).toEqual([116, 116, 116]);
    expect(decoded['user_5:hr']).toBeUndefined();
  });

  it('adopts the from-series wholesale when the to-occupant has no such key at all', () => {
    const decoded = { 'user_5:coins': [0, 0, 1, 1] };
    foldOccupantSeries(decoded, 'user_5', 'user_9');
    expect(decoded['user_9:coins']).toEqual([0, 0, 1, 1]);
    expect(decoded['user_5:coins']).toBeUndefined();
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
    expect([...result.plan.removedOccupants].sort()).toEqual(['user_9', 'user_5']);
  });

  it('apply:true folds user_5/user_9 into grannie and rewrites the file', async () => {
    const result = await heal(DATE, SESSION_ID, { apply: true, baseDir });
    expect(result.changed).toBe(true);

    const rewritten = yaml.load(await readFile(sessionFile, 'utf8'));

    // Only grannie remains everywhere.
    expect(Object.keys(rewritten.participants).sort()).toEqual(['grannie']);
    expect(Object.keys(rewritten.summary.participants).sort()).toEqual(['grannie']);

    // user_9:*/user_5:* series keys are gone.
    const seriesKeys = Object.keys(rewritten.timeline.series);
    expect(seriesKeys.some((k) => k.startsWith('user_9:'))).toBe(false);
    expect(seriesKeys.some((k) => k.startsWith('user_5:'))).toBe(false);
    expect(seriesKeys.some((k) => k.startsWith('grannie:'))).toBe(true);

    // Series values are re-encoded RLE strings, not raw decoded arrays.
    for (const key of seriesKeys) {
      expect(typeof rewritten.timeline.series[key]).toBe('string');
      expect(rewritten.timeline.series[key].startsWith('[')).toBe(true);
    }

    // grannie's coins are preserved (the terminal/cumulative value, 966 —
    // grannie's own trace dominates user_5/user_9's negligible contributions).
    expect(rewritten.summary.participants.grannie.coins).toBe(966);
  });
});
