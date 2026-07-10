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
BLE/engine routes. The bridge is `untrusted_app` under a Knox SELinux ceiling, but `dumpsys` is
**NOT** blanket-denied (an earlier version of this doc claimed it was — that was wrong).

**What `dumpsys` CAN read from the app via `/exec`** (verified on the live tablet 2026-07-09):
`dumpsys audio`, `dumpsys bluetooth_manager`, and `dumpsys package` all return real data. These
were used to verify the audio guard (see the per-device volume indices and `Devices: bt_a2dp`
readback in the Audio guard section).

**What IS blocked for `untrusted_app`** (also verified 2026-07-09):

- the `settings` shell command → `Permission Denial: getCurrentUser() ... requires INTERACT_ACROSS_USERS`
- `content query` → `requires ACCESS_CONTENT_PROVIDERS_EXTERNALLY`
- `setprop service.adb.tcp.port` → denied (can't enable ADB-over-WiFi from the app)
- `dumpsys activity activities` → returns empty, exit 1

`/proc/stat`, `/proc/loadavg`, and other processes' `/proc` remain unreadable, so per-process CPU
of other apps still needs adb's shell uid. `/cpu` is therefore OWN-process per-thread only
(`ProcStats`, read in-process from `/proc/self/task`). Dev perms (`READ_LOGS`, `DUMP`,
`WRITE_SECURE_SETTINGS`) are `pm grant`-ed once over USB and persist across reboot.

**FKB REST gotcha (`type=json` is mandatory):** the Fully Kiosk REST API on `:2323` silently
returns the **HTML login page** instead of executing when `type=json` is omitted —
`?cmd=deviceInfo&password=…` → HTML, but `?cmd=deviceInfo&type=json&password=…` → JSON. A command
that appears to "do nothing" (e.g. `startApplication`) has probably just been served the login
page. (Use `<rotated-fkb-password-urlencoded>` for the password; it contains URL-special chars.)

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

### Service lifecycle

`PianoBridgeService` **is a foreground service.** It calls `startForeground()` —
see `postNotification()`, which invokes `startForeground(NOTIFICATION_ID,
notification)` — and the manifest declares
`android:foregroundServiceType="mediaPlayback"`. `BootReceiver` starts it with
`startForegroundService()` so Fully Kiosk cannot block or reap it, and the FGS type
keeps audio playback alive when the WebView is backgrounded.

> **This diverges from the sibling audio-bridge APK on purpose.** audio-bridge
> deliberately AVOIDS `startForeground()` because on Android 11 a foreground service
> started from a background context loses mic access. Piano Bridge doesn't use the
> mic, so that restriction doesn't apply, and it needs the FGS `mediaPlayback` type
> to keep the Oboe stream alive in the background. Earlier revisions of this doc
> claimed Piano Bridge "does not call `startForeground()`" for consistency with
> audio-bridge — that was never true of the shipped code; the source comment in
> `PianoBridgeService` already contradicted it.

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
The data callback pulls `VoiceHost::render`. `onErrorAfterClose` **stops the stream
and does NOT reopen it** — that error fires on the A2DP drop itself, and reopening
would land the synth on the built-in speaker (see the Audio guard section). Recovery
is the reconciler's job, gated on route + kiosk intent. Xrun count is surfaced for
the status heartbeat.

Thread safety: `stream_` is guarded by `streamMutex_` because Oboe's error thread
races the JNI threads. The real-time `onAudioReady` callback takes no lock and
touches no `shared_ptr` — it reads xruns from the `AudioStream*` Oboe passes in.

---

## Audio guard (fail-closed speaker mute)

> **Shipped 2026-07-09.** APK versionCode **18**, versionName `1.10-audio-guard`.
> Verified on the live SM-T590; measurements below are from hardware, not a sim.

### Invariant

The tablet must **never** emit audio from its own built-in speaker. All audio goes
out the piano's A2DP sink only — MAC `64:49:A5:8B:9B:75`, "J2-USB Bluetooth". The
guard is **fail-closed**: on any doubt about the route, audio is suppressed rather
than risk playing out the tablet.

### Four layers (defense in depth)

0. **`AudioGuardPolicy`** — a pure, side-effect-free decision core (JVM-testable).
   `routeOk = a2dpConnected && a2dpOutputPresent`, and it **initializes to false**.
   All state transitions and the idempotent-clamp guard live here.
1. **`VoiceHost::gateOpen_`** — a native atomic render gate. When closed, `render()`
   emits silence. Fail-closed default (starts closed).
2. **Persistent `STREAM_MUSIC` volume clamp** on the built-in speaker's per-device
   index. This is the primary mechanism (see below).
3. **`AudioRouteGuard.reconcile()`** — an idempotent reconciler driven by four
   triggers: the A2DP connect/disconnect broadcast, an `AudioDeviceCallback`,
   `A2dpConnector`'s 20 s sweep, and `VOLUME_CHANGED_ACTION`. Any trigger recomputes
   the policy and applies gate + clamp; running it repeatedly is a no-op.

### Why the volume clamp is the primary mechanism, not the render gate

The render gate only silences the **native** synth. It cannot touch the **Chromium
WebView** audio path — `MusicPlayer.jsx`, game SFX, and the Producer's `gmSynth` all
play through the browser, which the APK has no handle on. The per-device
`STREAM_MUSIC` volume clamp is the ONLY lever that reaches WebView audio. And because
Oboe's default `usage=media` maps to `STREAM_MUSIC`, zeroing the speaker's
`STREAM_MUSIC` index silences the native synth too. So the clamp covers both paths;
the render gate is defense-in-depth for the native path only.

### Clamp once, NEVER restore

`AudioService` persists the per-device volume index to the settings DB, so a single
`setStreamVolume(STREAM_MUSIC, 0, 0)` while the speaker is the active route pins the
built-in speaker to 0 **permanently** — across reconnects, process death, and
reboots. There is deliberately **no un-clamp code path**. If someone finds the tablet
silent with the piano disconnected, that is the guard working as designed.
`POST /audio-guard/override?ms=…` reopens the **synth gate only** for debugging; it
never raises the volume.

### Why the clamp can't be pre-applied at startup

`setStreamVolume(STREAM_MUSIC, 0, 0)` writes the index of the **currently active**
output device. While A2DP is connected, that active device is the *piano* — so a
naive pre-clamp would silence the piano, not the speaker. The clamp must therefore be
spent during a window where the built-in speaker is the active route. Hence the
one-time exposure window and `POST /audio-guard/bootstrap`, which spends it
deliberately: **disconnect A2DP → speaker becomes active → clamp → reconnect A2DP.**

### API 29 limitation: the active route is unqueryable

There is no public API on API 29 to ask which output route is active
(`getDevicesForAttributes` is `@SystemApi` until API 31). So the policy **infers**:
the built-in speaker is the active route iff neither an A2DP nor a wired output is
connected. `AndroidAudioOps.wiredOutputPresent()` is deliberately **over-inclusive**
— it counts USB device/accessory/headset, analog and digital line, aux, HDMI, and
dock — because under-reporting a wired output would make the policy think the speaker
is active and zero the **wrong** device's index. Over-inclusion only ever declines to
clamp; under-inclusion could clamp the piano.

### `onErrorAfterClose` must never reopen the stream

Oboe's `onErrorAfterClose` fires on the A2DP drop itself, racing the Java-side gate
close on another thread. Oboe detects the HAL disconnect **faster** than the
Bluetooth broadcast reaches the reconciler, so a gate-conditional reopen here would
observe a still-open gate, reopen onto the only remaining route (the built-in
speaker), and emit synth audio out the tablet. The handler therefore just `stop()`s
and returns — **no reopen, conditional or otherwise.** Recovery is the reconciler's
job, and it is gated on `isStreamRunning()` **AND** on kiosk intent (`engineDesired`)
so an idle kiosk never holds the audio HAL open just to keep a stream alive.

### Measured on hardware, 2026-07-09

From the `Diag` ring (monotonic ms since boot) during `POST /audio-guard/bootstrap`:

```
77584336  A2DP disconnect(64:49:A5:8B:9B:75) -> true
77584970  clamped built-in speaker STREAM_MUSIC to 0 (reason=no_a2dp_output)   +634 ms
77584970  route GATED reason=no_a2dp_output
77585032  A2DP "speaker disconnected — reconnecting (#1)"                      +696 ms
77586889  connect(64:49:A5:8B:9B:75) -> true
77587636  speaker connected
77588102  route OK reason=ok
```

- The **`AudioDeviceCallback` fires ~634 ms after the disconnect and LEADS the A2DP
  broadcast by ~62 ms** — it is the fast trigger. This bounds the one-time exposure
  window only (not steady-state latency).
- Full outage (disconnect → route OK again): **~3.8 s**.
- The bootstrap endpoint's own `reconcile()` ran ~1.9 s after the clamp and did
  **not** re-clamp (`clamps` stayed 1) — the policy's idempotent `speakerIndex > 0`
  guard, exercised on real hardware.
- Per-device indices after the clamp: `volume_music_speaker=0`,
  `volume_music_bt_a2dp=15`, `volume_music_headset=8`. The clamp hit only the speaker.
- `dumpsys audio` after: `2 (speaker): 0\0`, `80 (bt_a2dp): 15\150`,
  `Devices: bt_a2dp`.
- Zero `UnsatisfiedLinkError` — both `nativeSetOutputGate` and `nativeIsStreamRunning`
  bind at runtime.
- **`A2dpConnector.connect()` works against a BONDED device.** Its historical
  `reconnects: 5153` were all failures against an UNBONDED MAC (`bondState: none`),
  which the code reported in `lastError` ("speaker not bonded") where nothing
  surfaced it. **Recommend surfacing `lastError` in `pbctl diag`.**

### Reboot survival: INFERRED, NOT VERIFIED

The clamp lives in the `Settings.System` DB — the same store `AudioService` reads at
boot — so it is **expected** to persist across reboots. **This was not tested**: no
reboot was performed after the clamp. Treat it as inferred until confirmed. One-line
check after a reboot:

```bash
curl -s "http://<tablet>:8770/getsetting?ns=system&key=volume_music_speaker"   # want 0
```

### Config-clobber safety net (observed, reassuring)

During the deploy the on-device config override was clobbered down to a single key
(see README), leaving `speakerMac` empty. With no `speakerMac` the guard correctly
**refused to clamp**: an A2DP output device was present → `speakerIsRoute` was false →
route gated but no wrongful volume write. The fail-closed policy held under a config
it never anticipated.

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
