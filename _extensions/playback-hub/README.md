# playback-hub — Bluetooth Auto-Play for headsets + BT speakers

**Date:** 2026-03-31
**Status:** Implemented and running
**Platform:** Raspberry Pi 5 (2GB), Raspberry Pi OS (Debian Trixie, 64-bit)

---

## Overview

When a configured Bluetooth headset connects to the Pi, automatically fetch a Plex playlist queue, cache the audio locally, and play it on loop via mpv. Save playback position on disconnect, resume on reconnect. Supports multiple independent headsets with separate queues, optional time-of-day alternate playlists, and per-device resume behavior.

---

## Architecture

```
Bluetooth headset connects
        |
        v
playback-hub.sh (systemd service)
  - monitors gdbus for BT connect/disconnect events
  - on connect: fetches queue from Daylight API, caches mp3s, launches mpv
  - on disconnect: saves position via mpv IPC, kills mpv
  - background refresh loop updates queue every 5 minutes
        |
        v
mpv (headless, per-slot instance)
  - --loop-playlist=inf
  - IPC socket for position queries and playlist reload
  - MPRIS via mpv-mpris plugin (enables AVRCP: play/pause/next/prev from headset)
        |
        v
web.py (systemd service, port 8080)
  - Dashboard: live playback status, play/pause/skip controls
  - Devices: manage configured devices, edit queue URLs
  - Bluetooth: scan, pair, unpair, add devices
```

---

## Files

| File | Purpose |
|------|---------|
| `playback-hub.sh` | Main daemon — BT monitoring, caching, mpv lifecycle, position save/restore |
| `web.py` | Web UI and REST API — pure Python 3 stdlib, no dependencies |
| `devices.json` | Device config — maps BT MAC to queue URL and slot number |

### Runtime files (on the Pi, not in repo)

```
~/playback-hub/
├── devices.json
├── playback-hub.sh
├── web.py
└── slots/
    └── <N>/
        ├── cache/          # Downloaded mp3 files
        │   └── <plex_id>.mp3
        ├── state.json      # {"track": 0, "position": 1234.5}
        ├── playlist.m3u    # Generated from API, doubles as offline cache
        ├── mpv-socket      # Unix socket for mpv IPC
        └── mpv.pid         # mpv process ID
```

---

## Configuration

### devices.json

```json
[
  {
    "slot": 1,
    "mac": "41:42:3A:E5:43:07",
    "name": "musiCozy",
    "queue": "https://daylightlocal.kckern.net/api/v1/queue/plex/default",
    "shuffle": false,
    "schedules": [
      {
        "start": "07:00",
        "end": "19:00",
        "queue": "https://daylightlocal.kckern.net/api/v1/queue/plex/day",
        "shuffle": true
      },
      {
        "start": "19:00",
        "end": "07:00",
        "queue": "https://daylightlocal.kckern.net/api/v1/queue/plex/night",
        "shuffle": true
      }
    ],
    "resume_queue": true,
    "resume_track": true
  }
]
```

Each entry maps a Bluetooth device to a Plex playlist queue. The `slot` determines the subfolder under `slots/`. Multiple devices play independently with separate mpv instances.

Optional fields:

| Field | Default | Meaning |
|------|---------|---------|
| `shuffle` | `false` | Shuffle the fallback `queue` before writing `playlist.m3u` |
| `schedules` | `[]` | Ordered list of time-window queue rules; first matching entry wins |
| `resume_queue` | `true` | Resume the saved playlist index on reconnect |
| `resume_track` | `true` | Resume the saved track position on reconnect |

Each `schedules` entry supports:

| Field | Default | Meaning |
|------|---------|---------|
| `start` | empty | Start of the active window in `HH:MM` 24-hour local time |
| `end` | empty | End of the active window in `HH:MM` 24-hour local time |
| `queue` | required | Queue URL to use during that window |
| `shuffle` | `false` | Shuffle that queue before writing `playlist.m3u` |

Resume examples:

- `resume_queue: true`, `resume_track: true` — continue the same track at the saved timestamp
- `resume_queue: true`, `resume_track: false` — keep the same playlist item, restart that track from the beginning
- `resume_queue: false`, `resume_track: false` — restart from the beginning of the queue every time

Time-of-day queue behavior:

- If `schedules` is empty, the device uses the fallback `queue`
- `schedules` is ordered; the first matching window wins
- Overnight windows are supported, for example `19:00` to `07:00`
- If a schedule entry omits both `start` and `end`, it acts as an always-on catch-all
- Legacy `alternate_*` fields are still accepted for backward compatibility, but `schedules` is the preferred format

### Adding a new device

