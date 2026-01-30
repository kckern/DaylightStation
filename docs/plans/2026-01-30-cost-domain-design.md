# Cost Domain Design

> Unified cost tracking across API usage, utilities, subscriptions, and purchases

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation

---

## Overview

The Cost domain provides unified visibility into all household costs:
- **API usage** — OpenAI tokens, Telnyx SMS/voice
- **Utilities** — Power consumption from HomeAssistant smart plugs
- **Subscriptions** — Recurring costs from finance transactions (Strava, Netflix)
- **Purchases** — One-time hardware/equipment with time-bounded spreading

Key capabilities:
- **Budget monitoring** — Track spending against limits with alerts
- **Cost attribution** — Know which users/features/devices drive costs
- **Historical analysis** — Trends over time for planning and forecasting

---

## Architecture

### Layer Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4_api/v1/routers/cost.mjs                                                   │
│                                                                             │
│ • REST endpoints for dashboard, reporting, import                          │
│ • Query parameters for filtering (period, category, tags)                  │
│                                                                             │
│ Does NOT know: How costs are tracked, storage format                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3_applications/cost/                                                        │
│                                                                             │
│ • CostIngestionService — receive costs from sources                        │
│ • CostBudgetService — evaluate budgets, check pace, trigger alerts         │
│ • CostCompactionService — rollup old entries, archive                      │
│ • CostReportingService — dashboards, breakdowns, trends                    │
│                                                                             │
│ Does NOT know: Telnyx API, HomeAssistant sensors, YAML format              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2_adapters/                                                                 │
│                                                                             │
│ • OpenAICostSource — tracks token usage, applies rates                     │
│ • TelnyxCostSource — tracks SMS/voice, applies rates                       │
│ • HomeAssistantCostSource — polls power meters, calculates deltas          │
│ • FinanceCostSource — imports transactions, spreads over time              │
│ • YamlCostDatastore — persistence with compaction                          │
│                                                                             │
│ Knows: Provider APIs, sensor entities, YAML structure, rate configs        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1_domains/cost/                                                             │
│                                                                             │
│ • CostEntry, CostBudget entities                                           │
│ • Value objects: Money, Usage, Attribution, CostCategory                   │
│ • CostAnalysisService — calculations, breakdowns, pace analysis            │
│                                                                             │
│ Knows: Business rules only. No external dependencies.                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
1_domains/cost/
├── entities/
│   ├── CostEntry.mjs
│   └── CostBudget.mjs
├── value-objects/
│   ├── Money.mjs
│   ├── Usage.mjs
│   ├── Attribution.mjs
│   ├── CostCategory.mjs
│   ├── BudgetPeriod.mjs
│   └── Thresholds.mjs
├── services/
│   └── CostAnalysisService.mjs
└── index.mjs

3_applications/cost/
├── ports/
│   ├── ICostSource.mjs
│   ├── ICostRepository.mjs
│   ├── ICostBudgetRepository.mjs
│   └── ICostAlertGateway.mjs
├── services/
│   ├── CostIngestionService.mjs
│   ├── CostBudgetService.mjs
│   ├── CostCompactionService.mjs
│   └── CostReportingService.mjs
└── index.mjs

2_adapters/cost/
├── YamlCostDatastore.mjs
├── openai/
│   └── OpenAICostSource.mjs
├── telnyx/
│   └── TelnyxCostSource.mjs
├── homeassistant/
│   └── HomeAssistantCostSource.mjs
└── finance/
    └── FinanceCostSource.mjs

