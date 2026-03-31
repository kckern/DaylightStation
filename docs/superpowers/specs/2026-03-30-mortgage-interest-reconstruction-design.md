# Mortgage Interest Reconstruction & Enhanced UI

**Date:** 2026-03-30
**Status:** Approved

## Problem

The bank doesn't itemize interest vs. principal on mortgage payments. Buxfer records payment amounts and syncs the current balance, but provides no intermediate month-end balances. This means:

- The system can't show how much of each payment is "rent" (interest) vs. equity (principal)
- The `startingBalance` calculation is naive: `currentBalance + totalPayments`, which inflates the apparent starting balance by cumulative interest
- The chart has discontinuities at the seam between past balance data and future projections
- The mortgage drawer is a raw JSON dump with no useful UX

## Solution

Reconstruct per-month interest from first principles using the known fixed rate (6.25%), actual payment history, and the current balance as a reconciliation anchor. Use this reconstructed data to power an enhanced chart with sawtooth visualization and a fully functional drawer with amortization tables, plan comparison, and cost-of-capital analysis.

## Part 1: Interest Reconstruction (Domain Layer)

### New Method: `MortgageCalculator.reconstructAmortization()`

**Signature:**
```js
reconstructAmortization({ mortgageStartValue, interestRate, startDate, transactions, currentBalance, asOfDate })
```

**Algorithm:**
1. Start at `mortgageStartValue` on `startDate`
2. For each month from start to `asOfDate`:
   - `interestAccrued = balance × (interestRate / 12)`
   - `balance += interestAccrued`
   - Sum all payment transactions in that month
   - `balance -= monthPayments`
   - `cumulativeInterest += interestAccrued`
3. Compare final reconstructed balance to `currentBalance` (anchor)
4. Compute drift. Distribute proportionally across all months by interest weight (months with higher interest absorb more correction)
5. Recompute cumulative interest after adjustment

**Per-month output:**
```js
{
  month: '2025-06',           // YYYY-MM (used as date key)
  effectiveRate: 0.0625,      // annual rate in effect this month
  openingBalance: 269875,     // before interest
  interestAccrued: 1406,      // computed + reconciliation adjustment
  payments: [4089, 1911, 8000], // actual payment amounts
  totalPaid: 14000,
  principalPaid: 12594,       // totalPaid - interestAccrued
  closingBalance: 257281,     // after everything
  cumulativeInterest: 18420,  // running total
  reconciliationAdj: -2.31,   // per-month drift correction (transparent)
}
```

**Anchor reconciliation:** The total drift between reconstructed and actual balance is spread proportionally across months by each month's share of total interest. This keeps individual months honest while guaranteeing the total reconciles to ground truth. Future anchor points (statement balances added to config) can subdivide the correction further.

### Integration with `calculateMortgageStatus()`

`calculateMortgageStatus()` calls `reconstructAmortization()` to produce enriched month data. This replaces the naive calculation where:
- `startingBalance = balance - sumOfTransactions` → now derived from reconstruction
- `totalInterestPaid = startingBalance - mortgageStartValue` → now summed from per-month interest
- `totalPrincipalPaid`, `monthlyRent`, `monthlyEquity` → all derived from reconstruction

The reconstructed amortization is included in the returned `MortgageStatus` object as a new `amortization` field alongside the existing `transactions` and `paymentPlans`.

## Part 2: Chart Enhancements

### Series 1: Balance Sawtooth (area)

Two data points per month create the sawtooth pattern:
- **Peak:** `(month-start, openingBalance + interestAccrued)` — balance after interest hits
- **Trough:** `(month-end, closingBalance)` — balance after payment applied

The teeth get smaller over time as the balance shrinks. Rendered as an area chart so the body of the loan is visible.

### Series 2: Cumulative Interest (overlaid area)

One point per month: `(month-end, cumulativeInterest)`. Grows monotonically. Rendered as a semi-transparent area on a **secondary Y-axis** so it doesn't compete with the balance scale. Shows the total cost of the loan growing over time.

### Series 3+: Future Projection Lines (existing, fixed)

Payment plan projections continue as lines extending from the present balance into the future. No sawtooth for future months — smooth projected balance decline per plan. Each plan line gets its own color and the **legend is enabled** (currently `legend: { enabled: false }`).

### Additional Chart Config

- **Dual Y-axis:** left for balance, right for cumulative interest
- **Legend enabled** with plan names from `plan.info.title`
- **Tooltip:** balance, interest this month, principal this month, cumulative interest
- **Today marker:** vertical plot line or band separating past (sawtooth) from future (projections)

### Summary Table Enhancements

Add to the existing summary row:
- Total Interest Paid (from reconstruction)
- Interest-to-Principal ratio (% of payments that were "rent")

## Part 3: Seam Fixes (Past/Future Discontinuity)

Four root causes of chart discontinuity at the present boundary:

### Fix 1: Past months with no transactions show as gaps

Current code looks for a transaction in each month and plots `null` if none found. With reconstruction, every month gets a computed balance regardless of whether a payment happened.

