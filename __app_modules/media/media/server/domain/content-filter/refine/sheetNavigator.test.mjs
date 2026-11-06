import { describe, expect, it } from 'vitest';
import { createSheetSearch, nextMove, viewFrames } from './sheetNavigator.mjs';

/** Run a search to completion against a truth predicate. */
function runSearch(opts, present, { maxLooks = 40 } = {}) {
  let search = createSheetSearch(opts);
  for (let i = 0; i < maxLooks; i++) {
    const verdicts = viewFrames(search).map((f) => present(f));
    const r = nextMove(search, verdicts);
    search = r.search;
    if (r.action === 'done' || r.action === 'unknown' || r.action === 'giveup') return { ...r, looks: i + 1, search };
  }
  throw new Error('search did not end');
}

const inRange = (a, b) => (f) => f >= a && f <= b;
const base = { minFrame: 0, maxFrame: 200000 };

describe('sheet search', () => {
  it('finds the exact first frame from a rough expectation', () => {
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 15800 }, inRange(15791, 15835));
    expect(r.action).toBe('done');
    expect(r.frame).toBe(15791);
    expect(r.looks).toBeLessThanOrEqual(6);
  });

  it('finds the exact last frame', () => {
    const r = runSearch({ ...base, kind: 'end', expectedFrame: 15800 }, inRange(15791, 15835));
    expect(r).toMatchObject({ action: 'done', frame: 15835 });
  });

  it('pans earlier when the content is already on screen across the sheet', () => {
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 20000 }, inRange(19700, 20400));
    expect(r).toMatchObject({ action: 'done', frame: 19700 });
    expect(r.search.path.some((p) => p.action === 'earlier')).toBe(true);
  });

  it('sweeps outward from an empty sheet and finds content off to one side', () => {
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 30000 }, inRange(29700, 29760));
    expect(r).toMatchObject({ action: 'done', frame: 29700 });
  });

  it('gives up when the content is nowhere in range', () => {
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 40000, minFrame: 39500, maxFrame: 40500 }, () => false);
    expect(r).toMatchObject({ action: 'giveup', reason: 'not-found' });
  });

  it('reports an abstain at the deciding tile as unknown', () => {
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 15800 }, (f) => (f < 15791 ? false : f < 15800 ? null : true));
    expect(['unknown', 'done']).toContain(r.action);
    if (r.action === 'done') expect(r.frame).toBeGreaterThanOrEqual(15791);
  });

  it('stops on the move budget', () => {
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 100000, maxMoves: 2 }, inRange(90000, 110000));
    expect(r).toMatchObject({ action: 'unknown', reason: 'budget' });
  });

  it('flags a flickering sheet', () => {
    const truth = (f) => (f >= 15700 && f <= 15720) || (f >= 15760 && f <= 15900);
    let search = createSheetSearch({ ...base, kind: 'start', expectedFrame: 15770, initialStep: 12 });
    const r = nextMove(search, viewFrames(search).map(truth));
    expect(['zoom', 'earlier']).toContain(r.action);
  });
});

describe('sheet search with probabilities', () => {
  it('zooms through an unsure ramp and settles at the 0.5 crossing', () => {
    // Probability ramps from 0.2 to 0.9 across frames 18650..18662; true start 18655
    const p = (f) => (f < 18650 ? 0.15 : f > 18662 ? 0.85 : 0.2 + ((f - 18650) / 12) * 0.65);
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 18640 }, p);
    expect(r.action).toBe('done');
    expect(Math.abs(r.frame - 18655)).toBeLessThanOrEqual(1);
    expect(r.soft).toBe(true);
  });

  it('calls a long unsure stretch unknown', () => {
    const p = (f) => (f < 1000 ? 0.1 : f > 1030 ? 0.9 : 0.5);
    const r = runSearch({ ...base, kind: 'start', expectedFrame: 1000 }, p);
    expect(['unknown', 'done']).toContain(r.action);
    if (r.action === 'unknown') expect(r.reason).toBe('wide-unsure');
  });
});

describe('changePoint', () => {
  it('splits a noisy single-frame ramp without needing a confident yes', async () => {
    const { changePoint } = await import('./sheetNavigator.mjs');
    // search order: absent first. End-of-kiss sheet read backwards: lows then 0.48, 0.63
    expect(changePoint([0.13, 0.15, 0.18, 0.16, 0.14, 0.16, 0.16, 0.17, 0.18, 0.2, 0.48, 0.63])).toEqual({ k: 11, soft: true });
    expect(changePoint([0.1, 0.1, 0.1, 0.9, 0.9, 0.9])).toEqual({ k: 3, soft: false });
    expect(changePoint([0.5, 0.5, 0.5, 0.5])).toBeNull();
    expect(changePoint([0.9, 0.9, 0.9, 0.9])).toBeNull();
  });
});

describe('bracketed fallback', () => {
  it('returns a soft midpoint with an uncertainty when a fuzzy edge is bracketed', () => {
    // Present up to 116714, a fuzzy 0.5 plateau 116715-116725, absent from 116726
    const p = (f) => (f <= 116714 ? 0.8 : f <= 116725 ? 0.5 : 0.1);
    const r = runSearch({ ...base, kind: 'end', expectedFrame: 116716, yes: 0.6, no: 0.3 }, p);
    expect(r.action).toBe('done');
    expect(r.soft).toBe(true);
    expect(r.frame).toBeGreaterThanOrEqual(116714);
    expect(r.frame).toBeLessThanOrEqual(116726);
    expect(r.uncertainty).toBeLessThanOrEqual(8);
  });
});
