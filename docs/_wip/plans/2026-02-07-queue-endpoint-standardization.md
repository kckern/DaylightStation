# Queue Endpoint Standardization

**Date:** 2026-02-07  
**Status:** Proposal  
**Priority:** Medium  
**Effort:** Small (2-4 hours)

## Problem Statement

The API has inconsistent naming and organization for content retrieval endpoints:

- `/api/v1/info/:source/:id` - Returns metadata + capabilities
- `/api/v1/list/:source/:id` - Returns direct children with mixed capabilities
- `/api/content/playables/:source/*` - Returns flattened playables only

The playables endpoint is:
1. Under a different base path (`/api/content` vs `/api/v1`)
2. Uses unclear naming ("playables" is technically accurate but not user-facing)
3. Breaks the pattern established by info/list endpoints

## Current Architecture

### Three Distinct Use Cases

**1. Metadata Query** (`/api/v1/info`)
- **Purpose:** Get item metadata and capabilities without children
- **Returns:** Single item with `capabilities` array
- **Use case:** "What can I do with this item?"
- **Example:** Check if `watchlist:cfm2025` is queueable

**2. Structural Navigation** (`/api/v1/list`)
- **Purpose:** Browse container contents
- **Returns:** Direct children with mixed types (listable, playable, queueable)
- **Use case:** "What's inside this folder/watchlist?"
- **Example:** Show all items in a watchlist for management UI

**3. Playback Resolution** (`/api/content/playables`)
- **Purpose:** Build playback queue
- **Returns:** Flattened playables only (recursive resolution)
- **Applies:** Watch state filtering, scheduling, priority sorting
- **Use case:** "What will play if I hit Play All?"
- **Example:** Resolve `watchlist:cfm2025` to actual video files

## Proposed Solution

Rename and relocate `/api/content/playables` to `/api/v1/queue` for consistency and clarity.

### New Endpoint Structure

```
/api/v1/info/:source/:id    → metadata + capabilities
/api/v1/list/:source/:id    → direct children (mixed types)
/api/v1/queue/:source/:id   → flattened playables only
```

### Rationale for "Queue" Name

1. **User-facing concept:** Users understand "queue" (playlist, playback queue)
2. **Action-oriented:** Implies "what will play" vs abstract "playables"
3. **Frontend clarity:** `fetch('/api/v1/queue/...')` clearly means "get playback queue"
4. **Industry standard:** Netflix, YouTube, Spotify all use "queue" terminology

## Implementation Plan

### Phase 1: Create New Queue Router

**File:** `backend/src/4_api/v1/routers/queue.mjs`

```javascript
/**
 * Queue Router
 * 
 * Resolves containers to flattened playable items for playback.
 * Applies watch state filtering, scheduling, and priority sorting.
 * 
 * @module api/v1/routers/queue
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

export function createQueueRouter(config) {
  const { registry, logger = console } = config;
  const router = express.Router();

  router.get('/:source/*', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = req.params[0] || '';
    
    const { source: resolvedSource, localId, compoundId } = parseActionRouteId({
      source,
      path: rawPath
    });

    let adapter = registry.get(resolvedSource);
    let finalId = compoundId;

    if (!adapter) {
      const resolved = registry.resolveFromPrefix(resolvedSource, localId);
      if (resolved) {
        adapter = resolved.adapter;
        finalId = resolved.localId;
      }
    }

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    }

    if (!adapter.resolvePlayables) {
      return res.status(400).json({ 
        error: 'Source does not support queue resolution',
        source: resolvedSource 
      });
    }

    const playables = await adapter.resolvePlayables(finalId);

    logger.info?.('queue.resolve', {
      source: resolvedSource,
      localId,
      count: playables.length
    });

    res.json({
      source: resolvedSource,
      id: compoundId,
      count: playables.length,
      items: playables
    });
  }));

  return router;
}
```

### Phase 2: Register Router

**File:** `backend/src/4_api/v1/index.mjs`

