import { describe, it, expect } from 'vitest';
import { cueMatchesKinds } from '../../../__app_modules/media/media/server/domain/content-filter/refine/cueKinds.mjs';

const V = new Set(['visual']);
describe('cueMatchesKinds (refine --kinds)', () => {
  it('visual selects a plain shown cue', () => {
    expect(cueMatchesKinds({ type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A pornographic theater is visible.' }, V)).toBe(true);
  });
  it('visual selects a skip cue under a language category (a billboard is shown, not said)', () => {
    expect(cueMatchesKinds({ type: 'skip', category: 'language/language_sexual/other_sexual', label: 'Titles of pornographic movies are shown on a theater billboard. ' }, V)).toBe(true);
  });
  it('visual does not select a mute cue, word or line', () => {
    expect(cueMatchesKinds({ type: 'mute', category: 'language/profanity/damn', label: 'damn' }, V)).toBe(false);
    expect(cueMatchesKinds({ type: 'mute', category: 'language/profanity/damn', label: 'He says what the hell is going on here' }, V)).toBe(false);
  });
  it('visual does not select credits', () => {
    expect(cueMatchesKinds({ type: 'skip', category: 'credits/names', label: 'x' }, V)).toBe(false);
  });
  it('other selections are by initial kind', () => {
    expect(cueMatchesKinds({ type: 'mute', category: 'language/profanity/damn', label: 'damn' }, new Set(['speech']))).toBe(true);
  });
});
