# List Adapter Menu Alias Plan

Date: 2026-02-07
Status: Draft

## Summary
Enable nested menus and list browsing by normalizing `list:` inputs to the canonical `menu:` prefix so `/api/v1/info` and admin content browsing resolve list containers and children consistently.

## Goals
- Resolve `list:<name>` as a first-class content source for admin list browsing.
- Return container payloads with `items` for list containers, matching the shape expected by content comboboxes.
- Avoid changing existing YAML list files.

## Non-Goals
- Redesign list YAML schema.
- Add new list types beyond menus/programs/watchlists/queries.

## Current Behavior
- `ListAdapter` accepts `menu`, `program`, `watchlist`, `query` prefixes.
- `list:` appears in list YAML entries but is not resolved by the info route or list adapter, resulting in unresolved entries in admin views.

## Proposed Design
### Canonical Prefix
- Canonical list prefix for menus remains `menu:`.
- `list:` becomes an alias for `menu:` and should normalize early.

### Normalization Layers
1. **Parser/Alias Layer**
   - Add `list` to known sources in the unified parser.
   - Add alias mapping `list -> menu` in the parser so `/api/v1/info/list/<name>` resolves to `menu:<name>`.

2. **Registry Legacy Prefix Map**
   - Register a legacy prefix mapping `list -> menu` in `createApiRouters` so prefix-based resolution finds `ListAdapter` for `list:` inputs.

3. **Adapter Tolerance**
   - Extend `ListAdapter._parseId()` to accept `list:<name>` and internally map it to `menu:<name>`.
   - Optionally normalize list item inputs in `_buildListItems()` so `list:` is rewritten to `menu:` as items are built.

### Response Shape Requirements
For `ContentSearchCombobox` and similar admin browsers, container responses must include:
- `id` (compound, e.g. `menu:<name>`), `source`, `localId`
- `itemType: 'container'`
- `title`, `thumbnail` / `imageUrl`
- `items` list for containers
- Optional `metadata.parentTitle` / `metadata.parentId` for breadcrumbs

## Implementation Steps
1. Update the parser in [backend/src/4_api/v1/utils/actionRouteParser.mjs](backend/src/4_api/v1/utils/actionRouteParser.mjs):
   - Add `list` to `KNOWN_SOURCES`.
   - Add `list: 'menu'` to `SOURCE_ALIASES`.

2. Register a legacy prefix alias in [backend/src/0_system/bootstrap.mjs](backend/src/0_system/bootstrap.mjs):
   - Add `list -> menu` in `legacyPrefixMap` (or equivalent config-backed prefix mapping) used by `ContentSourceRegistry`.

3. Extend `ListAdapter` in [backend/src/1_adapters/content/list/ListAdapter.mjs](backend/src/1_adapters/content/list/ListAdapter.mjs):
   - Accept `list:<name>` in `_parseId()` and map to `menu` internally.
   - If needed, normalize `list:` inputs when building list items.

4. Validate info responses in [backend/src/4_api/v1/routers/info.mjs](backend/src/4_api/v1/routers/info.mjs):
   - Confirm container payloads include `items` and `itemType: 'container'`.

## Test Plan
- Parser: `parseActionRouteId({ source: 'list', path: 'fhe' })` resolves to source `menu`.
- Info route: `GET /api/v1/info/list/<name>` returns container payload with `items`.
- List adapter: `getItem('list:<name>')` returns same result as `getItem('menu:<name>')`.
- Admin combobox: sibling browsing works for `list:` entries.

## Risks / Mitigations
- **Risk:** Alias collisions with existing `list` usage.
  - **Mitigation:** Limit alias to menu lists and keep `menu:` canonical in outputs.
- **Risk:** Inconsistent IDs in UI when aliases are applied.
  - **Mitigation:** Normalize IDs to `menu:` in adapter output; avoid returning `list:` as the canonical ID.

## Rollout
- Implement parser + adapter aliasing first.
- Validate admin list views and combobox browsing.
- Update reference docs if the list prefix mapping is considered canonical.

