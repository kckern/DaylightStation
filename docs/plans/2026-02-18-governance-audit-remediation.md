# Governance Audit Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the confirmed bugs from the 2026-02-18 governance comprehensive code audit.

**Architecture:** Three targeted fixes — one ghost-filter bypass in FitnessSession, one stale-data diagnostic in GovernanceEngine, and one threshold calibration in user profile configs. No architectural changes needed.

**Tech Stack:** React (frontend), YAML (config)

**Audit Reference:** `docs/_wip/audits/2026-02-18-governance-comprehensive-code-audit.md`

---

## Scope

After cross-referencing the audit findings with the actual code, three issues are confirmed still present:

| # | Audit ID | Severity | Issue |
|---|----------|----------|-------|
| 1 | N1 | P1 | Path B `userZoneMap` allows `null` zones, bypassing ghost filter |
| 2 | N4 | P3 | `_setPhase()` logging reads stale `activeParticipants` count |
| 3 | CF7 | P2 | Zone threshold calibration — Alan/Milo thresholds cause warning spam |

**Note on CF1/CF2/CF3:** These carry-forward findings from the Feb 17 audit appear already fixed in the current code. `_getParticipantsBelowThreshold()` (line 716) and `_getParticipantStates()` (line 766) both use `evalContext?.userZoneMap` correctly. The `_getParticipantsBelowThreshold` function also already includes `hr`, `threshold`, and `delta` fields (lines 731-755). Task 4 below adds a verification step to confirm these are working.

---

### Task 1: Fix Path B null zones bypassing ghost filter

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1559-1565`

**Context:**

Path A (`_triggerPulse` → `evaluate()`) at GovernanceEngine.js:1242-1246 guards with `if (userId && zoneId)` and lowercases the zone:
```javascript
if (userId && zoneId) {
  userZoneMap[userId] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
}
```

Path B (`updateSnapshot` → `evaluate()`) at FitnessSession.js:1559-1565 does NOT guard:
```javascript
const userZoneMap = {};
effectiveRoster.forEach(entry => {
    const userId = entry.id || entry.profileId;
    if (userId) {
        userZoneMap[userId] = entry.zoneId || null;  // BUG: allows null
    }
});
```

The ghost filter at GovernanceEngine.js:1313 checks `id in userZoneMap` — since `null` is a valid value, participants with `null` zones pass the filter.

**Step 1: Apply the fix**

Replace lines 1559-1565 in `FitnessSession.js`:

```javascript
// Key by userId/entityId (stable, no case issues)
const userZoneMap = {};
effectiveRoster.forEach(entry => {
    const userId = entry.id || entry.profileId;
    const zoneId = entry.zoneId;
    if (userId && zoneId) {
        userZoneMap[userId] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
    }
});
```

This matches Path A's guard and lowercase normalization exactly.

**Step 2: Verify no other Path B consumers rely on null zones**

Search for any code that checks for `null` in `userZoneMap` values:
```bash
grep -n 'userZoneMap.*null\|null.*userZoneMap' frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/GovernanceEngine.js
```

Expected: No code relies on null zone values being present.

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "fix(governance): guard Path B userZoneMap against null zones

Path B (updateSnapshot) allowed null zoneId values into userZoneMap,
causing participants without zone data to pass the ghost filter.
Now matches Path A's guard: only writes non-null zones with lowercase
normalization.

Audit: N1 in 2026-02-18-governance-comprehensive-code-audit.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Fix stale participant count in phase-change logs

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:669, 683, 1333`

**Context:**

`_setPhase()` logs `this._latestInputs.activeParticipants.length` at lines 669 and 683. But `_captureLatestInputs()` runs at line 1527 (end of `evaluate()`), so during phase transitions mid-evaluation, this reads the PREVIOUS evaluation's participant count.

The fix is to add `activeParticipants` to `evalContext` so `_setPhase` can read the current value.

**Step 1: Add activeParticipants to evalContext**

At GovernanceEngine.js line 1333, change:
```javascript
const evalContext = { userZoneMap, zoneRankMap, zoneInfoMap };
```
to:
```javascript
const evalContext = { userZoneMap, zoneRankMap, zoneInfoMap, activeParticipants };
```

**Step 2: Update _setPhase logging to prefer evalContext**

At line 669, change:
```javascript
activeParticipantCount: this._latestInputs?.activeParticipants?.length ?? -1,
```
to:
```javascript
activeParticipantCount: evalContext?.activeParticipants?.length ?? this._latestInputs?.activeParticipants?.length ?? -1,
```

At line 683, change:
```javascript
participantCount: this._latestInputs.activeParticipants?.length || 0,
```
to:
```javascript
participantCount: evalContext?.activeParticipants?.length ?? this._latestInputs.activeParticipants?.length ?? 0,
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix(governance): use evalContext for participant count in phase logs

Phase-change logs read stale _latestInputs.activeParticipants count
because _captureLatestInputs runs after phase transitions. Now threads
activeParticipants through evalContext for accurate logging.

Audit: N4 in 2026-02-18-governance-comprehensive-code-audit.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Calibrate zone thresholds for Alan and Milo

**Files:**
- Modify: `data/users/alan/profile.yml`
- Modify: `data/users/milo/profile.yml`

**Context:**

The Feb 17 session audit logged 19 warnings in 33 minutes from Alan's HR oscillating 121-127 BPM around his 125 BPM `active` threshold. The root cause is threshold calibration, not code.

Current thresholds vs recommended:

| User | Current `active` | Recommended `active` | Rationale |
|------|-----------------|---------------------|-----------|
| Alan (b. 2021) | 125 BPM | 118 BPM | HR floor observed at 121; need margin below |
| Milo (b. 2018) | 120 BPM | 112 BPM | Similar oscillation pattern; proportional reduction |

**Step 1: Update Alan's profile**

In `data/users/alan/profile.yml`, change:
```yaml
    heart_rate_zones:
      active: 125
```
to:
```yaml
    heart_rate_zones:
      active: 118
```

**Step 2: Update Milo's profile**

In `data/users/milo/profile.yml`, change:
```yaml
    heart_rate_zones:
      active: 120
```
to:
```yaml
    heart_rate_zones:
      active: 112
```

**Step 3: Commit**

```bash
git add data/users/alan/profile.yml data/users/milo/profile.yml
git commit -m "fix(fitness): lower active zone thresholds for Alan and Milo

Alan 125→118, Milo 120→112. Previous thresholds caused 19 false
warnings in 33 min from HR oscillating near boundary. Lowering gives
margin below observed HR floor.

Audit: CF7 in 2026-02-18-governance-comprehensive-code-audit.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update audit document status

**Files:**
- Modify: `docs/_wip/audits/2026-02-18-governance-comprehensive-code-audit.md`

**Step 1: Mark fixed items**

Update the status of N1, N4, and CF7 from "OPEN" to "FIXED" with the commit reference.

Add a note under CF1/CF2/CF3 clarifying that code review confirms these are already fixed in the current codebase — the `evalContext` fix was fully applied to both `_getParticipantsBelowThreshold()` (line 716) and `_getParticipantStates()` (line 766), and per-user HR/threshold/delta fields are already present (lines 731-755).

**Step 2: Commit**

```bash
git add docs/_wip/audits/2026-02-18-governance-comprehensive-code-audit.md
git commit -m "docs: update audit statuses after governance remediation

Mark N1, N4, CF7 as fixed. Note CF1/CF2/CF3 confirmed already fixed
in current code — evalContext threading and per-user diagnostics were
applied in prior commits.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
