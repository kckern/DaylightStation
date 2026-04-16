# Fitness Device Ownership — SSoT / DRY / Separation of Concerns Audit

**Date:** 2026-04-15
**Trigger:** Adding a second ANT+ HR strap for user "alan" (device 20991) revealed that the system assumes a 1:1 device-to-user mapping at every layer. The fix required changes across **10+ files** and **~15 code sites** — evidence of severe SSoT and DRY violations in device ownership resolution.

**Related prior audit:** `2026-02-25-fitness-participant-resolution-ssot-audit.md` (covers participant *list building* fragmentation; this audit covers *device ownership* fragmentation specifically).

---

## Summary

"Does this device belong to this user?" is answered by **inline string comparisons in 15 files** instead of a single authoritative method. `UserManager.resolveUserForDevice()` exists as the intended SSOT, and `FitnessContext` exposes it as `getUserByDevice()` — but half the codebase bypasses both and does its own `user.find(u => String(u.hrDeviceId) === deviceId)`.

This means any change to the device ownership model (multi-device, device reassignment, device aliasing) must be applied to every inline comparison individually, with different fallback patterns in each file.

---

## Architecture Violations

### V1: Device Ownership Resolved in 4 Distinct Ways

| Pattern | Where | Count |
|---------|-------|-------|
| `UserManager.resolveUserForDevice(id)` | FitnessSession, ParticipantRoster, ParticipantIdentityResolver, TimelineRecorder, MetricsRecorder | 7 call sites |
| `FitnessContext.getUserByDevice(id)` (wraps above) | FitnessUsers, SidebarFooter, FullscreenVitalsOverlay, FitnessSidebarMenu | 10 call sites |
| Inline `.find(u => String(u.hrDeviceId) === id)` | FitnessUsers, FullscreenVitalsOverlay (x2), SidebarFooter | 5 call sites |
| Inline map-building from `hrDeviceId` field | SidebarFooter (`hrOwnerMap`, `userIdMap`), FitnessContext (`participantLookupByDevice`, `userVitalsMap`) | 4 call sites |

Patterns 1 and 2 are the intended path. Patterns 3 and 4 bypass the SSOT entirely.

### V2: Inline `.find()` Fallbacks Alongside `getUserByDevice`

Multiple components call `getUserByDevice` as the primary path but include an inline `.find()` as a fallback in the same expression:

```javascript
// FitnessUsers.jsx:538-540
const userObj = typeof getUserByDevice === 'function'
  ? getUserByDevice(deviceKey)
  : registeredUsers.find(u => String(u.hrDeviceId) === deviceKey);
```

This pattern appears in:
- `FitnessUsers.jsx` (lines 538-540, 893-895)
- `FullscreenVitalsOverlay.jsx` (line 144-146) — **two separate copies** of this component exist
- `FullscreenVitalsOverlay.jsx` in `shared/integrations/` (line 146-148)

The fallback reimplements resolution logic with different behavior than the SSOT (no ledger check, no guest handling, single-field comparison only).

### V3: `hrDeviceId` as a Leaky Primitive

The `User.hrDeviceId` field is directly accessed by 15 files totaling 45 references. It is used for:

1. **Ownership matching** — `String(u.hrDeviceId) === deviceId` (should be a method)
2. **Identity fallback** — `entry.profileId || entry.hrDeviceId || 'anon'` (7 sites)
3. **Map key building** — `map[String(participant.hrDeviceId)] = name` (4 sites)
4. **Descriptor serialization** — `{ hrDeviceId: user.hrDeviceId }` (3 sites)
5. **Roster signature** — JSON.stringify includes hrDeviceId for change detection

The field is a raw implementation detail that leaked into the public API of every layer. When the data model changed from single to multi-device, every consumer broke.

### V4: Backend Sends Single Device ID

`UserService.hydrateUsers()` and `hydrateFitnessConfig()` both had:

