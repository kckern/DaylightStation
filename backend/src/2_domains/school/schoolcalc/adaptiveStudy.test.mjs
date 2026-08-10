import { describe, expect, it } from 'vitest';
import { bankContentRev } from '../bankRev.mjs';
import { curateAdaptiveStudy } from './adaptiveStudy.mjs';

const unit = (over = {}) => ({
  unitId: 'math-facts', title: 'Math facts', subject: 'math', bank: 'facts',
  passing: { percent: 80 },
  schoolcalc: {
    mode: 'adaptive_flashcards',
    study: { cardCount: 3, maxExposuresPerCard: 4 },
    quiz: { itemCount: 2 },
  },
  ...over,
});
const bank = (items = Array.from({ length: 4 }, (_, index) => ({
  id: `q${index + 1}`, type: 'multiple_choice', prompt: `${index + 1} + 1?`,
  choices: [`${index + 1}`, `${index + 2}`], answer: `${index + 2}`,
}))) => ({ id: 'facts', title: 'Facts', items });

describe('curateAdaptiveStudy', () => {
  it('selects cards and quiz IDs in exact authored order and pins bank revision/policy', () => {
    const source = bank();
    expect(curateAdaptiveStudy({ unit: unit(), bank: source })).toEqual({
      schema: 'school.calc.adaptive-study-curation/v1',
      unitId: 'math-facts', subject: 'math', topicId: 'math-facts',
      bankId: 'facts', bankRevision: bankContentRev(source),
      cardIds: ['q1', 'q2', 'q3'], quizIds: ['q1', 'q2'],
      policy: { cardCount: 3, itemCount: 2, maxExposuresPerCard: 4, passingPercent: 80 },
    });
  });

  it('rejects shortage, duplicates, and incompatible multiple-choice items without truncation', () => {
    expect(() => curateAdaptiveStudy({ unit: unit(), bank: bank(bank().items.slice(0, 2)) }))
      .toThrow(/2 items; 3 required/);
    const duplicate = bank(); duplicate.items[1] = { ...duplicate.items[1], id: 'q1' };
    expect(() => curateAdaptiveStudy({ unit: unit(), bank: duplicate })).toThrow(/duplicate id/);
    const nonChoice = bank(); nonChoice.items[0] = { ...nonChoice.items[0], type: 'text' };
    expect(() => curateAdaptiveStudy({ unit: unit(), bank: nonChoice })).toThrow(/not multiple_choice/);
    const unscoreable = bank(); unscoreable.items[0] = { ...unscoreable.items[0], answer: '99' };
    expect(() => curateAdaptiveStudy({ unit: unit(), bank: unscoreable })).toThrow(/answer must equal/);
  });

  it('rejects a mismatched bank and does not mutate source data', () => {
    const source = bank();
    const before = structuredClone(source);
    expect(() => curateAdaptiveStudy({ unit: unit({ bank: 'other' }), bank: source })).toThrow(/mismatched/);
    curateAdaptiveStudy({ unit: unit(), bank: source });
    expect(source).toEqual(before);
  });
});
