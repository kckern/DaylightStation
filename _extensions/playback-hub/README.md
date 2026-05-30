# playback-hub — Bluetooth Auto-Play for headsets + BT speakers

**Status:** Running on `kckern-playback-hub` (Ubuntu mini-PC, 10.0.0.109)
**Last reviewed:** 2026-05-28

---

## Overview

When a configured Bluetooth headset/speaker connects to the hub, the daemon fetches its assigned Plex playlist queue, caches the audio locally, and plays it on loop via mpv into a dedicated per-device PipeWire bluez sink. Saves playback position on disconnect, resumes on reconnect. Supports five independent slots, time-of-day alternate queues, scheduled "fire" events, REST control, and AVRCP headset-button forwarding to mpv.

Renamed from `headset-hub` to `playback-hub` on 2026-05-27 to reflect that the rig now drives non-headset BT outputs too (10-SYNC speaker bulb in slot 5).

---

## Architecture

```
Bluetooth device connects (red/yellow/green/blue headsets, white speaker)
        |
        v
playback-hub.sh (monitor loop, gdbus-based BT watcher)
  - on connect: fetch_and_cache → start_playback
  - on disconnect: end_session in FAST mode → SIGKILL mpv first (no IPC) so the sinkless stream can't migrate onto another headset; resume point comes from watchdog-persisted state.json
  - watchdog persists state.json every 5s (quiet save_position) for fast-kill resume accuracy
  - watchdog respawns mpv if it dies while BT is up
  - scheduled_loop fires queues at configured times
        |
        v
mpv (headless, one per slot, IPC socket)
  - --loop-playlist=inf, --pause=no, --volume=<configured>
  - --audio-device=pipewire/bluez_output.<MAC>.1
  - IPC socket at slots/<N>/mpv-socket for control + position
        |
        v
avrcp_dispatch.py (one per slot)
  - reads evdev from BlueZ's per-device AVRCP input node
  - forwards play/pause/next/prev/volume to mpv via JSON IPC
        |
        v
PipeWire bluez5 sink → BT chip → headset speaker
```

External:
- `web.py` (port 8080): dashboard + REST API for slot control, BT pair/unpair, device config edits, peak-meter audio verification
- `sync_config.sh` (cron): pulls `devices.yml` from DaylightStation Dropbox SSOT every 60s

---

## Cache self-heal tiers

The central cache (`cache/<plex_id>.mp3`, single-writer via `cache_manager.sh`) is kept correct by several background loops, each staggered so they never fire simultaneously:

| Tier | Loop (interval) | What it does |
|------|-----------------|--------------|
| Membership reconcile | `membership_loop` (60s) | Detects when a slot's server-side queue membership/order drifted from what mpv is playing and rebuilds + reloads the playlist (Unit E). |
| HEAD content-change | `head_loop` (60s tick, +30s stagger) | Rolling, **round-robin** HTTP HEAD over the *live* cache set. A bounded batch per tick (`ceil(live / (HEAD_FULL_PASS/MEMBERSHIP_INTERVAL))`, hard-clamped to 12 so it never bursts) spans a full pass in ~`HEAD_FULL_PASS` (900s). If the server's `Content-Length` for a still-cached id changed, the stale file+meta are dropped and re-fetched (`cache.content_changed`). Cursor persists in `.head_cursor` and wraps. |
| Revalidate-on-stall | inside `mpv_watchdog` (5s) | When mpv is alive but `time-pos` has not advanced across two consecutive ticks (~10s) **and is not paused**, the current track is treated as a bad/partial cache file: drop it, `get_cached_path` re-downloads, then `loadlist_replace_preserving_pos` reloads in place (`track.stall` → `cache.revalidate`). Per-id cooldown (`STALL_REVALIDATE_COOLDOWN`, 120s) prevents thrash. Never touches mpv.pid/state.json/respawn — purely additive to the watchdog. |
| Orphan sweep | `sweep_loop` (3600s, +45s stagger) | Ref-counted GC. A file is *live* iff some slot's current `playlist.m3u` references it. Non-live orphans older than `ORPHAN_TTL_DAYS` (7) are deleted; if total cache exceeds `CACHE_MAX_BYTES` (2 GB), non-live files are evicted oldest-atime-first until under cap. The live guard (`grep -qx`) means a referenced file is **never** deleted regardless of age/size. |

