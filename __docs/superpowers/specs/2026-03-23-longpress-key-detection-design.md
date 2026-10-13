# Long-Press Key Detection for Media Player Navigation

**Date:** 2026-03-23
**Status:** Draft

---

## Problem

The keyboard manager (`frontend/src/lib/keyboard/keyboardManager.js`) uses double-click detection on ArrowLeft/ArrowRight to distinguish "seek" (single tap) from "skip track" (double-tap within 350ms). This is unintuitive — users don't expect double-tap on a remote/numpad. Long-press (holding the key) is a more natural gesture for "bigger action."

Additionally, the `play` and `next` actions behave differently when they should be unified. `next` only skips. Both should mean "go forward" — play if idle, skip if already playing. (`play` already maps to `ensurePlayingElseAdvance` which does this; `next` does not.)

## Design

### 1. General-Purpose Long-Press Detection

Replace the double-click detection in `useAdvancedKeyboardHandler` with a long-press state machine.

**Key mapping format changes:**

```js
// Before: all strings
const DEFAULT_KEY_MAPPINGS = {
  'ArrowRight': 'seekForward',
  'ArrowLeft': 'seekBackward',
  'Tab': 'nextTrack',
};

// After: strings (immediate) or objects (long-press capable)
const DEFAULT_KEY_MAPPINGS = {
  'ArrowRight':      { tap: 'seekForward', longPress: 'nextTrack' },
  'ArrowLeft':       { tap: 'seekBackward', longPress: 'previousTrack' },
  'ArrowUp':         { tap: 'cycleShadersUp', longPress: 'cyclePlaybackRateUp' },
  'ArrowDown':       { tap: 'cycleShadersDown', longPress: 'cyclePlaybackRateDown' },
  'Enter':           'togglePlayPause',
  ' ':               'togglePlayPause',
  'Space':           'togglePlayPause',
  'MediaPlayPause':  'togglePlayPause',
  'Tab':             'nextTrack',
  'Backspace':       'previousTrack',
  'Escape':          'escape',
};
```

- **String value** = fire immediately on keydown, no long-press behavior (unchanged from today)
- **Object `{ tap, longPress }`** = use long-press state machine

Note: `Enter` is a string (immediate), not `{ tap, longPress: null }`. There is no reason to add 400ms latency to play/pause when there is no long-press action. If a long-press action is added later, change it to object format then.

### 2. State Machine

One active key tracked at a time. Managed via refs in `useAdvancedKeyboardHandler`.

**State:** `{ activeKey, timer, longPressFired }`

**Transitions:**

The key insight: the OS/browser has a built-in delay (~500ms, varies by platform) before `repeat` events start. A `repeat=true` keydown IS the long-press signal — it means the user is physically holding the key. The timer is a fallback for hardware that doesn't send repeat events (some remotes).

```
IDLE
  keydown(key, repeat=false, mapping is object with tap/longPress)
    → set activeKey = key
    → start timer (longPressDelay ms, default 400ms)
    → set longPressFired = false
    → go to WAITING

  keydown(key, repeat=false, mapping is string)
    → execute action immediately (unchanged from today)

WAITING
  timer fires (no repeat arrived — user tapped and released, or hardware doesn't send repeats)
    → execute TAP action (e.g., seekForward)
    → clear activeKey
    → go to IDLE

  keydown(same key, repeat=true) — user is holding the key
    → cancel timer
    → execute LONG-PRESS action (e.g., nextTrack) — fires ONCE
    → set longPressFired = true
    → go to HELD

  keydown(different key, repeat=false)
    → cancel timer
    → execute TAP action for activeKey (it was a quick tap interrupted by another key)
    → process new key normally (may enter WAITING or fire immediately)

  keyup(activeKey) — user released before timer or repeat
    → cancel timer
    → execute TAP action (quick release)
    → clear activeKey
    → go to IDLE

HELD
  keydown(same key, repeat=true)
    → ignore (long-press already fired once, no repeated skipping)

  keyup(activeKey)
    → clear activeKey
    → go to IDLE

  keydown(different key, repeat=false)
    → clear activeKey (no action — long-press already consumed)
    → process new key normally
```

**Summary:** Tap action fires on timer expiry OR keyup (whichever first). Long-press action fires on first `repeat=true` event. This creates ~400ms delay on tap, which is the cost of distinguishing tap from hold.

### 3. Configuration

```js
// New config param replacing doubleClickDelay
longPressDelay = 400,  // ms before tap action fires (default)
```

Remove: `enableDoubleClick`, `doubleClickDelay` config params and their references in the `useEffect` dependency array. Add `longPressDelay` to the dependency array.

### 4. Unified Play/Next Semantics

The `play` and `next` actions should both mean "go forward":

- If nothing is playing (idle/paused) → play (resume or trigger secondary queue)
- If already playing → skip to next track

`play` already maps to `ensurePlayingElseAdvance` (line 124). The only change: wire `next` to it too:

```js
return {
  // ...
  play: ensurePlayingElseAdvance,   // unchanged — already correct
  next: ensurePlayingElseAdvance,   // CHANGED — was: () => onNext?.()
  nextTrack: () => onNext?.(),      // unchanged — explicit track skip (long-press, Tab)
  // ...
};
```

