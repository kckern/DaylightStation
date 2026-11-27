# DaylightStation Android on the phone

`devices/phone.yml` builds the owner's own phone app from the same codebase as the
kiosks. This page covers what is different on the phone and the capabilities that
exist only for it. The phone has no control API and no lifeline. Building, the
routes (which the phone registers and serves to nobody), settings and the fleet CLI are in
`__docs/reference/android/README.md`; the web view and its page bridge are in
`__docs/reference/android/kiosk.md`.

Build 49 was observed on Android 17 with Apex as the active launcher. Build 50 is
a signed debug checkpoint for testing the upgrade with a private draft. The acceptance
runbook records setup and actual use separately for each launcher and identifies
which steps need the paired web and backend build, a physical fixture, or another
person. See [phone acceptance](../../runbooks/android/phone-acceptance.md).

What the phone build has: the site's mobile web views (`webview-host`), links
(`notifications`), `bookmarks`, `one-tap-actions` (with the "On my way"
placeholder), `widgets` (a four-button widget and one-action buttons), native audio
playback (`media-service`, with playing from a widget or tile with no window and
pinning media from the site) with Android Auto (`android-auto`), a list of household
actions and a voice memo in the car (`car-actions`), quick inputs for the
Journalist and Nutribot (`quick-input`: a recording, typed text or a photo), a share
target in Android's share sheet (`quick-input`: a shared link goes to the share
router; a video plays on a screen) and
the app's own local notifications. What it does not have is
under "What the phone does not have".

## Phone home

The app icon opens setup. The app's name where Android shows it (the launcher,
Settings, the share sheet, the notification group, Android Auto) is the device
file's `label:` (default **Home**); the app's own screens never name a brand (see
**Polish, shell 180**). Choose Health, Home, Lifelog, Media or
Call to add its own shortcut to Android Home. Journal and Meal capture shortcuts
open the recorder, text form or camera directly from Android Home. **Meal
barcode** opens the Health quick scanner: scan after scan, each one logged with a toast
and Undo, Done to leave. **Capture status** opens receipt and retry
controls. Full Journal needs a supported mobile destination.

A service shortcut starts a fresh service WebView. Back follows that service’s
history and returns to Android Home from its root. Health, Home, Lifelog and
Media can show sign-in in place and reload the requested address after sign-in.
Call uses the household network and opens local preview before screen selection.

Tap the named service or capture row marked **+** to request a shortcut.
The row announces **Add to home screen** with its name in TalkBack. **Confirm
in Android** means Daylight is waiting for the launcher. **Added** means the launcher
reported success. Check Android Home for the icon. After 10 seconds without a
callback, **Placement unconfirmed** lets you check your home screen and retry.
Launchers such as Apex can also offer Daylight in their shortcut chooser. Choose
a supported service or capture action there when assigning a gesture.

Use **Play on demand → Playlists** to stage a playlist, then use **Staged**
or the launcher's **Daylight playlist** widget picker to place its 1×1 widget.
See the [phone experience guide](../../../_extensions/daylight-android/PHONE-EXPERIENCE.md)
for catalog selection, search and recents in the picker, Drive staples, and
Driving Radio.

## What makes it a phone and not a kiosk

| | Kiosk (`piano`, `portal`, `shield`) | `phone` |
|---|---|---|
| `lockdown` | Listed | Not listed. The per-device payload test fails a device that is not a kiosk and lists it |
| Home app | Can be made one: a disabled HOME alias comes with `lockdown` and is enabled at the cutover | Never offered: no HOME filter of any kind in the manifest |
| Control API and lifeline | Listen on every interface (`control.bind: lan`) | Neither exists (`control.bind: none`). No port is opened and no control token is in the APK |
| `debug-tools`, `app-launcher` | Listed | Not listed: both exist to be driven over the control API. The payload test fails a device that is not a kiosk and lists either |
| Heartbeats and log shipping | On, to the household log store | Off (`heartbeat.enabled: false`, no log store URL). The test requires heartbeats of kiosks only |
| Self-update and secure-settings permissions | `REQUEST_INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS` | Neither. They come from a kiosk build's generated manifest only |
| Shell service | Kept in the foreground with a notice, restarted by a keep-alive alarm and at boot | Started on demand (`ShellStart.ensure`, from a visible screen), no notice, not restarted when Android stops it. `PERSISTENT_SERVICE` is `control.bind != none`. A queued capture schedules a one-shot job (`UploadJob`, about 45 s later) that starts the service again to send it if the app was stopped |
| Drawing over other apps | `SYSTEM_ALERT_WINDOW` | Removed from the phone manifest |
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

A `none` build has no control token compiled in. The payload's router is handed a
random token made up for that process, which nothing can present.

It does compile one other token: the **inbox token** (`BuildConfig.INBOX_TOKEN`), the
device's entry in the private tokens file, which the payload sends as a bearer token
when it polls the backend's command inbox (Play on Phone, Keep on Phone). Its scope is
only this device's inbox: its own commands, acks and keeps report, never a control API
and never another device. It is readable by other apps on the phone, the same as any
compiled value; that is the accepted risk for what it guards. Rotating it means a new
value in the tokens file and a rebuild and install (the backend reloads its copy). A
build for an emulator (`-PemulatorInbox`) carries the `<id>-emulator` entry instead,
never the device's own, and a device build that finds itself on an emulator sends no
token at all. A phone build without an entry for its id polls with no token, which the
backend refuses once it requires one. A value of `control.bind` the app does not
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

On the phone, `webview.callPermissions` scopes runtime prompts to trusted
household capture pages. Call can request camera and microphone. The Health
barcode route can request camera for barcode scanning. Open the Call widget and allow Camera and
Microphone while using Daylight. A denial offers **App settings**. Choose
**Permissions**, change the relevant permission, then return and retry.
A call page opened from an external unkeyed link cannot request capture.
Other phone pages keep general web audio and video capture disabled. The barcode
scanner releases the camera at review and when backgrounded. **Log item**
commits the reviewed product, portion and meal with an operation ID. Verify the
entry reference and Undo, or open it through **View in Health**. **Scan another**
begins a separate attempt. **Done** on the trusted originating shortcut returns
to Android Home. An ordinary Health scanner closes in Health.

## Private values a phone build needs

None of these is in the repo. All go in the private tokens file.

| Where | Name | What |
|---|---|---|
| `placeholders:` | `phone_start_url` | The household site's full https URL as the phone reaches it. `webview.startUrl`; the backend's origin is taken from it |
| `placeholders:` | `phone_link_host` | The site's host name only (lower case, no scheme, port or path). Used for the https link filter (`appLinks.host`) and for `links.origins` |
| `placeholders:` | `phone_user` | The household user the phone acts for: 1 to 64 letters, digits, `.`, `_` or `-`. `identity.user`. A quick input's upload sends it, and sends nothing without it |

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
| `daylight://open?path=/media[#k=<key>]` | Open that page of the site in the app | no, when the path is exactly a configured bookmark's; yes for any other page |
| `daylight://bookmark/<id>` | Open a configured bookmark | no |
| `daylight://action/<id>#k=<key>` | Run a one-tap action | yes |
| `daylight://input/voice?to=<destination id>#k=<key>` | Open the recorder or resume the active recording | yes |
| `daylight://input/text?to=<destination id>#k=<key>` | Open the text screen for that destination | yes |
| `daylight://input/photo?to=<destination id>#k=<key>` | Open the meal camera (or, if the camera permission is refused, the phone's camera app and the destination's private photo review) | yes |
| `daylight://input/status#k=<key>` | Open Capture status | yes |
| `daylight://input/queue#k=<key>` | Try every waiting and parked input again, and say how many there are | yes |
| `daylight://input/discard#k=<key>` | Throw away the inputs that could not be sent. Asks first; a second tap within twenty seconds deletes | yes |
| `daylight://memo/new#k=<key>`, `memo/queue`, `memo/discard` | The earlier names of `input/voice?to=journal`, `input/queue` and `input/discard` | yes |
| `daylight://media/play?id=<contentId>#k=<key>` | Play that household item natively | yes |
| `https://<the site>/<path>` | The same as `daylight://open` for that path, without a key | no key can be given; only a bookmarked path opens |

The rule: a link kind needs the install key unless all it does is show a page of
the site. `open`, `bookmark` and an https link show a page; `action`, `input`,
`memo` and `media` do something else (run an action, record, open the camera, send
what is typed, start playback) and are refused with `403` without the key. A test
fails a kind that is in neither list.

An `input` link names a destination by its id (`to=`), and the id must be one of
the configured destinations and take the link's kind; anything else is refused
with `400` and nothing opens. A link can never name a route or an address.

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
3. **The link key.** A link that changes something (`action`, `input`, `memo`, `media`)
   must carry `#k=<key>`: the key is the link's fragment and nothing else is
   read as one. The app's own surfaces add it. It is never returned by a route,
   shown by `GET /settings` or written to a log. See "The link key" below.
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

### The link key

32 hex characters, made on the phone and kept in the app's private storage
(`files/payloads/state/link-key`).

- **It travels in the fragment.** When Android starts a link it writes a line to
  the system log, `START ... dat=daylight://action/<id>?...`, with the scheme,
  path and query of a `daylight://` link and without its fragment. A key in the
  query would be in that log; a key in the fragment is not. A `k` in the query
  is not a key and is refused where one is needed.
- **It is replaced at every payload start.** `notifications` starts before the
  capabilities that build links, and each of them builds its links again at
  start: the launcher shortcuts and the tile cache (`one-tap-actions`), the
  widget (`widgets`), and the quick-input notices when they are next posted. A link
  seen once, in a log or over a shoulder, stops working at the next start.
- **The key before is honoured for one minute after a start.** A cold start is
  caused by a tap on a tile, a shortcut or the widget, and that tap carries the
  key of the run before, which is the only key those surfaces had. After the
  minute it is refused.
- **Pinned shortcuts.** The launcher keeps a pinned shortcut's intent, key
  included. A shortcut pinned by `POST /actions/pin` has an id of its own
  (`pin-<action id>`). At each start and each publish, every pinned shortcut is
  found by its shortcut id and rewritten with a link under the key in force
  (`ShortcutManager.updateShortcuts`); one whose action no longer exists is
  disabled. So the key in the launcher is never older than the run the app is
  in, and a pinned shortcut keeps working across rotations. Android does not
  tell an activity which shortcut started it, so the shortcut id alone cannot
  stand in for a key in the intent: any app could send the same id.
- A notice that was posted before a restart carries the key of that run. The
  input queue posts its notice again after a start when there is still something
  to say; a tap on an older one is refused with "That link has expired. Try it again from the app.".

Nothing logs a link: the link activity logs that an intent was ignored or that
the payload failed, by class name; a refusal logs one of a few fixed sentences;
the tile logs its slot number.

Unproven on a phone: that the launcher accepts `updateShortcuts` for pinned
shortcuts at the rate of once per start, and that the system log line leaves the
fragment out on the owner's Android version (check with
`adb logcat -d | grep 'dat=daylight'` after tapping a tile: no line may hold the
key).

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
activity is visible, so it is allowed to start the shell service. It keeps the link
and waits on the port (`links`, or `launcher-capture` for a capture shortcut) for as
long as the shell's loader gives a payload to start (shell-kit `PayloadReady`, see
"Waiting for the app to start" below), and runs the link the moment the payload
attaches. A tap still waiting after 300 ms shows a small card along the bottom,
"Starting up… · Lights off" (what was tapped, from `LinkLabel`), with
**Cancel**; Back cancels too, and a cancelled link is never sent. Warm, nothing is
shown before the answer. Only when the loader gave up does it say "Could not
start. Close the app and open it again.", and only when the whole start deadline passed
with no payload, "Still starting up. Try again in a moment." A request that
was handed to the payload is never sent twice; a link activity recreated by a
rotation does not run the link a second time.

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

The phone has two, Media and Call. Feed was removed at the owner's word: its
bookmark, its action and its place among the shortcuts and widget buttons.

## `one-tap-actions`

An action is defined once, as a settings line, and shown four ways. Settings
`actions.1` to `actions.16`, each `id|label|icon|target`; the label is at most 25
characters.

| Target | Does |
|---|---|
| `open:/path` | Opens that page of the site in the app |
| `bookmark:<id>` | Opens a bookmark |
| `input:<kind>:<destination id>` | A quick input: `input:voice:journal` opens the recorder (another tap shows the current draft), `input:text:journal-note` opens the text screen, `input:photo:meal-photo` opens the camera. In a build with no `quick-input` it is a stand-in that opens the app at `actions.memoFallbackPath` and `GET /actions` marks it `placeholder: true`. A per-device test fails a phone build where that is so, or where an action names a destination that is not configured or does not take its kind |
| `memo:new` | The earlier name of `input:voice:journal`. Still accepted |
| `media:<contentId>` | Plays that household item natively (`media-service`) |
| `player:[target]` | Opens Now playing (`media-service`): `player:` on the last target it showed, `player:local` on this phone, `player:<device id>` as the remote for that screen (`player:office-tv`). The phone's `actions.14` is `now-playing\|Now playing\|play\|player:` |
| `api:/api/...` | Sends an empty `POST` to that backend path and shows the outcome |
| `location:share` | A placeholder. A tap shows "Location sharing is not built yet" and does nothing else; `GET /actions` marks it `placeholder: true`. See "On my way" below |

Long-press Daylight for four shortcuts. **Journal voice** and **Meal voice** open
the recorder for their respective destinations. **Meal photo** opens the camera.
**Journal text** opens the keyboard. The four Quick Settings tiles use the same
actions. The four-button widget initially shows Journal voice, Meal voice, Meal
photo and Media. Meal text is also available for a configurable button.

An action exists as a settings line, or as a pinned media action (up to 24, made
at the owner's media page through the page bridge's `pinMedia` and Android's pin
dialog; see "Page bridge on the phone: pinning media"). Running one takes its id
and nothing else: no part of a link, an intent or a request body reaches an `api:`
action's method, path or body. The page bridge has no call that writes a setting,
and the only action a page can add is a pinned one that plays a content id. With no control API on the phone, changing
one means changing `devices/phone.yml` and installing the new build.

An `api:` action is not queued. With the VPN down it answers "no connection" and
nothing is sent later. A backend that takes more than eight seconds gets "sent, no
answer yet"; the request is left to finish. Each run is written to the shell log
as the action's id and its outcome.

| Setting | Meaning |
|---|---|
| `actions.shortcuts` | Ids of the launcher shortcuts, in order. Empty: the first actions |
| `actions.tiles` | Ids by quick-settings slot; an empty entry leaves a slot unassigned (`journal,,lights`) |
| `actions.memoFallbackPath` | The page a memo or input action opens in a build without `quick-input` |

| Method | Route | Answer |
|---|---|---|
| GET | `/actions` | `{actions: [{id, label, icon, kind, target, placeholder?}], problems: [...]}`. No links: a link carries the install key |
| POST | `/actions/run` `{id}` | The action's effect |
| POST | `/actions/publish` | Rebuilds the shortcuts and the tile cache: `{shortcuts, tiles, problems}`. Call it after changing `actions.*` |
| POST | `/actions/pin` `{id}` | Asks the launcher to pin one action; 501 with the reason when it cannot |

### "On my way" (a placeholder)

`actions.8: "omw|On my way|bolt|location:share"`. The owner asked for the slot
now and the feature later. The action is listed everywhere an action can be placed
(the action list, the long-press and tile lists if its id is added to them, the
one-action button's chooser, and the car list), and a tap answers "Location
sharing is not built yet" and nothing more: no permission is declared for it, no
request is sent, nothing is written. It is keyed like every action link. It is on
no launcher shortcut, tile or four-button widget by default; the car list has it
(see `car-actions`).

What the real feature needs, none of which is built: a location permission (fine
location, and the foreground-service location type for sharing that runs while the
phone is in a pocket), a foreground service that shares for a fixed time and then
stops on its own, a backend endpoint that takes the position and decides who sees
it, and a decision about who that is. Each of those changes the phone's exact
permission list, which is why none of it is declared for a button that does
nothing.

### The surfaces

| Surface | Installed code | With no payload loaded |
|---|---|---|
| Launcher shortcuts (long-press) | None: the payload publishes them and the launcher holds them | They stay in the launcher and launch the link activity |
| Pinned shortcuts | None | The same |
| Quick-settings tiles | Four slots, "Action 1" to "Action 4" until assigned | A slot draws its last label from the surface cache; an unassigned slot is shown unavailable |
| Home-screen widgets (four buttons; one-action buttons) | See `widgets` | Draw from the cache |

A tile on a locked phone asks for the unlock before it launches its action. The
tiles and the widgets never call the payload: they read the surface cache (a
private preferences file the payload writes) and launch a link. A cached value that
is not a `daylight://` link is treated as an unassigned slot. The one exception is a
`media:` action, which a widget button and a tile start through the play service
with no window (see "Playing with no window" under `media-service`).

Never a dead tap (audit): a tile with no action says "No action is set for this tile",
and a launch Android refuses says "Could not open <label>. Open the app and try it from
there". A tile, shortcut or widget still showing an action the list no longer has says
"This action was removed from the phone's list. Its tile or shortcut now shows it is
unavailable", and the payload publishes every surface again on the spot (the removed
action's pinned shortcut is disabled, its tile drawn unavailable, the widget redrawn).
`POST /actions/run` with an unknown id is still a 400.

An `api:` action's outcome outlives its toast: one notification per action (the
`general` channel, id `action-<id>`) says "Lights off: done", or the failure ("Lights
off: no connection", "failed (500)") with **Retry**, which runs the action's keyed link
again. An answer slower than the tap's wait (`apiWaitMs`) is waited for up to a minute
more and then posted the same way, instead of being dropped after "sent, no answer yet".

Unproven on a phone: whether `requestPinShortcut` works with no activity in
front, the tile's launch on Android 14 and later (the code uses the
`PendingIntent` overload by reflection there), and how the launcher rate-limits
publishing.

## `widgets`

New phone placements use the one-cell **Daylight playlist** widget. Legacy
action assignments continue to draw and launch from the surface cache.
A playlist tap uses the native play service and keeps the launcher visible.
The widget provider validates widget ownership before recording an assignment.
It preserves an existing assignment when a late placement callback arrives.

The [phone experience guide](../../../_extensions/daylight-android/PHONE-EXPERIENCE.md)
covers the playlist visual states, the Apex chooser, and the distinction between
staging and placement.

| Method | Route | Answer |
|---|---|---|
| GET | `/widgets` | `{slots: [{id, label}], problems: [...]}` |
| POST | `/widgets/refresh` | Writes the slots and actions, and asks the widgets to redraw |

## `media-service`

Native audio playback of household media: lock-screen and headset controls, a media
notification, and browsing from a car. Audio only. A video item is not played
natively and answers "Could not start playback"; it plays in the web view.

### Who does what

