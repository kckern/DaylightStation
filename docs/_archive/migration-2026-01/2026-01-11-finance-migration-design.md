# Finance Domain Migration Design

## Overview

Migrate the complex budget compilation logic from `backend/_legacy/lib/budget.mjs` and `backend/_legacy/lib/budgetlib/` into the DDD architecture.

## Current State

### What's Already Migrated

| Component | Location | Status |
|-----------|----------|--------|
| BuxferAdapter | `2_adapters/finance/BuxferAdapter.mjs` | Complete |
| Budget Entity | `1_domains/finance/entities/Budget.mjs` | Basic |
| Transaction Entity | `1_domains/finance/entities/Transaction.mjs` | Basic |
| Account Entity | `1_domains/finance/entities/Account.mjs` | Complete |
| Mortgage Entity | `1_domains/finance/entities/Mortgage.mjs` | Basic |
| BudgetService | `1_domains/finance/services/BudgetService.mjs` | CRUD only |
| ITransactionSource | `1_domains/finance/ports/ITransactionSource.mjs` | Complete |

### What Needs Migration

1. **Budget Compilation** (`build_budget.mjs`, `monthly_budget.mjs`)
   - Monthly budget calculation (past/current/future)
   - Day-to-day budget tracking with daily balances
   - Short-term bucket management with flex allocation
   - Surplus distribution to flexible buckets
   - Anticipated income/expense projections

2. **Transaction Classification** (`transactions.mjs`)
   - `findBucket()` - Categorizes transactions into: income, day-to-day, monthly, short-term, transfer

3. **Data Refresh** (`budget.mjs`)
   - `refreshFinancialData()` - Fetches from Buxfer, updates all financial data
   - `compileBudget()` - Orchestrates full recompilation

4. **Mortgage Calculations** (`budget.mjs`)
   - `processMortgage()` - Calculates mortgage status
   - `processMortgagePaymentPlans()` - Projects payoff scenarios

## API Contract (Must Preserve)

### GET /data/budget
```json
{
  "budgets": {
    "2025-01-01": {
      "budgetStart": "2025-01-01",
      "budgetEnd": "2025-12-31",
      "accounts": ["Checking", "Savings"],
      "dayToDayBudget": {
        "2025-01": {
          "spending": 1234.56,
          "budget": 1500.00,
          "balance": 265.44,
          "dailyBalances": { ... },
          "daysRemaining": 15,
          "dailySpend": 45.00,
          "dailyBudget": 50.00
        }
      },
      "monthlyBudget": {
        "2025-01": {
          "income": 8000.00,
          "monthlySpending": 3000.00,
          "dayToDaySpending": 1500.00,
          "surplus": 3500.00,
          "monthlyCategories": { ... }
        }
      },
      "totalBudget": { ... },
      "shortTermBuckets": {
        "Emergency Fund": { "budget": 500, "spending": 100, "balance": 400 },
        "Vacation": { "budget": 300, "spending": 50, "balance": 250 }
      },
      "shortTermStatus": { ... },
      "transferTransactions": { ... }
    }
  },
  "mortgage": {
    "balance": 250000,
    "interestRate": 0.065,
    "totalPaid": 50000,
    "monthlyRent": 800,
    "monthlyEquity": 400,
    "paymentPlans": [ ... ],
    "transactions": [ ... ]
  }
}
```

### GET /harvest/budget
Triggers `refreshFinancialData()` → fetches from Buxfer → recompiles → returns `{ status: 'success' }`

### GET /harvest/payroll
Syncs payroll data (existing `payrollSync` job)

## Proposed Architecture

### Layer 1: Domain Services

#### TransactionClassifier (1_domains/finance/services/)
```javascript
// Extracts findBucket() logic into a pure domain service
class TransactionClassifier {
  constructor(budgetConfig) { ... }
  classify(transaction) → { label, bucket } // bucket: 'income'|'day'|'monthly'|'shortTerm'|'transfer'
}
```

#### MortgageCalculator (1_domains/finance/services/)
```javascript
// Pure calculation, no I/O
class MortgageCalculator {
  calculatePaymentPlan(principal, rate, minimumPayment, paymentSchedule) → PaymentPlan
  projectPayoff(balance, rate, paymentPlans) → PayoffProjection[]
}
```

### Layer 3: Application Services

