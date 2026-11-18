# DaylightStation Android

One Android codebase that builds a separate APK for each household device. A device
is described by one YAML file. The build reads that file and produces an app with
that device's package name, SDK levels, ports and capabilities.

**State.** A fourth device, `phone`, builds from `devices/phone.yml` (not a kiosk; see
`__docs/reference/android/phone.md`): web views, one-tap actions, native audio with
Android Auto, voice memos and local notifications. It has never been installed; its
acceptance checklist is `__docs/runbooks/android/phone-acceptance.md`. The phone's
media capability is the only user of Jetpack Media3, pinned to 1.1.1, the newest
version that builds at compileSdk 33; no kiosk APK contains it. Phase 1 built the foundation: a service, a control API and a payload the
app can swap over the network. Phase 2 ported the helper code of the old helper apps
into capabilities. Phase 3 added the kiosk: the WebView window and its page bridge,
lockdown, screen power, volume, the app launcher and the remote diagnostics
(`debug-tools`). The `piano`, `portal` and `shield` device files list all of it,
with lockdown switched off and every coexistence switch off, and each build serves
every route of the control API contract. A build that lists `lockdown` gets a HOME
filter on a disabled activity-alias of the kiosk Activity from its generated
device manifest, so installing it adds no home candidate. Fully Kiosk Browser and the old helpers still
run every device. The only hardware fact: on 2026-11-16 the phase 1 build was
installed on the Portal beside the existing apps, its payload loaded and the
control API answered. Nothing from phase 2 or phase 3 has run on a device.

Operating a device (routes, error codes, settings, the lifeline, the CLI) is
covered in `__docs/reference/android/README.md`, and the kiosk capabilities (the
page bridge, lockdown, the debug tools, the one-time grants) in
`__docs/reference/android/kiosk.md`. Switching a device
from Fully to this app is `__docs/runbooks/android/kiosk-cutover.md`. This file
covers building.

## Layout