```javascript
import { createQueueRouter } from './routers/queue.mjs';

// ... existing imports

export function createV1API(dependencies) {
  const router = express.Router();
  
  // ... existing routers
  
  router.use('/queue', createQueueRouter({
    registry: dependencies.contentSourceRegistry,
    logger: dependencies.logger
  }));
  
  return router;
}
```

### Phase 3: Deprecation Path

1. Keep `/api/content/playables` working (proxy to new endpoint)
2. Add deprecation warning to response headers
3. Update all frontend calls to use `/api/v1/queue`
4. Remove old endpoint after 2-week grace period

## Benefits

### 1. Consistency
- All content endpoints under `/api/v1/*`
- Predictable path structure
- Unified ID parsing (actionRouteParser)

### 2. Clarity
- "Queue" is clearer than "playables" for frontend developers
- Endpoint purpose obvious from name
- Aligns with user mental model

### 3. Capability System Integration
- `/api/v1/info` returns `capabilities: ['queueable']`
- Frontend can check capability before calling `/api/v1/queue`
- Clean separation of concerns

### 4. Performance Transparency
- Clear that `/queue` is expensive (recursive resolution)
- Developers know to use `/list` for browsing
- `/queue` only called when actually needed

## Use Case Examples

### Example 1: Watchlist Management UI

```javascript
// Get metadata
const info = await fetch('/api/v1/info/watchlist:cfm2025');
// { capabilities: ['listable', 'queueable'], itemCount: 12 }

// Show list for management (all items, including watched)
const list = await fetch('/api/v1/list/watchlist:cfm2025');
// { children: [...12 mixed items...] }
```

### Example 2: Play All Button

```javascript
// Check if queueable
const info = await fetch('/api/v1/info/watchlist:cfm2025');
if (info.capabilities.includes('queueable')) {
  // Get playback queue (filtered, sorted)
  const queue = await fetch('/api/v1/queue/watchlist:cfm2025');
  // { items: [...5 unwatched videos...] }
  player.loadQueue(queue.items);
}
```

### Example 3: Talk Directory

```javascript
// Browse structure
const list = await fetch('/api/v1/list/talk:ldsgc202510');
// { children: [...talks with thumbnails...] }

// Queue entire conference (flattened)
const queue = await fetch('/api/v1/queue/talk:ldsgc202510');
// { items: [...all talk videos...] }
```

## Testing Plan

### Unit Tests
- ID parsing (compound, segments, heuristics)
- Error handling (unknown source, non-queueable)
- Registry resolution (prefix + fallback)

### Integration Tests
```javascript
describe('GET /api/v1/queue', () => {
  it('resolves watchlist to filtered playables', async () => {
    const res = await request(app).get('/api/v1/queue/watchlist:test');
    expect(res.body.items).toHaveLength(3); // 5 total, 2 watched
  });

  it('returns 400 for non-queueable source', async () => {
    const res = await request(app).get('/api/v1/queue/device:garage');
    expect(res.status).toBe(400);
  });

  it('handles prefix resolution', async () => {
    const res = await request(app).get('/api/v1/queue/media:sfx/intro');
    expect(res.body.source).toBe('files');
  });
});
```

## Migration Checklist

- [ ] Create `queue.mjs` router
- [ ] Register in v1 index
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Update frontend: TV app
- [ ] Update frontend: Fitness kiosk
- [ ] Update frontend: Admin panel
- [ ] Add deprecation headers to old endpoint
- [ ] Update API documentation
- [ ] Remove `/api/content/playables` after grace period

## Open Questions

1. **Should `/queue` support query parameters?**
   - `?shuffle=true` - randomize order
   - `?limit=10` - cap queue size
   - `?applySchedule=false` - override program scheduling

2. **Should we return queue metadata?**
   ```json
   {
     "source": "watchlist",
     "id": "watchlist:cfm2025",
     "count": 5,
     "filtered": 7,  // 7 items filtered out (watched, held)
     "duration": 3420,  // total seconds
     "items": [...]
   }
   ```

