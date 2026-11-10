import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { heal, mergeCell, foldOccupantSeries, resolveSessionPath, isValidDate, isValidSessionId, sweep, parseSinceArg, cutoffDateString, parseReassignArg } from "./heal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  __dirname,
  '../../server/domain/services/__fixtures__/session-20010101100000.yml'
);
const DATE = '2001-01-01';
const SESSION_ID = '20010101100000';

let baseDir;
let sessionFile;

async function setUpTempSession() {
  baseDir = await mkdtemp(path.join(tmpdir(), 'heal-fitness-'));
  const dir = path.join(baseDir, 'data', 'household', 'fitness', 'log', DATE);
  await mkdir(dir, { recursive: true });
  sessionFile = path.join(dir, `${SESSION_ID}.yml`);
  await copyFile(FIXTURE, sessionFile);
}

describe('resolveSessionPath / isValidDate / isValidSessionId', () => {
  it('joins baseDir/data/household/fitness/log/<date>/<id>.yml', () => {
    expect(resolveSessionPath(DATE, SESSION_ID, '/tmp/base')).toBe(
      path.join('/tmp/base', 'data', 'household', 'fitness', 'log', DATE, `${SESSION_ID}.yml`)
    );
  });

  it('validates date and session id formats', () => {
    expect(isValidDate('2001-01-01')).toBe(true);
    expect(isValidDate('2026-6-27')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidSessionId('20010101100000')).toBe(true);
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
      'learner1:hr': [116, 116, null],
      'parent-two:hr': [null, null, 116]
    };
    foldOccupantSeries(decoded, 'learner1', 'parent-two');
    expect(decoded['parent-two:hr']).toEqual([116, 116, 116]);
    expect(decoded['learner1:hr']).toBeUndefined();
  });

  it('adopts the from-series wholesale when the to-occupant has no such key at all', () => {
    const decoded = { 'learner1:coins': [0, 0, 1, 1] };
    foldOccupantSeries(decoded, 'learner1', 'parent-two');
    expect(decoded['parent-two:coins']).toEqual([0, 0, 1, 1]);
    expect(decoded['learner1:coins']).toBeUndefined();
  });
});

