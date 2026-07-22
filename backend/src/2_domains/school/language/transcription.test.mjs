/**
 * Transcription tests. Accuracy is informational — it gates nothing — so these
 * assert faithfulness of the comparison, not a pass/fail policy.
 */
import { describe, it, expect } from 'vitest';
import { normalize, editDistance, accuracy, isCloseEnough } from './transcription.mjs';

describe('normalize', () => {
  it('trims and collapses whitespace', () => {
    expect(normalize('  오늘   날씨가 좋아요.  ')).toBe('오늘 날씨가 좋아요.');
  });

  it('casefolds for source-language answers', () => {
    expect(normalize('The Weather')).toBe('the weather');
  });

  it('leaves Hangul untouched', () => {
    expect(normalize('오늘')).toBe('오늘');
  });

  it('handles null and undefined without throwing', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('오늘', '오늘')).toBe(0);
  });

  it('counts a single substitution once', () => {
    expect(editDistance('좋아요', '조아요')).toBe(1);
  });

  it('falls back to length when one side is empty', () => {
    expect(editDistance('', '오늘')).toBe(2);
    expect(editDistance('오늘', '')).toBe(2);
  });

  it('counts astral characters as one, not two', () => {
    // Naive UTF-16 indexing would report 2 here and skew every score that
    // contains an emoji.
    expect(editDistance('👍', '')).toBe(1);
  });
});

describe('accuracy', () => {
  it('is 1 for an exact match', () => {
    expect(accuracy('오늘 날씨가 좋아요.', '오늘 날씨가 좋아요.')).toBe(1);
  });

  it('is 1 for a match differing only in spacing', () => {
    expect(accuracy(' 오늘  날씨가 좋아요. ', '오늘 날씨가 좋아요.')).toBe(1);
  });

  it('degrades gracefully for a near miss', () => {
    const score = accuracy('오늘 날씨가 조아요.', '오늘 날씨가 좋아요.');
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1);
  });

  it('is 0 for an empty answer against real text', () => {
    expect(accuracy('', '오늘 날씨가 좋아요.')).toBe(0);
  });

  it('is 1 when both sides are empty rather than dividing by zero', () => {
    expect(accuracy('', '')).toBe(1);
    expect(accuracy(null, undefined)).toBe(1);
  });

  it('never returns a negative score', () => {
    expect(accuracy('completely unrelated text here', '짧다')).toBeGreaterThanOrEqual(0);
  });
});

describe('isCloseEnough', () => {
  it('accepts a one-character slip in a long sentence', () => {
    expect(isCloseEnough('오늘 날씨가 조아요.', '오늘 날씨가 좋아요.')).toBe(true);
  });

  it('rejects an answer that is mostly wrong', () => {
    expect(isCloseEnough('모르겠어요', '오늘 날씨가 좋아요.')).toBe(false);
  });
});
