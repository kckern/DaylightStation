# Office keypad dead while video played — no way to stop

**Date:** 2026-04-23
**Severity:** High — user was stuck watching content they could not pause/stop
**Component:** `frontend/src/screen-framework/ScreenRenderer.jsx`, `NumpadAdapter`, `RemoteAdapter`, `backend/src/4_api/v1/routers/device.mjs`, device config
**Related audit:** `docs/_wip/audits/2026-03-29-office-screen-total-failure-audit.md` — documented an earlier instance of the same failure mode.

## Summary

The office-program triggered, the TV powered on, and the Aljazeera news video started playing — but the SayoDevice 6x4 macropad (officekeypad) did nothing. The user could not pause, stop, skip, or reload. The key-4 "failsafe reload" was silently disabled because the ScreenRenderer marked input as healthy even when the keymap failed to load.

## Reproduction

1. Trigger `GET /api/v1/device/office-tv/load?queue=office-program`.
2. Video starts playing on the office screen.
3. Press any key on the physical keypad. Nothing happens. No `numpad.key` logs. No action.
4. Press `4` (the documented failsafe reload key). Nothing.

## Root causes

### Frontend — failsafe disabled even when adapter silently broken

`frontend/src/screen-framework/ScreenRenderer.jsx:220-228` initialized the input system like this:

```javascript
useEffect(() => {
  if (!config?.input) return;
  const manager = createInputManager(getActionBus(), config.input);
  inputHealthyRef.current = true;   // ← set true unconditionally
  return () => {
    manager.destroy();
    inputHealthyRef.current = false;
  };
}, [config]);
```

`inputHealthyRef` is what the failsafe at lines 187-196 checks. If `inputHealthyRef.current === true`, pressing `4` is assumed to be handled by the adapter and the failsafe is a no-op.

But `NumpadAdapter.attach()` (`frontend/src/screen-framework/input/adapters/NumpadAdapter.js:22-29`) catches a failed keymap fetch and assigns `this.keymap = {}`, then installs a keydown handler that returns silently on every unmapped key (which is *every* key when the keymap is `{}`). `attach()` always resolves successfully — the fetch error is swallowed — so the caller has no way to tell the adapter ended up empty.

Combined:
- Keymap fetch silently fails or returns empty → adapter is a zombie.
- `inputHealthyRef.current = true` regardless → failsafe disabled.
- User is stuck.

This exactly matches the 2026-03-29 audit's `keyMap` never-loads cascade.

### Backend — no load-side guard

`wake-and-load` has no notion of "this device requires functional input before it can accept content." A full-screen video can be dispatched without any verification that the screen has working keybindings — so the frontend failure mode becomes a stuck-user UX failure.

## Fixes

Two commits covering both sides.

### Fix 1 — frontend: accurate input-health reporting (commit `ef206269`)

- `NumpadAdapter.isHealthy()` returns `true` iff `keymap` has entries.
- `RemoteAdapter.isHealthy()` returns `true` once handler is attached (built-in nav keys work regardless of keymap).
- `ScreenRenderer` awaits `manager.ready` and sets `inputHealthyRef` based on `adapter.isHealthy()` instead of unconditionally.

Result: if the keymap fails or is empty, `inputHealthyRef` stays false → the key-4 failsafe reloads the page. The user always has an escape.

### Fix 2 — backend: refuse load when declared input is not wired (commit `4279578f`)

New optional device config block:

```yaml
office-tv:
  input:
    keyboard_id: officekeypad
    required: true
```

When `input.required: true`, `GET /device/:id/load` runs a pre-flight against the household keyboard YAML (`data/household/config/keyboard.yml`). If zero entries match `keyboard_id`, the load is refused with **HTTP 503**, body `{ ok: false, failedStep: 'input', error: "input device 'officekeypad' has no keymap entries" }`. `WakeAndLoadService` never runs — no TV powering on, no content dispatched, no unstoppable video.

This catches exactly the failure mode the 2026-03-29 audit documented (keymap endpoint returns empty for some deploy/restart reason).

## What this doesn't yet catch

The guard only validates the *backend* keymap data. A scenario where:

- The backend keymap is fine (non-empty).
- But the *browser* fails to apply it (fetch blocked by the NPM proxy, JS bundle stale, etc.).

…would still dispatch content. Fix 1 mitigates this via the failsafe reload key, but the full belt-and-braces solution is a frontend heartbeat: the screen reports "input.ready keymapSize=N" on an interval after successful attach; the backend refuses dispatch if the heartbeat is stale. Not shipped in this pass.

## Verification

- Unit tests: `backend/tests/unit/api/device.inputPrecondition.test.mjs` (6 cases, all pass). Covers empty keymap, wrong-keyboard keymap, happy path, no-input-config, required:false opt-out, and whitespace/case normalization.
- Live: after deploy, `GET /api/v1/device/office-tv/load?queue=office-program` proceeded normally (keymap has entries) — no `input-precondition-failed` log. Power-on chain ran with the existing 3-retry / 20s budget from the wake-and-load fix earlier today.

## Files

| File | Change |
|---|---|
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Added `isHealthy()` → true only if keymap non-empty. |
| `frontend/src/screen-framework/input/adapters/RemoteAdapter.js` | Added `isHealthy()` → true if handler attached. |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Awaits `manager.ready` and sets `inputHealthyRef` from adapter's `isHealthy()`. |
| `backend/src/4_api/v1/routers/device.mjs` | Added `checkInputPrecondition(deviceId)` helper + pre-flight in `GET /:id/load`. |
| `backend/src/0_system/bootstrap.mjs`, `backend/src/app.mjs` | Thread `loadFile` through to the device router. |
| `backend/tests/unit/api/device.inputPrecondition.test.mjs` | New — 6 cases. |
| `data/household/config/devices.yml` *(data volume)* | Office-tv gets `input: { keyboard_id: officekeypad, required: true }`. |

## Emergency stop that was used today

When the stuck video first surfaced, `curl` to HA `script.office_tv_off` was the fastest escape — IR-blast the TV off, display goes dark, browser keeps running in the background. This is worth documenting as a manual recovery path until the heartbeat-style guard is built.
