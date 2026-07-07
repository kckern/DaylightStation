# Finance App + Finance Domain — Full-Scale Audit

**Date:** 2026-07-06
**Scope:**
- `frontend/src/Apps/FinanceApp.jsx` (292 lines) and everything it renders: `frontend/src/modules/Finances/` (blocks.jsx, drawer.jsx, table.jsx, blocks/{monthly,shortterm,daytoday,mortgage}.jsx — ~2,800 lines)
- `backend/src/2_domains/finance/` (entities Budget/Account/Transaction/Mortgage, services BudgetService/MortgageService/TransactionClassifier/MortgageCalculator — ~1,700 lines)
- Consumers traced through `3_applications/finance/BudgetCompilationService.mjs`, `1_adapters/finance/BuxferAdapter.mjs`, `4_api/v1/routers/finance.mjs`, and the sibling `frontend/src/modules/Finance/` (singular) widget.

**Method:** full read of every in-scope file; grep-verified consumer tracing for every exported symbol; no runtime testing.

---

## Executive Summary

The finance stack works, and the parts that carry real weight (`TransactionClassifier`, `MortgageCalculator`, the compiled-YAML data flow) have tests and show real care (amortization invariant assertions, statement/bridge reconciliation). But the audit found four structural problems and a long tail of correctness and UX defects:

1. **Half the domain layer is dead scaffolding.** `BudgetService`, `MortgageService`, and the `Budget`/`Mortgage` entities have **zero consumers**. Worse, they contain a *third and fourth* independent amortization implementation that will silently disagree with the real one.
2. **The frontend has no error handling at all.** Every fetch assumes success; a failed `/api/v1/finance/data` leaves the app on "Loading..." forever; a failed refresh strands the spinner.
3. **SSoT violations at every altitude:** four currency formatters, two "group small items into Other" algorithms, two transaction-filtering paradigms, frontend re-implementation of backend aggregation, and a `modules/Finance` vs `modules/Finances` sibling-directory near-collision.
4. **A genuine Rules-of-Hooks violation** in the mortgage chart, plus a correctness bug in the Cost-of-Capital payoff-delay math and a dead never-red projection branch in the day-to-day chart.

Findings are numbered per section with severity: 🔴 defect / correctness, 🟠 antipattern / debt, 🟡 polish.

---

## Part 1 — Backend Domain (`2_domains/finance/`)

### 1.1 🔴 Dead scaffolding: two services and two entities have no consumers

Grep across the entire backend finds **no imports** of `BudgetService`, `MortgageService`, `Budget`, or `Mortgage` outside the domain's own `index.mjs`. They are not wired in `bootstrap.mjs`; their injected dependencies (`budgetStore.findAll/findById/save/delete`, `transactionSource.findByCategory`, `mortgageStore`) match no method on `YamlFinanceDatastore`. This is generic "budget app" scaffolding (envelope-style `Budget {amount, spent}` CRUD) that has nothing to do with the actual budget model (compiled `monthlyBudget`/`dayToDayBudget`/`shortTermBuckets` periods).

Only `TransactionClassifier` and `MortgageCalculator` are used (by `BudgetCompilationService.mjs:16`), plus `Transaction`/`Account` entities (by `BuxferAdapter.mjs:6-7`).

**Risk beyond clutter:** `index.mjs` exports all eight symbols with equal billing, so future work will naturally reach for `MortgageService.calculateAmortizationSchedule()` — which computes a *different* answer than the production path (see 1.2). Recommend deleting `BudgetService`, `MortgageService`, `Budget`, and `Mortgage` (or moving them to a `_speculative/` graveyard) and trimming `index.mjs` to what's real.

### 1.2 🔴 Three-and-a-half amortization implementations (SSoT)

| Implementation | Location | Status |
|---|---|---|
| `Mortgage.calculateMonthlyPayment()` + `getTotalInterest()` | `entities/Mortgage.mjs:33-95` | dead |
| `MortgageService.calculateAmortizationSchedule()` | `services/MortgageService.mjs:69-90` | dead |
| `MortgageCalculator.#calculateSinglePlan()` (projections) | `services/MortgageCalculator.mjs:744-865` | live |
| `MortgageCalculator.reconstructAmortization()` (historical) | `services/MortgageCalculator.mjs:655-738` | live |