This means:
- **Button 1** (`play` command) → `ensurePlayingElseAdvance` → plays if idle, skips if playing. Secondary `queue: Morning Program` handles cold start with no queue.
- **`nextTrack`** (from long-press ArrowRight or Tab) → always skips, even if paused. This is intentional — long-pressing forward while paused should advance.

**No numpad config change needed.** Button 1 stays `function: playback, params: play`. The behavior change is in how `next` is interpreted.

### 5. New Action Handlers

Add `cyclePlaybackRateUp` and `cyclePlaybackRateDown` to `createDefaultActions`:

```js
cyclePlaybackRateUp: () => onCyclePlaybackRate?.(1),
cyclePlaybackRateDown: () => onCyclePlaybackRate?.(-1),
```

This requires a new callback prop `onCyclePlaybackRate` threaded through from Player components. The wiring path:

1. `keyboardManager.js` `createDefaultActions` — add actions, accept `onCyclePlaybackRate` in config
2. `useAdvancedKeyboardHandler` — accept and pass through `onCyclePlaybackRate`
3. `usePlayerKeyboard` — accept and pass through `onCyclePlaybackRate`
4. `useMediaKeyboardHandler.js` — accept `onCyclePlaybackRate` in config, pass to `usePlayerKeyboard`
5. Calling components (`ContentScroller.jsx`, `FitnessPlayer.jsx`) — pass a callback that cycles the playback rate

Note: `ContentScroller.jsx` already manages `playbackRate` state. The callback should cycle through rates (e.g., 1x → 1.5x → 2x → 1x). If a component doesn't support rate cycling, it simply doesn't pass the callback — the `?.()` optional chain in the action handler makes this safe.

### 6. Complete Key Mapping Table

| Key | Tap Action | Long-Press Action | Timing |
|-----|-----------|-------------------|--------|
| ArrowRight | seekForward | nextTrack | delayed (400ms) |
| ArrowLeft | seekBackward | previousTrack | delayed (400ms) |
| ArrowUp | cycleShadersUp | cyclePlaybackRateUp | delayed (400ms) |
| ArrowDown | cycleShadersDown | cyclePlaybackRateDown | delayed (400ms) |
| Enter | togglePlayPause | — | immediate |
| Space | togglePlayPause | — | immediate |
| MediaPlayPause | togglePlayPause | — | immediate |
| Tab | nextTrack | — | immediate |
| Backspace | previousTrack | — | immediate |
| Escape | escape | — | immediate |

### 7. Focus Loss Handling

Attach a `window blur` event listener in `useAdvancedKeyboardHandler`. On blur:
- Cancel any active timer
- Clear `activeKey` without firing the tap action (user switched away, don't execute a phantom action)
- Reset `longPressFired`

This prevents stale `activeKey` state from causing phantom actions on refocus.

### 8. Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/keyboard/keyboardManager.js` | Replace double-click with long-press state machine. Update `DEFAULT_KEY_MAPPINGS` to object format for arrow keys. Add `cyclePlaybackRateUp`/`Down` actions. Wire `next` to `ensurePlayingElseAdvance`. New config: `longPressDelay`. Remove: `enableDoubleClick`, `doubleClickDelay`. Add `keyup` and `blur` listeners. Update `useEffect` dependency array. |
| `frontend/src/lib/Player/useMediaKeyboardHandler.js` | Thread `onCyclePlaybackRate` callback through to `usePlayerKeyboard`. Existing `ArrowUp`/`ArrowDown` paused overrides in `componentOverrides` (lines 196-197) continue to work — they short-circuit before the long-press state machine, which is correct (no shader/rate cycling while paused). |
| `frontend/src/modules/Player/renderers/ContentScroller.jsx` | Pass `onCyclePlaybackRate` callback that cycles through playback rates. |

### 9. What Does NOT Change

- `NumpadAdapter.js` — no changes, keymap fetching is unchanged
- `ScreenActionHandler.jsx` — `fwd`→`ArrowRight`, `rew`→`ArrowLeft` synthetic dispatch unchanged
- Keyboard config YAML — button 1 stays `play`, button 5 stays `prev`
- `mediaTransportAdapter.js` — seek/play/pause transport layer unchanged
- `useCommonMediaController.js` — media event handling unchanged

### 10. Edge Cases

- **Key held then different key pressed:** Cancel timer for first key, execute its tap action, process new key normally.
- **Tab/Backspace/Enter/Space (immediate keys):** No long-press delay. Fire on keydown as today. `event.repeat` still ignored for these (existing line 208 behavior).
- **Hardware without repeat events (some remotes):** Timer fires after 400ms, tap action executes. Long-press never fires. This is acceptable — the remote's long-press behavior is OS-dependent and can't be reliably detected without repeat events. The user gets seek (tap) behavior, which is the safe default.
- **Focus loss during hold:** `blur` listener cancels timer and clears state without firing any action. No phantom actions on refocus.
- **Rapid key switching (ArrowRight then ArrowLeft quickly):** First key's tap fires immediately (interrupted), second key enters WAITING state normally.
- **`componentOverrides` interaction:** Component overrides (e.g., paused ArrowUp/Down no-ops) execute before the long-press state machine check, same as today. This means overridden keys bypass long-press entirely — correct behavior.
