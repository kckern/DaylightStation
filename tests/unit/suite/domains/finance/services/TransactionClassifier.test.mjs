// tests/unit/domains/finance/services/TransactionClassifier.test.mjs
import { TransactionClassifier } from '#backend/src/1_domains/finance/services/TransactionClassifier.mjs';

describe('TransactionClassifier', () => {
  let classifier;

  const testConfig = {
    income: {
      tags: ['Income', 'Salary', 'Bonus']
    },
    dayToDay: {
      tags: ['Groceries', 'Gas', 'Dining']
    },
    monthly: [
      { label: 'Housing', tags: ['Rent', 'Mortgage', 'HOA'] },
      { label: 'Utilities', tags: ['Electric', 'Water', 'Internet'] },
      { label: 'Insurance', tags: ['Insurance', 'Health Insurance'] }
    ],
    shortTerm: [
      { label: 'Emergency Fund', tags: ['Emergency', 'Savings'] },
      { label: 'Vacation', tags: ['Vacation', 'Travel'] },
      { label: 'Shopping', tags: ['Shopping', 'Clothing'] }
    ]
  };

  beforeEach(() => {
    classifier = new TransactionClassifier(testConfig);
  });

  describe('constructor', () => {
    test('throws without config', () => {
      expect(() => new TransactionClassifier()).toThrow('requires bucket configuration');
    });

    test('accepts empty config', () => {
      const c = new TransactionClassifier({});
      expect(c).toBeDefined();
    });
  });

  describe('classify', () => {
    describe('income classification', () => {
      test('classifies salary as income', () => {
        const result = classifier.classify({
          id: '1',
          type: 'income',
          tagNames: ['Salary'],
          amount: 5000
        });
        expect(result.bucket).toBe('income');
        expect(result.label).toBe('Salary');
      });

      test('classifies bonus as income', () => {
        const result = classifier.classify({
          id: '2',
          type: 'income',
          tagNames: ['Bonus'],
          amount: 1000
        });
        expect(result.bucket).toBe('income');
        expect(result.label).toBe('Bonus');
      });
    });

    describe('transfer classification', () => {
      test('classifies transfer type as transfer', () => {
        const result = classifier.classify({
          id: '3',
          type: 'transfer',
          tagNames: ['Checking'],
          amount: 500
        });
        expect(result.bucket).toBe('transfer');
      });

      test('classifies investment type as transfer', () => {
        const result = classifier.classify({
          id: '4',
          type: 'investment',
          tagNames: ['401k'],
          amount: 1000
        });
        expect(result.bucket).toBe('transfer');
      });

      test('classifies Transfer tag as transfer', () => {
        const result = classifier.classify({
          id: '5',
          type: 'expense',
          tagNames: ['Transfer'],
          amount: 200
        });
        expect(result.bucket).toBe('transfer');
      });
    });

    describe('day-to-day classification', () => {
      test('classifies groceries as day-to-day', () => {
        const result = classifier.classify({
          id: '6',
          type: 'expense',
          tagNames: ['Groceries'],
          amount: 150
        });
        expect(result.bucket).toBe('day');
        expect(result.label).toBe('Day-to-Day');
      });

      test('classifies gas as day-to-day', () => {
        const result = classifier.classify({
          id: '7',
          type: 'expense',
          tagNames: ['Gas'],
          amount: 50
        });
        expect(result.bucket).toBe('day');
      });

      test('classifies dining as day-to-day', () => {
        const result = classifier.classify({
          id: '8',
          type: 'expense',
          tagNames: ['Dining'],
          amount: 35
        });
        expect(result.bucket).toBe('day');
      });
    });

    describe('monthly classification', () => {
      test('classifies rent as monthly housing', () => {
        const result = classifier.classify({
          id: '9',
          type: 'expense',
          tagNames: ['Rent'],
          amount: 2000
        });
        expect(result.bucket).toBe('monthly');
        expect(result.label).toBe('Housing');
      });

      test('classifies utilities correctly', () => {
        const result = classifier.classify({
          id: '10',
          type: 'expense',
          tagNames: ['Electric'],
          amount: 100
        });
        expect(result.bucket).toBe('monthly');
        expect(result.label).toBe('Utilities');
      });

      test('classifies insurance correctly', () => {
        const result = classifier.classify({
          id: '11',
          type: 'expense',
          tagNames: ['Health Insurance'],
          amount: 500
        });
        expect(result.bucket).toBe('monthly');
        expect(result.label).toBe('Insurance');
      });
    });

    describe('short-term classification', () => {
      test('classifies emergency savings', () => {
        const result = classifier.classify({
          id: '12',
          type: 'expense',
          tagNames: ['Emergency'],
          amount: 500
        });
        expect(result.bucket).toBe('shortTerm');
        expect(result.label).toBe('Emergency Fund');
      });

      test('classifies vacation spending', () => {
        const result = classifier.classify({
          id: '13',
          type: 'expense',
          tagNames: ['Travel'],
          amount: 1200
        });
        expect(result.bucket).toBe('shortTerm');
        expect(result.label).toBe('Vacation');
      });

      test('classifies shopping', () => {
        const result = classifier.classify({
          id: '14',
          type: 'expense',
          tagNames: ['Clothing'],
          amount: 200
        });
        expect(result.bucket).toBe('shortTerm');
        expect(result.label).toBe('Shopping');
      });
    });

    describe('unbudgeted classification', () => {
      test('classifies unknown tags as unbudgeted', () => {
        const result = classifier.classify({
          id: '15',
          type: 'expense',
          tagNames: ['RandomCategory'],
          amount: 50
        });
        expect(result.bucket).toBe('shortTerm');
        expect(result.label).toBe('Unbudgeted');
      });

      test('classifies empty tags as unbudgeted', () => {
        const result = classifier.classify({
          id: '16',
          type: 'expense',
          tagNames: [],
          amount: 25
        });
        expect(result.bucket).toBe('shortTerm');
        expect(result.label).toBe('Unbudgeted');
      });

      test('handles null tagNames', () => {
        const result = classifier.classify({
          id: '17',
          type: 'expense',
          tagNames: null,
          amount: 10
        });
        expect(result.bucket).toBe('shortTerm');
        expect(result.label).toBe('Unbudgeted');
      });
    });

    describe('priority order', () => {
      test('transfer takes priority over income', () => {
        const result = classifier.classify({
          id: '18',
          type: 'transfer',
          tagNames: ['Income'],
          amount: 500
        });
        expect(result.bucket).toBe('transfer');
      });

      test('income takes priority over day-to-day', () => {
        const result = classifier.classify({
          id: '19',
          type: 'income',
          tagNames: ['Income', 'Groceries'],
          amount: 100
        });
        expect(result.bucket).toBe('income');
      });
    });
  });

  describe('classifyAll', () => {
    test('groups transactions by bucket', () => {
      const transactions = [
        { id: '1', type: 'income', tagNames: ['Salary'], amount: 5000 },
        { id: '2', type: 'expense', tagNames: ['Groceries'], amount: 150 },
        { id: '3', type: 'expense', tagNames: ['Rent'], amount: 2000 },
        { id: '4', type: 'transfer', tagNames: ['Checking'], amount: 500 },
        { id: '5', type: 'expense', tagNames: ['Unknown'], amount: 50 }
      ];

      const buckets = classifier.classifyAll(transactions);

      expect(buckets.get('income')).toHaveLength(1);
      expect(buckets.get('day')).toHaveLength(1);
      expect(buckets.get('monthly')).toHaveLength(1);
      expect(buckets.get('transfer')).toHaveLength(1);
      expect(buckets.get('shortTerm')).toHaveLength(1);
    });

    test('adds label and bucket to transactions', () => {
      const transactions = [
        { id: '1', type: 'expense', tagNames: ['Rent'], amount: 2000 }
      ];

      const buckets = classifier.classifyAll(transactions);
      const monthlyTxns = buckets.get('monthly');

      expect(monthlyTxns[0].label).toBe('Housing');
      expect(monthlyTxns[0].bucket).toBe('monthly');
    });
  });

  describe('groupByLabel', () => {
    test('groups monthly transactions by category', () => {
      const transactions = [
        { id: '1', type: 'expense', tagNames: ['Rent'], amount: 2000 },
        { id: '2', type: 'expense', tagNames: ['Electric'], amount: 100 },
        { id: '3', type: 'expense', tagNames: ['Water'], amount: 50 },
        { id: '4', type: 'expense', tagNames: ['Groceries'], amount: 150 }
      ];

      const grouped = classifier.groupByLabel(transactions, 'monthly');

      expect(Object.keys(grouped)).toEqual(['Housing', 'Utilities']);
      expect(grouped['Housing']).toHaveLength(1);
      expect(grouped['Utilities']).toHaveLength(2);
    });

    test('groups short-term transactions by bucket', () => {
      const transactions = [
        { id: '1', type: 'expense', tagNames: ['Emergency'], amount: 500 },
        { id: '2', type: 'expense', tagNames: ['Travel'], amount: 1000 },
        { id: '3', type: 'expense', tagNames: ['Vacation'], amount: 200 }
      ];

      const grouped = classifier.groupByLabel(transactions, 'shortTerm');

      expect(grouped['Emergency Fund']).toHaveLength(1);
      expect(grouped['Vacation']).toHaveLength(2);
    });
  });

  describe('getConfiguredLabels', () => {
    test('returns all configured labels', () => {
      const labels = classifier.getConfiguredLabels();

      expect(labels.monthly).toContain('Housing');
      expect(labels.monthly).toContain('Utilities');
      expect(labels.monthly).toContain('Insurance');

      expect(labels.shortTerm).toContain('Emergency Fund');
      expect(labels.shortTerm).toContain('Vacation');
      expect(labels.shortTerm).toContain('Shopping');
    });
  });
});
