# ItemId vs ContentId — Codebase Naming Audit

**Date:** 2026-03-06
**Scope:** Full codebase — backend, frontend, API, persistence, config

---

## Executive Summary

`itemId` and `contentId` refer to **the same concept**: a compound identifier in the format `source:localId` (e.g., `plex:12345`, `hymn:166`). They are not separate domain entities. The codebase uses both names for the same value, with no consistent boundary between them. This creates confusion when reading code, onboarding, and debugging.

**Scale of usage:**

| Term | Backend occurrences | Frontend occurrences | Total files |
|------|-------------------|---------------------|-------------|
| `itemId` | 289 across 45 files | 66 across 13 files | 58 |
| `contentId` | 105 across 21 files | 446 across 73 files | 94 |

---

## Findings

### 1. The Domain Layer Uses `itemId`

The domain layer has a well-defined `ItemId` value object and uses `itemId` consistently:

- **`ItemId` value object** (`backend/src/2_domains/content/value-objects/ItemId.mjs`) — immutable composite identifier with `source` and `localId` fields, `parse()`, `tryParse()`, `normalize()`, `equals()`
- **`Item` entity** (`backend/src/2_domains/content/entities/Item.mjs`) — has `this.itemId` (ItemId instance), `this.id` (string form), `this.source`, `this.localId`
- **`MediaProgress` entity** (`backend/src/2_domains/content/entities/MediaProgress.mjs`) — requires `itemId` string as its key
- **`QueueService`** — maps progress by `p.itemId`
- **`ContentQueryService`** — maps progress by `p.itemId`

### 2. The API Layer Introduces `contentId`

The API layer translates domain `item.id` into `contentId` for external consumers:

```javascript
// queue.mjs:toQueueItem()
const qi = {
  id: item.id,           // "source:localId" — same value
  contentId: item.id,    // "source:localId" — renamed for frontend
  ...
};
```

Other API files using `contentId`:
- `list.mjs` — builds action objects with `contentId` field
- `launch.mjs` — accepts and returns `contentId`
- `info.mjs` — returns `contentId` in response
- `display.mjs` — accepts `contentId` in route
- `siblings.mjs` — uses `contentId` for navigation
- `play.mjs` — mixed: accepts compound ID, returns `itemId` in progress response but `contentId` elsewhere

### 3. The Frontend Uses `contentId` Almost Exclusively

73 frontend files (446 occurrences) use `contentId`. Only 13 files (66 occurrences) use `itemId`, and those are concentrated in:
- **Feed module** (`Scroll.jsx`, `FeedCard.jsx`, `DetailView.jsx`) — uses `itemId` for feed article identifiers
- **Admin module** (`ListsItemRow.jsx`, `ContentSearchCombobox.jsx`, `siblingsCache.js`) — uses `itemId` for list item operations
- **Gratitude module** — uses `itemId` for gratitude option identifiers

### 4. The Feed System Uses `itemId` Differently

The feed system uses `itemId` for feed article/post identifiers (e.g., `reddit:post123`, `headline:story456`). These follow the same `source:localId` format but refer to feed items rather than playable content. Key files:
- `FeedAssemblyService.mjs` — 14 occurrences, `itemId` as cache key
- `YamlDismissedItemsStore.mjs` — stores `itemId → timestamp`
- `YamlSelectionTrackingStore.mjs` — stores `itemId → {count, last}`
- `feed.mjs` router — accepts `itemIds` arrays for dismiss/mark operations

### 5. The Nutribot System Uses `itemId` for Food Items

A third, unrelated use of `itemId` exists in the nutrition domain:
- `NutriLog.mjs` — `removeItem(itemId)`, `updateItem(itemId, updates)`
- `DeleteListItem.mjs` — 15 occurrences
- `SelectItemForAdjustment.mjs` — 22 occurrences

These `itemId` values are UUIDs, not compound IDs. Completely different concept.

### 6. The Persistence Layer Uses `itemId`

All YAML datastores use `itemId`:
- `YamlMediaProgressMemory.mjs` — 14 occurrences, `itemId` as YAML map key
- `YamlDismissedItemsStore.mjs` — 7 occurrences
- `YamlSelectionTrackingStore.mjs` — 4 occurrences
- `mediaProgressSchema.mjs` — serializes with `itemId` property

### 7. Application Services Are Mixed

