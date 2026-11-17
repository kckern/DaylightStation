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

What the phone build has: the site's mobile web views (`webview-host`), links
(`notifications`), `bookmarks`, `one-tap-actions`, `widgets`, native audio playback
(`media-service`) with Android Auto (`android-auto`), voice memos for the Journalist
(`voice-memo`) and the app's own local notifications. What it does not have is
under "What the phone does not have".

## What makes it a phone and not a kiosk

| | Kiosk (`piano`, `portal`, `shield`) | `phone` |
|---|---|---|
| `lockdown` | Listed | Not listed. The per-device payload test fails a device that is not a kiosk and lists it |
| Home app | Can be made one: a disabled HOME alias comes with `lockdown` and is enabled at the cutover | Never offered: no HOME filter of any kind in the manifest |
| Control API and lifeline | Listen on every interface (`control.bind: lan`) | Neither exists (`control.bind: none`). No port is opened and no control token is in the APK |
| `debug-tools`, `app-launcher` | Listed | Not listed: both exist to be driven over the control API. The payload test fails a device that is not a kiosk and lists either |
| Heartbeats and log shipping | On, to the household log store | Off (`heartbeat.enabled: false`, no log store URL). The test requires heartbeats of kiosks only |
| Self-update and secure-settings permissions | `REQUEST_INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS` | Neither. They come from a kiosk build's generated manifest only |
| Drawing over other apps, the page's camera | `SYSTEM_ALERT_WINDOW`, `CAMERA` (marked `kioskOnly` in `webview-host`'s `capability.yml`) | Neither: the phone's generated manifest removes them |
| Lock task, TV launcher entry | `lockTaskMode="if_whitelisted"` and a `LEANBACK_LAUNCHER` category on the kiosk Activity | Neither: removed by the phone's generated manifest |
| Setup activity (`MainActivity`) | Exported, startable by name over adb | Not exported |
| Plain-http traffic | Allowed (LAN services) | Refused by the platform: `usesCleartextTraffic="false"`, and the build fails on an address setting that is not https |
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

### The lock screen, the microphone and the camera

Three settings of `webview-host` are off in the code and on only where a device
file says so. The kiosks set all three to true; `devices/phone.yml` sets all three
to false, and a per-device test fails a device that is not a kiosk with any of them
on, or a device file that leaves one unstated.

| Setting | Phone | What it decides |
|---|---|---|
| `webview.showWhenLocked` | false | Whether the web view's window shows over the lock screen. The installed Activity does not show there until the payload tells it to. On the phone the site (admin, finance, health) is behind the lock |
| `webview.allowMic` | false | Whether a page's `getUserMedia` audio request can be granted |
| `webview.allowCamera` | false | The same for video |

Keep-screen-on, immersive mode and lock task are asked for only by `screen-power`
and `lockdown`, which the phone does not list (the same test fails a phone build
that lists either). The Activity never turns the screen on and never dismisses the
keyguard.

When a build does allow capture, a request is granted only when all of these hold:

1. The asking origin is the start URL's or one in `webview.bridgeOrigins`.
2. The setting for that resource is true.
3. The app holds the Android permission (`RECORD_AUDIO`, `CAMERA`). On the phone
   the app holds `RECORD_AUDIO` after the first voice memo, so this condition alone
   protects nothing there.
4. The document was not opened by a link without the install key. The app
   remembers how the document in the page got there. A link from another app or a
   web page (`daylight://bookmark/call`, say) marks it; the mark stays through a
   retry, a reload and a redirect the page makes by script, and is cleared by a
   load the app started (the start page, a keyed link) or by a navigation the owner
   started with a tap inside the page. A kiosk has no link activity and never sets
   the mark.

So with capture allowed, a page can start the microphone when the owner opened it
from inside the app or from one of the app's own keyed surfaces, and cannot when
another app or a web link opened it. With the phone's settings no page can.

## Private values a phone build needs

None of these is in the repo. All go in the private tokens file.

