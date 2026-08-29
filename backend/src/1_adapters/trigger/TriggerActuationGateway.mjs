import { assertTriggerActuationGateway } from '#apps/trigger/ports/ITriggerActuationGateway.mjs';

/** Provider-facing implementation of the trigger actuation contract. */
export class TriggerActuationGateway {
  constructor({ deviceService, homeGateway = null, commandResolver = null, screenBroadcast = null }) {
    this.deviceService = deviceService;
    this.homeGateway = homeGateway;
    this.commandResolver = commandResolver;
    this.screenBroadcast = screenBroadcast;
    assertTriggerActuationGateway(this);
  }

  clearDevice(target) {
    const device = this.deviceService?.get?.(target);
    if (!device) throw new Error(`Unknown target device: ${target}`);
    return device.clearContent();
  }

  openDevice(target, contentPath, params = {}) {
    const device = this.deviceService?.get?.(target);
    if (!device) throw new Error(`Unknown target device: ${target}`);
    return device.loadContent(contentPath, params);
  }

  activateScene(scene) {
    return this.homeGateway?.callService('scene', 'turn_on', { entity_id: scene });
  }

  invokeHomeAction(serviceRef, entity, values = {}) {
    const [domain, service] = String(serviceRef || '').split('.');
    if (!domain || !service) throw new Error(`Invalid ha service: ${serviceRef}`);
    const data = { ...values };
    if (entity) data.entity_id = entity;
    return this.homeGateway?.callService(domain, service, data);
  }

  sendTransport(target, command, argument) {
    const payload = this.commandResolver?.(command, argument);
    if (!payload) return { handled: false };
    return { handled: true, result: this.screenBroadcast?.(target, payload) };
  }

  sendNotification(service, payload) {
    return this.homeGateway?.callService('notify', service, payload);
  }

  disableAutomation(entity) {
    return this.homeGateway?.callService('automation', 'turn_off', {
      entity_id: entity,
      stop_actions: true,
    });
  }

  enableAutomation(entity) {
    return this.homeGateway?.callService('automation', 'turn_on', { entity_id: entity });
  }
}

export default TriggerActuationGateway;
