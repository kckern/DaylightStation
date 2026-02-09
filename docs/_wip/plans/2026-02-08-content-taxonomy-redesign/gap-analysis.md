# Content Taxonomy: As-Is to To-Be Gap Analysis

This document maps the current implementation against the target content model defined in the companion design docs (content-model.md, content-sources.md, content-playback.md, content-navigation.md, content-configuration.md). Each gap identifies what exists today with exact code references, what the target state is, and the specific remediation needed.

**Last validated against codebase:** 2026-02-08

---

## 1. Source Types → Drivers + Instances

### As-Is

The codebase has **13 distinct adapter classes**, each registered as a singleton source in `ContentSourceRegistry`. There is no concept of "driver" (reusable protocol) vs "source instance" (named config).

**Registered adapters** (in `bootstrap.mjs:createContentRegistry()`, lines 418-559):

| Adapter | Source ID | Category | File |
|---------|-----------|----------|------|
| `FileAdapter` | `media` | `media` | `1_adapters/content/media/files/FileAdapter.mjs` |
| `PlexAdapter` | `plex` | `media` | `1_adapters/content/media/plex/PlexAdapter.mjs` |
| `LocalContentAdapter` | `local` | `local` | `1_adapters/content/local-content/LocalContentAdapter.mjs` |
| `ListAdapter` | `list` | `list` | `1_adapters/content/list/ListAdapter.mjs` |
| `ImmichAdapter` | `immich` | `gallery` | `1_adapters/content/gallery/immich/ImmichAdapter.mjs` |
| `AudiobookshelfAdapter` | `audiobookshelf` | — | `1_adapters/content/readable/audiobookshelf/` |
| `FilesystemCanvasAdapter` | `canvas` | — | `1_adapters/content/canvas/filesystem/` |
| `ImmichCanvasAdapter` | `canvas-immich` | — | `1_adapters/content/canvas/immich/` |
| `SingalongAdapter` | `singalong` | `singalong` | `1_adapters/content/singalong/SingalongAdapter.mjs` |
| `ReadalongAdapter` | `readalong` | `readalong` | `1_adapters/content/readalong/ReadalongAdapter.mjs` |
| `SingingAdapter` | `singing` | — | Extends SingalongAdapter (alias) |
| `NarratedAdapter` | `narrated` | — | Extends ReadalongAdapter (alias) |
| `KomgaAdapter` | — | — | `1_adapters/content/readable/komga/` (exists, NOT registered) |

**`ContentSourceRegistry`** (`2_domains/content/services/ContentSourceRegistry.mjs`):
- Indexes by `source` name, `category`, and `provider`
- `resolve(compoundId)`: splits on first colon → tries exact source match → falls back to prefix map
- `resolveFromPrefix(prefix, value)`: looks up `#prefixMap`, applies optional `idTransform`
- `registerLegacyPrefixes(legacyMap)`: registers prefix aliases from `content-prefixes.yml`
- `resolveSource(sourceParam)`: priority: exact source → provider → category → all
- Legacy `adapters` Map exposed publicly for backward compat

**Key structural problems:**
1. SingalongAdapter and ReadalongAdapter are standalone classes with hardcoded path construction — they should be filesystem driver modes
2. LocalContentAdapter duplicates scripture/talk resolution that ReadalongAdapter also does
3. FilesystemCanvasAdapter and ImmichCanvasAdapter are separate adapters for what should be a `displayable` capability on existing sources
4. SingingAdapter/NarratedAdapter are trivial subclasses that exist only as source ID aliases
5. No multi-instance support — can't have two plex servers, two immich instances, etc.
6. Config is split across `adapters.yml` (connection details), `integrations.yml` (capability declarations), and hardcoded bootstrap paths

**Manifest system exists** but is limited:
- `AdapterRegistry` (`0_system/registries/AdapterRegistry.mjs`) discovers `manifest.mjs` files at startup
- 10 manifests found: list, plex, immich, audiobookshelf, media, files, narrated, readalong, singalong, singing
- Manifests declare `provider`, `capability`, `implicit`, `configSchema`
- Used by `IntegrationLoader` for conditional adapter instantiation
- But manifests don't define "driver" semantics — each manifest maps 1:1 to an adapter class

### To-Be

- **Drivers** are protocol-level adapters (plex, filesystem, immich, audiobookshelf, komga, yaml-config, query, app-registry)
- **Source instances** are named configurations that use a driver
- The filesystem driver serves multiple content formats based on `content_format` config
- Multiple instances per driver (plex-main, plex-kids)
- `default` and `default_for` instance designations
- Single unified `sources:` config block replaces `adapters.yml` + `integrations.yml` + hardcoded bootstrap paths

### Delta

| Current | Target | Change |
|---------|--------|--------|
| 13 adapter classes, 1 instance each | 8 driver classes, N instances each | Major refactor |
| SingalongAdapter (standalone class) | Filesystem driver with `content_format: singalong` | Merge into filesystem |
| ReadalongAdapter (standalone class) | Filesystem driver with `content_format: readalong` | Merge into filesystem |
| LocalContentAdapter | Eliminated (resolver plugin on filesystem driver) | Delete, migrate logic |
| SingingAdapter / NarratedAdapter | Eliminated (aliases in config) | Delete |
| FilesystemCanvasAdapter | Eliminated (filesystem instance + displayable) | Delete |
| ImmichCanvasAdapter | Eliminated (ImmichAdapter display action) | Delete |
| FileAdapter + MediaAdapter | Filesystem driver (generic mode, no content_format) | Rename/consolidate |
| `adapters.yml` + `integrations.yml` | Single `sources:` config | New config schema |
| Bootstrap hardcodes singalong/readalong paths | Driver reads paths from instance config | Config-driven |
| `ContentSourceRegistry` — flat map | Multi-instance with driver/format indexes | Extend |

### Remediation

