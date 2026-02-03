# Governance Lock Screen Hydration Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate 1.1 second hydration delay by pre-populating zone labels and participant identity on first render.

**Architecture:** Two-pronged fix: (1) Pass zoneConfig directly to GovernanceEngine.configure() so zone labels are seeded synchronously before first evaluate(), (2) Separate identity roster from vitals so participant rows appear before HR data arrives.

**Tech Stack:** React hooks, FitnessContext, GovernanceEngine class, ParticipantRoster class

**Exit Criteria:** `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs` shows no "Target zone" or HR 60 placeholder values.

---

## Task 1: Add Zone Config Passthrough to GovernanceEngine.configure()

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:400-442`

**Problem:** `configure()` reads zoneConfig from `session.snapshot.zoneConfig`, but snapshot isn't updated until a useEffect runs AFTER the first render. The zone maps are empty on first evaluate().

**Step 1: Read the current configure() method signature**

File: `frontend/src/hooks/fitness/GovernanceEngine.js` around line 396-420

**Step 2: Modify configure() to accept zoneConfig directly**

Change the zone seeding logic to prefer a direct `config.zoneConfig` parameter over the snapshot:

```javascript
// In configure() method, around line 417-442
// Change from:
if (this.session?.snapshot?.zoneConfig) {
  const zoneConfig = this.session.snapshot.zoneConfig;
  // ...
}

// To:
const zoneConfigSource = config.zoneConfig || this.session?.snapshot?.zoneConfig || [];
if (zoneConfigSource.length > 0) {
  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfigSource.forEach((z, idx) => {
    if (!z || z.id == null) return;
    const zid = normalizeZoneId(z.id);
    if (!zid) return;
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
    zoneCount: zoneConfigSource.length,
    zoneIds: Object.keys(zoneInfoMap),
    source: config.zoneConfig ? 'config_param' : 'snapshot'
  });
}
```

**Step 3: Run existing tests to verify no regression**

Run: `npx playwright test tests/live/flow/fitness/ --grep "governance" -x`
Expected: No failures

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "$(cat <<'EOF'
fix(fitness): accept zoneConfig directly in GovernanceEngine.configure()

Allows zone maps to be seeded synchronously from props instead of
waiting for snapshot useEffect. This fixes the zone label placeholder
issue where "Target zone" appears for ~350ms.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pass zoneConfig to GovernanceEngine from FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:499`

**Problem:** The call to `configure()` doesn't include zoneConfig, so the engine can't seed zone maps until the snapshot updates.

**Step 1: Locate the configure() call**

File: `frontend/src/context/FitnessContext.jsx:499`
Current: `session.governanceEngine.configure(governanceConfig, undefined, { subscribeToAppEvent });`

**Step 2: Spread zoneConfig into the governanceConfig parameter**

```javascript
// Change from:
session.governanceEngine.configure(governanceConfig, undefined, { subscribeToAppEvent });

// To:
session.governanceEngine.configure(
  { ...governanceConfig, zoneConfig },
  undefined,
  { subscribeToAppEvent }
);
```

**Step 3: Run hydration monitor test**

Run: `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs --headed`
Expected: No "Target zone" placeholder visible (zone labels show "Active", "Warm", etc. immediately)

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "$(cat <<'EOF'
fix(fitness): pass zoneConfig directly to GovernanceEngine.configure()

Ensures zone maps are seeded synchronously on first render instead of
waiting for snapshot useEffect. Part of hydration delay fix.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create Identity-Only Roster Method in ParticipantRoster

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js:104-128`

**Problem:** `getRoster()` calls `_buildZoneLookup()` which returns empty until TreasureBox has HR data. This blocks participant rows from appearing for ~400ms.

**Step 1: Add getIdentityRoster() method after getRoster()**

Insert after line 128:

```javascript
/**
 * Get identity-only roster (names and device IDs only, no zone data).
 * Use this for immediate rendering while vitals are still loading.
 *
 * @returns {RosterEntry[]}
 */
