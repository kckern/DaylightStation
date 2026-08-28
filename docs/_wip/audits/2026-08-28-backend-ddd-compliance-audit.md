# Backend DDD Compliance Audit

**Date:** 2026-08-28  
**Scope:** Production code in `backend/src/` and the project's layer-audit gate. Tests were not treated as production-layer violations because the gate intentionally excludes `*.test.mjs`.

## Verdict

**Not compliant.** The core dependency direction is healthy, but the backend has substantial, acknowledged transition debt and one new regression that makes the existing layer gate fail.

`npm run audit:layers` currently exits non-zero:

| Rule | Current | Baseline | Result |
|------|--------:|---------:|--------|
| `adapters-no-direct-fs` | 93 | 92 | Regression |

All other existing rule counts are at or below their baselines. A baseline match is not compliance: it only means no new debt was added for that rule.

## Confirmed Findings

### P0 — New adapter bypasses the required atomic FileIO path

[`YamlReadingSessionTimelineStore`](../../../backend/src/1_adapters/persistence/yaml/YamlReadingSessionTimelineStore.mjs) imports `fs`, reads its YAML file, and writes it directly with `fs.writeFile`.

This is the one new `adapters-no-direct-fs` finding. It violates Decision D10, which bans direct adapter filesystem access in favor of `#system/utils/FileIO.mjs`; the decision was made specifically after a non-atomic YAML read-modify-write corrupted a school record. The store's in-process promise chain does not make writes atomic or coordinate separate processes.

**Remediation:** use the FileIO YAML load/save helpers and its atomic writer, or add an adapter-facing persistence primitive there. Do not raise the baseline.

### P1 — API layer still contains wiring and direct cross-layer dependencies

The API guideline permits only API/system HTTP utilities at module scope; dependencies from other layers must be injected by composition. The current gate reports 33 forbidden runtime imports:

| Rule | Count | Representative locations |
|------|------:|--------------------------|
| `api-no-adapters` | 10 | [`admin/content.mjs`](../../../backend/src/4_api/v1/routers/admin/content.mjs), [`art.mjs`](../../../backend/src/4_api/v1/routers/art.mjs), [`screens.mjs`](../../../backend/src/4_api/v1/routers/screens.mjs) |
| `api-no-apps` | 13 | [`content.mjs`](../../../backend/src/4_api/v1/routers/content.mjs), [`fitness.mjs`](../../../backend/src/4_api/v1/routers/fitness.mjs), [`trigger.mjs`](../../../backend/src/4_api/v1/routers/trigger.mjs) |
| `api-no-domains` | 9 | [`media.mjs`](../../../backend/src/4_api/v1/routers/media.mjs), [`play.mjs`](../../../backend/src/4_api/v1/routers/play.mjs), [`school.mjs`](../../../backend/src/4_api/v1/routers/school.mjs) |
| `api-no-config` | 1 | [`api.mjs`](../../../backend/src/4_api/v1/routers/api.mjs) |

Several are concrete wiring violations, not merely type references:

- `admin/content.mjs` imports both `YamlListDatastore` and `ListManagementService`, then supplies a fallback `new ListManagementService(...)`.
- `content.mjs` imports application/domain code and constructs `ContentAlternatesService` in a route handler.
- `device.mjs` imports and constructs `DispatchIdempotencyService` when one is not injected.
- `createAgentMemoryRouter.mjs` imports `WorkingMemoryState` from applications.

There are also 13 production API modules importing Node filesystem/process APIs directly (including `proxy.mjs`, `screens.mjs`, `canvas.mjs`, and `routers/lib/emulatorFs.mjs`). The current gate does not test this, but it conflicts with the API layer's translation-only responsibility.

**Remediation:** move construction and filesystem/proxy work into adapters or application use cases; wire the resulting ports/use cases in `5_composition`; make router factory parameters required rather than providing construction fallbacks.

### P1 — Application layer owns infrastructure/configuration concerns

The ratchet preserves the following direct application-layer violations:

| Rule | Count | Meaning |
|------|------:|---------|
| `apps-no-config-internals` | 8 | Imports from `#system/config/` |
| `apps-no-fs` | 19 | Direct filesystem or child-process imports |
| `apps-no-fileio` | 8 | Direct `FileIO` imports, which D5 bans from applications |

Examples include [`ArchiveService`](../../../backend/src/3_applications/content/services/ArchiveService.mjs) (filesystem, YAML, config singletons, and `UserDataService`), [`MediaMemoryService`](../../../backend/src/3_applications/content/services/MediaMemoryService.mjs) (paths and filesystem), and [`DashboardToolFactory`](../../../backend/src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs) (config singleton).