- [ ] Design new `sources:` config schema (see content-configuration.md)
- [ ] Create filesystem driver that handles all modes (generic, singalong, readalong) based on `content_format`
- [ ] Move SingalongAdapter logic into filesystem driver singalong mode
- [ ] Move ReadalongAdapter logic into filesystem driver readalong mode
- [ ] Move scripture resolution from LocalContentAdapter into resolver plugin (see §13)
- [ ] Delete SingalongAdapter, ReadalongAdapter, SingingAdapter, NarratedAdapter, LocalContentAdapter
- [ ] Delete FilesystemCanvasAdapter, ImmichCanvasAdapter (replace with capabilities)
- [ ] Extend ContentSourceRegistry: multi-instance per driver, `default`/`default_for` resolution
- [ ] Rewrite bootstrap to read `sources:` config and instantiate driver instances
- [ ] Migrate `adapters.yml` + `integrations.yml` into unified `sources:` config

---

## 2. Content ID Resolution

### As-Is

Content ID resolution is scattered across 8+ locations with overlapping and inconsistent logic:

| Location | File | What It Does |
|----------|------|-------------|
| `ContentSourceRegistry.resolve()` | `2_domains/.../ContentSourceRegistry.mjs:186-205` | Split on colon → exact source match → prefix fallback → no-colon defaults to `media` |
| `ContentSourceRegistry.resolveFromPrefix()` | `ContentSourceRegistry.mjs:173-179` | Prefix map lookup with optional `idTransform` |
| `registerLegacyPrefixes()` | `ContentSourceRegistry.mjs:217-239` | Loads `content-prefixes.yml`: `hymn` → `singalong:hymn/{id}` |
| `parseActionRouteId()` | `4_api/v1/utils/actionRouteParser.mjs` | Parses `/source/path/segments` from Express route params |
| `SinglePlayer.jsx:96-101` | Frontend | Hardcoded: `hymn` → `singalong:hymn/`, `primary` → `singalong:primary/`, `scripture` → `readalong:scripture/` |
| `getCategoryFromId()` | `frontend/src/lib/queryParamResolver.js:60-64` | Regex: only matches `singalong:` or `readalong:` prefix |
| `legacyPrefixMap` | `frontend/src/lib/queryParamResolver.js:3-25` | Frontend copy: `hymn` → `singalong:hymn`, `scripture` → `readalong:scripture`, etc. |
| `normalizeListSource()` | `frontend/.../ListsItemRow.jsx:103` | Hardcoded: `list` → `menu` |
| `ADAPTER_TO_CATEGORY` | `frontend/.../ListsItemRow.jsx:24-36` | `hymn`/`primary` → `singalong`, `scripture` → `readalong` |
| `ContentQueryAliasResolver` | `3_applications/content/ContentQueryAliasResolver.mjs` | Search-level aliases: `music:` → plex music libs, `gallery:` → immich, etc. |
| `content-prefixes.yml` | `data/household/config/content-prefixes.yml` | `hymn: singalong:hymn`, `primary: singalong:primary`, `scripture: readalong:scripture`, `poem: readalong:poetry` |
| `content-query-aliases` | `data/household/apps/content/config.yml` | User-defined query aliases: `ab: { mapTo: audiobooks }`, library/tag mappings |

**Note:** `talk` is intentionally absent from `content-prefixes.yml` — it's handled by LocalContentAdapter directly because it has selection logic. This is one of the inconsistencies the redesign eliminates.

**Resolution priority today** (ContentSourceRegistry.resolve):
1. Split on first colon
2. Exact source name match (e.g., `plex`, `singalong`, `media`)
3. Prefix map fallback (includes legacy prefixes from content-prefixes.yml)
4. No-colon input defaults to `media` adapter

There is no driver/format matching, no multi-instance fallback, no system alias layer, no household alias layer.

### To-Be

A single `ContentIdResolver` service implementing the 5-layer chain:
1. Exact instance match
2. Driver/format type match (default priority, try-all-on-miss)
3. System alias (from alias config)
4. Prefix expansion (adapter tries known sub-paths)
5. Household alias (user-defined shortcuts)

All API routes, frontend code, and internal services use this resolver.

### Delta

| Current Layer | Target Layer | Gap |
|---------------|-------------|-----|
| Exact source match | 1. Exact instance match | Rename only |
| *(missing)* | 2. Driver/format type match | New — requires multi-instance registry |
| Legacy prefix map (content-prefixes.yml) | 3. System alias | Rename, expand scope |
| *(missing)* | 4. Prefix expansion | New — adapter tries sub-paths |
| *(missing)* | 5. Household alias | New — user-defined shortcuts |
| Frontend duplicates (SinglePlayer, queryParamResolver) | Eliminated — single resolver | Delete frontend resolution code |
| Search aliases (ContentQueryAliasResolver) | Folded into resolver layers 3+5 | Consolidate |

### Remediation

- [ ] Create `ContentIdResolver` service in the application layer
- [ ] Implement all 5 resolution layers
- [ ] Consolidate alias config: `content-prefixes.yml` + `content-query-aliases` → unified aliases config
- [ ] Replace `ContentSourceRegistry.resolve()` calls with `ContentIdResolver` calls
- [ ] Remove `getCategoryFromId()` from `queryParamResolver.js`
- [ ] Remove hardcoded aliases from `SinglePlayer.jsx:96-101`
- [ ] Remove `legacyPrefixMap` from `queryParamResolver.js`
- [ ] Remove `normalizeListSource()` and `ADAPTER_TO_CATEGORY` from `ListsItemRow.jsx`
- [ ] Update all API routers to use the resolver

---

## 3. Unified Play API

### As-Is

Content resolution uses **4 different API routers** with **6+ endpoint patterns**, each returning a different response shape:

| Content | Frontend Call | Backend Router | Endpoint |
|---------|-------------|---------------|----------|
| Plex video/audio | `fetchMediaInfo()` | `play.mjs` | `GET /api/v1/play/:source/*` |
| Plex metadata | `fetchMediaInfo()` | `info.mjs` | `GET /api/v1/info/:source/*` |
| Singalong (hymn, primary) | `SingalongScroller` fetch | `info.mjs` | `GET /api/v1/info/singalong/{path}` |
| Readalong (scripture) | `ReadalongScroller` fetch | `info.mjs` | `GET /api/v1/info/readalong/{path}` |
| Scripture (legacy) | `Scriptures` component | `localContent.mjs` | `GET /api/v1/local-content/scripture/*` |
| Talk (legacy) | `Talk` component | `localContent.mjs` | `GET /api/v1/local-content/talk/*` |
| Hymn (legacy) | `Hymns` component | `localContent.mjs` | `GET /api/v1/local-content/hymn/:id` |
| Poem (legacy) | `Poetry` component | `localContent.mjs` | `GET /api/v1/local-content/poem/:id` |
| Apps | Frontend-only | — | `appRegistry.js` lookup, no backend |

