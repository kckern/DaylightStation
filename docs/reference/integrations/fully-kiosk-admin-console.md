# Fully Kiosk Admin Console

The Admin app provides a server-proxied control surface for every registered
device whose `content_control.provider` is `fully-kiosk`:

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

The in-page JavaScript bridge is a separate integration described in
[Fully Kiosk JavaScript API](./fully-kiosk-js.md). The Admin console uses the
LAN REST API and does not depend on that bridge being present in the loaded page.
