#!/usr/bin/env node
// Asserts a built device APK matches its devices/<id>.yml: package, SDK levels,
// exact permission set (uses-permission-sdk-23 and maxSdkVersion included), the
// declared components, a baked payload whose sha256 equals the built payload's
// .sha256 file (a missing file fails), and exactly the listed capabilities.
// The last line says what kind of build was checked.
//
//   node tools/verify-build.mjs portal
//   node tools/verify-build.mjs piano --legacy   (also compare with tools/legacy-permissions.yml)
//   node tools/verify-build.mjs phone --release  (the release APK: must not be debuggable or debug-signed)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  bakedPayloadFailure, buildTypeLine, componentAttributeFailures, componentFailures, declaredComponents, expectedPermission, generatedComponents,
  homeAliasFailures, kioskBasePermissions, newestVersion,
  parseApkComponents, parsePermissions, permissionFailures, sha256Hex, synthLibraryFailure,
  foregroundTypeMask, FOREGROUND_TYPE_BITS, SHELL_SERVICE, carDeclarationFailures,
  backupFailures, expectedComponentTable, personalBuildFailures, permissionsFor,
} from './verify-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('usage: verify-build.mjs <device>'); process.exit(2); }

const BASE_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', // core battery exemption request
  'android.permission.ACCESS_WIFI_STATE',                    // core wifi link telemetry
  'android.permission.ACCESS_NETWORK_STATE',                 // core wifi link telemetry
];

const device = parse(readFileSync(join(root, 'devices', `${id}.yml`), 'utf8'));
const capabilities = Object.fromEntries(
  readdirSync(join(root, 'capabilities'))
    .filter((name) => existsSync(join(root, 'capabilities', name, 'capability.yml')))
    .map((name) => [name, parse(readFileSync(join(root, 'capabilities', name, 'capability.yml'), 'utf8')) || {}]),
);

const release = process.argv.includes('--release');
const apk = release
  ? join(root, 'shell/build/outputs/apk', id, 'release', `shell-${id}-release.apk`)
  : join(root, 'shell/build/outputs/apk', id, 'debug', `shell-${id}-debug.apk`);
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

if (!existsSync(apk)) { console.error(`✗ not built: ${apk}`); process.exit(1); }

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) { console.error('✗ ANDROID_HOME is not set'); process.exit(2); }
// Newest build-tools by numeric version, so 9.0.0 sorts below 33.0.2.
const buildTools = newestVersion(readdirSync(join(sdk, 'build-tools'), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name));
const badging = execFileSync(join(sdk, 'build-tools', buildTools, 'aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' });

const pkg = /package: name='([^']+)'/.exec(badging)?.[1];
const minSdk = Number(/sdkVersion:'(\d+)'/.exec(badging)?.[1]);
const targetSdk = Number(/targetSdkVersion:'(\d+)'/.exec(badging)?.[1]);
const versionCode = Number(/versionCode='(\d+)'/.exec(badging)?.[1]);
const apkPermissions = parsePermissions(badging);
const permissions = apkPermissions.map((p) => p.name);

check(pkg === device.package, `package is ${pkg}, expected ${device.package}`);
check(minSdk === device.android.minSdk, `minSdk is ${minSdk}, expected ${device.android.minSdk}`);
check(targetSdk === device.android.targetSdk, `targetSdk is ${targetSdk}, expected ${device.android.targetSdk}`);
check(versionCode === device.shell.versionCode, `versionCode is ${versionCode}, expected ${device.shell.versionCode}`);

