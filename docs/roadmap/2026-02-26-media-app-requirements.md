# MediaApp — Requirements Traceability Registry

> Structured requirements document for commit-level traceability and code quality review.
> Each requirement has a unique ID (e.g., `2.1.3`) that developers reference in commit messages.

**Companion to:** `2026-02-26-media-app-design.md` (narrative architecture reference)
**Last Updated:** 2026-02-27
**Status:** Phase 5 Implemented

---

## How to Use This Document

- **Committing:** Reference requirement IDs in commit messages: `feat(media): 2.1.3 play-next inserts after current position`
- **Reviewing:** Verify each commit maps to at least one requirement ID
- **Tracking:** Check off requirements as they pass review
- **Dependencies:** `Depends on: X.Y.Z` means that requirement must be implemented first

---

## Phase Mapping

| Phase | Sections | Goal |
|-------|----------|------|
| Phase 1: Foundation | 0.1–0.9, 1.1–1.2 | Route exists, plays content locally with basic transport |
| Phase 2: Queue | 2.1–2.2, 3.1–3.2, 6.1–6.2 | PlexAmp-style queue with persistence, search, external triggers |
| Phase 3: Monitoring | 4.1–4.2, 5.1–5.2, 7.1–7.2 | Device monitoring, casting, cross-device sync |
| Phase 4: Polish | 8.1–8.2 | Content format handling, fullscreen, UX refinement |

---

## 0. Foundation & Infrastructure

Cross-cutting architecture work that is prerequisite for multiple feature sections.

### 0.1 DDD Layer Wiring

**0.1.1** Register `createMediaServices()` factory in `bootstrap.mjs`
- Creates `YamlMediaQueueDatastore` and `MediaQueueService`
- Accepts `{ configService, logger }`, returns `{ store, service }`
- Follows `createFitnessServices()` pattern

**0.1.2** Register `createMediaApiRouter()` factory in `bootstrap.mjs`
- Accepts `{ mediaServices, contentIdResolver, configService, broadcastEvent, logger }`
- Content resolution stays in router, not service (DDD dependency rule)
- Follows `createFitnessApiRouter()` pattern

**0.1.3** Add route entry `'/media': 'media'` to `api.mjs` routeMap

**0.1.4** Wire both factories in app startup
- Call `createMediaServices()`, pass result to `createMediaApiRouter()`
- Mount returned router in Express app

### 0.2 MediaQueue Domain Entity

**0.2.1** Create `MediaQueue` class in `2_domains/media/entities/MediaQueue.mjs`
- Constructor: `{ position, shuffle, repeat, volume, items, shuffleOrder }`
- Mutable public fields (matches `Session.mjs` pattern)
- `toJSON()` / `static fromJSON(data)` / `static empty()`

**0.2.2** Queue manipulation methods
- `addItems(items, placement)` — assigns `queueId` (8-char hex) per item, enforces `MAX_QUEUE_SIZE = 500`
- `removeByQueueId(queueId)` — removes by stable ID, adjusts position
- `reorder(queueId, toIndex)` — moves item, adjusts position
- `advance(step, { auto })` — respects repeat modes (off/one/all)
- `clear()` — empties items, resets position

**0.2.3** Position stability invariant
- `position` always clamped to `[0, items.length - 1]` (or 0 when empty)
- Mutations before current position adjust position to keep current item stable

**0.2.4** Shuffle model
- `setShuffle(enabled)` generates/clears `shuffleOrder` (Fisher-Yates)
- Current item placed at `shuffleOrder[0]`
- Toggle off resets to original-order index (Spotify behavior)
- Add/remove updates `shuffleOrder` incrementally

**0.2.5** Repeat + advance interaction
- `off` + auto-advance at end → `currentItem` returns null (stop)
- `one` + auto → stay on same item; manual → move normally
- `all` + auto at end → wrap to position 0

**0.2.6** Accessors: `currentItem`, `isEmpty`, `length`, `findByQueueId()`

### 0.3 Queue Error Types

**0.3.1** Extend `2_domains/media/errors.mjs` with `QueueFullError extends DomainInvariantError`

**0.3.2** Error mapping: `QueueFullError` → 422, `EntityNotFoundError` → 404, `ValidationError` → 400

### 0.4 Persistence Layer

**0.4.1** Create `IMediaQueueDatastore` port in `3_applications/media/ports/`
- `load(householdId)` → `MediaQueue | null`
- `save(mediaQueue, householdId)`

**0.4.2** Create `YamlMediaQueueDatastore` in `1_adapters/persistence/yaml/`
- Path: `configService.getHouseholdAppPath('media', hid) + '/queue'`
- Uses `loadYamlSafe` / `saveYaml` from `FileIO.mjs`
- Returns `MediaQueue.fromJSON(data)` on load

### 0.5 Application Service

**0.5.1** Create `MediaQueueService` in `3_applications/media/`
- Constructor: `{ queueStore, defaultHouseholdId }`
- Methods: `load`, `replace`, `addItems`, `removeItem`, `reorder`, `setPosition`, `updateState`, `clear`
- No content-domain dependencies (resolution happens in router)

### 0.6 Router Shell

**0.6.1** Create `createMediaRouter()` in `4_api/v1/routers/media.mjs`
- 8 endpoints per design doc (GET/PUT/POST/DELETE/PATCH on queue resources)
- `asyncHandler` on all async routes
- `resolveHid(req)` helper using `req.query.household` with default fallback
- `broadcastEvent('media:queue', ...)` after every mutation

### 0.7 `addedFrom` Constants

**0.7.1** Define `ADDED_FROM` enum in entity file: `SEARCH`, `URL`, `CAST`, `WEBSOCKET`
- Pass-through metadata only — no domain logic branches on these values

### 0.8 Logging

**0.8.1** Backend: `MediaQueueService` emits structured log events via injected `logger`
- `media-queue.loaded`, `media-queue.saved`, `media-queue.items-added`, `media-queue.item-removed`, `media-queue.reordered`, `media-queue.position-changed`, `media-queue.cleared`

**0.8.2** Frontend: `useMediaQueue` logger via lazy `getLogger().child({ component: 'useMediaQueue' })`
- `media-queue.sync-received`, `media-queue.optimistic-rollback`, `media-queue.backend-unreachable`

### 0.9 Shared Utility

**0.9.1** Extract `parseAutoplayParams()` from `TVApp.jsx` into `frontend/src/lib/parseAutoplayParams.js`
- Accepts `(searchString, supportedActions)`
- Returns `{ action, contentId, config }` or null
- Handles alias rule: unknown param key → `play key:value`

**0.9.2** Refactor TVApp to use shared parser (no behavior change)

---

## 1. Local Playback & Player

### 1.1 Requirements

**1.1.1** Play content by URL parameter
- `?play=hymn:198` resolves via Play API and starts playback immediately
- Clears any existing queue (URL params are override mechanism)
- Depends on: 0.9.1

**1.1.2** Play content by alias shorthand
- `?hymn=198` → treated as `?play=hymn:198`
- Any unknown URL param key treated as source prefix
- Depends on: 0.9.1

**1.1.3** Render Player in single-play mode
- `<Player play={currentItem} clear={onItemEnd} ref={playerRef} />`
- Never uses `queue=` prop (useMediaQueue owns queue state)
- Depends on: 0.2.6 (currentItem accessor)

