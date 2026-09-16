# DaylightStation Media Surfaces as First-Class Plex Clients

> **Goal (the user's framing):** our media surfaces *are* Plex clients, not an
> integration that reports facts to Plex after the fact. Each surface — living
> room, garage, piano kiosk, office, portal — is its own registered device.
> Everything downstream (admin dashboard, watch history, Tautulli, per-device
> stats, Continue Watching) then works for free, because our screens stop being
> a special case.

**Status:** design. Not implemented.
**Date:** 2026-09-16

---

## 1. What is already proven

Every claim below was verified live against this household's Plex on 2026-09-16,
not inferred. Where something is unproven it is labelled so explicitly.

| Claim | Evidence |
|---|---|
| `/:/timeline` with `state=playing` creates a **live session** | `/status/sessions` went `size="0"` → `"1"` → `"0"` on `state=stopped`, twice |
| **A play queue is NOT required** | Session created with only `ratingKey`, `key`, `state`, `time`, `duration` + identity headers |
| Session carries full metadata Tautulli needs | `sessionKey`, `viewOffset`, `<Media>/<Part>/<Stream>`, `<User id="1" title="kckern">` |
| Per-surface identity is fully controllable | `<Player machineIdentifier="daylight-livingroom-tv" title="DaylightStation" product="DaylightStation" version="1.0" state="playing">` |
| `/:/scrobble` marks watched **and** writes a history row | `viewCount=1` + `lastViewedAt` set; row `384715` in `metadata_item_views`, attributed to our device |
| A stable client identifier does **not** grow the device table | `devices` totalSize held at 7015 across repeated sessions |
| `play/log` cadence suits a heartbeat | median **3.7 s**, max **21.5 s** (n=57) |
| `req.deviceId` is available for attribution | `deviceResolver` is mounted globally on `/api/v1` (`app.mjs:601`) |
| plex.tv is reachable | 302 from both host and the app container |

**Unproven, and it gates Requirement 1:** the PIN/OAuth flow that puts a device
in **Authorized Devices**. There is no Plex auth code anywhere in this repo, and
registration needs a human to authorize at `plex.tv/link`. Task 1 exists to
settle it before anything is built on top.

---

## 2. Requirements

1. **Authorized Devices.** Each surface holds its own account-level device token
   obtained through Plex's auth flow — not the server admin token passed as a
   query parameter. Revocable individually, like any other client.
2. **Live on the admin dashboard.** A real session exists *while* a child is
   watching, with the playhead advancing — not a retroactive record.
3. **Exposed to third parties.** Tautulli (and anything else reading
   `/status/sessions` or the websocket) sees the session, records it, and
   attributes it to the right player at `tautulli.kckern.net/history`.
4. **Per surface.** Living Room TV, Garage Gym TV, Office Screen, Piano Tablet
   and Portal each appear as their own device, under their own display name.

---

## 3. Prerequisite: Tautulli is currently broken

Independent of this feature. Tautulli's stored `pms_token` does not match the
server's (both 20 chars, different hashes), producing **961 × 401 and zero
successful** `/status/sessions` calls across every retained Plex log, plus
WebSocket handshake 401s every ~30 s. `session_history` is therefore empty —
it is recording nothing **for anyone**.

Requirement 3 cannot be demonstrated until that is fixed, and Tautulli does not
backfill: it only records what it observes live.

---

## 4. Scope: which surfaces

From the existing playback-surface definition in `useDevices.js`
(`content_control || fleet === true`), minus audio sinks:

| Device id | Display name | Icon | Type |
|---|---|---|---|
| `livingroom-tv` | Living Room TV | 📺 | shield-tv |
| `garage-tv` | Garage Gym TV | 🏋️ | linux-pc |
| `office-tv` | Office Screen | 🖥️ | linux-pc |
| `yellow-room-tablet` | Piano Tablet | 🎹 | android-tablet |
| `portal` | Portal | 🖼️ | android-tablet |

The five musiCozy/10-SYNC **speakers are excluded**: they are audio sinks
controlled by the playback hub, not surfaces that run our Player.

---

## 5. Identity: declared, never discovered

Per the instruction that generated IDs may be hard-coded, and matching the
convention `devices.yml` already states for `video_call` and `play_observation`,
each surface declares its Plex identity. Nothing is minted at runtime.

```yaml
livingroom-tv:
  name: Living Room TV
  icon: "📺"
  plex:
    client_identifier: 9f2c1e80-3b77-4f2e-9a41-6d2b8c5e1a03  # pre-generated, stable forever
    product: DaylightStation
    version: "1.0"
    platform: DaylightStation
    device: Living Room TV      # becomes <Player title>, what the dashboard shows
```

`client_identifier` is the Plex `machineIdentifier` and the primary key of the
device's identity. It must never change: a new value is a new device row and a
new Authorized Devices entry.

Per-surface **tokens** are secrets and do not belong in `devices.yml`. They
follow the established per-device auth convention (`fullykiosk-piano.yml`):
`data/household/auth/plex-<device-id>.yml`, holding `token:` only.

**Display names are already solved and must be used.** All 19 devices already
carry `name` and `icon`; `/api/v1/device/` and `/api/v1/admin/household/devices`
already serve them. No YAML work is needed for names.

---

## 6. Architecture

Layering per `docs/reference/core/layers-of-abstraction/ddd-reference.md`.
Dependencies point inward; adapters import domains, application-owned ports and
system utilities only — never API, peer adapters or config singletons.

### Domain — `2_domains/media/`

- **`entities/PlaybackSession.mjs`** — the session aggregate. Identity is
  `(surfaceId, contentId)`. Holds `state` (`playing` | `paused` | `stopped`),
  `positionMs`, `durationMs`, `lastHeartbeatAt`. Controlled mutation:
  `advance(positionMs, at)`, `pause(at)`, `resume(at)`, `stop(at)`,
  `isStale(now, ttlMs)`. Pure — no clock, no I/O; timestamps are parameters.
- **`value-objects/PlexClientIdentity.mjs`** — immutable, self-validating:
  `{ clientIdentifier, product, version, platform, device }`. Rejects a blank
  or non-stable identifier. Frozen.

Both are universal truths about "a media session on a surface" and carry no
Plex HTTP knowledge.

### Application — `3_applications/content/`

- **`ports/IPlaybackSessionGateway.mjs`** — outbound port, named per the
  `I{Noun}Gateway` convention and sitting beside the existing
  `IRemoteProgressProvider`:
  ```
  openSession(identity, session)
  heartbeat(identity, session)
  closeSession(identity, session)
  markWatched(identity, contentId)
  ```
- **`usecases/ReportPlaybackSession.mjs`** — orchestration only. Resolves the
  surface's identity, loads/creates the `PlaybackSession`, applies the domain
  transition, calls the port. Receives the port, never the adapter.

### Adapter — `1_adapters/content/media/plex/`

- **`PlexSessionAdapter.mjs`** — implements the port; the only place that knows
  `/:/timeline` and `/:/scrobble` and the `X-Plex-*` header vocabulary. This is
  the anti-corruption layer: domain terms in, Plex wire format out.
- **`PlexClient.mjs`** — gains its first write method. It is GET-only today
  (`request()` calls `httpClient.get`). `HttpClient` already exposes
  `post`/`put`, so this is additive.

### Composition — `5_composition/`

- **`modules/ConfigDeviceBlueprintFactory.mjs`** — surface the declared block as
  `descriptor.plexClient`, beside the existing `name`/`icon`/`videoCall` fields.
- **`modules/contentApi.mjs`** — wire the adapter into the use case, exactly
  where `playbackReadService` and `progressSyncService` are wired today.

### Not used, deliberately

- **`playback-hub`** — `HubDevice` models a *physical speaker slot*
  (identity `SlotColor`, with `mac`, `haEntityId`, `volumeBounds`). It is not a
  screen and not a session. Wrong home.
- **`ProgressSyncService` / `progressSyncSources` / `resolveProgressConflict`** —
  this is one-way. We never let Plex overwrite our state, so a phone finishing an
  episode can never mark a piano lesson or school item complete on our side.

---

## 7. Session lifecycle

There is **no session concept today** — only four scattered `play/log` call
sites (`useCommonMediaController.js:860` and `:1340`,
`ContentScroller.jsx:218`, `useMediaKeyboardHandler.js:238`), none of which
sends a device id and none of which is a clean "opened" signal. Rather than
refactor all four, the backend derives the lifecycle from the progress stream.

| Trigger | Domain transition | Plex call |
|---|---|---|
| First `play/log` for a (surface, content) pair | create, `playing` | `/:/timeline?state=playing` |
| Subsequent `play/log` | `advance(positionMs)` | `/:/timeline?state=playing&time=…` |
| Keepalive timer (~10 s) with no new ping | `advance` (unchanged position) | `/:/timeline?state=playing` |
| `naturalEnd: true` / `status: completed` | `stop` | `/:/timeline?state=stopped` then `/:/scrobble` |
| `play/log` arrives for the **same surface, different content** | `stop` the prior session, then open the new one | `state=stopped` for the old, `state=playing` for the new |
| No ping for > 60 s | `stop` (reaper) | `/:/timeline?state=stopped` |

A surface holds **at most one open session**. Because session identity is
`(surfaceId, contentId)`, a child switching stories would otherwise leave the
previous session open until the reaper caught it — showing two things playing on
one screen. Superseding is explicit, not left to the timeout.

The keepalive exists because the measured ping tail reaches **21.5 s**, beyond
Plex's ~15 s expectation; heartbeats must not depend on client pings alone.

**Attribution fix:** `play.mjs:84` currently calls
`recordPlaybackProgress.execute(req.body)`, discarding `req.deviceId`. It must
thread the resolved surface id through, or no session can be attributed.

---

## 8. Display names in the UI

Already-available data that consumers ignore — the `ConfigDeviceBlueprintFactory`
comment says as much: devices.yml *"has carried `name`, `location` and `icon`
from the start; nothing read them."*

- `DevicesIndex.jsx:153` renders `{device.id}` though `device.name` is on the
  same object → `{device.name || device.id}`, with the icon beside it.
- `VirtualConsole.jsx:300` renders `{d.target}` (a devices.yml id) → resolve
  through the device list.

**Rule:** a kebab id may be the canonical key, but it must never be what a person
reads. This has regressed before — `CallApp.jsx:218` documents *"the defect that
put 'yellow-room-tablet' on screen."*

---

## 9. Tasks

1. **Settle registration.** Obtain one device token via the PIN flow for a single
   surface and confirm it appears in Authorized Devices. Everything else depends
   on this; if it cannot work headlessly, registration becomes a one-time admin
   action per screen and the spec's §5 token storage still holds.
2. Fix Tautulli's `pms_token` (prerequisite for Requirement 3).
3. Add `plex:` blocks to the five surfaces; surface them via the blueprint.
4. Domain: `PlaybackSession`, `PlexClientIdentity` + unit tests (pure).
5. Port + `PlexSessionAdapter` + `PlexClient` write method.
6. `ReportPlaybackSession` use case + fake-port tests.
7. Thread `req.deviceId` through `play.mjs` → `RecordPlaybackProgress`.
8. Keepalive + stale-session reaper.
9. Display-name fixes (§8).
10. Verify end to end: a real play on the living room TV appears on the Plex
    dashboard as "Living Room TV", and lands in Tautulli history.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| PIN flow may need per-device human authorization | Task 1 settles it first; treat as one-time admin setup |
| Sessions add writes to Plex | Bounded: one open + ~4/min heartbeat + one close per play. The statistics-lock incident (2026-09-16) was caused by 74k device rows, not write volume; stable identifiers keep the table flat — verified |
| A crashed surface leaves a session open | Stale reaper (§7); Plex also times sessions out on its own |
| Per-surface tokens are secrets | Stored under `data/household/auth/`, never in `devices.yml`, never logged |
| Scope creep into bidirectional sync | Explicitly out (§6) |

---

## 11. Out of scope

- Bidirectional progress sync (Plex never writes our state).
- Per-child Plex accounts. Sessions attribute to the server account
  (`<User title="kckern">`). Plex Home users are a separate, larger question.
- Backfilling history. Neither Plex nor Tautulli will show past plays.
- The five speakers.