**`play.mjs`** (`4_api/v1/routers/play.mjs`):
- `GET /play/:source/*` — resolves via registry, calls `adapter.getItem()`, returns `toPlayResponse()` with `mediaUrl`, `mediaType`, `resumePosition`
- `POST /play/log` — logs progress
- `GET /play/plex/mpd/:id` — Plex DASH manifest
- Returns: `{ mediaUrl, mediaType, title, thumbnail, resumePosition, ... }` — no `format` field

**`info.mjs`** (`4_api/v1/routers/info.mjs`):
- `GET /info/:source/*` — resolves via registry + prefix map, calls `adapter.getItem()`, returns `transformToInfoResponse()` with capabilities
- SingalongScroller calls this as `/info/singalong/{collection}/{id}`
- ReadalongScroller calls this as `/info/readalong/{collection}/{path}`
- Returns: `{ source, mediaUrl, mediaType, category, content, style, ... }` — no `format` field

**`localContent.mjs`** (`4_api/v1/routers/localContent.mjs`):
- ~300 lines of scripture-specific resolution: `VOLUME_RANGES`, `getVolumeFromVerseId()`, `getScriptureBasePath()`, `resolveScriptureInput()`
- Uses `scripture-guide` package directly for reference parsing
- Each content type (scripture, talk, hymn, poem) has its own route handler returning a unique response shape

**No response includes a `format` field.** Adding a new content type requires: new adapter class, new API router or endpoint, new frontend component, new SinglePlayer routing branch.

### To-Be

Single `GET /api/v1/play/:source/*` endpoint for ALL formats. Response always includes a `format` field. The frontend calls one endpoint, dispatches to the renderer by format.

### Delta

| Current | Target | Change |
|---------|--------|--------|
| `play.mjs` handles plex/media only | Handles all formats | Extend play router |
| `info.mjs` used by singalong/readalong | Eliminated (merged into play) | Deprecate |
| `localContent.mjs` with per-type endpoints | Eliminated (resolver plugins) | Deprecate |
| No `format` field in responses | Always present | Add to all responses |
| `fetchMediaInfo()` for media, `DaylightAPI()` for local-content | Single `fetchPlayInfo()` | Rewrite frontend API |
| Each scroller fetches its own data | ContentResolver fetches, passes data down | Rewrite scrollers |

### Remediation

- [ ] Add `format` field to all play/info API responses (video, audio, dash_video, singalong, readalong, app, image)
- [ ] Extend play router to resolve singalong/readalong content IDs via filesystem driver
- [ ] Extend play router to resolve app content IDs via app-registry driver
- [ ] Move scripture resolution from `localContent.mjs` into resolver plugin (see §13)
- [ ] Create single frontend `fetchPlayInfo()` function replacing `fetchMediaInfo()` + `DaylightAPI()` calls
- [ ] Deprecate and eventually remove `localContent.mjs` endpoints
- [ ] Deprecate and eventually remove format-specific `info.mjs` usage by scrollers

---

## 4. Hardcoded Collection Knowledge

### As-Is

Collection-specific knowledge (hymn, scripture, primary, talk, poem) is hardcoded in these locations:

| Location | File:Line | Hardcoded Knowledge |
|----------|-----------|-------------------|
| Content ID construction | `SinglePlayer.jsx:96-101` | `hymn` → `singalong:hymn/`, `primary` → `singalong:primary/`, `scripture` → `readalong:scripture/` |
| Legacy prop routing | `SinglePlayer.jsx:122-127` | `scripture` → `<Scriptures/>`, `hymn` → `<Hymns/>`, `primary` → `<Hymns subfolder="primary"/>`, `talk` → `<Talk/>`, `poem` → `<Poetry/>` |
| Scroller exports | `ContentScroller.jsx:388-1021` | `Scriptures` (fetches `/local-content/scripture/`), `Hymns` (fetches `/local-content/hymn/`), `Talk` (fetches `/local-content/talk/`), `Poetry` (fetches `/local-content/poem/`) — each with its own API endpoint and parse logic |
| Renderer registry | `contentRenderers.jsx:6-49` | `scripture: { cssType, parseContent, extractTitle }`, `hymn: { cssType, wrapperClass }`, `primary: { cssType, wrapperClass }` — keyed by collection name |
| Category extraction | `queryParamResolver.js:60-64` | `getCategoryFromId()` — regex matches `singalong:` or `readalong:` only |
| Frontend prefix map | `queryParamResolver.js:3-25` | `legacyPrefixMap`: `hymn → singalong:hymn`, `primary → singalong:primary`, `scripture → readalong:scripture`, `talk → readalong:talks`, `poem → readalong:poetry` |
| Admin adapter map | `ListsItemRow.jsx:24-36` | `ADAPTER_TO_CATEGORY: { hymn: 'singalong', primary: 'singalong', scripture: 'readalong' }` |
| Backend prefix config | `content-prefixes.yml` | `hymn: singalong:hymn`, `primary: singalong:primary`, `scripture: readalong:scripture`, `poem: readalong:poetry` |
| Backend volume ranges | `localContent.mjs:11-17` | `VOLUME_RANGES` — OT/NT/BOM/DC/PGP verse ID ranges |

### To-Be

- Code knows about **drivers** and **content formats** — never collection names
- Legacy props removed from SinglePlayer — everything uses `contentId`
- Renderer routing based on `format` from Play API response, not content ID prefix
- Collection-to-source mapping lives entirely in alias config
- ContentScroller variants no longer do their own API calls — they receive resolved data
- `contentRenderers.jsx` keyed by manifest `renderer` name, not collection name

### Remediation

