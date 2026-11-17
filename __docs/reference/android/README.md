# DaylightStation Android

One Android codebase builds a separate app for each household device from a device
file (`_extensions/daylight-android/devices/<id>.yml`). This page describes how a
built app behaves and how to operate it. The kiosk capabilities that replace Fully
Kiosk Browser have their own page, `__docs/reference/android/kiosk.md`. Building,
adding a device and adding a capability are covered in
`_extensions/daylight-android/README.md`.

## Status: built, nothing switched

**Nothing here runs a device yet.** Fully Kiosk Browser and the old helper apps
still run all three devices. The kiosk capabilities are in the build and have never
run on a device.

**What has been on hardware.** On 2026-11-16 the phase 1 build (shell, payload
loader, control API, lifeline) was installed on the Portal beside the existing
apps; its payload loaded and the control API answered. Reboot survival was not
tested. That is the only hardware fact.

**Phase 2 is complete in the build and has never run on a device.** It copied the
working helper code out of the old helper apps into capabilities, with behavior
unchanged except where "Differences from the old helpers" says otherwise. Every
Bluetooth, MIDI, audio, USB and microphone path is the old code under a new
package, compiled and covered by JVM tests, and unproven in its new process.

**Phase 3's Android side is complete in the build and has never run on a device.**
Every device lists the six kiosk capabilities (`webview-host`, `lockdown`,
`screen-power`, `volume`, `app-launcher`, `debug-tools`), serves every route of
the control API contract's kiosk tables, and has its start URL compiled in from
`{private-tokens-file}`. Everything said about them below is what the code does
under JVM tests and what the built APKs declare. The three device builds are:

| Device | Capabilities |
|---|---|
| `piano` | `webview-host`, `debug-tools`, `accessibility`, `lockdown`, `screen-power`, `volume`, `app-launcher`, `synth`, `midi-bridge`, `bluetooth-controls` (roles), `audio-guard` |
| `portal` | `webview-host`, `debug-tools`, `accessibility`, `lockdown`, `screen-power`, `volume`, `app-launcher`, `volume-keys`, `hid-input`, `presence` |
| `shield` | `webview-host`, `debug-tools`, `accessibility`, `lockdown`, `screen-power`, `volume`, `app-launcher`, `bluetooth-controls` (gamepad), `mic-bridge`, `lease-gate` |

Lockdown is built in and switched off (`lockdown.enabled: false` in all three
device files) until a device's home app is switched, because the app is installed
beside Fully until then. For the same reason installing adds no home candidate
(the HOME filter is on an alias that is installed disabled) and every coexistence
switch is compiled off, so the old helper apps keep the hardware they hold. Both
are described in `kiosk.md`.

Switching a device from Fully to this app is a per-device procedure with its own
checks: `__docs/runbooks/android/kiosk-cutover.md`. The backend adapters and the
page's bridge wrapper are built separately against the same contract.

The kiosk page cannot use the helper routes yet: the old helpers answered it on
`localhost` with no token and with `Access-Control-Allow-Origin: *`; the control
port needs the token and sends no CORS headers. The page reaches the app through
`window.daylight` for what the bridge offers; how it reaches the helper routes
(MIDI, the Bluetooth panel) is decided at each device's cutover.

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

`control.bind` in the device file says where both listen: `lan` (the default, every
interface, what the kiosks do), `loopback` (the device's own loopback address
only), or `none`. With `none` neither a control server nor a lifeline is started,
and no control token is compiled into the APK. The routes are still registered, so
a capability has one code path, and nothing listens. The phone uses `none`: every
app installed on a phone can reach its loopback address and read another app's
APK, and the phone's installed components talk to the payload in-process. A value
the app does not know is treated as `none`. See `__docs/reference/android/phone.md`.

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

Served by the payload on `control.port`. Responses are JSON, except
`GET /debug/screenshot` (`image/png`) and `GET /debug/logcat` (`text/plain`).

| Method | Path | Result |
|--------|------|--------|
| GET | `/status` | `device`, `payloadVersion`, `shellVersionCode`, `uptimeMs`, `capabilities`, and the shell's payload status |
| GET | `/capabilities` | Capability names and every registered route |
| GET | `/settings` | Every declared setting: `key`, `type`, `value`, `default`, `overridden` |
| POST | `/settings` | JSON body `{"key": ..., "value": ...}`; stores a runtime override |
| DELETE | `/settings?key=<key>` | Removes the override; the value returns to its default |
| GET | `/debug/info` | From the `debug-tools` capability: `device`, `model`, `sdkInt`, `elapsedRealtimeMs`. Its other routes are in `kiosk.md` |
| GET | `/payload` | The shell's payload status, as on the lifeline |
| POST | `/payload` | JSON body `{"url": ..., "sha256": ...}` (or the same two as query parameters); answers `{result}`. The swap runs afterwards |
| POST | `/payload/rollback` | Answers `{result}` |
| POST | `/update` | JSON body `{"url": ..., "sha256": ...}` (`sha256` optional); downloads the APK, checks it, and hands it to the system installer; answers `{state, bytes, sha256Verified, confirming}` |
| GET | `/update` | `state` (`idle`, `downloading`, `awaiting_confirmation`, `failed`), `lastError`, `sha256Verified` (the last update handed to the installer had its hash checked) and `confirming` (its confirmation is being tapped for the user right now) |
| GET, POST | `/beat` | The heartbeat's state; `POST` sends one now and returns its body. The body's `logEventsDropped` counts one-off log events the device gave up on because the log store was not taking them (at most 200 wait at a time; the oldest goes first) |
| GET | `/wifi` | The Wi-Fi link: current sample, recent samples, thresholds. `?fresh=1` samples first |
| GET | `/log` | Recent in-memory events |
| GET | `/crashlog` | The on-disk lifecycle and crash record |
| GET | `/diagnostics` | Time, CPU, device, thermal zones, crash record, and one section per capability |
| POST | `/accessibility/enable` | Enables the app's accessibility service through secure settings |

`/status` also carries `model`, `android`, `package`, `batteryOptExempt`,
`wsClients`, `a11yBound`, `settingsProblem` (null, or what was wrong with the
stored settings when they were read; never a value), `switches` (each coexistence
switch as `{setting, active}`; see `kiosk.md`) and whatever each capability
contributes.