// One entry per name. A capability.yml or device file states a permission as a name,
// or as {name, sdk23, maxSdkVersion} when the manifest declares it that way.
const expectedByName = new Map();
for (const entry of [
  ...BASE_PERMISSIONS,
  // Only a kiosk asks for these two; a personal phone's APK must not have them.
  ...kioskBasePermissions(device),
  // Less the ones marked kioskOnly, on a device that is not a kiosk.
  ...permissionsFor(device, capabilities),
  ...(device.permissions || []),
]) {
  const p = expectedPermission(entry);
  const earlier = expectedByName.get(p.name);
  check(!earlier || (earlier.sdk23 === p.sdk23 && earlier.maxSdkVersion === p.maxSdkVersion),
    `permission ${p.name} is stated two different ways in the capability and device files`);
  expectedByName.set(p.name, p);
}
failures.push(...permissionFailures(apkPermissions, [...expectedByName.values()]));

// The shell service's foreground types must be exactly the device file's.
// aapt2 prints the flags attribute as a hex mask, for example
//   A: http://schemas.android.com/apk/res/android:foregroundServiceType(0x01010599)=0x00000088
// and prints no such line when the service has no type.
const tree = execFileSync(join(sdk, 'build-tools', buildTools, 'aapt2'), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk], { encoding: 'utf8' });
// Read for the shell service by name: a capability's own service (the media library
// service, the recorder) has a type of its own, held to the component table below.
const builtTypes = foregroundTypeMask(tree, SHELL_SERVICE);
const wantedTypes = (device.foregroundServiceTypes || []).reduce((mask, t) => mask | FOREGROUND_TYPE_BITS[t], 0);
check(builtTypes === wantedTypes, `the shell service's foregroundServiceType mask is ${builtTypes}, expected ${wantedTypes}`);

// The APK's activities, services, receivers and providers must be exactly those of
// the base shell and of the listed capabilities' shell halves.
const namespaceOf = (moduleDir) => /namespace '([^']+)'/.exec(readFileSync(join(moduleDir, 'build.gradle'), 'utf8'))?.[1] || '';
const componentsOf = (moduleDir) => {
  const manifest = join(moduleDir, 'src/main/AndroidManifest.xml');
  return existsSync(manifest) ? declaredComponents(readFileSync(manifest, 'utf8'), namespaceOf(moduleDir)) : [];
};
const expectedComponents = [...new Set([
  ...componentsOf(join(root, 'shell')),
  ...device.capabilities.flatMap((name) => componentsOf(join(root, 'capabilities', name, 'shell'))),
  ...generatedComponents(device.capabilities),
])].sort();
failures.push(...componentFailures(parseApkComponents(tree), expectedComponents));
// Each component's exported flag and the permission that guards it, against the table.
failures.push(...componentAttributeFailures(tree, expectedComponentTable(device)));
// A device with control.bind none: exactly its declared exported components, no
// cleartext traffic, no TV launcher entry, no lock task.
failures.push(...personalBuildFailures(tree, device, capabilities));
// No device's data is backed up or carried to another device.
failures.push(...backupFailures(tree));
// Installing must add no home candidate: the HOME filter is on a disabled alias only.
failures.push(...homeAliasFailures(tree, device.capabilities));

// A capability with native code must ship a library for every ABI of the device.
const entries = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).split('\n');
// Only a device that lists android-auto is offered to a car as a media app.
failures.push(...carDeclarationFailures(tree, device.capabilities, entries, !release));
for (const name of device.capabilities) {
  if (!capabilities[name]?.native) continue;
  for (const abi of device.abis || []) {
    check(entries.some((e) => e.startsWith(`lib/${abi}/`) && e.endsWith('.so')), `capability '${name}' has no native library for ${abi}`);
  }
}

// A device that lists the synth must carry the real engine for each of its ABIs: the
// library is read out of the APK and inspected, since a build without the sampler
// loads and answers every call and makes no sound. There is no flag to skip this.
if (device.capabilities.includes('synth')) {
  check((device.abis || []).length > 0, "capability 'synth' needs at least one ABI in the device file");
  for (const abi of device.abis || []) {
    let lib = null;
    try { lib = execFileSync('unzip', ['-p', apk, `lib/${abi}/libpianobridge.so`], { maxBuffer: 512 * 1024 * 1024 }); } catch { /* reported below */ }
    const failure = synthLibraryFailure(lib, homedir());
    if (failure) failures.push(`${abi}: ${failure}`);
    for (const dep of ['liboboe.so', 'libc++_shared.so']) {
      check(entries.includes(`lib/${abi}/${dep}`), `${abi}: the synth needs ${dep} in the APK`);
    }
  }
}

