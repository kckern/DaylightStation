# Arcade play-session observability — production audit

**Date:** 2026-09-12 (evening, both arcades in use)
**Scope:** Can the house see what is being played, where, and for how long, on
both emulator surfaces? Does it reach the event bus in a form a UI can
subscribe to? Where are the gaps, and do the two surfaces have parity?
**Surfaces:**
- `garage-tv` — in-browser EmulatorJS inside the Fitness app
  (`frontend/src/modules/Fitness/widgets/EmulatorGame/`)
- `livingroom-tv` — RetroArch on the Shield, watched from outside
  (`backend/src/1_adapters/gaming/RetroArchPlayObservationSource.mjs`)

**Related:** `docs/reference/gaming/play-sessions.md`,
`docs/_wip/plans/2026-09-11-arcade-time-observability.md`

---

## Method

Everything below was checked against what is **deployed**, not the laptop tree.
The deploy tree was 5 commits ahead of `origin/main` (Genesis / GBC / GBA
console work) with uncommitted emulator-catalog edits; the audit read that tree
with the uncommitted diff applied.

Evidence sources, all read-only:

| Source | What it answered |
|---|---|
| Log store (`{env.log_store_url}`), 3h / 24h / 7d windows | Which events exist, from which side, at what level |
| Live API `GET /api/v1/play-sessions/{health,devices/:id,usage,placement}` | What the meter believes right now |
| Kiosk REST `deviceInfo` on the Shield | Foreground app |
| ADB from inside the app container: `pidof`, `/proc/<pid>/stat` twice 10s apart, newest RetroArch session log | Whether RetroArch is emulating, and which ROM |
| Household data tree | Whether any session or intent was ever persisted |

---

## Live snapshot (~18:26 local)

| | Garage (`garage-tv`) | Living room (`livingroom-tv`) |
|---|---|---|
| Surface | EmulatorJS 4.2.3, Firefox kiosk | RetroArch (`com.retroarch.aarch64`) |
| **Actually playing** | *Sonic the Hedgehog* (Genesis), `playId play-0hwr7dfn`, since 01:16:43Z, controller input every ~20s | *Pokémon Crystal* (GBC, gambatte core), session log opened 18:26:13 |
| Proof of play | `emulator.input.summary` stream | RetroArch foregrounded; **156 CPU ticks in 10s** (~15.6/s = emulating) |
| Visible in the log store? | **Yes** — frontend `emulator.*` events carry game + system | **No** — only boot-time tracker lines; per-tick observations log at `debug` |
| Play session recorded? | **No** | **No** |
| `play-session:<id>` bus traffic | **None** | **None** |
| `device-state:<id>` shows the game? | No | No |
| `GET /play-sessions/usage` (7 days) | `sessionCount: 0` | `sessionCount: 0` |
| `GET /play-sessions/health` | n/a (not a tracked device) | `lastState: "playing"`, `degraded: false`, `consecutiveErrors: 0` |
| `GET /play-sessions/devices/livingroom-tv` | n/a | `session: null` |

The household `gaming/play-sessions/` directory **does not exist** on prod, and
neither does `gaming/play-sessions/intents/`. **No play session has ever been
recorded on either surface.** The metering pipeline is deployed and running, and
it has produced nothing.

---

## Short answers

- **How are the sessions going?** Both games are running fine. The meter has
  recorded neither.
- **Can you see what's playing where?** Garage: yes, but only through frontend
  diagnostic logs, not the meter. Living room: only by probing the device
  yourself. The meter observes "playing" and discards it.
- **Is it on the event bus?** The design publishes `play-session:<deviceId>`
  (`play.session.started|progress|ended`) and projects into
  `device-state:<deviceId>`. **Nothing is being published today**, because no
  session opens (F1, F2).
- **Could a UI subscribe?** Yes, once sessions open. `useWebSocketSubscription`
  / `wsService.subscribe('play-session:livingroom-tv', …)` or a
  `bus_command subscribe` (as `frontend/public/arcade-film.html` does) will
  receive it. Caveats in F5.
