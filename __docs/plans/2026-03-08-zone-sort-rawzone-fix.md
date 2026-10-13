# Zone Sort Raw Zone Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the visual zone sort mismatch where card colors (based on rawZoneId) don't match sort order (based on committed zoneId), causing "yellow user in green group" anomalies during hysteresis suppression.

**Architecture:** Change the HR device sort in `FitnessUsers.jsx` to use `rawZoneId` (real-time) instead of `getDeviceZoneId()` (committed/hysteresis-delayed). Card colors already use `rawZoneId`. LED sync already uses `rawZoneId`. Governance and history charts continue to use committed zones.

**Tech Stack:** React, FitnessUsers.jsx sort comparator

---

## Task 1: Change HR sort to use rawZoneId

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx:625-643`

**Step 1: Add raw zone lookup helper**

Add a `getRawZoneId` function next to `getDeviceZoneId` that resolves rawZoneId from the participant entry, falling back to `getDeviceZoneId` for devices without a participant entry:

```javascript
const getRawZoneId = (device) => {
  if (device.type !== 'heart_rate') return null;
  const deviceKey = String(device.deviceId);
  const participantEntry = participantByHrId.get(deviceKey) || participantsByDevice.get(deviceKey) || null;
  const rawId = participantEntry?.rawZoneId;
  if (rawId) {
    const normalized = String(rawId).toLowerCase();
    return canonicalZones.includes(normalized) ? normalized : null;
  }
  // Fallback to committed zone if no raw zone available
  return getDeviceZoneId(device);
};
```

**Step 2: Update the HR sort comparator**

Replace `getDeviceZoneId` with `getRawZoneId` in the sort:

```javascript
hrDevices.sort((a, b) => {
  const aZone = getRawZoneId(a);
  const bZone = getRawZoneId(b);
  // ... rest unchanged
});
```

**Step 3: Commit**

```
fix(fitness): sort HR participants by rawZoneId to match displayed card colors
```

---

## Verification

After deployment, check session logs for `exit_margin_suppressed` events. When these fire, the user's card color (raw) and sort position should now be consistent — both based on the real-time zone, not the hysteresis-delayed committed zone.
