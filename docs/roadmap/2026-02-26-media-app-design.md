# MediaApp — Media Control & Player Design

> Mobile-first media controller, player, and remote control for DaylightStation devices

**Last Updated:** 2026-02-26
**Status:** Design Draft
**Route:** `/media`

---

## Audit Notes (2026-02-26)

> The following amendments address findings from a DDD compliance audit
> that verified every infrastructure claim against the live codebase and
> checked the proposed architecture against `docs/reference/core/layers-of-abstraction/ddd-reference.md`.
>
> **Accuracy:** 19/20 infrastructure claims verified correct. Key gaps were
> in implementation-level specification (router, bootstrap, error handling,
> logging), not architectural direction.

---

## Overview

MediaApp is a unified media control surface: a personal player with queue management, a remote control for household devices, and a content browser — all in one mobile-first interface. Think PlexAmp meets universal remote.

### What It Does

1. **Plays content locally** — audio, video, singalongs, read-alongs, with full transport controls
2. **Manages a queue** — PlexAmp-style queue with play next, add to queue, reorder, remove
3. **Monitors devices** — shows what's playing on household screens (TV, office, etc.) via WebSocket
4. **Casts to devices** — sends content to any registered device, wakes it if needed
5. **Searches and browses** — reuses the existing content search infrastructure across all sources
6. **Accepts URL parameters** — `?play=hymn:198` for deep-linking and external triggers
7. **Responds to WebSocket triggers** — other systems can push content to MediaApp's queue

### What It Doesn't Do (v1)

- Multi-user queues or identity (head of household only)
- Permission hierarchy for casting (always-replace policy)
- Offline playback or download
- Social/shared listening sessions

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| User scoping | Head of household only (v1) | Avoids auth complexity; multi-user deferred |
| Queue scoping | One queue per household | Matches codebase pattern (`householdId` on all service methods). Head-of-household-only means one queue per household is sufficient for v1. Multi-user (per-user queues within a household) deferred to Phase 5. |
| Queue persistence | Backend-persistent | Survives refreshes, works cross-device |
| Cast policy | Always replace | Simple; permission hierarchy deferred |
| Layout | Mobile-first, full viewport | Not screen-constrained like TV app; 100% width/height |
| UX reference | PlexAmp | Queue drawer, mini player, now playing, search |

---

## Design Rationale: Why Not Reuse useQueueController?

TVApp and MediaApp both play media through `Player.jsx`, but their interaction
models are fundamentally different:

| | TVApp ("theater mode") | MediaApp ("hands-on controller") |
|---|---|---|
| **Interaction** | Remote for transport only (play/pause, ffwd, skip) | Active queue editing while playing (add, reorder, remove, go back) |
| **Queue lifecycle** | Set-it-and-forget-it — move *through* it, never *edit* it | Full CRUD at runtime — browse and add while listening |
| **Queue model** | Ephemeral slice-and-discard (advance = remove head) | Persistent position pointer (advance = move index, items stay) |
| **Persistence** | None — queue lives in React state, gone on refresh | Backend YAML — survives refresh, syncs across tabs/devices |
| **Player usage** | `<Player queue={...}>` — hands off entire queue | `<Player play={currentItem}>` — feeds one item at a time |
| **Transport controls** | Keyboard shortcuts, shader overlays | On-screen buttons, seekable progress bar via Player imperative ref |
| **Who advances?** | useQueueController auto-advances internally | useMediaQueue advances position → feeds next item to Player |

`useQueueController` is a playback cursor with transport — you can move through
the queue but not restructure it. `useMediaQueue` is a queue editor with
persistence — full CRUD plus transport.

Both use `Player.jsx` as the renderer. Player is the speaker; the queue layer
above it determines the interaction model.

**Consequence:** MediaApp uses Player in **single-play mode** only (`play=` prop,
never `queue=` prop). `useMediaQueue` owns queue state, talks to the backend,
and passes `items[position]` to Player as a single play item. When Player calls
`clear()` (item ended), `useMediaQueue` advances position and feeds the next item.

---

## Architecture

### Component Hierarchy

```
MediaApp.jsx (route: /media)
│
├─ MediaAppProvider (context: queue, devices, playback state)
│
├─ Layout (responsive: mobile stack / desktop sidebar)
│   │
│   ├─ NowPlaying (main view)
│   │   ├─ MediaAppPlayer (thin wrapper — see spec below)
│   │   │   └─ Player.jsx (single-play mode: play={currentItem})
│   │   ├─ TrackInfo (title, artist, source badge)
│   │   ├─ ProgressBar (seekable, with time display)
│   │   ├─ TransportControls (play/pause, prev, next, shuffle, repeat)
│   │   └─ VolumeControl
│   │
│   ├─ QueueDrawer (slide-up on mobile, sidebar on desktop)
│   │   ├─ QueueHeader (clear, shuffle toggle)
│   │   ├─ QueueItemList (drag-to-reorder, swipe-to-remove)
│   │   │   └─ QueueItem (thumbnail, title, source, duration, actions)
│   │   └─ QueueActions (play next, add to queue, move to position)
│   │
│   ├─ ContentBrowser (search + library)
│   │   ├─ SearchBar (uses useStreamingSearch for results)
│   │   ├─ ContentGrid / ContentList (results with actions)
│   │   ├─ PinnedItems / RecentlyPlayed (user config, persisted)
│   │   └─ BrowseBySource (Plex, ABS, hymns, etc.)
│   │
│   ├─ DevicePanel (remote control)
│   │   ├─ DeviceList (from devices.yml, live status via WebSocket)
│   │   ├─ DeviceCard (now playing, transport controls, volume)
│   │   └─ CastButton (send current/selected content to device)
│   │
│   └─ (No separate FullscreenOverlay component — see fullscreen implementation below)
│
└─ MiniPlayer (persistent bottom bar, always visible when playing)
    ├─ Thumbnail + Title (tap to expand NowPlaying)
    ├─ Play/Pause button
    └─ Progress indicator (thin bar)
```

### MediaAppPlayer.jsx — Player Wrapper

Thin wrapper around `Player.jsx` that adapts it from theater mode (owns the
viewport) to hands-on mode (embedded in a layout with external controls).

**Responsibilities:**
- Renders `<Player play={currentItem} clear={onItemEnd} ref={playerRef} />`
  in single-play mode only (never `queue=` prop)
- Exposes `playerRef` upward so NowPlaying can call `seek()`, `toggle()`,
  `play()`, `pause()`, `getCurrentTime()`, `getDuration()`
- Forwards `onPlaybackMetrics` / `onProgress` to provide currentTime, duration,
  isPaused to NowPlaying's progress bar and transport controls
- Manages embedded vs fullscreen display mode (see below)

**Fullscreen behavior (industry-standard, format-aware defaults):**

| Format | Default | User toggle? | Rationale |
|--------|---------|-------------|-----------|
| Audio | Embedded (now-playing card with album art) | No | Fullscreen adds nothing for audio |
| Video | Auto-fullscreen | Yes — back button exits | Industry standard (YouTube, Netflix, Plex) |
| Singalong | Embedded (content visible in card) | Yes — tap to expand | Maps to Spotify lyrics pattern |
| Readalong | Embedded (content visible in card) | Yes — tap to expand | Same as singalong |

**Fullscreen implementation:** CSS-based, not portal-based. Player stays mounted
in the same DOM location always. Fullscreen is a CSS state toggle on the
MediaAppPlayer wrapper:

```css
.media-player-wrapper.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #000;
}
```

This avoids React remount (portals unmount/remount when the target changes,
which interrupts video playback and resets buffers). The Player DOM node never
moves — only its CSS changes. Back button (or swipe down on mobile) removes
the `.fullscreen` class. NowPlaying transport controls render as an overlay
(`position: absolute; bottom: 0`) within the fullscreen wrapper.

This is the same pattern used by YouTube, Netflix, and PlexAmp for inline-to-
fullscreen transitions without playback interruption.

**What it does NOT do:**
- No transport controls (NowPlaying owns those)
- No queue awareness (useMediaQueue owns that)
- No content resolution (Player handles that internally via Play API)

### Content Playability

