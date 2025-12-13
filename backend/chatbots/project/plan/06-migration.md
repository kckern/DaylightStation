# Phase 6: Migration & Rollout

> **Phase:** 6 of 6  
> **Duration:** Week 10  
> **Dependencies:** Phase 5 (Integration)  
> **Deliverables:** Feature flags, parallel validation, production rollout

---

## Critical Constraints

1. **All tests must pass before any production deployment**
2. **Data layer remains unchanged** - loadFile/saveFile from io.mjs
3. **Feature flags enable instant rollback**
4. **Legacy code removal only after 7 days of stable production**

---

## Objectives

1. Implement feature flag system
2. Run old and new paths in parallel with comparison
3. Canary rollout to production
4. Validate behavior parity
5. Remove legacy code
6. Update documentation

---

## Task Breakdown

### 6.1 Feature Flag System

**File:** `_lib/featureFlags/FeatureFlagService.mjs`

```
PURPOSE: Centralized feature flag management

CLASS: FeatureFlagService
├── constructor(options)
│   - defaultFlags: object
│   - source: 'env' | 'config' | 'remote'
│   - logger: Logger
│
├── FLAGS:
│   ├── USE_NEW_NUTRIBOT: boolean
│   ├── USE_NEW_JOURNALIST: boolean
│   ├── PARALLEL_MODE: boolean (run both, compare)
│   ├── LOG_COMPARISON: boolean
│   └── SHADOW_MODE: boolean (new runs but old returns)
│
├── isEnabled(flagName: string, context?: object): boolean
│   1. Check override in context
│   2. Check environment variable
│   3. Check config file
│   4. Return default
│
├── withFlag(flagName, context, fn): Promise<T>
│   - Execute fn only if flag enabled
│
├── getAllFlags(): object
│   - Return current flag states
│
└── OVERRIDE METHODS (for testing):
    ├── override(flagName, value): void
    ├── clearOverrides(): void
    └── getOverrides(): object

ENVIRONMENT VARIABLES:
- FF_USE_NEW_NUTRIBOT=true|false
- FF_USE_NEW_JOURNALIST=true|false
- FF_PARALLEL_MODE=true|false
- FF_LOG_COMPARISON=true|false
- FF_SHADOW_MODE=true|false

TESTS:
- Reads from env correctly
- Context overrides work
- Default values returned
```

---

### 6.2 Parallel Execution

**File:** `_lib/parallel/ParallelRunner.mjs`

```
PURPOSE: Run old and new implementations in parallel

CLASS: ParallelRunner
├── constructor(options)
│   - logger: Logger
│   - featureFlags: FeatureFlagService
│   - comparisonStore: IComparisonStore
│
├── async runParallel<T>(config: ParallelConfig<T>): Promise<T>
│   {
│     name: string,
│     oldImpl: () => Promise<T>,
│     newImpl: () => Promise<T>,
│     compare: (oldResult, newResult) => ComparisonResult,
│     useNew: boolean  // which to return
│   }
│   
│   1. Execute both implementations concurrently
│   2. Compare results
│   3. Log comparison if enabled
│   4. Store comparison for analysis
│   5. Return based on useNew flag
│
├── async runShadow<T>(config: ShadowConfig<T>): Promise<T>
│   - Run both, always return old
│   - Log new result for analysis
│   - Catch and log new errors without failing
│
└── TYPE ComparisonResult:
    {
      match: boolean,
      differences: string[],
      oldDuration: number,
      newDuration: number
    }

TESTS:
- Parallel execution works
- Comparison logged
- Shadow mode returns old result
- New errors don't fail shadow
```

**File:** `_lib/parallel/ComparisonStore.mjs`

