# Kiosk cutover: from Fully Kiosk Browser to DaylightStation Android

**As of writing, nothing in this runbook has been run.** The one thing that has
happened on hardware is the phase 1 smoke test on the Portal on 2026-11-16: the
shell was installed beside the existing apps, its payload loaded and the control
API answered. Every step, command and expected result below comes from the code
and its JVM tests. Treat each one as a claim to check, and write down what the
device did.

Reference: `__docs/reference/android/kiosk.md` for the kiosk routes, settings,
page bridge and grants; `__docs/reference/android/README.md` for the rest.
Building: `_extensions/daylight-android/README.md`.

## How to use this

One device at a time, in this order: **Portal, then the piano tablet, then the
Shield**. Finish a device, leave it running for a few days, then start the next.

Each device goes through the same stages. Stages 1 to 9 run with the new app
installed **beside** Fully: Fully stays the home app, lockdown stays off, and the
household keeps using the kiosk as before. Stage 10 is the switch. Stage 11 is the
way back, and it must be read before stage 10 is started.

| Stage | What | Fully still runs the device |
|---|---|---|
| 1 | Pre-flight | yes |
| 2 | Install | yes |
| 3 | One-time grants | yes |
| 4 | Start and first answers | yes |
| 5 | Route by route | yes |
| 6 | Page bridge | yes |
| 7 | Page behavior and self-healing | yes |
| 8 | Reboot, payload push, rollback, bad payload | yes |
| 9 | Device-specific checks | yes |
| 10 | Switch the home app, lock down, escape attempts | no |
| 11 | Rollback to Fully | |

Mark every line `ok <date>`, or write the failure seen. A line that cannot be run
on a device (no touch screen, no device admin) is marked `n/a` with the reason. Do
not go on to stage 10 with an unexplained failure above it.

### Placeholders

Nothing in this file names a real device. Substitute as you go.

| Placeholder | Meaning |
|---|---|
| `<device>` | The device id: `portal`, `piano` or `shield` |
| `<package>` | Its application id, from `devices/<device>.yml` (`package:`) |
| `<serial>` | Its ADB serial (`{device-address}:5555` over the network) |
| `{device-address}` | Its address on the local network |
| `{build-host}`, `{port}` | A machine the device can reach over HTTP, serving the build outputs |
| `<fully-home>` | Fully's home component on this device, read in stage 1 |
| `<old-helper>` | The old helper app's package on this device |
| `dd` | `node cli/daylight-device.cli.mjs <device>` |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at this device |

`dd` reads the device's address and token from the private tokens file. Never
paste a token into a command, a note or this file.

## Stage 0. Before any device

- [ ] The build is green from a clean tree: `./gradlew build --rerun-tasks` in
      `_extensions/daylight-android`.
- [ ] `node _extensions/daylight-android/tools/verify-build.mjs <device> --legacy`
      prints one `✓` line for the device. Note the version code and the baked
      payload hash it prints.
- [ ] The private tokens file has the device's `host`, `token` and every
      placeholder its device file uses. A missing one fails the build and names it.
- [ ] The backend adapters for this app are deployed, and the device's entry in the
      backend's device config still says `provider: fully-kiosk`. It changes in
      stage 10 and not before.
- [ ] The page's bridge wrapper that works on either bridge is deployed. Until it
      is, leave `webview.backButton` at `reload`.
- [ ] Someone can reach the device with ADB for stages 2, 3 and 11.

## Stage 1. Pre-flight

Nothing here changes the device.

- [ ] **Back up the old helper's configuration.** Read its config route and save
      the answer outside the repo. For the piano tablet that is the old bridge's
      `GET /config`; for the Portal the old helper's config and its USB allowlist;
      for the Shield the old lease app's provisioning. A replace-install of a
      helper wipes its stored config, and stage 11 needs these values.