```javascript
for (const [deviceId, userId] of Object.entries(deviceMappings.heart_rate)) {
  if (userId === username) {
    hydrated.hr = parseInt(deviceId, 10);
    break;  // <-- Only first device survives
  }
}
```

The `break` statement silently discarded all but the first matching device. The YAML config supports N devices per user (`20991: alan`, `10366: alan`, `28676: alan`) but the hydration layer collapsed this to 1.

**Fixed in this session** — now sends `hr_device_ids: [28676, 10366, 20991]` alongside `hr` for backwards compat.

### V5: Duplicate FullscreenVitalsOverlay Components

Two nearly-identical copies of `FullscreenVitalsOverlay` exist:
- `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`
- `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx`

Both contain the same device resolution logic, the same inline `.find()` fallback, and needed the same multi-device fix applied independently. This is a DRY violation at the component level.

### V6: Device-to-Name Maps Rebuilt in Multiple Components

At least 4 independent maps from device ID → user info are built:

| Location | Map | Built From |
|----------|-----|-----------|
| `SidebarFooter.jsx` `hrOwnerMap` | deviceId → name | participantRoster, participantsByDevice, usersConfigRaw |
| `SidebarFooter.jsx` `userIdMap` | deviceId → profileId | participantRoster, participantsByDevice |
| `FitnessContext.jsx` `participantLookupByDevice` | deviceId → roster entry | participantRoster |
| `FitnessContext.jsx` `userVitalsMap` | userId → vitals (includes deviceId) | allUsers |

Each uses a different source priority and different fallback chains. When multi-device was added, each needed separate fixes.

### V7: Type Coercion Inconsistency

Device IDs arrive as numbers from ANT+ but are compared as strings throughout. The coercion is ad-hoc:
- Some sites use `String(u.hrDeviceId) === String(device.deviceId)`
- Some use `parseInt(deviceId, 10)` when storing
- Some use bare `===` with no coercion
- The User class stores them as strings in a Set; the backend sends integers

There is no canonical type for a device ID. This creates subtle bugs when `28812` (number) doesn't match `"28812"` (string).

---

## Impact Assessment

### Blast Radius of a Device Model Change

Adding multi-device support required touching:

| Layer | Files Modified | Changes |
|-------|---------------|---------|
| Backend config | `UserService.mjs` | 2 sites (primary + inline hydration) |
| Frontend domain | `UserManager.js` | Constructor, getter/setter, `updateFromDevice`, `resolveUserForDevice`, `assignGuest`, `registerUser`, `getDeviceOwnership`, `#buildUserDescriptor`, `#ensureUserFromAssignment` |
| Frontend session | `FitnessSession.js` | 2 ledger reconciliation sites |
| Frontend UI | `FitnessUsers.jsx` | 2 inline `.find()` calls |
| Frontend UI | `FullscreenVitalsOverlay.jsx` (x2) | 1 inline `.find()` each |
| Frontend UI | `SidebarFooter.jsx` | 3 map-building loops |

**Total: 7 files, ~20 code sites.** If device ownership had a single resolution point, this would have been a **2-file change** (backend hydration + `UserManager`).

### Risk of Remaining Inline References

The following files still use `hrDeviceId` directly and may not fully support multi-device:

| File | Usage | Risk |
|------|-------|------|
| `ParticipantRoster.js:246` | `deviceRoster.map(e => e.hrDeviceId)` — builds Set of device IDs | Medium — only gets first device per user |
| `ParticipantRoster.js:303` | `entry.hrDeviceId === nameOrId` — identity match | Low — used for lookup, not ownership |
| `PersistenceManager.js:130,175,179` | Uses hrDeviceId for session save participant IDs | Medium — session data may miss second device |
| `FitnessContext.jsx:1603` | `entry.hrDeviceId ?? entry.deviceId` for participantLookupByDevice | Medium — only indexes first device |
| `FitnessContext.jsx:1629` | `user.hrDeviceId` for userVitalsMap | Low — maps by userId, device is secondary |
| `ParticipantFactory.js:50,62,75` | Device matching and descriptor building | Medium — may fail to match second device |
| `FitnessChart.jsx:113-114,178,850` | Uses hrDeviceId as fallback identifier | Low — display/identity only |
| `chartHelpers.js:74,78` | Fallback ID and descriptor field | Low — display only |
| `sessionDataAdapter.js:112,122` | Historical session data rendering | Low — display only |