| Where | Name | What |
|---|---|---|
| `placeholders:` | `phone_start_url` | The household site's full https URL as the phone reaches it. `webview.startUrl`; the backend's origin is taken from it |
| `placeholders:` | `phone_link_host` | The site's host name only (lower case, no scheme, port or path). Used for the https link filter (`appLinks.host`) and for `links.origins` |
| `placeholders:` | `phone_user` | The household user the phone acts for: 1 to 64 letters, digits, `.`, `_` or `-`. `identity.user`. The memo upload sends it, and sends nothing without it |

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
| `daylight://open?path=/media` | Open that page of the site in the app | no, when the path is exactly a configured bookmark's; yes for any other page |
| `daylight://bookmark/<id>` | Open a configured bookmark | no |
| `daylight://action/<id>?k=<key>` | Run a one-tap action | yes |
| `daylight://memo/new?k=<key>` | Open the recorder and start a voice memo; while one is being recorded, stop and save it | yes |
| `daylight://memo/queue?k=<key>` | Try every waiting and parked memo again, and say how many there are | yes |
| `daylight://media/play?id=<contentId>&k=<key>` | Play that household item natively | yes |
| `https://<the site>/<path>` | The same as `daylight://open` for that path, without a key | no key can be given; only a bookmarked path opens |

The rule: a link kind needs the install key unless all it does is show a page of
the site. `open`, `bookmark` and an https link show a page; `action`, `memo` and
`media` do something else (run an action, record, start playback) and are refused
with `403` without the key. A test fails a kind that is in neither list.

A page link without the key is held to less than one with it, because any app or
web page can send it:

- It opens only a page that is configured as a bookmark: the path must be exactly a
  bookmark's path, with no query or fragment of the sender's. Any other path is
  refused with `400`. That holds for an https link of the site too, so a relayed
  push can open the bookmarked pages and no others.
- The page it opens is given no microphone and no camera (see "The lock screen,
  the microphone and the camera").

The app's own surfaces send keyed links, and a one-tap action that opens a page
runs inside the app, so neither limit applies to them.

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
3. **The install key.** A link that changes something (`action`, `memo`, `media`) must carry
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
| `memo:new` | Opens the recorder and starts a voice memo; tapped again while one is being recorded, stops and saves it. In a build with no `voice-memo` it is a stand-in that opens the app at `actions.memoFallbackPath` and `GET /actions` marks it `placeholder: true`; a per-device test fails a phone build where that is so |
| `media:<contentId>` | Plays that household item natively (`media-service`) |
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
| `actions.memoFallbackPath` | The page a memo action opens in a build without `voice-memo` |

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

## `media-service`

Native audio playback of household media: lock-screen and headset controls, a media
notification, and browsing from a car. Audio only. A video item is not played
natively and answers "Could not start playback"; it plays in the web view.

### Who does what

| Piece | Installed (shell half) | Payload | With no payload loaded |
|---|---|---|---|
| `DaylightMediaService`, a Media3 `MediaLibraryService` | The ExoPlayer, the session, audio focus, "headphones unplugged", the media notification and the foreground state (type `mediaPlayback`) | What a browse level holds, which stream a media id resolves to, when progress is reported | Starts the shell service, which loads the payload. A browse of the root waits up to 4 s and then answers one tab, "Daylight is starting", with nothing under it; browsers of the root are told to ask again when a payload attaches (within two minutes). A play request fails. Nothing crashes and nothing runs on the main thread |
| `PlayActivity` (not exported, no window) | Builds a media controller, sets one media id, plays, and stays up until playback started, failed or 8 s passed | Starts it, on a keyed `media` link | Not reached: the link activity already waited for the payload |

The installed service asks the payload through the `media` `PayloadPort`, in
process, as JSON: `browse`, `resolve`, `event`. It hands back media ids and nothing
else. The same three are routes (`GET /media/browse`, `POST /media/resolve`,
`POST /media/event`) and `GET /media/status` gives `{lastReportAtMs, lastError,
reports, problems}`; on the phone nothing serves them to anyone.

Media3 is pinned to 1.1.1, the newest version whose libraries build with
compileSdk 33 and Android Gradle Plugin 7.4.2. A newer one needs a newer compileSdk
for every device.

### Only household media plays

- A media id is `root`, `recent`, `catalog`, `c:<contentId>` (a container),
  `m:<skip>|<contentId>` (a later page of it) or `p:<contentId>[|<parent>]` (an
  item). Anything else is refused. An id is never a URL.
- A content id is `<source>:<localId>`, checked before it becomes path segments of
  a backend route: no relative or empty segment, no backslash, bar or control
  character, and no segment the backend reads as a modifier (`shuffle`, `playable`,
  `launchable`, `recent_on_top`, `expand`).
- What plays is the `mediaUrl` in the backend's own answer for that id, and only
  when it is on the backend's origin. A controller's own URI on an item is dropped.
- A `media` link carries a content id and this install's key. Nothing else in the
  link is read.

### Who may connect

The library service is exported with no permission: a car, the system's media
controls and Bluetooth reach it by binding it, and no permission exists that only
they hold. Every app on the phone can therefore try to connect, and one that got
in could browse the household library and recent titles and start playback.

A package name proves nothing: Media3 1.1.1 takes it from what the caller sends.
The uid is the caller's own, from Binder. Each connection is decided by
`ControllerPolicy` from the two together:

| Caller | Accepted when |
|---|---|
| This app | Its uid and its package name |
| A system uid | The app id (uid modulo 100000) is below 10000, Android's first application uid: the system server (1000), Bluetooth (1002), the media server (1013), adb's shell (2000). Nothing a user installs runs there |
| A platform-signed package | The caller's uid owns the package it names (`getPackagesForUid`) and that package is signed with the certificate the platform itself is signed with (`checkSignatures("android", ...)`). This is how the system UI's lock-screen and shade controls get in: it runs under an app uid |
| A pinned package | The caller's uid owns the package it names and the SHA-256 of that package's signing certificate equals the pin for it in `media.controllerPins` |
| Anything else | Refused: a forged name at another uid, a right name with the wrong certificate, a package with no pin, a caller Android cannot name (a legacy controller before Android 9) |

No package is trusted by name and no certificate digest is compiled in.
`media.controllerPins` is a setting: `package=sha256, package=sha256`, each digest
64 hex characters (colons and upper case accepted). Its default, and the phone's
value until the owner adds to it, is empty.

**The first connection from a car is refused by design.** The refusal is logged
with the package and the digest Android reports for its certificate, both public
values:

```
Daylight-Media: refused media controller <package>: no pin for this package. To allow it, add <package>=<sha256> to media.controllerPins
```

The owner reads that line from `adb logcat -s Daylight-Media`, checks that the
package is the one expected (Android Auto, the Google app for Assistant), adds the
entry under `defaults:` in `devices/phone.yml`, rebuilds and installs. A digest is
not private, so it may be written in the device file. The payload hands the pins
to the installed service through the surface cache at each start, so a car that
binds the service before a payload is loaded is held to the pins of the last run;
a phone on which the payload has never run has none.

Unproven on a phone: that a package binding the service is visible to the app
(Android 11 and later make it so without a `queries` entry; if it is not, every
third-party controller is refused as "not the caller's"), how each car and
assistant app identifies itself, and that the system UI is platform-signed on the
owner's phone (if it is not, its line appears in the log like any other and it is
pinned the same way). Below Android 9 no third-party controller can be pinned.

