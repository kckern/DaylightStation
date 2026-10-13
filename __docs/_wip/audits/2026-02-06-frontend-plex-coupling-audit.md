# Frontend Plex Coupling Audit

**Date:** 2026-02-06
**Scope:** All `.js`, `.jsx`, `.mjs` files in `frontend/src/`
**Goal:** Identify all places the frontend assumes content comes from Plex, to plan migration to source-agnostic `contentId` pattern.

**Canonical pattern:** `contentId` is a compound ID string (`plex:12345`, `immich:abc-123`, `folder:watchlist/FHE`, or bare `12345`). The backend resolves the source. The frontend should not need to know or care.

---

## Executive Summary

| Category | Count | Severity |
|----------|-------|----------|
| Hardcoded `/plex/` API routes | 30+ calls in 13 files | HIGH |
| Default fallback to `'plex'` | 3 locations | HIGH |
| Numeric ID → plex heuristic | 4 locations | HIGH |
| Plex-specific config keys (`root.plex.*`) | 8+ locations | MEDIUM |
| Plex-specific type literals (`plex_collection`) | 6 locations | MEDIUM |
| `DaylightPlexPath()` helper | 1 definition, callers | MEDIUM |
| Plex-named components/hooks | 2 modules | LOW (naming) |
| Plex in comments/JSDoc only | ~10 | LOW |

---

## Category 1: Hardcoded `/plex/` API Routes (HIGH)

These calls bake `plex` as a URL path segment. If content came from Jellyfin, Emby, or any other source, these would need to change.

### 1A. Action Routes (`/list/plex/`, `/info/plex/`)

| File | Line | Call | Purpose |
|------|------|------|---------|
| `Player/lib/api.js` | 24 | `api/v1/list/plex/${item.queue.plex}/${modifiers}` | Flatten queue — plex nested items |
| `Player/lib/api.js` | 75 | `api/v1/list/plex/${plex}/playable,shuffle` | Shuffle via list router |
| `Player/lib/api.js` | 81 | `api/v1/info/plex/${firstPlex}` | Info for first shuffled item |
| `Player/lib/api.js` | 88 | `api/v1/info/plex/${plex}` | Info for non-shuffle plex item |
| `Player/components/SinglePlayer.jsx` | 253 | `/api/v1/list/plex/${plex}/playable` | Collection expansion |
| `Player/hooks/useQueueController.js` | 101 | `api/v1/item/plex/${plexId}/playable` | Queue controller playable fetch |
| `Menu/hooks/useFetchPlexData.js` | 29 | `/api/v1/info/plex/${plexId}` | Menu type detection |
| `Menu/PlexMenuRouter.jsx` | 109 | `api/v1/info/plex/${plexId}` | Route to ShowView/SeasonView |
| `Fitness/FitnessMenu.jsx` | 202 | `/api/v1/list/plex/${collectionId}` | Load collection shows |

**Pattern:** All these call `api/v1/{action}/plex/{id}`. The fix is to use compound IDs: `api/v1/{action}/${contentId}` where `contentId` is already `plex:12345`.

### 1B. Display Routes (`/display/plex/`)

| File | Line(s) | Purpose |
|------|---------|---------|
| `Fitness/FitnessShow.jsx` | 35, 108, 112, 553, 564, 967, 969 | Season/episode thumbnails |
| `Fitness/FitnessSidebar/FitnessMusicPlayer.jsx` | 456 | Album artwork |
| `Menu/Menu.jsx` | 705 | Menu item images |
| `Apps/FitnessApp.jsx` | 645, 663 | Episode thumbnail fallbacks |

**Pattern:** All build `DaylightMediaPath(`api/v1/display/plex/${id}`)`. Fix: use `api/v1/display/${contentId}` where backend resolves source.

### 1C. Proxy Routes (`/proxy/plex/`)

| File | Line(s) | Call | Purpose |
|------|---------|------|---------|
| `Fitness/FitnessShow.jsx` | 538, 947 | `/api/v1/proxy/plex/stream/${plexId}` | Video streaming URL |
| `Fitness/FitnessPlayer.jsx` | 47 | `/api/v1/proxy/plex/photo/:/transcode?...` | Seek thumbnail (library/parts) |
| `Fitness/FitnessPlayer.jsx` | 52 | `/api/v1/proxy/plex/photo/:/transcode?...` | Seek thumbnail (library/metadata) |