getIdentityRoster() {
  if (!this._deviceManager || !this._userManager) {
    return [];
  }

  const roster = [];
  const heartRateDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
  const preferGroupLabels = heartRateDevices.length > 1;

  heartRateDevices.forEach((device) => {
    const entry = this._buildIdentityEntry(device, { preferGroupLabels });
    if (entry) {
      roster.push(entry);
      if (entry.id) this._historicalParticipants.add(entry.id);
    }
  });

  return roster;
}
```

**Step 2: Add _buildIdentityEntry() helper method**

Insert after `_buildZoneLookup()` (around line 285):

```javascript
/**
 * Build identity-only roster entry (no zone/vitals data).
 * Faster than full entry since it doesn't need TreasureBox.
 *
 * @param {Object} device
 * @param {Object} options
 * @returns {RosterEntry|null}
 */
_buildIdentityEntry(device, options = {}) {
  if (!device || device.id == null) return null;

  const { preferGroupLabels = false } = options;
  const deviceId = String(device.id);

  // Resolve participant name from guest assignment or user mapping
  const guestEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
  const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name || null;
  const mappedUser = this._userManager.resolveUserForDevice(deviceId);
  const participantName = ledgerName || mappedUser?.name;

  if (!participantName) return null;

  const userId = mappedUser?.id || guestEntry?.occupantId || guestEntry?.metadata?.profileId;
  const isGuest = guestEntry
    ? (guestEntry.occupantType === 'guest')
    : (mappedUser ? mappedUser.source === 'Guest' : true);
  const groupLabel = isGuest ? null : mappedUser?.groupLabel;

  const displayLabel = resolveDisplayLabel({
    name: participantName,
    groupLabel,
    preferGroupLabel: !isGuest && preferGroupLabels
  });

  return {
    name: participantName,
    displayLabel,
    groupLabel: groupLabel || null,
    profileId: userId,
    id: userId,
    baseUserName: isGuest ? (guestEntry?.metadata?.baseUserName || null) : participantName,
    isGuest,
    hrDeviceId: deviceId,
    // Zone/vitals data is null until enriched
    heartRate: null,
    zoneId: null,
    zoneColor: null,
    avatarUrl: mappedUser?.avatarUrl || null,
    status: ParticipantStatus.UNKNOWN,
    isActive: true,
    _source: 'identity_only'
  };
}
```

**Step 3: Run tests**

Run: `npx playwright test tests/live/flow/fitness/ -x`
Expected: All pass

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js
git commit -m "$(cat <<'EOF'
feat(fitness): add getIdentityRoster() for immediate participant display

Creates identity-only roster entries (name, device ID) without waiting
for TreasureBox zone data. Allows lock screen to show participant rows
immediately while vitals load.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Use Identity Roster for Initial Lock Screen Render

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:1297-1322`

**Problem:** `participantRoster` useMemo returns empty array until TreasureBox has data. Need to fall back to identity roster.

**Step 1: Modify participantRoster useMemo to use identity fallback**

```javascript
const participantRoster = React.useMemo(() => {
  const roster = fitnessSessionRef.current?.roster || [];

  // Primary path: full roster with vitals
  if (roster && roster.length > 0) {
    const signature = JSON.stringify(
      roster.map((entry) => ({
        name: entry?.name || null,
        hrDeviceId: entry?.hrDeviceId || null,
        heartRate: Number.isFinite(entry?.heartRate) ? Math.round(entry.heartRate) : null,
        zoneId: entry?.zoneId || null,
        zoneColor: entry?.zoneColor || null,
        isActive: entry?.isActive ?? true
      }))
    );

    if (rosterCacheRef.current.signature === signature) {
      return rosterCacheRef.current.value;
    }

    rosterCacheRef.current = { signature, value: roster };
    return rosterCacheRef.current.value;
  }

  // Fallback: identity-only roster (no vitals yet)
  const identityRoster = fitnessSessionRef.current?.participantRoster?.getIdentityRoster?.() || [];
  if (identityRoster.length > 0) {
    return identityRoster;
  }

  // Final fallback: empty
  rosterCacheRef.current.signature = null;
  rosterCacheRef.current.value = emptyRosterRef.current;
  return rosterCacheRef.current.value;
}, [version]);
```

