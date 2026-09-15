# Media App Redesign — Implementation Handoff

**Date:** 2026-09-14
**For:** the implementer who will build the redesign and fix the known defects.
**Status:** Ready to start at P0 · Step 0.
**Status page:** [`docs/_wip/refactors/2026-09-14-media-app-redesign.md`](../refactors/2026-09-14-media-app-redesign.md). Keep it current as each step lands.

---

## 0. The brief in one paragraph

`/media` works, but its UX is tangled. Each button decides on its own where things play. The same job is done three different ways. Controls for your own playback and for a TV differ. Whether an action confirms depends on which button you pressed. The owner has accepted a requirements spec that untangles this: one aim, one verb set, one search, one set of controls for any screen, one voice for outcomes. **Evolve the existing app in place to meet it, phase by phase (P0 → P1 → P2).** Every step must ship and leave the app usable. No big-bang rewrite, no parallel app.

## 1. Decisions already made — do not reopen

| Decision | Source |
|---|---|
| Requirements are accepted, **with P0/P1/P2 as written**. | Owner, 2026-09-14 |
| **Evolve in place.** Reshape the existing components and providers; reuse the working session, fleet, dispatch and player-hosting machinery. | Owner, 2026-09-14 |
| **Authority:** commit to `main` (worktree, merge directly), build and deploy **only when the deploy gate is clear**, and reload kiosks after deploy. | Owner, 2026-09-14; `CLAUDE.local.md` |
| Product decisions Q1–Q11 (aim idle reset, tap rule, one household list, play-next order, live items, scope lifetime, screen notes, multi-screen, vocabulary, naming, no child limits). | [Taxonomy §5](./2026-09-14-media-app-ideal-jtbd-taxonomy.md) |
| 47 adopted review changes, and 3 rejected (R5, R6, R12). | [Taxonomy §6](./2026-09-14-media-app-ideal-jtbd-taxonomy.md) |

If a requirement looks wrong once you're in the code, **stop and raise it with the owner**. Don't quietly build something different.

## 2. Read first, in this order

1. **[Requirements](./2026-09-14-media-app-redesign-requirements.md).** This is the contract. Read §3 Principles twice.
2. **[Taxonomy §3 user stories](./2026-09-14-media-app-ideal-jtbd-taxonomy.md).** Their acceptance criteria are your acceptance tests; every requirement traces to them.
3. **[Baseline audit](../audits/2026-09-14-media-app-jobs-to-be-done-baseline.md).**
   - §6 maps every current component to what it does.
   - §7 explains why the app is tangled.
4. **Current contracts:** `docs/reference/media/media-app-technical.md`, covering device session APIs, WebSocket topics, shapes and log taxonomy. Most of what P0 needs server-side already exists there.
5. **`CLAUDE.md` and `CLAUDE.local.md`.** They cover logging, docs, branches, the deploy gate and kiosk reloads.
6. **`docs/reference/frontend/design-system.md`.** Use tokens and primitives; the UI audit gate counts raw colours.
7. **Project memory notes worth reading:**
   - media fleet state architecture
   - media dispatch correlation gotchas
   - WebSocket dispatch cold-start race
   - MediaApp design restraint (function over theme)

## 3. What exists today (reuse map)

Paths are relative to `frontend/src/modules/Media/` unless given in full.