Player.jsx handles all playable formats via the `ContentIdResolver` chain.
Any `contentId` that resolves through the Play API is playable:

| Content | Example contentId | Format | Searchable? |
|---------|-------------------|--------|-------------|
| Plex media | `plex:12345` | video/audio | Yes |
| Hymns | `hymn:198` | singalong | Yes |
| Scripture | `scripture:bom` | readalong | **No** (ReadalongAdapter lacks `search()`) |
| Audiobooks | `abs:uuid` | audio | Yes |
| Primary songs | `primary:5` | singalong | Yes |

Scripture is playable via direct contentId (`?play=scripture:bom`) or pinned
items, but won't appear in MediaApp search results. This is a pre-existing
gap in `ReadalongAdapter`, not a MediaApp concern for v1.

### Search UX

**No new search backend.** `ContentQueryService` already provides everything
MediaApp needs:

| Capability | Already exists? | Where |
|------------|----------------|-------|
| Multi-source streaming search | Yes | `ContentQueryService.searchStream()` via SSE |
| Playable-only filtering | Yes | `capability=playable` query param |
| Prefix-scoped search | Yes | `hymn:amazing` → searches singalong only |
| Direct ID lookup | Yes | `plex:12345` → exact match |
| Relevance scoring | Yes | `RelevanceScoringService` |
| Watch state enrichment | Yes | `enrichWithWatchState()` |
| Container drill-down | Yes | `/api/v1/list/{source}/{localId}` |

**Frontend search flow:**

```
SearchBar (text input, debounced)
    │
    └── useStreamingSearch('/api/v1/content/query/search/stream', 'capability=playable')
            │
            ├── results stream in per-source (Plex first, then hymns, then ABS, etc.)
            │
            └── ContentBrowser.jsx renders results in a scrollable panel:
                ├── Source group headers (Plex, Hymns, Audiobooks)
                ├── Result items: thumbnail, title, type badge, duration
                ├── Container items: tap to drill down (useContentBrowse)
                └── Action buttons per item:
                    ├── ▶ Play Now   → media:command play
                    ├── ⏭ Play Next  → media:command next
                    ├── + Add to Queue → media:command add
                    └── 📺 Cast...   → device picker → cast
```

**`useContentBrowse` hook** (extracted from `ContentSearchCombobox`):
- Fetches children of a container via `GET /api/v1/list/{source}/{localId}`
- Manages breadcrumb stack for back navigation
- Reusable by both `ContentSearchCombobox` (admin) and `ContentBrowser` (MediaApp)

### Source Filters (Pre-Scoped Search)

Searching all sources on every keystroke is wasteful when the user knows they
want music or hymns. The backend already supports source-level fan-out scoping
via `source` and `mediaType` query params — the search stream only hits matching
adapters, skipping everything else. This is a **UI-only concern**: filter
presets inject the right params into `useStreamingSearch`.

**Filter presets (chips above search bar):**

| Filter | Query params | Adapters hit | Use case |
|--------|-------------|-------------|----------|
| All | `capability=playable` | All | Default — browse everything |
| Music | `source=plex&mediaType=audio` | Plex only | Background listening |
| Video | `source=plex&mediaType=video` | Plex only | Movies, TV shows |
| Hymns | `source=singalong` | Singalong only | Sunday prep |
| Audiobooks | `source=readable` | ABS only | Audiobook browsing |

**Backend prerequisite:** `ContentQueryService.searchStream()` currently filters by
`capability` and `source` but does NOT filter by `mediaType`. The Music and Video
presets require adding `mediaType` pass-through to `searchStream()` so adapters
(specifically PlexAdapter) can scope results to audio-only or video-only. Without
this change, both presets return all Plex content regardless of media type.

**Implementation:** In `ContentQueryService.mjs` (`3_applications/content/`),
add `query.mediaType` pass-through in `searchStream()` (line ~226, after
`resolveSource()`). Pass it to adapters via `#translateQuery()`. In
`PlexClientAdapter.mjs` (`1_adapters/plex/`), use `mediaType` to filter by
Plex `type` field (artist/album/track for audio, movie/show/episode for
video). Note: `mediaType` filtering already exists in `#pickRandom()`
(line ~564) — extend the same pattern to `searchStream()`. This is a
small backend change in Phase 2.

These are just `useStreamingSearch` calls with pre-injected params — no new
backend code beyond the `mediaType` pass-through above. The `resolveSource`
chain in `ContentSourceRegistry` already handles exact source, provider, and
category resolution.

**Prefix shorthand still works.** Typing `hymn:` in the search bar with "All"
selected has the same effect as selecting the "Hymns" filter — the alias
resolver scopes to the singalong adapter. Filters are a UX convenience for
tap-based mobile interaction; prefix syntax is the power-user equivalent.

**Custom UI, shared backend.** The only new frontend code is `ContentBrowser.jsx`
(panel layout with action buttons, filter chips) and `useContentBrowse`
(extracted drill-down logic). All search intelligence stays in
`ContentQueryService`.

### Data Flow

```
URL params (?play=, ?queue=)
         │
         ▼
    MediaApp ──────────────────────► QueueService (backend)
         │                              │
         │  WebSocket subscribe         │  GET/POST /api/v1/media/queue
         │  topic: "media:queue"        │  Persistent queue CRUD
         │                              │
         ▼                              ▼
    useMediaQueue ◄───────────── Queue state (items, position, shuffle)
         │                              ▲
         ├──► Local Player              │
         │                    media:command events
         └──► Remote Device             │
                              External systems (HA, CLI, other apps)
```

### Reused Infrastructure

| Existing Component | Reuse In MediaApp |
|--------------------|-------------------|
| `useQueueController` | **Not reused** — see Design Rationale. MediaApp uses new `useMediaQueue` hook |
| `WebSocketService` + `useWebSocketSubscription` | Device monitoring, incoming commands |
| `ContentSearchCombobox` | **Not reused directly** — admin dropdown UX, wrong for MediaApp. Extract container drill-down logic into `useContentBrowse` hook |
| `useStreamingSearch` | Primary search data layer — call with `capability=playable` to filter to playable content |
| `ContentQueryService` (backend) | **Already complete** — streaming multi-source search, prefix queries, ID lookup, capability filtering, relevance scoring, watch state enrichment. No backend changes needed for search |
| Player.jsx → SinglePlayer → renderers | All playback rendering (video, audio, singalong, readalong) |
| Device load API (`/api/v1/device/:id/load`) | Cast-to-device functionality |
| `WakeAndLoadService` | Wake sleeping devices before casting |
| Play API (`/api/v1/play/:source/*`) | Content resolution for local playback |
| Queue API (`/api/v1/queue/:source/*`) | Resolve containers to playable lists |
| Display API (`/api/v1/display/:source/*`) | Thumbnails everywhere |
| `ContentDisplayUrl()` | Thumbnail URL builder |
| `websocketHandler.js` normalization (OfficeApp-specific) | Reference for payload format — `media:command` is processed backend-only; frontend reacts to `media:queue` broadcasts |

---

## Backend: Queue Persistence

### New API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/v1/media/queue` | Get current queue (items, position, shuffle state) |
| `PUT` | `/api/v1/media/queue` | Replace entire queue |
| `POST` | `/api/v1/media/queue/items` | Add items (body: `{ items, placement: 'next' \| 'end' \| index }`) |
| `DELETE` | `/api/v1/media/queue/items/:queueId` | Remove item by stable ID |
| `PATCH` | `/api/v1/media/queue/items/reorder` | Move item (body: `{ queueId, toIndex }`) |
| `PATCH` | `/api/v1/media/queue/position` | Update current position (body: `{ position }` or `{ queueId }`) |
| `PATCH` | `/api/v1/media/queue/state` | Update shuffle, repeat, volume |
| `DELETE` | `/api/v1/media/queue` | Clear queue |

### Item Identity

Each queue item receives a `queueId` (8-char hex, e.g. `"a3f1b20c"`) when
added. All mutation endpoints target items by `queueId`, not array index.
This prevents race conditions when two operations fire in quick succession —
indices shift on every add/remove, but `queueId` is stable for the item's
lifetime in the queue.