### Backend endpoints

Read from the backend's code; the app has never called them.

| Call | Used for | Fields read |
|---|---|---|
| `GET /api/v1/list/` | The `catalog` tab | `items[]`: `id`, `title` or `label`, `itemType` (`container`), `thumbnail` |
| `GET /api/v1/list/<source>/<localId>?take=&skip=` | One page of a container | `total`; `items[]`: `id`, `title` or `label`, `itemType`, `play` (an object when the item has a stream), `artist`, `grandparentTitle`, `parentTitle`, `thumbnail`. The route sends no `metadata` object and turns a string of digits into a number |
| `GET /api/v1/queue/<source>/<localId>` | Everything playable in a container | `items[]`: `contentId` or `id`, `title`, `mediaUrl`, `mediaType` (`audio` only), `duration` (seconds), `thumbnail`, `artist`, `album`, `parentTitle`, `grandparentTitle`, `listId`, `resumable`, `resumePosition` |
| `GET /api/v1/play/<source>/<localId>` | One item | `id` or `assetId`, `mediaUrl`, `mediaType`, `title`, `duration`, `thumbnail`, `parentTitle`, `grandparentTitle`, `metadata.artist`, `metadata.album`, `resume_position` (seconds, only for a resumable item in progress). A container answers with its first playable item; the id in the answer then differs and the container is queued |
| `GET /api/v1/media/household/recent?limit=` | The `recent` tab | `items[]`: `contentId`, `title`, `thumbnail`, `parentTitle`, `grandparentTitle`; an entry with no title is left out |
| `POST /api/v1/play/log` | Progress | Sends `type` (the content's source), `assetId` (the content id), `seconds`, `percent`, `title`, `listId` (null when none): the web player's fields. Sent with `X-Daylight-Device` |

Not confirmed from code, and handled so that being wrong plays nothing or reports
nothing more than intended: that `resumePosition` on a queue item is seconds;
that `type` set to a source other than `plex` or `files` is accepted by
`play/log` (the web player sends `plex` for a track and `files` otherwise); the
`type` values of recent entries (a recent video is listed and then refused at
play). A Plex track is never resumable on the backend, so music starts at its
beginning.

- A Plex stream URL gets `session=daylight-<device id>` when it has none, as the
  web player's does, so Plex sees one client.
- Resume: the position the backend gives, for a single item. A Plex stream URL
  that already carries `offset=` is not sought again.
- Progress follows the web player: at most one report every 10 seconds while
  playing and only past 10 seconds; one more when an item is paused, stopped or
  replaced, unless it was a skim (under 10 seconds and under 90 percent); one at
  the end at 100 percent, with no `naturalEnd`. A report that fails is dropped;
  the next carries a later position.
- The phone's own progress spot on the backend needs a `phone` entry in the
  household's `devices.yml`. Without it reports are still saved, with no
  per-screen spot.

### Browsing

| Setting | Default | Meaning |
|---|---|---|
| `media.roots` | `Recent=recent;Browse=catalog` | The tabs: `Label=target;...`, at most four, a label at most 24 characters, a target `recent`, `catalog` or a container's content id |
| `media.recentLimit` | 30 | Entries of the recent tab (1 to 100) |
| `media.pageSize` | 50 | Entries of one level (10 to 200). A longer container ends with a browsable entry, "More (51 to 100 of 120)" |
| `media.controllerPins` | empty | The apps that may connect beside this app and the system: `package=sha256, ...` (see "Who may connect") |

A level is kept in memory for a minute and served from there; when the backend is
out of reach the last answer is served, however old; a level never loaded fails
(an empty shelf would read as an empty library). An image is given to a browser
only when it is an https URL on the backend; anything else is left out, in the
payload and again in the installed service.

## `android-auto`

Declarations only: a `com.google.android.gms.car.application` meta-data entry
pointing at `automotive_app_desc.xml` (`<uses name="media"/>`) and a one-colour
attribution icon. Browsing and playback are `media-service`, which the capability
requires; the verifier fails a build that has the declaration without it, or has it
without listing `android-auto`.

The app is sideloaded, so Android Auto lists it only after a one-time developer
setting on the phone:

1. Open Android Auto's settings, scroll to "Version and permission info" and tap
   it ten times; accept developer mode.
2. In the three-dot menu open "Developer settings" and turn on the option for apps
   from unknown sources. Its exact label is not confirmed.

Testing without a car, with the Desktop Head Unit:

1. In Android Studio's SDK Manager, SDK Tools, install "Android Auto Desktop Head
   Unit Emulator". It lands in `<sdk>/extras/google/auto/`.
2. On the phone, in Android Auto's three-dot menu, choose "Start head unit server".
3. `adb forward tcp:5277 tcp:5277`, then run `desktop-head-unit` from that directory.

Sources: `https://developer.android.com/training/cars/testing`,
`https://developer.android.com/training/cars/testing/dhu`,
`https://developer.android.com/training/cars/media/auto`.

## `voice-memo`

A memo is recorded on the phone and sent to the Journalist, which transcribes it,
saves a journal entry and answers in the owner's Telegram conversation with the
transcript and then a follow-up question, as it does for a Telegram voice message.

**A memo is journaled at upload time.** The backend stamps the entry when it
receives the audio. A memo recorded with no connection is journaled when it
uploads, which can be hours later.

### Recording

| Piece | Installed (shell half) | Payload | With no payload loaded |
|---|---|---|---|
| `RecordActivity` (not exported) | Asks for the microphone, starts the recorder, shows a clock and "Stop and save" | Opens it, on a keyed `memo/new` link, after checking that `identity.user` is set | Not reached through a link: the link activity waited for the payload. From the recording's notification it works as always |
| `MemoRecorderService` (not exported; foreground service of type `microphone`) | Records to `<files>/memos/inbox/<id>.m4a.part` and renames it to `<id>.m4a` when whole | Told over the `memos` port | Recording does not need the payload. The file waits in the inbox for the payload's next scan |

- A memo recording starts only from a tap on this phone: a tile, the widget, a
  launcher shortcut (each a keyed link). A page of the site cannot start the memo
  recorder: it has no way to build a keyed link, and the record screen is not
  exported.
- A page's own use of the microphone or camera (`getUserMedia`, which the site's
  call page asks for when it loads) is a separate path, through the web view. On
  the phone it is off: `webview.allowMic` and `webview.allowCamera` are false in
  `devices/phone.yml`, so every such request is denied. See "The lock screen, the
  microphone and the camera" for the rule that holds when a build turns them on.