| Concern | Today | Keep / reshape |
|---|---|---|
| App entry | `frontend/src/Apps/MediaApp.jsx`: providers, logger context, auto-reload suppression | Keep |
| Navigation | `shell/NavProvider.jsx`: view stack mirrored to URL history | Keep; fix tab re-tap (RQ-RELY-10) |
| Local session | `session/LocalSessionProvider.jsx`, `LocalSessionController.js`, `queueOps.js`, `sessionReducer.js`, `persistence.js` | Keep; change verb semantics (§5 Step 3) |
| Player hosting | `session/PlayerBridge.jsx`, `PlayerHostProvider.jsx`, `usePlayerHost.js` | **Keep exactly.** See §8 invariants |
| Controller interface | `controller/useSessionController.js`: the same shape for `'local'` and `{deviceId}` | Keep; it underpins PR-5 |
| Remote control | `peek/PeekProvider.jsx`, `RemoteSessionController.js`: transport incl. `seekRel`, queue ops, shuffle/repeat/shader/volume, `claim` | Keep; extend capabilities |
| Fleet | `fleet/FleetProvider.jsx`, `fleetStore.js`, `useDevices.js`: `device-state:*` → store; roster from `/api/v1/device/config` (filter `content_control \|\| fleet`) | Keep; add devices using the app (Step 6) |
| Dispatch | `cast/DispatchProvider.jsx`: per-target `/device/:id/load`, `homeline` progress, dedupe, `retryLast` | Keep; retry by dispatch (Step 1) |
| Aim (today "cast target") | `cast/CastTargetProvider.jsx` (localStorage), `CastTargetChip.jsx`, `DestinationLine.jsx`, `search/useContentDispatch.js` | **Replace** with one aim (Step 2) |
| Search | `search/MediaContentSearch.jsx` (desktop, shared `Content/combobox/ContentCombobox.jsx`), `search/SearchMode.jsx` (mobile, `useContentCombobox`), `fleet/FleetPlayPicker.jsx` (**second engine**, `useLiveSearch`) | Unify (Step 4) |
| Controls | `shell/MiniPlayer.jsx`, `NowPlayingView.jsx`, `TransportBar.jsx`, `SeekBar.jsx`, `QueuePanel.jsx`, `PeekPanel.jsx` | Merge into one handle + one controls surface (Step 5) |
| House view | `shell/FleetView.jsx`, `FleetIndicator.jsx`, the badge in `PrimaryNav.jsx` | Reshape (Step 6) |
| Feedback | `cast/DispatchProgressTray.jsx`, `notifications.show` in 4 modules | Replace with one outcome system (Step 7) |
| Backend device APIs | `backend/src/4_api/v1/routers/device.mjs`: session GET, transport, queue/:op, shuffle, repeat, shader, volume, claim, load (GET+POST adopt), on/off | Keep; extend where noted |
| Screens that publish state | `publishState: true` in the living-room, office and portal screen configs; speakers via `HubFleetBridge`; garage and piano via `DeviceStatePublisher` | Keep |
| Watch progress | `backend/src/2_domains/content/entities/MediaProgress.mjs`: **one playhead per content id**, no screen. Written by `POST /api/v1/play/log` | Extend in P1 (per-screen spots) |
| Config | Search scopes are served by `/api/v1/media/config` via `MediaSurfaceConfigService`, which reads the household `media/config.yml` and falls back to `media/app.yml` (scopes currently live there). The device registry is the household `hardware/devices.yml`. | Keep |

### Capability gaps found while writing this handoff (verify before relying on them)

| Gap | Evidence | Blocks |
|---|---|---|
| **The screen player only handles `play-now` and `play-next` remote queue ops.** `add`, `reorder`, `remove`, `jump` and `clear` are logged as `media.queue-op.unhandled`. | `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:186-224` | PR-5, RQ-STEER-03, RQ-STEER-17, RQ-PLAY-05 on TVs |
| **Local "Play next" inserts each new item at the front of the up-next band**, so successive Play next calls play most-recent-first. That contradicts Q4. `addUpNextMany` already has the required order-added behaviour. | `session/queueOps.js:122-165` | RQ-PLAY-04 |
| **Every current Play Now passes `clearRest: true`.** Single items must keep the queue (R1). | `browse/BrowseView.jsx:168`, `DetailView.jsx:52`, `RecentsRow.jsx:43`, `search/resultRowVerbs.js:21`, `useContentDispatch.js:195-198` | RQ-PLAY-01 |
| Snapshot `meta.ownerId` is the screen's own id. **Nothing records who or what started playback.** | `screen-framework/ScreenRenderer.jsx:369`; `/device/:id/load` has no origin field | RQ-PLACE-07 ("someone else's"), RQ-HOUSE-07, RQ-STEER-21 |
| **Devices using the app are not in the fleet.** They broadcast `playback_state` (relayed) but never `device-state`, and `useDevices` lists only configured devices. | `shared/usePlaybackStateBroadcast.js`; `fleet/useDevices.js:4-9` | RQ-HOUSE-02, RQ-AUTO-04, RQ-PLACE-11/12 to browsers |
| No playback-speed command to screens (config settings are shuffle, repeat, shader, volume). | Tech doc §6.2.3 | RQ-STEER-09 remote speed: show as unavailable until added |
| No lock-screen or notification controls (no Media Session use anywhere). | grep of `mediaSession` | RQ-STEER-04 (P1) |
| No subtitle or audio-track selection in the Player renderers. | grep of `textTracks`, `audioTracks` | RQ-STEER-14 (P2) |
| Per-device play history is deferred and has no contract. | Tech doc §4.2 | RQ-FIND-17 (P2) |
| Idle devices age to "offline" after 15 s (heartbeats only while non-idle). The requirements say "uncertain after 2 min". | Memory note; tech doc §6.4 / §7.4 | RQ-HOUSE-05, RQ-PLACE-06 |