**1.1.4** Display track info during playback
- Title, artist/source, source badge (Plex, Hymn, ABS, etc.)
- Thumbnail via Display API (`ContentDisplayUrl()`)

**1.1.5** Display seekable progress bar
- Shows elapsed and remaining time
- Drag to seek via `playerRef.seek()`
- Updates from `onProgress` callback or polling `playerRef.getCurrentTime()`

**1.1.6** Provide transport controls
- Play/pause, previous, next
- Play/pause calls `playerRef.toggle()`
- Next/previous delegate to queue advance (Section 2), but in Phase 1 with single-play mode: next = no-op, prev = restart

**1.1.7** Provide volume control
- Sets `HTMLMediaElement.volume` (local player only)
- Range 0.0–1.0
- `?volume=50` URL param sets initial volume (0–100 scale, divided by 100)

**1.1.8** MiniPlayer persistent bar
- Always visible at bottom when content is playing
- Shows: thumbnail, title, play/pause button, thin progress indicator
- Tap expands to full NowPlaying view

**1.1.9** Playback continues during navigation
- Browsing queue, searching, or managing devices does not interrupt playback
- Player stays mounted; only view changes

### 1.2 Technical Infrastructure

**1.2.1** Create `MediaApp.jsx` route entry point
- Route: `/media`
- Mobile-first responsive layout shell
- `className='App media-app'`
- Logger: `getLogger().child({ app: 'media' })`
- Depends on: 0.1.3 (route registration)

**1.2.2** Create `MediaAppProvider` context
- Provides: queue state, playback state, player ref
- Wraps all child components

**1.2.3** Create `MediaAppPlayer.jsx` wrapper
- Thin wrapper around `Player.jsx` for single-play mode
- Exposes `playerRef` upward for external transport controls
- Forwards `onProgress` / `onPlaybackMetrics` to provide currentTime, duration, isPaused
- Manages embedded vs fullscreen CSS state (not portal-based)

**1.2.4** Create `NowPlaying.jsx`
- Main player view: MediaAppPlayer + TrackInfo + ProgressBar + TransportControls + VolumeControl
- Reads player state from `playerRef` and `onProgress` callbacks

**1.2.5** Create `MiniPlayer.jsx`
- Bottom bar component, conditionally rendered when `currentItem` exists
- Tap handler navigates to NowPlaying view

**1.2.6** Create `useMediaUrlParams` hook
- Calls `parseAutoplayParams(window.location.search, MEDIA_ACTIONS)`
- `MEDIA_ACTIONS = ['play', 'queue']`
- Triggers content resolution on mount, feeds result to queue/player
- Shows loading spinner during `?queue=` resolution

**1.2.7** SCSS styling (`MediaApp.scss`)
- Mobile-first, PlexAmp-inspired dark theme
- Full viewport layout (100% width/height)
- MiniPlayer fixed bottom positioning

---

## 2. Queue Management

### 2.1 Requirements

**2.1.1** View the full upcoming queue
- Slide-up drawer on mobile, sidebar on desktop
- Currently playing item visually highlighted

**2.1.2** Add item to end of queue
- From search results, content browser, or external triggers
- Item receives stable `queueId` on add
- Depends on: 0.2.2

**2.1.3** Play next (insert after current)
- Inserted at `position + 1`
- Does not interrupt current playback

**2.1.4** Remove single item from queue
- Swipe-to-remove gesture on mobile
- Position adjusts to keep current item stable
- Depends on: 0.2.3

**2.1.5** Drag to reorder queue items
- Drag-and-drop reordering without interrupting playback
- Position adjusts to keep current item stable
- Depends on: 0.2.3

**2.1.6** Clear entire queue
- Empties all items, resets position to 0
- Stops playback

**2.1.7** Toggle shuffle mode
- Generates `shuffleOrder` via Fisher-Yates
- Current item stays playing (placed at `shuffleOrder[0]`)
- Toggle off returns to original order at current item's position
- Depends on: 0.2.4

**2.1.8** Cycle repeat modes
- Single tap cycles: off → one → all → off
- Visual indicator shows current mode
- Depends on: 0.2.5

**2.1.9** Skip to next item
- Manual advance moves position forward
- Escapes repeat-one loop on manual press
- At end of queue with repeat off → stops playback

**2.1.10** Go back to previous item
- Manual advance moves position backward
- Clamps to 0 (or wraps with repeat-all)

**2.1.11** Auto-advance on item completion
- When Player calls `clear()` (item ended), queue advances
- Repeat-one replays same item; repeat-all wraps at end
- Repeat-off at end → `currentItem` returns null, playback stops
- Depends on: 0.2.5

**2.1.12** Tap queue item to jump to it
- Sets position directly to tapped item's index
- Begins playback of that item immediately

**2.1.13** Queue survives page refresh
- Queue persisted to backend YAML after every mutation
- On page load, `useMediaQueue` fetches from `GET /api/v1/media/queue`
- Depends on: 0.4.1, 0.4.2, 0.5.1

**2.1.14** Queue survives browser close/reopen
- Same mechanism as 2.1.13 — backend persistence

**2.1.15** Queue full error at 500 items
- `addItems()` throws `QueueFullError`
- API returns 422 with clear message
- Frontend shows error toast
- Depends on: 0.3.1

### 2.2 Technical Infrastructure

**2.2.1** Create `useMediaQueue` hook
- Fetches queue from REST API on mount
- Exposes: `items`, `position`, `currentItem`, `shuffle`, `repeat`, `volume`
- Mutation methods: `addItems()`, `removeItem()`, `reorder()`, `setPosition()`, `advance()`, `clear()`, `setShuffle()`, `setRepeat()`, `setVolume()`
- Depends on: 0.5.1, 0.6.1

**2.2.2** Optimistic updates in `useMediaQueue`
- Mutations apply to local state immediately, then sync to backend
- On API failure: roll back to last-known-good state, show error toast, retry once after 2s
- If retry fails, local state diverges until next successful operation (full PUT)
- Depends on: 0.8.2

**2.2.3** Create `QueueDrawer.jsx`
- Mobile: slide-up from bottom
- Desktop: fixed sidebar
- Contains: QueueHeader (clear, shuffle toggle), QueueItemList, QueueActions

**2.2.4** Create `QueueItem.jsx`
- Displays: thumbnail, title, source badge, duration, format badge
- Actions: play next, move to end, remove
- Swipe-to-remove gesture
- Drag handle for reordering

**2.2.5** Wire `?queue=` URL parameter
- Resolves container via Queue API (`/api/v1/queue/:source/*`)
- Replaces entire queue with resolved items
- Shows loading spinner during resolution
- Depends on: 1.2.6

**2.2.6** Self-echo suppression for WebSocket sync
- Each mutation generates a `mutationId`
- Backend broadcast includes the `mutationId`
- Originating tab ignores broadcasts matching its own `mutationId`
- New pattern — document in implementation PR

---

## 3. Content Discovery & Search

### 3.1 Requirements

**3.1.1** Search across all sources simultaneously
- Uses existing `ContentQueryService.searchStream()` via SSE
- Results stream in progressively, grouped by source (Plex first, then hymns, then ABS)
- Only playable content appears (`capability=playable` filter)

**3.1.2** Filter by source preset
- Filter chips above search bar: All, Music, Video, Hymns, Audiobooks
- Chips inject query params into `useStreamingSearch`
- Depends on: 3.2.3 (mediaType backend prerequisite)