- `ProgressSyncService.mjs` — 28 occurrences of `itemId`, uses it as debounce map key alongside separate `localId`
- `LaunchService.mjs` — 13 occurrences of `contentId`
- `ContentIdResolver.mjs` — the resolver itself uses neither term for input/output; it returns `{ source, localId, adapter }`
- `listConfigNormalizer.mjs` — 14 occurrences of `contentId` for action normalization

### 8. The Translation Point

The exact translation from `itemId` to `contentId` happens at the API boundary in `toQueueItem()`:

```
Domain: item.itemId (ItemId) → item.id (string)
   ↓ API layer
Response: { id: item.id, contentId: item.id }  ← both present, same value
   ↓ Frontend
Component: item.contentId
```

But this boundary isn't clean — some API routes return `itemId` (e.g., play log response), some return `contentId` (e.g., queue items), and some return both.

---

## Problem Analysis

### Ambiguity: Three Different Concepts, One Name

`itemId` is overloaded across three unrelated domains:

| Domain | Format | Example | Meaning |
|--------|--------|---------|---------|
| Content/Media | `source:localId` | `plex:12345` | Playable content identifier |
| Feed | `source:localId` | `reddit:abc123` | Feed article identifier |
| Nutrition | UUID | `a1b2c3d4-...` | Food log entry identifier |

### Inconsistency: Same Value, Two Names

For content/media, the same compound ID string is called:
- `itemId` in domain entities, persistence, progress tracking, and some API responses
- `contentId` in API responses, frontend state, queue items, list actions, and launch payloads
- `id` on the Item entity itself (backward-compatible alias)

### Confusion Points

1. **`toQueueItem()` outputs both `id` and `contentId` with the same value** — unclear which to use
2. **Play log response uses `itemId`** but **queue items use `contentId`** — same API surface, different names
3. **Feed `itemId`** looks like content `itemId` (both `source:localId`) but they're different domains
4. **Frontend has both** — `contentId` for media, `itemId` for feed/admin — no clear naming rule

---

## Recommendations

### Option A: Consolidate to `contentId` Everywhere (Recommended)

