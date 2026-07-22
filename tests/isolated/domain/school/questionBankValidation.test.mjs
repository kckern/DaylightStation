import { describe, it, expect } from 'vitest';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';

const mc = (over = {}) => ({ id: 'q1', type: 'multiple_choice', prompt: 'Capital of WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'], ...over });
const bank = (over = {}) => ({ id: 'test-bank', title: 'Test', items: [mc()], ...over });

describe('validateQuestionBank', () => {
  it('accepts a minimal valid bank and normalises defaults', () => {
    const r = validateQuestionBank(bank());
    expect(r.ok).toBe(true);
    expect(r.bank.audience).toBe('assigned'); // fail closed
    expect(r.bank.topics).toEqual([]);
  });
  it('keeps an explicit generic audience', () => {
    expect(validateQuestionBank(bank({ audience: 'generic' })).bank.audience).toBe('generic');
  });
  it('finding 6: treats a null audience (YAML `audience:` with no value) the same as absent', () => {
    const r = validateQuestionBank(bank({ audience: null }));
    expect(r.ok).toBe(true);
    expect(r.bank.audience).toBe('assigned');
  });
  it('fix 1: treats a null topics (YAML `topics:` with no value) the same as absent', () => {
    const r = validateQuestionBank(bank({ topics: null }));
    expect(r.ok).toBe(true);
    expect(r.bank.topics).toEqual([]);
  });
  it('carries unit and readalong through when present (spec §5 backlinks)', () => {
    const r = validateQuestionBank(bank({ unit: 'plex:619845', readalong: 'talk:abc' }));
    expect(r.ok).toBe(true);
    expect(r.bank.unit).toBe('plex:619845');
    expect(r.bank.readalong).toBe('talk:abc');
  });
  it('unit and readalong are optional and absent from the returned bank when omitted', () => {
    const r = validateQuestionBank(bank());
    expect(r.ok).toBe(true);
    expect(r.bank.unit).toBeUndefined();
    expect(r.bank.readalong).toBeUndefined();
  });
  it('treats a null unit/readalong (YAML key with no value) the same as absent', () => {
    const r = validateQuestionBank(bank({ unit: null, readalong: null }));
    expect(r.ok).toBe(true);
    expect(r.bank.unit).toBeUndefined();
    expect(r.bank.readalong).toBeUndefined();
  });
  it('finding 1: a single long run of underscores counts as exactly one blank', () => {
    const r = validateQuestionBank(bank({ items: [
      { id: 'q1', type: 'cloze', prompt: 'The capital is ________.', answer: 'Olympia' },
    ] }));
    expect(r.ok).toBe(true);
  });
  it('finding 2: rejects a multiple_choice answer that is not a string, naming the item', () => {
    const r = validateQuestionBank(bank({ items: [mc({ answer: { fake: 1 } })] }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('items[0]: answer must be a non-empty string');
  });
  it('finding 4: rejects a multiple_choice answer that is an empty string, naming the item', () => {
    const r = validateQuestionBank(bank({ items: [mc({ answer: '' })] }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('items[0]: answer must be a non-empty string');
  });
  it('rejects a non-string unit, naming the field', () => {
    const r = validateQuestionBank(bank({ unit: 42 }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('unit must be a non-empty string');
  });
  it('rejects a non-string readalong, naming the field', () => {
    const r = validateQuestionBank(bank({ readalong: { fake: 1 } }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('readalong must be a non-empty string');
  });
  it.each([
    ['missing id', bank({ id: undefined })],
    ['missing title', bank({ title: undefined })],
    ['empty items', bank({ items: [] })],
    ['duplicate item ids', bank({ items: [mc(), mc()] })],
    ['unknown type', bank({ items: [mc({ type: 'essay' })] })],
    ['bad audience', bank({ audience: 'public' })],
    ['answer not in choices', bank({ items: [mc({ answer: 'Boise' })] })],
    ['single choice', bank({ items: [mc({ choices: ['Olympia'] })] })],
    ['duplicate choices', bank({ items: [mc({ choices: ['Olympia', 'Olympia'] })] })],
    ['short_answer missing answer', bank({ items: [{ id: 'q1', type: 'short_answer', prompt: 'P?' }] })],
    ['cloze without blank', bank({ items: [{ id: 'q1', type: 'cloze', prompt: 'No blank.', answer: 'x' }] })],
    ['cloze with two blanks', bank({ items: [{ id: 'q1', type: 'cloze', prompt: '___ and ___.', answer: 'x' }] })],
    ['matching single pair', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: 'b' }] }] })],
    ['matching duplicate lefts', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: 'b' }, { left: 'a', right: 'c' }] }] })],
    ['matching duplicate rights', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'b' }] }] })],
    ['not an object', null],
    // finding 2: leaf values rendered by the UI must be strings, not objects
    ['choices with a non-string entry', bank({ items: [mc({ choices: [{ fake: 1 }, 'Olympia'] })] })],
    ['accept with a non-string entry', bank({ items: [{ id: 'q1', type: 'short_answer', prompt: 'P?', answer: 'x', accept: [{ fake: 1 }] }] })],
    ['matching pair left not a string', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: { fake: 1 }, right: 'b' }, { left: 'c', right: 'd' }] }] })],
    ['matching pair right not a string', bank({ items: [{ id: 'q1', type: 'matching', prompt: 'M', pairs: [{ left: 'a', right: { fake: 1 } }, { left: 'c', right: 'd' }] }] })],
    // finding 4: empty / whitespace-only leaves must be rejected, not just falsy
    ['multiple_choice choice is empty string', bank({ items: [mc({ choices: ['', 'Olympia'] })] })],
    ['multiple_choice choice is whitespace only', bank({ items: [mc({ choices: ['   ', 'Olympia'] })] })],
    // finding 5: a malformed `topics` must be rejected, not silently discarded
    ['topics present but not an array', bank({ topics: 'science' })],
    ['topics array with a non-string entry', bank({ topics: ['science', 5] })],
    // finding 7: accept-must-be-an-array branch, previously untested
    ['accept not an array', bank({ items: [{ id: 'q1', type: 'short_answer', prompt: 'P?', answer: 'x', accept: 'salem' }] })],
    // fix 2: whitespace-only strings should be rejected
    ['bank id is whitespace-only', bank({ id: '   ' })],
    ['bank title is whitespace-only', bank({ title: '   ' })],
    ['item prompt is whitespace-only', bank({ items: [mc({ prompt: '   ' })] })],
    // spec §5: unit/readalong backlinks, when present, must be non-empty strings
    ['unit is not a string', bank({ unit: 42 })],
    ['unit is a whitespace-only string', bank({ unit: '   ' })],
    ['readalong is not a string', bank({ readalong: { fake: 1 } })],
    ['readalong is a whitespace-only string', bank({ readalong: '   ' })],
  ])('rejects: %s', (_label, raw) => {
    const r = validateQuestionBank(raw);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it('accepts all four types together', () => {
    const r = validateQuestionBank(bank({ items: [
      mc(),
      { id: 'q2', type: 'short_answer', prompt: 'Capital of OR?', answer: 'Salem', accept: ['salem'] },
      { id: 'q3', type: 'cloze', prompt: 'The capital of Idaho is ___.', answer: 'Boise' },
      { id: 'q4', type: 'matching', prompt: 'Match', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] },
    ] }));
    expect(r.ok).toBe(true);
  });
});
