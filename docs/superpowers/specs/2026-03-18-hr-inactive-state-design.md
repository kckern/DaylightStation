# HR-Inactive State: System-Wide Zero Heart Rate Handling

**Goal:** When a heart rate monitor sends HR=0 (reconnecting, resetting, or cold-starting), the participant should be visually dimmed and exempt from all governance rules until valid HR returns.

**Problem:** During HR monitor resets, the device reconnects but sends HR=0 until it catches up. The UI shows "0 bpm" or "No HR data" on lock screens, warning overlays, avatars, and cards. Worse, governance treats these participants as failing zone requirements — triggering false warnings and locks.

**Approach:** Add an `hrInactive` boolean flag to `User.currentData` in UserManager. This flag flows through the existing data pipeline (roster → ParticipantFactory → FitnessContext → consumers). All governance and display consumers read this single flag instead of independently computing HR validity.

---

## Data Model

### UserManager.js (`frontend/src/hooks/fitness/UserManager.js`)

**`#createDefaultCurrentData()` (line ~49):** Add `hrInactive: true` to the returned object. New users start inactive until first valid HR arrives.

**`#updateCurrentData()` (lines 63-81):** This method rebuilds `this.currentData` from scratch, which would clobber `hrInactive` if only set in `#updateHeartRateData`. Add `hrInactive` to both paths:
- Line 66 (no zoneSnapshot / fallback path): `hrInactive: true` in the object built via `#createDefaultCurrentData`
- Line 70-81 (valid zoneSnapshot path): Add `hrInactive: false` to the object literal

**`#updateHeartRateData()` (lines 84-92):** When HR clears to null (HR=0 received), set `this.currentData.hrInactive = true`. This handles the early-return path before `#updateCurrentData` is called.

```javascript
#updateHeartRateData(heartRate) {
  if (!heartRate || heartRate <= 0) {
    this.currentData.heartRate = null;
    this.currentData.zone = null;
    this.currentData.color = null;
    this.currentData.hrInactive = true;   // <-- new
    return;
  }
  // hrInactive = false is set in #updateCurrentData (called at line 113)
  // ... existing zone computation, then calls #updateCurrentData(zoneSnapshot) ...
}
```

**`summary` getter (line ~198):** Include `hrInactive: this.currentData.hrInactive` in the returned object.

**`resetSession()` (line ~191):** Calls `#createDefaultCurrentData()`, so `hrInactive: true` is automatically set on reset. No additional change needed.

---

## Propagation

The flag must be explicitly added at each layer — these objects are constructed field-by-field, not spread.

### ParticipantRoster.js (`frontend/src/hooks/fitness/ParticipantRoster.js`)

**`_buildRosterEntry()` (line ~432-453):** Add `hrInactive` as a new named field in the roster entry object. Source from the mapped user's `currentData.hrInactive`:

```javascript
const rosterEntry = {
  // ... existing fields ...
  isActive,
  inactiveSince: device.inactiveSince || null,
  hrInactive: mappedUser?.currentData?.hrInactive ?? true,  // <-- new
};
```

Default to `true` when no mapped user exists (no data = inactive).

### ParticipantFactory.js (`frontend/src/modules/Fitness/domain/ParticipantFactory.js`)

**`fromRosterEntry()` (lines 70-89):** Add `hrInactive` as a new named field in the participant object:

```javascript
return {
  // ... existing fields ...
  isActive,
  hrInactive: rosterEntry.hrInactive ?? false,  // <-- new
};
```

### FitnessContext.jsx (`frontend/src/context/FitnessContext.jsx`)

No changes needed. The flag is on roster entries and participant objects, which are already exposed via `participantRoster` and `activeHeartRateParticipants`.

**Note:** `heartRateDevices` (line 1326) are raw Device objects from DeviceManager — they do NOT have `hrInactive`. The FullscreenVitalsOverlay already calls `getUserByDevice()` to get user info; it will resolve `hrInactive` through that lookup (see Display Layer section).

---

## Governance Exemption

### FitnessSession.js (`frontend/src/hooks/fitness/FitnessSession.js`)

**`_evaluateGovernance()` (lines 1610-1614):** This is where `activeParticipants` is built from the roster before being passed to `governanceEngine.evaluate()`. Add `hrInactive` to the existing filter:

```javascript
// Before:
const activeParticipants = effectiveRoster
    .filter((entry) => {
      const isActive = entry.isActive !== false;
      return isActive && (entry.id || entry.profileId);
    })
    .map(entry => entry.id || entry.profileId);

// After:
const activeParticipants = effectiveRoster
    .filter((entry) => {
      const isActive = entry.isActive !== false;
      const hrActive = !entry.hrInactive;
      return isActive && hrActive && (entry.id || entry.profileId);
    })
    .map(entry => entry.id || entry.profileId);
```

This means hrInactive participants never reach the governance engine at all — no changes needed to GovernanceEngine's `evaluate()`, `_evaluateZoneRequirement()`, or `_evaluateChallenges()`. The engine sees a reduced `totalCount`, which correctly adjusts "all"/"majority" rules to only count participants with valid HR.

**Challenge behavior:** If an hrInactive user was the only one failing a challenge, the challenge may auto-succeed with the reduced participant count. This is intentional — you cannot require someone with no HR data to reach a zone. When their HR returns, they re-enter governance and new challenges will include them.

### GovernanceEngine.js — `_composeState()` (line ~1249)

**Add `hrInactiveUsers` to the state snapshot:** Even though hrInactive users are filtered out of `activeParticipants`, the display layer needs to know about them for defensive filtering. Add:

```javascript
hrInactiveUsers: Array.isArray(this._latestInputs?.hrInactiveUsers)
  ? [...this._latestInputs.hrInactiveUsers]
  : []
```

**FitnessSession.js** should also pass this list alongside `activeParticipants`:

```javascript
// Build hrInactive list for display layer
const hrInactiveUsers = effectiveRoster
    .filter(entry => entry.hrInactive && (entry.id || entry.profileId))
    .map(entry => entry.id || entry.profileId);

this.governanceEngine.evaluate({
    activeParticipants,
    userZoneMap,
    zoneRankMap,
    zoneInfoMap,
    totalCount: activeParticipants.length,
    hrInactiveUsers  // <-- new
});
```

### resolveGovernanceDisplay (`frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`)

**Defensive filter:** Since hrInactive users are excluded from governance evaluation entirely, they should never appear in `missingUsers`. But as defense-in-depth, skip any `missingUsers` entry that appears in `govState.hrInactiveUsers`:

```javascript
const hrInactiveSet = new Set((govState.hrInactiveUsers || []).map(normalize));

// In base requirements loop (lines 28-38):
(req.missingUsers || []).forEach((userId) => {
  const key = normalize(userId);
  if (hrInactiveSet.has(key)) return;  // <-- new guard
  // ... existing logic ...
});

// In challenge requirements (lines 40-50):
// Already guarded by !challenge.paused from previous fix;
// add hrInactive guard too:
challenge.missingUsers.forEach((userId) => {
  const key = normalize(userId);
  if (hrInactiveSet.has(key)) return;  // <-- new guard
  // ... existing logic ...
});
```

---

## Display Layer

### FullscreenVitalsOverlay.jsx (`frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`)

**Line 160:** The overlay consumes raw `heartRateDevices` from context (Device objects, not roster entries). It already calls `getUserByDevice(device.deviceId)` to resolve user info. Resolve `hrInactive` via the same lookup:

```javascript
const user = getUserByDevice?.(device.deviceId);
const userHrInactive = user?.currentData?.hrInactive ?? false;
const isInactive = userHrInactive || device.inactiveSince || device.connectionState !== 'connected';
```

This replaces the current `!hrValid` check with the centralized flag. The `!hrValid` local computation is removed.

### Shared FullscreenVitalsOverlay.jsx (`frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx`)

Same change as primary FullscreenVitalsOverlay — resolve `hrInactive` via `getUserByDevice` lookup.

### CircularUserAvatar.jsx (`frontend/src/modules/Fitness/components/CircularUserAvatar.jsx`)

**No changes to the component itself.** The existing pattern (used by FullscreenVitalsOverlay) passes `className="inactive"` from the parent when the item is inactive. The `.inactive` CSS class already provides: `opacity: 0.5`, `filter: grayscale(0.8)`, faded progress ring, hidden indicator dot. The HR text is already hidden when `heartRate <= 0` (line 162-166).