- [ ] Remove legacy props from SinglePlayer (hymn, primary, scripture, talk, poem, singalong, readalong)
- [ ] Remove all content ID construction logic from SinglePlayer (lines 96-101)
- [ ] Remove legacy component routing from SinglePlayer (lines 122-127)
- [ ] Refactor Scriptures, Hymns, Talk, Poetry exports to receive resolved data as props (no internal fetch)
- [ ] Rekey `contentRenderers.jsx` by manifest `renderer` name instead of collection name
- [ ] Remove `getCategoryFromId()` from queryParamResolver.js
- [ ] Remove `legacyPrefixMap` from queryParamResolver.js
- [ ] Remove `ADAPTER_TO_CATEGORY` from ListsItemRow.jsx
- [ ] Move `VOLUME_RANGES` from localContent.mjs into scripture resolver plugin
- [ ] Move `content-prefixes.yml` entries into unified alias config

---

## 5. SinglePlayer → ContentResolver

### As-Is

`SinglePlayer.jsx` (`frontend/src/modules/Player/components/SinglePlayer.jsx`, 442 lines) conflates three jobs:

1. **ID normalization** (lines 96-101) — converts legacy props to canonical contentId
2. **Category-based routing** (lines 114-127) — early returns for singalong/readalong/legacy
3. **Media resolution + type routing** (lines 129+) — calls `fetchMediaInfo()`, then routes by `mediaType` to VideoPlayer/AudioPlayer

**Execution flow:**
```
Props received (contentId, hymn, primary, scripture, talk, poem, plex, media, singalong, readalong)
  │
  ├─ Lines 96-101: Build contentId from legacy props if needed
  ├─ Line 102: getCategoryFromId(contentId) → 'singalong' | 'readalong' | null
  │
  ├─ Lines 115-116: category === 'singalong' → <SingalongScroller/> (EARLY RETURN, no fetchMediaInfo)
  ├─ Lines 118-119: category === 'readalong' → <ReadalongScroller/> (EARLY RETURN, no fetchMediaInfo)
  │
  ├─ Lines 123-127: Legacy fallback (EARLY RETURN for each):
  │   scripture → <Scriptures/>, hymn → <Hymns/>, primary → <Hymns subfolder/>,
  │   talk → <Talk/>, poem → <Poetry/>
  │
  └─ Lines 129+: fetchMediaInfo() → mediaInfo → route by mediaType:
      mediaType === 'audio' → <AudioPlayer/>
      mediaType === 'video' | 'dash_video' → <VideoPlayer/>
      fallback → JSON debug dump
```

**Singalong/readalong bypass the media resolution path entirely** — they're caught before `fetchMediaInfo()` runs. Each ContentScroller variant (Scriptures, Hymns, Talk, Poetry) then does its own separate API call to a format-specific endpoint.

### To-Be

`ContentResolver` (evolved from SinglePlayer) has two clean steps:
1. **Resolve:** Call unified Play API → get `{ format, ...data }`
2. **Dispatch:** Route to renderer by `format` field

ALL formats go through the same resolution path. No early returns for specific content types.

### Delta

| Current Step | Target Step | Change |
|-------------|-------------|--------|
| Build contentId from 10+ props | Receive `contentId` only | Remove all legacy props |
| getCategoryFromId() prefix check | *(eliminated)* | Format comes from API response |
| Early return for singalong/readalong | *(eliminated)* | All formats resolve through Play API |
| Early return for scripture/hymn/talk/poem | *(eliminated)* | Legacy components receive data, don't fetch |
| fetchMediaInfo() for plex/media only | `fetchPlayInfo()` for everything | Unified resolution |
| Route by `mediaType` (audio/video) | Route by `format` (video/audio/singalong/readalong/app/image) | Expand format vocabulary |

### Remediation

- [ ] Rename SinglePlayer → ContentResolver (or evolve in-place)
- [ ] Remove all legacy prop destructuring (hymn, primary, scripture, talk, poem, singalong, readalong)
- [ ] Replace `getCategoryFromId()` routing with format-based dispatch from API response
- [ ] Replace `fetchMediaInfo()` with unified `fetchPlayInfo()` that returns `{ format, ...data }`
- [ ] Add format-based dispatch: `switch(format)` → renderer component
- [ ] ContentScroller variants (Scriptures, Hymns, Talk, Poetry) receive data as props
- [ ] SingalongScroller/ReadalongScroller receive data as props (no internal fetch)

---

## 6. Playable Contract Formalization

### As-Is

The Playable Contract exists informally. All renderers already implement it, but it's not documented or enforced as a named interface:

| Renderer | Implements via | Contract Props Used |
|----------|---------------|-------------------|
| VideoPlayer | `useCommonMediaController` hook | advance, clear, shader, volume, playbackRate, seekToIntentSeconds, onPlaybackMetrics, onRegisterMediaAccess, onResolvedMeta |
| AudioPlayer | `useCommonMediaController` hook | Same as VideoPlayer |
| SingalongScroller | ContentScroller → `useMediaReporter` hook | advance, onPlaybackMetrics, onRegisterMediaAccess, onStartupSignal, seekToIntentSeconds, onSeekRequestConsumed |
| ReadalongScroller | ContentScroller → `useMediaReporter` hook | Same as SingalongScroller |

SinglePlayer passes these props through via `contentScrollerBridge` (lines 78-86) and spread `{...play}`, but there's no type definition or explicit contract.

### To-Be

- Named `PlayableContract` interface documented in content-model.md
- All renderers explicitly implement it
- New `PlayableAppShell` renderer for `app` format
- `play` vs `open` distinction formalized (PlayableAppShell vs AppContainer)

### Remediation

- [ ] Document the Playable Contract interface formally (done in content-model.md, content-playback.md)
- [ ] Create `PlayableAppShell` component for app format rendering (see §7)
- [ ] Verify all existing renderers conform to the documented contract
- [ ] Define `play` vs `open` behavior for apps in MenuStack routing
- [ ] Optionally: create a `usePlayableContract` hook or PropTypes shape for type enforcement

---

## 7. PlayableAppShell (New Component)

### As-Is

Apps are not queue participants. Current app patterns:

| Pattern | Mechanism | File | Limitation |
|---------|-----------|------|------------|
| `open` action in menu | Pushes `{ type: 'app' }` to MenuStack | TVApp.jsx | No queue, no lifecycle, ESC-only dismiss |
| `AppContainer` wrapper | Lazy-loads app component, passes param | `AppContainer.jsx` | No advance/clear/metrics |
| `open` prop on SinglePlayer | Fallback `goToApp` state when media fetch fails | `SinglePlayer.jsx:131` | Error fallback only, not intentional |
| VisualRenderer apps | CompositePlayer visual track (screensaver, clock) | Player composite mode | Visual-only, limited to overlay |

**App registry** (`frontend/src/lib/appRegistry.js`): 8 registered apps (webcam, gratitude, wrapup, office_off, keycode, family-selector, glympse, websocket). Each has `label`, optional `param` config. `AppContainer` lazy-loads the component.

**No backend resolution for apps** — `app:webcam` as a contentId would fail in `fetchMediaInfo()` because no backend adapter handles the `app` prefix.

### To-Be

- `app:*` content IDs resolve to `{ format: 'app', appId, appParam }` via Play API
- `PlayableAppShell` wraps apps with the Playable Contract (advance, clear, metrics)
- Apps call `advance()` when done, receive `pause()`/`resume()` from queue
- Apps can appear in mixed-format queues alongside video, audio, singalong, etc.

### Remediation

- [ ] Create `PlayableAppShell.jsx` in `frontend/src/modules/Player/components/`
- [ ] PlayableAppShell wraps app component + implements Playable Contract
- [ ] Add `app` format routing in ContentResolver dispatch
- [ ] Register `app-registry` as a driver in ContentSourceRegistry (backend)
- [ ] App-registry adapter's `getPlayInfo()` returns `{ format: 'app', appId, appParam }`
- [ ] Define how existing apps signal completion (call `advance()`)
- [ ] Test mixed-format queues (hymn → app → video → scripture)

---

## 8. Documentation Structure

### As-Is → To-Be Mapping

| Current File | Status | Absorbs Into |
|-------------|--------|-------------|
| `action-routes.md` | Active reference | content-navigation.md, content-playback.md |
| `config-lists-taxonomy.md` | Active reference | content-configuration.md |
| `content-adapters.md` | Active reference | content-sources.md |
| `content-query-aliases.md` | Active reference | content-model.md (resolution chain), content-configuration.md |
| `content-stack-reference.md` | Active reference | Split across all concept docs |
| `item-selection-service.md` | Active reference | content-progress.md |
| `list-adapter.md` | Active reference | content-sources.md |
| `local-media-adapter.md` | Active reference | content-sources.md |
| `media-progress.md` | Active reference | content-progress.md |
| `query-combinatorics.md` | Active reference | content-model.md, content-playback.md |
| `features/menu-skeleton-loader.md` | Active reference | Stays as feature reference |

### Remediation

- [ ] Finalize to-be docs (this design package) — done
- [ ] When code remediation is complete, replace `docs/reference/content/` with new docs
- [ ] Archive old docs in `docs/_archive/`

---

## 9. Filesystem Driver: Data/Media Path Split

### As-Is

Content YAML metadata and media files live on separate directory trees. The paths are constructed in `app.mjs` and passed to adapter constructors:

**Bootstrap path construction** (`backend/src/app.mjs`, lines ~353-406):
```javascript
// Singalong config
const singalongConfig = {
  dataPath: path.join(contentPath, 'singalong'),        // data/content/singalong/
  mediaPath: path.join(mediaBasePath, 'audio', 'singalong')  // media/audio/singalong/
};

// Readalong config
const readalongConfig = {
  dataPath: path.join(contentPath, 'readalong'),        // data/content/readalong/
  mediaPath: path.join(mediaBasePath, 'audio', 'readalong'), // media/audio/readalong/
  mediaPathMap: { video: path.join(mediaBasePath, 'video', 'readalong') }  // media/video/readalong/
};
```

**Actual directory layout on disk:**
```
data/content/
├── singalong/
│   ├── hymn/           401 .yml files (0001-the-morning-breaks.yml, ...)
│   └── primary/        239 .yml files (0002-i-am-a-child-of-god.yml, ...)
└── readalong/
    ├── scripture/      764 files across 5 volumes × multiple versions (.yml + .yaml)
    │   ├── manifest.yml
    │   ├── bom/sebom/*.yml
    │   ├── ot/kjvf/*.yaml, ot/LDS/*.yml
    │   ├── nt/kjvf/*.yml
    │   ├── dc/rex/*.yml
    │   └── pgp/lds/*.yml
    ├── talks/ldsgc/    71 .yaml files across 3 sessions
    │   ├── ldsgc202410/*.yaml
    │   ├── ldsgc202504/*.yaml
    │   └── ldsgc202510/*.yaml
    └── poetry/remedy/  75 .yaml files (01.yaml - 75.yaml)

media/
├── audio/
│   ├── singalong/hymn/     336 .mp3 files
│   ├── singalong/primary/  companion .mp3 files
│   ├── readalong/poetry/   poetry audio
│   ├── readalong/scripture/ scripture audio
│   └── ambient/            115 numbered .mp3 files (background music)
└── video/
    └── readalong/talks/    talk videos (mp4)
```

**Key observations from actual data:**
- Hymns: 401 YAML files but only 336 MP3s — not all have audio
- Scripture: Mixed extensions — OT kjvf uses `.yaml`, most others use `.yml`
- Talks: Use `.yaml` extension exclusively
- Poetry: Uses `.yaml` extension
- ReadalongAdapter has `mediaPathMap` for video vs audio media (talks have video, scripture has audio)
- SingalongAdapter gets audio duration from MP3 files via `music-metadata` at runtime

### To-Be

The filesystem driver config uses `data_path` + `media_path` for singalong/readalong instances. Generic filesystem instances (no `content_format`) use a single `path`. The driver matches YAML to media by filename stem.

### Remediation

- [ ] Filesystem driver accepts `data_path` + `media_path` config (replacing hardcoded bootstrap construction)
- [ ] Filesystem driver matches YAML→media by filename stem (ignoring extension)
- [ ] Duration extracted from audio file via `music-metadata` when not in YAML metadata (already works)
- [ ] Support both `.yml` and `.yaml` extensions (current content uses both)
- [ ] Support `media_path_map` for collections with mixed media types (video talks + audio scripture)
- [ ] Handle 401 hymn YAMLs with only 336 audio files (graceful missing-media handling)

