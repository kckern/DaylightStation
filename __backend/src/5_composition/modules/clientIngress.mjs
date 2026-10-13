import { EventBusClientIngressAdapter } from '#adapters/eventbus/EventBusClientIngressAdapter.mjs';
import { EventBusPlaybackStateRelay } from '#adapters/eventbus/EventBusMediaClientIngress.mjs';
import { ClientIngressService } from '#apps/eventbus/ClientIngressService.mjs';

/**
 * Register the one production client-ingress path used by the app and by
 * acceptance fixtures. Keeping this composition shared prevents a fixture
 * from proving handlers that the real application never installs.
 */
export function registerClientIngress({
  eventBus,
  getCallLeaseService = () => null,
  homelineSignaling = null,
  frontendLogIngestion = null,
  getFitnessPresence = () => null,
  logger = console,
} = {}) {
  const publications = new EventBusClientIngressAdapter({ eventBus });
  const ingress = new ClientIngressService({
    publications,
    getCallLeaseService,
    homelineSignaling,
    frontendLogIngestion,
    getFitnessPresence,
    logger,
  });
  publications.attach(ingress);
  const playbackStateRelay = new EventBusPlaybackStateRelay({ eventBus, logger });
  playbackStateRelay.attach();
  return { ingress, publications, playbackStateRelay };
}

export default registerClientIngress;
