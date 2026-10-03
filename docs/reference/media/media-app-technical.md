# Media App — Technical Contracts

## 1. Scope & Conventions

This document defines every external contract the Media App relies on: HTTP
endpoints, WebSocket protocols, URL parameters, data shapes, event schemas,
log event taxonomy, and client-side persistence schemas.

This document does **not** cover: UI layout, component structure, rendering
logic, or internal state-management mechanisms. For intent, user stories, and
high-level design, see [`media-app.md`](./media-app.md). For the numbered
capability requirements, see
[`media-app-requirements.md`](./media-app-requirements.md). For the content
paradigm (content IDs, formats, Playable Contract), see
[`docs/reference/content/`](../content/).

### Conventions

- **"Exists"** — the contract is already implemented and can be consumed as-is.
- **"Required"** — the contract is a deliverable of this app's implementation.
- **"Amended"** — the contract exists but needs additions or behavioral
  changes.
- All HTTP endpoints are rooted at `/api/v1/` unless otherwise stated.
- All JSON uses `camelCase` field names.
- All timestamps are ISO-8601 UTC strings unless otherwise marked.
- All durations in playback contexts are seconds (number, may be fractional).
- All content IDs follow the content paradigm format (`<source>:<localId>`).

### Identifiers

| Identifier | Shape | Source | Purpose |
|---|---|---|---|
| `contentId` | `<source>:<localId>` | Content paradigm | Any playable/browsable item. |
| `deviceId` | string | `devices.yml` keys | Remote surface identity. |
| `clientId` | UUID v4 | Generated per-browser, persisted in `localStorage` | Stable identity for this browser across sessions. |
| `sessionId` | UUID v4 | Generated when a session is created | Unique identifier for a single session instance; rotates on reset. |
| `displayName` | string | User-assigned in settings, falls back to `"Client <first-8-of-clientId>"` | Human-readable client label. |
| `dispatchId` | UUID v4 | Generated per dispatch action | Correlates dispatch progress events with the initiating action. |
| `commandId` | UUID v4 | Generated per command | Enables ack/idempotency correlation. |

---

## 2. HTTP APIs — Existing, Consumed

### 2.1 Content resolution

#### `GET /api/v1/play/:source/*`
Resolves a content ID to a renderable `PlayableItem`. The `*` portion is the
`localId` (may contain slashes). Supports optional query params: `shuffle`,
`shader`, `volume`, and format-specific options.

**Response (200):** `PlayableItem` — see §9.1.

#### `GET /api/v1/queue/:source/*`
Resolves a container ID to an ordered list of `PlayableItem`s.

**Query:** `shuffle` (bool), `limit` (int), `skip` (int).

**Response (200):**
```json
{
  "source": "plex-main",
  "id": "plex-main:67890",
  "count": 10,
  "totalDuration": 13200,
  "items": [ /* PlayableItem[] */ ]
}
```

#### `GET /api/v1/info/:source/*`
Returns detail metadata for a content item. Not assumed-playable.

**Response (200):** `ContentInfo` — see §9.13.

#### `GET /api/v1/display/:source/*`
Returns an image (thumbnail or generated placeholder SVG). Always 200.

**Response (200):** binary image (`image/jpeg`, `image/png`, or `image/svg+xml`).

#### `GET /api/v1/list/*`
Hierarchical catalog browse. Path modifiers `/playable`, `/shuffle`,
`/recent_on_top`. Query: `take`, `skip`.

**Response (200):** `ListResponse` — see §9.12.

#### `POST /api/v1/content/compose`
Resolves composite (visual + audio) content.

**Request:** `{ sources: string[] }`

**Response (200):** `{ visual: ...; audio: ... }`

#### Libby active-loan playback

An explicitly addressed audiobook loan uses these content IDs:

- Book container: `libby:loan/<card-id>/<title-id>`
- Stable part: `libby:loan/<card-id>/<title-id>/part/<part-key>`

`GET /api/v1/play/libby/loan/<card-id>/<title-id>` verifies that the exact card
and title pair occurs in the authenticated account's active loans. It returns
the first audiobook part as a normal audio `PlayableItem`.
`GET /api/v1/queue/libby/loan/<card-id>/<title-id>` returns the available parts
in spine order, including the first. Legacy OpenBook may provide the full spine;
modern browser fulfillment currently provides a bounded contiguous playback
window at the official player's saved position. Each item has `mediaType: audio`, a part title,
duration in seconds, and a same-origin cover `thumbnail`. Its public `metadata`
retains `parentTitle` (book title), `subtitle`, `author`, `narrator`, and the
zero-based `partIndex`. Book containers also expose subtitle, author, narrator,
and loan expiry; part playables retain loan expiry internally.

The provider open request derives `website_id` from the matched active loan's
`websiteId` returned by synchronization. Callers supply only card/title identity;
missing provider website identity fails closed before opening the audiobook.
When the response supplies `openbook`, the client uses that legacy path and
rejects malformed values. When `openbook` is absent, the backend sends exactly
`{ webUrl, message, operationId }` to DaylightBrowser's private
`POST /v1/operations/libby.bootstrap-loan` operation. The web URL and message
come from the authenticated open response; no account token or credential path
crosses this boundary. A missing/invalid web capability fails closed.

The extension runs the official player bootstrap in a fresh Chromium context
and returns only normalized book metadata and ordered unencrypted MP3 parts.
Navigation and possession traffic stay on the authorized shell origin. Three
version-pinned official static paths bind one exact Libby-controlled static
origin for that operation. The operation starts official playback once, allows
normal buffering for a fixed 20-second observation window beginning with the
first exact capability, and enforces a hard 30-second capture deadline. The
deadline returns a collected nonempty set and remains a timeout if none arrived.
The context-wide route remains installed: after original-page CDP Fetch is
enabled at the Request stage, it atomically flips from bootstrap rules to media
rules. Only original-page/main-frame GET Media requests to the exact shell or
exact HTTPS/default-port `audioclips.cdn.overdrive.com` origin continue.
Before navigation, a context init script replaces `Worker` and `SharedWorker`
with non-configurable throwing constructors in every page and frame realm;
this closes target types that Playwright routing and page-scoped CDP do not
intercept. It also replaces the shared `BaseAudioContext.prototype.audioWorklet`
getter with a non-configurable facade whose `addModule` always throws, blocking
both direct and Blob static-import AudioWorklet escapes while leaving
`HTMLAudioElement` playback intact. Every exposed page worklet loader
(`CSS.paintWorklet`, `CSS.layoutWorklet`, and `CSS.animationWorklet`, plus
equivalent global surfaces when present) receives the same sealed facade;
ordinary CSS/layout APIs remain intact. Service workers remain context-blocked.
Popup/extra-page initial
navigation, routable worker traffic, navigation, foreign, malformed,
non-GET, and non-media requests abort at the context route before egress. CDP
remains authoritative for every original-page redirect hop and captures each
CDN capability from its paused request before continuation.
Each distinct capability is
checked with a credential-free one-byte range request whose body is canceled
unread. Its declared total length must uniquely map to the BIF spine, and all
matches must form a nonempty ordered contiguous window with no gaps. Because
the official player can resume a saved position, that window may begin after
original spine index zero. Returned indexes are normalized to zero-based array
order while the original stable key, title, duration, and length are retained.
Only that observed window and empty media headers are returned; no browser credential,
header value, storage value, or media body is read or returned. Authorized
media bytes may be buffered only by Chromium inside the bounded ephemeral
context; they are never persisted or retained after teardown. Reporting,
activity mutations, and browsing are blocked. Cleanup flips the context route
to block-all, then the media page is closed while
CDP enforcement remains active. Only after confirmed closure is interception
disabled/detached and range probing begun. A close failure leaves enforcement
installed while the pool closes/poisons the context or browser. The context is
closed on completion, cancellation, and failure.
The pool's combined operation signal aborts probes on caller disconnect or hard
deadline, and slot ownership is retained through bounded settlement/cleanup;
ignored cancellation poisons the pool. Provider URLs remain inside the adapter
and its process-local leases. Browser metadata fills missing synchronized author and
subtitle fields, while populated synchronized values retain precedence.

The browser-backed result is an initial playback window at the official player's
current saved position, not a full-book availability guarantee. Earlier parts
and later-part continuation are not guaranteed, and no
uncaptured capability is synthesized or inferred.

Composition wires the application-owned bootstrap port to
`DaylightBrowserLibbyGateway`. Its base URL is supplied by `browserBaseUrl`, then
`DAYLIGHT_BROWSER_URL`, defaulting to `http://daylight-browser:3000`. Only HTTP
root URLs using the fixed service name, localhost, or private/loopback IP
literals are accepted. The gateway bounds requests to 64 KiB, streamed replies
to 1 MiB, and the full operation to 75 seconds. Replies reject unknown fields,
nonempty media headers, and parts outside the exact approved audio CDN origin.
Sidecar outages, policy changes, timeout, or unsupported DRM fail closed. See the
[DaylightBrowser runbook](../../runbooks/daylight-browser.md) for deployment
and the sanitized live probe.

Remote playback uses the standard Media screen: dispatch the book container via
`GET /api/v1/device/<device-id>/load?queue=libby:loan/<card-id>/<title-id>`.
The target resolves the queue and plays it through the browser AudioPlayer.
This device endpoint changes playback state. Libby has no Playback Hub
dependency and is not published to its catalog.

