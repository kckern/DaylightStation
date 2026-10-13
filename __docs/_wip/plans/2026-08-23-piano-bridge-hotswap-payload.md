# Piano Bridge: hot-swappable payload architecture

**Date:** 2026-08-23
**Status:** building tonight (authorized: "I'll allow 1 more last one … do it tonight")
**Supersedes:** the "tap Update on the tablet" deploy in `_extensions/piano-bridge/README.md`

---

## The problem this solves

Every change to the bridge — a new route, a watchdog rung, a MIDI write path — is a
full APK install. On this device (FKB is not Device Owner) that means: drop kiosk mode,
stage the APK, a **human taps Android's confirm dialog**, relaunch the service, restore
kiosk mode. 2026-08-22 needed this cycle **twice** in one evening and each one went
wrong in a documented way. The self-update path was built to avoid USB; it did not
avoid the human.

## The Android fact the design rests on

Android freezes exactly one thing at install time: **what the manifest declares**.
Permissions, services, receivers, the AccessibilityService and its XML config, the
foreground-service type, the native `.so`. Everything else — every line of Java that
runs *inside* the process — can be loaded at runtime from app-private storage with
`DexClassLoader`. This is how every large Android app ships logic without a store
release; on a self-signed single-owner kiosk there are no policy obstacles.

A **second** fact, verified by inventory: "holds an OS handle" is not the same as
"must be manifest-declared." `getSystemService(MIDI_SERVICE)`, `BluetoothAdapter`,
`AudioManager`, `PackageInstaller` all work from any class in the process. Only the
*entry points* the OS calls into are frozen.

Audit of 2026-08-22: of ~12 bridge changes made, **ten were pure Java** (write path,
`/midi/send`, `midi.raw`, install-hold, L5 rung, `/touch`, `/reboot`, `midiWrite`
status, hex parser, update-survival logic). Two were manifest (`MY_PACKAGE_REPLACED`
filter, `canRetrieveWindowContent`). Under this design: ten payload drops, two shell
installs. And both manifest changes are the kind you make once.

---

## Architecture

```
┌──────────────── SHELL (the APK; changes ~never) ────────────────┐
│  AndroidManifest: perms, 4 entry points, a11y xml, .so           │
│                                                                  │
│  PianoBridgeService   foreground svc; owns Notification + loader │
│  BootReceiver         BOOT_COMPLETED / MY_PACKAGE_REPLACED       │
│  PianoTouchService    a11y entry point → forwards to payload     │
│  InstallReceiver      PackageInstaller confirm (shell-only path) │
│  MainActivity         status screen                              │
│                                                                  │
│  PayloadLoader        fetch / verify / activate / rollback       │
│  ShellServices        the ONE interface the payload sees         │
│  libpianobridge.so    native synth (JNI) — stays here            │
└───────────────────────────┬──────────────────────────────────────┘
                            │ Payload.start(ShellServices)
                            ▼
┌──────────────── PAYLOAD (a .dex; changes whenever) ─────────────┐
│  ControlServer  KioskWatchdog  KioskSettingsGuard  BleMidi…      │
│  A2dpConnector  ScreenWaker    TouchPulser   FkbRest   CrashLog  │
│  DeviceConfig   SysEx/MIDI logic   diagnostics   everything else │
└──────────────────────────────────────────────────────────────────┘
```

### The interface (the only contract)

```java
// shell → payload, implemented BY the payload
public interface Payload {
    void start(ShellServices shell);        // build everything, bind ports, open BLE
    void stop();                            // tear down cleanly (before swap)
    String version();                       // e.g. "p3-midi-write"
    // a11y forwarding — the shell OWNS the service instance, the payload OWNS the policy
    void onAccessibilityConnected(AccessibilityService svc);
    void onAccessibilityDisconnected();
}

// payload → shell, implemented BY the shell
public interface ShellServices {
    Context context();                      // the Service context
    void updateNotification(String text);   // foreground notification is shell-owned
    PianoEngine engine();                   // JNI facade; .so lives in the shell
    AccessibilityService a11y();            // current bound instance or null
    int shellVersionCode();
    File payloadDir();                      // where payloads live; payload may log here
    void requestPayloadSwap(String url);    // lets a payload route trigger its own successor
}
```