- A notification is up for as long as it records, with a Stop action. The record
  screen's button, the notification's Stop, and the memo tile or widget button
  tapped again all stop and save. A second tap within 1.5 seconds of the start is
  taken as the same tap.
- AAC in an MP4 container, mono: 16 kHz at 32 kbit/s, and where the phone's
  encoder refuses that, 44.1 kHz at 64 kbit/s. Sent as `audio/mp4`.
- Hard cap: 30 minutes (and 24 MB), then it stops and saves.
- A call, or another app taking audio focus, stops the recording and saves what
  was said so far. So does an error from the recorder, when its stop succeeds.
- Discarded: a recording under one second, an empty file, and one whose recorder
  could not write its index. A recording cut off because the app was killed is a
  `.part` file that nothing can play; it is removed when the next recording starts,
  or by the payload once it is two hours old. **That memo is lost.**
- A memo's id is `<start ms>-<8 hex>`. Files are in the app's private storage.

### The upload queue

Kept on disk (`files/payloads/state/memo-queue.json`), so it survives the process
being killed and a restart of the phone.

```
QUEUED ──► UPLOADING ──200──► gone (the audio is deleted)
  ▲            │ no answer, or one that may change: wait 5 s, 10 s ... 1 h
  └────────────┘
               │ refused, or the 20th failure the backend answered
               ▼
            PARKED (the audio is kept)
```