4_api/v1/routers/
└── cost.mjs
```

---

## Domain Model

### CostEntry (Entity)

```javascript
CostEntry {
  id: string                    // UUID or timestamp-based
  occurredAt: Date              // When the cost was incurred
  amount: Money                 // Final dollar amount
  category: CostCategory        // Hierarchical path (ai/openai/gpt4/chat)
  usage: Usage                  // What was consumed
  entryType: EntryType          // usage | subscription | purchase | transaction
  attribution: Attribution      // Who/what incurred this cost

  // Optional
  description: string?          // Human-readable note
  metadata: object              // Source-specific data

  // For spread costs
  spreadSource: SpreadSource?   // Links to original purchase/subscription

  // For reconciliation
  reconcilesUsage: boolean      // If true, don't count in totals
  variance: Money?              // Difference from tracked usage
}
```

### CostBudget (Entity)

```javascript
CostBudget {
  id: string
  name: string                  // "Monthly AI Budget"
  category: CostCategory?       // What it covers (null = global)
  period: BudgetPeriod          // monthly, weekly, yearly
  amount: Money                 // Limit
  thresholds: Thresholds        // Warning/critical levels
  householdId: string

  // Methods
  getRemaining(spent: Money): Money
  getPercentSpent(spent: Money): number
  isOverBudget(spent: Money): boolean
  isAtWarningLevel(spent: Money): boolean
}
```

### Value Objects

```javascript
Money {
  amount: number
  currency: string              // Default: "USD"

  add(other: Money): Money
  subtract(other: Money): Money
  multiply(factor: number): Money
  equals(other: Money): boolean
}

Usage {
  quantity: number              // 1500, 3.2, 5
  unit: string                  // "tokens", "kWh", "sms", "minutes"
}

CostCategory {
  path: string[]                // ["ai", "openai", "gpt-4o", "chat"]

  getParent(): CostCategory?
  getRoot(): string
  includes(other: CostCategory): boolean
  toString(): string            // "ai/openai/gpt-4o/chat"
}

Attribution {
  householdId: string
  userId: string?               // Optional (system costs have no user)
  feature: string?              // "assistant", "voice-conversation", etc.
  resource: string?             // Device/plug/meter ID
  tags: Map<string, string>     // Flexible dimensions (room, circuit, etc.)
}

BudgetPeriod {
  type: "daily" | "weekly" | "monthly" | "yearly"
  anchor: Date?                 // Start of period (default: calendar)

  getCurrentPeriodStart(): Date
  getCurrentPeriodEnd(): Date
}

Thresholds {
  warning: number               // Default: 0.8 (80%)
  critical: number              // Default: 1.0 (100%)
  pace: boolean                 // Default: true (alert on projected overage)
}

EntryType = "usage" | "subscription" | "purchase" | "transaction"

SpreadSource {
  name: string                  // "Office Mini PC"
  originalAmount: Money
  spreadMonths: number
  startDate: Date
  endsAt: Date
  monthsRemaining: number
}
```

### Domain Service

```javascript
CostAnalysisService {
  // Aggregation
  calculateSpend(entries: CostEntry[], category?: CostCategory, period?: DateRange): Money

  // Breakdowns
  getCategoryBreakdown(entries: CostEntry[], depth?: number): Map<CostCategory, Money>
  getUserBreakdown(entries: CostEntry[]): Map<string, Money>
  getFeatureBreakdown(entries: CostEntry[]): Map<string, Money>
  getResourceBreakdown(entries: CostEntry[]): Map<string, Money>
  getTagBreakdown(entries: CostEntry[], tagName: string): Map<string, Money>

  // Budget analysis
  checkBudgetStatus(entries: CostEntry[], budget: CostBudget): BudgetStatus
  calculatePace(entries: CostEntry[], budget: CostBudget): PaceAnalysis

  // Filtering (excludes reconciliation-only entries by default)
  filterForSpend(entries: CostEntry[]): CostEntry[]
}
```

---

## Port Interfaces

### ICostSource

```javascript
/**
 * Interface for any source that can provide costs
 * Implementations: OpenAICostSource, TelnyxCostSource, HomeAssistantCostSource, FinanceCostSource
 */
interface ICostSource {
  getSourceId(): string                           // "openai", "telnyx", "homeassistant", "finance"
  getSupportedCategories(): CostCategory[]        // What categories this source emits

  // Pull: for reconciliation
  fetchCosts(since: Date): Promise<CostEntry[]>

