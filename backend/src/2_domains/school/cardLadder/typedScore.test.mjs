import { describe, expect, it } from 'vitest';
import { isShortTarget, modelMayRaise, raiseOneBand, scoreTypedDeterministic } from './typedScore.mjs';

const s = (target, typed, otherWords = []) => scoreTypedDeterministic({ target, typed, otherWords });

describe('scoreTypedDeterministic', () => {
  it('exact after normalisation → 10', () => {
    expect(s('이름이 뭐예요?', '이름이뭐예요')).toMatchObject({ score: 10, judge: 'exact' });
  });
  it('no Hangul → 1', () => {
    expect(s('가위', 'scissors')).toMatchObject({ score: 1, judge: 'no-hangul' });
    expect(s('가위', '')).toMatchObject({ score: 1, judge: 'no-hangul' });
  });
  it('a different real word → 2 even one letter off', () => {
    expect(s('풀', '불', ['불', '책'])).toMatchObject({ score: 2, judge: 'guard' });
    expect(s('연필', '색연필', ['색연필'])).toMatchObject({ score: 2, judge: 'guard' });
  });
  it('short targets: one keystroke → 6, two → 2', () => {
    expect(s('풀', '푸')).toMatchObject({ score: 6, judge: 'distance', distance: 1, length: 3 });
    expect(s('풀', '부')).toMatchObject({ score: 2 });
  });
  it('longer targets use percentage bands', () => {
    expect(s('가위', '가이')).toMatchObject({ score: 6, distance: 1, length: 5 });
    expect(s('안녕히계세요', '안녕히게세요').score).toBe(8);
    expect(s('안녕히계세요', '안녕').score).toBe(2);
  });
  it('short target detection and model rules', () => {
    expect(isShortTarget('가위')).toBe(true);
    expect(isShortTarget('선생님')).toBe(false);
    expect(modelMayRaise({ score: 4, distance: 4, length: 15 })).toBe(true);
    expect(modelMayRaise({ score: 2, distance: 9, length: 15 })).toBe(false);
    expect(modelMayRaise({ score: 4, distance: 6, length: 15 })).toBe(false);
    expect(raiseOneBand(4)).toBe(6);
    expect(raiseOneBand(10)).toBe(10);
  });
});
