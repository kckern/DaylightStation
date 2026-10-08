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
| `complete` | `{ totalMs, warnings? }` | Final event. |
| `error` | `{ message }` | Fatal stream error. |

An id typed for a source that does not exist (`plex-main:12345`: a `source:id`
whose id part is digits or a path, and whose source is no registered source,
alias or provider) settles at once instead of searching every adapter for the
literal text: `pending` with no sources, then `complete` with a warning
`{ source: "plex-main", code: "UNKNOWN_SOURCE", error: "No source named …" }`
(`GET …/search` answers the same warning with no items). Text such as
`mission:impossible` still searches everywhere.

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

**Response:** `{ "items": [HouseholdEntry], "degraded": false }` — `degraded: true` when a
catalog lookup ran out of time or failed, so some display fields are missing (not "not found");
a client may ask again shortly.

#### `GET /household/carry-on?limit=20`

```json
{ "items": [HouseholdEntry & { "reason": "unfinished" | "next-episode" }],
  "nowOn": [HouseholdEntry & { "deviceId", "screenId", "state", "position" }],
  "nowPlayingKnown": true, "degraded": false }
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
`DELETE`. A removal, a restore and a watched mark notify `onListChanged` listeners; the
suggestions service drops its cache for that household (all households for a mark), so the
change shows on every screen at once.

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
takes the optional `?household=<id>` (**404** `HOUSEHOLD_NOT_FOUND` when it
names no household) and answers **501** when its service is not wired.

**Screen ids** are stable; routines and the ledger use them, never names.

| Id | Screen | Source of name/room |
|---|---|---|
| `fleet:<devices.yml key>` | a configured TV, kiosk, tablet or speaker — devices with `content_control`, a `fleet` lane, a `plex` client or a playback type | `devices.yml` `name` / `location` (read-only); an app rename or room change is an **override stored in the registry**, never a `devices.yml` write |
| `browser:<clientId>` | a browser running the app | registered the first time it announces itself (or publishes `playback_state`); the registry name is then authoritative |
| `screen:<slug>` | a screen added by hand | the registry |

Bare devices.yml keys are accepted wherever a screen id is (`livingroom-tv`
→ `fleet:livingroom-tv`).

**Stored** at `household[-{id}]/media/screens.yml` (`{ screens: {<id>: …},
aliases: {<duplicate id>: {into, mergedAt}}, adjacency?: {<room>: [<neighbouring rooms>]} }`;
`adjacency` is optional and read symmetrically, rooms matched case-insensitively), written only through the app.
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
| `GET /screens` | — | `{ screens: [Screen], notSeenLately: [Screen], retired: [Screen], unnamed: [Screen], roomAdjacency }` — by name; `unnamed` = placeholder-named browsers that never played (opened the app only), kept out of `screens`; each Screen has `aliasNames` (`{alias: name it had}`) and `lastPlayed`; `notSeenLately` = silent > **30 days** *(default)* and not online |
| `POST /screens` | `{ name, room? }` | **201** `{ screen }` (`screen:<slug>`) |
| `POST /screens/announce` | `{ id?, name?, room?, playing?, previousId? }` — `id` defaults to `X-Daylight-Device`. A browser nobody named that has not played is **not registered** (`screen: null`); a made-up "Browser 1a2b3c4d" name is ignored. `playing: true` registers it (the playback relay sets it). `previousId` (the browser's old header token) is folded into `id` like a confirmed merge, spots included; a repeat is a no-op, and an id another *named* screen holds is never folded | `{ screen }` |
| `GET /screens/rooms/adjacency` | — | `{ roomAdjacency: { "<room>": ["<neighbouring room>", …] } }` |
| `PUT /screens/rooms/adjacency` | `{ room, neighbours: [room] }` — replaces that room's neighbours (`[]` clears them); the link is mutual. **400** `INVALID_ROOM` | `{ roomAdjacency }` |
| `GET /screens/:id` | — | `{ screen, routines }` (**404** unknown) |
| `PATCH /screens/:id` | `{ name?, room?, onCollision?: "reject"\|"suffix", confirm? }` (`room: null` clears an override) | `{ screen, routines }` |
| `POST /screens/:id/merge` | `{ into, confirm }` — without `confirm: true`, **409** `CONFIRM_REQUIRED` with `routines` targeting either screen | `{ screen, movedSpots }` |
| `POST /screens/:id/unmerge` | — (`:id` = the merged duplicate) | `{ screen, restoredSpots }` (**404** `NOT_MERGED`) |
| `POST /screens/:id/retire` | `{ confirm? }` | `{ screen, routines }` |
| `POST /screens/:id/restore` | — | `{ screen }` (**409** if its name was taken meanwhile) |
| `GET /screens/:id/routines` | — | `{ items: [{ id, name, kind, source }] }` |

**Merge** (confirmed) folds a duplicate into its earlier self: the
duplicate's id becomes an alias (plays, started-by, time-of-day and history
follow it; chains are flattened, each re-pointed duplicate remembering the
hop in `via`), the earliest `firstSeen` and latest `lastSeen` are kept, and
the folded entry is kept on the alias (`aliases[id].was`). Its per-screen
spots are folded by `mediaSpots.foldSpot` through the progress store's
`updateSpots` (read, change, write with no await between, so a concurrent
`play/log` write is never lost): the newest spot takes the target's key and
the other stays under the alias — nothing is dropped; `lastDevice` follows.
The folds are recorded on the alias. **Unmerge** restores the duplicate as its
own screen (its old name, suffixed if another screen took it meanwhile),
points duplicates that came along through it back at it, and folds its spots
back (`unfoldSpot`) unless the target has played on them since. A configured
screen cannot be merged away — merge the duplicate into it. **Retire** removes a screen from the list and frees its
name. Errors: **400** `INVALID_NAME` / `INVALID_SCREEN_ID` / `INVALID_MERGE`,
**404** `SCREEN_NOT_FOUND`, **409** `NAME_TAKEN` / `ROUTINES_TARGET` /
`CONFIRM_REQUIRED` / `SCREEN_MERGED`, **404** `NOT_MERGED`.

Log events: `media.screens.registered|renamed|room_set|added|merged|unmerged|retired|restored`
(info); `media.screens.spot_move_failed`, `.spot_restore_failed`, `.signals_failed`,
`.configured_read_failed` (warn); `eventbus.screen_presence.failed` (warn).

**Client.** `frontend/src/modules/Media/house/houseApi.js` calls every route
above (the whole 409 body — `heldBy`, `suggestion`, `routines` — stays on the
error; `DaylightAPI` truncates bodies). `house/useScreenRegistry.js` holds the
list (read on mount, on tab focus, every 2 min, after every change made here,
and when a browser's live heartbeat name differs from it) inside
`FleetProvider`, whose rows take the registry `name`, `room` and `wasName`.
`ClientIdentityProvider` announces `browser:<clientId>` on start and adopts the
answer; `adoptBrowserDeviceId` (`lib/deviceIdentity.js`) makes that same id the
`X-Daylight-Device` header of every request, so the server's announce default,
load origin and suggestions all name the screen the registry knows. Renames
send `PATCH` and hand `NAME_TAKEN` / `ROUTINES_TARGET` back to the dialog
(resend with the suggestion, or `confirm: true`). Screen admin
(`house/useScreenAdmin.js`) sends merges with `confirm: true` only after the
dialog showed the routines of both screens (`GET /screens/:id/routines`),
and retires likewise. Client events: `house.registry-loaded|failed`,
`house.screen-announced`, `house.announce-failed`, `house.screen-renamed`,
`house.rename-conflict`, `house.room-set`, `house.room-neighbours-set`, `house.screen-added|merged|unmerged|retired|restored`,
`house.admin-action-failed`, `house.first-use-shown|named|skipped`.

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
`load?{{ query | default(...) }}`, and automation/script `variables:`), to
the target screen (`fleet:<id>`) and query. Include directories are read
recursively, as HA's `include_dir_*` do. Sources, merged:

| Source | When |
|---|---|
| `live` | the HA config read in place (`rest_commands/` merged, `scripts/` named by file, `automations/` one per file) from system config `media-routines.yml` → `homeAssistant.configDir` (the HA `_includes` dir), cached 60 s. Unreadable → unavailable. |
| `snapshot` | the last catalog imported via `PUT /routines/catalog`, stored at `household[-{id}]/media/routines.yml`; used when no live source is available (the container does not mount the HA config). Push it with `node cli/media-routines.cli.mjs push --dir <HA _includes> --url <app>` — the CLI extracts the routines locally and sends only `{routines}`, never the HA config. |
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
   the **last catalog read** (`peekMatch`: a cache hit only — nothing is read
   before the TV is woken; a missing or stale catalog is refreshed in the
   background, and it is warmed at startup), else `"Home Assistant"`.
3. `X-Daylight-Device` (`fleet:`/`browser:`, not the target itself) → a person
   sending from that screen (`{kind: "device", id}`).

A routine origin is handed to wake-and-load as `options.origin`
(`{kind: "routine", name, id?, triggerId}`), so the screen's command envelope
and session `meta.origin` name the routine rather than a generic one; a device
origin the router already resolved from the request header is honoured as
the asking device. The origin is noted for the target's next ledger start
(3 min; cleared when the load fails). A routine's load runs through the routine dedupe (same routine +
query to the same screen within **10 s** starts once; the repeat reports
`deduplicated: true`) and its outcome is appended to
`household[-{id}]/history/media-routines.yml` (30 days, 500 runs) **after the
load has answered** — Home Assistant never waits on the registry lookup or the
YAML write. A run only invalidates the catalog when its routine is not
already listed. The load itself is never changed or failed by this.

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
| `PUT /routines/catalog` | `{ routines: [Routine], source? }` — ≤ 500 routines; `id` ≤ 128 and `name` ≤ 120 chars (strings, required); 1–20 `targets`, each a screen-id `deviceId` and a string `query` ≤ 1000; `via` ≤ 10 strings | `{ count, importedAt }`; anything malformed is **400** `INVALID_ROUTINES` with `errors`, nothing stored |
| `GET /routines/history` | `?limit=50 (≤500)&deviceId=&routineId=` | `{ items: [RoutineRun] }` newest first; `deviceId` includes merged duplicates |
| `GET /routines/flags` | — | `{ items: [RoutineFlag] }` |

Log events: `media.routines.load`, `media.routines.run` (info; warn when
failed), `media.routines.snapshot_imported` (info);
`media.routines.history_write_failed`, `.history_record_failed`,
`.live_read_failed`, `.refresh_failed`, `.snapshot_read_failed`,
`.ha_file_unreadable` (file, error name, line — never the parser message,
which quotes config), `.match_failed` (warn).

**Client.** `house/RoutineHistoryView.jsx` (view `routines`) reads
`/routines/history?limit=50` and `/routines/flags` together; `houseCopy.routineRunLine`
words each run (`started` + `played` → "Played"; `started` with no `played`
after 5 min → "Started, not seen playing"; `failed` → "Failed: <reason>";
`deduplicated` → "Repeat ignored"). Flags with `severity: warn` lead as
"Needs attention". Events `house.routines-loaded|failed`, `house.view-opened`.

### 2.7 Started by

**Exists.** How a screen's playback started — by which device or routine, and
when (RQ-HOUSE-07, HOUSE.5a). Service: `ScreenPlaybackService.startedBy`.

Order: the screen's live session snapshot `meta.origin` (fleet
`device-state`), else the ledger: the screen's starts (merged duplicates
included) in the last 24 h are walked back through the **current run** —
starts no more than 30 min apart — to the first carrying an origin, so every
item of a queue a routine started reads "Started by Kitchen button, 7:02".
A device origin is named from the registry.
A **browser tab** has no device snapshot and its ledger rows only appear after
10 s of play (and only where play/log is wired), so its own `playback_state`
frames (which carry `currentItem` and `origin`) are tracked
(`BrowserPlaybackTracker`, fed by `EventBusBrowserPlayback`, 2 min freshness):
when the tab's current item is the one playing, its `origin` answers as
`source: "snapshot"`, and `GET /started-by` lists the tabs playing now.

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

**Client.** The house view reads `GET /started-by` when it opens, whenever what
plays on any row changes, and every 60 s, and shows
`houseCopy.startedByText` — "Started by <name>, <h:mm>" (weekday added when not
today) — on rows that are active. `StartedByLine` with only a `deviceId`
reads `GET /screens/:id/started-by` itself (re-read when the item changes); it
is mounted in the screen's controls header (`shell/PeekPanel.jsx`, under the
status line) while an item plays. Events `house.started-by-loaded|failed`.

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

`GET /suggestions?deviceId=` (`deviceId` defaults to `X-Daylight-Device`;
anything but a screen id `^(fleet|browser|screen):[A-Za-z0-9._-]{1,96}$` is
**400** `INVALID_SCREEN_ID`) →

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
**5 min** — but only **10 s** when the build's carry on was `degraded`, and the response then says
`degraded: true` — and is dropped on any household-list change (§2.4); favourites, now-playing and
removals are applied on every request.
A failing section is logged and left empty. The household-wide parts (carry
on, New, the ledger scan) are cached once per household; only "Usually here
at this time" is cached per screen, in a map capped at 200 screens.

Log events: `media.suggestions.built` (info: household build, counts, ms);
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

### 2.10 Client use — start page, item verbs, Played earlier

How the Media frontend consumes §2.4–2.9 (`frontend/src/modules/Media/household/`):

- **Reads** go through `useApiResource` with `swr: true`: `suggestions?deviceId=<getDeviceId()>`
  (read on every render, since the app may adopt its browser id after first paint),
  `household/carry-on?limit=12` (12, not 20: each entry costs a catalog lookup on a cold start),
  `household/recent?limit=24`, `household/favourites`, `screens`,
  `screens/<id>/played-earlier?limit=20` (Show more raises `limit` by 20, ≤ 200; refreshed when
  that screen moves on to another item, at most once a minute). A local queue panel asks for this
  device's id; a remote one for its bare devices.yml key. The client applies no removed-filtering
  of its own. When any of suggestions / carry on / recent answers `degraded: true`, the start page
  reloads those once, ~10 s later.
- **Writes** (`POST`/`DELETE household/favourites`, `POST household/removed`, `POST
  household/watched`) each record one local outcome (`kind`: `favourite` | `unfavourite` | `hide`
  | `watched` | `unwatched`), then invalidate every `media/household/*`, `media/suggestions*` and
  `*/played-earlier` resource. A removal's outcome carries Undo for 10 s; Undo is `DELETE
  household/removed?id=`.
- **Screen names** come from `GET /screens` (id, bare `screenId`, and every alias); this device
  reads "this device", an unregistered browser "another browser".
- **Spots** (`householdModel.resumePlan`): open spots with playheads ≥ 30 s apart are different;
  two or more → the person chooses; one (or an unfinished entry with only a shared playhead) →
  continue from that spot. Either way the play carries `seconds: <spot>` + `resume: false` (§9.4) —
  never the server's resume, which is the record's single last-written playhead and may be another
  screen's — and marks the outcome `startOver: true, resumedFrom`; none → plain play. The outcome
  claims "Continuing from …" and offers Start over only when every target applies a start position
  (this device, a `browser:` screen, or a `websocket` content-control screen); other screens load by
  URL and ignore `seconds`. A spot with no screen (`deviceId: null` or `legacy`, written before
  per-screen spots) reads "12 m, saved earlier". Outcome records with `startOver`
  offer **Start over** for 15 s after confirmation: on this device it replays the item as Play now
  with `seconds: 0, resume: false` (a seek would be lost while the item is still loading — the
  Player applies its pending start offset when the media arrives) and records a `startOver`
  outcome; on another screen it calls that screen's `transport.restartCurrent()` and records a
  `startOver` confirmation naming that screen. Household writes and Move here keep their running
  row until they resolve (a failure is never dropped unseen).
- **Now on** cards offer Remote and Move here only when the fleet store holds that screen's live
  session with `meta.playbackOwner` (keyed by its fleet/peek id); otherwise "Now on <screen>" with
  the ⋯ verbs only. Browsers are keyed in fleet by `browser:<clientId>` while their requests (and
  so `nowOn`) carried the separate `ds_device_id` token until the app adopts its clientId as the
  request id; such a card shows no steering verbs rather than ones that cannot work.
- **Move here** (one at a time per screen) adopts the fleet `device-state` snapshot of that screen through
  `lifecycle.adoptSnapshot`, waits up to 20 s for native playing evidence of the same content
  (`portability.getNativeObservation`), then stops the screen through its remote controller only
  if `meta.playbackOwner` (owner + revision) is unchanged (`movePlayback.executeMove`).
- **Progress**: every `play/log` carries `X-Daylight-Device`. When the session's `meta.origin` for
  the current item is a routine or another device, PlayerBridge puts it on the Player's play prop
  and `play/log` sends it as `origin` (`session/playOrigin.js`); this device's own default origin is
  never sent.

Log events (frontend, `mediaLog`): `home.shown`, `household.load-failed`,
`household.favourite-toggled`, `household.removed`, `household.restored`,
`household.watched-marked`, `household.action-failed`, `play.spot-choice-shown`,
`play.spot-chosen`, `outcome.start-over`, `outcome.start-over-failed`, `move-here.initiated`,
`move-here.succeeded`, `move-here.failed`, `played-earlier.shown`.

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
{ "action": "play" | "pause" | "stop" | "seekAbs" | "seekRel" | "skipNext" | "skipPrev" | "goLive",
  "value": <number, optional>,
  "commandId": "<uuid>" }
```

