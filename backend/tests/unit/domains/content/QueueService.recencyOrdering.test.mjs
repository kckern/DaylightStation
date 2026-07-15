// backend/tests/unit/domains/content/QueueService.recencyOrdering.test.mjs
//
// End-to-end guard for the Bluey repeat bug (2026-07-14): when every episode in
// a queue is already watched, resolveQueue must de-prioritize the most-recently
// -played episodes instead of restarting at source order / replaying at random.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { QueueService } from '../../../../src/2_domains/content/services/QueueService.mjs';

// Fake IMediaProgressMemory returning canned progress for a single source.
function fakeMemory(progressByContentId) {
  const entries = Object.entries(progressByContentId).map(([contentId, p]) => ({
    contentId,
    playhead: p.playhead ?? 0,
    duration: p.duration ?? 0,
    percent: p.percent ?? null,
    playCount: p.playCount ?? 0,
    lastPlayed: p.lastPlayed ?? null,
    watchTime: p.watchTime ?? 0,
    isInProgress: () => false,
    isWatched: () => (p.playCount ?? 0) > 0
  }));
  return {
    async getAllFromAllLibraries() { return entries; },
    async getAll() { return entries; },
    async get(id) { return entries.find(e => e.contentId === id) ?? null; }
  };
}

const ep = (n, extra = {}) => ({
  id: `plex:${n}`, source: 'plex', title: `Ep ${n}`,
  resumable: true, duration: 420, ...extra
});

describe('QueueService.resolveQueue — recency ordering when all watched', () => {
  it('non-shuffle: orders fully-watched episodes least-recently-seen first', async () => {
    const items = [ep(1), ep(2), ep(3)]; // source order 1,2,3
    const memory = fakeMemory({
      'plex:1': { playCount: 5, percent: 100, lastPlayed: '2026-07-14 20:00:00' }, // just seen
      'plex:2': { playCount: 5, percent: 100, lastPlayed: '2026-07-10 08:00:00' },
      'plex:3': { playCount: 5, percent: 100, lastPlayed: '2026-01-01 08:00:00' }, // long ago
    });
    const qs = new QueueService({ mediaProgressMemory: memory });
    const out = await qs.resolveQueue(items, 'plex', { shuffle: false });
    // Least-recently-seen first — NOT source order (which would be 1,2,3).
    assert.deepStrictEqual(out.map(i => i.id), ['plex:3', 'plex:2', 'plex:1']);
  });

  it('keeps genuinely unwatched episodes ahead of the watched pool', async () => {
    const items = [ep(1), ep(2), ep(3)];
    const memory = fakeMemory({
      'plex:1': { playCount: 5, percent: 100, lastPlayed: '2026-01-01 08:00:00' }, // watched, old
      'plex:2': { playCount: 0, percent: 0, playhead: 0 },                          // unwatched
      'plex:3': { playCount: 5, percent: 100, lastPlayed: '2026-07-14 20:00:00' }, // watched, recent
    });
    const qs = new QueueService({ mediaProgressMemory: memory });
    const out = await qs.resolveQueue(items, 'plex', { shuffle: false });
    // Unwatched (2) first; then watched by recency (1 older before 3 recent).
    assert.deepStrictEqual(out.map(i => i.id), ['plex:2', 'plex:1', 'plex:3']);
  });

  it('shuffle: the most-recently-played episode is never first', async () => {
    // 10 fully-watched episodes; plex:10 seen most recently. Across many shuffles
    // it must never land at the front (it is benched by the recency window).
    const items = Array.from({ length: 10 }, (_, i) => ep(i + 1));
    const progress = {};
    for (let i = 1; i <= 10; i++) {
      progress[`plex:${i}`] = {
        playCount: 3, percent: 100,
        lastPlayed: `2026-07-${String(i).padStart(2, '0')} 12:00:00` // plex:10 newest
      };
    }
    const qs = new QueueService({ mediaProgressMemory: fakeMemory(progress) });
    for (let trial = 0; trial < 40; trial++) {
      const out = await qs.resolveQueue(items, 'plex', { shuffle: true });
      assert.strictEqual(out.length, 10);
      assert.notStrictEqual(out[0].id, 'plex:10', 'most-recent episode must be benched');
    }
  });
});
