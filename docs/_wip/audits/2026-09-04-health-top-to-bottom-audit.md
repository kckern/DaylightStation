# Health app — top-to-bottom audit, 2026-09-04

Audited code and deployed build: `7c3465f97c61ce9cdcf5f0bcd362a4820295c3b7`.

The original audit below records the baseline. Its reproduction notes and line
numbers are historical, not descriptions of the remediated code. Implementation
was subsequently approved under the [remediation plan](../plans/2026-09-04-health-audit-remediation.md).

## Implementation status — 2026-09-04

The operating objective is fewer actions: direct capture, predictable defaults,
one-tap logging when unambiguous, and one combined correction with Undo for deletion.

| Finding | Implemented correction | Verification / limit |
|---|---|---|
| F01 | Nullable gram contract across ledger, parsers, custom/UPC, catalog and templates; original quantity retained | Quantity/UPC/persistence tests; copied-history rehearsal. Unknown history is not guessed. |
| F02 | Consumed ledger is authoritative; replay cannot overwrite edited rows or resurrect deletions; Telegram changes use ledger; coach reads ledger | Real-store replay/edit/delete tests, revision conflict regression, Telegram group-date regression. Explicit capture revisions refuse intervening corrections. |
| F03 | Every affected source/destination summary is rebuilt, including empty dates | Last-delete, archive move, group, and HTTP boundary tests |
| F04 | Shared scaling for all eight nutrients, catalog per-key mass basis, per-key coverage and user corrections | Catalog density/scaling, budget, editor, template tests |
| F05 | Registry validates medical metric/unit/date/pairs; each reading displays its own unit | Service tests and 90 mg/dL / 5 mmol/L browser fixture |
| F06 | Immediate client latches, stable operation IDs, durable creation retry results, single barcode acceptance | Double-tap and lost-response tests; barcode browser journey. Legacy no-ID clients remain outside retry guarantee. |
| F07 | Resource-key guard and coherent `/day` entry/budget snapshot | Cold date transitions and real HTTP snapshot tests |
| F08 | Initial goals form plus explicit errors and validation | Missing-goals browser journey and goal-service regressions |
| F09 | All Health browser writes are fixture-owned; no UUID-difference cleanup | Eight journeys run without household mutations |
| F10 | Per-control capture tasks, local progress/errors, retained retry bytes/date/bucket, recorder cleanup | Held voice request and failed voice retry across tabs/dates |
| F11 | Shared mounted-resource invalidation; focus/visibility/30-second refresh for external changes; coach completion refresh | Hook/day/range regressions. Polling is not realtime push. |
| F12 | One validated journaled group command; HTTP retains cascade IDs and affected dates | Store batch conflict/recovery and HTTP group tests |
| F13 | Direct idempotent snapshot copy; no ephemeral meal create/log/delete | Lossless archived-group copy and retry HTTP tests |
| F14 | Centered exact-gram editor, combined Save/Cancel, advanced fields/evidence, favorite toggle, archive editing, delete/Undo | Editor regressions and full browser correction/delete/restore journey |
| F15 | Shared adaptive Sheet, focus trap/return, dismissal and reference-counted scroll locks | Browser Tab loop and Escape restoration; existing Sheet regressions |
| F16 | Monday–Sunday viewport independent of selection; three-letter days/month breaks; date/week URL; tab scroll retention | Browser Back, week paging, draft/date/scroll retention |
| F17 | Shared FoodIcon and fallback; stable catalog identity/pins resolved on new text/image/UPC capture | Icon/capture/catalog tests. Asset-vocabulary expansion is not faked with unrelated images. |
| F18 | Visible resource/command failures and retry; strict catalog/template YAML reads and durable writes | Error/draft tests; malformed-store test refuses overwrite |
| F19 | Food definition and template component/role management; prospective bucket portions shown before logging; remembered variants | Catalog/service/template/editor tests. Existing ambiguous foods are not auto-merged. |
| F20 | Logged/unlogged coverage, current-goal labels, calendar-spaced weight series and shared normalization | Budget/series/chart tests. No claim that an unlogged day means no food. |
| F21 | One shell-owned coach runtime and resolved identity; selected day/entry context; closed overlay does not fetch mentions | Agent/runtime regressions. Visible history retains last 80 messages in this browser session, not cross-device history. |

Verification before deployment:

- 1,999 scoped Vitest tests passed with zero failed suites. Seven files using
  `node:test` were run under their own runner: 31 additional tests passed, none skipped.
  Subsequent transport changes passed seven focused regressions and a broader
  358-test Health/nutribot/HTTP run, with no failed suites.
- Eight Chromium journeys passed against the **built** frontend, covering desktop
  and mobile. Dev-module boot telemetry was investigated; the built app has no
  unexpected mutation/boot-error requests in these journeys.
- Frontend production build and parse gate passed. Desktop editor and mobile draft
  screenshots were inspected; keyboard focus restoration was fixed after a browser
  regression exposed the mount-already-open lifecycle.
- A copy of actual nutrition history was repaired: 4,653 entries, 562 unresolved
  masses retained as unknown, verified backup, zero changes on the second dry run.
  Production apply/deployment are recorded below.

### Deployment and production conversion

- Deployed application commit: `292251b1b6d0f834b5b4cbc897858205754adb41`.
  `/build.txt` matched; the container and `/api/v1/ping` are healthy.
- Both pre-build and pre-restart activity gates were clear. Production was stopped
  and no dev backend was running before the repair. The source manifest still
  matched, and a complete private backup was hash-verified before any mutation.
