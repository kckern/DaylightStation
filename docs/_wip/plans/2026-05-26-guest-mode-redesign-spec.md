# Guest Mode Redesign Spec

**Date:** 2026-05-26
**Status:** Draft — pending resolution of open issues OI-1/OI-2/OI-3 before implementation
**Inputs:**
- [`2026-05-26-guest-mode-ux-audit.md`](../audits/2026-05-26-guest-mode-ux-audit.md) — the gaps and design directives this spec acts on
- [`guest-mode.md`](../../reference/fitness/guest-mode.md), [`assign-guest.md`](../../reference/fitness/assign-guest.md), [`unknown-hr-monitors.md`](../../reference/fitness/unknown-hr-monitors.md) — current behavior

---

## Executive Summary

Eight discrete work items, organized in three phases. Total scope is meaningful but the items are loosely coupled — each can ship independently.

| # | Work item | Phase | Risk | Effort |
|---|-----------|-------|------|--------|
| W1 | Continuous-usage threshold (replaces 60s grace) | 1 | High (touches persistence) | L |
| W2 | Generic Guest device-keyed alias | 1 | Medium (data model) | M |
| W3 | INACTIVE governance exclusion enforcement | 1 | Low (likely already correct) | S |
| W4 | HR device color rendering (Pikachu visibility) | 2 | Low (UI only) | M |
| W5 | UX state model fixes (Original fallback, error feedback, dedup race) | 2 | Low | M |
| W6 | Pre-session participant lobby | 3 | High (new UI + new entry point) | XL |
| W7 | In-app config writeback (promote Pikachu → permanent) | 3 | High (config mutation API) | L |
| W8 | Silent-swap detection (HR anomaly check) | 3 | Medium (heuristic, false positives) | M |

**Phase 1** (W1+W2+W3): mechanical correctness — current code does the wrong thing; fix it.
**Phase 2** (W4+W5): UX correctness — current UX has invalid states and missing affordances.
**Phase 3** (W6+W7+W8): new capabilities — pre-session lobby, in-app config promotion, anomaly detection.

Phase 1 alone resolves 4 audit gaps (G12, G15, plus partial G3/G4). Phase 2 resolves another 3 (G5/G8/G19, G18, multiple UX invariants).

---

## Conventions

- **As-Is** — describes current code with file:line citations
- **To-Be** — the desired behavior per the audit directives
- **Δ Gap** — what's missing/wrong
- **Design** — proposed implementation approach
- File paths assume `frontend/src/` prefix unless noted

---

## W1 — Continuous-Usage Threshold (Decision §7)

The motivating directive. Replaces the 60s grace window with a configurable threshold (proposed default 5 min). The work blocks the largest cluster of audit gaps.

### As-Is

`hooks/fitness/GuestAssignmentService.js:12`:
```javascript
const GRACE_PERIOD_MS = 60 * 1000; // 1 minute
```

Hardcoded. Single consumer at `assignGuest()` line 131:
```javascript
isGracePeriodTransfer = previousDuration < GRACE_PERIOD_MS && hasTransferableSource;
```

Decision branch (lines 133–185):
- **`< 60s`** → log `GRACE_PERIOD_TRANSFER`, call `session.transferSessionEntity(...)` (entity-to-entity) OR `session.transferUserSeries(...)` (user-to-entity)
- **`≥ 60s`** → log `GUEST_REPLACED`, call `session.endSessionEntity(prev, { status: 'dropped' })`. Prior data persists as a separate participant in saved YAML.

Transfer execution lives in `FitnessSession.js:802-887` (`transferSessionEntity`) and `FitnessTimeline.js:267-295` (`transferUserSeries` — copies series, nullifies source).

Late tagging (Pikachu earned 10 min of data, then tagged) ALWAYS exceeds the 60s window, so currently produces a phantom `#<deviceId>` participant in the saved session — no merge.

### To-Be

Per Decision §7:
- `T` is **configurable** in `fitness.yml` (`governance.usage_threshold_seconds`, default 300)
- The rule applies symmetrically to ALL device-occupant transitions: Guest→Guest, Mapped→Guest, Guest→Mapped (restore), Mapped→Mapped (e.g. accidentally-User B briefly, then User A).
- Late-tagged Pikachus auto-merge via the same backfill mechanism (Decision §5 falls out for free).

