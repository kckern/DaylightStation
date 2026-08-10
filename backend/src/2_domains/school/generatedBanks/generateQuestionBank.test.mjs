import { describe, expect, it } from 'vitest';
import { validateQuestionBank } from '../questionBankValidation.mjs';
import { generateQuestionBank } from './generateQuestionBank.mjs';

const entities = [
  { id: 'A', name: 'Alpha', value: '10', symbol: 'A' },
  { id: 'B', name: 'Beta', value: '20', symbol: 'B' },
  { id: 'C', name: 'Gamma', value: '30', symbol: 'C' },
  { id: 'D', name: 'Delta', value: '40', symbol: 'D' },
];

describe('generateQuestionBank', () => {
  it('uses explicit IDs and metadata without knowing the subject', () => {
    const bank = generateQuestionBank({
      recipe: {
        bankId: 'rates:values', title: 'Values', audience: 'generic', subject: 'economics',
        topics: ['rates'], entities: 'rows', itemType: 'multiple_choice',
        prompt: 'Value of {name}?', answerField: 'value', distractorField: 'value',
      },
      entities,
    });
    expect(bank).toMatchObject({ id: 'rates:values', subject: 'economics', topics: ['rates'] });
    expect(bank.items[0]).toMatchObject({ id: 'rates:values:A', prompt: 'Value of Alpha?', answer: '10' });
    expect(bank.items[0].choices).toHaveLength(4);
    expect(validateQuestionBank(bank).ok).toBe(true);
    expect(new Set(bank.items.map((item) => item.choices.indexOf(item.answer))).size).toBeGreaterThan(1);
  });

  it('projects arbitrary prompt-image fields from recipe data', () => {
    const bank = generateQuestionBank({
      recipe: {
        bankId: 'symbols:identify', title: 'Symbols', itemType: 'asset_choice',
        prompt: 'Which?', answerField: 'id', choiceLabelField: 'name',
        distractorField: 'id', promptImage: { kind: 'symbol', fields: { code: 'symbol' } },
      },
      entities,
    });
    expect(bank.items[0].promptImage).toEqual({ kind: 'symbol', code: 'A' });
    expect(bank.items[0].choices).toContainEqual({ value: 'A', label: 'Alpha' });
    expect(validateQuestionBank(bank).ok).toBe(true);
  });

  it('is deterministic and rejects a missing template field', () => {
    const recipe = {
      bankId: 'regions:locate', title: 'Locate', itemType: 'region_click', asset: 'regions',
      prompt: 'Click {name}', answerField: 'id',
    };
    expect(generateQuestionBank({ recipe, entities })).toEqual(generateQuestionBank({ recipe, entities }));
    expect(() => generateQuestionBank({ recipe: { ...recipe, prompt: 'Click {missing}' }, entities }))
      .toThrow(/missing field 'missing'/);
  });
});
