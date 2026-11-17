#!/usr/bin/env node
// Asserts a built device APK matches its devices/<id>.yml: package, SDK levels,
// exact permission set, a baked payload whose sha256 equals the built payload's
// .sha256 file (when that file exists), and exactly the listed capabilities.
//
//   node tools/verify-build.mjs portal
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { bakedPayloadFailure, newestVersion, sha256Hex } from './verify-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('usage: verify-build.mjs <device>'); process.exit(2); }

const BASE_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS',
];

const device = parse(readFileSync(join(root, 'devices', `${id}.yml`), 'utf8'));
const capabilities = Object.fromEntries(
  readdirSync(join(root, 'capabilities'))
    .filter((name) => existsSync(join(root, 'capabilities', name, 'capability.yml')))
    .map((name) => [name, parse(readFileSync(join(root, 'capabilities', name, 'capability.yml'), 'utf8')) || {}]),
);

const apk = join(root, 'shell/build/outputs/apk', id, 'debug', `shell-${id}-debug.apk`);
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
const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]).sort();

check(pkg === device.package, `package is ${pkg}, expected ${device.package}`);
check(minSdk === device.android.minSdk, `minSdk is ${minSdk}, expected ${device.android.minSdk}`);
check(targetSdk === device.android.targetSdk, `targetSdk is ${targetSdk}, expected ${device.android.targetSdk}`);
check(versionCode === device.shell.versionCode, `versionCode is ${versionCode}, expected ${device.shell.versionCode}`);

const expectedPermissions = [...new Set([
  ...BASE_PERMISSIONS,
  ...device.capabilities.flatMap((name) => capabilities[name]?.permissions || []),
])].sort();
const extra = permissions.filter((p) => !expectedPermissions.includes(p));
const missing = expectedPermissions.filter((p) => !permissions.includes(p));
check(extra.length === 0, `unexpected permissions: ${extra.join(', ')}`);
check(missing.length === 0, `missing permissions: ${missing.join(', ')}`);

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
console.log(`✓ ${id}: ${pkg}, sdk ${minSdk}-${targetSdk}, ${permissions.length} permissions, capabilities [${device.capabilities.join(', ')}], baked payload ${bakedSha.slice(0, 12)}`);
