// Pure helpers of verify-build.mjs, kept apart so they can be tested without an APK.
import { createHash } from 'node:crypto';

const versionParts = (name) => name.split(/[^0-9]+/).filter(Boolean).map(Number);

/** Orders build-tools directory names by numeric components, so 9.0.0 sorts below 33.0.2. */
export function byVersion(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const c = (x[i] || 0) - (y[i] || 0);
    if (c !== 0) return c;
  }
  return a.localeCompare(b);
}

/** The newest name in a list of build-tools versions, or undefined for an empty list. */
export function newestVersion(names) {
  return [...names].sort(byVersion).pop();
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Compares the payload baked into the APK with the payload build's .sha256 file.
 * Returns null when they agree, otherwise the failure message. A missing .sha256
 * file is a failure: with nothing to compare against, a stale payload would pass.
 */
export function bakedPayloadFailure(bakedJarBytes, shaFileText) {
  if (shaFileText == null) {
    return 'the payload .sha256 file is missing, so the baked payload cannot be checked against the built one (build the payload first)';
  }
  const expected = shaFileText.trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (!/^[0-9a-f]{64}$/.test(expected)) return 'the payload .sha256 file does not hold a sha256';
  const actual = sha256Hex(bakedJarBytes);
  if (actual === expected) return null;
  return `baked payload sha256 is ${actual}, but the built payload is ${expected}: the APK holds a stale payload`;
}

/**
 * Is this libpianobridge.so the real synth, built the way it ships? What a wrong
 * library cannot show:
 * - the JNI exports under the class name the APK's PianoEngine has;
 * - the log line SfizzEngine.cpp compiles only with HAVE_SFIZZ defined, which also
 *   makes it call into sfizz, so the library cannot link without the sampler (sfizz's
 *   own "[sfizz]" messages are debug output and are gone from an optimized build);
 * - a size between the two bounds below. Measured, stripped: the optimized library is
 *   about 0.9 MB (armeabi-v7a) and 1.3 MB (arm64-v8a); CMake's unoptimized Debug build
 *   is 2.4 MB and 4.2 MB; a build without the sampler is a few tens of kilobytes;
 * - no path under the build machine's home directory (`homeDir`, when given).
 * Returns null when it is, otherwise the failure message.
 */
export const SYNTH_SFIZZ_MARKER = 'SfizzEngine created (sfizz vendored)';
export const SYNTH_LIBRARY_MIN_BYTES = 512 * 1024;
export const SYNTH_LIBRARY_MAX_BYTES = 2 * 1024 * 1024;

export function synthLibraryFailure(bytes, homeDir) {
  if (!bytes || bytes.length === 0) return 'the synth library is missing';
  if (!bytes.includes('Java_net_kckern_daylight_cap_synth_shell_PianoEngine_nativeLoadPreset')) {
    return 'the synth library has no JNI exports for net.kckern.daylight.cap.synth.shell.PianoEngine';
  }
  if (!bytes.includes(SYNTH_SFIZZ_MARKER)) return 'sfizz is not linked into the synth library: it would make no sound';
  if (bytes.length < SYNTH_LIBRARY_MIN_BYTES) return `the synth library is too small to hold the sampler (${bytes.length} bytes)`;
  if (bytes.length > SYNTH_LIBRARY_MAX_BYTES) {
    return `the synth library is ${bytes.length} bytes, the size of an unoptimized or unstripped build (limit ${SYNTH_LIBRARY_MAX_BYTES})`;
  }
  if (homeDir && bytes.includes(homeDir)) return 'the synth library names source paths on the build machine';
  return null;
}

/**
 * The permission entries of `aapt2 dump badging`: each as {name, sdk23, maxSdkVersion}.
 * `uses-permission-sdk-23` (asked for only on API 23 and up) and `maxSdkVersion`
 * (asked for only up to that API) change what a device is granted, so they are part
 * of the entry and not left aside.
 */
export function parsePermissions(badging) {
  const out = [];
  for (const m of badging.matchAll(/^uses-permission(-sdk-23)?: name='([^']+)'(.*)$/gm)) {
    const max = /maxSdkVersion='(\d+)'/.exec(m[3]);
    out.push({ name: m[2], sdk23: Boolean(m[1]), maxSdkVersion: max ? Number(max[1]) : null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A permission as a capability.yml or device file states it: a name, or {name, sdk23, maxSdkVersion}. */
export function expectedPermission(entry) {
  if (typeof entry === 'string') return { name: entry, sdk23: false, maxSdkVersion: null };
  return { name: String(entry.name), sdk23: Boolean(entry.sdk23), maxSdkVersion: entry.maxSdkVersion == null ? null : Number(entry.maxSdkVersion) };
}

const describePermission = (p) => `${p.sdk23 ? 'uses-permission-sdk-23' : 'uses-permission'} ${p.name}${p.maxSdkVersion == null ? '' : ` maxSdkVersion=${p.maxSdkVersion}`}`;

/** Every way the APK's permissions differ from the expected ones, as messages. Empty when they agree. */
export function permissionFailures(apkPermissions, expectedPermissions) {
  const failures = [];
  const expected = new Map(expectedPermissions.map((p) => [p.name, p]));
  const seen = new Set();
  for (const p of apkPermissions) {
    const want = expected.get(p.name);
    if (seen.has(p.name)) { failures.push(`permission declared twice in the APK: ${p.name}`); continue; }
    seen.add(p.name);
    if (!want) { failures.push(`unexpected permission: ${describePermission(p)}`); continue; }
    if (p.sdk23 !== want.sdk23 || p.maxSdkVersion !== want.maxSdkVersion) {
      failures.push(`permission ${p.name} is declared as "${describePermission(p)}" in the APK, expected "${describePermission(want)}"`);
    }
  }
  for (const want of expectedPermissions) {
    if (!seen.has(want.name)) failures.push(`missing permission: ${describePermission(want)}`);
  }
  return failures;
}

const COMPONENT_KINDS = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];

/** The components an APK declares, from `aapt2 dump xmltree --file AndroidManifest.xml`, as "kind name". */
export function parseApkComponents(xmltree) {
  const out = [];
  const lines = xmltree.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const element = /^\s*E: ([a-z-]+) /.exec(lines[i]);
    if (!element || !COMPONENT_KINDS.includes(element[1])) continue;
    // The element's attributes follow it, up to the next element.
    for (let j = i + 1; j < lines.length && !/^\s*E: /.test(lines[j]); j++) {
      const name = /android:name\(0x01010003\)="([^"]+)"/.exec(lines[j]);
      if (name) { out.push(`${element[1]} ${name[1]}`); break; }
    }
  }
  return out.sort();
}