`goLive` (STEER.4a/AC3) takes no `value`: the screen moves its media element to
its live edge (the furthest of the end of the last seekable range, the last
buffered range and a finite duration) and plays. A playback with no edge
answers `command-handler-error` `NO_LIVE_EDGE`.

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

**No deferred retry for Media presses (RQ-STEER-07).** The GET form accepts
`deferredRetry=0`. `DeviceContentDispatchService` strips it from the receiver
query and passes `deferredRetry: false` to `WakeAndLoadService`, so a press that
fails (for example "Display did not turn on") is never replayed by the backend
45 s later. The Media app always sends it; routines that omit it keep the
one-shot deferred retry. Retry is only ever the person's explicit Retry.

**No receiver, no "sent".** `WebSocketContentAdapter.load` refuses to broadcast
to a screen topic with zero subscribed clients (`getTopicSubscriberCount`), and
returns `{ ok: false, error: "Screen not connected (no receiver subscribed)" }`
instead of reporting a vanished message as delivered. Wildcard (`*`) subscribers
count as subscribers, so a sender that monitors every topic still keeps this
path "sent"; the receiver-outcome watchdog then decides (§9.14).
`WakeAndLoadService` does not turn that adapter error into a WebSocket-fallback
broadcast either: it returns `{ ok: false, failedStep: 'load', error: 'Screen
not connected' }` (a terminal "Not sent" in Media). A zero subscriber count
alone still takes the fallback, because a cold FKB screen has no subscriber
until the page the fallback loads subscribes; but if that base-page load also
fails and the count is still zero, the load fails the same way instead of
broadcasting to no one.

**Prewarm is bounded.** For `queue=` and `play=` dispatches,
`WakeAndLoadService` asks `TranscodePrewarmService` to resolve the ref through
the same queue resolution the screen uses (`GET /api/v1/queue/<ref>`) and to
warm the first item's transcode. This is best-effort and runs through Plex,
which serializes requests, so it is bounded by an injected deadline
(`prewarmDeadlineMs`, default 10 s, applied via the application scheduler's
`withDeadline`). Past the deadline the dispatch loads **unprewarmed**:
`wake-and-load.prewarm.timeout` (warn, with `deadlineMs`), `steps.prewarm =
{ ok: false, reason: 'timeout' }`, and a `prewarm` `done` progress event with
`warning: 'timeout'`. The prewarm result is applied only when it arrives in
time; a late result or rejection is logged as `wake-and-load.prewarm.late` and
never touches the query already sent to the screen. A permanent prewarm failure
(unresolvable content) still fails the dispatch at `prewarm`.

