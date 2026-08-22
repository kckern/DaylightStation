import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlDoNowDatastore } from '#adapters/persistence/yaml/YamlDoNowDatastore.mjs';

let tmp, ds;

const pendingFile = () => path.join(tmp, 'household', 'donow', 'pending.yml');
const logFile = (dayStamp) => path.join(tmp, 'household', 'donow', 'log', `${dayStamp}.yml`);

const pending = (over = {}) => ({
  id: 'req_1',
  surface: 'garage-fitness',
  action: { episode: 'plex:123' },
  label: 'P.E.',
  learnerId: 'kid1',
  requestedBy: 'school-scan',
  ref: 'ses_abc',
  occupant: 'kid2',
  createdAt: '2026-07-27T10:00:00.000Z',
  // Far enough out that plain CRUD tests (which don't pass a nowIso) never
  // trip the real-wall-clock pruning on listPending/findPending. Tests that
  // actually exercise expiry pass their own nowIso explicitly.
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'donow-store-'));
  ds = new YamlDoNowDatastore({
    configService: { getHouseholdPath: (rel) => path.join(tmp, 'household', rel) },
  });
});

describe('construction', () => {
  it('requires a configService with getHouseholdPath', () => {
    expect(() => new YamlDoNowDatastore({})).toThrow(/configService/);
    expect(() => new YamlDoNowDatastore()).toThrow(/configService/);
  });
});

describe('pending CRUD round-trip', () => {
  it('returns [] when nothing has ever been written', async () => {
    expect(await ds.listPending()).toEqual([]);
  });

  it('putPending writes the record and listPending reads it back exactly', async () => {
    await ds.putPending(pending());
    const rows = await ds.listPending();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(pending());
    expect(fs.existsSync(pendingFile())).toBe(true);
  });

  it('putPending upserts by id — a second put with the same id replaces, not appends', async () => {
    await ds.putPending(pending());
    await ds.putPending(pending({ repended: true, occupant: 'kid3' }));
    const rows = await ds.listPending();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'req_1', repended: true, occupant: 'kid3' });
  });

  it('putPending keeps distinct ids as separate rows', async () => {
    await ds.putPending(pending({ id: 'req_1' }));
    await ds.putPending(pending({ id: 'req_2', surface: 'piano' }));
    const rows = await ds.listPending();
    expect(rows.map((r) => r.id).sort()).toEqual(['req_1', 'req_2']);
  });

  it('removePending drops the record by id', async () => {
    await ds.putPending(pending({ id: 'req_1' }));
    await ds.putPending(pending({ id: 'req_2' }));
    await ds.removePending('req_1');
    const rows = await ds.listPending();
    expect(rows.map((r) => r.id)).toEqual(['req_2']);
  });

  it('removePending on an unknown id is a no-op, not a throw', async () => {
    await ds.putPending(pending());
    await expect(ds.removePending('nope')).resolves.not.toThrow();
    expect(await ds.listPending()).toHaveLength(1);
  });
});

describe('findPending', () => {
  it('matches by surface + ref', async () => {
    await ds.putPending(pending({ id: 'req_1', surface: 'garage-fitness', ref: 'ses_abc' }));
    await ds.putPending(pending({ id: 'req_2', surface: 'piano', ref: 'ses_xyz' }));
    const found = await ds.findPending({ surface: 'garage-fitness', ref: 'ses_abc' });
    expect(found).toMatchObject({ id: 'req_1' });
    expect(await ds.findPending({ surface: 'piano', ref: 'ses_abc' })).toBeNull();
  });

  it('returns null when no record matches', async () => {
    expect(await ds.findPending({ surface: 'garage-fitness', ref: 'ses_abc' })).toBeNull();
  });

  it('ignores an expired record (nowIso after expiresAt)', async () => {
    await ds.putPending(pending({ expiresAt: '2026-07-27T10:02:00.000Z' }));
    const found = await ds.findPending({
      surface: 'garage-fitness',
      ref: 'ses_abc',
      nowIso: '2026-07-27T10:05:00.000Z',
    });
    expect(found).toBeNull();
  });

  it('matches an unexpired record (nowIso before expiresAt)', async () => {
    await ds.putPending(pending({ expiresAt: '2026-07-27T10:02:00.000Z' }));
    const found = await ds.findPending({
      surface: 'garage-fitness',
      ref: 'ses_abc',
      nowIso: '2026-07-27T10:01:00.000Z',
    });
    expect(found).toMatchObject({ id: 'req_1' });
  });

  it('treats exact expiresAt === nowIso as expired (the boundary is exclusive)', async () => {
    await ds.putPending(pending({ expiresAt: '2026-07-27T10:02:00.000Z' }));
    const found = await ds.findPending({
      surface: 'garage-fitness',
      ref: 'ses_abc',
      nowIso: '2026-07-27T10:02:00.000Z',
    });
    expect(found).toBeNull();
  });
});

