import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FitnessGarbageCollector } from './FitnessGarbageCollector.mjs';
import { SESSION_RESUME_MERGE_WINDOW_MS } from '../sessionConsolidationPolicy.mjs';

const NOW = new Date('2026-06-20T12:00:00').getTime();
const STALE = NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 60_000);
const RECENT = NOW - 60_000;

/**
 * In-memory media tree fake.
 * tree = { '<date>': { '<id>': { files: ['name', ...], mtimeMs } } }
 */
function fakeMediaFs(tree) {
  const deleted = [];
  return {
    deleted,
    listDates: () => Object.keys(tree),
    listSessions: (date) => Object.keys(tree[date] || {}),
    frameFiles: (date, id) => (tree[date]?.[id]?.files || []).slice(),
    newestMtimeMs: (date, id) => tree[date]?.[id]?.mtimeMs ?? 0,
    deleteDir: (date, id) => { deleted.push(`${date}/${id}`); delete tree[date][id]; },
    isEmptyDate: (date) => Object.keys(tree[date] || {}).length === 0,
    deleteDate: (date) => { deleted.push(`${date}/`); delete tree[date]; }
  };
}

function harness(tree, sessionsById = {}) {
  const mediaFs = fakeMediaFs(tree);
  const sessionService = {
    getSession: async (id) => sessionsById[id] || null
  };
  const gc = new FitnessGarbageCollector({
    mediaFs,
    sessionService,
    configService: { getDefaultHouseholdId: () => 'h' },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  return { gc, mediaFs };
}

test('prunes an aged empty leftover dir', async () => {
  const { gc, mediaFs } = harness({ '2026-06-01': { 'a': { files: [], mtimeMs: STALE } } });
  const stats = await gc.run({ now: NOW });
  assert.deepEqual(mediaFs.deleted.includes('2026-06-01/a'), true);
  assert.equal(stats.prunedEmpty, 1);
});

test('deletes an aged orphan frame dir (no session record)', async () => {
  const { gc, mediaFs } = harness({
    '2026-06-01': { 'orphan': { files: ['2026-06-01_player_0000.jpg'], mtimeMs: STALE } }
  });
  const stats = await gc.run({ now: NOW });
  assert.deepEqual(mediaFs.deleted.includes('2026-06-01/orphan'), true);
  assert.equal(stats.deletedOrphans, 1);
});

test('deletes frames of a settled, camera-less real session (keeps the record)', async () => {
  const { gc, mediaFs } = harness(
    { '2026-06-18': { 'realPlayerOnly': { files: ['2026-06-18_player_0000.jpg', '2026-06-18_player_0001.jpg'], mtimeMs: STALE } } },
    { realPlayerOnly: { finalized: true, endTime: NOW - SESSION_RESUME_MERGE_WINDOW_MS * 2, timelapse: null } }
  );
  const stats = await gc.run({ now: NOW });
  assert.deepEqual(mediaFs.deleted.includes('2026-06-18/realPlayerOnly'), true);
  assert.equal(stats.deletedFrames, 1);
});

test('keeps a settled session with camera frames awaiting recap', async () => {
  const { gc, mediaFs } = harness(
    { '2026-06-18': { 'pending': { files: ['2026-06-18_0000.jpg'], mtimeMs: STALE } } },
    { pending: { finalized: true, endTime: NOW, timelapse: null } }
  );
  const stats = await gc.run({ now: NOW });
  assert.deepEqual(mediaFs.deleted, []);
  assert.equal(stats.kept, 1);
});

test('keeps a recent dir (does not race a live capture)', async () => {
  const { gc, mediaFs } = harness({
    '2026-06-20': { 'live': { files: ['2026-06-20_player_0000.jpg'], mtimeMs: RECENT } }
  });
  const stats = await gc.run({ now: NOW });
  assert.deepEqual(mediaFs.deleted, []);
  assert.equal(stats.kept, 1);
});

test('prunes a date dir once its last session dir is gone', async () => {
  const { gc, mediaFs } = harness({ '2026-06-01': { 'a': { files: [], mtimeMs: STALE } } });
  await gc.run({ now: NOW });
  assert.deepEqual(mediaFs.deleted.includes('2026-06-01/'), true);
});

test('a per-session error is isolated and counted, sweep continues', async () => {
  const tree = {
    '2026-06-01': {
      'boom': { files: [], mtimeMs: STALE },
      'ok': { files: [], mtimeMs: STALE }
    }
  };
  const mediaFs = fakeMediaFs(tree);
  const original = mediaFs.deleteDir;
  mediaFs.deleteDir = (date, id) => {
    if (id === 'boom') throw new Error('disk gone');
    return original(date, id);
  };
  const gc = new FitnessGarbageCollector({
    mediaFs, sessionService: { getSession: async () => null },
    configService: { getDefaultHouseholdId: () => 'h' },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  const stats = await gc.run({ now: NOW });
  assert.equal(stats.errors, 1);
  assert.equal(stats.prunedEmpty, 1);
  assert.deepEqual(mediaFs.deleted.includes('2026-06-01/ok'), true);
});
