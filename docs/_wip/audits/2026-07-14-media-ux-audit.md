# /media UX Audit — "Casting Bluey" incident (2026-07-14)

**Trigger:** Family cast Bluey to the living-room TV from `https://daylightlocal.kckern.net/media`.
It technically worked, but the experience was graded "D-minus": ugly UI, slow search,
irrelevant results ranked above the obvious match, no way to see or control the TV after
casting, confusing technical checkboxes, kebab-case device IDs.

**Verdict: every complaint corroborated** — from prod logs, live API probes against the
running system, and code. The monitoring/control layer isn't just awkward; it is
**dead in production** (four half-built layers, none connected end-to-end).

---

## 1. The session, reconstructed from logs (2026-07-14 ~17:58 UTC)

| Time | Event | Evidence |
|---|---|---|
| 17:58:27 | Mac Chrome opens `/media` | `frontend-start {path:"/media"}` |
| 17:58:30.7 | Types "bluey", search starts | `search.started` |
| 17:58:36.9 | **First results after 6.1s**: `files` ×4 (fitness-recording junk) | `search.results-received {source:"files",newItems:4}` |
| 17:58:36.93 | Plex's 1 result — **"Bluey (2018)", the obvious match — appends BELOW the 4 junk rows** | `search.results-received {source:"plex",newItems:1}` |
| 17:58:38.8 | Search "completes" at **8.07s**; `abs` + `singalong` timed out at 8000ms | `content-query.searchStream.complete {totalMs:8065, adapterCount:16}` |
| 17:58:52 | User casts `plex:59493` → `livingroom-tv`, mode `transfer` | `dispatch.initiated` |
| 17:58:52–17:59:10 | Dispatch steps: power 6s → verify → volume → prepare 12s → load. **Total 18.1s** | `dispatch.succeeded {totalElapsedMs:18087}` |
| 17:59:12 | Shield starts playing the episode (`plex:347695`) | `playback.started` (Shield UA) |
| 18:00:40 | **`dispatch.step playback status:timeout`** — the sender was never told playback actually started, despite 60fps render logs the whole time | `wake-and-load.playback.timeout` |

User then had **no way to monitor or control playback**: Fleet showed all three devices as
`unknown / —` while the TV was actively playing (live-verified during this audit: 60
`render_fps` events in 5 min, **zero** `device-state` events in 30 min).

## 2. Root causes, by complaint

### "Search was too slow" — CONFIRMED, two causes
- **Flat 8s per-adapter timeout, 16 adapters, spinner until the last one.**
  `ContentQueryService` default `adapterTimeoutMs = 8000`
  (`backend/src/3_applications/content/ContentQueryService.mjs:39`), never overridden in
  composition (`contentApi.mjs:88`). `abs`/`singalong` time out at exactly 8000ms on every
  query. The frontend keeps `isSearching` true until the SSE `complete` event
  (`frontend/src/hooks/useStreamingSearch.js:89-92`) → "Searching…" for the full 8s.
- Live probes during this audit: `beatles` 7.3s, `hey jude` 5.0s, `frozen` 4.1s — the
  slowness is systemic, not a one-off. Even the *fastest* adapter took 6.1s to first
  paint in the Bluey session.

### "Obvious Bluey below irrelevant results" — CONFIRMED, ranking is entirely absent in the used path
- The UI calls the **streaming** endpoint, which yields per-adapter results in
  **completion order** and the frontend **appends** them unsorted
  (`useStreamingSearch.js:86`, `SearchResults.jsx:7`,
  `ContentQueryService.searchStream` :220-335 — no scoring, no merge).
- A complete `RelevanceScoringService` (+20 exact title, +10 starts-with, ID-match
  pinning) exists and works — but is wired **only** to the non-streaming `search()` the
  UI never calls. Live proof: `GET /api/v1/content/query/search?text=bluey` returns
  **"Bluey (2018)" at sortOrder 0**. The engine is right; the UI calls the wrong path.