- [ ] **Save Fully's settings.** `fkb get > {private-notes}/fully-<device>.json`.
- [ ] **Read Fully's app whitelist.** `fkb get kioskAppWhitelist`. Write down
      exactly what is there. In stage 10 it becomes `lockdown.allowedApps` and
      `launcher.allowed`. The piano tablet's single-activity Bluetooth pairing
      exemption comes from this list.
- [ ] **Read what HOME resolves to now.**
      `adb -s <serial> shell cmd package resolve-activity -c android.intent.category.HOME -a android.intent.action.MAIN`
      Write the component down as `<fully-home>`.
- [ ] **Read the enabled accessibility services.**
      `adb -s <serial> shell settings get secure enabled_accessibility_services`
      Write the value down. Stage 3 appends to it, and stage 11 restores it.
- [ ] **Read who is device admin and device owner.**
      `adb -s <serial> shell dumpsys device_policy | head -40`
- [ ] Note the old apps' version names, and that the kiosk page is working, with
      a screenshot: `fkb shot`.

### The home chooser. Read this before installing on a kiosk in use

A build that lists `lockdown` declares a HOME filter, so installing it gives the
device a second home-app candidate. Whether Android then forgets that Fully is the
default, and asks which home app to use at the next Home press or the next boot,
**has not been checked on any of these devices.** A chooser on an unattended
kiosk is an outage.

- [ ] Install (stage 2) at a time when the kiosk is not needed and someone is at
      the device.
- [ ] Straight after the install, run the resolve command above again. If the
      answer is no longer `<fully-home>`, set it back at once:
      `adb -s <serial> shell cmd package set-home-activity <fully-home>`
      and run the resolve command a third time.
- [ ] Press Home on the device. Record: nothing changed / a chooser appeared.
- [ ] Reboot once (stage 8 does this anyway) and record the same.
- [ ] Write the result for this device and Android version here before the next
      device is started.

## Stage 2. Install

- [ ] Build the device's APK and verify it:
      `./gradlew :shell:assemble<Device>Debug`, then
      `node tools/verify-build.mjs <device> --legacy`.
- [ ] Install beside the existing apps:
      `adb -s <serial> install -r shell/build/outputs/apk/<device>/debug/shell-<device>-debug.apk`
- [ ] Do the home-chooser check above.
- [ ] The old apps are untouched: `adb -s <serial> shell pm list packages | grep -E "fully|<old-helper>"`.

## Stage 3. One-time grants

The full list with comments is in `__docs/reference/android/kiosk.md` under
"One-time grants". Run the
block for every device, then the device's own lines.

- [ ] Accessibility service **appended** to the value read in stage 1, never
      replacing it. The old helper's service must still be in the list afterwards.
- [ ] `WRITE_SECURE_SETTINGS`, `SYSTEM_ALERT_WINDOW`, `WRITE_SETTINGS`,
      `RECORD_AUDIO`, `CAMERA`, `READ_LOGS`, `DUMP`, `REQUEST_INSTALL_PACKAGES`,
      the battery-optimization exemption.
- [ ] Piano tablet and Portal: device admin
      (`dpm set-active-admin <package>/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver`).
      On the piano tablet Fully holds a device admin too; both may be active.
- [ ] The location permission the device's Bluetooth capability scans with.
- [ ] **Not yet:** the home activity. That is stage 10.

## Stage 4. Start and first answers

- [ ] Start the app by hand:
      `adb -s <serial> shell am start -n <package>/net.kckern.daylight.cap.webviewhost.shell.KioskActivity`
      The start page appears. Fully is still the home app; pressing Home goes back
      to it.
- [ ] `dd lifeline status`: answers, with the shell's version code from stage 0.
- [ ] `dd status`: `payloadVersion` is `p3-kiosk`, `appVersion` is the device
      file's `shell.versionName`, the capability list is the device file's,
      `a11yBound: true`, `batteryOptExempt: true`.
- [ ] `dd capabilities`: every route of the contract's kiosk tables is listed.
- [ ] `dd settings`: no value holds an unresolved `{placeholder}`; secrets read
      `(set)` or empty.
