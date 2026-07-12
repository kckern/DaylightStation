# Feed Frontend and Backend Full Audit

**Date:** 2026-07-11  
**Status:** Static code audit complete; **containment + concrete-bug remediation shipped 2026-07-11** (see "Remediation Status" below); large architectural items (cursor/session, one media session, virtualization, product loop) remain as sequenced Phase-1..5 work.  
**Primary scope:** `frontend/src/Apps/FeedApp.jsx`, `frontend/src/modules/Feed/**`  
**Related scope:** Feed API router, assembly/pool/cache/content services, source adapters, dismissal persistence, FreshRSS/headline services, PWA assets, and feed tests  
**Baseline:** local `HEAD`/`origin/main` at `0a19e1e0d`; the deployed branch has no changes in the audited Feed paths

## Executive Summary

The Feed is a feature-rich prototype, but it is not yet a reliable multi-user product. The primary Scroll experience combines a custom server-side feed allocator, mutable in-memory pagination, several independent media players, custom masonry, destructive read/dismiss behavior, and aggressive diagnostics. The result is a system with substantial behavior but weak guarantees around identity, page continuity, failure recovery, accessibility, and data safety.

The highest-risk findings are:

1. **Authenticated identity is ignored.** Every Feed endpoint uses the configured head of household. User-scoped caches are also global, and deep-link items are cached without a user key. Any account allowed to access Feed can receive or mutate the head-of-household feed state.
2. **Externally supplied HTML can execute in the app origin.** Reader renders FreshRSS HTML without sanitization. The readable-content sanitizer also decodes escaped markup after its tag filter, which can recreate dangerous elements and event-handler attributes.
3. **The image/readable/detail fetch paths expose server-side URL fetching without SSRF or response-size protection.** An authorized Feed client can make the server request internal or very large resources.
4. **Scroll pagination is not cursor pagination.** The cursor value is ignored; its mere presence tells a singleton, mutable pool not to reset. Fresh loads from another tab reset that pool. Filtered feeds repeatedly select seen items, and exhausted feeds intentionally recycle history forever.
5. **Dismissal is both unreliable and destructive.** Most adapters inherit a no-op `markRead`, but the router interprets that inherited method as real support and reports a successful dismiss. The frontend has no undo or delivery guarantee, auto-dismisses before detail succeeds, and crashes when non-wire cards invoke the callback wrapper.
6. **Media playback is split across incompatible systems.** Persistent playback, inline YouTube playback, Reader playback, visibility, sheet controls, volume, and resume state do not share one media session or one player handle.
7. **The UI has no coherent error or cancellation model.** Stale requests can overwrite new filters/details, initial Scroll errors can cause repeated sentinel retries, and most errors become an empty state or disappear into logs.
8. **The default route hides the only app navigation.** `/feed` redirects to Scroll, and Scroll hides the tabs that lead to Reader and Headlines. Those features are effectively undiscoverable without direct URLs or installed PWA shortcuts.

**Verdict:** The Feed should be treated as an internal alpha. Security/data-isolation and state-contract work should precede new Feed features. The existing architecture can be salvaged, but the current cursor, cache, dismissal, and player contracts should be replaced rather than patched incrementally.

## Audit Method

- Read all 55 files under `frontend/src/modules/Feed` plus `FeedApp.jsx` and Feed PWA assets.
- Traced every Feed frontend API call through `backend/src/4_api/v1/routers/feed.mjs` into application services, persistence, and source adapters.
- Compared the implementation with the original boonscrolling design and previous Feed audits.
- Checked repository and deployed-branch freshness before analysis.
- Ran targeted frontend ESLint.
- Ran the isolated test harness with the `feed` pattern.
- Did not run live Feed flows because several tests and ordinary detail interactions mutate real FreshRSS read state and household dismissal state.

## Verification Results

### Frontend lint

The targeted command fails with **11 errors and 17 warnings**:

```text
npx eslint src/Apps/FeedApp.jsx src/modules/Feed --ext js,jsx --report-unused-disable-directives
```

Notable failures include a conditional hook in `FeedPlayerMiniBar`, illegal reassignment of `tick` in `usePerfMonitor`, dead state/props, and numerous incomplete hook dependencies.

### Isolated tests

The isolated harness found 30 backend Feed suites. Nine loaded and passed 137 assertions; 21 failed during initialization with:

```text
TypeError: Cannot redefine property: Symbol($$jest-matchers-object)
```

The failure is a Jest/Vitest matcher collision in the harness, not a Feed assertion failure. It means most relevant tests currently cannot provide a usable regression signal through the documented harness.

### Production build

`npm run build` in `frontend/` succeeds. It emits existing Sass, unresolved runtime asset, mixed static/dynamic import, and oversized-chunk warnings. The resulting app-wide main JavaScript chunk is 8.14 MB minified (2.30 MB gzip), and the main CSS chunk is 1.05 MB (165 KB gzip). This is not caused by Feed alone, but Feed is statically imported by `main.jsx`, and `FeedApp` statically imports all three Feed modes and player surfaces.

### Coverage character

There are eight live Feed flow files, but no component tests under `frontend/src/modules/Feed`. Existing live flows emphasize happy-path rendering, Plex playback, and the presence of additional cards. They do not cover the security boundary, request races, multi-tab pagination, dismiss persistence, accessibility, invalid deep links, offline behavior, volume/resume, or error recovery.

## System Map

```text
FeedApp
  +-- Reader --------> /reader/* --------> FreshRSSFeedAdapter
  +-- Headlines -----> /headlines/* -----> HeadlineService -> RSS/article fetches
  +-- Scroll --------> /scroll ----------> FeedAssemblyService
  |                                         +-- FeedPoolManager
  |                                         |    +-- FeedCacheService
  |                                         |    +-- 18 source adapters
  |                                         +-- TierAssemblyService
  |                                         +-- in-memory item cache
  +-- Detail --------> /detail/* or /scroll/item/*
  +-- Media ---------> local FeedPlayer OR hidden global Player
  +-- Dismiss -------> adapter.markRead() OR YamlDismissedItemsStore
```

The three top-level experiences have separate visual languages, state semantics, and content models. Reader treats opening as read; Scroll treats some detail opens as dismiss; Headlines always opens external links. There is no shared definition of viewed, read, dismissed, saved, or completed.

## Severity Model

| Level | Meaning |
|---|---|
| P0 | Security/privacy exposure or release blocker with potentially severe impact |
| P1 | Core user journey can fail, corrupt state, or behave unpredictably |
| P2 | Significant quality, performance, accessibility, or maintainability problem |
| P3 | Localized defect, cleanup, or low-impact inconsistency |

## Findings Summary

| ID | Severity | Finding |
|---|---:|---|
| F-01 | P0 | Feed ignores authenticated identity and shares private state |
| F-02 | P0 | External HTML has two XSS paths |
| F-03 | P0 | Server-side URL fetches lack SSRF and resource controls |
| F-04 | P1 | Scroll cursor is ignored and pagination state is shared/mutable |
| F-05 | P1 | Filter pagination repeats seen items; normal exhaustion recycles forever |
| F-06 | P1 | Feed cache loses cursors, crosses users, and hides source failures |
| F-07 | P1 | Backend dismissal falsely reports success for no-op adapters |
| F-08 | P1 | Frontend dismissal can throw, lose actions, and leave invisible cards |
| F-09 | P1 | Detail requests leak/trust full client metadata; deep links are ephemeral |
| F-10 | P1 | Media playback has multiple conflicting sources of truth |
| F-11 | P1 | Request races and missing error states produce stale or blank UI |
| F-12 | P1 | Default Scroll route removes navigation to other Feed modes |
| F-13 | P1 | Image loading eagerly downloads/probes far more than is visible |
| F-14 | P1 | Core interactions are inaccessible and gestures conflict |
| F-15 | P2 | Reader filtering/read semantics are surprising and incomplete |
| F-16 | P2 | Headlines refresh/navigation behavior is slow and error-blind |
| F-17 | P2 | Feed item/source contracts are inconsistent and unvalidated |
| F-18 | P2 | Infinite DOM, observers, render loops, and logging add avoidable load |
| F-19 | P2 | The Feed PWA is installability theater, not an offline/resilient PWA |
| F-20 | P2 | Original wellbeing/session product requirements remain absent |
| F-21 | P2 | API inputs and errors are insufficiently validated or bounded |
| F-22 | P2 | Random IDs/timestamps and unstable shuffles break continuity |
| F-23 | P2 | Detail iframe/link handling is unreliable and under-protected |
| F-24 | P2 | Visual design has readability, mobile viewport, and motion failures |
| F-25 | P2 | Production ships an internal assembly debugger and internal metadata |
| F-26 | P2 | Adapter fan-out and per-item enrichment make cold latency unpredictable |
| F-27 | P2 | Headline/source pagination is unstable or prematurely exhausted |
| F-28 | P2 | Test and lint gates do not protect the Feed |
| F-29 | P3 | Configuration-driven colors/focus and other code paths are dead |
| F-30 | P3 | Repeated formatting/rendering logic increases drift |

