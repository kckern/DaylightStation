// tests/unit/domains/finance/services/MortgageCalculator.test.mjs
import { MortgageCalculator } from '#backend/src/1_domains/finance/services/MortgageCalculator.mjs';

describe('MortgageCalculator', () => {
  let calculator;

  beforeEach(() => {
    calculator = new MortgageCalculator();
  });

  describe('calculatePaymentPlans', () => {
    test('calculates basic payment plan', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100000, // $100k loan
        interestRate: 0.06, // 6% annual
        minimumPayment: 600,
        paymentPlans: [
          { id: 'basic', title: 'Minimum Payments' }
        ],
        startDate: new Date('2026-01-01')
      });

      expect(result).toHaveLength(1);
      expect(result[0].info.id).toBe('basic');
      expect(result[0].info.title).toBe('Minimum Payments');
      expect(result[0].months.length).toBeGreaterThan(0);
    });

    test('calculates interest correctly for first month', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -120000,
        interestRate: 0.06, // 6% annual = 0.5% monthly
        minimumPayment: 1000,
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      });

      const firstMonth = result[0].months[0];
      // $120,000 * 0.06 / 12 = $600 interest
      expect(firstMonth.interestAccrued).toBe(600);
      expect(firstMonth.startBalance).toBe(120000);
    });

    test('handles rate changes', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100000,
        interestRate: 0.06,
        minimumPayment: 800,
        paymentPlans: [
          {
            id: 'rate-change',
            title: 'Rate Change Plan',
            rates: [
              { effectiveDate: '2026-06-01', rate: 0.05 }
            ]
          }
        ],
        startDate: new Date('2026-01-01')
      });

      const beforeChange = result[0].months[4]; // May (index 4)
      const afterChange = result[0].months[5]; // June (index 5)

      // Before rate change: 6% / 12 = 0.5%
      // After rate change: 5% / 12 = ~0.417%
      expect(afterChange.interestAccrued).toBeLessThan(beforeChange.interestAccrued);
    });

    test('handles extra regular payments', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100000,
        interestRate: 0.06,
        minimumPayment: 800,
        paymentPlans: [
          {
            id: 'extra',
            title: 'With Extra Payments',
            payments: [
              { amount: 500, regular: [6, 12] } // Extra $500 in June and December
            ]
          }
        ],
        startDate: new Date('2026-01-01')
      });

      const junePayment = result[0].months[5]; // June
      expect(junePayment.payments).toContain(500);
      expect(junePayment.amountPaid).toBeGreaterThan(800);
    });

    test('handles fixed one-time payments', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100000,
        interestRate: 0.06,
        minimumPayment: 800,
        paymentPlans: [
          {
            id: 'bonus',
            title: 'Bonus Payment',
            payments: [
              { amount: 5000, fixed: ['2026-03'] }
            ]
          }
        ],
        startDate: new Date('2026-01-01')
      });

      const marchPayment = result[0].months[2]; // March
      expect(marchPayment.payments).toContain(5000);
    });

    test('calculates payoff date correctly', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -50000,
        interestRate: 0.06,
        minimumPayment: 1000,
        paymentPlans: [{ id: 'test', title: 'Test' }],
        startDate: new Date('2026-01-01')
      });

      expect(result[0].info.payoffDate).toMatch(/^\w+ \d{4}$/);
      expect(result[0].info.totalPayments).toBeGreaterThan(0);
    });

    test('does not overpay on final payment', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -1000,
        interestRate: 0.06,
        minimumPayment: 500,
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      });

      const lastMonth = result[0].months[result[0].months.length - 1];
      expect(lastMonth.endBalance).toBe(0);
    });

    test('calculates multiple payment plans', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100000,
        interestRate: 0.06,
        minimumPayment: 800,
        paymentPlans: [
          { id: 'minimum', title: 'Minimum' },
          {
            id: 'aggressive',
            title: 'Aggressive',
            payments: [{ amount: 500, regular: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }]
          }
        ],
        startDate: new Date('2026-01-01')
      });

      expect(result).toHaveLength(2);
      // Aggressive plan should pay off faster
      expect(result[1].info.totalPayments).toBeLessThan(result[0].info.totalPayments);
    });

    test('calculates totals correctly', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -50000,
        interestRate: 0.06,
        minimumPayment: 1000,
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      });

      const info = result[0].info;
      expect(info.totalPaid).toBeGreaterThan(50000); // Principal + interest
      expect(info.totalInterest).toBeGreaterThan(0);
      expect(info.annualBudget).toBeGreaterThan(0);
    });
  });

  describe('calculateMortgageStatus', () => {
    test('calculates status from transactions', () => {
      const config = {
        mortgageStartValue: 300000,
        accountId: 'mortgage-1',
        startDate: '2020-01-01',
        interestRate: 0.065,
        minimumPayment: 2000,
        paymentPlans: [{ id: 'default', title: 'Current Plan' }]
      };

      const transactions = [
        { date: '2026-01-01', amount: 2000 },
        { date: '2026-02-01', amount: 2000 },
        { date: '2026-03-01', amount: 2000 }
      ];

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -244000, // Negative = debt
        transactions
      });

      expect(result.accountId).toBe('mortgage-1');
      expect(result.mortgageStartValue).toBe(300000);
      expect(result.balance).toBe(244000);
      expect(result.totalPaid).toBe(6000);
      expect(result.transactions).toHaveLength(3);
      expect(result.paymentPlans).toHaveLength(1);
    });

    test('calculates running balance on transactions', () => {
      const config = {
        mortgageStartValue: 100000,
        accountId: 'mortgage-1',
        startDate: '2025-01-01',
        interestRate: 0.06,
        minimumPayment: 1000,
        paymentPlans: []
      };

      const transactions = [
        { date: '2026-01-01', amount: 1000 },
        { date: '2026-02-01', amount: 1000 },
        { date: '2026-03-01', amount: 1500 }
      ];

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -96500,
        transactions
      });

      // Each transaction should have a running balance
      expect(result.transactions[0]).toHaveProperty('runningBalance');
      expect(result.transactions[1]).toHaveProperty('runningBalance');
      expect(result.transactions[2]).toHaveProperty('runningBalance');
    });

    test('calculates rent vs equity breakdown', () => {
      const config = {
        mortgageStartValue: 200000,
        accountId: 'mortgage-1',
        startDate: '2024-01-01', // 2 years ago
        interestRate: 0.06,
        minimumPayment: 1500,
        paymentPlans: []
      };

      const transactions = [];
      for (let i = 0; i < 24; i++) {
        transactions.push({ date: `2024-${String(i % 12 + 1).padStart(2, '0')}-01`, amount: 1500 });
      }

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -185000,
        transactions
      });

      expect(result.monthlyRent).toBeGreaterThan(0);
      expect(result.monthlyEquity).toBeGreaterThan(0);
      expect(result.percentPaidOff).toBeGreaterThan(0);
    });

    test('finds earliest and latest payoff dates', () => {
      const config = {
        mortgageStartValue: 200000,
        accountId: 'mortgage-1',
        startDate: '2024-01-01',
        interestRate: 0.06,
        minimumPayment: 1500,
        paymentPlans: [
          { id: 'minimum', title: 'Minimum' },
          {
            id: 'aggressive',
            title: 'Aggressive',
            payments: [{ amount: 1000, regular: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }]
          }
        ]
      };

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -200000,
        transactions: []
      });

      expect(result.earliestPayoff).toMatch(/^\d{4}-\d{2}$/);
      expect(result.latestPayoff).toMatch(/^\d{4}-\d{2}$/);
      // Aggressive plan should pay off before minimum
      expect(result.earliestPayoff).not.toBe(result.latestPayoff);
    });

    test('handles empty transactions', () => {
      const config = {
        mortgageStartValue: 100000,
        accountId: 'mortgage-1',
        startDate: '2025-01-01',
        interestRate: 0.06,
        minimumPayment: 1000,
        paymentPlans: []
      };

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -100000,
        transactions: []
      });

      expect(result.totalPaid).toBe(0);
      expect(result.transactions).toHaveLength(0);
    });

    test('sorts transactions chronologically', () => {
      const config = {
        mortgageStartValue: 100000,
        accountId: 'mortgage-1',
        startDate: '2025-01-01',
        interestRate: 0.06,
        minimumPayment: 1000,
        paymentPlans: []
      };

      const transactions = [
        { date: '2026-03-01', amount: 1000 },
        { date: '2026-01-01', amount: 1000 },
        { date: '2026-02-01', amount: 1000 }
      ];

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -97000,
        transactions
      });

      expect(result.transactions[0].date).toBe('2026-01-01');
      expect(result.transactions[1].date).toBe('2026-02-01');
      expect(result.transactions[2].date).toBe('2026-03-01');
    });
  });

  describe('edge cases', () => {
    test('handles zero interest rate', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -10000,
        interestRate: 0,
        minimumPayment: 500,
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      });

      const firstMonth = result[0].months[0];
      expect(firstMonth.interestAccrued).toBe(0);
      expect(result[0].info.totalInterest).toBe(0);
      expect(result[0].info.totalPayments).toBe(20); // 10000 / 500 = 20 months
    });

    test('handles very small balance', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100,
        interestRate: 0.06,
        minimumPayment: 50,
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      });

      expect(result[0].months.length).toBeLessThan(5);
    });

    test('prevents infinite loop with cap', () => {
      // Very low payment that would take forever
      const result = calculator.calculatePaymentPlans({
        balance: -1000000,
        interestRate: 0.20, // Very high rate
        minimumPayment: 100, // Very low payment (less than monthly interest)
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      });

      // Should cap at 1000 iterations
      expect(result[0].months.length).toBeLessThanOrEqual(1000);
    });

    test('handles rate change fee', () => {
      const result = calculator.calculatePaymentPlans({
        balance: -100000,
        interestRate: 0.06,
        minimumPayment: 800,
        paymentPlans: [
          {
            id: 'with-fee',
            title: 'With Fee',
            rates: [
              { effectiveDate: '2026-03-01', rate: 0.05, fee: 1000 }
            ]
          }
        ],
        startDate: new Date('2026-01-01')
      });

      const marchPayment = result[0].months[2]; // March
      expect(marchPayment.payments).toContain(1000);
    });
  });
});