describe('prunePending', () => {
  it('drops expired records only, leaving unexpired ones untouched', async () => {
    await ds.putPending(pending({ id: 'req_expired', expiresAt: '2026-07-27T10:02:00.000Z' }));
    await ds.putPending(pending({ id: 'req_live', ref: 'ses_other' }));

    await ds.prunePending('2026-07-27T11:00:00.000Z');

    const rows = await ds.listPending();
    expect(rows.map((r) => r.id)).toEqual(['req_live']);
  });

  it('is a no-op when nothing is expired', async () => {
    await ds.putPending(pending({ id: 'req_live' }));
    await ds.prunePending('2026-07-27T09:00:00.000Z');
    expect(await ds.listPending()).toHaveLength(1);
  });
});

describe('lazy prune persists to disk (not just filtered from the return value)', () => {
  it('listPending drops an expired row from the RAW file on disk, not only from what it returns', async () => {
    await ds.putPending(pending({ id: 'req_expired', ref: 'ses_expired', expiresAt: '2026-07-27T10:02:00.000Z' }));
    await ds.putPending(pending({ id: 'req_live', ref: 'ses_live' }));

    // listPending has no nowIso param — it prunes against the real wall
    // clock, which is well past 2026-07-27 by the time this test runs.
    const rows = await ds.listPending();
    expect(rows.map((r) => r.id)).toEqual(['req_live']);

    const raw = yaml.load(fs.readFileSync(pendingFile(), 'utf8'));
    expect(raw.map((r) => r.id)).toEqual(['req_live']);
  });

  it('findPending also persists the prune it computes, even though its job is to answer one lookup', async () => {
    await ds.putPending(pending({ id: 'req_expired', surface: 'other', ref: 'ses_x', expiresAt: '2026-07-27T10:02:00.000Z' }));
    await ds.putPending(pending({ id: 'req_live' }));

    await ds.findPending({ surface: 'garage-fitness', ref: 'ses_abc', nowIso: '2026-07-27T11:00:00.000Z' });

    const raw = yaml.load(fs.readFileSync(pendingFile(), 'utf8'));
    expect(raw.map((r) => r.id)).toEqual(['req_live']);
  });
});