#### BudgetCompilationService (3_applications/finance/)
```javascript
// Orchestrates the complex budget building logic
class BudgetCompilationService {
  constructor({ budgetConfigStore, transactionStore, classifier, mortgageCalculator })

  compileBudget(budgetPeriodId) → CompiledBudget
  compileAllBudgets() → { budgets: Map<string, CompiledBudget>, mortgage: Mortgage }

  // Private helpers
  #buildMonthlyBudget(month, config, transactions, isPast, isCurrent, isFuture)
  #buildDayToDayBudget(month, transactions, config)
  #buildShortTermBuckets(months, config)
  #allocateSurplus(shortTermBuckets, surplus, flexConfig)
}
```

#### FinanceHarvestService (3_applications/finance/)
```javascript
// Orchestrates data refresh from external sources
class FinanceHarvestService {
  constructor({ buxferAdapter, budgetConfigStore, transactionStore, accountStore, compilationService, logger })

  async refreshAll(options) → { status, transactionCount, accountBalances }
  async refreshTransactions(budgetPeriod) → Transaction[]
  async refreshAccountBalances(accounts) → AccountBalance[]
  async refreshMortgageTransactions(config) → Transaction[]
}
```

### Layer 4: API Router

#### finance.mjs (4_api/routers/)
```javascript
export function createFinanceRouter({ compilationService, harvestService, payrollService, configStore }) {
  router.get('/budget', async (req, res) => { ... });      // Read compiled finances.yml
  router.get('/budget/daytoday', async (req, res) => { ... });
  router.post('/harvest/budget', async (req, res) => { ... });  // Trigger refresh
  router.post('/harvest/payroll', async (req, res) => { ... });
}
```

## Data Stores

### YAML Files (existing, preserved)
- `budget.config.yml` - Budget configuration
- `finances.yml` - Compiled output (what frontend reads)
- `{date}/transactions.yml` - Fetched transactions
- `account.balances.yml` - Current balances
- `mortgage.transactions.yml` - Mortgage payments
- `transaction.memos.yml` - User annotations

### Adapter: YamlFinanceStore (2_adapters/persistence/yaml/)
```javascript
class YamlFinanceStore {
  // Budget config
  getBudgetConfig(householdId) → BudgetConfig

  // Transactions
  getTransactions(budgetPeriodId) → Transaction[]
  saveTransactions(budgetPeriodId, transactions)

  // Account balances
  getAccountBalances() → AccountBalance[]
  saveAccountBalances(balances)

  // Compiled output
  getCompiledFinances() → { budgets, mortgage }
  saveCompiledFinances(data)

  // Transaction memos
  getMemos() → Map<string, string>
  saveMemo(transactionId, memo)
}
```

## Testing Strategy

### 1. API Baseline Capture
Create a snapshot of current `/data/budget` response to use as golden file for regression testing.

```javascript
// tests/integration/finance/api-baseline.test.mjs
describe('Finance API Baseline', () => {
  it('GET /data/budget matches baseline structure', async () => {
    const response = await request(app).get('/data/budget');
    expect(response.body).toMatchSnapshot();
    // Validate structure, not values (values change)
    expect(response.body).toHaveProperty('budgets');
    expect(response.body).toHaveProperty('mortgage');
  });
});
```

### 2. Unit Tests for Calculation Logic
```javascript
// tests/unit/domains/finance/TransactionClassifier.test.mjs
// tests/unit/domains/finance/MortgageCalculator.test.mjs
// tests/unit/applications/finance/BudgetCompilationService.test.mjs
```

### 3. Integration Tests
```javascript
// tests/integration/finance/budget-compilation.test.mjs
// tests/integration/finance/harvest-service.test.mjs
```

## Migration Steps

### Phase 1: Domain Layer
1. Create `TransactionClassifier` service
2. Enhance `MortgageCalculator` service
3. Add unit tests

### Phase 2: Application Layer
4. Create `BudgetCompilationService`
5. Create `FinanceHarvestService`
6. Create `YamlFinanceStore` adapter
7. Add integration tests

### Phase 3: API Layer
8. Create `finance.mjs` router
9. Add API baseline tests
10. Wire up in bootstrap.mjs

### Phase 4: Cleanup
11. Remove legacy imports
12. Update documentation

## AI-Based Transaction Categorization

The legacy `processTransactions()` in `buxfer.mjs` uses GPT-4o to auto-categorize uncategorized transactions:

