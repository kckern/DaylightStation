# DDD Layer Compliance Mega-Audit

**Date:** 2026-07-06
**Scope:** All of `backend/src/` (0_system, 1_adapters, 1_rendering, 2_domains, 3_applications, 4_api) plus entry points (`backend/index.js`, `backend/src/app.mjs`, `backend/src/server.mjs`) — ~1,374 files, ~198k lines.
**Audited against:** `docs/reference/core/layers-of-abstraction/*.md` (ddd-reference, system, domain, application, api, rendering), `docs/reference/core/adapter-layer-guidelines.md`, `docs/reference/core/backend-architecture.md`, `docs/reference/core/coding-standards.md`.
**Method:** Seven parallel audit passes (one per layer + one cross-cutting SSOT/DRY sweep), each combining exhaustive grep sweeps with file reads to verify every finding. Every finding below carries file:line evidence that was confirmed by reading the file. Counts come from greps over non-test `.mjs` files unless noted.

---

## Executive Summary

The architecture is **real but unevenly enforced**. The core promise — numbered layers with dependencies pointing inward — holds in the newer bounded contexts (playback-hub, nutribot/journalist containers, feed sources, telegram/plex clients, home-dashboard handlers) and is **fiction at the edges**: the composition root imports upward 211 times, five admin routers ARE the persistence layer, the fitness vertical violates nearly every rule at every layer, and the guideline docs' own flagship examples deviate from the docs.

### The eight systemic diseases (everything else is a symptom)

1. **There is no single composition root.** Wiring is split across `bootstrap.mjs` (4,252 lines), `app.mjs` (2,914 lines, ~1,950 of them inside one router-creation function), a newer `0_system/bootstrap/` folder, rogue composition roots inside `3_applications` (`camera/index.mjs`, `DeviceFactory`), factory functions at the bottom of adapter files, and fallback `new X()` calls inside routers. The same dependency edge (`fitnessHistoryDir`) is wired in three places. Because bootstrap lives in `0_system`, the documented rule "`0_system` → standalone, no upward imports" is false by 211 imports (95 `#adapters`, 68 `#apps`, 29 `#api`, 19 `#domains`).

2. **Doc/code contradictions are written into the code itself.** At least four files carry comments that *argue against the guidelines*: `NewsReporterContainer.mjs` ("this is the one place in 3_app allowed to import concrete 1_adapters"), `2_domains/media/ports/IMediaQueueDatastore.mjs` (defends domain-layer ports), `2_domains/core/utils/time.mjs` ("moved to domain layer as shared kernel" while the guideline's example imports it from `#infrastructure`), and `newsreporter/sinks/PrinterSink.mjs` (claims `#rendering` imports are legal in 3_app). Each needs an explicit ruling — update the doc or the code — or every future audit re-flags them. See the **Decision Register** below.

3. **Serialization ownership never migrated.** 75 domain files define `toJSON()`, 29 define `static fromJSON()` (~25% of the domain layer); 20+ datastores delegate hydration to those entity methods instead of owning `#hydrate`/`#dehydrate`. Storage format is welded to entity shape across two layers. This is the single largest structural debt and needs a written migration plan, not spot fixes.

4. **The error architecture is specified but unimplemented.** The four prescribed system error classes (`ConfigurationError`, `SchedulerError`, `EventBusError`, `FileIOError`) exist **nowhere** (0 hits); only 5 of 295 adapters (1.7%) set `isTransient`; 130 generic `throw new Error` in the domain layer, 57 in system; `errorHandlerMiddleware` is adopted by 3 of 82 routers while 38 files hand-roll 157 `catch → res.status(500)` blocks, most leaking `err.message` to clients.

5. **SSOT failures with user-visible drift.** Fitness zone thresholds disagree numerically between two files in the *same domain* (hot = 0.8·maxHr in one, 0.85 in the other → 148 vs 157 bpm at maxHr 185); zone colors have two divergent palettes (domain vs timelapse renderer); `'America/Los_Angeles'` is hardcoded 96 times in 49 files while ConfigService itself defaults to UTC in one accessor and LA in another; the household folder convention is implemented three times; 20 call sites string-build `'household'` paths, silently breaking multi-household.

6. **Two generations of code coexist, and the old one concentrates the violations.** Compliant: playback-hub, home-dashboard, nutribot/journalist containers, feed source adapters, telegram/plex/immich clients, newer domains (concierge, barcode, playback-hub entities). Violating: the **fitness vertical** (god-router, Strava/Plex-shaped app services, adapter business logic, public-field entities), **piano** (router-as-backend), **harvester + proxy adapters** (100% of adapter configService-singleton imports), **admin routers** (no layer beneath them), and the **health domain** (an application built inside `2_domains`).

7. **Stalled stranglers and dead code.** The routing-toggle subsystem loads at every boot for a config file that doesn't exist, referencing a `_legacy/` tree that was deleted; `server.mjs` duplicates `index.js` boot and is unreachable; `UserDataService` is `@deprecated` with 142 live call sites; a dead 195-line duplicate Telegram adapter has zero importers; ≥4 port interface files have zero importers, two pairs with incompatible signature drift.

8. **Ports are aspirational.** Only 39% of adapter classes extend a declared port; several flagship adapters (TelegramMessagingAdapter, PlexAdapter, HomeAssistantAdapter, all proxies) claim a port in JSDoc only; duplicated ports drift (`IMessagingGateway` × 2 with `sendImage` vs `sendPhoto`; `IConversationStateDatastore` × 2 with **incompatible argument order**); 13 of 38 apps have no `ports/` directory at all.

### Layer scorecard

| Layer | Files | Grade | One-line verdict |
|---|---|---|---|
| `0_system` | 104 | **C** | Import isolation clean outside bootstrap; but fitness/lifeplan/Telegram/auth business knowledge embedded, 6 module-scope singletons, typed errors 0% implemented |
| `1_adapters` | 295 | **C+** | Gateway constructor-DI is the norm; but 21 configService singletons, business logic in adapters, error contract ~unadopted, fs/fetch bypasses |
| `1_rendering` | 36 | **B−** | Import discipline perfect; but eink fetches data at draw time, business logic in two renderers, `lib/` primitives unused |
| `2_domains` | ~306 | **B−** | Zero vendor/adapter imports, cross-domain discipline excellent; but serialization is the norm, health domain is an app-in-domain, ffmpeg in domain |
| `3_applications` | 487 | **B** | Zero vendor SDKs, ports established in 25 apps, 5/8 containers clean; but 11 files import adapters, fitness is vendor-shaped, fs-repositories inside |
| `4_api` | 142 | **D+** | Naming/versioning/factory conventions largely followed; but 21% of files carry forbidden imports, 5 admin routers ARE persistence, error handling is 38 hand-rolled copies |
| Cross-cutting | — | **D** | No single composition root, tier-0 rule is fiction, SSOT failures with numeric drift, dead subsystems still booting |

---

## Decision Register — doc-vs-code contradictions needing an explicit ruling

These cannot be "fixed" by code alone; each needs a decision recorded in the guideline docs. Until then the codebase argues with its own documentation.

| # | Question | Code position | Doc position | Recommendation |
|---|---|---|---|---|
| D1 | May containers import concrete adapters? | `NewsReporterContainer.mjs:6-7`, `NotificationContainer.mjs:2-5`, `LifeplanContainer.mjs:6-8` say yes; 5 other containers say no | application-layer-guidelines: "Never import adapters in container" | Keep the doc rule; move the 3 containers' imports to bootstrap. If reversed, update the doc and stop flagging. |
| D2 | May the app layer import `#rendering`? | `EinkPanelService.mjs:19`, `PrinterSink.mjs:8` (docstring claims legality) | Allowed-imports list omits 1_rendering; backend-architecture.md's dependency table *includes* it (`3_applications → 1_rendering`) | The two docs disagree with each other. backend-architecture.md's table is the saner rule — amend application-layer-guidelines to allow 1_rendering, injected-as-port preferred. |
| D3 | Do repository ports live in domain or application? | `2_domains/media/ports/IMediaQueueDatastore.mjs` header defends domain placement | domain-layer-guidelines: "Existing `2_domains/*/ports/` folders should be migrated to `3_applications/`" | Pick one school. The doc's position is current policy → move the port. If the domain-owned-repository-interface school wins, rewrite the "No Ports in Domain" section. |
| D4 | Where does the shared time utility live? | `2_domains/core/utils/time.mjs` ("moved to domain layer"), 21 domain consumers | Guidelines' examples import from `#infrastructure/utils/time.mjs`; meanwhile `0_system/utils/time.mjs` also exists with a **drifted copy** | Bless the domain copy as shared kernel (it's the pure one — throws on missing date instead of silently defaulting to now), make `0_system/utils/time.mjs` re-export it, remove the hardcoded LA timezone default. Update both guideline docs. |
| D5 | Is `#system/utils/FileIO.mjs` legal from `3_applications`? | 8 app-layer files use it as an in-place repository | application-layer-guidelines forbids fs for data ops; FileIO is nominally "allowed 0_system/utils" | It's a loophole. Ban it in 3_applications (data ops go through datastore ports); allow it only in 1_adapters. |
| D6 | Is the domain hierarchy table complete? | 13 domains (`ambient`, `art`, `barcode`, `common`, `concierge`, `cost`, `feed`, `livestream`, `lifeplan`, `notification`, `playback-hub`, `trigger`, `weekly-review`) have no assigned level; `content` behaves like L1 (fitness and barcode import it) | ddd-reference lists 4 levels covering ~half the domains | Extend the level table; explicitly promote `content` to Level 1 (shared vocabulary) or break the two peer imports. |
| D7 | Duck typing vs `extends IPort`? | 61% of adapter classes and several zero-importer port files say duck typing won | adapter-layer-guidelines: "Always implement declared port" | Either enforce `extends` (add lint) or accept duck typing and delete dead port files. The current half-state gives false confidence and produced real signature drift (see X-9). |

---

## Part 1 — Cross-Cutting Findings (SSOT / DRY / Separation of Concerns)

### [X-1 · CRITICAL] Composition/wiring split across two god files with overlapping responsibilities
**Category:** separation-of-concerns
`backend/src/0_system/bootstrap.mjs` (4,252 lines) holds factories for every domain (`createContentRegistry` :492, `createFitnessServices` :927, `createNutribotServices` :2742, …) **and** API-layer router factories (`createFitnessApiRouter` :1056, `createFinanceApiRouter` :1482, `createDeviceApiRouter` :2007, …). `backend/src/app.mjs` (2,914 lines) constructs more services inline — its "Create API v1 Routers" section spans lines 809–2758. Duplicated edges: `app.mjs:1753`, `app.mjs:1764`, and `bootstrap.mjs:4174` each independently wire `fitnessHistoryDir: configService.getHouseholdPath('history/fitness')`.
**Why it matters:** No single composition root → arbitrary placement, drift, and structural merge conflicts. Every duplicate-wiring finding in this audit traces here.
**Fix:** Finish the `0_system/bootstrap/` per-domain-module migration (5 modules already exist and are the healthy pattern); `app.mjs` shrinks to middleware + mount loop; `create*ApiRouter` factories move to `4_api`.

