# DaylightStation Android: the kiosk

The six capabilities that replace Fully Kiosk Browser on a device: the kiosk
window and its page bridge (`webview-host`), `lockdown`, `screen-power`, `volume`,
`app-launcher` and `debug-tools`. This page is their reference: every route with
its error codes, every setting, the page bridge, the lockdown modes per device,
the one-time ADB grants, and what an operator used to Fully will notice.

The rest of the app (shell and payload, the two ports, authentication, the core
routes, the settings model and the complete settings table, the helper
capabilities, the lifeline, the fleet CLI) is in
`__docs/reference/android/README.md`. Switching a device over is
`__docs/runbooks/android/kiosk-cutover.md`.

**None of this has run on a device.** Everything below is what the code does under
JVM tests and what the built APKs declare. The one hardware fact is the phase 1
smoke test on the Portal on 2026-11-16 (shell, payload loader, control API).

All routes are on the control port and need the `X-Daylight-Token` header. The
error shapes and the codes every route shares (`401`, `400`, `404`, `405`, `501`)
are in the main reference under "Control API".

## `webview-host`

The kiosk window. The shell half declares `KioskActivity` (the app's one launcher
entry: a build that lists `webview-host` takes the launcher filter off the shell's
setup Activity) and ships `androidx.webkit`. The Activity decides nothing; it hands
itself to the payload, which builds the WebView in it on the main thread. A payload
swap or restart detaches and re-attaches without the Activity going away, and with
no payload the Activity shows one line of grey text on black.

`webview.startUrl` is the start page. Empty means not configured: the screen says
so, and `GET /kiosk/status` answers `ready:false` with `reason`. Each device file
sets it to a placeholder (`{piano_start_url}`, `{portal_start_url}`,
`{shield_start_url}`) that is resolved from `{private-tokens-file}` when that
device is built; a build test fails a start URL that is not https.

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