### Δ Gap

- Constant not configurable
- Threshold too short for the motivating use case (~5 min not 60s)
- Late-tag merge requires the same mechanism — currently doesn't trigger because we don't re-evaluate at session close

### Design

**Data model:** No schema change. The existing `(deviceId, occupantId, startTime, endTime)` tuple in `SessionEntity` already captures what we need.

**Config:** Add to `fitness.yml`:
```yaml
governance:
  usage_threshold_seconds: 300  # default 5 min; segments shorter than this are absorbed forward
```

Plumbed through `FitnessConfigService` → fitness context → `GuestAssignmentService` constructor (replaces the module-level constant with an instance field).

**Code changes:**

1. **`GuestAssignmentService.js`**
   - Replace `const GRACE_PERIOD_MS` with `this.thresholdMs` set from config
   - Rename `isGracePeriodTransfer` → `shouldBackfillForward` for clarity
   - Same branching logic, just with the configurable threshold
   - Event names: keep `GRACE_PERIOD_TRANSFER` (now misnamed but stable for log consumers) OR rename to `SEGMENT_ABSORBED` — see W1-OI below

2. **`PersistenceManager.js` (new logic at session-end)**
   - Walk the `EventJournal` ASSIGN_GUEST + GUEST_REPLACED events to reconstruct each device's segment timeline
   - For any final segment that ran `< T`, retroactively backfill its data into the NEXT segment (or the previous, per OI-1 resolution)
   - This handles the late-tagged Pikachu case automatically: the synthetic Pikachu segment is < T relative to the eventually-tagged user, so it backfills forward at save time
   - Output: only honored segments appear in `participants:` block

3. **Threshold visibility** (small UX adjustment, ties to W5)
   - Card shows subtle "tentative" badge when current segment is `< T` and recently changed — gives the user a visible signal that "this attribution will lock in at T:MM:SS"
   - No countdown for the common steady-state case; only surfaces near the boundary

**Open issues blocking implementation:**

- **OI-1** (final segment with no next user) — User needs to decide: honor anyway, backfill backward, or drop. **Recommended default: backfill BACKWARD into prior honored segment.** Rationale: silent data loss is the worst option; honoring tiny tail segments creates noise.
- **OI-2** (cycling/turn-taking, all-sub-T) — Recommended: if a device has 3+ consecutive sub-T segments with 2 distinct occupants alternating, treat as "shared device" and honor all segments. Otherwise apply strict forward-absorb.
- **OI-3** (transition-type symmetry) — Recommended: apply to all transitions. The motivating "User A handed to guest at t=10s" case requires Mapped→Guest; symmetry suggests applying to all.

### Test plan

- Unit: feed `GuestAssignmentService` synthetic ledger histories and assert correct event emission
- Integration: end-to-end session sim with User A 30s → Guest 20min → save → assert Guest is sole participant, User A absent
- Regression: ensure existing 60s grace tests still pass with `T=60`

---

## W2 — Generic Guest as Per-Device Alias (Decision §2)

Today's "Guest" tag collapses multiple simultaneous guests into one shared identity. Per directive, each Guest tag must be an alias on top of the device ID.

### As-Is

`modules/Fitness/player/panels/FitnessSidebarMenu.jsx:228-231` — top-option construction:
```javascript
if (!seen.has('guest')) {
  seen.add('guest');
  topOptions.push({ id: 'guest', name: 'Guest', profileId: 'guest', source: 'Guest', isGeneric: true });
}
```

`hooks/fitness/UserManager.js:596`:
```javascript
const userId = profileId || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
```

The `profileId` literal `'guest'` becomes the userId. Two devices both passing `profileId: 'guest'` → both resolve to `this.users.get('guest')` → **same User object → series collision** at `user:guest:hr`.

`allowWhileAssigned: true` (at `UserManager.js:715` for `descriptor.id === 'guest'`) permits the multi-assignment but does NOT change keying.

### To-Be

