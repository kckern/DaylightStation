import { IArcadeGameSupervisorAlert } from '#apps/gaming/ports/IArcadeGameSupervisorAlert.mjs';

/**
 * Sends a supervisor alert to a phone through home automation's notify service,
 * using the device's own `notify_service` — the same channel the rest of the
 * house already uses to reach a parent about that screen.
 *
 * Best effort by design: a failed alert is logged and swallowed. It must never
 * become an exception on the observation path, because the meter continuing to
 * measure matters more than the message arriving.
 */
export class HomeAssistantArcadeGameAlert extends IArcadeGameSupervisorAlert {
  #gateway; #serviceByDevice; #logger;

  constructor({ haGateway, serviceByDevice = new Map(), logger = console }) {
    super();
    this.#gateway = haGateway || null;
    this.#serviceByDevice = serviceByDevice;
    this.#logger = logger;
  }

  async raise({ deviceId, condition, message }) {
    const service = this.#serviceByDevice.get(deviceId);
    if (!this.#gateway?.callService || !service) {
      this.#logger.warn?.('arcade.alert.undeliverable', {
        deviceId, condition,
        note: 'no notify service configured for this device — the alert has nowhere to go',
      });
      return false;
    }
    try {
      await this.#gateway.callService('notify', service, {
        title: 'Arcade',
        message,
      });
      this.#logger.info?.('arcade.alert.sent', { deviceId, condition });
      return true;
    } catch (error) {
      this.#logger.warn?.('arcade.alert.failed', { deviceId, condition, error: error.message });
      return false;
    }
  }
}

export default HomeAssistantArcadeGameAlert;