The `position` field remains an integer index for efficient "what's playing
now?" lookups. The domain entity (`MediaQueue`) adjusts `position` internally
whenever `removeByQueueId` or `reorder` shifts the current item's index.

Frontend parallel: `useQueueController` already assigns `guid()` to each item
for React keys — same concept, extended to the backend.

### Storage

Queue state stored as YAML via `configService.getHouseholdAppPath('media')`:

`data/household/apps/media/queue.yml`:

```yaml
position: 2
shuffle: false
repeat: off          # off | one | all
volume: 0.8
shuffleOrder: null    # array of indices when shuffle: true, null when off
items:
  - queueId: "a3f1b20c"
    contentId: "plex-main:12345"
    title: "Episode Title"
    format: video
    duration: 2400
    addedAt: "2026-02-26T10:30:00Z"
    addedFrom: "search"     # search | url | cast | websocket
  - queueId: "7e4d9c12"
    contentId: "hymn:198"
    title: "I Stand All Amazed"
    format: singalong
    duration: 180
    addedAt: "2026-02-26T10:31:00Z"
    addedFrom: "url"
```

**`addedFrom` tracking:** Set automatically based on the add path:
- `"search"` — added via ContentBrowser UI
- `"url"` — added via URL parameter on page load
- `"cast"` — added via CastButton from device panel
- `"websocket"` — added via `media:command` WebSocket event
- `"reorder"` — not set (preserves original `addedFrom`)

**Implementation note:** Define `addedFrom` values as constants in the entity
file rather than scattering string literals:

```js
export const ADDED_FROM = {
  SEARCH: 'search',
  URL: 'url',
  CAST: 'cast',
  WEBSOCKET: 'websocket',
};
```

**DDD note:** `addedFrom` is presentation-layer provenance metadata. The
domain entity passes it through without interpreting it — no domain logic
branches on `addedFrom` values. This is acceptable as pass-through metadata
but should not be used in domain invariants or business rules.

### Content Resolution on Add

Queue items require metadata (`title`, `format`, `duration`, `thumbnail`) beyond
just a `contentId`. Different add paths provide different levels of metadata:

| Add Path | Metadata Available | Resolution Needed? |
|----------|-------------------|-------------------|
| Search result (frontend) | Full — search already resolved title, format, duration | No — frontend sends full item |
| WebSocket `media:command` | `contentId` only | Yes — backend resolves |
| URL param `?play=` | `contentId` only | Yes — backend resolves |
| Cast from device panel | Full — already resolved for display | No — frontend sends full item |

**Backend resolution path:** When `POST /api/v1/media/queue/items` receives an
item with only a `contentId` (no `title`), `MediaQueueService.addItems()` calls
`contentIdResolver.resolve(contentId)` to fetch metadata before persisting. This
reuses the same resolution chain as the Play API.

**DDD compliance note:** Content resolution is cross-domain orchestration
(content domain → media domain). Per the dependency rule, one application
service should not depend on another domain's resolver. Instead, the
**router** (layer 4) resolves contentIds before passing fully-formed items
to `MediaQueueService.addItems()`. The service only accepts items with
`title`, `format`, and `duration` already populated.

**Router-level resolution flow:**

```
POST /api/v1/media/queue/items
  → router checks: does item have `title`?
  → if no: router calls contentIdResolver.resolve(contentId)
  → router passes resolved item to mediaQueueService.addItems()
```

This keeps `MediaQueueService` free of content-domain dependencies.
`createMediaServices()` does NOT inject `contentIdResolver` — that
dependency stays in the router factory (`createMediaApiRouter()`).

### DDD Layer Mapping

| Layer | Artifact | Purpose |
|-------|----------|---------|
| 0_system | — | Uses existing `loadYaml`/`saveYaml` from `FileIO.mjs` |
| 1_adapters | `YamlMediaQueueDatastore.mjs` | Reads/writes `queue.yml` via standard FileIO pattern |
| 2_domains | `MediaQueue.mjs` (new, in existing `media/entities/`) | Queue entity: add, remove, reorder, advance, state. **Note:** `2_domains/media/` already contains `IMediaSearchable.mjs`, `MediaKeyResolver.mjs`, `errors.mjs`, and `index.mjs`. `MediaQueue` joins this existing domain — add an `entities/` subfolder. Extend `errors.mjs` with queue-specific errors rather than creating new error files. |
| 3_applications | `IMediaQueueDatastore.mjs` (port) + `MediaQueueService.mjs` | Port interface + queue CRUD orchestration |
| 4_api | `media.mjs` router | HTTP endpoints for queue management |
| wiring | `bootstrap.mjs` + `app.mjs` | `createMediaServices()` factory + route registration |

### Concurrency

Queue mutations are safe without file locking. All YAML I/O uses synchronous
`readFileSync`/`writeFileSync` (via `loadYaml`/`saveYaml`), and Express route
handlers are serialized by the Node.js event loop. This is the same pattern
every other YAML datastore in the codebase follows.

### Error Handling

`useMediaQueue` uses optimistic updates: mutations apply to local state
immediately, then sync to the backend. If the API call fails:

1. Local state rolls back to last-known-good state
2. Error toast shown to user ("Couldn't save queue — retrying...")
3. One automatic retry after 2 seconds
4. If retry fails, local state diverges from backend until next successful
   operation (which sends the full queue state via PUT)

Playback continues regardless of backend availability — the player only needs
the current item, which is already in memory. Queue persistence is best-effort.

### Cross-Tab Sync

Every queue mutation follows a three-step protocol:

1. **Mutate backend** — `useMediaQueue` calls the REST API (POST/PATCH/DELETE)
2. **Backend broadcasts** — After persisting, the API handler broadcasts the
   full queue state on topic `media:queue`
3. **Other tabs update** — Each `useMediaQueue` instance subscribes to
   `media:queue` and replaces its local state with the broadcast payload

**Conflict resolution:** Last-write-wins via backend serialization. Express route
handlers are serialized by the Node.js event loop, so concurrent mutations from
different tabs are processed sequentially. The broadcast after each mutation
ensures all tabs converge on the same state.

**Self-echo suppression:** Each `useMediaQueue` instance generates a `mutationId`
per operation. The broadcast includes this ID. The originating tab ignores
broadcasts matching its own `mutationId` to avoid redundant state replacement.

**New pattern note:** `mutationId`-based self-echo suppression is not used
elsewhere in the codebase. Document this pattern in the implementation PR
so future WebSocket sync features can reuse it.

### MediaQueue Entity

```js
// 2_domains/media/entities/MediaQueue.mjs
class MediaQueue {
  constructor({ position, shuffle, repeat, volume, items }) { ... }
```

**Codebase entity patterns to follow:**
- Mutable public fields (not private `#` fields) for state — matches `Session.mjs`
- Constructor accepts `{ position, shuffle, repeat, volume, items }` with defaults
- `toJSON()` / `static fromJSON(data)` for serialization — NOT `static create()` factories
- No `Object.freeze()` on the entity (only on value objects like `SessionId`)
- `static empty()` is fine as a convenience alongside `fromJSON()`

```js
  // Queue manipulation — all adjust position to keep current item stable
  addItems(items, placement)       // placement: 'next' | 'end' | index
                                   // assigns queueId to each item on add
                                   // enforces MAX_QUEUE_SIZE (500); rejects with error if full
  removeByQueueId(queueId)         // removes item by stable ID, adjusts position
  reorder(queueId, toIndex)        // moves item to new index, adjusts position
  advance(step = 1, { auto } = {}) // moves position; auto=true for end-of-item
                                   // returns null when at end with repeat:off (not an error)
  clear()                          // empties items, resets position to 0
```

**Repeat + advance interaction:**

| Repeat Mode | Auto-advance (item ends) | Manual next/prev |
|-------------|--------------------------|-------------------|
| `off` | Move to next. At end of queue → stop (return `null`) | Move to next/prev. Clamp to bounds |
| `one` | Stay on same item (replay) | Move to next/prev normally (escape the loop) |
| `all` | Move to next. At end → wrap to position 0 | Move to next/prev. Wrap in both directions |

