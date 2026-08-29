/**
 * AmbientLightService — subscribes to Home Assistant illuminance sensors over the
 * ambient sensor source and rebroadcasts max(lux) on the eventbus so the frontend
 * (ArtMode) can auto-dim to the room.
 */
import { AmbientLightTracker } from '../../2_domains/home-automation/AmbientLightTracker.mjs';
import { isAmbientSensorGateway } from './ports/IAmbientSensorGateway.mjs';

export function createAmbientLightService({
  ambientGateway, publications, entities = [], logger = console, clock,
}) {
  if (!isAmbientSensorGateway(ambientGateway)) {
    throw new TypeError('AmbientLightService requires ambientGateway');
  }
  if (!publications?.report) throw new TypeError('AmbientLightService requires publications');
  if (!clock?.now) throw new TypeError('AmbientLightService requires clock');
  const tracker = new AmbientLightTracker({ threshold: 1 });
  const THROTTLE_MS = 2000;
  let lastBroadcast = 0;
  let unsubscribe = null;

  function publish(lux, force = false) {
    const t = clock.now();
    if (!force && t - lastBroadcast < THROTTLE_MS) return;
    lastBroadcast = t;
    publications.report({ lux, sources: tracker.sources() });
  }

  function onReading({ entity, state }) {
    if (!entities.includes(entity)) return;
    const isFirstReading = !(entity in tracker.sources());
    const result = tracker.update(entity, state);
    if (result.changed) publish(result.lux, isFirstReading);
  }

  async function seed() {
    try {
      const states = await ambientGateway.getCurrentStates(entities);
      for (const [entity, s] of states) tracker.update(entity, s.state);
      const m = tracker.max();
      if (m !== null) publish(m, true);
    } catch (err) {
      logger.warn?.('ambient.seed.failed', { error: err.message });
    }
  }

  async function start() {
    if (!entities.length) { logger.info?.('ambient.disabled', { reason: 'no entities' }); return; }
    await seed();
    unsubscribe = ambientGateway.subscribe(entities, onReading);
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
  }

  return { start, stop };
}

export default createAmbientLightService;