| Piece | Installed (shell half) | Payload | With no payload loaded |
|---|---|---|---|
| `DaylightMediaService`, a Media3 `MediaLibraryService` | The ExoPlayer, the session, audio focus, "headphones unplugged", the media notification and the foreground state (type `mediaPlayback`) | What a browse level holds, which stream a media id resolves to, when progress is reported | Starts the shell service, which loads the payload. A browse of the root waits up to 4 s and then answers one tab, "Starting up…", with nothing under it; browsers of the root are told to ask again when a payload attaches (within two minutes). A play request fails. Nothing crashes and nothing runs on the main thread |
| `PlayActivity` (not exported, no window) | Kept for a payload older than shell 134: opens Now playing with the id (Starting, "play it") and finishes at once. Nothing waits in it and nothing sits over Now playing | A current payload opens Now playing directly on a keyed `media` link (shell 134 and later, read from the installed version code; an older shell still gets `PlayActivity`) | Not reached: the link activity already waited for the payload |
| `PlayActionService` (not exported, foreground service of type `mediaPlayback`) | Started by a widget button or a tile with one action id. Enters the foreground at once with a notice naming what starts ("Starting Morning Mix…": the widget's playlist by its saved name, an action by its label, else "Starting playback"), asks the payload for the action's media id, plays it through a media controller, and lets go once the media service holds the foreground state. One budget for the whole start (`PlayBudget`: 24 s warm, plus the loader's own wait when the payload was not up at the tap); each step waits only what is left of it | Answers `action` with the media id of a configured or pinned media action (and its label as `title`), or 404 | Starts the shell service and waits within the same budget; with no payload it says "Could not start <name>: still starting up. Tap the button again to retry.", and the cause on other failures ("offline", "home isn't answering", "home does not have it", "it took too long"; `PlayStart.failure(title, Why)`). A playlist widget sends its own label (`DirectPlayIntents.EXTRA_PLAYLIST_TITLE`), so the notice and the failure name it. The toast is not shown while Now playing is on screen showing a start |

The installed service asks the payload through the `media` `PayloadPort`, in
process, as JSON: `browse`, `resolve`, `event`, and, from the play service,
`action`, and the three screen-remote ops below. It hands back media ids and nothing
else. The same three are routes (`GET /media/browse`, `POST /media/resolve`,
`POST /media/event`) and `GET /media/status` gives `{lastReportAtMs, lastError,
reports, problems}`; on the phone nothing serves them to anyone.

### Now playing and the screen remote

One player screen for this phone's own playback and for a screen's session (the
living-room TV, the office). The strip at the top picks the target: **This phone**,
then every screen in the household registry with content control or `fleet: true`
(the web fleet's rule). The rest of the screen is the same either way, because both
targets are Media3 sessions behind one `MediaController`:

| Piece | Installed (shell half) | Payload |
|---|---|---|
| `NowPlayingActivity` (not exported) | Laid out after Plexamp (ops:docs/superpowers/specs/2026-11-26-phone-player-parity-design.md). Top: close, the target (its icon and name, ▾ opens **Play on** with the current one checked) and, for a screen, the D-pad. The **stage** holds the cover (square, or 16:9 for a video still; swipe it left for next, right for previous, with a haptic tick), or the **lyrics** or the **queue** in its place (Back returns to the cover). Under it the **seek bar is the track's loudness** (Plex's analysis, as bars; a plain line when there is none), elapsed on the left and remaining on the right (tap: the length; remembered). Then artist, title (bold) and album (year), centred, and the audio quality ("FLAC · 24-bit · 96 kHz", "MP3 · 256 kbps · 44.1 kHz") when the backend knows it. One transport row: previous, play/pause in a disc of the cover's color, next; an item of 20 minutes or more adds back 10 / forward 10 at its ends. One icon row: queue, lyrics (enabled only when the track has lyrics), shuffle, ⋮ (the item sheet: Sleep timer, Progress bar for a book with chapters, Keep on this phone or its state, Crossfade on this phone, Stop; then Clear queue and Remove from this phone; the queue itself is in sections, see **The queue** below), repeat, output (opens **Play on**). A long item (a book, a talk, a course: `MediaKind.controls`) shows speed in shuffle's place and no repeat, lyrics or crossfade. The seek bar of an item of 10 minutes or more shows a time scale while it is touched (see **The seek bar's time scale**). The page takes its colors from the cover (`CoverColor`, `DaylightTheme.withAccent`) over a soft copy of it. With a screen as the target the volume keys set the screen's volume and show the level for a moment. The status line shows only when something is wrong, or a sleep timer is set. A control is enabled only when the target's player makes its command available. It opens as a sheet rising from the bottom, and the down chevron or Back drops it. **Play on** (the bottom sheet described under **Lookup and browse**) says what each player is doing (Off, Nothing playing, the title); off players are folded under **Off · N** and can't be picked. A screen with nothing on it shows **Play something on <screen>** in the stage: Continue listening and your playlists, one tap starting it there (the payload's `screen-command` `load`, i.e. `GET /api/v1/device/<id>/load?play|queue=…&deferredRetry=0`, as the web's Play on), and Browse on the screen through the D-pad. An off screen offers this phone or another screen instead. **Chapters** (a long item whose chapters the backend or the kept copy knows): a line under the album (with the bar on the chapter, "Canto 7 of 33 · 2 h 46 left in book"; on the whole book "Chapter 4 of 12 · 9 min left in chapter", or "4/12 · The Return · 9 min left" for a named one; time left at the play speed; the line is reserved blank for any long item so nothing jumps, and a tap opens the list), the seek bar on the current chapter or, by choice, the whole book with chapter notches only when they are 24 dp apart (see **The seek bar's time scale**; numbered in the press-and-hold zoom), Next / Previous by chapter (Previous restarts the chapter when more than 3 s in), the queue's place shows **Chapters · N** for a single-file book (number, name, length; a tap goes there), the sleep timer offers **End of chapter** (pauses at that chapter's end, fading over its last minute), and the session subtitle names the chapter (notification, lock screen, Android Auto). No chapters means none of this shows | Opens it on a `media/now-playing?target=` link (a `player:` action); `track-levels`, `track-lyrics` and `track-chapters` read `GET /api/v1/track/levels/<source>/<id>?samples=N`, `GET /api/v1/track/lyrics/<source>/<id>` and `GET /api/v1/track/chapters/<source>/<id>` (chapters: without home, the ones kept with the track, then the ones seen this session) (none, or an older backend's 404, is "none": the strip is a line and the button is off) |
| `RemoteControlService`, a Media3 `MediaSessionService` (not exported, session id `screen-remote`) | A second session beside `DaylightMediaService`, holding a `ScreenPlayer`. Its notification and lock-screen card drive the screen; it reports remote playback (0–100), so the phone's volume keys set the screen's volume while it is the active session | — |
| `ScreenPlayer`, a `SimpleBasePlayer` | The screen's snapshot as a Media3 player: its queue by `queueItemId`, its position carried forward while it plays. Every call becomes one command (`ScreenCommands`); its future completes after the session is read again, so the controls settle on what the screen did | `screens`, `screen-session`, `screen-command` (`ScreenRemote`): `GET /api/v1/device/config`, `GET /api/v1/device/<id>/session`, and the transport, queue, shuffle, repeat and volume routes of `__docs/reference/media/media-app-technical.md` §4 |

### The play path

Every handoff carries what the sender knows; loading is drawn as the thing itself; the
first useful answer wins (budgets on the phone: picture under 100 ms, sound under 1 s
from the phone, under 2 s from home).

- **Starting through Now playing.** The Play tab's Continue cards, kept cards and
  playlist tiles, Now playing's own idle panel, a `media/play` link and Play on… open
  Now playing with the tapped item's Starting extras and `starting.play`; Now playing
  sets the item on its own controller once it connects, once per intent (a rotation, a
  recreation after the process was stopped or a reopen from Recents does not play it
  again). No second screen sits over it, so Back works at once. Browse's Play and
  Shuffle still start on Browse's controller and open Now playing with the same extras.
- **One budget** (`PlayBudget`): the resolve (8 s, a 2 s pause, 8 s again) plus 6 s for
  the first audio, 24 s; a start made while the payload was still coming up adds the
  loader's own wait (`PayloadStart.WAIT_MS`). Now playing's Starting state, the widget
  and tile play service and a media link all use it; a refusal or a player error ends
  a start before it. A start on a screen has one number for the screen command's wait
  and the Starting give-up (30 s); a late accept takes back a failure already shown.
- **The first frame** (`FirstFrame`). Opened from the mini player, the Play tab's Now
  playing row, a notification or a Connect row, Now playing draws the mini player's
  entry for that target (title, artist, cover from memory, the place and whether it
  plays, carried forward) before its controller connects, with "Connecting…". The mini
  strip and the Play row pass the target and its name, so a raw device id is never
  shown. When the player goes away the last frame stays, greyed, with "Reconnecting…",
  instead of "Nothing playing". The seed is that target's own entry
  (`NowPlayingNote.forTarget`), never whichever entry is newer: a notification tap for this
  phone draws this phone's item even while a screen's entry is newer.
- **Laid out once.** The Starting frame lays out exactly as the playing frame: the
  waveform row is there (flat, off), the album and quality lines keep their place, the
  chapter line is reserved only for a long item (a book or a talk, said by the tapping
  screen with `starting.long`), and the cover box is the same size, so nothing moves
  when the track lands.
- **Switching to a screen.** The picker reads each screen's session as it opens; that
  answer goes with the pick into Now playing and the remote (`ScreenPlayer` starts from
  it, greyed and with no commands, "Checking <screen>…", until its own first read).
  Each screen's last answer is kept on the phone with its time (`ScreenMemory`, 30
  minutes), from the picker's checks and the remote's own reads, so a screen opened
  later starts from it too.
- **Play on…** opens at once from the cached screens list, every screen row
  "Checking…" and refreshed in place, all checked at the same time; the list itself is
  refreshed behind it. A tap on a row still being checked says "Checking… plays here
  when it answers" and picks it when the answer comes, or greys it if the screen is
  off (`PickRow`). With no cached list, the picker opens with this phone and "Looking
  for screens…".
- **A first tap on a list** (`FirstTap`). A track tapped on an album or playlist page
  asks for the track alone and for the whole list at the same time. A music track
  (one item under 20 minutes, no saved place) plays as soon as it is answered, and the
  list's other tracks are put before and after it when the list arrives: it stays
  current and does not restart. A cached list (QueueCache) answers first and plays
  whole. A book's part, a talk or anything with a place waits for the list, so its
  place comes from home. Logcat: `first tap: the track alone in N ms`, `first tap: the
  list in N ms -> SPLICE`.
- **Detail** (waveform and quality, chapters, lyrics) is asked at the same time on
  three threads, each dropped before it is sent when the track has changed; a song
  under 20 minutes is not asked for chapters. The lyrics stay up across a track change
  with "Loading lyrics…" and go back to the cover only when the new track has none.
- **Ahead of the next track** the phone's service asks for its loudness level and
  loads its cover into memory, so a new track starts at its own level and its cover
  draws at once. A track whose level is not known yet keeps the level playing until its
  answer comes. A swipe to skip slides in the next item's cover (from memory, or a
  plain box), never the old one.
- **Screen commands settle on the screen's answer** (`CommandSettle`). The command goes
  out on the commands thread and the reads that follow on the reads thread, so a second
  tap is not held behind them. The pressed button keeps its new state until a read
  shows it (play/pause, shuffle, repeat, volume) or 3 s pass; a skip or a seek settles
  on the first read.
- **Sleep timer.** The line counts down with the clock. "At the end of this" pauses at
  the end of the item through the player itself (`setPauseAtEndOfMediaItems`), before
  the next one makes a sound.
- **This phone, nothing loaded** shows a start panel like a screen's: Resume <what
  played last>, Continue listening, your playlists, and Play on a screen; one tap starts
  it here.
- **Shuffle** from a library page is asked of home with the request (`daylight.shuffle`
  on the request item); the queue that was playing is never shuffled first, and the
  player's own shuffle goes off in the same step as the new queue.
- **The car's now-playing card** still shows the previous item while a play resolves:
  Media3 1.1.1 keeps the session's state until `onSetMediaItems` answers, Android Auto's
  request carries only the media id, and ExoPlayer cannot hold an item with no stream to
  stand in for it.

### The queue

This phone's queue is in **regions**, always in this order: History (what played this
session, at most 100), Now playing, **Queued by you** (Play next and Add to queue only),
**Next from <source>** (the rest of the list you started: an album, a playlist, a book, a
search group) and, after the end, **Radio** (Keep playing). A book keeps its parts ahead
of your queued items, so queued music never plays inside a book. Spec:
`ops:docs/superpowers/specs/2026-11-26-phone-queue.md`.

| Part | Does |
|---|---|
| `QueueModel` (pure) | The regions on Media3's one flat timeline. Every edit is an add, a move or a remove on the player; only a new source and its Undo replace the list (the item playing changes anyway), so an edit never restarts playback |
| `QueueController` | In the media service: the model kept in step with the ExoPlayer (a change it did not make rebuilds the regions), the end of the queue, the offline skip, telemetry, and the saved copy |
| `QueuePlayer` | The session's player: a controller's `setMediaItems` is a new source, its adds, moves and removes go through the model, and shuffle and Repeat All are the queue's (announced to every controller; ExoPlayer's own shuffle stays off) |
| `QueueStage`, `QueueSnackbar`, `QueueVerbs` | Now playing → Queue (its row ⋮ and screen ⋮ are the shared `ItemSheet`: the row first, then Play next or Play again, Go to album, Go to artist, and Remove last; Save as playlist's name field sits in the same sheet), the one-line notice with Undo, and the verbs as Browse and Now playing call them (in process). Browse's Play next and Add to queue are the `MediaKind` row verbs, so a book's rows never have them |

- **Where each verb lands.** A tap on a row plays it, and the rest of that list follows
  ("Next from Snakes & Arrows", "Next from search: snakes"); tapping track 1 and pressing
  Play build the same queue. **Play next** goes to the end of the next block at the top of
  Queued by you, so three taps play in the order tapped; the block resets once one of them
  has played. **Add to queue** goes to the end of Queued by you, before the source (never
  behind a 900-track playlist). An added album is one group ("Snakes & Arrows · 13 tracks",
  opened with a tap). A book's menu has neither. **A new source** (any tap, Play, Shuffle,
  a shortcut, the car) replaces Now playing and the source; your queued stay.
- **Feedback.** One snackbar, drawn in the tap's frame, naming the place: "Plays next",
  "Added to the queue · 3rd", "Playing Snakes & Arrows · your 4 queued stay" (shown when
  Now playing opens). Each has Undo for 6 s; Undo of a new source puts the previous one
  back at its place (an Undo pressed before the new list arrived is applied when it does).