---

## Files

| File | Purpose |
|------|---------|
| `playback-hub.sh` | Main daemon — BT monitoring, queue fetch/cache, mpv lifecycle, position save/restore, scheduled fires |
| `web.py` | HTTP server (stdlib only) — dashboard + REST API on port 8080 |
| `avrcp_dispatch.py` | Per-slot evdev → mpv IPC bridge; translates AVRCP button events to mpv commands with volume clamping |
| `peak_meter.py` | `/api/verify/<color>` peak-meter helper — samples pipewire sink monitor port via `pw-cat` |
| `validate_config.py` | Pre-flight validation of `devices.yml` (schema, MAC format, queue URLs) — called from `playback-hub.sh` on every load |
| `sync_config.sh` | Cron-driven rsync of `devices.yml` from DaylightStation SSOT in Dropbox |
| `test_peak_meter.py` | Unit tests for `peak_meter.py` |
| `devices.yml` | Per-instance config — kept in repo as a reference template; production copy lives on the box and in Dropbox SSOT |

### Runtime files (on the hub, gitignored)

```
~/playback-hub/
├── devices.yml             # synced from Dropbox SSOT
├── .devices.runtime.json   # jq-friendly cache of devices.yml
├── .scheduled-state.json   # last-fired timestamps per schedule entry
└── slots/<N>/
    ├── cache/<plex_id>.mp3
    ├── playlist.m3u        # current playback list, paths point at cache/
    ├── state.json          # {"track": 0, "position": 1234.5}
    ├── mpv-socket          # mpv JSON IPC socket
    ├── mpv.pid             # mpv pid (used by stop_playback)
    ├── mpv.log             # mpv stderr
    ├── avrcp.log           # AVRCP dispatcher events
    ├── playback.lock       # per-slot flock guard for start_playback
    └── armed.json          # set by scheduled fire / /api/play — drives is_armed_for_play
```

---

## Configuration

Production config lives at `data/household/config/playback-hub.yml` in the DaylightStation Dropbox SSOT; `sync_config.sh` rsyncs it to the box every 60s. The committed `devices.yml` here is a documentation reference, not a deployment artifact.

### Device schema (per slot)

```yaml
devices:
  - slot: 1                              # 1..5
    color: red                           # human label, used in /api/play targets
    mac: 41:42:3A:E5:43:07
    class: private                       # private | public — gates the speaker bulb
    name: musiCozy
    queue: '674397'                      # fallback queue (Plex ratingKey or url)
    shuffle: false
    resume_queue: false                  # default true
    resume_track: false                  # default true
    volume:                              # optional volume clamps
      default: 50
      min: 0
      max: 60
    schedules:                           # ordered; first matching window wins
      - start: '07:00'
        end: '21:00'
        queue: plex:675465
        shuffle: true
    # For class:public slots only:
    ha_entity_id: switch.1_bedroom_main_lights
```

Notes:
- `queue` accepts a bare Plex ratingKey, a `plex:<id>` prefix, or a full URL. The bare form is expanded to `https://daylightlocal.kckern.net/api/v1/queue/plex/<id>`.
- `class: public` gates playback on a separate "public class enabled" toggle and turns on the linked HA entity when audio is firing.
- A slot can have zero `schedules` (always-on with the fallback `queue`) or any number; the daemon iterates them in order on each refresh and uses the first window currently active.

### Adding a new device

Web UI: `http://10.0.0.109:8080` → Bluetooth tab → Scan → Pair → Add → set queue.

Manually:
```bash
ssh kckern-playback-hub
# Pair via bluetoothctl using the right controller (each headset bonds to one)
echo -e "select <CTRL>\nscan on\npair <MAC>\ntrust <MAC>\nconnect <MAC>\nquit" | bluetoothctl
# Edit devices.yml in Dropbox; sync_config.sh will pull it to the box
```

---

## Bluetooth controllers

