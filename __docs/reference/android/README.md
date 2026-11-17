# DaylightStation Android

One Android codebase builds a separate app for each household device from a device
file (`_extensions/daylight-android/devices/<id>.yml`). This page describes how a
built app behaves and how to operate it. Building, adding a device and adding a
capability are covered in `_extensions/daylight-android/README.md`.

## Status: helpers ported, nothing switched

**Nothing here runs a device yet.** Fully Kiosk Browser and the old helper apps
still run all three devices. There is no kiosk, no WebView and no screen control in
this app (phase 3).

**What has been on hardware.** On 2026-11-16 the phase 1 build (shell, payload
loader, control API, lifeline) was installed on the Portal beside the existing
apps; its payload loaded and the control API answered. Reboot survival was not
tested. That is the only hardware fact.

**Phase 2 is complete in the build and has never run on a device.** It copied the
working helper code out of the old helper apps into capabilities, with behavior
unchanged except where "Differences from the old helpers" says otherwise. Every
Bluetooth, MIDI, audio, USB and microphone path is the old code under a new
package, compiled and covered by JVM tests, and unproven in its new process. The
three device builds are:

| Device | Capabilities |
|---|---|
| `piano` | `webview-host`, `debug-tools`, `accessibility`, `synth`, `midi-bridge`, `bluetooth-controls` (roles), `audio-guard` |
| `portal` | `webview-host`, `debug-tools`, `accessibility`, `volume-keys`, `hid-input`, `presence` |
| `shield` | `webview-host`, `debug-tools`, `bluetooth-controls` (gamepad), `mic-bridge`, `lease-gate` |

Phase 3 has begun: every device also lists `webview-host`, the kiosk window. The
other kiosk capabilities (`lockdown`, `screen-power`, `volume`, `app-launcher`, the
rest of `debug-tools`) are not built yet, so a device has no lockdown, no screen
control and no immersive mode from this app, and no start URL is compiled in.

The kiosk page cannot use the helper routes yet: the old helpers answered it on
`localhost` with no token and with `Access-Control-Allow-Origin: *`; the control
port needs the token and sends no CORS headers. How the page reaches the app is a
phase 3 decision.

## Shell and payload

Each app has two parts.

| Part | What it is | How it changes |
|------|------------|----------------|
| Shell | The installed APK: a foreground service, a boot receiver, the payload loader and the lifeline server | Installing a new APK |
| Payload | A jar of dexed classes: the core (settings, auth, router, control server) plus the device's capabilities | Sent over the network through the lifeline; no reinstall |

A copy of the payload is baked into the APK, so a fresh install has one to run.

The shell starts on boot, when its package is replaced, and when the app is opened.
A repeating alarm starts the service again if it is found not running. A force-stop
clears that alarm; nothing in this phase recovers from a force-stop.

The loader protects against a bad payload:

- A fetched payload is activated only when its sha256 matches the one supplied.
- A payload's start runs on the loader's own thread, never the main thread, with a
  20 second deadline. A payload that throws or does not finish in time is marked
  failed (`lastFailed` in the payload status) and the loader goes back to the
  previous one. If that cannot start either, or there is none, it starts the
  payload baked into the APK.
- If the process starts 3 times within 10 minutes on the same payload, the next
  start rolls back before loading it.
- With no stored payload, the loader uses the one baked into the APK.
- A payload whose control port cannot be bound fails its start, so the loader rolls
  back instead of leaving a device with no control API.

Swap, rollback, restart and the start at boot run one at a time on that thread.
A request only queues the work, so the lifeline keeps answering while a payload is
stuck in its start.

**A shell reinstall replaces the running payload.** The shell stores its
`versionCode` beside the payload pointers. On the first start after that number
changes, the new APK's baked payload is extracted as `p0-baked-v<versionCode>.jar`
and made current. The payload that was current, pushed or baked, becomes previous,
so `POST /payload/rollback` brings it back. A reinstall that keeps the same
`versionCode` is not detected and keeps the stored payload.

**Stored names.** A pushed payload is stored as
`p-<first 12 hex characters of its sha256>.jar`, whatever its URL was. Two different
payloads never share a file, pushing the running payload again does not rewrite its
file, and a push can never replace a baked payload.

A device's default settings are checked against the declared settings when the
payload starts. A key in the device file's `defaults:` that no capability declares
makes the payload refuse to start, and the shell falls back.

## Two ports

Both ports are set per device under `control:` in the device file.

| Port | Served by | Purpose |
|------|-----------|---------|
| `control.port` | The payload | The control API: status, settings, capability routes |
| `control.lifelinePort` | The shell | The lifeline: payload status, swap, rollback, restart, shell log |

The lifeline exists because a payload can start and then fail to serve. The process
stays alive, so no crash rollback happens, and the control API is unreachable. The
lifeline is served by the shell and stays up whatever the payload does, so the
payload can still be rolled back or restarted remotely.

Both are plain HTTP on the local network.

## Authentication

Every request to either port must carry the device's token in the
`X-Daylight-Token` header. A missing or wrong token gets `401` with
`{"ok":false,"error":"unauthorized"}`. The token is checked before anything else:
before the route is looked up and before any of the request body is read. A
WebSocket upgrade on the control port needs the token too, in the header or as a
`token` query parameter, and is refused with 401 before the connection is upgraded.

Each device has its own token of at least 32 characters. It is compiled into the
shell at build time from `{private-tokens-file}`, which lives outside the repo.
Rotating a token means installing a new shell.

## Control API

Served by the payload on `control.port`. All responses are JSON.

| Method | Path | Result |
|--------|------|--------|
| GET | `/status` | `device`, `payloadVersion`, `shellVersionCode`, `uptimeMs`, `capabilities`, and the shell's payload status |
| GET | `/capabilities` | Capability names and every registered route |
| GET | `/settings` | Every declared setting: `key`, `type`, `value`, `default`, `overridden` |
| POST | `/settings` | JSON body `{"key": ..., "value": ...}`; stores a runtime override |
| DELETE | `/settings?key=<key>` | Removes the override; the value returns to its default |
| GET | `/debug/info` | From the `debug-tools` capability: `device`, `model`, `sdkInt`, `elapsedRealtimeMs` |
| GET | `/payload` | The shell's payload status, as on the lifeline |
| POST | `/payload` | JSON body `{"url": ..., "sha256": ...}` (or the same two as query parameters); answers `{result}`. The swap runs afterwards |
| POST | `/payload/rollback` | Answers `{result}` |
| POST | `/update` | JSON body `{"url": ..., "sha256": ...}` (`sha256` optional); downloads the APK, checks it, and hands it to the system installer; answers `{state, bytes, sha256Verified, confirming}` |
| GET | `/update` | `state` (`idle`, `downloading`, `awaiting_confirmation`, `failed`) and `lastError` |
| GET, POST | `/beat` | The heartbeat's state; `POST` sends one now and returns its body. The body's `logEventsDropped` counts one-off log events the device gave up on because the log store was not taking them (at most 200 wait at a time; the oldest goes first) |
| GET | `/wifi` | The Wi-Fi link: current sample, recent samples, thresholds. `?fresh=1` samples first |
| GET | `/log` | Recent in-memory events |
| GET | `/crashlog` | The on-disk lifecycle and crash record |
| GET | `/diagnostics` | Time, CPU, device, thermal zones, crash record, and one section per capability |
| POST | `/accessibility/enable` | Enables the app's accessibility service through secure settings |

