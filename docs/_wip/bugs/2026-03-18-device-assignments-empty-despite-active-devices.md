# Bug: Device Assignments Empty Despite Active Devices — Total Session Data Loss

**Date:** 2026-03-18
**Severity:** Critical (data loss)
**Affected session:** `20260317195214` (2026-03-17, 7:52 PM, bike ride)
**Status:** Mitigated (validation downgraded to warning), root cause needs further investigation

---

## Summary

A 12.5-minute family bike ride session lost its video metadata (Mario Kart 8 Deluxe) and voice memo because the frontend persistence validation `device-assignments-required` blocked **all 3,497 save attempts**. The session had 4 roster members and 5 active devices, but `deviceAssignments` was an empty array for the entire session. Strava sync later backfilled a bare skeleton with HR data only.

---

## Impact

| Data | Status |
|------|--------|
| HR timeseries (kckern) | Preserved (Strava backfill) |
| Video (`plex:649319` — Mario Kart 8 Deluxe) | **Restored manually** from frontend logs |
| Voice memo (`memo_1773803070677_jn2sqzp9q`) | **Audio lost** (never uploaded); transcript restored from user recall |
| Other participants' HR data (felix, milo, alan) | **Lost** (Strava only synced kckern's activity) |

---

## Timeline (all times UTC)

| Time | Event |
|------|-------|
| 20:53:59 | Fitness page loaded (profile logging begins, `sessionActive: false`) |
| 02:50:39 | `fitness.session.buffer.threshold_met` → session `fs_20260317195039` starts |
| 02:50:39 | First `fitness.persistence.validation_failed` (`device-assignments-required`, `rosterLength: 1`, `hasPriorSave: false`) |
| 02:50:39–02:50:54 | Validation failures fire every ~250ms (burst) |
| 02:51:00 | Profile: `roster=1, devices=1, series=14` |
| 02:51:30 | Profile: `roster=2, devices=2, series=27` |
| 02:52:00 | Profile: `roster=3, devices=3, series=40` |
| 02:52:06 | `fitness.component_remount` (FitnessChart, not FitnessContext) |
| 02:52:06 | `fitness.media_start.autoplay` → `plex:649319` (Mario Kart 8 Deluxe) |
| 02:52:30 | Profile: `roster=4, devices=4, series=53` |
| 02:54:00 | Profile: `roster=4, devices=5, series=59` |
| 03:04:24 | `voice_memo_overlay_show` (auto-triggered at video end) |
| 03:04:30 | `voice_memo_added` (`memo_1773803070677_jn2sqzp9q`) |
| 03:04:32 | `voice_memo_overlay_close` (auto-accepted) |
| ~03:05:00 | Session ends (HR devices disconnect, user stops biking) |
| Later | Strava sync creates `20260317195214` with HR data only |

**Total validation failures:** 3,497 (entire session duration, every persistence attempt)

---

## Root Cause Analysis

### The Immediate Cause: Validation Hard-Block

`PersistenceManager.js:777` (and duplicate at `FitnessSession.js:2110`):

```javascript
if (hasUserSeries && deviceAssignments.length === 0 && !this.hasSuccessfulSave(sessionData.sessionId)) {
  return { ok: false, reason: 'device-assignments-required' };
}
```

This check was a hard block on first save. Since every attempt returned `{ ok: false }`, persistence never succeeded, `hasPriorSave` never flipped to true, and the check never bypassed. A classic deadlock.

**Mitigation applied:** Downgraded to `getLogger().info()` warning (no longer blocks persistence).

### The Deeper Cause: Why Was `deviceAssignments` Empty?

This is the main unsolved question. The session had **4 roster members and 5 active devices**, yet `deviceAssignments` (from `assignmentLedger.snapshot()`) was consistently empty.

#### How Device Assignments Are Created

There is exactly **one path** for auto-creating device assignments during a live session:

```
FitnessSession.recordDeviceActivity()
  → line 502: user = this.userManager.resolveUserForDevice(device.id)
  → line 571: ledger = this.userManager?.assignmentLedger
  → line 572: if (ledger) {
  → line 577:   if (!ledgerEntry && user && userId) {
  →              getLogger().warn('fitness.auto_assign', ...)  // ← NEVER LOGGED
  →              this.userManager.assignGuest(device.id, ...)
```

#### Evidence: Auto-Assignment Never Ran

Searched the entire session log (`2026-03-17T20-53-59.jsonl`) for:
- `fitness.auto_assign` (warn level) → **zero results**
- `fitness.auto_assign_skip` (debug level) → **zero results**

Neither the success nor the skip path was logged. This means the `if (ledger)` guard at line 572 was `false` — **`this.userManager.assignmentLedger` was null**.

#### But `resolveUserForDevice()` DID Return Users

Proof: the same method is called by `ParticipantRoster._buildRosterEntry()`:

```javascript
// ParticipantRoster.js:359
const mappedUser = this._userManager.resolveUserForDevice(deviceId);
```

The roster grew from 0→4, which requires `resolveUserForDevice()` to return valid users. Resolution works via the hrDeviceId fallback:

```javascript
// UserManager.js:479-484
for (const user of this.users.values()) {
  if (user.hrDeviceId && String(user.hrDeviceId) === idStr) return user;
}
```

Matching the ANT+ device config:

```yaml
# data/household/config/fitness.yml
devices:
  heart_rate:
    40475: kckern    # watch
    28812: felix     # red
    28688: milo      # yellow
    28676: alan      # green
```

So `resolveUserForDevice("40475")` → returns kckern user. This satisfies the auto-assignment condition `user && userId`. **The only remaining blocker is `if (ledger)` being false.**

#### Why Was the Ledger Null?

The `assignmentLedger` is set via React useEffect in FitnessContext:

```javascript
// FitnessContext.jsx:497-508
useEffect(() => {
  const ledger = guestAssignmentLedgerRef.current;
  session?.userManager?.setAssignmentLedger?.(ledger, {
    onChange: () => setLedgerVersion((v) => v + 1)
  });
  return () => {
    session?.userManager?.setAssignmentLedger?.(null);  // Cleanup nulls it
  };
}, [session]);
```

**Hypothesis 1: Initialization Race**
- The useEffect runs after render. The WebSocket subscription (which delivers device data) is set up in a separate useEffect via `import(...).then()` (dynamic import, line 1161).
- Under normal conditions, the ledger useEffect runs before the first WS message arrives.
- BUT: the fitness page had been loaded for ~6 hours (since 20:53:59) before the session started at 02:50:39. The WS was already connected and subscribed. When the first HR data burst arrived (triggering `buffer_threshold_met`), the ledger SHOULD have been set hours ago.

**Hypothesis 2: Component Lifecycle Edge Case**
- A `fitness.component_remount` was logged at 02:52:06 (FitnessChart, not FitnessContext).
- If FitnessContext had also remounted (e.g., from a parent re-render with key change), the cleanup would null the ledger, and there'd be a window before the new effect restores it.
- No evidence of FitnessContext remount in logs, but the cleanup function is a known risk.

**Hypothesis 3: Stale Ref Capture**
- `session` in the useEffect depends on `fitnessSessionRef.current`, read at render time.
- If the ref somehow pointed to a different session object than the one receiving device data, the ledger would be set on the wrong instance.
- Unlikely since `fitnessSessionRef` is created with `useRef(new FitnessSession())` once.

**Most likely:** The ledger was null because of a React lifecycle timing issue (H1 or H2). The exact mechanism needs diagnostic logging to confirm.

---

## Architecture Issue: Two Parallel User-Resolution Paths

The system has **two independent mechanisms** for identifying which user a device belongs to:

| Mechanism | Used By | Source |
|-----------|---------|--------|
| `resolveUserForDevice()` → hrDeviceId config match | ParticipantRoster, ZoneProfileStore, TreasureBox | `fitness.yml` devices section |
| `assignmentLedger.get()` → explicit assignment | PersistenceManager validation, `buildParticipantsForPersist()` | Runtime auto-assignment or manual guest assignment |

