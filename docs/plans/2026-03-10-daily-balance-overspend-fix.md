# Daily Balance Overspend Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the falsy-zero daily balance reset bug and expose overspending in the day-to-day chart.

**Architecture:** Backend changes in `BudgetCompilationService` fix two bugs (falsy-zero `||`, budget masking) and emit chart-ready `displayBalance`/`overspent` fields. Frontend changes in `daytoday.jsx` consume the new fields to render red bars and a subtle overspent band.

**Tech Stack:** Node.js backend (ES modules), React/Highcharts frontend, Jest tests.

**Design doc:** `docs/plans/2026-03-10-daily-balance-overspend-design.md`

---

### Task 1: Write failing tests for the falsy-zero bug

**Files:**
- Modify: `tests/isolated/flow/finance/BudgetCompilationService.test.mjs`

**Step 1: Add test for zero-balance continuity**

Add a new `describe` block after the existing `surplus allocation` block (line ~262):

```javascript
describe('daily balance continuity', () => {
  it('carries forward zero balance without resetting to budget', async () => {
    // Transactions that exactly consume the $800 budget by day 28
    const zeroOutTransactions = [
      { id: '1', date: '2026-01-15', amount: 2500, expenseAmount: -2500, description: 'Paycheck', tagNames: ['Income'], type: 'income' },
      { id: '2', date: '2026-01-05', amount: 400, expenseAmount: 400, description: 'Groceries', tagNames: ['Groceries'], type: 'expense' },
      { id: '3', date: '2026-01-15', amount: 400, expenseAmount: 400, description: 'More Groceries', tagNames: ['Groceries'], type: 'expense' },
      { id: '4', date: '2026-01-20', amount: 1500, expenseAmount: 1500, description: 'Rent', tagNames: ['Rent'], type: 'expense' },
    ];
    mockFinanceStore.getTransactions.mockReturnValue(zeroOutTransactions);

    const result = await service.compile();
    const dtd = result.budgets['2026-01-01'].dayToDayBudget['2026-01'];
    const balances = dtd.dailyBalances;

    // After spending $800 (400+400) on a $800 budget, balance should be 0
    // Day after should start at 0, NOT reset to 800
    const jan15 = balances['2026-01-15'];
    expect(jan15.endingBalance).toBe(0);

    const jan16 = balances['2026-01-16'];
    expect(jan16.startingBalance).toBe(0);
    expect(jan16.endingBalance).toBe(0);

    // Last day should also be 0, not the budget
    const jan31 = balances['2026-01-31'];
    expect(jan31.startingBalance).toBe(0);
    expect(jan31.endingBalance).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs -t "carries forward zero balance" --no-coverage`
Expected: FAIL — `jan16.startingBalance` will be 800 (the bug)

---

### Task 2: Fix the falsy-zero bug

**Files:**
- Modify: `backend/src/3_applications/finance/BudgetCompilationService.mjs:517`
- Modify: `backend/src/3_applications/finance/BudgetCompilationService.mjs:457`

**Step 1: Fix `#calculateDailyBalances` line 517**

Change:
```javascript
const startingBalance = dailyBalances[prevDayStr]?.endingBalance || budget;
```
To:
```javascript
const startingBalance = dailyBalances[prevDayStr]?.endingBalance ?? budget;
```

**Step 2: Fix `#buildDayToDayBudget` line 457**

Change:
```javascript
const lastBalance = Object.values(dailyBalances).pop()?.endingBalance || balance;
```
To:
```javascript
const lastBalance = Object.values(dailyBalances).pop()?.endingBalance ?? balance;
```

**Step 3: Run test to verify it passes**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs -t "carries forward zero balance" --no-coverage`
Expected: PASS

**Step 4: Run full test suite to check for regressions**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/BudgetCompilationService.mjs tests/isolated/flow/finance/BudgetCompilationService.test.mjs
git commit -m "fix(finance): use nullish coalescing for daily balance continuity

The || operator treated endingBalance=0 as falsy, resetting the next
day's starting balance to the full monthly budget. Affected 10 of 36
months. Replace || with ?? on lines 517 and 457."
```

---

### Task 3: Write failing test for budget masking

**Files:**
- Modify: `tests/isolated/flow/finance/BudgetCompilationService.test.mjs`

**Step 1: Add test for configured budget on past months**

Add inside the `daily balance continuity` describe block:

```javascript
it('uses configured budget for past months, not spending', async () => {
  // Use a budget period in the past (2025-01-01 to 2025-06-30)
  const pastBudgetConfig = {
    budget: [{
      timeframe: { start: '2025-01-01', end: '2025-06-30' },
      accounts: ['Checking'],
      income: {
        salary: { amount: 60000, payCheckCount: 24, payFrequencyInDays: 14, firstPaycheckDate: '2025-01-10' },
        tags: ['Income'],
        extra: []
      },
      dayToDay: { amount: 800, tags: ['Groceries'] },
      monthly: [{ label: 'Rent', amount: 1500, tags: ['Rent'] }],
      shortTerm: [{ label: 'Travel', amount: 500, flex: 1, tags: ['Travel'] }]
    }],
    mortgage: null
  };

  // Past month transactions that overspend: $900 on an $800 budget
  const overspendTransactions = [
    { id: '1', date: '2025-01-15', amount: 2500, expenseAmount: -2500, description: 'Paycheck', tagNames: ['Income'], type: 'income' },
    { id: '2', date: '2025-01-10', amount: 500, expenseAmount: 500, description: 'Groceries', tagNames: ['Groceries'], type: 'expense' },
    { id: '3', date: '2025-01-20', amount: 400, expenseAmount: 400, description: 'More Groceries', tagNames: ['Groceries'], type: 'expense' },
    { id: '4', date: '2025-01-25', amount: 1500, expenseAmount: 1500, description: 'Rent', tagNames: ['Rent'], type: 'expense' },
  ];

  mockFinanceStore.getBudgetConfig.mockReturnValue(pastBudgetConfig);
  mockFinanceStore.getTransactions.mockReturnValue(overspendTransactions);

  const result = await service.compile();
  const dtd = result.budgets['2025-01-01'].dayToDayBudget['2025-01'];

  // Budget should be the configured amount, not spending
  expect(dtd.budget).toBe(800);

  // With $900 spent on $800 budget, balance goes negative
  const jan31 = dtd.dailyBalances['2025-01-31'];
  expect(jan31.endingBalance).toBe(-100);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs -t "uses configured budget for past months" --no-coverage`
Expected: FAIL — `dtd.budget` will equal 900 (spending), not 800

---

### Task 4: Fix budget masking for past months

**Files:**
- Modify: `backend/src/3_applications/finance/BudgetCompilationService.mjs:450`

**Step 1: Change line 450**

Change:
```javascript
const budget = isCurrentMonth ? config.dayToDay.amount : spending;
```
To:
```javascript
const budget = config.dayToDay.amount;
```

**Step 2: Run test to verify it passes**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs -t "uses configured budget for past months" --no-coverage`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs --no-coverage`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/src/3_applications/finance/BudgetCompilationService.mjs tests/isolated/flow/finance/BudgetCompilationService.test.mjs
git commit -m "fix(finance): use configured budget for past months