When `advance()` reaches the end of the queue with `repeat: off`, it clamps
`position` to the last item and returns `null` from `currentItem`. This is
normal flow — the frontend checks `currentItem` and stops playback. No error
is thrown; reaching the end of a playlist is not a domain invariant violation.

`advance()` accepts an optional `{ auto: true }` flag to distinguish auto-
advance (item ended) from manual next/prev. `repeat: one` only loops on
`auto: true`; manual advance always moves.

```js

  // State
  setRepeat(mode)                  // 'off' | 'one' | 'all'
  setShuffle(enabled)              // boolean
  setVolume(level)                 // 0.0 - 1.0
```

**Volume scope:** Queue `volume` controls the local MediaApp player only (sets
`HTMLMediaElement.volume`). Device volume (in DeviceCard) controls the remote
device's system volume via the device API — completely independent. When casting
content to a device, the queue volume does NOT transfer; the device plays at
its own volume level. There is no master volume concept.

**DDD note:** `volume`, `repeat`, and `shuffle` are playback preferences, not
queue-structural state. They're persisted here for pragmatic cross-session
continuity (same reason PlexAmp persists volume in its queue file). No domain
logic branches on `volume`. The entity methods that reference `repeat` and
`shuffle` (`advance()`, `setShuffle()`) are the exception — these have real
domain semantics (advance behavior changes with repeat mode). If this entity
grows more UI-only fields in the future, consider extracting a
`QueuePreferences` value object to separate structure from preferences.

**Shuffle model:** When shuffle is enabled, the entity generates a `shuffleOrder`
array (Fisher-Yates on indices `[0..items.length-1]`). `advance()` follows
`shuffleOrder` instead of sequential indices. The current item's index in
`shuffleOrder` is always placed at position 0 so playback continues from the
current track.

When shuffle is toggled off, `position` resets to the current item's index in
the original `items` array (Spotify behavior — you return to where you were in
the original order).

`shuffleOrder` is persisted in `queue.yml` to survive refresh. Adding/removing
items updates `shuffleOrder` incrementally (new items appended to end of shuffle
order, removed items spliced out).

**Serialization:** `toJSON()` includes `shuffleOrder` only when `shuffle: true`.
`fromJSON()` regenerates `shuffleOrder` if `shuffle: true` but `shuffleOrder`
is missing (backward compat).

```js

  // Accessors
  get currentItem()                // items[position] or null
  get isEmpty()                    // items.length === 0
  get length()                     // items.length
  findByQueueId(queueId)           // → { item, index } or null

  // Serialization (standard pattern)
  toJSON()
  static fromJSON(data)
  static empty()                   // factory: position 0, no items, defaults
}
```

### Key Test Cases

The `MediaQueue` entity has complex state machine behavior that must be
unit tested. These are the critical scenarios:

**advance() × repeat modes:**

| Scenario | repeat | auto | Expected |
|----------|--------|------|----------|
| Middle of queue | off | true | position + 1 |
| End of queue | off | true | currentItem → null, playback stops |
| End of queue | all | true | position wraps to 0 |
| Any position | one | true | position unchanged (replay) |
| Any position | one | false | position + 1 (manual escapes loop) |

**Position stability on mutations:**

| Mutation | Position relative to current | Expected position change |
|----------|------------------------------|--------------------------|
| Remove item before current | Before | position - 1 (stays on same item) |
| Remove current item | At | position stays (now points to next) |
| Remove item after current | After | No change |
| Reorder item from before to after | Across current | Adjust to keep current stable |

**Shuffle:**

| Scenario | Expected |
|----------|----------|
| Enable shuffle | shuffleOrder generated, current item at shuffleOrder[0] |
| Disable shuffle | position resets to current item's index in original order |
| Add item while shuffled | New item appended to shuffleOrder |
| Remove item while shuffled | Item spliced from shuffleOrder, position adjusted |

**Boundary conditions:**

- `addItems()` at MAX_QUEUE_SIZE → throws QueueFullError
- `addItems()` to empty queue → position = 0
- `removeByQueueId()` unknown ID → throws EntityNotFoundError
- `clear()` → items empty, position 0
- `toJSON()` → `fromJSON()` round-trip preserves all state

**Key invariant:** `position` is always clamped to `[0, items.length - 1]`
(or 0 when empty). `removeByQueueId` and `reorder` adjust position to keep
the current item stable — if the removed/moved item is before `position`,
position shifts accordingly. If the current item itself is removed, position
stays (now pointing at the next item) or clamps to the new end.

**Queue size limit:** `MAX_QUEUE_SIZE = 500`. `addItems()` throws if adding would
exceed the limit. The API returns 422 with a clear message. This prevents YAML
bloat — at 500 items with ~200 bytes/item the file is ~100KB, well within sync
I/O budget (other YAML datastores handle similar sizes without issue).

### Error Handling

Uses the existing error hierarchy from `2_domains/core/errors/` and extends
`2_domains/media/errors.mjs`:

| Error | Thrown When | HTTP Status |
|-------|-----------|-------------|
| `DomainInvariantError` | `addItems()` when queue exceeds `MAX_QUEUE_SIZE` | 422 |
| `EntityNotFoundError` | `removeByQueueId()` / `reorder()` with unknown `queueId` | 404 |
| `ValidationError` | Invalid `repeat` mode, negative `volume`, etc. | 400 |
| `InfrastructureError` | YAML read/write failure in datastore | 500 |

**Extend `2_domains/media/errors.mjs`** with:

```js
export class QueueFullError extends DomainInvariantError {
  constructor(maxSize) {
    super(`Queue is full (max ${maxSize} items)`);
    this.name = 'QueueFullError';
    this.maxSize = maxSize;
  }
}
```

The router maps domain errors to HTTP responses via the existing
`asyncHandler` error middleware — no custom error handling needed.

### Logging

Per CLAUDE.md: "New Features Must Ship With Logging." All backend
artifacts use the injected `logger` (never raw `console.log`).

**Backend log events (MediaQueueService):**

| Event | Level | Data |
|-------|-------|------|
| `media-queue.loaded` | debug | `{ householdId }` |
| `media-queue.saved` | debug | `{ householdId, itemCount }` |
| `media-queue.items-added` | info | `{ count, placement, householdId }` |
| `media-queue.item-removed` | info | `{ queueId, householdId }` |
| `media-queue.reordered` | debug | `{ queueId, toIndex }` |
| `media-queue.position-changed` | debug | `{ position, contentId }` |
| `media-queue.cleared` | info | `{ householdId }` |

**Frontend log events (useMediaQueue):**

| Event | Level | Data |
|-------|-------|------|
| `media-queue.sync-received` | debug | `{ itemCount, source: 'websocket' }` |
| `media-queue.optimistic-rollback` | warn | `{ operation, error }` |
| `media-queue.backend-unreachable` | warn | `{ retryIn }` |

**Frontend logger pattern:**

```js
// In useMediaQueue.js
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaQueue' });
  return _logger;
}
```

### IMediaQueueDatastore Port

```js
// 3_applications/media/ports/IMediaQueueDatastore.mjs
class IMediaQueueDatastore {
  load(householdId)           // → MediaQueue | null
  save(mediaQueue, householdId) // persists queue state
}
```

### YamlMediaQueueDatastore Adapter

```js
// 1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs
// Standard pattern: configService.getHouseholdAppPath('media', hid) + '/queue'
// Uses getHouseholdAppPath (not deprecated getHouseholdPath)
// Uses loadYamlSafe / saveYaml from FileIO.mjs
// Returns MediaQueue.fromJSON(data) on load, calls queue.toJSON() on save
```

### Wiring

