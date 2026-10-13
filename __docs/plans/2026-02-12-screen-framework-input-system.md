# Screen Framework Input System Design

Finish the screen framework (Phase 2) by adding input adapters that translate hardware events into ActionBus events. Existing OfficeApp and TVApp remain untouched.

## Context

Phase 1 is complete: ScreenRenderer, GridLayout, ActionBus, WidgetRegistry, DataManager, builtins, backend `/api/v1/screens/:id`, YAML configs (`office.yml`, `tv.yml`), and the `/screen/:screenId` route all exist and work.

The gap: YAML configs declare `input: numpad` / `input: remote` but nothing reads that field. No input adapters exist.

## Design

### Input Pipeline

```
Hardware keydown
  → InputManager selects adapter based on config.input.type
    → Adapter fetches keymap from /api/v1/home/keyboard/{keyboard_id}
      → On keydown, looks up key in keymap, translates function name → standardized action
        → Emits to ActionBus
```

### Coexistence with Existing Components

Input adapters emit to the ActionBus **without** stopping propagation of raw keyboard events. Existing widgets (Menu, Player) continue handling keydown events their own way. The ActionBus is a forward-compatible layer — events go unhandled today but become useful when screen-native widgets are built later.

Why this works without conflict:
- **Numpad**: Adapter translates numpad keys (1-9) → high-level actions. Existing components listen for arrow/enter keys. Different key spaces, no overlap.
- **Remote**: Adapter translates arrows → `navigate` actions. Existing MenuStack also handles arrows. Both fire, but no ActionBus subscriber exists yet, so no double-execution.

### Action Vocabulary

| Action | Payload | Translated from |
|--------|---------|-----------------|
| `menu:open` | `{ menuId }` | `function: menu, params: {id}` |
| `media:play` | `{ contentId }` | `function: play, params: {id}` |
| `media:queue` | `{ contentId }` | `function: queue, params: {id}` |
| `media:playback` | `{ command }` | `function: playback, params: play\|pause\|prev\|fwd\|rew` |
| `navigate` | `{ direction }` | Arrow keys |
| `select` | `{}` | Enter key |
| `escape` | `{}` | Escape key / `function: escape` |
| `display:volume` | `{ command }` | `function: volume, params: +1\|-1\|mute_toggle` |
| `display:shader` | `{}` | `function: shader` |
| `display:sleep` | `{}` | `function: sleep` |
| `display:rate` | `{}` | `function: rate` |

### YAML Config Change

Expand `input` from a string to an object:

```yaml
# office.yml
input:
  type: numpad
  keyboard_id: officekeypad

# tv.yml
input:
  type: remote
  keyboard_id: tvremote
```

Backward-compatible: if `input` is a plain string, treat it as `{ type: input, keyboard_id: null }` and fall back to the KeyboardAdapter (dev arrows/enter/escape).

### Action Map (Translation Table)

Maps OfficeApp-era function names to standardized action names. No backend changes needed.

```js
const ACTION_MAP = {
  menu:     (params) => ({ action: 'menu:open', payload: { menuId: params } }),
  play:     (params) => ({ action: 'media:play', payload: { contentId: params } }),
  queue:    (params) => ({ action: 'media:queue', payload: { contentId: params } }),
  playback: (params) => ({ action: 'media:playback', payload: { command: params } }),
  escape:   ()       => ({ action: 'escape', payload: {} }),
  volume:   (params) => ({ action: 'display:volume', payload: { command: params } }),
  shader:   ()       => ({ action: 'display:shader', payload: {} }),
  sleep:    ()       => ({ action: 'display:sleep', payload: {} }),
  rate:     ()       => ({ action: 'display:rate', payload: {} }),
};
```

## Files

### Create

