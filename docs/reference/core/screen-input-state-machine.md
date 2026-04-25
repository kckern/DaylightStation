# Screen Framework Input State Machine

Reference document for the numpad input → ActionBus → overlay lifecycle in the screen-framework.
Covers the repeat-key-to-navigate pattern and known issues.

---

## Component Chain

```
Physical Key Press
    │
    ▼
window 'keydown' event
    │
    ├──► NumpadAdapter.handler()        (listener 1, added on attach)
    │       │
    │       ├── Match key in keymap
    │       ├── translateAction()
    │       ├── actionBus.emit(action, payload)
    │       └── return   ◄── NOTE: does NOT preventDefault/stopPropagation
    │
    ├──► Menu.jsx handleKeyDown()       (listener 2, added when menu is mounted)
    │       │
    │       ├── Arrow keys → navigate selection index
    │       ├── Escape → handleClose()
    │       └── Any other key → onSelect(items[selectedIndex])
    │
    └──► Sleep wake handler             (listener 3, capture phase, added during sleep)
            └── Intercept + wake
```

## State Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
              ┌──────────┐                                        │
              │   HOME   │  (no overlay, no shader)               │
              │          │                                        │
              └────┬─────┘                                        │
                   │                                              │
     menu key (k)  │  escape (4)                                  │
     ─────────────►│◄────────── reload (actions.escape idle)──────┘
                   │
                   ▼
         ┌─────────────────┐
         │   MENU_OPEN     │  (fullscreen overlay = MenuStack)
         │   menuId = X    │  (currentMenuRef = X)
         │                 │  (Menu.jsx keydown listener active)
         └───┬──────┬──────┘
             │      │
   same key  │      │  escape (4)
   (k again) │      │
             ▼      ▼
    ┌────────────┐  dismissOverlay() → HOME
    │ NAVIGATE   │  currentMenuRef = null
    │ (transient)│
    └────┬───────┘
         │
         │ synthetic Enter dispatched
         │ Menu.jsx onSelect(items[selectedIndex])
         ▼
    ┌──────────────────┐
    │ SUBMENU / PLAYER │  (MenuStack internal navigation)
    │ (still same      │  (overlay = MenuStack, stack depth > 0)
    │  fullscreen      │
    │  overlay)        │
    └───┬──────────────┘
        │
        │ escape (4)
        ▼
   dismissOverlay() → HOME  ◄── BUG: should pop MenuStack, not nuke overlay
   currentMenuRef = null
```

## Bugs Identified

### Bug 1: Double-Action on Every Key Press (CRITICAL)

**Root cause:** `NumpadAdapter` does not call `event.preventDefault()` or `event.stopPropagation()` after matching a key.

**Effect:** When Menu.jsx is mounted, both listeners receive the same keydown:

```
User presses 'k' (menu key for education):

  1. NumpadAdapter matches 'k' → emits menu:open
     → handleMenuOpen: duplicate='navigate', same menu
     → dispatches synthetic Enter
     → Menu.jsx receives Enter → onSelect()        ← ACTION 1

  2. Original 'k' keydown propagates (not stopped)
     → Menu.jsx receives 'k' → not arrow/escape/modifier
     → onSelect()                                   ← ACTION 2 (duplicate!)
```

This causes **two selections per key press** when the menu is open.

**Fix:** NumpadAdapter must call `event.preventDefault()` and `event.stopPropagation()` after matching a key in the keymap.

```js
// NumpadAdapter.handler — after emitting:
event.preventDefault();
event.stopPropagation();
```

### Bug 2: Escape Key Triggers Menu Selection (HIGH)

**Root cause:** Same as Bug 1 — escape key (Digit4, key='4') propagates to Menu.jsx.

**Effect:**

```
User presses '4' (escape) while menu is open:

  1. NumpadAdapter matches '4' → emits escape
     → handleEscape: overlay_active → dismissOverlay()

  2. Original '4' keydown propagates
     → Menu.jsx receives '4' → not arrow/escape/modifier
     → onSelect(items[selectedIndex])   ← UNINTENDED SELECTION
