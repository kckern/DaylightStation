# Screen Framework Input Parity Audit

**Date:** 2026-03-06
**Scope:** Legacy `OfficeApp` input handling vs screen-framework (`/screen/office`) input handling
**Severity:** High — the office screen is live on `/screen/office` with multiple broken/missing behaviors

---

## Summary

The office dashboard migrated from the legacy `OfficeApp.jsx` (route `/office`) to the screen-framework `ScreenRenderer` (route `/screen/office`). The screen-framework's `NumpadAdapter` + `ScreenActionHandler` replaced the legacy `keyboardHandler.js`, but many behaviors were not ported. The result is that the physical numpad on the office desk is significantly degraded.

---

## Critical: Missing Behaviors

### 1. Escape at home = page reload (CONFIRMED BROKEN)

**Legacy** (`keyboardHandler.js:101-111`):
```js
escape: () => {
  if (currentContent) { setCurrentContent(null); return; }
  if (!currentContent && !menuOpen) { window.location.reload(); return; }
  closeMenu();
}
```
Three-tier behavior: clear content > close menu > reload page.

**Screen-framework** (`ScreenActionHandler.jsx:143-153`):
```js
const handleEscape = useCallback(() => {
  const el = shaderRef.current;
  if (el && parseFloat(el.style.opacity) > 0) { /* clear shader */ return; }
  dismissOverlay();
}, [dismissOverlay]);
```
Two-tier behavior: clear shader > dismiss overlay. **No reload fallback.** When nothing is open, pressing escape (key 4) is a silent no-op.

**Impact:** Confirmed via live CDP testing — Digit4 events reach the browser but produce no visible effect when the dashboard is at home state.

### 2. Playback controls don't dispatch to active media

**Legacy** (`keyboardHandler.js:88-99`):
```js
playback: (params, action) => {
  if (hasActivePlayer()) {
    // Player handles its own keyboard events
  } else if (action?.secondary) {
    executeSecondaryAction(action.secondary);
  }
}
```
Checks for an active player, falls back to secondary action (e.g., key `1` plays "Morning Program" when nothing is playing).

**Screen-framework** (`ScreenActionHandler.jsx:72-85`):
```js
const handleMediaPlayback = useCallback((payload) => {
  const keyMapping = { play: 'Enter', pause: 'Enter', ... };
  const key = keyMapping[payload.command?.toLowerCase()];
  if (key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
  }
}, []);
```
Always dispatches a synthetic keydown regardless of whether a player is active. No secondary action fallback.

**Impact:**
- Pressing play/pause/fwd/rew when nothing is playing dispatches orphan keyboard events
- Key `1` (play, secondary: `queue: Morning Program`) never triggers the Morning Program fallback

### 3. Menu context awareness missing

**Legacy** (`keyboardHandler.js:229-245`):
```js
// If menu is already open to the same category, skip
if (menu && menuOpen && action?.function === 'menu' && action?.params === menu) return;
// If content is playing and menu is pressed, clear content first
if (currentContent && action?.function === 'menu') {
  resetQueue(); setCurrentContent(null); openMenu(action.params); return;
}
```

**Screen-framework** (`ScreenActionHandler.jsx:52-54`):
```js
const handleMenuOpen = useCallback((payload) => {
  showOverlay(MenuStack, { rootMenu: payload.menuId });
}, [showOverlay]);
```
No duplicate-menu guard. No queue reset when switching from content to menu.

### 4. WebSocket payload handling missing entirely

**Legacy** (`websocketHandler.js`): Full WebSocket command handler supporting:
- `data.menu` — open menu by ID
- `data.action === "reset"` — clear all state
- `data.playback` — remote playback control (play/pause/next/prev/stop via WS)
- Content reference extraction with legacy key support (`hymn`, `scripture`, `talk`, `primary`, `poem`)
- Modifier extraction (`shuffle`, `shader`, `volume`, `resume`, etc.)
- Topic/source guardrails (blocks sensor telemetry, fitness, MQTT)

**Screen-framework**: No equivalent. The `useScreenSubscriptions` hook only handles overlay show/dismiss based on YAML `subscriptions:` config. There is no general-purpose WS command handler for remote playback, menu, or content loading.

**Impact:** Phone-based remote control (sending play/pause/menu commands via WebSocket) does not work on `/screen/office`.

---

## Critical: Missing MIDI Behavior

### 5. MIDI auto-show piano

**Legacy** (`OfficeApp.jsx:202-225`):
```js
const handleMidiEvent = useCallback((data) => {
  if (data.topic !== 'midi') return;
  if (isPlayerActive.current) return; // Don't interrupt media
  if (data.type === 'session' && data.data?.event === 'session_start') {
    setShowPiano(true);
  } else if (data.type === 'note' && data.data?.event === 'note_on' && !showPiano) {
    setShowPiano(true); // Also show on first note if we missed session_start
  }
}, [showPiano]);
```
- Guards against interrupting active media playback
- Handles both explicit session_start and implicit first-note detection

**Screen-framework** (`office.yml` subscriptions):
```yaml
subscriptions:
  midi:
    on:
      event: session_start
    response:
      overlay: piano
      mode: fullscreen
      priority: high
    dismiss:
      event: session_end
      inactivity: 30
```
Handled by `useScreenSubscriptions.js`. This covers the basic show/dismiss flow, but:
- **No player-active guard** — MIDI session_start will show piano overlay even if media is playing (the legacy code explicitly skips when `isPlayerActive`)
- **No first-note fallback** — only `session_start` triggers the overlay; missed session_start means piano never appears
- **Priority `high` overrides existing overlays** — in `ScreenOverlayProvider`, `priority: 'high'` replaces any current fullscreen overlay, which could interrupt an active player