`/status` also carries `model`, `android`, `package`, `batteryOptExempt`,
`wsClients`, `a11yBound` and whatever each capability contributes.

A swap or rollback the shell refuses answers `409` with `ok: false` and the reason
in both `error` and `result`. A pushed payload larger than 64 MiB is abandoned.

`POST /update` waits for the download. One update runs at a time: a second call
while one is in flight answers `409` with `error: update_in_progress`. An APK
larger than 256 MiB is abandoned.

The APK comes over plain HTTP from an address the caller names, so it is checked
before anything is installed. In this order, and a failed check answers
`ok: false` with the reason in `error`, leaves `state: failed`, and deletes the
download:

1. `sha256`, when the request carries one (body field or query parameter, 64 hex
   characters; anything else is `400` before the download starts). The download
   must hash to it: `sha256_mismatch`.
2. The file must be an APK of this app's own package (`not_an_apk`,
   `wrong_package`), with a `versionCode` at or above the installed one
   (`older_version`).

The install itself needs a tap on the device's confirmation dialog unless the app
is device owner. With `update.autoConfirm` on, the app taps its own dialog through
its accessibility service, **and only for a request that carried a `sha256` which
matched**. A request without one still reaches the dialog, and a person has to
tap it; the answer's `confirming` says which happened. The outcome is written to
the shell log (lifeline `GET /log`).

A confirmed install replaces the running app, so `GET /update` starts again at
`idle` afterwards. An install nobody confirmed (the dialog was dismissed, or the
system refused the APK) does not stay `awaiting_confirmation`: 90 seconds after
the commit `GET /update` reads `state: failed` with `lastError` starting
`not_confirmed`. The downloaded file is deleted as soon as it has been handed to
the installer or refused.

The automatic tap happens only when all of these hold: the request carried a
matching `sha256`; an update this app started
is waiting for confirmation; the window on screen belongs to the system's package
installer (one of its known package names, and a system app); the install session
this app committed still exists, was created by this package and installs this
package; and the dialog names the app's exact label as a whole word. The dialog
does not expose which install session it belongs to, so that link is inferred
from the other conditions. A dialog left alone is recorded in `GET /log` as
`self-update confirmation-withheld <reason>`.

The process has one uncaught-exception handler, installed by the first payload
start and kept across payload swaps. It writes the crash through the running
payload's crash log and then lets the system handle the exception.

A connection that sends nothing for 5 seconds is closed. A WebSocket client stays
connected by answering the server's ping, which is sent every 3 seconds.

Request bodies are read by their `Content-Length` and decoded as UTF-8, for every
method. The limit is 1 MiB (1048576 bytes). A longer body gets `413` and is not
read, and the connection is closed. A chunked body, which has no
`Content-Length`, gets `411`.

`POST /settings` and `DELETE /settings` answer with the setting's value. For a
secret setting they answer as `GET /settings` does: `"(set)"` or an empty string,
never the value.

Errors have the shape `{"ok":false,"error":"<code>", ...}` with a `message` field
(or `reason` for 501):

| Status | `error` | When |
|--------|---------|------|
| 400 | `bad_request` | Unreadable or malformed body, or a missing `key` / `value` |
| 400 | `invalid_setting` | The value does not fit the setting's type |
| 401 | `unauthorized` | Missing or wrong token |
| 404 | `unknown_route` | No route at that path |
| 404 | `unknown_setting` | No capability on this device declares that key |
| 405 | `method_not_allowed` | The path exists, but not with that method |
| 411 | `length_required` | A chunked body, sent without a `Content-Length` |
| 413 | `payload_too_large` | The body is over 1 MiB |
| 500 | `internal` | A handler threw something unexpected |
| 501 | `unsupported` | The capability cannot do this on this device |

No route returns 501 today. The code is reserved for capabilities that run on some
devices and not others.

### WebSocket on the control port

A WebSocket upgrade on any path of `control.port` joins the device's one socket
hub. The upgrade needs the token, in the `X-Daylight-Token` header or as a `token`
query parameter, and is refused with 401 before the connection is upgraded.
Messages are JSON text frames keyed by `type`; one capability owns each inbound
type, and a type registered twice stops the payload from starting.

Each client has its own queue of outgoing frames and its own sending thread, so
the thread that produces a frame (the MIDI thread for a note, the one-second
timer for `status`) never waits on a socket. A client gets its frames in the order
they were produced, each one sent as soon as the one before it is written. A
client that stops reading while frames keep coming fills its queue (512 frames)
and is disconnected; the others are not affected.

| Message | Direction | Owner |
|---|---|---|
| `ready` `{device}` on connect | out | core |
| the text `ping`, answered with `{"type":"pong"}` | in, out | core |
| a WebSocket ping every 3 seconds; a client that does not answer is dropped | out | core |
| `status` every second, with each capability's fields | out | core; `synth` adds `engine`, `preset`, `cpu`, `xruns`; `audio-guard` adds `speakerOk`, `speakerReason` |
| `error` `{code, msg}` | out | core, for the handler that failed |
| `note.on`, `note.off` (live notes, with `t`) | out | `midi-bridge` |
| `midi.raw` | in | `midi-bridge` |
| `engine.start`, `engine.stop`, `preset.load`, `param.set`, `panic`, `note.on`, `note.off` | in | `synth` |
| `key` | out | `volume-keys` |
| `keyboard` | out | `hid-input` |

### Routes by owner