  // Push: real-time cost events
  onCost(callback: (entry: CostEntry) => void): void
}
```

### ICostRepository

```javascript
/**
 * Persistence for cost entries
 * Implementation: YamlCostDatastore
 */
interface ICostRepository {
  save(entry: CostEntry): Promise<void>
  saveBatch(entries: CostEntry[]): Promise<void>

  findByPeriod(start: Date, end: Date, filter?: CostFilter): Promise<CostEntry[]>
  findByCategory(category: CostCategory, period: DateRange): Promise<CostEntry[]>
  findByAttribution(attribution: Partial<Attribution>, period: DateRange): Promise<CostEntry[]>

  // Compaction
  compact(olderThan: Date): Promise<CompactionResult>
  archive(entries: CostEntry[], path: string): Promise<void>
}

interface CostFilter {
  category?: CostCategory
  entryTypes?: EntryType[]
  userId?: string
  feature?: string
  resource?: string
  tags?: Map<string, string>
  excludeReconciliation?: boolean   // Default: true
}
```

### ICostBudgetRepository

```javascript
interface ICostBudgetRepository {
  findAll(householdId: string): Promise<CostBudget[]>
  findByCategory(category: CostCategory): Promise<CostBudget?>
  save(budget: CostBudget): Promise<void>
}
```

### ICostAlertGateway

```javascript
interface ICostAlertGateway {
  sendAlert(alert: CostAlert): Promise<void>
}

interface CostAlert {
  type: "threshold" | "pace"
  severity: "warning" | "critical"
  budget: CostBudget
  currentSpend: Money
  projectedSpend?: Money          // For pace alerts
  message: string
}
```

---

## Application Services

### CostIngestionService

```javascript
CostIngestionService {
  constructor({
    costRepository: ICostRepository,
    budgetService: CostBudgetService,
    sources: ICostSource[],
    logger
  })

  // Register and manage sources
  registerSource(source: ICostSource): void

  // Real-time push handler
  handleCostEvent(entry: CostEntry): Promise<void>
    // 1. Validate entry
    // 2. Save to repository
    // 3. Trigger budget evaluation

  // Pull reconciliation
  reconcile(sourceId?: string): Promise<ReconcileResult>
    // 1. Fetch costs from all (or specified) sources
    // 2. Deduplicate against existing entries
    // 3. Save new entries
    // 4. Return summary
}
```

### CostBudgetService

```javascript
CostBudgetService {
  constructor({
    budgetRepository: ICostBudgetRepository,
    costRepository: ICostRepository,
    alertGateway: ICostAlertGateway,
    analysisService: CostAnalysisService,
    logger
  })

  // Budget evaluation
  evaluateBudgets(householdId: string): Promise<BudgetStatus[]>
    // 1. Load all budgets for household
    // 2. Get spend for each budget's category/period
    // 3. Check thresholds and pace
    // 4. Return status array

  // Pace checking
  checkPace(budget: CostBudget): Promise<PaceAlert?>
    // Projected = (currentSpend / daysElapsed) * daysInPeriod
    // Alert if projected > limit

  // Summary
  getSpendSummary(householdId: string, period: DateRange): Promise<SpendSummary>

  // Alert deduplication (track last alert per budget per threshold)
  #shouldAlert(budget: CostBudget, threshold: string): boolean
}
```

### CostCompactionService

```javascript
CostCompactionService {
  constructor({
    costRepository: ICostRepository,
    config: RetentionConfig,
    logger
  })

  // Main compaction job
  compactOldEntries(retentionDays?: number): Promise<CompactionResult>
    // 1. Find entries older than retention period
    // 2. Group by hour + category
    // 3. Create rollup entries with aggregated attribution
    // 4. Archive raw entries (if configured)
    // 5. Delete raw entries from active storage

  // Manual archive
  archiveToFile(entries: CostEntry[], path: string): Promise<void>
}

