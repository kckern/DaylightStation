import { describe, it, expect } from 'vitest';
import { observeHeartbeat, SKIP_WINDOW_MS, SKIP_CONFIRM_MS } from './skipInference.mjs';

const hb = (assetId, atEpoch, extra = {}) => ({ assetId, storagePath: 'plex/17_lectures', complete: false, atEpoch, ...extra });

// Feed heartbeats through the reducer; collect confirmed skips.
function run(beats) {
  let state = null;
  const skips = [];
  for (const beat of beats) {
    const out = observeHeartbeat(state, beat);
    state = out.state;
    skips.push(...out.skips);
  }
  return skips;
}

describe('observeHeartbeat', () => {
  it('moving on from an unfinished item, which then stays silent, is a skip', () => {
    const skips = run([hb('A', 0), hb('B', 10_000), hb('B', 10_000 + SKIP_CONFIRM_MS)]);
    expect(skips).toEqual([{ assetId: 'A', storagePath: 'plex/17_lectures' }]);
  });

  it('is not confirmed before the old item has been silent long enough', () => {
    expect(run([hb('A', 0), hb('B', 10_000), hb('B', 20_000)])).toEqual([]);
  });

  it('two players on one screen (alternating heartbeats) never skip each other', () => {
    const beats = [];
    for (let t = 0; t < 120_000; t += 5_000) beats.push(hb(t % 10_000 ? 'MUSIC' : 'POEM', t));
    expect(run(beats)).toEqual([]);
  });

  it('a finished item moving on is not a skip', () => {
    expect(run([hb('A', 0, { complete: true }), hb('B', 10_000), hb('B', 60_000)])).toEqual([]);
  });

  it('coming back after a long gap (TV was off) is not a skip', () => {
    expect(run([hb('A', 0), hb('B', SKIP_WINDOW_MS + 1), hb('B', SKIP_WINDOW_MS + 60_000)])).toEqual([]);
  });

  it('the same item heartbeating is never a skip', () => {
    expect(run([hb('A', 0), hb('A', 10_000), hb('A', 60_000)])).toEqual([]);
  });

  it('skipping through several items confirms each one', () => {
    const skips = run([hb('A', 0), hb('B', 5_000), hb('C', 10_000), hb('C', 10_000 + SKIP_CONFIRM_MS)]);
    expect(skips.map(s => s.assetId)).toEqual(['A', 'B']);
  });
});
