# Screen Framework Phase 4: Overlays, Subscriptions & Input Wiring

**Goal:** Wire numpad input and WebSocket events to overlays, enabling Menu/Player/Piano launch from the `/screen/office` route.

**Architecture:** ScreenActionHandler bridges ActionBus → overlay system. ScreenRenderer processes YAML subscription config into WS listeners that trigger overlays. ScreenOverlayProvider upgraded to three render slots (fullscreen, pip, toast).

**Tech Stack:** React context, useWebSocketSubscription, ActionBus, existing MenuStack/Player/PianoVisualizer

---

## 1. Action Handler — Numpad → Overlays

A `ScreenActionHandler` component mounts inside ScreenRenderer, between the overlay provider and panel tree. It subscribes to ActionBus events and bridges them to the overlay system:

- `menu:open` → `showOverlay(MenuStack, { rootMenu: menuId })`. MenuStack handles all navigation internally — sub-menus push/pop on its stack, Player spawns when content is selected. The `clear` callback calls `dismissOverlay()` to return to the dashboard.
- `media:play` / `media:queue` → `showOverlay(Player, { play/queue: contentId })`. Direct content launch without menu.
- `escape` → `dismissOverlay()`. If MenuStack is active, it handles escape internally first (pop stack). Only when the stack is empty does escape dismiss the overlay.
- `media:playback` → Player subscribes to this via `useScreenAction('media:playback')` when mounted. No intermediary needed.
- `display:volume`, `display:shader`, `display:sleep` → handled directly in ScreenActionHandler (volume adjusts CSS/system, shader adjusts an opacity overlay, sleep blanks the screen).

## 2. Overlay Provider Upgrade — Three Render Slots

The current ScreenOverlayProvider supports one overlay. Upgrade to three independent slots:

- **Fullscreen** — replaces the dashboard visually (Piano, MenuStack/Player). Only one at a time. Dashboard stays mounted underneath (preserves widget state). Z-index 1000.
- **PIP** — floats in a corner over the dashboard (doorbell camera). Doesn't interrupt fullscreen. Positioned via config (`top-right`, `bottom-left`, etc.). Fixed size (e.g., 320×240). Z-index 1001.
- **Toast stack** — small notifications in a corner, auto-dismiss after timeout, stackable. Z-index 1002.

Updated API:

```js
showOverlay(Component, props, { mode: 'fullscreen' })  // default
showOverlay(Component, props, { mode: 'pip', position: 'top-right' })
showOverlay(Component, props, { mode: 'toast', timeout: 5000 })
dismissOverlay(mode)  // dismiss specific slot, defaults to 'fullscreen'
```

Priority rule: a fullscreen overlay with `priority: high` (like Piano from MIDI) can interrupt an existing fullscreen overlay (like Player). Normal priority fullscreen is rejected if one is already active.

The three slots render as sibling divs inside the overlay layer — they don't interfere with each other.

## 3. WebSocket Subscriptions — Config-Driven Overlays

ScreenRenderer reads the `subscriptions` section from YAML config. For each entry, it sets up a `useWebSocketSubscription` with the topic name. When an event arrives matching the `on` filter, it calls `showOverlay` with the resolved component and mode.

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
      inactivity: 30s

  doorbell:
    response:
      overlay: doorbell-camera
      mode: pip
      position: top-right
    dismiss:
      timeout: 30s
```

Processing logic:
1. For each subscription key (topic name), subscribe via `useWebSocketSubscription(topic, handler)`
2. When a message arrives, check `on.event` filter (if present). No filter = trigger on any message for that topic.
3. On match, resolve `response.overlay` from the widget registry, call `showOverlay(Component, { wsData }, { mode, position, priority })`
4. For dismiss: subscribe to the dismiss event on the same topic. `inactivity` starts a timer that resets on each new message. `timeout` is a fixed timer from when the overlay opened.

Overlay components receive the WS message data as props so they can react to the triggering event.

## 4. Widget Registry & Component Wiring

Register overlay components alongside dashboard widgets:

```
piano           → PianoVisualizer
doorbell-camera → DoorbellPIP (new stub)
toast           → ToastNotification (new)
```

MenuStack integration:
```js
showOverlay(MenuStack, { rootMenu: menuId, playerRef }, { mode: 'fullscreen' });
```

MenuStack gets an `onExit` prop (mapped to `dismiss`) to call when the user fully exits (empty stack + escape).

Direct Player launch:
```js
showOverlay(Player, { play: { contentId }, clear: () => dismissOverlay() }, { mode: 'fullscreen' });
```

PianoVisualizer:
```js
showOverlay(PianoVisualizer, { onClose: () => dismissOverlay(), onSessionEnd: () => dismissOverlay() }, { mode: 'fullscreen', priority: 'high' });
```

No changes needed to MenuStack, Player, or PianoVisualizer — they already accept the required props.

## 5. Files

### Create

| File | Purpose |
|------|---------|
| `screen-framework/actions/ScreenActionHandler.jsx` | Subscribes to ActionBus, bridges to overlay system |
| `modules/Doorbell/DoorbellPIP.jsx` | PIP overlay for doorbell camera (stub) |
| `screen-framework/overlays/ToastNotification.jsx` | Stackable auto-dismiss toast |

### Modify

| File | Change |
|------|--------|
| `screen-framework/overlays/ScreenOverlayProvider.jsx` | Three slots, priority, mode-aware API |
| `screen-framework/overlays/ScreenOverlayProvider.css` | PIP positioning, toast stack layout |
| `screen-framework/ScreenRenderer.jsx` | WS subscription processor, mount ScreenActionHandler |
| `screen-framework/widgets/builtins.js` | Register piano, doorbell-camera, toast |
| `data/household/screens/office.yml` | Add subscriptions section |
| `docs/reference/core/screen-framework.md` | Update with Phase 4 |

### Untouched

- MenuStack, Player, PianoVisualizer — no changes
- ActionBus, InputManager, adapters, actionMap — already working
- All dashboard widgets

## 6. YAML Config: office.yml Subscriptions

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
      inactivity: 30s
```

Additional subscriptions (doorbell, notifications) can be added per-screen as needed.
