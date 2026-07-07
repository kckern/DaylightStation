import { MortgageCalculator } from '#domains/finance/services/MortgageCalculator.mjs';

describe('MortgageCalculator remediation', () => {
  let calculator;
  beforeEach(() => { calculator = new MortgageCalculator(); });

  describe('payoffMonth', () => {
    test('info carries payoffMonth (YYYY-MM) matching the display payoffDate', () => {
      const [plan] = calculator.calculatePaymentPlans({
        balance: -10000,
        interestRate: 0,
        minimumPayment: 1000,
        paymentPlans: [{ id: 'p' }],
        startDate: new Date('2026-01-01')
      });
      // 10 months from Jan 2026 → last payment month is 2026-10 (October)
      expect(plan.info.payoffMonth).toBe('2026-10');
      expect(plan.info.payoffDate).toBe('October 2026');
    });
  });

  describe('percentPaidOff precision', () => {
    test('Buxfer-only path returns an unrounded fraction', () => {
      const result = calculator.calculateMortgageStatus({
        config: {
          mortgageStartValue: 300000,
          accountId: 'm1',
          startDate: '2024-01-01',
          interestRate: 0.06,
          minimumPayment: 1798.65,
          paymentPlans: [{ id: 'min', title: 'Minimum' }]
        },
        balance: -287654.32,
        transactions: [
          { date: '2024-02-01', amount: 1798.65 },
          { date: '2024-03-01', amount: 1798.65 }
        ],
        asOfDate: new Date('2024-03-15')
      });
      // Must equal the exact ratio, not a 2-decimal rounding of it (1% resolution).
      expect(result.percentPaidOff).toBeCloseTo(result.totalPrincipalPaid / 300000, 10);
    });
  });
});
