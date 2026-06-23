# Piano Bridge — Design

> **STATUS (2026-06-23): BUILT + RUNNING ON HARDWARE.** APK builds (`./gradlew :app:assembleDebug`
> with `JAVA_HOME=/opt/homebrew/opt/openjdk@11/...`; native sfizz .so compiles), installs, and the
> HTTP control plane on `:8770` is verified over LAN. BLE-MIDI direct-connect + the
> ADB-replacement diagnostic endpoints are implemented. See **Deploy & Diagnostics** below and
> the piano tablet's `CLAUDE.md`.

**Date:** 2026-06-22 (design) · 2026-06-23 (built + hardware notes)
**Package:** `net.kckern.pianobridge`
**Target:** Samsung SM-T590 (Snapdragon 450, 32-bit `armeabi-v7a`)

---

## Deploy & Diagnostics (verified on hardware 2026-06-23)

**Build:** no `java` on PATH — `export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home`
then `cd app && ./gradlew :app:assembleDebug`. APK → `app/app/build/outputs/apk/debug/app-debug.apk`.

**Deploy:** USB `adb install -r` is the only clean path today (preserves dev-perm grants). FKB
`mdmApkToInstall` silent-installs **only if FKB is device-owner** (it is not → no-op even when
PLUS-licensed); FKB `loadUrl <apk>` downloads but the kiosk swallows the install prompt. To get
headless deploys: `adb shell dpm set-device-owner de.ozerov.fully/.MainDeviceAdminReceiver` once.

**Diagnostic endpoints** (`ControlServer.serveHttp`): `/exec /logcat /cpu /info /props /ps` plus the
BLE/engine routes. The bridge is `untrusted_app`, so **SELinux blocks `dumpsys` (any service),
`/proc/stat`, `/proc/loadavg`, and other processes' `/proc`** — `READ_LOGS` (logcat) works, `DUMP`
is useless, per-process CPU of other apps needs adb's shell uid. `/cpu` is therefore OWN-process
per-thread only (`ProcStats`, read in-process from `/proc/self/task`). Dev perms (`READ_LOGS`,
`DUMP`, `WRITE_SECURE_SETTINGS`) are `pm grant`-ed once over USB and persist across reboot.

**BLE-MIDI:** `BleMidiConnector` connects **direct-by-MAC first** (`getRemoteDevice` +
`openBluetoothDevice`) because a bonded/connected WIDI stops advertising and a scan never sees it;
scan is the fallback. `BootReceiver` uses `startForegroundService()` (plain `startService()` is
illegal from a background BOOT_COMPLETED on Android 8+). ADB-free recovery: `fkb.cli.mjs launch
net.kckern.pianobridge`.

---

## Context

The piano kiosk needs high-quality rendered instrument voices (sampled grand,
DX7-style FM, etc.) driven by a real BLE-MIDI keyboard. WebAudio/soundfonts in
the browser are limited for large multi-velocity sample sets and add latency. A
native Android synth host solves both: it reads MIDI directly, renders with
purpose-built engines (sfizz / Dexed), and outputs via Oboe at low latency,
while the **browser remains the configuration authority** — it ships a fully
resolved instrument spec over WebSocket and never has to know the DSP details.

This mirrors the proven `_extensions/audio-bridge/` APK: same Gradle layout,
same Android-11-safe service lifecycle.

---

## Architecture overview

```
            BLE-MIDI piano
                  │  (Android MidiManager, MidiReceiver)
                  ▼
        ┌─────────────────────────────────────────────┐
        │ PianoBridgeService (regular started service) │
        │   • NotificationManager.notify() (no FGS)    │
        │   • parses MIDI bytes → note/CC              │
        │   • fans notes out to WS clients             │
        │                                              │
        │   ControlServer (NanoWSD :8770)              │
        │     in:  engine.start/stop, preset.load,     │
        │          param.set, panic, note.on/off       │
        │     out: ready, status(1s), error, note.*    │
        │                                              │
        │   PianoEngine (JNI facade)                   │
        └───────────────────┬──────────────────────────┘
                            │ JNI (long handle)
                            ▼
        ┌─────────────────────────────────────────────┐
        │ native (libpianobridge.so)                   │
        │   VoiceHost  ── owns active Engine, render() │
        │     ├─ SfizzEngine  (#ifdef HAVE_SFIZZ)      │
        │     └─ DexedEngine  (#ifdef HAVE_DEXED)      │
        │   OboeOutput ── LowLatency/Exclusive stream  │
        │                 callback pulls VoiceHost     │
        └─────────────────────────────────────────────┘
                            │ Oboe
                            ▼
                      tablet audio out

        Browser kiosk (Chromium) ── usePianoVoiceBridge.js
            ws://localhost:8770  ◄────────► ControlServer
            instrumentSpec.js   (spec contract)
            visualizers ◄── note.on/off fan-out
```

---

## Android side

### Service lifecycle (the audio-bridge lesson)

