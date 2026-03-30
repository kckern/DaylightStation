# Mortgage Statements as Primary Data Source

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make PDF-derived `mortgage.statements.yml` the authoritative source for mortgage balances and P/I/E breakdowns, with Buxfer transactions as a supplement for the current month only.

**Architecture:** Add `getMortgageStatements()` to `YamlFinanceDatastore`. Rewrite `MortgageCalculator.calculateMortgageStatus()` to build running balances and interest totals from statement data, appending Buxfer transactions only for months after the latest statement. Frontend unchanged — same `mortgage` shape, better data.

**Tech Stack:** Node.js/ESM, YAML persistence, existing DDD layers

---

## Task 1: Add `getMortgageStatements()` to YamlFinanceDatastore

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs:204-226`

**Step 1: Add the reader method after the existing mortgage transactions section**

Add this method after `saveMortgageTransactions` (line ~226):

```javascript
  // ==========================================================================
  // Mortgage Statements (PDF-derived authoritative data)
  // ==========================================================================

  /**
   * Get mortgage statements (PDF-derived principal balances and P/I/E splits)
   * @param {string} [householdId]
   * @returns {{ loan: Object, statements: Object, escrowAnalyses: Object }|null}
   */
  getMortgageStatements(householdId) {
    const filePath = path.join(this.getBasePath(householdId), 'mortgage.statements');
    return this.#readData(filePath);
  }
```

**Step 2: Verify it loads**

Run from project root:
```bash
node -e "
import { YamlFinanceDatastore } from './backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs';
// Quick smoke test - will fail without configService, that's fine
console.log('Import OK');
"
```
Expected: `Import OK` (confirms syntax is valid)

**Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs
git commit -m "feat(finance): add getMortgageStatements() to YamlFinanceDatastore"
```

---

## Task 2: Rewrite `MortgageCalculator.calculateMortgageStatus()` to prefer statement data

**Files:**
- Modify: `backend/src/2_domains/finance/services/MortgageCalculator.mjs:131-208`

**Step 1: Add a `statements` parameter to `calculateMortgageStatus`**

Change the method signature and add statement-aware logic. The key change: instead of deriving `totalInterestPaid` from `startingBalance - mortgageStartValue` (an approximation), use the actual interest paid from statement `paidYTD` fields. Instead of computing `runningBalance` from Buxfer transaction sums, use the `principalBalance` from each statement.

Replace `calculateMortgageStatus` (lines 131–208) with:

```javascript
  /**
   * Calculate mortgage status from statement data + transaction history
   *
   * @param {Object} params
   * @param {Object} params.config - Mortgage configuration
   * @param {number} params.balance - Current Buxfer account balance
   * @param {Object[]} params.transactions - Buxfer payment transactions
   * @param {Object|null} params.statementData - PDF-derived statement data (mortgage.statements.yml)
   * @param {Date|string} params.asOfDate - Date to calculate as of (required)
   * @returns {MortgageStatus}
   */
  calculateMortgageStatus({ config, balance, transactions, statementData, asOfDate }) {
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

    // If we have statement data, use it as primary source
    if (statementData?.statements) {
      return this.#buildFromStatements({
        config, balance, transactions, statementData, asOfDate
      });
    }

    // Fallback: original Buxfer-only calculation
    return this.#buildFromBuxferOnly({
      config, balance, transactions, asOfDate
    });
  }
```

**Step 2: Add `#buildFromStatements` private method**

Add after `calculateMortgageStatus`:

