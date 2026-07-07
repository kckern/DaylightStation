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
});