All call sites that render CircularUserAvatar should pass `className="inactive"` when `hrInactive` is true. This is already done by FullscreenVitalsOverlay (line 248).

### PersonCard.jsx (`frontend/src/modules/Fitness/player/panels/RealtimeCards/PersonCard.jsx`)

**Line ~44:** Use `hrInactive` from participant data to drive inactive styling. The component already accepts `isInactive` prop — ensure callers pass `hrInactive` through.

### FitnessUsers.jsx (`frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`)

**Line ~982:** Currently computes inactive as: `device.isActive === false || !!device.inactiveSince`. Add `hrInactive`:

```javascript
const isInactive = device.isActive === false || !!device.inactiveSince || !!device.hrInactive;
```

This ensures the FitnessUsers panel is consistent with other surfaces.

### SidebarFooter.jsx (`frontend/src/modules/Fitness/nav/SidebarFooter.jsx`)

**`computeDeviceActive()` (lines 65-72):** Add `hrInactive` check at the top:

```javascript
if (device.hrInactive) return false;
```

### GovernanceStateOverlay.jsx

No changes needed — hrInactive users won't appear in the rows because they're filtered out upstream.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| All participants hrInactive | No evaluable participants — governance stays in current phase, no new warnings triggered |
| HR monitor reconnects (HR goes 0 → valid) | `hrInactive` flips to `false` immediately, participant re-enters governance on next tick |
| New user joins with no HR yet | Starts `hrInactive: true` (default), becomes active on first valid HR reading |
| Device disconnects entirely | `inactiveSince` is set by DeviceManager (existing), `hrInactive` also true since HR cleared to null |
| Warning active when user goes hrInactive | User removed from `activeParticipants` — if remaining users satisfy requirements, governance transitions to unlocked. If user comes back still in low zone, a NEW grace period starts (intentional). |
| Challenge active when user goes hrInactive | User removed from evaluation — challenge denominator reduced. May auto-succeed if hrInactive user was only one failing. Intentional: can't require someone with no HR data. |
| Only participant goes hrInactive | `totalCount` drops to 0 — governance sees no participants, stays in current phase |

---

## Testing Strategy

### Unit Tests

1. **UserManager:** `hrInactive` flag set/cleared correctly on HR=0 and HR>0. Verify `#updateCurrentData` doesn't clobber it.
2. **ParticipantRoster:** `hrInactive` propagated from user.currentData to roster entry
3. **ParticipantFactory:** `hrInactive` propagated from roster entry to participant object
4. **FitnessSession:** hrInactive participants excluded from `activeParticipants` passed to governance
5. **resolveGovernanceDisplay:** hrInactive users not shown in warning/lock rows (defensive filter)

### Integration Scenario

Simulate the exact bug scenario:
- 4 participants active, governance unlocked
- One participant's HR drops to 0 (monitor reset)
- Verify: no governance warning triggered, participant shown dimmed on vitals overlay
- HR returns to valid value → participant re-enters governance normally

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/fitness/UserManager.js` | Add `hrInactive` to `#createDefaultCurrentData`, `#updateCurrentData`, `#updateHeartRateData`, `summary` |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Add `hrInactive` field to roster entry in `_buildRosterEntry` |
| `frontend/src/modules/Fitness/domain/ParticipantFactory.js` | Add `hrInactive` field to participant in `fromRosterEntry` |
| `frontend/src/hooks/fitness/FitnessSession.js` | Filter hrInactive from `activeParticipants`, pass `hrInactiveUsers` to engine |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Store and expose `hrInactiveUsers` in `_composeState` |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | Defensive filter for hrInactive in `missingUsers` |
| `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` | Use `hrInactive` via `getUserByDevice` lookup |
| `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` | Same as above |
| `frontend/src/modules/Fitness/player/panels/RealtimeCards/PersonCard.jsx` | Use `hrInactive` for inactive styling |
| `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` | Add `hrInactive` to inactive computation |
| `frontend/src/modules/Fitness/nav/SidebarFooter.jsx` | Add `hrInactive` check to `computeDeviceActive` |