**The page bridge.** `window.daylight` is given only to frames of an allowed
origin (`webview.bridgeOrigins`, or the start URL's origin when that is empty). The
native object behind it is visible to every frame (an Android rule), so it answers
only to a per-WebView token that the allowed frames hold, and only while the main
frame is on an allowed origin. A page on another origin has no `window.daylight`.
The bridge is rebuilt with the WebView, so `POST /kiosk/renderer/reset` applies a
changed origin list.

| Member | Answer |
|---|---|
| `daylight.version`, `daylight.deviceId` | The payload version and the device id, as strings |
| `daylight.capabilities()` | A JSON array string of this build's capability names |
| `daylight.launch(json)` | `true` when accepted. `json` is `{package, activity?, action?, extras?}` or `{intent}`; the same checks as `POST /launch` |
| `daylight.screen(on)` | `true` when accepted; `false` on a device with no way to do it |
| `daylight.restartApp()` | Restarts the payload in place |
| `daylight.reboot()` | `false` unless this app is device owner |
| `daylight.setBackMode(mode)` | `"page"`, `"reload"` or `"ignore"`; anything else is ignored |
| `daylight.volume(stream)` | A JSON string `{level, index, maxIndex}`, or `{}` in a build with no `volume` |

Calls return at once; what they start happens afterwards. Events are DOM
`CustomEvent`s on `window`:

| Event | `detail` | When |
|---|---|---|
| `daylight:resume` | `{awayMs, from}` | The kiosk Activity came back to the front; `from` is the package that was there, or null |
| `daylight:pause` | `{to}` | Another app took the front |
| `daylight:back` | `{}` | Back was pressed, in back mode `page` only |
| `daylight:screen` | `{on}` | The display turned on or off |
| `daylight:key` | `{code, action}` | A key in `webview.interceptKeys`, or a volume key on a device with `volume-keys` |
| `daylight:network` | `{connected}` | The network came or went |

Remote and keyboard keys that Android delivers to the WebView are not
intercepted; the page receives them as ordinary `keydown` events.

The bridge is that list and no more. It cannot read or write a setting, unlock
the kiosk, run a script or a command, or reach any `debug-tools` route; those are
the control API's, behind the device token. The same holds for the WebSocket: a
client can send only the message types the main reference lists, and none of
them reaches these.

**What reloads the page, and what does not.** A page is reloaded by the app only
when it is already dead: its load failed (retry after
`recovery.reloadOnPageFailureSec`, doubling to `recovery.maxRetrySec`), the network
returned while the page was in that failed state, its renderer process went away,
or its renderer stayed unresponsive for `recovery.rendererUnresponsiveSec`. A slow
page is alive and is left alone, and so is a healthy page while the network comes
and goes: the page's own sockets reconnect. There is no heartbeat or frame-rate
watchdog that reloads.

Not proven until it runs on a device: every WebView behavior above, which
`androidx.webkit` features each device's WebView reports, the overlay windows over
another app, and the vector TV banner on the Shield's home row.

## `lockdown`

Needs `webview-host` and `accessibility`. **Nothing in this section has run on a
device.** It keeps the kiosk in front. Once a second a watcher reads the windows on
screen through the accessibility service and decides whether to bring the kiosk
back. The decision, in order:

1. Not locked, or the display is off: stay. A display whose state cannot be read
   counts as on.
2. The kiosk Activity is resumed: stay.
3. The accessibility service is not bound, or there is no window sample under
   three seconds old: **recall**. The watcher fails closed.
4. This app's own package is in front: stay.
5. The package in front has been closed by a package gate (`lease-gate`): recall,
   whatever the lists below say.
6. It matches `lockdown.allowedApps` or a live exemption: stay.
7. It is Android Settings while a pairing the page started waits on the system's
   pairing dialog: stay.
8. Inside `lockdown.recallGraceMs` of first leaving the kiosk: stay.
9. Otherwise: recall.

A recall starts the kiosk Activity from the accessibility service (the one way
measured to work from the background on Android 10), then tries HOME, then a plain
start; one that does not take is retried every second. Each foreground change is
written to the shell log with the windows that came before it.

**Modes.** `lockdown.mode` is `auto` (default), `app` or `owner`; the mode in force
is read at run time and reported by `GET /lockdown`. `app` needs no special
authority. `owner` runs only where this app is device owner and adds lock task, a
persistent HOME preference, a disabled status bar and keyguard, and (with
`lockdown.ownerRestrictions`) the safe-boot, factory-reset, add-user and
apps-control restrictions, plus hiding the packages in `lockdown.ownerHidePackages`.
The package that provides the WebView and this app are never hidden. Asking for
`owner` without ownership runs `app` and says so in `modeError`.

| Device | What is possible |
|---|---|
| Shield | `app` only. It has no `android.software.device_admin` feature: no device admin, no device owner, no lock task |
| Portal | `app` until ownership is transferred. The old helper is device owner today; this app's admin declares `support-transfer-ownership` so it can receive ownership |
| Piano tablet | `app`, with a device admin for screen-off once it is activated |

A build that lists `lockdown` adds a HOME filter to the kiosk Activity, so the
device offers it as a home app. It becomes the home app only when chosen on the
device; `homeIsKiosk` in `GET /lockdown` is what the system resolves HOME to, read
every five seconds.

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/lockdown` | | The contract's `locked`, `mode`, `homeIsKiosk`, `allowedApps`, `foreground`, `foregroundActivity`, `kioskInForeground`, `recallsSinceBoot`, `lastRecall` (null before the first recall). Also `enabled`, `watcher` (`running` or `stopped`), `home`, `exemptions`, `blockedPackages`, `packageHiding` `{supported, reason}`, `pairingDialogAllowed`, `a11yBound`, `adminActive`, `deviceOwner`, `lockTaskActive`, `overlayGranted`, `shieldShown`, `exitGesture`, `inputLock`, `trail`, and when they apply `relockAtMs`, `allowedAppsError`, `ownerError`, `modeError` |
| POST | `/lockdown/lock` | | `{locked:true, mode}`; 501 with reason `lockdown.enabled is false` when lockdown is off |
| POST | `/lockdown/unlock` | `{forMs?}` | `{locked:false, relockAtMs}`; 501 with reason `lockdown.enabled is false` when lockdown is off; 400 for a `forMs` that is not a positive number |
| POST | `/lockdown/input` | `{locked, lockedUntil?, revision?}` | `{inputLocked, revision, lockedUntil}`; 409 `stale_revision` for an older or conflicting command |

`GET /lockdown` answers from memory and makes no system call, so it can be polled
every second. `foreground` is this app's package whenever the kiosk Activity is
resumed, else the watcher's sample if it is fresh, else null. `recallsSinceBoot`
counts since the payload started.

**An unlock always ends.** With no `forMs` it lasts `lockdown.maxUnlockMin`
minutes; a longer `forMs` is cut to that. The setting takes 1 to 60 and cannot be
switched off. The unlock is stored and survives a restart; a stored unlock with no
end, with an end beyond the ceiling, or that cannot be read, is locked. The page
bridge has no way to unlock: unlocking is this route, behind the token, or the PIN.

**Exit gesture.** Seven quick taps in the top-left corner raise a native PIN prompt.
`lockdown.exitPin` is a secret setting with no compiled default; with no PIN there
is no gesture and the only way out is the API. The PIN is compared in constant
time and never logged. A correct PIN unlocks for `lockdown.pinUnlockMin` minutes
(10 by default, and never past `lockdown.maxUnlockMin`), which is shorter than an
API unlock on purpose: the gesture is for a person standing at the device.

Five wrong PINs in a row lock the prompt for five minutes, the right PIN
included. The count is kept in memory only. The lockout is reported once, as a
warning with the event name `lockdown.pin.lockout` and `{wrongAttempts, untilMs}`:
in the device's event log (`GET /log`), on the event bus, and to the log store.
Neither the PIN nor what was typed is in it.

**`POST /lockdown/input`** is beyond the control API contract. It is the ordered
stop and release the Portal's old helper took on `PUT /lockdown`: while the input
lock is active the volume keys do nothing. A release must carry a higher revision
than the stop it clears; a malformed command releases nothing. Nothing in the
backend calls this route on the new app yet.

**Exemptions.** Three things may be in front of a locked kiosk without being on
`lockdown.allowedApps`, each for a limited time: an app `POST /launch` started
(until it has been seen in front and leaves, or 30 seconds if it never appears),
the system's package installer while `POST /update` waits for its confirmation,
and Android Settings while a pairing the page started waits on the system's
dialog. A timed exemption never lasts more than an hour. `GET /lockdown` lists
those in force under `exemptions`.

The installer's exemption is granted only once an update's APK has been
downloaded and has passed every check, at the moment it is handed to the system
installer. A download that fails, a hash that does not match or an APK of another
package opens nothing. It ends when the update does: at once when the install
fails or nobody confirms it within 90 seconds (as `GET /update` finds out), by
its own two-minute limit otherwise, and with the process when the install goes
through.

**The package gate.** `lockdown` provides the gate `lease-gate` enforces through.
A closed package is recalled whenever it comes to the front and `POST /launch`
refuses it; where this app is device owner it is hidden as well. The gate is ready
only while the kiosk is locked, so with `lockdown.enabled` false, or during an
unlock, nothing is enforced and `GET /lease` reads `ready:false`. A closed app is
only kept from the front; it may keep running in the background.

**The Portal's Control Center.** With `lockdown.dismissControlCenter` on (the
Portal's device file), the swipe-up panel is pushed back down as the old helper
did: a system window covering most of the display is the signal, and after the
open animation a downward swipe is sent, checked, and repeated up to six times.
It is left alone during an unlock window. The window events it needs are asked of
the accessibility service only while the setting is on.

| Setting | Default | Meaning |
|---|---|---|
| `lockdown.enabled` | true (false in every device file) | Master switch. Off: never locked, nothing recalled |
| `lockdown.mode` | `auto` | `auto`, `app`, `owner` |
| `lockdown.allowedApps` | empty | What may stay in front: `com.example.app`, `com.example.*`, `com.example.app/.Activity`, comma-separated. A list that does not parse allows nothing and is reported in `allowedAppsError` |
| `lockdown.recallGraceMs` | 0 | Grace before recalling |
| `lockdown.maxUnlockMin` | 60 | Length of an API unlock with no `forMs`, and the ceiling for every unlock. 1 to 60 |
| `lockdown.pinUnlockMin` | 10 | Length of an unlock by the PIN gesture. 1 to 60, and never past the ceiling |
| `lockdown.exitPin` | none (secret) | PIN for the exit gesture |
| `lockdown.immersive` | true | Immersive fullscreen while locked |
| `lockdown.statusBarShield` | true | A touch-eating strip over the status bar while locked; needs `SYSTEM_ALERT_WINDOW` |
| `lockdown.selfEnableAccessibility` | true | Put the accessibility service back when it is found unbound; needs `WRITE_SECURE_SETTINGS` |
| `lockdown.ownerRestrictions` | false (true on the Portal) | Owner mode: the four user restrictions. They persist and need ADB to undo |
| `lockdown.ownerHidePackages` | empty (the old helper's list on the Portal) | Owner mode: packages to hide |
| `lockdown.dismissControlCenter` | false (true on the Portal) | Push the Portal's Control Center back down |

The grants `lockdown` needs, over ADB. `<package>` is the device's application id.
None has been run. The complete list per device is under "One-time grants" below.

```bash
# Screen off through a device admin (piano tablet, Portal). Not possible on the Shield.
adb shell dpm set-active-admin <package>/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver
# The accessibility service: the watcher, and the Shield's screen off. Append to the existing value.
adb shell settings get secure enabled_accessibility_services
adb shell settings put secure enabled_accessibility_services <existing>:<package>/net.kckern.daylight.cap.accessibility.shell.DaylightAccessibilityService
adb shell settings put secure accessibility_enabled 1
adb shell pm grant <package> android.permission.WRITE_SECURE_SETTINGS
# The status-bar shield and the overlay layers
adb shell appops set <package> SYSTEM_ALERT_WINDOW allow
# Home app, when a device is switched (not before)
adb shell cmd package set-home-activity <package>/net.kckern.daylight.cap.webviewhost.shell.KioskActivity
```

Device owner on the Portal arrives by `DevicePolicyManager.transferOwnership` from
the old helper. No command here sets it.

## `screen-power`

**Nothing in this section has run on a device.**

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/screen` | `{on}` | `{screenOn}`, read back from the display's own state. `ok` is true only when that state is the one asked for; otherwise `ok:false`, `error:"screen_state_unchanged"`. Off on a device with no way to do it: 501 with the reason |
| POST | `/screen/brightness` | `{level}` 0 to 255 | `{level}` read back; 501 with reason `WRITE_SETTINGS is not granted` without the grant |
| POST | `/device/reboot` | | `{rebooting:true}`; 501 with reason `device owner required` otherwise |

How the display is turned off is chosen at each request:

1. An active device admin (the one `lockdown` declares): `lockNow`.
2. Else a bound accessibility service, on Android 9 or later: the lock-screen
   action. This is the Shield's only way.
3. Else 501: `device admin or a bound accessibility service required` (below
   Android 9: `device admin required`).

The display is turned on with a wake lock. Its state is read from
`Display.getState()`. `PowerManager.isInteractive()` is wrong on the Portal and is
not used. Each change is published once as `screen` `{on}`, which the page
receives as `daylight:screen`. While the payload runs the capability holds a
partial wake lock and a Wi-Fi lock (settings below) so the control API still
answers with the display off, and it takes the wake lock for a screen-off even
when the setting is off. Reboot needs device owner: never on the Shield, and on
the Portal only after ownership is transferred.

| Setting | Default | Meaning |
|---|---|---|
| `power.keepScreenOn` | true | Keep the kiosk window's screen on |
| `power.wifiLock` | true | Hold a high-performance Wi-Fi lock |
| `power.preventSleepWhileScreenOff` | true | Hold a partial wake lock |
| `power.screenVerifyMs` | 3000 | How long `/screen` waits for the display to change |
| `power.wakeCooldownMs` | 8000 | Least time between two wakes by a played note |
| `power.noWakeStart`, `power.noWakeEnd` | empty | `HH:mm` local window in which a played note wakes nothing |

One-time grant: `adb shell appops set <package> WRITE_SETTINGS allow` (brightness).

## `volume`

**Has not run on a device.** `GET /volume?stream=3` and `POST /volume`
`{level: 0..100, stream?}` answer `{stream, level, index, maxIndex}`. `level` maps
onto the stream's index range rounding down, as Fully does; the `level` read back
is the smallest percentage that sets the same index again, so writing a read value
back moves nothing. `POST` answers `ok:true` only when the index read back is the
one asked for; a stream something else holds answers `ok:false`,
`error:"volume_unchanged"` with what the stream reads. `stream` is an Android
stream number 0 to 10, 3 (music) by default.

## `app-launcher`

**Has not run on a device.** `POST /launch` takes `{package, activity?, action?,
extras?}` or `{intent: "intent:#Intent;...;end"}` and answers `{launched:true,
component}`, or `ok:false` with `error`:

| `error` | Meaning |
|---|---|
| `not_allowed` | The activity the request resolves to is not in `launcher.allowed`, or a package gate has closed its package, or it resolves to the system's chooser |
| `not_installed` | Nothing on the device resolves it |
| `start_refused` | The system refused the start |
| `launch_not_observed` | Started, and not seen in front within `launcher.confirmMs` (only where the foreground can be seen) |

A malformed request is `400`. Every request is resolved to one explicit activity
first, and that activity is what is checked and what is started, so an action-only
request or an `intent:` URI cannot reach an app that is not listed. An `intent:`
URI with a selector, or carrying a `file:` or `content:` URI, is refused as
malformed, and no flag from the request reaches the start. `extras` are strings
only. The page's `daylight.launch()` goes through the same two steps as the route.

A launched package may stay in front until it has been seen there and leaves; it
does not need to be in `lockdown.allowedApps`. The answer carries
`observedInFront`: true when the watcher saw it, null when there is no bound
accessibility service to see with.

`launcher.allowed` (default empty: nothing may be launched) uses the allowlist
syntax. It is separate from `lockdown.allowedApps` on purpose: the first is what
may be started, the second what may stay in front with no launch at all. The
Shield's device file allows its arcade emulator's package; the other two allow
nothing until each device's cutover reads what Fully allows today.

## `debug-tools`

**Has not run on a device.** What an operator needs to see and poke a kiosk
without ADB. Every route needs the device token, like every route, and that is the
only way in: nothing here is offered to the page bridge or the WebSocket.

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/debug/info` | | `device`, `model`, `sdkInt`, `elapsedRealtimeMs` |
| GET | `/debug/screenshot` | | `image/png` bytes of the WebView's own drawing |
| POST | `/debug/eval` | `{js, timeoutMs?}` | `{result}`: the script's value from the live page, as JSON |
| GET | `/debug/html` | | `{html}` of the current document |
| GET | `/debug/fps` | `?ms=1000` | `{fps, frames, ms, visible}` sampled in the live page |
| POST | `/debug/exec` | `{cmd, timeoutMs?}` | `{exitCode, stdout, stderr, stdoutTruncated, stderrTruncated, timedOut, ms}` |
| GET | `/debug/logcat` | `?lines=500&filter=` | `text/plain`, with the header `X-Daylight-Log-Scope` |
| POST | `/speak` | `{text, locale?}` | `{queued:true}` |
| POST | `/sound` | `{url, loop?, stream?}` or `{stop:true}` | `{playing}` |

Errors, beyond `401` and a malformed body's `400`:

| Route | Status | `error` | When |
|---|---|---|---|
| screenshot, eval, html, fps | 501 | `unsupported` | The build has no `webview-host` |
| screenshot, eval, html, fps | 200 | `no_kiosk_activity` | The kiosk has no window |
| screenshot | 500 | `capture_failed` | The capture threw, or is not a PNG |
| eval, html, fps | 408 | `timeout` | The page did not answer in time |
| eval, html | 200 | `js_error` | The script threw, or its Promise rejected; `message` has the page's text |
| eval, html | 413 | `result_too_large` | Over the limit; `size` and `max` in characters |
| exec | 501 | `unsupported` | `debug.execEnabled` is false (reason `debug.execEnabled is false`) |
| exec | 500 | `exec_failed` | The command could not be started |
| logcat | 400 | `bad_request` | `lines` is not a whole number from 1 to 5000, or `filter` is over 200 characters or holds a line break |
| logcat | 500 | `logcat_failed` | The log could not be read |
| speak | 501 | `unsupported` | No text-to-speech engine, or none with a voice for `locale` |
| speak | 200 | `speak_refused` | The engine did not take the text |
| speak | 400 | `bad_request` | No text, text over 4000 characters, or a `locale` that is not a language tag |
| sound | 400 | `bad_request` | No URL, a URL that is not http or https, an origin the kiosk does not trust, or `stream` outside 0 to 10 |
| sound | 200 | `sound_failed` | The player could not prepare the URL within 10 seconds |

**Screenshot.** The WebView is drawn into a bitmap on the main thread. That is the
page's own drawing: a video surface, WebGL content or another app's window may be
black or absent, as with Fully. What each device draws for those is not known
until it runs there.

**Eval.** The script runs in the live page with no reload. A returned Promise is
waited for. `timeoutMs` is a whole number from 100 to 60000 and defaults to
`debug.evalTimeoutMs`. The result is capped at 1 MiB of JSON text (1048576
characters); the cap is applied inside the page, so a larger value never leaves
it. On a timeout the parked result slot is removed from the page.

**HTML.** The document's `outerHTML`, up to 8 MiB.

**FPS.** Counts `requestAnimationFrame` callbacks in the live page for `ms`
milliseconds (100 to 10000). The page is not reloaded and nothing is added to its
document; the counter keeps one entry on `window.__dlEval` while it runs and
removes it when read. With the display off no frame runs: the route answers `408`
three seconds after the sampling time and cancels its pending frame request.

**Exec.** `sh -c <cmd>` as the app's own uid, so the app sandbox bounds it: no
root, no other app's data. `timeoutMs` is 100 to 60000 and defaults to
`debug.execTimeoutMs` (10 seconds); a command past it has its process killed and
answers `timedOut: true`, `exitCode: -1`. `stdout` and `stderr` are each kept up
to 256 KiB and then cut, ending in a line that says so
(`stdoutTruncated`, `stderrTruncated`). The route answers `501` until
`debug.execEnabled` is true; that setting can be changed only through
`POST /settings`, behind the token.

**Logcat.** `logcat -d -v time -t <lines>` run as an argument list with no shell;
`filter` is a plain, case-insensitive substring applied in the app and never
reaches a command. Other apps' lines need `READ_LOGS`, granted once over ADB.
The header `X-Daylight-Log-Scope` reads `all` with the grant and `own` without
it, when the text holds this app's lines only.

**Speak.** Android's text-to-speech engine, created at the first request.
`queued: true` is answered after the engine accepted the text.

**Sound.** The device fetches the URL itself, so the URL is restricted: http or
https only (never `file:` or `content:`), and only from an origin the kiosk
already trusts, which is the start URL's origin and `webview.bridgeOrigins`.
`debug.soundOrigins` adds origins; `*` there allows any http or https origin.
One sound plays at a time; `playing: true` is answered once it started.

**What is logged.** These routes carry what is on the screen and in the page, so
none of that is written anywhere:

| Route | Event log (`GET /log`) | Log store |
|---|---|---|
| eval | `debug.eval` with `outcome`, `ms`, `resultChars` | The same. Never the script, its result or its error text |
| screenshot | `debug.screenshot bytes=<n>` | Nothing |
| html | `debug.html chars=<n>` | Nothing |
| fps | `debug.fps` with `fps`, `frames`, `ms` | The same |
| exec | `debug.exec exit=<code> ms=<n> cmd=<first 200 characters>`; the command is also in the shell log before it runs | `debug.exec` (warn) with `cmd`, `exitCode`, `ms`, `timedOut`, `from`. Never the output |
| speak, sound | The text's length; whether it played | Nothing |

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `debug.execEnabled` | BOOLEAN | false | Allow `POST /debug/exec` |
| `debug.execTimeoutMs` | INTEGER | 10000 | Its default timeout; 100 to 60000 |
| `debug.evalTimeoutMs` | INTEGER | 5000 | Default timeout of eval and html; 100 to 60000 |
| `debug.soundOrigins` | STRING | empty | Origins `POST /sound` may fetch beyond the kiosk's own; `*` for any |

One-time grants: `pm grant <package> android.permission.READ_LOGS` (other apps'
log lines) and `pm grant <package> android.permission.DUMP` (`dumpsys` through
exec).

## One-time grants

What each device needs once, over ADB, after the app is installed. `<serial>` is
the device's ADB serial and `<package>` its application id. **None of these has
been run.** They survive an update signed with the same key; a fresh install
needs them again.

Every device:

```bash
# The accessibility service: the lockdown watcher, recall, key filtering, the update tap.
# APPEND to the existing value; do not replace another service.
adb -s <serial> shell settings get secure enabled_accessibility_services
adb -s <serial> shell settings put secure enabled_accessibility_services <existing>:<package>/net.kckern.daylight.cap.accessibility.shell.DaylightAccessibilityService
adb -s <serial> shell settings put secure accessibility_enabled 1
# Lets the app put its own service back when Android unbinds it.
adb -s <serial> shell pm grant <package> android.permission.WRITE_SECURE_SETTINGS
# The status-bar shield, the overlay layers, and the Shield's microphone anchor.
adb -s <serial> shell appops set <package> SYSTEM_ALERT_WINDOW allow
# Brightness.
adb -s <serial> shell appops set <package> WRITE_SETTINGS allow
# Page microphone and camera.
adb -s <serial> shell pm grant <package> android.permission.RECORD_AUDIO
adb -s <serial> shell pm grant <package> android.permission.CAMERA
# Other apps' lines in /debug/logcat, and dumpsys through /debug/exec.
adb -s <serial> shell pm grant <package> android.permission.READ_LOGS
adb -s <serial> shell pm grant <package> android.permission.DUMP
# POST /update: install this app's own updates.
adb -s <serial> shell appops set <package> REQUEST_INSTALL_PACKAGES allow
# Keep battery optimization and a vendor's app-sleeping feature away from the service.
adb -s <serial> shell dumpsys deviceidle whitelist +<package>
```

| Device | Also |
|---|---|
| Piano tablet | `dpm set-active-admin <package>/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver` (screen off); `pm grant <package> android.permission.ACCESS_FINE_LOCATION` (Bluetooth scans); `pm grant <package> android.permission.READ_EXTERNAL_STORAGE` |
| Portal | `dpm set-active-admin <package>/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver` until ownership is transferred; `pm grant <package> android.permission.ACCESS_COARSE_LOCATION` (Bluetooth keyboard diagnostics). Device owner arrives by `transferOwnership` from the old helper; no command here sets it |
| Shield | `pm grant <package> android.permission.ACCESS_FINE_LOCATION` (controller pairing scans). No device admin and no device owner are possible |

When a device is switched, and not before:

```bash
adb -s <serial> shell cmd package set-home-activity <package>/net.kckern.daylight.cap.webviewhost.shell.KioskActivity
```

`GET /status` (`a11yBound`, `batteryOptExempt`) and `GET /lockdown` (`a11yBound`,
`adminActive`, `deviceOwner`, `overlayGranted`, `homeIsKiosk`) report what took.

## Differences from Fully Kiosk Browser

What an operator used to Fully will notice.

| Area | Fully | This app |
|---|---|---|
| Authentication | A password in every URL | A token in the `X-Daylight-Token` header; never in a URL or a log line |
| Back button | Whatever an injected script made of it (a reload, on these kiosks) | `webview.backButton`: `reload` by default, `page` hands it to the page as `daylight:back`, `ignore` drops it. No script is injected |
| Reload when the network returns | Every page was reloaded (`reloadOnWifiOn`, `reloadOnInternet`) | Only a page in a failed state. A healthy page keeps running and its own sockets reconnect |
| A page that failed to load | Chrome's error page until a timed reload | A local error page naming the URL and the error, retried with doubling backoff |
| Unlock and maintenance mode | Unlocked until someone locked again | An unlock always ends: an hour at most by the API, ten minutes by the PIN. Maintenance mode is an unlock with a duration |
| Overlay | An overlay message and a separate web overlay URL setting | One route with two independent layers; clearing one leaves the other |
| Screensaver | Fully's own screensaver | None. A page that wants one draws it (the piano page does); the screensaver actions answer `INVALID_ACTION` |
| Motion and acoustic detection | Held the camera and microphone unless switched off | Not present |
| Running a script in the page | Stored as a setting and applied by reloading | `POST /debug/eval` runs it in the live page and returns its value |
| Frame rate check | A reload with an injected counter, read back from the page | `GET /debug/fps` samples the live page; no reload |
| Load a URL | Acknowledged before anything loaded | Answers after the main frame finished, with the load time, or with the error; `wait:false` for an acknowledgement |
| Screen state | `isScreenOn` | Read from the display itself, which is right on the Portal too |
| Settings | Several hundred free-form keys | Typed, declared by the capabilities in the build; an unknown key is `404` |
| Launching an app | Any package | Only what `launcher.allowed` lists; the launched app may stay in front until it leaves |
| Sounds | Any URL or file | http and https from an origin the kiosk trusts |
| Shell commands, logcat | Through ADB only | `POST /debug/exec` (off by default) and `GET /debug/logcat`, as the app's own uid |
| Screenshot | The WebView's drawing | The same, with the same limits for video and other apps' windows |
| Updating the app | `mdmApkToInstall` | `POST /update`, which checks the package, the version and an optional hash first |
| A bad update | Reinstall over ADB | A payload that fails to start is rolled back by the shell; the lifeline port stays up |