- [ ] `dd lockdown`: `enabled: false`, `locked: false`, `a11yBound: true`,
      `overlayGranted: true`, `adminActive` as granted, `homeIsKiosk: false`.
- [ ] A request without the token: `curl -s -o /dev/null -w "%{http_code}" http://{device-address}:8780/status`
      prints `401`.

## Stage 5. Route by route

With the new app's kiosk in front (stage 4's start). Lockdown is off, so nothing
recalls it; if Fully comes back to the front, start the Activity again.

**Kiosk page**

- [ ] `dd kiosk`: `ready: true`, `currentUrl` and `startUrl` right, `screenOn`,
      `kioskInForeground: true`, `rendererAlive: true`, `lastLoad.ok: true`,
      battery, memory and WiFi fields present. `wifiSsid` is expected to be null.
- [ ] `dd load <a page on the app's origin>`: answers `loaded: true` with
      `loadTimeMs` and a `loadId` after the page shows.
- [ ] `dd load https://unreachable.invalid/`: `ok: false` with the network error,
      and the local error page with a countdown appears. Then `dd load-start`.
- [ ] `dd load <url> --no-wait`: answers `accepted: true` at once with a `loadId`;
      `dd kiosk` then shows `loading: true`, and afterwards `lastLoad` with that
      `loadId`.
- [ ] `dd load-start`, `dd reload`, each with and without `--no-wait`.
- [ ] `dd foreground` from behind another app: `kioskInForeground: true`, and the
      kiosk is visibly in front. Run it once with the accessibility service
      disabled and record whether the plain start is refused (Android 10 and 11).
- [ ] `dd renderer-reset`: the page comes back; `rendererAlive: true`.
- [ ] `dd restart`: `restarting: true`, "Daylight is restarting…" shows briefly,
      the page returns, `dd status` answers, stored settings are intact.
- [ ] `dd overlay text Hello`: the message shows over the page,
      `text.overOtherApps: true`. `dd overlay url <a page> --gravity bottom`: the
      web layer shows and takes no touch. `dd overlay text`: only the message
      goes. `dd overlay clear`: both gone.

**Screen and sound**

- [ ] `dd screen off`: `screenOn: false`, the panel is dark. A minute later
      `dd status` still answers (the Portal especially). `dd screen on`: lit,
      `screenOn: true`, no keyguard in the way.
- [ ] `dd brightness 40`, `dd brightness 255`: a visible change; the level is read
      back.
- [ ] `dd reboot`: `501` with `device owner required` on a device that is not
      owner. Do not run it on one that is, until stage 8.
- [ ] `dd volume`: reads. `dd volume set 50`: reads back the same index.
      `dd volume set 50 --stream 4`.
- [ ] `dd speak hello`: audible, or `501` where there is no engine.
- [ ] `dd sound <an audio URL on the app's origin>`: audible, `playing: true`;
      `dd sound stop`. A URL on another origin: `400`.

**Launching**

- [ ] `dd launch <a package in launcher.allowed>`: `launched: true`, `component`,
      `observedInFront: true`. Where the list is empty, record `not_allowed`.
- [ ] `dd launch com.example.absent`: `not_installed`.
- [ ] `dd foreground` afterwards.

**Lockdown, while it is off**

- [ ] `dd lockdown lock` and `dd lockdown unlock`: both `501`,
      `lockdown.enabled is false`.
- [ ] Poll `dd lockdown` once a second for a minute; the device stays responsive.

**Diagnostics**

- [ ] `dd shot /tmp/<device>.png`: a PNG of the page. Open it. With a video
      playing, record what the video area looks like.
- [ ] `dd eval document.title`: the title. `dd eval 'fetch("/api/v1/status").then(r => r.status)'`:
      a number (a Promise). `dd eval 'nope('`: exit 1, `js_error`.
- [ ] `dd html | head -c 300`: the document.
- [ ] `dd fps`: a plausible number, and the page did not reload. `dd jank`:
      exit 0 and a line with the rate. With the display off, `dd fps` answers a
      timeout that says why, and `dd jank` wakes the screen first.