**Receiver-outcome watchdog.** After a successful non-adopt load, the service
watches `device-state:<deviceId>` for 90 s. Nothing counts until the receiver
acknowledged this `dispatchId` (`device-ack`), and the snapshot must carry an
owner (`sessionId`, `ownerId`, `playbackOwner` with integer revisions). Add
(requested, or `appliedAs: 'add'` under Add only) confirms the `queue` step from
a same-owner queue revision with the current item unchanged. Play confirms the
`playback` step from a `playing` state whose owner advanced past the pre-load
snapshot (new session, new owner instance, or higher `playbackRevision`), on
one **basis**, logged on `wake-and-load.playback.armed`, `.confirmed`
(with `matchedBy`) and `.timeout` (`.armed`/`.timeout` also carry `requestedContentId`, the original ref such as `office-program`, beside the resolved `expectedContentId`):

| Basis | When | Confirms on |
|---|---|---|
| `item-action` | The command carries an item action | The queue's current entry carries that `operationId` |
| `resolved-queue` | Prewarm resolved concrete queue ids (`queueContentIds`, plus the prewarmed first id) in time | Current item is a resolved id (`candidate`), or the screen's queue shares items with the resolution and holds the current item (`queue-overlap` — program slots such as `strategy: rotation` are random per resolution) |
| `fresh-owned-playing` | Nothing concrete resolved in time for a `queue=` or `play-next=` ref, or the prewarm deadline expired | The first fresh owned `playing` state after the ack whose current item (or session) differs from the pre-load snapshot — a bare Play/pause revision bump on the baseline item does not count. Applies to `queue=`, `play-next=` and timed-out prewarms; a concrete requested/resolved id still matches first |
| `requested-id` | Otherwise | Current item matches the requested id |

The program id itself (e.g. `queue=office-program`) is never reported by a
screen, which reports the concrete item it plays. Arming on the program id
alone made every program dispatch time out. A screen that never reaches
`playing` (for example, its own queue fetch timed out) still ends in
`playback: timeout`.

**Verified by:**
- `tests/isolated/application/devices/WakeAndLoadService.program-dispatch.test.mjs` — prewarm deadline (default and injected), late result/rejection isolation, program confirmation by resolved candidate / queue overlap / fresh-owned-playing fallback, ack still required, unresolved program that never plays still times out
- `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs`, `…playback-watchdog.test.mjs`, `…addOnly.test.mjs` — owner/ack correlation, Add, item actions
- `backend/tests/unit/suite/4_api/v1/routers/device.load-adopt.test.mjs` — adopt body validation + idempotency-conflict mapping
- `backend/tests/unit/suite/3_applications/devices/DispatchIdempotencyService.test.mjs` — 60s TTL cache semantics
- `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs` — adoptSnapshot wake path

### 4.8 Multi-target dispatch

**Decision: Option A — client-side fan-out.** No new API. App issues N
parallel `POST /api/v1/device/:id/load` calls with independent `dispatchId`s.
Failure isolation is per-device.

### 4.9 Screen session controls (P1)

