# Transaction Offset Pairs

## Problem

The spending chart inflates "actual" spending in several scenarios:

1. **RSU vest+sell**: Stock vests as a transfer, then is sold immediately. The vest and sell are both recorded but should largely cancel out — only the delta (taxes/fees or appreciation) is real.
2. **Accidental purchase + refund + re-purchase**: The original purchase and refund are noise; only the re-purchase is real spending.
3. **Reimbursed expenses** (future consideration): Business trip expenses reimbursed by employer — net cost is $0.

These all share a pattern: two transactions that logically offset each other, where only the delta (if any) represents real financial activity.

## Design

### Data File: `transaction.pairs.yml`

A new YAML file in the finance data directory (`data/household/common/finances/transaction.pairs.yml`).

```yaml
- debit: 209058385
  credit: 209127468
  desc: "AMC accidental purchase + refund"

- debit: 230512341
  credit: 230512345
  desc: "RSU Oct 2025 vest+sell"
```

| Field | Type | Description |
|-------|------|-------------|
| `debit` | number | Buxfer transaction ID of the outflow/expense side |
| `credit` | number | Buxfer transaction ID of the inflow/refund/income side |
| `desc` | string | Human-readable description of why these are paired |

Each entry is a 1:1 pair. For scenarios with more than 2 transactions (e.g., buy + refund + re-buy), only the noise transactions are paired; the real transaction stands alone.

### Compilation Behavior

During `BudgetCompilationService` compilation, after transactions are loaded but before spending totals are calculated:

1. Load pairs from `transaction.pairs.yml` via `YamlFinanceDatastore`
2. For each pair, find both transactions by ID in the current budget period's transaction set
3. Calculate delta: `debit.amount - credit.amount`
4. Apply delta:
   - **delta > 0** (debit exceeds credit): Reduce the debit transaction's `expenseAmount` to the delta. Zero out the credit transaction's contribution.
   - **delta < 0** (credit exceeds debit, e.g., stock appreciated): Zero out the debit. The credit contributes `|delta|` as real income/credit.
   - **delta == 0**: Zero out both transactions' spending/income contributions.
5. Mark both transactions with `paired: true` and `pairDesc: <desc>` for downstream UI flagging.

### Frontend Behavior

- **Spending chart totals**: Use adjusted amounts (delta only). Paired portions excluded.
- **Short-term bucket calculations**: Use adjusted `expenseAmount` values, so bucket balances reflect real spending.
- **Transaction rows**: Paired transactions are visually dimmed with the pair description as a tooltip. A subtle link icon indicates the pairing.

### Transaction Row Actions

Each transaction row in the drawer gets a `...` overflow menu (three-dot button). Initial actions:

- **Pair** — Opens a search/select flow to pick the offsetting transaction and enter a description. Saves to `transaction.pairs.yml` and recompiles.
- **Unpair** — Only shown on already-paired transactions. Removes the pair entry and recompiles.

This menu is extensible for future per-transaction actions (e.g., recategorize, annotate).

### Pair Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/finance/pairs` | GET | List all pairs |
| `/api/v1/finance/pairs` | POST | Create a pair `{debit, credit, desc}` |
| `/api/v1/finance/pairs` | DELETE | Remove a pair `{debit, credit}` |

POST and DELETE trigger a recompile automatically so the UI reflects changes immediately.

### What This Doesn't Touch

- **Buxfer data**: Entirely local — no API calls or Buxfer modifications.
- **Income classification**: Pairs work across any transaction types (expense, transfer, income, refund, investment sale).
- **Tag-based categorization**: Existing tag routing to buckets is unaffected. Pairing only adjusts the amounts after categorization.

### File Location

```
data/household/common/finances/
├── budget.config.yml
├── finances.yml
├── transaction.memos.yml
├── transaction.pairs.yml        ← NEW
├── payroll.yml
└── 2025-04-01/
    └── transactions.yml
```

### Code Touchpoints

| Layer | File | Change |
|-------|------|--------|
| Persistence | `YamlFinanceDatastore.mjs` | Add `loadTransactionPairs()` / `saveTransactionPairs()` |
| Application | `BudgetCompilationService.mjs` | Apply pair adjustments before spending calculation |
| API | `finance.mjs` (router) | Add GET/POST/DELETE `/pairs` endpoints |
| Frontend | `drawer.jsx` | Add `...` overflow menu on transaction rows with Pair/Unpair actions |
| Frontend | `blocks.jsx` / `shortterm.jsx` | Respect `paired` flag for dimmed display |
