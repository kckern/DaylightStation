# Media redesign — story-to-JSX/API implementation map

**Date:** 2026-09-14  
**Status:** Proposed implementation ownership; no application changes.  
**Contract:** [Accepted requirements](./2026-09-14-media-app-redesign-requirements.md).  
**Stories:** [Taxonomy §3](./2026-09-14-media-app-ideal-jtbd-taxonomy.md#3-user-stories-by-job-group).  
**Sequence:** [Implementation handoff](./2026-09-14-media-app-redesign-handoff.md).  
**Tracking:** [Refactor status](../refactors/2026-09-14-media-app-redesign.md).

## Recommendation

Build through the existing local/remote session-controller seam. Give each story an interaction owner, a state/command owner, and an observable acceptance test. A story does not require its own component or endpoint. Many stories share the same search, item actions, controls, or outcome surface.

This is a coverage and sequencing map, not an executable coding plan or a claim that the proposed APIs exist. Write a small executable plan for each handoff step as it starts. Preserve the accepted P0/P1/P2 order; the phasing conflict below needs a recorded resolution before affected stories can be declared complete.

## Component boundaries

Paths below are relative to `frontend/src/modules/Media/`. An asterisk marks a **proposed new component**; other names are existing files to evolve. Names identify ownership, not a requirement to split every small element into its own file.

| Concern | JSX owner / proposed path | State and behavior owner |
|---|---|---|
| App composition | `frontend/src/Apps/MediaApp.jsx`, `shell/MediaAppShell.jsx` | Existing providers; compose shared surfaces once |
| Destination for new content | `aim/AimLabel.jsx`*, `aim/AimPicker.jsx`* | `aim/AimProvider.jsx`*, replacing `cast/CastTargetProvider.jsx`; persisted targets, stop/keep preference, idle rule |
| Search | `search/SearchSurface.jsx`*, `search/ScopeChips.jsx` | Evolve `SearchProvider.jsx`; reuse `Content/combobox/useContentCombobox.js`; replace desktop/mobile/fleet-specific search behavior |
| Item actions everywhere | `items/ItemActions.jsx`*; shared `Content/combobox/ResultRow.jsx` through additive props | `items/useItemActions.js`*, replacing `useContentDispatch.js` and `resultRowVerbs.js`; resolve aim once, invoke controller, report outcome |
| Home and catalog | `browse/HomeView.jsx`, `BrowseView.jsx`, `DetailView.jsx`, `RecentsRow.jsx`, `ResumeCard.jsx` | Existing browse/info hooks, navigation; household APIs in P1 |
| Playback being controlled | `shell/MiniPlayer.jsx`, `shell/PlaybackControls.jsx`*, `TransportBar.jsx`, `SeekBar.jsx`, `QueuePanel.jsx` | `controller/useSessionController.js`; separate selected control target from aim; merge NowPlayingView/PeekPanel behavior |
| House overview | `shell/HouseIndicator.jsx`*, `shell/FleetView.jsx` | Existing `FleetProvider.jsx` / `fleetStore.js`; registered browsers join the roster |
| Outcomes | `outcomes/OutcomeTray.jsx`*, `outcomes/OutcomeProvider.jsx`* | Existing dispatch state plus local/controller results; replace ad-hoc notifications and DispatchProgressTray presentation |
| Identity / settings | `identity/DeviceNamePrompt.jsx`*, `shell/SettingsMenu.jsx`, `shell/ConfirmDialog.jsx` | Evolve `ClientIdentityProvider.jsx`; stable ID plus persisted registry name |
| Screen-side notes | `frontend/src/screen-framework/overlays/MediaChangeNote.jsx`* | Shared origin and undo contracts; also render for browsers receiving remote commands |
| Later features | `browse/FavouritesSection.jsx`*, `SuggestionsSection.jsx`*, `shell/PlayedEarlierPanel.jsx`*, `SleepTimerControl.jsx`*, `TrackSelector.jsx`*, `ScreenAdminView.jsx`*, `RoutineHistoryView.jsx`* | Shared controllers and the proposed contracts below |

The central relationship is:

```text
Search / Browse / Details / Home item
  → shared item action + explicit destination, or current aim
  → local controller OR remote controller / wake-and-load dispatch
  → actual player + updated session state
  → shared outcome surface

Handle / Full controls / House row
  → explicitly selected screen's controller
  → actual player + updated session state
  → shared outcome surface
```

Controls never infer their target from the aim. Browsing never changes playback. Keep the bridge-owned player node and host registry: expanding or shrinking video must not remount it.

## API and controller legend

All HTTP routes below use `/api/v1`. **Existing** means a route or seam is present in the inspected code; it does not mean every target player implements the required behavior.

| Key | Existing contract / implementation | Required work |
|---|---|---|
| CATALOG | `GET /content/query/search/stream`, batch `/content/query/search`; `GET /media/config`; `GET /list/:source/...` with `take`/`skip`; `GET /info/:source/...` | One search client, common source-status handling, scope reset and widening; verify source-specific pagination and natural ordering |
| SESSION | Local `LocalSessionController`; remote `RemoteSessionController`; `GET /device/:id/session`; `POST /device/:id/session/transport` with `{action,value?,commandId}` | Same control presentation; command capability/reason reporting; timeout must not allow a delayed press to execute |
| QUEUE | `controller.queue.*`; `POST /device/:id/session/queue/:op` with `commandId` and op-specific content/item/order fields; `PUT /device/:id/session/shuffle`, `/repeat` | Single-item preserve, collection replace, FIFO Play next, protected next band, reversible shuffle; implement missing receiver operations |
| CONFIG | Controller config; `PUT /device/:id/session/volume`; local player speed mechanisms | Capability metadata; speed unavailable with reason remotely in P0; extend remote protocol when supported |
| DISPATCH | `cast/DispatchProvider.jsx`; `GET /device/:id/load`; `POST /device/:id/load` for snapshot adoption; existing progress and dedupe | Keep wake/load path for screens needing startup; attempt-specific retry and correlation through confirmed playback |
| MOVE | `peek/useTakeOver.js`, `cast/useHandOff.js`; `POST /device/:id/session/claim`, snapshot load | Preserve item/position/queue; failure-safe transfer (see risks); later remote-to-remote orchestration |
| FLEET | `GET /device/config`; `FleetProvider` / `fleetStore`; `device-state:*` | Include browsers, consistent idle heartbeat and uncertainty; later shared dispatch outcomes |
| IDENTITY | Existing local `clientId`; `client-control:<clientId>` and `playback_state` | **New registry contract:** register/name/rename stable browser IDs, uniqueness, roster inclusion, liveness; extend device router and device application services |
| ORIGIN | `shared/contracts/media/*`, load and command envelopes, session snapshot metadata | **Extension:** originating device or routine and start time; preserve through receiver and fleet, support exact busy detection |
| HISTORY | `POST /play/log`; existing `MediaProgress` and `POST /content/progress/:source/...` | **New household contracts:** recent, carry on, per-screen spots, watched flags, favourites, exclusions; later suggestions and played-earlier events |
| UNDO | Snapshot adoption exists | **New shared contract:** per-screen pre-change snapshot, action ID, expiry, revision and restore result; any controller may request restoration |
| OUTCOME | Dispatch progress, session acknowledgements, state updates, `logging/mediaLog.js` | Shared frontend action/outcome record; later backend-broadcast screen outcomes and routine history |
| LOCAL | Navigation, local persistence, host registry, browser APIs | No new HTTP route for aim, search-open state, back navigation, layout, or local system media controls |
| LAYERS | `POST /content/compose`; screen framework overlay and Player | Verify composite content reuse; new brief-interruption lifecycle and independently controllable visual/audio layers |

Do not connect all queues to `/media/queue`: that existing router operates on a household queue. The redesign requires a queue per screen; local/remote controllers and `/device/:id/session/queue/:op` are the appropriate seam.

For new contracts, settle request/response shapes, persistence, command acknowledgement, and receiver behavior together before building the dependent JSX. Proposed route families are `/media/history`, `/media/favourites`, `/media/spots`, `/media/exclusions`, `/device/:id/session/undo`, and device registration/name operations. These are design suggestions, not implemented endpoints. Keep HTTP validation in routers, orchestration in `3_applications`, and persistence behind adapters.

## Every story mapped

Phase refers to accepted requirement delivery. A mixed phase means the story has acceptance criteria delivered in different releases; completion of its P0 subset does not complete the whole story. Read each row with the original story's acceptance criteria and the API legend above.

### FIND — discovery (16 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| FIND.1a | SearchSurface: global input, results, close | CATALOG + SearchProvider/LOCAL; preserve query after actions and prior view on close | P0 |
| FIND.1b | Same SearchSurface for this device and a TV | CATALOG + ItemActions; destination changes routing, never search engine | P0 |
| FIND.2a | ScopeChips: kind/sub-kind selector | `/media/config` + CATALOG filter; reset to All on next opening | P0 |
| FIND.3a | SearchSurface source-status line and retry | CATALOG streaming completion/failure per source | P0 |
| FIND.4a | SearchSurface empty state and widening divider | CATALOG; report failed sources before unscoped fallback | P0 |
| FIND.5a | HomeView kind links; BrowseView picture rows | CATALOG pagination; LOCAL scroll restoration | P0 |
| FIND.6a | BrowseView breadcrumbs and collection header actions | CATALOG natural ordering; ItemActions → QUEUE | P0 |
| FIND.7a | SuggestionsSection on HomeView | HISTORY suggestions + FLEET exclusion of currently playing items; definition of time-of-day behavior remains O3 | P2 |
| FIND.8a | ItemActions Details button → DetailView | `/info/:source/...` + progress; navigation only until explicit action | P0 |
| FIND.8b | ResultRow/item card body, inline Play/Continue, Details, Show on… | ItemActions tap grammar; CATALOG, QUEUE, DISPATCH; UNDO dependency below | P0; undo dependency |
| FIND.9a | RecentsRow with last-screen label | HISTORY household recents + common ItemActions | P1 |
| FIND.10a | ResumeCard/carry-on section, spot choices, watched toggle, Now on… | HISTORY per-screen progress/next episode + FLEET playing exclusion | P1 |
| FIND.11a | PlayedEarlierPanel within QueuePanel | HISTORY per-screen played events, including automatic selections | P2 |
| FIND.12a | ItemActions favourite toggle; FavouritesSection | HISTORY household favourite reads/writes; shared across screens | P1 |
| FIND.12b | FavouritesSection large picture cards and inline Play | Common tap grammar; HISTORY favourites | P1; tap grammar P0 |
| FIND.13a | Recent/carry-on/suggestion Remove action; OutcomeTray Undo | HISTORY household exclusions + UNDO; propagate removal everywhere | P1 |

### PLAY — start and enqueue (12 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| PLAY.1a | ItemActions Play; AimLabel; Starting indicator | QUEUE `playNow` with `clearRest:false`; one aim; dedupe; OUTCOME | P0 |
| PLAY.1b | Same Play with This device aim; MiniPlayer appears | Local SESSION/QUEUE; preserve navigation | P0 |
| PLAY.2a | Collection inline Play and header Play | CATALOG expansion + QUEUE replacement, natural order, shuffle off, first unfinished; UNDO dependency | P0; undo dependency |
| PLAY.3a | Collection Shuffle button | Expand collection and establish shuffled order including the first selection; QUEUE shuffle on | P0 |
| PLAY.4a | Spot chooser and OutcomeTray Start over | HISTORY per-screen spots; SESSION seek/start at selected position | P1 |
| PLAY.8a | ItemActions Show briefly; screen overlay close | LAYERS snapshot/suspend/restore + ORIGIN note + timeout | P2 |
| PLAY.8b | No required initiating JSX; recipient overlay and outcome | Routine DISPATCH brief-mode option/default for cameras; LAYERS restore | P2 |
| PLAY.9a | Slideshow Add music behind; separate music controls; stop choice | `/content/compose` reuse assessment + LAYERS independent transport | P2 |
| PLAY.5a | ItemActions Play next; hold/menu At the very front | QUEUE FIFO next band; front insertion explicit; OUTCOME position | P0 |
| PLAY.6a | ItemActions Add to queue | QUEUE append without interruption; OUTCOME ordinal | P0 |
| PLAY.7a | Collection Play next / Add to queue | CATALOG expansion + QUEUE ordered insertion; OUTCOME count | P0 |
| PLAY.10a | QueuePanel Add only toggle; FleetView row badge | New session flag enforced at receiver for other origins; ORIGIN + QUEUE | P1 |

### PLACE — destinations and moves (11 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| PLACE.1a | AimLabel beside every action surface | AimProvider + IDENTITY/FLEET labels; dispatcher consumes the displayed aim | P0 |
| PLACE.2a | AimLabel → AimPicker | LOCAL persistence/activity clock; ORIGIN/FLEET prevent reset while relevant playback is active | P0 |
| PLACE.2b | AimPicker explicit This device option | Clear remote targets; LOCAL; available at all widths | P0 |
| PLACE.3a | ItemActions Play on… / Add to queue on… → AimPicker | Explicit one-action destination override; QUEUE/DISPATCH; preserve aim | P0 |
| PLACE.3b | Same Add to queue on… action | Remote QUEUE append; target snapshot visibly updates | P0 |
| PLACE.4a | AimPicker multi-select; per-screen OutcomeTray; Line up control | DISPATCH/QUEUE fan-out P1; SESSION seek alignment and room adjacency warning P2 | P1/P2 |
| PLACE.5a | AimPicker live screen rows; busy AimLabel | FLEET liveness/title/time + ORIGIN to identify another sender | P0 |
| PLACE.6a | AimLabel stop/keep choice; one-off destination confirmation | Persist preference; DISPATCH stops local only after appropriate success | P0 |
| PLACE.7a | FleetView row and PlaybackControls Move here | MOVE; preserve source on failed transfer; live starts fresh, slideshow keeps spot | P0 |
| PLACE.8a | MiniPlayer Move to… → destination picker | MOVE snapshot adoption; honor stop/keep; OUTCOME confirmed result | P0 |
| PLACE.9a | Remote PlaybackControls Move to… | MOVE between two remote IDs; target confirmation before final source stop or rollback | P1 |

### STEER — controls and queue (16 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| STEER.1a | MiniPlayer persistent handle; system lock-screen controls | SESSION selected held screen P0; browser Media Session hook for local playback P1 | P0/P1 |
| STEER.1b | PlaybackControls screen selector, unavailable reasons; Add to this queue; recipient note | Common SESSION controls P0; one-off SearchSurface add mode and ORIGIN/UNDO note P1 | P0/P1 |
| STEER.1c | OutcomeTray Steer it; FleetView controls link | LOCAL navigation to same PlaybackControls target | P0 |
| STEER.2a | MiniPlayer/PlaybackControls expand and shrink | LOCAL PlayerHostProvider/usePlayerHost; same bridge-owned node | P0 |
| STEER.3a | TransportBar play/pause and skip buttons | SESSION transport; ack/state feedback within 2 seconds; no replay of undeliverable commands | P0 |
| STEER.4a | SeekBar scrub, ±10-second buttons, Live/Go to live | SESSION `seekAbs`/`seekRel`; capability-aware live-edge action may need receiver extension | P0 |
| STEER.5a | PlaybackControls volume steps/slider and speed selector | CONFIG; local speed; remote unsupported reason until protocol/renderer supports speed | P0 |
| STEER.6a | TransportBar Stop; Queue kept outcome; optional screen-off action | SESSION stop retains queue P0; device off capability/API P2 | P0/P2 |
| STEER.10a | SleepTimerControl; MiniPlayer countdown; resume choices | New timer command/snapshot settings; local and receiver fade/expiry; HISTORY timer-start spot | P1 |
| STEER.11a | FleetView and MiniPlayer Pause all / Stop all / Resume all | SESSION fan-out, capture previously playing set, per-screen failures; no new aggregate endpoint required | P1 |
| STEER.12a | TrackSelector in same PlaybackControls | New player track enumeration/selection plus remote contract; show-level preference | P2 |
| STEER.7a | MiniPlayer queue access while stopped; QueuePanel | SESSION retained queue and count P0; live queue exclusion P0; PlayedEarlierPanel/HISTORY P2 | P0/P2 |
| STEER.8a | QueuePanel reorder, move buttons, row play, remove, clear | QUEUE on every receiver; UNDO dependency for remove/clear | P0; undo dependency |
| STEER.9a | QueuePanel's single shuffle/repeat controls | QUEUE/CONFIG; protect Play next band; restore original ordering on shuffle off | P0 |
| STEER.13a | QueuePanel end behavior selector and auto-added labels | Local advancement + receiver equivalent; similar-content capability discovery O2 | P1 |
| STEER.13b | Next-episode countdown and Stop after this one control | Local advancement + receiver equivalent; cancellable 10-second default | P1 |

### HOUSE — overview and identity (7 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| HOUSE.1a | One HouseIndicator at every width | FLEET active/paused summary; LOCAL overview navigation | P0 |
| HOUSE.2a | FleetView sorted rows with inline controls and dispatch state | FLEET + SESSION/MOVE P0; shared dispatch progress and all-screen controls P1 | P0/P1 |
| HOUSE.2b | FleetView This device row | IDENTITY registry + local session broadcast mapped to FLEET | P0 |
| HOUSE.3a | FleetView last-heard labels, connection banner, control uncertainty | FLEET heartbeat/staleness/reconnect; distinguish idle from off | P0 |
| HOUSE.4a | DeviceNamePrompt; SettingsMenu rename; human labels everywhere | IDENTITY unique stable names P0 minimum; rename history/routine references P1 | P0/P1 |
| HOUSE.5a | FleetView row and PlaybackControls Started by line | ORIGIN recorded P0, displayed P1 | P1; data dependency P0 |
| HOUSE.6a | ScreenAdminView add/room/merge/retire; Not seen lately group | Registry mutation/reload contract, routine dependency lookup, stable-ID merge semantics | P2 |

### RELY — outcomes, recovery, orientation (15 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| RELY.1a | OutcomeTray confirmations | OUTCOME wraps item, queue, transport and move actions; shared copy, item/screen labels | P0 |
| RELY.2a | OutcomeTray persistent Turning on/Loading rows | DISPATCH progress events; one correlated record per attempt/target | P0 |
| RELY.3a | OutcomeTray Playing / May not have started; Steer it / Retry | OUTCOME correlates dispatch to actual playback; persistent unconfirmed notices clear on matching state | P0 |
| RELY.4a | OutcomeTray Undo; PlaybackControls Put it back | UNDO accessible from every controlling device; 10-second window, previous item/spot/queue | P1; P0 dependency below |
| RELY.4b | MediaChangeNote Put it back; remote controls same action | ORIGIN + shared UNDO; receiver/browser note, speaker row fallback | P1 |
| RELY.5a | OutcomeTray failure/skip notice; MiniPlayer problem indicator | Local player/controller failure events + remote SESSION/DISPATCH failures | P0 |
| RELY.6a | Each failure row's Retry and Send elsewhere | Store immutable attempt params by dispatch/action ID; retry that record, never global last attempt | P0 |
| RELY.7a | Restored paused controls; reconnect note; restored view | LOCAL session/nav/aim persistence P0; durable receiver snapshots and power-cut recovery P1 | P0/P1 |
| RELY.8a | SettingsMenu Start fresh → itemised ConfirmDialog | LOCAL selective session/queue/spot/aim reset; retain checked parts | P0 |
| RELY.9a | PrimaryNav active area and re-tap | NavProvider current-area mapping; replace/reset without extra history entries | P0 |
| RELY.10a | Labelled Back; overlay close | NavProvider + DismissStackProvider, one logical history step | P0 |
| RELY.14a | DeviceNamePrompt, first-use aim explanation, empty HomeView browse link | IDENTITY name minimum P0; explanation P1; suggestion empty-state integration P2 | P0/P1/P2 |
| RELY.11a | All JSX; OutcomeTray live announcements and textual statuses | LOCAL design-system reflow/accessibility; no new HTTP API | P0, every later feature |
| RELY.12a | Phone shell placement of AimLabel, MiniPlayer, search trigger | LOCAL responsive layout and touch targets | P0, every later feature |
| RELY.13a | All JSX, especially aim and outcomes | LOCAL design tokens/contrast; no new HTTP API | P0, every later feature |

### AUTO — routines and reporting (5 stories)

| Story | User-visible JSX element | Controller / API responsibility | Phase |
|---|---|---|---|
| AUTO.1a | No trigger-building JSX; OutcomeTray/FleetView and later RoutineHistoryView report results | DISPATCH item/queue/shuffle/volume + ORIGIN; shared row results P1, durable routine history P2 | P0/P1/P2 |
| AUTO.1b | DeviceNamePrompt and recipient's usual playback UI | IDENTITY registers routable browser; existing client-control receiver; stable-ID rename guarantees P1 | P0/P1 |
| AUTO.2a | Single normal playback/outcome despite repeated trigger | Server dedupe window + receiver command/token dedupe; human subsequent action wins; reload consumes no old trigger again | P0 |
| AUTO.3a | FleetView browser row; visible-to-house notice | IDENTITY + `playback_state`→canonical device state or direct publisher; heartbeat and close/disconnect handling | P0 |
| AUTO.4a | RoutineHistoryView outcome list and unreachable target indication | New durable routine-attempt query/projection using ORIGIN/DISPATCH + FLEET | P2 |

## Path forward: testable delivery slices

1. **P0 Step 0: baseline.** Create the implementation worktree; record current Media unit and flow results in the refactor index. This mapping does not substitute for running that baseline.
2. **Step 1: four regressions.** Fix phone This device, queue access after Stop, retry-by-attempt, and the Remote search aim mismatch. Each gets a reproducing test and a small shippable change.
3. **Step 2: one aim and moves.** Wire AimProvider/Label/Picker across current surfaces. Keep control target separate. Verify failure-safe moves before treating existing claim/adopt as sufficient.
4. **Step 3: one verb contract.** Introduce ItemActions over both controllers; implement TV receiver operations and test local/remote semantics together. Resolve the undo dependency before declaring replacement/remove/clear complete.
5. **Step 4: one search and browse.** Consolidate search clients/rendering; preserve query, apply scope lifetime and source failure rules. Add breadcrumbs, pagination, and scroll restoration.
6. **Step 5: one controls surface.** Merge local/remote presentation around useSessionController; keep player hosting intact. Make stopped queues reachable, remove duplicate controls, expose unsupported reasons.
7. **Step 6: browser screens and origin.** Add registry/naming/routing, canonical state publication, heartbeat, and origin contracts. Replace Step 2's temporary busy heuristic with recorded origin.
8. **Step 7: one outcome system.** Route every action through shared confirmation/progress/failure reporting. Test late acknowledgements, multiple simultaneous failures and receiver startup failures.
9. **Steps 8–10: persistence, navigation, parity and close-out.** Restore paused; selective reset; correct history; test phone/desktop accessibility and tap budgets. Remove superseded components after their callers migrate; update all three reference docs.
10. **P1:** build household progress and shared undo foundations first, then their consuming UI; add notes, timers, queue-end behavior, multi-screen aim, remote-to-remote moves, local system controls and remaining identity work. Persist receiver sessions for power cuts.
11. **P2:** build suggestions after O3 discovery, history views, brief interruption/restore, separate slideshow music, tracks, screen administration, power-off and line-up behavior.

Within each slice: specify contract → reproduce missing behavior → implement controller/receiver and UI → run focused checks and a real user path → update status/reference docs → use the existing deploy gate. Surface layout work and API work ship together when one depends on the other.

## Dependencies and unresolved contract issues

### P0 undo versus P1 undo

RQ-PLAY-02 and RQ-STEER-17 explicitly require undo in P0, and PR-7/PR-9 forbid irreversible accidental loss. RQ-RELY-04 and the handoff place the shared undo implementation in P1. The story-level acceptance rule also means a mixed-phase story cannot pass in full in P0.

**Recommendation:** pull the minimum per-screen snapshot/restore mechanism into the P0 replacement/remove/clear slice; keep the full cross-device Put it back and receiver notes in P1. Record that phasing reconciliation with the owner before the affected slice ships. This map does not silently amend the accepted requirements. The 10-second-from-tap rule and live-item undo remain subject to O1; do not invent a different timing rule.

### Claim/adopt is a mechanism, not proof of a safe move

The current `useTakeOver.js` claims (stops the source) before local adoption and returns success without verifying local playback starts. A failed adoption can therefore leave the source stopped. The move slice needs target-start confirmation and rollback/resume of the source, or a prepare/adopt/commit protocol. A successful claim HTTP response alone cannot satisfy PLACE.7a.

### Wake-and-load versus queue mutation

The remote queue route exists, but `ScreenActionHandler.jsx` currently handles only `play-now` and `play-next`. Adding a button or returning a command acknowledgement does not implement receiver queue edits. Conversely, a queue command alone does not wake an off TV. Route through the existing startup machinery when needed, then apply the intended queue semantics without clearing retained work.

### Availability versus capability

An offline screen is not a screen that lacks pause or seek. Keep transport availability separate from content/device capability. Unsupported controls have a reason; unreachable commands report not sent and must not run after reconnection. An acknowledgement timeout also needs protection against late execution; changing the notice text is insufficient.

## Verification and completion evidence

Use taxonomy story IDs in scenario names. One scenario can cover several stories, but each acceptance criterion needs evidence. Record completion per requirement/phase as well as per full story.

| Verification layer | Existing anchors / concrete scenarios |
|---|---|
| Controller semantics | `controller/conformance.test.js`, `session/queueOps.test.js`, local and remote controller tests: play preserves remainder; collection replaces; next A then B plays A then B; shuffle excludes next band and restores order |
| JSX routing | Search/browse/details/recents tests: identical item and verb use the displayed aim; opening Remote does not redirect search; This device works at phone width |
| Receiver/API contracts | Device session services + `shared/contracts/media/*` + screen queue registry: every operation reaches the active player, mutates the real queue, and reports actual result |
| Retry and recovery | DispatchProvider/DispatchProgressTray tests: fail A then B, retry A targets A; late ack cannot execute an expired press; failed move restores source; reload is paused |
| Player identity | `session/PlayerBridge.test.jsx`, `PlayerHostProvider.test.jsx`: expanding, shrinking, navigating and volume changes preserve the same media node |
| Cross-device flows | `tests/live/flow/media/`: phone controls TV, two browsers see each other, names persist, idle remains distinct from off, disconnected state becomes uncertain |
| User budgets | NF-TAP/NF-TIME scenarios on phone and desktop; two-device side-by-side state checks; 500-item queue responsiveness; accessibility across all action surfaces |

No application tests were run for this documentation-only map. Before implementation, establish the baseline and confirm target-device capabilities on the current deployed receiver bundle.