/** The components a source AndroidManifest.xml declares, as "kind name"; a leading dot is the module's namespace. */
export function declaredComponents(manifestXml, namespace) {
  const out = [];
  const withoutComments = manifestXml.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of withoutComments.matchAll(/<(activity-alias|activity|service|receiver|provider)\b([^>]*)>/g)) {
    const name = /android:name="([^"]+)"/.exec(m[2]);
    if (!name) continue;
    out.push(`${m[1]} ${name[1].startsWith('.') ? namespace + name[1] : name[1]}`);
  }
  return out.sort();
}

/**
 * A component in the APK that neither the base shell nor a listed capability's shell
 * half declares is code from somewhere it should not be (an unlisted capability's
 * service, a library's provider nobody decided on). One that is declared and absent
 * is a capability that will not work.
 */
export function componentFailures(apkComponents, expectedComponents) {
  const failures = [];
  for (const c of apkComponents) if (!expectedComponents.includes(c)) failures.push(`unexpected component in the APK: ${c}`);
  for (const c of expectedComponents) if (!apkComponents.includes(c)) failures.push(`component missing from the APK: ${c}`);
  return failures;
}

/** What kind of build was verified, for the last line of the output. */
export function buildTypeLine(badging, signerText) {
  const debuggable = /^application-debuggable/m.test(badging);
  const signer = signerText == null ? 'signer not checked'
    : /CN=Android Debug/.test(signerText) ? 'signed with the Android debug key' : 'signed with a key that is not the Android debug key';
  return `${debuggable ? 'debug build (debuggable)' : 'not debuggable'}, ${signer}`;
}