A swap or rollback the shell refuses answers `409` with `ok: false` and the reason
in both `error` and `result`. `POST /payload` without `url` or `sha256` answers
`400`. A pushed payload larger than 64 MiB is abandoned.

A failure of `POST /update` answers with a status the backend can map and the same
body as before: `400` for a missing `url`, `409` when there is no installer in
this state (`not_ready`), when another update is in flight, or when the APK was
refused (hash mismatch, another package, a lower version), `502` when the
download failed, `504` when it timed out, `500` for anything else. The complete
list of statuses that changed is in `kiosk.md` under "Response statuses that
changed".

A capability whose `start()` throws has `stop()` called on it before the payload
fails, so what it took before it threw is given back.

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
| 408 | `timeout` | `/debug/eval`, `/debug/html`, `/debug/fps`: the page did not answer in time |
| 409 | `update_in_progress`, `stale_revision`, a refused swap | The request conflicts with what is already under way |
| 411 | `length_required` | A chunked body, sent without a `Content-Length` |
| 413 | `payload_too_large` | The body is over 1 MiB |
| 413 | `result_too_large` | `/debug/eval`, `/debug/html`: the result is over its size limit; `size` and `max` say by how much |
| 500 | `internal` | A handler threw something unexpected |
| 501 | `unsupported` | The capability cannot do this on this device |

501 is how a route says this device cannot do something, with the reason:
`POST /device/reboot` without device owner (`device owner required`),
`POST /screen {"on":false}` on a device with no way to turn its display off,
`POST /lockdown/lock` and `POST /lockdown/unlock` while `lockdown.enabled` is false,
`POST /screen/brightness` without the `WRITE_SETTINGS` grant, `/volume` on a device
with no audio service, `POST /debug/exec` while `debug.execEnabled` is false, and
the page tools of `debug-tools` in a build with no `webview-host`.

A route answers `ok: true` only for something that happened. A route that could
not do what was asked, on a device that can, answers HTTP 200 with `ok: false`
and an `error` code (`no_kiosk_activity`, `screen_state_unchanged`,
`volume_unchanged`, `not_in_foreground`, `js_error`, and the others named under
each capability).

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
| `debug-tools` | `GET /debug/info`, `GET /debug/screenshot`, `POST /debug/eval`, `GET /debug/html`, `GET /debug/fps`, `POST /debug/exec`, `GET /debug/logcat`, `POST /speak`, `POST /sound` |
| `webview-host` | `GET /kiosk/status`, `POST /kiosk/load`, `POST /kiosk/load-start`, `POST /kiosk/reload`, `POST /kiosk/foreground`, `POST /kiosk/renderer/reset`, `POST /kiosk/restart`, `POST /kiosk/overlay` |
| `lockdown` | `GET /lockdown`, `POST /lockdown/lock`, `POST /lockdown/unlock`, `POST /lockdown/input` |
| `screen-power` | `POST /screen`, `POST /screen/brightness`, `POST /device/reboot` |
| `volume` | `GET /volume`, `POST /volume` |
| `app-launcher` | `POST /launch` |
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
| `LinkHandler` | `bookmarks` (`open`, `bookmark`), `one-tap-actions` (`action`), `media-service` (`media`), `quick-input` (`memo`) | `notifications` hands a checked link to the handler of its kind |
| `LocalNotices` | `notifications` | `quick-input` reports the state of its upload queue |
| `PairingDialogExemption` | `bluetooth-controls` | `lockdown`: while it is granted, Android's own pairing dialog (Settings in front) is not recalled over |
| `ScreenPower` | `screen-power` | `volume-keys`: wake on a key, sleep on a double volume-down. Without it the attempt is logged `screen-toggle-unavailable` |
| `InputLock` | `lockdown` | `volume-keys`: while the lock is active a volume key does nothing |
| `PageOpener` | `webview-host` | `bookmarks`: show a URL in the app's page, now or in the window that attaches next |
| `LinkHandler` (one per link kind) | `bookmarks` (`open`, `bookmark`), `one-tap-actions` (`action`) | `notifications`: hands a checked link to the handler of its kind |
| `LinkKeySource` | `notifications` | `one-tap-actions`: the link key for the links its surfaces launch (carried in the fragment, replaced at every payload start) |
| `ActionList` | `one-tap-actions` | `widgets`: the actions and their keyed links, in process only |
| `PackageGate` | `lockdown` | `lease-gate`: a closed package is kept from the front, and hidden as well where this app is device owner |
| `KioskSurface` | `webview-host` | `lockdown`, `screen-power`, `app-launcher` and `debug-tools`: the kiosk window, its page, evaluate and capture |
| `LockdownControl`, `DeviceAdminAccess` | `lockdown` | `webview-host` (what is in front, recall, reboot support), `screen-power` (screen off, reboot), `app-launcher` (a launched app may stay in front) |
| `ScreenControl` | `screen-power` | `webview-host` for `daylight.screen()`; without it the bridge call answers `false` |
| `VolumeControl` | `volume` | `webview-host` for `daylight.volume()`; without it the answer is `{}` |
| `AppLaunch` | `app-launcher` | `webview-host` for `daylight.launch()`; without it the answer is `false` |

Notifications that are not instrument notes go over the core event bus
(`core.events()`), by topic: `screen` `{on}` (from `screen-power`, read from the
display's own state), `network` `{connected}`, `key` `{code, action}` (from
`webview-host` for the keys it intercepts, and from `volume-keys` for the volume
keys), `kiosk-focus` `{focused}`, `foreground` (what `lockdown` saw take the
front, and each recall) and `lockdown` (`lockdown.pin.lockout`). `webview-host`
forwards `screen`, `network` and `key` to the page as `daylight:` events, and
nothing else.

`screen-power` also listens on the note bus: a note played on the instrument wakes
a dark display, within `power.wakeCooldownMs` and outside the no-wake window.

