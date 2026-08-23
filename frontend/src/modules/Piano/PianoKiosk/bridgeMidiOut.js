// bridgeMidiOut.js — route immediate MIDI OUT through the piano-bridge APK's
// write path (http://localhost:8770/midi/send) instead of the browser's Web MIDI
// output handle.
//
// Why: the Web MIDI output handle is the ONE unverified segment of the MIDI
// chain. It goes zombie (send() succeeds, nothing leaves the tablet) and no
// assertion covers it — whereas the APK's write path is continuously verified
// by the piano's own echo (Loopback, `linkVerdict` in every heartbeat). On
// 2026-08-23 voice/CC changes "sent" fine into a dead browser handle while the
// bridge path was provably delivering. So: when the bridge is reachable, ALL
// immediate sends take the verified path; Web MIDI remains the fallback (and
// stays the only path for TIMESTAMPED sends, which need Chromium's scheduler).
//
// Availability is a freshness latch fed by a light /status poll — never a
// per-send blocking check. On non-kiosk devices (no bridge on localhost) the
// poll fails fast and forever, and every send falls back to Web MIDI exactly
// as before this module existed.
import getLogger from '../../../lib/logging/Logger.js';

const BRIDGE = 'http://localhost:8770';
const PROBE_EVERY_MS = 10_000;
/** How long a successful probe keeps the bridge "up" (covers 2 missed probes). */
const FRESH_MS = 25_000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'bridge-midi-out' });
  return _logger;
}

let lastOkAt = 0;
let probeTimer = null;
let announced = false;

function probe() {
  try {
    fetch(`${BRIDGE}/status`, { method: 'GET', signal: AbortSignal.timeout(2500) })
      .then((r) => {
        if (!r.ok) return;
        lastOkAt = Date.now();
        if (!announced) {
          announced = true;
          logger().info('bridge-out.available', { bridge: BRIDGE });
        }
      })
      .catch(() => { /* no bridge here — Web MIDI carries the sends */ });
  } catch { /* fetch/AbortSignal unavailable — fall back silently */ }
}

function ensureProbing() {
  if (probeTimer) return;
  // Never probe the real network from a test runner (jsdom has window+fetch,
  // so environment sniffing alone doesn't cut it).
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') { probeTimer = true; return; }
  probe();
  probeTimer = setInterval(probe, PROBE_EVERY_MS);
}

/** True while the bridge answered /status within the freshness window. */
export function bridgeOutUp() {
  ensureProbing();
  return Date.now() - lastOkAt < FRESH_MS;
}

/**
 * Fire-and-forget send of raw MIDI bytes via the bridge's verified write path.
 * Returns true if the send was DISPATCHED to the bridge (delivery to the piano
 * is then attested by the bridge's own loopback verdict, not by us); false if
 * the bridge is not up — caller must fall back to Web MIDI.
 */
export function bridgeSendMidi(bytes) {
  if (!bridgeOutUp()) return false;
  const hexStr = Array.from(bytes, (b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');
  try {
    fetch(`${BRIDGE}/midi/send?hex=${encodeURIComponent(hexStr)}`, { method: 'POST' })
      .then((r) => { if (!r.ok) lastOkAt = 0; })
      .catch(() => { lastOkAt = 0; }); // drop the latch → next sends fall back immediately
  } catch {
    lastOkAt = 0;
    return false;
  }
  return true;
}