**3.1.3** Music filter
- Params: `source=plex&mediaType=audio`
- Shows only audio content from Plex (artists, albums, tracks)

**3.1.4** Video filter
- Params: `source=plex&mediaType=video`
- Shows only video content from Plex (movies, shows, episodes)

**3.1.5** Hymns filter
- Params: `source=singalong`
- Shows only singalong content

**3.1.6** Audiobooks filter
- Params: `source=readable`
- Shows only AudioBookShelf content

**3.1.7** Prefix shorthand search
- Typing `hymn:amazing` scopes to singalong adapter automatically
- Works with any source alias — same behavior as filter chips but keyboard-driven
- No additional implementation needed (alias resolver already handles this)

**3.1.8** Search results display
- Grouped by source with section headers
- Each result shows: thumbnail, title, type badge, duration
- Container items (albums, shows) show drill-down affordance

**3.1.9** Drill into containers
- Tap album/show → fetches children via `GET /api/v1/list/{source}/{localId}`
- Breadcrumb navigation for back
- Depends on: 3.2.2

**3.1.10** Play Now from search result
- Inserts after current, advances to it, starts playing
- Existing queue preserved

**3.1.11** Add to Queue from search result
- Appends to end of queue
- No interruption to current playback
- Depends on: 2.1.2

**3.1.12** Play Next from search result
- Inserts after current position
- No interruption to current playback
- Depends on: 2.1.3

**3.1.13** Cast search result to device
- Opens device picker, sends content to selected device
- Does not add to local queue
- Depends on: Section 5

### 3.2 Technical Infrastructure

**3.2.1** Create `ContentBrowser.jsx`
- Panel layout: SearchBar + filter chips + scrollable results
- Action buttons per result: Play Now, Play Next, Add to Queue, Cast
- Not reusing `ContentSearchCombobox` (admin dropdown UX, wrong for MediaApp)

**3.2.2** Extract `useContentBrowse` hook
- Extracted from `ContentSearchCombobox` drill-down logic
- Fetches container children via list API
- Manages breadcrumb stack for back navigation
- Reusable by both `ContentSearchCombobox` (admin) and `ContentBrowser` (MediaApp)

**3.2.3** Backend: `mediaType` pass-through in `ContentQueryService.searchStream()`
- Add `query.mediaType` pass-through after `resolveSource()` (~line 226 in `ContentQueryService.mjs`)
- Pass to adapters via `#translateQuery()`
- In `PlexClientAdapter.mjs`: filter by Plex `type` field (artist/album/track for audio, movie/show/episode for video)
- Extends existing pattern from `#pickRandom()` (~line 564)
- Small backend change required for Music and Video filter presets

---

## 4. Remote Control & Device Monitoring

### 4.1 Requirements

**4.1.1** Display all registered household devices
- Fetched from `GET /api/v1/device`, filtered to `content_control` devices
- Devices appear even when idle/offline (showing offline or no-content state)

**4.1.2** Display now-playing state per device
- Title, thumbnail, progress bar updated from `playback:{deviceId}` WebSocket events
- Refreshes every 5 seconds while device is playing

**4.1.3** Display online/offline status per device
- Derived from WebSocket heartbeat or HA sensor
- Visual indicator on device card

**4.1.4** Remote play/pause
- Forwarded to device via device transport API
- Only available for registered devices (not browser clients)

**4.1.5** Remote skip forward/back
- Same transport forwarding as 4.1.4

**4.1.6** Remote volume control
- Controls device's system volume via device volume API
- Independent from local queue volume (no master volume concept)

**4.1.7** Remote power on/off
- Via device_control capability
- Only shown for devices that support it

**4.1.8** Display browser client "also playing" cards
- Shows any client currently broadcasting `playback_state` via WebSocket
- Auto-generated name from user-agent (e.g. "Chrome on iPhone")
- Appears when playing, disappears when stopped

**4.1.9** Browser clients are read-only
- No transport controls, no volume, no cast
- Only shows now-playing info

**4.1.10** Distinguish controllable vs read-only at a glance
- Visual differentiation between registered devices (full controls) and browser clients (info only)

### 4.2 Technical Infrastructure

**4.2.1** Create `usePlaybackBroadcast(playerRef, clientId)` hook
- Reads Player imperative handle every 5s while playing
- Sends `playback_state` WebSocket message: `{ type, clientId, contentId, title, format, position, duration, state, thumbnail }`
- Also sends once on state change (play/pause/stop/skip)
- No broadcast when idle
- Shared by MediaApp, TVApp, OfficeApp

**4.2.2** Add `usePlaybackBroadcast` to MediaApp
- `clientId` from `useMediaClientId` (localStorage-based)
- Depends on: 4.2.7

**4.2.3** Create `useDeviceIdentity()` hook
- Reads `deviceId` from URL query params (injected by `WakeAndLoadService`)
- Returns `{ deviceId, isKiosk }`
- For browser MediaApp clients: `deviceId` is null, `isKiosk` is false

**4.2.4** Modify `WakeAndLoadService.execute()` to inject `deviceId` into load query
- When loading content onto a device, appends `deviceId` to query string

**4.2.5** Add `usePlaybackBroadcast` to TVApp
- `deviceId` from `useDeviceIdentity()`
- Risk: touches production app — test in MediaApp first

**4.2.6** Add `usePlaybackBroadcast` to OfficeApp
- Same as 4.2.5, same risk note

**4.2.7** Create `useMediaClientId()` hook
- Generates persistent 8-char hex ID on first MediaApp load, stored in localStorage
- Auto-generates display name from user-agent shortname (e.g. "Chrome on iPhone")
- Name also persisted in localStorage, renameable later via DevicePanel

**4.2.8** Backend: register `playback_state` message handler on event bus
- In `app.mjs`: `eventBus.onClientMessage` listener
- Routes incoming `playback_state` → broadcasts on `playback:{message.clientId}`
- Uses `message.clientId` (self-reported), not WebSocket connection ID

**4.2.9** Create `useDeviceMonitor()` hook
- Subscribes via predicate: `msg => msg.topic?.startsWith('playback:')`
- Aggregates live state from all devices/clients into a map
- Frontend `WebSocketService.subscribe()` already supports predicate filters

**4.2.10** Create `DevicePanel.jsx`
- Lists registered devices (from API) + browser clients (from playback subscriptions)
- Registered devices always visible; browser clients appear/disappear dynamically

**4.2.11** Create `DeviceCard.jsx`
- Registered devices: now-playing info + transport + volume + power + cast button
- Browser clients: now-playing info only
- Visual distinction between the two types

---

## 5. Casting

### 5.1 Requirements

**5.1.1** Cast currently playing item to a device
- Sends current queue item to selected registered device
- Uses existing device load API (`/api/v1/device/:id/load`)

**5.1.2** Cast search result directly to device
- Does not add to local queue
- Device picker opens, content sent to chosen device
- Depends on: 3.1.13

**5.1.3** Cast queue item from queue list to device
- Any item in the queue, not just the currently playing one
- Same device picker flow

**5.1.4** Device picker
- Shows only castable devices (those with `content_control` capability)
- Hides non-content devices (e.g. MIDI keyboards)
- Depends on: 4.1.1

**5.1.5** Wake device before casting
- If device is asleep/off, `WakeAndLoadService` powers it on first
- Depends on: 5.2.2