```js
// 0_system/bootstrap.mjs — add createMediaServices()
export function createMediaServices({ configService }) {
  const store = new YamlMediaQueueDatastore({ configService });
  const service = new MediaQueueService({
    queueStore: store,
    defaultHouseholdId: configService.getDefaultHouseholdId()
  });
  return { store, service };
}

// 0_system/bootstrap.mjs — add createMediaApiRouter()
export function createMediaApiRouter({ mediaServices, contentIdResolver, configService, broadcastEvent, logger }) {
  return createMediaRouter({
    mediaQueueService: mediaServices.service,
    contentIdResolver,   // resolution happens in router, not service
    configService,
    broadcastEvent,
    logger
  });
}

**Naming note:** The broadcast function is wired under different parameter
names across existing routers (`broadcastToWebsockets` in fitness,
`broadcast` in device, `websocketBroadcast` in others). This plan uses
`broadcastEvent` for clarity. The actual parameter name in
`createMediaRouter` should match whatever convention the codebase has
converged on at implementation time — check `app.mjs` router wiring.

// app.mjs — call both factories, register router
const mediaServices = createMediaServices({ configService });
const mediaRouter = createMediaApiRouter({
  mediaServices,
  contentIdResolver,
  configService,
  broadcastEvent,
  logger
});
// In routeMap: '/media': mediaRouter

// api.mjs routeMap — add entry
'/media': 'media'
```

### Router Implementation

Follows the codebase factory-function pattern (see `createFitnessRouter` in
`4_api/v1/routers/fitness.mjs`):

```js
// 4_api/v1/routers/media.mjs
import { Router } from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createMediaRouter({ mediaQueueService, contentIdResolver, configService, broadcastEvent, logger = console }) {
  const router = Router();

  const resolveHid = (req) => req.query.household || configService.getDefaultHouseholdId();

  // --- Queue CRUD ---

  router.get('/queue', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.load(resolveHid(req));
    res.json(queue ? queue.toJSON() : { items: [], position: 0 });
  }));

  router.put('/queue', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.replace(req.body, resolveHid(req));
    broadcastEvent('media:queue', queue.toJSON());
    res.json({ success: true, queue: queue.toJSON() });
  }));

  router.post('/queue/items', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    // Resolve contentIds missing metadata (URL params, WebSocket triggers)
    const resolved = await Promise.all(
      (req.body.items || []).map(async (item) => {
        if (item.title) return item;  // already resolved
        const meta = await contentIdResolver.resolve(item.contentId);
        return { ...item, ...meta };
      })
    );
    const queue = await mediaQueueService.addItems(resolved, req.body.placement, hid);
    broadcastEvent('media:queue', queue.toJSON());
    res.json({ success: true, queue: queue.toJSON() });
  }));

  router.delete('/queue/items/:queueId', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.removeItem(req.params.queueId, resolveHid(req));
    broadcastEvent('media:queue', queue.toJSON());
    res.json({ success: true, queue: queue.toJSON() });
  }));

  router.patch('/queue/items/reorder', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.reorder(req.body.queueId, req.body.toIndex, resolveHid(req));
    broadcastEvent('media:queue', queue.toJSON());
    res.json({ success: true, queue: queue.toJSON() });
  }));

  router.patch('/queue/position', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.setPosition(req.body.position, resolveHid(req));
    broadcastEvent('media:queue', queue.toJSON());
    res.json({ success: true, queue: queue.toJSON() });
  }));

  router.patch('/queue/state', asyncHandler(async (req, res) => {
    const queue = await mediaQueueService.updateState(req.body, resolveHid(req));
    broadcastEvent('media:queue', queue.toJSON());
    res.json({ success: true, queue: queue.toJSON() });
  }));

  router.delete('/queue', asyncHandler(async (req, res) => {
    await mediaQueueService.clear(resolveHid(req));
    broadcastEvent('media:queue', { items: [], position: 0 });
    res.json({ success: true });
  }));

  return router;
}
```

**Key patterns followed:**
- Factory function returning `express.Router()` (not a class)
- `asyncHandler` on all async routes
- `req.query.household` with `configService.getDefaultHouseholdId()` fallback
- `broadcastEvent` for WebSocket sync after every mutation
- Content resolution in router, not in service

---

## Content Triggering

### Two Trigger Paths

| Path | Use Case | How |
|------|----------|-----|
| **WebSocket event bus** (preferred) | Normal operation — automations, inter-app communication, external systems | Publish `media:command` message to event bus |
| **URL parameters** (override) | Debug, FKB on-load, programmatic deep links | Load `/media?play=hymn:198` |

The event bus is the primary external trigger path. URL parameters are an
override mechanism — they nuke and replace, by design.

### WebSocket Commands (Preferred)

External systems (Home Assistant automations, CLI tools, other apps) trigger
MediaApp queue actions by publishing to the `media:command` topic:

```json
{ "topic": "media:command", "action": "play", "contentId": "hymn:198" }
{ "topic": "media:command", "action": "add", "contentId": "plex:12345" }
{ "topic": "media:command", "action": "next", "contentId": "hymn:166" }
{ "topic": "media:command", "action": "queue", "contentId": "plex:67890" }
```

| Action | Effect | Destructive? |
|--------|--------|-------------|
| `play` | Insert after current item, advance to it, start playing. Current item is interrupted but remains in queue (can go back). | No — existing items preserved, order unchanged |
| `add` | Append to end of queue | No |
| `next` | Insert after current item | No |
| `queue` | Resolve container, replace entire queue, start playing | Yes — loads a new playlist |
| `clear` | Clear queue, stop playback | Yes |

`media:command` events are processed **backend-only**. The backend event bus
handler receives the command, mutates the queue via `MediaQueueService`, and
broadcasts the updated queue state on `media:queue`. Frontend `useMediaQueue`
instances react to the `media:queue` broadcast — they never process
`media:command` directly. This avoids dual-processing race conditions (a
command processed by both frontend and backend would cause double-adds).

This also enables headless operation: commands work even with no MediaApp tab
open, because the backend handles them independently.

### URL Parameters (Override)

URL params are an override/debug mechanism. They clear state and force a
specific playback configuration. Used for FKB on-load, programmatic links,
and development.

| Parameter | Example | Effect |
|-----------|---------|--------|
| `play` | `?play=hymn:198` | **Clear queue**, play single item immediately |
| `queue` | `?queue=plex:67890` | Resolve container, **replace queue**, start playing |
| `volume` | `?volume=50` | Set volume (0-100) |
| `shuffle` | `?shuffle=true` | Enable shuffle mode |
| `shader` | `?shader=focused` | Set visual shader |
| `device` | `?device=livingroom-tv` | Target device for casting (vs local play) |
| *(alias)* | `?hymn=100` | Shorthand for `?play=hymn:100` |
| *(alias)* | `?scripture=bom` | Shorthand for `?play=scripture:bom` |

**Alias rule:** Any unknown URL param key is treated as a source prefix.
`?key=value` → `?play=key:value`. This means `?hymn=100`, `?plex=12345`,
`?scripture=bom` all work without explicit `?play=` prefix.

**Compound example:** `?hymn=198&device=livingroom-tv` = send hymn 198 to the living room TV.

**No device param** = play locally in MediaApp's own player.

**Loading state:** `?queue=` requires backend container resolution (API call)
before playback can start. MediaApp shows a loading spinner in the NowPlaying
view until resolution completes. The `useMediaUrlParams` hook triggers
resolution on mount and feeds results to `useMediaQueue` once ready.

`?add=` and `?next=` are **not** URL params — they require an existing queue,
which doesn't exist on a fresh page load. Use the WebSocket `media:command`
path for runtime queue additions (`add`, `next`).

### Shared URL Parser: `parseAutoplayParams()`

TVApp already has URL parsing logic (lines 96-192 of `TVApp.jsx`) that handles
content ID normalization, config modifier extraction, action mapping, and the
alias shorthand. This should be extracted into a shared utility:

```
frontend/src/lib/parseAutoplayParams.js
```

**Core logic (extracted from TVApp):**

```js
// Normalize bare digits to plex:, pass compound IDs through
function toContentId(value) {
  if (/^[a-z]+:.+$/i.test(value)) return value;  // already compound
  if (/^\d+$/.test(value)) return `plex:${value}`; // bare digits
  return value;
}

// Extract config modifiers from URL params
const CONFIG_KEYS = ['volume', 'shader', 'shuffle', 'playbackRate', 'continuous'];

// Parse URL → { action, contentId, config }
export function parseAutoplayParams(searchString, supportedActions) {
  // 1. Extract config modifiers (volume, shader, etc.)
  // 2. Match first known action key (play, queue, etc.)
  // 3. If no action matched, try alias: ?key=value → play key:value
  // 4. Return { action, contentId, config } or null
}
```