**Step 2: Run hydration monitor test**

Run: `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs`
Expected: User rows appear immediately (no 389ms gap)

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "$(cat <<'EOF'
fix(fitness): use identity roster fallback for immediate lock screen display

Falls back to identity-only roster when full vitals aren't available yet.
Allows participant rows to appear immediately while HR data loads.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Handle Missing HR Gracefully in FitnessPlayerOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:864-884`

**Problem:** When identity roster is used, targetHeartRate resolves to zone minimum which may be a placeholder value. Need to show "--" when we don't have user-specific data yet.

**Step 1: Locate targetHeartRate resolution in addRow()**

File: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx:864-884`

**Step 2: Add check for identity-only entries**

Modify the targetHeartRate resolution to detect identity-only entries:

```javascript
const targetHeartRate = (() => {
  // Explicit override
  if (overrides.targetBpm !== undefined && overrides.targetBpm != null && Number.isFinite(overrides.targetBpm)) {
    return Math.round(overrides.targetBpm);
  }

  // User-specific threshold (from config)
  if (Number.isFinite(userTargetOverride)) {
    return Math.round(userTargetOverride);
  }

  // If this is an identity-only entry (no vitals yet), don't show zone minimums
  // as they aren't user-specific targets
  const isIdentityOnly = resolvedParticipant?._source === 'identity_only';
  if (isIdentityOnly) {
    return null; // Will show "--" in UI
  }

  // From requirement
  if (Number.isFinite(target?.targetBpm)) {
    return Math.round(target.targetBpm);
  }

  // From zone info
  if (Number.isFinite(target?.zoneInfo?.min)) {
    return Math.round(target.zoneInfo.min);
  }

  // From progress entry
  if (Number.isFinite(progressEntry?.targetHeartRate)) {
    return Math.round(progressEntry.targetHeartRate);
  }
  if (Number.isFinite(progressEntry?.rangeMax) && progressEntry.rangeMax > 0) {
    return Math.round(progressEntry.rangeMax);
  }

  return null;
})();
```

**Step 3: Run tests**

Run: `npx playwright test tests/live/flow/fitness/ -x`
Expected: All pass

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx
git commit -m "$(cat <<'EOF'
fix(fitness): show "--" for target HR when using identity-only roster

Prevents zone minimums from appearing as user targets when we only have
identity data (no vitals yet). Shows "--" until user-specific threshold
is available.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Run Full Test Suite and Verify Fix

**Files:** None (verification only)

**Step 1: Run the hydration monitor test**

Run: `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs --headed`

Expected output should show:
- `FULLY_HYDRATED` phase reached much faster (< 200ms after lock screen appears)
- No `HR_PRESENT_ZONES_PENDING` phase (zone labels hydrated immediately)
- No "Target zone" or HR "60" placeholders in the hydration sequence

**Step 2: Run full fitness test suite**

Run: `npx playwright test tests/live/flow/fitness/ --reporter=line`
Expected: All tests pass

**Step 3: Manual verification (optional)**

Navigate to a governed video and verify:
1. Lock screen appears with user names immediately
2. Zone labels show "Active", "Warm", etc. (not "Target zone")
3. Target HR shows user-specific values or "--" (not "60")
4. Current HR updates when data arrives

**Step 4: Commit test verification**

If any test assertions need updating to reflect the new behavior:

```bash
git add tests/live/flow/fitness/
git commit -m "$(cat <<'EOF'
test(fitness): update assertions for faster lock screen hydration

Adjusts test expectations to match new hydration behavior where zone
labels and user rows appear immediately.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Gap Fixed | Change |
|------|-----------|--------|
| 1-2 | Gap 2 (zone labels) | Pass zoneConfig directly to configure() |
| 3-4 | Gap 1 (user rows) | Identity roster fallback |
| 5 | HR placeholder | Detect identity-only entries |
| 6 | Verification | Run tests to confirm fix |

**Total expected improvement:** ~1100ms → <200ms hydration time
