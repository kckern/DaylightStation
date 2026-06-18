import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecapSweep, recentDateStrings } from './RecapSweep.mjs';

const NOW = new Date('2026-06-18T12:00:00').getTime(); // local noon

function session(id, { status, captures = [{ role: 'camera' }] } = {}) {
  return { sessionId: id, snapshots: { captures }, timelapse: status ? { status } : null };
}

function harness(byDate, { executeImpl } = {}) {
  const executed = [];
  const sessionService = {
    listSessionsByDate: async (date) => (byDate[date] || []).map(s => ({ sessionId: s.sessionId })),
    getSession: async (sessionId) => {
      for (const list of Object.values(byDate)) {
        const found = list.find(s => s.sessionId === sessionId);
        if (found) return found;
      }
      return null;
    }
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
    configService: { getDefaultHouseholdId: () => 'h' },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  return { sweep, executed };
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

test('scans across the full lookback window', async () => {
  const { sweep, executed } = harness({
    '2026-06-18': [session('today')],
    '2026-06-17': [session('yesterday')],
    '2026-06-16': [session('twoago')]
  });
  await sweep.run({ now: NOW, lookbackDays: 2 });
  assert.deepEqual(executed.sort(), ['today', 'twoago', 'yesterday']);
});