### Current Flow (Legacy)
```javascript
// buxfer.mjs:176-191
const {validTags, chat} = yaml.load(`gpt.yml`);
for (txn of uncategorizedTransactions) {
  const gpt_input = [...chat, {role:"user", content: txn.description}];
  const result = await askGPT(gpt_input, 'gpt-4o', { response_format: { type: "json_object" }});
  const { category, friendlyName, memo } = JSON.parse(result);
  await updateTransaction(id, friendlyName, category, memo);
}
```

### Migrated Design (Using IAIGateway)

#### TransactionCategorizationService (3_applications/finance/)
```javascript
import { systemMessage, userMessage } from '../../_legacy/lib/ai/IAIGateway.mjs';

class TransactionCategorizationService {
  constructor({ aiGateway, validTags, systemPrompt, logger }) {
    this.aiGateway = aiGateway;
    this.validTags = validTags;
    this.systemPrompt = systemPrompt.replace('__VALID_TAGS__', JSON.stringify(validTags));
    this.logger = logger;
  }

  async categorize(transaction) {
    const messages = [
      systemMessage(this.systemPrompt),
      userMessage(transaction.description)
    ];

    const result = await this.aiGateway.chatWithJson(messages, {
      model: 'gpt-4o'
    });

    return {
      category: result.category,
      friendlyName: result.friendlyName,
      memo: result.memo
    };
  }

  needsCategorization(transaction) {
    const hasNoTag = !transaction.tags?.length;
    const hasRawDescription = /(^Direct|Pwp|^xx|as of|\*|（|Privacycom)/i.test(transaction.description);
    return hasNoTag || hasRawDescription;
  }

  async categorizeAll(transactions) {
    const uncategorized = transactions.filter(t => this.needsCategorization(t));
    const results = [];

    for (const txn of uncategorized) {
      try {
        const categorization = await this.categorize(txn);
        if (this.validTags.includes(categorization.category)) {
          results.push({ transactionId: txn.id, ...categorization });
        }
      } catch (error) {
        this.logger.error?.('finance.categorize.failed', { id: txn.id, error: error.message });
      }
    }

    return results;
  }
}
```

#### Configuration (gpt.yml)
```yaml
validTags:
  - Groceries
  - Dining
  - Gas
  - Shopping
  - ...

chat:
  - role: system
    content: |
      You are a transaction categorizer. Given a transaction description,
      return JSON with: category (from __VALID_TAGS__), friendlyName, memo.
```

#### Updated FinanceHarvestService
```javascript
class FinanceHarvestService {
  constructor({
    buxferAdapter,
    categorizationService,  // NEW
    budgetConfigStore,
    transactionStore,
    ...
  }) { ... }

  async refreshTransactions(budgetPeriod, { autoCategorize = true } = {}) {
    const transactions = await this.buxferAdapter.getTransactions(...);

    if (autoCategorize) {
      const categorizations = await this.categorizationService.categorizeAll(transactions);
      for (const cat of categorizations) {
        await this.buxferAdapter.updateTransaction(cat.transactionId, {
          description: cat.friendlyName,
          tags: cat.category,
          memo: cat.memo
        });
      }
    }

    return transactions;
  }
}
```

## Dependencies

- **BuxferAdapter** - Already exists in `2_adapters/finance/`
- **IAIGateway** - Required for transaction categorization (use existing interface)
- **OpenAIAdapter** - Concrete implementation of IAIGateway
- **YamlSessionStore pattern** - Follow existing pattern for YAML persistence

## Implementation Status

### Phase 1: Domain Layer - COMPLETE

| Component | File | Status |
|-----------|------|--------|
| TransactionClassifier | `1_domains/finance/services/TransactionClassifier.mjs` | Complete |
| MortgageCalculator | `1_domains/finance/services/MortgageCalculator.mjs` | Complete |
| Unit Tests | `tests/unit/domains/finance/services/` | Complete |

**Key Implementation Notes:**
- TransactionClassifier uses configurable tag dictionaries for classification
- MortgageCalculator uses UTC date methods throughout to avoid timezone issues
- Both services are pure domain logic with no I/O dependencies

### Phase 2: Application Layer - COMPLETE

