import { IHubFleetRealtimeGateway } from '#apps/playback-hub/ports/IHubFleetRealtimeGateway.mjs';
import { buildDeviceStateBroadcast } from '#shared-contracts/media/envelopes.mjs';
import { DEVICE_STATE_TOPIC } from '#shared-contracts/media/topics.mjs';

const HUB_STATUS_TOPIC = 'playback-hub:status';

/** Maps playback-hub/Fleet semantic publications to the existing event-bus contract. */
export class EventBusHubFleetRealtimeAdapter extends IHubFleetRealtimeGateway {
  #eventBus;

  constructor({ eventBus } = {}) {
    super();
    if (!eventBus?.subscribe) throw new Error('EventBusHubFleetRealtimeAdapter requires eventBus');
    this.#eventBus = eventBus;
  }

  observeHubStatus(handler) {
    return this.#eventBus.subscribe(HUB_STATUS_TOPIC, (payload) => handler(payload?.data));
  }

  publishDeviceState({ deviceId, snapshot, reason, ts }) {
    const topic = DEVICE_STATE_TOPIC(deviceId);
    const payload = buildDeviceStateBroadcast({ deviceId, snapshot, reason, ts });
    if (typeof this.#eventBus.broadcast === 'function') this.#eventBus.broadcast(topic, payload);
    else this.#eventBus.publish?.(topic, payload);
  }
}

export default EventBusHubFleetRealtimeAdapter;
