# portal-keys

Repurposes the Facebook Portal 10" panel's **volume buttons** for the DaylightStation kiosk.

- `VOLUME_UP` / `VOLUME_DOWN` → the SPA's software master volume (`ScreenVolumeProvider.step`)
- `VOLUME_DOWN` double-press → sleep the display via FKB REST
- any volume key while asleep → wake the display, volume unchanged

It also **auto-dismisses Portal's swipe-up Control Center** (volume/brightness/bluetooth) — see
[Control Center suppression](#control-center-suppression).

Package `net.kckern.portalkeys`. Control plane on `:8771` (piano-bridge uses `:8770`).

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

`keepawake` sets `setWifiWakelock`, `setCpuWakelock`, `preventSleepWhileScreenOff`. The piano
tablet has had these for ages; the Portal never did.

Two guardrails now enforce that order rather than relying on anyone reading this:

- **`screenToggleEnabled` defaults to `false`** — a fresh install can never strand a panel.
- **`config set screenToggleEnabled true` runs `preflight` first** and refuses if the wake locks
  aren't set. `--force` overrides, and says so.

`preflight` exits non-zero when unsafe, including when FKB is unreachable, so it fails closed.

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

### It cannot be stopped from opening — don't re-run this list

All measured on hardware 2026-07-21 against `com.facebook.alohaapps.controlcenter`:

| Attempt | Result |
|---|---|
| `pm disable-user` + force-stop | Sets `enabled=3`, but the package is `SYSTEM PERSISTENT` so the system restarts it. **Verified across a full reboot** — both windows returned. |
| `pm disable` (full) | `SecurityException: Shell cannot change component state` |
| `pm suspend` | `SecurityException: needs SUSPEND_APPS` |
| `appops SYSTEM_ALERT_WINDOW deny` | Applied cleanly, did nothing — a `PRIVILEGED SYSTEM` app drawing `ty=KEYGUARD_DIALOG` is exempt |
| A toggle in `settings` global/secure/system | No such key exists |
| An overlay of our own | Its gesture strip sits at `mBaseLayer=201000`, above anything a non-system app can draw |

Device owner (`dpm set-device-owner`) was not tried: it requires no other accounts on the device,
i.e. a factory reset of a working panel, and would likely not reach a custom Facebook component
anyway.

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

Then push the FKB password (never stored in the repo — read from 1Password/cache):

```bash
node _extensions/portal-keys/pkctl.mjs fkbpw
```

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
```

Keys: `fkbHost`, `fkbPassword`, `screenToggleEnabled`, `consumeVolume`, `doublePressMs`.

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

**Unverified:** the SPA was only ever tested against an `http://` dev server. Production is
`https://`, and a `ws://localhost` connection from an `https` page is a mixed-content question
that has not been checked on this panel's Chrome 131 WebView. Piano-bridge does the same thing
successfully on its tablet, which is encouraging but not proof.
