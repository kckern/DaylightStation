/** Shapes and sends the household alert produced by a stale hardware relay. */
export class RelayStaleAlertService {
  constructor({ notifier, resolveStatusUrl, formatTimestamp, logger = console }) {
    this.notifier = notifier;
    this.resolveStatusUrl = resolveStatusUrl;
    this.formatTimestamp = formatTimestamp;
    this.logger = logger;
  }

  notify({ label, silentMs, lastSeenAt }) {
    const hours = Math.round(silentMs / 3600_000);
    let statusHint = '';
    try {
      const statusUrl = this.resolveStatusUrl();
      if (statusUrl) statusHint = ` Status: ${statusUrl}`;
    } catch { /* missing device config must not block the alert */ }
    return this.notifier.send({
      title: 'Relay has gone quiet',
      body: `${label} has sent nothing for ${hours}h (last frame ${this.formatTimestamp(lastSeenAt)}). Check that it has power.${statusHint}`,
      category: 'system',
      urgency: 'high',
      dedupeKey: `relay-stale:${label}:${lastSeenAt}`,
    }).catch((error) => this.logger.warn?.('relay-watchdog.notify-failed', { error: error.message }));
  }
}

export default RelayStaleAlertService;