The hub has multiple BT controllers (one Intel onboard + several Realtek/Edimax dongles) because Intel + this driver can't sustain more than one A2DP sink. Each headset is bonded to a specific controller; rebinding to a different one requires unpair + re-pair. The daemon doesn't care which controller, but `bluetoothctl` operations must `select <CTRL>` first.

---

## Queue API Contract

The `queue` URL must return JSON in this format:

```json
{
  "items": [
    { "contentId": "plex:595102", "title": "Felix Lullabye", "mediaUrl": "/api/v1/proxy/plex/stream/595102" }
  ]
}
```

The daemon strips the `plex:` prefix to derive the cache filename, prepends the API base URL to `mediaUrl`, and downloads the stream. Files are validated (size + audio content) before being added to `playlist.m3u`.

If the API is unreachable, the daemon falls back to the existing cached `playlist.m3u` — fully functional offline after first cache.

---

## REST API (web.py on :8080)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/status` | Per-slot connected/playing/title/position/duration/volume |
| `GET` | `/api/devices` | List configured devices |
| `POST` | `/api/devices` | Add device |
| `PUT` | `/api/devices/<slot>` | Update device config |
| `DELETE` | `/api/devices/<slot>` | Remove device |
| `POST` | `/api/playback/<slot>/<action>` | `toggle` / `play` / `pause` / `next` / `prev` |
| `POST` | `/api/play` | Remote dispatch from DaylightStation — `{action,target,content_id,volume,duration_min,resume_previous}` (target = color, "all", "all-private", "all-public") |
| `GET` | `/api/verify/<color>` | Peak-meter audio-flow check (sink monitor sample) |
| `GET` | `/api/bt/scan` / `/api/bt/paired` | BT discovery / paired list |
| `POST` | `/api/bt/pair` / `/api/bt/unpair` | `{mac}` |
| `POST` | `/api/service/restart` | Restart the playback-hub daemon |

---

## AVRCP (headset buttons)

Per-slot `avrcp_dispatch.py` listens on the evdev node BlueZ creates for each connected headset (`/dev/input/eventN`) and forwards play/pause/next/prev/volume key events to mpv via the per-slot JSON IPC socket. Volume up/down is clamped to the slot's `volume.min`/`volume.max` from `devices.yml`.

This replaces an earlier `mpv-mpris` D-Bus approach which was unreliable across mpv versions.

---

## Audio flow troubleshooting

### Critical: don't add `--audio-fallback-to-null=yes` or `PIPEWIRE_PROPS=node.dont-reconnect`

This combination silently silences mpv. On any transient pipewire sink hiccup (which happens normally during BT transport setup), mpv falls back to the null AO and stays silent forever. Status will keep reporting `playing=1` and time-pos will advance because mpv is decoding into the void. The TX bytes on the BT controller will still climb at ~47 KB/s but the actual SBC payload is silence.

A "LANE GUARDRAIL" cleanup added these flags + a disconnect-time `ao-mute=true` IPC write to prevent a sub-second audio bleed window between BT teardown and mpv kill. The cure was worse than the disease — all four headsets went silent. Reverted on 2026-05-28.

### The bleed window: now closed by fast-kill, not by muting

Accepting the bleed window turned out to be wrong — the window is **not** sub-second. On disconnect, `stop_playback` used to run `save_position` (a live mpv IPC round-trip) and then a *graceful* SIGTERM, and orphaned mpvs were observed surviving for minutes. With the bluez sink gone but mpv still alive, PipeWire migrates the orphaned stream onto whatever sink remains — so a disconnecting headset's audio piles onto another *connected* headset (observed: green + blue piling onto yellow).

Fix (2026-05-28, no flags, no IPC mute): the BT-disconnect path calls `end_session … fast` → `stop_playback … fast`, which **SIGKILLs mpv first, before any IPC**, slamming the migration window shut. Resume accuracy is preserved by the `mpv_watchdog` loop, which now persists `state.json` every `WATCHDOG_INTERVAL` (5s) via a quiet `save_position`; the fast path reads that instead of doing a live IPC save against a dead sink. Graceful stops (scheduled window-end, `/play stop`, shutdown) keep the accurate live IPC save since their sink is still alive.

