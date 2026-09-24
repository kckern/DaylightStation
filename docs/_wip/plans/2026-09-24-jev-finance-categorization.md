# Finance Categorization via Jev Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Have Jev choose each transaction's budget category from the household's `validTags`. It runs in shadow beside the LLM (which still writes the friendly name and memo), with a config flag that promotes Jev's category when its confidence clears a floor.
**Architecture:** A new application-layer `TransactionCategoryJudge` asks one `choice` question over `validTags` through `IDecisionGateway` and never throws. `TransactionCategorizationService` runs it in parallel with the LLM call on both the apply path (`categorize`) and the dry-run path (`preview`), logs `categorization.jev.compare`, and applies Jev's category only when the finance config sets `jev.mode: promote`. The composition root passes the existing `decisionGateway` into `createFinanceServices`.
**Tech Stack:** Node ESM (`.mjs`), vitest, `IDecisionGateway` / `JevAdapter`, YAML finance store, VictoriaLogs for measurement.
---

## Current state (verified in code and prod logs, 2026-09-24)

- `backend/src/3_applications/finance/TransactionCategorizationService.mjs`
  - `categorize()` (:64-158) loads the config from `financeStore.getCategorizationConfig(householdId)` (:65). It applies regex `descriptionRules` first (:74, `#applyDescriptionRules` :250-300, which mutates the txn and fires a Buxfer update without awaiting it). It then filters with `#needsCategorization` (:308-312: *no tag OR description matches a raw pattern*, patterns at :24-32) and calls `#categorizeTransaction` once per transaction (:92). A success writes `{description: friendlyName, tags: category, memo}` to the transaction source (:96-100).
  - `preview()` (:168-239) is the dry run. It **re-implements** rule matching with slightly different semantics (:177-200: it keeps looking at later rules when `desc === rename`, while apply stops). It also does **not** simulate the rename or tag before `#needsCategorization` (:202). So an untagged, rule-matched transaction gets a `source: 'rule'` suggestion **and** an LLM suggestion. The apply path would send only one of them, or none.
  - `#categorizeTransaction` (:333-387) builds messages from the config `chat` template, replacing `__VALID_TAGS__` (:337-345). The user message is **only `description`** (:348). It calls `aiGateway.chatWithJson` and fails the transaction outright when `category ∉ validTags` (:364-370), even when the friendly name is good.
  - Constructor (:41-55) takes `{aiGateway, transactionSource, financeStore, logger}`. There is no decision gateway.
- Config is read from disk on **every call**. `YamlFinanceDatastore.getCategorizationConfig` (`backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs:366-369`) goes to `#readData` → `loadYamlSafe` (:63-70) with no cache, so a mode flip in the finance config takes effect on the next run without a restart. Live keys: `descriptionRules` (1 rule), `validTags` (51 tags), `chat` (1 system message plus 16 few-shot pairs).
- Wiring: `createFinanceServices` (`backend/src/5_composition/bootstrap.mjs:1183-1270`) builds the service at :1212-1217 only when `aiGateway && buxferAdapter` exist. `backend/src/app.mjs:1320-1329` calls it **without** `decisionGateway`, which is built earlier at `app.mjs:711-717`. `FinanceHarvestService.#runCategorization` (`FinanceHarvestService.mjs:284-313`) and `FinanceApiService.categorize` (`FinanceApiService.mjs:173-189`, `preview === true` → `preview()`) are the two callers.
- Buxfer update path: `BuxferAdapter.updateTransaction` (`backend/src/1_adapters/finance/BuxferAdapter.mjs:271-286`) posts `transaction_edit` and drops falsy fields. `BuxferAdapter.processTransactions` (:424-500) is a **second, older categorization loop** (`aiGateway.categorize(description)`), and nothing in `backend/` calls it. It is dead code, so it is out of scope and left as is.
- Tests are **not colocated**. They live at `tests/isolated/flow/finance/TransactionCategorizationService.test.mjs` (12 passing) and `tests/isolated/adapter/harvester/finance/FinanceCategorization.test.mjs`. New files in this plan are colocated per the brief. Existing tests are extended where they already are.
- Transaction fields available as state (from the stored period YAML): `id, description, date, type` (expense/income/transfer/investment sale/refund/dividend), `transactionType, amount` (positive), `expenseAmount, accountId, accountName, tags, tagNames, status, isPending, isFutureDated`. **There is no merchant field.** Merchant is only whatever `description` says.
- **Prod logs (7 days, `categorization.*`):** 394 `categorization.start`, 223 `categorization.success`, 1 `categorization.failed`. **197 of the 223 successes are the same transaction** (id `245703143`). The LLM renames it to `"Direct Deposit"`, which matches the raw pattern `/^Direct/i` (:25). So every hourly harvest sends it back to the LLM and rewrites Buxfer, and the category **flips between Income (143×) and Payroll (54×)**. Only ~26 distinct transactions a week reach the LLM. The one failure was `"Direct Debit Paypal Purchase"` → `Invalid category: ""`, because the system prompt says *"If the transaction is not in the list, leave it blank"*.
- The live `chat` few-shot examples teach **categories that are not in `validTags`**: `Health`, `Dining`, `Car Rental`. An LLM that copies them fails validation. A Jev `choice` cannot return a key outside `validTags`.

### Does Jev decide "does this transaction need the LLM at all"? Not in this plan

The code does show a real case: the `"Direct Deposit"` loop above, where a clean, tagged name is re-sent because a regex misfires. That case is fixed **deterministically** in Task 1: a transaction the service itself renamed is not re-sent while its description is unchanged. After that fix, the only traffic a Jev "needs LLM?" gate could skip is a handful of tagged-but-raw rows a week. The friendly name still needs the LLM for every untagged row, so the gate would save almost nothing and add a call per row. It is left out.

## Questions for Jev

One question per transaction, asked in `TransactionCategoryJudge.judge()`:

```js
choice(
  'Which budget category does this bank transaction belong to? '
  + '`description` is the raw bank or card description; it may carry payment-processor noise such as "Pwp", "Sq *", '
  + '"Privacycom" or reference numbers. `type` is how the bank classed it (expense, income, transfer, refund, '
  + 'dividend, investment sale), `amount` is the absolute amount, and `account` is the account it posted to.',
  validTags,            // string[] from the finance config, deduped; 51 today (under the adapter's 255 cap)
)
```

`state` shape (built by `TransactionCategoryJudge.stateFor(txn)`):

