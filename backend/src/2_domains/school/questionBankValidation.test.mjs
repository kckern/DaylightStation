import { describe, it, expect } from 'vitest';
import { validateQuestionBank } from './questionBankValidation.mjs';

const base = { id: 'b', title: 'T', audience: 'generic' };

describe('validateQuestionBank region_click', () => {
  it('accepts a valid region_click item', () => {
    const r = validateQuestionBank({ ...base, items: [
      { id: 'i1', type: 'region_click', prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' }] });
    expect(r.ok).toBe(true);
  });
  it('rejects missing asset and empty answer', () => {
    const r = validateQuestionBank({ ...base, items: [
      { id: 'i1', type: 'region_click', prompt: 'p', answer: '' }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/asset/);
    expect(r.errors.join(' ')).toMatch(/answer/);
  });
});

describe('validateQuestionBank asset_choice', () => {
  const good = { id: 'i1', type: 'asset_choice', prompt: 'Whose flag?', answer: 'FR',
    choices: [{ value: 'FR', label: 'France' }, { value: 'DE', image: { kind: 'flag', iso: 'DE' } }] };
  it('accepts label-or-image choices', () => {
    expect(validateQuestionBank({ ...base, items: [good] }).ok).toBe(true);
  });
  it('rejects a choice with neither label nor image', () => {
    const r = validateQuestionBank({ ...base, items: [{ ...good,
      choices: [{ value: 'FR' }, { value: 'DE', label: 'Germany' }] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/label.*image|image.*label/i);
  });
  it('rejects answer not among choice values and duplicate values', () => {
    expect(validateQuestionBank({ ...base, items: [{ ...good, answer: 'ZZ' }] }).ok).toBe(false);
    expect(validateQuestionBank({ ...base, items: [{ ...good,
      choices: [{ value: 'FR', label: 'a' }, { value: 'FR', label: 'b' }] }] }).ok).toBe(false);
  });
});

describe('validateQuestionBank formative feedback', () => {
  const item = {
    id: 'i1', type: 'multiple_choice', prompt: 'Which operation?',
    choices: ['Divide', 'Add'], answer: 'Divide',
  };

  it('retains bounded corrective feedback for any subject or surface', () => {
    const feedback = {
      explanation: 'A rate compares quantities by division.',
      correct: 'Yes—compare per one unit.',
      incorrect: 'Review which operation creates a per-unit value.',
    };
    const result = validateQuestionBank({ ...base, items: [{ ...item, feedback }] });
    expect(result).toMatchObject({ ok: true, bank: { items: [{ feedback }] } });
  });

  it('rejects empty, executable-shaped, or unbounded feedback', () => {
    const result = validateQuestionBank({
      ...base,
      items: [{ ...item, feedback: { explanation: '', command: 'launch' } }],
    });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/unknown fields command/),
      expect.stringMatching(/explanation/),
    ]));
  });
});

describe('validateQuestionBank profile prompts', () => {
  const item = { id: 'i1', type: 'multiple_choice', prompt: 'Which animal swims?', answer: 'Fishing cat', decoys: ['Lion', 'Tiger', 'Leopard', 'Cheetah'] };
  it('accepts bounded lower and upper prompt overrides', () => {
    expect(validateQuestionBank({ schema: 'school.question-bank/v2', ...base, items: [{ ...item, prompt_by_profile: { lower: 'Look on p. 132. Which animal swims?', upper: 'Which animal swims?' }, prompt_prefix_by_profile: { lower: 'Use the caption.' }, prompt_suffix_by_profile: { upper: 'Use the evidence.' } }] }).ok).toBe(true);
  });
  it('rejects malformed or unknown profile prompt overrides', () => {
    const result = validateQuestionBank({ schema: 'school.question-bank/v2', ...base, items: [{ ...item, prompt_by_profile: { toddler: 'Which animal?' } }] });
    expect(result.errors.join(' ')).toMatch(/unknown profiles toddler/);
  });
});