**Note:** Proxy routes are inherently source-specific (they proxy to the actual Plex server). These may need a different abstraction — a backend proxy resolver that accepts a generic contentId and returns the correct proxy URL.

### 1D. Play Routes

| File | Line(s) | Call | Purpose |
|------|---------|------|---------|
| `Player/components/DebugInfo.jsx` | 34 | `/api/v1/play/plex/${plexId}` | Debug URL check |
| `lib/api.mjs` | 137 | `media/plex/url/` → `api/v1/play/plex/` | Legacy rewrite |

### 1E. Legacy Path Rewrites (`lib/api.mjs`)

| Line | Rewrite | Current Target |
|------|---------|----------------|
| 132-133 | `media/plex/img/*` | `api/v1/display/plex/*` |
| 136-137 | `media/plex/url/*` | `api/v1/play/plex/*` |
| 144 | Guard: `!path.startsWith('media/plex/')` | Prevents double-rewrite |
| 163-164 | `DaylightPlexPath(key)` | `{base}/media/plex/${key}` |

---

## Category 2: Default Fallback to `'plex'` (HIGH)

These locations assume plex when no explicit source is configured.

| File | Line | Code | Context |
|------|------|------|---------|
| `Apps/FitnessApp.jsx` | 617 | `return root?.content_source \|\| 'plex'` | FitnessApp content source default |
| `context/FitnessContext.jsx` | 380 | `const contentSource = root?.content_source \|\| 'plex'` | FitnessContext content source default |
| `Apps/TVApp.jsx` | 143 | `? { source: 'plex', id: value }` | Numeric IDs auto-resolve to plex |

**Fix:** The backend already has heuristic resolution (digits → plex). The frontend should pass the raw ID and let the backend resolve, OR the config should always specify `content_source`.

---

## Category 3: Numeric ID → Plex Heuristic (HIGH)

Multiple files detect numeric IDs and assume they're Plex rating keys:

| File | Line | Code |
|------|------|------|
| `Apps/TVApp.jsx` | 142-143 | `/^\d+$/.test(value) ? { source: 'plex', id: value }` |
| `lib/Player/useMediaKeyboardHandler.js` | 139 | `(meta.plex \|\| /^\d+$/.test(String(assetId))) ? 'plex' : type` |
| `Fitness/FitnessPlayer.jsx` | 827 | `(currentItem.plex \|\| /^\d+$/.test(String(mediaKey))) ? 'plex' : ...` |
| `Player/components/AudioPlayer.jsx` | 64 | `['track'].includes(type) ? 'plex' : 'media'` |

**Fix:** This heuristic belongs in the backend (which already has it). Frontend should pass the bare ID and let the backend resolve the source.

---

## Category 4: Plex-Specific Config Keys (MEDIUM)

The fitness config YAML has a `plex:` section. Frontend reads it by name:

| File | Line | Code |
|------|------|------|
| `context/FitnessContext.jsx` | 365 | `root?.plex \|\| {}` — extracts plex config |
| `context/FitnessContext.jsx` | 385-386 | `contentConfig: plex` / `plexConfig: plex` |
| `context/FitnessContext.jsx` | 387 | `plex?.music_playlists` |
| `context/FitnessContext.jsx` | 370-376 | `plex?.governed_labels`, `plex?.governed_types`, `plex?.nomusic_labels` |
| `Fitness/FitnessMenu.jsx` | 37 | `fitnessConfig.plex?.nav_items` |
| `Fitness/FitnessMenu.jsx` | 56 | `fitnessConfig?.plex?.app_menus` |
| `Apps/FitnessApp.jsx` | 623 | `root?.plex \|\| root?.[contentSource] \|\| {}` |
| `Apps/FitnessApp.jsx` | 802 | `response?.fitness?.plex?.nav_items` |

**Fix:** Rename YAML key from `plex:` to `content:` (or use `contentSource` to index into config dynamically).