Each route sends one envelope to the screen and maps its ack exactly like
§4.3 (200 / 400 / 404 / 409 / 502 with the screen's `code`). Every body takes
`commandId` (required) and `origin` (optional, §6.2.7). The screen publishes
the resulting state in `snapshot.controls` (§9.14).

| Route | Body | Envelope |
|---|---|---|
| `PUT /api/v1/device/:id/session/add-only` | `{ enabled: bool }` | `config` `{ setting: "addOnly", value }` |
| `PUT /api/v1/device/:id/session/end-of-queue` | `{ mode: "stop" \| "repeat" \| "similar" }` | `config` `{ setting: "endOfQueue", value }` |
| `PUT /api/v1/device/:id/session/stop-after-current` | `{ enabled: bool }` | `config` `{ setting: "stopAfterCurrent", value }` |
| `POST /api/v1/device/:id/session/sleep-timer` | `{ minutes: 0 < n <= 720 }` **or** `{ atEnd: "item" }` | `session` `{ action: "sleep-timer", … }` |
| `POST /api/v1/device/:id/session/sleep-timer/cancel` | `{}` | `session` `{ action: "cancel-sleep-timer" }` |
| `POST /api/v1/device/:id/session/sleep-timer/resume` | `{}` | `session` `{ action: "resume-sleep" }` — continue from where the timer was set |
| `POST /api/v1/device/:id/session/put-back` | `{ noteId? }` | `session` `{ action: "put-back" }` |
| `POST /api/v1/device/:id/session/countdown/cancel` | `{}` | `session` `{ action: "cancel-countdown" }` |
| `POST /api/v1/device/:id/session/countdown/start-now` | `{}` | `session` `{ action: "start-next-now" }` |

Screen refusals (502): `PUT_BACK_UNAVAILABLE` (no restore snapshot, older than
10 s, or a newer playback owns the screen), `SLEEP_RESUME_UNAVAILABLE`,
`NO_COUNTDOWN`, `INVALID_SESSION_COMMAND`.

The remote controller exposes these as `controller.sessionControls.{setSleepTimer,
cancelSleepTimer, resumeSleep, putBack, cancelCountdown, startNextNow,
setAddOnly, setEndOfQueue, setStopAfterCurrent}` and sends its optional
`origin` on every command (`peek/RemoteSessionController.js`).

**Origin on every session route.** `transport`, `queue/:op`, the config PUTs,
`claim` and the routes above accept `origin`. A fleet device naming itself in
the `X-Daylight-Device` header (`fleet:<id>`) IS the origin — a body cannot
claim another device, only supply its display `name`. Otherwise an explicit
body origin is used, else any header device. A malformed origin (or a `name`
over 80 characters) is a 400. `claim`'s stop is sent with `intent: "move"`
(§6.2.1).

**Load dispatches.** `GET /device/:id/load` attributes the dispatch to the
header device. WakeAndLoad stamps every screen envelope with that origin, or
with `{ kind: "routine", name: "Automation" }` when no caller was named (Home
Assistant buttons, schedules, triggers, barcode fallbacks) — which Add only
never rewrites.

**Verified by:**
- `backend/src/4_api/v1/routers/device.session-controls.test.mjs` — every route, validation, origin passthrough/fallback, refusal mapping
- `backend/src/3_applications/devices/services/SessionControlService.session-controls.test.mjs` — envelopes, origin, claim intent, appliedAs passthrough
- `frontend/src/modules/Media/peek/RemoteSessionController.sessionControls.test.js` — remote methods + origin

### 4.10 `GET /api/v1/device/:id/start-status`

Start progress or last failure for one screen, readable by every device
(RQ-HOUSE-04). Response: `{ ok: true, status: DeviceStartStatus | null }`
(§9.15); 503 when not wired. Live updates ride `device-start:<deviceId>`
(§7.2), replayed to new exact and wildcard subscribers — so a house view
opened after a failed start still shows it.

**Client.** `house/useHouseSignals.useStartStatuses` reads this route once per
fleet row when the house view opens (the app's `*` subscription predates the
view, so the wildcard replay alone would not reach it) and then follows
`device-start:*`, keeping the newest `updatedAt` per screen.
`houseCopy.startStatusLine`: `starting`/`delivered` → "Starting: <step label>";
`stale` → "A start stopped reporting at …"; `failed` (or a `lastFailure`) →
"Couldn't start at <time>: <error sentence, or step + code>"; `queued` /
`started` → "Added to its queue" / "Started" for one minute.

**House-wide actions (client, RQ-STEER-13).** `house/houseQuiet.js`: Pause all
sends `transport.pause` to every row playing/buffering, Stop all
`transport.stop` to every active row, each through that screen's session
controller (§4.3, or the browser route), plus this device's local session.
Offline rows are not sent anything and are reported "not reachable"; a refusal
or no answer within 8 s is "didn't answer". The ids actually paused are kept
in `FleetProvider` (`quiet.resumable`) and Resume all sends `transport.play`
to exactly those. One outcome record (`kind: pauseAll|stopAll|resumeAll`,
`command.copy`) carries the sentence; a record with `command.copy` is shown
as-is by the tray. Events `house.quiet-all`, `house.quiet-all-unreached`.
Stop "and turn the screen off" (RQ-STEER-11) is offered for configured screens
with `device_control` that are not speakers: `transport.stop` then
`GET /device/:id/off` (events `house.screen-off|screen-off-failed`). Put it
back from a row calls `sessionControls.putBack(noteId)` (§4.9); Add only off,
`sessionControls.setAddOnly(false)` (events `house.put-back*`,
`house.add-only-off*`).

**Verified by:**
- `backend/src/3_applications/devices/services/DeviceStartStatusService.test.mjs` — phase folding, lastFailure lifetime, superseded dispatches, staleness
- `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.deviceStart.test.mjs` — routing + replay
- `backend/src/5_composition/composition-contract-registry.test.mjs` (`devices.start-status-reaches-every-house-view`)

### 4.11 Client side of the session controls, moves and several screens (batch B)

**One controls surface.** `useSessionControls(target)` returns `{ controls,
actions, available, reason, supports }` for this device or a screen:
`controls` is the §9.14 block (this device: `controller.sessionControls.getState()`;
a screen: its published `snapshot.controls`); `actions` mirrors
`controller.sessionControls` on both. A screen that publishes no `controls`
shows every control unavailable with a reason; a browser target has none.

**This device's controls** (`session/localSessionControls.js`) run the same
`createScreenSessionControls` state machine and `createContinuationResolver`
as screens, bound by ports (the rule set is shared, the ports are not: a
screen's timer stops, this one pauses): the natural end (`onPlayerEnded`) consults it
first; a minutes timer fades `controller.output` (a multiplier PlayerBridge
applies on top of the volume, never the volume setting) and then **pauses**
(item and spot kept); `resumeSleep` adopts the set position; a similar batch
is one item action with `addedBy: "auto-continue"` (whitelisted, with
`type: "episode"`, by `queueOps.toQueueItem`). `setAddOnly`/`putBack` answer
`UNSUPPORTED` (they belong to a screen other devices play to). End of queue,
stop after this one and the sleep resume point persist per browser in
`localStorage` `media-app.session-controls.v1:browser:<clientId>`.

**Origin.** `PeekProvider` gives every remote controller
`origin: { kind: "device", id: "browser:<clientId>", name: <display name ≤ 80> }`,
read at send time, so screens name the device in notes.

**Add only result.** A `homeline` `load` step or `/load` result carrying
`appliedAs: "add"` turns that attempt into an add (`kind`/`operation: "add"`,
`appliedAs: "add"`), resolved by its `queue` step and read as
"Added X to Y (Add only is on) · Nth in line".

**Add to this queue.** `SearchLauncherContext.openAddToQueue({ deviceId, name })`
(provided by the shell) opens `SearchMode` with `addTo`: every pick is
`useContentDispatch().addToScreen(deviceId, id, item)` — an `add` item action
to that one screen — and the surface closes. The aim is not read or written.

**Several screens.** The aim names up to three known screens
(`"Kitchen + Living Room"`), else `"N screens"`. Rooms come from
`GET /api/v1/media/screens` (cached 60 s; fleet `location` as fallback); two
or more chosen screens sharing a room, or in rooms the registry marks as
neighbours (`roomAdjacency`, §2.5), show the drift warning
(`screenRooms.neighbouringRoomGroups`; `aim.drift-warned` carries
`neighbouringRooms`).
Line up seeks the steered target to another's reported spot
(`cast/reportedSpot.js`: position + time since heard × rate, capped at the
duration).

**Move between screens** (`cast/screenMove.js`). Source = the screen's last
published snapshot with its spot carried forward; it must carry
`meta.playbackOwner`. Destination first: a screen through the typed hand-off
(`capture` → `start`); if that is refused outright (an idle screen answers
`INVALID_CAPTURE`) or the capture never confirms, through
`POST /device/:id/load` `{ mode: "adopt" }`, counted only once that screen
reports the same item (45 s). This device adopts locally. Only after the
destination is adopted and the source still has the same owner revision is
the source stopped, by `POST /session/claim` (stop with `intent: "move"`, so
the source shows "Moved by …"). Any other result leaves the source playing.

**Player completion guard.** `Player.beginRendererBoundary` (a new owner
operation on the mounted content: sleep resume, Put it back, a same-item
adopt) resets the duplicate-completion key, so the resumed item's next
natural end is a new completion. A natural end HELD by the session controls
(countdown, Stop after this one, sleep at end) dispatches `PLAYER_STATE
ended` without pausing — the handle and lock screen read ended, and Play goes
through the ended → replay-as-new-visit path — and the controller's `release`
calls `Player.releaseCompletion()` (also cleared by `seek`), so scrubbing back
and playing to the end again is a new completion, not a duplicate. A minutes
timer persists `sleepTimer.endsAt` and re-arms (or resolves to the resume
offer) on hydrate. A failed `media:adopt-snapshot` (no owner, superseded,
refused) answers the command with `command-handler-error { commandId }` so the
mover fails at once, and a successful adopt acks once via
`media:session-control-applied { commandId }` — `media:adopt-snapshot` is NOT in
the ack publisher's dispatch-time list (an optimistic ack would win the 60 s
dedupe and swallow the failure); the epoch bump happens inside the adopt handler. The
backend adopt load carries `autoplay: false` for a paused snapshot.

**Lock screen** (`session/useMediaSession.js`). Local playback publishes
`navigator.mediaSession` metadata (title, show/album or artist, artwork),
`playbackState`, `setPositionState` (≤ every 5 s) and play / pause / stop /
next / previous / seek handlers that call the same session controller.

### 4.11 Player features on a screen (P2)

Subtitles and audio language (RQ-STEER-14), Show briefly (RQ-PLAY-11) and
music behind a slideshow (RQ-PLAY-12). Each route sends one `session`
envelope (§6.2.6) and maps the ack like §4.9 (200 / 400 / 404 / 409 / 502
with the screen's `code`). Every body takes `commandId` and optional
`origin`. Params are validated by `validatePlayerFeatureParams`
(`shared/contracts/media/playerFeatures.mjs`, wired into
`validateSessionActionParams`). State is published in `snapshot.controls`
(§9.14).

| Route | Body | Envelope |
|---|---|---|
| `POST /api/v1/device/:id/session/tracks` | `{ audio?: "<track id>", subtitle?: "<track id>" \| "off" }` (at least one) | `session` `{ action: "set-tracks", … }` |
| `POST /api/v1/device/:id/session/brief/close` | `{}` | `session` `{ action: "close-brief" }` |
| `POST /api/v1/device/:id/session/music-behind` | `{ op: "start" \| "play" \| "pause" \| "next" \| "prev" \| "stop", contentId?, title? }` (`start` needs `contentId`) | `session` `{ action: "music-behind", … }` |

Screen refusals (502): `NO_PLAYBACK`, `UNKNOWN_TRACK`, `TRACKS_NOT_OWNED`,
`TRACK_SELECT_FAILED`, `NO_BRIEF`, `NOT_A_SLIDESHOW`, `NO_MUSIC`,
`MUSIC_LOADING`, `INVALID_SESSION_COMMAND`.

**Show briefly is a load option, not a route.** `GET|POST /device/:id/load`
with `play=<contentId>&brief=1` (or `brief=<seconds>`, or `briefSeconds=`)
shows the item OVER the screen's programme; `title=` names it on the
screen. A camera is `play=camera:<cameraId>`: a camera started by a routine
(a load with no device naming itself — Home Assistant, schedules) is brief by
default (30 s); `brief=0` makes it take the screen instead (the programme
stops). Anything else is brief only when asked. The screen acks with
`appliedAs: "brief"` (§6.3); `WakeAndLoadService` then confirms playback on
the published `controls.brief` (its current item never changes) and never
sends a `camera:` ref to the transcode prewarm. The Media app sends
`brief=1&title=…` from an item's **Show briefly on…**
(`buildDispatchUrl({ brief, title })`).

A brief (or `camera:` play) is always delivered to the screen as the
command envelope, never as a page URL: on a cold or unsubscribed screen
`WakeAndLoadService` loads the base page and then sends the same envelope as a
warm one (the page's autoplay parser cannot run a brief, and ignores `brief`,
`briefSeconds` and `title`). Another device's brief on a screen in Add only is
refused (`ADD_ONLY`, 502); a person's brief leaves a screen note
(`kind: "brief"`, "Shown briefly by …") and stamps "started by"; a routine's
does neither. A Stop, the sleep timer or the screen going to sleep ends a
brief with nothing returning (the programme is not resurrected); a time-out or
clip end after the programme was stopped returns nothing, while a person
closing it still asks for it back. A programme that ENDED by itself under a
brief (end of queue, stop after current, sleep at end of item) is reported to
the extension (`onPlaybackStopped(reason, { naturalEnd: true })`): the brief
stays up, but closing it returns nothing (`brief.programme-ended`).

**Brief to a cold screen.** After the base page loads, `WakeAndLoadService`
polls (every 500 ms, bounded at 30 s, on the injected clock/scheduler) for
`getTopicSubscriberCount(topic) > 0` AND `commandHandlerLivenessService.isFresh(deviceId)`
before broadcasting — the raw count includes wildcard subscribers (a phone's
Media app), which made a cold TV look subscribed at once. A screen that never
gets there is a failed load (`Screen not connected`, `wake-and-load.load.brief-no-subscriber`),
and so is a brief whose handler ack does not come back `ok`; never `ok`.

**Stream selection on the mint (Plex).** A stream mint
`GET /api/v1/proxy/plex/stream/:ratingKey` may carry `audioStreamID` and/or
`subtitleStreamID` (`0` = subtitles off; parsed by `parseStreamParams`).
Verified read-only against the live Plex (2026-10): the transcode
`decision`/`start` URLs ignore per-request stream ids; Plex plays the part's
SELECTED streams, and that selection is **per Plex account** — shared by every
screen, the garage and every Plex app — so it is borrowed, never kept.
`PlexAdapter.loadMediaUrl(item, { tracks })` accepts only the item's own
stream ids and, in order: reads what is selected now; selects the requested
streams on the part (`PlexClient.selectPartStreams` →
`PUT /library/parts/:id?…&allParts=1`); asks for the transcode decision (which
binds the chosen streams to that transcode session — a start after the restore
still plays them, confirmed with ffprobe on the segments); **restores the
previous selection straight away** (also when the decision fails, and for
`subtitles off`, where the restore re-selects the previous subtitle); then
returns a URL with `subtitles=burn` for a chosen subtitle (no direct play; no
direct stream when burning). A mint without these params is unchanged and
writes nothing. Remaining window: the account's selection differs from its
resting value for the length of one decision request (hundreds of ms); a
transcode on the same file started in that window would inherit the borrowed
choice, and a failed restore is logged and leaves the borrowed choice until the
next track mint on that file. Track mints on one part are serialised
(a per-part promise chain around read-previous, select, decision, restore;
safety expiry 60 s, started once the mint holds the lock — not at queue time; the decision and the fresh-selection read carry deadlines of 45 s and 10 s, so a Plex stall always settles and restores before the expiry), and a mint that waited re-reads the part's selection fresh,
so a second mint can never take the first's borrowed track as "previous". When
no audio stream is flagged `selected` the restore uses the `default`-flagged
audio stream; with neither it logs `tracks-restore-skipped` (warn) and the
account stays on the borrowed audio. If the decision fails, the fallback start URL plays
the restored (account) selection, not the choice. Log events (all
`plex.loadMediaUrl.*`): `tracks-selected`, `tracks-restored` (info),
`tracks-rejected`, `tracks-select-failed`, `tracks-restore-failed`,
`tracks-restore-skipped`, `tracks-refresh-failed` (warn).
A track's `selected` state in `controls.tracks` reports what this stream was
minted with, never Plex's own flag.

**Verified by:**
- `shared/contracts/media/playerFeatures.test.mjs` — params, Plex track list, show-keyed carry-over, brief mode, published shapes
- `backend/src/4_api/v1/routers/device.player-features.test.mjs` — the three routes, validation, refusal mapping
- `backend/src/1_adapters/content/media/plex/PlexAdapter.tracks.test.mjs`, `backend/src/4_api/v1/routers/proxy.plexStreamTracks.test.mjs` — part selection, burn, unchanged default mint
- `tests/isolated/application/devices/WakeAndLoadService.brief.test.mjs` — brief confirmation, no camera prewarm
- `tests/live/flow/media/media-app-player-features.runtime.test.mjs` — every behaviour on the virtual receiver

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
  "command": "transport" | "queue" | "config" | "adopt-snapshot" | "system" | "display" | "handoff" | "session",
  "params": { /* command-specific */ },
  "origin": { /* optional, §6.2.7 */ },
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
{ "action": "play" | "pause" | "stop" | "seekAbs" | "seekRel" | "skipNext" | "skipPrev" | "goLive",
  "value": <number>,
  "intent": "move",     /* optional: this stop takes playback to another screen */
  "keepMusic": true     /* optional boolean, `stop` only: the sender's explicit answer to
                           "Keep the music playing?" for a slideshow with music behind it */ }
```
`keepMusic` is additive: the Media app's stop guard sends it on every Stop it
issues (true after Keep; false after "Stop music too", with nothing to ask,
from a house row's Stop, "Stop and turn the screen off", Stop all and a
dispatch attempt's Stop). A non-boolean is a 400 on the device route and an
invalid envelope. Contract: `isKeepMusicParam` in `shared/contracts/media/commands.mjs`.
A screen uses it when present; only when absent (a legacy sender) does it fall
back to inferring from the origin (§ music behind below).
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
{ "setting": "shuffle" | "repeat" | "shader" | "volume" | "addOnly" | "endOfQueue" | "stopAfterCurrent",
  "value": <per-setting> }
```
`addOnly` and `stopAfterCurrent` take a boolean, `endOfQueue` one of
`stop | repeat | similar` (§6.6). Screens route these three to their session
controls and ack them on the outcome, not on receipt.

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

Screens adopt it through the restore path (`ScreenActionHandler`
`media:adopt-snapshot` → the same owner bootstrap + adopt as
`media:restore-snapshot`, playing unless `autoplay: false`). The command is acked by its outcome (success: `media:session-control-applied`;
failure: `command-handler-error`), never at dispatch. Before 2026-10-03
the command was acknowledged and then dropped, so a move to an idle screen
could never start there.

#### 6.2.5 `command: "system"`
`reset`, `reload`, `sleep`, `wake`. Ported from existing `useScreenCommands`
into the envelope.

#### 6.2.6 `command: "session"`
Screen session actions (§6.6). Validated by
`validateSessionActionParams` in `shared/contracts/media/sessionControls.mjs`.
```json
{ "action": "sleep-timer", "minutes": <0 < n <= 720> }
{ "action": "sleep-timer", "atEnd": "item" }
{ "action": "cancel-sleep-timer" | "resume-sleep" | "cancel-countdown" | "start-next-now" }
{ "action": "put-back", "noteId": "<optional note id>" }
{ "action": "set-tracks", "audio": "<track id>", "subtitle": "<track id>" | "off" }   /* P2, §6.7 */
{ "action": "close-brief" }
{ "action": "music-behind", "op": "start" | "play" | "pause" | "next" | "prev" | "stop", "contentId": "...", "title": "..." }
```
Acked on the outcome (`media:session-control-applied`, or an `ok: false` ack
with the refusal code).

#### 6.2.7 Command `origin`
Optional on every envelope: who issued the command.
```json
{ "kind": "device", "id": "browser:<clientId>" | "fleet:<deviceId>" | "<deviceId>", "name": "<optional human name>" }
{ "kind": "routine", "name": "<routine name>", "triggerId": "<optional>" }
```
Screens stamp the latest playback-relevant command's origin into
`snapshot.meta.origin` (volume and shader changes do not count) and use it to
name screen notes. Local input on the screen stamps `{ kind: "device", id:
<the screen's own deviceId> }`.

A screen that gives up on an item by itself (its Player's resilience is
exhausted, so it skips to the next queue item or stops) records it in
`snapshot.meta.problem` (RELY.5a/AC4):
`{ kind: "skipped" | "failed", reason, item: { contentId, title }, replacement:
{ contentId, title } | null, at: <epoch ms> }`. It is a record carrying its own
time, not a live state. A Media sender that started, aimed at or last steered
that screen turns a problem newer than two minutes into a playback outcome on
that screen ("<item> stopped making progress on <screen> · Now playing
<next>"), once per `at`. A live item publishes `isLive: true` and no
`duration` in `currentItem` (STEER.4a/AC3), so any Remote shows LIVE and Go to
live instead of a position.

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

Optional `appliedAs` / `requestedOp` (queue ops) say how a command was
actually applied when it differs from what was asked. `appliedAs: "brief"`
says a play was shown briefly over the programme (§4.11). Add only (§6.6) acks a
`play-now` with `{ appliedAs: "add", requestedOp: "play-now" }`. The device
gateway and `SessionControlService` pass both through to the HTTP response,
and `/device/:id/load` reports `appliedAs` on its result (WakeAndLoad then
watches for the queue append rather than a playback start).

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

Receiver handling of the playback-config and reorder commands (Phase 2b fixes):
`media:config-set` for `shuffle`, `repeat` and `volume` is handled in
`ScreenActionHandler.jsx` (`handleMediaConfigSet`), which hands a `set-config`
queue op to the mounted playback owner (`Player.jsx` `handleQueueOp`): repeat
sets the queue controller's repeat mode, volume sets the session volume
(snapshot units 0..100, Player units 0..1), and shuffle sets a play-order flag
and rewrites the queue's `executionOrder` only (`modules/Player/lib/shuffleExecutionOrder.js`:
current item and Up Next band stay in front, the listing is never reordered).
Bad values and a missing owner raise `command-handler-error`. The other config
settings (`shader`, `addOnly`, `endOfQueue`, `stopAfterCurrent`) keep their own
paths. A queue `reorder` op (`{from,to}` or `{items}`) runs as an item action
(`kind: 'reorder'` in `itemActionOwner.js`, `queueOps.reorder`), so it is one
undoable operation and its ack waits for the new order to be readable.

### 6.6 Screen session controls (P1)

Implemented in `frontend/src/screen-framework/session/` (state machine
`screenSessionControls.js`, bound by `ScreenSessionControlsHost.jsx`, one per
screen with a device identity). Everything below is published in
`snapshot.controls` (§9.14) on every state broadcast; control changes
re-publish immediately.

**Add only (RQ-PLAY-10).** While on, another DEVICE's `queue` `play-now` — or
`item-action` `playNow`/`shuffle` — is applied as an add (`appliedAs: "add"`
on the ack, §6.3; the start status reports `queued`). Exempt, so they always
play: local input, routine and originless commands (automations), and the
screen's own fleet origin. When nothing is loaded there is no queue to
protect, so the command plays normally.

**Session-scoped modes.** Add only, end-of-queue and stop-after-current belong
to the session they were set in: they return to `false / stop / false` when
that session's queue goes idle or a new local/URL start replaces it, and are
restored only together with a power-cut restore (never on their own).

**End of queue (RQ-STEER-19), exclusive setting `stop | repeat | similar`.**
`stop` keeps today's end. `repeat` restarts the queue at its first item.
`similar` adds the next batch from the finished item's container (owner
decision O2, revised) and plays on:
- siblings API → parent container; a parent id starting `library:` is the
  adapter's whole-library fallback, so nothing similar;
- episodes climb from the season into the show, tracks from the album into
  the artist (queue API of that ancestor, natural season/disc + index order);
  a playlist plays its remainder and then stops;
- preference, never a gate: never-played items after the finished one →
  items not played within 7 days (household `lastPlayed`) → least recently
  played; never something queued here or playing on another screen;
- batches of at most 5 items or about 30 minutes, appended as ONE item
  action (one undo record) with every item marked `addedBy: "auto-continue"`;
  the next batch is fetched when the last auto-added item starts;
- nothing it already added since the last human input is added again, so a
  container is cycled at most once; after 4 unattended batches (~2 h) it
  stops. Any device command or local start resets both;
- nothing left → stop with `endOfQueueStatus: { code: "NOTHING_SIMILAR",
  message: "Nothing similar left" }`. Live items have no queue-end choice.
Policy: `shared/contracts/media/continuation.mjs`; resolver:
`screen-framework/session/continuationResolver.js`.

**Next episode and stop after this one (RQ-STEER-20).** At the natural end of
an episode whose next queue item is also an episode, the screen shows a
10-second countdown (`controls.countdown`), cancellable from the screen (its
button, or Back) and remotely (`cancel-countdown`, `start-next-now`). Cancel
stops on the finished episode with the queue kept. `stopAfterCurrent` stops
at the end of the current item once, then clears itself
(`endOfQueueStatus.code: "STOPPED_AFTER_CURRENT"`). The Player consults these
through `modules/Player/lib/naturalEndPolicy.js`. A registration carries
`isOwner(playerInstanceId)` and only the Player the screen session is bound
to (its action owner) is consulted — any other Player on the page (a school
lesson, a composite view, the Media app) keeps its own end behaviour. Skips,
failures and clears never reach it. A skip, seek, transport or queue command
— or the current item changing by any route — supersedes a running countdown,
and the policy's `release()` lets go of the held end so the finished item can
complete (and advance) again if it is played to its end once more.

**Sleep timer (RQ-STEER-12).** `minutes` counts down (`remainingSeconds`
published), fades the screen's output over the last 10 s (a transient
multiplier in `ScreenVolumeProvider`, never the user's master), stops with
the queue kept, then restores full output. `atEnd: "item"` stops at the end
of the current item. Both record `setPosition` when set and leave
`sleepResume` after stopping; `resume-sleep` restores that item and spot and
plays.

**Screen notes and Put it back (RQ-STEER-21).** A remote pause, stop, replace
(`play-now`, item-action Play/Shuffle, adopt, handoff start) or move (stop
with `intent: "move"`, handoff `commit-stop`) of loaded playback adds a note
`"<Paused|Stopped|Replaced|Moved> by <origin name>"`; repeats of the same
kind from the same origin within 60 s are grouped (`count`). Volume and
shader changes never make notes. The pre-change snapshot is kept for 10 s:
`put-back` (or the note's button) restores item, spot and queue — playing
if it was playing — unless a newer remote command or local playback has
since taken the screen. The last five notes are published in
`controls.notes`, so a screen that cannot render them still shows them on its
house-view row.

**Power cut (RQ-RELY-08).** The backend's last snapshot
(`DeviceLivenessService`) is in server memory only and dies with the house
power, so **the screen persists its own session** in browser storage
(`daylight.screen-session.v2:<deviceId>`, `session/sessionPersistence.js`):
- kept only while somebody is in a session — playing, paused, buffering,
  loading or stalled. Stop (`ready`), Move here (which stops this screen),
  the natural end of the queue and idle CLEAR the record;
- the full queue is written on change; a 5 s tick moves only the current
  item's spot while playing;
- on a cold start the screen waits 2.5 s and re-adopts the session **paused**
  (never autoplay) through `media:restore-snapshot` — unless the page URL
  carried autoplay parameters, any start reached the screen since mount, or a
  playback owner is already registered;
- the screen re-checks immediately before adopting: if any start reached it
  after the restore began, or (power restore) the owner already holds an
  item, the restore is refused with `RESTORE_SUPERSEDED`;
- a restored session keeps its ORIGINAL `savedAt` and a `restored` mark until
  a person or remote resumes it (a transport, seek, queue or local start
  followed by `playing` — a transient `playing` report during the paused
  adopt does not count); a never-resumed one is not offered again. Records
  older than 24 h and live items are never restored.

**Verified by:**
- `frontend/src/screen-framework/session/*.test.*` — state machine, resolver, host, persistence
- `frontend/src/modules/Player/Player.naturalEndPolicy.test.jsx` — Player seam
- `frontend/src/screen-framework/commands/useScreenCommands.sessionControls.test.jsx` — Add only, notes, origin, routing
- `frontend/src/screen-framework/publishers/useCommandAckPublisher.sessionControls.test.jsx`, `registrySessionSource.controls.test.js`
- `frontend/src/screen-framework/actions/ScreenActionHandler.restore.test.jsx`, `screenItemActions.autoContinue.test.js`
- `shared/contracts/media/sessionControls.test.mjs`, `continuation.test.mjs`
- `tests/live/flow/media/screen-session-controls.runtime.test.mjs` — one browser journey per behaviour on the virtual receiver (run with `tests/_lib/media-redesign-server.mjs`)


### 6.7 Player features on screens (P2)

Implemented in `frontend/src/screen-framework/session/screenPlayerFeatures.js`
(state machine with ports, attached to the session controls with
`controls.attachExtension`, so its actions ride `handleSession` and its blocks
are spread into `toPublished()`), bound by `ScreenPlayerFeaturesHost.jsx`.
A screen without the extension behaves exactly as before.

**Subtitles and audio language (RQ-STEER-14).** The Player side is OPT-IN
(`modules/Player/lib/trackPolicy.js`, like `naturalEndPolicy.js`): an owner
registers `{ isOwner(playerInstanceId), getPreference, setPreference,
onTracks }`; only the Player it claims (the screen's bound playback owner, or
the Media app's own Player) lists tracks, applies a remembered choice or
accepts `setTracks`. Every other Player resolves, renders and registers as
before, and a page with no owner runs no track work at all. Tracks are the
item's Plex streams (`plexTracksFromMetadata`: first media, first part;
subtitles named by their own title, e.g. "English [SDH]"), else the engine's
own (`lib/engineTracks.js`: native `textTracks`/`audioTracks`, hls.js
`audioTracks`/`subtitleTracks`, dash.js `getTracksFor`/`setCurrentTrack`/
`setTextTrack`). A choice is remembered per device under the show
(`show:<grandparentId>`; `item:<contentId>` otherwise) in browser storage
(`daylight.track-preferences.v1:<namespace>`, 200 entries) and matched on the
next episode by language and name — so it carries on. A Plex choice re-mints
the stream at the same spot (a SinglePlayer remount with
`reason: "track-change"`; pause state is kept); an engine choice switches in
place. Player log events: `playback.tracks.selected`,
`playback.tracks.remembered-applied`, `playback.tracks.select-refused`.

**Show briefly (RQ-PLAY-11).** `useScreenCommands` turns a brief play
(§4.11) into `media:brief` — not a replace, so it makes no screen note and
leaves `meta.origin` alone. The programme is paused (not unmounted) and the
camera (`CameraOverlay`) or clip (an auxiliary Player) is shown in a
full-screen layer with a bar: `"<title> · from <origin>"`, "Back to
<programme> in Ns / after this / when closed", and **Close** (Back closes it
too). On Close, Back, the clip's end, its time running out or a remote
`close-brief`, the programme comes back at its spot with its queue: resumed
if it is still the loaded item, else restored from the snapshot taken when
the brief began (the put-back restore path). A second interruption keeps the
first programme to return to. Any other start on the screen (play, queue,
play-now, item action Play, adopt) supersedes the brief and nothing returns.
Log events: `brief.started`, `brief.ended` (`reason`, `returned`),
`brief.superseded`.

**Music behind a slideshow (RQ-PLAY-12).** `music-behind start` is accepted
only while the current item is an image (`NOT_A_SLIDESHOW`). The music is a
second, **auxiliary** Player (`modules/Player/components/MusicBehindLayer.jsx`,
`auxiliary` prop: never registers for screen queue commands) with its own
queue, steered only by `music-behind` ops; transport commands steer the
photos. A remote Next on a slideshow now skips the photo (routed to the queue
owner as `skip-next`; video and audio keep the synthetic Tab), and a running
slideshow publishes `playing` (`playerSessionBridge`). The music outlives the
slideshow: stopping the photos leaves it playing until `stop`. A plaque on
the screen shows the song. The decision to keep it is the controller's
(§ "Media app" below). A Stop that names an origin (another device, after
its "Keep the music?" question) leaves the music; a Stop with none (the TV
remote, a routine), the sleep timer and the screen going to sleep stop it.
That origin rule is only the fallback: a Stop carrying an explicit boolean
`keepMusic` (§6.2.1) is obeyed whatever its origin.
The music never outlives the photos into another sound
(`modules/Player/lib/musicBehindPolicy.js`, one rule for both surfaces): a
non-image current item stops it, even after Keep; no current item stops it
unless the person chose Keep (a load between photos does not). A device-origin
Stop is the screen's Keep (the controller asked); every other stop (routine,
TV remote, sleep timer, display sleep) stops it too. House **Stop all** stops
each screen's music after its stop (a house-wide stop means quiet); a Move of
the slideshow stops the local music with the slideshow (no question in the
middle of a Move). The music follows the screen's volume and the sleep fade (it is an ordinary
Player under the screen volume), and auxiliary Players never write the play
ledger or resume progress (`AuxiliaryPlayerContext`).