```javascript
  /**
   * Build mortgage status from authoritative statement data
   * Uses Buxfer transactions only for months after the latest statement
   * @private
   */
  #buildFromStatements({ config, balance, transactions, statementData, asOfDate }) {
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
    const latestStatementKey = statementMonths[statementMonths.length - 1];
    const latestStatement = statements[latestStatementKey];

    // Use statement principal balance as authoritative current balance
    const statementBalance = latestStatement.principalBalance;

    // Calculate total interest and principal paid from statements
    // Sum interest from each statement's transaction activity
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;
    let totalEscrowPaid = 0;

    for (const monthKey of statementMonths) {
      const stmt = statements[monthKey];
      if (!stmt.transactions) continue;
      for (const txn of stmt.transactions) {
        totalInterestPaid += txn.interest || 0;
        totalPrincipalPaid += txn.principal || 0;
        totalEscrowPaid += Math.max(0, txn.escrow || 0); // ignore disbursements (negative)
      }
    }

    // Build transactions with running balance from statements
    const transactionsWithBalance = this.#buildStatementTransactions(statements, statementMonths, mortgageStartValue);

    // Append Buxfer transactions for months after the latest statement
    const latestStatementDate = latestStatement.statementDate;
    const recentBuxferTxns = transactions
      .filter(t => t.date > latestStatementDate)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (recentBuxferTxns.length > 0) {
      let runningBalance = -statementBalance;
      for (const txn of recentBuxferTxns) {
        runningBalance += txn.amount;
        transactionsWithBalance.push({
          ...txn,
          runningBalance: this.#round(runningBalance),
          source: 'buxfer'
        });
      }
    }

    // Total paid = principal + interest + escrow
    const totalPaid = totalPrincipalPaid + totalInterestPaid + totalEscrowPaid;

    const monthsSinceStart = this.#monthsDiff(new Date(startDate), new Date(asOfDate));
    const monthlyRent = this.#round(totalInterestPaid / monthsSinceStart);
    const monthlyEquity = this.#round(totalPrincipalPaid / monthsSinceStart);
    const percentPaidOff = (mortgageStartValue - statementBalance) / mortgageStartValue;

    // Calculate payment plan projections from current balance
    const paymentPlansFilled = this.calculatePaymentPlans({
      balance: -statementBalance,
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
      totalPrincipalPaid: this.#round(totalPrincipalPaid),
      monthlyRent,
      monthlyEquity,
      percentPaidOff,
      balance: statementBalance,
      interestRate,
      earliestPayoff,
      latestPayoff,
      totalPaid: this.#round(totalPaid),
      transactions: transactionsWithBalance,
      paymentPlans: paymentPlansFilled
    };
  }

  /**
   * Build transaction list with running balances from statement data
   * @private
   */
  #buildStatementTransactions(statements, statementMonths, startValue) {
    const result = [];
    let runningBalance = -startValue;

    for (const monthKey of statementMonths) {
      const stmt = statements[monthKey];
      if (!stmt.transactions) continue;

      for (const txn of stmt.transactions) {
        const amount = (txn.principal || 0) + (txn.interest || 0) + Math.max(0, txn.escrow || 0);
        runningBalance += amount;
        result.push({
          date: txn.date,
          description: txn.description,
          amount: this.#round(amount),
          principal: txn.principal || 0,
          interest: txn.interest || 0,
          escrow: txn.escrow || 0,
          runningBalance: this.#round(runningBalance),
          source: 'statement'
        });
      }
    }

    return result;
  }
```

**Step 3: Rename the old logic to `#buildFromBuxferOnly`**

Move the existing body of `calculateMortgageStatus` (the original lines 135-208) into a new private method:

```javascript
  /**
   * Fallback: build mortgage status from Buxfer transactions only
   * Used when no statement data is available
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

    const sumOfTransactions = sortedTransactions.reduce(
      (total, { amount }) => total + amount, 0
    );

    const startingBalanceNeg = this.#round(balance - sumOfTransactions);
    const startingBalance = Math.abs(startingBalanceNeg);

    let runningTotal = 0;
    const transactionsWithBalance = sortedTransactions.map((txn) => {
      runningTotal += txn.amount;
      return {
        ...txn,
        runningBalance: this.#round(startingBalanceNeg + runningTotal),
        source: 'buxfer'
      };
    });

    const paymentPlansFilled = this.calculatePaymentPlans({
      balance, interestRate, minimumPayment, paymentPlans, startDate: asOfDate
    });

    const totalPaid = transactions.reduce((total, { amount }) => total + (amount || 0), 0);
    const monthsSinceStart = this.#monthsDiff(new Date(startDate), new Date(asOfDate));

    const totalInterestPaid = startingBalance - mortgageStartValue;
    const totalPrincipalPaid = totalPaid - totalInterestPaid;
    const percentPaidOff = (startingBalance - Math.abs(balance)) / startingBalance;

    const monthlyRent = this.#round(totalInterestPaid / monthsSinceStart);
    const monthlyEquity = this.#round(totalPrincipalPaid / monthsSinceStart);

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
```

