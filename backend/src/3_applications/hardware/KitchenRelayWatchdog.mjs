import { createRelayWatchdog } from './relayWatchdog.mjs';

const KITCHEN_RELAY_SOURCES = Object.freeze({
  'kitchen-relay': { label: 'Kitchen relay', thresholdMs: 12 * 3600_000 },
  'food-scale-relay': { label: 'Kitchen relay (legacy scale source)', thresholdMs: 12 * 3600_000 },
});

/** Named kitchen liveness policy: either modern or legacy relay ingress proves life. */
export class KitchenRelayWatchdog {
  constructor({ relayGateway, staleAlerts, logger = console } = {}) {
    if (!staleAlerts?.notify) throw new Error('KitchenRelayWatchdog requires staleAlerts');
    this.watchdog = createRelayWatchdog({
      relayGateway,
      sources: KITCHEN_RELAY_SOURCES,
      logger,
      onStale: (event) => staleAlerts.notify(event),
      onRecover: ({ label, silentMs }) => logger.info?.('relay-watchdog.recovered', { label, silentMs }),
    });
  }

  check() { return this.watchdog.check(); }
}

export default KitchenRelayWatchdog;