- [ ] `dd exec id`: exit 1, `debug.execEnabled is false`. Then
      `dd settings set debug.execEnabled true`, `dd exec id`: the app's uid, not
      `shell` or `root`. `dd lifeline log | tail` shows the command.
      `dd settings reset debug.execEnabled` when done.
- [ ] `dd logcat 200 Daylight`: text. No stderr note about `READ_LOGS` once the
      grant is in place; other apps' lines appear in `dd logcat 200`.
- [ ] `dd get /log`: the events of the steps above, with sizes and outcomes only:
      no script, no page content, no command output.

**Updates**

- [ ] `dd payload`: `current`, `previous`, `baked`.
- [ ] `dd update`: `state: idle`.

## Stage 6. Page bridge

In the page, through `dd eval`.

- [ ] `dd eval 'typeof window.daylight'`: `object` on the start URL.
- [ ] `dd load <a page on another origin>`, then the same eval: `undefined`.
      `dd load-start`.
- [ ] `dd lifeline log | grep shimAtDocumentStart`: which way this WebView gets
      the bridge. With `false`, check that the page's startup code saw
      `window.daylight`.
- [ ] `dd eval 'daylight.version + " " + daylight.deviceId'`.
- [ ] `dd eval 'daylight.capabilities()'`: a JSON array.
- [ ] `dd eval 'daylight.volume(3)'`: `{level, index, maxIndex}`.
- [ ] `dd eval 'daylight.launch(JSON.stringify({package: "<allowed package>"}))'`:
      `true` and the app opens; for a package not in `launcher.allowed`, `false`.
- [ ] `dd eval 'daylight.screen(false)'`: the display goes off (`false` on a
      device with no way to do it). `dd screen on`.
- [ ] `dd eval 'daylight.reboot()'`: `false` without device owner.
- [ ] `dd eval 'daylight.setBackMode("page")'`, press Back: the page gets
      `daylight:back`. `"reload"`: Back reloads. `"ignore"`: nothing. Set it back.
- [ ] Events. Install a recorder, cause each event, read it back:
      `dd eval 'window.__seen = []; ["resume","pause","back","screen","key","network"].forEach(n => addEventListener("daylight:" + n, e => __seen.push([n, e.detail]))); 1'`
      then `dd eval '__seen'` after each of: leaving to a launched app and
      returning (`pause {to}`, `resume {awayMs, from}`), Back in `page` mode,
      screen off and on, a key in `webview.interceptKeys`, WiFi off and on.
- [ ] A frame of another origin inside the page cannot use the native object:
      it has no token.

## Stage 7. Page behavior and self-healing

- [ ] Video with sound starts with no tap.
- [ ] Fullscreen video enters and leaves; Back leaves fullscreen first.
- [ ] Microphone from the page on the app's https origin (and denied on another
      origin). Camera, where the device has one.
- [ ] Remote and keyboard keys arrive in the page as `keydown`.
- [ ] Attaching a Bluetooth keyboard does not reload the page.
- [ ] **Server down.** Stop the app server, `dd load-start`: the error page with
      a countdown. Start the server: the page returns by itself within the retry
      delay.
- [ ] **Network loss, healthy page.** WiFi off for five minutes with the page
      healthy, then on: the page is **not** reloaded (`dd kiosk` shows the same
      `lastLoad.loadId` as before).
- [ ] **Network loss, failed page.** With the error page showing, WiFi on: the
      page is reloaded at once.
- [ ] **Renderer gone.** `dd load chrome://crash` (or, with exec enabled, kill
      the renderer process): the page comes back; the log has "renderer gone".
- [ ] **Renderer stuck.** `dd eval 'for(;;){}'`: the eval times out; after
      `recovery.rendererUnresponsiveSec` the renderer is ended and the page
      returns. On the Portal record whether that callback exists at all.

## Stage 8. Reboot, payload push, rollback, bad payload

