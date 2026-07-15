# Piano Bridge (APK)

> **STATUS: BUILDS + RUNS. sfizz audio + screen-wake + ADB-free self-update all
> verified 2026-07-02 on the SM-T590 (versionCode 10 / `1.6-selfupdate`).**
>
> The APK compiles (NDK r26b + cmake 3.22.1), installs on the tablet, runs the
> foreground service + WebSocket control server on `:8770`, loads the Salamander
> Grand SFZ via the vendored **sfizz** engine, and renders real audio through Oboe
> (confirmed: `render signal peak>0` on note-on, no crash). **Dexed/FM is still
> behind `#ifdef HAVE_DEXED` (silent) — not yet vendored.**
>
> **Verified 2026-07-02:** note→`screenOn poke -> HTTP 200` wake (after the
> `usesCleartextTraffic` fix); live wake-policy reconfig over `:8770` (quiet
> hours/suppress, no reinstall); ADB-free self-update; reboot auto-start via
> `BootReceiver`. **The device should never need USB/ADB again** — see
> *Operate this WITHOUT ADB* below.
>
> ### What it took to build (gotchas, all fixed in this tree)
> - Install toolchain: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 sdkmanager "ndk;26.1.10909125" "cmake;3.22.1"`.
> - Vendor sfizz: `git clone --recursive https://github.com/sfztools/sfizz` into
>   `app/src/main/cpp/third_party/sfizz` (gitignored; ~445 MB). CMake block is now enabled.
> - **Oboe prefab needs `-DANDROID_STL=c++_shared`** (else "No compatible library for //oboe/oboe") + `buildFeatures { prefab true }`.
> - **SM-T590 is Android 10** → `minSdk 29`, and `targetSdk 29` + app-specific external
>   files dir for assets (Android-10 scoped storage / restricted `READ_EXTERNAL_STORAGE`
>   blocks native `fopen` on arbitrary `/sdcard` paths).
> - **Foreground service** (`startForegroundService` + `startForeground`, `foregroundServiceType=mediaPlayback`)
>   so Fully Kiosk can't block the start / kill it. (No mic here, so the audio-bridge
>   `startForeground` avoidance does not apply.)
> - **sfizz `renderBlock(buffers, frames, numOutputs)`**: `numOutputs` is stereo-pair
>   count — must be `1` for one L/R pair (passing 2 → SIGSEGV).
> - Assets live on-device at `/sdcard/Android/data/net.kckern.pianobridge/files/piano-instruments/<id>/`.

A native multi-engine synth host for an Android tablet, driven over WebSocket by
the browser kiosk. It reads the BLE-MIDI piano directly via Android
`MidiManager`, synthesizes audio with a chosen engine (sfizz SFZ-sampler or
Dexed/MSFA DX7 FM), and outputs through Oboe (low-latency). Package
`net.kckern.pianobridge`, app label **"Piano Bridge"**.

This mirrors the sibling `_extensions/audio-bridge/` APK's Gradle wrapper layout
and build conventions, but **diverges on the service lifecycle**: Piano Bridge
runs as a real **foreground service** (`startForegroundService` + `startForeground`,
`foregroundServiceType=mediaPlayback`) to keep the Oboe stream alive when the
WebView is backgrounded. audio-bridge deliberately avoids `startForeground()`
because on Android 11 a foreground service started from a background context loses
mic access — Piano Bridge uses no mic, so that restriction does not apply. See
`_extensions/audio-bridge/DESIGN.md` for the audio-bridge rationale and this
project's `DESIGN.md` "Service lifecycle" for the divergence.

---

## Operate this WITHOUT ADB (the `:8770` control plane)

**Design goal (2026-07-02): the SM-T590 never needs USB/ADB again.** Everything you
used to reach over `adb` is exposed over plain HTTP on `:8770` (NanoHTTPD binds all
interfaces → reachable on the LAN). Drive it with `pbctl.mjs`
(`PB_HOST=10.0.0.245:8770 node pbctl.mjs …`). No auth — same LAN-only trust model as
the Fully REST API (and this plane already exposes `/exec`, an in-sandbox shell).

The privileged perms this relies on are **granted once over USB and then persist**
across reboots *and* across same-signature self-updates (lost only on a full
uninstall). Currently granted on the device: `WRITE_SECURE_SETTINGS`, `READ_LOGS`,
`DUMP`, `ACCESS_FINE_LOCATION`, and the `REQUEST_INSTALL_PACKAGES` appop.