- Production conversion completed: **4,653 entries**, **562 unknown masses**.
  Row count and per-entry nutrient digest matched before/after. A fresh inspection
  proposed **zero** further changes. The backup and before/after manifests are
  retained outside the repository in the operator's private state directory.
- Read-only live checks passed for identity, historical `/day`, suggestions,
  templates, medical, goals and range. The historical day contained ten rows;
  its computed budget matched the consumed ledger.
- **All eight browser journeys passed again against the deployed frontend**, with
  fixture-owned API mutations. No real food was created by those tests.
- Commit gates passed: filesystem/layer rules, UI tokens, ESM links, parsing,
  SCSS production compilation, and nine composition contracts. The post-deploy
  log-store query found no backend Health/nutrition errors in the checked window.

### Completion recheck — follow-up not yet deployed

Boundary/browser checks found additional gaps after the initial deployment:

- **F14/F19:** an old entry's snapshot name no longer finds its saved food after
  a rename. The editor now reads and toggles favorites by `foodId`; only legacy
  rows without an ID use name lookup. A real HTTP/YAML regression covers rename,
  reuse of the old name by another food, favorite isolation, and retained history
  after catalog removal.
- **F15:** entry → coach now transfers the original focus-return target. The
  overlay composer lets Escape dismiss its dialog without clearing its draft;
  mention popovers still handle Escape first.
- **F21:** the shell must own the **mounted conversation provider**, not just
  the runtime hook. Remounting the provider recreated the library's internal
  thread. `AgentConversationProvider` now stays mounted across both presentations.
  Real-runtime tests and the browser verify thread continuity and session reload.
- The final scoped regression run passed **2,012 tests**, with zero failed suites,
  including provider/Escape and repaired shell-routing fixtures.
  Four new browser journeys cover favorites, coach continuity, duplicate taps,
  and scanner teardown/reopen. Development runs also exposed intermittent
  `net::ERR_NETWORK_CHANGED` while loading Vite source modules; boot-error
  assertions remain enabled. The final development run passed nine journeys;
  three failed their boot-error assertion after passing the interaction checks.
  A clean built-frontend browser verdict is pending.

**Still required:** build the follow-up, run all twelve browser journeys against
the built frontend, deploy, and verify the deployed revision. The activity gate
currently reports active fitness/video and Portal use. No follow-up production
build or restart has been attempted over that activity. Production remains on
`292251b1b`, healthy. Do not repeat the completed historical conversion.

Intentional boundaries and follow-up work:

- YAML transactions are synchronous, durable and recoverable **within one writer
  process**. Multi-process deployments require fencing/locking first. The offline
  repair flag is an operator assertion; it does not stop services automatically.
- Historical conversion standardizes existing mass representation, not the accuracy
  of every old AI estimate. Uncertain catalog observations remain evidence, not
  silently corrected facts. Saved-food edits provide an explicit future override.
- Creation operation records/tombstones currently have no retention policy. Design
  compaction before very large multi-user growth; do not discard retry identities
  or deletion protection opportunistically.
- The app shell is a composition root; capture tasks, quantities, meal buckets,
  resources, editor and repair policy were separated. Further splitting the large
  API router is optional structural work, not a reason to rewrite working flows.
- No real AI-provider call, physical kitchen-scale transaction, or cross-device
  conversation synchronization is claimed by mocked browser tests.

See [Health reference](../../reference/health/README.md) and the
[repair runbook](../../runbooks/health-ledger-repair.md) for current contracts.

## Assessment

Health has a useful foundation and substantial regression coverage, but its feature completeness exceeds its integration completeness. Several individually reasonable components disagree about quantity, identity, mutation results, freshness, and what counts as reviewed. The largest risks are data consistency and misleading feedback, not the choice of drawer versus modal.

Keep the routed app shell, shared budget arithmetic, archive-aware reads, explicit measurement evidence, catalog density derivation, and small presentational chart components. Consolidate the entry model and write paths before extending the feature set. Rework the entry editor and calendar around actual correction and navigation tasks.

`HealthApp.jsx` is a reasonably small composition root. Most problems are in the dependencies it connects, rather than the entry point itself.

## Scope and evidence

Reviewed the app shell, Today, Progress, Medical, Coach wrappers, capture controls, editor, food/template pickers, shared resource hook and overlay primitive. Traced their relevant health routes, catalog/template/budget services, NutriList persistence, NutriLog projections, scale interfaces, and coach nutrition reader. Reviewed recent commits, the handoff, usability decision log, and prior observability audits.

Verification performed:

- **699 tests passed in 63 files**, using `npx vitest run frontend/src/modules/Health backend/src/3_applications/health backend/src/2_domains/health/services/catalogDensity.test.mjs backend/src/4_api/v1/routers/health.nutritionInput.test.mjs --maxWorkers=4 --reporter=dot`. This is a scoped verdict, not a new full-repository gate verdict.
- Chromium examination of the deployed app at 1440×1000 and 390×844, including entry opening, keyboard focus, date navigation, food picker and layout.
- Browser response simulations for capture failure, duplicate quick-add, portion mutation, favorite state, group-move response, delayed date loading, and missing goals.
- Actual persistence/service code against temporary data for quantity roundtrip, deleting the last daily row, log resync, catalog nutrient scaling, and mixed-unit medical records.
- Build metadata matched the audited commit. No real voice/AI submission, food mutation, medical mutation, or deployment was performed.

Evidence labels below distinguish a reproduced outcome from a code-derived concern. Existing passing tests are useful evidence of preserved contracts, but do not disprove the reproduced gaps.

## Recent work: what landed, and what remains incomplete