```js
{
  description: 'Sq *6 Saplings Sugarhouse', // the description the LLM sees at this point (after rules on the apply path)
  type: 'expense',                           // txn.type || txn.transactionType || null
  amount: 42.5,                              // Math.abs(Number(txn.amount)) or null
  account: 'Visa',                           // txn.accountName || null
  date: '2026-09-20',                        // txn.date || null
}
```

Jev deliberately does not see the LLM's answer. The two picks are independent, and that independence is what makes agreement meaningful.

## Rollout

1. **Shadow (default).** With no `jev` block in the finance config, or `jev.mode: shadow`, every LLM categorization on both paths also asks Jev and logs:
   `categorization.jev.compare { id, path: apply|preview, mode, floor, llmCategory, llmValid, jevCategory, confidence, agreed, via, cjk, model, jevMs }`.
   Results and Buxfer writes are unchanged. `jev.mode: off` asks nothing.
2. **Measure.** Prod volume is ~26 distinct decisions a week and the log store keeps 7 days, so prod shadow alone cannot accumulate a sample. The primary evidence is the offline replay (Task 7) over already-tagged history (~1,000 rows per budget period). Prod shadow confirms the result week by week:
   ```
   query="categorization.jev.compare" AND _time:7d | stats by ("data.agreed","data.llmValid") count() as n
   query="categorization.jev.compare" AND data.agreed:false AND _time:7d
   ```
3. **Promote criteria:** all of the following must hold.
   - Replay over ≥ 300 tagged rows across ≥ 2 budget periods: `agreementAtFloor ≥ 0.92` with `coverage ≥ 0.6` at the chosen floor (default 0.8).
   - Two consecutive weekly prod checks where every `agreed:false, llmValid:true` row at `confidence ≥ floor` has been read and Jev was right or the call was ambiguous (e.g. Income vs Payroll).
   - CJK rows (`cjk:true`) are reviewed separately. If their agreement is materially lower, stay in shadow; the provider says CJK accuracy is weaker.
4. **Promote.** Set `jev: { mode: promote, confidenceFloor: <floor> }` in the household finance categorization config. No restart is needed. Jev's category then wins at `confidence ≥ floor`, and it also rescues rows where the LLM named the merchant but left the category blank or invalid. The LLM still supplies `friendlyName` and `memo`. Roll back by setting `mode: shadow`.

---

## Task 0: Worktree and sync

**Step 1:** Check whether the deployed source is ahead of local (see `CLAUDE.local.md`). Integrate first if it is.

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin && git log --oneline origin/main..HEAD
ssh {env.prod_host} 'cd <deploy tree> && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

**Step 2:** Create the worktree. All later paths are relative to it.

```bash
git worktree add .worktrees/finance-categorization -b feat/finance-categorization main
cd .worktrees/finance-categorization
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
```

Expected: `Tests 12 passed`.

---

## Task 1: Stop re-categorizing a transaction the service already settled

This fixes the hourly `"Direct Deposit"` loop (197 LLM calls and Buxfer writes in 7 days, category flipping Income/Payroll). It does not depend on Jev.

**Files:**
- Modify: `backend/src/3_applications/finance/TransactionCategorizationService.mjs`: fields (:18-21), success branch of `categorize()` (:102-105), `#needsCategorization` (:308-312)
- Test: `tests/isolated/flow/finance/TransactionCategorizationService.test.mjs` (append a `describe` inside the top-level block, before the final `});`)

**Step 1: Write the failing test**

```js
  describe('settled transactions', () => {
    it('does not re-send a tagged transaction whose new name still matches a raw pattern', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);

      // The next harvest re-reads the renamed, tagged transaction from the provider
      const result = await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit', tagNames: ['Income'] }]);

      expect(mockAIGateway.chatWithJson).toHaveBeenCalledTimes(1);
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledTimes(1);
      expect(result.skipped).toHaveLength(1);
      expect(mockLogger.info).toHaveBeenCalledWith('categorization.settled', { id: 9, friendlyName: 'Direct Deposit' });
    });

    it('re-sends it when the provider description changes again', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Pwp Xx12', tagNames: ['Income'] }]);

      expect(mockAIGateway.chatWithJson).toHaveBeenCalledTimes(2);
    });

    it('getUncategorized agrees with categorize about settled rows', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);

      expect(service.getUncategorized([{ id: '9', description: 'Direct Deposit', tagNames: ['Income'] }])).toEqual([]);
    });
  });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs -t "settled"
```

Expected: FAIL. `chatWithJson` is called 2 times instead of 1, and `categorization.settled` is never logged.

**Step 3: Minimal implementation**

Add a field after `#logger;` (:21):

```js
  // id → the description this service wrote when that description still looks
  // raw to the patterns below (e.g. "Direct Deposit" vs /^Direct/). Without it
  // the next harvest re-sends the row to the LLM forever. In-process only: a
  // restart costs one re-ask per such row.
  #settled = new Map();
```

In `categorize()`, after `if (result.memo) txn.memo = result.memo;` (:105), insert:

```js
          if (this.#hasRawDescription(result.friendlyName)) {
            this.#settled.set(String(txn.id), result.friendlyName);
            this.#log('info', 'categorization.settled', { id: txn.id, friendlyName: result.friendlyName });
          }
```

Replace `#needsCategorization` (:308-312) with:

```js
  #needsCategorization(transaction) {
    const hasNoTag = !transaction.tagNames?.length;
    if (!hasNoTag && this.#settled.get(String(transaction.id)) === transaction.description) return false;
    const hasRawDescription = this.#hasRawDescription(transaction.description);
    return hasNoTag || hasRawDescription;
  }
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
```

Expected: `Tests 15 passed`.

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/TransactionCategorizationService.mjs tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
git commit -m "$(cat <<'EOF'
fix(finance): stop re-categorizing transactions the service already renamed

A friendly name like "Direct Deposit" still matches the /^Direct/ raw
pattern, so every hourly harvest re-sent it to the LLM and rewrote Buxfer,
flipping its tag between Income and Payroll (197 calls in 7 days).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `TransactionCategoryJudge`, one choice over `validTags`