Two simultaneous "Guest" tags on devices `#A` and `#B` produce:
- User identity `guest@#A` (or `guest_A` — internal slug TBD)
- User identity `guest@#B`
- Separate series, entities, participants in saved YAML
- Governance `min_participants` counts them as 2

### Δ Gap

- Single shared `'guest'` identity must be replaced with deterministic per-device synthesis

### Design

**The fix is small and local to the menu's option construction.** Generic Guest must produce a unique profileId per device at tag time.

**`FitnessSidebarMenu.jsx:228-231` becomes:**
```javascript
if (!seen.has('guest')) {
  seen.add('guest');
  topOptions.push({
    id: 'guest',
    name: 'Guest',
    // profileId omitted — handleAssignGuest synthesizes per-device
    source: 'Guest',
    isGeneric: true
  });
}
```

**`handleAssignGuest`** (currently at FitnessSidebarMenu.jsx:299-309) synthesizes the profileId:
```javascript
const profileId = option.isGeneric
  ? `guest_${deviceIdStr}`        // device-keyed alias
  : (option.profileId || option.id);
assignGuestToDevice(deviceIdStr, { name: option.name, profileId, ... });
```

Display name remains `"Guest"` — the slug is internal-only. Optionally numbered for disambiguation: `"Guest (purple)"` if device has a color name, else `"Guest #<deviceId>"`.

**`UserManager.#ensureUserFromAssignment`** needs no change — it already creates a unique User per profileId.

**Existing `allowWhileAssigned: true`** can stay or be removed for generic Guest — it's no longer load-bearing once each Guest has a unique ID (they can't conflict with themselves).

### Test plan

- Two devices simultaneously tagged Guest → verify two distinct User objects in `UserManager.users`
- Saved YAML has two `guest_<id>` participant entries with disjoint series
- Governance evaluates as 2 participants

---

## W3 — INACTIVE Cards Don't Count For Governance (Decision §4)

### As-Is

`hooks/fitness/DeviceManager.js:233-296` — device becomes INACTIVE when `timeSinceActivity > timeouts.inactive` (10s per current config). Card grays in UI.

`hooks/fitness/GovernanceEngine.js` — reads `session.getActiveParticipantState()`. The roster supplied to governance is filtered **upstream** (by `ActivityMonitor` and `FitnessSession`), but the engine itself contains **no explicit `if (device.inactiveSince) continue`** check.

Audit subsystem agent reported this as "likely correct in practice, but not explicitly enforced."

### To-Be

INACTIVE cards (≥10s silent) are excluded from governance evaluation (`active: all`, `min_participants` counts). They remain in the roster for session totals.

### Δ Gap