The **roster** and **user series** are populated via mechanism 1 (hrDeviceId match), which works reliably for configured ANT+ devices.

The **persistence validation** requires mechanism 2 (ledger entries), which depends on auto-assignment running inside `recordDeviceActivity()`.

When the ledger is null, mechanism 1 works fine (devices resolve to users, roster populates, series record) but mechanism 2 never activates (no assignments created). This creates a paradox: the session is fully functional with active users, but persistence considers it invalid.

---

## Remediation

### Applied (immediate)

1. **Downgraded `device-assignments-required` to warning** in both `PersistenceManager.js:777` and `FitnessSession.js:2110`. Sessions with missing device assignments now save successfully.

2. **Restored session data** for `20260317195214`:
   - Added `media.primary: plex:649319` (Mario Kart 8 Deluxe)
   - Added voice memo with user-supplied transcript: "We completed the propeller cup together."

### Needed (follow-up)

#### P0: Add Diagnostic Logging

Add logging at the `if (ledger)` gate to distinguish "ledger null" from "assignment skipped":

```javascript
// FitnessSession.js, after line 571
if (!ledger) {
  getLogger().warn('fitness.assignment_ledger_null', {
    sessionId: this.sessionId,
    deviceId: device.id,
    hasUser: !!user,
  });
}
```

This will prove/disprove the "ledger null" hypothesis next time it happens.

#### P1: Defensive Ledger Initialization

Consider setting the ledger imperatively during FitnessSession construction or via `configure()`, rather than relying solely on a React useEffect. This eliminates any possible timing gap:

```javascript
// In FitnessSession constructor or configure()
if (!this.userManager.assignmentLedger) {
  this.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
}
```

The FitnessContext useEffect would then REPLACE this default ledger with the shared one, rather than being the sole setter.

#### P2: Reconcile the Two User-Resolution Paths

If `resolveUserForDevice()` returns a user but the ledger is empty, the auto-assignment at line 577 should always succeed (it just needs the ledger to be non-null). The architectural fix is to ensure the ledger is never null during an active session.

Alternatively, the persistence validation could infer device assignments from the roster when the ledger is empty:

```javascript
// If ledger-based assignments are empty, infer from roster
if (deviceAssignments.length === 0 && roster.length > 0) {
  deviceAssignments = roster
    .filter(r => r.hrDeviceId)
    .map(r => ({ deviceId: r.hrDeviceId, occupantId: r.id, occupantName: r.name }));
}
```

---

## Key Files

| File | Relevance |
|------|-----------|
| `frontend/src/hooks/fitness/PersistenceManager.js:777` | Validation that blocked persistence (fixed) |
| `frontend/src/hooks/fitness/FitnessSession.js:2110` | Duplicate validation (fixed) |
| `frontend/src/hooks/fitness/FitnessSession.js:571-590` | Auto-assignment code that never ran |
| `frontend/src/hooks/fitness/UserManager.js:456-486` | `resolveUserForDevice()` — works via hrDeviceId match |
| `frontend/src/hooks/fitness/UserManager.js:282-284` | `setAssignmentLedger()` — sets ledger from React useEffect |
| `frontend/src/context/FitnessContext.jsx:497-508` | useEffect that wires ledger to session (timing-sensitive) |
| `frontend/src/hooks/fitness/ParticipantRoster.js:349-388` | Roster building — uses resolveUserForDevice, works independently of ledger |
| `_extensions/fitness/src/decoders/heart_rate.mjs:55` | BLE path creates `deviceId: ble_${userId}` (not relevant for this ANT+ session, but a separate gap for BLE-only sessions) |

## Related

- `docs/_wip/bugs/2026-01-27-fitness-watch-history-not-syncing.md` — earlier instance of `device-assignments-required` validation failures
- `docs/plans/2026-03-06-fitness-session-data-loss-fix.md` — plan that identified this check as problematic (line 149) but never softened it
- `FitnessSession.js:512` comment: `// DEBUG: Disabled - suspected cause of empty deviceAssignments on save` — prior awareness of this class of bug