Past months set budget=spending, hiding overspending. Now always uses
config.dayToDay.amount so the chart shows when spending exceeds budget."
```

---

### Task 5: Write failing test for displayBalance/overspent fields

**Files:**
- Modify: `tests/isolated/flow/finance/BudgetCompilationService.test.mjs`

**Step 1: Add test for chart-ready fields**

Add inside the `daily balance continuity` describe block:

```javascript
it('emits displayBalance and overspent fields on daily balances', async () => {
  const pastBudgetConfig = {
    budget: [{
      timeframe: { start: '2025-01-01', end: '2025-06-30' },
      accounts: ['Checking'],
      income: {
        salary: { amount: 60000, payCheckCount: 24, payFrequencyInDays: 14, firstPaycheckDate: '2025-01-10' },
        tags: ['Income'],
        extra: []
      },
      dayToDay: { amount: 500, tags: ['Groceries'] },
      monthly: [{ label: 'Rent', amount: 1500, tags: ['Rent'] }],
      shortTerm: [{ label: 'Travel', amount: 500, flex: 1, tags: ['Travel'] }]
    }],
    mortgage: null
  };

  // $600 spent on $500 budget = $100 overspend
  const overspendTransactions = [
    { id: '1', date: '2025-01-15', amount: 2500, expenseAmount: -2500, description: 'Paycheck', tagNames: ['Income'], type: 'income' },
    { id: '2', date: '2025-01-10', amount: 300, expenseAmount: 300, description: 'Groceries', tagNames: ['Groceries'], type: 'expense' },
    { id: '3', date: '2025-01-20', amount: 300, expenseAmount: 300, description: 'More Groceries', tagNames: ['Groceries'], type: 'expense' },
    { id: '4', date: '2025-01-25', amount: 1500, expenseAmount: 1500, description: 'Rent', tagNames: ['Rent'], type: 'expense' },
  ];

  mockFinanceStore.getBudgetConfig.mockReturnValue(pastBudgetConfig);
  mockFinanceStore.getTransactions.mockReturnValue(overspendTransactions);

  const result = await service.compile();
  const dtd = result.budgets['2025-01-01'].dayToDayBudget['2025-01'];
  const balances = dtd.dailyBalances;

  // Day with positive balance
  const jan01 = balances['2025-01-01'];
  expect(jan01.displayBalance).toBe(500);
  expect(jan01.overspent).toBe(false);

  // Day with negative balance (after $600 spent on $500 budget)
  const jan31 = balances['2025-01-31'];
  expect(jan31.endingBalance).toBe(-100);
  expect(jan31.displayBalance).toBe(100);
  expect(jan31.overspent).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs -t "emits displayBalance and overspent" --no-coverage`
Expected: FAIL — `displayBalance` and `overspent` don't exist yet

---

### Task 6: Add displayBalance and overspent to daily balances

**Files:**
- Modify: `backend/src/3_applications/finance/BudgetCompilationService.mjs:530-537`

**Step 1: Add fields to `#calculateDailyBalances`**

In `#calculateDailyBalances`, replace the daily entry object (lines 530-537):

```javascript
      dailyBalances[dayStr] = {
        dayInt: day,
        startingBalance,
        credits,
        debits,
        endingBalance,
        transactionCount: dayTransactions.length
      };
```

With:

```javascript
      dailyBalances[dayStr] = {
        dayInt: day,
        startingBalance,
        credits,
        debits,
        endingBalance,
        displayBalance: Math.abs(endingBalance),
        overspent: endingBalance < 0,
        transactionCount: dayTransactions.length
      };
```

**Step 2: Also add to the start entry (lines 503-510)**

Replace:
```javascript
    dailyBalances[`${month}-start`] = {
      dayInt: 0,
      startingBalance: budget,
      credits: 0,
      debits: 0,
      endingBalance: budget,
      transactionCount: 0
    };
```

With:
```javascript
    dailyBalances[`${month}-start`] = {
      dayInt: 0,
      startingBalance: budget,
      credits: 0,
      debits: 0,
      endingBalance: budget,
      displayBalance: budget,
      overspent: false,
      transactionCount: 0
    };
```

**Step 3: Run test to verify it passes**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs -t "emits displayBalance and overspent" --no-coverage`
Expected: PASS

**Step 4: Run full test suite**

Run: `npx jest tests/isolated/flow/finance/BudgetCompilationService.test.mjs --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/BudgetCompilationService.mjs tests/isolated/flow/finance/BudgetCompilationService.test.mjs
git commit -m "feat(finance): add displayBalance and overspent to daily balances

Each day entry now includes displayBalance (abs value for chart bar
height) and overspent (boolean for red coloring)."
```

---

### Task 7: Update frontend chart to use new fields

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/daytoday.jsx:32-41,46,94,153-157,160`

**Step 1: Update actualData to use displayBalance and overspent**

Replace lines 32-41:
```javascript
  const actualData = dayKeys.map((dateKey, idx) => {
    const isMonday = moment(dateKey).day() === 1;
    const isFirstDay = idx === 0;
    const isWeekend = moment(dateKey).day() === 0 || moment(dateKey).day() === 6;
    const highlightToday = isCurrentMonth && idx === today;
    return {
      y: dailyBalances[dateKey].endingBalance,
      color: (highlightToday || isFirstDay) ? '#0077b6' : (isWeekend ? '#777' : undefined)
    };
  });
```

With:
```javascript
  const actualData = dayKeys.map((dateKey, idx) => {
    const day = dailyBalances[dateKey];
    const isFirstDay = idx === 0;
    const isWeekend = moment(dateKey).day() === 0 || moment(dateKey).day() === 6;
    const highlightToday = isCurrentMonth && idx === today;
    const overspent = day.overspent;
    return {
      y: day.displayBalance ?? Math.abs(day.endingBalance),
      actualBalance: day.endingBalance,
      color: overspent ? '#c1121f' : (highlightToday || isFirstDay) ? '#0077b6' : (isWeekend ? '#777' : undefined)
    };
  });
```

**Step 2: Update endingBalance stat (line 46)**

Change:
```javascript
  const endingBalance = dailyBalances[lastDayKey]?.endingBalance || 0;
```

To:
```javascript
  const endingBalance = dailyBalances[lastDayKey]?.endingBalance ?? 0;
```

**Step 3: Update tooltip to show real balance**

In the tooltip formatter (line 100-105), replace:
```javascript
      formatter: function () {
        if (!this.y && this.y !== 0) return false;
        const dayNum = parseInt(this.key) || this.x + 1;
        const date = moment(inferredMonth).date(dayNum).format('MMMM D, YYYY');
        return `<b>${this.series.name}: ${formatAsCurrency(this.y)}</b><br/>${date}`;
      }
```

With:
```javascript
      formatter: function () {
        if (!this.y && this.y !== 0) return false;
        const dayNum = parseInt(this.key) || this.x + 1;
        const date = moment(inferredMonth).date(dayNum).format('MMMM D, YYYY');
        const displayValue = this.point?.actualBalance != null
          ? formatAsCurrency(this.point.actualBalance)
          : formatAsCurrency(this.y);
        return `<b>${this.series.name}: ${displayValue}</b><br/>${date}`;
      }
```

**Step 4: Update overspent band to subtle tint**

Replace lines 153-157:
```javascript
      plotBands: zeroCrossingIndex >= 0 ? [{
        from: zeroCrossingIndex,
        to: daysInMonth,
        color: 'rgba(255, 0, 0, 0.1)'
      }] : []
```

With:
```javascript
      plotBands: zeroCrossingIndex >= 0 ? [{
        from: zeroCrossingIndex,
        to: daysInMonth,
        color: 'rgba(255, 0, 0, 0.05)'
      }] : []
```

**Step 5: Update zeroCrossingIndex to use overspent field**

Replace line 94:
```javascript
  const zeroCrossingIndex = actualData.findIndex((pt) => pt.y < 0);
```

With:
```javascript
  const zeroCrossingIndex = dayKeys.findIndex(key => dailyBalances[key].overspent);
```

**Step 6: Update yAxis min to always be 0**

Replace line 160:
```javascript
      min: Math.min(0, endingBalance, ...actualData.map((a) => a.y)),
```

With:
```javascript
      min: 0,
```

**Step 7: Commit**

```bash
git add frontend/src/modules/Finances/blocks/daytoday.jsx
git commit -m "feat(finance): render overspent days as red bars in day-to-day chart

Uses displayBalance for bar height (always positive) and overspent
flag for red coloring. Subtle band tint for overspent region.
Tooltip still shows actual (negative) balance."
```

---

### Task 8: Verify end-to-end with live data

**Step 1: Recompile budget data**

Run: `curl -s -X POST http://localhost:3111/api/v1/finance/compile`

**Step 2: Verify daily balance continuity**

```bash
curl -s http://localhost:3111/api/v1/finance/data | python3 -c "
import json, sys
data = json.load(sys.stdin)
errors = 0
for period in sorted(data['budgets'].keys()):
    dtd = data['budgets'][period].get('dayToDayBudget', {})
    for month in sorted(dtd.keys()):
        bals = dtd[month].get('dailyBalances', {})
        entries = list(bals.items())
        for i in range(1, len(entries)):
            prev_key, prev = entries[i-1]
            curr_key, curr = entries[i]
            if abs(curr['startingBalance'] - prev['endingBalance']) > 0.01:
                print(f'GAP: {prev_key} -> {curr_key}')
                errors += 1
            if 'displayBalance' not in curr:
                print(f'MISSING displayBalance: {curr_key}')
                errors += 1
print(f'Errors: {errors}')
"
```

Expected: `Errors: 0`

**Step 3: Verify overspent months show negative balances**

```bash
curl -s http://localhost:3111/api/v1/finance/data | python3 -c "
import json, sys
data = json.load(sys.stdin)
for period in sorted(data['budgets'].keys()):
    dtd = data['budgets'][period].get('dayToDayBudget', {})
    for month in sorted(dtd.keys()):
        mdata = dtd[month]
        bals = mdata.get('dailyBalances', {})
        overspent_days = [(k, v) for k, v in bals.items() if v.get('overspent')]
        if overspent_days:
            print(f'{month}: {len(overspent_days)} overspent days, budget=\${mdata[\"budget\"]}')
"
```

Expected: 2025-04, 2025-11, 2026-01 show overspent days

**Step 4: Commit verification results and update audit**

```bash
git add docs/_wip/audits/2026-03-10-daily-balance-reset-on-zero-audit.md
git commit -m "docs: update audit with verification results"
```
