/**
 * ambientZones — turn the `ambient.yml` config into a list of running per-zone
 * AmbientLightService instances. Each zone is one room's sensor set broadcasting
 * lux on its own eventbus topic.
 */
import { createAmbientLightService } from './AmbientLightService.mjs';

/**
 * Start one AmbientLightService per zone. No-op when no semantic gateway
 * factory is composed. `createService` is injectable for tests.
 */
export function startAmbientZones({
  zones, ambientGatewayFactory, publicationsFactory, clock, logger,
  createService = createAmbientLightService,
}) {
  if (typeof ambientGatewayFactory !== 'function') return [];
  const started = [];
  for (const zone of zones) {
    const svc = createService({
      ambientGateway: ambientGatewayFactory(zone),
      publications: publicationsFactory(zone),
      entities: zone.entities,
      clock,
      logger,
    });
    svc.start();
    started.push(svc);
  }
  return started;
}

export default startAmbientZones;