describe('heal() — golden fixture 20010101100000', () => {
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
    expect([...result.plan.removedOccupants].sort()).toEqual(['learner1', 'parent-two']);
  });

  it('apply:true folds learner1/parent-two into grannie and rewrites the file', async () => {
    const result = await heal(DATE, SESSION_ID, { apply: true, baseDir });
    expect(result.changed).toBe(true);

    const rewritten = yaml.load(await readFile(sessionFile, 'utf8'));

    // Only grannie remains everywhere.
    expect(Object.keys(rewritten.participants).sort()).toEqual(['grannie']);
    expect(Object.keys(rewritten.summary.participants).sort()).toEqual(['grannie']);

    // parent-two:*/learner1:* series keys are gone.
    const seriesKeys = Object.keys(rewritten.timeline.series);
    expect(seriesKeys.some((k) => k.startsWith('parent-two:'))).toBe(false);
    expect(seriesKeys.some((k) => k.startsWith('learner1:'))).toBe(false);
    expect(seriesKeys.some((k) => k.startsWith('grannie:'))).toBe(true);

    // Series values are re-encoded RLE strings, not raw decoded arrays.
    for (const key of seriesKeys) {
      expect(typeof rewritten.timeline.series[key]).toBe('string');
      expect(rewritten.timeline.series[key].startsWith('[')).toBe(true);
    }

    // grannie's coins are preserved (the terminal/cumulative value, 966 —
    // grannie's own trace dominates learner1/parent-two's negligible contributions).
    expect(rewritten.summary.participants.grannie.coins).toBe(966);

    // The removed occupants' entity records are stripped too (an entity-backed
    // ghost like parent-two must not linger, or a re-scan would re-flag it).
    const entityProfiles = (rewritten.entities || []).map((e) => e.profileId);
    expect(entityProfiles).not.toContain('parent-two');
    expect(entityProfiles).not.toContain('learner1');
  });

  it('is idempotent — healing the healed output reports needsHeal:false', async () => {
    await heal(DATE, SESSION_ID, { apply: true, baseDir });
    // A second pass over the already-healed file must find nothing to do.
    const second = await heal(DATE, SESSION_ID, { apply: false, baseDir });
    expect(second.plan.needsHeal).toBe(false);
    expect([...second.plan.removedOccupants]).toEqual([]);
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
    const dir = path.join(mergeBaseDir, 'data', 'household', 'fitness', 'log', MERGE_DATE);
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

// ---------------------------------------------------------------------------
// --sweep
// ---------------------------------------------------------------------------

const CLEAN_SESSION_ID = '20010101110000';

function buildCleanSessionObj(sessionId, date) {
  return {
    version: 3,
    sessionId,
    session: {
      id: sessionId,
      date,
      start: `${date} 20:00:00.000`,
      end: `${date} 20:00:20.000`,
      duration_seconds: 20
    },
    timezone: 'UTC',
    participants: {
      grannie: { display_name: 'Grannie', is_primary: true }
    },
    timeline: {
      series: {
        'grannie:hr': [100, 101, 102, 103],
        'grannie:zone': ['a', 'a', 'a', 'a'],
        'grannie:coins': [0, 1, 2, 3]
      },
      interval_seconds: 5,
      tick_count: 4,
      encoding: 'plain'
    },
    treasureBox: { totalCoins: 3, buckets: {} },
    entities: [
      { entityId: 'e-grannie', profileId: 'grannie', deviceId: 'deviceX', startTime: 0, endTime: 20000, status: 'active' }
    ]
  };
}

describe('parseSinceArg / cutoffDateString', () => {
  it('parses "Nd" values into a day count', () => {
    expect(parseSinceArg('30d')).toBe(30);
    expect(parseSinceArg('400d')).toBe(400);
  });

  it('rejects malformed values', () => {
    expect(() => parseSinceArg('30')).toThrow();
    expect(() => parseSinceArg('30days')).toThrow();
    expect(() => parseSinceArg('abc')).toThrow();
  });

  it('computes a YYYY-MM-DD cutoff N days before now', () => {
    expect(cutoffDateString(new Date('2001-01-02T00:00:00Z'), 1)).toBe('2001-01-01');
    expect(cutoffDateString(new Date('2001-01-02T00:00:00Z'), 400)).toBe('1999-11-29');
  });
});

describe('sweep() — golden + clean sessions in the same date dir', () => {
  let sweepBaseDir;
  let goldenFile;
  let cleanFile;

  beforeEach(async () => {
    sweepBaseDir = await mkdtemp(path.join(tmpdir(), 'heal-fitness-sweep-'));
    const dir = path.join(sweepBaseDir, 'data', 'household', 'fitness', 'log', DATE);
    await mkdir(dir, { recursive: true });

    goldenFile = path.join(dir, `${SESSION_ID}.yml`);
    await copyFile(FIXTURE, goldenFile);

    cleanFile = path.join(dir, `${CLEAN_SESSION_ID}.yml`);
    await writeFile(
      cleanFile,
      yaml.dump(buildCleanSessionObj(CLEAN_SESSION_ID, DATE), { lineWidth: -1, noRefs: true }),
      'utf8'
    );
  });

  afterEach(async () => {
    if (sweepBaseDir) await rm(sweepBaseDir, { recursive: true, force: true });
  });

  it('dry-run reports exactly the golden session and leaves both files byte-identical', async () => {
    const goldenBefore = await readFile(goldenFile, 'utf8');
    const cleanBefore = await readFile(cleanFile, 'utf8');

    const { candidates, applied } = await sweep({ baseDir: sweepBaseDir, apply: false });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].date).toBe(DATE);
    expect(candidates[0].sessionId).toBe(SESSION_ID);
    expect([...candidates[0].removed].sort()).toEqual(['learner1', 'parent-two']);
    expect(applied).toEqual([]);

    const goldenAfter = await readFile(goldenFile, 'utf8');
    const cleanAfter = await readFile(cleanFile, 'utf8');
    expect(goldenAfter).toBe(goldenBefore);
    expect(cleanAfter).toBe(cleanBefore);
  });

  it('--apply heals only the golden session, leaving the clean session untouched', async () => {
    const cleanBefore = await readFile(cleanFile, 'utf8');

    const { candidates, applied } = await sweep({ baseDir: sweepBaseDir, apply: true });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sessionId).toBe(SESSION_ID);
    expect(applied).toEqual([{ date: DATE, sessionId: SESSION_ID, changed: true }]);

    const goldenAfter = yaml.load(await readFile(goldenFile, 'utf8'));
    expect(Object.keys(goldenAfter.participants).sort()).toEqual(['grannie']);

    const cleanAfter = await readFile(cleanFile, 'utf8');
    expect(cleanAfter).toBe(cleanBefore);
  });
});

