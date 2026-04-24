// backend/tests/unit/domains/content/QueueService.shortAudioWatched.test.mjs
//
// Regression guard for office-program poetry repeat bug (2026-04-23):
// short audio readalongs that stop at ~70% (because the next program slot
// fires) were perpetually flagged as "in progress" by the 90%-completion
// rule. Fix: items shorter than 60s are considered watched at 70%+.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { QueueService } from '../../../../src/2_domains/content/services/QueueService.mjs';

describe('QueueService.isWatched (duration-aware)', () => {
  it('treats long video at 71% as not watched', () => {
    const item = { id: 'a', duration: 300, percent: 71 };
    assert.strictEqual(QueueService.isWatched(item), false);
  });

  it('treats long video at 91% as watched', () => {
    const item = { id: 'a', duration: 300, percent: 91 };
    assert.strictEqual(QueueService.isWatched(item), true);
  });

  it('treats short audio (28s) at 71% as watched — the office-program poetry case', () => {
    const item = { id: 'readalong:poetry/remedy/02', duration: 28, percent: 71 };
    assert.strictEqual(QueueService.isWatched(item), true);
  });

  it('treats short audio at 60% as not watched (below short threshold)', () => {
    const item = { id: 'a', duration: 28, percent: 60 };
    assert.strictEqual(QueueService.isWatched(item), false);
  });

  it('boundary: short audio at exactly 70% is watched', () => {
    const item = { id: 'a', duration: 28, percent: 70 };
    assert.strictEqual(QueueService.isWatched(item), true);
  });

  it('boundary: 60s duration uses standard 90% rule (not short)', () => {
    const item = { id: 'a', duration: 60, percent: 71 };
    assert.strictEqual(QueueService.isWatched(item), false);
  });

  it('boundary: 59s duration uses short 70% rule', () => {
    const item = { id: 'a', duration: 59, percent: 71 };
    assert.strictEqual(QueueService.isWatched(item), true);
  });

  it('respects explicit watched flag regardless of duration/percent', () => {
    const item = { id: 'a', duration: 300, percent: 0, watched: true };
    assert.strictEqual(QueueService.isWatched(item), true);
  });

  it('unknown duration defaults to standard 90% rule', () => {
    const item = { id: 'a', percent: 71 };
    assert.strictEqual(QueueService.isWatched(item), false);
  });

  it('zero/missing percent on undated item is not watched', () => {
    const item = { id: 'a', duration: 28 };
    assert.strictEqual(QueueService.isWatched(item), false);
  });
});

describe('QueueService.filterByWatched uses duration-aware rule', () => {
  it('filters out the 71% poem alongside watched videos', () => {
    const items = [
      { id: 'long-video', duration: 300, percent: 50 },             // keep
      { id: 'long-video-watched', duration: 300, percent: 95 },     // drop
      { id: 'short-poem-stuck', duration: 28, percent: 71 },        // drop (the bug)
      { id: 'short-poem-fresh', duration: 28, percent: 0 },         // keep
    ];
    const kept = QueueService.filterByWatched(items);
    const keptIds = kept.map(i => i.id).sort();
    assert.deepStrictEqual(keptIds, ['long-video', 'short-poem-fresh']);
  });
});
