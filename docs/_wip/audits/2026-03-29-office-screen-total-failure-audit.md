# Office Screen Total Failure Audit

**Date:** 2026-03-29
**Severity:** Critical — all office screen subsystems non-functional
**Device:** `office-tv` (Linux PC, Brave/Chrome 145 on kckern-server)

---

## Incident Summary

The office screen triggered its morning program (`office-program`) at ~07:22 UTC but failed to play content. Investigation revealed **every subsystem** is broken: HTTP API fetches, WebSocket connectivity, MIDI/piano overlay, and content playback. The failures are not isolated bugs — they share a common root cause in the network path between the browser and the backend.

---

## Failure Inventory

### 1. Content Playback — FAILED

**Symptom:** `playback.queue-init-failed: "Failed to fetch"` for `contentRef: "office-program"`

**Timeline (07:22–07:23 UTC):**
1. Backend wake-and-load succeeded — TV powered on (retry needed, first attempt timed out on `binary_sensor.office_tv_power`), monitor powered on
2. WebSocket delivered `load` command on topic `office` to browser
3. Frontend received WS command → `commands.content` fired → `media:queue` action with `contentRef: "office-program"`
4. `useQueueController.js:111` called `DaylightAPI('api/v1/queue/office-program')` → network-level `TypeError: Failed to fetch`
5. Player stuck on "Starting..." overlay for 30s → `player-no-source-timeout` at `queueLength: 0`

**Repeated at 14:36 UTC** when numpad key 1 was pressed (manual retry). Same failure.

**Verification:** `curl http://localhost:3111/api/v1/queue/office-program` returns 200 with 9 items. The endpoint is healthy.

**Root:** `DaylightAPI` uses `window.location.origin` (`https://daylightlocal.kckern.net`) as base URL. The browser's fetch to this origin fails at the network level (see Root Cause below).

**Code path:** `frontend/src/modules/Player/hooks/useQueueController.js:109-112`

---

### 2. HTTP API Fetches — ALL FAILED

**Symptom:** Every `fetch()` from the office browser fails with `TypeError: Failed to fetch`

**Affected endpoints (observed in logs):**
| Endpoint | Component | Log Event |
|----------|-----------|-----------|
| `/api/v1/queue/office-program` | `useQueueController` | `playback.queue-init-failed` |
| `/api/v1/home/weather` | `ScreenDataProvider` | `screendataprovider.fetch-failed` |
| `/api/v1/entropy/report` (inferred) | Entropy panel | `Failed to fetch entropy report` |
| `/api/v1/home/keyboard/officekeypad` | `OfficeApp` | (no explicit error log, but keyMap would be null) |

**Impact chain:**
- `keyMap` and `playbackKeys` remain null → `OfficeApp.jsx:294` condition `queue.length && keyMap && playbackKeys` can never be true → Player cannot render even if queue loads later
- Weather widget shows stale/no data
- Entropy panel fails silently
- `ScreenDataProvider` has no retry logic — failed sources stay failed until page reload

**Code path:** `frontend/src/lib/api.mjs:36` — `fetch()` with no timeout, no retry, no error recovery

---

### 3. WebSocket — STALE ON ALL CLIENTS

**Symptom:** `[WebSocketService] Connection stale (no data in 45s), forcing reconnect` — repeating every 45–60s on both Chrome and Firefox

**Affected clients:**
| User-Agent | Client | Behavior |
|------------|--------|----------|
| Chrome/145 (X11 Linux) | Office kiosk (Brave) | Stale every ~45s, WS errors (`{"isTrusted": true}`) |
| Firefox/148 (X11 Linux) | Fitness app (same host) | Stale every ~45s, continuous reconnect |
| Chrome/146 (Macintosh) | MacBook browser | Stale every ~45s |

**All three clients** experience identical staleness. This rules out a browser-specific bug — the problem is upstream (NPM proxy or backend WS server).

**WebSocket Error at 14:40:09:**
```json
{"level":"error","event":"console.error","data":{"args":["[WebSocketService] Error:",{"isTrusted":true}]}}
```
`isTrusted: true` means a genuine browser network error event, not a script-generated error. The WebSocket connection is being severed by the network layer.

**Backend health:** `curl http://localhost:3111/api/v1/health` returns `{"ok":true}` with 16+ hours uptime. The backend WS server is running.

**Mechanism:**
- Backend pings every 30s (`WebSocketEventBus.mjs:88`)
- Frontend expects any message within 45s (`WebSocketService.js:184`)
- If no message → force close → `_scheduleReconnect()` → reconnect tier escalates
- At tier 6 (1min delay), degraded mode activates
- After 3min in degraded mode, auto-reload triggers → explaining the page reload at 15:30:52

