# DaylightStation Android on the phone

`devices/phone.yml` builds the owner's own phone app from the same codebase as the
kiosks. This page covers what is different on the phone and the capabilities that
exist only for it. The phone has no control API and no lifeline. Building, the
routes (which the phone registers and serves to nobody), settings and the fleet CLI are in
`__docs/reference/android/README.md`; the web view and its page bridge are in
`__docs/reference/android/kiosk.md`.

**None of this has run on a phone.** The build passes its unit tests, lint and the
build verifier. Nothing has been installed. Every statement below about what
Android does (cold starts, tiles, the launcher, link handling) is from the
platform's documentation and is unproven until the on-device checklist is run.
"Unproven on a phone" below marks the places where that matters most.

Not built yet: native audio playback (`media-service`), Android Auto, voice memo
recording and upload, local notifications.

## What makes it a phone and not a kiosk

| | Kiosk (`piano`, `portal`, `shield`) | `phone` |
|---|---|---|
| `lockdown` | Listed | Not listed. The per-device payload test fails a device that is not a kiosk and lists it |
| Home app | Can be made one: a disabled HOME alias comes with `lockdown` and is enabled at the cutover | Never offered: no HOME filter of any kind in the manifest |
| Control API and lifeline | Listen on every interface (`control.bind: lan`) | Neither exists (`control.bind: none`). No port is opened and no control token is in the APK |
| `debug-tools`, `app-launcher` | Listed | Not listed: both exist to be driven over the control API. The payload test fails a device that is not a kiosk and lists either |
| Heartbeats and log shipping | On, to the household log store | Off (`heartbeat.enabled: false`, no log store URL). The test requires heartbeats of kiosks only |
| Self-update and secure-settings permissions | `REQUEST_INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS` | Neither. They come from a kiosk build's generated manifest only |
| Back button | `reload` | `history`: back through the page history, then out of the app |
| Other apps on the device | None | Any. Every component another app can reach is described under "Exported components" |

The phone reaches the backend over an always-on VPN at the address the kiosks use.
The app holds no credential for it: the backend trusts that address. That is why
the links the app accepts are checked as strictly as they are (see "Links").

### No control API

`control.bind: none`. The shell starts no lifeline and the payload starts no
control server; a per-device test starts the payload and asserts that no socket is
bound. The routes are still registered inside the payload, so a capability has one
code path, and nothing can call them from outside the process.

Why not loopback: a loopback socket can be opened by every app installed on the
phone, the token that would guard it is compiled into the APK, and an APK is
readable by other apps on the same phone. An app that read the token could then
have run scripts in the page, launched apps and read the screen. The phone does
not need remote control: its installed components (the link activity, the tiles,
the widget) reach the payload in-process, through a `PayloadPort`, or read what
the payload last wrote.

A `none` build has no control token compiled in, and needs no token entry in the
private file. The payload's router is handed a random token made up for that
process, which nothing can present. A value of `control.bind` the app does not
know is treated as `none`; the build accepts only `lan`, `loopback` and `none`.

**Debugging a phone build is over adb.** `adb logcat` for the app's log lines
(tags starting `Daylight`), and, because every build is debuggable,
`adb shell run-as net.kckern.daylight.phone` for its files: the shell log is
`files/shell.log`, the payload's state is under `files/payloads/state`. The fleet
CLI cannot reach the phone. Settings on the phone are the ones compiled from
`devices/phone.yml`; changing one means a rebuild and an install.

No heartbeats are sent and nothing is shipped to the household log store:
`heartbeat.enabled` is false and `heartbeat.logStoreUrl` is not set. A phone is
somebody's own device, and it is not watched.

## Private values a phone build needs

None of these is in the repo. All go in the private tokens file.

| Where | Name | What |
|---|---|---|
| `placeholders:` | `phone_start_url` | The household site's full https URL as the phone reaches it. `webview.startUrl`; the backend's origin is taken from it |
| `placeholders:` | `phone_link_host` | The site's host name only (lower case, no scheme, port or path). Used for the https link filter (`appLinks.host`) and for `links.origins` |
| `placeholders:` | `phone_user` | The household user the phone acts for: 1 to 64 letters, digits, `.`, `_` or `-`. `identity.user`. Nothing sends it yet; the memo upload will |

The phone needs no top-level entry and no control token in that file. Two more
settings exist with defaults that normally fit, and are set under `defaults:` in
`devices/phone.yml` only when they do not: `identity.device` (sent as
`X-Daylight-Device`; default `fleet:phone`) and `backend.baseUrl` (the backend's
origin; default: the origin of the start URL). Giving the phone its own progress
spot on the backend also needs a `phone` entry in the household's `devices.yml`,
which is a data change and not part of the build.

A build with a missing placeholder fails for that one device, naming the
placeholder. Building a kiosk never needs the phone's values.

## Links

One activity, `LinkActivity` (declared by the `notifications` capability's shell
half), receives every link the app is sent. Launcher shortcuts, tiles and the
widget launch links too, so there is one path to test.

Two forms are links:

