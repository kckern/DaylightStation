import { describe, it, expect } from 'vitest';
import { modeForLanguage, canCompose, normalizeLanguage } from './languages.js';

describe('languages registry', () => {
  it('treats the BCP-47 code ko as Korean', () => {
    expect(modeForLanguage('ko')).toBe('KR');
    expect(canCompose('ko')).toBe(true);
  });

  it('treats a region-tagged ko-KR as Korean', () => {
    expect(modeForLanguage('ko-KR')).toBe('KR');
  });

  it("keeps the sentence ladder's corpus code KR working", () => {
    expect(modeForLanguage('KR')).toBe('KR');
    expect(modeForLanguage('kr')).toBe('KR');
  });

  it('declares English for a language it cannot compose', () => {
    expect(modeForLanguage('en')).toBe('EN');
    expect(modeForLanguage('EN-US')).toBe('EN');
    expect(canCompose('en')).toBe(false);
  });

  it('declares nothing for a field with no language', () => {
    expect(modeForLanguage('')).toBe(null);
    expect(modeForLanguage(undefined)).toBe(null);
    expect(normalizeLanguage(null)).toBe(null);
  });
});
