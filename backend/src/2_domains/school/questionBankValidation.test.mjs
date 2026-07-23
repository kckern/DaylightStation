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