- [ ] **Reboot survival.** Reboot the device. With no ADB and no touch:
      `dd lifeline status` answers, then `dd status`. Fully is the home app and
      shows as before. Record how long each took.
- [ ] **Payload push.** Build the payload (`./gradlew :payload:payload<Device>`),
      serve its directory from `{build-host}`, then
      `dd payload push http://{build-host}:{port}/<device>-p3-kiosk.jar <sha256 from the .sha256 file>`.
      `dd payload` afterwards: `current` is `p-<first 12 hex>.jar`, the baked one
      is `previous`. The kiosk Activity stayed up through the swap.
- [ ] **Rollback.** `dd payload rollback`; `dd payload`: the two have changed
      places. `dd lifeline rollback` does the same from the lifeline.
- [ ] **A wrong hash.** Push with one digit of the sha256 changed: refused; the
      running payload is untouched.
- [ ] **A payload that cannot start.** Push a file that is not a payload (any
      small zip, with its true sha256). The loader activates it, it fails to
      start, and the loader goes back to the previous payload by itself.
      `dd payload` shows `lastFailed`. The control port answers again within the
      20 second deadline plus the restart.
- [ ] **A stored setting that breaks the start.** Only if one is found: the
      control port stays down, `dd lifeline reset-settings` clears the overrides
      and the payload starts on its defaults. Secrets must be set again after it.
- [ ] **Shell update.** Bump `shell.versionCode`, rebuild, serve the APK:
      `dd update http://{build-host}:{port}/shell-<device>-debug.apk <sha256>`.
      With accessibility bound the dialog is confirmed by the app; `dd status`
      shows the new version code afterwards, and `dd update` reads `idle`.
      Without a sha256 a person has to tap. Dismiss one on purpose: 90 seconds
      later `dd update` reads `failed`, `not_confirmed`.

## Stage 9. Device-specific checks

### Portal

