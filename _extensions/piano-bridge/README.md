# Piano Bridge (APK)

> **STATUS: BUILDS + RUNS (sfizz enabled). Verified 2026-06-23 on the SM-T590.**
>
> The APK compiles (NDK r26b + cmake 3.22.1), installs on the tablet, runs the
> foreground service + WebSocket control server on `:8770`, loads the Salamander
> Grand SFZ via the vendored **sfizz** engine, and renders real audio through Oboe
> (confirmed: `render signal peak>0` on note-on, no crash). **Dexed/FM is still
> behind `#ifdef HAVE_DEXED` (silent) — not yet vendored.**
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

This mirrors the conventions of the sibling `_extensions/audio-bridge/` APK:
same Gradle wrapper layout, `compileSdk 33` / `minSdk 30`, Java 11, and crucially
the **regular-started-service + `NotificationManager.notify()`** pattern (NOT
`startForeground()`) — see `_extensions/audio-bridge/DESIGN.md` for why that
matters on Android 11.

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

Output (once buildable): `app/build/outputs/apk/debug/app-debug.apk`.

## Install

```bash
adb -s <ip:5555> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <ip:5555> shell am start -n net.kckern.pianobridge/.MainActivity
```

`MainActivity` starts `PianoBridgeService` (a regular started service) and shows
a status screen with a "Restart service" button for debugging.

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
            │   ├── PianoBridgeService.java    (core: notify(), MidiManager, WS)
            │   ├── BootReceiver.java
            │   ├── ControlServer.java         (NanoWSD, port 8770, protocol)
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