1. Put the headset in pairing mode
2. Open the web UI (http://<pi-ip>:8080) > Bluetooth tab
3. Scan > Pair the device
4. Click "Add" on the paired device, enter the queue URL
5. Service restarts automatically

Or manually:
```bash
bluetoothctl scan on        # find the MAC
bluetoothctl pair XX:XX:... # pair
bluetoothctl trust XX:XX:.. # trust for auto-reconnect
# Edit devices.json, add entry
systemctl --user restart playback-hub.service
```

---

## Queue API Contract

The `queue` URL must return JSON in this format:

```json
{
  "items": [
    {
      "contentId": "plex:595102",
      "title": "Felix Lullabye",
      "mediaUrl": "/api/v1/proxy/plex/stream/595102"
    }
  ]
}
```

- `contentId`: prefixed ID (prefix stripped for cache filename)
- `mediaUrl`: relative path, prepended with API base URL to download
- The stream URL must return a plain audio file (mp3, etc.) — not an HLS stream

### Queue refresh triggers

- On Bluetooth connect (always)
- Every 5 minutes while playing (background loop in playback-hub.sh)
- On next/prev from the web UI (web.py re-fetches before skipping)

---

## Web UI

**URL:** `http://<pi-ip>:8080`

Single-page app, mobile-friendly, dark theme. No build step, no framework — vanilla HTML/CSS/JS inlined in `web.py`.

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Per-slot: connected, playing, track, position, duration |
| `GET` | `/api/devices` | List configured devices |
| `POST` | `/api/devices` | Add device `{name, mac, queue, shuffle?, schedules?, resume_queue?, resume_track?}` |
| `PUT` | `/api/devices/<slot>` | Update any device config field |
| `DELETE` | `/api/devices/<slot>` | Remove device |
| `POST` | `/api/playback/<slot>/<action>` | `toggle`, `play`, `pause`, `next`, `prev` |
| `GET` | `/api/bt/scan` | Scan + list all BT devices with paired/configured status |
| `GET` | `/api/bt/paired` | List paired BT devices |
| `POST` | `/api/bt/pair` | Pair + trust `{mac}` |
| `POST` | `/api/bt/unpair` | Untrust + remove `{mac}` |
| `POST` | `/api/service/restart` | Restart playback-hub.service |

---

## Dependencies

Installed on the Pi via apt:

| Package | Purpose |
|---------|---------|
| `mpv` | Audio playback (headless) |
| `mpv-mpris` | MPRIS D-Bus plugin for AVRCP (headset buttons) |
| `jq` | JSON parsing in bash |
| `socat` | Communication with mpv IPC socket |
| `curl` | API requests and file downloads |
| `python3` | Web UI server (stdlib only) |

Pre-installed (Raspberry Pi OS):
- PipeWire + WirePlumber (audio routing)
- BlueZ (Bluetooth stack)
- gdbus (D-Bus monitoring)

---

## Systemd Services

Both are user-level services (no root required):

### playback-hub.service

```ini
[Unit]
Description=MusiCozy auto-play on Bluetooth connect
After=pipewire.service wireplumber.service bluetooth.target

[Service]
Type=simple
ExecStart=/home/kckern/playback-hub/playback-hub.sh monitor
ExecStop=/home/kckern/playback-hub/playback-hub.sh stop
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

### playback-hub-web.service

```ini
[Unit]
Description=MusiCozy Web Interface
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/kckern/playback-hub/web.py
Restart=on-failure
RestartSec=5
WorkingDirectory=/home/kckern/playback-hub

[Install]
WantedBy=default.target
```

### Management

```bash
# Status
systemctl --user status playback-hub playback-hub-web

# Restart
systemctl --user restart playback-hub playback-hub-web

# Logs
journalctl --user -u playback-hub -f
journalctl --user -u playback-hub-web -f
```

---

## Offline Mode

Audio files are cached in `slots/<N>/cache/<plex_id>.mp3`. The playlist file `playlist.m3u` points to local cached files. If the API is unreachable on connect, the script falls back to the existing playlist and cache. Fully functional without network after initial cache.

---

## AVRCP (Headset Buttons)

Play/pause/next/prev buttons on the headset work via the AVRCP > MPRIS bridge:

```
Headset button press
  → AVRCP over Bluetooth
  → BlueZ
  → WirePlumber MPRIS bridge
  → org.mpris.MediaPlayer2.mpv on D-Bus
  → mpv responds
```

Requires `mpv-mpris` package installed.

---

## Deployment

```bash
# Copy files to Pi
scp playback-hub.sh web.py devices.json kckern-pi:~/playback-hub/

# Install deps (first time)
ssh kckern-pi "sudo apt install -y mpv mpv-mpris jq socat"

# Set up services (first time)
ssh kckern-pi "mkdir -p ~/.config/systemd/user"
# Copy service files (see Systemd Services above)
ssh kckern-pi "systemctl --user daemon-reload && systemctl --user enable --now playback-hub playback-hub-web"
```
