import { describe, it, expect } from 'vitest';
import { Hangul } from './hangul.js';

/**
 * Drive the automaton with a QWERTY string, the way the keyboard would.
 * A capital letter means Shift; '<' means Backspace.
 */
function type(s) {
  const h = new Hangul();
  for (const ch of s) {
    if (ch === ' ') { h.literal(' '); continue; }
    if (ch === '<') { h.backspace(); continue; }
    const j = Hangul.jamoFor(`Key${ch.toUpperCase()}`, ch !== ch.toLowerCase());
    if (j) h.jamo(j); else h.literal(ch);
  }
  return h.text;
}

describe('두벌식 composition', () => {
  it.each([
    ['dkssud', '안녕', 'two syllables, each with a final'],
    ['dkssudgktpdy', '안녕하세요', 'full greeting'],
    ['gksrnrdj', '한국어', 'a final blocks, then a vowel opens a new syllable'],
    ['gkskek', '하나다', 'steal rule: a final moves to the next initial'],
    ['dho', '왜', 'compound vowel ㅗ+ㅐ'],
    ['rhkrhkd', '과광', 'compound vowel, then a final'],
    ['Rkr', '깍', 'Shift doubles the consonant: ㄲ'],
    ['gks123', '한123', 'digits pass through as literals'],
    ['rhk ehl', '과 되', 'space commits the syllable'],
  ])('%s -> %s (%s)', (input, expected) => {
    expect(type(input)).toBe(expected);
  });

  it.each([
    ['ekfr', '닭', 'ㄹ+ㄱ = ㄺ'],
    ['qkfq', '밟', 'ㄹ+ㅂ = ㄼ'],
    ['dksw', '앉', 'ㄴ+ㅈ = ㄵ'],
  ])('compound final %s -> %s (%s)', (input, expected) => {
    expect(type(input)).toBe(expected);
  });

  it('splits a compound final so its second half steals forward', () => {
    expect(type('dkswl')).toBe('안지');
  });

  describe('backspace peels one jamo at a time', () => {
    it.each([
      ['dks<', '아', 'the final'],
      ['dks<<', 'ㅇ', 'the vowel'],
      ['dks<<<', '', 'the initial'],
      ['ekfr<', '달', 'half of a compound final'],
    ])('%s -> %s (%s)', (input, expected) => {
      expect(type(input)).toBe(expected);
    });

    it('reaches committed text once the syllable is gone', () => {
      // 하나다: two peels empty the in-flight 다, the third takes 나 off the
      // committed text behind it.
      expect(type('gkskek<<')).toBe('하나');
      expect(type('gkskek<<<')).toBe('하');
    });
  });

  it('leaves a bare vowel standing when there is no initial', () => {
    // ㅏ with nothing before it is not a syllable, so it stays a lone jamo
    // rather than being silently dropped.
    expect(type('k')).toBe('ㅏ');
  });

  it('reports the in-flight syllable separately from committed text', () => {
    const h = new Hangul();
    for (const code of ['KeyG', 'KeyK', 'KeyS']) h.jamo(Hangul.jamoFor(code, false));
    expect(h.committed).toBe('');
    expect(h.pending).toBe('한');
    h.flush();
    expect(h.committed).toBe('한');
    expect(h.pending).toBe('');
  });

  it('returns null for a key with no jamo, so callers can pass it through', () => {
    expect(Hangul.jamoFor('Digit1', false)).toBeNull();
    expect(Hangul.jamoFor('Space', false)).toBeNull();
    expect(Hangul.jamoFor('KeyQ', false)).toBe('ㅂ');
  });
});