**Code paths:**
- Backend ping: `backend/src/0_system/eventbus/WebSocketEventBus.mjs:88-94`
- Frontend stale check: `frontend/src/services/WebSocketService.js:181-189`
- Auto-reload: `frontend/src/services/WebSocketService.js:40`

---

### 4. MIDI / Piano Overlay — NOT FUNCTIONAL

**Symptom:** Zero MIDI events in the last 60+ minutes of logs.

**Root causes (two independent failures):**

#### 4a. MIDI Bridge Not Running

No `midi-recorder` or `auto_midi_recorder.py` process found on the host:
```
ps aux | grep -i midi | grep -v grep → (empty)
```

The Python MIDI recorder (`_extensions/piano/recorder/auto_midi_recorder.py`) is the bridge between the physical keyboard and the backend WebSocket. Without it running, no MIDI events are captured or broadcast.

**Expected:** The recorder should be running as a systemd user service or LaunchAgent, connecting to `ws://localhost:3111/ws` (or configured host/port), subscribing to USB MIDI input, and broadcasting `note_on`/`note_off`/`session_start`/`session_end` events on topic `midi`.

**Impact:** Even if all other subsystems were working, the piano overlay would never trigger because no `session_start` or `note_on` events arrive via WebSocket.

#### 4b. WebSocket Delivery Broken (Even If Bridge Were Running)

Even if the MIDI bridge were sending events to the backend, the office browser's WebSocket connection is stale (see section 3). MIDI events broadcast by the backend would not reach the frontend.

**Piano overlay trigger path (all broken):**
```
Physical keyboard
  → MIDI bridge (NOT RUNNING)
    → Backend WS broadcast on topic "midi"
      → NPM reverse proxy (STALE/BROKEN)
        → Frontend WebSocketService (RECONNECTING)
          → useMidiSubscription hook
            → OfficeApp handleMidiEvent
              → setShowPiano(true)
```

**Code paths:**
- MIDI subscription: `frontend/src/modules/Piano/useMidiSubscription.js:120`
- Piano auto-show: `frontend/src/Apps/OfficeApp.jsx:202-235`
- MIDI bridge: `_extensions/piano/recorder/auto_midi_recorder.py`

---

### 5. Transport Capability Missing

**Symptom:** `playback.transport-capability-missing: {"capability": "getMediaEl", "delayMs": 2064}`

This fires ~2s after a play command, indicating the player's `<video>`/`<audio>` element hasn't mounted yet. In normal operation, the media element mounts within the first second. The 2s delay suggests the Player component is stuck waiting on preconditions (`keyMap`, `playbackKeys`) that never resolve due to failed HTTP fetches.

---

## Root Cause Analysis

### Primary: NPM Reverse Proxy Disrupting Browser ↔ Container Traffic

All browser traffic from `https://daylightlocal.kckern.net` flows through:
```
Browser (Brave on kckern-server)
  → DNS: daylightlocal.kckern.net → CNAME daylightlocal.duckdns.org → 10.0.0.10
  → TCP to 10.0.0.10:443 (this machine's own IP)
  → NPM container (172.18.0.65) — Nginx Proxy Manager
  → daylight-station container (172.18.0.67:3111)
```

**Evidence:**
- `curl` from the host command line through the same path works (1.3–2.6s response times)
- One test via natural DNS resolution took **24 seconds** (vs 2.4s when resolved directly to NPM IP)
- `host daylightlocal.kckern.net` showed `communications error to 127.0.0.53#53: timed out` before eventually resolving
- Only **1 ESTABLISHED TCP connection** from NPM to daylight-station visible in `netstat`, despite multiple browser clients

**Likely NPM issues:**
1. **WebSocket proxy_read_timeout too low** — Nginx default is 60s, but with 30s backend pings, any jitter could cause timeouts. Should be 300s+ for WebSocket.
2. **Connection pooling** — NPM may be reusing a single upstream connection for multiple clients, causing head-of-line blocking or connection state confusion
3. **Intermittent DNS resolution failures** — systemd-resolved on the host showed transient timeouts to `127.0.0.53`, which could cause Brave's DNS lookups to fail sporadically

### Secondary: MIDI Bridge Process Not Running

Independent of the network issues. The Python MIDI recorder service is not running, so no MIDI events enter the system at all.

### Contributing: No Resilience in Frontend

The frontend has no retry logic for failed HTTP fetches (`api.mjs`), no timeout on `fetch()`, and `ScreenDataProvider` silently swallows errors. A single failed request during a bad network moment permanently breaks the component until page reload.

---

## Affected Components Map

