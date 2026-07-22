import { describe, it, expect } from 'vitest';
import { diffChars } from './textDiff.js';

const text = (parts, type) => parts.filter((p) => p.type === type).map((p) => p.text).join('');

describe('diffChars', () => {
  it('reports an exact match as entirely unchanged', () => {
    const parts = diffChars('오늘 날씨가 좋아요.', '오늘 날씨가 좋아요.');
    expect(parts).toEqual([{ type: 'same', text: '오늘 날씨가 좋아요.' }]);
  });

  it('isolates a single substituted syllable', () => {
    const parts = diffChars('좋아요', '조아요');
    expect(text(parts, 'removed')).toBe('좋');
    expect(text(parts, 'added')).toBe('조');
    expect(text(parts, 'same')).toBe('아요');
  });

  it('marks a missing tail as removed', () => {
    const parts = diffChars('오늘 날씨가 좋아요.', '오늘 날씨가');
    expect(text(parts, 'added')).toBe('');
    expect(text(parts, 'removed')).toBe(' 좋아요.');
  });

  it('marks extra text as added', () => {
    const parts = diffChars('저는', '저는 부자');
    expect(text(parts, 'added')).toBe(' 부자');
  });

  it('reconstructs both sides exactly', () => {
    const expected = '이 가방은 무거워요.';
    const given = '이 가방이 무거wo요';
    const parts = diffChars(expected, given);
    const rebuiltExpected = parts.filter((p) => p.type !== 'added').map((p) => p.text).join('');
    const rebuiltGiven = parts.filter((p) => p.type !== 'removed').map((p) => p.text).join('');
    expect(rebuiltExpected).toBe(expected);
    expect(rebuiltGiven).toBe(given);
  });

  it('coalesces runs instead of emitting one part per character', () => {
    const parts = diffChars('abc', 'xyz');
    expect(parts).toHaveLength(2);
  });

  it('treats an astral character as one unit', () => {
    // Splitting a surrogate pair would render as replacement characters.
    const parts = diffChars('a👍b', 'ab');
    expect(text(parts, 'removed')).toBe('👍');
  });

  it('handles empty sides without throwing', () => {
    expect(diffChars('', '')).toEqual([]);
    expect(text(diffChars('', 'abc'), 'added')).toBe('abc');
    expect(text(diffChars('abc', ''), 'removed')).toBe('abc');
    expect(diffChars(null, undefined)).toEqual([]);
  });
});
