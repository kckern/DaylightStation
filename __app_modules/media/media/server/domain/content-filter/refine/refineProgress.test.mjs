import { describe, expect, it } from 'vitest';
import { foldProgress, parseRefineLine } from './refineProgress.mjs';

describe('parseRefineLine', () => {
  it('reads the phases refine announces', () => {
    expect(parseRefineLine('Transcribing (word timestamps)… this runs once per part.')).toEqual({ phase: 'transcribe' });
    expect(parseRefineLine('Sync: local = va x 0.999988 + 1.105 s (70/74 word pairs, median residual 1.483 s)')).toEqual({ phase: 'sync' });
  });
  it('reads a measured cue', () => {
    expect(parseRefineLine('  [3/220] va4929911 visual unknown edge-all-unsure')).toEqual({
      phase: 'measure', done: 3, total: 220, cue: 'va4929911', kind: 'visual', status: 'unknown', detail: 'edge-all-unsure',
    });
    expect(parseRefineLine('  [4/6] va4930062 visual refined 396.897–400.609')).toMatchObject({ status: 'refined', detail: '396.897–400.609' });
  });
  it('ignores everything else', () => {
    for (const l of ['220 cues in 400 s: 5 refined', '', '✓ refined EDL (95 refined', '{"event":"content-filter.source.chosen"}']) expect(parseRefineLine(l)).toBeNull();
  });
});

describe('foldProgress', () => {
  it('keeps the phase, counts, the first measure time and the newest 8 outcomes first', () => {
    let p = foldProgress(null, parseRefineLine('Sync: x'), '2026-11-12T10:00:00.000Z');
    expect(p).toMatchObject({ phase: 'sync', done: 0, total: null, firstAt: null, recent: [] });
    for (let i = 1; i <= 10; i++) p = foldProgress(p, parseRefineLine(`  [${i}/220] va${i} visual unknown x`), `2026-11-12T10:0${i % 10}:00.000Z`);
    expect(p).toMatchObject({ phase: 'measure', done: 10, total: 220, firstAt: '2026-11-12T10:01:00.000Z' });
    expect(p.recent).toHaveLength(8);
    expect(p.recent[0]).toEqual({ cue: 'va10', kind: 'visual', status: 'unknown', detail: 'x' });
  });
  it('a null line changes nothing', () => {
    const p = foldProgress(null, parseRefineLine('Sync: x'), 'a');
    expect(foldProgress(p, null, 'b')).toBe(p);
  });
});
