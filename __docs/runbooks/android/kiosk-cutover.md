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

## If the kiosk is dark or unreachable

Read this page before stage 2. It is the way back from every later stage, in the
order to try things. `dd` is the fleet CLI for the device (see Placeholders).

1. **Does the lifeline answer?** `dd lifeline status`. The lifeline is the shell's
   own port and answers when the payload is broken.
   - It answers and `payload.active` is null or `lastError` is set:
     `dd lifeline rollback` (the previous payload), then `dd lifeline restart`.
   - The payload cannot start with the stored settings: `dd lifeline reset-settings`.
     This deletes every stored override and its backup. Secrets (`lockdown.exitPin`,
     `presence.token`, `lease.credential`) must be set again afterwards, and every
     coexistence switch goes back to the device file's value. On a device built with
     `lockdown.required: true` lockdown stays enforced through the reset.
   - `dd lifeline log | tail -40` says what the shell did last.
2. **The lifeline answers and the screen is held by lockdown.**
   - `dd lockdown unlock 30` (control port). It relocks by itself.
   - No control port: on a touch device, seven quick taps in the top-left corner
     and the exit PIN. Owner mode does not lock without a PIN, so a Portal in
     owner mode always has this.
   - This app is device owner and the payload is broken: `dd lifeline owner-release`.
     The shell clears the home preference, the lock-task list, the status-bar and
     keyguard policies and leaves lock task, with no payload involved.
3. **Nothing answers on either port.**
   - Is the device on the network at all? Check the router's client list. The
     Portal drops off the network with its display off unless this app holds its
     locks; a dark Portal that does not answer may only need its screen touched.
   - ADB, where it is still up (`adb connect {device-address}:5555`):
     `adb -s <serial> shell am broadcast -n <package>/net.kckern.daylight.shell.BootReceiver -a net.kckern.daylight.KEEPALIVE`
     starts the shell service without starting an Activity. Then go to 1.
   - ADB over WiFi does **not** survive a reboot on the Portal. After a reboot
     there the lifeline and the app's own `POST /update` are the only remote ways
     in. That is why stage 8 proves both before any reboot with lockdown on.
4. **Give the device back to Fully.** Stage 11, from its step 1. If only ADB is
   left: `adb -s <serial> shell am force-stop <package>`, then start Fully
   (`adb -s <serial> shell am start -n <fully-home>`). With this app stopped
   nothing recalls. A force-stopped app does not start at boot, so the device
   stays with Fully across reboots until this app is opened again.
5. **Someone at the device, nothing else works.** Power-cycle it. On a device not
   yet switched (stages 1 to 9) Fully is still the home app and comes up as it
   always did; this app has changed nothing it can strand the device with:
   installing adds no home candidate, lockdown is off, and every coexistence
   switch is off.

What cannot be recovered remotely, and so must not be reached without the proofs
in stage 8: a device rebooted with lockdown on, no ADB after the reboot, and a
lifeline that does not come back.

## How to use this

One device at a time, in this order: **Portal, then the piano tablet, then the
Shield**. Finish a device, leave it running for a few days, then start the next.

Each device goes through the same stages. Stages 1 to 9 run with the new app
installed **beside** Fully: Fully stays the home app, lockdown stays off, and the
household keeps using the kiosk as before. Three things make that safe, and each
is checked in stage 2:

- **Installing changes no home candidate.** The HOME filter is on an
  activity-alias that is installed disabled. Only `dd lockdown home on` enables it.
- **The old helpers keep their hardware.** Every coexistence switch in the device
  file is off (`hid.enabled`, `volumeKeys.enabled`, `presence.enabled` on the
  Portal; `midi.enabled`, `speaker.enabled` on the piano tablet; `mic.enabled`,
  `lease.enabled` on the Shield). They are turned on in stage 10, one at a time.
- **Lockdown is off**, and with it the watcher that would recall this app over Fully.