One memo is sent at a time. Nothing is tried while Android reports no network; a
network coming up wakes the queue.

```
POST /api/v1/journalist/memo?user=<identity.user>
Content-Type: audio/mp4
X-Daylight-Memo-Id: <id>
X-Daylight-Recorded-At: <epoch ms>
```

| Answer | The queue |
|---|---|
| 200 with `duplicate: true` or `false` | Done. The audio is deleted, and only then |
| 200 with anything else (a sign-in page of some network) | Tried again; counts |
| 400, 413, 415, 422 | Parked with the status and the backend's error code |
| 404 (the user is not set up yet), 500, 503, any other status | Tried again; counts |
| No answer within 330 seconds | Tried again; counts. The backend answers the same id as a duplicate |
| No connection | Tried again; does not count, however often |

After 20 counted failures a memo is parked. A parked memo keeps its audio and is
tried again by a tap on its notification (`daylight://memo/queue`). A recording
over 26,214,400 bytes is parked without being sent.

**With `identity.user` empty nothing is sent and nothing is recorded.** The memo
action answers "Voice memos are not set up on this phone: identity not
configured"; a memo already kept stays on the phone, is not retried in a loop, and
a notice says so. The value is a build-time placeholder (`phone_user`), and a
per-device test fails a phone build without it.

| Method | Route | Answer |
|---|---|---|
| GET | `/memo/queue` | `{waiting, parked, uploaded, lost, memos: [{id, state, attempts, lastError, ...}], blocked, problems}` |
| POST | `/memo/recorded` | Scans the inbox |
| POST | `/memo/retry` | Makes every memo due now |

Privacy: the shell log and logcat hold a memo's id, its length and its size.
Nothing of the audio, and no transcript, is read, kept or logged on the phone.

## Local notifications

The app posts its own notifications for things it owns. There is no push
transport: household pushes keep arriving through the Home Assistant relay.

| What | Channel | Posted by |
|---|---|---|
| Playback | Media3's own | The media session. Exempt from the notification permission |
| "Recording a voice memo", with Stop | `daylight_recording` (low) | The recorder service; a foreground-service notification |
| "N voice memos waiting to upload" | `daylight_uploads` (low) | `voice-memo`, after a pass that left memos waiting |
| "N voice memos could not be sent. Tap to try again." | `daylight_uploads` | `voice-memo`, when memos are parked |
| "Voice memos are not set up: identity not configured. N voice memos are kept on this phone." | `daylight_uploads` | `voice-memo` |

