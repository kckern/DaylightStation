import { describe, it, expect } from 'vitest';
import { bankContentRev } from './bankRev.mjs';

const bank = (over = {}) => ({
  id: 'caps', title: 'Caps',
  items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }],
  ...over,
});

describe('bankContentRev (admin advocacy A3)', () => {
  it('is stable across runs and property order', () => {
    const a = bankContentRev(bank());
    const reordered = bank();
    reordered.items = [{ choices: ['Seattle', 'Olympia'], answer: 'Olympia', prompt: 'WA?', type: 'multiple_choice', id: 'q1' }];
    expect(bankContentRev(reordered)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when the graded substance changes — an answer-key fix is a new rev', () => {
    const fixed = bank();
    fixed.items = [{ ...fixed.items[0], answer: 'Seattle' }];
    expect(bankContentRev(fixed)).not.toBe(bankContentRev(bank()));
  });

  it('does NOT change on presentation-only edits (title, topics)', () => {
    expect(bankContentRev(bank({ title: 'Renamed', topics: ['x'] }))).toBe(bankContentRev(bank()));
  });

  it('degrades to null on a shapeless bank', () => {
    expect(bankContentRev(null)).toBeNull();
    expect(bankContentRev({ items: 'nope' })).toBeNull();
  });
});

describe('schema discriminator (admin advocacy #18)', () => {
  it('banks and units accept v1 or absent, refuse unknown versions', async () => {
    const { validateQuestionBank } = await import('./questionBankValidation.mjs');
    const { validateUnit } = await import('./curriculum/unitValidation.mjs');
    const okBank = { id: 'b', title: 'B', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b'], answer: 'a' }] };
    expect(validateQuestionBank(okBank).ok).toBe(true);
    expect(validateQuestionBank({ ...okBank, schema: 'school.question-bank/v1' }).ok).toBe(true);
    expect(validateQuestionBank({ ...okBank, schema: 'school.question-bank/v9' }).ok).toBe(false);
    const okUnit = {
      unitId: 'x-01', title: 'X', subject: 'math',
      provenance: { source: 'hand-authored', reviewState: 'approved' },
    };
    expect(validateUnit({ ...okUnit, schema: 'school.unit/v9' }).errors.join(' ')).toMatch(/schema/);
    expect(validateUnit({ ...okUnit, schema: 'school.unit/v1' }).errors.join(' ')).not.toMatch(/schema/);
  });
});
