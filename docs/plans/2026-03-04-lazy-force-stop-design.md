# Lazy Force-Stop for FKB Prepare Step

**Date:** 2026-03-04
**Status:** Approved
**Problem:** `prepareForContent()` always force-stops FKB, adding 10-20s startup delay. The foreground verification window (5 × 500ms = 2.5s) is too short for FKB to restart, causing false "failed" results.

---

## Current Flow

1. `screenOn`
2. `setBooleanSetting` × 3 (disable background services)
3. `am force-stop de.ozerov.fully` (always)
4. `launchActivity` (relaunch FKB)
5. Foreground verification: 5 attempts × 500ms = 2.5s max
6. Launch companion apps (AudioBridge)
7. Camera check

**Problem:** Step 5 gives FKB only 2.5s, but it needs 10-20s after force-stop.

## New Flow

### Phase 1 — Soft Prepare (fast path, ~2-3s)

1. `screenOn`
2. `setBooleanSetting` × 3 (disable background services)
3. `toForeground` + verification loop: **15 attempts × 1000ms = 15s max**
4. Launch AudioBridge companion app
5. **Mic check** via `dumpsys activity services de.ozerov.fully` — look for `SoundMeterService` or `MotionDetectorService`
6. If no problematic services found → return success

### Phase 2 — Force Restart (only if mic blocked)

7. `am force-stop de.ozerov.fully`
8. Wait 500ms
9. `launchActivity` (relaunch FKB)
10. Re-run foreground verification loop (15 attempts × 1000ms)
11. Re-launch AudioBridge
12. Return success (skip second mic check — force-stop guarantees release)

### Camera Check

Unchanged — runs after whichever phase completes.

---

## Mic Detection

**Method:** `#isMicBlocked()` (private, on FullyKioskContentAdapter)

```
adb shell dumpsys activity services de.ozerov.fully
```

Returns `true` if output contains `SoundMeterService` or `MotionDetectorService` (the known mic/camera holders from the AudioBridge DESIGN.md).

Returns `false` if ADB adapter is unavailable — assume OK, skip check.

---

## Constants Changed

| Constant | Old | New |
|----------|-----|-----|
| `MAX_FOREGROUND_ATTEMPTS` | 5 | 15 |
| `FOREGROUND_RETRY_MS` | 500 | 1000 |

---

## Progress Reporting

No changes to WakeStepper or WebSocket progress events. The `prepare` step still emits `running` → `done`/`failed`. The mic check and potential force-restart happen transparently within the `prepare` step.

---

## Files Modified

| File | Change |
|------|--------|
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Restructure `prepareForContent()`, add `#isMicBlocked()`, update constants |

---

## Failure Cases

- Foreground verification exhausted after phase 1 (no force-stop): returns `{ ok: false, step: 'toForeground' }` — phone shows retry
- Foreground verification exhausted after phase 2 (with force-stop): same failure return — phone shows retry
- ADB unavailable: skips mic check and force-stop, behaves like phase 1 only