## Detailed Findings

### F-01: Feed ignores authenticated identity and shares private state

**Severity:** P0  
**Areas:** privacy, authorization, multi-user correctness

**Evidence**

- `backend/src/4_api/v1/routers/feed.mjs:38-40` defines `getUsername()` without a request and always returns `configService.getHeadOfHousehold()` or `default`.
- Every Reader, Headlines, Scroll, Detail, and Dismiss route uses that helper.
- The application already populates `req.user` in `tokenResolver`; other routers derive a request-scoped user.
- `FeedCacheService` has one `#cache` and one `#hydrated` flag for all users (`FeedCacheService.mjs:45-53, 110-123`). Cache keys omit username.
- `FeedPoolManager.#firstPageCursors` is keyed only by source key (`FeedPoolManager.mjs:52-53`).
- `FeedAssemblyService.#itemCache` is keyed only by item ID (`FeedAssemblyService.mjs:30-32, 266-280`). Journal IDs are date-based and therefore collide across users.
- Dismissals are explicitly household-shared (`YamlDismissedItemsStore.mjs:8-16`).

**Impact**

- A non-head account with Feed permission receives the head user's FreshRSS subscriptions, journal, health, tasks, and other personalized sources.
- Read/dismiss actions mutate the wrong person's upstream state.
- If request-scoped usernames are added only at the router, the current cache/item designs will still leak or overwrite data across users.
- One user's fresh load or filter changes affect another user's pool.

**Remediation**

1. Define a single `resolveUsername(req)` using the authenticated subject/profile mapping, with an explicit guest/LAN policy.
2. Pass a request-scoped principal into all use cases; do not resolve identity in repositories or global services.
3. Namespace pool, cursor, item, cache, selection, and dismissal keys by household and user.
4. Decide explicitly whether dismissal is personal or household-wide. Default to personal; offer a separate household action if needed.
5. Add two-user isolation tests for every read and mutation route before enabling Feed for multiple accounts.

### F-02: External HTML has two XSS paths

**Severity:** P0  
**Areas:** security, content rendering

**Evidence**

- `Reader/ArticleRow.jsx:114-118` renders `article.content` with `dangerouslySetInnerHTML`.
- That value comes directly from FreshRSS item summaries in `FreshRSSFeedAdapter.mjs:99-109`; the Reader route does not sanitize it.
- `ArticleSection.jsx:3-7` also uses `dangerouslySetInnerHTML` for extracted content.
- `WebContentAdapter.#cleanExtractedHtml` and `#parseHtml` strip attributes/tags, then decode `&lt;`, `&gt;`, and quotes afterward (`WebContentAdapter.mjs:285-317, 337-390`). Encoded dangerous markup can therefore be recreated after the allowlist pass. Event-handler payloads are the practical risk even where script elements inserted via `innerHTML` do not execute.
- The sanitizer is regex-based and has no adversarial tests.

**Impact**

An attacker controlling an RSS item or article page can run markup in the DaylightStation origin, access same-origin APIs available to the user, manipulate the UI, or exfiltrate locally stored tokens.

**Remediation**

1. Stop rendering FreshRSS HTML until it is sanitized.
2. Use a maintained allowlist sanitizer with URL-scheme enforcement. Sanitize once on the server and optionally defend again in the client.
3. Decode entities before parsing/sanitizing, never after the final allowlist.
4. Prefer a parsed rich-content AST or sanitized Markdown/React nodes over raw HTML strings.
5. Add payload tests for encoded tags, event attributes, malformed nesting, SVG/MathML, `javascript:` URLs, CSS URLs, and entity obfuscation.
6. Add a restrictive Content Security Policy as defense in depth, not as the primary fix.

### F-03: Server-side URL fetches lack SSRF and resource controls

**Severity:** P0  
**Areas:** security, availability

**Evidence**

- `/feed/image?url=...` passes the client URL to `proxyImage` (`feed.mjs:403-418`; `WebContentAdapter.mjs:192-217`).
- `/feed/readable?url=...` and generic detail fallback fetch arbitrary client-provided links (`feed.mjs:350-373, 425-442`; `FeedAssemblyService.mjs:245-253`).
- `HttpClient` performs ordinary `fetch` with redirects and no destination validation (`HttpClient.mjs:141-170`).
- There is no protocol allowlist, DNS/IP check, redirect revalidation, private-network block, download byte limit, or upstream content-type limit.
- `requestRaw(..., responseType: 'buffer')` reads the complete body into memory.
- The first article-extractor attempt is not wrapped in the adapter's eight-second `READABLE_TIMEOUT`.

**Impact**

An authorized Feed caller can probe internal services/cloud metadata, make requests using the server's network position, or force large downloads and long-lived extraction work. Public cache headers can further amplify proxy behavior.

**Remediation**

1. Introduce a hardened outbound-fetch policy: `http/https` only, resolved-IP private/link-local/loopback denylist, redirect revalidation, port policy, and DNS rebinding protection.
2. Permit known content hosts where possible rather than arbitrary origins.
3. Stream with strict byte, time, redirect, and content-type limits; abort upstream work on limit/timeout.
4. Rate-limit proxy/extraction routes and bound concurrent work per user/host.
5. Do not accept `link`/`meta` from the client for known items; resolve trusted metadata by item ID.
6. Add SSRF tests covering IPv4, IPv6, decimal/hex IP forms, redirects, DNS changes, credentials in URLs, and non-HTTP protocols.

### F-04: Scroll cursor is ignored and pagination state is shared/mutable

**Severity:** P1  
**Areas:** pagination, concurrency, correctness

**Evidence**

- The frontend sends the last item ID as `cursor` (`Scroll.jsx:177-188`).
- `FeedAssemblyService.getNextBatch` checks only whether `cursor` is truthy; it never locates or validates that ID (`FeedAssemblyService.mjs:103-123`).
- The documented assembled-list cursor cache exists but is unused (`FeedAssemblyService.mjs:34-36`).
- A request without a cursor calls `FeedPoolManager.reset(username)` and destroys all mutable state for that username (`FeedAssemblyService.mjs:117-120`; `FeedPoolManager.mjs:185-200`).
- The singleton pool's seen IDs, source cursors, batch count, and recycle history are then mutated by each response.
- Frontend IntersectionObserver callbacks can issue overlapping requests before React commits `loadingMore`.

**Impact**

- A reload or second tab resets the first tab's pagination.
- Retried, reordered, or duplicate HTTP requests consume different server items.
- Browser back/forward and network replay are not deterministic.
- A cursor from another filter/session is accepted.
- Horizontal scaling would give different page results depending on which process handles a request.

**Remediation**

Replace the implicit process session with one of these explicit contracts:

1. **Preferred:** an opaque, signed cursor containing a feed-session ID, config/filter version, stable ordering seed, and position. Store a bounded session snapshot keyed by user/session.
2. **Alternative:** stateless keyset pagination over a stable ranked snapshot that can be reconstructed from cursor fields.

In both designs, make repeated requests idempotent, reject cursor/filter mismatches, serialize or version state transitions, and keep tabs isolated by session ID.

### F-05: Filter pagination repeats seen items; normal exhaustion recycles forever

**Severity:** P1  
**Areas:** infinite scroll, filters, user trust

**Evidence**

