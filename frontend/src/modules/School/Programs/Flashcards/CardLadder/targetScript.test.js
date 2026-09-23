import { describe, expect, it } from 'vitest';
import JamoKeypad from './JamoKeypad.jsx';
import { keypadFor, scriptFor, sidesFromOpen } from './targetScript.js';

describe('targetScript', () => {
  it('maps Korean to hangul and everything else to generic', () => {
    expect(scriptFor('ko')).toBe('hangul');
    expect(scriptFor('ko-KR')).toBe('hangul');
    expect(scriptFor('en')).toBe('generic');
    expect(scriptFor(null)).toBe('generic');
  });
  it('only Hangul has an on-screen keypad', () => {
    expect(keypadFor('hangul')).toBe(JamoKeypad);
    expect(keypadFor('generic')).toBeNull();
  });
  it('reads target/anchor from an open response, falling back to language/gloss', () => {
    expect(sidesFromOpen({ target: { code: 'en', script: 'generic' }, anchor: { code: 'en' } }))
      .toEqual({ target: 'en', anchor: 'en', targetScript: 'generic' });
    expect(sidesFromOpen({ language: { code: 'ko' }, gloss: { code: 'en' } }))
      .toEqual({ target: 'ko', anchor: 'en', targetScript: 'hangul' });
  });
});
