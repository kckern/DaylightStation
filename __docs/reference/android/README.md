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
network. It has not been installed on a household device as part of this phase's
automated work; the on-device smoke test is a separate, owner-run step.

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
- If a payload fails to start, the loader goes back to the previous one at once.
- If the process starts 3 times within 10 minutes on the same payload, the next
  start rolls back before loading it.
- With no stored payload, the loader uses the one baked into the APK.

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
`{"ok":false,"error":"unauthorized"}`.

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

The only setting today is `debug.execEnabled` (boolean, default false). Nothing
reads it yet.

## Lifeline

Served by the shell on `control.lifelinePort`.

| Method | Path | Result |
|--------|------|--------|
| GET | `/` or `/status` | Shell `port`, `versionCode`, `device`, and the payload status |
| GET | `/payload` | Payload status: `current`, `previous`, `active`, `activeVersion`, `available`, `bootsThisPayload`, `lastError` |
| POST | `/payload?url=<jar-url>&sha256=<hex>` | Fetch the jar, verify it, activate it; falls back if it fails to start |
| POST | `/payload/rollback` | Go back to the previous payload |
| POST | `/restart` | Stop and start the current payload in place |
| GET | `/log` | The tail of the shell's log, as plain text |

Swap, rollback and restart are accepted and then run in the background. The
response says `accepted: ...` or `refused: ...` in `result`; check `/payload`
afterwards for the outcome.

Lifeline errors are `{"ok":false,"error":"<text>"}`:

| Status | When |
|--------|------|
| 400 | A swap without both `url` and `sha256` |
| 401 | Missing or wrong token |
| 404 | Unknown path |
| 405 | Rollback or restart with a method other than POST |
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

`settings set` sends `true` / `false` as booleans and whole numbers as integers;
anything else is sent as a string. The CLI prints the response, and on a non-2xx
status also prints the status and exits 1. It never prints the token.

The CLI has no command for a payload swap yet. Send that request to the lifeline
directly.

## Checking a build

`node _extensions/daylight-android/tools/verify-build.mjs <device>` compares a built
APK with its device file: package, SDK levels, version code, the exact permission
set, and that the baked payload holds the entry classes of the listed capabilities
and no others. It exits 1 on any difference.

## Known limits

- No kiosk, WebView or helper features. Fully Kiosk Browser still runs every device.
- The token is compiled into the shell, so rotation needs a new install.
- Device defaults are validated when the payload starts, not at build time.
- A force-stopped app stays stopped until it is opened or the device reboots.
- Loading the payload with `DexClassLoader` can only be proven on a device, and
  that check is not part of the automated build.
