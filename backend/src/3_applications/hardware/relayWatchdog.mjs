const DEFAULT_THRESHOLD_MS = 6 * 3600_000;

export function createRelayWatchdog({
  eventBus,
  sources = {},
  onStale,
  onRecover,
  onBoot,
  clock = Date,
  logger = console,
} = {}) {
  if (!eventBus?.onClientMessage) {
    throw new Error('createRelayWatchdog: eventBus with onClientMessage required');
  }

  const seen = new Map();

  eventBus.onClientMessage((clientId, message) => {
    const source = message?.source;
    if (!source || !sources[source]) return;
    const now = clock.now();
    const prev = seen.get(source);
    // Replacing the entry also clears `alerted`, which is what re-arms the
    // watchdog for the next outage. `bootCount` rides along so a repeating
    // heartbeat isn't mistaken for a fresh reboot.
    const bootCount = Number.isFinite(message?.boot_count) ? message.boot_count : prev?.bootCount;
    seen.set(source, { lastSeenAt: now, bootCount });

    // A hello frame carries the board's post-mortem. Report it when the boot
    // counter MOVES — the frame itself repeats every 60s.
    if (message?.type === 'hello' && bootCount !== prev?.bootCount) {
      const boot = { source, label: sources[source]?.label || source, bootCount, lastReset: message.last_reset ?? null };
      logger.info?.('relay_watchdog.boot', boot);
      try {
        onBoot?.(boot);
      } catch (err) {
        logger.warn?.('relay_watchdog.boot_handler_failed', { source, error: err.message });
      }
    }
    if (prev?.alerted) {
      const silentMs = now - prev.lastSeenAt;
      logger.info?.('relay_watchdog.recovered', { source, silentMs });
      try {
        onRecover?.({ source, label: sources[source]?.label || source, silentMs });
      } catch (err) {
        logger.warn?.('relay_watchdog.recover_handler_failed', { source, error: err.message });
      }
    }
  });

  const check = (nowMs = clock.now()) => {
    for (const [source, entry] of seen) {
      if (entry.alerted) continue;
      const thresholdMs = Number(sources[source]?.thresholdMs) || DEFAULT_THRESHOLD_MS;
      const silentMs = nowMs - entry.lastSeenAt;
      if (silentMs < thresholdMs) continue;
      entry.alerted = true;
      logger.warn?.('relay_watchdog.stale', { source, silentMs, thresholdMs });
      try {
        onStale?.({
          source,
          label: sources[source]?.label || source,
          lastSeenAt: entry.lastSeenAt,
          silentMs,
        });
      } catch (err) {
        logger.warn?.('relay_watchdog.stale_handler_failed', { source, error: err.message });
      }
    }
  };

  return { check };
}

export default createRelayWatchdog;