**Per-app supported actions:**

| App | Supported Actions |
|-----|-------------------|
| TVApp | `play`, `queue`, `playlist`, `random`, `display`, `read`, `open`, `app`, `launch`, `list` |
| MediaApp | `play`, `queue` |

TVApp continues to support the full set (display, read, open, launch, etc.)
because it renders non-playable content too. MediaApp only handles playable
content, so it supports a smaller subset.

TVApp's `autoplay` useMemo refactors to:
```js
const autoplay = useMemo(() => parseAutoplayParams(window.location.search, TV_ACTIONS), []);
```

MediaApp's `useMediaUrlParams` calls:
```js
const command = useMemo(() => parseAutoplayParams(window.location.search, MEDIA_ACTIONS), []);
```

---

## Playback Monitoring

### Two Concerns, Two Channels

Playback involves two distinct concerns that should not be conflated:

| Concern | Channel | Purpose |
|---------|---------|---------|
| **Progress persistence** | `POST /play/log` (REST) | Persist watch state (playhead, percent, playCount). Syncs to source (e.g., Plex "watched"). Survives restarts. **Keep as-is.** |
| **Live now-playing state** | Event bus broadcast (WebSocket) | Real-time "what's playing where" for monitoring UIs. Ephemeral — no persistence needed. **New.** |

### Client Identity

Three types of clients play content. Each needs an identity for playback
broadcasts:

| Client Type | Identity Source | Example | Controllable? |
|-------------|----------------|---------|---------------|
| Registered device | `devices.yml` key | `livingroom-tv`, `office-tv` | Yes — full remote (transport, volume, cast) |
| Mobile browser | localStorage (generated on first load) | `browser:a3f1b20c` "Dad's phone" | Read-only — "also playing" card |
| Desktop browser | localStorage (generated on first load) | `browser:7e4d9c12` "Kitchen laptop" | Read-only — "also playing" card |

**Registered devices** get their identity from the route or app context — TVApp
on the Shield TV knows it's `livingroom-tv` because it was loaded via
`/tv?device=livingroom-tv` or FKB config.

**Browser/mobile clients** generate a persistent short ID on first MediaApp load,
stored in `localStorage`. User names it once ("Dad's phone") — also stored in
localStorage. Sent on WebSocket connect as client metadata. No registration in
`devices.yml` needed — these are ephemeral personal players, not infrastructure.

### Broadcast Flow

```
Any Player (TV, Office, MediaApp, phone)
    │
    ├── POST /play/log               ← persistence (keep as-is)
    │     └── mediaProgressMemory.set(...)
    │
    └── wsService.send({              ← live state (NEW)
          type: 'playback_state',
          clientId: 'livingroom-tv',
          contentId: 'plex:12345',
          title: 'Movie Title',
          format: 'video',
          position: 1234,
          duration: 7200,
          state: 'playing',           // playing | paused | stopped
          thumbnail: '/api/v1/display/plex/12345'
        })
            │
            ▼
        EventBus.onClientMessage
          → validates payload
          → eventBus.broadcast('playback:{clientId}', payload)
            │
            ▼
        MediaApp subscribes via predicate: topic.startsWith('playback:')
          → renders device/client cards with live state
```

**Frequency:** Broadcast every 5 seconds while playing, once on state change
(play/pause/stop/skip). No broadcast when idle.

### Backend: Event Bus Handler

The event bus needs a message handler registered in `app.mjs` to route
incoming `playback_state` messages to the broadcast topic:

```js
eventBus.onClientMessage((clientId, message) => {
  if (message.type === 'playback_state' && message.clientId) {
    eventBus.broadcast(`playback:${message.clientId}`, {
      type: 'now-playing',
      ...message
    });
  }
});
```

This is the only backend change needed for playback monitoring. No new
endpoints, no new services — just a message handler on the existing event bus.

**Identity note:** The `onClientMessage(clientId, message)` callback's `clientId`
is the WebSocket connection ID (server-assigned), NOT the `message.clientId`
payload field. The handler should use `message.clientId` (the self-reported
device/browser identity) for the broadcast topic, not the connection ID.

### WebSocket Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `media:queue` | Subscribe | Queue state sync — backend broadcasts after every mutation |
| `media:command` | Backend-only | External triggers processed by backend event handler |
| `playback:{clientId}` | Subscribe | Live now-playing from a specific client |
| `homeline:{deviceId}` | Subscribe | Wake progress events when casting |

**Monitoring all playback:** The event bus does NOT support prefix wildcards like
`playback:*`. To monitor all clients, `useDeviceMonitor` subscribes with a
**predicate function**:

```js
wsService.subscribe(
  msg => msg.topic?.startsWith('playback:'),
  handlePlaybackState
);
```

Frontend `WebSocketService.subscribe()` already supports predicate filters —
no backend changes needed for this pattern.

### What Needs to Change in TVApp / OfficeApp

Today, devices receive commands but don't report state back. To enable
monitoring, each app that plays content needs to periodically send
`playback_state` messages over its existing WebSocket connection.

**TVApp:** Add a `usePlaybackBroadcast(playerRef, deviceId)` hook that reads
Player's imperative handle every 5 seconds and sends state. The deviceId
comes from the URL or FKB config.

**OfficeApp:** Same hook, same pattern. DeviceId from config or URL.

**MediaApp:** Same hook, but `clientId` comes from localStorage instead of
devices.yml.

This is additive — no changes to existing Player.jsx internals. Each app
just adds one hook that reads player state and sends a WebSocket message.

---

## Device Registry & Remote Control

### Device Sources

MediaApp's device panel aggregates two sources:

| Source | Shows | Controls |
|--------|-------|----------|
| `GET /api/v1/device` (filtered to `content_control` devices) | Registered devices from `devices.yml` | Full remote: transport, volume, cast, power |
| `playback:{clientId}` WebSocket events (via predicate subscription) | Any client currently playing | Read-only: now-playing info |

Registered devices appear even when idle (showing offline/no content).
Browser clients only appear while actively playing.

### Registered Device Types

| Device | Type | Content Control | Cast Method |
|--------|------|----------------|-------------|
| `livingroom-tv` | shield-tv | fully-kiosk | FKB loadURL + ADB fallback |
| `office-tv` | linux-pc | websocket | WebSocket broadcast to `office` topic |
| `piano` | midi-keyboard | — | Not castable (no content control) |

Devices without `content_control` are hidden from the cast UI.

### Device Card Features

| Feature | Registered devices | Browser clients |
|---------|-------------------|-----------------|
| Now-playing info | Yes (via `playback:{deviceId}`) | Yes (via `playback:{clientId}`) |
| Transport controls | Yes (forwarded via device API) | No |
| Volume control | Yes (via device volume API) | No |
| Cast button | Yes (send content to device) | No |
| Power on/off | Yes (via device_control) | No |
| Online/offline status | Yes (WebSocket heartbeat or HA sensor) | Implicit (visible = online) |

---

## Phased Roadmap

### Phase 1: Foundation (Shell + Local Playback)

**Goal:** MediaApp route exists, plays content locally with basic transport controls.

- [ ] MediaApp route registration (`/media` in app router)
- [ ] MediaApp layout shell (mobile-first responsive container)
- [ ] Extract `parseAutoplayParams()` from TVApp into `frontend/src/lib/parseAutoplayParams.js`
- [ ] Refactor TVApp to use shared parser (no behavior change)
- [ ] Wire shared parser into MediaApp for `?play=`, `?queue=`, and aliases
- [ ] MediaAppPlayer wrapper (Player.jsx in single-play mode, fullscreen toggle)
- [ ] Basic NowPlaying view (album art/thumbnail, title, progress, play/pause/next)
- [ ] Wire up `?play=contentId` to resolve and play content
- [ ] MiniPlayer bar (persistent bottom bar when content is playing)
- [ ] SCSS styling (mobile-first, PlexAmp-inspired dark theme)

**Reuses:** Player.jsx, SinglePlayer, all existing renderers, Play API, Display API.

### Phase 2: Queue Management

**Goal:** PlexAmp-style queue with backend persistence.

