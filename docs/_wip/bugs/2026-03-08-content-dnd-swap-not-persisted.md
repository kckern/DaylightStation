# Content DnD Swap Not Persisted + Blur Freeform Saves Invalid ID

**Date:** 2026-03-08
**App:** Admin (ListsFolder / ContentSearchCombobox)
**Status:** Open
**Severity:** High — silent data loss
**Session log:** `admin/2026-03-08T21-02-34.jsonl`
**Affected file:** `data/household/config/lists/menus/fhe.yml`

---

## Bug 1: Content Swap Race Condition

### Symptom

User performed two rapid drag-and-drop content swaps. Neither persisted — the YAML file retained the original order.

### Timeline (from logs)

| Time | Event | Detail |
|------|-------|--------|
| 21:02:54.635 | `drag.start` | index 4, `plex:642175` |
| 21:02:56.062 | `content.swap` | index 4 → index 3 (`plex:642175` ↔ `plex:457377`) |
| 21:02:57.691 | `drag.start` | index 4, `plex:642175` ← **still shows old value** |
| 21:02:58.897 | `content.swap` | index 4 → index 2 (`plex:642175` ↔ `plex:457402`) |

The second drag started **1.6s** after the first swap. The dragged item still shows `plex:642175` at index 4 — proving the first swap's state update hadn't taken effect yet.

### Expected vs Actual

**Expected order (after both swaps):** `plex:642175` moves to index 2, with `plex:457402` and `plex:457377` shifting down.

**Actual order in YAML (unchanged):**
```yaml
- input: plex:457402   # index 2 — Felix
- input: plex:457377   # index 3 — Milo
- input: plex:642175   # index 4 — Alan
```

### Root Cause (suspected)

**Race condition in `handleDragEnd`** — no lock or optimistic update prevents a second drag while the first is in-flight.

Each content swap in `ListsFolder.jsx:179-182` does:
```js
await updateItem(dstSi, dstIdx, updatesForA);  // PUT + fetchList
await updateItem(srcSi, srcIdx, updatesForB);  // PUT + fetchList
```

Each `updateItem` (`useAdminLists.js:121-135`) does a PUT then calls `fetchList` to refetch the whole list. That's **4 HTTP requests per swap** (2 PUTs + 2 GETs).

**The failure mode:**

1. First swap starts: PUT index 3 → fetchList → PUT index 4 → fetchList
2. User initiates second drag **before step 4 completes** (1.6s gap)
3. Second drag reads `sections` state, which is stale (first swap's fetchList hasn't resolved or the mid-swap fetchList returned partial state)
4. Second swap sends PUTs based on stale indices/values
5. The fetchList calls from both swaps race, and the final refetch shows the server's actual state — which may have conflicting or overwritten updates

**Contributing factors:**
- `swapContentPayloads` swaps content fields between positions (not a move/reorder), making the operation non-idempotent when applied to stale state
- No optimistic UI update — UI waits for fetchList round-trip
- No drag lock or debounce while a swap is in-flight
- `setLoading(true)` is set but nothing in the DnD UI checks `loading` before allowing new drags

### Where to Fix

| File | Line | What |
|------|------|------|
| `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` | 145-202 | `handleDragEnd` — needs swap-in-progress lock |
| `frontend/src/hooks/admin/useAdminLists.js` | 121-135 | `updateItem` — fetchList after each PUT causes mid-swap refetch |
| `frontend/src/modules/Admin/ContentLists/listConstants.js` | 69-77 | `swapContentPayloads` — design is correct, but callers must serialize |

### Possible Fixes

1. **Lock approach:** Add `swapInProgressRef` — disable drag handles or skip `handleDragEnd` while true
2. **Batch approach:** Send both swap updates in a single API call, fetch once
3. **Optimistic approach:** Update local `sections` state immediately, debounce the API call
4. **Minimal fix:** Remove the intermediate `fetchList` from the first `updateItem` — only fetch after both PUTs complete

---

## Bug 2: Blur Commits Raw Search Query as Content ID

### Symptom

User was searching for a primary song ("Tell Me...") but the search took **17 seconds**. Before results loaded, the field lost focus (blur). The raw search text `primary:tell me` was saved as a freeform value — which is not a valid content ID — causing a 404.

### Timeline (from logs)

| Time | Event | Detail |
|------|-------|--------|
| 21:03:16.044 | `editing.start` | Editing `singalong:hymn/97` at index 8 |
| 21:03:56.471 | `search.request` | Typed `primary` |
| 21:04:00.424 | `search.request` | Typed `primary:tell me` |
| 21:04:17.252 | `search.results` | 20 results returned after **16,829ms** |
| 21:04:17.415 | `commit.freeform` | Blur trigger — saved `primary:tell me` (raw query, not a content ID) |
| 21:04:19.802 | `content_api.error_status` | 404 for `primary:tell me` — invalid ID |