### The mute IPC also persists into fresh mpvs

Sending `ao-mute=true` via mpv IPC just before killing mpv can race the *new* mpv's socket on reconnect. The new mpv comes up already muted with no log indication. If you ever bring back any disconnect-time IPC, make sure the OLD socket is gone *before* the new mpv is spawned.

### `/api/verify` peak-meter is a false-negative

`peak_meter.py` calls `pw-cat --record ... --raw` to sample the sink monitor port. The `--raw` flag doesn't exist in `pw-cat` on this pipewire version (1.0.5), so it errors out immediately and the endpoint always returns `audio_flowing: false`. The real signal is: HCI TX bytes climbing at ~40–50 KB/s on the device's controller = SBC audio leaving the chip.

Better verification (until peak_meter is fixed):
```bash
# Sample monitor port WITHOUT --raw (writes wav, then peak-check)
timeout 3 pw-cat --record --target bluez_output.<MAC_UNDER>.1:monitor_FL /tmp/mon.wav 2>&1
python3 -c "
import wave, struct
with wave.open('/tmp/mon.wav') as w:
    f = w.readframes(w.getnframes())
    s = struct.unpack('<'+'h'*(len(f)//2), f)
    print(f'peak={max(abs(x) for x in s) if s else 0}')"
```

### What to check when a slot is silent

1. `curl localhost:8080/api/status` — `bt_connected: true`?
2. `pgrep -af "mpv.*slots/<N>"` — mpv process alive?
3. `echo '{"command":["get_property","time-pos"]}' | socat - ~/playback-hub/slots/<N>/mpv-socket` — time advancing?
4. `echo '{"command":["get_property","ao-mute"]}' | socat - ~/playback-hub/slots/<N>/mpv-socket` — should be `False`
5. `echo '{"command":["get_property","audio-device"]}' | socat - ~/playback-hub/slots/<N>/mpv-socket` — should match `pipewire/bluez_output.<MAC>.1`, not `null`
6. `busctl --system get-property org.bluez /org/bluez/hci<X>/dev_<MAC>/sep1/fdN org.bluez.MediaTransport1 State` — should be `"active"` (transport path varies; find it via `busctl --system tree org.bluez`)
7. `hciconfig hci<X>` — TX bytes climbing at ~40–50 KB/s
8. RSSI: `hcitool rssi <MAC>` — anything worse than ~-65 dBm and through-floor BT may be dropping payloads

If 1–7 look good and you still hear nothing, check the headset's hardware volume button. Some MusiCozy models start at vol 0 after re-pair and the AVRCP absolute-volume sync is one-way (transport `Volume` property is read-only from BlueZ's perspective on these devices).

---

## Dependencies

System packages:
```
mpv jq socat curl python3 python3-yaml gstreamer1.0-tools
pipewire wireplumber pipewire-pulse bluez
```

`pipewire-pulse` is required because the daemon uses `pipewire/bluez_output.X.1` as mpv's audio-device target; this name is resolved via mpv's pipewire AO (no Pulse compat needed at runtime, but it's installed by default with PipeWire on Ubuntu).

---

## Deployment

Source of truth is this repo (`_extensions/playback-hub/`). Deploy via rsync to `kckern@10.0.0.109:/home/kckern/playback-hub/`. There is no systemd unit at present — the daemon is started by hand:

```bash
ssh kckern@kckern-playback-hub \
  'cd /home/kckern/playback-hub && nohup setsid bash playback-hub.sh monitor > /home/kckern/hub.log 2>&1 < /dev/null & disown'
```

`web.py` is also started manually (port 8080). TODO: add user-mode systemd units for both.

---

## Memory notes (for future you)

- See `~/.claude/projects/-Users-kckern-Documents-GitHub-DaylightStation/memory/reference_playback_hub_extension.md` for the deployment overview.
- See `~/.claude/projects/.../memory/reference_playback_hub_admin.md` for the DaylightStation admin UI bounded context.
- Audio bug story (silent mpv after the "lane guardrail" refactor) is captured in this README's troubleshooting section above. Don't repeat that mistake.