The returned `mediaUrl` has the form
`/api/v1/proxy/libby/stream/<opaque-handle>`. The handle is a short-lived,
process-local bearer capability scoped to one loan part. The server stores only
its digest as the lookup key. Clients MUST treat the URL as opaque and request
it with ordinary single-byte-range audio semantics.

The stream endpoint supports `GET`, `HEAD`, and one `Range: bytes=...` value.
Successful responses preserve upstream `200`/`206`, range validators, and media
length headers and always include `Cache-Control: private, no-store`. Expired or
returned loans answer `410`; malformed or unsatisfiable ranges answer `416`;
missing credentials answer `401`; provider failures answer `502`.

Artwork uses `GET /api/v1/proxy/libby/cover/<card-id>/<title-id>`. Each request
checks the active loan before relaying an image with `Cache-Control: private,
no-store` and `X-Content-Type-Options: nosniff`. Returned or expired loans answer
`410`, unavailable credentials `401`, provider failures `502`, and an unwired
cover service `503`. The adapter owns artwork URL validation and permits only
configured HTTPS cover hosts on the default port, at most three redirects,
and `image/*` responses. Its dedicated cover allowlist does not authorize audio
hosts. Account authorization and provider cookies never enter artwork requests.
The application maps neutral outcomes; the API streams bytes with backpressure
and cancels upstream work on disconnect. Provider artwork URLs remain internal.

Libby is disabled unless the normal household app configuration explicitly
opts in and names the user who owns the credential:

`data/household/media/libby.yml` (or the corresponding selected household
folder) contains:

```yaml
enabled: true
credential_owner: <username>
```

The same validated owner is injected into both runtime composition and the
content registry; disabled environments construct neither provider clients nor
proxy services. Authentication is supplied externally at
`data/users/{username}/auth/libby.yml`:

```yaml
token: <current-libby-jwt>
```

The backend reloads atomic file replacements and retains a previously valid
token only until its JWT expiry. Tokens, provider cookies, signed media URLs,
lease handles, and audio bytes are never persisted or logged. Redirects are
restricted to configured Libby/OverDrive HTTPS origins, and credentials are
stripped when an allowed redirect changes origin. Browser-derived signed CDN
capabilities enter the relay with empty headers; the relay adds only the client
Range request and never replays browser cookies or authorization. Encrypted or
licensed spine formats fail closed; the integration performs no borrow, renew, return,
account-browse, or remote-progress operations.

### 2.2 Search

#### `GET /api/v1/content/query/search`
Unified non-streaming search.

**Query:**
| Param | Type | Notes |
|---|---|---|
| `text` | string | Minimum 2 characters. |
| `source` | string | Source/provider filter. |
| `mediaType` | string | `video` \| `audio` \| `image`. |
| `capability` | string | `playable` \| `displayable` \| `readable`. |
| `person` | string | Canonical name; adapters translate. |
| `creator` | string | Creator/author filter. |
| `time` | string | `2025`, `2025-06`, `2024..2025`, season keyword. |
| `take` | int | Default 50. |
| `skip` | int | For pagination. |
| `{adapter}.{key}` | string | Adapter-specific (e.g., `plex.libraryId=6,12`). |

**Response (200):** `{ query, items: SearchResult[], _perf: {...} }`

#### `GET /api/v1/content/query/search/stream`
Incremental search via Server-Sent Events.

**Event stream:**

| Event | Payload | When |
|---|---|---|
| `pending` | `{ sources: string[] }` | First, lists adapters about to run. |
| `results` | `{ source, items: SearchResult[], remaining: string[] }` | Once per adapter as it completes. |
| `complete` | `{ totalMs, resultCount }` | Final event. |
| `error` | `{ message }` | Fatal stream error. |

**App behavior requirement:** the app MUST use `/stream` for live search.

#### `GET /api/v1/media/config`
Returns media-app configuration including `searchScopes`.

**Response (200):**
```json
{
  "searchScopes": [
    {
      "label": "Movies",
      "key": "video-movies",
      "params": "source=plex&plex.libraryId=6,12",
      "children": [ /* same shape */ ]
    }
  ]
}
```

### 2.3 Device / remote surface

#### `GET /api/v1/device/config`
Returns the fleet.

**Response (200):**
```json
{
  "devices": {
    "<deviceId>": {
      "id": "<deviceId>",
      "name": "Living Room TV",
      "location": "living_room",
      "capabilities": { "wake": true, "volume": true, "shader": true },
      "defaultVolume": 50
    }
  }
}
```

#### `GET /api/v1/device/:id/load`
Dispatches content to a remote surface.

**Query:**
| Param | Type | Notes |
|---|---|---|
| `play` | contentId | Replace-and-play on the target. |
| `queue` | contentId | Build queue from container. |
| `shader` | string | Apply shader. |
| `volume` | int 0–100 | Initial volume. |
| `shuffle` | `1` | Enable shuffle. |
| `repeat` | `1` | Enable repeat. |
| `open` | path | Route the target to a specific app surface before dispatching. |
| `dispatchId` | UUID | **(amended)** Correlates WS `wake-progress` events. |
| `routine` | string ≤ 64 | Names the routine sending this load; stripped before the screen sees the query (§2.6). |
| `routineId` | string ≤ 96 | Optional stable id for that routine (e.g. `automation:kitchen_button_1`). |

A Home Assistant caller (User-Agent `HomeAssistant/…`) is treated as a routine
even without `routine=`; see §2.6 for how it is named, deduped and recorded.

**Which screen loads.** A kiosk-driven target is navigated to its screen route
(`/screen/<name>`). The route comes from the device's `screen_path` in
`devices.yml`. A content device without one is resolved once, at boot, by
`ScreenAddressResolver`: first a fuzzy match of the device id or location
against `household/screens/*.yml` (`office-tv` → `/screen/office`; e-ink screens
are excluded), then the `living-room` default. The boot log records the choice
as `deviceFactory.screenPath.fuzzy` (info) or `deviceFactory.screenPath.default`
(warn). A default means the device will run the living-room screen, with that
screen's widgets and guardrails, so give such a device its own screen or an
explicit `screen_path`.

**Response (200):**
```json
{
  "ok": true,
  "deviceId": "<id>",
  "dispatchId": "<uuid>",
  "totalElapsedMs": 2418,
  "steps": [ { "step": "power", "elapsedMs": 120, "status": "success" } ]
}
```

#### `GET /api/v1/device/:id/volume/:level` *(deprecated)*
Live volume on a remote surface without re-dispatch. **Deprecated** — use
§4.5 `PUT /api/v1/device/:id/session/volume` instead. The handler is
retained for backward compatibility and emits a `device.volume.deprecated`
warn on every call.

### 2.4 Household media memory

**Exists.** The household's shared memory of what has played on every screen:
recent (RQ-FIND-11), carry on with per-screen spots (RQ-FIND-12, RQ-PLAY-08/09),
watched marks (RQ-FIND-13), favourites (RQ-FIND-14) and removal from the
household list (RQ-FIND-15). Router: `backend/src/4_api/v1/routers/media.mjs`;
service: `backend/src/3_applications/media/HouseholdMediaMemoryService.mjs`;
list rules: `backend/src/2_domains/media/householdMediaList.mjs`; spot rules:
`backend/src/2_domains/content/services/mediaSpots.mjs`.

All routes take the optional `?household=<id>` used by the rest of
`/api/v1/media`. Content ids travel in the **body or query, never the path**
(they contain `:` and often `/`). Without the service wired, every route
answers **501**.

#### Where the data comes from

| Data | Written by | Stored |
|---|---|---|
| Per-screen spots | `POST /api/v1/play/log` with a device | `spots` / `lastDevice` on the progress record (household `media/memory/**`) |
| Play ledger | `POST /api/v1/play/log` with a device, on each playback **start** | `history/media-plays/<local YYYY-MM-DD>.yml`, 90-day retention |
| Favourites | `POST/DELETE /household/favourites` | `media/favourites.yml` (`items: [...]`) |
| Removed ids | `POST/DELETE /household/removed` | `media/removed.yml` (`items: {<id>: {removedAt}}`) |
| What is on a screen now | `device-state:<id>` broadcasts | in memory (`DeviceLivenessService`) |

**Screen identity.** `play/log` keys a spot by an explicit body `deviceId`,
else the `X-Daylight-Device` header when the client sent it (every
`DaylightAPI` call does: `fleet:<devices.yml key>` on a rendered screen,
`browser:<token>` elsewhere). The prefix is required (no bare names), and a
`fleet:` id must be declared in the household's `devices.yml`.
`ephemeral:` ids and the User-Agent fallback never key a spot. No device →
legacy single-playhead write only. `play/log` also accepts an optional
`origin` recorded on the ledger row: structured `{kind: "device"|"routine",
id, name}` (ids ≤ 96, names ≤ 64 chars; a device needs `id`, a routine `id`
or `name`; anything else is dropped to null) or legacy free text (≤ 64).
When a start reports none, the ledger takes the origin a load noted for that
screen within the last 3 min (routine or remote send, §2.6).

**Defaults** (NF-DEF): unfinished after **5 min or 5%** played; finished at
**90%** — the line `MediaProgress.isWatched`, `completedAt` and Plex
next-episode selection already use, read as "the credits have started". An
item leaves carry on only when no screen holds an open spot. A same-item
report after **15 quiet minutes** on a screen is a new ledger start; a
terminal report (`naturalEnd`, or `status` `completed`/`stopped`/`ended`)
ends that screen's session and is never a start.