A notice is a count and a state. A tap opens a `daylight://` link through the link
activity, with the install key added by `notifications` where the link's kind
needs it. A capability posts through `LocalNotices` (`core/spi`); a state is
posted once, and the notice is removed when nothing is left to say.

`POST_NOTIFICATIONS` is asked for in the app, once, on Android 13 and later: the
record screen asks the first time a memo is made, beside the microphone. It is
never asked at install, and a "no" is not asked again. Recording does not depend
on the answer. `GET /notify/status` gives `{permission, channels}`.

How a relayed push can open a view: a push whose tap target is a household https
URL opens in the app once the host is turned on under "Open by default"; a
`daylight://open?path=...` or `daylight://bookmark/<id>` link needs no key. A push
cannot run an action, start a memo or start playback: those need the install key,
which never leaves the phone. Which field of the Home Assistant companion app
carries a tap target is not confirmed, and no producer sets one.

## What the phone does not have

- **No control API and no lifeline.** Nothing listens on any address. The fleet CLI
  answers every command for `phone` with how it is debugged instead.
- **No debug tools**: no `debug-tools`, no `app-launcher`, no remote script, shell
  or screenshot.
- **No heartbeats and no log shipping.** Nothing about what is played or recorded
  leaves the phone except the progress reports and the memo upload themselves.
- **No lockdown**, and it is never offered as the home app.
- **No self-update** and no settings change at run time: a new build is installed.
- **No playback resumption** after the media service is gone: a headset button does
  not restart the last queue.
- **No queue for progress reports or `api:` actions**: with no connection they are
  dropped.

Debugging: `adb logcat --pid=$(adb shell pidof -s net.kckern.daylight.phone)` (tags
`Daylight`, `Daylight-Link`, `Daylight-Media`, `Daylight-Memo`), and
`adb shell run-as net.kckern.daylight.phone` for `files/shell.log`,
`files/payloads/state/` and `files/memos/inbox/`.

## The exact list

A device with `control.bind: none` is held to an exact list of permissions and
exported components. The build fails (`:shell:checkPhoneMergedManifest`, part of
`./gradlew build`) and so does `tools/verify-build.mjs phone` when the phone's
merged manifest or APK holds anything else, or lacks something on the list. The
list is not written down once: it is the base shell's, plus what each listed
capability declares in its `capability.yml` (`permissions:` without the entries
marked `kioskOnly: true`, and `exported:`), plus `permissions:` in the device
file.

### Permissions

Twelve:

| Permission | From | Why |
|---|---|---|
| `INTERNET` | base | The site and the backend |
| `FOREGROUND_SERVICE` | base | The shell service |
| `RECEIVE_BOOT_COMPLETED` | base | Start after a restart |
| `WAKE_LOCK` | base | Playback and uploads with the screen off |
| `POST_NOTIFICATIONS` | base | The service's and the app's own notifications |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | base | Declared; the phone build has no screen that asks for it (the setup activity is not reachable) |
| `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE` | base, `webview-host`, `media-service`, `voice-memo` | Reload and upload when a network returns |
| `RECORD_AUDIO` | `webview-host`, `voice-memo` | Voice memos. No page is given it (`webview.allowMic` is false) |
| `MODIFY_AUDIO_SETTINGS` | `webview-host` | Page audio |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | `media-service` | The media library service |
| `FOREGROUND_SERVICE_MICROPHONE` | `voice-memo` | The recorder service |

Not in the phone's APK, though a kiosk has them: `SYSTEM_ALERT_WINDOW`, `CAMERA`,
`REQUEST_INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS`. Turning the page camera on
for the phone later means taking `kioskOnly` off `CAMERA` in `webview-host`'s
`capability.yml` as well as setting `webview.allowCamera`.

### Application settings

- `usesCleartextTraffic="false"`: the platform refuses a plain-http request from
  the app. The build also fails when `webview.startUrl`, `backend.baseUrl`,
  `heartbeat.logStoreUrl`, `heartbeat.backendUrl` or an entry of `links.origins`,
  `webview.allowedOrigins` or `webview.bridgeOrigins` resolves to anything but
  https for a `control.bind: none` device; the message names the setting and
  never the value.
