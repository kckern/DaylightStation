# Domain Layer DDD Audit Report

> Comprehensive audit of `/backend/src/1_domains/` against domain-layer-guidelines.md
> Date: 2026-01-26

---

## Executive Summary

**Total violations: 200+ instances across 16 domains**

The domain layer has widespread DDD violations, with infrastructure coupling being the most critical issue. Nearly every entity imports from `0_infrastructure/utils`, serialization methods (`toJSON`/`fromJSON`) appear in 30+ entities, and raw time functions (`Date.now()`, `new Date()`) are used throughout instead of injected timestamps.

### Severity Breakdown

| Severity | Count | Categories |
|----------|-------|------------|
| **CRITICAL** | 50+ | Infrastructure imports, Ports in wrong layer |
| **HIGH** | 80+ | Raw time functions, Serialization in domain |
| **MEDIUM** | 70+ | Generic errors, Mutable entities, Custom ValidationError classes |

---

## Priority 1: Critical Violations

### 1.1 Forbidden Infrastructure Imports

**Impact:** Breaks dependency inversion, couples domain to infrastructure details.

Domain entities and services import directly from `0_infrastructure/`:

| Domain | File | Line | Import |
|--------|------|------|--------|
| finance | `entities/Account.mjs` | 5 | `nowTs24` from infrastructure |
| gratitude | `entities/Selection.mjs` | 11 | `nowTs24` from infrastructure |
| journaling | `entities/JournalEntry.mjs` | 5 | `nowTs24` from infrastructure |
| journalist | `entities/ConversationMessage.mjs` | 9 | `nowTs24` from infrastructure |
| journalist | `entities/JournalEntry.mjs` | 10 | `nowTs24` from infrastructure |
| journalist | `entities/MessageQueue.mjs` | 9 | `nowTs24` from infrastructure |
| journalist | `entities/QuizAnswer.mjs` | 9 | `nowTs24` from infrastructure |
| journalist | `entities/QuizQuestion.mjs` | 10 | `nowTs24` from infrastructure |
| lifelog | `entities/NutriLog.mjs` | 3 | `nowTs24` from infrastructure |
| messaging | `entities/Conversation.mjs` | 5 | `nowTs24` from infrastructure |
| messaging | `entities/Message.mjs` | 8 | `nowTs24` from infrastructure |
| messaging | `entities/Notification.mjs` | 8 | `nowTs24` from infrastructure |
| nutrition | `entities/FoodItem.mjs` | 11-12 | `ValidationError`, `shortId` from infrastructure |
| nutrition | `entities/NutriLog.mjs` | 10-14 | `shortId`, `formatLocalTimestamp`, `ValidationError` |
| scheduling | `entities/JobExecution.mjs` | 4 | `nowTs24` from infrastructure |
| content | `services/ArchiveService.mjs` | 23-27 | `fs`, config, logging |
| content | `services/MediaMemoryService.mjs` | 13-17 | `path`, `fs`, config, utils |
| media | `services/YouTubeDownloadService.mjs` | 17-22 | `nowTs24`, `fs`, `path`, `child_process` |
| entropy | `services/EntropyService.mjs` | 214, 221 | Dynamic imports from infrastructure |

**Fix:** Pass values as parameters to factory methods/constructors. Move utility dependencies to application layer.

---

### 1.2 Ports in Domain Layer

**Impact:** Ports define contracts for external systems and belong in the application layer per guidelines.

| Domain | Port Files |
|--------|------------|
| core | `ports/` (empty placeholder) |
| ai | `ports/IAIGateway.mjs`, `ports/ITranscriptionService.mjs` |
| messaging | `ports/INotificationChannel.mjs`, `ports/IMessagingGateway.mjs`, `ports/IConversationStateStore.mjs`, `ports/IConversationStore.mjs` |
| fitness | `ports/ISessionStore.mjs`, `ports/IFitnessSyncerGateway.mjs`, `ports/IZoneLedController.mjs` |
| nutrition | `ports/IFoodLogStore.mjs`, `ports/INutriCoachStore.mjs`, `ports/INutriListStore.mjs` |
| finance | `ports/ITransactionSource.mjs` |

**Fix:** Move all port definitions to `3_applications/{app}/ports/`.

---

## Priority 2: High-Severity Violations

### 2.1 Raw Time Functions

**Impact:** Makes testing difficult, creates hidden dependencies, violates pure domain logic.

Domain code should receive timestamps as parameters, not call `Date.now()` or `new Date()`.