interface CompactionResult {
  entriesCompacted: number
  rollupsCreated: number
  bytesArchived: number
}
```

### CostReportingService

```javascript
CostReportingService {
  constructor({
    costRepository: ICostRepository,
    budgetService: CostBudgetService,
    analysisService: CostAnalysisService,
    logger
  })

  // Dashboard
  getDashboard(householdId: string, period: DateRange): Promise<CostDashboard>
    // Returns: total spend, budget status, top categories, pace alerts

  // Breakdowns
  getSpendByCategory(householdId: string, period: DateRange, depth?: number): Promise<CategorySpend[]>
  getSpendByUser(householdId: string, period: DateRange): Promise<UserSpend[]>
  getSpendByFeature(householdId: string, period: DateRange): Promise<FeatureSpend[]>
  getSpendByResource(householdId: string, period: DateRange): Promise<ResourceSpend[]>
  getSpendByTag(householdId: string, period: DateRange, tagName: string): Promise<TagSpend[]>

  // Trends
  getTrend(householdId: string, category?: CostCategory, granularity: string, periods: number): Promise<TrendPoint[]>

  // Reconciliation
  getReconciliation(householdId: string, period: DateRange): Promise<ReconciliationReport[]>

  // Detail drill-down
  getEntries(filter: CostFilter, pagination: Pagination): Promise<PaginatedEntries>

  // Export
  exportReport(householdId: string, period: DateRange, format: string): Promise<ReportFile>
}
```

---

## Adapter Implementations

### OpenAICostSource

```javascript
// 2_adapters/cost/openai/OpenAICostSource.mjs

OpenAICostSource implements ICostSource {
  constructor({
    openAIAdapter,       // Existing adapter to wrap/hook
    rateConfig,          // Per-model pricing
    logger
  })

  getSourceId(): "openai"

  getSupportedCategories(): [
    "ai/openai/gpt-4o/chat",
    "ai/openai/gpt-4o/vision",
    "ai/openai/gpt-4o-mini/chat",
    "ai/openai/whisper/transcription",
    // etc.
  ]

  // Hook into OpenAI adapter calls
  // On each API call:
  //   1. Extract model, token counts
  //   2. Apply rate from config
  //   3. Build CostEntry with attribution from context
  //   4. Emit via onCost callback
}
```

### TelnyxCostSource

```javascript
// 2_adapters/cost/telnyx/TelnyxCostSource.mjs

TelnyxCostSource implements ICostSource {
  constructor({
    telnyxAdapter,
    rateConfig,
    logger
  })

  getSourceId(): "telnyx"

  getSupportedCategories(): [
    "telco/telnyx/sms/outbound",
    "telco/telnyx/sms/inbound",
    "telco/telnyx/voice/outbound",
    "telco/telnyx/voice/inbound",
  ]

  // Hook into Telnyx events
  // On SMS/voice event:
  //   1. Determine type (SMS, voice) and direction
  //   2. Apply rate from config
  //   3. Resolve user from phone number
  //   4. Build CostEntry with full attribution
  //   5. Emit via onCost callback
}
```

### HomeAssistantCostSource

```javascript
// 2_adapters/cost/homeassistant/HomeAssistantCostSource.mjs

HomeAssistantCostSource implements ICostSource {
  constructor({
    homeAssistantAdapter,
    meterConfig,          // Entity → resource mapping, utility rates
    pollInterval,         // How often to read meters
    logger
  })

  getSourceId(): "homeassistant"

  getSupportedCategories(): [
    "utility/power/electricity",
  ]

  // Internal: MeterReadingTracker
  //   - Stores last reading per entity
  //   - Calculates delta on each poll

  // Poll loop:
  //   1. Read sensor.{entity}_energy for each configured meter
  //   2. Calculate delta from last reading
  //   3. Convert kWh to cost via utility rate
  //   4. Build CostEntry with resource + tags from config
  //   5. Emit via onCost callback
}
```

### FinanceCostSource

```javascript
// 2_adapters/cost/finance/FinanceCostSource.mjs

