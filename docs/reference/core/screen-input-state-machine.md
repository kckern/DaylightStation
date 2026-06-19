# Screen Framework Input State Machine

Reference document for the numpad input → ActionBus → overlay lifecycle in the screen-framework.
Covers the repeat-key-to-navigate pattern, the escape/back stack model, and one known caveat.

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
    │       ├── event.preventDefault() + event.stopImmediatePropagation()
    │       ├── actionBus.emit(action, payload)
    │       └── return   ◄── matched keys do NOT reach Menu.jsx
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
         │ synthetic ArrowRight dispatched
         │ Menu.jsx advances selection +1
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
   escape interceptor pops MenuStack one level;
   only dismisses the overlay at the root → HOME
   currentMenuRef = null
```

## Input Model & Resolved Issues

The key-handling model below is the current, working behavior. Three earlier
defects (double-action on every key, escape-triggers-selection, escape-nukes-the-
whole-stack) are **resolved**; they are kept here as the rationale for why the
adapter stops propagation and why escape defers to an interceptor.

### Resolved: Double-action / escape-triggers-selection (was CRITICAL/HIGH)

When the adapter let a matched key keep propagating, both `NumpadAdapter` and
`Menu.jsx` acted on the same keydown — two selections per press, and an escape key
that dismissed the overlay *and* selected the highlighted item on the way out. The
adapter now calls `event.preventDefault()` + `event.stopImmediatePropagation()` on
any key it matches in the keymap, so a matched numpad key never reaches Menu.jsx.
The only keydown that reaches Menu.jsx for a navigate-mode repeat is the synthetic
`ArrowRight` the action handler dispatches to advance the selection by one.

### Resolved: Escape pops the stack instead of nuking the overlay (was MEDIUM)

Escape no longer unconditionally calls `dismissOverlay()`. It first defers to a
registered **escape interceptor** — MenuStack registers one that pops its own
navigation stack a level at a time, so `MENU → SUBMENU → PLAYER` walks back through
the stack and only collapses to HOME at the root. After the interceptor, escape
dismisses PIP if visible, then walks the YAML-configured escape chain
(`shader_active` → clear shader, `overlay_active` → dismiss, `idle` → reload). The
hardware Back button (popstate) is bridged through the same path via the menu-
navigation context, so a "dumb" fullscreen scene above the menu is dismissed by Back
before the hidden menu stack is popped.

### Known caveat: `currentMenuRef` Stale After Overlay Replacement (LOW)

**Root cause:** If a MIDI session_start opens PianoVisualizer via `showOverlay()` with `priority: 'high'`, it replaces the menu overlay. But `currentMenuRef` still holds the old menu ID.

**Effect:** After piano overlay is dismissed, pressing the same menu key thinks the menu is still open (`currentMenuRef === menuId`) and dispatches Enter instead of opening the menu.

**Fix:** Clear `currentMenuRef` whenever a non-menu overlay replaces the fullscreen slot. Could be done by listening for overlay changes, or by clearing it in `showOverlay` when the Component isn't MenuStack.

---

## Listener Priority Table

| Listener | Phase | Added When | Calls preventDefault? | Calls stopPropagation? |
|----------|-------|------------|----------------------|----------------------|
| NumpadAdapter | bubble | page load (attach) | Yes (matched keys) | Yes (`stopImmediatePropagation`, matched keys) |
| Menu.jsx handleKeyDown | bubble | menu mount | Yes (for matched keys) | No |
| Sleep wake handler | **capture** | sleep enter | Yes | Yes |
| Player keydown handler | bubble | player mount | Varies | No |

**Capture phase listeners fire first.** Sleep wake correctly intercepts before others.
Bubble phase: a key NumpadAdapter matches in the keymap is stopped there and never
reaches Menu.jsx; an unmatched key propagates normally so menu/player can handle it.

## Focus Retention Probe

`ScreenRenderer` now runs a `document.hasFocus()` probe to keep kiosk input reliable:

- Trigger points: mount, `window.blur`, `document.visibilitychange`, and a 2s interval.
- Recovery path: call `window.focus()`; if still unfocused, focus the `.screen-root` fallback node.
- Logging: sampled `screen.focus-probe` events record recovery success without log spam.

This prevents the common kiosk failure mode where the page silently drops keyboard/remote input after focus drift.

---

## Key-Handling Flow

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
    │       ├── event.stopImmediatePropagation()  ◄── STOPS propagation to Menu.jsx
    │       ├── actionBus.emit(action)
    │       └── return
    │     NO:
    │       └── event propagates normally to Menu.jsx, Player, etc.
    │
    ▼ (only if NumpadAdapter didn't match)
Menu.jsx / Player / other handlers
```

The synthetic `ArrowRight` dispatched by the menu-open handler (navigate mode, repeat
of the open menu) is the only keydown that reaches Menu.jsx for matched numpad keys —
it advances the selection by one item.

---

## Files

| File | Role |
|------|------|
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Key → ActionBus translation (stops propagation on matched keys) |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Focus retention probe (`document.hasFocus`) and fallback focus recovery |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | ActionBus → overlay/effect dispatch |
| `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx` | Overlay state management |
| `frontend/src/modules/Menu/Menu.jsx:618-663` | Menu keydown handler + window listener |
| `frontend/src/modules/Menu/MenuStack.jsx` | Menu navigation stack (push/pop) |
| `data/household/screens/office.yml` | YAML config for actions.menu.duplicate, escape chain, etc. |
