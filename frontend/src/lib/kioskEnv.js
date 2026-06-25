// kioskEnv — single place to answer "are we running on the garage fitness kiosk?"
//
// The garage fitness display is a fullscreen Firefox (NOT FullyKiosk), served
// from a non-localhost host. Dev/test runs in Chrome and/or on localhost. We use
// that to keep governance (HR locks + the fingerprint UnlockPrompt) KIOSK-ONLY,
// so a developer never gets locked out of content while working.
//
// Overrides (for testers who DO want to exercise the locked flow off-kiosk, or
// force it off on the kiosk):
//   ?kiosk      / ?kiosk=1   → force kiosk ON
//   ?kiosk=0    / ?nokiosk   → force kiosk OFF
//
// Memoized: the environment doesn't change within a page session. (The mutable
// "touch switches to kiosk UI" affordance in FitnessApp is a cursor/UX concern,
// intentionally separate from this governance gate.)

let _cached;

export function isKioskEnv() {
  if (_cached !== undefined) return _cached;
  _cached = computeKioskEnv();
  return _cached;
}

function computeKioskEnv() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('nokiosk')) return false;
    if (params.has('kiosk')) {
      const v = params.get('kiosk');
      return v !== '0' && v !== 'false';
    }
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return false;
    // Mirrors FitnessApp's kioskUI base detection.
    const isFirefox = typeof InstallTrigger !== 'undefined'
      || (typeof navigator !== 'undefined'
          && navigator.userAgent
          && navigator.userAgent.toLowerCase().includes('firefox'));
    return Boolean(isFirefox);
  } catch {
    return false;
  }
}

// Test-only: reset the memoized value so a suite can vary the environment.
export function __resetKioskEnvCache() {
  _cached = undefined;
}

export default isKioskEnv;