```

The menu item gets selected at the same instant the overlay is dismissed. May cause content to play unexpectedly.

**Fix:** Same as Bug 1 — stop propagation in NumpadAdapter.

### Bug 3: Escape Nukes Entire Overlay Instead of Popping Stack (MEDIUM)

**Root cause:** `handleEscape` calls `dismissOverlay()` which removes the fullscreen overlay entirely. MenuStack has an internal navigation stack (push/pop), but the escape action bypasses it.

**Effect:** If user is in `MENU → SUBMENU → PLAYER`, pressing escape goes directly to HOME instead of popping back through the stack.

**Legacy behavior:** OfficeApp had separate `currentContent` and `menuOpen` state. Escape cleared content first, then closed menu, then reloaded. The screen-framework has a single overlay slot with no awareness of MenuStack's internal depth.

**Fix options:**
1. Have escape dispatch a synthetic Escape keydown first (let Menu.jsx/Player handle it). Only if overlay is still showing after a tick, then dismiss.
2. Pass an `onEscape` callback to the overlay that calls MenuStack's `pop()` when depth > 0, or `dismissOverlay()` at root.
3. Track overlay depth in ScreenActionHandler.

### Bug 4: `currentMenuRef` Stale After Overlay Replacement (LOW)

**Root cause:** If a MIDI session_start opens PianoVisualizer via `showOverlay()` with `priority: 'high'`, it replaces the menu overlay. But `currentMenuRef` still holds the old menu ID.

**Effect:** After piano overlay is dismissed, pressing the same menu key thinks the menu is still open (`currentMenuRef === menuId`) and dispatches Enter instead of opening the menu.

**Fix:** Clear `currentMenuRef` whenever a non-menu overlay replaces the fullscreen slot. Could be done by listening for overlay changes, or by clearing it in `showOverlay` when the Component isn't MenuStack.

---

## Listener Priority Table

| Listener | Phase | Added When | Calls preventDefault? | Calls stopPropagation? |
|----------|-------|------------|----------------------|----------------------|
| NumpadAdapter | bubble | page load (attach) | **NO** ← bug | **NO** ← bug |
| Menu.jsx handleKeyDown | bubble | menu mount | Yes (for matched keys) | No |
| Sleep wake handler | **capture** | sleep enter | Yes | Yes |
| Player keydown handler | bubble | player mount | Varies | No |

**Capture phase listeners fire first.** Sleep wake correctly intercepts before others.
Bubble phase: NumpadAdapter and Menu.jsx both fire — order depends on registration order, but both execute.

## Focus Retention Probe

`ScreenRenderer` now runs a `document.hasFocus()` probe to keep kiosk input reliable:

- Trigger points: mount, `window.blur`, `document.visibilitychange`, and a 2s interval.
- Recovery path: call `window.focus()`; if still unfocused, focus the `.screen-root` fallback node.
- Logging: sampled `screen.focus-probe` events record recovery success without log spam.

This prevents the common kiosk failure mode where the page silently drops keyboard/remote input after focus drift.

---

## Correct Flow After Fixes

```
Physical Key Press
    │
    ▼
window 'keydown' event
    │
    ▼
NumpadAdapter.handler() [bubble phase]
    │
    ├── Match found in keymap?
    │     YES:
    │       ├── event.preventDefault()
    │       ├── event.stopPropagation()    ◄── STOPS propagation to Menu.jsx
    │       ├── actionBus.emit(action)
    │       └── return
    │     NO:
    │       └── event propagates normally to Menu.jsx, Player, etc.
    │
    ▼ (only if NumpadAdapter didn't match)
Menu.jsx / Player / other handlers
```

After the fix, the synthetic Enter dispatched by `handleMenuOpen` (navigate mode) is the ONLY keydown that reaches Menu.jsx for matched numpad keys.

---

## Files

| File | Role |
|------|------|
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Key → ActionBus translation (needs propagation fix) |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Focus retention probe (`document.hasFocus`) and fallback focus recovery |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | ActionBus → overlay/effect dispatch |
| `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx` | Overlay state management |
| `frontend/src/modules/Menu/Menu.jsx:618-663` | Menu keydown handler + window listener |
| `frontend/src/modules/Menu/MenuStack.jsx` | Menu navigation stack (push/pop) |
| `data/household/screens/office.yml` | YAML config for actions.menu.duplicate, escape chain, etc. |
