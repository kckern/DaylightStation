/**
 * MortgageCalculator - Pure calculation service for mortgage projections
 *
 * Provides complex mortgage calculations including:
 * - Payment plan projections with variable rates
 * - Multiple payoff scenarios
 * - Running balance tracking
 * - Interest vs principal breakdowns
 */

import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {Object} PaymentPlanConfig
 * @property {string} id - Unique plan identifier
 * @property {string} title - Plan display title
 * @property {string} [subtitle] - Optional subtitle
 * @property {Object[]} [rates] - Rate changes over time
 * @property {string} rates[].effectiveDate - When rate takes effect (YYYY-MM)
 * @property {number} rates[].rate - Annual interest rate (decimal, e.g., 0.065)
 * @property {number} [rates[].fee] - One-time fee when rate changes
 * @property {Object[]} [payments] - Extra payment schedule
 * @property {number} payments[].amount - Payment amount
 * @property {number[]} [payments[].regular] - Months (1-12) for regular extra payments
 * @property {string[]} [payments[].fixed] - Specific months (YYYY-MM) for one-time payments
 */

/**
 * @typedef {Object} PaymentMonth
 * @property {string} month - Month (YYYY-MM)
 * @property {number} startBalance - Balance at start of month
 * @property {number} interestAccrued - Interest accrued this month
 * @property {number} amountPaid - Total amount paid this month
 * @property {number[]} payments - Individual payment amounts
 * @property {number} endBalance - Balance at end of month
 */

/**
 * @typedef {Object} PaymentPlanResult
 * @property {Object} info - Summary information
 * @property {string} info.id - Plan ID
 * @property {string} info.title - Plan title
 * @property {string} info.subtitle - Plan subtitle
 * @property {number} info.totalPaid - Total amount paid over life of loan
 * @property {number} info.totalInterest - Total interest paid
 * @property {number} info.totalPayments - Number of months to payoff
 * @property {string} info.totalYears - Years to payoff (decimal string)
 * @property {string} info.payoffDate - Payoff date (Month YYYY)
 * @property {number} info.annualBudget - Average annual payment
 * @property {number} info.avgMonthlyInterest - Average monthly interest
 * @property {number} info.avgMonthlyEquity - Average monthly principal
 * @property {PaymentMonth[]} months - Monthly breakdown
 */

/**
 * @typedef {Object} MortgageStatus
 * @property {string} accountId - Account identifier
 * @property {number} mortgageStartValue - Original loan amount
 * @property {number} startingBalance - Balance when tracking started
 * @property {number} totalInterestPaid - Total interest paid to date
 * @property {number} totalPrincipalPaid - Total principal paid to date
 * @property {number} monthlyRent - Average monthly interest (rent equivalent)
 * @property {number} monthlyEquity - Average monthly principal (equity)
 * @property {number} percentPaidOff - Percent of loan paid off
 * @property {number} balance - Current balance
 * @property {number} interestRate - Current interest rate
 * @property {string} earliestPayoff - Earliest payoff date (YYYY-MM)
 * @property {string} latestPayoff - Latest payoff date (YYYY-MM)
 * @property {number} totalPaid - Total amount paid to date
 * @property {Object[]} transactions - Payment transactions
 * @property {PaymentPlanResult[]} paymentPlans - Projected payment plans
 */

