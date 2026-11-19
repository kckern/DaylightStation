# Phone build: on-device acceptance

**Nothing in this checklist has been run.** The phone build passes its unit tests,
lint and the build verifier, and has never been installed. Every expectation below
is from Android's documentation and from the backend's code as read. Mark each line
"verified on the phone, <date>" or write down what happened instead. A line that
was not run is "not run".

See the [phone capabilities](../../reference/android/phone.md) and [build instructions](../../../_extensions/daylight-android/README.md).

Needs the owner's go-ahead before step A2. What installing does: the package
`net.kckern.daylight.phone` is added to the owner's phone with a persistent
"Daylight" notification, four quick-settings tiles the owner may add, two widgets
(four buttons, and a one-action button), launcher shortcuts, and a list of actions
in Android Auto. `adb uninstall net.kckern.daylight.phone` removes all of it,
including any quick input (a recording, typed text, a photo) not yet uploaded.

There is no control API on the phone. Every check is by hand on the phone, or over
adb:

```bash
adb logcat --pid=$(adb shell pidof -s net.kckern.daylight.phone)
adb shell run-as net.kckern.daylight.phone cat files/shell.log
adb shell run-as net.kckern.daylight.phone cat files/payloads/state/input-queue.json
adb shell run-as net.kckern.daylight.phone ls -l files/memos/inbox      # recordings
adb shell run-as net.kckern.daylight.phone ls -l files/inputs/inbox     # typed text and photos
```

The queue file names every waiting input by its id, kind and destination. It never
holds what was said, typed or photographed; the files in the two inboxes do, so do
not copy them off the phone for a check that a listing answers.

The link key is needed to send a keyed link from adb. It is in
`files/payloads/state/link-key` and is replaced every time the payload starts, so
read it again after a force-stop or a restart. Read it with `run-as` (a debug
build) into a shell variable and do not paste it anywhere. It goes in the link's
fragment:

```bash
K=$(adb shell run-as net.kckern.daylight.phone cat files/payloads/state/link-key)
adb shell am start -a android.intent.action.VIEW -d "'daylight://input/queue#k=$K'"
```

## First install, in one sitting

The order to walk the sections in on the first evening, with a laptop on adb and
the Desktop Head Unit at hand. Each step names the lines it covers; record each
line as it is walked.

1. **Before installing.** The household config binds the phone's device key to the
   owner for the Journalist and Nutribot (F, first paragraph), and the backend
   intakes of the quick-input contract are deployed. Without them every quick input
   waits with a notice, which is itself step F16.
2. **Install and open** (A1 to A7).
3. **Views and links** (B, B2).
4. **Tiles, shortcuts and widgets**, warm and then cold (C1 to C11), including a
   one-action button on a cold process (C7) and "On my way" (C10).
5. **Quick inputs, online**: Journal and Meal by voice (F1, F2, F18), Journal note
   and Meal note (F2.1, F2.2, F2.10), Meal photo (F3.1, F3.2).
6. **Quick inputs, offline**, airplane mode on and then off: F7 (Journal voice),
   F18b (Meal voice), F2.8 (Journal note), F2.11 (Meal note), F3.3 (Meal photo).
   The rest of F, F2 and F3 after that, as time allows.
7. **Notifications** (G).
8. **Playback and pinning**: D, then D3 1 to 14 (pin a playlist from the Media
   page), then D2 with the pinned action.
9. **The car**, on the Desktop Head Unit: E1 to E12 (media, and the first-connection
   pin of `media.controllerPins`), E2 1 to 7 (the car list, and the first-connection
   pin of `car.hostPins`, which needs a rebuild and reinstall), E3 1 to 11 (a voice
   memo from the car).
10. **A relayed push** (H), then record the results (I).

## The open questions, and which line answers each

From the plan's list of what was unverified; each is answered only on the phone.

| # | Question | Lines |
|---|---|---|
| V4 | Android Auto lists a sideloaded IOT-category app (Car App Library 1.3.0-rc01) with unknown sources on | E1, E2.1, E2.2 |
| V5 | A widget's tap may start the media foreground service (play with no window) | D2.1, D2.2, C7 |
| V6 | The system camera app returns a full-size photo to the app's content URI | F3.1, F3.2, F3.7, F3.11 |
| V7 | The launcher accepts a 1x1 widget with a configuration activity, and pinning a shortcut from the Media page | C5 to C8, D3.2 to D3.4 |