**5.1.6** Show wake progress indicator
- Progress feedback while device is waking up
- Uses existing `useWakeProgress` / `homeline:{deviceId}` WebSocket events

**5.1.7** Cast via URL parameter
- `?device=livingroom-tv` targets a specific device
- Combined with content param: `?hymn=198&device=livingroom-tv`
- No `?device=` param → play locally
- Depends on: 0.9.1

**5.1.8** Cast replaces device content (no confirmation)
- Always-replace policy per design decision
- Permission hierarchy deferred to Phase 5

**5.1.9** Confirm cast succeeded
- After casting, device's now-playing card updates to reflect new content
- Depends on: 4.1.2

### 5.2 Technical Infrastructure

**5.2.1** Create `CastButton.jsx`
- Appears on: NowPlaying view, QueueItem, search results
- Opens device picker on tap
- Calls device load API with content payload

**5.2.2** Wire `WakeAndLoadService` integration
- Reuses existing `WakeAndLoadService` — no new backend code
- Frontend triggers via device load API, which handles wake internally

**5.2.3** Wire `?device=` URL param in `useMediaUrlParams`
- When present, content is sent to device instead of local player
- Combined with `?play=` or alias params
- Depends on: 1.2.6

---

## 6. External Triggers & Deep Links

### 6.1 Requirements

**6.1.1** WebSocket `play` command
- `{ topic: "media:command", action: "play", contentId: "hymn:198" }`
- Inserts after current item, advances to it, starts playing
- Non-destructive: existing items preserved, order unchanged

**6.1.2** WebSocket `add` command
- `{ topic: "media:command", action: "add", contentId: "plex:12345" }`
- Appends to end of queue
- No interruption to current playback

**6.1.3** WebSocket `next` command
- `{ topic: "media:command", action: "next", contentId: "hymn:166" }`
- Inserts after current item
- No interruption to current playback

**6.1.4** WebSocket `queue` command
- `{ topic: "media:command", action: "queue", contentId: "plex:67890" }`
- Resolves container, replaces entire queue, starts playing
- Destructive: loads a new playlist

**6.1.5** WebSocket `clear` command
- `{ topic: "media:command", action: "clear" }`
- Clears queue, stops playback
- Destructive

**6.1.6** Commands processed backend-only
- Backend event handler receives `media:command`, mutates queue via `MediaQueueService`
- Broadcasts result on `media:queue`
- Frontend never processes `media:command` directly (prevents dual-processing race)

**6.1.7** Headless operation
- Commands work even with no MediaApp tab open
- Backend handles them independently of any frontend instance

**6.1.8** URL `?play=` clears queue
- Intentional override behavior — not normal use
- Clears existing queue, plays single item immediately
- Depends on: 1.1.1

**6.1.9** URL `?queue=` replaces queue
- Resolves container, replaces entire queue, starts playing
- Shows loading spinner during resolution
- Depends on: 2.2.5

**6.1.10** URL aliases
- `?hymn=100` → `?play=hymn:100`
- `?scripture=bom` → `?play=scripture:bom`
- Any unknown param key treated as source prefix
- Depends on: 0.9.1

**6.1.11** URL `?volume=50` sets volume
- Scale 0–100, converted to 0.0–1.0 internally
- Depends on: 1.1.7

**6.1.12** URL `?shuffle=true` enables shuffle
- Activates shuffle mode on the loaded queue
- Depends on: 2.1.7

**6.1.13** URL `?shader=focused` sets visual shader
- Passed through as config modifier
- Depends on: 0.9.1

### 6.2 Technical Infrastructure

**6.2.1** Backend: register `media:command` event handler
- In `app.mjs`: listener on event bus for `media:command` topic
- Routes actions (`play`, `add`, `next`, `queue`, `clear`) through `MediaQueueService`
- Resolves `contentId` metadata via `contentIdResolver` when needed
- Broadcasts updated queue on `media:queue` after each command

**6.2.2** Content resolution for WebSocket commands
- `media:command` payloads contain `contentId` only (no title/format/duration)
- Event handler resolves metadata before passing to `MediaQueueService`
- Same resolution chain as POST `/api/v1/media/queue/items` router logic
- Depends on: 0.1.2

---

## 7. Cross-Device Sync

### 7.1 Requirements

**7.1.1** Multiple tabs show same queue
- Opening MediaApp on phone and laptop both display identical queue state
- Both fetch from `GET /api/v1/media/queue` on mount

**7.1.2** Add on one device, appears on other
- Item added on phone appears on laptop within ~1 second
- Via `media:queue` WebSocket broadcast after backend mutation

**7.1.3** Remove on one device, disappears on other
- Same broadcast mechanism as 7.1.2

**7.1.4** Reorder on one device, reflected everywhere
- New order broadcast replaces local state on all other tabs

**7.1.5** Skip track on one device, position updates on other
- Position change broadcast via `media:queue` topic

**7.1.6** Optimistic updates feel instant
- Acting device applies mutation locally before API response
- No perceptible delay on the originating tab
- Depends on: 2.2.2

**7.1.7** Rollback with toast on backend failure
- Local state reverts to last-known-good
- Toast: "Couldn't save queue — retrying..."
- Depends on: 2.2.2

**7.1.8** One automatic retry after failure
- Retry after 2 seconds
- If retry fails, local state diverges until next successful full PUT
- Depends on: 2.2.2

**7.1.9** Playback continues during backend outage
- Player only needs current item, which is already in memory
- Queue persistence is best-effort
- Depends on: 1.1.9

**7.1.10** No duplicate items from multi-tab add
- Backend serialization via Node.js event loop prevents concurrent mutation conflicts
- Last-write-wins via sequential Express handler processing

**7.1.11** No flicker on originating tab
- Self-echo suppression via `mutationId`
- Originating tab ignores broadcasts matching its own mutation
- Depends on: 2.2.6

### 7.2 Technical Infrastructure

**7.2.1** `useMediaQueue` WebSocket subscription
- Subscribes to `media:queue` topic on mount
- On receiving broadcast: replaces local queue state with broadcast payload
- Checks `mutationId` to suppress self-echo
- Depends on: 2.2.1, 2.2.6

**7.2.2** Backend broadcast after every mutation
- All queue-mutating router endpoints call `broadcastEvent('media:queue', queue.toJSON())`
- Broadcast includes `mutationId` from request (passed through from frontend)
- Depends on: 0.6.1

**7.2.3** Concurrency safety
- All YAML I/O uses synchronous `readFileSync`/`writeFileSync`
- Express handlers serialized by Node.js event loop
- No file locking needed — same pattern as all other YAML datastores
- Depends on: 0.4.2

---

## 8. Content Format Handling

### 8.1 Requirements

**8.1.1** Audio plays embedded — never auto-fullscreens
- Album art card displayed in NowPlaying view
- No fullscreen toggle offered for audio
- No user override needed

**8.1.2** Video auto-enters fullscreen on play
- CSS-based fullscreen: `.media-player-wrapper.fullscreen` with `position: fixed; inset: 0; z-index: 1000`
- Player DOM node never moves — only CSS changes (no remount, no buffer reset)

**8.1.3** Exit video fullscreen
- Back button or swipe down removes `.fullscreen` class
- Returns to embedded NowPlaying view
- Playback continues uninterrupted

