# Incomplete runtime contracts after backend DDD migration `76f2089c3`

**Date:** 2026-08-30
**Status:** all 17 unresolved contract families repaired locally; not deployed
**Severity:** critical migration quality issue; confirmed production failures in printing and scheduled data maintenance
**Introduced by:** `76f2089c37e1aac702033e312aa364eeb80c26cd`
**Migration title:** `refactor(backend): complete DDD boundary remediation`
**Migration size:** 2,103 files, 46,519 insertions, 34,947 deletions
**Author and committer recorded by Git:** KC Kern `<kc@kckern.com>`
**Production revision inspected:** `ca72bbc8d417e432b533ccb8b896489c93568e02`
**Primary evidence:** deployed scheduler state, VictoriaLogs, exact-revision Git comparison, source-contract audit, and focused composition tests

This is the umbrella report. The Gratitude incident has a request-by-request report at
`docs/_wip/bugs/2026-08-30-gratitude-card-print-missing-random-dependency.md`.

---

## 1. Executive conclusions

The migration was not complete at the runtime boundary. It successfully created many
new application services, ports, adapters, and thin routers, but production
composition continued passing the old dependency names or omitted the new dependency
entirely.

The thermal Gratitude receipt did **not** print. Its request failed before canvas
generation and before the printer gateway because the new selection contract required
an injected RNG and the live composition path did not provide one.

The audit found **17 unresolved contract families** in current composition at the
start of this repair. Several families contain multiple dependencies; School alone
was missing nine router-level contracts, Strava enrichment was missing four ports,
and the scheduler retained four deleted module handlers.

Four scheduled production jobs were also failing repeatedly:

- `budget`
- `health`
- `archive-rotation`
- `media-memory-validator`

Their persisted runtime state says `status: failed` with `Cannot find module` errors.
The migration deleted their legacy wrappers but left `jobs.yml` pointing at those
wrappers and left `SchedulerOrchestrator` using dynamic import as its fallback.

The failure mode is systemic rather than specific to the printer. JavaScript accepts
unknown object properties and missing optional constructor arguments. Most migrated
factories therefore booted successfully with dead dependencies, while tests supplied
the new contracts directly or mocked below the broken composition boundary.

All 17 unresolved families are now repaired in the workspace. The composition
contract registry has been expanded from four cases to eight, and focused tests cover
the new scheduler executor, media-memory adapters, shared Fitness module, School
composer, and live-sized Gratitude render path. Deployment and controlled hardware
verification remain outstanding.

---

## 2. Production evidence

### 2.1 Gratitude printing

Home Assistant made three observed calls to
`GET /api/v1/gratitude/card/print/downstairs` on 2026-08-30. All returned HTTP 500:

| Local time | Result | Failure stage |
|---|---:|---|
| 13:58:41 PDT | 500 | selection, before render |
| 16:46:31 PDT | 500 | selection, before render |
| 17:15:30 PDT | 500 | selection, before render |

The exception was:

```text
selectItemsForPrint requires random
```

There were no matching thermal-printer start or completion events. The printer,
network, paper state, and ESC/POS adapter were never reached.

### 2.2 Scheduler state

The deployed `data/system/scheduling/cron-runtime.yml` recorded:

```text
budget                    failed  2026-08-30 18:30:03
health                    failed  2026-08-30 03:45:04
archive-rotation          failed  2026-08-30 04:50:09
media-memory-validator    failed  2026-08-30 05:00:00
```

Each error resolves a former `../lib/*.mjs` job relative to the migrated
`SchedulerOrchestrator` and fails under
`backend/src/3_applications/lib/`, for example:

```text
Cannot find module '/usr/src/app/backend/src/3_applications/lib/budget.mjs'
imported from .../SchedulerOrchestrator.mjs
```

This is durable evidence that the migration removed executables without migrating
their data-driven scheduler contracts.

---

## 3. Audit method