```
PURPOSE: Store comparison results for analysis

CLASS: FileComparisonStore
├── constructor(storePath)
│
├── record(comparison: Comparison): Promise<void>
│   - Append to daily log file
│
├── getRecent(count: number): Promise<Comparison[]>
│
├── getSummary(dateRange): Promise<ComparisonSummary>
│   {
│     total: number,
│     matches: number,
│     mismatches: number,
│     avgOldDuration: number,
│     avgNewDuration: number,
│     topDifferences: string[]
│   }
│
└── TYPE Comparison:
    {
      timestamp: string,
      name: string,
      chatId: string,
      match: boolean,
      differences: string[],
      oldResult: object,
      newResult: object,
      oldDuration: number,
      newDuration: number
    }

TESTS:
- Records to file
- Summary calculates correctly
```

---

### 6.3 Comparison Functions

**File:** `nutribot/_migration/comparators.mjs`

```
PURPOSE: Compare old vs new Nutribot outputs

FUNCTIONS:
├── compareFoodDetection(oldResult, newResult): ComparisonResult
│   - Compare detected food items
│   - Check: count, names, portions, macros
│   - Tolerance for minor macro differences (±5%)
│
├── compareNutriLog(oldLog, newLog): ComparisonResult
│   - Compare status, food data
│
├── compareReport(oldReport, newReport): ComparisonResult
│   - Compare totals, item count
│   - Ignore presentation differences
│
└── compareMessage(oldMsg, newMsg): ComparisonResult
    - Compare text content
    - Compare button structure

TESTS:
- Detects true differences
- Ignores acceptable variance
```

**File:** `journalist/_migration/comparators.mjs`

```
PURPOSE: Compare old vs new Journalist outputs

FUNCTIONS:
├── compareFollowUp(oldQuestion, newQuestion): ComparisonResult
│   - Questions may differ (AI variance)
│   - Check: question exists, reasonable length
│
├── compareChoices(oldChoices, newChoices): ComparisonResult
│   - Check: count, button structure
│
└── compareQueueState(oldQueue, newQueue): ComparisonResult
    - Check: length, types

TESTS:
- Allows AI variance
- Detects structural issues
```

---

### 6.4 Router Migration

**File:** `router.mjs` (migration update)

```
PURPOSE: Feature-flagged routing

UPDATES:
├── Import ParallelRunner, FeatureFlagService
│
├── NUTRIBOT ROUTING:
│   if (featureFlags.isEnabled('PARALLEL_MODE')) {
│     // Run both, compare, return based on flag
│     return parallelRunner.runParallel({
│       name: 'nutribot.webhook',
│       oldImpl: () => legacyNutribot(req, res),
│       newImpl: () => newNutribot(req, res),
│       compare: comparators.compareMessage,
│       useNew: featureFlags.isEnabled('USE_NEW_NUTRIBOT')
│     });
│   } else if (featureFlags.isEnabled('USE_NEW_NUTRIBOT')) {
│     return newNutribot(req, res);
│   } else {
│     return legacyNutribot(req, res);
│   }
│
├── JOURNALIST ROUTING:
│   - Same pattern
│
└── SHADOW MODE:
    if (featureFlags.isEnabled('SHADOW_MODE')) {
      // Always return old, but run new for comparison
      return parallelRunner.runShadow({...});
    }

TESTS:
- Flag combinations tested
- Parallel runs both
- Shadow returns old
```

---

### 6.5 Rollout Procedure

**File:** `_migration/rollout.md`