**Files:**
- Create: `backend/src/3_applications/finance/TransactionCategoryJudge.mjs`
- Test: `backend/src/3_applications/finance/TransactionCategoryJudge.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { TransactionCategoryJudge } from './TransactionCategoryJudge.mjs';

const TAGS = ['Groceries', 'Fuel', 'Income', 'Payroll', 'Shopping'];
const txn = {
  id: 7, description: 'Sq *6 Saplings Sugarhouse', type: 'expense', amount: -42.5,
  accountName: 'Visa', date: '2026-09-20', tagNames: [],
};
const gatewayAnswering = (answer) => ({
  isConfigured: () => true,
  evaluate: vi.fn().mockResolvedValue({ model: 'jev-test-1', answers: { category: answer }, usage: {} }),
});
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

describe('TransactionCategoryJudge', () => {
  it('asks one choice over validTags with the transaction facts as state', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Groceries', confidence: 0.91, probabilities: { Groceries: 0.91 } });
    const verdict = await new TransactionCategoryJudge({ decisionGateway: gateway, logger: makeLogger() }).judge(txn, TAGS);

    const [state, questions, options] = gateway.evaluate.mock.calls[0];
    expect(state).toEqual({ description: 'Sq *6 Saplings Sugarhouse', type: 'expense', amount: 42.5, account: 'Visa', date: '2026-09-20' });
    expect(questions.category.type).toBe('choice');
    expect(Object.keys(questions.category.options)).toEqual(TAGS);
    expect(options).toEqual({ timeout: 5000 });
    expect(verdict).toMatchObject({ category: 'Groceries', confidence: 0.91, model: 'jev-test-1', cjk: false });
    expect(verdict.ms).toBeGreaterThanOrEqual(0);
  });

  it('returns null when no decision model is configured', async () => {
    expect(await new TransactionCategoryJudge().judge(txn, TAGS)).toBeNull();
    const noop = { isConfigured: () => false, evaluate: vi.fn() };
    expect(await new TransactionCategoryJudge({ decisionGateway: noop }).judge(txn, TAGS)).toBeNull();
    expect(noop.evaluate).not.toHaveBeenCalled();
  });

  it('returns null with fewer than two distinct tags', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Fuel', confidence: 1, probabilities: {} });
    expect(await new TransactionCategoryJudge({ decisionGateway: gateway }).judge(txn, ['Fuel', 'Fuel'])).toBeNull();
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  it('never throws: a failed evaluate is logged and returns null', async () => {
    const logger = makeLogger();
    const gateway = { isConfigured: () => true, evaluate: vi.fn().mockRejectedValue(new Error('timeout')) };
    expect(await new TransactionCategoryJudge({ decisionGateway: gateway, logger }).judge(txn, TAGS)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('categorization.jev.failed', expect.objectContaining({ id: 7, error: 'timeout' }));
  });

  it('drops a choice outside validTags but keeps its confidence', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Car Rental', confidence: 0.6, probabilities: {} });
    expect(await new TransactionCategoryJudge({ decisionGateway: gateway }).judge(txn, TAGS))
      .toMatchObject({ category: null, confidence: 0.6 });
  });

  it('flags CJK descriptions so agreement can be sliced by script', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Shopping', confidence: 0.7, probabilities: {} });
    const verdict = await new TransactionCategoryJudge({ decisionGateway: gateway }).judge({ ...txn, description: '롯데쇼핑（주）' }, TAGS);
    expect(verdict.cjk).toBe(true);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run backend/src/3_applications/finance/TransactionCategoryJudge.test.mjs
```

Expected: FAIL with `Failed to load url ./TransactionCategoryJudge.mjs`.

**Step 3: Minimal implementation**

```js
/**
 * TransactionCategoryJudge — a typed decision model's pick of a transaction's
 * budget category from the household's `validTags`.
 *
 * One choice question per transaction. The answer can only be one of the
 * household's tags, which the LLM path cannot promise (it fails on a blank or
 * invented category). The judge decides nothing on its own:
 * TransactionCategorizationService logs it beside the LLM's pick (shadow) and
 * applies it only when the finance config promotes it.
 *
 * Never throws: no model, too few tags, or a failed call all return null,
 * which callers treat as "no opinion".
 */

import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

const DEFAULT_TIMEOUT_MS = 5000;

const INSTRUCTIONS = 'Which budget category does this bank transaction belong to? '
  + '`description` is the raw bank or card description; it may carry payment-processor noise such as "Pwp", "Sq *", '
  + '"Privacycom" or reference numbers. `type` is how the bank classed it (expense, income, transfer, refund, '
  + 'dividend, investment sale), `amount` is the absolute amount, and `account` is the account it posted to.';

// Hangul, CJK ideographs and fullwidth forms: the provider's weaker scripts
const CJK = /[ᄀ-ᇿ　-〿㄰-㆏一-鿿가-힯＀-￯]/;

export class TransactionCategoryJudge {
  #decisionGateway; #timeoutMs; #logger;

  /**
   * @param {Object} [deps]
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console } = {}) {
    this.#decisionGateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  get available() { return !!this.#decisionGateway; }

  /** The facts the model sees. No LLM output, so the two picks stay independent. */
  static stateFor(txn) {
    const amount = Number(txn.amount);
    return {
      description: txn.description || '',
      type: txn.type || txn.transactionType || null,
      amount: Number.isFinite(amount) ? Math.abs(amount) : null,
      account: txn.accountName || null,
      date: txn.date || null,
    };
  }

  /**
   * @param {Object} txn - Transaction (provider shape)
   * @param {string[]} validTags
   * @returns {Promise<null|{category: string|null, confidence: number|null, model: string|null, ms: number, cjk: boolean}>}
   */
  async judge(txn, validTags) {
    if (!this.#decisionGateway) return null;
    const tags = [...new Set(validTags || [])].filter(Boolean);
    if (tags.length < 2) return null;

    const state = TransactionCategoryJudge.stateFor(txn);
    const startedAt = Date.now();
    try {
      const result = await this.#decisionGateway.evaluate(state, { category: choice(INSTRUCTIONS, tags) },
        { timeout: this.#timeoutMs });
      const answer = result?.answers?.category;
      return {
        category: tags.includes(answer?.choice) ? answer.choice : null,
        confidence: answer?.confidence ?? null,
        model: result?.model ?? null,
        ms: Date.now() - startedAt,
        cjk: CJK.test(state.description),
      };
    } catch (error) {
      this.#logger.warn?.('categorization.jev.failed', { id: txn.id ?? null, error: error.message, ms: Date.now() - startedAt });
      return null;
    }
  }
}

export default TransactionCategoryJudge;
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run backend/src/3_applications/finance/TransactionCategoryJudge.test.mjs
```

Expected: `Tests 6 passed`.

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/TransactionCategoryJudge.mjs backend/src/3_applications/finance/TransactionCategoryJudge.test.mjs
git commit -m "$(cat <<'EOF'
feat(finance): TransactionCategoryJudge, Jev choice over validTags

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Shadow Jev beside the LLM on both apply and preview