- No backup and no transfer: `allowBackup="false"`, and
  `fullBackupContent` and `dataExtractionRules` (Android 12 and later) both
  exclude every domain, for cloud backup and for a transfer to a new phone. The
  link key, the settings and a queued recording stay on the phone they were made
  on. This holds for the kiosks too.
- No `lockTaskMode` on any activity and no `LEANBACK_LAUNCHER` category.

### Debug and release builds

`./gradlew :shell:assemblePhoneDebug` builds the debuggable APK, signed with the
Android debug key. A debuggable build lets `adb shell run-as` read the app's
private data: the link key, the settings and queued memo audio. That needs ADB
enabled on the phone, which it is not by default, and the owner's unlock to
authorize the workstation. It is an accepted limit on the owner's own phone, and
it is the reason the debugging notes on this page work at all.

`./gradlew :shell:assemblePhoneRelease` builds a release APK that is not
debuggable. It is signed only when the private tokens file names a keystore
under `placeholders:`:

```yaml
placeholders:
  phone_keystore: "{keystore-file}"          # a path relative to the private file's directory
  phone_keystore_password: "{store-password}"
  phone_key_alias: "{key-alias}"
  phone_key_password: "{key-password}"
```

Without those four the release APK comes out as `shell-phone-release-unsigned.apk`
and cannot be installed; the debug build is then the only installable one. The
build creates no keystore, and none is ever committed. A signed release is
checked with `node tools/verify-build.mjs phone --release`, which fails an APK
that is debuggable or signed with the debug key. A release build cannot be
installed over a debug build (the signatures differ): uninstall first, which
removes any memo not yet uploaded. With a release build `run-as` does not work,
so the `run-as` steps of the acceptance runbook need the debug build.

## Exported components

What another app on the phone can reach, and what stands in the way.

| Component | Why it is exported | What protects it |
|---|---|---|
| `LinkActivity` | Links from notifications, pages and the app's own surfaces | The checks under "Links": origin, page path, install key, a fixed list of effects |
| `ActionTileService$Tile1` to `$Tile4` | The system binds tiles | `BIND_QUICK_SETTINGS_TILE`: only the system can bind. They take no input from the caller |
| `KioskActivity` (`webview-host`) | It is the launcher icon | It reads nothing from the intent that starts it. It shows nothing over the lock screen and has no lock task |
| `MainActivity` (shell) | Not exported on the phone | Another app could otherwise start it to put the battery-exemption screen and permission prompts in front of the owner |
| `BootReceiver` (shell) | Boot and package-replaced broadcasts, and the app's own keep-alive alarm | Whatever it is sent, all it ever does is start the shell service |
| `DaylightMediaService` (`media-service`) | A car, the system's media controls and Bluetooth bind it | No permission exists that only they hold. `ControllerPolicy` accepts this app, a system uid, a platform-signed package and a package whose certificate is pinned, each checked against the caller's uid, per connection. A controller hands over media ids; what plays is the backend's answer |
| `ActionWidgetProvider` | Not exported | Reached by the system's widget host and by the app only |
| `PlayActivity`, `RecordActivity`, `MemoRecorderService` | Not exported | Started by this app only |
| `ShellService`, `InstallReceiver` | Not exported | |

Eight components are exported: `LinkActivity`, `KioskActivity`, the four tile
services (which the system alone can bind), `DaylightMediaService` and
`BootReceiver`. A ninth, or one of these no longer exported, fails the build.

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
- `DaylightMediaService`, `LibraryCallback`, `PlaybackEvents`, `PlayActivity`: the
  Media3 player and session, audio focus, the media notification, a car. Their
  decisions are in pure classes that are tested (`ControllerPolicy`, `BrowseAnswer`,
  `TrackAnswer`, `PayloadMedia`).
- `MemoRecorderService` and `RecordActivity`: the microphone, the encoder, the
  foreground service, the permission dialogs. Their decisions are in
  `RecorderMachine`, `MemoFiles` and `PermissionAsk`, which are tested.
- `AndroidNotices`: a notification on a screen. On the JVM it runs over a context
  with no notification service, which shows only that it does nothing there.
- The backend's side of every media and memo request. The tests use a fake backend
  built from the backend's code as read; no request has been sent.
- That nothing listens on a real phone. The tests start the payload for the phone's
  configuration and show no control socket is bound and the port stays free; the
  shell's decision not to start a lifeline is one line that reads the same value
  and is not exercised on the JVM.