Stage 10 is the switch. Stage 11 is the way back, and it must be read before
stage 10 is started. The first section of this file is the short form of it.

| Stage | What | Fully still runs the device |
|---|---|---|
| 1 | Pre-flight | yes |
| 2 | Install | yes |
| 3 | One-time grants | yes |
| 4 | Start and first answers | yes |
| 5 | Route by route | yes |
| 6 | Page bridge | yes |
| 7 | Page behavior and self-healing | yes |
| 8 | Self-update, reboot, payload push, rollback, bad payload | yes |
| 9 | Device-specific checks | yes |
| 10 | Hand the hardware over, switch the home app, lock down, escape attempts, make it permanent | no |
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
- [ ] **Portal only: the ownership prerequisite is done** (the section below).
      It comes before stage 10 on that device and needs its own go-ahead.

### Portal: device ownership, before stage 10

The Portal's device owner today is the old helper (`net.kckern.portalkeys`). Owner
mode in this app needs ownership to be moved to it, with
`DevicePolicyManager.transferOwnership` (Android 9, API 28). **That call has never
been made on this firmware.** Until it has been made in both directions, with
lockdown off, this device is cut over in `app` mode and the old helper keeps
ownership.

Follow the [Portal cutover prerequisites](portal-cutover.md#before-the-sitting-no-device-contact)
for legacy shell 36 and payload `p10-ordered-owner-transfer`. Record the approved
APK and payload digests, verify the APK signer against the installed helper,
and verify protocol 2 and both ownership transfer capabilities before the
rehearsal.

Rehearsal, with lockdown off on both apps' sides and someone at the panel:

1. [ ] Record `adb -s <serial> shell dumpsys device_policy | head -40` and
       `dd lockdown` (`deviceOwner: false`, `ownerHold: null`).
2. [ ] **Out.** `node _extensions/portal-keys/pkctl.mjs transfer-owner`. The old
       helper releases its own policy (its home preference for Fully, lock task,
       restrictions, hidden packages) and then transfers. Expected: `ok: true`,
       `transferred: true`.
3. [ ] `dd lockdown`: `deviceOwner: true`, `mode: app`, and `ownerHold` reads
       "device ownership was transferred to this app". Arriving ownership applies
       nothing: `lockTaskActive: false`, the status bar works, Fully is still home.
4. [ ] **Back.** `dd settings set lockdown.ownerTransferTarget net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver`,
       then `dd lockdown owner transfer net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver`.
       Expected: `transferred: true`, `deviceOwner: false`. Then
       `dd settings reset lockdown.ownerTransferTarget`: with the setting empty
       every transfer from this app is refused.
5. [ ] `node _extensions/portal-keys/pkctl.mjs resume-policy`, then
       `pkctl kiosk-verify`: the old helper holds the device as in step 1.
6. [ ] Reboot once and repeat step 5's check.

If a transfer is refused (the answer carries the exception's class and message):

- **Out refused.** The old helper is still the owner with its policy released and
  held. `pkctl resume-policy` puts it back. This device is cut over in `app` mode:
  leave `lockdown.mode` at `auto` (it resolves to `app` while this app is not the
  owner), and expect no lock task, no hidden packages and no remote reboot.
- **Back refused.** This app is still the owner with its policy released and the
  hold set. `dd lockdown owner resume` applies owner policy again when wanted.
  The old helper then has no owner authority; decide whether to stay on this app.
- Record the firmware build, the exception and which direction, in the Record
  table. Do not retry in a loop.

For the cutover itself, ownership is moved out once more (step 2) just before
stage 10's lock step, and `dd lockdown owner resume` is what makes this app act
as owner.

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

### Installing changes no home candidate. Verify it

A build that lists `lockdown` carries its HOME filter on an activity-alias
(`net.kckern.daylight.cap.lockdown.shell.KioskHome`) that is declared disabled.
A disabled component is not a home candidate, so installing must leave the
device's home resolution exactly as it was. The build checks the merged manifest
for this and `verify-build` checks the APK; this is the check on the device.

- [ ] **Before installing**, record both:
      `adb -s <serial> shell cmd package resolve-activity -c android.intent.category.HOME -a android.intent.action.MAIN`
      (the component is `<fully-home>`), and the list of candidates:
      `adb -s <serial> shell cmd package query-activities -a android.intent.action.MAIN -c android.intent.category.HOME`
- [ ] **After installing** (stage 2), run both again. The answers are identical:
      the same default, and this app's package is in neither.
- [ ] `adb -s <serial> shell dumpsys package <package> | grep -B2 -A6 KioskHome`
      shows the alias; `dd lockdown` reads `homeAlias: disabled`,
      `homeIsKiosk: false`.
- [ ] Press Home on the device: Fully, with no chooser.
- [ ] If the candidate list did change, stop. Uninstall this app
      (`adb -s <serial> uninstall <package>`), confirm the two commands answer as
      before, and record what was seen: the build is wrong for this device.

## Stage 2. Install

- [ ] Build the device's APK and verify it:
      `./gradlew :shell:assemble<Device>Debug`, then
      `node tools/verify-build.mjs <device> --legacy`.
- [ ] Install beside the existing apps:
      `adb -s <serial> install -r shell/build/outputs/apk/<device>/debug/shell-<device>-debug.apk`
- [ ] Do the home-candidate check above (stage 1's last section).
- [ ] The coexistence switches are off, so nothing was taken from the old helper:
      after stage 4's start, `dd status` lists each one under `switches` with
      `setting: false`, `active: false`. Check the old helper still works (its own
      status route; a key, a note, the microphone).
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
- [ ] **Not yet:** the home alias and the home activity. That is stage 10.

## Stage 4. Start and first answers

- [ ] Start the service without an Activity. This works on every device, also
      where another app's kiosk mode refuses or kills a new Activity:
      `adb -s <serial> shell am broadcast -n <package>/net.kckern.daylight.shell.BootReceiver -a net.kckern.daylight.KEEPALIVE`
      `dd lifeline status` then answers. Everything in this stage that does not
      need the page can be checked from here.
- [ ] **Where Fully's kiosk mode is on** (it brings itself back over other apps,
      or ends them): put this app on Fully's whitelist for the length of the test,
      and take it off afterwards.
      `fkb get kioskAppWhitelist` (record the value as `<fully-whitelist>`), then
      `fkb set kioskAppWhitelist "<fully-whitelist>,<package>"`.
      When the stages that need the page are done:
      `fkb set kioskAppWhitelist "<fully-whitelist>"`, and `fkb get kioskAppWhitelist`
      to confirm it reads as recorded.
- [ ] **Portal: do not expect the Activity yet.** The old helper holds the Portal
      in lock task with only Fully on the list, and Android refuses to start any
      other activity there (seen: `am start` answers error 101). Start the service
      with the broadcast above and run every check that needs no page. The stages
      that need this app's window (parts of 5, all of 6 and 7) wait until ownership
      has been transferred to this app, or until the old helper's lock task is
      relaxed for the test (`pkctl transfer-owner` in the prerequisite's rehearsal
      leaves exactly that state between its steps 2 and 4).
- [ ] Where an Activity can be started, start it by hand:
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
- [ ] `dd lockdown`: `enabled: false`, `required: false`, `locked: false`,
      `a11yBound: true`, `overlayGranted: true`, `adminActive` as granted,
      `homeIsKiosk: false`, `homeAlias: disabled`, `ownerHold: null`.
- [ ] `dd status`: `settingsProblem: null`, and every coexistence switch of this
      device under `switches` with `active: false`.
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
- [ ] `dd load https://www.example.org/`: `400`, `origin_not_allowed`. The kiosk
      loads its start URL's origin and `webview.allowedOrigins` and nothing else.
- [ ] Stop the app server, `dd load-start`: `ok: false` with the network error, and
      the local error page with a countdown appears. Start the server again.
- [ ] `dd load <url> --no-wait`: answers `accepted: true` at once with a `loadId`;
      `dd kiosk` then shows `loading: true`, and afterwards `lastLoad` with that
      `loadId`. With no kiosk Activity up the answer also reads `queued: true`,
      and the page is the one that shows when the Activity appears.
- [ ] `dd load-start`, `dd reload`, each with and without `--no-wait`.
- [ ] `dd foreground` from behind another app: `kioskInForeground: true`, and the
      kiosk is visibly in front. Run it once with the accessibility service
      disabled and record whether the plain start is refused (Android 10 and 11):
      the answer is then HTTP 409 `not_in_foreground`.
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
- [ ] A page on another origin cannot be loaded at all (`dd load` answers 400), so
      there is no page of another origin to get the bridge. From the page, try to
      leave: `dd eval 'location.href = "https://www.example.org/"'`. The page stays;
      `dd lifeline log | tail` has "refused a main-frame navigation" with the origin
      only.
- [ ] `dd kiosk`: `bridge: available`. The bridge exists only where the WebView
      can inject a script at document start. `bridge: unavailable` with a
      `bridgeReason` means this device's WebView cannot: update Android System
      WebView, and do not go on to stage 10 without the bridge. Record the WebView
      version (`dd exec` is off; `adb -s <serial> shell dumpsys webviewupdate | head`).
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
- [ ] **Renderer gone.** With exec enabled, kill the renderer process: the page
      comes back at once; the log has "renderer gone" and `dd kiosk` reads
      `rendererLosses: 1`. Kill it again within five minutes: the local error page
      shows with a countdown, and the page returns after it. A third time: the
      wait is `recovery.maxRetrySec`. `dd renderer-reset` is not counted as a loss.
- [ ] **A dead address.** `dd eval 'location.href = "/no-such-page-" + Date.now()'`
      on a server that answers 404 for it: after three failed tries the kiosk
      loads its start page by itself.
- [ ] **Renderer stuck.** `dd eval 'for(;;){}'`: the eval times out; after
      `recovery.rendererUnresponsiveSec` the renderer is ended and the page
      returns. On the Portal record whether that callback exists at all.

When `acc --active` exercises screen sleep and wake, it restores the original
screen state and reads it back before reporting PASS. A restoration failure
returns exit status 1, including after Ctrl-C. A successful interrupted
restoration returns 130. If Ctrl-C arrives while `acc --kill` is restarting
the app, the runner retries temporary control API failures while restoring
`debug.execEnabled` and verifies the saved value. Cleanup can wait up to
the full `--reboot-wait` interval, which defaults to 300 seconds.

## Stage 8. Self-update, reboot, payload push, rollback, bad payload

Lockdown is off throughout this stage. **Never reboot a device with lockdown on
until every line of this stage is marked ok on that device.**

- [ ] **`POST /update`, end to end, before any reboot.** This is the only remote
      way to replace the shell on a device with no ADB (the Portal after a
      reboot). Bump `shell.versionCode`, rebuild, serve the APK, and
      `dd update http://{build-host}:{port}/shell-<device>-debug.apk <sha256>`.
      With the sha256 and accessibility bound the app confirms its own dialog.
      `dd update` reads `sha256Verified: true`, `confirming: true` while it waits,
      and afterwards `dd status` shows the new version code. Do it twice. On the
      Shield (`update.autoConfirm` off) a person confirms on the TV; record that
      this device has no tap-free update.
- [ ] **Reboot survival, lockdown off.** Reboot the device. With no ADB and no touch:
      `dd lifeline status` answers, then `dd status`. Fully is the home app and
      shows as before. Record how long each took.
- [ ] **Shield microphone capture.** With `acc --only reboot --reboot`, require
      `reboot.survives` to pass and complete the `reboot.mic-capture` manual
      check after each reboot. Without touching the Shield after boot, verify
      that a Home Line call or approved recording consumer receives PCM audio
      frames and have a person confirm audible speech. Record both observations
      in the private sitting notes using the [Shield capture procedure](shield-cutover.md#microphone-capture-after-each-reboot).
- [ ] **What survives a reboot on this device.** Record: does ADB over WiFi come
      back (`adb connect {device-address}:5555`)? On the Portal it does not. Then
      the lifeline and `dd update` are the whole way back in, and both were just
      proven.
- [ ] Reboot a second time, and a third. The lifeline answers each time. A device
      whose lifeline came back two times out of three is not ready for stage 10.
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
- [ ] **A shell update nobody confirms.** `dd update` with no sha256: a person has
      to tap. Dismiss the dialog on purpose: 90 seconds later `dd update` reads
      `failed`, `not_confirmed`. A wrong sha256 answers HTTP 409.

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
- [ ] **Ownership.** The prerequisite section in stage 0 was rehearsed in both
      directions on this panel, and its result is in the Record table. With
      ownership here and `dd lockdown owner resume` run (stage 10): `dd lockdown`
      reads `deviceOwner: true`, `mode: owner`, `lockTaskActive: true`. Check that
      `dd reboot` reboots (only after stage 8), and that the packages in
      `lockdown.ownerHidePackages` are hidden while the WebView's own package is not.
- [ ] `dd lockdown owner release`: the status bar and the keyguard are back, lock
      task ends, the hidden packages show, `mode: app`. `dd lockdown owner resume`
      puts it all back. `dd lifeline owner-release` does the short form with the
      payload stopped.

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

- [ ] **Microphone first.** Use `acc --only mic.status` for a read-only
      service check during coexistence. After hand-over, run
      `acc --only mic.capture` and follow its manual instructions. Verify
      that a Home Line call or approved recording consumer receives PCM audio
      frames and have a person confirm audible speech.
- [ ] After each reboot, complete `reboot.mic-capture` as described in stage 8.
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

Read stage 11 and the first section of this file first. Do this with someone at
the device and time to spare. Stage 8 is complete on this device.

1. [ ] Set the allowlists from stage 1's whitelist:
       `dd settings set lockdown.allowedApps "<rules>"` and, where the page
       launches apps, `dd settings set launcher.allowed "<rules>"`.
       `dd lockdown` shows them under `allowedApps` with no `allowedAppsError`.
       If the page must navigate to another origin (a sign-in page), add it:
       `dd settings set webview.allowedOrigins "<origins>"`.
2. [ ] Set the exit PIN on a device with a touch screen:
       `dd settings set lockdown.exitPin <pin>`. The answer shows `(set)`, never
       the PIN. **Owner mode will not lock without it** (`dd lockdown` then reads
       `ownerRefused` with the reason): a locked Portal with no network and no PIN
       would have no exit. The Shield has no touch screen and gets none.
3. [ ] Save the device’s original `content_control` and `volume` blocks. Keep the
       device host, set `content_control.provider: daylight-android`, `port: 8780`
       and `auth_ref: daylight-android`, and select `volume.provider: daylight-android`.
       Volume inherits the content endpoint unless its own host, port or auth reference
       overrides it. Verify all three resolve to this same device. Restart the backend (the device adapters are built at
       start; a config reload does not switch them). The admin console's actions now
       go to this app.
4. [ ] **Hand the hardware over, one part at a time.** For each coexistence switch
       of this device: stop the old helper's use of that part, turn the switch on,
       and check the part works here before the next one.
       - Portal: `dd settings set hid.enabled true` (a key on the USB keyboard
         arrives), `dd settings set volumeKeys.enabled true`,
         `dd settings set presence.enabled true`.
       - Piano tablet: `dd settings set midi.enabled true` (`dd post /loopback`
         echoes), `dd settings set speaker.enabled true` (`dd get /speaker`).
       - Shield: `dd settings set mic.enabled true` (`dd get /mic/status`:
         `running: true`), `dd settings set lease.enabled true`.
       `dd status` shows each under `switches` with `active: true`. A switch that
       reads `setting: true`, `active: false` carries an `error`: the old helper
       still holds the part.
       Stop the old helper once every part it had is confirmed here
       (`adb -s <serial> shell am force-stop <old-helper>`). Do **not** uninstall it.
5. [ ] Portal: move ownership out of the old helper (`pkctl transfer-owner`, as
       rehearsed). `dd lockdown`: `deviceOwner: true`, `mode: app`, `ownerHold` set.
6. [ ] Make this app a home candidate, then the home app:
       `dd lockdown home on` (`homeAlias: enabled`), then
       `adb -s <serial> shell cmd package set-home-activity <package>/net.kckern.daylight.cap.lockdown.shell.KioskHome`
       Resolve HOME again (stage 1's command): it names this app's alias. Press
       Home: this app's kiosk. `dd lockdown`: `homeIsKiosk: true`.
7. [ ] Stop Fully so two kiosks do not compete: `adb -s <serial> shell am force-stop de.ozerov.fully`.
       Do **not** uninstall it.
8. [ ] Lock down: `dd settings set lockdown.enabled true`. It is applied at once.
       `dd lockdown`: `locked: true`, `watcher: running`.
       Portal: `dd lockdown owner resume`; then `mode: owner`, `lockTaskActive: true`.
9. [ ] Run the escape attempts and the unlock checks below, with lockdown on and
       **without rebooting**.
10. [ ] Only now, reboot. Stage 8 proved the lifeline returns on this device. With
        no touch: the kiosk page is showing, `dd lifeline status` and `dd status`
        answer, `dd lockdown` reads `locked: true`, `homeIsKiosk: true`.
        If the lifeline does not answer within five minutes, go to the first
        section of this file.
11. [ ] Leave it for a day (the checks under "A day later").
12. [ ] **Last: make it permanent in the device file.** Everything above lives in
        stored overrides, which a lifeline settings reset deletes. In
        `devices/<device>.yml` set `lockdown.required: true`, set this device's
        coexistence switches to `true`, and copy `lockdown.allowedApps`,
        `launcher.allowed` and `webview.allowedOrigins` in as defaults. Bump
        `shell.versionCode`, rebuild, `verify-build`, and install with
        `dd update <apk-url> <sha256>`. Afterwards `dd lockdown` reads
        `required: true`; `dd settings set lockdown.enabled false` answers 400;
        `dd lifeline reset-settings` leaves the device locked (set the secrets
        again after it). From here lockdown is relaxed only by an unlock, which
        always ends.

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
      `dd lockdown lock`: a recall is attempted (`lastRecall.how` reads
      `service-start-unverified`, `a11yBound: false`: Android may ignore a start
      from the background, and the app says so), recalls back off instead of
      repeating every second (`recallsHeldBack` rises), and the service is back
      within 30 seconds, after which the recall takes.

**Unlocking.**

- [ ] `dd lockdown unlock 2`: `relockAtMs` two minutes out; other apps can be
      opened; it relocks by itself.
- [ ] `dd lockdown unlock`: relocks after `lockdown.maxUnlockMin`.
      `dd lockdown lock`: at once.
- [ ] Split screen and picture-in-picture cannot be entered with the kiosk: the
      Activity is not resizable. If another app's window does end up active beside
      it, the watcher recalls (`lastRecall.reason` starts "not allowed beside the
      kiosk").
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
uninstalled, and their settings were never changed. Every step is needed; a
rollback that skips one leaves two apps holding one device.

1. [ ] Unlock, so nothing is recalled while switching.
       - Before stage 10's step 12: `dd settings set lockdown.enabled false`. It
         is applied at once (owner mode leaves lock task and gives the status bar
         back).
       - After step 12 (`lockdown.required: true` is compiled in):
         `dd lockdown unlock 60` for the time being, and for a rollback that is to
         last, build with `lockdown.required: false`, bump the version code and
         install it (`dd update`, or ADB). The setting cannot be changed on the
         device, and that is its purpose.
       - If the control port does not answer: `dd lifeline owner-release` where
         this app is the owner, and go on over ADB. With Fully as home and this
         app stopped, nothing recalls.
2. [ ] Portal, if this app is device owner: release its policy,
       `dd lockdown owner release` (`mode: app`; the home preference, lock task,
       restrictions and hidden packages are undone), then move ownership back:
       `dd settings set lockdown.ownerTransferTarget net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver`
       and `dd lockdown owner transfer net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver`.
       If the transfer back is refused, this app stays the owner with nothing
       applied; the old helper then runs without owner authority (no lock task).
3. [ ] Turn the coexistence switches back off, so this app lets go of the hardware
       before the old helper is started: each one with
       `dd settings set <key> false`. `dd status`: every one `active: false`.
4. [ ] Stop being a home candidate: `dd lockdown home off` (`homeAlias: disabled`).
       Then make Fully the home app again:
       `adb -s <serial> shell cmd package set-home-activity <fully-home>`
       and resolve HOME to confirm.
5. [ ] Start Fully: `adb -s <serial> shell am start -n <fully-home>`. Its start
       page loads. A force-stopped app does not start by itself, at boot or
       otherwise, until it is opened once: this start is that once.
6. [ ] **Restore Fully's accessibility grant.** A force-stop removes an app's
       service from the enabled list on some Android versions. Read
       `adb -s <serial> shell settings get secure enabled_accessibility_services`
       and compare with stage 1's value; put back what is missing by writing the
       whole stage 1 value plus anything added since:
       `adb -s <serial> shell settings put secure enabled_accessibility_services "<value>"`
       and `adb -s <serial> shell settings put secure accessibility_enabled 1`.
7. [ ] Start the old helper again (its launcher activity or its service, as it
       was started before; it too was force-stopped and will not start at boot
       until opened), and check its own status route. Portal:
       `pkctl resume-policy` and `pkctl kiosk-verify`.
8. [ ] Restore the saved `content_control` and `volume` blocks for this device,
       including the original Fully port and auth reference. Restart the backend (a config reload does not switch the adapters). On the
       piano tablet also remove `bridge_provider` and see `piano-cutover.md`.
9. [ ] Stop this app so it holds nothing the old apps need:
       `adb -s <serial> shell am force-stop <package>`.
       A force-stopped app stays stopped across reboots until it is opened. If
       the rollback is to last, also disable it:
       `adb -s <serial> shell pm disable-user --user 0 <package>`
       (`pm enable <package>` undoes it).
10. [ ] Restore anything else stage 1 saved that has changed: the old helper's
        config, Fully's whitelist (`fkb get kioskAppWhitelist` reads as recorded).
11. [ ] Confirm with `fkb info` and `fkb shot` that the kiosk is as it was in
        stage 1, and reboot once to see Fully, the old helper and their
        accessibility services come back by themselves.
12. [ ] Write down what failed and at which line of this runbook.

## Record

| Device | Android | Stage reached | Date | Home candidates unchanged by install | Lifeline back after reboot (n of 3) | ADB back after reboot | Open failures |
|---|---|---|---|---|---|---|---|
| Portal | | | | | | | |
| Piano tablet | | | | | | | |
| Shield | | | | | | | |

Portal ownership transfer (`transferOwnership`, API 28, untested on this firmware):

| Direction | Date | Result | Exception, if refused | Firmware build |
|---|---|---|---|---|
| Old helper to this app | | | | |
| This app to old helper | | | | |
