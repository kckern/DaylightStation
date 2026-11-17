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

The payload version defaults to `p1-foundation`. Override it with
`-PpayloadVersion=<name>`.

`tools/verify-build.mjs` reads the built APK and fails with exit code 1 when the
package, SDK levels, version code, permission set or the capability classes in the
baked payload differ from the device file. Run it after building and before
installing. It needs `ANDROID_HOME` and the repo's `node_modules`.

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

The token is compiled into the shell APK. A device build with no token fails, since
it would install an API nobody could reach. Rotating a token means installing a new
shell. Never print the file, and never put a token in a command line, a doc or a
commit.

## Add a device

1. Copy `devices/_example.yml` to `devices/<id>.yml`. The file name must equal `id`,
   and `id` must match `[a-z][a-z0-9]*`. Files starting with `_` are not devices.
2. Set `package` (unique per device), `android.minSdk` (26 or higher),
   `android.targetSdk`, the two ports (they must differ), `shell.versionCode`, and
   the list of `capabilities`.
3. Put any device defaults under `defaults:`. Each key must be a setting that one of
   the device's capabilities declares. This is checked when the payload starts, not
   at build time: a wrong key makes the payload refuse to start.
4. Add the device's entry to the private tokens file.
5. Build with `./gradlew :shell:assemble<Device>Debug` and run the verifier.

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

`debug-tools` is the only capability today. It has a payload half and no shell half.

## Rules

- Never commit an APK, a payload jar, `local.properties`, or anything under
  `build/` or `.gradle/`. The only tracked jar is the Gradle wrapper.
- No addresses, tokens or household paths in this directory. Device files hold
  package names, SDK levels and ports only.
- Nothing here is installed on a device by the build. Installing is a manual step.