3. **Rate limiting?**
   - Queue resolution can be expensive
   - Should we cache results?
   - TTL for cache?

## Related Work

- **Capability system** - Already implemented in `/api/v1/info`
- **Action route parser** - Already handles unified ID parsing
- **Prefix resolution** - Already works in registry
- **Watch state filtering** - Already in `ListAdapter.resolvePlayables()`

## References

- [info.mjs](../../../backend/src/4_api/v1/routers/info.mjs) - Capability derivation
- [content.mjs](../../../backend/src/4_api/v1/routers/content.mjs) - Current playables endpoint
- [ListAdapter.mjs](../../../backend/src/1_adapters/content/list/ListAdapter.mjs) - Queue resolution logic
- [actionRouteParser.mjs](../../../backend/src/4_api/v1/utils/actionRouteParser.mjs) - ID parsing

---

## Addendum: Second Opinion & Behavioral Analysis

**Date:** 2026-02-07  
**Author:** AI Review

### Verdict: Good Proposal, but the Router is Too Thin

The rename from `/api/content/playables` to `/api/v1/queue` is the right call — it fixes the URL inconsistency and the naming is better. But the proposed router implementation is essentially the same thin passthrough as the current `content.mjs` playables handler. That's a missed opportunity. The real value of creating a dedicated `/queue` endpoint is to give it a **queue-shaped contract** distinct from `/list`.

### List vs Queue: Behavioral Differences That Should Be Explicit

After reading the code, here's what actually differs between `getList()` and `resolvePlayables()` inside `ListAdapter` — and what the new `/queue` router should make explicit at the API layer:

| Dimension | `/list` (getList) | `/queue` (resolvePlayables) |
|-----------|-------------------|-----------------------------|
| **Depth** | 1 level (direct children only) | Recursive (flattens through containers) |
| **Item types returned** | Mixed: containers, leaves, openers, everything | Playables only — no containers, no `open`/`list` actions |
| **Watch state filtering** | None — shows watched AND unwatched items | Filters out watched (≥90%), held, past skipAfter, future waitUntil |
| **Play vs Queue semantics** | N/A — shows raw list | `play` action → resolves ONE next-up item; `queue` action → resolves ALL children |
| **Priority sorting** | Preserves YAML order (or applies priority via `_buildListItems` for watchlists) | Same internal priority sort: `in_progress` > `urgent` > `high` > `medium` > `low` |
| **Schedule filtering** | None | Programs: day-of-week `_matchesToday()` check |
| **Behavior flags** | Exposed per-item (`shuffle`, `continuous`, `resume`) | Inherited into PlayableItem objects |
| **Metadata shape** | Rich: `toListItem()` with hierarchy, actions, thumbnails, parents map | Bare: raw PlayableItem (mediaUrl, duration, resumePosition) — no `toListItem()` transform, no parents map |
| **Modifiers** | `?playable`, `?shuffle`, `?recent_on_top` | None currently |

### Gap: Queue Items Not Transformed

The biggest practical gap: `/list` items go through `toListItem()` which flattens metadata, computes action objects, and normalizes watch state fields. `/queue` (playables) returns raw `PlayableItem` objects with none of that normalization. The frontend consuming a queue response gets a different shape than a list response for the _same content_.

**Recommendation:** The new `/queue` router should apply `toListItem()` to its results too, so the frontend gets a consistent item shape regardless of endpoint. Or define a lightweight `toQueueItem()` that includes the fields the player actually needs (mediaUrl, duration, resumePosition, thumbnail, title, id, behavior flags) without the navigation-oriented fields (list action, open action, parents map).

### What the Queue Router Should Add

Beyond the thin passthrough in the proposal, consider:

1. **Response metadata** (your Open Question #2 — answer: yes)
   ```json
   {
     "source": "watchlist",
     "id": "watchlist:cfm2025",
     "count": 5,
     "totalBeforeFiltering": 12,
     "filteredReasons": { "watched": 4, "held": 2, "scheduled": 1 },
     "totalDuration": 3420,
     "items": [...]
   }
   ```
   This makes debugging and UI display much easier ("5 of 12 items queued").

2. **Query parameters** (your Open Question #1 — answer: yes, selectively)
   - `?shuffle=true` — Fisher-Yates on resolved items. Already supported as a modifier on `/list`; queue should inherit it.
   - `?limit=N` — cap queue size. Useful for "play next 3" UX.
   - `?includeWatched=true` — override watch state filter for "play all" / rewatch.
   - Skip `?applySchedule=false` for now — YAGNI, and it complicates the contract.

3. **Consistent item transform** — either reuse `toListItem()` or create a `toQueueItem()` subset.

### On the Deprecation Path

The 2-week grace period for `/api/content/playables` is fine, but check: is anything outside the frontend calling it? (Fitness kiosk? External scripts?) Grep for all consumers before setting the deadline. Given that the current content.mjs handler is nearly identical to what the new queue.mjs does, the deprecation shim could literally be a one-line redirect rather than a proxy.

### On Rate Limiting / Caching (Open Question #3)

`resolvePlayables` is expensive for large watchlists — it does recursive registry lookups, watch state checks, and potentially calls other adapters. But caching is tricky because watch state changes constantly. Two pragmatic options:

- **Short TTL cache (30-60s):** Good enough for "user hits Play All twice quickly" without stale watch state.
- **ETag-based:** Hash the watchlist YAML mtime + watch state mtime. Return 304 if unchanged. More correct, slightly more complex.

Start with no cache. Add short TTL if performance is actually measured as a problem.

### Summary

| Aspect | Proposal | Recommendation |
|--------|----------|----------------|
| Rename to `/api/v1/queue` | ✅ Agree | — |
| "Queue" naming | ✅ Good | — |
| Router implementation | ⚠️ Too thin | Add `toQueueItem()`, response metadata, modifiers |
| Query params | ❓ Open | Add `shuffle`, `limit`, `includeWatched` |
| Response metadata | ❓ Open | Add `totalBeforeFiltering`, `filteredReasons`, `totalDuration` |
| Deprecation path | ✅ Fine | Verify all consumers first |
| Caching | ❓ Open | Skip for now, add if needed |
| Item transform | 🔴 Missing | Critical — define `toQueueItem()` or reuse `toListItem()` |

---

## Phased Implementation Plan

### Phase 0: Prep & Audit (30 min)

**Goal:** Understand current consumers, establish baseline.

1. **Grep all consumers of `/api/content/playables`** in frontend and scripts:
   ```bash
   grep -rn 'content/playables\|/playables/' frontend/src/ cli/ scripts/ _extensions/
   ```
2. **Grep for `resolvePlayables` calls** to understand adapter surface:
   ```bash
   grep -rn 'resolvePlayables' backend/src/
   ```
3. **Document current response shapes** — hit the live endpoint for a watchlist, a talk directory, and a Plex container. Save the JSON for comparison testing later.
4. **Create a branch:** `feature/queue-endpoint`

**Deliverable:** Consumer list, baseline response snapshots, clean branch.

---

### Phase 1: Define `toQueueItem()` Transform (45 min)

**Goal:** Consistent item shape for queue responses.

**File:** `backend/src/4_api/v1/routers/queue.mjs` (new)

Define a `toQueueItem()` that extracts what the player needs from a `PlayableItem`:

```javascript
export function toQueueItem(item) {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    thumbnail: item.thumbnail,
    duration: item.duration,
    // Resume state
    resumable: item.resumable,
    resumePosition: item.resumePosition,
    watchProgress: item.watchProgress,
    // Behavior flags
    shuffle: item.shuffle || false,
    continuous: item.continuous || false,
    resume: item.resume || false,
    // Hierarchy context (for "Now Playing" display)
    parentTitle: item.metadata?.parentTitle,
    grandparentTitle: item.metadata?.grandparentTitle,
    parentId: item.metadata?.parentId,
    // Index for episode display ("S3 E7")
    parentIndex: item.metadata?.parentIndex,
    itemIndex: item.metadata?.itemIndex,
  };
}
```

**Why not reuse `toListItem()`:** It computes `play`/`queue`/`list` action objects and flattens 40+ metadata fields — navigation concerns that a player doesn't need. `toQueueItem()` is intentionally narrow: "everything the player needs, nothing it doesn't."

**Test:** Unit test that `toQueueItem()` produces expected shape from a mock `PlayableItem`.

---

### Phase 2: Create Queue Router with Metadata (1 hr)

**Goal:** New router with enriched response envelope.

**File:** `backend/src/4_api/v1/routers/queue.mjs`

```javascript
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId, parseModifiers } from '../utils/actionRouteParser.mjs';

export function createQueueRouter(config) {
  const { registry, logger = console } = config;
  const router = express.Router();

  router.get('/:source/*', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = req.params[0] || '';
    const { source: resolvedSource, localId, compoundId } = parseActionRouteId({ source, path: rawPath });
    const modifiers = parseModifiers(req.query);

    // Resolve adapter (direct → prefix fallback)
    let adapter = registry.get(resolvedSource);
    let finalId = compoundId;
    if (!adapter) {
      const resolved = registry.resolveFromPrefix(resolvedSource, localId);
      if (resolved) { adapter = resolved.adapter; finalId = resolved.localId; }
    }
    if (!adapter) return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    if (!adapter.resolvePlayables) {
      return res.status(400).json({ error: 'Source does not support queue resolution', source: resolvedSource });
    }

    // Resolve playables
    const playables = await adapter.resolvePlayables(finalId);

    // Apply query-param modifiers
    let items = playables;
    if (modifiers.shuffle) {
      items = [...items];
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    }
    if (modifiers.limit && modifiers.limit > 0) {
      items = items.slice(0, modifiers.limit);
    }

    // Compute metadata
    const totalDuration = items.reduce((sum, p) => sum + (p.duration || 0), 0);

    logger.info?.('queue.resolve', {
      source: resolvedSource, localId,
      count: items.length, totalDuration
    });

    res.json({
      source: resolvedSource,
      id: compoundId,
      count: items.length,
      totalDuration,
      items: items.map(toQueueItem)
    });
  }));

  return router;
}
```

**Supported query params (Phase 2):**
| Param | Type | Default | Effect |
|-------|------|---------|--------|
| `shuffle` | boolean | false | Fisher-Yates shuffle on resolved items |
| `limit` | number | — | Cap queue to first N items |

**Deferred to Phase 4:** `includeWatched`, `filteredReasons` metadata (requires `resolvePlayables` to return pre-filter counts, which it currently doesn't).

---

### Phase 3: Register & Wire Up (15 min)

**Goal:** Mount the router, verify it works end-to-end.

1. **Register in v1 index** (`backend/src/4_api/v1/index.mjs`):
   ```javascript
   import { createQueueRouter } from './routers/queue.mjs';
   // ...
   router.use('/queue', createQueueRouter({
     registry: dependencies.contentSourceRegistry,
     logger: dependencies.logger
   }));
   ```

2. **Smoke test** against running dev server:
   ```bash
   curl -s http://localhost:3111/api/v1/queue/watchlist:cfm2025 | jq '.count, .totalDuration, (.items | length)'
   curl -s 'http://localhost:3111/api/v1/queue/watchlist:cfm2025?shuffle=true' | jq '[.items[].title]'
   curl -s 'http://localhost:3111/api/v1/queue/talk/ldsgc202510?limit=3' | jq '.count'
   ```

3. **Compare** response items against Phase 0 baseline snapshots — verify same content, new shape.

---

### Phase 4: Tests (45 min)

**File:** `backend/tests/api/v1/queue.test.mjs`

#### Unit Tests
- `toQueueItem()` produces expected shape from PlayableItem
- `toQueueItem()` handles missing optional fields gracefully
- Shuffle modifier randomizes order (statistical: run 10x, check not all identical)
- Limit modifier caps array length

#### Integration Tests
```javascript
describe('GET /api/v1/queue', () => {
  it('resolves watchlist to filtered playables with metadata', async () => {
    const res = await request(app).get('/api/v1/queue/watchlist:test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('totalDuration');
    expect(res.body.items[0]).toHaveProperty('mediaUrl');
    expect(res.body.items[0]).not.toHaveProperty('play');   // no action objects
    expect(res.body.items[0]).not.toHaveProperty('list');   // no nav fields
  });

  it('returns 400 for non-queueable source', async () => {
    const res = await request(app).get('/api/v1/queue/device:garage');
    expect(res.status).toBe(400);
  });

  it('applies shuffle modifier', async () => {
    const res = await request(app).get('/api/v1/queue/watchlist:test?shuffle=true');
    expect(res.body.items).toHaveLength(res.body.count);
  });

  it('applies limit modifier', async () => {
    const res = await request(app).get('/api/v1/queue/watchlist:test?limit=2');
    expect(res.body.items).toHaveLength(2);
  });
});
```

---

### Phase 5: Frontend Migration (1 hr)

**Goal:** Replace all `/api/content/playables` calls with `/api/v1/queue`.

1. **Find all call sites** (from Phase 0 audit).
2. **Update fetch URLs** — straightforward find/replace within each file.
3. **Update response handling** — items now come through `toQueueItem()` shape:
   - `item.mediaUrl` (unchanged)
   - `item.resumePosition` instead of `item.resumePosition` (same)
   - `item.parentTitle` / `item.grandparentTitle` now top-level (was nested in metadata)
   - No more `item.play` / `item.queue` action objects — not needed in player context
4. **Test each surface:**
   - TV app: Play All from watchlist, play from talk directory
   - Fitness kiosk: workout queue loading
   - Admin panel: queue preview (if applicable)

---

### Phase 6: Deprecation Shim (15 min)

**Goal:** Keep old endpoint alive with warning.

**File:** `backend/src/4_api/v1/routers/content.mjs`

```javascript
// Deprecation shim — redirect to /api/v1/queue
router.get('/playables/:source/*', (req, res) => {
  const newUrl = `/api/v1/queue/${req.params.source}/${req.params[0] || ''}`;
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Fri, 21 Feb 2026 00:00:00 GMT');
  res.set('Link', `<${newUrl}>; rel="successor-version"`);
  res.redirect(307, newUrl);
});
```

---

### Phase 7: Enrich `resolvePlayables` for Filter Metadata (deferred)

**Goal:** Return pre-filter counts so `/queue` can report `filteredReasons`.

This requires modifying `ListAdapter.resolvePlayables()` to return a richer object:
```javascript
// Instead of: return playableItems;
// Return: { items: playableItems, stats: { total: 12, watched: 4, held: 2, scheduled: 1 } }
```

**Defer this** until the UI actually needs "5 of 12 queued" display. It touches adapter internals and needs careful thought about the adapter contract (`resolvePlayables` currently returns a plain array across all adapters).

---

### Timeline Summary

| Phase | Task | Est. | Depends On |
|-------|------|------|------------|
| 0 | Audit & prep | 30m | — |
| 1 | `toQueueItem()` transform | 45m | Phase 0 |
| 2 | Queue router + modifiers | 1h | Phase 1 |
| 3 | Register & smoke test | 15m | Phase 2 |
| 4 | Unit + integration tests | 45m | Phase 3 |
| 5 | Frontend migration | 1h | Phase 3 |
| 6 | Deprecation shim | 15m | Phase 5 |
| 7 | Filter metadata (deferred) | — | Phase 5 proven |
| **Total** | | **~4h** | |

Phases 4 and 5 can run in parallel once Phase 3 is verified.
