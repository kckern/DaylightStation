# Governance Lock Screen Hydration Fix v2

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate remaining "Target zone" and HR 60 placeholders by fixing the PHASE 6B fallback code in FitnessPlayerOverlay.

**Architecture:** The PHASE 6B FIX creates lock screen rows when participants exist but governance requirements array is empty/unsatisfied. The fallback `defaultTarget` uses `'Target zone'` and zone minimum (60) as placeholders. Fix by looking up the actual target zone from `zoneMetadata` using governance policy config.

**Tech Stack:** React, FitnessPlayerOverlay.jsx, GovernanceEngine.js

**Exit Criteria:** `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs` shows NO "Target zone" or "60" placeholder values in ANY hydration phase.

---

## Task 1: Add Target Zone ID to Governance State

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

**Problem:** The governance state doesn't expose the policy's target zone ID, so FitnessPlayerOverlay can't look it up in zoneMetadata.

**Step 1: Read the state getter to understand structure**

File: `frontend/src/hooks/fitness/GovernanceEngine.js` - find `get state()` getter

**Step 2: Add baseZoneId to the state**

Find where `requirementSummary` is used to build state, and add the base zone ID from the active policy:

```javascript
// In the state getter, add:
baseZoneId: this._getBaseZoneId(),
```

And add the helper method:

```javascript
_getBaseZoneId() {
  const activePolicy = this._chooseActivePolicy(this._latestInputs?.totalCount || 0);
  if (!activePolicy?.baseRequirement) return null;

  // baseRequirement is { zone_id: rule } or { active: 'all' }
  const entries = Object.entries(activePolicy.baseRequirement);
  if (entries.length === 0) return null;

  // Return the first zone key (normalized)
  const [zoneKey] = entries[0];
  return zoneKey ? String(zoneKey).toLowerCase() : null;
}
```

**Step 3: Verify the state includes baseZoneId**

No test needed - will be verified in Task 3.

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
feat(fitness): expose baseZoneId in governance state

Allows lock screen UI to look up zone label from zoneMetadata
even when requirement.zoneLabel is not yet populated.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix PHASE 6B Default Target to Use Zone Metadata

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:1027-1064`

**Problem:** The PHASE 6B FIX creates a `defaultTarget` with hardcoded `'Target zone'` fallback and uses zone minimum (60) for targetBpm.

**Step 1: Read current PHASE 6B code**

File: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` lines 1027-1064

**Step 2: Fix the defaultTarget construction**

Replace lines 1030-1047:

```javascript
const derivedTarget = fallbackRequirement ? buildTargetInfo(fallbackRequirement) : null;

// When no fallback requirement, try to get zone from governance state's base policy
const baseZoneId = !derivedTarget && governanceState?.baseZoneId
  ? normalizeZoneId(governanceState.baseZoneId)
  : null;
const baseZoneInfo = baseZoneId ? zoneMetadata?.map?.[baseZoneId] : null;

const defaultTarget = derivedTarget || {
  zoneInfo: baseZoneInfo || aggregateZone || zoneMetadata.map[Object.keys(zoneMetadata.map)[0]] || null,
  label: baseZoneInfo?.name
    || fallbackRequirement?.zoneLabel
    || fallbackRequirement?.ruleLabel
    || (zoneMetadata?.map?.[normalizeZoneId(fallbackRequirement?.zone)]?.name)
    || (fallbackRequirement?.zone ? fallbackRequirement.zone.charAt(0).toUpperCase() + fallbackRequirement.zone.slice(1) : null)
    || aggregateZone?.name
    || 'Target',  // Changed from 'Target zone'
  // Don't use zone minimum as target - show null (renders "--") until user-specific
  targetBpm: Number.isFinite(fallbackRequirement?.threshold)
    ? fallbackRequirement.threshold
    : null  // Changed from aggregateZone?.min
};
```

**Step 3: Verify governanceState is in scope**

Check that `governanceState` is available in the `lockRows` useMemo. It's in the dependency array at line 1067.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "$(cat <<'EOF'
fix(fitness): use zone metadata in PHASE 6B lock screen fallback

- Look up zone name from zoneMetadata using governance baseZoneId
- Change final fallback from 'Target zone' to 'Target'
- Don't show zone minimum as target HR (show "--" instead)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Run Verification Test

**Files:** None (verification only)

**Step 1: Run the hydration monitor test**

```bash
npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs --reporter=line
```

**Expected output:**
- NO `targetZone="Target zone"` in any phase
- NO `meta="XX / 60"` in any phase (should show user-specific targets or "--")
- `FULLY_HYDRATED` should show `targetZone="Active"` with correct HRs

**Step 2: If test still shows placeholders**

Check the rapid poll phase output. If "Target zone" still appears, there's another code path. Search for all occurrences:

```bash
grep -rn "Target zone" frontend/src/modules/Fitness/
```

**Step 3: Commit verification if needed**

If test assertions need updating:

```bash
git add tests/live/flow/fitness/
git commit -m "$(cat <<'EOF'
test(fitness): update hydration test for fixed placeholders

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Fallback Plan: Direct Zone Lookup in buildTargetInfo

If Tasks 1-2 don't fully fix the issue, the problem is in `buildTargetInfo()` itself.

**Alternative fix for buildTargetInfo (line 802-807):**

```javascript
// Before the label fallback chain, ensure we have zoneInfo from metadata
if (!zoneInfo && zoneId && zoneMetadata?.map?.[zoneId]) {
  zoneInfo = zoneMetadata.map[zoneId];
}

const label = requirement?.zoneLabel
  || zoneInfo?.name
  || zoneFromMetadata?.name
  || requirement?.ruleLabel
  || (targetZoneId ? targetZoneId.charAt(0).toUpperCase() + targetZoneId.slice(1) : null)
  || 'Target';  // Keep generic, not 'Target zone'
```

This ensures `zoneInfo` is populated from `zoneMetadata` before the fallback chain runs.

---

## Summary

| Issue | Current Value | Fixed Value | Location |
|-------|--------------|-------------|----------|
| Zone label placeholder | "Target zone" | "Active" (from metadata) | FitnessPlayerOverlay:1043 |
| Target HR placeholder | 60 (zone min) | null ("--") | FitnessPlayerOverlay:1044-1046 |

The fix ensures that even during early renders when GovernanceEngine hasn't fully populated `zoneLabel`, the UI can still look up the correct zone name from `zoneMetadata`.