```
# Rollout Procedure

## Pre-Rollout Checklist
- [ ] All integration tests pass
- [ ] Manual testing on staging
- [ ] Monitoring dashboards configured
- [ ] Rollback procedure documented
- [ ] On-call notified

## Phase 1: Shadow Mode (Day 1-2)
1. Set FF_SHADOW_MODE=true
2. Monitor logs for new impl errors
3. Review comparison store for differences
4. Fix any critical issues
5. Target: 0 errors in new impl

## Phase 2: Parallel Mode (Day 3-4)
1. Set FF_PARALLEL_MODE=true, FF_USE_NEW_NUTRIBOT=false
2. Both impls run, old returns
3. Analyze comparison summary
4. Target: >95% match rate

## Phase 3: Canary (Day 5-6)
1. Set FF_USE_NEW_NUTRIBOT=true for 10% of users
   - Based on chatId hash
2. Monitor for errors, regressions
3. Expand to 25%, 50%, 100%
4. Target: Same error rate as old

## Phase 4: Full Rollout (Day 7)
1. Set FF_USE_NEW_NUTRIBOT=true globally
2. Set FF_PARALLEL_MODE=false (save resources)
3. Monitor for 24 hours
4. If issues: instant rollback via flag

## Rollback Procedure
1. Set FF_USE_NEW_NUTRIBOT=false
2. Restart services
3. Monitor for stabilization
4. Investigate issues
5. Fix and re-rollout

## Success Criteria
- [ ] Error rate unchanged
- [ ] Response time within 20% of old
- [ ] All features functional
- [ ] No data loss
- [ ] User feedback neutral/positive
```

---

### 6.6 Legacy Code Removal

**File:** `_migration/cleanup.md`

```
# Cleanup Procedure

## Prerequisites
- Full rollout complete for 7 days
- No rollbacks required
- Comparison store shows >99% match

## Files to Remove

### Nutribot Legacy
- [ ] backend/chatbots/nutribot/index.mjs (old)
- [ ] backend/chatbots/nutribot/webhook.mjs (old)
- [ ] backend/chatbots/nutribot/lib/*.mjs (old)
- [ ] backend/chatbots/nutribot/data/ (if migrated)

### Journalist Legacy
- [ ] backend/journalist/telegram_hook.mjs
- [ ] backend/journalist/lib/journalist.mjs
- [ ] backend/journalist/lib/telegram.mjs
- [ ] backend/journalist/lib/db.mjs (partially)
- [ ] backend/journalist/lib/quiz.mjs

### Shared Legacy
- [ ] Feature flag infrastructure (if no longer needed)
- [ ] ParallelRunner (if no longer needed)
- [ ] ComparisonStore (archive data first)

## Configuration Cleanup
- [ ] Remove FF_* environment variables
- [ ] Update config files
- [ ] Remove parallel mode config

## Documentation Updates
- [ ] Update README
- [ ] Update API docs
- [ ] Archive migration docs

## Git Cleanup
- [ ] Create final pre-cleanup tag
- [ ] Remove files in single commit
- [ ] Squash migration commits if desired
```

---

### 6.7 Monitoring & Alerting

**File:** `_lib/monitoring/HealthCheck.mjs`

```
PURPOSE: Health check endpoint for new architecture

CLASS: HealthCheck
├── constructor(containers: Container[])
│
├── async check(): Promise<HealthStatus>
│   {
│     status: 'healthy' | 'degraded' | 'unhealthy',
│     checks: {
│       telegram: { status, latencyMs },
│       openai: { status, latencyMs },
│       storage: { status, latencyMs }
│     },
│     version: string,
│     uptime: number
│   }
│
├── CHECKS:
│   ├── checkTelegram(): Promise<CheckResult>
│   │   - getMe API call
│   │
│   ├── checkOpenAI(): Promise<CheckResult>
│   │   - Small completion call
│   │
│   └── checkStorage(): Promise<CheckResult>
│       - Read/write test file
│
└── Handler for /health endpoint

TESTS:
- Returns healthy when all pass
- Returns degraded when one fails
- Latency measured correctly
```

**File:** `_lib/monitoring/Metrics.mjs`

```
PURPOSE: Collect metrics for monitoring

CLASS: Metrics
├── COUNTERS:
│   ├── webhooks_received_total
│   ├── webhooks_processed_total
│   ├── webhooks_errors_total
│   ├── ai_calls_total
│   └── messages_sent_total
│
├── HISTOGRAMS:
│   ├── webhook_duration_ms
│   ├── ai_call_duration_ms
│   └── report_generation_ms
│
├── GAUGES:
│   ├── active_conversations
│   └── queue_depth
│
├── increment(name, labels?): void
├── observe(name, value, labels?): void
├── set(name, value, labels?): void
│
└── export(): string
    - Prometheus format

TESTS:
- Counters increment
- Histograms record
- Export format valid
```

