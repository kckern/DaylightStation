import { describe, it, expect } from 'vitest';
import {
  emptyPieces, spanOf, canCut, addCut, setTake, isLast, pieceVerdict, totalMs, allHeard, MIN_PIECE_MS,
} from './pieces.js';

const take = (durationMs, heard = true) => ({ blob: new Blob(['x']), durationMs, heard });

describe('spans', () => {
  it('a sentence with no cut is one open-ended piece', () => {
    expect(spanOf(emptyPieces(), 0)).toEqual({ fromMs: 0, toMs: null });
    expect(isLast(emptyPieces(), 0)).toBe(true);
  });

  it('two cuts make three pieces, the last open-ended', () => {
    const s = addCut(addCut(emptyPieces(), 1100), 2600);
    expect([0, 1, 2].map((i) => spanOf(s, i))).toEqual([
      { fromMs: 0, toMs: 1100 }, { fromMs: 1100, toMs: 2600 }, { fromMs: 2600, toMs: null },
    ]);
    expect([0, 1, 2].map((i) => isLast(s, i))).toEqual([false, false, true]);
  });
});

describe('canCut', () => {
  it('cuts only an open-ended span, and not in its first moments', () => {
    const s = addCut(emptyPieces(), 1100);
    expect(canCut(s, 0, 500)).toBe(false);   // piece 0 already ends at 1100
    expect(canCut(s, 1, 1200)).toBe(false);  // 100ms into piece 1: too soon
    expect(canCut(s, 1, 1500)).toBe(true);
  });
});

describe('takes', () => {
  it('redoing a piece replaces its take and nothing else', () => {
    const first = take(900);
    let s = setTake(setTake(addCut(emptyPieces(), 1100), 0, first), 1, take(800));
    const redo = take(1000);
    s = setTake(s, 1, redo);
    expect(s.takes).toEqual([first, redo]);
    expect(totalMs(s)).toBe(1900);
    expect(allHeard(s)).toBe(true);
  });
});

describe('pieceVerdict', () => {
  it('refuses silence only when loudness could be measured', () => {
    expect(pieceVerdict({ durationMs: 900, heard: false, measurable: true })).toBe('too-quiet');
    expect(pieceVerdict({ durationMs: 900, heard: false, measurable: false })).toBeNull();
  });

  it('allows a short phrase but not a tap', () => {
    expect(pieceVerdict({ durationMs: MIN_PIECE_MS, heard: true, measurable: true })).toBeNull();
    expect(pieceVerdict({ durationMs: MIN_PIECE_MS - 1, heard: true, measurable: true })).toBe('too-short');
  });
});