| Owner | Routes |
|---|---|
| core | `GET /status`, `GET /capabilities`, `GET /settings`, `POST /settings`, `DELETE /settings`, `GET /payload`, `POST /payload`, `POST /payload/rollback`, `POST /update`, `GET /update`, `GET /beat`, `POST /beat`, `GET /wifi`, `GET /log`, `GET /crashlog`, `GET /diagnostics`, `POST /accessibility/enable` |
| `debug-tools` | `GET /debug/info` |
| `webview-host` | `GET /kiosk/status`, `POST /kiosk/load`, `POST /kiosk/load-start`, `POST /kiosk/reload`, `POST /kiosk/foreground`, `POST /kiosk/renderer/reset`, `POST /kiosk/restart`, `POST /kiosk/overlay` |
| `synth` | `POST /panic` |
| `midi-bridge` | `POST /connect`, `POST /forget`, `POST /scan`, `GET /midi/tap`, `GET /midi/send`, `POST /midi/send`, `POST /reset`, `GET /loopback`, `POST /loopback`, `POST /tone` |
| `audio-guard` | `GET /speaker`, `POST /speaker`, `POST /speaker/reconnect`, `POST /speaker/bt-cycle`, `POST /audio-guard/bootstrap`, `POST /audio-guard/override`, `POST /audio-guard/volume-check` |
| `bluetooth-controls` | `GET /bluetooth`, `POST /bluetooth/{scan, scan/stop, pair, unpair, connect, disconnect, pairing, power}` |
| `volume-keys` | `POST /accessibility/silence-beep` |
| `hid-input` | `GET /input`, `GET /usb-hid`, `POST /usb-hid/retry`, `POST /usb-hid/config`, `GET /hid/bluetooth`, `GET /hid/bluetooth/diag`, `POST /hid/bluetooth/{scan, bond, scan-direct, gatt-direct, gatt, gatt-disconnect, connect-hid}`, `GET /hid/bluetooth/radio`, `GET /hid/bluetooth/radio/scan` |
| `presence` | `GET /presence` |
| `mic-bridge` | `GET /mic/status`, `POST /mic/restart` |
| `lease-gate` | `GET /lease` |

A route exists only on a device whose build lists its owner; `GET /capabilities`
lists what a device has. Routes ported from the old helpers keep their old bodies:
most answer HTTP 200 with `{"ok":false,"error":"..."}` for a failure.

### Interfaces between capabilities

A capability never calls another capability. Where two must cooperate, one
provides an interface from `core/spi` and the other asks the core for it; a
missing provider is a normal state.

| Interface | Provided by | Used by |
|---|---|---|
| `NoteListener` (on the note bus) | `synth` subscribes | `midi-bridge` publishes each live note |
| `OutputGate` | `synth` | `audio-guard` closes it when sound would leave by the wrong speaker |
| `BluetoothRole` | `midi-bridge` (`midi`), `audio-guard` (`audio`) | `bluetooth-controls`, role mode |
| `PairingDialogExemption` | `bluetooth-controls` | `lockdown` (phase 3) |
| `ScreenPower` | nobody until phase 3 (`screen-power`) | `volume-keys`, which logs `screen-toggle-unavailable` |
| `InputLock` | nobody until phase 3 (`lockdown`) | `volume-keys`, which treats the lock as off |
| `PackageGate` | nobody until phase 3 (`lockdown`, on a device that can have a device owner) | `lease-gate`, which keeps the gate closed |
| `KioskSurface` | `webview-host` | `lockdown`, `screen-power`, `app-launcher`, `debug-tools` (the rest of phase 3): the kiosk window, its page, evaluate and capture |
| `LockdownControl`, `DeviceAdminAccess` | nobody yet (`lockdown`) | `webview-host`: what is in front, recall, reboot support |
| `ScreenControl` | nobody yet (`screen-power`) | `webview-host` for `daylight.screen()`; without it the bridge call answers `false` |
| `VolumeControl` | nobody yet (`volume`) | `webview-host` for `daylight.volume()`; without it the answer is `{}` |
| `AppLaunch` | nobody yet (`app-launcher`) | `webview-host` for `daylight.launch()`; without it the answer is `false` |

Notifications that are not instrument notes go over the core event bus
(`core.events()`), by topic: `screen` `{on}`, `network` `{connected}`, `key`
`{code, action}` and `kiosk-focus` `{focused}`. `webview-host` forwards `screen`,
`network` and `key` to the page as `daylight:` events.

The accessibility service is the `accessibility` capability's shell half; the core
holds the bound service and shares it (`volume-keys`, `hid-input`,
`bluetooth-controls` in role mode, and the update confirmation use it).

## Settings

Settings are typed (`STRING`, `BOOLEAN`, `INTEGER`) and declared by capabilities. A
key that no capability on the device declares does not exist there: reading or
writing it returns `404 unknown_setting`. There is no free-form settings store.

A setting's value comes from three layers. The highest one present wins:

1. **Runtime override.** Set with `POST /settings`, kept on the device, and still
   in effect after a restart or a payload swap. Removed with `DELETE /settings`.
2. **Device default.** From `defaults:` in the device file, fixed at build time.
3. **Capability fallback.** The value the capability declares in code.

`GET /settings` shows the effective `value`, the `default` (layer 2 or 3) and
whether an override is in effect.

Some settings also carry a rule: a fixed set of values (`allowed` in
`GET /settings`) or a number range (`min` and `max`). A value outside the rule is
refused with `400 invalid_setting` when it is set, and a device file whose default
breaks a rule fails the build's tests. Settings with a rule today:

| Key | Rule |
|-----|------|
| `bluetooth.mode` | `roles` or `gamepad` |
| `webview.backButton` | `page`, `reload` or `ignore` |
| `webview.loadTimeoutSec` | 1 to 600 |
| `recovery.reloadOnPageFailureSec`, `recovery.rendererUnresponsiveSec` | 0 to 3600 |
| `recovery.maxRetrySec` | 0 to 86400 |
| `heartbeat.intervalMs` | 10000 to 86400000 |
| `wifi.sampleIntervalMs` | 2000 to 3600000 |
| `keys.doublePressMs` | 150 to 2000 |
| `presence.heartbeatMs` | 5000 to 600000 |
| `midi.scanTimeoutMs` | 1000 to 120000 |
| `midi.reconnectDelayMs` | 250 to 600000 |
| `mic.port` | 1024 to 65535 |

A stored override that no longer fits the setting's type or rule (left by an older
payload, for example) is ignored: the default applies, `overridden` reads false,
and the device log notes the key once. It is never an error at start.

A capability does not fail the payload over a setting value. If it cannot run with
what it reads, it logs that, reports itself unavailable in `GET /status`
(`bluetooth.available` and `bluetooth.error` for `bluetooth-controls`) and the rest
of the payload, the control port included, stays up so the setting can be
corrected.

