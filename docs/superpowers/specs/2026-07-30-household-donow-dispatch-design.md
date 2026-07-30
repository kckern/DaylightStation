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

- Pending requests persist at `data/apps/donow/pending.yml`
  (`{ id, surface, action, label, learnerId, requestedBy, ref, occupant,
  createdAt, expiresAt }`).
- On `pending_approval`: send an **HA actionable notification** via the
  existing `CallHomeAssistantService` passthrough (`notify.*` with
  `actions: [APPROVE_<id>, DENY_<id>]`). An HA automation (deployment
  config, documented like the NFC-card setup) posts the tap back to
  `POST /api/v1/donow/approvals/:id/approve|deny` with the location token.
- **Approve** → re-check occupancy (the world may have changed), then
  dispatch; **deny** or **timeout** (default 120s, config) → denied. Every
  transition is logged; the pending file is pruned on read (TTL).
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
addressing scheme for callers.

## 6. Curriculum integration

- **Unit `launch:` blocks** (per the agenda-v2 addressing decision):
  `launch: { surface: garage-fitness, episode: plex:12345 }`. Validation at
  catalog load calls the registered adapter's `validateAction` — an unknown
  surface or malformed payload rejects the unit at publish time, the same
  lane as every other curriculum reference.
- **Composition rules:** `launch` joins the "must reference at least one
  of" list (a launch-only unit is legal — PE). `launch` is mutually
  exclusive with `media` (media units already have their own delivery via
  `DispatchMedia`/manifests — two delivery mechanisms on one unit is the
  ambiguity trap) and with `program` (programs own their own dispatch).
  `launch` + `bank` is legal (go do the thing, then quiz on the Portal);
  `launch` + `document`/`review` is legal (go do the thing, parent marks
  the rubric).
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
- `GET /api/v1/donow/surfaces` → registry ids + action schemas (for future
  authoring UI).
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
