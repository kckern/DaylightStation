/**
 * linkProbe — let a host attach its own view of the network link to stall logs.
 *
 * The Player is generic and cannot know how a device sees its Wi-Fi. A host that
 * can (the piano kiosk asks its on-device bridge for RSSI / link speed / BSSID /
 * throughput) registers a probe; on `playback.stalled` the controller calls it
 * once and logs `playback.stalled.link` with the answer, so a stall row in the
 * log store carries the link that caused it.
 *
 * Contract: a probe is `() => Promise<object|null>`. It is bounded by
 * LINK_PROBE_TIMEOUT_MS, its errors are swallowed (a probe must never break
 * playback), and the newest registration wins.
 */
export const LINK_PROBE_TIMEOUT_MS = 1500;

let active = null;

/** Register a probe. Returns an unregister function (no-op if superseded). */
export function registerPlaybackLinkProbe(probe) {
  if (typeof probe !== 'function') return () => {};
  const entry = { probe };
  active = entry;
  return () => { if (active === entry) active = null; };
}

export function hasPlaybackLinkProbe() { return active != null; }

/**
 * Ask the registered probe. Resolves to its result, `{ error }` on failure or
 * timeout, or null when no probe is registered. Never rejects.
 */
export function probePlaybackLink({ timeoutMs = LINK_PROBE_TIMEOUT_MS } = {}) {
  const entry = active;
  if (!entry) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => done({ error: 'timeout' }), timeoutMs);
    try {
      Promise.resolve(entry.probe()).then(
        (v) => done(v ?? null),
        (e) => done({ error: String(e?.message || e || 'probe-failed') })
      );
    } catch (e) {
      done({ error: String(e?.message || e || 'probe-failed') });
    }
  });
}
