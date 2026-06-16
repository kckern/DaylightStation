/**
 * ambientZones — turn the `ambient.yml` config into a list of running per-zone
 * AmbientLightService instances. Each zone is one room's sensor set broadcasting
 * lux on its own eventbus topic.
 */
import { createAmbientLightService } from './AmbientLightService.mjs';

/**
 * Normalize ambient config into `[{ topic, entities }]`.
 * Accepts a `zones:` list, or a legacy single `illuminance:` block (→ one zone,
 * topic defaults to 'ambient'). Zones without a topic or with no string entities
 * are dropped.
 */
export function normalizeAmbientZones(config) {
  const out = [];
  const push = (topic, entities) => {
    const t = (typeof topic === 'string' && topic.trim()) ? topic.trim() : null;
    const ents = Array.isArray(entities)
      ? entities.filter((e) => typeof e === 'string' && e)
      : [];
    if (t && ents.length) out.push({ topic: t, entities: ents });
  };
  if (Array.isArray(config?.zones)) {
    for (const z of config.zones) push(z?.topic, z?.entities);
    return out;
  }
  if (config?.illuminance) push(config.illuminance.topic || 'ambient', config.illuminance.entities);
  return out;
}

/**
 * Start one AmbientLightService per zone. No-op (returns []) if the HA gateway
 * can't provide a connection. `createService` is injectable for tests.
 */
export function startAmbientZones({
  zones, haGateway, eventBus, logger,
  createService = createAmbientLightService,
}) {
  if (!haGateway?.getConnection) return [];
  const started = [];
  for (const zone of zones) {
    const svc = createService({
      haGateway, eventBus,
      config: { entities: zone.entities, topic: zone.topic },
      logger,
    });
    svc.start();
    started.push(svc);
  }
  return started;
}

export default normalizeAmbientZones;
