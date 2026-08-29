import { IClientIngressPublications } from '#apps/eventbus/ports/IClientIngressPublications.mjs';

/** Translates between WebSocket bus callbacks and semantic client-ingress policy. */
export class EventBusClientIngressAdapter extends IClientIngressPublications {
  constructor({ eventBus }) {
    super();
    if (!eventBus) throw new Error('EventBusClientIngressAdapter requires eventBus');
    this.bus = eventBus;
  }

  attach(ingress) {
    this.bus.setClientSubscriptionAuthorizer((clientId, topic) => ingress.canSubscribe(clientId, topic));
    this.bus.setClientMessageAuthorizer((clientId, message) => ingress.authorizeMessage(clientId, message));
    this.bus.onClientDisconnection((clientId) => ingress.disconnect(clientId));
    this.bus.onClientMessage((clientId, message) => ingress.handle(clientId, message));
    this.bus.onClientMessage((clientId, message) => ingress.relayAllowlisted(clientId, message));
  }

  sendAuthorizationAck(clientId, topic, result) {
    this.bus.sendToClient(clientId, { type: 'homeline-authorize-ack', topic, ...result });
  }
  publishCall(topic, message) { this.bus.broadcast(topic, message); }
  publishFitness(message) { this.bus.broadcast('fitness', message); }
  publishMidi(message) { this.bus.broadcast('midi', message); }
  publishHomeline(topic, message) { this.bus.broadcast(topic, message); }
  publishDeviceState(deviceId, message) { this.bus.broadcast(`device-state:${deviceId}`, message); }
  publishDeviceAck(deviceId, message) { this.bus.broadcast(`device-ack:${deviceId}`, message); }
  publishRelay(topic, message) { this.bus.broadcast(topic, message); }
  clientMetadata(clientId) {
    const metadata = this.bus.getClientMeta(clientId);
    return { ip: metadata?.ip, userAgent: metadata?.userAgent };
  }
}

export default EventBusClientIngressAdapter;