**8.1.4** Singalong plays embedded with content visible
- Lyrics/verses rendered in now-playing card (Spotify lyrics pattern)
- User can read along without fullscreen

**8.1.5** Singalong expandable to fullscreen
- Tap to expand for easier reading
- Same CSS-based fullscreen mechanism as video
- Back button or tap to collapse

**8.1.6** Readalong plays embedded with text visible
- Same pattern as singalong — content visible in card

**8.1.7** Readalong expandable to fullscreen
- Same expand/collapse mechanism as singalong

**8.1.8** Transport controls overlay in fullscreen
- `position: absolute; bottom: 0` within fullscreen wrapper
- NowPlaying transport controls render as overlay
- Available for all fullscreen-capable formats (video, singalong, readalong)

**8.1.9** Format-appropriate metadata in NowPlaying
- Hymns: verse count
- Audiobooks: chapter info
- Video: duration
- Audio: artist, album

**8.1.10** Format badge on queue items
- Visual badge distinguishing audio, video, singalong, readalong at a glance
- Shown in QueueItem and search results

**8.1.11** Smooth transition between formats in queue
- Switching from video (fullscreen) to audio (embedded) transitions without jarring remount
- Player stays mounted; fullscreen class toggled based on incoming item's format

**8.1.12** Fullscreen does not remount Player
- CSS-only state change — no portal, no DOM relocation
- Preserves video buffers, audio position, and playback state across transitions

### 8.2 Technical Infrastructure

**8.2.1** Fullscreen CSS state in `MediaAppPlayer.jsx`
- Boolean state `isFullscreen` toggled by format defaults and user action
- Applied as CSS class on wrapper div
- Depends on: 1.2.3

**8.2.2** Format-aware auto-fullscreen logic
- On `currentItem` change, check `format` field
- `video` → set `isFullscreen = true`
- `audio` → set `isFullscreen = false`
- `singalong`, `readalong` → set `isFullscreen = false` (embedded default)

**8.2.3** Fullscreen CSS definition in `MediaApp.scss`
- `.media-player-wrapper.fullscreen { position: fixed; inset: 0; z-index: 1000; background: #000; }`
- Depends on: 1.2.7

**8.2.4** Transport overlay positioning in fullscreen
- NowPlaying controls rendered inside fullscreen wrapper
- Positioned absolutely at bottom
- Auto-hide on inactivity (tap to reveal) for video; always visible for scrollers

---

## Requirement Summary

| Section | Requirements | Infra Items | Total |
|---------|-------------|-------------|-------|
| 0. Foundation | — | 18 | 18 |
| 1. Local Playback | 9 | 7 | 16 |
| 2. Queue Management | 15 | 6 | 21 |
| 3. Content Discovery | 13 | 3 | 16 |
| 4. Remote Control | 10 | 11 | 21 |
| 5. Casting | 9 | 3 | 12 |
| 6. External Triggers | 13 | 2 | 15 |
| 7. Cross-Device Sync | 11 | 3 | 14 |
| 8. Format Handling | 12 | 4 | 16 |
| **Total** | **92** | **57** | **149** |

---

## Artifact Index

All files created or modified, mapped to the requirements that drive them.

### New Backend Files

| File | Requirements |
|------|-------------|
| `backend/src/2_domains/media/entities/MediaQueue.mjs` | 0.2.1–0.2.6, 0.7.1 |
| `backend/src/2_domains/media/errors.mjs` (extend) | 0.3.1 |
| `backend/src/3_applications/media/ports/IMediaQueueDatastore.mjs` | 0.4.1 |
| `backend/src/3_applications/media/MediaQueueService.mjs` | 0.5.1, 0.8.1 |
| `backend/src/1_adapters/persistence/yaml/YamlMediaQueueDatastore.mjs` | 0.4.2 |
| `backend/src/4_api/v1/routers/media.mjs` | 0.6.1 |
| `backend/src/0_system/bootstrap.mjs` (extend) | 0.1.1, 0.1.2, 0.1.4 |
| `backend/src/4_api/v1/routers/api.mjs` (extend) | 0.1.3 |

### New Frontend Files

| File | Requirements |
|------|-------------|
| `frontend/src/Apps/MediaApp.jsx` (implement) | 1.2.1 |
| `frontend/src/Apps/MediaApp.scss` | 1.2.7, 8.2.3 |
| `frontend/src/modules/Media/MediaAppPlayer.jsx` | 1.2.3, 8.2.1, 8.2.2 |
| `frontend/src/modules/Media/NowPlaying.jsx` | 1.2.4 |
| `frontend/src/modules/Media/MiniPlayer.jsx` | 1.2.5 |
| `frontend/src/modules/Media/QueueDrawer.jsx` | 2.2.3 |
| `frontend/src/modules/Media/QueueItem.jsx` | 2.2.4 |
| `frontend/src/modules/Media/ContentBrowser.jsx` | 3.2.1 |
| `frontend/src/modules/Media/DevicePanel.jsx` | 4.2.10 |
| `frontend/src/modules/Media/DeviceCard.jsx` | 4.2.11 |
| `frontend/src/modules/Media/CastButton.jsx` | 5.2.1 |
| `frontend/src/lib/parseAutoplayParams.js` | 0.9.1 |
| `frontend/src/hooks/media/useMediaQueue.js` | 2.2.1, 2.2.2, 2.2.6, 7.2.1 |
| `frontend/src/hooks/media/usePlaybackBroadcast.js` | 4.2.1 |
| `frontend/src/hooks/media/useDeviceMonitor.js` | 4.2.9 |
| `frontend/src/hooks/media/useMediaClientId.js` | 4.2.7 |
| `frontend/src/hooks/media/useDeviceIdentity.js` | 4.2.3 |
| `frontend/src/hooks/media/useContentBrowse.js` | 3.2.2 |
| `frontend/src/hooks/media/useMediaUrlParams.js` | 1.2.6 |

### Modified Existing Files

| File | Requirements |
|------|-------------|
| `frontend/src/Apps/TVApp.jsx` | 0.9.2, 4.2.5 |
| `frontend/src/Apps/OfficeApp.jsx` | 4.2.6 |
| `backend/src/3_applications/content/ContentQueryService.mjs` | 3.2.3 |
| `backend/src/1_adapters/plex/PlexClientAdapter.mjs` | 3.2.3 |
| `backend/src/3_applications/device/WakeAndLoadService.mjs` | 4.2.4 |

---

## Commit Traceability

Implementation commits mapped to requirement IDs.

### Phase 1 Commits

| Commit | Message | Requirements |
|--------|---------|-------------|
| `93814c58` | test(media): 0.9.1 add parseAutoplayParams unit tests | 0.9.1 |
| `61157b5f` | feat(media): 0.9.1 extract parseAutoplayParams from TVApp into shared utility | 0.9.1 |
| `008ea413` | refactor(tv): 0.9.2 use shared parseAutoplayParams utility (no behavior change) | 0.9.2 |
| `c3dff9c9` | feat(media): 0.1.3, 1.2.1 register /media route with app shell | 0.1.3, 1.2.1 |
| `be07b883` | feat(media): 1.2.6 add useMediaUrlParams hook for URL-driven playback | 1.2.6 |
| `9455f6dd` | feat(media): 1.2.3 create MediaAppPlayer wrapper with fullscreen support | 1.2.3 |
| `8b615d53` | feat(media): 1.2.4, 1.1.4–1.1.7 create NowPlaying view with transport controls | 1.2.4, 1.1.4, 1.1.5, 1.1.6, 1.1.7 |
| `358c90de` | feat(media): 1.2.5, 1.1.8 create MiniPlayer persistent bottom bar | 1.2.5, 1.1.8 |
| `d7d126e6` | feat(media): 1.2.2, 1.1.1–1.1.3, 1.1.9 wire MediaApp with URL-driven playback | 1.2.2, 1.1.1, 1.1.2, 1.1.3, 1.1.9 |
| `7f707fd1` | style(media): 1.2.7 complete Phase 1 SCSS (mobile-first dark theme) | 1.2.7 |

