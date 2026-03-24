# Shield Remote Nav Stack Bloat — Key Repeat + Gamepad Duplication

**Date:** 2026-03-21
**Severity:** High — UI is unusable on the living room TV
**Device:** Shield TV (livingroom-tv, `172.18.0.65`)
**Area:** Menu navigation, input handling
**Status:** Fixed — key repeat guard + gamepad dedup added

---

## Symptom

After launching a game from the Games/Arcade menu on the Shield TV and returning (FKB kills the activity and returns to the WebView), the Shield remote's D-pad and select button stop working entirely. Navigate and select presses are ignored — the user cannot scroll through games or select one. The menu is visible but frozen.

The user must reload the page to regain control.

## Evidence from Prod Logs

### Timeline (2026-03-21, UTC)

| Time | Event |
|------|-------|
| 20:44:06–08 | 10 rapid `nav.push` menu events (initial menu navigation — working) |
| 20:45:18 | Games list loaded (`retroarch/launchable`) |
| 20:46:50 | Launched Mario Kart 64 (select worked) |
| 20:46:55 | `nav.pop` — returned from launch |
| 20:48:00 | Launched Bubble Bobble (select worked, but D-pad navigation was broken between) |
| 20:48:06 | `nav.pop` — returned from launch |
| 20:50:25 | Launched Super Mario All-Stars |
| 20:51:08 | `nav.pop` — returned from launch |
| **20:51:17–24** | **8 consecutive `actionbus.emit.unhandled` for `navigate` (subscriberCount: 0)** |
| **20:51:25** | **`actionbus.emit.unhandled` for `select` (subscriberCount: 0)** |
| 20:51:25 | `item-selected` fires (arcade-selector) — select eventually handled through alternate path |
| 20:52:33 | `nav.pop` — returned from launch |
| **20:52:58–59** | **More unhandled navigate + select events (subscriberCount: 0)** |

### Key Pattern

After every `nav.pop` return from a game launch, D-pad presses produce `actionbus.emit.unhandled` warnings with `subscriberCount: 0`. The user had to press buttons repeatedly before input started working again.

The nav stack is also suspiciously large — **20 menu entries** — suggesting nav.push events are accumulating without cleanup:
```json
{"stackLength": 21, "types": ["menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","menu","launch"]}
```

## Root Cause Analysis

### ActionBus 0 Subscribers Is Expected (Red Herring)

The `subscriberCount: 0` warning is **not the bug itself** — it's a symptom. The Menu and ArcadeSelector components do **not** subscribe to ActionBus for navigate/select actions. They use direct DOM `keydown` listeners instead:

- **Menu.jsx** (line ~834–876): `window.addEventListener("keydown", handler)` in a `useEffect`
- **ArcadeSelector.jsx** (line ~220–223): `window.addEventListener("keydown", handleKeyDown)` in a `useEffect`

Meanwhile, the input adapters (`RemoteAdapter`, `GamepadAdapter`) emit `navigate` and `select` to ActionBus. Since no component subscribes to these ActionBus actions, the warnings always fire — but the DOM listeners normally handle the actual input.

### The Real Bug: DOM Listeners Not Re-Attaching After Nav.Pop

### Root Cause 1: No Key Repeat Guard

Neither `Menu.jsx` nor `ArcadeSelector.jsx` checked `e.repeat` on keydown events. When the Shield remote's center button is held even briefly, Android fires repeated Enter events at ~150ms intervals (accelerating from ~350ms initial delay). Each fires `onSelect` → `push()`, stacking 10+ menu levels for a single intended press.

The 10 rapid `nav.push` events at 20:44:06–08 with intervals matching Android key repeat (346ms → 129ms) confirm this.

### Root Cause 2: GamepadAdapter Synthetic Event Duplication

`GamepadAdapter.js:185–192` dispatches synthetic `keydown` events on `window` for every gamepad button, alongside emitting to ActionBus. If the Shield remote registers as a gamepad (or a Bluetooth controller is connected from RetroArch sessions), the same button press generates:

1. Real `keydown` from the remote → processed by Menu handler
2. Synthetic `keydown` from GamepadAdapter → ALSO processed by Menu handler

Neither handler checked `e.__gamepadSynthetic` to deduplicate. Combined with key repeat, this could produce 2× the nav stack depth.

### ActionBus 0-Subscriber Warnings (Red Herring)

The `actionbus.emit.unhandled` warnings for navigate/select are expected noise. RemoteAdapter and GamepadAdapter emit to ActionBus, but Menu components use direct DOM `keydown` listeners, not ActionBus subscriptions. The warnings indicate an architectural mismatch (dual input paths) but are not the cause of the UI failure.

## Fix Applied

### Menu.jsx (~line 835)
- Added `if (e.repeat || selectCooldown) return` on select actions — prevents key repeat from stacking menu levels
- 300ms cooldown between selects prevents rapid duplicate pushes from any source (key repeat, gamepad synthetic events)

### ArcadeSelector.jsx (~line 167)
- Same `e.repeat` + cooldown guard for the catch-all select path
- Navigation (arrow keys) intentionally allows repeat for smooth scrolling

## Files Involved

| File | Role |
|------|------|
| `frontend/src/modules/Menu/Menu.jsx` | **Fixed** — keydown handler with repeat/dedup guards |
| `frontend/src/modules/Menu/ArcadeSelector.jsx` | **Fixed** — keydown handler with repeat/dedup guards |
| `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` | Emits synthetic keydown events (source of duplication) |
| `frontend/src/screen-framework/input/adapters/RemoteAdapter.js` | Emits to ActionBus on keydown (amplifies duplication) |
| `frontend/src/context/MenuNavigationContext.jsx` | Navigation state (push/pop/stack) |

## Remaining Concern

The `actionbus.emit.unhandled` warnings are architectural noise. Nothing subscribes to ActionBus for `navigate`/`select` — all handling is via DOM listeners. Consider either:
- Having menu components subscribe to ActionBus (eliminating the dual path)
- Suppressing or removing the ActionBus emissions for navigate/select