The dead pair uses percent-form rates (`interestRate / 100 / 12`); the live pair uses decimal-form rates (`interestRate / 12`). Anyone who mixes them gets a 100× rate error. The frontend adds a fifth mini-implementation (`CostOfCapitalCalculator`, see 3.6). One rate convention, one amortization walker.

### 1.3 🟠 MortgageCalculator: two build paths with ~80% duplicated tails

`#buildFromStatements` (lines 183-523) and `#buildFromBuxferOnly` (lines 529-638) duplicate: projection-start derivation from the last amortization month, the "Historical Pace" synthetic plan construction (lines 480-494 ≈ 601-616, near-verbatim), payoff-range extraction, and the monthlyRent/monthlyEquity/totals block. The drift-reconciliation algorithm (spread by interest weight, then re-walk balances) is also implemented twice (lines 384-414 vs 710-735) with small divergences. Extract shared helpers: `#appendHistoricalPlan()`, `#reconcileDrift(records, anchor)`, `#projectionStartAfter(amortization)`.

One divergence is already visible: **`percentPaidOff` is a raw fraction in the statements path (line 498) but `#round`ed to 2 decimals in the Buxfer path (line 628)** — rounding a *fraction* to 2dp is 1-percentage-point resolution, and the two paths return different precisions for the same field.

### 1.4 🟠 Format-then-parse round-trip through display strings

`#calculateSinglePlan` formats the payoff month as `"March 2043"` (`#formatPayoffDate`, line 857/919), and `#findPayoffRange` (lines 871-891) then **parses that display string back** with `#parsePayoffDate` (lines 932-948) to compare dates. Internal data should stay `YYYY-MM` and be formatted only at the edge (the frontend already re-parses it with `moment(info.payoffDate, "MMMM YYYY")`, mortgage.jsx:120). Also: `#parsePayoffDate` builds a **local-time** `new Date(year, monthIndex, 1)` and `#monthsDiff` (lines 897-902) uses local `getFullYear/getMonth`, while every other date in the file is deliberately UTC (`setUTCDate`, `Date.UTC`, `getUTC*`) — the file is one timezone bug away from an off-by-one month at UTC boundaries, in a codebase that already had a UTC-timezone system audit (2026-03-02).

### 1.5 🟠 `MAX_ITERATIONS = 1000` masks negative amortization

`#calculateSinglePlan` (line 771-774): if a plan's payments don't cover accrued interest, the loop runs 1000 months (83 years) and then **returns a normal-looking result** whose `payoffDate` is month-1000 and whose totals are garbage. The guardrail should distinguish "converged" from "aborted": detect `amountPaid <= accruedInterest` with no extra payments scheduled, or throw/flag when the iteration cap is hit. The file already has the right instinct (`#assertAmortizationInvariants` fails loud); this path fails silent.

### 1.6 🟠 Bridge months with zero transactions accrue zero interest

`#buildFromStatements` line 345-346: `if (cycleTxns.length === 0) continue;` — a post-statement month with no payment produces **no amortization row and no interest accrual**. The missing interest is later absorbed invisibly by the drift-reconciliation against Buxfer's balance, spread across *other* months' `interestAccrued`. The end state reconciles, but per-month figures are wrong in exactly the month the user skipped a payment — the month they'd most want to inspect. Emit a row with `totalPaid: 0` and normal interest accrual instead.

### 1.7 🟠 Adapter vocabulary leaked into the domain layer

`MortgageCalculator` hard-codes `source: 'buxfer'` (lines 376, 441, 571) and its comments reason about "Buxfer's cached balance" and PDF statements. Given this repo's DDD-layer history (2026-02-17 abstraction-leakage audit), the domain service should speak in neutral terms (`source: 'ledger' | 'statement'`) with the adapter naming mapped at the boundary. Same class of issue: `TransactionClassifier.#isTransfer` (line 204) treats `type` matching `/investment/i` as a transfer and hard-codes the literal tag `'Transfer'`.

### 1.8 🟡 TransactionClassifier smaller issues