## Related code:
- [backend/src/0_system/bootstrap.mjs](backend/src/0_system/bootstrap.mjs)
- [backend/src/1_adapters/content/list/ListAdapter.mjs](backend/src/1_adapters/content/list/ListAdapter.mjs)
- [backend/src/4_api/v1/utils/actionRouteParser.mjs](backend/src/4_api/v1/utils/actionRouteParser.mjs)
- [backend/src/4_api/v1/routers/info.mjs](backend/src/4_api/v1/routers/info.mjs)
- [frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx](frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx)

---

## Second Opinion (Copilot Review — 2026-02-07)

### Overall Assessment
The plan is well-structured and the three-layer normalization approach (parser → registry → adapter) is sound. It follows the existing patterns in the codebase. A few observations and concerns:

### 1. The YAML format uses `list: FHE` (with space), not `list:FHE`
The actual YAML entries in `tvapp.yml` use `input: 'list: FHE'` — note the space after the colon. This means the parsing path that encounters `list:` will likely come from **list item resolution inside `_buildListItems()`**, not just from API route parsing. The plan mentions this in step 3 as "optional," but it's actually the **primary** entry point for the problem. Item inputs are parsed differently from URL routes. Make sure the normalization also handles the `input` field parsing path (wherever list YAML `input` values like `'list: FHE'` get split into source/localId).

### 2. `legacyPrefixMap` won't work as-is for `list → menu`
The existing `registerLegacyPrefixes` mechanism maps a legacy prefix to a `"source:pathPrefix"` format that transforms `id → pathPrefix/id`. For example, `hymn → singalong:hymn` means `hymn:123` becomes `singalong` adapter with localId `hymn/123`. But `list → menu` doesn't need a path prefix transform — `list:FHE` should resolve to `menu:FHE`, not `menu:list/FHE`. The legacy prefix map's transform function would need to be identity (no path prefix), which means step 2 needs either:
  - A new entry format like `list: 'menu:'` (empty path prefix) plus logic to handle that, or
  - Skip `legacyPrefixMap` entirely and just register `list` as a direct prefix alias in `ContentSourceRegistry` pointing to the `ListAdapter`.

Given that `ListAdapter` already handles multi-prefix routing internally (menu/program/watchlist/query), the cleaner approach is probably to just add `list` to the adapter's `prefixes` array directly, alongside `menu`, and have `_parseId()` treat `list` as equivalent to `menu`. This avoids the transform indirection entirely.

### 3. `actionRouteParser` change is correct but not the main fix
Adding `list` to `KNOWN_SOURCES` and `list: 'menu'` to `SOURCE_ALIASES` is correct for URL-based resolution (`/api/v1/info/list/FHE`). But the real problem appears to be in list-item resolution — when `ListAdapter._buildListItems()` encounters a child item with `input: 'list: FHE'`, it tries to resolve `list:FHE` through the registry or adapter, and that's where it fails. The parser fix helps the API route, but the internal item resolution path also needs attention.

### 4. Simpler alternative: Normalize at YAML input parsing time
Instead of three layers of aliasing, consider a single normalization point: wherever list YAML `input` values are parsed (likely in `_buildListItems()` or `_loadList()`), just do a regex replace: `input.replace(/^list:\s*/i, 'menu:')`. This is minimal, local to `ListAdapter`, and avoids touching the parser, registry, or bootstrap. The YAML files are already in production and stable — the alias is really just a legacy format quirk, not a first-class source type that needs system-wide routing support.

### 5. Risk the plan doesn't mention: `list` as the adapter's own `source` property
`ListAdapter.source` returns `'list'` (line ~144 of ListAdapter.mjs). This means the registry likely registers it under the key `'list'`. But the adapter handles IDs with prefix `menu:`, `program:`, etc. — it never handles `list:` as a prefix today. If `registry.get('list')` already returns the `ListAdapter`, then `resolveFromPrefix('list', 'FHE')` might already partially work through the registry, but `adapter.getItem('list:FHE')` would fail because `_parseId()` doesn't accept `list:` prefix. This narrows the minimal fix to just updating `_parseId()` regex from `/^(menu|program|watchlist|query):(.+)$/` to `/^(menu|program|watchlist|query|list):(.+)$/` and mapping `list` to `menu` in the prefix→listType lookup.

