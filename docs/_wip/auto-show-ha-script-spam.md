# Piano Auto-Show: Redundant HA Script Calls

**Date:** March 3, 2026
**Status:** WIP
**Component:** Piano Visualizer / Home Automation integration

---

## Problem

Every time the piano component mounts (via `auto_show`), `usePianoConfig` fires the `on_open` HA script (`script.office_tv_hdmi_3`) unconditionally. When the TV is already on HDMI3, this is a no-op that still triggers the full `office_tv_on` sequence, including a nightlight flash.

On March 3, 2026, the nightlight flashed repeatedly throughout the day — every time a MIDI note arrived after the piano had been hidden by idle timeout or navigation.

### Evidence

```
23:35:45.915Z  piano.auto_show       {"reason": "note_received"}
23:35:45.952   apps.config.read      {"appId": "piano"}
23:35:45.959   ha.script.running     {"entityId": "script.office_tv_hdmi_3"}
23:36:48.004Z  piano.auto_show       {"reason": "note_received"}
23:36:48.026   ha.script.running     {"entityId": "script.office_tv_hdmi_3"}
23:38:13.980   ha.script.running     {"entityId": "script.office_tv_hdmi_3"}
23:39:09.082   ha.script.running     {"entityId": "script.office_tv_hdmi_3"}
```

4 calls in 4 minutes, each producing a 5-second nightlight flash.

---

## Root Cause Chain

```
MIDI note_on
  → OfficeApp.jsx:218  (auto_show, reason: note_received)
    → setShowPiano(true)
      → Piano component mounts
        → usePianoConfig.js:28  useEffect runs initPiano()
          → fetches /api/v1/device/config
          → reads on_open = "script.office_tv_hdmi_3"
          → POST /api/v1/home/ha/script/office_tv_hdmi_3  (UNCONDITIONAL)
            → homeAutomation.mjs:336  haGateway.callService('script', 'turn_on', ...)
              → HA runs script.office_tv_hdmi_3
                → script.office_tv_on(hdmi3)
                  → nightlight white → TV already on → nightlight off (5 sec flash)
```

### Why it repeats

The `!showPiano` guard in `OfficeApp.jsx:218` prevents duplicate triggers while the piano is visible. But when the piano hides (idle timeout, navigation), the next MIDI note sets `showPiano = true` again, remounting the component, and `usePianoConfig` re-runs `on_open`.

---

## Existing Guards

| Layer | Guard | Prevents |
|-------|-------|----------|
| OfficeApp.jsx:218 | `!showPiano` | Duplicate auto_show while piano visible |
| OfficeApp.jsx:209 | `isPlayerActive.current` | Auto-show during media playback |
| **usePianoConfig.js** | **None** | **Nothing — fires on_open every mount** |

---

## Mitigation (HA-side, deployed)

`scripts/office_tv_hdmi_3.yaml` now has a condition that skips when `binary_sensor.office_tv_state` is already `on`. This stops the nightlight flash but DaylightStation still makes the unnecessary API call.

---

## Recommended Fix (DaylightStation-side)

### Option A: Debounce `on_open` in `usePianoConfig`

Track last execution time. Skip if called within N minutes.

```javascript
// usePianoConfig.js
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
let lastOnOpenTime = 0;

useEffect(() => {
  const initPiano = async () => {
    // ... existing config fetch ...

    if (pianoConfig?.on_open) {
      const now = Date.now();
      if (now - lastOnOpenTime < DEBOUNCE_MS) {
        logger.debug('ha.on-open-debounced', {});
        return;
      }
      lastOnOpenTime = now;
      DaylightAPI(`/api/v1/home/ha/script/${pianoConfig.on_open}`, {}, 'POST')
        .then(() => logger.debug('ha.on-open-executed', {}))
        .catch(err => logger.warn('ha.on-open-failed', { error: err.message }));
    }
  };
  initPiano();
  // ...
}, [logger]);
```

**Pros:** Simple, no backend changes.
**Cons:** Module-scoped variable; stale if page refreshes.

### Option B: Query TV state before calling `on_open`

Check HA state via the existing gateway before firing the script.

```javascript
if (pianoConfig?.on_open) {
  const tvState = await DaylightAPI('/api/v1/home/ha/state/binary_sensor.office_tv_state');
  if (tvState?.state === 'on') {
    logger.debug('ha.on-open-skipped', { reason: 'tv_already_on' });
  } else {
    await DaylightAPI(`/api/v1/home/ha/script/${pianoConfig.on_open}`, {}, 'POST');
  }
}
```

**Pros:** Correct — only fires when TV is actually off.
**Cons:** Extra API call per mount (but lightweight GET vs heavy script execution).

### Option C: Move guard to backend `haScriptHandler`

Add generic debounce per `scriptId` in `homeAutomation.mjs`.

```javascript
const scriptLastCalled = new Map();
const SCRIPT_DEBOUNCE_MS = 60_000;

const haScriptHandler = asyncHandler(async (req, res) => {
  const { scriptId } = req.params;
  const now = Date.now();
  const lastCalled = scriptLastCalled.get(scriptId) || 0;

  if (now - lastCalled < SCRIPT_DEBOUNCE_MS) {
    return res.json({ ok: true, debounced: true, entityId: `script.${scriptId}` });
  }
  scriptLastCalled.set(scriptId, now);
  // ... existing logic ...
});
```

**Pros:** Protects all scripts globally, no frontend changes.
**Cons:** Could suppress legitimate rapid calls to other scripts.

### Recommendation

**Option B** is the cleanest — it matches intent (only call `on_open` when the TV needs to be turned on) and doesn't introduce side effects for other scripts. The HA-side guard in `office_tv_hdmi_3.yaml` is already deployed as a safety net regardless.

---

## Files Involved

| File | Layer | Role |
|------|-------|------|
| `frontend/src/Apps/OfficeApp.jsx:202-225` | Frontend | MIDI handler, auto_show trigger |
| `frontend/src/modules/Piano/usePianoConfig.js:15-48` | Frontend | Fires `on_open` script on mount |
| `backend/src/4_api/v1/routers/homeAutomation.mjs:325-344` | Backend | HA script execution endpoint |
| `backend/src/4_api/v1/routers/device.mjs:40-44` | Backend | Device config serving `on_open` value |

---

## Resolution

**Implemented:** Option A (debounce) — 2026-03-03

Module-scoped `lastOnOpenTime` in `usePianoConfig.js` debounces `on_open` calls to once per 5 minutes. Combined with the HA-side condition guard already deployed in `office_tv_hdmi_3.yaml`, the nightlight flash spam is fully resolved at both layers.
