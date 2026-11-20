import { describe, it, expect } from 'vitest';
import { calibrate, eligibility, main, parseArgs } from './piano-segment-calibrate.cli.mjs';
import { compactFeatures, FEATURE_KEYS } from '../portable/music/phraseSegments.mjs';

/** 8 bars, held notes closing bars 4 and 8: the heuristic cuts after bar 4. */
function rows() {
  return compactFeatures(Array.from({ length: 7 }, (_, k) => ({
    after: k, tailGapQuarters: k === 3 ? 4 : 1, tailGapRatio: k === 3 ? 1 : 0.25, sectionStart: false, bassMotion: null, densityChange: 0, restBar: false,
  })));
}
const learnFile = (proposal, segments = [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]) => ({
  version: 1, scoreId: 'files:docs/sheet-music/x.musicxml', contentSha256: 'sha', segments,
  approved: { at: 't', ...(proposal ? { proposal } : {}) },
});
const manual = (extra = {}) => ({ scorer: 'manual', at: 't', featureKeys: [...FEATURE_KEYS], features: rows(), contentSha256: 'sha', ...extra });

describe('piano-segment-calibrate', () => {
  it('counts only hand-made approvals that kept their features', () => {
    expect(eligibility(learnFile(manual()))).toBe('eligible');
    expect(eligibility(learnFile({ ...manual(), scorer: 'heuristic', edited: true }))).toBe('edited-proposal');
    expect(eligibility(learnFile({ ...manual(), scorer: 'heuristic' }))).toBe('scorer-cut');
    expect(eligibility(learnFile(null))).toBe('no-provenance');
    expect(eligibility(learnFile({ scorer: 'manual', at: 't' }))).toBe('no-features');
    expect(eligibility(learnFile(manual({ contentSha256: 'older' })))).toBe('features-from-another-version');
    expect(eligibility({ segments: [] })).toBe('not-approved');
  });

  it('scores the heuristic against the approved cuts, per piece and overall', () => {
    const result = calibrate([
      { name: 'agrees.yml', file: learnFile(manual()) },
      { name: 'differs.yml', file: learnFile(manual(), [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 2, end: 7 }]) },
      { name: 'auto.yml', file: learnFile({ ...manual(), scorer: 'heuristic' }) },
      { name: 'edited.yml', file: learnFile({ ...manual(), scorer: 'heuristic', edited: true }) },
    ]);
    expect(result.pieces.map((p) => [p.name, p.tp, p.fp, p.fn])).toEqual([['agrees.yml', 1, 0, 0], ['differs.yml', 0, 1, 1]]);
    expect(result.overall).toEqual({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5, nearPrecision: 0.5, nearRecall: 0.5 });
    expect(result.edited.map((p) => p.name)).toEqual(['edited.yml']);
    expect(result.skipped).toEqual({ 'scorer-cut': 1, 'edited-proposal': 1 });
  });

  it('counts a gap in the hand-cut segments as boundaries on both sides', () => {
    const result = calibrate([{ name: 'gap.yml', file: learnFile(manual(), [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 6, end: 7 }]) }]);
    expect(result.pieces[0]).toMatchObject({ tp: 1, fp: 0, fn: 1 });
  });

  it('exits 3 with a clear message when fewer than 4 pieces qualify', async () => {
    const out = []; const err = [];
    const code = await main(['--dir', '/x'], {
      stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) },
      readFiles: () => [{ name: 'a.yml', file: learnFile(manual()) }],
    });
    expect(code).toBe(3);
    expect(err.join('')).toMatch(/Only 1 hand-segmented piece\(s\).*needs 4/);
  });

  it('exits 0 with enough pieces', async () => {
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.yml`, file: learnFile(manual()) }));
    const out = [];
    const code = await main(['--dir', '/x', '--json'], { stdout: { write: (s) => out.push(s) }, stderr: { write: () => {} }, readFiles: () => files });
    expect(code).toBe(0);
    expect(JSON.parse(out.join('')).overall.precision).toBe(1);
  });

  it('parses its flags and refuses unknown ones', () => {
    expect(parseArgs(['--target', '6', '--min', '2', '--json'])).toMatchObject({ target: 6, min: 2, json: true });
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown/);
    expect(() => parseArgs(['--target', 'x'])).toThrow(/whole number/);
  });
});