### Recommended Minimal Implementation
1. **`_parseId()`**: Accept `list` prefix, treat as `menu`.
2. **`_buildListItems()`**: Normalize `list:` → `menu:` in item inputs before resolution.
3. **`actionRouteParser`**: Add `list` to `KNOWN_SOURCES` + `SOURCE_ALIASES` (for URL routing).
4. Skip the `legacyPrefixMap` change — it adds complexity for a case already handled by the adapter itself.

This is 3 small, focused changes instead of 4 layers of normalization.

---

## Phased Implementation Plan

### Context: How the system resolves `list:` today

Understanding why it fails clarifies each phase:

1. **URL path** (`/api/v1/info/list/FHE`):
   - `actionRouteParser` doesn't recognize `list` → treats it as heuristic → fails detection → `source=''`
   - Info route calls `registry.get('')` → null → 404

2. **YAML item path** (`input: 'list: FHE'` in tvapp.yml):
   - `_buildListItems` regex parses input → `source='list'`, `localId='FHE'`
   - Builds `compoundId = 'list:FHE'` as the child item's ID
   - When user clicks that item, UI calls `/api/v1/info/list/FHE` → same failure as above
   - Or if resolved internally via `registry.resolve('list:FHE')` → `registry.get('list')` returns `ListAdapter` → `adapter.getItem('list:FHE')` → `_parseId('list:FHE')` rejects (regex only accepts `menu|program|watchlist|query`) → null

3. **Registry state**: `ListAdapter.source` returns `'list'`, so `registry.get('list')` already returns the `ListAdapter`. The prefixes `menu`, `program`, `watchlist`, `query` are all registered in the prefix map pointing to this same adapter.

---

### Phase 1: Adapter Core (makes internal resolution work)

**Goal:** `adapter.getItem('list:FHE')` and `adapter.getList('list:FHE')` succeed.

**File:** [backend/src/1_adapters/content/list/ListAdapter.mjs](backend/src/1_adapters/content/list/ListAdapter.mjs)

**Change 1a — `_parseId()` (line 159):**
```javascript
// Before:
_parseId(id) {
  const match = id.match(/^(menu|program|watchlist|query):(.+)$/);
  if (!match) return null;
  return { prefix: match[1], name: match[2] };
}

// After:
_parseId(id) {
  const match = id.match(/^(menu|program|watchlist|query|list):(.+)$/);
  if (!match) return null;
  // Normalize 'list' prefix to 'menu' (list: is a legacy alias)
  const prefix = match[1] === 'list' ? 'menu' : match[1];
  return { prefix, name: match[2] };
}
```

**Change 1b — `_buildListItems()` input normalization (after line 674):**

After the input regex match extracts `source` and `localId`, normalize `list` → `menu` so output item IDs are canonical:
```javascript
// After line 674, add:
if (source === 'list') source = 'menu';
```

This means `compoundId` at line 780 becomes `menu:FHE` instead of `list:FHE`, so downstream consumers (info route, combobox) get canonical IDs.

**Change 1c — `_getListType()` (line 149) — probably not needed:**

`_getListType` maps prefix → directory name. Since `_parseId` now normalizes `list→menu` before `_getListType` is called, no change needed here. But verify.

**Verification:**
- `adapter.getItem('list:FHE')` returns same result as `adapter.getItem('menu:FHE')`
- `adapter.getList('list:FHE')` returns children with `menu:*` IDs (not `list:*`)
- Items parsed from `input: 'list: FHE'` produce `compoundId = 'menu:FHE'`

**Risk:** Low. Changes are local to ListAdapter with no external API surface change.

---

### Phase 2: URL Routing (makes `/api/v1/info/list/FHE` work)

**Goal:** API routes with `list` as the source segment resolve correctly.

**File:** [backend/src/4_api/v1/utils/actionRouteParser.mjs](backend/src/4_api/v1/utils/actionRouteParser.mjs)

**Change 2a — `KNOWN_SOURCES` (line 20):**
```javascript
// Add 'list' to the array (after 'readalong'):
const KNOWN_SOURCES = [
  'plex', 'immich', 'watchlist', 'local', 'files',
  'canvas', 'audiobookshelf', 'singalong', 'readalong',
  'list'  // ← add
];
```

