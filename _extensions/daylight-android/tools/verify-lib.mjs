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