### Fix 2: Past and future use different balance semantics

Past data uses `runningBalance` (post-payment). Future projections use `startBalance` (pre-interest). At the seam this creates a jump. Fix: the last reconstructed month's `closingBalance` equals the current Buxfer balance (by anchor reconciliation), and the first future month's `startBalance` is that same value.

### Fix 3: Projection start date overlaps with past data

Currently projections start from `asOfDate` (today) regardless of when the last payment was. Fix: start projections from the month *after* the last reconstructed month, using its `closingBalance` as the starting principal.

### Fix 4: Plan names display as "Plan 1", "Plan 2"

Line 86 of `mortgage.jsx` references `plan.info.planName` which doesn't exist — the field is `plan.info.title`.

## Part 4: Mortgage Drawer

### Entry Points

- Click the past sawtooth area → Amortization tab, scrolled to that month
- Click a future projection line → Amortization tab with that plan's future months
- Click summary stats → Plan Comparison tab

Wire up `setDrawerContent` which is already passed to `BudgetMortgage` but currently unused.

### Tab 1: Amortization

Uses the existing `MortgageTable` component (already built at line 212 of `mortgage.jsx`), fed with reconstructed amortization data.

- Past months show actual reconstructed data (interest, real payments, adjusted balances)
- Future months show projected data from the selected payment plan
- Visual separator at the "today" boundary (bold line or highlighted row)
- Past rows get a subtle background tint to distinguish from projections
- **New column:** Cumulative Interest

The `MortgageTable` component already handles multiple payments per month with sub-rows and January year separators. Just needs the reconstructed data piped in.

### Tab 2: Plan Comparison

Table with one row per payment plan:

| Plan | Payoff Date | Total Paid | Total Interest | Interest Saved | Monthly Budget |
|------|------------|------------|----------------|----------------|----------------|
| Baseline | Mar 2049 | $580K | $180K | — | $4,089/mo |
| Double | Jun 2041 | $510K | $110K | $70K | $8,178/mo |
| Triple | Dec 2037 | $475K | $75K | $105K | $12,267/mo |
| Refinance | Jan 2044 | $520K | $120K | $60K | $4,089/mo |

- "Interest Saved" is relative to Baseline (the plan with the most total interest)
- Clicking a plan row switches to the Amortization tab showing that plan's future months

### Tab 3: Cost of Capital

Answers: "If I spend $X today instead of applying it to the mortgage, what does it actually cost me?"

**Inputs:**
- Amount field (default $1,000, user-editable)
- Base plan selector (which payoff plan to compare against)

**Calculation:**
1. Run selected plan projection as-is → `totalInterestA`, `payoffDateA`
2. Run same plan with starting balance increased by input amount → `totalInterestB`, `payoffDateB`
3. `additionalInterest = totalInterestB - totalInterestA`
4. `trueCost = amount + additionalInterest`
5. `costMultiplier = trueCost / amount`
6. `payoffDelay = payoffDateB - payoffDateA` in months

**Display — results card:**
```
$1,000 spent today costs you $1,076.12
───────────────────────────────────────
  Additional interest:    $76.12
  Cost multiplier:        1.076×
  Payoff delay:           +2 months
  Plan: Baseline (Mar 2049 → May 2049)
```

**Quick-reference table** showing common amounts across all plans:

| Amount | Baseline | Double | Triple | Refinance |
|--------|----------|--------|--------|-----------|
| $1,000 | +$76 (1.08×) | +$42 (1.04×) | +$28 (1.03×) | +$61 (1.06×) |
| $5,000 | +$382 | +$211 | +$140 | +$306 |
| $10,000 | +$764 | +$423 | +$281 | +$613 |
| $25,000 | +$1,912 | +$1,058 | +$703 | +$1,533 |
| $50,000 | +$3,825 | +$2,117 | +$1,407 | +$3,067 |

The multiplier shrinks with more aggressive plans — another way to visualize why extra payments matter.

**Implementation:** Reuses `MortgageCalculator.calculatePaymentPlans()` — call it twice with and without the extra principal. No new calculation logic needed.

## Files Modified

| File | Change |
|------|--------|
| `backend/src/2_domains/finance/services/MortgageCalculator.mjs` | Add `reconstructAmortization()` method |
| `backend/src/3_applications/finance/BudgetCompilationService.mjs` | Call reconstruction, include in compiled output |
| `frontend/src/modules/Finances/blocks/mortgage.jsx` | Sawtooth chart, cumulative interest series, seam fixes, drawer wiring, plan comparison tab, cost of capital tab |

## Approach

- **Approach A (selected):** Reconstruct interest in `MortgageCalculator` (domain layer). Clean separation, testable, chart just renders what it gets.
- Rejected: Frontend calculation (domain logic leak), hybrid (unnecessary complexity).

## Key Assumptions

- Interest rate is fixed at 6.25% for the entire loan life
- Interest compounds monthly: `balance × (annualRate / 12)`
- The Buxfer account balance is ground truth for reconciliation
- `mortgageStartValue` ($400,000) and `startDate` (2024-04-01) from config are accurate