FinanceCostSource implements ICostSource {
  constructor({
    financeRepository,    // Access to finance domain
    tagMapping,           // Finance tags → cost attribution
    trackedCosts,         // Configured subscriptions/purchases
    logger
  })

  getSourceId(): "finance"

  getSupportedCategories(): [
    "subscription/*",
    "purchase/*",
  ]

  // For configured recurring costs:
  //   1. Match transactions by description/category
  //   2. Determine spread period
  //   3. Generate spread entries (one per month/day)
  //   4. Apply tag mapping for attribution

  // For ad-hoc import:
  //   1. getCandidates() — find unimported transactions
  //   2. suggestAttribution() — apply tag mapping
  //   3. import() — create entries with user-provided spread

  // For reconciliation-only (e.g., OpenAI bill):
  //   1. Create transaction entry with reconcilesUsage=true
  //   2. Calculate variance against tracked usage
}
```

---

## Data Storage

### File Structure

```
data/household[-{hid}]/apps/cost/
├── config.yml              # Rates, budgets, sources, tag mapping
├── imports.yml             # Track which finance transactions imported
├── 2026-01/
│   ├── entries.yml         # Per-transaction entries (recent)
│   ├── rollups.yml         # Compacted hourly/daily aggregates
│   └── archive.yml.gz      # Compressed raw data (optional)
└── 2026-02/
    └── ...
```

### config.yml

```yaml
retention:
  detailed_days: 90           # Keep per-transaction for 90 days
  rollup_granularity: hourly  # Compact to hourly rollups
  archive_raw: true           # Keep compressed originals

rates:
  ai/openai:
    gpt-4o:
      input_tokens: 0.0025    # per 1K tokens
      output_tokens: 0.01
    gpt-4o-mini:
      input_tokens: 0.00015
      output_tokens: 0.0006
  telco/telnyx:
    sms_outbound: 0.004
    sms_inbound: 0.004
    voice_outbound: 0.007     # per minute
    voice_inbound: 0.0035
  utility/power:
    kwh: 0.12                 # local utility rate

budgets:
  - id: monthly-ai
    name: "Monthly AI Costs"
    category: ai
    period: monthly
    amount: 50.00
    thresholds:
      warning: 0.8
      critical: 1.0
      pace: true

  - id: monthly-telco
    name: "Monthly Phone Costs"
    category: telco/telnyx
    period: monthly
    amount: 25.00
    # Uses defaults: warning 80%, critical 100%, pace on

alerts:
  defaults:
    warning: 0.8
    critical: 1.0
    pace: true
  destinations:
    - type: messaging
      channel: parent

sources:
  homeassistant:
    power_meters:
      - entity: sensor.office_plug_energy
        resource: office_computer
        tags:
          room: office
          device_type: computer
      - entity: sensor.garage_freezer_energy
        resource: garage_freezer
        tags:
          room: garage
          device_type: appliance
    poll_interval: 3600

  finance:
    tag_mapping:
      fitness: { feature: fitness }
      media: { feature: media }
      teen: { userId: teen }
      hardware: { tags: { type: hardware } }
      office: { tags: { room: office } }

    tracked_costs:
      - name: Strava
        match: { description: "STRAVA" }
        mode: spread
        spread: 12 months
        renews: true
        attribution:
          feature: fitness
          tags: { service: strava }

      - name: Netflix
        match: { description: "NETFLIX" }
        mode: spread
        spread: 1 month
        renews: true
        attribution:
          feature: media
          tags: { service: netflix }

      - name: OpenAI Platform
        match: { description: "OPENAI" }
        mode: reconcile
        reconcile_with: ai/openai

      - name: Office Mini PC
        transaction_id: txn_abc123
        mode: spread
        spread: 36 months
        renews: false
        start: 2026-01-15
        attribution:
          resource: office_mini_pc
          tags: { type: hardware, room: office }
```

### entries.yml (per-transaction)

```yaml
- id: "20260130143022-a1b2c3"
  occurredAt: "2026-01-30T14:30:22Z"
  amount: 0.0234
  category: ai/openai/gpt-4o/chat
  entryType: usage
  usage:
    quantity: 1847
    unit: tokens
  attribution:
    householdId: default
    userId: teen
    feature: assistant
  metadata:
    model: gpt-4o
    promptTokens: 1200
    completionTokens: 647