The audit did not treat every failing test as a composition bug. A contract family was
included only when the new callee contract and the active production caller could be
compared directly, or production logs/state confirmed the mismatch.

The audit used five passes:

1. Diff `76f2089c3^..76f2089c3` for new semantic services, renamed dependency keys,
   explicit clocks/randomness/schedulers, and deleted legacy modules.
2. Locate every production construction site in `backend/src/app.mjs` and composition
   modules, then compare its dependency object with the new constructor/factory.
3. Compare production composition with test helpers. This found cases where tests had
   already learned the new contract while production had not.
4. Inspect VictoriaLogs and scheduler runtime state for live failures.
5. Run a diagnostic test comparison at the exact migration tree and its parent, then
   manually classify only reproducible contract mismatches.

The exact migration-tree diagnostic reported 30,914 tests: 28,961 passed, 1,692
failed, and 258 skipped, across 214 failed files. Compared with the parent snapshot,
208 failed files were new. That count is a blast-radius signal, not a claim that all
1,692 failures were product regressions; environment, fixture, and harness failures
were excluded from the inventory below.

The migration's advertised `test:refactor` gate still passed: 19 files and 192 tests.
That gate checks architecture and selected characterization behavior. It did not
instantiate the production composition root and did not exercise the renamed runtime
dependency bags.

---

## 4. Complete unresolved-contract inventory

These are the 17 contract families still unresolved when this audit began.

| # | Runtime surface | Incomplete migration contract | Observable consequence | Local repair |
|---:|---|---|---|---|
| 1 | Gratitude card | `selectItemsForPrint` gained required `random`; the correct `GratitudePrintPresentationService` existed but was unused | Confirmed HTTP 500; no print submission | Compose presentation service with clock, RNG, counts, and group-label resolver; renderer delegates to it |
| 2 | Fingerprint profiles | Writer expects `profileCache.refresh`; app passed the obsolete `configService` key | Profile can be written, then the request throws before cache refresh | Inject `profileCache.refresh -> configService.reloadUserProfile` |
| 3 | Health mentions | Router expects one `mentionSuggestions` capability; app twice supplied retired `healthAnalyticsService`, `healthStore`, and `healthService` keys | Mention routes dereference `undefined`; later router replacement repeats the same error | Compose one `HealthMentionSuggestions` and late-bind only optional analytics |
| 4 | Wikipedia | Router expects `wikipediaService`; app passed raw `adapter` | Configured Wikipedia routes call methods on `undefined` | Wrap `WikipediaAdapter` in `WikipediaService` |
| 5 | Printer control API | Router expects `printerService`; app passed `printerRegistry` | Printer API routes call methods on `undefined` | Compose `PrinterControlService` with fleet and print-outcome reader |
| 6 | Shared Fitness playable authority | `FitnessPlayableService` expects semantic `contentCatalog`; app passed `contentAdapter` and built a second service beside the router's correct one | Fitness router and Piano/School/Agents disagree; shared consumers have no catalog and separate caches | Export one `createFitnessPlayableModule` and share its service/catalog everywhere |
| 7 | Strava webhook enrichment | Constructor now expects `userContext`, `ensureActivityAccess`, `scheduleRetry`, and `historyRepository`; app supplied retired auth/config/path fields | Webhook enrichment lacks durable history, access preparation, and retries | Compose all four ports; share one YAML history repository with reconciliation |
| 8 | Ambient light zones | `startAmbientZones` expects gateway/publication factories and a clock; app supplied raw HA gateway and event bus | Function silently returns no running zones | Compose HA sensor gateway, event-bus publications per zone, explicit clock, and shutdown disposal |
| 9 | Main School router | Router moved to `coreErrors`, `slugify`, and seven semantic services; app retained the broad legacy dependency bag | Large route subsets receive null/undefined semantic capabilities | Add `createSchoolApiServices`; production and router tests use the same composer |
| 10 | Camera events | Router expects `cameraEvents`; app passed retired `broadcastEvent` | Event-producing camera control path cannot publish | Inject `CameraEvents` publication capability |
| 11 | Canvas image route | Router expects `getCanvasImage`; app relied on an old request-app fallback and supplied only `canvasService: null` | `/canvas/image/*` returns 503 despite configured base path | Compose `GetCanvasImage` with contained filesystem repository |
| 12 | Media lesson position | Router expects `positionReporter`; app passed retired `eventBus` | Playhead heartbeat is silently unavailable | Inject `LessonPositionReporter` over the existing School playback topic |
| 13 | EInk image sources | HTTP data gateway accepts a semantic `decodeImage`; app omitted it | JSON survives, but configured remote images silently degrade to caption-only | Inject the rendering canvas image decoder |
| 14 | Feedback resources | Service expects `resourcePresenter`; the migration default returned internal resource refs | Notification action receives an object instead of a public URL and cannot open the report | Inject `publicResourceUrl`, require the presenter whenever notifications are configured, and align the notification fixture |
| 15 | School material deadlines | Catalog and unit use cases expect `scheduler.withDeadline`; app omitted schedulers | Provider stalls are not bounded despite migrated timeout policy | Inject `NodeAsyncScheduler` into both use cases |
| 16 | Scheduled application jobs | Four jobs retained deleted `../lib` modules; no current application executor owned them | Confirmed repeated production failures | Add `ApplicationJobExecutor` and current handlers for budget, health, archive, and media validation |
| 17 | Barcode relay defaults | Firmware gateway expects `defaultDevice` and `defaultRoute`; app omitted both | Frames missing device/route propagate `undefined` and can misroute or corrupt logging | Inject `barcode-relay` and `content` defaults at the gateway boundary |

