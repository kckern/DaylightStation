import { shouldRelayBtTopic, shouldRelayKioskLaunchTopic } from './ClientRelayPolicy.mjs';

/** Cross-context policy for messages accepted from connected household clients. */
export class ClientIngressService {
  constructor({
    publications,
    getCallLeaseService = () => null,
    homelineSignaling = null,
    frontendLogIngestion = null,
    getFitnessPresence = () => null,
    logger = console,
  } = {}) {
    if (!publications) throw new Error('ClientIngressService requires publications');
    Object.assign(this, {
      publications,
      getCallLeaseService,
      homelineSignaling,
      frontendLogIngestion,
      getFitnessPresence,
      logger,
    });
  }

  canSubscribe(clientId, topic) {
    return !String(topic).startsWith('homeline-call:')
      || this.getCallLeaseService()?.canSubscribe(clientId, topic) === true;
  }

  authorizeMessage(clientId, message) {
    return message?.type !== 'homeline-authorize' && String(message?.topic).startsWith('homeline-call:')
      ? (this.getCallLeaseService()?.validateSignal(clientId, message) || { ok: false, code: 'LEASES_NOT_READY' })
      : { ok: true, message };
  }

  disconnect(clientId) {
    this.getCallLeaseService()?.disconnect(clientId);
  }

  handle(clientId, message) {
    if (message.type === 'homeline-authorize') {
      const result = this.getCallLeaseService()?.authorize({ ...message, clientId })
        || { ok: false, code: 'LEASES_NOT_READY' };
      this.publications.sendAuthorizationAck(clientId, message.topic, result);
      return;
    }
    if (message.topic?.startsWith('homeline-call:')) {
      this.publications.publishCall(message.topic, message);
      return;
    }
    if (message.source === 'fitness' || message.source === 'fitness-simulator') {
      this.publications.publishFitness(message);
      this.logger.debug?.('eventbus.fitness.broadcast', { source: message.source });
      return;
    }
    if (message.source === 'piano' && message.topic === 'midi') {
      if (!message.type || !message.timestamp) {
        this.logger.warn?.('eventbus.midi.invalid', { clientId });
        return;
      }
      this.publications.publishMidi({
        source: message.source,
        type: message.type,
        timestamp: message.timestamp,
        sessionId: message.sessionId,
        data: message.data,
      });
      return;
    }
    if (message.topic?.startsWith('homeline:')) {
      this.homelineSignaling?.handle(message);
      this.publications.publishHomeline(message.topic, message);
      return;
    }
    if (message.topic === 'device-state' && typeof message.deviceId === 'string' && message.deviceId) {
      this.publications.publishDeviceState(message.deviceId, {
        deviceId: message.deviceId,
        snapshot: message.snapshot ?? null,
        reason: message.reason ?? 'change',
        ts: message.ts,
      });
      return;
    }
    if (message.topic === 'device-ack' && typeof message.deviceId === 'string' && message.deviceId) {
      this.publications.publishDeviceAck(message.deviceId, message);
      return;
    }
    if (message.source === 'playback-logger' || message.topic === 'logging') {
      const metadata = this.publications.clientMetadata(clientId);
      this.frontendLogIngestion?.ingest(message, metadata, {
        onEvent: (normalized) => this.getFitnessPresence()?.observe(normalized),
      });
    }
  }

  relayAllowlisted(clientId, message) {
    if (message && shouldRelayBtTopic(message.topic)) {
      this.publications.publishRelay(message.topic, message);
      this.logger.debug?.('eventbus.bt.relay', { clientId, topic: message.topic });
    }
    if (message && shouldRelayKioskLaunchTopic(message.topic)) {
      this.publications.publishRelay(message.topic, message);
      this.logger.debug?.('eventbus.kiosk.relay', { clientId, topic: message.topic, deviceId: message.deviceId });
    }
  }
}

export default ClientIngressService;
