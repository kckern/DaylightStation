# Media Cast Target — Design Spec

## Summary

Add a "cast target" concept to the Media app that lets users set a destination device once, then cast content to it repeatedly with minimal friction. Device-level settings (shader, volume) are configured on the target. Per-cast settings (shuffle, repeat) are configured inline at cast time.

## User Flow

1. **Set target** — Tap cast icon in the Media app header → dropdown panel opens → pick a device → configure shader and volume → panel closes.
2. **Browse** — Header now shows an active device chip. Browse content normally.
3. **Cast** — Tap cast button on any content → per-cast popover with shuffle/repeat toggles → "Cast Now" fires to the target device with all settings composed into the API call.

The target is **sticky for the session** — it persists until the user changes it or leaves the Media app. A visible chip in the header always shows the active target.

## New Components

### CastTargetChip

Compact element in the Media app header, right of the search bar.

**States:**
- **No target** — Dimmed `📡` icon with dashed border. Tapping opens `CastTargetPanel`.
- **Target active** — Purple chip with green dot, device name, dropdown arrow. Tapping opens `CastTargetPanel`.
- **Sending** — Pulsing chip with animated sweep. Label cycles through wake-and-load steps: "Powering on..." → "Connecting..." → "Setting volume..." → "Loading...". Driven by `wake-progress` WebSocket events on `homeline:{deviceId}`.
- **Success** — Green chip: "Playing on Living Room". Reverts to idle after 5 seconds.
- **Error** — Red chip: "Failed — tap to retry". Stays until tapped (retries the load) or a new cast is triggered.

### CastTargetPanel

Dropdown panel anchored below the header chip. Two sections:

**Device list** — Horizontal scrollable cards showing all castable devices. Each card shows icon, name, and device type label. Selected device is highlighted. Devices fetched from `GET /api/v1/device` filtered by `capabilities.contentControl`.

**Settings** — Shown below device list, scoped to the selected device. Adapts based on device capabilities:
- **Screen devices** (shield-tv, linux-pc): shader selector (off / focused / night / dark) + volume slider (0–100)
- **Audio-only devices**: volume slider only (no shader)
- **Mobile devices**: no device-level settings (just device selection)

Settings apply immediately on interaction (no confirm button). Panel closes on outside click or tapping the chip again.

### useCastTarget() Hook

New React context + hook managing cast target state.

**State shape:**
```javascript
{
  device: {
    id: 'livingroom-tv',
    name: 'Living Room TV',
    type: 'shield-tv',
    capabilities: { contentControl, deviceControl, osControl }
  },
  settings: {
    shader: 'night',
    volume: 40
  },
  status: 'idle' | 'sending' | 'success' | 'error',
  currentStep: null | 'power' | 'verify' | 'volume' | 'prepare' | 'prewarm' | 'load',
  error: null | string
}
```

**Responsibilities:**
- Store selected device + settings (session-scoped, not persisted)
- Subscribe to `homeline:{deviceId}` WebSocket topic for `wake-progress` events
- Update `status` and `currentStep` as progress events arrive
- Provide `castToTarget(contentId, perCastOptions)` function that composes the full API call
- Auto-revert `status` from `success` to `idle` after 5 seconds
- Provide `retry()` function that re-fires the last failed cast

### CastButton (Modified)

Existing `CastButton` component updated to be target-aware.

**When target is set:**
- Tap opens a small popover anchored to the button
- Popover shows: "Sending to {device name}" with device settings summary (shader, volume)
- For playlists/collections: shuffle and repeat toggles
- For single items (movie, episode): no toggles, just "Cast Now" button
- "Cast Now" calls `castToTarget(contentId, { shuffle, repeat })`

**When no target is set:**
- Falls back to existing DevicePicker modal flow
- After device selection, that device becomes the sticky target
- Then shows per-cast popover as above

Content type (single vs. playlist) is determined from the content's `format` field and item count already available in the media queue data.

## API Integration

The cast action composes a single GET request to the existing endpoint:

```
GET /api/v1/device/{deviceId}/load?queue={contentId}&shader={shader}&volume={volume}&shuffle={0|1}&repeat={0|1}
```

All parameters are already supported by `WakeAndLoadService`. No backend changes needed.

**Progress events** are already emitted by `WakeAndLoadService` on the `homeline:{deviceId}` WebSocket topic:
```javascript
{ topic: 'homeline:{deviceId}', type: 'wake-progress', step, status, steps: [...] }
```

The `useCastTarget` hook subscribes to these events to drive chip state transitions.

## Capability-Aware Configuration

Device capabilities determine which settings appear in `CastTargetPanel`:

| Device Type | Shader | Volume | Notes |
|-------------|--------|--------|-------|
| Screen (shield-tv, linux-pc) | Yes | Yes | Full config |
| Audio-only | No | Yes | No visual settings |
| Mobile | No | No | Target selection only |
| Kiosk | Yes | No | Visual only, no volume control |

Capability detection uses the existing `capabilities` object from the device config. Shader is shown when `contentControl` is true and the device type has a screen. Volume is shown when `osControl` or `deviceControl` is true.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/modules/Media/CastTargetChip.jsx` | Header chip component with state transitions |
| `frontend/src/modules/Media/CastTargetPanel.jsx` | Dropdown panel with device list + settings |
| `frontend/src/modules/Media/useCastTarget.js` | Hook/context for cast target state management |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/modules/Media/CastButton.jsx` | Read target from context, show per-cast popover instead of immediate DevicePicker |
| `frontend/src/modules/Media/ContentBrowser.jsx` | Wrap in CastTarget provider if not already at app level |
| `frontend/src/modules/Media/DevicePicker.jsx` | Add callback to set device as sticky target after selection |

## Out of Scope

- Persisting target across sessions (localStorage) — can add later if wanted
- "Now playing" transport controls on the phone for remote device — separate feature
- Multi-device simultaneous cast — single target only
- Editing device configs (display name, default volume) from the UI
- Queue composition (building multi-source playlists before casting)

## Edge Cases

- **Device goes offline while targeted** — chip shows stale target. Next cast attempt will fail and show error state with retry.
- **Multiple rapid casts** — `WakeAndLoadService` already deduplicates concurrent calls for the same device. Second cast queues behind the first.
- **Cast to already-playing device** — works fine. New content replaces current. The WS-first path delivers instantly if the screen is already loaded.
- **Target device removed from config** — `useCastTarget` clears target if device disappears from the device list on next fetch.