### Phase 2 Commits

| Commit | Message | Requirements |
|--------|---------|-------------|
| `c09a1cea` | feat(media): add MediaQueue entity and QueueFullError | 0.2.1–0.2.6, 0.3.1, 0.7.1 |
| `172d46c5` | feat(media): add MediaQueueService application-layer orchestrator | 0.4.1, 0.4.2, 0.5.1, 0.8.1 |
| (merged) | feat(media): add media queue router with 8 endpoints | 0.6.1, 0.3.2 |
| `935e689c` | feat(media): wire media services and router in bootstrap | 0.1.1, 0.1.2, 0.1.3, 0.1.4 |
| `123ddc28` | feat(media): add media:command WebSocket handler | 6.1.1–6.1.7, 6.2.1, 6.2.2 |
| `db201ba9` | feat(media): add useMediaQueue hook with optimistic updates | 2.2.1, 2.2.2, 2.2.6, 0.8.2, 7.2.1 |
| (merged) | feat(media): add MediaAppProvider context, replace prop drilling | 1.2.2 |
| `eaa67a08` | feat(media): add QueueDrawer and QueueItem components | 2.2.3, 2.2.4 |
| `c4836302` | feat(media): wire queue into MediaApp with auto-advance, prev restart, queue toggle | 2.1.1–2.1.15, 2.2.5, 6.1.8–6.1.13 |
| (merged) | fix(media): add container types to PlexAdapter mediaType filter | 3.2.3 |
| `81e0e6bf` | feat(media): add ContentBrowser with search, filters, and drill-down | 3.1.1–3.1.13, 3.2.1, 3.2.2 |
| `85e023c4` | feat(media): wire ContentBrowser search button into NowPlaying | 3.2.1 |

### Phase 3 Commits

| Commit | Message | Requirements |
|--------|---------|-------------|
| `5aced0c0` | feat(media): 4.2.3 add useDeviceIdentity hook | 4.2.3 |
| `b72954cb` | feat(media): 4.2.8 add playback_state WebSocket relay handler | 4.2.8 |
| `cc63eb1c` | feat(media): 4.2.7 add useMediaClientId hook | 4.2.7 |
| `c3eb2e56` | fix(test): use vitest imports in Phase 3 tests | — |
| `e960d8f0` | feat(media): 4.2.1 add usePlaybackBroadcast hook | 4.2.1 |
| `76a7678a` | feat(media): 4.2.2, 4.2.5, 4.2.6 wire usePlaybackBroadcast into apps | 4.2.2, 4.2.5, 4.2.6 |
| `e3140e0f` | feat(media): 4.2.9 add useDeviceMonitor hook | 4.2.9, 4.1.1, 4.1.2, 4.1.3 |
| `6a344414` | feat(media): 4.2.11 add DeviceCard component | 4.2.11, 4.1.4–4.1.10 |
| `3b0eccd2` | feat(media): 5.2.1, 5.1.4 add CastButton and DevicePicker | 5.2.1, 5.1.1, 5.1.4, 5.1.5 |
| `2950ef7b` | feat(media): 4.2.10 add DevicePanel drawer | 4.2.10, 4.1.1, 4.1.8 |
| `58b528ec` | feat(media): 6.1.4, 6.2.2, 6.1.12 fix deferred items | 6.1.4, 6.2.2, 6.1.12 |
| `71dc81de` | feat(media): 5.2.3, 5.1.7 add ?device= URL param | 5.2.3, 5.1.7 |
| `aeedff21` | feat(media): wire DevicePanel + CastButton into MediaApp UI | 4.2.2, 5.1.2, 5.1.3, 5.2.1, 3.1.13 |
| `827f5436` | style(media): Phase 3 SCSS | — |

### Requirement Status