- **Hard-coded `'Shopping'` fallback label, twice** (lines 67, 78). A missing `label` in `budget.config.yml` silently files a category under "Shopping" — should be a validation error or a neutral `'Uncategorized'` constant.
- **Detection/labeling mismatch:** bucket detection uses *any-tag overlap* (`#arraysOverlap`, lines 129/135) but the label lookup uses only `mainTag` (`txnTags[0]`). A transaction whose second tag matches a monthly category lands in the monthly bucket with generic label `'Monthly'` instead of its category label.
- **Label self-mapping pollutes the tag namespace** (lines 70, 89: `acc[categoryLabel] = categoryLabel`) — labels and tags share one dict, so a config label colliding with an income/day tag changes classification order-of-operations invisibly.
- **`Object.keys(dict)` rebuilt per `classify()` call** (lines 128, 134) — O(tags) allocation per transaction across thousands of transactions per compile; hoist to constructor fields.
- **`groupByLabel` re-classifies** transactions its own docblock says are "already classified" (lines 172-186) — every grouped transaction is classified twice per compile.

### 1.9 🟡 Rounding accumulates without a residual sweep

Both reconciliation passes round the per-record adjustment (`#round(drift * weight)`) and never assign the leftover residual to a final record, so the walked closing balance can still miss the anchor by up to ±½¢ × records. `#assertAmortizationInvariants` checks ordering but not the anchor match. Cheap fix: after the loop, add `anchor - walkedClosing` to the last record.

---

## Part 2 — Frontend Architecture (`FinanceApp.jsx` + module structure)

### 2.1 🔴 Zero error handling on every network path

- `fetchBudget` (FinanceApp.jsx:22-26): no `response.ok` check, no catch. Backend down / 500 / non-JSON ⇒ unhandled rejection and the app **stays on "Loading..." forever** with no retry affordance.
- `ReloadButton` (78-91): no try/finally — if refresh or refetch throws, `reloading` sticks `true` and the spinner spins forever. A failed refresh is also indistinguishable from a successful one.
- `reloadBudget` (28-30) ignores the response entirely; `POST /refresh` returning 500 still proceeds to refetch-and-render stale data as if refreshed.
- Pair/unpair calls in drawer.jsx (101-126) catch and `console.error` only — the user gets no feedback, and on *success* the app does `window.location.reload()` (see 4.2).

Only `syncPayroll` checks `response.ok`. Minimum bar: a `fetchJson` helper with ok-check + one error banner state in `App`.

### 2.2 🔴 Reload leaves the mortgage block stale (SSoT)

`ReloadButton` line 85: `setBudgetData(newData.budgets)` — the fresh response contains `{budgets, mortgage}` but only budgets are applied; `mortgageData` is set exactly once on mount (line 52). After a refresh that ingests new mortgage transactions, the mortgage chart and stat grid keep rendering pre-refresh data until a full page reload. Either pass `setMortgageData` down or hold a single `{budgets, mortgage}` state object so they can't diverge.

### 2.3 🟠 JSX-in-state drawer contract, with two accepted shapes

`drawerContent` state holds rendered React elements, in **two shapes**: `{meta, jsx}` (Header, shortterm, monthly, mortgage) and bare JSX (blocks.jsx `BudgetHoldings`:39, `BudgetSpending`:98-103), reconciled by `drawerContent?.jsx || drawerContent` (FinanceApp.jsx:270). Consequences:

- Bare-JSX callers get an **untitled drawer** (`drawerContent?.meta?.title` → undefined).
- Elements stored in state capture data at click time; after `ReloadButton` refreshes `budgetData`, an open drawer keeps showing the stale snapshot.
- The pattern defeats React DevTools and memoization.

Store *descriptors* instead (`{type: 'transactions', title, transactions}` / `{type: 'mortgage', tab}`) and render them in one place.

### 2.4 🟠 Module → App circular import for `baseUrl`

`drawer.jsx:16` imports `baseUrl` from `../../Apps/FinanceApp.jsx`, while FinanceApp → blocks.jsx → drawer.jsx completes the cycle. It only works because `baseUrl` is accessed after module init. A shared `lib/` config (or the existing `DaylightAPI` in `lib/api.mjs`, which the sibling `modules/Finance/Finance.jsx:5` already uses) is the right home. Note also `baseUrl`'s `isLocalhost = /localhost/.test(window.location.href)` (line 17) matches *anywhere* in the URL, including a path or query string.

