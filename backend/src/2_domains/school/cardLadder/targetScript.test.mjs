import { describe, expect, it } from 'vitest';
import { keystrokeUnits, scriptFor, scriptOfText, writtenInScript } from './targetScript.mjs';

describe('targetScript', () => {
  it('scriptFor maps a language code to its script', () => {
    expect(scriptFor('ko')).toBe('hangul');
    expect(scriptFor('ko-KR')).toBe('hangul');
    expect(scriptFor('en')).toBe('generic');
    expect(scriptFor('es')).toBe('generic');
    expect(scriptFor(undefined)).toBe('generic');
  });
  it('scriptOfText reads Hangul off the text', () => {
    expect(scriptOfText('가위')).toBe('hangul');
    expect(scriptOfText('scissors')).toBe('generic');
  });
  it('keystroke units: jamo keystrokes for Hangul, code points otherwise', () => {
    expect(keystrokeUnits('위', 'hangul')).toEqual(['ㅇ', 'ㅜ', 'ㅣ']);
    expect(keystrokeUnits('위', 'generic')).toEqual(['위']);
    expect(keystrokeUnits('café', 'generic')).toEqual(['c', 'a', 'f', 'é']);
  });
  it('only Hangul has a written-in-script floor', () => {
    expect(writtenInScript('scissors', 'hangul')).toBe(false);
    expect(writtenInScript('가위', 'hangul')).toBe(true);
    expect(writtenInScript('scissors', 'generic')).toBe(true);
    expect(writtenInScript('', 'generic')).toBe(true);
  });
});
