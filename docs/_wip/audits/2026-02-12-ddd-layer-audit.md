# DDD Layer Audit — 2026-02-12

> Comprehensive audit of `backend/src/` against the [DDD Reference](../../reference/core/layers-of-abstraction/ddd-reference.md).
>
> **Status: ALL VIOLATIONS REMEDIATED** — Completed 2026-02-12. See [implementation plan](../../plans/2026-02-12-ddd-violation-remediation.md).

---

## Summary

| Layer | Files Checked | Violations | Status |
|-------|--------------|------------|--------|
| `0_system` | ~20 | ~~1~~ 0 | REMEDIATED (`01e288d2`) |
| `1_adapters` | 167 | 0 | CLEAN |
| `1_rendering` | ~10 | 0 | CLEAN |
| `2_domains` | ~80 | ~~6~~ 0 | REMEDIATED |
| `3_applications` | ~150 | 0 | CLEAN |
| `4_api` | ~30 | ~~6~~ 0 | REMEDIATED |

---

## `0_system/bootstrap.mjs` — Composition Root (NOT a violation)

`bootstrap.mjs` imports from all layers. This is correct — the bootstrap **is** the composition root whose entire purpose is to wire layers together. Every DDD codebase needs exactly this: one place that knows about everything in order to assemble the dependency graph.

**Not a violation.** No action needed.

### ~~Actual `0_system` violation~~

~~`0_system/registries/SystemBotLoader.mjs:3` imports directly from `#adapters/messaging/TelegramAdapter.mjs`.~~

### Remediation

- [x] `SystemBotLoader.mjs` — inject the Telegram adapter via constructor instead of importing it directly (`01e288d2`)

---

## ~~HIGH~~ REMEDIATED: Domain Layer (`2_domains`) — Forbidden Imports

### 1. Imports from `3_applications`

| File | Line | Import | Fix |
|------|------|--------|-----|
| ~~`content/services/ContentSourceRegistry.mjs`~~ | 2 | ~~`#apps/content/ports/IContentSource.mjs`~~ | `adde2d26` |
| ~~`entropy/services/index.mjs`~~ | 12 | ~~`#apps/entropy/services/EntropyService.mjs`~~ | `14e967b3` |

#### Remediation

- [x] Move `validateAdapter` into `2_domains/content/` or inject it (`adde2d26`)
- [x] Remove backward-compat re-export from `entropy/services/index.mjs`; update all consumers to import from `#apps/entropy/` (`14e967b3`)

### 2. Infrastructure Modules in Domain

| File | Line | Import | Concern | Fix |
|------|------|--------|---------|-----|
| ~~`scheduling/services/SchedulerService.mjs`~~ | 11 | ~~`crypto`~~ | ID generation | `a75749ec` (kept — acceptable for hashing) |
| ~~`scheduling/services/SchedulerService.mjs`~~ | 12 | ~~`path`~~ | File path resolution | `a75749ec` (moved to SchedulerOrchestrator) |
| ~~`scheduling/services/SchedulerService.mjs`~~ | 13 | ~~`url` (pathToFileURL)~~ | Module loading | `a75749ec` (moved to SchedulerOrchestrator) |
| `core/utils/id.mjs` | 10 | `crypto` | ID generation | Accepted — stdlib for randomness |

#### Remediation

- [x] Split SchedulerService: pure domain logic stays, I/O orchestration moves to `SchedulerOrchestrator` in `3_applications/` (`a75749ec`)
- [x] `path` and `url` imports removed from domain — now only in SchedulerOrchestrator (`a75749ec`)
- [x] `core/utils/id.mjs` — documented `crypto` as accepted stdlib dependency for ID generation

### 3. Domain Services with I/O

| File | Issue | Fix |
|------|-------|-----|
| ~~`health/services/HealthAggregationService.mjs`~~ | ~~Constructor requires `#healthStore`~~ | `c5bd4d63` |
| ~~`lifelog/services/LifelogAggregator.mjs`~~ | ~~Constructor accepts `#userLoadFile` callback~~ | `0e0da4c7` |

#### Remediation

- [x] **HealthAggregationService:** Split into pure `HealthAggregator` (domain, static methods) and `AggregateHealthUseCase` (application, loads data then delegates) (`c5bd4d63`)
- [x] **LifelogAggregator:** Moved to `3_applications/lifelog/LifelogAggregator.mjs`. Pure extractors stay in domain. (`0e0da4c7`)

---

## ~~HIGH~~ REMEDIATED: Fat API Routers (`4_api`) — Business Logic in Presentation

### ~~`routers/play.mjs` (lines 34–100)~~

~~Contains `toPlayResponse()` and `getWatchState()`.~~ Extracted to `PlayResponseService` (`26f5a1b3`).

### ~~`routers/fitness.mjs` (lines 81–298)~~