`PianoBridgeService` is a **regular started service**. It does **not** call
`startForeground()`. On Android 11 a foreground service started from a background
context loses while-in-use permissions, and (in audio-bridge's case) mic access.
Piano Bridge doesn't need the mic, but reuses the same pattern for consistency
and to avoid the FGS-type/background-start constraints: it posts a persistent
ongoing notification via `NotificationManager.notify()` and relies on the tablet
being always powered. `BootReceiver` and `MainActivity` start it with
`startService()` (not `startForegroundService()`).

### MIDI input

`MidiManager.getDevices()` is scanned for a device with ≥1 output port. The
`midi_name` Intent extra (substring, case-insensitive) selects the piano; empty
= first available input. On open, output port 0 is connected to a `MidiReceiver`
that parses status bytes:

- `0x90` note-on (vel 0 → note-off), `0x80` note-off → `engine.noteOn/Off` +
  WS fan-out
- `0xB0` control change → `engine.setParam("cc.<n>", v/127)`
- other status bytes skipped (running-status not handled — most BLE-MIDI
  keyboards send full status per message; revisit if a device relies on it)

### WebSocket control server

`ControlServer extends NanoWSD` on port **8770**. One `ControlSocket` per client
(multiple allowed; status + note fan-out broadcast to all). Inbound JSON frames
are dispatched by `type`; outbound `ready`/`status`/`error`/`note.*`. A 1 s timer
broadcasts `status` with engine state, current preset id, and native `cpu`/`xruns`.

`preset.load` resolves `spec.asset` under `/sdcard/piano-instruments/` with a
double guard: a literal `..`/absolute/backslash reject (mirroring
`instrumentSpec.js`'s `SAFE()`), then a canonical-path containment check.

### JNI facade

`PianoEngine.java` loads `libpianobridge.so` and holds an opaque `long handle`
(pointer to a native `NativeBundle{ VoiceHost, OboeOutput }`). All methods are
`synchronized`; the native layer owns audio-thread safety.

---

## Native side

### Engine abstraction

`Engine` (Engine.h) is the polyphonic voice interface:
`load(VoiceSpec) / noteOn / noteOff / controlChange / setParam / render / allNotesOff`.
`VoiceSpec` is the flattened resolved spec (engine, assetPath, patch, gainDb,
transpose, tune, velocityCurve, reverbMix).

`VoiceHost` owns the active `Engine` as a `shared_ptr` and publishes a raw
pointer to the audio thread via `std::atomic<Engine*>`. `loadPreset()` builds the
new engine under a mutex, swaps, and keeps the previous `shared_ptr` alive until
after the atomic no longer points at it — so the lock-free `render()` never
dereferences a freed engine. With no engine loaded, `render()` emits silence.

### Engines (silent until vendored)

- **SfizzEngine** — `#ifdef HAVE_SFIZZ` wraps `sfz::Sfizz` (`loadSfzFile`,
  `renderBlock`, `noteOn`, `cc`). Applies gain (dB→linear), transpose, fine tune,
  and a velocity curve (natural/linear/soft/hard). `#else` → `memset` silence +
  one warning log.
- **DexedEngine** — `#ifdef HAVE_DEXED` for the MSFA/Dexed FM core: reads the
  `.syx` bank file, selects `patch`. `#else` → silence. The bank read happens
  even in silent mode (so file plumbing is exercised).

Both guards are OFF by default in `CMakeLists.txt`; the commented
`add_subdirectory` / `target_compile_definitions(... HAVE_*)` blocks turn them on
after vendoring.

### Oboe output

`OboeOutput` opens a Float / 48000 / stereo stream with
`PerformanceMode::LowLatency` and `SharingMode::Exclusive` (best-effort; Android
may downgrade to Shared — the **actually granted** perf/sharing mode is logged).
The data callback pulls `VoiceHost::render`. `onErrorAfterClose` restarts the
stream (e.g. on output-device disconnect). Xrun count is surfaced for the status
heartbeat.

---

## Frontend relationship

| Frontend file | Contract |
|---------------|----------|
| `usePianoVoiceBridge.js` | opens `ws://localhost:8770`; `loadPreset(spec)` sends `engine.start` then `preset.load{spec}`; `setParam(path,value)` → `param.set`; `panic`/`stop`; consumes `status`/`error` |
| `instrumentSpec.js` | `ENGINES = ['sfizz','dexed']`; `resolveInstrumentSpec()` produces the exact spec fields the APK parses; `SAFE()` path rule mirrored in `ControlServer.resolveAsset()` |

The chrome **source selector** / **Instruments mode** in the Piano kiosk decides
when to engage the bridge (analogous to audio-bridge's `mode: fallback|always`).
Live `note.on`/`note.off` from the APK feed the browser's key visualizers.

---

## Known issues / open questions

1. **Fan-out / device ownership (must verify on hardware):** can Chromium (Web
   MIDI) and the APK (`MidiManager`) both open the same BLE-MIDI device at once?
   If not, choose: APK-owns-MIDI + fan-out to browser (preferred), or browser
   reads Web MIDI + relays via inbound `note.on`/`note.off`. Both paths are
   scaffolded.
2. **SM-T590 / armv7 perf:** Snapdragon 450 is weak; a heavy multi-velocity
   grand may saturate CPU / cause xruns at low-latency buffers. Trim the SFZ,
   raise the buffer, or use Dexed for some voices. Watch `status.cpu`/`status.xruns`.
3. **NDK/cmake not installed; sfizz/dexed not vendored** — nothing builds or
   makes sound yet. This is a scaffold.
4. **MIDI running-status** not handled in the receiver — fine for most BLE-MIDI
   keyboards, revisit if a device relies on it.
5. **`eq` / `chorus` spec fields** are accepted but not yet wired to DSP (only
   `gain`, `transpose`, `tune`, `velocity_curve`, `reverb.mix` are consumed).

---

## Build & deploy (once buildable)

```bash
cd _extensions/piano-bridge/app
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug
adb -s <ip:5555> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <ip:5555> shell am start -n net.kckern.pianobridge/.MainActivity
adb -s <ip:5555> push <samples> /sdcard/piano-instruments/<id>/
```

See README.md for the full prerequisites table and the vendoring steps.