- `FeedPoolManager.getPool` returns both seen and unseen items and only tags `_seen` (`FeedPoolManager.mjs:107-130`).
- Tier assembly explicitly prefers unseen items, but both source-filter paths bypass tier assembly and sort/slice without `_seen` handling (`FeedAssemblyService.mjs:130-145, 287-331`).
- A filtered second page can therefore return the same newest items. The client detects all duplicates and declares the feed ended (`Scroll.jsx:204-216`).
- `FeedPoolManager.hasMore` returns true whenever any seen history exists (`FeedPoolManager.mjs:178-183`).
- When sources are exhausted, `#recycle` shuffles seen history back into the pool (`FeedPoolManager.mjs:395-415`).
- Assembly can also clone items with synthetic `:dupN` IDs to fill short batches (`FeedAssemblyService.mjs:176-185`).

**Impact**

- `?filter=plex`, source filters, and query filters commonly stop after one useful page.
- The unfiltered feed has no truthful end and silently repeats consumed content.
- Synthetic duplicate IDs weaken detail lookup, dedupe, dismiss, and analytics.
- The product cannot distinguish "more upstream data exists" from "we can replay old content."

**Remediation**

1. Filter unseen items in every path before selecting a page.
2. Return explicit state: `hasMoreFresh`, `hasMoreUpstream`, and optionally `replayAvailable`.
3. Remove synthetic duplicate items. A short batch is valid.
4. If replay is a product feature, make it an explicit user action/section with original stable IDs and a "seen before" label.
5. Test filtered pagination through exhaustion with stable non-overlapping page assertions.

### F-06: Feed cache loses cursors, crosses users, and hides source failures

**Severity:** P1  
**Areas:** cache, reliability, observability

**Evidence**

- `FeedCacheService` stores only `{items, fetchedAt}`, not the adapter cursor (`FeedCacheService.mjs:45-46, 188-198`).
- `FeedPoolManager` keeps first-page cursors in a process-only map. On a disk cache hit after restart, the cursor defaults to `null`, making the source appear exhausted (`FeedPoolManager.mjs:268-280`).
- Cache entries are keyed by source/query key but not username, household, query parameters, or config version.
- Only the first user to access the service is hydrated because `#hydrated` is global.
- A debounced flush captures one username while writing the entire global cache (`FeedCacheService.mjs:170-198`).
- Fetch failures return stale data or `[]` rather than a status/error (`FeedCacheService.mjs:138-156`). Most adapters also catch errors and return empty arrays.
- Cached arrays are returned by reference and later mutated with `_seen`, query names, and dimensions.
- The `nocache` API option is parsed but ignored by normal assembly (`feed.mjs:249-258`; `FeedAssemblyService.mjs:103-123`).

**Impact**

- Pagination depth disappears after restart or cache hydration.
- User/query data can be served or persisted under the wrong user.
- Empty success responses hide total source outages from both user and API caller.
- Config changes can continue serving old results under the same key.

**Remediation**

1. Cache an immutable `SourcePage` value: items, next cursor, fetched time, query/config fingerprint, status, and source version.
2. Namespace all keys by household/user/query fingerprint.
3. Hydrate per namespace and flush only that namespace atomically.
4. Clone/freeze cached objects rather than mutating cache values.
5. Return partial-failure metadata from pool assembly so the UI can show stale/degraded sources.
6. Make `nocache` real or remove it.

### F-07: Backend dismissal falsely reports success for no-op adapters

**Severity:** P1  
**Areas:** data mutation, API contract

**Evidence**

- `IFeedSourceAdapter` supplies an inherited no-op `markRead` method (`IFeedSourceAdapter.mjs:70-77`).
- The router registers every adapter for which `typeof adapter.markRead === 'function'`, which includes inherited no-ops (`feed.mjs:29-35`).
- Reddit, Google News, YouTube, and most other adapter-prefixed IDs are sent to a no-op instead of `YamlDismissedItemsStore`.
- Adapter errors are caught and converted into warnings; the endpoint still returns `{dismissed: requestedCount}` (`feed.mjs:328-343`).
- There are no dismiss route tests.

**Impact**

The UI tells users an item is gone, but it reappears after refresh. API success does not mean any source accepted or persisted the mutation.

**Remediation**

1. Replace inherited capability detection with an explicit capability declaration such as `capabilities.markRead = true` or a distinct `IMarkReadPort`.
2. Route unsupported sources to the personal dismissed-item repository.
3. Return per-item outcomes and a non-2xx/partial status when persistence fails.
4. Make batch writes atomic and idempotent.
5. Add API contract tests for FreshRSS, a fallback-store source, an unsupported source, and upstream failure.

### F-08: Frontend dismissal can throw, lose actions, and leave invisible cards

**Severity:** P1  
**Areas:** destructive UX, touch behavior

**Evidence**

- `Scroll` intends to pass `handleDismiss` only for wire items (`Scroll.jsx:537-548`).
- `ScrollCard` always wraps that possibly undefined prop in a new function and passes the wrapper to `FeedCard` (`Scroll.jsx:102-104`). As a result, every card renders dismissal UI and non-wire dismissal calls `undefined`.
- The touch handler similarly calls `onDismiss(...)` without checking it (`Scroll.jsx:64-75`).
- Mobile hides all buttons and relies on an undisclosed swipe gesture (`Scroll.scss:43-50`).
- Card/gallery/detail swipe handlers overlap; a long gallery swipe can also dismiss a card, and a detail-gallery swipe can navigate the feed.
- Desktop dismiss animates opacity but intentionally does not remove or disable the element (`Scroll.jsx:490-496`). It remains an invisible pointer target and masonry hole.
- Dismiss calls are buffered for 500 ms with no unmount/pagehide flush, retry queue, rollback, or undo (`Scroll.jsx:307-326`).
- Opening wire detail queues dismissal before detail has loaded successfully (`Scroll.jsx:328-367`).

**Impact**

- Non-wire dismiss interactions throw runtime errors.
- Accidental or failed detail opens permanently mark FreshRSS items read.
- Mobile users cannot discover or undo the destructive gesture.
- Failed requests leave the UI and server inconsistent.

**Remediation**

1. Pass `onDismiss` through only when it exists and guard every invocation.
2. Separate `mark read`, `dismiss/not interested`, and `complete` semantics.
3. Use an optimistic mutation with a visible Undo window, durable retry, and rollback on terminal failure.
4. Do not mark read/dismiss until content is meaningfully viewed, or make the behavior configurable.
5. Remove cards consistently on all breakpoints and reflow masonry; set pointer-events off during exit.
6. Use pointer events with gesture arbitration and `touch-action` rules so gallery, scroll, seek, and dismiss cannot all claim the same gesture.

### F-09: Detail requests leak/trust full client metadata; deep links are ephemeral

**Severity:** P1  
**Areas:** privacy, API design, deep linking

**Evidence**

- In-batch detail serializes the complete item `meta` object and link into the query string (`Scroll.jsx:350-356`). Reader and inline YouTube do the same.
- Journal `meta.fullConversation` contains a full day's private conversation (`JournalFeedAdapter.mjs:46-74`). It is therefore placed in request URLs, access logs, browser/network diagnostics, and error messages.
- `/detail/:feedItemId` trusts client-supplied `meta` and `link` (`feed.mjs:350-363`).
- The safer-looking deep-link route works only if the item remains in a process-local 500-item cache (`FeedAssemblyService.mjs:30-32, 266-280`). It has no durable lookup, user key, or reconstruction path.
- Invalid frontend base64 slugs can leave mobile on a blank hidden-list view; cold-cache 404s silently redirect to the feed root (`Scroll.jsx:164-170, 369-394, 535`).
- `btoa`/`atob` are applied directly to JavaScript strings and do not safely round-trip Unicode IDs (`Scroll.jsx:16-25`).

**Impact**

- Private content is duplicated into URLs and logs.
- Clients can tamper with detail metadata instead of the server being authoritative.
- Shared links fail after process restart/eviction or before the item has been served once.
- Non-ASCII/fallback IDs can throw or decode incorrectly.

**Remediation**

1. Make detail `GET /items/:opaqueId` resolve all trusted data server-side.
2. Store a durable or reconstructable item reference containing source type and stable local ID, scoped to the user.
3. Keep large/private detail bodies out of list DTOs and all URLs.
4. Use a standard UTF-8 base64url library or opaque server-issued ID.
5. Return explicit invalid/expired/not-authorized states with recovery actions rather than redirecting silently.