The scan also found application code that receives `configService` and then navigates infrastructure-specific config shapes, e.g. [`cameraArchiveJobHandler.mjs`](../../../backend/src/3_applications/camera/cameraArchiveJobHandler.mjs). That escapes the import-based rule but conflicts with the documented “no config structure knowledge” rule.

**Remediation:** introduce app-owned ports for persistence, process execution, and resolved feature settings. Inject concrete implementations and resolved values from composition.

### P1 — Adapter filesystem migration remains large

There are now 93 direct Node filesystem imports across adapters. Most are YAML stores and belong in an adapter layer, but Decision D10 still requires them to use FileIO so writes are atomic and behavior is centralized. Four adapters also import other adapters directly, contrary to the peer-isolation rule:

- [`ImmichCanvasAdapter.mjs`](../../../backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs)
- [`LocalContentAdapter.mjs`](../../../backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs)
- [`YouTubeContentSource.mjs`](../../../backend/src/1_adapters/content/media/youtube/YouTubeContentSource.mjs) (two imports)

**Remediation:** first fix the new timeline-store regression, then migrate the high-write-risk YAML stores in small batches. Extract genuinely shared codec/resolver utilities to an allowed lower/shared layer rather than importing a sibling adapter.

### P2 — Domain purity has no forbidden imports, but has implicit clocks

The strongest result: `domains-no-adapters` and `domains-no-node-io` are both zero, and no domain imports applications, API, rendering, or system modules outside the documented shared-kernel exception.

However, the domain guidelines explicitly prohibit knowing the current time. Production domain code still reads an implicit clock in at least these places:

- [`MediaProgress.mjs`](../../../backend/src/2_domains/content/entities/MediaProgress.mjs) falls back to `Date.now()`.
- [`ShutdownState.mjs`](../../../backend/src/2_domains/shutdown/ShutdownState.mjs) defaults both methods to `Date.now()`.
- [`FoodCatalogEntry.mjs`](../../../backend/src/2_domains/health/entities/FoodCatalogEntry.mjs) stamps dates itself.
- [`Goal.mjs`](../../../backend/src/2_domains/lifeplan/entities/Goal.mjs), [`Belief.mjs`](../../../backend/src/2_domains/lifeplan/entities/Belief.mjs), and [`Headline.mjs`](../../../backend/src/2_domains/feed/entities/Headline.mjs) supply current-time defaults.

`Math.random()` is likewise used in domain selection and ID paths. It is not explicitly ratcheted, but injecting an RNG where deterministic behavior matters would improve testability.

**Remediation:** require a timestamp/clock value at factory or operation boundaries; preserve the existing `core/utils/time.mjs` approach as the model.

### P2 — Serialization and governance documentation remain out of sync

- The gate finds 67 domain `toJSON()` definitions. This is known migration debt, but directly conflicts with the domain guideline that adapters own hydration/dehydration.
- Decision D6 requires every folder in `2_domains/` to appear in the hierarchy table. The table in `ddd-reference.md` omits `camera`, `donow`, `economy`, `exercise`, `measures`, `midi`, `piano`, `pianoaudio`, `scan`, and `shutdown`.

The current domain graph does not show cross-domain runtime imports, so no upward domain dependency was found. The incomplete table nevertheless prevents future checks from determining whether a new cross-domain import is legal.

## What Passed

- `0_system` has no forbidden upward imports.
- Domain code has no adapter/API/application/rendering imports and no Node filesystem/process imports.
- Applications have no direct `#adapters` imports.
- Rendering has no adapter/application imports.
- No deep relative import crosses a numbered layer.
- Of 98 production adapters that import an application port at runtime, all but a documentation-only source-registry reference declare an `extends` relationship; no obvious D7 contract bypass was found in that sample.

## Audit-Gate Gaps

The existing gate is useful as a ratchet but is not a complete DDD compliance proof:

1. It scans only non-test `.mjs` files and static one-line import/export syntax.
2. It does not flag direct Node I/O in the API layer.
3. It cannot detect a dependency injected as `configService` and then used to traverse config/storage internals.
4. It does not enforce implicit-clock purity in domains.
5. It reports baseline debt as “ok,” which is expected ratchet behavior but should not be read as compliant.

## Recommended Order

1. Fix `YamlReadingSessionTimelineStore` with the atomic FileIO path and return the gate to green.
2. Eliminate API-layer construction/imports in `admin/content`, `content`, `device`, and agent memory routing; move their dependencies to composition.
3. Replace application-layer filesystem/config use with ports and resolved settings, starting with high-risk read-modify-write paths.
4. Continue adapter FileIO migration, prioritizing YAML stores that write mutable household records.
5. Add the missing domain hierarchy entries and then ratchet implicit clocks and domain serialization downward.