- **The queue screen** (Now playing → Queue): History collapsed ("History · 12", Show),
  Now playing, Queued by you with **Clear queued**, Next from <source>, Radio, and the end
  card. Drag the handle to reorder, within a section or between Queued by you and the
  source (a source row dropped in your section becomes yours); swipe left to remove, with
  Undo; ⋮ on a row: Play next, Go to album, Go to artist, Remove (a history row: Play
  again, Remove from history). A tap on an upcoming row plays it; a tap on a past row plays
  it again alone, the queue after it unchanged. The screen's ⋮: **Save as playlist** and
  **Clear all but now playing** (Undo). A book is one row ("Part 2 of 5 · 4 h 48 min
  left"). Kept rows carry the offline mark; offline, rows that need a connection are
  dimmed ("Needs a connection"). The list draws only the rows on screen, redraws in place
  as the player moves and keeps its scroll; Now playing scrolls into view only on opening.
  A screen's queue (the remote) shows Now playing and Up next, without regions.
- **Shuffle** reorders only the source; your queued are never shuffled, and shuffle stays
  available after you add. Off restores the source's order from the item playing. The
  order is kept, so the screen shows what really plays next. **Repeat**: Off → All (the
  source is queued again when it runs out; your queued play once) → One (ExoPlayer's);
  a manual skip turns One back to the mode before it. A book has neither.
- **The end card**: Then Stop, Keep playing similar (Driving Radio's continuation, only
  when today's Driving Radio is set; its rows are marked Radio and always behind your
  picks; a Clear never brings it back; a new source drops it) or Repeat. For a book: Stop,
  or "Then: your N queued"; with Stop a book pauses where your queued begin. The choice is
  remembered per kind (`daylight.queue` prefs, `end.music` / `end.spoken`); with none,
  books and talks stop, and music stops, or keeps playing while a car is connected (what
  Driving Radio did before). Ended: "Finished" with Play again.
- **Saved and restored.** Every change (and the place every 10 s while playing) is
  written to `files/queue/state.json`: every region, the source's label, id and order,
  shuffle, repeat and the place. When the media service starts it comes back paused at
  the place; it never plays by itself. Opening the app starts the media service when a saved
  queue exists (`ShellStart.wakeSavedQueue`), so the mini player shows it at once. **Stop** (the notification's ×, the sleep timer,
  Now playing's Stop) keeps the queue; only Clear removes it.
- **Offline.** An item that is neither on this phone nor reachable is skipped with a line
  ("Skipped 2 that need a connection"), never in a loop; with nothing left that plays,
  the player pauses and says so.
- **Play on a screen.** Picking a screen while this phone plays sends the screen the
  source (its list through `load?queue=`, else the item through `load?play=`) and pauses
  this phone with its queue as it was. The screen starts the list from its own start or
  saved place: the load route has no start item.
- **Save as playlist** makes a household list from Now playing, Queued by you and the
  source, in that order, named "Queue <date>" (renamable in the sheet): payload
  `save-playlist` → `POST /api/v1/media/household/playlists` `{title, items:[{id, title}]}`
  → a `menus` list (`content/lists/menus/<name>.yml`, fixed order; a name taken gets a
  number) answering `{ok, id: "menu:<name>", title, count}`. The new list is added to Your
  playlists.
- **Telemetry** (offline first, `UiTelemetry`, screen `Queue`, no titles): `queue.add`
  {verb: next|end, kind, count, position}, `queue.remove` {region}, `queue.move` {from,
  to}, `queue.clear` {scope}, `queue.undo` {verb}, `queue.replace` {kept}, `queue.shuffle`
  {on}, `queue.repeat` {mode}, `queue.end` {choice}, `queue.restore` {items, ms},
  `queue.save_playlist` {count}, `queue.handoff` {with}. Log tag `Daylight-Queue`.

### The screen remote

- **The screen owns its session.** The phone shows the screen's last answer and keeps
  only that answer (`ScreenMemory`), to start from when the screen is next chosen. A command the screen did not confirm (502) shows "Not
  confirmed by Office Screen" for 8 s; an off screen (503 or 409) "Office Screen is
  off" with its last item; a screen not heard from since the backend started (404)
  "… is not on"; no backend "Can't reach home". The newest screen note ("Paused by
  Phone") shows otherwise.
- **Attribution.** Commands carry `origin.name` from `media.remoteName` (default
  `Phone`), so the screen's notes name the phone.
- **Reading.** Every second while Now playing is on view, every 5 s while the screen
  plays, every 15 s otherwise; after 10 minutes of the screen not playing and nobody
  watching, it stops reading and stops itself. Choosing a screen also starts the
  service, so a paused screen keeps its notification after the app is closed. Swiping
  the app away stops the remote unless the screen is playing.
- **When reads fail** (VPN down, backend error, the payload still starting), the last
  answer stays on show, greyed and with nothing offered to send, and the line says why
  ("Can't reach home", "Starting up…", "Home could not answer for …"). After
  three failures and 20 s it gives way to the empty state; it recovers on its own at the
  next good answer. A 503 that is not a screen being off is a backend failure.
- **Commands** go one at a time, in tap order, on their own thread (the reads after them
  on the reads thread; see **The play path**). Of several play/pause
  or volume presses still waiting only the newest is sent; any command still waiting
  after 5 s is dropped ("Too slow to send; try again"). A command sent and not answered
  in time says "… did not answer in time; it may still happen" and is never re-sent.
  Queue jumps, removes and moves name the entry the person saw, by `queueItemId`.
- **Volume** is offered only when the screen reports one.
- **Now playing** reconnects on its own (1 s, doubling to 15 s) when it loses the
  player, retries a failed screen list when opened or when the picker opens, and keeps
  the chosen target across a rotation.
- **Thumbnails** become URLs on the backend's own origin in the payload; any other
  value is dropped.
- **Where it opens.** Setup's Play tab ("Now playing"), a `player:` action, and a tap
  on either media notification (the phone's own now opens Now playing on This phone,
  not the web view).
- **D-pad.** With a screen as the target, the pad button (top right, beside ⋮) swaps
  the player for a remote: up, down, left, right, OK and Back, for screen-framework
  screens (the FHE menu, Party Games / Charades, any menu). A direction repeats while
  held (400 ms, then every 150 ms); each press is a haptic tick. Presses go one at a
  time, in order, on their own thread; one still waiting after 2 s is dropped. Each is
  `POST /api/v1/device/<id>/input` and the screen acks delivery: a missed press says
  "<screen> did not respond", a server without the route "Home needs an update for
  this". The pad shows the screen's own state (off, not on, can't reach home) otherwise.
  Logcat: `remote input <action> [direction] -> <status>`.
- **Lyrics.** Synced lyrics follow the song: the line being sung is bold at a third of
  the height, the others dimmed; a tap on a line seeks there; after a scroll by hand
  the view waits 4 s before following again. Plain lyrics are text to scroll. They
  work the same with a screen as the target, so the phone follows what the living
  room sings.
- **Fine scrubbing.** On an item of 30 minutes or more, press and hold the seek bar
  (0.4 s, a haptic tick): it zooms to a window around the finger, a tenth of the length
  between 2 and 10 minutes (`FineScrub`), shown as a band with ticks at its ends; drag
  within it, the times beside it say where it lands, and release seeks there. A 5-hour
  book goes from about 15 s per pixel to about 2 s.
- **Resume** always seeks on the phone to the backend's resume position; a Plex stream's
  server-side `offset=` is dropped (it made the player's clock, and so every progress
  report, count from 0). A play request the backend did not answer (a restart) is tried
  once more after 2 s.
- **The position** drawn under the cover glides: between the player's reports it
  counts on, and a report less than a second off is absorbed over at least 400 ms
  instead of jumping (`PositionClock`). A seek is always sent from the player's own
  position.
- **Previous** restarts the item when more than 3 s in (or when nothing comes before),
  and otherwise goes back one: the same on this phone, in the car and on a screen
  (Media3 decides; `ScreenCommands` sends a restart as `seekAbs 0`).
- **Cover and lyrics.** When the track has lyrics a "Lyrics" badge sits on the cover's
  corner, and the lyrics icon in the bottom row is in full ink (faded when there are
  none). A tap on the cover, or on the badge, turns to the lyrics; in the lyrics a small
  cover in the corner turns back. The two cross-fade.
- **Long items** (talks, courses, books: from a household list, or 20 minutes or
  more) after the audiobookshelf app: the shuffle slot becomes the **speed** (the speed
  sheet, 0.5× to 3×); remaining time is counted at that speed; resuming after a pause steps back a
  little (under 10 s none, under a minute 3 s, under 5 minutes 10 s, under 30 minutes
  20 s, else 30 s). The speed is kept in the phone's session (`LongFormPolicy`, prefs
  `daylight.playback`), so the notification and the car follow it: remembered per
  collection (its household list, else its album) with the latest choice as the default
  for a new one, and **never applied to music**, whoever asks.
- **Loudness levelling.** Each track plays at its Plex loudness gain (the track
  levels route's `quality.gainDb`, from Plex's analysis): a loud master is turned down to
  meet the quiet ones, nothing is ever raised above full, so nothing clips. A track with
  no analysis plays at full volume. The sleep timer's fade multiplies with it.
- **Sleep timer** (⋮, this phone only): off, 15, 30, 45 or 60 minutes, or at the end
  of this item. It lives in the phone's media session (`SleepTimer`, custom command
  `net.kckern.daylight.media.SLEEP` with `minutes`, -1 for the end of the item), so it
  holds with Now playing closed; stopping playback or clearing the queue cancels it.
  A playback error does not (the player is left idle by an error too, and a lost
  connection that comes back keeps the timer).
  Over its last minute the volume fades to 10%, then it pauses and the volume returns.
- **Playback errors** (this phone's streamed items; `PlaybackRecovery`). Two causes, two
  answers. Home not reachable (connection failed or timed out, a 5xx, 401, 403, 408 or
  429): the player stays on the item at its position, Now playing's status line reads
  "Lost connection to home · will resume", and the item is prepared again after 2, 5, 10
  and 30 s, then every 30 s while the session lives; it plays on where it was if it was
  playing. The item itself will not play (a decode or format error, a 404 or 410 for it):
  the player skips to the next item, at most 3 in a row, then stops on the item with
  "This item won't play · 3 in a row didn't, so playback stopped"; one item that plays
  resets the count. A paused item or the last one is not skipped past ("This item won't
  play"). A kept item plays from the phone, so its errors are never read as a lost
  connection (a damaged kept file: see Keep, "Whole, or not ready"). Each error is logged
  as `player error <code> -> SKIP|HOLD|STOP`.
- **Crossfade between songs** (⋮ → Crossfade, this phone only; `CrossfadeEngine`, rules in
  `Crossfade`). Off, 2, 4, 6, 8 or 12 s; the person's choice is kept on the phone
  (`daylight.player` prefs) and wins over the household default `media.crossfadeSec` (4).
  Music only: never for long-form on either side (books, talks, courses: a track home calls
  resumable, `NodeItems.longFormKind`, or `CarControls.longForm`; `Crossfade.longForm`),
  never inside an album played in order (shuffle off and the next track from the same
  album title and artist: a plain gapless transition), never across a track shorter than
  twice the fade, never at the end of the queue or on repeat-one, never while a sleep
  timer is set, and never planned once playback is inside the last fade + 2.5 s (a seek
  into the end plays to the end). A manual skip is a 150 ms cut, never a fade; a skip
  during a fade ends it. How it runs: the session's ExoPlayer stays the one truth for the
  queue, notification, car and progress; a private **tail** ExoPlayer (no audio focus of
  its own) is prepared 15 s ahead with the outgoing song at the fade point, started there
  by a `PlayerMessage` on the main player while the main player moves to the next item
  silently, then the two ramp on an equal-power curve (cos/sin, 25 steps a second). Pause,
  a call, headphones unplugged, a seek, a skip, an error or a stop end the fade at once
  (the incoming song at full level, the tail released). The tail starts a little late on
  any device; that delay is learned from each fade (`crossfadeTailLeadMs`, 0–400 ms) and
  the copy is placed that much later so the outgoing music carries on without a gap. Both
  sides keep their loudness level and the sleep timer's fade. Now playing, the
  notification and the car show the incoming song from the start of the fade. The
  outgoing song is reported **finished** (position = its length). Kept songs fade from the
  download cache. Logs: `crossfade: plan for …`, `crossfade: start …`, `crossfade: middle
  p=… out=… in=…`, `crossfade: done|ended early (…)`; telemetry `crossfade.done`,
  `crossfade.skipped{reason}`, `crossfade.ended_early{reason}`. Known limit: an audio
  duck during a fade lowers only the incoming song. Spec:
  ops:docs/superpowers/specs/2026-11-26-phone-crossfade.md.
- **The phone home's Play tab** is not a library to browse. **Continue listening**: home's
  one answer (payload op `continue` over `GET /api/v1/media/household/continue`, lookup
  spec §13): one row per book or series heard for at least the household's
  `continue.minListenedMin` (default 5), never one per part; the row is the book (Remove
  and Mark finished act on it) and resumes its current part. Its line is the author, the
  part and what is left in the book ("William Shakespeare · Part 2 of 5 · 1 h 30 min
  left"), with the part's progress bar; a tap resumes it here. A home older than the route
  is read the old way (`/recent`: audio, 20 minutes or more, 30 s in, under 97%). The tab
  asks again on every return, so a book marked finished or hidden leaves at once. **Your
  playlists**: the playlists already chosen for Drive, a widget or Driving Radio, as cover
  tiles; a tap plays one here. A long Plex track now resumes where it was left
  (`PlexAdapter`: video, or a track of 20 minutes or more, is `resumable`).
- **Remote control on the Connect tab.** One row per screen (anything in the screens list
  that is not `type: speaker`): a tap opens Now playing on that screen with the D-pad
  already shown (`NowPlayingActivity` extra `pad`), for the FHE menu, Charades or any
  menu when no remote is in reach. The list is drawn at once from the last answer
  (prefs `daylight.home`) and refreshed.
  A browser open as a screen (`/screen/adhoc?name=MacBook`, e.g. Charades on a laptop:
  `__docs/reference/core/screen-framework.md`, Ad-hoc screens) is listed too while it is
  open: the payload's `screens` op appends the household screen list's browser screens
  (`GET /api/v1/media/screens`) seen in the last 2 minutes or reported online, as
  `{id: "browser:<token>", name, type: "browser"}`; their session and D-pad go to the same
  device routes with the id's colon encoded.
- **No jumps on load.** Lines that may be empty (artist, album, quality, the status
  line) keep their space from the first draw; the status line is one line that shrinks
  its text to fit; the cover box is square from the start (a video's wide still is
  letterboxed in it); the Play tab draws Continue listening from its last answer and
  redraws only when the answer changed.
- **Mini player.** Along the bottom of the phone home while something plays here or on
  a screen this phone drives: a progress line on its top edge, the cover, title, artist
  and where, play/pause and next (they act on that player through `NowPlayingNote`), on
  a tint of the cover's color. A tap opens Now playing on that target.
- **Not here.** Adding to a screen's queue, countdowns, audio and subtitle tracks, and
  Put it back stay in the Media web app's Remote. Video still does not play natively
  on the phone.

| Setting | Default | Meaning |
|---|---|---|
| `media.remoteName` | `Phone` | How a screen's notes name this device (at most 80 characters) |

Logs: `adb logcat -s Daylight-Media` shows `remote screen <id>`, `remote command
<kind> <action> -> <status> <code>`, `remote resting`, `now playing target <id>`,
`now playing stage <art|lyrics|queue>`, `now playing detail: lyrics <none|synced|plain>`
and `sleep timer: …`.
No title or content id is logged.

### What a car's now-playing card shows

- **While a tapped item resolves**, the card shows it at once: its own title and cover,
  "Starting… · <artist>" under it, the old item paused (`QueuePlayer.showStarting`, from
  `LibraryCallback.onSetMediaItems`). The new queue replaces it; a refusal, or the play
  budget running out, clears it.
- **A browse page home does not answer** shows the last answer for that page (the last
  48 pages are kept in memory) rather than an error.

- **Text.** Title; the artist as both `artist` and the display subtitle (a car
  draws the subtitle, not the artist field), or the album when there is no artist;
  the album as the description. Cover art from the item's thumbnail.
- **Transport, by what is playing** (`CarControls`). *Long-form* is an item
  from a household list (talks, scripture, courses: it has a `listId`) or one at
  least 20 minutes long. Long-form shows back 10 seconds, play/pause, forward 10
  seconds, as Plex lays it out, with Next track and Stop in the overflow. Music
  shows previous, play/pause, next, with Stop in the overflow. The layout is set
  again whenever the long-form/music answer changes.
- **Why the session withholds skips for long-form.** Android Auto fills the slots
  beside play/pause with skip-to-previous/next when a session offers them, and
  only otherwise with the first two custom actions. Seek back/forward player
  commands alone are not drawn: on the legacy session a car reads they are
  `ACTION_REWIND`/`ACTION_FAST_FORWARD`. The step is 10 s (`SEEK_STEP_MS`). The
  phone's media notification follows the same layout.

### Steering-wheel buttons

The car decides what each wheel button does; no app can claim one. Source/mode,
volume, phone and the dashboard menu buttons stay with the car, and a seek
pressed while the car's own source is the radio seeks the tuner. What a car
forwards to the playing app is next/previous (usually seek up/down), sometimes
play/pause, and the voice button opens the Assistant (`play … on Daylight` reaches
this app's search).

A forwarded next/previous reaches the session player even while long-form
withholds the skip commands: Media3 1.1.1's legacy session falls back to
`seekToNextMediaItem`/`seekToPreviousMediaItem` and checks only the car's
connection commands. For long-form it becomes forward/back 10 seconds; for music
it skips the track. Each one is logged, so which wheel buttons arrive is read off
a drive:

```bash
adb logcat -d -s Daylight-Media | grep transport
# transport layout long-form
# transport next-item -> forward-10      (a wheel next during a talk)
# transport previous -> track            (a wheel previous during music)
```

Media3 is pinned to 1.1.1, the newest version whose libraries build with
compileSdk 33 and Android Gradle Plugin 7.4.2. A newer one needs a newer compileSdk
for every device.

### Resume, the rail and the Drive grid

- **Resume.** The shell declares Media3's `MediaButtonReceiver`, so a media button
  (a headset, a car, the system's resume card) starts the media service when it is
  not running. `onPlaybackResumption` then answers: Driving Radio for Android Auto
  when it is enabled, otherwise the last item played (`resume.*` in the
  `daylight_buttons` preferences, written each time playback starts; the id is a
  `p:` leaf id the payload resolves like any other). With nothing played yet the
  request is refused. Android Auto asks on connect when "Start music automatically"
  is on; the line `playback resumption asked by <package>` is in `Daylight-Media`.
  An item the backend remembers as finished comes back at its end and waits paused.
- **The rail.** With the service stopped Android Auto still lists Daylight and shows
  the card "Daylight / Tap to open", because the system keeps the receiver as the
  last media-button target. A `recent` root (`LibraryParams.isRecent`) answers the
  one last item.
- **Drive is a grid.** The root answers `CONTENT_STYLE_SUPPORTED`, and the Drive
  entry carries the grid hints for its children (`NodeItems`). Each tile is a staged
  playlist marked "Show on Drive": its title, a second line ("Playlist"), and its
  picture. Driving Radio leads with today's station as the title, "Driving Radio"
  as the second line, and today's playlist picture. The grid's tile size is Android
  Auto's and not the app's.
- **Pictures.** `staged_art.<id>` in the same preferences holds each playlist's
  https thumbnail. It is saved when a playlist is staged and when the library list
  is shown in the setup screen. A Drive browse with staged playlists missing a
  picture asks the payload (`playlistSources`, `playlists`) for them in the
  background, at most once every ten minutes; each saved picture changes the Drive
  level and the car asks again. The first Drive load on a fresh install shows
  placeholders until that finishes (about 40 seconds with 110 playlists).
- **Seen on the Desktop Head Unit** (build 80): resume on connect, the last-item
  fallback, the grid with pictures and second lines, the rail after the process was
  killed. Not seen: a real car, the grid's size on a larger screen, or a voice search
  accepted through the Google app. Its certificate is pinned in `media.controllerPins`
  (build 81); the digest comes from `apksigner verify --print-certs` on the installed
  Google app, and matches the `refused media controller` line it used to log.

### The backend inbox: auth, installs, Keep from the web

The phone collects its commands (Play on from the web, Keep on Phone) by long-polling
`GET /api/v1/device/<id>/commands`. Each poll, ack and keep report carries
`Authorization: Bearer <the control token this build holds>` (a backend still lets a
tokenless request in while the device's `content_control.allow_unauthenticated` is not
`false`) and names the install (`installId`, made once per install; `model`). A command
is addressed to one install, so the emulator or a reinstall polling as the same device
never takes the phone's commands. Keep and unkeep commands from the web are stored on the
backend until the phone acks them; the keep's title is `params.title`, its content
`params.contentId`. The phone sends its whole kept list with its free space and limit
(`POST /api/v1/device/<id>/keeps`, lifecycle states such as `checking`, `waiting-wifi`,
`downloading`, `partly-ready`, `ready`, `damaged`), and the web shows what it says.
Progress kept offline is sent with `observedAt` (when it was heard): a report older than
the stored last play never moves the place. Each Plex audio item in the play answer
(`GET /api/v1/play/plex/<id>`, top level) and the queue answer
(`GET /api/v1/queue/plex/<id>`, each `items[]` entry, top level) carries `fileVersion`,
`"<partId>:<updatedAt>"` from the part its stream resolves to
(`/library/parts/<partId>/<updatedAt>/file.*`), read from metadata already fetched (no
extra Plex call); it is absent when unknown. A kept track whose `fileVersion` changed at
home is a new file (lifecycle spec §3.5). Contract:
`__docs/reference/media/media-app-technical.md` §4.12.

### Choosing playlists on the phone

- **Drive is the one curated list.** A playlist is on Drive or it is not: "Add to Drive" and
  "Remove from Drive" are the buttons. A widget button and a day of Driving Radio choose from
  every playlist and never add one to Drive.
- **One picker everywhere.** A grid of covers with a search box, filter chips (All, On Drive,
  one per list source), a sort (A–Z, Recent, Source order), a count and an empty state. A
  playlist's title, cover and shuffle setting are kept on the phone so the car and the widgets
  draw it with no backend; that record is not something the owner manages. Playlists used by
  nothing are dropped when their last use is removed.
- **Widgets.** Apex cannot be asked to pin a widget, so there the sheet shows the real steps
  (hold an empty spot on Home, Widgets, Daylight playlist, choose the playlist) instead of an
  "Add widget" button. A launcher that can pin gets the button.
- **Home sections.** A bottom navigation bar (design sweep D2, `HomeSections`): **Play,
  Capture, Connect, Services**, each an icon and its name, Play first and the section a cold
  start opens on; the selected one is ink on a soft indicator, the others muted. There is no
  app header: the top bar holds the section's icon (24 dp, muted), its name and its actions
  (Play: Search). The mini player sits directly above the bar. A flick sideways moves to the
  neighbouring section in the bar's order. Services and Capture list what is already on the
  home screen first, then what is Available. A placement banner shows only when it needs an
  answer (confirm, failed, extra widget).
- **The Play section** (D4, D5, D9): Continue listening and On this phone are flat 72 dp
  rows (cover, title, by-line, a progress line under Continue's), no box around them;
  "On this phone" in a by-line is muted with the offline glyph, never the accent. Your
  playlists are tiles of just a cover and its name. A missing or loading cover is its kind's
  glyph on the tile colour (shell-kit `CoverGlyph`: book, album, playlist, person, track),
  here and on every Browse row and header. Covers are kept in a bounded disk cache in the
  app's cache folder (`PlaylistArtwork`, 48 MB, least recently used first: `DiskCovers`),
  so a cold start draws them from disk. Ordinary rows' glyphs and "›" are muted ink: the
  accent marks only the primary action, the selected state and progress.

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

### Playing with no window

A `media:<contentId>` action tapped on a widget button (either widget) or a tile
starts native playback without bringing the app to the front. Which path a tap
takes is decided in one pure class, `DirectPlay` (`shell-api`), and tested:

| Surface | Android 8 to 11 (API 26 to 30) | Android 12 and later (API 31 and up) |
|---|---|---|
| Widget button | Play service, no window | Play service, no window |
| Quick-settings tile | Play service, no window | Play service; when Android refuses the start, the keyed link (the link activity, then the invisible play screen) |
| Launcher shortcut, pinned shortcut | Keyed link and the invisible play screen | The same |
| Any non-media action, or a build without `media-service` | Keyed link | Keyed link |

How it is kept closed:

- The play service (`PlayActionService`) is not exported, so only this app's own
  immutable `PendingIntent`s and tiles reach it. Its intent carries one extra, an
  action id, and that is the only thing it reads. A string that is not the shape
  of an action id (`plex:1`, a URL, a link) is dropped.
- The service hands the action id to the payload (`media` port, op `action`). The
  payload looks the id up among the configured actions (and the pinned ones, see
  "Page bridge on the phone: pinning media") and answers with the media id of that
  action's content, after the content id rule; any other id answers 404 and nothing
  plays. The media service then resolves that id through the backend as it does for
  any controller. So a tap cannot name content, and nothing plays that the owner
  did not set up and the backend did not answer for.
- No key is involved: nothing outside the app can start the service. The surface
  cache holds, per slot and per action, a `direct` field that is the action's own
  id when it is a media action and empty otherwise; it never holds content.
- Only the action id is written to the log (`play action <id>`).

The service enters the foreground at once (Android stops a service started as a
foreground service that does not), with a low-importance "Starting playback"
notice. When the player starts, Media3 moves the media service itself into the
foreground; once it has, the play service stops. If Android refuses the media
service that start, Media3 1.1.1 catches the refusal itself and tells the
service's listener; the play service then keeps its own foreground state for as
long as the audio plays (`PlayStart`, tested). With no payload within eight
seconds, or a refused action, or a player error, it says "Could not start
playback" and stops; it gives up after fifteen seconds in all.

What each platform statement rests on:

| Statement | Source |
|---|---|
| From Android 12 an app that targets API 31 or higher cannot start a foreground service from the background except in listed cases, and gets `ForegroundServiceStartNotAllowedException` | Verified: Android's "Restrictions on starting a foreground service from the background" page, read 2026-11-17 |
| "The user performs an action on a UI element related to your app ... a bubble, notification, widget, or activity" is one of those cases | Verified: the same page |
| A quick-settings tile is not named among the cases | Verified: the same page (it lists none). Whether a tile tap gets the exemption anyway is unknown, hence the try and the fallback |
| Before Android 12 a foreground-service start from the background is allowed (`startForegroundService` was added in Android 8 for that) | From memory, not re-read |
| A launcher shortcut's intent starts an activity, never a service | From memory (`ShortcutInfo` takes activity intents) |
| A service started as a foreground service must call `startForeground` within a few seconds | From memory |
| Media3 1.1.1 catches the refusal of its own foreground start and calls `MediaSessionService.Listener.onForegroundServiceStartNotAllowedException` | Verified from the 1.1.1 bytecode on the build's classpath (`MediaSessionService.onUpdateNotificationInternal`) |
| Starting the shell service and Media3's own foreground start, made while the play service is already in the foreground, are allowed | Unverified. If not, a cold tap can find no payload (it says so), and a warm tap plays with the play service holding the foreground state |

Unproven on a phone: all of it, including whether the launcher sends a widget's
`getForegroundService` intent the way the documentation describes. The
acceptance runbook has the checks (D2).

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
| `GET /api/v1/content/query/search?text=&take=` | Voice search from a car | `items[]`: `id` (a content id, `<source>:<localId>`), `title`, `itemType` (`container` on a listable item), `mediaType`, `mediaUrl` (on a playable item), `metadata.type`, `subtitle`, `thumbnail`; `metadata.artist` is read when present (unverified that a source sets it). A 400 (validation), 501 (no query service) or 500 is a failure |
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
  that already carries `offset=` is not sought again by default. With an explicit
  controller position, the selected play response is requested with
  `resume=false` so Media3 can seek from the beginning of its stream.
- Progress follows the web player: at most one report every 10 seconds while
  playing and only past 10 seconds; one more when an item is paused, stopped or
  replaced, unless it was a skim (under 10 seconds and under 90 percent); one at
  each natural end at 100 percent with `naturalEnd: true`. The backend can also
  infer completion from ordinary progress using household rules. A report that
  fails is dropped and the next carries a later position.
- The phone's own progress spot on the backend needs a `phone` entry in the
  household's `devices.yml`. Without it reports are still saved, with no
  per-screen spot.

### Voice search in the car

Android Auto's voice button and "play ... on Daylight" reach the library session's
search callbacks. Only connected controllers can search, and every connection was
admitted by `ControllerPolicy` (see "Who may connect").

- `onSearch` hands the query to the payload (`media` port, op `search`) on the io
  executor, never the main thread, then tells the car how many results there are;
  `onGetSearchResult` asks again for the page the car wants (the payload keeps the
  answer for a minute) and slices it.
- Play-from-search: Media3 1.1.1 delivers it to `onSetMediaItems` as one item with
  an empty media id and the words in its request metadata's search query (read
  from the 1.1.1 bytecode: `MediaSessionLegacyStub.onPlayFromSearch`). The service
  asks the payload to search, takes the item the payload names as `best` (the first
  result; a container plays from its first item) and resolves it like any id. A
  search with no result fails the request.
- The payload cleans the query (control and format characters become spaces, runs
  of spaces collapse), cuts it to 200 characters and sends it as one URL-encoded
  parameter, `text`, never as a path. `take` is `media.pageSize`. An empty query
  answers the recent list.
- Results are mapped by the browse rules: a checked content id and a title, an
  image only as an https URL on the backend, at most `media.pageSize` entries. A
  container is browsable; an item is playable when it has a `mediaUrl` and its
  media type is not plainly something the player cannot play (video, image, photo,
  movie, episode, show, season, clip, a book). What plays is still the backend's
  answer to the play and queue routes for that id.
- The query is never written to a log or a note: the installed service logs
  "search, <n> characters, <m> results" and "play from search, <n> characters".
  The payload keeps it in memory for a minute as the key of the cached answer.

Read from the backend's code (`__capabilities/content-catalog/server/api/content.mjs`,
the router mounted at `/api/v1/content`; `ContentQueryService.search`; the `Item`,
`PlayableItem` and `ListableItem` entities), never called by the app. Not sent:
`mediaType` and `capability` (the route's `capability=playable` filter drops
containers, and `mediaType` is handed to the adapters, which may not support it).
**Unverified:** which `mediaType` values the household's sources give an audio
track (the code's comments mention `track`); whether every source's search answers
`itemType` on a playlist (a playlist without it is shown as a playable item when it
has a `mediaUrl`, and left out otherwise); and that the ids it returns are accepted
by the queue and play routes for every source (they are the same `source:localId`
ids the list routes give). The backend's own request log line records the query
text; that is the backend's log, not the phone's.

Unproven in a car: all of it, including whether Android Auto routes the voice
button to this app's search at all for a sideloaded app.

### Browsing

| Setting | Default | Meaning |
|---|---|---|
| `media.roots` | `Recent=recent;Browse=catalog` | The tabs: `Label=target;...`, at most four, a label at most 24 characters, a target `recent`, `continue`, `catalog` or a container's content id. The phone's are `Drive=drive:;Continue=continue;Recent=recent`: no folder browsing in the car. **Continue** lists home's Continue rows first, one per book (a tap resumes its part; "Part 2 of 5 · 4 h 53 min left · …") and then the lists this phone played lately (a playlist, an album, a household list, a station; a tap plays it again), kept on the phone in the payload state's `recent-lists.json`, at most 8, newest first |
| `media.recentLimit` | 30 | Entries of the recent tab (1 to 100) |
| `media.pageSize` | 50 | Entries of one level (10 to 200). A longer container ends with a browsable entry, "More (51 to 100 of 120)" |
| `media.controllerPins` | empty | The apps that may connect beside this app and the system: `package=sha256, ...` (see "Who may connect") |

A level is kept in memory for a minute and served from there; when the backend is
out of reach the last answer is served, however old; a level never loaded fails
(an empty shelf would read as an empty library). An image is given to a browser
only when it is an https URL on the backend; anything else is left out, in the
payload and again in the installed service.

### Waiting for the app to start

The phone's service starts on demand, so a tap may come while the payload is still
loading. The shell's loader (`PayloadLoader`) gives one payload's `start()` 20 s
(`PayloadStart.START_DEADLINE_MS`, in shell-api, read by both sides) and notes in
`PayloadStart` when no payload could be started. Every installed screen that needs the
payload waits through shell-kit `PayloadReady`:

- **Ready**: the port is attached (PayloadPort's own signal, so it answers the moment
  the payload attaches).
- **Still starting**: the wait (`PayloadStart.WAIT_MS`, the deadline plus 5 s) ran out
  with no failure: "Starting up…".
- **Failed**: the loader gave up (its reason goes to the log): "Could not start.
  Close the app and open it again."

Used by the link activity (above); the phone home (the tabs, Play and Connect draw at
once from the phone; only Services and Capture say "Loading…" or "Starting up…";
the bookmarks and actions are asked at the same time, and a load that could not run is
asked again on its own when the payload attaches, with no Try again to press); the
capture screens recreated after Android stopped the app (voice, text, photo: "Starting up…" while it starts, then up to 5 s for the account binding); Capture status;
and Share. The play path has one budget of its own on top of it,
`PlayBudget` (see **The play path** under `media-service`).

### When home does not answer: four lines

A slow home is not "offline". The payload says why a call to home failed (`reason`
on its answer: `timeout`, `home-error`, `unreachable`, `not-found`, `refused`;
media-service `FailureReason`), on failed answers and on the offline answers of
search and the library. The shell adds whether Android reports a validated network
and picks the words (shell-kit `FailureWords`):

| Cause | Line |
|---|---|
| No validated network | "Offline · showing what's on this phone" |
| Timeout, 5xx, home unreachable on a working network | "Home isn't answering" (with Retry; what was shown stays under it) |
| 404 | "Not found at home" |
| 401 / 403 | "Home refused this phone" |

Browse uses them for a level, the library, search ("Home isn't answering · searching
what's on this phone"), More and a book's progress line; Keep's preview and keep say
"Offline: it will be kept when home answers", "Home isn't answering: it will be kept
when it does", "This can't be kept: home does not have it" or "… home refused this
phone". An offline answer is never written into Browse's cache of home's answers.

### Covers, lists and threads

- **One cover cache.** Every cover decoded in the process goes into one memory cache
  (shell-kit `PlaylistArtwork`, an `LruCache` of an eighth of the app's memory, at most
  32 MB, keyed by URL and size step: `CoverCache`). Browse rows, the home's cards,
  tiles and mini player, On this phone and Now playing look it up on the main thread
  before posting work, so a cover one screen showed draws on the next in the same frame
  (Now playing draws a smaller copy at once and swaps in its full size). A cover that
  failed to load waits its backoff (a minute, doubling to a day) before it is fetched
  again, so offline does not cost a 4 s connect per cover on every draw.
- **Lists update in place.** On this phone (the Play tab's section and the Downloads
  screen) and a Browse level keep their rows by content id (shell-kit `KeyedRows`): an
  answer equal to what shows touches nothing, a changed row has its words, progress and
  buttons updated in its own view, and only rows that came or went are added or removed.
  A press in progress, the covers and the A–Z strip survive the refresh.
- **One thread per purpose.** Browse searches on their own thread (a search typed past
  while it waited is skipped), screen commands and the Play on list on another, levels
  and progress on a third. Keep's index, Remove, Pause and Resume run on a local thread
  that never waits on the network; previews, keeps, retries, the sync and saving covers
  run on the network one. A Remove made while a sync runs is not undone by it.
- **A page that is loading says so.** A Browse level with nothing cached draws its six
  placeholder rows with "Loading Paradise Lost…" ("Loading the library…"), and after 4 s
  "Home is slow to answer · still asking…", never a page of wordless boxes.
- **A book is counted whole.** The book page's progress line and its Mark finished read
  every part, home's further pages too while each page is full (`allPartIds`), not only
  the first 50 rows loaded.
- **Continue listening after Back.** Home's Continue answer can lag the report the phone
  just sent; the payload lays this phone's own last place for each part (its progress
  reports of the last 30 minutes, `HeardHere`) over home's rows, so Back from Now playing
  shows the time just heard, and a book whose last part this phone heard to its end is left
  out at once.
- **Smaller in-between states** (the audit's Low list):
  - Search keeps what was typed across a rotation.
  - The payload asks an author's books for both authors found at once, and answers the
    same search from its last answer for a minute (`LookupMemo`).
  - Play next or Add to queue with nothing queued plays it at once and says "Playing: …".
  - Back from Drive playlists puts the home back as it was (its page redrawn, not the
    whole home), and a Drive tile with no cover on disk fetches it and redraws.
  - Connect never shows a bare heading: "Looking for screens…" with nothing kept, "No
    screens to control" for an answer with none, "Couldn't reach home · showing the last
    list" over a kept list.
  - A refused start names its cause on Now playing ("Couldn't start Paradise Lost: home
    isn't answering · tap to try again"; the payload's code travels in
    `Starting.EXTRA_REFUSED_WHY`).
  - A media link to a kept collection opens Now playing with its title and cover.
  - A Browse load or search that met "Starting up…" runs again by itself once the
    payload attaches.
- **Services and Capture from the last answer.** A cold start draws the home's Services
  and Capture tabs from the last answers kept on the phone (`daylight.home` `pages`,
  `actions`) instead of "Loading…"; this run's answers replace them when the payload is up.

### Lookup and browse

Lookup, not discovery (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md):
anything the household has can be found in two taps; nothing is proposed. Audio only.
One screen, `BrowseActivity` (not exported), in three modes:

- **Search**: the box at the top of the Play tab. Results as you type (250 ms after the
  last key), grouped **Books · Talks and courses · Albums · Artists · Playlists ·
  Tracks**, five each with "N more". Tracks is music only: a book part is under Books and
  a lecture under Talks and courses. An author is in Books (with their books first), a
  speaker in Talks and courses; Artists is music artists. The last ten searches show under
  an empty box (kept on the phone; Clear recent searches). No home: the kept collections
  whose title holds every word, under "Offline · searching what's on this phone" or
  "Home isn't answering · searching what's on this phone". "&" and "and" are the same word
  everywhere a search compares titles: home's relevance filter (`RelevanceScoringService`
  `normalizeText`, which used to drop "&" and score "Snakes & Arrows" 0 for "snakes and
  arrows" although Plex returned it), Plex playlist titles (`PlexAdapter` `andFold`) and the
  phone's offline search (`Lookup.fold`).
- **Library** (Play tab → Browse library): every audio Plex library, then the household's
  list sources (Plex's audio playlists as **Playlists**, programs, watchlists, custom
  lists). Offline: what is kept, "Offline · showing what's on this phone" (or "Home
  isn't answering · …").
- **A level**: rows of a fixed 64 dp height, flat (no card behind them; covers carry
  their own 8 dp radius), the last answer drawn at once from the phone and updated in
  place row by row, fixed placeholders the first time; a long level ends in **More**,
  which appends the next 50 in place. A level of 40 rows or more gets an **A–Z** strip,
  letters in A–Z order whatever order the level comes in. A playlist is read through the
  list catalog (`a:0|<id>`), as the car reads it.

**Media kinds.** Every page, row, menu, search group and Now playing control is chosen
by the item's kind (`MediaKind`). The kind comes from home: each audio library's kind is
the household media config's `play_on_demand.library_kinds` (see
`__docs/reference/media/media-app-technical.md`), served by
`GET /api/v1/queue/catalog/audio-libraries?profile=audio-only`; the payload (`LibraryKinds`)
tags each entry with it. A home without that route (404) falls back to the old title rule
until it is updated, and the payload notes it. Kinds: **album, playlist, station, artist**
(music); **author, book, part** (books); **speaker, series, lecture** (talks and courses).
A station is a radio-station playlist sequenced at home (the audio-lists catalog marks it
`station: true`): it plays whole and lists no tracks.

A detail page's actions are one `ActionSet` per kind: one **primary** action, a 56 dp
filled circular button in the accent at the header's right edge ("Play <title>",
"Resume <title>"); at most four **secondary** 48 dp icon buttons under the header, muted,
no fill, each with a content description and a long-press tooltip; the rarer actions in
**⋮**. No pill buttons; the accent is only the primary button, selected states and
progress.

| Kind | Primary | Icons | ⋮ | Row tap | Row ⋮ |
|---|---|---|---|---|---|
| Album, playlist | Play | Shuffle · Play on · Keep | Add to Your playlists | plays from that track | Play next · Add to queue · Go to album · Go to artist |
| Station | Play | Play on · Keep | | (no rows) | |
| Music artist | Shuffle this artist | | | opens the album | |
| Author, speaker | "Continue <book>" when one is started, else none | | | opens the book | |
| Book | Resume | Play on · Keep · Speed · Chapters | Play from the start · Mark finished | plays from that part | Play from here · Mark finished up to here |
| Talk or course series | Resume (the next unfinished) | Play on · Keep | | plays that lecture | Mark watched · Mark unwatched |

Keep's icon shows its state: download (not kept), downloading (queued or downloading),
done in the accent (kept); kept, a tap opens On this phone. Chapters opens Now playing
on its chapter list (resuming the book first when it is not the one playing). Your
playlists is music only. Now playing on a book, a talk or a course (long-form) has no
shuffle, repeat, lyrics or crossfade; speed, chapters, ±30 s and sleep stay.

**Artist and author pages keep a ⋮** beside the primary (today it holds "Search for
<name>"; it is where collection-wide actions on a person go).

**One item sheet** (design sweep D17, shell-kit `ItemSheet` on `BottomSheet`) is every
long-press and ⋮ in the phone app; there is no PopupMenu. A modal bottom sheet with a scrim
and a drag handle, closed by a swipe down, a tap on the scrim or Back. It starts with the
item itself: its cover (or kind glyph), title, by-line and state ("Kept automatically ·
79 MB", "71 % · 1 h 16 min left"). Then rows with a 24 dp icon and a label (a second line
for a state), then, after a divider, the destructive rows in the error colour (Remove from
Continue listening, Remove from this phone, Clear queue): `SheetRows` orders them. The
verbs are the kind's (`MediaKind`). It serves the Continue long-press, the Play tab's
tiles and On this phone rows, a detail page's ⋮, a row's ⋮ and Now playing's ⋮.

**The speed sheet** (D19, `SpeedSheet`, arithmetic in `SpeedSteps`) is the one speed
control, on Now playing's speed button and a book page's Speed: a compact card over the
button (under it when the button is in the top half), under half the screen. The current
value large ("1.5×"); a slider from 0.5× to 3× in 0.05 steps between − and + (0.1 each),
with a haptic tick at each quarter; the presets 1× (with "Normal" under it), 1.25, 1.5, 1.75
and 2 as plain text, the current one in ink with a check; for a long item the footnote
"For this book · remembered". It applies as it moves, with no OK. The book page writes the
same memory Now playing's session uses ("speed:" + the book's key, and the long-form
default).

**Play on** (D18, `TargetPicker` on the same sheet): This phone; then **Available**, the
screens playing or paused first, then the idle ones, each with its device icon and what it
is doing; a row still being checked waits in Available ("Checking…") and moves to its place
when it answers, animated; then one collapsed **Off · N** row that opens in place to the off
screens (dimmed, not pickable). Off starts collapsed every time; the screen in use is never
filed under Off (`PickerGroups`).

**The author page is about the author.** The header is the portrait (info's
`thumbnail`, cached), the name, a facts line ("Italy · 1 book · 3 h": country when known ·
book count · total length; a music artist: "Iceland · Art Pop · 9 albums") and the
summary clamped to four lines with **More** (opens in place). The book count, each book's
length and progress, and which one to continue come from the `about` op: home's info and
the author's tracks (`/api/v1/list/<id>/allLeaves`: each track's book and length) with the
household's recent list. **A name is shown once**: on a detail page the top bar holds only
Back while the header is on screen; the name fades into the bar when the header's name
scrolls out of view.

**Row second lines never repeat the page** (`RowLine`): under an author the book's year
and, once started, what is left ("1998 · 2 h 10 min left"), or its length with no year;
under a music artist year and track count ("2007 · 13 tracks"); on an album the track's
length, with its artist only when it is not the album's; in search, lists and Continue the
author or artist stays. Year, length, track count and artist are home's (the payload
passes them with each row).

**Swipe through neighbours** (`Neighbours`). A detail page opened from a list pages left
and right through exactly that list in its order: an author page through the library's
authors, a book through its author's books, a search result through its search group.
Opened from Now playing's album line, the album pages through its artist's albums;
opened by a link, there is no paging. The header shows the neighbours ("‹ Dante · Thomas
More ›"; TalkBack hears Previous and Next buttons). Both neighbours' pages, their headers
and covers are fetched as a page opens, so a swipe lands on a drawn page. At an edge: a
rubber-band pull and "First book" / "Last book". Back returns to the list (one step),
scrolled to the entry shown. Detail pages have no other horizontal gesture.

Playing goes through the media session (the same media ids the car uses) and opens
Now playing. A second tap on the same Play or Shuffle within a second, or while the
player is still connecting, is dropped (shell-kit `TapGuard`), and taps while the
controller connects share its one connection. Every Now playing launch from Browse and
the phone home carries `SINGLE_TOP | CLEAR_TOP`, so an open Now playing takes the new
item rather than a second one opening; the home's cards use the same guard. Play on… is
Now playing's picker (`TargetPicker`).

Now playing's artist and album lines open that artist's or album's page, found from the
playing track's own `albumId`/`artistId` (`parents` op over `/api/v1/info`); only without
them does the line open the search on the name. A link
`daylight://media/<book|album|artist|playlist>/<content id>` (or
`daylight://media/open?kind=…&id=…`; through the link activity, with the install key)
opens a page. Long-press on a Play tab playlist tile opens its item sheet: **Open** (its page), Play on
this phone, Keep on this phone (or its state, and Remove from this phone).

A **book** page shows how far in it is ("2 h 10 min left · 34 %", Finished, Not started:
from the household's recent list) under its title; Speed is the book's remembered
long-form speed (the same key Now playing uses); Mark finished posts the web's
mark-watched for each part. There is no Favourites row: the household's favourites list
is empty.

**Continue listening's long-press** (the item sheet): Open (the book's page) · Keep on this phone (or its
state) · Mark finished · Remove from Continue listening. Remove takes the card away at
once with "Removed from Continue listening · Undo" (6 s). The hide is home's: the
household's removed list (`POST /api/v1/media/household/continue/hide {contentId}`,
Undo `DELETE …/continue/hide/<contentId>`), so it is gone from every device's Continue and
the web's, and comes back by itself when it is played again after the hide. Offline it is
applied on the phone at once and queued (`continue-hides.json` in the payload's state)
until home answers; the card does not reappear meanwhile. Mark finished marks every part
of the card's book (found from the part's info), removes it from Continue, starts the day
before an automatic keep of it is removed, and has Undo too.

**One mini player on every browse screen** (shell-kit `MiniPlayer`): the home's tabs,
Search, the Library and every level and detail page, On this phone. Not on Now playing nor
the capture screens. Each screen adds the same bar as the last child of its vertical
root, so its list ends above it. It shows the cover, title, the by-line ("On <screen>"
for a screen, "Starting…" while a tapped item starts after Now playing was closed, a
book's chapter while Now playing knows it), a progress line run by an animator to the
item's end, Play/Pause (flips at once; the player's report corrects it) and Next. Tap or
swipe up opens Now playing on that target, drawn from the same entry; swipe down hides it
on that screen until the next item (playback goes on). It reads `NowPlayingNote`, which
the two media services write: one connection to the player for the app, no polling. It
slides away when nothing is loaded and never says "Nothing playing".

| Payload op | Answers | Endpoint |
|---|---|---|
| `lookup` `{query}` | `{groups:[{key, title, items, more}], offline}` | `GET /api/v1/content/query/search` |
| `library` | `{items:[{id, title, kind}], offline}` | `GET /api/v1/queue/catalog/audio-libraries` (a home without it: `GET /api/v1/list/plex`), `GET /api/v1/queue/catalog/audio-sources` |
| `browse` `{parent}` | a level, as the car's, each row with `year`, `durationSec`, `trackCount`, `artist`, `kind` when home gives them | `GET /api/v1/list/…`, the audio-lists catalog |
| `about` `{id, books}` | `{about:{portrait, summary, countries, genres, styles, children, totalSec, books, continue}}` | `GET /api/v1/info/<id>`, `GET /api/v1/list/<id>/allLeaves`, `GET /api/v1/media/household/recent` |
| `parents` `{id}` | `{parents:{album?, artist?}}` with their kinds | `GET /api/v1/info/<id>` |
| `progress` `{ids}` | `{progress:{id:{playhead, duration, finished}}}` | `GET /api/v1/media/household/recent` |
| `mark-finished` `{ids, finished}` | `{marked}` | `POST /api/v1/media/household/watched` |
| `continue` `{limit}` | Continue listening (one row per book: `contentId` the book, `id` the play node of `playContentId`, `partIndex`/`partCount`, `remainingSec`, `legacy`) and `reviewCount`, without the phone's unsent hides | `GET /api/v1/media/household/continue` (an older home: `GET /api/v1/media/household/recent`) |
| `continue-review` | The older entries (no listened time) to keep or clear | `GET /api/v1/media/household/continue/review` |
| `continue-decide` `{contentId, decision: keep\|clear}` or `{all: true, decision: clear}` | One decision, or Clear all | `POST /api/v1/media/household/continue/review` |
| `continue-hide` `{contentId, hidden}` | `{hidden, sent}` | `POST`/`DELETE /api/v1/media/household/continue/hide` |
| `book-finished` `{contentId, finished}` | `{marked, book, parts}` | `GET /api/v1/info`, `GET /api/v1/list`, `POST …/watched`, the hide |

Telemetry: `browse.view` (kind), `search.query` (length, result count, offline: never
the words), `browse.action` (verb, kind), `browse.swipe` (kind, direction, edge),
`continue.hide`, `continue.unhide`, `continue.finished`, `mini.open`, `mini.toggle`,
`mini.dismiss` (screen), and a tag on every row and button.

### The seek bar's time scale

The seek bar carries labels only while a finger is on it (`TimeScale`, drawn by
`WaveformBar`; spec §12b). At rest (§12c) it has short, faint notches on the line by the
length of the span shown, in one row, with no dots and no labels: 6 h or more, one each
hour; 1 to 6 h, one each 30 min (the hours a little taller); 20 to 60 min, one each 10 min;
under 20 min, none.

**What the bar spans** (§12d, `BarScope`). An item with chapters shows **the current
chapter** by default: the bar spans it, the times either side are the chapter's elapsed and
remaining, and the line under the title reads "Canto 7 of 33 · 2 h 46 left in book" (the
chapters' own word when most titles share one, else "Chapter"; time left at the play
speed). Crossing into the next chapter moves the span on without a jump. Now playing's ⋮
**Progress bar** switches to **Whole book** (remembered on the phone): the bar spans the
file, a lighter band marks the current chapter, and chapter notches are drawn only when
every two are at least 24 dp apart (none at all otherwise: 33 cantos at phone width get
none, 6 chapters get theirs). Time notches follow the span shown, so a 10 min canto has
none. The press-and-hold zoom works in both.

- **Touched**: 2 to 4 labels at round points fade in above the bars, in words ("45 m",
  "1 h", "2 h 30"; never "1:00:00"), with one row of short ticks between the labels only.
  They fade out on release.
- **Press and hold** (the zoom, FineScrub's 2 to 10 minute window): clock labels ("1:42",
  "1:43"; "42:30" under an hour), the window's end times, a thin strip of the whole item
  with the window on it, and above the finger its time and its distance from where the
  press began ("1:42:30 · +0:30"); seconds appear only here. Each labelled mark the finger
  crosses gives a light tick (haptic `CLOCK_TICK`); released, the player seeks to the time
  shown.

One rule chooses the labels for the whole bar and the zoom: the smallest round step (10 s
up to 24 h) giving 2 to 4 labels at least three of their own widths apart; ticks divide it
into 4, 3, 5 or 2 round steps at least 12 dp apart, or there are none. Songs (under 10 min)
have no scale. A label that would touch a zoom chapter number, the window's ends or the
finger's readout is dropped, never moved; the marks crossfade when the span changes.

### Downloads: Keep on this phone

A whole collection (a book, an album, a playlist, a household list) can be kept on the
phone and played with no network (a book of up to four parts keeps each part's chapters
with it, so they show offline): on a plane, in the car out of coverage, on a Wi-Fi that
reaches nothing. The rule above everything else: **nothing kept is deleted unless the
person asks** (Remove, Remove finished, Remove all, Cancel, a kept list's own re-sync, or
uninstalling). No failure, update, rollback, full disk, missing card, server answer or
lowered limit deletes kept audio.

**States.** Each kept item has one state, the same words on every surface (the Play tab,
On this phone, Now playing's ⋮, the notification, the web through the inbox report). They
come from shell-kit's `KeptIndex` (`files/kept-index.json`), written by `KeepStore`:

| State | Words | Next |
|---|---|---|
| Checking | "Checking size…" (a row named by its title, never "Kept item") | fits: Queued; does not: Needs room |
| Needs room | "Needs 1.2 GB more room" (+ Manage space) | room freed: Queued; or Remove |
| Queued | "Queued" | Downloading |
| Waiting for Wi-Fi | "Waiting for Wi-Fi" (+ Use mobile data once) | Wi-Fi: Downloading, app closed too |
| Waiting for home | "Waiting for home" | home reachable: Checking |
| Waiting for storage | "Phone storage is full" (+ Manage space) | room: Downloading |
| Downloading | "Downloading 3 of 12 · 84 MB of 230 MB" | Ready, or a problem state |
| Paused | "Paused" (+ Resume) | Resume |
| Partly ready | "11 of 12 ready · 1 couldn't download: Gone from the library" (+ Retry) | Retry, or play what is there |
| Ready | "On this phone · 230 MB" ("Finished · 230 MB" for a finished book) | plays offline |
| Updating | "Updating: 2 new" | Ready |
| Removing | "Removing…" | gone, space shown |
| Not available | "On the SD card — not inserted" | card back: as before |
| Damaged | "1 track needs downloading again" | re-downloaded on an allowed network |

Failure reasons, one set everywhere: Gone from the library (404, permanent only after a
fresh URL also got one), Home refused it (401/403), Home had a problem (5xx, retried), Home
not reachable (network), Phone full, Incomplete file, Not allowed on mobile data, Card
removed.

- **Keep it.** Keep appears in Now playing's ⋮ (the collection playing: the household list
  it came from, or else the track's album), and on a long press of a Continue listening
  card or a playlist tile on the Play tab (not in the car, not on widgets). Every entry
  goes through one flow (`KeepFlow`): the payload's `keep` op in `preview` mode says what it
  is ("Keep the book · 14 parts", "Keep the album · 12 tracks", "Keep the playlist · 230
  tracks (updates when it changes)"; a book is a collection with a part of 20 minutes or
  more), the shell reads each missing track's size (a HEAD, only on an allowed network) and
  shows "1.2 GB · 13.8 GB left · on Wi-Fi". Above a quarter of the limit or of the free
  space, one confirmation; over the limit, "Needs 1.2 GB more room" with Manage space; with
  home out of reach, the keep waits ("Offline: it will be kept when home answers", or "Home
  isn't answering: it will be kept when it does") and is made when home answers.
- **The keep belongs to KeepStore, not the screen** (audit H12–H14). A tap starts a
  `KeepStore.Attempt` named by the item's title; the screen draws it inline at the bottom
  (`KeepBar`): "Checking size of Paradise Lost… · Cancel", then the outcome for six seconds
  ("Keeping Paradise Lost on this phone · 412 MB"). Leaving the screen removes the line,
  never the keep; only Cancel (offered while the size is checked) stops it. A choice that
  needs the person is asked on the screen while it is open; with the screen gone, a large
  keep is asked in a notification with Keep (`KeepService` `ACTION_KEEP`), and "Needs 1.2 GB
  more room", "This can't be kept: …" and waiting-for-home go to a notification
  (`KeepStore.notifyOutcome`), never only a toast. The Checking and Waiting for home rows
  carry the title (`title.<mediaId>`). The home's item sheets keep in place through
  `KeepEntry.keep` (called by name: widgets does not link media-service) instead of opening
  On this phone. The preview and the keep run on their own executor (`asks`), so a sync or
  retry on `io` never holds "Checking size of …".
- **Sizes are read once and never guessed.** The payload remembers what a preview resolved
  for ten minutes (`PreviewMemo`), so the keep that follows does not resolve the list again;
  the shell remembers each part's size for ten minutes (`sizeMemo`). A part whose size home
  does not give counts as unknown, never 0 B: "size unknown", or "at least 1.2 GB · 13.8 GB
  left" when some parts gave one (`KeepRules.needWords`/`roomWords`).
  A waiting keep is held on the phone by the media id it was asked with (`c:<list>`, or
  `p:<track>` for Now playing's album keep) and shown, and removed, by its content id
  (`KeepRules.pendingContentId`); Remove drops it even when home does not answer.
- **Kept from the web.** A `keep` command from the inbox (see "The phone's inbox" below)
  is recorded by the payload and then goes through the same rules on the phone: it is
  Checking until its size is known on an allowed network, then Queued or Needs room. The
  phone acks a keep once it is recorded, not when it finishes downloading; a repeated keep
  is harmless.
- **The audio.** Media3's download stack in the installed code (`KeepStore`, `KeepService`):
  one `SimpleCache` in `files/media-cache` ("Clear cache" never touches it), a
  `DownloadManager` on a `StandaloneDatabaseProvider`, at most two at a time, in play order
  (a partly kept book plays from its start). Every track is cached under its content id
  (`track:plex:123`), not its URL: any play path finds it, and a track two collections hold
  is stored once. The stream route `/api/v1/proxy/plex/stream/<id>` redirects to the file
  and serves ranges, so a broken download resumes from the byte it stopped at.
- **A file changed at home.** The backend's queue and play answers carry an optional
  `fileVersion` per track (`<partId>:<updatedAt>`). A kept track whose version changed is
  fetched under a new download key beside the old copy, which keeps playing
  (`KeepStore.playKey`); the player moves to the new copy when it is whole, and the old one
  is deleted then (`keep.replaced`). A version seen for the first time on a track already
  kept is recorded, not fetched again; no field means no change.
- **Background restricted.** When Android restricts the app in the background (battery
  "Restricted"), downloads only run while it is open: a one-time "Allow background use"
  before a keep, and a standing line with the button on On this phone, open the app's
  settings page.
- **Running with the app closed.** `KeepService` runs in the foreground (`dataSync`) with one
  grouped notification, "Keeping 2 items · 3 of 26" ("Keeping <title> for offline" when only
  automatic keeps are moving), Pause and Cancel, a tap opens On this
  phone. Waiting downloads are scheduled by `KeepScheduler`, this app's own job
  (`KeepJob`, id 7206) with the network and storage constraints: not Media3's
  PlatformScheduler, whose job starts a foreground service from the background, which
  Android 12 and later refuse. The job runs the downloads in the app's process and starts
  the foreground service only where Android allows it. Every `KeepJob` starts the shell first
  and waits for the payload; without one it is rescheduled, not dropped. Its other jobs: sync
  now (7204, the payload schedules it on a web keep), a retry when a network comes (7207),
  daily re-sync on Wi-Fi (7205), a weekly check of every kept file (7209), an automatic
  keep's removal falling due (7212), automatic keeps waiting for Wi-Fi (7213), and screen actions
  (7300–7399, one id per action and item).
- **Never stuck.** A failed track is tried again after 1 min, 10 min, 1 h, then daily, each
  time with a fresh URL from the payload's `keep` op in `refresh` mode; a 404 gets one fresh
  URL at once and is permanent only if that fails too. Bytes that have not moved for 30
  minutes while allowed restart the download once (`keep.stalled`). Times are wall-clock but
  never trusted when they lie in the future (a clock set back); stalls are measured on the
  uptime clock.
- **Whole, or not ready.** A track is ready only when its length is known, every byte of it
  is cached and its first bytes are audio (ID3/MP3 frame, FLAC, Ogg, MP4, WAV, ADTS): a page
  or an error stored as a track is not. A failure from a full phone, a short file or a file
  that will not play is fetched again from scratch, never resumed onto. A kept track that
  fails to play (a parse or decode error) is marked Damaged and the player skips to the next
  part at once. The weekly check verifies every kept file and logs `keep.verify{ok, damaged}`.
- **Never lost.** The payload records each removal as a tombstone; the shell deletes audio
  only for tracks a tombstone released and nothing kept still holds (two keys). A kept-list
  file that cannot be read is moved to `kept/_bad/` and put back from the shell's mirror
  (`files/kept-mirror.json`); a payload whose list is empty while the mirror is not is given
  the mirror. A removed collection is never put back, and a re-sync never revives one
  removed meanwhile. A re-sync that would release more than half of a list in one pass keeps
  it all (`release_refused`).
- **Keeping it current.** Kept playlists and household lists are resolved again daily on
  Wi-Fi and when the Play tab opens online (at most hourly): new tracks are added under the
  same rules, tracks the list itself dropped are removed. Books and albums do not change. A
  changed file at home is not detected (the stream URL names the item, not its file).
- **Room.** On this phone shows "1.2 GB kept · 4.1 GB limit · 15.0 GB free on phone". The
  limit that applies is the smaller of `media.downloadCapMb` and the free space minus 2 GB.
  A limit lowered below what is kept deletes nothing: "Over the limit by 600 MB: new keeps
  wait until there is room".
- **On this phone** (`DownloadsActivity`): the room line, items largest first with size and
  state, and every action where it is shown (Retry, Resume, Pause, Use mobile data once,
  Remove), Remove finished, Remove all (confirmed with the total). It is the app's
  `android:manageSpaceActivity`: Android Settings → the app → Storage → **Manage space**
  opens it, so clearing storage is not the only way to free room. The Play tab shows the
  room line, the three largest kept items and **Manage downloads ›**.
- **Finished books.** A kept book whose last part home calls finished (marked finished, or
  heard to 97 %) shows "Finished". With `media.removeFinished` it is removed a day later
  with a notification "Removed <title> from this phone (finished)" and **Undo** for a day.
- **A kept item plays from the phone first, always** (online too): the payload answers
  from the kept collection at once, gives home half a second to say where the item was
  (taken when the phone has nothing unsent for it, as home then knows the newer place,
  heard on another screen), and otherwise keeps home's answer for the next play. A cold
  start with home unreachable plays in about 1.3 s on the emulator. Each play logs
  `play answered from the phone in N ms` (or `by home`).
- **Playing.** The player reads through a `CacheDataSource` over its HTTP source; if the
  download store cannot open, it streams. Now playing says "Playing from this phone" for a
  kept track. Media calls give up connecting after 3 s and reading after 10 s; a call that
  failed marks home down for a minute, during which a kept item plays from the phone at once
  (a Wi-Fi that reaches nothing behaves like airplane mode). Offline, a kept collection
  resumes at the part heard most recently (a part heard to its end moves on to the book's
  next part), a track of one plays on from itself, and a play by the collection's own id as
  a leaf (`p:<book>`, what a `media/play?id=<book>` link sends) plays as the collection. A
  kept book's parts are stored in the book's own order (its `GET /api/v1/list/<id>`
  listing). Online, a `p:<book>` starts at the part and place home's play route answers,
  and a `c:<book>` at the queue's `startIndex` (`QueueMapper.startIndex`, the item found
  by id among the audio tracks), at that part's saved place. Home answers a book in its
  own order and names the start; shuffle is ignored for a book, so a shuffled `c:<book>`
  starts there too. A queue with no `startIndex` (a show, music, a backend before
  2026-11-26, which put the part in progress first) starts at its first item, at that
  item's saved place unless shuffled. See `__docs/reference/content/content-playback.md`
  ("Order and `startIndex`"). Each track's `longForm` (home's `resumable`) travels to the
  shell, so a book whose chapters are short never crossfades. The car
  has an **On phone** tab (`media.roots` target `kept`) answered from the phone; offline,
  every other car level shows "Offline: showing what is on this phone".
- **Where you were.** Every progress report carries `observedAt` (when it was heard) and
  `sentAt`; the backend never lets an older report move a place back and answers
  `stale:true`, after which the phone drops it and takes home's position. Reports kept on
  the phone (`positions.json`, `pending-progress.json`) are written beside and renamed, the
  oldest heard goes first past 200, never one still kept. A play sends waiting reports after
  it starts, one flush at a time, and resumes from an unsent place on this phone.
- **Kept automatically while you listen** (spec §3.10; `AutoKeeper`, `AutoKeepRules`,
  `KeepStore.autoKeep`). Long items are heard over many sittings, often where the
  connection is worst, so the phone keeps what you are in the middle of:
  - **Trigger.** A long item played on this phone for `media.autoKeepAfterMin` minutes in
    total (default 10, counted over every sitting on the uptime clock, per book or list:
    `ListenMeter`, prefs `daylight.autokeep`). Long means the player's own test (from a
    household list, or at least 20 minutes) and never music: an item from a list must be at
    least 8 minutes, one not from a list at least 20, and a collection the payload calls a
    playlist is never kept this way. An item resumed from Continue listening (its id is in
    the Play tab's last Continue answer) is kept at once when the phone is on Wi-Fi.
    `media.autoKeep: false` stops it; turning it off removes nothing already kept.
  - **What.** A book (no list): all its parts, the part playing downloaded first, then the
    rest in play order. A talk or course series (an item from a household list): the
    lecture playing and the next two in its album's order (a rolling window): each new
    lecture moves the window, and the lecture it passed is released and deleted
    (`keep.auto.removed{reason: window}`). The payload records the keep with `auto: true`
    and, for a window, `only: [track ids]` (`KeptCollections`); a re-sync keeps the scope.
  - **Network and room.** The keep rules: Wi-Fi unless `media.downloadOnCellular`. On
    mobile data only the part playing is fetched, and only when mobile data is allowed; the
    rest follows on Wi-Fi (job 7213, unmetered). Automatic keeps share a quarter of the limit
    between them and never push out a manual keep; with no room the keep is skipped and On
    this phone (and the book's page) say "Not kept automatically: needs room". Automatic
    keeps have no notification of their own; while their bytes move Android still requires
    the downloads notification, which then reads "Keeping <title> for offline".
  - **Shown as.** "Kept automatically" in the item's state everywhere the kept index is
    shown ("Kept automatically · 230 MB" when ready, "Downloading 3 of 12 · 84 MB · Kept
    automatically" before): On this phone, the Play tab's On this phone, Now playing's ⋮;
    on the book's page under its title; Now playing says "Playing from this phone · Kept
    automatically". **Keep** on such an item makes it a manual keep (the whole collection,
    never removed by these rules). **Remove** on one stops it being kept automatically
    again until it is kept by hand.
  - **Removed automatically.** A book finished (home says so after Mark finished or 97 %,
    or its last part heard to 97 % here) goes 24 hours later, so the last chapter can still
    be replayed; anything kept automatically and not played for 30 days goes. A series is
    never "finished" by its window's last lecture (the window moves on; an unplayed one goes
    after 30 days). Each removal is listed under On this phone for 7 days ("Removed:
    finished", "Removed: not played for 30 days") with **Keep again**. Manual keeps are never
    removed by these rules (only by `media.removeFinished`). The removals run in every sync,
    when On this phone opens, and at the time one falls due (job 7212).
  - **Mid-play.** The part playing streams until its copy is complete (the player's cache
    key is `track:<content id>`, the download's too), and the next part plays from the copy.
    Offline, a part of a kept item whose copy is not complete holds the player (it never
    skips past the place) and Now playing says "Not on this phone yet: needs a connection"
    (`PlaybackRecovery.KEPT_NOT_YET`; before, a kept part still downloading was skipped).
  - **Reported.** Each automatic keep goes to home in the keeps report with `auto: true`; the
    web's phone page and item menus say "Kept automatically". Automatic keeps are per install.
  - **Checking it quickly.** A debuggable build reads `files/autokeep-debug.json`
    (`{"afterMin": 1, "graceMin": 2, "staleMin": 5}`, written with `adb shell run-as`) to
    shorten the threshold, the 24-hour grace and the 30 days; a release build ignores it.
  - **Telemetry** (`Downloads`, no titles): `keep.auto.started{kind, minutes, trigger,
    tracks}`, `keep.auto.ready{tracks, bytes}`, `keep.auto.skipped{reason: needs_room |
    mobile_data | music}`, `keep.auto.removed{reason: finished | stale | window | setting}`.
- **Keeping an artist or an author** (spec §3.11; `GroupKeepFlow`, `GroupKeepRules`,
  payload `GroupKeeps`, `KeptCollections.saveUnit/leaveGroup/removeGroup`, shell-kit
  `KeptGroups`). A keep of an artist or author is never flattened into one item:
  - **Units.** Each album (artist) or book (author) is its own kept collection carrying the
    group's id (`group` in its record), with its own size, state, Remove, place and finished;
    a book stays a book (parts in book order, chapters). The group is a record of its own in
    `kept/groups.keep` (`{id, title, kind, follow, removeFinished, keptAt, excluded}`),
    mirrored by the shell (`kept-groups-mirror.json`) like the kept list. Keeping a group
    turns any automatic keep in it manual.
  - **The sheet.** "Keep all…" is in the ⋮ of an artist's or author's page (the flat Keep is
    gone there), and a Keep or a preview that lands on an artist (search, the web) opens the
    same sheet. It is a modal bottom sheet: the units with size and a check (finished books
    unchecked, "Include finished (n)"; units past the 5000-track cap unchecked and disabled,
    with "Over 5000 tracks (n): the first N books can be kept"), the total and the room left
    after ("4.2 GB · 9.8 GB left · on Wi-Fi"), **Keep new ones too** (on for an author, off
    for an artist), **Remove each when finished** (books only, on), and one primary button
    "Keep 12 books · 4.2 GB". Sizes come from `group-preview` (the payload lists the group
    and queues each unit, four at a time) and the shell's HEAD sizes; a track already on the
    phone counts nothing. When it does not fit: "1.2 GB more than there is room for" and
    "Keep the 7 that fit" (in the sheet's order, skipping one too large).
  - **Order.** The started book first, then the author's order (finished last); albums
    newest first. Units are kept one after another in that order (`unitOrder`), each
    through the usual size, room and network rules, so each is ready on its own.
  - **On this phone.** The screen and the Play tab show a group row ("William Shakespeare ·
    12 books · 4.2 GB", with "3 of 12 ready" while some are not) and its units indented
    under it. A unit's Remove removes that unit only; the group then leaves it out
    (`excluded`), so Keep new ones too never brings it back until it is kept by hand. The
    group's ⋮ has **Choose…** (the sheet again, with what it holds checked; unchecking
    removes) and **Remove all of <name>** (confirmed, with the total).
  - **Shared copies.** A track's audio stays while any keep holds it (the payload's
    tombstones name only tracks no kept item holds). An album kept on its own and through
    its artist is one collection held twice (`alone`): leaving the group, or the group's
    removal, keeps it on the phone. Remove's confirmation and its result say what is really
    freed (`frees` in the kept index: the bytes of tracks only this item holds).
  - **Follow and finishing.** At each daily re-sync a group that keeps new ones asks
    `group-new` and keeps what home added (not what was unchecked or removed). With
    Remove each when finished, a finished book (home says so, or its last part heard to
    97 % here) goes a day later and is listed under "Not on this phone" with Keep again; a
    debuggable build's `files/autokeep-debug.json` `graceMin` shortens the day.
  - **Reported.** Each unit goes to home with `group: {id, title, kind, follow,
    removeFinished}`; the web's phone page shows the groups. A web Keep of an artist keeps
    it as a group with the defaults (unfinished units); a web Remove of the group's id
    removes the group.
  - **Telemetry** (`Downloads`): `keep.group.started{kind, units, bytes, follow}`,
    `keep.group.unit_added{reason: initial | new, tracks}`, `keep.group.unit_removed{reason:
    user | finished, units?}`, and the sheet's `keep.group.tap`, `keep.group.sheet`,
    `keep.group.fit_chosen`, `keep.group.choose`.
- **Location.** `media.downloadLocation: sd` keeps downloads on a removable card when the
  phone has one (takes effect on the next start; the kept items download again there). A
  card that is out makes every item Not available: nothing is reconciled, nothing deleted,
  downloads paused until it is back. The owner's phone has no card slot.
- **Not in the backup.** The app has `allowBackup="false"` and its extraction rules exclude
  every domain: a new or restored phone starts with nothing kept.
- **Notifications.** The grouped download notification, the Undo notification and a keep's
  outcome need the notification permission (`POST_NOTIFICATIONS`). The first keep asks for
  it, once, with the reason ("With notifications on, the phone shows how far it is and tells
  you when it is ready or why it waits"); without it downloads still run and the rows say
  their state. While Media3 holds downloads back the notification names the need not met
  (`KeepRules.waitingWords`): "Waiting: phone storage is low", "Waiting for Wi-Fi", "Waiting
  for a network", never "Waiting for Wi-Fi" for a full phone.
- **Refresh.** The Play tab's On this phone redraws every 3 s while anything is moving,
  being checked, queued or removed (`KeptIndex.changing`), every 30 s otherwise.
- **Telemetry.** `Downloads` events, no titles: `keep.tap`, `keep.attempt.begin`, `keep.attempt.cancelled`, `keep.notifications_asked`, `keep.replaced`, `keep.background_restricted`, `keep.asked`, `keep.received`,
  `keep.ready{tracks, bytes, seconds}`, `keep.failed{reason}`, `keep.removed{reason, bytes}`,
  `keep.damaged`, `keep.resynced{before, after, refused}`, `keep.stalled`, `keep.restored`,
  `keep.verify{ok, damaged}`, `keep.mobile_once`, `keep.screen`; sent offline-first with the
  tap telemetry (a batch the backend refuses for good is dropped, not retried forever).

| Setting | Default | Meaning |
|---|---|---|
| `media.crossfadeSec` | 4 | Crossfade between songs on this phone, seconds (0–12, 0 = off): the household default; the person's choice in Now playing's ⋮ wins |
| `media.downloadCapMb` | 4096 | The most downloads may take, in MB (0 for no cap). The limit that applies is never more than the free space minus 2 GB |
| `media.downloadOnCellular` | false | Whether downloads may use mobile data. Off: they wait for Wi-Fi (Use mobile data once lets what is waiting go now) |
| `media.removeFinished` | false | Remove a kept book a day after it is finished, with Undo for a day |
| `media.removeFinishedAfterMin` | 1440 | Minutes from finished to removed (at least 1); shortened only to check the Undo notification |
| `media.downloadLocation` | internal | `internal` or `sd` (a removable card, when the phone has one) |
| `media.autoKeep` | true | Keep a book, talk or course automatically while listening (never music); off removes nothing already kept |
| `media.autoKeepAfterMin` | 10 | Minutes of a long item heard on this phone before it is kept automatically (1–600) |

### The phone's inbox: Play on Phone and Keep from the web

With `media.playOnTarget` the payload long-polls the backend for commands addressed to this
install (`PlayInbox`): `GET /api/v1/device/<id>/commands?wait=20&installId=&model=` with
`Authorization: Bearer <device token>`. The full contract and the backend side are in
`__docs/reference/media/media-app-technical.md`.

- **What reaches a closed app, and how fast.** Android stops the phone's shell service
  about a minute after the app leaves the screen, and the long poll stops with it. So:
  - **Listening** (the long poll runs): while any Daylight screen is open, and while the
    phone plays (playing makes the app foreground; the media service brings the shell back
    if Android stopped it). A Play on Phone or a keep arrives within a second or two.
  - **Closed:** a background job (`KeepJob.INBOX_ID`, every 15 min, Android's shortest
    period, any network, persisted across reboots, scheduled by the payload when the inbox
    starts) boots the shell and checks once: `wait=0&background=1`. It collects waiting
    keeps and removes (acked as usual; the download job then runs on its own) and sends the
    kept list. A background check does not make the phone present or live at home, so the
    web never offers Play on to a closed app: its row reads "Open the app on the phone to play here"
    and is disabled, and a waiting keep reads "Waiting for Phone · asked 12:04 · usually
    within 15 min". Logcat: `inbox job: checked` (or off, unauthorized, unreachable).
- **Which install.** Each install makes an install id once (random, in the payload state's
  `install-id`; a reinstall or a cleared app is a new install) and sends it with
  `Build.MODEL` on every poll, ack and report. A command addressed to another install is
  refused (`wrong_install`), never applied. An Android emulator (by its `Build` fingerprint
  and hardware) polls as `<device id>-emulator`, never as the phone, so a web "Play on
  Phone" can only reach the real phone. The start note in logcat says which:
  `MEDIA: inbox: polling as phone, token present` (never the token).
- **The token.** The build compiles the device's token from the private tokens file as
  `BuildConfig.INBOX_TOKEN`, only for a device with no control API (`control.bind: none`):
  it is readable by apps on the phone itself and grants only this device's inbox (its Play
  on and Keep commands), never a control API. The payload reads it through
  `ShellServices.inboxToken()` (empty on an older shell). A refused token (401) records the
  backend's reason (`no_token`, `wrong_token`, …) and polls again after 5 minutes; a 4xx
  other than that means home has no inbox for this id and is not "home down".
- **Commands.** A play command starts the content here (`c:<content id>`, the queue
  route). `keep` and `unkeep` (`params.contentId`, `params.title`) keep or remove a
  collection (see Downloads above); the ack (`appliedAs: keep|unkeep`) goes once it is
  recorded, and a repeated command is harmless.
- **What is kept, for the web.** The whole kept list with each item's state and the phone's
  own words goes to `POST /api/v1/device/<id>/keeps` (`{installId, items:[{contentId,
  state: queued|downloading|ready|failed|refused|removed, title, done, total, bytes,
  reason}]}`, at most 500): 5 s after a change, and again at most once a minute with the
  polls so the web heals after a lost report.

## Page bridge on the phone: pinning media

The site's full-screen media view, inside the phone app, can ask the app to pin
what is on screen (a playlist, an album, a track) as a one-tap action. This is the
first page-bridge call that changes something on the phone at a page's request.
The web side's "Add to home screen" control is built from this contract; nothing
here has run on a phone.

### Members

Both exist on `window.daylight` only in a build that lists `media-service` (the
phone). A kiosk's page has neither: a per-device test (`DeviceDefaultsTest`) fails a
build where the members are offered without `media-service`, or on a kiosk. Like
every member, they exist only where the bridge does (a WebView with document-start
injection, a page of an allowed origin; see `kiosk.md`). Test for them before use:
`typeof window.daylight?.pinMedia === "function"`.

| Member | Takes | Returns |
|---|---|---|
| `daylight.canPinMedia()` | nothing | `true` or `false`. Read-only and not rate limited |
| `daylight.pinMedia(request)` | an object, or its JSON text: `{"contentId": "<source>:<localId>", "label": "<text>"}` | an object `{accepted: boolean, reason?: string}` |

`canPinMedia()` is `true` when all of these hold at the moment of the call: the
calling document holds a bridge token (it is a document of an allowed origin that
the shim was injected into), the main frame is on an allowed origin, the calling
document is the top frame, and the launcher supports pinning shortcuts
(`ShortcutManager.isRequestPinShortcutSupported`). It is `false` otherwise,
including in a frame and on a launcher that cannot pin.

`pinMedia` answers at once. `accepted: true` means the launcher took the request and
Android's own "Add to home screen" dialog is showing. Nothing is recorded then: the
pin is recorded only when the launcher confirms that the owner added the shortcut
(see "What a pin does"), and that confirmation is not reported to the page. The web
side says something like "Confirm on the dialog", never "Added".

`accepted: false` comes with one `reason`:

| `reason` | When |
|---|---|
| `refused` | No answer from the native side: the token is not this document's (an old document, a guessed token), the main frame is on another origin, or the bridge is gone. Built by the shim |
| `not_top_frame` | The calling document is a frame, not the top frame |
| `rate_limited` | A second request from the same document within five seconds of its last request that was let through (counted: `pinRequestsRefused` in the kiosk status; on the phone, nowhere outside the process); or a fourth accepted request within a minute in the app's process, whatever document or reload asks; or a fourth request while three dialogs are still open (asked, neither confirmed nor ten minutes old) |
| `limit_reached` | 24 pinned media actions are kept already, counting the requests whose dialog is still open. No pin is pushed out for a new one; the owner removes a pinned media shortcut from the home screen first, which frees its slot. The web side shows "Too many home screen shortcuts; remove one first" |
| `bad_request` | Not a JSON object, or `contentId` or `label` missing or not a string |
| `invalid_content_id` | Fails the media service's content id rule: a URL, a source named like a URL scheme (`http`, `javascript`, `intent`, ...), an empty, `.` or `..` segment, a backslash, a bar or a control character, a modifier segment (`shuffle`, `playable`, `launchable`, `recent_on_top`, `expand`), or longer than 400 characters |
| `invalid_label` | After trimming, empty or longer than 40 characters (counted as code points), or holding a control character, a format character (every bidi override and isolate, the direction marks, zero-width characters), a line or paragraph separator, a lone surrogate, a private-use or unassigned character |
| `not_available` | The build has no `one-tap-actions`, or the app's surfaces are not running |
| `launcher_cannot_pin` | The launcher does not support pinning shortcuts |
| `launcher_refused` | The launcher refused the request (`requestPinShortcut` returned false or threw) |
| `failed` | Anything else, including a content id whose derived action id is already a configured action's |

The answer never holds anything else: no link, no install key, no action id and no
list of what is pinned. The dispatcher builds it from `accepted` and a reason that
must be one lower-case word; whatever else the native side holds is dropped.

### What a pin does

1. media-service checks the content id with the same code that guards every play
   and browse request (`ContentId`), and the label (`PinRequest`).
2. one-tap-actions makes an action for it: id `media-` and twelve hex digits of the
   content id's SHA-256 (the same content is always the same action; the id does
   not spell the content), the label, the icon `play`, target `media:<contentId>`.
3. It asks the launcher to pin a shortcut with the id `pin-<action id>`, whose link
   is `daylight://action/<action id>#k=<key>`, keyed like every action link. The
   content id is never in a link from outside.
4. The request carries a single-use token (16 random bytes, held in the payload's
   memory for ten minutes) inside an immutable `PendingIntent` to the app's own
   non-exported `PinResultReceiver`, passed as `requestPinShortcut`'s result intent.
   `requestPinShortcut` returning true means only that the dialog was shown, so
   nothing is recorded then.
5. Android sends that intent once the owner has added the shortcut. The receiver
   hands the token to the payload (`pins` port, in process), and only then is the
   action recorded, in the app's private state
   (`files/payloads/state/pinned-media.json`), newest last. A dismissed dialog never
   sends it; a token that matches no request of the last ten minutes, or was used
   already, records nothing. Pending requests are held in memory only.
6. A shortcut the owner added that was not recorded (the app restarted while the
   dialog was open, the confirmation came after ten minutes, or the receiver could not
   reach the payload) stays pinned and is never disabled. At each publish it is
   rewritten under the current key with the label the launcher shows, so a tap
   reaches the app, which answers "This shortcut was not saved. Remove it and pin it
   again from the Media page" and plays nothing: only a hash of the content is in its
   id. It holds no slot in the list.
7. At most 24 are kept, and each open dialog holds a slot until it is confirmed or
   its ten minutes run out, so a confirmation is never refused for a full list. At
   most three dialogs are open at once (a dismissed dialog sends nothing back, so it
   stays open until it expires); a fourth request is refused with `rate_limited`
   until one is confirmed or expires. A page asking while nobody answers therefore
   holds at most three slots, and the rest stay free for real pins. A new
   pin when the kept and held slots reach 24 is refused before the dialog
   (`limit_reached`); nothing is pushed out and no shortcut is disabled for it.
   Pinning the same content again renames it and makes it the newest. At every
   publish, and before every request, an entry whose `pin-<id>` shortcut the launcher
   no longer holds (`getPinnedShortcuts()`) is dropped, so removing a shortcut from
   the home screen frees its slot.
8. The surfaces are published again: the "Daylight button" chooser lists the
   pinned action after the configured ones, and a button bound to it plays with no
   window (the play service asks the payload for an action id, and the pinned
   actions are among those it answers for). The pinned shortcut is rewritten under
   each new key like any pinned shortcut.

A pinned action is not a launcher (long-press) shortcut, a tile or one of the
four-button widget's buttons unless a settings line names it. A configured action
of the same id wins. A pinned action leaves the chooser when its shortcut is removed
from the home screen (at the next publish).

### Threat cases, each a test

| Case | Outcome | Test |
|---|---|---|
| A page of another origin in the main frame | No answer (`refused`); nothing pinned | `BridgeDispatcherTest.threat_anotherOriginInTheMainFrame...` |
| A frame (an iframe) | Of another origin: no key, no token, no answer. Of an allowed origin: `not_top_frame`, and `canPinMedia()` is false | `threat_anIframeCannotPin` |
| A call after navigation with an old document's token | No answer | `threat_aCallAfterNavigationWithAnOldToken...` |
| A hostile label (bidi override, control character, separator, too long) | `invalid_label` | `PinRequestTest.aHostileLabelIsRefused`, `MediaServiceCapabilityTest.aBadContentIdOrLabel...` |
| A content id that is a URL, holds `..` or a modifier segment | `invalid_content_id` | `PinRequestTest.aContentIdThatIsAUrl...`, `ContentPathTest.aSourceThatIsAUrlSchemeIsRefused` |
| A flood | One request per document per five seconds, and three accepted requests a minute in the whole process across documents and reloads; the rest `rate_limited`; one dialog | `threat_aFloodIsRefused...`, `theLimitIsPerDocument`, `SurfaceRoutesTest.atMostThreeRequestsAMinuteAreAcceptedInTheProcess` |
| A page filling the list to push the owner's pins out | Nothing is recorded without the owner's confirmation in the launcher's dialog; at 24 a new pin is `limit_reached` and no shortcut is disabled | `SurfaceRoutesTest.aPinIsRecordedOnlyWhenTheLauncherConfirmsIt`, `aConfirmationTokenIsSingleUseBoundToItsRequestAndExpires`, `atTheLimitANewPinIsRefusedAndNoShortcutIsDisabled` |
| The page trying to learn the key, a link or the pinned list | The answer is `{accepted, reason?}` only; an unexpected reason becomes `failed` | `threat_thePageCannotLearnTheKey...`, `MediaServiceCapabilityTest.theAnswerHoldsAcceptedAndAReason...`, `SurfaceRoutesTest.theAnswerNeverHoldsALink...` |
| A kiosk build | No member at all | `DeviceDefaultsTest.onlyADeviceWithMediaServiceOffersThePageToPinMedia`, `BridgeScriptTest.withoutPinningTheShimHasNoPinMembers` |

What is not covered: an allowed-origin frame can call its parent's
`window.daylight.pinMedia` (same origin, so the browser allows it), and that call is
the top frame's. Such a frame is the household site itself. Script in the top
frame of the site can call `pinMedia` without the owner having tapped anything;
the five-second and per-minute limits and Android's dialog are what stand between
that and a pin, and only the owner's confirmation in that dialog records one.

Unproven on a phone: that `requestPinShortcut` shows its dialog when called from
the WebView's bridge thread, that the launcher accepts a shortcut id and a long
label of this shape, and that the pinned shortcut survives the key rotation (the
same mechanism as `POST /actions/pin`'s shortcuts).

## `android-auto`

The phone APK declares Android Auto's standard media browser through
`com.google.android.gms.car.application` and the media-only
`automotive_app_desc.xml` in the phone flavor. Android Auto opens the native
Daylight media library with Playlists, Recent, and Browse tabs. The household
action templates use a separate Android for Cars App Library surface and are
outside the sideloaded phone's media declaration.

The sideloaded media build needs Android Auto's **Unknown sources** developer
setting on the phone. This setting is separate from Android's USB debugging:

1. Open Android Auto's settings, scroll to "Version and permission info" and tap
   it ten times; accept developer mode.
2. In the three-dot menu open "Developer settings" and turn on **Unknown sources**.
3. Reconnect the head unit and open Daylight from the car's app menu. Verify that
   its media icon appears, the Playlists tab opens, and choosing a playlist
   starts playback. A working media card alone verifies playback only.

Testing without a car, with the Desktop Head Unit:

1. In Android Studio's SDK Manager, SDK Tools, install "Android Auto Desktop Head
   Unit Emulator". It lands in `<sdk>/extras/google/auto/`.
2. On the phone, in Android Auto's three-dot menu, choose "Start head unit server".
3. `adb forward tcp:5277 tcp:5277`, then run `desktop-head-unit` from that directory.

Sources: `https://developer.android.com/training/cars/testing`,
`https://developer.android.com/training/cars/testing/dhu`,
`https://developer.android.com/training/cars/media/auto`.

## `car-actions`

A templated list of household actions in Android Auto. The car is projection: the
phone draws Car App Library templates and the car shows them. Nothing here has run
on a phone or in a car.

**Library.** `androidx.car.app:app` 1.3.0-rc01, in this capability's shell half
only, so only a device that lists `car-actions` gets it (the kiosk APKs contain no
`androidx/car` classes). It is the newest version whose AAR metadata accepts
compileSdk 33 (`minCompileSdk=33`; 1.2.0 needs 31, 1.4.0 and later need 34). It
builds with the Android Gradle Plugin 7.4.2. Read from its classes: the IOT category
constant (`CarAppService.CATEGORY_IOT_APP`, `androidx.car.app.category.IOT`) is
already in this version; `ListTemplate`, `GridTemplate`, `MessageTemplate`,
`PaneTemplate`, `CarToast` and `HostValidator` are there; Car API levels 1 to 6.

**Unproven until it runs:** whether Android Auto lists a sideloaded IOT-category app
built on 1.3.0-rc01, with the developer setting for unknown sources on. If it is not
listed (the media app is, and the car list is not), record what Android Auto shows,
and try in this order: confirm the unknown-sources setting is on; the head unit's
own app list rather than the launcher row; `adb logcat | grep -i CarApp` for a
refusal on the handshake. If it is still not listed, the remaining step is a newer
library (1.4.0 or later), which needs compileSdk 34 for every device and is the
owner's decision.

**The list.** The setting `car.actions` is a comma list of ids of configured
one-tap actions, at most six. The phone's is `journal,omw` (the Journal voice memo
and "On my way"). Usable in a car:

| Kind | In the car |
|---|---|
| `api:/api/...` | Yes: the household call runs and its outcome is a car toast |
| `location:share` | Yes: the toast says location sharing is not built yet |
| `open:`, `bookmark:` | No: a web page is no use while driving |
| `media:` | No: household media plays through Daylight's media app in the car |
| `input:text:`, `input:photo:` | No: they need the phone's keyboard or camera |
| `input:voice:<dest>`, `memo:new` | Yes: a tap records a voice memo through the car's microphone (below) |

An id that is not an action, a kind the car cannot show, a duplicate or a seventh
entry is left out and reported in `GET /car/actions` `problems` and in the shell
log at start; `start()` never throws for it. A value written by hand that names a
known action the car cannot show is refused when it is written; a device file with
any problem fails `DeviceDefaultsTest` at build time.

**When the list does not come** (audit). The last list that answered is kept
(`daylight.car` `lastList`). A cold car with the payload still starting shows it (else
one row, "Starting up…"); a list that fails shows "Couldn't reach home · retrying" above
the last list, whose rows still work, and asks again every 5 s without blanking it
(`CarAnswers.unreached`). Runs go on their own thread, so a list retry never holds a
tapped action.

**A tap.** The car screen asks the payload over the `car` PayloadPort, in process:
`{op: list}` and `{op: run, id}`. A run takes an id on the car list, and only such an
id (anything else answers "That is not on the car list"), and goes through
`ActionList.run`, the path a keyed `daylight://action/<id>` link takes. No link is
built and no key leaves the payload. The tap runs off the main thread. A car toast
"Sending <label>…" shows at once and the row's second line reads "Sending…"; further
taps on that action are ignored until its answer arrives or 12 s pass (the 8 s run wait
plus a margin; `RunGuard`), so a second tap cannot run a door or the lights twice. The
answer is a second car toast. Drawing the list, a refresh and the car connecting run
nothing: only a row's own click does.

**Cold start.** The service starts the shell service, as the media service does.
With no payload yet the list is one row, "Starting up…"; when a payload
attaches the screen asks again and redraws.

| Method | Route | Answer |
|---|---|---|
| GET | `/car/actions` | `{actions: [{id, label, icon, kind}], problems: [...]}` |

### Who may bind the car screen

Android Auto binds an exported service, and no permission exists that only Android
Auto holds, so any app on the phone can bind it too. The Car App Library's binder
does not hold such a caller off on its own (read from the 1.3.0-rc01 classes):
`CarAppService.onBind` is final and hands the same `CarAppBinder` to every client
that binds with the same or no `SessionInfo`; the caller's uid is read only in
`onHandshakeCompleted`; `getManager`, the app manager's `getTemplate` and a row's
click check nobody. An app could bind, skip the handshake, ask for the app manager
and the template, and press a row: run a household call, or open the car's
microphone. Its own handshake could also overwrite a single stored decision.

So the check sits at the binder boundary:

- **`CarHostGateService`** is the exported service with the
  `androidx.car.app.CarAppService` action and the IOT category. Its `onBind` returns a
  `Binder` whose `onTransact` judges every transaction by the uid Binder reports for
  that transaction (`CarGate`, then `CarHostPolicy`): the uid must own Android Auto's
  package, `com.google.android.projection.gearhead` (the package the library's own
  sample host list names), and that package's one signing certificate must be the
  one pinned for it in `car.hostPins` (`package=sha256`, the same form as
  `media.controllerPins`; only Android Auto's package is accepted in it), through the
  same `SignerPins` code the media service's `ControllerPolicy` uses. A shared uid is
  let through when Android Auto's package is among its packages and that package is
  pinned. A platform-signed app, a system uid and any other pinned app are refused.
- **A refused transaction** returns "unknown transaction" before the library reads a
  byte of it, whatever its code: every car app call, the descriptor query
  (`INTERFACE_TRANSACTION`) and a dump alike. Nothing is bound, created or stored for
  it beyond its own uid's decision, and a refusal is logged at most once a minute per
  uid.
- **A transaction that is let through** goes to the library's binder in
  `DaylightCarAppService`, which is not exported and has no intent filter. The gate
  binds it in process on the first transaction let through, with an intent it builds
  itself: the component and the session the binding names in its identifier
  (Android 10 and later) or data path (`"<display type>/<session id>"`, what the
  library's `SessionInfoIntentEncoder` writes there and `Intent.filterEquals`
  compares), encoded again with the library's own encoder. A client's extras, which
  Android does not compare between clients, are never passed on, so the first app to
  bind cannot choose the session Android Auto gets. With no readable key the library's
  default session applies. The gate unbinds when the clients do (`onUnbind`, which
  Android also calls when the host dies), and binds again on the next let-through
  call if Android hands the same gate binder back (it keeps a service's binder for an
  intent while the service lives). The forward is a local
  `Binder.transact` on the same binder thread, with the parcels as they came, so the
  descriptor is the library's own (`androidx.car.app.ICarApp`) and the library still
  reads the host's uid at its handshake.
- **Checked on every call**, against what is installed and pinned now: an update,
  removal or re-signing of Android Auto, or a changed pin, takes effect at the next
  call. One uid's refusal never changes another's admission.
- **Everything the car screen hands out comes from a gated call.** Every `ICarApp`
  method (`onAppCreate`, `onAppStart`, `onAppResume`, `onAppPause`, `onAppStop`,
  `onNewIntent`, `onConfigurationChanged`, `getManager`, `getAppInfo`,
  `onHandshakeCompleted`, all one-way) passes the gate. The app manager is handed out
  only in answer to `getManager`; the templates and their click listeners only by
  the app manager; the microphone's callback and every other app-side binder only to
  the `ICarHost` that the gated `onAppCreate` delivered. A refused caller can obtain
  none of them.
- **Two further checks stay behind the gate.** `DaylightCarAppService` records
  `CarHostPolicy`'s decision per uid in `createHostValidator` (which the library calls
  on the handshake's binder thread) and hands the library's validator that one host
  and its pinned digest, or none; and the screens check `servesHost()` before drawing
  or acting, against the decision for the uid the library settled on. The library's
  validator alone would also accept a package holding
  `android.car.permission.TEMPLATE_RENDERER`, which an app could define for itself.
  `ALLOW_ALL_HOSTS_VALIDATOR` and the "allow every host in a debuggable build"
  shortcut are not used.

**Unproven until it runs:** that Android Auto accepts a car app whose
`CarAppService` intent filter is on a class that is not a `CarAppService` subclass.
All Android Auto can see of the app is the manifest entry (an exported service with
that action and category, as before) and the binder protocol, which the gate
forwards unchanged; it cannot see the class behind the binder. So it should, but no
car has confirmed it.

The pins reach the installed service through the surface cache (the payload writes
`car.hostPins` there at start and when it changes), so a car that binds the
service before the payload loads is held to them. With no pin Android Auto is
refused too. The first connection is the pinning step: the refusal line is

```
refused car host com.google.android.projection.gearhead: no pin for this package. To allow it, add com.google.android.projection.gearhead=<sha256> to car.hostPins
```

The package name and the digest are public values. Copy the entry into
`car.hostPins` in `devices/phone.yml`, bump the phone's `shell.versionCode`,
rebuild, verify and install (see the acceptance runbook, E2).

### A voice memo in the car

A car-list entry whose action is `input:voice:<destination>` (or `memo:new`, the
journal) records through the car's microphone and feeds the same quick-input queue,
to the same destination, as a memo recorded on the phone.

What the library offers, read from its classes (1.3.0-rc01 and
`androidx.car.app:app-projected` 1.3.0-rc01, which this capability adds because
`CarAudioRecord.create` loads `ProjectedCarAudioRecord` from it by name):
`androidx.car.app.media.CarAudioRecord`, annotated `@RequiresCarApi(5)` and
`RECORD_AUDIO`; `AUDIO_CONTENT_SAMPLING_RATE = 16000`, `AUDIO_CONTENT_MIME =
"audio/l16"` (16-bit linear PCM), `AUDIO_CONTENT_BUFFER_SIZE = 512`. It opens the
car's microphone through `AppManager.openMicrophone` and reads a pipe from Android
Auto. Mono and little-endian byte order are from Android's documentation, not from
the classes.

- **Who can start it.** Only a tap on the entry in the car list (or the phone's own
  recorder on the phone). Drawing, refreshing or reconnecting the car screen starts
  nothing (`CarMemo`, tested); no page, link or other app reaches it. Refused, with
  a car toast saying why: a car below Car API level 5 ("This car cannot record
  voice memos"), the phone without the microphone permission ("Allow the microphone on
  the phone first", granted on the phone, through the phone recorder's prompt),
  `identity.user` empty ("Quick inputs aren't set up on this phone"), or a recording
  already under way.
- **The screen.** A `MessageTemplate` titled with the entry's label: "Starting", then
  a clock ("Recording 1:05") redrawn each second, and one Stop action. Tap targets
  only, no text entry. Stop, backing out, the car disconnecting, an error or thirty
  minutes ends it and saves it; under a second is discarded (the phone recorder's
  `RecorderMachine`, shared). The outcome is a car toast: "Saved for Journal".
- **The file.** The PCM is encoded on the phone: Ogg/Opus (`MediaCodec` and
  `MediaMuxer`'s Ogg output, Android 10 and later, when the phone has an Opus
  encoder), else AAC in MP4 as five-minute segments, as the phone recorder does below
  Android 10. Written as `<id>.<dest>.ogg.part` in `files/memos/inbox` (the
  recorder's `MemoFiles` names), renamed when whole; the payload is told over the
  `inputs` port, or finds it at its next scan. Uploads follow the intake contract
  unchanged (`/api/v1/journalist/voice` for the journal).
- **Cut off.** A recording whose process died is recovered the way the phone's is
  (`MemoRecovery`): an Ogg file becomes a memo, an MP4 segment is kept aside. The car
  recording under way is named to `MemoRecovery` (`carLive`), so neither recorder's
  recovery touches the other's file.
- **Memory.** The thread that reads the car's microphone also feeds the encoder and
  writes the file, so a stalled encoder or disk holds the reading back rather than
  growing a buffer; a write the encoder cannot take within about two seconds ends the
  recording, and it is saved.
- **Logs.** The format, the length in seconds and whether it was kept. Never what was
  said.

**Unproven until it runs in a car:** that Android Auto opens the car's microphone for
an IOT app at Car API level 5 on this library; the byte order and channel count of
what arrives; that the platform's Opus encoder and Ogg writer produce a file the
Journalist accepts and that a cut-off Ogg file from `MediaMuxer` plays to where it
stops; whether a recording keeps going with the phone locked and the app not in
front on the phone; how often Android Auto lets a template redraw (the clock).

**Metadata.** `android-auto` owns the `com.google.android.gms.car.application`
meta-data. `car-actions`' shell half depends on `android-auto`'s and has its own
`res/xml/automotive_app_desc.xml` with `<uses name="media"/>` and
`<uses name="template"/>`; a library's resource wins over its dependency's, so a
build with `car-actions` declares both (checked in the built APK) and one without
it declares media alone. The service has the IOT category and
`androidx.car.app.minCarApiLevel` 1 (a list, a message, a toast). The library adds
three components, `CarAppPermissionActivity`, `CarAppNotificationBroadcastReceiver`
and (from `app-projected`) `CarAppMetadataHolderService`, none exported and the last
disabled, and a `<queries>` entry for Android Auto's connection provider,
which is not a component of this app. The verifier fails a build with a car app
service that does not list `car-actions`, and one that lists it without the service.

## `quick-input`

One capability for everything the owner sends to a household bot from the phone
with one touch: a recording, typed text or a photo. It was `voice-memo`; the
recorder, the queue on disk, the retry rules and the notices are the same code,
now for three kinds and any number of destinations. Each bot answers in the
owner's Telegram conversation as it does for a Telegram message of that kind;
Telegram stays a full interface and this is another way in. A voice memo recorded
in the car (`car-actions`) is written to the same inbox by the same rules and goes
through the same queue.

The contract with the backend is
`ops:docs/superpowers/specs/2026-11-17-daylight-quick-input-intake-contract.md`.
The paired backend adds per-ID destination receipts. The older intake contract
can acknowledge transport. The acceptance runbook distinguishes that
acknowledgment from a saved destination entry.

### Destinations

A destination is a settings line, `input.dest.1` to `input.dest.8`, each
`id|label|kind|route`:

| Part | Rule |
|---|---|
| `id` | `[a-z][a-z0-9-]*`, at most 32 characters, unique. What an action, a link and a queued input name |
| `label` | 1 to 25 characters, no control character. What a notice and a screen's title show |
| `kind` | `voice`, `text` or `photo`. One destination takes one kind |
| `route` | A path on the configured backend, under `/api/v1/`: plain segments of letters, digits, `.`, `_`, `~` and `-`, at most 200 characters, with no query, no fragment, no escape, no `.` or `..` segment and no trailing slash. Never an address |

The first five slots default to the contract's table, so the phone's device file
states none of them:

| Destination id | Kind | Route | Label |
|---|---|---|---|
| `journal` | voice | `/api/v1/journalist/voice` | Journal |
| `journal-note` | text | `/api/v1/journalist/text` | Journal note |
| `meal` | voice | `/api/v1/nutribot/voice` | Meal |
| `meal-note` | text | `/api/v1/nutribot/text` | Meal note |
| `meal-photo` | photo | `/api/v1/nutribot/photo` | Meal photo |

A line that breaks a rule is refused when it is set, and as a device default it
fails the build (the per-device payload test applies the defaults). A line whose
id is already used is left out and reported under `problems` in
`GET /input/queue`, which the same test requires to be empty; the payload still
starts. The route is where a request goes and nothing else decides it: a link
or an action names a destination by its id, the queue remembers the id and not
the route, and the route in force when the input is sent is the one used. An
input whose destination has since been removed is parked with "unknown
destination" and kept.

The phone's device file adds two share destinations (see "Sharing from other apps"):

| Slot | Destination id | Kind | Route | Label |
|---|---|---|---|---|
| 6 | `share-livingroom-tv` | text | `/api/v1/share/to/livingroom-tv/text` | Living room TV |
| 7 | `share-office-tv` | text | `/api/v1/share/to/office-tv/text` | Office |

### Who can start a capture

A recording, the camera and the text screen start only from a tap on this
phone: a tile, the widget, a launcher shortcut (each a keyed `action` link whose
action is an `input:` line), or a keyed `input` link the app built itself.

- The three screens and the recorder service are not exported, and the provider
  that hands the camera app its file is not exported either. Nothing outside the
  app can start one by name.
- The link activity is exported, so an `input` or `memo` link can be sent by any
  app or page; without this install's key it is refused before it reaches the
  capability, and the capability's own handlers refuse it again if it ever got
  that far.
- A page of the site has no way to build a keyed link, and the page bridge has
  no call that runs an action or starts a capture.
- A car reaches the media library service, which takes media ids, and the car list
  (`car-actions`), whose voice entry records through the car's microphone only on a
  tap on that entry on the car's screen, into this same queue (see "A voice memo in
  the car"). Both hold the car to a pinned certificate.
- A page's own use of the microphone or camera (`getUserMedia`) is a separate
  path, through the web view, and follows the scoped Call and Health rules above.

With `identity.user` empty, or `identity.device` not `fleet:<key>`, no screen
opens: the action answers "Quick inputs are not set up on this phone: identity
not configured" (or "device identity not configured").

### Voice

Open the voice shortcut to record. Another tap returns to the active recording
with its original destination. **Send memo** publishes the draft to the upload
queue. The top-right **×** and Android Back ask before discarding a draft with
content. Rotation keeps the recording. Loss of audio focus, recorder failure,
service shutdown, or the recording limit ends the draft privately. Reopen the
same destination and use **Resume draft** to play a recoverable recording, then
send or discard it. An unreadable recording stays private with an interruption
message. Phone audio uses Ogg/Opus where supported, with an AAC fallback. Car
recording retains its own capture and send flow.

### Text

The named text shortcut opens a multiline editor. Edits are saved to a private
draft, including across process restart. The 16,384-byte limit counts UTF-8 bytes
and keeps each character intact. Send trims surrounding whitespace and requires
visible content. Back or Cancel asks before discarding a draft with content.
If the write fails, the draft remains available.

### Photo

**Meal photo** opens Daylight's own camera (`MealCameraActivity`): a viewfinder and a
shutter, no review step. Each shot is handed to the private draft pipeline on a background
thread (draft, EXIF removed, prepared, queued), so the camera is ready for the next shot at
once. A chip shows how many were sent; tapping it opens the capture status screen, where a
capture is replaced or retried afterwards. Nothing is asked before a photo is sent.

The camera permission is asked for once, in the camera screen. If it is refused, or the
phone has no usable back camera, the capture opens the phone's camera app instead and the
older review flow below applies: Android's camera app writes to a single-URI grant provided
by `InputFileProvider`. After the camera confirms the image and the grant is withdrawn,
Daylight shows a private review. **Use photo** reveals **Send**. **Retake** opens the
camera again and retains the previous photo if canceled. **Discard** and Back ask before
dropping a photo draft. Daylight recovers the capture where Android delivers the camera
result after process recreation.

Daylight applies EXIF orientation, scales the long edge to at most 2048 pixels,
and re-encodes the image as JPEG. It checks the encoded file for EXIF, XMP and
IPTC blocks and removes the camera source after processing. Upload uses the
processed image and the capture timestamp kept separately.

### Sharing from other apps

Daylight is in Android's share sheet for plain text (`SEND`, `text/plain`): a link
from YouTube, a browser or any other app, often with a title around it.
`ShareActivity` opens over the sending app, shows the first line of what is shared
and one big button, **Send to <first share destination>**, with the other share
destinations below it and **Cancel**. Nothing is sent until the owner taps one.
The tap writes the shared text into the same private queue as a typed note, for
that destination. It is sent with this install's identity, retried, and shown in
Capture status like any capture. The backend's [share router](../core/share.md)
decides what to do with it. A video link plays on that screen, which shows the
provider's scene following the real fetch.

- **Share destinations** are the text destinations whose id is `share` or starts
  with `share-`, in slot order. The first one is the big button. The screen asks the
  payload for them (port op `share-targets`, ids and labels only) once the payload
  has started. A cold start shows "Starting up…" and waits as long as the loader
  gives the payload (`PayloadReady`), then up to 8 s for the account and the answer
  (`READY_WAIT_MS`).
- **No destination** ("Sharing has no destination on this phone") or **not set up**
  ("Sharing isn't set up on this phone yet"): nothing is queued.
- **Text over the intake's 16 KB** keeps its start, where the link is.
- Not over the lock screen, kept out of recents, no recents screenshot.
- The backend refuses for good a share with no URL, or a URL nothing handles
  (`422 unusable_input`). The capture is then parked, and Capture status shows it.

### Capture status

Voice, text and photo drafts live in app-private storage under
`files/capture-drafts`. They retain their ID, destination and capture time.
An explicit Send publishes the draft to the appropriate inbox. Sending opens
**Capture status** with that operation first. The same surface is available from
its home shortcut or a single-item notification. It displays the configured
destination, kind, time, delivery state and any saved reference.

**Accepted** means the intake acknowledged the capture. **Delivered** requires
a final destination receipt. Journal receipts identify the saved entry. Meal
receipts identify the saved meal log and can offer **View in Health**. **Retry**
reuses the same capture ID. **Replace capture** opens a new private draft and
requires a new Send. **Health status** opens the barcode operation history.
Capture status shows items for the current household binding. The older queue
continues to support legacy uploads with its existing aggregate controls.

- **"Sent" only when home has it** (audit H15). After Send, the voice and text screens do
  not close on a toast: a panel over their buttons says "Saved · sending to Journal…"
  (`CaptureUi.saved`), reads the payload's state for that capture (port op `status`, the
  row whose id is the draft's) every half second for up to 6 s, and settles on "Sent to
  Journal" (Delivered or Accepted), "Saved · sends when home answers" (no network, or still
  waiting when the 6 s end), "Saved · sends when the daily allowance renews", or "Saved ·
  not accepted: see Capture status"; then it closes 1.6 s later (`CaptureOutcome`). Photo
  opens Capture status on the item. Telemetry: `capture.saved`, `capture.sent_seen`,
  `capture.saved_waiting`.
- **Reachable from the Capture tab** (H16): its first row is **Capture status** with the
  counts, "1 needs attention · 2 waiting to send · 3 sent" (`CaptureCounts`), read from
  the payload for the bound account; a tap opens it.
- **A restored draft is held, never dropped.** A text, voice or photo screen recreated
  after Android stopped the app waits for its account (`CaptureScopeWait`); when the wait
  runs out it says "Your text is saved on this phone. <why>" with **Try again** (the wait
  once more) and **Close**, instead of a toast and closing, or a "Checking capture setup…"
  that never ends for a camera result still pending (`capture.restore_held`).
- **No blank return.** The rows stay while the screen is away and the next answer redraws
  only what changed; a failed answer keeps the rows with the reason above them. A Try
  again shows "Sending…" on its row until the payload answers. A capture waiting its turn
  says "Waiting to send" and offers no Retry (it is sent on its own); Retry stays on
  "Waiting to retry", "Waiting to confirm delivery" and a refusal.

### The upload queue

One queue for every kind, kept on disk
(`files/payloads/state/input-queue.json`), so it survives the process being
killed and a restart of the phone. Each entry remembers its destination's id,
its kind, what it is sent as, when it was captured and its file. A queue file
written before destinations (`memo-queue.json`) is carried over once and read as
voice memos for the journal. A change that cannot be written (a full disk) is
undone in memory and the pass fails; the next pass makes the same change again.

```
QUEUED ──► UPLOADING ──200──► gone (the captured file is deleted)
  ▲            │ not sent, not the intake's answer, or an answer that may change: wait 5 s, 10 s ... 1 h
  └────────────┘
               │ 400, 413, 415, 422, or the 20th failure that counts
               ▼
            PARKED (the file is kept until it is sent or discarded)
```

One input is sent at a time, oldest first. Nothing is tried while Android
reports no network; a network coming up wakes the queue.

```
POST <the destination's route>?user=<identity.user>
Content-Type: audio/ogg | audio/mp4 | text/plain; charset=utf-8 | image/jpeg
X-Daylight-Device: fleet:<key>     (identity.device; default fleet:phone)
X-Daylight-Input-Id: <id>
X-Daylight-Recorded-At: <epoch ms the input was captured>
<the file, as it is>
```

| Kind | Sent as | Body | Not sent when over |
|---|---|---|---|
| voice | `audio/ogg` (Android 10 and later), `audio/mp4` (a segment, below it) | The recording | 26,214,400 bytes |
| text | `text/plain; charset=utf-8` | The text as UTF-8, with no JSON around it | 16,384 bytes |
| photo | `image/jpeg` | The re-encoded photo | 15,728,640 bytes |

An id is `<epoch ms>-<8 hex>`; a segment of a recording is `<id>-<nn>`. Only
`X-Daylight-Input-Id` is sent (the backend also accepts the earlier
`X-Daylight-Memo-Id`). No `Origin` header is sent: the client is not a page, and
the intake refuses a request that names one as `cross_origin`.

Only what the intake itself said counts toward parking. An answer is the
intake's own when its body is JSON with `ok: false` and one of the intake's error
codes. A phone can be off its VPN for days; every failure in that time is the
network's and none is counted. The table is the same for every kind and every
destination:

| What happened | The queue | Counts toward 20 |
|---|---|---|
| 200 with a boolean `duplicate` | Done. The file is deleted, and only then | |
| 200 with anything else (a sign-in page of some network) | Tried again with backoff | no |
| 400, 413, 415, 422 (`empty_transcription` and `unusable_input` are answered the same on a retry) | Parked at once with the status and the error code | |
| 403 `device_not_allowed` | The owner has not bound this phone to the user for that destination's bot. Tried again with backoff, and one notice says "This phone is not allowed to send to <label> yet"; it goes with the first input that destination accepts. Other destinations are still tried in the same pass | no |
| 429 (`daily_limit`) | **That destination** waits for the time the backend names: `retryAfterSeconds` in the body, else the `Retry-After` header, at least a minute and at most a day (fifteen minutes when neither is there). Nothing is sent to it earlier, by the timer or by a tap. The other destinations go on: a limit on one bot does not hold the other. One notice names each held destination and when sending to it resumes | no |
| Any other answer that is the intake's own (404 `unknown_user`, 403 `cross_origin`, 500 `processing_failed`, 503 `unavailable`) | Tried again with backoff | yes |
| Any other answer (a redirect, 401, a bare 403 or 404, a proxy's 502 or 504, a gateway page) | Tried again with backoff | no |
| The body was sent and no answer came within 330 seconds | Tried again; the backend answers the same id as a duplicate | yes |
| Not sent: no connection, a connect timeout to an address that is not reachable (the VPN is down), the link dropping part-way | Tried again with backoff | no |
| The destination is not configured any more, or does not take the input's kind | Parked without a call: "unknown destination", "destination does not take <kind>" | |

A hold is kept per destination id, and a device binding and a daily allowance
are per bot on the backend. Two destinations of one bot (`journal` and
`journal-note`) therefore each learn of a limit from their own first answer.

After 20 counted failures an input is parked. A parked input keeps its file. A
tap on its notice (`daylight://input/queue`) tries every waiting and parked
input again. The notice's **Discard** action (`daylight://input/discard`, keyed)
throws parked inputs away, files included, and asks twice: the first tap says
how many would go and changes nothing, and a second tap within twenty seconds
deletes. Only parked inputs are discarded; one that is still waiting never is.

**With `identity.user` empty, or `identity.device` not `fleet:<key>`, nothing is
sent and nothing is captured.** An input already kept stays on the phone, is not
retried in a loop, and a notice says so. `identity.user` is a build-time
placeholder (`phone_user`), and a per-device test fails a phone build without
it. `identity.device` defaults to `fleet:phone`; the key is 1 to 96 letters,
digits, `.`, `_` or `-`, and must be the one the household config binds to the
user (`quick_input: { journalist: [...], nutribot: [...] }` on the device entry).

| Method | Route | Answer |
|---|---|---|
| GET | `/input/queue` | `{waiting, parked, uploaded, lost, discarded, holds: {<destination id>: <until ms>}, inputs: [{id, kind, dest, state, attempts, lastError, ...}], blocked, notAllowed: [<destination id>], cutOffKept, destinations: [{id, label, kind}], problems}` |
| POST | `/input/recorded` | Scans both inboxes |
| POST | `/input/retry` | Makes every input due now (a daily-allowance wait still holds) |

On the phone nothing serves these to anyone; the build's tests call them.

Privacy: the shell log and logcat hold an input's id, its kind, its
destination's id, its length and its size. Nothing that was said, typed or
photographed, and no transcript, is read, kept or logged on the phone outside
the one file that waits to be sent, and that file is deleted on the intake's
200. A notice holds counts, a state and destination labels.

## Local notifications

The app posts its own notifications for things it owns. There is no push
transport: household pushes keep arriving through the Home Assistant relay.

| What | Channel | Posted by |
|---|---|---|
| Playback | Media3's own | The media session. Exempt from the notification permission |
| "Recording a voice memo", with Stop | `daylight_recording` (low) | The recorder service; a foreground-service notification |
| "N inputs waiting to upload (Journal 2, Meal photo 1)" | `daylight_uploads` (low) | `quick-input`, after a pass that left inputs waiting |
| "N inputs were not accepted (Meal 1). Tap to retry, or discard them.", with a Discard action | `daylight_uploads` | `quick-input`, when inputs are parked |
| "This phone is not allowed to send to <label> yet. ..." | `daylight_uploads` | `quick-input`, after a 403 `device_not_allowed`; removed by the first input that destination accepts |
| "The daily allowance for <label> is used up. Sending resumes at about <day and time>. ..." | `daylight_uploads` | `quick-input`, after a 429, for each destination held |
| "N recordings were cut off and cannot be played. They are kept on this phone and not sent." | `daylight_uploads` | `quick-input`, while `memos/cutoff/` holds any |
| "Quick inputs are not set up: identity not configured. N inputs are kept on this phone (Journal 1)." | `daylight_uploads` | `quick-input` |

A notice is a count, a state and the label of a destination, never anything of
what an input holds. A tap opens a `daylight://` link through the link
activity, with the link key added by `notifications` where the link's kind
needs it. A notice may carry one action button, which opens such a link too. A capability posts through `LocalNotices` (`core/spi`); a state is
posted once, and the notice is removed when nothing is left to say.

`POST_NOTIFICATIONS` is asked for in the app, once, on Android 13 and later: the
record screen asks the first time a memo is made, beside the microphone. It is
never asked at install, and a "no" is not asked again. Recording does not depend
on the answer. `GET /notify/status` gives `{permission, channels}`.

How a relayed push can open a view: a push whose tap target is a household https
URL opens in the app once the host is turned on under "Open by default", and a
`daylight://bookmark/<id>` link needs no key. Without the key such a link opens
a bookmarked page only: the https URL's path, or the `path` of a
`daylight://open` link, must be exactly a configured bookmark's. A push that
should open any other page needs that page added as a bookmark (`bookmarks.1` to
`bookmarks.8`). A push cannot run an action, start a recording, open the camera or the text screen, or start playback:
those need the link key, which never leaves the phone and changes at every
start. Which field of the Home Assistant companion app
carries a tap target is not confirmed, and no producer sets one.

## Telemetry: what is tapped, kept until it is sent

Every native screen (Now playing, the phone home, the capture screens, the D-pad) is
watched by `shell-kit` `UiTelemetry`, installed by the first screen that opens; from
then on every activity of the app is covered without code of its own. It records:

| Event | Data |
|---|---|
| `ui.tap`, `ui.swipe` | `control`: the telemetry tag (`UiTelemetry.tag`), else the control's accessibility label, else its id; a swipe adds `direction` |
| `ui.screen.shown`, `ui.screen.hidden` | `visibleMs` on hidden |
| `player.stage`, `player.target`, `player.scrub` (`fromPct`, `toPct`), `player.swipe-skip`, `player.lyrics-seek`, `player.sleep`, `player.time-display`, `player.detail` (`waveform`, `quality`, `lyrics`), `remote.input` (`action`, `direction`, `status`) | Now playing's own; `target` is `local` or `screen` |
| `telemetry.dropped` | `count`, when the cap (below) threw old events away |

Each event carries an `id`, its own timestamp, and `context` `{app: "phone", component:
<screen>, sessionId}`. Controls whose labels would carry a title (queue rows, lyric
lines) are tagged, so titles stay out.

**Offline first.** An event is appended to `files/telemetry/open.jsonl` the moment it
happens; at 40 events, or when sending, the file is sealed as `batch-<n>.jsonl`.
Batches go oldest first through the payload's `telemetry` port (`core`
`TelemetryRelay`) to `POST /api/v1/client-log`, and a batch is deleted only when the
backend accepted it, so nothing is lost to no network, a killed app or a reboot, and
a repeat can be told by its event ids. Sending is tried when a screen goes to the
background, every 30 s while one is shown (doubling to 5 min while it fails), and when
a network comes back. With the app closed, a held batch schedules `TelemetryJob` (widgets,
a one-shot job needing a network) that starts the payload, sends, and runs again while
anything is still held. The store holds at most 1 MB; past that the oldest batches go
and the next batch reports how many events were lost. Logcat: `adb logcat -s
Daylight-Telemetry` (`telemetry sent: n batch(es)`, `telemetry kept for later`).

Reading it: `context.source:android AND _msg:"ui.tap" | stats by ("data.control") count()`
(see `__docs/reference/core/session-logging.md`).

## What the phone does not have

- **No control API and no lifeline.** Nothing listens on any address. The fleet CLI
  answers every command for `phone` with how it is debugged instead.
- **No debug tools**: no `debug-tools`, no `app-launcher`, no remote script, shell
  or screenshot.
- **No heartbeats and no log shipping.** Nothing about what is played or captured
  leaves the phone except the progress reports and the quick inputs' own uploads.
- **No lockdown**, and it is never offered as the home app.
- **No self-update** and no settings change at run time: a new build is installed.
- **No playback resumption** after the media service is gone: a headset button does
  not restart the last queue.
- **No queue for progress reports or `api:` actions**: with no connection they are
  dropped.

Debugging: `adb logcat --pid=$(adb shell pidof -s net.kckern.daylight.phone)` (tags
`Daylight`, `Daylight-Link`, `Daylight-Media`, `Daylight-Memo`, `Daylight-Input`,
`Daylight-Action`, `Daylight-Car`), and
`adb shell run-as net.kckern.daylight.phone` for `files/shell.log`,
`files/payloads/state/`, `files/memos/inbox/` and `files/inputs/inbox/`.

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
| `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE` | base, `webview-host`, `media-service`, `quick-input` | Reload and upload when a network returns |
| `RECORD_AUDIO` | `webview-host`, `quick-input`, `car-actions` | Voice inputs, on the phone and through the car's microphone. The trusted Call page can request it |
| `CAMERA` | `webview-host`, `quick-input` | Video calls, and the meal photo camera (asked in the camera screen; refused means the phone's camera app is used) |
| `MODIFY_AUDIO_SETTINGS` | `webview-host` | Page audio |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | `media-service` | The media library service |
| `FOREGROUND_SERVICE_DATA_SYNC` | `media-service` | The downloads kept on this phone (`KeepService`, type `dataSync`; needed from target 34) |
| `FOREGROUND_SERVICE_MICROPHONE` | `quick-input` | The recorder service |

The phone keeps meal photos in its own files and requires no media-library,
storage or location permission. Kiosk-only permissions include
`SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES` and `WRITE_SECURE_SETTINGS`.

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
- No component declares `showWhenLocked`, `turnScreenOn` or `showOnLockScreen`:
  the build and the verifier fail a personal build where one does. The one exception is
  `showWhenLocked` on the voice and photo capture path (`LinkActivity`, `RecordActivity`,
  `MealCameraActivity`, `PhotoCaptureActivity`), so a quick-settings tile can record a memo or
  take a meal photo with no unlock. The tile runs only voice and photo actions over the lock
  (`tile.N.lockok`); text, barcode and everything else still ask for the unlock.

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
| `ShareActivity` (`quick-input`) | Android's share sheet starts it for the app the owner is sharing from | No permission exists that only the share sheet holds. It takes `text/plain` only and sends nothing until the owner taps a destination. What it sends goes to a configured share route with this install's identity; the backend routes only a URL a handler takes, and plays it only on a configured screen |
| `ActionTileService$Tile1` to `$Tile4` | The system binds tiles | `BIND_QUICK_SETTINGS_TILE`: only the system can bind. They take no input from the caller |
| `KioskActivity` (`webview-host`) | It is the launcher icon | It reads nothing from the intent that starts it. It shows nothing over the lock screen and has no lock task |
| `MainActivity` (shell) | Not exported on the phone | Another app could otherwise start it to put the battery-exemption screen and permission prompts in front of the owner |
| `BootReceiver` (shell) | Boot and package-replaced broadcasts, and the app's own keep-alive alarm | Whatever it is sent, all it ever does is start the shell service |
| `DaylightMediaService` (`media-service`) | A car, the system's media controls and Bluetooth bind it | No permission exists that only they hold. `ControllerPolicy` accepts this app, a system uid, a platform-signed package and a package whose certificate is pinned, each checked against the caller's uid, per connection. A controller hands over media ids; what plays is the backend's answer |
| `CarHostGateService` (`car-actions`) | Android Auto binds it | No permission exists that only Android Auto holds. Every transaction is judged by its own calling uid (`CarGate`): only Android Auto's package, owned by that uid and signed with the certificate pinned in `car.hostPins`, gets through to the library's binder; every other transaction is refused before the library reads it |
| `DaylightCarAppService` (`car-actions`) | Not exported | The Car App Library's service; bound only by the gate, in process |
| `ButtonWidgetConfigActivity` (`widgets`) | The launcher starts it when a one-action button is placed | No permission exists that only a launcher holds. It reads the widget id, uses it only when Android says that widget is this app's button, lists the action labels and stores the owner's choice. It runs nothing |
| `ActionWidgetProvider`, `ButtonWidgetProvider` | Not exported | Reached by the system's widget host and by the app only |
| `PlayActivity`, `RecordActivity`, `TextInputActivity`, `PhotoCaptureActivity`, `CaptureStatusActivity`, `MemoRecorderService` | Not exported | Started by this app only, by the payload on a keyed link |
| `PlayActionService` (`media-service`) | Not exported | Started by this app's own widget buttons (an immutable `PendingIntent`) and tiles. Reads one action id; the payload decides what it plays |
| `InputFileProvider` (`quick-input`) | Not exported | Reached by the camera app through a grant for the one file of a capture, made by the photo screen and withdrawn when the camera returns. Grants are limited to `/capture/` in the manifest, and the provider serves a capture file's exact name and nothing else |
| `PinResultReceiver` (`one-tap-actions`) | Not exported | Reached only through the immutable, one-shot `PendingIntent` the payload hands `requestPinShortcut`, which the system sends once the owner has pinned a media shortcut. It passes a single-use token to the payload and nothing else |
| `CarAppPermissionActivity`, `CarAppNotificationBroadcastReceiver`, `CarAppMetadataHolderService` (Car App Library) | Not exported (the last also disabled) | Merged in by the library; named in `car-actions`' `libraryComponents:` and the verifier's table |
| `ShellService`, `InstallReceiver` | Not exported | |

Thirteen components are exported: `LinkActivity`, `ShareActivity`, `KioskActivity`,
the four tile services (which the system alone can bind), `DaylightMediaService`,
`MediaButtonReceiver`, `CarHostGateService`, `ButtonWidgetConfigActivity`,
`PhoneHomeActivity` and `BootReceiver` (`tools/phone-list.test.mjs`). A fourteenth,
or one of these no longer exported, fails the build. Sharing from other apps added
one component, `ShareActivity`, which is exported, and no permission; the verifier
counts 33 components in the build (shell 114). The car screen added
five components (the exported gate, the closed car service behind it and the
library's three closed ones) and no permission to the list: it declares `RECORD_AUDIO`
for the car's microphone, which `quick-input` already brings, so the list is still
twelve. The quick inputs added three components (two
activities and a provider) and none of them is exported. The one-action button
added two: its provider, which is not exported, and its chooser, which is. It
added no permission. Playing with no window added one, the play service, which is
not exported, and no permission (it is a `mediaPlayback` foreground service, and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` was already declared). Recording a pin only on
the owner's confirmation added one, its receiver, which is not exported. In all, 27
components.

## Not covered by JVM tests

- Everything Android does with the manifest: whether the launcher lists the app
  once, whether the phone ever offers it as a home app (the manifest has no HOME
  filter; the verifier and a `buildSrc` test check that), link resolution, the
  tile and widget hosts.
- `LinkActivity`, `ActionTileService`, `ActionWidgetProvider`,
  `ButtonWidgetProvider` and `ButtonWidgetConfigActivity` themselves. Their
  decisions are in pure classes that are tested (`LinkRequest`, `LinkAnswer`,
  `TileFace`, `WidgetButtons`, `ButtonFace`); the Android calls around them are
  not: the widget host, the chooser's list, what Android answers for a widget id.
- `KeyedRows` moving real views, `PlaylistArtwork`'s `LruCache`, `FailureWords`'
  network check and the screens that use them (`BrowseActivity`, `DownloadsActivity`,
  `PhoneHomeActivity`, the link activity's card). Their decisions are in `RowDiff`,
  `CoverCache`, `FailureWords.cause`, `PayloadReady`, `LinkLabel`,
  `CaptureScopeWait.step` and media-service `FailureReason`, which are tested.
- `AndroidSurfaces` and `AndroidWidgetSink` against a real launcher. On the JVM
  they are started over a context with no shortcut service and no widget host,
  which shows only that they do nothing and do not throw there.
- `DaylightMediaService`, `LibraryCallback`, `PlaybackEvents`, `PlayActivity`,
  `PlayActionService`: the Media3 player and session, audio focus, the media
  notification, the foreground states, a car. Their decisions are in pure classes
  that are tested (`ControllerPolicy`, `BrowseAnswer`, `TrackAnswer`,
  `PayloadMedia`, `PlayStart`, `DirectPlay`).
- `TextInputActivity`: the window, the keyboard, the field's filter as Android
  calls it, what the recents screen shows. Its decisions are in `TextDraft` and
  `CaptureFiles`, which are tested.
- `PhotoCaptureActivity`, `InputFileProvider` and `AndroidPixels`: whether the
  owner's camera app accepts the file it is handed and in which mode it opens
  it, the grant and its withdrawal, the decoding, turning, scaling and encoding
  of a real photo and the memory that takes, the rebuild of the screen after the
  process was ended behind the camera. Their decisions are in `PhotoPlan`,
  `JpegCheck`, `CameraAsk` and `CaptureFiles`, which are tested with made-up
  files. Record physical camera review and upload separately.
- `MemoRecorderService` and `RecordActivity`: the microphone, the encoder (Ogg/Opus,
  and the AAC fallback), the foreground service, the
  permission dialogs, a rebuild of the screen. Their decisions are in
  `RecorderMachine`, `MemoFiles`, `MemoRecovery` and `PermissionAsk`, which are
  tested. Playability after interruption requires a phone check.
- `CarHostGateService`, `DaylightCarAppService`, `ActionsScreen`, `RecordScreen`,
  `CarRecorder` and `CarMemoWriter`: Android Auto binding the gate, the forward to
  the library's binder, the templates on a head unit, the car's microphone, the
  Opus or AAC encoder and the muxer. Their decisions are in `CarGate`,
  `CarHostPolicy`, `GateLink`, `CarSessionKey`, `CarAnswers`, `CarMemo`, `CarList`
  and `PayloadCar`, which are tested.
- `PinResultReceiver` and the result intent of `requestPinShortcut`: whether a
  launcher sends it, and sends it for an immutable `PendingIntent`. The decisions
  (token, slots, limits, unrecorded shortcuts) are tested in `SurfaceRoutesTest`,
  `PinnedMediaTest`, `SurfacePlanTest` and `PinConfirmationTest`.
- `AndroidNotices`: a notification on a screen. On the JVM it runs over a context
  with no notification service, which shows only that it does nothing there.
- The backend's side of every media and quick-input request. The tests use a fake backend
  to exercise request and response handling. Use the paired deployment for outcome checks.
- That nothing listens on a real phone. The tests start the payload for the phone's
  configuration and show no control socket is bound and the port stays free; the
  shell's decision not to start a lifeline is one line that reads the same value
  and is not exercised on the JVM.

## Shortcut icons

Launcher shortcuts and tiles draw one glyph per action on a tile coloured by kind (`ActionTint`): journal blue (notebook, mic), meals orange (fork, camera, barcode), health rose, media purple, anything else the app green. The icon name is the third field of each `actions.N` line in `devices/phone.yml`. The default tiles are journal voice, meal voice, meal photo and meal barcode. The launcher draws its own small app badge on every pinned shortcut; an app cannot remove it.

## Polish, shell 180 (2026-11-26)

From screenshot review of build 150 and the design sweep
(ops:docs/_wip/audits/2026-11-26-phone-design-sweep.md).

- **Book page.** A book's or series' parts show their number in a quiet 48 dp square
  ("1", "2" …) instead of the book's cover on every row; a part with its own picture keeps
  it (`BrowseTree.ownArt`: a part whose thumb is its album's has none). Lengths use one
  format: "9 min", "1 h 12 min", "2 h" (`RowLine.spokenLength`), never "8:47". The action
  row's Chapters button is the chapters glyph ("Chapters of <book>"), not the queue's: a
  book offers no queue verbs. An open detail page re-reads its keep every 2 s and redraws
  its header when it changes, so Keep on a book kept automatically stops saying "Kept
  automatically" at once. A page opened by a link with no name (`daylight://media/book/<id>`)
  takes its title, by-line and cover from home's info (`About.title`, `byline`), never
  "Library"; the Mark finished prompt never shows an empty name.
- **Now playing on a book, talk or course** (`TitleLines`): the title is the current
  chapter's own name (a bare "Chapter 4" stays on the chapter line; a title some taggers
  wrap in quotes is read without them, `Chapters.unquoted`), else the part's, then the book's title, then the author, the author's line
  moved under the book's; a line equal to another is dropped ("Paradise - Benedict Flynn
  translation" shows once, with no blank line left for the book). The quality line is music's only. The status line is muted ink,
  with the on-this-phone glyph before "Playing from this phone"; a failure keeps the
  attention colour.
- **Home.** Browse library, the Player rows (Now playing, Drive playlists, Driving Radio,
  Widget on Home) and the Connect rows (each screen's remote, Freematics) are flat 64 dp
  rows: a muted glyph, the name, what it does, a chevron. **Continue listening** is one row
  per book (above). **Review N older items**: entries home has no listened time for are
  not guessed; a one-time row at the top of Continue opens a sheet of them, each with Keep
  and Clear, and Clear all. Once the sheet has been opened the row does not come back;
  undecided entries stay listed as they are.
- **Capture screens** (D10): one full-width filled primary at the bottom (Send, Done), an
  8 dp rectangle (`CaptureUi.primary`); a capture's Try again, Replace and View are text
  buttons at the end of its row (`CaptureUi.textButton`); the capture list is flat rows;
  links are muted ink. **Share** chooses its destination with choice chips (the default
  chosen) and sends with one "Send to <destination>".
- **Switches** (D11): the widgets sheet's on/off rows are flat rows with a standard
  `Switch` tinted from the theme (`Toggle.create`); its buttons are rectangles, not pills.
- **On this phone** (D12, `DownloadsActivity`): a kept item is a flat row whose end icon
  shows its state (`KeepRowState`): kept (accent), downloading, paused, waiting, or an error
  whose icon retries when tapped. Try again, Resume download, Pause download, Use mobile
  data once and Remove from this phone are in the row's ⋮ item sheet (a tap on the row
  opens it too), Remove last. Remove finished and Remove all are in the top bar's ⋮.
- **No brand** (D16). The app's own words say what happens: "Starting up…", "Quick inputs
  aren't set up on this phone", "That link has expired. Try it again from the app",
  "Sharing isn't set up on this phone yet". Tiles and widget fallbacks are "Action 1–4",
  "Playlist" and "Open"; the widgets are "Actions" and "Playlist"; the notification channel
  is "General". The device file's `label:` (default "Home", at most 30 characters; buildSrc
  `DeviceSpec.label`) is the manifest's `${appLabel}`: the application, the share target and
  the kiosk activity. At run time the notification channel group, the shell's notice and the
  car's title read the installed app's label. Code identifiers, `X-Daylight-*` headers, log
  tags and theme names keep the name.
- **Listened time.** Each progress report carries the speed played (`rate`, when not 1) and
  this payload run's `sessionId`, so home measures listened time between consecutive
  reports of one session at the real speed (lookup spec §13; the backend side is in
  `__docs/reference/media/media-app-technical.md`).