- id: "20260130144515-d4e5f6"
  occurredAt: "2026-01-30T14:45:15Z"
  amount: 0.004
  category: telco/telnyx/sms/outbound
  entryType: usage
  usage:
    quantity: 1
    unit: sms
  attribution:
    householdId: default
    userId: teen
    feature: assistant
  metadata:
    to: "+15551234567"
    messageId: "msg_abc123"

- id: "20260201000000-spread1"
  occurredAt: "2026-02-01T00:00:00Z"
  amount: 11.08
  category: hardware/compute
  entryType: purchase
  usage:
    quantity: 1
    unit: month
  attribution:
    householdId: default
    resource: office_mini_pc
    tags:
      type: hardware
      room: office
  spreadSource:
    name: "Office Mini PC"
    originalAmount: 399.00
    spreadMonths: 36
    startDate: "2026-01-15"
    endsAt: "2029-01-15"
    monthsRemaining: 35
```

### rollups.yml (compacted)

```yaml
- period: "2026-01-15T14:00:00Z"
  granularity: hourly
  category: ai/openai/gpt-4o/chat
  entryType: usage
  amount: 1.23
  usage:
    quantity: 48520
    unit: tokens
  entryCount: 47
  attribution:
    byUser:
      teen: 0.89
      parent: 0.34
    byFeature:
      assistant: 1.10
      journalist: 0.13

- period: "2026-01-15T14:00:00Z"
  granularity: hourly
  category: utility/power/electricity
  entryType: usage
  amount: 0.48
  usage:
    quantity: 4.0
    unit: kWh
  entryCount: 4
  attribution:
    byResource:
      office_computer: 0.24
      garage_freezer: 0.18
      living_room_tv: 0.06
```

### imports.yml (finance import tracking)

```yaml
imports:
  txn_abc123:
    importedAt: "2026-01-20T10:00:00Z"
    costEntryId: "20260115000000-spread1"
    name: "Office Mini PC"
    spread: 36
  txn_def456:
    status: skipped
    reason: "one-time consumable"
  txn_ghi789:
    status: reconcile_only
    reconcilesCategory: ai/openai
```

---

## API Endpoints

### Cost Reporting

```
GET  /api/v1/cost/dashboard
     ?household=default
     ?period=2026-01
     # Returns: total spend, budget status, top categories, pace alerts

GET  /api/v1/cost/spend/category
     ?household=default
     ?period=2026-01
     ?depth=2
     # Returns: hierarchical category breakdown

GET  /api/v1/cost/spend/user
GET  /api/v1/cost/spend/feature
GET  /api/v1/cost/spend/resource
GET  /api/v1/cost/spend/tag/:tagName

GET  /api/v1/cost/trend
     ?category=ai/openai
     ?granularity=daily
     ?periods=30
     # Returns: trend data points

GET  /api/v1/cost/entries
     ?period=2026-01-15..2026-01-20
     ?category=ai/openai
     ?userId=teen
     ?tags.room=office
     ?page=1&limit=50
     # Returns: paginated entries

GET  /api/v1/cost/reconciliation
     ?period=2026-01
     # Returns: usage vs transaction variances
```

### Budget Management

```
GET  /api/v1/cost/budgets
     # Returns: all budgets with current status

PUT  /api/v1/cost/budgets/:id
     # Update budget configuration
```

### Finance Import

```
GET  /api/v1/cost/finance/candidates
     # Returns: unimported transactions with suggested attribution

POST /api/v1/cost/finance/import
     {
       transactionId: "txn_abc123",
       spread: 36,
       attribution: { ... },
       category: "hardware/compute"
     }

POST /api/v1/cost/finance/skip
     {
       transactionId: "txn_def456",
       reason: "one-time consumable"
     }
```

### Operations

```
POST /api/v1/cost/reconcile
     ?source=openai
     # Trigger manual reconciliation

POST /api/v1/cost/compact
     # Trigger manual compaction (admin)