### 4.1 The School contract is nine contracts, not one argument rename

The School row comprises:

- `coreErrors`
- `slugify`
- `schoolApiSessions`
- `schoolResourceService`
- `schoolPrintAccess`
- `schoolRecordsQuery`
- `schoolReportDocuments`
- `schoolCurriculumQuery`
- `schoolArtifactService`

The test helper had enough knowledge to compose these semantic services, while
production still called the router with the legacy bag. The repair extracts that
knowledge into `backend/src/5_composition/modules/schoolApi.mjs` and makes both
production and tests call it. This removes the class of defect where a test helper
quietly fixes a production omission.

### 4.2 The scheduler repair does not resurrect `_legacy`

The four jobs now dispatch to current services:

- `budget` -> `FinanceHarvestService.harvest`
- `health` -> `AggregateHealthUseCase.execute`
- `archive-rotation` -> configured `ArchiveService` plus current NutriBot stores
- `media-memory-validator` -> `MediaMemoryValidatorService`

Archive rotation routes only ordinary time-based lifelog records through the generic
archive service. Summary/detail Strava data is left alone, and NutriBot records use
their own monthly archive stores.

The media validator now reads the deployed canonical schema (`plex:<id>` keys under
per-library YAML files), translates only at its adapter boundary, preserves old IDs,
and refuses destination collisions. A Plex 404 means an orphan; other provider errors
remain failures rather than being misclassified as missing media.

---

## 5. Already-repaired post-migration evidence

The unresolved list is not the migration's entire repair trail. The commits below
landed after `76f2089c3` and before this audit and contain additional composition or
runtime recovery work:

| Commit | Follow-up repair |
|---|---|
| `c2ff0294f` | Fitness shared-session reporting and integration auth |
| `586ee8ee4` | Arcade launch content catalog |
| `87f70e660` | Explicit gateway composition across app wiring |
| `55cb5ee01` | Bot and Fitness composition stability |
| `892625fdd` | Coaching nutrition configuration |
| `0eaa6b77e` | Feed and Art router dependencies |
| `25877cbec` | Rendered NutriBot report delivery; first composition registry |
| `3a7eaf4d3` | Story-time scheduler and realtime recovery after cold wake |
| `3afc9df04` | Bounded call recovery and authorized signaling |

