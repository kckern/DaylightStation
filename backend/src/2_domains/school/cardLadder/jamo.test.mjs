import { describe, expect, it } from 'vitest';
import { hasHangul, keystrokeJamo, normalizeAnswer } from './jamo.mjs';

describe('jamo', () => {
  it('normalises spacing, punctuation and NFC; caps at 40 chars', () => {
    expect(normalizeAnswer(' 이름이 뭐예요? ')).toBe('이름이뭐예요');
    expect(normalizeAnswer('안녕!!')).toBe('안녕');
    expect(normalizeAnswer('가'.repeat(60)).length).toBe(40);
  });
  it('detects Hangul', () => {
    expect(hasHangul('scissors')).toBe(false);
    expect(hasHangul('')).toBe(false);
    expect(hasHangul('ㄱ')).toBe(true);
    expect(hasHangul('가위')).toBe(true);
  });
  it('splits compound vowels and finals into keystrokes', () => {
    expect(keystrokeJamo('가위')).toEqual(['ㄱ', 'ㅏ', 'ㅇ', 'ㅜ', 'ㅣ']);
    expect(keystrokeJamo('풀')).toEqual(['ㅍ', 'ㅜ', 'ㄹ']);
    expect(keystrokeJamo('닭')).toEqual(['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ']);
    expect(keystrokeJamo('의')).toEqual(['ㅇ', 'ㅡ', 'ㅣ']);
  });
  it('keeps tense consonants and ㅒ/ㅖ single', () => {
    expect(keystrokeJamo('빵')).toEqual(['ㅃ', 'ㅏ', 'ㅇ']);
    expect(keystrokeJamo('계')).toEqual(['ㄱ', 'ㅖ']);
  });
});