| Domain | File | Line | Code |
|--------|------|------|------|
| fitness | `entities/Session.mjs` | 107 | `end(endTime = Date.now())` |
| fitness | `entities/Session.mjs` | 127 | `timestamp: Date.now()` |
| fitness | `entities/Session.mjs` | 141 | `this.snapshots.updatedAt = Date.now()` |
| fitness | `entities/Session.mjs` | 198 | `generateSessionId(date = new Date())` |
| fitness | `services/SessionService.mjs` | 35 | `startTime: data.startTime \|\| Date.now()` |
| fitness | `services/SessionService.mjs` | 148 | `endSession(..., endTime = Date.now())` |
| finance | `entities/Mortgage.mjs` | 68 | `const now = new Date()` |
| finance | `services/MortgageCalculator.mjs` | 95, 170 | Multiple `new Date()` calls |
| gratitude | `entities/Selection.mjs` | 123 | `new Date().toLocaleString(...)` |
| messaging | `entities/Message.mjs` | 98 | `Date.now() - new Date(...).getTime()` |
| messaging | `entities/Message.mjs` | 213 | `msg-${Date.now()}-...` |
| messaging | `services/NotificationService.mjs` | 89 | `notif-${Date.now()}-...` |
| messaging | `services/ConversationService.mjs` | 115-116, 204, 213 | Multiple `new Date()` calls |
| nutrition | `entities/formatters.mjs` | 44 | `const now = new Date()` |
| nutrition | `entities/NutriLog.mjs` | 136, 456, 539, 551-553 | 6 instances of `new Date()` |
| scheduling | `entities/JobState.mjs` | 36, 45 | Default param `new Date()` |
| scheduling | `services/SchedulerService.mjs` | 93, 161, 197, 348, 405 | Multiple `new Date()` calls |
| journalist | `entities/QuizQuestion.mjs` | 94 | `Date.now() - new Date(...)` |
| journalist | `services/HistoryFormatter.mjs` | 70 | `Date.now() - hoursAgo * ...` |
| content | `services/QueueService.mjs` | 96, 112, 135, 183 | Default param `new Date()` |
| content | `services/MediaMemoryValidatorService.mjs` | 134 | `Date.now()` |
| health | `services/HealthAggregationService.mjs` | 124 | `const today = new Date()` |
| media | `services/YouTubeDownloadService.mjs` | 73, 81, 97 | Multiple time calls |

**Fix:** Remove default parameters using `Date.now()`/`new Date()`. Require timestamp as explicit parameter.

---

### 2.2 Serialization Methods in Domain

**Impact:** Leaks persistence concerns into pure business logic.

`toJSON()` and `fromJSON()` methods should be in adapters/repositories, not entities.

| Domain | Entity | Methods |
|--------|--------|---------|
| content | `WatchState.mjs` | `toJSON()` (line 60), `fromJSON()` (line 77) |
| content | `Playable.mjs`, `Listable.mjs` | `toJSON()` |
| entropy | `EntropyItem.mjs` | `toJSON()` (line 147) |
| finance | `Account.mjs` | `toJSON()` (line 65), `fromJSON()` (line 78) |
| finance | `Budget.mjs` | `toJSON()` (line 67), `fromJSON()` (line 79) |
| finance | `Mortgage.mjs` | `toJSON()` (line 98), `fromJSON()` (line 112) |
| finance | `Transaction.mjs` | `toJSON()` (line 79), `fromJSON()` (line 93) |
| fitness | `Participant.mjs` | `toJSON()` (line 58), `fromJSON()` (line 71) |
| fitness | `Session.mjs` | `toJSON()` (line 168), `fromJSON()` (line 185) |
| fitness | `Zone.mjs` | `toJSON()` (line 61), `fromJSON()` (line 73) |
| gratitude | `GratitudeItem.mjs` | `toJSON()` (line 51), `fromJSON()` (line 63) |
| gratitude | `Selection.mjs` | `toJSON()` (line 95), `fromJSON()` (line 110) |
| health | `HealthMetric.mjs` | `toJSON()` (line 84), `fromJSON()` (line 105) |
| health | `WorkoutEntry.mjs` | `toJSON()` (line 72), `fromJSON()` (line 97) |
| journaling | `JournalEntry.mjs` | `toJSON()` (line 94), `fromJSON()` (line 112) |
| journalist | `ConversationMessage.mjs` | `toJSON()` (line 188) |
| journalist | `JournalEntry.mjs` | `toJSON()` (line 224) |
| journalist | `MessageQueue.mjs` | `toJSON()` (line 161) |
| journalist | `QuizAnswer.mjs` | `toJSON()` (line 143) |
| journalist | `QuizQuestion.mjs` | `toJSON()` (line 140) |
| lifelog | `NutriLog.mjs` | `toJSON()`, `fromJSON()` |
| lifelog | `FoodItem.mjs` | `toJSON()`, `fromJSON()` |
| messaging | `Message.mjs` | `toJSON()` (line 122), `fromJSON()` (line 137) |
| messaging | `Notification.mjs` | `toJSON()` (line 68), `fromJSON()` (line 82) |
| messaging | `Conversation.mjs` | `toJSON()` (line 72), `fromJSON()` (line 83) |
| messaging | `ConversationId.mjs` | `toJSON()` (line 75) |
| nutrition | `FoodItem.mjs` | `toJSON()` (lines 169-189) |
| nutrition | `NutriLog.mjs` | `toJSON()` (lines 404-427), `toNutriListItems()` |
| scheduling | `Job.mjs` | `toJSON()` (line 48) |
| scheduling | `JobExecution.mjs` | `toJSON()` (line 85) |
| scheduling | `JobState.mjs` | `toJSON()` (line 54) |