| Change | Sound improvement | Remaining gap |
|---|---|---|
| `f8897c1fe`, archive/day fixes | Day and range reads include archived entries under the same date rule | Archived entries still expose editing controls, although writes only search hot storage |
| `60c7e2f18`, viewed-date propagation | Normal capture and quick-add submissions carry the viewed date | Selected date is transient component state; retry context omits its original date; cold date loads retain old rows |
| `4e3970a62`, voice recovery | Audio is persisted before transcription and can be retried | Client capture errors and recorder lifecycle remain incomplete; retry affordance is transient |
| `dff385f79`, `b76c35ea5`, catalog density | Observation-based density is much safer than last-logged total | Gram identity and micronutrient portion basis remain inconsistent; custom/barcode paths still fabricate mass |
| `66b6664fe`, compact log/picker | Bounded food picker, tighter rows, responsive suggestion columns | Repeated capture controls and dashboard/navigation chrome remain a major part of the vertical footprint |
| `7c3465f97`, week/grams | Three-letter weekdays, month markings, explicit arrows, gram display | Week paging can skip dates; same-month label formats badly; “grams only” exposes fabricated grams from persistence |

The handoff describes an earlier deployment/branch state. Its resume checklist is historical, not a current task list. The decision log is valuable rationale, but its deferred findings need current triage; some were fixed, some persist, and new integration defects are now demonstrated.

## Dimension map

| Dimension | Strong | Weak / remaining work |
|---|---|---|
| Data model | Separate food/group concepts; explicit observation evidence | Multiple writable nutrition representations; grams and serving count conflated |
| Nutrition arithmetic | Shared counted-row rule and budget fold | Partial scaling; per-key unknowns flattened into row-level provenance |
| State and freshness | SWR cache and response-liveness guards | No coordinated invalidation; old date data can remain actionable |
| Capture | Several transports share the backend pipeline; durable voice bytes | Global busy state; duplicate submits; failure and device lifecycle gaps |
| Editing workflow | Group operations, measurement pairing, icon scope exist | Action menu rather than complete editor; partial writes; state leaks between entries |
| Navigation | Routed tabs and explicit date controls | Date absent from URL; week paging depends on selection; competing date controls |
| Layout and style | Capped desktop column, conditional sidebar, tokens | Tiny secondary type, repeated controls, overlay distance, excessive chrome on phones |
| Accessibility | Many icon buttons are named; group toggles expose expanded state | Dialog has no focus containment; combobox relationship incomplete |
| Catalog and reuse | Density evidence; bucket-aware suggestions; template variants | Weak food identity; no template management UI; copy loses data; icon promises differ by transport |
| Medical | Manual records with no automated interpretation | Different units are relabeled as one; weak schema and correction workflow |
| Progress and analytics | Shared chart models, explicit unavailable-budget gaps | First-use goals dead end; unlogged days treated as zero; sparse-date charts compress time |
| Coach and integrations | Shared agent surface; existing nutrition and measurement services | Coach reads a different nutrition representation; duplicate local chat runtimes; incomplete refresh |
| Maintainability | Pure helpers, explicit ports, composition layer, useful tests | Business transactions in JSX; repeated field/date definitions; legacy response protocol leaks into UI |
| Verification and operations | Many behavioral and persistence tests; build traceability | Obsolete live journeys; unsafe cleanup ownership; missing browser/HTTP contract tests |

## Findings requiring correction

Priorities: **P1** = wrong data, misleading quantities, data-loss risk, or blocked core workflow; **P2** = significant interaction/integration defect; **P3** = cleanup or optimization. These are implementation priorities, not claims that every case has occurred in user data.

### F01 — P1: grams are not a trustworthy field yet

**Reproduced in storage and visible in production.** `YamlNutriListDatastore.#normalizeItem` uses `grams: item.grams || item.amount || 0`. `saveMany` stores `item.grams || item.amount` as `amount`, without a separate grams field. An input with `grams: 0, amount: 1, unit: 'serving'` reads back as `grams: 1`. The latest row formatter now labels that `1 g`.

Quick-add falls back to zero grams and one serving even when the catalog has a canonical mass. The UPC catalog-hit branch constructs a one-serving product and then assigns its serving size to grams. Thus a known barcode can create a one-gram food record and donate misleading density evidence. This is more serious than inconsistent display units.

Use a canonical nullable mass field. Unknown mass must stay unknown; serving count and volume cannot become grams without an explicit conversion. Preserve original capture wording separately. A catalog default should carry the actual mass its nutrient totals describe. Custom-food creation must collect that basis.

Evidence: [persistence](../../../backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs) lines 135–143 and 238–268; [quick-add](../../../backend/src/3_applications/health/FoodCatalogService.mjs) lines 214–241; [UPC capture](../../../backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs) lines 124–131 and 174–185; [row display](../../../frontend/src/modules/Health/today/EntryRow.jsx) lines 33–38.

### F02 — P1: the editable ledger and source logs can overwrite one another

**Reproduced with the real datastore.** Starting with a two-item NutriLog, changing A from 100 to 50 kcal in NutriList and deleting B worked. Resyncing the original log restored A to 100 kcal and brought B back.

Health edits only NutriList; `syncFromLog` removes all rows for a log and reconstructs them from NutriLog. A real caller of that resync is the Telegram item-delete flow, which edits the source log. Separately, the coach's nutrition event adapter reads NutriLogs, while quick-add/template entries are written directly to NutriList. The coach can therefore miss those entries and disagree with web corrections even without a resync.

Choose one authoritative consumed-food ledger. Given the current direct-write paths, making entries authoritative and treating capture logs as evidence is a practical direction. Route every transport's changes through the same commands, and derive coach/report views from that authority. This does not require full event sourcing.

