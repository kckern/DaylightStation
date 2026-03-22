# Bug: Stale player overlay blocks video when queue autoplay fails

**Date:** 2026-03-22
**Severity:** High — user hears audio but sees a spinner indefinitely
**Area:** Screen Framework → Player → Overlay lifecycle

## Symptom

After a kitchen button press loads content on the living room TV, the user hears audio playing but sees only a loading spinner. The screen is unusable without a manual page reload.

## Root Cause

When `ScreenActionHandler` emits a `media:queue` action, it creates a Player overlay. Due to the queue autoplay bug (see `2026-03-22-screen-queue-autoplay-broken.md`), the Player receives a string array instead of an object, can't resolve a contentRef, and gets stuck in "Starting..." state forever.

Meanwhile, the screen's menu fallback shows content and a second Player instance starts playing underneath. The stale overlay from the first (broken) Player sits on top, showing a spinner over the actually-playing content.

### Evidence from logs

Two simultaneous Player overlay instances on the Shield:

```
[00090f6f25] vis:41001ms | status:Starting… | t=0.0   ← stale spinner (ON TOP)
[00e10e7236] vis:n/a     | status:playing   | t=38.5  ← actual playback (HIDDEN)
```

## Missing Guardrails

1. **No startup timeout on Player overlay** — The "Starting..." state persists indefinitely. There should be a max wait (e.g., 30s) after which the overlay auto-dismisses if playback never begins.

2. **No stale overlay cleanup** — When a new Player instance starts (`00e10e7236`), it doesn't dismiss existing Player overlays. The overlay system should enforce single-instance for Player overlays, dismissing any prior Player before showing a new one.

3. **No queue init failure handling** — When `useQueueController.initQueue()` produces an empty or garbage queue (no valid items with mediaUrl), the Player should detect this and dismiss itself rather than showing a perpetual spinner.

## Suggested Fixes

### Fix 1: Player startup timeout (immediate)
In the Player overlay loading component, add a max startup duration. If `status` remains "Starting..." for >30s, auto-dismiss the overlay and log an error.

### Fix 2: Single-instance Player overlay (immediate)
When `ScreenActionHandler.handleMediaQueue` or `handleMediaPlay` calls `showOverlay(Player, ...)`, it should first call `dismissOverlay()` to clear any existing Player overlay.

```jsx
const handleMediaQueue = useCallback((payload) => {
    dismissOverlay();  // ← clear stale overlays first
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
}, [showOverlay, dismissOverlay]);
```

### Fix 3: Queue init validation (defensive)
In `useQueueController.initQueue()`, after building `newQueue`, validate that at least one item has a resolvable `contentId` or `mediaUrl`. If the queue is empty or all items are garbage (e.g., string-spread objects with numeric keys), set an error state that triggers overlay dismissal.

## Files

| File | Role |
|------|------|
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | Creates overlay without dismissing prior instances |
| `frontend/src/modules/Player/hooks/useQueueController.js` | No validation on garbage queue items |
| `frontend/src/modules/Player/Player.jsx` | No startup timeout |

## Related

- `2026-03-22-screen-queue-autoplay-broken.md` — root cause bug that produces the stale overlay
