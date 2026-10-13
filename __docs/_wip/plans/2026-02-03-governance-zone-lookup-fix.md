# Governance Zone Lookup Fix - Proper Solution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix zone label resolution by normalizing zone IDs at lookup time, then remove all duct tape fallbacks.

**Architecture:** The root cause is a key normalization mismatch: `zoneInfoMap` keys are normalized (lowercase) but lookups use raw zone IDs. Fix by adding helper methods that normalize before lookup, then remove all compensating fallback code.

**Tech Stack:** React, GovernanceEngine.js, FitnessPlayerOverlay.jsx, ParticipantRoster.js, FitnessContext.jsx

**Exit Criteria:** `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs` passes with NO "Target zone" placeholders, AND codebase has fewer lines than before (duct tape removed).

---

## Task 1: Add Zone Lookup Helper Methods

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

**Problem:** Direct `zoneInfoMap[zoneId]` lookups fail when zoneId isn't normalized but map keys are.

**Step 1: Add helper methods after the normalizeZoneId function (around line 24)**

```javascript
// Add these as class methods in GovernanceEngine class (around line 240)

/**
 * Get zone info with normalized key lookup
 * @param {string} zoneId - Raw zone ID (will be normalized)
 * @returns {Object|null} Zone info object or null
 */
_getZoneInfo(zoneId) {
  if (!zoneId) return null;
  const normalized = normalizeZoneId(zoneId);
  return this._latestInputs?.zoneInfoMap?.[normalized] || null;
}

/**
 * Get zone rank with normalized key lookup
 * @param {string} zoneId - Raw zone ID (will be normalized)
 * @returns {number|null} Zone rank or null
 */
_getZoneRank(zoneId) {
  if (!zoneId) return null;
  const normalized = normalizeZoneId(zoneId);
  const rank = this._latestInputs?.zoneRankMap?.[normalized];
  return Number.isFinite(rank) ? rank : null;
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
feat(fitness): add zone lookup helpers with normalized keys

_getZoneInfo() and _getZoneRank() normalize zone IDs before
lookup, fixing key mismatch where map keys are normalized but
lookup keys weren't.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Replace Direct zoneInfoMap Lookups

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

**Step 1: Update _logZoneChanges (lines 261-262)**

Replace:
```javascript
fromZoneLabel: zoneInfoMap[prevZone]?.name || prevZone,
toZoneLabel: zoneInfoMap[newZone]?.name || newZone,
```

With:
```javascript
fromZoneLabel: this._getZoneInfo(prevZone)?.name || prevZone,
toZoneLabel: this._getZoneInfo(newZone)?.name || newZone,
```

**Step 2: Update _buildChallengeSnapshot (line 297)**

Replace:
```javascript
const zoneInfo = activeChallenge.zone ? zoneInfoMap[activeChallenge.zone] : null;
```

With:
```javascript
const zoneInfo = this._getZoneInfo(activeChallenge.zone);
```

**Step 3: Update _getParticipantStates (line 680)**

Replace:
```javascript
zoneLabel: zoneInfoMap[zoneId]?.name || zoneId,
```

With:
```javascript
zoneLabel: this._getZoneInfo(zoneId)?.name || zoneId,
```

**Step 4: Update _buildRequirementShell (lines 1483-1484)**

Replace:
```javascript
const requiredRank = zoneRankMap[zoneId];
const zoneInfo = zoneInfoMap[zoneId];
```

With:
```javascript
const requiredRank = this._getZoneRank(zoneId);
const zoneInfo = this._getZoneInfo(zoneId);
```

**Step 5: Update _evaluateZoneRequirement (lines 1537, 1550-1551, 1567)**

Replace:
```javascript
const requiredRank = zoneRankMap[zoneId];
```

With:
```javascript
const requiredRank = this._getZoneRank(zoneId);
```

Replace:
```javascript
const participantRank = participantZoneId && Number.isFinite(zoneRankMap[participantZoneId])
  ? zoneRankMap[participantZoneId]