**Files:**
- Modify: `backend/src/3_applications/finance/TransactionCategorizationService.mjs`: imports (:15), fields and constructor (:17-55), the `#categorizeTransaction` calls in `categorize()` (:92) and `preview()` (:209), the `processed.push` (:107-113) and `suggestions.push` (:212-219) objects, and `#categorizeTransaction` (:333-387, replaced)
- Test: `tests/isolated/flow/finance/TransactionCategorizationService.test.mjs` (append a `describe`)

**Step 1: Write the failing test**

```js
  describe('Jev category shadow', () => {
    let decisionGateway;
    const jevSays = (category, confidence) => decisionGateway.evaluate.mockResolvedValue({
      model: 'jev-test-1', usage: {},
      answers: { category: { type: 'choice', choice: category, confidence, probabilities: { [category]: confidence } } },
    });
    const compareLogs = () => mockLogger.info.mock.calls
      .filter(([event]) => event === 'categorization.jev.compare').map(([, data]) => data);
    const walmart = () => [{ id: '1', date: '2026-01-01', description: 'WALMART #1234', tagNames: [] }];

    beforeEach(() => {
      decisionGateway = { isConfigured: () => true, evaluate: vi.fn() };
      service = new TransactionCategorizationService({
        aiGateway: mockAIGateway, transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore, decisionGateway, logger: mockLogger,
      });
    });

    it('logs both picks and keeps the LLM category on the apply path', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Shopping', 0.95);

      const result = await service.categorize(walmart());

      expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith('1', { description: 'Walmart', tags: 'Groceries', memo: null });
      expect(compareLogs()).toEqual([expect.objectContaining({
        id: '1', path: 'apply', mode: 'shadow', llmCategory: 'Groceries', llmValid: true,
        jevCategory: 'Shopping', confidence: 0.95, agreed: false, via: 'llm', model: 'jev-test-1', cjk: false,
      })]);
    });

    it('logs the same comparison on the preview path and writes nothing', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.7);

      const result = await service.preview(walmart());

      expect(result.suggestions[0]).toMatchObject({ suggestedCategory: 'Groceries', categoryVia: 'llm' });
      expect(mockTransactionSource.updateTransaction).not.toHaveBeenCalled();
      expect(compareLogs()).toEqual([expect.objectContaining({ path: 'preview', agreed: true, confidence: 0.7 })]);
    });

    it('still compares when the LLM category is invalid, and the row still fails in shadow', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: '', friendlyName: 'PayPal' });
      jevSays('Shopping', 0.9);

      const result = await service.categorize(walmart());

      expect(result.failed[0].reason).toBe('Invalid category: ');
      expect(compareLogs()).toEqual([expect.objectContaining({ llmCategory: '', llmValid: false, jevCategory: 'Shopping', agreed: false, via: null })]);
    });

    it('a Jev failure leaves the legacy result untouched', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      decisionGateway.evaluate.mockRejectedValue(new Error('jev down'));

      const result = await service.categorize(walmart());

      expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      expect(compareLogs()).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith('categorization.jev.failed', expect.objectContaining({ error: 'jev down' }));
    });

    it('mode off asks Jev nothing', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'off' } });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });

      await service.categorize(walmart());

      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    });

    it('asks Jev while the LLM is still thinking', async () => {
      let releaseLlm;
      mockAIGateway.chatWithJson.mockReturnValue(new Promise((resolve) => { releaseLlm = resolve; }));
      jevSays('Groceries', 0.9);

      const pending = service.categorize(walmart());
      await vi.waitFor(() => expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1));
      releaseLlm({ category: 'Groceries', friendlyName: 'Walmart' });

      expect((await pending).processed).toHaveLength(1);
    });
  });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs -t "Jev category shadow"
```

Expected: FAIL. `categoryVia` is undefined, `compareLogs()` is `[]`, and `evaluate` is never called.

**Step 3: Minimal implementation**

After the `ValidationError` import (:15):

```js
import { TransactionCategoryJudge } from './TransactionCategoryJudge.mjs';

// jev.mode in the categorization config: shadow (default) logs Jev beside the
// LLM; promote lets Jev's category win at confidence >= confidenceFloor; off asks nothing.
const JEV_MODES = new Set(['shadow', 'promote', 'off']);
const DEFAULT_JEV_FLOOR = 0.8;
```

Add a field `#categoryJudge;` after `#logger;`. Change the constructor signature and tail (:41, :54):

```js
  constructor({ aiGateway, transactionSource, financeStore, decisionGateway = null, logger }) {
    // ... existing checks and assignments unchanged ...
    this.#logger = logger || console;
    this.#categoryJudge = new TransactionCategoryJudge({ decisionGateway, logger: this.#logger });
  }
```

Also add `@param {Object} [deps.decisionGateway] - IDecisionGateway (optional; Jev category shadow/promotion)` to the constructor JSDoc.

In `categorize()`, after the destructure (:71), add `const policy = this.#jevPolicy(config);` and change the call at :92 to:

```js
        const result = await this.#categorizeTransaction(txn, validTags, chatTemplate, { policy, path: 'apply' });
```

Add `categoryVia: result.categoryVia` to the `processed.push({...})` object (:107-113) and to the `categorization.success` log data (:115-120).

In `preview()`, after the destructure (:174), add `const policy = this.#jevPolicy(config);`, change the call at :209 to:

```js
        const result = await this.#categorizeTransaction(txn, validTags, chatTemplate, { policy, path: 'preview' });
```

and add `categoryVia: result.categoryVia` to the `suggestions.push({...})` object (:212-219).

Replace `#categorizeTransaction` (:325-387, including its JSDoc) with:

```js
  #jevPolicy(config) {
    const jev = config?.jev || {};
    return {
      mode: JEV_MODES.has(jev.mode) ? jev.mode : 'shadow',
      floor: Number.isFinite(jev.confidenceFloor) ? jev.confidenceFloor : DEFAULT_JEV_FLOOR,
    };
  }

  /**
   * Categorize one transaction: the LLM names it (and proposes a category);
   * Jev independently picks a category from validTags, in parallel. Both
   * the apply and the preview path come through here, so they decide alike.
   *
   * @returns {Promise<Object>} { success, friendlyName, category, categoryVia, memo, originalDescription } | { success:false, reason, originalDescription }
   */
  async #categorizeTransaction(transaction, validTags, chatTemplate, { policy, path }) {
    const { description, id } = transaction;
    const jevPending = policy.mode === 'off'
      ? Promise.resolve(null)
      : this.#categoryJudge.judge(transaction, validTags);
    const llm = await this.#askLlm(transaction, validTags, chatTemplate);
    const jev = await jevPending;
    const outcome = this.#decide(llm, jev, validTags, policy, description);

    if (jev) {
      this.#log('info', 'categorization.jev.compare', {
        id, path, mode: policy.mode, floor: policy.floor,
        llmCategory: llm.category ?? null,
        llmValid: validTags.includes(llm.category),
        jevCategory: jev.category,
        confidence: jev.confidence,
        agreed: jev.category != null && jev.category === llm.category,
        via: outcome.success ? outcome.categoryVia : null,
        cjk: jev.cjk, model: jev.model, jevMs: jev.ms,
      });
    }
    return outcome;
  }

  async #askLlm(transaction, validTags, chatTemplate) {
    const messages = chatTemplate.map(msg => {
      if (msg.role === 'system' && msg.content.includes('__VALID_TAGS__')) {
        return { role: msg.role, content: msg.content.replace('__VALID_TAGS__', JSON.stringify(validTags)) };
      }
      return msg;
    });
    messages.push({ role: 'user', content: transaction.description });

    try {
      const response = await this.#aiGateway.chatWithJson(messages);
      return { category: response?.category, friendlyName: response?.friendlyName, memo: response?.memo };
    } catch (error) {
      this.#logger.warn?.('categorization.ai.failed', { transactionId: transaction.id, error: error.message });
      return { error: error.message };
    }
  }

  #decide(llm, jev, validTags, policy, originalDescription) {
    if (llm.error) return { success: false, reason: `AI error: ${llm.error}`, originalDescription };
    if (!llm.friendlyName) return { success: false, reason: 'AI did not provide a friendly name', originalDescription };
    if (!validTags.includes(llm.category)) {
      return { success: false, reason: `Invalid category: ${llm.category}`, originalDescription };
    }
    return {
      success: true, friendlyName: llm.friendlyName, category: llm.category, categoryVia: 'llm',
      memo: llm.memo || null, originalDescription,
    };
  }
```

(`jev` and `policy` go unused in `#decide` until Task 4. That is intentional; Task 4 adds the promote branch there.)

**Step 4: Run it and watch it pass**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs tests/isolated/adapter/harvester/finance/FinanceCategorization.test.mjs tests/isolated/flow/finance/FinanceHarvestService.test.mjs
```

Expected: all pass (21 in the service file). The legacy tests pass because a service built without `decisionGateway` never calls a judge.

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/TransactionCategorizationService.mjs tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
git commit -m "$(cat <<'EOF'
feat(finance): shadow Jev category beside the LLM on categorize and preview

Logs categorization.jev.compare {llmCategory, jevCategory, confidence,
agreed}; the LLM result and Buxfer writes are unchanged.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Promotion flag (`jev.mode: promote`)

**Files:**
- Modify: `backend/src/3_applications/finance/TransactionCategorizationService.mjs` (`#decide`, added in Task 3)
- Test: `tests/isolated/flow/finance/TransactionCategorizationService.test.mjs` (nest inside the `Jev category shadow` describe)

**Step 1: Write the failing test**

```js
    describe('promote mode', () => {
      beforeEach(() => {
        mockFinanceStore.getCategorizationConfig.mockReturnValue({
          ...mockCategorizationConfig, jev: { mode: 'promote', confidenceFloor: 0.8 },
        });
      });

      it('Jev category wins at the floor; the LLM still names and memos', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart', memo: 'Weekly' });
        jevSays('Shopping', 0.8);

        const result = await service.categorize(walmart());

        expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith('1', { description: 'Walmart', tags: 'Shopping', memo: 'Weekly' });
        expect(result.processed[0]).toMatchObject({ category: 'Shopping', categoryVia: 'jev' });
        expect(compareLogs()).toEqual([expect.objectContaining({ mode: 'promote', via: 'jev', agreed: false })]);
      });

      it('below the floor the LLM category stands', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.79);

        const result = await service.categorize(walmart());

        expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      });

      it('rescues a blank LLM category when Jev is confident', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: '', friendlyName: 'PayPal' });
        jevSays('Shopping', 0.9);

        const result = await service.categorize(walmart());

        expect(result.failed).toEqual([]);
        expect(result.processed[0]).toMatchObject({ friendlyName: 'PayPal', category: 'Shopping', categoryVia: 'jev' });
      });

      it('cannot rescue a missing friendly name', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Shopping' });
        jevSays('Shopping', 0.99);

        const result = await service.categorize(walmart());

        expect(result.failed[0].reason).toBe('AI did not provide a friendly name');
      });

      it('preview promotes exactly as apply does', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.9);

        const result = await service.preview(walmart());

        expect(result.suggestions[0]).toMatchObject({ suggestedCategory: 'Shopping', categoryVia: 'jev' });
      });

      it('an invalid confidenceFloor falls back to 0.8', async () => {
        mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'promote', confidenceFloor: 'high' } });
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.75);

        const result = await service.categorize(walmart());

        expect(result.processed[0].categoryVia).toBe('llm');
        expect(compareLogs()[0].floor).toBe(0.8);
      });
    });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs -t "promote mode"
```

Expected: FAIL. The first test gets `tags: 'Groceries'`, and the blank-category rescue lands in `failed`.

**Step 3: Minimal implementation**

In `#decide`, insert this after the `!llm.friendlyName` line and before the `validTags.includes(llm.category)` check:

```js
    if (policy.mode === 'promote' && jev?.category && jev.confidence >= policy.floor) {
      return {
        success: true, friendlyName: llm.friendlyName, category: jev.category, categoryVia: 'jev',
        memo: llm.memo || null, originalDescription,
      };
    }
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
```

Expected: all pass (27).

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/TransactionCategorizationService.mjs tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
git commit -m "$(cat <<'EOF'
feat(finance): jev.mode promote lets a confident Jev category win

The LLM still supplies friendlyName and memo. A blank or invalid LLM
category is rescued when Jev clears the floor. Default stays shadow.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Make preview decide the same rows as apply

`preview()` re-implements rule matching and does not simulate the rename, so it can suggest a rule and an LLM category for one transaction that apply would send once, or not at all. This task shares the rule matcher and simulates the rule on a copy.

**Files:**
- Modify: `backend/src/3_applications/finance/TransactionCategorizationService.mjs`: rule block in `preview()` (:176-202) and `#applyDescriptionRules` (:250-300)
- Test: `tests/isolated/flow/finance/TransactionCategorizationService.test.mjs` (append inside the existing `describe('preview')`)

**Step 1: Write the failing test**