The accessibility service is the `accessibility` capability's shell half; the core
holds the bound service and shares it (`lockdown`, `screen-power`, `volume-keys`,
`hid-input`, `bluetooth-controls` in role mode, and the update confirmation use it).

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
| `mic.port` | 1024 to 65535, and never this device's control or lifeline port |
| `lockdown.mode` | `auto`, `app` or `owner` |
| `lockdown.maxUnlockMin`, `lockdown.pinUnlockMin` | 1 to 60 |
| `lockdown.recallGraceMs` | 0 to 60000 |
| `power.screenVerifyMs` | 0 to 60000 |
| `power.wakeCooldownMs` | 0 to 3600000 |
| `launcher.confirmMs` | 0 to 30000 |
| `debug.execTimeoutMs`, `debug.evalTimeoutMs` | 100 to 60000 |

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
`POST /settings/reset` (below): it deletes all stored overrides, and their backup,
and starts the payload on its compiled defaults.

**How overrides are stored.** One JSON file beside the payload's state. A write
goes to a temporary file, is forced to disk, and then replaces the file; the state
being replaced is kept as `settings-overrides.json.bak`. When the file cannot be
read (or is missing while a backup exists, which is what an interrupted write
leaves) the backup is used. Either way it is said: once in the device log and the
shell log, and in `GET /status` as `settingsProblem`. No value is ever part of
that message.

**Settings only the device file decides.** A setting declared as compiled
(`lockdown.required` is the one today) takes its value from the device file
alone. `POST /settings` and `DELETE /settings` answer `400 invalid_setting` for
it, and a stored override for it is ignored. A capability can also guard a
setting, refusing some values with a reason: `lockdown.enabled` cannot be set
false while `lockdown.required` is true, and `mic.port` cannot be set to the
control or lifeline port.

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

Each capability's settings are explained in its section, below or in `kiosk.md`.

**Every setting.** Key, type, the fallback the capability declares in code, and
its rule. A device file's `defaults:` may replace the fallback (each capability's
section says where one does). `volume`, `synth`, `hid-input` and `accessibility`
declare none.

| Declared by | Key | Type | Fallback | Rule |
|---|---|---|---|---|
| core | `heartbeat.enabled` | BOOLEAN | true |  |
| core | `heartbeat.intervalMs` | INTEGER | 60000 | 10000 to 86400000 |
| core | `heartbeat.deviceId` | STRING | empty |  |
| core | `heartbeat.logStoreUrl` | STRING | empty |  |
| core | `heartbeat.backendUrl` | STRING | empty |  |
| core | `logstore.app` | STRING | empty |  |
| core | `wifi.telemetryEnabled` | BOOLEAN | true |  |
| core | `wifi.sampleIntervalMs` | INTEGER | 10000 | 2000 to 3600000 |
| core | `wifi.degradedRssiDbm` | INTEGER | -75 |  |
| core | `wifi.degradedLinkMbps` | INTEGER | 20 |  |
| core | `accessibility.selfEnable` | BOOLEAN | false |  |
| core | `update.autoConfirm` | BOOLEAN | false |  |
| `webview-host` | `webview.startUrl` | STRING | empty | a device file's value must be https |
| `webview-host` | `webview.bridgeOrigins` | STRING | empty |  |
| `webview-host` | `webview.allowedOrigins` | STRING | empty | origins the main frame may navigate to beyond the start URL's |
| `webview-host` | `webview.backButton` | STRING | `reload` | `page`, `reload`, `ignore` |
| `webview-host` | `webview.interceptKeys` | STRING | empty |  |
| `webview-host` | `webview.loadTimeoutSec` | INTEGER | 20 | 1 to 600 |
| `webview-host` | `webview.allowMic` | BOOLEAN | false | true in the kiosk device files |
| `webview-host` | `webview.allowCamera` | BOOLEAN | false | true in the kiosk device files |
| `webview-host` | `webview.showWhenLocked` | BOOLEAN | false | true in the kiosk device files |
| `webview-host` | `webview.allowMixedContent` | BOOLEAN | false |  |
| `webview-host` | `webview.debugging` | BOOLEAN | false |  |
| `webview-host` | `webview.launchOnBoot` | BOOLEAN | false |  |
| `webview-host` | `recovery.reloadOnPageFailureSec` | INTEGER | 30 | 0 to 3600 |
| `webview-host` | `recovery.maxRetrySec` | INTEGER | 300 | 0 to 86400 |
| `webview-host` | `recovery.reloadOnNetworkReturn` | BOOLEAN | true |  |
| `webview-host` | `recovery.rendererUnresponsiveSec` | INTEGER | 30 | 0 to 3600 |
| `lockdown` | `lockdown.enabled` | BOOLEAN | true |  |
| `lockdown` | `lockdown.mode` | STRING | `auto` | `auto`, `app`, `owner` |
| `lockdown` | `lockdown.allowedApps` | STRING | empty |  |
| `lockdown` | `lockdown.recallGraceMs` | INTEGER | 0 | 0 to 60000 |
| `lockdown` | `lockdown.maxUnlockMin` | INTEGER | 60 | 1 to 60 |
| `lockdown` | `lockdown.pinUnlockMin` | INTEGER | 10 | 1 to 60 |
| `lockdown` | `lockdown.exitPin` | STRING, secret | empty | no compiled default |
| `lockdown` | `lockdown.immersive` | BOOLEAN | true |  |
| `lockdown` | `lockdown.statusBarShield` | BOOLEAN | true |  |
| `lockdown` | `lockdown.selfEnableAccessibility` | BOOLEAN | true |  |
| `lockdown` | `lockdown.ownerRestrictions` | BOOLEAN | false |  |
| `lockdown` | `lockdown.ownerHidePackages` | STRING | empty |  |
| `lockdown` | `lockdown.dismissControlCenter` | BOOLEAN | false |  |
| `lockdown` | `lockdown.required` | BOOLEAN | false | compiled only: cannot be set or reset on the device |
| `lockdown` | `lockdown.ownerTransferTarget` | STRING | empty | `<package>/<receiver>`; empty refuses every ownership transfer |
| `screen-power` | `power.keepScreenOn` | BOOLEAN | true |  |
| `screen-power` | `power.wifiLock` | BOOLEAN | true |  |
| `screen-power` | `power.preventSleepWhileScreenOff` | BOOLEAN | true |  |
| `screen-power` | `power.screenVerifyMs` | INTEGER | 3000 | 0 to 60000 |
| `screen-power` | `power.wakeCooldownMs` | INTEGER | 8000 | 0 to 3600000 |
| `screen-power` | `power.noWakeStart` | STRING | empty | `HH:mm` |
| `screen-power` | `power.noWakeEnd` | STRING | empty | `HH:mm` |
| `app-launcher` | `launcher.allowed` | STRING | empty |  |
| `app-launcher` | `launcher.confirmMs` | INTEGER | 3000 | 0 to 30000 |
| `debug-tools` | `debug.execEnabled` | BOOLEAN | false |  |
| `debug-tools` | `debug.execTimeoutMs` | INTEGER | 10000 | 100 to 60000 |
| `debug-tools` | `debug.evalTimeoutMs` | INTEGER | 5000 | 100 to 60000 |
| `debug-tools` | `debug.soundOrigins` | STRING | empty |  |
| `midi-bridge` | `midi.enabled` | BOOLEAN | true |  |
| `midi-bridge` | `midi.serviceUuid` | STRING | the BLE-MIDI service UUID |  |
| `midi-bridge` | `midi.targetMac` | STRING | empty |  |
| `midi-bridge` | `midi.targetName` | STRING | empty |  |
| `midi-bridge` | `midi.blocklistMacs` | STRING | empty |  |
| `midi-bridge` | `midi.scanTimeoutMs` | INTEGER | 15000 | 1000 to 120000 |
| `midi-bridge` | `midi.reconnectDelayMs` | INTEGER | 3000 | 250 to 600000 |
| `audio-guard` | `speaker.mac` | STRING | empty |  |
| `audio-guard` | `speaker.name` | STRING | `Speaker` |  |
| `audio-guard` | `speaker.enabled` | BOOLEAN | true | coexistence switch: the connector and the guard together |
| `audio-guard` | `speaker.connect` | BOOLEAN | true | false after the Bluetooth panel disconnected the speaker on purpose |
| `bluetooth-controls` | `bluetooth.mode` | STRING | `roles` | `roles`, `gamepad` |
| `bluetooth-controls` | `bluetooth.systemPairingDialog` | BOOLEAN | false |  |
| `volume-keys` | `keys.consumeVolume` | BOOLEAN | true |  |
| `volume-keys` | `keys.screenToggleEnabled` | BOOLEAN | false |  |
| `volume-keys` | `keys.doublePressMs` | INTEGER | 450 | 150 to 2000 |
| `presence` | `presence.endpoint` | STRING | empty |  |
| `presence` | `presence.token` | STRING, secret | empty | no compiled default |
| `presence` | `presence.heartbeatMs` | INTEGER | 60000 | 5000 to 600000 |
| `mic-bridge` | `mic.port` | INTEGER | 8765 | 1024 to 65535 |
| `mic-bridge` | `mic.allowNoOrigin` | BOOLEAN | true |  |
| `mic-bridge` | `mic.enabled` | BOOLEAN | true | coexistence switch |
| `hid-input` | `hid.enabled` | BOOLEAN | true | coexistence switch |
| `volume-keys` | `volumeKeys.enabled` | BOOLEAN | true | coexistence switch |
| `presence` | `presence.enabled` | BOOLEAN | true | coexistence switch |
| `lease-gate` | `lease.enabled` | BOOLEAN | true | coexistence switch |
| `lease-gate` | `lease.endpoint` | STRING | empty |  |
| `lease-gate` | `lease.packageName` | STRING | empty |  |
| `lease-gate` | `lease.credential` | STRING, secret | empty | no compiled default |