```

With:
```javascript
const participantRank = this._getZoneRank(participantZoneId);
```

Replace:
```javascript
const zoneInfo = zoneInfoMap[zoneId];
```

With:
```javascript
const zoneInfo = this._getZoneInfo(zoneId);
```

**Step 6: Update buildChallengeSummary (lines 1844-1845, 1857)**

Replace:
```javascript
const zoneInfo = zoneInfoMap[zoneId];
const requiredRank = zoneRankMap[zoneId] || 0;
```

With:
```javascript
const zoneInfo = this._getZoneInfo(zoneId);
const requiredRank = this._getZoneRank(zoneId) ?? 0;
```

Replace:
```javascript
const pRank = pZone && Number.isFinite(zoneRankMap[pZone]) ? zoneRankMap[pZone] : 0;
```

With:
```javascript
const pRank = this._getZoneRank(pZone) ?? 0;
```

**Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
refactor(fitness): use zone lookup helpers throughout GovernanceEngine

Replaces all direct zoneInfoMap[key] and zoneRankMap[key] accesses
with _getZoneInfo() and _getZoneRank() helpers that normalize keys.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remove 'Target zone' Fallbacks from GovernanceEngine

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

**Step 1: Fix line 1029 in _composeState**

Replace:
```javascript
zoneLabel: challengeSnapshot.zoneLabel || challengeSnapshot.zone || 'Target zone',
```

With:
```javascript
zoneLabel: challengeSnapshot.zoneLabel || challengeSnapshot.zone || null,
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
fix(fitness): remove 'Target zone' fallback from GovernanceEngine

Zone labels should come from zoneInfoMap or be null, never a
hardcoded placeholder string.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Remove 'Target zone' Fallbacks from UI

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/ChallengeOverlay.jsx`

**Step 1: Fix useGovernanceOverlay (lines 73, 85)**

Replace line 73:
```javascript
const challengeZoneLabel = challenge?.zoneLabel || challenge?.zone || 'Target zone';
```

With:
```javascript
const challengeZoneLabel = challenge?.zoneLabel || challenge?.zone || null;
```

Replace line 85:
```javascript
const baseZone = challengeZoneLabel || 'Target zone';
```

With:
```javascript
const baseZone = challengeZoneLabel || 'Zone';
```

**Step 2: Fix ChallengeOverlay.jsx line 255**

Replace:
```javascript
const zoneLabel = challenge.zoneLabel || challenge.zone || 'Target zone';
```

With:
```javascript
const zoneLabel = challenge.zoneLabel || challenge.zone || 'Zone';
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx frontend/src/modules/Fitness/FitnessPlayerOverlay/ChallengeOverlay.jsx
git commit -m "$(cat <<'EOF'
fix(fitness): remove 'Target zone' fallbacks from UI components

UI should trust domain layer to provide resolved labels. Generic
'Zone' fallback only for edge cases where zone is truly unknown.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Remove baseZoneId Duct Tape

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

**Step 1: Remove _getBaseZoneId method (lines 1130-1141)**

Delete the entire method:
```javascript
_getBaseZoneId() {
  const activePolicy = this._chooseActivePolicy(this._latestInputs?.totalCount || 0);
  if (!activePolicy?.baseRequirement) return null;

  // baseRequirement is { zone_id: rule } e.g., { active: 'all' }
  const entries = Object.entries(activePolicy.baseRequirement);
  if (entries.length === 0) return null;

  // Return the first zone key (normalized)
  const [zoneKey] = entries[0];
  return zoneKey ? String(zoneKey).toLowerCase() : null;
}
```

**Step 2: Remove baseZoneId from state (line 1103)**

Delete:
```javascript
baseZoneId: this._getBaseZoneId(),
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
refactor(fitness): remove baseZoneId from governance state

No longer needed now that zone lookups are properly normalized.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Remove PHASE 6B FIX Duct Tape

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`

**Step 1: Remove hasParticipantsButNoRequirements logic (lines 634-642)**