**Per-screen accounting.** `watchTime` and `playCount` are measured against
the reporting screen's own spot, so two screens on one item do not inflate
them. A screen's first report (no spot yet) is measured against the shared
playhead, as before spots existed. On the first spot-aware write to a record
whose single playhead is still open, that playhead is kept as a reserved
`legacy` spot (`kind: "unknown"`); it retires once any screen plays past it.
Records from several namespaces with the same id (a watchlist's and the
library's) are merged: newest record's fields, every screen's newest spot.

#### Shapes

`HouseholdEntry` (recent and carry on):

```json
{
  "contentId": "plex:12345",
  "namespaceId": "plex/6_movies",
  "lastPlayed": "2026-10-02 08:00:00",
  "playhead": 720, "duration": 7200, "percent": 10,
  "finished": false, "completedAt": null,
  "playedOn": { "deviceId": "browser:c74f…", "kind": "browser", "screenId": null },
  "spots": [
    { "deviceId": "browser:c74f…", "kind": "browser", "screenId": null,
      "playhead": 720, "duration": 7200, "percent": 10,
      "lastPlayed": "2026-10-02 08:00:00", "open": true },
    { "deviceId": "fleet:livingroom-tv", "kind": "screen", "screenId": "livingroom-tv",
      "playhead": 4800, "duration": 7200, "percent": 67,
      "lastPlayed": "2026-10-01 21:00:00", "open": true }
  ],
  "title": "…", "thumbnail": "/api/v1/proxy/plex/…", "type": "movie",
  "parentTitle": null, "grandparentTitle": null,
  "parentId": null, "grandparentId": null, "itemIndex": null
}
```

- `lastPlayed` uses the progress store's local `YYYY-MM-DD HH:mm:ss`
  (not ISO); ledger `startedAt` is ISO UTC.
- `kind` is `screen` (`fleet:`), `browser`, or `unknown`; `screenId` is the
  `devices.yml` key for screens, null otherwise. The UI names the screen.
- `spots` in **recent** lists every screen's spot (`open` says whether it
  still counts as unfinished); in **carry on** only open spots, newest first.
  Records written before spots existed have `spots: []` in recent and one
  spot with `deviceId: null` in carry on.
- Display fields come from the content catalog: cached 5 min when found,
  10 s when the catalog has no such item, **never** after a failed lookup;
  at most 4 lookups in flight; each bounded at 4 s and the whole
  recent/carry-on request at 8 s. On a miss the fields are `null` and the
  entry is still returned.

`PlayLedgerRow`:

```json
{ "startedAt": "2026-10-03T04:54:07.081Z", "localTime": "2026-10-02 21:54:07",
  "deviceId": "fleet:livingroom-tv", "contentId": "plex:12",
  "title": "S1E2", "kind": "episode",
  "parentId": "plex:10", "grandparentId": "plex:100",
  "origin": { "kind": "routine", "id": "automation:kitchen_button_1", "name": "Kitchen Button 1: Morning Program" } }
```

`origin` is null when unknown; rows written before 2026-10-03 may hold a
legacy string.

#### `GET /household/recent?limit=24`

Everything played on any screen, newest first (`limit` ≤ 200). Each entry is
a `HouseholdEntry` plus `plays`: that item's ledger starts from the last 14
days, newest first, up to 5, each `{deviceId, kind, screenId, startedAt, origin}`. `playedOn` is the
screen that last reported progress, else the screen that last started it.
Items the ledger saw but progress never stored are included. Removed items
are hidden.

**Response:** `{ "items": [HouseholdEntry] }`

#### `GET /household/carry-on?limit=20`

```json
{ "items": [HouseholdEntry & { "reason": "unfinished" | "next-episode" }],
  "nowOn": [HouseholdEntry & { "deviceId", "screenId", "state", "position" }],
  "nowPlayingKnown": true }
```

- `unfinished`: at least one open spot.
- `next-episode`: the episode after a recently finished one (season, then
  the first episode of the next season via the show), offered when it is
  neither started nor finished; carries `after` (the finished episode id) and
  `afterPlayedAt`, and empty `spots`. At most one per show and 8 in all,
  scanning up to 40 recently finished items (24 lookups) so finished songs
  cannot hide an episode.
- Both kinds are ranked together by recency (when the spot was left / the
  previous episode finished), then cut to `limit`.
- Songs (`type: "track"`) are never carry on.
- `nowOn`: items on a screen right now — online, with `state` in
  `playing | paused | buffering | loading | stalled` — are moved here instead
  of `items` ("Now on <screen> · Remote · Move here"). Two sources, fleet
  `device-state` first: screens that publish it, and any device whose
  `play/log` reported within the last 60 s (browsers and kiosks; these have
  `state: "playing"`, `position: null`). `nowPlayingKnown: false` means no
  source could be read.

#### `GET /household/plays?deviceId=&from=&to=&limit=100`

The play ledger: starts by screen and/or ISO time window (inclusive),
newest first, `limit` ≤ 1000, default window the 90-day retention. Basis for
Played earlier (RQ-FIND-17), how it started (RQ-HOUSE-07) and time-of-day
suggestions. **400** on an unparseable `from`/`to`.

**Response:** `{ "items": [PlayLedgerRow], "ledger": true }` (`ledger: false`
with no ledger wired).

#### Favourites

| Route | Body / query | Response |
|---|---|---|
| `GET /household/favourites` | — | `{ items: [Favourite] }` newest first |
| `POST /household/favourites` | `{ id, kind?: "item" \| "collection", title?, thumbnail?, type? }` | `{ item, items }` |
| `DELETE /household/favourites` | `id` (body or query) | `{ removed: boolean, items }` |

`Favourite`: `{ id, kind, title, thumbnail, type, addedAt }`. Adding an id
already present refreshes it (no duplicates). Missing `title`/`thumbnail` are
filled from the catalog at add time. **400**: missing `id`, unknown `kind`.

#### Removal from the household list

| Route | Body / query | Response |
|---|---|---|
| `GET /household/removed` | — | `{ items: [{ id, removedAt }] }` |
| `POST /household/removed` | `{ id }` | `{ id, removedAt }` |
| `DELETE /household/removed` (undo) | `id` (body or query) | `{ id, restored: boolean }` |

A removal hides what was played **up to** `removedAt` from recent and carry
on; playing the item again brings it back. Server-side suggestions (§2.9)
leave removed ids out. The 10 s undo window is a client concern: undo is
`DELETE`.

#### `POST /household/watched`

Body `{ contentId, watched: boolean }`. **400** unless `watched` is a boolean
and `contentId` carries a source the content catalog resolves
(`UNKNOWN_SOURCE`; nothing is written). **501** when marks are not wired.

```json
{ "contentId": "plex:12345", "watched": true, "namespaces": ["plex/6_movies"],
  "playhead": 7200, "duration": 7200, "percent": 100, "completedAt": "2026-10-02 12:00:00" }
```

See [content-progress.md](../content/content-progress.md) for what a mark
writes. No undo field: undo is the opposite mark, which cannot restore the
screens' previous spots.

#### Log events

`media.favourite.added|removed`, `media.household-list.removed|restored`,
`media.mark.written` (info); `media.play-ledger.started` (info) and
`.write_failed` (warn); `media.household-list.next_episode_failed`,
`.now_playing_failed`, `.ledger_read_failed`, `media.mark.remote_push_failed`
(warn). `play.log.updated` carries `spotDevice`.

**Verified by:** `backend/src/2_domains/content/services/mediaSpots.test.mjs`,
`backend/src/2_domains/media/{householdMediaList,playLedger}.test.mjs`,
`backend/src/3_applications/media/{HouseholdMediaMemoryService,PlayLedgerRecorder,LivenessNowPlayingReader}.test.mjs`,
`backend/src/3_applications/content/usecases/{MarkContentWatched,RecordPlaybackProgress.spots}.test.mjs`,
`backend/src/4_api/v1/routers/{media.household,play.spots}.test.mjs`,
`tests/isolated/adapter/persistence/{YamlMediaProgressMemory.spots,YamlHouseholdMediaListsDatastore,YamlPlayLedgerDatastore}.test.mjs`.


### 2.5 Household screen registry

**Exists.** One list of every screen in the house under a human name that is
unique household-wide (RQ-HOUSE-06, RQ-HOUSE-08, RQ-AUTO-02). Router:
`backend/src/4_api/v1/routers/mediaHouse.mjs` (mounted on the media router);
service: `backend/src/3_applications/media/ScreenRegistryService.mjs`; rules:
`backend/src/2_domains/media/screenRegistry.mjs`. Every route in §2.5–2.9
takes the optional `?household=<id>` and answers **501** when its service is
not wired.

**Screen ids** are stable; routines and the ledger use them, never names.

| Id | Screen | Source of name/room |
|---|---|---|
| `fleet:<devices.yml key>` | a configured TV, kiosk, tablet or speaker — devices with `content_control`, a `fleet` lane, a `plex` client or a playback type | `devices.yml` `name` / `location` (read-only); an app rename or room change is an **override stored in the registry**, never a `devices.yml` write |
| `browser:<clientId>` | a browser running the app | registered the first time it announces itself (or publishes `playback_state`); the registry name is then authoritative |
| `screen:<slug>` | a screen added by hand | the registry |