// --legacy: the APK's permissions must equal the old helper APKs' for this device,
// plus the additions and minus the removals recorded with a reason.
if (process.argv.includes('--legacy')) {
  const ledger = parse(readFileSync(join(root, 'tools/legacy-permissions.yml'), 'utf8'))[id];
  check(Boolean(ledger), `no entry for '${id}' in tools/legacy-permissions.yml`);
  if (ledger) {
    const wanted = [...new Set([...ledger.legacy, ...Object.keys(ledger.added || {})])]
      .filter((p) => !Object.keys(ledger.dropped || {}).includes(p)).sort();
    const notYet = wanted.filter((p) => !permissions.includes(p));
    const unexplained = permissions.filter((p) => !wanted.includes(p));
    check(notYet.length === 0, `legacy permissions not in the APK: ${notYet.join(', ')}`);
    check(unexplained.length === 0, `permissions with no legacy entry or recorded reason: ${unexplained.join(', ')}`);
  }
}

// The baked payload must define exactly the listed capabilities' entry classes.
let dex = Buffer.alloc(0);
let bakedSha = '';
try {
  const jar = execFileSync('unzip', ['-p', apk, 'assets/payload-baked.jar'], { maxBuffer: 256 * 1024 * 1024 });
  const tmp = join(root, 'shell/build', `verify-${id}.jar`);
  writeFileSync(tmp, jar);
  dex = execFileSync('unzip', ['-p', tmp, 'classes.dex'], { maxBuffer: 256 * 1024 * 1024 });
  // The baked payload must be the payload that was just built, not one left from an earlier build.
  // With several payload versions built, compare with the most recently written .sha256.
  const payloadDir = join(root, 'payload/build/payload', id);
  const shaFile = existsSync(payloadDir)
    ? readdirSync(payloadDir).filter((name) => name.endsWith('.jar.sha256')).map((name) => join(payloadDir, name))
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).pop()
    : undefined;
  const stale = bakedPayloadFailure(jar, shaFile ? readFileSync(shaFile, 'utf8') : null);
  if (stale) failures.push(stale);
  bakedSha = sha256Hex(jar);
} catch {
  failures.push('assets/payload-baked.jar is missing or has no classes.dex');
}
const descriptor = (entry) => `L${entry.replaceAll('.', '/')};`;
check(dex.includes(descriptor('net.kckern.daylight.payload.Main')), 'payload has no entry class net.kckern.daylight.payload.Main');
for (const [name, meta] of Object.entries(capabilities)) {
  if (!meta.entry) continue;
  const listed = device.capabilities.includes(name);
  const present = dex.includes(descriptor(meta.entry));
  if (listed) check(present, `capability '${name}' is listed but not in the payload`);
  else check(!present, `capability '${name}' is in the payload but not listed`);
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  process.exit(1);
}
// What was verified is a debug build: the only kind this project builds. Said here so
// that nobody reads a pass as a statement about a release build.
let signer = null;
try {
  signer = execFileSync(join(sdk, 'build-tools', buildTools, 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch { /* apksigner needs a Java runtime; without one the signer is reported as not checked */ }
console.log(`✓ ${id}: ${pkg}, sdk ${minSdk}-${targetSdk}, ${permissions.length} permissions, ${expectedComponents.length} components, capabilities [${device.capabilities.join(', ')}], baked payload ${bakedSha.slice(0, 12)}`);
const typeLine = buildTypeLine(badging, signer);
if (release && !/^not debuggable, signed with a key that is not the Android debug key$/.test(typeLine)) {
  console.error(`✗ --release: the APK is ${typeLine}`);
  process.exit(1);
}
console.log(`  build type: ${typeLine}`);