- [ ] Backend `MediaQueue` domain entity (add, remove, reorder, advance)
- [ ] Backend `MediaQueueService` application service (CRUD, persistence to YAML)
- [ ] Backend `/api/v1/media/queue` router (REST endpoints)
- [ ] Frontend `useMediaQueue` hook (fetch, mutate, sync with backend)
- [ ] QueueDrawer UI (slide-up on mobile, sidebar on desktop)
- [ ] Drag-to-reorder queue items
- [ ] Queue item actions (play next, move to end, remove)
- [ ] Wire `?queue=` URL param
- [ ] Backend: register `media:command` event handler that routes commands through `MediaQueueService` and broadcasts result on `media:queue`
- [ ] Frontend: `useMediaQueue` subscribes to `media:queue` for state sync (does NOT process `media:command` directly)
- [ ] Minimal ContentBrowser UI (search bar + results list with Play/Add/Next actions)
- [ ] Wire `useStreamingSearch` with `capability=playable` filter
- [ ] Search result actions: play now, play next, add to queue
- [ ] Queue position tracking + auto-advance on item completion

**Reuses:** Queue API (container resolution), `ContentSearchCombobox` / `useStreamingSearch`.

### Phase 3: Playback Monitoring & Remote Control

**Goal:** See what's playing everywhere, cast content to registered devices.

- [ ] `usePlaybackBroadcast(playerRef, clientId)` hook — sends `playback_state` over WebSocket every 5s while playing
- [ ] Add `usePlaybackBroadcast` to MediaApp (clientId from localStorage)
- [ ] `useDeviceIdentity()` hook — reads `deviceId` from URL query params (injected by WakeAndLoadService)
- [ ] Modify `WakeAndLoadService.execute()` to inject `deviceId` into load query
- [ ] Add `usePlaybackBroadcast` to TVApp (deviceId from `useDeviceIdentity`)
- [ ] Add `usePlaybackBroadcast` to OfficeApp (deviceId from `useDeviceIdentity`)
- [ ] Backend: register `playback_state` message handler on event bus in `app.mjs`
- [ ] MediaApp: browser client identity (generate ID + name on first load, persist in localStorage)
- [ ] Browser client identity: auto-generate name from user-agent shortname (e.g., "Chrome on iPhone"), persist in localStorage alongside generated ID. User can rename later via DevicePanel — no first-load modal blocking interaction.
- [ ] Device list from `/api/v1/device` (filter to castable devices)
- [ ] DevicePanel UI — registered devices + browser clients via playback predicate subscription
- [ ] Cast button: send queue item or search result to a device
- [ ] Wire `?device=` URL param for cast-via-URL
- [ ] Remote transport controls (play/pause/skip forwarded via device API)
- [ ] Remote volume control
- [ ] Wake-and-load integration (power on device before casting)

**Reuses:** Device load API, `WakeAndLoadService`, `WebSocketEventBus`, `useWakeProgress`.

**Risk note:** Adding `usePlaybackBroadcast` to TVApp and OfficeApp is
additive but touches production apps. Test broadcast hook in MediaApp first,
then port to TV/Office with careful regression testing.

### Phase 4: Content Library & Polish

**Goal:** Content discovery, personalization, and UX refinement.

- [ ] ContentBrowser upgrade: browse-by-source tabs, source filter chips
- [ ] Extract `useContentBrowse` from ContentSearchCombobox for container drill-down
- [ ] Recently played list (persisted, backend)
- [ ] Pinned/favorited items (user config, persisted)
- [ ] Fullscreen player mode (for scrollers, video — with back/close button)
- [ ] MiniPlayer ↔ NowPlaying smooth transition
- [ ] Desktop layout optimization (sidebar queue, main content area)
- [ ] Keyboard shortcuts (space = play/pause, arrows = seek/skip)
- [ ] Queue shuffle animation / visual feedback
- [ ] Now-playing notification integration (optional)

### Phase 5: Future (Deferred)

- [ ] Multi-user support (per-user queues, identity)
- [ ] Permission hierarchy for casting (prompt, priority, deny)
- [ ] Device grouping (play on multiple devices simultaneously)
- [ ] Shared listening sessions
- [ ] Offline queue / download
- [ ] Device playback tracking (which device played what, history)
- [ ] Smart playlists / auto-queue based on time of day or context

---

## UX Reference: PlexAmp Patterns

The following PlexAmp patterns should inform the MediaApp design:

| Pattern | PlexAmp Behavior | MediaApp Adaptation |
|---------|-------------------|---------------------|
| **Now Playing** | Large album art, track info, progress bar, transport controls | Same, but with content format awareness (show verse count for singalongs, page count for readable) |
| **Queue drawer** | Swipe up from bottom, shows upcoming items | Same — slide-up on mobile, fixed sidebar on desktop |
| **Add to queue** | Long-press → "Play Next" / "Add to Queue" | Tap item → action menu with same options |
| **Search** | Top search bar, results grouped by type | Reuse streaming search with source grouping |
| **Mini player** | Persistent bottom bar with thumbnail, title, play/pause | Same — tapping expands to full NowPlaying |
| **Cast** | Cast icon in header, shows available devices | Device panel with live status |

---

## File Plan

```
frontend/src/Apps/
  MediaApp.jsx              # Route entry point, layout shell
  MediaApp.scss             # Styles (mobile-first, dark theme)

frontend/src/modules/Media/
  MediaAppPlayer.jsx        # Thin Player.jsx wrapper (embedded/fullscreen, ref forwarding)
  NowPlaying.jsx            # Main player view (transport controls, progress, track info)
  MiniPlayer.jsx            # Persistent bottom bar
  QueueDrawer.jsx           # Queue management UI
  QueueItem.jsx             # Individual queue item
  ContentBrowser.jsx        # Search + library + browse
  DevicePanel.jsx           # Device list + remote control
  DeviceCard.jsx            # Per-device status + controls
  CastButton.jsx            # Send to device action
  # FullscreenOverlay.jsx removed — fullscreen is a CSS state on MediaAppPlayer

frontend/src/lib/
  parseAutoplayParams.js    # Shared URL parser (extracted from TVApp, used by TVApp + MediaApp)

frontend/src/hooks/media/
  useMediaQueue.js          # Queue state + backend sync
  usePlaybackBroadcast.js   # Sends playback_state over WebSocket (shared by all apps)
  useDeviceMonitor.js       # Subscribes via predicate for live device/client state
  useMediaClientId.js       # Browser client identity (localStorage ID + name)
  useDeviceIdentity.js      # Reads deviceId from URL params (injected by WakeAndLoadService)

backend/src/2_domains/media/
  MediaQueue.mjs            # Queue entity

backend/src/3_applications/media/
  MediaQueueService.mjs     # Queue CRUD + persistence
  ports/
    IMediaQueueDatastore.mjs  # Port interface

backend/src/1_adapters/persistence/yaml/
  YamlMediaQueueDatastore.mjs # YAML persistence adapter

backend/src/4_api/v1/routers/
  media.mjs                 # Queue REST API
```

---

## Resolved Questions

1. ~~**Now-playing broadcast gap**~~ → Resolved: `usePlaybackBroadcast` hook sends `playback_state` over WebSocket every 5s while playing, once on state change. Added to TVApp, OfficeApp, MediaApp in Phase 3.
2. ~~**Queue sync across tabs**~~ → Resolved: Yes, via `media:queue` WebSocket topic.
3. ~~**Repeat modes**~~ → Resolved: `off`, `one`, `all` — standard repeat cycle in MediaQueue entity.
4. ~~**Scroller content in queue**~~ → Resolved: Starts embedded in now-playing card (industry-standard lyrics pattern). User taps to expand to fullscreen. See MediaAppPlayer spec.

5. ~~**`?play=` clears the queue**~~ → Resolved: Intentional. URL params are an override/debug mechanism, not normal use. WebSocket `media:command` is the preferred trigger path for non-destructive queue operations.

## Resolved Questions (continued)

