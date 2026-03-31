# ArcadeSelector Audit — 2026-03-28

Three critical failures identified during live testing on Shield TV (FKB WebView) and standard browser with 8BitDo gamepad.

---

## ~~Failure 1: Images Not Loading~~ — RESOLVED

**Cause:** Transient network issue with X-plore file server on Shield TV. Proxy route is correctly configured and returns image data when reachable.

### Root Cause

RetroArch game items have `item.image` set to proxy URLs like `/api/v1/proxy/retroarch/thumbnail/{id}`. The `resolveImage` function (ArcadeSelector.jsx:91-107) only rewrites paths starting with `/media/img/` or `media/img/`. Proxy URLs are passed through as-is.

Two possible sub-causes:
1. **Proxy endpoint not registered or returning errors** — if `/api/v1/proxy/retroarch/thumbnail/...` returns 404/500, images silently fail
2. **Missing `item.image` field entirely** — if the list router's `toListItem()` doesn't copy `thumbnail` to `image` for arcade items

### Evidence

- Arcade selector mounts with 26 items (log: `mounted { itemCount: 26 }`)
- Random init selects "Super Mario Kart" (log: `random-init { index: 14, total: 26 }`)
- No image-related errors in backend logs
- User reports: no images visible on screen

### Files

| File | Role |
|------|------|
| `frontend/src/modules/Menu/ArcadeSelector.jsx:91-107` | `resolveImage()` — URL resolution |
| `backend/src/4_api/v1/routers/list.mjs` | `toListItem()` — maps `thumbnail` → `image` |
| `backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs` | Sets thumbnail as `/api/v1/proxy/retroarch/thumbnail/{id}` |
| `frontend/src/lib/api.mjs` | `DaylightMediaPath()`, `ContentDisplayUrl()` |

### Remediation

1. **Verify proxy endpoint**: `curl http://localhost:3111/api/v1/proxy/retroarch/thumbnail/<any-game-id>` — does it return image data?
2. **Log image URLs**: Add a debug log in `resolveImage` to see what URLs are being generated
3. **Check toListItem output**: Confirm `image` field is populated in the API response for arcade menu items
4. If proxy is broken, fix the route; if `image` is populated but not loading, the issue is likely CORS or content-type

---

## Failure 2: Back Button Triggers FKB Kiosk PIN Prompt

**Severity:** Critical (UX-breaking — user locked out of app)

### Root Cause

When ArcadeSelector is at the **root of the navigation stack** and the user presses Back:

1. FKB's `onBackButton` callback fires → dispatches synthetic `Escape` keydown on `window`
2. ArcadeSelector catches it → calls `handleClose()` → `navContext.pop()`
3. `pop()` at root stack calls `onBackAtRoot` callback — but **TVApp does not register one**
4. MenuStack's escape interceptor at `depth === 0` returns `false` (not handled)
5. ScreenActionHandler's escape chain fires → may trigger `reload` (idle action)
6. FKB's native back button handler sees unhandled back → **triggers kiosk PIN prompt**

### Evidence

- User pressed Back on Shield remote at arcade selector root level
- FKB PIN prompt appeared instead of returning to parent menu

### Files