**Composite content API, assessed.** `POST /api/v1/content/compose` (§2.1)
resolves a *new* visual+audio presentation; it has no frontend consumer and
no way to add music to a slideshow already playing or to steer the audio on
its own, and the Player's `AudioLayer` (queue `audio`) dies with its parent
and has no control surface. Music behind therefore reuses the Player itself
as an auxiliary instance rather than `compose`.

**Media app.** `PlayerFeatureControls` (mounted once in `TransportBar`, so
for this device and every screen's Remote) reads `snapshot.controls.tracks /
.musicBehind / .brief` for a screen and `session/localPlayerFeatures.js` for
this device (`PlayerBridge` claims its Player; `MusicBehindHost` runs the
local music layer). `useSlideshowStopGuard` asks "Keep the music playing?"
when Stop is pressed on a slideshow with music behind (the TransportBar and
the mini player alike, and a house row's Stop; Keep marks `keepMusicAfterStop()`)
and hands the answer to the stop as `{ keepMusic }`. Stop all also stops music
kept behind a slideshow on a screen that is now idle (and on this device),
without sending that screen a transport stop (`planQuiet` `musicOnly` targets). Log events:
`media.player-feature.command`, `.failed`, `.state`.

**Verified by:**
- `frontend/src/screen-framework/session/screenPlayerFeatures.test.js` — tracks, brief return/resume/restore/supersede, music
- `frontend/src/screen-framework/commands/useScreenCommands.brief.test.jsx` — which plays are brief; screens without the extension unchanged
- `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`, `publishers/playerSessionBridge.test.js` — slideshow skip and state
- `frontend/src/modules/Player/Player.tracks.test.jsx`, `lib/playerTracks.test.js` — opt-in seam, unchanged default, re-stream, carry-over, auxiliary Players
- `frontend/src/modules/Media/shell/PlayerFeatureControls.test.jsx`, `cast/DispatchTargetPicker.brief.test.jsx`

---

### 6.x Screen prompts and TV input (D-pad, OK, unreliable Back)

A screen on the Shield/FKB receives only arrow keys (`navigate`), Enter
(`select`) and an `escape` that FKB may swallow. Every prompt a screen host
renders over playback is operable with `navigate`/`select` alone:

| Prompt (host) | Input contract |
|---|---|
| Next-episode countdown (`ScreenSessionControlsHost` → `CountdownPrompt`) | Modal via `useScopedRemoteControls`: it captures `navigate`/`select`/`escape` on the ActionBus while shown, focuses **Cancel** (the first control), arrows move to **Play now**, `select` presses the focused control, `escape` cancels as well |
| Put it back (a screen note) | `OkButton`: while the note is up with a restore available, a bus **capture of `select` only** presses the button; arrows and every other key still reach the player; the capture ends with the note (10 s) |
| Sleep fade ("Sleep timer — stopping") | `OkButton` **Keep playing** (`cancel-sleep-timer`) owns `select` while the fade runs |
| Show briefly bar (`ScreenPlayerFeaturesHost` → `BriefBar`) | `useScopedRemoteControls` on the bar: **Close** takes focus, `select` closes, `escape` closes as well |
| End-of-queue notices, music plaque | Informational; no input |

Controls carry a visible `:focus` ring and a 44 px minimum. Log event
`ScreenSessionControlsHost` `tv-prompt.ok` (info) records an OK that pressed a
non-modal prompt. Verified by the key-event cases in
`ScreenSessionControlsHost.test.jsx`, `ScreenBriefSurface.tvInput.test.jsx`
and the journey `tests/live/flow/media/screen-tv-input.runtime.test.mjs`.

### 6.y Media client accessibility contracts

- **Hit-target floor.** `theme/mediaTheme.js` sets `minHeight: 44` on Button,
  Input, Menu items, checkbox/radio/switch labels, and 44 × 44 on ActionIcon and
  CloseButton; portalled surfaces read the same theme. `respectReducedMotion`
  is on, and `MediaShell.scss` ends with a `prefers-reduced-motion` block for
  the shell, the Player host, the search dropdown, menus and dialogs
  (Loaders exempt).
- **Search from anywhere.** `MediaAppShell` handles `/`: it focuses the dock's
  `.media-search-bar input` when laid out, otherwise opens Search Mode through
  `SearchLauncherContext.openSearch()` (new; `openAddToQueue` is unchanged).
- **Phone tab bar.** `PrimaryNav` `TabBar` renders `app-tab-search` after the
  three destinations when the launcher context offers `openSearch`; it is an
  action, not an area (`aria-current` never applies).
- **Aim on Now Playing.** `NowPlayingView` renders `DestinationLine`
  (`surface: "now-playing"`) in place of the read-only aim label.

Verified by `tests/live/flow/media/media-app-p0-accessibility.runtime.test.mjs`
(`RELY.11a`, `RELY.12a`, `RELY.13a`, `RELY.14a/AC3`) and, for interaction
budgets, `media-app-p0-personas.runtime.test.mjs`.

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
| `device-start:<deviceId>` | backend → subscribers | backend (`DeviceStartStatusService`) | `DeviceStartStatus` (§9.15) | Start progress / last failure per screen; replayed on subscribe (exact and wildcard). |
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
    "ownerId": "<deviceId>" | "<clientId>",
    "origin": { /* optional — who last commanded it, §6.2.7 */ }
  },
  "controls": { /* optional — screen session controls, §9.14 */ }
}
```

Queue items added by "keep similar things playing" carry
`addedBy: "auto-continue"` and the batch's `itemActionId`.

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

Optional start fields (PLAY.4a): `seconds` (start offset, seconds) and
`resume: false` are present only when the person chose where to start — a
screen's saved spot, or `seconds: 0` for "From the beginning". The Player
honours `seconds` over the server's `resume_position` and passes `resume=false`
to `/play`. They ride `itemAction.item` to a remote Media receiver unchanged.

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
  "appliedAt": "<ISO-8601>",
  "appliedAs": "<queue op, optional — e.g. add>",
  "requestedOp": "<queue op, optional — e.g. play-now>"
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

### 9.14 `SessionSnapshot.controls`
Validated by `validateSessionControls` (`shared/contracts/media/sessionControls.mjs`).
Every field is present on a published block.
```json
{
  "addOnly": <bool>,
  "endOfQueue": "stop" | "repeat" | "similar",
  "stopAfterCurrent": <bool>,
  "sleepTimer": null | {
    "mode": "minutes" | "atEnd",
    "minutes": <n>, "endsAt": "<ISO>", "remainingSeconds": <int>,   /* minutes mode */
    "atEnd": "item",                                                 /* atEnd mode */
    "setAt": "<ISO>", "fading": <bool>,
    "setPosition": { "contentId": "...", "queueItemId": "...", "position": <s> } | null
  },
  "sleepResume": null | { "contentId": "...", "queueItemId": "...", "position": <s>, "setAt": "<ISO>", "stoppedAt": "<ISO>" },
  "countdown": null | {
    "seconds": 10, "endsAt": "<ISO>", "remainingSeconds": <int>,
    "next": { "contentId": "...", "title": "...", "queueItemId": "..." },
    "current": { "contentId": "...", "title": "..." }
  },
  "endOfQueueStatus": null | {
    "code": "NOTHING_SIMILAR" | "SIMILAR_ADDED" | "STOPPED_AFTER_CURRENT",
    "message": "Nothing similar left", "count": <n>, "contentIds": [...], "title": "...", "at": "<ISO>"
  },
  "notes": [ {
    "id": "...", "kind": "paused" | "stopped" | "replaced" | "moved" | "brief",
    "label": "Paused by Dad's phone", "count": <int>, "at": "<ISO>",
    "origin": { /* §6.2.7 */ } | null,
    "putBack": null | { "availableUntil": "<ISO>" }
  } ],
  /* Player features (P2, §6.7) — present on screens with the extension; null when idle */
  "tracks": null | {
    "contentId": "...", "source": "plex" | "native" | "hls" | "dash",
    "audio": [ { "id": "...", "language": "eng", "label": "English (EAC3 5.1)" } ],
    "subtitles": [ { "id": "...", "language": "eng", "label": "English [SDH]", "forced": true? } ],
    "selected": { "audio": "<id>" | null, "subtitle": "<id>" | null }
  },
  "brief": null | {
    "id": "...", "kind": "camera" | "clip", "contentId": "...", "cameraId": "...",
    "title": "...", "label": "Doorbell · from Automation", "origin": { /* §6.2.7 */ } | null,
    "startedAt": "<ISO>", "endsAt": "<ISO>" | null, "remainingSeconds": <int> | null,
    "returnTo": { "contentId": "...", "title": "..." } | null
  },
  "musicBehind": null | { "contentId": "...", "title": "...", "state": "loading" | "playing" | "paused", "trackTitle": "..." }
}
```
`tracks`, `brief` and `musicBehind` are validated by
`validatePlayerFeatureControls` when present. A Plex subtitle is `selected`
only when this stream burned it in.

### 9.15 `DeviceStartStatus`
Published on `device-start:<deviceId>`; validated by `validateDeviceStartStatus`.
```json
{
  "topic": "device-start",
  "deviceId": "<id>",
  "dispatchId": "<uuid>",
  "phase": "starting" | "delivered" | "queued" | "started" | "failed",
  "step": "power" | "verify" | "volume" | "prepare" | "prewarm" | "load" | "playback" | "queue",
  "stepStatus": "<wake-progress status>",
  "error": "<string, required when failed>",
  "contentId": "<optional>",
  "lastFailure": null | { "dispatchId": "...", "step": "...", "error": "...", "at": "<ISO>" },
  "stale": <bool — non-terminal and quiet for 2 minutes>,
  "updatedAt": "<ISO>"
}
```
`delivered` = the content reached the screen (`load` done); `queued` = it
was taken as a queue add (Add only, or a requested add) — nothing started;
`started` = playback confirmed; a playback/queue `timeout` is a failure. A
dispatch never inherits an earlier dispatch's `contentId`. `lastFailure` stays until a later start succeeds. Late terminal
events from a superseded dispatch are ignored.

---

### 9.14 `OutcomeRecord` (client-side, RELY.1a–RELY.6a)

The one outcome store (`cast/dispatchReducer.js`, owned by `DispatchProvider`).
One record per attempt at one target:

```
{ attemptId, targetId, kind, phase, item: { contentId, title }, command, snapshot,
  reason, createdAt, updatedAt, distance, replacement?, ordinal?, undo? }
```

- `distance`: `far` (a dispatch to another screen, with wake progress),
  `here` (this device, quiet), `direct` (a Remote queue edit on another screen).
- `phase`: `running` · `sent` · `confirmed` · `unconfirmed` · `failed` ·
  `not-sent` · `skipped`, plus `waiting` / `library-unavailable` for a local
  item whose file the server refuses to read (Skip now via `skipLocal`). For far records it is derived from the dispatch
  status and the trailing watchdog step; a failure before delivery
  (`power`/`verify`/`prepare`/`input`, or an offline/not-connected error) is a
  terminal `not-sent`.
- `command` is a frozen deep copy of the replay input. `retry(attemptId)`
  replays exactly it at exactly `targetId` (fan-out siblings are separate
  records) and retires the record it replayed; `sendElsewhere(attemptId,
  targetId)` replays it at another screen. Replay inputs live only as long as
  their record. Nothing is ever replayed automatically.
- Late homeline steps update a record only when their topic names the same
  `targetId`.
- Replacement: a newer confirmation of the same kind for the same target drops
  settled confirmations (never a running action, which still owns its Undo); one `unconfirmed` per screen (newest wins); failures
  are never replaced. An `unconfirmed` play clears to `confirmed` (reason
  `screen-reported-playing`) when that screen's fresh `device-state` reports
  the same `contentId` playing.
- `undo: { operationId, expiresAt, run }` puts Undo on the row while the
  ten-second window is open. After it, a far record still `running`/`sent`
  offers Stop (`stopAttempt(attemptId)` → that screen's `transport.stop`,
  which keeps its queue — O1).
- The tray announces the newest record through one polite live region
  (`media-outcome-announcer`).
- Placement: the tray hangs from a zero-height anchor (`media-outcome-anchor`)
  directly above the mini player (or tab bar) and floats over the canvas; it
  takes no layout space, and only each row's own controls take pointer input.

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
| `session.restored-paused` | info | A restored session is held paused (no Player). | `sessionId`, `contentId`, `position`, `queueLength` |
| `session.restore-released` | info | The hold ended. | `sessionId`, `reason` (`play`, `load_item`, …) |
| `session.restore-discarded` | warn | Persisted session discarded. | `reason` (`schema-mismatch` \| `malformed`) |
| `session.start-fresh` | info | Itemised Start fresh confirmed. | `sessionId`, `kept[]`, `cleared[]` |
| `session.state-change` | debug | Session state transition. | `from`, `to` |
| `session.persisted` | debug | State flushed. | `size` |
| `queue.mutated` | debug | Queue modified. | `op`, `queueItemId?`, `contentId?`, `queueSize` |
| `player.host-changed` | info | Active player host claim changed (park ↔ dock ↔ Now Playing). | `reason`, `claimant`, `from`, `to`, `parked`, `claimCount` |
| `playback.started` | info | First progress after load. | `contentId`, `format`, `ttfpMs` |
| `playback.stalled` | warn | Stall detected. | `contentId`, `stalledAt`, `stallDurationMs` |
| `playback.error` | error | Load/play error. | `contentId`, `error`, `code` |
| `playback.advanced` | info | Auto-advance fired. | `reason`, `fromContentId`, `toContentId` |
| `playback.problem` | warn | Local item failed, was skipped, or is waiting on a refused file (RELY.5a). | `kind` (`skipped`\|`failed`\|`waiting`\|`library-unavailable`), `reason` (`stalled`\|`error`\|`file-unavailable`\|`source-unavailable`), `contentId`, `replacementContentId` |
| `playback.recovered` | info | Problem cleared (playing again, file restored, skipped by person, Start fresh, dismissed). | `contentId`, `reason` |
| `outcome.skipped` | info | Skip now on a waiting local item. | `attemptId` |
| `search.issued` | debug | Search query sent. | `text`, `scopeKey` |
| `search.result-chunk` | debug | One SSE results event. | `source`, `itemCount` |
| `search.completed` | info | Search stream ended. | `totalMs`, `resultCount` |
| `dispatch.initiated` | info | Dispatch started. | `dispatchId`, `deviceId`, `contentId`, `mode` |
| `dispatch.step` | debug | Wake-progress event. | `dispatchId`, `step`, `status`, `elapsedMs` |
| `dispatch.succeeded` | info | Dispatch succeeded. | `dispatchId`, `totalElapsedMs` |
| `dispatch.failed` | warn | Dispatch failed. | `dispatchId`, `failedStep`, `error` |
| `outcome.recorded` | info | An outcome record was created (far or local). | `attemptId`, `targetId`, `kind`, `phase`, `contentId` |
| `outcome.resolved` | info | Watchdog/queue step or local result resolved it. | `attemptId`, `targetId`, `step?`, `status?`, `phase?` |
| `outcome.cleared` | info | Unconfirmed start cleared by the screen's own playing state. | `attemptId`, `targetId`, `contentId`, `reason` |
| `outcome.retried` / `outcome.sent-elsewhere` | info | Retry / another screen for one attempt. | `attemptId`, `targetId` / `fromTargetId` |
| `outcome.stopped` / `outcome.stop-failed` | info / warn | Stop on an in-flight far start (O1). | `attemptId`, `targetId` |
| `outcome.undo` / `outcome.undo-failed` | info / warn | Undo from an outcome row. | `attemptId`, `operationId` |
| `outcome.dismissed` | debug | Row dismissed. | `attemptId`, `phase` |
| `ws.reconnecting-shown` / `ws.reconnecting-cleared` | info | Quiet reconnecting note (RELY.7a/AC4). | `graceMs` |
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

Screen session controls (component `ScreenSessionControls` / `ScreenSessionControlsHost` /
`ScreenContinuation` / `ScreenCommands`, screen side; `session-control.*` and
`device-start-status.*` backend side):

| Event | Level | Emitted when | Key fields |
|---|---|---|---|
| `setting.changed` | info | Add only / end-of-queue / stop-after-current set. | `ownerId`, `setting`, `value` |
| `commands.add-only-applied` | info | A remote Play was applied as an Add. | `commandId`, `requestedOp`, `contentId`, `origin` |
| `note.recorded` | info | A screen note was made or grouped. | `kind`, `count`, `origin`, `contentId` |
| `put-back.restored` / `put-back.refused` / `put-back.failed` | info/warn | Put it back outcome. | `noteId`, `contentId`, `code` |
| `sleep-timer.set` / `.fading` / `.stopped` / `.cancelled` / `.resumed` | info | Sleep timer lifecycle. | `mode`, `minutes`, `setPosition`, `resume` |
| `countdown.started` / `countdown.ended` | info | Next-episode countdown. | `current`, `next`, `reason` |
| `stop-after-current.stopped`, `end-of-queue.repeat`, `end-of-queue.similar` | info | Natural-end policy decisions. | `contentId` |
| `continuation.resolved` / `.no-container` | info | Similar batch resolution. | `parentId`, `containerId`, `kind`, `batch` |
| `auto-continue.added` / `.nothing-similar` / `.abandoned` / `.refill` | info | Auto-continue outcomes. | `count`, `contentIds`, `operationId` |
| `power-restore` / `power-restore.skipped` | info/warn | Cold-start re-adoption. | `ok`, `contentId`, `position`, `savedAt` |
| `media.restore-snapshot` | info/warn | Screen adopted a restore snapshot. | `reason`, `autoplay`, `ok`, `code` |
| `natural-end-policy-handled` (playback log) | info | Player deferred to the screen policy. | `assetId`, `hasNext` |
| `session-control.session` (backend) | info/warn | Session action outcome. | `deviceId`, `action`, `ok`, `code` |
| `device-start-status.changed` (backend) | info/warn | Start status phase change. | `deviceId`, `dispatchId`, `phase`, `error` |
| `session-controls.command` / `.result` / `.failed` | info/warn | A session control pressed for this device or a screen (sleep timer, countdown, stop after this one, Add only, end of queue, Put it back). | `target` (`local` \| deviceId), `action`, `value`, `code` |
| `session-controls.sleep-timer` / `.countdown` / `.end-of-queue` | info | This device's controls changed state (set, fading, stopped, cleared; countdown started/ended; similar added / nothing similar / stopped after current). | `target`, `state`, `mode`, `minutes`, `code`, `count` |
| `session-controls.natural-end` | info | This device's natural end was consulted. | `contentId`, `nextContentId`, `decision` (`session-controls` \| `advance`) |
| `media-session.bound` / `.unavailable` / `.action` / `.failed` | info/warn | Lock-screen / system controls for local playback. | `actions`, `action`, `seekTime`, `error` |
| `add-to-queue.opened` / `.closed` | info | Add to this queue opened from a Remote / closed (`added` \| `dismissed`). | `deviceId`, `reason`, `contentId` |
| `line-up.requested` / `.failed` | info/warn | Line up with another screen. | `target`, `withId`, `contentId`, `seconds` |
| `aim.drift-warned` | info | Several screens chosen in one or neighbouring rooms (or the registry was unreadable). | `targetIds`, `rooms`, `neighbouringRooms`, `state` |
| `screen-move.initiated` / `.succeeded` / `.failed` | info/warn | Move to… between screens / to this device. | `sourceId`, `destinationId`, `operationId`, `path`, `status`, `reason`, `sourceStopped` |

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
- **Versioning and shape (RELY.7a):** on load, a mismatched `schemaVersion`
  (`'schema-mismatch'`) or a record that is not valid JSON or whose snapshot is
  not restorable (`'malformed'` — `isRestorableSnapshot` in `persistence.js`:
  session id, state, current item id, finite non-negative position, queue items
  with ids, in-range `currentIndex`, `shuffle`/`repeat` config, `meta`) is
  discarded, removed, and logged (a bad resume spot is not structural: it is
  coerced to 0) (`session.restore-discarded`, `session.reset`
  with the reason). Nothing is guessed at.
- **Paused restore (RELY.7a):** a restorable session with a current item comes
  back with `state: "paused"` (from `playing`/`buffering`/`stalled`/`loading`)
  and *held*: `controller.restore.isHeld()` is true and `PlayerBridge` does not
  mount the Player at all, so no media is requested and nothing can sound. Only
  an explicit Play (or a new LOAD/ADOPT/STOP/RESET) releases the hold; a seek
  while held moves the restored spot. Play then mounts once at the restored
  position. `wasPlayingOnUnload` is still written for compatibility and never
  causes autoplay. Navigation (URL + `history.state.mediaNavStack`) and the aim
  (`media-app.cast-target`, two-hour idle expiry) restore through their own keys.
- **Reset / Start fresh (RELY.8a):** `lifecycle.reset({ keep: { playing,
  queue, spot } })` clears whatever is not kept. Clearing everything starts a new
  session and removes `media-app.session` and `media-app.url-command-token`
  (other keys preserved). Keeping the queue but not what's playing removes the
  current entry and stops; keeping what's playing but not the queue leaves only
  the current entry; a spot is kept only with what's playing, otherwise the
  position returns to 0. The aim is cleared by the dialog through
  `clearTargets()` when ticked.
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
