# Phone build: on-device acceptance

**Nothing in this checklist has been run.** The phone build passes its unit tests,
lint and the build verifier, and has never been installed. Every expectation below
is from Android's documentation and from the backend's code as read. Mark each line
"verified on the phone, <date>" or write down what happened instead. A line that
was not run is "not run".

What the build is: `__docs/reference/android/phone.md`. Building:
`__docs/reference/android/README.md`.

Needs the owner's go-ahead before step A2. What installing does: the package
`net.kckern.daylight.phone` is added to the owner's phone with a persistent
"Daylight" notification, four quick-settings tiles the owner may add, a widget and
launcher shortcuts. `adb uninstall net.kckern.daylight.phone` removes all of it,
including any memo not yet uploaded.

There is no control API on the phone. Every check is by hand on the phone, or over
adb:

```bash
adb logcat --pid=$(adb shell pidof -s net.kckern.daylight.phone)
adb shell run-as net.kckern.daylight.phone cat files/shell.log
adb shell run-as net.kckern.daylight.phone cat files/payloads/state/memo-queue.json
adb shell run-as net.kckern.daylight.phone ls -l files/memos/inbox
```

The install key is needed to send a keyed link from adb. It is in
`files/payloads/state/link-key`; read it with `run-as` into a shell variable and do
not paste it anywhere:

```bash
K=$(adb shell run-as net.kckern.daylight.phone cat files/payloads/state/link-key)
```

## A. Install and first run

1. Record the phone's model and Android version (`adb shell getprop ro.product.model`,
   `adb shell getprop ro.build.version.release`).
2. `adb install -r shell/build/outputs/apk/phone/debug/shell-phone-debug.apk`.
   Confirm the sideload is accepted. If it is refused, or Play Protect interrupts,
   record the exact message. The build targets SDK 33; a later Android may want
   `--bypass-low-target-sdk-block`.
3. Open Daylight from the launcher. The site's start page loads. The launcher lists
   the app once, and the phone does not offer it as a home app.
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
3. `daylight://action/memo`, `daylight://memo/new` and
   `daylight://media/play?id=plex:1` with no key: each refused with a message.
4. Back from a page steps through the page history and then leaves the app.

## C. One-tap surfaces, warm and cold

1. Long-press the app icon: New memo, Media, Feed, Call. Each does its thing.
2. Add the "Daylight 1" tile. It reads "New memo". Tap it unlocked, and from the
   lock screen (it asks for the unlock first).
3. Add the "Daylight actions" widget. Four buttons, each works.
4. Cold: `adb shell am force-stop net.kckern.daylight.phone`, then tap the widget's
   Media button. The page opens within the wait, or "Daylight is still starting"
   shows and the next tap works.

## D. Native playback

Pick the content id of a music track and of an album from the Media page.

1. `adb shell am start -a android.intent.action.VIEW -d "daylight://media/play?id=<track id>&k=$K"`:
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

## F. Voice memos

1. Tap "New memo". The first time, the phone asks for the microphone and then for
   notifications; both dialogs stay up long enough to answer. Speak for ten
   seconds, "Stop and save".
2. Within a few minutes the transcript and the Journalist's reply arrive in the
   owner's Telegram conversation. `memo-queue.json` shows `uploaded: 1` and no
   memo; the inbox is empty. Record the entry's time in the journal: it is the
   upload time.
3. While recording: the notification is up and shows a running clock; its Stop
   action ends and saves the memo with the record screen closed.
4. While recording, tap the memo tile again: the memo stops and is saved.
5. Record how the file sounds and its size per minute (pull one from the inbox
   with airplane mode on): the first profile is 16 kHz at 32 kbit/s. If logcat says
   the recorder did not start at 16000 Hz, the fallback was used.
6. Airplane mode on. Record two memos. A notice says two are waiting. Airplane
   mode off: both upload without opening the app, one after the other, and the
   notice goes.
7. Record a memo with airplane mode on, restart the phone, airplane mode off: the
   memo uploads.
8. Record a memo, and force-stop the app in the middle of the recording. Open the
   recorder again: logcat says one cut-off recording was removed. That memo is
   lost; confirm nothing else is.
9. Take a phone call in the middle of a recording: the memo stops and what was
   said before the call is uploaded.
10. Let a recording run to thirty minutes: it stops by itself and uploads. Record
    the file's size.
11. Deny the microphone: nothing is recorded and the app says so.
12. Answer "Don't allow" to notifications: recording still works, and the question
    is not asked again.
13. From a page of the site, try to start a memo (a link to `daylight://memo/new`
    in a page, typed into the page's address by script): nothing records.

## G. Notifications

1. With a memo waiting (F6), tap the notice: a message says how many are being
   tried again.
2. A parked memo cannot be produced on purpose without the backend refusing one. If
   the backend answers 422 for a recording with no speech in it, record a few
   seconds of nothing: the notice says one memo could not be sent, and the audio is
   still in the inbox.
3. In the phone's notification settings the app has the channels "Uploads",
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
