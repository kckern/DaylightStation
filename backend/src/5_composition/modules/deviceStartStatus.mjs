// Composition wiring for DeviceStartStatusService (RQ-HOUSE-04): observes the
// WakeAndLoad `homeline:<id>` step stream, publishes `device-start:<id>`, and
// registers with the event bus for replay-on-subscribe.
import { DeviceStartStatusService } from '#apps/devices/services/DeviceStartStatusService.mjs';
import { EventBusDeviceTransportGateway } from '#adapters/devices/EventBusDeviceTransportGateway.mjs';

let instance = null;
let instanceBus = null;

/**
 * @param {Object} config
 * @param {Object} config.eventBus - WebSocketEventBus (subscribePattern + broadcast)
 * @param {Object} [config.logger]
 * @returns {{ startStatusService: DeviceStartStatusService }}
 */
export function createDeviceStartStatusService({ eventBus, logger = console } = {}) {
  if (!eventBus) throw new Error('createDeviceStartStatusService requires eventBus');
  // A singleton per event bus: a second composition (tests, a restarted bus)
  // must not get a service still listening to the first one.
  if (instance && instanceBus === eventBus) return { startStatusService: instance };
  if (instance) { try { instance.stop(); } catch { /* best effort */ } }
  const startStatusService = new DeviceStartStatusService({
    progressGateway: new EventBusDeviceTransportGateway({ eventBus }), logger,
  });
  startStatusService.start();
  if (typeof eventBus.setStartStatusService === 'function') eventBus.setStartStatusService(startStatusService);
  else logger.warn?.('device-start-status.bus_missing_setter');
  instance = startStatusService;
  instanceBus = eventBus;
  return { startStatusService };
}

export function getDeviceStartStatusService() {
  return instance;
}

export function stopDeviceStartStatusService() {
  try { instance?.stop(); } catch { /* best effort */ }
  instance = null;
  instanceBus = null;
}