## 4. P0 dependency the phasing didn't show

P0 labels need human device names: "This device (Dad's phone)" in RQ-PLACE-01, devices using the app in the house view (RQ-HOUSE-02), and routine targets (RQ-AUTO-01). Naming is listed at P1 (RQ-HOUSE-06, RQ-RELY-12). **Build the minimum of it in P0:**
- set and rename a device's name
- names are unique
- names persist
- the first-use prompt

The "(was …)" rename history and the routine warning stay P1. Recorded as requirements open item O6.

---

## 5. P0 — the separation-of-concerns core

Ship each step on its own: worktree → tests → merge → gate → deploy → reload kiosks → update the status page. The order is chosen so each step has something to stand on.

### Step 0 — Set up (no user-visible change)

- Create a worktree from current `main`.
- Run the Media unit suite (57 test files under the module, through the vitest gate) and the flow suite in `tests/live/flow/media/`. Record the baseline pass/fail in the status page, so later regressions are attributable.
- Add `docs/reference/media/` updates to your mental checklist: every step that changes behaviour updates `media-app.md`, and §10 of this handoff lists the doc endstate.

### Step 1 — Fix the four known defects (small, ship first)

| # | Defect | Where | Fix, and the requirement it satisfies |
|---|---|---|---|
| D1 | On a phone, once a TV is chosen, you can't aim back at this device. The destination sheet's button needs at least one device selected, and the only control that clears targets (the dock chip) is hidden on mobile. | `cast/useDispatchTargetPicker.js:84`; `cast/DestinationLine.jsx:55-65`; `shell/MediaShell.scss:246-249` | Add a "This device" choice to the destination sheet that clears targets. RQ-PLACE-02. (Superseded by Step 2, but ship now.) |
| D2 | Stop keeps the queue but clears the current item. The mini player then renders nothing, and it is the only route to Now Playing, so the queue becomes unreachable. | `session/sessionReducer.js:84-93`; `shell/MiniPlayer.jsx:35-37` | Keep the handle visible while the queue has items (state `ready`), with a tap that opens Now Playing. RQ-STEER-10, RQ-STEER-15. |
| D3 | Every Retry (every tray row, and the failure toast) re-sends the **most recent** attempt, not its own. | `cast/DispatchProvider.jsx:142-146` (`lastAttemptRef`); `cast/DispatchProgressTray.jsx:116`; `search/useContentDispatch.js:123` | Store attempt params per `dispatchId`, and add `retry(dispatchId)`. RQ-RELY-06. |
| D4 | In the Remote view, search taps go to the controlled device while "Playing to:" names the saved target. | `search/useContentDispatch.js:187-190, 212-221, 244-247`; `cast/DestinationLine.jsx:26-48` | Remove the peek override from all three dispatch functions: steering is not aiming (PR-4, RQ-PLACE-04). Adding to a controlled screen comes back properly as Add to this queue (RQ-STEER-22, P1). |

Tests: a unit test per defect reproducing it first, then the fix. Update `tests/live/flow/media/media-app-cast.runtime.test.mjs` and `media-app-peek.runtime.test.mjs` for D3 and D4.

### Step 2 — One aim (PLACE core)

**Requirements:** RQ-PLACE-01–08, 11, 12, 14; PR-1, PR-4.

