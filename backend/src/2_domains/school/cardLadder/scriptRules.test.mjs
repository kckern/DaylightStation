import { describe, expect, it } from 'vitest';
import { answersMatch, ruleFor, digitTokens } from './scriptRules.mjs';
import { isShortTarget, scoreTypedDeterministic } from './typedScore.mjs';
import { scriptFor, scriptOfText } from './targetScript.mjs';

const score = (targetScript, target, typed, otherWords = []) => scoreTypedDeterministic({ target, typed, otherWords, targetScript });

describe('scriptFor / scriptOfText — every script the ladder grades', () => {
  it('maps language codes to scripts', () => {
    expect(scriptFor('ko')).toBe('hangul');
    expect(scriptFor('en')).toBe('latin');
    expect(scriptFor('es-MX')).toBe('latin');
    expect(scriptFor('ru')).toBe('cyrillic');
    expect(scriptFor('el')).toBe('greek');
    expect(scriptFor('zh')).toBe('han');
    expect(scriptFor('ja')).toBe('kana');
    expect(scriptFor('ar')).toBe('arabic');
    expect(scriptFor('xx')).toBe('generic');
    expect(scriptFor(null)).toBe('generic');
  });
  it('reads the script off the text when no language is given', () => {
    expect(scriptOfText('가위')).toBe('hangul');
    expect(scriptOfText('ephemeral')).toBe('latin');
    expect(scriptOfText('кошка')).toBe('cyrillic');
    expect(scriptOfText('ねこ')).toBe('kana');
    expect(scriptOfText('1776')).toBe('generic');
  });
});

describe('latin — an English definitions deck (ephemeral / "lasting a very short time")', () => {
  const en = (typed, others = []) => score('latin', 'ephemeral', typed, others);
  it('case is never an error', () => {
    expect(en('Ephemeral')).toMatchObject({ score: 10, judge: 'exact' });
    expect(en('EPHEMERAL ')).toMatchObject({ score: 10, judge: 'exact' });
  });
  it('one typo in a 9-letter word is a pass (1/9 = the 20% band)', () => {
    expect(en('ephemeril')).toMatchObject({ judge: 'distance', distance: 1, length: 9, score: 6 });
    expect(en('Ephemeril').score).toBe(6);
  });
  it('a different real word is wrong, whatever its case', () => {
    expect(en('Eternal', ['eternal'])).toMatchObject({ score: 2, judge: 'guard' });
  });
  it('Hangul typed for an English target → 1', () => {
    expect(en('에페메랄')).toMatchObject({ score: 1, judge: 'wrong-script' });
  });
});

describe('latin — a Spanish deck: accents are a small slip', () => {
  it('café / cafe', () => {
    expect(score('latin', 'café', 'café')).toMatchObject({ score: 10, judge: 'exact' });
    expect(score('latin', 'café', 'Café')).toMatchObject({ score: 10, judge: 'exact' });
    expect(score('latin', 'café', 'cafe')).toMatchObject({ score: 8, judge: 'accent' });
  });
  it('niño / nino', () => {
    expect(score('latin', 'niño', 'nino')).toMatchObject({ score: 8, judge: 'accent' });
    expect(score('latin', 'niño', 'Niño')).toMatchObject({ score: 10 });
  });
  it('distance is counted with accents stripped', () => {
    expect(score('latin', 'niño', 'nini')).toMatchObject({ judge: 'distance', distance: 1, score: 6 });
  });
});

describe('numbers must match exactly, in every script — a history deck', () => {
  it('a year is a number, not a spelling', () => {
    expect(score('latin', '1776', '1776')).toMatchObject({ score: 10 });
    expect(score('latin', '1776', '1767')).toMatchObject({ score: 2, judge: 'number' });
    expect(score('latin', '1776', '1,776')).toMatchObject({ score: 10 });
  });
  it('words around a number grade as usual; the number itself must be right', () => {
    expect(score('latin', 'Magna Carta', 'magna carta')).toMatchObject({ score: 10 });
    expect(score('latin', 'Declaration of Independence (1776)', 'declaration of independence 1776')).toMatchObject({ score: 10 });
    expect(score('latin', 'Declaration of Independence (1776)', 'Declaration of Independence (1767)')).toMatchObject({ score: 2, judge: 'number' });
    expect(score('latin', 'Declaration of Independence (1776)', 'Declaration of Independence')).toMatchObject({ score: 2, judge: 'number' });
    expect(score('latin', 'Declaration of Independance (1776)', 'Declaration of Independance (1776)').score).toBe(10);
    expect(score('latin', 'Declaration of Independence (1776)', 'Declaration of Independance (1776)').score).toBe(8);
  });
  it('applies to a Hangul target too', () => {
    expect(score('hangul', '1945년', '1954년')).toMatchObject({ score: 2, judge: 'number' });
  });
  it('digitTokens reads the number tokens', () => {
    expect(digitTokens('Declaration (1776), 4 July')).toEqual(['1776', '4']);
  });
});

describe('generic scripts', () => {
  it('Cyrillic: Latin typed for a Russian word → 1; case-folded; graphemes', () => {
    expect(score('cyrillic', 'кошка', 'koshka')).toMatchObject({ score: 1, judge: 'wrong-script' });
    expect(score('cyrillic', 'кошка', 'Кошка')).toMatchObject({ score: 10 });
    expect(score('cyrillic', 'кошка', 'кошко')).toMatchObject({ judge: 'distance', distance: 1, length: 5 });
  });
  it('Japanese kana: counted in characters; ≤2 characters is short', () => {
    expect(score('kana', 'ねこ', 'ねこ')).toMatchObject({ score: 10 });
    expect(score('kana', 'ねこ', 'neko')).toMatchObject({ score: 1, judge: 'wrong-script' });
    expect(score('kana', 'ねこ', 'ねご')).toMatchObject({ judge: 'distance', distance: 1, length: 2, score: 6 });
    expect(score('kana', 'ありがとう', 'ありがと')).toMatchObject({ distance: 1, length: 5 });
    expect(isShortTarget('ねこ', 'kana')).toBe(true);
    expect(isShortTarget('ありがとう', 'kana')).toBe(false);
  });
  it('graphemes: a combining sequence is one unit', () => {
    expect(ruleFor('generic').units('éa')).toHaveLength(2);
  });
});

describe('answersMatch — copy steps use the script normalize', () => {
  it('case-folds a Latin copy, keeps Hangul unchanged', () => {
    expect(answersMatch('cat', 'Cat', 'latin')).toBe(true);
    expect(answersMatch('cafe', 'café', 'latin')).toBe(false);
    expect(answersMatch('가위 ', '가위', 'hangul')).toBe(true);
    expect(answersMatch('Cat', 'cat', null)).toBe(true);
  });
});

describe('the hangul rule keeps Korean keys byte-identical', () => {
  it('normalize IS normalizeAnswer', async () => {
    const { normalizeAnswer } = await import('./jamo.mjs');
    expect(ruleFor('hangul').normalize).toBe(normalizeAnswer);
    for (const text of [' 가이 ', '이름이 뭐예요?', '안녕히개새요 ']) expect(ruleFor('hangul').normalize(text)).toBe(normalizeAnswer(text));
  });
});
