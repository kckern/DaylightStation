# DaylightStation Android

One Android codebase that builds a separate APK for each household device. A device
is described by one YAML file. The build reads that file and produces an app with
that device's package name, SDK levels, ports and capabilities.

**Phase 1 is the foundation only.** There is no kiosk, no WebView and no ported
helper code. Fully Kiosk Browser still runs every device. The app built here starts
a service, serves a small control API and can swap its own logic over the network.

Operating a device (routes, error codes, settings, the lifeline, the CLI) is covered
in `__docs/reference/android/README.md`. This file covers building.

## Layout

```
devices/<id>.yml          one file per device; _example.yml is the template
capabilities/<name>/      one directory per capability
  capability.yml          entry class, and any permissions its shell half adds
  payload/                optional: logic, loaded at runtime
  shell/                  optional: Android declarations baked into the APK
buildSrc/                 reads and validates devices and capabilities; generates DeviceConfig
shell-api/                the two interfaces shared by the shell and the payload
core/                     settings registry, token auth, router, control server
payload/                  the fixed entry class; wires a device's capabilities into the core
shell/                    the installed app: service, payload loader, lifeline
gradle/payload-dex.gradle dexes each device's payload and bakes it into its shell
tools/verify-build.mjs    checks a built APK against its device file
cli/daylight-device.mjs   the fleet CLI (repo entry: cli/daylight-device.cli.mjs)
```

## Shell and payload

The **shell** is the installed APK. Android fixes its manifest at install time, so
changing a permission or a declared component means installing a new APK.

The **payload** is a jar of dexed classes (payload + core + the device's
capabilities) that the shell loads at runtime. A copy is baked into the APK as
`assets/payload-baked.jar` so a fresh install has something to run. A newer payload
can be sent to a running device through the lifeline without reinstalling.

Installing a new shell replaces the running payload. The shell records its
`versionCode` beside its payload pointers. On the first start after the number
changes it extracts the new APK's baked payload as `p0-baked-v<versionCode>.jar`
and makes it current; the payload that was current, pushed or baked, becomes
previous and is one rollback away. A reinstall with the same `versionCode` is not
seen as a new shell and keeps the stored payload, so bump the number for every
install.

A pushed payload is always stored as `p-<first 12 hex of its sha256>.jar`. The name
in its URL is not used, so a push can never overwrite another stored payload or the
baked one.

## Build

Requirements: JDK 11 and the Android SDK (platform 33 and a build-tools release).

```bash
export JAVA_HOME={jdk-11-home}
export ANDROID_HOME={android-sdk}
export DAYLIGHT_ANDROID_TOKENS={private-tokens-file}
```

Run from this directory:

```bash
./gradlew build                                # all unit tests and lint, all devices
./gradlew :shell:assemble<Device>Debug         # one device's APK, payload baked in
./gradlew :payload:payload<Device>             # one device's payload jar + sha256
node tools/verify-build.mjs <device>
```

`<Device>` is the device id with a capital first letter, for example
`assemblePortalDebug` for `devices/portal.yml`.

Outputs:

- APK: `shell/build/outputs/apk/<id>/debug/shell-<id>-debug.apk`
- Payload: `payload/build/payload/<id>/<id>-<payloadVersion>.jar` and `.jar.sha256`

Building the APK always dexes the payload again, writes its `.sha256` and bakes
that jar, so the payload inside an APK is the one built from the current sources.

The payload version defaults to `p1-foundation`. Override it with
`-PpayloadVersion=<name>`.

`tools/verify-build.mjs` reads the built APK and fails with exit code 1 when the
package, SDK levels, version code, permission set or the capability classes in the
baked payload differ from the device file. It also compares the sha256 of the
APK's `assets/payload-baked.jar` with the payload build's `.jar.sha256` file (the
most recently written one, when any exists) and fails when they differ, which
means the APK holds a stale payload. Run it after building and before installing.
It needs `ANDROID_HOME` and the repo's `node_modules`.

Tests: `./gradlew build` runs the Java unit tests of every module. The Node tests
for the CLI and the verifier's helpers run with
`node --test _extensions/daylight-android/cli/ _extensions/daylight-android/tools/`
from the repo root.

## The tokens file

Every request to a device needs that device's control token. Tokens live in a
private YAML file outside the repo:

```yaml
<device-id>:
  host: {device-address}      # used by the CLI only
  token: "<secret>"           # at least 32 characters: letters, digits, _ and -
```