| Link | Meaning | Needs the install key |
|---|---|---|
| `daylight://open?path=/media` | Open that page of the site in the app | no |
| `daylight://bookmark/<id>` | Open a configured bookmark | no |
| `daylight://action/<id>?k=<key>` | Run a one-tap action | yes |
| `daylight://memo/new?k=<key>` | Start a voice memo (no handler yet: "Not available on this device") | yes |
| `daylight://media/play?id=<contentId>&k=<key>` | Play natively (no handler yet) | yes |
| `https://<the site>/<path>` | The same as `daylight://open` for that path | no |

The rule: a link kind needs the install key unless all it does is show a page of
the site. `open`, `bookmark` and an https link show a page; `action`, `memo` and
`media` do something else (run an action, record, start playback) and are refused
with `403` without the key. A test fails a kind that is in neither list.

A link is untrusted input. The link activity is exported and browsable so that a
pushed notification or a web page can open a view, which means any app or page on
the phone can send it anything. What happens to a link:

1. **The installed activity** reads the intent's action and its data URI as text,
   and nothing else: no extras, no flags, no clip data. The action must be `VIEW`
   and the text must start with `daylight://`, `https://` or `http://` and be at
   most 4096 characters. Anything else ends there.
2. **The payload** (`notifications`) parses it. A web link is accepted only when
   its origin is the backend's own or one listed in `links.origins`; origins are
   compared exactly, so a host that merely starts like the site's, a different
   port, plain http for an https site or a `user@` form is refused. `intent:`,
   `file:`, `content:`, `javascript:`, `data:` and unknown `daylight://` kinds are
   refused.
3. **The install key.** A link that changes something (`action`, `memo`) must carry
   `?k=<key>`. The key is 32 hex characters made on the phone at first start and
   kept beside the settings overrides. The app's own surfaces add it. It is never
   returned by a route, shown by `GET /settings` or written to a log.
4. **The handler** of the link's kind gets the argument and the query without the
   key. A page link's path must pass `Backend.pagePath`: plain path segments with no
   percent escapes and no `.` or `..` segment, an optional query and fragment, and
   a first segment that is never `api` in any case. A link can therefore never make
   the app send a request to an API route, which matters because the backend trusts
   the phone's address.
5. **The answer** tells the activity to do one of three things: nothing, bring the
   app's own window to the front, or show a short message. An answer cannot name an
   activity, an intent or a URL. An effect an older installed shell does not know
   does nothing.

Every refusal is written to the shell log as `LINK refused: <reason>`. The reason
is one of a few fixed sentences; the link itself, which can hold a key or a
stranger's text, is never logged. At most three refusals a minute are written and
the rest are counted.

`POST /link {"uri": "..."}` on the control API runs the same steps for the CLI. It
answers 200 with the effect, 400 `bad_link`, 403 `forbidden` or 500 `failed`.

### https links of the household site

`appLinks: { host: "{phone_link_host}" }` in the device file adds an https filter
for that one host to the link activity, in the generated device manifest. The
filter is not `autoVerify`: the site publishes no Digital Asset Links file. On
Android 12 and later the owner turns the host on once, in the system settings for
the app under "Open by default". Until then such a link opens in the browser.
Unproven on a phone: the exact steps, and what the Home Assistant companion app
does with a household URL in a push.

### Cold start

Android can create the link activity in a process with no payload loaded. The
activity is visible, so it is allowed to start the shell service. It then waits up
to eight seconds on the `links` port for the payload to attach. If none does, it
shows "Daylight is still starting. Try again in a moment." and leaves the service
starting. A request that was handed to the payload is never sent twice. Unproven
on a phone: how long a cold payload takes, so whether eight seconds is enough.

When a link opens a page and no window is up, the URL is kept for up to a minute
and the window the link activity then brings forward loads it in place of the
start page.

## `bookmarks`

Named pages of the site. Settings `bookmarks.1` to `bookmarks.8`, each
`id|label|icon|path`.

| Part | Rule |
|---|---|
| `id` | `[a-z][a-z0-9-]*`, at most 32 characters, unique |
| `label` | 1 to 40 characters |
| `icon` | A short lower-case name, or empty |
| `path` | A page of the site (the page-path rule under "Links") |

A malformed line is refused when it is set, and as a device default it fails the
build. A duplicate id is left out and reported; the payload still starts.

| Method | Route | Answer |
|---|---|---|
| GET | `/bookmarks` | `{bookmarks: [{id, label, icon, path, uri}], problems: [...]}` |

The phone's three are the shortcuts of the site's web manifest: Feed, Media, Call.

## `one-tap-actions`

An action is defined once, as a settings line, and shown four ways. Settings
`actions.1` to `actions.12`, each `id|label|icon|target`; the label is at most 25
characters.