describe('concurrency — the read-modify-write gap must not lose rows', () => {
  it('three concurrent appendDispatch calls all land — none lost to an interleaved read', async () => {
    await Promise.all([
      ds.appendDispatch({ at: '2026-07-27T10:00:00.000Z', surface: 'garage-fitness', decision: 'dispatch', learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1' }),
      ds.appendDispatch({ at: '2026-07-27T10:00:01.000Z', surface: 'garage-fitness', decision: 'dispatch', learnerId: 'kid2', requestedBy: 'school-scan', ref: 'ses_2' }),
      ds.appendDispatch({ at: '2026-07-27T10:00:02.000Z', surface: 'garage-fitness', decision: 'dispatch', learnerId: 'kid3', requestedBy: 'school-scan', ref: 'ses_3' }),
    ]);

    const rows = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect(rows.map((r) => r.ref).sort()).toEqual(['ses_1', 'ses_2', 'ses_3']);
  });

  it('two concurrent putPending upserts with different ids both survive — no last-write-wins clobber', async () => {
    await Promise.all([
      ds.putPending(pending({ id: 'req_a', ref: 'ses_a' })),
      ds.putPending(pending({ id: 'req_b', ref: 'ses_b' })),
    ]);

    const rows = await ds.listPending();
    expect(rows.map((r) => r.id).sort()).toEqual(['req_a', 'req_b']);
  });
});

describe('dispatch log', () => {
  const dispatch = (over = {}) => ({
    at: '2026-07-27T10:00:00.000Z',
    surface: 'garage-fitness',
    decision: 'dispatch',
    learnerId: 'kid1',
    requestedBy: 'school-scan',
    ref: 'ses_abc',
    ...over,
  });

  it('appends preserve order within one UTC day shard', async () => {
    await ds.appendDispatch(dispatch({ ref: 'ses_1' }));
    await ds.appendDispatch(dispatch({ ref: 'ses_2', at: '2026-07-27T14:00:00.000Z' }));
    await ds.appendDispatch(dispatch({ ref: 'ses_3', at: '2026-07-27T23:59:00.000Z' }));

    expect(fs.existsSync(logFile('2026-07-27'))).toBe(true);
    const rows = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect(rows.map((r) => r.ref)).toEqual(['ses_1', 'ses_2', 'ses_3']);
  });

  it('shards by the UTC date of `at`, not the day of the call', async () => {
    await ds.appendDispatch(dispatch({ ref: 'ses_day1', at: '2026-07-27T23:59:59.000Z' }));
    await ds.appendDispatch(dispatch({ ref: 'ses_day2', at: '2026-07-28T00:00:01.000Z' }));

    expect(await ds.listDispatches({ dayStamp: '2026-07-27' })).toHaveLength(1);
    expect(await ds.listDispatches({ dayStamp: '2026-07-28' })).toHaveLength(1);
    expect((await ds.listDispatches({ dayStamp: '2026-07-27' }))[0].ref).toBe('ses_day1');
    expect((await ds.listDispatches({ dayStamp: '2026-07-28' }))[0].ref).toBe('ses_day2');
  });

  it('listDispatches reads back exactly what was appended', async () => {
    const row = dispatch({ ref: 'ses_1', approvalId: 'apr_1', programId: 'pe-daily' });
    await ds.appendDispatch(row);
    const [stored] = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect(stored).toEqual(row);
  });

  it('returns [] for a day with no dispatches', async () => {
    expect(await ds.listDispatches({ dayStamp: '2026-07-27' })).toEqual([]);
  });

  it('persists programId when present', async () => {
    await ds.appendDispatch(dispatch({ ref: 'ses_1', programId: 'pe-daily' }));
    const [stored] = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect(stored.programId).toBe('pe-daily');
    expect('programId' in stored).toBe(true);
  });

  it('omits the programId key entirely when absent (not a null value)', async () => {
    await ds.appendDispatch(dispatch({ ref: 'ses_1' }));
    const [stored] = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect('programId' in stored).toBe(false);

    // Confirm at the raw-YAML level too — a stored `null` would still satisfy
    // Task 12's `programId` reads if it tested truthiness loosely, but the
    // spec is explicit that the KEY itself must be absent.
    const raw = yaml.load(fs.readFileSync(logFile('2026-07-27'), 'utf8'));
    expect('programId' in raw[0]).toBe(false);
  });

  it('omits the approvalId key entirely when absent, keeps it when present', async () => {
    await ds.appendDispatch(dispatch({ ref: 'ses_1' }));
    await ds.appendDispatch(dispatch({ ref: 'ses_2', approvalId: 'apr_9' }));
    const rows = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect('approvalId' in rows[0]).toBe(false);
    expect(rows[1].approvalId).toBe('apr_9');
  });

  it('keeps a null learnerId as an explicit null, not omitted', async () => {
    await ds.appendDispatch(dispatch({ ref: 'ses_1', learnerId: null }));
    const [stored] = await ds.listDispatches({ dayStamp: '2026-07-27' });
    expect('learnerId' in stored).toBe(true);
    expect(stored.learnerId).toBeNull();
  });

  it('returns [] for a malformed dayStamp instead of resolving a path', async () => {
    expect(await ds.listDispatches({ dayStamp: '../../etc' })).toEqual([]);
    expect(await ds.listDispatches({ dayStamp: 'not-a-date' })).toEqual([]);
  });
});
