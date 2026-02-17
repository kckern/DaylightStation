# DDD Abstraction Leakage Audit — 2026-02-17

> Scope: All backend commits from the past 2 days (~60 commits), audited against `docs/reference/core/layers-of-abstraction/ddd-reference.md`.

---

## Executive Summary

**Files audited:** 50+ backend files across all DDD layers
**Compliance rate:** ~70% (most new code follows DDD patterns well)

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 4 | Merge conflicts, wrong-layer placement |
| MAJOR | 4 | Port interfaces in wrong layer, concrete service injection |
| MODERATE | 6 | Hardcoded paths, missing port interfaces, infrastructure in app layer |
| MINOR | 3 | Naming confusion, static coupling, documentation gaps |

---

## CRITICAL Violations

### C1. Unresolved Merge Conflicts (3 files)

**Files:**
- `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- `backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs`
- Several frontend files (`Scroll.jsx`, `FeedCard.jsx`, `DetailView.jsx`, etc.)

**Impact:** These files are broken — they contain `<<<<<<< HEAD` markers and cannot execute. The FeedAssemblyService conflict intermixes `FeedFilterResolver` imports with `probeImageDimensions` imports, and the tool factory has interleaved tool definitions.

**Fix:** Resolve all merge conflicts immediately before any other work.

---

### C2. SessionService in Wrong Layer

**File:** `backend/src/2_domains/fitness/services/SessionService.mjs`

**Rule violated:** Domain layer must be pure — no I/O, no infrastructure.

**Evidence:** SessionService performs persistence I/O via `sessionStore` port:
```javascript
await this.sessionStore.save(session, hid);      // line 162
const data = await this.sessionStore.findById(sanitizedId, hid);  // line 177
```

Methods like `createSession()`, `saveSession()`, `endSession()` are **use cases** (application-layer orchestration), not domain services. They load → mutate → persist, which is the classic application service pattern.

**Fix:** Move to `3_applications/fitness/services/SessionService.mjs`. The domain layer should only contain pure business logic on the `Session` entity itself.

---

### C3. ProxyService + IProxyAdapter in Wrong Layer

**Files:**
- `backend/src/0_system/proxy/ProxyService.mjs`
- `backend/src/0_system/proxy/IProxyAdapter.mjs`

**Rule violated:** `0_system` can only contain external packages and infrastructure wiring. Port interfaces belong in `3_applications/*/ports/`. Orchestration services belong in `3_applications`.

**Evidence:**
- `IProxyAdapter` is a port interface (defines `fetch()` contract) — belongs in `3_applications`
- `ProxyService` orchestrates retry logic, auth injection, and fallback handling — application-level concerns

**Fix:**
- Move `IProxyAdapter` → `3_applications/proxy/ports/IProxyAdapter.mjs`
- Move `ProxyService` → `3_applications/proxy/services/ProxyService.mjs`
- Update all imports (bootstrap, proxy adapters, routers)

---

## MAJOR Violations

### M1. Proxy Adapters Reference Port in Wrong Layer

**Files:**
- `backend/src/1_adapters/proxy/ImmichProxyAdapter.mjs`
- `backend/src/1_adapters/proxy/KomgaProxyAdapter.mjs`
- `backend/src/1_adapters/proxy/RedditImageProxyAdapter.mjs`

**Rule violated:** Adapters should extend ports from `3_applications`, not `0_system`.

**Evidence:** All three reference `IProxyAdapter` from `#system/proxy/IProxyAdapter.mjs` via JSDoc `@implements`. They don't even formally `extends` the port class.

**Fix:** After moving `IProxyAdapter` to `3_applications` (see C3), update these adapters to `extends IProxyAdapter`.

---

### M2. Feed Adapters Inject Concrete Application Services

**Files:**
- `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs`
- `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs`

**Rule violated:** Adapters can only import **port interfaces** from `3_applications`, not concrete services.

**Evidence:** Both inject and call `contentQueryService` (a concrete application service) and use `contentRegistry` as an adapter factory:
```javascript
this.#contentQueryService = contentQueryService;  // concrete service
this.#contentRegistry?.get('immich')              // adapter factory lookup
await plexAdapter.getList(...)                     // direct adapter call
```

**Fix:** Create `IContentQueryPort` in `3_applications/feed/ports/` with only the methods these adapters need (`search()`). Inject port, not concrete service.

---

### M3. Infrastructure Concern in FeedAssemblyService

**File:** `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Rule violated:** Application services should not perform infrastructure operations.

**Evidence:** (In the merge-conflict branch) imports `probeImageDimensions` from `#system/utils/` and calls it directly to make HTTP requests for image dimension detection:
```javascript
const dims = await probeImageDimensions(item.image);
```

**Fix:** Move image probing to the relevant feed source adapters (they already have access to images), or create an `IImageProber` port.

---

### M4. Missing Port Interface for DismissedItemsStore

**File:** `backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs`

**Rule violated:** Adapters should implement port interfaces.

**Evidence:** This adapter has no corresponding port interface. It's injected directly into `FeedPoolManager` and the feed router without any contract definition. Methods `load()`, `add()`, `clearCache()` are undocumented.

**Fix:** Create `IDismissedItemsStore` in `3_applications/feed/ports/` and have the adapter extend it.

---

## MODERATE Violations

### Mo1. Hardcoded Path Constants in Application Services

**Files:**
- `backend/src/3_applications/feed/services/HeadlineService.mjs` — `const FEED_CONFIG_PATH = 'config/feed'`
- `backend/src/3_applications/feed/services/FeedCacheService.mjs` — `const CACHE_PATH = 'current/feed/_cache'`

**Rule violated:** Application services should receive values, not know where data lives.

**Fix:** Inject paths as configuration, or abstract behind repository ports.

---

### Mo2. Config Schema Knowledge in HeadlineService

**File:** `backend/src/3_applications/feed/services/HeadlineService.mjs`

**Evidence:** Deep config shape knowledge:
```javascript
const retentionHours = config.headlines?.retention_hours || 48;
const maxPerSource = headlineConfig.max_per_source || 10;
const dedupeWordCount = headlineConfig.dedupe_word_count || 8;
```

**Fix:** Receive pre-resolved `HeadlineServiceConfig` from bootstrap.

---

### Mo3. FeedCacheService Manages I/O Patterns

**File:** `backend/src/3_applications/feed/services/FeedCacheService.mjs`

**Evidence:** Manages debounced disk flushing, TTL logic, stale-while-revalidate — all persistence infrastructure patterns.

**Fix:** Extract to `ICacheRepository` port. Cache service becomes business logic orchestrator only.

---

### Mo4. FeedPoolManager Special-Cases Built-in Sources

**File:** `backend/src/3_applications/feed/services/FeedPoolManager.mjs`

**Evidence:** Switch statement dispatching `freshrss`, `headlines`, `entropy` as special cases:
```javascript
switch (query.type) {
  case 'freshrss': return this.#fetchFreshRSSPage(...);
  case 'headlines': return this.#fetchHeadlinesPage(...);
  case 'entropy':   return { items: await this.#fetchEntropy(...) };
```

**Fix:** Register these as standard adapters implementing `IFeedSourceAdapter`.fetchPage()`.

---

### Mo5. Proxy Router Contains Adapter Logic

**File:** `backend/src/4_api/v1/routers/proxy.mjs`

**Evidence:** Direct HTTP proxying with credential access, file streaming with `fs.statSync`/`createReadStream`, and Komga-specific URL building — all in the router.

**Fix:** Delegate to ProxyService (once moved to application layer) for consistent external service proxying.

---

### Mo6. CanvasService Name Collision

**Files:**
- `backend/src/0_system/canvas/CanvasService.mjs` (low-level wrapper)
- `backend/src/3_applications/canvas/services/CanvasService.mjs` (orchestration)

**Fix:** Rename `0_system` version to `CanvasRenderer.mjs` to clarify purpose.

---

## MINOR Violations

### Mi1. Headline Entity Mutability

**File:** `backend/src/2_domains/feed/entities/Headline.mjs`

Properties like `this.title`, `this.link` are writable after construction. Entity fields should use private properties with getters for controlled access.

---

### Mi2. FeedAssemblyService Static Method Coupling

Tight coupling to `ScrollConfigLoader.extractColors()` static method. If color logic changes, assembly service changes too.

---

### Mi3. Missing Optional Dependency Documentation

`FeedPoolManager` accepts `dismissedItemsStore = null` without documenting the port contract. Same for `feedContentService` in `FeedAssemblyService`.

---

## Compliant Patterns (Preserve These)

These files from the past 2 days demonstrate **excellent DDD adherence** and should be used as templates:

| File | Why It's Good |
|------|---------------|
| `FeedContentService.mjs` | Perfect port/adapter pattern — validates gateway, delegates all I/O |
| `FeedFilterResolver.mjs` | Zero imports, pure function service |
| `SpacingEnforcer.mjs` | Zero imports, pure business logic |
| `TierAssemblyService.mjs` | Clean orchestration with optional port injection |
| `ScrollConfigLoader.mjs` | Proper DI, no infrastructure concerns |
| `Headline.mjs` (entity) | Pure domain, factory method, no I/O |
| `PagedMediaTocAgent.mjs` | Uses ports only, no concrete adapters |
| `IFeedSourceAdapter.mjs` (port) | Clean port interface in correct layer |
| `YamlHeadlineCacheStore.mjs` | Properly extends `IHeadlineStore` port |
| `YamlSelectionTrackingStore.mjs` | Properly extends `ISelectionTrackingStore` port |

---

## Priority Action Plan

### Immediate (Blocking)
1. **Resolve all merge conflicts** — FeedAssemblyService, PagedMediaTocToolFactory, frontend files
2. **Move SessionService** from `2_domains` → `3_applications`

### High Priority
3. **Move IProxyAdapter + ProxyService** from `0_system` → `3_applications`
4. **Create IDismissedItemsStore** port interface
5. **Create IContentQueryPort** for ImmichFeedAdapter/PlexFeedAdapter
6. **Extract probeImageDimensions** from FeedAssemblyService to adapters

### Medium Priority
7. **Inject config paths** instead of hardcoding in HeadlineService/FeedCacheService
8. **Extract cache I/O patterns** from FeedCacheService to ICacheRepository
9. **Register built-in sources** (freshrss, headlines, entropy) as standard adapters
10. **Rename 0_system CanvasService** → CanvasRenderer

### Low Priority
11. Improve Headline entity immutability
12. Document optional dependencies as explicit ports
13. Delegate proxy router logic to ProxyService
