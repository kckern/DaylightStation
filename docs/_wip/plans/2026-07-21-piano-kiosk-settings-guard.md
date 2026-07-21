# Piano Kiosk Settings Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the piano-bridge APK detect and repair drift in FKB's kiosk-critical settings, so a debugging session that disables kiosk mode can't silently leave the tablet unlocked.

**Architecture:** A new `KioskSettingsGuard` running on a slow (60s) timer inside the existing `PianoBridgeService`, separate from the 2s page-health `KioskWatchdog`. It reads FKB's live settings via a new `FkbRest.listSettings()`, compares against a desired set, and writes back **only the keys that drifted**. It holds off while an APK install is plausibly in flight, and exposes an explicit disarm API for hands-on tuning.

**Tech Stack:** Java 11, plain `java.util.Timer`, hand-rolled flat-YAML config, NanoHTTPD-style `ControlServer` routes, JVM unit tests via Gradle.

---

## Background

The tablet at the piano runs Fully Kiosk Browser displaying the piano SPA, plus this bridge APK. On 2026-07-21 `kioskMode` was found set to `false` — turned off during earlier work and never restored. Nothing detected it.

The APK has **no existing kioskMode handling** — `grep -rn "kioskMode\|BooleanSetting"` across `net/kckern/pianobridge/` returns zero hits. The only occurrences are host-side in `cli/fkb.cli.mjs`. So this is new behavior, not a repair.

### The conflict this design must respect

`_extensions/piano-bridge/README.md:163-168` (deploy step 4) *deliberately* sets `kioskMode false`, because FKB's kiosk mode auto-dismisses Android's install dialog with `INSTALL_FAILED_ABORTED`. Step 8 (`README.md:187-189`) restores it. A guard that blindly re-asserts would re-arm kiosk mode mid-install and kill the confirm tap — breaking the very deploy that ships it.

**Decisions taken (KC, 2026-07-21):**
- **Suppression:** infer from install activity — hold off when an `/update` was received recently or an install is in flight. No new manual deploy step.
- **Scope:** the full kiosk-critical set, not just `kioskMode`.
- **Escape hatch:** an explicit API to disarm the guard for an hour, for hands-on fiddling.

### Existing code this builds on

| Thing | Location |
|---|---|
| Page-health watchdog (2s tick, heartbeat/fps, self-heal ladder) | `KioskWatchdog.java` |
| FKB REST client — `command(cfg, cmd)`, `reachable`, `deviceInfo` | `FkbRest.java:50,69,89` |
| `fkbPassword` accessor (default `""`, set via `pbctl`, NOT baked) | `DeviceConfig.java:176` |
| Flat-YAML config, merge-on-write override | `DeviceConfig.java:66-118` |
| Config hot-reload hook | `PianoBridgeService.java:493-494` |
| Suppression-window precedent | `DeviceConfig.java:190` (`fkbWakeSuppressUntilEpochMs`) |
| Durable event log | `CrashLog.note(kind, msg)` |
| Diagnostics aggregation | `SystemDiagnostics.java:114-120` |
| Version (must bump every build) | `app/app/build.gradle:27-28` — currently `versionCode 21` |

**`FkbRest.command()` takes a bare command string** and URL-encodes nothing but the password (`:41`). It cannot send `key=`/`value=` params. That gap is Task 1.

---

## Task 1: `FkbRest` — parameterized commands and settings read

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/FkbRest.java`
- Test: `_extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/FkbRestUrlTest.java`

**Step 1: Write the failing test.** Extract URL building into a pure static so it is testable without a device. Test that:
- `buildUrl(host, port, pw, "loadStartUrl", null)` produces the existing shape (no behavior change for current callers).
- `buildUrl(..., "setBooleanSetting", {key: "kioskMode", value: "true"})` includes both params.
- Params and password are URL-encoded — assert a password containing `&`, `=`, `+` and a space survives round-trip. **This matters:** the real FKB password contains special characters (see project docs), and today only the password is encoded.
- Param ordering is deterministic (use a `LinkedHashMap`) so the test isn't flaky.

**Step 2:** Run it, confirm it fails.

```bash
cd _extensions/piano-bridge/app && export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home && ./gradlew :app:testDebugUnitTest --tests '*FkbRestUrlTest*'
```

**Step 3: Implement.**
- Add `static String buildUrl(String host, int port, String password, String cmd, Map<String,String> params)`.
- Add overload `command(DeviceConfig cfg, String cmd, Map<String,String> params)`; keep the existing 2-arg `command` delegating to it with `null` so no caller changes.
- Add `Map<String,String> listSettings(DeviceConfig cfg)` — calls `listSettings` with `type=json`, parses the flat JSON object into a string map. FKB returns booleans unquoted and strings quoted; normalize both to `String` (`"true"`, `"30"`). Return an **empty map on any failure** (unreachable, auth failure, malformed) — never null, and never a partial map that could be mistaken for drift.
- Reuse whatever JSON parsing `FkbRest.deviceInfo` already does rather than adding a dependency.

**Step 4:** Run tests, confirm pass. **Step 5:** Commit.

---

## Task 2: The desired-settings table and drift detection (pure logic)

This is the heart of the feature and must be testable with no device and no network.

**Files:**
- Create: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/KioskSettings.java`
- Test: `_extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/KioskSettingsTest.java`

