/** Transport selection only. Native document and capability checks authorize each operation. */
export function inDaylightShell() {
  return typeof window !== 'undefined' && (Boolean(window.daylight)
    || /\bDaylightKiosk\/1\b/.test(window.navigator.userAgent));
}
