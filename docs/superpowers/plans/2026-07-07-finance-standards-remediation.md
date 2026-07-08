# Finance Standards Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `frontend/src/Apps/FinanceApp.jsx` + `frontend/src/modules/Finances/` and `backend/src/2_domains/finance/` up to standard: fix every 🔴 finding and every 🟠 finding in `docs/_wip/audits/2026-07-06-finance-app-and-domain-fullscale-audit.md` except the large refactors explicitly listed as deferred below.

**Architecture:** Backend work is surgical edits to the two *live* domain services (`TransactionClassifier`, `MortgageCalculator`) plus deletion of dead scaffolding — no schema changes to compiled `finances.yml` except additive fields (`info.payoffMonth`, zero-payment bridge rows). Frontend work extracts pure logic (formatting, filtering, cost-of-capital, budget math) into testable `lib/` modules, replaces raw `fetch`+`baseUrl` with the codebase-standard `DaylightAPI`, and centralizes data loading in a `useFinanceData` hook so error/refresh state is real.

**Tech Stack:** Node ESM backend (vitest via `tests/isolated/`), React 18 + Mantine + Highcharts frontend (vitest + @testing-library/react, jsdom-style env), moment.js (existing convention — do not migrate).

## Global Constraints

- **Branch first:** the session starts on a detached `HEAD` in a worktree. Before Task 1: `git checkout -b finance-standards-remediation` (skip if already on it).
- **Test command (backend + frontend alike):** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`. Do NOT use `npm run test:isolated` (harness routes some specs to jest and crashes — see repo memory).
- **Frontend gate:** `npm --prefix frontend run build` must succeed after every frontend task. Do NOT use `npm --prefix frontend run lint` as a gate (`--max-warnings 0` fails on pre-existing code).
- **Never use bare `git stash`** (shared stash stack across worktrees — repo rule). Use WIP commits if needed.
- **Persisted-data compatibility:** compiled `finances.yml` written by older code may be re-read by newer frontend. Every frontend read of a NEW backend field must fall back to the old field (e.g. `info.payoffMonth || info.payoffDate`).
- **`DaylightAPI(path, data, method)`** (from `frontend/src/lib/api.mjs`): strips leading slashes from `path`; auto-converts GET→POST when `data` is non-empty; throws `Error('HTTP <status>: ...')` on non-OK. Vite dev proxy forwards `/api` to the backend, so `window.location.origin` works in dev and prod — the old `localhost:3112` `baseUrl` is obsolete.
- **Commit message style:** conventional prefix (`feat:`/`fix:`/`refactor:`/`test:`/`chore:`), and end every commit body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Deploy** only in Task 18, and only after the CLAUDE.local.md garage/video gates pass.

**Explicitly deferred (out of scope, documented for the record):** full drawer descriptor refactor (audit 2.3 — this plan only unifies the `{meta, jsx}` shape); `modules/Finance` ↔ `modules/Finances` directory merge (2.6); renaming persisted `source: 'buxfer'` vocabulary (1.7 — persisted-data churn); one shared "group small items into Other" algorithm (4.2 — Task 17 fixes only the user-visible `Other2` breadcrumb leak; unifying the two algorithms is a chart-logic refactor with no test seam yet); backend-emitted aggregate budget period (4.4 — cross-layer compile change; frontend aggregation stays for now); overspent days plotted as `Math.abs` bars (3.3 third bullet — needs a visual redesign, not a patch); moment→dayjs migration; accessibility pass (5.4); treemap O(n²) accumulation.

---

### Task 1: Delete dead domain scaffolding

**Files:**
- Delete: `backend/src/2_domains/finance/entities/Budget.mjs`
- Delete: `backend/src/2_domains/finance/entities/Mortgage.mjs`
- Delete: `backend/src/2_domains/finance/services/BudgetService.mjs`
- Delete: `backend/src/2_domains/finance/services/MortgageService.mjs`
- Delete: `tests/isolated/domain/finance/entities/Budget.test.mjs`
- Delete: `tests/isolated/domain/finance/entities/Mortgage.test.mjs`
- Delete: `tests/isolated/domain/finance/services/BudgetService.test.mjs`
- Delete: `tests/isolated/domain/finance/services/MortgageService.test.mjs`
- Modify: `backend/src/2_domains/finance/index.mjs`

**Interfaces:**
- Produces: `#domains/finance/index.mjs` exporting exactly `Transaction`, `Account`, `TransactionClassifier`, `MortgageCalculator`. All later backend tasks assume this trimmed surface.

- [ ] **Step 1: Verify nothing outside the domain imports the four dead symbols**

Run:
```bash
grep -rn "entities/Budget\.mjs\|entities/Mortgage\.mjs\|finance/services/BudgetService\|finance/services/MortgageService" backend/src cli scripts --include="*.mjs" | grep -v "2_domains/finance"
grep -rn "import {[^}]*\(BudgetService\|MortgageService\)[^}]*} from '#domains/finance" backend/src --include="*.mjs"
```
Expected: **no output** from both. (`CostBudgetService` in `3_applications/cost` is a different class — it does not import from `#domains/finance`.) If either grep matches, STOP and report — the audit's dead-code finding was wrong.

- [ ] **Step 2: Delete the files**

```bash
git rm backend/src/2_domains/finance/entities/Budget.mjs \
       backend/src/2_domains/finance/entities/Mortgage.mjs \
       backend/src/2_domains/finance/services/BudgetService.mjs \
       backend/src/2_domains/finance/services/MortgageService.mjs \
       tests/isolated/domain/finance/entities/Budget.test.mjs \
       tests/isolated/domain/finance/entities/Mortgage.test.mjs \
       tests/isolated/domain/finance/services/BudgetService.test.mjs \
       tests/isolated/domain/finance/services/MortgageService.test.mjs
```

- [ ] **Step 3: Rewrite the domain index**

Replace the full contents of `backend/src/2_domains/finance/index.mjs` with:

```js
/**
 * Finance Domain
 *
 * Only the classes actually consumed by the application layer
 * (BudgetCompilationService) and adapters (BuxferAdapter) live here.
 */

// Entities
export { Transaction } from './entities/Transaction.mjs';
export { Account } from './entities/Account.mjs';

// Services
export { TransactionClassifier } from './services/TransactionClassifier.mjs';
export { MortgageCalculator } from './services/MortgageCalculator.mjs';
```

- [ ] **Step 4: Run the surviving finance domain + flow tests**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/finance/ tests/isolated/flow/finance/
```
Expected: PASS — all remaining suites green (Account, Transaction, TransactionClassifier, MortgageCalculator, ports, and the flow suites including BudgetCompilationService).

- [ ] **Step 5: Commit**

```bash
git add -A backend/src/2_domains/finance tests/isolated/domain/finance
git commit -m "refactor(finance): delete dead domain scaffolding (BudgetService, MortgageService, Budget/Mortgage entities)

Zero consumers outside the domain index; their amortization math used a
percent-form rate convention that conflicts with the live calculator.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TransactionClassifier — label lookup, cached dicts, fallback label, groupByLabel reuse

**Files:**
- Modify: `backend/src/2_domains/finance/services/TransactionClassifier.mjs`
- Create: `tests/isolated/domain/finance/services/TransactionClassifier.remediation.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `classify(txn)` unchanged signature, but the returned `label` now comes from the *matching* tag (any position), not `txnTags[0]`. `groupByLabel(transactions, bucketType)` now honors pre-set `txn.label`/`txn.bucket` instead of re-classifying.

- [ ] **Step 1: Check the live config never relies on the 'Shopping' fallback**

Run:
```bash
grep -A2 "tags:" /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/common/finances/budget.config.yml | head -60
```
Then eyeball the `monthly:` and `shortTerm:` lists in that file and confirm **every item has a `label:`**. Expected: they all do (so changing the fallback is inert for prod data). If any item lacks a label, STOP and ask the user before changing the fallback.

- [ ] **Step 2: Write the failing tests**

Create `tests/isolated/domain/finance/services/TransactionClassifier.remediation.test.mjs`:

```js
import { TransactionClassifier } from '#domains/finance/services/TransactionClassifier.mjs';

