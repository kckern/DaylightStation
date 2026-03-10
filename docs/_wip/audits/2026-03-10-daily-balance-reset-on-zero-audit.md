# Audit: Daily Balance Reset on Zero

**Date:** 2026-03-10
**Component:** `BudgetCompilationService.#calculateDailyBalances`
**File:** `backend/src/3_applications/finance/BudgetCompilationService.mjs`
**Severity:** Data correctness — chart renders wrong values; derived metrics (`spent`, `balance`) corrupted

---

## Summary

When the day-to-day spending balance reaches exactly $0 on any day before the last day of the month, the subsequent day's starting balance resets to the full monthly budget. This causes:

1. A false spike in the daily balance chart on the last day of the month
2. `spent` reporting as `0` (downstream of the corrupted balance)
3. `balance` reporting as the full budget amount instead of the actual remaining balance

---

## Root Cause

**Line 517 of BudgetCompilationService.mjs:**

```javascript
const startingBalance = dailyBalances[prevDayStr]?.endingBalance || budget;
```

The `|| budget` fallback is intended to handle missing previous-day entries, but **JavaScript `||` treats `0` as falsy**. When the previous day's `endingBalance` is exactly `0`, the expression evaluates to `budget` — resetting the balance to the start-of-month amount.

### Downstream impact

The corrupted last-day balance propagates to two derived fields in `#buildDayToDayBudget`:

- **Line 457:** `const lastBalance = Object.values(dailyBalances).pop()?.endingBalance || balance;` — same `|| balance` falsy-zero bug, though in practice the last day's endingBalance is the reset value (non-zero), so this picks up the wrong number.
- **Line 458:** `const spent = this.#round(spending - lastBalance);` — becomes `spending - budget = 0` when spending equals budget.

---

## Affected Months

Every month where cumulative day-to-day spending exactly equals the budget (balance hits $0 before the last day):

| Budget Period | Month | Budget | Last-Day Reset To |
|---------------|-------|--------|-------------------|
| 2025-04-01 | 2025-08 | $1,993.77 | $1,993.77 |
| 2025-04-01 | 2025-09 | $1,937.79 | $1,937.79 |
| 2025-04-01 | 2025-11 | $2,140.87 | $2,140.87 |
| 2025-04-01 | 2025-12 | $1,858.54 | $1,858.54 |
| 2024-04-01 | 2024-04 | $1,946.52 | $1,946.52 |
| 2024-04-01 | 2024-06 | $1,999.37 | $1,999.37 |
| 2024-04-01 | 2024-07 | $1,988.11 | $1,988.11 |
| 2024-04-01 | 2025-01 | $1,948.55 | $1,948.55 |

10 of 36 months affected (every past month where balance hits $0 before month-end).

---

## Related Issue: Past Month Budget Masking

**Line 450 of `#buildDayToDayBudget`:**

```javascript
const budget = isCurrentMonth ? config.dayToDay.amount : spending;
```

For past months, `budget` is set to `spending` (actual total spent), not the configured day-to-day amount ($2,000). This means:

- The chart always starts at exactly the amount spent, so the balance always ends at $0
- **Overspending is invisible** — months where spending exceeded $2,000 show no deficit
- The zero-reset bug triggers more often because balance always reaches exactly $0

### Overspent months (hidden by masking)

| Month | Actual Spent | Configured Budget | Overspend |
|-------|-------------|-------------------|-----------|
| 2025-04 | $2,067.42 | $2,000.00 | $67.42 |
| 2025-11 | $2,140.87 | $2,000.00 | $140.87 |
| 2026-01 | $2,116.05 | $2,000.00 | $116.05 |

If past months used the configured $2,000 budget instead:
- **2025-04**: goes negative on Apr 29 (min: -$67.42)
- **2025-11**: goes negative on Nov 28 (min: -$140.87)
- **2026-01**: goes negative on Jan 31 (min: -$116.05)

---

## Fix

Replace the `||` operator with nullish coalescing (`??`) so that `0` is treated as a valid balance:

### Primary fix (line 517)

```javascript
// Before
const startingBalance = dailyBalances[prevDayStr]?.endingBalance || budget;

// After
const startingBalance = dailyBalances[prevDayStr]?.endingBalance ?? budget;
```

### Secondary fix (line 457)

Same pattern in `#buildDayToDayBudget`:

```javascript
// Before
const lastBalance = Object.values(dailyBalances).pop()?.endingBalance || balance;

// After
const lastBalance = Object.values(dailyBalances).pop()?.endingBalance ?? balance;
```

Both changes replace `||` with `??`. The `??` operator only falls back when the left side is `null` or `undefined`, correctly preserving `0` as a valid balance.

---

## Verification

After applying the fix, recompile and confirm:
1. Dec 31 `startingBalance` equals Dec 30 `endingBalance` (both $0)
2. `spent` equals `spending` for fully-spent months
3. No month's last day has a `startingBalance` that differs from the previous day's `endingBalance`
