# ADB (Android Debug Bridge) Integration

ADB provides low-level command-line control of Android devices over the network. DaylightStation uses it as a **fallback recovery mechanism** when the primary content control adapter (Fully Kiosk Browser REST API) becomes unreachable — typically after a crash, OOM kill, or forced restart.

**Android docs:** [ADB overview](https://developer.android.com/tools/adb) | [Developer options](https://developer.android.com/studio/debug/dev-options#enable)

---

## How It Fits

```
Phone: /device/{id}/load
    ↓
Device.loadContent()
    ↓
ResilientContentAdapter.load()
    ├─ Try: FullyKioskContentAdapter  ← HTTP REST to FKB on port 2323
    │       (primary)
    │
    └─ On connection error (ECONNREFUSED / ETIMEDOUT / EHOSTUNREACH):
        └─ AdbAdapter recovery:
            1. adb connect {host}:{port}
            2. adb shell am start -n {launch_activity}
            3. Wait 5s for app boot
            4. Retry FullyKiosk REST
```

ADB is used in two ways:

1. **Lazy MIC release** — During `prepareForContent()`, the FK adapter checks if FKB's mic-blocking background services (`SoundMeterService`, `MotionDetectorService`) are still running via `dumpsys activity services`. Only if detected does it force-stop and relaunch FKB via ADB. This avoids the 10-20s restart penalty on every call when services are already disabled.

2. **Connection-error recovery** — `ResilientContentAdapter` triggers ADB recovery when the primary FK REST API is unreachable (ECONNREFUSED, ETIMEDOUT, EHOSTUNREACH). Application-level errors (bad URL, auth failure) do **not** trigger recovery.

### Fleet diagnostics with `fkb.cli.mjs`

`cli/fkb.cli.mjs` is the fleet-wide operator CLI for any Android device running
Fully Kiosk. Select the device with `FKB_HOST` and supply that device's Fully
password with `FKB_PW`:

```bash
FKB_HOST={device-ip}:2323 FKB_PW=... node cli/fkb.cli.mjs info
FKB_HOST={device-ip}:2323 FKB_PW=... node cli/fkb.cli.mjs adb-connect
FKB_HOST={device-ip}:2323 FKB_PW=... node cli/fkb.cli.mjs adb 'dumpsys input'
```

The CLI derives the ADB target IP from `FKB_HOST`; `FKB_ADB_PORT` overrides the
default ADB port `5555`. Its no-environment default and automatic password
fallback are conveniences for the piano tablet only, not a limitation on which
fleet devices the CLI can manage. Always set both `FKB_HOST` and `FKB_PW` when
targeting a different device.

---

## Configuration

### devices.yml

Add a `fallback` block under `content_control` for any Android device:

```yaml
devices:
  livingroom-tv:
    type: shield-tv
    content_control:
      provider: fully-kiosk
      host: <device-ip>
      port: 2323
      auth_ref: fullykiosk
      fallback:
        provider: adb
        host: <device-ip>        # Device IP (same as FKB host)
        port: 5555              # ADB port (default 5555)
        launch_activity: de.ozerov.fully/.TvActivity
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | Must be `adb` |
| `host` | Yes | Device IP address on LAN |
| `port` | No | ADB TCP port (default: `5555`) |
| `launch_activity` | Yes | Fully qualified Android activity to launch for recovery |

**Common launch activities:**

| App | Activity |
|-----|----------|
| Fully Kiosk Browser (TV) | `de.ozerov.fully/.TvActivity` |
| Fully Kiosk Browser (phone/tablet) | `de.ozerov.fully/.FullyKioskActivity` |

Without a `fallback` block, the device uses the raw FullyKiosk adapter with no recovery.

### How the factory wires it

`DeviceFactory.mjs` reads the config and decides at startup:

1. If `fallback.provider === 'adb'`: creates `AdbAdapter` first
2. Creates `FullyKioskContentAdapter` with the ADB adapter injected (for pre-emptive MIC release)
3. Wraps in `ResilientContentAdapter` with the same ADB adapter (for connection-error recovery)
4. If no fallback: creates raw `FullyKioskContentAdapter` (no ADB)

### The `daylight-android` provider

A kiosk device runs either Fully Kiosk Browser or the DaylightStation Android
kiosk app. `content_control.provider` says which, and switching a device from
one to the other is a change to that one field (and `volume.provider`).

```yaml
devices:
  {device-id}:
    type: tablet
    content_control:
      provider: daylight-android     # or: fully-kiosk
      host: {device-address}
      port: {control-port}           # the app's control API port
      auth_ref: daylight-android     # household auth file, see below
      fallback:                      # optional
        provider: adb
        host: {device-address}
        port: {adb-port}
    volume:
      provider: daylight-android
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | `daylight-android` |
| `host` | Yes | Device address on the LAN |
| `port` | No | Control API port; the client falls back to the app's default |
| `auth_ref` | Yes | Name of the household auth file holding the token |
| `maintenance_ms` | No | How long the Admin console's "maintenance on" leaves the kiosk unlocked before it relocks itself (default 15 minutes) |
| `fallback` | No | An `adb` block. Used for the camera probe and as the reboot fallback only |

**Token.** The household auth file named by `auth_ref` holds one entry per
device id, and the token is read from the entry that matches the device:

```yaml
# household auth file "daylight-android"
{device-id}:
  host: {device-address}
  token: {control-api-token}
```

That file is the only source of the token. A `token:` written into
devices.yml is ignored, and each consumer that meets one logs a warning naming
the device (`deviceFactory.inlineTokenIgnored`,
`arcade.kiosk.inline_token_ignored`, `device.excursion.inline_token_ignored`).

The token is sent as the `X-Daylight-Token` request header. It is never put in
a URL and never logged; request logs carry the route and the names of body and
query fields, not their values. A device with no entry in the file is built
with an empty token and logs `deviceFactory.noAuthToken`; every request to it
then fails as `AUTH_REJECTED`.

**What the factory builds.** `ConfigDeviceBlueprintFactory` creates a
`DaylightAndroidContentAdapter`, and a `DaylightAndroidVolumeAdapter` when the
`volume:` block names the provider. The volume adapter reuses the content
control address and token, so `volume.provider: daylight-android` is refused on
a device whose content control is another provider. An `adb` fallback is handed
to the content adapter directly. `ResilientContentAdapter` is not used: it
recovers by relaunching Fully's activity, and the Android kiosk app restarts
itself through its own control API.

**How it differs from the Fully adapter.** The public methods and the result
fields are the same (`load`, `loadStartUrl`, `getStatus`, `prepareForContent`,
`screenOn`, `screenOff`, `reboot`, `healAudioBridge`, `getMetrics`;
`getStatus().provider` is `daylight-android`). The behaviour behind them is
shorter, because the app confirms what Fully could only acknowledge:

| Operation | Fully Kiosk | Android kiosk app |
|-----------|-------------|-------------------|
| `load` | `loadURL` is acknowledged on receipt; the adapter polls `currentUrl` to verify, or defers that with `verifyAsync` | `POST /kiosk/load` answers after the page's main frame has finished, so a plain load is `verified: true`. With `verifyAsync` the load is sent with `wait:false`, returns on the acknowledgement as `verified: 'async'`, and the outcome is read in the background from `lastLoad` in `GET /kiosk/status`, bounded to 30 s, stopped as soon as a newer load replaces it (`daylightandroid.load.async-superseded`, debug), matched on the `loadId` the acknowledgement returned (on the URL, with a `daylightandroid.load.async-verify-url-fallback` warning, when it returned none), and logged (`daylightandroid.load.async-verified` / `async-unverified` / `async-verify-failed`). Only an unreachable device is retried |
| `prepareForContent` | screen on, foreground-and-poll, disable Fully's motion and acoustic detection, ADB mic check, ADB force-restart when the mic is blocked, relaunch companion apps, camera probe | `POST /screen {on:true}`, `POST /kiosk/foreground`, then for the `full` profile on a device with the `mic-bridge` capability a mic check and bridge restart, then the same ADB camera probe |
| `healAudioBridge` | force-stop and relaunch each companion app | restart the in-app mic bridge when another process holds the mic, or when forced; `companions` is always empty |
| `reboot` | ADB when configured, else Fully's `rebootDevice` | `POST /device/reboot`; a drop or timeout after the request went out counts as the reboot. ADB when the app cannot reboot the device (it needs device owner) or the request never reached it |
| Volume read | parsed out of `deviceInfo` | `GET /volume`, which also reports the hardware index and its maximum |

**Result codes.** `DaylightAndroidRestClient` returns `{ ok: true, data }` or
`{ ok: false, code, error }`, the shape the Fully client returns:

| Condition | `code` |
|-----------|--------|
| HTTP 401 | `AUTH_REJECTED` |
| HTTP 409 | `CONFLICT`: the device is in a state where the command cannot run (no kiosk window, not in front, an update running) |
| HTTP 501 | `UNSUPPORTED` |
| HTTP 502 | `DEVICE_DEPENDENCY_FAILED`: the device answered, and a page or download it depends on failed |
| HTTP 504 | `DEVICE_TIMEOUT`: the device answered, and gave up waiting on a page or download |
| Other HTTP 4xx, or a body with `ok: false` | `COMMAND_REJECTED` |
| Other HTTP 5xx | `HTTP_ERROR` |
| Timeout | `TIMEOUT` |
| Connection refused, no route | `UNREACHABLE` |
| Not JSON where JSON was expected | `INVALID_RESPONSE` |

`getStatus().appVersion` is the shell's version name (`appVersion` on the
app's `/status` route), or the payload version when the shell reports none.

**Other consumers of a kiosk device.** Three more places talk to a kiosk
directly, and each picks its client from the same `provider` field:

| Consumer | Fully Kiosk | Android kiosk app |
|----------|-------------|-------------------|
| Arcade metering, enforcement and supervision ([Arcade game sessions](../gaming/arcade-game-sessions.md)) | `FullyKioskRestClient` | `DaylightAndroidArcadeKioskClient`: foreground from `GET /lockdown`, return to the kiosk with `POST /kiosk/foreground`, announcements with `POST /speak`, and the countdown film through the web overlay (`POST /kiosk/overlay {url, gravity}`, driven by `DaylightAndroidArcadeGameOverlay`) |
| Excursion guard ([Android app launch](../content/android-app-launch.md#excursion-guard)) | `AndroidForegroundProbe` over the ADB fallback | `DaylightAndroidForegroundProbe`: package and activity from `GET /lockdown`, `POST /kiosk/foreground`; no ADB needed |
| Admin console ([Fully Kiosk Admin Console](./fully-kiosk-admin-console.md#devices-on-the-android-kiosk-app)) | `FullyKioskRemoteAdministrationAdapter` | `DaylightAndroidRemoteAdministrationAdapter` |
| Piano screen authority (`piano.screen_power_sync`) | through `deviceService` → the content adapter | the same path: it follows `content_control.provider` with no setting of its own |
| Piano bridge supervisor and MIDI wake (`piano.bridge_supervisor`, `piano.midi_wake`) | the old piano-bridge APK on its own port, unauthenticated; relaunch through `launch-app` | only when the piano app config sets `bridge_provider: daylight-android` (see below) |

**The piano bridge on the Android kiosk app.** The piano tablet's MIDI bridge is
a separate APK under Fully and a capability inside the app on this provider. The
piano app config picks which one the backend talks to with one top-level key:

```yaml
# piano app config
bridge_provider: daylight-android   # default: piano-bridge
```

With `daylight-android`, the bridge supervisor's health probe (`GET /status`),
its speaker actions (`POST /speaker/reconnect`, `/speaker/bt-cycle`) and the MIDI
wake's note socket go to the tablet's control port, with the token header from
the auth file; the supervisor's relaunch becomes `POST /restart` on the app's
lifeline port (`content_control.lifeline_port`, default the control port plus
one), which restarts the payload even while the control port is down. The
address, port and token come from the tablet's `content_control` block, so
`bridge_provider: daylight-android` is refused, with an error naming
`provider-mismatch`, while that block still says `fully-kiosk`. A manual screen-off hold
reaches the app's own note wake the way it reached the old APK: the old APK
got `fkbWakeSuppressUntilEpochMs` by a read-merge-write of its `/config`; the
app gets `POST /settings {key: "power.wakeSuppressUntilSec", value}`, the
deadline in epoch seconds rounded up (0 clears it when the panel is woken on
purpose). Each relay logs `piano-midi-wake.suppress-relayed`, or
`piano-midi-wake.suppress-relay-failed` with the status; the screen authority's
reconcile still holds the screen off either way. The relay times out after
10 s. A hold lasts at most 24 hours (`DeviceScreenControlService`), and only a
hold on the piano tablet itself touches its note wake.

The backend's override is held in memory, so after a backend restart, or a
relay that failed, the tablet could keep a deadline nothing clears. The bridge
supervisor re-syncs it on its first reachable check after boot and on the first
one after a failed relay (`PianoWakeHoldSyncAdapter`): it reads the setting and
writes the backend's `off` deadline, or 0 when the backend holds nothing and the
tablet still holds a future deadline. The value of the backend's hold is read
after the tablet's, so a hold relayed meanwhile wins. A re-sync that fails is
tried again on the next reachable check until one succeeds
(`piano-wake-hold.resynced`, or `piano-wake-hold.resync-failed` each time). A 401 from the
tablet is reported as `unauthorized`, apart from an unreachable bridge: the
supervisor logs `piano-bridge.supervisor.unauthorized` once (no credential in it),
skips the relaunch and the down alert, keeps probing, and logs
`piano-bridge.supervisor.authorized` when a probe succeeds again. Setting the key back, or removing it,
returns both to the old bridge. `bridge_url` and `bridge_supervisor.package` are
used only by `piano-bridge`.

The single-device `KioskAdapter` in the home-control capability (system `kiosk`
app config) speaks Fully's protocol only and is not built when that config
names another provider. It and the tasker adapter call through the system
`HttpClient` the composition root passes in. That legacy adapter puts the
kiosk password in the request URL, which the HTTP client logs; it is dormant
(no `kiosk` app config names a host) and should move onto
`FullyKioskRestClient` before it is ever configured.

A failure also carries `deviceCode`, the device's fixed word for it
(`no_kiosk_activity`, `not_in_foreground`, `not_ready`, `not_installed`, ...).
Some routes still answer HTTP 200 with `ok: false` (a waited load whose page
failed, `/launch`, `/screen`, `/volume`, `/kiosk/overlay`); those come back as
`COMMAND_REJECTED` with the word in `deviceCode`.

**When the kiosk window is not up.** A 409 `no_kiosk_activity` or
`not_in_foreground` means there is no kiosk window to act on, which is a state
and not a refusal:

- `prepareForContent` goes on and reports `kioskWindowUp: false`
  (`daylightandroid.prepareForContent.kioskWindowNotUp`).
- `load` sends the URL again with `wait:false`. The device queues it and shows
  it when the window attaches. The load returns `verified: 'async', queued:
  true` (`daylightandroid.load.queued`) and is verified by `loadId` in the
  background like any other asynchronous load.

**Allowed origins.** The device loads pages only from the start URL's origin
and its `webview.allowedOrigins` setting. A load outside them is refused with
HTTP 400 `origin_not_allowed`. That is configuration, so it is not retried:
`load` returns `code: 'ORIGIN_NOT_ALLOWED'` with a message naming the origin
(never the path or query), and logs one warning,
`daylightandroid.load.originNotAllowed`. The fix is on the device.

**Page bridge availability.** `getStatus()` carries `bridge` (`available` or
`unavailable`), `bridgeReason` and `rendererLosses` from the device. The app
offers `window.daylight` only where the WebView can inject it at document
start; on a device where it cannot, `bridge` is `unavailable` and the page runs
as it would in an ordinary browser (see
[Fully Kiosk JavaScript API](./fully-kiosk-js.md#the-windowdaylight-bridge)).

**Mic bridge restart.** `POST /mic/restart` answering 409 `not_ready` is
retried once after a short pause; any other failure stands.

Log events from these adapters are prefixed `daylightandroid.` (for example
`daylightandroid.rest.response`, `daylightandroid.load.failed`,
`daylightandroid.prepareForContent.micRestarted`).

The Admin console for these devices is described in
[Fully Kiosk Admin Console](./fully-kiosk-admin-console.md#devices-on-the-android-kiosk-app),
and the in-page bridge in
[Fully Kiosk JavaScript API](./fully-kiosk-js.md#the-windowdaylight-bridge).

---

### The `phone-inbox` provider (the household phone app)

Not a kiosk: the phone app has no control API and no socket, so a Play-on send waits
in an inbox the app long-polls (`GET /api/v1/device/<id>/commands`) and is answered
with `POST /api/v1/device/<id>/ack`. Contract: `__docs/reference/media/media-app-technical.md`
§4.12.

```yaml
phone:
  type: phone
  name: Phone
  content_control:
    provider: phone-inbox
```

No host, port or token: the app reaches the backend, never the other way round. Other
keys of the phone's entry (`quick_input`, …) are unaffected.

## Backend Files

| File | Purpose |
|------|---------|
| `__backend/src/1_adapters/devices/AdbAdapter.mjs` | Low-level ADB CLI wrapper (`connect`, `shell`, `launchActivity`, `isProcessRunning`) |
| `__backend/src/1_adapters/devices/ResilientContentAdapter.mjs` | Wraps primary + ADB; triggers recovery on connection errors |
| `__backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Primary content control via FKB REST API |
| `__backend/src/3_applications/devices/services/DeviceFactory.mjs` | Reads config, wires adapters together |
| `__backend/src/1_adapters/devices/DaylightAndroidRestClient.mjs` | Control API client for the Android kiosk app (token header, result codes) |
| `__backend/src/1_adapters/devices/DaylightAndroidContentAdapter.mjs` | Content control via the Android kiosk app |
| `__backend/src/1_adapters/devices/DaylightAndroidVolumeAdapter.mjs` | Stream volume via the Android kiosk app |
| `__backend/src/5_composition/modules/ConfigDeviceBlueprintFactory.mjs` | Selects the adapters for a device from its `provider` fields |

### AdbAdapter API

```javascript
const adb = new AdbAdapter({ host: '<device-ip>', port: 5555 }, { logger });

await adb.connect();                        // adb connect <device-ip>:5555
await adb.shell('input keyevent KEYCODE_WAKEUP');  // Run shell command
await adb.launchActivity('de.ozerov.fully/.TvActivity');  // am start -n ...
await adb.isProcessRunning('de.ozerov.fully');  // Check if FKB is alive
adb.getMetrics();                           // { commands, errors, recoveries }
```

All commands have a 10-second timeout. The adapter tracks metrics (command count, error count, recovery count).
`shell()` automatically reconnects once after a `device not found`, `no devices`
or `offline` response. The initial cold-daemon miss is diagnostic noise, not a
failed operation: it logs at debug, and a successful retry emits
`adb.shell.recovered` at info. A failed reconnect or retry remains an error.

### Play-session observation

The console arcade-game-session observer uses Fully Kiosk's `foregroundApp` as its
primary presence signal and ADB as an independent confirmer. While the emulator
is foregrounded, `pidof` plus `/proc/<pid>/stat` CPU deltas distinguish actual
emulation from a paused or failed core. If Fully Kiosk REST is unavailable, the
observer falls back to `dumpsys window` for the focused package, then applies the
same process/CPU test. An ADB-only observation is labelled `channel: adb`; if
both presence paths fail, the observer publishes `unknown`/`loaded: null` and
accrues nothing.

The AudioBridge companion APK is not a substitute for this channel. Its existing
WebSocket is a single-client microphone stream with no gameplay status or
heartbeat, and connecting a monitor would start capture and displace its real
audio consumer. Any future device-side telemetry must use a separate endpoint
and remain corroborating evidence rather than equating companion liveness with
gameplay.

### ResilientContentAdapter behavior

- Implements the same `IContentControl` interface as `FullyKioskContentAdapter` (`load`, `prepareForContent`, `getStatus`)
- Only triggers recovery on connection errors (`ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH`)
- Recovery sequence: ADB connect → launch activity → wait 5s → retry primary
- Response includes `recovery` field showing whether recovery was attempted and if it succeeded
- `getMetrics()` aggregates primary adapter metrics + recovery stats

---

## Device Setup

### Prerequisites

- The **host running DaylightStation** (Docker container or dev machine) needs `adb` installed
  - Alpine Docker: `apk add android-tools`
  - macOS: `brew install android-platform-tools`
  - Debian/Ubuntu: `apt install adb`
- The Android device must be on the **same LAN** as the host
- ADB TCP debugging must be enabled on the device (see below)

### 1. Enable Developer Options on the Android device

1. Open **Settings**
2. Navigate to **About** (exact path varies by device):
   - Shield TV: Settings > Device Preferences > About
   - Samsung: Settings > About phone > Software information
   - Stock Android: Settings > About phone
3. Tap **Build number** seven times — a toast will confirm "You are now a developer!"
4. Go back to Settings — **Developer options** now appears

### 2. Enable ADB over network

**On Shield TV / Android TV:**

1. Settings > Device Preferences > Developer options
2. Enable **Network debugging** (may also be called "ADB debugging" or "USB debugging")
3. Note the IP address shown (or find it in Settings > Network & Internet)

**On phones/tablets:**

1. Settings > Developer options > **USB debugging** — enable it
2. Connect via USB first, then switch to TCP:
   ```bash
   adb tcpip 5555
   adb connect <device-ip>:5555
   ```
3. Unplug USB — the device now accepts network ADB connections

**On Android 11+ devices:**

Android 11 introduced wireless debugging with pairing codes. Use:
```bash
adb pair <device-ip>:<pairing-port>    # Enter the 6-digit code shown on device
adb connect <device-ip>:<debug-port>
```

### 3. Verify from the DaylightStation host

```bash
# From the machine running the backend (or inside the Docker container)
adb connect <device-ip>:5555
adb devices          # Should show "<device-ip>:5555   device"
adb -s <device-ip>:5555 shell echo ok    # Should print "ok"
```

If `adb devices` shows `unauthorized`, accept the RSA key prompt on the Android device's screen.

### 4. Docker container authentication

The Docker container runs as user `node`. ADB keys live at `/home/node/.android/adbkey[.pub]`. Since the container is rebuilt on deploy, keys must be provisioned from an already-authorized machine.

**One-time setup** (from a machine with authorized ADB access):

```bash
# Copy keys from your local machine to the prod host
scp ~/.android/adbkey ~/.android/adbkey.pub {env.prod_host}:/tmp/

# Copy into the running container and fix ownership
ssh {env.prod_host} '
  docker cp /tmp/adbkey {env.docker_container}:/home/node/.android/adbkey
  docker cp /tmp/adbkey.pub {env.docker_container}:/home/node/.android/adbkey.pub
  docker exec -u root {env.docker_container} chown node:node /home/node/.android/adbkey /home/node/.android/adbkey.pub
'

# Restart ADB server and verify
ssh {env.prod_host} '
  docker exec {env.docker_container} adb kill-server
  docker exec {env.docker_container} adb start-server
  docker exec {env.docker_container} adb connect <device-ip>:5555
  docker exec {env.docker_container} adb -s <device-ip>:5555 shell echo ok
'
```

**Persisting across rebuilds:** Mount the key directory as a Docker volume so keys survive container recreation:

```yaml
# docker-compose.yml
volumes:
  - ./data/adb-keys:/home/node/.android
```

Or copy keys into the image at build time (less flexible but fully self-contained).

**Common issue:** If keys are copied via `docker cp`, they'll be owned by `root`. The `chown node:node` step is required — ADB silently fails to read keys it can't access.

### 5. Persistence

ADB network connections **do not survive device reboots** on most devices. After a reboot, you may need to re-enable network debugging or re-run `adb tcpip 5555`.

Shield TV generally persists network debugging across reboots if the setting stays enabled. Other devices vary.

The `ResilientContentAdapter` calls `adb connect` on every recovery attempt, so a stale connection is re-established automatically.

---

## Use Cases

### Shield TV kiosk (current)

The primary use case. The Shield TV runs Fully Kiosk Browser as a kiosk. FKB occasionally crashes or gets killed by Android's memory manager. When this happens, the FKB REST API becomes unreachable. ADB recovery restarts FKB and retries the content load.

### Wall-mounted tablets

Any Android tablet running Fully Kiosk Browser can use the same setup:

1. Install FKB on the tablet
2. Enable developer options and network debugging
3. Add the tablet to `devices.yml` with `content_control` + `fallback` config
4. Use the tablet's FKB activity name (typically `de.ozerov.fully/.FullyKioskActivity` for non-TV builds)

### Other Android apps

The `launch_activity` field is not limited to FKB. Any Android app can be launched via ADB as a recovery target. Use `adb shell dumpsys activity top` on the device to find the current activity name.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `adb connect` times out | Device not on network, or ADB not enabled | Verify device IP, enable network debugging |
| `adb devices` shows `unauthorized` | RSA key not accepted | Look at the device screen for the authorization dialog, tap "Allow" |
| `adb devices` shows `offline` | Stale connection | `adb disconnect` then `adb connect` again |
| Recovery succeeds but FKB still unreachable | FKB crashed during boot, or wrong activity name | Check `launch_activity` matches installed FKB variant |
| `adb: command not found` | `adb` not installed on host | Install `android-tools` (Alpine) or `android-platform-tools` (macOS) |
| Recovery triggers but content doesn't load | 5s boot wait too short for slow device | Consider a slower device or check FKB startup time |

---

## Logging

Recovery events are logged with the `resilient.*` prefix:

| Event | Level | Meaning |
|-------|-------|---------|
| `resilient.load.primaryFailed` | warn | FKB unreachable, starting ADB recovery |
| `resilient.recovery.start` | info | ADB connect + launch beginning |
| `resilient.recovery.connectFailed` | error | `adb connect` failed |
| `resilient.recovery.launchFailed` | error | `adb shell am start` failed |
| `resilient.recovery.complete` | info | Recovery finished, retrying primary |
| `resilient.load.recoverySuccess` | info | Content loaded after recovery |
| `resilient.load.recoveryFailed` | error | Content still failed after recovery |

Low-level shell recovery also emits:

| Event | Level | Meaning |
|---|---|---|
| `adb.shell.disconnected` | debug | First shell attempt found a cold/offline device |
| `adb.shell.autoReconnect` | info | One reconnect is being attempted |
| `adb.shell.recovered` | info | Reconnect and command retry both succeeded |
| `adb.exec.error` | error | A command ultimately failed or was not a reconnectable miss |

Lazy MIC release events use the `fullykiosk.*` prefix:

| Event | Level | Meaning |
|-------|-------|---------|
| `fullykiosk.isMicBlocked.result` | info | Mic check completed (blocked: true/false) |
| `fullykiosk.isMicBlocked.connectFailed` | warn | ADB connect failed, skipping mic check |
| `fullykiosk.prepareForContent.micBlocked` | info | Mic-blocking services detected, triggering force-restart |
| `fullykiosk.prepareForContent.micClear` | info | No mic-blocking services, skipping force-restart |
| `fullykiosk.prepareForContent.adbForceStop` | info | FKB force-stopped via ADB (ok: true/false) |
| `fullykiosk.prepareForContent.adbRelaunch` | info | FKB relaunched via ADB (ok: true/false) |
| `fullykiosk.prepareForContent.adbRestart.failed` | warn | ADB connect failed during force-restart |

ADB-level events use the `adb.*` prefix:

| Event | Level | Meaning |
|-------|-------|---------|
| `adb.exec.start` | debug | ADB command starting |
| `adb.exec.success` | debug | Command completed |
| `adb.exec.error` | error | Command failed |
| `adb.launchActivity` | info | Activity launch requested |
