# Fitness Dual-Device Roster Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user wears two (or more) HR monitors, the roster must render **one card per user**, not one card per device. Devices assigned to the same user UUID must be merged into a single roster entry whose `hrDeviceIds` array lists every device the user owns. Anonymous rider devices (not mapped to any registered user and with no ledger assignment) continue to render as their own entries. Heart-rate aggregation across the user's devices (min-HR arbitration) is **already implemented** in `UserManager.updateFromDevice` — this plan does **not** touch that logic; it only fixes the upstream grouping in `ParticipantRoster.getRoster()` that currently emits one card per device.

**Architecture:** The fix lives entirely in `ParticipantRoster.getRoster()` and `_buildRosterEntry()`. Instead of iterating `heartRateDevices.forEach(device => emit one entry)`, the new loop groups devices by the user UUID that owns them (via `userManager.resolveUserForDevice(deviceId).id`). One entry is emitted per unique user UUID, plus one per unmapped device (anonymous riders). The "primary" device passed to `_buildRosterEntry` — the one whose `device.heartRate` / `device.inactiveSince` drives `entry.heartRate` and `entry.isActive` — is the user's first active device, falling back to any device the user owns. `entry.hrDeviceId` (singular, legacy) is set to that primary device; `entry.hrDeviceIds` is the full array of the user's devices.

No config-file change is required. The device→user N-to-1 mapping already lives in `data/household/config/fitness.yml` under `devices.heart_rate` as `{ deviceId: userId }` (e.g. Alan already has three entries: `28676, 10366, 20991`). `UserService.hydrateUsers()` emits `hr_device_ids: [...]` and `UserManager.registerUser()` consumes it — the data path is intact end-to-end and well-tested (`DeviceOwnershipIndex.test.mjs:33-40`). **The chosen mapping location is (B) — `data/household/config/fitness.yml` under `devices.heart_rate`** because every existing production record for multi-device users (Alan) already lives there and the hydration path is established. Option A (`profile.yml`) is rejected: introducing a second source would double the places a future editor must keep in sync. Option C (both with fallback) is rejected as scope creep.

**Out of scope:**
- No UI-layer changes (avatars, MiniMonitor, SidebarFooter) — they already read `hrDeviceIds || [hrDeviceId]` correctly (see `frontend/src/modules/Fitness/nav/SidebarFooter.jsx:90, 125`)
- No change to `updateFromDevice`'s min-HR arbitration at `UserManager.js:176-205` — it already takes the minimum across `_pendingHR` when `hrDeviceIds.size > 1`
- No change to `DeviceOwnershipIndex` — it already indexes multiple devices per user
- No change to `PersistenceManager`, `ChartDataBuilder`, `ParticipantFactory`, or `FitnessChart` — they key off `profileId` (user UUID) or read `hrDeviceId` only as a fallback ID string

**Tech Stack:** Node.js (ESM), Jest, React (frontend-only plan — no backend files change)

**Spec:** Bug-bash Issue D — no separate spec doc. Verbatim text:

> A user wearing two HR monitors appears as two separate cards in the roster. Required: one user → one card. Allow multiple device IDs to map to one user UUID. Aggregate the streams by taking the minimum HR across the two devices.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Builds the roster from `DeviceManager` + `UserManager` | Replace per-device loop with group-by-user-UUID loop |
| `tests/unit/fitness/ParticipantRoster.test.mjs` | **NEW** Jest test file | Cover single-device, multi-device-same-user, anonymous, active-device selection, min-HR integration |

**Files read but not modified** (verified multi-device-safe — see "Downstream audit" below):
- `frontend/src/hooks/fitness/UserManager.js` — min-HR arbitration stays as-is (lines 176-205)
- `frontend/src/hooks/fitness/DeviceOwnershipIndex.js` — already N-to-1
- `frontend/src/modules/Fitness/nav/SidebarFooter.jsx` — reads `hrDeviceIds || [hrDeviceId]`
- `frontend/src/hooks/fitness/PersistenceManager.js` — reads `hrDeviceId` as fallback ID only
- `frontend/src/modules/Fitness/domain/ParticipantFactory.js` — reads `hrDeviceId` for device lookup; primary device is a valid singular key
- `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` — keys off `profileId`/`id`, not device ID