## Each quick input, online and offline

| Destination | Kind | Online | Offline, then back online |
|---|---|---|---|
| `journal` | voice | F1, F2 | F7, F8 |
| `meal` | voice | F18 | F18b |
| `journal-note` | text | F2.1, F2.2 | F2.8 |
| `meal-note` | text | F2.10 | F2.11 |
| `meal-photo` | photo | F3.2 | F3.3 |
| `journal`, from the car | voice | E3.3 | E3.11 |

## A. Install and first run

1. Record the phone's model and Android version (`adb shell getprop ro.product.model`,
   `adb shell getprop ro.build.version.release`).
2. `adb install -r shell/build/outputs/apk/phone/debug/shell-phone-debug.apk`.
   Confirm the sideload is accepted. If it is refused, or Play Protect interrupts,
   record the exact message. The build targets SDK 33; a later Android may want
   `--bypass-low-target-sdk-block`.
3. Open Daylight from the launcher. The setup screen offers service shortcuts, capture shortcuts and **Play a playlist**. Add Health and confirm Android placement. After leaving Daylight, tap Health directly on Android Home. Record placement and launch separately. The launcher lists
   the app once, and the phone does not offer it as a home app.
   `adb shell am start -n net.kckern.daylight.phone/net.kckern.daylight.shell.MainActivity`
   is refused: the setup activity is not exported.
4. `files/shell.log` has a `CONTROL control.bind is none: no control server` line.
   `adb shell run-as net.kckern.daylight.phone sh -c 'cat /proc/net/tcp /proc/net/tcp6'`
   (or `ss -ltn` where the phone has it) shows no listening socket of the app.
5. In the phone's settings for the app, under "Open by default", turn on the
   household site's host. An https link to the site in another app then opens in
   Daylight.
6. Restart the phone. Without opening the app, the "Daylight" notification is back.
7. Record how long a cold payload takes: force-stop the app, tap a tile, and read
   the time from the tap to the page or the message, with logcat open. The link
   activity waits eight seconds.

## B. Views, bookmarks, links

1. `adb shell am start -a android.intent.action.VIEW -d 'daylight://bookmark/media'`:
   the Media page opens in the app.
2. `adb shell am start -a android.intent.action.VIEW -d 'daylight://open?path=//evil.example/'`:
   a message, no navigation, and a `LINK refused` line in the shell log.
3. `daylight://action/journal`, `daylight://memo/new`,
   `daylight://input/voice?to=journal`, `daylight://input/text?to=journal-note`,
   `daylight://input/photo?to=meal-photo` and `daylight://media/play?id=plex:1`
   with no key: each refused with a message. No recorder, text screen or camera
   opens.
4. `daylight://open?path=/media` (a bookmarked page) opens; `daylight://open?path=/admin`
   and `daylight://open?path=/media?tab=1` with no key are refused; the same two
   with `#k=$K` open.
5. The key in the query is not a key: `daylight://action/journal?k=$K` and
   `daylight://input/photo?to=meal-photo&k=$K` are refused.
6. After each of the above, `adb logcat -d | grep 'dat=daylight'` shows no line
   that holds the key.
7. Force-stop the app, read the key again: it differs from `$K`. A link with the
   old key works within a minute of the start and is refused after it.
8. Back from a page steps through the page history and then leaves the app.

## B2. The lock screen, the microphone and the camera

1. Open the app, lock the phone, wake it: the lock screen shows, and the site is
   not visible until the phone is unlocked.
2. From another app or adb, with the phone locked, send
   `daylight://bookmark/call`: nothing of the site shows over the lock screen.
3. Unlocked, send `daylight://bookmark/call` from adb: the call page opens and
   the microphone and camera are not in use (no indicator in the status bar);
   Android should not offer access to this external link.
4. Tap the configured Call widget. Allow the requested microphone and camera permissions
   while using Daylight. Verify local preview, audio and video with a willing call partner.
   Deny one permission on a separate attempt and verify **App settings** opens Daylight’s
   permissions screen via **Permissions**. Return to Call and retry after granting access.

## C. One-tap surfaces, warm and cold

