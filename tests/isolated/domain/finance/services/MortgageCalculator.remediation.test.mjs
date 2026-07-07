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

  describe('drift reconciliation residual', () => {
    test('reconciled closing balance lands exactly on the anchor', () => {
      // Zero interest rate → equal 1/N weights → round(0.10 * 1/3) = 0.03 per
      // record = 0.09 distributed, 0.01 residual. Old code loses the cent.
      const records = calculator.reconstructAmortization({
        mortgageStartValue: 100000,
        interestRate: 0,
        startDate: '2026-01-01',
        transactions: [
          { date: '2026-01-15', amount: 1000 },
          { date: '2026-02-15', amount: 1000 },
          { date: '2026-03-15', amount: 1000 }
        ],
        currentBalance: -97000.10, // natural walk ends at 97000.00 → drift = +0.10
        asOfDate: '2026-03-31'
      });
      const last = records[records.length - 1];
      expect(Math.abs(last.closingBalance)).toBeCloseTo(97000.10, 2);
      // Adjustments must sum to the full drift
      const totalAdj = records.reduce((s, r) => s + r.reconciliationAdj, 0);
      expect(totalAdj).toBeCloseTo(0.10, 2);
    });
  });
});