The build finds the file through `-PcontrolTokens=<file>` or
`$DAYLIGHT_ANDROID_TOKENS`. The CLI uses `$DAYLIGHT_ANDROID_TOKENS`, or
`$DAYLIGHT_BASE_PATH/data/household/auth/daylight-android.yml` when that is unset.

The same file may hold a `placeholders:` map. A string under `defaults:` in a
device file can contain `{name}`, which the build replaces with the value of
`placeholders.name` when that device's payload is compiled. Addresses and device
identities go there and never in a device file. A `{name}` with no value fails the
build of that one device, naming the placeholder and the setting.

```yaml
placeholders:
  piano_speaker_mac: "{speaker-address}"
  piano_speaker_name: "{speaker-name}"
```

The token is compiled into the shell APK. A device build with no token fails, since
it would install an API nobody could reach. Rotating a token means installing a new
shell. Never print the file, and never put a token in a command line, a doc or a
commit.

## Add a device

1. Copy `devices/_example.yml` to `devices/<id>.yml`. The file name must equal `id`,
   and `id` must match `[a-z][a-z0-9]*`. Files starting with `_` are not devices.
   The ids `debug`, `release`, `main` and `test` are refused: they are Android
   source-set names.
2. Set `package` (two devices with the same package are refused),
   `android.minSdk` (26 or higher), `android.targetSdk`, the two ports (they must
   differ), `shell.versionCode`, `shell.versionName` (letters, digits, `.`, `_`
   and `-` only) and the list of `capabilities`.
3. Put any device defaults under `defaults:`. Each key must be a setting that one of
   the device's capabilities declares. This is checked when the payload starts, not
   at build time: a wrong key makes the payload refuse to start.
4. Optional keys: `permissions:` lists permissions no capability owns (declared
   ahead of time, because a payload update cannot add one), and
   `foregroundServiceTypes:` sets the shell service's types (`mediaPlayback`,
   `microphone`, `location`, and the other Android names).
5. Add the device's entry to the private tokens file, with any placeholders its
   defaults use.
6. Build with `./gradlew :shell:assemble<Device>Debug` and run the verifier.

Bump `shell.versionCode` each time a new shell is installed on the device.

## Add a capability

1. Create `capabilities/<name>/capability.yml` with `entry:` set to the fully
   qualified class that implements `net.kckern.daylight.core.Capability`. A
   capability with a `payload/` half must have an `entry`.
2. Put the logic in `capabilities/<name>/payload/` (copy the `build.gradle` from
   `debug-tools`). The entry class needs a public no-argument constructor. In
   `register` it declares its settings and routes; `start` and `stop` do the work.
   A capability talks to the core only, never to another capability.
3. If it needs manifest entries (a permission, a service, a receiver), add a
   `capabilities/<name>/shell/` Android library module with its own manifest, and
   list each permission under `permissions:` in `capability.yml` so the verifier
   expects it.
4. List the capability under `capabilities:` in each device file that should have
   it. A device's APK and payload contain only the capabilities it lists.

Two more `capability.yml` keys: `requires: [<name>, ...]` makes the build refuse a
device that lists this capability without the named ones, and `native: true` makes
it refuse a device with no `abis`.

`start()` runs on a worker thread with no Looper and must return quickly; work that
needs the main thread is posted to `new Handler(Looper.getMainLooper())`. `stop()`
may be called twice. When `core.shell().context()` is null (a JVM test of the whole
payload), `start()` returns without touching Android.

A payload module is not checked by lint for missing permissions: the permissions
are in the shell half, and `tools/verify-build.mjs` checks the built APK.

## Porting code from the old helper apps

`bash tools/port.sh <move|adapt> <source.java> <dest-dir> <new.package> [Old=New ...]`
copies one file, rewrites its package, applies class renames and records the pair
in `tools/port-map.tsv`. `node tools/port-check.mjs` then compares every `move` row
with its source (package, imports and added `public` aside) and lists the `adapt`
rows. A move and a behavior change never share a commit; a file that is edited
after its move has its row changed to `adapt`.

## Rules

- Never commit an APK, a payload jar, `local.properties`, or anything under
  `build/` or `.gradle/`. The only tracked jar is the Gradle wrapper; `.gitignore`
  ignores every other `*.jar`.
- `devices/` holds device files only. Files there whose name contains `secret`,
  `token` or `auth` are ignored by git, so do not name a device that way.
- No addresses, tokens or household paths in this directory. Device files hold
  package names, SDK levels, ports, permission names and setting defaults; a
  default that is an address or a device identity is a `{placeholder}`.
- Nothing here is installed on a device by the build. Installing is a manual step.