### Screen-wake on a played note (`ScreenWaker`)

A BLE-MIDI note-on pokes Fully Kiosk's `screenOn` REST endpoint on `127.0.0.1:2323`,
so playing the piano wakes a dark tablet even when the WebView is backgrounded (its
Web-MIDI/timers are throttled and can't self-wake). Debounced to one poke per
`cooldownMs`. The DS backend runs an equivalent WS-driven wake; either revives it.

> **Cleartext fix (essential, 2026-07-02):** targetSdk 29 blocks cleartext HTTP by
> default, which silently killed the poke (`Cleartext HTTP traffic to 127.0.0.1 not
> permitted`). Fixed with `android:usesCleartextTraffic="true"`. Verify a real note
> logs `screenOn poke -> HTTP 200` (via `pbctl log` / `pbctl logcat`).

**Wake policy is 100% runtime-configurable over the LAN — no rebuild, no reinstall.**
`POST /config` hot-reloads and rebuilds the `ScreenWaker` live. Keys:

| key | meaning |
|-----|---------|
| `fkbWakeEnabled` | master on/off (default true) |
| `fkbWakeCooldownMs` | min ms between pokes (default 8000) |
| `fkbWakeQuietStart` / `fkbWakeQuietEnd` | `"HH:mm"` **local** daily quiet window (wraps midnight; empty = none) |
| `fkbWakeSuppressUntilEpochMs` | absolute epoch-ms; notes before it don't wake |
| `fkbPassword` / `fkbHost` / `fkbPort` | FKB target (set `fkbPassword` once via pbctl) |

```bash
pbctl config set fkbWakeEnabled false     # kill wake entirely
pbctl quiet 22:00 07:00                    # nightly quiet window   (pbctl quiet off to clear)
pbctl suppress 7200000                     # mute wake for 2h from now (0 = clear)
```

`fkbWakeSuppressUntilEpochMs` is the **generic hook for arbitrary future policy**:
the DS backend can implement *any* rule it likes (guests present, movie playing,
whatever) by computing a deadline and `POST`ing that one key — the APK never changes.

**Screen power (always-on, no dozing).** The tablet is on permanent wired power, so
`stay_on_while_plugged_in=7` keeps the display awake — the `screen_off_timeout` (2 min)
is overridden while plugged, and no ambient/AOD doze is configured (`doze_enabled`,
`doze_always_on`, `aod_mode` are all null → screen is only ever fully **Awake** or
**Off**, never a half-on "Dozing" state). The **only** thing that darkens it is the
piano's own idle screensaver (FKB `screenOff`, 3-min) — exactly the dark-tablet case
`ScreenWaker` wakes from. To make it stay on 24/7 instead, disable that screensaver
(piano.yml `timeoutMinutes: 0`); the wake then becomes a pure safety net.

### Self-update (ADB-free upgrades)

New APK must be **same-signed** (debug keystore) and have **versionCode ≥ installed**.
This device has a Google account, so it can't be a device owner → installs are **not
silent**; each shows a one-tap Android confirm. But **never ADB again**:

> **One-time prerequisite — disable Play Protect (ADB-free, persists).** Google Play
> Protect blocks the sideloaded debug APK with `INSTALL_FAILED_VERIFICATION_FAILURE`
> *after* you tap confirm (seen 2026-07-02). Turn the package verifier off once over
> the `:8770` control plane (`WRITE_SECURE_SETTINGS`); it survives reboots + updates:
> ```bash
> pbctl setsetting global package_verifier_enable 0
> pbctl setsetting global verifier_verify_adb_installs 0
> ```
> Verify a subsequent install logs `self-update result status=0` (SUCCESS) in
> `pbctl log`, not `status=3`.

Then, to update (confirm dialog surfaces reliably if you foreground the app first):

- **Primary (native, verified 2026-07-02):**
  ```bash
  node cli/fkb.cli.mjs launch net.kckern.pianobridge      # foreground the app first
  pbctl update http://<host>/piano-bridge.apk             # bridge downloads + PackageInstaller
  ```
  Foregrounding the app first is what lets the confirm dialog win the race against
  Fully's kiosk foreground-reclaim (`InstallReceiver` `startActivity`s it). Watch
  `pbctl log` for `launching install confirm dialog` → tap **Update** → `status=0`.
- **Fallback:** Fully's own installer, `node cli/fkb.cli.mjs install http://<host>/x.apk`.
  It surfaces the dialog too, but its `mdmApkToInstall` fetch proved **flaky** (often
  never downloads on the `restartApp` nudge; use a **unique filename** each time so FKB
  doesn't dedupe a URL it already processed).

Host the APK anywhere the tablet can reach (a LAN HTTP server, or drop it in the DS
prod container's served `frontend/dist/`). **Post-update the service is stopped** (the
in-place update kills the process) — relaunch it ADB-free with
`node cli/fkb.cli.mjs launch net.kckern.pianobridge`.

### 🚀 The no-fumble deploy checklist (copy-paste, verified 2026-07-15)

Every wasted-time trap is a step here. Do them **in order**. `PB=10.0.0.245:8770`.

```bash
cd _extensions/piano-bridge/app

# 1. BUMP the version (self-update rejects versionCode ≤ installed). Edit app/build.gradle:
#      versionCode 19  →  20 ;  versionName "1.11-config-merge" → "1.12-..."

# 2. BUILD
export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home
./gradlew :app:assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk

# 3. SERVE it on the LAN (the tablet PULLs it; there is no upload endpoint).
IP=$(ipconfig getifaddr en0)          # your Mac's LAN IP, e.g. 10.0.0.68
( cd app/build/outputs/apk/debug && python3 -m http.server 8799 --bind 0.0.0.0 ) &
# verify the TABLET can reach it (not just your Mac):
PB_HOST=$PB node ../pbctl.mjs exec "curl -sI http://$IP:8799/app-debug.apk | head -1"   # want 200

# 4. ⚠️ MAKE THE CONFIRM TAPPABLE — the two traps that eat your walk:
#    (a) FKB kiosk mode AUTO-DISMISSES the install dialog (logs
#        'INSTALL_FAILED_ABORTED: User rejected permissions'). Turn it OFF.
#    (b) A screen-OFF tablet shows the dialog to nobody. Force it ON + keep it lit,
#        and blank the SPA so its own screensaver can't screenOff mid-install.
node ../../../cli/fkb.cli.mjs set kioskMode false
node ../../../cli/fkb.cli.mjs screen on
node ../../../cli/fkb.cli.mjs set keepScreenOn true
node ../../../cli/fkb.cli.mjs url about:blank        # stop the SPA screensaver (MIDI link is unaffected — it's the APK)

# 5. TRIGGER the install
PB_HOST=$PB node ../pbctl.mjs update "http://$IP:8799/app-debug.apk"

# 6. ✅ VERIFY the dialog is REALLY up BEFORE you walk over. FKB's screenshot CANNOT
#    see system dialogs, so trust the system window log, not a screenshot:
PB_HOST=$PB node ../pbctl.mjs logcat 400 | grep -i "Gaining focus.*PackageInstaller"
node ../../../cli/fkb.cli.mjs info screenOn     # must say: screenOn: true
#    → only when you see BOTH (focus on PackageInstallerActivity + screenOn true) go tap **Update/Install**.

# 7. AFTER the tap: the service does NOT auto-restart, and the confirm race can leave it
#    stopped. Relaunch it (repeat until pbctl status answers):
node ../../../cli/fkb.cli.mjs launch net.kckern.pianobridge
PB_HOST=$PB node ../pbctl.mjs status            # want state=CONNECTED on the new build

# 8. RESTORE the kiosk
node ../../../cli/fkb.cli.mjs url https://daylightlocal.kckern.net/piano
node ../../../cli/fkb.cli.mjs set kioskMode true
pkill -f "http.server 8799"                     # stop the temp server
```

**Config note:** a replace-install used to wipe the on-device override — as of
versionCode 19 (`1.11-config-merge`) `POST /config` **merges** and the baked
`assets/piano-devices.yml` is the floor, so `targetMac` survives. Still fine to
re-push the full config in step 7 (`pbctl config push piano-devices.yml`) as a belt.
**Verify the merge fix live:** `curl -X POST $PB/config -d 'fkbWakeSuppressUntilEpochMs: 1'`
then `pbctl config` — `targetMac` must still be there.

### Deploying the audio-guard build (gotchas, verified 2026-07-09)

The audio guard shipped as versionCode **18** / `1.10-audio-guard`. What the deploy
actually required:

- **Deploy is a PULL, not a push.** `GET|POST /update?url=<apk-url>` makes the bridge
  fetch the APK over HTTP, so the APK **must be served on the LAN** (there is no
  upload endpoint). `versionCode` must strictly increase or the install is rejected.
- **Install needs one physical tap.** FKB is not device owner, so the Android confirm
  dialog appears. The `/update` endpoint **blocks past a 25 s curl timeout** while
  waiting on that dialog — a client-side timeout does **NOT** mean the install failed.
- **ADB over WiFi was unavailable.** After the reboot the port was refused;
  `setprop service.adb.tcp.port` is denied to `untrusted_app`, and although
  `adb_enabled=1`, it was USB-only. Plan for the `/update` (pull) path, not ADB.
- **The service does not auto-start after a replace-install** (fresh-install stopped
  state). Relaunch ADB-free: `node cli/fkb.cli.mjs launch net.kckern.pianobridge`.
- **✅ Config-clobber bug — FIXED in versionCode 19 (`1.11-config-merge`, 2026-07-15).**
  Root cause was NOT the install: `DeviceConfig.writeOverride` did a *truncating* write,
  so any partial `POST /config` replaced the whole override. The backend's MIDI-wake
  relay (`PianoMidiWakeService`) POSTs a lone `fkbWakeSuppressUntilEpochMs`, which
  therefore erased `targetMac` and stranded the BLE-MIDI link ("no piano found") every
  time it fired. Fix is three layers: `writeOverride` now **merges** (partial POSTs are
  safe for any caller); `BleMidiConnector` no longer terminal-`FAILED`s on an empty MAC
  (falls back to a name scan for `targetName` + always retries); and the backend does
  read-merge-write + fails safe. See `reference_piano_bridge_config_clobber_root_cause`.
- **Reassuring:** with `speakerMac` empty after the clobber, the guard correctly
  refused to clamp (an A2DP output was present → `speakerIsRoute` false) — it gated
  but never wrote a wrongful volume. The fail-closed policy held under a config it
  never anticipated.

### Lifecycle / recovery (no ADB)

- **Reboot:** `BootReceiver` → `startForegroundService` auto-starts the service
  (verified 2026-07-02: bridge back on `:8770` ~60 s after boot, no launch needed).
- **Mid-run OS kill:** the service is `START_STICKY` (revives itself).
- **Manual restart:** `node cli/fkb.cli.mjs launch net.kckern.pianobridge` (FKB
  `startApplication` → MainActivity → service). No ADB.
- Config override + granted perms **persist** across reboots and self-updates.

### Diagnostics (`pbctl`)

`status | log | logcat [lines] [tag] | exec <cmd…> | cpu [ms] | info | props [key]` —
see the header of `pbctl.mjs`. `/exec` runs `sh -c` as the app uid; other-process CPU
is impossible under the Knox untrusted-app SELinux ceiling (needs adb's shell uid).

---

## Target device & performance caveat

The real device is a **Samsung SM-T590 (Galaxy Tab A 10.5, 2018)**:
**Snapdragon 450, 32-bit `armeabi-v7a`**. `abiFilters` includes both
`armeabi-v7a` (the device) and `arm64-v8a` (emulators / newer hardware).

> **Perf caveat:** The SM-T590's Cortex-A53 cores are weak. A heavy
> multi-velocity sampled grand piano (many layers, long release tails, high
> polyphony) may be **CPU-marginal or cause Oboe xruns** at low-latency buffer
> sizes on armv7. Mitigations: ship a **trimmed SFZ** (fewer velocity layers,
> shorter releases, mono or reduced round-robins), raise the Oboe buffer to
> 3-4 bursts, or lean on the lighter Dexed FM engine for some voices. Measure
> `status.cpu` / `status.xruns` from the WS heartbeat before committing to a
> patch set.

---

## Prerequisites (none installed on the authoring machine)

| Component | Needed | Install |
|-----------|--------|---------|
| Java | OpenJDK 17 | `brew install openjdk@17` (not symlinked to PATH; use `JAVA_HOME`) |
| Android SDK | Platform 33 | Android Studio, or `sdkmanager "platforms;android-33"` |
| Android NDK | **NOT installed** | `sdkmanager "ndk;26.1.10909125"` (then match `ndkVersion` in `app/build.gradle`) |
| cmake | **NOT installed** | `sdkmanager "cmake;3.22.1"` |

Set `sdk.dir` in `app/local.properties` to your SDK path
(e.g. `/Users/<you>/Library/Android/sdk`).

> **Future builder must:** (1) install the NDK + cmake above, (2) set
> `ndk.dir`/`sdk.dir` correctly, (3) set `android.ndkVersion` in
> `app/build.gradle` to the NDK version actually installed, (4) vendor
> sfizz/dexed (see below) before audio will be anything but silence.

---

## Build

```bash
cd _extensions/piano-bridge/app
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug
```

Output: `app/app/build/outputs/apk/debug/app-debug.apk`.

> **Gotcha (2026-07-02):** the `gradle/wrapper/gradle-wrapper.jar` in this tree is
> truncated (46 KB) and throws `NoClassDefFoundError: …MissingResourceException`.
> The extracted Gradle 7.5.1 distribution itself is fine — build with it directly:
> ```bash
> JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
>   ~/.gradle/wrapper/dists/gradle-7.5.1-bin/*/gradle-7.5.1/bin/gradle assembleDebug
> ```

> **Always bump `versionCode` in `app/app/build.gradle` on every build** — the
> self-update path (below) rejects an APK whose `versionCode` is not strictly greater
> than the installed one. Current shipped build: **versionCode 18 / versionName
> `1.10-audio-guard`** (SM-T590, verified 2026-07-09).

## Install

```bash
adb -s <ip:5555> install -r app/app/build/outputs/apk/debug/app-debug.apk
adb -s <ip:5555> shell am start -n net.kckern.pianobridge/.MainActivity
```

`MainActivity` starts `PianoBridgeService` (a regular started service) and shows
a status screen with a "Restart service" button for debugging.

**After a *fresh* install** the app sits in Android's "stopped state" and will NOT
receive `BOOT_COMPLETED` until it is launched once — so always run the
`am start …MainActivity` line above after installing, or the bridge won't auto-start
on the *next* reboot. (Once launched, boot-survival is permanent — see below.)

Future upgrades **do not need ADB at all** — see *Self-update* below.

## Push instrument assets

Samples (SFZ + wavs) and DX7 `.syx` banks live on-device under
`/sdcard/piano-instruments/<id>/`. The WS `preset.load.spec.asset` path is
resolved relative to this root (with a `..` / absolute-path guard):

```bash
adb -s <ip:5555> push ./my-grand /sdcard/piano-instruments/grand
# then a spec with { "asset": "grand/grand.sfz", "engine": "sfizz" } resolves to
# /sdcard/piano-instruments/grand/grand.sfz
```

---

## Vendoring sfizz / dexed (turning on real audio)

The engines compile to silence until their libraries are present:

1. **sfizz** — clone into `app/src/main/cpp/third_party/sfizz`, then in
   `app/src/main/cpp/CMakeLists.txt` uncomment the `add_subdirectory(third_party/sfizz)`,
   `target_link_libraries(... sfizz::sfizz)`, and
   `target_compile_definitions(... HAVE_SFIZZ)` block. `SfizzEngine.cpp`'s real
   path (`#ifdef HAVE_SFIZZ`) calls `loadSfzFile`, `renderBlock`, `noteOn`, etc.
2. **dexed / MSFA** — vendor the MSFA sources into
   `app/src/main/cpp/third_party/dexed/msfa`, uncomment the `msfa` static-lib
   block + `HAVE_DEXED`. `DexedEngine.cpp` reads the `.syx` bank and (once
   enabled) unpacks the selected `patch` voice.

Both guards default OFF so the `.so` links cleanly today.

---

## WebSocket control protocol (port 8770)

This MUST stay byte-for-byte compatible with the already-shipped frontend
(`frontend/src/modules/Piano/PianoKiosk/usePianoVoiceBridge.js` +
`instrumentSpec.js`). The browser is the config authority; `preset.load` ships a
fully-resolved spec.

### Inbound (browser → APK)

| `type` | Fields | Action |
|--------|--------|--------|
| `engine.start` | — | open Oboe stream / start engine |
| `engine.stop` | — | stop Oboe stream |
| `preset.load` | `spec` (see below) | build + load engine, resolve `asset` under instruments dir |
| `param.set` | `path`, `value` | generic dotted-path param (e.g. `reverb.mix`) |
| `panic` | — | all-notes-off |
| `note.on` | `note`, `velocity` | **relay fallback** → engine noteOn |
| `note.off` | `note` | **relay fallback** → engine noteOff |

`preset.load.spec` fields (exact names from `instrumentSpec.js`):
`id, name, engine, asset, patch, gain_db, transpose, tune, velocity_curve, reverb, eq, chorus`.
(`reverb`/`eq`/`chorus` may be `null` or objects; the APK currently consumes
`reverb.mix`, and flattens the rest into `param.set` territory.)

### Outbound (APK → browser)

| `type` | Fields | When |
|--------|--------|------|
| `ready` | — | on client connect |
| `status` | `engine` (`running`\|`stopped`), `preset` (id\|null), `cpu`, `xruns` | ~1 s heartbeat |
| `error` | `code`, `msg` | on any failure |
| `note.on` | `note`, `velocity` | live MIDI fan-out (for browser visualizers) |
| `note.off` | `note` | live MIDI fan-out |

Rich transport logging at every transition uses `Log` tag **`PianoBridge-WS`**
(client connect/disconnect, each inbound message type, parse errors). Core
service/engine logs use tag **`PianoBridge`**.

---

## Fan-out risk (open question — must verify on hardware)

The APK reads the BLE-MIDI piano via `MidiManager`. **Can Chromium (the kiosk
browser) AND this APK both open the same BLE-MIDI device simultaneously?** BLE
GATT connections and Android's MIDI device ownership may not permit two
consumers. Two strategies are scaffolded:

1. **APK-reads-MIDI (preferred):** the APK owns the BLE-MIDI input and fans
   notes out to the browser as `note.on`/`note.off` for visualizers. The browser
   does NOT open Web MIDI for the piano.
2. **Relay fallback:** if the APK can't get the BLE device (browser already owns
   it, or vice versa), the browser reads Web MIDI and relays notes to the APK via
   inbound `note.on`/`note.off`. The synth still runs natively.

Decide which after testing whether the two can coexist on the BLE stack. The
default `midi_name` filter is empty (first available input); override via the
`midi_name` string extra on the service start Intent.

---

## Files

```
_extensions/piano-bridge/
├── README.md                  (this file — UNBUILT banner)
├── DESIGN.md                  (architecture)
└── app/
    ├── build.gradle           (root: AGP 7.4.2)
    ├── settings.gradle
    ├── gradle.properties
    ├── local.properties       (sdk.dir placeholder)
    ├── gradlew                (copied from audio-bridge)
    ├── gradle/wrapper/        (copied from audio-bridge)
    └── app/
        ├── build.gradle       (module: applicationId, NDK abiFilters, cmake)
        └── src/main/
            ├── AndroidManifest.xml
            ├── java/net/kckern/pianobridge/
            │   ├── MainActivity.java
            │   ├── PianoBridgeService.java    (core: notify(), MidiManager, WS, START_STICKY)
            │   ├── BootReceiver.java          (BOOT_COMPLETED → startForegroundService)
            │   ├── ScreenWaker.java           (note → FKB screenOn poke; quiet/suppress gating)
            │   ├── Updater.java               (self-update: PackageInstaller session)
            │   ├── InstallReceiver.java       (self-update: launches the confirm dialog)
            │   ├── DeviceConfig.java          (runtime override; wake-policy keys)
            │   ├── ControlServer.java         (NanoWSD :8770 — WS + /config /update /exec …)
            │   └── PianoEngine.java           (JNI facade)
            └── cpp/
                ├── CMakeLists.txt             (guarded sfizz/dexed blocks)
                ├── Engine.h                   (abstract + VoiceSpec)
                ├── VoiceHost.h/.cpp           (active-engine owner, render src)
                ├── OboeOutput.h/.cpp          (Oboe stream + callback)
                ├── SfizzEngine.h/.cpp         (#ifdef HAVE_SFIZZ, else silence)
                ├── DexedEngine.h/.cpp         (#ifdef HAVE_DEXED, else silence)
                └── native-lib.cpp             (JNI bindings)
```