| Target | Does |
|---|---|
| `open:/path` | Opens that page of the site in the app |
| `bookmark:<id>` | Opens a bookmark |
| `memo:new` | Starts a voice memo. **Stand-in today:** with no recorder in the build it opens the app at `actions.memoFallbackPath` (default `/`) and records nothing. `GET /actions` marks it `placeholder: true` |
| `media:<contentId>` | Plays natively (no handler yet: "not available on this device") |
| `api:/api/...` | Sends an empty `POST` to that backend path and shows the outcome |

An action exists only as a settings line. Running one takes its id and nothing
else: no part of a link, an intent or a request body reaches an `api:` action's
method, path or body. The page bridge has no call that writes a setting, so a page
cannot add or change an action either. With no control API on the phone, changing
one means changing `devices/phone.yml` and installing the new build.

An `api:` action is not queued. With the VPN down it answers "no connection" and
nothing is sent later. A backend that takes more than eight seconds gets "sent, no
answer yet"; the request is left to finish. Each run is written to the shell log
as the action's id and its outcome.

| Setting | Meaning |
|---|---|
| `actions.shortcuts` | Ids of the launcher shortcuts, in order. Empty: the first actions |
| `actions.tiles` | Ids by quick-settings slot; an empty entry leaves a slot unassigned (`memo,,lights`) |
| `actions.memoFallbackPath` | The page a memo action opens until recording exists |

| Method | Route | Answer |
|---|---|---|
| GET | `/actions` | `{actions: [{id, label, icon, kind, target, placeholder?}], problems: [...]}`. No links: a link carries the install key |
| POST | `/actions/run` `{id}` | The action's effect |
| POST | `/actions/publish` | Rebuilds the shortcuts and the tile cache: `{shortcuts, tiles, problems}`. Call it after changing `actions.*` |
| POST | `/actions/pin` `{id}` | Asks the launcher to pin one action; 501 with the reason when it cannot |

### The surfaces

| Surface | Installed code | With no payload loaded |
|---|---|---|
| Launcher shortcuts (long-press) | None: the payload publishes them and the launcher holds them | They stay in the launcher and launch the link activity |
| Pinned shortcuts | None | The same |
| Quick-settings tiles | Four slots, "Daylight 1" to "Daylight 4" | A slot draws its last label from the surface cache; an unassigned slot is shown unavailable |
| Home-screen widget | See `widgets` | Draws from the cache |

A tile on a locked phone asks for the unlock before it launches its action. The
tiles and the widget never call the payload and never start a service: they read
the surface cache (a private preferences file the payload writes) and launch a
link. A cached value that is not a `daylight://` link is treated as an unassigned
slot.

Unproven on a phone: whether `requestPinShortcut` works with no activity in
front, the tile's launch on Android 14 and later (the code uses the
`PendingIntent` overload by reflection there), and how the launcher rate-limits
publishing.

## `widgets`

One widget, "Daylight actions": up to four buttons bound to the same actions.
`widgets.actions` lists the ids in order; empty means the first four. Without
`one-tap-actions`, or before the payload has ever run, the widget has one button,
"Daylight", that opens the app.

| Method | Route | Answer |
|---|---|---|
| GET | `/widgets` | `{slots: [{id, label}], problems: [...]}` |
| POST | `/widgets/refresh` | Writes the slots and asks the widget to redraw |

The widget is redrawn when the payload starts and whenever the actions are
published.

## Exported components

What another app on the phone can reach, and what stands in the way.

| Component | Why it is exported | What protects it |
|---|---|---|
| `LinkActivity` | Links from notifications, pages and the app's own surfaces | The checks under "Links": origin, page path, install key, a fixed list of effects |
| `ActionTileService$Tile1` to `$Tile4` | The system binds tiles | `BIND_QUICK_SETTINGS_TILE`: only the system can bind. They take no input from the caller |
| `KioskActivity` (`webview-host`) | It is the launcher icon | It reads nothing from the intent that starts it |
| `MainActivity` (shell) | The setup activity, startable by name | It reads nothing from the intent |
| `BootReceiver` (shell) | Boot and package-replaced broadcasts, and the app's own keep-alive alarm | Whatever it is sent, all it ever does is start the shell service |
| `ActionWidgetProvider` | Not exported | Reached by the system's widget host and by the app only |
| `ShellService`, `InstallReceiver` | Not exported | |

## Not covered by JVM tests

- Everything Android does with the manifest: whether the launcher lists the app
  once, whether the phone ever offers it as a home app (the manifest has no HOME
  filter; the verifier and a `buildSrc` test check that), link resolution, the
  tile and widget hosts.
- `LinkActivity`, `ActionTileService` and `ActionWidgetProvider` themselves. Their
  decisions are in pure classes that are tested (`LinkRequest`, `LinkAnswer`,
  `TileFace`, `WidgetButtons`); the Android calls around them are not.
- `AndroidSurfaces` and `AndroidWidgetSink` against a real launcher. On the JVM
  they are started over a context with no shortcut service and no widget host,
  which shows only that they do nothing and do not throw there.
- That nothing listens on a real phone. The tests start the payload for the phone's
  configuration and show no control socket is bound and the port stays free; the
  shell's decision not to start a lifeline is one line that reads the same value
  and is not exercised on the JVM.