| ID | Description | Status | Commit | Notes |
|----|-------------|--------|--------|-------|
| **0.1.1** | Register `createMediaServices()` in bootstrap | Done | `935e689c` | Follows `createFitnessServices()` pattern |
| **0.1.2** | Register `createMediaApiRouter()` in bootstrap | Done | `935e689c` | |
| **0.1.3** | Route entry in `api.mjs` routeMap | Done | `c3dff9c9`, `935e689c` | Frontend (P1) + backend (P2) |
| **0.1.4** | Wire both factories in app startup | Done | `935e689c` | |
| **0.2.1** | MediaQueue entity with constructor/serialization | Done | `c09a1cea` | 40 unit tests |
| **0.2.2** | Queue manipulation methods | Done | `c09a1cea` | addItems, removeByQueueId, reorder, advance, clear |
| **0.2.3** | Position stability invariant | Done | `c09a1cea` | Position clamped and adjusted on mutations |
| **0.2.4** | Shuffle model (Fisher-Yates) | Done | `c09a1cea` | Current item at shuffleOrder[0], toggle off restores |
| **0.2.5** | Repeat + advance interaction | Done | `c09a1cea` | off/one/all modes with auto vs manual distinction |
| **0.2.6** | Accessors (currentItem, isEmpty, etc.) | Done | `c09a1cea` | |
| **0.3.1** | QueueFullError | Done | `c09a1cea` | Extends DomainInvariantError, code QUEUE_FULL |
| **0.3.2** | Error mapping (422/404/400) | Done | (merged) | Via errorHandlerMiddleware |
| **0.4.1** | IMediaQueueDatastore port | Done | `172d46c5` | load/save interface |
| **0.4.2** | YamlMediaQueueDatastore adapter | Done | `172d46c5` | 9 tests |
| **0.5.1** | MediaQueueService | Done | `172d46c5` | 16 tests, load→mutate→save→log pattern |
| **0.6.1** | Media router (8 endpoints) | Done | (merged) | 18 tests, asyncHandler + broadcastEvent |
| **0.7.1** | ADDED_FROM constants | Done | `c09a1cea` | SEARCH, URL, CAST, WEBSOCKET |
| **0.8.1** | Backend structured logging | Done | `172d46c5` | Via injected logger |
| **0.8.2** | Frontend useMediaQueue logging | Done | `db201ba9` | Lazy getLogger().child() pattern |
| **0.9.1** | Extract `parseAutoplayParams()` | Done | `93814c58`, `61157b5f` | 24 unit tests |
| **0.9.2** | TVApp uses shared parser | Done | `008ea413` | No behavior change |
| **1.1.1** | Play content by URL parameter | Done | `d7d126e6` | |
| **1.1.2** | Play content by alias shorthand | Done | `d7d126e6` | |
| **1.1.3** | Render Player in single-play mode | Done | `d7d126e6` | |
| **1.1.4** | Display track info | Done | `8b615d53` | |
| **1.1.5** | Seekable progress bar | Done | `8b615d53` | |
| **1.1.6** | Transport controls | Done | `8b615d53`, `c4836302` | P1: no-ops; P2: wired to queue |
| **1.1.7** | Volume control | Done | `8b615d53` | Local HTMLMediaElement.volume |
| **1.1.8** | MiniPlayer persistent bar | Done | `358c90de` | |
| **1.1.9** | Playback continues during navigation | Done | `d7d126e6` | Player stays mounted |
| **1.2.1** | MediaApp.jsx route entry point | Done | `c3dff9c9` | `/media` route |
| **1.2.2** | MediaAppProvider context | Done | `d7d126e6`, (merged) | P1: prop drilling; P2: React context |
| **1.2.3** | MediaAppPlayer wrapper | Done | `9455f6dd` | CSS-based fullscreen |
| **1.2.4** | NowPlaying view | Done | `8b615d53` | |
| **1.2.5** | MiniPlayer component | Done | `358c90de` | |
| **1.2.6** | useMediaUrlParams hook | Done | `be07b883` | |
| **1.2.7** | SCSS styling | Done | `7f707fd1`, `eaa67a08`, `81e0e6bf` | Extended with queue + browser styles |
| **2.1.1** | View full upcoming queue | Done | `c4836302` | Slide-up drawer mobile, sidebar desktop |
| **2.1.2** | Add item to end of queue | Done | `c4836302` | Via useMediaQueue.addItems() |
| **2.1.3** | Play next (insert after current) | Done | `c4836302` | placement='next' |
| **2.1.4** | Remove single item | Done | `eaa67a08` | Swipe-to-remove + button |
| **2.1.5** | Drag to reorder | Done | `eaa67a08`, `3b79d1d5` | Drag-and-drop UX implemented |
| **2.1.6** | Clear entire queue | Done | `eaa67a08` | Clear button in QueueDrawer |
| **2.1.7** | Toggle shuffle mode | Done | `eaa67a08` | Button in QueueDrawer |
| **2.1.8** | Cycle repeat modes | Done | `eaa67a08` | off→one→all cycle |
| **2.1.9** | Skip to next | Done | `c4836302` | queue.advance(1) |
| **2.1.10** | Go back to previous | Done | `c4836302` | Restart if >3s, else advance(-1) |
| **2.1.11** | Auto-advance on item completion | Done | `c4836302` | handleItemEnd calls queue.advance |
| **2.1.12** | Tap queue item to jump | Done | `eaa67a08` | QueueItem onClick → setPosition |
| **2.1.13** | Queue survives page refresh | Done | `172d46c5`, `db201ba9` | YAML persistence + fetch on mount |
| **2.1.14** | Queue survives browser close/reopen | Done | `172d46c5` | Backend YAML persistence |
| **2.1.15** | Queue full error at 500 items | Done | `c09a1cea` | QueueFullError → 422 |
| **2.2.1** | useMediaQueue hook | Done | `db201ba9` | Fetch, mutations, WebSocket sync |
| **2.2.2** | Optimistic updates | Done | `db201ba9` | Rollback + toast + 1 retry |
| **2.2.3** | QueueDrawer component | Done | `eaa67a08` | Mobile slide-up, desktop sidebar |
| **2.2.4** | QueueItem component | Done | `eaa67a08` | Thumbnail, title, swipe-to-remove |
| **2.2.5** | Wire ?queue= URL parameter | Done | `c4836302` | Via queue.clear + addItems |
| **2.2.6** | Self-echo suppression | Done | `db201ba9` | mutationId matching |
| **3.1.1** | Search across all sources | Done | `81e0e6bf` | SSE streaming via useStreamingSearch |
| **3.1.2** | Filter by source preset | Done | `81e0e6bf` | 5 filter chips |
| **3.1.3** | Music filter | Done | `81e0e6bf` | source=plex&mediaType=audio |
| **3.1.4** | Video filter | Done | `81e0e6bf` | source=plex&mediaType=video |
| **3.1.5** | Hymns filter | Done | `81e0e6bf` | source=singalong |
| **3.1.6** | Audiobooks filter | Done | `81e0e6bf` | source=readable |
| **3.1.7** | Prefix shorthand search | Done | `782f04cb` | Already handled by alias resolver |
| **3.1.8** | Search results display | Done | `81e0e6bf` | Thumbnail, title, source badge, duration |
| **3.1.9** | Drill into containers | Done | `81e0e6bf` | useContentBrowse + breadcrumbs |
| **3.1.10** | Play Now from search result | Done | `81e0e6bf` | Insert next + advance |
| **3.1.11** | Add to Queue from search result | Done | `81e0e6bf` | Append to end |
| **3.1.12** | Play Next from search result | Done | `81e0e6bf` | Insert after current |
| **3.1.13** | Cast from search result | Done | `aeedff21` | CastButton added to ContentBrowser results |
| **3.2.1** | ContentBrowser component | Done | `81e0e6bf`, `85e023c4` | Search + filters + drill-down |
| **3.2.2** | useContentBrowse hook | Done | `81e0e6bf` | Breadcrumb navigation |
| **3.2.3** | Backend mediaType pass-through | Done | (merged) | Already wired; PlexAdapter container types fixed |
| **6.1.1** | WebSocket play command | Done | `123ddc28` | Insert next + advance |
| **6.1.2** | WebSocket add command | Done | `123ddc28` | Append to end |
| **6.1.3** | WebSocket next command | Done | `123ddc28` | Insert after current |
| **6.1.4** | WebSocket queue command | Done | `123ddc28`, `58b528ec` | P2: handler; P3: contentIdResolver wired |
| **6.1.5** | WebSocket clear command | Done | `123ddc28` | Clears queue, broadcasts |
| **6.1.6** | Commands processed backend-only | Done | `123ddc28` | eventBus.onClientMessage handler |
| **6.1.7** | Headless operation | Done | `123ddc28` | No frontend needed |
| **6.1.8** | URL ?play= clears queue | Done | `c4836302` | queue.clear().then(addItems) |
| **6.1.9** | URL ?queue= replaces queue | Done | `c4836302` | Via queue.clear + addItems |
| **6.1.10** | URL aliases | Done | `be07b883` | parseAutoplayParams handles aliases |
| **6.1.11** | URL ?volume=50 sets volume | Done | `c4836302` | queue.setVolume(volume/100) |
| **6.1.12** | URL ?shuffle=true | Done | `58b528ec` | Wired in MediaApp URL command handler |
| **6.1.13** | URL ?shader= config modifier | Done | `be07b883` | Passed through as config |
| **6.2.1** | Backend media:command event handler | Done | `123ddc28` | play/add/next/clear actions |
| **6.2.2** | Content resolution for WS commands | Done | `123ddc28`, `58b528ec` | P2: basic pass-through; P3: full contentIdResolver wired |
| **7.2.1** | useMediaQueue WebSocket subscription | Done | `db201ba9` | media:queue topic with self-echo suppression |
| **7.2.2** | Backend broadcast after mutation | Done | (merged) | All router endpoints broadcast |
| **7.2.3** | Concurrency safety | Done | `172d46c5` | Sync YAML I/O, Node event loop serialization |
| **4.1.1** | Display registered household devices | Done | `e3140e0f`, `2950ef7b` | useDeviceMonitor fetches device list; DevicePanel renders |
| **4.1.2** | Display now-playing state per device | Done | `e3140e0f`, `6a344414` | WebSocket playback subscription + DeviceCard |
| **4.1.3** | Display online/offline status per device | Done | `e3140e0f` | 30s expiry in useDeviceMonitor |
| **4.1.4** | Remote play/pause | Done | `6a344414` | DeviceCard transport API call |
| **4.1.5** | Remote skip forward/back | Done | `6a344414` | Same transport forwarding |
| **4.1.6** | Remote volume control | Done | `6a344414` | Volume slider via device API |
| **4.1.7** | Remote power on/off | Done | `6a344414` | Power button via device API |
| **4.1.8** | Browser client "also playing" cards | Done | `2950ef7b` | Unmatched playback entries in DevicePanel |
| **4.1.9** | Browser clients are read-only | Done | `6a344414` | type='browser' variant, no controls |
| **4.1.10** | Distinguish controllable vs read-only | Done | `6a344414` | Visual differentiation, "Browser" badge |
| **4.2.1** | usePlaybackBroadcast hook | Done | `e960d8f0` | 5s interval + state change broadcast |
| **4.2.2** | Add usePlaybackBroadcast to MediaApp | Done | `76a7678a` | Wired in MediaAppInner |
| **4.2.3** | useDeviceIdentity hook | Done | `5aced0c0` | Reads ?deviceId= URL param |
| **4.2.4** | WakeAndLoadService deviceId injection | Done | `5694b522` | Already injects deviceId in load query |
| **4.2.5** | Add usePlaybackBroadcast to TVApp | Done | `76a7678a`, `b180d618` | Wired via MenuStack playerRef |
| **4.2.6** | Add usePlaybackBroadcast to OfficeApp | Done | `76a7678a`, `769eb565` | Wired to Player ref |
| **4.2.7** | useMediaClientId hook | Done | `cc63eb1c` | Persistent 8-char hex ID in localStorage |
| **4.2.8** | Backend playback_state handler | Done | `b72954cb` | eventBus.onClientMessage relay |
| **4.2.9** | useDeviceMonitor hook | Done | `e3140e0f` | REST + WebSocket aggregation |
| **4.2.10** | DevicePanel component | Done | `2950ef7b` | Right-edge drawer |
| **4.2.11** | DeviceCard component | Done | `6a344414` | Full controls + browser variant |
| **5.1.1** | Cast currently playing item | Done | `3b0eccd2` | Via DevicePicker + device load API |
| **5.1.2** | Cast search result to device | Done | `aeedff21` | CastButton in ContentBrowser |
| **5.1.3** | Cast queue item to device | Done | `aeedff21` | CastButton in QueueItem |
| **5.1.4** | Device picker | Done | `3b0eccd2` | Bottom sheet, content_control filter |
| **5.1.5** | Wake device before casting | Done | `3b0eccd2` | WakeAndLoadService handles wake-if-needed |
| **5.1.6** | Show wake progress indicator | Done | `8eb38ed9` | Existing useWakeProgress reused |
| **5.1.7** | Cast via URL parameter | Done | `71dc81de` | ?device= param in useMediaUrlParams |
| **5.1.8** | Cast replaces device content | Done | `3b0eccd2` | Always-replace, no confirmation |
| **5.1.9** | Confirm cast succeeded | Done | `e3140e0f` | DeviceCard updates via playback broadcast |
| **5.2.1** | CastButton component | Done | `3b0eccd2`, `aeedff21` | NowPlaying, QueueItem, ContentBrowser |
| **5.2.2** | WakeAndLoadService integration | Done | `7933a8e3` | Existing service, no new backend code |
| **5.2.3** | ?device= URL param in useMediaUrlParams | Done | `71dc81de` | Cast to device instead of local play |
| **7.1.1** | Multiple tabs show same queue | Done | `db201ba9` | P2: useMediaQueue fetch on mount |
| **7.1.2** | Add on one device, appears on other | Done | `db201ba9` | P2: media:queue WebSocket broadcast |
| **7.1.3** | Remove on one device, disappears on other | Done | `db201ba9` | P2: same broadcast mechanism |
| **7.1.4** | Reorder on one device, reflected everywhere | Done | `db201ba9` | P2: broadcast replaces local state |
| **7.1.5** | Skip track, position updates on other | Done | `db201ba9` | P2: position change broadcast |
| **7.1.6** | Optimistic updates feel instant | Done | `db201ba9` | P2: local apply before API response |
| **7.1.7** | Rollback with toast on failure | Done | `db201ba9` | P2: revert + toast + retry |
| **7.1.8** | One automatic retry after failure | Done | `db201ba9` | P2: 2s retry |
| **7.1.9** | Playback continues during outage | Done | `d7d126e6` | P1: player keeps current item in memory |
| **7.1.10** | No duplicate items from multi-tab add | Done | `172d46c5` | P2: Node event loop serialization |
| **7.1.11** | No flicker on originating tab | Done | `db201ba9` | P2: mutationId self-echo suppression |

