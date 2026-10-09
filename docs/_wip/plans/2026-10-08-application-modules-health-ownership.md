# Health, nutrition and NutriBot ownership

Source partition at `759be3aaf7` for milestone 3. The nutrition primitive
extraction described below is implemented; broader Health ownership remains pending.
Health owns nutrition records, observations, reconciliation and health policy.
NutriBot owns the existing conversational capture/report workflow. Sharing those
records does not require promoting health policy into a generic platform service.

| Existing group | Ownership disposition |
| --- | --- |
| `2_domains/health`, `2_domains/nutrition` | Health domain, preserving the two internal namespaces where useful. Export only the nutrition record/schema operations required by NutriBot through an explicit contract entry. |
| `3_applications/health`, `3_applications/nutrition` | Health application services/ports. Includes cleanup, recovery, observation pairing, receipt synchronization and reconciliation jobs. |
| `3_applications/nutribot` | NutriBot workflow, bot routing, use cases, configuration presentation and daily-report policy, except the shared record/scale primitives identified below. |
| `1_adapters/health`, `1_adapters/nutrition` | Health persistence/archive and nutrition-provider adapters. Vendor implementation remains behind its owner composition. |
| `1_adapters/nutribot` | NutriBot capture, messaging identity, web-response, barcode and report-delivery adapters. A vendor/shared primitive is not extracted merely because it could be reused someday. |
| `YamlHealth*`, `healthYaml*`, `HealthMetricRecordCodec*`, `YamlMedicalReadings*`, `YamlFoodCatalog*`, `YamlSavedMeals*`, `YamlMealTemplate*`, `YamlObservationStore*`, `YamlNutritionSurfaceCheckpoints*`, `DataServiceHealthDashboardRepository*` | Health adapters, including their colocated tests. |
| `YamlFoodLogDatastore`, `YamlNutriLogDatastore`, `YamlNutriListDatastore` and corresponding datastore ports currently under NutriBot | Health record persistence contracts and adapters. Both products consume the same existing store authority. Preserve methods, serialization and paths exactly; do not create replacement stores per consumer. |
| `4_api/v1/routers/health*`, `nutrition.mjs`, food-catalog/pending-nutrition presenters | Health API and tests. |
| `4_api/v1/routers/nutribot.mjs`, `4_api/v1/handlers/nutribot` | NutriBot API, preserving webhook/report/direct-input semantics. |
| `1_rendering/nutribot/NutritionReceiptRenderer*` | Health rendering: concrete consumers are nutrition receipt publication and surface synchronization. |
| Other `1_rendering/nutribot` files and `DailyReportPresentation` | NutriBot report rendering/presentation. Shared renderer helpers remain canonical. |
| `frontend/src/Apps/HealthApp*`, `frontend/src/modules/Health` | Health browser surfaces, settings, chat overlays, auditor, medical and progress views. The shared AgentChatSurface remains agent-runtime capability. |
| `5_composition/modules/healthApi`, `nutritionCleanup`, `nutritionSurfaceSync` | Health composition. Existing process-level scheduling remains host assembly calling owner factories. |
| `5_composition/modules/nutribotApi` | NutriBot composition, consuming Health's published meal/revision operations. |

## Concrete reverse dependencies to remove

Health's nutrition services currently import record/scale implementation from
NutriBot. Moving both directories without settling these edges leaves the old
ownership problem intact:

- `ObservationService` imports `nutribot/lib/unsettledStamp.mjs`.
- `ScaleCapture` imports `nutribot/nutriLogRecords.mjs`.
- `ScaleCapture` and `ObservationPairingService` import `resolveScaleNet` from
  the entire `LogFoodFromScale` use case.
- `NutritionCaptureRecovery`, pairing, capture, and Health composition use
  portions of `nutribot/lib/scaleNutribotConfig.mjs`.

Move the record factory/serialization and unsettled stamp to Health, with narrow
published nutrition operations consumed by NutriBot. Extract the existing pure
`resolveScaleNet` body unchanged beside Health's scale calculations. NutriBot's
`LogFoodFromScale` calls that function; Health must not import a bot use case.

The scale-config file is genuinely mixed. Normalization, container/density
lookup, and shared defaults belong to Health's nutrition configuration contract;
Telegram keyboard and prompt builders remain NutriBot presentation. Preserve the
existing configuration keys, defaults, quiet-period limits, callback encoding,
and warning behavior. This is relocation, not a configuration migration.

The opposite dependency is intentional: NutriBot uses Health's food-log review,
icon selection, nutritional calculations, record contracts, meal commands and AI
revision services. Publish specific operations/factories required by those
consumers rather than a barrel exposing every Health internal. Existing injected
stores and gateways retain their identity and method semantics.

## Evidence and acceptance

`nutribotApi.mjs` currently assembles `MealInstructionService`, `MealFoodCommands`,
`ReviseEntryService` and `ReviseDishService` from Health, using the same
`nutriListStore`/`foodLogStore` supplied by NutriBot services. That identity is a
required composition invariant. `createNutriLog` preserves item IDs and UUIDs;
`stampUnsettled` distinguishes an absent historical settlement key from explicit
false. Neither can be simplified while moving.