1. Long-press the app icon: Journal voice, Meal voice, Meal photo, Journal text (a launcher
   shows about four; record how many this one shows). Each does its thing.
   Drag one to the home screen (a pinned shortcut), force-stop the app, and tap
   it: it works on the cold start and again a few minutes later, after the key
   has been replaced.
2. Add the "Daylight 1" tile. It reads "Journal voice". Tap it unlocked, and from the
   lock screen (it asks for the unlock first). "Daylight 2" to "Daylight 4" read
   "Meal voice", "Meal photo" and "Journal text".
3. Add the "Daylight actions" widget. Four buttons (Journal voice, Meal voice, Meal photo,
   Media), each works. There is no Feed button anywhere.
4. Cold: `adb shell am force-stop net.kckern.daylight.phone`, then tap the widget's
   Media button. The page opens within the wait, or "Daylight is still starting"
   shows and the next tap works.

5. Add a "Daylight button" widget (one cell). The chooser opens and lists Journal voice,
   Meal voice, Meal photo, Journal text, Meal text, Media, Call, On my way. Pick Journal voice: the
   button shows a microphone and "Journal voice", and a tap opens the recorder. Record
   whether the launcher offered the widget at one cell and what it looks like.
6. Back out of the chooser without picking: no widget is placed.
7. Add a second button and pick Media. Force-stop the app and tap each button:
   each works on the cold start, and again a few minutes later (the key was
   replaced at the start and the buttons were redrawn with the new one).
8. Long-press a button: on Android 9 and later its menu offers to reconfigure
   it. Pick another action; the button changes.
9. The chooser cannot be used from outside for anything but its list:
   `adb shell am start -n net.kckern.daylight.phone/net.kckern.daylight.cap.widgets.shell.ButtonWidgetConfigActivity --ei appWidgetId 99999`
   closes at once (`adb logcat -s Daylight-Widget` says the widget is not a
   Daylight button), and the same with no id.
10. "On my way": add a one-action button and pick On my way. A tap shows "Location
    sharing is not built yet" and nothing else happens: no permission prompt, and
    Settings > Apps > Daylight > Permissions lists no location permission.
11. Uninstalled-payload state: after `adb shell pm clear net.kckern.daylight.phone`
    add a button before opening the app. The chooser says it has no actions yet;
    after the app has been opened once, adding a button lists them.

## D. Native playback

Pick the content id of a music track and of an album from the Media page.

1. `adb shell am start -a android.intent.action.VIEW -d "'daylight://media/play?id=<track id>#k=$K'"`:
   audio plays within eight seconds; a media notification appears; nothing visible
   stays on top of the screen afterwards.
2. Lock-screen controls work. A headset button pauses and resumes. Unplugging
   headphones (or switching Bluetooth off) pauses.
3. The same with the album's id: the album queues from its first track, and next
   and previous work.
4. A phone call during playback pauses it; it resumes or stays paused as Android
   decides, and nothing crashes.
5. Seek within a long file. If the position jumps back to the start, the stream
   does not serve byte ranges: record it.
6. Progress: after a minute of play the item shows as in progress in the Media
   page's recent list. On the backend, the log store has `play.log` events about
   ten seconds apart. If they carry a `spot_device_unknown` warning, the household's
   `devices.yml` has no `phone` entry: reports are saved with no per-screen spot.
7. An audiobook that was half played elsewhere starts where it was left.
8. Turn the VPN off in the middle of a track: the buffered part plays, then the
   player stops. Turn it on: play resumes on request.
9. A video's content id: "Could not start playback", no crash.
10. Swipe the app away while playing: playback goes on. Pause, swipe it away: the
    media notification goes.
11. From another app's media browser, if one is at hand (a generic media controller
    test app): it is refused. `adb logcat -s Daylight-Media` has
    "refused media controller <package>: no pin for this package".
12. The lock-screen and notification-shade controls worked in step 2. If they did
    not, the same log names the system UI's package with a reason: record it. A
    system UI that is not platform-signed is pinned as in E3.

13. Queue two tracks shorter than five seconds and let both finish. Check the backend
    for exactly one final `play.log` at 100 percent per track. Repeat and press Next
    before the first track ends. Only the second track has a report with
    `naturalEnd: true`.
14. From an allowed media controller, set a list of two items and request item 2
    at 1234 ms. The second item starts at that offset, including when the first
    input item expands to several tracks. With an explicit offset of zero, the
    selected item starts at its beginning. Request a saved audiobook chapter with
    start position unset and check that playback still starts at its saved position.