---

## Root Causes

### RC1: No Device Ownership Abstraction

There is no `DeviceOwnershipService` or equivalent that answers: "given a device ID, who owns it?" and "given a user, what devices do they own?" The `UserManager` partially fills this role with `resolveUserForDevice()`, but:
- It's a method on UserManager, not a standalone service
- UI components often don't have access to the UserManager instance
- They receive pre-serialized descriptor objects (plain objects, not User instances)
- So they fall back to inline field comparisons

### RC2: Descriptor Objects Lose Behavior

`#buildUserDescriptor()` serializes User instances into plain objects. Once serialized:
- No `ownsHrDevice()` method available
- Must inline the ownership check
- Every consumer reimplements it differently

### RC3: Context Exposes Data Instead of Queries

`FitnessContext` exposes `allUsers`, `participantRoster`, `deviceConfiguration` — raw data arrays that consumers search through. It should instead expose **query functions** like `getUserByDevice()` (which it does, but components use the raw arrays anyway because they're also available).

### RC4: No Schema Contract for Device IDs

The config YAML stores device IDs as YAML integers. The backend sends them as JSON numbers. The frontend converts them to strings at various points. There is no agreed-upon canonical type, leading to ad-hoc `String()` / `parseInt()` coercions.

---

## Recommended Refactoring

### R1: Single Device Resolution Function (High Priority)

Create a single `resolveDeviceOwner(deviceId)` function that:
- Lives in a dedicated module (e.g., `hooks/fitness/DeviceOwnership.js`)
- Is the ONLY place device→user resolution happens
- Handles multi-device, ledger, guest assignments, type coercion
- Is exposed through FitnessContext as the sole API for components
- Returns a typed result: `{ user, deviceIds, isGuest, source }`

**Eliminate all inline `.find(u => String(u.hrDeviceId) === ...)` patterns.**

### R2: Replace Raw Field Access with Methods (High Priority)

On the `User` class:
- `ownsHrDevice(deviceId)` — already added in this fix, but not yet used everywhere
- `getHrDeviceIds()` — returns array, single source of truth
- Remove direct access to `hrDeviceIds` Set from outside the class

On descriptor objects:
- Include `hrDeviceIds` array in all descriptors
- Add a standalone `descriptorOwnsDevice(descriptor, deviceId)` utility
- Migrate all inline comparisons to use it

### R3: Deduplicate FullscreenVitalsOverlay (Medium Priority)

The two copies in `player/overlays/` and `shared/integrations/` should be consolidated into one. If they differ, extract the differences into props/configuration rather than maintaining two parallel files.

### R4: Replace Device-to-Name Maps with Context Queries (Medium Priority)

Instead of each component building its own `deviceId → name` map from raw roster data:
- `FitnessContext` should expose `getDeviceOwnerName(deviceId)` and `getDeviceOwnerProfile(deviceId)`
- Components call the query function instead of rebuilding maps
- Single cache point, single update path

### R5: Canonical Device ID Type (Low Priority)

Establish a convention: device IDs are **strings** everywhere in the frontend. Apply coercion once at the boundary (when config is loaded / when WS messages arrive) and never again downstream. This eliminates 15+ `String()` calls scattered across the codebase.

### R6: Backend Should Send Resolved Ownership Map (Low Priority)

Instead of each client reconstructing device→user from two separate config sections (`devices.heart_rate` and `users`), the API response should include a pre-resolved `deviceOwnership` map:

```json
{
  "deviceOwnership": {
    "heartRate": {
      "20991": { "userId": "alan", "color": "green" },
      "10366": { "userId": "alan", "color": "green" },
      "28812": { "userId": "felix", "color": "red" }
    }
  }
}
```

This eliminates the client-side join between `devices.heart_rate` and `device_colors.heart_rate`.

---

## Files Inventory

All files that reference `hrDeviceId` directly (45 total references across 15 files):

| File | Refs | Role |
|------|------|------|
| `hooks/fitness/UserManager.js` | 3 | Domain model — SSOT for device ownership |
| `hooks/fitness/FitnessSession.js` | 6 | Session orchestrator — ledger reconciliation |
| `hooks/fitness/ParticipantRoster.js` | 2 | Roster building |
| `hooks/fitness/ParticipantIdentityResolver.js` | 3 | Identity resolution |
| `hooks/fitness/PersistenceManager.js` | 4 | Session save/restore |
| `hooks/fitness/TimelineRecorder.js` | 0* | Uses resolveUserForDevice (clean) |
| `hooks/fitness/MetricsRecorder.js` | 0* | Uses resolveUserForDevice (clean) |
| `context/FitnessContext.jsx` | 4 | Context provider — exposes raw data + queries |
| `modules/Fitness/player/panels/FitnessUsers.jsx` | 5 | UI — player panel |
| `modules/Fitness/nav/SidebarFooter.jsx` | 3 | UI — sidebar |
| `modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` | 1 | UI — vitals overlay (copy 1) |
| `modules/Fitness/shared/integrations/.../FullscreenVitalsOverlay.jsx` | 1 | UI — vitals overlay (copy 2) |
| `modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | 4 | UI — chart |
| `modules/Fitness/widgets/FitnessChart/sessionDataAdapter.js` | 2 | Chart data transform |
| `modules/Fitness/domain/ChartDataBuilder.js` | 1 | Chart data builder |
| `modules/Fitness/domain/ParticipantFactory.js` | 4 | Participant model factory |
| `modules/Fitness/lib/chartHelpers.js` | 2 | Chart utility functions |

\* TimelineRecorder and MetricsRecorder correctly use `resolveUserForDevice` — included for completeness.

---

## Current State (Post-Fix)

The immediate multi-device bug is fixed:
- Backend sends `hr_device_ids` array for all users
- `User` class stores a `Set` of device IDs with `ownsHrDevice()` method
- `hrDeviceId` getter/setter provides backwards compat
- Multi-device HR arbitration uses lowest reading as canon (most accurate)
- Key UI find-by-device callsites updated with `hrDeviceIds?.includes()` fallback

**However**, the architectural debt remains: 15 files still access the raw field, and the inline resolution pattern will re-emerge with the next device model change (BLE devices, device aliasing, device sharing between sessions, etc.).

---

## Post-Refactor Status (completed 2026-04-15)

- [x] DeviceOwnershipIndex is the SSoT for device→user mapping
- [x] All inline `.find(u => hrDeviceId === ...)` patterns removed from UI components
- [x] FitnessUsers, FullscreenVitalsOverlay (both copies) use `getUserByDevice?.()` context query
- [x] SidebarFooter already uses `hrDeviceIds` consistently (verified, no changes needed)
- [x] Roster entries carry `hrDeviceIds` array (snapshot of user's devices at entry creation)
- [x] FitnessContext `participantLookupByDevice` indexes all device IDs per user
- [x] FitnessContext `resolveUserByDevice` routes through DeviceOwnershipIndex as Priority 1
- [x] FitnessSession ledger checks simplified to `ownsHrDevice?.()` with null-safety
- [x] Remaining `hrDeviceId` references are backwards-compat getters or identity fallbacks (non-ownership)
- [x] Zero remaining `String(.*hrDeviceId) ===` patterns in frontend source (excluding tests)
- [ ] FullscreenVitalsOverlay deduplication deferred — shared/integrations and player/overlays copies have diverged in RPM handling (103-line diff). Requires prop reconciliation before merge.
