# Single-Layer Hardware Volume for Wake-and-Load

**Date:** 2026-03-22
**Status:** Approved

## Problem

Two volume layers compound during content loading. The HA power-on script sets TV hardware volume to 15%, then the frontend sets `el.volume` to 0.1 from the `volume` query param. Effective output is ~1.5% — far too quiet.

## Solution

Volume is single-layer, hardware only. The `volume` param in load requests sets the TV/OS volume via the device's existing volume capability during the wake-and-load sequence. The HTML audio element always plays at 1.0.

## Design

### Wake-and-Load Sequence

The sequence becomes: **power on -> verify -> set volume -> load content**

After the verify step, before content loading:

1. Read `query.volume` (if present) or fall back to `device.defaultVolume` (from config)
2. If a volume value exists, call `device.setVolume(level)` with a 3s timeout
3. Log the result, continue to content load regardless of volume success/failure

### Device Config

Add `default_volume` per device in `devices.yml`:

```yaml
office-tv:
  default_volume: 15
  device_control:
    displays: ...

livingroom-tv:
  default_volume: 15
  device_control:
    displays: ...
```

### Edge Cases

- **Volume-before-content timing:** `await` with 3s timeout. If volume fails, log warning and proceed.
- **Device without volume capability:** Check `device.hasCapability('volume')` first. Skip with debug log if unsupported.
- **`volume=0`:** Treated as mute (existing semantics in `homeAutomation.mjs`).
- **No `volume` param + no `default_volume`:** Do nothing. TV stays at current volume.

### What Does NOT Change

- `/api/v1/device/:deviceId/volume/:level` endpoint — independent manual control
- `/api/v1/home/vol/:level` endpoint — office remote/keyboard
- Frontend volume slider in `NowPlaying.jsx` — in-app mixing (fitness video vs music)
- Per-item `volume` in content lists (admin editor) — content-level mixing within audio element

## Files to Modify

| File | Change |
|------|--------|
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Add volume step between verify and load |
| `backend/src/3_applications/devices/services/DeviceFactory.mjs` | Pass `default_volume` from config to Device |
| `backend/src/3_applications/devices/services/Device.mjs` | Expose `defaultVolume` getter |
| `data/household/config/devices.yml` | Add `default_volume: 15` to livingroom-tv and office-tv |
| `frontend/src/Apps/MediaApp.jsx` | Remove `el.volume` setter from volume query param |
| `homeassistant/_includes/scripts/living_room_tv_on.yaml` | Remove `media_player.volume_set` step (lines 77-82) |

## Test Plan

1. Kitchen button 2 -> music plays at hardware volume 10, `el.volume` is 1.0
2. Load request with no `volume` param -> TV uses `default_volume` from config
3. Load request with `volume=0` -> TV mutes
4. Device without volume capability (e.g., piano) -> volume step skipped gracefully
5. Volume API timeout -> warning logged, content still loads
