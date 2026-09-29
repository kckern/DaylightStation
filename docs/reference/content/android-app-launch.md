# Android App Launch (menu → kiosk → Android app)

How a menu entry opens an Android app on a Fully Kiosk Browser (FKB) device
such as the living-room Shield, and how the backend keeps that trip from
wandering.

## Menu entry

A list item whose `input` starts with `android:` is an Android launch:

```yaml
- input: android:us.zoom.videomeetings/com.zipow.videobox.LauncherActivity
  action: Android
  label: Zoom
- input: android:com.android.tv.settings/.accessories.AddAccessoryActivity
  action: Android
  label: Pair Controller
```

`ListConfigCodec` turns it into `{ android: { package, activity } }`, and the
menu opens `AndroidLaunchCard` (`frontend/src/modules/Menu/`).

- **With an activity** (`package/activity`): the card launches exactly that
  screen through FKB's `startIntent` (`launchAndroidTarget` in `lib/fkb.js`).
  A leading `.` in the activity is relative to the package.
- **Package only**: the card launches the app's default entry through FKB's
  `startApplication` (`launchApp`).

The card counts the launch as confirmed when FKB fires `onResume` (the user
came back). If FKB is still in front after 2.5 s, the launch failed and the card
offers a retry.

## What Fully's kiosk mode actually blocks

Measured on the living-room Shield (2026-09-26), kiosk mode on:

| Launched by | Target | Result |
|---|---|---|
| ADB / anything outside FKB | any app, whitelisted or not | FKB takes the foreground back within 1 s |
| FKB itself (`startIntent`, `startApplication`) | any app, **whitelisted or not** | opens and stays |
| outside FKB, while a whitelisted app FKB opened is in front | Settings | blocked |
| outside FKB, while a **Settings** screen FKB opened is in front | rest of Settings | **allowed** |

So `kioskAppWhitelist` / `appWhitelist` do not gate the menu's launches. The
catch is the last row: once FKB has opened any Settings screen, the Shield
remote's Settings button reaches all of Settings until the user comes back.

## Excursion guard

`AndroidLaunchCard` announces each launch to
`POST /api/v1/device/:deviceId/excursion` `{ package, activity }` before it
leaves the page. The notice is held for at most 1.5 s, and a slow or
unreachable backend never stops the launch.

`AndroidExcursionGuard` (`backend/src/3_applications/devices/services/`)
guards only packages that have a policy (`EXCURSION_POLICIES` in
`5_composition/modules/deviceApi.mjs`):

| Package | Allowed screens | Cap |
|---|---|---|
| `com.android.tv.settings` | `.accessories.*` (pairing screen, PIN dialog) | 10 min |

While guarding, it polls the foreground screen over the device's ADB fallback
every 1.5 s (`AndroidForegroundProbe`):

- **The kiosk is back in front** after the trip: the guard stops (`returned`).
- **An allowed screen is in front**: nothing happens.
- **Any other screen or app is in front, or the cap is reached**: the guard
  presses HOME (the kiosk is the home app) and stops (`tripped`).
- **The trip never starts** within 10 s: the guard stops (`never-left`).
- **ADB fails** 5 polls in a row: the guard stops (`probe-failed`).

The guard runs only during an excursion. Other launches (Zoom, BYUtv, …)
answer `guarded: false, reason: no-policy` and start nothing.

**Limit:** the guard needs ADB. ADB-over-WiFi does not survive a Shield
reboot, so until ADB is reconnected the Settings gap during pairing is open
(`device.excursion.ended reason=probe-failed`).

### Logs

`device.excursion.started`, `device.excursion.tripped` (warn, with
`foreground`), `device.excursion.ended` (`reason`),
`android-launch.attempt` / `android-launch.excursion-announced` from the card.

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="device.excursion" AND _time:24h'
```

## Pairing a controller by hand (no menu)

If the menu is unavailable, turn kiosk mode off with `node cli/fkb.cli.mjs set
kioskMode false` (with `FKB_HOST` and `FKB_PW` set for the device). Then open
the pairing screen with `adb shell am start -f 0x10008000 -n
com.android.tv.settings/.accessories.AddAccessoryActivity`, and restore kiosk
mode afterwards. FKB's REST API does not answer while FKB is in the background,
so bring FKB to the front over ADB (`input keyevent KEYCODE_HOME`) before
re-enabling kiosk mode.