- [ ] **Volume keys delivered.** With `volume-keys` running, each volume key
      reaches the page as `daylight:key` (stage 6's recorder) and as a `key`
      message on the control port's WebSocket, and the system volume does not
      move. No beep.
- [ ] The double volume-down gesture, if `keys.screenToggleEnabled` is to be on.
- [ ] `dd lockdown input lock --revision <n>`: the volume keys do nothing;
      `dd lockdown input release --revision <n+1>`: they work again. An older
      revision answers `409`.
- [ ] **Control Center dismissal.** After stage 10 (it needs the kiosk locked):
      swipe the panel up. It is pushed back down within a second or two;
      `dd lifeline log` records the attempts. During an unlock window it is left
      alone.
- [ ] USB keyboard: keys arrive as `keyboard` messages; the USB permission dialog
      is confirmed by the app.
- [ ] Presence: `dd get /presence` shows the connected devices, and the backend
      receives the report (after `presence.endpoint` and `presence.token` are set).
- [ ] The display off for an hour: `dd status` still answers.
- [ ] **Ownership transfer.** The old helper is device owner. Ownership moves to
      this app with `DevicePolicyManager.transferOwnership` from the old helper,
      which is its own step with its own go-ahead; it cannot be undone without a
      second transfer. Afterwards `dd lockdown` reads `deviceOwner: true`, and
      with the kiosk locked `mode: owner`, `lockTaskActive: true`. Check that
      `dd reboot` reboots, and that the packages in `lockdown.ownerHidePackages`
      are hidden while the WebView's own package is not.

### Piano tablet

- [ ] **Synth sound.** A key press sounds through the configured speaker.
      `dd status` shows the engine and preset; `engine` is not `load_failed`.
- [ ] **MIDI latency.** Play and listen: key to sound feels as it does with the
      old bridge. `dd post /loopback` for a measured round trip; compare with the
      old bridge's figure for the same instrument. Only a returned echo proves
      delivery.
- [ ] `dd get /midi/tap` shows live notes; the page receives `note.on` and
      `note.off` on the WebSocket.
- [ ] **Audio guard.** With the speaker connected, `dd get /speaker` reads
      healthy. Switch the speaker off: the output gate closes and nothing plays
      from the tablet's own speaker. Switch it on: it reconnects. `dd volume set 50`
      while the guard holds the stream answers `volume_unchanged` with the true
      index.
- [ ] **Bluetooth panel.** `dd get /bluetooth` lists the instrument and speaker
      roles. From the page, start a pairing: Android's pairing dialog may stay in
      front and is not recalled over (after stage 10).
- [ ] **Frame rate.** `dd jank` with the piano page idle and again mid-game. Compare
      with `fkb jank` from before the switch. Record the tablet's temperature
      state if the rate is low.
- [ ] A played note wakes a dark display, within the cooldown.
- [ ] The page's connection to the app (notes, synth) from the https page, with
      `webview.allowMixedContent` false. Record how the page reaches it.

### Shield

- [ ] **Microphone first.** Before anything else on this device:
      `dd get /mic/status` reads `running: true`, `lastError: null`. Open the
      page's call screen: `streaming: true`, `clients: 1`, and audio is heard at
      the other end. This is the risk the design names; if the microphone is
      withheld, stop here and record `lastError` and `lastErrorDetail`.
- [ ] After a reboot, the same check again, with no one touching the device.
- [ ] **A call.** A full video call in both directions, five minutes long.
- [ ] **Remote keys.** D-pad, select, back, play/pause arrive in the page as
      `keydown` and navigate the menu as under Fully.
- [ ] **Arcade launch and return.** From the menu, start a game: the emulator
      opens with its ROM (the intent's extras arrived). `dd lockdown` names the
      emulator as `foreground`. `dd overlay text ...` shows over the game.
      `dd foreground`: back at the menu, and the page got `daylight:resume` with
      `from`.
- [ ] **Controller pairing.** From the Controllers screen pair a controller; the
      status, Fix and re-pair actions work with the token in place.
      `navigator.getGamepads()` reports the pad in the page.
- [ ] **Lease gate.** After stage 10, with `lease.endpoint`, `lease.packageName`
      and `lease.credential` set: `dd get /lease` reads `configured: true`,
      `ready: true`, `enforcement: block-and-recall`. With no lease the game is
      recalled when opened and `POST /launch` refuses it; with a lease it runs;
      with the network off the lease expires and the game is recalled.
- [ ] `dd screen off` uses the accessibility lock action here; record what the TV
      does, and `dd screen on`.
- [ ] No device admin and no reboot are possible on this device: `dd reboot`
      answers `501`.

## Stage 10. Switch the home app and lock down

Read stage 11 first. Do this with someone at the device and time to spare.

1. [ ] Set the allowlists from stage 1's whitelist:
       `dd settings set lockdown.allowedApps "<rules>"` and, where the page
       launches apps, `dd settings set launcher.allowed "<rules>"`.
       `dd lockdown` shows them under `allowedApps` with no `allowedAppsError`.
2. [ ] If the device is to have an exit gesture: `dd settings set lockdown.exitPin <pin>`.
       The answer shows `(set)`, never the PIN. The Shield has no touch screen and
       gets none.
3. [ ] Point the backend at the new app: `provider: daylight-android` for this
       device, and reload the backend's config. The admin console's actions now
       go to this app.
4. [ ] Make this app the home app:
       `adb -s <serial> shell cmd package set-home-activity <package>/net.kckern.daylight.cap.webviewhost.shell.KioskActivity`
       Resolve HOME again (stage 1's command): it names this app. Press Home: this
       app's kiosk. `dd lockdown`: `homeIsKiosk: true`.
5. [ ] Stop Fully so two kiosks do not compete: `adb -s <serial> shell am force-stop de.ozerov.fully`.
       Do **not** uninstall it. Stop the old helper the same way once its
       capability is confirmed here; do not uninstall it either.
6. [ ] Lock down: `dd settings set lockdown.enabled true`. `dd lockdown`:
       `locked: true`, `watcher: running`, `mode` as expected for the device.
7. [ ] Reboot. With no touch: the kiosk page is showing, `dd status` answers,
       `dd lockdown` reads `locked: true`, `homeIsKiosk: true`.

**Escape attempts.** Each one should end with the kiosk back in front within
about two seconds, `recallsSinceBoot` one higher, and `lastRecall` naming what was
in front. Record each.

- [ ] Home.
- [ ] Recents.
- [ ] The status-bar pull. Record whether the shield stops the shade from opening
      at all.
- [ ] A notification, if one can be raised.
- [ ] The assistant (long-press Home, or the remote's button).
- [ ] The power menu.
- [ ] Settings reached through any dialog.
- [ ] Portal: the Control Center swipe.
- [ ] A launched app (`dd launch`) stays in front; Home returns to the kiosk;
      opening the same app again by other means is recalled.
- [ ] Disable the accessibility service in Settings during an unlock, then
      `dd lockdown lock`: the kiosk is recalled anyway, and the service is back
      within 30 seconds.

**Unlocking.**

- [ ] `dd lockdown unlock 2`: `relockAtMs` two minutes out; other apps can be
      opened; it relocks by itself.
- [ ] `dd lockdown unlock`: relocks after `lockdown.maxUnlockMin`.
      `dd lockdown lock`: at once.
- [ ] Seven quick taps in the top-left corner raise the PIN prompt. The right PIN
      unlocks for `lockdown.pinUnlockMin` minutes. Five wrong PINs lock the
      prompt for five minutes, and `dd get /log` has one `lockdown.pin.lockout`
      line with no PIN in it. With no PIN set, nothing happens.
- [ ] Reboot during an unlock window: still unlocked until the window ends.

**A day later.**

- [ ] `dd lockdown`: `recallsSinceBoot` is small, and each `lastRecall` is one
      that can be explained.
- [ ] The log store has the device's heartbeats for the whole day, with no gap.
- [ ] The household used the kiosk and nobody reported a difference beyond those
      in `__docs/reference/android/kiosk.md`, "Differences from Fully Kiosk Browser".

## Stage 11. Rollback to Fully

Works from any point in stage 10. Fully and the old helper were stopped, never
uninstalled, and their settings were never changed.

1. [ ] Unlock, so nothing is recalled while switching:
       `dd settings set lockdown.enabled false` (or `dd lockdown unlock 30`).
       If the control port does not answer, go on to step 2 over ADB: with Fully
       as home and this app stopped, nothing recalls.
2. [ ] Make Fully the home app again:
       `adb -s <serial> shell cmd package set-home-activity <fully-home>`
       and resolve HOME to confirm.
3. [ ] Start Fully: `adb -s <serial> shell am start -n <fully-home>`. Its start
       page loads.
4. [ ] Start the old helper again (its launcher activity or its service, as it
       was started before), and check its own status route.
5. [ ] Point the backend back: `provider: fully-kiosk` for this device, and reload
       the backend's config.
6. [ ] Stop this app so it holds nothing the old apps need (the microphone on the
       Shield, the MIDI link on the piano tablet):
       `adb -s <serial> shell am force-stop <package>`.
       A force-stopped app stays stopped until it is opened or the device reboots,
       so also keep it from starting at boot if the rollback is to last:
       `adb -s <serial> shell pm disable-user --user 0 <package>`
       (`pm enable <package>` undoes it).
7. [ ] Portal, if ownership was transferred: it stays with this app until it is
       transferred back. Decide that separately; with this app disabled the old
       helper has no owner policy.
8. [ ] Restore anything stage 1 saved that has changed: the accessibility
       services list, the old helper's config.
9. [ ] Confirm with `fkb info` and `fkb shot` that the kiosk is as it was in
       stage 1, and reboot once to see it come back by itself.
10. [ ] Write down what failed and at which line of this runbook.

## Record

| Device | Android | Stage reached | Date | Home chooser on install | Open failures |
|---|---|---|---|---|---|
| Portal | | | | | |
| Piano tablet | | | | | |
| Shield | | | | | |