These commits reinforce the same conclusion: passing static layer rules did not mean
the runtime dependency migration was complete.

---

## 6. Why the dependencies were missed

### 6.1 JavaScript made stale dependency names non-fatal

Factories destructure the names they understand and ignore the rest. Code such as:

```js
createWikipediaRouter({ adapter })
```

still constructs when the router now expects `{ wikipediaService }`. The error waits
for an HTTP request. The same pattern affected health mentions, printer, camera,
lesson position, ambient zones, and School.

### 6.2 Required capabilities were often implemented as optional degradation

Several new contracts default to null or no-op so installations can omit a feature.
That is appropriate for genuinely optional integrations, but it also lets a configured
production feature disappear silently:

- ambient zones return `[]` without a factory;
- EInk keeps JSON without an image decoder;
- material timeouts disappear without a scheduler;
- lesson position reporting becomes unavailable;
- Feedback returns an internal resource representation.

The runtime cannot distinguish “feature intentionally absent” from “composition forgot
the dependency.”

### 6.3 Tests stopped below or beside the broken boundary

The Gratitude router test injected a prebuilt canvas, and printer tests started with a
PNG buffer. Both correctly test their own layers and neither executes selection.

School tests constructed semantic services in a test-only helper. Production did not.
The tests therefore demonstrated that the router works when correctly composed, not
that `app.mjs` actually composes it correctly.

The four scheduler jobs were represented only by data in production `jobs.yml`.
Static imports and unit tests could not see that their module strings referenced files
deleted by the migration.

### 6.4 Data shape masked the Gratitude defect

The RNG guard is after early returns for empty pools and pools no larger than the
requested count. Small fixtures pass without an RNG. Production had 292 Gratitude and
163 Hope candidates, so it always entered weighted selection and failed.

### 6.5 The change was too large for contract-by-contract review

The migration touched 2,103 files and simultaneously:

- introduced new semantic services;
- renamed dependency keys;
- moved and deleted modules;
- changed test helpers;
- changed routers and application constructors;
- retained a very large handwritten composition root.

That is not proof that large changes always fail. It is evidence that this change
needed a generated contract inventory and a composed-runtime gate. Neither existed.

---

## 7. Responsibility and blame

### Direct change ownership

Git records KC Kern as both author and committer of `76f2089c3`. The commit message has
no co-author, reviewer, or pull-request metadata in the local repository. Therefore,
if “who is to blame” means “which recorded change owner introduced these stale
composition contracts,” the evidence-based answer is **KC Kern through commit
`76f2089c3`**.

No evidence in the repository identifies a separate reviewer, an AI tool, or another
person as the author of the omissions. It would be speculation to name one.

### Engineering-system responsibility

The more useful attribution is shared by the migration and its acceptance process:

1. The migration changed callee contracts without maintaining a caller checklist.
2. Production composition and test composition were allowed to diverge.
3. Required dependencies did not consistently fail at construction.
4. The merge gate emphasized layer/import compliance, not deployed runtime assembly.
5. The full snapshot's large regression signal was not used as a release blocker.
6. Production job configuration was not checked against deleted module paths.

The thermal printer, Home Assistant, Plex, and the household data are not responsible
for the missing dependencies. They were downstream of code paths that never reached
them.

This distinction matters: naming the commit owner answers accountability; fixing the
composition gates prevents recurrence.

---

## 8. Implemented repair

### Composition

- Replaced the inline Gratitude selection closure with
  `GratitudePrintPresentationService` and added fail-fast dependency validation.
- Added one shared, catalog-backed Fitness playable module for Fitness, Piano,
  School, and Agents.
- Wired Strava access, user context, retries, and one shared history repository.
- Extracted production School semantic-service composition and reused it in tests.
- Wired the health mention, Wikipedia, printer, ambient, camera, canvas, media lesson,
  EInk, Feedback, materials, fingerprint, and barcode contracts listed above.
