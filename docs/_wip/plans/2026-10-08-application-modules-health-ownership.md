# Health, nutrition and NutriBot ownership

Source partition at `759be3aaf7` for milestone 3; implementation is still pending.
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
