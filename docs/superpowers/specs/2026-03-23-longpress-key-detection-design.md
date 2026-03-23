# Long-Press Key Detection for Media Player Navigation

**Date:** 2026-03-23
**Status:** Draft

---

## Problem

The keyboard manager (`frontend/src/lib/keyboard/keyboardManager.js`) uses double-click detection on ArrowLeft/ArrowRight to distinguish "seek" (single tap) from "skip track" (double-tap within 350ms). This is unintuitive — users don't expect double-tap on a remote/numpad. Long-press (holding the key) is a more natural gesture for "bigger action."

Additionally, the `play` and `next` actions have inconsistent behavior. `play` only resumes; `next` only skips. Both should mean "go forward" — play if idle, skip if already playing.

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
  'ArrowRight': { tap: 'seekForward', longPress: 'nextTrack' },
  'ArrowLeft':  { tap: 'seekBackward', longPress: 'previousTrack' },
  'ArrowUp':    { tap: 'cycleShadersUp', longPress: 'cyclePlaybackRateUp' },
  'ArrowDown':  { tap: 'cycleShadersDown', longPress: 'cyclePlaybackRateDown' },
  'Enter':      { tap: 'togglePlayPause', longPress: null },
  ' ':          'togglePlayPause',
  'Space':      'togglePlayPause',
  'Tab':        'nextTrack',
  'Backspace':  'previousTrack',
  'Escape':     'escape',
};
```

- **String value** = fire immediately on keydown, no long-press behavior (unchanged from today)
- **Object `{ tap, longPress }`** = use long-press state machine. `longPress: null` means the infrastructure is wired but no action fires yet.

### 2. State Machine

One active key tracked at a time. Managed via refs in `useAdvancedKeyboardHandler`.

**State:** `{ activeKey, timer, longPressFired }`

**Transitions:**

```
IDLE
  keydown(key, repeat=false, mapping has longPress)
    → set activeKey = key
    → start timer (longPressDelay ms)
    → set longPressFired = false
    → go to WAITING

WAITING
  timer fires
    → execute tap action
    → go to IDLE

  keydown(same key, repeat=true)
    → cancel timer
    → if longPress action is not null: execute longPress action
    → set longPressFired = true
    → go to HELD

  keydown(different key)
    → cancel timer
    → execute tap action for activeKey (it was a quick tap)
    → process new key normally
    → go to IDLE or WAITING depending on new key

  keyup(activeKey)
    → cancel timer
    → execute tap action (quick release before timer)
    → go to IDLE

HELD
  keydown(same key, repeat=true)
    → ignore (already fired long-press once)

  keyup(activeKey)
    → go to IDLE
```

**Key detail:** The tap action fires on timer expiry OR on keyup (whichever comes first), not on the initial keydown. This creates a ~400ms delay before seek, which is the cost of distinguishing tap from hold.

### 3. Configuration

```js
// New config param replacing doubleClickDelay
longPressDelay = 400,  // ms before tap action fires (default)
```

The `enableDoubleClick` and `doubleClickDelay` config params are removed.

### 4. Unified Play/Next Semantics

The `play` and `next` actions should both mean "go forward":

- If nothing is playing (idle/paused) → play (resume or trigger secondary queue)
- If already playing → skip to next track

The existing `ensurePlayingElseAdvance` function (line 87-94) already implements this. Wire both `play` and `next` to it:

```js
return {
  // ...
  play: ensurePlayingElseAdvance,
  next: ensurePlayingElseAdvance,    // was: () => onNext?.()
  nextTrack: () => onNext?.(),       // unchanged — explicit track skip
  // ...
};
```

This means:
- **Button 1** (`play` command) → `ensurePlayingElseAdvance` → plays if idle, skips if playing. Secondary `queue: Morning Program` handles cold start with no queue.
- **`nextTrack`** (from long-press ArrowRight or Tab) → always skips, even if paused. This is intentional — long-pressing forward while paused should advance.

**No numpad config change needed.** Button 1 stays `function: playback, params: play`. The behavior change is in how `play` is interpreted.

### 5. New Action Handlers

Add `cyclePlaybackRateUp` and `cyclePlaybackRateDown` to `createDefaultActions`:

```js
cyclePlaybackRateUp: () => onCyclePlaybackRate?.(1),
cyclePlaybackRateDown: () => onCyclePlaybackRate?.(-1),
```

This requires a new callback prop `onCyclePlaybackRate` threaded through from the Player component, similar to the existing `onCycleShaders`.

### 6. Complete Key Mapping Table

| Key | Tap Action | Long-Press Action | Timing |
|-----|-----------|-------------------|--------|
| ArrowRight | seekForward | nextTrack | delayed (400ms) |
| ArrowLeft | seekBackward | previousTrack | delayed (400ms) |
| ArrowUp | cycleShadersUp | cyclePlaybackRateUp | delayed (400ms) |
| ArrowDown | cycleShadersDown | cyclePlaybackRateDown | delayed (400ms) |
| Enter | togglePlayPause | *(null — reserved)* | delayed (400ms) |
| Space | togglePlayPause | — | immediate |
| Tab | nextTrack | — | immediate |
| Backspace | previousTrack | — | immediate |
| Escape | escape | — | immediate |

### 7. Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/keyboard/keyboardManager.js` | Replace double-click with long-press state machine. Update `DEFAULT_KEY_MAPPINGS` format. Add `cyclePlaybackRateUp`/`Down` actions. Unify `play`/`next` to `ensurePlayingElseAdvance`. New config: `longPressDelay`. Remove: `enableDoubleClick`, `doubleClickDelay`. |
| `frontend/src/lib/Player/useMediaKeyboardHandler.js` | Thread `onCyclePlaybackRate` callback. |
| `frontend/src/modules/Player/renderers/ContentScroller.jsx` | Pass `onCyclePlaybackRate` to keyboard handler (if playback rate cycling is wired here). |

### 8. What Does NOT Change

- `NumpadAdapter.js` — no changes, keymap fetching is unchanged
- `ScreenActionHandler.jsx` — `fwd`→`ArrowRight`, `rew`→`ArrowLeft` synthetic dispatch unchanged
- Keyboard config YAML — button 1 stays `play`, button 5 stays `prev`
- `mediaTransportAdapter.js` — seek/play/pause transport layer unchanged
- `useCommonMediaController.js` — media event handling unchanged

### 9. Edge Cases

- **Key held then different key pressed:** Cancel timer for first key, execute its tap action, process new key normally.
- **Tab/Backspace (immediate keys):** No long-press delay. Fire on keydown as today.
- **`event.repeat` on immediate keys:** Still ignored (line 208 `if (event.repeat) return` applies to keys without long-press config).
- **Enter with `longPress: null`:** Timer still runs. Tap fires on timer expiry or keyup. Long-press does nothing (no action). This means Enter has the same ~400ms delay but no hold behavior — acceptable since play/pause isn't time-sensitive.
- **Focus loss during hold:** Timer fires, tap action executes. On refocus, keyup may not arrive — `activeKey` stays set until next keydown resets it.