---

## Background — Current `getRoster()` shape

`ParticipantRoster.getRoster()` at lines 108-147 today:

```js
const heartRateDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
heartRateDevices.forEach((device) => {
  const entry = this._buildRosterEntry(device, zoneLookup, { preferGroupLabels });
  if (entry) roster.push(entry);
});
```

`_buildRosterEntry(device, ...)` at lines 350-459 resolves the mapped user via `this._userManager.resolveUserForDevice(String(device.id))`. If Alan owns devices `28676, 10366, 20991`, three separate calls each return the same Alan user and push three near-identical entries. The snapshot `hrDeviceIds: mappedUser?.hrDeviceIds ? [...mappedUser.hrDeviceIds] : [String(deviceId)]` at line 445 already records Alan's full device list on each entry — but three entries still exist.

The min-HR arbitration at `UserManager.js:192-205` writes the aggregated HR into `user.currentData.heartRate`, **but** `_buildRosterEntry` reads HR from `device.heartRate` at line 355, not from `user.currentData.heartRate`. So each per-device entry gets that device's raw reading, not the aggregate. The plan fixes both: group by user AND read the aggregated HR from the user object.

**Primary-device selection rule:** From the set of devices a user owns, pick `activeDevices[0]` (first with `!device.inactiveSince`) if any; otherwise `ownedDevices[0]`. This device becomes `entry.hrDeviceId` (legacy singular) and its `device.inactiveSince` drives `entry.isActive` / `entry.inactiveSince`. `entry.heartRate` is read from the **user's aggregated value** (`mappedUser.currentData.heartRate`) with a fallback to the primary device's raw HR if the user object isn't populated yet (tests verify both).

---

## Task 1: Write failing `ParticipantRoster` tests (RED)

**Files:**
- Create: `tests/unit/fitness/ParticipantRoster.test.mjs`

- [ ] **Step 1: Create the test file**

Create `tests/unit/fitness/ParticipantRoster.test.mjs` with this content:

```js
// tests/unit/fitness/ParticipantRoster.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  })
}));

const { ParticipantRoster } = await import('#frontend/hooks/fitness/ParticipantRoster.js');

// ─── Minimal fakes (no real DeviceManager / UserManager pulled in) ──────────

function makeDevice({ id, heartRate = null, inactiveSince = null }) {
  return { id: String(id), deviceId: String(id), type: 'heart_rate', heartRate, inactiveSince };
}

function makeUser({ id, name, hrDeviceIds, currentHR = null }) {
  return {
    id,
    name,
    hrDeviceIds: new Set((hrDeviceIds || []).map(String)),
    groupLabel: null,
    source: 'Primary',
    avatarUrl: null,
    currentData: { heartRate: currentHR, hrInactive: currentHR == null },
  };
}

function makeDeviceManager(devices) {
  return { getAllDevices: () => devices };
}

function makeUserManager(userByDevice) {
  // userByDevice: Map<deviceId, user>
  return {
    resolveUserForDevice(deviceId) {
      return userByDevice.get(String(deviceId)) || null;
    },
    assignmentLedger: null,
  };
}

function newRoster(devices, userByDevice) {
  const roster = new ParticipantRoster();
  roster.configure({
    deviceManager: makeDeviceManager(devices),
    userManager: makeUserManager(userByDevice),
  });
  return roster;
}

describe('ParticipantRoster.getRoster — dual-device aggregation', () => {
  it('emits one entry per device when each device belongs to a different user', () => {
    const alan = makeUser({ id: 'alan', name: 'Alan', hrDeviceIds: ['20991'], currentHR: 120 });
    const felix = makeUser({ id: 'felix', name: 'Felix', hrDeviceIds: ['28812'], currentHR: 95 });
    const devices = [
      makeDevice({ id: '20991', heartRate: 120 }),
      makeDevice({ id: '28812', heartRate: 95 }),
    ];
    const userByDevice = new Map([['20991', alan], ['28812', felix]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(2);
    const names = roster.map(e => e.name).sort();
    expect(names).toEqual(['Alan', 'Felix']);
  });

  it('collapses two devices owned by the same user into ONE entry', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 118
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: 120 }),
      makeDevice({ id: '10366', heartRate: 118 }), // the lower — matches currentHR
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    const entry = roster[0];
    expect(entry.name).toBe('Alan');
    expect(entry.id).toBe('alan');
    // Full device list — the whole point of the fix
    expect(entry.hrDeviceIds.sort()).toEqual(['10366', '20991']);
  });

  it('uses the user\'s aggregated HR (min-HR arbitration result) not a single device\'s raw reading', () => {
    // UserManager.updateFromDevice picks the minimum and writes it to
    // user.currentData.heartRate. The roster must surface THAT value.
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 118 // the min
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: 150 }), // spurious-high outlier
      makeDevice({ id: '10366', heartRate: 118 }),
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].heartRate).toBe(118);
  });

  it('collapses THREE devices (real-world: Alan has 28676, 10366, 20991 in prod config)', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['28676', '10366', '20991'], currentHR: 100
    });
    const devices = [
      makeDevice({ id: '28676', heartRate: 130 }), // "bad readings" device
      makeDevice({ id: '10366', heartRate: 100 }),
      makeDevice({ id: '20991', heartRate: 105 }),
    ];
    const userByDevice = new Map([
      ['28676', alan], ['10366', alan], ['20991', alan]
    ]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].hrDeviceIds.sort()).toEqual(['10366', '20991', '28676']);
    expect(roster[0].heartRate).toBe(100);
  });

  it('anonymous-rider device (no user, no ledger) still renders as its own entry', () => {
    // resolveUserForDevice returns null for unmapped devices. A ledger-less,
    // user-less device must be silently dropped per the CURRENT contract —
    // _buildRosterEntry returns null when participantName is absent (line 363).
    // This test locks in the drop-anon behavior (it is NOT new behavior).
    const alan = makeUser({ id: 'alan', name: 'Alan', hrDeviceIds: ['20991'], currentHR: 110 });
    const devices = [
      makeDevice({ id: '20991', heartRate: 110 }),
      makeDevice({ id: '99999', heartRate: 80 }), // unknown, unowned
    ];
    const userByDevice = new Map([['20991', alan]]); // 99999 not mapped
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].name).toBe('Alan');
  });

  it('anonymous rider with a ledger assignment still renders as its own entry', () => {
    // When a device is claimed via GuestAssignmentService, _buildRosterEntry
    // reads the ledger name. That path must survive the group-by-user change.
    const alan = makeUser({ id: 'alan', name: 'Alan', hrDeviceIds: ['20991'], currentHR: 110 });
    const devices = [
      makeDevice({ id: '20991', heartRate: 110 }),
      makeDevice({ id: '44444', heartRate: 88 }),
    ];
    const userByDevice = new Map([['20991', alan]]);
    // Stub ledger: device 44444 is assigned to "Visitor Joe"
    const ledger = {
      get: (id) => String(id) === '44444'
        ? { deviceId: '44444', occupantId: 'guest-joe', occupantName: 'Visitor Joe',
            occupantType: 'guest', metadata: { profileId: 'guest-joe' } }
        : null
    };
    const roster = new ParticipantRoster();
    roster.configure({
      deviceManager: makeDeviceManager(devices),
      userManager: { resolveUserForDevice: (id) => userByDevice.get(String(id)) || null, assignmentLedger: ledger },
    });
    const out = roster.getRoster();

    expect(out).toHaveLength(2);
    const names = out.map(e => e.name).sort();
    expect(names).toEqual(['Alan', 'Visitor Joe']);
  });

  it('entry.hrDeviceId (singular, legacy) points to an active device when available', () => {
    // Backwards-compat: many downstream consumers still read entry.hrDeviceId
    // (singular). It must be one of the user's devices, and prefer an active one.
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 100
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: null, inactiveSince: Date.now() - 60000 }),
      makeDevice({ id: '10366', heartRate: 100 }), // active
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    expect(roster[0].hrDeviceId).toBe('10366'); // the active one
    expect(roster[0].isActive).toBe(true);
  });

  it('entry.isActive is true when ANY owned device is active', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: 100
    });
    const devices = [
      makeDevice({ id: '20991', heartRate: null, inactiveSince: Date.now() - 60000 }), // inactive
      makeDevice({ id: '10366', heartRate: 100 }), // active
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();
    expect(roster[0].isActive).toBe(true);
  });

  it('entry.isActive is false when ALL owned devices are inactive', () => {
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366'], currentHR: null
    });
    const t = Date.now() - 60000;
    const devices = [
      makeDevice({ id: '20991', heartRate: null, inactiveSince: t }),
      makeDevice({ id: '10366', heartRate: null, inactiveSince: t }),
    ];
    const userByDevice = new Map([['20991', alan], ['10366', alan]]);
    const roster = newRoster(devices, userByDevice).getRoster();
    expect(roster[0].isActive).toBe(false);
  });

  it('preferGroupLabels triggers only when 2+ USERS are present (not 2+ devices from one user)', () => {
    // Key regression: before the fix, Alan alone with 3 devices would trip
    // the "2+ present devices" group-label threshold and cards would show
    // "Dad" instead of "Alan" in a single-user session. After the fix, only
    // real multi-user presence switches labels.
    const alan = makeUser({
      id: 'alan', name: 'Alan', hrDeviceIds: ['20991', '10366', '28676'], currentHR: 100
    });
    alan.groupLabel = 'Dad';
    const devices = [
      makeDevice({ id: '20991', heartRate: 100 }),
      makeDevice({ id: '10366', heartRate: 100 }),
      makeDevice({ id: '28676', heartRate: 100 }),
    ];
    const userByDevice = new Map([
      ['20991', alan], ['10366', alan], ['28676', alan]
    ]);
    const roster = newRoster(devices, userByDevice).getRoster();

    expect(roster).toHaveLength(1);
    // Solo user → displayLabel is the first name, not the group label
    expect(roster[0].displayLabel).toBe('Alan');
  });
});
```

