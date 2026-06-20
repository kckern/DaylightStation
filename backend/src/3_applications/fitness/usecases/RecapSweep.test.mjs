import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecapSweep, recentDateStrings } from './RecapSweep.mjs';

const NOW = new Date('2026-06-18T12:00:00').getTime(); // local noon

function session(id, { status, captures = [{ role: 'camera' }] } = {}) {
  return { sessionId: id, snapshots: { captures }, timelapse: status ? { status } : null };
}

function harness(byDate, { executeImpl, garbageCollector } = {}) {
  const executed = [];
  const deleted = [];
  const sessionService = {
    listSessionsByDate: async (date) => (byDate[date] || []).map(s => ({ sessionId: s.sessionId })),
    getSession: async (sessionId) => {
      for (const list of Object.values(byDate)) {
        const found = list.find(s => s.sessionId === sessionId);
        if (found) return found;
      }
      return null;
    },
    deleteSession: async (sessionId) => { deleted.push(sessionId); }
  };
  const generateSessionTimelapse = {
    execute: async ({ sessionId }) => {
      executed.push(sessionId);
      return executeImpl ? executeImpl(sessionId) : { status: 'ready' };
    }
  };
  const sweep = new RecapSweep({
    sessionService,
    generateSessionTimelapse,
    garbageCollector,
    configService: { getDefaultHouseholdId: () => 'h' },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  return { sweep, executed, deleted };
}

/** A rosterless skeleton: camera frames captured, but no rider, no endTime. */
function skeleton(id, { lastCaptureMs } = {}) {
  return {
    sessionId: id,
    roster: [],
    endTime: null,
    finalized: false,
    snapshots: { captures: [{ role: 'camera', timestamp: lastCaptureMs }], updatedAt: lastCaptureMs }
  };
}

test('recentDateStrings yields today + N prior days, newest first', () => {
  assert.deepEqual(recentDateStrings(NOW, 2), ['2026-06-18', '2026-06-17', '2026-06-16']);
});

test('triggers execute() for a settled-ish, un-recapped session with camera captures', async () => {
  const { sweep, executed } = harness({ '2026-06-18': [session('s1')] });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(executed, ['s1']);
  assert.equal(stats.triggered, 1);
  assert.equal(stats.rendered, 1);
});

test('skips ready / processing / skipped statuses (idempotent)', async () => {
  const { sweep, executed } = harness({
    '2026-06-18': [
      session('ready', { status: 'ready' }),
      session('processing', { status: 'processing' }),
      session('skipped', { status: 'skipped' })
    ]
  });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(executed, []);
  assert.equal(stats.triggered, 0);
  assert.equal(stats.scanned, 3);
});

test('retries a failed recap (un-recapped, frames still present)', async () => {
  const { sweep, executed } = harness({ '2026-06-18': [session('boom', { status: 'failed' })] });
  await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(executed, ['boom']);
});

test('skips sessions with no camera captures (player-only or empty)', async () => {
  const { sweep, executed } = harness({
    '2026-06-18': [
      session('playerOnly', { captures: [{ role: 'player' }] }),
      session('empty', { captures: [] })
    ]
  });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(executed, []);
  assert.equal(stats.scanned, 2);
});

test('a deferred (within-window) result is counted, not rendered', async () => {
  const { sweep, executed } = harness(
    { '2026-06-18': [session('recent')] },
    { executeImpl: () => ({ status: 'deferred', reason: 'within-merge-window' }) }
  );
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(executed, ['recent']);
  assert.equal(stats.deferred, 1);
  assert.equal(stats.rendered, 0);
});

test('reaps a stale PLAYER-ONLY skeleton (no camera) — the gap the hasCamera guard left', async () => {
  const stale = NOW - (35 * 60 * 1000);
  const playerOnly = {
    sessionId: '20260618061200', roster: [], endTime: null, finalized: false,
    snapshots: { captures: [{ role: 'player', timestamp: stale }], updatedAt: stale }
  };
  const { sweep, executed, deleted } = harness({ '2026-06-18': [playerOnly] });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(deleted, ['20260618061200']);
  assert.deepEqual(executed, []);
  assert.equal(stats.reaped, 1);
});

test('reaps a stale ZERO-capture skeleton via its id-derived age', async () => {
  // id encodes 2026-06-18 06:12:00 — well past the window relative to NOW (06-20 noon)
  const zeroCap = {
    sessionId: '20260618061200', roster: [], endTime: null, finalized: false,
    snapshots: { captures: [{ role: 'camera' }], updatedAt: null } // camera present but untimestamped
  };
  const { sweep, deleted, executed } = harness({ '2026-06-18': [zeroCap] });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(deleted, ['20260618061200']);
  assert.deepEqual(executed, []);
  assert.equal(stats.reaped, 1);
});

test('runs the injected garbage collector at the end of the tick', async () => {
  let gcRan = 0;
  const { sweep } = harness(
    { '2026-06-18': [session('s1')] },
    { garbageCollector: { run: async () => { gcRan++; return {}; } } }
  );
  await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.equal(gcRan, 1);
});

test('reaps a stale rosterless skeleton instead of deferring it forever', async () => {
  const { sweep, executed, deleted } = harness({
    '2026-06-18': [skeleton('ghost', { lastCaptureMs: NOW - (35 * 60 * 1000) })]
  });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(deleted, ['ghost']);   // reaped (record + frames)
  assert.deepEqual(executed, []);          // never handed to the timelapse generator
  assert.equal(stats.reaped, 1);
  assert.equal(stats.triggered, 0);
});

test('does NOT reap a skeleton whose capture is still recent', async () => {
  const { sweep, executed, deleted } = harness({
    '2026-06-18': [skeleton('fresh', { lastCaptureMs: NOW - (60 * 1000) })]
  });
  const stats = await sweep.run({ now: NOW, lookbackDays: 0 });
  assert.deepEqual(deleted, []);
  assert.deepEqual(executed, ['fresh']);   // still flows to the generator (which will defer)
  assert.equal(stats.reaped, 0);
});

test('scans across the full lookback window', async () => {
  const { sweep, executed } = harness({
    '2026-06-18': [session('today')],
    '2026-06-17': [session('yesterday')],
    '2026-06-16': [session('twoago')]
  });
  await sweep.run({ now: NOW, lookbackDays: 2 });
  assert.deepEqual(executed.sort(), ['today', 'twoago', 'yesterday']);
});