```
┌─────────────────────────────────────────────────────┐
│ Office Browser (Brave/Chrome 145)                   │
│                                                      │
│  OfficeApp.jsx                                       │
│  ├── DaylightAPI('api/v1/home/keyboard/officekeypad')│ ← FETCH FAILS
│  ├── DaylightAPI('api/v1/home/weather')              │ ← FETCH FAILS
│  ├── WebSocketProvider (topics: office, playback...) │ ← WS STALE
│  │   └── useQueueController                          │
│  │       └── DaylightAPI('api/v1/queue/...')          │ ← FETCH FAILS
│  ├── useMidiSubscription (topic: midi)               │ ← NO EVENTS
│  ├── ScreenDataProvider                              │ ← FETCH FAILS
│  └── Player                                          │ ← NO SOURCE
│                                                      │
│  WebSocketService.js                                 │
│  └── wss://daylightlocal.kckern.net/ws               │ ← STALE/ERROR
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS + WSS
                   ▼
┌──────────────────────────────┐
│ NPM (172.18.0.65)           │ ← BOTTLENECK
│ proxy_pass → 172.18.0.67    │
└──────────────────┬───────────┘
                   │ HTTP + WS
                   ▼
┌──────────────────────────────┐
│ daylight-station (3111)      │ ← HEALTHY
│ API: 200 OK, WS: ping/30s   │
└──────────────────────────────┘

┌──────────────────────────────┐
│ MIDI Bridge                  │ ← NOT RUNNING
│ _extensions/piano/recorder/  │
│ auto_midi_recorder.py        │
└──────────────────────────────┘
```

---

## Remediation

### Immediate

1. **Restart MIDI bridge** — Start `auto_midi_recorder.py` on the host (or set up systemd service to auto-start)
2. **Reload office browser** — The degraded-mode auto-reload may have already done this (frontend-start at 15:30:52), but verify the page is functional
3. **Check NPM WebSocket settings** — Ensure the `daylightlocal.kckern.net` proxy host has:
   - WebSocket support enabled (toggle in NPM UI)
   - `proxy_read_timeout 300s` or higher in custom Nginx config

### Short-Term Code Fixes

4. **Add fetch timeout to `DaylightAPI`** — Currently hangs indefinitely. Add `AbortController` with 10s timeout:
   ```javascript
   // api.mjs
   const controller = new AbortController();
   const timeout = setTimeout(() => controller.abort(), 10000);
   const response = await fetch(url, { ...options, signal: controller.signal });
   clearTimeout(timeout);
   ```

5. **Add retry logic to critical fetches** — `useQueueController` and `OfficeApp` keyboard map fetch should retry 2–3 times with backoff on network errors

6. **ScreenDataProvider error recovery** — Re-attempt failed sources on next refresh interval instead of permanently giving up

### Longer-Term

7. **Bypass NPM for local traffic** — The office browser is on the same machine as the Docker container. It shouldn't need to go through DNS → NPM → container. Options:
   - Use `http://localhost:3111` directly for the kiosk browser
   - Add `/etc/hosts` entry: `127.0.0.1 daylightlocal.kckern.net`
   - Configure Brave with a direct proxy for local domains

8. **MIDI bridge systemd service** — Ensure the recorder auto-starts on boot and restarts on failure:
   ```ini
   [Service]
   ExecStart=/path/to/venv/bin/python3 auto_midi_recorder.py
   Restart=always
   RestartSec=5
   ```

9. **WebSocket health monitoring** — The backend should log when client subscriptions go to zero on the `office` topic, as an early warning that the kiosk has lost connectivity

---

## Key Files Referenced

| File | Role |
|------|------|
| `frontend/src/Apps/OfficeApp.jsx` | Office screen entry point, keyboard/weather fetch, piano overlay trigger |
| `frontend/src/lib/api.mjs` | `DaylightAPI()` — HTTP client, no timeout/retry |
| `frontend/src/services/WebSocketService.js` | WS client — stale detection, reconnection, subscription sync |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Queue fetch and initialization |
| `frontend/src/modules/Piano/useMidiSubscription.js` | MIDI event subscription and state management |
| `frontend/src/screen-framework/data/ScreenDataProvider.jsx` | Declarative data fetching for screen widgets |
| `frontend/src/lib/OfficeApp/websocketHandler.js` | WS message → content/playback action dispatch |
| `backend/src/0_system/eventbus/WebSocketEventBus.mjs` | Backend WS server — ping/pong, topic broadcast |
| `_extensions/piano/recorder/auto_midi_recorder.py` | MIDI bridge — USB keyboard → WS broadcast |
| `_extensions/piano/recorder/midi_ws_broadcaster.py` | WS client for MIDI bridge — reconnection, queuing |