### F-10: Media playback has multiple conflicting sources of truth

**Severity:** P1  
**Areas:** playback, state management

**Evidence**

- Plex/readalong/other player sections set `activeMedia` and mount a hidden shared `Player` via `PersistentPlayer`.
- YouTube cards and detail views mount independent `FeedPlayer` instances and often do not call the global `play` action (`FeedCard.jsx:291-301, 542-612`; `DetailView.jsx:270-368`).
- Reader YouTube calls global `play` without a content ID while also mounting a local player (`ArticleRow.jsx:143-168, 197-208`). This creates global active state with no persistent player.
- `registerPlayerEl` supports only one observed local player. Mounting another disconnects the previous observer (`FeedPlayerContext.jsx:194-217`).
- Two `usePlaybackObserver` instances poll the same hidden player in `FeedLayout` and `Scroll`, each with a 500 ms interval and continuous animation frame loop.
- Sheet volume changes context state, but `PersistentPlayer` never applies that volume/mute to the hidden `Player`. Only speed is synchronized by `usePlaybackObserver`.
- `pausedMedia.position` is captured but never restored when resuming (`FeedPlayerContext.jsx:63-101`; `PersistentPlayer.jsx:6-36`).
- Multiple expanded/inline YouTube players can continue simultaneously; reducer state does not pause their local media elements.
- `FeedPlayer` calls React state setters on every animation frame (`FeedPlayer.jsx:135-151`).

**Impact**

- Mini/sheet controls can target no player or the wrong player.
- Volume and resume controls lie for persistent media.
- Closing/collapsing Reader content can leave phantom active media.
- Multiple videos can play at once, and direct playback causes unnecessary 60 fps React rendering.

**Remediation**

1. Create one `FeedMediaSession` with one player engine/imperative handle and an explicit state machine (`idle`, `resolving`, `playing`, `paused`, `error`).
2. Route all sources, including YouTube, through that session; inline surfaces become views/portals of the same media element or session.
3. Keep current item, resolved streams, position, volume, muted, speed, visibility surfaces, and error in one store.
4. Restore saved positions on source switches and clear stale paused entries deterministically.
5. Subscribe to media events rather than polling in two hooks or setting React state every frame.
6. Add cross-surface tests: start in card, open detail, scroll away, open sheet, switch item, resume previous, change volume, end, and recover from stream failure.

### F-11: Request races and missing error states produce stale or blank UI

**Severity:** P1  
**Areas:** async state, recovery

**Evidence**

- Scroll, detail, Reader, Reader YouTube, Headlines, and page-list requests have no AbortController, request generation, or stale-response guard.
- A slower old detail request can overwrite sections for a newly selected item (`Scroll.jsx:328-395`).
- Reader filter changes can resolve out of order and replace the active filter's articles (`Reader.jsx:167-199`).
- Scroll's initial effect intentionally omits `fetchItems`; changing `?filter=` on the same mounted route does not reset/refetch the list (`Scroll.jsx:172-231`).
- Scroll catches errors but has no `error` state. `hasMore` remains true, leaving the sentinel visible; observer recreation can repeatedly retry an outage (`Scroll.jsx:222-249, 551-575`).
- Detail errors become empty sections or silent redirects. Headlines errors retain stale data or show an indefinite empty rendering. Actions report nothing to the user.
- Reader's first error is sticky and never cleared; it replaces the entire UI with a non-actionable placeholder (`Reader.jsx:152, 157-194, 281`).

**Impact**

Users see the wrong detail, mixed filter results, blank screens, request storms, or "nothing here" when dependencies are unavailable.

**Remediation**

1. Introduce query-state hooks with abort, stable keys, dedupe, retry policy, and stale response rejection.
2. Model `idle/loading/success/empty/error/refreshing/degraded` separately.
3. Reset pagination on filter identity change and keep previous data only when explicitly desired.
4. Add retry buttons, partial-source warnings, and error boundaries around cards/detail/player.
5. Use an in-flight ref/mutex for infinite loading; never rely solely on asynchronously committed React state.

### F-12: Default Scroll route removes navigation to other Feed modes

**Severity:** P1  
**Areas:** information architecture, discoverability

**Evidence**

- `/feed` redirects to `/feed/scroll` (`FeedApp.jsx:152-160`).
- `FeedLayout` hides `.feed-tabs` whenever the path starts with `/feed/scroll` (`FeedApp.jsx:71-73, 100-120`).
- Scroll contains no route to Reader or Headlines.

**Impact**

Most users land in Scroll and cannot discover or navigate to two thirds of the Feed app. Direct URLs/PWA shortcuts are not an adequate primary navigation model.

**Remediation**

Keep a compact persistent app switcher in Scroll, or add an obvious menu/back affordance. Preserve immersive scrolling by collapsing the navigation on downward scroll rather than deleting it. Include unread/new indicators and make the current mode clear.

### F-13: Image loading eagerly downloads/probes far more than is visible

**Severity:** P1  
**Areas:** performance, bandwidth, privacy

**Evidence**

- `HeroImage` does not set `loading="lazy"` or gate work by viewport.
- When a thumbnail exists, every mounted card creates `new Image()` and immediately preloads the full image (`FeedCard.jsx:45-76`).
- The infinite list never removes old cards, so deep scrolling continually grows image work.
- Headlines tooltip images are mounted even though tooltips are CSS-hidden, causing offscreen preview downloads.
- Backend assembly probes missing dimensions for every selected image, waiting for all probes (`FeedAssemblyService.mjs:188-190, 334-349`).
- Plex and Goodreads perform per-item image downloads for dimensions; Immich performs per-item metadata lookups (`PlexFeedAdapter.mjs:141-166, 182-193`; `GoodreadsFeedAdapter.mjs:30-57`; `ImmichFeedAdapter.mjs:170-194`).
- Headline adapter probes each page image again (`HeadlineFeedAdapter.mjs:108-119`).
- Direct remote image URLs expose the browser/user network to third-party hosts; the proxy is only a failure fallback.

**Impact**

Cold feed assembly waits on image hosts, the client downloads full media well below the viewport, data usage grows without bound, and remote publishers can observe client image requests.

**Remediation**

1. Persist dimensions at ingestion/harvest and make them part of the item contract.
2. Remove synchronous assembly-time probes; use a bounded background metadata pipeline for legacy items.
3. Lazy-load thumbnails and begin full-image promotion only near/inside viewport.
4. Use responsive `srcset`/sized proxy variants and a consistent image privacy policy.
5. Virtualize/window cards so old media and observers are released.
6. Load tooltip previews on intent, not at matrix mount.

### F-14: Core interactions are inaccessible and gestures conflict

**Severity:** P1  
**Areas:** accessibility, keyboard, touch

**Evidence**

- Scroll cards open through a clickable `div` with no role, tab stop, or key handler (`Scroll.jsx:92-105`).
- Gallery thumbnails, timeline entries, Reader category/group toggles, mini-player art/info, and volume icons are clickable non-controls.
- Seek bars are pointer-only `div`s instead of sliders.
- Detail modal and player sheet have no dialog role, `aria-modal`, focus trap, initial focus, return focus, or background inertness.
- Reader drawer has no labeled close/open state and no focus management.
- Global detail ArrowLeft/ArrowRight handlers do not ignore focused controls and collide with gallery keyboard navigation (`DetailView.jsx:112-120`; `FeedCard.jsx:169-203`).
- Parent card/detail touch handlers compete with child gallery/player/sheet gestures.
- Status is conveyed by an unlabeled color-only dot.
- Images that are meaningful content use empty alt text.
- Most text is 0.6-0.8rem with low-contrast gray on dark backgrounds.
- No Feed stylesheet honors `prefers-reduced-motion`.

**Impact**

Keyboard/switch users cannot open or navigate major content. Screen readers do not receive dialog, expansion, slider, status, or image semantics. Touch users can trigger two actions with one gesture.

**Remediation**

1. Use native buttons/links and accessible disclosure/dialog/slider patterns.
2. Implement a modal primitive with focus containment, inert background, Escape behavior, and focus restoration.
3. Replace global arrow handlers with scoped roving focus or ignore interactive/editable targets.
4. Centralize pointer gesture arbitration with direction locking and child opt-out.
5. Meet WCAG AA contrast and target size; do not go below a readable body size.
6. Add reduced-motion styles and meaningful alternative text/captions.
7. Add automated axe checks plus keyboard and screen-reader smoke scripts.