- **Aim model.** Replace `CastTargetProvider` with an aim provider holding:
  - `{ targets: [] | [deviceId…], keepPlayingHere: bool }`
  - `lastInteractionAt`, persisted per device
  - the idle rule from RQ-PLACE-03 (2 h default; the clock doesn't run while the aimed screen plays something this device sent or steers; an idle reload starts on this device)
- **One aim label component.** It replaces `DestinationLine` and `CastTargetChip`, and is mounted wherever a verb appears: search, browse, details, the start page, and the controls' "Add" entry. The label shows:
  - the name, "This device (name)", or "n screens"
  - a busy state (RQ-PLACE-07)
  - the stop-or-keep state when relevant (RQ-PLACE-08)
- **"Someone else's playback" (R3)** needs to know who started the aimed screen's playback. Until origin attribution exists (Step 6 backend), approximate it: the screen is busy and this device did not send its current item within the session. Log `aim.busy_basis` so the approximation is visible, and replace it once origin exists.
- **Move here / Move to…** Reuse `peek/useTakeOver.js` (claim) and `cast/useHandOff.js` (adopt). Surface them from the handle and the house view instead of a buried card button and the bottom of Now Playing.
- **Logging:** `aim.changed`, `aim.idle_reset`, `aim.busy_shown`, and moves.

### Step 3 — One verb set and one tap rule (PLAY core)

**Requirements:** RQ-PLAY-01–07, RQ-FIND-09, RQ-FIND-10; PR-2, PR-3, PR-9.

- **One item-actions contract.** It covers Play, Shuffle (collections), Play next, Add to queue, Play on…, Add to queue on…, and Details, and is routed through **one dispatcher that honours the aim** for local and remote alike.
  - Remote uses `RemoteSessionController.queue.*`.
  - Local uses `LocalSessionController.queue.*`.
  - Replace `useContentDispatch`, `resultRowVerbs.js`, and the ad-hoc buttons in `BrowseView`, `DetailView`, `RecentsRow` and the browse container header.
- **Semantics:**
  - Single-item Play: local `playNow(input, { clearRest: false })`; remote `play-now` with `clearRest: false`.
  - Collection Play / Shuffle: replace the queue (`clearRest: true`), with shuffle off or on.
  - Play next: order-added semantics (today's `addUpNextMany`); "At the very front" is today's `playNextMany`. Rename in code so the names match the product verbs.
  - Add to queue: `add`.
- **Tap rule:** playable → play at the aim; collection → open. Collection rows carry inline Play or "Continue <part>". Cameras and single photos → show on this device, with Show on… second. The current shared `ResultRow` in `Content/combobox/` is the right home, but keep its props additive (Admin uses the combobox).
- **Double-tap:** extend the dispatch dedupe to local plays as well (RQ-PLAY-07).
- **Screen-player gap (blocking for TVs):** implement `add`, `reorder`, `remove`, `jump` and `clear` in the screen player's queue-op handling (§3 gaps) so remote verbs and queue edits work on screens. Where a screen genuinely can't, its controls show the action unavailable with a reason (RQ-STEER-03). After deploying a screen-player change, **reload each screen**, or it keeps the old bundle and rejects new envelopes.

### Step 4 — One search (FIND core)

**Requirements:** RQ-FIND-01–08.

- **One search.** A single search surface and result renderer at every size (a full-screen surface on phones is fine; the layout may differ but the capability may not). Delete `FleetPlayPicker`'s separate search; "play something on this screen" becomes the aim, or Play on… (and Add to this queue in P1).
- **After acting:** search stays open after Play, Add to queue and Play on… (R24). Scope lasts until search closes (Q6).
- **Empty and failed states:** a labelled widening divider ("Not in Audiobooks — from everything:"), a failed source reported before widening (R25), and one shared status line.
- **Browse:** pictures on every row, load more on scroll, scroll position restored on back, and a real breadcrumb trail (RQ-FIND-07, 08).

### Step 5 — One handle, one set of controls (STEER core)

**Requirements:** RQ-STEER-01–03, 05–10, 15–18; PR-5.

- **Handle.** The mini player becomes the handle for this device **or** the screen this device last sent to or steered. It is visible while playing, paused or `ready`, never duplicated by open controls, and tapping it opens full controls plus the queue.
- **One controls surface.** Merge `NowPlayingView` and `PeekPanel` into one surface bound to `useSessionController(target)`, with the same layout for any screen. Remove the duplicate transport and repeat/shuffle (repeat and shuffle appear once, with the queue). Add jump ±10 s for remote (exists as `seekRel`) and volume step buttons alongside the slider. Remote speed shows as unavailable with a reason.
- **Player hosting.** Keep `usePlayerHost` for local video. The Now Playing host claim and the handle's video dock must keep the single-node rule (§8).
- **Stop.** One Stop: it says "Queue kept: n items", and the queue stays reachable (depends on D2).

### Step 6 — House view and devices using the app (HOUSE core, plus AUTO-01 and 04)

**Requirements:** RQ-HOUSE-01–03, 05; RQ-AUTO-01, 03, 04; the minimum naming from §4.

- **Indicator.** One house indicator shown once at every width. Today the dock indicator is tablet-only and the tab badge duplicates it.
- **Rows.** Pause, Stop and Move here inline, plus open-controls and Play on.
- **Devices using the app become screens (backend and frontend):**
  1. Give each browser a registered screen identity: the stable `clientId` plus a unique name.
  2. Publish `device-state` for it: reuse `DeviceStatePublisher` fed by the local session, or have the backend synthesise it from `playback_state`. Pick one and document it in the tech doc.
  3. Include it in the roster endpoint the fleet reads.
  4. Route commands to it via the existing `client-control:<clientId>` topic so Move to… and routines can target it.
  5. Run the layer audit and composition-contract gates for backend additions.
- **Origin attribution.** Add an optional origin to `/device/:id/load` and the command envelopes (device id or routine name). Screens copy it into their snapshot meta. This unlocks exact busy detection (Step 2), "started by" (P1) and screen notes (P1). Update `shared/contracts/media/*` and its tests.
- **Staleness.** Align liveness with RQ-HOUSE-05: an idle but connected screen must not read as "Off". Either heartbeat while idle (at 30 s or less, per tech doc §6.4) or render "idle, last heard <time>". Mark uncertain after 2 min.
- **Routine duplicates.** The same trigger within 10 s gives one start (RQ-AUTO-03). Dispatch idempotency exists for identical `dispatchId`s; triggers without one need a content+target+window key server-side.

### Step 7 — One voice for outcomes (RELY core)

**Requirements:** RQ-RELY-01–03, 05, 06; PR-6, PR-10.

- **One outcome system.** A single provider replaces the tray and the four ad-hoc `notifications.show` call sites:
  - `confirm({ item, screen, kind })`
  - `progress(dispatchId)`
  - `fail({ …, retry, sendElsewhere })`
  - `unconfirmed(screen)`, which replaces any earlier one for that screen and clears on a playing report
- **Behaviour.** Quiet for this device; named with progress for far screens. Screen readers get an announcement (RQ-RELY-13).
- **Local playback failures and skips** (stall and error auto-advance already exist in `PlayerBridge` and the controller) must now raise a notice and put a problem sign on the handle (RQ-RELY-05).
- **"Not sent."** A remote press that can't be delivered must say so, and must never apply later (RQ-STEER-07). Check that the ack-timeout path doesn't leave a queued command.

### Step 8 — Keep your place, and orientation

**Requirements:** RQ-RELY-07, 09, 10, 11.

- **Reload.** Restore paused (R38). Today's resume path autoplays: check `PlayerBridge`'s start and `persistence.js` `wasPlayingOnUnload`.
- **Start fresh.** Itemised: what's playing, queue, spot and aim, each keepable; confirm first.
- **Navigation.** Tab re-tap returns to the top without pushing history (today `PrimaryNav.jsx:37` pushes every time). On-screen back labels name their real destination (today "← Devices" goes to the previous view).

### Step 9 — Comfortable use and device-size parity

**Requirements:** RQ-RELY-13–15; NF-A11Y; NF-DEV.

- Large-text reflow, announcements, and status never shown by colour alone (fleet dots today).
- 44 px targets and contrast at the required levels.
- Reduced motion honoured.
- No function hidden by width.
- One-thumb reach on phones for the aim, play/pause and search.

### Step 10 — P0 close-out

- **Budgets.** Walk the NF-TAP budgets with a scripted flow test (count clicks per path) and record the results on the status page.
- **Persona walkthroughs.** Walk the taxonomy §4.2 paths for the P0-relevant personas (Seeker, Big-Screen Sender, House Watch, Hand-Held Viewer, Room Hopper, Fixer) on a phone and a laptop, with at least two devices for the house view.
- **Delete superseded components:** `CastTargetChip`, `DestinationLine`, `CastButton`, `FleetIndicator`, `FleetPlayPicker`, `PeekPanel` (merged), the duplicate transport, and `SearchEmptyState`/`SearchErrorState` if unused.
- **Docs.** Update the reference docs (§10) and the status page.

---

## 6. P1 — work items and what each needs

| Work item | Requirements | Frontend | Backend / screen player |
|---|---|---|---|
| Household list: recent across screens, carry on, watched flags | RQ-FIND-11–13 | Start page and item surfaces | `MediaProgress` has one playhead per content id and `completedAt`. Add per-screen playheads (keyed by device id or client id), last-played screen, and an unfinished threshold. Define API contracts in the tech doc. |
| Per-screen spots, continue by default | RQ-PLAY-08, 09 | Continue / Start over in the confirmation; the spot chooser | Same per-screen progress. Screens must report progress with their id. |
| Favourites and removal from the household list | RQ-FIND-14, 15 | One-step toggles everywhere | New household-level stores (favourites, removed ids). |
| Undo and Put it back | RQ-RELY-04 | Undo in confirmations; Put it back in any screen's controls | Keep the pre-change snapshot per screen for 10 s. Remote restore can reuse `adopt-snapshot` (tech doc §6.2.4). Put it back from *other* devices needs the backend to hold that snapshot. |
| Screen notes | RQ-STEER-21 | — | Screen player overlay (see `screen-framework/overlays/`) rendering origin (Step 6) with Put it back. Speakers log to their house-view row. |
| Add to this queue | RQ-STEER-22 | Search opened with a one-off destination | — |
| Sleep timer | RQ-STEER-12 | Local timer with fade; handle countdown | New command for screens (contracts + screen player). |
| Pause all / Stop all / Resume all | RQ-STEER-13 | Fan-out over session transport; remember which screens were playing | — |
| End of queue and next episode | RQ-STEER-19, 20 | Local `advancement.js` | Screen player equivalents. "Similar" needs a content-platform answer (open item O2). |
| Several-screen aim | RQ-PLACE-09 | Aim supports several; per-screen outcome | Fan-out exists (tech doc §4.8). |
| Move between two other screens | RQ-PLACE-13 | Orchestrate claim A → adopt B | Consider a server-side move for atomicity. |
| Lock-screen controls | RQ-STEER-04 | Media Session integration for local playback | — |
| Screen notes / progress seen by everyone | RQ-HOUSE-04 | Row status | Broadcast dispatch progress on a device topic, not only to the sender. |
| Naming, part 2; started by; routines follow the screen | RQ-HOUSE-06, 07; RQ-AUTO-02 | Rename history, routine warning, "started by" line | Registry of app devices with stable ids; routines target ids, not names; origin (Step 6). |
| Screens survive a power cut | RQ-RELY-08 | — | Screen player persists its session, or the backend's last snapshot is durable and re-adopted. |
| First use | RQ-RELY-12 | Name prompt (default, skippable); explain the aim once | — |
| Add only | RQ-PLAY-10 | Toggle; label on the house row | A session flag honoured by `play-now` from other origins (local, screen player, backend). |

## 7. P2 — notes only

| Requirement | Note |
|---|---|
| RQ-FIND-16 suggestions | Needs the definition in open item O3 before building. |
| RQ-FIND-17 played earlier | Needs the deferred device history contract (tech doc §4.2). |
| RQ-PLAY-11 show briefly | Screen player overlay plus a restore snapshot; routine option on load. |
| RQ-PLAY-12 music behind a slideshow | The composite content API already pairs visual and audio (tech doc §2.1 compose). Check it before inventing anything. |
| RQ-STEER-11 turn screen off | `/device/:id/off` exists; offer it only where the device supports it. |
| RQ-STEER-14 subtitles and audio language | The Player has no track selection today; this is renderer work. |
| RQ-HOUSE-08 screen admin | Writes the household device registry. Data-volume files are root-owned and config is cached at startup (`CLAUDE.md` config notes), so design an API that writes and reloads. Never hand-edit YAML with `sed`. |
| RQ-AUTO-05 routine history | Log load calls that carry a routine origin (Step 6); flag targets that are off or unreachable. |
| RQ-PLACE-10 line up screens | Seek one screen to the other's reported position; warn for adjacent rooms. |

## 8. Invariants you must not break

1. **The player portals into one bridge-owned node that is re-parented, never conditionally portalled.** Violating this remounts the media element and kills playback. It is guarded by `PlayerBridge.test.jsx`, and `docs/reference/media/media-app.md` ("How re-hosting must be implemented") explains why.
2. **`play` prop identity is stable per item, and volume is applied imperatively.** Routing either through props remounts the Player.
3. **Durable logs:** every Media event carries `context.app` **and** `context.sessionLog` (tech doc §10.4). Use `logging/mediaLog.js` helpers and the structured logger, never raw `console.*`. New features ship with lifecycle, state-change, external-call and error events.
4. **`Content/` must not import from `Media/`.** `ContentCombobox` and `ResultRow` are shared with Admin; props stay additive and Admin's tests stay green.
5. **URL deep links are idempotent** (token) and local-only. The app suppresses the WebSocket service's auto-reload while mounted.
6. **Idempotency:** `dispatchId` rides `execute()` options, not the query. The playback watchdog matches a candidate set. Don't regress either (dispatch correlation memory note).
7. **Screens after deploy:** they keep the old bundle until reloaded, and a cold-started screen can miss the first WebSocket command. Verify end to end only once a screen is connected and on the current bundle.
8. **Design system:** tokens and primitives only. The UI audit gate fails on new raw colours, motion or native controls above baseline. Favour function over decoration.

## 9. How to verify each step

| Layer | How |
|---|---|
| Unit | Vitest through the repo gate (`npm run test:unit:vitest`). Media component tests live beside the components. Reproduce every bug with a failing test first. |
| Contracts | `shared/contracts/media/*.test.mjs` for any envelope or shape change; the backend unit suites cited in the tech doc for any device API change. |
| Flow | `tests/live/flow/media/*.runtime.test.mjs` (cast, peek, fleet, search, resume, handoff picker, reset, URL sync, now-playing exit, deep link, design screens). Update them as behaviour changes. Add flows for: the tap rule, the aim idle reset, single-item Play keeping the queue, stop keeping the queue reachable, retry of the right attempt, one search, Move here/to, and the NF-TAP budgets. Tests fail rather than skip (`CLAUDE.md` test discipline). |
| Two devices | House view parity (HOUSE.2b), steering from a second browser, notes (P1). A headless browser plus the live app works; don't commandeer a household kiosk (memory note on headless screenshots). |
| Logs | Query the log store (`context.app:media`) after each deploy for new error or warn events and for the new `aim.*`, outcome and move events. |
| Acceptance | For each requirement delivered, tick every acceptance criterion of its traced stories on the status page. |

**Deploy, per `CLAUDE.local.md`, every time:**

1. `./scripts/deploy-gate.sh`. It must exit 0; stop if not. It covers fitness sessions, live video, children at the Portal and the piano kiosk, and garage lockdowns.
2. `./scripts/build-daylight.sh`.
3. Re-run the gate.
4. Replace the container with `deploy-daylight`.
5. Confirm `/build.txt` shows your commit.
6. Reload the screens whose bundle you changed:
   - living-room: FKB `loadStartURL`
   - office: WebSocket `reset`
   - portal: `cli/fkb.cli.mjs reload`
   - piano tablet: only via `scripts/reload-piano-kiosk.sh`

   Then confirm each screen is back in the log store.

## 10. Documentation endstate

- **Status page:** `docs/_wip/refactors/2026-09-14-media-app-redesign.md`. Update it when every step lands: what shipped, commit, tests, deploy.
- **`docs/reference/media/media-app.md`:** rewrite the shell, views and navigation sections as each step changes them. The vocabulary becomes Play, Play next, Add to queue, Play on…, Move to…, Remote.
- **`docs/reference/media/media-app-requirements.md`:** at the end of P0, replace it with the accepted requirements (the plan document then points to it).
- **`docs/reference/media/media-app-technical.md`:** document every new or changed contract (origin, app-device registry and state, queue ops on screens, sleep timer, per-screen progress, household favourites and removal).
- **At the end of each phase,** move superseded `_wip` material to `docs/_archive/` as `CLAUDE.md` describes, and keep the status page's links working.

## 11. Open items handed to you

| # | Item | Action |
|---|---|---|
| O1 | Undo while a far screen is still starting; undo on live items (R12 rejected). | Build the 10 s-from-tap rule. Record real wake durations in the status page so the owner can revisit. |
| O2 | What "keep similar things playing" can draw on. | Discovery before P1 Step "End of queue". |
| O3 | Definition of "what this screen usually plays at this time of day". | Discovery before P2. |
| O6 | Minimum device naming pulled into P0 (§4). | Build in Step 6 (plus the first-use prompt). |
| — | Any requirement that proves wrong or infeasible in code. | Stop and raise it with the owner, with evidence. Don't silently diverge. |