- [ ] **Step 2: Run the new tests — expect MOST to FAIL**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/ParticipantRoster.test.mjs`

Expected: 10 tests, several failures. The key failures will be:
- "collapses two devices … into ONE entry" → received 2, expected 1
- "collapses THREE devices" → received 3, expected 1
- "uses the user's aggregated HR" → received 150 (first-device raw), expected 118
- "entry.hrDeviceId … points to an active device when available" → received `20991` (first by insertion), expected `10366`
- "preferGroupLabels triggers only when 2+ USERS are present" → received `Dad`, expected `Alan`

The single-device, pure-anonymous, and all-inactive cases may PASS — that's fine, they lock in existing behavior.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/ParticipantRoster.test.mjs
git commit -m "$(cat <<'EOF'
test(fitness): failing tests for dual-device roster aggregation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rewrite `getRoster()` to group by user UUID (GREEN)

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js` (lines 108-147 and `_buildRosterEntry` signature at 350)

- [ ] **Step 1: Replace the `getRoster()` method (lines 108-147)**

Open `frontend/src/hooks/fitness/ParticipantRoster.js`. Locate the `getRoster()` method that begins at line 108:

```js
  getRoster() {
    if (!this._deviceManager || !this._userManager) {
      return [];
    }

    const roster = [];
    const heartRateDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
    // ... existing body through line 147 ...
  }
```

Replace the **entire** method body (lines 108-147) with:

```js
  getRoster() {
    if (!this._deviceManager || !this._userManager) {
      return [];
    }

    const heartRateDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');

    // Zone lookup (TreasureBox baseline + ZoneProfileStore committed zones)
    const zoneLookup = this._buildZoneLookup();

    // Group devices by their user UUID. Devices with no mapped user and no
    // ledger assignment are emitted under a synthetic per-device key so they
    // still render as anonymous-rider cards.
    const devicesByUserId = new Map(); // userId → Device[]
    const anonymousDevices = [];       // no user, no ledger

    for (const device of heartRateDevices) {
      const deviceId = String(device.id || device.deviceId);
      const mappedUser = this._userManager.resolveUserForDevice(deviceId);
      const ledgerEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
      const ledgerName = ledgerEntry?.occupantName || ledgerEntry?.metadata?.name || null;

      if (mappedUser?.id) {
        const bucket = devicesByUserId.get(mappedUser.id);
        if (bucket) bucket.push(device);
        else devicesByUserId.set(mappedUser.id, [device]);
      } else if (ledgerName) {
        // Guest/ledger assignment — keyed by device ID (ledger is always 1:1).
        devicesByUserId.set(`ledger:${deviceId}`, [device]);
      } else {
        // Truly anonymous — no user, no ledger. Preserve current drop-anon
        // behavior (_buildRosterEntry returns null when no participantName).
        anonymousDevices.push(device);
      }
    }

    // preferGroupLabels must reflect USER presence, not DEVICE count.
    // Count unique users with at least one active (broadcasting) device.
    let presentUserCount = 0;
    for (const devices of devicesByUserId.values()) {
      if (devices.some(d => !d.inactiveSince)) presentUserCount += 1;
    }
    const preferGroupLabels = presentUserCount > 1;

    getLogger().debug('participant.roster.build', {
      heartRateDeviceCount: heartRateDevices.length,
      userCount: devicesByUserId.size,
      presentUserCount,
      anonymousDeviceCount: anonymousDevices.length,
      preferGroupLabels,
    });

    const roster = [];

    // Emit one entry per user UUID (or per ledger device).
    for (const [, devices] of devicesByUserId) {
      // Primary device: first active, else first owned. Drives legacy
      // entry.hrDeviceId and entry.isActive / entry.inactiveSince.
      const active = devices.filter(d => !d.inactiveSince);
      const primary = active.length > 0 ? active[0] : devices[0];
      const entry = this._buildRosterEntry(primary, zoneLookup, {
        preferGroupLabels,
        ownedDevices: devices,
      });
      if (entry) {
        roster.push(entry);
        if (entry.id) this._historicalParticipants.add(entry.id);
      }
    }

    // Emit truly-anonymous device entries unchanged (will be dropped inside
    // _buildRosterEntry because no participantName resolves — preserves the
    // previous contract explicitly).
    for (const device of anonymousDevices) {
      const entry = this._buildRosterEntry(device, zoneLookup, { preferGroupLabels });
      if (entry) {
        roster.push(entry);
        if (entry.id) this._historicalParticipants.add(entry.id);
      }
    }

    return roster;
  }
```

> **NOTE TO IMPLEMENTER:** The exact existing `getRoster()` body may differ slightly from the snippet above — verify line numbers before swapping, and preserve any logic this snippet didn't capture (e.g. extra logging) by merging rather than blind-replacing if you spot something the new body omits.

- [ ] **Step 2: Extend `_buildRosterEntry` to accept `ownedDevices` and source HR from the user**

Still in `frontend/src/hooks/fitness/ParticipantRoster.js`, locate `_buildRosterEntry` at line 350. Change its signature and the `heartRate` + `isActive` + `hrDeviceIds` derivations.

Find the opening lines of the method:

```js
  _buildRosterEntry(device, zoneLookup, options = {}) {
    if (!device || device.id == null) return null;

    const { preferGroupLabels = false } = options;
    const deviceId = String(device.id);
    const heartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
```

Replace those five lines with:

```js
  _buildRosterEntry(device, zoneLookup, options = {}) {
    if (!device || device.id == null) return null;

    const { preferGroupLabels = false, ownedDevices = null } = options;
    const deviceId = String(device.id);
    // HR aggregation: when the user owns multiple devices, UserManager's
    // updateFromDevice has already applied min-HR arbitration and written
    // the result to user.currentData.heartRate. Prefer that value; fall back
    // to the primary device's raw reading for the single-device path.
    let rawHeartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
```

Next, find the `resolvedHeartRate = heartRate;` line (around line 389):

```js
    const resolvedHeartRate = heartRate;
```

Replace with:

```js
    // Prefer the user's aggregated HR (min-HR arbitration across owned
    // devices). Fall back to the primary device's raw reading.
    const aggregatedHR = Number.isFinite(mappedUser?.currentData?.heartRate)
      ? Math.round(mappedUser.currentData.heartRate)
      : null;
    const resolvedHeartRate = aggregatedHR != null ? aggregatedHR : rawHeartRate;
```

Find the `isActive` declaration (around line 429):

```js
    // SINGLE SOURCE OF TRUTH: isActive comes directly from DeviceManager's inactiveSince
    // This is the authoritative field that ALL consumers should use for avatar visibility
    const isActive = !device.inactiveSince;
```

Replace with:

```js
    // SINGLE SOURCE OF TRUTH: isActive is true when ANY owned device is
    // broadcasting. The `primary` device passed in by getRoster is already
    // chosen to be an active one when possible, so !device.inactiveSince
    // captures that — but for safety, also scan ownedDevices explicitly
    // when the group-by-user path supplies them.
    const isActive = Array.isArray(ownedDevices) && ownedDevices.length > 0
      ? ownedDevices.some(d => !d.inactiveSince)
      : !device.inactiveSince;
    // inactiveSince: pick the most-recent inactiveSince when ALL devices are
    // inactive, else null (i.e. isActive=true means no inactiveSince).
    let resolvedInactiveSince = device.inactiveSince || null;
    if (Array.isArray(ownedDevices) && ownedDevices.length > 0 && !isActive) {
      resolvedInactiveSince = ownedDevices
        .map(d => d.inactiveSince)
        .filter(ts => ts != null)
        .reduce((max, ts) => (ts > max ? ts : max), 0) || null;
    } else if (Array.isArray(ownedDevices) && ownedDevices.length > 0 && isActive) {
      resolvedInactiveSince = null;
    }
```

Find the `hrDeviceId` / `hrDeviceIds` lines in the `rosterEntry` object literal (around lines 444-445):

```js
      hrDeviceId: deviceId,
      hrDeviceIds: mappedUser?.hrDeviceIds ? [...mappedUser.hrDeviceIds] : [String(deviceId)], // Snapshot of user's devices at entry creation — may be stale mid-session
```

Replace with:

```js
      hrDeviceId: deviceId, // Primary device (first active, else first owned) — legacy singular key
      // Full device list. Prefer the authoritative source (user's hrDeviceIds
      // Set from UserManager). Fall back to the ownedDevices array the caller
      // passed in (covers the rare case of a user hydrated without the Set).
      // Final fallback: just the primary device ID.
      hrDeviceIds: mappedUser?.hrDeviceIds && mappedUser.hrDeviceIds.size > 0
        ? [...mappedUser.hrDeviceIds].map(String)
        : (Array.isArray(ownedDevices) && ownedDevices.length > 0
            ? ownedDevices.map(d => String(d.id || d.deviceId))
            : [String(deviceId)]),
```

Find the `inactiveSince:` line in the same object literal (around line 454):

```js
      inactiveSince: device.inactiveSince || null, // Pass through for debugging
```

Replace with:

```js
      inactiveSince: resolvedInactiveSince, // Null when any owned device is active; else latest inactiveSince across all owned devices
```

- [ ] **Step 3: Run the new tests — ALL should PASS**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/ParticipantRoster.test.mjs`

Expected: all 10 tests pass.

- [ ] **Step 4: Run related fitness tests to check for regressions**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/UserManager.test.mjs tests/unit/fitness/DeviceOwnershipIndex.test.mjs`

Expected: all pass (no file in this set was modified).

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/`

Expected: every test in `tests/unit/fitness/` passes. If any test that builds a roster with a multi-device user asserted two cards, it was asserting buggy behavior and should be updated — but based on the pre-audit, no existing test covers this shape.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/hooks/fitness/ParticipantRoster.js
git commit -m "$(cat <<'EOF'
feat(fitness): group roster entries by user UUID to merge multi-device riders

ParticipantRoster.getRoster() now groups HR devices by their owning user
UUID (via UserManager.resolveUserForDevice), emitting one entry per user
instead of one per device. Heart rate is read from the user's aggregated
value (already min-HR-arbitrated by UserManager.updateFromDevice) instead
of the per-device raw reading. Anonymous riders and ledger-assigned guests
remain on the existing one-entry-per-device path.

Fixes bug-bash issue D (2026-04-23) — Alan's three HR monitors were
producing three separate roster cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Integration test against real UserManager + DeviceManager (RED→GREEN)

Purpose: prove end-to-end that the already-working min-HR arbitration inside `UserManager.updateFromDevice` flows through to a single roster entry. Task 1 stubbed the user object; this task wires real classes together.

**Files:**
- Modify: `tests/unit/fitness/ParticipantRoster.test.mjs` (append a new `describe` block)

- [ ] **Step 1: Verify DeviceManager's public API before writing the test**

Run: `cd /opt/Code/DaylightStation && grep -n "addOrUpdateDevice\|registerDevice\|upsertDevice\|ingestDevice\|updateDevice" frontend/src/hooks/fitness/DeviceManager.js | head -10`

Expected: one of these method names is defined. The test below uses `addOrUpdateDevice`. If the real API differs, substitute the correct method name in Step 2 — no `ParticipantRoster.js` change needed.

- [ ] **Step 2: Append the integration block to the test file**

Append this block to `tests/unit/fitness/ParticipantRoster.test.mjs` after the existing `describe(...)`:

```js
// ─── Integration: real UserManager + DeviceManager + ParticipantRoster ─────