```
devices/<id>.yml          one file per device; _example.yml is the template
capabilities/<name>/      one directory per capability
  capability.yml          entry class, and any permissions its shell half adds
  payload/                optional: logic, loaded at runtime
  shell/                  optional: Android declarations baked into the APK
buildSrc/                 reads and validates devices and capabilities; generates DeviceConfig
shell-api/                the contracts shared by the shell and the payload
shell-kit/                what the phone capabilities' shell halves share (start the service, read the surface cache)
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
cli/daylight-device.mjs   the fleet CLI (repo entry: cli/daylight-device.cli.mjs); `help` lists its commands
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

The payload version defaults to `p3-kiosk`. Override it with
`-PpayloadVersion=<name>`.

`tools/verify-build.mjs` reads the built APK and fails with exit code 1 when the
package, SDK levels, version code, permission set or the capability classes in the
baked payload differ from the device file. It also fails when a component's
`exported` flag or guarding permission differs from the table in
`tools/verify-lib.mjs`, when a HOME filter is anywhere but on the disabled alias,
when a lockdown build's kiosk Activity can be resized, and when a device that is
not a kiosk (the phone) asks for `REQUEST_INSTALL_PACKAGES` or
`WRITE_SECURE_SETTINGS`. A permission is compared in the form it
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

The kiosks are installed as debug builds: debuggable, signed with the Android
debug key. A release build type exists (`assemble<Device>Release`, not
debuggable); it is signed only when the private file names a keystore for the
device (`<id>_keystore` and its three companions under `placeholders:`; see
"Debug and release builds" in `__docs/reference/android/phone.md`) and is
otherwise unsigned and not installable. `verify-build.mjs <device> --release`
checks a signed one. For a debug build the limit is this: on a device with ADB
enabled, `run-as <package>` opens the app's private storage, so anyone with ADB
access can read the device's control token and the stored settings, secret ones
(`presence.token`, `lease.credential`) included. ADB is enabled on these devices
by design, so ADB access to a device is to be treated as access to its token.

Tests: `./gradlew build` runs the Java unit tests of every module. A capability's
test starts it for real over `FakeContext` (`core-testing`): build the runtime
with `TestCore.createWithContext(dir, context)`, call `start()`, assert what was
taken (`context.receivers`, a bound port, a key filter), call `stop()` and assert
it was all given back, then `stop()` again. What the JVM cannot show is listed in
the reference under "Not covered by JVM tests". `debug-tools` also runs the
JavaScript it generates for the page in Node, against a stand-in window, so Node
must be on the path for the Java tests as it is for the port check. The payload
module's tests run once per device, against that device's generated configuration:
`./gradlew :payload:testPianoDebugUnitTest :payload:testPortalDebugUnitTest
:payload:testShieldDebugUnitTest :payload:testPhoneDebugUnitTest`. `./gradlew build`
also reads each device's merged manifest back (`:shell:check<Device>MergedManifest`)
and fails on a HOME filter that is not on a disabled alias. Each boots the device's real capabilities with
a fake shell and applies the device file's `defaults:`, so a default for an
undeclared setting, a default of the wrong type, a default for a secret, a route or
WebSocket message type claimed twice, an entry class that cannot be constructed, a
contract route a listed capability does not serve, or a WebSocket message type that
would reach the debug tools or the settings fails the build instead of the first
start on the device. The Node tests
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
it would install an API nobody could reach. The exception is a device with
`control.bind: none`: it has no API, gets no token compiled in, and needs none. Rotating a token means installing a new
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
   the device's capabilities declares, with a value of its type and inside its rule.
   The payload refuses to start otherwise, and the build finds it first: the payload
   module's tests run once per device (`DeviceDefaultsTest`) and apply the device
   file's defaults to its real capabilities. A secret setting cannot have a default.
4. Optional keys: `permissions:` lists permissions no capability owns (declared
   ahead of time, because a payload update cannot add one), and
   `foregroundServiceTypes:` sets the shell service's types (`mediaPlayback`,
   `microphone`, `location`, and the other Android names).
   Two more optional keys, both used by the phone: `control.bind` says where the
   control API and the lifeline listen (`lan`, the default, is every interface;
   `loopback` is the device's own address only; `none`, the phone's value, starts
   neither and compiles no control token into the APK), and `appLinks: { host: "{placeholder}" }`
   offers the app for https links to that one host (the device must list
   `notifications`; the host is private, so it is a placeholder).
5. Add the device's entry to the private tokens file, with any placeholders its
   defaults use. A device with `control.bind: none` needs no token entry.
   A kiosk device file also states every coexistence switch its capabilities
   declare (`hid.enabled`, `midi.enabled`, `speaker.enabled`, `mic.enabled`,
   `volumeKeys.enabled`, `presence.enabled`, `lease.enabled`): false until that
   device's cutover. The per-device payload test fails a kiosk that leaves one out.
6. Build with `./gradlew :shell:assemble<Device>Debug` and run the verifier.

Bump `shell.versionCode` each time a new shell is installed on the device.

## Add a capability

1. Create `capabilities/<name>/capability.yml` with `entry:` set to the fully
   qualified class that implements `net.kckern.daylight.core.Capability`. A
   capability with a `payload/` half must have an `entry`.
2. Put the logic in `capabilities/<name>/payload/` (copy the `build.gradle` from
   `debug-tools`). The entry class needs a public no-argument constructor. In
   `register` it declares its settings and routes; `start` and `stop` do the work.
   A capability talks to the core only, never to another capability. Where two must
   cooperate, one provides an interface from `core/spi` through
   `core.services().provide(...)` and the other asks for it with `find` (which may
   answer null: the provider may not be in the device's build) or `require` (which
   answers 501 naming the missing capability). Notifications go over
   `core.events()` by topic.
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
   - A component Android creates by class name while the process may be cold (an
     activity another app can start, a tile, a widget) cannot count on a payload.
     It either reads what the payload last wrote (`SurfaceKeys` in `shell-api`,
     `SurfaceCache` in `shell-kit`; the tiles and the widget do this) or asks the
     payload through a `PayloadPort` in `shell-api`: the payload attaches a handler
     at start and detaches it at stop, the component calls with a wait and has a
     stated fallback for `NotReadyException`. The link activity does this, after
     starting the shell service with `ShellStart.ensure`. Requests and answers are
     JSON text, so a payload swap cannot break an installed component.
     The media library service (`media` port) and the memo recorder (`memos` port)
     do the same. A port's name is spelled on both sides, with a test on each side
     that pins it, so that adding a port does not change `shell-api`.
   - A component that must not be reachable from outside the app (the play screen,
     the record screen, the recorder service) is declared `exported="false"` and is
     started by the payload by class name, while the link activity is on screen. A
     link's answer still cannot name an activity (`LinkEffect`).
   - Every component needs a row in `EXPECTED_COMPONENTS` (`tools/verify-lib.mjs`):
     its `exported` flag, its bind permission and, for a service, its foreground
     service type. The verifier fails a build whose APK differs from the table.
   - Base permissions only a kiosk needs (`REQUEST_INSTALL_PACKAGES`,
     `WRITE_SECURE_SETTINGS`) are not in the shell's manifest. The generated device
     manifest adds them to a build that lists `lockdown`, or `webview-host` with a
     control bind other than `none`.
   - A device with `control.bind: none` is held to an exact list
     (`PersonalBuild` in `buildSrc`, `personalBuildFailures` in the verifier): its
     permissions and exported components are those the base shell and its
     capabilities declare and no others, cleartext traffic is off, its address
     settings are https, the setup Activity is not exported, and the kiosk
     Activity has no lock task and no TV launcher category.
   - A part of a capability that takes hardware an old helper app also uses goes
     behind a `LiveSwitch` (core): a BOOLEAN setting applied when it changes and
     reported in `/status`.
   - A device that lists `webview-host` has one launcher icon, the kiosk Activity:
     the generated device manifest takes the launcher filter off the shell's setup
     Activity.
4. List the capability under `capabilities:` in each device file that should have
   it. A device's APK and payload contain only the capabilities it lists.

`capability.yml` keys:

| Key | Meaning |
|---|---|
| `entry` | The payload half's `Capability` class |
| `permissions` | Every Android permission the capability needs; an empty list when none. The verifier compares the APK's set with these lists. An entry is a name, or `{name: ..., sdk23: true}`, `{name: ..., maxSdkVersion: 30}`, or `{name: ..., kioskOnly: true}`: a kiosk-only permission is in a kiosk's APK and is removed from the APK of any other device by its generated manifest |
| `exported` | Class names of the components of the shell half that another app can reach. A device with `control.bind: none` fails its build when its merged manifest exports a component no listed capability names here, or does not export one that is named |
| `requires` | Capabilities a device must also list, or its build is refused |
| `native` | `true` when the shell half ships native code; a device with no `abis` is refused |
| `startsAfter` | Capabilities that must come earlier in a device's list when the device lists them too (capabilities start in list order); the other order is refused. `audio-guard` names `synth` |

A setting that must stay off the device file (a token, a credential) is declared
with `declareSecret`. A setting whose value is household-specific and not secret (an
address, a URL) is a normal setting whose device default is a `{placeholder}`; a
capability treats an empty value as "not configured" and says so once in the log.

What a route may write down: the device's event log (`core.log()`), the shell log
(`core.shell().note`) and the log store (`LogEvents.emit`) are read by people and
shipped off the device. A route that handles what is on screen, what a page holds
or what a command printed logs that it ran and how much it returned, never the
content. `debug-tools` is the example, and its tests assert it.

Anything a capability takes from Android (an engine, a player, a permission check)
sits behind a small interface the test can replace, as `debug-tools` does for
speech, sound and the log reader; `FakeContext` answers null for the package
manager and every system service.

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