**Secret settings.** `presence.token`, `lease.credential` and `lockdown.exitPin` are secrets. A secret
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
| `debug-tools` | all | Remote diagnostics: screenshot, run a script in the page, the page's HTML, frame rate, a shell command (off by default), the device log, speech, a sound | `debug.*` |
| `webview-host` | all | The kiosk: a fullscreen WebView, the `window.daylight` page bridge, page-load recovery, the overlay layers | `webview.*`, `recovery.*` |
| `accessibility` | all | The app's one accessibility service, shared through the core | `accessibility.selfEnable` (core) |
| `lockdown` | all (off) | Keeps the kiosk in front: watcher and recall, HOME candidate, device admin, owner mode where this app is device owner | `lockdown.*` |
| `screen-power` | all | Screen on and off, brightness, keep-awake locks, reboot under device owner | `power.*` |
| `volume` | all | A stream's volume as a percentage | none |
| `app-launcher` | all | Starts an allowed app from the kiosk | `launcher.allowed`, `launcher.confirmMs` |
| `synth` | piano | Native sampler | none |
| `midi-bridge` | piano | BLE-MIDI link to the instrument | `midi.*` |
| `audio-guard` | piano | Keeps sound on the configured Bluetooth speaker | `speaker.mac`, `speaker.name`, `speaker.enabled` |
| `bluetooth-controls` | piano, shield | Bluetooth panel for the page | `bluetooth.mode`, `bluetooth.systemPairingDialog` |
| `volume-keys` | portal | Volume keys as page input | `keys.*` |
| `hid-input` | portal | USB keyboards as page input, Bluetooth keyboard diagnostics | none (the USB allowlist is stored on the device) |
| `presence` | portal | Reports connected Bluetooth devices to the backend | `presence.endpoint`, `presence.token` (secret), `presence.heartbeatMs` |
| `mic-bridge` | shield | Microphone PCM over a loopback WebSocket | `mic.port`, `mic.allowNoOrigin` |
| `lease-gate` | shield | Polls for a lease that decides whether one app may run | `lease.endpoint`, `lease.packageName`, `lease.credential` (secret) |
| `notifications` | phone | Deep links through one link activity; the app's own local notifications (`LocalNotices`) | `links.origins` |
| `bookmarks` | phone | Named pages of the site; the `open` and `bookmark` link kinds | `bookmarks.1` to `bookmarks.8` |
| `one-tap-actions` | phone | Actions as launcher shortcuts, pinned shortcuts and quick-settings tiles | `actions.*` |
| `widgets` | phone | A home-screen widget of up to four actions | `widgets.actions` |
| `media-service` | phone | Native audio playback of household media: browse tree, stream resolution, progress reports; a Media3 library session in the shell half | `media.roots`, `media.recentLimit`, `media.pageSize`, `media.controllerPins` |
| `android-auto` | phone | Declares the media library service to Android Auto. Declarations only, no payload | none |
| `quick-input` | phone | Records a voice memo and uploads it to the Journalist from a queue kept on disk | none (`identity.user` must be set and `identity.device` must be `fleet:<key>`) |