~~Config loading, playlist enrichment, progress classification.~~ Extracted to `FitnessConfigService` and `FitnessPlayableService` (`b5bfacb1`). Screenshot handling extracted to `ScreenshotService` (`e7de2aa9`).

### ~~`routers/gratitude.mjs` (lines 55–109)~~

~~Timezone, validation, display name helpers.~~ Extracted to `GratitudeHouseholdService` (`ed3bcfad`).

### ~~`routers/admin/content.mjs` (lines 50–823)~~

~~Entire router doing direct YAML file I/O.~~ Extracted to `ListManagementService` + `YamlListDatastore` behind `IListStore` port. Router reduced from 824 → 312 lines (62% reduction). 45 integration tests written first as safety net. (`2f610afb`, `e8b7e5d4`)

### ~~`routers/admin/media.mjs` (line 13)~~

~~Direct import of `YtDlpAdapter`.~~ Extracted to `MediaDownloadService` (`b8eedd79`).

### Remediation

- [x] **admin/content.mjs:** Extract `ListManagementService` in `3_applications/content/` for all list CRUD (`e8b7e5d4`)
- [x] **play.mjs:** Extract `PlayResponseService` (`26f5a1b3`)
- [x] **fitness.mjs:** Extract config/classifier into `FitnessConfigService` + `FitnessPlayableService` (`b5bfacb1`)
- [x] **fitness.mjs:** Extract screenshot handling into `ScreenshotService` (`e7de2aa9`)
- [x] **gratitude.mjs:** Extract `GratitudeHouseholdService` (`ed3bcfad`)
- [x] **admin/media.mjs:** Route through `MediaDownloadService` (`b8eedd79`)

---

## ~~HIGH~~ REMEDIATED: Anemic Entities — Missing Encapsulation

### `fitness/entities/Session.mjs`

Domain methods added (`replaceTimeline`, `replaceSnapshots`, `removeDuplicateSnapshot`) to replace direct property mutation. All 15 mutation sites in SessionService and tests updated. (`c73b7858`)

**Remaining:** Properties are still public (not private fields). Private field conversion is a future step — the domain methods are now the controlled mutation interface.

### `content/entities/Item.mjs`, `scheduling/entities/Job.mjs`, `messaging/entities/Message.mjs`

**Deferred** — evaluated and determined these don't need richer behavior at this time. Low priority.

### Remediation

- [x] **Session:** Add domain methods for state changes; update all callers (`c73b7858`)
- [ ] **Session (future):** Convert to private fields with getters (domain methods already in place)
- [ ] **Item/Job/Message:** Low priority — evaluate if richer behavior is needed

---

## Clean Layers (No Violations)

### `1_adapters` — 167 files audited

All imports follow rules: `2_domains`, `3_applications/ports/` only, `0_system`. No imports from `4_api` or `1_rendering`.

### `1_rendering` — ~10 files audited

Only imports from `2_domains` and internal `#rendering/` modules. Clean.

### `3_applications` — ~150 files audited

No imports from `4_api`. Proper DI patterns. Use cases delegate to domain. Containers accept adapters via constructor injection.

### Domain Hierarchy

No level violations. Level 2 domains (fitness, nutrition, etc.) do not import from Level 3 aggregators (lifelog, health, journalist).

---

## Commit Log

| Commit | Task | Description |
|--------|------|-------------|
| `adde2d26` | 1 | Move `validateAdapter` into domain layer |
| `14e967b3` | 2 | Remove entropy domain-to-app re-export |
| `01e288d2` | 3 | Inject adapter factories into SystemBotLoader |
| `26f5a1b3` | 4 | Extract `PlayResponseService` from play router |
| `ed3bcfad` | 5 | Extract `GratitudeHouseholdService` from gratitude router |
| `c5bd4d63` | 6 | Split `HealthAggregationService` into pure domain + use case |
| `c73b7858` | 7 | Add Session domain methods for state changes |
| `0e0da4c7` | 8 | Move `LifelogAggregator` to application layer |
| `a75749ec` | 9 | Split `SchedulerService` into pure domain + orchestrator |
| `b5bfacb1` | 10 | Extract fitness config and classifier logic from router |
| `b8eedd79` | 11 | Route media downloads through `MediaDownloadService` |
| `2f610afb` | 12 | Add 45 section operation tests for content router |
| `e8b7e5d4` | 13 | Extract `ListManagementService` from content router |
| `e7de2aa9` | 14 | Extract screenshot handling into `ScreenshotService` |

**Test verification:** 3 full test suite runs post-remediation — 183 suites passing, ~2990 tests passing, zero regressions. All pre-existing failures unchanged.

---

## Remaining (Future)

| Item | Priority | Notes |
|------|----------|-------|
| Session private fields | Low | Domain methods in place; convert `this.x` to `#x` with getters |
| Item/Job/Message encapsulation | Low | Evaluate if richer behavior needed |
| `core/utils/id.mjs` crypto | None | Accepted as stdlib dependency |
