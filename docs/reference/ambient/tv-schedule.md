# Ambient TV Schedule Reference

> Scheduled passive ArtMode windows on the living-room TV: wake to a preset at a
> window's start, power off at its end, always yielding to active content.

## Config — `data/household/config/artmode.yml`

A top-level `schedule:` list. Each window references a preset (or bare collection)
already known to ArtMode. When the block is absent or empty, the scheduler is dormant
(no windows, no actions).

```yaml
schedule:
  - name: weekday-morning        # optional; used for logs + state key
    days: [mon, tue, wed, thu, fri]
    start: "07:00"               # 24h local time
    end:   "09:00"
    preset: impressionism
  - days: [sun]
    start: "08:00"
    end:   "11:00"
    preset: religious
```

- `days` — any of `mon|tue|wed|thu|fri|sat|sun`.
- `start` / `end` — `"HH:MM"` local (America/Los_Angeles).
- `preset` — any artmode preset or collection (loaded as `art:<preset>`).
- `device` — optional; defaults to `livingroom-tv`.

The schedule is re-read every tick, so edits take effect within ~60s without a redeploy.

## Behavior

- **Start:** if nothing is actively playing, wake the TV and load the preset, and
  record that ambient owns the session. If a video is playing, the window is
  **skipped for the day** (no later retry).
- **End:** if ambient still owns the session and nothing is playing, **power the TV
  off** (the default `gallery-silent` screensaver returns on next wake). If a video
  is playing (you took over), ambient releases ownership and leaves the TV on.
- **Always passive:** a real video always suppresses ambient; ArtMode scenes and the
  idle screensaver are passive and never block it. Ambient only powers off a TV it
  turned on itself.
- **Restart safety:** a window whose start passed while the backend was down is **not**
  retroactively fired; ownership persists across restarts so an end-of-window power-off
  still completes.

## How "playing" is detected

The living-room screen publishes a `screen.presence` heartbeat carrying a `playing`
flag — `true` only for non-art content (`active && !artScene`); ArtMode/screensaver
report `false` even though they own a fullscreen overlay. The backend
`ScreenContentTracker` tracks it per device with a ~15s TTL; the scheduler reads
`isPlaying(deviceId)` and treats a missing/stale heartbeat as "not playing."

## State

`data/system/state/ambient-runtime.yml` holds ownership + per-day handled flags
(`startHandled`/`endHandled`, keyed by date; prior days are pruned each tick).

---
Implementation: `backend/src/2_domains/ambient/` (pure: `timeParts`, `normalizeWindows`,
`evaluateAmbientSchedule`), `backend/src/3_applications/ambient/AmbientSchedulerService.mjs`,
`backend/src/3_applications/devices/services/ScreenContentTracker.mjs`, state adapter
`backend/src/1_adapters/ambient/YamlAmbientStateStore.mjs`, wired in `backend/src/app.mjs`.
Frontend signal: `frontend/src/screen-framework/providers/ScreenSceneContext.jsx` +
`publishers/ScreenPresencePublisher.jsx`.