If a stored setting does stop the payload from starting, the control port is down
and every payload in the store reads the same overrides. Use the lifeline's
`POST /settings/reset` (below): it deletes all stored overrides and starts the
payload on its compiled defaults.

Settings the core declares on every device:

| Key | Type | Fallback | Meaning |
|-----|------|----------|---------|
| `heartbeat.enabled` | boolean | true | Send the outbound heartbeat. Applies at once when changed |
| `heartbeat.intervalMs` | integer | 60000 | Its period; 10 seconds is the minimum. Applies at once when changed |
| `heartbeat.deviceId` | string | empty | The device name in shipped lines; empty means the device id |
| `heartbeat.logStoreUrl` | string | empty | The log store's insert URL; empty ships nothing |
| `heartbeat.backendUrl` | string | empty | A second place the heartbeat is posted; empty for none |
| `logstore.app` | string | empty | `context.app` of every shipped line; empty means `daylight-<device id>` |
| `wifi.telemetryEnabled` | boolean | true | Sample the Wi-Fi link |
| `wifi.sampleIntervalMs` | integer | 10000 | Its period; 2 seconds is the minimum |
| `wifi.degradedRssiDbm`, `wifi.degradedLinkMbps` | integer | -75, 20 | When a sample counts as degraded |
| `accessibility.selfEnable` | boolean | false | Enable the app's accessibility service at each start |
| `update.autoConfirm` | boolean | false | Tap the app's own update dialog |

`debug-tools` declares `debug.execEnabled` (boolean, default false); nothing reads
it yet. `audio-guard` declares `speaker.mac`, `speaker.name` and `speaker.enabled`.

**Secret settings.** `presence.token` and `lease.credential` are secrets. A secret
is a string setting with an empty fallback that differs from the others in three
ways: its value is never returned (`GET /settings`, and the answers to `POST` and
`DELETE`, show `"(set)"` or an empty string); it cannot have a default in a device
file (the payload refuses to start, because device files are public); and so it
exists only as a runtime override, set on the device with `settings set`.

A string default in a device file may hold a `{placeholder}`. It is replaced at
build time from the `placeholders:` map of `{private-tokens-file}`, so addresses
and device identities stay out of the repo. A placeholder with no value fails the
build of that device and names the placeholder, never a value.

## Capabilities

| Capability | Devices | What it does | Settings |
|---|---|---|---|
| `debug-tools` | all | `GET /debug/info` | `debug.execEnabled` |
| `webview-host` | all | The kiosk: a fullscreen WebView, the `window.daylight` page bridge, page-load recovery, the overlay layers | `webview.*`, `recovery.*` |
| `accessibility` | piano, portal | The app's one accessibility service, shared through the core | `accessibility.selfEnable` (core) |
| `synth` | piano | Native sampler | none |
| `midi-bridge` | piano | BLE-MIDI link to the instrument | `midi.*` |
| `audio-guard` | piano | Keeps sound on the configured Bluetooth speaker | `speaker.mac`, `speaker.name`, `speaker.enabled` |
| `bluetooth-controls` | piano, shield | Bluetooth panel for the page | `bluetooth.mode`, `bluetooth.systemPairingDialog` |
| `volume-keys` | portal | Volume keys as page input | `keys.*` |
| `hid-input` | portal | USB keyboards as page input, Bluetooth keyboard diagnostics | none (the USB allowlist is stored on the device) |
| `presence` | portal | Reports connected Bluetooth devices to the backend | `presence.endpoint`, `presence.token` (secret), `presence.heartbeatMs` |
| `mic-bridge` | shield | Microphone PCM over a loopback WebSocket | `mic.port`, `mic.allowNoOrigin` |
| `lease-gate` | shield | Polls for a lease that decides whether one app may run | `lease.endpoint`, `lease.packageName`, `lease.credential` (secret) |

What each ported capability adds to a device that lists it. HTTP routes need the
token like every other route; WebSocket messages are JSON text frames on the
control port, keyed by `type`.

### `webview-host`

The kiosk window. The shell half declares `KioskActivity` (the app's one launcher
entry: a build that lists `webview-host` takes the launcher filter off the shell's
setup Activity) and ships `androidx.webkit`. The Activity decides nothing; it hands
itself to the payload, which builds the WebView in it on the main thread. A payload
swap or restart detaches and re-attaches without the Activity going away, and with
no payload the Activity shows one line of grey text on black.

`webview.startUrl` is the start page. Empty means not configured: the screen says
so, and `GET /kiosk/status` answers `ready:false` with `reason`. The three device
files leave it empty until the household value is supplied (see the comment in each).

| Setting | Default | Meaning |
|---|---|---|
| `webview.startUrl` | empty | Start page, https |
| `webview.bridgeOrigins` | empty | Comma-separated origins given the bridge, the microphone and the camera. Empty means the origin of the start URL |
| `webview.backButton` | `reload` | `reload`, `page` (the page gets `daylight:back`) or `ignore` |
| `webview.interceptKeys` | empty | Key names sent to the page as `daylight:key` and kept from the system, for example `VolumeUp,VolumeDown` |
| `webview.loadTimeoutSec` | 20 | A load not finished by then is stopped and counted as failed |
| `webview.allowMic`, `webview.allowCamera` | true | Grant a page request from an allowed origin, when the app holds the Android permission |
| `webview.allowMixedContent` | false | |
| `webview.debugging` | false | Remote WebView inspection |
| `webview.launchOnBoot` | false | Start the kiosk Activity when the payload starts and none exists |
| `recovery.reloadOnPageFailureSec` | 30 | First retry of a failed page; doubles up to `recovery.maxRetrySec` (300). 0 disables |
| `recovery.reloadOnNetworkReturn` | true | Reload when the network returns, only for a page in a failed state |
| `recovery.rendererUnresponsiveSec` | 30 | End a renderer unresponsive this long; 0 disables |

Origin, bridge, mixed-content and debugging settings are read when the WebView is
built; `POST /kiosk/renderer/reset` applies a change.

Routes, beyond what the control API contract lists:

- Every load has a `loadId`. The waiting answer, the `wait:false` acknowledgement
  and `lastLoad` carry it. `GET /kiosk/status` also has `loading`, `loadingUrl` and
  `loadingId` for a load that has not settled, `errorPage`, and `reason` (null when
  ready).
- A load asked for while no kiosk Activity exists is refused with
  `error:"no_kiosk_activity"`; it is not queued. The app tries to start the
  Activity, which then loads the start URL.
