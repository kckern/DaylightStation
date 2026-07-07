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

  describe('bridge months without payments', () => {
    test('emits an amortization row (interest accrues, nothing paid) for a skipped cycle', () => {
      const statementData = {
        statements: {
          '2026-04': {
            statementDate: '2026-03-06',
            principalBalance: 172374.64,
            transactions: [
              { date: '2026-03-01', principal: 2508.88, interest: 920.81, escrow: 866.17, total: 4295.86 }
            ]
          }
        }
      };
      const result = calculator.calculateMortgageStatus({
        config: {
          mortgageStartValue: 400000,
          accountId: 'm1',
          startDate: '2024-06-01',
          interestRate: 0.0625,
          minimumPayment: 4088.89,
          paymentPlans: [{ id: 'minimum', title: 'Minimum' }]
        },
        balance: -169000,
        // Only txn is in the 2026-06 cycle (date > 2026-04-06 cutoff+month) —
        // the 2026-05 cycle has no payments and previously vanished.
        transactions: [{ date: '2026-04-20', amount: 4295.86, description: 'Mortgage Payment' }],
        statementData,
        asOfDate: new Date('2026-05-05')
      });

      const skipped = result.amortization.find(r => r.month === '2026-05');
      expect(skipped).toBeDefined();
      expect(skipped.totalPaid).toBe(0);
      expect(skipped.payments).toEqual([]);
      expect(skipped.interestAccrued).toBeGreaterThan(0);
    });
  });

  describe('non-amortizing plans', () => {
    test('throws PLAN_DOES_NOT_AMORTIZE when payments never cover interest', () => {
      expect(() => calculator.calculatePaymentPlans({
        balance: -1000000,
        interestRate: 0.20,
        minimumPayment: 100,
        paymentPlans: [{ id: 'doomed', title: 'Doomed' }],
        startDate: new Date('2026-01-01')
      })).toThrow(/did not amortize/);
    });
  });
});
