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

What differs for these devices:

- **Actions.** The action names are the same. `screensaver-start` and
  `screensaver-stop` are refused with `INVALID_ACTION`, since the app has no
  screensaver. `maintenance-enable` unlocks the kiosk for a fixed window, after
  which the app relocks itself; `maintenance-disable` locks it.
- **Status.** The summary uses the same field names. Fields the app does not
  report (storage, orientation, licence, screensaver state) are empty.
- **Settings.** The list shows the app's own setting keys, which are dotted
  (for example `webview.startUrl`). The editable set in the console is curated
  for Fully's setting names, so these keys are read-only there.
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