describe('sweep() — --since filtering excludes out-of-window date dirs', () => {
  const OLD_DATE = '2000-01-01';
  const OLD_SESSION_ID = '20000101120000';

  let sweepBaseDir;

  beforeEach(async () => {
    sweepBaseDir = await mkdtemp(path.join(tmpdir(), 'heal-fitness-sweep-since-'));

    const inWindowDir = path.join(sweepBaseDir, 'data', 'household', 'fitness', 'log', DATE);
    await mkdir(inWindowDir, { recursive: true });
    await copyFile(FIXTURE, path.join(inWindowDir, `${SESSION_ID}.yml`));

    const outOfWindowDir = path.join(sweepBaseDir, 'data', 'household', 'fitness', 'log', OLD_DATE);
    await mkdir(outOfWindowDir, { recursive: true });
    await copyFile(FIXTURE, path.join(outOfWindowDir, `${OLD_SESSION_ID}.yml`));
  });

  afterEach(async () => {
    if (sweepBaseDir) await rm(sweepBaseDir, { recursive: true, force: true });
  });

  it('excludes the out-of-window session but includes the in-window one', async () => {
    const now = new Date('2001-01-02T00:00:00Z'); // 1 day after DATE, 1 year after OLD_DATE
    const { candidates } = await sweep({ baseDir: sweepBaseDir, apply: false, sinceDays: 5, now });

    expect(candidates.some((c) => c.date === OLD_DATE)).toBe(false);
    expect(candidates.some((c) => c.date === DATE && c.sessionId === SESSION_ID)).toBe(true);
  });

  it('without --since, both in-window and out-of-window sessions are reported', async () => {
    const { candidates } = await sweep({ baseDir: sweepBaseDir, apply: false });

    expect(candidates.some((c) => c.date === OLD_DATE)).toBe(true);
    expect(candidates.some((c) => c.date === DATE)).toBe(true);
  });
});

describe('heal — 2001-01-02 split repair (session 20010102100000, scrubbed)', () => {
  const SPLIT_FIXTURE = path.join(__dirname, '../../server/domain/services/__fixtures__/session-20010102100000.yml');
  const SPLIT_DATE = '2001-01-02';
  const SPLIT_ID = '20010102100000';
  let splitBase;

  beforeEach(async () => {
    splitBase = await mkdtemp(path.join(tmpdir(), 'heal-split-'));
    const dir = path.join(splitBase, 'data', 'household', 'fitness', 'log', SPLIT_DATE);
    await mkdir(dir, { recursive: true });
    await copyFile(SPLIT_FIXTURE, path.join(dir, `${SPLIT_ID}.yml`));
    // Real shape: the COLOCATED household/fitness/config.yml, `primary` as
    // scalar profile references, `family`/`friends` inline.
    const cfgDir = path.join(splitBase, 'data', 'household', 'fitness');
    await mkdir(cfgDir, { recursive: true });
    await writeFile(path.join(cfgDir, 'config.yml'), yaml.dump({
      users: {
        primary: ['kid-a', 'kid-d', 'kid-e', 'parent'],
        family: [{ id: 'mom', name: 'Mom' }],
        friends: [{ id: 'kid-b', name: 'Kid B' }, { id: 'guest-c', name: 'Guest C' }],
      },
    }));
    for (const [id, name] of [['kid-a', 'Kid A'], ['kid-d', 'Kid D'], ['kid-e', 'Kid E'], ['parent', 'Parent']]) {
      const userDir = path.join(splitBase, 'data', 'users', id);
      await mkdir(userDir, { recursive: true });
      await writeFile(path.join(userDir, 'profile.yml'), yaml.dump({ username: id, display_name: name }));
    }
  });
  afterEach(async () => { await rm(splitBase, { recursive: true, force: true }); });

  it('applies the split repair and patches the summary with rings', async () => {
    const before = yaml.load(await readFile(SPLIT_FIXTURE, 'utf8')).summary.participants;
    const res = await heal(SPLIT_DATE, SPLIT_ID, { apply: true, baseDir: splitBase });
    const repair = res.plan.splitRepairs.find((r) => r.metric === 'rings');
    const p = res.out.summary.participants;
    expect(repair.amount).toBeGreaterThanOrEqual(87);
    expect(p['kid-a'].rings).toBe(before['kid-a'].rings + repair.amount);
    expect(p['kid-b'].rings).toBe(before['kid-b'].rings - repair.amount);
    expect(p['guest-c'].rings).toBe(before['guest-c'].rings);
    expect(p).not.toHaveProperty('kid-d');
    expect(p).not.toHaveProperty('kid-e');
    expect(res.out.participants).not.toHaveProperty('kid-d');
    expect(res.out.participants['kid-a']).toMatchObject({ display_name: 'Kid A', is_primary: true });
    expect(res.out.participants['kid-a']).not.toHaveProperty('is_guest');
    expect(res.out.participants['kid-a']).not.toHaveProperty('base_user');
    expect(res.out.participants['guest-c']).toMatchObject({ display_name: 'Guest C', is_guest: true });
    expect(res.out.participants['guest-c']).not.toHaveProperty('is_primary');
    // Sections the heal does not own survive untouched.
    expect(res.out.summary.media).toEqual(yaml.load(await readFile(SPLIT_FIXTURE, 'utf8')).summary.media);
  });

  it('patched summary keeps rings (never reads :coins on a modern session)', async () => {
    const res = await heal(SPLIT_DATE, SPLIT_ID, { apply: true, baseDir: splitBase });
    expect(res.out.summary.participants.parent.rings).toBe(2);
    expect(res.out.summary.participants['guest-c'].rings).toBe(508);
  });

  it('heal is idempotent', async () => {
    await heal(SPLIT_DATE, SPLIT_ID, { apply: true, baseDir: splitBase });
    const again = await heal(SPLIT_DATE, SPLIT_ID, { apply: false, baseDir: splitBase });
    expect(again.plan.needsHeal).toBe(false);
  });
});

