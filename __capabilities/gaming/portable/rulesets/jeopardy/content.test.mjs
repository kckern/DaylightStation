// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateJeopardyDefinition } from "./index.mjs";
import { validateGameSet } from "./content.mjs";

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

it('preserves explicit little-kid clue metadata and rejects nonboolean flags',()=>{
 const raw=structuredClone(goodSet); raw.rounds[0].categories[0].clues[0].little_kids=true;
 expect(validateGameSet(raw).set.rounds[0].categories[0].clues[0].little_kids).toBe(true);
 raw.rounds[0].categories[0].clues[0].little_kids='yes';
 expect(validateGameSet(raw).valid).toBe(false);
});

it('preserves_regular_and_final_references', () => {
  const raw = structuredClone(goodSet);
  raw.rounds[0].categories[0].clues[0].scripture_reference = ' Jeremiah 2:13 ';
  raw.final.scripture_reference = ' Jonah 1:17 ';
  const { set } = validateGameSet(raw);
  expect(set.rounds[0].categories[0].clues[0].scripture_reference).toBe('Jeremiah 2:13');
  expect(set.final.scripture_reference).toBe('Jonah 1:17');
});

it('accepts_legacy_trivia_and_preserves_little_kids', () => {
  const raw = structuredClone(goodSet);
  raw.rounds[0].categories[0].clues[0].little_kids = true;
  const { set } = validateGameSet(raw);
  expect(set.open_book).toBe(false);
  expect(set.rounds[0].categories[0].clues[0]).toMatchObject({ little_kids: true, scripture_reference: null });
  expect(set.final.scripture_reference).toBeNull();
  expect(validateGameSet(set)).toEqual({ valid: true, errors: [], set });
  expect(validateJeopardyDefinition(set).valid).toBe(true);
});

for (const target of ['regular', 'final']) {
  for (const reference of [undefined, null, '', '   ', 12, false, {}]) {
    it(`requires_references_for_open_book_in_both_validation_paths: ${target} ${JSON.stringify(reference)}`, () => {
      const raw = structuredClone(goodSet);
      raw.open_book = true;
      for (const clue of raw.rounds[0].categories[0].clues) clue.scripture_reference = 'Jeremiah 2:13';
      raw.final.scripture_reference = 'Jonah 1:17';
      const clue = target === 'regular' ? raw.rounds[0].categories[0].clues[0] : raw.final;
      clue.scripture_reference = reference;
      const field = target === 'regular' ? 'rounds[0].categories[0].clues[0].scripture_reference' : 'final.scripture_reference';
      for (const validate of [validateGameSet, validateJeopardyDefinition]) {
        expect(validate(raw).valid).toBe(false);
        expect(validate(raw).errors).toEqual([`${field} must be a nonblank string`]);
      }
    });
  }
}
it.each([null, 'true', 1, {}])('rejects invalid open_book %j in both paths', (open_book) => {
  for (const validate of [validateGameSet, validateJeopardyDefinition]) {
    expect(validate({ ...goodSet, open_book })).toMatchObject({ valid: false, errors: ['open_book must be a boolean'] });
  }
});
it.each(['', '  ', 1, false, {}])('rejects supplied malformed optional reference %j', (reference) => {
  const raw = structuredClone(goodSet);
  raw.final.scripture_reference = reference;
  for (const validate of [validateGameSet, validateJeopardyDefinition]) {
    expect(validate(raw)).toMatchObject({ valid: false, errors: ['final.scripture_reference must be a nonblank string'] });
  }
});