---

## 10. Readable Capability (Audiobookshelf + Komga)

### As-Is

| Component | Status | File |
|-----------|--------|------|
| AudiobookshelfAdapter | Registered, working | `1_adapters/content/readable/audiobookshelf/` |
| KomgaAdapter | Code exists, **NOT registered** in bootstrap | `1_adapters/content/readable/komga/` |
| `Readable.mjs` domain entity | Exists with `paged` and `flow` types | `1_domains/content/entities/Readable.mjs` |
| Komga manifest | **Missing** (no `manifest.mjs` in komga/) | — |

Audiobookshelf produces both `PlayableItem` (audiobooks) and `ReadableItem` (ebooks). The info router's `deriveCapabilities()` (`info.mjs:27-63`) has a generic `readable` check (`item.contentUrl || item.format`) but this is a fallback heuristic, not a formal capability declaration.

No frontend reader components exist yet (no `PagedReader`, no `FlowReader`).

### To-Be

- `readable_paged` and `readable_flow` are first-class content formats
- `readable` is a documented capability alongside `playable`
- Komga adapter registered with manifest
- Frontend: `PagedReader` and `FlowReader` renderers in ContentResolver dispatch
- `GET /api/v1/read/:source/*` route for readable content

### Remediation

- [ ] Create Komga manifest (`manifest.mjs`) and register in bootstrap
- [ ] Add `readable_paged` and `readable_flow` to content format table
- [ ] Create frontend `PagedReader` component (fixed-page navigation)
- [ ] Create frontend `FlowReader` component (CFI-based EPUB reader)
- [ ] Add `GET /api/v1/read/:source/*` route
- [ ] Add `readable` format dispatch in ContentResolver

---

## 11. Non-Driver Content: canvas, freshvideo, media/files

### As-Is

| Prefix | Current Mechanism | Adapter | Registered? |
|--------|------------------|---------|-------------|
| `canvas:` | `FilesystemCanvasAdapter` | Dedicated adapter with EXIF extraction, image browsing | Yes (bootstrap:509-519) |
| `canvas-immich:` | `ImmichCanvasAdapter` | Dedicated adapter wrapping ImmichClient | Yes (bootstrap:522-532) |
| `freshvideo:` | `FreshVideoService` (cron) downloads → `/media/video/news/{provider}/` | No dedicated adapter — files on disk | Not directly registered |
| `media:` | `FileAdapter` | General filesystem browser | Yes (bootstrap:424-434) |
| `files:` | `FileAdapter` (via manifest) | Same as `media:` | Yes via manifest |

**FilesystemCanvasAdapter** (`1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs`):
- Scans directories of images (.jpg, .jpeg, .png, .webp, .gif)
- Extracts EXIF metadata (artist, year, tags)
- Returns `DisplayableItem` objects
- Has `list()`, `getItem()`, `getList()`, `resolveDisplayables()` methods
- Proxy path: `/api/v1/canvas/image`

**ImmichCanvasAdapter**: Wraps ImmichClient to serve immich album images as canvas art.

**FreshVideoService**: Application-layer cron job using yt-dlp. Downloads to `/media/video/news/{provider}/YYYYMMDD.mp4`. 13 news sources currently configured (kidnuz, cnn, bbc, teded, vox, etc.).

**365Daily content**: 39+ devotional audio series in `/media/audio/365Daily/` — not exposed as a source instance today, but could be filesystem instances.

### To-Be

- `canvas:` becomes an alias to a filesystem image source instance
- `freshvideo:teded` resolves via alias to a filesystem instance at `/media/video/news/teded`
- `media:`/`files:` are aliases to a generic filesystem instance
- ImmichCanvasAdapter folded into ImmichAdapter (display action on any immich source)

### Remediation

- [ ] Remove `FilesystemCanvasAdapter` — replace with filesystem instance(s) + `displayable` capability
- [ ] Migrate EXIF extraction into filesystem driver (retain functionality)
- [ ] Fold ImmichCanvasAdapter into ImmichAdapter (immich already has displayable items)
- [ ] Add freshvideo feed paths as filesystem source instances with aliases
- [ ] Add 365Daily devotional series as filesystem source instances
- [ ] Configure `canvas`, `media`, `files` as system aliases in alias config

---

## 12. List Config Format Migration

### As-Is

**Current config format** (23+ YAML files across menus/, programs/, watchlists/):

**Menus** (`data/household/config/lists/menus/*.yml`):
```yaml
title: Fhe
items:
  - label: Opening Hymn               # plan uses: title
    input: singalong:hymn/166         # plan uses: play: { contentId: hymn:166 }
    fixed_order: true
    image: https://...
    uid: e7302007-...
  - label: Spotlight
    input: app:family-selector/alan   # app with param
    action: Open                      # plan uses: action-as-key (open: family-selector)
  - label: Gratitude and Hope
    input: 'app: gratitude'           # SPACE after colon (YAML quirk)
    action: Open
  - label: Felix
    input: plex:457385
    action: Play
    active: true
  - label: Soren
    input: canvas:religious/treeoflife.jpg
    action: Display
```

**Programs** (`data/household/config/lists/programs/*.yml`):
```yaml
- label: Intro
  input: 'media: sfx/intro'           # space after colon
- label: 10 Min News
  input: 'query: dailynews'           # space after colon
- label: Come Follow Me Supplement
  input: 'watchlist: comefollowme2025' # space after colon
- label: Ted Ed
  input: 'freshvideo: teded'          # space after colon
- label: General Conference
  input: 'talk: ldsgc'               # space after colon
- label: Wrap Up
  input: 'app: wrapup'               # space after colon
  action: Open
```

**Watchlists** (`data/household/config/lists/watchlists/*.yml`):
```yaml
- title: D&C 1
  src: scriptures                     # source adapter name
  media_key: dc/rex/37707            # content path within source
  program: Rex Pinnegar              # grouping label
  priority: High
  uid: 250bd26f-...
  wait_until: '2025-01-12'
  skip_after: '2025-01-26'
  watched: true
  progress: 100
```

**Queries** (`data/household/config/lists/queries/dailynews.yml`):
```yaml
type: freshvideo
sources:
  - news/world_az
  - news/cnn
```