- `POST /kiosk/overlay` has two layers. `{text}` sets the message, `{url, gravity?}`
  the web overlay, an empty value clears that layer, `{}` clears both. Each layer is
  drawn above other apps when `SYSTEM_ALERT_WINDOW` is granted
  (`appops set <package> SYSTEM_ALERT_WINDOW allow`) and inside the kiosk window
  otherwise; the answer says which with `overOtherApps`. A layer that was asked for
  and has nowhere to draw answers `ok:false`, `error:"overlay_not_shown"`. The web
  overlay fills the screen, takes no touch or focus and has no page bridge. Both
  layers are cleared when the payload stops.
- `POST /kiosk/restart` answers and then restarts the payload in place; the kiosk
  Activity stays up and shows "Daylight is restarting…" in between.

The page bridge `window.daylight` is given only to frames of an allowed origin. The
native object behind it is visible to every frame (an Android rule), so it answers
only to a per-WebView token that the allowed frames hold, and only while the main
frame is on an allowed origin.

Not proven until it runs on a device: every WebView behavior above, which
`androidx.webkit` features each device's WebView reports, the overlay windows over
another app, and the vector TV banner on the Shield's home row.

### `synth`

The native sampler (sfizz through Oboe). Its library and the JNI class are in the
installed APK; the engine is created when the app process starts and lives until
the process ends, across payload swaps. List `synth` before `midi-bridge` in a
device file so a key press reaches the sampler before anything else.