### [X-2 · CRITICAL] `0_system` imports upward 211 times — the tier-0 rule is fiction
**Category:** separation-of-concerns
`backend-architecture.md:162` declares `0_system → standalone (no upward imports)`. Reality (non-test): **95** imports from `#adapters`, **68** from `#apps`, **29** from `#api`, **19** from `#domains`, 1 from `#rendering` — all concentrated in `bootstrap.mjs` + `0_system/bootstrap/*` (e.g. `bootstrap.mjs:199` imports `TelegramAdapter`).
**Why it matters:** The composition root *must* import everything — the problem is its address. While it lives inside `0_system`, the layer numbering can't be lint-enforced and the foundation layer can never be extracted or tested standalone.
**Fix:** Move `bootstrap.mjs` + `0_system/bootstrap/` out of tier 0 (e.g. `backend/src/5_bootstrap/` or fold into the `app.mjs` tier). Then add an import-direction lint rule and let it actually pass.

### [X-3 · HIGH] Dead strangler-fig routing-toggle subsystem still loads at every boot
**Category:** legacy
`app.mjs:292-299` calls `loadRoutingConfig('./backend/config/routing.yml')`; `routingConfig` is never referenced again. `backend/config/routing.yml` doesn't exist, so every boot takes the fallback `{ default: 'legacy', ... }` — referencing a `_legacy/` backend that has been deleted. `0_system/routing/RouteMatcher.mjs` and `RoutingMiddleware.mjs` have zero importers. Docs drift: `backend-architecture.md:41` lists `RoutingConfig.mjs, ShimMetrics.mjs` (neither exists); the documented `4_api` `shims/` folder and `/admin/legacy`, `/admin/shims` endpoints don't exist.
**Fix:** Delete `0_system/routing/` and `app.mjs:288-299`; purge the strangler-fig sections from backend-architecture.md.

### [X-4 · HIGH] Four+ parallel YAML I/O implementations despite FileIO declaring itself mandatory
**Category:** DRY / SSOT
`0_system/utils/FileIO.mjs:24-27` declares "ALL file operations … MUST go through these utilities. NEVER use direct fs.* calls outside of this file." Parallel implementations: `DataService.mjs:25-55` (own yaml load/dump), `UserDataService.mjs:44-60` (own read/write), `configLoader.mjs` (own `readYaml`), `secrets/providers/YamlSecretsProvider.mjs` (own load path). Beyond those: 28 non-test files call `yaml.load(`/`yaml.parse(` directly and 28 files in 1_adapters + 3_applications import `fs` directly.
**Why it matters:** Extension resolution (`.yml` vs `.yaml`), EACCES diagnostics, dump options, and error-swallowing differ per copy. The known `DataService.ensureExtension` dotted-filename bug (MEMORY.md) is this bug class multiplying.
**Fix:** FileIO becomes the SSOT primitive; the four services delegate to it. Lint-ban `import fs` and `js-yaml` outside `0_system/utils/` + persistence adapters.

### [X-5 · HIGH] Fitness zone thresholds and colors: numeric drift between copies
**Category:** SSOT
Thresholds: `2_domains/fitness/services/ZoneService.mjs:56-64` (`hot: maxHr*0.8, fire: maxHr*0.9`) vs `2_domains/fitness/entities/Zone.mjs:109-117` (`hot: 0.7–0.85, fire: 0.85+`) — and `ZoneService.createZonesForDisplay` (:69-71) delegates to the *other* set, so two methods of one service disagree. Colors: `ZoneService.mjs:77-83` (`hot '#F97316'`, `cool '#3B82F6'`, …) vs `1_rendering/fitness/TimelapseFrameRenderer.mjs:352-356` (`hot '#ff4d4f'`, `cool '#40a9ff'`, …). Zone order tables also duplicated (`Zone.mjs` `ZONE_PRIORITY` vs `1_adapters/fitness/AmbientLedAdapter.mjs:19`).
**Why it matters:** User-visible: "hot" starts at 148 bpm on one code path and 157 bpm on another (maxHr 185); timelapse colors won't match live UI.
**Fix:** `Zone.mjs` becomes SSOT for names/order/thresholds/canonical colors; ZoneService re-exports; renderers key theme colors off the domain constants.

### [X-6 · HIGH] `'America/Los_Angeles'` hardcoded 96× in 49 files; ConfigService disagrees with itself
**Category:** SSOT
96 occurrences across 49 non-test files (`0_system/utils/time.mjs:34,68,77`, `2_domains/core/utils/time.mjs:41,83,97`, all ~10 nutribot use cases, `3_applications/ambient/AmbientSchedulerService.mjs`, `2_domains/health/services/WeightProcessor.mjs`, …). `ConfigService.mjs:97-98` defaults household timezone to `'UTC'` while `ConfigService.mjs:575-576` `getTimezone()` defaults to `'America/Los_Angeles'`.
**Why it matters:** "No timezone configured" resolves differently depending on accessor; 49 files pin behavior to LA when callers omit the arg (see the Strava-timezone bug class in memory).
**Fix:** One `DEFAULT_TIMEZONE` export — or better, timezone required in domain functions and resolved once at the application layer. Reconcile `:98` vs `:576`.

### [X-7 · HIGH] Deprecated `UserDataService` (779 lines) has 142 live call sites; data-path knowledge smeared across 4 services
**Category:** legacy / SSOT
`UserDataService.mjs:1-13` says `@deprecated Use DataService instead`, yet 142 non-test references remain across 30+ files (`app.mjs`, `bootstrap.mjs`, `JournalistContainer`, `FitnessConfigService`, feed sources). It re-implements household/user path building that also lives in `DataService` and `ConfigService.getHouseholdPath`, and `configLoader.mjs` makes a fourth. The CLAUDE.md warning about which config path is "real" is the human-readable symptom of this failure.
**Fix:** Finish the migration the deprecation header specifies, then delete. Interim: UserDataService methods delegate to DataService instead of re-implementing.

### [X-8 · HIGH] Duplicate Telegram stack: one dead adapter + two drifted, zero-importer `IMessagingGateway` ports
**Category:** DRY / legacy
Live: `1_adapters/messaging/TelegramAdapter.mjs` (667 lines; wired at `bootstrap.mjs:376,2447`). Dead: `1_adapters/telegram/TelegramMessagingAdapter.mjs` (195 lines, same Bot API client, **zero importers** outside its own barrel — whose header cites a nonexistent `2_adapters/` path). Ports: `3_applications/common/ports/IMessagingGateway.mjs` (`sendImage`, `updateMessage`, …) vs `3_applications/nutribot/ports/IMessagingGateway.mjs` (`sendPhoto`, `editMessage`, `answerCallback`, …) — **neither imported by anything**.
**Irony:** the dead adapter contains the layer's *best* error-translation implementation (see A-4) — the template everyone should copy is in the file nobody uses.
**Fix:** Delete the dead adapter and the nutribot port copy; make `common/ports/IMessagingGateway.mjs` the single contract and actually extend it from `TelegramAdapter` (or per D7, delete it too).

### [X-9 · MEDIUM] More duplicated/drifted ports: `IConversationStateDatastore` × 2 with incompatible argument order
**Category:** DRY
`3_applications/common/ports/IConversationStateDatastore.mjs` — `set(conversationId, state, messageId)` (:30) vs `3_applications/homebot/ports/IConversationStateDatastore.mjs` — `set(conversationId, messageId, state, ttlMs)` (:25). Same name, incompatible signatures. `INotificationChannel` also duplicated (`common` vs `notification` ports), both with zero importers.
**Fix:** Delete unreferenced copies; if both semantics are needed, rename one (`IEphemeralConversationState`).

### [X-10 · MEDIUM] `formatLocalTimestamp`/`parseToDate` copy-pasted across layers with behavioral drift; `shortId` duplicated verbatim; four `deepMerge`s
**Category:** DRY
- `0_system/utils/time.mjs:34` — `formatLocalTimestamp(date = new Date(), tz)` silently defaults to now; `2_domains/core/utils/time.mjs:41` — same function **throws** if date missing. `parseToDate` verbatim in both. Docs cite the system copy; domain code uses the domain copy (see D4).
- `0_system/utils/shortId.mjs:18,29` and `2_domains/core/utils/id.mjs:20,31` — identical CHARSET, bodies, JSDoc. 1 importer vs 8.
- Four `deepMerge` implementations with different null/array/undefined semantics: `BotConfigLoader.mjs:66`, `configLoader.mjs:83`, `agents/framework/loadAgentConfig.mjs:31`, `emulator/lib/deepMerge.mjs:1`.
- Same-name/different-unit trap: `1_rendering/lib/LayoutHelpers.mjs:40` `formatDuration(seconds)` vs `1_adapters/fitness/AmbientLedAdapter.mjs:25` `formatDuration(ms)`.
**Fix:** One home per utility (domain shared kernel for pure fns per D4); delete the system `shortId`; promote the emulator `deepMerge` to `0_system/utils/` and replace the other three; rename one `formatDuration`.

### [X-11 · MEDIUM] Household folder-name resolution triplicated; raw `'household'` path joins in 9 files
**Category:** SSOT
`configLoader.mjs:143-169` exports `listHouseholdDirs`/`parseHouseholdId`/`toFolderName`; `YamlSecretsProvider.mjs:103-126` re-implements all three privately; `configValidator.mjs:50` re-derives inline. Separately, 20 non-test `path.join(..., 'household', ...)` call sites bypass `getHouseholdPath` — worst: `WeeklyReviewService.mjs` (8 sites), `artmodeConfig.mjs:25,37`, `ArtAdapter`, `ListAdapter`, `bootstrap.mjs:568,1906`, `4_api/v1/routers/{config,contentFilter,screens}.mjs`.
**Why it matters:** These hardcode the *default* household folder, silently breaking `household-{hid}` multi-household for weekly-review, art mode, lists, and screens.
**Fix:** Import the three helpers from configLoader everywhere; route path building through `getHouseholdPath(relPath, hid)`.

### [X-12 · MEDIUM] Entry-point duplication: `backend/index.js` vs `backend/src/server.mjs`
**Category:** DRY / legacy
Both contain the same boot sequence (docker detection → base path → config probe → logging init): `index.js:36-60`, `server.mjs:29-52`. All npm scripts run `index.js`; `server.mjs`'s header references the dead toggle system, and `backend-architecture.md:149` wrongly lists `server.mjs` as the entry point.
**Fix:** Delete `server.mjs` (or reduce to a thin wrapper over shared boot code in `0_system/boot/`); fix the docs.

### [X-13 · MEDIUM] Path-alias drift: two aliases for one layer, undocumented aliases, 44 banned deep-relative imports
**Category:** aliases
`backend/package.json` defines **both** `#apps/*` and `#applications/*` → `3_applications`; root `package.json` defines only `#apps`. Usage: 219 `#apps` vs 7 `#applications` (`bootstrap.mjs`, `4_api/v1/routers/eink.mjs`, `piano.mjs`) — the 7 resolve only through the backend manifest scope. `coding-standards.md:48-57` documents 5 aliases; root manifest has 11. Deep `../../../` traversal imports (banned by coding-standards): 44 lines in 17 files — worst `YamlHubConfigDatastore.mjs` (13). `3_applications/piano/loopManifest.mjs:8-9` traverses to root `shared/music/` because no backend alias exists for the `shared/` tree.
**Fix:** Delete `#applications`, rewrite the 7 usages; add `#shared/*` to both manifests; convert the 44 traversals; sync the docs table.

