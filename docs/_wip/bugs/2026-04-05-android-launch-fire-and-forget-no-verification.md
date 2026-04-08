# Android App Launch — Fire-and-Forget with No Verification

**Date:** 2026-04-05
**Severity:** Critical — complete UX failure, user gets silently dumped back to menu
**Device:** Shield TV (livingroom-tv)
**Area:** Menu → AndroidLaunchCard → FKB `startApplication` flow
**Status:** Investigating

---

## Symptom

User selects "Gospel Stream" from the living room TV menu. The card shows "Launching..." for ~1.5 seconds, then auto-dismisses. The app never opens. User is silently returned to the menu grid with no error feedback, no retry option, and no indication that anything went wrong.

FKB deviceInfo confirms foreground is `com.android.systemui` — the target app (`org.lds.stream`) never launched.

## Evidence from Prod Logs

### Timeline (2026-04-05, ~15:09:47–15:09:57 UTC)

| Time (UTC) | Event | Source |
|------------|-------|--------|
| 15:09:47 | `menu-perf.snapshot` — menu visible on Shield | frontend/screens |
| 15:09:53–55 | Three `menu.scroll.decision` events — user navigating down (index 5→10→15) | frontend/MenuItems |
| 15:09:56.263 | `fkb.keyCapture` — Enter pressed | frontend/fkb |
| 15:09:56.265 | `menu.select` — index 15, title "Gospel Stream" | frontend/MenuItems |
| 15:09:56.267 | `android-launch.intent` — package `org.lds.stream`, activity `.ux.androidtv.main.TvMainActivity` | frontend (MenuStack) |
| 15:09:56.268 | `nav.push` — type `android-launch` | frontend/MenuNav |
| 15:09:57 | `list.menu_log` — asset `android:org.lds.stream` logged | backend/content |
| **Missing** | **No `fkb.launch.attempt` log** | **Expected from fkb.js:34** |
| **Missing** | **No success/failure/error log from AndroidLaunchCard** | **No error path exists** |

### Key Observation

The `android-launch.intent` log (line 131 of MenuStack.jsx) fires — this confirms MenuStack routed to the `android-launch` type. But there is **no `fkb.launch.attempt`** log, which is emitted by `launchApp()` in `fkb.js:34`. Either:

1. The log was lost in WebSocket transport batching during the rapid mount/dismiss cycle, OR
2. `launchApp()` was called but `fully.startApplication()` failed silently

Either way, the app didn't launch, and the user got zero feedback.

### FKB Foreground Verification

```
$ docker exec daylight-station node -e "..." # FKB deviceInfo query
{"foreground":"com.android.systemui","appVersion":"1.60.1-play"}
```

Foreground is `com.android.systemui` — not the target app, and not even FKB itself. The Shield is sitting on the system UI.

### ADB Unavailable

ADB is in `unauthorized` state — cannot verify via logcat:
```
already connected to 10.0.0.11:5555
adb: device unauthorized.
```

## Root Cause Analysis

### The Fire-and-Forget Pattern

`AndroidLaunchCard` (`frontend/src/modules/Menu/AndroidLaunchCard.jsx`) has a fundamentally broken launch flow:

```javascript
// Line 25-27: The entire "launch" logic
setStatus('launching');
launchApp(android.package);           // fire-and-forget
scheduleDismissAfterLaunch(onClose);  // auto-dismiss after 1500ms
```

1. **`launchApp()`** calls `fully.startApplication(packageName)` — this is a void FKB JS API call with no return value, no callback, no error reporting
2. **`scheduleDismissAfterLaunch()`** sets a 1500ms timer to call `onClose()`, which pops the nav stack back to the menu
3. **No verification** — nothing checks if the app actually launched
4. **No error state** — the component has no `failed` status, no retry button, no error message
5. **No timeout detection** — if JS is still running after 2s (meaning FKB is still in foreground, meaning the app didn't launch), nothing happens

### Contrast with LaunchCard

`LaunchCard` (`frontend/src/modules/Menu/LaunchCard.jsx`) handles a similar use case (launching RetroArch games) but has proper rigor:

| Capability | LaunchCard | AndroidLaunchCard |
|-----------|-----------|-------------------|
| Backend coordination | Yes — calls `/api/v1/launch` | No — purely client-side |
| Error states | `error` status with message | None |
| Retry | Yes — button + keypress handler | None |
| Schedule blocking | Yes — checks `/api/v1/content/schedule/` | None |
| FKB intent fallback | Yes — tries FKB intent first, falls back to API | Just `startApplication` |
| Verification | Via API response | None |
| Status states | `loading`, `launching`, `success`, `error`, `blocked` | `checking`, `launching`, `unavailable` |

### Why `fully.startApplication` Fails Silently

FKB's `startApplication(packageName)` is documented as fire-and-forget. Common failure modes:
- App not installed (no error thrown)
- App crashes on launch (no error thrown)
- FKB kiosk mode interferes with the launched activity
- Android 11 background restrictions prevent the launch
- Package name doesn't match installed app exactly

In all cases, FKB stays in the foreground and JS execution continues normally — but there's nothing in `AndroidLaunchCard` that treats "still in foreground after launch" as a failure signal.

## Affected Code

| File | Role |
|------|------|
| `frontend/src/modules/Menu/AndroidLaunchCard.jsx` | The broken component — fire-and-forget launch, auto-dismiss, no verification |
| `frontend/src/lib/fkb.js` | `launchApp()` at line 29 — calls `fully.startApplication`, returns boolean but doesn't verify launch |
| `frontend/src/lib/fkb.js` | `scheduleDismissAfterLaunch()` at line 78 — unconditional 1500ms auto-dismiss |
| `frontend/src/modules/Menu/MenuStack.jsx` | Line 129-138 — routes `selection.android` to `android-launch` type |

## Impact

- **Any Android app launched from the menu** is affected (not just Gospel Stream)
- User sees "Launching..." → card vanishes → nothing happens
- No error feedback, no retry — user must re-navigate and try again (which will also fail)
- On Shield TV with a remote, re-navigating through the menu takes 10+ seconds of D-pad presses

## Proposed Fix

### Verification via JS Execution Timing

When `fully.startApplication()` succeeds, FKB goes to background and the WebView's JS execution is **suspended**. Timers set before the launch won't fire until FKB returns to foreground (via `onResume`).

This gives us a free verification signal:
- **Timer fires at ~2.5s** → JS was never suspended → FKB stayed in foreground → **app didn't launch** → show error + retry
- **Timer doesn't fire** (JS suspended) → app launched → when `onResume` fires later, clean up

### Required Changes

1. **AndroidLaunchCard** — Replace fire-and-forget with verified launch:
   - After calling `launchApp()`, set a 2.5s verification timer
   - If timer fires (still in foreground): transition to `failed` state with retry
   - Register `onResume` handler for success confirmation
   - Add `failed` status with "Press OK to retry / Press Back to return" UX
   - Cap retries at 2 attempts

2. **SCSS** — Add `--failed` modifier styling (red status text, consistent with `--unavailable`)

3. **No backend changes needed** — the fix is purely in the frontend launch verification

### Why Not Route Through Backend Like LaunchCard?

`LaunchCard` is designed for content that needs backend orchestration (RetroArch with ROM paths, intent extras, device targeting). Android app launches are simpler — they just need `fully.startApplication(packageName)`. The issue isn't the launch mechanism, it's the **lack of verification and error UX**. Adding backend roundtrips would add latency without solving the core problem.