6. ~~**TVApp device identity**~~ → Resolved: `WakeAndLoadService.execute()` injects `deviceId` into the query when loading content onto a device (`device.loadContent('/tv', { ...query, deviceId })`). TVApp reads it from `window.location.search`. New `useDeviceIdentity()` hook wraps this: returns `{ deviceId, isKiosk }`. For browser-based MediaApp clients, `deviceId` is null and `isKiosk` is false — they use the localStorage-based `useMediaClientId` instead. No changes to FKB config, routing, or API contracts needed.

## Open Questions

*(None remaining)*

---

## User Stories

### 1. Local Playback

| # | Story |
|---|-------|
| 1 | Play a hymn by number to practice for Sunday |
| 2 | Play a Plex movie on my phone while in bed |
| 3 | Listen to an audiobook from AudioBookShelf while doing chores |
| 4 | Follow along with a scripture readalong at my own pace |
| 5 | Play a Primary song for the kids |
| 6 | See album art or a thumbnail while music plays |
| 7 | See elapsed and remaining time on a progress bar |
| 8 | Scrub/seek to a specific point by dragging the progress bar |
| 9 | Pause playback and resume right where I left off |
| 10 | Adjust volume without leaving the player |
| 11 | Video auto-fullscreens when it starts playing |
| 12 | Exit video fullscreen with the back button to see the rest of the app |
| 13 | See a MiniPlayer bar at the bottom while browsing other parts of the app |
| 14 | Tap the MiniPlayer to jump back to the full Now Playing view |
| 15 | Playback continues uninterrupted while searching for more content or managing the queue |

### 2. Queue Management

| # | Story |
|---|-------|
| 1 | See the entire upcoming queue |
| 2 | Add a song to the end of the queue |
| 3 | "Play next" a song so it plays right after the current track |
| 4 | Swipe to remove a single item from the queue |
| 5 | Drag items to reorder the queue without interrupting playback |
| 6 | Clear the entire queue to start fresh |
| 7 | Toggle shuffle so the queue plays in random order |
| 8 | Cycle repeat modes (off / repeat one / repeat all) with a single tap |
| 9 | See the currently playing item highlighted in the queue |
| 10 | Tap "next" to skip to the next item |
| 11 | Tap "previous" to go back to the last item |
| 12 | Playback auto-advances to the next item when the current one finishes |
| 13 | "Repeat one" loops the current track until I manually skip |
| 14 | "Repeat all" loops back to the beginning after the last item |
| 15 | Queue survives a page refresh |
| 16 | Queue survives closing and reopening the browser tab |
| 17 | See a clear error message if the queue is full (500 items) |
| 18 | Tap any item in the queue to jump directly to it |

### 3. Content Discovery

| # | Story |
|---|-------|
| 1 | Search across all sources at once |
| 2 | See results stream in progressively (Plex first, then hymns, then audiobooks) |
| 3 | Filter to "Music" only to see audio from Plex |
| 4 | Filter to "Video" only to see movies and TV shows |
| 5 | Filter to "Hymns" only when preparing for church |
| 6 | Filter to "Audiobooks" for long-form listening |
| 7 | Type `hymn:amazing` as shorthand to search only hymns |
| 8 | Search results grouped by source for quick scanning |
| 9 | See thumbnails and durations on search results |
| 10 | Tap into an album or show to see its tracks/episodes |
| 11 | Back button after drilling into a container to navigate up |
| 12 | Tap "Play Now" on a search result to start it immediately |
| 13 | Tap "Add to Queue" on a search result without leaving search |
| 14 | Tap "Play Next" on a search result to queue it right after the current track |
| 15 | Cast a search result directly to a device without adding it to the local queue |
| 16 | Only playable content appears in results |

### 4. Remote Control & Monitoring

| # | Story |
|---|-------|
| 1 | See a list of all household devices (TV, office, etc.) even when idle |
| 2 | See what's currently playing on each device — title, thumbnail, progress |
| 3 | See online/offline status for each registered device |
| 4 | Play/pause a remote device from my phone |
| 5 | Skip forward/back on a remote device |
| 6 | Adjust volume on a remote device |
| 7 | Power a device on or off from the device panel |
| 8 | See "also playing" cards for other browser clients (e.g. "Dad's phone", "Kitchen laptop") |
| 9 | Browser clients appear automatically when they start playing and disappear when they stop |
| 10 | Registered devices always appear in the list, even with no content playing |
| 11 | See real-time progress updates (refreshes every 5 seconds) |
| 12 | Distinguish at a glance between controllable devices and read-only browser clients |

### 5. Casting

| # | Story |
|---|-------|
| 1 | Cast the currently playing item to a household device |
| 2 | Cast a search result directly to a device without playing it locally first |
| 3 | Pick which device to cast to from a device picker |
| 4 | Device wakes up automatically if it's asleep/off when I cast to it |
| 5 | See a progress indicator while a device is waking up |
| 6 | Cast a specific item to a specific device via URL (`?hymn=198&device=livingroom-tv`) |
| 7 | Only see castable devices in the picker (no MIDI keyboards or non-content devices) |
| 8 | Cast replaces whatever was playing on the target device (no confirmation needed) |
| 9 | Cast a queue item from the queue list to a device (not just the current track) |
| 10 | After casting, see the target device's now-playing update to confirm it worked |

### 6. External Triggers & Deep Links

| # | Story |
|---|-------|
| 1 | Open `?play=hymn:198` to immediately play a specific hymn |
| 2 | Open `?queue=plex:67890` to load an entire playlist and start playing |
| 3 | Use shorthand aliases like `?hymn=100` instead of `?play=hymn:100` |
| 4 | Set volume via URL (`?volume=50`) |
| 5 | Enable shuffle via URL (`?shuffle=true`) |
| 6 | Home Assistant automation sends a "play" command via WebSocket to start a hymn at bedtime |
| 7 | CLI tool adds a song to the queue via WebSocket without interrupting what's playing |
| 8 | Another DaylightStation app pushes content into my queue via WebSocket |
| 9 | WebSocket commands work even when no MediaApp tab is open (headless/backend-only) |
| 10 | WebSocket "play" interrupts current playback but keeps the rest of the queue intact |
| 11 | WebSocket "add" appends to the end without interrupting anything |
| 12 | WebSocket "next" inserts after the current item |
| 13 | WebSocket "queue" replaces the entire queue with a new playlist |
| 14 | WebSocket "clear" stops playback and empties the queue |
| 15 | `?play=` clears the existing queue (intentional — it's an override mechanism) |
| 16 | See a loading spinner while `?queue=` resolves a container before playback starts |

### 7. Cross-Device Sync

| # | Story |
|---|-------|
| 1 | Open MediaApp on phone and laptop — both show the same queue |
| 2 | Add an item on phone, see it appear on laptop within a second |
| 3 | Remove an item on laptop, see it disappear on phone |
| 4 | Reorder items on one device, see the new order reflected everywhere |
| 5 | Skip a track on one device, see the position update on the other |
| 6 | Changes feel instant on the acting device (optimistic updates) |
| 7 | If the backend save fails, local state rolls back with a toast explaining what happened |
| 8 | One automatic retry happens after a backend failure before giving up |
| 9 | Playback continues even if the backend is temporarily unreachable |
| 10 | No duplicate items when two tabs are open and I add something from one |
| 11 | No brief flicker/double-add on the originating tab after adding an item |

### 8. Content Format Handling

| # | Story |
|---|-------|
| 1 | Audio plays with an album art card in embedded view — never auto-fullscreens |
| 2 | Video auto-enters fullscreen when it starts playing |
| 3 | Exit video fullscreen with back button or swipe down |
| 4 | Singalong plays embedded with lyrics visible in the now-playing card |
| 5 | Tap a singalong to expand it to fullscreen for easier reading |
| 6 | Readalong plays embedded with text visible in the now-playing card |
| 7 | Tap a readalong to expand to fullscreen |
| 8 | Transport controls overlay on top of fullscreen content |
| 9 | Now Playing shows format-appropriate metadata (verse count for hymns, chapter for audiobooks, duration for video) |
| 10 | Queue items show a format badge to distinguish audio from video from singalong at a glance |
| 11 | Switching between a video and audio queue item transitions smoothly between fullscreen and embedded |
| 12 | Fullscreen doesn't remount the player — playback continues uninterrupted during the transition |
