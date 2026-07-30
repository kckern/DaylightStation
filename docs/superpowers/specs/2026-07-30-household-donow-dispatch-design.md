# DoNow — the household "let's do this now" dispatch contract

**Date:** 2026-07-30
**Status:** Draft for review
**Companion:** [`2026-07-30-school-agenda-preview-design.md`](2026-07-30-school-agenda-preview-design.md)
**Grounding:** the 2026-07-30 dispatch-seam survey (eight seams, five addressing
schemes, five ack vocabularies, no shared interface).

## 1. What this is

One standard interface for "start this, there, now" that any part of the
system can call and that can reach any household surface: the Portal tablet,
the thermal and laser printers, the living-room TV, playback-hub speakers,
the Piano Kiosk, the garage fitness player. The curriculum is the first and
richest caller (a subject QR scan resolving to "PE = dance video in the
garage"); NFC triggers, HA buttons, cron and voice can drive the same
interface later.

**This is a FACADE, not a transport unification.** The survey found eight
working dispatch seams, each with its own dialect. DoNow does not replace
them — it names them behind one closed registry and one policy, exactly the
posture the trigger registry takes for tags ("one registry answers what a
tag is; the owning domain decides what happens"). Collapsing the five ack
vocabularies into one envelope is explicitly out of scope.

## 2. Decisions (agreed with the household)

1. **Fire-and-forget + best-effort evidence.** The contract guarantees a
   dispatch decision, not completion. Evidence of "done" stays per-surface.
2. **Household-level service**, not a School port. School consumes it like
   everyone else.
3. **Addressing: programs + unit `launch:` blocks.** Standing daily work is
   a program unit (launcher owns evidence); any curriculum unit may carry a
   `launch:` block naming a surface + payload, validated at catalog load.
4. **Never clobber. Busy policy:** idle/paused passes; the same learner
   passes; anyone else actively using the surface → a parental override
   request through the Home Assistant app (approve/deny); timeout denies.

## 3. The contract

```js
// backend/src/3_applications/donow/DoNowService.mjs
dispatch({
  surface,        // closed registry id
  action,         // surface-specific payload, validated by the adapter
  learnerId,      // who this is FOR (occupancy same-person rule; may be null)
  requestedBy,    // provenance: 'school-scan' | 'api' | 'trigger' | ...
  ref,            // caller's correlation id (e.g. school sessionId)
  force,          // undefined | 'never_ask' (deny instead of pending)
}) → {
  decision: 'dispatched' | 'pending_approval' | 'denied' | 'failed',
  approvalId,     // when pending
  message,        // human sentence for the caller's surface (slips, UI)
}
```

The **surface adapter port** (`IDoNowSurface`, documentation-only like
`IProgramLauncher`):

```js
id            // closed registry name
validateAction(raw) → string[]     // catalog-load + call-time validation
occupancy()   → { state: 'idle'|'active'|'unknown', occupantId: string|null }
dispatch({ action, learnerId })    → { dispatched: boolean, detail? }
label(action) → string             // "Dance video in the garage" — for
                                   // approval notifications and agenda lines
```

**Policy engine** (pure domain, `2_domains/donow/policy.mjs`):

| occupancy | occupant | decision |
|---|---|---|
| idle | — | dispatch |
| active | same `learnerId` | dispatch |
| active | other/null | pending_approval |
| unknown | — | pending_approval (fail closed — an unknown surface is treated as possibly-occupied, never clobbered) |

Callers may pass `force: 'never_ask'` (deny instead of pending — used by
cron/ambient callers that should never page a parent). There is no
`force: 'clobber'` — overriding a human is exclusively a human's decision.

## 4. Approvals — the parental override

Mirrors the laser-print approval system (pending queue + adult decision),
delivered through HA:

- Callback authentication: the HA automation posts back with the same
  per-location token mechanism the trigger router already uses
  (`/api/v1/trigger`'s `authenticate` — a configured location token),
  under a dedicated `donow-approvals` location entry. No new auth scheme.
- Pending requests persist at `data/apps/donow/pending.yml`
  (`{ id, surface, action, label, learnerId, requestedBy, ref, occupant,
  createdAt, expiresAt }`).
- On `pending_approval`: send an **HA actionable notification** via the
  existing `CallHomeAssistantService` passthrough (`notify.*` with
  `actions: [APPROVE_<id>, DENY_<id>]`). An HA automation (deployment
  config, documented like the NFC-card setup) posts the tap back to
  `POST /api/v1/donow/approvals/:id/approve|deny` with the location token.
- **Approve** → re-check occupancy against the PENDING RECORD, because the
  world may have changed and the parent only decided about the occupant
  they were told about:

  | occupancy at approve time | decision |
  |---|---|
  | idle | dispatch |
  | occupant = the learner | dispatch |
  | occupant = the occupant named in the pending record | dispatch (this is exactly what was approved) |
  | a DIFFERENT occupant | re-pend ONCE with a fresh notification naming the new occupant; a second occupant flip → denied with the remedy line (nobody gets clobbered that a parent did not name) |
  | unknown | re-pend once, same rule |

  **Deny** or **timeout** (default 120s, config) → denied. Every transition
  is logged; the pending file is pruned on read (TTL).
- **TOCTOU is accepted, not solved.** Between any occupancy check and the
  dispatch there is an unavoidable window in a facade over eight seams; we
  accept it rather than building a distributed lock. The approve-time
  re-check above bounds the human-facing version of the race; the
  millisecond version is tolerated by design — do not add locking.
- The requesting surface stays honest: School's slip already prints "we
  asked a grown-up" (scan-never-silent); approval later just makes the
  surface start. No caller blocks waiting.

## 5. The v1 surface registry

Closed set in code; each adapter is a thin delegate to an EXISTING seam
(entry points per the survey). Occupancy is best-effort per adapter —
`unknown` is always legal and fail-closed:

| surface id | dispatch delegates to | occupancy source (v1) |
|---|---|---|
| `portal` | the `school` WS topic (`school.launch`) — the existing PortalDispatch mechanism, generalized here; PortalDispatch becomes a consumer | server-side school activity: an OPEN in-memory quiz/drill session, or attempt-log/language-log writes in the last few minutes → `active` with that occupant; else `idle`. (Identity claims live only in the frontend and are invisible here; the quiz engine's sessions are in-memory server-side by design, so the backend genuinely knows who is mid-quiz.) |
| `livingroom-tv` | `WakeAndLoadService.execute(deviceId, query)` (device registry, full wake stack, its own acks) | playback watchdog signals / `DeviceLivenessService`; `videoState`-style paused counts idle (deploy-gate semantics) |
| `playback-hub` | `SendHubCommand` use case (`{action, target: color/group, contentId, volume}`) | hub `GET /api/status` per-slot `playing` |
| `garage-fitness` | NEW `fitness.launch` WS topic + a `useFitnessLaunch` frontend hook (mirror of `useSchoolLaunch`) navigating FitnessApp to `/fitness/play/:episodeId` — this surface has ZERO remote reachability today and gains its first | fitness session state (`sessionActive`/`rosterSize` — active workout blocks; an idle menu does not) |
| `piano-kiosk` | NEW `piano.launch` message on the existing `kiosk.launch` relay pattern, handled beside `useKioskLaunchCommand` (same device-identity filter); v1 payload: open a named kiosk mode/content id | recent MIDI session activity on the `midi` topic (session_start without session_end = active) |
| `thermal` | `ReceiptPrinting.print(document)` (school console printer registry) | never busy (a queue, not a stage) |
| `laser` | `PrintService` with an **authorized-actor path**: curriculum/parent-driven jobs are quota-exempt but still logged with attribution (the quota governs child self-service, not the curriculum) | never busy |

`ha` (scripts/scenes) is deliberately NOT a v1 surface — the trigger
pipeline's `ha` response kind already covers it; adding it here without a
caller is YAGNI. Same for `office`.

Addressing note: `surface` ids are DoNow's own closed vocabulary. Where an
adapter needs a device id (`livingroom-tv`), the id is configured on the
adapter at composition from `devices.yml` — DoNow never invents a sixth
addressing scheme for callers. **Piano caveat:** the kiosk's launch
identity is the `?device=` localStorage value, NOT a `devices.yml` id (the
same distinction behind the screensaver shared-deviceId bug) — the piano
adapter is configured with the kiosk's device PARAM value, and the spec
says so precisely because composition once wired the wrong kind of id.

### 5.1 Soft occupancy sources — mechanism, freshness, silence rule

Every non-synchronous source names three things: where the truth comes
from, how fresh it must be, and what silence means. Stale-`idle` fails
OPEN (clobbers a live human — forbidden); permanent-`unknown` fails the
feature by paging parents forever. These rules are the spec, not hints:

- **portal** — source: `SchoolService`'s in-memory session map
  (`lastActiveAt` per user; the store sweeps expired sittings itself) plus
  language attempt-log writes. Active when a session's `lastActiveAt` is
  within **10 minutes**; otherwise idle. Silence IS idle here — the store
  is authoritative for on-screen work, not a heartbeat. (Chosen and noted:
  a child scanning mid-their-own-quiz navigates their own sitting away —
  their scan, their intent.)
- **piano-kiosk** — source: a small presence tracker subscribed to the
  `midi` topic at composition (`session_start`/`session_end`/`note_on`).
  Active when any MIDI activity arrived within **5 minutes**; a missed
  `session_end` (BLE flaps drop the bridge routinely in this house)
  self-heals by that TTL — a wedged "active" forever is the named failure
  this rule exists to prevent. Silence beyond TTL → idle (the bridge emits
  continuously while anyone plays).
- **garage-fitness** — source: the backend's own log-ingest stream of
  `fitness-profile` events (the same `sessionActive`/`rosterSize` signals
  the deploy gate greps; the kiosk emits them every ~30s whenever the app
  is up). `sessionActive:true` within **3 minutes** → active;
  `sessionActive:false` within 3 minutes → idle; silence beyond 3 minutes
  → **unknown** (fail closed): a silent garage kiosk means the surface
  itself is dark, and dispatching PE to a dark screen SHOULD involve a
  grown-up — that ask is correct, not nagging, because the always-on kiosk
  makes silence rare.
- **livingroom-tv** — three-step: TV power off (the HA
  `binary_sensor.living_room_tv_state` the `TVControlAdapter` already
  polls) → idle; power on with `playback.log` frames reporting a playing
  state within **2 minutes** → active (occupant null — the living room
  never knows who); power on without recent playing frames → idle
  (paused/menu is idle, deploy-gate semantics). Every Player surface emits
  render-frame logs, which is what makes silence-while-on mean idle rather
  than unknown; if a non-Player app ever plays there, this rule revisits.
- **playback-hub** — synchronous probe (`GET /api/status` per-slot
  `playing`); no decay rule needed.

## 6. Curriculum integration

- **Unit `launch:` blocks** (per the agenda-v2 addressing decision):
  `launch: { surface: garage-fitness, episode: plex:12345 }`. Validation at
  catalog load calls the registered adapter's `validateAction` — an unknown
  surface or malformed payload rejects the unit at publish time, the same
  lane as every other curriculum reference.
- **Composition rules (v1): `launch` stands ALONE.** It joins the "must
  reference at least one of" list, and is mutually exclusive with `media`,
  `bank`, `document`, `review` AND `program`. Rationale: daily "go do it"
  work (PE every morning) is a PROGRAM unit — programs already have
  cadence, launcher-owned evidence, and no sessions; a garage-fitness
  program launcher covers it with zero session-machinery changes. A
  `launch:` unit is the ONE-SHOT case ("play hymn 12 on the piano as unit
  3 of the music course"). `launch`+`bank` is deferred to the per-surface
  evidence work (§10) because the quiz gate opens at `media_completed`,
  which is driven by playback completion reports a fire-and-forget WS
  launch does not have — shipping it now would strand the child in a
  dispatched state with an unreachable quiz. Same deferral for
  `launch`+`document`/`review`.
- **Session mechanics for a `launch` unit — a named closed-set change.**
  The work-session event vocabulary gains ONE event kind,
  `launch_dispatched` (`{ surface, decision, approvalId? }`), with its
  reducer state, transition (`created → launch_dispatched`) and
  non-terminal `nextAction`. On a `dispatched` decision the school routing
  appends `launch_dispatched` and then closes the session through the
  EXISTING `CloseSessionOutcome` with `result: passed` (no percent) — the
  unit completes, the course advances, and the subject serves today under
  the SHIPPED passing-outcome rule with **no amendment to `servedToday`**.
  This is deliberate honor-system completion, the household's
  fire-and-forget decision applied: a launch-only unit has nothing else to
  measure, so "starting is never completion" (a rule about watch-percent
  on media) does not apply to it — dispatch IS the unit's whole ask.
  Reward: only if the unit declares one (existing optional `reward:`),
  settled by the existing outcome→economy machinery.
- **The approval gap:** on `pending_approval` no session event is written
  (nothing happened yet). When a parent approves and the dispatch fires,
  `DoNowService` emits `donow.dispatched { ref, surface }` on the internal
  bus; the school lifecycle subscribes and closes the loop for sessions it
  owns (append + outcome as above). Deny/timeout: no event — the next scan
  re-offers the unit, and the slip already said a grown-up was asked.
- **`nextMove` gains a `launch` arm:** state `created` + `unit.launch` →
  kind `'launch'`. After the outcome records, re-scans hit the shipped
  served/already-done paths — no new wait states.
- **Surface programs — how daily PE actually exists.** A generic
  `SurfaceProgramLauncher` (one class) is registered once per entry in a
  new `school.yml` `programs:` list:
  `- { id: pe-daily, label: 'P.E.', surface: garage-fitness,
  action: { episode: plex:... }, subject: skills }` — config selects from
  the closed surface set, exactly the `categories.mjs` posture. Its
  `launch()` calls `DoNowService.dispatch` (`requestedBy:
  'school-program'`); its `status()` derives `doneToday` from the DoNow
  **dispatch log** (below) — a dispatch for this learner + program this
  study day, honor-system by household decision; `score` null;
  `progressLabel` null. The parent then assigns `program: pe-daily` units
  like any other. Program ids from config must not collide with code
  launchers (`language`) — collision is a boot error.
- **The dispatch log.** Every `dispatched` decision appends one line to
  `data/apps/donow/log/{YYYY-MM-DD}.yml`
  (`{ at, surface, decision, learnerId, requestedBy, ref, approvalId? }`)
  — append-only, date-sharded, the economy-ledger pattern. It exists for
  audit regardless; surface programs read it as their evidence source
  (derived on read, never a stored rollup).
- **`ResolveSubjectNext` routing** gains one arm: a unit whose composition
  is a `launch:` block routes `subject_next` scans to
  `DoNowService.dispatch({ surface, action, learnerId, requestedBy:
  'school-scan', ref: sessionId })`. The printed slip wording follows the
  decision: dispatched → "Starting in the garage — off you go"; pending →
  "The garage is busy — we asked a grown-up"; denied → the remedy line.
- **Done-evidence for launch-block units** (fire-and-forget rule): the
  dispatch is recorded as a work-session event (the session machinery
  exists); completion stays whatever the unit declares — a `review:` rubric
  (parent marks it) or nothing (the dispatch itself is the day's serving,
  suitable for PE-style "go do it" units). A `launch:` unit with a `bank`
  keeps the normal quiz gate. No new evidence machinery.
- **Program launchers become DoNow callers** where they dispatch surfaces
  (`LanguageProgramLauncher`'s portal launch routes through the `portal`
  adapter), so occupancy/override applies uniformly. `IProgramLauncher`
  keeps owning `status()`/done-evidence — the two ports stay separate on
  purpose (launcher = when/whether + evidence; DoNow = where/how + safety).

## 7. API

- `POST /api/v1/donow/dispatch` `{ surface, action, learnerId?, ref? }` →
  the contract result (guarded by the same household-LAN posture as
  siblings; `requestedBy: 'api'`).
- `GET /api/v1/donow/surfaces` → registry ids + human labels (adapters
  validate via `validateAction` error strings; no formal schemas are
  promised).
- `GET /api/v1/donow/approvals` / `POST /approvals/:id/approve|deny` —
  pending queue, HA callback target.

## 8. Error handling

- Adapter `dispatch` throw → `failed` with a human message; never a 500 to
  a scanning child (School wraps it in a slip).
- Occupancy probe throw → `unknown` → the fail-closed pending path.
- HA notify failure → the request still pends (a parent can approve from
  the queue API/UI later); logged loudly.
- Approval races: approve after expiry → friendly "that request expired";
  double-approve → idempotent (first wins, second reads the outcome).

## 9. Testing

1. Pure policy table tests (every row, plus `force: 'never_ask'`).
2. Service tests with fake adapters: decision flow, approval lifecycle
   (approve re-checks occupancy; deny; timeout), pending persistence.
3. Adapter tests with the existing fakes/harnesses per seam (hub gateway
   fake, eventBus fake, printer doubles); the two NEW frontend hooks
   (`useFitnessLaunch`, piano launch handling) tested like
   `useSchoolLaunch`.
4. School integration: `launch:` unit end-to-end through the lifecycle
   harness — scan → pending (occupied fake) → approve → dispatched, slip
   wording per decision.
5. Catalog validation: unknown surface / bad payload rejected at load.

## 10. Out of scope (named deferrals)

- Unifying ack vocabularies/transports across the eight seams.
- `ha` and `office` surfaces (no caller yet).
- Voice/cron/trigger-pipeline callers (the API is ready; wiring them is
  each its own small project).
- Per-surface rich completion evidence (minutes played, attribution on the
  garage player) — arrives surface-by-surface later.
- An authoring UI for `launch:` blocks.
