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
  calculateMortgageStatus({ config, balance, transactions, asOfDate, statementData }) {
    if (!asOfDate) {
      throw new ValidationError('asOfDate required', { code: 'MISSING_DATE', field: 'asOfDate' });
    }

    const result = statementData?.statements
      ? this.#buildFromStatements({ config, balance, transactions, asOfDate, statementData })
      : this.#buildFromBuxferOnly({ config, balance, transactions, asOfDate });

    this.#assertAmortizationInvariants(result.amortization);
    return result;
  }

  /**
   * Guardrail: the amortization array must have unique, ascending month
   * keys. Statement keys (billing-cycle labels) and bridge keys (also
   * billing-cycle labels for future cycles) live in the same namespace,
   * so any duplicate or backwards step is a calculation bug — fail loud
   * rather than persist silently broken data.
   * @private
   */
  #assertAmortizationInvariants(amortization) {
    if (!Array.isArray(amortization) || amortization.length === 0) return;

    const months = amortization.map(r => r.month);
    const seen = new Set();
    const dups = new Set();
    for (const m of months) {
      if (seen.has(m)) dups.add(m);
      seen.add(m);
    }
    if (dups.size > 0) {
      throw new ValidationError(
        `Mortgage amortization has duplicate month keys: ${[...dups].sort().join(', ')}`,
        { code: 'AMORTIZATION_DUP_KEYS', dups: [...dups] }
      );
    }

    for (let i = 1; i < months.length; i++) {
      if (months[i] <= months[i - 1]) {
        throw new ValidationError(
          `Mortgage amortization months not strictly ascending at index ${i}: ${months[i - 1]} → ${months[i]}`,
          { code: 'AMORTIZATION_OUT_OF_ORDER', prev: months[i - 1], curr: months[i], index: i }
        );
      }
    }
  }

  /**
   * Build mortgage status from PDF-derived statement data, with Buxfer fallback for recent months
   * @private
   */
  #buildFromStatements({ config, balance, transactions, asOfDate, statementData }) {
    const {
      mortgageStartValue,
      accountId,
      startDate,
      interestRate,
      minimumPayment,
      paymentPlans = []
    } = config;

    const statements = statementData.statements;
    const statementMonths = Object.keys(statements).sort();

    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    let totalEscrowPaid = 0;
    let totalPaid = 0;
    const allTransactions = [];

    let lastStatementBalance = null;
    let lastStatementMonth = null;
    let lastStatementDate = null;

    for (let mi = 0; mi < statementMonths.length; mi++) {
      const month = statementMonths[mi];
      const stmt = statements[month];
      lastStatementMonth = month;
      lastStatementBalance = stmt.principalBalance;
      lastStatementDate = stmt.statementDate || `${month}-01`;

      // principalBalance on statement N is the balance AFTER N's transactions.
      // So the starting point for N's transactions is the PREVIOUS statement's principalBalance.
      const prevBalance = mi > 0
        ? statements[statementMonths[mi - 1]].principalBalance
        : mortgageStartValue;

      const txns = stmt.transactions || [];
      let periodBalance = prevBalance;

      for (const txn of txns) {
        const principal = txn.principal || 0;
        const interest = txn.interest || 0;
        const escrow = txn.escrow || 0;

        totalPrincipalPaid += principal;
        totalInterestPaid += interest;
        totalEscrowPaid += Math.max(0, escrow);
        totalPaid += txn.total || (principal + interest + Math.max(0, escrow));

        periodBalance -= principal;

        allTransactions.push({
          date: txn.date,
          description: txn.description || 'Payment',
          amount: txn.total || (principal + interest + escrow),
          principal,
          interest,
          escrow,
          runningBalance: this.#round(-periodBalance),
          source: 'statement'
        });
      }
    }

    // Build amortization from statement data (grouped by month)
    const amortization = [];
    let cumulativeInterest = 0;
    for (let mi = 0; mi < statementMonths.length; mi++) {
      const month = statementMonths[mi];
      const stmt = statements[month];
      const prevBalance = mi > 0
        ? statements[statementMonths[mi - 1]].principalBalance
        : mortgageStartValue;
      const txns = stmt.transactions || [];
      const monthInterest = txns.reduce((sum, t) => sum + (t.interest || 0), 0);
      const monthPrincipal = txns.reduce((sum, t) => sum + (t.principal || 0), 0);
      const monthTotal = txns.reduce((sum, t) => sum + (t.total || (t.principal || 0) + (t.interest || 0) + Math.max(0, t.escrow || 0)), 0);
      const payments = txns.map(t => t.total || (t.principal || 0) + (t.interest || 0) + Math.max(0, t.escrow || 0));
      cumulativeInterest += monthInterest;

      amortization.push({
        month,
        effectiveRate: interestRate,
        openingBalance: this.#round(prevBalance),
        interestAccrued: this.#round(monthInterest),
        payments,
        totalPaid: this.#round(monthTotal),
        principalPaid: this.#round(monthPrincipal),
        closingBalance: this.#round(stmt.principalBalance),
        cumulativeInterest: this.#round(cumulativeInterest),
        reconciliationAdj: 0
      });
    }

    // Bridge phase: extend ground-truth statements with Buxfer transactions
    // covering activity since the last statement. Statements are authoritative
    // up to lastStatementDate; Buxfer fills the last-mile gap and the bridge
    // endpoint is anchored to Buxfer's cached balance.
    //
    // Bridge rows use the lender's billing-cycle convention for `month`
    // (same as statement keys), so labels strictly extend the statement
    // sequence with no overlap. The cutoff day is inferred from
    // statementDate's day-of-month — txns dated through that day belong to
    // the cycle ending that month; later txns belong to the next cycle.
    // Statement labels = cycle-end month + 1 (lender's "due-date" convention).
    const bridgeRecords = [];
    const monthlyRate = interestRate / 12;

    if (lastStatementDate && transactions?.length) {
      const bridgeTxns = transactions
        .filter(t => t.date > lastStatementDate)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (bridgeTxns.length > 0) {
        const cutoffDay = parseInt(lastStatementDate.split('-')[2], 10) || 1;

        const cycleLabelFor = (isoDate) => {
          const [y, m, d] = isoDate.split('-').map(Number);
          let cy = y, cm = m;
          if (d > cutoffDay) {
            cm++;
            if (cm > 12) { cm = 1; cy++; }
          }
          let ly = cy, lm = cm + 1;
          if (lm > 12) { lm = 1; ly++; }
          return `${ly}-${String(lm).padStart(2, '0')}`;
        };

        const bridgeByCycle = {};
        for (const t of bridgeTxns) {
          const c = cycleLabelFor(t.date);
          if (!bridgeByCycle[c]) bridgeByCycle[c] = [];
          bridgeByCycle[c].push(t);
        }

        const asOfIso = (typeof asOfDate === 'string'
          ? asOfDate
          : asOfDate.toISOString()
        ).slice(0, 10);
        const asOfCycle = cycleLabelFor(asOfIso);

        // Walk cycles strictly AFTER lastStatementMonth through asOfCycle.
        const walkCycles = [];
        let [wy, wm] = lastStatementMonth.split('-').map(Number);
        wm++;
        if (wm > 12) { wm = 1; wy++; }
        const [eY, eM] = asOfCycle.split('-').map(Number);
        while (wy < eY || (wy === eY && wm <= eM)) {
          walkCycles.push(`${wy}-${String(wm).padStart(2, '0')}`);
          wm++;
          if (wm > 12) { wm = 1; wy++; }
        }

        let bridgeBalance = lastStatementBalance;
        let cumIntRunning = cumulativeInterest;

        for (const cycle of walkCycles) {
          const cycleTxns = bridgeByCycle[cycle] || [];
          if (cycleTxns.length === 0) continue;

          const opening = bridgeBalance;
          const interestAccrued = this.#round(opening * monthlyRate);
          const cyclePaid = cycleTxns.reduce((sum, t) => sum + (t.amount || 0), 0);
          const principalPaid = this.#round(cyclePaid - interestAccrued);

          bridgeBalance = this.#round(opening + interestAccrued - cyclePaid);
          cumIntRunning += interestAccrued;

          bridgeRecords.push({
            month: cycle,
            effectiveRate: interestRate,
            openingBalance: this.#round(opening),
            interestAccrued: this.#round(interestAccrued),
            payments: cycleTxns.map(t => t.amount),
            totalPaid: this.#round(cyclePaid),
            principalPaid: this.#round(principalPaid),
            closingBalance: this.#round(bridgeBalance),
            cumulativeInterest: this.#round(cumIntRunning),
            reconciliationAdj: 0,
            source: 'buxfer'
          });
        }

        // Reconcile bridge endpoint against Buxfer's cached balance. Drift
        // distributed across bridge months weighted by interest accrual; the
        // statement-month row (interest=0) absorbs none, post-statement
        // months absorb proportionally.
        if (bridgeRecords.length > 0) {
          const buxferCachedBalance = Math.abs(balance);
          const lastBridgeClosing = bridgeRecords[bridgeRecords.length - 1].closingBalance;
          const drift = this.#round(buxferCachedBalance - lastBridgeClosing);

          if (Math.abs(drift) > 0.01) {
            const totalBridgeInterest = bridgeRecords.reduce(
              (s, r) => s + r.interestAccrued, 0
            );

            for (const record of bridgeRecords) {
              const weight = totalBridgeInterest > 0
                ? record.interestAccrued / totalBridgeInterest
                : 1 / bridgeRecords.length;
              const adj = this.#round(drift * weight);
              record.reconciliationAdj = adj;
              record.interestAccrued = this.#round(record.interestAccrued + adj);
              record.principalPaid = this.#round(record.totalPaid - record.interestAccrued);
            }

            let walkBal = bridgeRecords[0].openingBalance;
            let cumInt = cumulativeInterest;
            for (const record of bridgeRecords) {
              record.openingBalance = this.#round(walkBal);
              walkBal += record.interestAccrued;
              cumInt += record.interestAccrued;
              walkBal -= record.totalPaid;
              record.closingBalance = this.#round(walkBal);
              record.cumulativeInterest = this.#round(cumInt);
            }
          }

          totalInterestPaid += bridgeRecords.reduce((s, r) => s + r.interestAccrued, 0);
          totalPrincipalPaid += bridgeRecords.reduce((s, r) => s + r.principalPaid, 0);

          // Emit individual Buxfer txns AFTER reconciliation. Each txn's
          // running balance steps down by its share of the month's reconciled
          // principal reduction (ratio = principalReduction / totalPaid), so
          // the last txn of each month lands exactly on that month's
          // reconciled closing balance — no cliff between the actual line
          // and the projection line.
          for (const record of bridgeRecords) {
            const cycleTxns = bridgeByCycle[record.month] || [];
            if (cycleTxns.length === 0) continue;

            const principalReduction = record.openingBalance - record.closingBalance;
            const ratio = record.totalPaid > 0
              ? principalReduction / record.totalPaid
              : 0;

            let running = -record.openingBalance;
            for (const txn of cycleTxns) {
              running += (txn.amount || 0) * ratio;
              totalPaid += txn.amount || 0;
              allTransactions.push({
                ...txn,
                runningBalance: this.#round(running),
                source: 'buxfer'
              });
            }
          }

          amortization.push(...bridgeRecords);
        }
      }
    }

    // currentBalance: bridge endpoint (anchored to Buxfer cached) when bridge
    // exists, otherwise the most recent statement's balance.
    const currentBalance = bridgeRecords.length > 0
      ? Math.abs(bridgeRecords[bridgeRecords.length - 1].closingBalance)
      : (lastStatementBalance != null ? lastStatementBalance : Math.abs(balance));

    // Start projections from the month after the last amortization month
    const lastAmortMonth = amortization.length > 0
      ? amortization[amortization.length - 1].month
      : null;
    let projectionStartDate;
    if (lastAmortMonth) {
      const [y, m] = lastAmortMonth.split('-').map(Number);
      projectionStartDate = new Date(Date.UTC(y, m, 1)); // month after
    } else {
      projectionStartDate = new Date(asOfDate);
    }

    const projectionBalance = -currentBalance;

    const paymentPlansFilled = this.calculatePaymentPlans({
      balance: projectionBalance,
      interestRate,
      minimumPayment,
      paymentPlans,
      startDate: projectionStartDate
    });

    // Add a "Historical Pace" plan derived from actual payment average
    if (amortization.length > 0) {
      const avgMonthlyPayment = this.#round(totalPaid / amortization.length);
      const historicalPlan = this.calculatePaymentPlans({
        balance: projectionBalance,
        interestRate,
        minimumPayment: avgMonthlyPayment,
        paymentPlans: [{
          id: 'historical',
          title: 'Historical Pace',
          subtitle: `Avg ${Math.round(avgMonthlyPayment).toLocaleString()}/mo based on actuals`
        }],
        startDate: projectionStartDate
      });
      paymentPlansFilled.push(...historicalPlan);
    }

    const startingBalance = mortgageStartValue;
    const monthsSinceStart = this.#monthsDiff(new Date(startDate), new Date(asOfDate));
    const percentPaidOff = (startingBalance - currentBalance) / startingBalance;

    const monthlyRent = this.#round(totalInterestPaid / monthsSinceStart);
    const monthlyEquity = this.#round(totalPrincipalPaid / monthsSinceStart);

    const { earliestPayoff, latestPayoff } = this.#findPayoffRange(paymentPlansFilled);

    return {
      accountId,
      mortgageStartValue,
      startingBalance,
      totalInterestPaid: this.#round(totalInterestPaid),
      totalPrincipalPaid: this.#round(totalPrincipalPaid),
      monthlyRent,
      monthlyEquity,
      percentPaidOff,
      balance: currentBalance,
      interestRate,
      earliestPayoff,
      latestPayoff,
      totalPaid: this.#round(totalPaid),
      transactions: allTransactions,
      amortization,
      paymentPlans: paymentPlansFilled
    };
  }

  /**
   * Build mortgage status from Buxfer transactions only (original logic)
   * @private
   */
  #buildFromBuxferOnly({ config, balance, transactions, asOfDate }) {
    const {
      mortgageStartValue,
      accountId,
      startDate,
      interestRate,
      minimumPayment,
      paymentPlans = []
    } = config;

    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    // Reconstruct amortization from first principles
    const amortization = this.reconstructAmortization({
      mortgageStartValue,
      interestRate,
      startDate,
      transactions: sortedTransactions,
      currentBalance: balance,
      asOfDate
    });

    // Derive totals from reconstruction
    const totalPaid = sortedTransactions.reduce((total, { amount }) => total + (amount || 0), 0);
    const totalInterestPaid = amortization.reduce((sum, m) => sum + m.interestAccrued, 0);
    const totalPrincipalPaid = this.#round(totalPaid - totalInterestPaid);
    const monthsSinceStart = this.#monthsDiff(new Date(startDate), new Date(asOfDate));

    const monthlyRent = this.#round(totalInterestPaid / monthsSinceStart);
    const monthlyEquity = this.#round(totalPrincipalPaid / monthsSinceStart);
    const percentPaidOff = totalPrincipalPaid / mortgageStartValue;

    // Add running balance to transactions (preserves existing behavior)
    const startingBalanceNeg = -mortgageStartValue;
    let runningTotal = 0;
    const transactionsWithBalance = sortedTransactions.map((txn) => {
      runningTotal += txn.amount;
      return {
        ...txn,
        runningBalance: this.#round(startingBalanceNeg + runningTotal),
        source: 'buxfer'
      };
    });

    // Start projections from the month after the last amortization month
    // so the first plan month connects seamlessly to the last reconstructed balance
    const lastAmortMonth = amortization.length > 0
      ? amortization[amortization.length - 1].month
      : null;
    let projectionStartDate;
    if (lastAmortMonth) {
      const [y, m] = lastAmortMonth.split('-').map(Number);
      projectionStartDate = new Date(Date.UTC(y, m, 1)); // month after (0-indexed: m is already next)
    } else {
      projectionStartDate = new Date(asOfDate);
    }

    // Use the reconstructed closing balance (reconciled to actual) as the projection start
    const projectionBalance = amortization.length > 0
      ? -amortization[amortization.length - 1].closingBalance
      : balance;

    const paymentPlansFilled = this.calculatePaymentPlans({
      balance: projectionBalance,
      interestRate,
      minimumPayment,
      paymentPlans,
      startDate: projectionStartDate
    });

    // Add a "Historical Pace" plan derived from actual payment average
    if (amortization.length > 0) {
      const avgMonthlyPayment = this.#round(totalPaid / amortization.length);
      const historicalPlan = this.calculatePaymentPlans({
        balance: projectionBalance,
        interestRate,
        minimumPayment: avgMonthlyPayment,
        paymentPlans: [{
          id: 'historical',
          title: 'Historical Pace',
          subtitle: `Avg ${Math.round(avgMonthlyPayment).toLocaleString()}/mo based on actuals`
        }],
        startDate: projectionStartDate
      });
      paymentPlansFilled.push(...historicalPlan);
    }

    const { earliestPayoff, latestPayoff } = this.#findPayoffRange(paymentPlansFilled);

    return {
      accountId,
      mortgageStartValue,
      startingBalance: mortgageStartValue,
      totalInterestPaid: this.#round(totalInterestPaid),
      totalPrincipalPaid,
      monthlyRent,
      monthlyEquity,
      percentPaidOff: this.#round(percentPaidOff),
      balance: Math.abs(balance),
      interestRate,
      earliestPayoff,
      latestPayoff,
      totalPaid,
      transactions: transactionsWithBalance,
      amortization,
      paymentPlans: paymentPlansFilled
    };
  }

  /**
   * Reconstruct month-by-month amortization from actual payment history
   *
   * Walks forward from loan start applying known interest rate and actual payments,
   * then reconciles against the current balance anchor to correct for rounding drift.
   *
   * @param {Object} params
   * @param {number} params.mortgageStartValue - Original loan amount
   * @param {number} params.interestRate - Annual interest rate (decimal)
   * @param {string} params.startDate - Loan start date (YYYY-MM-DD)
   * @param {Object[]} params.transactions - Payment transactions [{date, amount}]
   * @param {number} params.currentBalance - Current balance from bank (negative = debt)
   * @param {string|Date} params.asOfDate - Date to reconstruct up to
   * @returns {Object[]} Per-month amortization records
   */
  reconstructAmortization({ mortgageStartValue, interestRate, startDate, transactions, currentBalance, asOfDate }) {
    const monthlyRate = interestRate / 12;
    const actualBalance = Math.abs(currentBalance);

    // Group transactions by month
    const txnsByMonth = {};
    for (const txn of transactions) {
      const month = txn.date.slice(0, 7); // YYYY-MM
      if (!txnsByMonth[month]) txnsByMonth[month] = [];
      txnsByMonth[month].push(txn);
    }

    // Build month list from startDate to asOfDate
    const startYM = startDate.slice(0, 7);
    const endYM = (typeof asOfDate === 'string' ? asOfDate : asOfDate.toISOString()).slice(0, 7);
    const months = [];
    let [y, m] = startYM.split('-').map(Number);
    const [endY, endM] = endYM.split('-').map(Number);
    while (y < endY || (y === endY && m <= endM)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }

    // Walk forward computing interest and applying payments
    let balance = mortgageStartValue;
    let cumulativeInterest = 0;
    const records = [];

    for (const month of months) {
      const openingBalance = this.#round(balance);
      const interestAccrued = this.#round(balance * monthlyRate);
      balance += interestAccrued;
      cumulativeInterest += interestAccrued;

      const monthTxns = txnsByMonth[month] || [];
      const payments = monthTxns.map(t => t.amount);
      const totalPaid = payments.reduce((a, b) => a + b, 0);
      balance -= totalPaid;

      records.push({
        month,
        effectiveRate: interestRate,
        openingBalance,
        interestAccrued,
        payments,
        totalPaid: this.#round(totalPaid),
        principalPaid: this.#round(totalPaid - interestAccrued),
        closingBalance: this.#round(balance),
        cumulativeInterest: this.#round(cumulativeInterest),
        reconciliationAdj: 0
      });
    }

    // Reconcile against anchor balance
    if (records.length > 0) {
      const drift = this.#round(actualBalance - Math.abs(records[records.length - 1].closingBalance));
      if (Math.abs(drift) > 0.01) {
        const totalInterest = records.reduce((sum, r) => sum + r.interestAccrued, 0);
        let cumulativeAdj = 0;
        for (const record of records) {
          const weight = totalInterest > 0 ? record.interestAccrued / totalInterest : 1 / records.length;
          const adj = this.#round(drift * weight);
          record.reconciliationAdj = adj;
          record.interestAccrued = this.#round(record.interestAccrued + adj);
          record.principalPaid = this.#round(record.totalPaid - record.interestAccrued);
          cumulativeAdj += adj;
        }
        // Recompute balances and cumulative interest after adjustment
        balance = mortgageStartValue;
        cumulativeInterest = 0;
        for (const record of records) {
          record.openingBalance = this.#round(balance);
          balance += record.interestAccrued;
          cumulativeInterest += record.interestAccrued;
          balance -= record.totalPaid;
          record.closingBalance = this.#round(balance);
          record.cumulativeInterest = this.#round(cumulativeInterest);
        }
      }
    }

    return records;
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