The phone's capabilities are described in `__docs/reference/android/phone.md`.

What each ported capability adds to a device that lists it. HTTP routes need the
token like every other route; WebSocket messages are JSON text frames on the
control port, keyed by `type`.

### The kiosk capabilities

`webview-host`, `lockdown`, `screen-power`, `volume`, `app-launcher` and
`debug-tools` are described in `__docs/reference/android/kiosk.md`: their routes
with every error code, their settings, the `window.daylight` page bridge, the
lockdown modes per device, what reloads a page, the one-time ADB grants per
device, and what differs from Fully Kiosk Browser.

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
volume-down presses within `keys.doublePressMs` sleep it, through `screen-power`;
on a build without it the attempt is logged as `screen-toggle-unavailable`.

Each press and each release is also published on the event bus, so a page in this
app's own kiosk receives it as `daylight:key` with `code` `VolumeUp` or
`VolumeDown` (a held key repeats on the WebSocket only). Leave the volume keys out
of `webview.interceptKeys` on a device with this capability, or the page would hear
a key twice when `keys.consumeVolume` is off. While `lockdown`'s input lock is
active a volume key is consumed and goes nowhere.

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

`speaker.enabled` is this capability's coexistence switch (see `kiosk.md`,
"Coexistence switches"): false, neither the connector nor the guard exists and the
routes answer `no_a2dp`. The Bluetooth panel's disconnect and assign write
`speaker.connect` and leave the switch alone; with `speaker.connect` false the
guard still runs and the tablet's own speaker stays clamped.

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
whose `webview.startUrl` is empty no web page can open the stream. The Shield's
start URL is compiled in, so its own page is admitted.

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
Enforcement goes through the `PackageGate` that `lockdown` provides. `GET /lease`
answers `configured`, `ready`, `blocked`, `leaseBlocked`, `epoch`, `revision`,
`enforcement`, `packageHiding` (`supported` or `unsupported`) and
`packageHidingReason`. `enforcement` is `package-gate` where a closed package is
hidden (this app is device owner), `block-and-recall` where it is kept from the
front instead, and `unavailable` in a build without `lockdown`. A device without
the `android.software.device_admin` feature (the Shield) can never have a device
owner, so there `packageHiding` reads `unsupported` with that reason and the gate
blocks and recalls. The gate is ready only while the kiosk is locked: with
`lockdown.enabled` false the loop reports `ready:false` and treats the package as
blocked, and nothing keeps the package from the front.

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
| Shield lease acknowledgement with no package gate | Acknowledged the state the app enforced | While nothing provides a package gate the loop acknowledges `capabilityReady: false, blocked: true`, whatever the lease says |
| Shield `/bluetooth/<unknown action>` | `400` with `code: invalid_request` | `404 unknown_route`: only the named actions are routes |
| Shield `/bluetooth` response headers | `Cache-Control: no-store` | No cache header |
| Shield `/bluetooth` before the controller exists | No such answer | `200` with `ok: false, code: unavailable` (not `409`) until the capability has started |
| Shield `GET /mic/status` fields | The control API contract's `running`, `streaming`, `clients`, `heldByOther`, `lastError` | Adds `port` and `lastErrorDetail`; `lastError` is a code (`bind_failed`, `capture_denied`, `permission_missing`) and `capture_denied` survives a restart |
| Shield microphone socket clients | Any client that could reach the port | The handshake's `Origin` must match `webview.startUrl`; a client with no `Origin` is admitted from loopback while `mic.allowNoOrigin` is true |
| Portal keyboard socket's first frame | `{"type":"ready","port":...}` | `{"type":"ready","device":"<id>"}`, the hub's greeting; there is no `port` field |
| Portal keyboard events' audience | The clients of the keyboard socket | Every client of the control port's WebSocket |
| Portal non-volume keys | Each one written to the event log (`hid-pass`) | Counted (`otherKeysSeen`), never logged |
| Portal `keys.doublePressMs`, `presence.heartbeatMs` out of range | Refused by the old config route | Refused when set, with `400 invalid_setting` (150 to 2000 ms; 5 s to 10 min) |
| Portal accessibility service config | Events `typeWindowsChanged` and `typeWindowStateChanged`; flags `flagRequestFilterKeyEvents`, `flagRetrieveInteractiveWindows` | Declares `typeWindowStateChanged` only; flags `flagDefault`, `flagReportViewIds`, `flagRetrieveInteractiveWindows`; adds `canRequestTouchExplorationMode` (the piano's set). Key filtering and further event types are switched on at run time for a capability that registers for them. See the note below |
| Portal Control Center dismissal | portal-keys closed the swipe-up panel when a `typeWindowsChanged` event showed it, whenever `blockControlCenter` was on | `lockdown` does the same while `lockdown.dismissControlCenter` is on, except during an unlock window. Not run on the Portal in this app |
| Portal input lock (`PUT /lockdown`, `X-Lockdown-Token`) | Its own token and route on the old control port | `POST /lockdown/input` behind the device token; the same ordered commands |
| Shield lease enforcement | Hiding the package (never possible on the Shield) | The package is kept from the front by the lockdown watcher, and `POST /launch` refuses it |
| Portal USB permission dialog | Confirmed when the dialog named "Portal Keys", in a system UI or package installer window | Confirmed when it names this app's own label as a whole word, in a system UI window only |
| `midi.targetName` default | One instrument's Bluetooth name, compiled in | Empty; the device file supplies it |
| MIDI and speaker connector settings | The values the connector was built with | Read from the settings at each use |
| `GET /midi/send` | Hex from the query only | The same handler as `POST`: a hex body is read too |
| Synth engine lifetime | Created and released by the piano-bridge service | Created by a ContentProvider when the process starts and never released; it ends with the process |
| Synth engine failed to load | Not reported | `/status` and `/diagnostics` read `engine: load_failed` with `engineError` |
| Role `assign` (bluetooth-controls giving a device the MIDI or the audio role) | One config write | One settings write of three keys (address, name, enabled): all three are stored or none is |
| `POST /update` | Installed what the URL returned; the dialog was tapped whenever auto-confirm was on | Refuses another package or a lower `versionCode`; optional `sha256`; the dialog is tapped only for a verified `sha256`; `GET /update` leaves `awaiting_confirmation` after 90 s |
| A setting with a fixed set of values or a range | Checked where it was used, or not at all | Checked when set; see Settings |
| WebSocket sends | On the thread that produced the frame | Queued per client; a client that stops reading is disconnected after 512 queued frames |

On the accessibility config: `typeWindowsChanged` is absent from the declared
config on purpose. The service is shared by every device, and the hub adds event
types at run time (`addEventListener`) for a capability that needs them. `lockdown`
asks for `typeWindowsChanged` only while `lockdown.dismissControlCenter` is on,
which is the Portal's device default.
`flagReportViewIds` and `canRequestTouchExplorationMode` come from the piano's
service and are not used on the Portal; touch exploration is requested by nothing.

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
| POST | `/settings/reset` | Stop the payload, delete every stored settings override and its backup, start the payload again (the baked one when none is current) |
| POST | `/owner/release` | Where this app is device owner: set the owner hold, clear the persistent home preference and the lock-task packages, enable the status bar and the keyguard, and ask the kiosk Activity to leave lock task. Needs no payload. `409 not_device_owner` elsewhere; `500 release_incomplete` with what failed |
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
| 405 | Rollback, restart, settings reset or owner release with a method other than POST |
| 409 | The loader refused the action; `error` holds the reason |
| 500 | The route threw |
| 503 | The payload loader is not ready yet |

The lifeline has no route that runs commands. It is kept small on purpose.

`POST /settings/reset` is the way out when a stored setting keeps the payload from
starting. It removes all overrides, secrets included (`presence.token`,
`lease.credential`, `lockdown.exitPin`), so those have to be set again afterwards,
and every coexistence switch goes back to the device file's value. It does not
switch lockdown off on a device built with `lockdown.required: true`, and it does
not remove an owner hold.

A device with `control.bind: none` (the phone) has no lifeline.

A shell component that Android binds or creates while a payload is still inside
`start()` (the kiosk Activity with launch-on-boot, the accessibility service on a
first install) is forwarded to that payload as well as to the active one, so it is
not lost until the next restart. The shell does not
read settings; it deletes one file, whose path it shares with the payload through
`PayloadState` in `shell-api`. A payload built from this revision therefore needs
a shell built from this revision or later.

## The fleet CLI

`cli/daylight-device.cli.mjs` talks to any device by name. It reads the device's
address and token from `{private-tokens-file}` (`$DAYLIGHT_ANDROID_TOKENS`, or
`$DAYLIGHT_BASE_PATH/data/household/auth/daylight-android.yml`) and the ports from
the device file.

`node cli/daylight-device.cli.mjs help` prints every command. `dd` below stands
for `node cli/daylight-device.cli.mjs <device>`.

| Command | Route |
|---|---|
| `dd status`, `dd capabilities`, `dd info` | `GET /status`, `/capabilities`, `/debug/info` |
| `dd settings`, `dd settings get <key>`, `dd settings set <key> <value>`, `dd settings reset <key>` | `GET`, `POST`, `DELETE /settings` |
| `dd payload`, `dd payload push <url> <sha256>`, `dd payload rollback` | `GET /payload`, `POST /payload`, `POST /payload/rollback` |
| `dd update`, `dd update <apk-url> [sha256]` | `GET /update`, `POST /update` |
| `dd lifeline [status\|rollback\|restart\|reset-settings\|owner-release\|log]` | The lifeline port |
| `dd kiosk` | `GET /kiosk/status` |
| `dd load <url> [--no-wait]` (alias `url`), `dd load-start`, `dd reload` | `POST /kiosk/load`, `/kiosk/load-start`, `/kiosk/reload` |
| `dd foreground`, `dd renderer-reset`, `dd restart` | `POST /kiosk/foreground`, `/kiosk/renderer/reset`, `/kiosk/restart` |
| `dd overlay text [message]`, `dd overlay url [<url>] [--gravity top\|bottom]`, `dd overlay clear` | `POST /kiosk/overlay` |
| `dd screen on\|off`, `dd brightness <0-255>`, `dd reboot` | `POST /screen`, `/screen/brightness`, `/device/reboot` |
| `dd volume [get] [--stream n]`, `dd volume set <0-100> [--stream n]` | `GET /volume`, `POST /volume` |
| `dd speak [--locale tag] <text>` (alias `tts`), `dd sound <url> [--loop] [--stream n]`, `dd sound stop` | `POST /speak`, `POST /sound` |
| `dd launch <package> [activity]`, `dd launch --intent <uri>` | `POST /launch` |
| `dd lockdown`, `dd lockdown lock`, `dd lockdown unlock [minutes]` (aliases `lock`, `unlock`) | `GET /lockdown`, `POST /lockdown/lock`, `/lockdown/unlock` |
| `dd lockdown input lock [--revision n] [--for minutes]`, `dd lockdown input release [--revision n]` | `POST /lockdown/input` |
| `dd lockdown home on\|off` | `POST /lockdown/home` |
| `dd lockdown owner release`, `dd lockdown owner resume`, `dd lockdown owner transfer <package/receiver>` | `POST /lockdown/owner/release`, `/lockdown/owner/resume`, `/lockdown/owner/transfer` |
| `dd shot [file]` | `GET /debug/screenshot`; writes the PNG and prints its path |
| `dd eval [--timeout ms] <js>`, `dd eval-file <path>` | `POST /debug/eval`; prints the result |
| `dd html [file]` | `GET /debug/html` |
| `dd fps [ms] [--min n]`, `dd jank [minFps]` | `GET /debug/fps` |
| `dd exec [--timeout ms] <command>` | `POST /debug/exec`; prints the output |
| `dd logcat [lines] [filter]` | `GET /debug/logcat` |
| `dd get <path> [key=value ...]`, `dd post <path> [key=value ...] ['{json}']` | Any route on the control port |

`get` and `post` reach every route on the control port, for the routes that have
no named command. Each `key=value` becomes a query parameter, and an argument
that starts with `{` is sent as the JSON body. For example
`post /speaker/bt-cycle settleMs=5000`, `post /bluetooth/scan '{"durationMs":5000}'`
and `get /mic/status`.

`settings set` sends the value as the text that was typed. The device coerces it
to the setting's declared type, so `true` sets a boolean setting to true and sets a
string setting to the text `true`.

Exit codes: 0 for success; 1 for a non-2xx status (a lifeline `409` included), for
an answer with `ok: false`, and for `fps --min` below its minimum. `jank` wakes the
screen, samples the live page for a second and exits 0 at or above its threshold
(20 by default), 1 below it, and 2 when there is no reading (display off, no
page, device unreachable). `exec` exits with the remote command's own code, and
124 when the command timed out. `shot` refuses anything that is not a PNG and
writes nothing then. `logcat` adds a line on stderr when the text holds this app's
lines only.

The token is sent as a header. It is never in a URL, and every line the CLI
prints, errors included, has it removed.

For someone coming from `cli/fkb.cli.mjs`:

| `fkb` | `daylight-device <device>` |
|---|---|
| `info` | `kiosk` (page, battery, memory, WiFi), `status`, `info` |
| `shot [path]` | `shot [file]` |
| `get [key]`, `set <key> <value>` | `settings`, `settings get <key>`, `settings set <key> <value>` |
| `reload` | `load-start` (the start URL) or `reload` (the current page) |
| `url <url>` | `load <url>` |
| `restart` | `renderer-reset` (the renderer) or `restart` (the payload) |
| `screen on\|off`, `brightness <n>`, `tts <text>`, `launch <package>` | The same words; `speak` is the name, `tts` an alias |
| `inject <js>`, `inject-file <path>` | `eval <js>`, `eval-file <path>`: in the live page, with no reload, and the value comes back |
| `fps`, `jank [minFps]` | `fps [ms] [--min n]`, `jank [minFps]`: the same exit codes as `fkb jank`, with no reload |
| `install <apk-url>` | `update <apk-url> [sha256]` |
| `adb <shell command>` | `exec <command>` once `debug.execEnabled` is true; `logcat [lines] [filter]` |
| `cmd <fullyCmd> [k=v]` | `get <path>`, `post <path>` |
| `keepawake`, `recovery` | Not commands: they are settings with those defaults (`power.*`, `recovery.*`) |
| `back-script` | Not needed: `webview.backButton` |

What the CLI cannot do: OS-level globals that only ADB's shell user may change
(`settings put global ...`), since `exec` runs as the app.

## Checking a build

`node _extensions/daylight-android/tools/verify-build.mjs <device>` compares a built
APK with its device file: package, SDK levels, version code, the exact permission
set (a permission declared as `uses-permission-sdk-23` or with a `maxSdkVersion`
must be stated that way in the capability's file), the declared activities,
aliases, services, receivers and providers (exactly those of the base shell, of
the listed capabilities' shell halves, and the HOME alias the generated manifest
adds to a build that lists `lockdown`), each component's `exported` flag and the
permission that guards it against a table in `tools/verify-lib.mjs`, that the
HOME filter exists only on the disabled alias, that a lockdown build's kiosk
Activity is not resizable, and that the baked payload holds the entry
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

Two base permissions are expected only of a kiosk (a device that lists `lockdown`,
or `webview-host` with a control bind other than `none`):
`REQUEST_INSTALL_PACKAGES` and `WRITE_SECURE_SETTINGS`. They come from the
generated device manifest of such a build and are absent from the phone's APK;
the verifier fails a phone APK that has either.

`./gradlew build` also reads each device's merged manifest back
(`:shell:check<Device>MergedManifest`) and fails when a HOME filter sits anywhere
but on a disabled alias declared after its target.

With `--legacy` it also compares the APK's permissions with what the old helper
app for that device declared, using
`_extensions/daylight-android/tools/legacy-permissions.yml`: every addition and
removal must be recorded there with its reason. That file is the permission
ledger: per device, the old app's list, `added` (permission and reason) and
`dropped`. The check is new = old + added - dropped, and it passes for all three
devices; each addition (the kiosk's page microphone and camera, the overlay
grant, `QUERY_ALL_PACKAGES`, `WRITE_SETTINGS` and the shared core features) is
listed there with its reason.

## Not covered by JVM tests

The build's tests run on the JVM against `android.jar`, whose classes do nothing
there: a `Handler` never runs what is posted to it, a `HandlerThread` has no
looper, and there is no Bluetooth adapter, MIDI service, audio service or window
manager. Each capability has a test that starts it for real over a fake context
(`FakeContext` in `core-testing`, which records receiver registrations and answers
`getSystemService`) and checks that `stop()` gives back what `start()` took. How
much that shows differs by capability:

| Capability | What the JVM test starts and sees released | What it cannot see |
|---|---|---|
| `mic-bridge` | The stream socket bound and freed; overlapping restarts; a microphone opened late or held at stop (with a fake `AudioRecord`) | The overlay window, and capture from a real microphone |
| `volume-keys` | The key filter added to and removed from the accessibility hub; the filter's decisions | The beep guard's content observer, real key events |
| `hid-input` | Both broadcast receivers registered and unregistered | USB reads, the permission dialog on screen, Bluetooth |
| `lease-gate` | The loop over a fake platform: blocked at start, wake lock held and released, nothing running after stop | The real wake lock, the HTTPS request, a real package gate |
| `webview-host` | The event subscription and the offer of the session to the Activity | Everything past the Activity completing the attach: the WebView, its detach on stop, the network callback |
| `audio-guard` | The connector and guard built and dropped, the guard's volume receiver registered and unregistered, the bt-cycle thread ended | The connector's own receivers and profile proxy, which it sets up on a Handler thread |
| `presence` | The reporter built and dropped; the HTTP report with its token header | Its receiver and profile proxies, which need a Bluetooth adapter |
| `media-service` | The worker thread and the `media` port taken and given back; browse, resolve and progress decisions over a fake backend | The Media3 player and session, audio focus, the media notification, every car and headset |
| `quick-input` | The upload thread and the `memos` port taken and given back; an upload of a file dropped in the inbox over a fake backend | The recorder, the microphone, the network callback (the fake context has no connectivity service) |
| `notifications` | The `links` port; a post and a cancel over a context with no notification service, which do nothing and do not throw | A notification on a screen, its channels, the permission dialog, a tap |
| `midi-bridge` | The link built and dropped; the force-reset thread ended | The connector, which needs the MIDI service |
| `lockdown` | The watcher's timer, the focus subscription, the accessibility event listener and the touch observer taken and given back; a tick with no watcher recalling through a fake kiosk window; unlock, relock and the stored state; the PIN flow; the package gate; the input lock | Every Android call: window samples, the accessibility start, HOME resolution, device-policy calls, the status-bar shield, the Control Center swipe |
| `screen-power` | The screen receiver registered and unregistered, the note-bus wake and its worker thread; which screen-off path is chosen | The wake locks, `lockNow`, the accessibility lock action, what the display does |
| `volume` | The routes over fake streams | `AudioManager` |
| `app-launcher` | The whole decision over a fake resolver: what is refused is never started, lockdown is told before a start | `PackageManager` resolution, `Intent.parseUri`, the start itself |
| `debug-tools` | Every route over a scripted page and fake engines: gating, validation, timeouts, caps, what is logged; a real shell for exec; the generated page scripts run in Node against a stand-in window; the context taken at start and the engines released at stop | `evaluateJavascript` in a real WebView, the bitmap capture, `TextToSpeech`, `MediaPlayer`, `logcat` on a device and the `READ_LOGS` check |

These classes have no behavioral test on the JVM and were not restructured to get
one. They are the on-device acceptance list:

- `MidiLink` and `BleMidiConnector`: scan, connect, reconnect after a drop, the
  retry timer, the force-reset ladder against a real radio.
- `A2dpConnector`: connect, reconnect, the sweep, its receivers on its own thread.
- `AudioGuardHost`: the audio device callback, the guard's reconcile on its thread.
- `SynthHost` and the native engine: presets, the output gate, the stream reopening.
- `RoleBluetoothPort` and `GamepadBluetoothPort`: pairing, the pairing dialog, scans.
- `KioskSession` past the attach: the WebView, page load recovery, overlays.
- `OwnUpdateConfirmation` and `UsbPermissionAutomator` against the real dialogs
  (their rules are tested; the tap is not).
- `lockdown`: that a recall takes on each device, the HOME role, immersive mode,
  the status-bar strip, lock task and the owner policy, the PIN prompt, the
  Control Center dismissal.
- `screen-power`: screen off by `lockNow` and by the accessibility lock action,
  screen on by wake lock on each device, the `screen` event on the Portal.
- `app-launcher`: resolving and starting a real app, an `intent:` URI as Android
  parses it, and the launch being seen in front.
- `debug-tools`: `Speaker` and `SoundPlayer` (no JVM test at all), the screenshot
  of each device's page, eval and the frame counter in each device's WebView,
  the log scope with and without `READ_LOGS`, and exec as the app's uid.
- The fleet CLI against a device: its request building and answer handling are
  tested with a fake `fetch`; no command has been sent to hardware.

What the JVM tests of the review fixes do not show, and a device has to:

- `PackageManager.setComponentEnabledSetting` on the HOME alias, and that a
  disabled alias is not offered as a home app on each device's Android version.
  The build and the verifier check the manifest; the device's own answer is the
  runbook's check.
- Every `DevicePolicyManager` call. The owner policy, its release and the
  transfer are tested against a recording stand-in. `transferOwnership` has not
  run on the Portal's firmware in either direction.
- The lifeline's owner release: its order and reporting are tested; the calls it
  makes are not.
- Which devices' WebViews report document-start injection, and so which get the
  page bridge at all.
- The order in which a WebView reports a navigation's start and a new document's
  first bridge call. The token rule tolerates either order by design; that the
  page's own token keeps working through a navigation is a device check.
- That `shouldOverrideUrlLoading` and `onPageStarted` are called for every
  main-frame navigation a page can cause (a form post, a server redirect, a
  script). The policy is tested; the callbacks are Android's.
- The kiosk Activity's retry of a controller that threw. Its delays are tested;
  the Activity is not.
- The fixed-delay watcher timer, the keyguard read, and what the accessibility
  window list holds in split screen. The decision is tested with window lists
  written by hand.
- The coexistence switches against the real hardware and the real old helpers:
  that a part released here can be taken there, and the reverse.

## Known limits

- Installing a build that lists `lockdown` adds a second home-app candidate to the
  device. Whether Android then asks which home app to use has not been checked on
  any device; it must be, before such a build is installed on a kiosk in use.
- With `lockdown.enabled` false (every device file today) the Shield's lease is
  not enforced: the gate is not ready, as it was not with the old lease app.
- A package the gate has closed is only kept from the front. It is still running.
- The exit gesture's wrong-PIN count is kept in memory and starts again when the
  payload restarts.
- `POST /debug/exec` kills a command's own process at its timeout. A child that
  process started and that outlives it is not followed.
- `GET /debug/screenshot` may show a video surface, WebGL content or another app's
  window as black or not at all.
- `POST /sound` checks the URL it is given. A redirect that URL answers with is
  followed by the player and is not checked again.
- `POST /debug/eval` runs with the page's own authority: it can read anything the
  page can. It is behind the device token like every route; treat the token
  accordingly.
- The exit PIN is a runtime setting only. A device has no exit gesture until
  `settings set lockdown.exitPin <pin>` is run against it.
- **Only a debug build exists.** Every APK is debuggable and signed with the
  Android debug key; no release signing is configured. Accepted, with this
  consequence: where ADB is enabled, `run-as <package>` reads the app's private
  storage, which holds the control token and the stored settings, secret ones
  included. ADB is enabled on these devices by design, so ADB access to a device
  is access to its token. `verify-build.mjs` prints the build type it checked.
- Fully Kiosk Browser and the old helpers still run every device.
- Nothing from phase 2 or phase 3 has run on a device.
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