Bare devices.yml keys are accepted wherever a screen id is (`livingroom-tv`
→ `fleet:livingroom-tv`).

**Stored** at `household[-{id}]/media/screens.yml` (`{ screens: {<id>: …},
aliases: {<duplicate id>: {into, mergedAt}} }`), written only through the app.
An announce from a known screen refreshes an in-memory `lastSeen` and
persists it at most every 10 min. `lastSeen` also comes from fleet
`device-state` heartbeats (online/offline) and each screen's newest play-ledger
start.

**Names.** Trimmed, single-spaced, ≤ 48 chars, unique case-insensitively among
live (not retired) screens, including configured names. A rename to a taken
name is **409 `NAME_TAKEN`** with `heldBy` and a free `suggestion`
(`"Kitchen tablet (2)"`), unless `onCollision: "suffix"` takes the suggestion.
A browser registering under a taken name is suffixed with its id prefix
(`"Kitchen tablet (aaaa1111)"`), as the client's `renameBrowserIdentity` does.
Renames are recorded (`renames: [{from, to, at}]`, last 10); `wasName` is the
name the screen had at the start of the last week's renames, shown as
"Poo (was Kitchen tablet)" for **7 days** *(default)*.

**Routine warning.** Renaming or retiring a screen that a routine targets
(§2.6, including duplicates merged into it) is **409 `ROUTINES_TARGET`** with
the `routines` until repeated with `confirm: true`. Routines follow the id, so
a confirmed rename never breaks them.

`Screen`:

```json
{ "id": "fleet:livingroom-tv", "kind": "screen", "screenId": "livingroom-tv",
  "name": "Den TV", "configuredName": "Living Room TV",
  "wasName": "Living Room TV", "renamedAt": "2026-10-03T08:00:00.000Z",
  "room": "Living Room", "type": "shield-tv", "configured": true, "wakeable": true,
  "source": "configured", "firstSeen": null, "lastSeen": "2026-10-03T05:00:00.000Z",
  "online": true, "retiredAt": null, "aliases": ["browser:c74f…"] }
```

`kind`: `screen` (fleet) | `browser` | `added`. `wakeable`: devices.yml has
`device_control` (a routine can turn it on). `online`: from fleet liveness,
null when unknown (browsers, or no heartbeat since the backend started).
`aliases`: duplicates merged into it.

| Route | Body / query | Response |
|---|---|---|
| `GET /screens` | — | `{ screens: [Screen], notSeenLately: [Screen], retired: [Screen] }` — by name; `notSeenLately` = silent > **30 days** *(default)* and not online |
| `POST /screens` | `{ name, room? }` | **201** `{ screen }` (`screen:<slug>`) |
| `POST /screens/announce` | `{ id?, name?, room? }` — `id` defaults to `X-Daylight-Device` | `{ screen }` |
| `GET /screens/:id` | — | `{ screen, routines }` (**404** unknown) |
| `PATCH /screens/:id` | `{ name?, room?, onCollision?: "reject"\|"suffix", confirm? }` (`room: null` clears an override) | `{ screen, routines }` |
| `POST /screens/:id/merge` | `{ into }` | `{ screen, movedSpots }` |
| `POST /screens/:id/retire` | `{ confirm? }` | `{ screen, routines }` |
| `POST /screens/:id/restore` | — | `{ screen }` (**409** if its name was taken meanwhile) |
| `GET /screens/:id/routines` | — | `{ items: [{ id, name, kind, source }] }` |

**Merge** folds a duplicate into its earlier self: the duplicate's id becomes
an alias (plays, started-by, time-of-day and history follow it; chains are
flattened), the earliest `firstSeen` and latest `lastSeen` are kept, and its
per-screen spots move onto the target (newer spot wins where both hold one;
`lastDevice` follows). A configured screen cannot be merged away — merge the
duplicate into it. **Retire** removes a screen from the list and frees its
name. Errors: **400** `INVALID_NAME` / `INVALID_SCREEN_ID` / `INVALID_MERGE`,
**404** `SCREEN_NOT_FOUND`, **409** `NAME_TAKEN` / `ROUTINES_TARGET` /
`SCREEN_MERGED`.

Log events: `media.screens.registered|renamed|room_set|added|merged|retired|restored`
(info); `media.screens.spot_move_failed`, `.signals_failed`,
`.configured_read_failed` (warn); `eventbus.screen_presence.failed` (warn).

### 2.6 Routines

**Exists.** Which routines start playback on which screen, and how their
starts went (RQ-AUTO-02, RQ-AUTO-05). Service:
`RoutineCatalogService`, `RoutineHistoryService`, `RoutineLoadRecorder`
(`backend/src/3_applications/media/`); rules:
`backend/src/2_domains/media/routineCatalog.mjs`, `routineHistory.mjs`.

**Where routines come from.** Home Assistant automations and scripts that end
in `GET /api/v1/device/<id>/load?<query>`. The catalog follows each
automation → script → `rest_command` chain, substituting the variables passed
along it (`query: queue=morning-program` into
`load?{{ query | default(...) }}`), to the target screen (`fleet:<id>`) and
query. Sources, merged:

| Source | When |
|---|---|
| `live` | the HA config read in place (`rest_commands/` merged, `scripts/` named by file, `automations/` one per file) from system config `media-routines.yml` → `homeAssistant.configDir` (the HA `_includes` dir), cached 60 s. Unreadable → unavailable. |
| `snapshot` | the last catalog imported via `PUT /routines/catalog`, stored at `household[-{id}]/media/routines.yml`; used when no live source is available (the container does not mount the HA config). Push it with `node cli/media-routines.cli.mjs push --dir <HA _includes> --url <app>`. |
| `observed` | routines neither knows, seen in the routine history or as a routine `origin` on play-ledger starts in the last 30 days (a routine driving a browser by command reaches the ledger this way) — `id: "observed:<slug>"` |

`Routine`: `{ id: "automation:kitchen_button_4", name, kind: "automation"|"script"|"command"|"observed",
source, targets: [{ deviceId: "fleet:livingroom-tv", screenId, query }], via: ["script:…", "rest_command:…"] }`.
A loading `rest_command` that nothing calls is listed as `kind: "command"`.

**Who asked for a load.** The device router's wake-and-load runs inside a
request context (`withRequestContext`: User-Agent, `X-Daylight-Device`). For
each `GET|POST /device/:id/load`:

1. `routine=<name>` (optional `routineId=`) in the query → a routine that
   names itself; both params are stripped before the screen sees the query.
2. User-Agent `HomeAssistant/…` → a routine, named by matching screen + query
   params (template values match anything; automations rank first) against
   the catalog, else `"Home Assistant"`.
3. `X-Daylight-Device` (`fleet:`/`browser:`, not the target itself) → a person
   sending from that screen (`{kind: "device", id}`).

The origin is noted for the target's next ledger start (3 min; cleared when the
load fails). A routine's load runs through the routine dedupe (same routine +
query to the same screen within **10 s** starts once; the repeat reports
`deduplicated: true`) and its outcome is appended to
`household[-{id}]/history/media-routines.yml` (30 days, 500 runs). The load
itself is never changed or failed by this.

`RoutineRun`:

```json
{ "at": "2026-10-03T14:02:00.000Z",
  "routine": { "id": "automation:kitchen_button_4", "name": "Kitchen Button 4: Slow TV" },
  "deviceId": "fleet:livingroom-tv", "screenName": "Living Room TV",
  "what": { "key": "queue", "value": "slow-tv", "contentId": null },
  "outcome": "failed", "reason": "Living Room TV did not turn on",
  "failedStep": "power", "elapsedMs": 19, "dispatchId": "7e04…",
  "played": null }
```

`outcome`: `started` | `failed` | `deduplicated`. `reason` (plain, names the
screen): power → "did not turn on"; verify → "turned on but didn't come up";
prepare → "could not get ready"; load → "didn't respond — it may be asleep or
closed"; prewarm → "Couldn't find <what>"; unknown device → "isn't set up";
thrown → "Something went wrong (…)". `played`: the first ledger start on that
screen within 5 min after a started run (`{contentId, title, startedAt}`).

`RoutineFlag`: `{ routine: {id, name}, deviceId, screenName, problem, severity, reason }`.

| `problem` | `severity` | When |
|---|---|---|
| `unknown-screen` | warn | target is not a screen in the registry |
| `retired` | warn | target was retired |
| `last-start-failed` | warn | the routine's last run on that screen failed (its reason) |
| `unreachable` | warn | a browser not heard from in 10 min ("isn't open right now"), or a non-wakeable fleet screen reported offline |
| `off` | info | a wakeable screen reported offline ("…is off; the routine will turn it on") |

Unknown state (no heartbeat since the backend started) raises no flag.

| Route | Body / query | Response |
|---|---|---|
| `GET /routines` | — | `{ routines: [Routine], sources: [{ name, kind, available, count, readAt?/importedAt?, used?, from? }] }` |
| `PUT /routines/catalog` | `{ config: {restCommands, scripts, automations} }` or `{ routines: [Routine] }`, `source?` | `{ count, dropped, importedAt }` (**400** `INVALID_ROUTINES`) |
| `GET /routines/history` | `?limit=50 (≤500)&deviceId=&routineId=` | `{ items: [RoutineRun] }` newest first; `deviceId` includes merged duplicates |
| `GET /routines/flags` | — | `{ items: [RoutineFlag] }` |