### Expected Behavior

The search query `primary:tell me` is clearly a search (has no numeric ID), not a freeform content ID. Results had just loaded with valid options like `primary:57` ("Tell Me the Stories of Jesus").

### Root Cause: Slow Search Due to Missing Alias Resolution

The 17-second search is the **primary cause**. The `primary:` prefix should route to only the `singalong` adapter, but instead searches ALL 12 adapters.

**The disconnect:** Two separate alias systems exist and don't talk to each other:

1. **`content-prefixes.yml` aliases** (`primary: singalong:primary`) — used by `ContentQueryService.#parseIdFromText()` for direct ID lookup (e.g., `primary:57` → `singalong:primary/57`). Works for IDs, **NOT used for text search routing**.

2. **`ContentQueryAliasResolver`** — used by `ContentQueryService.search()` to route prefix-based queries to specific adapters. Has built-in aliases (`music`, `photos`, `video`, `audiobooks`) and user config aliases. **Does NOT read `content-prefixes.yml`.**

When searching `primary:tell me`:
1. `#parseContentQuery("primary:tell me")` → `{ prefix: "primary", term: "tell me" }`
2. `aliasResolver.resolveContentQuery("primary")`:
   - Not a user alias ✗
   - Not a built-in alias (`music`/`photos`/`video`/`audiobooks`) ✗
   - Not an exact source (`singalong` ≠ `primary`) ✗
   - Not a provider ✗, not a category ✗
   - → `#createPassthroughResult()` → **ALL sources, no filtering**
3. `#parseIdFromText("tell me")` → not numeric, not UUID → `null`
4. Text search "tell me" sent to ALL 12 adapters in parallel

**Perf data from live test:**
```
abs:       6024ms (bottleneck — Audiobookshelf)
singalong: 2408ms (the ONLY adapter that matters)
plex:      2762ms
immich:    2026ms
files:     1361ms
...11 other adapters wasting time
```

If routed to singalong only, this search would take ~2.4s instead of 6s+ (or 17s on a bad day).

**Secondary cause:** blur-commit doesn't distinguish "search-in-progress" from intentional commit. Even with a faster search, accidental blur during slow network conditions could still save raw query text.

### Where to Fix

| File | What |
|------|------|
| `backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs` | Should read `content-prefixes.yml` aliases and route `primary:` → singalong adapter |
| `backend/src/3_applications/content/ContentQueryService.mjs:79-97` | Alias resolution path — if aliasResolver returns passthrough, should check `prefixAliases` as fallback |
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | Blur handler — consider suppressing freeform commit if search is still pending |

### Fix Options

**Option A (preferred): Bridge the two alias systems.** Make `ContentQueryAliasResolver` aware of `prefixAliases` from `content-prefixes.yml`. When `primary` doesn't match built-in/user aliases, check prefix aliases and route to the mapped source (singalong).

**Option B: Fallback in ContentQueryService.** After alias resolver returns passthrough, check if `prefix` exists in `this.#prefixAliases`. If so, extract the source and only search that adapter.

**Option C: Add `primary` as built-in alias.** Quick but doesn't generalize — `hymn`, `scripture`, `poem` have the same problem.

### Resolution (Search Routing)

**Status: Fixed** — Option A implemented.

`ContentQueryAliasResolver` now accepts `prefixAliases` and checks them as step 4 in the resolution chain (after user config, built-in, registry; before passthrough). Bootstrap passes `prefixAliases` from `content-prefixes.yml` to the resolver.

**Results:**
- `primary:tell me` → singalong only, **1.5s** (was 6-17s)
- `hymn:love` → singalong only, **259ms** (was 6s+)
- Unprefixed searches unchanged (all adapters)

**Files changed:**
- `backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs` — accept `prefixAliases`, check in `#resolveFromRegistry`, update `isAlias()`/`getAvailableAliases()`
- `backend/src/0_system/bootstrap.mjs:748` — pass `prefixAliases` to resolver
- `tests/isolated/application/content/ContentQueryAliasResolver.test.mjs` — 7 tests

**Note:** The blur-commit UX issue (saving raw search text on blur) remains a separate concern. With the search now completing in ~1.5s instead of 17s, the window for accidental blur-commit is much smaller, but it's not eliminated.

### Current State in YAML

Line 47 of `fhe.yml`:
```yaml
- input: primary:tell me    # ← invalid, should be primary:57 or singalong:primary/57
  label: Closing Hymn
```

This needs manual correction.
