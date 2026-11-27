// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { accumulateListened, MAX_GAP_MS } from './listenedTime.mjs';

/** Feed a series of [position s, wall s, rate?] reports from one session. */
function play(reports, { key = 'phone', start = null } = {}) {
  let state = start;
  for (const [position, wall, rate] of reports) {
    state = accumulateListened(state, { key, position, atMs: wall * 1000, rate });
  }
  return state;
}

describe('listened time', () => {
  it('normal play adds its time', () => {
    // ten minutes of reports every 10 s, position moving with the clock
    const reports = Array.from({ length: 61 }, (_, i) => [100 + i * 10, 1_000_000 + i * 10]);
    expect(play(reports).listenedSec).toBeCloseTo(600, 0);
  });

  it('the first report of a run adds nothing', () => {
    expect(play([[500, 1_000_000]]).listenedSec).toBe(0);
  });

  it('a seek forward adds next to nothing', () => {
    // 10 s heard, then a jump of 40 minutes within the next 10 s
    const state = play([[100, 1_000_000], [110, 1_000_010], [2510, 1_000_020]]);
    expect(state.listenedSec).toBeLessThanOrEqual(10 + 11);
  });

  it('seeking to 40 % and leaving never adds up to minutes', () => {
    const state = play([[20, 1_000_000], [4000, 1_000_005]]);
    expect(state.listenedSec).toBeLessThan(6);
  });

  it('a seek back adds nothing and starts a new run', () => {
    const state = play([[600, 1_000_000], [100, 1_000_010], [110, 1_000_020]]);
    expect(state.listenedSec).toBeCloseTo(10, 5);
  });

  it('a gap longer than twice the report interval breaks the run', () => {
    const gap = MAX_GAP_MS / 1000 + 1;
    const state = play([[100, 1_000_000], [100 + gap, 1_000_000 + gap]]);
    expect(state.listenedSec).toBe(0);
    expect(state.listenRun).toEqual({ key: 'phone', pos: 100 + gap, at: (1_000_000 + gap) * 1000 });
  });

  it('a pause adds nothing (position still, clock moving)', () => {
    expect(play([[100, 1_000_000], [100, 1_000_010]]).listenedSec).toBe(0);
  });

  it('speed is counted: 1.5× adds 1.5 s of the item per wall second', () => {
    const reports = Array.from({ length: 7 }, (_, i) => [100 + i * 15, 1_000_000 + i * 10, 1.5]);
    expect(play(reports).listenedSec).toBeCloseTo(90, 5);
  });

  it('at 1× a report claiming 1.5× progress is capped at wall × 1.1', () => {
    const state = play([[100, 1_000_000], [115, 1_000_010]]);
    expect(state.listenedSec).toBeCloseTo(11, 5);
  });

  it('another session does not continue the run', () => {
    let state = accumulateListened(null, { key: 'phone', position: 100, atMs: 1_000_000_000 });
    state = accumulateListened(state, { key: 'web', position: 110, atMs: 1_000_010_000 });
    expect(state.listenedSec).toBe(0);
    expect(state.listenRun.key).toBe('web');
  });

  it('a late report (heard before the run) neither counts nor moves the run back', () => {
    let state = play([[100, 1_000_000], [110, 1_000_010]]);
    const after = accumulateListened(state, { key: 'phone', position: 105, atMs: 1_000_005_000 });
    expect(after.listenedSec).toBe(state.listenedSec);
    expect(after.listenRun).toEqual(state.listenRun);
  });

  it('adds to what the record already holds', () => {
    const state = play([[110, 1_000_010]], { start: { listenedSec: 300, listenRun: { key: 'phone', pos: 100, at: 1_000_000_000 } } });
    expect(state.listenedSec).toBeCloseTo(310, 5);
  });
});