```js
    it('previews a rule-tagged transaction once, without asking the LLM (as apply does)', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({
        ...mockCategorizationConfig, descriptionRules: [{ pattern: 'CASH SWEEP', rename: 'Cash Sweep', tag: 'Transfer' }],
      });
      const transactions = [{ id: '1', date: '2026-01-01', description: 'FIDELITY CASH SWEEP Xx1234', tagNames: [] }];

      const result = await service.preview(transactions);

      expect(result.suggestions).toEqual([expect.objectContaining({ id: '1', source: 'rule', suggestedName: 'Cash Sweep', suggestedCategory: 'Transfer' })]);
      expect(mockAIGateway.chatWithJson).not.toHaveBeenCalled();
      expect(transactions[0].description).toBe('FIDELITY CASH SWEEP Xx1234');
    });

    it('a rule without a tag sends the renamed description to the LLM, as apply does', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({
        ...mockCategorizationConfig, descriptionRules: [{ pattern: 'ACME', rename: 'Acme' }],
      });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Shopping', friendlyName: 'Acme' });

      const result = await service.preview([{ id: '1', date: '2026-01-01', description: 'ACME STORE 42', tagNames: [] }]);

      const messages = mockAIGateway.chatWithJson.mock.calls[0][0];
      expect(messages.at(-1)).toEqual({ role: 'user', content: 'Acme' });
      expect(result.suggestions.map(s => s.source ?? 'llm')).toEqual(['rule', 'llm']);
    });
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs -t "preview"
```

Expected: FAIL. The first test gets two suggestions and `chatWithJson` is called. The second test's last message is `'ACME STORE 42'`.

**Step 3: Minimal implementation**

Add two private helpers (next to `#applyDescriptionRules`):

```js
  #compileRules(rules) {
    return (rules || []).map(r => ({ pattern: new RegExp(r.pattern, 'i'), rename: r.rename, tag: r.tag }));
  }

  /** First matching rule wins; a description already equal to its rename matches nothing. */
  #matchRule(description, compiled) {
    const rule = compiled.find(r => r.pattern.test(description));
    return rule && description !== rule.rename ? rule : null;
  }
```

Rewrite the body of `#applyDescriptionRules` (:250-300) to use them. Behaviour is unchanged:

```js
  #applyDescriptionRules(transactions, rules) {
    const compiled = this.#compileRules(rules);
    if (!compiled.length) return [];
    const applied = [];

    for (const txn of transactions) {
      const originalDescription = txn.description || '';
      const rule = this.#matchRule(originalDescription, compiled);
      if (!rule) continue;

      txn.description = rule.rename;
      if (rule.tag) {
        txn.tagNames = [rule.tag];
        txn.tags = rule.tag;
      }

      // Update in external source (fire and forget)
      const update = { description: rule.rename };
      if (rule.tag) update.tags = rule.tag;
      this.#transactionSource.updateTransaction(txn.id, update).catch(err => {
        this.#log('error', 'categorization.rule.updateFailed', { id: txn.id, error: err.message });
      });

      applied.push({ id: txn.id, date: txn.date, originalDescription, friendlyName: rule.rename, category: rule.tag || txn.tagNames?.[0] });
      this.#log('info', 'categorization.rule.applied', { id: txn.id, from: originalDescription, to: rule.rename });
    }

    return applied;
  }
```

In `preview()`, replace the rule block and the `needsProcessing` line (:176-202) with:

```js
    // Simulate each rule on a copy, so the LLM step sees exactly the rows (and
    // descriptions) that categorize() would send. Preview never mutates input.
    const compiled = this.#compileRules(descriptionRules);
    const ruleMatches = [];
    const simulated = transactions.map(txn => {
      const desc = txn.description || '';
      const rule = this.#matchRule(desc, compiled);
      if (!rule) return txn;
      ruleMatches.push({
        id: txn.id, date: txn.date, originalDescription: desc,
        suggestedName: rule.rename, suggestedCategory: rule.tag || txn.tagNames?.[0], source: 'rule',
      });
      return { ...txn, description: rule.rename, ...(rule.tag ? { tagNames: [rule.tag], tags: rule.tag } : {}) };
    });

    const needsProcessing = simulated.filter(txn => this.#needsCategorization(txn));
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run tests/isolated/flow/finance/TransactionCategorizationService.test.mjs tests/isolated/adapter/harvester/finance/FinanceCategorization.test.mjs
```

Expected: all pass (29 in the service file).

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/TransactionCategorizationService.mjs tests/isolated/flow/finance/TransactionCategorizationService.test.mjs
git commit -m "$(cat <<'EOF'
fix(finance): preview simulates description rules like categorize does

One matcher for both paths; preview no longer suggests a rule and an LLM
category for the same row, and the LLM sees the renamed description.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `decisionGateway` through the composition root

**Files:**
- Modify: `backend/src/5_composition/bootstrap.mjs`: JSDoc (:1174-1181), destructure (:1184-1191), construction and enabled log (:1212-1218)
- Modify: `backend/src/app.mjs:1320-1329` (the `createFinanceServices({...})` call)
- Test (create): `tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFinanceServices } from '#composition/bootstrap.mjs';

describe('createFinanceServices: categorization decision gateway', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-wiring-'));
    fs.writeFileSync(path.join(dir, 'gpt.yml'),
      'validTags: [Groceries, Shopping]\nchat:\n  - role: system\n    content: "Tags: __VALID_TAGS__"\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes the decision gateway into the categorization service', async () => {
    const decisionGateway = {
      isConfigured: () => true,
      evaluate: vi.fn().mockResolvedValue({
        model: 'jev-test-1', usage: {},
        answers: { category: { type: 'choice', choice: 'Groceries', confidence: 0.9, probabilities: {} } },
      }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const { categorizationService } = createFinanceServices({
      configService: { getHouseholdPath: () => dir },
      buxferAdapter: { updateTransaction: vi.fn() },
      aiGateway: { chatWithJson: vi.fn().mockResolvedValue({ category: 'Groceries', friendlyName: 'Costco' }) },
      decisionGateway,
      defaultHouseholdId: 'default',
      logger,
    });

    await categorizationService.preview([{ id: '1', date: '2026-01-01', description: 'COSTCO #567', tagNames: [] }], 'default');

    expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('finance.categorization.enabled', { validTags: 2, jev: true });
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs
```

Expected: FAIL. `evaluate` is called 0 times, and the enabled log lacks `jev`.

**Step 3: Minimal implementation**

In `bootstrap.mjs`, add `@param {Object} [config.decisionGateway] - IDecisionGateway for the Jev category judge (optional)` to the JSDoc, add `decisionGateway = null,` to the destructure after `aiGateway,`, and change :1212-1218 to:

```js
      categorizationService = new TransactionCategorizationService({
        aiGateway,
        transactionSource: buxferAdapter,
        financeStore,
        decisionGateway,
        logger
      });
      logger.info?.('finance.categorization.enabled', {
        validTags: categorizationConfig.validTags?.length || 0,
        jev: !!decisionGateway && decisionGateway.isConfigured?.() !== false
      });
```