describe('TransactionClassifier remediation', () => {
  test('labels a monthly transaction by its matching tag even when not the first tag', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ label: 'Utilities', tags: ['Electric'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Untracked', 'Electric'] });
    expect(result).toEqual({ label: 'Utilities', bucket: 'monthly' });
  });

  test('labels a short-term transaction by its matching tag even when not the first tag', () => {
    const classifier = new TransactionClassifier({
      shortTerm: [{ label: 'Vacation', tags: ['Travel'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Misc', 'Travel'] });
    expect(result).toEqual({ label: 'Vacation', bucket: 'shortTerm' });
  });

  test('missing monthly label falls back to Uncategorized, not Shopping', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ tags: ['Mystery'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Mystery'] });
    expect(result).toEqual({ label: 'Uncategorized', bucket: 'monthly' });
  });

  test('groupByLabel reuses pre-classified label/bucket instead of re-classifying', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ label: 'Utilities', tags: ['Electric'] }]
    });
    // Pre-classified txn whose label deliberately disagrees with its tags:
    // if groupByLabel re-classified, it would land under 'Utilities'.
    const txn = { type: 'expense', tagNames: ['Electric'], label: 'Overridden', bucket: 'monthly' };
    const grouped = classifier.groupByLabel([txn], 'monthly');
    expect(Object.keys(grouped)).toEqual(['Overridden']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/finance/services/TransactionClassifier.remediation.test.mjs
```
Expected: FAIL — first two tests get `label: 'Monthly'` / `'Short-term'`, third gets `'Shopping'`, fourth gets `'Utilities'`.

- [ ] **Step 4: Implement**

In `TransactionClassifier.mjs`:

(a) Add a module constant below the imports:

```js
const FALLBACK_LABEL = 'Uncategorized';
```

(b) In the constructor, replace both `const categoryLabel = label || 'Shopping';` lines (monthly dict at ~line 67, transfer dict at ~line 78) with:

```js
      const categoryLabel = label || FALLBACK_LABEL;
```

(c) In `classify()`, replace the monthly + short-term blocks (currently lines ~127-137):

```js
    // Check for monthly expenses — label from the matching tag, wherever it sits
    const monthlyTag = txnTags.find(tag => this.#monthlyTagDict[tag] !== undefined);
    if (monthlyTag) {
      return { label: this.#monthlyTagDict[monthlyTag], bucket: 'monthly' };
    }

    // Check for short-term buckets
    const shortTermTag = txnTags.find(tag => this.#shortTermTagDict[tag] !== undefined);
    if (shortTermTag) {
      return { label: this.#shortTermTagDict[shortTermTag], bucket: 'shortTerm' };
    }
```

(This also removes the per-call `Object.keys(...)` allocations.)

(d) In `groupByLabel()`, replace the loop body's first line:

```js
    for (const txn of transactions) {
      const { label, bucket } = (txn.label && txn.bucket) ? txn : this.classify(txn);
      if (bucket !== bucketType) continue;
```

- [ ] **Step 5: Run the new tests AND the existing suites (classifier + compilation flow)**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/services/TransactionClassifier.remediation.test.mjs \
  tests/isolated/domain/finance/services/TransactionClassifier.test.mjs \
  tests/isolated/flow/finance/BudgetCompilationService.test.mjs
```
Expected: PASS. If an existing test asserts the old `'Shopping'` fallback or mainTag-only labeling, update that assertion to the new behavior (the new behavior is the spec) and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/finance/services/TransactionClassifier.mjs tests/isolated/domain/finance/services/TransactionClassifier.remediation.test.mjs
git commit -m "fix(finance): classifier labels by matching tag, caches dicts, Uncategorized fallback, groupByLabel reuse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: MortgageCalculator — keep `YYYY-MM` internal, UTC monthsDiff

**Files:**
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs`
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx:118-121`
- Create: `tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs`

**Interfaces:**
- Produces: every plan's `info` gains `payoffMonth` (`'YYYY-MM'` string). `info.payoffDate` (`'March 2043'`) is kept for display. `#parsePayoffDate` is deleted. Later tasks and the frontend read `info.payoffMonth || info.payoffDate`.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs`:

```js
import { MortgageCalculator } from '#domains/finance/services/MortgageCalculator.mjs';

describe('MortgageCalculator remediation', () => {
  let calculator;
  beforeEach(() => { calculator = new MortgageCalculator(); });

  describe('payoffMonth', () => {
    test('info carries payoffMonth (YYYY-MM) matching the display payoffDate', () => {
      const [plan] = calculator.calculatePaymentPlans({
        balance: -10000,
        interestRate: 0,
        minimumPayment: 1000,
        paymentPlans: [{ id: 'p' }],
        startDate: new Date('2026-01-01')
      });
      // 10 months from Jan 2026 → last payment month is 2026-10 (October)
      expect(plan.info.payoffMonth).toBe('2026-10');
      expect(plan.info.payoffDate).toBe('October 2026');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs
```
Expected: FAIL — `payoffMonth` is `undefined`.

- [ ] **Step 3: Implement in MortgageCalculator.mjs**

(a) In `#calculateSinglePlan`, the `info` object (~line 849) — add `payoffMonth` right before `payoffDate`:

```js
        totalYears: (totalMonths / 12).toFixed(2),
        payoffMonth,
        payoffDate: this.#formatPayoffDate(payoffMonth),
```

(no other change to that block — `payoffMonth` is the existing local variable at ~line 845).

(b) Replace `#findPayoffRange` entirely (~lines 871-891):

```js
  /**
   * Find earliest and latest payoff months from payment plans.
   * Compares YYYY-MM strings directly (lexicographic == chronological).
   * @private
   */
  #findPayoffRange(paymentPlans) {
    let earliestPayoff = '';
    let latestPayoff = '';

    for (const { info } of paymentPlans) {
      const month = info.payoffMonth;
      if (!month) continue;
      if (!earliestPayoff || month < earliestPayoff) earliestPayoff = month;
      if (!latestPayoff || month > latestPayoff) latestPayoff = month;
    }

    return { earliestPayoff, latestPayoff };
  }
```

(c) Delete `#parsePayoffDate` entirely (~lines 928-948).

(d) Make `#monthsDiff` UTC-consistent (~lines 897-902):

```js
  #monthsDiff(start, end) {
    return Math.max(1,
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth())
    );
  }
```

- [ ] **Step 4: Update the frontend consumer with a stale-data fallback**

In `frontend/src/modules/Finances/blocks/mortgage.jsx`, replace **only the `planEndMonths` statement (lines 119-121)**. Line 118 (`const amortMonths = ...`) and line 122 (`const allMonths = [...amortMonths, ...planEndMonths]...`) MUST stay — deleting `amortMonths` crashes the chart at runtime and no build step catches it. The block afterwards reads:

```js
      const amortMonths = (mortgage.amortization || []).map(r => moment(r.month, "YYYY-MM"));
      const planEndMonths = mortgage.paymentPlans
        .map(({ info }) => moment(info.payoffMonth || info.payoffDate, ["YYYY-MM", "MMMM YYYY"]))
        .filter(m => m.isValid());
      const allMonths = [...amortMonths, ...planEndMonths].sort((a, b) => a.diff(b));
```

(The array-of-formats keeps pre-recompile `finances.yml` working.)

- [ ] **Step 5: Run new + existing calculator suites, and frontend build**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.test.mjs
npm --prefix frontend run build
```
Expected: all PASS; build succeeds. (`earliestPayoff`/`latestPayoff` format is unchanged — still `YYYY-MM` strings — so existing assertions hold.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/finance/services/MortgageCalculator.mjs frontend/src/modules/Finances/blocks/mortgage.jsx tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs
git commit -m "refactor(finance): payoff months stay YYYY-MM internally; delete display-string round-trip; UTC monthsDiff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: MortgageCalculator — extract shared projection tail, unify percentPaidOff precision

**Files:**
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs`
- Modify (tests): `tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs`

**Interfaces:**
- Produces: private helpers `#projectionStartAfter(amortization, asOfDate)` → `Date` and `#buildProjections({...})` → `PaymentPlanResult[]`. Task 6 adds a try/catch inside `#buildProjections`. `percentPaidOff` is now a raw (unrounded) fraction from **both** build paths.

- [ ] **Step 1: Add the failing precision test**

Append inside the top-level `describe` of `MortgageCalculator.remediation.test.mjs`:

```js
  describe('percentPaidOff precision', () => {
    test('Buxfer-only path returns an unrounded fraction', () => {
      const result = calculator.calculateMortgageStatus({
        config: {
          mortgageStartValue: 300000,
          accountId: 'm1',
          startDate: '2024-01-01',
          interestRate: 0.06,
          minimumPayment: 1798.65,
          paymentPlans: [{ id: 'min', title: 'Minimum' }]
        },
        balance: -287654.32,
        transactions: [
          { date: '2024-02-01', amount: 1798.65 },
          { date: '2024-03-01', amount: 1798.65 }
        ],
        asOfDate: new Date('2024-03-15')
      });
      // Must equal the exact ratio, not a 2-decimal rounding of it (1% resolution).
      expect(result.percentPaidOff).toBeCloseTo(result.totalPrincipalPaid / 300000, 10);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs
```
Expected: FAIL — the Buxfer path rounds `percentPaidOff` to 2dp, so the 10-digit closeness check misses (if the rounded value coincidentally matches to 10 digits, adjust `balance` in the test by a few dollars until it fails — the point is the ratio has >2 decimals).

- [ ] **Step 3: Implement the shared helpers**

Add to `MortgageCalculator.mjs` (near the other private helpers, e.g. above `#findPayoffRange`):

```js
  /**
   * First month AFTER the last amortization record — where projections begin
   * so the first plan month joins the last reconstructed balance seamlessly.
   * @private
   */
  #projectionStartAfter(amortization, asOfDate) {
    if (amortization.length > 0) {
      const [y, m] = amortization[amortization.length - 1].month.split('-').map(Number);
      return new Date(Date.UTC(y, m, 1)); // m is 1-indexed → this is the next month, 0-indexed
    }
    return new Date(asOfDate);
  }

  /**
   * Configured payment-plan projections plus the derived "Historical Pace"
   * plan. Shared tail of both build paths.
   * @private
   */
  #buildProjections({ amortization, projectionBalance, interestRate, minimumPayment, paymentPlans, asOfDate, totalPaid }) {
    const projectionStartDate = this.#projectionStartAfter(amortization, asOfDate);

    const plans = this.calculatePaymentPlans({
      balance: projectionBalance,
      interestRate,
      minimumPayment,
      paymentPlans,
      startDate: projectionStartDate
    });

    if (amortization.length > 0) {
      const avgMonthlyPayment = this.#round(totalPaid / amortization.length);
      plans.push(...this.calculatePaymentPlans({
        balance: projectionBalance,
        interestRate,
        minimumPayment: avgMonthlyPayment,
        paymentPlans: [{
          id: 'historical',
          title: 'Historical Pace',
          subtitle: `Avg ${Math.round(avgMonthlyPayment).toLocaleString()}/mo based on actuals`
        }],
        startDate: projectionStartDate
      }));
    }

    return plans;
  }
```

- [ ] **Step 4: Replace both duplicated call sites**

(a) In `#buildFromStatements`, delete the block from `// Start projections from the month after the last amortization month` (~line 457) through the `paymentPlansFilled.push(...historicalPlan);` closing brace (~line 494), and replace with:

```js
    const paymentPlansFilled = this.#buildProjections({
      amortization,
      projectionBalance: -currentBalance,
      interestRate,
      minimumPayment,
      paymentPlans,
      asOfDate,
      totalPaid
    });
```

(the `const projectionBalance = -currentBalance;` line is absorbed; delete it too).

(b) In `#buildFromBuxferOnly`, delete the equivalent block (~lines 575-616, from the `// Start projections...` comment through the historical-plan `push`), and replace with:

```js
    const projectionBalance = amortization.length > 0
      ? -amortization[amortization.length - 1].closingBalance
      : balance;

    const paymentPlansFilled = this.#buildProjections({
      amortization,
      projectionBalance,
      interestRate,
      minimumPayment,
      paymentPlans,
      asOfDate,
      totalPaid
    });
```

(c) In `#buildFromBuxferOnly`'s return object (~line 628), change:

```js
      percentPaidOff: this.#round(percentPaidOff),
```
to:
```js
      percentPaidOff,
```

- [ ] **Step 5: Run the full calculator + compilation suites**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.test.mjs \
  tests/isolated/flow/finance/BudgetCompilationService.test.mjs
```
Expected: PASS. If an existing test asserts a 2-decimal `percentPaidOff` from the Buxfer path, relax it to `toBeCloseTo(<same value>, 2)` and note in the commit.

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/finance/services/MortgageCalculator.mjs tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs
git commit -m "refactor(finance): extract shared projection tail from both mortgage build paths; unify percentPaidOff precision

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: MortgageCalculator — shared drift reconciliation with residual sweep

**Files:**
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs`
- Modify (tests): `tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs`

**Interfaces:**
- Produces: private `#reconcileDrift(records, drift, openingPrincipal, startingCumulativeInterest)` — mutates records in place, guarantees the walked closing balance lands **exactly** on the anchor.

- [ ] **Step 1: Add the failing anchor-exactness test**

Append inside the top-level `describe` of `MortgageCalculator.remediation.test.mjs`:

```js
  describe('drift reconciliation residual', () => {
    test('reconciled closing balance lands exactly on the anchor', () => {
      // Zero interest rate → equal 1/N weights → round(0.10 * 1/3) = 0.03 per
      // record = 0.09 distributed, 0.01 residual. Old code loses the cent.
      const records = calculator.reconstructAmortization({
        mortgageStartValue: 100000,
        interestRate: 0,
        startDate: '2026-01-01',
        transactions: [
          { date: '2026-01-15', amount: 1000 },
          { date: '2026-02-15', amount: 1000 },
          { date: '2026-03-15', amount: 1000 }
        ],
        currentBalance: -97000.10, // natural walk ends at 97000.00 → drift = +0.10
        asOfDate: '2026-03-31'
      });
      const last = records[records.length - 1];
      expect(Math.abs(last.closingBalance)).toBeCloseTo(97000.10, 2);
      // Adjustments must sum to the full drift
      const totalAdj = records.reduce((s, r) => s + r.reconciliationAdj, 0);
      expect(totalAdj).toBeCloseTo(0.10, 2);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs
```
Expected: FAIL — closing balance is 97000.09 (residual cent lost).

- [ ] **Step 3: Implement `#reconcileDrift`**

Add to `MortgageCalculator.mjs` (near the other private helpers):

```js
  /**
   * Distribute `drift` across records proportional to each record's interest
   * accrual (equal weights when total interest is 0), then re-walk balances
   * from `openingPrincipal`. The LAST record absorbs the rounding residual so
   * the walked closing balance lands exactly on the anchor.
   * Mutates records in place. No-op for empty input or sub-cent drift.
   * @private
   */
  #reconcileDrift(records, drift, openingPrincipal, startingCumulativeInterest = 0) {
    if (!records.length || Math.abs(drift) <= 0.01) return;

    const totalInterest = records.reduce((s, r) => s + r.interestAccrued, 0);
    let distributed = 0;
    records.forEach((record, i) => {
      const weight = totalInterest > 0 ? record.interestAccrued / totalInterest : 1 / records.length;
      let adj = this.#round(drift * weight);
      if (i === records.length - 1) adj = this.#round(drift - distributed); // residual sweep
      distributed = this.#round(distributed + adj);
      record.reconciliationAdj = adj;
      record.interestAccrued = this.#round(record.interestAccrued + adj);
      record.principalPaid = this.#round(record.totalPaid - record.interestAccrued);
    });

    let balance = openingPrincipal;
    let cumulativeInterest = startingCumulativeInterest;
    for (const record of records) {
      record.openingBalance = this.#round(balance);
      balance += record.interestAccrued;
      cumulativeInterest += record.interestAccrued;
      balance -= record.totalPaid;
      record.closingBalance = this.#round(balance);
      record.cumulativeInterest = this.#round(cumulativeInterest);
    }
  }
```

- [ ] **Step 4: Replace both inline reconciliation blocks**

(a) In `#buildFromStatements`, replace the `if (Math.abs(drift) > 0.01) { ... }` block (~lines 389-414, the weight loop AND the re-walk loop) with:

```js
          this.#reconcileDrift(bridgeRecords, drift, bridgeRecords[0].openingBalance, cumulativeInterest);
```

(keep the surrounding `drift` computation and the subsequent `totalInterestPaid += ...` lines unchanged).

(b) In `reconstructAmortization`, replace the `if (Math.abs(drift) > 0.01) { ... }` block (~lines 712-734, including the `cumulativeAdj` bookkeeping and re-walk) with:

```js
      this.#reconcileDrift(records, drift, mortgageStartValue, 0);
```

(keep the `const drift = ...` line above it).

- [ ] **Step 5: Run new + existing suites**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.test.mjs
```
Expected: PASS. Existing bridge/reconstruction tests use `toBeCloseTo` tolerances that the residual sweep only tightens.

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/finance/services/MortgageCalculator.mjs tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs
git commit -m "fix(finance): shared drift reconciliation with residual sweep — closing balance lands exactly on anchor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: MortgageCalculator — zero-payment bridge rows + non-amortizing plans fail loud

**Files:**
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs`
- Modify: `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs` (the `'prevents infinite loop with cap'` test)
- Modify (tests): `tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs`

**Interfaces:**
- Produces: `calculatePaymentPlans` **throws** `ValidationError` (`code: 'PLAN_DOES_NOT_AMORTIZE'`) when a plan cannot pay off within 1000 months. `#buildProjections` (from Task 4) swallows that throw for the *derived* Historical Pace plan only. Bridge amortization now emits rows for payment-free **completed** cycles (`payments: []`, `totalPaid: 0`) — but NOT for the still-in-flight cycle (would pre-accrue a full month of interest and shove the projection start into the future) and NOT for cycles already covered by the last statement.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` of `MortgageCalculator.remediation.test.mjs`:

```js
  describe('bridge months without payments', () => {
    test('emits an amortization row (interest accrues, nothing paid) for a skipped cycle', () => {
      const statementData = {
        statements: {
          '2026-04': {
            statementDate: '2026-03-06',
            principalBalance: 172374.64,
            transactions: [
              { date: '2026-03-01', principal: 2508.88, interest: 920.81, escrow: 866.17, total: 4295.86 }
            ]
          }
        }
      };
      const result = calculator.calculateMortgageStatus({
        config: {
          mortgageStartValue: 400000,
          accountId: 'm1',
          startDate: '2024-06-01',
          interestRate: 0.0625,
          minimumPayment: 4088.89,
          paymentPlans: [{ id: 'minimum', title: 'Minimum' }]
        },
        balance: -169000,
        // Only txn is in the 2026-06 cycle (date > 2026-04-06 cutoff+month) —
        // the 2026-05 cycle has no payments and previously vanished.
        transactions: [{ date: '2026-04-20', amount: 4295.86, description: 'Mortgage Payment' }],
        statementData,
        asOfDate: new Date('2026-05-05')
      });

      const skipped = result.amortization.find(r => r.month === '2026-05');
      expect(skipped).toBeDefined();
      expect(skipped.totalPaid).toBe(0);
      expect(skipped.payments).toEqual([]);
      expect(skipped.interestAccrued).toBeGreaterThan(0);
    });
  });

  describe('non-amortizing plans', () => {
    test('throws PLAN_DOES_NOT_AMORTIZE when payments never cover interest', () => {
      expect(() => calculator.calculatePaymentPlans({
        balance: -1000000,
        interestRate: 0.20,
        minimumPayment: 100,
        paymentPlans: [{ id: 'doomed', title: 'Doomed' }],
        startDate: new Date('2026-01-01')
      })).toThrow(/did not amortize/);
    });
  });
```

- [ ] **Step 2: Update the two pre-existing tests whose expectations encode the old behavior**

In `tests/isolated/domain/finance/services/MortgageCalculator.test.mjs`:

(a) Replace the `'prevents infinite loop with cap'` test (in the `'edge cases'` describe, ~lines 753-766):

```js
    test('throws instead of silently truncating a plan that can never amortize', () => {
      expect(() => calculator.calculatePaymentPlans({
        balance: -1000000,
        interestRate: 0.20, // monthly interest far exceeds the payment
        minimumPayment: 100,
        paymentPlans: [{ id: 'test' }],
        startDate: new Date('2026-01-01')
      })).toThrow(/did not amortize/);
    });
```

(b) In the `'projection starts after the last bridge cycle, not the last statement'` test (~lines 579-609), the fixture walks cycles `2026-05, 2026-06, 2026-07` (cutoff 6, asOf 2026-05-15): cycle `2026-05` (window 2026-03-06 → 2026-04-06) is a genuinely **completed, payment-free** cycle that the old code made vanish — the audit-1.6 bug this task fixes. Update the bridge-rows assertion:

```js
      const bridgeRows = result.amortization.filter(r => r.source === 'buxfer');
      // 2026-05 is a completed cycle with no payments — it now accrues
      // interest as its own row instead of vanishing (audit 1.6).
      expect(bridgeRows.map(r => r.month)).toEqual(['2026-05', '2026-06']);
      expect(bridgeRows[0].totalPaid).toBe(0);
```

The `firstProjMonth === '2026-07'` assertion in that test is unaffected (cycle `2026-07` is in-flight as of 2026-05-15, so it is still — correctly — not emitted). The neighboring `'reconciles drift between bridge calculation and Buxfer cached balance'` test needs **no change**: its empty walked cycle (`2026-02`, cycle-end 2026-01-05) ends exactly at `lastStatementDate`, so the new statement-coverage bound skips it, and `2026-04` is in-flight — the single `2026-03` row and its −400 adjustment survive.

- [ ] **Step 3: Run to verify the new tests fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.remediation.test.mjs \
  tests/isolated/domain/finance/services/MortgageCalculator.test.mjs
```
Expected: FAIL — skipped-cycle row missing; no throw on the doomed plan.

- [ ] **Step 4: Implement**

(a) In `#buildFromStatements`, replace the blanket skip inside the bridge cycle walk (~lines 344-346). Do **NOT** simply delete the `continue` — the walk enumerates cycles through `asOfCycle`, which is the *currently in-flight* billing cycle, and the first walked cycle can be one the last statement already covers; emitting either would double-count or pre-accrue interest. Replace:

```js
        for (const cycle of walkCycles) {
          const cycleTxns = bridgeByCycle[cycle] || [];
          if (cycleTxns.length === 0) continue;
```

with:

```js
        // Cycle 'YYYY-MM' (bill-month label) covers (prev cutoff, cycleEnd]
        // where cycleEnd = cutoffDay of the month BEFORE the label.
        const cycleEndOf = (cycle) => {
          const [cy, cm] = cycle.split('-').map(Number);
          let ey = cy, em = cm - 1;
          if (em < 1) { em = 12; ey--; }
          return `${ey}-${String(em).padStart(2, '0')}-${String(cutoffDay).padStart(2, '0')}`;
        };

        for (const cycle of walkCycles) {
          const cycleTxns = bridgeByCycle[cycle] || [];
          // A COMPLETED cycle with no payments still accrues interest — emit
          // it (2026-07-06 audit §1.6). But skip empty cycles that are
          // (a) still in flight as of asOfDate (a full month of interest
          // would be pre-accrued and the projection start pushed a month
          // into the future), or (b) already covered by the last statement.
          if (cycleTxns.length === 0) {
            const cycleEnd = cycleEndOf(cycle);
            if (cycleEnd > asOfIso || cycleEnd <= lastStatementDate) continue;
          }
```

(`cutoffDay`, `asOfIso`, and `lastStatementDate` are all already in scope at this point.) The rest of the loop already handles `cycleTxns = []` correctly (`cyclePaid` sums to 0, `payments` maps to `[]`). **Keep** the *other* `if (cycleTxns.length === 0) continue;` further down, inside the "Emit individual Buxfer txns" loop — that one is correct (no txns → no txn rows).

(b) In `#calculateSinglePlan`, after the `while` loop closes (~line 843, before the `payoffMonth` computation), add:

```js
    if (currentBalance > 0.01) {
      throw new ValidationError(
        `Payment plan "${plan.id || plan.title || 'unnamed'}" did not amortize within ${MAX_ITERATIONS} months — payments do not cover interest`,
        { code: 'PLAN_DOES_NOT_AMORTIZE', details: { planId: plan.id, remainingBalance: this.#round(currentBalance) } }
      );
    }
```

(`ValidationError` is already imported at the top of the file. Its constructor keeps only `{code, field, value, details}` — extra top-level keys are dropped, hence the `details` nesting.)

(c) In `#buildProjections` (added in Task 4), wrap **only** the Historical Pace push in try/catch:

```js
    if (amortization.length > 0) {
      const avgMonthlyPayment = this.#round(totalPaid / amortization.length);
      try {
        plans.push(...this.calculatePaymentPlans({
          balance: projectionBalance,
          interestRate,
          minimumPayment: avgMonthlyPayment,
          paymentPlans: [{
            id: 'historical',
            title: 'Historical Pace',
            subtitle: `Avg ${Math.round(avgMonthlyPayment).toLocaleString()}/mo based on actuals`
          }],
          startDate: projectionStartDate
        }));
      } catch (err) {
        // Historical Pace is derived, not configured — an interest-only payment
        // history must not fail the whole compile. Configured plans still throw.
        if (err?.details?.code !== 'PLAN_DOES_NOT_AMORTIZE' && err?.code !== 'PLAN_DOES_NOT_AMORTIZE') throw err;
      }
    }
```

(Check how `ValidationError` exposes its metadata — open `backend/src/2_domains/core/errors/index.mjs` and match the actual property (`.details.code`, `.code`, or similar); adjust the catch accordingly.)

- [ ] **Step 5: Run all backend finance suites**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/ tests/isolated/flow/finance/
```
Expected: PASS. If a compilation-flow fixture has a deliberately-underfunded configured plan, it will now throw — inspect the fixture: if the underfunding is accidental, fix the fixture's payment; if intentional, that test needs the new expectation. Report which in the commit body.

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/finance/services/MortgageCalculator.mjs tests/isolated/domain/finance/services/
git commit -m "fix(finance): bridge cycles without payments emit interest-accruing rows; non-amortizing plans throw instead of truncating

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend dead code removal

**Files:**
- Delete: `frontend/src/modules/Finances/table.jsx`
- Delete: `frontend/src/modules/Finances/TableSort.module.css`
- Delete: `frontend/src/modules/Finances/Finances.jsx`
- Modify: `frontend/src/modules/Finances/blocks.jsx` (imports)
- Modify: `frontend/src/modules/Finances/drawer.jsx` (imports)
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx` (imports + dead memo var)
- Modify: `frontend/src/Apps/FinanceApp.jsx`, `frontend/src/modules/Finances/blocks/shortterm.jsx`, `frontend/src/modules/Finances/blocks/daytoday.jsx` (`budgetBlockDimensions`)

**Interfaces:**
- Produces: `BudgetShortTerm({ setDrawerContent, budget })` and `BudgetDayToDay({ setDrawerContent, budget })` — the `budgetBlockDimensions` prop is GONE. Task 9's FinanceApp rewrite assumes these signatures.

- [ ] **Step 1: Verify the dead files really have no importers**

```bash
grep -rn "Finances/table\|TableSort\|Finances/Finances" frontend/src --include="*.jsx" --include="*.js" | grep -v "modules/Finances/table.jsx"
```
Expected: no output.

- [ ] **Step 2: Delete the files**

```bash
git rm frontend/src/modules/Finances/table.jsx frontend/src/modules/Finances/TableSort.module.css frontend/src/modules/Finances/Finances.jsx
```

- [ ] **Step 3: Remove dead Highcharts modules and unused imports**

(a) `blocks.jsx` — replace lines 1-10 (imports + SankeyModule init):

```jsx
import { Drawer, SpendingPieDrilldownChart } from "./drawer";
```

(`React`, `useEffect`, `useState`, `Highcharts`, `HighchartsReact`, `SankeyModule`, and `DrawerTreeMapChart` are all unused in this file — the automatic JSX runtime means no `React` import is needed. Delete the two coolors.co comment lines and the `SankeyModule(Highcharts);` line.)

(b) `drawer.jsx` — replace lines 1-18 with:

```jsx
import moment from "moment";
import React, { useState, useMemo, useEffect } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import HighchartsTreeMap from "highcharts/modules/treemap";
import HC_More from "highcharts/highcharts-more";

HighchartsTreeMap(Highcharts);
HC_More(Highcharts); // waterfall chart type lives in highcharts-more — keep

import { formatAsCurrency } from "./blocks";
import { baseUrl } from '../../Apps/FinanceApp.jsx';

import externalIcon from "../../assets/icons/external.svg";
```

(removes `attr`, treegraph, drilldown; `baseUrl` goes away in Task 9.)

(c) `blocks/mortgage.jsx` line 3 — drop `Table`:

```jsx
import { Tabs, Badge, Select, TextInput, Tooltip } from "@mantine/core";
```

(d) `blocks/mortgage.jsx` — delete the dead `lastAmortMonth` block inside the `useMemo` (lines 75-79, the `// 2. Determine last amortization month...` comment plus the `const lastAmortMonth = ...` statement). The *other* `lastAmortMonth` in `MortgageDrawer` is live — leave it.

- [ ] **Step 4: Remove the never-set `budgetBlockDimensions` plumbing**

(a) `FinanceApp.jsx`: delete line 239 (`const [budgetBlockDimensions, setBudgetBlockDimensions] = useState(...)`) and remove the `budgetBlockDimensions={budgetBlockDimensions}` prop from both `<BudgetShortTerm>` and `<BudgetDayToDay>` (lines 274-283).

(b) `blocks/shortterm.jsx` line 8: `export function BudgetShortTerm({ setDrawerContent, budget }) {`

(c) `blocks/daytoday.jsx` line 233: `export const BudgetDayToDay = ({ setDrawerContent, budget }) => {` and replace the `<HighchartsReact>` invocation (lines 264-276) with:

```jsx
        <HighchartsReact
          key={activeMonth}
          className="budget-burn-down-chart"
          highcharts={Highcharts}
          options={options}
        />
```

Also remove the now-unused `useEffect`/`useState` names if either became unused (`useState` is still used for `activeMonth`; `useEffect` is still used — leave them).

- [ ] **Step 5: Build**

```bash
npm --prefix frontend run build
```
Expected: build succeeds with no unresolved-import errors.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src
git commit -m "chore(finance): delete dead frontend files, dead Highcharts modules, and never-set budgetBlockDimensions plumbing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Canonical currency formatter + shared palette

**Files:**
- Create: `frontend/src/modules/Finances/lib/format.mjs`
- Create: `frontend/src/modules/Finances/lib/format.test.mjs`
- Modify: `frontend/src/modules/Finances/blocks.jsx`, `blocks/daytoday.jsx`, `drawer.jsx`, `blocks/shortterm.jsx`, `blocks/mortgage.jsx`

**Interfaces:**
- Produces:
  - `formatAsCurrency(value, abr?)` → `"$1,234"` / `"$1.2K"` (abr `'K'`) / `"$Ø"` for null/undefined/non-finite.
  - `formatCompactCurrency(value)` → `"$450"` under 1000, `"$5K"` at/above.
  - `PALETTE` — the only place Finance chart hexes live.
- `blocks.jsx` re-exports `formatAsCurrency`, so the existing `import { formatAsCurrency } from "../blocks"` sites in monthly/shortterm/mortgage/Finance.jsx keep working untouched.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/modules/Finances/lib/format.test.mjs`:

```js
// Locale note: assertions assume the default en-US ICU in Node/CI.
import { formatAsCurrency, formatCompactCurrency, PALETTE } from './format.mjs';

describe('formatAsCurrency', () => {
  test('whole dollars with thousands separators', () => {
    expect(formatAsCurrency(1234.56)).toBe('$1,235');
    expect(formatAsCurrency(0)).toBe('$0');
  });
  test('negative values keep the sign outside the $', () => {
    expect(formatAsCurrency(-1234)).toBe('-$1,234');
  });
  test('K abbreviation with one decimal', () => {
    expect(formatAsCurrency(1234, 'K')).toBe('$1.2K');
    expect(formatAsCurrency(-50, 'K')).toBe('-$0.1K');
  });
  test('null/undefined/NaN/Infinity render as $Ø', () => {
    expect(formatAsCurrency(null)).toBe('$Ø');
    expect(formatAsCurrency(undefined)).toBe('$Ø');
    expect(formatAsCurrency(NaN)).toBe('$Ø');
    expect(formatAsCurrency(Infinity)).toBe('$Ø');
  });
});

describe('formatCompactCurrency', () => {
  test('under $1000 shows whole dollars', () => {
    expect(formatCompactCurrency(450)).toBe('$450');
  });
  test('$1000+ shows whole K', () => {
    expect(formatCompactCurrency(5000)).toBe('$5K');
    expect(formatCompactCurrency(-5000)).toBe('-$5K');
  });
  test('non-finite renders as $Ø', () => {
    expect(formatCompactCurrency(null)).toBe('$Ø');
  });
});

describe('PALETTE', () => {
  test('exposes the shared chart hexes', () => {
    expect(PALETTE.over).toBe('#c1121f');
    expect(PALETTE.interest).toBe('#ff9800');
    expect(PALETTE.projectionOver).toBe('#780000');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/format.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lib**

Create `frontend/src/modules/Finances/lib/format.mjs`:

```js
/**
 * Canonical currency formatting + chart palette for all Finance UI.
 * This is the ONLY place these live — do not re-implement per file.
 */

export const formatAsCurrency = (value, abr) => {
  if (value == null || !isFinite(value)) return '$Ø';
  const isNegative = value < 0;
  const abs = Math.abs(value);
  if (abr === 'K') {
    const k = (abs / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${isNegative ? '-' : ''}$${k}K`;
  }
  const whole = abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${isNegative ? '-' : ''}$${whole}`;
};

/** Compact form for dense chart labels: "$450" under 1K, "$5K" above. */
export const formatCompactCurrency = (value) => {
  if (value == null || !isFinite(value)) return '$Ø';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(0)}K` : `${sign}$${Math.round(abs)}`;
};

/** Shared Finance chart palette. */
export const PALETTE = {
  spent: '#0077b6',
  spentDone: '#023e8a',
  over: '#c1121f',
  overDark: '#82000A',
  remaining: '#AAAAAA',
  gain: '#759c82',
  projectionOk: '#2a9d8f',
  projectionOver: '#780000',
  interest: '#ff9800',
  balance: '#4c8ffc',
  today: '#dc2626',
  income: '#304529',
  cashFlow: '#660000',
  dayToDay: '#432454',
};
```

- [ ] **Step 4: Run tests to verify pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/format.test.mjs
```
Expected: PASS (10 tests).

- [ ] **Step 5: Re-point every consumer**

(a) `blocks.jsx` — delete the local `formatAsCurrency` definition (lines 11-25) and add at the top:

```jsx
export { formatAsCurrency } from './lib/format.mjs';
```

(b) `blocks/daytoday.jsx` — delete the local `formatAsCurrency` (lines 8-11) and change the import block:

```jsx
import { formatAsCurrency, PALETTE } from '../lib/format.mjs';
```

Then substitute the literals in this file: `'#c1121f'` → `PALETTE.over`, `'#0077b6'` → `PALETTE.spent`, `'#780000'` → `PALETTE.projectionOver`, `'#2a9d8f'` → `PALETTE.projectionOk`, `'#777'` and weekend/other greys stay as-is.

(c) `drawer.jsx` — delete the local `formatCurrency` (the 3-line function near `MAX_ITEMS`) and change the blocks import line to:

```jsx
import { formatAsCurrency, formatCompactCurrency } from "./lib/format.mjs";
```

Replace every `formatCurrency(` call with `formatCompactCurrency(` — **8 call sites**: `buildDrillData` ×3 (~lines 690, 707, 735), crumbs init (~776), `buildCrumbLabel` (~785), tooltip `amt` (~845), and the two `valueFormatted:` fields in the column and pie series data (~934, 947). Verify with `grep -n "formatCurrency(" frontend/src/modules/Finances/drawer.jsx` — expected: no output when done. Substitute waterfall literals: `'#759c82'` → `PALETTE.gain` (2 sites: upColor + surplus), `'#c1121f'` → `PALETTE.over` (2 sites), `'#304529'` → `PALETTE.income`, `'#660000'` → `PALETTE.cashFlow`, `'#432454'` → `PALETTE.dayToDay` — and add `PALETTE` to the import.

(d) `blocks/shortterm.jsx` — change the blocks import to also pull the palette:

```jsx
import { formatAsCurrency } from "../blocks";
import { PALETTE } from "../lib/format.mjs";
```

Substitute: `'#c1121f'` → `PALETTE.over`, `'#023e8a'` → `PALETTE.spentDone`, `'#0077b6'` → `PALETTE.spent`, `'#82000A'` → `PALETTE.overDark`, `'#AAAAAA'` → `PALETTE.remaining`, `'#759c82'` (in the category-label HTML string) → `${PALETTE.gain}` via template interpolation.

(e) `blocks/mortgage.jsx` — add to imports:

```jsx
import { PALETTE, formatCompactCurrency } from "../lib/format.mjs";
```

Substitute: the data-label `formatter() { return \`<b>$${(this.y / 1000).toFixed(1)}k</b>\`; }` → `formatter() { return \`<b>${formatAsCurrency(this.y, 'K')}</b>\`; }`; the yAxis `labels.formatter` body → `return formatCompactCurrency(this.value);`; `"#ff9800"` → `PALETTE.interest` (3 sites: series color, Interest stat, trueCost highlight), `"#4c8ffc"` → `PALETTE.balance`, `'#dc2626'` → `PALETTE.today` (2 sites in the Today plotLine).

- [ ] **Step 6: Build + full frontend Finances tests**

```bash
npm --prefix frontend run build
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/
```
Expected: build succeeds; tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Finances frontend/src/Apps
git commit -m "refactor(finance): single canonical currency formatter + shared chart palette (was 4 formatters, scattered hexes)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `useFinanceData` hook + FinanceApp rewrite (error handling, unified state, DaylightAPI)

**Files:**
- Create: `frontend/src/modules/Finances/hooks/useFinanceData.mjs`
- Create: `frontend/src/modules/Finances/hooks/useFinanceData.test.jsx`
- Create: `frontend/src/modules/Finances/FinanceDataContext.jsx`
- Modify: `frontend/src/Apps/FinanceApp.jsx` (full rewrite below)
- Modify: `frontend/src/modules/Finances/drawer.jsx` (swap `fetch`+`baseUrl` → `DaylightAPI`)

**Interfaces:**
- Consumes: `DaylightAPI` from `frontend/src/lib/api.mjs` (see Global Constraints for its semantics).
- Produces:
  - `useFinanceData()` → `{ data: {budgets, mortgage} | null, error: Error | null, refreshing: boolean, load(): Promise, refresh(): Promise }`.
  - `FinanceDataContext` + `useFinanceReload()` → the `load` function (Task 16 consumes this in drawer.jsx).
  - `FinanceApp.jsx` no longer exports `baseUrl` — nothing may import it after this task.

- [ ] **Step 1: Write the failing hook tests**

Create `frontend/src/modules/Finances/hooks/useFinanceData.test.jsx`:

```jsx
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFinanceData } from './useFinanceData.mjs';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const SAMPLE = {
  budgets: { '2026-01-01': { budgetStart: '2026-01-01' } },
  mortgage: { balance: 100000 }
};

describe('useFinanceData', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  test('loads budgets and mortgage together on mount', async () => {
    DaylightAPI.mockResolvedValueOnce(SAMPLE);
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.data).toEqual(SAMPLE));
    expect(result.current.error).toBeNull();
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/finance/data');
  });

  test('surfaces a failed load as error state (no infinite Loading)', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('HTTP 500'));
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });

  test('refresh POSTs /refresh then reloads BOTH budgets and mortgage', async () => {
    DaylightAPI.mockResolvedValueOnce(SAMPLE); // mount load
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.data).toEqual(SAMPLE));

    const refreshed = {
      budgets: { '2026-01-01': { budgetStart: '2026-01-01', changed: true } },
      mortgage: { balance: 99000 }
    };
    DaylightAPI.mockResolvedValueOnce({ ok: true }); // POST refresh
    DaylightAPI.mockResolvedValueOnce(refreshed);    // reload
    await act(() => result.current.refresh());

    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/finance/refresh', {}, 'POST');
    expect(result.current.data).toEqual(refreshed); // mortgage updated too — audit 2.2
    expect(result.current.refreshing).toBe(false);
  });

  test('a failed refresh clears the refreshing flag and sets error', async () => {
    DaylightAPI.mockResolvedValueOnce(SAMPLE);
    const { result } = renderHook(() => useFinanceData());
    await waitFor(() => expect(result.current.data).toEqual(SAMPLE));

    DaylightAPI.mockRejectedValueOnce(new Error('refresh boom'));
    await act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/hooks/useFinanceData.test.jsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook and context**

Create `frontend/src/modules/Finances/hooks/useFinanceData.mjs`:

```js
import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * Single source of truth for the Finance dashboard's data lifecycle.
 * budgets + mortgage always load and refresh TOGETHER (a partial update
 * left the mortgage block stale — see 2026-07-06 finance audit §2.2).
 */
export function useFinanceData() {
  const [data, setData] = useState(null);       // { budgets, mortgage } | null
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { budgets, mortgage } = await DaylightAPI('api/v1/finance/data');
      setData({ budgets, mortgage });
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await DaylightAPI('api/v1/finance/refresh', {}, 'POST');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { data, error, refreshing, load, refresh };
}
```

Create `frontend/src/modules/Finances/FinanceDataContext.jsx`:

```jsx
import { createContext, useContext } from 'react';

/** Lets deeply-nested drawer content trigger a data reload without prop drilling. */
export const FinanceDataContext = createContext({ reload: async () => {} });
export const useFinanceReload = () => useContext(FinanceDataContext).reload;
```

- [ ] **Step 4: Run hook tests to verify pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/hooks/useFinanceData.test.jsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite FinanceApp.jsx**

Replace the full contents of `frontend/src/Apps/FinanceApp.jsx` with:

```jsx
import { useState, useMemo, Component } from 'react';
import { Button, MantineProvider, Select, TextInput, Drawer } from '@mantine/core';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { BudgetHoldings, BudgetSpending } from '../modules/Finances/blocks.jsx';
import { BudgetMortgage } from '../modules/Finances/blocks/mortgage.jsx';
import { BudgetCashFlow } from '../modules/Finances/blocks/monthly.jsx';
import { BudgetShortTerm } from '../modules/Finances/blocks/shortterm.jsx';
import { BudgetDayToDay } from '../modules/Finances/blocks/daytoday.jsx';
import { useFinanceData } from '../modules/Finances/hooks/useFinanceData.mjs';
import { FinanceDataContext } from '../modules/Finances/FinanceDataContext.jsx';
import { DaylightAPI } from '../lib/api.mjs';
import 'react-modern-drawer/dist/index.css';
import './FinanceApp.scss';
import '@mantine/core/styles.css';
import spinner from '../assets/icons/spinner.svg';
import moment from 'moment';
import { getChildLogger } from '../lib/logging/singleton.js';

const financeLogger = getChildLogger({ app: 'finance' });

const syncPayroll = (token) =>
  DaylightAPI('api/v1/finance/payroll/sync', token ? { token } : {}, 'POST');

/** A render crash in any block must not blank the whole dashboard (audit 5.2). */
class FinanceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    financeLogger.error('finance.render.crash', { error: String(error), stack: info?.componentStack });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ margin: '1rem', padding: '1rem', border: '1px solid #c00', borderRadius: 8, background: '#fee', color: '#600' }}>
          <strong>Finance dashboard crashed.</strong>
          <div style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>{String(this.state.error?.message || this.state.error)}</div>
          <Button onClick={() => window.location.reload()} variant="outline" color="red">Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useDocumentTitle('Finances');
  const finance = useFinanceData();
  const { data, error, load } = finance;

  return (
    <MantineProvider>
      {error && (
        <div style={{ margin: '1rem', padding: '1rem', border: '1px solid #c00', borderRadius: 8, background: '#fee', color: '#600' }}>
          <strong>Failed to load finance data.</strong>
          <div style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>{String(error.message || error)}</div>
          <Button onClick={load} variant="outline" color="red">Retry</Button>
        </div>
      )}
      {!error && !data && (
        <div style={{ padding: '1rem' }}>
          <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, backgroundColor: '#f8f9fa', padding: '1rem', textAlign: 'center', color: '#495057' }}>
            <strong>Loading...</strong>
          </div>
        </div>
      )}
      {data && (
        <FinanceErrorBoundary>
          <BudgetViewer budget={data.budgets} mortgage={data.mortgage} finance={finance} />
        </FinanceErrorBoundary>
      )}
    </MantineProvider>
  );
}

function ReloadButton({ finance }) {
  const { refresh, refreshing } = finance;
  return (
    <button
      style={{ float: 'right' }}
      className={refreshing ? 'reload reloading' : 'reload'}
      onClick={refresh}
      disabled={refreshing}
    >
      {refreshing ? <img src={spinner} alt="loading" /> : '🔄'}
    </button>
  );
}

function PayrollSyncContent() {
  const [token, setToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const response = await syncPayroll(token);
      setResult(response);
      financeLogger.info('finance.payroll.sync.success', { response });
    } catch (err) {
      setError(err.message);
      financeLogger.error('finance.payroll.sync.error', { error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ padding: '1rem' }}>
      <p style={{ marginBottom: '1rem', color: '#666' }}>
        Enter your payroll session token to sync paychecks. Leave empty to use stored credentials.
      </p>
      <TextInput
        label="Session Token"
        placeholder="Paste token here (optional)"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={syncing}
        style={{ marginBottom: '1rem' }}
      />
      <Button onClick={handleSync} loading={syncing} disabled={syncing} fullWidth>
        {syncing ? 'Syncing...' : 'Sync Payroll'}
      </Button>
      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fee', borderRadius: 4, color: '#c00' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#efe', borderRadius: 4, color: '#060' }}>
          Payroll synced successfully!
        </div>
      )}
    </div>
  );
}

function Header({ availableBudgetKeys = [], activeBudgetKey, setActiveBudgetKey, finance, setDrawerContent }) {
  const budgetOptions = useMemo(() => (
    availableBudgetKeys.map((key) => ({
      value: key,
      label: moment(key).format('YYYY') + ' Budget',
    }))
  ), [availableBudgetKeys]);

  const handleChange = (value) => {
    financeLogger.info('finance.budget.change', { value });
    if (value === activeBudgetKey) return;
    if (!availableBudgetKeys.includes(value)) {
      financeLogger.error('finance.budget.invalidKey', { value, availableKeys: availableBudgetKeys });
      return;
    }
    setActiveBudgetKey(value);
  };

  return (
    <header>
      <h1 style={{ display: 'flex', alignItems: 'center', padding: '0 1rem' }}>
        <div style={{ flex: 1 }} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Select
            data={budgetOptions}
            value={activeBudgetKey}
            onChange={handleChange}
            styles={{
              input: {
                fontSize: '1.5rem',
                fontWeight: 'bold',
                border: '1px solid #FFFFFF33',
                textAlign: 'center',
                backgroundColor: 'transparent',
                color: 'white',
                cursor: 'pointer',
              },
              rightSection: { pointerEvents: 'none' },
            }}
            rightSection={<span style={{ fontSize: '1rem' }}>▼</span>}
            clearable={false}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <ReloadButton finance={finance} />
          <button
            className="payroll-btn"
            onClick={() => setDrawerContent({
              meta: { title: 'Sync Payroll' },
              jsx: <PayrollSyncContent />
            })}
            title="Sync Payroll"
            style={{ fontSize: '1.5rem', cursor: 'pointer', background: 'none', border: 'none', marginLeft: '0.5rem' }}
          >
            💰
          </button>
        </div>
      </h1>
    </header>
  );
}

export function BudgetViewer({ budget, mortgage, finance }) {
  const [drawerContent, setDrawerContent] = useState(null);

  const [activeBudgetKey, setActiveBudgetKey] = useState(() => {
    const keys = Object.keys(budget);
    const today = moment().format('YYYY-MM-DD');
    const current = keys.find(k => {
      const b = budget[k];
      return today >= b.budgetStart && today <= b.budgetEnd;
    });
    return current || keys[0];
  });
  const activeBudget = budget[activeBudgetKey];
  const availableBudgetKeys = Object.keys(budget);

  return (
    <FinanceDataContext.Provider value={{ reload: finance.load }}>
      <div className="budget-viewer">
        <Header
          availableBudgetKeys={availableBudgetKeys}
          activeBudgetKey={activeBudgetKey}
          setActiveBudgetKey={setActiveBudgetKey}
          finance={finance}
          setDrawerContent={setDrawerContent}
        />
        <Drawer
          opened={!!drawerContent}
          onClose={() => setDrawerContent(null)}
          title={drawerContent?.meta?.title}
          size="90vw"
          position="right"
          padding="md"
          className="txn-drawer"
        >
          {drawerContent?.jsx || drawerContent}
        </Drawer>
        <div className="grid-container">
          <BudgetCashFlow setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetShortTerm setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetDayToDay setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetSpending setDrawerContent={setDrawerContent} budget={activeBudget} />
          <BudgetMortgage setDrawerContent={setDrawerContent} mortgage={mortgage} />
          <BudgetHoldings setDrawerContent={setDrawerContent} budget={activeBudget} />
        </div>
      </div>
    </FinanceDataContext.Provider>
  );
}
```

(Note: `{drawerContent?.jsx || drawerContent}` fallback is intentionally kept until Task 15 unifies the callers.)

- [ ] **Step 6: Swap drawer.jsx pair calls to DaylightAPI**

In `drawer.jsx`: remove `import { baseUrl } from '../../Apps/FinanceApp.jsx';` and add `import { DaylightAPI } from '../../lib/api.mjs';`. Replace the two fetch bodies:

```js
        await DaylightAPI('api/v1/finance/pairs', { debit, credit, desc }, 'POST');
```
and
```js
        await DaylightAPI('api/v1/finance/pairs', { debit: transaction.id, credit: transaction.pairedWith }, 'DELETE');
```

(keep the surrounding try/catch and `window.location.reload()` for now — Task 16 replaces them).

- [ ] **Step 7: Verify no `baseUrl` importers remain, build, test**

```bash
grep -rn "from '../../Apps/FinanceApp\|baseUrl" frontend/src/modules/Finances frontend/src/Apps/FinanceApp.jsx
npm --prefix frontend run build
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/
```
Expected: grep shows no remaining `baseUrl` references; build succeeds; tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/Apps/FinanceApp.jsx frontend/src/modules/Finances
git commit -m "feat(finance): useFinanceData hook — real error/retry states, unified budgets+mortgage refresh, DaylightAPI everywhere

Fixes: infinite Loading on fetch failure, stuck reload spinner, stale
mortgage after refresh, module→App circular baseUrl import.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: MortgageChart — fix Rules-of-Hooks violation

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx:37-40, 89, 118-119`

- [ ] **Step 1: Move the guard below the hook and null-safe the memo**

(a) Delete line 38 (`if (!mortgage?.amortization && !mortgage?.transactions) return null;`).

(b) Inside the `useMemo`, make every `mortgage.` access null-safe — change:
- `const amort = mortgage.amortization || [];` → `const amort = mortgage?.amortization || [];`
- `const futureSeries = mortgage.paymentPlans.map((plan) => {` → `const futureSeries = (mortgage?.paymentPlans || []).map((plan) => {`
- `const amortMonths = (mortgage.amortization || []).map(...)` → `const amortMonths = amort.map(r => moment(r.month, "YYYY-MM"));`
- `const planEndMonths = mortgage.paymentPlans` → `const planEndMonths = (mortgage?.paymentPlans || [])`

(c) The existing `if (!months.length) return null;` line (after the memo) is now the single early-exit — it already handles the empty case. Confirm it sits AFTER the `useMemo`.

(d) The stat destructure below (`const { totalPaid, ... } = mortgage;`) executes only when `months.length > 0`, which requires a populated mortgage — no change needed.

- [ ] **Step 2: Build to verify**

```bash
npm --prefix frontend run build
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Finances/blocks/mortgage.jsx
git commit -m "fix(finance): MortgageChart early return moved below useMemo (Rules of Hooks)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Cost-of-Capital — correct payoff-delay math + memoization

**Files:**
- Create: `frontend/src/modules/Finances/lib/costOfCapital.mjs`
- Create: `frontend/src/modules/Finances/lib/costOfCapital.test.mjs`
- Modify: `frontend/src/modules/Finances/blocks/mortgage.jsx` (`CostOfCapitalCalculator`)

**Interfaces:**
- Produces: `calculateCost({ balance, interestRate, extraAmount, plan })` → `{ additionalInterest, trueCost, multiplier, delayMonths }`. `plan` is a backend `PaymentPlanResult` (`{ info: { totalInterest, totalPayments }, months: [{ amountPaid }] }`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Finances/lib/costOfCapital.test.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/costOfCapital.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Finances/lib/costOfCapital.mjs`:

```js
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
```

- [ ] **Step 4: Run tests to verify pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/costOfCapital.test.mjs
```
Expected: PASS (3 tests).

- [ ] **Step 5: Rewire the component with memoization**

In `blocks/mortgage.jsx`, add the import:

```jsx
import { calculateCost } from "../lib/costOfCapital.mjs";
```

Replace `CostOfCapitalCalculator`'s local `calculateCost` definition (the ~30-line function) and the two render-time call patterns with memoized lookups. The component becomes:

```jsx
  function CostOfCapitalCalculator({ mortgage }) {
    const [amount, setAmount] = useState(1000);
    const commonAmounts = [1000, 5000, 10000, 25000, 50000];

    const costFor = (extraAmount, plan) => calculateCost({
      balance: mortgage.balance,
      interestRate: mortgage.interestRate,
      extraAmount,
      plan
    });

    // Recomputes only when the typed amount or the mortgage changes.
    const planCosts = useMemo(
      () => mortgage.paymentPlans.map((plan) => ({ plan, cost: costFor(amount, plan) })),
      [amount, mortgage]
    );

    // The quick-reference table does NOT depend on the typed amount —
    // previously it re-simulated 5 amounts × N plans on every keystroke.
    const quickReference = useMemo(
      () => commonAmounts.map((amt) => ({
        amt,
        costs: mortgage.paymentPlans.map((plan) => costFor(amt, plan))
      })),
      [mortgage]
    );

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

        {planCosts.map(({ plan, cost }) => (
          <div key={plan.info.id} style={{
            marginBottom: '1rem',
            padding: '1rem',
            border: '1px solid #333',
            borderRadius: '8px'
          }}>
            <div style={{ fontSize: '1.2em', marginBottom: '0.5rem' }}>
              <b>{formatAsCurrency(amount)}</b> spent today costs you{' '}
              <b style={{ color: PALETTE.interest }}>{formatAsCurrency(cost.trueCost)}</b>
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
        ))}

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
            {quickReference.map(({ amt, costs }) => (
              <tr key={amt}>
                <td>{formatAsCurrency(amt)}</td>
                {costs.map((cost, i) => (
                  <td key={mortgage.paymentPlans[i].info.id}>
                    +{formatAsCurrency(cost.additionalInterest)}{' '}
                    <span style={{ color: '#888' }}>({cost.multiplier.toFixed(2)}×)</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
```

(`useMemo` is already imported at the top of mortgage.jsx.)

- [ ] **Step 6: Build + commit**

```bash
npm --prefix frontend run build
git add frontend/src/modules/Finances
git commit -m "fix(finance): cost-of-capital uses regular payment past schedule end (payoff delay was drip-tail inflated); memoize simulations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Day-to-day chart — projection color, y-axis clipping, effect hygiene

**Files:**
- Modify: `frontend/src/modules/Finances/blocks/daytoday.jsx`
- Create: `frontend/src/modules/Finances/blocks/daytoday.test.mjs`

**Interfaces:**
- Consumes: `PALETTE` from Task 8.
- Produces: `buildDayToDayBudgetOptions(monthData, setDrawerContent, override)` gains `override.now` (any moment-parsable value) — used by tests for determinism; `modules/Finance/Finance.jsx` (which passes only `plotLineColor`) is unaffected.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/modules/Finances/blocks/daytoday.test.mjs`:

```js
import { buildDayToDayBudgetOptions } from './daytoday.jsx';
import { PALETTE } from '../lib/format.mjs';

// dailyBalances for 2026-03 with a fixed daily burn, viewed as-of day `throughDay`.
function monthData({ startingBalance, dailyBurn, throughDay }) {
  const dailyBalances = { '2026-03-start': { startingBalance } };
  for (let d = 1; d <= throughDay; d++) {
    const key = `2026-03-${String(d).padStart(2, '0')}`;
    dailyBalances[key] = { endingBalance: startingBalance - dailyBurn * d, overspent: false };
  }
  return { month: '2026-03', dailyBalances, transactions: [] };
}

describe('buildDayToDayBudgetOptions', () => {
  test('projection line is red when the burn rate overshoots the budget', () => {
    // $300 budget, $60/day for 5 days → $0 left, 26 days to go → deep negative.
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 60, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const projection = options.series.find(s => s.name === 'Projected Data');
    expect(projection.color).toBe(PALETTE.projectionOver);
  });

  test('projection line is green when the pace fits the budget', () => {
    // $300 budget, $5/day → month ends around $145. Comfortably positive.
    const options = buildDayToDayBudgetOptions(
      monthData({ startingBalance: 300, dailyBurn: 5, throughDay: 5 }),
      null,
      { now: '2026-03-05' }
    );
    const projection = options.series.find(s => s.name === 'Projected Data');
    expect(projection.color).toBe(PALETTE.projectionOk);
  });

  test('yAxis.max grows to fit balances above the initial budget (mid-month credits)', () => {
    const data = monthData({ startingBalance: 300, dailyBurn: 5, throughDay: 5 });
    data.dailyBalances['2026-03-03'].endingBalance = 350; // credit pushed above budget
    const options = buildDayToDayBudgetOptions(data, null, { now: '2026-03-05' });
    expect(options.yAxis.max).toBeGreaterThanOrEqual(350);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/blocks/daytoday.test.mjs
```
Expected: first test FAILS (color is always `PALETTE.projectionOk` — the dead-branch bug); third FAILS (`max` is 300). *(If the run fails on Highcharts/module imports rather than assertions, note it: daytoday.jsx imports Highcharts at module level — the jsdom env handles this elsewhere in the repo; if it genuinely can't, extract `buildDayToDayBudgetOptions` into `blocks/daytodayOptions.mjs` (no React/Highcharts imports needed by it) and have `daytoday.jsx` re-export it. Prefer the extraction if ANY import friction appears.)*

- [ ] **Step 3: Implement in `buildDayToDayBudgetOptions`**

(a) Determinism — top of the function, replace the moment-now derivations:

```js
  const now = override.now ? moment(override.now) : moment();
  const currentMonth = now.format('YYYY-MM');
  const daysInMonth = moment(inferredMonth).daysInMonth();
  const isCurrentMonth = inferredMonth === currentMonth;
  const today = now.date() - 1; // 0-based index
```

(the `inferredMonth` line stays where it is; just make sure `currentMonth` and `today` come from `now`).

(b) Projection color from the *unclamped* endpoint — replace the `endingProjectedBalance` + `projectionColor` block (lines ~74-78):

```js
  // Color reflects where the pace ACTUALLY lands, not the 0-clamped plot value —
  // Math.max(0, …) on plotted points made the "over budget" red unreachable.
  const endingProjectedUnclamped = isCurrentMonth && today < daysInMonth && actualData[today] && today >= 0
    ? actualData[today].y - (daysInMonth - today) * averageDailyBurn
    : 0;
  const projectionColor = endingProjectedUnclamped < 0 ? PALETTE.projectionOver : PALETTE.projectionOk;
```

(c) y-axis clipping — in the `yAxis` config, replace `max: initialBudget`:

```js
      max: Math.max(initialBudget, ...actualData.map(d => d.y || 0)),
```

(d) Effect hygiene in `BudgetDayToDay` — replace the `useEffect` (lines ~246-253):

```jsx
  useEffect(() => {
    if (budget.dayToDayBudget[activeMonth] !== undefined) return;
    const available = Object.keys(budget.dayToDayBudget).filter((m) => m <= currentMonth).sort();
    setActiveMonth(available[available.length - 1] ?? Object.keys(budget.dayToDayBudget)[0]);
  }, [activeMonth, budget.dayToDayBudget, currentMonth]);
```

(no more mutating `.reverse()` on a shared derived array, and every dependency is stable).

- [ ] **Step 4: Run tests to verify pass, build**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/blocks/daytoday.test.mjs
npm --prefix frontend run build
```
Expected: PASS (3 tests); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Finances/blocks/daytoday.jsx frontend/src/modules/Finances/blocks/daytoday.test.mjs
git commit -m "fix(finance): day-to-day projection can actually turn red; y-axis fits credit spikes; effect stops mutating derived arrays

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Short-term chart — clamped time marker, tooltip, comparator

**Files:**
- Create: `frontend/src/modules/Finances/lib/budgetMath.mjs`
- Create: `frontend/src/modules/Finances/lib/budgetMath.test.mjs`
- Modify: `frontend/src/modules/Finances/blocks/shortterm.jsx`

**Interfaces:**
- Produces: `budgetProgress(budgetStart, budgetEnd, now?)` → `{ weekCount, currentWeek, weeksLeft, progress }` with `progress` clamped to `[0, 1]` and `weeksLeft >= 0`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/modules/Finances/lib/budgetMath.test.mjs`:

```js
import { budgetProgress } from './budgetMath.mjs';

describe('budgetProgress', () => {
  test('mid-budget progress is fractional', () => {
    const p = budgetProgress('2026-01-01', '2026-12-31', '2026-07-01');
    expect(p.progress).toBeGreaterThan(0.4);
    expect(p.progress).toBeLessThan(0.6);
    expect(p.weeksLeft).toBeGreaterThan(0);
  });
  test('after the budget ends, progress clamps to 1 and weeksLeft to 0', () => {
    const p = budgetProgress('2024-01-01', '2024-12-31', '2026-07-01');
    expect(p.progress).toBe(1);
    expect(p.weeksLeft).toBe(0);
  });
  test('before the budget starts, progress clamps to 0', () => {
    const p = budgetProgress('2027-01-01', '2027-12-31', '2026-07-01');
    expect(p.progress).toBe(0);
  });
  test('degenerate zero-length budget does not divide by zero', () => {
    const p = budgetProgress('2026-07-01', '2026-07-01', '2026-07-01');
    expect(Number.isFinite(p.progress)).toBe(true);
    expect(p.progress).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/budgetMath.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Finances/lib/budgetMath.mjs`:

```js
import moment from 'moment';

/**
 * How far through a budget period we are, in weeks.
 * `progress` is clamped to [0, 1] so chart markers never render off-axis
 * (viewing a completed budget previously produced a negative plot position).
 */
export function budgetProgress(budgetStart, budgetEnd, now = undefined) {
  const weekCount = moment(budgetEnd).diff(moment(budgetStart), 'weeks');
  if (weekCount <= 0) return { weekCount, currentWeek: 0, weeksLeft: 0, progress: 1 };
  const currentWeek = moment(now).diff(moment(budgetStart), 'weeks');
  const progress = Math.min(1, Math.max(0, currentWeek / weekCount));
  return { weekCount, currentWeek, weeksLeft: Math.max(0, weekCount - currentWeek), progress };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/budgetMath.test.mjs
```
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into shortterm.jsx**

(a) Add import and replace lines 14-17:

```jsx
import { budgetProgress } from "../lib/budgetMath.mjs";
...
    const { weeksLeft, progress } = budgetProgress(budgetStart, budgetEnd);
```

(delete the old `weekCount`/`currentWeek`/`weeksLeft`/`currentTime` lines.)

(b) In the yAxis `plotLines`, replace `value: (1 - currentTime) * 100,` with:

```js
                value: (1 - progress) * 100,
```

(c) In the tooltip formatter, replace the remaining-percent line:

```js
                return `<b>${item.category}</b><br/>
                        ${count} transactions<br/>
                        ${Math.max(0, 100 - (percentageSpent || 0))}% remaining<br/>
                        $${rateRemaining}/week`;
```

(d) Fix the asymmetric comparator (lines 40-45):

```js
    }).sort((a, b) => {
        if (a.category === 'Unbudgeted') return 1;
        if (b.category === 'Unbudgeted') return -1;
        return b.extendedBudget - a.extendedBudget;
    });
```

(e) The category labels are HTML strings (`<div style=...>` blocks) pushed into `xAxis.categories`, but the axis renders with the SVG renderer, which honors only a small tag subset (audit 3.4). Tell Highcharts to render them as HTML — in the `xAxis` config:

```js
        xAxis: {
            categories: processedData.map(item => `...unchanged template...`),
            labels: { useHTML: true },
            reversed: true
        },
```

(only the `labels: { useHTML: true },` line is new; the categories template is untouched).

- [ ] **Step 6: Build + commit**

```bash
npm --prefix frontend run build
git add frontend/src/modules/Finances
git commit -m "fix(finance): short-term time marker clamps to the axis; no negative %-remaining; symmetric Unbudgeted sort; HTML axis labels render as HTML

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Waterfall chart — live y-axis labels, NaN-free tooltip

**Files:**
- Modify: `frontend/src/modules/Finances/drawer.jsx` (`DrawerWaterFallChart` options)

- [ ] **Step 1: Fix the dead yAxis formatter**

In `DrawerWaterFallChart`'s options, the `yAxis` block currently has `formatter` directly on `yAxis` (dead config — Highcharts only reads `labels.formatter`). Replace the `yAxis` block:

```js
    yAxis: {
        labels: {
            formatter: function () {
                return formatAsCurrency(Math.abs(this.value));
            }
        },
        title: { text: '' },
        min: Math.min(0, surplusValue),
        max: maxValue,
        plotLines: [{
            value: 0,
            color: 'black',
            width: 3,
            zIndex: 4
        }],
        plotBands: [{
            from: Math.min(0, surplusValue),
            to: 0,
            color: 'rgba(255, 100, 0, 0.1)'
        }]
    },
```

- [ ] **Step 2: Guard the tooltip against null intermediate sums**

Replace the tooltip formatter:

```js
    tooltip: {
        formatter: function () {
            const pctLine = (this.y != null && incomeSum)
                ? `<br/>${(Math.abs(this.y) / incomeSum * 100).toFixed(0)}% of income`
                : '';
            return `<b>${this.point.name}</b><br/>${formatAsCurrency(this.y)}${pctLine}`;
        },
    },
```

- [ ] **Step 3: Build + commit**

```bash
npm --prefix frontend run build
git add frontend/src/modules/Finances/drawer.jsx
git commit -m "fix(finance): waterfall y-axis labels actually format as currency; tooltip no longer prints NaN% on sum bars

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Transaction filter extraction + drawer hardening + single drawer shape

**Files:**
- Create: `frontend/src/modules/Finances/lib/transactionFilter.mjs`
- Create: `frontend/src/modules/Finances/lib/transactionFilter.test.mjs`
- Modify: `frontend/src/modules/Finances/drawer.jsx`
- Modify: `frontend/src/modules/Finances/blocks.jsx`
- Modify: `frontend/src/modules/Finances/blocks/shortterm.jsx`
- Modify: `frontend/src/Apps/FinanceApp.jsx` (remove the drawer shape fallback)

**Interfaces:**
- Produces: `matchesTransactionFilter(transaction, filter)` → boolean. Drawer-content contract is now **exclusively** `{ meta: { title }, jsx }` — the `|| drawerContent` fallback is removed.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/modules/Finances/lib/transactionFilter.test.mjs`:

```js
import { matchesTransactionFilter } from './transactionFilter.mjs';

describe('matchesTransactionFilter', () => {
  const txn = { description: 'Costco run', tagNames: ['Groceries'], label: 'Day-to-Day', bucket: 'day' };

  test('empty filter matches everything', () => {
    expect(matchesTransactionFilter(txn, {})).toBe(true);
    expect(matchesTransactionFilter(txn, undefined)).toBe(true);
  });
  test('matches by tag / description / label / bucket', () => {
    expect(matchesTransactionFilter(txn, { tags: ['Groceries'] })).toBe(true);
    expect(matchesTransactionFilter(txn, { tags: ['Fuel'] })).toBe(false);
    expect(matchesTransactionFilter(txn, { description: 'Costco' })).toBe(true);
    expect(matchesTransactionFilter(txn, { label: 'Day-to-Day' })).toBe(true);
    expect(matchesTransactionFilter(txn, { bucket: 'monthly' })).toBe(false);
  });
  test('does not crash on transactions missing tagNames or description', () => {
    expect(matchesTransactionFilter({}, { tags: ['Groceries'] })).toBe(false);
    expect(matchesTransactionFilter({}, { description: 'x' })).toBe(false);
    expect(matchesTransactionFilter({}, {})).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/transactionFilter.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Finances/lib/transactionFilter.mjs`:

```js
/**
 * Drawer transaction filtering. Null-safe: statement/bridge mortgage rows and
 * synthesized "Anticipated" rows may lack tagNames or description.
 */
export function matchesTransactionFilter(transaction, filter = {}) {
  const { tags, description, label, bucket } = filter || {};
  if (tags && !tags.some((tag) => (transaction.tagNames || []).includes(tag))) return false;
  if (description && !(transaction.description || '').includes(description)) return false;
  if (label && transaction.label !== label) return false;
  if (bucket && transaction.bucket !== bucket) return false;
  return true;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/lib/transactionFilter.test.mjs
```
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into drawer.jsx + harden**

(a) Import it: `import { matchesTransactionFilter } from './lib/transactionFilter.mjs';`

(b) Replace the inline `.filter(transaction => { ... })` block (the ~9 lines after the sort) with:

```js
    .filter((transaction) => matchesTransactionFilter(transaction, transactionFilter));
```

(c) Cap the Buxfer bulk link in `DrawerSummary` — replace the `<a ...>` href construction:

```jsx
function DrawerSummary({ sortedTransactions, summary }) {
  const MAX_LINKED_TIDS = 100; // Buxfer/browser URL length limit
  const linkedIds = sortedTransactions.map((tx) => tx.id).filter(Boolean).slice(0, MAX_LINKED_TIDS);

  return (
    <div className="budget-drawer-summary">
      {sortedTransactions.length > 0 && (
        <span>
          {sortedTransactions.length} Transactions{" "}
          {linkedIds.length > 0 && (
            <a
              target="_blank"
              title={linkedIds.length < sortedTransactions.length ? `Opens first ${MAX_LINKED_TIDS} in Buxfer` : 'Open in Buxfer'}
              href={`https://www.buxfer.com/transactions?tids=${linkedIds.join(",")}`}
            >
              <img
                src={externalIcon}
                alt="external link"
                style={{ width: "1em", height: "1em", marginBottom: "-0.2em" }}
              />
            </a>
          )}
        </span>
      )}
      {summary.spent > 0 && <span>Spent: {formatAsCurrency(summary.spent)}</span>}
      {summary.gained > 0 && <span>Credits: {formatAsCurrency(summary.gained)}</span>}
      {summary.spent > 0 && summary.gained > 0 && summary.netspend !== 0 && (
        <span>
          Net {summary.netspend < 0 ? "Gain" : "Spend"}:{" "}
          {formatAsCurrency(Math.abs(summary.netspend))}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Unify the drawer-content shape**

(a) `blocks.jsx` `BudgetHoldings` — the `<h2 onClick=...>`:

```jsx
      <h2 onClick={() => setDrawerContent({ meta: { title: 'Transfers' }, jsx: Transfers })}>Transfers</h2>
```

(b) `blocks.jsx` `BudgetSpending.setTransactionFilter`:

```jsx
    const setTransactionFilter = (filterString) => {
      const txns = allTransactionsFromAllMonths.filter((txn) => txn.tagNames?.includes(filterString));
      setDrawerContent({
        meta: { title: `Spending: ${filterString}` },
        jsx: <Drawer setDrawerContent={setDrawerContent} transactions={txns} />
      });
    };
```

(also deletes the `console.log({txns,filterString});` line).

(c) `FinanceApp.jsx` — change the Drawer child from `{drawerContent?.jsx || drawerContent}` to:

```jsx
          {drawerContent?.jsx}
```

(d) Guard `BudgetShortTerm` against missing compiled fields — top of the component:

```jsx
    const { budgetStart, budgetEnd } = budget;
    const shortTermBuckets = budget.shortTermBuckets || {};
    const shortTermStatus = budget.shortTermStatus || { budget: 0, credits: 0, debits: 0, balance: 0 };
```

- [ ] **Step 7: Make the external-navigation row click visible (audit 5.3)**

In `drawer.jsx`, the transaction `<tr>` opens buxfer.com with zero affordance. Add a `title` and an external-link icon on linkable rows — in the row render, change the `<tr>` opening tag and the description cell:

```jsx
                                    <tr key={guid} className={rowClassName + (pairMode ? ' pair-selectable' : '')}
                                      onClick={() => pairMode ? handleSelectPairTarget(transaction) : handleRowClick(transaction)}
                                      title={pairMode ? 'Select as offsetting transaction' : (hasId ? 'Open in Buxfer (new tab)' : undefined)}
                                      style={{ cursor: pairMode ? 'crosshair' : (hasId ? 'pointer' : 'default') }}>
```

and in the description cell append the icon after the pair badge:

```jsx
                                        <td className="description-col">
                                          {transaction.description}{memo}{pairBadge}
                                          {hasId && !pairMode && (
                                            <img src={externalIcon} alt="" aria-hidden="true"
                                              style={{ width: '0.8em', height: '0.8em', marginLeft: '0.4em', opacity: 0.4, verticalAlign: 'baseline' }} />
                                          )}
                                        </td>
```

(`externalIcon` is already imported in this file.)

- [ ] **Step 8: Verify no bare-JSX drawer callers remain, build**

```bash
grep -rn "setDrawerContent(" frontend/src/modules/Finances frontend/src/Apps/FinanceApp.jsx | grep -v "setDrawerContent({" | grep -v "setDrawerContent(null)" | grep -v "setDrawerContent={"
npm --prefix frontend run build
```
Expected: grep output shows only prop-passing/definition lines (no call passing bare JSX); build succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "fix(finance): null-safe transaction filtering, capped Buxfer bulk link, single {meta,jsx} drawer shape, visible external-link affordance

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Pairing flow — no prompt(), no page reload, menu closes on outside click

**Files:**
- Modify: `frontend/src/modules/Finances/drawer.jsx`

**Interfaces:**
- Consumes: `useFinanceReload()` from `FinanceDataContext.jsx` (Task 9), `DaylightAPI` (already imported in Task 9).

- [ ] **Step 1: Rewire the pairing handlers and banner**

In the `Drawer` component in `drawer.jsx`:

(a) Add imports at the top of the file:

```jsx
import { TextInput } from '@mantine/core';
import { useFinanceReload } from './FinanceDataContext.jsx';
```

(b) Add state + context inside `Drawer` (next to the existing `menuOpenId`/`pairMode` state):

```jsx
    const reload = useFinanceReload();
    const [pairDesc, setPairDesc] = useState('');
    const [pairNotice, setPairNotice] = useState(null);
```

(c) Replace `handleSelectPairTarget` and `handleUnpair`:

```jsx
    const handleSelectPairTarget = async (targetTransaction) => {
      const source = pairMode.sourceTransaction;
      const isSourceExpense = source.expenseAmount > 0;
      const debit = isSourceExpense ? source.id : targetTransaction.id;
      const credit = isSourceExpense ? targetTransaction.id : source.id;
      const desc = pairDesc.trim() || `${source.description} ↔ ${targetTransaction.description}`;

      try {
        await DaylightAPI('api/v1/finance/pairs', { debit, credit, desc }, 'POST');
        setPairMode(null);
        setPairDesc('');
        await reload();
        setPairNotice('Pair saved and data refreshed — reopen this drawer to see updated amounts.');
      } catch (err) {
        setPairNotice(`Failed to create pair: ${err.message}`);
      }
    };

    const handleUnpair = async (transaction) => {
      setMenuOpenId(null);
      try {
        await DaylightAPI('api/v1/finance/pairs', { debit: transaction.id, credit: transaction.pairedWith }, 'DELETE');
        await reload();
        setPairNotice('Pair removed and data refreshed — reopen this drawer to see updated amounts.');
      } catch (err) {
        setPairNotice(`Failed to unpair: ${err.message}`);
      }
    };
```

(no `prompt()`, no `window.location.reload()` — verify both strings are gone from the file when done).

(d) Replace the pair-mode banner JSX with a version containing the inline description input, and render the notice:

```jsx
              {pairMode && (
                <div style={{ padding: '8px 12px', background: '#1a3a5c', borderRadius: '4px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Select the offsetting transaction for: <strong>{pairMode.sourceTransaction.description}</strong></span>
                  <TextInput
                    size="xs"
                    placeholder="Pair description (optional)"
                    value={pairDesc}
                    onChange={(e) => setPairDesc(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button onClick={() => { setPairMode(null); setPairDesc(''); }} style={{ background: 'none', border: '1px solid #666', color: '#ccc', cursor: 'pointer', borderRadius: '3px', padding: '2px 8px' }}>Cancel</button>
                </div>
              )}
              {pairNotice && (
                <div style={{ padding: '8px 12px', background: '#2d2d3a', borderRadius: '4px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{pairNotice}</span>
                  <button onClick={() => setPairNotice(null)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}>×</button>
                </div>
              )}
```

- [ ] **Step 2: Close the row menu on outside click**

Add this effect inside `Drawer` (after the state declarations):

```jsx
    useEffect(() => {
      if (menuOpenId == null) return;
      const close = () => setMenuOpenId(null);
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }, [menuOpenId]);
```

(The actions-`<td>` already calls `e.stopPropagation()`, so clicks on the menu itself don't reach the document listener — only genuinely-outside clicks close it.)

- [ ] **Step 3: Verify the old patterns are gone, build**

```bash
grep -n "prompt(\|location.reload" frontend/src/modules/Finances/drawer.jsx
npm --prefix frontend run build
```
Expected: grep has no output; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Finances/drawer.jsx
git commit -m "feat(finance): pairing uses inline description + data reload instead of prompt() and full page reloads; row menu closes on outside click

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: Chart render hygiene — memoized options, no nuke-remount, no `Other2` leak

**Files:**
- Modify: `frontend/src/modules/Finances/drawer.jsx` (`SpendingPieDrilldownChart`, `DrawerWaterFallChart`, `DrawerTreeMapChart`)
- Modify: `frontend/src/modules/Finances/blocks/shortterm.jsx`
- Modify: `frontend/src/modules/Finances/blocks/daytoday.jsx` (`BudgetDayToDay`)

**Interfaces:**
- Consumes: everything as left by Tasks 8-16 (imports of `useMemo` already exist in drawer.jsx; shortterm.jsx must add `useMemo` to its react import).
- Produces: no API changes — pure render-cost and display fixes (audit 3.5, plus the user-visible `Other2` breadcrumb from 4.2).

- [ ] **Step 1: Remove the "nuke" remount from `SpendingPieDrilldownChart`**

The component force-remounts itself via a `componentKey` bumped by one effect while a second effect re-initializes state — and its parent (`BudgetSpending`) *already* remounts it via `key={budgetStartDate.toString()}`. In `drawer.jsx`:

(a) Delete the `componentKey` state and its effect:

```jsx
  const [componentKey, setComponentKey] = useState(0);

  // Force a "nuke" rebuild of the component on transactions or budgetKey change.
  useEffect(() => {
    setComponentKey((prev) => prev + 1);
  }, [transactions, budgetKey]);
```

(b) Change the remaining init effect's dependency array from `[componentKey, transactions]` to `[transactions]`, and delete the unused `const getGrandTotal = () => { return grandTotal || 0; };` line.

(c) In the returned JSX, remove `key={componentKey}` from the outer `<div>`.

(d) Since `budgetKey` is now unused in the component body, remove it from the destructured props AND remove the `budgetKey={budgetKey}` prop where `BudgetSpending` passes it in `blocks.jsx` (keep `key={budgetStartDate.toString()}` there — that is the remount mechanism).

- [ ] **Step 2: Stop `Other2` leaking into breadcrumbs**

In `buildCrumbLabel` (drawer.jsx), treat `Other2` like `Other`:

```jsx
  const buildCrumbLabel = (point) => {
    const percentOfTop = (point.valueReal / grandTotal) * 100;
    if (point.name === "Other" || point.name === "Other2") {
      return `${formatCompactCurrency(point.valueReal)} (${percentOfTop.toFixed(1)}%)`;
    }
    return point.name;
  };
```

(The full one-algorithm unification of the two "group into Other" implementations stays deferred — see header.)

- [ ] **Step 3: Memoize per-render chart option rebuilds**

(a) `DrawerWaterFallChart` — wrap the entire body computation (from `const {month} = periodData;` through the `options` literal's closing `};`) in a `useMemo`:

```jsx
function DrawerWaterFallChart({ periodData, setTransactionFilter }) {
  const options = useMemo(() => {
    const { month } = periodData;
    // ... existing body unchanged (incomeSum, categoryCredits/Debits, data, options literal) ...
    return options;
  }, [periodData, setTransactionFilter]);

  return <div className="waterfall-chart">
    <HighchartsReact highcharts={Highcharts} options={options} />
  </div>;
}
```

(b) `DrawerTreeMapChart` — same shape: wrap from `const tagColorMap = {};` through the `options` literal in `useMemo(() => { ...; return options; }, [transactions, setTransactionFilter])` (the `pastelColors` const can stay outside).

(c) `blocks/shortterm.jsx` — add `useMemo` to the react import (`import React, { useMemo } from "react";`, dropping the unused `useEffect`/`useState`), then wrap from `const { weeksLeft, progress } = budgetProgress(...)` through the `options` literal:

```jsx
    const { processedData, options } = useMemo(() => {
        const { weeksLeft, progress } = budgetProgress(budgetStart, budgetEnd);
        // ... existing processedData / series / options construction unchanged ...
        return { processedData, options };
    }, [budget, setDrawerContent]);
```

(`gatherTransactions`, `handleStatusClick`, and `statusBadge` stay outside the memo — they read `shortTermBuckets`/`shortTermStatus` from the outer scope, unchanged.)

(d) `blocks/daytoday.jsx` `BudgetDayToDay` — memoize the options build and drop the per-tab-switch remount:

```jsx
  const monthData = budget.dayToDayBudget[activeMonth] || {};
  const options = useMemo(
    () => buildDayToDayBudgetOptions(monthData, setDrawerContent),
    [monthData, setDrawerContent]
  );
```

and remove `key={activeMonth}` from the `<HighchartsReact>` (options change on tab switch, so Highcharts diffs the series instead of tearing down the chart). Add `useMemo` to this file's react import.

- [ ] **Step 4: Tests + build**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Finances/
npm --prefix frontend run build
```
Expected: all module tests still PASS (`buildDayToDayBudgetOptions` itself is untouched); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Finances
git commit -m "perf(finance): memoize chart options, drop SpendingPie nuke-remount and per-tab chart teardown; Other2 no longer leaks into breadcrumbs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: Cleanup sweep — mutations, logs, keys, stray comments

**Files:**
- Modify: `frontend/src/modules/Finances/blocks.jsx`, `blocks/monthly.jsx`

- [ ] **Step 1: blocks.jsx**

(a) Stop mutating props — replace the `transferTransactions` line in `BudgetHoldings`:

```jsx
    const transferTransactions = [...(activeBudget.transferTransactions?.transactions || [])]
      .sort((a, b) => new Date(b.date) - new Date(a.date));
```

(b) Row keys — in the `transferTransactions.map`, change `key={index}` to `key={txn.id || index}` (destructure `id` is already there).

(c) Delete the stray `// BudgetMortgage.jsx` comment above `BudgetSpending` and the commented-out `.filter((txn) => !["Housing", ...])` line inside `allTransactionsFromAllMonths`.

- [ ] **Step 2: blocks/monthly.jsx**

(a) `MonthTabs` — stop mutating during render:

```jsx
            {[...olderMonths].reverse().map((month) => {
```

(b) Delete the debug log in `getPeriodData`:

```js
    console.log("Period data", month, key, periodData);   // ← DELETE
```

- [ ] **Step 3: Confirm no console.log remains in the module, build**

```bash
grep -rn "console.log" frontend/src/modules/Finances frontend/src/Apps/FinanceApp.jsx
npm --prefix frontend run build
```
Expected: grep has no output (console.error in catch blocks is fine if any remain); build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Finances
git commit -m "chore(finance): stop mutating props/derived arrays in render, real row keys, drop debug logs and stray comments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: Full verification, build, deploy (gated)

**Files:** none (verification only)

- [ ] **Step 1: Run every backend + frontend suite this plan touched**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/finance/ \
  tests/isolated/flow/finance/ \
  frontend/src/modules/Finances/
```
Expected: ALL PASS. Capture the actual pass/fail summary line — do not infer success from exit code of a piped command (repo rule).

- [ ] **Step 2: Full frontend build**

```bash
npm --prefix frontend run build
```
Expected: success.

- [ ] **Step 3: Deploy per CLAUDE.local.md (this host is prod)**

Follow CLAUDE.local.md exactly: build the Docker image, then check BOTH deploy gates (no active fitness session, no playing video) using the documented `docker logs` greps. If clear:

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Post-deploy verification (verify via logs/behavior, never speculate — repo rule)**

```bash
# Recompile so finances.yml gains payoffMonth + zero-payment bridge rows
curl -s -X POST http://localhost:3111/api/v1/finance/compile | head -c 400
# Data endpoint serves both keys
curl -s http://localhost:3111/api/v1/finance/data | head -c 400
sudo docker logs --since 2m daylight-station 2>&1 | grep -iE "finance|error" | head -20
```
Expected: compile returns success JSON; `/data` returns `{"budgets":...` ; no finance errors in logs. Then load `/finance` in a browser and eyeball: budget selector works, reload button spins and stops, mortgage block renders, day-to-day chart shows a colored projection, waterfall y-axis shows `$` labels, pairing banner has a text input.

- [ ] **Step 5: Final commit / merge decision**

Report results to the user and use superpowers:finishing-a-development-branch to decide merge/PR/cleanup.

---

## Self-Review Notes (updated after adversarial review, 2026-07-07)

- **Spec coverage (🔴 all covered; 🟠 covered or explicitly deferred in the header):** 1.1→T1, 1.2→T1, 1.3→T4, 1.4→T3, 1.5→T6, 1.6→T6, 1.7→deferred, 1.8→T2, 1.9→T5, 2.1→T9, 2.2→T9, 2.3→T15 (shape unified; descriptor refactor deferred), 2.4→T9, 2.5→T7, 2.6→deferred, 2.7→T9/T12/T18, 3.1→T10, 3.2→T14, 3.3→T12 (color + y-axis clip; abs-bar plotting deferred), 3.4→T13 (plotLine clamp, tooltip, comparator, useHTML), 3.5→T17, 3.6→T11, 4.1→T8, 4.2→T17 (breadcrumb leak only; algorithm unification deferred), 4.3→partially T15 (titled drawers; unified filter paradigm deferred), 4.4→deferred, 4.5→deferred, 5.1→T16, 5.2→T15 (filter guards, URL cap, shortTermStatus guard) + T9 (error boundary), 5.3 🟠→T15 Step 7 (row title + external icon), 5.4/5.5→deferred.
- **Adversarial review outcomes folded in:** T6's bridge fix is now bounded (skip empty cycles that are in-flight or statement-covered) with the one legitimately-affected existing test updated in T6 Step 2(b) and the drift-reconciliation test verified unaffected; T3 Step 4's edit range corrected to lines 119-121 (`amortMonths` must survive); T8's `formatCurrency` call-site list corrected to all 8 sites with a grep gate; `ValidationError` extras nested under `details` per the actual constructor.
- **Type consistency:** `useFinanceData` return shape matches T9 component usage and T16's `useFinanceReload`; `PALETTE` keys used in T11-T13 all exist in T8's definition; `calculateCost` signature identical between lib and both mortgage.jsx call sites; `info.payoffMonth` produced in T3 is what T3's frontend edit and T3's `#findPayoffRange` consume; `budgetBlockDimensions` removed in T7 and absent from T9's rewrite; T17 assumes T8's `formatCompactCurrency` and T13's `budgetProgress`, both defined in those tasks.
- **Placeholder scan:** every code step contains the actual code; the only conditional instructions are evidence-gated STOP/adjust branches (config check in T2 Step 1, flow-fixture note in T6 Step 5, Highcharts-import fallback in T12 Step 2), each with the concrete alternative spelled out. T17 Step 3's "existing body unchanged" ellipses denote wrap-in-place edits where the wrapped code is not modified — the wrapper lines shown are the complete change.