- Disposed running ambient services when the server closes.

### Scheduling

- Added `ApplicationJobExecutor` as a scheduler dispatch seam.
- Registered all four production IDs before the dynamic legacy fallback.
- Configured `ArchiveService` with current config and DataService adapters.
- Added schema-aware YAML and Plex adapters for media-memory validation.

### Contract testing

- Expanded `test:composition-contracts` from four to eight production-boundary cases.
- Added focused tests for the application scheduler, executor dispatch, archive routing,
  media YAML renames/collisions, Plex error classification, Fitness catalog composition,
  Gratitude fail-fast construction, and a real Gratitude canvas render with three
  candidates per category.

---

## 9. Verification completed

| Check | Result |
|---|---|
| Parse gate | 8,910 modules parsed; 10,777 files scanned; pass |
| `test:refactor` | 19 files, 192 tests; pass |
| Composition contract registry | 1 file, 8 contracts; pass |
| New focused contract tests | 5 files, 10 tests; pass |
| Gratitude presentation/render tests | 1 file, 3 tests; pass |
| Fitness/Strava/Ambient/EInk/material regression selection | 68 Vitest tests plus 6 Node tests; pass when run by their correct runners |
| School router suites using production composer | 15 files, 202 tests; pass |
| Migrated printer/Wikipedia/Canvas/Health/Feedback/media-lesson surfaces | 7 files, 90 tests; pass |
| Fingerprint writer/cache refresh | 1 Node test file, 4 tests; pass |
| Syntax checks and `git diff --check` | pass |

One diagnostic command handed two Node `node:test` files to Vitest. Their TAP
assertions passed, but Vitest reported “No test suite found.” Running those files with
`node --test` produced six passing tests. This is a runner-selection issue, not a
product failure, and is recorded here so it is not mistaken for a red implementation
check.

---

## 10. Still required after merge/deployment

The local repair does not prove the physical printer produced paper and does not alter
the already-deployed container.

After deployment:

1. Call Gratitude card preview and require HTTP 200 with a nonempty PNG.
2. Confirm `selectItemsForPrint requires random` no longer appears.
3. Deliberately perform one controlled thermal print and inspect both the event chain
   and the physical paper.
4. Trigger or wait for each of the four application jobs and require `status: success`
   in `cron-runtime.yml`.
5. Inspect archive counts and media-validator results; never infer correctness only
   from the scheduler's success flag.
6. Exercise configured Wikipedia, printer API, Health mentions, Canvas image, ambient
   zone, camera control, EInk image, and Strava webhook paths.

Do not mark this report deployed or physically verified until those checks are done.

---

## 11. Prevention requirements

1. Every new required constructor/factory dependency must fail at construction.
2. Every cross-layer capability added by a migration must add a production-boundary
   case to `composition-contract-registry.test.mjs`.
3. Production and test helpers must share composition factories; tests may fake
   external edges, not reproduce production wiring independently.
4. A deletion gate must search configuration/data for module paths referring to files
   being removed.
5. Large migrations need a machine-generated table of changed callee signatures and
   every caller updated or explicitly waived.
6. A full parent-vs-candidate test comparison with hundreds of new failed files must
   block deployment until classified.
7. Optional degradation must log a structured “configured but unwired” error when
   configuration declares the feature.
8. Physical workflows must distinguish render, dispatch, verification, and durable
   state mutation in logs.

---

## 12. Final answer

The Gratitude thermal receipt did not print. The direct failure was a missing injected
RNG, but it was one example of a broader incomplete composition migration. The audit
found and locally repaired all 17 unresolved contract families traceable to the
runtime boundary after `76f2089c3`.

The recorded change owner is KC Kern. The preventable engineering failure was allowing
a 2,103-file boundary migration to pass static/refactor tests without proving the
production composition graph or its data-driven scheduled modules.