**Step 4: Commit**

```bash
git add backend/src/2_domains/finance/services/MortgageCalculator.mjs
git commit -m "feat(finance): rewrite MortgageCalculator to prefer statement data over Buxfer"
```

---

## Task 3: Wire statement data through BudgetCompilationService

**Files:**
- Modify: `backend/src/3_applications/finance/BudgetCompilationService.mjs:55-69,788-801`

**Step 1: Load statement data in `compile()`**

At line 56, after `mortgageTransactions` is loaded, add:

```javascript
    const mortgageStatements = this.#financeStore.getMortgageStatements(householdId);
```

**Step 2: Pass statement data to `#compileMortgage`**

Change line 69 from:
```javascript
    const mortgage = this.#compileMortgage(mortgageConfig, accountBalances, mortgageTransactions);
```
to:
```javascript
    const mortgage = this.#compileMortgage(mortgageConfig, accountBalances, mortgageTransactions, mortgageStatements);
```

**Step 3: Update `#compileMortgage` to forward statement data**

Replace the method (lines 788-801) with:

```javascript
  /**
   * Compile mortgage status
   */
  #compileMortgage(config, accountBalances, transactions, statementData) {
    if (!config) return null;

    const balance = accountBalances
      .filter(acc => config.accounts?.includes(acc.name))
      .reduce((total, { balance }) => total + balance, 0);

    return this.#mortgageCalculator.calculateMortgageStatus({
      config,
      balance,
      transactions,
      statementData,
      asOfDate: new Date()
    });
  }
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/finance/BudgetCompilationService.mjs
git commit -m "feat(finance): wire mortgage statement data through compilation pipeline"
```

---

## Task 4: Verify end-to-end on dev server

**Step 1: Start the dev server (if not running)**

```bash
lsof -i :3112  # check if already running
npm run dev     # if not running
```

**Step 2: Trigger a recompile**

```bash
curl -X POST http://localhost:3112/api/v1/finance/compile
```

**Step 3: Verify the mortgage response**

```bash
curl -s http://localhost:3112/api/v1/finance/data | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const data = JSON.parse(Buffer.concat(chunks));
  const m = data.mortgage;
  console.log('Balance:', m.balance);
  console.log('Total Interest:', m.totalInterestPaid);
  console.log('Total Principal:', m.totalPrincipalPaid);
  console.log('Transactions:', m.transactions?.length);
  console.log('First txn source:', m.transactions?.[0]?.source);
  console.log('Last txn source:', m.transactions?.[m.transactions.length - 1]?.source);
  console.log('Has P/I split:', !!m.transactions?.[0]?.principal);
});
"
```

Expected output (approximately):
```
Balance: 172374.64
Total Interest: ~16000  (actual sum from statements)
Total Principal: ~227625 (actual sum from statements)
Transactions: ~45
First txn source: statement
Last txn source: statement (or buxfer if current month has new payments)
Has P/I split: true
```

**Step 4: Check the frontend**

Open `http://localhost:3111/finance` in browser. The mortgage chart should show accurate principal balance history (from statement `principalBalance` values) instead of Buxfer-derived estimates.

**Step 5: Commit if any adjustments needed**

```bash
git add -A
git commit -m "fix(finance): adjust mortgage statement integration based on e2e testing"
```

---

## Summary of changes

| File | Change |
|------|--------|
| `YamlFinanceDatastore.mjs` | Add `getMortgageStatements()` reader |
| `MortgageCalculator.mjs` | Rewrite `calculateMortgageStatus()` — statement-primary with Buxfer fallback |
| `BudgetCompilationService.mjs` | Load + forward statement data through pipeline |
| `mortgage.statements.yml` | Already created (data file, not in git) |

**Frontend: No changes needed.** Same `mortgage` object shape, just more accurate data inside it.
