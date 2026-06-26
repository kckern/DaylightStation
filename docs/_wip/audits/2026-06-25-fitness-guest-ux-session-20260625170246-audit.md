# Fitness Guest UX Audit — Session `20260625170246` (2026-06-25)

**Session:** `20260625170246` (≈ 17:02 local PDT)
**Tab/log:** `media/logs/fitness/2026-06-25T23-18-52.jsonl` — 41 MB, **41,754,874 bytes**, single tab (one `fitness-app-mount`, no page reloads). Event span `23:18:52 → 00:33:02 UTC` (≈ 16:18–17:33 PDT, ~75 min).
**Component focus:** `frontend/src/Apps/FitnessApp.jsx`, with the guest journey crossing `ParticipantRoster`, `GuestAssignmentService`, `FullscreenVitalsOverlay`, and `CircularUserAvatar`.
**Code at:** `main` HEAD `c0349f48f`.

> Evidence is the persisted per-session JSONL (survives redeploys — the media volume is bind-mounted). `docker logs` for this session is gone.

## Context — who the "guest" was

The configured roster includes the **grandparents — "Grannie" (`grannie`) and "Grandpa" (`grandpa-kern`)** — the de-facto guests of this household. Grannie's config carries `hrDeviceIds: ["null"]`: she has **no permanently-bound strap**, so any strap she puts on arrives at the app as an *unregistered* device. In this session that strap was **device `10266`**, and it became the center of every guest-facing failure below.

## Issues at a glance