### F-15: Reader filtering/read semantics are surprising and incomplete

**Severity:** P2

**Evidence**

- Opening an unread row immediately marks it read; failure does not roll back (`Reader.jsx:245-269`; `ArticleRow.jsx:25-35`).
- Backend supports `unread`, but the UI offers no mark-unread/undo.
- Expanding an active category clears that category's filter (`ReaderSidebar.jsx:45-52`). Display expansion should not mutate content selection.
- Multi-select depends on Ctrl/Cmd. Mobile closes the drawer after every feed selection, so multi-select is effectively unavailable except category-wide selection (`Reader.jsx:286-298`).
- Filter state is not represented in the URL and is lost on reload/back/share.
- Backend multi-feed mode fetches 200 items from the global reading list and post-filters, rather than paginating the selected feeds as a stable merged stream (`feed.mjs:87-188`).
- `getFeeds` is requested for every stream page even after the sidebar has loaded.
- Appends are not deduplicated.

**Impact**

Users accidentally lose unread state, cannot reverse it, and cannot predict category/filter behavior. Selected-feed history can be incomplete or require empty pagination pages.

**Remediation**

Separate disclosure from read mutation. Add explicit read/unread actions and undo. Use checkboxes or a clear selection mode on all devices, preserve filters in the URL, and provide a server-side stable merged-feed query with dedupe.

### F-16: Headlines refresh/navigation behavior is slow and error-blind

**Severity:** P2

**Evidence**

- `HeadlineService.harvestAll` processes sources sequentially (`HeadlineService.mjs:100-154`).
- Each source can then perform concurrent article extraction for every new imageless item before saving (`HeadlineService.mjs:221-260`).
- Duplicate source definitions across pages are not deduplicated.
- The UI holds one HTTP request open, shows only a global loading state, ignores the returned error count, and has no cancel/progress/partial result.
- Source refresh is a `<button>` nested inside a source `<a>` (`SourcePanel.jsx:45-72`). `stopPropagation` does not prevent the anchor's default navigation, so Refresh can also open the site.
- Page/source refresh errors are console-only.
- Headline tooltips work only on hover; touch and keyboard users cannot request them.
- Matrix construction repeatedly scans all sources for every cell (`Headlines.jsx:49-59`).

**Impact**

Refresh may take a long time, appear hung, navigate unexpectedly, and still look successful when sources failed.

**Remediation**

Move harvest to a bounded background job with job ID, per-source progress, deduped source set, retry/backoff, and streamed/polled status. Separate source link and refresh button structurally. Show stale/error timestamps per source and make previews focus/tap accessible.

### F-17: Feed item/source contracts are inconsistent and unvalidated

**Severity:** P2

**Evidence**

- There is no runtime-validated FeedItem entity/DTO despite the original design.
- `ImmichFeedAdapter.sourceType` is `immich` but list items use `source: 'photo'`.
- `StravaFeedAdapter.sourceType` is `strava` but items use `source: 'fitness'`.
- Filter resolution uses adapter `sourceType`, while filtering and source caps compare `item.source` (`FeedFilterResolver.mjs:59-81`; `FeedAssemblyService.mjs:299-306`; `TierAssemblyService.mjs:443-453`).
- User query names are loaded dynamically by `FeedPoolManager`, but `FeedFilterResolver` is initialized only with bootstrap household query names (`app.mjs:1212-1217`).
- Frontend card bodies are selected by `item.source`; backend dismiss routing uses the ID prefix; config uses query/source keys. These are four overlapping taxonomies.
- Backend sends `colors`, but `FeedCard` accepts and never uses them.

**Impact**

Filters/caps/colors can silently miss content, source-specific UI can select the wrong renderer, and adding a source requires knowing undocumented string aliases across layers.

**Remediation**

Define a schema with distinct fields: `id`, `adapterType`, `sourceKey`, `contentType`, `tier`, `subsource`, and `presentation`. Validate every adapter output and API response. Generate frontend renderer registration and filter metadata from the same contract. Add contract tests for every adapter.

### F-18: Infinite DOM, observers, render loops, and logging add avoidable load

**Severity:** P2

**Evidence**

- Scroll and Reader append forever without virtualization/windowing.
- Desktop masonry creates one ResizeObserver per card plus a viewport observer and retains measurement/position maps for every item.
- `usePerfMonitor` runs a continuous animation frame loop, long-task observer, scroll listener, full-document node count, percentile sort, and a log snapshot every five seconds (`usePerfMonitor.js:16-157`). It currently fails lint due to function reassignment.
- Feed configures the global logger to debug for the whole app (`FeedApp.jsx:47-61`).
- Scroll logs activity up to five times per second, every viewport enter/exit, masonry measurements/reflows, image lifecycle, and player events.
- Many logs include full page, image, article, and resolved media URLs. `FeedPlayer` logs complete stream URLs (`FeedPlayer.jsx:71-84`). Signed or identifying query parameters can end up in session logs.
- `FeedPlayer` rerenders through state setters every animation frame.
- The production build places the statically imported app, including all Feed modes, in an 8.14 MB minified main JavaScript chunk; Feed has no route-level split between Scroll, Reader, and Headlines.

**Impact**

The diagnostic layer can contribute to the jank it measures, network/session logs become noisy and privacy-sensitive, and memory/DOM/observer cost grows with session length.

**Remediation**

1. Virtualize both Scroll and Reader while preserving measured masonry anchors.
2. Sample telemetry and enable verbose diagnostics only through a short-lived debug flag.
3. Redact query strings/tokens/private titles and use aggregate metrics rather than per-frame/per-card logs.
4. Use browser performance entries/event timing without a permanent rAF where possible.
5. Keep media progress in the DOM at rAF frequency and React state at a coarse/event-driven rate.
6. Route-split application entry points and lazy-load Feed modes/player code that is not needed for the active route.
7. Establish performance budgets for initial API latency, JavaScript/CSS transfer, DOM nodes, image bytes, memory, long tasks, and log volume.

### F-19: The Feed PWA is installability theater, not an offline/resilient PWA

**Severity:** P2

**Evidence**

- `feed-sw.js` contains only an empty fetch listener and explicitly says it provides no offline caching.
- The root page already declares `/manifest.json` and registers `/sw.js`; Feed injects a second manifest and registers a narrower worker (`frontend/index.html:6, 27-29`; `FeedApp.jsx:20-39`). Multiple manifests and overlapping workers create ambiguous behavior and maintenance risk.
- Registration failures are ignored.
- The Feed worker is never unregistered and can continue controlling its scope after navigation/deployment.
- The Feed manifest advertises shortcuts but no offline behavior, update UX, cache policy, or share target.
- Headlines imports a Google font at runtime, further weakening offline rendering.

**Impact**

Installed Feed looks app-like but fails hard without network, can shadow root service-worker behavior, and provides no user-visible update/recovery semantics.

**Remediation**

Use one app-wide service worker/manifest strategy with route-aware metadata, or make Feed a fully separate entry point. Cache the shell and a bounded last-good feed snapshot, expose stale/offline status, queue reversible mutations, and define update/clear-cache behavior. If offline is not intended, remove the Feed-specific worker and misleading PWA claims.

### F-20: Original wellbeing/session product requirements remain absent

**Severity:** P2

The January boonscrolling design specified a FeedSession, engagement events, time warnings, interactive grounding items, and response use cases. The February architecture audit identified the same gaps. Adapters and tier assembly have since improved, but these product-level capabilities still do not exist.

Current telemetry records dwell and scroll activity as diagnostics, not durable product events that influence assembly. There is no session identity, intentional stopping point, warning, daily budget, saved item, feedback/preference signal, interactive task/health action, or response endpoint. `ActionsSection` is registered but no Feed backend produces an actions section.

**Impact**

The experience is optimized for endless supply and silent recycling rather than the stated "boonscrolling" goal. The system cannot measure whether tier balancing improves user outcomes.

**Remediation**

After reliability work, implement the smallest coherent product loop:

1. Explicit FeedSession with start/end and stable pagination.
2. Privacy-conscious exposure/open/play/save/dismiss signals.
3. Clear "caught up" state instead of automatic recycling.
4. User-controlled time budget and gentle stopping prompt.
5. One interactive grounding use case end to end, with confirmation and undo.
6. Preference controls for source frequency and "less like this."

### F-21: API inputs and errors are insufficiently validated or bounded

**Severity:** P2

**Evidence**

- `limit`, `count`, and `days` are converted with `Number` but not checked for finite/range/integer values (`feed.mjs:58-68, 87-104, 246-258`).
- `filter`, `feeds`, `meta`, source IDs, and item ID arrays have no length/count bounds.
- `?filter=` can trigger `stripLimits: true`, which assigns a nominal pool limit of 10,000 per query (`FeedPoolManager.mjs:216-225`).
- Dismiss item IDs are not type/length validated.
- The router error middleware exposes raw `err.message` (`feed.mjs:449-452`).
- Partial source failures are converted to valid empty arrays and omitted from the response.

**Impact**

Malformed/large requests can consume excess upstream work or memory; callers cannot reliably distinguish invalid input, upstream degradation, and true emptiness.

**Remediation**

Use request/response schemas with hard limits and structured error codes. Clamp page sizes, bound filter/subsource counts, reject oversized metadata/IDs, and return partial-source health separately from items. Avoid exposing internal exception text.

### F-22: Random IDs/timestamps and unstable shuffles break continuity

**Severity:** P2

**Evidence**

- Strava falls back to `Math.random()` in item IDs (`StravaFeedAdapter.mjs:46-55`).
- Goodreads falls back to title as ID and current time as timestamp; titles can collide or contain Unicode/path-unfriendly text.
- Several timeless/local adapters stamp `new Date().toISOString()` on every fetch (Readalong, health, ABS ebook, Plex fallback, weather fallback, entropy fallback).
- Many adapters use `array.sort(() => Math.random() - 0.5)`, which is biased and non-reproducible.
- Headline pagination shuffles source order on every fetch before applying its offset (`HeadlineFeedAdapter.mjs:84-108`).

**Impact**

The same content changes identity/order/freshness between requests, defeating dedupe, dismiss, cache, scroll restoration, analytics, and pagination.

**Remediation**

Require stable IDs from source identity plus canonical local key. Represent timelessness explicitly rather than pretending content was created now. Use a deterministic session seed for randomized selection and stable tie-breakers for every sort/page.

### F-23: Detail iframe/link handling is unreliable and under-protected

**Severity:** P2

**Evidence**

- If no content section resolves, Detail embeds arbitrary article links in an iframe (`DetailView.jsx:16-21, 252-261`). Many sites deny framing, but there is no timeout/failure fallback.
- Generic EmbedSection has no sandbox and grants autoplay/encrypted media (`EmbedSection.jsx:1-15`).
- Detail combines `allow-scripts` and `allow-same-origin`; this is especially risky if a proxy makes framed content same-origin.
- External links and paywall proxy concatenation have no centralized scheme/origin validation.
- Iframes have no lazy loading or referrer policy.

**Impact**

Users see blank/broken detail surfaces, external content receives referrer/context unnecessarily, and future same-origin embeds could weaken sandbox protection.

**Remediation**

Prefer sanitized reader content plus an explicit "Open original" link. Allow embeds only through provider plugins with a host allowlist, minimal permissions, sandbox/referrer policy, loading/error UI, and consent where tracking is involved.

### F-24: Visual design has readability, mobile viewport, and motion failures

**Severity:** P2

**Evidence**

- App/layouts use `100vh` rather than dynamic viewport units, producing mobile browser chrome/keyboard problems.
- Mini player is fixed over the feed without reserving bottom space (`Scroll.scss:189-315`). Last content/actions can be hidden.
- Player sheet sets `touch-action: none` on the entire scrollable sheet, which can block its own vertical scrolling (`FeedPlayerSheet.scss:16-31`).
- Scrollbars are hidden everywhere, removing position/overflow affordance (`FeedApp.scss:35-41`).
- Body/detail text uses line-height 1 in multiple places.
- Reader is light, Headlines/Scroll are unrelated dark themes, and FeedApp itself uses a flat gray background. Navigation feels like separate prototypes rather than one product.
- Skeletons, dots, slide animations, shimmers, and transitions run without reduced-motion alternatives.

**Impact**

Text is cramped, low contrast, and hard to scan; mobile content is obscured or difficult to scroll; mode switches feel discontinuous.

**Remediation**

Define shared Feed design tokens and typography, meet contrast/target-size budgets, use `100dvh` with safe-area insets, reserve player space, retain scrollbar/position affordance, and support reduced motion. Keep each mode distinct but visibly part of one app.

### F-25: Production ships an internal assembly debugger and internal metadata

**Severity:** P2

**Evidence**

- Every ordinary Scroll response includes `feed_assembly` tier allocation internals.
- Every Scroll user sees a floating debug button and modal (`Scroll.jsx:609`; `FeedAssemblyOverlay.jsx`).
- The modal can client-filter loaded items, but it is presented as debugging rather than a user preference.
- Controls are non-semantic spans, modal accessibility is absent, clipboard rejection is unhandled, and state-setters are nested inside state-setters.

**Impact**

Internal diagnostics clutter the primary experience, increase payload/rendering, and expose unstable implementation concepts as accidental UI.

**Remediation**

Gate diagnostics behind an explicit developer permission/query flag. Move user-relevant source/tier preferences into a designed filter/preferences surface with server-backed semantics.

### F-26: Adapter fan-out and per-item enrichment make cold latency unpredictable

**Severity:** P2

**Evidence**

- Initial pool fetch fans out across every enabled query and waits for all settled results, each with a 20-second wrapper timeout (`FeedPoolManager.mjs:216-247`).
- The timeout race does not cancel underlying adapter work.
- Several adapters catch errors internally and return empty, so timeout/error attribution is incomplete.
- Plex, Goodreads, Immich, headlines, Komga, ABS, YouTube channel icons, and article enrichment add secondary calls.
- Headline manual harvest can perform many article extractions.

**Impact**

One slow source delays the whole first page, background work can continue after timeout, upstream quotas are consumed by presentation metadata, and the UI cannot identify the bottleneck.

**Remediation**

Serve from pre-harvested source snapshots. Refresh sources independently on schedules/SWR with concurrency budgets and cancellation. Assemble only from local normalized pages. Return quickly with source freshness/health metadata, then offer a non-disruptive refresh.

### F-27: Headline/source pagination is unstable or prematurely exhausted

**Severity:** P2

**Evidence**

- Headline source order is shuffled independently for every offset request, so offsets can skip or duplicate items (`HeadlineFeedAdapter.mjs:84-108`).
- Google News caches only the number of items requested by its first call per topic. Later pagination asks for 50 but receives the smaller cached set (`GoogleNewsFeedAdapter.mjs:112-142, 214-229`).
- Only a minority of adapters implement `fetchPage`; default adapters immediately return `cursor: null` and rely on recycle for depth (`IFeedSourceAdapter.mjs:43-57`).
- On stale first-page cache hits, the asynchronous refresh and separate cursor map can refer to different page versions.

**Impact**

Deep scroll misses available content or repeats it. The API's `hasMore` does not consistently mean the source has a next page.

**Remediation**

Require stable ordered SourcePage snapshots with cursor and version together. Make adapters declare pagination capability, and do not imply depth for non-pageable sources. Test page unions for no gaps/duplicates under cache hit, stale refresh, restart, and config change.

### F-28: Test and lint gates do not protect the Feed

**Severity:** P2

**Evidence**

- Targeted lint fails with rule-of-hooks and runtime-quality errors.
- Most backend Feed suites fail to initialize through the documented harness.
- There are no Feed frontend component tests.
- Live tests use real services/state and often treat "no sentinel" or too-small data as a passing skip.
- Infinite-scroll tests assert only that count increases, not stable uniqueness/order/cursor replay.
- No tests cover dismissal persistence, multi-user isolation, security payloads, request races, keyboard use, volume, resume position, or offline state.

**Impact**

Regressions can ship despite a large nominal test count. Security and concurrency invariants are effectively untested.

**Remediation**

