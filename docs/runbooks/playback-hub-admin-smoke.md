# Playback Hub Admin — manual smoke checklist

Run this once before declaring the Playback Hub Admin "done" after any
material change to the bounded context (`backend/src/2_domains/playback-hub/`,
`backend/src/3_applications/playback-hub/`, `backend/src/1_adapters/playback-hub/`,
`backend/src/4_api/v1/routers/playbackHub.mjs`, or `frontend/src/modules/Admin/PlaybackHub/`).

Automated coverage lives in `tests/integration/playback-hub-bootstrap.test.mjs`
(Task 9.1) — this checklist is the human-facing verification against a real hub.

## Pre-requisites

- DS dev backend running (`npm run dev` — see `docs/runbooks/dev-server-multi-environment.md`)
- Real playback hub reachable at `kckern-playback-hub:8080` (SSH alias for `10.0.0.109`)
- Browser pointed at the dev frontend
- `ssh kckern-playback-hub` works without password prompt

## Checklist

### 1. Page loads with five cards

Open `/admin/playback-hub` in the browser.

- [ ] Five device cards render (red, yellow, green, blue, white)
- [ ] BT-connected slots show `Now: <title>` (LabeledContentPicker resolved the
      queue's display title without a flicker)
- [ ] BT-disconnected slots show `—` as the now-playing label

### 2. Transport buttons dispatch commands

Click pause on a playing slot.

- [ ] Audio pauses on the headset
- [ ] Card status updates within ~3 s (matches the WS broadcaster tick interval
      set by `PlaybackHubContainer` → `broadcasterOptions.intervalMs`)

Pick a new queue in the transport combo, click **Play Now**.

- [ ] Audio switches to the new queue on the target headset
- [ ] Title on the card updates to reflect the new queue

### 3. Volume slider works (live, current device)

Adjust the volume slider on an active slot.

- [ ] Audio volume on the headset tracks the slider
- [ ] Card's volume reading reflects the new value after the next WS tick

### 4. `volume.max` edit does NOT retroactively clamp running mpv

Edit `volume.max` to `30` on a slot that is currently playing above 30. Save.

- [ ] YAML on the hub reflects the new bound (verify after 60 s sync via
      `ssh kckern-playback-hub 'cat ~/playback-hub/devices.yml'`)
- [ ] The headset's running mpv volume does **NOT** change (this confirms the
      design's "next start" behavior — see `UpdateDeviceConfig` docstring)
- [ ] Power-cycle the headset or trigger a reconnect: subsequent `vol+` presses
      cap at 30 (new bound now in effect)

### 5. Multi-tab edit visibility

Open a second admin tab. In tab A, edit a scheduled fire's time. Save.

- [ ] Tab A reflects the change immediately
- [ ] Tab B still shows the old value (no cross-tab broadcast for config edits
      — this is by design; only `/status` is broadcast over WS)
- [ ] Any other interaction in tab B (or a manual reload) shows the new value

### 6. Hub-down stale-data + WS backoff

Stop the hub:

```bash
ssh kckern-playback-hub 'systemctl --user stop playback-hub.service'
```

- [ ] Admin keeps showing the last-good data (no UI crash)
- [ ] Backend log shows `playback-hub.fetch_failed` events; consecutive count
      climbs (visible in dev console / log stream)
- [ ] After ~30 s, the broadcaster reaches max backoff (matches
      `broadcasterOptions.maxBackoffMs`)

### 7. Hub-up recovery

Restart the hub:

```bash
ssh kckern-playback-hub 'systemctl --user start playback-hub.service'
```

- [ ] Admin recovers within ~3 s of the next successful broadcaster tick
- [ ] Status data refreshes and matches `curl http://10.0.0.109:8080/api/status`

## Reporting issues

If any step fails, file a bug in `docs/_wip/bugs/` with:

- The card / route / scheduled fire that failed
- Backend log excerpt (filter on `playback-hub.*`)
- WS broadcast stream from browser console (`window.DAYLIGHT_LOG_LEVEL = 'debug'`)
- The `devices.yml` state on the hub (`ssh kckern-playback-hub 'cat ~/playback-hub/devices.yml'`)

See `docs/_wip/plans/2026-05-27-playback-hub-admin-impl.md` for the full design
and bounded-context tour.