- **Parity?** No. Neither surface works, for different reasons, and the browser
  surface would under-report even once switched on (F3).

---

## Findings

Severity: **Critical** = the feature does not function; **High** = wrong or
invisible results once it does; **Medium** = latent or noisy.

### F1 — Critical — Living room: a hand-started game can never open a session

The arcade is used by walking up to the Shield and picking a game there. That
path is dropped at the first gate.

1. The tracker's only source of content identity is a launch **intent**
   (`PlaySessionTracker.mjs:99-101` → `expectedContent: intent?.content`).
2. Intents are written only by `AuthorizePlay` (the fingerprint
   authorize-here/redeem-there flow). No intent has ever been written.
3. With no intent, `RetroArchPlayObservationSource` returns
   `{ state: 'playing', content: null }`.
4. `RecordPlayObservation.mjs:83`:
   `if (state !== PlayState.PLAYING || !nowPlayingId) return result;`
   — a PLAYING observation with no content id **returns without opening a
   session**.
5. `NamePlaySessionContent` (which reads the device log to name a hand-started
   game) only runs when `result.session` exists (`PlaySessionTracker.mjs:115`),
   so it is unreachable on exactly the path it was written for.

`NamePlaySessionContent.mjs` and `play-sessions.md` both state that
hand-started play "is real and gets metered, but opens with no title". The code
contradicts that. Each unit is tested in isolation; the composition is not.

**Evidence:** `/health` says `lastState: playing` at the same moment
`/devices/livingroom-tv` says `session: null`; startup reconciliation warns
`play.session.unrecorded` for 7 device-logged sessions on every boot.

**Fixing it is more than deleting `!nowPlayingId`.** Two follow-on problems:

- **Switch detection treats "unknown" as "different".** Line 65 ends the open
  session whenever `nowPlayingId !== openContentId`. Once a session is named
  (`retroarch:gbc/pokemon-crystal…`), the next tick still carries
  `content: null` (still no intent), which reads as a switch and ends it as
  `quit`.
- **The source conflates "paused" with "nothing loaded".** Without an intent,
  in-game pause (CPU delta ≤ 2) and "RetroArch gone" both arrive as
  `{ state: 'paused', content: null }`. The use case reads `content: null` as
  "nothing is loaded" and ends the session, so every pause would end and every
  resume would restart a session.

The observation needs an explicit **loaded / not loaded** signal separate from
**identity known / unknown**. The source already has it: foreground + live pid
means loaded; sustained absence or no pid means not loaded. It just doesn't put
it on the observation.

### F2 — Critical — Garage: the reporter is never constructed

`EmulatorGameWidget.jsx:117-121`: with no `config.meterDeviceId` the widget
reports nothing, by design. **No household or system config sets
`meterDeviceId`.** The widget's `config` comes from `FitnessModuleContainer`,
which has no emulator config block to pass.

**Evidence:** zero `http.response` rows for `/api/v1/play-sessions/observations`
in 24h; no `play.*` events from the fitness frontend.

The Fitness app already holds an explicitly declared device id for this screen:
`FLEET_DEVICE_ID` in `FitnessApp.jsx`, set from the kiosk launch URL
`?device=garage-tv` and persisted. Using it as the meter id satisfies "declared,
never inferred" without a second declaration that can drift from the first.

### F3 — High — Browser surface would under-report even when switched on

Reading `playSessionReporter.js` and the widget effect against the backend
contract:

| Gap | Where | Consequence |
|---|---|---|
| **`paused()` is never called.** Governance pause (`EmulatorSession.js:96`, `emulator.governance.pause`) and the in-game menu keep the heartbeat sending `playing`. | `EmulatorGameWidget.jsx:130-137` | Paused time billed as play — breaks the rule the whole slice is built on |
| **The effect's cleanup ends the session on any dependency change.** `return () => reporterRef.current?.ended()` runs before every re-run, and `launch` changes on a save claim (`activateSave`). | `EmulatorGameWidget.jsx:140-141` | Claiming a save splits one play session into two (`quit` + new start) |
| **`userId` is fixed at open.** `RecordPlayObservation` never updates `userId` on an open session; games launch anonymous and are claimed later. | `RecordPlayObservation.mjs:84` | Garage play never attributed to the child who claims it (moot if the split above happens first) |
| **Content lacks `console` / `consoleLabel`.** | `EmulatorGameWidget.jsx:133` | Bus messages carry `system: null`, `placement: null` |
| **Content id namespace differs per surface:** `emulatorjs:gb/<id>` vs `retroarch:gbc/<id>`. | same | `usage.byTitle` splits one title into two rows |
| **Controllers not reported.** | reporter | `controllers: null` on every garage message |
| **Report failures log at `debug`.** | `playSessionReporter.js:51,54` | A 503/400 from the meter never reaches the log store |
| **`usePlayBudget` is not mounted anywhere.** | `usePlayBudget.js` | The garage has no countdown even when sessions exist |

### F4 — High — The living-room meter is invisible in the log store

The first question, "what is playing in the living room right now?", cannot be
answered from logs.

- **Per-tick observations log at `debug` or not at all.** The source logs only
  its failures, at debug (`RetroArchPlayObservationSource.mjs:124,147`); the bus
  announcer logs publishes at debug (`EventBusPlaySessionAnnouncer.mjs:117`).
  Nothing marks a state transition (unknown → playing → paused).
- **The watchdog can't see F1.** It checks stale / failing / degraded. A tracker
  that ticks cleanly and reports `playing` while every observation is discarded
  is "healthy". That combination needs a condition of its own, e.g.
  `play.watchdog.unrecordable`: PLAYING observed for N ticks with no open
  session.
- **Reconciliation repeats itself.** `ReconcilePlaySessions` re-warns the same
  device-log entries on every boot. 42 `play.session.unrecorded` warnings in 24h
  are 6 deploy restarts × 7 entries (36 of them the same *Super Mario Land*
  session), not 42 missed games. Repeated warnings like that get filtered out by
  anyone reading the logs.
- **Boot logs a false `error`.** Each start logs `adb.exec.error` ("device not
  found"): the container's ADB daemon starts cold, then `adb.shell.autoReconnect`
  recovers. Recovery isn't logged, so a healthy boot reads as a failure (6
  errors/day, all benign).
- **Fleet ingress for these devices isn't logged at info.** A 1h query for
  `device-state` activity on either TV returned nothing, so the log store can't
  show what the Media fleet view currently displays for them.

### F5 — Medium — Bus delivery: works for a subscribed UI, but noisy and without replay

`play-session:` is **not** one of the device-topic kinds in
`shared/contracts/media/topics.mjs` (`device-state`, `device-ack`, `homeline`,
`screen`, `command-handler-presence`). It takes the **legacy branch** of
`WebSocketEventBus.broadcast`:

- **Delivered** to clients subscribed to the exact topic or `*`. Every `/media`
  tab syncs as `*`, so it gets these too.
- **No subscriber:** `play-session:*` is not in `KNOWN_UNCONNECTED_TOPICS`, so
  every tick logs `bus.topic.unknown` (warn) and is dropped: ~6 warnings/min per
  device whenever the overlay page isn't connected.
- **With a subscriber:** every tick logs `eventbus.broadcast` at **info**.
- **No replay on subscribe.** Only `device-state:*` replays the last snapshot,
  so a UI mounting mid-game shows nothing until the next progress tick (≤10s
  living room; never for a garage session paused at the time).
- **No house-wide topic.** An "arcade now" panel must subscribe per device or to
  `*`, or poll `GET /api/v1/play-sessions/devices/:id`. There is no
  list-all-open-sessions endpoint.