### "Couldn't monitor or control it after casting" — CONFIRMED, the layer is dead end-to-end
Four independent breaks, any one of which kills it:
1. **No screen publishes state.** `SessionStatePublisher` mounts only when screen YAML
   sets `websocket.publishState: true` (`ScreenSessionPublishers.jsx:20`). **No screen
   YAML sets it** (living-room.yml has only `commands: true`). Known since the
   2026-04-25 wake-and-load audit; never fixed.
2. **Even if flipped on, it would lie.** `SessionSourceContext` has **no provider
   anywhere** — the publisher would fall back to `createSessionSource({ownerId})` with
   no player/queue wired and broadcast **idle** while Bluey plays
   (`SessionStatePublisher.jsx:20-25`, `SessionSource.js:141-144`).
3. **Remote-control endpoints 501 in prod.** `SessionControlService` is **never
   constructed** in `app.mjs` — `createDeviceApiRouter` and `createWakeAndLoadService`
   are built without it, so every `/device/:id/session/*` call returns
   `501 Session control not configured` (live-verified). PeekPanel's pause/stop/skip
   buttons would all fail. *(Fixed in this branch: app.mjs now constructs and injects it.)*
4. **`useScreenPresencePublisher` is mounted nowhere** (zero `screen.presence`
   traffic live) — even the coarse "is something playing" boolean never flows.

Plus UX: casting never navigates to any monitoring view (`CastButton.jsx:35-38` just
closes the popover), the progress tray self-clears, and Fleet is reachable only by
manually clicking a nav item that then shows `unknown / —`.

### "Playback confirmation timed out even though it played" — CONFIRMED, structural
The trailing `playback` dispatch step matches `playback.log` contentIds by string
hierarchy (`plex:59493:` prefix, `WakeAndLoadService.mjs:740-770`) — but Plex resolves a
show container to a **flat** episode key (`plex:347695`), which can never prefix-match.
Container dispatches therefore *always* report `playback: timeout`.

### "Kebab-case IDs and technical checkboxes" — CONFIRMED
- `devices.yml` has **no `name`/`location` field on any device**; the UI renders
  `d.name ?? d.id` → `livingroom-tv` verbatim (`DispatchTargetPicker.jsx:29`,
  `CastTargetChip.jsx:71`, `FleetView.jsx:44`, `DispatchProgressTray.jsx:38`). No
  humanizer fallback exists.
- The cast dialog is a **settings-form**: raw HTML checkboxes per device + a mandatory
  radio choice between "Transfer (local stops)" and "Fork (local keeps playing)" —
  developer jargon for a decision most users never asked to make.
- Raw internals leak throughout: source ids in result subtitles (`ResultRow.jsx:47-51`),
  `<code>{contentId}</code>` in the result peek, raw dispatch step names and device ids
  in the progress tray, engine states ("stalled") as body text, "Searching (abs,
  singalong)…".

### "Ugly / layout nonsensical" — CONFIRMED with specifics
- Browse is **artwork-free text rows**; search rows have 44px square thumbs (no poster
  aspect); the amber primary button "Play Now" plays **in the browser tab**, not on a TV —
  the actual family use-case (cast to TV) is the buried secondary path (~6 steps).
- Nav says **"Fleet"**, the page it opens says **"Devices"**; "Take Over", "Hand off",
  "Transfer/Fork" are user-facing; Now Playing highlights no nav item.
