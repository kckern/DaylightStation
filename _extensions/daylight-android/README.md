# DaylightStation Android

One Android codebase that builds a separate APK for each household device. A device
is described by one YAML file. The build reads that file and produces an app with
that device's package name, SDK levels, ports and capabilities.

**State.** Phase 1 built the foundation: a service, a control API and a payload the
app can swap over the network. Phase 2 ported the helper code of the old helper apps
into capabilities, and the `piano`, `portal` and `shield` device files build with
them. There is no kiosk and no WebView yet (phase 3). Fully Kiosk Browser and the
old helpers still run every device. The only hardware fact: on 2026-11-16 the phase
1 build was installed on the Portal beside the existing apps, its payload loaded
and the control API answered. Nothing from phase 2 has run on a device.

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
core-testing/             FakeShell and TestCore, for capability tests
gradle/payload-dex.gradle dexes each device's payload and bakes it into its shell
gradle/payload-lib.gradle applied by every module whose classes go into the payload
gradle/shell-lib.gradle   applied by every capability's shell half
tools/verify-build.mjs    checks a built APK against its device file (--legacy: and the old app's permissions)
tools/legacy-permissions.yml  the permission ledger --legacy reads
tools/port.sh             copies a file out of an old helper app and records it
tools/port-check.mjs      checks the recorded copies against their sources
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
A device that lists `synth` also needs NDK 26.1.10909125, CMake 3.22.1 and the
vendored sfizz tree (see "The synth's native build").

```bash
export JAVA_HOME={jdk-11-home}
export ANDROID_HOME={android-sdk}
export DAYLIGHT_ANDROID_TOKENS={private-tokens-file}
```

Run from this directory:

```bash
./gradlew build                                # all unit tests, lint and the port check, all devices
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

The payload version defaults to `p2-helpers`. Override it with
`-PpayloadVersion=<name>`.

`tools/verify-build.mjs` reads the built APK and fails with exit code 1 when the
package, SDK levels, version code, permission set or the capability classes in the
baked payload differ from the device file. A permission is compared in the form it
is declared: `uses-permission-sdk-23` and a `maxSdkVersion` are part of it, and a
`capability.yml` that needs one states the permission as
`{name: ..., sdk23: true}` or `{name: ..., maxSdkVersion: 30}`. The APK's
activities, services, receivers and providers must be exactly those the base shell
and the listed capabilities' shell halves declare, so a component from a
capability the device does not list fails. It also compares the sha256 of the
APK's `assets/payload-baked.jar` with the payload build's `.jar.sha256` file (the
most recently written one) and fails when they differ, which means the APK holds a
stale payload, or when there is no such file to compare with. Its last line names
the kind of build it checked. Run it after building and before installing. It
needs `ANDROID_HOME` and the repo's `node_modules`; with a Java runtime on hand it
also reads the signing certificate.

Only a debug build exists. Every APK this project produces is debuggable and
signed with the Android debug key; there is no release signing configuration.
That is an accepted limit, and what it means is this: on a device with ADB
enabled, `run-as <package>` opens the app's private storage, so anyone with ADB
access can read the device's control token and the stored settings, secret ones
(`presence.token`, `lease.credential`) included. ADB is enabled on these devices
by design, so ADB access to a device is to be treated as access to its token.

Tests: `./gradlew build` runs the Java unit tests of every module. The payload
module's tests run once per device, against that device's generated configuration:
`./gradlew :payload:testPianoDebugUnitTest :payload:testPortalDebugUnitTest
:payload:testShieldDebugUnitTest`. Each boots the device's real capabilities with
a fake shell and applies the device file's `defaults:`, so a default for an
undeclared setting, a default of the wrong type, a default for a secret, a route or
WebSocket message type claimed twice, or an entry class that cannot be constructed
fails the build instead of the first start on the device. The Node tests
for the CLI and the verifier's helpers run with
`node --test _extensions/daylight-android/cli/ _extensions/daylight-android/tools/`
from the repo root.

## The synth's native build

`capabilities/synth/shell/` holds the JNI class `PianoEngine`, the C++ sources and
the CMake build of `libpianobridge.so` (sfizz through Oboe). The library is part
of the installed APK; a payload swap cannot change it.

sfizz is not in git. Point the build at the vendored tree with one line in
`local.properties` (untracked):

```
sfizz.dir={path-to-vendored-sfizz}
```

or with `DAYLIGHT_SFIZZ_DIR`. Use the revision the instrument was tuned with
(`f5c6e29`); another revision is a change to the instrument's sound. Any task that
builds the synth module stops with a message naming the setting when `sfizz.dir`
is unset or has no `CMakeLists.txt`. There is no build without sfizz: such a
library would load, answer every call and make no sound.

The first build compiles sfizz for each ABI of the devices that list `synth`.
sfizz's own configure step writes `Doxyfile` and `src/sfizz/Config.h` into its
source tree when their content differs. Its git submodule check is turned off, so
the build runs no `git submodule update` there.

`tools/verify-build.mjs` reads `lib/<abi>/libpianobridge.so` out of the APK for
each ABI and fails unless it holds the JNI exports for
`net.kckern.daylight.cap.synth.shell.PianoEngine`, the log line that is compiled
only with sfizz, a size between 512 KiB and 2 MiB, and no path under the build
machine's home directory; `liboboe.so` and `libc++_shared.so` must be beside it.

Every variant is built optimized: `CMakeLists.txt` forces `RelWithDebInfo`
(`-O2 -g -DNDEBUG`) whatever build type the Android plugin asks for, because the
debug APK is the one that gets installed and the sampler renders in the audio
callback on a slow tablet. Stripped, the library is about 0.9 MB (armeabi-v7a) and
1.3 MB (arm64-v8a); CMake's `Debug` build was 2.4 MB and 4.2 MB, which the
verifier's upper bound now refuses. The build maps the sfizz, project, NDK and
Gradle home prefixes out of `__FILE__` strings and debug info
(`-ffile-prefix-map`, `-fmacro-prefix-map`), so the shipped library names no
directory of the machine that built it. The NDK version is set once, in the root
`build.gradle`, for the synth module and for the shell: the shell needs it to
strip the libraries when it packages the APK.

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
3. If it needs manifest entries (a permission, a service, a receiver, a provider),
   resources, native code, a library, or a class Android creates by name, add a
   `capabilities/<name>/shell/` Android library module: a `build.gradle` that starts
   with `apply from: rootProject.file('gradle/shell-lib.gradle')` and sets its
   `namespace` (`net.kckern.daylight.cap.<name>.shell`), and its own manifest. List
   each permission under `permissions:` in `capability.yml` so the verifier expects
   it. A shell half is part of the installed APK: it may use `shell-api` and nothing
   from the core or a payload, and changing it means a new install (bump the
   device's `shell.versionCode`).
   - A component the payload must reach (a service, a receiver) hands itself over
     with `ShellComponents.publish(<name>, this)` from `shell-api`; the payload gets
     it through `core.shell().component(<name>)` and is told when it changes. The
     accessibility service does this.
   - A payload half that calls classes of its shell half declares
     `compileOnly project(':capabilities:<name>:shell')` (and `testImplementation`
     of the same), as `synth` and `mic-bridge` do. `compileOnly` keeps those classes
     out of the payload jar; at run time they come from the APK.
   - A payload cannot carry a library, since only its own classes are dexed. A
     library goes in the shell half as an `api` dependency (`mic-bridge` ships
     Java-WebSocket this way).
   - A capability that works in a window (the kiosk) declares its Activity in the
     shell half and drives it from the payload through `KioskHost` /
     `KioskController` in `shell-api`, as `webview-host` does. A payload's `start()`
     runs on a worker thread with no Looper: views, windows and the WebView are
     created and touched on the main thread (`MainThread` in core), and `start()`
     must not wait for it.
   - A device that lists `webview-host` has one launcher icon, the kiosk Activity:
     the generated device manifest takes the launcher filter off the shell's setup
     Activity.
4. List the capability under `capabilities:` in each device file that should have
   it. A device's APK and payload contain only the capabilities it lists.

`capability.yml` keys:

| Key | Meaning |
|---|---|
| `entry` | The payload half's `Capability` class |
| `permissions` | Every Android permission the capability needs; an empty list when none. The verifier compares the APK's set with these lists |
| `requires` | Capabilities a device must also list, or its build is refused |
| `native` | `true` when the shell half ships native code; a device with no `abis` is refused |
| `startsAfter` | Capabilities that must come earlier in a device's list when the device lists them too (capabilities start in list order); the other order is refused. `audio-guard` names `synth` |

A setting that must stay off the device file (a token, a credential) is declared
with `declareSecret`. A setting whose value is household-specific and not secret (an
address, a URL) is a normal setting whose device default is a `{placeholder}`; a
capability treats an empty value as "not configured" and says so once in the log.

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
with its source (package and imports aside, and a declaration that was made
`public`) and lists the `adapt` rows. It fails for a `move` row that differs and
for an `adapt` row that is identical to its source, so the labels stay true.
`./gradlew build` runs it (the root project's `portCheck` task, part of `check`).
A move and a behavior change never share a commit; a file that is edited
after its move has its row changed to `adapt`. The script does not rewrite imports
of nested classes from the old package; fix those by hand in the move commit.
Before committing a move, search the copied files for addresses, device names and
other household identifiers. One exception to the rule above: a file that holds
such an identifier is moved and scrubbed in the same commit, with its row set to
`adapt` and the commit message saying so, so the identifier never enters history.

## Rules

- Never commit an APK, a payload jar, `local.properties`, or anything under
  `build/` or `.gradle/`. The only tracked jar is the Gradle wrapper; `.gitignore`
  ignores every other `*.jar`.
- `devices/` holds device files only. Git tracks a file there only when its name
  is a device id followed by `.yml` (lower-case letters and digits, starting with
  a letter) or is `_example.yml`; every other name is ignored, and so is a name
  containing `secret`, `token` or `auth`, so do not name a device that way.
- No addresses, tokens or household paths in this directory. Device files hold
  package names, SDK levels, ports, permission names and setting defaults; a
  default that is an address or a device identity is a `{placeholder}`.
- Nothing here is installed on a device by the build. Installing is a manual step.