### 2.5 🟠 Dead files and dead state

- **`table.jsx` (220 lines):** the Mantine "TableSort" demo, verbatim, with 16 hard-coded fake people. Never imported. It doesn't even compile in isolation — `useState` is used (line 144) but never imported. `TableSort.module.css` exists only to serve it.
- **`Finances.jsx`: a 0-byte file.**
- **`budgetBlockDimensions`** (FinanceApp.jsx:239): initialized `{width: null, height: null}`, **never set by anything**, threaded as a prop into two blocks and spread into Highcharts config (`daytoday.jsx:272-273` passes `width: null, height: null`). Dead plumbing that actively confuses chart sizing.
- Dead Highcharts module registrations: **sankey** (blocks.jsx:5,10 — no sankey chart exists) and **treegraph + drilldown** (drawer.jsx:5-11 — drill is hand-rolled via `drillStack`, no treegraph anywhere). Each dead module is real bundle weight.
- `import Highcharts, { attr } from 'highcharts'` (drawer.jsx:3) — `attr` is an internal utility, imported and never used. Unused Mantine `Table` import in mortgage.jsx:3.

### 2.6 🟠 `modules/Finance` vs `modules/Finances`

Two sibling directories, singular and plural, both finance UI: `Finances/` is the dashboard, `Finance/` is a widget that reaches into `../Finances/blocks/daytoday` and `../Finances/blocks`. The near-identical names guarantee wrong-directory edits eventually. Merge or rename (`Finances/widgets/`), especially since the widget already depends on the dashboard's internals.

### 2.7 🟡 Miscellaneous

- Header's `Select` is fed `value={defaultValue}` (a computed fallback, line 169) rather than the controlled `activeBudgetKey` — display and state can diverge when `activeBudgetKey` is momentarily unset.
- `PayrollSyncContent` accepts `onClose` and never uses it — after a successful sync the drawer just sits there; success should close or offer close.
- Inline styles dominate every file despite a 434-line `FinanceApp.scss`; the styling SSoT is split roughly 50/50 between SCSS classes and per-element style objects.
- Effect in `BudgetDayToDay` (daytoday.jsx:246-253) depends on `nonFutureMonths`, a new array identity every render ⇒ effect runs every render; inside it, `nonFutureMonths.reverse()` **mutates** the derived array. Same mutation-in-render pattern in `MonthTabs` (`olderMonths.reverse()`, monthly.jsx:23) and prop mutation in `BudgetHoldings` (`transferTransactions?.transactions.sort(...)`, blocks.jsx:31 — sorts the state object in place).
- Leftover `console.log`s: blocks.jsx:97, monthly.jsx:226.
- moment.js (in maintenance mode since 2020) is imported in six of eight files; fine as a codebase-wide convention, but new chart math (`recordEndMs`, tick generation) keeps deepening the dependency.

---

## Part 3 — Chart Rendering

### 3.1 🔴 Rules-of-Hooks violation in `MortgageChart`

`mortgage.jsx:38-40`:

```jsx
export default function MortgageChart({ mortgage, zoomable = false }) {
  if (!mortgage?.amortization && !mortgage?.transactions) return null;
  const { ... } = useMemo(() => { ... }, [mortgage]);
```

An early return **before** `useMemo`. If `mortgage` transitions between null-ish and populated across renders of the same mounted component, React throws "Rendered more hooks than during the previous render." Move the guard below the hook (or into the memo). This is exactly the class of latent crash lint would catch — `react-hooks/rules-of-hooks` is either not running on this file or being ignored.

### 3.2 🔴 Waterfall y-axis formatter is dead config

`drawer.jsx:363-367` puts `formatter` directly on `yAxis` — Highcharts only honors `yAxis.labels.formatter`. The intended `formatAsCurrency` never runs; the axis renders raw unformatted numbers. Silent misconfiguration, present since the chart was written.

### 3.3 🔴 Day-to-day projection can never turn red