Log events: `media.routines.load`, `media.routines.run` (info; warn when
failed), `media.routines.snapshot_imported` (info);
`media.routines.history_write_failed`, `.live_read_failed`,
`.snapshot_read_failed`, `.ha_file_unreadable`, `.match_failed` (warn).

### 2.7 Started by

**Exists.** How a screen's playback started — by which device or routine, and
when (RQ-HOUSE-07, HOUSE.5a). Service: `ScreenPlaybackService.startedBy`.

Order: the screen's live session snapshot `meta.origin` (fleet
`device-state`), else the ledger: the screen's starts (merged duplicates
included) in the last 24 h are walked back through the **current run** —
starts no more than 30 min apart — to the first carrying an origin, so every
item of a queue a routine started reads "Started by Kitchen button, 7:02".
A device origin is named from the registry.

```json
{ "deviceId": "fleet:livingroom-tv",
  "playing": { "contentId": "plex:3", "title": "Third" },
  "startedBy": { "kind": "routine", "id": "automation:kitchen_button_1", "name": "Kitchen Button 1: Morning Program" },
  "at": "2026-10-03T14:02:31.000Z", "source": "ledger", "runStartedAt": "2026-10-03T14:02:31.000Z" }
```

`playing` is null when nothing reports playing now; `startedBy`/`at`/`source`
are null when the run has no known origin (a person at the screen itself, or a
start before origins were recorded). `kind` may be `unknown` for legacy text.

| Route | Response |
|---|---|
| `GET /screens/:id/started-by` | the object above |
| `GET /started-by` | `{ items: [ … ] }` for every screen playing now |

### 2.8 Played earlier

**Exists.** Each screen's plays, newest first, with picture, title and time
played (RQ-FIND-17, FIND.11a). Every start is a row, so shuffled and "keep
similar things playing" runs are included. Service:
`ScreenPlaybackService.playedEarlier`.

`GET /screens/:id/played-earlier?limit=50 (≤200)&before=<ISO>` →

```json
{ "deviceId": "fleet:livingroom-tv",
  "items": [ { "contentId": "plex:59498", "startedAt": "2026-10-02T07:50:00.000Z",
    "localTime": "2026-10-02 00:50:00", "title": "Bike",
    "thumbnail": "/api/v1/proxy/plex/library/metadata/59498/thumb/17", "type": "episode",
    "parentTitle": "Season 1", "grandparentTitle": "Bluey (2018)",
    "parentId": "plex:59494", "grandparentId": "plex:59493",
    "playedOn": "fleet:livingroom-tv", "origin": null } ] }
```

The item playing now is left out (it is not "earlier"). `before` pages back
(**400** when unparseable). Display fields come from
`HouseholdMediaMemoryService.describeMany` — the same catalog cache,
concurrency (4) and deadlines (4 s each, 8 s per request) as §2.4; a miss keeps
the ledger title and a null picture. Merged duplicates are included
(`playedOn` says which id).

### 2.9 Suggestions

**Exists.** The start page's suggestions, built server-side (RQ-FIND-16,
FIND.7a; owner-adopted definition of O3). Service:
`backend/src/3_applications/media/MediaSuggestionsService.mjs`; rules:
`backend/src/2_domains/media/mediaSuggestions.mjs`.

`GET /suggestions?deviceId=` (`deviceId` defaults to `X-Daylight-Device`) →

```json
{ "deviceId": "fleet:livingroom-tv", "generatedAt": "2026-10-03T08:29:34.859Z", "empty": false,
  "rows": [
    { "id": "favourites", "title": "Favourites", "items": [ { "id": "plex:59493", "kind": "collection", "type": "show", "title": "Bluey", "thumbnail": "…", "continue": { "contentId": "plex:59535", "title": "Bingo" } } ] },
    { "id": "carry-on", "title": "Carry on", "items": [ { "id": "plex:672414", "kind": "item", "type": "movie", "title": "…", "thumbnail": "…", "reason": "unfinished", "percent": 40, "playhead": 720, "duration": 1800, "playedOn": "fleet:livingroom-tv", "parentId": null, "grandparentId": null } ] },
    { "id": "time-of-day", "title": "Usually here at this time", "items": [ { "id": "plex:59493", "kind": "collection", "type": "show", "title": "Bluey (2018)", "thumbnail": "…", "days": 3, "lastPlayedAt": "2026-10-02 00:50:00", "continue": { "contentId": "plex:59498", "title": "Bike" } } ] },
    { "id": "new", "title": "New", "items": [ { "id": "plex:707595", "kind": "item", "type": "movie", "title": "The Terminators", "thumbnail": "…", "addedAt": "2026-10-01T…", "latest": null } ] } ] }
```

Rows, in order, empty rows hidden:

| Row | From |
|---|---|
| Favourites | `GET /household/favourites` (read on every request) |
| Carry on | `GET /household/carry-on` items |
| Usually here at this time | ledger starts **on this screen** (and its merged duplicates) whose local start time is within **±90 min** of now (wrapping midnight), last **30 days**; grouped by collection (episode → show, track → album, else the item) and ranked by **distinct days**, not play count; at least **3** days; `continue` = the group's newest item. A screen with none falls back to the whole household, titled **"Usually at this time"**. |
| New | catalog additions in the last **14 days** (Plex `/library/recentlyAdded`), episodes/seasons collapsed to their show and tracks to their album; `latest` = the newest item added to it (null when it is the item itself). Plex items now carry `metadata.addedAt` (ISO). |

Rules: **≤ 6 per row, ≤ 20 in all**; duplicates removed with precedence
favourites > carry on > time of day > new, matching through show/album ids (a
dropped carry-on episode of a favourite show becomes that favourite's
`continue`); anything **playing on any screen now** (and its show/album) and
anything **removed from the household list** is left out. Nothing at all →
`{ rows: [], empty: true }`: lead into Browse. The build (carry on, ledger
scan, catalog lookups, recently added) is cached per household + screen for
**5 min**; favourites, now-playing and removals are applied on every request.
A failing section is logged and left empty.

Log events: `media.suggestions.built` (info: per-section counts, scope, ms);
`media.suggestions.section_failed`, `.ledger_read_failed`,
`.now_playing_failed`, `.removed_read_failed`, `plex.recently_added.failed` (warn).

**Verified by (§2.5–2.9):**
`backend/src/2_domains/media/{screenRegistry,routineCatalog,routineHistory,mediaSuggestions,playLedger}.test.mjs`,
`backend/src/3_applications/media/{ScreenRegistryService,ScreenSignalsReader,RoutineCatalogService,RoutineHistoryService,RoutineLoadRecorder,LoadOriginHints,ScreenPlaybackService,MediaSuggestionsService,PlayLedgerRecorder,HouseholdMediaMemoryService}.test.mjs`,
`backend/src/4_api/v1/routers/mediaHouse.{screens,routines,playback,suggestions}.test.mjs`,
`backend/src/1_adapters/{devices/ConfigMediaScreenCatalog,eventbus/EventBusScreenPresence,home-automation/HomeAssistantRoutineFileSource,content/media/plex/PlexAdapter.recentlyAdded}.test.mjs`,
`backend/src/0_system/http/middleware/requestContext.test.mjs`,
`tests/isolated/adapter/persistence/{YamlScreenRegistryDatastore,YamlRoutineStores}.test.mjs`,
composition contract `media.routine-loads-reach-history-and-ledger-origin`.

---

## 3. Reserved

*(A point-in-time contract gap analysis previously lived here; it tracked the
initial build-out and is obsolete. Delivery status belongs in `docs/_wip/`
plans, not in this reference.)*

---

## 4. Device Session HTTP APIs

### 4.1 `GET /api/v1/device/:id/session`

Returns a snapshot of the remote surface's current session state.

**Response (200):** `SessionSnapshot` (§9.2)

**Response (204):** empty body when the surface is idle.

**Response (503):** offline; includes last-known snapshot:
```json
{
  "offline": true,
  "lastKnown": { /* SessionSnapshot */ },
  "lastSeenAt": "<ISO-8601>"
}
```

**Consistency requirement.** The returned snapshot MUST reflect state
already broadcast on `device-state:<id>` (§7) within 500ms.

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session.test.mjs` — all response codes + consistency-with-liveness
- `backend/tests/unit/suite/4_api/v1/routers/device.session.integration.test.mjs` — end-to-end round trip

### 4.2 Device history — **Deferred** (requirement C4.3; no contract defined yet)

### 4.3 `POST /api/v1/device/:id/session/transport`

Drives transport on the remote session.

**Request body:**
```json
{ "action": "play" | "pause" | "stop" | "seekAbs" | "seekRel" | "skipNext" | "skipPrev",
  "value": <number, optional>,
  "commandId": "<uuid>" }
```

**Response (200):** `{ ok: true, commandId, appliedAt }`
**Response (404):** unknown device.
**Response (409):** device offline (last-known snapshot in body).
**Response (502):** device refused/errored — `{ ok: false, error, code }`.

Retrying with the same `commandId` within 60s MUST be a no-op.

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-transport.test.mjs` — request validation + result mapping
- `backend/tests/unit/suite/4_api/v1/routers/device.session.integration.test.mjs` — envelope dispatch + ack round trip
- `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs` — idempotency (replay + conflict)

