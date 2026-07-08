# Neutral Content-ID Scheme — Design + Counted Inventory (audit P-2)

> **Status:** Design accepted; Phase 0 executed (this commit series). Phases 1–5 are follow-up work.
> **Origin:** DDD compliance remediation plan, Task P3.2 (`2026-07-06-ddd-compliance-remediation-plan.md`).
> **Scope note:** This document is the executable plan for extirpating `plex:{id}` assumptions.
> Full execution was explicitly judged beyond safe mechanical refactoring; each phase below is
> sized to be independently shippable with its own exit criteria.

## 1. Problem statement

The wire format for content identity is already neutral: `contentId = {source}:{localId}`
(e.g. `plex:457385`, `singalong:hymn/166`, `files:video/news/channel`). `ItemId` (domain VO)
and the `ContentSourceRegistry` / `ContentIdResolver` seam parse and dispatch it correctly.

The problem is NOT the format. It is the large body of code that **assumes `source === 'plex'`**
or handles **bare ratingKeys** (Plex's local id) as if they were universal:

- builders that hardcode the vendor prefix: `` `plex:${id}` ``
- strippers that hardcode its removal: `String(id).replace(/^plex:/, '')`
- conditionals that branch on the vendor: `source === 'plex'`
- URLs that encode the vendor into neutral layers: `/api/v1/display/plex/{id}`,
  `/api/v1/content/plex/image/{id}`
- vendor-named identifiers in neutral layers: `plexId`, `backgroundPlexId`, `IFitnessSyncerGateway`

Any second media source (Jellyfin, a second Plex instance, local files promoted to primary)
currently requires touching every one of these sites.

## 2. Counted inventory (measured 2026-07-08, branch `refactor/ddd-compliance-p3`)

All counts exclude test files (`| grep -v test`). Regenerate with the commands shown.

### 2.1 `plex:` string occurrences

```bash
grep -rn "plex:" backend/src frontend/src --include='*.mjs' --include='*.js' --include='*.jsx' | grep -v test | wc -l
# → 228
```

| Layer | Occurrences | Files |
|---|---:|---:|
| frontend | 85 | 44 |
| backend/3_applications | 50 | 25 |
| backend/1_adapters | 50 | 9 |
| backend/4_api | 27 | 11 |
| backend/2_domains | 9 | 6 |
| backend/0_system | 5 | 2 |
| backend/app.mjs (root) | 2 | 1 |
| backend/5_composition | 0 | 0 |
| **Total** | **228** | **98** |

### 2.2 Vendor-named identifiers

```bash
grep -rn "plexId" backend/src frontend/src --include='*.mjs' --include='*.js' --include='*.jsx' | grep -v test | wc -l   # → 88
grep -rn "ratingKey" backend/src frontend/src --include='*.mjs' --include='*.js' --include='*.jsx' | grep -v test | wc -l # → 103
```

| Identifier | frontend | 1_adapters | 3_applications | 4_api | Total |
|---|---:|---:|---:|---:|---:|
| `plexId` | 71 | 11 | 5 | 1 | **88** |
| `ratingKey` | 19 | 65 | 4 | 15 | **103** |

`ratingKey` inside `1_adapters/content/media/plex/` (65 of 103) is **correct** — that is Plex's
own field name at the vendor boundary. The 34 occurrences in 4_api/3_applications/frontend
outside the adapter are leakage.

### 2.3 Assumption sites by category

| Category | Pattern | frontend | 1_adapters | 3_applications | 4_api | Total |
|---|---|---:|---:|---:|---:|---:|
| Prefix builders | `` `plex:${…}` `` | 21 | 18 | 10 | 1 | **50** |
| Prefix strippers | `replace(/^plex:/…)` | 11 | 9 | 10 | 0 | **30** |
| Prefix strippers (alt) | `replace('plex:'…)` | — | — | — | — | **7** |
| Source conditionals | `=== 'plex'` / `startsWith('plex'` | 3 | 4 | 2 | 5 | **15** (+1 in 2_domains `Item.mjs`) |
| Vendor URL paths | `/display/plex`, `/content/plex` | 3 | 0 | 11 | 5 | **19** |

Source-conditional sites (full list, non-test):

- `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs` (2)
- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` (1 — legitimate, at the boundary)
- `backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs` (1)
- `backend/src/2_domains/content/entities/Item.mjs` (1 — vendor branch inside a domain entity)
- `backend/src/3_applications/content/usecases/ComposePresentationUseCase.mjs` (1)
- `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs` (1)
- `backend/src/4_api/v1/routers/localContent.mjs` (2), `info.mjs` (2), `item.mjs` (1)
- `frontend/src/modules/Fitness/player/FitnessShow.jsx` (2), `frontend/src/hooks/fitness/PersistenceManager.js` (1)

## 3. Existing seams (read 2026-07-08 — these already work; build on them)

### 3.1 `ItemId` VO — `backend/src/2_domains/content/value-objects/ItemId.mjs`

Immutable `{source, localId}` value object. Already provides everything the neutral scheme
needs at the value level:

- `ItemId.parse(str)` / `tryParse(str)` — split on first colon, validate both halves
- `ItemId.from(source, localId)`, `toString()` → `"source:localId"`, `toJSON()`, `equals()`
- `ItemId.extractSource(compoundId)` — prefix or null
- `ItemId.normalize(id, fallbackSource)` — **the sanctioned replacement for every
  hand-rolled `` includes(':') ? id : `plex:${id}` `` site.** Pass-through if already
  compound; prepends `fallbackSource` for bare ids. (Note: returns `null` for null input,
  whereas some hand-rolled sites produce `"plex:null"` — verify per-site when migrating.)

Per `coding-standards.md`, `source:localId` is the sanctioned compound format.

### 3.2 `IContentSource` port — `backend/src/3_applications/content/ports/IContentSource.mjs`

The gateway seam already exists — no new interface is required. Every content source
implements:

```
source: string                       // e.g. 'plex'
prefixes: [{prefix, idTransform?}]   // prefixes the adapter claims
getItem(id) → Item|null
getList(id) → ListableItem[]
resolvePlayables(id) → PlayableItem[]
resolveSiblings(compoundId) → {parent, items}|null
getStoragePath?(id)                  // optional, watch-state storage
```

`validateAdapter()` enforces the shape at registration; `ContentSourceBase` is the abstract
base. `PlexAdapter` (`1_adapters/content/media/plex/PlexAdapter.mjs`) registers
`source: 'plex'`, `prefixes: [{prefix: 'plex'}]`.

### 3.3 `ContentSourceRegistry` — `backend/src/2_domains/content/services/ContentSourceRegistry.mjs`

`register(adapter, {category, provider})` indexes by source name, prefix, category
(gallery/media/readable), and provider. `resolve(compoundId)` → `{adapter, localId}` —
splits on first colon, exact-source match, then prefix fallback; colon-less ids default to
the `media` adapter. `registerPrefixAliases({hymn: 'singalong:hymn'})` maps legacy prefixes.

### 3.4 `ContentIdResolver` — `backend/src/3_applications/content/ContentIdResolver.mjs`

The 6-layer resolution chain (exact source → registry prefix → system alias → bare-name map →
media default → household alias → empty-rest fallback). **This is the front door.** Code that
needs an adapter for a contentId should come through here (or `registry.resolve`), never
branch on the prefix itself.

### 3.5 `contentIdKeys.mjs` — `backend/src/3_applications/devices/contentIdKeys.mjs`

Partial neutral scheme for the WS-content-delivery path: `CONTENT_ID_KEYS` priority list
(`queue`, `play`, `play-next`, `plex`, `hymn`, `primary`, `scripture`, `contentId`) +
`resolveContentId(query)`. Note `plex` survives here as a **legacy query key** — it maps a
vendor-named URL param to a neutral `params.contentId`. This is boundary normalization done
right; the key itself is retired in Phase 4 (frontend stops sending it) and then removed.

## 4. Design

### 4.1 Canonical rules

- **R1 — compound across boundaries.** `contentId` (`{source}:{localId}`) is the only content
  identity that crosses a layer boundary (API ⇄ applications ⇄ domains, backend ⇄ frontend,
  persisted YAML). Bare `localId` exists only *inside* an adapter after `registry.resolve()`
  has split it.
- **R2 — no vendor conditionals outside the adapter.** `source === 'plex'` branches are legal
  only inside `1_adapters/content/media/plex/`. Everywhere else, dispatch through
  `ContentIdResolver` / `ContentSourceRegistry`, or model the need as a capability on the item.
- **R3 — no hand-rolled prefix building/stripping.** Use `ItemId.normalize(id, defaultSource)`
  to make ids compound and `ItemId.parse(id).localId` (or `registry.resolve().localId`) to get
  local ids. `defaultSource` comes from config (fitness already has
  `content_source: 'plex'` via `FitnessConfigService`), never a literal — except at the one
  boundary site per entry point that legalizes legacy bare ids.
- **R4 — no vendor URLs in neutral layers.** Application code must not construct
  `/api/v1/display/plex/{localId}` or `/api/v1/content/plex/image/{localId}`. Images/thumbnails
  come from adapter-populated item fields (`item.thumbnail`) or a neutral endpoint
  (`/api/v1/content/image/{contentId}`) that dispatches via the registry.
- **R5 — naming.** `contentId` = compound string; `localId` = bare source-local id; `source` =
  prefix. `plexId` is banned in new code; `ratingKey` is legal only inside the Plex adapter.

### 4.2 Gateway seam

No new interface: `IContentSource` + `ContentSourceRegistry.resolve(contentId)` **is** the
`IContentSource.resolve(contentId)` seam the audit asked for. The work is call-site migration,
plus one gap: neutral image/poster delivery (R4) — either a `getImageUrl(localId)` capability
on `IContentSource` or a neutral API route that resolves through the registry. Decide in
Phase 2 (route is less invasive; capability is cleaner).

## 5. Assumption-site catalog (representative; drives phase ordering)

### 5.1 Bare-ratingKey producers/holders (documented, NOT renamed — renaming would lie)

| Site | Detail |
|---|---|
| `3_applications/fitness/FitnessPlayableService.mjs:42,55` | `getPlayableEpisodes(showId)` takes a **bare** Plex show id; builds `` `plex:${showId}` `` internally. Callers (all 5 suggestion strategies) strip prefixes before calling. Fix in Phase 1: accept compound, normalize once. |
| `3_applications/fitness/activities/CycleGameProvider.mjs:58` | `meta.backgroundPlexId` ← config `race.background_plex_id` (bare ratingKey, e.g. `674141`). Data contract with frontend + YAML config schema — migrate in Phase 5 with back-compat read. |
| `3_applications/piano/UserVideoProgressStore.mjs:35–53` | `record({userId, plexId, …})` — accepts bare **or** compound (strips `^plex:`). `plexId` is a cross-layer contract: `4_api/v1/routers/play.mjs:185` passes `plexId: assetId`. Rename in Phase 5 (param + router + tests together). |
| `3_applications/fitness/services/SessionService.mjs:322–335` | Deliberately prefixes bare ids from the fitness app with `plex:` (documented legacy-compat). This is a correct R3 boundary site — keep, but source the fallback from config. |
| `contentIdKeys.mjs` `plex` query key | Legacy wire param; retire in Phase 4. |

### 5.2 Fitness suggestion strategies (Sub-task B verification result, 2026-07-08)

Read in full: `NextUpStrategy`, `DiscoveryStrategy`, `ResumeStrategy`, `FavoriteStrategy`,
`MemorableStrategy`, `FitnessSuggestionService`. **Zero `plexId`-style variable names remain**
— prior work already neutralized naming (`contentId`, `showId`, `localId`, `cid`, `sid`,
`bareGid`, `localShowId`). One compound-valued variable was named off-vocabulary and is
renamed in this commit series (`DiscoveryStrategy.mjs:63` `compoundId` → `contentId`; value
verified compound: `` `plex:${show.id}` `` keyed against session `media.primary.grandparentId`).

What remains in the strategies is **value-level** vendor coupling (out of scope for a rename
pass; scheduled below):

- builders: `DiscoveryStrategy.mjs:63,166`, `FavoriteStrategy.mjs:16` → Phase 1
- strippers: `FavoriteStrategy.mjs:17`, `ResumeStrategy.mjs:30`, `NextUpStrategy.mjs:49,72`, `MemorableStrategy.mjs:85,111`, `FitnessSuggestionService.mjs:74` → Phase 1 (collapse when `FitnessPlayableService` accepts compound ids)
- vendor URLs (`/api/v1/display/plex/…`, `/api/v1/content/plex/image/…`): all five strategies → Phase 2
- config keys `fitnessConfig.plex.*` (`governed_labels`, `warmup_title_patterns`, `deprioritized_labels`, `resumable_labels`, `library_id`) → Phase 5 (YAML schema migration with fallback)

### 5.3 Vendor-named identifiers deferred (measured against the <5-file bar)

| Identifier | Files | Decision |
|---|---:|---|
| `IFitnessSyncerGateway` / `FitnessSyncer*` | **14** in backend/src (port, ports/index, bootstrap, 3 harvester adapters, health domain entities/services/index, lifelog extractor, ReconciliationProcessor, IHealthDataDatastore, YamlHealthDatastore, health router) | **Deferred** (≥5 bar). Note: "FitnessSyncer" is the actual name of the external SaaS being integrated — the *adapter* names are legitimate; only the application-layer **port** `IFitnessSyncerGateway` → `IExternalFitnessDataGateway` is Phase 5 work. |
| `plexId` in frontend | 71 occurrences / ~dozens of files | Phase 4 |
| `backgroundPlexId` + `background_plex_id` | data + config contract | Phase 5 |

## 6. Phased rollout plan

Gates for every phase: GATE-IMPORT, GATE-AUDIT (`node scripts/audit-layer-imports.mjs`),
GATE-UNIT (`npm run test:unit`), GATE-REFACTOR. No stored-data rewrites in any phase —
persisted `plex:123` contentIds are already in the neutral format and stay valid forever.

### Phase 0 — vocabulary + inventory (THIS COMMIT SERIES)
Design doc, counted inventory, compound-valued variable renames in fitness suggestions.
**Exit:** doc merged; suggestion tests identical (41/41); no behavior change.

### Phase 1 — application-layer boundary normalization (backend, fitness first)
`FitnessPlayableService.getPlayableEpisodes` accepts compound `contentId` (normalizes once via
`ItemId.normalize(id, fitnessConfig.contentSource)`); strategies stop stripping/building
prefixes; `SessionService` fallback source reads from config. Then sweep remaining
3_applications builders/strippers.
**Exit:** `grep -rn 'plex:\${' backend/src/3_applications | grep -v test` → 0;
`grep -rnF "replace(/^plex:" backend/src/3_applications | grep -v test` → 0; gates green.

### Phase 2 — neutral image/thumbnail delivery
Add `/api/v1/content/image/{contentId}` (registry-dispatched) or `getImageUrl` capability;
migrate the 11 application-layer + 5 API-layer vendor-URL sites; frontend keeps working via
the old routes until Phase 4.
**Exit:** `grep -rn "display/plex\|content/plex" backend/src/3_applications | grep -v test` → 0.

### Phase 3 — retire source conditionals
The 15 `=== 'plex'` sites become capability checks or registry dispatch; `Item.mjs` (domain
entity!) loses its vendor branch first.
**Exit:** `grep -rn "=== 'plex'" backend/src --include='*.mjs' | grep -v test | grep -v 1_adapters/content/media/plex` → 0.

### Phase 4 — frontend neutralization
Frontend builds/consumes `contentId` end-to-end: rename `plexId` props/params, stop sending
the legacy `plex` query key (then delete it from `CONTENT_ID_KEYS`), route images through the
neutral endpoint.
**Exit:** `grep -rn "plexId" frontend/src | grep -v test` ≤ 5 (legacy localStorage/back-compat
readers only, each with a comment); Playwright fitness + player flows green.

### Phase 5 — contracts & schema renames (each independently shippable)
1. `IFitnessSyncerGateway` → `IExternalFitnessDataGateway` (port + bootstrap + importers).
2. `UserVideoProgressStore.record({plexId})` → `{contentId}` (+ `play.mjs`, tests).
3. `background_plex_id` → `background_content_id` (read both, write new).
4. `fitness.plex.*` config keys → neutral section with fallback reads in `FitnessConfigService`.
**Exit:** `grep -rn "plexId" backend/src | grep -v test | grep -v 1_adapters` → 0.

### Ratchet
After Phase 1, add an audit ratchet rule (`neutral-content-id`) to
`scripts/audit-layer-imports.mjs`'s baseline mechanism counting builders + strippers +
conditionals outside `1_adapters/content/media/plex/`, so counts only go down.

## 7. Non-goals

- Rewriting persisted YAML history (`plex:…` contentIds are valid neutral ids).
- Renaming vendor **adapters** (`PlexAdapter`, `FitnessSyncerHarvester`) — adapters are
  *supposed* to be vendor-named; only ports/neutral layers are in scope.
- Multi-source fitness library support (enabled by, but not part of, this plan).