`daytoday.jsx:62` clamps every projected point to `Math.max(0, val)`, then line 74-78 sets `projectionColor = endingProjectedBalance < 0 ? '#780000' : '#2a9d8f'`. The clamped value can't be negative, so the over-budget red projection is unreachable — the pace line is **always green**, even when the burn rate blows through the budget. Either don't clamp the final point, or derive the color from the unclamped projection.

Related in the same chart:
- `yAxis.max = initialBudget` (line 166): any day whose balance exceeds the initial budget (mid-month credit) is **silently clipped**.
- Overspent days plot `Math.abs(endingBalance)` as a positive bar (line 39) — a $-120 day renders as a 120-tall bar distinguished only by color; the tooltip shows the true negative but the bar geometry lies.

### 3.4 🟠 Short-term chart geometry and labels

- **Time-marker plotLine unclamped** (shortterm.jsx:96-102): `value: (1 - currentTime) * 100` with `currentTime = currentWeek / weekCount`. Viewing a completed budget year (currentTime > 1) puts the marker at a negative axis value; a same-week budget (`weekCount === 0`) yields `Infinity`. Clamp to [0, 1].
- **Tooltip can report negative remaining** (line 120): `${100 - percentageSpent}% remaining` → "-37% remaining" for overspent buckets.
- **HTML-in-category labels** (lines 78-86): full `<div style=...>` blocks are pushed into `xAxis.categories` without `labels.useHTML: true`; Highcharts' SVG renderer only honors a small subset, so the styled flex layout depends on renderer leniency.
- **Asymmetric sort comparator** (lines 40-45): only `a.category === 'Unbudgeted'` is checked, never `b` — the comparator violates symmetry, so 'Unbudgeted' pinning depends on engine sort order.

### 3.5 🟠 Options objects rebuilt every render, remount-by-key

Every chart except `MortgageChart` rebuilds its full Highcharts options object (and re-derives all series data) on every parent render with no `useMemo` — the 2026-03-13 fitness chart-thrashing audit found this same pattern costly. `SpendingPieDrilldownChart` goes further with a deliberate "nuke" remount (`componentKey` bumped by an effect watching `transactions`, drawer.jsx:761-763) plus a second effect re-initializing state — two effects fighting to reset, where a single `key={budgetKey}` from the parent (already passed!) would do. `BudgetDayToDay` remounts its chart per tab switch via `key={activeMonth}` instead of letting Highcharts diff series.

### 3.6 🔴 Cost-of-Capital math overstates payoff delay

