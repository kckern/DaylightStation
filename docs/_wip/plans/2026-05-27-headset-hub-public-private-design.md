# headset-hub: public/private device classes, scheduled fires, remote-command API

**Date:** 2026-05-27
**Status:** Design — pending implementation
**Scope:** `_extensions/headset-hub/` + small additions to DaylightStation HA router

## Problem

Today every slot auto-plays its configured queue when its BT device connects. Correct for the four `musiCozy` headsets (private, personal — kid puts headset on, music starts). Wrong for slot 5, the 10-SYNC speaker bulb in bedroom 1 (public, shared room speaker — turning on the bedroom light shouldn't blast music at whoever is in the room).

Three new capabilities required:

1. **Public/private gate** — public devices never auto-play on BT connect.
2. **Scheduled wake** (alarm-clock pattern) — at time T, call HA to power the device on, wait for BT, play a queue. Don't silently fail.
3. **Remote-command API** — a `POST /play` HTTP endpoint on the hub that NFC tags / HA automations / scripts can target. Includes interrupt-and-resume on private devices for broadcast announcements.

## Solution Overview

- New `class` field on every device: `private` (default, slots 1-4) or `public` (slot 5).
- New top-level `scheduled:` block in `devices.yml` — one-shot fires (distinct from existing per-device `schedules:` continuous windows).
- New top-level `volume:` cap per device (mpv-side, with BlueZ AVRCP absolute-volume disabled at the system level).
- New `POST /play` endpoint on the hub's web service. Calls flow through the existing `start_playback` machinery with new override-and-resume semantics.
- Hub calls HA via a new `POST /v1/home-automation/ha/call` endpoint we add to DaylightStation (~30 lines).
- Failures route to HA's `notify` service via the same DS endpoint (no Pushover/ntfy in v1).

## Schema Additions to `devices.yml`

```yaml
# DaylightStation integration. Used for queue fetching AND HA service calls.
daylight_station:
  base_url: https://daylightlocal.kckern.net
  ha_call_path: /api/v1/home-automation/ha/call    # endpoint we'll add to DS
  request_timeout_sec: 10
  # auth_token: <bearer>   # reserved; not used in v1 (DS API is LAN-trusted)

queue_base: https://daylightlocal.kckern.net/api/v1/queue/plex/

devices:
  - color: red                             # canonical ID. Must be unique.
    class: private                         # default. Auto-play on BT connect.
    mac: "..."
    schedules: [...]                       # continuous time-window playback (existing)
    volume:                                # optional
      default: 60                          # mpv --volume at spawn
      min: 20                              # VOL- key floor
      max: 75                              # VOL+ key ceiling and /play volume cap

  - color: white
    class: public                          # NEVER auto-play on BT connect.
    mac: "9C:0C:35:75:B7:75"
    ha_entity_id: switch.1_bedroom_main_lights
    ha_turn_off_on_stop: false             # if true, send turn_off after playback ends
    volume:
      default: 40
      max: 70
    # No per-device `schedules:` for public devices. Use top-level `scheduled:`.

scheduled:
  # One-shot fires. Each entry: at time T on matching days, call HA turn_on
  # (if public), wait for BT, play the queue.
  - id: morning-bedroom-wake               # for logging + future referencing
    time: "07:00"
    days: weekdays                         # weekdays | weekends | all | [mon,wed,fri]
    target: white                          # references device.color
    queue: "670208"
    duration_min: 30                       # auto-stop after; omit for indefinite
    volume: 50                             # optional; clamped to target's max
    on_failure: notify                     # notify | log (alert routing)

alerts:
  channels:
    ha_notify:
      service: notify.kc_phone             # called via DS /ha/call endpoint
  on_scheduled_fail:    notify
  on_ha_call_fail:      notify
  on_override_orphan:   log
```

## Component Changes

### 1. `headset-hub.sh`

#### New constants
```bash
SCHEDULE_TICK_INTERVAL=30     # seconds between scheduled-fire checks
BT_WAKE_TIMEOUT=60            # max seconds to wait for BT after HA turn_on
DUPE_FIRE_WINDOW=60           # window in which a scheduled time matches "now"
```

#### `validate_config` (new, called at startup and refresh)
- Color uniqueness — abort with clear error if duplicate
- `class: public` requires `ha_entity_id` — abort if missing
- `volume.max >= volume.default >= volume.min` — abort if violated
- `target` in every `scheduled:` entry must match an existing device color — abort if invalid

#### `class` gate in BT-connect handler
Existing gdbus monitor handler currently calls `fetch_and_cache + start_playback` on every connect. New behavior:
```bash
if device.class == public AND NOT armed_for_play[slot]:
    log "public device connected, not auto-playing (use scheduled or /play)"
    return
```
The `armed_for_play[slot]` flag is set by `fire_scheduled` and by `/play` API just before they trigger.

#### `scheduled_loop` (new background loop, ticks every SCHEDULE_TICK_INTERVAL)
```
for each entry in config.scheduled:
    if today's date matches entry.days
    AND now is within [entry.time, entry.time + DUPE_FIRE_WINDOW]
    AND state[entry.id].last_fired_date != today:
       fire_scheduled(entry)
       state[entry.id].last_fired_date = today
       persist state
```

State persisted in `~/headset-hub/.scheduled-state.json` (atomic write via tmp + mv).

#### `fire_scheduled(entry)`
1. Look up target device by `color`. Refuse if missing.
2. If device is `public` and not BT-connected: call `ha_call_service switch turn_on $ha_entity_id` (with 3-retry backoff). Set `armed_for_play[slot] = entry`.
3. Wait up to BT_WAKE_TIMEOUT for BT to connect (poll D-Bus every 500ms).
4. On connect: existing BT-connect handler sees `armed_for_play`, calls `start_playback` with entry.queue + entry.volume. Clears the armed flag.
5. If duration_min set: schedule auto-stop (recorded in state file; main tick checks for elapsed and calls `stop_playback`).
6. On BT timeout: clear armed flag, log + alert per `on_scheduled_fail`.

#### `ha_call_service(domain, service, entity_id)` (new helper)
```bash
curl -sf --connect-timeout 5 --max-time 10 \
    -X POST -H "Content-Type: application/json" \
    -d "{\"domain\":\"$domain\",\"service\":\"$service\",\"data\":{\"entity_id\":\"$entity_id\"}}" \
    "${base_url}${ha_call_path}"
```
With 3-retry exponential backoff on non-2xx.

#### Override + resume

New functions called by the `/play` endpoint:

`start_override(slot, queue, volume, resume_previous)`:
1. Acquire per-slot flock
2. If mpv alive AND `resume_previous`: capture `playlist-pos`, `time-pos`, `pause` via IPC; write to `slots/N/.override.json`
3. `fetch_and_cache` for the override queue → writes `override.m3u`
4. IPC: `set_property loop-playlist no`
5. IPC: `loadlist override.m3u replace`
6. IPC: `set_property pause false`
7. Optionally apply override volume
8. Spawn `override_watcher` subshell

`override_watcher(slot)`:
- Polls `idle-active` via IPC every 500ms
- When `idle-active == true`, calls `restore_from_override`
- Exits if `.override.json` removed externally or socket disappears

`restore_from_override(slot)`:
1. Read `.override.json`
2. IPC: `loadlist $saved_playlist replace` + `playlist-pos $saved_pos` + `seek $saved_time absolute exact`
3. IPC: `set_property loop-playlist inf` + `set_property pause $was_paused`
4. Restore original volume (default for slot)
5. Delete `.override.json`

#### `stop_playback` extension
- Clear `armed_for_play[slot]` if set
- Delete `.override.json` if present
- For public devices with `ha_turn_off_on_stop: true`: call `ha_call_service switch turn_off ha_entity_id`
- Kill any override_watcher background process for this slot

### 2. `avrcp_dispatch.py`

Today the dispatcher no-ops `KEY_VOLUMEUP`/`KEY_VOLUMEDOWN` so BlueZ's absolute-volume forwarding handles them. New behavior:
- Accepts `--min-volume` and `--max-volume` CLI args
- VOL+ → `add volume $VOL_STEP` clamped to `max`
- VOL- → `add volume -$VOL_STEP` clamped to `min`
- mpv handles the actual clamp via `--volume-max=N` at launch (defense in depth)

### 3. `web.py` (existing :8080 admin server)

New endpoint: `POST /play`
```python
{
  "action": "play" | "stop" | "pause" | "resume" | "next" | "prev",
  "content_id": "670208",            # required for "play"
  "target": "white" | "red,yellow" | "all" | "all-private",
  "volume": 50,                       # optional
  "duration_min": 30,                 # optional
  "resume_previous": true             # default: true for private, false for public
}
```

Response:
```json
{
  "ok": true,
  "targets_applied": ["white"],
  "targets_skipped": [],
  "override": { "saved_for_resume": false }
}
```

HTTP codes:
- 200 success
- 400 bad request (unknown target/action, malformed JSON)
- 409 flock contention on a target (caller can retry)
- 503 DS API unreachable when needed for HA wake

Implementation calls `headset-hub.sh` functions via subprocess OR (cleaner) shares the slot state via JSON sentinel files in `slots/N/` that the main daemon picks up. Will pick approach during implementation phase.

### 4. `/etc/bluetooth/main.conf` change

One-time system change: add under `[General]`:
```
Disable=AbsoluteVolume
```
Then restart `bluetooth.service`. After this, AVRCP volume commands from headsets no longer auto-move the PipeWire BT sink; volume is fully owned by mpv (which `avrcp_dispatch.py` controls).

### 5. DaylightStation addition

Single new endpoint in `backend/src/4_api/v1/routers/homeAutomation.mjs`:

```js
router.post('/ha/call', asyncHandler(async (req, res) => {
  const { domain, service, data } = req.body;
  if (!haGateway) return res.status(503).json({ error: 'HA not configured' });
  if (!domain || !service) {
    return res.status(400).json({ error: 'domain and service required' });
  }
  const result = await haGateway.callService(domain, service, data || {});
  res.json({ ok: true, domain, service, data, result });
}));
```

Uses the existing `haGateway.callService` interface (same as `dscli ha call-service`). No new auth required; LAN-trusted like the rest of the router.

## Resilience & Alerting

| Failure | Detection | Response |
|---------|-----------|----------|
| Scheduled fire missed (script down, schedule misconfigured) | Self-check loop sees `last_fired ≠ today` for a matched-day entry whose time is past + 5 min | Log + `on_scheduled_fail` alert |
| HA call failed (DS down, HA down, network) | curl non-zero or HTTP ≠ 2xx | 3 retries with 2/4/8s backoff. Total fail → log + alert |
| BT never connected after HA turn_on | D-Bus polling returns Connected=false after BT_WAKE_TIMEOUT | Clear armed flag, log + `on_scheduled_fail` alert |
| User toggles light off during wake | BT disconnect handler clears armed + .override.json | Silent abort (user wins) |
| Override fails to restore (mpv IPC error) | `restore_from_override` returns non-zero | Log loud, leave `.override.json` for inspection |
| `/play` flock contention | flock -n returns non-zero | HTTP 409 to caller |
| Bad alarm queue (Plex 404) | fetch_and_cache returns non-zero | Log + alert. Don't power off light — user can navigate manually |

### Alert dispatch

```bash
dispatch_alert(severity, event, message):
    logger -t headset-hub-alert "$severity $event: $message"
    if alerts.on_<event> matches "notify":
        ha_call_service notify $service '{"message":"<event>: $message"}'
```

`notify.<service>` is configured per channel in `alerts.channels`. Hub routes through the same DS `/ha/call` endpoint.

### Self-check loop (new background loop, every 5 min)

1. Missed-scheduled detection (above)
2. Override orphans: `.override.json` older than 1 hour → alert per `on_override_orphan`
3. Stuck armed flags: `armed_for_play` set for > 5 min without successful start_playback → clear + alert

### State durability

- `.scheduled-state.json` — last_fired per scheduled.id, auto-stop pending timers. Atomic write.
- `.override.json` per slot — saved playlist/pos/time/paused
- `armed_for_play` — in-memory only (a bash associative array). On script restart it's empty; the missed-fire self-check catches anything that fired right before the restart.

## Public vs Private Behavior Summary

| Trigger | Private (headset) | Public (bulb) |
|---------|-------------------|---------------|
| BT connect event | Auto-play current queue (today's behavior) | No-op unless `armed_for_play` is set |
| Scheduled fire | Possible but unusual (headsets usually don't need it) | Primary path: HA turn_on → BT wait → play |
| `POST /play` | Override-and-resume (default) | Direct play; sets `armed_for_play` so the BT-connect path completes |
| BT disconnect | Existing stop_playback path (saves position) | Same — also clears armed flag |
| `stop` action | mpv stop | mpv stop + optional HA turn_off |

## YAGNI / Out of Scope

- Per-day quiet hours / blackout windows
- Multiple stacked overrides
- Cross-slot synchronized announcements (each slot just plays independently)
- Auth tokens on `/play` endpoint (LAN-trust v1)
- Pushover / ntfy alerts (use HA notify channels)
- Sunrise alarms (gradual brightness + volume ramp)
- Audit log to disk beyond what journalctl provides
- HA listen-mode (detecting user-driven light toggles to abort in flight) — relies on the implicit BT-disconnect-on-poweroff signal instead

## Testing strategy

- Unit tests on the scheduled-fire decision logic (separate bash function or python helper)
- Integration test: stand up a mock HA endpoint locally, run a scheduled fire end-to-end, verify retry + alert paths
- Manual smoke after deploy: 1-minute scheduled-fire pointing at the bulb, then a `POST /play` with an interrupt-and-resume on red

## Open items deferred to implementation

- `web.py` → `headset-hub.sh` IPC mechanism (subprocess invocation vs. sentinel file vs. add a small Unix socket). Will pick whichever is simplest given web.py's current architecture.
- Exact YAML syntax for time + days when the user wants timezone awareness (assume hub local timezone for v1).
- Whether `/play` action `pause` is a toggle or sets-paused-true (mpv supports both via `cycle pause` vs `set property pause true`).