Evidence: [HealthOperations](../../../backend/src/3_applications/health/HealthOperations.mjs) lines 154–191 and 235–238; [syncFromLog](../../../backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs) lines 155–198; [Telegram delete](../../../backend/src/3_applications/nutribot/usecases/DeleteListItem.mjs) lines 65–93; [coach reader](../../../backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs) lines 23–25 and 59–70.

### F03 — P1: deleting the last food leaves a stale daily summary

**Reproduced with actual persistence.** Save one 200-kcal row, then delete it. The day query is empty, but `nutriday.yml` still reports 200 kcal and includes the deleted food.

`syncNutriday` only recomputes dates present in the remaining rows. The now-empty date never enters that loop. A date move similarly refreshes only the destination date. The summary fold also does not use the shared counted-row predicate. Consumers such as the nutrition lifelog extractor can disagree with the day ledger.

Recompute every explicitly affected date, including empty source dates, with one shared aggregation rule. Update source and destination on date moves.

Evidence: [update and summary sync](../../../backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs) lines 354–359 and 601–651; [extractor](../../../backend/src/1_adapters/lifelog/extractors/NutritionExtractor.mjs).

### F04 — P1: portion scaling leaves micronutrients at the original portion

**Reproduced in browser payloads and the catalog entity.** Doubling a 100 g food sent grams 200 and doubled calories/macros, but retained fiber 5 and sodium 300 in the simulated stored row. `FoodCatalogEntry.nutrientsForGrams(200)` has the same problem: macros double, micros remain unchanged.

Micros are donated as independent latest per-key totals without a mass basis. Simply multiplying them by a canonical macro factor is not necessarily valid either: their source portions may differ. Row-level `microsSource` additionally marks all four nutrients covered when only one was supplied; `BudgetService` assigns the same coverage count to every micro.

Store nutrient values with their portion basis and per-key provenance/availability. Centralize scaling of all extensive quantities. Preserve unknowns rather than converting them to reassuring zeros.

Evidence: [editor scale](../../../frontend/src/modules/Health/today/EntryEditSheet.jsx) lines 18–28; [catalog scaling/donation](../../../backend/src/2_domains/health/entities/FoodCatalogEntry.mjs) lines 102–126; [coverage](../../../backend/src/3_applications/health/BudgetService.mjs) lines 243–255. The store also has a separate `updatePortion` implementation that scales more fields, demonstrating existing semantic duplication.

### F05 — P1: medical history can display the wrong unit

**Reproduced at the service boundary; rendering is explicit in code.** Store glucose 90 mg/dL followed by 5 mmol/L. The service groups both under `unit: 'mmol/L'`; the frontend renders every reading with `group.unit`. The older reading is consequently displayed as 90 mmol/L, without conversion.

Render each reading's own unit. If a comparable series is wanted, normalize with an explicit metric/unit conversion contract. Add a metric registry for identifiers, permitted units and paired fields, plus real calendar-date validation. This is a data-display defect, independent of any medical interpretation.

Evidence: [MedicalReadingsService](../../../backend/src/3_applications/health/MedicalReadingsService.mjs) lines 23–29 and 39–49; [MedicalView](../../../frontend/src/modules/Health/medical/MedicalView.jsx) lines 90–95.

### F06 — P1: repeated taps can create duplicate food

**Reproduced with browser-intercepted requests.** Clicking the same quick-add option twice while the first request waits sends two POSTs. Setting `phase='parsing'` shows a loader but does not disable options, the input, or Enter handling. The inspected write boundary has no idempotency key.

Barcode capture has a related code-derived risk: its effect depends on an inline `onDecode` callback recreated by TodayView. Submitting changes parent state and can restart detection while the request is pending. The ZXing callback has no one-result latch, and the native path has no persistent submitted guard across effect restarts. Camera denial also remains in component state across reopen.

Guard client submits immediately with a stable operation ref; add server idempotency for creation. Make scanner ownership independent of parent rerenders and retire the detector after its first accepted result.

Evidence: [AddCombobox](../../../frontend/src/modules/Health/today/AddCombobox.jsx) lines 58–68 and 119–148; [BarcodeCapture](../../../frontend/src/modules/Health/capture/BarcodeCapture.jsx) lines 23–66; [inline callback](../../../frontend/src/modules/Health/today/TodayView.jsx) line 351.

### F07 — P1: old rows remain actionable under a newly selected date

**Reproduced by delaying the new date's response.** The heading changed to Yesterday while today's rows remained visible and clickable.

On a cold path change, `useApiResource` sets loading but does not clear or identify its old data. `useHealthDay` still returns those items; TodayView's `day.loading && !day.items.length` is false, so it keeps rendering them. The two independent day requests can also finish separately, briefly showing rows and totals from different dates.

Associate each result with its resource key. Retain stale data only for revalidation of the same day; a different day needs its own cached snapshot or loading body. Guard mutations against mismatched displayed-date/entry context.

Evidence: [resource hook](../../../frontend/src/lib/hooks/useApiResource.js) lines 118–130; [useHealthDay](../../../frontend/src/modules/Health/today/useHealthDay.js) lines 15–23; [TodayView](../../../frontend/src/modules/Health/today/TodayView.jsx) cold-loading calculation.

### F08 — P1: first-use goal setup is a dead end

**Reproduced with `{ goals: null }`.** Progress renders neither goal inputs nor a Save button after loading completes. Its form is seeded only when a goals object exists; `!form` permanently renders LoadingState. A failed goals request has the same appearance because its error is not surfaced.

Today directs an unconfigured user to this page. Provide a real initial form and separate loading, absent, error, editing and saved states. Validate core goal fields before persistence: current service validation primarily protects macro/watch-micro additions, not the complete budget inputs.

