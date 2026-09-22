import { describe, it, expect } from 'vitest';
import { scanNoticeDocument, rowList } from './scanNotices.mjs';
import { validateDocument } from './documentValidation.mjs';

const md = (doc) => doc.blocks.map((block) => block.md ?? '').join('\n');

describe('scanNoticeDocument', () => {
  it('prints nothing for a graded sheet — its receipt is printed elsewhere', () => {
    expect(scanNoticeDocument({ kind: 'scan-graded', testId: '5278294' })).toBeNull();
  });

  it("names the sheet, the count and the empty row for a partial (the 2026-09-15 morning)", () => {
    const doc = scanNoticeDocument({
      kind: 'scan-rows-incomplete', testId: '5278294', title: 'South Dakota',
      answered: 5, total: 6, blankRows: [33], ambiguousRows: [],
    });
    expect(validateDocument(doc).errors ?? []).toEqual([]);
    const text = md(doc);
    expect(text).toContain('# SOUTH DAKOTA — NOT FINISHED YET');
    expect(text).toContain('5 of 6 answered.');
    expect(text).toContain('Row 33 is still empty.');
    expect(text).toContain('Fill it in on your answer card. Then feed the card again.');
    expect(text).not.toMatch(/nothing new/i);
  });

  it('says "still not finished" on a duplicate feed of an unfinished card, never "nothing new"', () => {
    const doc = scanNoticeDocument({
      kind: 'scan-not-recorded', testId: '5278294',
      unfinished: [{ title: 'South Dakota', answered: 5, total: 6, blankRows: [33], ambiguousRows: [] }],
    });
    const text = md(doc);
    expect(text).toContain('# STILL NOT FINISHED');
    expect(text).toContain('**South Dakota**');
    expect(text).toContain('Row 33 is still empty.');
    expect(text).not.toMatch(/nothing new|already/i);
  });

  it('falls back to "nothing new to mark" on a duplicate feed with nothing unfinished', () => {
    const text = md(scanNoticeDocument({ kind: 'scan-not-recorded', testId: '5278294', unfinished: [] }));
    expect(text).toContain('# NOTHING NEW TO MARK');
    expect(text).toContain('ask a grown-up');
  });

  it('phrases double marks and plural rows the way the panel does', () => {
    const text = md(scanNoticeDocument({
      kind: 'scan-rows-incomplete', testId: '1', title: 'Cheetah', blankRows: [37, 38], ambiguousRows: [40],
    }));
    expect(text).toContain('Rows 37 and 38 are still empty.');
    expect(text).toContain('Row 40 has more than one answer marked — erase the extra.');
  });

  it('covers every other non-graded outcome with a slip', () => {
    const kinds = ['scan-rows-unmarked', 'scan-review', 'scan-unresolved', 'scan-refused', 'scan-stale-sheet', 'scan-answer-sheet-held'];
    for (const kind of kinds) {
      const doc = scanNoticeDocument({ kind, testId: '1', rowRange: { start: 43, end: 48 }, pendingReview: 2 });
      expect(doc, kind).not.toBeNull();
      expect(validateDocument(doc).errors ?? [], kind).toEqual([]);
      expect(md(doc).length, kind).toBeGreaterThan(20);
    }
    expect(md(scanNoticeDocument({ kind: 'scan-rows-unmarked', testId: '1', rowRange: { start: 43, end: 48 } })))
      .toContain('rows 43–48');
  });

  it('is silent on an unknown kind', () => {
    expect(scanNoticeDocument({ kind: 'something-else' })).toBeNull();
  });

  it('tells the truth about a key-alignment hold instead of "two answers filled in"', () => {
    const doc = scanNoticeDocument({
      kind: 'scan-review', testId: '5252427', title: 'New York', reasons: ['key-alignment-suspected'],
    });
    const text = md(doc);
    expect(text).toContain('# NEW YORK — NEEDS A GROWN-UP');
    expect(text).toContain('A grown-up is double-checking one of your answers.');
    expect(text).toContain('Ask them to take a look.');
    expect(text).not.toMatch(/two answers filled in/i);
  });

  it('keeps the original "two answers filled in" copy for an ambiguous-bubble hold (regression)', () => {
    const doc = scanNoticeDocument({
      kind: 'scan-review', testId: '5252427', title: 'New York', reasons: ['ambiguous'], pendingReview: 1,
    });
    const text = md(doc);
    expect(text).toContain('1 question had two answers filled in.');
    expect(text).toContain('Ask a grown-up to check it.');
    expect(text).not.toMatch(/double-checking/i);
  });

  /**
   * A sheet CAN legitimately carry `key-alignment-suspected` alongside
   * another reason: Task 2's guard against a still-mid-fill sheet is
   * blank-rows-only, and an ambiguous/multi-mark row is excluded from the
   * row SET the check compares (its raw scanned answer is an array, not a
   * string) rather than suppressing the whole check — so a genuinely
   * possible mix like `['key-alignment-suspected', 'free_response']` must
   * still fall through to the generic copy, never the key-alignment-only
   * one-liner (whole-branch review finding #5).
   */
  it('falls through to the generic "two answers filled in" copy for a mixed key-alignment + free_response hold', () => {
    const doc = scanNoticeDocument({
      kind: 'scan-review', testId: '5252427', title: 'New York',
      reasons: ['key-alignment-suspected', 'free_response'], pendingReview: 2,
    });
    const text = md(doc);
    expect(text).toContain('2 questions had two answers filled in.');
    expect(text).toContain('Ask a grown-up to check it.');
    expect(text).not.toMatch(/double-checking/i);
  });
});

describe('rowList', () => {
  it('formats one, two and many rows', () => {
    expect(rowList([33])).toBe('Row 33');
    expect(rowList([31, 33])).toBe('Rows 31 and 33');
    expect(rowList([33, 31, 32])).toBe('Rows 31, 32 and 33');
    expect(rowList([])).toBeNull();
  });
});