| Kind | Name | What it does |
|---|---|---|
| HTTP | `POST /panic` | All notes off; answers `{action: "panic"}` |
| WS in | `engine.start`, `engine.stop` | Open or close the audio stream, and record that the page wants sound |
| WS in | `preset.load` `{spec}` | Load a voice. `spec`: `id`, `engine`, `asset` (a path under the app's `piano-instruments` directory), `patch`, `gain_db`, `transpose`, `tune`, `velocity_curve`, `reverb.mix` |
| WS in | `param.set` `{path, value}` | Set one engine parameter |
| WS in | `panic` | All notes off |
| WS in | `note.on` `{note, velocity}`, `note.off` `{note}` | Play a note the page read itself |
| WS out | `status` every second | `engine` (`running` or `stopped`), `preset`, `cpu`, `xruns` |
| WS out | `error` `{code, msg}` | `no_spec`, `no_engine`, `bad_asset`, `preset_failed`, `no_path` |

`/status` and `/diagnostics` carry `engine` and `preset`. There `engine` has a
third value, `load_failed`, with `engineError` beside it: the native engine could
not be set up in this process (the class of what was thrown, for example
`java.lang.UnsatisfiedLinkError`, or `init_failed`, or `no_engine_component`).
`stopped` means an engine that could play and is idle. The WebSocket `status`
frame keeps its two values. The synth provides the
output gate `audio-guard` closes when sound would leave by the wrong speaker; when
the gate opens again, the stream is reopened only if the page had asked for sound.

### `midi-bridge`

The BLE-MIDI link to an instrument. It connects to `midi.targetMac` (or, with no
address, to the device advertising as `midi.targetName`), reconnects when the link
drops, and checks delivery by sending a probe note the instrument echoes back.

| Kind | Name | What it does |
|---|---|---|
| HTTP | `POST /connect` | Scan and connect now |
| HTTP | `POST /forget` | Close the link and stop reconnecting |
| HTTP | `POST /scan?ms=` | Nearby BLE devices: `name`, `mac`, `rssi`, `isTarget`, `isBlocklisted` |
| HTTP | `GET /midi/tap` | The last 64 raw chunks the read port delivered, with counters |
| HTTP | `GET`, `POST /midi/send?hex=&repeat=&inMs=` | Write raw MIDI, SysEx included. `hex` may be the POST body. `inMs` sends that many ms from now on the device's clock |
| HTTP | `POST /reset` | Reconnect, then bounce the Bluetooth radio if the echo still fails; answers `fixed`, `recoveredAt`, `steps`. With the write port still closed it answers `fixed: false` and `reason: write_port_closed` |
| HTTP | `GET /loopback`, `POST /loopback` | The echo check's rolling state; `POST` probes now and waits for the echo. With no open write port it answers at once: `sent: false`, `echoed: false`, `reason: write_port_closed` |
| HTTP | `POST /tone?note=&velocity=&ms=` | One audible note, then an echo probe. With no open write port: `ok: false`, `error: write_port_closed`, and no note |
| WS out | `note.on` `{note, velocity, t}`, `note.off` `{note, t}` | Live notes; `t` is the key event's epoch ms |
| WS in | `midi.raw` `{hex}` or `{bytes}`, optional `repeat` | Write raw MIDI to the instrument |
| WS out | `error` `{code, msg}` | `bad_hex`, `no_bytes`, `write_failed` |

The note frames are built by the same code as the old piano bridge's, and a test
compares them byte for byte with that bridge's output. `/status` carries `ble`,
`outVerified` and `midiWrite`; `/diagnostics` carries `midiIn` and `ble`. The
heartbeat carries `ble`, `bleUptimeS`, `bleReconnects`, `midiWriteOpen`,
`midiInOpen`, `outVerified`, `loopRttMs`, `loopMisses` and `linkVerdict` (`DOWN`,
`VERIFIED`, or `ZOMBIE` for a connected link the instrument does not answer), and
a probe runs before each beat. Each live note goes to the capabilities that
subscribed (the synth first) and then to the WebSocket.

Settings: `midi.targetMac`, `midi.targetName`, `midi.blocklistMacs`
(comma-separated), `midi.scanTimeoutMs` (15000), `midi.reconnectDelayMs` (3000),
`midi.enabled` (true), `midi.serviceUuid`. Changing any of them except the name
rebuilds the link. It offers the `midi` role to `bluetooth-controls`.

### `bluetooth-controls`

Bluetooth settings for a kiosk page: adapter state, discovery, pairing, connect
and disconnect. `bluetooth.mode` picks what it manages.

| Method | Path | Body | What it does |
|---|---|---|---|
| GET | `/bluetooth` | | Adapter, known devices, the pairing in progress, `lastError`, `capabilities` |
| POST | `/bluetooth/scan` | `{durationMs}` (1000 to 30000, default 12000) | Start discovery for that long |
| POST | `/bluetooth/scan/stop` | `{}` | Stop discovery |
| POST | `/bluetooth/pair`, `/bluetooth/unpair` | `{address}` | Bond with, or forget, a device |
| POST | `/bluetooth/connect`, `/bluetooth/disconnect` | `{address, profile}` | Use, or stop using, a device for a profile |
| POST | `/bluetooth/pairing` | `{address, accept, pin?}` | Answer the pairing request this app started |
| POST | `/bluetooth/power` | `{enabled}` | Turn the adapter on or off (role mode only) |

Every action needs a JSON object body of 1 to 8192 bytes. An answer is
`{ok: true, accepted: true}` or `{ok: false, code, error}` with `code` one of
`invalid_request`, `action_rejected`, `action_failed`, `pairing_expired`,
`unsupported_device`, `unavailable`.

`bluetooth.mode: roles` (the piano) manages the links other capabilities own: the
profiles are `audio` (the speaker, from `audio-guard`) and `midi` (the instrument,
from `midi-bridge`). Connecting a device to a profile re-points that capability's
link; connecting the device already configured only nudges it. Every answer is
HTTP 200 with the result in the body. While a pairing the page started waits on
Android's own pairing dialog, the capability tells the lockdown (phase 3) not to
recall the kiosk over that dialog; `bluetooth.systemPairingDialog` (default false)
allows that route.

`bluetooth.mode: gamepad` (the Shield) manages HID game controllers: the one
profile is `input`, there is no `power` action, and `pair`, `unpair`, `connect`
and `disconnect` are refused with `unsupported_device` for any address that is not
a discovered gamepad or joystick. The HTTP status carries the result, as the old
audio-bridge API did: `200` for state, `202` for an accepted action, `400` for an
invalid request, `409` for a refused one. The backend's arcade Bluetooth adapter
reads both the status (`409`) and the body's `ok` and `code`. Unlike audio-bridge,
the request's `Content-Type` is not checked.

### `volume-keys`

Needs `accessibility`. The hardware volume keys become page input: each press and
release is sent on the WebSocket as

```json
{"type":"key","key":"KEYCODE_VOLUME_DOWN","action":"down","interactive":true,"ts":1800000000123}
```

(`interactive` is whether the panel is lit, `ts` epoch ms) and, with
`keys.consumeVolume` on, is kept from Android so the system volume does not move
under the page. Other keys pass through untouched. They are counted
(`otherKeysSeen` in `/status`) and not recorded: `GET /log` holds volume keys
only, so what is typed on an attached keyboard is never in it.
With `keys.screenToggleEnabled` on, any volume key wakes a dark panel and two
volume-down presses within `keys.doublePressMs` sleep it; that needs the
`screen-power` capability (phase 3), and until then the attempt is logged as
`screen-toggle-unavailable`.

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `keys.consumeVolume` | boolean | true | Keep volume keys from Android. Set false to give hardware volume back |
| `keys.screenToggleEnabled` | boolean | false | Wake on any volume key, sleep on a double volume-down |
| `keys.doublePressMs` | integer | 450 | The double-press window; 150 to 2000, anything else is refused when set |

`POST /accessibility/silence-beep` removes, now, any other enabled accessibility
service whose component name contains `KeyEvent` (the vendor service that beeps on
volume keys). The same pass runs at each start and whenever the list of enabled
services changes. This app's own service is never removed. `/status` carries
`keysSeen`, `otherKeysSeen` and `displayOn`.

### `audio-guard`

Keeps the tablet's sound on the configured Bluetooth speaker: it connects the
speaker's A2DP link, watches the audio route and the media volume, and closes the
synth's output gate when sound would come out of the tablet's own speaker.

| Method | Path | What it does |
|---|---|---|
| GET, POST | `/speaker` | The speaker link's and the guard's state; `POST` connects now |
| POST | `/speaker/reconnect` | Drop and reconnect the speaker link |
| POST | `/speaker/bt-cycle?settleMs=` | Turn the Bluetooth adapter off and on (default settle 5000 ms). Answers at once; the cycle runs afterwards. `busy` while one is running |
| POST | `/audio-guard/bootstrap` | Disconnect the speaker, let the guard set the tablet speaker's volume to zero, reconnect |
| POST | `/audio-guard/override?ms=` | Hold the guard off for that long (default 60 seconds, at most 10 minutes) |
| POST | `/audio-guard/volume-check` | Check the speaker's volume now and raise it if it is too low (called by the page) |

A device that lists both `synth` and `audio-guard` must list `synth` first: the
guard asserts the synth's output gate when it starts. `audio-guard` declares
`startsAfter: [synth]` and the build refuses a device file with the other order.

It offers the `audio` role to `bluetooth-controls`. `/status` carries `speaker`;
the WebSocket `status` frame carries `speakerOk` and `speakerReason`.

### `hid-input`

Needs `accessibility`. A USB keyboard on the allowlist is read directly at its USB
endpoint (the Portal does not route it to Android input), and each key is sent on
the WebSocket as

```json
{"type":"keyboard","action":"down","key":"a","code":"KeyA","location":0,"ctrlKey":false,"shiftKey":false,"altKey":false,"metaKey":false,"repeat":false,"ts":1800000000123}
```

A held key repeats from the device: first after 450 ms, then every 50 ms, with
`repeat: true`. The USB permission dialog is confirmed through the accessibility
service, which is looked up each time a dialog is expected, so a service that
binds after the payload started is used. The dialog is confirmed only when its
window belongs to `com.android.systemui`, names this app's label (read from the
installed app) as a whole word, and mentions a USB device.

| Method | Path | What it does |
|---|---|---|
| GET | `/input` | Android's input devices and the attached USB devices |
| GET | `/usb-hid` | USB devices with `allowed` and `permission`, and the reader's state |
| POST | `/usb-hid/retry` | Close the keyboard and scan again |
| POST | `/usb-hid/config?vid=&pid=` | Add a vendor and product id to the allowlist |
| GET | `/hid/bluetooth`, `/hid/bluetooth/diag` | Bluetooth keyboard state and diagnostics |
| POST | `/hid/bluetooth/{scan, bond, scan-direct, gatt-direct, gatt, gatt-disconnect, connect-hid}` | The bonding and GATT experiments portal-keys carried, with `ms`, `address`, `transport` as query parameters |
| GET | `/hid/bluetooth/radio`, `/hid/bluetooth/radio/scan?ms=` | What the radio supports, and an LE scan (1 to 60 seconds) |

`/status` carries `usbHid` and `hidEvents`.

### `presence`

