# DaylightStation Android

One Android codebase builds a separate app for each household device from a device
file (`_extensions/daylight-android/devices/<id>.yml`). This page describes how a
built app behaves and how to operate it. Building, adding a device and adding a
capability are covered in `_extensions/daylight-android/README.md`.

## Status: Phase 1, foundation only

**Phase 1 has no kiosk.** There is no WebView, no screen control and no ported
helper code. Fully Kiosk Browser still runs every device, and the existing helper
apps are unchanged. The Phase 1 app is a separate package that runs beside them. It
starts a service, answers a control API and can replace its own logic over the
network. On 2026-11-16 the phase 1 build was installed on the Portal beside the
existing apps; the payload loaded and the control API answered; reboot survival was
not tested. Everything added since then is covered by JVM tests only.

**Phase 2 is in progress and nothing of it has been installed.** It copies the
working helper code out of the old helper apps into this codebase. So far the
`piano`, `portal` and `shield` device files build, the core has gained the
heartbeat, log shipping, Wi-Fi link telemetry, diagnostics, self-update and payload
routes listed below, and the piano build carries `audio-guard` (speaker routes
under `/speaker` and `/audio-guard`), `synth` (the native sfizz sampler) and
`midi-bridge` (the BLE-MIDI link) and `bluetooth-controls` (the Bluetooth panel),
and the Shield build carries `bluetooth-controls` in gamepad mode; see
"Capabilities". The old helper apps still run every device.

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
| POST | `/update` | JSON body `{"url": ...}`; downloads the APK and hands it to the system installer; answers `{state}` |
| GET | `/update` | `state` (`idle`, `downloading`, `awaiting_confirmation`, `failed`) and `lastError` |
| GET, POST | `/beat` | The heartbeat's state; `POST` sends one now and returns its body |
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
larger than 256 MiB is abandoned. The install itself needs a tap on the
device's confirmation dialog unless the app is device owner; with
`update.autoConfirm` on, the app taps its own dialog through its accessibility
service. The outcome is written to the shell log (lifeline `GET /log`).

The automatic tap happens only when all of these hold: an update this app started
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

No Phase 1 route returns 501. The code is reserved for capabilities that run on some
devices and not others.

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
whether an override is in effect. A stored override that no longer fits the
setting's type is ignored and the default applies.

Settings the core declares on every device:

| Key | Type | Fallback | Meaning |
|-----|------|----------|---------|
| `heartbeat.enabled` | boolean | true | Send the outbound heartbeat |
| `heartbeat.intervalMs` | integer | 60000 | Its period; 10 seconds is the minimum |
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

A string default in a device file may hold a `{placeholder}`. It is replaced at
build time from the `placeholders:` map of `{private-tokens-file}`, so addresses
and device identities stay out of the repo. A placeholder with no value fails the
build of that device and names the placeholder, never a value.

## Capabilities

What each ported capability adds to a device that lists it. HTTP routes need the
token like every other route; WebSocket messages are JSON text frames on the
control port, keyed by `type`.

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

`/status` and `/diagnostics` carry `engine` and `preset`. The synth provides the
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
| HTTP | `POST /reset` | Reconnect, then bounce the Bluetooth radio if the echo still fails; answers `fixed`, `recoveredAt`, `steps` |
| HTTP | `GET /loopback`, `POST /loopback` | The echo check's rolling state; `POST` probes now and waits for the echo |
| HTTP | `POST /tone?note=&velocity=&ms=` | One audible note, then an echo probe |
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

## Lifeline

Served by the shell on `control.lifelinePort`.

| Method | Path | Result |
|--------|------|--------|
| GET | `/` or `/status` | Shell `port`, `versionCode`, `device`, and the payload status |
| GET | `/payload` | Payload status: `current`, `previous`, `active`, `activeVersion`, `starting`, `available`, `baked`, `shellStamp`, `bootsThisPayload`, `lastFailed`, `lastError` |
| POST | `/payload?url=<jar-url>&sha256=<64 hex>` | Fetch the jar, verify it, activate it; falls back if it fails to start |
| POST | `/payload/rollback` | Go back to the previous payload |
| POST | `/restart` | Stop and start the current payload in place |
| GET | `/log` | The tail of the shell's log, as plain text |

Swap, rollback and restart are accepted and then run in the background. An
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
| 405 | Rollback or restart with a method other than POST |
| 409 | The loader refused the action; `error` holds the reason |
| 500 | The route threw |
| 503 | The payload loader is not ready yet |

The lifeline has no route that runs commands. It is kept small on purpose.

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
node cli/daylight-device.cli.mjs <device> lifeline log
```

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
set, and that the baked payload holds the entry classes of the listed capabilities
and no others. It also compares the sha256 of the payload baked into the APK with
the `.sha256` file the payload build wrote, and fails when the APK holds a
different payload than the one just built. It also checks that the shell
service's foreground service types are exactly the device file's, and that a
capability with native code ships a library for every ABI of the device. For a
device that lists `synth` it reads the synth library out of the APK for each ABI
and fails unless it holds the JNI exports of the APK's engine class and sfizz
itself. It exits 1 on any difference.

With `--legacy` it also compares the APK's permissions with what the old helper
app for that device declared, using
`_extensions/daylight-android/tools/legacy-permissions.yml`: every addition and
removal must be recorded there with its reason. Until phase 2 is complete this
fails for every device, listing the permissions still to come.

## Known limits

- No kiosk, WebView or helper features. Fully Kiosk Browser still runs every device.
- The token is compiled into the shell, so rotation needs a new install.
- Device defaults are validated when the payload starts, not at build time.
- A force-stopped app stays stopped until it is opened or the device reboots.
- Loading the payload with `DexClassLoader` can only be proven on a device, and
  that check is not part of the automated build.
- A shell reinstall is detected by `versionCode` only.
- A start that misses its deadline leaves its thread behind until that start
  returns; the payload is stopped when it does.
- When a request is refused with its body unread (a `413`, or a `401` with a body
  over 64 KiB), the connection is closed, and a client still sending may see a
  reset instead of the status.
