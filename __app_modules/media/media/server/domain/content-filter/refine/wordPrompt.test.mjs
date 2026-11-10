import { describe, it, expect } from 'vitest';
import { wordPrompt } from './cueKinds.mjs';

describe('wordPrompt', () => {
  it('resolves masked labels through the known word forms', () => {
    expect(wordPrompt({ label: 'G*d', category: 'language/blasphemy/god' })).toBe('god');
    expect(wordPrompt({ label: 'sh*t', category: 'language/profanity/x' })).toBe('shit');
    expect(wordPrompt({ label: 'psycho', category: 'language/x' })).toBe('psycho');
    expect(wordPrompt({ label: 'p*ck*rw**d', category: 'language/racial/other' })).toBeNull();
  });
});
