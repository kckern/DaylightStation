# FeedAssemblyService Audit

**File:** `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
**Reference:** `docs/_wip/plans/2026-01-30-boonscrolling-feed-design.md`
**Date:** 2026-02-16

---

## Executive Summary

FeedAssemblyService is a working prototype that delivers real data from 11 sources. However, it is a monolith that violates nearly every DDD boundary the design document prescribes. It combines application orchestration, adapter-level HTTP calls, domain logic, data shape knowledge, and API URL construction into a single 815-line file. The current architecture cannot scale to the design's vision (engagement tracking, session management, interactive items, Nostr integration, content bridging) without a significant restructure.

**Verdict:** Functional prototype. Needs decomposition before building on top of it.

---

## DDD Layer Violations

### V1. `import { readdirSync } from 'fs'` (line 13)

Application layer directly reads the filesystem. `readdirSync` also blocks the event loop.

**Where used:** `#loadQueries()` (line 147) scans the queries directory.

**Fix:** DataService should expose a method to list query configs. Or, query configs should be loaded once at bootstrap and injected.

---

### V2. `fetch()` to Reddit JSON API (line 520)

`#fetchSubredditJSON()` makes raw HTTP calls to `reddit.com` with User-Agent headers. This is adapter-level work — the application layer should not know about Reddit's JSON API, URL format, or response shape (`p.data.stickied`, `post.created_utc`, `post.permalink`).

**Fix:** Extract to a `RedditFeedAdapter` in `1_adapters/feed/`. The adapter returns normalized domain objects; the service just orchestrates.

---

### V3. Hardcoded API routes in application layer (lines 553, 699)

```javascript
sourceIcon: `/api/v1/feed/icon?url=${encodeURIComponent(...)}`
```

The application layer constructs presentation-layer URLs. This couples 3_applications to 4_api — if the route prefix changes, this breaks. The application layer should return a domain-relevant identifier (e.g., the source URL), and the API layer or a view-model mapper should construct the proxy URL.

**Fix:** Return raw source URLs in `sourceIcon`. Let the router/frontend resolve these through the icon proxy.

---

### V4. Raw data shape knowledge spread across handlers

Each handler knows the exact YAML/lifelog data structure:

