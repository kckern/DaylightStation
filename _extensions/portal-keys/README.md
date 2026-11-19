# portal-keys

Repurposes the Facebook Portal 10" panel's **volume buttons** for the DaylightStation kiosk.

- `VOLUME_UP` / `VOLUME_DOWN` → the SPA's software master volume (`ScreenVolumeProvider.step`)
- `VOLUME_DOWN` double-press → sleep the display via FKB REST
- any volume key while asleep → wake the display, volume unchanged

It also **auto-dismisses Portal's swipe-up Control Center** (volume/brightness/bluetooth) — see
[Control Center suppression](#control-center-suppression).

Package `net.kckern.portalkeys`. Control plane on `:8771` (piano-bridge uses `:8770`).

The final installed shell also owns a payload lifeline on `:8772`; its active,
hot-swappable operations payload serves `:8773`. Normal APK replacement is not the
routine upgrade path anymore. See [Persistent shell and zero-tap payloads](#persistent-shell-and-zero-tap-payloads).

---

## ⚠️ READ THIS FIRST — apply `keepawake` BEFORE enabling the sleep gesture

With the display off, **the Portal drops WiFi**, taking FKB REST, `pkctl` and ADB-over-WiFi with
it. The panel becomes unmanageable until someone physically presses a button.

This bit us on 2026-07-21: the first successful sleep took the panel off the network for the rest
of the session and nothing could be verified remotely.

```bash
FKB_HOST=<portal-ip>:2323 node cli/fkb.cli.mjs keepawake   # sets the wake locks
node _extensions/portal-keys/pkctl.mjs preflight           # verifies them
node _extensions/portal-keys/pkctl.mjs config set screenToggleEnabled true
```

`keepawake` sets `setWifiWakelock` and `preventSleepWhileScreenOff`. The piano
tablet has had these for ages; the Portal never did.

Two guardrails now enforce that order rather than relying on anyone reading this:

- **`screenToggleEnabled` defaults to `false`** — a fresh install can never strand a panel.
- **`config set screenToggleEnabled true` runs `preflight` first** and refuses if the wake locks
  aren't set. `--force` overrides, and says so.

`preflight` exits non-zero when unsafe, including when FKB is unreachable, so it fails closed.

### Display-state fix installed — `isPanelLit()` (2026-08-29)

`PortalKeysService` now reads the DISPLAY's own power state
(`Display.getState() == STATE_ON`) instead of `PowerManager.isInteractive()`,
in both the key handler and `isDisplayOn()`. On this Portal `isInteractive()`
does not track the backlight — FKB reported `screenOn:true` on a visibly dark
panel — so the wake branch never fired and a press meant to wake the display
fell through to the double-press SLEEP instead. The device log caught it:

```
11:56:18 key KEYCODE_VOLUME_DOWN down interactive=true   ← trying to wake it
11:56:21 double-press-sleep fired
11:56:21 screen-off ok=true                              ← it slept again
```

This fix is compiled and installed in shell version 16. The sleep gesture remains
disabled by policy until its wake-lock preflight is deliberately enabled:

```bash
PK_HOST=<portal-ip>:8771 node _extensions/portal-keys/pkctl.mjs config set screenToggleEnabled true
```

`screenToggleEnabled` is **false** on the live Portal. With it off, nothing can
sleep the panel by gesture, so a wake-lock regression cannot strand it.

### If the panel is dark and unreachable

1. Press a volume key on the device. The wake path is a loopback call to `127.0.0.1:2323`, so it
   does not need WiFi — it *should* work.
2. If that does nothing, power-cycle the panel.
3. Once back: apply `keepawake` immediately, before doing anything else.

---

## Hardware constraints (measured, not assumed)

Three walls, all found on real hardware and none predictable from the design. Documented so nobody
re-derives them:

### 1. The camera button is unusable

It emits `KEY_MUTE`, but it is wired to Portal's **privacy subsystem at the HAL level**:

```
audio_extn_fb: audio_extn_fb_set_privacy_mode: privacy_mode set to 0
PrivacyModeController: exitPrivacy [false]
32R: Privacy status updated cameraEnabled=true, microphoneEnabled=true
```

It never enters normal key dispatch, so **no `AccessibilityService` can see it** — the service
logged 16 key events during testing, every one a volume key, not a single `KEYCODE_MUTE`.

Reading the resulting privacy state is gated behind `com.facebook.permission.prod.FB_APP_COMMUNICATION`,
a Facebook signature permission an untrusted app cannot hold. `dumpsys audio` exposes no mic-mute
field either. There is no way in.

Note `getevent` *does* show `KEY_MUTE` at the kernel layer, including while dozing. That proves
nothing about framework delivery — the kernel seeing a key and an app receiving it are different
layers, and for this key the second never happens.

### 2. Long presses never arrive

Holding `VOLUME_DOWN` fires the firmware's own binding:

```
WindowManager: powerLongPress :LONG_PRESS_POWER_GLOBAL_ACTIONS
GlobalActions: showDialog
```

The power menu appears and this service sees **zero** key events for the whole hold, while short
presses arrive normally. So: no hold-to-sleep. Volume-up + volume-down together is out for the
same reason (that's Android's 3-second accessibility shortcut).

**Only short presses of the volume keys are available.** Hence the double-press gesture.

### 3. Display off ⇒ no network

See the warning at the top.

---

## Control Center suppression

Swiping up from the bottom edge opens Portal's Control Center (volume / brightness / bluetooth),
which on a kiosk is never wanted. The service closes it the moment it opens.

Toggle (default **on**; unlike `screenToggleEnabled` a wrong value here cannot strand the panel):

```bash
node _extensions/portal-keys/pkctl.mjs config set blockControlCenter false
```

### The volume-key beep

Facebook's own `KeyEventAccessibilityService` gets its own copy of every volume
key — accessibility services are not a chain, so our consuming the key does not
reach it — and its Control Center answers with a loud tone on the
voice-assistant audio path. `sound_effects_enabled=0` does NOT silence it. The
fix is to take that service out of `enabled_accessibility_services`, and a
reboot or a vendor update can put it back: the 2026-09-10 school session hit it
again eleven hours after a reboot, every press a beep at a child studying while
the house slept.

No ADB needed — the ops payload holds `WRITE_SECURE_SETTINGS`:

```bash
export PK_HOST=<portal-ip>:8771
node _extensions/portal-keys/pkctl.mjs beep        # show the list; flags the beeping service
node _extensions/portal-keys/pkctl.mjs beep fix    # remove it, keep everything else
```

`beep fix` removes only services that mention `KeyEvent` and are not ours;
the Portal's other services and `PortalKeysService` stay. Needs the admin
token (`bootstrap-token`, or `PK_TOKEN`). The household keeps a copy at
`data/household/auth/apk-tokens.yml` under `portal-key`, so from the prod
host it is:

```bash
PK_TOKEN=$(sudo docker exec daylight-station sh -c 'cat data/household/auth/apk-tokens.yml' | awk '/portal-key:/{print $2}')
```

`setting get|set [ns] <key> [value]` is the general form for any other row.
Verified 2026-09-10: removed both spellings of the service; `serviceBound`
stayed true and the panel stayed up.

**Payload `p3-quiet-volume` does this by itself.** `VolumeBeepGuard` runs the
same removal when the payload starts (every boot — the shell is START_STICKY
and restarts on BOOT_COMPLETED) and again whenever
`enabled_accessibility_services` changes under it, via a `ContentObserver`;
our own write re-fires the observer, the second pass finds nothing, and it
stops. Each removal is a `BEEP` line in the shell log. `POST
/accessibility/silence-beep` on `:8773` runs one pass on demand. Build the
payload jar on the Mac and swap it in over the air (see [Zero-tap payload
upgrade](#zero-tap-payload-upgrade)); until that ships, `pkctl beep fix`
after every reboot.

### Legacy behavior without device-owner package hiding

All measured on hardware 2026-07-21 against `com.facebook.alohaapps.controlcenter`:

| Attempt | Result |
|---|---|
| `pm disable-user` + force-stop | Sets `enabled=3`, but the package is `SYSTEM PERSISTENT` so the system restarts it. **Verified across a full reboot** — both windows returned. |
| `pm disable` (full) | `SecurityException: Shell cannot change component state` |
| `pm suspend` | `SecurityException: needs SUSPEND_APPS` |
| `appops SYSTEM_ALERT_WINDOW deny` | Applied cleanly, did nothing — a `PRIVILEGED SYSTEM` app drawing `ty=KEYGUARD_DIALOG` is exempt |
| A toggle in `settings` global/secure/system | No such key exists |
| An overlay of our own | Its gesture strip sits at `mBaseLayer=201000`, above anything a non-system app can draw |

Those shell-only results do not apply to the managed policy controller below.
Device-owner package hiding, combined with disabled packages and a reboot, prevents
both menu packages from starting on the tested firmware. The standard status-bar
policy alone leaves the top strip visible.

### How the dismissal works

**Detection is by geometry, not package** — accessibility reports these windows with `title=null`
and no package attribution, so there is nothing to match by name. What is unambiguous is the shape
change: closed, the panel parks a 984×25 gesture strip on the bottom edge
(`Rect(148,775 - 1132,800)` at 1280×800); open, it becomes a full-screen `TYPE_SYSTEM` window. The
threshold is a loose ≥80% of each axis so a rotation or resolution change doesn't quietly stop
matching.

**Dismissal is a synthetic swipe, not BACK.** `performGlobalAction(GLOBAL_ACTION_BACK)` does *not*
close it — the panel is `NOT_FOCUSABLE`, so the accessibility BACK routes to the focused window
(Fully) instead. That scored **0/5** even with six retries, while a real injected
`input keyevent BACK` closed it every time; accessibility cannot inject key events, so that route
is unavailable. `dispatchGesture` with a downward swipe — the panel's own dismiss gesture — scored
**5/5**, and **3/3 again after a reboot**. A tap outside also closes it (`WATCH_OUTSIDE_TOUCH`) but
was rejected: once the panel is gone, that tap lands on whatever the SPA is showing.

**Timing matters.** Firing the instant the panel is detected dismisses nothing — the event arrives
mid-animation and the gesture is dropped, and since the panel then sits open no further
`TYPE_WINDOWS_CHANGED` arrives to retry. So the service waits 400 ms, then verifies and retries up
to 6 times before giving up.

Three config flags move together in `accessibility_service_config.xml` and dropping any one makes
the dismissal silently never fire: `typeWindowsChanged` (the panel is `NOT_FOCUSABLE`, so
`typeWindowStateChanged` never arrives), `flagRetrieveInteractiveWindows` (`getWindows()` returns
empty without it, and Android refuses the flag unless `canRetrieveWindowContent` is true), and
`canPerformGestures`. Confirm all of them landed with:

```bash
adb shell dumpsys accessibility | grep 'Portal Keys'
# want capabilities=41  = window content (1) + filter key events (8) + perform gestures (32)
```

A `capabilities` value missing 8 means the volume keys have silently stopped working.

---

## Build

No `java` on PATH; the Gradle wrapper jar is unreliable here (same as piano-bridge), so use the
extracted distribution directly:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home
GRADLE=~/.gradle/wrapper/dists/gradle-7.5.1-bin/*/gradle-7.5.1/bin/gradle
cd _extensions/portal-keys/app && $GRADLE :app:assembleDebug --no-daemon
```

APK → `app/app/build/outputs/apk/debug/app-debug.apk`. **Bump `versionCode` on every build** —
`install -r` rejects a lower one.

The same build creates the configured payload jar and `.sha256`, then bakes that
jar into the APK as the recovery payload. Shell 36 builds
`p10-ordered-owner-transfer.jar`. An APK replacement preserves the active payload
pointer. Use `pkctl payload <jar-url> <sha256>` to activate the approved jar and
`pkctl payload` to check its active version.

Run the shell and payload tests with the same Gradle 7.5.1 distribution:

```bash
$GRADLE :app:testDebugUnitTest :payload:testDebugUnitTest :app:assembleDebug --no-daemon
bash verify-cutover-apk.sh app/build/outputs/apk/debug/app-debug.apk <android-build-tools-dir>
```

Use the [Portal cutover runbook](../../__docs/runbooks/android/portal-cutover.md)
to record the approved artifact digests and compare the signer with the installed APK.

## Persistent shell and zero-tap payloads

This follows the piano-bridge shell/payload design. The original unprovisioned
Portal would not silently install APK updates. A USB-installed shell supports
executable dex payloads in app-private storage:

- `PortalBridgeService` is a foreground `START_STICKY` service, restarted by
  `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`.
- Shell lifeline `:8772` is independent of both Fully and the accessibility service.
  It can fetch, SHA-256 verify, activate, restart, and roll back payload jars.
- The operations payload serves authenticated diagnostics and repair on `:8773`:
  app-UID `/exec`, `InputDevice`/USB inventory, Bluetooth scan/bond/HID-host
  controls, logcat, secure-setting reads/writes, and accessibility self-repair.
- Payload p2 claims allowlisted USB boot keyboards directly through `UsbManager`
  and emits decoded events only on loopback WebSocket `127.0.0.1:8774`.
- A broken operations payload cannot remove the lifeline; use `pkctl rollback`.
- Both remote ports — and, since shell 17, `GET /update` on `:8771` — require a
  device-generated 256-bit admin token. The token is captured once over USB with
  `pkctl bootstrap-token`; it is never returned over LAN. Before shell 17 `/update`
  was ungated and anyone on the LAN could point the panel at an arbitrary APK.
  The CLI stores it mode `0600` at `~/.config/daylight/portal-keys-token` (override
  with `PK_TOKEN_FILE` or provide `PK_TOKEN`).

### Configuration mutation authorization

Shell version 28 requires the same device-generated admin token for **every**
legacy configuration mutation on the key-bridge port. Redacted configuration
reads remain available. This prevents a LAN client from disabling Control Center
suppression, changing the Fully credential, or disabling presence reporting with
an unauthenticated URL. Updated `pkctl config set`, `fkbpw`, and `lockdown-token`
send the token automatically. Older shells did not protect this endpoint.

### One final USB bootstrap

Run this after installing version 16. These development grants persist across app
updates and reboots; they are lost only by uninstalling the package.

```bash
adb -s <portal-serial> install -r _extensions/portal-keys/app/app/build/outputs/apk/debug/app-debug.apk
adb -s <portal-serial> shell pm grant net.kckern.portalkeys android.permission.READ_LOGS
adb -s <portal-serial> shell pm grant net.kckern.portalkeys android.permission.DUMP
adb -s <portal-serial> shell pm grant net.kckern.portalkeys android.permission.WRITE_SECURE_SETTINGS
adb -s <portal-serial> shell appops set net.kckern.portalkeys REQUEST_INSTALL_PACKAGES allow
adb -s <portal-serial> shell am start -n net.kckern.portalkeys/.MainActivity
node _extensions/portal-keys/pkctl.mjs bootstrap-token <portal-serial>
```

Keep the existing accessibility grant. Verify all three remote doors before removing
USB for the last time:

```bash
node _extensions/portal-keys/pkctl.mjs status       # legacy key bridge :8771
node _extensions/portal-keys/pkctl.mjs shell        # durable lifeline :8772
node _extensions/portal-keys/pkctl.mjs input        # ops payload :8773
node _extensions/portal-keys/pkctl.mjs hid status   # USB HID bridge + allowlist
node _extensions/portal-keys/pkctl.mjs bt status    # Bluetooth state and bonds
node _extensions/portal-keys/pkctl.mjs exec id
node _extensions/portal-keys/pkctl.mjs enable-a11y  # idempotent self-repair test
```

### Zero-tap payload upgrade

Build and serve the jar and its hash, then ask the shell—not Android's package
installer—to activate it:

```bash
cd _extensions/portal-keys/app
./gradlew :payload:payload -PpayloadVersion=p2-example
node ../pkctl.mjs payload http://<host>:<port>/p2-example.jar <sha256>
node ../pkctl.mjs shell
```

Payload swaps require no Android confirmation. Full APK replacement remains only for
manifest/native/shell changes and may require a physical confirmation; put all routine
logic in the payload.

## Home selection watchdog

Payload `p4-home-watchdog` introduced a Home watcher inside the boot-started foreground
bridge, independently of Fully and the accessibility binding. It listens for
Android preferred-activity changes and also resolves `ACTION_MAIN` + `CATEGORY_HOME`
every second. Only Fully's `LauncherReplacement` and `FakeLauncher` are accepted;
a chooser, unresolved Home, or another launcher is a breach.

```bash
node _extensions/portal-keys/pkctl.mjs kiosk-home
```

The authenticated `GET /kiosk-home` on the operations port reports the actual
component, last check time, incident count, repair authority, pending alerts,
delivery errors and heartbeat age. `ready` describes **monitoring readiness**;
`permanentHomeProtected` requires the native policy authority added in p5. Neither `homeCorrect` nor Fully's
`kioskLocked` flag establishes an Android lock-task boundary.

On a breach, the watcher attempts Home assignment only when it holds
`SET_PREFERRED_APPLICATIONS`, verifies by observing actual Home again, and brings
Fully to the foreground. The stock APK does **not** hold that signature permission;
it reports `denied-no-home-authority` rather than claiming repair. The app-UID
`/exec` endpoint does not acquire the privileges of a USB ADB shell.

Loss and recovery events are queued in private preferences before delivery.
Authenticated `POST /kiosk-home/webhook` accepts a JSON body with a secret `url`
for an HTTP(S) notification receiver. The URL is never returned by status.
Delivery retries on network errors and non-2xx responses; a recovery cannot
discard an undelivered breach. The queue is bounded at 128 events; storage/queue
errors make health fail rather than reporting readiness. The receiver should
use event sequence numbers for duplicate suppression when needed.

The receiver handles `home-lost/restored`, `policy-lost/restored`,
`fkb-lost/restored`, and `heartbeat` events. Heartbeats carry `checkedAt` and
`fkbCheckedAt` so an independent server detects either checking thread stopping,
as well as a dead APK. The receiver must judge that freshness on the Portal's
own clock (`at − checkedAt`, `at − fkbCheckedAt`), never against its own `now()`:
the two clocks differ by a few hundred ms, and a `0 <= now − checkedAt` test
rejected every heartbeat whose check landed in that window — runs of three made
false 15-second silences and paged the phone ~30 times a day (2026-11-15..17).
Arrival proves liveness; a loose bound on `at` against the receiver's clock only
catches a device clock gone badly wrong. The deployed Home Assistant receiver
notifies the parent's phone on breach and recovery; an independent five-second
check alerts after fifteen seconds without a recent check report. Configure
its webhook ID through HA secrets, and keep the URL in the household's private
auth storage. A 2xx webhook acknowledgement proves receiver acceptance, not
physical delivery to a phone; inspect notification-action traces during setup.

**Home permanence and menu suppression are separate enforcement checks.**
The observed down-swipe surface is SystemUI's transient top strip with Back,
Home and Wi-Fi. It is not the bottom-edge Meta Control Center that the older
guard dismisses. Collapsing notifications does not remove that strip, and the
existing immersive/status-bar settings do not disable it. The managed controller
below hides both packages. Verify both native lock task and actual gesture behavior
after provisioning. A watchdog cannot report its own complete death; keep
independent supervision enabled.

## Managed kiosk policy controller (p7, shell 32+)

Portal Keys can be provisioned as Android's **device owner** while **Fully remains
Home**. The helper does not register any HOME activity. Its `PortalAdminReceiver`
and Android-bound `PortalOwnerService` let the system maintain the controller
independently of Fully's activity or the accessibility binding.

When provisioned, `KioskPolicy` applies persistent HOME resolution to Fully,
allowlists only `de.ozerov.fully` in Android lock task, disables all optional
lock-task features, and applies status-bar, uninstall, app-control, safe-boot,
factory-reset restrictions. It clears `DISALLOW_CREATE_WINDOWS`, which otherwise
breaks Fully's required overlay permission. It starts Fully in true lock task
using the Android 9 device-owner launch API. Extra Chrome apps are hidden unless
they provide the active WebView engine. It writes the whole policy once at startup
(and after any failed pass), then every five seconds **reads each setting back and
writes only what drifted** (`PolicyReconciler`); `/kiosk-home` reports
`enforcement.driftRepairs` and `lastDrift`. Status bar, keyguard and organization
name cannot be read back by a device owner on API 28 (`getOrganizationName` throws
`SecurityException` outside a managed profile), so they are written only on that
first pass. A readback that throws skips that one setting for the pass; it must
never fail the pass, because a failed pass rewrites everything on the next
one-second tick (p7.2 did exactly that and was rolled back). It checks actual
lock-task state on the one-second watchdog tick.

Do not go back to rewriting the policy blindly on a timer. Through p10 every pass
rewrote everything; each pass cost Fully a ~1.6 s main-thread stall (Android logged
`Activity pause timeout` and skipped frames, and Fully's REST server stopped
answering). That is longer than the Fully guard's 1.5 s `deviceInfo` timeout, so
the guard reported `fkb-lost` and then `fkb-restored` 2 s later, every 20-35 s. It
started a few hours after boot and grew to ~100 false breaches an hour
(2026-11-18/19). The lock itself never dropped: every failed check was a
`SocketTimeoutException`.
After a native task loss it recreates Fully's task on the first repair launch;
launching an existing unpinned task does not apply lock-task options on this ROM.

It hides `com.android.systemui` and `com.facebook.alohaapps.controlcenter` through
device-owner policy. During provisioning, also disable both packages with
`adb shell pm disable-user --user 0 <package>`, then reboot. Hiding/disable flags
do not remove already-running persistent windows on this firmware. Verify the
processes are absent and both edge swipes show only the working school page.
Disable keyguard through device policy before removing SystemUI.

For administrative recovery, authenticated `POST /kiosk-policy/system-ui` with
`{"hidden":false}` stops the helper from hiding those packages. Use authorized
ADB to `pm enable --user 0 <package>` for both packages, then reboot. The inverse
API request restores hiding. Keep a verified ADB recovery path available.

`FkbGuard` separately reads Fully's kiosk flags through its password-protected
loopback API every two seconds. A disarm triggers a relock attempt; only a later
readback counts as recovery. Credentials stay in private preferences and are
never included in status. Home, native-policy, and Fully loss/recovery events
share the persistent alert outbox. Fully transitions remain pending until that
outbox accepts them; storage failures keep monitoring unhealthy and retry on each
Home check, preserving breach/recovery order even when Fully recovers first.
Independent heartbeat monitoring detects a
stopped Home checking thread; heartbeat payloads also carry the Fully-check time.

```bash
node _extensions/portal-keys/pkctl.mjs kiosk-verify
```

This asserts current reported policy, actual Home resolution, native lock-task
readback and allowlist/features, Fully lock, and alert readiness. It is a runtime
check, not a substitute for gesture, app-launch, process-death and reboot tests.
`ready` describes monitoring; `kioskProtected` additionally requires native
policy, true lock task, correct Home, hidden menu packages, and a recent
locked-Fully readback. Hidden flags alone do not prove existing windows are gone.

The stock ADB device-owner command rejects this Portal's Meta accounts. A pinned,
exact-firmware Portal provisioner can establish the controller role through
temporary root without removing accounts. Use a reviewed, narrowly scoped owner
adaptation for `net.kckern.portalkeys/.PortalAdminReceiver`; do not run the upstream
full Kiosk Satellite profile. It targets a different app and includes account
removal and unrelated changes. Keep the provisioning patch, build hashes and
native verification output in the private ops evidence. Kernel provisioning
requires explicit authorization and a backup. The upstream connection driver
expects a network ADB address; enable authorized TCP ADB from USB first rather
than passing the USB serial to its reconnect loop.

## Handing device ownership to DaylightStation Android

Portal Keys can give its device-owner role to the DaylightStation Android app
without a factory reset, using `DevicePolicyManager.transferOwnership` (Android
API 28). **That API has never been run on this Portal firmware.** Everything
below is compiled and unit-tested on the JVM against a fake; the Android calls
themselves are unproven until a real transfer is attempted on hardware.

```bash
export PK_HOST=<portal-ip>:8771
node _extensions/portal-keys/pkctl.mjs transfer-owner
```

The command sends the admin token and calls the operations payload:

```
POST http://<portal-ip>:8773/owner/transfer
X-Portal-Token: <admin token>
{"to":"net.kckern.daylight.portal/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver"}
```

The route needs the admin token like every other route on `:8773`. In order, it:

1. Refuses any `to` other than exactly that component (`400`,
   `error: target-not-allowed`). Nothing is touched.
2. Refuses below API 28 (`409`, `api-28-required`) and when this app is not
   device owner (`409`, `not-device-owner`). Nothing is touched.
3. Sets a persisted hold so `KioskPolicy.enforce()` stops re-applying policy.
4. **Releases the policy this app applied**, so the receiving app starts clean.
   On API 28 a transfer carries the outgoing owner's policies over to the new
   owner, which is why they are undone first:

   | Step | Call |
   |---|---|
   | `persistent-home` | `clearPackagePersistentPreferredActivities(admin, "de.ozerov.fully")` |
   | `lock-task-packages` | `setLockTaskPackages(admin, {})` (also ends Fully's pinned task) |
   | `lock-task-features` | `setLockTaskFeatures(admin, LOCK_TASK_FEATURE_GLOBAL_ACTIONS)`, the documented default |
   | `status-bar` | `setStatusBarDisabled(admin, false)` |
   | `keyguard` | `setKeyguardDisabled(admin, false)` |
   | `uninstall-block` | `setUninstallBlocked(admin, "de.ozerov.fully", false)` |
   | `user-restrictions` | `clearUserRestriction` for `DISALLOW_SAFE_BOOT`, `DISALLOW_FACTORY_RESET`, `DISALLOW_ADD_USER`, `DISALLOW_APPS_CONTROL` |
   | `organization-name` | `setOrganizationName(admin, null)` |
   | `hidden-packages` | `setApplicationHidden(admin, pkg, false)` for `org.chromium.chrome`, `com.android.chrome`, `com.facebook.alohaapps.controlcenter`, `com.android.systemui` |

   If any step throws, the rest are still attempted, the transfer is skipped
   and the answer is `500`, `release-incomplete`, with the failures listed.
5. Calls `transferOwnership(admin, target, null)`.

The answer reports `ok`, `policyReleased`, `transferred`, the `released` steps,
any `releaseFailures` and a `note`. An exception from `transferOwnership` is
caught and returned as `500`, `error: transfer-failed`, with `exception` (the
class name) and `message`. In that case the policy **stays released**: this app
is still device owner, the kiosk is open, and nothing is put back by a timer, a
payload restart or a reboot. Re-arm it explicitly:

```bash
node _extensions/portal-keys/pkctl.mjs resume-policy   # POST :8773/owner/resume-policy
```

Things the release does not undo, because `KioskPolicy` never applied them
through device policy: the `pm disable-user` done over ADB during provisioning
for SystemUI and the Control Center (un-hiding does not re-enable them), Fully's
own kiosk lock, and the secure-settings writes made by the beep guard.
`DISALLOW_CREATE_WINDOWS` is cleared by `enforce()`, never set, so there is
nothing to restore.

While the hold is set the Home watchdog stops pulling Fully to the foreground,
so it does not fight a new Home app. It keeps observing and still queues
`home-lost` and `policy-lost` alerts, which are accurate: this app is no longer
protecting the panel. Uninstall or disable Portal Keys once the new app has
taken over.

**A payload rollback to p8 or earlier removes the hold logic.** If this app is
still device owner at that point (a failed transfer), the older payload
re-applies the full kiosk policy on its next tick.

### Ownership coming back to this app

The cutover shell declares `<support-transfer-ownership />` in
`res/xml/device_admin.xml` and implements `PortalAdminReceiver.onTransferOwnershipComplete`. The framework
checks that tag on the **receiving** admin, so it matters only when the new app
transfers ownership back here. The receiver sets the same hold and writes an
`OWNER` line to the shell log; it applies no policy. Run `resume-policy` to
start enforcement again.

### Which half, and how it reaches the panel

| Change | Half | How it gets onto the device |
|---|---|---|
| `/owner/transfer`, `/owner/resume-policy`, `OwnerTransfer`, the release steps and the hold in `KioskPolicy`/`HomeWatchdog` | payload `p10-ordered-owner-transfer` | Zero-tap payload swap: `pkctl payload <jar-url> <sha256>` (see [Zero-tap payload upgrade](#zero-tap-payload-upgrade)). No Android confirmation. |
| `<support-transfer-ownership />`, `onTransferOwnershipComplete` | persistent shell, `versionCode 36` | Full APK replacement: `adb install -r`, or `pkctl update <apk-url>`, which needs the Package Installer confirmation on the panel (one tap, or the accessibility service approving its own update dialog). |

Use the verified shell and payload together for the rehearsal. Lock task and
the hidden SystemUI can get in the
way of the installer dialog, so prefer ADB for the shell on a locked panel.

## Keyboard transports measured on this Portal

### Bluetooth

Classic Bluetooth discovery works and Android's HID Host service is loaded. A
Bluetooth 3.0 BR/EDR keyboard is therefore the clean native path: Android delivers
its keys normally to Fully and the SPA, including the configured Android input method.

**BLE also works — corrected 2026-09-09.** An earlier version of this section said BLE
discovery was broken in this vendor build. That was wrong, and the wrong conclusion cost
real time, so the correction is recorded in full.

#### One null explains every LE symptom

The Portal omits `android.hardware.bluetooth_le`, and `BluetoothManagerService`
consequently never obtains the `IBluetoothGatt` binder. Confirmed by reading the binder
directly (`pkctl bt diag`):

```
featureBluetoothLe:   false
leScannerNull:        false      <- the scanner object exists
multipleAdvertisement true
offloadedFiltering:   true       <- the controller claims full LE support
iBluetoothGattNull:   true       <- the actual wall
gattServerNull:       true
```

Every previously catalogued LE failure descends from that single null, because each one
reads the same binder and gives up when it is missing:

| Symptom | Where the null bites |
|---|---|
| `connectGatt()` returns `null` | framework's literal "BLE is not supported" branch |
| `SCAN_FAILED_INTERNAL_ERROR` (`3`) | `startScan()` posts exactly this when `getBluetoothGatt()` is null |
| no advertiser, no LE bond | same binder |

The radio and controller are fine. `mMaxScanFilters: 0` and `bte_scan_filt_param_cfg_evt, 23`
are downstream noise, not the cause.

#### Getting around it — three moves

1. **Bind `GattService` directly.** It runs inside `com.android.bluetooth` and publishes an
   intent filter for `android.bluetooth.IBluetoothGatt`, which makes it implicitly exported
   pre-Android-12. Bind it, then reflect `IBluetoothGatt$Stub.asInterface(binder)`.
   `hidden_api_policy` is already `1` on this Portal, so the reflection is unimpeded.
2. **Give the scanner that binder.** `IBluetoothManager` is an AIDL *interface*, so a
   `java.lang.reflect.Proxy` can answer `getBluetoothGatt()` with ours and delegate the rest
   to the real manager. Construct `BluetoothLeScanner` with the proxy and scanning returns.
3. **Bond with the transport named.** Plain `createBond()` resolves to `TRANSPORT_AUTO`,
   picks BR/EDR against an LE-only keyboard, and dies in
   `btif_dm_auth_cmpl_evt() - Pairing timeout; retrying`. Reflect `createBond(int transport)`
   with `TRANSPORT_LE`.

```bash
node _extensions/portal-keys/pkctl.mjs bt diag              # is the binder missing?
node _extensions/portal-keys/pkctl.mjs bt gatt-direct <mac> # bind GattService, connect
node _extensions/portal-keys/pkctl.mjs bt scan-direct 20000 # LE scan via the proxy
node _extensions/portal-keys/pkctl.mjs bt bond <mac> le     # createBond(TRANSPORT_LE)
```

#### After bonding, this APK is not in the keystroke path

Once the bond exists, Android's own HID host claims the device and it appears in
`dumpsys input` as a normal `InputDevice`. Keys reach the WebView natively. Portal Keys
brokers nothing.

That is the only workable design, not merely the tidier one: **an app cannot read HID
reports over GATT.** `GattService.permissionCheck()` refuses app reads of the HID UUIDs
(`2A4A`–`2A4E`) and of the `0x1812` service unless the caller holds `BLUETOOTH_PRIVILEGED`
— `signature|privileged`, and not grantable with `pm grant`. It shows up as:

```
W/BtGatt.GattService: readCharacteristic() - permission check failed!
```

So do not design a "sniff the keyboard in the APK and republish it on a loopback
WebSocket" bridge. It dies one step past the GATT connection.

#### The bond survives both reboots — verified 2026-09-09

Portal rebooted and keyboard power-cycled, together. 44 seconds after boot, with no
`pkctl` call and nothing bound:

```
Device 5: Bluetooth Keyboard              # dumpsys input
AA:BB:CC:DD:EE:FF [  LE  ] Bluetooth Keyboard   # still bonded
GATT Client Map / Entries: 0              # our client is NOT registered
```

That last line is the proof: Android's HID host re-established the LE link entirely on
its own. **The bind/scan/bond dance is one-time setup, not a runtime dependency.** Nothing
in this APK has to run at boot for the keyboard to work, and a broken payload cannot take
the keyboard down with it.

#### Two traps that look like hardware faults

- **Android refuses unfiltered LE scans while the display is off**
  (`Cannot start unfiltered scan in screen-off`). Wake the panel first or the scan returns
  empty and looks like a dead radio.
- **A multi-host keyboard uses a different BD address per pairing slot.** The address
  another machine shows for *its* slot is the wrong one here — it is only reachable while
  that machine is disconnected, and it will never bond. Always take the address from
  `bt scan-direct` with the keyboard in pairing mode. Keyboard identities belong in the
  household device registry, never in this repo: see
  [`__docs/configuration/portal-keys-bluetooth.example.yml`](../../__docs/configuration/portal-keys-bluetooth.example.yml).

#### Hangul does not survive the trip — compose in the page

Physical-keyboard text on this Portal reaches the WebView with **no IME involvement at
all**. AOSP LatinIME has no Hangul, and `fcitx5` with its hangul plugin installed *and set
as the system default IME* produced zero `compositionstart` events from the physical
keyboard. Korean typing arrives as raw Latin: `dkssud`, not 안녕.

The working answer is to compose in the page — a 두벌식 automaton reading
`KeyboardEvent.code` (so it does not depend on the layout Android believes is attached)
and building syllables itself. The keyboard's globe key arrives cleanly as
`code=F6 keyCode=117`, which makes a fine Korean/English toggle.

### USB boot keyboard fallback

The Sayo 6x4M enumerates in Android's USB framework as `8089:0008`, with interface 0
declaring boot-keyboard HID. This kernel has no `usbhid` driver, so Android never
creates `/dev/input/event*` or an `InputDevice`; a normal WebView cannot receive it.

P2 works below that missing kernel path: it opens the exact allowlisted device with
`UsbManager`, claims only interface 0, decodes eight-byte boot reports, and publishes
browser-shaped key events to `ws://127.0.0.1:8774`. Interface 1 is untouched. USB
permission approval is narrowly automated through the existing accessibility service
only while Portal Keys has an exact permission request pending. Key values and raw
reports are never written to logs.

```bash
node _extensions/portal-keys/pkctl.mjs hid status
node _extensions/portal-keys/pkctl.mjs hid retry
node _extensions/portal-keys/pkctl.mjs hid allow 0x8089 0x0008
```

The frontend opts into this bridge whenever `portalKeys.enabled` is true. Override
with `hidEnabled: false` or `hidPort: 8774` in the screen config.

Pure Java, no NDK/JNI (piano-bridge is Java too; matching it avoids the Kotlin plugin entirely).

## Install + enable

```bash
adb connect <portal-ip>:5555
adb -s <portal-ip>:5555 install -r .../app-debug.apk
```

The `AccessibilityService` must be enabled once. **Append — never overwrite**; the Portal ships
three of its own accessibility services and clobbering the list breaks them:

```bash
CUR=$(adb -s <portal-ip>:5555 shell 'settings get secure enabled_accessibility_services' | tr -d '\r')
adb -s <portal-ip>:5555 shell "settings put secure enabled_accessibility_services '$CUR:net.kckern.portalkeys/.PortalKeysService'"
adb -s <portal-ip>:5555 shell 'settings put secure accessibility_enabled 1'
```

Then push the Portal FKB password from private `household/auth/fullykiosk.yml`
(or explicit `FKB_PW`). Set `DAYLIGHT_BASE_PATH` or `DAYLIGHT_DATA_PATH` when
running outside the configured checkout. The piano tablet cache is never used:

```bash
node _extensions/portal-keys/pkctl.mjs fkbpw
```

### Public-kiosk shutdown

The shared shutdown service can temporarily black out the School and Piano
kiosks after its configured NFC card is scanned. While locked, this APK also
consumes both volume buttons before they can reach the SPA, Android volume, or
the double-press screen control. The deadline is synchronized by authenticated
`PUT /lockdown`; it expires locally even if the server is offline.

Provision a distinct token once (it is redacted from every APK response), then
store the same value in the household auth entry named by
`shutdown/config.yml`'s `portal_keys.auth_ref`:

```bash
node _extensions/portal-keys/pkctl.mjs lockdown-token '<server-only-secret>'
```

**Shell 35 is the first that can actually lock.** Through shell 34,
`handleLockdown` read the body from NanoHTTPD's `postData`, which 2.3.1 fills only
for POST; a PUT body goes to a temp file named in `content`. Every authenticated
`PUT /lockdown` arrived empty, so a Stop was treated as a release and
`lockdownActive` stayed false (measured on the live Portal, 2026-11-17).
`RequestBody.of` reads both.

**Shell 35 is installed (2026-11-17) and `shutdown/config.yml` points at `:8771`.**
Shell APKs must be signed with the key that signed the installed app (the laptop's
debug key, SHA-256 `3663e947…0fb4`). Shell 36 and its paired payload serve ordered
protocol 2 on both `PUT :8771/lockdown` and `PUT :8773/lockdown`. Once an ordered
revision is recorded, the shell uses its ordered deadline for key suppression,
including when an older payload is restored.

Verify a lock after any shell change with an approved short Stop issued by the
safety service on the existing provider path. The response must include
`lockdownProtocolVersion: 2`, the matching `lockdownRevision`, and
`lockdownActive: true`. Confirm it clears at the deadline. The safety service
owns the ordered revisions.

The complete, tracked YAML template is
[`__docs/configuration/public-kiosk-shutdown.yml`](../../__docs/configuration/public-kiosk-shutdown.yml).

### The grant is the fragility

`settings` is denied to `untrusted_app`, so **the APK cannot re-enable itself**. An OS update or
factory reset that drops the grant needs ADB or a human. That is why `pkctl status` leads with
`serviceBound`.

## pkctl

```
node _extensions/portal-keys/pkctl.mjs status   # serviceBound / keysSeen / display / config
node _extensions/portal-keys/pkctl.mjs log      # recent key, screen and config events
node _extensions/portal-keys/pkctl.mjs watch    # live key stream over the WebSocket
node _extensions/portal-keys/pkctl.mjs config set <key> <value>
node _extensions/portal-keys/pkctl.mjs transfer-owner   # release policy, hand device ownership to DaylightStation Android
node _extensions/portal-keys/pkctl.mjs resume-policy    # re-arm kiosk policy after a failed transfer or a transfer back
```

Keys: `fkbHost`, `fkbPassword`, `screenToggleEnabled`, `consumeVolume`, `doublePressMs`,
`lockdownToken`.

`consumeVolume false` is the escape hatch: if the SPA breaks, it hands volume back to Android
without a reinstall or a trip to the panel.

## SPA side

`frontend/src/screen-framework/usePortalKeys.js` + `PortalKeysBridge.jsx`, mounted inside
`ScreenVolumeProvider` in `ScreenRenderer`. Opt-in per screen:

```yaml
# data/household/screens/portal.yml
portalKeys:
  enabled: true
  port: 8771
```

**Deploy prerequisite:** the APK consumes volume keys. If it is enabled while the frontend
carrying `usePortalKeys` is NOT deployed, the panel has *no working volume at all* — the keys are
swallowed and nothing listens. Deploy the frontend first, or set `consumeVolume false` until you do.

The production `https://` SPA can connect to `ws://localhost:8771` on this panel's WebView.
Portal Keys exposes only its hardware-key bridge and administrative diagnostics; it does not request
camera access or provide barcode/QR scanning.

## Bluetooth keyboard for the locked School keypad

Portal Keys is also the source of truth for the Portal's *observed* Bluetooth
state. It reports every bonded device to the backend on startup, Bluetooth ACL
changes, and its configured heartbeat. The backend, rather than this APK or the
web app, decides which keyboard MAC is allowed by `school.yml`'s gate config.

The locked School keypad polls that report and recognizes a BK-3001 by its
reported name. Its status light means:

- **Keyboard connected** — Android HID input is reaching the WebView. Digits
  fill the code, `Backspace` removes one, and `Enter` submits it.
- **Turn on keyboard** — it is bonded but currently disconnected. Turn it on;
  Android reconnects it without a new pairing flow.
- **Pair BK-3001 keyboard** — no matching bond exists. The Portal's supported
  pairing UI is its swipe-up Control Center: temporarily allow it with
  `pkctl config set blockControlCenter false`, swipe up from the bottom edge,
  then put the BK-3001 in pairing mode and complete the Android prompt. Restore
  the control-center block afterwards; the keypad status light refreshes within
  15 seconds.

Pairing remains an Android-system confirmation; the app must never attempt to
create or silently accept a Bluetooth bond. Use the Portal Control Center rather
than assuming a stock Android Settings intent exists on this vendor build. If
ADB is available during recovery, inspect the installed Settings activities
before attempting to launch one; there is no portable component name.

```bash
adb -s <portal-ip>:5555 shell cmd package resolve-activity --brief -a android.settings.BLUETOOTH_SETTINGS
```

Verify the raw reporter state without relying on the frontend:

```bash
curl -sS http://<portal-ip>:8771/presence
```

Look for the BK-3001 in `last.devices` with `connected: true`. A bonded but
disconnected device is still included with `connected: false`; no entry means
the Android bond has not completed (or Bluetooth is off). Do not use a device
name as an access-control rule: names are only the keypad's display matcher;
the backend gate's configured MAC remains the security authority.


## School page evidence and recovery gate

Payload `p9-page-evidence-disabled` and shell version 34 add page evidence to
`GET /status` (`homeWatchdog.page`) and the authenticated `GET /page/journal`.
The journal retains 256 metadata entries: UTC ISO timestamps, device/build/payload,
process/uptime, screen/Stop revision/maintenance, network availability, page age,
incident ID and stage. Permission failures appear as unavailable, never healthy.
No answers, grants, raw input, credentials or full page URLs are recorded.

Provision the exact application HTTPS **origin** through authenticated
`POST /page/config` with `{"origin":"https://<app-host>","recovery":false}`.
Only `POST /page/beat` bypasses the admin token, requiring BOTH an actual loopback
peer and that exact Origin; it accepts at most 2 KiB of JSON. Its contract is
`{protocol:1,build,visible,activityId,seq}`. Preflight allows POST/Content-Type and
private-network access for that origin. Browser visibility is evidence only.
The stable page host sends every five seconds even when School is replaced by a
supervision or shutdown gate. It never sends act, print, grade, or release commands.

The shell reads existing durable Stop/revision and platform display state. A
missing/old shell API, unordered Stop state, unknown display or unknown maintenance
prohibits recovery. Through existing admin-authenticated `/config`, set
`pageRecoveryMaintenanceUntil` to `0` for explicit clearance, or a future Unix-ms
deadline no more than 15 minutes away. Maintenance survives service restart; expiry
or backward clock movement makes it **unknown**, requiring fresh clearance. Stop
always dominates it. No new Stop ledger exists.

The policy proposes foreground/current-page reload after 15 seconds silent, then
restartApp after another 15 seconds. It allows at most two restarts per ten minutes;
the budget commits before dispatch and survives service restart. A changed/unknown
boot conservatively holds restarts for ten minutes. Fresh beats close incidents but
do not erase the budget. The existing durable Home alert outbox records one page
failure per incident. The external watcher still detects native process death as
unreachable; it must not create another recovery authority.

**Active page recovery is hard-disabled in this candidate**, even if an operator
requests it. `PAGE_RECOVERY_VERIFIED=false` is a release gate, not proof of physical
verification. A later reviewed change may remove that gate only after both:

1. The actual Fully HTTPS transport test passes on the chosen device. Compile the
   `:app:assembleDebugAndroidTest` target; deploy/run instrumentation separately under
   rollout authorization. `PageHeartbeatTransportTest` opens the public, credential-free
   `/portal-page-probe.html` fixture from the configured origin in actual Fully and
   asserts matching native receipt. Desktop fetch mocks cannot substitute for this.
2. Recovery preserves required School state for the selected route. Current URL and
   existing backend session/domain evidence survive. `parseSchoolPath` reconstructs
   browsable sections/material paths, but learner program authority stays in memory:
   those reloads return to School. `/go` may mint a new grant and is not a safe
   generic resume path. Unsaved runner drafts are
   not universally checkpointed. Fully `reload`/`restartApp` alone does not prove draft
   recovery. Task 4 must qualify supported resume routes and reject unsafe recovery.

The Fully channel inspection found REST control and browser key delivery, not an
existing trusted page-metadata ingress. If the real HTTPS loopback test fails, inspect
Fully's JS-to-native capability on that exact build before changing transport. No
browser admin token is permitted. Crash/power/network history is available only where
retained; current snapshots cannot reconstruct historical freezes.

The native Home watchdog also separates passive DPC configuration from activity
repair. Both its fallback foreground launch and KioskPolicy's lock-task recreation
read native safety again at dispatch and retain the same hard preservation gate.
Configured preferred Home/allowed packages are not evidence that Fully is foreground
or lock-task readback is healthy. Failed alert admission keeps the complete pending
outbox transaction retryable, restores the acknowledged preference-memory view,
and prohibits delivery until its incident marker and queue commit together.
Fully's retained-head retry acknowledgement survives unrelated admissions. Home
reconciles its committed observation before observing current Home again; policy
commits its state marker with the outbox event. Neither recomputing producer retains
a name-only receipt. Page failures use their durable incident marker.

The local [School incident replay](../../tests/isolated/e2e/school/incident-2026-11-16.test.jsx)
checks real browser controls and grading/printing services with fake fetch/device
transport and temporary YAML records. Lost responses and Space bursts must not
replay work; a remounted page preserves recorded evidence and returns an unsupported
learner-program route to School. An unfinished text draft is deliberately shown
as **not restored**. This is characterization of current authority boundaries,
not qualification of active-runner recovery; `PAGE_RECOVERY_VERIFIED=false` remains.

Before changing that gate, retain private results for both outage windows and qualify
the chosen runner/draft without persisting grants or replaying `/act`. The actual
Fully HTTPS probe, native crash/power/network diagnosis, saved-draft renderer-kill
drill, bounded recovery/alert, sleep immunity and parent Stop all require separately
authorized device acceptance. No local replay or compiled artifact satisfies them.
See the [School replay and acceptance procedure](../../__docs/runbooks/school/logs-and-tracing.md#local-interaction-replay-and-physical-acceptance).
