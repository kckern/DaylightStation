# Governance Lock Screen Pre-Load Fix

**Date:** 2026-02-02  
**Status:** Plan  
**Priority:** High (UI polish)  
**Reported Issue:** "Target" fallback text appears for ~2 seconds before "Active" zone label loads

## Problem Summary

When governed video starts, the lock screen briefly shows fallback text ("Target zone") instead of the configured zone label ("Active"). This happens because:

1. Video starts → governance detects governed content → calls `evaluate()`
2. At this moment, no HR data has arrived yet → `activeParticipants = []`
3. Engine sets phase to `pending` but **skips requirement evaluation**
4. `requirementSummary.requirements` stays empty (from `reset()`)
5. UI sees `overlay.requirements = []` → falls back to "Target zone"
6. ~2 seconds later when TreasureBox receives HR → `evaluate()` runs again
7. NOW requirements get populated with proper `zoneLabel: "Active"`

## Root Cause

In `GovernanceEngine.js`, the `evaluate()` function has an early return when there are no participants:

```javascript
// Line 1209-1227
if (activeParticipants.length === 0) {
  getLogger().warn('governance.evaluate.no_participants');
  this._clearTimers();
  this._setPhase('pending');  // ← Sets phase
  this._latestInputs = { ... };
  this._invalidateStateCache();
  return;  // ← EARLY RETURN - requirements never evaluated!
}
```

The actual requirement evaluation (step 5) only happens AFTER this check passes:

```javascript
// Line 1254 (only reached if activeParticipants.length > 0)
const { summaries, allSatisfied } = this._evaluateRequirementSet(...);
this.requirementSummary = {
  policyId: activePolicy.id,
  requirements: summaries,  // ← Only populated here
  ...
};
```

## Why This Is Wrong

The policy and zone configuration are **static** - they don't depend on participant data. We know:
- Which zones are configured (e.g., "Active", "Warm", "Cool")
- What the base requirement is (e.g., "all participants must reach Active")
- The zone labels and colors

None of this requires HR data. The only thing that requires HR data is:
- Which users are currently meeting the requirement
- The `satisfied` status

## Remediation Plan

### Option A: Pre-populate requirements from policy (Recommended)

When entering `pending` phase with no participants, still build the requirement structure using the policy configuration. Just mark `missingUsers: []` and `satisfied: false`.

**Changes to `GovernanceEngine.js`:**

```javascript
// In evaluate(), BEFORE the "no participants" early return:
if (activeParticipants.length === 0) {
  // NEW: Pre-populate requirements from policy even without participants
  const activePolicy = this._chooseActivePolicy(0);
  if (activePolicy) {
    const baseRequirement = activePolicy.baseRequirement || {};
    const prePopulatedRequirements = this._buildRequirementShell(
      baseRequirement, 
      zoneRankMap, 
      zoneInfoMap
    );
    this.requirementSummary = {
      policyId: activePolicy.id,
      targetUserCount: activePolicy.minParticipants,
      requirements: prePopulatedRequirements,
      activeCount: 0
    };
  }
  
  this._clearTimers();
  this._setPhase('pending');
  this._latestInputs = { ... };
  this._invalidateStateCache();
  return;
}
```

New helper method:

```javascript
_buildRequirementShell(requirementMap, zoneRankMap, zoneInfoMap) {
  if (!requirementMap || typeof requirementMap !== 'object') {
    return [];
  }
  const entries = Object.entries(requirementMap).filter(([key]) => key !== 'grace_period_seconds');
  
  return entries.map(([zoneKey, rule]) => {
    const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
    if (!zoneId) return null;
    
    const requiredRank = zoneRankMap[zoneId];
    const zoneInfo = zoneInfoMap[zoneId];
    
    return {
      zone: zoneId,
      zoneLabel: zoneInfo?.name || zoneId,
      targetZoneId: zoneId,
      participantKey: null,
      severity: Number.isFinite(requiredRank) ? requiredRank : null,
      rule,
      ruleLabel: this._describeRule(rule, 0),
      requiredCount: null, // Unknown until we have participant count
      actualCount: 0,
      metUsers: [],
      missingUsers: [], // Empty - no participants to be missing
      satisfied: false
    };
  }).filter(Boolean);
}
```

### Option B: Immediate evaluation on media change

Call `evaluate()` immediately when `setMedia()` is called, rather than waiting for TreasureBox callback.

```javascript
setMedia(media) {
  this.media = media;
  // NEW: Trigger immediate evaluation to pre-populate requirements
  if (this._mediaIsGoverned()) {
    this.evaluate();
  }
}
```

This is simpler but relies on `zoneInfoMap` being available at media change time.

### Option C: UI-side fallback improvement

If the requirements array is empty but we know the governance config, the UI could derive the zone label from the governance config directly.

This is a workaround, not a fix. It masks the problem instead of solving it.

## Recommended Implementation: Option A

Option A is cleanest because:
1. Keeps the fix in one place (GovernanceEngine)
2. Doesn't change timing/calling patterns
3. Provides proper data structure even when no participants
4. Logging can capture the pre-populated state

## Logging Improvements

Regardless of fix choice, add requirements to `governance.phase_change` log:

```javascript
// In _setPhase(), add to the log payload:
logger.sampled('governance.phase_change', {
  from: oldPhase,
  to: newPhase,
  mediaId: this.media?.id,
  deadline: this.meta?.deadline,
  satisfiedOnce: this.meta?.satisfiedOnce,
  // NEW: Include requirement summary for debugging
  requirementCount: this.requirementSummary?.requirements?.length || 0,
  firstRequirement: this.requirementSummary?.requirements?.[0] 
    ? {
        zone: this.requirementSummary.requirements[0].zone,
        zoneLabel: this.requirementSummary.requirements[0].zoneLabel,
        satisfied: this.requirementSummary.requirements[0].satisfied
      }
    : null
}, { maxPerMinute: 30 });
```

## Testing Checklist

- [ ] Start governed video with no HR devices connected
  - Lock screen should show proper zone label ("Active") immediately
  - Logs should show `requirementCount > 0` on phase change to pending
- [ ] Start governed video with HR devices connected but no HR data yet
  - Lock screen should show proper zone label immediately
  - Should transition to unlocked when HR arrives
- [ ] Verify existing behavior unchanged:
  - Grace period countdown works
  - Warning/locked transitions work
  - Challenge requirements work

## Files to Modify

1. `frontend/src/hooks/fitness/GovernanceEngine.js`
   - Add `_buildRequirementShell()` method
   - Modify `evaluate()` to pre-populate requirements
   - Enhance `_setPhase()` logging

## Related Code

- [GovernanceEngine.js#L1209-L1227](frontend/src/hooks/fitness/GovernanceEngine.js#L1209-L1227) - Early return that skips requirement evaluation
- [GovernanceEngine.js#L1254-L1259](frontend/src/hooks/fitness/GovernanceEngine.js#L1254-L1259) - Where requirements get populated
- [GovernanceEngine.js#L1373-L1450](frontend/src/hooks/fitness/GovernanceEngine.js#L1373-L1450) - `_evaluateRequirementSet()` and `_evaluateZoneRequirement()`
- [FitnessPlayerOverlay.jsx#L628-L1050](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L628-L1050) - `lockRows` useMemo with fallback handling