---

### 6.8 Documentation Updates

**Files to Create/Update:**

```
docs/
├── architecture/
│   ├── overview.md          # High-level architecture
│   ├── nutribot.md          # Nutribot specifics
│   ├── journalist.md        # Journalist specifics
│   ├── domain-model.md      # Domain entities/VOs
│   └── infrastructure.md    # Adapters/gateways
│
├── api/
│   ├── nutribot-webhook.md  # Webhook API
│   ├── nutribot-report.md   # Report API
│   ├── journalist-webhook.md
│   └── journalist-journal.md
│
├── development/
│   ├── setup.md             # Local dev setup
│   ├── testing.md           # Testing guide
│   └── adding-features.md   # How to add features
│
└── operations/
    ├── deployment.md        # Deployment guide
    ├── monitoring.md        # Monitoring setup
    └── troubleshooting.md   # Common issues
```

---

## Acceptance Criteria

### Feature Flags
- [ ] All flags read from env correctly
- [ ] Override mechanism works
- [ ] Context-aware flags work

### Parallel Execution
- [ ] Both implementations run concurrently
- [ ] Comparison logged correctly
- [ ] Shadow mode returns old result
- [ ] New errors don't crash shadow mode

### Rollout
- [ ] Shadow mode runs for 48 hours without issues
- [ ] Parallel mode shows >95% match rate
- [ ] Canary rollout successful
- [ ] Full rollout stable

### Cleanup
- [ ] Legacy code removed
- [ ] No dead code remaining
- [ ] Config cleaned up
- [ ] Documentation updated

---

## Files Created (Summary)

```
_lib/
├── featureFlags/
│   ├── FeatureFlagService.mjs
│   └── index.mjs
├── parallel/
│   ├── ParallelRunner.mjs
│   ├── ComparisonStore.mjs
│   └── index.mjs
└── monitoring/
    ├── HealthCheck.mjs
    ├── Metrics.mjs
    └── index.mjs

nutribot/_migration/
└── comparators.mjs

journalist/_migration/
└── comparators.mjs

_migration/
├── rollout.md
└── cleanup.md

docs/
├── architecture/
│   ├── overview.md
│   ├── nutribot.md
│   ├── journalist.md
│   ├── domain-model.md
│   └── infrastructure.md
├── api/
│   ├── nutribot-webhook.md
│   ├── nutribot-report.md
│   ├── journalist-webhook.md
│   └── journalist-journal.md
├── development/
│   ├── setup.md
│   ├── testing.md
│   └── adding-features.md
└── operations/
    ├── deployment.md
    ├── monitoring.md
    └── troubleshooting.md
```

**Total: 24 files**

---

## Complete Implementation Summary

| Phase | Files | Duration |
|-------|-------|----------|
| 1 - Foundation | 18 | Week 1-2 |
| 2 - Ports & Infrastructure | 17 | Week 3-4 |
| 3 - Nutribot Domain & Core | 26 | Week 5-6 |
| 4 - Nutribot Advanced + Journalist | 34 | Week 7-8 |
| 5 - Integration | 26 | Week 9 |
| 6 - Migration | 24 | Week 10 |
| **TOTAL** | **145** | **10 weeks** |

---

## Post-Migration

After successful migration and cleanup:

1. **Continue iterating** on the new architecture
2. **Add new features** following the established patterns
3. **Monitor** for regressions
4. **Document** any learnings
5. **Share** patterns with other projects

---

*This concludes the implementation plan. Return to [00-overview.md](./00-overview.md) for the full plan index.*
