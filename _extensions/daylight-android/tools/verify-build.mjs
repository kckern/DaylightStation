#!/usr/bin/env node
// Asserts a built device APK matches its devices/<id>.yml: package, SDK levels,
// exact permission set, a baked payload, and exactly the listed capabilities.
//
//   node tools/verify-build.mjs portal
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

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
const versionParts = (name) => name.split(/[^0-9]+/).filter(Boolean).map(Number);
const byVersion = (a, b) => {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const c = (x[i] || 0) - (y[i] || 0);
    if (c !== 0) return c;
  }
  return a.localeCompare(b);
};
const buildTools = readdirSync(join(sdk, 'build-tools'), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name).sort(byVersion).pop();
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
try {
  const jar = execFileSync('unzip', ['-p', apk, 'assets/payload-baked.jar'], { maxBuffer: 256 * 1024 * 1024 });
  const tmp = join(root, 'shell/build', `verify-${id}.jar`);
  writeFileSync(tmp, jar);
  dex = execFileSync('unzip', ['-p', tmp, 'classes.dex'], { maxBuffer: 256 * 1024 * 1024 });
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
console.log(`✓ ${id}: ${pkg}, sdk ${minSdk}-${targetSdk}, ${permissions.length} permissions, capabilities [${device.capabilities.join(', ')}]`);