**Key issues:**
- Space-after-colon in YAML values (`'app: gratitude'` parses as `"app: gratitude"`)
- Inconsistent field names: menus use `label`/`input`, watchlists use `title`/`src`/`media_key`
- `action` as separate field vs plan's action-as-key (`play:`, `open:`, `list:`, `display:`)
- Additional fields not addressed in plan: `uid`, `image`, `active`, `playbackrate`, `shuffle`

### To-Be

Support both formats via normalization in the yaml-config driver, with a migration tool to convert old→new:

```yaml
# To-be format
title: FHE Night
items:
  - title: Opening Hymn
    play: { contentId: hymn:198 }
    fixed_order: true
  - title: Family Activity
    open: family-selector
  - title: Art Display
    display: { contentId: canvas:religious/treeoflife.jpg }
```

### Remediation

- [ ] yaml-config driver normalizes both `input`/`label` and `contentId`/`title`/action-as-key schemas
- [ ] Handle space-after-colon in content IDs (`.trim()` after split on colon)
- [ ] Preserve additional fields during normalization: `uid`, `image`, `active`, `fixed_order`, `playbackrate`, `shuffle`
- [ ] Normalize watchlist format: `src`/`media_key` → `contentId`
- [ ] Create migration tool to convert old format → new format
- [ ] Migrate configs once new format is stable

---

## 13. Resolver & Renderer Plugin System

### As-Is

Scripture is the only collection with complex ID resolution, and that logic is **duplicated**:

**Backend duplication:**

| Location | Lines | What It Does |
|----------|-------|-------------|
| `localContent.mjs` | ~300 lines total | `VOLUME_RANGES`, `getVolumeFromVerseId()`, `getScriptureBasePath()`, `resolveScriptureInput()` — full scripture resolution in the API layer |
| `ReadalongAdapter` + `resolvers/scripture.mjs` | Adapter layer | Scripture resolution logic (also exists here, partially duplicated) |

`localContent.mjs` directly imports `scripture-guide` (`lookupReference`, `generateReference`) and implements:
- Bare verse ID → volume lookup via `VOLUME_RANGES`
- Reference string → verse ID via `scripture-guide.lookupReference()`
- Volume name → next unread (via watch history)
- Version defaults from `manifest.yml`
- Multiple path candidates for finding scripture base directory

**Frontend:**
- `contentRenderers.jsx` (lines 6-49): `scripture` renderer keyed by collection name, with custom `parseContent` (verse formatting with headings, poetry/prose detection) and `extractTitle` (via `scripture-guide.generateReference()`)
- `hymn` and `primary` renderers also keyed by collection name

**Scripture manifest exists** (`data/content/readalong/scripture/manifest.yml`):
```yaml
resolver: scripture
containerType: watchlist
contentType: verses
ambient: true
style: { fontFamily: serif, fontSize: 1.3rem, textAlign: left }
defaults:
  ot: { text: kjvf, audio: kjvf }
  nt: { text: kjvf, audio: kjvf }
  bom: { text: sebom, audio: sebom }
  dc: { text: rex, audio: rex }
  pgp: { text: lds, audio: lds }
volumeTitles: { ot: Old Testament, nt: New Testament, bom: Book of Mormon, dc: Doctrine and Covenants, pgp: Pearl of Great Price }
```

The manifest already declares `resolver: scripture` but the filesystem driver doesn't read it — the resolver is invoked directly by the ReadalongAdapter, and `localContent.mjs` duplicates the logic.

### To-Be

Two generic plugin interfaces — **resolver** (backend) and **renderer** (frontend) — declared in `manifest.yml`. The filesystem driver reads the manifest and delegates to the named resolver. The Play API response includes a `renderer` field. The frontend dispatches by renderer name.

### Delta

| Current | Target | Change |
|---------|--------|--------|
| Scripture resolution in localContent.mjs (API layer) | Resolver plugin in filesystem driver | Move + deduplicate |
| Scripture resolution in ReadalongAdapter (adapter layer) | Same resolver plugin (single copy) | Consolidate |
| contentRenderers keyed by collection name | Keyed by manifest `renderer` name | Rekey |
| Manifest exists but driver doesn't read it | Driver reads manifest at startup, uses resolver/renderer fields | Wire up |
| No `renderer` field in API responses | Play API includes `renderer` from manifest | Add field |

### Remediation

- [ ] Consolidate scripture resolution into single resolver at `resolvers/scripture.mjs`
- [ ] Filesystem driver reads `manifest.yml` at startup for each collection
- [ ] Filesystem driver delegates to named resolver when `manifest.resolver` is set
- [ ] Resolver receives manifest config (defaults, volume ranges) as constructor args
- [ ] Play API response includes `renderer` field from manifest
- [ ] Frontend contentRenderers registry keyed by manifest `renderer` name, not collection name
- [ ] `localContent.mjs` scripture endpoints deprecated once Play API handles resolver-based resolution
- [ ] Delete duplicated resolution code from `localContent.mjs`

---

## 14. Query Driver: Saved Searches as Dynamic Containers

### As-Is

The runtime query infrastructure is production-ready:

| Component | Status | File |
|-----------|--------|------|
| `ContentQueryService` | Complete | `3_applications/content/ContentQueryService.mjs` |
| `ContentQueryAliasResolver` | Complete — 3-layer alias resolution | `3_applications/content/ContentQueryAliasResolver.mjs` |
| `ContentQueryGatekeepers` | Complete — filter functions | `3_applications/content/ContentQueryGatekeepers.mjs` |
| `contentQueryParser` | Complete — canonical filters | `3_applications/content/contentQueryParser.mjs` |
| Search API (SSE stream) | Complete | `GET /api/v1/content/query/search` + `/stream` |
| Immich adapter search | Complete — people, CLIP, dates, etc. | ImmichAdapter |
| `content-query-aliases` config | Complete — library/tag/user aliases | `household/apps/content/config.yml` |

**Queries directory exists but is minimal:**
- `data/household/config/lists/queries/dailynews.yml` — only file, simple format:
  ```yaml
  type: freshvideo
  sources: [news/world_az, news/cnn]
  ```