Evidence: [ProgressView](../../../frontend/src/modules/Health/progress/ProgressView.jsx) lines 58–67 and 203–205; [goals storage](../../../backend/src/1_adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs) lines 14–17; [goal validation](../../../backend/src/3_applications/health/BudgetService.mjs) lines 47–94 and 176–179.

### F09 — P1: a live test can delete food it did not create

**Code-proven; intentionally not executed.** The sentence journey snapshots all existing UUIDs, then deletes every new UUID in `afterEach`. A user, kitchen scale, or concurrent test creating food during that interval is indistinguishable from the test's own food.

The same journey still expects the retired pending Accept card. The barcode journey uses a singular `/barcode/i` button query even though the app now has several matching controls. These are obsolete end-to-end journeys, not evidence that current UX works.

Run mutations against isolated data and delete only IDs returned for that test's operation. Repair the journeys before treating them as a deployment gate.

Evidence: [sentence journey](../../../tests/live/flow/health/health-sentence-parse.runtime.test.mjs) lines 14–26 and 30–46; [barcode journey](../../../tests/live/flow/health/health-barcode-lifecycle.runtime.test.mjs) lines 71 and 83.

### F10 — P2: capture state and recovery are shared too broadly

**Reproduced.** One photo submission produced **10 loading capture buttons**. A simulated 500 produced an unhandled browser rejection and no visible capture notice. This confirms the user's spinner report remains unfixed.

`nutrition.busy` is passed to every mic and camera. The hook records `error`, but TodayView does not render it; FileReader callbacks invoke asynchronous handlers without catching their rejection. Microphone denial only logs a warning. VoiceCapture has no unmount cleanup for an active MediaRecorder/stream. Its stream is stopped only on normal recording stop.

Create operation state with an origin control ID, type, captured date/bucket, phase, error, and recoverable recording ref. Show progress at that origin and its destination meal. Make device cleanup explicit. Retain retry context across navigation: currently `captureRetry` stores audioRef and bucket, but retry uses the then-current viewed date.

Evidence: [TodayView](../../../frontend/src/modules/Health/today/TodayView.jsx) lines 53, 230, 251–257, 337 and 348; [VoiceCapture](../../../frontend/src/modules/Health/capture/VoiceCapture.jsx) lines 34–61; [PhotoCapture](../../../frontend/src/modules/Health/capture/PhotoCapture.jsx) line 38; [input hook](../../../frontend/src/modules/Health/capture/useNutritionInput.js).

### F11 — P2: mutations refresh some visible views but leave others stale

**Reproduced.** A portion change reloaded the day resources; the number of range requests remained 2 before and after the mutation. Week and month bars retain their earlier numbers.

`day.reload()` refreshes only list and day budget. Range widgets, observations, pending scale logs, catalog suggestions and dashboard each own separate refresh behavior. Window focus refreshes only the day pair, so scale evidence/pending records can remain stale after returning from another application. A coach write has no explicit invalidation of the visible ledger either.

Use one health mutation result to invalidate affected dates and resource families. Refresh mounted range views that include a changed date. Include external scale/coach updates through an existing notification mechanism or scoped revalidation, with a visible freshness/error policy.

Evidence: [useHealthDay](../../../frontend/src/modules/Health/today/useHealthDay.js) lines 34 and 46–50; [TodayView resource ownership](../../../frontend/src/modules/Health/today/TodayView.jsx) lines 70–90; [range hook](../../../frontend/src/modules/Health/today/useBudgetRange.js).

### F12 — P2: group mutation contracts are incomplete

**Reproduced response mismatch.** The editor checks `result.cascadedIds`; HealthOperations produces it; the HTTP route returns only `{ message, data }`. The browser therefore warns that children did not move after a response with the real route's shape, irrespective of whether the cascade succeeded.

The component test fabricates `cascadedIds`, so it passes while the actual boundary loses the field. Separately, group scale/delete orchestrate N writes from JSX; group move updates the parent before children. These are not atomic group operations. Partial failures leave the editor holding an old row/children snapshot, which is a poor basis for retrying.

Move group commands into an application service with a defined atomicity/recovery contract and return the actual affected IDs/version. Test across the HTTP boundary. Group detail should show its rollup, not the group's deliberately zero nutrient fields.

Evidence: [editor](../../../frontend/src/modules/Health/today/EntryEditSheet.jsx) lines 139–182, 247–310 and 318; [operation](../../../backend/src/3_applications/health/HealthOperations.mjs) lines 184–190 and 214–230; [route](../../../backend/src/4_api/v1/routers/health.mjs) lines 584–594; [test](../../../frontend/src/modules/Health/today/EntryEditSheet.test.jsx) line 145.

### F13 — P2: Copy to today is a lossy, multi-step transaction

**Code-proven.** TodayView maps the meal to name/calories/macros/color, creates a persistent saved meal, logs it, then deletes the saved meal. SavedMealsService drops grams, micros, icons, provenance and group relationships, writing one serving with zero mass. F01 then exposes that as a gram on read.

Failure after the log succeeds but before cleanup is reported as a failed copy; retry can log it again. Saving a bucket as a template separately includes flat group-header rows as ordinary components instead of preserving/excluding their grouping semantics.

Provide a direct copy command over entry IDs and a destination, with an explicit snapshot contract, hierarchy treatment, full nutrient/mass preservation, and idempotency. Retire ephemeral saved-meal transport once no caller needs it.

Evidence: [copy mapping](../../../frontend/src/modules/Health/today/TodayView.jsx) lines 131–138; [saved-meal snapshot/write](../../../backend/src/3_applications/health/SavedMealsService.mjs) lines 17–24 and 71–87; [save-bucket mapping](../../../frontend/src/modules/Health/today/TodayView.jsx) lines 161–175.