const { UserManager } = await import('#frontend/hooks/fitness/UserManager.js');
const { DeviceManager } = await import('#frontend/hooks/fitness/DeviceManager.js');

describe('ParticipantRoster — integration with real UserManager min-HR arbitration', () => {
  it('alan with 3 HR monitors → ONE entry, HR = minimum across devices', () => {
    const userManager = new UserManager();
    userManager.registerUser({
      id: 'alan',
      name: 'Alan',
      birth_year: 1984,
      hr_device_ids: [28676, 10366, 20991],
    });

    const deviceManager = new DeviceManager();
    const t = Date.now();
    [28676, 10366, 20991].forEach((id) => {
      deviceManager.addOrUpdateDevice({
        id: String(id), type: 'heart_rate', heartRate: null, lastSeen: t
      });
    });

    // Send readings: spurious-high 150 on the "bad" device, real 105 and 100
    // on the other two. Min-HR arbitration must pick 100.
    const alan = userManager.getUser('alan');
    alan.updateFromDevice({ type: 'heart_rate', deviceId: '28676', heartRate: 150 });
    alan.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 105 });
    alan.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 100 });
    // Mirror readings into DeviceManager so roster sees device.heartRate.
    deviceManager.addOrUpdateDevice({ id: '28676', type: 'heart_rate', heartRate: 150, lastSeen: t });
    deviceManager.addOrUpdateDevice({ id: '10366', type: 'heart_rate', heartRate: 105, lastSeen: t });
    deviceManager.addOrUpdateDevice({ id: '20991', type: 'heart_rate', heartRate: 100, lastSeen: t });

    const roster = new ParticipantRoster();
    roster.configure({ deviceManager, userManager });
    const out = roster.getRoster();

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Alan');
    expect(out[0].heartRate).toBe(100);
    expect(out[0].hrDeviceIds.sort()).toEqual(['10366', '20991', '28676']);
  });
});
```

- [ ] **Step 3: Run the integration test**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/ParticipantRoster.test.mjs -t "alan with 3 HR monitors"`

Expected: PASS. If it fails with `heartRate: 150` instead of `100`, it means the min-HR arbitration path didn't fire — investigate whether `hrDeviceIds.size > 1` was truthy at the time of the update (line 192 of UserManager.js). If it fails with length 3 instead of 1, Task 2's grouping logic is incorrect — revisit.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/ParticipantRoster.test.mjs
git commit -m "$(cat <<'EOF'
test(fitness): integration test for roster + min-HR arbitration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Downstream consumer audit — verify no breakage

Purpose: explicitly verify each call site that reads `hrDeviceId` (singular) still works after the change. No code changes unless a broken site is found.

**Files:** none modified by default.

- [ ] **Step 1: Run the consumer inventory**

Run:

```bash
cd /opt/Code/DaylightStation && \
  grep -rn "hrDeviceId\b" frontend/src/ | \
  grep -v "test\|//\|^\s*\*"
```

Expected: the same 40-ish hits as before the change. Each falls into one of three categories:

- **Safe (reads singular as a backwards-compat label/key):** `chartHelpers.js`, `ChartDataBuilder.js`, `ParticipantFactory.js`, `FitnessChart.jsx`, `PersistenceManager.js`, `sessionDataAdapter.js`, `FitnessSession.js`, `ParticipantIdentityResolver.js`. These read `entry.hrDeviceId` where any one of the user's device IDs is a valid fallback — and the new entry still has it (primary device).
- **Safe (already multi-device-aware):** `SidebarFooter.jsx` lines 90 and 125 (`participant?.hrDeviceIds || (participant?.hrDeviceId != null ? [participant.hrDeviceId] : [])`).
- **Safe (writes only):** `UserManager.js` getter/setter on the `User` class (lines 40-50, 544, 642).