**Change 2b — `SOURCE_ALIASES` (line 37):**
```javascript
const SOURCE_ALIASES = {
  local: 'watchlist',
  media: 'files',
  singing: 'singalong',
  narrated: 'readalong',
  list: 'menu'  // ← add
};
```

**Resolution flow after this change:**
1. `/api/v1/info/list/FHE` → parser recognizes `list` → normalizes to `menu` via alias → `source='menu'`, `localId='FHE'`
2. Info route: `registry.get('menu')` → null (not a source name)
3. Falls to `registry.resolveFromPrefix('menu', 'FHE')` → prefix map lookup → `ListAdapter` with `idTransform` → `localId = 'menu:FHE'`
4. `adapter.getItem('menu:FHE')` → `_parseId` accepts → success

**Verification:**
- `GET /api/v1/info/list/FHE` returns container payload with `items`
- `GET /api/v1/info/menu/FHE` still works (no regression)

**Risk:** Low. `list` is not currently a recognized source, so no collision.

---

### Phase 3: Integration Testing

**Goal:** End-to-end validation of both resolution paths.

**Tests to add or verify (ideally in `tests/integration/` or `tests/live/api/`):**

| Test | Input | Expected |
|------|-------|----------|
| Parser alias | `parseActionRouteId({ source: 'list', path: 'FHE' })` | `{ source: 'menu', localId: 'FHE' }` |
| Adapter getItem | `listAdapter.getItem('list:FHE')` | Same result as `getItem('menu:FHE')` |
| Adapter getList | `listAdapter.getList('list:FHE')` | Children with `menu:*` IDs |
| Item ID output | `_buildListItems([{input: 'list: FHE', ...}], ...)` | Child item has `id: 'menu:FHE'` |
| Info route | `GET /api/v1/info/list/FHE` | 200 with `itemType: 'container'`, `items` array |
| No regression | `GET /api/v1/info/menu/FHE` | Same 200 response |

**Manual validation:**
- Open admin content browser, navigate to tvapp menu
- Verify FHE and ChristmasEve entries (which use `list:` input) are resolvable
- Click into them and confirm children load

---

### Phase 4: Cleanup (optional, low priority)

**4a — Output ID canonicalization audit:**
- `getItem()` at line 373 uses the raw `id` parameter as the returned item's `id`. If called with `list:FHE`, it returns `id: 'list:FHE'` even though `localId` is normalized. For consistency, consider normalizing the output `id` to `menu:FHE`:
  ```javascript
  // In getItem(), after _parseId:
  const canonicalId = `${parsed.prefix}:${parsed.name}`;
  // ...
  return new ListableItem({ id: canonicalId, ... });
  ```

**4b — `getList()` strip logic at line 398:**
- `getList` already does `id.replace(/^list:/, '')`. This handles `list:menu:FHE` → `menu:FHE`. With Phase 1 changes this still works, but if `getList('list:FHE')` is called (without the inner prefix), the strip produces `FHE`, which `_parseId` rejects. Phase 1's `_parseId` fix would need the strippedId to still be `list:FHE` for it to work. **Verify this edge case** — may need to adjust the strip logic to only strip when followed by a known prefix (`list:menu:` → yes, `list:FHE` → no).

**4c — Skip the `legacyPrefixMap` / bootstrap change:**
- Not needed. The adapter handles `list:` internally, and the parser normalizes it for URL routes. Adding it to `legacyPrefixMap` would create a redundant resolution path with a transform mismatch (see review point #2).

---

### Summary

| Phase | Files Changed | Risk | Effort |
|-------|--------------|------|--------|
| 1: Adapter core | ListAdapter.mjs | Low | ~30 min |
| 2: URL routing | actionRouteParser.mjs | Low | ~10 min |
| 3: Testing | tests/ | None | ~1 hr |
| 4: Cleanup | ListAdapter.mjs (optional) | Low | ~30 min |

**Total estimated effort:** ~2 hours

**Deploy order:** Phase 1 + 2 together (they're independent but both needed for full fix), then Phase 3 to validate, Phase 4 as follow-up.
