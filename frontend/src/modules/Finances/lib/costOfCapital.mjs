/**
 * Simulate the true cost of spending `extraAmount` today instead of putting
 * it toward the mortgage, following a payment plan's actual schedule.
 *
 * The plan's FINAL scheduled month is a capped partial payment (the backend
 * calculator never overpays), so simulation months at/beyond the end of the
 * schedule pay the last FULL payment — falling back to the partial one made
 * the tail drip out and wildly overstated the payoff delay.
 */
export function calculateCost({ balance, interestRate, extraAmount, plan }) {
  const baseInterest = plan.info.totalInterest;
  const baseMonths = plan.info.totalPayments;
  const monthlyRate = interestRate / 12;

  const scheduled = plan.months.map((m) => m.amountPaid);
  const regularPayment = scheduled.length > 1
    ? scheduled[scheduled.length - 2]
    : (scheduled[0] || 0);

  let remaining = balance + extraAmount;
  let totalInterest = 0;
  let months = 0;

  while (remaining > 0.01 && months < 1000) {
    const interest = remaining * monthlyRate;
    totalInterest += interest;
    remaining += interest;

    let payment = months < scheduled.length ? scheduled[months] : regularPayment;
    // At/after the schedule's final (partial) month, pay the regular amount.
    if (months >= scheduled.length - 1) payment = Math.max(payment, regularPayment);
    if (payment > remaining) payment = remaining;
    remaining -= payment;
    months++;
  }

  const additionalInterest = Math.round((totalInterest - baseInterest) * 100) / 100;
  const trueCost = extraAmount + additionalInterest;
  return {
    additionalInterest,
    trueCost,
    multiplier: extraAmount > 0 ? trueCost / extraAmount : 1,
    delayMonths: months - baseMonths
  };
}
