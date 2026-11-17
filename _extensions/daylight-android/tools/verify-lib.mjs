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
 * Returns null when they agree or when there is no .sha256 text to compare with,
 * otherwise the failure message.
 */
export function bakedPayloadFailure(bakedJarBytes, shaFileText) {
  if (shaFileText == null) return null;
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