Use existing stored-shape, settlement, scale observation/pairing, capture recovery,
receipt lifecycle, bot auto-commit, budget/timezone, and API tests before/after.
Keep tests that cross the products as integration tests through their public
entries; do not remove assertions to force a clean ownership graph. Include
Health browser cache/user identity and route behavior in the browser build and
selected UI tests. Generic PhotoStore/VoiceMemoStore/IconManifestStore ownership
requires the broader persistence consumer census; their filenames alone do not
establish ownership.

This partition does not rename NutriBot routes, agent IDs, Telegram bot IDs,
configuration keys, persisted records, or scheduled jobs. Final file mapping must
include associated admin/config/assets and external CLI consumers from the full
census before the batch is complete.

## Nutrition primitive extraction

Following the M2 checkpoint `9f19f9f2f7`, Health owns three explicit server facets:
`nutrition-records.mjs` (creation, serialization and settlement stamping),
`scale-config.mjs` (existing defaults, normalization and lookup functions), and
`scale-weight.mjs` (the existing pure tare-resolution function). Their implementation
lives under Health application/domain directories. Nutribot's `scalePrompts.mjs`
retains Telegram prompt and keyboard bodies. Consumers use the new facets; the old
record/stamp/config implementations are removed rather than kept as forwarding trees.

The before-change baseline `health-FmhWct` passed 165 named assertions across eight
existing suites, including persisted-weight/prompt agreement. Candidate parity,
native entry checks and final architecture/build verification remain required.

## Full owner extraction checkpoint

The 679-file Health/Nutribot move is applied, with 14 stable CLI launchers.
Supplemental ownership review placed food-log operations, UPC nutrition lookup,
nutrition audit/artwork stores, captured photos/audio, icon manifests, and nutrition
configuration under Health. Shared backend code no longer constructs the Health
runtime, nutrition budget, CLI analytics, or coaching registration directly; owned
composition factories preserve their original initialization phases.

`health-n1YXPT` passed all 165 original core assertion names. After correcting three
obsolete density-contract imports, `health-stack-TlubL3` passed all 146 supplemental
assertion names, with isolation controls and protected inputs unchanged. The latter
retains the documented synthetic scratch mtime/copy adapter; it does not establish
native metadata or host-process parity.

Subsequent, not yet runtime-verified changes move mentions, scan setup, nutrition
lookup, scale observation startup, and weekly maintenance into Health's
`server/composition/app-runtime.mjs`. The host retains live analytics/observation
references; callbacks resolve them when invoked. Four explicit nutrition domain
facets and three browser entry points replace private consumer imports. Static
parsing and local import checks pass for 702 Health/Nutribot source files.

Lazy capture services now live behind a Health application contract, with one
cache per Nutribot container and a regression for first-use reads and identity.
Health also owns nutrition web dependencies and capture storage/vocabulary.
Nutribot supplies destination factories at the original initialization points;
Health no longer imports its private identity adapter. The shared response port
moved as one unchanged class body into common application ports, with Telegram
and Nutribot resolving the same authority. Explicit nutrition-port and scan
contracts replace additional private imports. The latest static check covers
708 Health/Nutribot sources with no missing local imports.

These changes still require confined candidate verification and final boundary
closure. They do not certify completion of milestone 3.

The residual bridge cleanup removed six unused Health/Nutribot exports from
neutral agent/router barrels and deleted the old sheet-provider forwarding file.
App, printable-sheet CLI, and sheet tests now use the Health sheet contract.
Health and Lifeplan share one common agent working-memory template; its Markdown
content is unchanged, and existing schema/template identity assertions remain.

The nutrition wire-test fixture now lives in `tests/_fixtures/nutrition`, outside
production AI adapters; both original tests import that fixture. The food-capture
wire benchmark CLI, library and tests now live under `modules/nutribot/cli`.
Its original CLI path remains a static-import launcher with the original dispatch
and executable mode. Six changed files retain identical parsed bodies after
masking import paths; the benchmark was not executed against live AI services.
The latest static Health/Nutribot import check covers 711 files with no missing
local targets. These are structural checks, not candidate runtime verification.

### Final installed public boundaries

Nutribot's optional report-renderer initialization now lives in its owned
`server/composition/report-renderer.mjs`. Installed app composition awaits that
operation at the original phase. The exact constructor, configuration reads,
native dynamic import, success/failure logging and null fallback are preserved;
static comparison verifies the extracted block. Runtime verification is pending.

The remaining reviewed interfaces are the actual owned CLI entries and existing
composition operations, Health's weight-processing application boundary injected
into Withings, Nutribot's Telegram identity adapter injected into scan dispatch,
and the Health budget-zone contract consumed by Nutribot report captions.
These are explicit public contracts; no directory-wide access is intended.
The reviewed packet lists 24 exact entries, including the new renderer factory.