| Component | File | Status |
|-----------|------|--------|
| YamlFinanceStore | `2_adapters/persistence/yaml/YamlFinanceStore.mjs` | Complete |
| BudgetCompilationService | `3_applications/finance/BudgetCompilationService.mjs` | Complete |
| TransactionCategorizationService | `3_applications/finance/TransactionCategorizationService.mjs` | Complete |
| FinanceHarvestService | `3_applications/finance/FinanceHarvestService.mjs` | Complete |
| Unit Tests | `tests/unit/applications/finance/` | Complete |

**Key Implementation Notes:**
- YamlFinanceStore handles all YAML file operations for finance data
- BudgetCompilationService orchestrates complex budget building with monthly/daily breakdowns
- TransactionCategorizationService uses IAIGateway.chatWithJson() for AI categorization
- FinanceHarvestService coordinates data refresh from Buxfer with optional categorization

### Phase 3: API Layer - COMPLETE

| Component | File | Status |
|-----------|------|--------|
| Finance Router | `4_api/routers/finance.mjs` | Complete |
| Router Unit Tests | `tests/unit/api/routers/finance.test.mjs` | Complete |
| Bootstrap Integration | `0_infrastructure/bootstrap.mjs` | Complete |

**Key Implementation Notes:**
- Finance router uses dependency injection for all services (financeStore, harvestService, etc.)
- Legacy compatibility endpoints added: `/api/finance/data` (for /data/budget), `/api/finance/data/daytoday`
- Bootstrap exports `createFinanceServices()` and `createFinanceApiRouter()` functions
- All router endpoints tested with mocked services

**API Endpoints:**
- `GET /api/finance` - Finance config overview
- `GET /api/finance/data` - Compiled finances (legacy /data/budget)
- `GET /api/finance/data/daytoday` - Current day-to-day budget
- `GET /api/finance/accounts` - Account balances
- `GET /api/finance/transactions` - Transaction list
- `POST /api/finance/transactions/:id` - Update transaction
- `GET /api/finance/budgets` - Budget list
- `GET /api/finance/budgets/:budgetId` - Specific budget
- `GET /api/finance/mortgage` - Mortgage data
- `POST /api/finance/refresh` - Trigger harvest
- `POST /api/finance/compile` - Trigger compilation
- `POST /api/finance/categorize` - Trigger AI categorization
- `GET /api/finance/memos` - All memos
- `POST /api/finance/memos/:transactionId` - Save memo
- `GET /api/finance/metrics` - Adapter metrics

### Phase 4: Cleanup - COMPLETE

| Task | Status |
|------|--------|
| Add finance router to main app | Complete |
| Create legacy endpoint shims | Complete |
| Update documentation | Complete |
| Migration verification | Complete |

**Key Implementation Notes:**
- Finance router mounted at `/api/finance` in legacy index.js
- Legacy endpoint shims redirect to new API (placed BEFORE legacy routers):
  - `GET /data/budget` → `GET /api/finance/data`
  - `GET /data/budget/daytoday` → `GET /api/finance/data/daytoday`
  - `GET /harvest/budget` → `POST /api/finance/refresh`
  - `POST /harvest/budget` → `POST /api/finance/refresh`
- Legacy routers (`fetch.mjs`, `harvest.mjs`) still exist but budget endpoints are bypassed by shims
- Frontend can continue using legacy endpoints (they redirect) or migrate to new API

## Migration Complete

All phases of the finance domain migration are now complete. The new DDD architecture is in place:

| Layer | Components | Status |
|-------|------------|--------|
| Domain (1_domains) | TransactionClassifier, MortgageCalculator | Complete |
| Adapters (2_adapters) | YamlFinanceStore, BuxferAdapter | Complete |
| Applications (3_applications) | BudgetCompilationService, FinanceHarvestService, TransactionCategorizationService | Complete |
| API (4_api) | finance.mjs router | Complete |
| Infrastructure (0_infrastructure) | createFinanceServices(), createFinanceApiRouter() in bootstrap.mjs | Complete |

### Future Improvements
- Update frontend to use `/api/finance/*` endpoints directly (removes redirect overhead)
- Remove legacy budget endpoints from `fetch.mjs` and `harvest.mjs` once frontend is updated
- Add integration tests with real YAML fixtures

## Notes

- Focus on preserving exact API contract for frontend compatibility
- Transaction categorization uses IAIGateway.chatWithJson() for structured responses
- Categorization rules (regex patterns) should be configurable, not hardcoded
- All domain services use UTC date methods to avoid timezone bugs
