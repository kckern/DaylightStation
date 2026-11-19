# Fully Kiosk Admin Console

The Admin app provides a server-proxied control surface for every registered
device whose `content_control.provider` is `fully-kiosk`, and for devices on
the DaylightStation Android kiosk app (`daylight-android`, see
[below](#devices-on-the-android-kiosk-app)):

```text
/admin/household/devices/{deviceId}/fully-kiosk
```

Open a device from **Admin → Household → Devices**, then select **Fully Kiosk
Console**. The link is intentionally absent for devices using other content
providers.

## Capabilities

The console reads `getDeviceInfo`, displays a current PNG screenshot, exposes
the complete non-secret settings list, and groups safe operations for:

- screen power, brightness, foregrounding, screensaver, and page navigation;
- kiosk locking and maintenance mode;
- Fully Kiosk/WebView restart and device reboot;
- Music-stream volume, text-to-speech, and overlay messages;
- launching a validated Android package, with registered `companion_apps` as
  shortcuts.

The settings table is read-all/edit-curated. Credentials and credential-like
values are masked by the backend and are never returned to the browser. Only
the documented display, recovery, web/media, and screensaver settings render
editable controls.

## Admin API

All endpoints are beneath:

```text
/api/v1/admin/household/devices/{deviceId}/fully-kiosk
```

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/status` | Normalized summary plus full non-secret device information |
| `GET` | `/screenshot` | Uncached `image/png` with `X-Captured-At` |
| `GET` | `/settings` | Typed settings with `editable` and `sensitive` metadata |
| `POST` | `/actions/{action}` | Validated semantic operation |
| `PUT` | `/settings/{key}` | Apply one curated setting using `{ "value": ... }` |

The browser submits only a registered device ID and semantic operation. The
backend resolves the device address, remote-admin port, `auth_ref`, and password
from current household configuration for every request.

## Safety boundaries

- Fully Kiosk passwords stay server-side and authenticated vendor URLs are
  never written to structured logs.
- URL loads accept only absolute HTTP(S) URLs. App launches accept Android
  package names, not intents. Unknown action parameters—including a client
  supplied host, intent, or debug option—are rejected.
- Screenshots are never cached. Failed refreshes invalidate the displayed image
  so an old screen is not presented as current.
- JavaScript injection, raw commands, shell/root access, log retrieval,
  file/APK management, and credential editing are outside this surface.
- Live automated verification is read-only. Commands that affect a physical
  device require an operator to use the console.

## Devices on the Android kiosk app

A device whose `content_control.provider` is `daylight-android` uses the same
console page and the same Admin API path (the `fully-kiosk` path segment is
historical). Its entry on the device page reads **Kiosk Console**. The backend
looks up the device's provider on every request and sends the call to
`DaylightAndroidRemoteAdministrationAdapter`; every other device id goes to the
Fully adapter, so a fleet can hold both providers at once and Fully devices
behave as before.

`GET /status` carries `provider` (`fully-kiosk` or `daylight-android`) for
every device, and `capabilities.actions` lists the actions that device has.
The console words itself from the first ("Kiosk" for the Android kiosk app,
"Fully Kiosk" otherwise) and shows only the controls in the second.

What differs for these devices:

- **Actions.** The action names are the same. The app has no screensaver, so
  `screensaver-start` and `screensaver-stop` are left out of
  `capabilities.actions`, their buttons are hidden, and a direct call is
  refused with `INVALID_ACTION`. `maintenance-enable` unlocks the kiosk for a
  fixed window, after which the app relocks itself; `maintenance-disable`
  locks it.
- **Status.** The summary uses the same field names. Fields the app does not
  report (storage, orientation, licence, screensaver state) are empty.
- **Settings.** The list shows the app's own setting keys, which are dotted
  (for example `webview.startUrl`). The app declares a type for each one
  (`STRING`, `BOOLEAN` or `INTEGER`) and rejects unknown keys and wrong types
  itself, so a listed setting is editable; the backend checks only that the
  key is listed and the value has the declared type. An integer is edited as
  a number with no range limit. A few are listed and never editable from the
  console, because changing them widens what the device will do or who may
  drive it: every `debug.*`, `control.*` and `lockdown.*` setting
  (`lockdown.required` among them, which the device itself never accepts), and
  `webview.bridgeOrigins` and `webview.startUrl`. A write to one is refused
  with the same error as a Fully setting off the whitelist, before it reaches
  the device. Credential-like keys stay
  masked and read-only. The curated whitelist above still applies to Fully
  devices, whose settings carry no types.
- **Restart and reboot.** The app answers and then goes away, and the
  connection can drop first. For `restart-app` and `reboot`, a drop or timeout
  after the request went out is reported as sent; a connection that was never
  made is still an error. When the device cannot reboot itself, the message
  carries the device's reason (for example "device owner required").
- **When the kiosk cannot act.** A device that is in the wrong state for a
  command answers 409, and the console shows why in plain words
  (`DAYLIGHT_ANDROID_CONFLICT`: "the kiosk window is not open", "the kiosk is
  not in front", "an update is already running"). A device that answered and
  then failed on a page or download gives `DAYLIGHT_ANDROID_DEPENDENCY_FAILED`
  (502) or `DAYLIGHT_ANDROID_DEVICE_TIMEOUT` (504), which are different from
  the device itself not answering.
- **Home alias.** Turning the app's HOME alias on or off
  (`POST /lockdown/home`) is not offered here. It changes which app the
  device's home button opens, and is done from the device's command line tool.
- **Errors.** Gateway failures carry `DAYLIGHT_ANDROID_*` codes
  (`_TIMEOUT` 504, `_UNREACHABLE` / `_AUTH_REJECTED` / `_COMMAND_REJECTED` /
  `_INVALID_RESPONSE` 502, `_CONFIGURATION_ERROR` 503, `_UNSUPPORTED` 501),
  beside the `FKB_*` codes Fully devices return.
- **Credentials.** The per-device token stays server-side, is sent only as a
  request header, and is never logged.

Device configuration is described in
[ADB integration](./adb.md#the-daylight-android-provider).

The in-page JavaScript bridge is a separate integration described in
[Fully Kiosk JavaScript API](./fully-kiosk-js.md). The Admin console uses the
LAN REST API and does not depend on that bridge being present in the loaded page.
