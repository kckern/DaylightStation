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