### F14 — P2: the entry surface is not yet a complete correction workflow

**Observed in the deployed editor.** It offers multipliers but no editable gram weight; an ordinary food cannot be renamed there; nutritional corrections lack direct fields. Icon controls precede the frequent portion task. Each operation usually saves immediately and closes, forcing repeated reopening for multiple corrections.

**Reproduced state leak:** favorite A, close, open B: B displays “Favorited” with its button disabled. `starred` is local state that never resets with row identity. Error/busy state is also not comprehensively reset. Existing favorites are not read into this state, and unfavoriting is unavailable.

Replace the desktop drawer with a compact centered editor and a mobile bottom sheet. Lead with name, icon and exact grams, followed by derived nutrition and meal. Put uncommon evidence/icon actions behind disclosure. Make Save/Cancel semantics explicit and keep delete visually separate. Keep state bound to entry identity and current server version.

Archived entries need a read-only presentation or a supported archive-edit command; offering controls that inevitably return Not Found is not a useful workflow.

Evidence: [EntryEditSheet](../../../frontend/src/modules/Health/today/EntryEditSheet.jsx) lines 45–75, 330–337, 427–480; [hot-only lookup](../../../backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs) lines 329–332.

### F15 — P2: the overlay primitive is not keyboard-modal

**Reproduced in the real browser.** Opening an entry left focus on its background row; pressing Tab moved to the next food behind the scrim. `aria-modal` is present, but there is no focus trap, initial focus placement, or restoration mechanism.

Sheet uses the dismiss stack while ChatOverlay uses an independent document Escape listener and its own body scroll lock. Opening multiple overlays therefore has inconsistent dismissal/locking ownership. The app's actual scrolling element is the chrome main region, while these primitives lock body.

Build or reuse one accessible adaptive dialog primitive with focus containment/restoration, clear labeling, centralized dismissal, scroll ownership and reduced-motion behavior. Implement the entry modal using that primitive, not another local overlay.

Evidence: [Sheet](../../../frontend/src/lib/ui/Sheet.jsx) lines 18–40; [ChatOverlay](../../../frontend/src/modules/Health/ChatOverlay/index.jsx); [AppChrome](../../../frontend/src/lib/ui/AppChrome.jsx).

### F16 — P2: week navigation still skips and mislabels dates

**Reproduced.** With Aug 29–Sep 4 visible, select Aug 29, then Previous week: the new viewport becomes Aug 16–22. Aug 23–28 is skipped because paging derives the new end from selected date instead of viewport end.

The same-month date formatter produced `Aug 16 – 2026 (day: 22)` in Chromium. Requesting day and year without month is not a reliable compact range format. Next-arrow state depends on selected date rather than viewport bounds. Today and selected day also both get similar accent outlines; the distinction is weaker than the implementation comments imply.

Use predictable contiguous weeks, page the viewport independently, choose selection deliberately, and format date ranges explicitly. Persist viewed date in route/query state so tab changes, reload and browser Back preserve location. Keep one coherent relationship between the header date stepper and week strip.

Evidence: [WeekStrip](../../../frontend/src/modules/Health/today/WeekStrip.jsx) lines 18–25 and 51–74; [TodayView date state](../../../frontend/src/modules/Health/today/TodayView.jsx) line 32.

### F17 — P2: icons have a coverage problem and an inconsistent override contract

The hi-res manifest deliberately lacks equivalents for many legacy food slugs. Neutral dots are an intentional honest fallback, not proof that parsing missed the food. This should remain distinct from an image request failing or a food having no assigned icon.

The ledger has failure handling, but the editor's current-icon image does not; a broken image was visible in the deployed drawer. Template icon handling differs again. “Always for this food” pins the catalog and current row, but new text/image capture constructs its row icon from model output without resolving that catalog pin. UPC classification similarly chooses independently. The promise holds for quick-add more strongly than for capture.

Share icon resolution/fallback in one component and one food-identity policy. Apply explicit food pins consistently across capture transports. Keep vocabulary coverage/migration work separate from renderer work; a guessed dish illustration is not a substitute for a missing generic food asset.

Evidence: [entry override](../../../frontend/src/modules/Health/today/EntryEditSheet.jsx) lines 220–237 and 366–372; [text mapper](../../../backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs) around line 583; [image mapper](../../../backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs) around line 523; [UPC classifier](../../../backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs) lines 154–177; [handoff rationale](../plans/2026-09-04-health-handoff.md).

### F18 — P2: errors are repeatedly presented as empty data

Progress ignores range errors; WeightChip ignores its resource error; Today ignores pending/observation resource errors; TemplatePicker ignores its list error and can say no meals exist. Entry confirmation and medical deletion failures are logged without an actionable user message. Text submission ignores the capture response and always closes on HTTP success, dropping no-food/moved outcomes that voice/photo attempt to surface.

Standardize loading, absent data, unavailable service, mutation failure and retry states. An unavailable scale feed must not look like “nothing to review.” An empty template list must not stand in for a failed request. Give text capture the same structured result handling as other inputs.

Evidence: [ProgressView](../../../frontend/src/modules/Health/progress/ProgressView.jsx) lines 190–205; [WeightChip](../../../frontend/src/modules/Health/today/WeightChip.jsx) lines 23–29; [TemplatePicker](../../../frontend/src/modules/Health/today/TemplatePicker.jsx) lines 30–34; [text submit](../../../frontend/src/modules/Health/today/AddCombobox.jsx) lines 94–112; [EntryRow confirmation](../../../frontend/src/modules/Health/today/EntryRow.jsx) lines 46–55.