Reports every bonded Bluetooth device and whether it is connected, with how long
that state has held, to `presence.endpoint`: on each connection change and every
`presence.heartbeatMs` (used within 5 seconds to 10 minutes). It applies no rules
and no grace period; the backend does. The request carries `presence.token` in
the `X-Presence-Token` header when one is set. With `presence.endpoint` empty it
sends nothing, and `GET /log` shows `presence-not-configured` once per start.
`GET /presence` answers `lastResult`, `endpoint` and the last report.

### `mic-bridge`

For a page whose WebView cannot open the device's microphone. A WebSocket server
on `mic.port`, **bound to loopback only and with no token**, serves one
client at a time: a text frame `{"sampleRate":48000,"channels":1,"format":"pcm_s16le"}`,
then binary frames of 10 ms of PCM. Capture runs only while a client is connected.

Because there is no token, the WebSocket handshake is checked against the page
that is asking. A client is admitted when either holds:

- its `Origin` header has the same origin (scheme, host and port) as the device's
  `webview.startUrl`, which must be set; or
- it sends no `Origin` header, connects from loopback, and `mic.allowNoOrigin` is
  true.

Any other client is refused before it gets a socket. `mic.allowNoOrigin` defaults
to true while an app other than this one's kiosk hosts the page, for a host that
sends no `Origin`. Set it to false once the page runs in this app's kiosk. A page
that does send an `Origin` is admitted only by the first rule, so on a device
whose `webview.startUrl` is empty no web page can open the stream.

| Method | Path | Answer |
|---|---|---|
| GET | `/mic/status` | `running` (listening), `streaming` (frames are being sent), `clients`, `heldByOther`, `lastError`, `lastErrorDetail`, `port` |
| POST | `/mic/restart` | Rebuilds the stream server and the overlay window; `ok` and `running` are true once it is listening again |

`lastError` is null or one of three codes, with the text in `lastErrorDetail`:

| `lastError` | Meaning | Does `POST /mic/restart` help |
|---|---|---|
| `bind_failed` | The socket is not listening (the port is taken) | Only once the port is free |
| `capture_denied` | The permission is granted and capture would still not start; `heldByOther` is true | No. It stays through a restart and clears only when a capture starts |
| `permission_missing` | `RECORD_AUDIO` is not granted | No |

`capture_denied` is the nearest thing the app can observe to another process
holding the microphone, or to Android withholding it from a process it considers
in the background; whether a held microphone shows up that way on the Shield has
not been checked on hardware. A restart closes the connected client; `streaming`
turns true again when the page reconnects. Overlapping restarts run one after the
other.

Android 11 gives the microphone only to a service started while the app is
visible. The capability's shell half adds a 1x1 untouchable overlay window when
the process starts, which needs `SYSTEM_ALERT_WINDOW`, granted once with
`appops set <package> SYSTEM_ALERT_WINDOW allow`. The device file must list
`microphone` under `foregroundServiceTypes`.

### `lease-gate`

Polls `lease.endpoint` once a second (HTTPS only, bearer `lease.credential`) for
a lease on `lease.packageName` and expires it locally every 100 ms, so a lost
network closes the gate. The three settings are read when the payload starts.
Enforcement is hiding the package, which goes through `PackageGate`; nothing
provides one in this phase, so the gate stays closed. `GET /lease` answers
`configured`, `ready`, `blocked`, `leaseBlocked`, `epoch`, `revision`,
`enforcement` (`unavailable` or `package-gate`), `packageHiding` (`supported` or
`unsupported`) and `packageHidingReason`. A device without the
`android.software.device_admin` feature can never have a device owner, so
package hiding is reported unsupported there with that reason; such a device
needs the block-and-recall mode that arrives with `lockdown` in phase 3.

## Differences from the old helpers

Behavior that changed in the port, for whoever switches a device over.

| Area | Old | New |
|---|---|---|
| Every route | No token (piano, audio-bridge) or `X-Portal-Token` (portal ops port); `Access-Control-Allow-Origin: *` | `X-Daylight-Token` on every request; no CORS headers |
| Ports | One port per helper | One control port per device, plus the lifeline |
| Methods | Most routes answered any method | Each route has its methods; another method is `405` |
| `GET /update` | Started an install (piano-bridge) | Reports the install's state; `POST /update` starts one |
| `/config` | One file of keys | `GET`, `POST`, `DELETE /settings`, typed, with new key names |
| A setting change | Rebuilt MIDI and the speaker together | Rebuilds only the link the setting belongs to |
| `POST /loopback`, `/tone`, `/reset` with the MIDI write port closed | `echoed: true`, and so "delivery verified" and `fixed: true` | `echoed: false` with `reason: write_port_closed`; `/tone` answers `ok: false` and plays nothing; `/reset` answers `fixed: false` |
| Synth library in a debug APK | CMake's unoptimized `Debug` build | Optimized (`RelWithDebInfo`) in every variant |
| Portal Bluetooth diagnostics | `/bluetooth*` on the ops port, `/btdiag`, `/btscan` on the control port | `/hid/bluetooth*`, `/hid/bluetooth/radio`, `/hid/bluetooth/radio/scan` |
| Portal key events | WebSocket on the old control port | `key` messages on the control port's WebSocket |
| Portal keyboard events | Loopback WebSocket on its own port, no token | `keyboard` messages on the control port's WebSocket, which needs the token |
| `GET /input` field `external` | Always a boolean | `null` on a system where the call is missing |
| Presence report field `version` | portal-keys' version name | This app's version name |
| Presence with no endpoint | Not logged | Logged once per start |
| Shield `/bluetooth` | No token; `Content-Type` checked | Token needed; `Content-Type` not checked |
| Shield microphone socket | Every interface, port 8765 | Loopback only; port `mic.port` (8782 while both apps are installed) |
| Shield microphone health | Read from the system log over ADB | `GET /mic/status` |
| Shield lease loop | Its own app, device-protected storage, started before unlock | Inside this app, started with the payload; ordering kept under the payload directory |

The backend's arcade Bluetooth adapter calls the Shield's `/bluetooth` API without
a token today. It must send the device's token before the Shield can switch; that
change belongs to the backend.

## Lifeline

Served by the shell on `control.lifelinePort`.

| Method | Path | Result |
|--------|------|--------|
| GET | `/` or `/status` | Shell `port`, `versionCode`, `device`, and the payload status |
| GET | `/payload` | Payload status: `current`, `previous`, `active`, `activeVersion`, `starting`, `available`, `baked`, `shellStamp`, `bootsThisPayload`, `lastFailed`, `lastError` |
| POST | `/payload?url=<jar-url>&sha256=<64 hex>` | Fetch the jar, verify it, activate it; falls back if it fails to start |
| POST | `/payload/rollback` | Go back to the previous payload |
| POST | `/restart` | Stop and start the current payload in place |
| POST | `/settings/reset` | Stop the payload, delete every stored settings override, start the payload again (the baked one when none is current) |
| GET | `/log` | The tail of the shell's log, as plain text |