---

## Category 5: Plex-Specific Type Literals (MEDIUM)

| File | Line(s) | Literals |
|------|---------|----------|
| `Apps/FitnessApp.jsx` | 680, 688 | `'plex_collection'`, `'plex_collection_group'` |
| `Fitness/FitnessMenu.jsx` | 41, 43, 45 | `'plex_collection'`, `'plex_collection_group'` |
| `Menu/PlexMenuRouter.jsx` | 146, 159 | `type === 'show'`, `type === 'season'` (Plex vocabulary) |
| `Player/hooks/useCommonMediaController.js` | 294 | `meta.source === 'plex'` (assumes only plex uses DASH) |

**Note on type vocabulary:** `show`, `season`, `episode` are Plex-specific type names. Jellyfin uses `Series`, `Season`, `Episode`. The backend should normalize these to a common vocabulary.

---

## Category 6: Menu Stack Plex Routing (MEDIUM)

`MenuStack.jsx` routes menu selections based on `selection.list?.plex`:

| File | Line(s) | Code |
|------|---------|------|
| `Menu/MenuStack.jsx` | ~42-54 | `if (selection.list?.plex && selection.type === 'show')` → push ShowView |
| | | `if (selection.list?.plex && selection.type === 'season')` → push SeasonView |
| | | `if (selection.list?.plex && !selection.type)` → push PlexMenuRouter |

`ShowView.jsx` and `SeasonView.jsx` extract Plex IDs from action objects:

| File | Line(s) | Code |
|------|---------|------|
| `Menu/ShowView.jsx` | ~103, 109 | `season?.list?.plex`, builds `{ list: { plex: plexId } }` |
| `Menu/SeasonView.jsx` | ~105, 111 | `episode?.play?.plex`, builds `{ play: { plex: plexId } }` |

**Fix:** These should check `selection.list` generically and use compound IDs. The backend list router already resolves any source.

## Category 6b: FitnessContext Helper Functions (MEDIUM)

| File | Line(s) | Code |
|------|---------|------|
| `context/FitnessContext.jsx` | 38-45 | `getPlexIdFromActions(item)` → `item?.play?.plex \|\| item?.queue?.plex \|\| item?.list?.plex` |
| `context/FitnessContext.jsx` | 54-58 | `getItemIdentifier(item)` → uses `getPlexIdFromActions()`, `item?.plex`, `item?.ratingKey` |

**Fix:** These should extract a generic `contentId` from action objects, not assume plex.

## Category 6c: OfficeApp Plex Heuristic (LOW)

| File | Line(s) | Code |
|------|---------|------|
| `lib/OfficeApp/keyboardHandler.js` | 79, 81 | `/^\d+$/.test(p) → ["plex", p]` — numeric ID → plex |
| `lib/OfficeApp/websocketHandler.js` | 134, 147-149 | `data.plex` used as metadata field |

## Category 7: Plex-Named Modules (LOW — Naming Debt)

| File | Current Name | Suggested Name |
|------|-------------|----------------|
| `Menu/PlexMenuRouter.jsx` | `PlexMenuRouter` | `ContentMenuRouter` |
| `Menu/hooks/useFetchPlexData.js` | `useFetchPlexData` | `useFetchContentData` |
| `Menu/PlexViews.scss` | (stylesheet) | `ContentViews.scss` |
| `lib/api.mjs` | `DaylightPlexPath` | Remove entirely |

---

## Category 7: `plex` Prop Threading (HIGH — Structural)

The `plex` prop flows through the Player component tree:

```
Player.jsx
  → SinglePlayer.jsx (accepts { plex } prop)
    → fetchMediaInfo({ plex }) in api.js
      → builds /info/plex/${plex} or /list/plex/${plex}
```

The entire Player prop interface uses `plex` as a first-class prop alongside `media`. The canonical pattern should be a single `contentId` prop that replaces both.

**Current prop flow:**
```js
// Queue items have: { play: { plex: "12345" } }
// or:              { play: { media: "immich:abc" } }
// SinglePlayer extracts: const { plex, media } = play;
// api.js branches: if (plex) { ... } else if (media) { ... }
```

