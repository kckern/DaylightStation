# Bug 04: Phantom Governance Warnings

**Severity:** High
**Area:** Logic
**Status:** Open

## Summary

The governance warning UI appears without a valid trigger. Warnings flash briefly with no specific "offender" chip listed, even when users are within safe thresholds.

## Symptoms

1. Warning flashes for a second with no specific "offender" chip listed
2. Users are within safe thresholds (not warm/cool), yet warning triggers
3. Warning appears momentarily then disappears

## Root Cause Hypothesis

The warning state is being set without proper validation that an actual offender exists. The UI should strictly check for an "offender" object in the Single Source of Truth before rendering the warning state.

## Relevant Code

### Governance Engine Phase Management
**File:** `frontend/src/hooks/fitness/GovernanceEngine.js`

| Function | Lines | Purpose |
|----------|-------|---------|
| `evaluate()` | 766 | Main governance evaluation loop |
| `_setPhase()` | 453 | Phase transitions (pending → warning → locked → unlocked) |
| `_composeState()` | 639 | Builds governance state for rendering |

**Phase states:** `pending`, `unlocked`, `warning`, `locked`

### Warning Offender Computation
**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`

| Function | Lines | Purpose |
|----------|-------|---------|
| `useGovernanceOverlay()` | 49-289 | Transforms governance state to UI props |
| `warningOffenders` computation | 518-591 | Builds offender chip data with progress |

### Warning Overlay Component
**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx`

| Component | Lines | Purpose |
|-----------|-------|---------|
| `GovernanceWarningOverlay` | 7-85 | Displays countdown and offender chips |

## Likely Failure Points

1. **Phase transition without offender validation:**
   - `_setPhase('warning')` may be called before offender data is populated
   - Race condition between state computation and UI render

2. **Stale state in composition:**
   - `_composeState()` may include warning status from previous evaluation
   - Caching (200ms throttle) may serve outdated state

3. **Empty offenders array treated as valid:**
   - UI may show warning even when `offenders.length === 0`
   - Missing guard in `GovernanceWarningOverlay`

4. **Zone threshold edge cases:**
   - Users oscillating near zone boundaries
   - Brief dip triggers warning before next evaluation clears it

## Fix Direction

1. **Add offender guard in `_setPhase()`:**
   ```javascript
   // Before transitioning to 'warning', verify offenders exist
   if (nextPhase === 'warning' && (!offenders || offenders.length === 0)) {
     return; // Don't transition without valid offenders
   }
   ```

2. **Add UI-level guard:**
   ```jsx
   // In GovernanceWarningOverlay
   if (!offenders?.length) return null;
   ```

3. **Stabilize zone detection:**
   - Add hysteresis to zone boundary detection
   - Require sustained threshold violation before warning

4. **Audit state composition:**
   - Ensure `warningOffenders` computation is synchronous with phase
   - Clear offenders when transitioning away from warning

5. **Add logging for debugging:**
   - Log phase transitions with offender state
   - Track warning triggers with zone data

## Testing Approach

Runtime tests should:
1. Trigger near-threshold zone oscillation
2. Verify warning only appears with valid offenders
3. Test rapid zone transitions
4. Verify no phantom warnings during normal operation
5. Test with single user and multiple users
6. Verify offender chips display when warning is shown

Tip:
We recently changed the nomenclature from green yellow red to unlocked, warning, locked. Maybe that change introduced some of the issues?