In `app.mjs`, inside the `createFinanceServices({...})` call (:1320-1329), after the `aiGateway:` line add:

```js
    // Typed-decision model: Jev category judge (shadow unless the finance config promotes it)
    decisionGateway,
```

**Step 4: Run it and watch it pass, then run the layer audit**

```bash
npx vitest run tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs tests/isolated/assembly/infrastructure/bootstrap.test.mjs
npm run audit:layers
```

Expected: tests pass, and the audit reports no new violations.

**Step 5: Commit**

```bash
git add backend/src/5_composition/bootstrap.mjs backend/src/app.mjs tests/isolated/assembly/infrastructure/financeBootstrap.test.mjs
git commit -m "$(cat <<'EOF'
feat(finance): pass decisionGateway into transaction categorization

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Offline replay CLI, the main promotion evidence

Prod shadow sees about 26 decisions a week against a 7-day log store. The replay runs the same judge over a period's already-tagged transactions (read-only) and reports agreement with the existing tag. Caveat, which also goes in the doc: stored descriptions are already cleaned friendly names, so replay is easier than production. Treat it as an upper bound and confirm with prod shadow.

**Files:**
- Create: `cli/finance-jev-replay.cli.mjs`
- Test: `cli/finance-jev-replay.cli.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { runReplay, summarize } from './finance-jev-replay.cli.mjs';

const TAGS = ['Groceries', 'Fuel', 'Shopping'];