**Target prop flow:**
```js
// Queue items have: { play: { contentId: "plex:12345" } }
// or:              { play: { contentId: "immich:abc" } }
// SinglePlayer extracts: const { contentId } = play;
// api.js: const url = `api/v1/info/${contentId}`;
```

---

## Affected Files Summary

| File | Coupling Count | Categories |
|------|---------------|------------|
| `Player/lib/api.js` | 5 routes | 1A, 7 |
| `Fitness/FitnessShow.jsx` | 9 routes | 1B, 1C |
| `context/FitnessContext.jsx` | 6 config refs | 2, 4 |
| `Apps/FitnessApp.jsx` | 5 refs | 1B, 2, 4, 5 |
| `Fitness/FitnessMenu.jsx` | 4 refs | 1A, 4, 5 |
| `Player/components/SinglePlayer.jsx` | 2 routes | 1A, 7 |
| `Menu/PlexMenuRouter.jsx` | 2 refs | 1A, 5, 6 |
| `Menu/Menu.jsx` | 1 route | 1B |
| `Menu/hooks/useFetchPlexData.js` | 1 route | 1A, 6 |
| `Fitness/FitnessPlayer.jsx` | 3 routes | 1C, 3 |
| `Fitness/FitnessSidebar/FitnessMusicPlayer.jsx` | 1 route | 1B |
| `Player/hooks/useQueueController.js` | 1 route | 1A |
| `Player/hooks/useCommonMediaController.js` | 1 check | 5 |
| `Player/components/DebugInfo.jsx` | 2 routes | 1D |
| `Player/components/AudioPlayer.jsx` | 1 check | 3 |
| `lib/Player/useMediaKeyboardHandler.js` | 1 check | 3 |
| `lib/api.mjs` | 5 refs | 1E, 6 |
| `lib/OfficeApp/keyboardHandler.js` | 1 check | 3 |
| `lib/OfficeApp/websocketHandler.js` | 2 refs | 7 |
| `Apps/TVApp.jsx` | 2 refs | 2, 3 |
| `Menu/MenuStack.jsx` | 3 checks | 5 |
| `Menu/ShowView.jsx` | 2 refs | 7 |
| `Menu/SeasonView.jsx` | 2 refs | 7 |
| `Admin/ContentLists/ListsItemRow.jsx` | 2 refs | Plex color/examples |
| `Admin/ContentLists/ContentSearchCombobox.jsx` | 1 ref | Plex emoji icon |

---

## Architecture Note: What the Backend Already Handles

The backend action routes (`/info/`, `/list/`, `/play/`, `/display/`) already support **source-agnostic compound IDs**:

```
/api/v1/info/plex:12345     → resolved by actionRouteParser
/api/v1/info/12345           → heuristic: digits → plex
/api/v1/info/immich:abc-123  → resolved to immich adapter
/api/v1/display/plex:12345   → works
/api/v1/list/plex:12345      → works
```

So `/api/v1/info/plex/12345` and `/api/v1/info/plex:12345` are equivalent. The frontend just needs to stop splitting source from ID and instead pass the compound ID as a single path segment.

---

## Remediation Strategy (For Planning)

### Phase 1: Data Layer (contentId prop)
Replace `{ plex }` and `{ media }` props with `{ contentId }` throughout the Player stack.

### Phase 2: API Call Abstraction
Replace hardcoded `/plex/` routes with compound ID routes (`/info/${contentId}`).

### Phase 3: Config Normalization
Rename `plex:` config section to `content:`, make `contentSource` drive config lookup.

### Phase 4: Display URL Abstraction
Items should carry their own `thumbnail` URL from the backend. Frontend should not construct `/display/plex/${id}` — the list router already returns thumbnail URLs.

### Phase 5: Proxy URL Abstraction
Proxy routes (`/proxy/plex/stream/`, `/proxy/plex/photo/`) need a backend abstraction that returns correct proxy URLs based on source, so frontend never constructs source-specific proxy paths.

### Phase 6: Cleanup
Rename `PlexMenuRouter` → `ContentMenuRouter`, `useFetchPlexData` → `useFetchContentData`, remove `DaylightPlexPath`.