**Phase 1 coverage:** 19/19 requirements addressed
**Phase 2 coverage:** 62 requirements addressed (1 partial: 2.1.5 drag UX)

### Phase 4 Commits

| Req IDs | Commit | Description |
|---------|--------|-------------|
| 8.2.1, 8.2.2, 8.1.11, 8.1.12 | `0da85afd` | Lift fullscreen state to NowPlaying, MediaAppPlayer is now controlled |
| quality | `d6700466` | Quality fixes: useCallback for exit, remove dead format prop, hoist formatTime |
| 8.1.8, 8.2.4 | `6e1ed2ba` | Fullscreen transport overlay with auto-hide for video |
| quality | `b5830868` | Quality fixes: stable deps, remove useCallback, seek resets timer, logging |
| 8.1.4–8.1.7 | `e132202c` | Expand-to-fullscreen for singalong and readalong formats |
| 8.1.9 | `b8c06653` | FormatMetadata component for format-specific secondary info in track view |
| 8.1.10 | `b97f3394` | Format badge in ContentBrowser search results |
| styling | `4d795f1c` | SCSS for fullscreen overlay, format badges, expand button |
**Phase 3 coverage:** 44 requirements addressed (2 partial: 4.2.5 TVApp broadcast, 4.2.6 OfficeApp broadcast — Player ref not accessible at top level; 3 deferred items from P2 resolved: 3.1.13, 6.1.4, 6.2.2, 6.1.12)

#### Phase 5 Commit Traceability

| Commit | Message | Req |
|--------|---------|-----|
| `3b79d1d5` | feat(media): drag-to-reorder queue items | 2.1.5 |
| `47210ac1` | fix(media): add dragEnd cleanup + include modules in isolated test harness | 2.1.5 |
| `5cfd5799` | fix(tests): scope --only filter to per-runner targets in isolated harness | — |
| `769eb565` | feat(office): wire usePlaybackBroadcast to Player ref | 4.2.6 |
| `447e9a4b` | fix(office): handle playlist type in broadcastItem extraction | 4.2.6 |
| `b180d618` | feat(tv): wire usePlaybackBroadcast via MenuStack playerRef | 4.2.5 |
| `bea04c92` | fix(tv): remove unused reset destructure, document playerRef prop | 4.2.5 |

**Phase 5 coverage:** 3 requirements closed (2.1.5 drag UX, 4.2.5 TVApp broadcast, 4.2.6 OfficeApp broadcast)