### 4.4 `POST /api/v1/device/:id/session/queue/:op`

Mutates the remote session's queue.

**`:op` values:**
| Op | Body | Semantics |
|---|---|---|
| `play-now` | `{ contentId, clearRest?: bool, commandId }` | Replace current item; queue cleared iff `clearRest` is true. |
| `play-next` | `{ contentId, commandId }` | Insert after current item. |
| `add-up-next` | `{ contentId, commandId }` | Append to Up Next sub-queue. |
| `add` | `{ contentId, commandId }` | Append to end. |
| `reorder` | `{ from, to, commandId }` OR `{ items: queueItemId[], commandId }` | Move one item or replace ordering. |
| `remove` | `{ queueItemId, commandId }` | Remove an item. |
| `jump` | `{ queueItemId, commandId }` | Jump to a specific queue item. |
| `clear` | `{ commandId }` | Clear entire queue. |

**Response (200):** `{ ok: true, commandId, queue: QueueSnapshot }`

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-queue.test.mjs` — per-op validation for all 8 ops
- `shared/contracts/media/envelopes.test.mjs` — envelope validator accepts each op shape

### 4.5 Session configuration setters

| Endpoint | Body |
|---|---|
| `PUT /api/v1/device/:id/session/shuffle` | `{ enabled: bool, commandId }` |
| `PUT /api/v1/device/:id/session/repeat` | `{ mode: "off" \| "one" \| "all", commandId }` |
| `PUT /api/v1/device/:id/session/shader` | `{ shader: string \| null, commandId }` |
| `PUT /api/v1/device/:id/session/volume` | `{ level: int 0-100, commandId }` |

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-config.test.mjs` — all four PUTs: validation + config envelope shape

### 4.6 `POST /api/v1/device/:id/session/claim`

Atomic Take Over: stops the remote session and returns its snapshot.

**Request body:** `{ commandId: "<uuid>" }`

**Response (200):**
```json
{
  "ok": true,
  "commandId": "<uuid>",
  "snapshot": { /* SessionSnapshot captured immediately before stop */ },
  "stoppedAt": "<ISO-8601>"
}
```

**Atomicity requirement (C7.4).** Server MUST guarantee that either the
snapshot is captured *and* the remote is stopped, or neither. On partial
failure, server MUST restore the remote's prior state and return 502
(`ATOMICITY_VIOLATION`).

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.session-claim.test.mjs` — router-level validation + mapping
- `backend/tests/unit/suite/4_api/v1/routers/device.session-claim.integration.test.mjs` — happy + refused paths; liveness cache unchanged on refusal
- `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs` — claim algorithm (snapshot-then-stop)

### 4.7 `POST /api/v1/device/:id/load` (amended)

**Request (existing, supported):** query params as documented in §2.3.

**Request (amended, new):**
```
POST /api/v1/device/:id/load
Content-Type: application/json
```
```json
{
  "dispatchId": "<uuid>",
  "snapshot": { /* SessionSnapshot */ },
  "mode": "adopt"
}
```

`"mode": "adopt"` tells the target to adopt the provided snapshot.

**Response (200):** same as existing dispatch response + `"adopted": true`.

**Idempotency (C9.8).** Repeating a dispatch with the same `dispatchId`
within 60s MUST be a no-op.

**Verified by:**
- `backend/tests/unit/suite/4_api/v1/routers/device.load-adopt.test.mjs` — adopt body validation + idempotency-conflict mapping
- `backend/tests/unit/suite/3_applications/devices/DispatchIdempotencyService.test.mjs` — 60s TTL cache semantics
- `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs` — adoptSnapshot wake path

### 4.8 Multi-target dispatch

**Decision: Option A — client-side fan-out.** No new API. App issues N
parallel `POST /api/v1/device/:id/load` calls with independent `dispatchId`s.
Failure isolation is per-device.

---

## 5. Reserved

---

## 6. Screen-framework Contract (Device-side)

### 6.1 Authority model

- The **device** is authoritative for its own session state. Broadcasts on
  `device-state:<id>` are ground truth; controllers and the backend treat
  them as read-only.
- The **backend** is a relay. It forwards commands to devices, fans out
  device broadcasts, and synthesizes offline signals. It does not maintain
  its own copy of session state.
- On conflict (two controllers issuing commands concurrently), the device
  applies in receive order. No locking (N4.2).

### 6.2 Subscribed topic — inbound commands

All commands arrive in a structured envelope (replacing the existing flat
shape consumed by `useScreenCommands`):

```json
{
  "type": "command",
  "targetDevice": "<deviceId>",
  "targetScreen": "<screenId>",
  "commandId": "<uuid>",
  "command": "transport" | "queue" | "config" | "adopt-snapshot" | "system",
  "params": { /* command-specific */ },
  "ts": "<ISO-8601>"
}
```

- `targetDevice` / `targetScreen` MUST be validated by the device; mismatches
  ignored.
- `commandId` is required. The device MUST ack every valid command on
  `device-ack:<deviceId>`.
- Retried commands with the same `commandId` within 60s MUST be idempotent.

**Verified by:**
- `shared/contracts/media/envelopes.test.mjs` — `validateCommandEnvelope` covers all five command kinds + per-kind param validation
- `shared/contracts/media/commands.test.mjs` — enum guards for transport/queue/config/system actions
- `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx` — device ack publication on ActionBus completion
- `frontend/src/screen-framework/commands/useScreenCommands.test.jsx` — structured envelope consumer

#### 6.2.1 `command: "transport"`
```json
{ "action": "play" | "pause" | "stop" | "seekAbs" | "seekRel" | "skipNext" | "skipPrev",
  "value": <number> }
```
Device routes to the active renderer via the ActionBus. Seek values in seconds.

#### 6.2.2 `command: "queue"`
```json
{ "op": "play-now" | "play-next" | "add-up-next" | "add" | "reorder" | "remove" | "jump" | "clear",
  "contentId": "<contentId>",
  "queueItemId": "<id>",
  "from": "<queueItemId>", "to": "<queueItemId>",
  "items": ["<queueItemId>", ...],
  "clearRest": <bool>
}
```

#### 6.2.3 `command: "config"`
```json
{ "setting": "shuffle" | "repeat" | "shader" | "volume",
  "value": <per-setting> }
```

#### 6.2.4 `command: "adopt-snapshot"`
Used for Hand Off (C7.2). Atomic replace of current session.
```json
{ "snapshot": { /* SessionSnapshot */ },
  "autoplay": <bool, default true> }
