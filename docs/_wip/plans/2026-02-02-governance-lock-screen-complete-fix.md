# Governance Lock Screen Complete Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the 2-second "Target" fallback text on lock screen by ensuring zone labels are available immediately when governance evaluates.

**Architecture:** Three-layer fix: (1) seed `_latestInputs` with zone maps during `configure()`, (2) add defensive fallbacks in UI layer, (3) clean up deprecated callback architecture.

**Tech Stack:** React hooks, GovernanceEngine class, FitnessSession

---

## Problem Summary

The existing fix (`_buildRequirementShell`) correctly pre-populates requirements when `activeParticipants.length === 0`, but has gaps:

| Issue | Impact | Fix Task |
|-------|--------|----------|
| `zoneInfoMap` empty on first `evaluate()` | Labels show raw ID ("active") not name ("Active") | Task 1 |
| UI has multiple "Target" fallbacks | Even with good data, UI might show fallback | Task 2 |
| Callback architecture is confusing | `_evaluateFromTreasureBox` logs deprecation but still works | Task 3 |
| No diagnostic for empty zoneInfoMap | Hard to debug when labels are wrong | Task 4 |

---

## Task 1: Seed Zone Maps During configure()

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:399-432`
- Test: `tests/unit/governance/GovernanceEngine.test.mjs` (create if needed)

**Problem:** When `_triggerPulse()` calls `evaluate()` with no params, it falls back to `_latestInputs`. But on first call, `_latestInputs` is empty.

**Step 1: Write the failing test**

Create test file if it doesn't exist:

```javascript
// tests/unit/governance/GovernanceEngine.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceEngine } from '../../../frontend/src/hooks/fitness/GovernanceEngine.js';

