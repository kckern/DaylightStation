# Design: Day-to-Day Balance Fix + Overspend Visualization

**Date:** 2026-03-10
**Audit:** `docs/_wip/audits/2026-03-10-daily-balance-reset-on-zero-audit.md`

## Problem

Two bugs in `BudgetCompilationService.#calculateDailyBalances`:

1. **Falsy-zero bug**: `||` operator treats `endingBalance === 0` as falsy, resetting the next day's starting balance to the full monthly budget. Affects 10 of 36 months.
2. **Budget masking**: Past months set `budget = spending`, hiding overspending. Months where spending exceeded the configured $2,000 budget show no deficit.

## Backend Changes (`BudgetCompilationService.mjs`)

1. **Fix falsy-zero bug**: Replace `||` with `??` on lines 517 and 457
2. **Use configured budget for past months**: Line 450 always uses `config.dayToDay.amount` instead of `spending` for past months
3. **Daily balances emit chart-ready fields**: Each day entry gets:
   - `displayBalance`: `Math.abs(endingBalance)`
   - `overspent`: `true` when `endingBalance < 0`

   Raw `endingBalance` stays for tooltips/detail views.

## Frontend Changes (`daytoday.jsx`)

1. **Bar height**: Use `displayBalance` instead of `endingBalance`
2. **Bar color**: Red (`#c1121f`) when `overspent === true`, existing color logic otherwise
3. **Subtle band**: Lighter tint (`rgba(255, 0, 0, 0.05)`) for the overspent region
4. **Y-axis**: `min: 0` since bars are always positive
5. **Tooltip**: Shows real `endingBalance` (negative when overspent)
