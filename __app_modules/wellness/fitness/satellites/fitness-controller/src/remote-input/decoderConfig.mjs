/**
 * Keeps a report-decoder table current from the app: GET
 * /api/v1/emulator/input/report-decoders serves input.yml controllers that carry
 * a `report_decoder` ({ decoders: [{ id, address, report_decoder }] }).
 *
 * Refreshed at start, on refresh() (the controller calls it on every socket
 * reconnect) and every `intervalMs`, so an edited input.yml takes effect
 * without a rebuild. A failed fetch keeps the last table.
 *
 * Logs `bt.remote.decoders` { count, ids } when the table changes (and on the
 * first load, and on refresh({ announce: true }) — the socket may not have been
 * open for the first one), `bt.remote.decoders-unavailable` { error } once per
 * outage.
 */
export function startDecoderRefresh({
  url,
  apply,                   // (entries) => number loaded
  logEvent,
  fetchImpl = globalThis.fetch,
  intervalMs = 10 * 60_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  let lastSig = null;
  let failing = false;
  let inFlight = null;

  let count = 0;
  let ids = [];
  let pendingAnnounce = false;
  const announce = () => logEvent?.('info', 'bt.remote.decoders', { count, ids });

  const refresh = ({ announce: wantAnnounce = false } = {}) => {
    if (wantAnnounce) pendingAnnounce = true;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const entries = Array.isArray(body?.decoders) ? body.decoders : [];
        const sig = JSON.stringify(entries);
        failing = false;
        const changed = sig !== lastSig;
        if (changed) {
          lastSig = sig;
          count = apply(entries);
          ids = entries.map((e) => e?.id ?? e?.address ?? null);
        }
        if (changed || pendingAnnounce) { pendingAnnounce = false; announce(); }
      } catch (err) {
        if (!failing) logEvent?.('warn', 'bt.remote.decoders-unavailable', { error: err.message });
        failing = true;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  refresh();
  const timer = setIntervalImpl(refresh, intervalMs);
  timer?.unref?.();
  return { refresh, stop() { clearIntervalImpl(timer); } };
}