export class MortgageCalculator {
  /**
   * Calculate payment plan projections
   *
   * @param {Object} params - Calculation parameters
   * @param {number} params.balance - Current loan balance (negative = debt)
   * @param {number} params.interestRate - Annual interest rate (decimal)
   * @param {number} params.minimumPayment - Minimum monthly payment
   * @param {PaymentPlanConfig[]} params.paymentPlans - Payment plan configurations
   * @param {number} [params.capitalExtracted=0] - Capital already extracted (reduces payments)
   * @param {Date|string} params.startDate - Start date for projections (required)
   * @returns {PaymentPlanResult[]}
   */
  calculatePaymentPlans({
    balance,
    interestRate,
    minimumPayment,
    paymentPlans,
    capitalExtracted = 0,
    startDate
  }) {
    if (!startDate) {
      throw new ValidationError('startDate required', { code: 'MISSING_DATE', field: 'startDate' });
    }
    const principal = Math.abs(balance);
    const minPmt = parseFloat(minimumPayment) || 0;
    const projectionStart = new Date(startDate);
    projectionStart.setUTCDate(1); // Start of month (use UTC to avoid timezone issues)

    return paymentPlans.map((plan) => {
      return this.#calculateSinglePlan({
        principal,
        baseRate: interestRate,
        minimumPayment: minPmt,
        plan,
        capitalExtracted,
        startDate: projectionStart
      });
    });
  }

  /**
   * Calculate mortgage status from transaction history
   *
   * @param {Object} params - Calculation parameters
   * @param {Object} params.config - Mortgage configuration
   * @param {number} params.config.mortgageStartValue - Original loan amount
   * @param {string} params.config.accountId - Account identifier
   * @param {string} params.config.startDate - Tracking start date
   * @param {number} params.config.interestRate - Current interest rate
   * @param {number} params.config.minimumPayment - Minimum monthly payment
   * @param {PaymentPlanConfig[]} params.config.paymentPlans - Payment plans
   * @param {number} params.balance - Current account balance
   * @param {Object[]} params.transactions - Payment transactions
   * @param {Date|string} params.asOfDate - The date to calculate status as of (required)
   * @returns {MortgageStatus}
   */
  calculateMortgageStatus({ config, balance, transactions, asOfDate }) {
    if (!asOfDate) {
      throw new ValidationError('asOfDate required', { code: 'MISSING_DATE', field: 'asOfDate' });
    }
    const {
      mortgageStartValue,
      accountId,
      startDate,
      interestRate,
      minimumPayment,
      paymentPlans = []
    } = config;

    // Sort transactions chronologically
    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    // Calculate sum of all transactions
    const sumOfTransactions = sortedTransactions.reduce(
      (total, { amount }) => total + amount,
      0
    );

    // Calculate starting balance (before any payments were tracked)
    const startingBalanceNeg = this.#round(balance - sumOfTransactions);
    const startingBalance = Math.abs(startingBalanceNeg);

    // Add running balance to each transaction
    let runningTotal = 0;
    const transactionsWithBalance = sortedTransactions.map((txn) => {
      runningTotal += txn.amount;
      return {
        ...txn,
        runningBalance: this.#round(startingBalanceNeg + runningTotal)
      };
    });

    // Calculate payment plan projections
    const paymentPlansFilled = this.calculatePaymentPlans({
      balance: balance,
      interestRate: interestRate,
      minimumPayment: minimumPayment,
      paymentPlans: paymentPlans,
      startDate: asOfDate
    });

    // Calculate totals
    const totalPaid = transactions.reduce((total, { amount }) => total + (amount || 0), 0);
    const monthsSinceStart = this.#monthsDiff(new Date(startDate), new Date(asOfDate));

    const totalInterestPaid = startingBalance - mortgageStartValue;
    const totalPrincipalPaid = totalPaid - totalInterestPaid;
    const percentPaidOff = (startingBalance - Math.abs(balance)) / startingBalance;

    const monthlyRent = this.#round(totalInterestPaid / monthsSinceStart);
    const monthlyEquity = this.#round(totalPrincipalPaid / monthsSinceStart);

    // Find earliest and latest payoff dates
    const { earliestPayoff, latestPayoff } = this.#findPayoffRange(paymentPlansFilled);

    return {
      accountId,
      mortgageStartValue,
      startingBalance,
      totalInterestPaid,
      totalPrincipalPaid,
      monthlyRent,
      monthlyEquity,
      percentPaidOff,
      balance: Math.abs(balance),
      interestRate,
      earliestPayoff,
      latestPayoff,
      totalPaid,
      transactions: transactionsWithBalance,
      paymentPlans: paymentPlansFilled
    };
  }

  /**
   * Calculate a single payment plan projection
   * @private
   */
  #calculateSinglePlan({
    principal,
    baseRate,
    minimumPayment,
    plan,
    capitalExtracted,
    startDate
  }) {
    // Build rate lookup map
    const rateMap = (plan.rates || []).reduce((acc, { effectiveDate, rate, fee }) => {
      const ym = this.#formatYearMonth(new Date(effectiveDate));
      acc[ym] = { rate, fee: fee || 0 };
      return acc;
    }, {});

    let currentBalance = principal;
    let currentRate = baseRate;
    // Use UTC year/month to avoid timezone issues with date strings like '2026-01-01'
    let currentYear = startDate.getUTCFullYear();
    let currentMonth = startDate.getUTCMonth(); // 0-indexed
    let remainingCapitalExtracted = capitalExtracted;

    let totalPaid = 0;
    let totalInterest = 0;
    const months = [];

    // Prevent infinite loop
    const MAX_ITERATIONS = 1000;
    let iterations = 0;

    while (currentBalance > 0.01 && iterations < MAX_ITERATIONS) {
      iterations++;
      const ym = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

      // Check for rate change
      if (rateMap[ym]) {
        currentRate = rateMap[ym].rate;
      }

      // Calculate interest for this month
      const accruedInterest = currentBalance * (currentRate / 12);
      const payments = [minimumPayment];

      // Add rate change fee if applicable
      if (rateMap[ym]?.fee) {
        payments.push(rateMap[ym].fee);
      }

      // Add extra payments from plan
      (plan.payments || []).forEach((item) => {
        // Regular monthly payments (e.g., every March and September)
        // currentMonth is 0-indexed, item.regular uses 1-indexed months (1=Jan, 6=June)
        if (item.regular && item.regular.includes(currentMonth + 1)) {
          payments.push(item.amount);
        }

        // Fixed one-time payments
        if (item.fixed && item.fixed.includes(ym)) {
          let paymentAmount = item.amount;

          // Reduce payment by remaining capital extracted
          if (remainingCapitalExtracted > 0 && paymentAmount > 0) {
            const reduction = Math.max(minimumPayment, paymentAmount - remainingCapitalExtracted);
            remainingCapitalExtracted -= (paymentAmount - reduction);
            paymentAmount = reduction;
          }

          payments.push(paymentAmount);
        }
      });

      let amountPaid = payments.reduce((a, b) => a + b, 0);

      // Don't overpay
      if (currentBalance + accruedInterest < amountPaid) {
        amountPaid = currentBalance + accruedInterest;
      }

      const newBalance = currentBalance + accruedInterest - amountPaid;

      months.push({
        month: ym,
        startBalance: this.#round(currentBalance),
        interestAccrued: this.#round(accruedInterest),
        amountPaid: this.#round(amountPaid),
        payments: payments.map(p => this.#round(p)),
        endBalance: newBalance > 0 ? this.#round(newBalance) : 0
      });

      totalPaid += amountPaid;
      totalInterest += accruedInterest;
      currentBalance = newBalance > 0 ? newBalance : 0;

      // Move to next month
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }

    const payoffMonth = months[months.length - 1]?.month || `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const totalMonths = months.length || 1;

    return {
      info: {
        id: plan.id || '',
        title: plan.title || '',
        subtitle: plan.subtitle || '',
        totalPaid: this.#round(totalPaid),
        totalInterest: this.#round(totalInterest),
        totalPayments: totalMonths,
        totalYears: (totalMonths / 12).toFixed(2),
        payoffDate: this.#formatPayoffDate(payoffMonth),
        rates: plan.rates || [],
        annualBudget: this.#round(totalPaid / Math.max(totalMonths / 12, 1)),
        avgMonthlyInterest: this.#round(totalInterest / totalMonths),
        avgMonthlyEquity: this.#round(principal / totalMonths)
      },
      months
    };
  }

  /**
   * Find earliest and latest payoff dates from payment plans
   * @private
   */
  #findPayoffRange(paymentPlans) {
    let earliestPayoff = null;
    let latestPayoff = null;

    for (const { info } of paymentPlans) {
      const payoffDate = this.#parsePayoffDate(info.payoffDate);
      if (!payoffDate) continue;

      if (!earliestPayoff || payoffDate < earliestPayoff) {
        earliestPayoff = payoffDate;
      }
      if (!latestPayoff || payoffDate > latestPayoff) {
        latestPayoff = payoffDate;
      }
    }

    return {
      earliestPayoff: earliestPayoff ? this.#formatYearMonth(earliestPayoff) : '',
      latestPayoff: latestPayoff ? this.#formatYearMonth(latestPayoff) : ''
    };
  }

  /**
   * Calculate months between two dates
   * @private
   */
  #monthsDiff(start, end) {
    return Math.max(1,
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
    );
  }

  /**
   * Format date as YYYY-MM (uses UTC to avoid timezone issues)
   * @private
   */
  #formatYearMonth(date) {
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Format payoff date as "Month YYYY"
   * @private
   */
  #formatPayoffDate(ym) {
    const [year, month] = ym.split('-');
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
  }

  /**
   * Parse payoff date from "Month YYYY" format
   * @private
   */
  #parsePayoffDate(payoffStr) {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const parts = payoffStr.split(' ');
    if (parts.length !== 2) return null;

    const monthIndex = monthNames.indexOf(parts[0]);
    if (monthIndex === -1) return null;

    const year = parseInt(parts[1], 10);
    if (isNaN(year)) return null;

    return new Date(year, monthIndex, 1);
  }

  /**
   * Round to 2 decimal places
   * @private
   */
  #round(num) {
    return Math.round(num * 100) / 100;
  }
}

export default MortgageCalculator;
