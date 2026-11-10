import { describe, expect, it } from 'vitest';
import { normalizeLearn, validateLearn } from "./learn.mjs";

describe('learn notes', () => {
  it('accepts a passage with an optional translation and note', () => {
    const learn = { ref: 'Jeremiah 18:6', text: 'The clay is in the potter’s hand.', translation: 'NIrV', note: 'We are in His hand.' };
    expect(validateLearn(learn, 'clue')).toEqual([]);
    expect(normalizeLearn(learn)).toEqual(learn);
  });

  it('treats a missing learn note as absent, not invalid', () => {
    expect(validateLearn(undefined, 'clue')).toEqual([]);
    expect(normalizeLearn(undefined)).toBe(null);
  });

  it('requires text and rejects non-string fields', () => {
    expect(validateLearn('Jer 1:5', 'clue')).toEqual(['clue.learn must be an object']);
    expect(validateLearn({ ref: 'Jer 1:5' }, 'clue')).toEqual(['clue.learn.text is required']);
    expect(validateLearn({ text: 'x', note: 3 }, 'clue')).toEqual(['clue.learn.note must be a string']);
  });

  it('drops unknown fields when normalizing', () => {
    expect(normalizeLearn({ text: 'x', extra: true })).toEqual({ text: 'x' });
  });
});
