import { describe, it, expect } from 'vitest';
import { isViablePrefix, isTraceableTarget } from './syllable.js';
import { Hangul, decompose } from './hangul.js';

describe('isViablePrefix', () => {
  it('accepts the jamo that build the target, in order', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: null, jong: null }, '오')).toBe(true);
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: null }, '오')).toBe(true);
  });
  it('rejects a wrong initial on the very first jamo', () => {
    expect(isViablePrefix({ cho: 'ㅁ', jung: null, jong: null }, '오')).toBe(false);
  });
  it('rejects a batchim the target does not have', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: 'ㄴ' }, '오')).toBe(false);
  });
  it('accepts a batchim the target does have', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: 'ㄴ' }, '온')).toBe(true);
  });
  // A bare jamo target (ㄱ on its own) and a non-Hangul target are both "anything
  // goes": the gate must never refuse a key it cannot reason about.
  it('permits anything against a target it cannot decompose', () => {
    expect(isViablePrefix({ cho: 'ㅁ', jung: null, jong: null }, 'a')).toBe(true);
  });
});

describe('isViablePrefix through a compound vowel and a compound final', () => {
  // 왔 = ㅇ + ㅘ + ㅆ. The compound halves are intermediate states the automaton
  // really passes through, and each one has to stay viable or the child is
  // refused halfway through a jamo they are typing correctly.
  it('accepts ㅗ on the way to ㅘ only once it has joined', () => {
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅗ', jong: null }, '왔')).toBe(false);
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅘ', jong: null }, '왔')).toBe(true);
    expect(isViablePrefix({ cho: 'ㅇ', jung: 'ㅘ', jong: 'ㅆ' }, '왔')).toBe(true);
  });

  // 닭 = ㄷ + ㅏ + ㄺ, and ㄺ is typed as ㄹ then ㄱ. The lone ㄹ is a real
  // batchim of a real syllable (달), so it must be judged against the target
  // rather than assumed wrong for not being the finished compound.
  it('refuses the half-typed compound final, which is a defensible design call', () => {
    expect(isViablePrefix({ cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄹ' }, '닭')).toBe(false);
    expect(isViablePrefix({ cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄺ' }, '닭')).toBe(true);
  });
});

describe('isViablePrefix fails open', () => {
  it.each([null, undefined, '', 'ㄱ', 'ab', '오늘', ' ', '1'])('permits everything against %p', (target) => {
    expect(isViablePrefix({ cho: 'ㅁ', jung: null, jong: null }, target)).toBe(true);
    expect(isViablePrefix({ cho: 'ㅁ', jung: 'ㅏ', jong: 'ㄴ' }, target)).toBe(true);
  });

  it('treats nothing in flight as a prefix of any syllable', () => {
    expect(isViablePrefix({ cho: null, jung: null, jong: null }, '오')).toBe(true);
    expect(isViablePrefix(null, '오')).toBe(true);
    expect(isViablePrefix({}, '오')).toBe(true);
  });
});

describe('isTraceableTarget', () => {
  it.each(['오', '늘', '왔', '닭', '한'])('%s is one precomposed syllable', (s) => {
    expect(isTraceableTarget(s)).toBe(true);
  });
  it.each([null, undefined, '', 'ㄱ', 'ㅏ', 'a', '오늘', ' '])('%p is not', (s) => {
    expect(isTraceableTarget(s)).toBe(false);
  });
});

/**
 * `decompose` is claimed to be the exact inverse of the arithmetic in
 * `Hangul#pending`. Claimed is not proven, and a decomposition that disagrees
 * with the composition it mirrors would misjudge only the syllables nobody
 * happened to type while testing. So: round-trip every syllable there is.
 */
describe('decompose round-trips the whole precomposed block', () => {
  it('rebuilds all 11172 syllables from the jamo it reports', () => {
    const mismatches = [];
    for (let code = 0xac00; code <= 0xd7a3; code += 1) {
      const syllable = String.fromCodePoint(code);
      const parts = decompose(syllable);
      const h = new Hangul();
      h.cho = parts.cho;
      h.jung = parts.jung;
      h.jong = parts.jong;
      if (h.pending !== syllable) mismatches.push(syllable);
    }
    expect(mismatches).toEqual([]);
  });

  it('reports a batchim-less syllable as jong: null, not an empty string', () => {
    expect(decompose('오')).toEqual({ cho: 'ㅇ', jung: 'ㅗ', jong: null });
    expect(decompose('온')).toEqual({ cho: 'ㅇ', jung: 'ㅗ', jong: 'ㄴ' });
  });

  it.each([null, undefined, 5, '', 'a', 'ㄱ', '오늘'])('returns null for %p', (input) => {
    expect(decompose(input)).toBeNull();
  });
});