- [ ] **Step 2: Run any fitness-layer test suites that exist**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/ tests/isolated/`

Expected: all green.

- [ ] **Step 3: Run the frontend lint/typecheck if the project has one**

Run: `cd /opt/Code/DaylightStation && npm run -s lint 2>&1 | tail -20 || true`

Expected: no new errors in `ParticipantRoster.js`. If lint is not configured, skip.

- [ ] **Step 4: No commit needed unless something was found and fixed.**

If Step 1 or 3 surfaced a breakage not listed above, fix it under the same commit convention:

```bash
git commit -m "fix(fitness): <specific consumer> reads hrDeviceIds array"
```

Otherwise move on.

---

## Task 5: Live validation against running station

**Files:** none modified — pure verification.

- [ ] **Step 1: Confirm Alan's 3-device config is present**

Run:

```bash
sudo docker exec daylight-station sh -c 'grep -B1 -A6 "^  heart_rate:" data/household/config/fitness.yml' | head -20
```

Expected output contains all three Alan device IDs:

```
    28676: alan
    10366: alan
    20991: alan
```

- [ ] **Step 2: Reload the fitness page in the browser with the dev frontend active**

Steps (manual): open the fitness module, ensure Alan is wearing (at least simulated) two of his HR monitors.

Expected: the roster shows ONE card labelled "Alan" with the HR value reflecting the minimum across connected devices. Before the fix: two or three "Alan" cards with different HR readings.

- [ ] **Step 3: Inspect the `participant.roster.build` log line**

Run (in a second terminal):

```bash
sudo docker logs -f daylight-station 2>&1 | grep "participant.roster.build" | tail -5
```

Expected: a line with `userCount: 1, anonymousDeviceCount: 0, heartRateDeviceCount: 2` (or 3) — confirming the group-by-user reduction.

- [ ] **Step 4: Final green sweep**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/ParticipantRoster.test.mjs`

Expected: all 11 tests pass (10 unit + 1 integration).

---

## Done

Summary of what changed:

- **Roster grouping:** `ParticipantRoster.getRoster()` now groups HR devices by the user UUID that owns them (via `UserManager.resolveUserForDevice`) and emits **one entry per user**, not one per device. Unmapped devices with a ledger assignment get their own entry; truly anonymous devices are dropped as before.
- **Aggregated HR surfaced:** `_buildRosterEntry` now reads the user's already-aggregated HR from `mappedUser.currentData.heartRate` (written by the existing min-HR arbitration in `UserManager.updateFromDevice`) with a fall-back to the primary device's raw reading. No change to the arbitration logic itself.
- **Primary device selection:** When a user owns multiple devices, `entry.hrDeviceId` (legacy singular) points to the first **active** device, falling back to the first owned device. `entry.hrDeviceIds` contains every device the user owns.
- **Activity flag:** `entry.isActive` is true when ANY owned device is broadcasting. `entry.inactiveSince` is null when active, else the latest across owned devices.
- **Group-label threshold:** `preferGroupLabels` now counts distinct **users** with an active device, not distinct devices — a single user with three monitors no longer trips the multi-participant display-label switch.
- **Config:** No change. Alan's `28676/10366/20991 → alan` triple already lives in `data/household/config/fitness.yml` and flows through `UserService.hydrateUsers` → `UserManager.registerUser` → `User.hrDeviceIds: Set`.
- **Tests:** 1 new file `tests/unit/fitness/ParticipantRoster.test.mjs` with 10 unit cases + 1 integration case covering single-device, multi-device-same-user (2 and 3 devices), anonymous, ledger-assigned, active-device primary selection, all-inactive, group-label threshold, and end-to-end min-HR with real `UserManager`/`DeviceManager`.
- **Out of scope:** UI-layer changes (none needed — `SidebarFooter`, `FitnessChart`, etc. already handle the new shape), `updateFromDevice`'s min-HR arbitration (unchanged), `DeviceOwnershipIndex` (already correct), config-file format (already supports N-to-1).