### F19 — P2: reuse and catalog management are only partially exposed

The template backend supports removal, but the active-template UI primarily offers logging. There is no complete rename/edit-components/delete workflow. Custom food does not collect a gram basis. Catalog identity is normalized display-name matching, while logged rows do not consistently carry a stable food ID. This makes edits, pins, duplicates and provenance harder to reconcile.

The add picker shows canonical calorie totals, but quick-add may use a different remembered meal-specific mass. A number offered before the tap can therefore differ from the number logged after it. Show the actual proposed grams and corresponding calories together.

Provide deliberate food/template management, stable references plus historical display snapshots, and a shared prospective quick-add calculation. Do not auto-merge historical foods solely because their names look similar.

Evidence: [TemplatePicker](../../../frontend/src/modules/Health/today/TemplatePicker.jsx); [TemplateService](../../../backend/src/3_applications/health/TemplateService.mjs) removal/instantiate methods; [CustomFoodSheet](../../../frontend/src/modules/Health/capture/CustomFoodSheet.jsx) lines 39–46; [catalog identity](../../../backend/src/2_domains/health/entities/FoodCatalogEntry.mjs) normalize/matches methods; [suggestion calorie display](../../../frontend/src/modules/Health/today/AddCombobox.jsx) line 173.

### F20 — P2: analytics need to distinguish logging completeness from consumption

Missing budget data has an explicit gap representation, which is good. But a computable day with no entries is a zero-food day, and is treated as under budget and included in intake averages. The app cannot infer that an unlogged day means no food was eaten. “Adherence” and “avg in” over sparse logging overstate what the data can establish.

Prefer “logged intake” wording and expose tracking coverage. If completed-day status is introduced, make it explicit rather than inferring it from zero. Historical goal calculations use current goals; document that interpretation or version goals if historical adherence must mean the target that applied then.

WeightSeries uses the last N records, evenly spaced, while labeling a day window; a sparse history can span much longer than N days. Its seven-day delta can use a much older comparison reading. Progress has another date/weight normalization path. Share calendar-aware weight-series logic and label the actual comparison interval when data is sparse.

Evidence: [BudgetService](../../../backend/src/3_applications/health/BudgetService.mjs) range fold; [MonthBlock](../../../frontend/src/modules/Health/today/MonthBlock.jsx) known/over counts; [IntakeBurnChart](../../../frontend/src/modules/Health/progress/IntakeBurnChart.jsx); [weightSeries](../../../frontend/src/modules/Health/today/weightSeries.js) lines 50–99; [ProgressView](../../../frontend/src/modules/Health/progress/ProgressView.jsx) weight normalization/chart setup.

### F21 — P2/P3: the shell mounts two separate coach experiences

Coach tab and overlay each instantiate AgentChatSurface with independent local runtimes. The overlay remains mounted while closed, including its mention fetch. Their persistent thread key is shared by agent/user, but their visible message state is not shared or rehydrated here. Tab remounts and switching between tab/overlay can therefore lose conversational continuity in the UI.

The app also captures `window.DAYLIGHT_USER_ID || 'default'` at module load, while most health data routes use the household default. The observed browser fetched mentions for `user=default`. The exact downstream identity behavior needs a contract test before calling it a data-exposure defect; the inconsistency itself is real.

Own one conversation state above the two presentations; mount expensive hidden work deliberately. Pass selected day/entry context explicitly when opening the coach. Resolve identity through one supported app/auth contract. Revalidation after a coach mutation belongs to F11.

Evidence: [HealthApp](../../../frontend/src/Apps/HealthApp.jsx) lines 42 and 66–74; [ChatOverlay](../../../frontend/src/modules/Health/ChatOverlay/index.jsx); [AgentChatSurface](../../../frontend/src/modules/Agent/AgentChatSurface.jsx) runtime and mentions effect; [agent runtime](../../../frontend/src/modules/Agent/runtime.js) thread key; [mentions route](../../../backend/src/4_api/v1/routers/health-mentions.mjs) user parameter.

## Layout, style and everyday use

The recent compacting and bounded picker changes are improvements worth retaining. At 390 px the document had no horizontal overflow. The larger app still spends substantial space on two date-control rows, the week chart, weight context, empty meal frames, twelve per-meal capture buttons, and a separate four-control floating bar. The phone's main scroll region measured 745 px high with 1173 px of content on the inspected day, and the floating bar covered content while browsing the middle of the page. Bottom padding permits eventual access but does not eliminate that obstruction.

Weekday labels measured 10.24 px and meal headings 10.88 px. Further blanket font shrinking would buy density by reducing readability. Prefer reducing repeated controls and secondary chrome, while retaining usable action targets. The equation should name its quantities or otherwise make Budget/Food/Exercise/Remaining unmistakable. “Health” as a tab inside Health is less clear than “Medical” or “Measurements.”

For the editor, a centered desktop modal is still the recommendation. The current primitive produces a 420 px-wide right panel; the frequent task is correcting one food, so the large gaze movement buys little. On mobile, a bottom sheet can retain context while keeping its main action reachable. Exact gram entry should be the primary interaction; multiplier chips can remain shortcuts.

The add surface has a boundary now, but lacks a complete combobox accessibility relationship: input label, expanded/controls/active-descendant state, and consistent keyboard navigation. It also lacks a dedicated visible sentence-submit action and clear progress/result treatment. Fix these with a shared primitive rather than hand-maintaining another keyboard interaction model.

## What should be abstracted

