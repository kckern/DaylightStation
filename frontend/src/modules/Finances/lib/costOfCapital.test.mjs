import { calculateCost } from './costOfCapital.mjs';

describe('calculateCost', () => {
  // Zero-interest plan keeps arithmetic exact: $9,100 loan, nine $1,000
  // payments + one capped partial $100 final payment = 10 months.
  const plan = {
    info: { totalInterest: 0, totalPayments: 10 },
    months: [
      ...Array.from({ length: 9 }, () => ({ amountPaid: 1000 })),
      { amountPaid: 100 } // capped partial final payment
    ]
  };

  test('extra spending delays payoff by regular-payment months, not partial-payment months', () => {
    const cost = calculateCost({ balance: 9100, interestRate: 0, extraAmount: 1000, plan });
    // $10,100 to pay at $1,000/mo = 11 months → delay 1 month.
    // The old bug fell back to the $100 PARTIAL payment and reported ~10.
    expect(cost.delayMonths).toBe(1);
    expect(cost.additionalInterest).toBe(0);
    expect(cost.trueCost).toBe(1000);
  });

  test('additional interest accrues on the extended balance', () => {
    const interestPlan = {
      info: { totalInterest: 500, totalPayments: 12 },
      months: [
        ...Array.from({ length: 11 }, () => ({ amountPaid: 900 })),
        { amountPaid: 200 }
      ]
    };
    const cost = calculateCost({ balance: 9600, interestRate: 0.06, extraAmount: 5000, plan: interestPlan });
    expect(cost.additionalInterest).toBeGreaterThan(0);
    expect(cost.trueCost).toBeGreaterThan(5000);
    expect(cost.delayMonths).toBeGreaterThan(0);
    expect(cost.delayMonths).toBeLessThan(24); // sanity: not the drip-tail explosion
  });

  test('zero extraAmount yields multiplier 1 and no NaN', () => {
    const cost = calculateCost({ balance: 9100, interestRate: 0, extraAmount: 0, plan });
    expect(cost.multiplier).toBe(1);
    expect(Number.isFinite(cost.trueCost)).toBe(true);
  });
});