```
Device MUST:
1. Stop any current playback; clear queue.
2. Load snapshot's queue, shader, volume, shuffle, repeat.
3. Select current item; seek to `snapshot.position` once renderer ready.
4. Resume playback if `autoplay: true`.
5. Broadcast adopted snapshot.

On any failure mid-adoption, device MUST reset to idle and ack with error.

#### 6.2.5 `command: "system"`
`reset`, `reload`, `sleep`, `wake`. Ported from existing `useScreenCommands`
into the envelope.

### 6.3 Published topic — device acks

```json
{
  "topic": "device-ack",
  "deviceId": "<id>",
  "commandId": "<uuid>",
  "ok": <bool>,
  "error": "<string>",
  "code": "<string>",
  "appliedAt": "<ISO-8601>"
}
```
Acks MUST be sent within 5 seconds of receiving the command. For long
operations, ack indicates acceptance; completion observable via state feed.

**Verified by:**
- `shared/contracts/media/envelopes.test.mjs` — `buildCommandAck` + `validateCommandAck`
- `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx` — ActionBus completion → ack emission
- `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs` — ack timeout → DEVICE_REFUSED

### 6.4 Published topic — device state

Hybrid model:

- **Reactive push** on any state change (play/pause/stop, seek, item advance,
  queue mutation, config change, adoption completion). Debounced 500ms.
- **Heartbeat** every 5s while in any non-idle state. Every 30s (or suppressed)
  while idle.
- **On subscription**: backend MUST replay the last known snapshot.

Payload:
```json
{
  "topic": "device-state",
  "deviceId": "<id>",
  "snapshot": { /* SessionSnapshot */ },
  "reason": "change" | "heartbeat" | "initial" | "offline",
  "ts": "<ISO-8601>"
}
```

**Verified by:**
- `shared/contracts/media/envelopes.test.mjs` — `buildDeviceStateBroadcast` + `validateDeviceStateBroadcast`
- `frontend/src/screen-framework/publishers/useSessionStatePublisher.test.jsx` — reactive + heartbeat + debounce
- `frontend/src/screen-framework/publishers/SessionSource.test.js` — source factory contract
- `backend/tests/unit/suite/3_applications/devices/DeviceLivenessService.test.mjs` — last-snapshot cache + replay on subscribe
- `backend/tests/unit/suite/3_applications/devices/DeviceLiveness.integration.test.mjs` — end-to-end reason:offline + reason:initial synthesis

### 6.5 Required screen-framework additions

| Addition | Purpose |
|---|---|
| Replace `useScreenCommands` parser with the structured envelope (§6.2). | Uniform command surface. |
| Extend ActionBus with: `media:seek-abs`, `media:seek-rel`, `media:queue-op`, `media:config-set`, `media:adopt-snapshot`. | Route structured commands to handlers. |
| New hook: `useSessionStatePublisher(sessionSource)` — subscribes to local session and publishes on `device-state:<id>` per §6.4. | State publication. |
| New hook: `useCommandAckPublisher()` — publishes acks on `device-ack:<id>` when ActionBus handlers complete. | Per-command acknowledgement. |
| `sessionSource` contract — device's queue controller and player expose a stable read interface the publisher subscribes to. | Decouple publisher from player internals. |

---

## 7. WebSocket — Topics & Envelope

### 7.1 Common envelope

```json
{
  "topic": "<topic-name>",
  "type": "<sub-type, optional>",
  "ts": "<ISO-8601>"
  /* topic-specific payload at the top level */
}
```
Unknown fields MUST be ignored.

### 7.2 Topic summary

| Topic | Direction | Publisher | Payload | Notes |
|---|---|---|---|---|
| `device-state:<deviceId>` | backend → subscribers | device (via relay) | `DeviceStateBroadcast` | Reactive + heartbeat per §6.4. Replay last snapshot to new subscribers. |
| `device-ack:<deviceId>` | backend → subscribers | device (via relay) | `CommandAck` | Ack for every command. |
| `homeline:<deviceId>` | backend → subscribers | backend | `WakeProgressEvent` | Dispatch orchestration steps. |
| `screen:<deviceId>` | backend → device | backend | `CommandEnvelope` (§6.2) | Only targeted device subscribes. |
| `playback_state` | broadcast | controller app | `PlaybackStateBroadcast` | Local (browser) session heartbeat. |
| `client-control:<clientId>` | backend → controller app | external systems | `CommandEnvelope` (§6.2) targeted at `clientId` | Inbound commands targeting this browser's local session (C8.4). |

**Verified by:**
- `shared/contracts/media/topics.test.mjs` — topic constructors + `parseDeviceTopic`
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.routing.test.mjs` — per-device topic routing
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.clientControl.test.mjs` — identity-scoped client-control routing

### 7.3 Subscription lifecycle

- Controller subscribes to `device-state:<id>` and `device-ack:<id>` for
  every device in the fleet config on app mount; to `homeline:<id>` only
  during an active dispatch; and to `client-control:<clientId>` on mount.
- Controller unsubscribes on app unload.
- On reconnect after a drop, the controller MUST re-subscribe. The backend
  replays the last `device-state` snapshot per topic.

### 7.4 Backend liveness synthesis

Backend tracks heartbeats per device. When a device misses heartbeats
>15 seconds, backend emits one synthesized `device-state:<id>` message with
`reason: "offline"` and the last known snapshot. On reconnect, backend
emits `reason: "initial"` with a fresh snapshot.

**Verified by:**
- `backend/tests/unit/suite/3_applications/devices/DeviceLivenessService.test.mjs` — timer-driven offline + re-online synthesis (unit)
- `backend/tests/unit/suite/3_applications/devices/DeviceLiveness.integration.test.mjs` — end-to-end against the real event bus
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.routing.test.mjs` — last-snapshot replay on subscribe

---

## 8. URL Contract

| Parameter | Type | Semantics |
|---|---|---|
| `play` | contentId | On load, replace any current local session with this content and autoplay. |
| `queue` | contentId | On load, resolve via Queue API and append to the local queue. No auto-start. |
| `shuffle` | `1` | Apply shuffle when starting from `play` or `queue`. |
| `shader` | string | Initial shader. |
| `volume` | `0..1` float | Initial volume. |

**Unsupported parameters MUST be ignored, logged, and never forwarded.**
Remote-dispatch parameters (e.g., `device=<id>`) MUST NOT be honored (C8.2).

**Precedence.** If both `play` and `queue` are supplied, `play` wins;
`queue` is appended after the played item.

**Idempotency.** URL-command processing MUST be idempotent across refreshes.
The app persists `media-app.url-command-token` in `localStorage` and dedupes
by it.

---

## 9. Canonical Data Shapes

**Verified by:**
- `shared/contracts/media/shapes.test.mjs` — validators for `PlayableItem` (§9.1), `SessionSnapshot` (§9.2), `QueueSnapshot` (§9.3), `QueueItem` (§9.4)
- `shared/contracts/media/envelopes.test.mjs` — validators for `DeviceStateBroadcast` (§9.7), `CommandAck` (§9.8), `PlaybackStateBroadcast` (§9.10), `CommandEnvelope` (§9.11)
- `shared/contracts/media/commands.test.mjs` — enum membership for session state + repeat mode + command kinds

### 9.1 `PlayableItem`
Shape returned by `GET /api/v1/play/:source/*`. Authoritative definition:
`docs/reference/content/content-playback.md`.

```json
{
  "contentId": "<source>:<localId>",
  "format": "video" | "dash_video" | "audio" | "singalong" | "readalong" | "readable_paged" | "readable_flow" | "app" | "image" | "composite",
  "title": "<string>",
  "duration": <seconds, optional>,
  "thumbnail": "<url, optional>"
  /* format-specific fields */
}
```

### 9.2 `SessionSnapshot`
Central portable type.

```json
{
  "sessionId": "<uuid>",
  "state": "idle" | "ready" | "loading" | "playing" | "paused" | "buffering" | "stalled" | "ended" | "error",
  "currentItem": { /* PlayableItem */ } | null,
  "position": <seconds>,
  "queue": { /* QueueSnapshot */ },
  "config": {
    "shuffle": <bool>,
    "repeat": "off" | "one" | "all",
    "shader": "<string>" | null,
    "volume": <0..100 int>,
    "playbackRate": <float, default 1.0>
  },
  "meta": {
    "updatedAt": "<ISO-8601>",
    "ownerId": "<deviceId>" | "<clientId>"
  }
}
```

### 9.3 `QueueSnapshot`
```json
{
  "items": [ { /* QueueItem */ } ],
  "currentIndex": <int, -1 if none>,
  "upNextCount": <int>
}
```

### 9.4 `QueueItem`
```json
{
  "queueItemId": "<uuid>",
  "contentId": "<contentId>",
  "title": "<string>",
  "thumbnail": "<url, optional>",
  "format": "<format>",
  "duration": <seconds, optional>,
  "addedAt": "<ISO-8601>",
  "priority": "upNext" | "queue"
}
```

### 9.5 `DeviceConfig`
```json
{
  "id": "<deviceId>",
  "name": "<string>",
  "location": "<string>",
  "capabilities": {
    "wake": <bool>,
    "volume": <bool>,
    "shader": <bool>,
    "compositeVisual": <bool>
  },
  "defaultVolume": <0..100 int>,
  "screens": ["<screenId>", ...]
}
```

### 9.6 `SearchResult`
```json
{
  "contentId": "<source>:<localId>",
  "title": "<string>",
  "source": "<adapterName>",
  "mediaType": "video" | "audio" | "image",
  "capabilities": ["playable", "displayable", ...],
  "thumbnail": "<url, optional>",
  "duration": <seconds, optional>,
  "meta": { /* adapter-specific */ }
}
```

### 9.7 `DeviceStateBroadcast`
```json
{
  "topic": "device-state",
  "deviceId": "<id>",
  "reason": "change" | "heartbeat" | "initial" | "offline",
  "snapshot": { /* SessionSnapshot */ },
  "ts": "<ISO-8601>"
}
```

### 9.8 `CommandAck`
```json
{
  "topic": "device-ack",
  "deviceId": "<id>",
  "commandId": "<uuid>",
  "ok": <bool>,
  "error": "<string, optional>",
  "code": "<string, optional>",
  "appliedAt": "<ISO-8601>"
}
```

### 9.9 `WakeProgressEvent`
```json
{
  "topic": "homeline:<deviceId>",
  "type": "wake-progress",
  "dispatchId": "<uuid>",
  "step": "power" | "verify" | "volume" | "prepare" | "prewarm" | "load",
  "status": "running" | "success" | "failed",
  "error": "<string, optional>",
  "elapsedMs": <int>,
  "ts": "<ISO-8601>"
}
```

### 9.10 `PlaybackStateBroadcast`
```json
{
  "topic": "playback_state",
  "clientId": "<uuid>",
  "sessionId": "<uuid>",
  "displayName": "<string>",
  "state": "playing" | "paused" | "buffering" | "stalled" | "stopped" | "idle",
  "currentItem": { /* PlayableItem, or null */ },
  "position": <seconds>,
  "duration": <seconds>,
  "config": { /* SessionSnapshot.config */ },
  "ts": "<ISO-8601>"
}
```

Published per §6.4 rates. Terminal `state: "stopped"` on session unload.