- ListAdapter already registers `query` as a prefix (`prefixes: [{prefix: 'list'}, {prefix: 'watchlist'}, {prefix: 'menu'}, {prefix: 'program'}, {prefix: 'query'}]`)
- But `query:` resolution is minimal — it reads the YAML but doesn't delegate to ContentQueryService

**Missing pieces:**
- No `SavedQueryService` with filter-based YAML persistence
- `query:` prefix is handled by ListAdapter, not a dedicated query driver
- No CRUD API routes for saved queries
- No "save as query" in ContentSearchCombobox
- No cross-source query execution from saved definitions
- `dailynews.yml` uses a legacy format (`type: freshvideo, sources: [...]`), not the to-be filter schema

### To-Be

- `query` is its own driver (not a sub-feature of ListAdapter)
- Saved query definitions use a filter schema: `{ title, source?, filters: { text?, person?, time?, tags?, ... }, sort, take }`
- `query:family-photos-2025` resolves to the query driver → reads definition → delegates to `ContentQueryService`
- Results are dynamic containers: `listable` + `queueable`
- ContentSearchCombobox gains "save as query" and "browse saved queries"

### Remediation

- [ ] Create `SavedQueryService` with YAML read/write for query definitions
- [ ] Create query driver (separate from ListAdapter)
- [ ] Register query driver in ContentSourceRegistry at bootstrap
- [ ] Implement `getList()` that reads definition YAML and delegates to ContentQueryService
- [ ] Implement `resolvePlayables()` that flattens query results to playable leaves
- [ ] Add CRUD API routes: `GET/POST/DELETE /api/v1/queries`
- [ ] Support relative date filters (`30d..`, `7d..`, `90d..`)
- [ ] Migrate `dailynews.yml` to new filter schema
- [ ] yaml-config driver recognizes `query:` references in list items and delegates to query driver
- [ ] ContentSearchCombobox: "save current search as query" action
- [ ] ContentSearchCombobox: browse saved queries as containers

---

## Content Inventory (Actual Data)

For implementation planning, here's what actually exists on disk:

| Collection | Type | File Count | Extension | Audio/Video Files | Notes |
|-----------|------|------------|-----------|-------------------|-------|
| Hymns | singalong | 401 | `.yml` | 336 MP3s | Not all hymns have audio |
| Primary Songs | singalong | 239 | `.yml` | Paired MP3s | Children's songs |
| Scripture | readalong | 764 | `.yml` + `.yaml` | Some audio | 5 volumes × multiple versions |
| Talks | readalong | 71 | `.yaml` | Video + embedded URLs | 3 conference sessions |
| Poetry | readalong | 75 | `.yaml` | Audio available | Single collection (remedy/) |
| Ambient | internal asset | 115 | `.mp3` | — | Background music for readalong |
| News (freshvideo) | filesystem | varies daily | `.mp4` | — | 13 feed sources |
| 365Daily Devotionals | filesystem | 39+ series | `.mp3` | — | Daily audio content |
| Art (canvas) | filesystem/images | varies | `.jpg/.png/.webp` | — | Classic + religious art |

**Config lists:** menus/ (8+ files), programs/ (4+ files), watchlists/ (4+ files), queries/ (1 file)

---

## Remediation Phases

### Phase 1: Foundation (Backend Infrastructure)
1. **ContentIdResolver** service with 5-layer resolution chain
2. **Source instance config schema** — unified `sources:` block with driver + instance model
3. **ContentSourceRegistry** extension — multi-instance, `default`/`default_for`, driver/format indexes
4. **Alias configuration** — system aliases + household aliases (replaces content-prefixes.yml)
5. **Filesystem driver** — handles generic/singalong/readalong modes based on `content_format` config
6. **Resolver plugin system** — manifest-declared, scripture resolver deduplicated

### Phase 2: Unified Play API (Backend + Frontend Bridge)
7. Add `format` field to all play/info API responses
8. Extend play router to handle singalong/readalong/app resolution
9. Scripture resolver runs through filesystem driver (localContent.mjs deprecated)
10. Frontend: single `fetchPlayInfo()` replaces `fetchMediaInfo()` + `DaylightAPI()` calls

### Phase 3: Decouple Format from Source (Frontend)
11. **ContentResolver** replaces SinglePlayer (format-based dispatch)
12. ContentScroller variants receive data as props instead of fetching internally
13. Remove hardcoded collection knowledge (legacy props, getCategoryFromId, contentRenderers rekey)
14. Canvas adapters removed; `canvas:` becomes filesystem alias + displayable capability

### Phase 4: PlayableAppShell + Readable (New Capabilities)
15. PlayableAppShell component + Playable Contract implementation
16. App-registry driver registered in backend
17. Mixed-format queue support (hymn → app → video → scripture)
18. `play` vs `open` distinction formalized
19. Komga manifest + bootstrap registration
20. PagedReader and FlowReader frontend renderers
21. `GET /api/v1/read/:source/*` route

### Phase 5: List Config Migration
22. yaml-config driver normalizes both old and new list schemas
23. Migration tool for old→new config format
24. Migrate existing list configs (23+ files)

### Phase 6: Query Driver (Smart Playlists)
25. SavedQueryService with YAML persistence
26. Query driver registered in ContentSourceRegistry (separate from ListAdapter)
27. CRUD API routes for saved queries
28. yaml-config recognizes `query:` references in list items
29. ContentSearchCombobox: save search as query + browse saved queries

### Phase 7: Documentation
30. Finalize to-be docs with implementation-specific details
31. Replace `docs/reference/content/` with new docs
32. Archive old docs in `docs/_archive/`

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| 1 | Breaking existing content resolution | Run old + new resolver in parallel; validate outputs match |
| 2 | Breaking existing API consumers | Version API or add `format` field additively before changing routes |
| 3 | Breaking frontend playback | Feature-flag ContentResolver vs SinglePlayer; roll back per-format |
| 5 | Config migration errors | Migration tool validates round-trip; keep backup of original configs |
| All | Talk handled specially (not in content-prefixes.yml) | Ensure talk resolution works through new resolver before deleting LocalContentAdapter |
| All | Mixed .yml/.yaml extensions | Filesystem driver must glob for both extensions in every file lookup |