### [X-14 · LOW] Backend mirrors the frontend app registry by hand
`bootstrap.mjs:762-775` — inline `appDefs` with the comment "App definitions mirror the frontend registry" (i.e. an acknowledged manual copy of `frontend/src/lib/appRegistry.js`).
**Fix:** Move the shared label/param table to `shared/` and import from both sides.

### [X-15 · LOW] Assorted same-concept duplicates
Two placeholder-image generators with independent styling (`4_api/v1/utils/placeholderSvg.mjs` vs `0_system/utils/placeholderImage.mjs`); two unrelated classes both named `FeedbackService` (`3_applications/common/feedback/` voice feedback vs `3_applications/lifeplan/services/` lifeplan entities); three HTTP client patterns (`0_system/services/HttpClient` in 24 files, raw fetch in 21, raw axios in 3 — including *inside* `FileIO.mjs:5,606`, where `saveImage` does HTTP streaming inside the "filesystem gateway").
**Fix:** Rename one FeedbackService (`VoiceFeedbackService`); extract `saveImage` out of FileIO; standardize new code on HttpClient.

---

## Part 2 — Layer-by-Layer Findings

## 2.1 `0_system` (104 files, ~16.4k lines)

### [S-1 · CRITICAL] Fitness domain logic in the system config layer
`0_system/config/UserService.mjs:79-94,122-185` — `hydrateFitnessConfig()` implements HR-zone hydration, device-to-user strap-color mapping, primary-vs-family semantics, and legacy `ant_devices` format conversion. The system layer now changes whenever the fitness config schema changes.
**Fix:** Move into `3_applications/fitness/FitnessConfigService` (already exists, already wired); keep only generic profile lookup in system.

### [S-2 · CRITICAL] A complete lifeplan use case in `0_system/scheduling`
`0_system/scheduling/CeremonyScheduler.mjs:1-61` — `CEREMONY_CADENCE_MAP` (unit/cycle/phase/season/era), due-checking against `ceremonyRecordStore`, dedupe, notification dispatch. Consumed by `0_system/bootstrap/lifeplan.mjs:15`. All its dependencies are lifeplan stores/services — it is not scheduling plumbing.
**Fix:** Move to `3_applications/lifeplan/` as a use case invoked by the generic Scheduler via a registered task.

### [S-3 · HIGH] Bootstrap contains real business logic, not just wiring
`bootstrap.mjs:1124-1141` — `posterProvider` implements Plex thumbnail selection + authenticated URL building + fetch (re-implementing auth `PlexAdapter` owns). `:1142-1168` — avatar/equipment providers do filesystem scanning with extension-fallback (`readFileSync` loops) — inline adapter implementations. `:578-620` — inline saved-query datastore with household-vs-user precedence rules. `:3510-3517` — business cron policy hardcoded (`'coaching:morning-brief', '0 10 * * *'`).
**Fix:** Extract to adapters (`PlexPosterProvider`, asset resolvers, saved-query datastore); cron expressions to config; split the monolith per X-1.

### [S-4 · HIGH] Utility imports ConfigService (`utils/time.mjs`)
`0_system/utils/time.mjs:8,204-210` — imports the configService singleton and exports a `ts` Proxy singleton lazily constructing `TimestampService(configService)`. Named verbatim as an anti-pattern in the guidelines. `utils/errors/*` import `nowTs24` from here, so **error construction transitively depends on config-singleton initialization** — constructing an error before `initConfigService()` can itself throw.
**Fix:** Keep `formatLocalTimestamp(date, timezone)` pure; timezone passed by callers; delete the `ts` proxy.

### [S-5 · HIGH] Prescribed system error types don't exist; 57 generic `throw new Error`
Zero hits for `ConfigurationError|SchedulerError|EventBusError|FileIOError` in the layer. Config failures throw generic errors: `ConfigService.mjs:306`, `config/index.mjs:46,95`, `BotConfigLoader.mjs:96,139`, `routing/ConfigLoader.mjs:14,33`, `scheduling/TaskRegistry.mjs:23,63-69`.
**Fix:** Create the four classes per the guideline spec; migrate config/scheduling/routing throw sites first.

### [S-6 · HIGH] Module-scope singletons (6 exported instances + hidden module state)
`config/index.mjs:124,195` (`configService`, `dataService` Proxies), `UserService.mjs:235` (`userService`), `UserDataService.mjs:777` (eager `new UserDataService()`), `utils/time.mjs:204` (`ts`), `http/httpClient.mjs` (axios singleton with import-time interceptor side effects). Hidden state: `logging/dispatcher.mjs:159`, `testing/TestContext.mjs:14-15`, per-file `let instance` in three `bootstrap/` modules. The Proxy idiom exists specifically to paper over init-order problems the singletons create.
**Fix:** Export classes/factories; instantiate in bootstrap. At minimum freeze the consumer count.

### [S-7 · MEDIUM] Telegram-specific knowledge in generic HTTP middleware
`0_system/http/middleware/validation.mjs:5-7,25,48-85` — parses Telegram update shapes (`x-telegram-bot-api-secret-token`, `callback_query`, "return 200 to prevent Telegram retry"); `idempotency.mjs:85` keys on Telegram update IDs. A `TelegramWebhookParser` already exists in `1_adapters/telegram/` — duplicated placement.
**Fix:** Move both next to the parser; keep only a generic key-extractor-injected idempotency middleware in system.