Swap, rollback, restart and settings reset are accepted and then run in the background. An
accepted request answers `200` with `{"ok":true,"result":"accepted: ..."}`; check
`/payload` afterwards for the outcome. When the loader cannot do what was asked,
the answer is `409` with `{"ok":false,"error":"<reason>"}` and nothing is queued:
a rollback with no previous payload, a restart with no current payload, or a swap
whose `sha256` is not 64 hex characters.

`available` lists payload jars only. The lifeline reads sockets with a 5 second
timeout. The shell log is kept in the app's private storage and is read through
`GET /log`.

Lifeline errors are `{"ok":false,"error":"<text>"}`:

| Status | When |
|--------|------|
| 400 | A swap without both `url` and `sha256` |
| 401 | Missing or wrong token |
| 404 | Unknown path |
| 405 | Rollback, restart or settings reset with a method other than POST |
| 409 | The loader refused the action; `error` holds the reason |
| 500 | The route threw |
| 503 | The payload loader is not ready yet |

The lifeline has no route that runs commands. It is kept small on purpose.

`POST /settings/reset` is the way out when a stored setting keeps the payload from
starting. It removes all overrides, secrets included (`presence.token`,
`lease.credential`), so those have to be set again afterwards. The shell does not
read settings; it deletes one file, whose path it shares with the payload through
`PayloadState` in `shell-api`. A payload built from this revision therefore needs
a shell built from this revision or later.

## The fleet CLI

`cli/daylight-device.cli.mjs` talks to any device by name. It reads the device's
address and token from `{private-tokens-file}` (`$DAYLIGHT_ANDROID_TOKENS`, or
`$DAYLIGHT_BASE_PATH/data/household/auth/daylight-android.yml`) and the ports from
the device file.

```bash
node cli/daylight-device.cli.mjs <device> status
node cli/daylight-device.cli.mjs <device> capabilities
node cli/daylight-device.cli.mjs <device> info
node cli/daylight-device.cli.mjs <device> settings
node cli/daylight-device.cli.mjs <device> settings set <key> <value>
node cli/daylight-device.cli.mjs <device> settings reset <key>
node cli/daylight-device.cli.mjs <device> lifeline status
node cli/daylight-device.cli.mjs <device> lifeline rollback
node cli/daylight-device.cli.mjs <device> lifeline restart
node cli/daylight-device.cli.mjs <device> lifeline reset-settings
node cli/daylight-device.cli.mjs <device> lifeline log
node cli/daylight-device.cli.mjs <device> get <path> [key=value ...]
node cli/daylight-device.cli.mjs <device> post <path> [key=value ...] ['{json}']
```

`get` and `post` reach every route on the control port, for the routes that have
no named command yet. Each `key=value` becomes a query parameter, and an argument
that starts with `{` is sent as the JSON body. For example
`post /speaker/bt-cycle settleMs=5000`, `post /bluetooth/scan '{"durationMs":5000}'`
and `get /mic/status`.

`settings set` sends the value as the text that was typed. The device coerces it
to the setting's declared type, so `true` sets a boolean setting to true and sets a
string setting to the text `true`. The CLI prints the response, and on a non-2xx
status (a lifeline `409` included) also prints the status and exits 1. It never
prints the token.

The CLI has no command for a payload swap yet. Send that request to the lifeline
directly.

## Checking a build

`node _extensions/daylight-android/tools/verify-build.mjs <device>` compares a built
APK with its device file: package, SDK levels, version code, the exact permission
set (a permission declared as `uses-permission-sdk-23` or with a `maxSdkVersion`
must be stated that way in the capability's file), the declared activities,
services, receivers and providers (exactly those of the base shell and of the
listed capabilities' shell halves), and that the baked payload holds the entry
classes of the listed capabilities and no others. It also compares the sha256 of
the payload baked into the APK with the `.sha256` file the payload build wrote,
and fails when the APK holds a different payload than the one just built, or when
that file is missing. Its last line says what kind of build it checked. It also checks that the shell
service's foreground service types are exactly the device file's, and that a
capability with native code ships a library for every ABI of the device. For a
device that lists `synth` it reads the synth library out of the APK for each ABI
and fails unless it holds the JNI exports of the APK's engine class, was built
with sfizz, has the size of an optimized, stripped build, and names no path on
the build machine. It exits 1 on any difference.

With `--legacy` it also compares the APK's permissions with what the old helper
app for that device declared, using
`_extensions/daylight-android/tools/legacy-permissions.yml`: every addition and
removal must be recorded there with its reason. That file is the permission
ledger: per device, the old app's list, `added` (permission and reason) and
`dropped`. The check is new = old + added - dropped, and it passes for all three
devices: `piano` has the old set exactly, `portal` adds two and `shield` adds
eight, all of them shared core features.

## Known limits

- **Only a debug build exists.** Every APK is debuggable and signed with the
  Android debug key; no release signing is configured. Accepted, with this
  consequence: where ADB is enabled, `run-as <package>` reads the app's private
  storage, which holds the control token and the stored settings, secret ones
  included. ADB is enabled on these devices by design, so ADB access to a device
  is access to its token. `verify-build.mjs` prints the build type it checked.
- No kiosk or WebView. Fully Kiosk Browser and the old helpers still run every device.
- Nothing from phase 2 has run on a device.
- Old state does not move by itself: on-device overrides, the presence token, the
  USB allowlist, the crash log and the instrument files stay with the old apps
  until each device's switch copies what matters.
- Unchecked on hardware: whether the overlay window is up early enough for the
  Shield to grant the microphone at boot, what a held microphone looks like to the
  app, and which page code consumed the Portal's old keyboard socket.
- The token is compiled into the shell, so rotation needs a new install.
- Device defaults are validated when the payload starts, and by a JVM test per
  device in the build (`:payload:test<Device>DebugUnitTest`).
- A force-stopped app stays stopped until it is opened or the device reboots.
- Loading the payload with `DexClassLoader` can only be proven on a device, and
  that check is not part of the automated build.
- A shell reinstall is detected by `versionCode` only.
- A start that misses its deadline leaves its thread behind until that start
  returns; the payload is stopped when it does.
- When a request is refused with its body unread (a `413`, or a `401` with a body
  over 64 KiB), the connection is closed, and a client still sending may see a
  reset instead of the status.