| Boundary | Put here | Concrete benefit |
|---|---|---|
| Food entry contract | Stable IDs, display name, nullable grams, nutrient basis/provenance, group relationship, original capture context | Eliminates `name/item/label`, `id/uuid`, `grams/amount` repair logic distributed through consumers |
| Nutrition commands | Add, set grams/scale, copy, move, confirm, delete; affected IDs/dates; idempotency and version checks | Removes transactions and authoritative arithmetic from JSX; gives web, Telegram and coach one write path |
| Capture operation controller | Origin control, immutable target date/bucket, media lifetime, phase, structured outcome, retry ref | Fixes shared spinners, lost retry context, duplicate submits and invisible errors together |
| Health resource coordination | Keyed date snapshots, dependent invalidation, cross-surface refresh, external-change policy | Keeps equation, list, week/month, measurements and suggestions coherent |
| Adaptive dialog | Desktop modal/mobile sheet, focus trap/restore, dismiss stack, scrolling, footer | Solves the drawer request and accessibility consistently across entry/custom-food/medical/template flows |
| Food presentation | Manifest lookup, explicit pin resolution, image failure, neutral fallback, gram formatting | Makes icon behavior and quantity presentation consistent |
| Shared small vocabularies | Meal buckets, hour policy, dates, nutrient descriptors/units, snapshot fields | Removes actual semantic duplication without creating a generic framework |

There are currently two deliberate but conflicting hour-to-meal policies: the quick-add family uses `<11/<15/<20`, while nutrition schemas/currentMealBucketId use `5–12/12–17/17–21`. Several services separately implement local-date helpers even though a shared helper exists. The code comments acknowledge these differences; they are not newly discovered regressions, but they should become one explicit product policy.

TodayView mixes page composition with copying, saving, capture orchestration, retry, observation projection and notice policy. EntryEditSheet mixes layout with scaling, group transaction orchestration, catalog mutations, pairing and icon lookup. Split by those responsibilities rather than arbitrary file size. The health router can be split by capability while retaining one composition module and shared request/response contracts.

The web adapter still exposes Telegram-style messages/choices, and TodayView infers whether food was committed from the presence of choices. A typed outcome such as committed/no-food/retryable-failure, with entry IDs and resolved target, would remove that transport dependency without rewriting the Telegram presentation.

## What is strong and should be preserved

- **Budget arithmetic and counted-row semantics:** the server and frontend share the count predicate; day/range folds share calculation logic. Extend it to remaining summaries instead of creating another total.
- **Archive-aware reads:** the real-datastore tests cover a formerly serious day/range discrepancy. Keep them; add explicit editing capabilities to the read model.
- **Catalog density evidence:** a bounded observation ring and deterministic reconciliation address portion variability better than last-value overwrite. Repair mass/provenance boundaries around it.
- **Measurement evidence:** raw observations, consumed/open/dismissed status, whole-placement pairing and refusal of unsafe reassignment are useful domain distinctions. Keep them out of ad hoc UI arithmetic.
- **Voice durability:** persist-before-transcribe and server retry are valuable; complete the client lifecycle.
- **Pure presentation models:** grouping, bar geometry and weight helpers are testable without needing screenshots for every arithmetic case. Preserve this separation while sharing the correct date/nutrient definitions.
- **UI shell/layout:** routed tabs, design tokens, capped columns, one mounted sidebar tree and bounded suggestions are appropriate building blocks.
- **Test depth and logging:** many meaningful regression and persistence tests exist, and core mutations emit structured events. The next investment is testing boundaries between those components, not inflating the count with more isolated render assertions.

## Verification gaps to close

Passing isolated tests concealed the missing `cascadedIds` response field because the frontend mocked a response the real API never sends. The current suite also passed while browser probes reproduced ten spinners, two duplicate quick-add requests, an unhandled capture failure, favorite-state leakage, and the first-use goals dead end.

The most valuable next tests are:

1. Every food creation path roundtrips truthful grams, all nutrient quantities, provenance and stable identity.
2. Edit/delete, followed by a different transport's operation or projection refresh, never reverts or resurrects food.
3. Last-row deletion and date moves update all affected daily views and summaries.
4. Real HTTP response contracts for group commands and structured capture outcomes.
5. Delayed/reordered requests preserve date identity; successful writes update mounted ranges and scale evidence.
6. Browser journeys for one active spinner, duplicate-tap protection, scanner teardown/reopen, failed capture recovery, exact-gram editing, keyboard-modal behavior, and missing goals.
7. Mixed-unit medical history preserves the unit of every value.

Repair the old live test ownership/cleanup model before running those journeys against any shared dataset. Use fixture-backed browser tests for interaction cases and narrowly owned IDs for any genuine integration test.

## Recommended order of work

1. **Protect data truth:** F01–F05 and F09; decide canonical entry ownership and implement the smallest command/projection corrections that establish it. Include server-side creation idempotency.
2. **Make operations coherent:** F06–F08 and F10–F13; capture ownership, keyed day data, resource invalidation, group contracts, lossless copy, first-use setup.
3. **Redesign the correction/navigation experience:** exact-gram modal, entry state, focus management, stable date URL/week behavior, concise visible outcomes. Reduce repeated chrome before further shrinking fonts.
4. **Complete reuse and integrations:** template/catalog management, cross-transport icon pins, coach data/conversation continuity, analytics coverage and calendar semantics.
5. **Optimize after measurement:** lazy-load heavy route-specific UI, avoid hidden coach work, consolidate genuine duplicate helpers, and remove retired code only after checking its remaining consumers. A wholesale rewrite or database migration is not established as necessary by this audit.

Completion should be judged by the end-to-end invariants above and usable browser journeys, not by whether all items in the previous feature program were checked off.