### [S-8 · MEDIUM] Provider vocabulary hardcoded across registries and config
`registries/integrationConfigParser.mjs:5-23` — `PROVIDER_CAPABILITY_MAP` (plex, jellyfin, homeassistant, openai, telegram, buxfer, …); `IntegrationLoader.mjs:136-141` — per-provider secret-key maps + `if (provider === 'homeassistant')` normalization; `ConfigService.mjs:38-70` — 30+-entry legacy secret map naming vendors; `sourceConfigSchema.mjs:16`. This inverts the manifest-discovery design (`AdapterRegistry` discovers manifests precisely so system code needn't enumerate providers).
**Fix:** Move capability/secret-key/normalization into each adapter's `manifest.mjs`.

### [S-9 · MEDIUM] Rendering code in the system layer
`0_system/canvas/` (`CanvasRenderer.mjs`, `drawingUtils.mjs`, `compositeHero.mjs` with presentation constants `HERO_WIDTH=1280`, JPEG 0.85) and `utils/placeholderImage.mjs` render styled output — the exact category the guidelines relocated to `1_rendering/`. Pulls the `canvas` native dep into the foundation layer.
**Fix:** Relocate to `1_rendering/` (generic subfolder). See also R-11 (three canvas idioms).

### [S-10 · MEDIUM] `placeholderImage.mjs`: hardcoded path + import-time side effects + latent bug
`utils/placeholderImage.mjs:13-22` — `process.env.path?.media || process.env.MEDIA_PATH || '/data/media'` (env values are strings — `.media` is always undefined; `/data/media` is container-only), font registration executes at import before config load.
**Fix:** Accept `fontPath` as a parameter / lazy-register on first call; remove the literal.

### [S-11 · MEDIUM] Authorization policy matrix hardcoded in system
`auth/authConfigDefaults.mjs:8-30` — role→app grants (`parent: ['fitness','finance','lifelog']`, …) and app→route tables enumerate the entire app catalog in tier 0; "defaults" silently define real access control when no config file exists.
**Fix:** Ship as default YAML in the data tree, or move default policy to an application-layer auth module.

### [S-12 · MEDIUM] Stateful "utilities" — module-scope caches
`utils/FileIO.mjs:491` (`_dirListCache`), `BotConfigLoader.mjs:24`, `logging/config.mjs:21`, `http/middleware/idempotency.mjs:14-17` (unbounded Map shared across all bots + module-scope interval; first instance's `ttlMs` governs everyone).
**Fix:** Promote to small services with lifecycle, instantiated in bootstrap.

### [S-13 · MEDIUM] Domain directory taxonomy + deprecated god-services alive
`UserDataService.mjs:196-205,392-400` — system decides `'gratitude'`, `'lifelog/nutrition'`, `'common/infinity'` directories exist; the 779-line class is deprecated yet exported as an eager singleton (see X-7). `users/UserResolver.mjs:5` likewise deprecated with a named successor, still importable.
**Fix:** Domain datastores ensure their own directories; finish and delete both deprecated modules.

### [S-14 · LOW] Misc
- `utils/errors/DomainError.mjs:12,151` — `DomainError`/`BusinessRuleError` (domain vocabulary) defined in system utils; both import `nowTs24` (see S-4 coupling). → Move to domain shared kernel; use parameter-free timestamps.
- `eventbus/btRelay.mjs:1-12` — emulator BT-pairing topic whitelist hardcoded in system eventbus. → Feature registers relay topics at bootstrap.
- `scheduling/Scheduler.mjs:29-31` — `shouldEnable()` sniffs `/.dockerenv` + env vars itself. → Inject `enabled` from bootstrap.
- `registries/AdapterRegistry.mjs:52,60-62` — manifest load failures swallowed with raw `console.warn/error`; a bad manifest silently removes an integration. → Injected logger; surface failures in `discover()` result.
- `bootstrap/lifeplan.mjs` — `notificationService || { send: () => {} }` no-op fallback with no "feature disabled" log.

**Compliant:** Outside bootstrap, **zero** upward imports in 100+ files (grep-verified); `bootstrap/` folder factories are true wiring with logged degradation; services follow `{config, logger}` DI with lifecycle; existing error classes carry `code`/`context`/`toJSON`; only 7 swallowed catches layer-wide, all defensible cleanup.

---

## 2.2 `1_adapters` (295 non-test files, ~59k lines, 206 exported classes)

### [A-1 · CRITICAL] 21 files import the configService singleton
All 13 harvesters (`harvester/fitness/StravaHarvester.mjs:22`, `communication/GmailHarvester.mjs:19`, `productivity/TodoistHarvester.mjs:18`, `finance/BuxferHarvester.mjs:18`, + Withings, Foursquare, Lastfm, GCal, GitHub, ClickUp, Shopping, Weather, Reddit), all 5 proxies (`proxy/PlexProxyAdapter.mjs:12` etc.), `hardware/tts/TTSAdapter.mjs:14`, `hardware/mqtt-sensor/MQTTSensorAdapter.mjs:18`, `camera/index.mjs:6`. Worst case — dual-source secret fetching, `GmailHarvester.mjs:195-199`: module singleton for `GOOGLE_CLIENT_ID` *and* the injected instance for user auth in the same block, so injecting a mock configService doesn't isolate the adapter. Same pattern in Todoist, ClickUp, Strava, PlexProxy, TTS.
**Fix:** Composition root resolves values; constructors receive `{ clientId, apiKey, dataRoot }`; for runtime per-user auth, inject a narrow `getUserAuth(service, user)` function. A single "harvester + proxy modernization" pass clears 100% of this finding.

### [A-2 · CRITICAL] Business logic embedded in the adapter layer
- `1_adapters/fitness/selectPrimaryMedia.mjs:1-35` — a four-tier business-decision cascade for choosing a session's primary media with domain thresholds (≥5 min T1, ≥3 min T2/T3, "when ≥2 are ≥10 min pick the LAST"), warmup deprioritization patterns. Pure fitness policy filed as an adapter — and its header admits it mirrors a frontend copy (policy now lives in ≥3 places).
- `persistence/yaml/YamlSessionDatastore.mjs:369-410` — the datastore *decides* primary media during hydration ("pick longest-duration as primary" loops, multi-stage legacy fallbacks). Deciding what counts as primary is business logic, not format translation.
**Fix:** Move `selectPrimaryMedia` to `2_domains/fitness/`; datastore hydrates raw events and the domain service derives primary. (Note: `3_applications` imports this adapter file today — P-1 — so the move also fixes that.)

### [A-3 · HIGH] Raw global `fetch` in 10 adapters bypassing system HttpClient
~19 call sites: `feed/WebContentAdapter.mjs:64,98,116,190,253`, `feed/sources/RedditFeedAdapter.mjs:143,317,338`, `GoogleNewsFeedAdapter.mjs:124`, `YouTubeFeedAdapter.mjs:148,254`, `ABSEbookFeedAdapter.mjs:343`, `KomgaFeedAdapter.mjs:323`, `GoodreadsFeedAdapter.mjs`, `komga/KomgaPagedMediaAdapter.mjs:65`, `playback-hub/HttpPlaybackHubAdapter.mjs:251`, `content/media/youtube/YouTubeAdapter.mjs:50`. 37 sibling files already inject HttpClient correctly. `feed/sources/` is the hotspot (7 of 10).
**Fix:** Inject `httpClient`; gets retry/timeout/error normalization for free (see A-4).

### [A-4 · HIGH] Vendor/HTTP details leak upward; error contract (`code` + `isTransient`) at 1.7% adoption
Thrown upward with vendor name + raw status, no code: `YouTubeAdapter.mjs:55` (`Piped API ${res.status}`), `FreshRSSFeedAdapter.mjs:59`, `YouTubeFeedAdapter.mjs:254` (leaks raw response body), `GoogleNewsFeedAdapter.mjs:124`, `KomgaFeedAdapter.mjs:323`, `ABSEbookFeedAdapter.mjs:343`, `KomgaPagedMediaAdapter.mjs:69`, `devices/AdbLauncher.mjs:59`. Only **5 of 295 files** ever set `isTransient`; only 14 assign `err.code`. The application layer cannot make principled retry decisions anywhere except the Telegram/Plex/TTS paths.
**Fix:** Adopt `telegram/TelegramMessagingAdapter.mjs:40-73` `#callApi` as the layer template (vendor details logged, generic error + `code` + `isTransient` thrown) — noting that file is otherwise dead code slated for deletion (X-8), so extract the pattern into `1_adapters/messaging/TelegramAdapter.mjs` and/or HttpClient first.

### [A-5 · HIGH] Raw `fs` in 19 files, raw `path` in 48
`fs` importers include core datastores FileIO was built for: `persistence/yaml/YamlHealthScanDatastore.mjs:26`, `YamlHubConfigDatastore.mjs:22`, `YamlRecapSnapshotStore.mjs:2`, `YamlHeadlineCacheStore.mjs:16`, `cost/YamlCostDatastore.mjs:24`, `ambient/YamlAmbientStateStore.mjs:3`, `agents/YamlConversationStore.mjs:2`, `strava/StravaWebhookJobStore.mjs:12`, `content/art/ArtAdapter.mjs:14` + 3 siblings, `media/YtDlpAdapter.mjs:19` (sync `unlinkSync/statSync` at :242-246,471), etc. Splits persistence into two styles, losing FileIO's atomic writes and YAML sanitization.
**Fix:** Migrate to FileIO; add missing capabilities (streams, `utimes`) to FileIO rather than importing fs.

### [A-6 · HIGH] Peer-layer import: adapter → 1_rendering
`hardware/epaper/EpaperAdapter.mjs:14` — `import { render as einkRender } from '#rendering/eink/index.mjs'`. The one explicitly named forbidden peer edge. The adapter already injects `dataProvider`, so the pattern exists in-file.
**Fix:** Inject the render function via constructor, wired at the composition root (orchestration belongs in `3_applications/eink/EinkPanelService`, which already exists).

### [A-7 · MEDIUM] Cross-adapter imports (6 distinct violations)
`persistence/yaml/YamlListDatastore.mjs:18` → content adapter internals; `feed/sources/ImmichFeedAdapter.mjs:11` → gallery immich `photoLabels`; `content/art/sources/immichSource.mjs:6-7` and `content/canvas/immich/ImmichCanvasAdapter.mjs:4` → gallery immich helpers; `content/local-content/LocalContentAdapter.mjs:4` → readalong scripture resolver; `content/media/youtube/YouTubeContentSource.mjs:3-4` → stream codec helpers. Replacing the Immich gallery adapter now breaks feed and art.
**Fix:** Extract shared vendor-format helpers (immich labels/dimensions, stream codecs) to a sanctioned shared location; `listConfigNormalizer` moves to the datastore or domain.

### [A-8 · MEDIUM] Non-port `3_applications` imports
`agents/MastraAdapter.mjs:14-18` — imports `AgentTranscript` + 4 decorator modules from the agents framework (runtime, not type-only); `agents/YamlWorkingMemoryAdapter.mjs:3` — `WorkingMemoryState`; `devices/WebSocketContentAdapter.mjs:15` — `contentIdKeys`; `feed/plugins/youtube.mjs:9` — `IContentPlugin` (interface not in `ports/`).
**Fix:** `WorkingMemoryState` is entity-shaped → `2_domains/agents/`; decorators applied around the adapter call in the application layer; interfaces into `ports/`.

### [A-9 · MEDIUM] Ports defined inside the adapter layer
`harvester/ports/IHarvester.mjs:28` lives under 1_adapters; `telegram/IInputEvent.mjs` — the platform-agnostic input-event contract lives in the *telegram* folder, so `BaseInputRouter.mjs:3` and every non-Telegram router depend on `./telegram/`, making Telegram the accidental canonical vendor.
**Fix:** `IInputEvent` → `3_applications/common/ports/`; `IHarvester` → `3_applications/harvester/ports/`.

### [A-10 · MEDIUM] 61% of adapter classes implement no declared port
80 of 206 exported classes `extends I<Port>`. Duck-typed flagships where the port exists: `TelegramMessagingAdapter` (JSDoc-only), `PlexAdapter.mjs:13` ("Implements IContentSource" — comment only), `HomeAssistantAdapter.mjs:18`, all 5 proxies, all notification adapters, all lifeplan metric adapters. Many of the 126 are legitimately internal helpers — but not these. See D7.

### [A-11 · MEDIUM] Composition-root factories embedded in adapter files
`proxy/PlexProxyAdapter.mjs:214-217` (and the other 4 proxies), `hardware/tts/TTSAdapter.mjs:199-200`, `mqtt-sensor/MQTTSensorAdapter.mjs:486`, `camera/index.mjs:6-11` — `createX()` factories pulling the configService singleton. Also `PlexProxyAdapter.mjs:22-28` keeps module-level mutable **test state** (`shutoffValve` + exported `enablePlexShutoff()`) in production code.
**Fix:** Relocate factories to the composition root; move the shutoff valve into an injected test double.

### [A-12 · MEDIUM] A renderer still lives in the adapter layer
`1_adapters/nutribot/rendering/NutriReportRenderer.mjs` (890 lines — 8th largest file in the layer). The guideline explicitly relocated this category to `1_rendering/`.
**Fix:** Move to `1_rendering/nutribot/`; update nutribot wiring.

### [A-13 · MEDIUM] Entities own hydration instead of datastores
20+ datastore call sites delegate to entity `toJSON`/`fromJSON`: `YamlNutriLogDatastore.mjs:47,62`, `YamlFoodLogDatastore.mjs:190`, `YamlFoodCatalogDatastore.mjs:27,31`, `YamlMediaQueueDatastore.mjs:51,65` (recently touched — the old pattern is still being copied), `cost/YamlCostDatastore.mjs:101,211,228`, `scheduling/YamlStateDatastore.mjs:94,111`, `agents/YamlWorkingMemoryAdapter.mjs:26,39`. This is the adapter-side half of D-3/the serialization migration (see 2.4).
**Fix:** New/touched datastores implement `#hydrate`/`#dehydrate` field mapping; stop calling entity `toJSON`.

### [A-14 · LOW] Misc
- Silent catches: 22 empty/comment-only; the two truly unlogged are `YtDlpAdapter.mjs:245,471` (cleanup `unlinkSync` — a failing loop could silently fill the disk).
- Hardcoded fallbacks: `StravaHarvester.mjs:594` — `|| \`./data/users/${username}\`` CWD-relative data path (plus `|| './media'`); `EpaperAdapter.mjs:57` — `config.baseUrl || 'http://localhost:3112'` bakes one dev machine's backend port in as a universal default (wrong on prod and other dev hosts). → Throw on missing config instead of guessing.
- Naming: `TTSAdapter` is OpenAI-specific (`api.openai.com` at :54) but generically named → `OpenAITTSAdapter`; `harvester/CircuitBreaker.mjs` is generic infra in the wrong layer → `0_system/utils/`; stale `2_adapters/` header paths in several files.

**Compliant:** Zero `axios`/`node-fetch` imports; constructor injection is the norm for gateway adapters (Plex, HomeAssistant, Immich, Komga, Telegram, AI — all validate deps and throw `InfrastructureError` with `MISSING_DEPENDENCY`); 64 files import application ports and feed sources uniformly extend `IFeedSourceAdapter`; no adapter imports use cases/containers at runtime; `ArtAdapter` correctly delegates matte/recency policy to `2_domains/art`.

---

## 2.3 `1_rendering` (36 files, ~3.8k lines)

### [R-1 · CRITICAL] Data fetching inside the rendering layer (eink)
`eink/providers/DataResolver.mjs:34-48` — `await fetch(url)` + image fetches, invoked from the default render path at `EinkRenderer.mjs:77` (`dataOverride || await resolveData(...)`) and exported as layer API (`eink/index.mjs:15`). The renderer performs live HTTP I/O at draw time — including calling the app's own `/api/...` endpoints back through the network stack. The `dataOverride` escape hatch proves the DI shape exists but is bypassed by default.
**Fix:** Move `resolveData` to `3_applications/eink/` (`EinkPanelService.mjs:226` already calls it directly for the snapshot path); `render()` requires data as input; drop `baseUrl`/fetch.

### [R-2 · HIGH] Print-selection business logic in GratitudeCardRenderer
`gratitude/GratitudeCardRenderer.mjs:11,46-60` — runs `selectItemsForPrint(...)` (weighted age-bucket selection) inside `createCanvas`, deciding *which* items get printed; the caller depends on the returned `selectedIds` to update print counts. The selection counts live in the **theme** (`gratitudeCardTheme.mjs:52-56` `selection: { gratitudeCount: 2, hopesCount: 2 }`) — the guideline's own named anti-pattern, with policy constants smuggled into presentation.
**Fix:** The `getSelectionsForPrint` DI callback returns already-selected items + ids; move counts to app/domain config.

### [R-3 · HIGH] Stats computation and schema knowledge in FitnessReceiptRenderer
`fitness/FitnessReceiptRenderer.mjs:606-650` — HR histogram computation ending in a zone-classification-by-majority-vote algorithm; `:590-592` — coins-per-minute derivation; `:168-236` — event flattening across two session schema shapes + challenge dedup by `challengeId`; `:108-119` — participant discovery with filtering rules. Session-schema knowledge in a renderer means every schema change forces a rendering edit. (avg/std-dev are correctly delegated to `computeParticipantStats` — the histogram is the same class of logic left behind.)
**Fix:** Extend the fitness domain stats service to emit `hrHistogram`, `coinsPerMinute`, and a normalized event list; renderer receives the view model. Keep `downsampleZones` (row-fitting is presentational).

### [R-4 · MEDIUM] eink subsystem has no theme file; fonts/colors hardcoded across widgets
`EinkRenderer.mjs:29-47` inlines `DEFAULT_THEME`; `widgets/HeaderWidget.mjs:25,32` and `WeatherWidget.mjs` (:76,83,87 + ≥10 font strings, layout magic `topH=280`, `badgeW=180`, `precipH = hr.precip*15`) hardcode font strings, bypassing the `font()` helper `lib/fonts.mjs` provides as SSOT ("swap the family here and the whole panel follows" — it wouldn't); `PlaceholderWidget.mjs:19` even uses `sans-serif`.
**Fix:** Add `eink/einkTheme.mjs`; route widgets through `font()`.

### [R-5 · MEDIUM] TimelapseFrameRenderer: inline palette, duplicated zone styling, module-level font singleton
`fitness/TimelapseFrameRenderer.mjs:45-53` inline `COL` palette; `:350-359` `zoneMeta()` hardcodes zone colors that diverge from both `fitnessReceiptTheme.mjs:49-50` and the domain palette (see X-5); dozens of unexplained ratios; `:28-43` `let _fontsRegistered = false` — first caller's `fontDir` wins for the process lifetime.
**Fix:** Extract `timelapseFrameTheme.mjs`; single fitness zone-style module keyed off domain constants; key font registration by resolved path.

### [R-6 · MEDIUM] FitnessReceiptRenderer bypasses its own theme
`:686` inline `'11px "Roboto Condensed"'` (a 12th font, not in the theme's 11); `:250` `headerHeight = 10+55+30+30+30+10` mirroring bare draw offsets (:324-363) that can silently desync; `:536-538` zone order/density/label literals in the draw loop.
**Fix:** Move section heights, the label font, and zone maps into `fitnessReceiptTheme.mjs`.

### [R-7 · MEDIUM] Shared Primitives Test failures — `lib/` built for this exact purpose, unused
- Font-registration boilerplate duplicated verbatim (`FitnessReceiptRenderer.mjs:81-90`, `GratitudeCardRenderer.mjs:62-68`) while `lib/CanvasFactory.mjs` `initCanvas()` has **zero consumers repo-wide**; both renderers hand-draw identical borders while `lib/LayoutHelpers.mjs` `drawBorder()` is also unused.
- `roundRect` implemented twice (`WeatherWidget.mjs:292-304`, `TimelapseFrameRenderer.mjs:395-404`); cover-fit math twice (`PhotoWidget.mjs:43-47`, `TimelapseFrameRenderer.mjs:521-526`); `DAYS`/`MONTHS` arrays twice (HeaderWidget, DateWidget).
- Legacy fallback font path duplicated and **dead**: `./backend/journalist/fonts/roboto-condensed/...` (cwd-relative, directory doesn't exist) in both thermal renderers — silent fallthrough to system fonts when `fontDir` omitted. Timelapse uses a third, working, import.meta-relative strategy.
**Fix:** Route both thermal renderers through `initCanvas`/`drawBorder`; add `roundRect`/`drawCover` to LayoutHelpers; one correct default font path in CanvasFactory.

### [R-8 · MEDIUM] QRCode theme drift — dead theme keys
`qrcodeTheme.mjs:35-36` defines `label.color`/`sublabelColor` that `QRCodeRenderer.mjs` never reads — it hardcodes `#ffffff`/`#000000`/`#666666` (:206,213,218,226) plus inline box geometry (:192,197) and the `0.55` char-width heuristic (:185). The theme lies to anyone restyling through it.
**Fix:** Wire or delete the dead keys; hoist geometry into the theme.

### [R-9 · MEDIUM] Graceful-failure gaps
`DataResolver.mjs:55-63` — rejected sources vanish from `Promise.allSettled` with no warning; a "valid" stub image gets content-hashed, cached, and shipped to the panel with no way to distinguish "feed down" from "not wired". **No file in the layer emits any log.** `GratitudeCardRenderer.mjs:44-46` — `selections.gratitude.length` throws TypeError on null return instead of the guideline's `return null`.
**Fix:** Warn per rejected source; guard null selections.

### [R-10 · LOW] Dead code, naming drift, widget domain logic
- Dead (grep-verified zero-use): `FitnessReceiptRenderer.mjs:45-55` `downsampleValues`, its unused `ZONE_ORDER` import (:14 — shadowed by the local literal), `TimelapseFrameRenderer.mjs` `roundRect`/`containRect`, `QRCodeRenderer` `config.mediaPath`, `GratitudeCardRenderer` `canvasService` ("for future use").
- Three construction idioms: factories (fitness/gratitude/qrcode) vs class (`newsreporter/ReportReceiptRenderer.mjs:20`) vs bare function (`EinkRenderer.mjs:60` `render()` with per-call config). Newsreporter folder lacks `index.mjs`; a unit test is colocated in the layer instead of `tests/`.
- `WeatherWidget.mjs:38-43,138` — EPA AQI thresholds and `pm2_5 > 12` health classification in a widget; `:156-158` `Date.now()`-based filtering decides *which* hours to show; `:221` `globalAlpha = 0.3` directly contradicts the file's own "no alpha on e-ink" comment (will dither on the mono panel); Header/Date widgets read `new Date()` at draw time, interacting with the image-hash caching scheme.
**Fix:** Delete dead code; wrap eink in a factory; AQI categorization and hour-windowing move to the data-shaping side; pass `now` in.

### [R-11 · Systemic] Layer-adjacent issues
- **The guideline doc is stale:** lists only fitness/gratitude renderers; eink, newsreporter, qrcode, timelapse (~75% of the layer) are undocumented; describes CanvasFactory exports that don't match the code.
- **Canvas plumbing has two homes:** `1_rendering/lib/` and `0_system/canvas/` (see S-9); eink imports `#system/canvas` while thermal renderers dynamic-import `canvas` directly — three acquisition idioms.
- **Adapter→rendering peer import** (`EpaperAdapter`) — logged as A-6.
- **Cross-layer layout duplication by design:** `ReportReceiptRenderer.formatTableLines` (:158-160) explicitly mirrors `ThermalPrinterAdapter.createTablePrint` column math; declared "single owner of receipt layout" while the adapter keeps its own copy → will drift.

**Compliant:** Import discipline perfect (zero adapter/app/ConfigService imports, grep-verified); domain imports limited to sanctioned utilities; the DI factory pattern correctly followed by all four `create*Renderer` factories (Timelapse is exemplary: "buffers in, buffer out"); `FitnessReceiptRenderer` implements `if (!data) return null` verbatim; `lib/` primitives pass all four rules; eink PNG encoders are dependency-free, validated, and superbly documented; `RENDERER_VERSION` content-hash invalidation is a thoughtful contract; `PanelRenderer.resolveLayout` is a textbook pure function.

---

## 2.4 `2_domains` (~306 files, ~31.8k lines)

### [D-1 · CRITICAL] ffmpeg process supervision inside the domain layer
`livestream/SourceFeeder.mjs:1,38,77` — `import { spawn } from 'child_process'` + `spawn('ffmpeg', ...)`, live process state, timers (`setTimeout` :83, `setInterval` :93), injected stdin stream. The hardest violation in the layer — an OS/vendor infrastructure component untestable without a real binary. (Sibling `ProgramRunner.mjs` is a legitimate pure state machine.)
**Fix:** Move to `1_adapters/livestream/`.

### [D-2 · CRITICAL] The `health` domain is an application built inside `2_domains`
- `health/services/HealthArchiveIngestion.mjs:23-24,40,170` — `import path from 'node:path'`, requires an fs adapter, implements an incremental file-copy pipeline (stat/read/write/mkdir/readdir, `ENOENT` handling, dedupe hashes).
- `health/services/HealthArchiveScope.mjs:68` — `node:path` for filesystem-path whitelisting; `HealthArchiveScopeFactory.mjs:60` — `Date.now`-keyed TTL cache, `dataRoot`/`mediaRoot` requirements.
- The health analytics suite (`MetricAggregator.mjs:37-40`, `MetricComparator`, `MetricTrendAnalyzer`, `HealthAnalyticsService`, `CalibrationConstants.mjs:68-110` — *stateful between calls*, `PeriodMemory`, `PeriodResolver`, `HistoryReflector`, `WeightProcessor`) fetches via injected stores instead of receiving entities.
- Health accounts for ~50 of the layer's 130 generic `Error`s, most logger injection, and several swallowed catches (`HistoryReflector.mjs:40-41,63`).
**Fix:** Keep the pure cores (privacy-exclusion policy, BIA-offset math, zone math); move ingestion/scope/factory and the fetch-and-orchestrate services to `3_applications/health/` + adapters. A health-only remediation pass clears roughly a third of all domain findings.

### [D-3 · HIGH] Serialization is the layer-wide norm — 75 files with `toJSON()`, 29 with `static fromJSON`
~25% of the layer owns persistence-shape knowledge: `fitness/entities/Session.mjs:265,340`, `finance/entities/Budget.mjs:67`, `cost/value-objects/Money.mjs:139,183`, all 14 lifeplan entities, all 7 playback-hub VOs, media/messaging entities. Worse, services round-trip JSON **in-memory**: `messaging/services/ConversationService.mjs:101,116` (`conversation.addMessage(message.toJSON())` … `messages.map(m => Message.fromJSON(m))` — the aggregate stores raw JSON blobs instead of Message entities), `gratitude/services/GratitudeService.mjs:77,102,158`.
**Fix:** Project-scale migration (write a `_wip/plans/` doc): repositories own mapping; `fromJSON` → `create(...)` factories with domain-typed params. Prioritize the in-memory round-trippers (messaging, gratitude) — they corrupt the aggregate model, not just the storage boundary.

### [D-4 · HIGH] 20 domain services are repositories/application services in disguise
Services fetching via injected stores rather than receiving entities: `ConversationService.mjs:44`, `GratitudeService.mjs:102`, `nutrition/services/FoodLogService.mjs`, `finance/services/{BudgetService,MortgageService}.mjs`, `journaling/services/JournalService.mjs`, `messaging/services/NotificationService.mjs`, `content/services/{QueueService,MediaMemoryValidatorService}.mjs`, `home-automation/DisplayReadinessPolicy.mjs`, plus the health suite (D-2). `CalibrationConstants` additionally holds loaded state between calls, violating statelessness outright.
**Fix:** Two-track: reclassify fetch-and-orchestrate services into `3_applications/{domain}/` keeping pure calculation cores in domain; or invert — application loads entities, passes them into pure domain functions. Precedent exists: `lifelog/index.mjs:9-10` and `entropy/services/index.mjs:8` document exactly this migration already done.

### [D-5 · HIGH] Raw clock reads: `new Date(` in 49 files (155×), `Date.now(` in 8 files
Genuine clock reads (most of the 155 are string→Date parsing tied to D-3): `fitness/entities/Session.mjs:66-81` (four timelapse mutators stamp `Date.now()`), `cost/value-objects/BudgetPeriod.mjs:82` (`referenceDate = new Date()` default), `fitness/services/cycleLadder.mjs:18`, `lifeplan/entities/Belief.mjs:70` + `lifeplan/services/BeliefEvaluator.mjs:17` (duplicated dormancy calc, both reading the clock), `health/entities/HealthArchiveManifest.mjs:105`, `content/entities/MediaProgress.mjs:40` (documented injectable-with-impure-default), `gratitude/services/PrintSelectionService.mjs:23`, `CalibrationConstants.mjs:184`.
**Why it matters:** The `param = new Date()` default-argument idiom looks injectable but silently reads the clock whenever a caller forgets.
**Fix:** Make `now`/`timestamp` required (throw ValidationError when absent); Session's timelapse mutators accept the timestamp like the doc's `complete(completedAt)` example.

### [D-6 · HIGH] Generic `throw new Error(` — 130× in 37 files (vs 276 typed throws, ~68% compliant)
Worst: `health/services/HealthArchiveScope.mjs` (9), four more health services (8 each), `content/services/ItemSelectionService.mjs:195,213,216`, `concierge/Satellite.mjs:13-23` (6 — in an otherwise-exemplary frozen entity), `feed/entities/Headline.mjs` (4).
**Fix:** Mechanical sweep to typed errors + `code`; health alone is ~50 of the 130.

### [D-7 · HIGH] Ports/interfaces defined in the domain layer
- `2_domains/media/ports/IMediaQueueDatastore.mjs` — the only literal `ports/` dir; its header **argues against the guideline** (see D3 in Decision Register).
- `livestream/IAudioAssetResolver.mjs:8` — a port for TTS/file resolution (external service contract).
- `lifelog/extractors/ILifelogExtractor.mjs:30` — contract includes `get filename()` ("relative to user lifelog directory") — persistence-location knowledge in a domain interface.
**Fix:** Move the first two to `3_applications/{media,livestream}/ports/`; drop `filename` from the extractor contract or move it up. Or update the doc (D3) — pick one.

### [D-8 · MEDIUM] Cross-domain peer imports: `fitness → content`, `barcode → content`
`fitness/services/FitnessProgressClassifier.mjs:3` extends a content-domain base class; `barcode/BarcodePayload.mjs:31` imports `ContentExpression`. The only two non-core cross-domain imports in the layer — both treat `content` as shared vocabulary.
**Fix:** Promote `content` to Level 1 in the hierarchy (honest fix) or compose in the application layer. See D6.

### [D-9 · MEDIUM] Flagship entities have zero encapsulation
`fitness/entities/Session.mjs:38-59` — every field public; nothing prevents `session.finalized = true` from anywhere. `finance/entities/Budget.mjs:15-22,49-51` — all public; `addSpending()` accepts negative/NaN with no validation while `budget.spent` is also directly settable. Contrast: playback-hub, concierge (deep-frozen), nutrition, barcode all use `#private` correctly — the layer knows how.
**Fix:** Ratchet: migrate hot fields (`Session.finalized/timelapse`, `Budget.spent`) to `#private` + validated mutators when touched; state the convention.

### [D-10 · MEDIUM] Timestamp formatting inside domain + a domain-owned formatting util contradicting the docs
`2_domains/core/utils/time.mjs` (see D4/X-10) with hardcoded `'America/Los_Angeles'` defaults and a swallowed format-error fallback (:56-59). 27 `toISOString()` occurrences in 21 files; `nutrition/entities/NutriLog.mjs:11,148` — the entity formats its own timestamps; `journalist/entities/ConversationMessage.mjs:131`, `fitness/services/{TimelineService,recapNaming}.mjs`, health/cost services.
**Fix:** Rides on D4 + the serialization migration (formatting mostly serves `toJSON`).

### [D-11 · MEDIUM] Swallowed catches in domain services
Genuinely swallowed: `health/services/HistoryReflector.mjs:40-41` (`catch { return []; }`), `:63`; `fitness/services/TimelineService.mjs:67-68,187`; `health/services/MetricAggregator.mjs:234-235`; `content/services/MediaMemoryValidatorService.mjs:105-106`. A broken health datastore silently degrades reports to empty data. Pointless: `scheduling/services/SchedulerService.mjs:70-71` — `catch (err) { throw err; }`. (Acceptable parse-guards noted in ItemId, StreamProfile, QuestionParser.)
**Fix:** Degrade with logged warn + typed partial-result marker; delete the no-op catch.

### [D-12 · MEDIUM] Loggers injected into domain classes (10 files)
Six health services, `health/entities/DailyCoachingEntry.mjs` (a logger inside an *entity*), `home-automation/DisplayReadinessPolicy.mjs`, `common/AliasMap.mjs`, `livestream/SourceFeeder.mjs`. Mostly a symptom of D-2/D-4 — a truly pure calculation has nothing to log.
**Fix:** Resolves with the reclassification; anything staying returns result objects and lets callers log.

### [D-13 · LOW] Misc
- Orphaned test: `lifelog/services/__tests__/LifelogAggregator.test.mjs:9-11` imports `#apps` + `#system`; the class under test was correctly migrated to 3_applications but its test was left behind (now the only thing in `lifelog/services/`).
- Mutable exported Sets: `content/value-objects/StreamFormat.mjs:8-9` — `STREAM_FORMATS`/`STREAM_STRATEGIES` (`.add()` works from any importer); the only value-object file of 61 lacking freeze semantics.
- Import-style split: ~60 files use relative `'../../core/errors/index.mjs'` vs the `#domains/core` alias → codemod.

**Compliant:** Zero `#adapters`/`#system`(prod)/vendor-SDK/axios imports anywhere; cross-domain discipline excellent (of ~85 cross-folder imports, all but the 2 in D-8 target `core`); typed error infrastructure exists and dominates (276 sites); 53 of 54 non-barrel value-object files freeze correctly; migrations already done right in lifelog/entropy prove the prescribed remediation works; exemplary newer domains: playback-hub, concierge, barcode, `content/entities/MediaProgress.mjs`, `livestream/ProgramRunner.mjs`.

---

## 2.5 `3_applications` (487 non-test files, ~57.2k LOC, 38 apps)

### [P-1 · CRITICAL] Non-container services import `1_adapters` directly (8 files)
- `fitness/StravaReconciliationService.mjs:16-17` + `fitness/FitnessActivityEnrichmentService.mjs:25-26` — import `buildStravaDescription` and `selectPrimaryMedia`'s `buildSelectionConfig` from `1_adapters/fitness/` (pure domain logic misfiled in adapters — see A-2; both findings resolve together by moving those files to `2_domains/fitness`).
- `livestream/ChannelManager.mjs:5` — imports **and instantiates** `FFmpegStreamAdapter` per channel.
- `devices/services/DeviceFactory.mjs:11-16` — imports 6 concrete adapters (HomeAssistant, FullyKiosk, WebSocket, SshOs, Adb, Resilient) — a de facto composition root with no Container convention.
- `agents/framework/buildAgentRuntime.mjs:2` — `MastraAdapter`.
- `feed/services/HeadlineService.mjs:11-12` — imports `GOOGLE_NEWS_BLOCKED_IMAGE_PATTERNS` from a vendor adapter (vendor constant leaking upward).
- `content/services/ListManagementService.mjs:13` — adapter-internal normalizer helpers.
- `camera/index.mjs:5-8` — 4 concrete adapters + the configService singleton: a rogue composition root.
**Fix:** Proper containers or bootstrap wiring + injection; move pure helpers down to domains; shared constants to config.

### [P-2 · CRITICAL] The fitness application services are vendor-shaped end to end (Strava + Plex)
`StravaReconciliationService.mjs:24-33` — class name, `#stravaClient` field, `@param config.stravaClient - StravaClientAdapter instance`; `:48-50` — digs `fitnessConfig?.plex?.reconciliation_lookback_days` (YAML config-structure knowledge of two vendors in one expression); `FitnessActivityEnrichmentService.mjs:39-58` — `StravaWebhookJobStore`, `StravaReconciliationService` typed params. 26 non-test files in the layer mention `strava`; 27 carry Plex identifiers in logic (timelapse `plex/` hardlink dir at `GenerateSessionTimelapse.mjs:251-253`; `FitnessConfigService.mjs:47-70` normalizes `plex.governed_labels`; piano progress keyed by `plex:{id}`; all five suggestion strategies reference plex IDs).
**Why it matters:** The guideline's canonical failure: swapping Strava→Garmin or Plex→Jellyfin rewrites application services. Vendor content IDs (`plex:{id}`, `ratingKey`) function as the system's universal media key — a neutral `contentId` scheme (partially present in `devices/contentIdKeys.mjs`) is the prerequisite for any swap.
**Fix:** `ActivityProviderReconciliationService` + `activityGateway` port; pre-resolved `{ lookbackDays, selectionConfig, timezone }` config objects; neutral media keys.

### [P-3 · HIGH] Three containers import concrete adapters — with a docstring claiming it's legal
`NotificationContainer.mjs:2-5,23` (imports + instantiates 4 notification adapters), `NewsReporterContainer.mjs:12-16` (renderer, Mastra, datastores; also hardcodes `DEFAULT_MODEL = 'openai/gpt-4o'` at :22), `LifeplanContainer.mjs:6-8` (3 YAML stores). `NewsReporterContainer.mjs:6-7` asserts containers are "the one place in 3_app allowed to import concrete 1_adapters" — contradicting the guideline while 5 of 8 containers follow the doc. See Decision Register D1.

### [P-4 · HIGH] Direct `#system/config` singleton imports (8 files)
`nutribot/config/NutriBotConfig.mjs:16-17`, `camera/index.mjs:4`, `agents/health-coach/tools/DashboardToolFactory.mjs:5,51-53` (reads `profile?.apps?.nutribot?.goals` — config-structure + cross-app + vendor-bot knowledge in one line), `eink/EinkPanelService.mjs:21`, `content/services/{ArchiveService,MediaMemoryService}.mjs`, `fitness/FitnessActivityEnrichmentService.mjs:28` (`userService`).
**Fix:** Constructor injection (sibling classes already do it); prefer pre-resolved values.

### [P-5 · HIGH] fs/path repositories embedded in orchestration (~17 files + 8 via the FileIO loophole)
`media/services/FreshVideoService.mjs:78-205` — full filesystem lifecycle incl. lock-file protocol; `agents/health-coach/tools/LongitudinalToolFactory.mjs:488-490` — `path.join(dataRoot, 'users', userId, 'lifelog/archives', ...)` (the guideline's literal BAD example shape); `common/feedback/FeedbackService.mjs:33-58`; `piano/UserVideoProgressStore.mjs:27`; `weekly-review/WeeklyReviewService.mjs:1-3` — fs + path + `child_process.execFile` **running ffmpeg from the app layer**; `fitness/StravaReconciliationService.mjs:64-69` (YAML knowledge); plus ArchiveService, MediaMemoryService, PoseLogService, MediaDownloadService, sliverAbsorption, PersonalContextLoader, agents Scheduler/Transcript/seedLoader, SchedulerOrchestrator, ChannelManager. Eight more use `#system/utils/FileIO.mjs` as an in-place repository (see D5).
**Fix:** Extract datastores behind ports (`IVideoProgressStore`, `IFeedbackStore`, `ISessionHistoryStore`, …). `GenerateSessionTimelapse` shows the halfway pattern (injected fileIO, still path-builds :103-151).

### [P-6 · HIGH] `{ success: false }` returned instead of throwing — 49× in 26 files
Hotspots: nutribot use cases (16 across 9 files, e.g. `LogFoodFromText.mjs:153`), journalist (9), homebot (6), `fitness/manageBroker.mjs` (4), `finance/TransactionCategorizationService.mjs` (3). Nuance: `manageBroker` is a pub/sub request-reply envelope where a result object is arguably the protocol; the bot use-case returns are the real offenders — a bot-app dialect that wants a shared `ConversationResult` type or a `UserFacingError` caught at the router.

### [P-7 · MEDIUM] Silent / comment-only catches — 40× in 30 files
`fitness/suggestions/MemorableStrategy.mjs:94,99` (feature degradation, unlogged), `journalist/usecases/HandleSpecialStart.mjs` (five in one file: :72,154,202,224,229), `nutribot/usecases/LogFoodFromText.mjs:190,815`, `journalist/usecases/ProcessVoiceEntry.mjs:140`, `agents/concierge/services/MediaJudge.mjs:106`, `devices/services/SessionControlService.mjs:302,369`, `FreshVideoService.mjs:139,211`.
**Fix:** `logger.warn?.('x.failed', {...})` in every catch that skips work; keep pure cleanup noops with a standard comment.

### [P-8 · MEDIUM] Vendor vocabulary beyond fitness
`journalist/usecases/SendMorningDebrief.mjs:267` — `static applyTelegramStyling(text)` in a use case (with a comment claiming "formatting lives in the adapter/send layer — DDD compliant" while living in the use case); `coaching/CoachingMessageBuilder.mjs:9-51` — four "@returns Telegram HTML" docstrings; `NutriBotConfig.mjs:50-51,149` — validates `config.telegram.botId/botToken`; `home/EventAggregationService.mjs:27-73` — reads `current/todoist`, `current/clickup`, builds Todoist URLs; hardcoded model names (`'openai/gpt-4o'`, `'gpt-4o-mini'`) in newsreporter/agents/nutribot.
**Fix:** Message styling behind the gateway (`sendMessage(text, { style })`); provider records mapped in harvester adapters; model names from injected config.

### [P-9 · MEDIUM] Format-specific logic and a raw fetch
`FreshVideoService.mjs:359` — `file.endsWith('.mp4')`; `WeeklyReviewService.mjs:156,329` — extension rewrite + inline ffmpeg transcode; `MediaMemoryService.mjs:84` — `.yml`/`.yaml` filters; `GenerateSessionTimelapse.mjs:151`. `nutribot/usecases/LogFoodFromImage.mjs:131` — `await fetch(imageUrl)` (a Telegram file URL) — the only raw fetch in the layer; belongs on the messaging gateway as `downloadAttachment(fileRef)`.

### [P-10 · MEDIUM] `#rendering` imports in the app layer
`eink/EinkPanelService.mjs:19`, `NewsReporterContainer.mjs:12`, `newsreporter/sinks/PrinterSink.mjs:8` (docstring claims legality). See Decision Register D2 — the two guideline docs disagree with each other here.

### [P-11 · LOW] Structure/naming drift
13 of 38 apps have no `ports/` dir (`ambient, auth, barcode, coaching, eink, emulator, harvester, home, homeline, livestream, piano, trigger, weekly-review`) — and livestream/weekly-review are precisely the P-1/P-5 offenders. Vendor-named port: `fitness/ports/IFitnessSyncerGateway.mjs`. Loose camelCase modules outside usecases/services structure: `fitness/{manageBroker,identityRelay,fingerprintProfileWriter,sliverAbsorption}.mjs`, `piano/{loopManifest,courseProgress}.mjs`, etc.; piano and weekly-review have no usecases/ports structure at all (see also API-3: the piano router is the app's real backend).

**Compliant:** **Zero vendor SDK imports** (no openai/telegraf/@anthropic/plex-api/axios/googleapis anywhere); zero vendor-specific error parsing; ports established in 25 apps with exemplary contracts (`IHomeAutomationGateway`, `ICostSource`); 5 of 8 containers clean with lazy init; healthy domain usage throughout; structured logging is the norm.

---

## 2.6 `4_api` (142 files, ~27k lines; 82 non-test routers)

### [API-1 · CRITICAL] Forbidden cross-layer imports in 20 files (~21% of the layer)
8 files import `#apps`/`3_applications`, 4 import adapters, 10 import `#domains`, 3 import `0_system/config`:
- `v1/routers/api.mjs:17` — **configService singleton** at module level in the version-mount router.
- `v1/routers/piano.mjs:11-16` — domains id util, `userService` singleton, three `#applications/piano/*` modules.
- `v1/routers/fitness.mjs:45-50` — six `#apps/fitness/*` imports.
- `v1/routers/device.mjs:18,33-34`; `content.mjs:5,7`; `emulator.mjs:3`; `v1/agents/createAgentMemoryRouter.mjs:3`; `trigger.mjs:11` — app imports.
- `v1/routers/admin/content.mjs:26-27` — `YamlListDatastore` + `ListManagementService`; `admin/art.mjs:5-8`, `art.mjs:9-10`, `screens.mjs:12-13` — deep relative imports from `1_adapters/content/art/*`; `homeAutomation.mjs:16` — immich photoLabels.
- `#domains` imports in `catalog.mjs:17`, `qrcode.mjs:16-17`, `queue.mjs:5`, `media.mjs:17` (MediaQueue entity), `play.mjs:6`, `playbackHub.mjs:28-30` (error classes — mildest case), `v1/utils/resolveFormat.mjs:8`. The `ContentExpression` cluster (catalog/qrcode/queue) is a promotion candidate for `shared-contracts/`.
**Fix:** Everything behind factory params wired in bootstrap; error-class matching via `err.code` contract fields.

### [API-2 · CRITICAL] Routers instantiate adapters/services; module-level mutable state
`admin/content.mjs:47-50` — `new ListManagementService({ listStore: new YamlListDatastore(...) })` fallback; `fitness.mjs:58` — `new SessionLockService()` at **module scope** (shared across router instances/tests); `device.mjs:110-112` — `new DispatchIdempotencyService(...)` destructuring default; `admin/art.mjs:28` — `createArtSource(...)` in the router.
**Fix:** Required factory params; missing dep throws at wiring time (as `playbackHub.mjs:98-100` correctly does). Delete default-fallback instantiations.

### [API-3 · CRITICAL] Five admin routers ARE the persistence layer; fitness and piano are god-routers
- `admin/household.mjs:26-27,66-153` — seven fs/yaml helpers + member/device CRUD, profile construction, merge rules, auth-status derivation. `admin/config.mjs:24-36,77-100,152-323` — allow/mask policy, recursive file collection, path-traversal security **in the HTTP layer**. `admin/apps.mjs:20-30,59-190`; `admin/scheduler.mjs:43-74,84-237` (whose `POST /jobs/:id/run` at :233-237 returns 202 **without doing anything**); `admin/integrations.mjs:49-98,104-215` (+ `process.env.DAYLIGHT_ENV` read at :70). No application/adapter layer exists behind any of these; nothing else (CLI, scheduler, agents) can reuse the logic.
- `fitness.mjs` (1,739 lines, 51 routes): module-level live child-process handle (`simulationState` :61-66, `spawn` :1156-1160, `process.kill` :1196); domain rules in the webhook handler (`event.calories > 200` gate :1298-1313 — the guideline's literal anti-pattern example); a full fingerprint/manage-access **security policy subsystem** written in the router (:1458-1474, :1528-1573, :1605-1637, :1656-1713); direct FS (:956-961, :1331-1343); ~20 `catch → 500` blocks; `configService.getDefaultHouseholdId()` in 10 handlers.
- `piano.mjs` (630 lines): full FileIO surface imported (:3-10), per-handler YAML/binary persistence with configService-built paths, and two large domain algorithms — course grading/ranking (:387-440) and the reference-unit/co-progress lock algorithm (:442-559).
**Fix:** Admin application services (`HouseholdAdminService`, `YamlConfigFileService`, `JobsService`, `IntegrationsQueryService`); `FitnessSimulationService`, `ManageAccessUseCase`, session-query use case; a `PianoContainer`. Routers shrink to param extraction + service call.

### [API-4 · HIGH] Error handling: 157 `catch → res.status(500)` in 38 files; error middleware adopted by 3 of 82 routers
`errorHandlerMiddleware` appears only in `homebot.mjs`, `nutribot.mjs`, `journalist.mjs`. `asyncHandler` used in 45/82 routers but usually still wrapping an inner try/catch. Most 500 bodies echo `err.message` (information leak). The layer effectively has 38 hand-rolled error handlers with inconsistent bodies/codes.
**Fix:** Adopt the playbackHub pattern layer-wide (asyncHandler + one error-mapper middleware); delete per-handler try/catch except where a fallback response is real product behavior.

### [API-5 · HIGH] proxy.mjs / local.mjs: a streaming/transcoding/caching engine in HTTP handlers
`proxy.mjs:23-74,96-130` — SSRF/private-IP blocking + manual redirect-following (security-critical logic in a router); `:141-156` HLS playlist rewriting; `:178-201` `.mxl` unzip; `:407-484` komga composite pipeline with disk cache; `:534-605` retroarch thumbnail cache/retry; `:612-672` media path-traversal + extension probing; `:684-789` stream-profile lookup + manual stream pump. `local.mjs:16-20,309-347` — `spawn('ffmpeg')` thumbnail generation with timeout-kill; `:136-160` hand-rolled Range/206; `:288-296` error middleware leaking `err.message`.
**Fix:** Fetch/SSRF machinery → a 1_adapters HTTP-fetch adapter; HLS/mxl → application services; ffmpeg → `ThumbnailService`; routers keep Range pass-through + status mapping.

### [API-6 · HIGH] More routers that read the data tree or render documents
`contentFilter.mjs:2-4,20-36` — builds `content-filter/` paths, `readYaml` with swallowed errors; `screens.mjs:8-13,23-24` — fs+yaml reads plus `process.env.DAYLIGHT_DATA_PATH || '/data'` env fallback in the factory; `catalog.mjs:13-25,38+` — a **PDF rendering engine** (pdfkit/svg-to-pdfkit/resvg + page layout) that `fetch`es the app's own localhost endpoints (loopback HTTP re-entering the middleware stack, port-coupled); `api.mjs:156-198` — the `/system/reload` handler mutates global config + iterates the config directory inline (enabled by the forbidden singleton import).
**Fix:** ContentFilter/Screens datastore adapters; PDF composition → `1_rendering/catalogPdf.mjs` with list/qrcode injected as functions; a `ReloadHouseholdConfigs` use case.

### [API-7 · MEDIUM] Positional factory args in the guideline's own flagship stack
Routers: `nutribot.mjs:35`, `journalist.mjs:37`, `homebot.mjs:23` (`(container, options)`), `content.mjs:34` (`(registry, mediaProgressMemory, options)`). Handlers: 9 factories in `handlers/nutribot/*` and `handlers/journalist/*`; `handlers/homebot/index.mjs:46` takes three positional args. The doc's worked example (nutribot/journalist) deviates from the doc's own signature — evidence the doc was written after the code and the migration never finished.
**Fix:** Mechanical `({ container, logger, ... })` refactor + bootstrap call sites.

### [API-8 · MEDIUM] configService queried inside handlers across ~15 routers
`getDefaultHouseholdId()` in fitness (10 sites), gratitude :58, finance :61, calendar :33,39, admin/content (17 sites); `getHouseholdAppConfig` in media :80, content :80, piano :59,395,491; `getHeadOfHousehold` in `lifelog.mjs:76` (with a hardcoded `'kckern'` fallback — also a PII-ish default) and homeAutomation :302; `getStreamingProfiles` in proxy :705; `getDataDir()` in all five fs-CRUD admin routers.
**Fix:** Inject resolved values, or push household resolution into the already-existing `4_api/middleware/householdResolver.mjs`.

### [API-9 · MEDIUM] Domain entities constructed and domain rules applied in routers
`media.mjs:100` — `new MediaQueue({...})` in a PUT handler; `content.mjs:43-79` — `isWatched` (≥90%) domain rule + percent math in a DTO mapper; `:459-534` legacy multi-adapter search fan-out in the router; `queue.mjs:7-75` — 70-line `toQueueItem` mapper exported from the router file; `device.mjs:132-145` — keymap-must-be-nonempty load-refusal policy.
**Fix:** DTO shaping via use-case returns or pure `4_api/utils` shapers; rules (watched threshold, load precondition, calorie gate) into domain/application.

### [API-10 · LOW] Misc
`middleware/tokenResolver.mjs:2` + `routers/auth.mjs:3` import `#system/auth/jwt.mjs` — outside the documented allowed surface (bless it or inject). Stub endpoints faking success: `admin/scheduler.mjs:233-237` (202, does nothing), `admin/integrations.mjs:221-231` (`status: 'untested'` mock) → wire or return 501.

**Compliant:** Zero direct `(req,res)` handler exports; zero version-in-name violations (folder versioning done right); 78/82 factories take deps objects; naming conventions followed; model citizens: `playbackHub.mjs` (container-only deps, throws on missing deps, router-level error mapper), `media.mjs`, `handlers/home-dashboard/*` (perfect factory/deps), `emulator.mjs` (all file I/O injected — "so the router is unit-testable" — marred only by one app import), `eink`, `camera`, `canvas`, `queries`, `feedback`, `nutrition`, `ai` routers; `4_api/middleware/` (householdResolver, permissionGate, networkTrustResolver) pure and deps-injected.

---

## Part 3 — Remediation Roadmap

Ordered so each tranche unblocks or shrinks the ones after it. Effort: S < 1 day, M = days, L = week+, XL = plan-first migration.

### P0 — Decisions and dead-code deletion (cheap, high leverage)
| # | Action | Effort | Clears |
|---|---|---|---|
| 1 | Rule on the 7 Decision Register items; update guideline docs | S | Stops audit churn; unblocks D-7, P-3, P-10, A-10 |
| 2 | Delete dead code: `0_system/routing/` + `app.mjs:288-299`, `server.mjs`, `1_adapters/telegram/TelegramMessagingAdapter.mjs` (extract its `#callApi` error pattern first), `nutribot/ports/IMessagingGateway.mjs`, dead common ports, rendering dead functions/params | S–M | X-3, X-8, X-9, X-12, R-10 |
| 3 | Fix stale docs: backend-architecture.md (routing contents, entry point, shims, 0_system rule, rendering "Current Renderers"), coding-standards alias table | S | Cross-cutting doc drift |
| 4 | Mechanical alias cleanup: delete `#applications`, rewrite 7 usages; add `#shared/*`; codemod 44 deep-relative imports + ~60 domain relative-`core` imports | M | X-13, D-13 |

### P1 — Stop the bleeding (systemic patterns that new code keeps copying)
| # | Action | Effort | Clears |
|---|---|---|---|
| 5 | Create the four system error classes; adopt `errorHandlerMiddleware` + asyncHandler layer-wide in 4_api (start with fitness/piano/admin); generic-Error sweep in health domain | L | S-5, API-4, D-6 |
| 6 | SSOT consolidation: Zone.mjs as zone SSOT (fix the 0.8-vs-0.85 drift **now** — user-visible), one `DEFAULT_TIMEZONE` + reconcile ConfigService :98 vs :576, one deepMerge, one shortId, one time.mjs (per D4), household-folder helpers imported from configLoader | M | X-5, X-6, X-10, X-11 |
| 7 | Route the 10 raw-fetch adapters through HttpClient (feed/sources first) — fixes error normalization nearly for free | M | A-3, A-4 |
| 8 | Harvester + proxy modernization: constructor config, factories to composition root | L | A-1, A-11 (100% of adapter singleton imports) |
| 9 | Lint rules: import-direction per layer, ban fs/js-yaml outside 0_system utils + persistence adapters, ban configService singleton imports outside bootstrap | M | Prevents recurrence of A-1, A-5, P-4, X-4 |

### P2 — Structural relocations (per-vertical passes)
| # | Action | Effort | Clears |
|---|---|---|---|
| 10 | **Health domain relocation**: ingestion/scope/analytics services → 3_applications/health + adapters; keep pure cores | L | D-2, D-4, D-6, D-11, D-12 (~⅓ of domain findings) |
| 11 | **Fitness vertical pass**: `selectPrimaryMedia` → domain (fixes A-2 + P-1 together); Strava/Plex-neutral service rename + ports; fitness.mjs god-router decomposition (SimulationService, ManageAccessUseCase, session-query use case); Session entity encapsulation + timestamp params; zone SSOT (from #6) | XL | A-2, P-1, P-2, API-3(fitness), D-5, D-9 |
| 12 | **Admin backend**: HouseholdAdminService, YamlConfigFileService, JobsService, IntegrationsQueryService behind the five admin routers | L | API-3(admin) |
| 13 | **Piano backend**: PianoContainer + use cases; router keeps validation/shaping | L | API-3(piano), P-11 |
| 14 | **Composition root consolidation**: finish `bootstrap/` per-domain modules, relocate out of 0_system tier, app.mjs → mount loop, absorb rogue roots (camera/index, DeviceFactory), extract bootstrap business logic (posterProvider, saved-query store, cron config) | XL | X-1, X-2, S-3, P-1(partial), API-2 |
| 15 | **UserDataService retirement**: delegate-then-migrate 142 call sites per its own deprecation header | L | X-7, S-13 |
| 16 | Rendering pass: eink `resolveData` → app layer; gratitude selection → callback; receipt histogram → domain stats; einkTheme + timelapse theme; adopt lib/ primitives; move `0_system/canvas` → 1_rendering | M–L | R-1…R-8, S-9 |

### P3 — Plan-first migration (do not spot-fix)
| # | Action | Effort | Clears |
|---|---|---|---|
| 17 | **Serialization ownership migration** (`toJSON`/`fromJSON` out of 75 domain entities; datastores own `#hydrate`/`#dehydrate`): write `docs/_wip/plans/` doc first; phase 1 = the in-memory round-trippers (messaging, gratitude); phase 2 = entity-by-entity as touched; ratchet rule for new code immediately | XL | D-3, D-10, A-13 |
| 18 | Neutral content-ID scheme replacing `plex:{id}` as universal media key | XL | P-2 long tail |

---

## Appendix — Quantified metrics

| Metric | Value |
|---|---|
| Upward imports from `0_system` (docs say zero) | 211 (95 #adapters, 68 #apps, 29 #api, 19 #domains) |
| Composition god files | `bootstrap.mjs` 4,252 + `app.mjs` 2,914 lines |
| Prescribed system error classes implemented | 0 of 4 |
| Generic `throw new Error` | 130 in domain (vs 276 typed), 57 in system |
| Adapters setting `isTransient` | 5 / 295 (1.7%) |
| Adapter classes extending a port | 80 / 206 (39%) |
| Adapter configService singleton imports | 21 (all harvesters + all proxies + 3) |
| Raw `fetch` in adapters | 10 files (~19 sites); raw fs 19; raw path 48 |
| Domain files with `toJSON()` / `fromJSON` | 75 / 29 (~25% of layer) |
| Domain clock reads | `new Date(` 49 files (155×); `Date.now(` 8 files |
| Domain services fetching via stores | 20 |
| App-layer files importing adapters | 11 (8 services + 3 containers) |
| App-layer `{success:false}` returns | 49 in 26 files |
| App-layer silent catches | 40 in 30 files; adapter layer 22; domain ~6 genuine |
| 4_api files with forbidden imports | 20 / ~95 (21%) |
| Hand-rolled `res.status(500)` | 157 in 38 files; error middleware in 3/82 routers |
| Hardcoded `'America/Los_Angeles'` | 96 in 49 files |
| Zone threshold tables / palettes | 2 drifted / 2 divergent |
| YAML I/O implementations | 4 + 28 direct yaml.load callers + 28 direct-fs files above tier 0 |
| Household-folder resolvers / raw `'household'` joins | 3 / 20 sites in 9 files |
| `deepMerge` implementations | 4 |
| Dead/zero-importer port files | ≥4 (two pairs with signature drift) |
| Deprecated `UserDataService` call sites | 142 |
| Banned deep-relative imports | 44 lines in 17 files |
| `#applications` vs `#apps` alias usage | 7 vs 219 |
| Apps without `ports/` | 13 / 38 |

---

*Produced by seven parallel audit passes (one per layer + cross-cutting), 2026-07-06. Every finding was verified by file read before inclusion; counts are grep-derived over non-test `.mjs` files.*
