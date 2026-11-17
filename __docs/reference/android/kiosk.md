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

## Response statuses that changed

The backend's client maps a response by its HTTP status, so a failure answers with
one. The JSON body of each answer is the one it always had (`ok:false`, `error`,
and the route's own fields). The statuses mean: `400` the request is incomplete or
not allowed as written, `409` it cannot be done in the state the device is in,
`502` something the device depends on answered badly or could not be reached,
`504` it did not answer in time, `500` an unexpected failure.

| Route | Case | Was | Now |
|---|---|---|---|
| `POST /kiosk/foreground` | The kiosk could not be brought to the front (`not_in_foreground`) | 200 | 409 |
| `POST /kiosk/renderer/reset` | No kiosk Activity (`no_kiosk_activity`) | 200 | 409 |
| `POST /kiosk/renderer/reset` | The page failed to load in the new renderer | 200 | 502 |
| `POST /kiosk/renderer/reset` | The page did not finish in time (`timeout`) | 200, or 500 `internal` when the wait itself ran out | 504 |
| `POST /kiosk/load`, `/kiosk/load-start`, `/kiosk/reload` with `wait:false` | No kiosk Activity | 200 `ok:false`, `accepted:false`, `no_kiosk_activity` | 200 `ok:true`, `accepted:true`, `queued:true` (the load is queued; the latest wins) |
| `POST /kiosk/load` | A URL outside the start origin and `webview.allowedOrigins` | loaded | 400 `bad_request`, message `origin_not_allowed: …` |
| `GET /debug/screenshot`, `POST /debug/eval`, `GET /debug/html`, `GET /debug/fps` | No kiosk Activity (`no_kiosk_activity`) | 200 | 409 |
| `POST /sound` | A redirect leaves the trusted origins, or more than three redirects | followed | 400 `bad_request` |
| `POST /sound` | The URL could not be reached while its redirects were followed (`sound_unreachable`) | 200 `sound_failed` | 502 |
| `POST /mic/restart` | No stream to restart (`not_ready`) | 200 | 409 |
| `POST /mic/restart` | The stream did not come back (`lastError` says why) | 200 | 500 |
| `POST /payload` | `url` or `sha256` missing | 200 | 400 |
| `POST /update` | `url` missing | 200 | 400 |
| `POST /update` | No installer in this state (`not_ready`) | 200 | 409 |
| `POST /update` | The APK was refused (hash mismatch, another package, a lower version) | 200 | 409 |
| `POST /update` | The download failed | 200 | 502 |
| `POST /update` | The download timed out | 200 | 504 |
| `POST /update` | Any other failure | 200 | 500 |
| `POST /settings` `lockdown.enabled` false, where `lockdown.required` is compiled true | | 200 | 400 `invalid_setting` |
| `POST /settings` `mic.port` equal to the control or lifeline port | | 200 | 400 `invalid_setting` |

Not changed, and still `200` with `ok:false`: a waited `POST /kiosk/load` that
fails (`loaded:false`; the contract answers this way), `POST /kiosk/overlay`
(`overlay_not_shown`), `POST /launch` refusals, `POST /screen`
(`screen_state_unchanged`), `POST /volume` (`volume_unchanged`), `/debug/eval`'s
`js_error`, `/speak`'s `speak_refused`, `/sound`'s `sound_failed`.
`POST /kiosk/restart` has no failure it can report: it answers and then asks the
shell to restart the payload, and a refusal by the shell is in the shell log.

`GET /update` now carries `sha256Verified` and `confirming`, as the contract lists.

New routes: `POST /lockdown/home`, `POST /lockdown/owner/release`,
`POST /lockdown/owner/resume`, `POST /lockdown/owner/transfer`, and on the lifeline
`POST /owner/release`. They are described under `lockdown` below.

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
| `webview.allowedOrigins` | empty | Comma-separated origins the main frame may navigate to beyond the start URL's own. Empty (every device's default) means the start origin only |
| `webview.backButton` | `reload` | `reload`, `page` (the page gets `daylight:back`), `ignore`, or `history` (step back through the page history, then put the app behind the previous one; the phone's value) |
| `webview.interceptKeys` | empty | Key names sent to the page as `daylight:key` and kept from the system, for example `VolumeUp,VolumeDown` |
| `webview.loadTimeoutSec` | 20 | A load not finished by then is stopped and counted as failed |
| `webview.allowMic`, `webview.allowCamera` | false | Grant a page request from an allowed origin, when the app holds the Android permission and the page was not opened by a link without the install key (the phone's rule; a kiosk has no link activity). The three kiosk device files set both to true |
| `webview.showWhenLocked` | false | Show the window over the lock screen. The Activity does not until the payload tells it; applied when the Activity attaches and when the setting changes. The three kiosk device files set it to true (a kiosk with a swipe keyguard shows its page after a wake); the phone's says false |
| `webview.allowMixedContent` | false | |
| `webview.debugging` | false | Remote WebView inspection |
| `webview.launchOnBoot` | false | Start the kiosk Activity when the payload starts and none exists |
| `recovery.reloadOnPageFailureSec` | 30 | First retry of a failed page; doubles up to `recovery.maxRetrySec` (300). 0 disables page retries; a renderer that keeps dying is slowed down all the same |
| `recovery.reloadOnNetworkReturn` | true | Reload when the network returns, only for a page in a failed state |
| `recovery.rendererUnresponsiveSec` | 30 | End a renderer unresponsive this long; 0 disables |

Origin, bridge, navigation, mixed-content and debugging settings are read when the
WebView is built; `POST /kiosk/renderer/reset` applies a change.

**Where the main frame may go.** Only to the start URL's origin and the origins in
`webview.allowedOrigins`. A link, a script or a redirect that would take the main
frame anywhere else is refused, and the refusal is logged with the origin only
(a path can carry a token). The same rule is applied to `POST /kiosk/load` and to
a link opened through the phone's link activity, which answer `400`. The phone
adds the origins in its `links.origins`. Sub-resources and iframes are not held to
this rule: the page embeds media and frames from other origins, and those load as
before. Schemes other than http and https never load in any frame.

A main-frame load that reaches another origin all the same (a redirect the first
check did not see) is stopped when it starts, and the kiosk loads its start page.
If the start page itself leads away, as one that redirects to a sign-in host not
on the list would, that would repeat at the speed of the network; after three
such stops inside a minute the load is settled as failed, the local error page
names the origin, and the start page is tried again on the usual doubling delay.
Adding the origin to `webview.allowedOrigins` is the fix.

Routes, beyond what the control API contract lists:

- Every load has a `loadId`. The waiting answer, the `wait:false` acknowledgement
  and `lastLoad` carry it. `GET /kiosk/status` also has `loading`, `loadingUrl` and
  `loadingId` for a load that has not settled, `errorPage`, and `reason` (null when
  ready).
- A waited load asked for while no kiosk Activity exists answers
  `error:"no_kiosk_activity"`. With `wait:false` it is queued instead: the answer
  is `accepted:true`, `queued:true` with its `loadId`, the app starts the
  Activity, and that Activity loads the queued URL in place of the start page.
  One URL waits at a time (a later request replaces it) and for a minute at most.
- `GET /kiosk/status` also has `bridge` (`available`, `unavailable`, or `unknown`
  before a WebView exists) with `bridgeReason`, and `rendererLosses` (renderer
  crashes in a row; 0 once the renderer has stayed up five minutes) with
  `rendererLossesTotal`.
- A finish reported by the WebView counts only for the load whose start was seen.
  Starting a load while another is in progress makes the WebView report the first
  one's finish; that no longer settles the second as loaded.
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
shim that defines it is injected at document start, into frames of those origins
only. **Without that WebView feature there is no bridge at all**:
`GET /kiosk/status` reads `bridge: "unavailable"` with the reason, the shell log
has one line saying so, and the page finds no `window.daylight`. There is no
fallback, because the only other way to place the shim runs it in the document
that is being left, whatever its origin. Updating Android System WebView is the
remedy.

The native object behind the bridge is visible to every frame (an Android rule),
so it answers only to a token. The shim carries a session key, with which each
document asks for a token of its own at its first call; every call presents that
token, and the key is never sent with a call. A token is tied to the document it was issued to: each
main-frame navigation starts a new generation, and a token is refused once the
document it was issued to has been replaced. Because the navigation callback and a
new document's first call can arrive in either order, a token is honored in the
generation it was issued in and the one after, and never later. A call is also
refused unless the main frame is on an allowed origin at that moment. A page on
another origin has no `window.daylight`. The bridge is rebuilt with the WebView, so
`POST /kiosk/renderer/reset` applies a changed origin list.

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
or its renderer stayed unresponsive for `recovery.rendererUnresponsiveSec`.

Two of those have limits. An address the page navigated to itself that fails three
times in a row is given up: the kiosk loads its start page. The start page is
retried for as long as it takes. And a renderer that dies again within five minutes
of its page being loaded is not rebuilt and reloaded at once: the second loss waits
`recovery.reloadOnPageFailureSec`, the third and later wait `recovery.maxRetrySec`,
and the local error page shows while it waits. A load that succeeds in between
does not clear that count; five minutes of a live renderer does. A reset asked for
with `POST /kiosk/renderer/reset` is not counted. A slow
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
2. This second's sample found another package's application window active:
   - closed by a package gate (`lease-gate`): **recall**, whatever the lists say;
   - it matches `lockdown.allowedApps` or a live exemption: stay;
   - it is Android Settings while a pairing the page started waits on the
     system's pairing dialog: stay;
   - the kiosk Activity is not resumed and this is inside
     `lockdown.recallGraceMs` of first leaving the kiosk: stay;
   - otherwise: **recall**. This holds whether or not the kiosk Activity is
     resumed. On Android 10 and later every visible activity is resumed, so with
     another app beside the kiosk in split screen the kiosk's own lifecycle says
     "in front" while the other app is in use.
3. The kiosk Activity is resumed: stay.
4. Android's keyguard is showing: stay.
5. The accessibility service is not bound, or this second's sample identified no
   application window: **recall**. The watcher fails closed. The front is what
   this sample saw and never the last package seen earlier.
6. This app's own package is the active window: stay.

A build that lists `lockdown` also declares the kiosk Activity not resizable and
without picture-in-picture, so split screen cannot be entered with it.

A recall starts the kiosk Activity from the accessibility service (the one way
measured to work from the background on Android 10), then tries HOME, then a plain
start. `lastRecall` says how: `accessibility`, or `service-start-unverified` (with
`home+` in front when HOME was pressed) when the accessibility service is not
bound. A start from the service does not fail when Android ignores it, so that
value means "asked", and `lastRecall.a11yBound` is false with it.

Recalls are paced. The first three of an unbroken run go out a second apart; after
that the gap doubles from two seconds to thirty, and no minute holds more than
twelve. A tick with nothing to recall ends the run. `recallsHeldBack` in
`GET /lockdown` counts the ticks that wanted a recall and waited. The watcher runs
at a fixed delay, so a device waking from a long sleep runs one tick, not one for
every second it slept. A tick that throws is logged and still ends in a recall
when the kiosk is locked. Each foreground change is written to the shell log with
the windows that came before it.

**Modes.** `lockdown.mode` is `auto` (default), `app` or `owner`; the mode in force
is read at run time and reported by `GET /lockdown`. `app` needs no special
authority. `owner` runs only where this app is device owner and adds lock task, a
persistent HOME preference (once the HOME alias is enabled), a disabled status bar
and keyguard, and (with `lockdown.ownerRestrictions`) the safe-boot, factory-reset,
add-user and apps-control restrictions, plus hiding the packages in
`lockdown.ownerHidePackages`. The package that provides the WebView and this app
are never hidden. Asking for `owner` without ownership runs `app` and says so in
`modeError`.

**Owner mode needs an exit PIN.** With `lockdown.exitPin` empty, owner mode does
not lock: no lock task, no disabled status bar. `GET /lockdown` carries
`ownerRefused` with the reason and the shell log has it once. A device in lock
task with no PIN can be left only through the control API, and one that has lost
its network would then have no exit. Lockdown itself still runs in `app` mode's
way. Setting the PIN is applied at once.

**Settings are applied when they change.** `lockdown.enabled`, `lockdown.mode`,
`lockdown.immersive`, `lockdown.statusBarShield`, the owner settings, the
allowlist and the PIN take effect when they are set. Turning lockdown off in owner
mode leaves lock task and gives the status bar back without a payload restart.

| Device | What is possible |
|---|---|
| Shield | `app` only. It has no `android.software.device_admin` feature: no device admin, no device owner, no lock task |
| Portal | `app` until ownership is transferred and `POST /lockdown/owner/resume` is called. The old helper is device owner today; this app's admin declares `support-transfer-ownership` so it can receive ownership. `transferOwnership` is untested on this firmware |
| Piano tablet | `app`, with a device admin for screen-off once it is activated |

**The home app.** Installing a build that lists `lockdown` adds no home candidate.
The HOME filter is on an activity-alias of the kiosk Activity
(`<package>/net.kckern.daylight.cap.lockdown.shell.KioskHome`) that is declared
disabled, and a disabled component is not offered as a home app. A HOME filter
live at install would give the device a second candidate; on Android 9 that can
clear the current default and put a chooser in front of an unattended kiosk at
the next Home press. The build reads each device's merged manifest back and fails
when a HOME filter is anywhere but on that disabled alias, and `verify-build`
checks the APK the same way.

`POST /lockdown/home` `{enabled: true|false}` enables or disables the alias on the
device (`PackageManager.setComponentEnabledSetting`, without killing the app). It
is the only thing that does. Enabled, this app is a candidate; it becomes the home
app when chosen on the device (`cmd package set-home-activity` with the alias's
name). `GET /lockdown` reports `homeAlias` (`enabled` or `disabled`) beside
`homeIsKiosk`, which is what the system resolves HOME to, read every five seconds.

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/lockdown` | | The contract's `locked`, `mode`, `homeIsKiosk`, `allowedApps`, `foreground`, `foregroundActivity`, `kioskInForeground`, `recallsSinceBoot`, `lastRecall` (null before the first recall; `{atMs, from, reason, how, a11yBound}`). Also `enabled`, `required`, `watcher` (`running` or `stopped`), `homeAlias`, `home`, `exemptions`, `blockedPackages`, `packageHiding` `{supported, reason}`, `pairingDialogAllowed`, `recallsHeldBack`, `a11yBound`, `adminActive`, `deviceOwner`, `lockTaskActive`, `overlayGranted`, `shieldShown`, `exitGesture`, `inputLock`, `trail`, `ownerHold` (null, or why owner policy is held back), and when they apply `relockAtMs`, `allowedAppsError`, `ownerError`, `ownerRefused`, `modeError` |
| POST | `/lockdown/lock` | | `{locked:true, mode}`; 501 with reason `lockdown.enabled is false` when lockdown is neither enabled nor required |
| POST | `/lockdown/unlock` | `{forMs?}` | `{locked:false, relockAtMs}`; 501 as above; 400 for a `forMs` that is not a positive number |
| POST | `/lockdown/home` | `{enabled}` | `{homeAlias, homeIsKiosk, home, note}`; 400 without a boolean; 409 `not_ready` before lockdown has started; 500 `home_alias_failed` with `message` when the package manager refused |
| POST | `/lockdown/owner/release` | | `{released:true, mode, ownerHold}` after every owner policy is undone; 409 `not_device_owner`; 500 `release_incomplete` with what failed |
| POST | `/lockdown/owner/resume` | | `{mode, locked}`: the hold is cleared and owner policy is applied again if the kiosk is locked |
| POST | `/lockdown/owner/transfer` | `{to:"<package>/<receiver>"}` | `{transferred:true, to, deviceOwner:false}`; 409 `transfer_not_configured` (the setting is empty), `target_not_allowed`, `not_device_owner`; 501 below Android 9; 500 `transfer_failed` with `exception`, `message`, `policyReleased:true` |
| POST | `/lockdown/input` | `{locked, lockedUntil?, revision?}` | `{inputLocked, revision, lockedUntil}`; 409 `stale_revision` for an older or conflicting command |

`GET /lockdown` answers from memory and makes no system call, so it can be polled
every second. `foreground` is this app's package whenever the kiosk Activity is
resumed, else the watcher's sample if it is fresh, else null. `recallsSinceBoot`
counts since the payload started.

**Lockdown that nobody can switch off by accident.** `lockdown.enabled` is on only
through a stored override on a device being switched over, and stored overrides
can be lost: the lifeline's settings reset deletes them, and a file can be
damaged. `lockdown.required` closes that. It is compiled per device (default
false), cannot be changed on the device (`POST /settings` and `DELETE /settings`
answer `400`), and a stored override for it is ignored. When it is true, lockdown
is enforced whatever `lockdown.enabled` says, `POST /settings` refuses
`lockdown.enabled: false` with a `400` that names the reason, and the lifeline's
settings reset leaves the device locked. Only an unlock, which always ends,
relaxes it. The runbook sets it in the device file as the last cutover step, with
a rebuild and an install.

The settings store itself: an overrides file that cannot be read is logged once
(without any value) and reported in `GET /status` as `settingsProblem`; the last
good file is kept beside it as `.bak` and used when the file is unreadable or
missing; and every write is forced to disk before it replaces the file.

**Releasing and moving device ownership.** Where this app is device owner:

- `POST /lockdown/owner/release` undoes every policy owner mode sets: the
  persistent preferred HOME, the lock-task packages and features, the status-bar
  and keyguard policies, the four user restrictions and every package in
  `lockdown.ownerHidePackages`. A test over a recording stand-in for
  `DevicePolicyManager` shows the state after apply and release equals the state
  before. It also sets an **owner hold**: a marker beside the payload's state that
  survives restarts, payload swaps and a settings reset. While it exists this app
  reports `mode: app` and applies no owner policy, though it is still the owner.
  `POST /lockdown/owner/resume` clears it.
- An unlock does less: it leaves lock task and gives the status bar back, and
  keeps the home preference, the restrictions and the hidden packages for the
  relock.
- The lifeline's `POST /owner/release` is for a payload that is broken. The shell
  does the minimum itself, with no payload: it sets the hold, clears the home
  preference and the lock-task packages, enables the status bar and the keyguard,
  and asks the kiosk Activity to leave lock task. Restrictions and hidden packages
  are the payload's to undo.
- `POST /lockdown/owner/transfer` hands ownership to another admin with
  `DevicePolicyManager.transferOwnership` (Android 9). It is allowed only when
  `to` equals the setting `lockdown.ownerTransferTarget`, which is empty by
  default, so by default every transfer is refused. This app's policy is released
  first, because a transfer carries the owner's policies to the new owner. If the
  system refuses the transfer, the answer has the exception and this app stays the
  owner with its policy released and held.
- When ownership is transferred **to** this app, its admin receiver sets the owner
  hold and logs the event. Nothing is applied until `POST /lockdown/owner/resume`.

`transferOwnership` has not run on the Portal's firmware in either direction.

**An unlock always ends.** With no `forMs` it lasts `lockdown.maxUnlockMin`
minutes; a longer `forMs` is cut to that. The setting takes 1 to 60 and cannot be
switched off. The unlock is stored and survives a restart; a stored unlock with no
end, with an end beyond the ceiling, or that cannot be read, is locked. The page
bridge has no way to unlock: unlocking is this route, behind the token, or the PIN.

**Exit gesture.** Seven quick taps in the top-left corner raise a native PIN prompt.
`lockdown.exitPin` is a secret setting with no compiled default; with no PIN there
is no gesture and the only way out is the API (and owner mode does not lock). The PIN is compared in constant
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
(until it has been seen in front and then three samples in a row show something
else there, or 30 seconds if it never appears; one sample of a system dialog
passing over it does not end it),
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
| `lockdown.enabled` | true (false in every device file) | Master switch. Off: never locked, nothing recalled, unless `lockdown.required` is true. Cannot be set false while that is true |
| `lockdown.required` | false; compiled only | Enforce lockdown whatever `lockdown.enabled` and the stored overrides say. Cannot be changed on the device |
| `lockdown.ownerTransferTarget` | empty | The one admin component (`<package>/<receiver>`) ownership may be transferred to. Empty refuses every transfer |
| `lockdown.mode` | `auto` | `auto`, `app`, `owner` |
| `lockdown.allowedApps` | empty | What may stay in front: `com.example.app`, `com.example.*`, `com.example.app/.Activity`, comma-separated. A list that does not parse allows nothing and is reported in `allowedAppsError` |
| `lockdown.recallGraceMs` | 0 | Grace before recalling |
| `lockdown.maxUnlockMin` | 60 | Length of an API unlock with no `forMs`, and the ceiling for every unlock. 1 to 60 |
| `lockdown.pinUnlockMin` | 10 | Length of an unlock by the PIN gesture. 1 to 60, and never past the ceiling |
| `lockdown.exitPin` | none (secret) | PIN for the exit gesture. Owner mode does not lock while it is empty |
| `lockdown.immersive` | true | Immersive fullscreen while locked |
| `lockdown.statusBarShield` | true | A touch-eating strip over the status bar while locked; needs `SYSTEM_ALERT_WINDOW` |
| `lockdown.selfEnableAccessibility` | true | Put the accessibility service back when it is found unbound; needs `WRITE_SECURE_SETTINGS` |
| `lockdown.ownerRestrictions` | false (true on the Portal) | Owner mode: the four user restrictions. They persist until `POST /lockdown/owner/release` |
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
# Home app, when a device is switched (not before). First POST /lockdown/home {"enabled":true}.
adb shell cmd package set-home-activity <package>/net.kckern.daylight.cap.lockdown.shell.KioskHome
```

Device owner on the Portal arrives by `DevicePolicyManager.transferOwnership` from
the old helper (its `POST /owner/transfer`; see its README). No command here sets it.

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
`{level: 0..100, stream?}` answer `{stream, level, index, minIndex, maxIndex}`.
A stream whose lowest index is 1 (the alarm and call streams on some devices)
cannot be set to 0: level 0 sets its minimum there, answers `ok:true`, and
`minIndex` says what the minimum is. Below Android 9 the minimum cannot be asked
and is taken as 0. `level` maps
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
does not need to be in `lockdown.allowedApps`. When the launch was allowed only by
a rule that names one activity (`com.example.game/.Play`), only that activity is
exempt: another screen of the same package is recalled. A rule for the whole
package, or a wildcard, exempts the package. The answer carries
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
| screenshot, eval, html, fps | 409 | `no_kiosk_activity` | The kiosk has no window |
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
| sound | 400 | `bad_request` | No URL, a URL that is not http or https, an origin the kiosk does not trust, a redirect that leaves those origins, more than three redirects, or `stream` outside 0 to 10 |
| sound | 502 | `sound_unreachable` | The URL could not be reached while its redirects were followed |
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
Redirects are not followed automatically. The app asks each address where it
redirects to, holds every hop to the same origin rule, takes at most three, and
hands the player the address that answered without redirecting. One sound plays
at a time; `playing: true` is answered once it started.

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

When a device is switched, and not before. The alias is enabled first, with
`POST /lockdown/home {"enabled":true}` (`daylight-device <device> lockdown home on`):

```bash
adb -s <serial> shell cmd package set-home-activity <package>/net.kckern.daylight.cap.lockdown.shell.KioskHome
```

`GET /status` (`a11yBound`, `batteryOptExempt`, `switches`, `settingsProblem`) and
`GET /lockdown` (`a11yBound`, `adminActive`, `deviceOwner`, `overlayGranted`,
`homeAlias`, `homeIsKiosk`) report what took.

## Coexistence switches

The app is installed beside the old helper apps before a device is switched over,
and two apps cannot hold the same hardware. Each part of a helper this app can
take over has a BOOLEAN switch. It is applied the moment it changes (acquire on
true, release on false), with no payload restart, and reported in `GET /status`
under `switches` as `{setting, active}`, with `error` when the part could not be
taken. Every kiosk device file compiles its switches to false; they are turned on
at that device's cutover and off again in a rollback.

| Switch | Device | What it holds |
|---|---|---|
| `hid.enabled` | Portal | The USB keyboard claim (and its permission-dialog automation) |
| `volumeKeys.enabled` | Portal | The volume-key filter and the accessibility beep guard |
| `presence.enabled` | Portal | The Bluetooth presence reporter |
| `midi.enabled` | Piano tablet | The BLE-MIDI link to the instrument. This is the existing setting: the connector reads it at every scan and connect decision, and a change reconnects |
| `speaker.enabled` | Piano tablet | The A2DP connector and the audio route guard together |
| `mic.enabled` | Shield | The microphone stream and its port |
| `lease.enabled` | Shield | The lease loop |

`speaker.enabled` used to mean "the Bluetooth panel disconnected the speaker on
purpose" and gated the connector alone. That meaning moved to a new setting,
`speaker.connect`, which the panel's disconnect and assign write; the guard keeps
running through it, so the tablet's own speaker stays clamped. `speaker.enabled`
is now the switch for both halves and is not written by the panel.

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
| Following a link to another site | Loaded, unless a URL whitelist was set | Refused in the main frame unless the origin is the start URL's or in `webview.allowedOrigins` |
| The home app | Offered as a home app from install | Not a home candidate until `POST /lockdown/home` enables its alias |
| Sounds | Any URL or file | http and https from an origin the kiosk trusts |
| Shell commands, logcat | Through ADB only | `POST /debug/exec` (off by default) and `GET /debug/logcat`, as the app's own uid |
| Screenshot | The WebView's drawing | The same, with the same limits for video and other apps' windows |
| Updating the app | `mdmApkToInstall` | `POST /update`, which checks the package, the version and an optional hash first |
| A bad update | Reinstall over ADB | A payload that fails to start is rolled back by the shell; the lifeline port stays up |
