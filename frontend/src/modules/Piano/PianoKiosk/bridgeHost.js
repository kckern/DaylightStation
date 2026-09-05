// bridgeHost — single place to answer "could a piano-bridge APK exist on THIS
// client?"
//
// The bridge is a native Android app that serves a WebSocket on localhost:8770.
// It exists on exactly two kinds of client:
//   1. the piano tablet, where the APK runs behind the FullyKiosk WebView, and
//   2. a dev machine running the fake bridge (the headless-MIDI harness, which
//      stands up the same WS server on localhost).
//
// Everywhere else — a laptop with the piano page open on the LAN — nothing is
// listening on 8770 and nothing ever will. Connecting is still worth ATTEMPTING
// (that is what lets the fake harness work without configuration), but failing
// to connect is the expected steady state, not an error. Two forgotten Chrome
// tabs on a Mac retried for 49 hours and logged ~1,000 ERROR rows an hour,
// which was 100% of the log store's error volume — real errors could not be
// seen past them. `usePianoBridgeNotes` already demoted such clients after an
// 8s grace window, but the grace exists only to protect the tablet's boot race
// (the APK's WS server can lag the WebView), so on a host that cannot have an
// APK at all the grace buys nothing and costs a burst of ERROR rows per tab.
//
// Overrides, for exercising either path deliberately:
//   ?bridge     / ?bridge=1  → force plausible (loud errors, fast reconnect)
//   ?bridge=0   / ?nobridge  → force implausible (quiet, slow reconnect)
//
// Memoized: the host does not change within a page session.

let _cached;

/**
 * @returns {boolean} true when a bridge could plausibly be running here, so a
 * failure to reach it is worth reporting at `error`.
 */
export function bridgeHostPlausible() {
  if (_cached !== undefined) return _cached;
  _cached = computeBridgeHostPlausible();
  return _cached;
}

function computeBridgeHostPlausible() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('nobridge')) return false;
    if (params.has('bridge')) {
      const v = params.get('bridge');
      return v !== '0' && v !== 'false';
    }
    // The fake-bridge harness serves 8770 on the same machine as the page.
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    // The tablet: the APK and its WebView are both Android.
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return /Android/i.test(ua);
  } catch {
    // Unknown environment: assume a bridge is possible. Being wrong here only
    // costs log volume, whereas wrongly silencing the real tablet would hide a
    // dead APK — the failure this logging exists to catch.
    return true;
  }
}

/** Test-only: drop the memoized value so a suite can vary the environment. */
export function __resetBridgeHostCache() {
  _cached = undefined;
}

export default bridgeHostPlausible;
