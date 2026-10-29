/**
 * streamTransferMeter — server-side delivery rate of one long media transfer.
 *
 * The 2026-10-28 piano stalls were diagnosed as "the tablet's link" only by
 * elimination: nothing recorded how fast the proxy actually sent the stream,
 * or whether it was waiting on the client (TCP backpressure — the socket would
 * not take more) or on the upstream (Plex sending slowly). This meter answers
 * both for a direct-play part:
 *
 *   proxy.stream.progress  every PROGRESS_EVERY_MS while the transfer is open
 *   proxy.stream.transfer  once at the end
 *
 * with `kbps` (window / overall) and `backpressurePct` — the share of wall time
 * the upstream was paused because the CLIENT side could not keep up. Low kbps
 * with high backpressure = the link to the client is slow (Wi-Fi, NPM). Low
 * kbps with low backpressure = upstream (Plex/NAS) is slow.
 *
 * Pure accounting; the caller feeds it data/pause/resume/end events.
 */
export const PROGRESS_EVERY_MS = 30_000;
// Below these a transfer is a seek probe or a short range read: not worth a row.
export const MIN_LOGGED_DURATION_MS = 10_000;
export const MIN_LOGGED_BYTES = 4 * 1024 * 1024;

const kbps = (bytes, ms) => (ms > 0 ? Math.round((bytes * 8) / ms) : null); // bytes/ms*8 = kbit/s

export function createStreamTransferMeter({ now = () => Date.now(), startedAtMs = now() } = {}) {
  let bytes = 0;
  let windowBytes = 0;
  let windowStartMs = startedAtMs;
  let pausedAtMs = null;
  let pausedMs = 0;
  let windowPausedMs = 0;
  let lastProgressAtMs = startedAtMs;

  const settlePause = (t) => {
    if (pausedAtMs == null) return;
    const d = Math.max(0, t - pausedAtMs);
    pausedMs += d;
    windowPausedMs += d;
    pausedAtMs = t;
  };

  return {
    data(len) { bytes += len; windowBytes += len; },
    pause() { if (pausedAtMs == null) pausedAtMs = now(); },
    resume() { const t = now(); settlePause(t); pausedAtMs = null; },
    /** A progress snapshot if one is due (and resets the window), else null. */
    progressIfDue() {
      const t = now();
      if (t - lastProgressAtMs < PROGRESS_EVERY_MS) return null;
      settlePause(t);
      const span = t - windowStartMs;
      const row = {
        bytes,
        elapsedMs: t - startedAtMs,
        windowKbps: kbps(windowBytes, span),
        windowBackpressurePct: span > 0 ? Math.round((windowPausedMs / span) * 100) : null,
      };
      windowBytes = 0; windowPausedMs = 0; windowStartMs = t; lastProgressAtMs = t;
      return row;
    },
    /** Final summary, or null when the transfer was too small to matter. */
    summary({ completed }) {
      const t = now();
      settlePause(t);
      const durationMs = t - startedAtMs;
      if (durationMs < MIN_LOGGED_DURATION_MS && bytes < MIN_LOGGED_BYTES) return null;
      return {
        bytes,
        durationMs,
        kbps: kbps(bytes, durationMs),
        backpressurePct: durationMs > 0 ? Math.round((pausedMs / durationMs) * 100) : null,
        completed: completed === true,
      };
    },
  };
}