describe('finance-jev-replay', () => {
  it('scores Jev against the existing tag, overall and at the floor', async () => {
    const picks = { a: ['Groceries', 0.95], b: ['Shopping', 0.9], c: ['Fuel', 0.5] };
    const judge = { judge: vi.fn(async (txn) => ({ category: picks[txn.id][0], confidence: picks[txn.id][1], cjk: false })) };
    const transactions = [
      { id: 'a', description: 'Safeway', tagNames: ['Groceries'] },
      { id: 'b', description: 'Chevron', tagNames: ['Fuel'] },
      { id: 'c', description: 'Shell', tagNames: ['Fuel'] },
      { id: 'd', description: 'Untagged', tagNames: [] },
      { id: 'e', description: 'Odd tag', tagNames: ['Car Rental'] },
    ];

    const summary = await runReplay({ transactions, validTags: TAGS, judge, floor: 0.8 });

    expect(judge.judge).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ total: 3, judged: 3, confident: 2, agreementAtFloor: 0.5 });
    expect(summary.agreement).toBeCloseTo(2 / 3);
    expect(summary.coverage).toBeCloseTo(2 / 3);
    expect(summary.disagreements).toEqual([['Fuel -> Shopping', 1]]);
  });

  it('respects the limit', async () => {
    const judge = { judge: vi.fn(async () => ({ category: 'Fuel', confidence: 0.9, cjk: false })) };
    const transactions = Array.from({ length: 5 }, (_, i) => ({ id: i, description: 'Shell', tagNames: ['Fuel'] }));
    expect((await runReplay({ transactions, validTags: TAGS, judge, limit: 2 })).total).toBe(2);
  });

  it('counts a failed judgement as unjudged', () => {
    expect(summarize([{ tag: 'Fuel', jevCategory: null, confidence: null, cjk: false }], 0.8))
      .toMatchObject({ total: 1, judged: 0, agreement: null, coverage: 0, agreementAtFloor: null });
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run cli/finance-jev-replay.cli.test.mjs
```

Expected: FAIL with `Failed to load url ./finance-jev-replay.cli.mjs`.

**Step 3: Minimal implementation**

```js
#!/usr/bin/env node
/**
 * finance-jev-replay: measure the Jev category judge against transactions
 * the household has already tagged. Read-only: nothing is written to the
 * finance provider or the finance store.
 *
 * Prod shadow (categorization.jev.compare) sees ~26 decisions a week and the
 * log store keeps 7 days, so this replay is the main promotion evidence.
 * Stored descriptions are already cleaned friendly names, which is easier
 * than the raw descriptions Jev sees live: treat results as an upper bound.
 *
 * Usage: node cli/finance-jev-replay.cli.mjs [--period YYYY-MM-DD] [--limit 200] [--floor 0.8] [--household <id>]
 */
import { pathToFileURL } from 'node:url';
import { TransactionCategoryJudge } from '#apps/finance/TransactionCategoryJudge.mjs';

export function summarize(rows, floor) {
  const judged = rows.filter(r => r.jevCategory != null);
  const confident = judged.filter(r => r.confidence >= floor);
  const rate = (list) => (list.length ? list.filter(r => r.jevCategory === r.tag).length / list.length : null);
  const counts = {};
  for (const r of confident) {
    if (r.jevCategory === r.tag) continue;
    const key = `${r.tag} -> ${r.jevCategory}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const cjk = judged.filter(r => r.cjk);
  return {
    total: rows.length,
    judged: judged.length,
    agreement: rate(judged),
    confident: confident.length,
    coverage: rows.length ? confident.length / rows.length : null,
    agreementAtFloor: rate(confident),
    cjk: { judged: cjk.length, agreement: rate(cjk) },
    disagreements: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15),
  };
}

export async function runReplay({ transactions, validTags, judge, floor = 0.8, limit = 200 }) {
  const sample = transactions
    .filter(t => t.tagNames?.length === 1 && validTags.includes(t.tagNames[0]))
    .slice(0, limit);
  const rows = [];
  for (const txn of sample) {
    const verdict = await judge.judge(txn, validTags);
    rows.push({
      id: txn.id, tag: txn.tagNames[0],
      jevCategory: verdict?.category ?? null, confidence: verdict?.confidence ?? null, cjk: verdict?.cjk ?? false,
    });
  }
  return summarize(rows, floor);
}

function parseArgs(argv) {
  const options = { period: null, limit: 200, floor: 0.8, household: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--period') options.period = argv[++i];
    else if (flag === '--limit') options.limit = Number(argv[++i]);
    else if (flag === '--floor') options.floor = Number(argv[++i]);
    else if (flag === '--household') options.household = argv[++i];
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const [{ getConfigService }, { YamlFinanceDatastore }, { JevAdapter }, { default: axios }] = await Promise.all([
    import('./_bootstrap.mjs'),
    import('#adapters/persistence/yaml/YamlFinanceDatastore.mjs'),
    import('#adapters/ai/JevAdapter.mjs'),
    import('axios'),
  ]);
  const configService = await getConfigService();
  const apiKey = configService.getSystemAuth('jev', 'api_key');
  if (!apiKey) throw new Error('No Jev key: system auth jev.api_key is not set');

  const householdId = options.household || configService.getDefaultHouseholdId();
  const store = new YamlFinanceDatastore({ configService });
  const { validTags } = store.getCategorizationConfig(householdId) || {};
  if (!validTags?.length) throw new Error('No categorization config (validTags)');
  const period = options.period || store.listBudgetPeriods(householdId).at(-1);
  const transactions = store.getTransactions(period, householdId) || [];

  const quiet = { info() {}, warn() {}, debug() {}, error() {}, child() { return quiet; } };
  const judge = new TransactionCategoryJudge({
    decisionGateway: new JevAdapter({ apiKey }, { httpClient: axios, logger: quiet }),
    logger: quiet,
  });
  const summary = await runReplay({ transactions, validTags, judge, floor: options.floor, limit: options.limit });
  process.stdout.write(`${JSON.stringify({ householdId, period, floor: options.floor, ...summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
```

**Step 4: Run it and watch it pass, then run one real replay**

```bash
npx vitest run cli/finance-jev-replay.cli.test.mjs
node cli/finance-jev-replay.cli.mjs --limit 50
```

Expected: `Tests 3 passed`. The real run prints a JSON summary with `judged ≈ 50`. It costs Jev input tokens only, and the replay's calls are not recorded in the AI usage ledger. Record the numbers in the reference doc (Task 9) as the first baseline.

**Step 5: Commit**

```bash
git add cli/finance-jev-replay.cli.mjs cli/finance-jev-replay.cli.test.mjs
git commit -m "$(cat <<'EOF'
feat(cli): finance-jev-replay measures the Jev category judge on tagged history

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Correct the categorization prompt's few-shot categories (data, not code)

The live `chat` examples answer with `Health`, `Dining` and `Car Rental`, none of which is in `validTags`. The system prompt also tells the model to *leave it blank* when unsure, which produced the one `Invalid category: ""` failure this week. This task fixes the household data file. It is not in git, so there is no commit.

**Files:**
- Modify: the household finance categorization config (`gpt.yml` in the household `finance` directory, as resolved by `configService.getHouseholdPath('finance')`). Edit through the prod host if the local mount refuses writes (see `CLAUDE.md` › Mount Permissions).

**Step 1:** Change three assistant examples:
- `{category: "Health", friendlyName: "Noom"}` → `{category: "Health & Wellness", friendlyName: "Noom"}`
- `{category: "Dining", friendlyName: "Doordash", ...}` → `{category: "Food & Dining", ...}`
- `{category: "Car Rental", friendlyName: "쏘카 Car Rental", ...}` → `{category: "Travel", ...}`

In the system message, replace `If the transaction is not in the list, leave it blank.` with `Always choose the closest category from the list.`

**Step 2:** Add the explicit (default) Jev block at the top level so the switch is discoverable:

```yaml
jev:
  mode: shadow          # shadow | promote | off
  confidenceFloor: 0.8  # promote only: Jev's category wins at or above this
```

**Step 3:** Check that it parses and that every example category is valid:

```bash
node -e "const y=require('js-yaml'),f=require('fs');const d=y.load(f.readFileSync(process.argv[1],'utf8'));const bad=d.chat.filter(m=>m.role==='assistant').map(m=>(m.content.match(/category:\s*\"([^\"]*)\"/)||[])[1]).filter(c=>!d.validTags.includes(c));console.log({jev:d.jev,bad})" "<path to gpt.yml>"
```

Expected: `{ jev: { mode: 'shadow', confidenceFloor: 0.8 }, bad: [] }`.

---

## Task 9: Docs

**Files:**
- Create: `docs/reference/finance/categorization.md`
- Modify: `docs/reference/core/configuration.md`: the "Typed decisions" paragraph (~:173-180)
- Modify: `CLAUDE.md`: the Navigation table (add a row)

**Step 1:** Write `docs/reference/finance/categorization.md` with these sections, using the content of this plan:
1. *Pipeline*: description rules → `#needsCategorization` (no tag, or raw pattern; settled rows skipped) → LLM names the transaction and Jev picks the category in parallel → Buxfer write. State that apply (`categorize`) and dry run (`preview`) go through the same rule matcher and the same `#categorizeTransaction`.
2. *Config* (household finance `gpt.yml`): `validTags`, `chat` (with `__VALID_TAGS__`), `descriptionRules`, and `jev.mode` / `jev.confidenceFloor`. It is read on every run, so no restart is needed.
3. *Jev question*: the exact `choice` instructions and `state` shape from "Questions for Jev". Note that there is no merchant field.
4. *Observability*: the events `categorization.jev.compare` (all fields), `categorization.jev.failed`, `categorization.settled`, and the two LogsQL queries from Rollout. Use `{env.log_store_url}`, never a host.
5. *Promotion*: the criteria from Rollout, the replay CLI usage and its upper-bound caveat, and the baseline numbers from the Task 7 run.
6. *Known limits*: the settled map is in-process (one re-ask per restart), CJK accuracy is weaker, and `BuxferAdapter.processTransactions` is an unused legacy loop.

**Step 2:** In `configuration.md`, append to the Typed decisions paragraph:

```markdown
Consumers today: nutrition icon choice and audit triage, the card-ladder typed
judge (shadow), and finance transaction categorization (`TransactionCategoryJudge`,
shadow by default; `jev.mode` in the household finance `gpt.yml`, see
`docs/reference/finance/categorization.md`).
```

**Step 3:** Add this row to the CLAUDE.md Navigation table:

```markdown
| Finance transaction categorization (rules, LLM naming, Jev category shadow/promote) | `docs/reference/finance/categorization.md` |
```

**Step 4: Commit**

```bash
git add docs/reference/finance/categorization.md docs/reference/core/configuration.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(finance): categorization pipeline and Jev category rollout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full verification for touched directories

```bash
npx vitest run backend/src/3_applications/finance tests/isolated/flow/finance tests/isolated/adapter/harvester/finance tests/isolated/api/routers/finance.test.mjs tests/isolated/assembly/infrastructure cli/finance-jev-replay.cli.test.mjs
npm run audit:layers
```

Expected: every file passes, and the layer audit reports no new violations. Do not start a second backend to check the wiring. If a dev server is already running from this branch, confirm `finance.categorization.enabled` logs `jev: true` on boot, and that a `POST` categorize with `preview: true` emits `categorization.jev.compare`. Then merge `feat/finance-categorization` into `main` per the repo's branch rules. Do not deploy.