| Handler | Knows about |
|---------|-------------|
| `#fetchHealth` | `data[today]`, `data.weight.lbs`, `data.nutrition.calories` |
| `#normalizeStravaItems` | `activity.minutes`, `activity.avgHeartrate`, date-keyed vs array format |
| `#normalizeTodoistItems` | `task.content`, `task.isCompleted`, `task.due.date`, `task.priority` (Todoist's 1-4 scale) |
| `#fetchGratitude` | `entry.item.text`, dotted-filename `.yml` extension hack |
| `#fetchWeather` | `data.current.temp`, Celsius-to-Fahrenheit conversion, `data.current.code` |
| `#fetchPlex` | `item.metadata.viewCount`, `plexAdapter.getList()` API |

**Per the design:** Each of these should be a separate adapter implementing `IGroundingSource.getItems()` or `IContentSource.getUnconsumed()`, returning `FeedItem` domain objects. The service should not know what a Todoist priority number means.

---

### V5. Domain logic in application service

- `#weatherCodeToLabel()` (lines 750-761): WMO weather code mapping is domain knowledge, not orchestration.
- `#formatHealthSummary()` (lines 779-791): Formatting/presentation logic.
- `#formatFitnessSummary()` (lines 798-812): Same.
- `#extractImage()` (lines 768-772): HTML parsing (`<img>` regex) in application layer.
- Celsius-to-Fahrenheit conversion (line 341): Domain/value-object concern.

---

## Architectural Gaps vs. Design

### G1. No FeedItem entity

The design specifies a `FeedItem` domain entity with `Object.freeze()`, typed properties, and behavior methods (`isExternal`, `isGrounding`, `isInteractive`). The current code uses plain objects assembled by `#normalizeToFeedItem()`. This means:
- No validation (any shape goes)
- No frozen immutability
- No interaction support
- No `toJSON()` control

---

### G2. No FeedSession / session management

The design's `FeedSession` entity tracks `itemsServed`, `itemsConsumed`, `warningsShown`, and `durationMs`. Currently, `sessionStartedAt` is a query parameter that the frontend sends — there's no server-side session. This means:
- No deduplication across requests (same items re-served)
- No time warnings (5/10/20 minute nudges)
- No engagement-informed grounding ratio
- No "already shown" exclusion list

---

### G3. No port interfaces

The design specifies `IContentSource` and `IGroundingSource` port interfaces in `3_applications/feed/ports/`. Currently there's only `IHeadlineStore`. Each source handler is a private method of the monolith rather than an injected adapter behind a port.

**Impact:** Cannot swap implementations, cannot test sources in isolation, cannot add new sources without modifying FeedAssemblyService.

---

### G4. No engagement tracking

The design has `EngagementEvent`, `RecordEngagement` use case, and client-side `FeedEngagementTracker`. None of this exists. The feed is fire-and-forget — it has no signal about what the user actually looked at, clicked, or interacted with.

---

### G5. No interactive / input items

The design's `FeedInteraction` value object enables buttons, text input, and rating interactions on grounding items (e.g., "Did you eat breakfast?", "Still believe X?", "Mark task done"). The current implementation has no `interaction` field — all items are passive.

---

### G6. No `RespondToFeedItem` use case

Related to G5 — there's no endpoint or use case for handling user responses to feed items.

---

## Observations on Current Behavior

### O1. Headlines dominate the feed (40/50 items)

The API returns 40 headline items out of 50. Causes:
- `headlines.yml` has `limit: 30`, but `#fetchHeadlines` iterates all sources with up to 30 items *each*
- Only Al Jazeera is returning fresh data; CNN headlines have 2023 timestamps (stale RSS cache)
- The interleaving algorithm inserts 1 grounding per `ratio` external items — with 42 external items, only ~8 grounding slots exist

**Recommendation:** Cap total headline items across all sources (not per-source). Investigate CNN RSS staleness. Consider source diversity enforcement (max N items per source per batch).

---

### O2. Missing sources returning 0 items

From a live `curl`, these sources return nothing: `freshrss`, `health`, `weather`, `photos`, `plex`, `fitness`, `gratitude`. Each handler has a `try/catch` that silently returns `[]`. The `Promise.allSettled` pattern + warn logging means failures are invisible unless you check logs.

**Possible causes:**
- FreshRSS adapter may not be configured/authenticated
- Health/fitness/gratitude lifelog data may be empty or stale
- Weather data may not have been harvested
- Immich/Plex may not be reachable from this host

**Recommendation:** Add a `/feed/debug/sources` endpoint (dev-only) that reports each source's status/count without full data.

---

### O3. No source diversity enforcement

If Reddit returns 10 items from the same subreddit (e.g., r/worldnews is very active), those 10 items dominate the Reddit slot. There's no per-source or per-subreddit cap in the interleaving.

---

### O4. Plex children mode missing sourceName/sourceIcon (lines 428-445)

The `meta` object in the Plex children-mode branch doesn't include `sourceName` or `sourceIcon`, while the search-mode branch does. This means Plex albums from the music query show no source identity.

---

### O5. `#getFaviconUrl` returns null for sources without links

Grounding items (tasks, entropy, health, weather, gratitude, fitness) have `sourceIcon: null` because they don't have external links. These sources need their own icon strategy (static icons or app-specific icons).

---

## Recommendations

### R1. Decompose into adapters (high priority)

Extract each `#fetch*` handler into a separate adapter in `1_adapters/feed/`:

```
1_adapters/feed/
├── RedditFeedAdapter.mjs        (from #fetchReddit + #fetchSubredditJSON)
├── WebContentAdapter.mjs        (already exists - icon/readable)
├── FreshRSSFeedAdapter.mjs      (already exists)
├── RssHeadlineHarvester.mjs     (already exists)
├── HealthFeedAdapter.mjs        (from #fetchHealth + #formatHealthSummary)
├── WeatherFeedAdapter.mjs       (from #fetchWeather + #weatherCodeToLabel)
├── GratitudeFeedAdapter.mjs     (from #fetchGratitude)
├── StraviFeedAdapter.mjs        (from #normalizeStravaItems + #formatFitnessSummary)
├── TodoistFeedAdapter.mjs       (from #normalizeTodoistItems)
├── ImmichFeedAdapter.mjs        (from #fetchImmich)
└── PlexFeedAdapter.mjs          (from #fetchPlex)
```

Each adapter implements a common interface: `async getItems(username, params) → FeedItem[]`.

FeedAssemblyService shrinks to ~100 lines: load configs, fan out to adapters, interleave, deduplicate.

---

### R2. Create FeedItem domain entity (medium priority)

Implement the `FeedItem` class from the design doc. Adapters return `FeedItem` instances, not raw objects. This enforces validation and enables the `interaction` field for future interactive items.

---

### R3. Implement FeedSession (medium priority)

Server-side session tracking enables:
- Cross-request dedup (don't show the same headline twice)
- Time-aware grounding injection
- Time warnings (the design's gentle/moderate/urgent system)
- Engagement analytics

---

### R4. Remove API URL construction from application layer (quick fix)

Replace:
```javascript
sourceIcon: `/api/v1/feed/icon?url=${encodeURIComponent(domain)}`
```

With:
```javascript
sourceIcon: domain  // raw URL; frontend/router resolves proxy path
```

Let the API layer or frontend add the `/api/v1/feed/icon?url=` prefix.

---

### R5. Replace `readdirSync` (quick fix)

Either:
- Inject query configs at construction time (bootstrap loads them once)
- Use `DataService` to list available query configs
- At minimum, switch to `readdir` (async) to avoid blocking

---

### R6. Cap headlines per source (quick fix)

In `#fetchHeadlines`, the `query.limit` of 30 applies per-source, not total. With 3+ headline sources, this yields 90+ headline items. Apply the limit as a total cap across all sources.

---

### R7. Add source health reporting (low priority)

A debug endpoint that reports per-source status would save hours of debugging:

```json
{
  "headlines": { "status": "ok", "count": 40 },
  "freshrss": { "status": "error", "error": "401 Unauthorized" },
  "reddit": { "status": "ok", "count": 10 },
  "weather": { "status": "empty", "count": 0 },
  ...
}
```

---

## Priority Matrix

| Fix | Effort | Impact | Priority |
|-----|--------|--------|----------|
| R4. Remove API URLs from app layer | 10 min | Correctness | Now |
| R5. Replace readdirSync | 15 min | Performance | Now |
| R6. Cap headlines total | 5 min | UX | Now |
| O4. Add missing Plex sourceName | 2 min | Consistency | Now |
| R1. Decompose into adapters | 2-3 hours | Architecture | Before new features |
| R2. Create FeedItem entity | 1 hour | Correctness | Before interactive items |
| R3. Implement FeedSession | 2 hours | UX | Before time warnings |
| R7. Source health debug endpoint | 30 min | DX | When convenient |
| G4/G5/G6. Engagement + interactions | 4+ hours | Full design | Phase 2 |