## D2. Playing with no window

The phone's device file has no `media:` action (content ids are household data).
For this section either pin one from the Media page (section D3), or add a line
such as `actions.8: "radio|Radio|play|media:<a playlist's content id>"` to a local,
uncommitted copy of `devices/phone.yml`, bump `shell.versionCode`, build and
install.

1. Put the action on a "Daylight button" widget. Tap it with the app in the
   background: audio starts, the app's window does not come to the front, a
   "Starting playback" notice shows briefly and the media notification stays.
   `adb logcat -s Daylight-Media` has `play action <id>` and no content id.
2. The same from a cold process (`adb shell am force-stop net.kckern.daylight.phone`
   first). Record the time from the tap to sound, or "Could not start playback".
3. The same with the phone locked, from a widget on the lock screen if the launcher
   has one; record what happens.
4. Put the action on a tile and tap it. On Android 12 and later record whether it
   played with no window or went through the invisible play screen (`adb logcat -s
   Daylight-Tile` has "slot <n> plays through the link" when Android refused the
   start).
5. A launcher shortcut of the same action goes through the invisible play screen,
   as before.
6. Look for `ForegroundServiceStartNotAllowedException` and "Android refused the
   media service's foreground start" in logcat after each step, and record them.
   With the second line present, audio must still play, and the "Starting
   playback" notice stays until it stops.
7. The play service cannot be reached from outside:
   `adb shell am startservice -n net.kckern.daylight.phone/net.kckern.daylight.cap.mediaservice.shell.PlayActionService --es action radio`
   is refused (not exported).

## D3. Pinning media from the site