- Behavior is implicit, not asserted. Should be:
  - Verified (write a test that proves an INACTIVE device doesn't fail `active: all`)
  - Made explicit (add `.filter(p => !p.isInactive)` at the governance boundary so future changes don't accidentally include them)

### Design

**Trivial code change** once verified:
- Locate the participant array construction in `FitnessSession.getActiveParticipantState()` or wherever the governance roster is materialized
- Confirm/add explicit `.filter(p => !p.inactiveSince)`
- Add a unit test for the boundary: synthetic session with one INACTIVE device, assert `evaluate()` returns `unlocked` for `active: all` when remaining devices are active

If verification shows it's already enforced, the work is a single test commit. If not, a small filter + test.

---

## W4 — HR Device Color Visibility (Decision §3, subsumes G5+G8+G19)

The infrastructure pattern already exists for RPM/cadence devices and just needs to be applied to HR.

### As-Is

`modules/Fitness/player/panels/FitnessUsers.jsx:825-827`:
```javascript
const deviceColor = cadenceColorMap[String(rpmDevice.deviceId)];
const colorMap = CONFIG.rpm.colorMap;
const borderColor = deviceColor ? (colorMap[deviceColor] || deviceColor) : colorMap.green;
```

This is **cadence-only**. The corresponding `heartRateColorMap` (from `device_colors.heart_rate` in fitness.yml) exists in the config payload but is **never consumed** for HR card rendering. HR avatar/border styling is uniform regardless of color config.

`FitnessSidebar.scss` has CSS for various card classes but no per-device color application.

### To-Be

Per Decision §3:
- Saturated, recognizable color on every HR card (avatar ring or border)
- Color **name** as label text for unmapped devices ("Purple strap" instead of "#10366")
- Deterministic per-deviceId hash-color fallback when no `device_colors` entry exists (so each Pikachu is at least visually distinct)
- Same prominence as the RPM cadence color treatment

### Δ Gap

- Three implementation pieces:
  1. Wire up `heartRateColorMap` consumer in `FitnessUsers.jsx` HR rendering branch
  2. Add color-name display for unmapped+colored devices
  3. Hash-color fallback for fully-unmapped devices

### Design

**Data:** Add `heartRateColorMap` to fitness context payload (mirrors `cadenceColorMap`). Sourced from `device_colors.heart_rate` in fitness.yml.

**Rendering:** In FitnessUsers.jsx HR device branch:
```javascript
const deviceColor = heartRateColorMap[deviceIdStr] || deterministicColor(deviceIdStr);
const colorName = heartRateColorMap[deviceIdStr]; // null if hash-fallback
const borderColor = CONFIG.hr.colorMap[deviceColor] || deviceColor;
```

Apply `borderColor` to avatar ring (saturated, ≥3px, ≥80% opacity — match the RPM treatment).

**Label:**
- If user resolves → user's name (current behavior)
- If unmapped AND color name exists → `"Purple strap"` (capitalize color name, append " strap")
- If unmapped AND only hash color → `"Unknown #<short-id>"` or just `"#<deviceId>"` (current behavior preserved as least-bad fallback)

**Hash color:**
```javascript
function deterministicColor(deviceId) {
  // hue = djb2(deviceId) % 360, fixed saturation/lightness for consistency
  // Returns hsl(<hue>, 70%, 55%)
}
```

**CSS:** New `.fitness-device.unmapped-colored` class with prominent ring; matches the visual weight of mapped users' avatars (so the eye treats them equally important).

### Test plan

- Visual regression: render three Pikachu cards with different deviceIds → assert three different hash colors
- Manual: with three colored straps configured, eyeball-match in the actual app

---

## W5 — UX State Model Fixes (multiple invariants)

The UX agent surfaced concrete invalid states. Grouped here as a single coordinated fix pass.

### As-Is

`modules/Fitness/player/panels/FitnessSidebarMenu.jsx`:

| Issue | Location | Symptom |
|-------|----------|---------|
| "Original" button conditional on `baseName` resolving | 212-225 | If baseName is undefined, user CANNOT restore device to its owner |
| Auto-tab-switch is one-way | 273-277 | If both Friends and Family are empty, user lands on dead tab with no message |
| Assignment is fire-and-forget | 299-309 | No success/failure feedback; menu just closes |
| No "currently assigned" visual in candidate grid | 452-490 (renderOption) | Active occupant doesn't appear (correctly), but no marker shows who you have |
| Race on stale candidate tap | option object captured at render | Tap fires with stale data if exclusion races with click |
| `targetDeviceId=null` shows static message | 444-450 | Menu opens with mode='guest' but unusable; should never open in this state |
| `Same person in friends+family` | 249-264 dedup | First occurrence wins silently; tab inconsistency |

### To-Be

| Invariant | Fix |
|-----------|-----|
| Original owner always reachable | Synthesize baseName from `devices.heart_rate` mapping when metadata is missing |
| Both-empty tabs show helpful state | Render "All friends and family already on devices — use Guest below" message |
| Assignment feedback | Wait for promise/ack from `assignGuestToDevice` before closing; show inline error on failure |
| Visual indication of current state | Show small badge on the device card itself: "Borrowed" / "Original" / "Guest" |
| No menu open for invalid target | Guard at the caller — don't open menu if device doesn't exist |
| Duplicate friends/family | Detect at config-load time, log warning |

### Δ Gap

Six discrete fixes, all in `FitnessSidebarMenu.jsx` and adjacent files. None requires data model changes.

### Design

**5a. Original owner fallback chain:**
```javascript
const baseName = activeAssignment?.metadata?.baseUserName
  || targetDefaultName
  || getUserByDevice(deviceIdStr)?.name
  || getConfiguredOwnerName(deviceIdStr);  // NEW: derive from devices.heart_rate
```
Adds one more rung to the resolution. If still undefined, the device truly has no configured owner (e.g. a Pikachu) — in which case "Original" should not appear (correct behavior).

**5b. Empty-state message:**
After the candidate grid:
```jsx
{guestOptions.filteredOptions.length === 0 && guestOptions.topOptions.length <= 1 && (
  <div className="empty-candidates">
    All friends and family are already on devices. Tap "Guest" above for an anonymous tag.
  </div>
)}
```

**5c. Assignment ack:**
Refactor `assignGuestToDevice` to return a promise (or use a `pending` ref). Menu shows spinner during pending state; closes on success; shows toast on error. Failure modes today:
- Device disappeared (auto-recover: reopen menu? or just toast)
- Network error (backend save)
- Validation error (e.g. user already on another device — would prevent via `allowWhileAssigned`)

**5d. Card status badge:**
On the HR device card itself (in FitnessUsers.jsx), add a small badge:
- No badge → mapped to original owner, no guest
- "Borrowed" badge → guest on someone else's device (baseName ≠ occupantName)
- "Guest" badge → generic Guest tag
- No badge for own-device guests (mapped owner is also the active user)

**5e. Caller guard:**
In `FitnessSidebar.jsx:151`, change:
```javascript
if (!deviceId) return;
// ADD:
if (!devices.some(d => String(d.deviceId) === String(deviceId))) {
  getLogger().warn('guest_menu.target_does_not_exist', { deviceId });
  return;
}
```

**5f. Duplicate detection:**
At fitness config load (`FitnessConfigService`):
- Build set of all `(id, profileId)` across primary/family/friends
- Warn on collision: `getLogger().warn('fitness_config.duplicate_user', {...})`

### Test plan

- Snapshot test for each empty-state and badge variation
- Promise-based test for assignment ack: simulate slow network → assert spinner; simulate error → assert toast
- Integration: with baseName=undefined and assignment present, verify Original button appears (after fallback chain)

---

## W6 — Pre-Session Participant Lobby (G1)

Largest scope of the spec. Defers until Phase 3 because it's a net-new UX surface, not a fix.

### As-Is

No pre-session UI. The fitness app jumps from menu → video player. Sidebar populates reactively as devices broadcast. Per the audit, you cannot tag any guest before they put on a strap.

### To-Be

A "lobby" view between menu and player where the user can:
- See expected participants (household members)
- Pre-allocate guest slots (e.g. "expecting Friend C and Friend D today")
- Match arriving devices to pre-allocated slots automatically
- Start the session manually when ready (no need for the 3-device threshold)

### Design

(Sketch only — full design in a follow-up doc when Phase 3 starts.)

**Lobby state machine:** PRE_LOBBY (in menu) → LOBBY_OPEN (assembling roster) → LOBBY_READY (≥1 expected slot occupied) → SESSION_ACTIVE

**Pre-allocation data:** ephemeral, lobby-scoped — not persisted to fitness.yml. List of `{ profileId, name }` expected.

**Auto-match:** when a new device starts broadcasting in LOBBY_OPEN, the lobby pops a "is this Friend C?" prompt; tap to confirm.

**Start trigger:** explicit "Start workout" button; the implicit 3-device threshold becomes a fallback only.

**Dependencies:** can be built independently of W1-W5, but the auto-match step uses the threshold from W1 (sub-T pre-broadcast period absorbs into the assigned identity).

---

## W7 — In-App Config Writeback (G10)

### As-Is

Adding a new recurring visitor requires SSH + edit `fitness.yml` + restart Docker. High friction discourages cleanup.

### To-Be

In the assign menu, a "Remember this person" action that writes a new `users.friends` entry to fitness.yml via API, with the captured deviceId optionally added to `devices.heart_rate`. Restart prompt at session end.

### Design

(Sketch.) New backend endpoint `POST /api/v1/fitness/config/users` that appends to fitness.yml (with file lock, validation, backup). Frontend adds a "Save as friend/family" action after assigning a generic Guest. Restart can be deferred — config caches and lazy reload would help but are a separate effort.

---

## W8 — Silent-Swap Detection (G3)

### As-Is

When Alice's strap ends up on Bob without anyone touching the menu, no detection. Bob's effort attributes to Alice. The single most dangerous footgun.

### To-Be

A non-blocking heuristic: detect HR-pattern discontinuities that suggest a wearer change, prompt the user to confirm.

### Design

(Sketch.) Per-user rolling baseline (mean + stdev over last 5 min). When live HR deviates >3 stdev for >30s with no `zone_change` explanation, raise a soft prompt: "Is Alice still wearing #22222?" with quick-action buttons. False positive risk is real — needs tuning. Could also detect "HR went to 0 then came back at a wildly different value" as a stronger signal.

---

## Cross-Cutting Concerns

### Configuration

New `fitness.yml` fields (none are required; all have sensible defaults):
```yaml
governance:
  usage_threshold_seconds: 300    # W1
  inactive_governance_excluded: true  # W3 (optional, default is the intent anyway)
```

### Telemetry / Events

`EventJournal` extensions for the new flows:
- W1: rename `GRACE_PERIOD_TRANSFER` → `SEGMENT_ABSORBED`, add `T` value to event payload
- W2: `GUEST_ASSIGNED` event includes the device-keyed profileId
- W5: `GUEST_ASSIGNMENT_FAILED` for the new error feedback path
- W8: `SILENT_SWAP_DETECTED` for telemetry on the heuristic

### Persistence migration

W1 adds session-end backfill logic. **Old sessions are unaffected** (the merge happens at save time, only). Existing saved YAML files don't need migration.

### Test coverage

Each W item has its own test plan. Aim for:
- Unit tests for the service-layer logic (GuestAssignmentService, UserManager)
- Integration tests for the full data-flow (HR signal → roster → save)
- Visual regression tests for color/badge work (W4, W5d)

---

## Phasing & Dependencies

```
Phase 1 (mechanical correctness — high value, contained):
  W3 ──┐
       ├─► Phase 1 ship
  W2 ──┤
       │
  W1 ──┘ (longest, drives the priority)

Phase 2 (UX correctness — low risk, polish):
  W4 ──┐
       ├─► Phase 2 ship
  W5 ──┘

Phase 3 (new capabilities — discrete, can interleave with anything):
  W6 — pre-session lobby (independent)
  W7 — config writeback (independent, depends on backend file-lock infra)
  W8 — silent-swap detection (independent)
```

**Within Phase 1, ship order:** W3 → W2 → W1. W3 is a verification + small filter (1 day). W2 is a localized fix (2-3 days). W1 is the meaty piece (1-2 weeks counting threshold rule design, OI resolution, persistence backfill, and tests).

**Phase 2 can start in parallel with W1.** W4/W5 don't touch the persistence/threshold logic.

**Phase 3 is opportunistic.** No hard dependencies on Phases 1-2 (though W6 benefits from W1's threshold model for auto-match).

---

## Open Issues to Resolve Before Implementation

Carried from the audit (Part 7 Decision §7); blocking W1 implementation:

- **OI-1.** Final-segment-with-no-next-user: honor / backfill-backward / drop?
  - **Recommendation:** backfill backward into prior honored segment. Avoids data loss; tiny tail segments shouldn't create participants.
- **OI-2.** All-sub-T cycling/turn-taking (e.g. Alice/Bob alternating 2-min each):
  - **Recommendation:** detect 3+ consecutive sub-T alternations between same 2-N occupants → treat device as "shared" → honor all segments regardless of T.
- **OI-3.** Symmetric application across all transition types (Mapped→Guest vs Mapped→Mapped vs Guest→Original):
  - **Recommendation:** apply to all. Symmetry is simpler to reason about and matches the directive's spirit.

These three answers (or the user's preferred alternatives) finalize the W1 design.

---

## See Also

- [`2026-05-26-guest-mode-ux-audit.md`](../audits/2026-05-26-guest-mode-ux-audit.md) — audit producing the directives this spec implements
- [`guest-mode.md`](../../reference/fitness/guest-mode.md) — current behavior umbrella
- [`assign-guest.md`](../../reference/fitness/assign-guest.md) — current guest assignment specification
- [`unknown-hr-monitors.md`](../../reference/fitness/unknown-hr-monitors.md) — Pikachu detail
