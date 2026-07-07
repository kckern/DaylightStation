import { TransactionClassifier } from '#domains/finance/services/TransactionClassifier.mjs';

describe('TransactionClassifier remediation', () => {
  test('labels a monthly transaction by its matching tag even when not the first tag', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ label: 'Utilities', tags: ['Electric'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Untracked', 'Electric'] });
    expect(result).toEqual({ label: 'Utilities', bucket: 'monthly' });
  });

  test('labels a short-term transaction by its matching tag even when not the first tag', () => {
    const classifier = new TransactionClassifier({
      shortTerm: [{ label: 'Vacation', tags: ['Travel'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Misc', 'Travel'] });
    expect(result).toEqual({ label: 'Vacation', bucket: 'shortTerm' });
  });

  test('missing monthly label falls back to Uncategorized, not Shopping', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ tags: ['Mystery'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Mystery'] });
    expect(result).toEqual({ label: 'Uncategorized', bucket: 'monthly' });
  });

  test('missing shortTerm label falls back to Uncategorized', () => {
    const classifier = new TransactionClassifier({
      shortTerm: [{ tags: ['MysteryFund'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['MysteryFund'] });
    expect(result).toEqual({ label: 'Uncategorized', bucket: 'shortTerm' });
  });

  test('throws on config where a bucket tag collides with income/dayToDay tags', () => {
    expect(() => new TransactionClassifier({
      income: { tags: ['Paycheck'] },
      monthly: [{ label: 'Utilities', tags: ['Paycheck'] }]
    })).toThrow(/collision/i);
  });

  test('throws when a category LABEL collides with a dayToDay tag', () => {
    expect(() => new TransactionClassifier({
      dayToDay: { tags: ['Groceries'] },
      shortTerm: [{ label: 'Groceries', tags: ['FoodFund'] }]
    })).toThrow(/collision/i);
  });

  test('non-colliding config constructs fine', () => {
    expect(() => new TransactionClassifier({
      income: { tags: ['Paycheck'] },
      dayToDay: { tags: ['Groceries'] },
      monthly: [{ label: 'Utilities', tags: ['Electric'] }],
      shortTerm: [{ label: 'Vacation', tags: ['Travel'] }]
    })).not.toThrow();
  });
});