describe('heal — list index', () => {
  it('drops the healed day from its month index shard so the session list re-reads it', async () => {
    await setUpTempSession();
    const indexDir = path.join(baseDir, 'data', 'household', 'fitness', 'log', '_index');
    await mkdir(indexDir, { recursive: true });
    const shardFile = path.join(indexDir, '2001-01.json');
    await writeFile(shardFile, JSON.stringify({ version: 5, days: { [DATE]: { mtimeMs: 1, sessions: [{ id: 'stale' }] }, '2001-01-02': { mtimeMs: 2, sessions: [] } } }));
    const res = await heal(DATE, SESSION_ID, { apply: true, baseDir });
    expect(res.changed).toBe(true);
    const shard = JSON.parse(await readFile(shardFile, 'utf8'));
    expect(shard.days).not.toHaveProperty(DATE);
    expect(shard.days).toHaveProperty('2001-01-02');
    await rm(baseDir, { recursive: true, force: true });
  });
});


// Audit 2026-10-29: a household rider whose strap died rode a spare strap as a
// generic guest_<deviceId> (the picker had no option for them). The heal CLI
// had no way to give the ride back: guest_ ids are never "known users", so no
// planned merge touches them. --reassign=FROM:TO does it explicitly.
describe('heal() --reassign gives a generic guest\'s ride to a household rider', () => {
  const RDATE = '2026-07-02';
  const RSESSION = '20260702120000';
  let rBase;
  let rFile;

  const write = async (sessionObj) => {
    rBase = await mkdtemp(path.join(tmpdir(), 'heal-fitness-reassign-'));
    const dir = path.join(rBase, 'data', 'household', 'fitness', 'log', RDATE);
    await mkdir(dir, { recursive: true });
    rFile = path.join(dir, `${RSESSION}.yml`);
    const cfgDir = path.join(rBase, 'data', 'household', 'fitness');
    await writeFile(path.join(cfgDir, 'config.yml'), yaml.dump({ users: { primary: [{ id: 'rider_m', name: 'Rider M' }, { id: 'rider_f', name: 'Rider F' }] } }), 'utf8');
    await writeFile(rFile, yaml.dump(sessionObj, { lineWidth: -1, noRefs: true }), 'utf8');
  };
  const base = (series, participants) => ({
    version: 3,
    sessionId: RSESSION,
    session: { id: RSESSION, date: RDATE, start: '2026-07-02 12:00:00.000', end: '2026-07-02 12:00:30.000', duration_seconds: 30 },
    timezone: 'UTC',
    participants,
    timeline: { series, interval_seconds: 5, tick_count: 6, encoding: 'rle' },
    entities: [
      { entityId: 'e-f', profileId: 'rider_f', deviceId: 'dF', startTime: 0, endTime: null, status: 'active' },
      { entityId: 'e-g', profileId: 'guest_10266', deviceId: '10266', startTime: 5000, endTime: null, status: 'active', relabeledFrom: ['someone'] },
    ],
  });

  afterEach(async () => { if (rBase) await rm(rBase, { recursive: true, force: true }); });

  it('parses FROM:TO pairs and rejects malformed ones', () => {
    expect(parseReassignArg('guest_1:rider_m')).toEqual([{ from: 'guest_1', to: 'rider_m' }]);
    expect(parseReassignArg('a:b,c:d')).toHaveLength(2);
    expect(parseReassignArg(undefined)).toEqual([]);
    expect(() => parseReassignArg('guest_1')).toThrow();
    expect(() => parseReassignArg('x:x')).toThrow();
    expect(() => parseReassignArg(true)).toThrow();
  });

  it('dry run plans the merge without touching the file', async () => {
    await write(base({
      'rider_f:rings': [0, 10, 20, 30, 40, 50],
      'guest_10266:rings': [null, 0, 100, 200, 300, 537],
      'guest_10266:hr': [null, 120, 130, 140, 150, 160],
    }, {
      rider_f: { display_name: 'Rider F', hr_device: 'dF', is_primary: true },
      guest_10266: { display_name: 'Guest', hr_device: '10266', is_guest: true, guest_profile: 'kid', base_user: 'Someone' },
    }));
    const before = await readFile(rFile, 'utf8');
    const { plan, changed } = await heal(RDATE, RSESSION, { baseDir: rBase, reassign: [{ from: 'guest_10266', to: 'rider_m' }] });
    expect(changed).toBe(false);
    expect(plan.merges).toContainEqual({ from: 'guest_10266', to: 'rider_m', reason: 'manual-reassign' });
    expect(plan.removedOccupants).toContain('guest_10266');
    expect(await readFile(rFile, 'utf8')).toBe(before);
  });

  it('apply moves series, participant row, entity and summary to the rider', async () => {
    await write(base({
      'rider_f:rings': [0, 10, 20, 30, 40, 50],
      'guest_10266:rings': [null, 0, 100, 200, 300, 537],
      'guest_10266:hr': [null, 120, 130, 140, 150, 160],
    }, {
      rider_f: { display_name: 'Rider F', hr_device: 'dF', is_primary: true },
      guest_10266: { display_name: 'Guest', hr_device: '10266', is_guest: true, guest_profile: 'kid', base_user: 'Someone' },
    }));
    const { out } = await heal(RDATE, RSESSION, { baseDir: rBase, apply: true, reassign: [{ from: 'guest_10266', to: 'rider_m' }] });
    expect(out.participants.guest_10266).toBeUndefined();
    expect(out.participants.rider_m).toEqual({ display_name: 'Rider M', hr_device: '10266', is_primary: true });
    expect(out.entities.find((e) => e.entityId === 'e-g')).toMatchObject({ profileId: 'rider_m', relabeledFrom: ['someone', 'guest_10266'] });
    expect(out.summary.participants.rider_m.rings).toBe(537);
    expect(out.summary.participants.guest_10266).toBeUndefined();
    const reread = yaml.load(await readFile(rFile, 'utf8'));
    expect(Object.keys(reread.timeline.series).some((k) => k.startsWith('guest_10266:'))).toBe(false);
    // Idempotent: nothing left to reassign, so a second plain heal is clean.
    const again = await heal(RDATE, RSESSION, { baseDir: rBase });
    expect(again.plan.needsHeal).toBe(false);
  });

  it('when the rider rode their own strap FIRST, their total carries into the guest stretch', async () => {
    await write(base({
      'rider_m:rings': [0, 40, null, null, null, null],
      'guest_10266:rings': [null, null, 0, 100, 200, 300],
    }, {
      rider_m: { display_name: 'Rider M', hr_device: 'dM', is_primary: true },
      guest_10266: { display_name: 'Guest', hr_device: '10266', is_guest: true },
    }));
    const { out } = await heal(RDATE, RSESSION, { baseDir: rBase, apply: true, reassign: [{ from: 'guest_10266', to: 'rider_m' }] });
    expect(out.summary.participants.rider_m.rings).toBe(340);
    expect(out.participants.rider_m.hr_device).toBe('dM'); // the rider's own row wins
  });

  it('refuses an id that is not in the session, or a guest_ target', async () => {
    await write(base({ 'rider_f:rings': [0, 1, 2, 3, 4, 5] }, { rider_f: { display_name: 'Rider F', is_primary: true } }));
    await expect(heal(RDATE, RSESSION, { baseDir: rBase, reassign: [{ from: 'guest_9', to: 'rider_m' }] })).rejects.toThrow(/not a participant/);
    await expect(heal(RDATE, RSESSION, { baseDir: rBase, reassign: [{ from: 'rider_f', to: 'guest_2' }] })).rejects.toThrow(/not a household user/);
  });
});