Everything the payload needs from Android it gets from `context()`. The shell is
deliberately dumb: it has **no opinion** about MIDI, kiosks, or FKB.

### Loading

- Payload = a `.jar` containing `classes.dex`, built by `d8` from a Gradle
  **library module** (`payload/`) that compiles against `shell-api/` (the two
  interfaces above, a third module so both sides share one definition).
- Stored under `context.getFilesDir()/payloads/<version>.jar` — app-private, so
  `DexClassLoader` accepts it on Android 10 (it refuses world-writable locations).
- Loaded with `new DexClassLoader(jar, optDir, null, shell.getClassLoader())`.
  Parent = shell's loader so the payload resolves `ShellServices`, `PianoEngine`,
  NanoHTTPD, `org.json` from the shell. **NanoHTTPD and every other dependency live
  in the shell** — the payload is logic only, no bundled libs.
- Entry class name is fixed: `net.kckern.pianobridge.payload.Main`.

### Versioning and rollback — mandatory, not optional

- `payloads/` holds every fetched jar; `current` and `previous` are symlink-free
  **pointer files** (text, one path each) so they survive anything.
- `POST /payload?url=…` → download to `<sha>.jar.part` → verify sha256 against
  `?sha256=` (required; no unsigned drops) → rename → set `current`, keep old as
  `previous` → `stop()` old → load new → `start()`.
- **Crash counter:** the shell persists `payload.boots.<version>` and
  `payload.lastCleanStop`. If `start()` throws, or the process dies **3 times within
  10 min** while a payload is current, the shell flips `current` ← `previous` and
  records `PAYLOAD ROLLBACK` in the durable log. A payload that bricks the bridge
  therefore costs at most ~10 minutes of downtime, then self-heals.
- `GET /payload` → `{current, previous, available[], shellVersionCode, bootsThisPayload}`.
- **Baked fallback:** the shell ships with the first payload as an asset. If
  `payloads/` is empty or both pointers are dead, it extracts and loads the asset. A
  fresh install is never payload-less.

### What this costs

1. **One last tap** (v29, the shell). Done by the README checklist, not improvised.
2. `PianoTouchService` becomes a forwarder — its logic (`swipe`, `powerDialog`,
   `clickText`) moves to the payload, reached via `shell.a11y()`.
3. The `/update` APK path stays for the rare manifest change; `/payload` is the
   everyday path.
4. The shell must be boring and heavily tested once. Its unit tests are the loader's
   state machine (pointer swap, crash counter, rollback, baked fallback).

---

## Build plan (tonight)

1. `shell-api/` module: the two interfaces. Pure Java, no Android deps.
2. `payload/` module: move every non-manifest class. Add `Main implements Payload`.
   `PianoBridgeService`'s body becomes `Main.start()`.
3. Shell: gut `PianoBridgeService` to loader + notification + `ShellServices` impl.
   `PianoTouchService` forwards. `BootReceiver` unchanged.
4. `PayloadLoader` + tests.
5. Gradle task `:payload:dex` → `payload/build/payload-<ver>.jar` + `.sha256`.
6. `pbctl payload <url> [sha]`, `pbctl payload` (status), `pbctl payload rollback`.
7. Build v29 with the current logic baked in as payload p1. Serve. One tap.
8. Prove the loop: build p2 with a trivial visible change, `pbctl payload`, confirm
   `/payload` reports p2 and the change is live — **with zero tablet interaction.**

## Out of scope tonight

- Swapping the native `.so` (impossible without install; accepted).
- Signed payloads beyond sha256 (LAN-trust model, same as the rest of `:8770`).