`mortgage.jsx:555`: once the simulated month index passes the plan's schedule, the fallback payment is `plan.months[plan.months.length - 1].amountPaid` — **the final month's payment, which the calculator caps to the remaining balance** (a partial payment, often a few hundred dollars). So the extra-spend simulation finishes the loan at a drip rate, inflating `delayMonths` (and `additionalInterest`, since interest keeps accruing over those phantom months). The fallback should be the *regular* payment (e.g., `plan.months[plan.months.length - 2]` or the plan's typical amountPaid).

Also here: `calculateCost` runs a 1000-iteration simulation per plan per render, and the Quick Reference table re-simulates 5 amounts × N plans **on every keystroke** in the amount field (the table doesn't even depend on `amount`). Memoize both.

### 3.7 🟡 Treemap and drilldown internals

- Treemap `rawData` build uses `acc.find(...)` inside a reduce (drawer.jsx:440-453) — O(n²) over transactions; use a Map.
- The "Group children <= 20% into Other" comment (line 461) contradicts the code, which keeps children until 80% cumulative.
- Treemap sums raw `amount` (line 445) — refunds/credits produce negative treemap values, which Highcharts silently drops, overstating category totals visually.
- Treemap tooltip `pointFormatter` computes `val` and returns only the name (lines 530-533) — dollar value dead code, so the treemap has *no* value affordance except the level-1 label.
- Waterfall category credit/debit builder sorts both accumulator arrays **inside every reduce iteration** (drawer.jsx:296-303).
- Waterfall tooltip divides by `incomeSum` (line 385): on intermediate-sum points `this.y` is null → "NaN% of income".
- `DrawerChart` returns `undefined` for unknown `cellKey`s (fine for React but an implicit contract); short-term and transfer drawers get no chart by omission rather than by decision.

---

## Part 4 — SSoT & DRY (cross-cutting)

### 4.1 🟠 Four currency formatters

| Formatter | Location | Behavior |
|---|---|---|
| `formatAsCurrency(value, abr)` | blocks.jsx:11-25 | `$1,234` / `$1.2K`, `$Ø` for non-finite |
| local `formatAsCurrency` | daytoday.jsx:8-11 | `$Ø` for falsy-but-not-zero, rounds |
| `formatCurrency` | drawer.jsx:573-575 | `$1K` above 1000, else `$123` |
| inline template | mortgage.jsx:166, 254 | `$123.4k` (lowercase k) |

Same app, four notions of "format a dollar amount" — visible to the user as inconsistent K/k, decimals, and null renderings across blocks. One `lib/format.js` export ends this. Same story for the color palette: `#c1121f`, `#759c82`, `#ff9800`, `#0077b6` etc. are string-duplicated across shortterm/waterfall/mortgage with only a dead coolors.co comment (blocks.jsx:7-8) as the "palette definition."

### 4.2 🟠 Two "small items → Other" algorithms

`DrawerTreeMapChart` (cumulative-80% threshold, drawer.jsx:462-501) and `buildDrillData` (2%-of-grand + top-10 + 90%-cumulative second level, drawer.jsx:577-755) implement the same concept with different magic numbers, and the second one leaks its internal `"Other2"` naming straight into user-facing breadcrumbs and tooltips. Extract one `groupSmall(items, opts)`.

### 4.3 🟠 Two filtering paradigms for the same interaction

The transaction drawer has an internal `transactionFilter` (tags/description/label/bucket) driven by chart clicks (waterfall/treemap). But `BudgetSpending.setTransactionFilter` (blocks.jsx:94-105) responds to the *same kind of click* by **replacing the entire drawer** with a new one. One click-to-filter model should exist; the replace-the-drawer variant also loses the chart context the user was drilling.

### 4.4 🟠 Frontend re-implements backend aggregation

`getPeriodData(null)` in monthly.jsx:134-228 hand-aggregates all months (income, categories, dailyBalances, ~90 lines of `+=`) to power the "Total" row's drawer — duplicating what `BudgetCompilationService` already computes per period, and inevitably drifting from it (e.g., its `dailyBalances` merge adds `endingBalance`s across months, which is not a meaningful balance). The compile step should emit the aggregate period once; the frontend should only render.

### 4.5 🟡 Sign-convention split

Backend `Transaction.getSignedAmount()` makes expenses negative; the compiled data and the whole frontend key off `expenseAmount > 0` meaning expense; drawer sorting maps the user-facing "Amount" column onto `expenseAmount` (drawer.jsx:60) so rows sort by a *different* field than the one displayed (income rows visibly out of order). Document one sign convention and derive the rest.

---

## Part 5 — UX & Usability

### 5.1 🟠 `prompt()` + `window.location.reload()` for pairing

Pairing an offsetting transaction uses a blocking `prompt()` for the description (drawer.jsx:99) and a **full page reload** on success — twice (pair :108, unpair :122). Reload throws away drawer context, scroll position, active budget/month selections, and re-downloads everything. A refetch + state update (or optimistic update) keeps the user where they were. The `⋯` row menu also has no outside-click handler (only toggle, drawer.jsx:206) — an open menu stays open while you scroll.

### 5.2 🟠 Crash vectors in the drawer

- Tag filter: `transaction.tagNames.includes(tag)` (drawer.jsx:74) throws if any transaction lacks `tagNames` while a tag filter is active (synthesized "Anticipated" rows from monthly.jsx have `tagNames`, but statement/bridge mortgage rows and edge Buxfer rows may not).
- `BudgetShortTerm` destructures `shortTermStatus.budget` etc. with no guard; a compile that omits the field takes the whole app down (no error boundary anywhere in the tree).
- "N Transactions ↗" link (drawer.jsx:248-253) joins **every** transaction id into one Buxfer URL — a year of day-to-day transactions produces a multi-thousand-character URL that Buxfer/browsers may truncate or reject. Cap it or link per-page.

### 5.3 🟠 Row-click = external navigation, unannounced

Clicking any transaction row anywhere opens buxfer.com in a new tab (drawer.jsx:84-87, blocks.jsx:55). There's no affordance (no link styling, no icon on the row, no title) distinguishing "this row will leave the app" from the adjacent rows/cells that open drawers or filter. Mixed with pair-mode (where the same click *selects*), the row-click gesture has three meanings distinguished only by cursor style.

### 5.4 🟡 Accessibility

Interactive elements are `<td onClick>`, `<h2 onClick>`, `<span onClick>` throughout (monthly table cells, block headers, status-badge spans, breadcrumbs) — none keyboard-reachable, no `role`/`tabIndex`/focus states. The emoji buttons (`🔄`, `💰`) have `title` but no `aria-label`. For a personal dashboard this is polish, not blocking; noting for completeness.

### 5.5 🟡 Loading & empty states

One global "Loading..." card; blocks render nothing meaningful for empty months/buckets (charts simply come out blank); the payroll drawer's success state ("Payroll synced successfully!") discards the response payload, which presumably says *what* synced. No skeletons expected at this scale, but a per-block empty message ("no transactions this period") would prevent blank-chart confusion.

---

## Part 6 — What's Good (keep)

- `#assertAmortizationInvariants` failing loud on duplicate/backwards month keys is exactly the right instinct — extend it (anchor reconciliation, negative-amortization detection) rather than adding silent fallbacks.
- The statement-vs-bridge design (ground truth from PDFs, Buxfer for the last mile, reconciliation anchored to cached balance, `asOfDate` carried per record for honest x-axis placement) is genuinely well thought through, and the comments explaining the billing-cycle labeling are the best documentation in either layer.
- `TransactionClassifier` and `MortgageCalculator` both have isolated test suites (`tests/isolated/domain/finance/services/`); the dead services/entities have none — which is itself evidence of which code is real.
- `buildDayToDayBudgetOptions` being exported and reused by the kiosk widget (`modules/Finance/Finance.jsx:117`) is the right instinct; it just needs to live in a chart-builders module rather than inside a block component file.

---

## Prioritized Recommendations

| # | Action | Addresses |
|---|---|---|
| 1 | Add `response.ok` + try/catch/finally to all fetches; one error banner; fix stuck spinner | 2.1 |
| 2 | Fix `ReloadButton` to update mortgage state (or unify `{budgets, mortgage}` state) | 2.2 |
| 3 | Move the null-guard below `useMemo` in `MortgageChart` | 3.1 |
| 4 | Delete dead domain scaffolding (`BudgetService`, `MortgageService`, `Budget`, `Mortgage` entities) + dead frontend files (`table.jsx`, `Finances.jsx`, `TableSort.module.css`, sankey/treegraph/drilldown imports, `budgetBlockDimensions`) | 1.1, 1.2, 2.5 |
| 5 | Fix Cost-of-Capital fallback payment (partial-final-payment bug); memoize its simulations | 3.6 |
| 6 | Fix waterfall `yAxis.labels.formatter`; unclamp/clamp short-term plotLine; un-deaden the red projection branch | 3.2–3.4 |
| 7 | One currency formatter + one palette module | 4.1 |
| 8 | Replace JSX-in-state drawer contract with descriptors; single drawer shape | 2.3 |
| 9 | Replace `prompt()`/`location.reload()` pairing flow with refetch | 5.1 |
| 10 | Extract `MortgageCalculator` shared tails (historical plan, drift reconciliation, projection start); keep `YYYY-MM` internal, format at the edge; unify percentPaidOff precision | 1.3, 1.4 |
| 11 | Emit zero-payment bridge months; detect negative amortization at the iteration cap | 1.5, 1.6 |
| 12 | Move `baseUrl` to `lib/`; merge/rename `modules/Finance` vs `modules/Finances` | 2.4, 2.6 |

---

*Directory pointers: frontend blocks `frontend/src/modules/Finances/`; domain `backend/src/2_domains/finance/`; compile orchestration `backend/src/3_applications/finance/BudgetCompilationService.mjs`; API `backend/src/4_api/v1/routers/finance.mjs`; domain tests `tests/isolated/domain/finance/services/`.*
