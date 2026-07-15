// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateGameSet } from './gameSetValidation.mjs';

const goodSet = {
  id: 'test-set',
  title: 'Test Night',
  rounds: [
    {
      name: 'Jeopardy',
      mode: 'hosted',
      categories: [
        {
          name: 'Old Testament',
          clues: [
            { value: 100, clue: 'He built an ark', answer: 'Who is Noah?' },
            { value: 200, clue: 'Name this location', answer: 'What is Sinai?', media: { type: 'image', src: 'games/jeopardy/test/sinai.jpg' }, daily_double: true },
          ],
        },
      ],
    },
  ],
  final: { category: 'Prophets', clue: 'Swallowed by a fish', answer: 'Who is Jonah?' },
};

describe('validateGameSet', () => {
  it('accepts a valid set and normalizes defaults', () => {
    const { valid, errors, set } = validateGameSet(goodSet);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
    expect(set.rounds[0].multiplier).toBe(1);
    expect(set.rounds[0].penalize_wrong).toBe(true);
    expect(set.rounds[0].categories[0].clues[0].daily_double).toBe(false);
    expect(set.rounds[0].categories[0].clues[0].media).toBe(null);
    expect(set.rounds[0].categories[0].clues[1].daily_double).toBe(true);
  });

  it('normalizes a set without final to final: null', () => {
    const { final, ...noFinal } = goodSet;
    const { valid, set } = validateGameSet(noFinal);
    expect(valid).toBe(true);
    expect(set.final).toBe(null);
  });

  it('rejects non-object input', () => {
    expect(validateGameSet(null).valid).toBe(false);
    expect(validateGameSet('nope').valid).toBe(false);
  });

  it('rejects missing id/title/rounds', () => {
    const { valid, errors } = validateGameSet({});
    expect(valid).toBe(false);
    expect(errors.join(' ')).toMatch(/id/);
    expect(errors.join(' ')).toMatch(/title/);
    expect(errors.join(' ')).toMatch(/rounds/);
  });

  it('rejects bad round mode and bad media type with clue coordinates in the message', () => {
    const bad = JSON.parse(JSON.stringify(goodSet));
    bad.rounds[0].mode = 'karaoke';
    bad.rounds[0].categories[0].clues[0].media = { type: 'hologram', src: 'x' };
    const { valid, errors } = validateGameSet(bad);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('karaoke'))).toBe(true);
    expect(errors.some((e) => e.includes('rounds[0].categories[0].clues[0]'))).toBe(true);
  });

  it('rejects clues missing value/clue/answer', () => {
    const bad = JSON.parse(JSON.stringify(goodSet));
    delete bad.rounds[0].categories[0].clues[0].answer;
    bad.rounds[0].categories[0].clues[1].value = 'lots';
    const { valid, errors } = validateGameSet(bad);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