describe('GovernanceEngine', () => {
  describe('configure()', () => {
    it('should seed _latestInputs with zone maps from session', () => {
      const mockSession = {
        roster: [],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'active', name: 'Active', color: '#ff0000' },
            { id: 'warm', name: 'Warm Up', color: '#ffaa00' },
          ]
        }
      };

      const engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30
      }, [], {});

      // Zone maps should be seeded from session.snapshot.zoneConfig
      expect(Object.keys(engine._latestInputs.zoneInfoMap)).toContain('active');
      expect(engine._latestInputs.zoneInfoMap.active.name).toBe('Active');
      expect(Object.keys(engine._latestInputs.zoneRankMap)).toContain('active');
      expect(engine._latestInputs.zoneRankMap.active).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/governance/GovernanceEngine.test.mjs`
Expected: FAIL - `_latestInputs.zoneInfoMap` is empty `{}`

**Step 3: Implement the fix**

Modify `GovernanceEngine.js` - add zone map seeding at end of `configure()`:

```javascript
// In configure(), after line 431 (after _evaluateFromTreasureBox call)
// Add this block:

    // Seed _latestInputs with zone maps from session snapshot
    // This ensures fallbacks work even on first evaluate() call
    if (this.session?.snapshot?.zoneConfig) {
      const zoneConfig = this.session.snapshot.zoneConfig;
      const zoneRankMap = {};
      const zoneInfoMap = {};
      zoneConfig.forEach((z, idx) => {
        if (!z || z.id == null) return;
        const zid = String(z.id).toLowerCase();
        zoneRankMap[zid] = idx;
        zoneInfoMap[zid] = {
          id: zid,
          name: z.name || String(z.id),
          color: z.color || null
        };
      });
      this._latestInputs.zoneRankMap = zoneRankMap;
      this._latestInputs.zoneInfoMap = zoneInfoMap;

      getLogger().debug('governance.configure.seeded_zone_maps', {
        zoneCount: zoneConfig.length,
        zoneIds: Object.keys(zoneInfoMap)
      });
    }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/governance/GovernanceEngine.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "$(cat <<'EOF'
fix(governance): seed zone maps during configure()

Ensures _latestInputs has zone data before first evaluate() call,
preventing "active" raw ID from showing instead of "Active" label.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Defensive Fallback in UI Layer

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:773-810`

**Problem:** Even if GovernanceEngine provides good data, the UI has a fallback chain ending in `'Target'` (line 801). If any link in the chain is `undefined`, it falls through.

**Step 1: Analyze current fallback chain**

Current code at line 773-810 (buildTargetInfo):
```javascript
const label = requirement?.zoneLabel
  || zoneInfo?.name
  || requirement?.ruleLabel
  || 'Target';  // Last resort fallback
```

**Step 2: Add zone config lookup as additional fallback**

The overlay has access to `zoneMetadata` which contains zone names. Use it before falling back to `'Target'`:

```javascript
// In buildTargetInfo function, replace the label assignment:
const targetZoneId = requirement?.zone || requirement?.targetZoneId;
const zoneFromMetadata = targetZoneId && zoneMetadata?.map?.[targetZoneId];

const label = requirement?.zoneLabel
  || zoneInfo?.name
  || zoneFromMetadata?.name
  || requirement?.ruleLabel
  || (targetZoneId ? targetZoneId.charAt(0).toUpperCase() + targetZoneId.slice(1) : null)
  || 'Target';
```

This adds:
1. Lookup from `zoneMetadata.map` (available from context)
2. Capitalize the raw zone ID as last fallback before "Target"

**Step 3: Apply similar fix to line 1027**

Replace:
```javascript
label: fallbackRequirement?.zoneLabel || fallbackRequirement?.ruleLabel || 'Target zone',
```

With:
```javascript
label: fallbackRequirement?.zoneLabel
  || fallbackRequirement?.ruleLabel
  || (zoneMetadata?.map?.[fallbackRequirement?.zone]?.name)
  || (fallbackRequirement?.zone ? fallbackRequirement.zone.charAt(0).toUpperCase() + fallbackRequirement.zone.slice(1) : null)
  || 'Target zone',
```

**Step 4: Test manually**

1. Start the dev server
2. Start a governed video with HR device disconnected
3. Verify lock screen shows zone name (e.g., "Active") not "Target"

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "$(cat <<'EOF'
fix(overlay): add defensive fallbacks for zone labels

Adds zoneMetadata lookup and capitalized zone ID as fallbacks
before showing generic "Target" text on lock screen.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Clean Up Deprecated Callback Architecture

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:417-431, 686-696`

**Problem:** `_evaluateFromTreasureBox()` logs a deprecation warning but then calls `evaluate()` anyway. The callback is registered but TreasureBox ignores it. This is confusing.

**Step 1: Decide on architecture**

Two options:
- **Option A:** Remove the callback registration entirely (clean break)
- **Option B:** Keep callback but remove deprecation warning (it works, just differently)

**Recommended: Option A** - The comment says governance is now tick-driven via ZoneProfileStore. Honor that design.

**Step 2: Remove callback registration in configure()**

In `configure()`, remove lines 417-423:

```javascript
// DELETE THIS BLOCK:
    // Subscribe to TreasureBox for reactive zone-based evaluation
    // (removes 1-second polling delay for governance responsiveness)
    if (this.session?.treasureBox) {
      this.session.treasureBox.setGovernanceCallback(() => {
        this._evaluateFromTreasureBox();
      });
    }
```

**Step 3: Simplify _evaluateFromTreasureBox()**

Replace the entire method with:

```javascript
  /**
   * @deprecated Governance is now tick-driven via ZoneProfileStore.
   * This method exists only for backwards compatibility if called directly.
   */
  _evaluateFromTreasureBox() {
    this.evaluate();
  }
```

**Step 4: Verify no regressions**

Run: `npm test`
Run: Manual test - start governed video, verify governance still works

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
refactor(governance): remove deprecated TreasureBox callback

Governance is tick-driven via ZoneProfileStore. The callback
registration was a no-op on the TreasureBox side anyway.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add Diagnostic Logging for Empty Zone Maps

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1218-1256`

**Problem:** When zone labels are wrong, there's no log to diagnose whether `zoneInfoMap` was empty.

**Step 1: Add diagnostic in the no-participants branch**

In `evaluate()`, after line 1227 (inside the `if (activeParticipants.length === 0)` block), add:

```javascript
      // DIAGNOSTIC: Log if zone maps are empty when pre-populating
      const zoneInfoMapSize = Object.keys(zoneInfoMap || {}).length;
      const zoneRankMapSize = Object.keys(zoneRankMap || {}).length;
      if (zoneInfoMapSize === 0 || zoneRankMapSize === 0) {
        getLogger().warn('governance.evaluate.empty_zone_maps_on_prepopulate', {
          zoneInfoMapSize,
          zoneRankMapSize,
          hasSessionSnapshot: !!this.session?.snapshot?.zoneConfig,
          snapshotZoneCount: this.session?.snapshot?.zoneConfig?.length || 0
        });
      }
```

**Step 2: Add diagnostic after _buildRequirementShell**

After line 1234 (after `_buildRequirementShell` call), add:

```javascript
        // Log what we pre-populated for debugging
        if (prePopulatedRequirements.length > 0) {
          const firstReq = prePopulatedRequirements[0];
          getLogger().debug('governance.evaluate.prepopulated_requirements', {
            count: prePopulatedRequirements.length,
            firstZone: firstReq?.zone,
            firstZoneLabel: firstReq?.zoneLabel,
            hasProperLabel: firstReq?.zoneLabel !== firstReq?.zone
          });
        }
```

**Step 3: Test by checking logs**

1. Start governed video
2. Check browser console for `governance.evaluate.prepopulated_requirements`
3. Verify `hasProperLabel: true`

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
feat(governance): add diagnostic logging for zone map availability

Helps debug cases where zone labels show raw IDs instead of names.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Bug Documentation

**Files:**
- Modify: `docs/_wip/bugs/2026-02-02-governance-lock-screen-delay.md`

**Step 1: Update status and add resolution notes**

Add to the end of the document:

```markdown
## Resolution (2026-02-02)

### Additional Issues Identified

1. **zoneInfoMap empty on first evaluate()** - Fixed by seeding zone maps in `configure()`
2. **UI fallback chain too aggressive** - Added zoneMetadata lookup before "Target" fallback
3. **Deprecated callback confusion** - Removed unused TreasureBox callback registration
4. **Missing diagnostics** - Added logging for empty zone maps

### Files Changed (Complete Fix)

- `frontend/src/hooks/fitness/GovernanceEngine.js`
  - Seed `_latestInputs` zone maps in `configure()`
  - Remove TreasureBox callback registration
  - Add diagnostic logging for zone map state
- `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`
  - Add zoneMetadata lookup in fallback chain
  - Capitalize raw zone ID before "Target" fallback

### Verification

- [ ] Zone maps are seeded before first evaluate() (check debug log)
- [ ] Pre-populated requirements have proper labels (check debug log)
- [ ] Lock screen shows "Active" immediately on governed video start
- [ ] No "Target" or "Target zone" fallback visible
- [ ] Existing governance behavior unchanged (grace period, challenges)
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-02-02-governance-lock-screen-delay.md
git commit -m "$(cat <<'EOF'
docs: update bug report with complete fix details

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Archive the Original Plan Document

**Files:**
- Move: `docs/_wip/plans/2026-02-02-governance-lock-screen-preload-fix.md` → archive or delete

**Step 1: The original plan is superseded by this one**

```bash
# Either delete it:
rm docs/_wip/plans/2026-02-02-governance-lock-screen-preload-fix.md

# Or move to archive with note:
mv docs/_wip/plans/2026-02-02-governance-lock-screen-preload-fix.md \
   docs/_archive/2026-02-02-governance-lock-screen-preload-fix-superseded.md
```

**Step 2: Commit**

```bash
git add -A docs/
git commit -m "$(cat <<'EOF'
docs: archive superseded governance fix plan

Replaced by 2026-02-02-governance-lock-screen-complete-fix.md

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `GovernanceEngine.js` | Seed zone maps in configure(), remove deprecated callback, add diagnostics |
| `FitnessPlayerOverlay.jsx` | Add zoneMetadata fallback before "Target" |
| Bug doc | Update with complete fix details |
| Original plan | Archive as superseded |

## Testing Checklist

- [ ] Unit test: `configure()` seeds `_latestInputs` with zone maps
- [ ] Manual: Start governed video with no HR device - lock screen shows "Active" immediately
- [ ] Manual: Start governed video with HR device - transition works correctly
- [ ] Manual: Grace period countdown works
- [ ] Manual: Challenges display correct zone labels
- [ ] Logs: `governance.evaluate.prepopulated_requirements` shows `hasProperLabel: true`