| File | Purpose |
|------|---------|
| `frontend/src/screen-framework/input/useScreenAction.js` | Hook for widgets to subscribe to ActionBus actions |
| `frontend/src/screen-framework/input/InputManager.js` | Reads config.input, creates adapter, attaches to ActionBus |
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Fetches keymap, translates numpad keydown → ActionBus |
| `frontend/src/screen-framework/input/adapters/RemoteAdapter.js` | Same pattern for remote controls |
| `frontend/src/screen-framework/input/adapters/KeyboardAdapter.js` | Hardcoded dev fallback (arrows/enter/escape) |
| `frontend/src/screen-framework/input/actionMap.js` | Translation table: legacy function names → action names |
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.test.js` | Tests |
| `frontend/src/screen-framework/input/adapters/KeyboardAdapter.test.js` | Tests |
| `frontend/src/screen-framework/input/InputManager.test.js` | Tests |

### Modify

| File | Change |
|------|--------|
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Initialize InputManager with config.input |
| `frontend/src/screen-framework/index.js` | Export new input pieces |

### Config Changes

| File | Change |
|------|--------|
| `data/household/screens/office.yml` | Expand `input: numpad` → `input: { type: numpad, keyboard_id: officekeypad }` |
| `data/household/screens/tv.yml` | Expand `input: remote` → `input: { type: remote, keyboard_id: tvremote }` |

### Not Touched

- `OfficeApp.jsx`, `TVApp.jsx`, `keyboardHandler.js`
- Any existing module (Menu, Player, etc.)
- Backend (keymap API already exists)

---

## Addendum: Review Notes

Feedback from codebase stress test (2026-02-12). Items to address before or during implementation.

### Must Fix

**1. `secondary` fallback not accounted for**

The existing keymap entries support a `secondary` field (e.g., numpad key 2: `function: playback, params: play, secondary: menu:video`). When no player is active, OfficeApp's `keyboardHandler.js` falls through to the secondary action. The ACTION_MAP only handles the primary `function` field — there's no mechanism for secondary/fallback actions. This matters for feature parity when screen-framework eventually replaces OfficeApp. Proposed fix: extend ACTION_MAP entries to accept a `secondary` string and emit a second action (or a `fallback` payload field) when present.

**2. WebSocket synthetic events will double-fire**

`websocketHandler.js` dispatches synthetic `KeyboardEvent`s on `window` for remote playback commands (play→Space, next→Tab). The new input adapters also listen on `window` for `keydown`. A WebSocket "play" command creates a synthetic Space keydown that both the existing player keyboard handler AND the new adapter would intercept. Today that's harmless (no ActionBus subscribers), but it becomes a double-execution bug when widgets start subscribing. Proposed fix: either mark synthetic events with a custom property the adapter can ignore, or have WebSocket commands emit directly to ActionBus instead of synthesizing DOM events.

**3. Adapter cleanup not specified**

Adapters attach `window.addEventListener('keydown', ...)`. The plan doesn't specify:
- Cleanup on unmount (removing the listener)
- Cleanup on config change (hot-reloading a different adapter)
- What happens if multiple ScreenRenderers mount (ActionBus is a singleton)

All existing hooks (`useKeyboardHandler`, `useMenuNavigation`) clean up in their `useEffect` return. InputManager must expose a `destroy()` method, and ScreenRenderer must call it on unmount. Specify this in the InputManager and ScreenRenderer contracts.

### Should Fix

**4. `display:rate` is misnamed**

Playback rate is a media concept — `keyboardHandler.js` applies it via `videoRef.playbackRate`. It should be `media:rate` to match the `media:*` namespace. `display:sleep` and `display:shader` are correctly namespaced (they affect the screen overlay, not media).

**5. Backward-compat parsing is premature**

The plan says if `input` is a plain string, treat it as `{ type: input, keyboard_id: null }`. But `data/household/screens/` doesn't exist yet — there are no configs to be backward-compatible with. The files table lists these as "Modify" but they need to be "Create." Drop the string-fallback parsing and require the object format from the start. Fewer code paths, fewer tests, no cost.

### Acknowledge for Phase 3

**6. Focus/context management**

The RemoteAdapter translates arrows into `navigate` actions — the same arrows that Menu.jsx, useMenuNavigation, fitness hooks, and keyboardManager all handle via `window.addEventListener`. The plan correctly notes "both fire, no subscriber yet" but offers no design for when subscribers DO exist. When Phase 3 adds screen-native widgets that subscribe to ActionBus `navigate` events, arrow keys will trigger both the ActionBus path and the legacy component path. A future focus/context system will need to arbitrate. This is out of scope for Phase 2 but should be named as a known debt.

**7. ActionBus bidirectionality**

WidgetWrapper already gives each widget a `dispatch(action, payload)` that calls `actionBus.emit()`. The new input adapters also emit to the same ActionBus. The bus carries both hardware-originated events (input → widget) and widget-originated events (widget → widget). If a widget subscribes to `media:play` AND dispatches `media:play`, it creates an infinite loop. The `useScreenAction` hook should document this or guard against self-triggered events (e.g., by tagging events with a source).
