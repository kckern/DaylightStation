# Mortgage Interest Reconstruction & Enhanced UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct per-month mortgage interest from the fixed rate and payment history, then use that data to power a sawtooth balance chart, cumulative interest overlay, plan comparison drawer, and cost-of-capital calculator.

**Architecture:** New `reconstructAmortization()` method on `MortgageCalculator` (domain layer) walks forward month-by-month from loan start, computing interest and applying payments, then reconciles against the actual Buxfer balance. `calculateMortgageStatus()` integrates this reconstruction. Frontend chart switches from single-point-per-month to two-point sawtooth with a cumulative interest area overlay. Drawer gets three tabs: Amortization, Plan Comparison, Cost of Capital.

**Tech Stack:** Node.js (backend domain service), Jest (tests), React + Mantine + Highcharts (frontend)

**Spec:** `docs/superpowers/specs/2026-03-30-mortgage-interest-reconstruction-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/2_domains/finance/services/MortgageCalculator.mjs` | Modify | Add `reconstructAmortization()`, update `calculateMortgageStatus()` |
| `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs` | Modify | Add tests for reconstruction, reconciliation, edge cases |
| `frontend/src/modules/Finances/blocks/mortgage.jsx` | Modify | Sawtooth chart, cumulative interest, drawer tabs, seam fixes |
| `frontend/src/Apps/FinanceApp.scss` | Modify | Styles for drawer tabs, today separator, past-row tinting |

---

### Task 1: Test and implement `reconstructAmortization()`