Replace:
```javascript
// PHASE 6B FIX: When requirements are empty but participants exist,
// show placeholder rows so UI doesn't display "Waiting for participant data..."
// This covers the timing gap between participantRoster population and TreasureBox data arrival.
// Once TreasureBox records HR data, GovernanceEngine will populate proper requirements.
const hasParticipantsButNoRequirements = requirementList.length === 0 && participants.length > 0;

if (requirementList.length === 0 && !hasParticipantsButNoRequirements) {
  return [];
}
```

With:
```javascript
if (requirementList.length === 0) {
  return [];
}
```

**Step 2: Remove PHASE 6B FIX block (lines 1027-1076)**

Delete the entire block starting with:
```javascript
// PHASE 6B FIX: If no rows were built from requirements but participants exist,
```

And ending with:
```javascript
});
}
```

**Step 3: Remove isIdentityOnly check (lines 873-876)**

Delete:
```javascript
const isIdentityOnly = resolvedParticipant?._source === 'identity_only';
if (isIdentityOnly) {
  return null;
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "$(cat <<'EOF'
refactor(fitness): remove PHASE 6B FIX duct tape

No longer needed now that zone lookups are properly normalized.
The fallback rows with placeholder data are no longer necessary.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remove Identity Roster Duct Tape

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js`
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Remove getIdentityRoster method from ParticipantRoster (lines 136-154)**

Delete the entire method.

**Step 2: Remove _buildIdentityEntry method from ParticipantRoster (lines 321-365)**

Delete the entire method.

**Step 3: Remove identity roster fallback from FitnessContext (around line 1326)**

Find and remove:
```javascript
// Fallback: identity-only roster (no vitals yet)
const identityRoster = fitnessSessionRef.current?.participantRoster?.getIdentityRoster?.() || [];
if (identityRoster.length > 0) {
  return identityRoster;
}
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js frontend/src/context/FitnessContext.jsx
git commit -m "$(cat <<'EOF'
refactor(fitness): remove identity roster duct tape

No longer needed now that zone lookups are properly normalized.
Participants show up with proper zone labels on first render.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Remove Duct Tape zoneConfig Seeding

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`
- Modify: `frontend/src/context/FitnessContext.jsx`

**Note:** Keep the zoneConfig seeding in configure() - this is GOOD code that ensures zoneInfoMap is populated early. Only remove if it's duplicating logic that exists elsewhere.

**Step 1: Verify zoneConfig seeding is still needed**

The seeding code in configure() (lines 420-443) should STAY - it's part of the proper fix, ensuring zoneInfoMap has data before first evaluate().

**Step 2: Clean up any duplicate seeding if found**

If zoneConfig is being passed redundantly from multiple places, consolidate to one.

**Step 3: Commit only if changes made**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/context/FitnessContext.jsx
git commit -m "$(cat <<'EOF'
refactor(fitness): consolidate zoneConfig seeding

Ensures zoneInfoMap is populated exactly once during configure().

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Run Verification Test

**Step 1: Run the hydration monitor test**

```bash
npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs --reporter=line
```

**Expected output:**
- NO `targetZone="Target zone"` in any phase
- Rows appear with correct zone labels (e.g., "Active") immediately
- Test passes

**Step 2: Count lines removed**

```bash
git diff --stat governance-hydration-duct-tape-v2..HEAD
```

**Expected:** Net negative lines (more removed than added)

**Step 3: If test fails, debug**

Check if there are other places with 'Target zone' fallback:
```bash
grep -rn "Target zone" frontend/src/
```

---

## Summary

| Change | Type | Lines |
|--------|------|-------|
| Add zone lookup helpers | Fix | +20 |
| Replace direct map access | Refactor | ~0 (replacements) |
| Remove 'Target zone' fallbacks | Fix | -5 |
| Remove baseZoneId | Remove duct tape | -15 |
| Remove PHASE 6B FIX | Remove duct tape | -50 |
| Remove identity roster | Remove duct tape | -80 |
| **Net** | | **-130 lines** |

The proper fix makes the codebase SMALLER and SIMPLER while fixing the actual bug.
