export function isContentFingerprint(value) {
  return value != null && typeof value.hash === 'function';
}