Needs the web side's "Add to home screen" control in the Media page's full-screen
view. Until it exists, the calls can be made from Chrome's remote inspector
(`chrome://inspect`, the debug build's WebView) on the Media page:
`daylight.canPinMedia()` and `daylight.pinMedia({contentId: "<a playlist's id>", label: "Test"})`.

1. `daylight.canPinMedia()` is `true` on the Media page. Record the launcher.
2. `pinMedia` with a playlist's content id: `{accepted: true}`, and Android's "Add
   to home screen" dialog shows. Add it. The shortcut shows the label; a tap plays
   the playlist (through the invisible play screen).
3. Add a "Daylight button": the chooser lists the label after the configured
   actions. Bind it; a tap plays with no window (as D2).
4. Cancel the dialog on a second pin: no shortcut, and the chooser does not list it
   (a pin is recorded only when the launcher confirms the owner added it). Then pin
   again and add it: the chooser lists it within a moment. If the chooser never lists
   a pin that was added, the launcher did not send the confirmation: record the
   launcher and `adb logcat -s Daylight-Action`.
5. Call `pinMedia` twice within five seconds: the second answers
   `rate_limited`, and only one dialog shows.
6. `pinMedia({contentId: "https://evil.example/x", label: "x"})` answers
   `invalid_content_id`; a label holding `\u202E` answers `invalid_label`. No
   dialog.
7. In an iframe of the page (the inspector's frame selector), `canPinMedia()` is
   `false` and `pinMedia` answers `not_top_frame`.
8. Force-stop the app and tap the pinned shortcut a few minutes later: it still
   plays (it was rewritten under the new key).
9. The answer never holds a link: `JSON.stringify(daylight.pinMedia(...))` has only
   `accepted` and `reason`.
10. Reload the page between calls and call `pinMedia` four times within a minute
    (waiting five seconds between them): the fourth answers `rate_limited`.
11. Remove a pinned media shortcut from the home screen, then reopen the app: the
    chooser no longer lists it.
12. With 24 pinned media shortcuts (once, if practical), a 25th answers
    `limit_reached` and none of the 24 is disabled.
13. Ask for a pin, force-stop the app while the dialog is open, then add the shortcut.
    The chooser does not list it, the shortcut stays enabled after the app is opened
    again, and a tap on it shows "This shortcut was not saved. Remove it and pin it
    again from the Media page".
14. Ask for three pins in a row and dismiss each dialog. A fourth request within ten
    minutes answers `rate_limited` (at most three dialogs are open at once); after
    one of the three is confirmed instead, a new request shows its dialog.

## E. Android Auto, on the Desktop Head Unit

1. On the phone: Android Auto's settings, tap "Version and permission info" ten
   times, accept developer mode. In the three-dot menu open the developer settings
   and turn on the option for apps from unknown sources. Record its exact label.
2. On the workstation: install "Android Auto Desktop Head Unit Emulator" from the
   SDK Manager's SDK Tools tab. On the phone, Android Auto's three-dot menu, "Start
   head unit server". Then:

   ```bash
   adb forward tcp:5277 tcp:5277
   cd "$ANDROID_HOME/extras/google/auto" && ./desktop-head-unit
   ```

3. **The first connection from the car is refused by design.** Daylight is among
   the media apps but its tabs do not load. Read the refusal:

   ```bash
   adb logcat -d -s Daylight-Media | grep 'refused media controller'
   ```

   The line names the package that tried and ends with the entry to add:
   `<package>=<sha256>`. Check that the package is the one expected (Android Auto
   is `com.google.android.projection.gearhead`; the Google app, for Assistant, may
   appear too). Add the entry to `media.controllerPins` under `defaults:` in
   `devices/phone.yml` (several entries are separated by commas; a digest is a
   public value), bump `shell.versionCode`, rebuild, run the verifier and install.
   Reconnect: the tabs are the `media.roots` entries. Record each package and
   reason seen. A reason other than "no pin for this package" is a finding:
   "the package is not the caller's" for the real Android Auto means the app
   cannot see the package that binds it.
4. Browse into a container and play a track. The rest of the container follows.
5. A container with more than fifty entries ends in "More (51 to 100 of N)", and
   that entry opens the next page.
6. Record whether browse entries and the now-playing card show artwork.
7. Cold: quit the head unit, force-stop the app, start the head unit again and open
   Daylight in it without touching the phone. Expected: the tabs load, or one tab
   "Daylight is starting" that is replaced by the real ones within two minutes. If
   neither, record the logcat lines around `ForegroundServiceStartNotAllowedException`.
8. In the head unit's console, `keycode media_play_pause` and `keycode media_next`
   control playback.
9. Progress reports continue while playing through the head unit (as D6).
10. Voice search: on the head unit, the search (magnifier) or the voice button,
    "search for <an album you know>": results appear, an album opens, a track
    plays. `adb logcat -s Daylight-Media` has "search, <n> characters, <m> results"
    and never the words.
11. "Play <a track you know> on Daylight": it plays. Record what Android Auto said
    if it did not, and the logcat lines around "play from search".
12. A search with no result answers an empty list, and nothing crashes. With the
    VPN off, the search fails and the car says so.

## E2. The car list (car-actions), on the Desktop Head Unit

Unproven until this runs: whether Android Auto lists a sideloaded app of the IOT
category built on Car App Library 1.3.0-rc01. Record the result either way.

1. With the head unit running (E, step 2), open the app list on the head unit. Record
   whether "Daylight" appears a second time as a non-media app. If it does not: check
   that the unknown-sources developer setting is on, look in the head unit's full
   app list, and read `adb logcat -d | grep -i -E 'CarApp|Daylight-Car'`. Record what
   was seen; the next step (a newer library and compileSdk 34) is the owner's call.
2. **The first connection is refused by design, and that is the pinning step.** Open
   the car list: Android Auto reports the app could not start (every call it makes is
   refused at the gate, `CarHostGateService`, until its certificate is pinned).
   Record exactly what the head unit shows. If Android Auto does not list the app at
   all even after pinning, record it: whether it accepts a car app whose intent filter
   is on the gate (a plain service, not a `CarAppService` subclass) is unproven. Read
   the refusal:

   ```bash
   adb logcat -d -s Daylight-Car | grep 'refused car host'
   ```

   It must name `com.google.android.projection.gearhead` with "no pin for this
   package" and end with `To allow it, add com.google.android.projection.gearhead=<sha256> to car.hostPins`.
   Any other package or reason is a finding: record it and do not pin it. Copy the
   entry into `car.hostPins` under `defaults:` in `devices/phone.yml` (a digest is a
   public value), bump `shell.versionCode`, rebuild, run the verifier, install.
3. Reconnect. The list reads "Journal" and "On my way". Tap On my way: a car toast
   "Location sharing is not built yet", and nothing else (no permission prompt on
   the phone).
4. Cold: quit the head unit, `adb shell am force-stop net.kckern.daylight.phone`,
   start the head unit and open the car list. Expected: the list, or one row
   "Daylight is starting" that is replaced by the list within two minutes.
5. Another app cannot drive the car screen. This needs a small test app that binds
   `net.kckern.daylight.phone/net.kckern.daylight.cap.caractions.shell.CarHostGateService`
   with the action `androidx.car.app.CarAppService` and calls `getManager("app", ...)`
   on what it gets; none is in this repository. If one is at hand, run it with the
   head unit connected: every call fails, `adb logcat -s Daylight-Car` has one
   "refused car host <package>: the binding app is not Android Auto" line a minute,
   and the head unit's list keeps working. Otherwise record "not run".
6. Opening, refreshing or reconnecting the list runs nothing: `adb shell run-as
   net.kckern.daylight.phone cat files/shell.log | grep CAR` shows a "run" line
   only after a tap.
7. While driving (the head unit's "driving" state, if the version offers it), the
   list stays usable: rows only, no text field.

### E3. A voice memo from the car

Unproven until this runs: everything about the car's microphone (Car API level 5
for an IOT app on this library, what the PCM is, the encoder's file).

1. First grant the microphone on the phone: record one memo with the phone's
   Journal tile and allow the prompt.
2. On the head unit, tap "Journal" in the car list. The car's screen reads
   "Journal", "Starting", then "Recording 0:01" counting up, with one Stop action.
   Record whether the clock moves every second or less often. The Desktop Head Unit
   takes its microphone from the workstation; record which one it used.
3. Speak for about ten seconds, tap Stop. A car toast "Saved for Journal"; the list
   is back. `adb shell run-as net.kckern.daylight.phone ls -l files/memos/inbox`
   shows the memo (or the queue already took it); `adb logcat -s Daylight-Car` has
   "car memo began, OGG_OPUS" (or MP4_SEGMENTS) and "ended after <n> s, kept", and
   no words. It arrives in the Journalist like a memo recorded on the phone.
4. Lock the phone and record again from the head unit: it records and arrives.
5. A tap on Journal and Stop within a second: "Not saved: too short or nothing was
   heard", and nothing is queued.
6. Back out of the recording screen while recording: it is saved.
7. Disconnect the head unit while recording: the memo is saved or, if the process
   was killed, recovered at the next start (an Ogg file becomes a memo).
8. Revoke the microphone in the phone's settings and tap Journal: a car toast "Allow
   the microphone on the phone first", and nothing records.
9. Opening, refreshing or reconnecting the list never starts a recording: the shell
   log and logcat have no "car memo began" without a tap.
10. Leave one running for thirty minutes (once): it stops by itself and is saved.
11. Offline: with the phone's network off (airplane mode on the phone, Bluetooth on
    for the car if the head unit allows), record from the car and stop. The notice
    on the phone names Journal 1. Network back on: it uploads and arrives in the
    Journalist.

## F. Voice inputs (the recorder)

Before the first input: the household config must bind this phone's device key
(`identity.device`, default `fleet:phone`) to the user, for each bot
(`quick_input: { journalist: [...], nutribot: [...] }` on the device entry). Until
it does, step 2 shows the "not allowed yet" notice instead of an upload (see step
16). The backend must also have the intakes of the quick-input contract deployed
(`/api/v1/journalist/voice`, `/text`, `/api/v1/nutribot/voice`, `/text`, `/photo`).

The steps below use the Journal button. Step 18 repeats the first two for Meal.

1. Tap "Journal voice". The first time, the phone asks for the microphone and then for
   notifications; both dialogs stay up long enough to answer. Speak for ten
   seconds, "Stop and save".
2. Within a few minutes the transcript and the Journalist's reply arrive in the
   owner's Telegram conversation. `input-queue.json` shows `uploaded: 1` and no
   input; the inbox is empty. Record the entry's time in the journal: it is the
   time the recording started, not the upload time.
3. While recording: the notification is up and shows a running clock; its Stop
   action ends and saves the memo with the record screen closed.
4. While recording, tap the memo tile again: the memo stops and is saved.
5. While recording, more than two seconds in, turn the phone, and switch dark
   mode on and off. The record screen comes back showing the clock, and the
   recording goes on. (Before the fix this stopped and saved the memo.)
6. Pull one recording from the inbox with airplane mode on and record how it
   sounds and its size per minute. On Android 10 and later it is `<id>.journal.ogg`,
   Opus at 16 kHz and 32 kbit/s; if logcat says the recorder did not start at
   16000 Hz, the 48 kHz fallback was used.
7. Airplane mode on. Record two memos. A notice says two are waiting. Airplane
   mode off: both upload without opening the app, one after the other, and the
   notice goes. Their journal entries carry the times they were recorded.
8. Record a memo with airplane mode on, restart the phone, airplane mode off: the
   memo uploads.
9. **Cut-off recording.** Start a memo, speak for thirty seconds, and force-stop
   the app (`adb shell am force-stop net.kckern.daylight.phone`). The inbox holds
   `<id>.journal.ogg.part`. Open the app again. Within a pass the file is `<id>.journal.ogg`,
   it uploads, and the transcript holds what was said before the stop, journaled
   at the time the recording started. Logcat and the shell log say "cut-off
   recordings: 1 recovered". If the intake refuses the file (422 or 415), record
   that: the truncated Ogg is not accepted and the design needs another look.
   Nothing is deleted either way.
10. Take a phone call in the middle of a recording: the memo stops and what was
    said before the call is uploaded.
11. Let a recording run to thirty minutes: it stops by itself and uploads as one
    memo. Record the file's size.
12. Deny the microphone: nothing is recorded and the app says so.
13. Answer "Don't allow" to notifications: recording still works, the question is
    not asked again, and the record screen says there is no recording notice and
    how to stop. Start a memo, leave the screen, and stop it by tapping the memo
    tile again. Record whether Android's own "active apps" list names Daylight
    while it records.
14. From a page of the site, try to start a recording, the camera and the text
    screen (links to `daylight://memo/new`, `daylight://input/voice?to=journal`,
    `daylight://input/photo?to=meal-photo` and `daylight://input/text?to=journal-note`
    in a page, and the same set by script as the page's location): nothing records,
    no camera opens, no text screen opens.
15. **Off the VPN.** Turn the VPN off with Wi-Fi on, record a memo and leave the
    phone for an hour. `input-queue.json` shows the input `QUEUED` with
    `attempts: 0` and a growing `nextAttemptAtMs`; `lastError` is "no connection"
    or an `HTTP <status>` of some other network. Turn the VPN on: it uploads.
16. **Device binding.** With the phone's key not bound to the user in the
    household config for the Journalist, record a memo. A notice says "This phone
    is not allowed to send to Journal yet"; `input-queue.json` shows `attempts: 0`.
    Bind the key; the memo uploads within the backoff and the notice goes. With the
    key bound for the Journalist and not for Nutribot, a Meal input waits with the
    same notice naming Meal while a Journal input goes through.
17. **Daily allowance.** If the allowance can be lowered for a test, exceed it for
    one bot: a notice says the allowance for that destination is used up and when
    sending resumes; a tap on it does not send early; after the named time the
    queue drains. While Journal is held, a Meal input still uploads: a limit on one
    bot does not hold the other.
18. **Meal by voice.** Tap "Meal voice", say what was eaten, "Stop and save". The file in
    the inbox is `<id>.meal.ogg`; Nutribot answers in its Telegram conversation as
    it does for a Telegram voice message. While a Journal recording is under way,
    tap "Meal voice": the Journal recording stops and is saved (any capture button
    tapped during a recording stops it), and no Meal recording starts until it is
    tapped again.
18b. **Meal by voice, offline.** Airplane mode on, tap "Meal voice", speak, "Stop and
    save": the notice names Meal 1. Airplane mode off: it uploads without opening
    the app, and Nutribot answers.

## F2. Text inputs

1. Tap "Journal text" (the fourth tile, or the long-press shortcut). A small
   window titled "Journal note" opens with the keyboard up, one field, Cancel and
   Send. Nothing has been sent yet: `files/inputs/inbox` is empty.
2. Type two lines and tap Send. The window closes with "Sending to Journal note".
   Within a pass the Journalist files a journal entry with that text, as it does
   for a Telegram text message, and `input-queue.json` shows `uploaded` one higher.
3. Tap "Journal text", type, tap Cancel: nothing is in `files/inputs/inbox` and
   nothing was sent. The same with the back button.
4. Tap Send on an empty field, and on a field of spaces: "Nothing to send", and
   the window stays.
5. Paste a long text (more than 16,384 bytes; a long Korean text reaches it at
   about 5,400 characters). The field stops taking text at the limit and the line
   under it says "At the limit". Send: it arrives whole.
6. Type a draft, turn the phone: the draft is still in the field.
7. Type a draft and open the recents screen: the window is not listed. Send, then
   open recents: no picture of the draft is there.
8. Airplane mode on, send a note: the notice says one input is waiting (Journal
   note 1). Force-stop the app, airplane mode off, open the app: it uploads.
9. With the phone locked, tap the Journal text tile: the unlock is asked for
   first, and the field is never shown over the lock screen.
10. "Meal note" (from the action list; it has no tile by default): the same, to
    Nutribot.
11. "Meal note" offline: airplane mode on, send a note; the notice names Meal note 1.
    Airplane mode off: it uploads, and Nutribot answers.

## F3. Photo inputs

1. Tap "Meal photo". The system's camera app opens after granting Camera if needed. Record which camera app it is. If instead a message says
   "Could not open the camera" or "No camera app on this phone", record it with
   the logcat lines tagged `Daylight-Input`.
2. Take the photo and accept it in the camera app. The camera closes with
   "Sending to Meal photo" and nothing else is shown. Within a pass Nutribot
   answers in Telegram as it does for a Telegram photo.
3. Before it uploads (airplane mode on), check the queued file:
   `adb shell run-as net.kckern.daylight.phone ls -l files/inputs/inbox` shows one
   `<id>.meal-photo.jpg` and no `.part` file. Pull that one file and read its
   metadata on the workstation (`exiftool` or `identify -verbose`): **no GPS
   fields, no camera model, no capture time**; its long edge is at most 2048
   pixels; it is upright. Delete the pulled copy. Do this once with the camera's
   location tagging turned ON in the camera app's settings, which is the case that
   matters. Then turn airplane mode off: the photo uploads without opening the app
   and Nutribot answers.
4. Take a photo holding the phone upright, on its left side and on its right
   side: each arrives upright.
5. Open the camera with "Meal photo" and press back without taking a photo:
   nothing is in `files/inputs/inbox`, nothing is queued, no message.
6. Open the camera, take a photo, and reject it in the camera's own review (the
   retake or cancel control): the same as 5.
7. Open the camera with "Meal photo", and with the camera in front run
   `adb shell am kill net.kckern.daylight.phone` (or let a heavy camera app push
   the app out of memory). Take the photo: it is still prepared and queued.
8. Daylight lists Camera in system settings. Meal photo requires no media-library permission.
9. From another app, try to read the provider:
   `adb shell content read --uri content://net.kckern.daylight.phone.inputs/capture/x`
   is refused (the provider is not exported), and so is a query of it.
10. With the phone locked, tap the Meal photo tile: the unlock is asked for first.
11. A very large capture (the camera's highest resolution): it still arrives, and
    logcat shows no `OutOfMemoryError`. Record the queued file's size.

## G. Notifications

1. With an input waiting (F7), tap the notice: a message says how many are being
   tried again. The notice names the destination and a count ("1 input waiting to
   upload (Journal 1)") and never anything that was said, typed or photographed.
2. A parked memo cannot be produced on purpose without the backend refusing one.
   If the backend answers 422 for a recording with no speech in it, record a few
   seconds of nothing: the notice says one input could not be sent (Journal 1)
   and has a Discard action, and the audio is still in the inbox.
3. Tap Discard: a message asks to tap again and nothing is deleted. Wait thirty
   seconds and tap again: it asks again. Tap twice within twenty seconds: the
   input and its file are gone, and the notice goes.
4. In the phone's notification settings the app has the channels "Uploads",
   "Voice memo recording" and "Daylight", beside the shell's own.

## H. A relayed push that opens a view

1. From Home Assistant's developer tools, send the phone a test notification whose
   tap target is a household https URL. With "Open by default" on (A5), a tap opens
   that page in Daylight. Record the exact `data:` that worked; nothing in this
   repo sets one today.

## I. Record the results

Write what was verified and what failed beside each line, and bring
`__docs/reference/android/phone.md` in line with what the phone did: every
"unproven on a phone" there is one of the lines above.