**Files:**
- Modify: `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs`
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs`

- [ ] **Step 1: Write failing test — basic reconstruction with known values**

Add this test block after the existing `calculateMortgageStatus` describe block in `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs`:

```javascript
describe('reconstructAmortization', () => {
  test('reconstructs monthly interest for a simple 3-month scenario', () => {
    // $100,000 loan at 6% annual, 3 months of $1,000 payments
    // Month 1: interest = 100000 * 0.06/12 = 500, balance = 100000 + 500 - 1000 = 99500
    // Month 2: interest = 99500 * 0.06/12 = 497.50, balance = 99500 + 497.50 - 1000 = 98997.50
    // Month 3: interest = 98997.50 * 0.06/12 = 494.99, balance = 98997.50 + 494.99 - 1000 = 98492.49
    const result = calculator.reconstructAmortization({
      mortgageStartValue: 100000,
      interestRate: 0.06,
      startDate: '2026-01-01',
      transactions: [
        { date: '2026-01-15', amount: 1000 },
        { date: '2026-02-15', amount: 1000 },
        { date: '2026-03-15', amount: 1000 },
      ],
      currentBalance: -98492.49,
      asOfDate: '2026-03-31'
    });

    expect(result).toHaveLength(3);
    expect(result[0].month).toBe('2026-01');
    expect(result[0].openingBalance).toBe(100000);
    expect(result[0].interestAccrued).toBeCloseTo(500, 0);
    expect(result[0].totalPaid).toBe(1000);
    expect(result[0].principalPaid).toBeCloseTo(500, 0);
    expect(result[0].closingBalance).toBeCloseTo(99500, 0);
    expect(result[0].cumulativeInterest).toBeCloseTo(500, 0);
    expect(result[0].effectiveRate).toBe(0.06);

    expect(result[2].closingBalance).toBeCloseTo(98492.49, 0);
    expect(result[2].cumulativeInterest).toBeCloseTo(1492.49, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: FAIL with `calculator.reconstructAmortization is not a function`

- [ ] **Step 3: Implement `reconstructAmortization()` on MortgageCalculator**

Add this method to the `MortgageCalculator` class in `backend/src/2_domains/finance/services/MortgageCalculator.mjs`, before the `#calculateSinglePlan` private method:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/domain/finance/services/MortgageCalculator.test.mjs backend/src/2_domains/finance/services/MortgageCalculator.mjs
git commit -m "feat(mortgage): add reconstructAmortization method for interest calculation"
```

---

### Task 2: Test and implement anchor reconciliation

**Files:**
- Modify: `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs`
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs` (already modified in Task 1)

- [ ] **Step 1: Write failing test — reconciliation distributes drift**

Add inside the `reconstructAmortization` describe block:

```javascript
  test('reconciles drift against actual balance by distributing proportionally', () => {
    // Same loan but actual balance differs from pure calculation by $100
    // This simulates real-world rounding or day-count differences
    const result = calculator.reconstructAmortization({
      mortgageStartValue: 100000,
      interestRate: 0.06,
      startDate: '2026-01-01',
      transactions: [
        { date: '2026-01-15', amount: 1000 },
        { date: '2026-02-15', amount: 1000 },
        { date: '2026-03-15', amount: 1000 },
      ],
      currentBalance: -98592.49, // $100 more than pure calc (98492.49)
      asOfDate: '2026-03-31'
    });

    // Final balance should match the anchor
    expect(result[2].closingBalance).toBeCloseTo(98592.49, 1);

    // Each month should have a reconciliation adjustment
    const totalAdj = result.reduce((sum, r) => sum + r.reconciliationAdj, 0);
    expect(totalAdj).toBeCloseTo(100, 0);

    // Higher-interest months should absorb more of the adjustment
    expect(result[0].reconciliationAdj).toBeGreaterThanOrEqual(result[2].reconciliationAdj);
  });

  test('handles zero drift (perfect reconciliation)', () => {
    const result = calculator.reconstructAmortization({
      mortgageStartValue: 10000,
      interestRate: 0.06,
      startDate: '2026-01-01',
      transactions: [
        { date: '2026-01-15', amount: 500 },
      ],
      currentBalance: -9550, // 10000 + 50 - 500 = 9550
      asOfDate: '2026-01-31'
    });

    expect(result[0].reconciliationAdj).toBe(0);
    expect(result[0].closingBalance).toBe(9550);
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: PASS (reconciliation logic was implemented in Task 1)

- [ ] **Step 3: Write test — months with no payments**

```javascript
  test('handles months with no payments', () => {
    const result = calculator.reconstructAmortization({
      mortgageStartValue: 100000,
      interestRate: 0.06,
      startDate: '2026-01-01',
      transactions: [
        { date: '2026-03-15', amount: 1000 }, // No payments in Jan or Feb
      ],
      currentBalance: -100497.50, // 100000 + 500 + 502.50 + 505.01 - 1000
      asOfDate: '2026-03-31'
    });

    expect(result).toHaveLength(3);
    expect(result[0].totalPaid).toBe(0);
    expect(result[0].payments).toEqual([]);
    expect(result[1].totalPaid).toBe(0);
    expect(result[2].totalPaid).toBe(1000);
    // Balance should grow during months with no payment
    expect(result[1].closingBalance).toBeGreaterThan(result[0].closingBalance);
  });

  test('handles multiple payments in same month', () => {
    const result = calculator.reconstructAmortization({
      mortgageStartValue: 100000,
      interestRate: 0.06,
      startDate: '2026-01-01',
      transactions: [
        { date: '2026-01-05', amount: 1000 },
        { date: '2026-01-20', amount: 5000 },
      ],
      currentBalance: -94500, // 100000 + 500 - 6000
      asOfDate: '2026-01-31'
    });

    expect(result).toHaveLength(1);
    expect(result[0].payments).toEqual([1000, 5000]);
    expect(result[0].totalPaid).toBe(6000);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/domain/finance/services/MortgageCalculator.test.mjs
git commit -m "test(mortgage): add reconciliation and edge case tests for reconstructAmortization"
```

---

### Task 3: Integrate reconstruction into `calculateMortgageStatus()`

**Files:**
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs`
- Modify: `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs`

- [ ] **Step 1: Write failing test — status includes amortization**

Add inside the `calculateMortgageStatus` describe block:

```javascript
    test('includes reconstructed amortization in status', () => {
      const config = {
        mortgageStartValue: 100000,
        accountId: 'mortgage-1',
        startDate: '2026-01-01',
        interestRate: 0.06,
        minimumPayment: 1000,
        paymentPlans: [{ id: 'default', title: 'Default' }]
      };

      const transactions = [
        { date: '2026-01-15', amount: 1000 },
        { date: '2026-02-15', amount: 1000 },
      ];

      const result = calculator.calculateMortgageStatus({
        config,
        balance: -99000,
        transactions,
        asOfDate: new Date('2026-02-28')
      });

      // Should have amortization field
      expect(result.amortization).toBeDefined();
      expect(result.amortization).toHaveLength(2);
      expect(result.amortization[0]).toHaveProperty('interestAccrued');
      expect(result.amortization[0]).toHaveProperty('cumulativeInterest');
      expect(result.amortization[0]).toHaveProperty('principalPaid');

      // totalInterestPaid should come from reconstruction
      expect(result.totalInterestPaid).toBeCloseTo(
        result.amortization.reduce((sum, m) => sum + m.interestAccrued, 0), 1
      );
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: FAIL with `expect(result.amortization).toBeDefined()` failing

- [ ] **Step 3: Update `calculateMortgageStatus()` to use reconstruction**

In `backend/src/2_domains/finance/services/MortgageCalculator.mjs`, replace the body of `calculateMortgageStatus()` (lines 131-209) with:

```javascript
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
        runningBalance: this.#round(startingBalanceNeg + runningTotal)
      };
    });

    // Calculate payment plan projections starting from current balance
    const paymentPlansFilled = this.calculatePaymentPlans({
      balance,
      interestRate,
      minimumPayment,
      paymentPlans,
      startDate: asOfDate
    });

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
```

- [ ] **Step 4: Run all MortgageCalculator tests**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: Most pass. Some existing tests may need adjustment because `startingBalance` is now always `mortgageStartValue` instead of the naive calculation. Fix any failures by updating expected values in existing tests.

- [ ] **Step 5: Fix any existing test assertions that break**

The existing test at line 185 expects `startingBalance` to be derived from `balance - sumOfTransactions`. Now it's `mortgageStartValue`. Update:

```javascript
    // In the 'calculates status from transactions' test:
    expect(result.startingBalance).toBe(300000); // was previously derived, now always mortgageStartValue
```

The `percentPaidOff` calculation also changes — it's now based on principal paid vs. loan amount, not balance change vs. starting balance. Update any assertions accordingly.

- [ ] **Step 6: Run tests again and confirm all pass**

Run: `npm run test:isolated -- --testPathPattern=MortgageCalculator`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/2_domains/finance/services/MortgageCalculator.mjs tests/isolated/domain/finance/services/MortgageCalculator.test.mjs
git commit -m "feat(mortgage): integrate reconstructAmortization into calculateMortgageStatus"
```

---

### Task 4: Fix chart seam issues and add plan name fix

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx`

- [ ] **Step 1: Fix plan name reference (info.planName → info.title)**

In `frontend/src/modules/Finances/blocks/mortgage.jsx`, find line 86:

```javascript
// Old:
name: plan.info.planName ? plan.info.planName : `Plan ${index + 1}`,
```

Replace with:

```javascript
// New:
name: plan.info.title || `Plan ${index + 1}`,
```

- [ ] **Step 2: Enable legend**

Find line 115:

```javascript
// Old:
legend: { enabled: false },
```

Replace with:

```javascript
// New:
legend: { enabled: true, itemStyle: { color: '#ccc' } },
```

- [ ] **Step 3: Fix past data to use amortization instead of transaction matching**

Replace the `pastData` construction (lines 62-71) with code that uses the new `amortization` array:

```javascript
      // 4. Build pastData from reconstructed amortization (one point per month)
      const pastData = (mortgage.amortization || []).map(record => {
        const ms = moment(record.month, "YYYY-MM").valueOf();
        return [ms, record.closingBalance];
      });
```

- [ ] **Step 4: Fix future series to use `endBalance` and start after last amortization month**

Replace the `futureSeries` construction (lines 74-90):

```javascript
      // 5. Build future series starting after last amortization month
      const lastAmortMonth = mortgage.amortization?.length
        ? mortgage.amortization[mortgage.amortization.length - 1].month
        : null;

      const futureSeries = mortgage.paymentPlans.map((plan) => {
        const data = plan.months
          .filter(({ month }) => !lastAmortMonth || month > lastAmortMonth)
          .map(({ month, endBalance }) => {
            const ms = moment(month, "YYYY-MM").valueOf();
            return [ms, endBalance];
          });

        return {
          name: plan.info.title || 'Plan',
          type: "line",
          data
        };
      });
```

- [ ] **Step 5: Verify chart renders without errors**

Open `http://localhost:3111` in browser, navigate to Finance app, check the mortgage chart renders. Past data should connect smoothly to future projections. Plans should show their actual names in the legend.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx
git commit -m "fix(mortgage): fix plan names, enable legend, fix past/future seam discontinuity"
```

---

### Task 5: Add sawtooth chart and cumulative interest overlay

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx`

- [ ] **Step 1: Replace single-point pastData with two-point sawtooth**

Replace the `pastData` construction from Task 4 with sawtooth points:

```javascript
      // 4. Build sawtooth pastData: two points per month (peak after interest, trough after payment)
      const pastData = (mortgage.amortization || []).flatMap(record => {
        const monthStart = moment(record.month, "YYYY-MM").valueOf();
        const monthEnd = moment(record.month, "YYYY-MM").endOf('month').valueOf();
        const peak = record.openingBalance + record.interestAccrued; // balance after interest hits
        return [
          [monthStart, peak],    // interest accrued — balance peaks
          [monthEnd, record.closingBalance]  // payment applied — balance drops
        ];
      });

      // Cumulative interest series (one point per month)
      const cumulativeInterestData = (mortgage.amortization || []).map(record => {
        const ms = moment(record.month, "YYYY-MM").endOf('month').valueOf();
        return [ms, record.cumulativeInterest];
      });
```

- [ ] **Step 2: Add secondary Y-axis and cumulative interest series to chart options**

In the `options` object, update `yAxis` to be an array for dual axes:

```javascript
      yAxis: [
        {
          title: { text: null },
          max: maxY,
          tickInterval: 25000,
          labels: {
            formatter() {
              return `$${(this.value / 1000).toFixed(0)}k`;
            }
          },
          gridLineColor: "#e0e0e0",
        },
        {
          title: { text: null },
          opposite: true,
          labels: {
            formatter() {
              return `$${(this.value / 1000).toFixed(0)}k`;
            },
            style: { color: '#ff9800' }
          },
          gridLineWidth: 0,
        }
      ],
```

- [ ] **Step 3: Update series array to include cumulative interest**

Replace the `series` array in the chart options:

```javascript
      series: [
        // Past balance (sawtooth area)
        {
          name: "Balance",
          type: "area",
          data: pastData,
          color: "#4c8ffc",
          fillOpacity: 0.3,
          yAxis: 0,
          zIndex: 1
        },
        // Cumulative interest (overlaid area, secondary axis)
        {
          name: "Cumulative Interest",
          type: "area",
          data: cumulativeInterestData,
          color: "#ff9800",
          fillOpacity: 0.15,
          yAxis: 1,
          zIndex: 0
        },
        // Future projection lines
        ...futureSeries.map((planSeries, idx) => ({
          ...planSeries,
          yAxis: 0,
          color: Highcharts.getOptions().colors[idx + 2] || "#2b2b2b",
          zIndex: 2 + idx
        }))
      ]
```

- [ ] **Step 4: Add a "today" plot line**

Add to the `xAxis` config:

```javascript
      xAxis: {
        type: "datetime",
        min: months[0]?.valueOf(),
        max: months[months.length - 1]?.valueOf(),
        tickInterval: 365.25 * 24 * 3600 * 1000,
        minorTickInterval: 30 * 24 * 3600 * 1000,
        gridLineWidth: 1,
        plotLines: [{
          color: '#ffffff55',
          width: 2,
          value: moment().valueOf(),
          dashStyle: 'Dash',
          label: { text: 'Today', style: { color: '#999' } }
        }]
      },
```

- [ ] **Step 5: Update `months` array to include amortization range**

The `months` array used for xAxis bounds needs to span both past amortization and future projections. Replace the months construction:

```javascript
      // 3. Build month range from amortization start to last payoff
      const amortMonths = (mortgage.amortization || []).map(r => moment(r.month, "YYYY-MM"));
      const planEndMonths = mortgage.paymentPlans
        .map(({ info }) => moment(info.payoffDate, "MMMM YYYY"))
        .filter(m => m.isValid());
      const allMonths = [...amortMonths, ...planEndMonths].sort((a, b) => a.diff(b));
      const months = allMonths.length ? [allMonths[0], allMonths[allMonths.length - 1]] : [];
```

- [ ] **Step 6: Update maxY to include sawtooth peaks**

```javascript
      const allPastValues = pastData.map(([_, y]) => y || 0);
      const allFutureValues = futureSeries.flatMap(s =>
        s.data.map(([_, y]) => y || 0)
      );
      const allInterestValues = cumulativeInterestData.map(([_, y]) => y || 0);
      const maxY = Math.max(...allPastValues, ...allFutureValues, 0);
```

- [ ] **Step 7: Verify sawtooth renders**

Open the Finance app in browser. The mortgage chart should show:
- Zigzag pattern for past months (up from interest, down from payment)
- Orange cumulative interest area growing on the right axis
- Smooth projection lines for future plans
- "Today" dashed vertical line
- Legend with plan names

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx
git commit -m "feat(mortgage): add sawtooth balance chart with cumulative interest overlay"
```

---

### Task 6: Add summary table enhancements

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx`

- [ ] **Step 1: Add total interest and interest ratio to summary table**

In `MortgageChart`, find the summary table (line 173) and add a third row:

```javascript
      <tr>
      <td style={{ width: '20%', textAlign: 'right' }}>Interest Paid:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(totalInterestPaid, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Interest Ratio:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{totalPaid > 0 ? `${(totalInterestPaid / totalPaid * 100).toFixed(1)}%` : '0%'}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Paid Off:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{(percentPaidOff * 100).toFixed(1)}%</b></td>
      </tr>
```

Update the destructuring at line 166 to include `totalInterestPaid`:

```javascript
    const { totalPaid, totalPrincipalPaid, totalInterestPaid, monthlyRent, monthlyEquity, percentPaidOff, balance } = mortgage;
```

- [ ] **Step 2: Verify summary shows correct values**

Open Finance app, check the mortgage summary table has three rows with interest data.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx
git commit -m "feat(mortgage): add interest paid and ratio to summary table"
```

---

### Task 7: Wire up mortgage drawer with amortization tab

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx`
- Modify: `frontend/src/Apps/FinanceApp.scss`

- [ ] **Step 1: Add required imports to mortgage.jsx**

At the top of `frontend/src/modules/Finances/blocks/mortgage.jsx`, update imports:

```javascript
import { useState } from 'react';
import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs, Badge, Table, Select, TextInput } from "@mantine/core";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
```

- [ ] **Step 2: Add click handler to open drawer from chart**

In `BudgetMortgage`, replace the `handleClick` with drawer logic:

```javascript
  export function BudgetMortgage({ setDrawerContent, mortgage }) {
    const { accountId } = mortgage;

    const openDrawer = (tab = 'amortization') => {
      setDrawerContent({
        meta: { title: 'Mortgage Details' },
        jsx: <MortgageDrawer mortgage={mortgage} defaultTab={tab} />
      });
    };

    const handleTitleClick = () => {
      window.open(`https://www.buxfer.com/account?id=${accountId}`, "_blank");
    };

    return (
      <div className="budget-block">
        <h2 onClick={handleTitleClick} style={{ cursor: 'pointer' }}>Mortgage</h2>
        <div onClick={() => openDrawer('amortization')} style={{ cursor: 'pointer' }}>
          <MortgageChart mortgage={mortgage} />
        </div>
      </div>
    );
  }
```

- [ ] **Step 2: Rewrite MortgageDrawer with Amortization tab**

Replace the existing `MortgageDrawer` component:

```javascript
  function MortgageDrawer({ mortgage, defaultTab = 'amortization' }) {
    const [selectedPlanId, setSelectedPlanId] = useState(
      mortgage.paymentPlans[0]?.info?.id || null
    );

    const selectedPlan = mortgage.paymentPlans.find(p => p.info.id === selectedPlanId);

    // Combine past amortization + future projection for the selected plan
    const lastAmortMonth = mortgage.amortization?.length
      ? mortgage.amortization[mortgage.amortization.length - 1].month
      : null;

    const futureMonths = selectedPlan?.months
      .filter(m => !lastAmortMonth || m.month > lastAmortMonth)
      .map(m => ({
        ...m,
        month: m.month,
        effectiveRate: mortgage.interestRate,
        openingBalance: m.startBalance,
        payments: m.payments,
        totalPaid: m.amountPaid,
        principalPaid: m.amountPaid - m.interestAccrued,
        closingBalance: m.endBalance,
        cumulativeInterest: null,
        isFuture: true
      })) || [];

    const combinedMonths = [
      ...(mortgage.amortization || []).map(m => ({ ...m, isFuture: false })),
      ...futureMonths
    ];

    return (
      <Tabs defaultValue={defaultTab}>
        <Tabs.List>
          <Tabs.Tab value="amortization">Amortization</Tabs.Tab>
          <Tabs.Tab value="comparison">Plan Comparison</Tabs.Tab>
          <Tabs.Tab value="costOfCapital">Cost of Capital</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="amortization" pt="md">
          <div style={{ marginBottom: '1rem' }}>
            <Select
              label="Payment Plan"
              data={mortgage.paymentPlans.map(p => ({ value: p.info.id, label: p.info.title }))}
              value={selectedPlanId}
              onChange={setSelectedPlanId}
              style={{ maxWidth: 300 }}
            />
          </div>
          <AmortizationTable months={combinedMonths} />
        </Tabs.Panel>

        <Tabs.Panel value="comparison" pt="md">
          <PlanComparisonTable paymentPlans={mortgage.paymentPlans} />
        </Tabs.Panel>

        <Tabs.Panel value="costOfCapital" pt="md">
          <CostOfCapitalCalculator mortgage={mortgage} />
        </Tabs.Panel>
      </Tabs>
    );
  }
```

- [ ] **Step 4: Build the AmortizationTable component**

Replace the existing `MortgageTable` with a version that uses the new data format:

```javascript
  function AmortizationTable({ months }) {
    return (
      <table style={{ width: '100%' }} className="mortgage-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Opening Balance</th>
            <th>Interest</th>
            <th>Payments</th>
            <th>Closing Balance</th>
            <th>Cumulative Interest</th>
          </tr>
        </thead>
        <tbody className="mortgage-table-body">
          {months.map((record, idx) => {
            const monthLabel = moment(record.month, 'YYYY-MM').format('MMMM YYYY');
            const isJanuary = record.month.endsWith('-01');
            const className = [
              isJanuary ? 'new-year' : '',
              record.isFuture ? 'future-month' : ''
            ].filter(Boolean).join(' ');

            const rows = [];
            rows.push(
              <tr key={`${record.month}-main`} className={className}>
                <td style={{ textAlign: 'right' }}>
                  <Badge color={record.isFuture ? 'blue' : 'gray'}>{monthLabel}</Badge>
                </td>
                <td>{formatAsCurrency(record.openingBalance)}</td>
                <td style={{ color: '#c00' }}>{formatAsCurrency(record.interestAccrued)}</td>
                <td>{record.payments?.length > 0 ? formatAsCurrency(record.payments[0]) : ''}</td>
                <td>{formatAsCurrency(record.closingBalance)}</td>
                <td>{record.cumulativeInterest != null ? formatAsCurrency(record.cumulativeInterest) : ''}</td>
              </tr>
            );

            // Sub-rows for additional payments
            if (record.payments?.length > 1) {
              let runningBal = record.openingBalance + record.interestAccrued - record.payments[0];
              for (let i = 1; i < record.payments.length; i++) {
                runningBal -= record.payments[i];
                rows.push(
                  <tr key={`${record.month}-payment-${i}`}>
                    <td colSpan={3} />
                    <td>{formatAsCurrency(record.payments[i])}</td>
                    <td>{formatAsCurrency(runningBal)}</td>
                    <td />
                  </tr>
                );
              }
            }

            return rows;
          })}
        </tbody>
      </table>
    );
  }
```

- [ ] **Step 5: Add styles for future months and today separator**

Append to `frontend/src/Apps/FinanceApp.scss`:

```scss
.mortgage-table-body tr.future-month td {
  background-color: #1a2a3a;
  color: #8ab4f8;
}
.mortgage-table-body tr.future-month:nth-child(odd) td {
  background-color: #1a2a3a;
}
```

- [ ] **Step 6: Verify drawer opens with amortization table**

Click the mortgage chart. Drawer should open with the amortization table showing past months (gray badges) and future months (blue badges, tinted rows). Multiple payments per month should show as sub-rows.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx frontend/src/Apps/FinanceApp.scss
git commit -m "feat(mortgage): add drawer with amortization table tab"
```

---

### Task 8: Add Plan Comparison tab

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx`

- [ ] **Step 1: Build PlanComparisonTable component**

Add this component in `mortgage.jsx`:

```javascript
  function PlanComparisonTable({ paymentPlans }) {
    // Find the plan with the most total interest (baseline for "savings" calc)
    const maxInterest = Math.max(...paymentPlans.map(p => p.info.totalInterest));

    return (
      <table style={{ width: '100%' }} className="mortgage-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Payoff Date</th>
            <th>Total Paid</th>
            <th>Total Interest</th>
            <th>Interest Saved</th>
            <th>Monthly Budget</th>
          </tr>
        </thead>
        <tbody className="mortgage-table-body">
          {paymentPlans.map((plan) => {
            const { info } = plan;
            const saved = maxInterest - info.totalInterest;
            return (
              <tr key={info.id}>
                <td>
                  <b>{info.title}</b>
                  {info.subtitle && <div style={{ fontSize: '0.8em', color: '#888' }}>{info.subtitle}</div>}
                </td>
                <td>{info.payoffDate}</td>
                <td>{formatAsCurrency(info.totalPaid, "K")}</td>
                <td>{formatAsCurrency(info.totalInterest, "K")}</td>
                <td style={{ color: saved > 0 ? '#4caf50' : 'inherit' }}>
                  {saved > 0 ? formatAsCurrency(saved, "K") : '—'}
                </td>
                <td>{formatAsCurrency(info.annualBudget / 12)}/mo</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
```

- [ ] **Step 2: Verify plan comparison renders**

Open drawer → Plan Comparison tab. Should show a row per plan with payoff dates, totals, and interest saved relative to the slowest plan.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx
git commit -m "feat(mortgage): add plan comparison tab to drawer"
```

---

### Task 9: Add Cost of Capital calculator tab

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx`

- [ ] **Step 1: Build CostOfCapitalCalculator component**

Add this component in `mortgage.jsx`:

```javascript
  function CostOfCapitalCalculator({ mortgage }) {
    const [amount, setAmount] = useState(1000);
    const commonAmounts = [1000, 5000, 10000, 25000, 50000];

    // Calculate cost of capital for a given amount and plan
    const calculateCost = (extraAmount, plan) => {
      const currentBalance = mortgage.balance;
      const rate = mortgage.interestRate;
      const minPayment = plan.months[0]?.payments?.[0] || 0;

      // Simulate payoff without extra amount (use existing plan data)
      const baseInterest = plan.info.totalInterest;
      const baseMonths = plan.info.totalPayments;

      // Simulate payoff with extra amount on balance
      let balance = currentBalance + extraAmount;
      let totalInterest = 0;
      let months = 0;
      const monthlyRate = rate / 12;

      while (balance > 0.01 && months < 1000) {
        const interest = balance * monthlyRate;
        totalInterest += interest;
        balance += interest;

        // Apply same payment pattern as the plan
        let payment = minPayment;
        const planMonth = plan.months[months];
        if (planMonth) {
          payment = planMonth.amountPaid;
        }
        if (payment > balance) payment = balance;
        balance -= payment;
        months++;
      }

      const additionalInterest = Math.round((totalInterest - baseInterest) * 100) / 100;
      const trueCost = extraAmount + additionalInterest;
      const multiplier = trueCost / extraAmount;
      const delayMonths = months - baseMonths;

      return { additionalInterest, trueCost, multiplier, delayMonths };
    };

    return (
      <div>
        <div style={{ marginBottom: '1.5rem' }}>
          <TextInput
            label="Amount to evaluate"
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            leftSection="$"
            style={{ maxWidth: 200 }}
          />
        </div>

        {mortgage.paymentPlans.map(plan => {
          const cost = calculateCost(amount, plan);
          return (
            <div key={plan.info.id} style={{
              marginBottom: '1rem',
              padding: '1rem',
              border: '1px solid #333',
              borderRadius: '8px'
            }}>
              <div style={{ fontSize: '1.2em', marginBottom: '0.5rem' }}>
                <b>{formatAsCurrency(amount)}</b> spent today costs you{' '}
                <b style={{ color: '#ff9800' }}>{formatAsCurrency(cost.trueCost)}</b>
                <span style={{ color: '#888', marginLeft: '0.5rem' }}>({plan.info.title})</span>
              </div>
              <table style={{ width: '100%', maxWidth: 400 }}>
                <tbody>
                  <tr>
                    <td style={{ color: '#888' }}>Additional interest:</td>
                    <td style={{ color: '#c00' }}>{formatAsCurrency(cost.additionalInterest)}</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#888' }}>Cost multiplier:</td>
                    <td>{cost.multiplier.toFixed(3)}×</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#888' }}>Payoff delay:</td>
                    <td>+{cost.delayMonths} month{cost.delayMonths !== 1 ? 's' : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}

        <h3 style={{ marginTop: '2rem' }}>Quick Reference</h3>
        <table style={{ width: '100%' }} className="mortgage-table">
          <thead>
            <tr>
              <th>Amount</th>
              {mortgage.paymentPlans.map(p => (
                <th key={p.info.id}>{p.info.title}</th>
              ))}
            </tr>
          </thead>
          <tbody className="mortgage-table-body">
            {commonAmounts.map(amt => (
              <tr key={amt}>
                <td>{formatAsCurrency(amt)}</td>
                {mortgage.paymentPlans.map(plan => {
                  const cost = calculateCost(amt, plan);
                  return (
                    <td key={plan.info.id}>
                      +{formatAsCurrency(cost.additionalInterest)}{' '}
                      <span style={{ color: '#888' }}>({cost.multiplier.toFixed(2)}×)</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
```

- [ ] **Step 2: Verify cost of capital calculator renders**

Open drawer → Cost of Capital tab. Enter different amounts. Each plan should show the additional interest cost and multiplier. The quick reference table should show common amounts across all plans.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx
git commit -m "feat(mortgage): add cost of capital calculator tab to drawer"
```

---

### Task 10: Recompile budget and verify end-to-end

**Files:** None (integration verification)

- [ ] **Step 1: Build and deploy container with updated backend**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 2: Recompile budget**

```bash
# Wait for container to start (~30s)
curl -s -X POST http://localhost:3111/api/v1/finance/compile
```

Expected: `{"status":"success","budgetCount":3,"hasMortgage":true}`

- [ ] **Step 3: Verify amortization data in compiled output**

```bash
sudo docker exec daylight-station sh -c "node -e \"
const yaml = require('js-yaml');
const fs = require('fs');
const data = yaml.load(fs.readFileSync('data/household/common/finances/finances.yml','utf8'));
const m = data.mortgage;
console.log('Has amortization:', !!m.amortization);
console.log('Months:', m.amortization?.length);
console.log('Total interest:', m.totalInterestPaid);
console.log('First month:', JSON.stringify(m.amortization?.[0]));
console.log('Last month:', JSON.stringify(m.amortization?.[m.amortization.length-1]));
console.log('Reconstructed balance:', m.amortization?.[m.amortization.length-1]?.closingBalance);
console.log('Actual balance:', m.balance);
\""
```

Expected: Reconstructed balance should match actual balance (within rounding).

- [ ] **Step 4: Verify frontend end-to-end**

Open `http://localhost:3111` → Finance app → Mortgage section:
1. Chart shows sawtooth pattern for past months
2. Orange cumulative interest area grows on right axis
3. Future plan lines extend smoothly from current balance
4. "Today" dashed line separates past from future
5. Legend shows plan names
6. Summary table shows Total Interest Paid and Interest Ratio
7. Click chart → drawer opens with Amortization tab
8. Switch to Plan Comparison → shows all plans with interest saved
9. Switch to Cost of Capital → enter amounts, see cost across plans

- [ ] **Step 5: Commit any final adjustments**

```bash
git add -A
git commit -m "feat(mortgage): end-to-end verification and final adjustments"
```