**Fix:** Move serialization to repositories in adapter layer. Entity constructors accept domain-typed parameters.

---

## Priority 3: Medium-Severity Violations

### 3.1 Generic Error Throwing

**Impact:** Loses semantic meaning, makes error handling harder in application layer.

Should use `ValidationError`, `DomainInvariantError`, or `EntityNotFoundError`.

**High-frequency offenders:**

| Domain | File | Error Count |
|--------|------|-------------|
| content | `entities/Item.mjs` | 4 generic errors |
| content | `ports/IContentSource.mjs` | 10+ generic errors |
| ai | `ports/IAIGateway.mjs` | 7 generic errors |
| ai | `ports/ITranscriptionService.mjs` | 4 generic errors |
| fitness | `entities/Zone.mjs` | 1 generic error |
| fitness | `services/SessionService.mjs` | 4 generic errors |
| finance | `services/BudgetService.mjs` | 2 generic errors |
| finance | `services/MortgageService.mjs` | 3 generic errors |
| nutrition | `services/FoodLogService.mjs` | 4 generic errors |
| messaging | `services/NotificationService.mjs` | 1 generic error |
| messaging | `services/ConversationService.mjs` | 2 generic errors |
| scheduling | `entities/Job.mjs` | 3 generic errors |
| scheduling | `services/SchedulerService.mjs` | 2 generic errors |
| lifelog | `entities/NutriLog.mjs` | 2 generic errors |
| gratitude | `services/GratitudeService.mjs` | 2 generic errors |
| health | `services/HealthAggregationService.mjs` | 1 generic error |
| journaling | `services/JournalService.mjs` | 1 generic error |

**Port interfaces** (all domains): All abstract methods throw `throw new Error('Not implemented')`.

**Fix:** Replace with domain-specific errors including `code`, `field`, `value`, `details`.

---

### 3.2 Custom Local ValidationError Classes

**Impact:** Inconsistent error handling across domains.

Several files define their own `ValidationError` instead of using shared infrastructure error:

| Domain | File |
|--------|------|
| journalist | `entities/JournalEntry.mjs` (lines 15-20) |
| journalist | `entities/QuizAnswer.mjs` (lines 14-19) |
| journalist | `entities/MessageQueue.mjs` |
| journalist | `entities/ConversationMessage.mjs` |
| journalist | `entities/QuizQuestion.mjs` |
| nutrition | `entities/FoodItem.mjs` |
| nutrition | `entities/NutriLog.mjs` |

**Fix:** Create shared domain error types in `1_domains/core/errors/` and import consistently.

---

### 3.3 Mutable Entities Without Freeze

**Impact:** Allows inadvertent state mutations, breaks immutability guarantees.

Entities without `Object.freeze()`:

| Domain | Entity | Mutation Issue |
|--------|--------|----------------|
| fitness | `Session.mjs` | Direct property mutation (roster, endTime, timeline, snapshots) |
| finance | `Mortgage.mjs` | `makePayment()` mutates `currentBalance` |
| finance | `Account.mjs` | `updateBalance()`, `applyTransaction()` mutate properties |
| finance | `Budget.mjs` | `addSpending()`, `reset()` mutate properties |
| finance | `Transaction.mjs` | `addTag()`, `removeTag()` mutate array |
| content | `Item.mjs` | Not frozen |
| content | `WatchState.mjs` | Not frozen |
| fitness | `Zone.mjs` | Not frozen |
| health | `HealthMetric.mjs` | Not frozen |
| scheduling | `Job.mjs`, `JobExecution.mjs`, `JobState.mjs` | Not frozen |
| gratitude | `Selection.mjs` | `markAsPrinted()` mutation |
| gratitude | `GratitudeItem.mjs` | `updateText()` mutation |
| lifelog | `NutriLog.mjs` | Multiple mutation methods |