**The desired set** — mirror exactly what `cli/fkb.cli.mjs` already applies, so host CLI and APK cannot disagree. Sourced from `fkb.cli.mjs` `keepawake` (`:214-219`) and `recovery` (`:245-257`):

```
kioskMode                   = true      (the trigger for this work)
keepScreenOn                = true
setWifiWakelock             = true
preventSleepWhileScreenOff  = true
reloadOnWifiOn              = true
reloadOnInternet            = true
waitInternetOnReload        = true
restartOnCrash              = true
reloadPageFailure           = "30"      (string; seconds, 0 = disabled)
reloadOnIdle                = "0"       (string; asserted OFF deliberately)
reloadEachSeconds           = "0"       (string; asserted OFF deliberately)
```

Note `reloadOnIdle` and `reloadEachSeconds` are asserted **off** — `fkb.cli.mjs:248-249` explains why (they would interrupt idle video watching). Carry that comment across; a future reader will otherwise "fix" them.

**Step 1: Write the failing test.** Cover:
- No drift when live settings match desired → empty result.
- `kioskMode=false` live → exactly one drift entry, with the key, live value, and desired value.
- Multiple drifted keys → all reported.
- A key **absent** from live settings → NOT treated as drift (FKB version differences must not cause an endless write loop against a setting that doesn't exist). This is the most important test in the file.
- An empty live map (the read-failure sentinel from Task 1) → NO drift reported, so a network blip can't trigger a blind rewrite of everything.
- Boolean comparison is value-based, not string-identity: live `"true"` matches desired `true` regardless of case.

**Step 2-4:** Confirm failure, implement `static List<Drift> detect(Map<String,String> live)` plus the desired-set constant, confirm pass. **Step 5:** Commit.

---

## Task 3: `KioskSettingsGuard` — the timer, suppression, and repair

**Files:**
- Create: `.../net/kckern/pianobridge/KioskSettingsGuard.java`
- Modify: `.../net/kckern/pianobridge/DeviceConfig.java` (new accessors near `:212-220`)
- Modify: `.../net/kckern/pianobridge/PianoBridgeService.java` (instantiate, start, hot-reload)
- Test: `.../test/java/net/kckern/pianobridge/KioskSettingsGuardTest.java`

**New config accessors** (follow the existing `boolOr`/`longOr` style):

```
watchdogKioskSettingsEnabled      default true
watchdogKioskSettingsIntervalMs   default 60000    (slow — drift is not urgent)
watchdogKioskSettingsInstallHoldMs default 900000  (15 min hold after an /update)
kioskSettingsDisarmUntilEpochMs   default 0        (set by the disarm API)
```

**Guard behavior, per tick:**

1. Skip if `!watchdogKioskSettingsEnabled`.
2. Skip if `now < kioskSettingsDisarmUntilEpochMs` → verdict `DISARMED`.
3. Skip if an install is plausibly in flight → verdict `INSTALL_HOLD`. Two signals, either sufficient:
   - `now - lastUpdateRequestAtMs < watchdogKioskSettingsInstallHoldMs`, where `lastUpdateRequestAtMs` is stamped by the `/update` route (Task 4).
   - An install session is actually active, if `PianoBridgeService`'s updater already tracks one — check before adding new state; prefer reusing an existing flag over inventing one.
4. Skip if `fkbPassword` is empty → verdict `NO_PASSWORD`, and `CrashLog.note` **once** (not every tick — a permanently unconfigured device must not fill the log).
5. `FkbRest.listSettings()`; empty map → verdict `UNREACHABLE`, no writes.
6. `KioskSettings.detect(live)`; empty → verdict `OK`.
7. For each drifted key, write it back with the correct setter (`setBooleanSetting` for booleans, `setStringSetting` for strings — mirror `fkb.cli.mjs:119-124`). **Write only drifted keys**, never the whole set.
8. `CrashLog.note("KIOSKSET", ...)` naming each key repaired with its before → after value. This log line is the whole point: it is how KC learns kiosk mode was found off.

**Tests** (inject a fake settings reader/writer; no network):
- Drift found → exactly the drifted keys written, with the right setter per type.
- No drift → zero writes.
- Disarmed → zero reads and zero writes.
- Install hold active → zero writes.
- Empty password → zero reads, and the log note fires only once across many ticks.
- Read failure (empty map) → zero writes.

**Wiring:** instantiate alongside `KioskWatchdog` in `PianoBridgeService` (~`:152-159`), start its own daemon `Timer`, and add it to the `updateConfig` hot-reload path (~`:493-494`) so `pbctl config set` takes effect without a restart.

---

## Task 4: Install-activity stamp, disarm API, and observability

**Files:**
- Modify: `.../net/kckern/pianobridge/ControlServer.java`
- Modify: `.../net/kckern/pianobridge/SystemDiagnostics.java` (~`:114-120`)
- Modify: `_extensions/piano-bridge/pbctl.mjs`

1. **Stamp installs.** In the `/update` route, record `lastUpdateRequestAtMs = now` before starting the download, and expose it to the guard. This is the suppression signal from Task 3 step 3.

2. **Disarm API.** `POST /kiosk/settings/disarm?minutes=60` — default 60 when the param is absent, clamp to a sane maximum (24h) so a typo can't disarm forever. Persist `kioskSettingsDisarmUntilEpochMs` through `DeviceConfig.writeOverride()` so it **survives a bridge restart** — someone fiddling with the tablet will restart things, and a disarm that evaporates on restart is worse than useless. Add `POST /kiosk/settings/rearm` to clear it immediately.

3. **Snapshot.** Add a `kioskSettings` node to `GET /kiosk` (or `/diagnostics`, matching how `KioskWatchdog.snapshot()` is surfaced): last verdict, last check time, drift count at last check, the keys repaired since boot with counts, `disarmUntil`, and whether an install hold is active.

4. **pbctl.** Add commands mirroring the existing renderers (`pbctl.mjs:168-204`):
   - `pbctl kiosk-settings` — show the snapshot
   - `pbctl kiosk-disarm [minutes]` — disarm (default 60)
   - `pbctl kiosk-rearm` — re-arm now

---

## Task 5: Build, docs, deploy

**Step 1: Bump `versionCode` to 22** in `app/app/build.gradle:27` and set a descriptive `versionName`. PackageInstaller **rejects** `versionCode <=` the installed one — forgetting this makes the install silently fail.

**Step 2: Build.**
```bash
cd _extensions/piano-bridge/app
export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home
./gradlew :app:testDebugUnitTest && ./gradlew :app:assembleDebug
```
Expected: all unit tests pass, APK at `app/build/outputs/apk/debug/app-debug.apk`.

**Step 3: Docs.**
- `_extensions/piano-bridge/README.md` — document the guard, the desired-settings table, the disarm/rearm API, and the new config keys. **Update the deploy checklist**: steps 4 and 8 stay (the guard does not remove the need to disable kiosk mode for the install), but note that step 8 is now a belt-and-braces — the guard restores it within ~60s if forgotten. Note the install hold means the guard will not fight step 4.
- Do not put the real FKB password in any doc — the project's convention is a placeholder, and the working tree often has the real value substituted.

**Step 4: Deploy (needs KC — cannot be automated).**
The deploy is a pull, and Android requires **one physical tap** because FKB is not device owner:
1. Serve the APK on the LAN.
2. `pbctl update <url>`.
3. **Tap "Install" on the tablet.**
4. `fkb.cli.mjs launch net.kckern.pianobridge` (the service does not auto-restart post-install).
5. `pbctl status` until it answers.
6. Verify: `pbctl kiosk-settings` shows verdict `OK`; then `fkb.cli.mjs set kioskMode false` and confirm the guard restores it within ~60s and logs a `KIOSKSET` line.

Step 6 is the real acceptance test — everything before it is unit-tested scaffolding.

---

## Out of scope

- Changing the page-health `KioskWatchdog` (heartbeat/fps/self-heal ladder). Separate concern, separate cadence.
- The `_buildZoneLookup` guest-zone bug filed at `docs/_wip/bugs/2026-07-21-participant-roster-guest-zone-lookup-key-mismatch.md` — unrelated.
- Making FKB device-owner to remove the physical-tap requirement. Would improve deploys generally, but it is its own project.