### 9.11 `CommandEnvelope`
See §6.2. Used on `screen:<deviceId>` (to devices) and on
`client-control:<clientId>` (to this browser's own session).

### 9.12 `ListResponse`
```json
{
  "path": "/<list-path>",
  "modifiers": { "playable": <bool>, "shuffle": <bool>, "recent_on_top": <bool> },
  "total": <int>,
  "take": <int>, "skip": <int>,
  "items": [ /* ListItem or PlayableItem */ ]
}
```

### 9.13 `ContentInfo`
Not a strict shape — adapter-specific. Minimum:
```json
{
  "contentId": "<contentId>",
  "title": "<string>",
  "thumbnail": "<url, optional>"
  /* adapter-specific */
}
```

---

## 10. Log Event Taxonomy

All diagnostic output via `frontend/src/lib/logging/`. Event names use
dot-delimited namespaces. Every event SHOULD include `clientId`,
`sessionId`, and (when relevant) `deviceId` / `dispatchId` / `commandId`.

> Backend-side events are not asserted by tests (they are a convention).
> The backing services that emit them are covered by the tests linked
> under the corresponding §4/§6/§7 subsections — notably
> `SessionControlService.test.mjs` (peek.command-ack equivalents),
> `DeviceLivenessService.test.mjs` (ws.stale equivalents), and
> `WakeAndLoadService.test.mjs` (dispatch.step / dispatch.succeeded).

### 10.1 Required events

| Event | Level | Emitted when | Key fields |
|---|---|---|---|
| `media-app.mounted` | info | App mounts. | `clientId`, `displayName`, `viewport{width,height}`, `orientation`, `devicePixelRatio` |
| `media-app.unmounted` | info | App unmounts. | — |
| `session.created` | info | New local session started. | `sessionId`, `contentId` |
| `session.reset` | info | User explicitly reset session. | — |
| `session.resumed` | info | Session restored from localStorage. | `sessionId`, `resumedPosition` |
| `session.state-change` | debug | Session state transition. | `from`, `to` |
| `session.persisted` | debug | State flushed. | `size` |
| `queue.mutated` | debug | Queue modified. | `op`, `queueItemId?`, `contentId?`, `queueSize` |
| `player.host-changed` | info | Active player host claim changed (park ↔ dock ↔ Now Playing). | `reason`, `claimant`, `from`, `to`, `parked`, `claimCount` |
| `playback.started` | info | First progress after load. | `contentId`, `format`, `ttfpMs` |
| `playback.stalled` | warn | Stall detected. | `contentId`, `stalledAt`, `stallDurationMs` |
| `playback.error` | error | Load/play error. | `contentId`, `error`, `code` |
| `playback.advanced` | info | Auto-advance fired. | `reason`, `fromContentId`, `toContentId` |
| `search.issued` | debug | Search query sent. | `text`, `scopeKey` |
| `search.result-chunk` | debug | One SSE results event. | `source`, `itemCount` |
| `search.completed` | info | Search stream ended. | `totalMs`, `resultCount` |
| `dispatch.initiated` | info | Dispatch started. | `dispatchId`, `deviceId`, `contentId`, `mode` |
| `dispatch.step` | debug | Wake-progress event. | `dispatchId`, `step`, `status`, `elapsedMs` |
| `dispatch.succeeded` | info | Dispatch succeeded. | `dispatchId`, `totalElapsedMs` |
| `dispatch.failed` | warn | Dispatch failed. | `dispatchId`, `failedStep`, `error` |
| `peek.entered` / `peek.exited` | info | Peek lifecycle. | `deviceId` |
| `peek.command` | debug | Command issued in peek. | `deviceId`, `command`, `commandId` |
| `peek.command-ack` | debug | Ack received. | `deviceId`, `commandId`, `ok`, `error?` |
| `takeover.initiated` | info | Take Over started. | `deviceId`, `sessionId` |
| `takeover.succeeded` | info | Take Over completed. | `deviceId`, `sessionId`, `position` |
| `takeover.failed` | warn | Take Over failed. | `deviceId`, `error` |
| `handoff.initiated` | info | Hand Off started. | `deviceId`, `mode` |
| `handoff.succeeded` | info | Hand Off completed. | `deviceId`, `mode` |
| `handoff.failed` | warn | Hand Off failed. | `deviceId`, `error` |
| `ws.connected` / `ws.disconnected` / `ws.reconnected` | info | WS lifecycle. | `attempt?` |
| `ws.stale` | warn | No heartbeat >15s. | `topic`, `deviceId` |
| `external-control.received` | info | Inbound command. | `commandId`, `command` |
| `external-control.rejected` | warn | Rejected command. | `commandId`, `reason` |
| `url-command.processed` | info | URL param triggered action. | `param`, `value` |
| `url-command.ignored` | debug | Duplicate or unsupported URL param. | `param` |

### 10.2 Sampling

High-frequency events MUST use
`logger.sampled(event, data, { maxPerMinute: 20, aggregate: true })`.

### 10.3 Correlation

All events emitted during a single local session MUST carry that session's
`sessionId`. External consumers correlate by `clientId` + `sessionId`.

### 10.4 Durability

Every event in §10.1 MUST carry `context.app` **and** `context.sessionLog`.
The backend session-file transport gates on exactly those two fields
(`0_system/logging/transports/sessionFile.mjs`); an event missing either is
written to stdout only, which means `docker logs` — a ring buffer that is
discarded when the container is recreated. `mediaLog.js` sets both once on its
base child logger, so every helper in that module inherits them.

This is not theoretical. On 2026-08-16 the durable record of a real incident
(`media/logs/media/2026-08-16T19-13-26.jsonl`) held 13 events — 8
`search.dispatch`, 2 `editing.start`, `item_select`, 2 `browse_container.*` —
all of them from `ContentCombobox`, the one component that set `sessionLog`
itself. Every playback, stall, host-transition and error event was absent, and
the diagnosis was possible only because the container happened not to have been
recreated. Treat "is this event durable?" as part of adding an event, not as an
operational afterthought.

Two related traps, both fixed and both worth not re-introducing:

- The logger's own console output (`[Logger] …`) must not be re-ingested by
  `consoleInterceptor` — see `lib/logging/consoleEmitGuard.js`. Without the
  guard every `warn` and `error` reached the backend twice.
- Backend events are stamped in local time (ISO with no trailing `Z`) while
  frontend events are UTC with `Z`. They interleave in one stdout stream, so
  read timestamps with the offset in mind.

---

## 11. localStorage Persistence Schema

### 11.1 Keys

| Key | Purpose | Shape |
|---|---|---|
| `media-app.client-id` | Stable per-browser identity. | UUID v4 string. |
| `media-app.display-name` | Human-readable client label. | string. |
| `media-app.session` | Persisted local session. | `PersistedSession` — §11.2 |
| `media-app.url-command-token` | Dedup token for URL-command processing. | string. |
| `media-scope-recents` | Last 5 scope keys that produced results. | `string[]`. |
| `media-scope-favorites` | Starred scope keys. | `string[]`. |

### 11.2 `PersistedSession` shape

```json
{
  "schemaVersion": 1,
  "sessionId": "<uuid>",
  "updatedAt": "<ISO-8601>",
  "wasPlayingOnUnload": <bool>,
  "snapshot": { /* SessionSnapshot */ }
}
```

### 11.3 Read/write rules

- **Write cadence:** on every state transition and every 5s while playing
  (C2.2). Writes throttled to ≤ 1 per 500ms.
- **Atomicity:** single `JSON.stringify` → single `setItem`. No partial state.
- **Size bound:** persisted session MUST fit in 1 MB. If queue grows larger,
  truncate past-played items first.
- **Versioning:** on load, mismatched `schemaVersion` → discard and start fresh
  (log `session.reset` with `reason: "schema-mismatch"`).
- **Reset:** C2.3 reset removes `media-app.session` and
  `media-app.url-command-token`. Other keys preserved.
- **Quota errors:** on `QuotaExceededError`, retry once after clearing
  past-played items. On second failure, surface warning and fall back to
  in-memory-only state.

---

## 12. Error Envelopes

### 12.1 HTTP error body

All 4xx/5xx JSON responses from the APIs defined in §2 and §4 MUST use:

```json
{
  "ok": false,
  "error": "<human-readable message>",
  "code": "<machine-readable code, optional>",
  "details": [ /* optional field-level errors */ ],
  "retryable": <bool, optional>
}
```

### 12.2 Known error codes

| Code | HTTP | Meaning |
|---|---|---|
| `CONTENT_NOT_FOUND` | 404 | Content ID does not resolve. |
| `SEARCH_TEXT_TOO_SHORT` | 400 | Search query < 2 chars. |
| `DEVICE_NOT_FOUND` | 404 | Unknown device ID. |
| `DEVICE_OFFLINE` | 503 / 409 | Device unreachable; last-known snapshot included. |
| `DEVICE_REFUSED` | 502 | Device reached, command rejected/errored. |
| `DEVICE_BUSY` | 409 | Device in a state that cannot accept the command. |
| `WAKE_FAILED` | 502 | Dispatch failed at a step; `failedStep` identifies which. |
| `ATOMICITY_VIOLATION` | 502 | `claim` or atomic op failed to restore state. |
| `IDEMPOTENCY_CONFLICT` | 409 | Repeated command ID with different payload. |

**Verified by:**
- `shared/contracts/media/errors.test.mjs` — `ERROR_CODES` frozen + `buildErrorBody` shape
- `backend/tests/unit/suite/4_api/v1/routers/device.session-transport.test.mjs` — DEVICE_OFFLINE (409), DEVICE_REFUSED (502) mapping
- `backend/tests/unit/suite/4_api/v1/routers/device.load-adopt.test.mjs` — IDEMPOTENCY_CONFLICT (409) mapping

### 12.3 App behavior

- Errors with `retryable: true` SHOULD surface a retry affordance.
- `ATOMICITY_VIOLATION` is a hard error — app MUST NOT retry without
  explicit user action.
- `DEVICE_OFFLINE` MUST NOT be surfaced as an app-breaking error — the
  device is marked offline and observation continues (C9.6).