| File | Role |
|------|------|
| `frontend/src/lib/fkb.js:114-124` | `bindBackButton()` — dispatches synthetic Escape |
| `frontend/src/modules/Menu/ArcadeSelector.jsx:82-88` | `handleClose()` → `navContext.pop()` |
| `frontend/src/context/MenuNavigationContext.jsx:55-71` | `pop()` at root → calls `onBackAtRoot` (unregistered) |
| `frontend/src/Apps/TVApp.jsx` | MenuNavigationProvider — **missing `onBackAtRoot` prop** |
| `frontend/src/modules/Menu/MenuStack.jsx` | Escape interceptor — returns false at depth 0 |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:219-274` | Escape action handler chain |

### Remediation — APPLIED

**Root cause was double-handling:** ArcadeSelector caught Escape AND KeyboardAdapter also caught it, sending it through ScreenActionHandler's escape chain. At depth=0, MenuStack interceptor returns `false`, causing ScreenActionHandler to dismiss overlay or reload — which FKB interprets as "back unhandled" → kiosk PIN.

**Fixes applied:**
1. `stopImmediatePropagation()` on back events in `ArcadeSelector.jsx:200` and `Menu.jsx:892` — prevents bubble-phase listeners (KeyboardAdapter) from double-handling the Escape
2. `bindBackButton()` deferred retry in `fkb.js` — retries on `window.load` if `fully` global not yet available at module-load time

---

## Failure 3: Gamepad Arrows Fail to Navigate

**Severity:** High (gamepad input completely non-functional)

### Root Cause

The `GamepadAdapter` IS instantiated alongside the primary RemoteAdapter (InputManager.js:35-42) and IS attached. However, `navigator.getGamepads()` **returns null/empty in FKB's Android WebView** on Shield TV.

The Gamepad API requires a **secure context + user interaction** to expose gamepads. FKB's WebView may not support `navigator.getGamepads()` at all, or the `gamepadconnected` event never fires even though the 8BitDo is Bluetooth-paired at the Android OS level.

### Evidence

- **Zero gamepad logs**: No `gamepad.connected`, `gamepad.already-connected`, or `gamepad.emit` events in any log
- Shield remote arrows work fine — they generate real `keydown` events (`fkb.keyCapture` logs show `ArrowRight`, `ArrowUp`)
- The `actionbus.emit.unhandled` warnings with `subscriberCount: 0` are from the RemoteAdapter emitting `navigate` actions that ArcadeSelector doesn't subscribe to (it uses direct keydown)

### Why Shield Remote Works But Gamepad Doesn't

| Input | Mechanism | Works? |
|-------|-----------|--------|
| Shield remote d-pad | Android HID → real `keydown` events | Yes |
| 8BitDo on Shield (BT) | Requires `navigator.getGamepads()` in WebView | **No** — API likely unavailable in FKB WebView |
| 8BitDo on desktop browser | Standard Gamepad API | Should work (untested) |

### Files

| File | Role |
|------|------|
| `frontend/src/screen-framework/input/adapters/GamepadAdapter.js:90-99` | `_findGamepad()` — returns null when API unavailable |
| `frontend/src/screen-framework/input/InputManager.js:35-42` | Always creates GamepadAdapter alongside primary |
| `frontend/src/screen-framework/input/adapters/KeyboardAdapter.js:27` | Correctly skips `__gamepadSynthetic` events |

### Remediation

**For Shield TV / FKB WebView:** The Gamepad API is likely not supported. The 8BitDo gamepad connected via Bluetooth to Android appears as an **Android input device**, NOT a browser Gamepad API device. Android maps gamepad buttons to `KeyEvent` codes:

| 8BitDo Button | Android KeyEvent | Expected `key` in WebView |
|---------------|------------------|---------------------------|
| D-pad Up | `KEYCODE_DPAD_UP` (19) | `ArrowUp` |
| D-pad Down | `KEYCODE_DPAD_DOWN` (20) | `ArrowDown` |
| D-pad Left | `KEYCODE_DPAD_LEFT` (21) | `ArrowLeft` |
| D-pad Right | `KEYCODE_DPAD_RIGHT` (22) | `ArrowRight` |
| A button | `KEYCODE_BUTTON_A` (96) | `GamepadA` or empty `key` |
| B button | `KEYCODE_BUTTON_B` (97) | `GamepadB` or `GoBack` |

**If the 8BitDo d-pad generates `ArrowUp/Down/Left/Right` keydown events** (like the Shield remote), ArcadeSelector should already handle them. The issue may be that 8BitDo gamepad buttons generate **different `key` values** that ArcadeSelector doesn't recognize.

**Action items:**
1. **Audit what keys the 8BitDo actually generates** in FKB WebView:
   - The `fkb.keyCapture` listener (fkb.js:137-151) already logs ALL keydown events
   - Press each 8BitDo button and check the backend logs
   - This will show the exact `key`, `code`, and `keyCode` values
2. If the d-pad sends `ArrowUp/Down/Left/Right` → it should already work (investigate further)
3. If the d-pad sends different codes → add those codes to ArcadeSelector's key handling
4. If NO keydown events appear → the 8BitDo is not being passed through to the WebView by FKB

**For standard browser (desktop):** The GamepadAdapter should work as-is. Test by:
1. Open the app in Chrome/Firefox on desktop
2. Connect 8BitDo via USB or Bluetooth
3. Press a button (this triggers `gamepadconnected` event)
4. Check browser console for `gamepad.connected` log

---

## Remediation Priority

| # | Issue | Priority | Effort |
|---|-------|----------|--------|
| 1 | Images not loading | P0 | Low — likely a missing/broken proxy route or field mapping |
| 2 | Back button → FKB PIN | P0 | Medium — needs `onBackAtRoot` handler + FKB signal |
| 3 | Gamepad on Shield TV | P1 | Low — audit actual key codes first, then add mappings |
| 4 | Gamepad on desktop | P2 | None — should already work, needs verification |

## Next Steps

1. **Immediate**: Check proxy route for RetroArch thumbnails (curl test)
2. **Immediate**: Press each 8BitDo button and check `fkb.keyCapture` logs to see what key values arrive
3. **Fix**: Add `onBackAtRoot` handler in TVApp to prevent FKB PIN prompt
4. **Fix**: Fix image loading (depends on step 1 findings)
5. **Fix**: Add any missing gamepad key mappings (depends on step 2 findings)