| # | Issue | Verdict | Confidence | Fix |
|---|-------|---------|-----------|-----|
| 1 | 60-bpm "noise floor" deletes a real elderly guest from the roster (invisible + un-taggable) | Confirmed bug | High | Demote-not-drop; lower/relax floor |
| 2 | Explicit guest assignment destroyed by cycle-game session reset | Confirmed bug | High | Persist ledger across reset |
| 3 | `anonymousHrFloor` is hardcoded — never wired to config | Confirmed | High | Wire to fitness config |
| 4 | Fullscreen vitals overlay abandons the HR zone for any unmapped device (no zone, not even default) | Confirmed bug | High | Don't early-return in `resolveUserZone` |
| 5 | Fullscreen overlay shows a default ("Pikachu") avatar for unmapped device | Confirmed (symptom of #2) | High | Fixed by #2; cosmetic otherwise |
| 6 | Roster and fullscreen overlay disagree on how to treat unregistered devices | Confirmed inconsistency | High | Product decision (consume roster vs. raw) |
| 7 | Debug-level log storm: 460 drops in 18s + 10,297 `auto_assign_skip` | Confirmed | High | Revert app log level; sample the drop log |

**Cross-cutting fact:** issues #1, #2, #4, #5 are the *same event seen four ways*. A grandparent put on a strap, was manually tagged, and still ended up invisible in the roster and a blank "default + no zone" ghost in fullscreen.

---

## Grannie's journey through the session

| Time (UTC) | Event | What happened |
|---|---|---|
| 00:02:31 | `guest_assignment.assignment_start` | Strap `10266` assigned to `grannie` **while the strap was silent** (not yet broadcasting). `newOccupant={id:grannie, name:Grannie}`, `previousOccupant.entityId=null`. |
| 00:02:39 | `reset` ×N (`punching_bag`, `step_platform`, `pull_up_bar`…) + `usermanager.user_created` ×17 | Cycle-game lobby re-init re-created the full user set and equipment — **8 seconds after** the assignment. |
| 00:08:12 → 00:08:30 | `participant.roster.dropped_unregistered_low_hr` **×460** | Strap finally broadcasts at **58–59 bpm**, is treated as *unregistered* (ledger lost in the reset), and is dropped ~25×/sec for 18 seconds. |
| 00:23:06 | `fitness.rider.claimed grannie` | Eventually participates in the cycle game via the **rider picker** (config profile) — never via her strap. |

Device `10266` **only ever read 58 or 59 bpm** (46× at 58, 411× at 59) and **never once cleared 60**. Its `auto_assign_skip` records show `hasLedgerEntry:false` throughout — confirming the 00:02:31 assignment did not survive to 00:08.

---

## Issue 1 — The 60-bpm noise floor makes a real elderly guest invisible and un-taggable

**Confidence: High.**

### Root cause
`ParticipantRoster.js:26` sets `DEFAULT_ANONYMOUS_HR_FLOOR_BPM = 60`. Any **unregistered** device (no mapped user *and* no ledger entry) reading below 60 is dropped before it becomes a roster entry:

```js
// ParticipantRoster.js:501-514
const isUnregistered = !mappedUser && !guestEntry;
if (isUnregistered && rawHeartRate != null && rawHeartRate < this._anonymousHrFloor) {
  getLogger().debug('participant.roster.dropped_unregistered_low_hr', { deviceId, heartRate: rawHeartRate, floor: this._anonymousHrFloor });
  return null;   // ← no roster entry → no tappable card
}
```

The floor's documented intent (`ParticipantRoster.js:18-26`) is to filter "a stray ANT+ strap sitting in a drawer broadcasting physiologically impossible readings (e.g. 16 BPM)." But **an older adult's light-activity HR legitimately sits at or just under 60.** Grannie's own configured zones confirm she's a low-HR profile (`active: 80`). Her genuine 58–59 bpm was treated as drawer noise.

### Why this is severe
The roster's own comment (`ParticipantRoster.js:154-155`) states a dropped device "is never rendered as a tappable `#<deviceId>` card." So the anti-noise heuristic doesn't just hide a value — it removes the **only affordance by which an anonymous strap can be tapped and assigned to a person.** The guest demographic most likely to need help getting on the board is exactly the one the filter erases.

### Log evidence
```
00:08:12.591  participant.roster.dropped_unregistered_low_hr  {deviceId:"10266", heartRate:59, floor:60}
   … 460 identical drops …
00:08:30.876  participant.roster.dropped_unregistered_low_hr  {deviceId:"10266", heartRate:59, floor:60}
```
HR distribution for `10266`: `{58: 46, 59: 411}`. Never ≥ 60.

### Recommended fix (do not implement yet)
**Demote, don't delete.** Keep rendering the tappable `#<deviceId>` card for a low-HR unregistered device (marked "weak signal / tap to add") so a guest is always assignable. Reserve the hard-drop for the genuinely-impossible band (e.g. `< 35` bpm — the actual drawer-strap case). 58–59 is a person.

---

## Issue 2 — Explicit guest assignment is destroyed by the cycle-game session reset

**Confidence: High.**

### What happened
Grannie *was* explicitly assigned to `10266` at `00:02:31`. Eight seconds later, the cycle-game lobby fired a batch of equipment `reset` events and a full `usermanager.user_created` ×17 rebuild (`00:02:39`). When her strap finally broadcast at `00:08:12`, the assignment was gone — `auto_assign_skip` shows `hasLedgerEntry:false`, and the roster treated `10266` as unregistered (which then triggered Issue 1).

### Root cause
The assignment lives in the in-memory `DeviceAssignmentLedger` via `GuestAssignmentService.assignGuest` → `session.userManager.assignGuest` (`GuestAssignmentService.js:308`). The lobby/session re-initialization path rebuilds users and resets equipment without re-applying the ledger, so a human-made assignment is the most fragile state in the system: it can be wiped seconds after it's made, with no user-visible signal.

> Note: the assignment was also made **before the strap was broadcasting** (assignment at 00:02:31, first HR at 00:08:12). The assignment UX let an operator tag a device that wasn't even on yet — a 6-minute gap in which a reset silently invalidated the action.

### Recommended fix (do not implement yet)
An explicit guest/ledger assignment must survive lobby/equipment resets — either the reset path preserves the assignment ledger, or the cycle-game lobby re-applies it on re-init. Pairs with Issue 1: even if the assignment is lost, demote-not-drop keeps the device taggable again.

---

## Issue 3 — `anonymousHrFloor` is hardcoded; no per-household tuning

**Confidence: High.**

The floor is *configurable in theory* — `configure({ anonymousHrFloor })` (`ParticipantRoster.js:79-88`) — but **never wired**. The only `configure` call that builds the roster omits it:

```js
// FitnessSession.js:1798-1805
this._participantRoster.configure({
  deviceManager, userManager, treasureBox, activityMonitor, timeline, zoneProfileStore
  // ← no anonymousHrFloor
});
```

There is no `floor` / `anonymous` key in the fitness config (`grep` of `data/household/apps/fitness/config.yml` → nothing). A multi-generational household has no way to lower the floor short of editing the source default.

### Recommended fix
Wire `anonymousHrFloor` through `FitnessConfigService` → `FitnessSession.js:1798` and lower the default to ~45–50 bpm.

---

## Issue 4 — Fullscreen vitals overlay abandons the zone for any unmapped device

**Confidence: High.** This is the "defaulted to default, no HR zones not even default ones — WTF" report.

`CircularUserAvatar.jsx` is **innocent** — it is purely presentational and correctly renders "no zone" when handed `zoneId=null`. The bug is in `FullscreenVitalsOverlay.jsx`, which feeds it.

### Root cause
`resolveUserZone` bails on the first line when there is no resolved user:

```js
// FullscreenVitalsOverlay.jsx:39-40
const resolveUserZone = (userName, device, context) => {
  if (!userName) return { id: null, color: null };   // ← kills zone for ANY unmapped device
```

This is wrong: **a heart-rate zone is a function of BPM, not identity.** The tier-3 fallback immediately below (`FullscreenVitalsOverlay.jsx:60-73`) already computes a zone purely from `device.heartRate` against the canonical `zones` thresholds, and it works fine with no user — `cfg` is `undefined` → `overrides = {}` → it uses each `z.min`. The early return is the *only* thing preventing it.

Downstream consequences in the same `hrItems` map:
- `effectiveZoneColor = zoneInfo.color || 'rgba(128, 128, 128, 0.6)'` (`:161`) → a **dead gray ring**.
- `zoneId: zoneInfo.id` is `null` (`:170`) → `CircularUserAvatar` never receives a `zone-warm`/`zone-fire` class (`CircularUserAvatar.jsx:80`), so no zone styling, no fire sunbeams, no color.

So an unmapped device broadcasting a real, in-zone heart rate renders a live BPM number wrapped in a blank gray ring — "no HR zones, not even default ones." Exactly the report.

### Recommended fix (do not implement yet)
Let the HR-based tier run even without a user:

```js
const resolveUserZone = (userName, device, context) => {
  const { userCurrentZones, zones = [], usersConfigRaw } = context;
  const entry = userName ? userCurrentZones?.[userName] : null;   // was: early-return on !userName
  // …tiers 1 & 2 unchanged (entry is null for anon → naturally skipped)…
  // …tier 3 (HR-based, :60-73) already works with no user…
```

Isolated, low-risk, and restores a real HR-derived zone ring for any broadcasting device, mapped or not.

---

## Issue 5 — Fullscreen overlay shows the default avatar for an unmapped device

**Confidence: High (symptom of Issue 2).**

`getProfileSlug(null)` returns `'user'` (`FullscreenVitalsOverlay.jsx:81-92`), so `avatarSrc = /static/img/users/user` — the default Pikachu placeholder. This is arguably "correct" for a genuinely anonymous device, but it's the visible tell that the user was never resolved. Its real cause is Issue 2 (the lost assignment): Grannie *should* have resolved to her profile avatar. Fixing Issue 2 removes the default-avatar symptom; fixing Issue 4 removes the blank-zone symptom independent of identity.

---

## Issue 6 — Roster and fullscreen overlay disagree on unregistered devices

**Confidence: High.**

`FullscreenVitalsOverlay` reads **raw `heartRateDevices` from context** (`FullscreenVitalsOverlay.jsx:98`), *not* the filtered `ParticipantRoster`. The two paths therefore treat the identical device oppositely:

- **Roster / sidebar / grid:** Grannie's 58–59 bpm strap is **dropped entirely** (Issue 1) — she does not exist.
- **Fullscreen overlay:** the same strap is **shown** as an active item (`hrValid = 59 > 0` → `true`; not inactive if connected) — but as a default-avatar, no-zone ghost (Issues 4 + 5).

Invisible in one view, present-but-blank in another, is almost certainly what made it read as broken. The two views need a single policy.

### Decision needed
Either (a) make the overlay consume the roster so the noise filter is consistent (Grannie's 59 stays hidden everywhere), or (b) keep the overlay raw but give every broadcasting device a real zone (Issue 4 fix). These pull in opposite directions — it's a product call, and it interacts with the demote-not-drop recommendation in Issue 1.

---

## Issue 7 — Debug-level log storm

**Confidence: High.**

The drop log is `debug` (`ParticipantRoster.js:508`), and `FitnessApp.jsx:99` forces the **entire app** to `level: 'debug'`:

```js
// FitnessApp.jsx:95-103 — comment: "while the cycle-game is under active tester debugging … Revert to default ('info') once it's stable."
configureLogger({ level: 'debug', context: { app: 'fitness', sessionLog: true } });
```

Consequences in this one session:
- **460** `dropped_unregistered_low_hr` lines in **18 seconds** (~25/s) — and ~6× per HR packet (460 drops ÷ ~72 packets), because multiple `getRoster()` consumers each re-log.
- **10,297** `fitness.auto_assign_skip` events (mostly cadence sensors: `7138` ×7,457, `49904` ×1,309, `7186` ×1,194), each a `debug` line for a device with no user/ledger.
- The JSONL ballooned to **41 MB**.

This is the same class of event-storm noise previously flagged for the fitness tab; it inflates logs and competes with real signal.

### Recommended fix
Revert `FitnessApp.jsx:99` to `info` now that cycle-game debugging is winding down, and convert the per-build drop log to `logger.sampled(...)` so it can never storm regardless of level.

---

## Recommended fix order

1. **Issue 4** (`resolveUserZone` early-return) — isolated, low-risk, directly fixes the "no zone, not even default" WTF. Ship first.
2. **Issue 1** (demote-not-drop in the roster) — the worst guest-facing symptom; keeps low-HR guests visible and assignable.
3. **Issue 2** (persist assignment across reset) — removes the default-avatar / re-anonymization root cause.
4. **Issue 3** (wire `anonymousHrFloor`) — cheap, enables tuning, complements #1.
5. **Issue 6** (one policy for unregistered devices across roster + overlay) — product decision, gated on #1's direction.
6. **Issue 7** (log level + sample the drop log) — hygiene; do alongside any of the above.

## Appendix — evidence commands

```bash
# Locate the session's log
sudo docker exec daylight-station sh -c 'cd media/logs/fitness && grep -l "20260625170246" *.jsonl'

# Drop storm: per-device counts + HR distribution for 10266
sudo docker exec daylight-station sh -c 'cd media/logs/fitness && grep "dropped_unregistered_low_hr" 2026-06-25T23-18-52.jsonl'

# Guest assignment + reset timeline
sudo docker exec daylight-station sh -c 'cd media/logs/fitness && grep -E "guest_assignment.assignment_start|\"event\":\"reset\"|usermanager.user_created" 2026-06-25T23-18-52.jsonl'
```