**Properly frozen:**
- `nutrition/entities/FoodItem.mjs` - Uses `Object.freeze(this)`
- `nutrition/entities/NutriLog.mjs` - Uses `Object.freeze(this)`
- `lifelog/entities/FoodItem.mjs` - Uses `Object.freeze(this)`
- `journalist/value-objects/EntrySource.mjs` - Uses `Object.freeze()`
- `journalist/value-objects/PromptType.mjs` - Uses `Object.freeze()`

**Fix:** Use controlled mutation via methods returning new instances, or apply `Object.freeze()`.

---

### 3.4 Vendor SDK Imports in Domain

**Impact:** Domain depends on external packages instead of abstractions.

| Domain | File | Import |
|--------|------|--------|
| nutrition | `entities/FoodItem.mjs` | `import { v4 as uuidv4 } from 'uuid'` |
| nutrition | `entities/NutriLog.mjs` | `import { v4 as uuidv4 } from 'uuid'` |

**Fix:** Pass pre-generated IDs to factory methods from application layer.

---

## Priority 4: Structural Issues

### 4.1 Misplaced Services

The following services perform infrastructure operations and should be in application/adapter layer:

| Domain | Service | Issue |
|--------|---------|-------|
| media | `YouTubeDownloadService.mjs` | Uses fs, path, child_process, executes yt-dlp |
| content | `ArchiveService.mjs` | Uses fs, config, logging |
| content | `MediaMemoryService.mjs` | Uses fs, path, config |
| scheduling | `SchedulerService.mjs` | Uses path, dynamic imports, job execution |

**Fix:** Move to `3_applications/` or `2_adapters/`.

---

### 4.2 Empty/Placeholder Domains

| Domain | Status |
|--------|--------|
| core | Only contains empty `entities/` and `ports/` folders |

**Fix:** Populate with shared domain primitives (DateRange, UserId, base error classes) or remove placeholder.

---

## Recommended Fix Order

### Phase 1: Structural (High Impact, Low Risk)
1. Move all `ports/` folders from `1_domains/` to `3_applications/`
2. Move infrastructure-heavy services (YouTubeDownloadService, ArchiveService, MediaMemoryService) to application layer
3. Create `1_domains/core/errors/` with shared error classes

### Phase 2: Import Cleanup (High Impact, Medium Risk)
4. Remove all `#infrastructure/*` imports from domain entities
5. Pass timestamps as parameters instead of calling `Date.now()`/`new Date()`
6. Replace `uuid` imports with ID parameters to factory methods

### Phase 3: Serialization Migration (Medium Impact, High Risk)
7. Move `toJSON()`/`fromJSON()` methods to repositories in adapter layer
8. Create mapper/translator classes for each entity

### Phase 4: Error Standardization (Low Impact, Low Risk)
9. Replace generic `Error` throws with domain-specific errors
10. Consolidate custom ValidationError classes to shared definition

### Phase 5: Immutability Enforcement (Low Impact, Medium Risk)
11. Add `Object.freeze()` to value objects
12. Convert entity mutation methods to return new instances

---

## Appendix: Files by Violation Count

| File | Violations |
|------|------------|
| `nutrition/entities/NutriLog.mjs` | 8+ (infrastructure imports, new Date, toJSON, uuid) |
| `fitness/entities/Session.mjs` | 7+ (Date.now, toJSON, mutable) |
| `scheduling/services/SchedulerService.mjs` | 6+ (path import, new Date, generic errors) |
| `messaging/services/ConversationService.mjs` | 5+ (infrastructure, new Date, generic errors) |
| `media/services/YouTubeDownloadService.mjs` | 7+ (fs, path, child_process, Date.now, infrastructure) |
| `journalist/entities/*.mjs` | 5 files with nowTs24 import + custom ValidationError |

---

## Related Documentation

- Guidelines: `docs/reference/core/domain-layer-guidelines.md`
- Prior audit: `docs/_wip/audits/2026-01-26-application-layer-ddd-audit.md`
