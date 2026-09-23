import { describe, expect, it } from 'vitest';
import { keystrokeUnits, scriptFor, scriptOfText, writtenInScript } from './targetScript.mjs';

describe('targetScript', () => {
  it('scriptFor maps a language code to its script', () => {
    expect(scriptFor('ko')).toBe('hangul');
    expect(scriptFor('ko-KR')).toBe('hangul');
    expect(scriptFor('en')).toBe('latin');
    expect(scriptFor('es')).toBe('latin');
    expect(scriptFor(undefined)).toBe('generic');
  });
  it('scriptOfText reads the script off the text', () => {
    expect(scriptOfText('가위')).toBe('hangul');
    expect(scriptOfText('scissors')).toBe('latin');
  });
  it('keystroke units: jamo keystrokes for Hangul, accent-stripped letters for Latin, graphemes otherwise', () => {
    expect(keystrokeUnits('café', 'latin')).toEqual(['c', 'a', 'f', 'e']);
    expect(keystrokeUnits('위', 'hangul')).toEqual(['ㅇ', 'ㅜ', 'ㅣ']);
    expect(keystrokeUnits('위', 'generic')).toEqual(['위']);
    expect(keystrokeUnits('café', 'generic')).toEqual(['c', 'a', 'f', 'é']);
  });
  it('a known script has a written-in-script floor; generic has none', () => {
    expect(writtenInScript('에페메랄', 'latin')).toBe(false);
    expect(writtenInScript('koshka', 'cyrillic')).toBe(false);
    expect(writtenInScript('scissors', 'hangul')).toBe(false);
    expect(writtenInScript('가위', 'hangul')).toBe(true);
    expect(writtenInScript('scissors', 'generic')).toBe(true);
    expect(writtenInScript('', 'generic')).toBe(true);
  });
});