1. Fix the matcher collision and make the isolated Feed suite a required gate.
2. Make targeted Feed lint pass with zero warnings.
3. Add component tests with mocked API/media/observers.
4. Add deterministic integration tests for cursor replay, cross-tab isolation, cache restart, partial failure, dismiss outcomes, and user isolation.
5. Use seeded fixture sources for end-to-end flows; reserve live services for non-mutating smoke checks.
6. Add security regression tests and automated accessibility checks.

### F-29: Configuration-driven colors/focus and other code paths are dead

**Severity:** P3

- `focusSource` has a setter that is never used, and lint flags it (`Scroll.jsx:121`).
- `colors` are fetched, stored, passed into cards, then unused (`Scroll.jsx:130, 191-193, 537-546`; `FeedCard.jsx:281`).
- `FeedAssemblyService` contains unused assembled-cache fields and accepts a long list of legacy unused constructor parameters.
- `nocache` is parsed but ineffective.
- Content plugin documentation advertises `ReaderRow`, but only the YouTube Scroll body exists.
- `ActionsSection` is unreachable from current backend producers.

**Remediation**

Remove dead behavior or finish it behind a tested user story. Do not keep API/config knobs that silently do nothing.

### F-30: Repeated formatting/rendering logic increases drift

**Severity:** P3

- Age/time formatting is reimplemented in Reader rows, Headlines, source panels, mini player, detail player, and FeedPlayer.
- Native YouTube resolution/fallback logic exists in card, Reader, and detail variants.
- Image fallback logic differs between card, detail, mini bar, sheet, gallery, and headline tooltip.
- Most section/card styling is large inline object literals, limiting shared states, focus styles, theming, and media-query support.

**Remediation**

Extract shared date/media/image primitives only after the contracts above are stabilized. Consolidation should remove behavior variants, not merely move duplicated code.

## Missing Product Capabilities

These are not all release blockers, but they are notable gaps for a durable Feed experience:

| Capability | Current state | Suggested direction |
|---|---|---|
| Undo | None for read/dismiss/action | Global reversible mutation toast/queue |
| Save/bookmark | None | Personal saved-items collection with source deep link |
| Mark unread | Backend Reader support only | Row/detail action plus undo |
| Source controls | Debug-only client filter | Persistent frequency/mute/follow controls |
| Search | None across Feed | Server query over normalized item index/snapshots |
| New-item refresh | Reload/reset only | "N new items" anchor-preserving refresh |
| Pull/manual refresh | Headlines only | Per-mode refresh with source freshness state |
| Caught-up state | Silent recycling | Explicit end, replay/history as opt-in |
| Engagement/preferences | Diagnostic logs only | Minimal private events that affect future allocation |
| Time wellbeing | None | User-controlled session budget and stop prompt |
| Interactive grounding | Registered renderer only | One typed, confirmed, undoable action flow |
| Offline | Empty service worker | Shell + bounded last-good snapshot + queued reversible mutations |
| Shareable detail | Process-cache dependent | Durable opaque item references and permission checks |
| Error recovery | Mostly console-only | Retry/degraded/stale/error states at app and source level |
| Accessibility | Fragmentary | Native semantics, dialogs, sliders, gesture arbitration, axe gate |

## Recommended Target Architecture

### 1. Request-scoped identity

```text
HTTP request
  -> authenticated Principal { householdId, userId, username, roles }
  -> FeedQuery / FeedMutation
  -> repositories and source snapshots keyed by Principal
```

No global service should infer a user or use an unscoped cache key.

### 2. Normalized source snapshots

Each source adapter should produce and persist a validated page:

```js
{
  sourceKey,
  queryKey,
  version,
  fetchedAt,
  status: 'fresh' | 'stale' | 'error',
  items: FeedItem[],
  nextCursor: string | null,
  warning: null | { code, message }
}
```

Assembly should not make arbitrary remote image/article calls. It should read local source snapshots and return partial-source health.

### 3. Explicit FeedSession and cursor

```js
{
  sessionId,
  userId,
  filterKey,
  configVersion,
  orderingSeed,
  position,
  expiresAt
}
```

The cursor should be opaque/signed and replay-safe. Pages should be stable, unique, and independent across tabs.

### 4. Validated FeedItem DTO

Use a schema validator and distinguish source identities:

```js
{
  id,
  adapterType,
  sourceKey,
  subsourceKey,
  contentType,
  tier,
  title,
  summary,
  occurredAt,
  media,
  detailRef,
  capabilities: {
    markRead,
    markUnread,
    dismiss,
    save,
    play,
    respond
  },
  presentation
}
```

The frontend should render capabilities, not guess behavior from string prefixes/tier/source.

### 5. One frontend query state machine

Use a reducer/query layer keyed by `{mode, filter, sessionId}` with:

- abort and stale-response protection
- explicit loading/refreshing/error/degraded states
- stable page dedupe
- mutation queue with undo/rollback
- anchor/scroll restoration
- URL-backed filters and selected item

### 6. One media session

All inline, detail, mini, and sheet views should observe/control a single media session and one media engine. Avoid a local player plus a hidden player for the same content.

### 7. Safe rich content boundary

All third-party content should enter through one sanitizer/parser and render through one controlled rich-content component. Provider embeds require explicit plugins/allowlists.

## Phased Remediation Plan

### Phase 0: Containment and correctness gates

**Goal:** Stop the highest-risk behavior before broad refactoring.

1. Sanitize/disable Reader raw HTML and fix entity-order sanitation.
2. Add outbound URL validation, byte/time limits, and rate limits.
3. Resolve request identity and namespace all private state.
4. Fix dismissal capability detection and truthful outcomes.
5. Fix the non-wire dismiss callback crash and add an immediate Undo path.
6. Disable production assembly debugger and redact sensitive Feed logs.
7. Fix Feed lint and isolated test harness.

**Exit criteria:** no known XSS/SSRF path, two-user isolation tests pass, dismiss outcomes are truthful, lint/test gates execute.

### Phase 1: Replace pagination/cache contracts

**Goal:** Make every page deterministic and recoverable.

1. Define validated FeedItem and SourcePage schemas.
2. Persist source pages with cursor/config/user identity together.
3. Implement explicit FeedSession + opaque cursor.
4. Remove global reset semantics, synthetic duplicates, and silent recycle.
5. Return partial source health and real end-of-feed state.
6. Replace client metadata detail requests with server-owned item references.

**Exit criteria:** cursor replay is idempotent; tabs/users cannot interfere; restart/cache-hit pagination has no gaps or duplicates; cold deep links work or return explicit expiration.

### Phase 2: Frontend state and mutation reliability

**Goal:** Eliminate stale/blank/misleading UI.

1. Introduce abortable query hooks/reducer for Scroll, Reader, Headlines, and Detail.
2. Add loading, refreshing, empty, stale, degraded, and error views with retry.
3. Make filters URL-backed and reset pages atomically.
4. Implement durable mutation queue, optimistic updates, undo, rollback, and pagehide flush.
5. Restore persistent navigation between Scroll, Reader, and Headlines.

**Exit criteria:** rapid filters/details never show stale data; offline/errors do not loop; destructive changes are reversible.

### Phase 3: Consolidate media

**Goal:** One predictable player across all content/surfaces.

1. Implement FeedMediaSession.
2. Move YouTube and persistent sources onto one engine/session.
3. Apply position/volume/mute/speed from one source of truth.
4. Replace polling/render loops with media events and one progress animator.
5. Add end/error/retry/autoplay-blocked states.

**Exit criteria:** every source passes cross-surface playback, preemption, volume, resume, end, and failure tests.

### Phase 4: Accessibility and performance rebuild

**Goal:** Make long sessions usable on phone, desktop, TV, keyboard, and assistive technology.

1. Replace custom clickable elements with semantic controls.
2. Add accessible modal/drawer/sheet/slider primitives.
3. Resolve gesture ownership and reduced motion.
4. Virtualize lists/masonry and lazy-load image tiers.
5. Remove request-time image probes; establish performance budgets.
6. Unify design tokens, type scale, contrast, safe areas, and player spacing.

**Exit criteria:** axe/keyboard gate passes; no gesture triggers multiple actions; deep-scroll DOM/memory/image budgets hold.

### Phase 5: Product completion