GET  /api/v1/cost/export
     ?period=2026-01
     ?format=csv
     # Export report
```

---

## Alert Flow

```
CostEntry ingested
       │
       ▼
CostIngestionService.handleCostEvent()
       │
       ├─► Save to repository
       │
       └─► CostBudgetService.evaluateBudgets()
                  │
                  ├─► Check threshold: spend/limit vs warning/critical
                  │
                  ├─► Check pace: (spend/daysElapsed) * daysInPeriod > limit?
                  │
                  └─► If alert triggered (and not duplicate):
                            │
                            ▼
                      ICostAlertGateway.sendAlert({
                        type: 'threshold' | 'pace',
                        severity: 'warning' | 'critical',
                        budget: CostBudget,
                        currentSpend: Money,
                        projectedSpend?: Money,
                        message: string
                      })
                            │
                            ▼
                      MessagingDomain routes to configured destination
```

### Alert Deduplication

Only alert once per threshold per budget per period. Tracked in memory or state file:

```yaml
lastAlerts:
  monthly-ai:
    warning: "2026-01-20T10:00:00Z"
    critical: null
    pace: "2026-01-15T08:00:00Z"
```

Pace alerts can repeat weekly if still trending over.

---

## Entry Types & Double-Counting Prevention

### Entry Types

| Type | Source | Counts in Spend | Purpose |
|------|--------|-----------------|---------|
| `usage` | OpenAI, Telnyx, HomeAssistant | Yes | Real-time metered costs |
| `subscription` | Finance (recurring) | Yes | Spread recurring costs |
| `purchase` | Finance (one-time) | Yes | Spread capital costs |
| `transaction` | Finance (reconcile) | No | Bank reconciliation only |

### Filtering Logic

```javascript
function calculateSpend(entries) {
  return entries
    .filter(e => ['usage', 'subscription', 'purchase'].includes(e.entryType))
    .filter(e => !e.reconcilesUsage)
    .reduce((sum, e) => sum + e.amount, 0);
}
```

### Reconciliation View

For sources with both usage tracking and bank transactions (e.g., OpenAI):

```
Category: ai/openai
Period: 2026-01
Tracked Usage: $45.18
Bank Transaction: $47.23
Variance: $2.05 (4.5%)
```

---

## Implementation Phases

### Phase 1: Core Domain + OpenAI

- [ ] Domain entities and value objects
- [ ] CostAnalysisService
- [ ] ICostSource, ICostRepository ports
- [ ] YamlCostDatastore
- [ ] OpenAICostSource (hook into existing adapter)
- [ ] CostIngestionService
- [ ] Basic API endpoints (dashboard, entries)

### Phase 2: Budgets + Alerts

- [ ] CostBudget entity
- [ ] CostBudgetService with threshold + pace checking
- [ ] ICostAlertGateway + messaging integration
- [ ] Budget API endpoints

### Phase 3: HomeAssistant + Utilities

- [ ] HomeAssistantCostSource
- [ ] MeterReadingTracker
- [ ] Per-device resource tracking
- [ ] Tag-based attribution

### Phase 4: Finance Integration

- [ ] FinanceCostSource
- [ ] Tag mapping configuration
- [ ] Subscription spreading
- [ ] Purchase spreading with time bounds
- [ ] Ad-hoc import API
- [ ] Reconciliation reporting

### Phase 5: Compaction + Reporting

- [ ] CostCompactionService
- [ ] Rollup generation
- [ ] Archive compression
- [ ] CostReportingService with full breakdowns
- [ ] Trend analysis
- [ ] Export functionality

### Phase 6: Telnyx Integration

- [ ] TelnyxCostSource (after telco adapter exists)
- [ ] SMS/voice cost tracking
- [ ] User attribution from caller ID

---

## Related Documents

- [Telco Adapter Design](./2026-01-30-telco-adapter-design.md) — Telnyx integration for SMS/voice
- [Backend Architecture](../reference/core/backend-architecture.md) — DDD layer guidelines
- Finance Domain — Transaction source for subscriptions/purchases

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design from brainstorming session |