### 6. Piano session end callback

**Legacy** (`OfficeApp.jsx:232-235`):
```js
const handlePianoSessionEnd = useCallback((sessionInfo) => {
  logger.info('piano.session_end', { noteCount: sessionInfo?.noteCount });
  setShowPiano(false);
}, []);
```
Explicit handler passed as `onSessionEnd` prop to `PianoVisualizer`.

**Screen-framework**: The subscription dismiss config handles `session_end`, but `PianoVisualizer` is shown via `showOverlay(Component, { ...data })` — the WS message data is spread as props. `PianoVisualizer` may not receive `onSessionEnd` or `onClose` callbacks it expects.

---

## Moderate: Behavioral Differences

### 7. Volume control — identical

Both call the same API endpoints (`api/v1/home/vol/+`, `-`, `togglemute`). No disparity.

### 8. Shader — different implementation, same effect

Legacy uses React state (`setShaderOpacity`) with bidirectional cycling. Screen-framework uses a DOM element with forward-only cycling. Functionally similar but the legacy bidirectional bounce (up then back down) is lost.

### 9. Sleep — wake behavior differs

**Legacy**: Installs a one-time keydown listener (capture phase) that intercepts the next keypress, prevents it from reaching other handlers, and restores opacity.

**Screen-framework**: Shader goes to opacity 1 with `pointerEvents: auto`. Installs a click listener on the shader for wake. No keypress wake — the user must click the opaque black overlay (impossible without a mouse/touch).

**Impact:** Sleep mode on the office numpad is a black hole — once activated, there is no way to wake via the numpad.

### 10. Rate cycling — identical logic

Both cycle through `[1.0, 1.5, 2.0]` on the active media element.

### 11. Playback broadcast

**Legacy**: Uses `usePlaybackBroadcast(playerRef, broadcastItem)` to broadcast what's currently playing to other devices.

**Screen-framework**: No equivalent. Other devices cannot see what the office screen is playing.

---

## Full Parity Matrix

| Feature | Legacy OfficeApp | Screen Framework | Status |
|---------|-----------------|------------------|--------|
| Escape: clear content | `setCurrentContent(null)` | `dismissOverlay()` | Partial |
| Escape: close menu | `closeMenu()` | `dismissOverlay()` | Partial |
| Escape: reload at home | `window.location.reload()` | (missing) | **BROKEN** |
| Escape: clear shader first | (missing) | Clears shader before dismiss | Added |
| Menu open | `openMenu(menuId)` | `showOverlay(MenuStack)` | OK |
| Menu duplicate guard | Skips if same menu already open | (missing) | **MISSING** |
| Menu replaces content | Clears queue + content first | (missing) | **MISSING** |
| Play content | `handleMenuSelection({play})` | `showOverlay(Player)` | OK |
| Queue content | `handleMenuSelection({queue})` | `showOverlay(Player)` | OK |
| Playback controls | Context-aware dispatch | Blind keydown dispatch | **DEGRADED** |
| Secondary actions | Fallback to `queue: Morning Program` etc. | (missing) | **MISSING** |
| Volume +/-/mute | API call | API call | OK |
| Shader cycling | Bidirectional bounce | Forward-only | Minor |
| Sleep toggle | Keypress wake (capture) | Click wake only | **BROKEN** |
| Rate cycling | 1x/1.5x/2x | 1x/1.5x/2x | OK |
| MIDI auto-show | Player-active guard + first-note fallback | session_start only, no guard | **DEGRADED** |
| MIDI session end | Explicit callback prop | WS dismiss event | Partial |
| WebSocket commands | Full remote control | (missing) | **MISSING** |
| Playback broadcast | `usePlaybackBroadcast` | (missing) | **MISSING** |

---

## Affected Files

| File | Role |
|------|------|
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | Screen-framework action handler (needs parity fixes) |
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Numpad key-to-action translation |
| `frontend/src/screen-framework/input/actionMap.js` | Action name mapping |
| `frontend/src/screen-framework/subscriptions/useScreenSubscriptions.js` | WS subscription handler |
| `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx` | Overlay lifecycle |
| `frontend/src/lib/OfficeApp/keyboardHandler.js` | Legacy keyboard handler (reference) |
| `frontend/src/lib/OfficeApp/websocketHandler.js` | Legacy WS handler (reference) |
| `frontend/src/Apps/OfficeApp.jsx` | Legacy app with MIDI, broadcast, full wiring (reference) |

---

## Recommendations

1. **Immediate:** Add `window.location.reload()` fallback to `handleEscape` when no shader, no overlay
2. **Immediate:** Fix sleep wake to listen for keydown, not just click
3. **High:** Port secondary action support to `NumpadAdapter` / `ScreenActionHandler`
4. **High:** Add WS command handler (menu, reset, playback, content loading) to screen-framework
5. **Medium:** Add player-active guard to MIDI subscription handling
6. **Medium:** Add playback broadcast to screen-framework
7. **Low:** Add menu duplicate guard and queue-reset-on-menu-switch