**Rationale:** `contentId` is already dominant in the frontend (446 vs 66 occurrences) and more descriptive — it identifies *content*, not a generic "item." The ItemId value object name is fine (it's internal), but the string property name should be `contentId` everywhere.

**Changes required:**
1. **Rename `MediaProgress.itemId` → `MediaProgress.contentId`** — domain entity change, cascades to persistence
2. **Rename YAML keys in progress files** — migration script for `data/household/*/progress/*.yml`
3. **Update `ProgressSyncService` debounce maps** — rename `itemId` keys to `contentId`
4. **Standardize API responses** — play log should return `contentId` not `itemId`
5. **Keep `ItemId` value object name** — it's internal DDD naming, doesn't leak to consumers
6. **Keep feed `itemId` as-is OR rename to `feedItemId`** — feed items are a separate domain

**Estimated scope:** ~45 backend files, ~13 frontend files, YAML data migration

**Risk:** Medium. Requires careful data migration for existing progress YAML files. Breaking change for any external consumers of the play log API.

### Option B: Consolidate to `itemId` Everywhere

**Rationale:** Matches the domain model and value object naming. Simpler — no need to rename the core entity.

**Changes required:**
1. **Remove `contentId` from `toQueueItem()`** — frontend already has `id`
2. **Rename all frontend `contentId` references** → `itemId` (446 occurrences across 73 files)
3. **Update API responses** — remove `contentId` alias, use `id` or `itemId`

**Estimated scope:** ~73 frontend files, ~21 backend files

**Risk:** High. Massive frontend churn. `itemId` is ambiguous (content vs feed vs nutrition). Would increase confusion in the feed module where both content and feed items coexist.

### Option C: Keep Both, Clarify Boundaries (Pragmatic)

**Rationale:** The current split roughly follows a useful pattern: `itemId` = internal identifier, `contentId` = external/API identifier. Codify this as intentional.

**Changes required:**
1. **Document the convention**: `itemId` = domain/persistence property, `contentId` = API response/frontend property
2. **Fix violations**: Play log response should use `contentId` (not `itemId`), feed should use `feedItemId`
3. **Remove `id` from `toQueueItem()`** — redundant with `contentId`
4. **Rename nutribot `itemId` → `entryId`** — disambiguate from content items

**Estimated scope:** ~10 files, documentation update

**Risk:** Low. Doesn't solve the root naming split but makes it intentional and documented.

### Option D: Namespace by Domain

Rename to make each domain's identifier unambiguous:

| Current | Proposed | Domain |
|---------|----------|--------|
| `itemId` / `contentId` | `contentId` | Content/Media |
| `itemId` (feed) | `feedItemId` | Feed |
| `itemId` (nutribot) | `entryId` or `logItemId` | Nutrition |

**Changes required:** Rename across all three domains. Most impactful for feed (14 files) and nutribot (8 files).

**Estimated scope:** ~25 files for disambiguation, plus Option A or C for the content domain

---

## Recommendation

**Option A + Option D combined.** Consolidate media/content to `contentId` everywhere, and disambiguate feed/nutribot usages:

1. `contentId` = the compound `source:localId` for playable content (dominant usage)
2. `feedItemId` = feed article identifiers
3. `entryId` = nutrition log item identifiers
4. `ItemId` value object name stays (internal DDD, doesn't leak)

This eliminates all ambiguity with moderate effort. The frontend is already 87% `contentId` — finishing the migration is straightforward. The biggest risk is the YAML data migration for progress files, which should be scripted and tested.

---

## Files Inventory

### Backend files using `itemId` for content (would change under Option A)

| File | Occurrences | Context |
|------|------------|---------|
| `2_domains/content/entities/MediaProgress.mjs` | 3 | Entity property |
| `2_domains/content/entities/Item.mjs` | 9 | Entity property + resolution |
| `2_domains/content/services/QueueService.mjs` | 2 | Progress map key |
| `3_applications/content/ContentQueryService.mjs` | 1 | Progress map key |
| `3_applications/content/services/ProgressSyncService.mjs` | 28 | Debounce/cache key |
| `3_applications/content/ports/IMediaProgressMemory.mjs` | 3 | Interface contract |
| `1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` | 14 | Persistence |
| `1_adapters/persistence/yaml/mediaProgressSchema.mjs` | 2 | Schema |
| `1_adapters/content/media/plex/PlexAdapter.mjs` | 2 | Plex key extraction |
| `1_adapters/content/singalong/SingalongAdapter.mjs` | 9 | Audio file resolution |
| `1_adapters/content/readalong/ReadalongAdapter.mjs` | 10 | Text rendering |
| `1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs` | 11 | URL construction |
| `1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs` | 9 | API calls |
| `4_api/v1/routers/play.mjs` | 2 | Progress response |
| `4_api/v1/routers/content.mjs` | 7 | DTO construction |

### Backend files using `contentId` (already correct under Option A)

| File | Occurrences | Context |
|------|------------|---------|
| `4_api/v1/routers/queue.mjs` | 5 | Queue item response |
| `4_api/v1/routers/list.mjs` | 11 | List action objects |
| `4_api/v1/routers/launch.mjs` | 6 | Launch request/response |
| `4_api/v1/routers/info.mjs` | 3 | Info response |
| `3_applications/content/services/LaunchService.mjs` | 13 | Launch orchestration |
| `1_adapters/content/list/listConfigNormalizer.mjs` | 14 | YAML action normalization |
| `0_system/bootstrap.mjs` | 6 | ContentIdResolver wiring |

### Frontend files using `itemId` (would need disambiguation)

| File | Occurrences | Context |
|------|------------|---------|
| `modules/Feed/Scroll/Scroll.jsx` | 6 | Feed scroll (→ `feedItemId`) |
| `modules/Feed/Scroll/cards/FeedCard.jsx` | 13 | Feed card (→ `feedItemId`) |
| `modules/Feed/Scroll/detail/DetailView.jsx` | 1 | Feed detail (→ `feedItemId`) |
| `modules/Feed/Reader/Reader.jsx` | 2 | Feed reader (→ `feedItemId`) |
| `modules/Admin/ContentLists/ListsItemRow.jsx` | 17 | Admin list items |
| `modules/Admin/ContentLists/ContentSearchCombobox.jsx` | 8 | Admin search |
| `modules/Admin/ContentLists/siblingsCache.js` | 7 | Sibling navigation |
| `modules/AppContainer/Apps/Gratitude/Gratitude.jsx` | 4 | Gratitude options |