**Plausible, not verifiable yet — two writers on `device-state:livingroom-tv`.**
`FleetPlaySessionAnnouncer` publishes game snapshots on the same topic the
living-room screen page's `SessionStatePublisher` heartbeats every 5s while
mounted. RetroArch covers the page but doesn't unmount it. If that heartbeat
keeps firing, the fleet view will flap between the game and idle. It can't be
observed until F1 is fixed, because no game snapshot has ever been published.

**Garage fleet view:** `FitnessFleetPublisher` binds only the fitness video
player, so `/media` shows the garage as idle (or the workout video) while a game
runs.

### F6 — Medium — Browser metering depends on a Shield being declared

`createPlaySessionTracking` returns `recordObservation: null` when no device
declares `play_observation`, or when `games.launch.package` is missing
(`playSessions.mjs:141-154`). The self-reporting ingress then answers
`503 Play-session metering is not configured`. Garage metering works today only
because the Shield is declared; removing the Shield, or a games-config typo,
would disable metering for a surface that has nothing to do with RetroArch.

### F7 — Low — Transient

- `GET /play-sessions/{health,devices/livingroom-tv,eligibility}` returned **404**
  once today, from a probe against an earlier deploy. All answer 200 now.
- One `fullykiosk.rest.response TIMEOUT` (10s) on `deviceInfo`. Handled as
  `unknown`, as designed.

---

## Parity matrix

| Capability | Browser (garage) | RetroArch (living room) |
|---|---|---|
| Knows a game is loaded | ✅ exact | ✅ foreground + pid |
| Knows **which** game | ✅ exact | ⚠️ only via intent (never written) or device log (unreachable, F1) |
| Knows playing vs paused | ⚠️ knows, doesn't report (F3) | ✅ CPU delta |
| Opens a session today | ❌ reporter off (F2) | ❌ dropped (F1) |
| Emulated system / bezel placement | ❌ not sent | ✅ once named |
| Controllers counted | ❌ | ✅ via ADB probe |
| Attribution | ⚠️ fixed at anonymous launch | ⚠️ intent only |
| On-screen countdown | ❌ hook unmounted | ✅ overlay armed on session start (never triggered) |
| Diagnostic logs in the store | ✅ rich (`emulator.*`) | ❌ debug-only |
| Failures visible | ❌ debug | ⚠️ boot error noise, dropped play not flagged |
| `device-state` projection | ❌ fleet shows video player | ✅ designed, never fired |

Neither surface meets FR-5 ("one contract, both surfaces") in practice.

---

## Remediation order

1. **F1** — Add `loaded` to the observation contract, separate from content
   identity. Open on `playing + loaded` with unidentified content, and end only
   on `not loaded` or an explicit different content id. With a session open,
   `NamePlaySessionContent` starts working and the catalog resolves the ROM path
   (verified: the Crystal ROM on the device matches `catalog.yml`).
2. **F2** — Use the Fitness app's declared fleet device id as the meter id.
3. **F3** — Report governance and menu pause; stop ending the session on
   `launch` identity changes (key the effect on game + session key, not the
   launch object); let a later `userId` attribute an unattributed open session;
   send `console`; log report failures at `warn` (sampled); mount
   `usePlayBudget`.
4. **F4** — Info-level `play.observe.transition` on state change only; watchdog
   `unrecordable` condition; dedupe reconciliation warnings by device-log
   filename; log ADB recovery at boot and downgrade the cold-start miss to
   `warn`.
5. **F5** — Add `play-session:*` to the known topics, or make it a device-topic
   kind so it gets `device-state` routing and replay. Add
   `GET /play-sessions/open` for a house-wide view. Confirm or rule out the
   living-room two-writer flap once F1 lands.
6. **F6** — Build `recordObservation` whenever persistence is available,
   independent of the declared RetroArch devices.

## Not changed in this audit

No code was modified. The deploy tree is ahead of `origin/main` with
uncommitted emulator work from another session in the same slice; changing
`RecordPlayObservation` or `EmulatorGameWidget` from the laptop tree would
conflict with it. F1 also changes a billing invariant (when a session may
open), which needs a decision before code.
