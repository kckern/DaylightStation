import { describe, expect, it } from 'vitest';
import { typeableText } from './typeableText.mjs';

describe('typeableText', () => {
  it('drops the speaker markers no key can type, keeping the sentence around them', () => {
    // The sentence a learner was stuck on, 2026-09-14.
    expect(typeableText('♂형과 (♀오빠와) 저는 테니스를 잘 쳐요.')).toBe('형과 (오빠와) 저는 테니스를 잘 쳐요.');
    expect(typeableText('제 ♂형(♀오빠)과 ♂형수(♀새언니)는')).toBe('제 형(오빠)과 형수(새언니)는');
  });

  it('maps typographic punctuation to what the keyboard types', () => {
    expect(typeableText('His mother’s at home.')).toBe("His mother's at home.");
    expect(typeableText('무슨 일을 해요? — 치과의사예요.')).toBe('무슨 일을 해요? - 치과의사예요.');
    expect(typeableText('“Hi…”')).toBe('"Hi..."');
    expect(typeableText('정말？')).toBe('정말?');
  });

  it('drops emoji and other symbols, then tidies the spaces they leave', () => {
    expect(typeableText('좋아요 😀 ★ 네')).toBe('좋아요 네');
    expect(typeableText('  두  칸 띄기  ')).toBe('두 칸 띄기');
  });

  it('keeps Hangul, jamo, ASCII letters, digits and ASCII punctuation untouched', () => {
    expect(typeableText('ㄱㄴ 한국어 ABC abc 123 .,?!:;()-\'"')).toBe('ㄱㄴ 한국어 ABC abc 123 .,?!:;()-\'"');
  });

  it('treats a missing sentence as nothing to type', () => {
    expect(typeableText(null)).toBe('');
    expect(typeableText(undefined)).toBe('');
    expect(typeableText('♂♀')).toBe('');
  });
});