**Goal:** Deliver the stated boonscrolling value rather than an endless mixed-content stream.

1. Caught-up and opt-in history/replay.
2. Save, unread, undo, and source preferences.
3. FeedSession engagement/time budget.
4. One interactive grounding action.
5. Real offline/installed behavior if still desired.

## Acceptance Criteria for Major Fixes

| Area | Required proof |
|---|---|
| Identity | Two users can request same source/item IDs without observing or mutating each other's data |
| XSS | Adversarial RSS/article corpus renders inertly under CSP |
| SSRF | Private/link-local/redirect/rebinding cases are blocked; oversized bodies abort |
| Pagination | Five pages are stable, unique, replayable, filter-bound, tab-isolated, and restart-safe |
| Cache | User/query/version cursor and items hydrate together; source error remains visible |
| Dismiss | Per-item result is truthful; unsupported source persists fallback; failure rolls back; Undo restores |
| Detail | No private meta in URLs; direct links survive restart or show explicit expiration |
| Media | One active element/session; volume and resume work for all source types |
| Async UI | Rapid route/filter changes cannot commit stale responses; outage has bounded retries |
| Accessibility | All primary flows keyboard-operable; dialogs/sliders named; no critical axe findings |
| Performance | Initial assembly is not gated on image probes; deep scroll stays within DOM/memory/image/log budgets |
| PWA | Either tested offline/update behavior exists or Feed-specific PWA artifacts are removed |

## Suggested First Implementation Slice

Do not begin with masonry polish or new content adapters. The highest-leverage first slice is:

1. Request-scoped user identity and namespaced stores.
2. Safe rich-content rendering and outbound URL policy.
3. Explicit dismiss capability/outcomes plus Undo.
4. Stable FeedSession cursor contract for one unfiltered Scroll path.
5. Frontend abort/error state for that path.

That slice removes the largest security and trust failures while establishing contracts the remaining Reader, Headlines, media, and UX work can build on.

## Relationship to Earlier Feed Audits

- `2026-02-16-feed-assembly-service-audit.md`: adapter decomposition and ports have substantially improved since that audit. FeedItem validation, session management, engagement, and interactive use cases remain open.
- `2026-03-12-feed-session-image-playback-audit.md`: the missing `contentId` pass-through was fixed, but the broader split-player/duplicate-observer/resume/volume architecture remains.
- The silent recycling and auto-dismiss behaviors are implemented as designed in their February plans. This audit considers those designs UX and state-contract problems, not merely coding mistakes.

## Final Assessment

The Feed has enough source breadth and presentation work to prove the concept. Its next milestone should be **trustworthy behavior**, not more breadth. A user must be able to answer five questions reliably:

1. Whose feed and state am I viewing?
2. Will the next page be stable and non-repeating?
3. What happened when I opened, read, dismissed, or played something?
4. Can I recover from a mistake or failure?
5. Is external content safe and private enough to render here?

The current implementation cannot consistently answer those questions. The remediation phases above are ordered to establish those guarantees before feature expansion.

---

## Remediation Status (2026-07-11)

Remediation was executed on branch `fix/feed-audit-remediation`. The three P0
security findings and the concrete, bounded P1/P2 bugs were fixed and verified
(frontend `npm run build` succeeds; all 27 isolated feed test files / 299 tests
pass under `vitest run`; backend feed modules import cleanly on the prod Node
20.11 line; targeted Feed lint = 0 errors, down from 11). The large
architectural rewrites the audit itself sequences into Phases 1–5 were **not**
attempted in this pass — patching them incrementally under a live deploy was
judged higher-risk than the guarantees they'd add. They remain open.

| ID | Status | Notes |
|---|---|---|
| F-01 | **Fixed (core)** | `getUsername(req)` resolves the authenticated JWT subject; reads/mutations act as the caller. Residual: per-user namespacing of the process-global pool/cache (Phase 1). |
| F-02 | **Fixed** | Server-side `sanitizeFeedHtml` (sanitize-html allowlist) on FreshRSS + extracted HTML; decode-before-allowlist ordering fixed; DOMPurify defense at both client sinks. |
| F-03 | **Fixed** | `feedUrlGuard` (assertPublicHttpUrl + safeFetch): http/https-only, credential/private-IP/redirect/byte-cap enforcement on image/readable/icon fetches; article-extractor wrapped + pre-validated. |
| F-04 | Deferred (Phase 1) | Opaque signed cursor / FeedSession contract — architectural. |
| F-05 | **Fixed** | Unseen-filtering in source/filter paths; synthetic `:dupN` items removed. |
| F-06 | Partial | Stable IDs + headline ordering fixed; full immutable `SourcePage` cache w/ cursor+namespacing deferred (Phase 1). |
| F-07 | **Fixed** | Explicit `supportsMarkRead` capability; truthful per-request dismiss outcomes (207/502); dismiss store returns added count. |
| F-08 | **Fixed** | Guarded `onDismiss` (no more undefined-call crash on non-wire cards); consistent desktop card removal; pointer-events off during exit. |
| F-09 | **Fixed (core)** | UTF-8-safe base64url ids; large/private meta fields stripped from detail URLs. Residual: fully server-owned item refs (Phase 1). |
| F-10 | Deferred (Phase 3) | One FeedMediaSession — architectural. (Dead volume/mute destructure removed for lint.) |
| F-11 | **Fixed** | Detail/deep-link generation guard; real error+retry state that stops the sentinel storm; reset+refetch on filter change. |
| F-12 | **Fixed** | Persistent (compact) Reader/Headlines/Scroll switcher on Scroll. |
| F-13 | Partial | `loading=lazy`/`decoding=async` on card images. Residual: viewport-gated full-image promotion + removal of backend assembly-time probes. |
| F-14 | Partial | Cards keyboard-operable; app-wide `prefers-reduced-motion`. Residual: dialog/slider/focus-trap primitives, axe gate. |
| F-15 | Deferred | Reader read/unread/URL-filter semantics. |
| F-16 | **Fixed** | Error middleware no longer leaks raw exception text. Residual: background harvest job. |
| F-17 | Deferred | Full source/sourceType/contentType contract unification (risky; needs schema + contract tests). |
| F-18 | Partial | App-wide debug log level gated behind `?debug=1`. Residual: virtualization, route-split, per-frame log sampling. |
| F-19 | **Fixed** | Empty feed-sw.js + duplicate manifest no longer registered; stale feed worker actively unregistered. |
| F-20 | Deferred (Phase 5) | Product loop (session/save/undo/caught-up/time budget). |
| F-21 | **Fixed** | limit/count/days clamped; dismiss/mark itemIds bounded + type-checked. |
| F-22 | **Fixed** | Deterministic FNV-1a ids for Strava/Goodreads; no `Math.random`/`now` identity. |
| F-23 | **Fixed** | All five feed iframes get explicit sandbox + referrer policy + `loading=lazy`. |
| F-24 | Partial | `100dvh`, reduced-motion. Residual: shared design tokens, contrast/target-size, scrollbar affordance. |
| F-25 | **Fixed** | `feed_assembly` stripped from responses unless `?debug=1`; assembly overlay gated behind the same flag. |
| F-26 | Deferred (Phase 1) | Pre-harvested source snapshots — architectural. |
| F-27 | **Fixed** | Stable headline source ordering (no per-fetch shuffle). |
| F-28 | Partial | All 11 Feed lint errors fixed; feed tests pass under `vitest run`. Residual: the harness-level Jest/Vitest matcher collision + new component/security/isolation tests. |
| F-29 | Partial | Dead `colors` prop + `setFocusSource` removed. Residual: `nocache`, unused assembly ctor params, `ActionsSection`. |
| F-30 | Deferred | Shared date/media/image primitive extraction. |

**Verification performed:** `npm run build` (frontend) ✓; `vitest run tests/isolated/**/feed` → 27 files / 299 tests ✓; backend feed module import-smoke on Node 20.17 ✓; `assertPublicHttpUrl`/`sanitizeFeedHtml` adversarial smoke tests ✓; targeted Feed ESLint → 0 errors.

**Dependency note:** backend gained `sanitize-html`, frontend gained `dompurify`. `isomorphic-dompurify` was deliberately avoided — its jsdom transitive deps cannot be imported on the prod container's Node 20.11.