- No `:focus-visible` styling anywhere; native unstyled checkboxes/radios/select on a
  dark themed app; 11-12px dim text; no TV/kiosk layout tier; empty home on first run,
  with a **developer instruction as the empty-state copy** ("Add `browse` entries to the
  media app config").

## 3. Fleet coverage gap (user-flagged)
Fleet lists only devices with `content_control` in devices.yml: `livingroom-tv`,
`office-tv`, `yellow-room-tablet`. Missing surfaces the household actually plays media
on: **garage TV** (fitness display, Firefox kiosk), **playback-hub Bluetooth speaker
lanes** (`_extensions/playback-hub/` — already broadcasts `playback-hub:status`!), and
the **piano kiosk** identity of the yellow-room tablet. None publish `device-state`.

## 3.5 Adversarial persona walkthrough (live server) — additional critical findings

A persona-driven walkthrough against the running server (while Bluey played) found the
front door is broken too:

1. **All four Home "Browse" cards are dead ends** (live): `plex/audio`, `plex/video`,
   `singalong` return `items: []`; `readable` → 404 "Unknown source". The home page's
   entire catalog surface is non-functional.
2. **The "Browse" nav tab itself 404s**: it pushes `path: ''` → `GET /api/v1/list/` →
   red alert "HTTP 404: Not Found - Not Found" (`PrimaryNav.jsx:12`,
   `useListBrowse.js:10`, `BrowseView.jsx:51`).
3. **Songs are unsearchable**: Plex search never returns track-type items ("hey jude" →
   0 results; "yesterday" → 23 audiobooks). A music app that can't find songs.
4. **"Play album" plays one track and stops**: no container expansion in the local
   session (`session/*`, `advancement.js`); `GET /api/v1/play/plex:556868` returns a
   single track (live).
5. **`GET /api/v1/list/plex` returns `plex:undefined` ids** for every library (live).
6. **Search result soup**: audiobooks and music albums both labeled "album • plex"
   (`librarySectionTitle` is in the payload, never rendered); cross-source duplicates
   (plex+abs pairs); duplicate React keys from the files source.
7. **Private fitness recordings of the kids outrank the actual show** in "bluey" search,
   duplicated, titled with raw filenames (`20260620191341_17m_milo-felix_bluey-2018`).
8. **The playback watchdog's failure signal can never reach the UI**: the tray row is
   deleted 3s after "done" and `dispatchReducer.js:25` drops STEP events for unknown
   dispatchIds — the one alarm designed to catch silent cast failure is structurally
   unreachable (and false-fires on container dispatches anyway, see §2).
9. **Peek Pause lies**: optimistic "paused" over a silent 501/unhandled rejection, then
   silently reverts after 5s (`PeekPanel.jsx:58`, `useStatusOverlay.js`).
10. **No busy-guard on cast**: dispatching to a TV mid-show nukes the kids' show with
    zero warning.

Also noted as genuinely good bones: persistent mini player, real loading/empty/error
states throughout, live step-by-step dispatch progress ("it just speaks C++").

## 4. Fix plan (tasks tracked in-session)
1. ✅ **Wire `SessionControlService`** in `app.mjs` (done in this branch; unblocks all
   `/session/*` remote control).
2. **Bridge real playback state → `device-state`**: provide a real SessionSource on
   screen-framework screens (nav-stack Player + ActionBus are the integration points),
   set `publishState: true` + mount presence publisher; backend adapter translating
   `playback-hub:status` → `device-state:*` for speaker lanes; publishers for
   fitness/piano surfaces.
3. **devices.yml: `name`, `location`, `icon` per device** + frontend humanizer fallback
   so a raw id can never render.
4. **Search**: rank streamed results (reuse `RelevanceScoringService` scoring, sort on
   the client as batches arrive), cut adapter timeout to ~3s, stop gating "done" on
   stragglers, humanize source names.
5. **Cast flow**: tap-a-device tiles (name + icon + live state), plain-language mode
   copy, friendly progress, **auto-navigate to the device's remote view on success**.
6. **Design pass**: posters/artwork, styled controls, focus states, jargon purge,
   consistent naming, empty states, TV-size layout.
7. **Fix container playback confirmation** (match by device rather than contentId
   prefix, or resolve container→episode before arming).

## Appendix: evidence sources
- Prod container logs 2026-07-14 (search timings, dispatch steps, render_fps vs
  device-state absence).
- Live API probes: `/device/livingroom-tv/session` → 501; ranked search returns Bluey #1
  in 5.2s; streaming search 4-8s across five test queries.
- Four parallel code audits (search, cast, monitoring, design) + composition-root trace;
  file:line citations inline above.
- Prior art: `docs/_wip/audits/2026-04-25-wake-and-load-ws-fast-path-disabled-audit.md`
  already documented the `publishState` gap.
